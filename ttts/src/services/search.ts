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
import { makeFtsQuery } from "../utils/query";

const DB_PAGE_SIZE_BYTES = 8192;
const FTS_BLOCK_SIZE_BYTES = 8000;
const WAL_MAX_SIZE_BYTES = 67108864;
const BUSY_TIMEOUT_MS = 5000;

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

    const files = await this.fileManager.listIndexFiles();
    if (files.length > 0) this.latestShardTimestamp = files[0].startTimestamp;
    for (const file of files) {
      if (this.isClosing) break;
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
          } finally {
            await this.docQueue.removeFromBatch(task.id);
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
  async listIndexFiles(detailed: boolean = false): Promise<IndexFileInfo[]> {
    return this.fileManager.listIndexFiles(detailed);
  }

  async enqueueTask(task: SearchTask): Promise<string> {
    return task.type === "ADD" || task.type === "REMOVE"
      ? this.docQueue.enqueue(task)
      : this.mgmtQueue.enqueue(task);
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
      if (elapsed >= effectiveTimeout) throw new Error(`Timeout waiting for task ${id}`);
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
  ): Promise<string[]> {
    if (!this.isOpen) throw new Error("Service not open");
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

        const db = this.selectReader(shard);
        let sql = `SELECT t.external_id FROM docs JOIN id_tuples t ON docs.rowid = t.internal_id WHERE docs MATCH ?`;
        const params: (string | number)[] = [ftsQuery];
        if (shard.recordContents) {
          for (const phrase of filteringPhrases) {
            sql += ` AND docs.tokens LIKE ?`;
            params.push(`%${phrase}%`);
          }
        }
        sql += ` ORDER BY docs.rowid ASC LIMIT ?`;
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
      const results: { id: string; bodyText: string | null; attrs: string | null }[] = [];
      const needed = new Set(ids);
      const sortedTs = Array.from(this.shards.keys()).sort((a, b) => b - a);
      for (const ts of sortedTs) {
        if (needed.size === 0 || this.isClosing) break;
        const shard = await this.getShard(ts);
        const db = this.selectReader(shard);
        const batch = Array.from(needed);
        const placeholders = batch.map(() => "?").join(",");
        const rows = await db.all<{ id: string; bodyText: string | null; attrs: string | null }>(
          `SELECT t.external_id as id, ${omitBodyText ? "NULL" : "d.tokens"} as bodyText, ${omitAttrs ? "NULL" : "e.attrs"} as attrs
           FROM id_tuples t JOIN docs d ON t.internal_id = d.rowid LEFT JOIN extra_attrs e ON t.external_id = e.external_id
           WHERE t.external_id IN (${placeholders})`,
          batch,
        );
        rows.forEach((r) => {
          results.push(r);
          needed.delete(r.id);
        });
      }
      return results;
    } finally {
      releaseRead();
    }
  }

  private async workerLoop(): Promise<void> {
    while (this.workerRunning) {
      try {
        const mgmtTask = await this.mgmtQueue.fetchFirst();
        if (mgmtTask) {
          try {
            await this.processControlTask(mgmtTask);
          } catch (e) {
            this.logger.error(
              { err: e, taskId: mgmtTask.id, type: mgmtTask.type },
              "Worker mgmt task failed",
            );
          } finally {
            await this.mgmtQueue.removeFromInput(mgmtTask.id);
          }
          continue;
        }
        if (this.maintenanceMode) {
          await this.sleep(100);
          continue;
        }

        const docTask = await this.docQueue.fetchFirst();
        if (docTask) {
          await this.docQueue.moveToBatch(docTask);
          const releaseRead = await this.serviceLock.acquireRead();
          try {
            await this.processDataTask(docTask);
          } catch (e) {
            this.logger.error({ err: e, taskId: docTask.id }, "Worker doc task failed");
          } finally {
            releaseRead();
            await this.docQueue.removeFromBatch(docTask.id);
          }
          await this.sleep(this.config.updateWorkerBusySleepSeconds * 1000);
          continue;
        }
        await this.sleep(this.config.updateWorkerIdleSleepSeconds * 1000);
        if (!this.maintenanceMode && !this.isClosing) {
          const releaseRead = await this.serviceLock.acquireRead();
          try {
            await this.checkAutoCommit();
          } finally {
            releaseRead();
          }
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
        task.payload.attrs ?? null,
      );
    } else if (task.type === "REMOVE") {
      await this.removeDocument(task.payload.docId, task.payload.timestamp);
    }
  }

  private async processControlTask(task: TaskItem<ManagementTask>) {
    if (task.type === "SYNC") {
      const rel = await this.serviceLock.acquireRead();
      try {
        await this.synchronizeAllShards();
      } finally {
        rel();
      }
    } else if (task.type === "OPTIMIZE") {
      const rel = await this.serviceLock.acquireRead();
      try {
        await this.optimizeShard(task.payload.targetTimestamp);
      } finally {
        rel();
      }
    } else if (task.type === "RESERVE") {
      const rel = await this.serviceLock.acquireRead();
      try {
        await this.reserveIds(task.payload.documents);
      } finally {
        rel();
      }
    } else if (task.type === "RECONSTRUCT") {
      const rel = await this.serviceLock.acquireWrite();
      try {
        await this.reconstructIndexFile(
          task.payload.targetTimestamp,
          task.payload.newInitialId,
          task.payload.useExternalId,
        );
      } finally {
        rel();
      }
    } else if (task.type === "DROP_SHARD") {
      const rel = await this.serviceLock.acquireWrite();
      try {
        await this.removeIndexFile(task.payload.targetTimestamp);
      } finally {
        rel();
      }
    }
  }

  protected async addDocument(
    docId: string,
    timestamp: number,
    bodyText: string,
    locale: string,
    attrs: string | null,
  ) {
    const bucketTs = this.fileManager.getBucketTimestamp(timestamp);
    if (bucketTs > this.latestShardTimestamp) {
      this.latestShardTimestamp = bucketTs;
      await this.getShard(bucketTs);
    }
    const shard = await this.getShard(bucketTs);
    if (shard.pendingTxCount === 0) {
      await shard.writer.exec("BEGIN");
      shard.lastTxStartTime = Date.now();
    }
    shard.pendingTxCount++;
    const existing = await shard.writer.get<{ internal_id: number }>(
      "SELECT internal_id FROM id_tuples WHERE external_id = ?",
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
    ).join(" ");
    await shard.writer.run("INSERT OR REPLACE INTO docs (rowid, tokens) VALUES (?, ?)", [
      internalId,
      tokens,
    ]);
    if (!existing)
      await shard.writer.run("INSERT INTO id_tuples (internal_id, external_id) VALUES (?, ?)", [
        internalId,
        docId,
      ]);
    if (attrs)
      await shard.writer.run(
        "INSERT OR REPLACE INTO extra_attrs (external_id, attrs) VALUES (?, ?)",
        [docId, attrs],
      );
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
      if (shard.pendingTxCount > 0) {
        await shard.writer.exec("COMMIT");
        shard.pendingTxCount = 0;
        shard.lastTxStartTime = 0;
      }
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

  protected async synchronizeAllShards() {
    for (const shard of this.shards.values()) {
      if (shard.pendingTxCount > 0 && !shard.isCommitting) {
        shard.isCommitting = true;
        try {
          await shard.writer.exec("COMMIT");
          shard.pendingTxCount = 0;
          shard.lastTxStartTime = 0;
        } finally {
          shard.isCommitting = false;
        }
      }
    }
  }

  protected async optimizeShard(timestamp: number) {
    const shard = await this.getShard(this.fileManager.getBucketTimestamp(timestamp));
    if (shard.pendingTxCount > 0) {
      await shard.writer.exec("COMMIT");
      shard.pendingTxCount = 0;
    }
    await shard.writer.exec("INSERT INTO docs(docs) VALUES('optimize'); VACUUM;");
  }

  protected async removeIndexFile(timestamp: number) {
    const bucketTs = this.fileManager.getBucketTimestamp(timestamp);
    const shard = this.shards.get(bucketTs);
    if (shard) {
      await shard.writer.close();
      for (const r of shard.readers) await r.db.close();
      this.shards.delete(bucketTs);
    }
    await this.fileManager.removeIndexFile(bucketTs);
  }

  protected async reconstructIndexFile(
    timestamp: number,
    newInitialId = 268435455,
    useExternalId = false,
  ) {
    const bucketTs = this.fileManager.getBucketTimestamp(timestamp);
    const shard = await this.getShard(bucketTs);
    if (shard.pendingTxCount > 0) await shard.writer.exec("COMMIT");
    const oldPath = this.fileManager.getFilePath(bucketTs),
      tempPath = `${oldPath}.rebuild`;
    try {
      await fs.unlink(tempPath);
    } catch {}
    const tempDb = await Database.open(tempPath);
    await tempDb.exec(`PRAGMA page_size = ${DB_PAGE_SIZE_BYTES};`);
    await this.setupSchema(tempDb, shard.recordPositions, shard.recordContents);
    const rows = await shard.writer.all<{ external_id: string; tokens: string; attrs: string }>(
      `SELECT t.external_id, d.tokens, e.attrs FROM id_tuples t JOIN docs d ON t.internal_id = d.rowid LEFT JOIN extra_attrs e ON t.external_id = e.external_id ORDER BY ${useExternalId ? "t.external_id ASC" : "t.internal_id DESC"}`,
    );
    await tempDb.exec("BEGIN");
    let currentId = newInitialId;
    for (const row of rows) {
      await tempDb.run("INSERT INTO id_tuples (internal_id, external_id) VALUES (?, ?)", [
        currentId,
        row.external_id,
      ]);
      await tempDb.run("INSERT INTO docs (rowid, tokens) VALUES (?, ?)", [currentId, row.tokens]);
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

  private async checkAutoCommit() {
    for (const shard of this.shards.values()) {
      if (shard.pendingTxCount > 0) {
        const elapsed = Date.now() - shard.lastTxStartTime;
        if (
          shard.pendingTxCount >= this.config.autoCommitUpdateCount ||
          elapsed >= this.config.autoCommitDurationSeconds * 1000
        ) {
          await shard.writer.exec("COMMIT");
          shard.pendingTxCount = 0;
          shard.lastTxStartTime = 0;
        }
      }
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
        .get<{
          record_positions: number;
          record_contents: number;
        }>("SELECT (SELECT v FROM fts_meta WHERE k = 'record_positions') as record_positions, (SELECT v FROM fts_meta WHERE k = 'record_contents') as record_contents")
        .catch(() => null);
      let rp =
        meta?.record_positions !== undefined
          ? !!meta.record_positions
          : this.config.recordPositions;
      let rc =
        meta?.record_contents !== undefined ? !!meta.record_contents : this.config.recordContents;
      if (!meta) await this.setupSchema(writer, rp, rc);
      const shard: ShardConnection = {
        writer,
        readers: [],
        currentReaderIndex: 0,
        pendingTxCount: 0,
        lastTxStartTime: 0,
        isCommitting: false,
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

  private async updateShardConfigs() {
    const releaseWrite = await this.serviceLock.acquireWrite();
    try {
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
        for (const r of shard.readers)
          await this.applyDynamicConfig(r.db, mmap, cache, merge, false);
      }
    } finally {
      releaseWrite();
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
      await db.exec(`CREATE TABLE IF NOT EXISTS id_tuples (internal_id INTEGER PRIMARY KEY, external_id TEXT UNIQUE);
                     CREATE TABLE IF NOT EXISTS extra_attrs (external_id TEXT PRIMARY KEY, attrs TEXT);
                     CREATE TABLE IF NOT EXISTS fts_meta (k TEXT PRIMARY KEY, v INTEGER);`);
      await db.run(
        `INSERT OR IGNORE INTO fts_meta (k, v) VALUES ('record_positions', ?), ('record_contents', ?);`,
        [rp ? 1 : 0, rc ? 1 : 0],
      );
      await db.exec(
        `CREATE VIRTUAL TABLE IF NOT EXISTS docs USING fts5(tokens, tokenize = "unicode61", detail = '${rp ? "full" : "none"}', ${rc ? "" : "content='',"});`,
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
