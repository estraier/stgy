import { writeSearchCache } from "./searchCache";

describe("search cache TTL", () => {
  test("writes through an atomic script that preserves an existing TTL", async () => {
    const evalFn = jest.fn().mockResolvedValue(1);
    const redis = { eval: evalFn } as any;
    const cache = {
      query: "foo",
      limit: 20,
      tokens: ["foo"],
      phrases: ["foo"],
      result: ["0000000000000001"],
    };

    await writeSearchCache(redis, "cache-key", cache);

    expect(evalFn).toHaveBeenCalledTimes(1);
    const args = evalFn.mock.calls[0];
    expect(args[1]).toBe(1);
    expect(args[2]).toBe("cache-key");
    expect(args[3]).toBe(JSON.stringify(cache));
    expect(args[0]).toContain("PTTL");
    expect(args[0]).toContain("PEXPIRE");
  });
});
