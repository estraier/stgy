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
  test("extends the nearest covered colors across horizontal margins", () => {
    const width = 4;
    const height = 1;
    const rgb = new Uint16Array([
      10, 20, 30,
      0, 0, 0,
      0, 0, 0,
      90, 100, 110,
    ]);
    const coverage = new Uint8Array([1, 0, 0, 1]);
    fillPanoramaMarginsFromMask(rgb, coverage, width, height, new Uint32Array(width * height));
    expect(Array.from(rgb)).toEqual([
      10, 20, 30,
      10, 20, 30,
      90, 100, 110,
      90, 100, 110,
    ]);
    expect(Array.from(coverage)).toEqual([1, 1, 1, 1]);
  });

  test("fills diagonal exterior margins without changing covered pixels", () => {
    const width = 3;
    const height = 3;
    const rgb = new Uint16Array(width * height * 3);
    const center = (1 * width + 1) * 3;
    rgb[center] = 123;
    rgb[center + 1] = 456;
    rgb[center + 2] = 789;
    const coverage = new Uint8Array(width * height);
    coverage[4] = 1;
    fillPanoramaMarginsFromMask(rgb, coverage, width, height, new Uint32Array(width * height));
    for (let index = 0; index < width * height; index += 1) {
      const offset = index * 3;
      expect(Array.from(rgb.subarray(offset, offset + 3))).toEqual([123, 456, 789]);
    }
  });
});
