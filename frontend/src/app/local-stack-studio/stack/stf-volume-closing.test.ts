import { volumeCloseGrayscaleInPlace, interpolateStfVolumeUnitRatioInPlace } from "./stf-volume-closing";

describe("Volume Closing 2 directly on once-normalized confidence", () => {
  test("a small central valley is raised without lowering unchanged background", () => {
    const w = 11, h = 11;
    const original = Float32Array.from({ length: w * h }, () => 0.9);
    original[5 * w + 5] = 0.1;
    const values = original.slice();
    volumeCloseGrayscaleInPlace(values, w, h, 256);
    expect(values[5 * w + 5]).toBeGreaterThan(0.1);
    for (let i = 0; i < values.length; i++) {
      expect(values[i]).toBeGreaterThanOrEqual(original[i] - 1e-7);
      expect(values[i]).toBeLessThanOrEqual(1);
    }
  });
  test("resampling propagates only positive increments and never reapplies P3/P97", () => {
    const w = 50, h = 50;
    const original = Float32Array.from({ length: w * h }, (_, i) => ((i * 11) % 97) / 96);
    const values = original.slice();
    const info = interpolateStfVolumeUnitRatioInPlace(values, w, h, 100, 256);
    expect(info.workingWidth * info.workingHeight).toBeLessThanOrEqual(100);
    for (let i = 0; i < values.length; i++) {
      expect(values[i]).toBeGreaterThanOrEqual(original[i] - 1e-7);
      expect(values[i]).toBeLessThanOrEqual(1);
    }
  });
  test("rejects out-of-range input rather than hiding invalid data", () => {
    expect(() => interpolateStfVolumeUnitRatioInPlace(Float32Array.from([0.2, 2]), 2, 1)).toThrow();
  });
});
