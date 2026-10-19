import { estimatePanoramaCompositingResolutionMpx } from "./panorama-scale";

describe("panorama output scaling", () => {
  test("converts a cropped probe panorama into a composition resolution", () => {
    // A 0.5 MP/reference probe that produces a 2 MP panorama predicts a
    // 40 MP full-size panorama when the reference input is 10 MP.
    expect(estimatePanoramaCompositingResolutionMpx({
      probeCompositingResolutionMpx: 0.5,
      probeOutputPixels: 2_000_000,
      referenceInputPixels: 10_000_000,
      maxOutputPixels: 16_000_000,
    })).toBeCloseTo(4, 8);
  });

  test("keeps original composition when the requested target exceeds the estimate", () => {
    expect(estimatePanoramaCompositingResolutionMpx({
      probeCompositingResolutionMpx: 0.5,
      probeOutputPixels: 2_000_000,
      referenceInputPixels: 10_000_000,
      maxOutputPixels: 64_000_000,
    })).toBe(-1);
  });

  test("uses the full reference size when the probe cap exceeds a small input", () => {
    expect(estimatePanoramaCompositingResolutionMpx({
      probeCompositingResolutionMpx: 0.5,
      probeOutputPixels: 600_000,
      referenceInputPixels: 250_000,
      maxOutputPixels: 300_000,
    })).toBeCloseTo(0.125, 8);
  });
});
