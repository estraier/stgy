"use client";

import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import NextImage from "next/image";
import { createPortal } from "react-dom";
import { formatBytes } from "@/utils/format";
import { Config } from "@/config";
import {
  presignImageUpload,
  uploadToPresigned,
  finalizeImage,
  getImagesMonthlyQuota,
  checkImageExistenceDirectly,
} from "@/api/media";

export type DialogFileItem = {
  id: string;
  file: File;
  name: string;
  type: string;
  size: number;
};

export type UploadResult =
  | { ok: true; objectKey: string }
  | { ok: false; error: string; name: string };

type SelectedItem = {
  id: string;
  file: File;
  name: string;
  type: string;
  size: number;
  previewUrl?: string;
  originalPreviewUrl?: string;
  optimizedPreviewUrl?: string;
  decodable: boolean;
  width?: number;
  height?: number;
  optimize: boolean;
  needsAutoOptimize: boolean;
  forceOptimize: boolean;
  optimized?: {
    blob: Blob;
    size: number;
    width: number;
    height: number;
  };
  status: "pending" | "optimizing" | "ready" | "uploading" | "done" | "error";
  error?: string;
  hash?: string;
  reusableUserId?: string;
  reusableRestPath?: string;
  reuse?: boolean;
  edit?: ImageEditParams;
};

type ImageCropInsets = {
  top: number;
  bottom: number;
  left: number;
  right: number;
};

export type ImageMosaicRegion = {
  left: number;
  top: number;
  right: number;
  bottom: number;
};

export type ImageEditParams = {
  crop: ImageCropInsets;
  temperature: number;
  tint: number;
  exposureEv: number;
  scaledLog: number;
  sigmoid: number;
  vibrance: number;
  saturation: number;
  resizePercent: number;
  mosaicRegions: ImageMosaicRegion[];
};

export type ImageEditOutputFormat = "image/webp" | "image/jpeg" | "image/png";

type Props = {
  userId: string;
  files: DialogFileItem[];
  maxCount: number;
  onClose: () => void;
  onComplete: (result: UploadResult[]) => void;
};

function changeExtToWebp(name: string): string {
  return name.replace(/\.[^.]+$/, "") + ".webp";
}

const PASS_THROUGH_MIMES = new Set(["image/jpeg", "image/png", "image/webp"]);
const PASS_THROUGH_EXTS = new Set(["jpg", "jpeg", "png", "webp"]);
function isPassThroughType(name: string, type: string): boolean {
  const t = (type || "").toLowerCase();
  if (PASS_THROUGH_MIMES.has(t)) return true;
  const ext = (name.split(".").pop() || "").toLowerCase();
  return PASS_THROUGH_EXTS.has(ext);
}

function isSvg(name: string, type: string) {
  const t = (type || "").toLowerCase();
  if (t === "image/svg+xml") return true;
  const ext = (name.split(".").pop() || "").toLowerCase();
  return ext === "svg";
}

function isTiff(name: string, type: string) {
  const t = (type || "").toLowerCase();
  if (t === "image/tiff" || t === "image/tif") return true;
  const ext = (name.split(".").pop() || "").toLowerCase();
  return ext === "tif" || ext === "tiff";
}

function parseSvgSize(svg: string): { w: number; h: number } | null {
  try {
    const doc = new DOMParser().parseFromString(svg, "image/svg+xml");
    const svgEl = doc.documentElement;
    if (!svgEl || svgEl.tagName.toLowerCase() !== "svg") return null;
    const parseLen = (v?: string | null) => {
      if (!v) return NaN;
      const m = String(v)
        .trim()
        .match(/^([0-9.]+)(px|pt|pc|cm|mm|in|%)?$/i);
      if (!m) return NaN;
      const n = parseFloat(m[1]);
      return Number.isFinite(n) ? n : NaN;
    };
    let w = parseLen(svgEl.getAttribute("width"));
    let h = parseLen(svgEl.getAttribute("height"));
    if (!Number.isFinite(w) || !Number.isFinite(h)) {
      const vb = (svgEl.getAttribute("viewBox") || "").split(/\s+/).map(Number);
      if (vb.length === 4 && vb.every((x) => Number.isFinite(x))) {
        const vbW = Math.max(1, Math.round(vb[2]));
        const vbH = Math.max(1, Math.round(vb[3]));
        w = Number.isFinite(w) ? w : vbW;
        h = Number.isFinite(h) ? h : vbH;
      }
    }
    if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) {
      return null;
    }
    return { w: Math.round(w), h: Math.round(h) };
  } catch {
    return null;
  }
}

function normalizeSvg(svg: string, targetW: number, targetH: number): string {
  try {
    const doc = new DOMParser().parseFromString(svg, "image/svg+xml");
    const svgEl = doc.documentElement;
    if (!svgEl || svgEl.tagName.toLowerCase() !== "svg") return svg;
    svgEl.setAttribute("width", String(targetW));
    svgEl.setAttribute("height", String(targetH));
    if (!svgEl.getAttribute("viewBox")) {
      svgEl.setAttribute("viewBox", `0 0 ${targetW} ${targetH}`);
    }
    const ser = new XMLSerializer();
    return ser.serializeToString(svgEl);
  } catch {
    return svg;
  }
}

async function readMeta(file: File): Promise<{
  decodable: boolean;
  width?: number;
  height?: number;
  previewUrl?: string;
}> {
  let objectUrl: string | undefined;
  try {
    objectUrl = URL.createObjectURL(file);
    if ("createImageBitmap" in window) {
      try {
        const bmp = await createImageBitmap(file);
        const out = {
          decodable: true,
          width: bmp.width,
          height: bmp.height,
          previewUrl: objectUrl,
        };
        bmp.close?.();
        return out;
      } catch {}
    }
    const img = document.createElement("img");
    img.decoding = "async";
    const meta = await new Promise<{ w?: number; h?: number; ok: boolean }>((resolve) => {
      img.onload = () => resolve({ w: img.naturalWidth, h: img.naturalHeight, ok: true });
      img.onerror = () => resolve({ ok: false });
      img.src = objectUrl!;
    });
    if (meta.ok && meta.w && meta.h) {
      return { decodable: true, width: meta.w, height: meta.h, previewUrl: objectUrl };
    }
    return { decodable: false, previewUrl: objectUrl };
  } catch {
    if (objectUrl) URL.revokeObjectURL(objectUrl);
    return { decodable: false };
  }
}

function computeScale(w: number, h: number): number {
  const longSide = Math.max(w, h);
  const s1 = Config.IMAGE_OPTIMIZE_TARGET_LONGSIDE / longSide;
  const s2 = Math.sqrt(Config.IMAGE_OPTIMIZE_TARGET_PIXELS / (w * h));
  return Math.min(1, s1, s2);
}

function clamp01(v: number): number {
  return Math.min(1, Math.max(0, v));
}

function clampExposureEv(v: number): number {
  return Math.min(5, Math.max(-5, Math.round(v * 10) / 10));
}

function clampWhiteBalanceValue(v: number): number {
  return Math.min(100, Math.max(-100, Math.round(v)));
}

function clampScaledLog(v: number): number {
  return Math.min(16, Math.max(-16, Math.round(v * 10) / 10));
}

function clampSigmoid(v: number): number {
  return Math.min(10, Math.max(-10, Math.round(v * 10) / 10));
}

function clampColorAdjustment(v: number): number {
  return Math.min(100, Math.max(-100, Math.round(v)));
}

function defaultResizePercent(w?: number, h?: number): number {
  if (!w || !h || w <= 0 || h <= 0) return 100;
  return Math.min(100, Math.max(1, Math.round(computeScale(w, h) * 100)));
}

function normalizeCrop(crop?: Partial<ImageCropInsets>): ImageCropInsets {
  const top = clamp01(crop?.top ?? 0);
  const bottom = clamp01(crop?.bottom ?? 0);
  const left = clamp01(crop?.left ?? 0);
  const right = clamp01(crop?.right ?? 0);
  const sumTB = top + bottom;
  const sumLR = left + right;
  return {
    top: sumTB >= 0.99 ? top / sumTB * 0.99 : top,
    bottom: sumTB >= 0.99 ? bottom / sumTB * 0.99 : bottom,
    left: sumLR >= 0.99 ? left / sumLR * 0.99 : left,
    right: sumLR >= 0.99 ? right / sumLR * 0.99 : right,
  };
}

function normalizeMosaicRegion(region: Partial<ImageMosaicRegion>): ImageMosaicRegion | null {
  const left = clamp01(Math.min(region.left ?? 0, region.right ?? 0));
  const right = clamp01(Math.max(region.left ?? 0, region.right ?? 0));
  const top = clamp01(Math.min(region.top ?? 0, region.bottom ?? 0));
  const bottom = clamp01(Math.max(region.top ?? 0, region.bottom ?? 0));
  if (right - left <= 0 || bottom - top <= 0) return null;
  return { left, top, right, bottom };
}

function normalizeMosaicRegions(regions?: ImageMosaicRegion[]): ImageMosaicRegion[] {
  if (!regions?.length) return [];
  return regions
    .map((region) => normalizeMosaicRegion(region))
    .filter((region): region is ImageMosaicRegion => region !== null);
}

export function buildDefaultEditParams(w?: number, h?: number): ImageEditParams {
  return {
    crop: { top: 0, bottom: 0, left: 0, right: 0 },
    temperature: 0,
    tint: 0,
    exposureEv: 0,
    scaledLog: 0,
    sigmoid: 0,
    vibrance: 0,
    saturation: 0,
    resizePercent: defaultResizePercent(w, h),
    mosaicRegions: [],
  };
}

function normalizeEditParams(params: ImageEditParams | undefined, w?: number, h?: number): ImageEditParams {
  const defaults = buildDefaultEditParams(w, h);
  return {
    crop: normalizeCrop(params?.crop ?? defaults.crop),
    temperature: clampWhiteBalanceValue(params?.temperature ?? defaults.temperature),
    tint: clampWhiteBalanceValue(params?.tint ?? defaults.tint),
    exposureEv: clampExposureEv(params?.exposureEv ?? defaults.exposureEv),
    scaledLog: clampScaledLog(params?.scaledLog ?? defaults.scaledLog),
    sigmoid: clampSigmoid(params?.sigmoid ?? defaults.sigmoid),
    vibrance: clampColorAdjustment(params?.vibrance ?? defaults.vibrance),
    saturation: clampColorAdjustment(params?.saturation ?? defaults.saturation),
    resizePercent: Math.min(100, Math.max(1, Math.round(params?.resizePercent ?? defaults.resizePercent))),
    mosaicRegions: normalizeMosaicRegions(params?.mosaicRegions ?? defaults.mosaicRegions),
  };
}

function isMeaningfullyEdited(params: ImageEditParams | undefined, w?: number, h?: number): boolean {
  if (!params) return false;
  const normalized = normalizeEditParams(params, w, h);
  const defaults = buildDefaultEditParams(w, h);
  return (
    normalized.crop.top > 0 ||
    normalized.crop.bottom > 0 ||
    normalized.crop.left > 0 ||
    normalized.crop.right > 0 ||
    normalized.temperature !== 0 ||
    normalized.tint !== 0 ||
    Math.abs(normalized.exposureEv) > 0.0001 ||
    Math.abs(normalized.scaledLog) > 0.0001 ||
    Math.abs(normalized.sigmoid) > 0.0001 ||
    normalized.vibrance !== 0 ||
    normalized.saturation !== 0 ||
    normalized.resizePercent !== defaults.resizePercent ||
    normalized.mosaicRegions.length > 0
  );
}

function colorSaturationFactor(saturation: number): number {
  return Math.max(0, 1 + clampColorAdjustment(saturation) / 100);
}

function colorVibranceFactor(vibrance: number): number {
  return clampColorAdjustment(vibrance) * 3 / 100;
}

function formatSignedEv(v: number): string {
  return `${v >= 0 ? "+" : ""}${v.toFixed(1)}EV`;
}

function srgbChannelToLinear(v: number): number {
  const x = clamp01(v / 255);
  if (x <= 0.04045) return x / 12.92;
  return Math.pow((x + 0.055) / 1.055, 2.4);
}

function linearChannelToSrgb(linear: number): number {
  const x = clamp01(linear);
  const srgb = x <= 0.0031308 ? x * 12.92 : 1.055 * Math.pow(x, 1 / 2.4) - 0.055;
  return Math.round(clamp01(srgb) * 255);
}

type WhiteBalanceGains = { r: number; g: number; b: number };

function whiteBalanceGains(temperature: number, tint: number): WhiteBalanceGains {
  const t = clampWhiteBalanceValue(temperature) / 100;
  const m = clampWhiteBalanceValue(tint) / 100;

  // Work in log2 gain space so the three gains have a geometric mean of 1.
  // Positive temperature warms (R up, B down); positive tint moves toward magenta
  // (R/B up, G down) without introducing a global exposure shift.
  const temperatureStops = t * 1.5;
  const tintStops = m * 0.75;
  const rStops = temperatureStops + tintStops / 2;
  const gStops = -tintStops;
  const bStops = -temperatureStops + tintStops / 2;
  return {
    r: Math.pow(2, rStops),
    g: Math.pow(2, gStops),
    b: Math.pow(2, bStops),
  };
}

