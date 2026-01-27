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
  readConnectionCount: number;
  maxQueryTokenCount: number;
  maxDocumentTokenCount: number;
};

export type SearchFileInfo = {
  filename: string;
  fileSize: number;
  countDocuments: number;
  startTimestamp: number;
  endTimestamp: number;
  isHealthy: boolean;
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
  public db: Database | null = null;

  private readDbs: Database[] = [];
  private currentReadIndex: number = 0;
  private _isHealthy: boolean = true;

  private config: SearchConfig;
  private tokenizer: Tokenizer;

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
  ) {
    this.filepath = filepath;
    this.startTimestamp = startTimestamp;
    this.config = config;
    this.tokenizer = tokenizer;
  }

  async open(): Promise<void> {
    if (this.db || this.isClosing) return;
    try {
      this.db = await Database.open(this.filepath);
      await this.db.exec("PRAGMA journal_mode = WAL;");
      await this.db.exec("PRAGMA synchronous = NORMAL;");

      // デフォルトは最小限 (100ページ * 8KB = 約0.8MB)
      await this.db.exec("PRAGMA cache_size = 100;");
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

      // ページサイズを8KBに設定
      await this.db
        .exec("INSERT OR REPLACE INTO docs_config(k, v) VALUES('pgsz', 8192);")
        .catch(() => {});

      await this.db.exec(`
        CREATE TABLE IF NOT EXISTS batch_tasks (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          doc_id TEXT NOT NULL,
          body TEXT,
          locale TEXT,
          created_at DATETIME DEFAULT (STRFTIME('%Y-%m-%d %H:%M:%f', 'NOW'))
        );
      `);

      this._isHealthy = true;
      await this.recover();
    } catch (e) {
      this._isHealthy = false;
      console.error(`Failed to open shard ${this.filepath}:`, e);
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
  }

  /**
   * インデックスを最適化し、全セグメントを1つに統合する。
   * これにより検索速度の向上とファイルサイズの削減が行われる。
   */
  async optimize(): Promise<void> {
    if (!this.db || !this._isHealthy) return;
    try {
      await this.flush();
      // FTS5の最適化コマンド
      await this.db.exec("INSERT INTO docs(docs) VALUES('optimize');");
      // 未使用領域の解放とWALの反映
      await this.db.exec("PRAGMA wal_checkpoint(TRUNCATE);");
      await this.db.exec("VACUUM;");
    } catch (e) {
      console.error(`Optimize failed on ${this.filepath}:`, e);
    }
  }

  async enableReadOnly(): Promise<void> {
    if (this.readDbs.length > 0 || !this._isHealthy || this.isClosing) return;
    if (!this.db) await this.open();
    if (!this.db) return;

    for (let i = 0; i < this.config.readConnectionCount; i++) {
      try {
        const conn = await Database.open(this.filepath, sqlite3.OPEN_READONLY);
        this.readDbs.push(conn);
      } catch (e) {
        console.error(`Failed to open read-only connection for ${this.filepath}`, e);
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

  async addDocument(docId: string, bodyText: string, locale: string): Promise<void> {
    if (!this._isHealthy || this.isClosing) return;
    if (!this.db) await this.open();
    if (!this.db) return;

    await this.db.run("INSERT INTO batch_tasks (doc_id, body, locale) VALUES (?, ?, ?)", [
      docId,
      bodyText,
      locale,
    ]);
    this.onTaskAdded();
  }

  async removeDocument(docId: string): Promise<void> {
    if (!this._isHealthy || this.isClosing) return;
    if (!this.db) await this.open();
    if (!this.db) return;

    await this.db.run("INSERT INTO batch_tasks (doc_id, body, locale) VALUES (?, ?, ?)", [
      docId,
      null,
      null,
    ]);
    this.onTaskAdded();
  }

  async search(tokens: string[], limit: number): Promise<string[]> {
    if (!this._isHealthy || !this.db) return [];

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
        `SELECT t.external_id
         FROM docs
         JOIN id_tuples t ON docs.rowid = t.internal_id
         WHERE docs MATCH ?
         ORDER BY docs.rowid DESC
         LIMIT ?`,
        [query, limit],
      );
      return rows.map((r) => r.external_id);
    } catch (e) {
      console.error(`Search failed on ${this.filepath}:`, e);
      return [];
    } finally {
      this.lastQueryEndTime = Date.now();
    }
  }

  async getFileInfo(): Promise<SearchFileInfo> {
    let count = 0;
    let fileSize = 0;
    let currentHealthy = this._isHealthy;

    try {
      const stats = await fs.stat(this.filepath);
      fileSize = stats.size;

      if (currentHealthy) {
        if (!this.db) await this.open();
        if (this.db) {
          const row = await this.db.get<{ c: number }>("SELECT count(*) as c FROM id_tuples");
          count = row?.c || 0;
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
    if (this.isProcessingBatch || !this.db || !this._isHealthy) return;
    this.isProcessingBatch = true;

    try {
      const tasks = await this.db.all<BatchTask>("SELECT * FROM batch_tasks ORDER BY id ASC");
      const taskCount = tasks.length;
      if (taskCount === 0) {
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
            await this.db.run("DELETE FROM docs WHERE rowid = ?", [internalId]);
            await this.db.run("DELETE FROM id_tuples WHERE internal_id = ?", [internalId]);
          } else {
            await this.db.run("DELETE FROM docs WHERE rowid = ?", [internalId]);
            const tokens = this.tokenizer
              .tokenize(task.body, task.locale || "en")
              .slice(0, this.config.maxDocumentTokenCount);
            await this.db.run("INSERT INTO docs (rowid, tokens) VALUES (?, ?)", [
              internalId,
              tokens.join(" "),
            ]);
          }
        } catch (e) {
          console.error(`Task execution error for ${task.doc_id}:`, e);
        }
      }

      await this.db.run(
        "DELETE FROM batch_tasks WHERE id IN (" + tasks.map((t) => t.id).join(",") + ")",
      );
      await this.db.exec("COMMIT");
      this.pendingCount = Math.max(0, this.pendingCount - taskCount);
    } catch (e) {
      console.error("Batch processing failed:", e);
      if (this.db) await this.db.exec("ROLLBACK").catch(() => {});
    } finally {
      this.isProcessingBatch = false;
      if (this.pendingCount >= this.config.autoCommitUpdateCount && !this.isClosing) {
        setImmediate(() => this.processBatch().catch(() => {}));
      }
    }
  }

  private async recover() {
    if (!this.db || !this._isHealthy) return;
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
        const prefixLength = this.config.namePrefix.length + 1;
        const ts = parseInt(file.substring(prefixLength, file.length - 3), 10);

        if (!isNaN(ts)) {
          const filepath = path.join(this.config.baseDir, file);
          const shard = new SearchShard(filepath, ts, this.config, this.tokenizer);
          await shard.open();
          this.shards.set(ts, shard);
          if (ts > maxTimestamp) maxTimestamp = ts;
        }
      }
    }

    this.rebuildSortedCache();
    this.isOpen = true;

    if (this.shards.size > 0) {
      await this.promoteToLatest(maxTimestamp);
    }
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
    if (!this.isOpen || !this.tokenizer) {
      throw new Error("Service not open");
    }
    return this.tokenizer;
  }

  private rebuildSortedCache(): void {
    this.sortedShards = Array.from(this.shards.values()).sort(
      (a, b) => b.startTimestamp - a.startTimestamp,
    );
  }

  /**
   * 最新のインデックスを昇格させ、古いインデックスを最適化・アーカイブ化する。
   */
  private async promoteToLatest(timestamp: number): Promise<void> {
    const shard = this.shards.get(timestamp);
    if (!shard) return;

    // 前回の最新シャードをアーカイブ設定（省メモリ・省サイズ）に変更
    if (this.latestShardTimestamp > 0 && this.latestShardTimestamp !== timestamp) {
      const oldShard = this.shards.get(this.latestShardTimestamp);
      if (oldShard && oldShard.db) {
        // キャッシュを最小限に (100ページ = 約0.8MB)
        await oldShard.db.exec("PRAGMA cache_size = 100;");
        await oldShard.db.exec("PRAGMA mmap_size = 0;");
        // マージを積極的に行う設定 (automerge=2)
        await oldShard.db.exec("INSERT OR REPLACE INTO docs_config(k, v) VALUES('automerge', 2);").catch(() => {});
        await oldShard.disableReadOnly();

        // 非同期で最適化とVACUUMを実行
        oldShard.optimize().catch((e) => console.error("Auto-optimization failed:", e));
      }
    }

    this.latestShardTimestamp = timestamp;

    if (shard.db) {
      // 最新シャードのキャッシュを 24MB (3000ページ * 8KB) に設定
      await shard.db.exec("PRAGMA cache_size = 3000;");
      // mmapも 256MB 割り当て
      await shard.db.exec("PRAGMA mmap_size = 268435456;");
      // 書き込み速度優先 (マージを溜める automerge=8)
      await shard.db.exec("INSERT OR REPLACE INTO docs_config(k, v) VALUES('automerge', 8);").catch(() => {});
      await shard.enableReadOnly();
    }
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

    const tokens = this.tokenizer.tokenize(query, locale).slice(0, this.config.maxQueryTokenCount);
    if (tokens.length === 0) return [];

    const results = new Set<string>();
    const startTime = Date.now();

    for (const shard of this.sortedShards) {
      if (Date.now() - startTime > timeoutInMs) break;
      if (results.size >= limit) break;

      const shardResults = await shard.search(tokens, limit - results.size);
      for (const id of shardResults) {
        results.add(id);
      }
    }

    return Array.from(results).slice(0, limit);
  }

  async listFiles(): Promise<SearchFileInfo[]> {
    if (!this.isOpen) throw new Error("Service not open");
    this.rebuildSortedCache();
    return Promise.all(this.sortedShards.map((s) => s.getFileInfo()));
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
        if (nextLatestShard) {
          await this.promoteToLatest(nextLatestShard.startTimestamp);
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

      this.rebuildSortedCache();

      if (startTimestamp > this.latestShardTimestamp) {
        await this.promoteToLatest(startTimestamp);
      }
    }

    return this.shards.get(startTimestamp)!;
  }
}
