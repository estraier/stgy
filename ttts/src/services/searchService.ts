import fs from "fs/promises";
import path from "path";
import sqlite3 from "sqlite3";
import { Database } from "../utils/database";
import { Tokenizer } from "../utils/tokenizer";

export type SearchConfig = {
  baseDir: string;
  namePrefix: string;
  bucketDurationSeconds: number;
  autoCommitUpdateCount: number;
  autoCommitAfterLastUpdateSeconds: number;
  autoCommitAfterLastCommitSeconds: number;
  recordPositions: boolean;
  // locale は廃止 (ドキュメントごとに指定)
  readConnectionCount: number;
  maxQueryTokenCount: number;
  maxDocumentTokenCount: number;
};

export type SearchFileInfo = {
  filename: string;
  fileSize: number;
  countDocuments: number;
  startTimestamp: number;
};

type BatchTask = {
  id: number;
  doc_id: string;
  body: string | null;
  locale: string | null;
  created_at: string;
};

class SearchShard {
  public readonly filepath: string;
  public readonly startTimestamp: number;

  private db: Database | null = null;
  private readDbs: Database[] = [];
  private currentReadIndex: number = 0;

  private config: SearchConfig;
  private tokenizer: Tokenizer;

  private pendingCount: number = 0;
  private batchTimer: NodeJS.Timeout | null = null;
  private isProcessingBatch: boolean = false;

  private lastQueryEndTime: number = 0;

  constructor(
    filepath: string,
    startTimestamp: number,
    config: SearchConfig,
    tokenizer: Tokenizer,
  ) {
    this.filepath = filepath;
    this.startTimestamp = startTimestamp;
    this.config = config;
    this.tokenizer = tokenizer;
  }

