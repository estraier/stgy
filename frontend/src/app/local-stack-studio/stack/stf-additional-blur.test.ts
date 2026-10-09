import {
  STF_ADDITIONAL_BLUR_HISTOGRAM_BINS,
  applyStfAdditionalBlurEdgeProtection,
  applyStfAdditionalBlurScaledLog,
  buildStfAdditionalBlurApertureOrder,
  computeStfAdditionalBlurOriginallyUnsharpGate,
  computeStfAdditionalBlurPersistentEdgeProtection,
  dilateStfAdditionalBlurProtection,
  computeStfAdditionalBlurTerms,
  dequantizeStfAdditionalBlurMask,
  quantizeStfAdditionalBlurMask,
  resolveStfAdditionalBlurRadius,
  sameStfAdditionalBlurFNumber,
  shouldApplyStfAdditionalBlur,
  solveStfAdditionalBlurScaledLogFactor,
  stfAdditionalBlurHistogramBin,
  stfAdditionalBlurHistogramPercentile,
} from "./stf-additional-blur";

describe("STF Additional Blur helpers", () => {
  test("enables only non-zero published targets", () => {
    expect(shouldApplyStfAdditionalBlur(0)).toBe(false);
    for (const target of [0.3, 0.4, 0.5, 0.6, 0.7]) {
      expect(shouldApplyStfAdditionalBlur(target)).toBe(true);
    }
    expect(shouldApplyStfAdditionalBlur(0.55)).toBe(false);
  });

  test("orders apertures while allowing duplicate F-numbers", () => {
    expect(Array.from(buildStfAdditionalBlurApertureOrder([2.8, 2, 2.8, 4]) ?? []))
      .toEqual([1, 0, 2, 3]);
    expect(buildStfAdditionalBlurApertureOrder([2, 2, 2])).toBeNull();
    expect(buildStfAdditionalBlurApertureOrder([2, Number.NaN, 4])).toBeNull();
    expect(sameStfAdditionalBlurFNumber(2.8, Math.fround(2.8))).toBe(true);
  });

  test("uses only the strongest open-side rise in Blur support", () => {
    const weak = computeStfAdditionalBlurTerms(0.1, 0.5, 0.05);
    const strong = computeStfAdditionalBlurTerms(0.3, 0.5, 0.05);
    expect(strong.support).toBeGreaterThan(weak.support);
    expect(strong.rawMask).toBeGreaterThan(weak.rawMask);
    expect(computeStfAdditionalBlurTerms(0, 0.5, 0.05).rawMask).toBe(0);
  });

  test("edge protection is re-applied after mask normalization", () => {
    expect(applyStfAdditionalBlurEdgeProtection(0.8, 0)).toBeCloseTo(0.8, 12);
    expect(applyStfAdditionalBlurEdgeProtection(0.8, 0.75)).toBeCloseTo(0.2, 12);
    expect(applyStfAdditionalBlurEdgeProtection(0.8, 1)).toBe(0);
  });

  test("builds persistent edge protection from fixed-scale sharpness", () => {
    expect(computeStfAdditionalBlurPersistentEdgeProtection(0)).toBe(0);
    const weak = computeStfAdditionalBlurPersistentEdgeProtection(0.005);
    const strong = computeStfAdditionalBlurPersistentEdgeProtection(0.1);
    expect(weak).toBeGreaterThan(0);
    expect(strong).toBeGreaterThan(weak);
    expect(strong).toBeLessThanOrEqual(1);
  });

  test("dilates sharp-edge protection by the requested blur radius", () => {
    const source = new Float32Array([0, 0, 1, 0, 0]);
    expect(Array.from(dilateStfAdditionalBlurProtection(source, 5, 1, 1))).toEqual([0, 1, 1, 1, 0]);
    expect(Array.from(dilateStfAdditionalBlurProtection(source, 5, 1, 2))).toEqual([1, 1, 1, 1, 1]);
  });

  test("protects a region that was already sharp before the open-side rise", () => {
    expect(computeStfAdditionalBlurOriginallyUnsharpGate(0.5, 0.1)).toBe(1);
    expect(computeStfAdditionalBlurOriginallyUnsharpGate(0.5, 0.45)).toBe(0);
    expect(computeStfAdditionalBlurTerms(0.2, 0.5, 0.45).rawMask).toBe(0);
  });

  test("scales blur radius with linear image dimensions", () => {
    expect(resolveStfAdditionalBlurRadius(3000, 2000)).toBe(5);
    expect(resolveStfAdditionalBlurRadius(6000, 4000)).toBe(10);
    expect(resolveStfAdditionalBlurRadius(5184, 3456)).toBe(8);
  });

  test("quantizes and restores unit masks", () => {
    for (const value of [0, 0.1, 0.5, 0.9, 1]) {
      expect(dequantizeStfAdditionalBlurMask(quantizeStfAdditionalBlurMask(value)))
        .toBeCloseTo(value, 4);
    }
  });

  test("computes P50 from the fixed histogram", () => {
    const histogram = new Uint32Array(STF_ADDITIONAL_BLUR_HISTOGRAM_BINS);
    for (const value of [0.1, 0.2, 0.3, 0.4, 0.5]) {
      histogram[stfAdditionalBlurHistogramBin(value)] += 1;
    }
    expect(stfAdditionalBlurHistogramPercentile(histogram, 5, 0.5)).toBeCloseTo(0.3, 3);
  });

  test.each([0.3, 0.4, 0.5, 0.6, 0.7])(
    "maps an observed median to target P50=%s with scaled-log",
    (target) => {
      const source = 0.1;
      const factor = solveStfAdditionalBlurScaledLogFactor(source, target);
      expect(applyStfAdditionalBlurScaledLog(source, factor)).toBeCloseTo(target, 8);
      expect(applyStfAdditionalBlurScaledLog(0, factor)).toBe(0);
      expect(applyStfAdditionalBlurScaledLog(1, factor)).toBe(1);
    },
  );

  test("keeps the mask unchanged when source and target medians match", () => {
    expect(solveStfAdditionalBlurScaledLogFactor(0.5, 0.5)).toBe(0);
    expect(applyStfAdditionalBlurScaledLog(0.37, 0)).toBeCloseTo(0.37, 12);
  });

  test("scaled-log remains monotonic", () => {
    const factor = solveStfAdditionalBlurScaledLogFactor(0.1, 0.6);
    const values = [0, 0.1, 0.2, 0.5, 0.8, 1].map((value) =>
      applyStfAdditionalBlurScaledLog(value, factor));
    for (let index = 1; index < values.length; index += 1) {
      expect(values[index]).toBeGreaterThan(values[index - 1]);
    }
  });

  test("supports downward P50 normalization", () => {
    const source = 0.7;
    const target = 0.4;
    const factor = solveStfAdditionalBlurScaledLogFactor(source, target);
    expect(factor).toBeLessThan(0);
    expect(applyStfAdditionalBlurScaledLog(source, factor)).toBeCloseTo(target, 8);
  });
});
