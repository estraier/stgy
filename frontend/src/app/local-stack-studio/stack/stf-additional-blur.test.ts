import {
  buildStfApertureGroups, sameStfFNumber,
  deriveStfRelativeChannelFloorsFromSamples, deriveStfMedianSharpnessC,
  deriveStfRatioEpsilon, STF_SHARPNESS_RATIO_P50_DIVISOR, STF_SHARPNESS_RATIO_V2_P50_DIVISOR,
  STF_SHARPNESS_RATIO_X12, STF_SHARPNESS_RATIO_X13, STF_SHARPNESS_RATIO_X14, STF_SHARPNESS_RATIO_X15,
  STF_SHARPNESS_RATIO_X16, STF_SHARPNESS_RATIO_X20,
  buildStfLogRatioFromDerived, buildStfSharpnessDiagnosticLogFromDerived, normalizeStfLogRatioBufferInPlace,
  buildStfDilatedLogRatioInto,
  normalizeStfLogRatioValue, buildStfLogRatioNormalizationPlan,
  buildStfSigmoidPlan, applyStfSigmoidGateInPlace,
  resolveStfAdditionalBlurRadius, applyStfGateExpansion, applyGuardedGaussianBlurRegion,
  buildStfRelativeSharpnessMapAtScaleInto, createStfSharpnessScratch,
  buildStfFineGeometricMeanFromDerived, buildStfCoarseGeometricMeanFromDerived,
  dilateStfSharpnessAbovePercentile, resolveStfDilatedFineRadius,
} from "./stf-additional-blur";

