import {
  buildStfSourceCacheKey, buildStfVirtualFrameKey, buildStfVirtualFrameContextKey,
  prepareStfSourceForFinalRolloff, StfSourceCache, StfVirtualFrameCache,
} from "./stf-process-cache";
import { buildStfFrameSet } from "./stf-frame-generation";

const aligned = () => ({
  sessionId: "session-A", width: 4, height: 3,
  alignmentPlan: { normalizationMode: "center-crop", targetWidth: 4, targetHeight: 3 },
  matrices: [Float64Array.from([1, 0, 0, 0, 1, 0])],
});

const source = (radialAttenuation = 1, mode: "interpolation" | "extrapolation-2" = "interpolation") => {
  const frameSet = buildStfFrameSet([2, 2.5, 4], radialAttenuation, mode);
  return buildStfSourceCacheKey({ ...aligned(),
    gains: [1, 1, 1], scaledLogs: [0, 0, 0],
    weights: frameSet.realWeights, frameSet, toneReferenceIndex: 0,
  });
};

describe("STF Source cache isolation", () => {
  test("changing only Blur options preserves the complete Source", () => {
    const cache = new StfSourceCache(1024);
    const key = source();
    const original = Float32Array.from([0.1, 0.25, 2, 3]);
    expect(cache.put(key, original)).toBe(true);
    expect(cache.get(source(), 4)).toBe(original);
    // Source must remain pre-rolloff even when a caller creates its own copy.
    const output = prepareStfSourceForFinalRolloff(original, cache.get(key, 4));
    expect(output).not.toBe(original);
    output[2] = 1;
    expect(cache.get(key, 4)?.[2]).toBe(2);
    const unretained = Float32Array.from([0, 1]);
    expect(prepareStfSourceForFinalRolloff(unretained, null)).toBe(unretained);
    expect(cache.get(key, 5)).toBeNull();
  });

  test("q, Frame generation, alignment, tone, weights, session invalidate Source", () => {
    const base = source();
    expect(source(0)).not.toBe(base);
    expect(source(1, "extrapolation-2")).not.toBe(base);
    const baseInputs = { ...aligned(), gains: [1, 1, 1], scaledLogs: [0, 0, 0],
      weights: [0.2, 0.3, 0.5], toneReferenceIndex: 0 };
    const key = buildStfSourceCacheKey(baseInputs);
    expect(buildStfSourceCacheKey({ ...baseInputs, sessionId: "session-B" })).not.toBe(key);
    expect(buildStfSourceCacheKey({ ...baseInputs, gains: [2, 1, 1] })).not.toBe(key);
    expect(buildStfSourceCacheKey({ ...baseInputs, weights: [0.1, 0.4, 0.5] })).not.toBe(key);
    expect(buildStfSourceCacheKey({ ...baseInputs, toneReferenceIndex: 1 })).not.toBe(key);
    expect(buildStfSourceCacheKey({ ...baseInputs, matrices: [[1, 0, 2, 0, 1, 0]] })).not.toBe(key);
  });

  test("oversized Source is not cached, old Source can be cleared", () => {
    const cache = new StfSourceCache(32);
    const key = source();
    expect(cache.put(key, new Float32Array(4))).toBe(true);
    expect(cache.put(source(0), new Float32Array(100))).toBe(false);
    expect(cache.get(key, 4)).toBeNull();
    cache.clear();
    expect(cache.get(key, 4)).toBeNull();
  });
});

describe("STF generated-frame cache isolation and budget", () => {
  test("q/tone do not change raw virtual pixels but alignment or warp scale does", () => {
    const key = buildStfVirtualFrameContextKey(aligned());
    const pixels = buildStfVirtualFrameKey(key, 0, 1, "mid");
    expect(buildStfVirtualFrameKey(key, 0, 1, "mid")).toBe(pixels);
    expect(buildStfVirtualFrameKey(key, 0, 1, "ext1", 0.5)).not.toBe(pixels);
    expect(buildStfVirtualFrameKey(key, 0, 1, "ext1", 0.7)).not.toBe(
      buildStfVirtualFrameKey(key, 0, 1, "ext1", 0.5));
    expect(buildStfVirtualFrameContextKey({ ...aligned(), sessionId: "new-session" })).not.toBe(key);
    expect(buildStfVirtualFrameContextKey({ ...aligned(), matrices: [[1, 0, 1, 0, 1, 0]] })).not.toBe(key);
  });

  test("LRU capacity evicts old images and never retains oversized images", () => {
    const cache = new StfVirtualFrameCache(24);
    const a = new Uint16Array(6);
    const b = new Uint16Array(6);
    const c = new Uint16Array(6);
    expect(cache.put("a", a)).toBe(true);
    expect(cache.put("b", b)).toBe(true);
    expect(cache.get("a", 6)).toBe(a);
    expect(cache.put("c", c)).toBe(true);
    expect(cache.get("b", 6)).toBeNull();
    expect(cache.get("a", 6)).toBe(a);
    expect(cache.get("c", 6)).toBe(c);
    expect(cache.sizeBytes).toBe(24);
    expect(cache.put("oversize", new Uint16Array(30))).toBe(false);
    expect(cache.sizeBytes).toBe(24);
    cache.clear();
    expect(cache.sizeBytes).toBe(0);
  });
});
