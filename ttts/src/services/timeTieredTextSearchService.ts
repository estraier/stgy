import fs from "fs/promises";
import path from "path";
import sqlite3 from "sqlite3";
import { Database } from "../utils/database";
import { Tokenizer } from "../utils/tokenizer";

export interface TimeTieredTextSearchConfig {
  baseDir: string;
  namespace: string;
  bucketDurationSeconds: number;
  autoCommitUpdateCount: number;
  autoCommitAfterLastUpdateSeconds: number;
  autoCommitAfterLastCommitSeconds: number;
  recordPositions: boolean;
  locale: string;
  readConnectionCount: number;
}

export interface TimeTieredTextSearchFileInfo {
  filename: string;
  fileSize: number;
  countDocuments: number;
  startTimestamp: number;
}

interface BatchTask {
  id: number;
  doc_id: string;
  body: string | null;
  created_at: string;
}

class SearchShard {
  public readonly filepath: string;
  public readonly startTimestamp: number;

  // 読み書き両用接続（メイン）
  private db: Database | null = null;

  // ★変更: 読み取り専用接続群（最新インデックス用・配列化）
  private readDbs: Database[] = [];
  // ★追加: ラウンドロビン用のインデックス
  private currentReadIndex: number = 0;

  private config: TimeTieredTextSearchConfig;
  private tokenizer: Tokenizer;

  // バッチ制御用
  private pendingCount: number = 0;
  private batchTimer: NodeJS.Timeout | null = null;
  private isProcessingBatch: boolean = false;

  // 負荷検知用
  private lastQueryEndTime: number = 0;

