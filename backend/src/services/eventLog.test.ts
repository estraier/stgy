// src/services/eventLog.test.ts
import { jest } from "@jest/globals";
import { EventLogService } from "./eventLog";
import { IdIssueService } from "./idIssue";

jest.mock("../config", () => ({
  Config: {
    EVENT_LOG_PARTITIONS: 16,
    EVENT_LOG_RETENTION_DAYS: 90,
    ID_ISSUE_WORKER_ID: 0,
    NOTIFICATION_WORKERS: 3,
  },
}));

describe("EventLogService (with Redis publish)", () => {
  const idBig = BigInt("0x1977420DC0007000");

  beforeEach(() => {
    jest.spyOn(IdIssueService.prototype, "issueBigint").mockResolvedValue(idBig);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  function mkSvc() {
    const query = (jest.fn() as any).mockResolvedValue({ rowCount: 1, rows: [] });
    const pg = { query } as any;

    const publish = (jest.fn() as any).mockResolvedValue(1);
    const redis = { publish } as any;

    const svc = new EventLogService(pg, redis);
    return { svc, pg, redis, query, publish };
  }

  test("recordReply inserts and publishes wake to the correct worker", async () => {
    const { svc, query, redis } = mkSvc();
    const out = await svc.recordReply({
      userId: "A1",
      postId: "P123",
      replyToPostId: "ROOT999",
    });
    expect(out).toBe(idBig);

    const [sql, params] = query.mock.calls[0] as [string, any[]];
    expect(sql).toMatch(/INSERT INTO event_logs/i);
    const part = svc.partitionForId("ROOT999");
    expect(params[0]).toBe(part);
    expect(params[1]).toBe(idBig.toString());
    expect(JSON.parse(params[2])).toEqual({
      type: "reply",
      userId: "A1",
      postId: "P123",
      replyToPostId: "ROOT999",
    });

    const worker = ((part % 3) + 3) % 3;
    expect(redis.publish).toHaveBeenCalledWith(`notifications:wake:${worker}`, String(part));
  });

  test("recordLike inserts and publishes wake", async () => {
    const { svc, query, redis } = mkSvc();
    const out = await svc.recordLike({ userId: "B2", postId: "POST-01" });
    expect(out).toBe(idBig);

    const [, params] = query.mock.calls[0] as [string, any[]];
    const part = svc.partitionForId("POST-01");
    expect(params[0]).toBe(part);
    expect(params[1]).toBe(idBig.toString());
    expect(JSON.parse(params[2])).toEqual({
      type: "like",
      userId: "B2",
      postId: "POST-01",
    });

    const worker = ((part % 3) + 3) % 3;
    expect(redis.publish).toHaveBeenCalledWith(`notifications:wake:${worker}`, String(part));
  });

  test("recordFollow inserts and publishes wake", async () => {
    const { svc, query, redis } = mkSvc();
    const out = await svc.recordFollow({ followerId: "U-NEW", followeeId: "10" });
    expect(out).toBe(idBig);

    const [, params] = query.mock.calls[0] as [string, any[]];
    const part = svc.partitionForId("10");
    expect(params[0]).toBe(part);
    expect(params[1]).toBe(idBig.toString());
    expect(JSON.parse(params[2])).toEqual({
      type: "follow",
      followerId: "U-NEW",
      followeeId: "10",
    });

    const worker = ((part % 3) + 3) % 3;
    expect(redis.publish).toHaveBeenCalledWith(`notifications:wake:${worker}`, String(part));
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

    const query = (jest.fn() as any)
      .mockResolvedValueOnce({}) // BEGIN
      .mockResolvedValueOnce({}) // SET LOCAL
      .mockResolvedValueOnce({ rowCount: 7 }) // DELETE
      .mockResolvedValueOnce({}); // COMMIT
    const pg = { query } as any;
    const redis = { publish: jest.fn() as any } as any;

    const svc = new EventLogService(pg, redis);
    const deleted = await svc.purgeOldRecords(5);

    expect(deleted).toBe(7);
    expect(query).toHaveBeenNthCalledWith(1, "BEGIN");
    expect(query).toHaveBeenNthCalledWith(2, "SET LOCAL statement_timeout = 10000");

    const [delSql, delParams] = query.mock.calls[2] as [string, any[]];
    expect(delSql).toMatch(/DELETE FROM event_logs/i);
    expect(delParams[0]).toBe(5);
    expect(delParams[1]).toBe(cutoffBig.toString());

    expect(query).toHaveBeenNthCalledWith(4, "COMMIT");

    expect(lbSpy).toHaveBeenCalledTimes(1);
    expect(seenDate).not.toBeNull();
    const ninetyDaysMs = 90 * 24 * 60 * 60 * 1000;
    expect(seenDate!.getTime()).toBe(nowMs - ninetyDaysMs);
  });
});
