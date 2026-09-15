import type { LinearRgbSample } from "./types";
import { buildRenderedPixelToSourceTransform } from "./sampling";
import {
  PROPHOTO_TONE_LUMA_B,
  PROPHOTO_TONE_LUMA_G,
  PROPHOTO_TONE_LUMA_R,
} from "@/image/tone";

export type DefringeAnalysisMap = {
  width: number;
  height: number;
  magenta: Uint8Array;
  green: Uint8Array;
  magentaExpanded?: Uint8Array;
  greenExpanded?: Uint8Array;
};

export const DEFRINGE_ANALYSIS_TARGET_PIXELS = 4_000_000;
const DEFRINGE_MAP_SCALE = 255;
const DEFRINGE_Y_FLOOR = 0.025;

// Unit vectors spanning the ProPhoto zero-luminance chroma plane.
// +GM points toward magenta, -GM toward green.
const GM_R = 0.6798135;
const GM_G = -0.2751496;
const GM_B = 0.6798135;
const BY_R = 0.6302122;
const BY_G = -0.25490968;
const BY_B = -0.73338505;

// Magenta/Purple is deliberately broader and stronger: it is visually conspicuous
// and less likely than green to collide with common natural object colors.
const MAGENTA_HUE_FULL_DEGREES = 28;
const MAGENTA_HUE_ZERO_DEGREES = 46;
const GREEN_HUE_FULL_DEGREES = 12;
const GREEN_HUE_ZERO_DEGREES = 28;
const MAGENTA_STRENGTH = 1.0;
const GREEN_STRENGTH = 0.4;
const GREEN_EXPANSION_BLEND_SCALE = 0.35;

const MAGENTA_HUE_FULL_ALIGNMENT = Math.cos(MAGENTA_HUE_FULL_DEGREES * Math.PI / 180);
const MAGENTA_HUE_ZERO_ALIGNMENT = Math.cos(MAGENTA_HUE_ZERO_DEGREES * Math.PI / 180);
const GREEN_HUE_FULL_ALIGNMENT = Math.cos(GREEN_HUE_FULL_DEGREES * Math.PI / 180);
const GREEN_HUE_ZERO_ALIGNMENT = Math.cos(GREEN_HUE_ZERO_DEGREES * Math.PI / 180);

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function smoothstep(low: number, high: number, value: number): number {
  const t = clamp01((value - low) / Math.max(1e-12, high - low));
  return t * t * (3 - 2 * t);
}

function hueAxisWeight(
  gm: number,
  by: number,
  sign: 1 | -1,
  zeroAlignment: number,
  fullAlignment: number,
): number {
  const magnitude = Math.hypot(gm, by);
  if (!(magnitude > 1e-12)) return 0;
  const alignment = sign * gm / magnitude;
  return smoothstep(zeroAlignment, fullAlignment, alignment);
}

function magentaHueWeight(gm: number, by: number): number {
  return hueAxisWeight(
    gm,
    by,
    1,
    MAGENTA_HUE_ZERO_ALIGNMENT,
    MAGENTA_HUE_FULL_ALIGNMENT,
  );
}

function greenHueWeight(gm: number, by: number): number {
  return hueAxisWeight(
    gm,
    by,
    -1,
    GREEN_HUE_ZERO_ALIGNMENT,
    GREEN_HUE_FULL_ALIGNMENT,
  );
}


function maxFilter3x3(input: Uint8Array, width: number, height: number): Uint8Array {
  const output = new Uint8Array(input.length);
  for (let y = 0; y < height; y += 1) {
    const ym = Math.max(0, y - 1);
    const yp = Math.min(height - 1, y + 1);
    for (let x = 0; x < width; x += 1) {
      const xm = Math.max(0, x - 1);
      const xp = Math.min(width - 1, x + 1);
      let maxValue = 0;
      for (let sy = ym; sy <= yp; sy += 1) {
        const row = sy * width;
        for (let sx = xm; sx <= xp; sx += 1) {
          maxValue = Math.max(maxValue, input[row + sx] ?? 0);
        }
      }
      output[y * width + x] = maxValue;
    }
  }
  return output;
}

