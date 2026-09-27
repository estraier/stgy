import {
  applyLuminanceGainPreservingAboveOneLinearRgbInto,
  applySaturationVibranceAndFinalRolloffLinearRgbInto,
  applyToneAdjustmentsLinearRgbRangeInto,
} from "@/image/tone";
import { buildColorAdjustmentContextFromLinearRgbSample } from "@/components/image-editor/analysis";
import {
  buildImageEditClarityMapFromToneSample,
  sampleImageEditClarityGain,
} from "@/components/image-editor/clarity";
import {
  adjustStackLinearData,
  buildStackClaheMapFromToneAdjusted,
  buildStackToneAdjustedLinearData,
  clampStackScaledLog,
  computeStackFinalRolloff,
} from "./postprocess";

function makeSample(): { data: Float32Array; width: number; height: number } {
  const width = 4;
  const height = 4;
  const values = [
    0.02, 0.04, 0.90,
    0.08, 0.65, 0.04,
    0.72, 0.12, 0.05,
    0.18, 0.20, 0.22,
    0.12, 0.30, 0.74,
    0.25, 0.55, 0.10,
    0.82, 0.18, 0.28,
    0.35, 0.35, 0.35,
    0.03, 0.08, 0.42,
    0.09, 0.48, 0.18,
    0.58, 0.16, 0.08,
    0.44, 0.38, 0.32,
    0.20, 0.14, 0.68,
    0.31, 0.62, 0.16,
    0.76, 0.30, 0.12,
    0.60, 0.58, 0.54,
  ];
  return { data: Float32Array.from(values), width, height };
}

function expectArraysClose(actual: Float32Array, expected: Float32Array, digits = 6): void {
  expect(actual.length).toBe(expected.length);
  for (let i = 0; i < actual.length; i += 1) {
    expect(actual[i]).toBeCloseTo(expected[i], digits);
  }
}

