import {
  analyzeDefringeSample,
  applyDefringeLinearRgb,
  sampleDefringeConfidence,
} from "./defringe";
import {
  PROPHOTO_TONE_LUMA_B,
  PROPHOTO_TONE_LUMA_G,
  PROPHOTO_TONE_LUMA_R,
} from "@/image/tone";

function makeUniformSample(width: number, height: number, rgb: [number, number, number]) {
  const data = new Float32Array(width * height * 3);
  for (let i = 0; i < width * height; i += 1) {
    const di = i * 3;
    data[di] = rgb[0];
    data[di + 1] = rgb[1];
    data[di + 2] = rgb[2];
  }
  return { data, width, height };
}

function luma(rgb: [number, number, number]): number {
  return PROPHOTO_TONE_LUMA_R * rgb[0]
    + PROPHOTO_TONE_LUMA_G * rgb[1]
    + PROPHOTO_TONE_LUMA_B * rgb[2];
}

function chromaMagnitude(rgb: [number, number, number]): number {
  const y = luma(rgb);
  return Math.hypot(rgb[0] - y, rgb[1] - y, rgb[2] - y);
}

describe("Defringe", () => {
  test("does not flag a uniform green field as a fringe", () => {
    const map = analyzeDefringeSample(makeUniformSample(64, 48, [0.18, 0.45, 0.18]));
    let max = 0;
    for (const value of map.magenta) max = Math.max(max, value);
    for (const value of map.green) max = Math.max(max, value);
    expect(max).toBe(0);
  });

  test("detects a local magenta residual on a luminance structure", () => {
    const width = 96;
    const height = 64;
    const sample = makeUniformSample(width, height, [0.28, 0.28, 0.28]);
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const i = (y * width + x) * 3;
        const shade = x < width / 2 ? 0.78 : 1.18;
        sample.data[i] *= shade;
        sample.data[i + 1] *= shade;
        sample.data[i + 2] *= shade;
        if (x >= width / 2 - 2 && x <= width / 2 + 2) {
          sample.data[i] += 0.08;
          sample.data[i + 1] -= 0.03;
          sample.data[i + 2] += 0.08;
        }
      }
    }
    const map = analyzeDefringeSample(sample);
    const center = Math.floor(height / 2) * width + Math.floor(width / 2);
    expect(map.magenta[center] ?? 0).toBeGreaterThan(map.green[center] ?? 0);
    expect(map.magenta[center] ?? 0).toBeGreaterThan(0);
  });

  test("detects green separately from magenta", () => {
    const width = 96;
    const height = 64;
    const sample = makeUniformSample(width, height, [0.28, 0.28, 0.28]);
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const i = (y * width + x) * 3;
        const shade = x < width / 2 ? 0.82 : 1.16;
        sample.data[i] *= shade;
        sample.data[i + 1] *= shade;
        sample.data[i + 2] *= shade;
        if (x >= width / 2 - 2 && x <= width / 2 + 2) {
          sample.data[i] -= 0.05;
          sample.data[i + 1] += 0.08;
          sample.data[i + 2] -= 0.05;
        }
      }
    }
    const map = analyzeDefringeSample(sample);
    const center = Math.floor(height / 2) * width + Math.floor(width / 2);
    expect(map.green[center] ?? 0).toBeGreaterThan(map.magenta[center] ?? 0);
    expect(map.green[center] ?? 0).toBeGreaterThan(0);
  });

  test("uses expand1 up to mid strength and expand2 at high strength", () => {
    const map = {
      width: 1,
      height: 1,
      magenta: new Uint8Array([0]),
      green: new Uint8Array([0]),
      magentaExpanded1: new Uint8Array([128]),
      greenExpanded1: new Uint8Array([128]),
      magentaExpanded2: new Uint8Array([255]),
      greenExpanded2: new Uint8Array([255]),
    };
    const low = sampleDefringeConfidence(map, 0.5, 0.5, 0.25);
    const mid = sampleDefringeConfidence(map, 0.5, 0.5, 0.5);
    const high = sampleDefringeConfidence(map, 0.5, 0.5, 1.0);
    expect(low.magenta).toBeCloseTo(0.251, 2);
    expect(mid.magenta).toBeCloseTo(128 / 255, 3);
    expect(high.magenta).toBeCloseTo(1, 6);
    expect(high.green).toBeGreaterThan(mid.green);
    expect(high.green).toBeLessThan(high.magenta);
  });

  test("preserves ProPhoto luminance and hue by desaturating toward neutral", () => {
    const map = {
      width: 2,
      height: 2,
      magenta: new Uint8Array([255, 255, 255, 255]),
      green: new Uint8Array(4),
    };
    const before: [number, number, number] = [0.62, 0.28, 0.57];
    const beforeY = luma(before);
    const beforeChroma: [number, number, number] = [
      before[0] - beforeY,
      before[1] - beforeY,
      before[2] - beforeY,
    ];
    const after = applyDefringeLinearRgb(before[0], before[1], before[2], map, 0.8, 0.5, 0.5);
    const afterY = luma(after);
    expect(afterY).toBeCloseTo(beforeY, 6);
    expect(chromaMagnitude(after)).toBeLessThan(chromaMagnitude(before));
    const scales = beforeChroma.map((value, index) => Math.abs(value) > 1e-6
      ? (after[index] - afterY) / value
      : 1);
    expect(scales[0]).toBeCloseTo(scales[1], 6);
    expect(scales[1]).toBeCloseTo(scales[2], 6);
    expect(scales[0]).toBeGreaterThanOrEqual(0);
  });

  test("green correction is deliberately weaker than magenta correction", () => {
    const magentaMap = {
      width: 1,
      height: 1,
      magenta: new Uint8Array([255]),
      green: new Uint8Array([0]),
    };
    const greenMap = {
      width: 1,
      height: 1,
      magenta: new Uint8Array([0]),
      green: new Uint8Array([255]),
    };
    const magentaBefore: [number, number, number] = [0.62, 0.22, 0.62];
    const greenBefore: [number, number, number] = [0.22, 0.62, 0.22];
    const magentaAfter = applyDefringeLinearRgb(...magentaBefore, magentaMap, 1, 0.5, 0.5);
    const greenAfter = applyDefringeLinearRgb(...greenBefore, greenMap, 1, 0.5, 0.5);
    const magentaRemaining = chromaMagnitude(magentaAfter) / chromaMagnitude(magentaBefore);
    const greenRemaining = chromaMagnitude(greenAfter) / chromaMagnitude(greenBefore);
    expect(magentaRemaining).toBeLessThan(greenRemaining);
  });

  test("magenta confidence does not desaturate a blue pixel outside the hue range", () => {
    const map = {
      width: 1,
      height: 1,
      magenta: new Uint8Array([255]),
      green: new Uint8Array([0]),
    };
    const before: [number, number, number] = [0.12, 0.12, 0.62];
    const after = applyDefringeLinearRgb(...before, map, 1, 0.5, 0.5);
    expect(after[0]).toBeCloseTo(before[0], 6);
    expect(after[1]).toBeCloseTo(before[1], 6);
    expect(after[2]).toBeCloseTo(before[2], 6);
  });
});
