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
  test("linearly tapers basin uplift between half and the existing volume threshold", () => {
    // A single enclosed valley has volume 1 * (1 - 0.25) = 0.75.
    const w = 3, h = 3;
    const original = Float32Array.from({ length: w * h }, (_, i) => i === 4 ? 0.25 : 1);
    const run = (threshold: number): number => {
      const values = original.slice();
      volumeCloseGrayscaleInPlace(values, w, h, threshold);
      for (let i = 0; i < values.length; i++) {
        if (i !== 4) expect(values[i]).toBe(1);
      }
      return values[4];
    };
    expect(run(0.75)).toBeCloseTo(0.25, 6); // At threshold: no closing.
    expect(run(1)).toBeCloseTo(0.625, 6); // Cost 0.75: 50% of full uplift.
    expect(run(1.5)).toBeCloseTo(1, 6); // At half-threshold: full closing.
    expect(run(2)).toBeCloseTo(1, 6); // Below half-threshold: still full.
  });
  test("applies one partial uplift to a flat multi-pixel basin without damping through equal-level unions", () => {
    // 16x16 valley with rim=1 and inside=0.25: volume = 256 * 0.75 = 192.
    const w = 40, h = 40;
    const original = Float32Array.from({ length: w * h }, (_, i) => {
      const x = i % w, y = Math.floor(i / w);
      return x >= 12 && x < 28 && y >= 12 && y < 28 ? 0.25 : 1;
    });
    const run = (threshold: number): Float32Array => {
      const values = original.slice();
      volumeCloseGrayscaleInPlace(values, w, h, threshold);
      return values;
    };
    const absent = run(192);
    const partial = run(256);
    const full = run(384);
    for (let i = 0; i < original.length; i++) {
      if (original[i] === 1) {
        expect(partial[i]).toBe(1);
      } else {
        expect(absent[i]).toBeCloseTo(0.25, 6);
        expect(partial[i]).toBeCloseTo(0.625, 6); // 50% of 0.75 uplift.
        expect(full[i]).toBeCloseTo(1, 6);
      }
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
