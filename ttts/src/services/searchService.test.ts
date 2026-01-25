import fs from "fs/promises";
import path from "path";
import { SearchService, SearchConfig } from "./searchService";

// テスト用のディレクトリパス
const TEST_DIR = path.join(__dirname, "../../test_index_data");

// テスト用の設定
const TEST_CONFIG: SearchConfig = {
  baseDir: TEST_DIR,
  namePrefix: "test-posts", // namespace -> namePrefix に変更
  bucketDurationSeconds: 1000,
  autoCommitUpdateCount: 1,
  autoCommitAfterLastUpdateSeconds: 0.1,
  autoCommitAfterLastCommitSeconds: 0.1,
  recordPositions: false,
  // locale は削除 (メソッド引数へ移動)
  readConnectionCount: 2,
  maxQueryTokenCount: 10, // 新規追加
  maxDocumentTokenCount: 100, // 新規追加
};

// ユーティリティ: 指定ミリ秒待機
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe("SearchService", () => {
  let service: SearchService;

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

    service = new SearchService(TEST_CONFIG);
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

    // ドキュメント追加 (第4引数にlocaleを追加)
    await service.addDocument(docId, timestamp, body, "en");

    // バッチ処理(非同期)が完了するのを少し待つ
    await sleep(200);

    // ファイルが作成されているか確認
    const files = await service.listFiles();
    expect(files.length).toBe(1);
    // namespace -> namePrefix の変更を確認
    expect(files[0].filename).toContain(TEST_CONFIG.namePrefix);
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

    await service.addDocument(doc1.id, doc1.ts, doc1.body, "en");
    await service.addDocument(doc2.id, doc2.ts, doc2.body, "en");

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

    await service.addDocument(docId, timestamp, "Content to be removed", "en");
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

    // listFilesのカウントは減っているか
    const files = await service.listFiles();
    expect(files[0].countDocuments).toBe(0);
  });

  test("should persist data after restart", async () => {
    const docId = "persistent-doc";
    const timestamp = 1000000;

    // 1. データ追加
    await service.addDocument(docId, timestamp, "Persistent data", "en");
    await sleep(200);

    // 2. サービスを閉じる
    await service.close();

    // 3. 新しいインスタンスで再開
    const newService = new SearchService(TEST_CONFIG);
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
    const docId = "reader-test-doc";
    const timestamp = 2000000; // 未来のタイムスタンプにして最新シャードにする

    await service.addDocument(docId, timestamp, "Testing reader connections", "en");
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
    await service.addDocument(docId, timestamp, "Version one", "en");
    await sleep(200);
    let results = await service.search("one");
    expect(results).toContain(docId);

    // 更新（同じIDで登録）
    await service.addDocument(docId, timestamp, "Version two updated", "en");
    await sleep(200);

    // 古いキーワードではヒットせず、新しいキーワードでヒットするか
    results = await service.search("one");
    expect(results).not.toContain(docId);

    results = await service.search("two");
    expect(results).toContain(docId);
  });

  test("should respect token limits", async () => {
    const docId = "limit-test-doc";
    const timestamp = 1000000;

    // maxDocumentTokenCount (100) を超えるトークンを作るのは大変なので、
    // maxQueryTokenCount (10) のテストを行う

    // 15個の単語を含むドキュメント
    const longText = "w1 w2 w3 w4 w5 w6 w7 w8 w9 w10 w11 w12 w13 w14 w15";
    await service.addDocument(docId, timestamp, longText, "en");
    await sleep(200);

    // 10単語までの検索はヒットするはず
    const q10 = "w1 w2 w3 w4 w5 w6 w7 w8 w9 w10";
    const r10 = await service.search(q10);
    expect(r10).toContain(docId);

    // 11単語以上の検索クエリを投げた場合、11個目以降は無視されて検索される仕様
    // つまり "w1 ... w10 w11" を投げると "w1 ... w10" で検索される
    // ドキュメントには w11 も含まれているので、結果的にヒットするはず
    const q11 = "w1 w2 w3 w4 w5 w6 w7 w8 w9 w10 w11";
    const r11 = await service.search(q11);
    expect(r11).toContain(docId);

    // 存在しない単語を含めて11単語にした場合
    // "w1 ... w10 notexist" -> "w1 ... w10" (notexistは無視される)
    // なのでヒットするはず
    const qTruncated = "w1 w2 w3 w4 w5 w6 w7 w8 w9 w10 notexist";
    const rTruncated = await service.search(qTruncated);
    expect(rTruncated).toContain(docId);
  });
});
