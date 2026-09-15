import type { ImageEditOutputColorProfile, ImageInputColorProfile } from "./types";
import { getCanvas2dContext, getCanvasImageData } from "./canvas";
import { decodeStoredRgb16Channel, encodeStoredRgb16Channel } from "./sampling";
import {
  encodedRgbToLinearProphotoInto,
  convertLinearProPhotoToOutputRgbInto,
} from "@/image/color";
import {
  linearChannelToSrgb,
  PROPHOTO_TONE_LUMA_B,
  PROPHOTO_TONE_LUMA_G,
  PROPHOTO_TONE_LUMA_R,
} from "@/image/tone";

const DENOISE_TILE_SIZE = 384;
const DENOISE_MAX_NOISE_SAMPLES = 65_536;
const DENOISE_MAD_NORMALIZER = 0.67448975;
const DENOISE_SIGMAS = [0.8, 1.6, 3.2] as const;
const DENOISE_MAX_RADIUS = Math.ceil(DENOISE_SIGMAS[DENOISE_SIGMAS.length - 1] * 3);

// Unit vectors spanning the zero-luminance ProPhoto chroma plane.
const GM_R = 0.6798135;
const GM_G = -0.2751496;
const GM_B = 0.6798135;
const BY_R = 0.6302122;
const BY_G = -0.25490968;
const BY_B = -0.73338505;

const LUMA_THRESHOLDS = [1.5, 1.0, 0.55] as const;
const CHROMA_THRESHOLDS = [3.0, 2.0, 1.0] as const;

