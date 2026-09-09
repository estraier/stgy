import {
  lensfunSourceCoordinatesInto,
  lensfunVignettingGainInto,
} from "@/image/lensfun";
import type {
  LensfunSourceCoordinatesBuffer,
  LensfunVignettingGainBuffer,
} from "@/image/lensfun";
import type { DecodedRgbImage16, EditPoint, LinearRgbSample } from "./types";
import { clamp01 } from "@/image/tone";

// RGB16 storage decoding, geometry mapping and source sampling.

export function normalizeRotationDegrees(value: number): number {
  if (!Number.isFinite(value)) return 0;
  const normalized = ((value + 180) % 360 + 360) % 360 - 180;
  return Math.abs(normalized) < 1e-9 ? 0 : normalized;
}

export function rotatePoint(
  x: number,
  y: number,
  centerX: number,
  centerY: number,
  degrees: number,
): EditPoint {
  const radians = normalizeRotationDegrees(degrees) * Math.PI / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  const dx = x - centerX;
  const dy = y - centerY;
  return {
    x: centerX + dx * cos - dy * sin,
    y: centerY + dx * sin + dy * cos,
  };
}

export function inverseRotatePoint(
  x: number,
  y: number,
  centerX: number,
  centerY: number,
  degrees: number,
): EditPoint {
  return rotatePoint(x, y, centerX, centerY, -degrees);
}

export const ANALYSIS_SAMPLE_TARGET_PIXELS = 256 * 256;
const ANALYSIS_SAMPLE_CACHE_MAX_ENTRIES = 4;
const RENDERED_SAMPLE_CACHE_MAX_ENTRIES = 2;

type AnalysisSampleCacheEntry = {
  key: string;
  sample: LinearRgbSample;
};

const RGB16_ANALYSIS_SAMPLE_CACHE = new WeakMap<
  DecodedRgbImage16,
  AnalysisSampleCacheEntry[]
>();

type RenderedSampleCacheEntry = {
  key: string;
  sample: LinearRgbSample;
};

const RGB16_RENDERED_SAMPLE_CACHE = new WeakMap<
  DecodedRgbImage16,
  RenderedSampleCacheEntry[]
>();

export function analysisSampleDimensions(
  width: number,
  height: number,
  targetPixels = ANALYSIS_SAMPLE_TARGET_PIXELS,
): { width: number; height: number } {
  const sourceW = Number.isFinite(width) && width > 0 ? width : 1;
  const sourceH = Number.isFinite(height) && height > 0 ? height : 1;
  const normalizedTarget = Number.isFinite(targetPixels) && targetPixels > 0
    ? targetPixels
    : ANALYSIS_SAMPLE_TARGET_PIXELS;
  const scale = Math.min(1, Math.sqrt(normalizedTarget / (sourceW * sourceH)));
  return {
    width: Math.max(1, Math.round(sourceW * scale)),
    height: Math.max(1, Math.round(sourceH * scale)),
  };
}

export function normalizeLinearRangeMax(linearRangeMax: number): number {
  return Number.isFinite(linearRangeMax) && linearRangeMax > 0 ? linearRangeMax : 1;
}

export function decodeStoredRgb16Channel(
  sample: number,
  transfer: DecodedRgbImage16["transfer"],
  linearRangeMax: number,
): number {
  const encoded = clamp01(sample / 65535);
  const normalizedRange = normalizeLinearRangeMax(linearRangeMax);
  if (transfer === "gamma20") return encoded * encoded * normalizedRange;
  return encoded * normalizedRange;
}

export function encodeStoredRgb16Channel(
  linear: number,
  transfer: DecodedRgbImage16["transfer"],
  linearRangeMax: number,
): number {
  const normalizedRange = normalizeLinearRangeMax(linearRangeMax);
  const normalized = clamp01(linear / normalizedRange);
  const encoded = transfer === "gamma20" ? Math.sqrt(normalized) : normalized;
  return Math.round(encoded * 65535);
}

