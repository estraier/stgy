import { ThrottleService } from "./throttle";
import type Redis from "ioredis";

describe("ThrottleService (fixed actionId + per-user throttling, amount-aware)", () => {
  const NOW = 1_726_000_000_000;
  const PERIOD_SEC = 60;
  const PERIOD_MS = PERIOD_SEC * 1000;
  const LIMIT = 3;
  const ACTION_ID = "sendMail";

  let dateNowSpy: jest.SpyInstance<number, []>;

  beforeAll(() => {
    dateNowSpy = jest.spyOn(Date, "now").mockReturnValue(NOW);
  });

  afterAll(() => {
    dateNowSpy.mockRestore();
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  function membersOfAmounts(amts: number[]): string[] {
    return amts.map((a, i) => `${NOW - 1000 - i}:x:${a}`);
  }

  function makeMultiMockForCanDo(members: string[]) {
    const multi = {
      zremrangebyscore: jest.fn().mockReturnThis(),
      pexpire: jest.fn().mockReturnThis(),
      zrangebyscore: jest.fn().mockReturnThis(),
      exec: jest.fn().mockResolvedValue([
        [null, 0],
        [null, 1],
        [null, members],
      ]),
    };
    return multi;
  }

  function makeMultiMockForRecordDone() {
    const multi = {
      zadd: jest.fn().mockReturnThis(),
      zremrangebyscore: jest.fn().mockReturnThis(),
      pexpire: jest.fn().mockReturnThis(),
      exec: jest.fn().mockResolvedValue([[null, "OK"]]),
    };
    return multi;
  }

  function makeRedisWithMulti(multi: any) {
    return { multi: jest.fn(() => multi) } as unknown as Redis;
  }

  test("canDo(userId) returns true when used + 1 <= limit (per user key)", async () => {
    const members = membersOfAmounts([1, 1]); // used=2, limit=3
    const multi = makeMultiMockForCanDo(members);
    const redis = makeRedisWithMulti(multi);
    const svc = new ThrottleService(redis, ACTION_ID, PERIOD_SEC, LIMIT);
    const userId = "user-123";
    const ok = await svc.canDo(userId, 1);
    expect(ok).toBe(true);
    const key = `throttle:${ACTION_ID}:${userId}:history`;
    const cutoff = NOW - PERIOD_MS;
    expect(multi.zremrangebyscore).toHaveBeenCalledWith(key, 0, cutoff);
    expect(multi.pexpire).toHaveBeenCalledWith(key, PERIOD_MS + 1000);
    expect(multi.zrangebyscore).toHaveBeenCalledWith(key, cutoff, "+inf");
    expect(multi.exec).toHaveBeenCalledTimes(1);
  });

  test("canDo(userId) returns false when used + 1 > limit", async () => {
    const members = membersOfAmounts([1, 1, 1]); // used=3, limit=3
    const multi = makeMultiMockForCanDo(members);
    const redis = makeRedisWithMulti(multi);
    const svc = new ThrottleService(redis, ACTION_ID, PERIOD_SEC, LIMIT);
    const ok = await svc.canDo("user-123", 1);
    expect(ok).toBe(false);
  });

  test("canDo respects amount parameter", async () => {
    const members = membersOfAmounts([2]); // used=2
    const multi = makeMultiMockForCanDo(members);
    const redis = makeRedisWithMulti(multi);
    const svc = new ThrottleService(redis, ACTION_ID, PERIOD_SEC, LIMIT);
    const ok1 = await svc.canDo("user-777", 1); // 2+1 <= 3
    expect(ok1).toBe(true);
    const ok2 = await svc.canDo("user-777", 2); // 2+2 > 3
    expect(ok2).toBe(false);
  });

  test("recordDone(userId) pushes entry (with amount), trims old, sets TTL", async () => {
    const multi = makeMultiMockForRecordDone();
    const redis = makeRedisWithMulti(multi);
    const svc = new ThrottleService(redis, ACTION_ID, PERIOD_SEC, LIMIT);
    const userId = "user-456";
    const key = `throttle:${ACTION_ID}:${userId}:history`;
    await svc.recordDone(userId, 1);
    expect(multi.zadd).toHaveBeenCalledTimes(1);
    const [zaddKey, zaddScore, zaddMember] = multi.zadd.mock.calls[0];
    expect(zaddKey).toBe(key);
    expect(zaddScore).toBe(NOW);
    expect(typeof zaddMember).toBe("string");
    expect(zaddMember.startsWith(`${NOW}:`)).toBe(true);
    expect(zaddMember.endsWith(":1")).toBe(true);
    expect(multi.zremrangebyscore).toHaveBeenCalledWith(key, 0, NOW - PERIOD_MS - 1000);
    expect(multi.pexpire).toHaveBeenCalledWith(key, PERIOD_MS + 1000);
    expect(multi.exec).toHaveBeenCalledTimes(1);
  });

  test("keys are isolated per user (different userIds => different keys)", async () => {
    const multi1 = makeMultiMockForCanDo(membersOfAmounts([]));
    const multi2 = makeMultiMockForCanDo(membersOfAmounts([1, 1]));
    let call = 0;
    const redis = {
      multi: jest.fn(() => (call++ === 0 ? multi1 : multi2)),
    } as unknown as Redis;
    const svc = new ThrottleService(redis, ACTION_ID, PERIOD_SEC, LIMIT);
    await svc.canDo("alice", 1);
    await svc.canDo("bob", 1);
    const cutoff = NOW - PERIOD_MS;
    expect(multi1.zremrangebyscore).toHaveBeenCalledWith(
      `throttle:${ACTION_ID}:alice:history`,
      0,
      cutoff,
    );
    expect(multi1.zrangebyscore).toHaveBeenCalledWith(
      `throttle:${ACTION_ID}:alice:history`,
      cutoff,
      "+inf",
    );
    expect(multi2.zremrangebyscore).toHaveBeenCalledWith(
      `throttle:${ACTION_ID}:bob:history`,
      0,
      cutoff,
    );
    expect(multi2.zrangebyscore).toHaveBeenCalledWith(
      `throttle:${ACTION_ID}:bob:history`,
      cutoff,
      "+inf",
    );
  });

  test("throws if userId is empty", async () => {
    const multi = makeMultiMockForCanDo(membersOfAmounts([]));
    const redis = makeRedisWithMulti(multi);
    const svc = new ThrottleService(redis, ACTION_ID, PERIOD_SEC, LIMIT);
    await expect(svc.canDo("", 1)).rejects.toThrow("userId is required");
    await expect(svc.recordDone(" ", 1)).rejects.toThrow("userId is required");
  });
});
