import {
  applyPanoramaGainBgrInPlace,
  estimatePanoramaGainMaps,
  samplePanoramaGainBgr,
} from "./panorama-exposure";

describe("panorama exposure compensation", () => {
  test("moves two overlapping images symmetrically toward the same exposure and white balance", () => {
    const width = 64;
    const height = 64;
    const first = new Float32Array(width * height * 3);
    const second = new Float32Array(width * height * 3);
    const mask = new Uint8Array(width * height).fill(255);
    for (let pixel = 0; pixel < width * height; pixel += 1) {
      first[pixel * 3] = 80;
      first[pixel * 3 + 1] = 100;
      first[pixel * 3 + 2] = 120;
      second[pixel * 3] = 120;
      second[pixel * 3 + 1] = 90;
      second[pixel * 3 + 2] = 96;
    }
    const maps = estimatePanoramaGainMaps([
      { cornerX: 0, cornerY: 0, width, height, bgr: first, mask },
      { cornerX: 0, cornerY: 0, width, height, bgr: second, mask },
    ]);
    const adjustedFirst = first.slice();
    const adjustedSecond = second.slice();
    applyPanoramaGainBgrInPlace(adjustedFirst, width, height, maps[0]!);
    applyPanoramaGainBgrInPlace(adjustedSecond, width, height, maps[1]!);
    for (let channel = 0; channel < 3; channel += 1) {
      expect(adjustedFirst[channel]).toBeCloseTo(adjustedSecond[channel], 3);
    }
  });

  test("keeps gains neutral when images do not overlap", () => {
    const width = 32;
    const height = 32;
    const image = new Float32Array(width * height * 3).fill(100);
    const mask = new Uint8Array(width * height).fill(255);
    const maps = estimatePanoramaGainMaps([
      { cornerX: 0, cornerY: 0, width, height, bgr: image, mask },
      { cornerX: 100, cornerY: 0, width, height, bgr: image, mask },
    ]);
    expect(samplePanoramaGainBgr(maps[0]!, 10, 10, width, height, 0)).toBeCloseTo(1, 6);
    expect(samplePanoramaGainBgr(maps[1]!, 10, 10, width, height, 2)).toBeCloseTo(1, 6);
  });
});
