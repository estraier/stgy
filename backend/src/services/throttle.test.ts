import { ThrottleService } from "./throttle";
import type Redis from "ioredis";

describe("ThrottleService (amount + count throttling)", () => {
  const NOW = 1_726_000_000_000;
  const PERIOD_SEC = 60;
  const PERIOD_MS = PERIOD_SEC * 1000;
  const LIMIT_AMOUNT = 3;
  const LIMIT_COUNT = 3;
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
    const members = membersOfAmounts([1, 1]); // usedAmount=2, usedCount=2
    const multi = makeMultiMockForCanDo(members);
    const redis = makeRedisWithMulti(multi);
    const svc = new ThrottleService(redis, ACTION_ID, PERIOD_SEC, LIMIT_AMOUNT, LIMIT_COUNT);
    const ok = await svc.canDo("user-123", 1); // 2+1<=3 and 2<3
    expect(ok).toBe(true);
    const key = `throttle:${ACTION_ID}:user-123:history`;
    const cutoff = NOW - PERIOD_MS;
    expect(multi.zremrangebyscore).toHaveBeenCalledWith(key, 0, cutoff);
    expect(multi.pexpire).toHaveBeenCalledWith(key, PERIOD_MS + 1000);
    expect(multi.zrangebyscore).toHaveBeenCalledWith(key, cutoff, "+inf");
    expect(multi.exec).toHaveBeenCalledTimes(1);
  });

  test("canDo blocks by amount when usedAmount + amount > limitAmount", async () => {
    const members = membersOfAmounts([2.5, 0.4]); // usedAmount=2.9, usedCount=2
    const multi = makeMultiMockForCanDo(members);
    const redis = makeRedisWithMulti(multi);
    const svc = new ThrottleService(redis, ACTION_ID, PERIOD_SEC, LIMIT_AMOUNT, 0); // no count limit
    const ok1 = await svc.canDo("user-1", 0.05); // 2.9+0.05=2.95<=3
    const ok2 = await svc.canDo("user-1", 0.2); // 2.9+0.2=3.1>3
    expect(ok1).toBe(true);
    expect(ok2).toBe(false);
  });

  test("canDo blocks by count when usedCount >= limitCount (even if amount is fine)", async () => {
    const members = membersOfAmounts([0.2, 0.2, 0.2]); // usedCount=3
    const multi = makeMultiMockForCanDo(members);
    const redis = makeRedisWithMulti(multi);
    const svc = new ThrottleService(redis, ACTION_ID, PERIOD_SEC, 999, LIMIT_COUNT);
    const ok = await svc.canDo("user-2", 0.1);
    expect(ok).toBe(false);
  });

  test("canDo amount=1 keeps backward compatibility", async () => {
    const members = membersOfAmounts([2]); // usedAmount=2
    const multi = makeMultiMockForCanDo(members);
    const redis = makeRedisWithMulti(multi);
    const svc = new ThrottleService(redis, ACTION_ID, PERIOD_SEC, LIMIT_AMOUNT, 10);
    const ok = await svc.canDo("user-3", 1); // amount defaults to 1 -> 2+1<=3
    expect(ok).toBe(true);
  });

  test("recordDone stores amount, trims old entries, sets TTL", async () => {
    const multi = makeMultiMockForRecordDone();
    const redis = makeRedisWithMulti(multi);
    const svc = new ThrottleService(redis, ACTION_ID, PERIOD_SEC, LIMIT_AMOUNT, LIMIT_COUNT);
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
    const svc = new ThrottleService(redis, ACTION_ID, PERIOD_SEC, LIMIT_AMOUNT, LIMIT_COUNT);
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
});
