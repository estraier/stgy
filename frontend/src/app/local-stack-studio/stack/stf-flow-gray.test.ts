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
