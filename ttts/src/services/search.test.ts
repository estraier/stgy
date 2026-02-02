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

const TEST_DIR = "./test_data_search_service";
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
    await fs.rm(TEST_DIR, { recursive: true, force: true });
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
    await service.enqueueTask("doc1", 1000, "hello world", "en", null);
    await waitForCondition(async () => (await service.search("hello")).includes("doc1"));
  });

  test("Token Normalization and Deduplication", async () => {
    await service.enqueueTask("doc1", 1000, "  apple   apple banana  ", "en", null);
    await waitForCondition(async () => (await service.search("apple")).includes("doc1"));
    const results = await service.fetchDocuments(["doc1"]);
    expect(results[0].bodyText).toBe("apple banana");
  });

  test("Startup Recovery", async () => {
    await service.close();
    const manual = new SearchService(CONFIG, mockLogger);
    await manual.open({ startWorker: false });
    await manual.enqueueTask("recovery1", 1000, "recovery test", "en", null);
    await manual.close();
    service = new SearchService(CONFIG, mockLogger);
    await service.open();
    expect(await service.search("recovery")).toContain("recovery1");
  });

  test("Update", async () => {
    await service.enqueueTask("doc1", 1000, "hello", "en", null);
    await waitForCondition(async () => (await service.search("hello")).includes("doc1"));
    await service.enqueueTask("doc1", 1000, "moon", "en", null);
    await waitForCondition(async () => {
      const oldResults = await service.search("hello");
      const newResults = await service.search("moon");
      return !oldResults.includes("doc1") && newResults.includes("doc1");
    });
  });

  test("Delete", async () => {
    await service.enqueueTask("doc1", 1000, "hello", "en", null);
    await waitForCondition(async () => (await service.search("hello")).includes("doc1"));
    await service.enqueueTask("doc1", 1000, null, null, null);
    await waitForCondition(async () => {
      const results = await service.search("hello");
      return !results.includes("doc1");
    });
  });

  test("Sharding", async () => {
    await service.enqueueTask("docA", 1000, "apple", "en", null);
    await service.enqueueTask("docB", 1150, "banana", "en", null);
    await waitForCondition(
      async () =>
        (await service.search("apple")).includes("docA") &&
        (await service.search("banana")).includes("docB"),
    );
    expect((await service.listIndexFiles()).length).toBe(2);
  });

  test("Maintenance Mode: pauses worker", async () => {
    await service.startMaintenanceMode();
    await new Promise((r) => setTimeout(r, 200));
    await service.enqueueTask("doc1", 1000, "waiting", "en", null);
    await new Promise((r) => setTimeout(r, 300));
    expect(await service.search("waiting")).not.toContain("doc1");
    await service.endMaintenanceMode();
    await waitForCondition(async () => (await service.search("waiting")).includes("doc1"));
  });

  test("Management: reserveIds", async () => {
    await service.startMaintenanceMode();
    await service.reserveIds([{ id: "res", timestamp: 1000 }]);
    await service.endMaintenanceMode();
    await service.enqueueTask("res", 1000, "content", "en", null);
    await waitForCondition(async () => (await service.search("content")).includes("res"));
  });

  test("Management: reconstructIndexFile", async () => {
    await service.enqueueTask("doc1", 1000, "data", "en", null);
    await waitForCondition(async () => (await service.search("data")).includes("doc1"));
    await service.startMaintenanceMode();
    await service.reconstructIndexFile(1000);
    await service.endMaintenanceMode();
    expect(await service.search("data")).toContain("doc1");
  });

  test("Management: optimizeShard", async () => {
    await service.enqueueTask("doc1", 1000, "data", "en", null);
    await waitForCondition(async () => (await service.search("data")).includes("doc1"));
    await service.optimizeShard(1000);
    expect(await service.search("data")).toContain("doc1");
  });

  test("Management: removeIndexFile physically deletes file", async () => {
    await service.enqueueTask("doc1", 1000, "data", "en", null);
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
});
