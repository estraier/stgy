import fs from "fs/promises";
import sqlite3 from "sqlite3";
import { Database } from "../utils/database";
import { Tokenizer } from "../utils/tokenizer";
import { Logger } from "pino";
import {
  DocumentTaskQueue,
  ManagementTaskQueue,
  SearchTask,
  TaskItem,
  DocumentTask,
  ManagementTask,
} from "./taskQueue";
import { IndexFileManager, IndexFileInfo } from "./indexFileManager";
import { makeFtsQuery, quoteFtsText } from "../utils/query";
import { TaskWaitTimeoutError } from "../utils/taskWait";

const DB_PAGE_SIZE_BYTES = 8192;
const FTS_BLOCK_SIZE_BYTES = 8000;
const WAL_MAX_SIZE_BYTES = 67108864;
const BUSY_TIMEOUT_MS = 5000;
export type NumericOp = "eq" | "gt" | "gte" | "lt" | "lte";

export type SearchFilters = {
  labels?: string[];
  numericOp?: NumericOp;
  numericValue?: number;
};

export function normalizeLabels(labels: unknown): string[] {
  if (!Array.isArray(labels)) throw new Error("labels must be an array");
  const unique = new Set<string>();
  for (const label of labels) {
    if (typeof label !== "string" || label.length === 0) {
      throw new Error("labels must contain non-empty strings");
    }
    for (const ch of label) {
      if (ch === " ") continue;
      if (/^[\p{Cc}\p{Cf}\p{Cs}\p{Cn}\p{Z}]$/u.test(ch)) {
        throw new Error("labels may contain only printable characters and U+0020 SPACE");
      }
    }
    unique.add(label);
  }
  return Array.from(unique).sort();
}

function numericSqlOperator(op: NumericOp): string {
  switch (op) {
    case "eq":
      return "=";
    case "gt":
      return ">";
    case "gte":
      return ">=";
    case "lt":
      return "<";
    case "lte":
      return "<=";
  }
  throw new Error(`invalid numericOp: ${op}`);
}

export function buildSearchSql(
  filteringPhraseCount: number,
  numericOp: NumericOp | undefined,
  recordContents: boolean,
): string {
  let sql = `SELECT t.external_id
               FROM docs
               CROSS JOIN id_tuples t
              WHERE docs MATCH ?
                AND t.internal_id = docs.rowid`;
  if (recordContents) {
    for (let i = 0; i < filteringPhraseCount; i++) {
      sql += ` AND instr(char(10) || docs.tokens || char(10), char(10) || ? || char(10)) > 0`;
    }
  }
  if (numericOp !== undefined) {
    sql += ` AND t.numeric_value ${numericSqlOperator(numericOp)} ?`;
  }
  sql += ` ORDER BY docs.rowid ASC LIMIT ?`;
  return sql;
}

class AsyncRWLock {
  private activeReaders = 0;
  private writerActive = false;
  private waitingWriters: (() => void)[] = [];
  private waitingReaders: (() => void)[] = [];

  async acquireRead(): Promise<() => void> {
    if (this.writerActive || this.waitingWriters.length > 0) {
      await new Promise<void>((resolve) => this.waitingReaders.push(resolve));
    }
    this.activeReaders++;
    return () => {
      this.activeReaders--;
      if (this.activeReaders === 0 && this.waitingWriters.length > 0) {
        this.writerActive = true;
        this.waitingWriters.shift()!();
      }
    };
  }

  async acquireWrite(): Promise<() => void> {
    if (this.writerActive || this.activeReaders > 0) {
      await new Promise<void>((resolve) => this.waitingWriters.push(resolve));
    }
    this.writerActive = true;
    return () => {
      this.writerActive = false;
      if (this.waitingWriters.length > 0) {
        this.writerActive = true;
        this.waitingWriters.shift()!();
      } else {
        while (this.waitingReaders.length > 0) {
          this.waitingReaders.shift()!();
        }
      }
    };
  }
}

export type SearchConfig = {
  baseDir: string;
  namePrefix: string;
  bucketDurationSeconds: number;
  autoCommitUpdateCount: number;
  autoCommitDurationSeconds: number;
  commitCheckIntervalSeconds: number;
  updateWorkerBusySleepSeconds: number;
  updateWorkerIdleSleepSeconds: number;
  initialDocumentId: number;
  recordPositions: boolean;
  recordContents: boolean;
  readConnectionCounts: number[];
  mmapSizes: number[];
  cacheSizes: number[];
  automergeLevels: number[];
  maxQueryTokenCount: number;
  maxDocumentTokenCount: number;
};

