import path from "path";
import { Database } from "../utils/database";

export type InputQueueConfig = {
  // ディレクトリのパス。例: "/var/stgy/search-index"
  baseDir: string;
  // ファイル名の接頭辞。例: "posts"
  namePrefix: string;
};

export type InputTask = {
  id: number;
  doc_id: string;
  timestamp: number;
  bodyText: string | null; // nullの場合は削除タスク
  locale: string | null;
  created_at: string;
};

export class InputQueueService {
  private config: InputQueueConfig;
  private db: Database | null = null;
  private dbPath: string;

  constructor(config: InputQueueConfig) {
    this.config = config;
    // リソース種別ごとにファイルを分けるため、接頭辞を含めたファイル名にする
    // 例: /var/stgy/search-index/posts-input_tasks.db
    this.dbPath = path.join(this.config.baseDir, `${this.config.namePrefix}-input_tasks.db`);
  }

  async open(): Promise<void> {
    if (this.db) return;

    this.db = await Database.open(this.dbPath);

    // 高速化のためのPRAGMA設定
    await this.db.exec("PRAGMA journal_mode = WAL;");
    await this.db.exec("PRAGMA synchronous = NORMAL;");
    await this.db.exec("PRAGMA cache_size = -2000;"); // 約2MB

    // テーブル作成
    // 仕様書のスキーマ定義に準拠 (body -> bodyText)
    await this.db.exec(`
      CREATE TABLE IF NOT EXISTS input_tasks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        doc_id TEXT NOT NULL,
        timestamp INTEGER NOT NULL,
        bodyText TEXT,
        locale TEXT,
        created_at DATETIME DEFAULT (STRFTIME('%Y-%m-%d %H:%M:%f', 'NOW'))
      );
    `);
  }

  async close(): Promise<void> {
    if (!this.db) return;
    // 終了時は安全にチェックポイントを行う
    await this.db.exec("PRAGMA wal_checkpoint(TRUNCATE);");
    await this.db.close();
    this.db = null;
  }

  /**
   * タスクをキューに追加する
   */
  async enqueue(
    docId: string,
    timestamp: number,
    bodyText: string | null,
    locale: string | null,
  ): Promise<void> {
    if (!this.db) await this.open();
    await this.db!.run(
      "INSERT INTO input_tasks (doc_id, timestamp, bodyText, locale) VALUES (?, ?, ?, ?)",
      [docId, timestamp, bodyText, locale],
    );
  }

  /**
   * タスクをキューから取り出す
   */
  async dequeue(limit: number = 100): Promise<InputTask[]> {
    if (!this.db) await this.open();
    return this.db!.all<InputTask>("SELECT * FROM input_tasks ORDER BY id ASC LIMIT ?", [limit]);
  }

  /**
   * タスクをキューから削除する
   */
  async deleteTasks(ids: number[]): Promise<void> {
    if (!this.db || ids.length === 0) return;

    const placeholders = ids.map(() => "?").join(",");
    await this.db.run(`DELETE FROM input_tasks WHERE id IN (${placeholders})`, ids);
  }

  /**
   * キュー内のタスクの数を取得する
   */
  async count(): Promise<number> {
    if (!this.db) return 0;
    const row = await this.db.get<{ c: number }>("SELECT count(*) as c FROM input_tasks");
    return row?.c || 0;
  }
}
