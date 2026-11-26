import {
  buildStfSourceCacheKey,
  prepareStfSourceForFinalRolloff, StfSourceCache,
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
    // A different Canonical layout in the same file-selection session also
    // invalidates pixel-dependent caches without changing the session ID.
    expect(buildStfSourceCacheKey({ ...baseInputs, dataRevision: 1 })).not.toBe(key);
    expect(buildStfSourceCacheKey({ ...baseInputs, gains: [2, 1, 1] })).not.toBe(key);
    expect(buildStfSourceCacheKey({ ...baseInputs, weights: [0.1, 0.4, 0.5] })).not.toBe(key);
    expect(buildStfSourceCacheKey({ ...baseInputs, toneReferenceIndex: 1 })).not.toBe(key);
    expect(buildStfSourceCacheKey({ ...baseInputs, matrices: [[1, 0, 2, 0, 1, 0]] })).not.toBe(key);
  });

  test("fixed F-dependent window has no per-run tuning in the Source cache key", () => {
    const baseInputs = { ...aligned(), gains: [1, 1, 1], scaledLogs: [0, 0, 0],
      weights: [0.2, 0.3, 0.5], toneReferenceIndex: 0 };
    const off = buildStfFrameSet([2, 2.5, 4], 1, "off");
    const interpolation = buildStfFrameSet([2, 2.5, 4], 1, "interpolation");
    const extrapolation = buildStfFrameSet([2, 2.5, 4], 1, "extrapolation-2");
    const key = buildStfSourceCacheKey({ ...baseInputs, frameSet: interpolation });
    expect(buildStfSourceCacheKey({ ...baseInputs, frameSet: interpolation })).toBe(key);
    expect(buildStfSourceCacheKey({ ...baseInputs, frameSet: extrapolation })).not.toBe(key);
    expect(buildStfSourceCacheKey({ ...baseInputs, frameSet: off })).not.toBe(key);
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


test("opening Extrapolation always uses production Compression 2 Source cache identity", () => {
  const frameSet = buildStfFrameSet([2, 2.5, 4], 1, "extrapolation-2");
  const inputs = { ...aligned(), gains: [1, 1, 1], scaledLogs: [0, 0, 0],
    weights: frameSet.realWeights, frameSet, toneReferenceIndex: 0 };
  const key = buildStfSourceCacheKey(inputs);
  expect(key).toContain("extrapolation-2:compression-2:one-pass-v1");
  const interpolation = buildStfFrameSet([2, 2.5, 4], 1, "interpolation");
  const other = buildStfSourceCacheKey({ ...inputs, frameSet: interpolation });
  expect(other).not.toContain("compression-2:one-pass-v1");
  expect(other).not.toBe(key);
});