type ReaderConnection = {
  db: Database;
};

type ShardConnection = {
  writer: Database;
  readers: ReaderConnection[];
  currentReaderIndex: number;
  pendingTxCount: number;
  lastTxStartTime: number;
  isCommitting: boolean;
  pendingBatchTaskIds: string[];
  committedBatchTaskIds: string[];
  recordPositions: boolean;
  recordContents: boolean;
};

export type OpenOptions = {
  startWorker?: boolean;
};

export class SearchService {
  protected config: SearchConfig;
  protected logger: Logger;
  protected mgmtQueue: ManagementTaskQueue;
  protected docQueue: DocumentTaskQueue;
  protected fileManager: IndexFileManager;
  private isOpen: boolean = false;
  private isClosing: boolean = false;
  private maintenanceMode: boolean = false;
  private workerPromise: Promise<void> | null = null;
  protected workerRunning: boolean = false;

  private shards: Map<number, ShardConnection> = new Map();
  private shardOpeningPromises: Map<number, Promise<ShardConnection>> = new Map();
  private latestShardTimestamp: number = 0;
  private serviceLock = new AsyncRWLock();
  private lastCommitCheckTime: number = 0;
  private lastLatestCommitCheckTime: number = 0;

  constructor(config: SearchConfig, logger: Logger) {
    this.config = config;
    this.logger = logger;
    this.mgmtQueue = new ManagementTaskQueue(config);
    this.docQueue = new DocumentTaskQueue(config);
    this.fileManager = new IndexFileManager(config);
  }

  public getLogger(): Logger {
    return this.logger;
  }

  async open(options: OpenOptions = {}): Promise<void> {
    if (this.isOpen) return;
    await fs.mkdir(this.config.baseDir, { recursive: true });
    await this.mgmtQueue.open();
    await this.docQueue.open();

    const files = await this.fileManager.listIndexFiles(true);
    if (files.length > 0) this.latestShardTimestamp = files[0].startTimestamp;
    for (const file of files) {
      if (this.isClosing) break;
      if (!file.isHealthy) {
        this.logger.warn(
          { shard: file.filename },
          "Skipping unhealthy or incompatible search shard",
        );
        continue;
      }
      await this.getShard(file.startTimestamp);
    }

    const pendingTasks = await this.docQueue.getPendingBatchTasks();
    if (pendingTasks.length > 0) {
      this.logger.info({ count: pendingTasks.length }, "Recovering pending batch tasks");
      const releaseRead = await this.serviceLock.acquireRead();
      try {
        for (const task of pendingTasks) {
          if (this.isClosing) break;
          try {
            await this.processDataTask(task);
          } catch (e) {
            this.logger.error({ err: e, taskId: task.id }, "Recovery task failed");
          }
        }
        await this.synchronizeAllShards();
      } finally {
        releaseRead();
      }
    }

    if (this.isClosing) return;
    this.isOpen = true;
    await this.updateShardConfigs();
    if (options.startWorker !== false) {
      this.workerRunning = true;
      this.workerPromise = this.workerLoop();
    }
  }

  async close(): Promise<void> {
    if (!this.isOpen || this.isClosing) return;
    this.isClosing = true;
    this.workerRunning = false;
    if (this.workerPromise) await this.workerPromise;

    const releaseWrite = await this.serviceLock.acquireWrite();
    try {
      await this.synchronizeAllShards();
      for (const shard of Array.from(this.shards.values())) {
        await shard.writer.close();
        for (const r of shard.readers) await r.db.close();
      }
      this.shards.clear();
      await this.mgmtQueue.close();
      await this.docQueue.close();
    } finally {
      releaseWrite();
    }
    this.isOpen = false;
    this.isClosing = false;
  }

  async startMaintenanceMode(): Promise<void> {
    this.maintenanceMode = true;
  }
  async endMaintenanceMode(): Promise<void> {
    this.maintenanceMode = false;
  }
  async checkMaintenanceMode(): Promise<boolean> {
    return this.maintenanceMode;
  }

  async clearTaskQueue(): Promise<void> {
    const releaseWrite = await this.serviceLock.acquireWrite();
    try {
      await this.docQueue.clear();
      await this.mgmtQueue.clear();
      this.logger.info("Task queues cleared");
    } finally {
      releaseWrite();
    }
  }

  async listIndexFiles(detailed: boolean = false): Promise<IndexFileInfo[]> {
    return this.fileManager.listIndexFiles(detailed);
  }

