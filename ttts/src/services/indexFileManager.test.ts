import fs from "fs/promises";
import path from "path";
import { Database } from "../utils/database";
import { IndexFileManager } from "./indexFileManager";
import { SearchConfig } from "./search";

const TEST_DIR = "./test_data_manager";
const TEST_CONFIG: SearchConfig = {
  baseDir: TEST_DIR,
  namePrefix: "test_idx",
  bucketDurationSeconds: 1000,
  autoCommitUpdateCount: 10,
  autoCommitDurationSeconds: 1,
  initialDocumentId: 10000,
  recordPositions: false,
  recordContents: true,
  readConnectionCounts: [1],
  maxQueryTokenCount: 10,
  maxDocumentTokenCount: 100,
};

describe("IndexFileManager", () => {
  let manager: IndexFileManager;

  beforeAll(async () => {
    await fs.mkdir(TEST_DIR, { recursive: true });
  });

  afterAll(async () => {
    await fs.rm(TEST_DIR, { recursive: true, force: true });
  });

  beforeEach(() => {
    manager = new IndexFileManager(TEST_CONFIG);
  });

  afterEach(async () => {
    const files = await fs.readdir(TEST_DIR);
    for (const file of files) {
      await fs.unlink(path.join(TEST_DIR, file)).catch(() => {});
    }
  });

  async function createDummyDb(timestamp: number, valid: boolean = true) {
    const filepath = manager.getFilePath(timestamp);
    if (!valid) {
      await fs.writeFile(filepath, "invalid data");
      return;
    }

    const db = await Database.open(filepath);
    await db.exec("PRAGMA journal_mode = WAL;");
    await db.exec("CREATE TABLE id_tuples (internal_id INTEGER, external_id TEXT);");
    await db.exec("CREATE VIRTUAL TABLE docs USING fts5(tokens);");

    await db.run("INSERT INTO id_tuples VALUES (1, 'doc1')");
    await db.run("INSERT INTO docs(rowid, tokens) VALUES (1, 'hello world')");

    await db.close();
  }

  test("getBucketTimestamp calculates correct start time", () => {
    expect(manager.getBucketTimestamp(1500)).toBe(1000);
    expect(manager.getBucketTimestamp(2999)).toBe(2000);
  });

  test("getFilePath returns correct path", () => {
    const expected = path.join(TEST_DIR, "test_idx-1000.db");
    expect(manager.getFilePath(1500)).toBe(expected);
  });

  test("listIndexFiles returns empty array when no files exist", async () => {
    const files = await manager.listIndexFiles();
    expect(files).toEqual([]);
  });

  test("listIndexFiles returns info for valid databases", async () => {
    await createDummyDb(1000);
    await createDummyDb(2000);

    const files = await manager.listIndexFiles();
    expect(files.length).toBe(2);
    expect(files[0].startTimestamp).toBe(2000);
    expect(files[1].startTimestamp).toBe(1000);
    expect(files[0].isHealthy).toBe(true);
    expect(files[0].countDocuments).toBe(1);
  });

  test("listIndexFiles handles invalid files", async () => {
    await createDummyDb(1000, true);
    await createDummyDb(2000, false);

    const files = await manager.listIndexFiles();
    expect(files.length).toBe(2);

    const valid = files.find(f => f.startTimestamp === 1000);
    const invalid = files.find(f => f.startTimestamp === 2000);

    expect(valid?.isHealthy).toBe(true);
    expect(invalid?.isHealthy).toBe(false);
  });

  test("removeIndexFile deletes db and wal files", async () => {
    await createDummyDb(1000);
    const filepath = manager.getFilePath(1000);
    await fs.writeFile(filepath + "-wal", "dummy wal data");

    const walExistsBefore = await fs.stat(filepath + "-wal").then(() => true).catch(() => false);
    expect(walExistsBefore).toBe(true);

    await manager.removeIndexFile(1000);

    const dbExists = await fs.stat(filepath).then(() => true).catch(() => false);
    const walExists = await fs.stat(filepath + "-wal").then(() => true).catch(() => false);

    expect(dbExists).toBe(false);
    expect(walExists).toBe(false);
  });

  test("removeAllIndexFiles deletes all relevant files", async () => {
    await createDummyDb(1000);
    await createDummyDb(2000);
    await fs.writeFile(path.join(TEST_DIR, "other.txt"), "dummy");

    await manager.removeAllIndexFiles();

    const files = await fs.readdir(TEST_DIR);
    expect(files).toEqual(["other.txt"]);
  });
});
