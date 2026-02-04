import fs from "fs/promises";
import sqlite3 from "sqlite3";
import { Database } from "../utils/database";
import { Tokenizer } from "../utils/tokenizer";
import { Logger } from "pino";
import { TaskQueue } from "./taskQueue";
import { IndexFileManager } from "./indexFileManager";
import { makeFtsQuery } from "../utils/query";

const DB_PAGE_SIZE_BYTES = 8192;
const WAL_MAX_SIZE_BYTES = 67108864;

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

export type IndexFileInfo = {
  filename: string;
  fileSize: number;
  walSize: number;
  totalDatabaseSize: number;
  indexSize: number;
  contentSize: number;
  countDocuments: number;
  startTimestamp: number;
  endTimestamp: number;
  isHealthy: boolean;
};

export type IndexTask = {
  id: number;
  docId: string;
  timestamp: number;
  bodyText: string | null;
  locale: string | null;
  attrs: string | null;
};

type ShardConnection = {
  writer: Database;
  readers: Database[];
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
  private config: SearchConfig;
  private logger: Logger;
  private taskQueue: TaskQueue;
  private fileManager: IndexFileManager;
  private isOpen: boolean = false;
  private isClosing: boolean = false;
  private maintenanceMode: boolean = false;
  private workerPromise: Promise<void> | null = null;
  private workerRunning: boolean = false;
  private shards: Map<number, ShardConnection> = new Map();
  private latestShardTimestamp: number = 0;
  private lastAutoCommitCheckTime: number = 0;

  constructor(config: SearchConfig, logger: Logger) {
    this.config = config;
    this.logger = logger;
    this.taskQueue = new TaskQueue(config);
    this.fileManager = new IndexFileManager(config);
  }

  async open(options: OpenOptions = {}): Promise<void> {
    if (this.isOpen) return;
    await fs.mkdir(this.config.baseDir, { recursive: true });
    await this.taskQueue.open();
    const files = await this.fileManager.listIndexFiles();
    if (files.length > 0) {
      this.latestShardTimestamp = files[0].startTimestamp;
    }
    this.isOpen = true;
    for (const file of files) {
      await this.getShard(file.startTimestamp);
    }
    let task;
    while ((task = await this.taskQueue.dequeue())) {
      await this.processTask(task);
      await this.taskQueue.complete(task.id);
    }
    await this.synchronize();
    await this.updateShardConfigs();
    if (options.startWorker !== false) {
      this.workerRunning = true;
      this.workerPromise = this.workerLoop();
      this.logger.info(`SearchService opened: ${this.config.namePrefix}`);
    }
  }

  async close(): Promise<void> {
    if (!this.isOpen || this.isClosing) return;
    this.isClosing = true;
    this.workerRunning = false;
    if (this.workerPromise) await this.workerPromise;
    await this.synchronize();
    for (const shard of this.shards.values()) {
      await this.closeShard(shard);
    }
    this.shards.clear();
    await this.taskQueue.close();
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

  async removeAllIndexFiles(): Promise<void> {
    await this.ensureMaintenanceMode();
    for (const shard of this.shards.values()) {
      await this.closeShard(shard);
    }
    this.shards.clear();
    await this.fileManager.removeAllIndexFiles();
    this.latestShardTimestamp = 0;
  }

  async removeIndexFile(timestamp: number): Promise<void> {
    await this.ensureMaintenanceMode();
    const bucketTs = this.fileManager.getBucketTimestamp(timestamp);
    const shard = this.shards.get(bucketTs);
    if (shard) {
      await this.closeShard(shard);
      this.shards.delete(bucketTs);
    }
    await this.fileManager.removeIndexFile(bucketTs);
    const files = await this.fileManager.listIndexFiles();
    this.latestShardTimestamp = files.length > 0 ? files[0].startTimestamp : 0;
    await this.updateShardConfigs();
  }

  async reconstructIndexFile(
    timestamp: number,
    newInitialId: number = 268435455,
    useExternalId: boolean = false,
  ): Promise<void> {
    await this.ensureMaintenanceMode();
    const bucketTs = this.fileManager.getBucketTimestamp(timestamp);
    const shard = await this.getShard(bucketTs);
    const oldFilepath = this.fileManager.getFilePath(bucketTs);
    const tempFilepath = `${oldFilepath}.rebuild`;
    await this.deleteFileSet(tempFilepath, false);
    const tempDb = await Database.open(tempFilepath);
    await this.setupSchema(tempDb, this.config.recordPositions, this.config.recordContents);

    const orderBy = useExternalId ? "t.external_id ASC" : "t.internal_id DESC";
    let currentNewId = newInitialId;
    let offset = 0;
    while (true) {
      const rows = await shard.writer.all<{ external_id: string; tokens: string; attrs: string }>(
        `SELECT t.external_id, d.tokens, e.attrs FROM id_tuples t JOIN docs d ON t.internal_id = d.rowid LEFT JOIN extra_attrs e ON t.external_id = e.external_id ORDER BY ${orderBy} LIMIT 10000 OFFSET ${offset}`,
      );
      if (rows.length === 0) break;
      await tempDb.exec("BEGIN");
      for (const row of rows) {
        await tempDb.run("INSERT INTO id_tuples (internal_id, external_id) VALUES (?, ?)", [
          currentNewId,
          row.external_id,
        ]);
        await tempDb.run("INSERT INTO docs (rowid, tokens) VALUES (?, ?)", [
          currentNewId,
          row.tokens,
        ]);
        if (row.attrs)
          await tempDb.run("INSERT INTO extra_attrs (external_id, attrs) VALUES (?, ?)", [
            row.external_id,
            row.attrs,
          ]);
        currentNewId--;
      }
      await tempDb.exec("COMMIT");
      offset += rows.length;
    }
    await tempDb.exec("INSERT INTO docs(docs) VALUES('optimize')");
    await tempDb.close();
    await this.closeShard(shard);
    this.shards.delete(bucketTs);
    await fs.rename(tempFilepath, oldFilepath);
    await this.deleteFileSet(oldFilepath + "-wal", false);
    await this.getShard(bucketTs);
    await this.updateShardConfigs();
  }

  async optimizeShard(timestamp: number): Promise<void> {
    const bucketTs = this.fileManager.getBucketTimestamp(timestamp);
    const shard = await this.getShard(bucketTs);
    await this.synchronize();
    await shard.writer.exec("INSERT INTO docs(docs) VALUES('optimize')");
    await shard.writer.exec("VACUUM");
  }

  async synchronize(): Promise<void> {
    for (const shard of this.shards.values()) {
      if (shard.pendingTxCount > 0 && !shard.isCommitting) {
        shard.isCommitting = true;
        try {
          await shard.writer.exec("COMMIT");
          shard.pendingTxCount = 0;
          shard.lastTxStartTime = 0;
          for (const r of shard.readers) {
            await r.exec("BEGIN; ROLLBACK;").catch(() => {});
          }
        } finally {
          shard.isCommitting = false;
        }
      }
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
          await makeFtsQuery(query, locale, this.config.maxQueryTokenCount, shard.recordPositions),
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
  }

  async fetchDocuments(ids: string[], omitBodyText = false, omitAttrs = false) {
    if (!this.isOpen) throw new Error("Service not open");
    const results: { id: string; bodyText: string | null; attrs: string | null }[] = [];
    const needed = new Set(ids);
    const sortedTs = Array.from(this.shards.keys()).sort((a, b) => b - a);
    for (const ts of sortedTs) {
      if (needed.size === 0) break;
      const shard = await this.getShard(ts);
      const db = this.selectReader(shard);
      const batch = Array.from(needed);
      const placeholders = batch.map(() => "?").join(",");
      const rows = await db.all<{ id: string; bodyText: string | null; attrs: string | null }>(
        `SELECT t.external_id as id, ${omitBodyText ? "NULL" : "d.tokens"} as bodyText, ${omitAttrs ? "NULL" : "e.attrs"} as attrs FROM id_tuples t JOIN docs d ON t.internal_id = d.rowid LEFT JOIN extra_attrs e ON t.external_id = e.external_id WHERE t.external_id IN (${placeholders})`,
        batch,
      );
      rows.forEach((r) => {
        results.push(r);
        needed.delete(r.id);
      });
    }
    return results;
  }

  async enqueueTask(
    docId: string,
    timestamp: number,
    bodyText: string | null,
    locale: string | null,
    attrs: string | null,
  ) {
    await this.taskQueue.enqueue(docId, timestamp, bodyText, locale, attrs);
  }

  async reserveIds(items: { id: string; timestamp: number }[]) {
    await this.ensureMaintenanceMode();
    for (const item of items) {
      const shard = await this.getShard(this.fileManager.getBucketTimestamp(item.timestamp));
      await shard.writer.exec("BEGIN TRANSACTION");
      const minRow = await shard.writer.get<{ min_id: number | null }>(
        "SELECT MIN(internal_id) as min_id FROM id_tuples",
      );
      const nextId = (minRow?.min_id ?? this.config.initialDocumentId) - 1;
      await shard.writer.run(
        "INSERT OR IGNORE INTO id_tuples (internal_id, external_id) VALUES (?, ?)",
        [nextId, item.id],
      );
      await shard.writer.exec("COMMIT");
    }
  }

  private async workerLoop(): Promise<void> {
    while (this.workerRunning) {
      if (this.maintenanceMode) {
        await this.sleep(100);
        continue;
      }
      try {
        const task = await this.taskQueue.dequeue();
        if (task) {
          if (this.maintenanceMode) {
            await this.sleep(100);
            continue;
          }
          await this.processTask(task);
          await this.taskQueue.complete(task.id);
          await this.sleep(this.config.updateWorkerBusySleepSeconds * 1000);
        } else {
          await this.sleep(this.config.updateWorkerIdleSleepSeconds * 1000);
        }
        if (
          Date.now() - this.lastAutoCommitCheckTime >=
          this.config.commitCheckIntervalSeconds * 1000
        ) {
          await this.checkAutoCommit();
          this.lastAutoCommitCheckTime = Date.now();
        }
      } catch {
        await this.sleep(this.config.updateWorkerIdleSleepSeconds * 1000);
      }
    }
  }

  private async processTask(task: IndexTask) {
    if (task.bodyText === null) {
      await this.removeDocument(task.docId, task.timestamp);
    } else {
      await this.addDocument(
        task.docId,
        task.timestamp,
        task.bodyText,
        task.locale || "en",
        task.attrs,
      );
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
      await this.synchronize();
      this.latestShardTimestamp = bucketTs;
      await this.getShard(bucketTs);
      await this.updateShardConfigs();
    }
    const shard = await this.getShard(bucketTs);
    await this.ensureTransaction(shard);
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
    await this.ensureTransaction(shard);
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

  private async getShard(timestamp: number): Promise<ShardConnection> {
    const ts = this.fileManager.getBucketTimestamp(timestamp);
    let shard = this.shards.get(ts);
    if (shard) return shard;
    const writer = await Database.open(this.fileManager.getFilePath(ts));
    await this.setupStaticPragmas(writer);

    const meta = await writer
      .get<{
        record_positions: number;
        record_contents: number;
      }>("SELECT (SELECT v FROM fts_meta WHERE k = 'record_positions') as record_positions, (SELECT v FROM fts_meta WHERE k = 'record_contents') as record_contents")
      .catch(() => null);

    let rp: boolean, rc: boolean;
    if (meta && meta.record_positions !== null) {
      rp = !!meta.record_positions;
      rc = !!meta.record_contents;
    } else {
      rp = this.config.recordPositions;
      rc = this.config.recordContents;
      await this.setupSchema(writer, rp, rc);
    }

    shard = {
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
  }

  private async updateShardConfigs() {
    const tss = Array.from(this.shards.keys()).sort((a, b) => b - a);
    for (let i = 0; i < tss.length; i++) {
      const shard = this.shards.get(tss[i])!;
      const count = this.getValueByGeneration(this.config.readConnectionCounts, i);
      const mmap = this.getValueByGeneration(this.config.mmapSizes, i);
      const cache = this.getValueByGeneration(this.config.cacheSizes, i);
      const merge = this.getValueByGeneration(this.config.automergeLevels, i);
      while (shard.readers.length < count) {
        const r = await Database.open(this.fileManager.getFilePath(tss[i]), sqlite3.OPEN_READONLY);
        await this.setupStaticPragmas(r);
        shard.readers.push(r);
      }
      while (shard.readers.length > count) {
        await shard.readers.pop()?.close();
      }
      await this.applyDynamicConfig(shard.writer, mmap, cache, merge, true);
      for (const r of shard.readers) await this.applyDynamicConfig(r, mmap, cache, merge, false);
    }
  }

  private async setupStaticPragmas(db: Database) {
    await db.exec("PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL;");
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
        .exec(`INSERT OR REPLACE INTO docs_config(k, v) VALUES('automerge', ${merge});`)
        .catch(() => {});
    }
  }

  private async setupSchema(db: Database, recordPositions: boolean, recordContents: boolean) {
    await db.exec("BEGIN");
    try {
      await db.exec(
        `CREATE TABLE IF NOT EXISTS id_tuples (internal_id INTEGER PRIMARY KEY, external_id TEXT UNIQUE);`,
      );
      await db.exec(
        `CREATE TABLE IF NOT EXISTS extra_attrs (external_id TEXT PRIMARY KEY, attrs TEXT);`,
      );
      await db.exec(`CREATE TABLE IF NOT EXISTS fts_meta (k TEXT PRIMARY KEY, v INTEGER);`);
      await db.run(
        `INSERT OR IGNORE INTO fts_meta (k, v) VALUES ('record_positions', ?), ('record_contents', ?);`,
        [recordPositions ? 1 : 0, recordContents ? 1 : 0],
      );

      const content = recordContents ? "" : "content='',";
      const detail = recordPositions ? "full" : "none";
      await db.exec(
        `CREATE VIRTUAL TABLE IF NOT EXISTS docs USING fts5(tokens, tokenize = "unicode61", detail = '${detail}', ${content});`,
      );
      await db
        .exec(`INSERT OR REPLACE INTO docs_config(k, v) VALUES('pgsz', ${DB_PAGE_SIZE_BYTES});`)
        .catch(() => {});
      await db.exec("COMMIT");
    } catch (e) {
      await db.exec("ROLLBACK");
      throw e;
    }
  }

  private selectReader(shard: ShardConnection) {
    if (shard.readers.length === 0) return shard.writer;
    const r = shard.readers[shard.currentReaderIndex];
    shard.currentReaderIndex = (shard.currentReaderIndex + 1) % shard.readers.length;
    return r;
  }

  private async closeShard(shard: ShardConnection) {
    await this.synchronize();
    await shard.writer.close();
    for (const r of shard.readers) await r.close();
  }

  private async ensureTransaction(shard: ShardConnection) {
    if (shard.pendingTxCount === 0) {
      await shard.writer.exec("BEGIN");
      shard.lastTxStartTime = Date.now();
    }
    shard.pendingTxCount++;
  }

  private async checkAutoCommit() {
    for (const shard of this.shards.values()) {
      if (
        shard.pendingTxCount > 0 &&
        (shard.pendingTxCount >= this.config.autoCommitUpdateCount ||
          Date.now() - shard.lastTxStartTime >= this.config.autoCommitDurationSeconds * 1000)
      ) {
        await this.synchronize();
      }
    }
  }

  private async ensureMaintenanceMode() {
    if (!this.maintenanceMode) throw new Error("Maintenance Mode required");
    await this.sleep(100);
  }

  private async deleteFileSet(path: string, throwErr: boolean) {
    try {
      await fs.unlink(path);
      await fs.unlink(`${path}-wal`).catch(() => {});
    } catch {
      if (throwErr) throw new Error(`Failed to delete file set: ${path}`);
    }
  }

  private getValueByGeneration<T>(arr: T[], gen: number): T {
    return gen < arr.length ? arr[gen] : arr[arr.length - 1];
  }

  private sleep(ms: number) {
    return new Promise((r) => setTimeout(r, ms));
  }
}