  async enqueueTask(task: SearchTask): Promise<string> {
    if (task.type === "ADD") {
      if (task.payload.numericValue !== null && !Number.isFinite(task.payload.numericValue)) {
        throw new Error("numericValue must be a finite number or null");
      }
      return this.docQueue.enqueue({
        type: "ADD",
        payload: {
          ...task.payload,
          labels: normalizeLabels(task.payload.labels),
        },
      });
    }
    return task.type === "REMOVE" ? this.docQueue.enqueue(task) : this.mgmtQueue.enqueue(task);
  }

  async waitTask(id: string, timeoutMs = 5000): Promise<void> {
    const effectiveTimeout = Math.max(timeoutMs, 100);
    const maxDelay = Math.min(effectiveTimeout / 2, 1000);
    const start = Date.now();
    let currentDelay = 100;
    const queue = id.startsWith("m-") ? this.mgmtQueue : this.docQueue;
    while (true) {
      if (this.isClosing) throw new Error("Service closed");
      if (!(await queue.isPending(id))) return;
      const elapsed = Date.now() - start;
      if (elapsed >= effectiveTimeout) throw new TaskWaitTimeoutError(id, effectiveTimeout);
      await this.sleep(Math.min(currentDelay, effectiveTimeout - elapsed));
      if (currentDelay < maxDelay) currentDelay = Math.min(currentDelay + 50, maxDelay);
    }
  }

  async search(
    query: string,
    locale = "en",
    limit = 100,
    offset = 0,
    timeout = 1,
    filters: SearchFilters = {},
  ): Promise<string[]> {
    if (!this.isOpen) throw new Error("Service not open");
    const labels = normalizeLabels(filters.labels ?? []);
    const hasNumericFilter = filters.numericOp !== undefined || filters.numericValue !== undefined;
    if (hasNumericFilter) {
      if (filters.numericOp === undefined || filters.numericValue === undefined) {
        throw new Error("numericOp and numericValue must be specified together");
      }
      if (!Number.isFinite(filters.numericValue)) {
        throw new Error("numericValue must be a finite number");
      }
    }
    const releaseRead = await this.serviceLock.acquireRead();
    try {
      const sortedTs = Array.from(this.shards.keys()).sort((a, b) => b - a);
      const results: string[] = [];
      const needed = limit + offset;
      const start = Date.now();
      const ftsQueryCache = new Map<boolean, { ftsQuery: string; filteringPhrases: string[] }>();

      for (const ts of sortedTs) {
        if (Date.now() - start > timeout * 1000 || results.length >= needed) break;
        const shard = await this.getShard(ts);
        if (!ftsQueryCache.has(shard.recordPositions)) {
          ftsQueryCache.set(
            shard.recordPositions,
            await makeFtsQuery(
              query,
              locale,
              this.config.maxQueryTokenCount,
              shard.recordPositions,
            ),
          );
        }
        const { ftsQuery, filteringPhrases } = ftsQueryCache.get(shard.recordPositions)!;
        if (!ftsQuery) continue;

        const labelQueries = labels.map((label) => `labels : ${quoteFtsText(label)}`);
        const combinedFtsQuery = [...labelQueries, `tokens : (${ftsQuery})`].join(" AND ");

        const db = this.selectReader(shard);
        const sql = buildSearchSql(
          filteringPhrases.length,
          hasNumericFilter ? filters.numericOp : undefined,
          shard.recordContents,
        );
        const params: (string | number)[] = [combinedFtsQuery];
        if (shard.recordContents) {
          for (const phrase of filteringPhrases) {
            params.push(phrase);
          }
        }
        if (hasNumericFilter) {
          params.push(filters.numericValue!);
        }
        params.push(needed - results.length);
        const rows = await db.all<{ external_id: string }>(sql, params);
        rows.forEach((r) => results.push(r.external_id));
      }
      return results.slice(offset, needed);
    } finally {
      releaseRead();
    }
  }

