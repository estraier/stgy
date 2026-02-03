import fs from "fs/promises";
import path from "path";
import { SearchService, SearchConfig } from "./search";
import { Logger } from "pino";

const mockLogger = {
  info: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
  warn: jest.fn(),
  child: () => mockLogger,
} as unknown as Logger;

// 他のテスト（indexFileManagerなど）と干渉しないよう、このクラス専用のディレクトリ名にする
const TEST_DIR = "./test_data_search_service_main";
const CONFIG: SearchConfig = {
  baseDir: TEST_DIR,
  namePrefix: "test_search",
  bucketDurationSeconds: 100,
  autoCommitUpdateCount: 1,
  autoCommitDurationSeconds: 0.1,
  commitCheckIntervalSeconds: 0.01,
  updateWorkerBusySleepSeconds: 0.001,
  updateWorkerIdleSleepSeconds: 0.001,
  initialDocumentId: 1000,
  recordPositions: false,
  recordContents: true,
  readConnectionCounts: [1, 1],
  mmapSizes: [0, 0],
  cacheSizes: [409600, 409600],
  automergeLevels: [2, 2],
  maxQueryTokenCount: 10,
  maxDocumentTokenCount: 100,
};

const waitForCondition = async (check: () => Promise<boolean>, timeout = 3000) => {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (await check()) return;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error("Timeout");
};

