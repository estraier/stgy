import {
  applyStfToneMatchInPlace,
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
