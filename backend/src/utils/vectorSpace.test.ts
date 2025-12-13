import { encodeFeatures, decodeFeatures, cosineSimilarity } from "./vectorSpace";

describe("encodeFeatures / decodeFeatures", () => {
  test("encodeFeatures: basic quantization (gamma=1, dim=3)", () => {
    const enc = encodeFeatures([1, 0, -1], 3, 0.95, 1);
    expect(Array.from(enc)).toEqual([127, 0, -127]);
  });

  test("encodeFeatures: non-finite inputs are treated as 0", () => {
    const enc = encodeFeatures([Number.NaN, Number.POSITIVE_INFINITY, -2], 3, 1, 1);
    // [-2] is the only finite value; with percentile=1, scale becomes 2
    // => [0,0,-127]
    expect(Array.from(enc)).toEqual([0, 0, -127]);
  });

  test("decodeFeatures: round-trip is stable for the basic case (gamma=1)", () => {
    const enc = encodeFeatures([1, 0, -1], 3, 0.95, 1);
    const dec = decodeFeatures(enc, 1);
    expect(dec.length).toBe(3);
    expect(dec[0]).toBeCloseTo(1, 12);
    expect(dec[1]).toBeCloseTo(0, 12);
    expect(dec[2]).toBeCloseTo(-1, 12);
  });

  test("decodeFeatures: accepts 0..255 style bytes (e.g. Uint8Array) by mapping >127 to negative", () => {
    const enc = encodeFeatures([1, 0, -1], 3, 0.95, 1); // Int8Array: [127,0,-127]
    const u8 = new Uint8Array(enc.buffer); // bytes: [127,0,129]
    const dec = decodeFeatures(u8, 1);
    expect(dec[0]).toBeCloseTo(1, 12);
    expect(dec[1]).toBeCloseTo(0, 12);
    expect(dec[2]).toBeCloseTo(-1, 12);
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

  test("typed arrays can be used via Array.from (caller-side)", () => {
    const a = Array.from(new Float32Array([1, 2, 3]));
    const b = Array.from(new Float32Array([1, 2, 3]));
    expect(cosineSimilarity(a, b)).toBeCloseTo(1, 12);
  });
});
