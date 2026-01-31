import fs from "fs/promises";
import path from "path";
import sqlite3 from "sqlite3";
import { Database } from "../utils/database";
import { Tokenizer } from "../utils/tokenizer";
import { Logger } from "pino";

const CONFIG_DB_PAGE_SIZE_BYTES = 8192;
const CONFIG_WAL_MAX_SIZE_BYTES = 67108864;
const CONFIG_LATEST_CACHE_SIZE_BYTES = 25165824;
const CONFIG_LATEST_MMAP_SIZE_BYTES = 268435456;
const CONFIG_LATEST_AUTOMERGE_LEVEL = 8;
const CONFIG_ARCHIVE_CACHE_SIZE_BYTES = 409600;
const CONFIG_ARCHIVE_MMAP_SIZE_BYTES = 0;
const CONFIG_ARCHIVE_AUTOMERGE_LEVEL = 2;

export type SearchConfig = {
  baseDir: string;
  namePrefix: string;
  bucketDurationSeconds: number;
  autoCommitUpdateCount: number;
  autoCommitAfterLastUpdateSeconds: number;
  autoCommitAfterLastCommitSeconds: number;
  initialDocumentId: number;
  recordPositions: boolean;
  recordContents: boolean;
  readConnectionCount: number;
  maxQueryTokenCount: number;
  maxDocumentTokenCount: number;
};

