import fs from "fs/promises";
import path from "path";
import { InputQueue } from "./inputQueue";

const TEST_DIR = path.join(__dirname, "../../test_queue_data");

describe("InputQueue", () => {
  let queue: InputQueue;

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

    queue = new InputQueue(TEST_DIR);
    await queue.open();
  });

  // 各テストケースの後処理
  afterEach(async () => {
    await queue.close();
  });

  test("should enqueue and dequeue tasks in FIFO order", async () => {
    // 3つのタスクを追加
    await queue.enqueue("doc-1", 1000, "body-1");
    await queue.enqueue("doc-2", 1000, "body-2");
    await queue.enqueue("doc-3", 1000, "body-3");

    // 件数確認
    expect(await queue.count()).toBe(3);

    // 2件だけ取り出す
    const tasks = await queue.dequeue(2);
    expect(tasks).toHaveLength(2);

    // FIFO順序の確認 (ID順)
    expect(tasks[0].doc_id).toBe("doc-1");
    expect(tasks[1].doc_id).toBe("doc-2");

    // まだキューには残っているはず（dequeueしただけでは消えない仕様）
    expect(await queue.count()).toBe(3);
  });

  test("should delete processed tasks", async () => {
    await queue.enqueue("doc-1", 1000, "body-1");
    await queue.enqueue("doc-2", 1000, "body-2");

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

  test("should handle delete request (null body)", async () => {
    // 削除リクエスト（body = null）を追加
    await queue.enqueue("doc-1", 1000, null);

    const tasks = await queue.dequeue(1);
    expect(tasks).toHaveLength(1);
    expect(tasks[0].doc_id).toBe("doc-1");
    expect(tasks[0].body).toBeNull();
  });

  test("should persist data after restart", async () => {
    await queue.enqueue("doc-persistent", 1000, "I will survive");

    // 一旦閉じる
    await queue.close();

    // 新しいインスタンスで開く
    const newQueue = new InputQueue(TEST_DIR);
    await newQueue.open();

    try {
      const tasks = await newQueue.dequeue(1);
      expect(tasks).toHaveLength(1);
      expect(tasks[0].doc_id).toBe("doc-persistent");
    } finally {
      await newQueue.close();
    }
  });

  test("should handle empty deletion gracefully", async () => {
    // 空の配列を渡してもエラーにならないこと
    await queue.deleteTasks([]);
    expect(await queue.count()).toBe(0);
  });

  test("should retrieve timestamp correctly", async () => {
    const ts = 1234567890;
    await queue.enqueue("doc-ts", ts, "body");

    const tasks = await queue.dequeue(1);
    expect(tasks[0].timestamp).toBe(ts);
  });
});