function applyWhiteBalanceLinear(
  r: number,
  g: number,
  b: number,
  gains: WhiteBalanceGains,
): [number, number, number] {
  // Match the existing itb_stack white-balance behavior: progressively reduce
  // correction toward white so neutral highlights stay neutral.
  const gray = 0.299 * r + 0.587 * g + 0.114 * b;
  const whiteThreshold = 0.98;
  const weight = 1 - clamp01((gray - (1 - whiteThreshold)) / whiteThreshold);
  const wr = weight * gains.r + (1 - weight);
  const wg = weight * gains.g + (1 - weight);
  const wb = weight * gains.b + (1 - weight);
  return [clamp01(r * wr), clamp01(g * wg), clamp01(b * wb)];
}

function exposedPercentileFromRgb8(
  data: Uint8ClampedArray,
  factor: number,
  percentile = 99.8,
): number {
  const histogram = new Uint32Array(256);
  let sampleCount = 0;
  for (let i = 0; i < data.length; i += 4) {
    histogram[data[i]]++;
    histogram[data[i + 1]]++;
    histogram[data[i + 2]]++;
    sampleCount += 3;
  }
  if (sampleCount <= 0) return 0;

  // NumPy's default percentile uses linear interpolation at
  // rank = (N - 1) * percentile / 100. Because ImageData channels are 8 bit,
  // a 256-bin histogram reproduces that percentile without sorting all pixels.
  const rank = (sampleCount - 1) * Math.min(100, Math.max(0, percentile)) / 100;
  const lowerRank = Math.floor(rank);
  const upperRank = Math.ceil(rank);
  const fraction = rank - lowerRank;

  let cumulative = 0;
  let lowerLevel = 255;
  let upperLevel = 255;
  let lowerFound = false;
  for (let level = 0; level < histogram.length; level++) {
    cumulative += histogram[level];
    if (!lowerFound && cumulative > lowerRank) {
      lowerLevel = level;
      lowerFound = true;
    }
    if (cumulative > upperRank) {
      upperLevel = level;
      break;
    }
  }

  const lower = srgbChannelToLinear(lowerLevel) * factor;
  const upper = srgbChannelToLinear(upperLevel) * factor;
  return lower + (upper - lower) * fraction;
}

function whiteBalancedExposedPercentileFromRgb8(
  data: Uint8ClampedArray,
  gains: WhiteBalanceGains,
  factor: number,
  percentile = 99.8,
): number {
  const histogram = new Uint32Array(65536);
  let sampleCount = 0;
  for (let i = 0; i < data.length; i += 4) {
    const r = srgbChannelToLinear(data[i]);
    const g = srgbChannelToLinear(data[i + 1]);
    const b = srgbChannelToLinear(data[i + 2]);
    const [wr, wg, wb] = applyWhiteBalanceLinear(r, g, b, gains);
    histogram[Math.min(65535, Math.max(0, Math.round(wr * 65535)))]++;
    histogram[Math.min(65535, Math.max(0, Math.round(wg * 65535)))]++;
    histogram[Math.min(65535, Math.max(0, Math.round(wb * 65535)))]++;
    sampleCount += 3;
  }
  if (sampleCount <= 0) return 0;

  const rank = (sampleCount - 1) * Math.min(100, Math.max(0, percentile)) / 100;
  const lowerRank = Math.floor(rank);
  const upperRank = Math.ceil(rank);
  const fraction = rank - lowerRank;
  let cumulative = 0;
  let lowerLevel = 65535;
  let upperLevel = 65535;
  let lowerFound = false;
  for (let level = 0; level < histogram.length; level++) {
    cumulative += histogram[level];
    if (!lowerFound && cumulative > lowerRank) {
      lowerLevel = level;
      lowerFound = true;
    }
    if (cumulative > upperRank) {
      upperLevel = level;
      break;
    }
  }
  const lower = lowerLevel / 65535 * factor;
  const upper = upperLevel / 65535 * factor;
  return lower + (upper - lower) * fraction;
}

function applyScaledLogLinear(value: number, factor: number): number {
  const x = clamp01(value);
  const f = clampScaledLog(factor);
  if (f > 1e-6) {
    return clamp01(Math.log1p(x * f) / Math.log1p(f));
  }
  if (f < -1e-6) {
    const magnitude = -f;
    return clamp01(Math.expm1(x * Math.log1p(magnitude)) / magnitude);
  }
  return x;
}

function naiveSigmoid(value: number, gain: number, mid: number): number {
  return 1 / (1 + Math.exp((mid - value) * gain));
}

function naiveInverseSigmoid(value: number, gain: number, mid: number): number {
  const minVal = naiveSigmoid(0, gain, mid);
  const maxVal = naiveSigmoid(1, gain, mid);
  const a = (maxVal - minVal) * value + minVal;
  return -Math.log(1 / a - 1) / gain;
}

function applySigmoidLinear(value: number, gain: number): number {
  const x = clamp01(value);
  const g = clampSigmoid(gain);
  const mid = 0.5;
  if (g > 1e-6) {
    const minVal = naiveSigmoid(0, g, mid);
    const maxVal = naiveSigmoid(1, g, mid);
    return clamp01((naiveSigmoid(x, g, mid) - minVal) / (maxVal - minVal));
  }
  if (g < -1e-6) {
    const magnitude = -g;
    const minVal = naiveInverseSigmoid(0, magnitude, mid);
    const maxVal = naiveInverseSigmoid(1, magnitude, mid);
    return clamp01(
      (naiveInverseSigmoid(x, magnitude, mid) - minVal) / (maxVal - minVal),
    );
  }
  return x;
}

function rgbToHsv(r: number, g: number, b: number): [number, number, number] {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;
  let h = 0;
  if (delta > 1e-6) {
    if (max === r) {
      h = ((g - b) / delta) % 6;
    } else if (max === g) {
      h = (b - r) / delta + 2;
    } else {
      h = (r - g) / delta + 4;
    }
    h /= 6;
    if (h < 0) h += 1;
  }
  const s = max <= 1e-6 ? 0 : delta / max;
  const v = max;
  return [h, clamp01(s), clamp01(v)];
}

function hsvToRgb(h: number, s: number, v: number): [number, number, number] {
  const hh = ((h % 1) + 1) % 1 * 6;
  const c = clamp01(v) * clamp01(s);
  const x = c * (1 - Math.abs(hh % 2 - 1));
  const m = clamp01(v) - c;
  let rp = 0;
  let gp = 0;
  let bp = 0;
  if (hh < 1) {
    rp = c;
    gp = x;
  } else if (hh < 2) {
    rp = x;
    gp = c;
  } else if (hh < 3) {
    gp = c;
    bp = x;
  } else if (hh < 4) {
    gp = x;
    bp = c;
  } else if (hh < 5) {
    rp = x;
    bp = c;
  } else {
    rp = c;
    bp = x;
  }
  return [clamp01(rp + m), clamp01(gp + m), clamp01(bp + m)];
}

function rolloffParams(
  maxVal: number,
  asymptotic = 0.5,
  savingLimit = 4,
): { inflection: number; scale: number } | null {
  if (maxVal <= 1) return null;
  if (maxVal > savingLimit) {
    asymptotic = Math.pow(asymptotic, savingLimit / maxVal);
  }
  const inflection = asymptotic + (1 - asymptotic) / maxVal;
  const scale = (1 - inflection) / (maxVal - inflection + 1e-6);
  return { inflection, scale };
}

function applyRolloffScalar(value: number, rolloff: { inflection: number; scale: number } | null): number {
  if (!rolloff || value <= rolloff.inflection) return value;
  return rolloff.inflection + (value - rolloff.inflection) * rolloff.scale;
}

function applyToneLinearToRgb(
  r: number,
  g: number,
  b: number,
  gains: WhiteBalanceGains,
  hasWhiteBalance: boolean,
  factor: number,
  rolloff: { inflection: number; scale: number } | null,
  scaledLog: number,
  sigmoid: number,
): [number, number, number] {
  if (hasWhiteBalance) {
    [r, g, b] = applyWhiteBalanceLinear(r, g, b, gains);
  }
  r *= factor;
  g *= factor;
  b *= factor;
  r = applyRolloffScalar(r, rolloff);
  g = applyRolloffScalar(g, rolloff);
  b = applyRolloffScalar(b, rolloff);
  r = applyScaledLogLinear(clamp01(r), scaledLog);
  g = applyScaledLogLinear(clamp01(g), scaledLog);
  b = applyScaledLogLinear(clamp01(b), scaledLog);
  r = applySigmoidLinear(r, sigmoid);
  g = applySigmoidLinear(g, sigmoid);
  b = applySigmoidLinear(b, sigmoid);
  return [r, g, b];
}

function saturatedPercentileAfterToneFromRgb8(
  data: Uint8ClampedArray,
  gains: WhiteBalanceGains,
  hasWhiteBalance: boolean,
  factor: number,
  rolloff: { inflection: number; scale: number } | null,
  scaledLog: number,
  sigmoid: number,
  saturationFactor: number,
  percentile = 99,
): number {
  if (saturationFactor <= 1) return 0;
  const bins = 4096;
  const maxValue = Math.max(1, saturationFactor);
  const histogram = new Uint32Array(bins);
  let sampleCount = 0;
  for (let i = 0; i < data.length; i += 4) {
    let r = srgbChannelToLinear(data[i]);
    let g = srgbChannelToLinear(data[i + 1]);
    let b = srgbChannelToLinear(data[i + 2]);
    [r, g, b] = applyToneLinearToRgb(
      r,
      g,
      b,
      gains,
      hasWhiteBalance,
      factor,
      rolloff,
      scaledLog,
      sigmoid,
    );
    const [, s] = rgbToHsv(r, g, b);
    const value = Math.min(maxValue, Math.max(0, s * saturationFactor));
    const idx = Math.min(bins - 1, Math.max(0, Math.round(value / maxValue * (bins - 1))));
    histogram[idx]++;
    sampleCount += 1;
  }
  if (sampleCount <= 0) return 0;
  const rank = (sampleCount - 1) * Math.min(100, Math.max(0, percentile)) / 100;
  const lowerRank = Math.floor(rank);
  const upperRank = Math.ceil(rank);
  const fraction = rank - lowerRank;
  let cumulative = 0;
  let lowerLevel = bins - 1;
  let upperLevel = bins - 1;
  let lowerFound = false;
  for (let level = 0; level < bins; level++) {
    cumulative += histogram[level];
    if (!lowerFound && cumulative > lowerRank) {
      lowerLevel = level;
      lowerFound = true;
    }
    if (cumulative > upperRank) {
      upperLevel = level;
      break;
    }
  }
  const interpolated = lowerLevel + (upperLevel - lowerLevel) * fraction;
  return maxValue * interpolated / (bins - 1);
}

function applyColorAdjustmentsToCanvas(
  canvas: HTMLCanvasElement | OffscreenCanvas,
  temperature: number,
  tint: number,
  exposureEv: number,
  scaledLog: number,
  sigmoid: number,
  vibrance: number,
  saturation: number,
) {
  const normalizedTemperature = clampWhiteBalanceValue(temperature);
  const normalizedTint = clampWhiteBalanceValue(tint);
  const normalizedScaledLog = clampScaledLog(scaledLog);
  const normalizedSigmoid = clampSigmoid(sigmoid);
  const normalizedVibrance = clampColorAdjustment(vibrance);
  const normalizedSaturation = clampColorAdjustment(saturation);
  if (
    normalizedTemperature === 0 &&
    normalizedTint === 0 &&
    Math.abs(exposureEv) < 0.0001 &&
    Math.abs(normalizedScaledLog) < 0.0001 &&
    Math.abs(normalizedSigmoid) < 0.0001 &&
    normalizedVibrance === 0 &&
    normalizedSaturation === 0
  ) {
    return;
  }
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const factor = Math.pow(2, exposureEv);
  const width = "width" in canvas ? canvas.width : 0;
  const height = "height" in canvas ? canvas.height : 0;
  if (!width || !height) return;
  const imageData = ctx.getImageData(0, 0, width, height);
  const data = imageData.data;
  const gains = whiteBalanceGains(normalizedTemperature, normalizedTint);
  const hasWhiteBalance = normalizedTemperature !== 0 || normalizedTint !== 0;
  const maxVal =
    factor > 1
      ? hasWhiteBalance
        ? whiteBalancedExposedPercentileFromRgb8(data, gains, factor, 99.8)
        : exposedPercentileFromRgb8(data, factor, 99.8)
      : 0;
  const rolloff = factor > 1 ? rolloffParams(maxVal, 0.5, 4) : null;
  const saturationFactor = colorSaturationFactor(normalizedSaturation);
  const vibranceFactor = colorVibranceFactor(normalizedVibrance);
  const saturationRolloff = saturationFactor > 1
    ? rolloffParams(
        saturatedPercentileAfterToneFromRgb8(
          data,
          gains,
          hasWhiteBalance,
          factor,
          rolloff,
          normalizedScaledLog,
          normalizedSigmoid,
          saturationFactor,
          99,
        ),
        0.7,
        4,
      )
    : null;
  for (let i = 0; i < data.length; i += 4) {
    let r = srgbChannelToLinear(data[i]);
    let g = srgbChannelToLinear(data[i + 1]);
    let b = srgbChannelToLinear(data[i + 2]);
    [r, g, b] = applyToneLinearToRgb(
      r,
      g,
      b,
      gains,
      hasWhiteBalance,
      factor,
      rolloff,
      normalizedScaledLog,
      normalizedSigmoid,
    );
    if (normalizedSaturation !== 0 || normalizedVibrance !== 0) {
      const [h, initialS, v] = rgbToHsv(r, g, b);
      let s = initialS;
      if (normalizedSaturation !== 0) {
        s = applyRolloffScalar(s * saturationFactor, saturationRolloff);
        s = clamp01(s);
      }
      if (normalizedVibrance !== 0) {
        s = applyScaledLogLinear(s, vibranceFactor);
      }
      [r, g, b] = hsvToRgb(h, s, v);
    }
    data[i] = linearChannelToSrgb(r);
    data[i + 1] = linearChannelToSrgb(g);
    data[i + 2] = linearChannelToSrgb(b);
  }
  ctx.putImageData(imageData, 0, 0);
}