export type SearchFileInfo = {
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

export type FetchedDocument = {
  id: string;
  bodyText: string | null;
  attrs: string | null;
};

type BatchTask = {
  id: number;
  doc_id: string;
  body: string | null;
  locale: string | null;
  attrs: string | null;
  created_at: string;
};

class SearchShard {
  public readonly filepath: string;
  public readonly startTimestamp: number;
  public db: Database | null = null;
  private readDbs: Database[] = [];
  private currentReadIndex: number = 0;
  private operational: boolean = true;
  private config: SearchConfig;
  private tokenizer: Tokenizer;
  private logger: Logger;
  private pendingCount: number = 0;
  private batchTimer: NodeJS.Timeout | null = null;
  private isProcessingBatch: boolean = false;
  private isClosing: boolean = false;
  private lastQueryEndTime: number = 0;

  constructor(
    filepath: string,
    startTimestamp: number,
    config: SearchConfig,
    tokenizer: Tokenizer,
    logger: Logger,
  ) {
    this.filepath = filepath;
    this.startTimestamp = startTimestamp;
    this.config = config;
    this.tokenizer = tokenizer;
    this.logger = logger;
  }

  async reserveIds(externalIds: string[]): Promise<void> {
    if (this.isClosing) throw new Error("Shard is closing");
    if (!this.operational) throw new Error("Shard is not operational");
    if (!this.db) await this.open();
    if (!this.db) throw new Error("Database not initialized");
    try {
      await this.db.exec("BEGIN TRANSACTION;");
      const minRow = await this.db.get<{ min_id: number | null }>(
        "SELECT MIN(internal_id) as min_id FROM id_tuples",
      );
      let nextId =
        minRow?.min_id !== null && minRow?.min_id !== undefined
          ? minRow.min_id - 1
          : this.config.initialDocumentId;
      for (const id of externalIds) {
        const existing = await this.db.get<{ internal_id: number }>(
          "SELECT internal_id FROM id_tuples WHERE external_id = ?",
          [id],
        );
        if (!existing) {
          if (nextId <= 0) throw new Error("RowID exhausted during reservation");
          await this.db.run("INSERT INTO id_tuples (internal_id, external_id) VALUES (?, ?)", [
            nextId,
            id,
          ]);
          nextId--;
        }
      }
      await this.db.exec("COMMIT;");
    } catch (e) {
      if (this.db) await this.db.exec("ROLLBACK;").catch(() => {});
      throw e;
    }
  }

  async open(): Promise<void> {
    if (this.db || this.isClosing) return;
    try {
      this.db = await Database.open(this.filepath);
      const cacheSizeKb = Math.floor(CONFIG_ARCHIVE_CACHE_SIZE_BYTES / 1024) * -1;
      await this.db.exec("PRAGMA journal_mode = WAL;");
      await this.db.exec("PRAGMA synchronous = NORMAL;");
      await this.db.exec(`PRAGMA cache_size = ${cacheSizeKb};`);
      await this.db.exec(`PRAGMA mmap_size = ${CONFIG_ARCHIVE_MMAP_SIZE_BYTES};`);
      await this.db.exec(`PRAGMA journal_size_limit = ${CONFIG_WAL_MAX_SIZE_BYTES};`);
      await this.db.exec(`
        CREATE TABLE IF NOT EXISTS id_tuples (
          internal_id INTEGER PRIMARY KEY,
          external_id TEXT UNIQUE
        );
      `);
      await this.db.exec(`
        CREATE TABLE IF NOT EXISTS extra_attrs (
          external_id TEXT PRIMARY KEY,
          attrs TEXT
        );
      `);
      const detailMode = this.config.recordPositions ? "full" : "none";
      const contentOption = this.config.recordContents ? "" : "content='',";
      await this.db.exec(`
        CREATE VIRTUAL TABLE IF NOT EXISTS docs USING fts5(
          tokens,
          tokenize = "unicode61 categories 'L* N* Co M* P* S*' remove_diacritics 0",
          detail = '${detailMode}',
          ${contentOption}
        );
      `);
      await this.db
        .exec(
          `INSERT OR REPLACE INTO docs_config(k, v) VALUES('pgsz', ${CONFIG_DB_PAGE_SIZE_BYTES});`,
        )
        .catch(() => {});
      await this.db.exec(`
        CREATE TABLE IF NOT EXISTS batch_tasks (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          doc_id TEXT NOT NULL,
          body TEXT,
          locale TEXT,
          attrs TEXT,
          created_at DATETIME DEFAULT (STRFTIME('%Y-%m-%d %H:%M:%f', 'NOW'))
        );
      `);
      this.operational = true;
      await this.recover();
    } catch (e) {
      this.operational = false;
      this.logger.error(`Failed to open shard ${this.filepath}: ${e}`);
      if (this.db) {
        await this.db.close().catch(() => {});
        this.db = null;
      }
    }
  }

  async close(): Promise<void> {
    this.isClosing = true;
    if (this.batchTimer) {
      clearTimeout(this.batchTimer);
      this.batchTimer = null;
    }
    while (this.isProcessingBatch) {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    await this.flush();
    await this.disableReadOnly();
    if (this.db) {
      await this.db.exec("PRAGMA wal_checkpoint(TRUNCATE);").catch(() => {});
      await this.db.close();
      this.db = null;
    }
    this.isClosing = false;
  }

  async flush(): Promise<void> {
    if (this.batchTimer) {
      clearTimeout(this.batchTimer);
      this.batchTimer = null;
    }
    while (this.isProcessingBatch) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    await this.processBatch();
    if (this.db && this.operational) {
      await this.db.exec("PRAGMA wal_checkpoint(PASSIVE);").catch(() => {});
    }
  }

  async optimize(): Promise<void> {
    if (!this.db || !this.operational) return;
    try {
      await this.flush();
      await this.db.exec("INSERT INTO docs(docs) VALUES('optimize');");
      await this.db.exec("PRAGMA wal_checkpoint(TRUNCATE);");
      await this.db.exec("VACUUM;");
    } catch (e) {
      this.logger.error(`Optimize failed on ${this.filepath}: ${e}`);
    }
  }

  async reconstruct(newInitialId: number): Promise<void> {
    if (this.isProcessingBatch || this.isClosing) {
      throw new Error("Cannot reconstruct while shard is busy or closing.");
    }
    if (!this.db || !this.operational) await this.open();
    if (!this.db) throw new Error("Database not available.");
    this.isProcessingBatch = true;
    try {
      await this.db.exec("BEGIN TRANSACTION;");
      const allDocs = await this.db.all<{
        internal_id: number;
        external_id: string;
        tokens: string;
      }>(`
        SELECT t.internal_id, t.external_id, d.tokens
        FROM id_tuples t
        JOIN docs d ON t.internal_id = d.rowid
        ORDER BY t.internal_id DESC
      `);
      if (allDocs.length === 0) {
        await this.db.exec("COMMIT;");
        return;
      }
      await this.db.exec("DELETE FROM docs;");
      await this.db.exec("DELETE FROM id_tuples;");
      let nextId = newInitialId;
      for (const doc of allDocs) {
        if (nextId <= 0) throw new Error("New initial ID is too small.");
        await this.db.run("INSERT INTO id_tuples (internal_id, external_id) VALUES (?, ?)", [
          nextId,
          doc.external_id,
        ]);
        await this.db.run("INSERT INTO docs (rowid, tokens) VALUES (?, ?)", [nextId, doc.tokens]);
        nextId--;
      }
      await this.db.exec("INSERT INTO docs(docs) VALUES('optimize');");
      await this.db.exec("COMMIT;");
      setImmediate(async () => {
        if (this.db) await this.db.exec("VACUUM;").catch(() => {});
      });
    } catch (e) {
      if (this.db) await this.db.exec("ROLLBACK;").catch(() => {});
      throw e;
    } finally {
      this.isProcessingBatch = false;
    }
  }

  async enableReadOnly(): Promise<void> {
    if (this.readDbs.length > 0 || !this.operational || this.isClosing) return;
    if (!this.db) await this.open();
    if (!this.db) return;
    for (let i = 0; i < this.config.readConnectionCount; i++) {
      try {
        const conn = await Database.open(this.filepath, sqlite3.OPEN_READONLY);
        this.readDbs.push(conn);
      } catch (e) {
        this.logger.error(`Failed to open read-only connection: ${e}`);
      }
    }
  }

  async disableReadOnly(): Promise<void> {
    for (const conn of this.readDbs) {
      await conn.close().catch(() => {});
    }
    this.readDbs = [];
    this.currentReadIndex = 0;
  }

  async addDocument(
    docId: string,
    bodyText: string,
    locale: string,
    attrs: string | null,
  ): Promise<void> {
    if (this.isClosing) throw new Error("Shard is closing");
    if (!this.operational) throw new Error("Shard is not operational");
    if (!this.db) await this.open();
    if (!this.db) throw new Error("Database not initialized");
    await this.db.run("INSERT INTO batch_tasks (doc_id, body, locale, attrs) VALUES (?, ?, ?, ?)", [
      docId,
      bodyText,
      locale,
      attrs,
    ]);
    this.onTaskAdded();
  }

  async removeDocument(docId: string): Promise<void> {
    if (!this.config.recordContents)
      throw new Error("Cannot remove documents in contentless mode.");
    if (this.isClosing) throw new Error("Shard is closing");
    if (!this.operational) throw new Error("Shard is not operational");
    if (!this.db) await this.open();
    if (!this.db) throw new Error("Database not initialized");
    await this.db.run("INSERT INTO batch_tasks (doc_id, body, locale, attrs) VALUES (?, ?, ?, ?)", [
      docId,
      null,
      null,
      null,
    ]);
    this.onTaskAdded();
  }

  async search(tokens: string[], limit: number): Promise<string[]> {
    if (!this.operational || !this.db) return [];
    const query = tokens.map((t) => `"${t}"`).join(" AND ");
    if (!query) return [];
    let targetDb = this.db;
    if (this.readDbs.length > 0) {
      const now = Date.now();
      if (this.isProcessingBatch || now - this.lastQueryEndTime < 100) {
        targetDb = this.readDbs[this.currentReadIndex] || this.db;
        this.currentReadIndex = (this.currentReadIndex + 1) % this.readDbs.length;
      }
    }
    try {
      const rows = await targetDb.all<{ external_id: string }>(
        `SELECT t.external_id FROM docs JOIN id_tuples t ON docs.rowid = t.internal_id WHERE docs MATCH ? ORDER BY docs.rowid ASC LIMIT ?`,
        [query, limit],
      );
      return rows.map((r) => r.external_id);
    } catch (e) {
      this.logger.error(`Search failed: ${e}`);
      throw e;
    } finally {
      this.lastQueryEndTime = Date.now();
    }
  }

  async fetchDocuments(
    ids: string[],
    omitBodyText: boolean,
    omitAttrs: boolean,
  ): Promise<FetchedDocument[]> {
    if (!this.operational || !this.db) return [];
    if (ids.length === 0) return [];
    let targetDb = this.db;
    if (this.readDbs.length > 0) {
      const now = Date.now();
      if (this.isProcessingBatch || now - this.lastQueryEndTime < 100) {
        targetDb = this.readDbs[this.currentReadIndex] || this.db;
        this.currentReadIndex = (this.currentReadIndex + 1) % this.readDbs.length;
      }
    }

    try {
      const placeholders = ids.map(() => "?").join(",");
      let selectClause = "SELECT t.external_id as id";
      let joinClause = "FROM id_tuples t";

      if (!omitBodyText) {
        selectClause += ", d.tokens as bodyText";
        joinClause += " JOIN docs d ON t.internal_id = d.rowid";
      } else {
        selectClause += ", NULL as bodyText";
      }

      if (!omitAttrs) {
        selectClause += ", ea.attrs";
        joinClause += " LEFT JOIN extra_attrs ea ON t.external_id = ea.external_id";
      } else {
        selectClause += ", NULL as attrs";
      }

      const sql = `${selectClause} ${joinClause} WHERE t.external_id IN (${placeholders})`;
      return await targetDb.all<FetchedDocument>(sql, ids);
    } catch (e) {
      this.logger.error(`Fetch documents failed: ${e}`);
      throw e;
    } finally {
      this.lastQueryEndTime = Date.now();
    }
  }

  async getFileInfo(detailed: boolean): Promise<SearchFileInfo> {
    let count = 0,
      fileSize = 0,
      walSize = 0,
      totalDatabaseSize = 0,
      indexSize = 0,
      contentSize = 0;
    let currentHealthy = this.operational;
    try {
      const stats = await fs.stat(this.filepath);
      fileSize = stats.size;
      const walStats = await fs.stat(this.filepath + "-wal").catch(() => ({ size: 0 }));
      walSize = walStats.size;
      if (currentHealthy) {
        if (!this.db) await this.open();
        if (this.db) {
          const row = await this.db.get<{ c: number }>("SELECT count(*) as c FROM id_tuples");
          count = row?.c || 0;
          if (detailed) {
            const psRow = await this.db.get<{ page_size: number }>("PRAGMA page_size");
            const pcRow = await this.db.get<{ page_count: number }>("PRAGMA page_count");
            totalDatabaseSize = (psRow?.page_size || 0) * (pcRow?.page_count || 0);
            const idxRow = await this.db.get<{ c: number }>("SELECT count(*) as c FROM docs_data");
            indexSize = (idxRow?.c || 0) * CONFIG_DB_PAGE_SIZE_BYTES;
            if (this.config.recordContents) {
              try {
                const cntRow = await this.db.get<{ s: number }>(
                  "SELECT SUM(LENGTH(c0)) as s FROM docs_content",
                );
                contentSize = cntRow?.s || 0;
              } catch {
                contentSize = 0;
              }
            }
          }
        } else {
          currentHealthy = false;
        }
      }
    } catch {
      currentHealthy = false;
    }
    return {
      filename: path.basename(this.filepath),
      fileSize,
      walSize,
      totalDatabaseSize,
      indexSize,
      contentSize,
      countDocuments: count,
      startTimestamp: this.startTimestamp,
      endTimestamp: this.startTimestamp + this.config.bucketDurationSeconds,
      isHealthy: currentHealthy,
    };
  }

  private onTaskAdded() {
    this.pendingCount++;
    if (this.pendingCount >= this.config.autoCommitUpdateCount) {
      this.processBatch().catch(() => {});
      return;
    }
    if (!this.batchTimer && !this.isClosing) {
      const delay = Math.min(
        this.config.autoCommitAfterLastUpdateSeconds * 1000,
        this.config.autoCommitAfterLastCommitSeconds * 1000,
      );
      this.batchTimer = setTimeout(() => {
        this.batchTimer = null;
        this.processBatch().catch(() => {});
      }, delay);
    }
  }

  private async processBatch() {
    if (this.isProcessingBatch || !this.db || !this.operational) return;
    this.isProcessingBatch = true;
    try {
      const tasks = await this.db.all<BatchTask>("SELECT * FROM batch_tasks ORDER BY id ASC");
      const taskCount = tasks.length;
      if (taskCount === 0) {
        this.pendingCount = 0;
        return;
      }
      await this.db.exec("BEGIN TRANSACTION");
      const minRow = await this.db.get<{ min_id: number | null }>(
        "SELECT MIN(internal_id) as min_id FROM id_tuples",
      );
      let nextInternalId =
        minRow?.min_id !== null && minRow?.min_id !== undefined
          ? minRow.min_id - 1
          : this.config.initialDocumentId;
      for (const task of tasks) {
        try {
          let internalId: number | undefined;
          let row = await this.db.get<{ internal_id: number }>(
            "SELECT internal_id FROM id_tuples WHERE external_id = ?",
            [task.doc_id],
          );
          if (row) {
            if (!this.config.recordContents)
              throw new Error(`Duplicate document ID ${task.doc_id} in contentless mode.`);
            internalId = row.internal_id;
          } else {
            if (task.body === null) continue;
            if (nextInternalId <= 0) throw new Error(`RowID exhausted in shard ${this.filepath}.`);
            await this.db.run("INSERT INTO id_tuples (internal_id, external_id) VALUES (?, ?)", [
              nextInternalId,
              task.doc_id,
            ]);
            internalId = nextInternalId;
            nextInternalId--;
          }
          if (task.body === null) {
            await this.db.run("DELETE FROM docs WHERE rowid = ?", [internalId]);
            await this.db.run("DELETE FROM id_tuples WHERE internal_id = ?", [internalId]);
            await this.db.run("DELETE FROM extra_attrs WHERE external_id = ?", [task.doc_id]);
          } else {
            if (row) await this.db.run("DELETE FROM docs WHERE rowid = ?", [internalId]);
            const rawTokens = this.tokenizer.tokenize(task.body, task.locale || "en");
            let tokens;
            if (this.config.recordPositions) {
              tokens = rawTokens.slice(0, this.config.maxDocumentTokenCount);
            } else {
              const uniqueSet = new Set<string>();
              const max = this.config.maxDocumentTokenCount;
              for (const token of rawTokens) {
                uniqueSet.add(token);
                if (uniqueSet.size >= max) break;
              }
              tokens = Array.from(uniqueSet).sort();
            }
            await this.db.run("INSERT INTO docs (rowid, tokens) VALUES (?, ?)", [
              internalId,
              tokens.join(" "),
            ]);
            if (task.attrs !== null) {
              await this.db.run(
                "INSERT OR REPLACE INTO extra_attrs (external_id, attrs) VALUES (?, ?)",
                [task.doc_id, task.attrs],
              );
            }
          }
        } catch (e) {
          if (e instanceof Error) {
            this.logger.error(`Task execution error: ${e.message}`);
            if (e.message.includes("RowID exhausted")) throw e;
          } else {
            this.logger.error(`Task execution error: ${String(e)}`);
          }
        }
      }
      await this.db.run(
        "DELETE FROM batch_tasks WHERE id IN (" + tasks.map((t) => t.id).join(",") + ")",
      );
      await this.db.exec("COMMIT");
      this.pendingCount = Math.max(0, this.pendingCount - taskCount);
    } catch (e) {
      if (this.db) await this.db.exec("ROLLBACK").catch(() => {});
      throw e;
    } finally {
      this.isProcessingBatch = false;
      if (this.pendingCount >= this.config.autoCommitUpdateCount && !this.isClosing) {
        setImmediate(() => this.processBatch().catch(() => {}));
      }
    }
  }

  private async recover() {
    if (!this.db || !this.operational) return;
    const row = await this.db
      .get<{ c: number }>("SELECT count(*) as c FROM batch_tasks")
      .catch(() => null);
    if (row && row.c > 0) {
      this.pendingCount = row.c;
      await this.processBatch().catch(() => {});
    }
  }
}

export class SearchService {
  private config: SearchConfig;
  private shards: Map<number, SearchShard>;
  private sortedShards: SearchShard[] = [];
  private tokenizer: Tokenizer | null = null;
  private isOpen: boolean = false;
  private latestShardTimestamp: number = 0;
  private logger: Logger;

  constructor(config: SearchConfig, logger: Logger) {
    this.config = config;
    this.logger = logger;
    this.shards = new Map();
  }

  async reserve(items: { id: string; timestamp: number }[]): Promise<void> {
    if (!this.isOpen) throw new Error("Service not open");
    const sortedItems = [...items].sort((a, b) => {
      if (a.timestamp !== b.timestamp) return a.timestamp - b.timestamp;
      return a.id.localeCompare(b.id);
    });
    const groups = new Map<number, string[]>();
    for (const item of sortedItems) {
      const ts = this.getBucketTimestamp(item.timestamp);
      const list = groups.get(ts) || [];
      list.push(item.id);
      groups.set(ts, list);
    }
    for (const [ts, ids] of groups) {
      const shard = await this.getShard(ts);
      await shard.reserveIds(ids);
    }
  }

  async open(): Promise<void> {
    if (this.isOpen) return;
    this.tokenizer = await Tokenizer.create();
    await fs.mkdir(this.config.baseDir, { recursive: true });
    const files = await fs.readdir(this.config.baseDir);
    let maxTimestamp = 0;
    for (const file of files) {
      if (file.startsWith(this.config.namePrefix) && file.endsWith(".db")) {
        const prefixLength = this.config.namePrefix.length + 1;
        const ts = parseInt(file.substring(prefixLength, file.length - 3), 10);
        if (!isNaN(ts)) {
          const filepath = path.join(this.config.baseDir, file);
          const shard = new SearchShard(filepath, ts, this.config, this.tokenizer, this.logger);
          await shard.open();
          this.shards.set(ts, shard);
          if (ts > maxTimestamp) maxTimestamp = ts;
        }
      }
    }
    this.rebuildSortedCache();
    this.isOpen = true;
    if (this.shards.size > 0) await this.promoteToLatest(maxTimestamp);
  }

  async close(): Promise<void> {
    if (!this.isOpen) return;
    await Promise.all(Array.from(this.shards.values()).map((s) => s.close()));
    this.shards.clear();
    this.sortedShards = [];
    this.tokenizer = null;
    this.isOpen = false;
    this.latestShardTimestamp = 0;
  }

  async flushAll(): Promise<void> {
    if (!this.isOpen) return;
    await Promise.all(Array.from(this.shards.values()).map((s) => s.flush()));
  }

  getTokenizer(): Tokenizer {
    if (!this.isOpen || !this.tokenizer) throw new Error("Service not open");
    return this.tokenizer;
  }

  private rebuildSortedCache(): void {
    this.sortedShards = Array.from(this.shards.values()).sort(
      (a, b) => b.startTimestamp - a.startTimestamp,
    );
  }

  private async promoteToLatest(timestamp: number): Promise<void> {
    const shard = this.shards.get(timestamp);
    if (!shard) return;
    if (this.latestShardTimestamp > 0 && this.latestShardTimestamp !== timestamp) {
      const oldShard = this.shards.get(this.latestShardTimestamp);
      if (oldShard && oldShard.db) {
        const cacheSizeKb = Math.floor(CONFIG_ARCHIVE_CACHE_SIZE_BYTES / 1024) * -1;
        await oldShard.db.exec(`PRAGMA cache_size = ${cacheSizeKb};`);
        await oldShard.db.exec(`PRAGMA mmap_size = ${CONFIG_ARCHIVE_MMAP_SIZE_BYTES};`);
        await oldShard.db
          .exec(
            `INSERT OR REPLACE INTO docs_config(k, v) VALUES('automerge', ${CONFIG_ARCHIVE_AUTOMERGE_LEVEL});`,
          )
          .catch(() => {});
        await oldShard.disableReadOnly();
        oldShard.optimize().catch((e) => this.logger.error(`Auto-optimization failed: ${e}`));
      }
    }
    this.latestShardTimestamp = timestamp;
    if (shard.db) {
      const cacheSizeKb = Math.floor(CONFIG_LATEST_CACHE_SIZE_BYTES / 1024) * -1;
      await shard.db.exec(`PRAGMA cache_size = ${cacheSizeKb};`);
      await shard.db.exec(`PRAGMA mmap_size = ${CONFIG_LATEST_MMAP_SIZE_BYTES};`);
      await shard.db
        .exec(
          `INSERT OR REPLACE INTO docs_config(k, v) VALUES('automerge', ${CONFIG_LATEST_AUTOMERGE_LEVEL});`,
        )
        .catch(() => {});
      await shard.enableReadOnly();
    }
  }

  async addDocument(
    docId: string,
    timestamp: number,
    bodyText: string,
    locale: string,
    attrs: string | null = null,
  ): Promise<void> {
    if (!this.isOpen || !this.tokenizer) throw new Error("Service not open");
    const shard = await this.getShard(timestamp);
    await shard.addDocument(docId, bodyText, locale, attrs);
  }

  async removeDocument(docId: string, timestamp: number): Promise<void> {
    if (!this.isOpen) throw new Error("Service not open");
    const shard = await this.getShard(timestamp);
    await shard.removeDocument(docId);
  }

  async search(
    query: string,
    locale = "en",
    limit = 100,
    offset = 0,
    timeout = 1,
  ): Promise<string[]> {
    if (!this.isOpen || !this.tokenizer) throw new Error("Service not open");
    const tokens = this.tokenizer.tokenize(query, locale).slice(0, this.config.maxQueryTokenCount);
    if (tokens.length === 0) return [];
    const results = new Set<string>();
    const startTime = Date.now();
    const needed = limit + offset;
    const timeoutMs = timeout * 1000;

    for (const shard of this.sortedShards) {
      if (Date.now() - startTime > timeoutMs) break;
      if (results.size >= needed) break;

      const shardResults = await shard.search(tokens, needed - results.size);
      for (const id of shardResults) {
        results.add(id);
      }
    }
    return Array.from(results).slice(offset, offset + limit);
  }

  async fetchDocuments(
    ids: string[],
    omitBodyText = false,
    omitAttrs = false,
  ): Promise<FetchedDocument[]> {
    if (!this.isOpen) throw new Error("Service not open");
    if (ids.length === 0) return [];

    const results: FetchedDocument[] = [];
    const idsToFind = new Set(ids);

    for (const shard of this.sortedShards) {
      if (idsToFind.size === 0) break;
      const batchIds = Array.from(idsToFind);
      const docs = await shard.fetchDocuments(batchIds, omitBodyText, omitAttrs);

      for (const doc of docs) {
        results.push(doc);
        idsToFind.delete(doc.id);
      }
    }
    return results;
  }

  async listFiles(detailed: boolean = false): Promise<SearchFileInfo[]> {
    if (!this.isOpen) throw new Error("Service not open");
    this.rebuildSortedCache();
    return Promise.all(this.sortedShards.map((s) => s.getFileInfo(detailed)));
  }

  async removeFile(timestamp: number): Promise<void> {
    if (!this.isOpen) throw new Error("Service not open");
    const startTimestamp = this.getBucketTimestamp(timestamp);
    const shard = this.shards.get(startTimestamp);
    if (shard) {
      await shard.close();
      await fs.unlink(shard.filepath).catch(() => {});
      this.shards.delete(startTimestamp);
      this.rebuildSortedCache();
      if (startTimestamp === this.latestShardTimestamp) {
        const nextLatestShard = this.sortedShards[0];
        if (nextLatestShard) await this.promoteToLatest(nextLatestShard.startTimestamp);
        else this.latestShardTimestamp = 0;
      }
    }
  }

  async removeAllFiles(): Promise<void> {
    if (!this.isOpen) throw new Error("Service not open");
    const timestamps = Array.from(this.shards.keys());
    for (const ts of timestamps) {
      await this.removeFile(ts);
    }
  }

  private getBucketTimestamp(timestamp: number): number {
    return (
      Math.floor(timestamp / this.config.bucketDurationSeconds) * this.config.bucketDurationSeconds
    );
  }

  private async getShard(timestamp: number): Promise<SearchShard> {
    const startTimestamp = this.getBucketTimestamp(timestamp);
    if (!this.shards.has(startTimestamp)) {
      if (!this.tokenizer) throw new Error("Tokenizer not initialized");
      const filename = `${this.config.namePrefix}-${startTimestamp}.db`;
      const filepath = path.join(this.config.baseDir, filename);
      const shard = new SearchShard(
        filepath,
        startTimestamp,
        this.config,
        this.tokenizer,
        this.logger,
      );
      await shard.open();
      this.shards.set(startTimestamp, shard);
      this.rebuildSortedCache();
      if (startTimestamp > this.latestShardTimestamp) await this.promoteToLatest(startTimestamp);
    }
    return this.shards.get(startTimestamp)!;
  }
}
