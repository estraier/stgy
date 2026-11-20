import { stfFlowWorkingSize, stfGamma2RgbToGray8Resampled } from "./stf-flow-gray";

describe("STF Phase 4: shared grayscale must preserve 4MP Flow pixels", () => {
  test("keeps the 4MP working-size rounding and short-circuit", () => {
    expect(stfFlowWorkingSize(5184, 3888)).toEqual({ width: 2309, height: 1732 });
    expect(stfFlowWorkingSize(7, 3)).toEqual({ width: 7, height: 3 });
  });

  test("agrees with independent pixel-center RGB16 resampling, including dark/highlight pixels", () => {
    const width = 11, height = 9, targetWidth = 7, targetHeight = 5;
    const src = new Uint16Array(width * height * 3);
    for (let i = 0; i < src.length; i++) src[i] = (i * 17389 + i * i * 43) % 65536;
    const actual = stfGamma2RgbToGray8Resampled(src, width, height, targetWidth, targetHeight, 2);
    const originalGray = (r: number, g: number, b: number) => {
      const a = [r,g,b].map((v) => Math.min(65535, Math.round(v * 2)));
      return Math.max(0, Math.min(255, Math.round((a[0] * 0.299 + a[1] * 0.587 + a[2] * 0.114) / 257)));
    };
    const expected: number[] = [];
    for (let y = 0; y < targetHeight; y++) {
      for (let x = 0; x < targetWidth; x++) {
        const sy = Math.max(0, Math.min(height - 1, (y + .5) * height / targetHeight - .5));
        const sx = Math.max(0, Math.min(width - 1, (x + .5) * width / targetWidth - .5));
        const x0 = Math.floor(sx), y0 = Math.floor(sy), x1 = Math.min(width - 1, x0 + 1), y1 = Math.min(height - 1, y0 + 1);
        const fx = sx - x0, fy = sy - y0;
        const sample = (px: number, py: number) => originalGray(...Array.from(src.slice((py * width + px) * 3, (py * width + px) * 3 + 3)) as [number,number,number]);
        const a = sample(x0,y0) * (1 - fx) * (1 - fy);
        const b = sample(x1,y0) * fx * (1 - fy);
        const c = sample(x0,y1) * (1 - fx) * fy;
        const d = sample(x1,y1) * fx * fy;
        expected.push(Math.max(0, Math.min(255, Math.round(a+b+c+d))));
      }
    }
    expect(Array.from(actual)).toEqual(expected);
  });

  test("no-resize path keeps uint8 normalization and exact length", () => {
    const src = new Uint16Array([0, 0, 0, 65535, 65535, 65535]);
    expect(Array.from(stfGamma2RgbToGray8Resampled(src, 2, 1, 2, 1, 2))).toEqual([0, 255]);
    expect(() => stfGamma2RgbToGray8Resampled(src, 3, 1, 3, 1, 2)).toThrow();
  });
});

describe("STF Gray8 precomputed resampling coordinates", () => {
  function resampleWithoutLookup(source: Uint16Array, sw: number, sh: number,
    tw: number, th: number, encodingScale: number): Uint8Array {
    const result = new Uint8Array(tw * th);
    const sample = (x: number, y: number): number => {
      const index = (y * sw + x) * 3;
      const r = Math.min(65535, Math.round(source[index] * encodingScale));
      const g = Math.min(65535, Math.round(source[index + 1] * encodingScale));
      const b = Math.min(65535, Math.round(source[index + 2] * encodingScale));
      return Math.max(0, Math.min(255, Math.round((r * 0.299 + g * 0.587 + b * 0.114) / 257)));
    };
    for (let y = 0; y < th; y += 1) {
      const sy = Math.max(0, Math.min(sh - 1, th === 1 ? 0 : (y + 0.5) * sh / th - 0.5));
      const y0 = Math.floor(sy), y1 = Math.min(sh - 1, y0 + 1), fy = sy - y0;
      for (let x = 0; x < tw; x += 1) {
        const sx = Math.max(0, Math.min(sw - 1, tw === 1 ? 0 : (x + 0.5) * sw / tw - 0.5));
        const x0 = Math.floor(sx), x1 = Math.min(sw - 1, x0 + 1), fx = sx - x0;
        const w00 = (1 - fx) * (1 - fy), w10 = fx * (1 - fy);
        const w01 = (1 - fx) * fy, w11 = fx * fy;
        const luminance = sample(x0, y0) * w00 + sample(x1, y0) * w10
          + sample(x0, y1) * w01 + sample(x1, y1) * w11;
        result[y * tw + x] = Math.max(0, Math.min(255, Math.round(luminance)));
      }
    }
    return result;
  }

  test("preserves every Gray8 byte for varying shapes, borders, scales and repeated frames", () => {
    const sizes = [
      [1, 1, 1, 2], [1, 8, 6, 3], [8, 1, 3, 7], [8, 7, 1, 4],
      [7, 8, 4, 1], [17, 13, 9, 7], [17, 13, 30, 23],
      [32, 19, 17, 11], [32, 19, 32, 19], [7, 5, 11, 12],
    ];
    for (const [sw, sh, tw, th] of sizes) {
      for (const encodingScale of [1, 2, 0.7]) {
        for (const seed of [7, 43]) {
          const source = new Uint16Array(sw * sh * 3);
          for (let i = 0; i < source.length; i += 1) {
            source[i] = (i * 17389 + i * i * 43 + seed * 997) % 65536;
          }
          expect(stfGamma2RgbToGray8Resampled(source, sw, sh, tw, th, encodingScale))
            .toEqual(resampleWithoutLookup(source, sw, sh, tw, th, encodingScale));
        }
      }
    }
  });
});