export type LinearRgbBuffer = [number, number, number];

export type Rgb16SamplingScratch = {
  lensfunCoordinates: LensfunSourceCoordinatesBuffer;
  lensfunGain: LensfunVignettingGainBuffer;
};

export function createRgb16SamplingScratch(): Rgb16SamplingScratch {
  return {
    lensfunCoordinates: [0, 0, 0, 0, 0, 0],
    lensfunGain: [1, 1, 1],
  };
}

export function sampleLinearRgb16ChannelBilinearAtSource(
  decoded: DecodedRgbImage16,
  x: number,
  y: number,
  channel: 0 | 1 | 2,
): number | null {
  if (x < 0 || x > decoded.width - 1 || y < 0 || y > decoded.height - 1) return null;
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const x1 = Math.min(decoded.width - 1, x0 + 1);
  const y1 = Math.min(decoded.height - 1, y0 + 1);
  const tx = x - x0;
  const ty = y - y0;
  const data = decoded.data;
  const idx00 = (y0 * decoded.width + x0) * 3 + channel;
  const idx10 = (y0 * decoded.width + x1) * 3 + channel;
  const idx01 = (y1 * decoded.width + x0) * 3 + channel;
  const idx11 = (y1 * decoded.width + x1) * 3 + channel;
  const w00 = (1 - tx) * (1 - ty);
  const w10 = tx * (1 - ty);
  const w01 = (1 - tx) * ty;
  const w11 = tx * ty;
  const transfer = decoded.transfer;
  const linearRangeMax = decoded.linearRangeMax;
  return (
    decodeStoredRgb16Channel(data[idx00] ?? 0, transfer, linearRangeMax) * w00 +
    decodeStoredRgb16Channel(data[idx10] ?? 0, transfer, linearRangeMax) * w10 +
    decodeStoredRgb16Channel(data[idx01] ?? 0, transfer, linearRangeMax) * w01 +
    decodeStoredRgb16Channel(data[idx11] ?? 0, transfer, linearRangeMax) * w11
  );
}

export function sampleLinearRgb16BilinearAtSourceInto(
  decoded: DecodedRgbImage16,
  x: number,
  y: number,
  output: LinearRgbBuffer,
): boolean {
  if (x < 0 || x > decoded.width - 1 || y < 0 || y > decoded.height - 1) return false;
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const x1 = Math.min(decoded.width - 1, x0 + 1);
  const y1 = Math.min(decoded.height - 1, y0 + 1);
  const tx = x - x0;
  const ty = y - y0;
  const w00 = (1 - tx) * (1 - ty);
  const w10 = tx * (1 - ty);
  const w01 = (1 - tx) * ty;
  const w11 = tx * ty;
  const data = decoded.data;
  const row00 = (y0 * decoded.width + x0) * 3;
  const row10 = (y0 * decoded.width + x1) * 3;
  const row01 = (y1 * decoded.width + x0) * 3;
  const row11 = (y1 * decoded.width + x1) * 3;
  const transfer = decoded.transfer;
  const linearRangeMax = decoded.linearRangeMax;

  for (let channel = 0; channel < 3; channel++) {
    output[channel] =
      decodeStoredRgb16Channel(data[row00 + channel] ?? 0, transfer, linearRangeMax) * w00 +
      decodeStoredRgb16Channel(data[row10 + channel] ?? 0, transfer, linearRangeMax) * w10 +
      decodeStoredRgb16Channel(data[row01 + channel] ?? 0, transfer, linearRangeMax) * w01 +
      decodeStoredRgb16Channel(data[row11 + channel] ?? 0, transfer, linearRangeMax) * w11;
  }
  return true;
}

export function sampleLinearRgb16BilinearAtSource(
  decoded: DecodedRgbImage16,
  x: number,
  y: number,
): [number, number, number] | null {
  const output: LinearRgbBuffer = [0, 0, 0];
  return sampleLinearRgb16BilinearAtSourceInto(decoded, x, y, output) ? output : null;
}

