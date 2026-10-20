import {
  DEFAULT_PANORAMA_DOWNSCALE_MEGAPIXELS,
  PANORAMA_DOWNSCALE_MEGAPIXELS,
  isSupportedPanoramaDownscaleMegapixels,
  parsePanoramaDownscaleMegapixels,
} from "./panorama-options";

describe("Panorama Downscale options", () => {
  test("keeps 16MP as the default", () => {
    expect(DEFAULT_PANORAMA_DOWNSCALE_MEGAPIXELS).toBe(16);
  });

  test("contains every supported megapixel target", () => {
    expect(PANORAMA_DOWNSCALE_MEGAPIXELS).toEqual([4, 6, 8, 12, 16, 24, 32, 48, 64]);
  });

  test.each(PANORAMA_DOWNSCALE_MEGAPIXELS)("accepts %i and its MP label", (megapixels) => {
    expect(isSupportedPanoramaDownscaleMegapixels(megapixels)).toBe(true);
    expect(parsePanoramaDownscaleMegapixels(String(megapixels))).toBe(megapixels);
    expect(parsePanoramaDownscaleMegapixels(`${megapixels}MP`)).toBe(megapixels);
  });

  test("accepts none and rejects unsupported values", () => {
    expect(parsePanoramaDownscaleMegapixels("none")).toBeNull();
    expect(isSupportedPanoramaDownscaleMegapixels(10)).toBe(false);
    expect(parsePanoramaDownscaleMegapixels("10MP")).toBeUndefined();
    expect(parsePanoramaDownscaleMegapixels("24 megapixels")).toBeUndefined();
  });
});
