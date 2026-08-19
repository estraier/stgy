import fs from "fs/promises";
import path from "path";
import { buildSearchSql, normalizeLabels, SearchService, SearchConfig } from "./search";
import { Logger } from "pino";
import { SearchTask } from "./taskQueue";
import { Database } from "../utils/database";

const mockLogger = {
  info: jest.fn(),
  error: (obj: unknown, msg?: string) => console.error(msg, obj),
  debug: jest.fn(),
  warn: jest.fn(),
  child: () => mockLogger,
} as unknown as Logger;

const TEST_DIR = "./test_data_search_service_actor";

class TestSearchService extends SearchService {
  async getPendingBatchTaskIds(): Promise<string[]> {
    return (await this.docQueue.getPendingBatchTasks()).map((task) => task.id);
  }

  getIndexFilePath(bucketTimestamp: number): string {
    return this.fileManager.getFilePath(bucketTimestamp);
  }
}

async function waitUntil(predicate: () => Promise<boolean>, timeoutMs = 2000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!(await predicate())) {
    if (Date.now() >= deadline) throw new Error("Timed out waiting for condition");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

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
  let service: TestSearchService;

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

    service = new TestSearchService(CONFIG, mockLogger);
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
      payload: { docId: "doc_1", timestamp: 1000, bodyText: "hello world", locale: "en", attrs: null, labels: [], numericValue: null },
    });
    expect(taskId).toMatch(/^d-/);

    const results = await service.search("hello");
    expect(results).toContain("doc_1");
  });

  test("Auto-commit: should commit transaction after duration expires", async () => {
    await runTask(
      {
        type: "ADD",
        payload: { docId: "warmup", timestamp: 1000, bodyText: "warmup", locale: "en", attrs: null, labels: [], numericValue: null },
      },
      true,
    );

    const taskId = await service.enqueueTask({
      type: "ADD",
      payload: { docId: "auto_1", timestamp: 1000, bodyText: "automatic commit", locale: "en", attrs: null, labels: [], numericValue: null },
    });

    await waitUntil(async () => (await service.getPendingBatchTaskIds()).includes(taskId));

    const immediateRes = await service.search("automatic");
    expect(immediateRes).not.toContain("auto_1");

    await service.waitTask(taskId);

    const lateRes = await service.search("automatic");
    expect(lateRes).toContain("auto_1");
  });

  test("Batch task remains pending until its index transaction is committed", async () => {
    await service.close();
    service = new TestSearchService(
      {
        ...CONFIG,
        autoCommitDurationSeconds: 60,
        commitCheckIntervalSeconds: 600,
      },
      mockLogger,
    );
    await service.open();

    const taskId = await service.enqueueTask({
      type: "ADD",
      payload: { docId: "batch_1", timestamp: 1000, bodyText: "batch commit", locale: "en", attrs: null, labels: [], numericValue: null },
    });

    await waitUntil(async () => (await service.getPendingBatchTaskIds()).includes(taskId));
    expect(await service.getPendingBatchTaskIds()).toContain(taskId);

    const syncId = await service.enqueueTask({ type: "SYNC", payload: {} });
    await service.waitTask(syncId);
    await service.waitTask(taskId);

    expect(await service.getPendingBatchTaskIds()).not.toContain(taskId);
    expect(await service.search("batch")).toContain("batch_1");
  });

  test("Search preserves programming-language symbols", async () => {
    await runTask({
      type: "ADD",
      payload: {
        docId: "cpp_doc",
        timestamp: 1000,
        bodyText: "私はC++言語が好きです",
        locale: "ja",
        attrs: null,
        labels: [],
        numericValue: null,
      },
    });

    expect(await service.search("C++", "ja")).toContain("cpp_doc");
    expect(await service.search("C", "ja")).not.toContain("cpp_doc");
  });

  test("Update: Overwrite existing document", async () => {
    await runTask({
      type: "ADD",
      payload: { docId: "doc_upd", timestamp: 1000, bodyText: "version one", locale: "en", attrs: null, labels: [], numericValue: null },
    });
    expect(await service.search("version")).toContain("doc_upd");

    await runTask({
      type: "ADD",
      payload: { docId: "doc_upd", timestamp: 1000, bodyText: "version two", locale: "en", attrs: null, labels: [], numericValue: null },
    });

    const oldRes = await service.search("one");
    const newRes = await service.search("two");

    expect(oldRes).not.toContain("doc_upd");
    expect(newRes).toContain("doc_upd");
  });

  test("Delete: Remove document", async () => {
    await runTask({
      type: "ADD",
      payload: { docId: "doc_del", timestamp: 1000, bodyText: "delete me", locale: "en", attrs: null, labels: [], numericValue: null },
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
      payload: { docId: "shard_A", timestamp: 100, bodyText: "apple", locale: "en", attrs: null, labels: [], numericValue: null },
    });
    await runTask({
      type: "ADD",
      payload: { docId: "shard_B", timestamp: 250, bodyText: "banana", locale: "en", attrs: null, labels: [], numericValue: null },
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
      payload: { docId: "doc_opt", timestamp: 1000, bodyText: "optimize me", locale: "en", attrs: null, labels: [], numericValue: null },
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
      payload: { docId: "doc_rec", timestamp: 1000, bodyText: "reconstruct me", locale: "en", attrs: null, labels: [], numericValue: null },
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
      payload: { docId: "doc_drop", timestamp: 1000, bodyText: "drop me", locale: "en", attrs: null, labels: [], numericValue: null },
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

  test("Management: DROP_SHARD uses the listed shard timestamp without rebucketing", async () => {
    const oldBucketTimestamp = 150;
    const db = await Database.open(service.getIndexFilePath(oldBucketTimestamp));
    await db.close();

    expect((await service.listIndexFiles()).map((file) => file.startTimestamp)).toContain(
      oldBucketTimestamp,
    );

    await runTask(
      {
        type: "DROP_SHARD",
        payload: { targetTimestamp: oldBucketTimestamp },
      },
      false,
    );

    expect((await service.listIndexFiles()).map((file) => file.startTimestamp)).not.toContain(
      oldBucketTimestamp,
    );
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
      payload: { docId: "doc_maint", timestamp: 1000, bodyText: "waiting", locale: "en", attrs: null, labels: [], numericValue: null },
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
      payload: { docId: "doc_persist", timestamp: 1000, bodyText: "I will survive", locale: "en", attrs: null, labels: [], numericValue: null },
    });

    await service.close();

    service = new TestSearchService(CONFIG, mockLogger);
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
        labels: [],
        numericValue: null,
      },
    });

    const docs = await service.fetchDocuments(["doc_fetch"]);
    expect(docs).toHaveLength(1);
    expect(docs[0].id).toBe("doc_fetch");
    expect(docs[0].bodyText).toBe("content body");
    expect(docs[0].attrs).toBe(JSON.stringify({ key: "val" }));
    expect(docs[0].labels).toEqual([]);
    expect(docs[0].numericValue).toBeNull();
  });

  test("Labels accept printable characters and U+0020 SPACE but reject controls", () => {
    expect(normalizeLabels([" foo  bar ", "C++ / cycling", "日本語 🚲"])).toEqual([
      " foo  bar ",
      "C++ / cycling",
      "日本語 🚲",
    ]);
    expect(() => normalizeLabels(["tab\tlabel"])).toThrow();
    expect(() => normalizeLabels(["line\nlabel"])).toThrow();
  });

  test("Labels filter the FTS search space and are exact after unicode61 folding", async () => {
    await runTask({
      type: "ADD",
      payload: {
        docId: "label_upper",
        timestamp: 1000,
        bodyText: "shared bicycle text",
        locale: "en",
        labels: ["Owner:ABC", "project:foo bar"],
        numericValue: 10,
        attrs: null,
      },
    });
    await runTask({
      type: "ADD",
      payload: {
        docId: "label_lower",
        timestamp: 1000,
        bodyText: "shared bicycle text",
        locale: "en",
        labels: ["Owner:abc", "project:foo bar"],
        numericValue: 20,
        attrs: null,
      },
    });

    expect(
      await service.search("bicycle", "en", 100, 0, 1, { labels: ["Owner:ABC"] }),
    ).toEqual(["label_upper"]);
    expect(
      await service.search("bicycle", "en", 100, 0, 1, { labels: ["Owner:abc"] }),
    ).toEqual(["label_lower"]);
    expect(
      await service.search("bicycle", "en", 100, 0, 1, {
        labels: ["project:foo bar", "Owner:ABC"],
      }),
    ).toEqual(["label_upper"]);
  });

  test("Labels preserve U+0020 SPACE exactly and do not leak into body search", async () => {
    await runTask({
      type: "ADD",
      payload: {
        docId: "spaces",
        timestamp: 1000,
        bodyText: "owner:abc body-only-token",
        locale: "en",
        labels: ["foo bar", "foo  bar", " label "],
        attrs: null,
        numericValue: null,
      },
    });

    expect(
      await service.search("body-only-token", "en", 100, 0, 1, { labels: ["foo  bar"] }),
    ).toEqual(["spaces"]);
    expect(
      await service.search("body-only-token", "en", 100, 0, 1, { labels: ["foo bar "] }),
    ).toEqual([]);
    expect(
      await service.search("owner:abc", "en", 100, 0, 1, { labels: ["owner:abc"] }),
    ).toEqual([]);
  });

  test.each([
    ["eq", 20, ["n20"]],
    ["gt", 20, ["n30"]],
    ["gte", 20, ["n30", "n20"]],
    ["lt", 20, ["n10"]],
    ["lte", 20, ["n20", "n10"]],
  ] as const)("numericValue filter %s", async (numericOp, numericValue, expected) => {
    for (const value of [10, 20, 30]) {
      await runTask({
        type: "ADD",
        payload: {
          docId: `n${value}`,
          timestamp: 1000,
          bodyText: "numeric common",
          locale: "en",
          numericValue: value,
          attrs: null,
          labels: [],
        },
      });
    }
    await runTask({
      type: "ADD",
      payload: {
        docId: "nnull",
        timestamp: 1000,
        bodyText: "numeric common",
        locale: "en",
        numericValue: null,
        attrs: null,
        labels: [],
      },
    });

    expect(
      await service.search("numeric", "en", 100, 0, 1, { numericOp, numericValue }),
    ).toEqual(expected);
  });

  test("attrs=null removes existing attrs and labels/numericValue are returned raw", async () => {
    await runTask({
      type: "ADD",
      payload: {
        docId: "snapshot",
        timestamp: 1000,
        bodyText: "snapshot body",
        locale: "en",
        attrs: "{\"x\":1}",
        labels: ["Owner:ABC", "foo bar"],
        numericValue: 42,
      },
    });
    await runTask({
      type: "ADD",
      payload: {
        docId: "snapshot",
        timestamp: 1000,
        bodyText: "snapshot body",
        locale: "en",
        attrs: null,
        labels: ["Owner:ABC", "foo bar"],
        numericValue: 42,
      },
    });

    const docs = await service.fetchDocuments(["snapshot"]);
    expect(docs).toEqual([
      {
        id: "snapshot",
        bodyText: "snapshot body",
        attrs: null,
        labels: ["Owner:ABC", "foo bar"],
        numericValue: 42,
      },
    ]);
  });

  test("quoted phrases still require consecutive canonical tokens", async () => {
    await runTask({
      type: "ADD",
      payload: { docId: "phrase_yes", timestamp: 1000, bodyText: "hot dog", locale: "en", attrs: null, labels: [], numericValue: null },
    });
    await runTask({
      type: "ADD",
      payload: { docId: "phrase_no", timestamp: 1000, bodyText: "hot red dog", locale: "en", attrs: null, labels: [], numericValue: null },
    });

    expect(await service.search('"hot dog"')).toEqual(["phrase_yes"]);
  });

  test("search plan keeps FTS as the outer loop and PK lookup as the inner loop", async () => {
    await runTask({
      type: "ADD",
      payload: {
        docId: "plan",
        timestamp: 1000,
        bodyText: "plan body",
        locale: "en",
        labels: ["Owner:ABC"],
        numericValue: 10,
        attrs: null,
      },
    });
    const db = await Database.open(service.getIndexFilePath(1000));
    try {
      const sql = buildSearchSql(0, 1, "lte", true);
      const plan = await db.all<{ detail: string }>(`EXPLAIN QUERY PLAN ${sql}`, [
        'tokens : (plan) AND labels : "Owner:ABC"',
        "Owner:ABC",
        10,
        10,
      ]);
      const details = plan.map((row) => row.detail);
      expect(details[0]).toMatch(/SCAN docs VIRTUAL TABLE/);
      expect(details[1]).toMatch(/SEARCH t USING INTEGER PRIMARY KEY/);
      expect(details.some((detail) => /USE TEMP B-TREE/.test(detail))).toBe(false);
    } finally {
      await db.close();
    }
  });

  test("recordContents=false uses detail=column and supports overwrite/delete", async () => {
    await service.close();
    service = new TestSearchService({ ...CONFIG, recordContents: false }, mockLogger);
    await service.open();

    await runTask({
      type: "ADD",
      payload: {
        docId: "contentless",
        timestamp: 1000,
        bodyText: "version one",
        locale: "en",
        labels: ["owner:x"],
        attrs: null,
        numericValue: null,
      },
    });
    await runTask({
      type: "ADD",
      payload: {
        docId: "contentless",
        timestamp: 1000,
        bodyText: "version two",
        locale: "en",
        labels: ["owner:x"],
        attrs: null,
        numericValue: null,
      },
    });

    expect(await service.search("one")).toEqual([]);
    expect(await service.search("two", "en", 100, 0, 1, { labels: ["owner:x"] })).toEqual([
      "contentless",
    ]);

    const db = await Database.open(service.getIndexFilePath(1000));
    try {
      const schema = await db.get<{ sql: string }>(
        "SELECT sql FROM sqlite_master WHERE type='table' AND name='docs'",
      );
      expect(schema?.sql).toContain("detail = 'column'");
      expect(schema?.sql).toContain("contentless_delete=1");
    } finally {
      await db.close();
    }

    await runTask({ type: "REMOVE", payload: { docId: "contentless", timestamp: 1000 } });
    expect(await service.search("two")).toEqual([]);
  });

  test("clearTaskQueue: should clear pending tasks", async () => {
    await service.startMaintenanceMode();

    await service.enqueueTask({
      type: "ADD",
      payload: { docId: "q1", timestamp: 1000, bodyText: "queue test 1", locale: "en", attrs: null, labels: [], numericValue: null },
    });
    await service.enqueueTask({
      type: "ADD",
      payload: { docId: "q2", timestamp: 1000, bodyText: "queue test 2", locale: "en", attrs: null, labels: [], numericValue: null },
    });

    await service.clearTaskQueue();

    await service.endMaintenanceMode();

    await new Promise((r) => setTimeout(r, 500));

    expect(await service.search("queue test 1")).toEqual([]);
    expect(await service.search("queue test 2")).toEqual([]);
  });
});
