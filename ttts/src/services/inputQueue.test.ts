import fs from "fs/promises";
import path from "path";
import { InputQueueService, InputQueueConfig } from "./inputQueue";

const TEST_DIR = path.join(__dirname, "../../test_queue_data");

// テスト用の設定（接頭辞を含む）
const TEST_CONFIG: InputQueueConfig = {
  baseDir: TEST_DIR,
  namePrefix: "test-posts",
};

describe("InputQueueService", () => {
  let queue: InputQueueService;

  // テスト実行前の準備
  beforeAll(async () => {
    // 前回のゴミが残っていれば削除
    await fs.rm(TEST_DIR, { recursive: true, force: true });
    await fs.mkdir(TEST_DIR, { recursive: true });
  });

  // テスト終了後の後始末
  afterAll(async () => {
    await fs.rm(TEST_DIR, { recursive: true, force: true });
  });

  // 各テストケースの前処理
  beforeEach(async () => {
    // ディレクトリの中身を空にする（DBファイルを削除）
    const files = await fs.readdir(TEST_DIR);
    for (const file of files) {
      await fs.unlink(path.join(TEST_DIR, file));
    }

    queue = new InputQueueService(TEST_CONFIG);
    await queue.open();
  });

  // 各テストケースの後処理
  afterEach(async () => {
    await queue.close();
  });

  test("should enqueue and dequeue tasks in FIFO order", async () => {
    // 3つのタスクを追加 (bodyText, locale を含む)
    await queue.enqueue("doc-1", 1000, "body-1", "ja");
    await queue.enqueue("doc-2", 1000, "body-2", "en");
    await queue.enqueue("doc-3", 1000, "body-3", "zh");

    // 件数確認
    expect(await queue.count()).toBe(3);

    // 2件だけ取り出す
    const tasks = await queue.dequeue(2);
    expect(tasks).toHaveLength(2);

    // FIFO順序とプロパティ名の確認
    expect(tasks[0].doc_id).toBe("doc-1");
    expect(tasks[0].bodyText).toBe("body-1");
    expect(tasks[0].locale).toBe("ja");

    expect(tasks[1].doc_id).toBe("doc-2");
    expect(tasks[1].bodyText).toBe("body-2");
    expect(tasks[1].locale).toBe("en");

    // dequeueしただけでは消えない仕様の確認
    expect(await queue.count()).toBe(3);
  });

  test("should delete processed tasks", async () => {
    await queue.enqueue("doc-1", 1000, "body-1", "ja");
    await queue.enqueue("doc-2", 1000, "body-2", "en");

    // 全件取得
    const tasks = await queue.dequeue(10);
    const ids = tasks.map((t) => t.id);

    // 削除実行
    await queue.deleteTasks(ids);

    // キューが空になっているか確認
    expect(await queue.count()).toBe(0);

    // 再度dequeueしても空のはず
    const emptyTasks = await queue.dequeue(10);
    expect(emptyTasks).toHaveLength(0);
  });

  test("should handle delete request (null bodyText and locale)", async () => {
    // 削除リクエスト（bodyText = null, locale = null）を追加
    await queue.enqueue("doc-1", 1000, null, null);

    const tasks = await queue.dequeue(1);
    expect(tasks).toHaveLength(1);
    expect(tasks[0].doc_id).toBe("doc-1");
    expect(tasks[0].bodyText).toBeNull();
    expect(tasks[0].locale).toBeNull();
  });

  test("should persist data after restart and use correct filename", async () => {
    await queue.enqueue("doc-persistent", 1000, "I will survive", "en");

    // 一旦閉じる
    await queue.close();

    // ファイル名が namePrefix を含んでいるか確認
    const files = await fs.readdir(TEST_DIR);
    expect(files).toContain(`${TEST_CONFIG.namePrefix}-input_tasks.db`);

    // 新しいインスタンスで再開
    const newQueue = new InputQueueService(TEST_CONFIG);
    await newQueue.open();

    try {
      const tasks = await newQueue.dequeue(1);
      expect(tasks).toHaveLength(1);
      expect(tasks[0].doc_id).toBe("doc-persistent");
      expect(tasks[0].bodyText).toBe("I will survive");
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
    await queue.enqueue("doc-ts", ts, "body", "ja");

    const tasks = await queue.dequeue(1);
    expect(tasks[0].timestamp).toBe(ts);
  });
});