function expandConfidencePlane(input: Uint8Array, width: number, height: number): Uint8Array {
  const dilated = maxFilter3x3(input, width, height);
  const dilatedFloat = new Float32Array(dilated.length);
  const baseFloat = new Float32Array(input.length);
  for (let i = 0; i < dilated.length; i += 1) {
    dilatedFloat[i] = (dilated[i] ?? 0) / DEFRINGE_MAP_SCALE;
    baseFloat[i] = (input[i] ?? 0) / DEFRINGE_MAP_SCALE;
  }
  const feathered = blurScalar(dilatedFloat, width, height, 0.85);
  const output = new Uint8Array(input.length);
  for (let i = 0; i < output.length; i += 1) {
    output[i] = Math.round(clamp01(Math.max(baseFloat[i] ?? 0, feathered[i] ?? 0)) * DEFRINGE_MAP_SCALE);
  }
  return output;
}

function gaussianKernel(sigma: number): Float32Array {
  const radius = Math.max(1, Math.ceil(sigma * 3));
  const kernel = new Float32Array(radius * 2 + 1);
  const sigma2 = 2 * sigma * sigma;
  let sum = 0;
  for (let i = -radius; i <= radius; i += 1) {
    const w = Math.exp(-(i * i) / sigma2);
    kernel[i + radius] = w;
    sum += w;
  }
  for (let i = 0; i < kernel.length; i += 1) kernel[i] /= sum;
  return kernel;
}

function clampIndex(index: number, length: number): number {
  return Math.min(length - 1, Math.max(0, index));
}

function blurScalar(input: Float32Array, width: number, height: number, sigma: number): Float32Array {
  const kernel = gaussianKernel(sigma);
  const radius = Math.floor(kernel.length / 2);
  const scratch = new Float32Array(input.length);
  const output = new Float32Array(input.length);
  for (let y = 0; y < height; y += 1) {
    const row = y * width;
    for (let x = 0; x < width; x += 1) {
      let sum = 0;
      for (let k = -radius; k <= radius; k += 1) {
        sum += (input[row + clampIndex(x + k, width)] ?? 0) * (kernel[k + radius] ?? 0);
      }
      scratch[row + x] = sum;
    }
  }
  for (let y = 0; y < height; y += 1) {
    const row = y * width;
    for (let x = 0; x < width; x += 1) {
      let sum = 0;
      for (let k = -radius; k <= radius; k += 1) {
        sum += (scratch[clampIndex(y + k, height) * width + x] ?? 0) * (kernel[k + radius] ?? 0);
      }
      output[row + x] = sum;
    }
  }
  return output;
}

function chromaCoordinates(r: number, g: number, b: number, y: number): [number, number] {
  const cr = r - y;
  const cg = g - y;
  const cb = b - y;
  return [
    GM_R * cr + GM_G * cg + GM_B * cb,
    BY_R * cr + BY_G * cg + BY_B * cb,
  ];
}

export function analyzeDefringeSample(sample: LinearRgbSample): DefringeAnalysisMap {
  const width = Math.max(1, Math.round(sample.width));
  const height = Math.max(1, Math.round(sample.height));
  const pixels = width * height;
  const yPlane = new Float32Array(pixels);
  const gmPlane = new Float32Array(pixels);
  const byPlane = new Float32Array(pixels);
  const valid = sample.valid;
  for (let pixel = 0; pixel < pixels; pixel += 1) {
    if (valid && !valid[pixel]) continue;
    const i = pixel * 3;
    const r = sample.data[i] ?? 0;
    const g = sample.data[i + 1] ?? 0;
    const b = sample.data[i + 2] ?? 0;
    const y = Math.max(0, PROPHOTO_TONE_LUMA_R * r + PROPHOTO_TONE_LUMA_G * g + PROPHOTO_TONE_LUMA_B * b);
    const [gm, by] = chromaCoordinates(r, g, b, y);
    const invY = 1 / Math.max(DEFRINGE_Y_FLOOR, y);
    yPlane[pixel] = y;
    gmPlane[pixel] = gm * invY;
    byPlane[pixel] = by * invY;
  }

  const ySmall = blurScalar(yPlane, width, height, 1.0);
  const yMedium = blurScalar(yPlane, width, height, 2.5);
  const gmBase = blurScalar(gmPlane, width, height, 2.2);
  const byBase = blurScalar(byPlane, width, height, 2.2);
  const magenta = new Uint8Array(pixels);
  const green = new Uint8Array(pixels);

  for (let y = 0; y < height; y += 1) {
    const ym = Math.max(0, y - 1);
    const yp = Math.min(height - 1, y + 1);
    for (let x = 0; x < width; x += 1) {
      const pixel = y * width + x;
      if (valid && !valid[pixel]) continue;
      const xm = Math.max(0, x - 1);
      const xp = Math.min(width - 1, x + 1);
      const gx = ((ySmall[y * width + xp] ?? 0) - (ySmall[y * width + xm] ?? 0)) * 0.5;
      const gy = ((ySmall[yp * width + x] ?? 0) - (ySmall[ym * width + x] ?? 0)) * 0.5;
      const gradient = Math.hypot(gx, gy);
      const broad = Math.abs((ySmall[pixel] ?? 0) - (yMedium[pixel] ?? 0));
      const structure = smoothstep(0.002, 0.035, Math.max(gradient, broad * 1.5));
      const residualGm = (gmPlane[pixel] ?? 0) - (gmBase[pixel] ?? 0);
      const residualBy = (byPlane[pixel] ?? 0) - (byBase[pixel] ?? 0);
      const residualMagnitude = Math.hypot(residualGm, residualBy);
      const residualConfidence = smoothstep(0.006, 0.06, residualMagnitude);
      const noiseConfidence = smoothstep(0.015, 0.08, yPlane[pixel] ?? 0);
      const baseConfidence = structure * residualConfidence * noiseConfidence;
      if (!(baseConfidence > 0)) continue;
      magenta[pixel] = Math.round(
        clamp01(baseConfidence * magentaHueWeight(residualGm, residualBy)) * DEFRINGE_MAP_SCALE,
      );
      green[pixel] = Math.round(
        clamp01(baseConfidence * greenHueWeight(residualGm, residualBy)) * DEFRINGE_MAP_SCALE,
      );
    }
  }
  const magentaExpanded = expandConfidencePlane(magenta, width, height);
  const greenExpanded = expandConfidencePlane(green, width, height);
  return { width, height, magenta, green, magentaExpanded, greenExpanded };
}

