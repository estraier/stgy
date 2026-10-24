import {
  PANORAMA_ALIGNMENT_PASSES,
  appendGamma2PanoramaAlignmentGray,
  applyPanoramaAlignmentExposureGain,
  boostPanoramaAlignmentDetailInPlace,
  panoramaAlignmentExposureGain,
} from "./panorama-alignment";

function storedGamma20(linear: number, range = 4): number {
  return Math.round(Math.sqrt(Math.max(0, Math.min(1, linear / range))) * 65535);
}

describe("panorama alignment preprocessing", () => {
  test("builds gamma-2 grayscale directly from canonical gamma-2 RGB storage", () => {
    const white = storedGamma20(1);
    const mid = storedGamma20(0.25);
    const stored = new Uint16Array([
      0, 0, 0,
      white, white, white,
      mid, mid, mid,
    ]);
    const gray = new Uint8Array(3);
    const histogram = new Uint32Array(256);
    appendGamma2PanoramaAlignmentGray(stored, gray, 0, 4, histogram);
    expect(gray[0]).toBe(0);
    expect(gray[1]).toBe(255);
    expect(gray[2]).toBeCloseTo(128, 0);
    expect(histogram[0]).toBe(1);
    expect(histogram[255]).toBe(1);
  });

  test("normalizes exposure with a bounded robust percentile gain", () => {
    const histogram = new Uint32Array(256);
    histogram[100] = 95;
    histogram[200] = 5;
    const gain = panoramaAlignmentExposureGain(histogram);
    expect(gain).toBeCloseTo(2.24, 6);

    const gray = new Uint8Array([0, 50, 100, 200]);
    applyPanoramaAlignmentExposureGain(gray, gain);
    expect(Array.from(gray)).toEqual([0, 112, 224, 255]);
  });

  test("boosts weak local detail without changing flat regions", () => {
    const gray = new Uint8Array([
      100, 100, 100,
      100, 112, 100,
      100, 100, 100,
    ]);
    boostPanoramaAlignmentDetailInPlace(gray, 3, 3);
    expect(gray[4]).toBeGreaterThan(112);
    expect(gray[0]).toBe(100);
  });

  test("uses progressively stronger wrapped-Stitcher retry passes", () => {
    expect(PANORAMA_ALIGNMENT_PASSES.map((pass) => pass.id)).toEqual([
      "gamma2-orb",
      "clahe-orb",
      "clahe-detail-orb",
      "clahe-detail-orb-relaxed",
    ]);
    expect(PANORAMA_ALIGNMENT_PASSES[0]).toMatchObject({
      registrationMegapixels: 1.5,
      panoConfidence: 0.70,
      useClahe: false,
      useDetailBoost: false,
    });
    expect(PANORAMA_ALIGNMENT_PASSES[1]).toMatchObject({
      registrationMegapixels: 2.0,
      panoConfidence: 0.55,
      useClahe: true,
      useDetailBoost: false,
    });
    expect(PANORAMA_ALIGNMENT_PASSES[2]).toMatchObject({
      registrationMegapixels: 3.0,
      panoConfidence: 0.40,
      useClahe: true,
      useDetailBoost: true,
    });
    expect(PANORAMA_ALIGNMENT_PASSES[3]).toMatchObject({
      registrationMegapixels: 4.0,
      panoConfidence: 0.25,
      useClahe: true,
      useDetailBoost: true,
    });
    expect(new Set(PANORAMA_ALIGNMENT_PASSES.map((pass) => pass.rngSeed)).size).toBe(4);
  });
});
