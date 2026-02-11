import fs from "fs/promises";
import path from "path";
import { SearchService, SearchConfig } from "./search";
import { Logger } from "pino";
import { SearchTask } from "./taskQueue";

const mockLogger = {
  info: jest.fn(),
  error: (obj: unknown, msg?: string) => console.error(msg, obj),
  debug: jest.fn(),
  warn: jest.fn(),
  child: () => mockLogger,
} as unknown as Logger;

const TEST_DIR = "./test_data_search_service_actor";

const CONFIG: SearchConfig = {
  baseDir: TEST_DIR,
  namePrefix: "test_search",
  bucketDurationSeconds: 100,
  autoCommitUpdateCount: 1000,
  autoCommitDurationSeconds: 0.3,
  commitCheckIntervalSeconds: 0.1,
  updateWorkerBusySleepSeconds: 0.001,
  updateWorkerIdleSleepSeconds: 0.01,
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

describe("SearchService (Actor Model)", () => {
  let service: SearchService;

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

    service = new SearchService(CONFIG, mockLogger);
    await service.open();
  });

  afterEach(async () => {
    if (service) await service.close();
  });

  const runTask = async (task: SearchTask, sync = true) => {
    const taskId = await service.enqueueTask(task);
    await service.waitTask(taskId);

    if (sync && (task.type === "ADD" || task.type === "REMOVE" || task.type === "RESERVE")) {
      const syncId = await service.enqueueTask({ type: "SYNC", payload: {} });
      await service.waitTask(syncId);
    }

    return taskId;
  };

  test("Basic Flow: Add and Search", async () => {
    const taskId = await runTask({
      type: "ADD",
      payload: { docId: "doc_1", timestamp: 1000, bodyText: "hello world", locale: "en" },
    });
    expect(taskId).toMatch(/^d-/);

    const results = await service.search("hello");
    expect(results).toContain("doc_1");
  });

  test("Auto-commit: should commit transaction after duration expires", async () => {
    await runTask(
      {
        type: "ADD",
        payload: { docId: "warmup", timestamp: 1000, bodyText: "warmup", locale: "en" },
      },
      true,
    );

    await runTask(
      {
        type: "ADD",
        payload: { docId: "auto_1", timestamp: 1000, bodyText: "automatic commit", locale: "en" },
      },
      false,
    );

    const immediateRes = await service.search("automatic");
    expect(immediateRes).not.toContain("auto_1");

    await new Promise((r) => setTimeout(r, 800));

    const lateRes = await service.search("automatic");
    expect(lateRes).toContain("auto_1");
  });

  test("Update: Overwrite existing document", async () => {
    await runTask({
      type: "ADD",
      payload: { docId: "doc_upd", timestamp: 1000, bodyText: "version one", locale: "en" },
    });
    expect(await service.search("version")).toContain("doc_upd");

    await runTask({
      type: "ADD",
      payload: { docId: "doc_upd", timestamp: 1000, bodyText: "version two", locale: "en" },
    });

    const oldRes = await service.search("one");
    const newRes = await service.search("two");

    expect(oldRes).not.toContain("doc_upd");
    expect(newRes).toContain("doc_upd");
  });

  test("Delete: Remove document", async () => {
    await runTask({
      type: "ADD",
      payload: { docId: "doc_del", timestamp: 1000, bodyText: "delete me", locale: "en" },
    });
    expect(await service.search("delete")).toContain("doc_del");

    await runTask({
      type: "REMOVE",
      payload: { docId: "doc_del", timestamp: 1000 },
    });

    const results = await service.search("delete");
    expect(results).not.toContain("doc_del");
  });

  test("Sharding: Multiple files created", async () => {
    await runTask({
      type: "ADD",
      payload: { docId: "shard_A", timestamp: 100, bodyText: "apple", locale: "en" },
    });
    await runTask({
      type: "ADD",
      payload: { docId: "shard_B", timestamp: 250, bodyText: "banana", locale: "en" },
    });

    const files = await service.listIndexFiles();
    expect(files.length).toBe(2);

    const resA = await service.search("apple");
    const resB = await service.search("banana");
    expect(resA).toContain("shard_A");
    expect(resB).toContain("shard_B");
  });

  test("Management: SYNC (Barrier)", async () => {
    const taskId = await runTask({ type: "SYNC", payload: {} }, false);
    expect(taskId).toMatch(/^m-/);
  });

  test("Management: OPTIMIZE", async () => {
    await runTask({
      type: "ADD",
      payload: { docId: "doc_opt", timestamp: 1000, bodyText: "optimize me", locale: "en" },
    });

    await runTask(
      {
        type: "OPTIMIZE",
        payload: { targetTimestamp: 1000 },
      },
      false,
    );

    expect(await service.search("optimize")).toContain("doc_opt");
  });

  test("Management: RECONSTRUCT", async () => {
    await runTask({
      type: "ADD",
      payload: { docId: "doc_rec", timestamp: 1000, bodyText: "reconstruct me", locale: "en" },
    });

    await runTask(
      {
        type: "RECONSTRUCT",
        payload: { targetTimestamp: 1000 },
      },
      false,
    );

    expect(await service.search("reconstruct")).toContain("doc_rec");
  });

  test("Management: DROP_SHARD", async () => {
    await runTask({
      type: "ADD",
      payload: { docId: "doc_drop", timestamp: 1000, bodyText: "drop me", locale: "en" },
    });
    expect((await service.listIndexFiles()).length).toBe(1);

    await runTask(
      {
        type: "DROP_SHARD",
        payload: { targetTimestamp: 1000 },
      },
      false,
    );

    expect((await service.listIndexFiles()).length).toBe(0);
    expect(await service.search("drop")).toEqual([]);
  });

  test("Management: RESERVE", async () => {
    await runTask(
      {
        type: "RESERVE",
        payload: {
          documents: [
            { id: "res_1", timestamp: 1000 },
            { id: "res_2", timestamp: 2000 },
          ],
        },
      },
      false,
    );
  });

  test("Maintenance Mode: pauses worker", async () => {
    await service.startMaintenanceMode();

    const taskId = await service.enqueueTask({
      type: "ADD",
      payload: { docId: "doc_maint", timestamp: 1000, bodyText: "waiting", locale: "en" },
    });

    await new Promise((r) => setTimeout(r, 200));

    expect(await service.search("waiting")).not.toContain("doc_maint");

    await service.endMaintenanceMode();

    await service.waitTask(taskId);
    const syncId = await service.enqueueTask({ type: "SYNC", payload: {} });
    await service.waitTask(syncId);

    expect(await service.search("waiting")).toContain("doc_maint");
  });

  test("Recovery: Data persists across restart", async () => {
    await runTask({
      type: "ADD",
      payload: { docId: "doc_persist", timestamp: 1000, bodyText: "I will survive", locale: "en" },
    });

    await service.close();

    service = new SearchService(CONFIG, mockLogger);
    await service.open();

    expect(await service.search("survive")).toContain("doc_persist");
  });

  test("Fetch Documents", async () => {
    await runTask({
      type: "ADD",
      payload: {
        docId: "doc_fetch",
        timestamp: 1000,
        bodyText: "content body",
        locale: "en",
        attrs: JSON.stringify({ key: "val" }),
      },
    });

    const docs = await service.fetchDocuments(["doc_fetch"]);
    expect(docs).toHaveLength(1);
    expect(docs[0].id).toBe("doc_fetch");
    expect(docs[0].bodyText).toBe("content body");
    expect(docs[0].attrs).toBe(JSON.stringify({ key: "val" }));
  });

  test("clearTaskQueue: should clear pending tasks", async () => {
    await service.startMaintenanceMode();

    await service.enqueueTask({
      type: "ADD",
      payload: { docId: "q1", timestamp: 1000, bodyText: "queue test 1", locale: "en" },
    });
    await service.enqueueTask({
      type: "ADD",
      payload: { docId: "q2", timestamp: 1000, bodyText: "queue test 2", locale: "en" },
    });

    await service.clearTaskQueue();

    await service.endMaintenanceMode();

    await new Promise((r) => setTimeout(r, 500));

    expect(await service.search("queue test 1")).toEqual([]);
    expect(await service.search("queue test 2")).toEqual([]);
  });
});
