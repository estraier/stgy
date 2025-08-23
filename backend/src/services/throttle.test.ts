import { ThrottleService } from "./throttle";
import type Redis from "ioredis";

describe("ThrottleService (fixed actionId + per-user throttling)", () => {
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

  function makeMultiMockForCanDo(zcardCount: number) {
    const multi = {
      zremrangebyscore: jest.fn().mockReturnThis(),
      pexpire: jest.fn().mockReturnThis(),
      zcard: jest.fn().mockReturnThis(),
      zadd: jest.fn().mockReturnThis(),
      exec: jest.fn().mockResolvedValue([
        [null, 0],
        [null, 1],
        [null, zcardCount],
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
      zcard: jest.fn().mockReturnThis(),
    };
    return multi;
  }

  function makeRedisWithMulti(multi: any) {
    return { multi: jest.fn(() => multi) } as unknown as Redis;
  }

  test("canDo(userId) returns true when count < limit (per user key)", async () => {
    const multi = makeMultiMockForCanDo(LIMIT - 1);
    const redis = makeRedisWithMulti(multi);
    const svc = new ThrottleService(redis, ACTION_ID, PERIOD_SEC, LIMIT);
    const userId = "user-123";
    const ok = await svc.canDo(userId);
    expect(ok).toBe(true);
    const key = `throttle:${ACTION_ID}:${userId}:history`;
    const cutoff = NOW - PERIOD_MS;
    expect(multi.zremrangebyscore).toHaveBeenCalledWith(key, 0, cutoff);
    expect(multi.pexpire).toHaveBeenCalledWith(key, PERIOD_MS + 1000);
    expect(multi.zcard).toHaveBeenCalledWith(key);
    expect(multi.exec).toHaveBeenCalledTimes(1);
  });

  test("canDo(userId) returns false when count >= limit", async () => {
    const multi = makeMultiMockForCanDo(LIMIT);
    const redis = makeRedisWithMulti(multi);
    const svc = new ThrottleService(redis, ACTION_ID, PERIOD_SEC, LIMIT);
    const ok = await svc.canDo("user-123");
    expect(ok).toBe(false);
  });

  test("recordDone(userId) pushes entry, trims old, sets TTL (per user key)", async () => {
    const multi = makeMultiMockForRecordDone();
    const redis = makeRedisWithMulti(multi);
    const svc = new ThrottleService(redis, ACTION_ID, PERIOD_SEC, LIMIT);
    const userId = "user-456";
    const key = `throttle:${ACTION_ID}:${userId}:history`;
    await svc.recordDone(userId);
    expect(multi.zadd).toHaveBeenCalledTimes(1);
    const [zaddKey, zaddScore, zaddMember] = multi.zadd.mock.calls[0];
    expect(zaddKey).toBe(key);
    expect(zaddScore).toBe(NOW);
    expect(typeof zaddMember).toBe("string");
    expect(zaddMember.startsWith(`${NOW}:`)).toBe(true);
    expect(multi.zremrangebyscore).toHaveBeenCalledWith(key, 0, NOW - PERIOD_MS - 1000);
    expect(multi.pexpire).toHaveBeenCalledWith(key, PERIOD_MS + 1000);
    expect(multi.exec).toHaveBeenCalledTimes(1);
  });

  test("keys are isolated per user (different userIds => different keys)", async () => {
    const multi1 = makeMultiMockForCanDo(0);
    const multi2 = makeMultiMockForCanDo(2);
    let call = 0;
    const redis = {
      multi: jest.fn(() => (call++ === 0 ? multi1 : multi2)),
    } as unknown as Redis;
    const svc = new ThrottleService(redis, ACTION_ID, PERIOD_SEC, LIMIT);
    await svc.canDo("alice");
    await svc.canDo("bob");
    expect(multi1.zremrangebyscore).toHaveBeenCalledWith(
      `throttle:${ACTION_ID}:alice:history`,
      0,
      NOW - PERIOD_MS,
    );
    expect(multi2.zremrangebyscore).toHaveBeenCalledWith(
      `throttle:${ACTION_ID}:bob:history`,
      0,
      NOW - PERIOD_MS,
    );
  });

  test("throws if userId is empty", async () => {
    const multi = makeMultiMockForCanDo(0);
    const redis = makeRedisWithMulti(multi);
    const svc = new ThrottleService(redis, ACTION_ID, PERIOD_SEC, LIMIT);

    await expect(svc.canDo("")).rejects.toThrow("userId is required");
    await expect(svc.recordDone(" ")).rejects.toThrow("userId is required");
  });
});
