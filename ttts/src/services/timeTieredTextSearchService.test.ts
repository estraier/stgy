import fs from "fs/promises";
import path from "path";
import {
  TimeTieredTextSearchService,
  TimeTieredTextSearchConfig,
} from "./timeTieredTextSearchService";

// テスト用のディレクトリパス
const TEST_DIR = path.join(__dirname, "../../test_index_data");

// テスト用の設定
const TEST_CONFIG: TimeTieredTextSearchConfig = {
  baseDir: TEST_DIR,
  namespace: "test-posts",
  bucketDurationSeconds: 1000, // 1000秒ごとにファイルを分割
  autoCommitUpdateCount: 1, // 1件追加するごとに即時バッチ処理（テスト用）
  autoCommitAfterLastUpdateSeconds: 0.1,
  autoCommitAfterLastCommitSeconds: 0.1,
  recordPositions: false,
  locale: "en",
  readConnectionCount: 2, // Reader接続のテスト
};

// ユーティリティ: 指定ミリ秒待機
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe("TimeTieredTextSearchService", () => {
  let service: TimeTieredTextSearchService;

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
    // ディレクトリの中身を空にする
    const files = await fs.readdir(TEST_DIR);
    for (const file of files) {
      await fs.unlink(path.join(TEST_DIR, file));
    }

    service = new TimeTieredTextSearchService(TEST_CONFIG);
    await service.open();
  });

  // 各テストケースの後処理
  afterEach(async () => {
    await service.close();
  });

  test("should create index files and search documents", async () => {
    const docId = "doc-1";
    const timestamp = 1000000; // バケット基準
    const body = "This is a test document for search.";

    // ドキュメント追加
    await service.addDocument(docId, timestamp, body);

    // バッチ処理(非同期)が完了するのを少し待つ
    // autoCommitUpdateCount: 1 なので即座に処理が走るはずだが、非同期のためウェイトが必要
    await sleep(200);

    // ファイルが作成されているか確認
    const files = await service.listFiles();
    expect(files.length).toBe(1);
    expect(files[0].filename).toContain(TEST_CONFIG.namespace);
    expect(files[0].countDocuments).toBe(1);

    // 検索実行
    const results = await service.search("test search");
    expect(results).toHaveLength(1);
    expect(results[0]).toBe(docId);
  });

  test("should handle multiple shards based on timestamp", async () => {
    // 異なるバケット期間のドキュメントを追加
    const doc1 = { id: "old-doc", ts: 1000000, body: "Old document in bucket 1000" };
    const doc2 = { id: "new-doc", ts: 1002000, body: "New document in bucket 1002" };

    await service.addDocument(doc1.id, doc1.ts, doc1.body);
    await service.addDocument(doc2.id, doc2.ts, doc2.body);

    await sleep(200);

    // ファイルが2つ作成されていることを確認
    const files = await service.listFiles();
    expect(files.length).toBe(2);

    // startTimestampの降順でソートされているはず
    expect(files[0].startTimestamp).toBe(1002000); // 新しい
    expect(files[1].startTimestamp).toBe(1000000); // 古い

    // 両方のドキュメントが検索できること
    const results = await service.search("document");
    expect(results).toHaveLength(2);
    expect(results).toContain(doc1.id);
    expect(results).toContain(doc2.id);
  });

  test("should remove documents correctly", async () => {
    const docId = "doc-to-remove";
    const timestamp = 1000000;

    await service.addDocument(docId, timestamp, "Content to be removed");
    await sleep(200);

    // 追加されていることを確認
    let results = await service.search("Content");
    expect(results).toContain(docId);

    // 削除実行
    await service.removeDocument(docId, timestamp);
    await sleep(200);

    // 検索結果から消えていることを確認
    results = await service.search("Content");
    expect(results).not.toContain(docId);

    // listFilesのカウントは減っているか（実装によるが、count(*)しているので減るはず）
    const files = await service.listFiles();
    expect(files[0].countDocuments).toBe(0);
  });

  test("should persist data after restart", async () => {
    const docId = "persistent-doc";
    const timestamp = 1000000;

    // 1. データ追加
    await service.addDocument(docId, timestamp, "Persistent data");
    await sleep(200);

    // 2. サービスを閉じる（ここでWALチェックポイントなどが走る）
    await service.close();

    // 3. 新しいインスタンスで再開
    const newService = new TimeTieredTextSearchService(TEST_CONFIG);
    await newService.open();

    try {
      // 4. データが残っているか確認
      const results = await newService.search("Persistent");
      expect(results).toHaveLength(1);
      expect(results[0]).toBe(docId);

      const files = await newService.listFiles();
      expect(files.length).toBeGreaterThan(0);
    } finally {
      await newService.close();
    }
  });

  test("should utilize Reader connections (implicitly)", async () => {
    // 最新インデックスに対するReader接続が機能しているかを間接的にテスト
    // (エラーにならずに検索できればOK)

    const docId = "reader-test-doc";
    const timestamp = 2000000; // 未来のタイムスタンプにして最新シャードにする

    await service.addDocument(docId, timestamp, "Testing reader connections");
    await sleep(200);

    // 複数回検索してラウンドロビン等がエラーを起こさないか確認
    for (let i = 0; i < 5; i++) {
      const results = await service.search("Testing");
      expect(results).toContain(docId);
    }
  });

  test("should update existing document (upsert)", async () => {
    const docId = "update-doc";
    const timestamp = 1000000;

    // 初期登録
    await service.addDocument(docId, timestamp, "Version one");
    await sleep(200);
    let results = await service.search("one");
    expect(results).toContain(docId);

    // 更新（同じIDで登録）
    await service.addDocument(docId, timestamp, "Version two updated");
    await sleep(200);

    // 古いキーワードではヒットせず、新しいキーワードでヒットするか
    results = await service.search("one");
    expect(results).not.toContain(docId);

    results = await service.search("two");
    expect(results).toContain(docId);
  });
});