  constructor(
    filepath: string,
    startTimestamp: number,
    config: TimeTieredTextSearchConfig,
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

    // 1. WALモードを有効化
    await this.db.exec("PRAGMA journal_mode = WAL;");

    // 2. 同期モードをNORMALに
    await this.db.exec("PRAGMA synchronous = NORMAL;");

    // 3. キャッシュサイズを100KBに制限
    await this.db.exec("PRAGMA cache_size = -100;");

    // 4. mmapを無効化
    await this.db.exec("PRAGMA mmap_size = 0;");

    // 5. IDマッピング用テーブル作成
    await this.db.exec(`
      CREATE TABLE IF NOT EXISTS id_tuples (
        internal_id INTEGER PRIMARY KEY AUTOINCREMENT,
        external_id TEXT UNIQUE
      );
    `);

    // 6. FTS5仮想テーブル作成
    // ★修正: config.recordPositions に応じて detail モードを切り替え
    // trueなら 'full' (フレーズ検索可能)、falseなら 'none' (軽量化)
    const detailMode = this.config.recordPositions ? "full" : "none";

    await this.db.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS docs USING fts5(
        tokens,
        tokenize = "unicode61 categories 'L* N* Co M* P* S*' remove_diacritics 0",
        detail = '${detailMode}'
      );
    `);

    // 7. バッチ処理用タスクテーブル作成
    await this.db.exec(`
      CREATE TABLE IF NOT EXISTS batch_tasks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        doc_id TEXT NOT NULL,
        body TEXT,
        created_at DATETIME DEFAULT (STRFTIME('%Y-%m-%d %H:%M:%f', 'NOW'))
      );
    `);

    // 8. リカバリ処理
    await this.recover();
  }

  async close(): Promise<void> {
    // 1. タイマー停止
    if (this.batchTimer) {
      clearTimeout(this.batchTimer);
      this.batchTimer = null;
    }

    // 2. 残タスク処理
    if (this.pendingCount > 0) {
      await this.processBatch();
    }

    // 3. 読み取り専用接続群を閉じる
    await this.disableReadOnly();

    // 4. メイン接続を閉じる
    if (this.db) {
      await this.db.exec("PRAGMA wal_checkpoint(TRUNCATE);");
      await this.db.close();
      this.db = null;
    }
  }

  /**
   * 最新インデックスの場合に呼び出される。
   * 設定数分の読み取り専用接続を開設する。
   */
  async enableReadOnly(): Promise<void> {
    if (this.readDbs.length > 0) return;
    if (!this.db) await this.open();

    // ★修正: config.readConnectionCount 分だけループして接続
    for (let i = 0; i < this.config.readConnectionCount; i++) {
      const conn = await Database.open(this.filepath, sqlite3.OPEN_READONLY);
      this.readDbs.push(conn);
    }
  }

  /**
   * 最新でなくなった場合に呼び出される。
   * 全ての読み取り専用接続を閉じる。
   */
  async disableReadOnly(): Promise<void> {
    if (this.readDbs.length === 0) return;

    for (const conn of this.readDbs) {
      await conn.close();
    }
    this.readDbs = [];
    this.currentReadIndex = 0;
  }

  async addDocument(docId: string, bodyText: string): Promise<void> {
    if (!this.db) await this.open();
    await this.db!.run("INSERT INTO batch_tasks (doc_id, body) VALUES (?, ?)", [docId, bodyText]);
    this.onTaskAdded();
  }

  async removeDocument(docId: string): Promise<void> {
    if (!this.db) await this.open();
    await this.db!.run("INSERT INTO batch_tasks (doc_id, body) VALUES (?, ?)", [docId, null]);
    this.onTaskAdded();
  }

  /**
   * 検索処理
   * ラウンドロビンで接続を選択
   */
  async search(tokens: string[], limit: number): Promise<string[]> {
    if (!this.db) await this.open();

    const query = tokens.map((t) => `"${t}"`).join(" AND ");
    if (!query) return [];

    let targetDb = this.db!;

    // 読み取り専用接続群が存在する場合
    if (this.readDbs.length > 0) {
      const now = Date.now();
      // バッチ処理中 または アクセス殺到中
      if (this.isProcessingBatch || now - this.lastQueryEndTime < 100) {
        // ラウンドロビンで接続を選択
        targetDb = this.readDbs[this.currentReadIndex];
        // 次のインデックスへ
        this.currentReadIndex = (this.currentReadIndex + 1) % this.readDbs.length;
      }
    }

    try {
      // 修正: エイリアス 'd' を廃止し、テーブル名 'docs' を直接使用
      // docs MATCH ? -> テーブル全体に対する検索（detail=none対応）
      // docs.rowid -> FTSテーブルの行ID
      // rank -> FTS5のスコア計算用カラム（ORDER BY rankで使える）
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

  async getFileInfo(): Promise<TimeTieredTextSearchFileInfo> {
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
            await this.db.run("DELETE FROM docs WHERE rowid = ?", [internalId]);
            await this.db.run("DELETE FROM id_tuples WHERE internal_id = ?", [internalId]);
          } else {
            await this.db.run("DELETE FROM docs WHERE rowid = ?", [internalId]);
            const tokens = this.tokenizer.tokenize(task.body, this.config.locale);
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

export class TimeTieredTextSearchService {
  private config: TimeTieredTextSearchConfig;
  private shards: Map<number, SearchShard>;
  private tokenizer: Tokenizer | null = null;
  private isOpen: boolean = false;
  private latestShardTimestamp: number = 0;

  constructor(config: TimeTieredTextSearchConfig) {
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
      if (file.startsWith(this.config.namespace) && file.endsWith(".db")) {
        const prefixLength = this.config.namespace.length + 1;
        const suffixLength = 3;
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
      // ★修正: ここでは引数不要
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

  async addDocument(docId: string, timestamp: number, bodyText: string): Promise<void> {
    if (!this.isOpen || !this.tokenizer) throw new Error("Service not open");

    const shard = await this.getShard(timestamp);
    await shard.addDocument(docId, bodyText);
  }

  async removeDocument(docId: string, timestamp: number): Promise<void> {
    if (!this.isOpen) throw new Error("Service not open");

    const shard = await this.getShard(timestamp);
    await shard.removeDocument(docId);
  }

  async search(query: string, locale = "en", limit = 100, timeoutInMs = 1000): Promise<string[]> {
    if (!this.isOpen || !this.tokenizer) throw new Error("Service not open");

    const queryTokens = this.tokenizer.tokenize(query, locale);
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

  async listFiles(): Promise<TimeTieredTextSearchFileInfo[]> {
    if (!this.isOpen) throw new Error("Service not open");

    const infos: TimeTieredTextSearchFileInfo[] = [];
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

      const filename = `${this.config.namespace}-${startTimestamp}.db`;
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
