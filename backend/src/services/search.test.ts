import { SearchService } from "./search";
import { Document, SearchInput } from "../models/search";
import { pgQuery } from "../utils/servers";

const mockFetch = jest.fn();
global.fetch = mockFetch;

jest.mock("../utils/servers", () => ({
  pgQuery: jest.fn(),
}));

const mockIssueBigint = jest.fn();
jest.mock("./idIssue", () => {
  return {
    IdIssueService: jest.fn().mockImplementation(() => {
      return {
        issueBigint: mockIssueBigint,
      };
    }),
  };
});

describe("SearchService", () => {
  const resourceName = "posts";
  const expectedSearchUrl = `http://localhost:3200/${resourceName}`;

  let service: SearchService;
  let mockPool: any;

  beforeEach(() => {
    mockFetch.mockReset();
    (pgQuery as jest.Mock).mockReset();
    mockIssueBigint.mockReset();

    mockPool = { _isMockPool: true };
    mockIssueBigint.mockResolvedValue(BigInt("1000000000000000"));

    service = new SearchService(mockPool, resourceName);
  });

  describe("Execution: addDocument / removeDocument / search", () => {
    it("addDocument should send PUT request", async () => {
      mockFetch.mockResolvedValueOnce({ ok: true, text: async () => "OK" });
      const doc: Document = {
        id: "d1",
        timestamp: 100,
        bodyText: "text",
        locale: "en",
        labels: [],
        numericValue: null,
      };

      await service.addDocument(doc);

      expect(mockFetch).toHaveBeenCalledTimes(1);
      const [url, options] = mockFetch.mock.calls[0];
      expect(url).toBe(`${expectedSearchUrl}/d1`);
      expect(options.method).toBe("PUT");
      const body = JSON.parse(options.body);
      expect(body).toEqual({
        text: "text",
        timestamp: 100,
        locale: "en",
        attrs: null,
        labels: [],
        numericValue: null,
      });
    });

    it("removeDocument should send DELETE request", async () => {
      mockFetch.mockResolvedValueOnce({ ok: true, text: async () => "OK" });
      await service.removeDocument("d1", 100);

      expect(mockFetch).toHaveBeenCalledTimes(1);
      const [url, options] = mockFetch.mock.calls[0];
      expect(url).toBe(`${expectedSearchUrl}/d1`);
      expect(options.method).toBe("DELETE");
      const body = JSON.parse(options.body);
      expect(body).toEqual({ timestamp: 100 });
    });

    it("search should send GET request", async () => {
      mockFetch.mockResolvedValueOnce({ ok: true, json: async () => ["d1"] });
      const input: SearchInput = {
        query: "q",
        locale: "en",
        limit: 10,
        labels: ["owner:0000000000000001", "foo bar"],
        numericOp: "lte",
        numericValue: 123,
      };
      const res = await service.search(input);

      expect(res).toEqual(["d1"]);
      const [urlStr] = mockFetch.mock.calls[0];
      const url = new URL(urlStr as string);
      expect(url.searchParams.get("query")).toBe("q");
      expect(url.searchParams.get("limit")).toBe("10");
      expect(url.searchParams.getAll("label")).toEqual([
        "owner:0000000000000001",
        "foo bar",
      ]);
      expect(url.searchParams.get("numericOp")).toBe("lte");
      expect(url.searchParams.get("numericValue")).toBe("123");
    });

    it("addDocument should forward labels and numericValue", async () => {
      mockFetch.mockResolvedValueOnce({ ok: true, text: async () => "OK" });
      await service.addDocument({
        id: "d1",
        timestamp: 100,
        bodyText: "text",
        locale: "en",
        labels: ["Owner:ABC"],
        numericValue: 456,
      });

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.labels).toEqual(["Owner:ABC"]);
      expect(body.numericValue).toBe(456);
    });

    it("getIndexMetadata should map post owner and publication time", async () => {
      (pgQuery as jest.Mock).mockResolvedValueOnce({
        rowCount: 1,
        rows: [{ owned_by: "1", published_at: "2026-08-18T00:00:00.000Z" }],
      });

      const metadata = await service.getIndexMetadata("0000000000000002");
      expect(metadata).toEqual({
        labels: ["owner:0000000000000001"],
        numericValue: Date.parse("2026-08-18T00:00:00.000Z"),
      });
    });
  });

  describe("Queuing: enqueueAddDocument / enqueueRemoveDocument", () => {
    beforeEach(() => {
      (pgQuery as jest.Mock).mockResolvedValue({ rowCount: 1, rows: [] });
    });

    it("enqueueAddDocument should insert task", async () => {
      const doc = {
        id: "d1",
        timestamp: 100,
        bodyText: "text",
        locale: "en",
      };
      await service.enqueueAddDocument(doc);

      expect(mockIssueBigint).toHaveBeenCalled();
      expect(pgQuery).toHaveBeenCalledTimes(1);

      const calls = (pgQuery as jest.Mock).mock.calls[0];
      const sql = calls[1];
      const params = calls[2];

      expect(sql).toContain("INSERT INTO search_indexing_tasks");
      expect(sql).toContain("name_prefix"); // 修正後のカラム名
      expect(params).toEqual([BigInt("1000000000000000"), resourceName, "d1", "text", "en", 100]);
    });

    it("enqueueRemoveDocument should insert task with null body", async () => {
      await service.enqueueRemoveDocument("d1", 100);

      expect(pgQuery).toHaveBeenCalledTimes(1);
      const calls = (pgQuery as jest.Mock).mock.calls[0];
      const params = calls[2];

      expect(params[3]).toBeNull();
    });

    it("uses the supplied transaction client for queue insertion", async () => {
      const client = { query: jest.fn() } as any;
      await service.enqueueAddDocument(
        { id: "d1", timestamp: 100, bodyText: "text", locale: "en" },
        client,
      );

      expect((pgQuery as jest.Mock).mock.calls[0][0]).toBe(client);
    });
  });

  describe("Worker: fetchTasks / deleteTasks", () => {
    it("fetchTasks should select tasks", async () => {
      const mockRows = [
        {
          id: "1",
          name_prefix: resourceName, // 修正後のカラム名
          doc_id: "d1", // 修正後のカラム名
          body_text: "text",
          locale: "en",
          doc_timestamp: "100", // 修正後のカラム名
        },
      ];
      (pgQuery as jest.Mock).mockResolvedValue({
        rowCount: 1,
        rows: mockRows,
      });

      const tasks = await service.fetchTasks(10);

      expect(tasks).toHaveLength(1);
      expect(tasks[0].resourceId).toBe("d1");
      expect(pgQuery).toHaveBeenCalledTimes(1);

      const calls = (pgQuery as jest.Mock).mock.calls[0];
      const sql = calls[1];
      const params = calls[2];

      expect(sql).toContain("SELECT");
      expect(sql).toContain("ORDER BY id ASC");
      expect(params).toEqual([resourceName, 10]);
    });

    it("deleteTasks should delete tasks by id", async () => {
      (pgQuery as jest.Mock).mockResolvedValue({ rowCount: 2, rows: [] });
      await service.deleteTasks(["1", "2"]);

      expect(pgQuery).toHaveBeenCalledTimes(1);

      const calls = (pgQuery as jest.Mock).mock.calls[0];
      const sql = calls[1];
      const params = calls[2];

      expect(sql).toContain("DELETE FROM search_indexing_tasks");
      expect(sql).toContain("IN ($1,$2)");
      expect(params).toEqual(["1", "2"]);
    });

    it("deleteTasks should do nothing if array is empty", async () => {
      await service.deleteTasks([]);
      expect(pgQuery).not.toHaveBeenCalled();
    });
  });
});