function sampleMapPlane(
  plane: Uint8Array,
  mapWidth: number,
  mapHeight: number,
  normalizedX: number,
  normalizedY: number,
): number {
  if (!plane.length) return 0;
  const x = clamp01(normalizedX) * Math.max(0, mapWidth - 1);
  const y = clamp01(normalizedY) * Math.max(0, mapHeight - 1);
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const x1 = Math.min(mapWidth - 1, x0 + 1);
  const y1 = Math.min(mapHeight - 1, y0 + 1);
  const tx = x - x0;
  const ty = y - y0;
  return (
    (plane[y0 * mapWidth + x0] ?? 0) * (1 - tx) * (1 - ty)
    + (plane[y0 * mapWidth + x1] ?? 0) * tx * (1 - ty)
    + (plane[y1 * mapWidth + x0] ?? 0) * (1 - tx) * ty
    + (plane[y1 * mapWidth + x1] ?? 0) * tx * ty
  ) / DEFRINGE_MAP_SCALE;
}

export function sampleDefringeConfidence(
  map: DefringeAnalysisMap,
  normalizedX: number,
  normalizedY: number,
  expandedBlend = 0,
): { magenta: number; green: number } {
  const magentaBase = sampleMapPlane(map.magenta, map.width, map.height, normalizedX, normalizedY);
  const greenBase = sampleMapPlane(map.green, map.width, map.height, normalizedX, normalizedY);
  const magentaExpanded = map.magentaExpanded
    ? sampleMapPlane(map.magentaExpanded, map.width, map.height, normalizedX, normalizedY)
    : magentaBase;
  const greenExpanded = map.greenExpanded
    ? sampleMapPlane(map.greenExpanded, map.width, map.height, normalizedX, normalizedY)
    : greenBase;
  const magentaBlend = clamp01(expandedBlend);
  const greenBlend = clamp01(expandedBlend * GREEN_EXPANSION_BLEND_SCALE);
  return {
    magenta: magentaBase * (1 - magentaBlend) + magentaExpanded * magentaBlend,
    green: greenBase * (1 - greenBlend) + greenExpanded * greenBlend,
  };
}

