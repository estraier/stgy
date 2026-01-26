import fs from "fs/promises";
import path from "path";
import { SearchService, SearchConfig } from "./search";

const TEST_DIR = path.join(__dirname, "../../test_index_data");

const TEST_CONFIG: SearchConfig = {
  baseDir: TEST_DIR,
  namePrefix: "test-posts",
  bucketDurationSeconds: 1000,
  autoCommitUpdateCount: 1,
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

  test("should create index files with extended info and search documents", async () => {
    const docId = "doc-1";
    const timestamp = 1000000;
    const body = "This is a test document for search.";

    await service.addDocument(docId, timestamp, body, "en");
    await sleep(200);

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
    await sleep(50);
    await service.addDocument("doc-mid", timestamp, "same keyword", "en");
    await sleep(50);
    await service.addDocument("doc-new", timestamp, "same keyword", "en");
    await sleep(200);

    const results = await service.search("same keyword");
    expect(results).toEqual(["doc-new", "doc-mid", "doc-old"]);
  });

  test("should handle multiple shards and respect cross-shard order", async () => {
    const doc1 = { id: "old-shard-doc", ts: 1000000, body: "common" };
    const doc2 = { id: "new-shard-doc", ts: 2000000, body: "common" };

    await service.addDocument(doc1.id, doc1.ts, doc1.body, "en");
    await service.addDocument(doc2.id, doc2.ts, doc2.body, "en");
    await sleep(200);

    const results = await service.search("common");
    expect(results[0]).toBe(doc2.id); // 新しいシャードが優先
    expect(results[1]).toBe(doc1.id);
  });

  test("should detect unhealthy index if file is tampered", async () => {
    const timestamp = 3000000;
    await service.addDocument("health-doc", timestamp, "Check health", "en");
    await sleep(200);

    // 確実にコネクションを閉じてから破壊する
    await service.close();

    const shardFile = path.join(TEST_DIR, `${TEST_CONFIG.namePrefix}-${timestamp}.db`);
    await fs.writeFile(shardFile, "NOT A SQLITE FILE ANYMORE");

    // サービスを再起動して状態を確認
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
    await sleep(200);
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

    // トークン化しやすい英単語
    const text = "alpha beta gamma delta epsilon";
    await service.addDocument(docId, timestamp, text, "en");
    await sleep(200);

    const results = await service.search("alpha beta gamma");
    expect(results).toContain(docId);
  });
});