  async fetchDocuments(ids: string[], omitBodyText = false, omitAttrs = false) {
    if (!this.isOpen) throw new Error("Service not open");
    const releaseRead = await this.serviceLock.acquireRead();
    try {
      const results: {
        id: string;
        bodyText: string | null;
        attrs: string | null;
        labels: string[];
        numericValue: number | null;
      }[] = [];
      const needed = new Set(ids);
      const sortedTs = Array.from(this.shards.keys()).sort((a, b) => b - a);
      for (const ts of sortedTs) {
        if (needed.size === 0 || this.isClosing) break;
        const shard = await this.getShard(ts);
        const db = this.selectReader(shard);
        const batch = Array.from(needed);
        const placeholders = batch.map(() => "?").join(",");
        const rows = await db.all<{
          id: string;
          bodyText: string | null;
          attrs: string | null;
          labelsJson: string;
          numericValue: number | null;
        }>(
          `SELECT t.external_id as id,
                  ${omitBodyText ? "NULL" : "d.tokens"} as bodyText,
                  ${omitAttrs ? "NULL" : "e.attrs"} as attrs,
                  t.labels_json as labelsJson,
                  t.numeric_value as numericValue
           FROM id_tuples t JOIN docs d ON t.internal_id = d.rowid LEFT JOIN extra_attrs e ON t.external_id = e.external_id
           WHERE t.external_id IN (${placeholders})`,
          batch,
        );
        rows.forEach((r) => {
          results.push({
            id: r.id,
            bodyText: r.bodyText === null ? null : r.bodyText.replace(/\n/g, " "),
            attrs: r.attrs,
            labels: JSON.parse(r.labelsJson) as string[],
            numericValue: r.numericValue,
          });
          needed.delete(r.id);
        });
      }
      return results;
    } finally {
      releaseRead();
    }
  }

  private async workerLoop(): Promise<void> {
    this.lastCommitCheckTime = Date.now();
    this.lastLatestCommitCheckTime = Date.now();

    while (this.workerRunning) {
      try {
        let taskProcessed = false;
        const mgmtTask = await this.mgmtQueue.fetchFirst();
        if (mgmtTask) {
          const isStructural = mgmtTask.type === "RECONSTRUCT" || mgmtTask.type === "DROP_SHARD";
          const release = isStructural
            ? await this.serviceLock.acquireWrite()
            : await this.serviceLock.acquireRead();
          try {
            await this.processControlTask(mgmtTask);
            if (isStructural) {
              await this.updateShardConfigsInternal();
            }
          } catch (e) {
            this.logger.error(
              { err: e, taskId: mgmtTask.id, type: mgmtTask.type },
              "Worker mgmt task failed",
            );
          } finally {
            release();
            await this.mgmtQueue.removeFromInput(mgmtTask.id);
          }
          taskProcessed = true;
        } else if (!this.maintenanceMode) {
          const docTask = await this.docQueue.fetchFirst();
          if (docTask) {
            const bucketTs = this.fileManager.getBucketTimestamp(docTask.payload.timestamp);
            const isStructural = bucketTs > this.latestShardTimestamp;
            const release = isStructural
              ? await this.serviceLock.acquireWrite()
              : await this.serviceLock.acquireRead();
            try {
              if (isStructural) {
                this.latestShardTimestamp = bucketTs;
                await this.getShard(bucketTs);
                await this.updateShardConfigsInternal();
              }
              await this.docQueue.moveToBatch(docTask);
              await this.processDataTask(docTask);
            } catch (e) {
              this.logger.error({ err: e, taskId: docTask.id }, "Worker doc task failed");
            } finally {
              release();
            }
            taskProcessed = true;
          }
        }

        const now = Date.now();
        if (
          now - this.lastLatestCommitCheckTime >=
          (this.config.autoCommitDurationSeconds * 1000) / 2
        ) {
          this.lastLatestCommitCheckTime = now;
          if (!this.maintenanceMode && !this.isClosing) {
            const releaseRead = await this.serviceLock.acquireRead();
            try {
              await this.checkLatestAutoCommit();
            } finally {
              releaseRead();
            }
          }
        }
        if (now - this.lastCommitCheckTime >= this.config.commitCheckIntervalSeconds * 1000) {
          this.lastCommitCheckTime = now;
          if (!this.maintenanceMode && !this.isClosing) {
            const releaseRead = await this.serviceLock.acquireRead();
            try {
              await this.checkAllAutoCommit();
            } finally {
              releaseRead();
            }
          }
        }

        if (taskProcessed) {
          await this.sleep(this.config.updateWorkerBusySleepSeconds * 1000);
        } else {
          await this.sleep(this.config.updateWorkerIdleSleepSeconds * 1000);
        }
      } catch (err) {
        if (!this.isClosing) this.logger.error({ err }, "Worker loop error");
        await this.sleep(1000);
      }
    }
  }

