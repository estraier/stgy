import { jest } from "@jest/globals";
import { EventLogService } from "./eventLog";
import { IdIssueService } from "./idIssue";

jest.mock("../config", () => ({
  Config: {
    EVENT_LOG_PARTITIONS: 16,
    EVENT_LOG_RETENTION_DAYS: 90,
    ID_ISSUE_WORKER_ID: 0,
  },
}));

describe("EventLogService (happy paths)", () => {
  const idBig = BigInt("0x1977420DC0007000");
  let queryMock: any;
  let pg: { query: any };
  beforeEach(() => {
    queryMock = (jest.fn() as any).mockImplementation((_sql: string, _params?: any[]) =>
      Promise.resolve({ rowCount: 1, rows: [] } as any),
    );
    pg = { query: queryMock };
    jest.spyOn(IdIssueService.prototype, "issueBigint").mockResolvedValue(idBig);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("recordReply inserts with partitionId = hex(replyToPostId) % 16", async () => {
    const svc = new EventLogService(pg as any);
    const out = await svc.recordReply({
      userId: "A1",
      postId: "P123",
      replyToPostId: "ROOT999",
    });
    expect(out).toBe(idBig);
    const [sql, params] = queryMock.mock.calls[0] as [string, any[]];
    expect(sql).toMatch(/INSERT INTO event_logs/i);
    expect(params[0]).toBe(svc.partitionForId("ROOT999"));
    expect(params[1]).toBe(idBig.toString());
    expect(JSON.parse(params[2])).toEqual({
      type: "reply",
      userId: "A1",
      postId: "P123",
      replyToPostId: "ROOT999",
    });
  });

  test("recordLike inserts with partitionId = hex(postId) % 16", async () => {
    const svc = new EventLogService(pg as any);
    const out = await svc.recordLike({
      userId: "B2",
      postId: "POST-01",
    });
    expect(out).toBe(idBig);
    const [, params] = queryMock.mock.calls[0] as [string, any[]];
    expect(params[0]).toBe(svc.partitionForId("POST-01"));
    expect(params[1]).toBe(idBig.toString());
    expect(JSON.parse(params[2])).toEqual({
      type: "like",
      userId: "B2",
      postId: "POST-01",
    });
  });

  test("recordFollow inserts with partitionId = hex(followedUserId) % 16", async () => {
    const svc = new EventLogService(pg as any);
    const out = await svc.recordFollow({
      followerId: "U-NEW",
      followeeId: "10",
    });
    expect(out).toBe(idBig);
    const [, params] = queryMock.mock.calls[0] as [string, any[]];
    expect(params[0]).toBe(svc.partitionForId("10"));
    expect(params[1]).toBe(idBig.toString());
    expect(JSON.parse(params[2])).toEqual({
      type: "follow",
      followerId: "U-NEW",
      followeeId: "10",
    });
  });

  test("purgeOldRecords deletes rows older than retention with statement timeout", async () => {
    const nowMs = 1_750_000_000_000;
    jest.spyOn(Date, "now").mockReturnValue(nowMs);
    let seenDate: Date | null = null;
    const cutoffBig = BigInt("0xABCDE");
    const lbSpy = jest
      .spyOn(IdIssueService, "lowerBoundIdForDate")
      .mockImplementation((d: Date) => {
        seenDate = d;
        return cutoffBig;
      });
    queryMock.mockReset();
    queryMock
      .mockImplementationOnce(() => Promise.resolve({ rowCount: 0, rows: [] }))
      .mockImplementationOnce(() => Promise.resolve({ rowCount: 0, rows: [] }))
      .mockImplementationOnce(() => Promise.resolve({ rowCount: 7, rows: [] }))
      .mockImplementationOnce(() => Promise.resolve({ rowCount: 0, rows: [] }));
    const svc = new EventLogService(pg as any);
    const deleted = await svc.purgeOldRecords(5);
    expect(deleted).toBe(7);
    expect(queryMock).toHaveBeenNthCalledWith(1, "BEGIN");
    expect(queryMock).toHaveBeenNthCalledWith(2, "SET LOCAL statement_timeout = $1", [10_000]);
    const [delSql, delParams] = queryMock.mock.calls[3 - 1] as [string, any[]];
    expect(delSql).toMatch(/DELETE FROM event_logs/i);
    expect(delParams[0]).toBe(5);
    expect(delParams[1]).toBe(cutoffBig.toString());
    expect(queryMock).toHaveBeenNthCalledWith(4, "COMMIT");
    expect(lbSpy).toHaveBeenCalledTimes(1);
    expect(seenDate).not.toBeNull();
    const ninetyDaysMs = 90 * 24 * 60 * 60 * 1000;
    expect(seenDate!.getTime()).toBe(nowMs - ninetyDaysMs);
  });
});