export function clampDenoise(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(100, Math.max(0, Math.round(value)));
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function reflect101Index(index: number, length: number): number {
  if (length <= 1) return 0;
  let value = index;
  while (value < 0 || value >= length) {
    if (value < 0) value = -value;
    if (value >= length) value = 2 * length - 2 - value;
  }
  return value;
}

function gaussianKernel(sigma: number): Float32Array {
  const radius = Math.max(1, Math.ceil(sigma * 3));
  const kernel = new Float32Array(radius * 2 + 1);
  const sigma2 = 2 * sigma * sigma;
  let sum = 0;
  for (let i = -radius; i <= radius; i += 1) {
    const weight = Math.exp(-(i * i) / sigma2);
    kernel[i + radius] = weight;
    sum += weight;
  }
  for (let i = 0; i < kernel.length; i += 1) kernel[i] /= sum;
  return kernel;
}

const DENOISE_KERNELS = DENOISE_SIGMAS.map(gaussianKernel);

function blurScalar(
  input: Float32Array,
  width: number,
  height: number,
  kernel: Float32Array,
): Float32Array {
  const radius = Math.floor(kernel.length / 2);
  const scratch = new Float32Array(input.length);
  const output = new Float32Array(input.length);
  for (let y = 0; y < height; y += 1) {
    const row = y * width;
    for (let x = 0; x < width; x += 1) {
      let sum = 0;
      for (let k = -radius; k <= radius; k += 1) {
        sum += (input[row + reflect101Index(x + k, width)] ?? 0) * (kernel[k + radius] ?? 0);
      }
      scratch[row + x] = sum;
    }
  }
  for (let y = 0; y < height; y += 1) {
    const row = y * width;
    for (let x = 0; x < width; x += 1) {
      let sum = 0;
      for (let k = -radius; k <= radius; k += 1) {
        sum += (scratch[reflect101Index(y + k, height) * width + x] ?? 0) * (kernel[k + radius] ?? 0);
      }
      output[row + x] = sum;
    }
  }
  return output;
}

function softThreshold(value: number, threshold: number): number {
  if (!(threshold > 0)) return value;
  const magnitude = Math.abs(value);
  if (magnitude <= threshold) return 0;
  return Math.sign(value) * (magnitude - threshold);
}

function denoisePlane(
  input: Float32Array,
  width: number,
  height: number,
  sigmaNoise: number,
  strength: number,
  chroma: boolean,
): Float32Array {
  if (!(sigmaNoise > 0) || !(strength > 0)) return input.slice();
  const blur1 = blurScalar(input, width, height, DENOISE_KERNELS[0]);
  const blur2 = blurScalar(input, width, height, DENOISE_KERNELS[1]);
  const blur3 = blurScalar(input, width, height, DENOISE_KERNELS[2]);
  const multipliers = chroma ? CHROMA_THRESHOLDS : LUMA_THRESHOLDS;
  const t1 = sigmaNoise * strength * multipliers[0];
  const t2 = sigmaNoise * strength * multipliers[1];
  const t3 = sigmaNoise * strength * multipliers[2];
  const output = new Float32Array(input.length);
  for (let i = 0; i < output.length; i += 1) {
    const source = input[i] ?? 0;
    const b1 = blur1[i] ?? source;
    const b2 = blur2[i] ?? b1;
    const b3 = blur3[i] ?? b2;
    output[i] = b3
      + softThreshold(b2 - b3, t3)
      + softThreshold(b1 - b2, t2)
      + softThreshold(source - b1, t1);
  }
  return output;
}

type RgbBuffer = [number, number, number];
type LinearRgbReader = (x: number, y: number, output: RgbBuffer) => void;
type LinearRgbWriter = (x: number, y: number, r: number, g: number, b: number) => void;

function componentsFromRgbInto(r: number, g: number, b: number, output: RgbBuffer): void {
  const y = PROPHOTO_TONE_LUMA_R * r + PROPHOTO_TONE_LUMA_G * g + PROPHOTO_TONE_LUMA_B * b;
  const cr = r - y;
  const cg = g - y;
  const cb = b - y;
  output[0] = y;
  output[1] = GM_R * cr + GM_G * cg + GM_B * cb;
  output[2] = BY_R * cr + BY_G * cg + BY_B * cb;
}

function median(values: number[]): number {
  if (!values.length) return 0;
  values.sort((a, b) => a - b);
  const middle = Math.floor(values.length / 2);
  return values.length % 2
    ? values[middle] ?? 0
    : ((values[middle - 1] ?? 0) + (values[middle] ?? 0)) * 0.5;
}

function estimateNoiseSigmas(width: number, height: number, read: LinearRgbReader): [number, number, number] {
  if (width < 2 || height < 2) return [0, 0, 0];
  const step = Math.max(2, Math.ceil(Math.sqrt((width * height) / DENOISE_MAX_NOISE_SAMPLES)));
  const yResiduals: number[] = [];
  const gmResiduals: number[] = [];
  const byResiduals: number[] = [];
  const rgb: RgbBuffer = [0, 0, 0];
  const c00: RgbBuffer = [0, 0, 0];
  const c10: RgbBuffer = [0, 0, 0];
  const c01: RgbBuffer = [0, 0, 0];
  const c11: RgbBuffer = [0, 0, 0];
  const readComponents = (x: number, y: number, output: RgbBuffer) => {
    read(x, y, rgb);
    componentsFromRgbInto(rgb[0], rgb[1], rgb[2], output);
  };
  for (let y = 0; y < height - 1; y += step) {
    for (let x = 0; x < width - 1; x += step) {
      readComponents(x, y, c00);
      readComponents(x + 1, y, c10);
      readComponents(x, y + 1, c01);
      readComponents(x + 1, y + 1, c11);
      for (let channel = 0; channel < 3; channel += 1) {
        const hh = 0.5 * (
          (c00[channel] ?? 0)
          - (c10[channel] ?? 0)
          - (c01[channel] ?? 0)
          + (c11[channel] ?? 0)
        );
        if (channel === 0) yResiduals.push(Math.abs(hh));
        else if (channel === 1) gmResiduals.push(Math.abs(hh));
        else byResiduals.push(Math.abs(hh));
      }
    }
  }
  return [
    Math.min(0.2, median(yResiduals) / DENOISE_MAD_NORMALIZER),
    Math.min(0.3, median(gmResiduals) / DENOISE_MAD_NORMALIZER),
    Math.min(0.3, median(byResiduals) / DENOISE_MAD_NORMALIZER),
  ];
}

function denoiseLinearImage(
  width: number,
  height: number,
  amount: number,
  read: LinearRgbReader,
  write: LinearRgbWriter,
): void {
  const normalizedAmount = clampDenoise(amount) / 100;
  if (!(normalizedAmount > 0) || width <= 0 || height <= 0) return;
  // 50 is the intended normal operating point; 100 deliberately over-smooths.
  const strength = normalizedAmount * 2;
  const noiseSigma = estimateNoiseSigmas(width, height, read);
  if (!(noiseSigma[0] > 0 || noiseSigma[1] > 0 || noiseSigma[2] > 0)) return;

  for (let coreY = 0; coreY < height; coreY += DENOISE_TILE_SIZE) {
    const coreH = Math.min(DENOISE_TILE_SIZE, height - coreY);
    const extY0 = Math.max(0, coreY - DENOISE_MAX_RADIUS);
    const extY1 = Math.min(height, coreY + coreH + DENOISE_MAX_RADIUS);
    for (let coreX = 0; coreX < width; coreX += DENOISE_TILE_SIZE) {
      const coreW = Math.min(DENOISE_TILE_SIZE, width - coreX);
      const extX0 = Math.max(0, coreX - DENOISE_MAX_RADIUS);
      const extX1 = Math.min(width, coreX + coreW + DENOISE_MAX_RADIUS);
      const extW = extX1 - extX0;
      const extH = extY1 - extY0;
      const pixels = extW * extH;
      const yPlane = new Float32Array(pixels);
      const gmPlane = new Float32Array(pixels);
      const byPlane = new Float32Array(pixels);

      const rgb: RgbBuffer = [0, 0, 0];
      const components: RgbBuffer = [0, 0, 0];
      for (let y = 0; y < extH; y += 1) {
        for (let x = 0; x < extW; x += 1) {
          const pixel = y * extW + x;
          read(extX0 + x, extY0 + y, rgb);
          componentsFromRgbInto(rgb[0], rgb[1], rgb[2], components);
          yPlane[pixel] = components[0];
          gmPlane[pixel] = components[1];
          byPlane[pixel] = components[2];
        }
      }

      const yDenoised = denoisePlane(yPlane, extW, extH, noiseSigma[0], strength, false);
      const gmDenoised = denoisePlane(gmPlane, extW, extH, noiseSigma[1], strength, true);
      const byDenoised = denoisePlane(byPlane, extW, extH, noiseSigma[2], strength, true);
      const offsetX = coreX - extX0;
      const offsetY = coreY - extY0;
      for (let y = 0; y < coreH; y += 1) {
        for (let x = 0; x < coreW; x += 1) {
          const pixel = (offsetY + y) * extW + offsetX + x;
          const yValue = yDenoised[pixel] ?? yPlane[pixel] ?? 0;
          const gm = gmDenoised[pixel] ?? gmPlane[pixel] ?? 0;
          const by = byDenoised[pixel] ?? byPlane[pixel] ?? 0;
          write(
            coreX + x,
            coreY + y,
            yValue + GM_R * gm + BY_R * by,
            yValue + GM_G * gm + BY_G * by,
            yValue + GM_B * gm + BY_B * by,
          );
        }
      }
    }
  }
}

export function applyDenoiseToCanvas(
  canvas: HTMLCanvasElement | OffscreenCanvas,
  amount: number,
  outputColorProfile: ImageEditOutputColorProfile = "srgb",
): void {
  if (clampDenoise(amount) === 0) return;
  const width = canvas.width;
  const height = canvas.height;
  if (!width || !height) return;
  const ctx = getCanvas2dContext(canvas, outputColorProfile, true);
  if (!ctx) return;
  const imageData = getCanvasImageData(ctx, 0, 0, width, height, outputColorProfile);
  const data = imageData.data;
  const source = new Uint8ClampedArray(data);
  const inputProfile: ImageInputColorProfile = outputColorProfile === "display-p3" ? "display-p3" : "srgb";
  const read: LinearRgbReader = (x, y, output) => {
    const index = (y * width + x) * 4;
    encodedRgbToLinearProphotoInto(
      (source[index] ?? 0) / 255,
      (source[index + 1] ?? 0) / 255,
      (source[index + 2] ?? 0) / 255,
      inputProfile,
      output,
    );
  };
  const encoded: RgbBuffer = [0, 0, 0];
  const write: LinearRgbWriter = (x, y, r, g, b) => {
    const index = (y * width + x) * 4;
    convertLinearProPhotoToOutputRgbInto(r, g, b, outputColorProfile, encoded);
    data[index] = linearChannelToSrgb(clamp01(encoded[0]));
    data[index + 1] = linearChannelToSrgb(clamp01(encoded[1]));
    data[index + 2] = linearChannelToSrgb(clamp01(encoded[2]));
  };
  denoiseLinearImage(width, height, amount, read, write);
  ctx.putImageData(imageData, 0, 0);
}

export function applyDenoiseToRgb16(
  data: Uint16Array,
  width: number,
  height: number,
  amount: number,
): void {
  if (clampDenoise(amount) === 0 || width <= 0 || height <= 0) return;
  const source = data.slice();
  const read: LinearRgbReader = (x, y, output) => {
    const index = (y * width + x) * 3;
    output[0] = decodeStoredRgb16Channel(source[index] ?? 0, "gamma20", 1);
    output[1] = decodeStoredRgb16Channel(source[index + 1] ?? 0, "gamma20", 1);
    output[2] = decodeStoredRgb16Channel(source[index + 2] ?? 0, "gamma20", 1);
  };
  const write: LinearRgbWriter = (x, y, r, g, b) => {
    const index = (y * width + x) * 3;
    data[index] = encodeStoredRgb16Channel(clamp01(r), "gamma20", 1);
    data[index + 1] = encodeStoredRgb16Channel(clamp01(g), "gamma20", 1);
    data[index + 2] = encodeStoredRgb16Channel(clamp01(b), "gamma20", 1);
  };
  denoiseLinearImage(width, height, amount, read, write);
}
