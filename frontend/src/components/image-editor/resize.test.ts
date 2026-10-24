import { resizeGamma20Rgb16Lanczos3 } from "./resize";

describe("resizeGamma20Rgb16Lanczos3", () => {
  test("preserves a constant RGB image during downscale", () => {
    const source = new Uint16Array(12 * 10 * 3);
    for (let i = 0; i < source.length; i += 3) {
      source[i] = 12000;
      source[i + 1] = 32000;
      source[i + 2] = 54000;
    }
    const resized = resizeGamma20Rgb16Lanczos3(source, 12, 10, 5, 4);
    for (let i = 0; i < resized.length; i += 3) {
      expect(resized[i]).toBe(12000);
      expect(resized[i + 1]).toBe(32000);
      expect(resized[i + 2]).toBe(54000);
    }
  });

  test("returns an independent copy for 1:1 resize", () => {
    const source = Uint16Array.from([1, 2, 3, 4, 5, 6]);
    const resized = resizeGamma20Rgb16Lanczos3(source, 2, 1, 2, 1);
    expect(Array.from(resized)).toEqual(Array.from(source));
    expect(resized).not.toBe(source);
  });

  test("suppresses a Nyquist checkerboard when strongly downscaling", () => {
    const width = 24;
    const height = 24;
    const source = new Uint16Array(width * height * 3);
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const value = (x + y) % 2 === 0 ? 0 : 65535;
        const index = (y * width + x) * 3;
        source[index] = value;
        source[index + 1] = value;
        source[index + 2] = value;
      }
    }
    const resized = resizeGamma20Rgb16Lanczos3(source, width, height, 6, 6);
    for (const value of resized) {
      expect(value).toBeGreaterThan(26000);
      expect(value).toBeLessThan(39500);
    }
  });

  test("keeps channels aligned with identical spatial weights", () => {
    const width = 9;
    const height = 7;
    const source = new Uint16Array(width * height * 3);
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const base = 1000 + x * 1800 + y * 900;
        const index = (y * width + x) * 3;
        source[index] = base;
        source[index + 1] = Math.min(65535, base * 2);
        source[index + 2] = Math.min(65535, base * 3);
      }
    }
    const resized = resizeGamma20Rgb16Lanczos3(source, width, height, 5, 4);
    for (let i = 0; i < resized.length; i += 3) {
      expect(Math.abs((resized[i + 1] ?? 0) - 2 * (resized[i] ?? 0))).toBeLessThanOrEqual(2);
      expect(Math.abs((resized[i + 2] ?? 0) - 3 * (resized[i] ?? 0))).toBeLessThanOrEqual(3);
    }
  });
});
