import { EventEmitter } from "events";

jest.mock("../config", () => ({
  Config: {
    DATABASE_HOST: "localhost",
    DATABASE_PORT: 5432,
    DATABASE_USER: "user",
    DATABASE_PASSWORD: "pass",
    DATABASE_NAME: "db",
    REDIS_HOST: "127.0.0.1",
    REDIS_PORT: 6379,
    REDIS_PASSWORD: undefined,
  },
}));

let pgPoolFactory: () => any;

jest.mock("pg", () => {
  const Pool = jest.fn().mockImplementation(() => {
    if (!pgPoolFactory) throw new Error("pgPoolFactory not set");
    return pgPoolFactory();
  });
  (Pool as any).__create = (overrides: Partial<any> = {}) => {
    const inst: any = {
      query: jest.fn(async () => ({ rows: [], rowCount: 0 })),
      end: jest.fn(async () => {}),
      ...overrides,
    };
    return inst;
  };
  (Pool as any).__setFactory = (f: () => any) => (Pool as any).mockImplementation(f);
  return { Pool };
});

jest.mock("ioredis", () => {
  const makeInstance = () => {
    const em = new EventEmitter();
    const inst: any = em;
    inst.status = "idle";
    inst.connect = jest.fn(async () => {});
    inst.disconnect = jest.fn(() => {});
    return inst;
  };

  const ctor: any = jest.fn().mockImplementation(() => makeInstance());
  ctor.__create = makeInstance;
  ctor.__setFactory = (f: () => any) => ctor.mockImplementation(f);

  return { __esModule: true, default: ctor };
});

describe("network utils", () => {
  test("getSampleAddr", async () => {
    const { getSampleAddr } = await import("./servers");
    expect(getSampleAddr()).toMatch(/\d+\.\d+\.\d+\.\d+/);
  });
});

