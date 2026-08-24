import { makeKwicCacheKey, readKwicCache, writeKwicCache } from "./kwicCache";

const emptyKwic = { version: 1 as const, title: null, segments: [] };

describe("KWIC cache", () => {
  test("cache key depends on ordered keywords", () => {
    expect(makeKwicCacheKey("posts", ["foo", "bar"])).not.toBe(
      makeKwicCacheKey("posts", ["bar", "foo"]),
    );
    expect(makeKwicCacheKey("posts", ["foo", "bar"])).toBe(
      makeKwicCacheKey("posts", ["foo", "bar"]),
    );
    expect(makeKwicCacheKey("posts", ["foo"])).not.toBe(
      makeKwicCacheKey("users", ["foo"]),
    );
  });

  test("reads all requested document fields with one HMGET", async () => {
    const hmget = jest.fn().mockResolvedValue([
      JSON.stringify(emptyKwic),
      null,
      "malformed-json",
    ]);
    const redis = { hmget } as any;

    const cached = await readKwicCache(redis, "cache-key", ["a", "b", "c"]);

    expect(hmget).toHaveBeenCalledWith("cache-key", "a", "b", "c");
    expect(hmget).toHaveBeenCalledTimes(1);
    expect(cached.get("a")).toEqual(emptyKwic);
    expect(cached.has("b")).toBe(false);
    expect(cached.has("c")).toBe(false);
  });

  test("writes all generated entries at once and sets TTL only with NX", async () => {
    const pipeline = {
      hset: jest.fn().mockReturnThis(),
      expire: jest.fn().mockReturnThis(),
      exec: jest.fn().mockResolvedValue([]),
    };
    const redis = { pipeline: jest.fn(() => pipeline) } as any;

    await writeKwicCache(redis, "cache-key", [
      { id: "a", kwic: emptyKwic },
      { id: "b", kwic: emptyKwic },
    ]);

    expect(pipeline.hset).toHaveBeenCalledWith(
      "cache-key",
      "a",
      JSON.stringify(emptyKwic),
      "b",
      JSON.stringify(emptyKwic),
    );
    expect(pipeline.expire).toHaveBeenCalledWith("cache-key", expect.any(Number), "NX");
    expect(pipeline.exec).toHaveBeenCalledTimes(1);
  });
});
