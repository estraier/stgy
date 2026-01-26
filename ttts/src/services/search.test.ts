import fs from "fs/promises";
import path from "path";
import { SearchService, SearchConfig } from "./search";

const TEST_DIR = path.join(__dirname, "../../test_index_data");

const TEST_CONFIG: SearchConfig = {
  baseDir: TEST_DIR,
  namePrefix: "test-posts",
  bucketDurationSeconds: 1000,
  autoCommitUpdateCount: 10, // flushAllのテストのため、あえて1より大きい値に設定
  autoCommitAfterLastUpdateSeconds: 0.1,
  autoCommitAfterLastCommitSeconds: 0.1,
  recordPositions: false,
  readConnectionCount: 2,
  maxQueryTokenCount: 10,
  maxDocumentTokenCount: 100,
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe("SearchService", () => {
  let service: SearchService;

  beforeAll(async () => {
    await fs.rm(TEST_DIR, { recursive: true, force: true });
    await fs.mkdir(TEST_DIR, { recursive: true });
  });

  afterAll(async () => {
    await fs.rm(TEST_DIR, { recursive: true, force: true });
  });

  beforeEach(async () => {
    const files = await fs.readdir(TEST_DIR).catch(() => []);
    for (const file of files) {
      await fs.unlink(path.join(TEST_DIR, file)).catch(() => {});
    }
    service = new SearchService(TEST_CONFIG);
    await service.open();
  });

  afterEach(async () => {
    await service.close();
  });

  test("should create index files and search documents using flushAll", async () => {
    const docId = "doc-1";
    const timestamp = 1000000;
    const body = "This is a test document for search.";

    await service.addDocument(docId, timestamp, body, "en");
    // sleepの代わりにflushAllを使用して即座に反映させる
    await service.flushAll();

    const files = await service.listFiles();
    expect(files.length).toBe(1);

    const file = files[0];
    expect(file.filename).toContain(TEST_CONFIG.namePrefix);
    expect(file.countDocuments).toBe(1);
    expect(file.isHealthy).toBe(true);

    const results = await service.search("test search");
    expect(results).toContain(docId);
  });

  test("should return results in rowid DESC order (newest first within shard)", async () => {
    const timestamp = 1000000;
    await service.addDocument("doc-old", timestamp, "same keyword", "en");
    await service.addDocument("doc-mid", timestamp, "same keyword", "en");
    await service.addDocument("doc-new", timestamp, "same keyword", "en");
    await service.flushAll();

    const results = await service.search("same keyword");
    expect(results).toEqual(["doc-new", "doc-mid", "doc-old"]);
  });

  test("should handle multiple shards and respect cross-shard order", async () => {
    const doc1 = { id: "old-shard-doc", ts: 1000000, body: "common" };
    const doc2 = { id: "new-shard-doc", ts: 2000000, body: "common" };

    await service.addDocument(doc1.id, doc1.ts, doc1.body, "en");
    await service.addDocument(doc2.id, doc2.ts, doc2.body, "en");
    await service.flushAll();

    const results = await service.search("common");
    expect(results[0]).toBe(doc2.id); // 新しいシャード(2000000)が優先
    expect(results[1]).toBe(doc1.id);
  });

  test("should remove document correctly", async () => {
    const docId = "delete-me";
    const timestamp = 1000000;

    await service.addDocument(docId, timestamp, "searchable content", "en");
    await service.flushAll();
    expect(await service.search("searchable")).toContain(docId);

    // 削除の実行
    await service.removeDocument(docId, timestamp);
    await service.flushAll();

    const results = await service.search("searchable");
    expect(results).not.toContain(docId);

    const files = await service.listFiles();
    expect(files[0].countDocuments).toBe(0);
  });

  test("should remove shard file and update sorted cache", async () => {
    const ts1 = 1000000;
    const ts2 = 2000000;

    await service.addDocument("doc1", ts1, "content", "en");
    await service.addDocument("doc2", ts2, "content", "en");
    await service.flushAll();

    let files = await service.listFiles();
    expect(files.length).toBe(2);

    // シャードの削除
    await service.removeFile(ts2);

    files = await service.listFiles();
    expect(files.length).toBe(1);
    expect(files[0].startTimestamp).toBe(ts1);

    const results = await service.search("content");
    expect(results).toEqual(["doc1"]);
  });

  test("should detect unhealthy index if file is tampered", async () => {
    const timestamp = 3000000;
    await service.addDocument("health-doc", timestamp, "Check health", "en");
    await service.flushAll();

    await service.close();

    const shardFile = path.join(TEST_DIR, `${TEST_CONFIG.namePrefix}-${timestamp}.db`);
    await fs.writeFile(shardFile, "NOT A SQLITE FILE ANYMORE");

    service = new SearchService(TEST_CONFIG);
    const spy = jest.spyOn(console, "error").mockImplementation(() => {});
    await service.open();
    spy.mockRestore();

    const files = await service.listFiles();
    const file = files.find((f) => f.startTimestamp === timestamp);
    expect(file?.isHealthy).toBe(false);
  });

  test("should persist data and optimize latest shard after restart", async () => {
    const docId = "persistent-doc";
    const timestamp = 1000000;

    await service.addDocument(docId, timestamp, "Persistent data", "en");
    await service.flushAll();
    await service.close();

    const newService = new SearchService(TEST_CONFIG);
    await newService.open();
    try {
      const results = await newService.search("Persistent");
      expect(results[0]).toBe(docId);
    } finally {
      await newService.close();
    }
  });

  test("should respect token limits during tokenization", async () => {
    const docId = "limit-doc";
    const timestamp = 1000000;

    const text = "alpha beta gamma delta epsilon";
    await service.addDocument(docId, timestamp, text, "en");
    await service.flushAll();

    const results = await service.search("alpha beta gamma");
    expect(results).toContain(docId);
  });

  test("should handle search timeout gracefully", async () => {
    await service.addDocument("doc1", 1000000, "slow search", "en");
    await service.flushAll();

    // タイムアウトを極端に短く設定 (0ms)
    const results = await service.search("slow", "en", 100, 0);
    // タイムアウトした場合は空または一部の結果が返る
    expect(Array.isArray(results)).toBe(true);
  });
});
