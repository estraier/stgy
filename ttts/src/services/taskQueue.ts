import path from "path";
import { Database } from "../utils/database";
import { SearchConfig } from "./search";

// --- 1. タスクの型定義 (Schema) ---

// ドキュメント追加・更新
export type TaskAdd = {
  type: "ADD";
  payload: {
    docId: string;
    timestamp: number;
    bodyText: string;
    locale: string;
    attrs?: string | null;
  };
};

// ドキュメント削除
export type TaskRemove = {
  type: "REMOVE";
  payload: {
    docId: string;
    timestamp: number;
  };
};

// 同期バリア (Control)
export type TaskSync = {
  type: "SYNC";
  payload: Record<string, never>; // Empty object
};

// インデックス最適化 (Control)
export type TaskOptimize = {
  type: "OPTIMIZE";
  payload: {
    targetTimestamp: number;
  };
};

// インデックス再構築 (Control)
export type TaskReconstruct = {
  type: "RECONSTRUCT";
  payload: {
    targetTimestamp: number;
    newInitialId?: number;
    useExternalId?: boolean;
  };
};

// ID予約 (Control/Data - Batch処理対象としうるが、今回は都度処理想定)
// ※ 設計書に基づき、RESERVEもデータ整合性に関わるためData扱いにするか、
//    あるいは管理操作として都度やるかはワーカの実装次第だが、ここでは型だけ定義。
export type TaskReserve = {
  type: "RESERVE";
  payload: {
    targetTimestamp: number;
    ids: string[];
  };
};

// ファイル物理削除 (Control)
export type TaskDropShard = {
  type: "DROP_SHARD";
  payload: {
    targetTimestamp: number;
  };
};

// 統合タスク型 (アプリケーションが扱う型)
export type SearchTask =
  | TaskAdd
  | TaskRemove
  | TaskSync
  | TaskOptimize
  | TaskReconstruct
  | TaskReserve
  | TaskDropShard;

// DB格納用の中間型 (ID付き、Payloadはパース済み)
export type TaskItem = SearchTask & {
  id: number;
  createdAt: string;
};

// DBの行データ型 (Payloadは文字列)
type TaskRow = {
  id: number;
  type: SearchTask["type"];
  payload: string;
  created_at: string;
};

// --- 2. TaskQueue クラス実装 ---

export class TaskQueue {
  private db: Database | null = null;
  private readonly dbPath: string;

  constructor(config: SearchConfig) {
    this.dbPath = path.join(config.baseDir, `${config.namePrefix}-common.db`);
  }

  async open(): Promise<void> {
    if (this.db) return;
    this.db = await Database.open(this.dbPath);
    await this.db.exec("PRAGMA journal_mode = WAL;");
    await this.db.exec("PRAGMA synchronous = NORMAL;");

    // input_tasks: 新規タスクの受け皿
    await this.db.exec(`
      CREATE TABLE IF NOT EXISTS input_tasks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        type TEXT NOT NULL,
        payload TEXT NOT NULL,
        created_at DATETIME DEFAULT (STRFTIME('%Y-%m-%d %H:%M:%f', 'NOW'))
      );
    `);

    // batch_tasks: 処理中（仕掛かり）タスクの保管場所
    // データの整合性が重要なタスクのみがここに移動される
    await this.db.exec(`
      CREATE TABLE IF NOT EXISTS batch_tasks (
        id INTEGER PRIMARY KEY,
        type TEXT NOT NULL,
        payload TEXT NOT NULL,
        created_at DATETIME
      );
    `);
  }

  async close(): Promise<void> {
    if (this.db) {
      await this.db.exec("PRAGMA wal_checkpoint(TRUNCATE);");
      await this.db.close();
      this.db = null;
    }
  }

  /**
   * タスクを追加する。
   * @returns 発行されたタスクID
   */
  async enqueue(task: SearchTask): Promise<number> {
    if (!this.db) throw new Error("TaskQueue not open");
    const result = await this.db.run(`INSERT INTO input_tasks (type, payload) VALUES (?, ?)`, [
      task.type,
      JSON.stringify(task.payload),
    ]);
    return result.lastID;
  }

  /**
   * 未処理タスクの先頭を覗き見る（削除はしない）。
   * ワーカはこのメソッドでタスクを確認し、種類に応じて処理フローを分岐する。
   */
  async fetchFirst(): Promise<TaskItem | null> {
    if (!this.db) throw new Error("TaskQueue not open");
    const row = await this.db.get<TaskRow>("SELECT * FROM input_tasks ORDER BY id ASC LIMIT 1");
    if (!row) return null;
    return this.parseRow(row);
  }

  /**
   * Data Task用: input_tasks から削除し、batch_tasks へ移動する（アトミック操作）。
   * 処理中のクラッシュに備えて永続化する。
   */
  async moveToBatch(task: TaskItem): Promise<void> {
    if (!this.db) throw new Error("TaskQueue not open");
    await this.db.exec("BEGIN IMMEDIATE");
    try {
      // 念のため存在確認をしてから移動（並行性はワーカ1つなので本来競合しないが安全のため）
      const exists = await this.db.get<{ id: number }>("SELECT id FROM input_tasks WHERE id = ?", [
        task.id,
      ]);
      if (!exists) {
        throw new Error(`Task ${task.id} not found in input_tasks`);
      }

      await this.db.run(
        `INSERT INTO batch_tasks (id, type, payload, created_at) VALUES (?, ?, ?, ?)`,
        [task.id, task.type, JSON.stringify(task.payload), task.createdAt],
      );
      await this.db.run("DELETE FROM input_tasks WHERE id = ?", [task.id]);
      await this.db.exec("COMMIT");
    } catch (e) {
      await this.db.exec("ROLLBACK");
      throw e;
    }
  }

  /**
   * Control Task用: input_tasks から物理削除する。
   * 永続化の必要がないタスクの完了処理、または処理開始前の取り出しに使用。
   */
  async removeFromInput(id: number): Promise<void> {
    if (!this.db) throw new Error("TaskQueue not open");
    await this.db.run("DELETE FROM input_tasks WHERE id = ?", [id]);
  }

  /**
   * Data Task完了用: batch_tasks から物理削除する。
   */
  async removeFromBatch(id: number): Promise<void> {
    if (!this.db) throw new Error("TaskQueue not open");
    await this.db.run("DELETE FROM batch_tasks WHERE id = ?", [id]);
  }

  /**
   * クラッシュ復旧用: batch_tasks に残っている（処理途中で終わった）タスクを取得する。
   */
  async getPendingBatchTasks(): Promise<TaskItem[]> {
    if (!this.db) throw new Error("TaskQueue not open");
    const rows = await this.db.all<TaskRow>("SELECT * FROM batch_tasks ORDER BY id ASC");
    return rows.map((r) => this.parseRow(r));
  }

  /**
   * Inputタスクの残数を取得（メトリクス用）
   */
  async countInputTasks(): Promise<number> {
    if (!this.db) return 0;
    const row = await this.db.get<{ c: number }>("SELECT count(*) as c FROM input_tasks");
    return row?.c || 0;
  }

  private parseRow(row: TaskRow): TaskItem {
    return {
      id: row.id,
      type: row.type as SearchTask["type"],
      payload: JSON.parse(row.payload),
      createdAt: row.created_at,
    } as TaskItem;
  }
}
