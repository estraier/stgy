import {
  CANONICAL_LINEAR_RANGE_MAX,
  CANONICAL_NEGATIVE_EXCURSION_TOLERANCE,
  CANONICAL_UPPER_ROUNDING_TOLERANCE,
  CanonicalChunkCache,
  normalizeCanonicalLinearSample,
} from "./canonical-source";

describe("CanonicalChunkCache", () => {
  test("evicts least recently used chunks to stay within its byte limit", () => {
    const cache = new CanonicalChunkCache(8);
    const a = new Uint16Array(2); // 4 bytes
    const b = new Uint16Array(2); // 4 bytes
    const c = new Uint16Array(2); // 4 bytes
    cache.put("s:chunk:0:0", a);
    cache.put("s:chunk:0:1", b);
    expect(cache.get("s:chunk:0:0")).toBe(a); // a becomes newest
    cache.put("s:chunk:0:2", c);
    expect(cache.get("s:chunk:0:0")).toBe(a);
    expect(cache.get("s:chunk:0:1")).toBeNull();
    expect(cache.get("s:chunk:0:2")).toBe(c);
    expect(cache.sizeBytes).toBe(8);
  });

  test("keeps one oversized chunk so a read can complete", () => {
    const cache = new CanonicalChunkCache(4);
    const oversized = new Uint16Array(4); // 8 bytes
    cache.put("s:chunk:0:0", oversized);
    expect(cache.get("s:chunk:0:0")).toBe(oversized);
    expect(cache.sizeEntries).toBe(1);
    expect(cache.sizeBytes).toBe(8);
  });

  test("can clear only one canonical session", () => {
    const cache = new CanonicalChunkCache(32);
    cache.put("a:chunk:0:0", new Uint16Array(2));
    cache.put("b:chunk:0:0", new Uint16Array(2));
    cache.clearSession("a");
    expect(cache.get("a:chunk:0:0")).toBeNull();
    expect(cache.get("b:chunk:0:0")).not.toBeNull();
  });
});


describe("normalizeCanonicalLinearSample", () => {
  test("absorbs only tiny finite floating-point excursions at the storage boundaries", () => {
    expect(normalizeCanonicalLinearSample(-0.000010203495548921637)).toBe(0);
    expect(normalizeCanonicalLinearSample(-CANONICAL_NEGATIVE_EXCURSION_TOLERANCE)).toBe(0);
    expect(normalizeCanonicalLinearSample(CANONICAL_LINEAR_RANGE_MAX + CANONICAL_UPPER_ROUNDING_TOLERANCE)).toBe(CANONICAL_LINEAR_RANGE_MAX);
    expect(normalizeCanonicalLinearSample(0.18)).toBe(0.18);
    // Supported Display P3 / Rec.2020 -> ProPhoto matrices can legitimately
    // produce tiny negative channels at saturated gamut boundaries.
    expect(normalizeCanonicalLinearSample(-0.00127175)).toBe(0);
    expect(normalizeCanonicalLinearSample(-0.00233881)).toBe(0);
  });

  test("does not hide real out-of-domain or non-finite data", () => {
    expect(() => normalizeCanonicalLinearSample(-0.01)).toThrow(/outside the supported/);
    expect(() => normalizeCanonicalLinearSample(CANONICAL_LINEAR_RANGE_MAX + 0.001)).toThrow(/outside the supported/);
    expect(() => normalizeCanonicalLinearSample(Number.NaN)).toThrow(/not finite/);
    expect(() => normalizeCanonicalLinearSample(Number.POSITIVE_INFINITY)).toThrow(/not finite/);
  });
});
