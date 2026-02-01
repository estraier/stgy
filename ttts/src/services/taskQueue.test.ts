import fs from "fs/promises";
import path from "path";
import { TaskQueue } from "./taskQueue";
import { SearchConfig } from "./search";

const TEST_DIR = "./test_data_queue";
const TEST_CONFIG = {
  baseDir: TEST_DIR,
  namePrefix: "test_queue",
} as SearchConfig;

describe("TaskQueue", () => {
  let queue: TaskQueue;

  beforeAll(async () => {
    await fs.mkdir(TEST_DIR, { recursive: true });
  });

  afterAll(async () => {
    await fs.rm(TEST_DIR, { recursive: true, force: true });
  });

  beforeEach(async () => {
    queue = new TaskQueue(TEST_CONFIG);
    await queue.open();
  });

  afterEach(async () => {
    await queue.close();
    const dbPath = path.join(TEST_DIR, `${TEST_CONFIG.namePrefix}-common.db`);
    await fs.unlink(dbPath).catch(() => {});
    await fs.unlink(dbPath + "-wal").catch(() => {});
    await fs.unlink(dbPath + "-shm").catch(() => {});
  });

  test("enqueue adds tasks to input_tasks", async () => {
    await queue.enqueue("doc1", 1000, "hello", "en", null);
    const count = await queue.countInputTasks();
    expect(count).toBe(1);
  });

  test("dequeue moves task from input to batch and returns it", async () => {
    await queue.enqueue("doc1", 1000, "hello", "en", null);

    const task = await queue.dequeue();
    expect(task).not.toBeNull();
    expect(task?.docId).toBe("doc1");
    expect(task?.bodyText).toBe("hello");

    const inputCount = await queue.countInputTasks();
    expect(inputCount).toBe(0);

    const pending = await queue.getPendingBatchTasks();
    expect(pending.length).toBe(1);
    expect(pending[0].id).toBe(task!.id);
  });

  test("dequeue returns null when empty", async () => {
    const task = await queue.dequeue();
    expect(task).toBeNull();
  });

  test("complete removes task from batch_tasks", async () => {
    await queue.enqueue("doc1", 1000, "hello", "en", null);
    const task = await queue.dequeue();
    expect(task).not.toBeNull();

    await queue.complete(task!.id);

    const pending = await queue.getPendingBatchTasks();
    expect(pending.length).toBe(0);
  });

  test("getPendingBatchTasks retrieves tasks for recovery", async () => {
    await queue.enqueue("doc1", 1000, "hello", "en", null);
    await queue.dequeue();
    await queue.close();
    queue = new TaskQueue(TEST_CONFIG);
    await queue.open();

    const pending = await queue.getPendingBatchTasks();
    expect(pending.length).toBe(1);
    expect(pending[0].docId).toBe("doc1");
  });

  test("FIFO order is preserved", async () => {
    await queue.enqueue("doc1", 100, "1", "en", null);
    await queue.enqueue("doc2", 200, "2", "en", null);

    const task1 = await queue.dequeue();
    const task2 = await queue.dequeue();

    expect(task1?.docId).toBe("doc1");
    expect(task2?.docId).toBe("doc2");
  });
});