export function sampleLinearRgb16BilinearInto(
  decoded: DecodedRgbImage16,
  x: number,
  y: number,
  output: LinearRgbBuffer,
  scratch: Rgb16SamplingScratch,
): boolean {
  const correction = decoded.lensCorrection;
  if (!correction) return sampleLinearRgb16BilinearAtSourceInto(decoded, x, y, output);

  const coordinates = lensfunSourceCoordinatesInto(
    correction,
    x,
    y,
    scratch.lensfunCoordinates,
  );
  if (correction.tca) {
    const r = sampleLinearRgb16ChannelBilinearAtSource(decoded, coordinates[0], coordinates[1], 0);
    const g = sampleLinearRgb16ChannelBilinearAtSource(decoded, coordinates[2], coordinates[3], 1);
    const b = sampleLinearRgb16ChannelBilinearAtSource(decoded, coordinates[4], coordinates[5], 2);
    if (r === null || g === null || b === null) return false;
    output[0] = r;
    output[1] = g;
    output[2] = b;
    if (correction.vignetting && !correction.vignettingBaked) {
      lensfunVignettingGainInto(
        correction,
        coordinates[0],
        coordinates[1],
        scratch.lensfunGain,
      );
      output[0] *= scratch.lensfunGain[0];
      lensfunVignettingGainInto(
        correction,
        coordinates[2],
        coordinates[3],
        scratch.lensfunGain,
      );
      output[1] *= scratch.lensfunGain[1];
      lensfunVignettingGainInto(
        correction,
        coordinates[4],
        coordinates[5],
        scratch.lensfunGain,
      );
      output[2] *= scratch.lensfunGain[2];
    }
    return true;
  }

  if (!sampleLinearRgb16BilinearAtSourceInto(decoded, coordinates[2], coordinates[3], output)) {
    return false;
  }
  if (correction.vignetting && !correction.vignettingBaked) {
    lensfunVignettingGainInto(
      correction,
      coordinates[2],
      coordinates[3],
      scratch.lensfunGain,
    );
    output[0] *= scratch.lensfunGain[0];
    output[1] *= scratch.lensfunGain[1];
    output[2] *= scratch.lensfunGain[2];
  }
  return true;
}

export function sampleLinearRgb16Bilinear(
  decoded: DecodedRgbImage16,
  x: number,
  y: number,
): [number, number, number] | null {
  const output: LinearRgbBuffer = [0, 0, 0];
  const scratch = createRgb16SamplingScratch();
  return sampleLinearRgb16BilinearInto(decoded, x, y, output, scratch) ? output : null;
}

export function renderedPixelToSourcePoint(
  x: number,
  y: number,
  sourceW: number,
  sourceH: number,
  cropX: number,
  cropY: number,
  scaleX: number,
  scaleY: number,
  rotationDegrees: number,
): EditPoint {
  const point = {
    x: cropX + (x + 0.5) / scaleX,
    y: cropY + (y + 0.5) / scaleY,
  };
  if (Math.abs(normalizeRotationDegrees(rotationDegrees)) < 1e-9) return point;
  return inverseRotatePoint(point.x, point.y, sourceW / 2, sourceH / 2, rotationDegrees);
}

export type RenderedPixelToSourceTransform = {
  originX: number;
  originY: number;
  columnStepX: number;
  columnStepY: number;
  rowStepX: number;
  rowStepY: number;
};

