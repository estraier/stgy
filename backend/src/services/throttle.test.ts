import { ThrottleService, DailyTimerThrottleService } from "./throttle";
import type Redis from "ioredis";
import { formatDateInTz } from "../utils/format";
import { Config } from "../config";
import { UserLite } from "../models/user";

describe("ThrottleService (count + amount throttling)", () => {
  const NOW = 1_726_000_000_000;
  const PERIOD_SEC = 60;
  const PERIOD_MS = PERIOD_SEC * 1000;
  const LIMIT_COUNT = 3;
  const LIMIT_AMOUNT = 3;
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

  test("canDo returns true when usedAmount + amount <= limitAmount and usedCount < limitCount", async () => {
    const members = membersOfAmounts([1, 1]);
    const multi = makeMultiMockForCanDo(members);
    const redis = makeRedisWithMulti(multi);
    const svc = new ThrottleService(redis, ACTION_ID, PERIOD_SEC, LIMIT_COUNT, LIMIT_AMOUNT);
    const ok = await svc.canDo("user-123", 1);
    expect(ok).toBe(true);
    const key = `throttle:${ACTION_ID}:user-123:history`;
    const cutoff = NOW - PERIOD_MS;
    expect(multi.zremrangebyscore).toHaveBeenCalledWith(key, 0, cutoff);
    expect(multi.pexpire).toHaveBeenCalledWith(key, PERIOD_MS + 1000);
    expect(multi.zrangebyscore).toHaveBeenCalledWith(key, cutoff, "+inf");
    expect(multi.exec).toHaveBeenCalledTimes(1);
  });

  test("canDo blocks by amount when usedAmount + amount > limitAmount", async () => {
    const members = membersOfAmounts([2.5, 0.4]);
    const multi = makeMultiMockForCanDo(members);
    const redis = makeRedisWithMulti(multi);
    const svc = new ThrottleService(redis, ACTION_ID, PERIOD_SEC, 0, LIMIT_AMOUNT);
    const ok1 = await svc.canDo("user-1", 0.05);
    const ok2 = await svc.canDo("user-1", 0.2);
    expect(ok1).toBe(true);
    expect(ok2).toBe(false);
  });

  test("canDo blocks by count when usedCount >= limitCount (even if amount is fine)", async () => {
    const members = membersOfAmounts([0.2, 0.2, 0.2]);
    const multi = makeMultiMockForCanDo(members);
    const redis = makeRedisWithMulti(multi);
    const svc = new ThrottleService(redis, ACTION_ID, PERIOD_SEC, LIMIT_COUNT, 999);
    const ok = await svc.canDo("user-2", 0.1);
    expect(ok).toBe(false);
  });

  test("canDo amount=1 keeps backward compatibility", async () => {
    const members = membersOfAmounts([2]);
    const multi = makeMultiMockForCanDo(members);
    const redis = makeRedisWithMulti(multi);
    const svc = new ThrottleService(redis, ACTION_ID, PERIOD_SEC, 10, LIMIT_AMOUNT);
    const ok = await svc.canDo("user-3", 1);
    expect(ok).toBe(true);
  });

  test("recordDone stores amount, trims old entries, sets TTL", async () => {
    const multi = makeMultiMockForRecordDone();
    const redis = makeRedisWithMulti(multi);
    const svc = new ThrottleService(redis, ACTION_ID, PERIOD_SEC, LIMIT_COUNT, LIMIT_AMOUNT);
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

  test("keys are isolated per user", async () => {
    const multi1 = makeMultiMockForCanDo(membersOfAmounts([]));
    const multi2 = makeMultiMockForCanDo(membersOfAmounts([1, 1]));
    let call = 0;
    const redis = { multi: jest.fn(() => (call++ === 0 ? multi1 : multi2)) } as unknown as Redis;
    const svc = new ThrottleService(redis, ACTION_ID, PERIOD_SEC, LIMIT_COUNT, LIMIT_AMOUNT);
    await svc.canDo("alice");
    await svc.canDo("bob");
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
});

describe("DailyTimerThrottleService (daily time budget per user)", () => {
  const TZ = Config.DEFAULT_TIMEZONE;
  const ACTION_ID = "all";
  const LIMIT = 180 * 1000;
  let dateNowSpy: jest.SpyInstance<number, []>;

  beforeAll(() => {
    dateNowSpy = jest.spyOn(Date, "now").mockReturnValue(Date.UTC(2025, 8, 29, 0, 0, 0));
  });

  afterAll(() => {
    dateNowSpy.mockRestore();
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  function makeRedisGetMock(value: string | null) {
    return { get: jest.fn().mockResolvedValue(value) } as unknown as Redis;
  }

  function makeRedisMultiMock() {
    const multi = {
      incrby: jest.fn().mockReturnThis(),
      expire: jest.fn().mockReturnThis(),
      exec: jest.fn().mockResolvedValue([[null, "OK"]]),
    };
    const redis = { multi: jest.fn(() => multi) } as unknown as Redis;
    return { redis, multi };
  }

  test("canDo returns true when no usage yet (key missing)", async () => {
    const redis = makeRedisGetMock(null);
    const svc = new DailyTimerThrottleService(redis, ACTION_ID, LIMIT);
    const ok = await svc.canDo("user-1");
    expect(ok).toBe(true);
    const day = formatDateInTz(Date.now(), TZ);
    expect((redis as any).get).toHaveBeenCalledWith(`dtt:${ACTION_ID}:${day}:user-1`);
  });

  test("canDo returns true when used < limit", async () => {
    const redis = makeRedisGetMock("179999");
    const svc = new DailyTimerThrottleService(redis, ACTION_ID, LIMIT);
    const ok = await svc.canDo("user-2");
    expect(ok).toBe(true);
  });

  test("canDo returns false when used >= limit", async () => {
    const redis = makeRedisGetMock("180000");
    const svc = new DailyTimerThrottleService(redis, ACTION_ID, LIMIT);
    const ok = await svc.canDo("user-3");
    expect(ok).toBe(false);
  });

  test("recordDone increments usage and sets TTL (~2 days)", async () => {
    const { redis, multi } = makeRedisMultiMock();
    const svc = new DailyTimerThrottleService(redis, ACTION_ID, LIMIT);
    await svc.recordDone("user-4", 250);
    const day = formatDateInTz(Date.now(), TZ);
    const key = `dtt:${ACTION_ID}:${day}:user-4`;
    expect((redis as any).multi).toHaveBeenCalledTimes(1);
    expect(multi.incrby).toHaveBeenCalledWith(key, 250);
    expect(multi.expire).toHaveBeenCalledWith(key, 2 * 24 * 60 * 60);
    expect(multi.exec).toHaveBeenCalledTimes(1);
  });

  test("recordDone ignores non-positive elapsed values", async () => {
    const { redis, multi } = makeRedisMultiMock();
    const svc = new DailyTimerThrottleService(redis, ACTION_ID, LIMIT);
    await svc.recordDone("user-5", 0);
    await svc.recordDone("user-5", -10);
    expect((redis as any).multi).not.toHaveBeenCalled();
    expect(multi.incrby).not.toHaveBeenCalled();
    expect(multi.exec).not.toHaveBeenCalled();
  });

  test("keys are isolated per user and include local day from timezone", async () => {
    const day = formatDateInTz(Date.now(), TZ);
    const redis = makeRedisGetMock("0");
    const svc = new DailyTimerThrottleService(redis, ACTION_ID, LIMIT);
    await svc.canDo("alice");
    await svc.canDo("bob");
    expect((redis as any).get).toHaveBeenNthCalledWith(1, `dtt:${ACTION_ID}:${day}:alice`);
    expect((redis as any).get).toHaveBeenNthCalledWith(2, `dtt:${ACTION_ID}:${day}:bob`);
  });

  test("timezone boundary affects the day portion of the key (Asia/Tokyo)", async () => {
    dateNowSpy.mockReturnValueOnce(Date.UTC(2025, 8, 28, 16, 0, 0));
    const redis = makeRedisGetMock(null);
    const svc = new DailyTimerThrottleService(redis, ACTION_ID, LIMIT);
    await svc.canDo("user-6");
    const day = formatDateInTz(Date.UTC(2025, 8, 28, 16, 0, 0), TZ);
    expect((redis as any).get).toHaveBeenCalledWith(`dtt:${ACTION_ID}:${day}:user-6`);
    expect(day).toBe("2025-09-29");
  });
});

describe("DailyTimerThrottleService.startWatch", () => {
  let perfSpy: jest.SpyInstance<number, []>;

  beforeEach(() => {
    perfSpy = jest.spyOn(globalThis.performance, "now");
  });

  afterEach(() => {
    perfSpy.mockRestore();
    jest.clearAllMocks();
  });

  function makeSvc() {
    const redis = {} as unknown as Redis;
    return new DailyTimerThrottleService(redis, "all", 180_000);
  }

  test("records on done()", () => {
    perfSpy.mockReturnValueOnce(1000).mockReturnValueOnce(1300);
    const svc = makeSvc();
    const spy = jest.spyOn(svc, "recordDone").mockResolvedValue(undefined);
    const w = svc.startWatch({ id: "u1", isAdmin: false } as unknown as UserLite);
    w.done();
    expect(spy).toHaveBeenCalledWith("u1", expect.closeTo(300, 0.5));
  });

  test("no done() -> no record", () => {
    perfSpy.mockReturnValueOnce(1000).mockReturnValueOnce(1300);
    const svc = makeSvc();
    const spy = jest.spyOn(svc, "recordDone").mockResolvedValue(undefined);
    svc.startWatch({ id: "u2" } as unknown as UserLite);
    expect(spy).not.toHaveBeenCalled();
  });

  test("admin skips", () => {
    perfSpy.mockReturnValueOnce(10).mockReturnValueOnce(25);
    const svc = makeSvc();
    const spy = jest.spyOn(svc, "recordDone").mockResolvedValue(undefined);
    const w = svc.startWatch({ id: "admin", isAdmin: true } as unknown as UserLite);
    w.done();
    expect(spy).not.toHaveBeenCalled();
  });

  test("idempotent done()", () => {
    perfSpy.mockReturnValueOnce(1000).mockReturnValueOnce(1300);
    const svc = makeSvc();
    const spy = jest.spyOn(svc, "recordDone").mockResolvedValue(undefined);
    const w = svc.startWatch({ id: "u3" } as unknown as UserLite);
    w.done();
    w.done();
    expect(spy).toHaveBeenCalledTimes(1);
  });

  test("does not record for non-positive elapsed", () => {
    perfSpy.mockReturnValueOnce(500).mockReturnValueOnce(500);
    const svc = makeSvc();
    const spy = jest.spyOn(svc, "recordDone").mockResolvedValue(undefined);
    const w = svc.startWatch({ id: "u4" } as unknown as UserLite);
    w.done();
    expect(spy).not.toHaveBeenCalled();
  });

  test("recordDone errors are swallowed", () => {
    perfSpy.mockReturnValueOnce(100).mockReturnValueOnce(180);
    const svc = makeSvc();
    jest.spyOn(svc, "recordDone").mockRejectedValue(new Error("x"));
    const w = svc.startWatch({ id: "u5" } as unknown as UserLite);
    expect(() => w.done()).not.toThrow();
  });
});
