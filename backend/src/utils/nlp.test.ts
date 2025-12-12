import { encodeFeatures, decodeFeatures, countPseudoTokens, sliceByPseudoTokens } from "./nlp";

function cosineSimilarity(a: number[], b: number[]): number {
  const len = Math.min(a.length, b.length);
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < len; i++) {
    const va = a[i];
    const vb = b[i];
    dot += va * vb;
    na += va * va;
    nb += vb * vb;
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

describe("encodeFeatures", () => {
  test("pads with zeros when input is shorter than dim", () => {
    const input = [0.1, -0.2, 0.3];
    const dim = 8;
    const encoded = encodeFeatures(input, dim, 1.0, 1.0);
    expect(encoded.length).toBe(dim);

    const decoded = decodeFeatures(encoded, 1.0);
    expect(decoded.length).toBe(dim);

    for (let i = 0; i < input.length; i++) {
      expect(Math.abs(decoded[i])).toBeGreaterThan(0);
    }
    for (let i = input.length; i < dim; i++) {
      expect(Math.abs(decoded[i])).toBeLessThan(1e-3);
    }
  });

  test("truncates when input is longer than dim and keeps direction", () => {
    const full = Array.from({ length: 10 }, (_, i) => (i - 5) / 5);
    const dim = 4;
    const encoded = encodeFeatures(full, dim, 1.0, 0.5);
    expect(encoded.length).toBe(dim);

    const decoded = decodeFeatures(encoded, 0.5);
    const originalHead = full.slice(0, dim);
    const sim = cosineSimilarity(originalHead, decoded);
    expect(sim).toBeGreaterThan(0.95);
  });

  test("applies percentile-based clipping for large outliers", () => {
    const input = [0, 1, 10, 100, 1000];
    const dim = input.length;
    const encoded = encodeFeatures(input, dim, 0.5, 1.0);
    const abs = Array.from(encoded, (v) => Math.abs(v));

    expect(abs[2]).toBeGreaterThan(abs[1]);
    expect(abs[2]).toBe(abs[3]);
    expect(abs[3]).toBe(abs[4]);
  });
});

describe("decodeFeatures", () => {
  test("preserves sign information", () => {
    const input = [-1, -0.5, 0, 0.5, 1];
    const encoded = encodeFeatures(input, input.length, 1.0, 1.0);
    const decoded = decodeFeatures(encoded, 1.0);

    for (let i = 0; i < input.length; i++) {
      const orig = input[i];
      const rec = decoded[i];
      if (orig === 0) {
        expect(Math.abs(rec)).toBeLessThan(1e-3);
      } else {
        expect(Math.sign(rec)).toBe(Math.sign(orig));
      }
    }
  });

  test("round-trips direction reasonably well for typical vectors", () => {
    const dim = 32;
    const input: number[] = [];
    for (let i = 0; i < dim; i++) {
      const v = Math.sin(i / 3) * 0.8;
      input.push(v);
    }

    const encoded = encodeFeatures(input, dim, 1.0, 0.5);
    const decoded = decodeFeatures(encoded, 0.5);

    const sim = cosineSimilarity(input, decoded);
    expect(sim).toBeGreaterThan(0.97);
  });

  test("works with default parameters of encodeFeatures", () => {
    const input: number[] = [];
    for (let i = 0; i < 300; i++) {
      input.push(Math.sin(i / 7) * 0.5);
    }
    const encoded = encodeFeatures(input);
    expect(encoded.length).toBe(512);

    const decoded = decodeFeatures(encoded);
    expect(decoded.length).toBe(512);
    for (let i = 0; i < input.length; i++) {
      expect(Number.isFinite(decoded[i])).toBe(true);
    }
  });
});

describe("countPseudoTokens", () => {
  test("returns 0 for empty string", () => {
    expect(countPseudoTokens("")).toBe(0);
  });

  test("counts ASCII characters as 1 each", () => {
    expect(countPseudoTokens("a")).toBe(1);
    expect(countPseudoTokens("abc")).toBe(3);
    expect(countPseudoTokens("hello world")).toBe(11);
  });

  test("counts mixed ASCII and CJK with different weights", () => {
    const text = "abcあい";
    expect(countPseudoTokens(text)).toBe(7);
  });

  test("handles surrogate pair emoji as one character with weight 2", () => {
    const text = "A😊B";
    expect(countPseudoTokens(text)).toBe(4);
  });
});

describe("sliceByPseudoTokens", () => {
  test("slices ASCII text by pseudo token range like substring", () => {
    const text = "ABCDE";
    expect(sliceByPseudoTokens(text, 0, 3)).toBe("ABC");
    expect(sliceByPseudoTokens(text, 2, 5)).toBe("CDE");
    expect(sliceByPseudoTokens(text, 3, 100)).toBe("DE");
  });

  test("clamps negative start and end to 0", () => {
    const text = "ABCDE";
    expect(sliceByPseudoTokens(text, -10, 2)).toBe("AB");
    expect(sliceByPseudoTokens(text, -10, -1)).toBe("");
  });

  test("returns empty string when end <= start", () => {
    const text = "ABCDE";
    expect(sliceByPseudoTokens(text, 3, 3)).toBe("");
    expect(sliceByPseudoTokens(text, 5, 3)).toBe("");
  });

  test("returns empty string when start is beyond total pseudo tokens", () => {
    const text = "ABCDE";
    expect(sliceByPseudoTokens(text, 10, 20)).toBe("");
  });

  test("slices mixed ASCII and CJK respecting pseudo token weights", () => {
    const text = "abあいc";
    expect(sliceByPseudoTokens(text, 0, 3)).toBe("abあ");
    expect(sliceByPseudoTokens(text, 2, 4)).toBe("あ");
    expect(sliceByPseudoTokens(text, 3, 7)).toBe("あいc");
  });

  test("slices text with emoji (surrogate pair) correctly", () => {
    const text = "A😊B";
    expect(sliceByPseudoTokens(text, 0, 2)).toBe("A😊");
    expect(sliceByPseudoTokens(text, 1, 3)).toBe("😊");
    expect(sliceByPseudoTokens(text, 2, 4)).toBe("😊B");
  });
});
