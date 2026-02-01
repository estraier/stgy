import path from "path";
import fs from "fs/promises";
import sqlite3 from "sqlite3";
import { Database } from "../utils/database";
import { Tokenizer } from "../utils/tokenizer";
import { Logger } from "pino";
import { TaskQueue } from "./taskQueue";
import { IndexFileManager } from "./indexFileManager";

const DB_PAGE_SIZE_BYTES = 8192;
const WAL_MAX_SIZE_BYTES = 67108864;
const LATEST_CACHE_SIZE_BYTES = 25165824;
const LATEST_MMAP_SIZE_BYTES = 268435456;
const LATEST_AUTOMERGE_LEVEL = 8;
const ARCHIVE_CACHE_SIZE_BYTES = 409600;
const ARCHIVE_MMAP_SIZE_BYTES = 0;
const ARCHIVE_AUTOMERGE_LEVEL = 2;

export type SearchConfig = {
  baseDir: string;
  namePrefix: string;
  bucketDurationSeconds: number;
  autoCommitUpdateCount: number;
  autoCommitDurationSeconds: number;
  initialDocumentId: number;
  recordPositions: boolean;
  recordContents: boolean;
  readConnectionCounts: number[];
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

    if (options.startWorker !== false) {
      this.workerRunning = true;
      this.workerPromise = this.workerLoop();
      this.logger.info(`SearchService opened: ${this.config.namePrefix}`);
    } else {
      this.logger.info(`SearchService opened: ${this.config.namePrefix} (Worker disabled)`);
    }
  }

  async close(): Promise<void> {
    if (!this.isOpen || this.isClosing) return;
    this.isClosing = true;

    this.workerRunning = false;
    if (this.workerPromise) {
      await this.workerPromise;
    }

    await this.synchronize();
    for (const shard of this.shards.values()) {
      await this.closeShard(shard);
    }
    this.shards.clear();

    await this.taskQueue.close();
    this.isOpen = false;
    this.isClosing = false;
    this.logger.info(`SearchService closed: ${this.config.namePrefix}`);
  }

  async startMaintenanceMode(): Promise<void> {
    this.maintenanceMode = true;
    this.logger.info("Maintenance mode started");
  }

  async endMaintenanceMode(): Promise<void> {
    this.maintenanceMode = false;
    this.logger.info("Maintenance mode ended");
  }

  async checkMaintenanceMode(): Promise<boolean> {
    return this.maintenanceMode;
  }

  async listIndexFiles(detailed: boolean = false): Promise<IndexFileInfo[]> {
    return this.fileManager.listIndexFiles(detailed);
  }

  async removeAllIndexFiles(): Promise<void> {
    await this.ensureMaintenanceMode();
    for (const [ts, shard] of this.shards) {
      await this.closeShard(shard);
    }
    this.shards.clear();
    await this.fileManager.removeAllIndexFiles();
    this.latestShardTimestamp = 0;
  }

  async removeIndexFile(timestamp: number): Promise<void> {
    await this.ensureMaintenanceMode();
    const bucketTs = this.fileManager.getBucketTimestamp(timestamp);

    if (this.shards.has(bucketTs)) {
      await this.closeShard(this.shards.get(bucketTs)!);
      this.shards.delete(bucketTs);
    }

    await this.fileManager.removeIndexFile(bucketTs);

    const files = await this.fileManager.listIndexFiles();
    this.latestShardTimestamp = files.length > 0 ? files[0].startTimestamp : 0;
  }

  async reconstructIndexFile(
    timestamp: number,
    newInitialId: number = 268435455,
    useExternalId: boolean = false
  ): Promise<void> {
    await this.ensureMaintenanceMode();
    const bucketTs = this.fileManager.getBucketTimestamp(timestamp);

    const shard = await this.getShard(bucketTs);

    const oldFilepath = this.fileManager.getFilePath(bucketTs);
    const tempFilepath = `${oldFilepath}.rebuild`;

    await this.deleteFileSet(tempFilepath, false);

    const tempDb = await Database.open(tempFilepath);
    await this.setupSchema(tempDb);

    const orderBy = useExternalId ? "t.external_id ASC" : "t.internal_id DESC";
    let currentNewId = newInitialId;
    const BATCH_SIZE = 10000;
    let offset = 0;

    try {
      await tempDb.exec("BEGIN TRANSACTION");

      while (true) {
        const rows = await shard.writer.all<{ external_id: string, tokens: string, attrs: string }>(`
          SELECT t.external_id, d.tokens, e.attrs
          FROM id_tuples t
          JOIN docs d ON t.internal_id = d.rowid
          LEFT JOIN extra_attrs e ON t.external_id = e.external_id
          ORDER BY ${orderBy}
          LIMIT ${BATCH_SIZE} OFFSET ${offset}
        `);

        if (rows.length === 0) break;

        for (const row of rows) {
          await tempDb.run("INSERT INTO id_tuples (internal_id, external_id) VALUES (?, ?)", [currentNewId, row.external_id]);
          await tempDb.run("INSERT INTO docs (rowid, tokens) VALUES (?, ?)", [currentNewId, row.tokens]);
          if (row.attrs) {
            await tempDb.run("INSERT INTO extra_attrs (external_id, attrs) VALUES (?, ?)", [row.external_id, row.attrs]);
          }
          currentNewId--;
        }
        offset += rows.length;
      }

      await tempDb.exec("COMMIT");

      await tempDb.exec("INSERT INTO docs(docs) VALUES('optimize')");
      await tempDb.exec("VACUUM");
      await tempDb.close();

      await this.closeShard(shard);
      this.shards.delete(bucketTs);

      await fs.rename(tempFilepath, oldFilepath);
      await this.deleteFileSet(oldFilepath + "-wal", false);

    } catch (e) {
      if (tempDb) await tempDb.close().catch(() => {});
      await this.deleteFileSet(tempFilepath, false);
      throw e;
    }
  }

  async reserveIds(items: { id: string; timestamp: number }[]): Promise<void> {
    await this.ensureMaintenanceMode();

    const groups = new Map<number, string[]>();
    for (const item of items) {
      const ts = this.fileManager.getBucketTimestamp(item.timestamp);
      const list = groups.get(ts) || [];
      list.push(item.id);
      groups.set(ts, list);
    }

    for (const [ts, ids] of groups) {
      const shard = await this.getShard(ts);
      try {
        await shard.writer.exec("BEGIN TRANSACTION");

        const minRow = await shard.writer.get<{ min_id: number | null }>(
          "SELECT MIN(internal_id) as min_id FROM id_tuples"
        );
        let nextId = (minRow?.min_id ?? this.config.initialDocumentId) - 1;

        for (const id of ids) {
          const existing = await shard.writer.get<{ internal_id: number }>(
            "SELECT internal_id FROM id_tuples WHERE external_id = ?", [id]
          );
          if (!existing) {
             await shard.writer.run(
              "INSERT INTO id_tuples (internal_id, external_id) VALUES (?, ?)",
              [nextId, id]
            );
            nextId--;
          }
        }
        await shard.writer.exec("COMMIT");
      } catch (e) {
        await shard.writer.exec("ROLLBACK").catch(() => {});
        throw e;
      }
    }
  }

  async synchronize(): Promise<void> {
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

  async search(
    query: string,
    locale = "en",
    limit = 100,
    offset = 0,
    timeout = 1
  ): Promise<string[]> {
    if (!this.isOpen) throw new Error("Service not open");

    const tokenizer = await Tokenizer.getInstance();
    const tokens = tokenizer.tokenize(query, locale).slice(0, this.config.maxQueryTokenCount);
    if (tokens.length === 0) return [];

    const ftsQuery = tokens.map((t) => `"${t}"`).join(" AND ");

    const files = await this.fileManager.listIndexFiles();
    const sortedTs = files.map(f => f.startTimestamp);

    const results = new Set<string>();
    const needed = limit + offset;
    const startTime = Date.now();
    const timeoutMs = timeout * 1000;

    for (const ts of sortedTs) {
      if (Date.now() - startTime > timeoutMs) break;
      if (results.size >= needed) break;

      const shard = await this.getShard(ts);
      const targetDb = this.selectReader(shard);

      try {
        const rows = await targetDb.all<{ external_id: string }>(
          `SELECT t.external_id FROM docs
           JOIN id_tuples t ON docs.rowid = t.internal_id
           WHERE docs MATCH ?
           ORDER BY docs.rowid ASC LIMIT ?`,
          [ftsQuery, needed - results.size]
        );

        for (const row of rows) {
          results.add(row.external_id);
        }
      } catch (e) {
        this.logger.error(`Search failed on shard ${ts}: ${e}`);
      }
    }

    return Array.from(results).slice(offset, needed);
  }

  async fetchDocuments(
    ids: string[],
    omitBodyText: boolean = false,
    omitAttrs: boolean = false
  ): Promise<{ id: string; bodyText: string | null; attrs: string | null }[]> {
    if (!this.isOpen) throw new Error("Service not open");
    if (ids.length === 0) return [];

    const results: { id: string; bodyText: string | null; attrs: string | null }[] = [];
    const neededIds = new Set(ids);
    const files = await this.fileManager.listIndexFiles();

    for (const file of files) {
      if (neededIds.size === 0) break;

      const shard = await this.getShard(file.startTimestamp);
      const db = this.selectReader(shard);

      const batchIds = Array.from(neededIds);

      try {
        const selectCols = ["t.external_id as id"];
        if (!omitBodyText) selectCols.push("d.tokens as bodyText");
        else selectCols.push("NULL as bodyText");

        if (!omitAttrs) selectCols.push("e.attrs");
        else selectCols.push("NULL as attrs");

        const placeholders = batchIds.map(() => "?").join(",");
        const sql = `
          SELECT ${selectCols.join(", ")}
          FROM id_tuples t
          JOIN docs d ON t.internal_id = d.rowid
          LEFT JOIN extra_attrs e ON t.external_id = e.external_id
          WHERE t.external_id IN (${placeholders})
        `;

        const rows = await db.all<{ id: string; bodyText: string | null; attrs: string | null }>(sql, batchIds);

        for (const row of rows) {
          results.push(row);
          neededIds.delete(row.id);
        }
      } catch (e) {
        this.logger.error(`Fetch documents failed on shard ${file.startTimestamp}: ${e}`);
      }
    }

    return results;
  }

  async enqueueTask(
    docId: string,
    timestamp: number,
    bodyText: string | null,
    locale: string | null,
    attrs: string | null
  ): Promise<void> {
    await this.taskQueue.enqueue(docId, timestamp, bodyText, locale, attrs);
  }

  private async fetchTask(): Promise<IndexTask | null> {
    if (this.maintenanceMode) return null;
    return await this.taskQueue.dequeue();
  }

  private async deleteTask(id: number): Promise<void> {
    await this.taskQueue.complete(id);
  }

  protected async addDocument(
    docId: string,
    timestamp: number,
    bodyText: string,
    locale: string,
    attrs: string | null = null
  ): Promise<void> {
    const shard = await this.getShard(this.fileManager.getBucketTimestamp(timestamp));
    await this.ensureTransaction(shard);

    let internalId: number;
    const existing = await shard.writer.get<{ internal_id: number }>(
      "SELECT internal_id FROM id_tuples WHERE external_id = ?", [docId]
    );

    if (existing) {
      internalId = existing.internal_id;
    } else {
      const minRow = await shard.writer.get<{ min_id: number | null }>(
        "SELECT MIN(internal_id) as min_id FROM id_tuples"
      );
      internalId = (minRow?.min_id ?? this.config.initialDocumentId) - 1;
    }

    const tokenizer = await Tokenizer.getInstance();
    const rawTokens = tokenizer.tokenize(bodyText, locale);

    let tokens: string[];
    if (this.config.recordPositions) {
      tokens = rawTokens.slice(0, this.config.maxDocumentTokenCount);
    } else {
      const uniqueSet = new Set<string>();
      for (const t of rawTokens) {
        if (uniqueSet.size >= this.config.maxDocumentTokenCount) break;
        uniqueSet.add(t);
      }
      tokens = Array.from(uniqueSet);
    }

    await shard.writer.run("INSERT OR REPLACE INTO docs (rowid, tokens) VALUES (?, ?)", [internalId, tokens.join(" ")]);

    if (!existing) {
      await shard.writer.run("INSERT INTO id_tuples (internal_id, external_id) VALUES (?, ?)", [internalId, docId]);
    }

    if (attrs) {
      await shard.writer.run(
        "INSERT OR REPLACE INTO extra_attrs (external_id, attrs) VALUES (?, ?)",
        [docId, attrs]
      );
    }
  }

  private async removeDocument(docId: string, timestamp: number): Promise<void> {
    if (!this.config.recordContents) return;

    const shard = await this.getShard(this.fileManager.getBucketTimestamp(timestamp));
    await this.ensureTransaction(shard);

    const existing = await shard.writer.get<{ internal_id: number }>(
      "SELECT internal_id FROM id_tuples WHERE external_id = ?", [docId]
    );

    if (existing) {
      const id = existing.internal_id;
      await shard.writer.run("DELETE FROM docs WHERE rowid = ?", [id]);
      await shard.writer.run("DELETE FROM id_tuples WHERE internal_id = ?", [id]);
      await shard.writer.run("DELETE FROM extra_attrs WHERE external_id = ?", [docId]);
    }
  }

  private async workerLoop(): Promise<void> {
    const pendingTasks = await this.taskQueue.getPendingBatchTasks();
    for (const task of pendingTasks) {
      await this.processTask(task);
      await this.deleteTask(task.id);
    }
    await this.synchronize();

    while (this.workerRunning) {
      if (this.maintenanceMode) {
        await this.sleep(100);
        continue;
      }

      try {
        const task = await this.fetchTask();
        if (task) {
          await this.processTask(task);
          await this.deleteTask(task.id);

          await this.checkAutoCommit();

          await this.sleep(0);
        } else {
          await this.synchronize();
          await this.sleep(50);
        }
      } catch (e) {
        this.logger.error(`Worker error: ${e}`);
        await this.sleep(50);
      }
    }
  }

  private async processTask(task: IndexTask): Promise<void> {
    if (task.bodyText === null) {
      await this.removeDocument(task.docId, task.timestamp);
    } else {
      await this.addDocument(task.docId, task.timestamp, task.bodyText, task.locale || "en", task.attrs);
    }
  }

  private async checkAutoCommit(): Promise<void> {
    const now = Date.now();
    for (const shard of this.shards.values()) {
      if (shard.pendingTxCount > 0 && !shard.isCommitting) {
        const timeElapsed = (now - shard.lastTxStartTime) / 1000;
        if (
          shard.pendingTxCount >= this.config.autoCommitUpdateCount ||
          timeElapsed >= this.config.autoCommitDurationSeconds
        ) {
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
  }

  private async ensureTransaction(shard: ShardConnection): Promise<void> {
    if (shard.pendingTxCount === 0) {
      await shard.writer.exec("BEGIN TRANSACTION");
      shard.lastTxStartTime = Date.now();
    }
    shard.pendingTxCount++;
  }

  private async getShard(timestamp: number): Promise<ShardConnection> {
    const bucketTs = this.fileManager.getBucketTimestamp(timestamp);

    if (this.shards.has(bucketTs)) {
      return this.shards.get(bucketTs)!;
    }

    const filepath = this.fileManager.getFilePath(timestamp);
    const writer = await Database.open(filepath);

    const isLatest = bucketTs === this.latestShardTimestamp;
    await this.setupPragmas(writer, isLatest, true);
    await this.setupSchema(writer);

    const readers: Database[] = [];

    const generation = (this.latestShardTimestamp - bucketTs) / this.config.bucketDurationSeconds;
    const readerCount = this.config.readConnectionCounts[generation] || 0;

    for (let i = 0; i < readerCount; i++) {
      try {
        const reader = await Database.open(filepath, sqlite3.OPEN_READONLY);
        await this.setupPragmas(reader, isLatest, false);
        readers.push(reader);
      } catch (e) {
        this.logger.error(`Failed to open reader for ${bucketTs}: ${e}`);
      }
    }

    const shard: ShardConnection = {
      writer,
      readers,
      currentReaderIndex: 0,
      pendingTxCount: 0,
      lastTxStartTime: 0,
      isCommitting: false
    };

    this.shards.set(bucketTs, shard);

    if (bucketTs > this.latestShardTimestamp) {
      this.latestShardTimestamp = bucketTs;
    }

    return shard;
  }

  private selectReader(shard: ShardConnection): Database {
    if (shard.readers.length > 0) {
      const reader = shard.readers[shard.currentReaderIndex];
      shard.currentReaderIndex = (shard.currentReaderIndex + 1) % shard.readers.length;
      return reader;
    }
    return shard.writer;
  }

  private async closeShard(shard: ShardConnection): Promise<void> {
    if (shard.pendingTxCount > 0 && !shard.isCommitting) {
      shard.isCommitting = true;
      try {
        await shard.writer.exec("COMMIT").catch(() => {});
      } finally {
        shard.isCommitting = false;
      }
    }
    await shard.writer.close().catch(() => {});
    for (const r of shard.readers) {
      await r.close().catch(() => {});
    }
  }

  private async setupPragmas(db: Database, isLatest: boolean, isWriter: boolean): Promise<void> {
    await db.exec("PRAGMA journal_mode = WAL;");
    await db.exec("PRAGMA synchronous = NORMAL;");

    const cacheSize = isLatest ? LATEST_CACHE_SIZE_BYTES : ARCHIVE_CACHE_SIZE_BYTES;
    const mmapSize = isLatest ? LATEST_MMAP_SIZE_BYTES : ARCHIVE_MMAP_SIZE_BYTES;
    const cacheSizeKb = Math.floor(cacheSize / 1024) * -1;

    await db.exec(`PRAGMA cache_size = ${cacheSizeKb};`);
    await db.exec(`PRAGMA mmap_size = ${mmapSize};`);

    if (isWriter) {
      await db.exec(`PRAGMA journal_size_limit = ${WAL_MAX_SIZE_BYTES};`);
      const automerge = isLatest ? LATEST_AUTOMERGE_LEVEL : ARCHIVE_AUTOMERGE_LEVEL;
      await db.exec(`INSERT OR REPLACE INTO docs_config(k, v) VALUES('automerge', ${automerge});`).catch(() => {});
    }
  }

  private async setupSchema(db: Database): Promise<void> {
    await db.exec(`
      CREATE TABLE IF NOT EXISTS id_tuples (
        internal_id INTEGER PRIMARY KEY,
        external_id TEXT UNIQUE
      );
    `);
    await db.exec(`
      CREATE TABLE IF NOT EXISTS extra_attrs (
        external_id TEXT PRIMARY KEY,
        attrs TEXT
      );
    `);
    const detailMode = this.config.recordPositions ? "full" : "none";
    const contentOption = this.config.recordContents ? "" : "content='',";
    await db.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS docs USING fts5(
        tokens,
        tokenize = "unicode61 categories 'L* N* Co M* P* S*' remove_diacritics 0",
        detail = '${detailMode}',
        ${contentOption}
      );
    `);
    await db.exec(
      `INSERT OR REPLACE INTO docs_config(k, v) VALUES('pgsz', ${DB_PAGE_SIZE_BYTES});`
    ).catch(() => {});
  }

  private async ensureMaintenanceMode(): Promise<void> {
    if (!this.maintenanceMode) {
      throw new Error("Operation requires Maintenance Mode enabled.");
    }
    await this.sleep(200);
  }

  private async deleteFileSet(filepath: string, throwError: boolean = true): Promise<void> {
    try {
      await fs.unlink(filepath);
      await fs.unlink(`${filepath}-wal`).catch(() => {});
      await fs.unlink(`${filepath}-shm`).catch(() => {});
    } catch (e) {
      if (throwError) throw e;
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
