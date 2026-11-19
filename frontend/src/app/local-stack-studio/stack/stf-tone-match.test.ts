import {
  applyStfToneMatchInPlace,
  buildStfToneMatchPlanToReference,
  buildStfToneMatchLut,
  buildStfToneMatchPlans,
  chooseStfToneReferenceIndex,
  transformStfToneIntensity,
  type StfToneStatistics,
} from "./stf-tone-match";

function stats(mean: number, p50: number, p95: number): StfToneStatistics {
  return { sampleCount: 65536, mean, p50, p95 };
}

describe("STF tone matching", () => {
  test("chooses the image nearest the median mean luminance", () => {
    expect(chooseStfToneReferenceIndex([
      stats(0.21, 0.18, 0.75),
      stats(0.30, 0.25, 0.82),
      stats(0.26, 0.22, 0.79),
    ])).toBe(2);
  });

  test("uses the average of the two center means for an even image count", () => {
    expect(chooseStfToneReferenceIndex([
      stats(0.10, 0.10, 0.70),
      stats(0.20, 0.20, 0.75),
      stats(0.40, 0.30, 0.85),
      stats(0.90, 0.40, 0.95),
    ])).toBe(1);
  });

  test("matches P50 and P95 to the selected reference with under-relaxation", () => {
    const input = [
      stats(0.20, 0.16, 0.68),
      stats(0.31, 0.28, 0.84),
      stats(0.27, 0.24, 0.80),
    ];
    const result = buildStfToneMatchPlans(input);
    expect(result).not.toBeNull();
    expect(result?.referenceIndex).toBe(2);
    const target = input[2];
    for (let index = 0; index < input.length; index += 1) {
      const plan = result!.plans[index];
      expect(Math.abs(
        transformStfToneIntensity(input[index].p50, plan.gain, plan.scaledLog) - target.p50,
      )).toBeLessThan(0.002);
      expect(Math.abs(
        transformStfToneIntensity(input[index].p95, plan.gain, plan.scaledLog) - target.p95,
      )).toBeLessThan(0.002);
    }
  });

  test("identical black-background image statistics always use exact identity", () => {
    const same = stats(0.086, 0, 0.5);
    const plans = buildStfToneMatchPlans(Array.from({ length: 7 }, () => ({ ...same })));
    expect(plans).not.toBeNull();
    expect(plans!.plans).toEqual(Array.from({ length: 7 }, () => ({ gain: 1, scaledLog: 0 })));
    expect(buildStfToneMatchPlanToReference(same, same)).toEqual({ gain: 1, scaledLog: 0 });

    const pixels = new Float32Array([0, 0, 0, 0.25, 0.25, 0.25, 0.5, 0.5, 0.5]);
    const before = Array.from(pixels);
    for (const plan of plans!.plans) {
      const copy = pixels.slice();
      applyStfToneMatchInPlace(copy, plan.gain, plan.scaledLog);
      expect(Array.from(copy)).toEqual(before);
    }
  });

  test("zero P50 cannot constrain Scaled Log; different P95 adjusts gain only", () => {
    const source = stats(0.08, 0, 0.4);
    const reference = stats(0.10, 0, 0.5);
    const plan = buildStfToneMatchPlanToReference(source, reference);
    expect(plan.scaledLog).toBe(0);
    expect(plan.gain).toBeGreaterThan(1);
    expect(Math.abs(transformStfToneIntensity(source.p95, plan.gain, plan.scaledLog) - reference.p95))
      .toBeLessThan(0.002);
    expect(transformStfToneIntensity(0, plan.gain, plan.scaledLog)).toBe(0);
  });

  test("one-sided zero P50 does not drive the Scaled Log search to either bound", () => {
    for (const [sourceP50, targetP50] of [[0, 0.2], [0.2, 0]] as const) {
      const source = stats(0.20, sourceP50, 0.6);
      const reference = stats(0.20, targetP50, 0.8);
      const plan = buildStfToneMatchPlanToReference(source, reference);
      expect(plan.scaledLog).toBe(0);
      expect(Math.abs(transformStfToneIntensity(source.p95, plan.gain, plan.scaledLog) - reference.p95))
        .toBeLessThan(0.002);
    }
  });

  test("matching nonzero percentiles return identity without numerical drift", () => {
    const source = stats(0.10, 0.12, 0.7);
    const reference = stats(0.11, 0.12, 0.7);
    expect(buildStfToneMatchPlanToReference(source, reference)).toEqual({ gain: 1, scaledLog: 0 });
  });

  test("sparse non-black images with P95=0 are valid and need no invented correction", () => {
    const sparse = [
      stats(0.00011, 0, 0),
      stats(0.00014, 0, 0),
      stats(0.00012, 0, 0),
    ];
    const result = buildStfToneMatchPlans(sparse);
    expect(result).not.toBeNull();
    expect(result!.plans).toEqual(sparse.map(() => ({ gain: 1, scaledLog: 0 })));
  });

  test("a zero P95 matched against nonzero P95 falls back to the mean without a nonlinear curve", () => {
    const sparse = stats(0.01, 0, 0);
    const lessSparse = stats(0.04, 0, 0.3);
    const plan = buildStfToneMatchPlanToReference(sparse, lessSparse);
    expect(plan.gain).toBeCloseTo(4, 8);
    expect(plan.scaledLog).toBe(0);
    const reverse = buildStfToneMatchPlanToReference(lessSparse, sparse);
    expect(reverse.gain).toBeCloseTo(0.25, 8);
    expect(reverse.scaledLog).toBe(0);
  });

  test("a completely black image remains invalid for tone matching", () => {
    expect(buildStfToneMatchPlans([stats(0, 0, 0)])).toBeNull();
  });

  test("gamma-2 LUT closely matches the analytic tone mapping", () => {
    const gain = 1.12;
    const scaledLog = 1.3;
    const lut = buildStfToneMatchLut(gain, scaledLog);
    for (const source of [0.001, 0.01, 0.1, 0.5, 1, 2, 4]) {
      const linear = new Float32Array([source, source, source]);
      applyStfToneMatchInPlace(linear, gain, scaledLog, lut);
      expect(linear[0]).toBeCloseTo(transformStfToneIntensity(source, gain, scaledLog), 4);
    }
  });

  test("preserves RGB ratios when applying the tone match", () => {
    const linear = new Float32Array([0.2, 0.4, 0.1, 0.8, 0.6, 0.4]);
    const before = Array.from(linear);
    applyStfToneMatchInPlace(linear, 1.2, 0.8);
    expect(linear[0] / linear[1]).toBeCloseTo(before[0] / before[1], 6);
    expect(linear[2] / linear[1]).toBeCloseTo(before[2] / before[1], 6);
    expect(linear[3] / linear[4]).toBeCloseTo(before[3] / before[4], 6);
    expect(linear[5] / linear[4]).toBeCloseTo(before[5] / before[4], 6);
  });

  test("extends the tone curve above one without clipping", () => {
    const value = transformStfToneIntensity(1.2, 1.1, 1.0);
    expect(value).toBeGreaterThan(1);
    expect(Number.isFinite(value)).toBe(true);
  });

  test("rejects invalid statistics rather than hiding bad data", () => {
    expect(buildStfToneMatchPlans([
      stats(0.2, 0.2, 0.8),
      { sampleCount: 1, mean: Number.NaN, p50: 0.2, p95: 0.8 },
    ])).toBeNull();
  });
});