describe("SearchService", () => {
  let service: SearchService;

  beforeAll(async () => {
    await fs.mkdir(TEST_DIR, { recursive: true });
  });

  afterAll(async () => {
    // 確実にリソースを解放するため少し待ってから削除
    await new Promise((r) => setTimeout(r, 100));
    await fs.rm(TEST_DIR, { recursive: true, force: true }).catch(() => {});
  });

  beforeEach(async () => {
    const files = await fs.readdir(TEST_DIR).catch(() => []);
    for (const f of files) await fs.unlink(path.join(TEST_DIR, f)).catch(() => {});
    service = new SearchService(CONFIG, mockLogger);
    await service.open();
  });

  afterEach(async () => {
    if (service) await service.close();
  });

  test("Basic Flow", async () => {
    await service.enqueueTask("doc_basic", 1000, "hello world", "en", null);
    await waitForCondition(async () => (await service.search("hello")).includes("doc_basic"));
  });

  test("Token Normalization", async () => {
    await service.enqueueTask("doc_norm", 1000, "  apple    apple banana  ", "en", null);
    await waitForCondition(async () => (await service.search("apple")).includes("doc_norm"));
    const results = await service.fetchDocuments(["doc_norm"]);
    expect(results[0].bodyText).toBe("apple apple banana");
  });

  test("Startup Recovery", async () => {
    await service.close();
    const manual = new SearchService(CONFIG, mockLogger);
    await manual.open({ startWorker: false });
    await manual.enqueueTask("doc_recovery", 1000, "recovery test", "en", null);
    await manual.close();
    service = new SearchService(CONFIG, mockLogger);
    await service.open();
    expect(await service.search("recovery")).toContain("doc_recovery");
  });

  test("Update", async () => {
    await service.enqueueTask("doc_update", 1000, "hello", "en", null);
    await waitForCondition(async () => (await service.search("hello")).includes("doc_update"));
    await service.enqueueTask("doc_update", 1000, "moon", "en", null);
    await waitForCondition(async () => {
      const oldResults = await service.search("hello");
      const newResults = await service.search("moon");
      return !oldResults.includes("doc_update") && newResults.includes("doc_update");
    });
  });

  test("Delete", async () => {
    await service.enqueueTask("doc_delete", 1000, "hello", "en", null);
    await waitForCondition(async () => (await service.search("hello")).includes("doc_delete"));
    await service.enqueueTask("doc_delete", 1000, null, null, null);
    await waitForCondition(async () => {
      const results = await service.search("hello");
      return !results.includes("doc_delete");
    });
  });

  test("Sharding", async () => {
    await service.enqueueTask("doc_shard_A", 1000, "apple", "en", null);
    await service.enqueueTask("doc_shard_B", 1150, "banana", "en", null);
    await waitForCondition(
      async () =>
        (await service.search("apple")).includes("doc_shard_A") &&
        (await service.search("banana")).includes("doc_shard_B"),
    );
    expect((await service.listIndexFiles()).length).toBe(2);
  });

  test("Maintenance Mode: pauses worker", async () => {
    await service.startMaintenanceMode();
    await new Promise((r) => setTimeout(r, 200));
    await service.enqueueTask("doc_maint", 1000, "waiting", "en", null);
    await new Promise((r) => setTimeout(r, 300));
    expect(await service.search("waiting")).not.toContain("doc_maint");
    await service.endMaintenanceMode();
    await waitForCondition(async () => (await service.search("waiting")).includes("doc_maint"));
  });

  test("Management: reserveIds", async () => {
    await service.startMaintenanceMode();
    await service.reserveIds([{ id: "doc_res", timestamp: 1000 }]);
    await service.endMaintenanceMode();
    await service.enqueueTask("doc_res", 1000, "content", "en", null);
    await waitForCondition(async () => (await service.search("content")).includes("doc_res"));
  });

  test("Management: reconstructIndexFile", async () => {
    await service.enqueueTask("doc_reconstruct", 1000, "data", "en", null);
    await waitForCondition(async () => (await service.search("data")).includes("doc_reconstruct"));
    await service.startMaintenanceMode();
    await service.reconstructIndexFile(1000);
    await service.endMaintenanceMode();
    expect(await service.search("data")).toContain("doc_reconstruct");
  });

  test("Management: optimizeShard", async () => {
    await service.enqueueTask("doc_optimize", 1000, "data", "en", null);
    await waitForCondition(async () => (await service.search("data")).includes("doc_optimize"));
    await service.optimizeShard(1000);
    expect(await service.search("data")).toContain("doc_optimize");
  });

  test("Management: removeIndexFile physically deletes file", async () => {
    await service.enqueueTask("doc_remove", 1000, "data", "en", null);
    await waitForCondition(async () => (await service.listIndexFiles()).length === 1);
    await service.startMaintenanceMode();
    await service.removeIndexFile(1000);
    await service.endMaintenanceMode();
    expect((await service.listIndexFiles()).length).toBe(0);
    const fsFiles = await fs.readdir(TEST_DIR);
    const indexFiles = fsFiles.filter(
      (f) => f.startsWith("test_search-") && f.endsWith(".db") && !f.includes("common"),
    );
    expect(indexFiles.length).toBe(0);
  });

  test("Pseudo-Phrase Search (recordPositions: false)", async () => {
    await service.enqueueTask("doc_pseudo", 1000, "alpha beta gamma", "en", null);
    await waitForCondition(async () => (await service.search("alpha")).includes("doc_pseudo"));
    const hitsAnd = await service.search("alpha gamma");
    expect(hitsAnd).toContain("doc_pseudo");
    const hitsPhraseMiss = await service.search('"alpha gamma"');
    expect(hitsPhraseMiss).not.toContain("doc_pseudo");
    const hitsPhraseHit = await service.search('"alpha beta"');
    expect(hitsPhraseHit).toContain("doc_pseudo");
  });

  test("Native Phrase Search (recordPositions: true)", async () => {
    await service.close();
    const configFull = { ...CONFIG, recordPositions: true };
    service = new SearchService(configFull, mockLogger);
    await service.open();
    await service.enqueueTask("doc_native", 2000, "alpha beta gamma", "en", null);
    await waitForCondition(async () => (await service.search("alpha")).includes("doc_native"));
    const hitsPhraseMiss = await service.search('"alpha gamma"');
    expect(hitsPhraseMiss).not.toContain("doc_native");
    const hitsPhraseHit = await service.search('"alpha beta"');
    expect(hitsPhraseHit).toContain("doc_native");
  });
});