describe("Local Stack Studio shared Tone/Color pipeline", () => {
  test("Midtone uses the same +/-20 clamp as Local Image Studio", () => {
    expect(clampStackScaledLog(30)).toBe(20);
    expect(clampStackScaledLog(-30)).toBe(-20);
    expect(clampStackScaledLog(12.34)).toBe(12.3);
  });

  test("Tone stages match the Local Image Studio shared implementation", () => {
    const sample = makeSample();
    const exposure = 0.8;
    const shadow = 43;
    const highlight = -37;
    const midtone = 11.7;
    const contrast = 3.6;
    const context = buildColorAdjustmentContextFromLinearRgbSample(
      sample,
      0,
      0,
      exposure,
      shadow,
      highlight,
      midtone,
      contrast,
      0,
      0,
    );
    const expected = new Float32Array(sample.data.length);
    const adjusted: [number, number, number] = [0, 0, 0];
    for (let i = 0; i < sample.data.length; i += 3) {
      applyToneAdjustmentsLinearRgbRangeInto(
        sample.data[i],
        sample.data[i + 1],
        sample.data[i + 2],
        context,
        "exposure",
        "black",
        adjusted,
      );
      expected[i] = adjusted[0];
      expected[i + 1] = adjusted[1];
      expected[i + 2] = adjusted[2];
    }

    const actual = buildStackToneAdjustedLinearData(
      sample.data,
      sample.width,
      sample.height,
      exposure,
      shadow,
      highlight,
      midtone,
      contrast,
    );
    expectArraysClose(actual, expected, 6);
  });

  test("Exposure remains a pure RGB multiplier until the final display rolloff", () => {
    const source = Float32Array.from([0.9, 0.4, 0.2]);
    const actual = buildStackToneAdjustedLinearData(source, 1, 1, 1, 0, 0, 0, 0);
    expect(actual[0]).toBeCloseTo(1.8, 6);
    expect(actual[1]).toBeCloseTo(0.8, 6);
    expect(actual[2]).toBeCloseTo(0.4, 6);
  });

  test("cached Tone stage boundaries compose to the same shared full result", () => {
    const sample = makeSample();
    const settings = [0.7, 31, -24, 9.4, 3.1] as const;
    const full = buildStackToneAdjustedLinearData(
      sample.data,
      sample.width,
      sample.height,
      settings[0],
      settings[1],
      settings[2],
      settings[3],
      settings[4],
    );
    const stages = ["exposure", "logarithm", "sigmoid", "shadow"] as const;
    for (const stage of stages) {
      const prefix = buildStackToneAdjustedLinearData(
        sample.data,
        sample.width,
        sample.height,
        settings[0],
        settings[1],
        settings[2],
        settings[3],
        settings[4],
        "source",
        stage,
      );
      const resumed = buildStackToneAdjustedLinearData(
        prefix,
        sample.width,
        sample.height,
        settings[0],
        settings[1],
        settings[2],
        settings[3],
        settings[4],
        stage,
        "highlight",
      );
      expectArraysClose(resumed, full, 5);
    }
  });

  test("final display clipping remains present even with all sliders at zero", () => {
    const source = Float32Array.from([1.2, 0.4, 0.2]);
    const actual = adjustStackLinearData(source, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0);
    expect(actual[0]).toBeCloseTo(1, 7);
    expect(actual[1]).toBeCloseTo(0.4, 7);
    expect(actual[2]).toBeCloseTo(0.2, 7);
  });

  function expectClarityMapMatches(clarity: number): void {
    const sample = makeSample();
    const toneAdjusted = buildStackToneAdjustedLinearData(
      sample.data,
      sample.width,
      sample.height,
      0.4,
      25,
      -20,
      6,
      2,
    );
    const expected = buildImageEditClarityMapFromToneSample(
      { data: toneAdjusted, width: sample.width, height: sample.height, linearRangeMax: 1 },
      clarity,
    );
    const actual = buildStackClaheMapFromToneAdjusted(
      toneAdjusted,
      sample.width,
      sample.height,
      clarity,
    );
    expect(actual).not.toBeNull();
    expect(expected).not.toBeNull();
    expect(actual!.strength).toBe(expected!.strength);
    expectArraysClose(actual!.gain, expected!.gain, 7);
  }

  test("positive Clarity uses the exact shared LIS map", () => {
    expectClarityMapMatches(70);
  });

  test("negative Clarity uses the exact shared LIS map", () => {
    expectClarityMapMatches(-65);
  });

  test("final LSS output matches LIS Tone + Clarity + Color + final rolloff", () => {
    const sample = makeSample();
    const exposure = 0.6;
    const shadow = 35;
    const highlight = -28;
    const midtone = 8;
    const contrast = 2.5;
    const clarity = 55;
    const vibrance = 30;
    const saturation = 25;

    const context = buildColorAdjustmentContextFromLinearRgbSample(
      sample,
      0,
      0,
      exposure,
      shadow,
      highlight,
      midtone,
      contrast,
      vibrance,
      saturation,
    );
    const toneAdjusted = buildStackToneAdjustedLinearData(
      sample.data,
      sample.width,
      sample.height,
      exposure,
      shadow,
      highlight,
      midtone,
      contrast,
    );
    const clarityMap = buildImageEditClarityMapFromToneSample(
      { data: toneAdjusted, width: sample.width, height: sample.height, linearRangeMax: 1 },
      clarity,
    );
    expect(clarityMap).not.toBeNull();

    const expected = new Float32Array(toneAdjusted.length);
    const adjusted: [number, number, number] = [0, 0, 0];
    for (let y = 0; y < sample.height; y += 1) {
      for (let x = 0; x < sample.width; x += 1) {
        const i = (y * sample.width + x) * 3;
        let r = toneAdjusted[i];
        let g = toneAdjusted[i + 1];
        let b = toneAdjusted[i + 2];
        const clarityGain = sampleImageEditClarityGain(
          clarityMap!,
          x + 0.5,
          y + 0.5,
          sample.width,
          sample.height,
        );
        applyLuminanceGainPreservingAboveOneLinearRgbInto(r, g, b, clarityGain, adjusted);
        r = adjusted[0];
        g = adjusted[1];
        b = adjusted[2];
        applySaturationVibranceAndFinalRolloffLinearRgbInto(
          r,
          g,
          b,
          saturation,
          vibrance,
          true,
          context.finalRolloff,
          context.saturationRolloff,
          adjusted,
        );
        expected[i] = adjusted[0];
        expected[i + 1] = adjusted[1];
        expected[i + 2] = adjusted[2];
      }
    }

    const lssRolloff = computeStackFinalRolloff(
      sample.data,
      exposure,
      shadow,
      highlight,
      midtone,
      contrast,
      vibrance,
      saturation,
    );
    const actual = adjustStackLinearData(
      sample.data,
      sample.width,
      sample.height,
      exposure,
      shadow,
      highlight,
      midtone,
      contrast,
      clarity,
      vibrance,
      saturation,
      clarityMap,
      "srgb",
      lssRolloff,
    );
    expectArraysClose(actual, expected, 5);
  });
});