  private async processDataTask(task: TaskItem<DocumentTask>) {
    if (task.type === "ADD") {
      await this.addDocument(
        task.payload.docId,
        task.payload.timestamp,
        task.payload.bodyText,
        task.payload.locale,
        task.payload.attrs,
        task.payload.labels,
        task.payload.numericValue,
      );
    } else if (task.type === "REMOVE") {
      await this.removeDocument(task.payload.docId, task.payload.timestamp);
    }

    const shard = await this.getShard(
      this.fileManager.getBucketTimestamp(task.payload.timestamp),
    );
    if (!shard.pendingBatchTaskIds.includes(task.id)) {
      shard.pendingBatchTaskIds.push(task.id);
    }
  }

  private async processControlTask(task: TaskItem<ManagementTask>) {
    if (task.type === "SYNC") {
      await this.synchronizeAllShards();
    } else if (task.type === "OPTIMIZE") {
      await this.optimizeShard(task.payload.targetTimestamp);
    } else if (task.type === "RESERVE") {
      await this.reserveIds(task.payload.documents);
    } else if (task.type === "RECONSTRUCT") {
      await this.reconstructIndexFile(
        task.payload.targetTimestamp,
        task.payload.newInitialId,
        task.payload.useExternalId,
      );
    } else if (task.type === "DROP_SHARD") {
      await this.removeIndexFile(task.payload.targetTimestamp);
    }
  }

  protected async addDocument(
    docId: string,
    timestamp: number,
    bodyText: string,
    locale: string,
    attrs: string | null,
    labelsInput: string[],
    numericValue: number | null,
  ) {
    if (numericValue !== null && !Number.isFinite(numericValue)) {
      throw new Error("numericValue must be a finite number or null");
    }
    const bucketTs = this.fileManager.getBucketTimestamp(timestamp);
    const shard = await this.getShard(bucketTs);
    if (shard.pendingTxCount === 0) {
      await shard.writer.exec("BEGIN");
      shard.lastTxStartTime = Date.now();
    }
    shard.pendingTxCount++;
    const labels = normalizeLabels(labelsInput);
    const labelsJson = JSON.stringify(labels);
    const labelsText = labels.join("\n");
    const existing = await shard.writer.get<{
      internal_id: number;
      labels_json: string;
      numeric_value: number | null;
      tokens: string | null;
      labels: string | null;
      attrs: string | null;
    }>(
      `SELECT t.internal_id,
              t.labels_json,
              t.numeric_value,
              d.tokens,
              d.labels,
              e.attrs
         FROM id_tuples t
         LEFT JOIN docs d ON d.rowid = t.internal_id
         LEFT JOIN extra_attrs e ON e.external_id = t.external_id
        WHERE t.external_id = ?`,
      [docId],
    );
    const internalId = existing
      ? existing.internal_id
      : ((
          await shard.writer.get<{ min_id: number | null }>(
            "SELECT MIN(internal_id) as min_id FROM id_tuples",
          )
        )?.min_id ?? this.config.initialDocumentId) - 1;
    const tokens = (
      await this.makeIndexableTokens(bodyText, locale, this.config.maxDocumentTokenCount)
    ).join("\n");
    const ftsChanged =
      !existing ||
      !shard.recordContents ||
      existing.tokens !== tokens ||
      existing.labels !== labelsText;
    if (ftsChanged) {
      await shard.writer.run(
        "INSERT OR REPLACE INTO docs (rowid, tokens, labels) VALUES (?, ?, ?)",
        [internalId, tokens, labelsText],
      );
    }
    if (!existing) {
      await shard.writer.run(
        "INSERT INTO id_tuples (internal_id, external_id, labels_json, numeric_value) VALUES (?, ?, ?, ?)",
        [internalId, docId, labelsJson, numericValue],
      );
    } else if (
      existing.labels_json !== labelsJson ||
      existing.numeric_value !== numericValue
    ) {
      await shard.writer.run(
        "UPDATE id_tuples SET labels_json = ?, numeric_value = ? WHERE internal_id = ?",
        [labelsJson, numericValue, internalId],
      );
    }
    if (attrs !== null && existing?.attrs !== attrs) {
      await shard.writer.run(
        "INSERT OR REPLACE INTO extra_attrs (external_id, attrs) VALUES (?, ?)",
        [docId, attrs],
      );
    } else if (attrs === null && existing?.attrs !== null && existing?.attrs !== undefined) {
      await shard.writer.run("DELETE FROM extra_attrs WHERE external_id = ?", [docId]);
    }
  }

