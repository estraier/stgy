import { applyStfSigmoidGateInPlace } from "./stf-additional-blur";
import { STF_INTERPOLATED_AREA_PER_MP, areaCloseGrayscaleInPlace, interpolateStfLogRatioInPlace } from "./stf-area-closing";

function makeRing(): Float32Array {
  const map = new Float32Array(9 * 9);
  for (let y = 1; y < 8; y++) {
    for (let x = 1; x < 8; x++) map[y * 9 + x] = 8;
  }
  for (let y = 3; y <= 5; y++) {
    for (let x = 3; x <= 5; x++) map[y * 9 + x] = 0;
  }
  return map;
}

describe("STF grayscale Area Closing", () => {
  test("uses area 512 per MP by default, eight times the original threshold", () => {
    expect(STF_INTERPOLATED_AREA_PER_MP).toBe(512);
    const map = new Float32Array(100 * 100).fill(3);
    const info = interpolateStfLogRatioInPlace(map, 100, 100);
    expect(info.areaThreshold).toBe(5); // round(512 * 0.01MP)
  });

  test("sigmoid threshold is fitted from the filled map, not the pre-closing distribution", () => {
    const width = 20;
    const height = 20;
    const raw = new Float32Array(width * height).fill(-4);
    for (let y = 3; y < 17; y++) {
      for (let x = 3; x < 17; x++) raw[y * width + x] = 2;
    }
    // Isolated low-valued pixels inside a sharp subject: each hole has area 1.
    for (let y = 4; y < 17; y += 2) {
      for (let x = 4; x < 17; x += 2) raw[y * width + x] = -4;
    }
    const original = raw.slice();
    const before = applyStfSigmoidGateInPlace(original, width, height, 0.6);
    expect(before.thresholdLog).toBe(-4);
    const info = interpolateStfLogRatioInPlace(raw, width, height, width * height, 10_000);
    expect(info.areaThreshold).toBe(4);
    expect(raw[4 * width + 4]).toBe(2);
    const after = applyStfSigmoidGateInPlace(raw, width, height, 0.6);
    expect(after.thresholdLog).toBe(2);
    expect(after.thresholdPercentile).toBe(0.6);
  });

  test("fills a dark hole smaller than the area threshold without erasing an open background", () => {
    const map = makeRing();
    areaCloseGrayscaleInPlace(map, 9, 9, 10);
    expect(map[4 * 9 + 4]).toBe(8);
    expect(map[0]).toBe(0);
    expect(map[2 * 9 + 2]).toBe(8);
  });

  test("preserves holes that meet the area threshold", () => {
    const map = makeRing();
    areaCloseGrayscaleInPlace(map, 9, 9, 9);
    expect(map[4 * 9 + 4]).toBe(0);
  });

  test("does not fill a dark region connected to the outside", () => {
    const map = makeRing();
    for (let y = 0; y <= 3; y++) map[y * 9 + 4] = 0;
    areaCloseGrayscaleInPlace(map, 9, 9, 10);
    expect(map[4 * 9 + 4]).toBe(0);
  });

  test("raises minima to the surrounding lower contour level rather than the brightest peak", () => {
    const map = new Float32Array(11 * 11);
    for (let y = 1; y <= 9; y++) {
      for (let x = 1; x <= 9; x++) map[y * 11 + x] = 10;
    }
    for (let y = 3; y <= 7; y++) {
      for (let x = 3; x <= 7; x++) map[y * 11 + x] = 5;
    }
    map[5 * 11 + 5] = 0;
    areaCloseGrayscaleInPlace(map, 11, 11, 3);
    expect(map[5 * 11 + 5]).toBe(5);
    expect(map[4 * 11 + 4]).toBe(5);
  });

  test("full-resolution interpolation never lowers existing log ratios", () => {
    const width = 100;
    const height = 100;
    const map = new Float32Array(width * height);
    for (let y = 10; y < 90; y++) {
      for (let x = 10; x < 90; x++) map[y * width + x] = 4;
    }
    for (let y = 46; y < 54; y++) {
      for (let x = 46; x < 54; x++) map[y * width + x] = -3;
    }
    const before = map.slice();
    const info = interpolateStfLogRatioInPlace(map, width, height, 10_000, 100); // area=1, so unchanged
    expect(info.areaThreshold).toBe(1);
    expect(map).toEqual(before);
    const filledInfo = interpolateStfLogRatioInPlace(map, width, height, 10_000, 10_000); // area=100
    expect(filledInfo.areaThreshold).toBe(100);
    expect(map[50 * width + 50]).toBe(4);
    for (let i = 0; i < map.length; i++) expect(map[i]).toBeGreaterThanOrEqual(before[i]);
  });


  test("downsampling alone does not change a map whose dark regions are all large", () => {
    const width = 80;
    const height = 80;
    const map = new Float32Array(width * height);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) map[y * width + x] = x < 40 ? 2 : 6;
    }
    const before = map.slice();
    interpolateStfLogRatioInPlace(map, width, height, 1_600, 25_000);
    expect(map).toEqual(before);
  });

  test("a NaN inside an otherwise uniform high region is filled", () => {
    const map = new Float32Array(100 * 100).fill(10);
    map[50 * 100 + 50] = Number.NaN;
    interpolateStfLogRatioInPlace(map, 100, 100, 10_000, 10_000);
    expect(map[50 * 100 + 50]).toBe(10);
  });

  test("resampled mode stays finite where original data is finite", () => {
    const width = 80;
    const height = 80;
    const map = new Float32Array(width * height);
    for (let y = 10; y < 70; y++) {
      for (let x = 10; x < 70; x++) map[y * width + x] = 6;
    }
    for (let y = 34; y < 46; y++) {
      for (let x = 34; x < 46; x++) map[y * width + x] = -2;
    }
    const info = interpolateStfLogRatioInPlace(map, width, height, 1_600, 25_000);
    expect(info.workingWidth).toBe(40);
    expect(info.workingHeight).toBe(40);
    expect(info.areaThreshold).toBe(40);
    expect(map[40 * width + 40]).toBeGreaterThan(-2);
    for (let i = 0; i < map.length; i++) expect(Number.isFinite(map[i])).toBe(true);
  });
});
