import {
  applyPanoramaGainBgrInPlace,
  estimatePanoramaGainMaps,
  samplePanoramaGainBgr,
  samplePanoramaGainBgrInto,
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

  test("uses bright and clipped observations when matching exposure", () => {
    const width = 64;
    const height = 64;
    const first = new Float32Array(width * height * 3).fill(240);
    const second = new Float32Array(width * height * 3).fill(255);
    const mask = new Uint8Array(width * height).fill(255);
    const maps = estimatePanoramaGainMaps([
      { cornerX: 0, cornerY: 0, width, height, bgr: first, mask },
      { cornerX: 0, cornerY: 0, width, height, bgr: second, mask },
    ]);
    const firstGain = samplePanoramaGainBgr(maps[0]!, 16, 16, width, height, 0);
    const secondGain = samplePanoramaGainBgr(maps[1]!, 16, 16, width, height, 0);
    expect(firstGain).toBeGreaterThan(1);
    expect(secondGain).toBeLessThan(1);
    expect(240 * firstGain).toBeCloseTo(255 * secondGain, 4);
  });

  test("estimates different gains for a bright sky and a darker ground", () => {
    const width = 64;
    const height = 128;
    const first = new Float32Array(width * height * 3);
    const second = new Float32Array(width * height * 3);
    const mask = new Uint8Array(width * height).fill(255);
    for (let y = 0; y < height; y += 1) {
      const isSky = y < height / 2;
      for (let x = 0; x < width; x += 1) {
        const offset = (y * width + x) * 3;
        for (let channel = 0; channel < 3; channel += 1) {
          first[offset + channel] = isSky ? 255 : 80;
          second[offset + channel] = isSky ? 240 : 88;
        }
      }
    }
    const maps = estimatePanoramaGainMaps([
      { cornerX: 0, cornerY: 0, width, height, bgr: first, mask },
      { cornerX: 0, cornerY: 0, width, height, bgr: second, mask },
    ]);
    const skyGain = samplePanoramaGainBgr(maps[0]!, 16, 8, width, height, 0);
    const groundGain = samplePanoramaGainBgr(maps[0]!, 16, 120, width, height, 0);
    expect(skyGain).toBeLessThan(1);
    expect(groundGain).toBeGreaterThan(1);
  });

});

