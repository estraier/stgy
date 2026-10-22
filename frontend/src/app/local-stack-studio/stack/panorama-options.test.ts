import {
  DEFAULT_PANORAMA_DOWNSCALE_MEGAPIXELS,
  DEFAULT_PANORAMA_FINISH_MODE,
  PANORAMA_FINISH_MODES,
  PANORAMA_DOWNSCALE_MEGAPIXELS,
  isSupportedPanoramaDownscaleMegapixels,
  parsePanoramaDownscaleMegapixels,
  parsePanoramaFinishMode,
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

describe("Panorama Finish options", () => {
  test("keeps Trim as the default", () => {
    expect(DEFAULT_PANORAMA_FINISH_MODE).toBe("trim");
    expect(PANORAMA_FINISH_MODES).toEqual(["trim", "fill"]);
  });

  test("accepts Trim and Fill case-insensitively", () => {
    expect(parsePanoramaFinishMode("trim")).toBe("trim");
    expect(parsePanoramaFinishMode("Trim")).toBe("trim");
    expect(parsePanoramaFinishMode("fill")).toBe("fill");
    expect(parsePanoramaFinishMode("FILL")).toBe("fill");
    expect(parsePanoramaFinishMode("crop")).toBeUndefined();
  });
});
