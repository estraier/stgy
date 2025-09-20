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
    NOTIFICATION_BATCH_SIZE: 50,
  },
}));

jest.mock("../utils/servers", () => ({
  pgQuery: jest.fn(async (pool: any, sql: string, params?: any[]) => pool.query(sql, params)),
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
    const connect = (jest.fn() as any).mockResolvedValue({ query, release: jest.fn() });
    const pg = { query, connect } as any;

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

    const clientQuery = (jest.fn() as any)
      .mockResolvedValueOnce({}) // BEGIN
      .mockResolvedValueOnce({}) // SET LOCAL
      .mockResolvedValueOnce({ rowCount: 7 }) // DELETE
      .mockResolvedValueOnce({}); // COMMIT
    const clientRelease = jest.fn();
    const pg = {
      connect: jest.fn(async () => ({ query: clientQuery, release: clientRelease })),
      query: jest.fn(),
    } as any;
    const redis = { publish: jest.fn() as any } as any;

    const svc = new EventLogService(pg, redis);
    const deleted = await svc.purgeOldRecords(5);

    expect(deleted).toBe(7);
    expect(clientQuery).toHaveBeenNthCalledWith(1, "BEGIN");
    expect(clientQuery).toHaveBeenNthCalledWith(2, "SET LOCAL statement_timeout = 10000");

    const [delSql, delParams] = clientQuery.mock.calls[3 - 1] as [string, any[]];
    expect(delSql).toMatch(/DELETE FROM event_logs/i);
    expect(delParams[0]).toBe(5);
    expect(delParams[1]).toBe(cutoffBig.toString());

    expect(clientQuery).toHaveBeenNthCalledWith(4, "COMMIT");
    expect(clientRelease).toHaveBeenCalledTimes(1);

    expect(lbSpy).toHaveBeenCalledTimes(1);
    expect(seenDate).not.toBeNull();
    const ninetyDaysMs = 90 * 24 * 60 * 60 * 1000;
    expect(seenDate!.getTime()).toBe(nowMs - ninetyDaysMs);
  });
});

describe("EventLogService (cursor & batch helpers)", () => {
  function mkSvc() {
    const query = (jest.fn() as any).mockResolvedValue({ rows: [] });
    const connect = (jest.fn() as any).mockResolvedValue({ query, release: jest.fn() });
    const pg = { query, connect } as any;
    const redis = { publish: jest.fn() as any } as any;
    const svc = new EventLogService(pg, redis);
    return { svc, pg, query };
  }

  test("loadCursor returns existing bigint when present", async () => {
    const { svc, query } = mkSvc();
    (query as any).mockResolvedValueOnce({ rows: [{ last_event_id: "1234567890123" }] });

    const out = await svc.loadCursor("notification", 7);
    expect(out).toBe(BigInt("1234567890123"));

    const [sql, params] = (query as any).mock.calls[0] as [string, any[]];
    expect(sql).toMatch(/SELECT\s+last_event_id\s+FROM\s+event_log_cursors/i);
    expect(params).toEqual(["notification", 7]);
    expect((query as any).mock.calls).toHaveLength(1);
  });

  test("loadCursor inserts default when missing and returns 0n", async () => {
    const { svc, query } = mkSvc();
    (query as any).mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({});

    const out = await svc.loadCursor("notification", 3);
    expect(out).toBe(BigInt(0));

    const [selSql, selParams] = (query as any).mock.calls[0] as [string, any[]];
    expect(selSql).toMatch(/SELECT\s+last_event_id/i);
    expect(selParams).toEqual(["notification", 3]);

    const [insSql, insParams] = (query as any).mock.calls[1] as [string, any[]];
    expect(insSql).toMatch(/INSERT INTO event_log_cursors/i);
    expect(insSql).toMatch(/ON CONFLICT \(consumer, partition_id\) DO NOTHING/i);
    expect(insParams).toEqual(["notification", 3, "0"]);
  });

  test("saveCursor updates row using provided transaction client", async () => {
    const { svc, pg } = mkSvc();
    const txQuery = jest.fn(async () => ({}) as any);
    const tx = { query: txQuery } as any;

    await svc.saveCursor(tx, "notification", 9, BigInt(777));

    expect(tx.query).toHaveBeenCalledTimes(1);
    const [sql, params] = (tx.query as any).mock.calls[0] as [string, any[]];
    expect(sql).toMatch(/UPDATE\s+event_log_cursors/i);
    expect(params).toEqual(["notification", 9, "777"]);

    expect(pg.query).not.toHaveBeenCalled();
  });

  test("fetchBatch queries with params and returns rows", async () => {
    const { svc, query } = mkSvc();
    const rows = [
      { event_id: "101", payload: { type: "like", userId: "u1", postId: "p1" } },
      {
        event_id: "102",
        payload: { type: "reply", userId: "u2", postId: "p2", replyToPostId: "r1" },
      },
    ];
    (query as any).mockResolvedValueOnce({ rows });

    const out = await svc.fetchBatch(4, BigInt(100), 2);

    expect(out).toEqual(rows);

    const [sql, params] = (query as any).mock.calls[0] as [string, any[]];
    expect(sql).toMatch(
      /SELECT\s+event_id,\s*payload(?:::\s*json\s+AS\s+payload)?\s+FROM\s+event_logs/i,
    );
    expect(sql).toMatch(/ORDER BY event_id ASC/i);
    expect(sql).toMatch(/LIMIT \$3/i);
    expect(params).toEqual([4, "100", 2]);
  });
});
