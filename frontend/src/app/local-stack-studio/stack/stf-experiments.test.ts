import {
  buildStfExperimentApertureOrder,
  computeStfExperimentBlurTerms,
  computeStfExperimentOriginallyUnsharpGate,
  computeStfExperimentResponses,
  isStfExperimentMode,
  sameFNumber,
  resolveStfExperimentBlurRadius,
  resolveStfExperimentHalo,
} from "./stf-experiments";

describe("STF experiment helpers", () => {
  test("recognizes experiment modes", () => {
    expect(isStfExperimentMode("stf-exp-dof")).toBe(true);
    expect(isStfExperimentMode("stf-exp-coc")).toBe(true);
    expect(isStfExperimentMode("stf-exp-blur")).toBe(true);
    expect(isStfExperimentMode("stf")).toBe(false);
  });

  test("builds aperture order in ascending F-number order", () => {
    const order = buildStfExperimentApertureOrder([4, 2, 3.2, 2.8]);
    expect(Array.from(order ?? [])).toEqual([1, 3, 2, 0]);
  });

  test("allows duplicate F-numbers while requiring at least two distinct apertures", () => {
    expect(Array.from(buildStfExperimentApertureOrder([2.8, 2, 2.8, 4]) ?? [])).toEqual([1, 0, 2, 3]);
    expect(buildStfExperimentApertureOrder([2, 2.8, Number.NaN])).toBeNull();
    expect(buildStfExperimentApertureOrder([2, 2, 2])).toBeNull();
    expect(buildStfExperimentApertureOrder([2])).toBeNull();
  });

  test("treats Float32-sized F-number roundoff as the same aperture", () => {
    expect(sameFNumber(2.8, Math.fround(2.8))).toBe(true);
    expect(sameFNumber(2.8, 3.2)).toBe(false);
  });

  test("prefers DoF response when stopping down increases sharpness", () => {
    const result = computeStfExperimentResponses(0.05, 0.4, 0.5);
    expect(result.dof).toBeGreaterThan(result.coc);
    expect(result.blur).toBeLessThan(result.dof);
  });

  test("prefers CoC and blur responses when opening up appears sharper", () => {
    const result = computeStfExperimentResponses(0.4, 0.05, 0.5, 0.1);
    expect(result.coc).toBeGreaterThan(result.dof);
    expect(result.blur).toBeGreaterThan(0.2);
  });

  test("builds a protection gate from normal sharpness relative to peak sharpness", () => {
    expect(computeStfExperimentOriginallyUnsharpGate(0.5, 0.1)).toBe(1);
    expect(computeStfExperimentOriginallyUnsharpGate(0.5, 0.45)).toBe(0);
    const transition = computeStfExperimentOriginallyUnsharpGate(0.5, 0.3);
    expect(transition).toBeGreaterThan(0);
    expect(transition).toBeLessThan(1);
  });

  test("suppresses Blur when the location was already sharp before the open-side rise", () => {
    const originallyUnsharp = computeStfExperimentResponses(0.2, 0.01, 0.5, 0.05);
    const alreadySharp = computeStfExperimentResponses(0.2, 0.01, 0.5, 0.45);
    expect(originallyUnsharp.coc).toBeCloseTo(alreadySharp.coc, 12);
    expect(originallyUnsharp.blur).toBeGreaterThan(0.2);
    expect(alreadySharp.blur).toBe(0);
  });

  test("keeps an in-focus edge out of Blur even when its open-aperture sample is slightly sharper", () => {
    const result = computeStfExperimentResponses(0.05, 0.005, 0.8, 0.7);
    expect(result.coc).toBeGreaterThan(0);
    expect(result.blur).toBe(0);
  });


  test("uses the strongest single open-side rise rather than summing multiple small rises", () => {
    const strongSingle = computeStfExperimentResponses(0.30, 0.01, 0.5, 0.05);
    const splitAcrossTwoSteps = computeStfExperimentResponses(0.15, 0.01, 0.5, 0.05);
    expect(strongSingle.blur).toBeGreaterThan(splitAcrossTwoSteps.blur);
    expect(strongSingle.coc).toBeGreaterThan(splitAcrossTwoSteps.coc);
  });

  test("uses low baseline sharpness to keep originally sharp features out of Blur", () => {
    const originallySoft = computeStfExperimentResponses(0.25, 0.01, 0.5, 0.05);
    const originallySharp = computeStfExperimentResponses(0.25, 0.01, 0.5, 0.40);
    expect(originallySoft.blur).toBeGreaterThan(originallySharp.blur);
    expect(originallySharp.blur).toBe(0);
  });

  test("builds Blur support only from the open-side rise", () => {
    const weakStop = computeStfExperimentBlurTerms(0.25, 0.01, 0.5, 0.05);
    const strongStop = computeStfExperimentBlurTerms(0.25, 1.0, 0.5, 0.05);
    expect(strongStop.support).toBeCloseTo(weakStop.support, 12);
    expect(strongStop.rawBlur).toBeCloseTo(weakStop.rawBlur, 12);
  });

  test("does not create Blur from a stop-side rise alone", () => {
    const terms = computeStfExperimentBlurTerms(0, 0.5, 0.5, 0.05);
    expect(terms.support).toBe(0);
    expect(terms.rawBlur).toBe(0);
  });

  test("exposes the exact multiplicative Blur terms for diagnostics", () => {
    const terms = computeStfExperimentBlurTerms(0.4, 0.05, 0.5, 0.1);
    expect(terms.rawBlur).toBeCloseTo(terms.support * terms.originallyUnsharpGate, 12);
    expect(computeStfExperimentResponses(0.4, 0.05, 0.5, 0.1).blur).toBeCloseTo(terms.rawBlur, 12);
  });

  test("returns zero responses for flat regions", () => {
    expect(computeStfExperimentResponses(0, 0, 0.5)).toEqual({ dof: 0, coc: 0, blur: 0 });
    expect(computeStfExperimentResponses(0.1, 0.2, 0)).toEqual({ dof: 0, coc: 0, blur: 0 });
  });

  test("scales blur radius and halo with image size", () => {
    expect(resolveStfExperimentBlurRadius(1000, 1000)).toBe(2);
    expect(resolveStfExperimentHalo(1000, 1000)).toBe(6);
    expect(resolveStfExperimentBlurRadius(5184, 3456)).toBe(8);
    expect(resolveStfExperimentHalo(5184, 3456)).toBe(18);
  });
});