  protected async removeDocument(docId: string, timestamp: number) {
    const shard = await this.getShard(this.fileManager.getBucketTimestamp(timestamp));
    if (shard.pendingTxCount === 0) {
      await shard.writer.exec("BEGIN");
      shard.lastTxStartTime = Date.now();
    }
    shard.pendingTxCount++;
    const existing = await shard.writer.get<{ internal_id: number }>(
      "SELECT internal_id FROM id_tuples WHERE external_id = ?",
      [docId],
    );
    if (existing) {
      await shard.writer.run("DELETE FROM docs WHERE rowid = ?", [existing.internal_id]);
      await shard.writer.run("DELETE FROM id_tuples WHERE internal_id = ?", [existing.internal_id]);
      await shard.writer.run("DELETE FROM extra_attrs WHERE external_id = ?", [docId]);
    }
  }

  protected async reserveIds(documents: { id: string; timestamp: number }[]) {
    const batches = new Map<number, string[]>();
    for (const doc of documents) {
      const bucketTs = this.fileManager.getBucketTimestamp(doc.timestamp);
      if (!batches.has(bucketTs)) batches.set(bucketTs, []);
      batches.get(bucketTs)!.push(doc.id);
    }
    for (const [bucketTs, ids] of batches) {
      const shard = await this.getShard(bucketTs);
      await this.commitShard(shard);
      await shard.writer.exec("BEGIN");
      const minRow = await shard.writer.get<{ min_id: number | null }>(
        "SELECT MIN(internal_id) as min_id FROM id_tuples",
      );
      let nextId = (minRow?.min_id ?? this.config.initialDocumentId) - 1;
      for (const id of ids) {
        await shard.writer.run(
          "INSERT OR IGNORE INTO id_tuples (internal_id, external_id) VALUES (?, ?)",
          [nextId, id],
        );
        nextId--;
      }
      await shard.writer.exec("COMMIT");
    }
  }

  private async removeCommittedBatchTasks(shard: ShardConnection) {
    while (shard.committedBatchTaskIds.length > 0) {
      const taskId = shard.committedBatchTaskIds[0];
      await this.docQueue.removeFromBatch(taskId);
      shard.committedBatchTaskIds.shift();
    }
  }

  private async commitShard(shard: ShardConnection) {
    if (shard.isCommitting) return;
    shard.isCommitting = true;
    try {
      if (shard.pendingTxCount > 0) {
        // Keep batch_tasks durable until the corresponding index transaction commits.
        await shard.writer.exec("COMMIT");
        shard.pendingTxCount = 0;
        shard.lastTxStartTime = 0;
        shard.committedBatchTaskIds.push(...shard.pendingBatchTaskIds);
        shard.pendingBatchTaskIds.length = 0;
      }
      await this.removeCommittedBatchTasks(shard);
    } finally {
      shard.isCommitting = false;
    }
  }

  protected async synchronizeAllShards() {
    for (const shard of this.shards.values()) {
      await this.commitShard(shard);
    }
  }

  protected async optimizeShard(timestamp: number) {
    const shard = await this.getShard(this.fileManager.getBucketTimestamp(timestamp));
    await this.commitShard(shard);
    await shard.writer.exec("INSERT INTO docs(docs) VALUES('optimize'); VACUUM;");
  }

  protected async removeIndexFile(bucketTimestamp: number) {
    const shard = this.shards.get(bucketTimestamp);
    if (shard) {
      await shard.writer.close();
      for (const r of shard.readers) await r.db.close();
      this.shards.delete(bucketTimestamp);
    }
    await this.fileManager.removeIndexFile(bucketTimestamp);
  }

