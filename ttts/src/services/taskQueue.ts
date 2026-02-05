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
  payload: { docId: string; timestamp: number };
};
export type TaskSync = { type: "SYNC"; payload: Record<string, never> };
export type TaskOptimize = { type: "OPTIMIZE"; payload: { targetTimestamp: number } };
export type TaskReconstruct = {
  type: "RECONSTRUCT";
  payload: { targetTimestamp: number; newInitialId?: number; useExternalId?: boolean };
};
export type TaskReserve = { type: "RESERVE"; payload: { targetTimestamp: number; ids: string[] } };
export type TaskDropShard = { type: "DROP_SHARD"; payload: { targetTimestamp: number } };

export type DocumentTask = TaskAdd | TaskRemove;
export type ManagementTask =
  | TaskSync
  | TaskOptimize
  | TaskReconstruct
  | TaskReserve
  | TaskDropShard;
export type SearchTask = DocumentTask | ManagementTask;

export type TaskItem<T extends SearchTask = SearchTask> = T & {
  id: string;
};

type TaskRow = {
  id: number;
  type: string;
  payload: string;
};

abstract class BaseTaskQueue<T extends SearchTask> {
  protected db: Database | null = null;
  protected readonly dbPath: string;
  protected abstract readonly tableName: string;
  protected abstract readonly prefix: string;

  constructor(config: SearchConfig) {
    this.dbPath = path.join(config.baseDir, `${config.namePrefix}-common.db`);
  }

  async open(): Promise<void> {
    if (this.db) return;
    this.db = await Database.open(this.dbPath);
    await this.db.exec("PRAGMA journal_mode = WAL;");
    await this.db.exec("PRAGMA synchronous = NORMAL;");

    await this.db.exec(`
      CREATE TABLE IF NOT EXISTS ${this.tableName} (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        type TEXT NOT NULL,
        payload TEXT NOT NULL
      );
    `);
    await this.initSchema();
  }

  protected async initSchema(): Promise<void> {}

  async close(): Promise<void> {
    if (this.db) {
      await this.db.exec("PRAGMA wal_checkpoint(TRUNCATE);");
      await this.db.close();
      this.db = null;
    }
  }

  async enqueue(task: T): Promise<string> {
    if (!this.db) throw new Error("Queue not open");
    const result = await this.db.run(
      `INSERT INTO ${this.tableName} (type, payload) VALUES (?, ?)`,
      [task.type, JSON.stringify(task.payload)],
    );
    return `${this.prefix}-${result.lastID}`;
  }

  async fetchFirst(): Promise<TaskItem<T> | null> {
    if (!this.db) throw new Error("Queue not open");
    const row = await this.db.get<TaskRow>(
      `SELECT * FROM ${this.tableName} ORDER BY id ASC LIMIT 1`,
    );
    if (!row) return null;
    return this.parseRow(row);
  }

  async removeFromInput(id: string): Promise<void> {
    if (!this.db) throw new Error("Queue not open");
    const numericId = parseInt(id.split("-")[1], 10);
    await this.db.run(`DELETE FROM ${this.tableName} WHERE id = ?`, [numericId]);
  }

  async countInputTasks(): Promise<number> {
    if (!this.db) return 0;
    const row = await this.db.get<{ c: number }>(`SELECT count(*) as c FROM ${this.tableName}`);
    return row?.c || 0;
  }

  abstract isPending(id: string): Promise<boolean>;

  protected parseRow(row: TaskRow): TaskItem<T> {
    return {
      id: `${this.prefix}-${row.id}`,
      type: row.type,
      payload: JSON.parse(row.payload),
    } as unknown as TaskItem<T>;
  }
}

export class ManagementTaskQueue extends BaseTaskQueue<ManagementTask> {
  protected readonly tableName = "management_tasks";
  protected readonly prefix = "m";

  async isPending(id: string): Promise<boolean> {
    if (!this.db || !id.startsWith("m-")) return false;
    const numericId = parseInt(id.split("-")[1], 10);
    const row = await this.db.get<{ count: number }>(
      `SELECT COUNT(*) as count FROM ${this.tableName} WHERE id = ?`,
      [numericId],
    );
    return (row?.count ?? 0) > 0;
  }
}

export class DocumentTaskQueue extends BaseTaskQueue<DocumentTask> {
  protected readonly tableName = "document_tasks";
  protected readonly prefix = "d";

  protected async initSchema(): Promise<void> {
    await this.db!.exec(`
      CREATE TABLE IF NOT EXISTS batch_tasks (
        id INTEGER PRIMARY KEY,
        type TEXT NOT NULL,
        payload TEXT NOT NULL
      );
    `);
  }

  async moveToBatch(task: TaskItem<DocumentTask>): Promise<void> {
    if (!this.db) throw new Error("Queue not open");
    const numericId = parseInt(task.id.split("-")[1], 10);
    await this.db.exec("BEGIN IMMEDIATE");
    try {
      const exists = await this.db.get<{ id: number }>(
        `SELECT id FROM ${this.tableName} WHERE id = ?`,
        [numericId],
      );
      if (!exists) throw new Error(`Task ${task.id} not found`);
      await this.db.run(
        `INSERT INTO batch_tasks (id, type, payload) VALUES (?, ?, ?)`,
        [numericId, task.type, JSON.stringify(task.payload)],
      );
      await this.db.run(`DELETE FROM ${this.tableName} WHERE id = ?`, [numericId]);
      await this.db.exec("COMMIT");
    } catch (e) {
      await this.db.exec("ROLLBACK");
      throw e;
    }
  }

  async removeFromBatch(id: string): Promise<void> {
    if (!this.db) throw new Error("Queue not open");
    const numericId = parseInt(id.split("-")[1], 10);
    await this.db.run("DELETE FROM batch_tasks WHERE id = ?", [numericId]);
  }

  async getPendingBatchTasks(): Promise<TaskItem<DocumentTask>[]> {
    if (!this.db) throw new Error("Queue not open");
    const rows = await this.db.all<TaskRow>("SELECT * FROM batch_tasks ORDER BY id ASC");
    return rows.map((r) => this.parseRow(r));
  }

  async isPending(id: string): Promise<boolean> {
    if (!this.db || !id.startsWith("d-")) return false;
    const numericId = parseInt(id.split("-")[1], 10);
    const row = await this.db.get<{ count: number }>(
      `SELECT (SELECT COUNT(*) FROM ${this.tableName} WHERE id = ?) + (SELECT COUNT(*) FROM batch_tasks WHERE id = ?) as count`,
      [numericId, numericId],
    );
    return (row?.count ?? 0) > 0;
  }
}
