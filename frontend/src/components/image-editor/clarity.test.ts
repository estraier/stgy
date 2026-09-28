import { buildImageEditPreviewSliderPrefixSample } from "./render";
import { buildImageEditClarityMapFromToneSample, buildImageEditToneSample } from "./clarity";
import { buildInteractiveColorAdjustmentContextFromLinearRgbSample } from "./analysis";
import {
  applyLuminanceGainPreservingAboveOneLinearRgb,
  applyToneAdjustmentsLinearRgbRange,
  buildToneAdjustmentGamma20GainLut,
  sampleToneAdjustmentGamma20GainLut,
  TONE_GAMMA20_GAIN_LUT_FINAL_SIZE,
  TONE_GAMMA20_GAIN_LUT_PREVIEW_SIZE,
  proPhotoLinearLuminance,
  toneLinearIntensity,
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
  test("uses fixed preview/final Tone LUT densities without adaptive cells", () => {
    const sample = makeSample(2, 1, [
      [0.5, 0.5, 0.5],
      [1, 1, 1],
    ], 4);
    const context = buildInteractiveColorAdjustmentContextFromLinearRgbSample(
      sample,
      0, 0, 0, 0, -100, 0, 0, 0, 0, true, 0, 0,
    );
    const previewLut = buildToneAdjustmentGamma20GainLut(
      context, "white-balance", "after-tone", 4, TONE_GAMMA20_GAIN_LUT_PREVIEW_SIZE,
    );
    const finalLut = buildToneAdjustmentGamma20GainLut(
      context, "white-balance", "after-tone", 4, TONE_GAMMA20_GAIN_LUT_FINAL_SIZE,
    );
    expect(previewLut).not.toBeNull();
    expect(finalLut).not.toBeNull();
    // RAW range 0..4 adds one fixed endpoint-alignment sample so T=1 is exact.
    expect(previewLut?.values).toHaveLength(4097);
    expect(finalLut?.values).toHaveLength(16385);
    expect((previewLut as unknown as { adaptiveCells?: unknown }).adaptiveCells).toBe(undefined);
    expect((finalLut as unknown as { adaptiveCells?: unknown }).adaptiveCells).toBe(undefined);
    expect(sampleToneAdjustmentGamma20GainLut(previewLut!, 1)).toBeCloseTo(1, 12);
    expect(sampleToneAdjustmentGamma20GainLut(finalLut!, 1)).toBeCloseTo(1, 12);
  });

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

  test("integrates Exposure into the shared Tone LUT without an Exposure-specific rolloff", () => {
    const sample = makeSample(3, 1, [
      [0.1, 0.05, 0.025],
      [0.5, 0.25, 0.125],
      [1.2, 0.6, 0.3],
    ], 4);
    const context = buildInteractiveColorAdjustmentContextFromLinearRgbSample(
      sample,
      0,
      0,
      1,
      0,
      0,
      0,
      0,
      0,
      0,
      true,
    );

    const actual = buildImageEditToneSample(sample, context);
    const expected = buildExactToneSample(sample, context);
    expectSamplesClose(actual, expected, 4);
    expect(actual.data[0]).toBeCloseTo(0.2, 4);
    expect(actual.data[3]).toBeCloseTo(1.0, 4);
    expect(actual.data[6]).toBeCloseTo(2.4, 4);
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

  test("matches direct tone for negative White extended-highlight rescue", () => {
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
    for (const value of actual.data) {
      expect(Number.isFinite(value)).toBe(true);
    }
    // Full negative White preserves the [0,1] mirror and then rescues every
    // value above display white to 1 in its independent post-process.
    for (const value of actual.data) {
      expect(value).toBeLessThanOrEqual(1.000001);
    }
    expectSamplesClose(actual, expected, 3);
  });

  test("keeps steep zero/white boundaries inside the shared Tone LUT", () => {
    const sample = makeSample(5, 3, [
      [0.00000001, 0.00000001, 0.00000001],
      [0.000001, 0.000001, 0.000001],
      [0.0001, 0.0001, 0.0001],
      [0.01, 0.01, 0.01],
      [0.5, 0.5, 0.5],
      [0.98, 0.98, 0.98],
      [0.995, 0.995, 0.995],
      [0.997, 0.997, 0.997],
      [0.999, 0.999, 0.999],
      [1.0, 1.0, 1.0],
      [1.0001, 1.0001, 1.0001],
      [1.01, 1.01, 1.01],
      [1.2, 1.2, 1.2],
      [2.0, 2.0, 2.0],
      [3.9, 3.9, 3.9],
    ], 4);
    const context = buildInteractiveColorAdjustmentContextFromLinearRgbSample(
      sample,
      0,
      0,
      0,
      100,
      -100,
      0,
      0,
      0,
      0,
      true,
      100,
      -100,
    );

    const lut = buildToneAdjustmentGamma20GainLut(
      context,
      "white-balance",
      "after-tone",
      sample.linearRangeMax,
    );
    expect(lut).not.toBeNull();
    expect(lut?.values).toHaveLength(4097);
    expect(lut?.endStage).toBe("after-tone");

    const actual = buildImageEditToneSample(sample, context);
    const expected = buildExactToneSample(sample, context);
    expectSamplesClose(actual, expected, 3);
    expect(actual.data[9 * 3]).toBeCloseTo(1, 6);
  });

  test("keeps a negative Highlight shoulder inside the shared Tone LUT", () => {
    const sample = makeSample(4, 3, [
      [0.9, 0.9, 0.9],
      [0.97, 0.97, 0.97],
      [0.99, 0.99, 0.99],
      [0.995, 0.995, 0.995],
      [0.997, 0.997, 0.997],
      [0.999, 0.999, 0.999],
      [1.0, 1.0, 1.0],
      [1.0001, 1.0001, 1.0001],
      [1.01, 1.01, 1.01],
      [1.2, 1.2, 1.2],
      [2.0, 2.0, 2.0],
      [3.9, 3.9, 3.9],
    ], 4);
    const context = buildInteractiveColorAdjustmentContextFromLinearRgbSample(
      sample,
      0,
      0,
      0,
      0,
      -100,
      0,
      0,
      0,
      0,
      true,
      0,
      0,
    );

    const lut = buildToneAdjustmentGamma20GainLut(
      context,
      "white-balance",
      "after-tone",
      sample.linearRangeMax,
    );
    expect(lut).not.toBeNull();
    expect(lut?.values).toHaveLength(4097);
    expect(lut?.endStage).toBe("after-tone");

    const actual = buildImageEditToneSample(sample, context);
    const expected = buildExactToneSample(sample, context);
    expectSamplesClose(actual, expected, 3);
    expect(actual.data[6 * 3]).toBeCloseTo(1, 6);
  });

  test("keeps a steep manual Tone Curve knot inside the shared Tone LUT", () => {
    const sample = makeSample(4, 3, [
      [0.95, 0.95, 0.95],
      [0.97, 0.97, 0.97],
      [0.979, 0.979, 0.979],
      [0.98, 0.98, 0.98],
      [0.981, 0.981, 0.981],
      [0.99, 0.99, 0.99],
      [0.999, 0.999, 0.999],
      [1.0, 1.0, 1.0],
      [1.01, 1.01, 1.01],
      [1.2, 1.2, 1.2],
      [2.0, 2.0, 2.0],
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
      0,
      [{ x: 0.98, y: 0.1 }],
    );

    const lut = buildToneAdjustmentGamma20GainLut(
      context,
      "white-balance",
      "after-tone",
      sample.linearRangeMax,
    );
    expect(lut).not.toBeNull();
    expect(lut?.values).toHaveLength(4097);
    expect(lut?.endStage).toBe("after-tone");

    const actual = buildImageEditToneSample(sample, context);
    const expected = buildExactToneSample(sample, context);
    // A deliberately near-vertical manual knot is allowed the normal fixed-grid
    // interpolation error; adaptive per-cell refinement is intentionally gone.
    expectSamplesClose(actual, expected, 2);
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
  test("bakes the tone curve directly into the shared Tone LUT", () => {
    const sample = makeSample(4, 3, [
      [0.0008, 0.0008, 0.0008],
      [0.01, 0.01, 0.01],
      [0.03, 0.03, 0.03],
      [0.05, 0.05, 0.05],
      [0.08, 0.08, 0.08],
      [0.12, 0.12, 0.12],
      [0.2, 0.2, 0.2],
      [0.35, 0.35, 0.35],
      [0.5, 0.5, 0.5],
      [0.7, 0.7, 0.7],
      [0.9, 0.9, 0.9],
      [1.2, 1.2, 1.2],
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
      0,
      [
        { x: 0.0008, y: 0.05 },
        { x: 0.05, y: 0.08 },
        { x: 0.5, y: 0.7 },
      ],
    );

    const actual = buildImageEditToneSample(sample, context);
    const expected = buildExactToneSample(sample, context);
    expectSamplesClose(actual, expected, 3);
    // Values above display white remain identity in the Tone Curve stage.
    expect(actual.data[33]).toBeCloseTo(1.2, 3);
  });

});


describe("Clarity Tone intensity", () => {
  test("uses the shared 3:5:2 axis for negative Clarity and the >1 boundary", () => {
    const sample = makeSample(3, 1, [
      [0, 0, 0],
      [0, 1.5, 0],
      [0, 0, 0],
    ], 4);

    // This saturated green is above display white in colorimetric ProPhoto Y,
    // but remains below white on the shared editorial Tone axis. Clarity must
    // therefore process it, just like the Tone controls do.
    expect(proPhotoLinearLuminance(0, 1.5, 0)).toBeGreaterThan(1);
    expect(toneLinearIntensity(0, 1.5, 0)).toBeCloseTo(0.75, 12);

    const map = buildImageEditClarityMapFromToneSample(sample, -100);
    expect(map).not.toBeNull();
    const gain = map?.gain[1] ?? 1;
    expect(gain).toBeCloseTo(0.35 / 0.75, 6);

    const adjusted = applyLuminanceGainPreservingAboveOneLinearRgb(0, 1.5, 0, gain);
    expect(adjusted[0]).toBeCloseTo(0, 12);
    expect(adjusted[1]).toBeCloseTo(0.7, 6);
    expect(adjusted[2]).toBeCloseTo(0, 12);
  });

  test("gives equal positive-CLAHE gain to colors with equal 3:5:2 intensity", () => {
    const sample = makeSample(4, 1, [
      [2 / 3, 0, 0], // 0.3 * 2/3 = 0.2
      [0, 0, 1],     // 0.2 * 1   = 0.2
      [0.4, 0.4, 0.4],
      [0.8, 0.8, 0.8],
    ], 1);

    const map = buildImageEditClarityMapFromToneSample(sample, 100);
    expect(map).not.toBeNull();
    expect(map?.gain[0] ?? 0).toBeCloseTo(map?.gain[1] ?? 0, 6);
  });
});