describe("servers utils (Pool/pgQuery, Redis)", () => {
  beforeEach(() => {
    jest.resetModules();
    jest.useFakeTimers();
    pgPoolFactory = undefined as unknown as () => any;
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  const flush = async () => Promise.resolve();

  test("connectPgWithRetry: success on first try", async () => {
    const { Pool }: any = await import("pg");
    const poolInst = Pool.__create({
      query: jest.fn(async (text: string) => {
        if (text === "SELECT 1") return { rows: [{ "?column?": 1 }], rowCount: 1 };
        return { rows: [], rowCount: 0 };
      }),
    });
    pgPoolFactory = () => poolInst;

    const { connectPgWithRetry } = await import("./servers");
    const res = await connectPgWithRetry(5);

    expect(res).toBe(poolInst);
    expect(poolInst.query).toHaveBeenCalledWith("SELECT 1");
    expect(poolInst.end).not.toHaveBeenCalled();
  });

  test("connectPgWithRetry: retries then succeeds", async () => {
    const { Pool }: any = await import("pg");

    const bad = Pool.__create({
      query: jest.fn(async () => {
        throw new Error("fail-1");
      }),
    });
    const good = Pool.__create({
      query: jest.fn(async () => ({ rows: [{ "?column?": 1 }], rowCount: 1 })),
    });

    const seq = [bad, good];
    pgPoolFactory = () => {
      const i = seq.shift();
      if (!i) throw new Error("no more pool instances");
      return i;
    };

    const { connectPgWithRetry } = await import("./servers");
    const p = connectPgWithRetry(5);
    await flush();
    jest.advanceTimersByTime(1000);
    const res = await p;

    expect(res).toBe(good);
    expect(bad.query).toHaveBeenCalledTimes(1);
    expect(bad.end).toHaveBeenCalledTimes(1);
    expect(good.query).toHaveBeenCalledTimes(1);
  });

  test("connectPgWithRetry: times out", async () => {
    const { Pool }: any = await import("pg");

    const alwaysBad = Pool.__create({
      query: jest.fn(async () => {
        throw new Error("fail");
      }),
    });
    pgPoolFactory = () => alwaysBad;

    const { connectPgWithRetry } = await import("./servers");
    const p = connectPgWithRetry(2);
    await flush();
    jest.advanceTimersByTime(3000);
    await expect(p).rejects.toThrow(/pg connect failed/);
    expect(alwaysBad.query).toHaveBeenCalled();
    expect(alwaysBad.end).toHaveBeenCalled();
  });

  test("pgQuery: success on first try", async () => {
    const poolInst: any = {
      query: jest.fn(async () => ({ rows: [{ a: 1 }], rowCount: 1 })),
    };
    const { pgQuery } = await import("./servers");
    const res = await pgQuery<{ a: number }>(poolInst, "SELECT 1", []);
    expect(poolInst.query).toHaveBeenCalledWith("SELECT 1", []);
    expect(res.rows[0].a).toBe(1);
  });

  test("pgQuery: retries then succeeds", async () => {
    const failingThenOk = jest
      .fn()
      .mockRejectedValueOnce(new Error("q1"))
      .mockResolvedValueOnce({ rows: [{ a: 2 }], rowCount: 1 });
    const poolInst: any = { query: failingThenOk };

    const { pgQuery } = await import("./servers");
    const p = pgQuery<{ a: number }>(poolInst, "SELECT 2", [], 3);
    await flush();
    jest.advanceTimersByTime(200);
    const res = await p;

    expect(failingThenOk).toHaveBeenCalledTimes(2);
    expect(res.rows[0].a).toBe(2);
  });

  test("pgQuery: times out after attempts", async () => {
    const alwaysFail = jest.fn().mockRejectedValue(new Error("fail"));
    const poolInst: any = { query: alwaysFail };

    const { pgQuery } = await import("./servers");
    const p = pgQuery(poolInst, "SELECT 3", [], 2);
    await flush();
    jest.advanceTimersByTime(200);
    await flush();
    jest.advanceTimersByTime(400);
    await expect(p).rejects.toThrow(/fail/);
    expect(alwaysFail).toHaveBeenCalledTimes(2);
  });

  test("connectRedisWithRetry: success when already ready", async () => {
    const RedisMock: any = (await import("ioredis")).default;
    const inst = RedisMock.__create();
    inst.status = "ready";
    inst.connect.mockResolvedValue(undefined);

    RedisMock.__setFactory(() => inst);

    const { connectRedisWithRetry } = await import("./servers");
    const r = await connectRedisWithRetry(5);

    expect(r).toBe(inst);
    expect(inst.connect).toHaveBeenCalledTimes(1);
  });

  test("connectRedisWithRetry: waits for ready event", async () => {
    const RedisMock: any = (await import("ioredis")).default;
    const inst = RedisMock.__create();
    inst.status = "connecting";
    inst.connect.mockResolvedValue(undefined);

    setTimeout(() => inst.emit("ready"), 5);

    RedisMock.__setFactory(() => inst);

    const { connectRedisWithRetry } = await import("./servers");
    const p = connectRedisWithRetry(5);
    await flush();
    jest.advanceTimersByTime(5);
    const r = await p;

    expect(r).toBe(inst);
    expect(inst.connect).toHaveBeenCalledTimes(1);
  });

  test("connectRedisWithRetry: retries then succeeds", async () => {
    const RedisMock: any = (await import("ioredis")).default;

    const bad = RedisMock.__create();
    bad.connect.mockRejectedValue(new Error("r-fail"));

    const good = RedisMock.__create();
    good.status = "ready";
    good.connect.mockResolvedValue(undefined);

    const seq = [bad, good];
    RedisMock.__setFactory(() => {
      const i = seq.shift();
      if (!i) throw new Error("no more redis instances");
      return i;
    });

    const { connectRedisWithRetry } = await import("./servers");
    const p = connectRedisWithRetry(5);
    await flush();
    jest.advanceTimersByTime(1000);
    const r = await p;

    expect(r).toBe(good);
    expect(bad.connect).toHaveBeenCalledTimes(1);
    expect(bad.disconnect).toHaveBeenCalledTimes(1);
    expect(good.connect).toHaveBeenCalledTimes(1);
  });

  test("connectRedisWithRetry: times out", async () => {
    const RedisMock: any = (await import("ioredis")).default;

    const alwaysBad = RedisMock.__create();
    alwaysBad.connect.mockRejectedValue(new Error("r-fail"));

    RedisMock.__setFactory(() => alwaysBad);

    const { connectRedisWithRetry } = await import("./servers");
    const p = connectRedisWithRetry(2);
    await flush();
    jest.advanceTimersByTime(3000);
    await expect(p).rejects.toThrow(/redis connect failed/);
    expect(alwaysBad.connect).toHaveBeenCalled();
    expect(alwaysBad.disconnect).toHaveBeenCalled();
  });
});
