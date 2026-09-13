import type { ImageEditOutputColorProfile } from "./types";
import { getCanvas2dContext, getCanvasImageData } from "./canvas";
import { decodeStoredRgb16Channel, encodeStoredRgb16Channel } from "./sampling";
import {
  clamp01,
  clampSharpen,
  linearChannelToSrgb,
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
  const scratch = new Float32Array(pixelCount);
  const kernel = buildSharpenGaussianKernel(preset.radius, preset.sigma);
  const half = Math.floor(kernel.length / 2);

  const readLinear = (index: number): number => srgbChannelToLinear(values[index] ?? 0);
  const writeLinear = (index: number, value: number) => {
    values[index] = linearChannelToSrgb(clamp01(value));
  };

  for (let channel = 0; channel < 3; channel++) {
    for (let y = 0; y < height; y++) {
      const row = y * width;
      for (let x = 0; x < width; x++) {
        let sum = 0;
        for (let k = -half; k <= half; k++) {
          const sx = sharpenReflect101Index(x + k, width);
          sum += readLinear((row + sx) * 4 + channel) * kernel[k + half];
        }
        scratch[row + x] = sum;
      }
    }

    for (let y = 0; y < height; y++) {
      const row = y * width;
      for (let x = 0; x < width; x++) {
        let blurred = 0;
        for (let k = -half; k <= half; k++) {
          const sy = sharpenReflect101Index(y + k, height);
          blurred += scratch[sy * width + x] * kernel[k + half];
        }
        const index = (row + x) * 4 + channel;
        const originalLinear = readLinear(index);
        const diff = originalLinear - blurred;
        const sharpenedLinear = Math.abs(diff) > preset.threshold
          ? originalLinear + preset.amount * diff
          : originalLinear;
        writeLinear(index, sharpenedLinear);
      }
    }
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
  const scratch = new Float32Array(pixelCount);
  const kernel = buildSharpenGaussianKernel(preset.radius, preset.sigma);
  const half = Math.floor(kernel.length / 2);

  for (let channel = 0; channel < 3; channel += 1) {
    for (let y = 0; y < height; y += 1) {
      const row = y * width;
      for (let x = 0; x < width; x += 1) {
        let sum = 0;
        for (let k = -half; k <= half; k += 1) {
          const sx = sharpenReflect101Index(x + k, width);
          const sampleIndex = (row + sx) * 3 + channel;
          sum += decodeStoredRgb16Channel(data[sampleIndex] ?? 0, "gamma20", 1) * kernel[k + half];
        }
        scratch[row + x] = sum;
      }
    }

    for (let y = 0; y < height; y += 1) {
      const row = y * width;
      for (let x = 0; x < width; x += 1) {
        let blurred = 0;
        for (let k = -half; k <= half; k += 1) {
          const sy = sharpenReflect101Index(y + k, height);
          blurred += scratch[sy * width + x] * kernel[k + half];
        }
        const index = (row + x) * 3 + channel;
        const originalLinear = decodeStoredRgb16Channel(data[index] ?? 0, "gamma20", 1);
        const diff = originalLinear - blurred;
        const sharpenedLinear = Math.abs(diff) > preset.threshold
          ? originalLinear + preset.amount * diff
          : originalLinear;
        data[index] = encodeStoredRgb16Channel(clamp01(sharpenedLinear), "gamma20", 1);
      }
    }
  }
}