describe("panorama joint local exposure optimization", () => {
  test("preserves unclipped linear highlights when matching a bright sky", () => {
    const width = 96;
    const height = 64;
    const mask = new Uint8Array(width * height).fill(255);
    const first = new Float32Array(width * height * 3).fill(0.70);
    const second = new Float32Array(width * height * 3).fill(1.20);
    const maps = estimatePanoramaGainMaps([
      { cornerX: 0, cornerY: 0, width, height, bgr: first, mask },
      { cornerX: 0, cornerY: 0, width, height, bgr: second, mask },
    ]);
    for (const x of [1, 16, 31, 32, 48, 72, 95]) {
      for (const y of [0, 16, 32, 63]) {
        const gainA = samplePanoramaGainBgr(maps[0]!, x, y, width, height, 0);
        const gainB = samplePanoramaGainBgr(maps[1]!, x, y, width, height, 0);
        expect(0.70 * gainA).toBeCloseTo(1.20 * gainB, 3);
        expect(0.70 * gainA).toBeCloseTo(Math.sqrt(0.70 * 1.20), 2);
      }
    }
  });

  test("jointly matches three overlapping images across locally varying RGB gains", () => {
    const width = 128;
    const height = 128;
    const corners = [0, 32, 64];
    const mask = new Uint8Array(width * height).fill(255);
    const images = corners.map((cornerX, index) => {
      const bgr = new Float32Array(width * height * 3);
      for (let y = 0; y < height; y += 1) {
        for (let x = 0; x < width; x += 1) {
          const globalX = cornerX + x;
          const scene = 0.5 + 0.0008 * globalX + 0.0006 * y;
          const vertical = y / height;
          const gains = [
            [1.0 + 0.08 * vertical, 0.96 + 0.05 * vertical, 1.04 - 0.03 * vertical],
            [1.20 - 0.16 * vertical, 1.12 - 0.08 * vertical, 0.91 + 0.06 * vertical],
            [0.86 + 0.16 * vertical, 0.89 + 0.11 * vertical, 1.19 - 0.12 * vertical],
          ][index]!;
          for (let channel = 0; channel < 3; channel += 1) {
            bgr[(y * width + x) * 3 + channel] = scene * gains[channel]!;
          }
        }
      }
      return { cornerX, cornerY: 0, width, height, bgr, mask };
    });
    const maps = estimatePanoramaGainMaps(images);
    let before = 0;
    let after = 0;
    let samples = 0;
    for (let i = 0; i < 3; i += 1) {
      for (let j = i + 1; j < 3; j += 1) {
        for (let y = 8; y < height; y += 8) {
          for (let globalX = corners[j]! + 8; globalX < corners[i]! + width - 8; globalX += 8) {
            const xA = globalX - corners[i]!;
            const xB = globalX - corners[j]!;
            for (let channel = 0; channel < 3; channel += 1) {
              const a = images[i]!.bgr[(y * width + xA) * 3 + channel]!;
              const b = images[j]!.bgr[(y * width + xB) * 3 + channel]!;
              const correctedA = a * samplePanoramaGainBgr(maps[i]!, xA, y, width, height, channel);
              const correctedB = b * samplePanoramaGainBgr(maps[j]!, xB, y, width, height, channel);
              before += Math.abs(Math.log(a / b));
              after += Math.abs(Math.log(correctedA / correctedB));
              samples += 1;
            }
          }
        }
      }
    }
    expect(after / samples).toBeLessThan(0.025);
    expect(after).toBeLessThan(before * 0.2);
  });

  test("constrains gains smoothly across tile boundaries", () => {
    const width = 160;
    const height = 160;
    const mask = new Uint8Array(width * height).fill(255);
    const first = new Float32Array(width * height * 3).fill(0.5);
    const second = new Float32Array(width * height * 3);
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const gain = 1.04 + 0.22 * y / height;
        for (let channel = 0; channel < 3; channel += 1) {
          second[(y * width + x) * 3 + channel] = 0.5 * gain;
        }
      }
    }
    const maps = estimatePanoramaGainMaps([
      { cornerX: 0, cornerY: 0, width, height, bgr: first, mask },
      { cornerX: 0, cornerY: 0, width, height, bgr: second, mask },
    ]);
    for (let y = 2; y < height; y += 1) {
      const g0 = samplePanoramaGainBgr(maps[0]!, 48, y - 1, width, height, 0);
      const g1 = samplePanoramaGainBgr(maps[0]!, 48, y, width, height, 0);
      expect(Math.abs(g1 - g0)).toBeLessThan(0.025);
    }
  });
  test("uses the same gain interpolation for the Graph Cut proxy and final compose", () => {
    const width = 96;
    const height = 64;
    const mask = new Uint8Array(width * height).fill(255);
    const a = new Float32Array(width * height * 3).fill(0.5);
    const b = new Float32Array(width * height * 3);
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const offset = (y * width + x) * 3;
        b[offset] = 0.5 + y * 0.002;
        b[offset + 1] = 0.6 + x * 0.001;
        b[offset + 2] = 0.7 + y * 0.001;
      }
    }
    const maps = estimatePanoramaGainMaps([
      { cornerX: 0, cornerY: 0, width, height, bgr: a, mask },
      { cornerX: 0, cornerY: 0, width, height, bgr: b, mask },
    ]);
    const gains = new Float32Array(3);
    for (let y = 0; y < height; y += 9) {
      for (let x = 0; x < width; x += 11) {
        samplePanoramaGainBgrInto(maps[0]!, x, y, width, height, gains);
        for (let channel = 0; channel < 3; channel += 1) {
          expect(gains[channel]).toBeCloseTo(
            samplePanoramaGainBgr(maps[0]!, x, y, width, height, channel), 5,
          );
        }
      }
    }
  });

  test("ignores masked-out differences rather than introducing spurious exposure gains", () => {
    const width = 64;
    const height = 64;
    const first = new Float32Array(width * height * 3).fill(0.6);
    const second = new Float32Array(width * height * 3).fill(1.2);
    const firstMask = new Uint8Array(width * height).fill(255);
    const secondMask = new Uint8Array(width * height);
    const maps = estimatePanoramaGainMaps([
      { cornerX: 0, cornerY: 0, width, height, bgr: first, mask: firstMask },
      { cornerX: 0, cornerY: 0, width, height, bgr: second, mask: secondMask },
    ]);
    expect(samplePanoramaGainBgr(maps[0]!, 10, 10, width, height, 0)).toBeCloseTo(1, 6);
    expect(samplePanoramaGainBgr(maps[1]!, 10, 10, width, height, 2)).toBeCloseTo(1, 6);
  });
});