describe("STF production sharpness and protection gate", () => {
  test("same F-number images share groups; invalid F numbers fail", () => {
    expect(sameStfFNumber(2, 2.0000001)).toBe(true);
    const groups = buildStfApertureGroups([4, 2, 2.0000001, 2.8]);
    expect(Array.from(groups.imageGroupIndexes)).toEqual([2, 0, 0, 1]);
    expect(Array.from(groups.groupImageCounts)).toEqual([2, 1, 1]);
    expect(() => buildStfApertureGroups([2, 2])).toThrow();
    expect(() => buildStfApertureGroups([2, 0])).toThrow();
  });
  test("RGB brightness floors use independent channel P50 / 64, added to brightness", () => {
    const floors = deriveStfRelativeChannelFloorsFromSamples([[1, 2, 3], [4, 8, 12], [0.5, 1, 1.5]]);
    expect(floors[0]).toBeCloseTo(2 / 64);
    expect(floors[1]).toBeCloseTo(8 / 64);
    expect(floors[2]).toBeCloseTo(1 / 64);
    const w = 17, h = 17, input = new Float32Array(w * h * 3);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const pixel = (y * w + x) * 3;
      input[pixel] = x < 8 ? 0.1 : 0.8;
      input[pixel + 1] = 0.3;
      input[pixel + 2] = 0.3;
    }
    const output = new Float32Array(w * h);
    buildStfRelativeSharpnessMapAtScaleInto(input, w, h, 1, output, createStfSharpnessScratch(w * h), floors);
    expect(output[8 * w + 8]).toBeGreaterThan(0);
    expect(output[3 * w + 3]).toBeCloseTo(0, 5);
    // Raising red floor changes only red-relative Sobel, lowering its value.
    const less = new Float32Array(w * h);
    buildStfRelativeSharpnessMapAtScaleInto(input, w, h, 1, less, createStfSharpnessScratch(w * h), [1, floors[1], floors[2]]);
    expect(less[8 * w + 8]).toBeLessThan(output[8 * w + 8]);
  });
  test("coarse P50/64 epsilon and grouped geometric log-ratios", () => {
    expect(deriveStfMedianSharpnessC([1, 4, 2, 3])).toBeCloseTo(2.5);
    expect(STF_SHARPNESS_RATIO_P50_DIVISOR).toBe(64);
    expect(STF_SHARPNESS_RATIO_V2_P50_DIVISOR).toBe(32);
    expect(deriveStfRatioEpsilon(2.5)).toBeCloseTo(2.5 / 64);
    expect(deriveStfRatioEpsilon(2.5, STF_SHARPNESS_RATIO_V2_P50_DIVISOR)).toBeCloseTo(2.5 / 32);
    const fine = Float32Array.from([Math.log(4) + Math.log(9), Math.log(4) + Math.log(9)]);
    const zeros = Uint8Array.from([0, 1]);
    const coarse = Float32Array.from([2, 2, 3, 3]);
    const log = buildStfLogRatioFromDerived(fine, zeros, coarse, 2, 0.25);
    expect(log[0]).toBeCloseTo(Math.log(Math.sqrt((4 * 9) / ((2 + 0.25) * (3 + 0.25)))));
    expect(Number.isNaN(log[1])).toBe(true);
  });
  test("diagnostic maps show the existing aperture-group geometric sharpness and raw ratio", () => {
    // Two pixels, two aperture groups: fine values [4,9] and [16,25].
    const fine = Float32Array.from([Math.log(4) + Math.log(9), Math.log(16) + Math.log(25)]);
    const zero = Uint8Array.from([0, 1]);
    const coarse = Float32Array.from([2, 4, 3, 5]);
    const fineView = buildStfSharpnessDiagnosticLogFromDerived(fine, zero, coarse, 2, 0.25, "fine");
    const coarseView = buildStfSharpnessDiagnosticLogFromDerived(fine, zero, coarse, 2, 0.25, "coarse");
    const ratioView = buildStfSharpnessDiagnosticLogFromDerived(fine, zero, coarse, 2, 0.25, "ratio");
    const ratioViewV2 = buildStfSharpnessDiagnosticLogFromDerived(fine, zero, coarse, 2, 0.5, "ratio-v2");
    const ratioViewX12 = buildStfSharpnessDiagnosticLogFromDerived(fine, zero, coarse, 2, 0.5, "ratio-x1.2");
    const ratioViewX14 = buildStfSharpnessDiagnosticLogFromDerived(fine, zero, coarse, 2, 0.5, "ratio-x1.4");
    const ratioViewX15 = buildStfSharpnessDiagnosticLogFromDerived(fine, zero, coarse, 2, 0.5, "ratio-x1.5");
    const ratioViewX16 = buildStfSharpnessDiagnosticLogFromDerived(fine, zero, coarse, 2, 0.5, "ratio-x1.6");
    const ratioViewX20 = buildStfSharpnessDiagnosticLogFromDerived(fine, zero, coarse, 2, 0.5, "ratio-x2.0");
    expect(fineView[0]).toBeCloseTo(Math.log(6));
    expect(Number.isNaN(fineView[1])).toBe(true);
    expect(coarseView[0]).toBeCloseTo(Math.log(Math.sqrt(6)));
    expect(coarseView[1]).toBeCloseTo(Math.log(Math.sqrt(20)));
    expect(Array.from(ratioView, (v) => Number.isNaN(v) ? "NaN" : v)).toEqual(
      Array.from(buildStfLogRatioFromDerived(fine, zero, coarse, 2, 0.25),
        (v) => Number.isNaN(v) ? "NaN" : v),
    );
    expect(Array.from(ratioViewV2, (v) => Number.isNaN(v) ? "NaN" : v)).toEqual(
      Array.from(buildStfLogRatioFromDerived(fine, zero, coarse, 2, 0.5),
        (v) => Number.isNaN(v) ? "NaN" : v),
    );
    expect(Array.from(ratioViewX12, (v) => Number.isNaN(v) ? "NaN" : v)).toEqual(
      Array.from(buildStfLogRatioFromDerived(fine, zero, coarse, 2, 0.5, STF_SHARPNESS_RATIO_X12),
        (v) => Number.isNaN(v) ? "NaN" : v),
    );
    expect(Array.from(ratioViewX14, (v) => Number.isNaN(v) ? "NaN" : v)).toEqual(
      Array.from(buildStfLogRatioFromDerived(fine, zero, coarse, 2, 0.5, STF_SHARPNESS_RATIO_X14),
        (v) => Number.isNaN(v) ? "NaN" : v),
    );
    expect(Array.from(ratioViewX15, (v) => Number.isNaN(v) ? "NaN" : v)).toEqual(
      Array.from(buildStfLogRatioFromDerived(fine, zero, coarse, 2, 0.5, STF_SHARPNESS_RATIO_X15),
        (v) => Number.isNaN(v) ? "NaN" : v),
    );
    expect(Array.from(ratioViewX16, (v) => Number.isNaN(v) ? "NaN" : v)).toEqual(
      Array.from(buildStfLogRatioFromDerived(fine, zero, coarse, 2, 0.5, STF_SHARPNESS_RATIO_X16),
        (v) => Number.isNaN(v) ? "NaN" : v),
    );
    expect(Array.from(ratioViewX20, (v) => Number.isNaN(v) ? "NaN" : v)).toEqual(
      Array.from(buildStfLogRatioFromDerived(fine, zero, coarse, 2, 0.5, STF_SHARPNESS_RATIO_X20),
        (v) => Number.isNaN(v) ? "NaN" : v),
    );
    expect(ratioViewX14[0]).toBeCloseTo(1.4 * Math.log(6) - Math.log(Math.sqrt((2 + 0.5) * (3 + 0.5))));
    expect(ratioViewX16[0]).toBeCloseTo(1.6 * Math.log(6) - Math.log(Math.sqrt((2 + 0.5) * (3 + 0.5))));
    expect(ratioViewX16[0]).toBeGreaterThan(ratioViewX14[0]);
    expect(Number.isNaN(ratioViewX14[1])).toBe(true);
    expect(Number.isNaN(ratioViewX16[1])).toBe(true);
    expect(() => buildStfSharpnessDiagnosticLogFromDerived(fine, zero, coarse, 2, 0.25, "invalid" as never)).toThrow();
    const normalized = fineView.slice();
    normalizeStfLogRatioBufferInPlace(normalized);
    expect(normalized[1]).toBe(0);
    expect(normalized[0]).toBeGreaterThanOrEqual(0);
    expect(normalized[0]).toBeLessThanOrEqual(1);
  });
  test("dilated x1.3 uses the same D and R maps as x1.5 but changes only exponent", () => {
    const fine = Float32Array.from([4, 8, 2, 1]);
    const rough = Float32Array.from([2, 1, 1, 1]);
    const epsilon = deriveStfRatioEpsilon(16, STF_SHARPNESS_RATIO_V2_P50_DIVISOR);
    expect(epsilon).toBe(0.5);
    expect(STF_SHARPNESS_RATIO_X13).toBe(1.3);
    const outV2 = new Float32Array(fine.length);
    const outV3 = new Float32Array(fine.length);
    buildStfDilatedLogRatioInto(fine, rough, epsilon, STF_SHARPNESS_RATIO_X15, outV2);
    buildStfDilatedLogRatioInto(fine, rough, epsilon, STF_SHARPNESS_RATIO_X13, outV3);
    for (let i = 0; i < fine.length; i += 1) {
      expect(outV3[i]).toBeCloseTo(1.3 * Math.log(fine[i]) - Math.log(rough[i] + epsilon), 5);
      expect(outV2[i]).toBeCloseTo(1.5 * Math.log(fine[i]) - Math.log(rough[i] + epsilon), 5);
      expect(outV3[i] - outV2[i]).toBeCloseTo((1.3 - 1.5) * Math.log(fine[i]), 5);
    }
    const zeroMap = Float32Array.from([0, 1]);
    const zeroOut = new Float32Array(2);
    buildStfDilatedLogRatioInto(zeroMap, Float32Array.from([0, 0]), epsilon, 1.3, zeroOut);
    expect(Number.isNaN(zeroOut[0])).toBe(true);
    expect(zeroOut[1]).toBeCloseTo(-Math.log(epsilon), 5);
    expect(() => buildStfDilatedLogRatioInto(fine, rough, epsilon, 0, outV3)).toThrow();
  });

  test("P3/P97 normalization happens once on log ratio, including stable flat fallback", () => {
    const log = Float32Array.from(Array.from({ length: 101 }, (_, i) => i / 10));
    log[0] = NaN;
    const n = normalizeStfLogRatioBufferInPlace(log);
    expect(n.degenerate).toBe(false);
    expect(log[0]).toBe(0);
    expect(log[1]).toBe(0);
    expect(log[100]).toBe(1);
    const fixed = Float32Array.from([2, 2, 2, 2]);
    expect(normalizeStfLogRatioBufferInPlace(fixed).degenerate).toBe(true);
    expect(Array.from(fixed)).toEqual([0.5, 0.5, 0.5, 0.5]);
    const p = buildStfLogRatioNormalizationPlan(Float32Array.from([0, 10, 20, 30]), 0, 1);
    expect(normalizeStfLogRatioValue(10, p)).toBeCloseTo(1 / 3);
  });
  test("P3/P97 selection agrees with full sorting for arbitrary percentiles and finite subsets", () => {
    const reference = (source: ArrayLike<number>, low: number, high: number) => {
      const sorted: number[] = [];
      for (let i = 0; i < source.length; i++) {
        if (Number.isFinite(source[i])) sorted.push(source[i]);
      }
      sorted.sort((a, b) => a - b);
      const percentile = (q: number): number => {
        const position = q * (sorted.length - 1);
        const lo = Math.floor(position);
        const hi = Math.ceil(position);
        return sorted[lo] + (sorted[hi] - sorted[lo]) * (position - lo);
      };
      return sorted.length > 0 ? [percentile(low), percentile(high)] : [0, 1];
    };
    let state = 0x1234abcd;
    const random = (): number => {
      state = (Math.imul(1664525, state) + 1013904223) >>> 0;
      return state / 0x1_0000_0000;
    };
    const percentiles: Array<[number, number]> = [
      [0.03, 0.97], [0, 1], [0.2, 0.8], [0.49, 0.51], [0.001, 0.999],
    ];
    for (const length of [1, 2, 3, 4, 8, 9, 31, 100, 101, 102, 257, 1001, 4096]) {
      for (const shape of ["random", "ascending", "descending", "flat", "binary", "steps", "almost-flat"]) {
        const data = new Float32Array(length);
        for (let i = 0; i < length; i++) {
          if (shape === "random") data[i] = (random() - 0.5) * 100;
          else if (shape === "ascending") data[i] = i / 31;
          else if (shape === "descending") data[i] = -i / 31;
          else if (shape === "flat") data[i] = 3;
          else if (shape === "binary") data[i] = i % 5 ? 0 : 1;
          else if (shape === "steps") data[i] = Math.floor(i / 17);
          else data[i] = 1 + (i % 7 === 0 ? 0.00001 : 0);
        }
        if (length >= 8 && shape !== "flat") {
          data[2] = NaN;
          data[5] = NaN;
        }
        const unchanged = data.slice();
        for (const [low, high] of percentiles) {
          const plan = buildStfLogRatioNormalizationPlan(data, low, high);
          const [expectedLow, expectedHigh] = reference(data, low, high);
          expect(plan.lowerValue).toBe(expectedLow);
          expect(plan.upperValue).toBe(expectedHigh);
          expect(plan.finiteCount).toBe(length >= 8 && shape !== "flat" ? length - 2 : length);
          expect(plan.degenerate).toBe(!(expectedHigh - expectedLow > 1e-12));
        }
        expect(Array.from(data, (value) => Number.isNaN(value) ? "NaN" : value))
          .toEqual(Array.from(unchanged, (value) => Number.isNaN(value) ? "NaN" : value));
      }
    }
    const precision = [0, 0.1 + Number.EPSILON, 5, 9.123456789012345, 12, 50];
    const [expectedLow, expectedHigh] = reference(precision, 0.03, 0.97);
    const precisePlan = buildStfLogRatioNormalizationPlan(precision);
    expect(precisePlan.lowerValue).toBe(expectedLow);
    expect(precisePlan.upperValue).toBe(expectedHigh);
    expect(buildStfLogRatioNormalizationPlan([NaN, NaN]).finiteCount).toBe(0);
    expect(() => buildStfLogRatioNormalizationPlan([1, Infinity])).toThrow();
    expect(() => buildStfLogRatioNormalizationPlan([1, -Infinity])).toThrow();
    expect(() => buildStfLogRatioNormalizationPlan([1, 2], 0.97, 0.03)).toThrow();
  });
  test("P3/P97 optimization leaves each pixel in place and matches the original normalized image", () => {
    const values = Float32Array.from(Array.from({ length: 1000 }, (_, i) => {
      if (i % 71 === 0) return NaN;
      return Math.fround(Math.sin(i * 0.23) + (i % 37) / 13 - 2);
    }));
    const source = values.slice();
    const finite = Array.from(source).filter(Number.isFinite).sort((a, b) => a - b);
    const percentile = (q: number) => {
      const position = q * (finite.length - 1);
      const lo = Math.floor(position), hi = Math.ceil(position);
      return finite[lo] + (finite[hi] - finite[lo]) * (position - lo);
    };
    const low = percentile(0.03), high = percentile(0.97);
    normalizeStfLogRatioBufferInPlace(values);
    for (let i = 0; i < source.length; i++) {
      const expected = Number.isNaN(source[i]) ? 0 : Math.max(0, Math.min(1, (source[i] - low) / (high - low)));
      expect(values[i]).toBe(Math.fround(expected));
    }
  });
  test("sigmoid keeps both endpoints fixed, is monotone and percentile depends on bokeh ratio", () => {
    const values = Float32Array.from(Array.from({ length: 101 }, (_, i) => i / 100));
    const plan = buildStfSigmoidPlan(values, 0.7);
    expect(plan.thresholdPercentile).toBeCloseTo(0.7);
    expect(plan.threshold).toBeCloseTo(0.7);
    applyStfSigmoidGateInPlace(values, 101, 1, 0.7, 75);
    expect(values[0]).toBe(0);
    expect(values[100]).toBe(1);
    for (let i = 1; i < values.length; i++) expect(values[i]).toBeGreaterThanOrEqual(values[i - 1]);
  });
  test("blur radii and 50% gate dilation depend on selected strength", () => {
    expect(resolveStfAdditionalBlurRadius(4000, 4000, 1)).toBe(4);
    expect(resolveStfAdditionalBlurRadius(4000, 4000, 2)).toBe(8);
    expect(resolveStfAdditionalBlurRadius(4000, 4000, 3)).toBe(12);
    expect(resolveStfAdditionalBlurRadius(500, 500, 3)).toBe(2);
    const w = 31, h = 31, data = new Float32Array(w * h);
    data[15 * w + 15] = 1;
    data[14 * w + 15] = 0.7;
    const weak = applyStfGateExpansion(data, w, h, 4);
    const medium = applyStfGateExpansion(data, w, h, 8);
    const strong = applyStfGateExpansion(data, w, h, 12);
    expect(weak[15 * w + 18]).toBe(0);
    expect(medium[15 * w + 19]).toBeGreaterThan(0);
    expect(strong[15 * w + 21]).toBeGreaterThan(0);
    expect(data[15 * w + 15]).toBe(1);
    expect(weak[14 * w + 15]).toBeGreaterThanOrEqual(0.7 - 1e-6);
  });
  test("gate preview expansion matches the blur stage across worker stripe boundaries", () => {
    const width = 31, height = 27;
    const radius = resolveStfAdditionalBlurRadius(4_000, 4_000, 2);
    const original = new Float32Array(width * height);
    original[6 * width + 14] = 1;
    original[14 * width + 3] = 0.95;
    original[20 * width + 25] = 0.8;
    const full = applyStfGateExpansion(original, width, height, radius);
    const stripeOutput = new Float32Array(width * height);
    const halo = Math.max(1, Math.round(radius * 0.5));
    for (let start = 0; start < height; start += 5) {
      const end = Math.min(height, start + 5);
      const regionY = Math.max(0, start - halo);
      const regionEnd = Math.min(height, end + halo);
      const part = applyStfGateExpansion(original.slice(regionY * width, regionEnd * width),
        width, regionEnd - regionY, radius);
      stripeOutput.set(part.subarray((start - regionY) * width, (end - regionY) * width), start * width);
    }
    expect(Array.from(stripeOutput)).toEqual(Array.from(full));
    expect(full[6 * width + 17]).toBeGreaterThan(original[6 * width + 17]);
  });
  test("guarded Gaussian keeps protected subject and suppresses its spill onto a dark background", () => {
    const w = 17, h = 17, rgb = new Float32Array(w * h * 3);
    const gate = new Float32Array(w * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const p = y * w + x;
      if (x === 8 && y === 8) { rgb[p * 3] = 1; gate[p] = 1; }
    }
    const out = applyGuardedGaussianBlurRegion(rgb, w, h, gate, 4, 0, h);
    expect(out[(8 * w + 8) * 3]).toBeCloseTo(1);
    expect(out[(8 * w + 9) * 3]).toBeCloseTo(0);
    const unprotected = applyGuardedGaussianBlurRegion(rgb, w, h, new Float32Array(w * h), 4, 0, h);
    expect(unprotected[(8 * w + 9) * 3]).toBeGreaterThan(0);
  });
  test("stripe calculations agree with full image Gaussian", () => {
    const w = 13, h = 20, source = new Float32Array(w * h * 3);
    const gate = new Float32Array(w * h);
    for (let i = 0; i < source.length; i++) source[i] = (i % 101) / 101;
    for (let i = 0; i < gate.length; i++) gate[i] = (i % 19) / 18;
    const radius = 3;
    const full = applyGuardedGaussianBlurRegion(source, w, h, gate, radius, 0, h);
    const split = new Float32Array(full.length);
    for (let start = 0; start < h; start += 5) {
      const end = Math.min(h, start + 5);
      const regionY = Math.max(0, start - radius), regionEnd = Math.min(h, end + radius);
      const part = applyGuardedGaussianBlurRegion(source.slice(regionY * w * 3, regionEnd * w * 3),
        w, regionEnd - regionY, gate.slice(regionY * w, regionEnd * w), radius, start - regionY, end - start);
      split.set(part, start * w * 3);
    }
    for (let i = 0; i < full.length; i++) expect(split[i]).toBeCloseTo(full[i], 5);
  });
});

