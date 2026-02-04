import fs from "fs/promises";
import path from "path";
import { IndexFileManager } from "./indexFileManager";
import { SearchConfig } from "./search";
import { Database } from "../utils/database";

const TEST_DIR = "./test_data_file_manager";

const MOCK_CONFIG = {
  baseDir: TEST_DIR,
  namePrefix: "test_idx",
  bucketDurationSeconds: 100,
} as SearchConfig;

describe("IndexFileManager", () => {
  let manager: IndexFileManager;

  beforeAll(async () => {
    await fs.mkdir(TEST_DIR, { recursive: true });
  });

  afterAll(async () => {
    await new Promise((r) => setTimeout(r, 100));
    await fs.rm(TEST_DIR, { recursive: true, force: true }).catch(() => {});
  });

  beforeEach(async () => {
    const files = await fs.readdir(TEST_DIR).catch(() => []);
    for (const f of files) await fs.unlink(path.join(TEST_DIR, f)).catch(() => {});
    manager = new IndexFileManager(MOCK_CONFIG);
  });

  test("getBucketTimestamp rounds down correctly", () => {
    expect(manager.getBucketTimestamp(0)).toBe(0);
    expect(manager.getBucketTimestamp(99)).toBe(0);
    expect(manager.getBucketTimestamp(100)).toBe(100);
    expect(manager.getBucketTimestamp(150)).toBe(100);
    expect(manager.getBucketTimestamp(123456)).toBe(123400);
  });

  test("getFilePath constructs correct path", () => {
    const ts = 100;
    const expected = path.join(TEST_DIR, "test_idx-100.db");
    expect(manager.getFilePath(ts)).toBe(expected);
  });

  test("listIndexFiles returns sorted file list", async () => {
    await Database.open(manager.getFilePath(100)).then((db) => db.close());
    await Database.open(manager.getFilePath(200)).then((db) => db.close());
    await Database.open(manager.getFilePath(0)).then((db) => db.close());

    await fs.writeFile(path.join(TEST_DIR, "other.txt"), "dummy");

    const files = await manager.listIndexFiles();

    expect(files).toHaveLength(3);
    expect(files[0].startTimestamp).toBe(200);
    expect(files[1].startTimestamp).toBe(100);
    expect(files[2].startTimestamp).toBe(0);

    expect(files[0].isHealthy).toBe(true);
  });

  test("listIndexFiles(detailed=true) populates stats", async () => {
    const ts = 100;
    const dbPath = manager.getFilePath(ts);
    const db = await Database.open(dbPath);

    await db.exec(`
      CREATE TABLE id_tuples (internal_id INTEGER PRIMARY KEY, external_id TEXT);
      CREATE VIRTUAL TABLE docs USING fts5(tokens);
    `);

    await db.run("INSERT INTO id_tuples (internal_id, external_id) VALUES (1, 'doc1')");
    await db.run("INSERT INTO docs (tokens) VALUES ('hello world this is a test content')");

    await db.close();

    const files = await manager.listIndexFiles(true);

    expect(files).toHaveLength(1);
    const info = files[0];

    expect(info.startTimestamp).toBe(ts);
    expect(info.countDocuments).toBe(1);

    expect(info.pageSize).toBeGreaterThan(0);
    expect(info.totalPageCount).toBeGreaterThan(0);

    expect(info.idTuplesPayloadSize).toBeGreaterThan(0);

    expect(info.ftsIndexPayloadSize).toBeGreaterThan(0);
    expect(info.ftsIndexBlockCount).toBeGreaterThan(0);

    expect(info.ftsContentPayloadSize).toBeGreaterThan(0);
  });

  test("removeIndexFile physically deletes files", async () => {
    const ts = 100;
    const dbPath = manager.getFilePath(ts);

    const db = await Database.open(dbPath);
    await db.exec("PRAGMA journal_mode = WAL; CREATE TABLE t(a);");
    await db.close();

    expect(
      await fs
        .stat(dbPath)
        .then(() => true)
        .catch(() => false),
    ).toBe(true);

    await manager.removeIndexFile(ts);

    expect(
      await fs
        .stat(dbPath)
        .then(() => true)
        .catch(() => false),
    ).toBe(false);
    expect(
      await fs
        .stat(`${dbPath}-wal`)
        .then(() => true)
        .catch(() => false),
    ).toBe(false);
    expect(
      await fs
        .stat(`${dbPath}-shm`)
        .then(() => true)
        .catch(() => false),
    ).toBe(false);
  });
});