  async open(): Promise<void> {
    if (this.db) return;
    this.db = await Database.open(this.filepath);

    await this.db.exec("PRAGMA journal_mode = WAL;");
    await this.db.exec("PRAGMA synchronous = NORMAL;");
    await this.db.exec("PRAGMA cache_size = -100;");
    await this.db.exec("PRAGMA mmap_size = 0;");

    await this.db.exec(`
      CREATE TABLE IF NOT EXISTS id_tuples (
        internal_id INTEGER PRIMARY KEY AUTOINCREMENT,
        external_id TEXT UNIQUE
      );
    `);

    const detailMode = this.config.recordPositions ? "full" : "none";
    await this.db.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS docs USING fts5(
        tokens,
        tokenize = "unicode61 categories 'L* N* Co M* P* S*' remove_diacritics 0",
        detail = '${detailMode}'
      );
    `);

    await this.db.exec(`
      CREATE TABLE IF NOT EXISTS batch_tasks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        doc_id TEXT NOT NULL,
        body TEXT,
        locale TEXT,
        created_at DATETIME DEFAULT (STRFTIME('%Y-%m-%d %H:%M:%f', 'NOW'))
      );
    `);

    await this.recover();
  }

  async close(): Promise<void> {
    if (this.batchTimer) {
      clearTimeout(this.batchTimer);
      this.batchTimer = null;
    }

    if (this.pendingCount > 0) {
      await this.processBatch();
    }

    await this.disableReadOnly();

    if (this.db) {
      await this.db.exec("PRAGMA wal_checkpoint(TRUNCATE);");
      await this.db.close();
      this.db = null;
    }
  }

  async enableReadOnly(): Promise<void> {
    if (this.readDbs.length > 0) return;
    if (!this.db) await this.open();

    for (let i = 0; i < this.config.readConnectionCount; i++) {
      const conn = await Database.open(this.filepath, sqlite3.OPEN_READONLY);
      this.readDbs.push(conn);
    }
  }

  async disableReadOnly(): Promise<void> {
    if (this.readDbs.length === 0) return;

    for (const conn of this.readDbs) {
      await conn.close();
    }
    this.readDbs = [];
    this.currentReadIndex = 0;
  }

  async addDocument(docId: string, bodyText: string, locale: string): Promise<void> {
    if (!this.db) await this.open();
    await this.db!.run("INSERT INTO batch_tasks (doc_id, body, locale) VALUES (?, ?, ?)", [
      docId,
      bodyText,
      locale,
    ]);
    this.onTaskAdded();
  }

  async removeDocument(docId: string): Promise<void> {
    if (!this.db) await this.open();
    await this.db!.run("INSERT INTO batch_tasks (doc_id, body, locale) VALUES (?, ?, ?)", [
      docId,
      null,
      null,
    ]);
    this.onTaskAdded();
  }

  async search(tokens: string[], limit: number): Promise<string[]> {
    if (!this.db) await this.open();

    const query = tokens.map((t) => `"${t}"`).join(" AND ");
    if (!query) return [];

    let targetDb = this.db!;

    if (this.readDbs.length > 0) {
      const now = Date.now();
      if (this.isProcessingBatch || now - this.lastQueryEndTime < 100) {
        targetDb = this.readDbs[this.currentReadIndex];
        this.currentReadIndex = (this.currentReadIndex + 1) % this.readDbs.length;
      }
    }

    try {
      const rows = await targetDb.all<{ external_id: string }>(
        `SELECT t.external_id
         FROM docs
         JOIN id_tuples t ON docs.rowid = t.internal_id
         WHERE docs MATCH ?
         ORDER BY rank
         LIMIT ?`,
        [query, limit],
      );
      return rows.map((r) => r.external_id);
    } finally {
      this.lastQueryEndTime = Date.now();
    }
  }

  async getFileInfo(): Promise<SearchFileInfo> {
    const stats = await fs.stat(this.filepath);
    let count = 0;
    if (this.db) {
      const row = await this.db.get<{ c: number }>("SELECT count(*) as c FROM id_tuples");
      count = row?.c || 0;
    }
    return {
      filename: path.basename(this.filepath),
      fileSize: stats.size,
      countDocuments: count,
      startTimestamp: this.startTimestamp,
    };
  }

  private onTaskAdded() {
    this.pendingCount++;
    if (this.pendingCount >= this.config.autoCommitUpdateCount) {
      this.processBatch();
      return;
    }
    if (!this.batchTimer) {
      const delay = Math.min(
        this.config.autoCommitAfterLastUpdateSeconds * 1000,
        this.config.autoCommitAfterLastCommitSeconds * 1000,
      );
      this.batchTimer = setTimeout(() => {
        this.batchTimer = null;
        this.processBatch();
      }, delay);
    }
  }

  private async processBatch() {
    if (this.isProcessingBatch || !this.db) return;
    this.isProcessingBatch = true;

    try {
      const tasks = await this.db.all<BatchTask>("SELECT * FROM batch_tasks ORDER BY id ASC");
      if (tasks.length === 0) {
        this.pendingCount = 0;
        return;
      }

      await this.db.exec("BEGIN TRANSACTION");

      for (const task of tasks) {
        try {
          let internalId: number | undefined;
          const row = await this.db.get<{ internal_id: number }>(
            "SELECT internal_id FROM id_tuples WHERE external_id = ?",
            [task.doc_id],
          );

          if (row) {
            internalId = row.internal_id;
          } else {
            if (task.body === null) continue;
            await this.db.run("INSERT INTO id_tuples (external_id) VALUES (?)", [task.doc_id]);
            const lastRow = await this.db.get<{ id: number }>("SELECT last_insert_rowid() as id");
            internalId = lastRow!.id;
          }

          if (task.body === null) {
            // 削除処理
            await this.db.run("DELETE FROM docs WHERE rowid = ?", [internalId]);
            await this.db.run("DELETE FROM id_tuples WHERE internal_id = ?", [internalId]);
          } else {
            // 追加・更新処理
            await this.db.run("DELETE FROM docs WHERE rowid = ?", [internalId]);

            const locale = task.locale || "en";
            let tokens = this.tokenizer.tokenize(task.body, locale);

            // ドキュメントの最大トークン数制限
            if (tokens.length > this.config.maxDocumentTokenCount) {
              tokens = tokens.slice(0, this.config.maxDocumentTokenCount);
            }

            const tokenizedBody = tokens.join(" ");
            await this.db.run("INSERT INTO docs (rowid, tokens) VALUES (?, ?)", [
              internalId,
              tokenizedBody,
            ]);
          }
        } catch (e) {
          console.error(`Failed to process task ${task.id}:`, e);
        }
      }

      await this.db.run("DELETE FROM batch_tasks");
      await this.db.exec("COMMIT");

      this.pendingCount = 0;
    } catch (e) {
      console.error("Batch processing failed:", e);
      await this.db.exec("ROLLBACK");
    } finally {
      this.isProcessingBatch = false;
    }
  }

  private async recover() {
    const row = await this.db!.get<{ c: number }>("SELECT count(*) as c FROM batch_tasks");
    if (row && row.c > 0) {
      this.pendingCount = row.c;
      await this.processBatch();
    }
  }
}

export class SearchService {
  private config: SearchConfig;
  private shards: Map<number, SearchShard>;
  private tokenizer: Tokenizer | null = null;
  private isOpen: boolean = false;
  private latestShardTimestamp: number = 0;

  constructor(config: SearchConfig) {
    this.config = config;
    this.shards = new Map();
  }

  async open(): Promise<void> {
    if (this.isOpen) return;

    this.tokenizer = await Tokenizer.create();
    await fs.mkdir(this.config.baseDir, { recursive: true });

    const files = await fs.readdir(this.config.baseDir);
    let maxTimestamp = 0;

    for (const file of files) {
      if (file.startsWith(this.config.namePrefix) && file.endsWith(".db")) {
        // ファイル形式: {namePrefix}-{timestamp}.db
        const prefixLength = this.config.namePrefix.length + 1; // +1 for '-'
        const suffixLength = 3; // '.db'
        const timestampStr = file.substring(prefixLength, file.length - suffixLength);
        const timestamp = parseInt(timestampStr, 10);

        if (!isNaN(timestamp)) {
          const filepath = path.join(this.config.baseDir, file);
          const shard = new SearchShard(filepath, timestamp, this.config, this.tokenizer);
          await shard.open();
          this.shards.set(timestamp, shard);

          if (timestamp > maxTimestamp) {
            maxTimestamp = timestamp;
          }
        }
      }
    }

    this.isOpen = true;

    if (this.shards.size > 0) {
      this.latestShardTimestamp = maxTimestamp;
      await this.shards.get(maxTimestamp)?.enableReadOnly();
    }
  }

  async close(): Promise<void> {
    if (!this.isOpen) return;
    for (const shard of this.shards.values()) {
      await shard.close();
    }
    this.shards.clear();
    this.tokenizer = null;
    this.isOpen = false;
    this.latestShardTimestamp = 0;
  }

  async addDocument(
    docId: string,
    timestamp: number,
    bodyText: string,
    locale: string,
  ): Promise<void> {
    if (!this.isOpen || !this.tokenizer) throw new Error("Service not open");

    const shard = await this.getShard(timestamp);
    await shard.addDocument(docId, bodyText, locale);
  }

  async removeDocument(docId: string, timestamp: number): Promise<void> {
    if (!this.isOpen) throw new Error("Service not open");

    const shard = await this.getShard(timestamp);
    await shard.removeDocument(docId);
  }

  async search(query: string, locale = "en", limit = 100, timeoutInMs = 1000): Promise<string[]> {
    if (!this.isOpen || !this.tokenizer) throw new Error("Service not open");

    let queryTokens = this.tokenizer.tokenize(query, locale);

    // クエリの最大トークン数制限
    if (queryTokens.length > this.config.maxQueryTokenCount) {
      queryTokens = queryTokens.slice(0, this.config.maxQueryTokenCount);
    }

    if (queryTokens.length === 0) return [];

    const sortedShards = Array.from(this.shards.values()).sort(
      (a, b) => b.startTimestamp - a.startTimestamp,
    );

    const results = new Set<string>();
    const startTime = Date.now();

    for (const shard of sortedShards) {
      if (Date.now() - startTime > timeoutInMs) break;
      if (results.size >= limit) break;

      const shardResults = await shard.search(queryTokens, limit - results.size);
      for (const id of shardResults) {
        results.add(id);
      }
    }

    return Array.from(results).slice(0, limit);
  }

  async listFiles(): Promise<SearchFileInfo[]> {
    if (!this.isOpen) throw new Error("Service not open");

    const infos: SearchFileInfo[] = [];
    for (const shard of this.shards.values()) {
      infos.push(await shard.getFileInfo());
    }
    return infos.sort((a, b) => b.startTimestamp - a.startTimestamp);
  }

  async removeFile(timestamp: number): Promise<void> {
    if (!this.isOpen) throw new Error("Service not open");

    const startTimestamp = this.getBucketTimestamp(timestamp);
    const shard = this.shards.get(startTimestamp);

    if (shard) {
      await shard.close();
      await fs.unlink(shard.filepath);
      this.shards.delete(startTimestamp);

      if (startTimestamp === this.latestShardTimestamp) {
        let nextLatest = 0;
        for (const ts of this.shards.keys()) {
          if (ts > nextLatest) nextLatest = ts;
        }
        if (nextLatest > 0) {
          this.latestShardTimestamp = nextLatest;
          await this.shards.get(nextLatest)?.enableReadOnly();
        } else {
          this.latestShardTimestamp = 0;
        }
      }
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
      const shard = new SearchShard(filepath, startTimestamp, this.config, this.tokenizer);
      await shard.open();
      this.shards.set(startTimestamp, shard);

      if (startTimestamp > this.latestShardTimestamp) {
        if (this.latestShardTimestamp > 0) {
          await this.shards.get(this.latestShardTimestamp)?.disableReadOnly();
        }
        this.latestShardTimestamp = startTimestamp;
        await shard.enableReadOnly();
      }
    }

    return this.shards.get(startTimestamp)!;
  }
}
