import {
  alignmentFrameCacheBytes,
  alignmentFrameCacheKey,
  getCachedAlignmentFrame,
  putCachedAlignmentFrame,
} from "./alignment-frame-cache";

describe("alignment frame cache", () => {
  it("shares the 1MP key across algorithms and separates its 8MP refinement", () => {
    const base = alignmentFrameCacheKey("feature-match", 5000, 4000, 2);
    expect(base).toBe("feature-match:5000x4000:2");
    expect(alignmentFrameCacheKey("feature-match", 5000, 4000, 2, true))
      .toBe(`${base}:refinement-8mp`);
  });

  it("retains two resolutions for the same image without copying the bytes", () => {
    const cache = new Map<string, { grayBytes: Uint8Array }>();
    const base = { grayBytes: new Uint8Array(10) };
    const fine = { grayBytes: new Uint8Array(80) };
    putCachedAlignmentFrame(cache, "base", base, 100);
    putCachedAlignmentFrame(cache, "fine", fine, 100);
    expect(getCachedAlignmentFrame(cache, "base")).toBe(base);
    expect(getCachedAlignmentFrame(cache, "fine")).toBe(fine);
    expect(alignmentFrameCacheBytes(cache)).toBe(90);
  });

  it("evicts least-recently-used entries but keeps a recently reused base", () => {
    const cache = new Map<string, { grayBytes: Uint8Array }>();
    putCachedAlignmentFrame(cache, "base", { grayBytes: new Uint8Array(10) }, 30);
    putCachedAlignmentFrame(cache, "fine-0", { grayBytes: new Uint8Array(10) }, 30);
    expect(getCachedAlignmentFrame(cache, "base")).toBeDefined();
    putCachedAlignmentFrame(cache, "fine-1", { grayBytes: new Uint8Array(15) }, 30);
    expect(cache.has("fine-0")).toBe(false);
    expect(cache.has("base")).toBe(true);
    expect(cache.has("fine-1")).toBe(true);
    expect(alignmentFrameCacheBytes(cache)).toBe(25);
  });

  it("keeps a single frame even if it exceeds the budget", () => {
    const cache = new Map<string, { grayBytes: Uint8Array }>();
    putCachedAlignmentFrame(cache, "huge", { grayBytes: new Uint8Array(40) }, 30);
    expect(cache.size).toBe(1);
    expect(alignmentFrameCacheBytes(cache)).toBe(40);
    expect(putCachedAlignmentFrame(cache, "small", { grayBytes: new Uint8Array(10) }, 30)).toBe(1);
    expect(cache.has("small")).toBe(true);
  });
});
