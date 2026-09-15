import type { ImageEditOutputColorProfile } from "./types";
import { getCanvas2dContext, getCanvasImageData } from "./canvas";
import { decodeStoredRgb16Channel, encodeStoredRgb16Channel } from "./sampling";
import {
  clamp01,
  clampSharpen,
  linearChannelToSrgb,
  PROPHOTO_TONE_LUMA_B,
  PROPHOTO_TONE_LUMA_G,
  PROPHOTO_TONE_LUMA_R,
  srgbChannelToLinear,
} from "@/image/tone";

type SharpenPreset = {
  radius: number;
  sigma: number;
  amount: number;
  threshold: number;
};

const SHARPEN_PRESETS: Record<1 | 2 | 3, SharpenPreset> = {
  1: { radius: 1, sigma: 0.8, amount: 1.5, threshold: 0.01 },
  2: { radius: 2, sigma: 1.0, amount: 1.2, threshold: 0.03 },
  3: { radius: 3, sigma: 1.5, amount: 1.5, threshold: 0.03 },
};


const SRGB_LUMA_R = 0.2126;
const SRGB_LUMA_G = 0.7152;
const SRGB_LUMA_B = 0.0722;
const SHARPEN_LUMA_EPSILON = 1e-6;

function applySharpenToLumaField(
  luma: Float32Array,
  width: number,
  height: number,
  kernel: Float32Array,
  amount: number,
  threshold: number,
): Float32Array {
  const pixelCount = width * height;
  const scratch = new Float32Array(pixelCount);
  const blurred = new Float32Array(pixelCount);
  const half = Math.floor(kernel.length / 2);

  for (let y = 0; y < height; y += 1) {
    const row = y * width;
    for (let x = 0; x < width; x += 1) {
      let sum = 0;
      for (let k = -half; k <= half; k += 1) {
        const sx = sharpenReflect101Index(x + k, width);
        sum += luma[row + sx] * kernel[k + half];
      }
      scratch[row + x] = sum;
    }
  }

  for (let y = 0; y < height; y += 1) {
    const row = y * width;
    for (let x = 0; x < width; x += 1) {
      let sum = 0;
      for (let k = -half; k <= half; k += 1) {
        const sy = sharpenReflect101Index(y + k, height);
        sum += scratch[sy * width + x] * kernel[k + half];
      }
      blurred[row + x] = sum;
    }
  }

  const sharpened = new Float32Array(pixelCount);
  for (let i = 0; i < pixelCount; i += 1) {
    const originalLuma = luma[i] ?? 0;
    const diff = originalLuma - (blurred[i] ?? 0);
    sharpened[i] = Math.abs(diff) > threshold
      ? originalLuma + amount * diff
      : originalLuma;
  }
  return sharpened;
}

function sharpenReflect101Index(index: number, length: number): number {
  if (length <= 1) return 0;
  let i = index;
  while (i < 0 || i >= length) {
    if (i < 0) i = -i;
    if (i >= length) i = 2 * length - i - 2;
  }
  return i;
}

function buildSharpenGaussianKernel(radius: number, sigma: number): Float32Array {
  const ksize = Math.ceil(2 * radius) + 1;
  const half = Math.floor(ksize / 2);
  const kernel = new Float32Array(ksize);
  const sigma2 = 2 * sigma * sigma;
  let sum = 0;
  for (let i = -half; i <= half; i++) {
    const weight = Math.exp(-(i * i) / sigma2);
    kernel[i + half] = weight;
    sum += weight;
  }
  if (sum > 0) {
    for (let i = 0; i < kernel.length; i++) kernel[i] /= sum;
  }
  return kernel;
}

