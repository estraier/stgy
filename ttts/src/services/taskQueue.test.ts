import fs from "fs/promises";
import path from "path";
import { TaskQueue, TaskAdd, TaskSync } from "./taskQueue";
import { SearchConfig } from "./search";

const TEST_DIR = "./test_data_task_queue";

// TaskQueueが必要とする最小限のConfigモック
const MOCK_CONFIG = {
  baseDir: TEST_DIR,
  namePrefix: "test_queue",
} as SearchConfig;

describe("TaskQueue", () => {
  let queue: TaskQueue;

  beforeAll(async () => {
    await fs.mkdir(TEST_DIR, { recursive: true });
  });

  afterAll(async () => {
    // クリーンアップ
    await new Promise((r) => setTimeout(r, 100)); // SQLiteのロック解放待ち
    await fs.rm(TEST_DIR, { recursive: true, force: true }).catch(() => {});
  });

  beforeEach(async () => {
    // テスト毎にDBファイルを削除して初期化
    const dbPath = path.join(TEST_DIR, "test_queue-common.db");
    await fs.unlink(dbPath).catch(() => {});
    await fs.unlink(`${dbPath}-wal`).catch(() => {});
    await fs.unlink(`${dbPath}-shm`).catch(() => {});

    queue = new TaskQueue(MOCK_CONFIG);
    await queue.open();
  });

  afterEach(async () => {
    await queue.close();
  });

  test("enqueue returns incremental IDs", async () => {
    const task1: TaskAdd = {
      type: "ADD",
      payload: { docId: "1", timestamp: 100, bodyText: "test", locale: "en" },
    };
    const id1 = await queue.enqueue(task1);
    expect(id1).toBe(1);

    const task2: TaskSync = { type: "SYNC", payload: {} };
    const id2 = await queue.enqueue(task2);
    expect(id2).toBe(2);
  });

  test("fetchFirst retrieves the oldest task without removing it", async () => {
    const task: TaskAdd = {
      type: "ADD",
      payload: { docId: "doc1", timestamp: 100, bodyText: "hello", locale: "en" },
    };
    const id = await queue.enqueue(task);

    // 1回目
    const fetched1 = await queue.fetchFirst();
    expect(fetched1).not.toBeNull();
    expect(fetched1?.id).toBe(id);
    expect(fetched1?.type).toBe("ADD");
    // ペイロードが正しくオブジェクトとして復元されているか
    expect((fetched1?.payload as TaskAdd["payload"]).docId).toBe("doc1");

    // 2回目（消えていないことの確認）
    const fetched2 = await queue.fetchFirst();
    expect(fetched2).toEqual(fetched1);
  });

  test("Data Task Flow: moveToBatch -> removeFromBatch", async () => {
    const task: TaskAdd = {
      type: "ADD",
      payload: { docId: "persistent", timestamp: 123, bodyText: "data", locale: "ja" },
    };
    await queue.enqueue(task);

    const item = await queue.fetchFirst();
    expect(item).not.toBeNull();
    if (!item) return;

    // 1. Batchへ移動
    await queue.moveToBatch(item);

    // Inputからは消えているはず
    const nextInput = await queue.fetchFirst();
    expect(nextInput).toBeNull();

    // Batchには存在しているはず
    const pending = await queue.getPendingBatchTasks();
    expect(pending).toHaveLength(1);
    expect(pending[0].id).toBe(item.id);
    expect((pending[0].payload as TaskAdd["payload"]).bodyText).toBe("data");

    // 2. Batchから削除（完了）
    await queue.removeFromBatch(item.id);

    // 完全に消えたはず
    const finalPending = await queue.getPendingBatchTasks();
    expect(finalPending).toHaveLength(0);
  });

  test("Control Task Flow: removeFromInput", async () => {
    const task: TaskSync = { type: "SYNC", payload: {} };
    await queue.enqueue(task);

    const item = await queue.fetchFirst();
    expect(item).not.toBeNull();
    if (!item) return;

    // inputから直接削除
    await queue.removeFromInput(item.id);

    // Inputから消えている
    const nextInput = await queue.fetchFirst();
    expect(nextInput).toBeNull();

    // Batchにも入っていない（Control Taskなので）
    const pending = await queue.getPendingBatchTasks();
    expect(pending).toHaveLength(0);
  });

  test("FIFO ordering is preserved", async () => {
    await queue.enqueue({ type: "SYNC", payload: {} }); // id: 1
    await queue.enqueue({
      type: "ADD",
      payload: { docId: "2", timestamp: 0, bodyText: "", locale: "" },
    }); // id: 2

    const first = await queue.fetchFirst();
    expect(first?.id).toBe(1);
    expect(first?.type).toBe("SYNC");

    await queue.removeFromInput(first!.id);

    const second = await queue.fetchFirst();
    expect(second?.id).toBe(2);
    expect(second?.type).toBe("ADD");
  });

  test("getPendingBatchTasks handles recovery scenario", async () => {
    // 疑似的にクラッシュ後の状態を作るため、手動で batch に入れるフローを再現
    const task1: TaskAdd = {
      type: "ADD",
      payload: { docId: "rec1", timestamp: 100, bodyText: "recover me", locale: "en" },
    };
    const task2: TaskAdd = {
      type: "ADD",
      payload: { docId: "rec2", timestamp: 200, bodyText: "recover me too", locale: "en" },
    };

    await queue.enqueue(task1);
    await queue.enqueue(task2);

    const item1 = await queue.fetchFirst();
    await queue.moveToBatch(item1!);

    // ここで item2 はまだ input にある状態

    // 再起動したつもりで pending を取得
    const pending = await queue.getPendingBatchTasks();

    // batch に移動済みの task1 だけが返るはず
    expect(pending).toHaveLength(1);
    expect(pending[0].id).toBe(item1!.id);
    expect((pending[0].payload as TaskAdd["payload"]).docId).toBe("rec1");

    // input には task2 が残っているはず
    const remainingInput = await queue.fetchFirst();
    expect(remainingInput).not.toBeNull();
    // @ts-ignore
    expect(remainingInput.payload.docId).toBe("rec2");
  });
});
