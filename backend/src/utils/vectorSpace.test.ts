import {
  encodeFeatures,
  decodeFeatures,
  cosineSimilarity,
  normalizeL2,
  naiveSigmoid,
  sigmoidalContrast,
} from "./vectorSpace";

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

describe("normalizeL2", () => {
  test("normalizes a simple vector", () => {
    const out = normalizeL2([3, 4]);
    expect(out.length).toBe(2);
    expect(out[0]).toBeCloseTo(0.6, 10);
    expect(out[1]).toBeCloseTo(0.8, 10);
  });

  test("normalizes a typed array input", () => {
    const v = new Float32Array([1, 2, 2]);
    const out = normalizeL2(v);
    const norm = Math.sqrt(out.reduce((s, x) => s + x * x, 0));
    expect(norm).toBeCloseTo(1, 12);
  });

  test("zero vector returns zeros", () => {
    const out = normalizeL2([0, 0, 0]);
    expect(out).toEqual([0, 0, 0]);
  });
});

describe("naiveSigmoid", () => {
  test("x == mid returns 0.5", () => {
    expect(naiveSigmoid(0.5, 10, 0.5)).toBeCloseTo(0.5, 12);
  });

  test("matches known values (gain=10, mid=0.5)", () => {
    expect(naiveSigmoid(0, 10, 0.5)).toBeCloseTo(0.0066928509242848554, 12);
    expect(naiveSigmoid(1, 10, 0.5)).toBeCloseTo(0.9933071490757153, 12);
  });

  test("stays in (0,1) and is numerically stable for large |t|", () => {
    const y0 = naiveSigmoid(0, 1000, 1);
    const y1 = naiveSigmoid(1, 1000, 0);
    expect(Number.isFinite(y0)).toBe(true);
    expect(Number.isFinite(y1)).toBe(true);
    expect(y0).toBeGreaterThanOrEqual(0);
    expect(y0).toBeLessThanOrEqual(1);
    expect(y1).toBeGreaterThanOrEqual(0);
    expect(y1).toBeLessThanOrEqual(1);
    expect(y0).toBeCloseTo(0, 12);
    expect(y1).toBeCloseTo(1, 12);
  });
});

describe("sigmoidalContrast", () => {
  test("maps endpoints exactly: 0 -> 0, 1 -> 1", () => {
    expect(sigmoidalContrast(0, 10, 0.5)).toBe(0);
    expect(sigmoidalContrast(1, 10, 0.5)).toBe(1);
  });

  test("with mid=0.5 maps mid to 0.5", () => {
    expect(sigmoidalContrast(0.5, 10, 0.5)).toBeCloseTo(0.5, 12);
  });

  test("is monotonic increasing on [0,1] for gain>0", () => {
    const gain = 12;
    const mid = 0.4;
    const xs = [0, 0.1, 0.25, 0.4, 0.6, 0.9, 1];
    const ys = xs.map((x) => sigmoidalContrast(x, gain, mid));

    for (let i = 1; i < ys.length; i++) {
      expect(ys[i]).toBeGreaterThanOrEqual(ys[i - 1]);
    }
  });

  test("stays within [0,1] for representative inputs", () => {
    const gain = 8;
    const mid = 0.3;
    const xs = [0, 0.05, 0.2, 0.3, 0.55, 0.8, 1];
    for (const x of xs) {
      const y = sigmoidalContrast(x, gain, mid);
      expect(Number.isFinite(y)).toBe(true);
      expect(y).toBeGreaterThanOrEqual(0);
      expect(y).toBeLessThanOrEqual(1);
    }
  });
});