type MosaicPixelRect = { x: number; y: number; w: number; h: number };

function applyMosaicRectsToCanvas(
  canvas: HTMLCanvasElement | OffscreenCanvas,
  rects: MosaicPixelRect[],
  divisions = 16,
) {
  if (!rects.length || divisions <= 0) return;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const width = canvas.width;
  const height = canvas.height;
  const grid = Math.max(1, Math.round(divisions));
  for (const rect of rects) {
    const x0 = Math.max(0, Math.min(width, Math.floor(rect.x)));
    const y0 = Math.max(0, Math.min(height, Math.floor(rect.y)));
    const x1 = Math.max(x0, Math.min(width, Math.ceil(rect.x + rect.w)));
    const y1 = Math.max(y0, Math.min(height, Math.ceil(rect.y + rect.h)));
    const rw = x1 - x0;
    const rh = y1 - y0;
    if (rw <= 0 || rh <= 0) continue;
    const imageData = ctx.getImageData(x0, y0, rw, rh);
    const data = imageData.data;
    for (let gy = 0; gy < grid; gy++) {
      const ty = Math.floor(gy * rh / grid);
      const yEnd = Math.floor((gy + 1) * rh / grid);
      const th = yEnd - ty;
      if (th <= 0) continue;
      for (let gx = 0; gx < grid; gx++) {
        const tx = Math.floor(gx * rw / grid);
        const xEnd = Math.floor((gx + 1) * rw / grid);
        const tw = xEnd - tx;
        if (tw <= 0) continue;
        let sumR = 0;
        let sumG = 0;
        let sumB = 0;
        let sumA = 0;
        let count = 0;
        for (let py = 0; py < th; py++) {
          let offset = ((ty + py) * rw + tx) * 4;
          for (let px = 0; px < tw; px++, offset += 4) {
            sumR += data[offset];
            sumG += data[offset + 1];
            sumB += data[offset + 2];
            sumA += data[offset + 3];
            count++;
          }
        }
        if (!count) continue;
        const avgR = Math.round(sumR / count);
        const avgG = Math.round(sumG / count);
        const avgB = Math.round(sumB / count);
        const avgA = Math.round(sumA / count);
        for (let py = 0; py < th; py++) {
          let offset = ((ty + py) * rw + tx) * 4;
          for (let px = 0; px < tw; px++, offset += 4) {
            data[offset] = avgR;
            data[offset + 1] = avgG;
            data[offset + 2] = avgB;
            data[offset + 3] = avgA;
          }
        }
      }
    }
    ctx.putImageData(imageData, x0, y0);
  }
}

function mosaicRegionsToOutputRects(
  regions: ImageMosaicRegion[],
  sourceW: number,
  sourceH: number,
  cropX: number,
  cropY: number,
  cropW: number,
  cropH: number,
  outputW: number,
  outputH: number,
): MosaicPixelRect[] {
  const scaleX = outputW / cropW;
  const scaleY = outputH / cropH;
  return regions.flatMap((region) => {
    const left = region.left * sourceW;
    const top = region.top * sourceH;
    const right = region.right * sourceW;
    const bottom = region.bottom * sourceH;
    const ix0 = Math.max(cropX, left);
    const iy0 = Math.max(cropY, top);
    const ix1 = Math.min(cropX + cropW, right);
    const iy1 = Math.min(cropY + cropH, bottom);
    if (ix1 <= ix0 || iy1 <= iy0) return [];
    return [{
      x: (ix0 - cropX) * scaleX,
      y: (iy0 - cropY) * scaleY,
      w: (ix1 - ix0) * scaleX,
      h: (iy1 - iy0) * scaleY,
    }];
  });
}

type OffscreenCanvasCtor = new (width: number, height: number) => OffscreenCanvas;
function getOffscreenCanvasCtor(): OffscreenCanvasCtor | null {
  const g = globalThis as unknown as { OffscreenCanvas?: OffscreenCanvasCtor };
  return typeof g.OffscreenCanvas === "function" ? g.OffscreenCanvas : null;
}

async function decodeViaImg(file: File): Promise<HTMLImageElement> {
  const url = URL.createObjectURL(file);
  try {
    const img = document.createElement("img");
    img.crossOrigin = "anonymous";
    img.decoding = "async";
    const ok = await new Promise<boolean>((resolve) => {
      img.onload = () => resolve(true);
      img.onerror = () => resolve(false);
      img.src = url;
    });
    if (!ok || !img.naturalWidth || !img.naturalHeight) {
      throw new Error("image decode failed");
    }
    return img;
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }
}

async function decodeEditableSource(
  file: File,
  srcW: number,
  srcH: number,
  name?: string,
  type?: string,
): Promise<{ source: CanvasImageSource; width: number; height: number; cleanup: () => void }> {
  if (isTiff(name || "", type || "")) {
    const UTIF: typeof import("utif") = await import("utif");
    const buf = await file.arrayBuffer();
    const ifds = UTIF.decode(buf);
    if (!ifds || ifds.length === 0) throw new Error("TIFF decode failed: no IFD");
    UTIF.decodeImage(buf, ifds[0]);
    type TiffIFDSize = { width: number; height: number };
    const { width, height } = ifds[0] as TiffIFDSize;
    if (!width || !height) throw new Error("TIFF decode failed: invalid size");
    const rgba = UTIF.toRGBA8(ifds[0]);
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("2D context unavailable");
    ctx.putImageData(new ImageData(new Uint8ClampedArray(rgba), width, height), 0, 0);
    return { source: canvas, width, height, cleanup: () => {} };
  }

  if (isSvg(name || "", type || "")) {
    const svgText = await file.text();
    let size = parseSvgSize(svgText);
    if (!size) {
      const fallback = Math.max(1, Number(Config.IMAGE_OPTIMIZE_TARGET_LONGSIDE) || 1200);
      size = { w: fallback, h: fallback };
    }
    const normalizedSvg = normalizeSvg(svgText, size.w, size.h);
    const svgBlob = new Blob([normalizedSvg], { type: "image/svg+xml" });
    try {
      const bmp = await createImageBitmap(svgBlob);
      return {
        source: bmp,
        width: bmp.width || size.w,
        height: bmp.height || size.h,
        cleanup: () => bmp.close?.(),
      };
    } catch {
      const url = URL.createObjectURL(svgBlob);
      try {
        const img = document.createElement("img");
        img.decoding = "async";
        const ok = await new Promise<boolean>((resolve) => {
          img.onload = () => resolve(true);
          img.onerror = () => resolve(false);
          img.src = url;
        });
        if (!ok) throw new Error("svg decode via <img> failed");
        return {
          source: img,
          width: img.naturalWidth || size.w,
          height: img.naturalHeight || size.h,
          cleanup: () => setTimeout(() => URL.revokeObjectURL(url), 0),
        };
      } catch (e) {
        URL.revokeObjectURL(url);
        throw e;
      }
    }
  }

  try {
    const bmp = await createImageBitmap(file);
    return { source: bmp, width: bmp.width || srcW, height: bmp.height || srcH, cleanup: () => bmp.close?.() };
  } catch {
    const img = await decodeViaImg(file);
    return {
      source: img,
      width: img.naturalWidth || srcW,
      height: img.naturalHeight || srcH,
      cleanup: () => {},
    };
  }
}

export async function buildOptimizedVariant(
  file: File,
  srcW: number,
  srcH: number,
  quality = 0.8,
  name?: string,
  type?: string,
  edit?: ImageEditParams,
  outputFormat: ImageEditOutputFormat = "image/webp",
): Promise<{ blob: Blob; width: number; height: number }> {
  const params = normalizeEditParams(edit, srcW, srcH);
  const decoded = await decodeEditableSource(file, srcW, srcH, name, type);
  const { source, cleanup } = decoded;
  const w = decoded.width;
  const h = decoded.height;
  try {
    const crop = normalizeCrop(params.crop);
    const sx = Math.max(0, Math.min(w - 1, Math.round(w * crop.left)));
    const sy = Math.max(0, Math.min(h - 1, Math.round(h * crop.top)));
    const ex = Math.max(sx + 1, Math.min(w, Math.round(w * (1 - crop.right))));
    const ey = Math.max(sy + 1, Math.min(h, Math.round(h * (1 - crop.bottom))));
    const sw = Math.max(1, ex - sx);
    const sh = Math.max(1, ey - sy);
    const dw = Math.max(1, Math.round(sw * params.resizePercent / 100));
    const dh = Math.max(1, Math.round(sh * params.resizePercent / 100));
    let blob: Blob | null = null;
    const OSC = getOffscreenCanvasCtor();
    if (OSC) {
      // Keep the processing order explicit: crop -> white balance -> exposure/rolloff
      // -> logarithm -> sigmoid -> vibrance/saturation -> resize -> mosaic -> encode.
      // White balance, tone, and color adjustments share one linear-RGB pass so
      // there is no extra 8-bit round-trip between them.
      const cropped = new OSC(sw, sh);
      const croppedCtx = cropped.getContext("2d");
      if (!croppedCtx) throw new Error("2D context unavailable");
      croppedCtx.drawImage(source, sx, sy, sw, sh, 0, 0, sw, sh);
      applyColorAdjustmentsToCanvas(
        cropped,
        params.temperature,
        params.tint,
        params.exposureEv,
        params.scaledLog,
        params.sigmoid,
        params.vibrance,
        params.saturation,
      );

      const output = new OSC(dw, dh);
      const outputCtx = output.getContext("2d");
      if (!outputCtx) throw new Error("2D context unavailable");
      outputCtx.imageSmoothingEnabled = true;
      outputCtx.imageSmoothingQuality = "high";
      outputCtx.drawImage(cropped, 0, 0, sw, sh, 0, 0, dw, dh);
      applyMosaicRectsToCanvas(
        output,
        mosaicRegionsToOutputRects(params.mosaicRegions, w, h, sx, sy, sw, sh, dw, dh),
        16,
      );
      if ("convertToBlob" in output) {
        type EncodeOpts = { type?: string; quality?: number };
        const conv = (output as OffscreenCanvas & { convertToBlob(options?: EncodeOpts): Promise<Blob> })
          .convertToBlob;
        blob = await conv.call(output, { type: outputFormat, quality });
      }
    }
    if (!blob) {
      const cropped = document.createElement("canvas");
      cropped.width = sw;
      cropped.height = sh;
      const croppedCtx = cropped.getContext("2d");
      if (!croppedCtx) throw new Error("2D context unavailable");
      croppedCtx.drawImage(source, sx, sy, sw, sh, 0, 0, sw, sh);
      applyColorAdjustmentsToCanvas(
        cropped,
        params.temperature,
        params.tint,
        params.exposureEv,
        params.scaledLog,
        params.sigmoid,
        params.vibrance,
        params.saturation,
      );

      const output = document.createElement("canvas");
      output.width = dw;
      output.height = dh;
      const outputCtx = output.getContext("2d");
      if (!outputCtx) throw new Error("2D context unavailable");
      outputCtx.imageSmoothingEnabled = true;
      outputCtx.imageSmoothingQuality = "high";
      outputCtx.drawImage(cropped, 0, 0, sw, sh, 0, 0, dw, dh);
      applyMosaicRectsToCanvas(
        output,
        mosaicRegionsToOutputRects(params.mosaicRegions, w, h, sx, sy, sw, sh, dw, dh),
        16,
      );
      blob = await new Promise<Blob>((resolve, reject) =>
        output.toBlob(
          (b) => (b ? resolve(b) : reject(new Error("toBlob returned null"))),
          outputFormat,
          quality,
        ),
      );
    }
    if (!blob || !blob.size || !dw || !dh) {
      throw new Error("invalid optimized output");
    }
    return { blob, width: dw, height: dh };
  } finally {
    cleanup();
  }
}

