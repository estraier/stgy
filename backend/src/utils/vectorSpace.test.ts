import { encodeFeatures, decodeFeatures, cosineSimilarity } from "./vectorSpace";

describe("encodeFeatures / decodeFeatures", () => {
  test("encodeFeatures: basic quantization (gamma=0.7, dim=3)", () => {
    const enc = encodeFeatures([1, 0, -1], 3, 0.95);
    expect(Array.from(enc)).toEqual([127, 0, -127]);
  });

  test("encodeFeatures: range is [-127,127] (never emits -128)", () => {
    const enc = encodeFeatures([1, 0.123, -1], 3, 0.95);
    const arr = Array.from(enc);
    expect(arr).not.toContain(-128);
    expect(arr.every((q) => q >= -127 && q <= 127)).toBe(true);
  });

  test("encodeFeatures: throws on non-finite inputs", () => {
    expect(() => encodeFeatures([Number.NaN, 1], 2, 1)).toThrow();
    expect(() => encodeFeatures([Number.POSITIVE_INFINITY], 1, 1)).toThrow();
    expect(() => encodeFeatures([1, Number.NEGATIVE_INFINITY], 2, 1)).toThrow();
  });

  test("encodeFeatures: throws when percentile is invalid", () => {
    expect(() => encodeFeatures([1], 1, -0.1)).toThrow();
    expect(() => encodeFeatures([1], 1, 1.1)).toThrow();
    expect(() => encodeFeatures([1], 1, Number.NaN)).toThrow();
  });

  test("decodeFeatures: round-trip is exact for endpoints {-127,0,127}", () => {
    const enc = encodeFeatures([1, 0, -1], 3, 0.95);
    const dec = decodeFeatures(enc);
    expect(dec).toHaveLength(3);
    expect(dec[0]).toBeCloseTo(1, 12);
    expect(dec[1]).toBeCloseTo(0, 12);
    expect(dec[2]).toBeCloseTo(-1, 12);
  });

  test("decodeFeatures: outputs are within [-1, 1] for encoded output", () => {
    const enc = encodeFeatures([2, 1, 0.5, 0, -0.5, -1, -2], 7, 1);
    const dec = decodeFeatures(enc);
    for (const v of dec) {
      expect(v).toBeGreaterThanOrEqual(-1);
      expect(v).toBeLessThanOrEqual(1);
    }
  });

  test("encode/decode: mid values are approximately preserved when scale=1", () => {
    const enc = encodeFeatures([1, 0.25], 2, 1);
    expect(enc[0]).toBe(127);
    expect(enc[1]).toBe(48);
    const dec = decodeFeatures(enc);
    expect(dec[0]).toBeCloseTo(1, 12);
    expect(dec[1]).toBeCloseTo(0.25, 2);
  });
});

describe("cosineSimilarity", () => {
  test("same vector -> 1", () => {
    expect(cosineSimilarity([1, 2, 3], [1, 2, 3])).toBeCloseTo(1, 12);
  });

  test("scale-invariant: v and 2v -> 1", () => {
    expect(cosineSimilarity([1, 2], [2, 4])).toBeCloseTo(1, 12);
  });

  test("orthogonal vectors -> 0", () => {
    expect(cosineSimilarity([1, 0], [0, 2])).toBeCloseTo(0, 12);
  });

  test("opposite vectors -> -1", () => {
    expect(cosineSimilarity([1, -2, 3], [-1, 2, -3])).toBeCloseTo(-1, 12);
  });

  test("either is zero vector -> 0", () => {
    expect(cosineSimilarity([0, 0, 0], [1, 2, 3])).toBe(0);
    expect(cosineSimilarity([1, 2, 3], [0, 0, 0])).toBe(0);
    expect(cosineSimilarity([0, 0], [0, 0])).toBe(0);
  });

  test("throws if dimensions mismatch", () => {
    expect(() => cosineSimilarity([1, 2], [1, 2, 3])).toThrow();
  });

  test("throws if dimension is 0", () => {
    expect(() => cosineSimilarity([], [])).toThrow();
  });

  test("typed arrays can be used (ArrayLike)", () => {
    const a = new Float32Array([1, 2, 3]);
    const b = new Float32Array([1, 2, 3]);
    expect(cosineSimilarity(a, b)).toBeCloseTo(1, 12);
  });
});
