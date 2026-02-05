import path from "path";
import { Database } from "../utils/database";
import { SearchConfig } from "./search";

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

export type TaskRemove = {
  type: "REMOVE";
  payload: {
    docId: string;
    timestamp: number;
  };
};

export type TaskSync = {
  type: "SYNC";
  payload: Record<string, never>;
};

export type TaskOptimize = {
  type: "OPTIMIZE";
  payload: {
    targetTimestamp: number;
  };
};

export type TaskReconstruct = {
  type: "RECONSTRUCT";
  payload: {
    targetTimestamp: number;
    newInitialId?: number;
    useExternalId?: boolean;
  };
};

export type TaskReserve = {
  type: "RESERVE";
  payload: {
    targetTimestamp: number;
    ids: string[];
  };
};

export type TaskDropShard = {
  type: "DROP_SHARD";
  payload: {
    targetTimestamp: number;
  };
};

export type SearchTask =
  | TaskAdd
  | TaskRemove
  | TaskSync
  | TaskOptimize
  | TaskReconstruct
  | TaskReserve
  | TaskDropShard;

export type TaskItem = SearchTask & {
  id: number;
  createdAt: string;
};

type TaskRow = {
  id: number;
  type: SearchTask["type"];
  payload: string;
  created_at: string;
};

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

    await this.db.exec(`
      CREATE TABLE IF NOT EXISTS input_tasks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        type TEXT NOT NULL,
        payload TEXT NOT NULL,
        created_at DATETIME DEFAULT (STRFTIME('%Y-%m-%d %H:%M:%f', 'NOW'))
      );
    `);

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

  async enqueue(task: SearchTask): Promise<number> {
    if (!this.db) throw new Error("TaskQueue not open");
    const result = await this.db.run(`INSERT INTO input_tasks (type, payload) VALUES (?, ?)`, [
      task.type,
      JSON.stringify(task.payload),
    ]);
    return result.lastID;
  }

  async fetchFirst(): Promise<TaskItem | null> {
    if (!this.db) throw new Error("TaskQueue not open");
    const row = await this.db.get<TaskRow>("SELECT * FROM input_tasks ORDER BY id ASC LIMIT 1");
    if (!row) return null;
    return this.parseRow(row);
  }

  async moveToBatch(task: TaskItem): Promise<void> {
    if (!this.db) throw new Error("TaskQueue not open");
    await this.db.exec("BEGIN IMMEDIATE");
    try {
      const exists = await this.db.get<{ id: number }>("SELECT id FROM input_tasks WHERE id = ?", [
        task.id,
      ]);
      if (!exists) throw new Error(`Task ${task.id} not found in input_tasks`);

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

  async removeFromInput(id: number): Promise<void> {
    if (!this.db) throw new Error("TaskQueue not open");
    await this.db.run("DELETE FROM input_tasks WHERE id = ?", [id]);
  }

  async removeFromBatch(id: number): Promise<void> {
    if (!this.db) throw new Error("TaskQueue not open");
    await this.db.run("DELETE FROM batch_tasks WHERE id = ?", [id]);
  }

  async getPendingBatchTasks(): Promise<TaskItem[]> {
    if (!this.db) throw new Error("TaskQueue not open");
    const rows = await this.db.all<TaskRow>("SELECT * FROM batch_tasks ORDER BY id ASC");
    return rows.map((r) => this.parseRow(r));
  }

  async countInputTasks(): Promise<number> {
    if (!this.db) return 0;
    const row = await this.db.get<{ c: number }>("SELECT count(*) as c FROM input_tasks");
    return row?.c || 0;
  }

  async isPending(id: number): Promise<boolean> {
    if (!this.db) return false;
    const row = await this.db.get<{ count: number }>(
      "SELECT (SELECT COUNT(*) FROM input_tasks WHERE id = ?) + (SELECT COUNT(*) FROM batch_tasks WHERE id = ?) as count",
      [id, id]
    );
    return (row?.count ?? 0) > 0;
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
