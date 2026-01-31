import fs from "fs/promises";
import path from "path";
import pino from "pino";
import { InputQueueService, InputQueueConfig } from "./inputQueue";

const TEST_DIR = path.join(__dirname, "../../test_queue_data");
const logger = pino({ level: "silent" });

const TEST_CONFIG: InputQueueConfig = {
  baseDir: TEST_DIR,
  namePrefix: "test-posts",
};

describe("InputQueueService", () => {
  let queue: InputQueueService;

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
      await fs.unlink(path.join(TEST_DIR, file));
    }

    queue = new InputQueueService(TEST_CONFIG, logger);
    await queue.open();
  });

  afterEach(async () => {
    await queue.close();
  });

  test("should enqueue and dequeue tasks in FIFO order", async () => {
    await queue.enqueue("doc-1", 1000, "body-1", "ja", null);
    await queue.enqueue("doc-2", 1000, "body-2", "en", "attr-data");
    await queue.enqueue("doc-3", 1000, "body-3", "zh", null);

    expect(await queue.count()).toBe(3);

    const tasks = await queue.dequeue(2);
    expect(tasks).toHaveLength(2);

    expect(tasks[0].doc_id).toBe("doc-1");
    expect(tasks[0].attrs).toBeNull();

    expect(tasks[1].doc_id).toBe("doc-2");
    expect(tasks[1].attrs).toBe("attr-data");

    expect(await queue.count()).toBe(3);
  });

  test("should handle reservation mode correctly", async () => {
    await queue.enqueue("normal-doc", 1000, "normal", "ja", null);
    queue.setReservationMode(true);
    expect(queue.getReservationMode()).toBe(true);

    await queue.enqueue("reserved-doc", 1001, "reserved", "en", null);
    expect(await queue.count()).toBe(2);

    const tasksDuringMode = await queue.dequeue(10);
    expect(tasksDuringMode).toHaveLength(0);

    queue.setReservationMode(false);
    expect(queue.getReservationMode()).toBe(false);

    const tasksAfterMode = await queue.dequeue(10);
    expect(tasksAfterMode).toHaveLength(2);
    expect(tasksAfterMode[0].doc_id).toBe("normal-doc");
    expect(tasksAfterMode[1].doc_id).toBe("reserved-doc");
  });

  test("should delete processed tasks", async () => {
    await queue.enqueue("doc-1", 1000, "body-1", "ja", null);
    await queue.enqueue("doc-2", 1000, "body-2", "en", null);

    const tasks = await queue.dequeue(10);
    const ids = tasks.map((t) => t.id);

    await queue.deleteTasks(ids);
    expect(await queue.count()).toBe(0);
  });

  test("should handle delete request (null bodyText, locale, attrs)", async () => {
    await queue.enqueue("doc-1", 1000, null, null, null);

    const tasks = await queue.dequeue(1);
    expect(tasks).toHaveLength(1);
    expect(tasks[0].bodyText).toBeNull();
    expect(tasks[0].locale).toBeNull();
    expect(tasks[0].attrs).toBeNull();
  });

  test("should persist data after restart and use correct filename", async () => {
    await queue.enqueue("doc-persistent", 1000, "I will survive", "en", "persistent-attr");
    await queue.close();

    const files = await fs.readdir(TEST_DIR);
    expect(files).toContain(`${TEST_CONFIG.namePrefix}-input_tasks.db`);

    const newQueue = new InputQueueService(TEST_CONFIG, logger);
    await newQueue.open();

    try {
      const tasks = await newQueue.dequeue(1);
      expect(tasks).toHaveLength(1);
      expect(tasks[0].doc_id).toBe("doc-persistent");
      expect(tasks[0].attrs).toBe("persistent-attr");
    } finally {
      await newQueue.close();
    }
  });

  test("should handle empty deletion gracefully", async () => {
    await queue.deleteTasks([]);
    expect(await queue.count()).toBe(0);
  });

  test("should retrieve timestamp correctly", async () => {
    const ts = 1234567890;
    await queue.enqueue("doc-ts", ts, "body", "ja", null);

    const tasks = await queue.dequeue(1);
    expect(tasks[0].timestamp).toBe(ts);
  });

  test("should store and retrieve arbitrary attributes string", async () => {
    const meta = JSON.stringify({ externalId: "ext-12345", tags: ["news", "tech"] });
    const ts = 1000;

    await queue.enqueue("doc-with-attrs", ts, "content", "en", meta);

    const tasks = await queue.dequeue(1);
    expect(tasks).toHaveLength(1);
    expect(tasks[0].attrs).toBe(meta);

    const parsed = JSON.parse(tasks[0].attrs!);
    expect(parsed.externalId).toBe("ext-12345");
    expect(parsed.tags).toContain("tech");
  });
});
