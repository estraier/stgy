import { encodeStoredRgb16Channel } from "@/image/rgb16-storage";
import {
  CANONICAL_TONE_HISTOGRAM_BINS,
  CANONICAL_TONE_SAMPLE_TARGET_PIXELS,
  computeCanonicalToneStatisticsFromLinearRgb,
  computeCanonicalToneStatisticsFromStoredRgb16,
} from "./canonical-source";

function grayLinear(values: number[]): Float32Array {
  const output = new Float32Array(values.length * 3);
  values.forEach((value, index) => {
    output[index * 3] = value;
    output[index * 3 + 1] = value;
    output[index * 3 + 2] = value;
  });
  return output;
}

describe("canonical STF tone statistics", () => {
  test("collects mean, P50 and P95 in one bounded histogram domain", () => {
    const linear = grayLinear([0.1, 0.2, 0.3, 0.9]);
    const result = computeCanonicalToneStatisticsFromLinearRgb(linear, 2, 2);
    expect(result.sampleCount).toBe(4);
    expect(result.mean).toBeCloseTo(0.375, 6);
    expect(result.p50).toBeCloseTo(0.25, 3);
    expect(result.p95).toBeCloseTo(0.81, 2);
    expect(CANONICAL_TONE_HISTOGRAM_BINS).toBe(4096);
  });

  test("stored gamma-2 canonical samples produce the same statistics", () => {
    const values = [0.05, 0.2, 0.5, 0.95];
    const linear = grayLinear(values);
    const stored = new Uint16Array(linear.length);
    for (let i = 0; i < linear.length; i += 1) {
      stored[i] = encodeStoredRgb16Channel(linear[i], "gamma20", 4);
    }
    const fromLinear = computeCanonicalToneStatisticsFromLinearRgb(linear, 2, 2);
    const fromStored = computeCanonicalToneStatisticsFromStoredRgb16(stored, 2, 2);
    expect(fromStored.mean).toBeCloseTo(fromLinear.mean, 4);
    expect(fromStored.p50).toBeCloseTo(fromLinear.p50, 3);
    expect(fromStored.p95).toBeCloseTo(fromLinear.p95, 3);
  });

  test("sampling stays at or below 65536 pixels", () => {
    const width = 1000;
    const height = 1000;
    const linear = new Float32Array(width * height * 3);
    linear.fill(0.4);
    const result = computeCanonicalToneStatisticsFromLinearRgb(linear, width, height);
    expect(result.sampleCount).toBeLessThanOrEqual(CANONICAL_TONE_SAMPLE_TARGET_PIXELS);
    expect(result.sampleCount).toBeGreaterThan(60_000);
    expect(result.mean).toBeCloseTo(0.4, 6);
    expect(result.p50).toBeCloseTo(0.4, 3);
    expect(result.p95).toBeCloseTo(0.4, 3);
  });
});
