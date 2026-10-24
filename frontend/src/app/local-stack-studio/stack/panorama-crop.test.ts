import {
  fillPanoramaMarginsFromMask,
  largestValidPanoramaRectFromBgrCoverage,
  largestValidPanoramaRectFromMask,
  panoramaCoverageFromExteriorBlack,
} from "./panorama-crop";

describe("panorama coverage crop", () => {
  test("keeps a completely covered panorama", () => {
    expect(largestValidPanoramaRectFromMask(new Uint8Array(12).fill(1), 4, 3)).toEqual({
      x: 0,
      y: 0,
      width: 4,
      height: 3,
    });
  });

  test("selects the largest all-covered rectangle instead of the coverage bounding box", () => {
    const mask = new Uint8Array([
      0, 0, 1, 1, 0, 0,
      0, 1, 1, 1, 1, 0,
      1, 1, 1, 1, 1, 1,
      0, 1, 1, 1, 1, 0,
      0, 0, 1, 1, 0, 0,
    ]);
    expect(largestValidPanoramaRectFromMask(mask, 6, 5)).toEqual({
      x: 1,
      y: 1,
      width: 4,
      height: 3,
    });
  });

  test("returns null for a completely uncovered panorama", () => {
    expect(largestValidPanoramaRectFromMask(new Uint8Array(20), 5, 4)).toBeNull();
  });

  test("uses coverage pixels rather than panorama RGB content", () => {
    const coverage = new Uint8Array(4 * 3 * 3);
    for (let y = 0; y < 3; y += 1) {
      for (let x = 1; x < 4; x += 1) {
        const offset = (y * 4 + x) * 3;
        coverage[offset] = 255;
        coverage[offset + 1] = 255;
        coverage[offset + 2] = 255;
      }
    }
    expect(largestValidPanoramaRectFromBgrCoverage(coverage, 4, 3)).toEqual({
      x: 1,
      y: 0,
      width: 3,
      height: 3,
    });
  });

  test("treats only border-connected black pixels as fallback panorama margins", () => {
    const width = 6;
    const height = 5;
    const image = new Uint8Array(width * height * 3).fill(80);
    const black = (x: number, y: number) => {
      const offset = (y * width + x) * 3;
      image[offset] = 0;
      image[offset + 1] = 0;
      image[offset + 2] = 0;
    };
    black(0, 0);
    black(1, 0);
    black(0, 1);
    black(3, 2);

    const coverage = panoramaCoverageFromExteriorBlack(image, width, height);
    expect(coverage[0]).toBe(0);
    expect(coverage[1]).toBe(0);
    expect(coverage[width]).toBe(0);
    expect(coverage[2 * width + 3]).toBe(1);
  });
});

describe("panorama margin fill", () => {
  test("fills horizontal gaps with a smooth color transition instead of nearest-pixel stripes", () => {
    const width = 5;
    const height = 1;
    const rgb = new Uint16Array([
      1000, 1000, 1000,
      0, 0, 0,
      0, 0, 0,
      0, 0, 0,
      9000, 9000, 9000,
    ]);
    const coverage = new Uint8Array([1, 0, 0, 0, 1]);
    fillPanoramaMarginsFromMask(rgb, coverage, width, height, new Uint32Array(width * height));
    const values = [rgb[0]!, rgb[3]!, rgb[6]!, rgb[9]!, rgb[12]!];
    expect(values[0]).toBe(1000);
    expect(values[4]).toBe(9000);
    expect(values[1]).toBeGreaterThan(values[0]!);
    expect(values[2]).toBeGreaterThan(values[1]!);
    expect(values[3]).toBeGreaterThan(values[2]!);
    expect(values[1]).toBeLessThan(5000);
    expect(values[3]).toBeGreaterThan(5000);
    expect(Array.from(coverage)).toEqual([1, 1, 1, 1, 1]);
  });


  test("keeps the low-frequency fill alive beyond the former 128px blur limit", () => {
    const width = 401;
    const height = 1;
    const rgb = new Uint16Array(width * height * 3);
    const center = Math.floor(width / 2);
    const offset = center * 3;
    rgb[offset] = 12000;
    rgb[offset + 1] = 24000;
    rgb[offset + 2] = 36000;
    const coverage = new Uint8Array(width * height);
    coverage[center] = 1;

    fillPanoramaMarginsFromMask(rgb, coverage, width, height, new Uint32Array(width * height));

    for (let x = 0; x < width; x += 1) {
      const pixel = x * 3;
      expect(rgb[pixel]).toBe(12000);
      expect(rgb[pixel + 1]).toBe(24000);
      expect(rgb[pixel + 2]).toBe(36000);
    }
  });

  test("keeps covered pixels unchanged while filling outward with blended colors", () => {
    const width = 3;
    const height = 3;
    const rgb = new Uint16Array(width * height * 3);
    const setPixel = (x: number, y: number, value: [number, number, number]) => {
      const offset = (y * width + x) * 3;
      rgb[offset] = value[0];
      rgb[offset + 1] = value[1];
      rgb[offset + 2] = value[2];
    };
    setPixel(0, 1, [2000, 0, 0]);
    setPixel(1, 1, [4000, 4000, 0]);
    setPixel(2, 1, [8000, 0, 8000]);
    const coverage = new Uint8Array([
      0, 0, 0,
      1, 1, 1,
      0, 0, 0,
    ]);
    const original = rgb.slice();
    fillPanoramaMarginsFromMask(rgb, coverage, width, height, new Uint32Array(width * height));
    expect(Array.from(rgb.slice(9, 18))).toEqual(Array.from(original.slice(9, 18)));
    for (let x = 0; x < width; x += 1) {
      const top = (0 * width + x) * 3;
      const bottom = (2 * width + x) * 3;
      expect(rgb[top]).toBeGreaterThanOrEqual(2000);
      expect(rgb[top]).toBeLessThanOrEqual(8000);
      expect(rgb[bottom]).toBeGreaterThanOrEqual(2000);
      expect(rgb[bottom]).toBeLessThanOrEqual(8000);
    }
  });
});
