import {
  resolveStfRelativeBrightnessP50Divisor,
  resolveStfRelativeCombineMode,
  resolveStfGateClosingMode,
  usesStfRelative3Sharpness,
  usesStfRelative5Sharpness,
  usesStfInterpolatedGate,
} from "./stf-additional-blur-mode";

describe("STF Additional blur sharpness selection", () => {
  test("sigmoid, dilated, and weak/medium/strong use relative5 P50/16 and weighted RMS", () => {
    for (const mode of [null, "sigmoid", "dilated", "raw-ratio-relative5", "interpolated", "volume-interpolated", "volume-interpolated-2"]) {
      expect(usesStfRelative5Sharpness(mode)).toBe(true);
      expect(usesStfRelative3Sharpness(mode)).toBe(false);
      expect(resolveStfRelativeBrightnessP50Divisor(mode)).toBe(16);
      expect(resolveStfRelativeCombineMode(mode)).toBe("rms");
    }
  });

  test("sigmoid, dilated and production blur use Volume Closing 2", () => {
    for (const mode of [null, "sigmoid", "dilated"]) {
      expect(usesStfInterpolatedGate(mode)).toBe(true);
      expect(resolveStfGateClosingMode(mode)).toBe("volume2");
    }
  });

  test("Area and Volume comparison modes remain independent", () => {
    expect(usesStfInterpolatedGate("interpolated")).toBe(true);
    expect(resolveStfGateClosingMode("interpolated")).toBe("area");
    for (const mode of [
      "volume-interpolated", "volume-interpolated-2", "coarse-sharpness",
      "fine-sharpness", "raw-ratio", "raw-ratio-p50", "raw-ratio-p50-8",
      "raw-ratio-relative", "raw-ratio-relative2", "raw-ratio-relative3",
      "raw-ratio-relative4", "raw-ratio-relative5",
    ]) {
      expect(usesStfInterpolatedGate(mode)).toBe(false);
      expect(resolveStfGateClosingMode(mode)).toBeNull();
    }
  });

  test("relative3 stays P50/4 with weighted arithmetic mean", () => {
    expect(usesStfRelative3Sharpness("raw-ratio-relative3")).toBe(true);
    expect(usesStfRelative5Sharpness("raw-ratio-relative3")).toBe(false);
    expect(resolveStfRelativeBrightnessP50Divisor("raw-ratio-relative3")).toBe(4);
    expect(resolveStfRelativeCombineMode("raw-ratio-relative3")).toBe("mean");
  });

  test("relative4 stays P50/8 with weighted arithmetic mean", () => {
    expect(usesStfRelative5Sharpness("raw-ratio-relative4")).toBe(false);
    expect(resolveStfRelativeBrightnessP50Divisor("raw-ratio-relative4")).toBe(8);
    expect(resolveStfRelativeCombineMode("raw-ratio-relative4")).toBe("mean");
  });

  test("preserves fixed-floor comparisons and absolute sharpness modes", () => {
    for (const mode of ["raw-ratio-relative", "raw-ratio-relative2"]) {
      expect(resolveStfRelativeBrightnessP50Divisor(mode)).toBeNull();
      expect(resolveStfRelativeCombineMode(mode)).toBe("mean");
      expect(usesStfRelative5Sharpness(mode)).toBe(false);
    }
    for (const mode of ["coarse-sharpness", "fine-sharpness", "raw-ratio", "raw-ratio-p50", "raw-ratio-p50-8"]) {
      expect(resolveStfRelativeBrightnessP50Divisor(mode)).toBeNull();
      expect(resolveStfRelativeCombineMode(mode)).toBeNull();
      expect(usesStfRelative5Sharpness(mode)).toBe(false);
    }
  });
});
