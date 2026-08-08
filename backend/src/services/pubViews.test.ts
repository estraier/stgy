import type Redis from "ioredis";
import type { Pool } from "pg";
import {
  makePubViewSignature,
  PubViewsService,
  verifyPubViewSignature,
} from "./pubViews";

class FakePgPool {
  checkpointCount = 0;
  syncRows: Array<{
    target_date: string;
    count: number;
  }> = [];
  statsRows: Array<{
    post_id: string;
    target_date: string;
    count: number;
  }> = [];
  postMetaRows: Array<{
    id: string;
    published_at: string | null;
    snippet: string;
  }> = [];
  queries: Array<{ sql: string; params: unknown[] }> = [];

  async query(sql: string, params: unknown[] = []) {
    this.queries.push({ sql, params });
    if (/SELECT count FROM post_pub_access_counts/i.test(sql)) {
      return { rows: this.checkpointCount > 0 ? [{ count: this.checkpointCount }] : [] };
    }
    if (
      /SELECT\s+target_date::text\s+AS\s+target_date,\s*count/is.test(sql) &&
      /WHERE\s+post_id\s*=\s*\$1/is.test(sql)
    ) {
      return { rows: this.syncRows };
    }
    if (/FROM\s+post_pub_access_counts\s+WHERE\s+owner_id\s*=\s*\$1/is.test(sql)) {
      return { rows: this.statsRows };
    }
    if (/WITH\s+req\s+AS/is.test(sql) && /JOIN\s+posts\s+p\s+ON\s+p\.id\s*=\s*r\.id/is.test(sql)) {
      return { rows: this.postMetaRows };
    }
    return { rows: [] };
  }
}

class FakeRedis {
  cache = new Map<string, string>();
  daily: Record<string, string>[] = [];
  metas = new Map<string, string>();
  hashValues = new Map<string, Map<string, string>>();
  commandArgs: unknown[] | null = null;
  maxCommandArgs: unknown[] | null = null;
  maxCommandCalls: unknown[][] = [];
  recordResult = 1;
  storedCaches: Array<{ key: string; ttl: number; value: string }> = [];
  mgetCalls = 0;

  async get(key: string): Promise<string | null> {
    return this.cache.get(key) ?? null;
  }

  pipeline() {
    const operations: Array<
      | { type: "hgetall"; key: string }
      | { type: "hget"; key: string; field: string }
    > = [];
    return {
      hgetall(key: string) {
        operations.push({ type: "hgetall", key });
        return this;
      },
      hget(key: string, field: string) {
        operations.push({ type: "hget", key, field });
        return this;
      },
      exec: async () => {
        let hgetallIndex = 0;
        return operations.map((operation) => {
          if (operation.type === "hget") {
            return [null, this.hashValues.get(operation.key)?.get(operation.field) ?? null];
          }
          return [null, this.daily[hgetallIndex++] ?? {}];
        });
      },
    };
  }

  async mget(...keys: string[]): Promise<Array<string | null>> {
    this.mgetCalls++;
    return keys.map((key) => this.metas.get(key) ?? null);
  }

  async setex(key: string, ttl: number, value: string): Promise<"OK"> {
    this.cache.set(key, value);
    this.storedCaches.push({ key, ttl, value });
    return "OK";
  }

  defineCommand(name: string): void {
    if (name === "stgyRecordPubView") {
      (this as unknown as Record<string, unknown>)[name] = async (...args: unknown[]) => {
        this.commandArgs = args;
        return this.recordResult;
      };
      return;
    }
    if (name === "stgyMaxPubView") {
      (this as unknown as Record<string, unknown>)[name] = async (...args: unknown[]) => {
        this.maxCommandArgs = args;
        this.maxCommandCalls.push(args);
        const key = String(args[0]);
        const field = String(args[1]);
        const minimum = Number(args[2]);
        const values = this.hashValues.get(key) ?? new Map<string, string>();
        const current = Number(values.get(field) ?? 0);
        if (current < minimum) values.set(field, String(minimum));
        this.hashValues.set(key, values);
        return Math.max(current, minimum);
      };
      return;
    }
    throw new Error(`unexpected command: ${name}`);
  }
}

function asRedis(redis: FakeRedis): Redis {
  return redis as unknown as Redis;
}

function asPool(pool: FakePgPool): Pool {
  return pool as unknown as Pool;
}