describe("STF worker-parallel gate expansion stripe boundaries", () => {
  test("halo-padded stripe expansion is bit-identical to whole-image expansion", () => {
    for (const [width, height] of [[1, 1], [2, 13], [11, 3], [17, 23], [31, 27]]) {
      const values = new Float32Array(width * height);
      for (let i = 0; i < values.length; i++) {
        values[i] = i % 13 === 0 ? 1 : i % 7 === 0 ? 0.701 : ((i * 17) % 31) / 100;
      }
      for (const blurRadius of [2, 4, 8, 12, 15]) {
        const reference = applyStfGateExpansion(values, width, height, blurRadius);
        const halo = Math.max(1, Math.round(blurRadius * 0.5));
        for (const rowsPerJob of [1, 2, 3, 7, 19]) {
          const stitched = new Float32Array(values.length);
          for (let y = 0; y < height; y += rowsPerJob) {
            const jobHeight = Math.min(rowsPerJob, height - y);
            const regionY = Math.max(0, y - halo);
            const regionEnd = Math.min(height, y + jobHeight + halo);
            const stripe = applyStfGateExpansion(
              values.slice(regionY * width, regionEnd * width), width, regionEnd - regionY, blurRadius,
            );
            const offset = y - regionY;
            stitched.set(stripe.subarray(offset * width, (offset + jobHeight) * width), y * width);
          }
          expect(Array.from(stitched)).toEqual(Array.from(reference));
        }
      }
    }
  });
});

  test("builds dilated fine sharpness map from P80 seeds", () => {
    const fineLog = new Float32Array([Math.log(1), Math.log(8), Math.log(2), Math.log(1)]);
    const fineZero = new Uint8Array(4);
    const coarse = new Float32Array([1, 2, 1, 1, 1, 2, 1, 1]);
    expect(Array.from(buildStfFineGeometricMeanFromDerived(fineLog, fineZero, 2))).toHaveLength(4);
    expect(Array.from(buildStfCoarseGeometricMeanFromDerived(coarse, 2))).toEqual([1, 2, 1, 1]);
    const dilated = dilateStfSharpnessAbovePercentile(new Float32Array([1, 8, 2, 1]), 2, 2, 0.8, 1);
    expect(Array.from(dilated)).toEqual([8, 8, 8, 8]);
    expect(resolveStfDilatedFineRadius(5184, 3888)).toBe(5);
  });

