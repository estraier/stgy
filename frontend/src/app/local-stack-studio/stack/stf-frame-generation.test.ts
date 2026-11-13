import { buildStfFrameSet, stfMiddleFrameCacheKey, stfOuterFrameCacheKey } from "./stf-frame-generation";
import { buildStfApertureWeights } from "./stf-weights";

const real = [2.8, 4, 3.5, 3.2, 2.5, 2.2, 2];

describe("STF Frame generation Phase 2", () => {
  test("off retains the seven input weights in their original order", () => {
    const frameSet = buildStfFrameSet(real, 4, "off");
    expect(frameSet.middleFrames).toHaveLength(0);
    expect(Array.from(frameSet.realWeights)).toEqual(Array.from(Float32Array.from(buildStfApertureWeights(real, 4)!)));
  });

  test("seven real frames produce exactly six logarithmic aperture midpoints", () => {
    const frameSet = buildStfFrameSet(real, 4, "interpolation");
    expect(frameSet.middleFrames).toHaveLength(6);
    expect(frameSet.allFNumbers).toHaveLength(13);
    expect(frameSet.allWeights).toHaveLength(13);
    expect(frameSet.middleFrames.map((frame) => [frame.previousIndex, frame.nextIndex]))
      .toEqual([[6, 5], [5, 4], [4, 0], [0, 3], [3, 2], [2, 1]]);
    expect(frameSet.middleFrames[0].fNumber).toBeCloseTo(Math.sqrt(2 * 2.2), 12);
    expect(frameSet.middleFrames[5].fNumber).toBeCloseTo(Math.sqrt(3.5 * 4), 12);
    expect(Array.from(frameSet.allWeights).reduce((sum, weight) => sum + weight, 0)).toBeCloseTo(1, 6);
    frameSet.middleFrames.forEach((frame, i) => expect(frame.weight).toBe(frameSet.allWeights[7 + i]));
  });

  test("duplicate or missing F-numbers fail only when generation is enabled", () => {
    expect(() => buildStfFrameSet([2, 2.8, 2.8], 4, "interpolation")).toThrow("distinct");
    expect(() => buildStfFrameSet([2, null], 4, "interpolation")).toThrow("valid EXIF");
    expect(buildStfFrameSet([2, null], 4, "off").middleFrames).toEqual([]);
  });

  test("generated frame keys do not include W, Blur, or gate parameters", () => {
    const mid4 = buildStfFrameSet(real, 4, "interpolation").middleFrames[0];
    const mid8 = buildStfFrameSet(real, 8, "interpolation").middleFrames[0];
    const matrices = [new Float64Array([1,0,0,0,1,0,0,0,1])];
    expect(stfMiddleFrameCacheKey("session", "feature-match", matrices, mid4, 10, 10))
      .toBe(stfMiddleFrameCacheKey("session", "feature-match", matrices, mid8, 10, 10));
    expect(stfMiddleFrameCacheKey("another", "feature-match", matrices, mid4, 10, 10))
      .not.toBe(stfMiddleFrameCacheKey("session", "feature-match", matrices, mid4, 10, 10));
  });
});

describe("STF Frame generation Phase 3", () => {
  test("15-frame set extends each endpoint by one real-frame log-F interval", () => {
    const frameSet = buildStfFrameSet(real, 4, "interpolation-extrapolation");
    expect(frameSet.mode).toBe("interpolation-extrapolation");
    expect(frameSet.middleFrames).toHaveLength(6);
    expect(frameSet.outerFrames).toHaveLength(2);
    expect(frameSet.allFNumbers).toHaveLength(15);
    expect(frameSet.allWeights).toHaveLength(15);
    expect(frameSet.outerFrames.map((frame) => [frame.variant, frame.previousIndex, frame.nextIndex]))
      .toEqual([["ext1", 6, 5], ["ext2", 2, 1]]);
    expect(frameSet.outerFrames[0].fNumber).toBeCloseTo(2 * 2 / 2.2, 12);
    expect(frameSet.outerFrames[1].fNumber).toBeCloseTo(4 * 4 / 3.5, 12);
    expect(frameSet.outerFrames[0].fNumber).toBeLessThan(2);
    expect(frameSet.outerFrames[1].fNumber).toBeGreaterThan(4);
    expect(Array.from(frameSet.allWeights).reduce((sum, weight) => sum + weight, 0)).toBeCloseTo(1, 6);
    expect(frameSet.outerFrames.map((frame) => frame.weight)).toEqual(Array.from(frameSet.allWeights.slice(13)));
  });

  test("Phase 2 midpoint IDs and cache keys survive interpolation -> extrapolation", () => {
    const frame13 = buildStfFrameSet(real, 4, "interpolation");
    const frame15 = buildStfFrameSet(real, 8, "interpolation-extrapolation");
    const matrices = [new Float64Array([1,0,0,0,1,0,0,0,1])];
    expect(frame15.middleFrames.map((mid) => [mid.previousIndex, mid.nextIndex, mid.fNumber]))
      .toEqual(frame13.middleFrames.map((mid) => [mid.previousIndex, mid.nextIndex, mid.fNumber]));
    for (let i = 0; i < frame13.middleFrames.length; i++) {
      expect(stfMiddleFrameCacheKey("session", "orb", matrices, frame13.middleFrames[i], 23, 17))
        .toBe(stfMiddleFrameCacheKey("session", "orb", matrices, frame15.middleFrames[i], 23, 17));
    }
  });

  test("outer cache keys are separate from mid, W and Blur, but distinguish ext1/ext2", () => {
    const outer4 = buildStfFrameSet(real, 4, "interpolation-extrapolation").outerFrames;
    const outer8 = buildStfFrameSet(real, 8, "interpolation-extrapolation").outerFrames;
    const matrices = [new Float64Array([1,0,0,0,1,0,0,0,1])];
    const key = stfOuterFrameCacheKey("session", "orb", matrices, outer4[0], 23, 17);
    expect(key).toBe(stfOuterFrameCacheKey("session", "orb", matrices, outer8[0], 23, 17));
    expect(key).not.toBe(stfMiddleFrameCacheKey("session", "orb", matrices, outer4[0], 23, 17));
    expect(key).not.toBe(stfOuterFrameCacheKey("session", "orb", matrices, outer4[1], 23, 17));
  });

  test("both outer variants share the single pair when only two real inputs exist", () => {
    const frameSet = buildStfFrameSet([2, 2.8], 4, "interpolation-extrapolation");
    expect(frameSet.middleFrames).toHaveLength(1);
    expect(frameSet.outerFrames).toHaveLength(2);
    expect(frameSet.allFNumbers).toHaveLength(5);
    expect(frameSet.outerFrames.map((frame) => frame.variant)).toEqual(["ext1", "ext2"]);
    expect(frameSet.outerFrames.every((frame) => frame.previousIndex === 0 && frame.nextIndex === 1)).toBe(true);
  });

  test("invalid or duplicated F-numbers also fail in extrapolation mode", () => {
    expect(() => buildStfFrameSet([2, 2], 4, "interpolation-extrapolation")).toThrow("distinct");
    expect(() => buildStfFrameSet([null, 2], 4, "interpolation-extrapolation")).toThrow("valid EXIF");
    expect(() => buildStfFrameSet([1e-220, 2], 4, "interpolation-extrapolation")).toThrow("invalid extended");
  });
});
