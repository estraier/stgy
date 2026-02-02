import path from "path";
import { Database } from "../utils/database";
import { IndexTask, SearchConfig } from "./search";

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
        doc_id TEXT NOT NULL,
        timestamp INTEGER NOT NULL,
        body_text TEXT,
        locale TEXT,
        attrs TEXT,
        created_at DATETIME DEFAULT (STRFTIME('%Y-%m-%d %H:%M:%f', 'NOW'))
      );
    `);

    await this.db.exec(`
      CREATE TABLE IF NOT EXISTS batch_tasks (
        id INTEGER PRIMARY KEY,
        doc_id TEXT NOT NULL,
        timestamp INTEGER NOT NULL,
        body_text TEXT,
        locale TEXT,
        attrs TEXT,
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

  async enqueue(
    docId: string,
    timestamp: number,
    bodyText: string | null,
    locale: string | null,
    attrs: string | null,
  ): Promise<void> {
    if (!this.db) throw new Error("TaskQueue not open");
    await this.db.run(
      `INSERT INTO input_tasks (doc_id, timestamp, body_text, locale, attrs) VALUES (?, ?, ?, ?, ?)`,
      [docId, timestamp, bodyText, locale, attrs],
    );
  }

  async dequeue(): Promise<IndexTask | null> {
    if (!this.db) throw new Error("TaskQueue not open");

    await this.db.exec("BEGIN IMMEDIATE");
    try {
      const task = await this.db.get<any>("SELECT * FROM input_tasks ORDER BY id ASC LIMIT 1");

      if (!task) {
        await this.db.exec("ROLLBACK");
        return null;
      }

      await this.db.run(
        `INSERT INTO batch_tasks (id, doc_id, timestamp, body_text, locale, attrs, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          task.id,
          task.doc_id,
          task.timestamp,
          task.body_text,
          task.locale,
          task.attrs,
          task.created_at,
        ],
      );

      await this.db.run("DELETE FROM input_tasks WHERE id = ?", [task.id]);

      await this.db.exec("COMMIT");

      return {
        id: task.id,
        docId: task.doc_id,
        timestamp: task.timestamp,
        bodyText: task.body_text,
        locale: task.locale,
        attrs: task.attrs,
      };
    } catch (e) {
      await this.db.exec("ROLLBACK");
      throw e;
    }
  }

  async complete(id: number): Promise<void> {
    if (!this.db) throw new Error("TaskQueue not open");
    await this.db.run("DELETE FROM batch_tasks WHERE id = ?", [id]);
  }

  async getPendingBatchTasks(): Promise<IndexTask[]> {
    if (!this.db) throw new Error("TaskQueue not open");
    const rows = await this.db.all<any>("SELECT * FROM batch_tasks ORDER BY id ASC");
    return rows.map((r) => ({
      id: r.id,
      docId: r.doc_id,
      timestamp: r.timestamp,
      bodyText: r.body_text,
      locale: r.locale,
      attrs: r.attrs,
    }));
  }

  async countInputTasks(): Promise<number> {
    if (!this.db) return 0;
    const row = await this.db.get<{ c: number }>("SELECT count(*) as c FROM input_tasks");
    return row?.c || 0;
  }
}
