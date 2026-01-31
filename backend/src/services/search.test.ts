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
      const input: SearchInput = { query: "q", locale: "en", limit: 10 };
      const res = await service.search(input);

      expect(res).toEqual(["d1"]);
      const [urlStr] = mockFetch.mock.calls[0];
      const url = new URL(urlStr as string);
      expect(url.searchParams.get("query")).toBe("q");
      expect(url.searchParams.get("limit")).toBe("10");
    });
  });

  describe("Queuing: enqueueAddDocument / enqueueRemoveDocument", () => {
    beforeEach(() => {
      (pgQuery as jest.Mock).mockResolvedValue({ rowCount: 1, rows: [] });
    });

    it("enqueueAddDocument should insert task", async () => {
      const doc: Document = {
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
      expect(params).toEqual([BigInt("1000000000000000"), resourceName, "d1", "text", "en", 100]);
    });

    it("enqueueRemoveDocument should insert task with null body", async () => {
      await service.enqueueRemoveDocument("d1", 100);

      expect(pgQuery).toHaveBeenCalledTimes(1);
      const calls = (pgQuery as jest.Mock).mock.calls[0];
      const params = calls[2];

      expect(params[3]).toBeNull();
    });
  });

  describe("Worker: fetchTasks / deleteTasks", () => {
    it("fetchTasks should select tasks", async () => {
      const mockRows = [
        {
          id: "1",
          resource_type: resourceName,
          resource_id: "d1",
          body_text: "text",
          locale: "en",
          timestamp: "100",
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