export function buildRenderedPixelToSourceTransform(
  sourceW: number,
  sourceH: number,
  cropX: number,
  cropY: number,
  scaleX: number,
  scaleY: number,
  rotationDegrees: number,
): RenderedPixelToSourceTransform {
  const px = cropX + 0.5 / scaleX;
  const py = cropY + 0.5 / scaleY;
  const normalizedRotation = normalizeRotationDegrees(rotationDegrees);
  if (Math.abs(normalizedRotation) < 1e-9) {
    return {
      originX: px,
      originY: py,
      columnStepX: 1 / scaleX,
      columnStepY: 0,
      rowStepX: 0,
      rowStepY: 1 / scaleY,
    };
  }

  const radians = normalizedRotation * Math.PI / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  const centerX = sourceW / 2;
  const centerY = sourceH / 2;
  const dx = px - centerX;
  const dy = py - centerY;
  return {
    originX: centerX + dx * cos + dy * sin,
    originY: centerY - dx * sin + dy * cos,
    columnStepX: cos / scaleX,
    columnStepY: -sin / scaleX,
    rowStepX: sin / scaleY,
    rowStepY: cos / scaleY,
  };
}

export function sampleLinearRgbFromRgb16RegionAtSize(
  decoded: DecodedRgbImage16,
  sourceRect: { x: number; y: number; w: number; h: number },
  rotationDegrees: number,
  sampleWidth: number,
  sampleHeight: number,
): LinearRgbSample {
  const sw = Number.isFinite(sourceRect.w) && sourceRect.w > 0 ? sourceRect.w : 1;
  const sh = Number.isFinite(sourceRect.h) && sourceRect.h > 0 ? sourceRect.h : 1;
  const sampleW = Math.max(1, Math.round(Number.isFinite(sampleWidth) ? sampleWidth : 1));
  const sampleH = Math.max(1, Math.round(Number.isFinite(sampleHeight) ? sampleHeight : 1));
  const data = new Float32Array(sampleW * sampleH * 3);
  const valid = new Uint8Array(sampleW * sampleH);
  const scaleX = sampleW / sw;
  const scaleY = sampleH / sh;
  const transform = buildRenderedPixelToSourceTransform(
    decoded.width,
    decoded.height,
    sourceRect.x,
    sourceRect.y,
    scaleX,
    scaleY,
    rotationDegrees,
  );
  const sample: LinearRgbBuffer = [0, 0, 0];
  const samplingScratch = createRgb16SamplingScratch();
  let rowSourceX = transform.originX;
  let rowSourceY = transform.originY;
  for (let y = 0; y < sampleH; y++) {
    let sourceX = rowSourceX;
    let sourceY = rowSourceY;
    for (let x = 0; x < sampleW; x++) {
      if (
        sourceX >= 0 &&
        sourceX < decoded.width &&
        sourceY >= 0 &&
        sourceY < decoded.height
      ) {
        const di = (y * sampleW + x) * 3;
        const vi = y * sampleW + x;
        if (sampleLinearRgb16BilinearInto(decoded, sourceX, sourceY, sample, samplingScratch)) {
          data[di] = sample[0];
          data[di + 1] = sample[1];
          data[di + 2] = sample[2];
          valid[vi] = 1;
        }
      }
      sourceX += transform.columnStepX;
      sourceY += transform.columnStepY;
    }
    rowSourceX += transform.rowStepX;
    rowSourceY += transform.rowStepY;
  }
  return { data, width: sampleW, height: sampleH, valid };
}

export function sampleLinearRgbFromRgb16Region(
  decoded: DecodedRgbImage16,
  sourceRect: { x: number; y: number; w: number; h: number },
  rotationDegrees: number,
  targetPixels = ANALYSIS_SAMPLE_TARGET_PIXELS,
): LinearRgbSample {
  const sw = Number.isFinite(sourceRect.w) && sourceRect.w > 0 ? sourceRect.w : 1;
  const sh = Number.isFinite(sourceRect.h) && sourceRect.h > 0 ? sourceRect.h : 1;
  const sampleSize = analysisSampleDimensions(sw, sh, targetPixels);
  return sampleLinearRgbFromRgb16RegionAtSize(
    decoded,
    sourceRect,
    rotationDegrees,
    sampleSize.width,
    sampleSize.height,
  );
}

