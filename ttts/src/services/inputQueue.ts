import path from "path";
import { Database } from "../utils/database";

export interface InputTask {
  id: number;
  doc_id: string;
  timestamp: number; // どの時間のシャードに入れるべきか判断するために保持
  body: string | null; // nullの場合は削除リクエスト
  created_at: string;
}

export class InputQueue {
  private db: Database | null = null;
  private baseDir: string;
  private dbPath: string;

  constructor(baseDir: string) {
    this.baseDir = baseDir;
    // タスクキューは全ネームスペース共有、あるいはネームスペースごとに分ける設計も可能だが、
    // 仕様書の文脈では検索サーバー全体で1つのキュー(input_tasks.db)を持つ想定と思われる。
    // ここでは設定されたbaseDir直下に配置する。
    this.dbPath = path.join(this.baseDir, "input_tasks.db");
  }

  async open(): Promise<void> {
    if (this.db) return;

    this.db = await Database.open(this.dbPath);

    // 高速化のためのチューニング
    // APIレスポンス速度に直結するため、WALモードとNORMAL同期は必須
    await this.db.exec("PRAGMA journal_mode = WAL;");
    await this.db.exec("PRAGMA synchronous = NORMAL;");
    // キューは頻繁に読み書きされるがサイズは小さいはずなので、キャッシュはデフォルトか少なめで良い
    await this.db.exec("PRAGMA cache_size = -2000;"); // 約2MB

    // 仕様書通りのスキーマ定義
    await this.db.exec(`
      CREATE TABLE IF NOT EXISTS tasks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,      -- FIFO用の連番ID
        doc_id TEXT NOT NULL,                      -- Snowflake ID 等の文書ID
        timestamp INTEGER NOT NULL,                -- インデックス振分け用の秒数
        body TEXT,                                 -- 文書本文（NULLの場合は削除タスク）
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
   * タスクを追加する (APIサーバーが呼ぶ)
   * ここは極めて高速である必要がある
   */
  async enqueue(docId: string, timestamp: number, body: string | null): Promise<void> {
    if (!this.db) await this.open();
    await this.db!.run("INSERT INTO tasks (doc_id, timestamp, body) VALUES (?, ?, ?)", [
      docId,
      timestamp,
      body,
    ]);
  }

  /**
   * 古いタスクから順に取得する (ワーカーが呼ぶ)
   */
  async dequeue(limit: number = 100): Promise<InputTask[]> {
    if (!this.db) await this.open();
    return this.db!.all<InputTask>("SELECT * FROM tasks ORDER BY id ASC LIMIT ?", [limit]);
  }

  /**
   * 処理済みタスクを削除する (ワーカーが呼ぶ)
   * batch_tasksへの移動が完了した後に実行される
   */
  async deleteTasks(ids: number[]): Promise<void> {
    if (!this.db || ids.length === 0) return;

    // プレースホルダを生成 (?, ?, ?)
    const placeholders = ids.map(() => "?").join(",");
    await this.db.run(`DELETE FROM tasks WHERE id IN (${placeholders})`, ids);
  }

  /**
   * 現在のキュー滞留数を取得 (モニタリング用)
   */
  async count(): Promise<number> {
    if (!this.db) return 0;
    const row = await this.db.get<{ c: number }>("SELECT count(*) as c FROM tasks");
    return row?.c || 0;
  }
}
