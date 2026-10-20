import { choosePanoramaComposeScale } from "./panorama-scale";

describe("choosePanoramaComposeScale", () => {
  test("uses projected union area and measured crop ratio", () => {
    // A 40 MP spherical union with a 50% valid crop estimates a 20 MP final
    // panorama. Targeting about 5 MP therefore needs half the linear scale.
    expect(choosePanoramaComposeScale({
      fullUnionPixels: 40_000_000,
      cropRatio: 0.5,
      maxOutputPixels: 5_000_000,
    })).toBeCloseTo(0.5, 12);
  });

  test("keeps full composition when the estimated cropped result already fits", () => {
    expect(choosePanoramaComposeScale({
      fullUnionPixels: 20_000_000,
      cropRatio: 0.5,
      maxOutputPixels: 16_000_000,
    })).toBe(1);
  });

  test("none keeps full composition", () => {
    expect(choosePanoramaComposeScale({
      fullUnionPixels: 100_000_000,
      cropRatio: 0.4,
      maxOutputPixels: null,
    })).toBe(1);
  });

  test("invalid estimation falls back to full composition", () => {
    expect(choosePanoramaComposeScale({
      fullUnionPixels: Number.NaN,
      cropRatio: 0.5,
      maxOutputPixels: 16_000_000,
    })).toBe(1);
  });
});
