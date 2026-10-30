import {
  STF_VOLUME_INTERPOLATED_COST_PER_MP,
  volumeCloseGrayscaleInPlace,
  interpolateStfVolumeLogRatioInPlace,
} from "./stf-volume-closing";
import { normalizeStfLogRatioForPreview } from "./stf-additional-blur";

function surroundedPit(pitValue: number): Float32Array {
  const size = 9;
  const values = new Float32Array(size * size).fill(0.1);
  for (let y = 1; y <= 7; y++) {
    for (let x = 1; x <= 7; x++) values[y * size + x] = 0.8;
  }
  for (let y = 3; y <= 5; y++) {
    for (let x = 3; x <= 5; x++) values[y * size + x] = pitValue;
  }
  return values;
}

describe("STF rim-mean Volume Closing", () => {
  test("compares volume, not just area: shallow pit fills but deep pit is retained", () => {
    const shallow = surroundedPit(0.65);
    const deep = surroundedPit(0.1);
    volumeCloseGrayscaleInPlace(shallow, 9, 9, 3);
    volumeCloseGrayscaleInPlace(deep, 9, 9, 3);
    expect(shallow[4 * 9 + 4]).toBeCloseTo(0.8, 6);
    expect(deep[4 * 9 + 4]).toBeCloseTo(0.1, 6);
    expect(shallow[0]).toBeCloseTo(0.1, 6);
  });

  test("a low notch on the rim does not dominate its arithmetic mean", () => {
    const clean = surroundedPit(0.65);
    const notched = surroundedPit(0.65);
    // This value is still above the pit, so connectivity is unchanged.
    notched[2 * 9 + 4] = 0.67;
    volumeCloseGrayscaleInPlace(clean, 9, 9, 2);
    volumeCloseGrayscaleInPlace(notched, 9, 9, 2);
    expect(clean[4 * 9 + 4]).toBeCloseTo(0.8, 6);
    expect(notched[4 * 9 + 4]).toBeGreaterThan(0.65);
  });

  test("full-range map and low contrast basins do not introduce NaNs or decreases", () => {
    const map = surroundedPit(0.65);
    const before = map.slice();
    volumeCloseGrayscaleInPlace(map, 9, 9, 3);
    for (let i = 0; i < map.length; i++) {
      expect(Number.isFinite(map[i])).toBe(true);
      expect(map[i]).toBeGreaterThanOrEqual(before[i]);
      expect(map[i]).toBeLessThanOrEqual(1);
    }
    expect(() => volumeCloseGrayscaleInPlace(new Float32Array([0, 1.01]), 2, 1, 1)).toThrow();
  });

  test("does not fill an open background connected to the image boundary", () => {
    const map = surroundedPit(0.65);
    for (let y = 0; y <= 3; y++) map[y * 9 + 4] = 0.65;
    volumeCloseGrayscaleInPlace(map, 9, 9, 3);
    expect(map[4 * 9 + 4]).toBeCloseTo(0.65, 6);
  });


  test("volume2 uses the arithmetic rim mean when a shallow basin drains through a narrow low saddle", () => {
    const width = 11, height = 11;
    const original = new Float32Array(width * height).fill(0.9);
    // A narrow 0.61 opening touches the border, while most of the basin rim
    // is 0.9. The basin floor is 0.6. A parent-height fill only reaches 0.61.
    for (let y = 0; y <= 4; y++) original[y * width + 5] = 0.61;
    for (let y = 5; y <= 7; y++) {
      for (let x = 4; x <= 6; x++) original[y * width + x] = 0.6;
    }
    const parentHeight = original.slice();
    const meanHeight = original.slice();
    volumeCloseGrayscaleInPlace(parentHeight, width, height, 3);
    volumeCloseGrayscaleInPlace(meanHeight, width, height, 3, "rim-mean");
    expect(parentHeight[6 * width + 5]).toBeCloseTo(0.61, 5);
    expect(meanHeight[6 * width + 5]).toBeCloseTo(0.8758333, 5);
    expect(meanHeight[4 * width + 5]).toBeCloseTo(0.61, 6); // border-connected opening untouched
    for (let i = 0; i < original.length; i++) {
      expect(meanHeight[i]).toBeGreaterThanOrEqual(original[i]);
      expect(meanHeight[i]).toBeLessThanOrEqual(1);
    }
  });

  test("volume2 retains the same volume cost, original floor and background exclusion", () => {
    const deep = surroundedPit(0.1);
    volumeCloseGrayscaleInPlace(deep, 9, 9, 3, "rim-mean");
    expect(deep[4 * 9 + 4]).toBeCloseTo(0.1, 6);
    const background = surroundedPit(0.65);
    for (let y = 0; y <= 3; y++) background[y * 9 + 4] = 0.65;
    volumeCloseGrayscaleInPlace(background, 9, 9, 3, "rim-mean");
    expect(background[4 * 9 + 4]).toBeCloseTo(0.65, 6);
  });

  test("volume2 uses the same downscale path and changes only reconstruction height", () => {
    const width = 11, height = 11;
    const input = new Float32Array(width * height).fill(0.9);
    for (let y = 0; y <= 4; y++) input[y * width + 5] = 0.61;
    for (let y = 5; y <= 7; y++) {
      for (let x = 4; x <= 6; x++) input[y * width + x] = 0.6;
    }
    const oldMap = Float32Array.from(input, (v) => Math.log(v / (1 - v)));
    const newMap = oldMap.slice();
    const original = oldMap.slice();
    const oldInfo = interpolateStfVolumeLogRatioInPlace(oldMap, width, height, width * height, 30_000);
    const newInfo = interpolateStfVolumeLogRatioInPlace(newMap, width, height, width * height, 30_000, "rim-mean");
    expect(newInfo).toEqual(oldInfo);
    expect(newMap[6 * width + 5]).toBeGreaterThan(oldMap[6 * width + 5]);
    for (let i = 0; i < newMap.length; i++) {
      expect(newMap[i]).toBeGreaterThanOrEqual(original[i] - 1e-6);
    }
  });

  test("rejects an unknown fill mode instead of silently applying the original version", () => {
    expect(() => volumeCloseGrayscaleInPlace(new Float32Array([0.5, 0.5]), 2, 1, 1, "unexpected" as never)).toThrow();
  });

  test("uses the normalized [0,1] values, with a volume threshold scaled by megapixels", () => {
    expect(STF_VOLUME_INTERPOLATED_COST_PER_MP).toBe(256);
    const size = 9;
    const map = surroundedPit(0.65);
    const logMap = new Float32Array(map.length);
    for (let i = 0; i < map.length; i++) logMap[i] = Math.log(map[i] / (1 - map[i]));
    const info = interpolateStfVolumeLogRatioInPlace(logMap, size, size, size * size, 30_000);
    expect(info.volumeThreshold).toBeCloseTo(2.43, 6);
    expect(normalizeStfLogRatioForPreview(logMap[4 * size + 4])).toBeCloseTo(0.8, 5);
    expect(normalizeStfLogRatioForPreview(logMap[0])).toBeCloseTo(0.1, 5);
  });

  test("default volume threshold scales 256 per MP without changing explicit overrides", () => {
    const size = 9;
    const sample = new Float32Array(size * size).fill(0);
    const info = interpolateStfVolumeLogRatioInPlace(sample, size, size, size * size);
    expect(info.volumeThreshold).toBeCloseTo(256 * size * size / 1_000_000, 10);
    const overridden = interpolateStfVolumeLogRatioInPlace(sample, size, size, size * size, 128);
    expect(overridden.volumeThreshold).toBeCloseTo(128 * size * size / 1_000_000, 10);
  });

  test("downsample/upsample alone never changes a wide two-tone map", () => {
    const width = 80, height = 80;
    const map = new Float32Array(width * height);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) map[y * width + x] = x < 40 ? -2 : 2;
    }
    const before = map.slice();
    const info = interpolateStfVolumeLogRatioInPlace(map, width, height, 1600, 128);
    expect(info.workingWidth).toBe(40);
    expect(info.workingHeight).toBe(40);
    expect(map).toEqual(before);
  });

  test("deep missing evidence stays nonfinite unless enclosed and filled", () => {
    const size = 20;
    const map = new Float32Array(size * size).fill(2);
    for (let i = 0; i < size; i++) {
      map[i] = -4;
      map[(size - 1) * size + i] = -4;
      map[i * size] = -4;
      map[i * size + size - 1] = -4;
    }
    map[10 * size + 10] = Number.NaN;
    const info = interpolateStfVolumeLogRatioInPlace(map, size, size, 400, 3000);
    expect(info.volumeThreshold).toBeCloseTo(1.2, 6);
    expect(Number.isFinite(map[10 * size + 10])).toBe(true);
    expect(normalizeStfLogRatioForPreview(map[10 * size + 10])).toBeCloseTo(normalizeStfLogRatioForPreview(2), 5);
  });
});
