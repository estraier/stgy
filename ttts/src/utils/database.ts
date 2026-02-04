import sqlite3 from "sqlite3";

export type RunResult = {
  lastID: number;
  changes: number;
};

export class Database {
  private db: sqlite3.Database;

  private constructor(db: sqlite3.Database) {
    this.db = db;
  }

  public static open(
    filename: string,
    mode: number = sqlite3.OPEN_READWRITE | sqlite3.OPEN_CREATE,
  ): Promise<Database> {
    return new Promise((resolve, reject) => {
      const db = new sqlite3.Database(filename, mode, (err) => {
        if (err) {
          reject(err);
        } else {
          resolve(new Database(db));
        }
      });
    });
  }

  public close(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.db.close((err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  }

  public run(
    sql: string,
    params: (string | number | boolean | null | undefined | Buffer)[] = [],
  ): Promise<RunResult> {
    return new Promise((resolve, reject) => {
      this.db.run(sql, params, function (err) {
        if (err) {
          reject(err);
        } else {
          resolve({
            lastID: this.lastID,
            changes: this.changes,
          });
        }
      });
    });
  }

  public get<T>(
    sql: string,
    params: (string | number | boolean | null | undefined | Buffer)[] = [],
  ): Promise<T | undefined> {
    return new Promise((resolve, reject) => {
      this.db.get(sql, params, (err, row) => {
        if (err) reject(err);
        else resolve(row as T);
      });
    });
  }

  public all<T>(
    sql: string,
    params: (string | number | boolean | null | undefined | Buffer)[] = [],
  ): Promise<T[]> {
    return new Promise((resolve, reject) => {
      this.db.all(sql, params, (err, rows) => {
        if (err) reject(err);
        else resolve(rows as T[]);
      });
    });
  }

  public exec(sql: string): Promise<void> {
    return new Promise((resolve, reject) => {
      this.db.exec(sql, (err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  }
}
