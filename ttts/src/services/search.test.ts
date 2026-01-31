import fs from "fs/promises";
import path from "path";
import pino from "pino";
import { SearchService, SearchConfig } from "./search";

const TEST_DIR = path.join(__dirname, "../../test_index_data");
const logger = pino({ level: "silent" });

const TEST_CONFIG: SearchConfig = {
  baseDir: TEST_DIR,
  namePrefix: "test-posts",
  bucketDurationSeconds: 1000,
  autoCommitUpdateCount: 10,
  autoCommitAfterLastUpdateSeconds: 0.1,
  autoCommitAfterLastCommitSeconds: 0.1,
  initialDocumentId: 2097151,
  recordPositions: false,
  recordContents: true,
  readConnectionCount: 2,
  maxQueryTokenCount: 10,
  maxDocumentTokenCount: 100,
};

describe("SearchService", () => {
  let service: SearchService;

  beforeAll(async () => {
    await fs.rm(TEST_DIR, { recursive: true, force: true });
    await fs.mkdir(TEST_DIR, { recursive: true });
  });

  afterAll(async () => {
    await fs.rm(TEST_DIR, { recursive: true, force: true });
  });

  beforeEach(async () => {
    if (service) {
      try {
        const files = await service.listFiles();
        for (const file of files) {
          await service.removeFile(file.startTimestamp);
        }
      } catch {}
    }

    const files = await fs.readdir(TEST_DIR).catch(() => []);
    for (const file of files) {
      await fs.unlink(path.join(TEST_DIR, file)).catch(() => {});
    }

    service = new SearchService(TEST_CONFIG, logger);
    await service.open();
  });

  afterEach(async () => {
    await service.close();
  });

  test("should reserve IDs in reflux order (newest = smallest id)", async () => {
    const timestamp = 1000000;

    await service.reserve([
      { id: "doc-1", timestamp },
      { id: "doc-2", timestamp },
      { id: "doc-3", timestamp },
    ]);

    await service.addDocument("doc-1", timestamp, "common", "en");
    await service.addDocument("doc-2", timestamp, "common", "en");
    await service.addDocument("doc-3", timestamp, "common", "en");

    await service.flushAll();

    const results = await service.search("common");
    expect(results).toEqual(["doc-3", "doc-2", "doc-1"]);
  });

  test("should handle duplicate reservations gracefully", async () => {
    const timestamp = 1000000;
    await service.reserve([{ id: "doc-1", timestamp }]);
    await service.reserve([{ id: "doc-1", timestamp }]);

    await service.addDocument("doc-1", timestamp, "test content", "en");
    await service.flushAll();

    const results = await service.search("test");
    expect(results).toContain("doc-1");
  });

  test("should create index files and search documents using flushAll", async () => {
    const docId = "doc-1";
    const timestamp = 1000000;
    const body = "This is a test document for search.";

    await service.addDocument(docId, timestamp, body, "en");
    await service.flushAll();

    const files = await service.listFiles(true);
    expect(files.length).toBe(1);

    const file = files[0];
    expect(file.countDocuments).toBe(1);
    expect(file.isHealthy).toBe(true);

    const results = await service.search("test search");
    expect(results).toContain(docId);
  });

  test("should return results in newest-first order within shard using reflux", async () => {
    const timestamp = 1000000;
    await service.addDocument("doc-old", timestamp, "same keyword", "en");
    await service.addDocument("doc-mid", timestamp, "same keyword", "en");
    await service.addDocument("doc-new", timestamp, "same keyword", "en");
    await service.flushAll();

    const results = await service.search("same keyword");
    expect(results).toEqual(["doc-new", "doc-mid", "doc-old"]);
  });

  test("should handle multiple shards and respect cross-shard order", async () => {
    const doc1 = { id: "old-shard-doc", ts: 1000000, body: "common" };
    const doc2 = { id: "new-shard-doc", ts: 2000000, body: "common" };

    await service.addDocument(doc1.id, doc1.ts, doc1.body, "en");
    await service.addDocument(doc2.id, doc2.ts, doc2.body, "en");
    await service.flushAll();

    const results = await service.search("common");
    expect(results[0]).toBe(doc2.id);
    expect(results[1]).toBe(doc1.id);
  });

  test("should throw error when RowID is exhausted", async () => {
    const exhaustedConfig = { ...TEST_CONFIG, initialDocumentId: 1 };
    const lowIdService = new SearchService(exhaustedConfig, logger);
    await lowIdService.open();

    const ts = 1000000;
    await lowIdService.addDocument("doc-1", ts, "text", "en");
    await lowIdService.addDocument("doc-2", ts, "text", "en");

    await expect(lowIdService.flushAll()).rejects.toThrow(/RowID exhausted/);
    await lowIdService.close().catch(() => {});
  });

  test("should reconstruct shard with new initial ID", async () => {
    const timestamp = 1000000;
    await service.addDocument("doc-1", timestamp, "reconstruction test", "en");
    await service.addDocument("doc-2", timestamp, "reconstruction test", "en");
    await service.flushAll();

    const initialResults = await service.search("reconstruction");
    expect(initialResults).toEqual(["doc-2", "doc-1"]);

    const shard = (service as any).shards.get(timestamp);
    const newInitialId = 268435455;
    await shard.reconstruct(newInitialId);

    const postResults = await service.search("reconstruction");
    expect(postResults).toEqual(["doc-2", "doc-1"]);

    const row = await shard.db.get("SELECT rowid FROM docs WHERE rowid = ?", [newInitialId]);
    expect(row.rowid).toBe(newInitialId);
  });

  test("should remove document correctly (recordContents: true)", async () => {
    const docId = "delete-me";
    const timestamp = 1000000;

    await service.addDocument(docId, timestamp, "searchable content", "en");
    await service.flushAll();
    expect(await service.search("searchable")).toContain(docId);

    await service.removeDocument(docId, timestamp);
    await service.flushAll();

    const results = await service.search("searchable");
    expect(results).not.toContain(docId);
  });

  test("should detect unhealthy index if file is tampered", async () => {
    const timestamp = 3000000;
    await service.addDocument("health-doc", timestamp, "Check health", "en");
    await service.flushAll();
    await service.close();

    const shardFile = path.join(TEST_DIR, `${TEST_CONFIG.namePrefix}-${timestamp}.db`);
    await fs.writeFile(shardFile, "NOT A SQLITE FILE ANYMORE");

    service = new SearchService(TEST_CONFIG, logger);
    await service.open();

    const files = await service.listFiles();
    const file = files.find((f) => f.startTimestamp === timestamp);
    expect(file?.isHealthy).toBe(false);
  });

  test("should support pagination (offset and limit)", async () => {
    const timestamp = 1000000;
    await service.addDocument("doc-1", timestamp, "paging", "en");
    await service.addDocument("doc-2", timestamp, "paging", "en");
    await service.addDocument("doc-3", timestamp, "paging", "en");
    await service.addDocument("doc-4", timestamp, "paging", "en");
    await service.addDocument("doc-5", timestamp, "paging", "en");
    await service.flushAll();
    const all = await service.search("paging", "en", 100, 0);
    expect(all).toEqual(["doc-5", "doc-4", "doc-3", "doc-2", "doc-1"]);
    const page1 = await service.search("paging", "en", 2, 0);
    expect(page1).toEqual(["doc-5", "doc-4"]);
    const page2 = await service.search("paging", "en", 2, 2);
    expect(page2).toEqual(["doc-3", "doc-2"]);
    const page3 = await service.search("paging", "en", 2, 4);
    expect(page3).toEqual(["doc-1"]);
    const empty = await service.search("paging", "en", 2, 10);
    expect(empty).toEqual([]);
  });

  test("should store attributes and retrieve them via fetchDocuments", async () => {
    const timestamp = 1000000;
    const docId = "doc-with-attrs";
    const body = "content body";
    const attrs = JSON.stringify({ tag: "news", source: "external" });

    await service.addDocument(docId, timestamp, body, "en", attrs);
    await service.flushAll();

    const searchResults = await service.search("content");
    expect(searchResults).toContain(docId);

    const fetchedDocs = await service.fetchDocuments([docId]);
    expect(fetchedDocs).toHaveLength(1);
    expect(fetchedDocs[0].id).toBe(docId);
    expect(fetchedDocs[0].bodyText).toBe("body content");
    expect(fetchedDocs[0].attrs).toBe(attrs);
  });

  test("should respect omit flags in fetchDocuments", async () => {
    const timestamp = 1000000;
    const docId = "doc-omitted";
    const attrs = "some attributes";

    await service.addDocument(docId, timestamp, "full body", "en", attrs);
    await service.flushAll();

    const docsBoth = await service.fetchDocuments([docId], true, true);
    expect(docsBoth[0].bodyText).toBeNull();
    expect(docsBoth[0].attrs).toBeNull();

    const docsBodyOmit = await service.fetchDocuments([docId], true, false);
    expect(docsBodyOmit[0].bodyText).toBeNull();
    expect(docsBodyOmit[0].attrs).toBe(attrs);

    const docsAttrsOmit = await service.fetchDocuments([docId], false, true);
    expect(docsAttrsOmit[0].bodyText).toBe("body full");
    expect(docsAttrsOmit[0].attrs).toBeNull();
  });

  test("should fetch documents across multiple shards", async () => {
    const doc1 = { id: "old-doc", ts: 1000000, body: "b1", attrs: "a1" };
    const doc2 = { id: "new-doc", ts: 2000000, body: "b2", attrs: "a2" };

    await service.addDocument(doc1.id, doc1.ts, doc1.body, "en", doc1.attrs);
    await service.addDocument(doc2.id, doc2.ts, doc2.body, "en", doc2.attrs);
    await service.flushAll();

    const docs = await service.fetchDocuments([doc1.id, doc2.id]);
    expect(docs).toHaveLength(2);

    const fetched1 = docs.find((d) => d.id === doc1.id);
    const fetched2 = docs.find((d) => d.id === doc2.id);

    expect(fetched1).toBeDefined();
    expect(fetched1?.bodyText).toBe(doc1.body);
    expect(fetched1?.attrs).toBe(doc1.attrs);

    expect(fetched2).toBeDefined();
    expect(fetched2?.bodyText).toBe(doc2.body);
    expect(fetched2?.attrs).toBe(doc2.attrs);
  });

  describe("Contentless Mode (recordContents: false)", () => {
    let contentlessService: SearchService;

    beforeEach(async () => {
      await service.close();
      const contentlessConfig: SearchConfig = { ...TEST_CONFIG, recordContents: false };
      contentlessService = new SearchService(contentlessConfig, logger);
      await contentlessService.open();
    });

    afterEach(async () => {
      await contentlessService.close();
    });

    test("should throw error when trying to remove a document", async () => {
      const docId = "cl-doc-1";
      const timestamp = 1000000;
      await contentlessService.addDocument(docId, timestamp, "text", "en");
      await contentlessService.flushAll();
      await expect(contentlessService.removeDocument(docId, timestamp)).rejects.toThrow(
        /contentless mode/,
      );
    });

    test("should not update (add duplicate ID) in contentless mode", async () => {
      const docId = "cl-doc-2";
      const timestamp = 1000000;
      await contentlessService.addDocument(docId, timestamp, "original", "en");
      await contentlessService.flushAll();
      await contentlessService.addDocument(docId, timestamp, "updated", "en");
      await contentlessService.flushAll();

      const results = await contentlessService.search("updated");
      expect(results).not.toContain(docId);
    });
  });
});
