import { lensfunSourceCoordinates, lensfunVignettingGain } from "@/utils/lensfunCorrection";
import type { DecodedRgbImage16, EditPoint, LinearRgbSample } from "./types";
import { clamp01 } from "./tone";

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

type AnalysisSampleCacheEntry = {
  key: string;
  sample: LinearRgbSample;
};

const RGB16_ANALYSIS_SAMPLE_CACHE = new WeakMap<
  DecodedRgbImage16,
  AnalysisSampleCacheEntry[]
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

export function sampleLinearRgb16BilinearAtSource(
  decoded: DecodedRgbImage16,
  x: number,
  y: number,
): [number, number, number] | null {
  const r = sampleLinearRgb16ChannelBilinearAtSource(decoded, x, y, 0);
  const g = sampleLinearRgb16ChannelBilinearAtSource(decoded, x, y, 1);
  const b = sampleLinearRgb16ChannelBilinearAtSource(decoded, x, y, 2);
  return r === null || g === null || b === null ? null : [r, g, b];
}

export function sampleLinearRgb16Bilinear(
  decoded: DecodedRgbImage16,
  x: number,
  y: number,
): [number, number, number] | null {
  const correction = decoded.lensCorrection;
  if (!correction) return sampleLinearRgb16BilinearAtSource(decoded, x, y);

  const coordinates = lensfunSourceCoordinates(correction, x, y);
  if (correction.tca) {
    let r = sampleLinearRgb16ChannelBilinearAtSource(decoded, coordinates.r[0], coordinates.r[1], 0);
    let g = sampleLinearRgb16ChannelBilinearAtSource(decoded, coordinates.g[0], coordinates.g[1], 1);
    let b = sampleLinearRgb16ChannelBilinearAtSource(decoded, coordinates.b[0], coordinates.b[1], 2);
    if (r === null || g === null || b === null) return null;
    if (correction.vignetting && !correction.vignettingBaked) {
      r *= lensfunVignettingGain(correction, coordinates.r[0], coordinates.r[1])[0];
      g *= lensfunVignettingGain(correction, coordinates.g[0], coordinates.g[1])[1];
      b *= lensfunVignettingGain(correction, coordinates.b[0], coordinates.b[1])[2];
    }
    return [r, g, b];
  }
  const sample = sampleLinearRgb16BilinearAtSource(decoded, coordinates.g[0], coordinates.g[1]);
  if (!sample) return null;
  if (correction.vignetting && !correction.vignettingBaked) {
    const [rGain, gGain, bGain] = lensfunVignettingGain(
      correction,
      coordinates.g[0],
      coordinates.g[1],
    );
    return [sample[0] * rGain, sample[1] * gGain, sample[2] * bGain];
  }
  return sample;
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

export function sampleLinearRgbFromRgb16Region(
  decoded: DecodedRgbImage16,
  sourceRect: { x: number; y: number; w: number; h: number },
  rotationDegrees: number,
  targetPixels = ANALYSIS_SAMPLE_TARGET_PIXELS,
): LinearRgbSample {
  const sw = Number.isFinite(sourceRect.w) && sourceRect.w > 0 ? sourceRect.w : 1;
  const sh = Number.isFinite(sourceRect.h) && sourceRect.h > 0 ? sourceRect.h : 1;
  const sampleSize = analysisSampleDimensions(sw, sh, targetPixels);
  const sampleW = sampleSize.width;
  const sampleH = sampleSize.height;
  const data = new Float32Array(sampleW * sampleH * 3);
  const valid = new Uint8Array(sampleW * sampleH);
  const scaleX = sampleW / sw;
  const scaleY = sampleH / sh;
  for (let y = 0; y < sampleH; y++) {
    for (let x = 0; x < sampleW; x++) {
      const sourcePoint = renderedPixelToSourcePoint(
        x,
        y,
        decoded.width,
        decoded.height,
        sourceRect.x,
        sourceRect.y,
        scaleX,
        scaleY,
        rotationDegrees,
      );
      if (
        sourcePoint.x < 0 ||
        sourcePoint.x >= decoded.width ||
        sourcePoint.y < 0 ||
        sourcePoint.y >= decoded.height
      ) {
        continue;
      }
      const di = (y * sampleW + x) * 3;
      const vi = y * sampleW + x;
      const sample = sampleLinearRgb16Bilinear(decoded, sourcePoint.x, sourcePoint.y);
      if (!sample) continue;
      const [r, g, b] = sample;
      data[di] = r;
      data[di + 1] = g;
      data[di + 2] = b;
      valid[vi] = 1;
    }
  }
  return { data, width: sampleW, height: sampleH, valid };
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
