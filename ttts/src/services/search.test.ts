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
  initialDocumentId: 1000,
  recordPositions: false,
  recordContents: true,
  readConnectionCounts: [1, 0],
  mmapSizes: [268435456, 0],
  cacheSizes: [25165824, 409600],
  automergeLevels: [8, 2],
  maxQueryTokenCount: 10,
  maxDocumentTokenCount: 100,
};

const waitForCondition = async (
  check: () => Promise<boolean>,
  timeoutMs: number = 2000,
  intervalMs: number = 20,
): Promise<void> => {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  throw new Error("Timeout waiting for condition");
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
    try {
      const files = await fs.readdir(TEST_DIR);
      await Promise.all(files.map((file) => fs.unlink(path.join(TEST_DIR, file)).catch(() => {})));
    } catch {}

    service = new SearchService(CONFIG, mockLogger);
    await service.open();
  });

  afterEach(async () => {
    await service.close();
  });

  test("Basic Flow: enqueue -> worker processing -> search", async () => {
    await service.enqueueTask("doc1", 1000, "hello world", "en", null);

    await waitForCondition(async () => {
      const res = await service.search("hello");
      return res.includes("doc1");
    });

    const results = await service.search("hello");
    expect(results).toContain("doc1");
    expect(results.length).toBe(1);
  });

  test("Update: overwrites existing document", async () => {
    await service.enqueueTask("doc1", 1000, "hello world", "en", null);

    await waitForCondition(async () => {
      const res = await service.search("hello");
      return res.includes("doc1");
    });

    await service.enqueueTask("doc1", 1000, "goodbye moon", "en", null);

    await waitForCondition(async () => {
      const oldRes = await service.search("hello");
      const newRes = await service.search("moon");
      return oldRes.length === 0 && newRes.includes("doc1");
    });

    expect(await service.search("hello")).toEqual([]);
    expect(await service.search("moon")).toContain("doc1");
  });

  test("Delete: removes document", async () => {
    await service.enqueueTask("doc1", 1000, "hello world", "en", null);

    await waitForCondition(async () => {
      const res = await service.search("hello");
      return res.includes("doc1");
    });

    await service.enqueueTask("doc1", 1000, null, null, null);

    await waitForCondition(async () => {
      const res = await service.search("hello");
      return res.length === 0;
    });

    expect(await service.search("hello")).toEqual([]);
  });

  test("Sharding: creates separate files for different time buckets", async () => {
    await service.enqueueTask("docA", 1000, "apple", "en", null);
    await service.enqueueTask("docB", 1150, "banana", "en", null);

    await waitForCondition(async () => {
      const resA = await service.search("apple");
      const resB = await service.search("banana");
      return resA.includes("docA") && resB.includes("docB");
    });

    const files = await service.listIndexFiles();
    expect(files.length).toBe(2);

    const timestamps = files.map((f) => f.startTimestamp).sort();
    expect(timestamps).toEqual([1000, 1100]);
  });

  test("Maintenance Mode: pauses worker", async () => {
    await service.startMaintenanceMode();
    expect(await service.checkMaintenanceMode()).toBe(true);

    await service.enqueueTask("doc1", 1000, "waiting", "en", null);

    await new Promise((r) => setTimeout(r, 100));

    let results = await service.search("waiting");
    expect(results).toEqual([]);

    await service.endMaintenanceMode();

    await waitForCondition(async () => {
      const res = await service.search("waiting");
      return res.includes("doc1");
    });
  });

  test("Management: reserveIds reserves internal IDs", async () => {
    await service.startMaintenanceMode();
    await service.reserveIds([{ id: "docReserved", timestamp: 1000 }]);
    await service.endMaintenanceMode();

    await service.enqueueTask("docReserved", 1000, "reserved content", "en", null);

    await waitForCondition(async () => {
      const res = await service.search("reserved");
      return res.includes("docReserved");
    });
  });

  test("Management: reconstructIndexFile preserves data", async () => {
    await service.enqueueTask("doc1", 1000, "reconstruct me", "en", null);

    await waitForCondition(async () => {
      const res = await service.search("reconstruct");
      return res.includes("doc1");
    });

    await service.startMaintenanceMode();
    await service.reconstructIndexFile(1000);
    await service.endMaintenanceMode();

    const results = await service.search("reconstruct");
    expect(results).toContain("doc1");
  });

  test("Management: optimizeShard optimizes the index", async () => {
    await service.enqueueTask("doc1", 1000, "optimize me", "en", null);

    await waitForCondition(async () => {
      const res = await service.search("optimize");
      return res.includes("doc1");
    });

    await service.optimizeShard(1000);

    const results = await service.search("optimize");
    expect(results).toContain("doc1");
  });

  test("Management: removeIndexFile physically deletes file", async () => {
    await service.enqueueTask("doc1", 1000, "content", "en", null);

    await waitForCondition(async () => {
      const files = await service.listIndexFiles();
      return files.length === 1;
    });

    await service.startMaintenanceMode();
    await service.removeIndexFile(1000);
    await service.endMaintenanceMode();

    const files = await service.listIndexFiles();
    expect(files.length).toBe(0);

    const fsFiles = await fs.readdir(TEST_DIR);
    const indexFiles = fsFiles.filter(
      (f) => f.startsWith("test_search-") && f.endsWith(".db") && !f.includes("common"),
    );
    expect(indexFiles.length).toBe(0);
  });
});
