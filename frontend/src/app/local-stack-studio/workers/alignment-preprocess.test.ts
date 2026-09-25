import {
  applyAlignmentExposureToGrayBytes,
  positiveExposureOrNull,
  prepareAlignmentExposurePair,
} from "./alignment-preprocess";

describe("alignment exposure preprocessing", () => {
  test("uses the geometric midpoint for metadata exposure matching", () => {
    const reference = new Uint8Array([32, 64, 96, 128]);
    const target = new Uint8Array([64, 96, 128, 160]);
    const result = prepareAlignmentExposurePair(reference, target, 1, 4);

    expect(result.exposureMatchSource).toBe("metadata");
    expect(result.referenceExposureGain).toBeCloseTo(2, 12);
    expect(result.targetExposureGain).toBeCloseTo(0.5, 12);
  });

  test("falls back to image statistics when metadata exposure is incomplete", () => {
    const reference = new Uint8Array([16, 32, 48, 64, 80, 96]);
    const target = new Uint8Array([32, 64, 96, 128, 160, 192]);
    const result = prepareAlignmentExposurePair(reference, target, null, 2);

    expect(result.exposureMatchSource).toBe("image-statistics");
    expect(result.referenceExposureGain).toBeGreaterThan(1);
    expect(result.targetExposureGain).toBeLessThan(1);
  });

  test("identity exposure preprocessing preserves ordinary 8-bit values", () => {
    const input = new Uint8Array([0, 1, 16, 64, 128, 192, 254, 255]);
    expect(Array.from(applyAlignmentExposureToGrayBytes(input, 1))).toEqual(Array.from(input));
  });

  test("exposure validation rejects non-positive and non-finite values", () => {
    expect(positiveExposureOrNull(1.5)).toBe(1.5);
    expect(positiveExposureOrNull(0)).toBeNull();
    expect(positiveExposureOrNull(-1)).toBeNull();
    expect(positiveExposureOrNull(Number.POSITIVE_INFINITY)).toBeNull();
    expect(positiveExposureOrNull("invalid")).toBeNull();
  });
});
