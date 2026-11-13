import {
  STF_SOURCE_CACHE_MAX_BYTES,
  StfSourceCache,
  buildStfSourceCacheKey,
  stfSourceForFinalization,
} from "./stf-source-cache";
import { addWeightedLinearToAccumulator } from "./linear-merge";

const baseInputs = () => ({
  sessionId: "canonical-session-1",
  width: 3,
  height: 2,
  alignmentPlan: { normalizationMode: "pad", targetWidth: 3, targetHeight: 2 },
  matrices: [null, new Float64Array([1, 0, 0, 1, 0.5, -0.5])],
  gains: new Float32Array([1, 1.25]),
  scaledLogs: new Float32Array([0, 2]),
  weights: new Float32Array([0.4, 0.6]),
});

describe("STF Phase 1 independent source reuse", () => {
  test("blur options are absent from the key; source inputs are present", () => {
    const base = baseInputs();
    const key = buildStfSourceCacheKey(base);
    // The same raw source is used for blur=none/medium/strong/gate.
    expect(buildStfSourceCacheKey({ ...base })).toBe(key);
    expect(buildStfSourceCacheKey({ ...base, weights: new Float32Array([0.3, 0.7]) })).not.toBe(key);
    expect(buildStfSourceCacheKey({ ...base, gains: new Float32Array([1, 1.35]) })).not.toBe(key);
    expect(buildStfSourceCacheKey({ ...base, scaledLogs: new Float32Array([0, 3]) })).not.toBe(key);
    expect(buildStfSourceCacheKey({ ...base, sessionId: "canonical-session-2" })).not.toBe(key);
    expect(buildStfSourceCacheKey({ ...base, width: 4 })).not.toBe(key);
    expect(buildStfSourceCacheKey({ ...base, matrices: [null, new Float64Array([1, 0, 0, 1, 2, -0.5])] })).not.toBe(key);
  });

  test("retains the same buffer without copying, releases it on key change or input reset", () => {
    const cache = new StfSourceCache();
    const pixels = new Float32Array([0.25, 1.5, 3, 0.5, 0.6, 2]);
    expect(cache.lookup("W4", pixels.length)).toBeNull();
    expect(cache.retain("W4", pixels, 8).retained).toBe(true);
    expect(cache.lookup("W4", pixels.length)).toBe(pixels);
    expect(cache.byteLength).toBe(pixels.byteLength);
    expect(cache.holds(pixels)).toBe(true);
    expect(cache.lookup("W4", pixels.length + 1)).toBeNull();
    expect(cache.byteLength).toBe(0);
    cache.retain("W4", pixels);
    expect(cache.lookup("W8", pixels.length)).toBeNull();
    cache.retain("W8", pixels);
    cache.clear();
    expect(cache.lookup("W8", pixels.length)).toBeNull();
  });

  test("final output can be rolled off in place without corrupting cached raw source", () => {
    const cache = new StfSourceCache();
    const raw = new Float32Array([0.7, 1.2, 2.5, 3.75, 0.01, 0.2]);
    cache.retain("key", raw, 8);
    const finalized = stfSourceForFinalization(raw, cache.holds(raw));
    expect(finalized).not.toBe(raw);
    finalized[0] = 0.1;
    finalized[1] = 0.3;
    finalized[2] = 0.9;
    expect(cache.lookup("key", raw.length)).toBe(raw);
    expect(raw[0]).toBeCloseTo(0.7);
    expect(raw[1]).toBeCloseTo(1.2);
    expect(raw[2]).toBe(2.5);
    expect(stfSourceForFinalization(raw, false)).toBe(raw);
  });

  test("fused Sobel-source and standalone linear merge use identical Float32 accumulation order", () => {
    const linearImages = [
      new Float32Array([0.25, 0.5, 1.2, 2.7, 0.01, 0.42]),
      new Float32Array([0.8, 0.02, 0.13, 0.56, 3.1, 0.19]),
      new Float32Array([0.07, 0.6, 0.15, 1.25, 0.29, 2.8]),
    ];
    const weights = new Float32Array([0.21, 0.34, 0.45]);
    const workerAccumulator = new Float32Array(6);
    const fusedAccumulator = new Float32Array(6);
    for (let i = 0; i < linearImages.length; i += 1) {
      addWeightedLinearToAccumulator(workerAccumulator, linearImages[i], weights[i]);
      // The merged source in stf-additional-blur.worker.ts accumulates in this
      // image-index order, independently of Sobel's sharpness calculations.
      for (let offset = 0; offset < 6; offset += 1) {
        fusedAccumulator[offset] += linearImages[i][offset] * weights[i];
      }
    }
    expect(fusedAccumulator).toEqual(workerAccumulator);
  });

  test("RAM admission is bounded and low-memory machines may skip caching", () => {
    const cache = new StfSourceCache(16);
    expect(cache.retain("oversized", new Float32Array(5), 8)).toEqual({
      retained: false, reason: "Image exceeds the one-slot RAM source budget",
    });
    expect(cache.retain("low-memory", new Float32Array(3), 2).retained).toBe(false);
    expect(cache.lookup("low-memory", 3)).toBeNull();
    expect(cache.retain("normal", new Float32Array(3), 8).retained).toBe(true);
    expect(STF_SOURCE_CACHE_MAX_BYTES).toBe(256 * 1024 * 1024);
  });
});
