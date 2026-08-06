import type Redis from "ioredis";
import {
  makePubViewSignature,
  PubViewsService,
  verifyPubViewSignature,
} from "./pubViews";

class FakeRedis {
  cache = new Map<string, string>();
  daily: Record<string, string>[] = [];
  metas = new Map<string, string>();
  commandArgs: unknown[] | null = null;
  storedCaches: Array<{ key: string; ttl: number; value: string }> = [];
  mgetCalls = 0;

  async get(key: string): Promise<string | null> {
    return this.cache.get(key) ?? null;
  }

  pipeline() {
    const keys: string[] = [];
    return {
      hgetall(key: string) {
        keys.push(key);
        return this;
      },
      exec: async () => keys.map((_, index) => [null, this.daily[index] ?? {}]),
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
    if (name !== "stgyRecordPubView") throw new Error(`unexpected command: ${name}`);
    (this as unknown as Record<string, unknown>)[name] = async (...args: unknown[]) => {
      this.commandArgs = args;
      return 1;
    };
  }
}

function asRedis(redis: FakeRedis): Redis {
  return redis as unknown as Redis;
}

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
    const service = new PubViewsService(asRedis(redis));
    const added = await service.recordView({
      ownerId: "owner-a",
      postId: "post-a",
      publishedAt: "2026-08-01T00:00:00.000Z",
      digest: "digest",
      fingerprintHex: "01020304",
      now: new Date("2026-08-06T12:00:00.000Z"),
    });

    expect(added).toBe(true);
    expect(redis.commandArgs).not.toBeNull();
    const args = redis.commandArgs as unknown[];
    expect(args[0]).toBe("stgy:pub-views:lru:owner-a:post-a");
    expect(args[1]).toBe("stgy:pub-views:daily:owner-a:20260806");
    expect(args[2]).toBe("stgy:pub-views:meta:owner-a:post-a");
    expect(Buffer.isBuffer(args[3])).toBe(true);
    expect((args[3] as Buffer).toString("hex")).toBe("01020304");
    expect(JSON.parse(String(args[5]))).toEqual({
      publishedAt: "2026-08-01T00:00:00.000Z",
      digest: "digest",
    });
    expect(args.at(-1)).toBe("600");
  });

  test("getStats totals all rows and keeps only the exact top 1000", async () => {
    const redis = new FakeRedis();
    const firstDay: Record<string, string> = {};
    for (let i = 0; i < 1002; i++) {
      const id = `post-${String(i).padStart(4, "0")}`;
      firstDay[id] = "1";
      redis.metas.set(
        `stgy:pub-views:meta:owner-a:${id}`,
        JSON.stringify({
          publishedAt: "2026-08-01T00:00:00.000Z",
          digest: id,
        }),
      );
    }
    firstDay["post-1001"] = "3";
    redis.daily = [firstDay, { "post-1000": "2" }];

    const service = new PubViewsService(asRedis(redis));
    const stats = await service.getStats("owner-a", new Date("2026-08-06T12:00:00.000Z"));

    expect(stats.totalPv).toBe(1006);
    expect(stats.entries).toHaveLength(1000);
    expect(stats.entries[0]).toMatchObject({ id: "post-1000", pv: 3 });
    expect(stats.entries[1]).toMatchObject({ id: "post-1001", pv: 3 });
    expect(stats.entries.some((entry) => entry.id === "post-0997")).toBe(true);
    expect(stats.entries.some((entry) => entry.id === "post-0998")).toBe(false);
    expect(stats.entries.some((entry) => entry.id === "post-1000")).toBe(true);
    expect(stats.entries.some((entry) => entry.id === "post-1001")).toBe(true);
    expect(redis.storedCaches).toHaveLength(2);
    expect(redis.storedCaches.every((entry) => entry.ttl === 300)).toBe(true);
  });

  test("does not let an empty ranking cache hide a newly recorded daily view", async () => {
    const redis = new FakeRedis();
    redis.cache.set(
      "stgy:pub-views:ranking:owner-a",
      JSON.stringify({ totalPv: 0, entries: [] }),
    );
    redis.daily = [{ "post-a": "1" }];
    redis.metas.set(
      "stgy:pub-views:meta:owner-a:post-a",
      JSON.stringify({
        publishedAt: "2026-08-01T00:00:00.000Z",
        digest: "digest",
      }),
    );

    const service = new PubViewsService(asRedis(redis));
    const stats = await service.getStats("owner-a", new Date("2026-08-06T12:00:00.000Z"));

    expect(stats).toEqual({
      totalPv: 1,
      entries: [
        {
          id: "post-a",
          publishedAt: "2026-08-01T00:00:00.000Z",
          digest: "digest",
          pv: 1,
        },
      ],
    });
  });

  test("getPopular returns ranked IDs without loading stats metadata", async () => {
    const redis = new FakeRedis();
    redis.daily = [{ "post-a": "2", "post-b": "1" }];

    const service = new PubViewsService(asRedis(redis));
    await expect(service.getPopular("owner-a", 1)).resolves.toEqual([
      { id: "post-a", pv: 2 },
    ]);
    expect(redis.mgetCalls).toBe(0);
  });
});