export function applyDefringeLinearRgb(
  r: number,
  g: number,
  b: number,
  map: DefringeAnalysisMap | null | undefined,
  amount: number,
  normalizedX: number,
  normalizedY: number,
): [number, number, number] {
  if (!map || !(amount > 0)) return [r, g, b];
  const userAmount = clamp01(amount);
  const effectiveAmount = clamp01(userAmount * 2);
  const confidence = sampleDefringeConfidence(map, normalizedX, normalizedY, userAmount);
  if (!(confidence.magenta > 0) && !(confidence.green > 0)) return [r, g, b];

  const y = PROPHOTO_TONE_LUMA_R * r + PROPHOTO_TONE_LUMA_G * g + PROPHOTO_TONE_LUMA_B * b;
  const cr = r - y;
  const cg = g - y;
  const cb = b - y;
  const gm = GM_R * cr + GM_G * cg + GM_B * cb;
  const by = BY_R * cr + BY_G * cg + BY_B * cb;

  // Re-check the current pixel hue after the low-resolution confidence map is
  // bilinearly sampled. This prevents confidence bleeding into neighboring hues.
  const magentaGate = magentaHueWeight(gm, by);
  const greenGate = greenHueWeight(gm, by);
  const magentaReduction = clamp01(effectiveAmount * MAGENTA_STRENGTH * confidence.magenta * magentaGate);
  const greenReduction = clamp01(effectiveAmount * GREEN_STRENGTH * confidence.green * greenGate);
  const chromaReduction = Math.max(magentaReduction, greenReduction);
  if (!(chromaReduction > 0)) return [r, g, b];

  // Defringe is hue-preserving desaturation toward neutral, never complementary
  // color addition. k<=1 guarantees Purple cannot be pushed through neutral into Green.
  const chromaScale = 1 - chromaReduction;
  return [
    y + cr * chromaScale,
    y + cg * chromaScale,
    y + cb * chromaScale,
  ];
}

export function applyDefringeToSample(
  sample: LinearRgbSample,
  map: DefringeAnalysisMap | null | undefined,
  amount: number,
): LinearRgbSample {
  if (!map || !(amount > 0)) return sample;
  const width = sample.width;
  const height = sample.height;
  const data = new Float32Array(sample.data.length);
  for (let y = 0; y < height; y += 1) {
    const ny = height > 1 ? y / (height - 1) : 0.5;
    for (let x = 0; x < width; x += 1) {
      const pixel = y * width + x;
      const i = pixel * 3;
      if (sample.valid && !sample.valid[pixel]) continue;
      const nx = width > 1 ? x / (width - 1) : 0.5;
      const [r, g, b] = applyDefringeLinearRgb(
        sample.data[i] ?? 0,
        sample.data[i + 1] ?? 0,
        sample.data[i + 2] ?? 0,
        map,
        amount,
        nx,
        ny,
      );
      data[i] = Math.fround(r);
      data[i + 1] = Math.fround(g);
      data[i + 2] = Math.fround(b);
    }
  }
  return { data, width, height, ...(sample.valid ? { valid: sample.valid } : {}) };
}

export function applyDefringeToRenderedSample(
  sample: LinearRgbSample,
  map: DefringeAnalysisMap | null | undefined,
  amount: number,
  sourceWidth: number,
  sourceHeight: number,
  sourceRect: { x: number; y: number; w: number; h: number },
  rotationDegrees: number,
): LinearRgbSample {
  if (!map || !(amount > 0)) return sample;
  const width = Math.max(1, sample.width);
  const height = Math.max(1, sample.height);
  const data = new Float32Array(sample.data.length);
  const transform = buildRenderedPixelToSourceTransform(
    sourceWidth,
    sourceHeight,
    sourceRect.x,
    sourceRect.y,
    width / Math.max(1, sourceRect.w),
    height / Math.max(1, sourceRect.h),
    rotationDegrees,
  );
  let rowSourceX = transform.originX;
  let rowSourceY = transform.originY;
  for (let y = 0; y < height; y += 1) {
    let sourceX = rowSourceX;
    let sourceY = rowSourceY;
    for (let x = 0; x < width; x += 1) {
      const pixel = y * width + x;
      const i = pixel * 3;
      if (!sample.valid || sample.valid[pixel]) {
        const [r, g, b] = applyDefringeLinearRgb(
          sample.data[i] ?? 0,
          sample.data[i + 1] ?? 0,
          sample.data[i + 2] ?? 0,
          map,
          amount,
          sourceWidth > 1 ? sourceX / (sourceWidth - 1) : 0.5,
          sourceHeight > 1 ? sourceY / (sourceHeight - 1) : 0.5,
        );
        data[i] = Math.fround(r);
        data[i + 1] = Math.fround(g);
        data[i + 2] = Math.fround(b);
      }
      sourceX += transform.columnStepX;
      sourceY += transform.columnStepY;
    }
    rowSourceX += transform.rowStepX;
    rowSourceY += transform.rowStepY;
  }
  return { data, width, height, ...(sample.valid ? { valid: sample.valid } : {}) };
}
