import fs from "fs/promises";
import path from "path";
import { DocumentTaskQueue, ManagementTaskQueue, TaskAdd, TaskSync } from "./taskQueue";
import { SearchConfig } from "./search";

const TEST_DIR = "./test_data_task_queue";

const MOCK_CONFIG = {
  baseDir: TEST_DIR,
  namePrefix: "test_queue",
} as SearchConfig;

describe("TaskQueue System", () => {
  let docQueue: DocumentTaskQueue;
  let mgmtQueue: ManagementTaskQueue;

  beforeAll(async () => {
    await fs.mkdir(TEST_DIR, { recursive: true });
  });

  afterAll(async () => {
    await new Promise((r) => setTimeout(r, 100));
    await fs.rm(TEST_DIR, { recursive: true, force: true }).catch(() => {});
  });

  beforeEach(async () => {
    const dbPath = path.join(TEST_DIR, "test_queue-common.db");
    await fs.unlink(dbPath).catch(() => {});
    await fs.unlink(`${dbPath}-wal`).catch(() => {});
    await fs.unlink(`${dbPath}-shm`).catch(() => {});

    docQueue = new DocumentTaskQueue(MOCK_CONFIG);
    mgmtQueue = new ManagementTaskQueue(MOCK_CONFIG);
    await docQueue.open();
    await mgmtQueue.open();
  });

  afterEach(async () => {
    await docQueue.close();
    await mgmtQueue.close();
  });

  test("ManagementTaskQueue: basic flow with string IDs", async () => {
    const task: TaskSync = { type: "SYNC", payload: {} };
    const id = await mgmtQueue.enqueue(task);

    expect(id).toBe("m-1");

    const fetched = await mgmtQueue.fetchFirst();
    expect(fetched).not.toBeNull();
    expect(fetched?.id).toBe(id);
    expect(fetched?.type).toBe("SYNC");

    expect(await mgmtQueue.isPending(id)).toBe(true);
    await mgmtQueue.removeFromInput(id);
    expect(await mgmtQueue.isPending(id)).toBe(false);
  });

  test("DocumentTaskQueue: data task flow with string IDs", async () => {
    const task: TaskAdd = {
      type: "ADD",
      payload: { docId: "doc1", timestamp: 100, bodyText: "test", locale: "en" },
    };
    const id = await docQueue.enqueue(task);

    expect(id).toBe("d-1");

    const item = await docQueue.fetchFirst();
    expect(item).not.toBeNull();
    expect(item?.id).toBe(id);

    await docQueue.moveToBatch(item!);
    expect(await docQueue.fetchFirst()).toBeNull();
    expect(await docQueue.isPending(id)).toBe(true);

    const pending = await docQueue.getPendingBatchTasks();
    expect(pending).toHaveLength(1);
    expect(pending[0].id).toBe(id);

    await docQueue.removeFromBatch(id);
    expect(await docQueue.isPending(id)).toBe(false);
  });

  test("Prefix isolation and independent counters", async () => {
    const mgmtId = await mgmtQueue.enqueue({ type: "SYNC", payload: {} });
    const docId = await docQueue.enqueue({
      type: "ADD",
      payload: { docId: "1", timestamp: 0, bodyText: "", locale: "" },
    });

    expect(mgmtId).toBe("m-1");
    expect(docId).toBe("d-1");

    const mFirst = await mgmtQueue.fetchFirst();
    const dFirst = await docQueue.fetchFirst();

    expect(mFirst?.id).toBe("m-1");
    expect(dFirst?.id).toBe("d-1");

    expect(await mgmtQueue.isPending(docId)).toBe(false);
    expect(await docQueue.isPending(mgmtId)).toBe(false);
  });
});