function analysisSampleCacheKey(
  sourceRect: { x: number; y: number; w: number; h: number },
  rotationDegrees: number,
  targetPixels: number,
): string {
  const normalizedRotation = normalizeRotationDegrees(rotationDegrees);
  return [
    sourceRect.x,
    sourceRect.y,
    sourceRect.w,
    sourceRect.h,
    normalizedRotation,
    targetPixels,
  ].join("|");
}

function renderedSampleCacheKey(
  sourceRect: { x: number; y: number; w: number; h: number },
  rotationDegrees: number,
  width: number,
  height: number,
): string {
  const normalizedRotation = normalizeRotationDegrees(rotationDegrees);
  return [
    sourceRect.x,
    sourceRect.y,
    sourceRect.w,
    sourceRect.h,
    normalizedRotation,
    Math.max(1, Math.round(width)),
    Math.max(1, Math.round(height)),
  ].join("|");
}

export function getRenderedLinearRgbSample(
  decoded: DecodedRgbImage16,
  sourceRect: { x: number; y: number; w: number; h: number },
  rotationDegrees: number,
  width: number,
  height: number,
): LinearRgbSample {
  const normalizedRotation = normalizeRotationDegrees(rotationDegrees);
  const sampleWidth = Math.max(1, Math.round(Number.isFinite(width) ? width : 1));
  const sampleHeight = Math.max(1, Math.round(Number.isFinite(height) ? height : 1));
  const key = renderedSampleCacheKey(sourceRect, normalizedRotation, sampleWidth, sampleHeight);
  const entries = RGB16_RENDERED_SAMPLE_CACHE.get(decoded) ?? [];
  const cachedIndex = entries.findIndex((entry) => entry.key === key);
  if (cachedIndex >= 0) {
    const [cached] = entries.splice(cachedIndex, 1);
    entries.unshift(cached);
    return cached.sample;
  }
  const sample = sampleLinearRgbFromRgb16RegionAtSize(
    decoded,
    sourceRect,
    normalizedRotation,
    sampleWidth,
    sampleHeight,
  );
  entries.unshift({ key, sample });
  if (entries.length > RENDERED_SAMPLE_CACHE_MAX_ENTRIES) {
    entries.length = RENDERED_SAMPLE_CACHE_MAX_ENTRIES;
  }
  RGB16_RENDERED_SAMPLE_CACHE.set(decoded, entries);
  return sample;
}

export function getAnalysisLinearRgbSample(
  decoded: DecodedRgbImage16,
  sourceRect: { x: number; y: number; w: number; h: number },
  rotationDegrees: number,
  targetPixels = ANALYSIS_SAMPLE_TARGET_PIXELS,
): LinearRgbSample {
  const normalizedRotation = normalizeRotationDegrees(rotationDegrees);
  const normalizedTarget = Number.isFinite(targetPixels) && targetPixels > 0
    ? targetPixels
    : ANALYSIS_SAMPLE_TARGET_PIXELS;
  const key = analysisSampleCacheKey(sourceRect, normalizedRotation, normalizedTarget);
  const entries = RGB16_ANALYSIS_SAMPLE_CACHE.get(decoded) ?? [];
  const cachedIndex = entries.findIndex((entry) => entry.key === key);
  if (cachedIndex >= 0) {
    const [cached] = entries.splice(cachedIndex, 1);
    entries.unshift(cached);
    return cached.sample;
  }
  const sample = sampleLinearRgbFromRgb16Region(
    decoded,
    sourceRect,
    normalizedRotation,
    normalizedTarget,
  );
  entries.unshift({ key, sample });
  if (entries.length > ANALYSIS_SAMPLE_CACHE_MAX_ENTRIES) {
    entries.length = ANALYSIS_SAMPLE_CACHE_MAX_ENTRIES;
  }
  RGB16_ANALYSIS_SAMPLE_CACHE.set(decoded, entries);
  return sample;
}
