import {
  emptyFocusRunningStats,
  focusRunningStatsFromValues,
  focusRunningStatsStd,
  focusSharpnessWorkingDimensions,
  isUsableFocusStd,
  mergeFocusRunningStats,
} from "./focus-math";

describe("Focus stack-global sharpness statistics", () => {
  test("merging per-image statistics matches statistics over the full stack", () => {
    const first = new Float32Array([0, 1, 2, 8, 9]);
    const second = new Float32Array([3, 4, 5, 6, 7, 10, 11]);
    const merged = mergeFocusRunningStats(
      focusRunningStatsFromValues(first),
      focusRunningStatsFromValues(second),
    );
    const direct = focusRunningStatsFromValues(new Float32Array([...first, ...second]));

    expect(merged.count).toBe(direct.count);
    expect(merged.mean).toBeCloseTo(direct.mean, 12);
    expect(merged.m2).toBeCloseTo(direct.m2, 10);
    expect(focusRunningStatsStd(merged)).toBeCloseTo(focusRunningStatsStd(direct), 12);
  });

  test("stack-global z-score preserves ordering that per-image z-score can reverse", () => {
    const wideSharpImage = new Float32Array([8, 9, 10, 11, 12, 10, 11, 9]);
    const mostlySoftImage = new Float32Array([0, 0, 0, 0, 0, 0, 3, 0]);
    const wideStats = focusRunningStatsFromValues(wideSharpImage);
    const softStats = focusRunningStatsFromValues(mostlySoftImage);
    const wideStd = focusRunningStatsStd(wideStats);
    const softStd = focusRunningStatsStd(softStats);

    const sharpResponse = 10;
    const softResponse = 3;
    const oldSharpZ = (sharpResponse - wideStats.mean) / wideStd;
    const oldSoftZ = (softResponse - softStats.mean) / softStd;
    expect(oldSharpZ).toBeLessThan(oldSoftZ);

    const global = mergeFocusRunningStats(wideStats, softStats);
    const globalStd = focusRunningStatsStd(global);
    expect(isUsableFocusStd(globalStd)).toBe(true);
    const sharpZ = (sharpResponse - global.mean) / globalStd;
    const softZ = (softResponse - global.mean) / globalStd;
    expect(sharpZ).toBeGreaterThan(softZ);
  });

  test("flat statistics are treated as unusable instead of producing unstable z-scores", () => {
    const flat = focusRunningStatsFromValues(new Float32Array([2, 2, 2, 2]));
    expect(focusRunningStatsStd(flat)).toBe(0);
    expect(isUsableFocusStd(focusRunningStatsStd(flat))).toBe(false);
    expect(focusRunningStatsStd(emptyFocusRunningStats())).toBe(0);
  });

  test("working dimensions preserve the existing one-megapixel analysis target", () => {
    expect(focusSharpnessWorkingDimensions(1000, 1000)).toEqual({
      width: 1000,
      height: 1000,
      isScaled: false,
    });
    expect(focusSharpnessWorkingDimensions(4000, 3000)).toEqual({
      width: 1155,
      height: 867,
      isScaled: true,
    });
  });
});