function shouldAutoOptimize(meta: Pick<SelectedItem, "width" | "height" | "size">): boolean {
  const { width, height, size } = meta;
  const pixelCount = (width ?? 0) * (height ?? 0);
  const longSide = Math.max(width ?? 0, height ?? 0);
  return (
    longSide > Config.IMAGE_OPTIMIZE_TRIGGER_LONGSIDE ||
    pixelCount > Config.IMAGE_OPTIMIZE_TRIGGER_PIXELS ||
    size > Config.IMAGE_OPTIMIZE_TRIGGER_BYTES
  );
}

async function sha256Hex(file: File): Promise<string> {
  const buf = await file.arrayBuffer();
  const digest = await crypto.subtle.digest("SHA-256", buf);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

type LruItem = { hash: string; userId: string; restPath: string };
const LRU_STORAGE_KEY = "mediaReusableObjects";
const LRU_CAPACITY = 200;

function loadLru(): LruItem[] {
  try {
    const s = localStorage.getItem(LRU_STORAGE_KEY);
    const v = s ? JSON.parse(s) : [];
    if (!Array.isArray(v)) return [];
    return v.filter(
      (x) =>
        x &&
        typeof x.hash === "string" &&
        typeof x.userId === "string" &&
        typeof x.restPath === "string",
    );
  } catch {
    return [];
  }
}

function saveLru(arr: LruItem[]) {
  try {
    const capped = arr.length > LRU_CAPACITY ? arr.slice(arr.length - LRU_CAPACITY) : arr;
    localStorage.setItem(LRU_STORAGE_KEY, JSON.stringify(capped));
  } catch {}
}

function touchLru(arr: LruItem[], idx: number): LruItem[] {
  if (idx < 0 || idx >= arr.length) return arr;
  const copy = arr.slice();
  const [it] = copy.splice(idx, 1);
  copy.push(it);
  return copy;
}

function upsertLru(hash: string, userId: string, restPath: string) {
  let arr = loadLru();
  const idx = arr.findIndex((x) => x.hash === hash);
  if (idx >= 0) {
    arr[idx] = { hash, userId, restPath };
    arr = touchLru(arr, idx);
  } else {
    arr.push({ hash, userId, restPath });
  }
  if (arr.length > LRU_CAPACITY) arr = arr.slice(arr.length - LRU_CAPACITY);
  saveLru(arr);
}

function splitObjectKey(objectKey: string): { userId: string; restPath: string } {
  const p = objectKey.indexOf("/");
  if (p < 0) return { userId: "", restPath: objectKey };
  return { userId: objectKey.slice(0, p), restPath: objectKey.slice(p + 1) };
}

type EditDialogProps = {
  file: File;
  initialParams: ImageEditParams;
  defaultParams?: ImageEditParams;
  onCancel: () => void;
  onApply: (params: ImageEditParams) => void;
};

type EditRect = { x: number; y: number; w: number; h: number };
type EditPoint = { x: number; y: number };
type EditCorner = "nw" | "ne" | "sw" | "se";
type HistogramData = {
  r: number[];
  g: number[];
  b: number[];
  luma: number[];
  maxCount: number;
};
const EDIT_PREVIEW_MARGIN_PX = 8;
const HISTOGRAM_BINS = 256;
const HISTOGRAM_SAMPLE_MAX = 256;

function computeHistogramData(
  sourceCanvas: HTMLCanvasElement,
  sourceRect: { x: number; y: number; w: number; h: number },
): HistogramData | null {
  const srcW = sourceCanvas.width;
  const srcH = sourceCanvas.height;
  if (srcW <= 0 || srcH <= 0) return null;
  const sx = Math.max(0, Math.min(srcW - 1, sourceRect.x));
  const sy = Math.max(0, Math.min(srcH - 1, sourceRect.y));
  const sw = Math.max(1, Math.min(srcW - sx, sourceRect.w));
  const sh = Math.max(1, Math.min(srcH - sy, sourceRect.h));
  const scale = Math.min(1, HISTOGRAM_SAMPLE_MAX / Math.max(sw, sh));
  const sampleW = Math.max(1, Math.round(sw * scale));
  const sampleH = Math.max(1, Math.round(sh * scale));
  const sampleCanvas = document.createElement("canvas");
  sampleCanvas.width = sampleW;
  sampleCanvas.height = sampleH;
  const sampleCtx = sampleCanvas.getContext("2d", { willReadFrequently: true });
  if (!sampleCtx) return null;
  sampleCtx.clearRect(0, 0, sampleW, sampleH);
  sampleCtx.drawImage(sourceCanvas, sx, sy, sw, sh, 0, 0, sampleW, sampleH);
  const imageData = sampleCtx.getImageData(0, 0, sampleW, sampleH).data;
  const r = new Array<number>(HISTOGRAM_BINS).fill(0);
  const g = new Array<number>(HISTOGRAM_BINS).fill(0);
  const b = new Array<number>(HISTOGRAM_BINS).fill(0);
  const luma = new Array<number>(HISTOGRAM_BINS).fill(0);
  let maxCount = 0;
  for (let i = 0; i < imageData.length; i += 4) {
    const rr = imageData[i] ?? 0;
    const gg = imageData[i + 1] ?? 0;
    const bb = imageData[i + 2] ?? 0;
    const yy = Math.min(255, Math.max(0, Math.round(rr * 0.2126 + gg * 0.7152 + bb * 0.0722)));
    maxCount = Math.max(maxCount, ++r[rr], ++g[gg], ++b[bb], ++luma[yy]);
  }
  return { r, g, b, luma, maxCount };
}

function histogramPath(values: number[], maxCount: number, width: number, height: number): string {
  if (!values.length || maxCount <= 0) {
    return `M0,${height} L${width},${height}`;
  }
  return values
    .map((value, index) => {
      const x = (index / (values.length - 1)) * width;
      const y = height - (value / maxCount) * height;
      return `${index === 0 ? "M" : "L"}${x.toFixed(2)},${y.toFixed(2)}`;
    })
    .join(" ");
}

export function ImageEditDialog({ file, initialParams, defaultParams, onCancel, onApply }: EditDialogProps) {
  const [mounted, setMounted] = useState(false);
  const [imgUrl, setImgUrl] = useState<string>("");
  const [natural, setNatural] = useState<{ w: number; h: number } | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const previewCanvasRef = useRef<HTMLCanvasElement>(null);
  const previewImageRef = useRef<HTMLImageElement | null>(null);
  const [containerSize, setContainerSize] = useState<{ w: number; h: number }>({ w: 0, h: 0 });
  const [displayed, setDisplayed] = useState<EditRect>({ x: 0, y: 0, w: 0, h: 0 });
  const [cropRect, setCropRect] = useState<EditRect>({ x: 0, y: 0, w: 0, h: 0 });
  const [temperature, setTemperature] = useState<number>(
    clampWhiteBalanceValue(initialParams.temperature),
  );
  const [tint, setTint] = useState<number>(clampWhiteBalanceValue(initialParams.tint));
  const [exposureEv, setExposureEv] = useState<number>(clampExposureEv(initialParams.exposureEv));
  const [scaledLog, setScaledLog] = useState<number>(clampScaledLog(initialParams.scaledLog));
  const [sigmoid, setSigmoid] = useState<number>(clampSigmoid(initialParams.sigmoid));
  const [vibrance, setVibrance] = useState<number>(clampColorAdjustment(initialParams.vibrance));
  const [saturation, setSaturation] = useState<number>(clampColorAdjustment(initialParams.saturation));
  const [resizePercent, setResizePercent] = useState<number>(
    Math.min(100, Math.max(1, Math.round(initialParams.resizePercent))),
  );
  const [mosaicMode, setMosaicMode] = useState(false);
  const [mosaicRegions, setMosaicRegions] = useState<ImageMosaicRegion[]>(
    normalizeMosaicRegions(initialParams.mosaicRegions),
  );
  const [mosaicDraft, setMosaicDraft] = useState<EditRect | null>(null);
  const mosaicDragStart = useRef<EditPoint | null>(null);
  const [showHistogram, setShowHistogram] = useState(false);
  const [histogram, setHistogram] = useState<HistogramData | null>(null);
  const dragState = useRef<
    | null
    | { mode: "move"; startP: EditPoint; startCrop: EditRect }
    | { mode: "resize"; corner: EditCorner; startP: EditPoint; startCrop: EditRect }
  >(null);

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    const url = URL.createObjectURL(file);
    setImgUrl(url);
    const img = new window.Image();
    img.decoding = "async";
    img.src = url;
    const onLoad = () => {
      previewImageRef.current = img;
      setNatural({ w: img.naturalWidth, h: img.naturalHeight });
    };
    const onError = () => setNatural(null);
    img.addEventListener("load", onLoad);
    img.addEventListener("error", onError);
    return () => {
      img.removeEventListener("load", onLoad);
      img.removeEventListener("error", onError);
      previewImageRef.current = null;
      URL.revokeObjectURL(url);
    };
  }, [file]);

  useEffect(() => {
    if (!mounted) return;
    const container = containerRef.current;
    if (!container) return;
    const updateSize = () => {
      // Measure the actual gray preview area after the portal has mounted. The image fit and
      // centering must be derived from this box, not from a placeholder size.
      setContainerSize({ w: container.clientWidth, h: container.clientHeight });
    };
    updateSize();
    const ro = new ResizeObserver(updateSize);
    ro.observe(container);
    return () => ro.disconnect();
  }, [mounted]);

  const fitImage = useCallback((nat: { w: number; h: number }, cw: number, ch: number): EditRect => {
    if (nat.w <= 0 || nat.h <= 0 || cw <= 0 || ch <= 0) return { x: 0, y: 0, w: 0, h: 0 };
    const margin = EDIT_PREVIEW_MARGIN_PX;
    const innerW = Math.max(1, cw - margin * 2);
    const innerH = Math.max(1, ch - margin * 2);
    const scale = Math.min(innerW / nat.w, innerH / nat.h);
    const w = nat.w * scale;
    const h = nat.h * scale;
    return {
      x: (cw - w) / 2,
      y: (ch - h) / 2,
      w,
      h,
    };
  }, []);

  useEffect(() => {
    if (!natural || containerSize.w <= 0 || containerSize.h <= 0) return;
    const d = fitImage(natural, containerSize.w, containerSize.h);
    setDisplayed(d);
    const crop = normalizeCrop(initialParams.crop);
    const x = d.x + d.w * crop.left;
    const y = d.y + d.h * crop.top;
    const right = d.x + d.w * (1 - crop.right);
    const bottom = d.y + d.h * (1 - crop.bottom);
    setCropRect({
      x,
      y,
      w: Math.max(40, right - x),
      h: Math.max(40, bottom - y),
    });
  }, [natural, containerSize.w, containerSize.h, fitImage, initialParams.crop]);

  const clampCropRect = useCallback(
    (candidate: EditRect): EditRect => {
      const minW = Math.min(40, displayed.w || 40);
      const minH = Math.min(40, displayed.h || 40);
      const w = Math.max(minW, Math.min(candidate.w, displayed.w));
      const h = Math.max(minH, Math.min(candidate.h, displayed.h));
      let x = Math.max(displayed.x, Math.min(candidate.x, displayed.x + displayed.w - w));
      let y = Math.max(displayed.y, Math.min(candidate.y, displayed.y + displayed.h - h));
      if (x + w > displayed.x + displayed.w) x = displayed.x + displayed.w - w;
      if (y + h > displayed.y + displayed.h) y = displayed.y + displayed.h - h;
      return {
        x: Math.round(x),
        y: Math.round(y),
        w: Math.round(w),
        h: Math.round(h),
      };
    },
    [displayed.x, displayed.y, displayed.w, displayed.h],
  );

  const toLocal = useCallback((e: React.PointerEvent): EditPoint => {
    const rect = containerRef.current!.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }, []);

  const clampPointToDisplayed = useCallback((point: EditPoint): EditPoint => ({
    x: Math.max(displayed.x, Math.min(displayed.x + displayed.w, point.x)),
    y: Math.max(displayed.y, Math.min(displayed.y + displayed.h, point.y)),
  }), [displayed]);

  const onMosaicPointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!mosaicMode || displayed.w <= 0 || displayed.h <= 0) return;
    const point = toLocal(e);
    if (
      point.x < displayed.x ||
      point.x > displayed.x + displayed.w ||
      point.y < displayed.y ||
      point.y > displayed.y + displayed.h
    ) {
      return;
    }
    e.currentTarget.setPointerCapture(e.pointerId);
    const start = clampPointToDisplayed(point);
    mosaicDragStart.current = start;
    setMosaicDraft({ x: start.x, y: start.y, w: 0, h: 0 });
    e.preventDefault();
  }, [clampPointToDisplayed, displayed, mosaicMode, toLocal]);

  const onMosaicPointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    const start = mosaicDragStart.current;
    if (!start) return;
    const point = clampPointToDisplayed(toLocal(e));
    setMosaicDraft({
      x: Math.min(start.x, point.x),
      y: Math.min(start.y, point.y),
      w: Math.abs(point.x - start.x),
      h: Math.abs(point.y - start.y),
    });
  }, [clampPointToDisplayed, toLocal]);

  const onMosaicPointerUp = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    const start = mosaicDragStart.current;
    if (!start) return;
    const point = clampPointToDisplayed(toLocal(e));
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {}
    mosaicDragStart.current = null;
    setMosaicDraft(null);
    const x = Math.min(start.x, point.x);
    const y = Math.min(start.y, point.y);
    const w = Math.abs(point.x - start.x);
    const h = Math.abs(point.y - start.y);
    if (w < 2 || h < 2 || displayed.w <= 0 || displayed.h <= 0) return;
    const region = normalizeMosaicRegion({
      left: (x - displayed.x) / displayed.w,
      top: (y - displayed.y) / displayed.h,
      right: (x + w - displayed.x) / displayed.w,
      bottom: (y + h - displayed.y) / displayed.h,
    });
    if (region) setMosaicRegions((current) => [...current, region]);
  }, [clampPointToDisplayed, displayed, toLocal]);

  const onMosaicPointerCancel = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {}
    mosaicDragStart.current = null;
    setMosaicDraft(null);
  }, []);

  const removeMosaicRegion = useCallback((index: number) => {
    setMosaicRegions((current) => current.filter((_, i) => i !== index));
  }, []);

  const onCropPointerDown = useCallback(
    (e: React.PointerEvent) => {
      (e.currentTarget as Element).setPointerCapture(e.pointerId);
      dragState.current = { mode: "move", startP: toLocal(e), startCrop: cropRect };
      e.preventDefault();
    },
    [cropRect, toLocal],
  );

  const onHandlePointerDown = useCallback(
    (corner: EditCorner) => (e: React.PointerEvent) => {
      (e.currentTarget as Element).setPointerCapture(e.pointerId);
      dragState.current = { mode: "resize", corner, startP: toLocal(e), startCrop: cropRect };
      e.preventDefault();
      e.stopPropagation();
    },
    [cropRect, toLocal],
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!dragState.current) return;
      const p = toLocal(e);
      const dx = p.x - dragState.current.startP.x;
      const dy = p.y - dragState.current.startP.y;
      if (dragState.current.mode === "move") {
        setCropRect(
          clampCropRect({
            ...dragState.current.startCrop,
            x: dragState.current.startCrop.x + dx,
            y: dragState.current.startCrop.y + dy,
          }),
        );
        return;
      }
      const start = dragState.current.startCrop;
      let next = { ...start };
      if (dragState.current.corner === "nw") {
        next = { x: start.x + dx, y: start.y + dy, w: start.w - dx, h: start.h - dy };
      } else if (dragState.current.corner === "ne") {
        next = { x: start.x, y: start.y + dy, w: start.w + dx, h: start.h - dy };
      } else if (dragState.current.corner === "sw") {
        next = { x: start.x + dx, y: start.y, w: start.w - dx, h: start.h + dy };
      } else {
        next = { x: start.x, y: start.y, w: start.w + dx, h: start.h + dy };
      }
      setCropRect(clampCropRect(next));
    },
    [clampCropRect, toLocal],
  );

  const onPointerUp = useCallback((e: React.PointerEvent) => {
    try {
      (e.target as Element).releasePointerCapture?.(e.pointerId);
    } catch {}
    dragState.current = null;
  }, []);

  const applyCropAspectRatio = useCallback(
    (ratio: number) => {
      if (ratio <= 0 || cropRect.w <= 0 || cropRect.h <= 0 || displayed.w <= 0 || displayed.h <= 0) {
        return;
      }

      // Preserve the current crop center and area. If that rectangle would extend
      // outside the image, shrink it uniformly to the largest rectangle of the
      // requested aspect ratio that still fits around the same center.
      const centerX = cropRect.x + cropRect.w / 2;
      const centerY = cropRect.y + cropRect.h / 2;
      const area = cropRect.w * cropRect.h;
      let width = Math.sqrt(area * ratio);
      let height = width / ratio;

      const maxWidth = 2 * Math.max(
        0,
        Math.min(centerX - displayed.x, displayed.x + displayed.w - centerX),
      );
      const maxHeight = 2 * Math.max(
        0,
        Math.min(centerY - displayed.y, displayed.y + displayed.h - centerY),
      );
      const scale = Math.min(1, maxWidth / width, maxHeight / height);
      width *= scale;
      height *= scale;

      setCropRect({
        x: centerX - width / 2,
        y: centerY - height / 2,
        w: width,
        h: height,
      });
    },
    [cropRect, displayed],
  );

  const applyResizeTargetPixels = useCallback((targetPixels: number) => {
    if (!natural || displayed.w <= 0 || displayed.h <= 0 || cropRect.w <= 0 || cropRect.h <= 0) {
      return;
    }
    const crop = normalizeCrop({
      left: (cropRect.x - displayed.x) / displayed.w,
      top: (cropRect.y - displayed.y) / displayed.h,
      right: 1 - (cropRect.x + cropRect.w - displayed.x) / displayed.w,
      bottom: 1 - (cropRect.y + cropRect.h - displayed.y) / displayed.h,
    });
    const sx = Math.max(0, Math.min(natural.w - 1, Math.round(natural.w * crop.left)));
    const sy = Math.max(0, Math.min(natural.h - 1, Math.round(natural.h * crop.top)));
    const ex = Math.max(sx + 1, Math.min(natural.w, Math.round(natural.w * (1 - crop.right))));
    const ey = Math.max(sy + 1, Math.min(natural.h, Math.round(natural.h * (1 - crop.bottom))));
    const croppedPixels = Math.max(1, ex - sx) * Math.max(1, ey - sy);
    const percent = Math.round(Math.sqrt(targetPixels / croppedPixels) * 100);
    setResizePercent(Math.min(100, Math.max(1, percent)));
  }, [natural, displayed, cropRect]);

  const usePortraitCropRatios = !!natural && natural.w / natural.h <= 0.95;
  const cropAspectButtons = (
    <div className="flex items-center gap-1 shrink-0">
      {(usePortraitCropRatios
        ? [
            ["1:1", 1],
            ["3:4", 3 / 4],
            ["2:3", 2 / 3],
            ["9:16", 9 / 16],
          ]
        : [
            ["1:1", 1],
            ["4:3", 4 / 3],
            ["3:2", 3 / 2],
            ["16:9", 16 / 9],
          ]
      ).map(([label, ratio]) => (
        <button
          key={label}
          type="button"
          className="px-1 py-0.5 rounded border border-gray-300 bg-white hover:bg-gray-100 text-[10px] leading-none whitespace-nowrap"
          onClick={() => applyCropAspectRatio(ratio as number)}
        >
          {label}
        </button>
      ))}
    </div>
  );

  const overlayPath = useMemo(() => {
    return {
      outer: `M${displayed.x},${displayed.y} H${displayed.x + displayed.w} V${displayed.y + displayed.h} H${displayed.x} Z`,
      inner: `M${cropRect.x},${cropRect.y} H${cropRect.x + cropRect.w} V${cropRect.y + cropRect.h} H${cropRect.x} Z`,
    };
  }, [cropRect, displayed.x, displayed.y, displayed.w, displayed.h]);

  useEffect(() => {
    const canvas = previewCanvasRef.current;
    const img = previewImageRef.current;
    if (!canvas || !img || !displayed.w || !displayed.h) return;
    const width = Math.max(1, Math.round(displayed.w));
    const height = Math.max(1, Math.round(displayed.h));
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, width, height);
    ctx.drawImage(img, 0, 0, width, height);
    applyColorAdjustmentsToCanvas(
      canvas,
      temperature,
      tint,
      exposureEv,
      scaledLog,
      sigmoid,
      vibrance,
      saturation,
    );
    if (mosaicRegions.length && natural?.w) {
      applyMosaicRectsToCanvas(
        canvas,
        mosaicRegions.map((region) => ({
          x: region.left * canvas.width,
          y: region.top * canvas.height,
          w: (region.right - region.left) * canvas.width,
          h: (region.bottom - region.top) * canvas.height,
        })),
        16,
      );
    }
  }, [
    displayed.w,
    displayed.h,
    temperature,
    tint,
    exposureEv,
    scaledLog,
    sigmoid,
    vibrance,
    saturation,
    natural,
    mosaicRegions,
  ]);

  useEffect(() => {
    if (!showHistogram) {
      setHistogram(null);
      return;
    }
    const canvas = previewCanvasRef.current;
    if (!canvas || !displayed.w || !displayed.h || !cropRect.w || !cropRect.h) {
      setHistogram(null);
      return;
    }
    const scaleX = canvas.width / displayed.w;
    const scaleY = canvas.height / displayed.h;
    setHistogram(
      computeHistogramData(canvas, {
        x: (cropRect.x - displayed.x) * scaleX,
        y: (cropRect.y - displayed.y) * scaleY,
        w: cropRect.w * scaleX,
        h: cropRect.h * scaleY,
      }),
    );
  }, [
    showHistogram,
    cropRect.x,
    cropRect.y,
    cropRect.w,
    cropRect.h,
    displayed.x,
    displayed.y,
    displayed.w,
    displayed.h,
    temperature,
    tint,
    exposureEv,
    scaledLog,
    sigmoid,
    vibrance,
    saturation,
    natural,
    mosaicRegions,
    resizePercent,
  ]);

  const histogramPaths = useMemo(() => {
    if (!histogram || histogram.maxCount <= 0) return null;
    const width = 256;
    const height = 80;
    return {
      width,
      height,
      luma: histogramPath(histogram.luma, histogram.maxCount, width, height),
      r: histogramPath(histogram.r, histogram.maxCount, width, height),
      g: histogramPath(histogram.g, histogram.maxCount, width, height),
      b: histogramPath(histogram.b, histogram.maxCount, width, height),
    };
  }, [histogram]);

  const outputDimensions = useMemo(() => {
    if (!natural || displayed.w <= 0 || displayed.h <= 0 || cropRect.w <= 0 || cropRect.h <= 0) {
      return null;
    }
    const crop = normalizeCrop({
      left: (cropRect.x - displayed.x) / displayed.w,
      top: (cropRect.y - displayed.y) / displayed.h,
      right: 1 - (cropRect.x + cropRect.w - displayed.x) / displayed.w,
      bottom: 1 - (cropRect.y + cropRect.h - displayed.y) / displayed.h,
    });
    const sx = Math.max(0, Math.min(natural.w - 1, Math.round(natural.w * crop.left)));
    const sy = Math.max(0, Math.min(natural.h - 1, Math.round(natural.h * crop.top)));
    const ex = Math.max(sx + 1, Math.min(natural.w, Math.round(natural.w * (1 - crop.right))));
    const ey = Math.max(sy + 1, Math.min(natural.h, Math.round(natural.h * (1 - crop.bottom))));
    const sw = Math.max(1, ex - sx);
    const sh = Math.max(1, ey - sy);
    const percent = Math.min(100, Math.max(1, Math.round(resizePercent)));
    return {
      w: Math.max(1, Math.round(sw * percent / 100)),
      h: Math.max(1, Math.round(sh * percent / 100)),
    };
  }, [natural, displayed, cropRect, resizePercent]);

  const onSubmit = useCallback(() => {
    if (!displayed.w || !displayed.h) return;
    const left = (cropRect.x - displayed.x) / displayed.w;
    const top = (cropRect.y - displayed.y) / displayed.h;
    const right = 1 - (cropRect.x + cropRect.w - displayed.x) / displayed.w;
    const bottom = 1 - (cropRect.y + cropRect.h - displayed.y) / displayed.h;
    onApply({
      crop: normalizeCrop({ left, top, right, bottom }),
      temperature: clampWhiteBalanceValue(temperature),
      tint: clampWhiteBalanceValue(tint),
      exposureEv: clampExposureEv(exposureEv),
      scaledLog: clampScaledLog(scaledLog),
      sigmoid: clampSigmoid(sigmoid),
      vibrance: clampColorAdjustment(vibrance),
      saturation: clampColorAdjustment(saturation),
      resizePercent: Math.min(100, Math.max(1, Math.round(resizePercent))),
      mosaicRegions: normalizeMosaicRegions(mosaicRegions),
    });
  }, [
    displayed.w,
    displayed.h,
    displayed.x,
    displayed.y,
    cropRect,
    temperature,
    tint,
    exposureEv,
    scaledLog,
    sigmoid,
    vibrance,
    saturation,
    resizePercent,
    mosaicRegions,
    onApply,
  ]);

  const onReset = useCallback(() => {
    const params = normalizeEditParams(
      defaultParams ?? buildDefaultEditParams(natural?.w, natural?.h),
      natural?.w,
      natural?.h,
    );
    setTemperature(params.temperature);
    setTint(params.tint);
    setExposureEv(params.exposureEv);
    setScaledLog(params.scaledLog);
    setSigmoid(params.sigmoid);
    setVibrance(params.vibrance);
    setSaturation(params.saturation);
    setResizePercent(params.resizePercent);
    setMosaicRegions(params.mosaicRegions);
    if (displayed.w > 0 && displayed.h > 0) {
      const crop = normalizeCrop(params.crop);
      const x = displayed.x + displayed.w * crop.left;
      const y = displayed.y + displayed.h * crop.top;
      const right = displayed.x + displayed.w * (1 - crop.right);
      const bottom = displayed.y + displayed.h * (1 - crop.bottom);
      setCropRect({
        x,
        y,
        w: Math.max(40, right - x),
        h: Math.max(40, bottom - y),
      });
    }
  }, [defaultParams, displayed, natural]);

  if (!mounted) return null;

  return createPortal(
    <div className="fixed inset-0 z-[70] bg-black/70 flex items-center justify-center p-4" onClick={onCancel}>
      <div className="bg-white rounded shadow max-w-[95vw] max-h-[95dvh] overflow-y-auto w-[min(1100px,95vw)] p-4" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-base font-semibold break-all">Edit image</h2>
          <div className="flex items-center gap-3">
            <label className="inline-flex items-center gap-2 text-sm text-gray-700 select-none">
              <input
                type="checkbox"
                checked={mosaicMode}
                onChange={(e) => {
                  setMosaicMode(e.target.checked);
                  mosaicDragStart.current = null;
                  setMosaicDraft(null);
                }}
              />
              <span>Mosaic</span>
            </label>
            <label className="inline-flex items-center gap-2 text-sm text-gray-700 select-none">
              <input
                type="checkbox"
                checked={showHistogram}
                onChange={(e) => setShowHistogram(e.target.checked)}
              />
              <span>Histogram</span>
            </label>
            <button className="px-2 py-0.5 text-sm rounded border border-gray-300 hover:bg-gray-100" onClick={onReset}>
              Reset
            </button>
          </div>
        </div>

        <div className="mt-3 grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_208px] gap-4 lg:items-stretch">
          <div
            ref={containerRef}
            className={`relative w-full h-[42vh] min-h-[270px] lg:h-auto rounded border bg-gray-200 overflow-hidden touch-none ${mosaicMode ? "cursor-crosshair" : ""}`}
            onPointerDown={mosaicMode ? onMosaicPointerDown : undefined}
            onPointerMove={mosaicMode ? onMosaicPointerMove : onPointerMove}
            onPointerUp={mosaicMode ? onMosaicPointerUp : onPointerUp}
            onPointerCancel={mosaicMode ? onMosaicPointerCancel : onPointerUp}
          >
              {imgUrl && natural ? (
                <>
                  {showHistogram && histogramPaths && (
                    <div
                      className="absolute left-2 bottom-2 w-[294px] h-[138px] rounded bg-black pointer-events-none"
                      aria-hidden="true"
                    />
                  )}
                  <canvas
                    ref={previewCanvasRef}
                    className="absolute select-none"
                    style={{
                      left: displayed.x,
                      top: displayed.y,
                      width: displayed.w,
                      height: displayed.h,
                    }}
                  />
                  {!mosaicMode && (
                    <svg className="absolute inset-0 w-full h-full pointer-events-none" aria-hidden="true">
                      <path d={`${overlayPath.outer} ${overlayPath.inner}`} fill="rgba(0,0,0,0.45)" fillRule="evenodd" />
                    </svg>
                  )}
                  {showHistogram && histogramPaths && (
                    <div className="absolute left-2 bottom-2 w-[294px] h-[138px] rounded border border-white/40 bg-black/80 shadow-sm pointer-events-none">
                      <svg
                        className="absolute inset-[6px] w-[calc(100%-12px)] h-[calc(100%-12px)]"
                        viewBox={`0 0 ${histogramPaths.width} ${histogramPaths.height}`}
                        preserveAspectRatio="none"
                        aria-hidden="true"
                      >
                        <path d={`M0,${histogramPaths.height} L${histogramPaths.width},${histogramPaths.height}`} stroke="rgba(255,255,255,0.2)" strokeWidth="1" fill="none" />
                        <path d={histogramPaths.luma} stroke="rgba(255,255,255,0.85)" strokeWidth="1.5" fill="none" />
                        <path d={histogramPaths.r} stroke="rgba(255,80,80,0.8)" strokeWidth="1" fill="none" />
                        <path d={histogramPaths.g} stroke="rgba(80,255,120,0.8)" strokeWidth="1" fill="none" />
                        <path d={histogramPaths.b} stroke="rgba(100,160,255,0.8)" strokeWidth="1" fill="none" />
                      </svg>
                    </div>
                  )}
                  {mosaicMode && mosaicRegions.map((region, index) => (
                    <div
                      key={index}
                      className="absolute border-2 border-dashed border-white shadow-[0_0_0_1px_rgba(0,0,0,0.65)] pointer-events-none"
                      style={{
                        left: displayed.x + region.left * displayed.w,
                        top: displayed.y + region.top * displayed.h,
                        width: (region.right - region.left) * displayed.w,
                        height: (region.bottom - region.top) * displayed.h,
                      }}
                    >
                      <button
                        type="button"
                        className="absolute -right-2.5 -top-2.5 w-5 h-5 rounded-full border border-white bg-black/80 text-white text-[12px] leading-none flex items-center justify-center pointer-events-auto"
                        onPointerDown={(e) => e.stopPropagation()}
                        onClick={(e) => {
                          e.stopPropagation();
                          removeMosaicRegion(index);
                        }}
                        aria-label="Remove mosaic region"
                      >
                        ✕
                      </button>
                    </div>
                  ))}
                  {mosaicMode && mosaicDraft && (
                    <div
                      className="absolute border-2 border-dashed border-white bg-black/10 shadow-[0_0_0_1px_rgba(0,0,0,0.65)] pointer-events-none"
                      style={{ left: mosaicDraft.x, top: mosaicDraft.y, width: mosaicDraft.w, height: mosaicDraft.h }}
                    />
                  )}
                  {!mosaicMode && (
                    <div
                      className="absolute border-2 border-white shadow-[0_0_0_1px_rgba(0,0,0,0.45)] bg-transparent cursor-move"
                      style={{ left: cropRect.x, top: cropRect.y, width: cropRect.w, height: cropRect.h }}
                      onPointerDown={onCropPointerDown}
                    >
                      {(["nw", "ne", "sw", "se"] as EditCorner[]).map((corner) => {
                        const style =
                          corner === "nw"
                            ? { left: -6, top: -6 }
                            : corner === "ne"
                              ? { right: -6, top: -6 }
                              : corner === "sw"
                                ? { left: -6, bottom: -6 }
                                : { right: -6, bottom: -6 };
                        return (
                          <div
                            key={corner}
                            className="absolute w-3 h-3 rounded-full bg-white border border-black cursor-pointer"
                            style={style}
                            onPointerDown={onHandlePointerDown(corner)}
                          />
                        );
                      })}
                    </div>
                  )}
                </>
              ) : (
                <div className="absolute inset-0 flex items-center justify-center text-sm text-gray-500">Loading preview…</div>
              )}
          </div>

          <div className="space-y-4 text-sm text-gray-800">
            <div className="rounded border px-2 py-3 lg:space-y-2">
              <div className="grid grid-cols-[96px_minmax(0,1fr)] lg:flex lg:items-center gap-2">
                <div className="font-medium">Crop</div>
                <div className="flex min-w-0 items-center gap-2">
                  {cropAspectButtons}
                  <div className="flex lg:hidden flex-1 min-w-0 items-center justify-between gap-1 text-[10px] text-gray-700 leading-5 font-mono whitespace-nowrap">
                    <span>T={(displayed.h ? ((cropRect.y - displayed.y) / displayed.h) * 100 : 0).toFixed(1)}%</span>
                    <span>B={(displayed.h ? (1 - (cropRect.y + cropRect.h - displayed.y) / displayed.h) * 100 : 0).toFixed(1)}%</span>
                    <span>L={(displayed.w ? ((cropRect.x - displayed.x) / displayed.w) * 100 : 0).toFixed(1)}%</span>
                    <span>R={(displayed.w ? (1 - (cropRect.x + cropRect.w - displayed.x) / displayed.w) * 100 : 0).toFixed(1)}%</span>
                  </div>
                </div>
              </div>
              <div className="hidden lg:flex min-w-0 items-center justify-between gap-1 text-[10px] text-gray-700 leading-5 font-mono whitespace-nowrap">
                <span>T={(displayed.h ? ((cropRect.y - displayed.y) / displayed.h) * 100 : 0).toFixed(1)}%</span>
                <span>B={(displayed.h ? (1 - (cropRect.y + cropRect.h - displayed.y) / displayed.h) * 100 : 0).toFixed(1)}%</span>
                <span>L={(displayed.w ? ((cropRect.x - displayed.x) / displayed.w) * 100 : 0).toFixed(1)}%</span>
                <span>R={(displayed.w ? (1 - (cropRect.x + cropRect.w - displayed.x) / displayed.w) * 100 : 0).toFixed(1)}%</span>
              </div>
            </div>

            <div className="rounded border p-3 space-y-2 lg:space-y-3">
              <div className="hidden lg:block font-medium">White balance</div>
              <label className="grid grid-cols-[96px_minmax(0,1fr)_56px] lg:grid-cols-2 items-center gap-x-2 gap-y-1">
                <span className="col-start-1 row-start-1">Temperature</span>
                <span className="col-start-3 row-start-1 w-14 text-right lg:w-auto lg:col-start-2 justify-self-end font-mono text-[12px]">
                  {temperature >= 0 ? "+" : ""}{temperature}
                </span>
                <input
                  type="range"
                  min={-100}
                  max={100}
                  step={1}
                  value={temperature}
                  onChange={(e) => setTemperature(clampWhiteBalanceValue(Number(e.target.value)))}
                  className="col-start-2 row-start-1 lg:col-span-2 lg:col-start-1 lg:row-start-2 w-full"
                />
              </label>
              <label className="grid grid-cols-[96px_minmax(0,1fr)_56px] lg:grid-cols-2 items-center gap-x-2 gap-y-1">
                <span className="col-start-1 row-start-1">Tint</span>
                <span className="col-start-3 row-start-1 w-14 text-right lg:w-auto lg:col-start-2 justify-self-end font-mono text-[12px]">{tint >= 0 ? "+" : ""}{tint}</span>
                <input
                  type="range"
                  min={-100}
                  max={100}
                  step={1}
                  value={tint}
                  onChange={(e) => setTint(clampWhiteBalanceValue(Number(e.target.value)))}
                  className="col-start-2 row-start-1 lg:col-span-2 lg:col-start-1 lg:row-start-2 w-full"
                />
              </label>
            </div>

            <div className="rounded border p-3 space-y-2 lg:space-y-3">
              <div className="hidden lg:block font-medium">Tone</div>
              <label className="grid grid-cols-[96px_minmax(0,1fr)_56px] lg:grid-cols-2 items-center gap-x-2 gap-y-1">
                <span className="col-start-1 row-start-1">Exposure</span>
                <span className="col-start-3 row-start-1 w-14 text-right lg:w-auto lg:col-start-2 justify-self-end font-mono text-[12px]">{formatSignedEv(exposureEv)}</span>
                <input
                  type="range"
                  min={-5}
                  max={5}
                  step={0.1}
                  value={exposureEv}
                  onChange={(e) => setExposureEv(clampExposureEv(Number(e.target.value)))}
                  className="col-start-2 row-start-1 lg:col-span-2 lg:col-start-1 lg:row-start-2 w-full"
                />
              </label>
              <label className="grid grid-cols-[96px_minmax(0,1fr)_56px] lg:grid-cols-2 items-center gap-x-2 gap-y-1">
                <span className="col-start-1 row-start-1">Logarithm</span>
                <span className="col-start-3 row-start-1 w-14 text-right lg:w-auto lg:col-start-2 justify-self-end font-mono text-[12px]">{scaledLog >= 0 ? "+" : ""}{scaledLog.toFixed(1)}</span>
                <input
                  type="range"
                  min={-16}
                  max={16}
                  step={0.1}
                  value={scaledLog}
                  onChange={(e) => setScaledLog(clampScaledLog(Number(e.target.value)))}
                  className="col-start-2 row-start-1 lg:col-span-2 lg:col-start-1 lg:row-start-2 w-full"
                />
              </label>
              <label className="grid grid-cols-[96px_minmax(0,1fr)_56px] lg:grid-cols-2 items-center gap-x-2 gap-y-1">
                <span className="col-start-1 row-start-1">Sigmoid</span>
                <span className="col-start-3 row-start-1 w-14 text-right lg:w-auto lg:col-start-2 justify-self-end font-mono text-[12px]">{sigmoid >= 0 ? "+" : ""}{sigmoid.toFixed(1)}</span>
                <input
                  type="range"
                  min={-10}
                  max={10}
                  step={0.1}
                  value={sigmoid}
                  onChange={(e) => setSigmoid(clampSigmoid(Number(e.target.value)))}
                  className="col-start-2 row-start-1 lg:col-span-2 lg:col-start-1 lg:row-start-2 w-full"
                />
              </label>
            </div>

            <div className="rounded border p-3 space-y-2 lg:space-y-3">
              <div className="hidden lg:block font-medium">Color</div>
              <label className="grid grid-cols-[96px_minmax(0,1fr)_56px] lg:grid-cols-2 items-center gap-x-2 gap-y-1">
                <span className="col-start-1 row-start-1">Vibrance</span>
                <span className="col-start-3 row-start-1 w-14 text-right lg:w-auto lg:col-start-2 justify-self-end font-mono text-[12px]">{vibrance >= 0 ? "+" : ""}{vibrance}</span>
                <input
                  type="range"
                  min={-100}
                  max={100}
                  step={1}
                  value={vibrance}
                  onChange={(e) => setVibrance(clampColorAdjustment(Number(e.target.value)))}
                  className="col-start-2 row-start-1 lg:col-span-2 lg:col-start-1 lg:row-start-2 w-full"
                />
              </label>
              <label className="grid grid-cols-[96px_minmax(0,1fr)_56px] lg:grid-cols-2 items-center gap-x-2 gap-y-1">
                <span className="col-start-1 row-start-1">Saturation</span>
                <span className="col-start-3 row-start-1 w-14 text-right lg:w-auto lg:col-start-2 justify-self-end font-mono text-[12px]">{saturation >= 0 ? "+" : ""}{saturation}</span>
                <input
                  type="range"
                  min={-100}
                  max={100}
                  step={1}
                  value={saturation}
                  onChange={(e) => setSaturation(clampColorAdjustment(Number(e.target.value)))}
                  className="col-start-2 row-start-1 lg:col-span-2 lg:col-start-1 lg:row-start-2 w-full"
                />
              </label>
            </div>

            <div className="rounded border p-3 space-y-2">
              <div className="grid grid-cols-[auto_minmax(0,1fr)_56px] items-center gap-x-2 gap-y-1">
                <span className="col-start-1 row-start-1 font-medium">Resize</span>
                <div className="col-start-2 row-start-1 flex items-center gap-1 shrink-0">
                  {([
                    ["1MP", 1_000_000],
                    ["4MP", 4_000_000],
                  ] as const).map(([label, targetPixels]) => (
                    <button
                      key={label}
                      type="button"
                      className="px-1 py-0.5 rounded border border-gray-300 bg-white hover:bg-gray-100 text-[10px] leading-none whitespace-nowrap"
                      onClick={() => applyResizeTargetPixels(targetPixels)}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                <span className="col-start-3 row-start-1 w-14 text-right justify-self-end font-mono text-[12px]">{resizePercent}%</span>
                <input
                  type="range"
                  aria-label="Resize"
                  min={1}
                  max={100}
                  step={1}
                  value={resizePercent}
                  onChange={(e) => setResizePercent(Math.min(100, Math.max(1, Number(e.target.value) || 100)))}
                  className="col-span-3 col-start-1 row-start-2 w-full"
                />
              </div>
            </div>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <div className="mr-auto flex flex-wrap gap-x-6 gap-y-1 text-[12px] text-gray-600 font-mono">
            <span>
              Input ({natural ? `${natural.w}x${natural.h}, ${(natural.w * natural.h / 1_000_000).toFixed(1)}MP` : "—"})
            </span>
            <span>
              Output ({outputDimensions ? `${outputDimensions.w}x${outputDimensions.h}, ${(outputDimensions.w * outputDimensions.h / 1_000_000).toFixed(1)}MP` : "—"})
            </span>
          </div>
          <button className="px-3 py-1 rounded border border-gray-300 bg-white hover:bg-gray-100" onClick={onCancel}>
            Cancel
          </button>
          <button className="px-3 py-1 rounded border border-blue-700 bg-blue-600 text-white hover:bg-blue-700" onClick={onSubmit}>
            Edit
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

export default function ImageUploadDialog({ userId, files, maxCount, onClose, onComplete }: Props) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
  }, []);

  const SINGLE_LIMIT = Number(Config.MEDIA_IMAGE_BYTE_LIMIT || 0) || null;

  const [items, setItems] = useState<SelectedItem[]>(
    files.slice(0, maxCount).map((f) => {
      const pass = isPassThroughType(f.name, f.type);
      const overLimit = SINGLE_LIMIT ? f.size > SINGLE_LIMIT : false;
      const force = !pass || overLimit;
      return {
        id: f.id,
        file: f.file,
        name: f.name,
        type: f.type,
        size: f.size,
        decodable: true,
        optimize: force ? true : false,
        needsAutoOptimize: force,
        forceOptimize: force,
        status: "pending",
      };
    }),
  );

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [bytesMonthlyUsed, setBytesMonthlyUsed] = useState<number | null>(null);
  const [bytesMonthlyLimit, setBytesMonthlyLimit] = useState<number | null>(null);
  const [editingItemId, setEditingItemId] = useState<string | null>(null);

  const revokeQueue = useRef<string[]>([]);
  const optimizeJobs = useRef<Map<string, number>>(new Map());

  useEffect(() => {
    let mountedFlag = true;
    getImagesMonthlyQuota(userId)
      .then((q) => {
        if (!mountedFlag) return;
        setBytesMonthlyUsed(q.bytesTotal ?? 0);
        setBytesMonthlyLimit(q.limitMonthlyBytes ?? null);
      })
      .catch(() => {
        if (!mountedFlag) return;
        setBytesMonthlyUsed(null);
        setBytesMonthlyLimit(null);
      });
    return () => {
      mountedFlag = false;
    };
  }, [userId]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      for (const f of files.slice(0, maxCount)) {
        const meta = await readMeta(f.file);
        if (cancelled) return;

        if (meta.previewUrl) revokeQueue.current.push(meta.previewUrl);

        const pass = isPassThroughType(f.name, f.type);
        const overLimit = SINGLE_LIMIT ? f.size > SINGLE_LIMIT : false;
        const force = !pass || overLimit;

        const needByThreshold = shouldAutoOptimize({
          width: meta.width,
          height: meta.height,
          size: f.size,
        });

        let hash: string | undefined = undefined;
        let reusableUserId: string | undefined = undefined;
        let reusableRestPath: string | undefined = undefined;
        let reuse = false;

        try {
          hash = await sha256Hex(f.file);
          const lru = loadLru();
          const idx = lru.findIndex((x) => x.hash === hash);
          if (idx >= 0) {
            const cand = lru[idx];
            const ok = await checkImageExistenceDirectly(cand.userId, cand.restPath);
            if (ok) {
              reusableUserId = cand.userId;
              reusableRestPath = cand.restPath;
              reuse = true;
              saveLru(touchLru(lru, idx));
            }
          }
        } catch {}

        setItems((prev) =>
          prev.map((x) =>
            x.id === f.id
              ? {
                  ...x,
                  previewUrl: meta.previewUrl,
                  originalPreviewUrl: meta.previewUrl,
                  decodable: meta.decodable,
                  width: meta.width,
                  height: meta.height,
                  needsAutoOptimize: force ? true : needByThreshold,
                  forceOptimize: force,
                  status: "optimizing",
                  error: undefined,
                  hash,
                  reusableUserId,
                  reusableRestPath,
                  reuse,
                }
              : x,
          ),
        );

        try {
          const out = await buildOptimizedVariant(
            f.file,
            meta.width ?? 0,
            meta.height ?? 0,
            0.8,
            f.name,
            f.type,
            undefined,
          );

          if (cancelled) return;

          const optimizedPreviewUrl = URL.createObjectURL(out.blob);
          revokeQueue.current.push(optimizedPreviewUrl);

          setItems((prev) =>
            prev.map((x) => {
              if (x.id !== f.id) return x;
              const isHalfOrLess = f.size >= 100 * 1024 && out.blob.size * 2 <= f.size;
              const auto = x.forceOptimize ? true : x.needsAutoOptimize || isHalfOrLess;
              return {
                ...x,
                previewUrl: x.previewUrl && x.decodable ? x.previewUrl : optimizedPreviewUrl,
                optimizedPreviewUrl,
                decodable: true,
                optimized: {
                  blob: out.blob,
                  size: out.blob.size,
                  width: out.width,
                  height: out.height,
                },
                needsAutoOptimize: auto,
                optimize: x.forceOptimize ? true : auto,
                status: "ready",
                error: undefined,
              };
            }),
          );
        } catch {
          setItems((prev) =>
            prev.map((x) =>
              x.id === f.id
                ? x.forceOptimize
                  ? {
                      ...x,
                      status: "error",
                      optimized: undefined,
                      error:
                        "This format requires optimization, but a WebP could not be produced. Please convert to JPEG/PNG/WebP and try again.",
                    }
                  : {
                      ...x,
                      status: "ready",
                      optimized: undefined,
                      optimize: false,
                    }
                : x,
            ),
          );
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [files, maxCount, SINGLE_LIMIT]);

  useEffect(() => {
    return () => {
      for (const url of revokeQueue.current) URL.revokeObjectURL(url);
      revokeQueue.current = [];
    };
  }, []);

  const reprocessItem = useCallback(async (snapshot: SelectedItem, nextEdit: ImageEditParams) => {
    if (!snapshot.width || !snapshot.height) return;
    const token = (optimizeJobs.current.get(snapshot.id) || 0) + 1;
    optimizeJobs.current.set(snapshot.id, token);
    setItems((prev) =>
      prev.map((x) =>
        x.id === snapshot.id
          ? {
              ...x,
              edit: nextEdit,
              reuse: isMeaningfullyEdited(nextEdit, x.width, x.height) ? false : x.reuse,
              status: "optimizing",
              error: undefined,
            }
          : x,
      ),
    );
    try {
      const out = await buildOptimizedVariant(
        snapshot.file,
        snapshot.width,
        snapshot.height,
        0.8,
        snapshot.name,
        snapshot.type,
        nextEdit,
      );
      if (optimizeJobs.current.get(snapshot.id) !== token) return;
      const processedPreviewUrl = URL.createObjectURL(out.blob);
      revokeQueue.current.push(processedPreviewUrl);
      setItems((prev) =>
        prev.map((x) => {
          if (x.id !== snapshot.id) return x;
          const isHalfOrLess = x.size >= 100 * 1024 && out.blob.size * 2 <= x.size;
          const auto = x.forceOptimize ? true : x.needsAutoOptimize || isHalfOrLess;
          return {
            ...x,
            edit: nextEdit,
            previewUrl: processedPreviewUrl,
            optimizedPreviewUrl: processedPreviewUrl,
            decodable: true,
            optimized: { blob: out.blob, size: out.blob.size, width: out.width, height: out.height },
            needsAutoOptimize: auto,
            optimize: x.forceOptimize ? true : x.optimize,
            status: "ready",
            error: undefined,
          };
        }),
      );
    } catch {
      if (optimizeJobs.current.get(snapshot.id) !== token) return;
      setItems((prev) =>
        prev.map((x) =>
          x.id === snapshot.id
            ? x.forceOptimize
              ? {
                  ...x,
                  edit: nextEdit,
                  status: "error",
                  optimized: undefined,
                  error:
                    "This format requires optimization, but a WebP could not be produced. Please convert to JPEG/PNG/WebP and try again.",
                }
              : {
                  ...x,
                  edit: nextEdit,
                  status: "ready",
                  optimized: undefined,
                  optimize: false,
                }
            : x,
        ),
      );
    }
  }, []);

  const effectiveUploadSize = useCallback((it: SelectedItem) => {
    return it.optimize && it.optimized ? it.optimized.size : it.size;
  }, []);

  const projectedUploadBytes = useMemo(() => {
    return items.reduce((a, it) => a + effectiveUploadSize(it), 0);
  }, [items, effectiveUploadSize]);

  const allOptimizingDone = useMemo(
    () => items.every((it) => it.status !== "optimizing" && it.status !== "pending"),
    [items],
  );

  const oversizedItems = useMemo(() => {
    if (!SINGLE_LIMIT) return [];
    if (!allOptimizingDone) return [];
    return items.filter((it) => effectiveUploadSize(it) > SINGLE_LIMIT);
  }, [items, SINGLE_LIMIT, effectiveUploadSize, allOptimizingDone]);

  const quotaExceeded = useMemo(() => {
    if (!allOptimizingDone) return false;
    if (!bytesMonthlyLimit || bytesMonthlyUsed == null) return false;
    return bytesMonthlyUsed + projectedUploadBytes > bytesMonthlyLimit;
  }, [bytesMonthlyLimit, bytesMonthlyUsed, projectedUploadBytes, allOptimizingDone]);

  const canUpload = useMemo(() => {
    if (busy || quotaExceeded) return false;
    if (oversizedItems.length > 0) return false;
    const anyOptim = items.some((it) => it.status === "optimizing");
    const anyReady = items.some((it) => it.status === "ready");
    return !anyOptim && anyReady;
  }, [busy, items, quotaExceeded, oversizedItems.length]);

  const onUpload = useCallback(async () => {
    setBusy(true);
    setError(null);
    const results: UploadResult[] = [];
    const next = [...items];

    for (let idx = 0; idx < next.length; idx++) {
      const it = next[idx];
      const hasMeaningfulEdit = isMeaningfullyEdited(it.edit, it.width, it.height);

      if (it.status === "error" || it.status === "optimizing") {
        results.push({ ok: false, error: it.error || "unavailable", name: it.name });
        continue;
      }

      if (SINGLE_LIMIT && effectiveUploadSize(it) > SINGLE_LIMIT) {
        const msg = `File exceeds the single-file limit (${formatBytes(SINGLE_LIMIT)}).`;
        next[idx] = { ...it, status: "error", error: msg };
        setItems([...next]);
        results.push({ ok: false, error: msg, name: it.name });
        continue;
      }

      if (!hasMeaningfulEdit && it.reusableUserId && it.reusableRestPath && it.reuse) {
        const objectKey = `${it.reusableUserId}/${it.reusableRestPath}`;
        next[idx] = { ...it, status: "done" };
        setItems([...next]);
        results.push({ ok: true, objectKey });
        continue;
      }

      let useOptimized = false;
      if (it.forceOptimize) {
        if (!it.optimized) {
          next[idx] = {
            ...it,
            status: "error",
            error:
              "This format requires optimization, but a converted image is not available. Please convert to JPEG/PNG/WebP and try again.",
          };
          setItems([...next]);
          results.push({ ok: false, error: next[idx].error!, name: it.name });
          continue;
        }
        useOptimized = true;
      } else {
        useOptimized = !!(it.optimize && it.optimized);
      }

      next[idx] = { ...it, status: "uploading" };
      setItems([...next]);

      try {
        const blob = useOptimized ? it.optimized!.blob : it.file;
        const name = useOptimized ? changeExtToWebp(it.name) : it.name;
        const type = useOptimized ? "image/webp" : it.type || "application/octet-stream";

        const presigned = await presignImageUpload(userId, name, blob.size);
        await uploadToPresigned(presigned, blob, name, type);
        const meta = await finalizeImage(userId, presigned.objectKey);

        if (!hasMeaningfulEdit) {
          const { userId: savedUserId, restPath } = splitObjectKey(meta.key);
          const h = it.hash || (await sha256Hex(it.file));
          if (h && savedUserId && restPath) upsertLru(h, savedUserId, restPath);
        }

        next[idx] = { ...next[idx], status: "done" };
        setItems([...next]);
        results.push({ ok: true, objectKey: meta.key });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        next[idx] = { ...next[idx], status: "error", error: msg };
        setItems([...next]);
        results.push({ ok: false, error: msg, name: it.name });
      }
    }

    setBusy(false);
    onComplete(results);
  }, [items, onComplete, userId, SINGLE_LIMIT, effectiveUploadSize]);

  const gridClass = useMemo(() => {
    if (items.length === 1) {
      return "grid-cols-1";
    }
    if (items.length === 2) {
      return "grid-cols-1 sm:grid-cols-2";
    }
    return "grid-cols-1 sm:grid-cols-2 md:grid-cols-3";
  }, [items.length]);

  const editingItem = useMemo(
    () => items.find((it) => it.id === editingItemId) ?? null,
    [items, editingItemId],
  );

  if (!mounted) return null;

  return (
    <>
      {editingItem && (
        <ImageEditDialog
          file={editingItem.file}
          initialParams={normalizeEditParams(editingItem.edit, editingItem.width, editingItem.height)}
          onCancel={() => setEditingItemId(null)}
          onApply={(params) => {
            setEditingItemId(null);
            void reprocessItem(editingItem, params);
          }}
        />
      )}

      {createPortal(
        <div
          className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4"
          onClick={onClose}
        >
          <div
            className="bg-white rounded shadow max-w-[90vw] max-h-[90vh] p-3 w-full sm:w-auto"
            onClick={(e) => e.stopPropagation()}
          >
        <div className="flex justify-between items-start gap-3">
          <h2 className="text-base font-semibold break-all">Upload images</h2>
          <button
            className="px-2 py-0.5 text-sm rounded border border-gray-300 hover:bg-gray-100"
            onClick={onClose}
            disabled={busy}
          >
            Close
          </button>
        </div>

        <div className="mt-2 text-sm text-gray-700 flex items-center gap-3 flex-wrap">
          <div>
            Selected: <b>{items.length}</b> / {maxCount}
          </div>
          <div>
            Projected upload: <b>{formatBytes(projectedUploadBytes)}</b>
          </div>
          {bytesMonthlyLimit && (
            <div>
              Monthly:{" "}
              <b>
                {formatBytes(bytesMonthlyUsed ?? 0)} / {formatBytes(bytesMonthlyLimit)}
              </b>
            </div>
          )}
          {quotaExceeded && (
            <div className="text-red-600">Projected total exceeds your monthly quota.</div>
          )}
          {SINGLE_LIMIT && allOptimizingDone && oversizedItems.length > 0 && (
            <div className="text-red-600">
              {oversizedItems.length} file(s) exceed the single-file limit (
              {formatBytes(SINGLE_LIMIT)}).
            </div>
          )}
        </div>

        <div className="mt-3 overflow-auto max-h-[60vh]">
          <ul className={`grid ${gridClass} gap-3 justify-center`}>
            {items.map((it) => {
              const effSize = effectiveUploadSize(it);
              const optimizedSize = it.optimized?.size ?? it.size;
              const isOver = SINGLE_LIMIT ? effSize > SINGLE_LIMIT : false;
              const showOver = isOver && allOptimizingDone;
              const hasMeaningfulEdit = isMeaningfullyEdited(it.edit, it.width, it.height);
              const isUsingExistingData = !!(it.reusableUserId && it.reusableRestPath && it.reuse);
              return (
                <li key={it.id} className="rounded border bg-white overflow-hidden mx-auto">
                  <div className="relative w-[70vw] sm:w-[44vw] md:w-[28vw] lg:w-[24vw] xl:w-[22vw] aspect-video bg-gray-50">
                    {it.previewUrl && it.decodable ? (
                      <NextImage
                        src={it.previewUrl}
                        alt=""
                        fill
                        unoptimized
                        className="object-contain"
                        sizes="(max-width: 640px) 70vw, (max-width: 1024px) 44vw, 28vw"
                      />
                    ) : (
                      <div className="absolute inset-0 flex items-center justify-center text-xs text-gray-500">
                        No preview
                      </div>
                    )}
                    {(it.status === "optimizing" || it.status === "uploading") && (
                      <div className="absolute inset-0 bg-white/70 flex items-center justify-center text-xs">
                        {it.status === "optimizing" ? "Optimizing…" : "Uploading…"}
                      </div>
                    )}
                  </div>

                  <div className="p-3 text-sm text-gray-800 space-y-2 min-w-[260px]">
                    <div className="font-medium truncate max-w-60" title={it.name}>
                      {it.name}
                    </div>
                    <div className="text-[12px] text-gray-700 space-y-1">
                      <div>
                        <span className="text-gray-500">Original:</span>{" "}
                        <span className="font-mono">{it.type || "image/*"}</span> •{" "}
                        <span className="font-mono">{formatBytes(it.size)}</span>
                        {" • "}
                        {it.width && it.height ? `${it.width}×${it.height}` : "—"}
                      </div>
                      {it.type?.toLowerCase() === "image/gif" && (
                        <div className="text-[11px] text-gray-500">
                          * Animated GIF will be uploaded as a still image (first frame).
                        </div>
                      )}
                    </div>

                    <div className="flex items-start justify-between gap-3">
                      <div className="flex items-center gap-2 flex-wrap">
                      {!!(it.reusableUserId && it.reusableRestPath) && (
                        <label className="inline-flex items-center gap-2 cursor-pointer">
                          <input
                            type="checkbox"
                            className="accent-blue-600"
                            checked={!!it.reuse}
                            onChange={() =>
                              setItems((prev) =>
                                prev.map((x) => {
                                  if (x.id !== it.id) return x;
                                  const reuse = !x.reuse;
                                  const previewUrl = reuse
                                    ? x.originalPreviewUrl ?? x.previewUrl
                                    : x.optimize
                                      ? x.edit && x.optimizedPreviewUrl
                                        ? x.optimizedPreviewUrl
                                        : x.originalPreviewUrl ?? x.previewUrl
                                      : x.originalPreviewUrl ?? x.previewUrl;
                                  return { ...x, reuse, previewUrl };
                                }),
                              )
                            }
                            disabled={
                              hasMeaningfulEdit ||
                              it.status === "optimizing" ||
                              it.status === "uploading"
                            }
                          />
                          <span className={`text-[13px] ${hasMeaningfulEdit ? "text-gray-400" : ""}`}>
                            Use existing data
                          </span>
                        </label>
                      )}

                      <label className="inline-flex items-center gap-2 cursor-pointer">
                        <input
                          type="checkbox"
                          className="accent-blue-600"
                          checked={it.optimize}
                          onChange={() =>
                            setItems((prev) =>
                              prev.map((x) => {
                                if (x.id !== it.id) return x;
                                const optimize = x.forceOptimize ? true : !x.optimize;
                                const previewUrl = optimize
                                  ? x.edit && x.optimizedPreviewUrl
                                    ? x.optimizedPreviewUrl
                                    : x.originalPreviewUrl ?? x.previewUrl
                                  : x.originalPreviewUrl ?? x.previewUrl;
                                return { ...x, optimize, previewUrl };
                              }),
                            )
                          }
                          disabled={
                            isUsingExistingData ||
                            it.forceOptimize ||
                            it.status === "optimizing" ||
                            it.status === "uploading"
                          }
                        />
                        <span className={`text-[13px] ${isUsingExistingData ? "text-gray-400" : ""}`}>
                          Optimize for Web{" "}
                          {it.forceOptimize && <span className="text-gray-500">(required)</span>}
                        </span>
                      </label>
                      </div>

                      <button
                        type="button"
                        className="px-2 py-0.5 text-[13px] rounded border border-gray-300 bg-white hover:bg-gray-100 disabled:text-gray-400 disabled:bg-gray-100"
                        onClick={() => setEditingItemId(it.id)}
                        disabled={
                          isUsingExistingData ||
                          !it.optimize ||
                          it.status === "optimizing" ||
                          it.status === "uploading" ||
                          !it.width ||
                          !it.height
                        }
                      >
                        Edit
                      </button>
                    </div>

                    <div className={`text-[12px] ${it.optimize && !isUsingExistingData ? "text-gray-800" : "text-gray-400"}`}>
                      <div>
                        <span className="text-gray-500">Optimized:</span>{" "}
                        <span className="font-mono">
                          {it.optimized ? "image/webp" : it.type || "image/*"}
                        </span>{" "}
                        •{" "}
                        <span
                          className={`font-mono ${showOver ? "text-red-600 font-semibold" : ""}`}
                        >
                          {formatBytes(optimizedSize)}
                        </span>
                        {" • "}
                        {it.optimized
                          ? `${it.optimized.width}×${it.optimized.height}`
                          : it.width && it.height
                            ? `${it.width}×${it.height}`
                            : "—"}
                        {showOver && SINGLE_LIMIT && (
                          <div className="text-[11px] text-red-600 mt-0.5">
                            Exceeds single-file limit ({formatBytes(SINGLE_LIMIT)}).
                          </div>
                        )}
                      </div>
                    </div>

                    {it.status === "error" && it.error && (
                      <div className="text-[11px] text-red-600">{it.error}</div>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        </div>

        <div className="mt-3 flex flex-wrap gap-2 justify-end items-center">
          {error && <div className="text-sm text-red-600 mr-auto">{error}</div>}
          <button
            className="px-3 py-1 rounded border border-gray-300 bg-white hover:bg-gray-100"
            onClick={onClose}
            disabled={busy}
          >
            Cancel
          </button>
          <button
            className={`px-3 py-1 rounded border ${
              canUpload
                ? "border-blue-700 bg-blue-600 text-white hover:bg-blue-700"
                : "border-gray-300 bg-gray-200 text-gray-500 cursor-not-allowed"
            }`}
            onClick={onUpload}
            disabled={!canUpload}
          >
            {busy ? "Uploading…" : "Upload"}
          </button>
        </div>
      </div>
    </div>,
    document.body,
      )}
    </>
  );
}