  protected async reconstructIndexFile(
    timestamp: number,
    newInitialId = 268435455,
    useExternalId = false,
  ) {
    const bucketTs = this.fileManager.getBucketTimestamp(timestamp);
    const shard = await this.getShard(bucketTs);
    await this.commitShard(shard);
    const oldPath = this.fileManager.getFilePath(bucketTs),
      tempPath = `${oldPath}.rebuild`;
    try {
      await fs.unlink(tempPath);
    } catch {}
    const tempDb = await Database.open(tempPath);
    await tempDb.exec(`PRAGMA page_size = ${DB_PAGE_SIZE_BYTES};`);
    await this.setupSchema(tempDb, shard.recordPositions, shard.recordContents);
    const rows = await shard.writer.all<{
      external_id: string;
      tokens: string;
      labels: string;
      labels_json: string;
      numeric_value: number | null;
      attrs: string | null;
    }>(
      `SELECT t.external_id,
              d.tokens,
              d.labels,
              t.labels_json,
              t.numeric_value,
              e.attrs
         FROM id_tuples t
         JOIN docs d ON t.internal_id = d.rowid
         LEFT JOIN extra_attrs e ON t.external_id = e.external_id
        ORDER BY ${useExternalId ? "t.external_id ASC" : "t.internal_id DESC"}`,
    );
    await tempDb.exec("BEGIN");
    let currentId = newInitialId;
    for (const row of rows) {
      await tempDb.run(
        "INSERT INTO id_tuples (internal_id, external_id, labels_json, numeric_value) VALUES (?, ?, ?, ?)",
        [currentId, row.external_id, row.labels_json, row.numeric_value],
      );
      await tempDb.run("INSERT INTO docs (rowid, tokens, labels) VALUES (?, ?, ?)", [
        currentId,
        row.tokens,
        row.labels,
      ]);
      if (row.attrs)
        await tempDb.run("INSERT INTO extra_attrs (external_id, attrs) VALUES (?, ?)", [
          row.external_id,
          row.attrs,
        ]);
      currentId--;
    }
    await tempDb.exec("COMMIT");
    await tempDb.exec("INSERT INTO docs(docs) VALUES('optimize')");
    await tempDb.close();
    await shard.writer.close();
    for (const r of shard.readers) await r.db.close();
    this.shards.delete(bucketTs);
    await fs.rename(tempPath, oldPath);
    try {
      await fs.unlink(`${oldPath}-wal`);
    } catch {}
    await this.getShard(bucketTs);
  }

  private async commitShardIfNeeded(shard: ShardConnection, now: number) {
    if (shard.pendingTxCount > 0) {
      const elapsed = now - shard.lastTxStartTime;
      if (
        shard.pendingTxCount >= this.config.autoCommitUpdateCount ||
        elapsed >= this.config.autoCommitDurationSeconds * 1000
      ) {
        await this.commitShard(shard);
      }
    } else if (shard.committedBatchTaskIds.length > 0) {
      await this.removeCommittedBatchTasks(shard);
    }
  }

  private async checkLatestAutoCommit() {
    if (this.latestShardTimestamp === 0) return;
    const now = Date.now();
    const shard = this.shards.get(this.latestShardTimestamp);
    if (shard) {
      await this.commitShardIfNeeded(shard, now);
    }
  }

  private async checkAllAutoCommit() {
    const now = Date.now();
    for (const shard of this.shards.values()) {
      await this.commitShardIfNeeded(shard, now);
    }
  }

  private async getShard(timestamp: number): Promise<ShardConnection> {
    const ts = this.fileManager.getBucketTimestamp(timestamp);
    const existing = this.shards.get(ts);
    if (existing) return existing;
    if (this.shardOpeningPromises.has(ts)) return this.shardOpeningPromises.get(ts)!;
    const promise = (async () => {
      const writer = await Database.open(this.fileManager.getFilePath(ts));
      await writer.exec(`PRAGMA page_size = ${DB_PAGE_SIZE_BYTES};`);
      await this.setupStaticPragmas(writer);
      const meta = await writer
        .get<{ record_positions: number; record_contents: number }>(
          `SELECT
             (SELECT v FROM fts_meta WHERE k = 'record_positions') as record_positions,
             (SELECT v FROM fts_meta WHERE k = 'record_contents') as record_contents`,
        )
        .catch(() => null);
      const rp =
        meta?.record_positions !== undefined
          ? !!meta.record_positions
          : this.config.recordPositions;
      const rc =
        meta?.record_contents !== undefined ? !!meta.record_contents : this.config.recordContents;
      if (!meta) await this.setupSchema(writer, rp, rc);
      const shard: ShardConnection = {
        writer,
        readers: [],
        currentReaderIndex: 0,
        pendingTxCount: 0,
        lastTxStartTime: 0,
        isCommitting: false,
        pendingBatchTaskIds: [],
        committedBatchTaskIds: [],
        recordPositions: rp,
        recordContents: rc,
      };
      this.shards.set(ts, shard);
      return shard;
    })();
    this.shardOpeningPromises.set(ts, promise);
    try {
      return await promise;
    } finally {
      this.shardOpeningPromises.delete(ts);
    }
  }

  private selectReader(shard: ShardConnection): Database {
    if (shard.readers.length === 0) return shard.writer;
    const r = shard.readers[shard.currentReaderIndex];
    shard.currentReaderIndex = (shard.currentReaderIndex + 1) % shard.readers.length;
    return r.db;
  }

