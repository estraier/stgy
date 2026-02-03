import { Database } from "../../src/utils/database";

describe("Database", () => {
  let db: Database;

  beforeEach(async () => {
    db = await Database.open(":memory:");
  });

  afterEach(async () => {
    await db.close();
  });

  test("exec should execute SQL without returning rows", async () => {
    await expect(
      db.exec("CREATE TABLE test (id INTEGER PRIMARY KEY, name TEXT)"),
    ).resolves.not.toThrow();
  });

  test("run should insert data", async () => {
    await db.exec("CREATE TABLE test (id INTEGER PRIMARY KEY, name TEXT)");
    await expect(db.run("INSERT INTO test (name) VALUES (?)", ["Alice"])).resolves.not.toThrow();
  });

  test("get should return a single row", async () => {
    await db.exec("CREATE TABLE test (id INTEGER PRIMARY KEY, name TEXT)");
    await db.run("INSERT INTO test (name) VALUES (?)", ["Alice"]);

    const row = await db.get<{ id: number; name: string }>("SELECT * FROM test WHERE name = ?", [
      "Alice",
    ]);

    expect(row).toBeDefined();
    expect(row?.id).toBe(1);
    expect(row?.name).toBe("Alice");
  });

  test("get should return undefined if no row found", async () => {
    await db.exec("CREATE TABLE test (id INTEGER PRIMARY KEY, name TEXT)");
    const row = await db.get("SELECT * FROM test WHERE id = 999");
    expect(row).toBeUndefined();
  });

  test("all should return multiple rows", async () => {
    await db.exec("CREATE TABLE test (val INTEGER)");
    await db.run("INSERT INTO test (val) VALUES (?)", [10]);
    await db.run("INSERT INTO test (val) VALUES (?)", [20]);
    await db.run("INSERT INTO test (val) VALUES (?)", [30]);

    const rows = await db.all<{ val: number }>("SELECT val FROM test ORDER BY val ASC");

    expect(rows).toHaveLength(3);
    expect(rows[0].val).toBe(10);
    expect(rows[1].val).toBe(20);
    expect(rows[2].val).toBe(30);
  });

  test("all should return empty array if no rows found", async () => {
    await db.exec("CREATE TABLE test (val INTEGER)");
    const rows = await db.all("SELECT * FROM test");
    expect(rows).toEqual([]);
  });

  test("run should throw error on invalid SQL", async () => {
    await expect(db.run("INSERT INTO non_existent_table VALUES (1)")).rejects.toThrow();
  });

  test("get should throw error on invalid SQL", async () => {
    await expect(db.get("SELECT * FROM non_existent_table")).rejects.toThrow();
  });
});
