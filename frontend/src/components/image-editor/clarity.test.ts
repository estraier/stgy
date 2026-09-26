import { buildImageEditPreviewSliderPrefixSample } from "./render";
import { buildImageEditToneSample } from "./clarity";
import { buildInteractiveColorAdjustmentContextFromLinearRgbSample } from "./analysis";
import {
  applyToneAdjustmentsLinearRgbRange,
  type ToneAdjustmentStage,
} from "@/image/tone";
import type { LinearRgbSample } from "./types";

function makeSample(
  width: number,
  height: number,
  pixels: Array<[number, number, number]>,
  linearRangeMax: number,
): LinearRgbSample {
  const data = new Float32Array(width * height * 3);
  for (let i = 0; i < width * height; i += 1) {
    const rgb = pixels[i] ?? pixels[pixels.length - 1] ?? [0, 0, 0];
    const index = i * 3;
    data[index] = rgb[0];
    data[index + 1] = rgb[1];
    data[index + 2] = rgb[2];
  }
  return {
    data,
    width,
    height,
    linearRangeMax,
    valid: new Uint8Array(width * height).fill(1),
  };
}

function expectSamplesClose(
  actual: LinearRgbSample,
  expected: LinearRgbSample,
  tolerance: number,
): void {
  expect(actual.width).toBe(expected.width);
  expect(actual.height).toBe(expected.height);
  expect(actual.data).toHaveLength(expected.data.length);
  for (let i = 0; i < actual.data.length; i += 1) {
    expect(actual.data[i] ?? 0).toBeCloseTo(expected.data[i] ?? 0, tolerance);
  }
}

function buildExactToneSample(
  sample: LinearRgbSample,
  context: ReturnType<typeof buildInteractiveColorAdjustmentContextFromLinearRgbSample>,
  startStage: ToneAdjustmentStage = "white-balance",
): LinearRgbSample {
  const width = sample.width;
  const height = sample.height;
  const data = new Float32Array(sample.data.length);
  for (let pixel = 0, source = 0; pixel < width * height; pixel += 1, source += 3) {
    const [r, g, b] = applyToneAdjustmentsLinearRgbRange(
      sample.data[source] ?? 0,
      sample.data[source + 1] ?? 0,
      sample.data[source + 2] ?? 0,
      context,
      startStage,
      "after-tone",
    );
    data[source] = Math.fround(r);
    data[source + 1] = Math.fround(g);
    data[source + 2] = Math.fround(b);
  }
  return {
    data,
    width,
    height,
    linearRangeMax: sample.linearRangeMax,
    ...(sample.valid ? { valid: sample.valid } : {}),
  };
}

describe("buildImageEditToneSample", () => {
  test("matches the direct tone pipeline for SDR samples", () => {
    const sample = makeSample(4, 3, [
      [0.01, 0.03, 0.08],
      [0.12, 0.08, 0.04],
      [0.18, 0.24, 0.11],
      [0.35, 0.31, 0.14],
      [0.52, 0.46, 0.27],
      [0.75, 0.69, 0.42],
      [0.92, 0.88, 0.74],
      [0.48, 0.51, 0.84],
      [0.09, 0.11, 0.18],
      [0.28, 0.22, 0.17],
      [0.64, 0.58, 0.55],
      [0.97, 0.94, 0.91],
    ], 1);
    const context = buildInteractiveColorAdjustmentContextFromLinearRgbSample(
      sample,
      18,
      -12,
      0.6,
      38,
      -42,
      5,
      2.2,
      0,
      0,
      true,
      -28,
      34,
    );

    const actual = buildImageEditToneSample(sample, context);
    const expected = buildExactToneSample(sample, context);
    expect(actual.linearRangeMax).toBe(1);
    expectSamplesClose(actual, expected, 3);
  });

  test("matches the direct tone pipeline for RAW-range samples", () => {
    const sample = makeSample(4, 3, [
      [0.04, 0.06, 0.08],
      [0.32, 0.28, 0.24],
      [0.88, 0.76, 0.51],
      [1.18, 1.05, 0.73],
      [1.52, 1.32, 0.92],
      [1.98, 1.72, 1.28],
      [2.35, 2.08, 1.74],
      [2.68, 2.44, 2.12],
      [2.94, 2.76, 2.31],
      [3.12, 3.01, 2.72],
      [3.36, 3.22, 3.05],
      [3.72, 3.58, 3.44],
    ], 4);
    const context = buildInteractiveColorAdjustmentContextFromLinearRgbSample(
      sample,
      -24,
      10,
      0.7,
      44,
      -35,
      6.5,
      1.8,
      0,
      0,
      true,
      -24,
      42,
    );

    const actual = buildImageEditToneSample(sample, context);
    const expected = buildExactToneSample(sample, context);
    expect(actual.linearRangeMax).toBe(4);
    expectSamplesClose(actual, expected, 3);
  });

  test("matches direct tone for localized negative White rescue", () => {
    const sample = makeSample(4, 3, [
      [0.02, 0.02, 0.02],
      [0.08, 0.08, 0.08],
      [0.18, 0.18, 0.18],
      [0.5, 0.5, 0.5],
      [0.9, 0.9, 0.9],
      [1.0, 1.0, 1.0],
      [1.2, 1.2, 1.2],
      [1.5, 1.5, 1.5],
      [2.0, 2.0, 2.0],
      [2.5, 2.5, 2.5],
      [3.2, 3.2, 3.2],
      [3.9, 3.9, 3.9],
    ], 4);
    const context = buildInteractiveColorAdjustmentContextFromLinearRgbSample(
      sample,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      true,
      0,
      -100,
    );

    const actual = buildImageEditToneSample(sample, context);
    const expected = buildExactToneSample(sample, context);
    // Localized White must leave deep shadows outside its shoulder untouched.
    expect(actual.data[0]).toBeCloseTo(0.02, 6);
    for (const value of actual.data) {
      expect(value).toBeLessThanOrEqual(1.000001);
    }
    expectSamplesClose(actual, expected, 3);
  });

  test("handles a later start stage while preserving the sample range metadata", () => {
    const sample = makeSample(4, 3, [
      [0.02, 0.03, 0.06],
      [0.11, 0.09, 0.05],
      [0.22, 0.27, 0.14],
      [0.51, 0.47, 0.33],
      [0.85, 0.78, 0.49],
      [1.22, 1.08, 0.78],
      [1.58, 1.46, 1.11],
      [1.95, 1.78, 1.36],
      [2.14, 2.01, 1.58],
      [2.48, 2.36, 1.92],
      [2.88, 2.73, 2.35],
      [3.24, 3.08, 2.84],
    ], 4);
    const context = buildInteractiveColorAdjustmentContextFromLinearRgbSample(
      sample,
      16,
      -8,
      0.5,
      32,
      -28,
      4,
      1.4,
      0,
      0,
      true,
      -12,
      30,
    );
    const prefixSample = buildImageEditPreviewSliderPrefixSample(sample, context, "shadow");

    const actual = buildImageEditToneSample(prefixSample, context, "shadow");
    const expected = buildExactToneSample(prefixSample, context, "shadow");

    expect(prefixSample.linearRangeMax).toBe(4);
    expect(actual.linearRangeMax).toBe(4);
    expectSamplesClose(actual, expected, 3);
  });
});