  public async updateShardConfigs() {
    const releaseWrite = await this.serviceLock.acquireWrite();
    try {
      await this.updateShardConfigsInternal();
    } finally {
      releaseWrite();
    }
  }

  private async updateShardConfigsInternal() {
    const files = await this.fileManager.listIndexFiles(true);
    for (const f of files) {
      if (!f.isHealthy) continue;
      if (!this.shards.has(f.startTimestamp)) {
        await this.getShard(f.startTimestamp);
      }
    }

    const tss = Array.from(this.shards.keys()).sort((a, b) => b - a);
    for (let i = 0; i < tss.length; i++) {
      const ts = tss[i],
        shard = this.shards.get(ts)!;
      const count = this.getValueByGeneration(this.config.readConnectionCounts, i),
        mmap = this.getValueByGeneration(this.config.mmapSizes, i),
        cache = this.getValueByGeneration(this.config.cacheSizes, i),
        merge = this.getValueByGeneration(this.config.automergeLevels, i);
      while (shard.readers.length < count) {
        const r = await Database.open(this.fileManager.getFilePath(ts), sqlite3.OPEN_READONLY);
        await this.setupStaticPragmas(r);
        shard.readers.push({ db: r });
      }
      while (shard.readers.length > count) {
        const r = shard.readers.pop();
        if (r) await r.db.close();
      }
      await this.applyDynamicConfig(shard.writer, mmap, cache, merge, true);
      for (const r of shard.readers) await this.applyDynamicConfig(r.db, mmap, cache, merge, false);
    }
  }

  private async makeIndexableTokens(
    text: string,
    locale: string,
    maxCount: number,
  ): Promise<string[]> {
    const tokenizer = await Tokenizer.getInstance();
    return tokenizer
      .tokenize(text, locale)
      .map((t) => t.trim())
      .filter((t) => t.length > 0)
      .slice(0, maxCount);
  }

  private async setupStaticPragmas(db: Database) {
    await db.exec(
      `PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; PRAGMA busy_timeout = ${BUSY_TIMEOUT_MS};`,
    );
  }

  private async applyDynamicConfig(
    db: Database,
    mmap: number,
    cache: number,
    merge: number,
    isWriter: boolean,
  ) {
    await db.exec(
      `PRAGMA cache_size = ${Math.floor(cache / 1024) * -1}; PRAGMA mmap_size = ${mmap};`,
    );
    if (isWriter) {
      await db.exec(`PRAGMA journal_size_limit = ${WAL_MAX_SIZE_BYTES};`);
      await db
        .exec(`INSERT INTO docs(docs, rank) VALUES('automerge', ${merge});`)
        .catch((e) => this.logger.warn({ err: e }, "Failed to set automerge"));
    }
  }

  private async setupSchema(db: Database, rp: boolean, rc: boolean) {
    await db.exec("BEGIN");
    try {
      await db.exec(`CREATE TABLE IF NOT EXISTS id_tuples (
                        internal_id INTEGER PRIMARY KEY,
                        external_id TEXT UNIQUE,
                        labels_json TEXT NOT NULL DEFAULT '[]',
                        numeric_value REAL
                      );
                      CREATE TABLE IF NOT EXISTS extra_attrs (external_id TEXT PRIMARY KEY, attrs TEXT);
                      CREATE TABLE IF NOT EXISTS fts_meta (k TEXT PRIMARY KEY, v INTEGER);`);
      await db.run(
        `INSERT OR IGNORE INTO fts_meta (k, v) VALUES
          ('record_positions', ?),
          ('record_contents', ?);`,
        [rp ? 1 : 0, rc ? 1 : 0],
      );
      await db.exec(
        `CREATE VIRTUAL TABLE IF NOT EXISTS docs USING fts5(
          tokens,
          labels,
          tokenize = "unicode61 categories 'L* N* Co M* P* S*' remove_diacritics 0 tokenchars ' '",
          detail = '${rp ? "full" : "column"}',
          ${rc ? "" : "content='', contentless_delete=1,"}
        );`,
      );
      await db.exec(`INSERT INTO docs(docs, rank) VALUES('pgsz', ${FTS_BLOCK_SIZE_BYTES});`);
      await db.exec("COMMIT");
    } catch (e) {
      await db.exec("ROLLBACK");
      throw e;
    }
  }

  private getValueByGeneration<T>(arr: T[], gen: number): T {
    return gen < arr.length ? arr[gen] : arr[arr.length - 1];
  }
  private sleep(ms: number) {
    return new Promise((r) => setTimeout(r, ms));
  }
}
