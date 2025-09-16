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

let pgInstanceFactory: () => any;

jest.mock("pg", () => {
  const Client = jest.fn().mockImplementation(() => {
    if (!pgInstanceFactory) throw new Error("pgInstanceFactory not set");
    return pgInstanceFactory();
  });
  return { Client };
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
  test("getSampleHost", async () => {
    const { getSampleAddr } = await import("./servers");
    expect(getSampleAddr()).toMatch(/\d+\.\d+\.\d+\.\d+/);
  });
});

describe("servers utils", () => {
  beforeEach(() => {
    jest.resetModules();
    jest.useFakeTimers();
    pgInstanceFactory = undefined as unknown as () => any;
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  const flush = async () => Promise.resolve();

  test("connectPgWithRetry: success on first try", async () => {
    const connect = jest.fn(async () => {});
    const end = jest.fn(async () => {});
    const client = { connect, end };
    pgInstanceFactory = () => client;

    const { connectPgWithRetry } = await import("./servers");
    const res = await connectPgWithRetry(5);

    expect(res).toBe(client);
    expect(connect).toHaveBeenCalledTimes(1);
    expect(end).not.toHaveBeenCalled();
  });

  test("connectPgWithRetry: retries then succeeds", async () => {
    const bad = {
      connect: jest.fn(async () => {
        throw new Error("fail-1");
      }),
      end: jest.fn(async () => {}),
    };
    const good = { connect: jest.fn(async () => {}), end: jest.fn(async () => {}) };
    const instances = [bad, good];
    pgInstanceFactory = () => {
      const i = instances.shift();
      if (!i) throw new Error("no more pg instances");
      return i;
    };

    const { connectPgWithRetry } = await import("./servers");
    const p = connectPgWithRetry(5);
    await flush();
    jest.advanceTimersByTime(1000);
    const res = await p;

    expect(res).toBe(good);
    expect(bad.connect).toHaveBeenCalledTimes(1);
    expect(bad.end).toHaveBeenCalledTimes(1);
    expect(good.connect).toHaveBeenCalledTimes(1);
  });

  test("connectPgWithRetry: times out", async () => {
    const alwaysBad = {
      connect: jest.fn(async () => {
        throw new Error("fail");
      }),
      end: jest.fn(async () => {}),
    };
    pgInstanceFactory = () => alwaysBad;

    const { connectPgWithRetry } = await import("./servers");
    const p = connectPgWithRetry(2);
    await flush();
    jest.advanceTimersByTime(3000);
    await expect(p).rejects.toThrow(/pg connect failed/);
    expect(alwaysBad.connect).toHaveBeenCalled();
    expect(alwaysBad.end).toHaveBeenCalled();
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