const OWNER_ID = "0001000000000001";
const POST_ID = "0001000000000002";

describe("PubViewsService", () => {
  test("signatures are bound to the post and fingerprint", () => {
    const signature = makePubViewSignature("post-a", "01020304");
    expect(verifyPubViewSignature("post-a", "01020304", signature)).toBe(true);
    expect(verifyPubViewSignature("post-b", "01020304", signature)).toBe(false);
    expect(verifyPubViewSignature("post-a", "05060708", signature)).toBe(false);
    expect(verifyPubViewSignature("post-a", "invalid", signature)).toBe(false);
  });

  test("recordView sends the binary fingerprint and three keys in one Lua call", async () => {
    const redis = new FakeRedis();
    const service = new PubViewsService(asPool(new FakePgPool()), asRedis(redis));
    const added = await service.recordView({
      ownerId: OWNER_ID,
      postId: "post-a",
      publishedAt: "2026-08-01T00:00:00.000Z",
      digest: "digest",
      fingerprintHex: "01020304",
      now: new Date("2026-08-06T12:00:00.000Z"),
    });

    expect(added).toBe(true);
    expect(redis.commandArgs).not.toBeNull();
    const args = redis.commandArgs as unknown[];
    expect(args[0]).toBe(`stgy:pub-views:lru:${OWNER_ID}:post-a`);
    expect(args[1]).toBe(`stgy:pub-views:daily:${OWNER_ID}:20260806`);
    expect(args[2]).toBe(`stgy:pub-views:meta:${OWNER_ID}:post-a`);
    expect(Buffer.isBuffer(args[3])).toBe(true);
    expect((args[3] as Buffer).toString("hex")).toBe("01020304");
    expect(JSON.parse(String(args[5]))).toEqual({
      publishedAt: "2026-08-01T00:00:00.000Z",
      digest: "digest",
    });
    expect(args.at(-1)).toBe("600");
  });

  test("recordView persists only checkpoint counts", async () => {
    const pg = new FakePgPool();
    const redis = new FakeRedis();
    redis.recordResult = 8;
    const service = new PubViewsService(asPool(pg), asRedis(redis));

    await service.recordView({
      ownerId: OWNER_ID,
      postId: POST_ID,
      publishedAt: "2026-08-01T00:00:00.000Z",
      digest: "digest",
      fingerprintHex: "01020304",
      now: new Date("2026-08-06T12:00:00.000Z"),
    });

    const checkpointInsert = pg.queries.find((q) =>
      /INSERT INTO post_pub_access_counts/i.test(q.sql),
    );
    expect(checkpointInsert).toBeDefined();
    expect(checkpointInsert?.sql).toMatch(/post_pub_access_counts\.count < EXCLUDED\.count/i);
    expect(checkpointInsert?.params[0]).toBe("281474976710658");
    expect(checkpointInsert?.params[1]).toBe("281474976710657");
    expect(checkpointInsert?.params[2]).toEqual(["2026-08-06"]);
    expect(checkpointInsert?.params[3]).toEqual([8]);

    const pg2 = new FakePgPool();
    const redis2 = new FakeRedis();
    redis2.recordResult = 5;
    const service2 = new PubViewsService(asPool(pg2), asRedis(redis2));
    await service2.recordView({
      ownerId: OWNER_ID,
      postId: POST_ID,
      publishedAt: "2026-08-01T00:00:00.000Z",
      digest: "digest",
      fingerprintHex: "05060708",
      now: new Date("2026-08-06T12:00:00.000Z"),
    });

    expect(pg2.queries).toHaveLength(0);
  });

  test("the first checkpoint synchronizes all available Redis days for the post", async () => {
    const pg = new FakePgPool();
    pg.syncRows = [
      { target_date: "2026-08-04", count: 3 },
      { target_date: "2026-08-02", count: 91 },
    ];
    const redis = new FakeRedis();
    redis.recordResult = 4;
    redis.hashValues.set(
      `stgy:pub-views:daily:${OWNER_ID}:20260806`,
      new Map([[POST_ID, "4"]]),
    );
    redis.hashValues.set(
      `stgy:pub-views:daily:${OWNER_ID}:20260805`,
      new Map([[POST_ID, "2"]]),
    );
    redis.hashValues.set(
      `stgy:pub-views:daily:${OWNER_ID}:20260804`,
      new Map([[POST_ID, "3"]]),
    );
    redis.hashValues.set(
      `stgy:pub-views:daily:${OWNER_ID}:20260803`,
      new Map([[POST_ID, "1"]]),
    );
    const service = new PubViewsService(asPool(pg), asRedis(redis));

    await service.recordView({
      ownerId: OWNER_ID,
      postId: POST_ID,
      publishedAt: "2026-08-01T00:00:00.000Z",
      digest: "digest",
      fingerprintHex: "01020304",
      now: new Date("2026-08-06T12:00:00.000Z"),
    });

    const rangeQuery = pg.queries.find((q) =>
      /WHERE\s+post_id\s*=\s*\$1[\s\S]*target_date\s*>=\s*\$2::date/i.test(q.sql),
    );
    expect(rangeQuery?.params).toEqual([
      "281474976710658",
      "2026-07-23",
      "2026-08-06",
    ]);

    const upsert = pg.queries.find((q) => /INSERT INTO post_pub_access_counts/i.test(q.sql));
    expect(upsert?.params).toEqual([
      "281474976710658",
      "281474976710657",
      ["2026-08-06", "2026-08-05", "2026-08-03"],
      [4, 2, 1],
    ]);

    expect(redis.maxCommandCalls).toHaveLength(1);
    expect(redis.maxCommandCalls[0]?.slice(0, 3)).toEqual([
      `stgy:pub-views:daily:${OWNER_ID}:20260802`,
      POST_ID,
      "91",
    ]);
    expect(Number(redis.maxCommandCalls[0]?.[3])).toBe(
      Math.floor(Date.parse("2026-08-18T00:00:00.000Z") / 1000),
    );
  });

  test("later checkpoints synchronize only the current day", async () => {
    const pg = new FakePgPool();
    const redis = new FakeRedis();
    redis.recordResult = 8;
    redis.hashValues.set(
      `stgy:pub-views:daily:${OWNER_ID}:20260805`,
      new Map([[POST_ID, "2"]]),
    );
    const service = new PubViewsService(asPool(pg), asRedis(redis));

    await service.recordView({
      ownerId: OWNER_ID,
      postId: POST_ID,
      publishedAt: "2026-08-01T00:00:00.000Z",
      digest: "digest",
      fingerprintHex: "01020304",
      now: new Date("2026-08-06T12:00:00.000Z"),
    });

    expect(
      pg.queries.some((q) => /target_date\s*>=\s*\$2::date/i.test(q.sql)),
    ).toBe(false);
    const upsert = pg.queries.find((q) => /INSERT INTO post_pub_access_counts/i.test(q.sql));
    expect(upsert?.params[2]).toEqual(["2026-08-06"]);
    expect(upsert?.params[3]).toEqual([8]);
  });

  test("the first checkpoint raises any of the ten Redis days to a larger DB value", async () => {
    const pg = new FakePgPool();
    pg.syncRows = [
      { target_date: "2026-08-06", count: 91 },
      { target_date: "2026-08-05", count: 54 },
    ];
    const redis = new FakeRedis();
    redis.recordResult = 4;
    redis.hashValues.set(
      `stgy:pub-views:daily:${OWNER_ID}:20260806`,
      new Map([[POST_ID, "4"]]),
    );
    const service = new PubViewsService(asPool(pg), asRedis(redis));

    await service.recordView({
      ownerId: OWNER_ID,
      postId: POST_ID,
      publishedAt: "2026-08-01T00:00:00.000Z",
      digest: "digest",
      fingerprintHex: "01020304",
      now: new Date("2026-08-06T12:00:00.000Z"),
    });

    expect(redis.maxCommandCalls.map((args) => args.slice(0, 3))).toEqual([
      [`stgy:pub-views:daily:${OWNER_ID}:20260806`, POST_ID, "91"],
      [`stgy:pub-views:daily:${OWNER_ID}:20260805`, POST_ID, "54"],
    ]);
    expect(pg.queries.some((q) => /INSERT INTO post_pub_access_counts/i.test(q.sql))).toBe(false);
  });

  test("later checkpoint raises only the current Redis day after Redis loss", async () => {
    const pg = new FakePgPool();
    pg.checkpointCount = 91;
    const redis = new FakeRedis();
    redis.recordResult = 8;
    const service = new PubViewsService(asPool(pg), asRedis(redis));

    await service.recordView({
      ownerId: OWNER_ID,
      postId: POST_ID,
      publishedAt: "2026-08-01T00:00:00.000Z",
      digest: "digest",
      fingerprintHex: "01020304",
      now: new Date("2026-08-06T12:00:00.000Z"),
    });

    expect(redis.maxCommandCalls).toHaveLength(1);
    expect(redis.maxCommandCalls[0]?.slice(0, 3)).toEqual([
      `stgy:pub-views:daily:${OWNER_ID}:20260806`,
      POST_ID,
      "91",
    ]);
  });

  test("cleanup is triggered by the first checkpoint but not later checkpoints", async () => {
    const pg = new FakePgPool();
    const redis = new FakeRedis();
    redis.recordResult = 4;
    redis.hashValues.set(
      `stgy:pub-views:daily:${OWNER_ID}:20260809`,
      new Map([[POST_ID, "4"]]),
    );
    const service = new PubViewsService(asPool(pg), asRedis(redis));

    await service.recordView({
      ownerId: OWNER_ID,
      postId: POST_ID,
      publishedAt: "2026-08-01T00:00:00.000Z",
      digest: "digest",
      fingerprintHex: "01020304",
      now: new Date("2026-08-09T12:00:00.000Z"),
    });

    redis.recordResult = 8;
    await service.recordView({
      ownerId: OWNER_ID,
      postId: POST_ID,
      publishedAt: "2026-08-01T00:00:00.000Z",
      digest: "digest",
      fingerprintHex: "05060708",
      now: new Date("2026-08-09T12:00:00.000Z"),
    });

    const cleanupQueries = pg.queries.filter((q) =>
      /DELETE FROM post_pub_access_counts/i.test(q.sql),
    );
    expect(cleanupQueries).toHaveLength(1);
    expect(cleanupQueries[0]?.params).toEqual(["2026-08-09", 14]);
  });

  test("getStats totals all rows and keeps only the exact top 1000", async () => {
    const redis = new FakeRedis();
    const firstDay: Record<string, string> = {};
    for (let i = 0; i < 1002; i++) {
      const id = `post-${String(i).padStart(4, "0")}`;
      firstDay[id] = "1";
      redis.metas.set(
        `stgy:pub-views:meta:${OWNER_ID}:${id}`,
        JSON.stringify({
          publishedAt: "2026-08-01T00:00:00.000Z",
          digest: id,
        }),
      );
    }
    firstDay["post-1001"] = "3";
    redis.daily = [firstDay, { "post-1000": "2" }];

    const service = new PubViewsService(asPool(new FakePgPool()), asRedis(redis));
    const stats = await service.getStats(OWNER_ID, new Date("2026-08-06T12:00:00.000Z"));

    expect(stats.retentionDays).toBe(15);
    expect(stats.totalPv).toBe(1006);
    expect(stats.dailyPv).toHaveLength(15);
    expect(stats.dailyPv.slice(-2)).toEqual([
      { date: "2026-08-05", pv: 2 },
      { date: "2026-08-06", pv: 1004 },
    ]);
    expect(stats.entries).toHaveLength(1000);
    expect(stats.entries[0]).toMatchObject({ id: "post-1000", pv: 3 });
    expect(stats.entries[0]?.dailyPv.slice(-2)).toEqual([2, 1]);
    expect(stats.entries[1]).toMatchObject({ id: "post-1001", pv: 3 });
    expect(stats.entries[1]?.dailyPv.slice(-2)).toEqual([0, 3]);
    expect(stats.entries.some((entry) => entry.id === "post-0997")).toBe(true);
    expect(stats.entries.some((entry) => entry.id === "post-0998")).toBe(false);
    expect(stats.entries.some((entry) => entry.id === "post-1000")).toBe(true);
    expect(stats.entries.some((entry) => entry.id === "post-1001")).toBe(true);
    expect(redis.storedCaches).toHaveLength(1);
    expect(redis.storedCaches[0]).toMatchObject({
      key: `stgy:pub-views:stats:${OWNER_ID}`,
      ttl: 300,
    });
  });

  test("does not let an empty stats cache hide a newly recorded daily view", async () => {
    const redis = new FakeRedis();
    redis.cache.set(
      `stgy:pub-views:stats:${OWNER_ID}`,
      JSON.stringify({ totalPv: 0, entries: [] }),
    );
    redis.daily = [{ "post-a": "1" }];
    redis.metas.set(
      `stgy:pub-views:meta:${OWNER_ID}:post-a`,
      JSON.stringify({
        publishedAt: "2026-08-01T00:00:00.000Z",
        digest: "digest",
      }),
    );

    const service = new PubViewsService(asPool(new FakePgPool()), asRedis(redis));
    const stats = await service.getStats(OWNER_ID, new Date("2026-08-06T12:00:00.000Z"));

    expect(stats).toEqual({
      retentionDays: 15,
      totalPv: 1,
      dailyPv: [
        { date: "2026-07-23", pv: 0 },
        { date: "2026-07-24", pv: 0 },
        { date: "2026-07-25", pv: 0 },
        { date: "2026-07-26", pv: 0 },
        { date: "2026-07-27", pv: 0 },
        { date: "2026-07-28", pv: 0 },
        { date: "2026-07-29", pv: 0 },
        { date: "2026-07-30", pv: 0 },
        { date: "2026-07-31", pv: 0 },
        { date: "2026-08-01", pv: 0 },
        { date: "2026-08-02", pv: 0 },
        { date: "2026-08-03", pv: 0 },
        { date: "2026-08-04", pv: 0 },
        { date: "2026-08-05", pv: 0 },
        { date: "2026-08-06", pv: 1 },
      ],
      entries: [
        {
          id: "post-a",
          publishedAt: "2026-08-01T00:00:00.000Z",
          digest: "digest",
          pv: 1,
          dailyPv: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1],
        },
      ],
    });
  });

  test("getStats takes the per-day maximum of Redis and DB checkpoints", async () => {
    const pg = new FakePgPool();
    pg.statsRows = [
      {
        post_id: "281474976710658",
        target_date: "2026-08-06",
        count: 91,
      },
      {
        post_id: "281474976710658",
        target_date: "2026-08-05",
        count: 54,
      },
      {
        post_id: "281474976710659",
        target_date: "2026-08-05",
        count: 32,
      },
    ];
    pg.postMetaRows = [
      {
        id: "281474976710659",
        published_at: "2026-08-02T00:00:00.000Z",
        snippet: '[{"T":"p","X":"db post"}]',
      },
    ];
    const redis = new FakeRedis();
    redis.daily = [{ [POST_ID]: "100" }, {}];
    redis.metas.set(
      `stgy:pub-views:meta:${OWNER_ID}:${POST_ID}`,
      JSON.stringify({
        publishedAt: "2026-08-01T00:00:00.000Z",
        digest: "redis digest",
      }),
    );
    const service = new PubViewsService(asPool(pg), asRedis(redis));

    const stats = await service.getStats(OWNER_ID, new Date("2026-08-06T12:00:00.000Z"));

    const checkpointQuery = pg.queries.find((q) =>
      /FROM\s+post_pub_access_counts\s+WHERE\s+owner_id\s*=\s*\$1/is.test(q.sql),
    );
    expect(checkpointQuery).toBeDefined();
    expect(checkpointQuery?.sql).not.toMatch(/JOIN\s+posts/i);
    expect(checkpointQuery?.params).toEqual([
      "281474976710657",
      "2026-07-23",
      "2026-08-06",
    ]);

    expect(stats.retentionDays).toBe(15);
    expect(stats.totalPv).toBe(186);
    expect(stats.dailyPv).toHaveLength(15);
    expect(stats.dailyPv.slice(-2)).toEqual([
      { date: "2026-08-05", pv: 86 },
      { date: "2026-08-06", pv: 100 },
    ]);
    expect(stats.entries).toEqual([
      {
        id: POST_ID,
        publishedAt: "2026-08-01T00:00:00.000Z",
        digest: "redis digest",
        pv: 154,
        dailyPv: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 54, 100],
      },
      {
        id: "0001000000000003",
        publishedAt: "2026-08-02T00:00:00.000Z",
        digest: "db post",
        pv: 32,
        dailyPv: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 32, 0],
      },
    ]);
  });

  test("getRankingEntries returns ranked IDs without loading stats metadata", async () => {
    const redis = new FakeRedis();
    redis.daily = [{ "post-a": "2", "post-b": "1" }];

    const service = new PubViewsService(asPool(new FakePgPool()), asRedis(redis));
    await expect(service.getRankingEntries(OWNER_ID, 1)).resolves.toEqual([
      { id: "post-a", pv: 2 },
    ]);
    expect(redis.mgetCalls).toBe(0);
  });
});
