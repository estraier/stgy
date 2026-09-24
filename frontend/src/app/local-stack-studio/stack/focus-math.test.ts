import {
  emptyFocusRunningStats,
  focusRunningStatsFromValues,
  focusGridDimensions,
  computeFocusTileScores,
  computeFocusFinalMaps,
  focusRunningStatsStd,
  focusSharpnessWorkingDimensions,
  isUsableFocusStd,
  mergeFocusRunningStats,
  sampleFocusGridBilinear,
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


describe("Focus tile support", () => {
  test("grid targets about 80 cells while keeping cells near square", () => {
    expect(focusGridDimensions(4000, 3000)).toEqual({ cols: 10, rows: 8 });
    expect(focusGridDimensions(6000, 4000)).toEqual({ cols: 11, rows: 7 });
    expect(focusGridDimensions(3000, 3000)).toEqual({ cols: 9, rows: 9 });
    expect(focusGridDimensions(4000, 6000)).toEqual({ cols: 7, rows: 11 });
    expect(focusGridDimensions(2, 2)).toEqual({ cols: 2, rows: 2 });
  });

  test("tile scores are simple means of the existing map scores", () => {
    const first = new Float32Array([
      1, 3, 10, 14,
      5, 7, 18, 22,
      2, 4, 20, 24,
      6, 8, 28, 32,
    ]);
    const second = new Float32Array(first.length).fill(-2);
    const scores = computeFocusTileScores([first, second], 4, 4, { cols: 2, rows: 2 });
    expect(Array.from(scores[0])).toEqual([4, 16, 5, 26]);
    expect(Array.from(scores[1])).toEqual([-2, -2, -2, -2]);
  });

  test("tile interpolation is continuous and clamps at the image edge", () => {
    const values = new Float32Array([0, 10, 20, 30]);
    expect(sampleFocusGridBilinear(values, 2, 2, 0.5, 0.5)).toBeCloseTo(15, 12);
    expect(sampleFocusGridBilinear(values, 2, 2, 0, 0)).toBeCloseTo(0, 12);
    expect(sampleFocusGridBilinear(values, 2, 2, 1, 1)).toBeCloseTo(30, 12);
    const left = sampleFocusGridBilinear(values, 2, 2, 0.5 - 1e-6, 0.25);
    const right = sampleFocusGridBilinear(values, 2, 2, 0.5 + 1e-6, 0.25);
    expect(Math.abs(left - right)).toBeLessThan(1e-3);
  });



  test("final maps are composed on the working-resolution map using 2*mapScore + tileScore", () => {
    const first = new Float32Array([
      5, 0,
      0, 0,
    ]);
    const second = new Float32Array([
      0, 0,
      0, 0,
    ]);
    const tileScores = computeFocusTileScores([first, second], 2, 2, { cols: 1, rows: 1 });
    const result = computeFocusFinalMaps([first, second], 2, 2, tileScores, { cols: 1, rows: 1 });
    const finals = result.finalMaps;
    expect(Array.from(tileScores[0])).toEqual([1.25]);
    expect(Array.from(tileScores[1])).toEqual([0]);
    expect(finals[0][0]).toBeCloseTo(11.25, 6);
    expect(finals[1][0]).toBeCloseTo(0, 12);
    expect(finals[0][1]).toBeCloseTo(1.25, 6);
    expect(finals[0][2]).toBeCloseTo(1.25, 6);
    expect(finals[0][3]).toBeCloseTo(1.25, 6);
    let expectedSum = 0;
    let expectedSumSq = 0;
    let expectedCount = 0;
    for (let pixel = 0; pixel < first.length; pixel += 1) {
      const maxFinal = Math.max(finals[0][pixel], finals[1][pixel]);
      for (let imageIndex = 0; imageIndex < finals.length; imageIndex += 1) {
        const adjusted = finals[imageIndex][pixel] - maxFinal;
        expectedSum += adjusted;
        expectedSumSq += adjusted * adjusted;
        expectedCount += 1;
      }
    }
    expect(result.stats.count).toBe(expectedCount);
    expect(result.stats.sum).toBeCloseTo(expectedSum, 12);
    expect(result.stats.sumSq).toBeCloseTo(expectedSumSq, 12);
  });
});