export function applySharpenToCanvas(
  canvas: HTMLCanvasElement | OffscreenCanvas,
  level: number,
  outputColorProfile: ImageEditOutputColorProfile = "srgb",
): void {
  const sharpen = clampSharpen(level);
  if (sharpen === 0) return;
  const preset = SHARPEN_PRESETS[sharpen as 1 | 2 | 3];
  const ctx = getCanvas2dContext(canvas, outputColorProfile, true);
  if (!ctx) return;
  const width = canvas.width;
  const height = canvas.height;
  if (!width || !height) return;
  const imageData = getCanvasImageData(ctx, 0, 0, width, height, outputColorProfile);
  const values = imageData.data;
  const pixelCount = width * height;
  const kernel = buildSharpenGaussianKernel(preset.radius, preset.sigma);

  const readLinear = (index: number): number => srgbChannelToLinear(values[index] ?? 0);
  const writeLinear = (index: number, value: number) => {
    values[index] = linearChannelToSrgb(clamp01(value));
  };

  const luma = new Float32Array(pixelCount);
  for (let i = 0; i < pixelCount; i += 1) {
    const index = i * 4;
    const r = readLinear(index);
    const g = readLinear(index + 1);
    const b = readLinear(index + 2);
    luma[i] = SRGB_LUMA_R * r + SRGB_LUMA_G * g + SRGB_LUMA_B * b;
  }

  const sharpenedLuma = applySharpenToLumaField(
    luma,
    width,
    height,
    kernel,
    preset.amount,
    preset.threshold,
  );

  for (let i = 0; i < pixelCount; i += 1) {
    const index = i * 4;
    const r = readLinear(index);
    const g = readLinear(index + 1);
    const b = readLinear(index + 2);
    const originalLuma = luma[i] ?? 0;
    const targetLuma = Math.max(0, sharpenedLuma[i] ?? 0);
    const scale = originalLuma > SHARPEN_LUMA_EPSILON ? targetLuma / originalLuma : 1;
    writeLinear(index, r * scale);
    writeLinear(index + 1, g * scale);
    writeLinear(index + 2, b * scale);
  }

  ctx.putImageData(imageData, 0, 0);
}

export function applySharpenToRgb16(
  data: Uint16Array,
  width: number,
  height: number,
  level: number,
): void {
  const sharpen = clampSharpen(level);
  if (sharpen === 0 || width <= 0 || height <= 0) return;
  const preset = SHARPEN_PRESETS[sharpen as 1 | 2 | 3];
  const pixelCount = width * height;
  const kernel = buildSharpenGaussianKernel(preset.radius, preset.sigma);
  const luma = new Float32Array(pixelCount);

  for (let i = 0; i < pixelCount; i += 1) {
    const index = i * 3;
    const r = decodeStoredRgb16Channel(data[index] ?? 0, "gamma20", 1);
    const g = decodeStoredRgb16Channel(data[index + 1] ?? 0, "gamma20", 1);
    const b = decodeStoredRgb16Channel(data[index + 2] ?? 0, "gamma20", 1);
    luma[i] = PROPHOTO_TONE_LUMA_R * r + PROPHOTO_TONE_LUMA_G * g + PROPHOTO_TONE_LUMA_B * b;
  }

  const sharpenedLuma = applySharpenToLumaField(
    luma,
    width,
    height,
    kernel,
    preset.amount,
    preset.threshold,
  );

  for (let i = 0; i < pixelCount; i += 1) {
    const index = i * 3;
    const r = decodeStoredRgb16Channel(data[index] ?? 0, "gamma20", 1);
    const g = decodeStoredRgb16Channel(data[index + 1] ?? 0, "gamma20", 1);
    const b = decodeStoredRgb16Channel(data[index + 2] ?? 0, "gamma20", 1);
    const originalLuma = luma[i] ?? 0;
    const targetLuma = Math.max(0, sharpenedLuma[i] ?? 0);
    const scale = originalLuma > SHARPEN_LUMA_EPSILON ? targetLuma / originalLuma : 1;
    data[index] = encodeStoredRgb16Channel(clamp01(r * scale), "gamma20", 1);
    data[index + 1] = encodeStoredRgb16Channel(clamp01(g * scale), "gamma20", 1);
    data[index + 2] = encodeStoredRgb16Channel(clamp01(b * scale), "gamma20", 1);
  }
}
