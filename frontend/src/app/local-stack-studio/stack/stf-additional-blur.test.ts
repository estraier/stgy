import {
  applyGuardedGaussianBlurRegion,
  applyStfGateExpansion,
  buildStfLogRatioFromDerived,
  buildStfSharpnessMapAtScaleInto,
  createStfSharpnessScratch,
  buildStfSigmoidPlan,
  buildStfRelativeSharpnessMapAtScaleInto,
  STF_RELATIVE_CHANNEL_BRIGHTNESS_FLOOR,
  STF_RELATIVE2_CHANNEL_BRIGHTNESS_FLOOR,
  buildStfPersistentCoarseSharpnessStripe,
  buildStfPersistentFineSharpnessStripe,
  normalizeStfSharpnessForPreview,
  normalizeStfLogRatioForPreview,
  deriveStfDynamicSharpnessC,
  deriveStfMedianSharpnessC,
  deriveStfRelativeChannelFloorsFromSamples,
  validateStfRelativeChannelFloors,
  deriveStfRatioEpsilon,
  resolveStfAdditionalBlurRadius,
} from "./stf-additional-blur";

describe("STF Additional blur", () => {
  test("weights independently detected RGB edges in a 3:4:3 ratio", () => {
    const width = 9;
    const height = 9;
    const strengths = [0, 1, 2].map((channel) => {
      const linear = new Float32Array(width * height * 3);
      for (let y = 0; y < height; y += 1) {
        for (let x = 0; x < width; x += 1) {
          linear[(y * width + x) * 3 + channel] = x / (width - 1);
        }
      }
      const output = new Float32Array(width * height);
      buildStfSharpnessMapAtScaleInto(linear, width, height, 1, output, createStfSharpnessScratch(width * height));
      return output[4 * width + 4];
    });
    expect(strengths[0]).toBeGreaterThan(0);
    expect(strengths[2]).toBeCloseTo(strengths[0], 6);
    expect(strengths[1] / strengths[0]).toBeCloseTo(4 / 3, 6);
  });

  test("derives c from a clear two-component log-sharpness distribution", () => {
    const samples: number[] = [];
    for (let i = -100; i <= 100; i += 1) {
      samples.push(Math.exp(-7 + i * 0.002));
      samples.push(Math.exp(-3 + i * 0.002));
    }
    const plan = deriveStfDynamicSharpnessC(samples);
    expect(plan.method).toBe("gmm-intersection");
    expect(Math.log(plan.c)).toBeCloseTo(-5, 1);
  });

  test("falls back to the geometric median for a single-valued distribution", () => {
    const plan = deriveStfDynamicSharpnessC(new Float32Array(1024).fill(0.002));
    expect(plan.method).toBe("median-fallback");
    expect(plan.c).toBeCloseTo(0.002, 6);
  });

  test("uses the raw 0.5MP sharpness P50 for the alternative ratio mode", () => {
    // Deliberately unlike the geometric median; the raw P50 is (2 + 8)/2.
    const samples = Float32Array.from([0, 1, 2, 8, 32, Number.NaN]);
    const c = deriveStfMedianSharpnessC(samples);
    expect(c).toBe(5);
    expect(deriveStfRatioEpsilon(c)).toBe(1.25);
    expect(deriveStfMedianSharpnessC([0, 0, Number.NaN])).toBe(1e-12);
  });

  test("P50/4 uses the unchanged geometric-mean raw ratio calculation", () => {
    const c = deriveStfMedianSharpnessC([1, 2, 8, 32]);
    const epsilon = deriveStfRatioEpsilon(c);
    const fineLogSum = new Float32Array([Math.log(4) + Math.log(8)]);
    const coarseGroups = new Float32Array([1, 3]);
    const ratio = buildStfLogRatioFromDerived(fineLogSum, new Uint8Array([0]), coarseGroups, 2, epsilon);
    expect(ratio[0]).toBeCloseTo((Math.log(4 / (1 + epsilon)) + Math.log(8 / (3 + epsilon))) / 2, 6);
    expect(normalizeStfLogRatioForPreview(ratio[0])).toBeCloseTo(Math.exp(ratio[0]) / (1 + Math.exp(ratio[0])), 6);
  });

  test("uses one quarter of c as the ratio epsilon", () => {
    expect(deriveStfRatioEpsilon(0.004)).toBeCloseTo(0.001, 12);
  });

  test("P50/8 uses the same raw median but half the P50/4 denominator epsilon", () => {
    const c = deriveStfMedianSharpnessC([1, 2, 8, 32]);
    const epsilon4 = deriveStfRatioEpsilon(c);
    const epsilon8 = deriveStfRatioEpsilon(c, 8);
    expect(epsilon8).toBeCloseTo(epsilon4 / 2, 12);
    const fineLogSum = new Float32Array([Math.log(4) + Math.log(8)]);
    const fineZero = new Uint8Array([0]);
    const coarseGroups = new Float32Array([1, 3]);
    const ratio = buildStfLogRatioFromDerived(fineLogSum, fineZero, coarseGroups, 2, epsilon8);
    expect(ratio[0]).toBeCloseTo((Math.log(4 / (1 + epsilon8)) + Math.log(8 / (3 + epsilon8))) / 2, 6);
    expect(ratio[0]).toBeGreaterThan(buildStfLogRatioFromDerived(fineLogSum, fineZero, coarseGroups, 2, epsilon4)[0]);
    expect(deriveStfRatioEpsilon(1e-12, 8)).toBe(1e-12);
  });


  test("builds the geometric-mean log ratio with epsilon=c/4 semantics", () => {
    const fineLogSum = new Float32Array([Math.log(4) + Math.log(8)]);
    const fineZero = new Uint8Array([0]);
    const coarseGroups = new Float32Array([1, 3]);
    const epsilon = 0.25;
    const result = buildStfLogRatioFromDerived(fineLogSum, fineZero, coarseGroups, 2, epsilon);
    const expected = 0.5 * (Math.log(4 / 1.25) + Math.log(8 / 3.25));
    expect(result[0]).toBeCloseTo(expected, 6);
  });

  test("visualizes geometric-mean coarse sharpness using the same c as epsilon", () => {
    const groups = new Float32Array([1, 4, 0, 9, 16, 2]);
    const coarse = buildStfPersistentCoarseSharpnessStripe(groups, 2);
    expect(Array.from(coarse)).toEqual([3, 8, 0]);
    expect(normalizeStfSharpnessForPreview(0.005, 0.005)).toBeCloseTo(0.5, 10);
    expect(normalizeStfSharpnessForPreview(0, 0.005)).toBe(0);
  });

  test("visualizes 16MP sharpness using geometric mean across F-number groups and its own c", () => {
    const fineLogSum = new Float32Array([Math.log(2) + Math.log(8), Math.log(4) + Math.log(9), 0]);
    const fineZero = new Uint8Array([0, 0, 1]);
    const fine = buildStfPersistentFineSharpnessStripe(fineLogSum, fineZero, 2);
    expect(fine[0]).toBeCloseTo(4, 6);
    expect(fine[1]).toBeCloseTo(6, 6);
    expect(fine[2]).toBe(0);
    const c = deriveStfDynamicSharpnessC(fine).c;
    expect(normalizeStfSharpnessForPreview(c, c)).toBeCloseTo(0.5, 12);
    expect(normalizeStfSharpnessForPreview(0, c)).toBe(0);
  });

  test("rejects inconsistent 16MP sharpness buffers", () => {
    expect(() => buildStfPersistentFineSharpnessStripe(
      new Float32Array([1, 2]), new Uint8Array([0]), 2,
    )).toThrow("invalid aperture-group data");
  });

  test("relative sharpness normalizes each RGB channel before 3:4:3 mixing", () => {
    const width = 11;
    const height = 11;
    const atCenter = 5 * width + 5;
    const sharpnesses = [0, 1, 2].map((channel) => {
      const linear = new Float32Array(width * height * 3);
      for (let y = 0; y < height; y += 1) {
        for (let x = 0; x < width; x += 1) {
          linear[(y * width + x) * 3 + channel] = (1 + x / 10) * 0.04;
        }
      }
      const output = new Float32Array(width * height);
      buildStfRelativeSharpnessMapAtScaleInto(linear, width, height, 1, output, createStfSharpnessScratch(width * height));
      return output[atCenter];
    });
    expect(sharpnesses[0]).toBeGreaterThan(0);
    expect(sharpnesses[2]).toBeCloseTo(sharpnesses[0], 6);
    expect(sharpnesses[1] / sharpnesses[0]).toBeCloseTo(4 / 3, 6);
  });

  test("relative sharpness is invariant to uniform brightness scaling above the floor", () => {
    const width = 11;
    const height = 11;
    const makeImage = (brightness: number) => {
      const linear = new Float32Array(width * height * 3);
      for (let y = 0; y < height; y += 1) {
        for (let x = 0; x < width; x += 1) {
          const pixel = (y * width + x) * 3;
          const structure = 1 + x / 10;
          linear[pixel] = brightness * structure;
          linear[pixel + 1] = brightness * structure * 0.5;
          linear[pixel + 2] = brightness * structure * 0.2;
        }
      }
      return linear;
    };
    const measure = (brightness: number, scale: number) => {
      const output = new Float32Array(width * height);
      buildStfRelativeSharpnessMapAtScaleInto(
        makeImage(brightness), width, height, scale, output, createStfSharpnessScratch(width * height),
      );
      return output[5 * width + 5];
    };
    expect(measure(0.5, 1)).toBeCloseTo(measure(0.05, 1), 5);
    expect(measure(0.5, 3)).toBeCloseTo(measure(0.05, 3), 5);
  });

  test("relative2 only lowers the RGB channel brightness floor from 1e-4 to 1e-5", () => {
    expect(STF_RELATIVE_CHANNEL_BRIGHTNESS_FLOOR).toBe(1e-4);
    expect(STF_RELATIVE2_CHANNEL_BRIGHTNESS_FLOOR).toBe(1e-5);
    const width = 11;
    const height = 11;
    const linear = new Float32Array(width * height * 3);
    for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) {
      const value = 2e-5 * (1 + x / 10);
      const index = (y * width + x) * 3;
      linear[index] = value;
      linear[index + 1] = value * 0.5;
      linear[index + 2] = value * 0.2;
    }
    const compute = (floor?: number, scale = 1) => {
      const output = new Float32Array(width * height);
      if (floor === undefined) {
        buildStfRelativeSharpnessMapAtScaleInto(
          linear, width, height, scale, output, createStfSharpnessScratch(width * height),
        );
      } else {
        buildStfRelativeSharpnessMapAtScaleInto(
          linear, width, height, scale, output, createStfSharpnessScratch(width * height), floor,
        );
      }
      return output[5 * width + 5];
    };
    expect(compute()).toBeCloseTo(compute(STF_RELATIVE_CHANNEL_BRIGHTNESS_FLOOR), 7);
    expect(compute(STF_RELATIVE2_CHANNEL_BRIGHTNESS_FLOOR)).toBeGreaterThan(compute());
    expect(compute(STF_RELATIVE2_CHANNEL_BRIGHTNESS_FLOOR, 3)).toBeGreaterThan(compute(undefined, 3));
    expect(() => compute(0)).toThrow("brightness floor");
  });

  test("relative3 uses P50/4 of each channel's brightness, including black samples", () => {
    const floors = deriveStfRelativeChannelFloorsFromSamples([
      [0, 2, 4, 6],
      [1, 3, 7, 11],
      [0, 0, 0, 0],
    ]);
    expect(floors[0]).toBeCloseTo(0.75, 9);
    expect(floors[1]).toBeCloseTo(1.25, 9);
    expect(floors[2]).toBe(1e-12);
    expect(validateStfRelativeChannelFloors(floors)).toEqual(floors);
    expect(() => validateStfRelativeChannelFloors([0, 1, 2])).toThrow("brightness floors are invalid");
  });

  test("relative4 uses the same per-channel brightness samples but P50/8 instead of P50/4", () => {
    const samples: [number[], number[], number[]] = [
      [0, 2, 4, 6], [1, 3, 7, 11], [0, 0, 0, 0],
    ];
    const relative3 = deriveStfRelativeChannelFloorsFromSamples(samples);
    const relative4 = deriveStfRelativeChannelFloorsFromSamples(samples, 8);
    expect(relative4[0]).toBeCloseTo(relative3[0] / 2, 12);
    expect(relative4[1]).toBeCloseTo(relative3[1] / 2, 12);
    expect(relative4[2]).toBe(1e-12); // Respect the existing absolute safety floor.
    expect(deriveStfRatioEpsilon(0.5)).toBeCloseTo(0.125, 12); // Ratio epsilon remains P50/4.
  });

  test("relative5 uses P50/16 RGB brightness floors without changing the ratio epsilon", () => {
    const samples: [number[], number[], number[]] = [
      [0, 2, 4, 6], [1, 3, 7, 11], [0, 0, 0, 0],
    ];
    const relative4 = deriveStfRelativeChannelFloorsFromSamples(samples, 8);
    const relative5 = deriveStfRelativeChannelFloorsFromSamples(samples, 16);
    expect(relative5[0]).toBeCloseTo(relative4[0] / 2, 12);
    expect(relative5[1]).toBeCloseTo(relative4[1] / 2, 12);
    expect(relative5[2]).toBe(1e-12); // The existing absolute safety floor remains in force.
    expect(deriveStfRatioEpsilon(0.5)).toBeCloseTo(0.125, 12);
  });

  test("relative3 channel-specific floors change the contribution of each RGB channel", () => {
    const width = 9, height = 9;
    const linear = new Float32Array(width * height * 3);
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const p = (y * width + x) * 3;
        linear[p] = (x + 1) / 10;
        linear[p + 1] = (x + 1) / 100;
        linear[p + 2] = (x + 1) / 1000;
      }
    }
    const a = new Float32Array(width * height);
    const b = new Float32Array(width * height);
    buildStfRelativeSharpnessMapAtScaleInto(linear, width, height, 1, a, createStfSharpnessScratch(width * height), 0.1);
    buildStfRelativeSharpnessMapAtScaleInto(linear, width, height, 1, b, createStfSharpnessScratch(width * height), [0.1, 0.01, 0.001]);
    expect(b[4 * width + 4]).toBeGreaterThan(a[4 * width + 4]);
  });

  test("relative5 weighted RMS preserves a single-channel edge more strongly than the weighted mean", () => {
    const width = 9, height = 9;
    const linear = new Float32Array(width * height * 3);
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const p = (y * width + x) * 3;
        linear[p] = x < width / 2 ? 0.1 : 0.9;
        linear[p + 1] = 0.5;
        linear[p + 2] = 0.5;
      }
    }
    const mean = new Float32Array(width * height);
    const rms = new Float32Array(width * height);
    const floors = [0.1, 0.1, 0.1] as const;
    buildStfRelativeSharpnessMapAtScaleInto(linear, width, height, 1, mean, createStfSharpnessScratch(width * height), floors);
    buildStfRelativeSharpnessMapAtScaleInto(linear, width, height, 1, rms, createStfSharpnessScratch(width * height), floors, "rms");
    expect(rms[4 * width + 4]).toBeGreaterThan(mean[4 * width + 4]);
  });

  test("relative3 P50 floors follow exposure changes instead of a fixed brightness threshold", () => {
    const width = 9, height = 9;
    const make = (factor: number) => {
      const linear = new Float32Array(width * height * 3);
      const samples: [number[], number[], number[]] = [[], [], []];
      for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) {
        const p = (y * width + x) * 3;
        for (let channel = 0; channel < 3; channel += 1) {
          const value = factor * (x + 1) * [0.01, 0.005, 0.002][channel];
          linear[p + channel] = value;
          samples[channel].push(value);
        }
      }
      const floors = deriveStfRelativeChannelFloorsFromSamples(samples);
      const output = new Float32Array(width * height);
      buildStfRelativeSharpnessMapAtScaleInto(
        linear, width, height, 1, output, createStfSharpnessScratch(width * height), floors,
      );
      return { floors, center: output[4 * width + 4] };
    };
    const normal = make(1);
    const dim = make(0.1);
    for (let channel = 0; channel < 3; channel += 1) {
      expect(dim.floors[channel]).toBeCloseTo(normal.floors[channel] / 10, 8);
    }
    expect(dim.center).toBeCloseTo(normal.center, 5);
  });

  test("relative sharpness stays finite in nearly black channels", () => {
    const width = 9;
    const height = 9;
    const linear = new Float32Array(width * height * 3);
    for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) {
      linear[(y * width + x) * 3] = (x % 2) * 1e-7;
    }
    const output = new Float32Array(width * height);
    buildStfRelativeSharpnessMapAtScaleInto(linear, width, height, 1, output, createStfSharpnessScratch(width * height));
    expect(output.every(Number.isFinite)).toBe(true);
    expect(output.every((value) => value >= 0)).toBe(true);
    expect(STF_RELATIVE_CHANNEL_BRIGHTNESS_FLOOR).toBeGreaterThan(0);
  });

  test("visualizes raw 16MP/0.5MP ratio without modifying the sigmoid gate", () => {
    expect(normalizeStfLogRatioForPreview(0)).toBeCloseTo(0.5, 12);
    expect(normalizeStfLogRatioForPreview(Math.log(3))).toBeCloseTo(0.75, 12);
    expect(normalizeStfLogRatioForPreview(Number.NaN)).toBe(0);
    expect(normalizeStfLogRatioForPreview(1000)).toBe(1);
  });

  test("maps Blur ratio to the bokeh-side sigmoid percentile", () => {
    const samples = Float32Array.from({ length: 101 }, (_, index) => index / 100);
    const plan = buildStfSigmoidPlan(samples, 0.7);
    expect(plan.sharpFraction).toBeCloseTo(0.3, 12);
    expect(plan.thresholdPercentile).toBeCloseTo(0.7, 12);
    expect(plan.thresholdLog).toBeCloseTo(0.7, 2);
  });

  test("maps Blur strength to 1x/2x/3x sqrt(MP) radius with a 15px cap", () => {
    expect(resolveStfAdditionalBlurRadius(1000, 1000, 1)).toBe(2);
    expect(resolveStfAdditionalBlurRadius(1000, 1000, 2)).toBe(2);
    expect(resolveStfAdditionalBlurRadius(1000, 1000, 3)).toBe(3);
    expect(resolveStfAdditionalBlurRadius(6000, 4000, 1)).toBe(5);
    expect(resolveStfAdditionalBlurRadius(6000, 4000, 2)).toBe(10);
    expect(resolveStfAdditionalBlurRadius(6000, 4000, 3)).toBe(15);
    expect(resolveStfAdditionalBlurRadius(12000, 8000, 3)).toBe(15);
  });

  test("soft dilation never weakens the original gate", () => {
    const gate = new Float32Array([0, 0.2, 0.8, 1, 0.3, 0]);
    const expanded = applyStfGateExpansion(gate, 3, 2, 6);
    for (let i = 0; i < gate.length; i += 1) expect(expanded[i]).toBeGreaterThanOrEqual(gate[i]);
  });

  test("fully protected pixels survive guarded Gaussian blur unchanged", () => {
    const source = new Float32Array([
      0.1, 0.2, 0.3,
      0.8, 0.7, 0.6,
      0.4, 0.5, 0.6,
      0.9, 0.1, 0.2,
    ]);
    const gate = new Float32Array([1, 1, 1, 1]);
    const output = applyGuardedGaussianBlurRegion(source, 2, 2, gate, 2, 0, 2);
    expect(Array.from(output)).toEqual(Array.from(source));
  });
});
