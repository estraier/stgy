"use client";

import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import NextImage from "next/image";
import { createPortal } from "react-dom";
import { Move, Palette, Pipette, RotateCw } from "lucide-react";
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

export type ImageTextOverlay = {
  id: string;
  left: number;
  top: number;
  text: string;
  fontSize: number;
  colorIndex: number;
  outlineColorIndex: number | null;
};

export type ImageEditParams = {
  crop: ImageCropInsets;
  rotationDegrees: number;
  temperature: number;
  tint: number;
  exposureEv: number;
  scaledLog: number;
  sigmoid: number;
  vibrance: number;
  saturation: number;
  resizePercent: number;
  mosaicRegions: ImageMosaicRegion[];
  textOverlays: ImageTextOverlay[];
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

function makeOverlayId(prefix: string): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `${prefix}-${crypto.randomUUID()}`;
  }
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function normalizeTextColorIndex(value: number): number {
  if (!Number.isFinite(value)) return 0;
  const rounded = Math.round(value);
  const mod = rounded % TEXT_OVERLAY_COLORS.length;
  return mod >= 0 ? mod : mod + TEXT_OVERLAY_COLORS.length;
}

function normalizeOptionalTextColorIndex(value: number | null | undefined): number | null {
  if (value == null) return null;
  return normalizeTextColorIndex(value);
}

function normalizeTextOverlay(overlay: Partial<ImageTextOverlay>): ImageTextOverlay {
  return {
    id: typeof overlay.id === "string" && overlay.id ? overlay.id : makeOverlayId("text"),
    left: clamp01(overlay.left ?? 0),
    top: clamp01(overlay.top ?? 0),
    text: typeof overlay.text === "string" ? overlay.text : "",
    fontSize: Math.max(1, Math.round(Number.isFinite(overlay.fontSize) ? overlay.fontSize ?? 1 : 1)),
    colorIndex: normalizeTextColorIndex(overlay.colorIndex ?? 0),
    outlineColorIndex: normalizeOptionalTextColorIndex(overlay.outlineColorIndex),
  };
}

function normalizeTextOverlays(overlays?: ImageTextOverlay[]): ImageTextOverlay[] {
  if (!overlays?.length) return [];
  return overlays.map((overlay) => normalizeTextOverlay(overlay));
}

function normalizeRotationDegrees(value: number): number {
  if (!Number.isFinite(value)) return 0;
  const normalized = ((value + 180) % 360 + 360) % 360 - 180;
  return Math.abs(normalized) < 1e-9 ? 0 : normalized;
}

export function buildDefaultEditParams(w?: number, h?: number): ImageEditParams {
  return {
    crop: { top: 0, bottom: 0, left: 0, right: 0 },
    rotationDegrees: 0,
    temperature: 0,
    tint: 0,
    exposureEv: 0,
    scaledLog: 0,
    sigmoid: 0,
    vibrance: 0,
    saturation: 0,
    resizePercent: defaultResizePercent(w, h),
    mosaicRegions: [],
    textOverlays: [],
  };
}

function normalizeEditParams(params: ImageEditParams | undefined, w?: number, h?: number): ImageEditParams {
  const defaults = buildDefaultEditParams(w, h);
  return {
    crop: normalizeCrop(params?.crop ?? defaults.crop),
    rotationDegrees: normalizeRotationDegrees(params?.rotationDegrees ?? defaults.rotationDegrees),
    temperature: clampWhiteBalanceValue(params?.temperature ?? defaults.temperature),
    tint: clampWhiteBalanceValue(params?.tint ?? defaults.tint),
    exposureEv: clampExposureEv(params?.exposureEv ?? defaults.exposureEv),
    scaledLog: clampScaledLog(params?.scaledLog ?? defaults.scaledLog),
    sigmoid: clampSigmoid(params?.sigmoid ?? defaults.sigmoid),
    vibrance: clampColorAdjustment(params?.vibrance ?? defaults.vibrance),
    saturation: clampColorAdjustment(params?.saturation ?? defaults.saturation),
    resizePercent: Math.min(100, Math.max(1, Math.round(params?.resizePercent ?? defaults.resizePercent))),
    mosaicRegions: normalizeMosaicRegions(params?.mosaicRegions ?? defaults.mosaicRegions),
    textOverlays: normalizeTextOverlays(params?.textOverlays ?? defaults.textOverlays),
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
    Math.abs(normalized.rotationDegrees) > 0.0001 ||
    normalized.temperature !== 0 ||
    normalized.tint !== 0 ||
    Math.abs(normalized.exposureEv) > 0.0001 ||
    Math.abs(normalized.scaledLog) > 0.0001 ||
    Math.abs(normalized.sigmoid) > 0.0001 ||
    normalized.vibrance !== 0 ||
    normalized.saturation !== 0 ||
    normalized.resizePercent !== defaults.resizePercent ||
    normalized.mosaicRegions.length > 0 ||
    normalized.textOverlays.length > 0
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
  // Progressively reduce correction toward white while retaining more WB
  // through the midtones by applying gamma 0.5 to the protection mask.
  const gray = 0.299 * r + 0.587 * g + 0.114 * b;
  const whiteThreshold = 0.98;
  const weight = Math.sqrt(1 - clamp01((gray - (1 - whiteThreshold)) / whiteThreshold));
  const wr = weight * gains.r + (1 - weight);
  const wg = weight * gains.g + (1 - weight);
  const wb = weight * gains.b + (1 - weight);
  return [clamp01(r * wr), clamp01(g * wg), clamp01(b * wb)];
}

const EYEDROPPER_SAMPLE_WEIGHTS = [
  [0.5, 0.8, 0.5],
  [0.8, 1.0, 0.8],
  [0.5, 0.8, 0.5],
] as const;

function catmullRomWeight(distance: number): number {
  const x = Math.abs(distance);
  if (x <= 1) return 1.5 * x * x * x - 2.5 * x * x + 1;
  if (x < 2) return -0.5 * x * x * x + 2.5 * x * x - 4 * x + 2;
  return 0;
}

function sampleEyedropperRgb8(
  image: HTMLImageElement,
  sourceWidth: number,
  sourceHeight: number,
  resizedWidth: number,
  resizedHeight: number,
  centerX: number,
  centerY: number,
): [number, number, number] | null {
  if (
    sourceWidth <= 0 ||
    sourceHeight <= 0 ||
    resizedWidth <= 0 ||
    resizedHeight <= 0
  ) {
    return null;
  }

  const targetPoints: Array<{ x: number; y: number; weight: number }> = [];
  let patchLeft = sourceWidth - 1;
  let patchTop = sourceHeight - 1;
  let patchRight = 0;
  let patchBottom = 0;

  for (let ky = -1; ky <= 1; ky++) {
    for (let kx = -1; kx <= 1; kx++) {
      const x = Math.min(resizedWidth - 1, Math.max(0, centerX + kx));
      const y = Math.min(resizedHeight - 1, Math.max(0, centerY + ky));
      const weight = EYEDROPPER_SAMPLE_WEIGHTS[ky + 1][kx + 1];
      targetPoints.push({ x, y, weight });

      // Match pixel-center mapping for a resized image. Each target pixel is then
      // reconstructed explicitly with Catmull-Rom bicubic interpolation.
      const sourceX = (x + 0.5) * sourceWidth / resizedWidth - 0.5;
      const sourceY = (y + 0.5) * sourceHeight / resizedHeight - 0.5;
      const baseX = Math.floor(sourceX);
      const baseY = Math.floor(sourceY);
      patchLeft = Math.min(patchLeft, Math.max(0, baseX - 1));
      patchTop = Math.min(patchTop, Math.max(0, baseY - 1));
      patchRight = Math.max(patchRight, Math.min(sourceWidth - 1, baseX + 2));
      patchBottom = Math.max(patchBottom, Math.min(sourceHeight - 1, baseY + 2));
    }
  }

  const patchWidth = Math.max(1, patchRight - patchLeft + 1);
  const patchHeight = Math.max(1, patchBottom - patchTop + 1);
  const patchCanvas = document.createElement("canvas");
  patchCanvas.width = patchWidth;
  patchCanvas.height = patchHeight;
  const ctx = patchCanvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(
    image,
    patchLeft,
    patchTop,
    patchWidth,
    patchHeight,
    0,
    0,
    patchWidth,
    patchHeight,
  );
  const pixels = ctx.getImageData(0, 0, patchWidth, patchHeight).data;

  const sampleBicubic = (targetX: number, targetY: number): [number, number, number] => {
    const sourceX = (targetX + 0.5) * sourceWidth / resizedWidth - 0.5;
    const sourceY = (targetY + 0.5) * sourceHeight / resizedHeight - 0.5;
    const baseX = Math.floor(sourceX);
    const baseY = Math.floor(sourceY);
    let red = 0;
    let green = 0;
    let blue = 0;
    let totalWeight = 0;

    for (let iy = baseY - 1; iy <= baseY + 2; iy++) {
      const wy = catmullRomWeight(sourceY - iy);
      const sy = Math.min(sourceHeight - 1, Math.max(0, iy));
      for (let ix = baseX - 1; ix <= baseX + 2; ix++) {
        const wx = catmullRomWeight(sourceX - ix);
        const weight = wx * wy;
        if (weight === 0) continue;
        const sx = Math.min(sourceWidth - 1, Math.max(0, ix));
        const offset = ((sy - patchTop) * patchWidth + (sx - patchLeft)) * 4;
        red += pixels[offset] * weight;
        green += pixels[offset + 1] * weight;
        blue += pixels[offset + 2] * weight;
        totalWeight += weight;
      }
    }

    if (Math.abs(totalWeight) > 1e-12) {
      red /= totalWeight;
      green /= totalWeight;
      blue /= totalWeight;
    }
    return [
      Math.min(255, Math.max(0, red)),
      Math.min(255, Math.max(0, green)),
      Math.min(255, Math.max(0, blue)),
    ];
  };

  let red = 0;
  let green = 0;
  let blue = 0;
  let totalWeight = 0;
  for (const point of targetPoints) {
    const [r, g, b] = sampleBicubic(point.x, point.y);
    red += r * point.weight;
    green += g * point.weight;
    blue += b * point.weight;
    totalWeight += point.weight;
  }
  if (totalWeight <= 0) return null;
  return [red / totalWeight, green / totalWeight, blue / totalWeight];
}

function neutralWhiteBalanceForRgb8(
  red: number,
  green: number,
  blue: number,
): { temperature: number; tint: number } {
  const r = srgbChannelToLinear(red);
  const g = srgbChannelToLinear(green);
  const b = srgbChannelToLinear(blue);
  if (Math.max(r, g, b) <= 1e-8) return { temperature: 0, tint: 0 };

  let bestTemperature = 0;
  let bestTint = 0;
  let bestScore = Number.POSITIVE_INFINITY;

  // Temperature and tint are integer controls in [-100, 100]. Search that exact
  // parameter space against the editor's own white-balance model so the eyedropper
  // result matches the correction that will actually be rendered and encoded.
  for (let candidateTemperature = -100; candidateTemperature <= 100; candidateTemperature++) {
    for (let candidateTint = -100; candidateTint <= 100; candidateTint++) {
      const [rr, gg, bb] = applyWhiteBalanceLinear(
        r,
        g,
        b,
        whiteBalanceGains(candidateTemperature, candidateTint),
      );
      const mean = (rr + gg + bb) / 3;
      const scale = mean * mean + 1e-12;
      const score = (
        (rr - mean) * (rr - mean) +
        (gg - mean) * (gg - mean) +
        (bb - mean) * (bb - mean)
      ) / scale;
      if (score < bestScore) {
        bestScore = score;
        bestTemperature = candidateTemperature;
        bestTint = candidateTint;
      }
    }
  }

  return { temperature: bestTemperature, tint: bestTint };
}

function exposedPercentileFromRgb8(
  data: Uint8ClampedArray,
  factor: number,
  percentile = 99.8,
  ignoreTransparent = false,
): number {
  const histogram = new Uint32Array(256);
  let sampleCount = 0;
  for (let i = 0; i < data.length; i += 4) {
    if (ignoreTransparent && data[i + 3] === 0) continue;
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
  ignoreTransparent = false,
): number {
  const histogram = new Uint32Array(65536);
  let sampleCount = 0;
  for (let i = 0; i < data.length; i += 4) {
    if (ignoreTransparent && data[i + 3] === 0) continue;
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
  const gamma = HISTOGRAM_DISPLAY_GAMMA;
  const encoded = Math.pow(x, 1 / gamma);
  if (g > 1e-6) {
    const minVal = naiveSigmoid(0, g, mid);
    const maxVal = naiveSigmoid(1, g, mid);
    const adjusted = clamp01((naiveSigmoid(encoded, g, mid) - minVal) / (maxVal - minVal));
    return clamp01(Math.pow(adjusted, gamma));
  }
  if (g < -1e-6) {
    const magnitude = -g;
    const minVal = naiveInverseSigmoid(0, magnitude, mid);
    const maxVal = naiveInverseSigmoid(1, magnitude, mid);
    const adjusted = clamp01(
      (naiveInverseSigmoid(encoded, magnitude, mid) - minVal) / (maxVal - minVal),
    );
    return clamp01(Math.pow(adjusted, gamma));
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
  ignoreTransparent = false,
): number {
  if (saturationFactor <= 1) return 0;
  const bins = 4096;
  const maxValue = Math.max(1, saturationFactor);
  const histogram = new Uint32Array(bins);
  let sampleCount = 0;
  for (let i = 0; i < data.length; i += 4) {
    if (ignoreTransparent && data[i + 3] === 0) continue;
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

type ColorAdjustmentContext = {
  gains: WhiteBalanceGains;
  hasWhiteBalance: boolean;
  factor: number;
  rolloff: { inflection: number; scale: number } | null;
  scaledLog: number;
  sigmoid: number;
  normalizedVibrance: number;
  normalizedSaturation: number;
  saturationFactor: number;
  vibranceFactor: number;
  saturationRolloff: { inflection: number; scale: number } | null;
};

function buildColorAdjustmentContextFromRgb8(
  data: Uint8ClampedArray,
  temperature: number,
  tint: number,
  exposureEv: number,
  scaledLog: number,
  sigmoid: number,
  vibrance: number,
  saturation: number,
  ignoreTransparent = false,
): ColorAdjustmentContext {
  const normalizedTemperature = clampWhiteBalanceValue(temperature);
  const normalizedTint = clampWhiteBalanceValue(tint);
  const normalizedScaledLog = clampScaledLog(scaledLog);
  const normalizedSigmoid = clampSigmoid(sigmoid);
  const normalizedVibrance = clampColorAdjustment(vibrance);
  const normalizedSaturation = clampColorAdjustment(saturation);
  const factor = Math.pow(2, exposureEv);
  const gains = whiteBalanceGains(normalizedTemperature, normalizedTint);
  const hasWhiteBalance = normalizedTemperature !== 0 || normalizedTint !== 0;
  const maxVal =
    factor > 1
      ? hasWhiteBalance
        ? whiteBalancedExposedPercentileFromRgb8(data, gains, factor, 99.8, ignoreTransparent)
        : exposedPercentileFromRgb8(data, factor, 99.8, ignoreTransparent)
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
          ignoreTransparent,
        ),
        0.7,
        4,
      )
    : null;
  return {
    gains,
    hasWhiteBalance,
    factor,
    rolloff,
    scaledLog: normalizedScaledLog,
    sigmoid: normalizedSigmoid,
    normalizedVibrance,
    normalizedSaturation,
    saturationFactor,
    vibranceFactor,
    saturationRolloff,
  };
}

function applyColorAdjustmentsLinearRgb(
  r: number,
  g: number,
  b: number,
  context: ColorAdjustmentContext,
): [number, number, number] {
  [r, g, b] = applyToneLinearToRgb(
    r,
    g,
    b,
    context.gains,
    context.hasWhiteBalance,
    context.factor,
    context.rolloff,
    context.scaledLog,
    context.sigmoid,
  );
  if (context.normalizedSaturation !== 0 || context.normalizedVibrance !== 0) {
    const [h, initialS, v] = rgbToHsv(r, g, b);
    let s = initialS;
    if (context.normalizedSaturation !== 0) {
      s = applyRolloffScalar(s * context.saturationFactor, context.saturationRolloff);
      s = clamp01(s);
    }
    if (context.normalizedVibrance !== 0) {
      s = applyScaledLogLinear(s, context.vibranceFactor);
    }
    [r, g, b] = hsvToRgb(h, s, v);
  }
  return [r, g, b];
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
  ignoreTransparent = false,
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
  const width = "width" in canvas ? canvas.width : 0;
  const height = "height" in canvas ? canvas.height : 0;
  if (!width || !height) return;
  const imageData = ctx.getImageData(0, 0, width, height);
  const data = imageData.data;
  const context = buildColorAdjustmentContextFromRgb8(
    data,
    normalizedTemperature,
    normalizedTint,
    exposureEv,
    normalizedScaledLog,
    normalizedSigmoid,
    normalizedVibrance,
    normalizedSaturation,
    ignoreTransparent,
  );
  for (let i = 0; i < data.length; i += 4) {
    if (ignoreTransparent && data[i + 3] === 0) continue;
    let r = srgbChannelToLinear(data[i]);
    let g = srgbChannelToLinear(data[i + 1]);
    let b = srgbChannelToLinear(data[i + 2]);
    [r, g, b] = applyColorAdjustmentsLinearRgb(r, g, b, context);
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

let textMeasureContext: CanvasRenderingContext2D | null = null;
function getTextMeasureContext(): CanvasRenderingContext2D | null {
  if (textMeasureContext) return textMeasureContext;
  if (typeof document === "undefined") return null;
  const canvas = document.createElement("canvas");
  textMeasureContext = canvas.getContext("2d");
  return textMeasureContext;
}

function measureTextOverlayLayout(text: string, fontSize: number): Pick<TextOverlayLayout, "width" | "height" | "lineHeight"> {
  const size = Math.max(1, fontSize);
  const lineHeight = Math.max(1, size * TEXT_OVERLAY_LINE_HEIGHT);
  const lines = text.split("\n");
  const ctx = getTextMeasureContext();
  let maxWidth = size;
  if (ctx) {
    ctx.font = `${size}px ${TEXT_OVERLAY_FONT_FAMILY}`;
    maxWidth = Math.max(
      size,
      ...lines.map((line) => ctx.measureText(line.length > 0 ? line : "　").width),
    );
  }
  return {
    width: Math.max(
      TEXT_OVERLAY_MIN_BOX_WIDTH,
      size + TEXT_OVERLAY_BOX_PADDING_X * 2 + 2,
      Math.ceil(maxWidth + TEXT_OVERLAY_BOX_PADDING_X * 2 + 2),
    ),
    height: Math.max(
      lineHeight + TEXT_OVERLAY_BOX_PADDING_Y * 2,
      Math.ceil(lines.length * lineHeight + TEXT_OVERLAY_BOX_PADDING_Y * 2),
    ),
    lineHeight,
  };
}

function textOverlayOutlineRadius(fontSize: number): number {
  return Math.max(1.5, fontSize * 0.015);
}

const textOverlayOutlineOffsetsCache = new Map<number, Array<[number, number]>>();
function textOverlayOutlineOffsets(fontSize: number): Array<[number, number]> {
  const radius = textOverlayOutlineRadius(fontSize);
  // Quantize only the cache key. The offsets themselves remain sub-pixel so the
  // browser/canvas rasterizer can antialias the dilated edge instead of producing
  // the stair-step boundary caused by integer-only copies.
  const cacheKey = Math.max(4, Math.round(radius * 4));
  const cached = textOverlayOutlineOffsetsCache.get(cacheKey);
  if (cached) return cached;

  const effectiveRadius = cacheKey / 4;
  const radialStep = 0.5;
  const arcStep = 0.75;
  const rings = Math.max(1, Math.ceil(effectiveRadius / radialStep));
  const offsets: Array<[number, number]> = [];
  for (let ring = 1; ring <= rings; ring++) {
    const r = effectiveRadius * ring / rings;
    const samples = Math.max(12, Math.ceil(2 * Math.PI * r / arcStep));
    for (let i = 0; i < samples; i++) {
      const angle = 2 * Math.PI * i / samples;
      offsets.push([Math.cos(angle) * r, Math.sin(angle) * r]);
    }
  }
  textOverlayOutlineOffsetsCache.set(cacheKey, offsets);
  return offsets;
}

function textOverlayOutlineStyle(fontSize: number, outlineColorIndex: number | null): React.CSSProperties {
  if (outlineColorIndex == null) return {};
  const color = TEXT_OVERLAY_COLORS[normalizeTextColorIndex(outlineColorIndex)];
  const shadows = textOverlayOutlineOffsets(fontSize).map(
    ([dx, dy]) => `${dx.toFixed(2)}px ${dy.toFixed(2)}px 0 ${color}`,
  );
  return {
    textShadow: shadows.join(", "),
  };
}

function nextOutlineColorIndex(value: number | null): number | null {
  if (value == null) return 0;
  return value + 1 >= TEXT_OVERLAY_COLORS.length ? null : value + 1;
}

async function ensureTextOverlayFontReady(): Promise<void> {
  if (typeof document === "undefined") return;
  const doc = document as Document & {
    fonts?: {
      load?: (font: string) => Promise<unknown>;
      ready?: Promise<unknown>;
    };
  };
  try {
    await doc.fonts?.ready;
    await doc.fonts?.load?.(`16px ${TEXT_OVERLAY_FONT_FAMILY}`);
  } catch {}
}

function drawTextOverlaysToContext(
  ctx: RotationCanvasContext,
  overlays: ImageTextOverlay[],
  sourceW: number,
  sourceH: number,
  cropX: number,
  cropY: number,
  cropW: number,
  cropH: number,
  outputW: number,
  outputH: number,
  rotationDegrees: number,
) {
  if (!overlays.length) return;
  const scaleX = outputW / cropW;
  const scaleY = outputH / cropH;
  const centerX = sourceW / 2;
  const centerY = sourceH / 2;
  ctx.save();
  ctx.textBaseline = "top";
  for (const overlay of overlays) {
    const point = rotatePoint(
      overlay.left * sourceW,
      overlay.top * sourceH,
      centerX,
      centerY,
      rotationDegrees,
    );
    const fontSize = Math.max(1, overlay.fontSize * scaleX);
    const lineHeight = Math.max(1, fontSize * TEXT_OVERLAY_LINE_HEIGHT);
    const x = (point.x - cropX) * scaleX;
    const y = (point.y - cropY) * scaleY;
    ctx.font = `${fontSize}px ${TEXT_OVERLAY_FONT_FAMILY}`;
    ctx.fillStyle = TEXT_OVERLAY_COLORS[normalizeTextColorIndex(overlay.colorIndex)];
    const outlineColor = normalizeOptionalTextColorIndex(overlay.outlineColorIndex);
    const outlineOffsets = outlineColor == null ? [] : textOverlayOutlineOffsets(fontSize);
    const lines = overlay.text.split("\n");
    for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
      if (outlineColor != null) {
        const lineY = y + lineIndex * lineHeight;
        ctx.fillStyle = TEXT_OVERLAY_COLORS[outlineColor];
        for (const [dx, dy] of outlineOffsets) {
          ctx.fillText(lines[lineIndex], x + dx, lineY + dy);
        }
        ctx.fillStyle = TEXT_OVERLAY_COLORS[normalizeTextColorIndex(overlay.colorIndex)];
      }
      ctx.fillText(lines[lineIndex], x, y + lineIndex * lineHeight);
    }
  }
  ctx.restore();
}

type RotationCanvasContext = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

function rotatePoint(
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

function inverseRotatePoint(
  x: number,
  y: number,
  centerX: number,
  centerY: number,
  degrees: number,
): EditPoint {
  return rotatePoint(x, y, centerX, centerY, -degrees);
}

function drawRotatedSourceToContext(
  ctx: RotationCanvasContext,
  source: CanvasImageSource,
  sourceW: number,
  sourceH: number,
  cropX: number,
  cropY: number,
  scaleX: number,
  scaleY: number,
  rotationDegrees: number,
) {
  ctx.save();
  ctx.setTransform(scaleX, 0, 0, scaleY, -cropX * scaleX, -cropY * scaleY);
  ctx.translate(sourceW / 2, sourceH / 2);
  ctx.rotate(normalizeRotationDegrees(rotationDegrees) * Math.PI / 180);
  ctx.translate(-sourceW / 2, -sourceH / 2);
  ctx.drawImage(source, 0, 0, sourceW, sourceH);
  ctx.restore();
}

function fillRotationPadding(
  ctx: RotationCanvasContext,
  canvasW: number,
  canvasH: number,
  sourceW: number,
  sourceH: number,
  cropX: number,
  cropY: number,
  scaleX: number,
  scaleY: number,
  rotationDegrees: number,
) {
  if (Math.abs(normalizeRotationDegrees(rotationDegrees)) < 1e-9) return;
  const centerX = sourceW / 2;
  const centerY = sourceH / 2;
  const corners = [
    rotatePoint(0, 0, centerX, centerY, rotationDegrees),
    rotatePoint(sourceW, 0, centerX, centerY, rotationDegrees),
    rotatePoint(sourceW, sourceH, centerX, centerY, rotationDegrees),
    rotatePoint(0, sourceH, centerX, centerY, rotationDegrees),
  ].map((point) => ({
    x: (point.x - cropX) * scaleX,
    y: (point.y - cropY) * scaleY,
  }));

  ctx.save();
  ctx.globalCompositeOperation = "destination-over";
  ctx.fillStyle = "rgb(128, 128, 128)";
  ctx.beginPath();
  ctx.rect(0, 0, canvasW, canvasH);
  ctx.moveTo(corners[0].x, corners[0].y);
  for (let i = 1; i < corners.length; i++) ctx.lineTo(corners[i].x, corners[i].y);
  ctx.closePath();
  ctx.fill("evenodd");
  ctx.restore();
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
    const hasRotation = Math.abs(params.rotationDegrees) > 1e-9;
    const dw = Math.max(1, Math.round(sw * params.resizePercent / 100));
    const dh = Math.max(1, Math.round(sh * params.resizePercent / 100));
    if (params.textOverlays.length > 0) {
      await ensureTextOverlayFontReady();
    }
    let blob: Blob | null = null;
    const OSC = getOffscreenCanvasCtor();
    if (OSC) {
      // Keep the processing order explicit: rotate -> crop -> white balance -> exposure/rolloff
      // -> logarithm -> sigmoid -> vibrance/saturation -> fill rotation padding -> resize
      // -> mosaic -> encode.
      // White balance, tone, and color adjustments share one linear-RGB pass so
      // there is no extra 8-bit round-trip between them.
      const cropped = new OSC(sw, sh);
      const croppedCtx = cropped.getContext("2d");
      if (!croppedCtx) throw new Error("2D context unavailable");
      if (hasRotation) {
        croppedCtx.imageSmoothingEnabled = true;
        croppedCtx.imageSmoothingQuality = "high";
        drawRotatedSourceToContext(
          croppedCtx,
          source,
          w,
          h,
          sx,
          sy,
          1,
          1,
          params.rotationDegrees,
        );
      } else {
        croppedCtx.drawImage(source, sx, sy, sw, sh, 0, 0, sw, sh);
      }
      applyColorAdjustmentsToCanvas(
        cropped,
        params.temperature,
        params.tint,
        params.exposureEv,
        params.scaledLog,
        params.sigmoid,
        params.vibrance,
        params.saturation,
        hasRotation,
      );
      if (hasRotation) {
        fillRotationPadding(croppedCtx, sw, sh, w, h, sx, sy, 1, 1, params.rotationDegrees);
      }

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
      drawTextOverlaysToContext(
        outputCtx,
        params.textOverlays,
        w,
        h,
        sx,
        sy,
        sw,
        sh,
        dw,
        dh,
        params.rotationDegrees,
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
      if (hasRotation) {
        croppedCtx.imageSmoothingEnabled = true;
        croppedCtx.imageSmoothingQuality = "high";
        drawRotatedSourceToContext(
          croppedCtx,
          source,
          w,
          h,
          sx,
          sy,
          1,
          1,
          params.rotationDegrees,
        );
      } else {
        croppedCtx.drawImage(source, sx, sy, sw, sh, 0, 0, sw, sh);
      }
      applyColorAdjustmentsToCanvas(
        cropped,
        params.temperature,
        params.tint,
        params.exposureEv,
        params.scaledLog,
        params.sigmoid,
        params.vibrance,
        params.saturation,
        hasRotation,
      );
      if (hasRotation) {
        fillRotationPadding(croppedCtx, sw, sh, w, h, sx, sy, 1, 1, params.rotationDegrees);
      }

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
      drawTextOverlaysToContext(
        outputCtx,
        params.textOverlays,
        w,
        h,
        sx,
        sy,
        sw,
        sh,
        dw,
        dh,
        params.rotationDegrees,
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
type TextOverlayLayout = {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  fontSize: number;
  lineHeight: number;
  text: string;
  colorIndex: number;
  outlineColorIndex: number | null;
};
type HistogramData = {
  r: number[];
  g: number[];
  b: number[];
  luma: number[];
  maxCount: number;
};
const EDIT_PREVIEW_MARGIN_PX = 8;
const TEXT_OVERLAY_DEFAULT_FONT_SIZE_RATIO = 0.05;
const TEXT_OVERLAY_FONT_STEP = Math.pow(2, 1 / 8);
const TEXT_OVERLAY_FONT_FAMILY = '"Noto Sans JP", sans-serif';
const TEXT_OVERLAY_LINE_HEIGHT = 1.2;
const TEXT_OVERLAY_BOX_PADDING_X = 6;
const TEXT_OVERLAY_BOX_PADDING_Y = 4;
const TEXT_OVERLAY_CONTROL_BUTTON_SIZE = 20;
const TEXT_OVERLAY_CONTROL_GAP = 4;
const TEXT_OVERLAY_DELETE_BUTTON_SIZE = 20;
const TEXT_OVERLAY_CONTROL_SAFE_GAP = 8;
const TEXT_OVERLAY_COLORS = [
  "#000000",
  "#808080",
  "#ffffff",
  "#ff0000",
  "#ff8c00",
  "#ffd400",
  "#00aa00",
  "#0066ff",
  "#8000ff",
] as const;
const TEXT_OVERLAY_MIN_BOX_WIDTH =
  TEXT_OVERLAY_CONTROL_BUTTON_SIZE * 5 +
  TEXT_OVERLAY_CONTROL_GAP * 4 +
  TEXT_OVERLAY_DELETE_BUTTON_SIZE +
  TEXT_OVERLAY_CONTROL_SAFE_GAP;
const HISTOGRAM_BINS = 256;
const HISTOGRAM_SAMPLE_MAX = 256;
const HISTOGRAM_DISPLAY_GAMMA = 2.4;

function histogramDisplayValue(linear: number): number {
  return Math.pow(clamp01(linear), 1 / HISTOGRAM_DISPLAY_GAMMA);
}

function addHistogramInterval(
  output: number[],
  lo: number,
  hi: number,
  weight: number,
) {
  if (weight <= 0) return;
  const displayLo = clamp01(Math.min(lo, hi));
  const displayHi = clamp01(Math.max(lo, hi));
  const width = displayHi - displayLo;
  if (width <= 1e-12) {
    const bin = Math.min(
      HISTOGRAM_BINS - 1,
      Math.max(0, Math.floor(displayLo * HISTOGRAM_BINS)),
    );
    output[bin] += weight;
    return;
  }

  const firstBin = Math.min(
    HISTOGRAM_BINS - 1,
    Math.max(0, Math.floor(displayLo * HISTOGRAM_BINS)),
  );
  const lastBin = Math.min(
    HISTOGRAM_BINS - 1,
    Math.max(0, Math.ceil(displayHi * HISTOGRAM_BINS) - 1),
  );
  for (let bin = firstBin; bin <= lastBin; bin++) {
    const binLo = bin / HISTOGRAM_BINS;
    const binHi = (bin + 1) / HISTOGRAM_BINS;
    const overlap = Math.min(displayHi, binHi) - Math.max(displayLo, binLo);
    if (overlap > 0) output[bin] += weight * overlap / width;
  }
}

type ToneAutoSample = {
  data: Uint8ClampedArray;
};

const TONE_AUTO_EXPOSURE_CLIP_PENALTY = 50;
const TONE_AUTO_EXPOSURE_HIGHLIGHT_START = 0.95;
const TONE_AUTO_EXPOSURE_HIGHLIGHT_PENALTY = 1;
const TONE_AUTO_LOG_MIN = -3;
const TONE_AUTO_LOG_MAX = 3;
const TONE_AUTO_LOG_LOWER = 0.42;
const TONE_AUTO_LOG_UPPER = 0.58;
const TONE_AUTO_SIGMOID_MAX = 3;
const TONE_AUTO_SIGMOID_BLACK_THRESHOLD = 0.05;
const TONE_AUTO_SIGMOID_WHITE_THRESHOLD = 0.95;
const TONE_AUTO_SIGMOID_BLACK_PENALTY = 2;
const TONE_AUTO_SIGMOID_WHITE_PENALTY = 2;

function createToneAutoSample(
  sourceImage: HTMLImageElement,
  sourceRect: { x: number; y: number; w: number; h: number },
  rotationDegrees: number,
): ToneAutoSample | null {
  const sourceW = sourceImage.naturalWidth;
  const sourceH = sourceImage.naturalHeight;
  if (sourceW <= 0 || sourceH <= 0) return null;

  const sx = Math.max(0, Math.min(sourceW - 1, Math.floor(sourceRect.x)));
  const sy = Math.max(0, Math.min(sourceH - 1, Math.floor(sourceRect.y)));
  const ex = Math.max(sx + 1, Math.min(sourceW, Math.ceil(sourceRect.x + sourceRect.w)));
  const ey = Math.max(sy + 1, Math.min(sourceH, Math.ceil(sourceRect.y + sourceRect.h)));
  const sw = ex - sx;
  const sh = ey - sy;
  if (sw <= 0 || sh <= 0) return null;

  const scale = Math.min(1, HISTOGRAM_SAMPLE_MAX / Math.max(sw, sh));
  const sampleW = Math.max(1, Math.round(sw * scale));
  const sampleH = Math.max(1, Math.round(sh * scale));
  const sampleCanvas = document.createElement("canvas");
  sampleCanvas.width = sampleW;
  sampleCanvas.height = sampleH;
  const sampleCtx = sampleCanvas.getContext("2d");
  if (!sampleCtx) return null;
  sampleCtx.imageSmoothingEnabled = false;
  sampleCtx.clearRect(0, 0, sampleW, sampleH);
  if (Math.abs(normalizeRotationDegrees(rotationDegrees)) > 1e-9) {
    drawRotatedSourceToContext(
      sampleCtx,
      sourceImage,
      sourceW,
      sourceH,
      sx,
      sy,
      sampleW / sw,
      sampleH / sh,
      rotationDegrees,
    );
  } else {
    sampleCtx.drawImage(sourceImage, sx, sy, sw, sh, 0, 0, sampleW, sampleH);
  }
  return { data: sampleCtx.getImageData(0, 0, sampleW, sampleH).data };
}

function toneHistogramPercentile(histogram: Float64Array, total: number, percentile: number): number {
  if (total <= 0) return 0;
  const target = clamp01(percentile) * total;
  let cumulative = 0;
  for (let bin = 0; bin < histogram.length; bin++) {
    const count = histogram[bin];
    const next = cumulative + count;
    if (target <= next || bin === histogram.length - 1) {
      const fraction = count > 0 ? clamp01((target - cumulative) / count) : 0.5;
      return clamp01((bin + fraction) / histogram.length);
    }
    cumulative = next;
  }
  return 1;
}

function toneHistogramTrimmedMean(
  histogram: Float64Array,
  total: number,
  lowerFraction = 0.25,
  upperFraction = 0.75,
): number {
  if (total <= 0) return 0.5;
  const lower = clamp01(lowerFraction) * total;
  const upper = clamp01(upperFraction) * total;
  if (upper <= lower) return 0.5;
  let cumulative = 0;
  let weightedSum = 0;
  let included = 0;
  for (let bin = 0; bin < histogram.length; bin++) {
    const count = histogram[bin];
    const next = cumulative + count;
    const overlap = Math.max(0, Math.min(next, upper) - Math.max(cumulative, lower));
    if (overlap > 0) {
      weightedSum += overlap * ((bin + 0.5) / histogram.length);
      included += overlap;
    }
    cumulative = next;
    if (cumulative >= upper) break;
  }
  return included > 0 ? weightedSum / included : 0.5;
}

function toneHistogramTailFraction(
  histogram: Float64Array,
  total: number,
  lowerExclusive: number,
  upperInclusive: number,
): number {
  if (total <= 0) return 0;
  let count = 0;
  for (let bin = 0; bin < histogram.length; bin++) {
    const center = (bin + 0.5) / histogram.length;
    if (center < lowerExclusive || center > upperInclusive) {
      count += histogram[bin];
    }
  }
  return count / total;
}

function buildToneLumaHistogram(
  sample: ToneAutoSample,
  temperature: number,
  tint: number,
  exposureEv: number,
  scaledLog: number,
  sigmoid: number,
): { histogram: Float64Array; total: number } {
  const histogram = new Float64Array(HISTOGRAM_BINS);
  const data = sample.data;
  const context = buildColorAdjustmentContextFromRgb8(
    data,
    temperature,
    tint,
    exposureEv,
    scaledLog,
    sigmoid,
    0,
    0,
    true,
  );
  let total = 0;
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] === 0) continue;
    let r = srgbChannelToLinear(data[i]);
    let g = srgbChannelToLinear(data[i + 1]);
    let b = srgbChannelToLinear(data[i + 2]);
    [r, g, b] = applyToneLinearToRgb(
      r,
      g,
      b,
      context.gains,
      context.hasWhiteBalance,
      context.factor,
      context.rolloff,
      context.scaledLog,
      context.sigmoid,
    );
    const y = clamp01(0.2126 * r + 0.7152 * g + 0.0722 * b);
    const display = histogramDisplayValue(y);
    const bin = Math.min(HISTOGRAM_BINS - 1, Math.max(0, Math.floor(display * HISTOGRAM_BINS)));
    histogram[bin] += 1;
    total += 1;
  }
  return { histogram, total };
}

function evaluateAutoExposure(
  sample: ToneAutoSample,
  temperature: number,
  tint: number,
  exposureEv: number,
): { richness: number; clipRate: number; highlightPressure: number } {
  const data = sample.data;
  const context = buildColorAdjustmentContextFromRgb8(
    data,
    temperature,
    tint,
    exposureEv,
    0,
    0,
    0,
    0,
    true,
  );
  const histogram = new Float64Array(HISTOGRAM_BINS);
  let total = 0;
  let clipped = 0;
  let highlightPressure = 0;

  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] === 0) continue;
    let r = srgbChannelToLinear(data[i]);
    let g = srgbChannelToLinear(data[i + 1]);
    let b = srgbChannelToLinear(data[i + 2]);
    if (context.hasWhiteBalance) {
      [r, g, b] = applyWhiteBalanceLinear(r, g, b, context.gains);
    }
    r *= context.factor;
    g *= context.factor;
    b *= context.factor;
    const maxChannel = Math.max(r, g, b);
    if (maxChannel >= 1) clipped += 1;
    if (maxChannel > TONE_AUTO_EXPOSURE_HIGHLIGHT_START) {
      const pressure = clamp01(
        (Math.min(maxChannel, 1) - TONE_AUTO_EXPOSURE_HIGHLIGHT_START) /
          (1 - TONE_AUTO_EXPOSURE_HIGHLIGHT_START),
      );
      highlightPressure += pressure * pressure;
    }
    const y = clamp01(0.2126 * clamp01(r) + 0.7152 * clamp01(g) + 0.0722 * clamp01(b));
    const display = histogramDisplayValue(y);
    const bin = Math.min(HISTOGRAM_BINS - 1, Math.max(0, Math.floor(display * HISTOGRAM_BINS)));
    histogram[bin] += 1;
    total += 1;
  }
  if (total <= 0) return { richness: 0, clipRate: 0, highlightPressure: 0 };

  let entropy = 0;
  for (let bin = 0; bin < histogram.length; bin++) {
    const count = histogram[bin];
    if (count <= 0) continue;
    const p = count / total;
    entropy -= p * Math.log(p);
  }
  const normalizedEntropy = entropy / Math.log(HISTOGRAM_BINS);
  const p2 = toneHistogramPercentile(histogram, total, 0.02);
  const p98 = toneHistogramPercentile(histogram, total, 0.98);
  return {
    richness: normalizedEntropy * Math.max(0, p98 - p2),
    clipRate: clipped / total,
    highlightPressure: highlightPressure / total,
  };
}

function findAutoExposure(
  sample: ToneAutoSample,
  temperature: number,
  tint: number,
): number {
  const baseline = evaluateAutoExposure(sample, temperature, tint, 0);
  const baselineClip = baseline.clipRate;
  const baselineHighlightPressure = baseline.highlightPressure;
  let bestEv = 0;
  let bestScore = -Infinity;
  for (let step = -30; step <= 30; step++) {
    const ev = step / 10;
    const evaluation = evaluateAutoExposure(sample, temperature, tint, ev);
    const newClip = Math.max(0, evaluation.clipRate - baselineClip);
    const newHighlightPressure = Math.max(
      0,
      evaluation.highlightPressure - baselineHighlightPressure,
    );
    const score =
      evaluation.richness -
      TONE_AUTO_EXPOSURE_CLIP_PENALTY * newClip -
      TONE_AUTO_EXPOSURE_HIGHLIGHT_PENALTY * newHighlightPressure;
    if (
      score > bestScore + 1e-12 ||
      (Math.abs(score - bestScore) <= 1e-12 && Math.abs(ev) < Math.abs(bestEv))
    ) {
      bestScore = score;
      bestEv = ev;
    }
  }
  return clampExposureEv(bestEv);
}

function findAutoLogarithm(
  sample: ToneAutoSample,
  temperature: number,
  tint: number,
  exposureEv: number,
): number {
  const initial = buildToneLumaHistogram(sample, temperature, tint, exposureEv, 0, 0);
  const initialMean = toneHistogramTrimmedMean(initial.histogram, initial.total);
  if (initialMean >= TONE_AUTO_LOG_LOWER && initialMean <= TONE_AUTO_LOG_UPPER) return 0;

  if (initialMean < TONE_AUTO_LOG_LOWER) {
    for (let step = 1; step <= Math.round(TONE_AUTO_LOG_MAX * 10); step++) {
      const value = step / 10;
      const result = buildToneLumaHistogram(sample, temperature, tint, exposureEv, value, 0);
      if (toneHistogramTrimmedMean(result.histogram, result.total) >= TONE_AUTO_LOG_LOWER) {
        return clampScaledLog(value);
      }
    }
    return clampScaledLog(TONE_AUTO_LOG_MAX);
  }

  for (let step = 1; step <= Math.round(Math.abs(TONE_AUTO_LOG_MIN) * 10); step++) {
    const value = -step / 10;
    const result = buildToneLumaHistogram(sample, temperature, tint, exposureEv, value, 0);
    if (toneHistogramTrimmedMean(result.histogram, result.total) <= TONE_AUTO_LOG_UPPER) {
      return clampScaledLog(value);
    }
  }
  return clampScaledLog(TONE_AUTO_LOG_MIN);
}

function findAutoSigmoid(
  sample: ToneAutoSample,
  temperature: number,
  tint: number,
  exposureEv: number,
  scaledLog: number,
): number {
  const baseline = buildToneLumaHistogram(sample, temperature, tint, exposureEv, scaledLog, 0);
  const baselineBlack = toneHistogramTailFraction(
    baseline.histogram,
    baseline.total,
    TONE_AUTO_SIGMOID_BLACK_THRESHOLD,
    1,
  );
  const baselineWhite = toneHistogramTailFraction(
    baseline.histogram,
    baseline.total,
    0,
    TONE_AUTO_SIGMOID_WHITE_THRESHOLD,
  );

  let bestValue = 0;
  let bestScore = -Infinity;

  for (
    let step = -Math.round(TONE_AUTO_SIGMOID_MAX * 10);
    step <= Math.round(TONE_AUTO_SIGMOID_MAX * 10);
    step++
  ) {
    const value = step / 10;
    const result = buildToneLumaHistogram(
      sample,
      temperature,
      tint,
      exposureEv,
      scaledLog,
      value,
    );
    if (result.total <= 0) continue;

    let entropy = 0;
    for (let bin = 0; bin < result.histogram.length; bin++) {
      const count = result.histogram[bin];
      if (count <= 0) continue;
      const p = count / result.total;
      entropy -= p * Math.log(p);
    }
    const normalizedEntropy = entropy / Math.log(HISTOGRAM_BINS);
    const blackFraction = toneHistogramTailFraction(
      result.histogram,
      result.total,
      TONE_AUTO_SIGMOID_BLACK_THRESHOLD,
      1,
    );
    const whiteFraction = toneHistogramTailFraction(
      result.histogram,
      result.total,
      0,
      TONE_AUTO_SIGMOID_WHITE_THRESHOLD,
    );
    const newBlack = Math.max(0, blackFraction - baselineBlack);
    const newWhite = Math.max(0, whiteFraction - baselineWhite);
    const score =
      normalizedEntropy -
      TONE_AUTO_SIGMOID_BLACK_PENALTY * newBlack -
      TONE_AUTO_SIGMOID_WHITE_PENALTY * newWhite;

    if (
      score > bestScore + 1e-12 ||
      (Math.abs(score - bestScore) <= 1e-12 && Math.abs(value) < Math.abs(bestValue))
    ) {
      bestScore = score;
      bestValue = value;
    }
  }

  return clampSigmoid(bestValue);
}
function computeHistogramData(
  sourceImage: HTMLImageElement,
  sourceRect: { x: number; y: number; w: number; h: number },
  rotationDegrees: number,
  temperature: number,
  tint: number,
  exposureEv: number,
  scaledLog: number,
  sigmoid: number,
  vibrance: number,
  saturation: number,
): HistogramData | null {
  const sourceW = sourceImage.naturalWidth;
  const sourceH = sourceImage.naturalHeight;
  if (sourceW <= 0 || sourceH <= 0) return null;

  const sx = Math.max(0, Math.min(sourceW - 1, Math.floor(sourceRect.x)));
  const sy = Math.max(0, Math.min(sourceH - 1, Math.floor(sourceRect.y)));
  const ex = Math.max(sx + 1, Math.min(sourceW, Math.ceil(sourceRect.x + sourceRect.w)));
  const ey = Math.max(sy + 1, Math.min(sourceH, Math.ceil(sourceRect.y + sourceRect.h)));
  const sw = ex - sx;
  const sh = ey - sy;
  if (sw <= 0 || sh <= 0) return null;

  // Histogram processing is deliberately independent from the displayed preview canvas.
  // Take an evenly spaced nearest-neighbour sample of the rotated crop. Each sample
  // represents the same area of the crop and therefore contributes cropArea / sampleCount
  // pixels. Rotation padding remains transparent while the edit context is computed so the
  // fixed 50% gray padding cannot alter exposure or saturation rolloff statistics.
  const scale = Math.min(1, HISTOGRAM_SAMPLE_MAX / Math.max(sw, sh));
  const sampleW = Math.max(1, Math.round(sw * scale));
  const sampleH = Math.max(1, Math.round(sh * scale));
  const sampleCanvas = document.createElement("canvas");
  sampleCanvas.width = sampleW;
  sampleCanvas.height = sampleH;
  const sampleCtx = sampleCanvas.getContext("2d");
  if (!sampleCtx) return null;
  sampleCtx.imageSmoothingEnabled = false;
  sampleCtx.clearRect(0, 0, sampleW, sampleH);
  if (Math.abs(normalizeRotationDegrees(rotationDegrees)) > 1e-9) {
    drawRotatedSourceToContext(
      sampleCtx,
      sourceImage,
      sourceW,
      sourceH,
      sx,
      sy,
      sampleW / sw,
      sampleH / sh,
      rotationDegrees,
    );
  } else {
    sampleCtx.drawImage(sourceImage, sx, sy, sw, sh, 0, 0, sampleW, sampleH);
  }
  const sampleData = sampleCtx.getImageData(0, 0, sampleW, sampleH).data;
  if (!sampleData.length) return null;

  const hasRotation = Math.abs(normalizeRotationDegrees(rotationDegrees)) > 1e-9;
  const adjustment = buildColorAdjustmentContextFromRgb8(
    sampleData,
    temperature,
    tint,
    exposureEv,
    scaledLog,
    sigmoid,
    vibrance,
    saturation,
    hasRotation,
  );
  const r = new Array<number>(HISTOGRAM_BINS).fill(0);
  const g = new Array<number>(HISTOGRAM_BINS).fill(0);
  const b = new Array<number>(HISTOGRAM_BINS).fill(0);
  const luma = new Array<number>(HISTOGRAM_BINS).fill(0);
  const areaWeight = sw * sh / (sampleW * sampleH);

  for (let i = 0; i < sampleData.length; i += 4) {
    const rc = sampleData[i] ?? 0;
    const gc = sampleData[i + 1] ?? 0;
    const bc = sampleData[i + 2] ?? 0;

    if (hasRotation) {
      const sampleIndex = i / 4;
      const sampleX = sampleIndex % sampleW;
      const sampleY = Math.floor(sampleIndex / sampleW);
      const rotatedX = sx + (sampleX + 0.5) * sw / sampleW;
      const rotatedY = sy + (sampleY + 0.5) * sh / sampleH;
      const unrotated = inverseRotatePoint(
        rotatedX,
        rotatedY,
        sourceW / 2,
        sourceH / 2,
        rotationDegrees,
      );
      if (unrotated.x < 0 || unrotated.x >= sourceW || unrotated.y < 0 || unrotated.y >= sourceH) {
        const grayDisplay = histogramDisplayValue(srgbChannelToLinear(128));
        addHistogramInterval(r, grayDisplay, grayDisplay, areaWeight);
        addHistogramInterval(g, grayDisplay, grayDisplay, areaWeight);
        addHistogramInterval(b, grayDisplay, grayDisplay, areaWeight);
        addHistogramInterval(luma, grayDisplay, grayDisplay, areaWeight);
        continue;
      }
    }

    // The source is normally 8-bit sRGB, so each code represents a finite quantization
    // cell rather than one exact linear-light value. Transform the eight corners of that
    // RGB cell through the same linear-light edit pipeline as the image, then distribute
    // the represented image area over the output histogram interval. This preserves area
    // while avoiding comb-like gaps after changing from the sRGB transfer curve to the
    // pure-gamma 2.4 display axis.
    const rLinear = [
      srgbChannelToLinear(Math.max(0, rc - 0.5)),
      srgbChannelToLinear(Math.min(255, rc + 0.5)),
    ];
    const gLinear = [
      srgbChannelToLinear(Math.max(0, gc - 0.5)),
      srgbChannelToLinear(Math.min(255, gc + 0.5)),
    ];
    const bLinear = [
      srgbChannelToLinear(Math.max(0, bc - 0.5)),
      srgbChannelToLinear(Math.min(255, bc + 0.5)),
    ];

    let minR = 1;
    let maxR = 0;
    let minG = 1;
    let maxG = 0;
    let minB = 1;
    let maxB = 0;
    let minY = 1;
    let maxY = 0;
    for (let corner = 0; corner < 8; corner++) {
      let rr = rLinear[corner & 1];
      let gg = gLinear[(corner >> 1) & 1];
      let bb = bLinear[(corner >> 2) & 1];
      [rr, gg, bb] = applyColorAdjustmentsLinearRgb(rr, gg, bb, adjustment);
      const yy = clamp01(0.2126 * rr + 0.7152 * gg + 0.0722 * bb);
      const dr = histogramDisplayValue(rr);
      const dg = histogramDisplayValue(gg);
      const db = histogramDisplayValue(bb);
      const dy = histogramDisplayValue(yy);
      minR = Math.min(minR, dr);
      maxR = Math.max(maxR, dr);
      minG = Math.min(minG, dg);
      maxG = Math.max(maxG, dg);
      minB = Math.min(minB, db);
      maxB = Math.max(maxB, db);
      minY = Math.min(minY, dy);
      maxY = Math.max(maxY, dy);
    }

    addHistogramInterval(r, minR, maxR, areaWeight);
    addHistogramInterval(g, minG, maxG, areaWeight);
    addHistogramInterval(b, minB, maxB, areaWeight);
    addHistogramInterval(luma, minY, maxY, areaWeight);
  }

  let maxCount = 0;
  for (let i = 0; i < HISTOGRAM_BINS; i++) {
    maxCount = Math.max(maxCount, r[i] ?? 0, g[i] ?? 0, b[i] ?? 0, luma[i] ?? 0);
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
  const [rotationDegrees, setRotationDegrees] = useState<number>(
    normalizeRotationDegrees(initialParams.rotationDegrees ?? 0),
  );
  const [rotationMode, setRotationMode] = useState(false);
  const rotationDragState = useRef<
    | null
    | { pointerId: number; startAngle: number; startRotation: number }
  >(null);
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
  const [textMode, setTextMode] = useState(false);
  const [textOverlays, setTextOverlays] = useState<ImageTextOverlay[]>(
    normalizeTextOverlays(initialParams.textOverlays),
  );
  const [activeTextId, setActiveTextId] = useState<string | null>(null);
  const [mosaicMode, setMosaicMode] = useState(false);
  const [mosaicRegions, setMosaicRegions] = useState<ImageMosaicRegion[]>(
    normalizeMosaicRegions(initialParams.mosaicRegions),
  );
  const [mosaicDraft, setMosaicDraft] = useState<EditRect | null>(null);
  const mosaicDragStart = useRef<EditPoint | null>(null);
  const mosaicMoveState = useRef<
    | null
    | { pointerId: number; index: number; startPoint: EditPoint; startRegion: ImageMosaicRegion }
  >(null);
  const [showHistogram, setShowHistogram] = useState(false);
  const [histogram, setHistogram] = useState<HistogramData | null>(null);
  const [eyedropperMode, setEyedropperMode] = useState(false);
  const [autoToneBusy, setAutoToneBusy] = useState(false);
  const activeTextBoxRef = useRef<HTMLDivElement | null>(null);
  const textMoveState = useRef<
    | null
    | { pointerId: number; id: string; offsetX: number; offsetY: number }
  >(null);
  const dragState = useRef<
    | null
    | { mode: "move"; startP: EditPoint; startCrop: EditRect }
    | { mode: "resize"; corner: EditCorner; startP: EditPoint; startCrop: EditRect }
  >(null);

  const sliderDefaults = useMemo(
    () => normalizeEditParams(
      defaultParams ?? buildDefaultEditParams(natural?.w, natural?.h),
      natural?.w,
      natural?.h,
    ),
    [defaultParams, natural],
  );

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

  const previewToSourceTextPoint = useCallback((point: EditPoint): { left: number; top: number } | null => {
    if (displayed.w <= 0 || displayed.h <= 0) return null;
    const local = {
      x: point.x - displayed.x,
      y: point.y - displayed.y,
    };
    const unrotated = inverseRotatePoint(
      local.x,
      local.y,
      displayed.w / 2,
      displayed.h / 2,
      rotationDegrees,
    );
    return {
      left: clamp01(unrotated.x / displayed.w),
      top: clamp01(unrotated.y / displayed.h),
    };
  }, [displayed, rotationDegrees]);

  const sourceToPreviewTextPoint = useCallback((overlay: ImageTextOverlay): EditPoint | null => {
    if (!natural || displayed.w <= 0 || displayed.h <= 0) return null;
    const local = rotatePoint(
      overlay.left * displayed.w,
      overlay.top * displayed.h,
      displayed.w / 2,
      displayed.h / 2,
      rotationDegrees,
    );
    return {
      x: displayed.x + local.x,
      y: displayed.y + local.y,
    };
  }, [displayed, natural, rotationDegrees]);

  const previewTextLayouts = useMemo<TextOverlayLayout[]>(() => {
    if (!natural || displayed.w <= 0 || displayed.h <= 0) return [];
    const previewScale = displayed.w / natural.w;
    return textOverlays.map((overlay) => {
      const point = sourceToPreviewTextPoint(overlay) ?? { x: displayed.x, y: displayed.y };
      const fontSize = Math.max(1, overlay.fontSize * previewScale);
      const { width, height, lineHeight } = measureTextOverlayLayout(overlay.text, fontSize);
      return {
        id: overlay.id,
        x: point.x,
        y: point.y,
        width,
        height,
        fontSize,
        lineHeight,
        text: overlay.text,
        colorIndex: overlay.colorIndex,
        outlineColorIndex: overlay.outlineColorIndex,
      };
    });
  }, [natural, displayed, textOverlays, sourceToPreviewTextPoint]);

  const updateTextOverlay = useCallback((id: string, updater: (overlay: ImageTextOverlay) => ImageTextOverlay) => {
    setTextOverlays((current) => current.map((overlay) => (overlay.id === id ? normalizeTextOverlay(updater(overlay)) : overlay)));
  }, []);

  const removeTextOverlay = useCallback((id: string) => {
    setTextOverlays((current) => current.filter((overlay) => overlay.id !== id));
    setActiveTextId((current) => (current === id ? null : current));
  }, []);

  const finishTextOverlayEditing = useCallback((id: string) => {
    setTextOverlays((current) => current.filter((overlay) => overlay.id !== id || overlay.text.length > 0));
    setActiveTextId((current) => (current === id ? null : current));
  }, []);

  const onTextOverlayBlur = useCallback((id: string) => {
    window.setTimeout(() => {
      const root = activeTextBoxRef.current;
      const focused = document.activeElement;
      if (root && focused instanceof Node && root.contains(focused)) return;
      finishTextOverlayEditing(id);
    }, 0);
  }, [finishTextOverlayEditing]);

  const onTextMovePointerDown = useCallback((id: string, layout: TextOverlayLayout) =>
    (e: React.PointerEvent<HTMLButtonElement>) => {
      if (!textMode || e.button !== 0) return;
      const point = toLocal(e);
      textMoveState.current = {
        pointerId: e.pointerId,
        id,
        offsetX: point.x - layout.x,
        offsetY: point.y - layout.y,
      };
      e.currentTarget.setPointerCapture(e.pointerId);
      e.preventDefault();
      e.stopPropagation();
    }, [textMode, toLocal]);

  const onTextMovePointerMove = useCallback((e: React.PointerEvent<HTMLButtonElement>) => {
    const state = textMoveState.current;
    if (!state || state.pointerId !== e.pointerId) return;
    const point = toLocal(e);
    const sourcePoint = previewToSourceTextPoint({
      x: point.x - state.offsetX,
      y: point.y - state.offsetY,
    });
    if (!sourcePoint) return;
    updateTextOverlay(state.id, (current) => ({
      ...current,
      left: sourcePoint.left,
      top: sourcePoint.top,
    }));
    e.preventDefault();
    e.stopPropagation();
  }, [previewToSourceTextPoint, toLocal, updateTextOverlay]);

  const onTextMovePointerUp = useCallback((e: React.PointerEvent<HTMLButtonElement>) => {
    const state = textMoveState.current;
    if (!state || state.pointerId !== e.pointerId) return;
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {}
    textMoveState.current = null;
    e.preventDefault();
    e.stopPropagation();
  }, []);

  const onTextPointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!textMode || e.button !== 0 || e.ctrlKey || displayed.w <= 0 || displayed.h <= 0) return;
    const point = toLocal(e);
    if (
      point.x < displayed.x ||
      point.x > displayed.x + displayed.w ||
      point.y < displayed.y ||
      point.y > displayed.y + displayed.h
    ) {
      return;
    }
    e.preventDefault();
    e.stopPropagation();
    const sourcePoint = previewToSourceTextPoint(point);
    if (!sourcePoint || !natural) return;
    const overlay = normalizeTextOverlay({
      id: makeOverlayId("text"),
      left: sourcePoint.left,
      top: sourcePoint.top,
      text: "",
      fontSize: Math.round(Math.hypot(natural.w, natural.h) * TEXT_OVERLAY_DEFAULT_FONT_SIZE_RATIO),
      colorIndex: 0,
      outlineColorIndex: null,
    });
    setTextOverlays((current) => [...current, overlay]);
    setActiveTextId(overlay.id);
  }, [displayed, natural, previewToSourceTextPoint, textMode, toLocal]);

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
    for (let index = mosaicRegions.length - 1; index >= 0; index--) {
      const region = mosaicRegions[index];
      const left = displayed.x + region.left * displayed.w;
      const top = displayed.y + region.top * displayed.h;
      const width = (region.right - region.left) * displayed.w;
      const height = (region.bottom - region.top) * displayed.h;
      if (
        point.x >= left &&
        point.x <= left + width &&
        point.y >= top &&
        point.y <= top + height
      ) {
        mosaicMoveState.current = {
          pointerId: e.pointerId,
          index,
          startPoint: point,
          startRegion: region,
        };
        setMosaicDraft({ x: left, y: top, w: width, h: height });
        e.preventDefault();
        return;
      }
    }
    const start = clampPointToDisplayed(point);
    mosaicDragStart.current = start;
    setMosaicDraft({ x: start.x, y: start.y, w: 0, h: 0 });
    e.preventDefault();
  }, [clampPointToDisplayed, displayed, mosaicMode, mosaicRegions, toLocal]);

  const onMosaicPointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    const moveState = mosaicMoveState.current;
    if (moveState) {
      const point = toLocal(e);
      const dx = point.x - moveState.startPoint.x;
      const dy = point.y - moveState.startPoint.y;
      const regionWidth = (moveState.startRegion.right - moveState.startRegion.left) * displayed.w;
      const regionHeight = (moveState.startRegion.bottom - moveState.startRegion.top) * displayed.h;
      const startLeft = displayed.x + moveState.startRegion.left * displayed.w;
      const startTop = displayed.y + moveState.startRegion.top * displayed.h;
      const nextLeft = Math.max(displayed.x, Math.min(displayed.x + displayed.w - regionWidth, startLeft + dx));
      const nextTop = Math.max(displayed.y, Math.min(displayed.y + displayed.h - regionHeight, startTop + dy));
      setMosaicDraft({ x: nextLeft, y: nextTop, w: regionWidth, h: regionHeight });
      return;
    }
    const start = mosaicDragStart.current;
    if (!start) return;
    const point = clampPointToDisplayed(toLocal(e));
    setMosaicDraft({
      x: Math.min(start.x, point.x),
      y: Math.min(start.y, point.y),
      w: Math.abs(point.x - start.x),
      h: Math.abs(point.y - start.y),
    });
  }, [
    clampPointToDisplayed,
    displayed.h,
    displayed.w,
    displayed.x,
    displayed.y,
    toLocal,
  ]);

  const onMosaicPointerUp = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    const moveState = mosaicMoveState.current;
    if (moveState && displayed.w > 0 && displayed.h > 0) {
      try {
        e.currentTarget.releasePointerCapture(e.pointerId);
      } catch {}
      const point = toLocal(e);
      const dx = point.x - moveState.startPoint.x;
      const dy = point.y - moveState.startPoint.y;
      const regionWidth = (moveState.startRegion.right - moveState.startRegion.left) * displayed.w;
      const regionHeight = (moveState.startRegion.bottom - moveState.startRegion.top) * displayed.h;
      const startLeft = displayed.x + moveState.startRegion.left * displayed.w;
      const startTop = displayed.y + moveState.startRegion.top * displayed.h;
      const nextLeft = Math.max(displayed.x, Math.min(displayed.x + displayed.w - regionWidth, startLeft + dx));
      const nextTop = Math.max(displayed.y, Math.min(displayed.y + displayed.h - regionHeight, startTop + dy));
      const updated = normalizeMosaicRegion({
        left: (nextLeft - displayed.x) / displayed.w,
        top: (nextTop - displayed.y) / displayed.h,
        right: (nextLeft + regionWidth - displayed.x) / displayed.w,
        bottom: (nextTop + regionHeight - displayed.y) / displayed.h,
      });
      mosaicMoveState.current = null;
      setMosaicDraft(null);
      if (updated) {
        setMosaicRegions((current) => current.map((region, index) => (index === moveState.index ? updated : region)));
      }
      return;
    }
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
    mosaicMoveState.current = null;
    setMosaicDraft(null);
  }, []);

  const removeMosaicRegion = useCallback((index: number) => {
    setMosaicRegions((current) => current.filter((_, i) => i !== index));
  }, []);

  const onEyedropperPointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!eyedropperMode || e.button !== 0 || e.ctrlKey || !natural || displayed.w <= 0 || displayed.h <= 0) return;
    const img = previewImageRef.current;
    const container = containerRef.current;
    if (!img || !container) return;

    const rect = container.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const resizedWidth = Math.max(1, Math.round(displayed.w));
    const resizedHeight = Math.max(1, Math.round(displayed.h));
    const rotatedX = (x - displayed.x) / displayed.w * resizedWidth;
    const rotatedY = (y - displayed.y) / displayed.h * resizedHeight;
    const unrotated = inverseRotatePoint(
      rotatedX,
      rotatedY,
      resizedWidth / 2,
      resizedHeight / 2,
      rotationDegrees,
    );
    if (
      unrotated.x < 0 ||
      unrotated.x >= resizedWidth ||
      unrotated.y < 0 ||
      unrotated.y >= resizedHeight
    ) {
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    const px = Math.min(resizedWidth - 1, Math.max(0, Math.floor(unrotated.x)));
    const py = Math.min(resizedHeight - 1, Math.max(0, Math.floor(unrotated.y)));

    // Sample the bicubic-resized preview rather than one raw source pixel. The
    // clicked pixel has weight 1.0, orthogonal neighbors 0.8, and diagonals 0.5.
    const rgb = sampleEyedropperRgb8(
      img,
      natural.w,
      natural.h,
      resizedWidth,
      resizedHeight,
      px,
      py,
    );
    if (rgb) {
      const wb = neutralWhiteBalanceForRgb8(rgb[0], rgb[1], rgb[2]);
      setTemperature(wb.temperature);
      setTint(wb.tint);
    }
    e.preventDefault();
    e.stopPropagation();
  }, [displayed, eyedropperMode, natural, rotationDegrees]);

  const onRotationHandlePointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!rotationMode || displayed.w <= 0 || displayed.h <= 0) return;
    const point = toLocal(e);
    const centerX = displayed.x + displayed.w / 2;
    const centerY = displayed.y + displayed.h / 2;
    const startAngle = Math.atan2(point.y - centerY, point.x - centerX) * 180 / Math.PI;
    e.currentTarget.setPointerCapture(e.pointerId);
    rotationDragState.current = {
      pointerId: e.pointerId,
      startAngle,
      startRotation: rotationDegrees,
    };
    e.preventDefault();
    e.stopPropagation();
  }, [displayed, rotationDegrees, rotationMode, toLocal]);

  const onRotationPointerMove = useCallback((e: React.PointerEvent) => {
    const drag = rotationDragState.current;
    if (!drag || drag.pointerId !== e.pointerId || displayed.w <= 0 || displayed.h <= 0) return;
    const point = toLocal(e);
    const centerX = displayed.x + displayed.w / 2;
    const centerY = displayed.y + displayed.h / 2;
    const currentAngle = Math.atan2(point.y - centerY, point.x - centerX) * 180 / Math.PI;
    const delta = normalizeRotationDegrees(currentAngle - drag.startAngle);
    setRotationDegrees(normalizeRotationDegrees(drag.startRotation + delta));
    e.preventDefault();
  }, [displayed, toLocal]);

  const onRotationPointerUp = useCallback((e: React.PointerEvent) => {
    const drag = rotationDragState.current;
    if (!drag || drag.pointerId !== e.pointerId) return;
    try {
      (e.target as Element).releasePointerCapture?.(e.pointerId);
    } catch {}
    rotationDragState.current = null;
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
    const hasRotation = Math.abs(normalizeRotationDegrees(rotationDegrees)) > 1e-9;
    if (hasRotation) {
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = "high";
      drawRotatedSourceToContext(ctx, img, width, height, 0, 0, 1, 1, rotationDegrees);
    } else {
      ctx.drawImage(img, 0, 0, width, height);
    }
    applyColorAdjustmentsToCanvas(
      canvas,
      temperature,
      tint,
      exposureEv,
      scaledLog,
      sigmoid,
      vibrance,
      saturation,
      hasRotation,
    );
    if (hasRotation) {
      fillRotationPadding(ctx, width, height, width, height, 0, 0, 1, 1, rotationDegrees);
    }
    if (!eyedropperMode && !rotationMode && mosaicRegions.length && natural?.w) {
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
    rotationDegrees,
    rotationMode,
    natural,
    mosaicRegions,
    eyedropperMode,
  ]);

  useEffect(() => {
    if (!showHistogram || eyedropperMode) {
      setHistogram(null);
      return;
    }
    const img = previewImageRef.current;
    if (
      !img ||
      !natural ||
      !displayed.w ||
      !displayed.h ||
      !cropRect.w ||
      !cropRect.h
    ) {
      setHistogram(null);
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
    const ex = Math.max(
      sx + 1,
      Math.min(natural.w, Math.round(natural.w * (1 - crop.right))),
    );
    const ey = Math.max(
      sy + 1,
      Math.min(natural.h, Math.round(natural.h * (1 - crop.bottom))),
    );
    setHistogram(
      computeHistogramData(
        img,
        { x: sx, y: sy, w: ex - sx, h: ey - sy },
        rotationDegrees,
        temperature,
        tint,
        exposureEv,
        scaledLog,
        sigmoid,
        vibrance,
        saturation,
      ),
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
    rotationDegrees,
    natural,
    eyedropperMode,
  ]);

  const currentToneAutoSample = useCallback((): ToneAutoSample | null => {
    const img = previewImageRef.current;
    if (
      !img ||
      !natural ||
      !displayed.w ||
      !displayed.h ||
      !cropRect.w ||
      !cropRect.h
    ) {
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
    const ex = Math.max(
      sx + 1,
      Math.min(natural.w, Math.round(natural.w * (1 - crop.right))),
    );
    const ey = Math.max(
      sy + 1,
      Math.min(natural.h, Math.round(natural.h * (1 - crop.bottom))),
    );
    return createToneAutoSample(
      img,
      { x: sx, y: sy, w: ex - sx, h: ey - sy },
      rotationDegrees,
    );
  }, [
    natural,
    displayed.x,
    displayed.y,
    displayed.w,
    displayed.h,
    cropRect.x,
    cropRect.y,
    cropRect.w,
    cropRect.h,
    rotationDegrees,
  ]);

  const runAutoToneTask = useCallback(async (task: () => void) => {
    setAutoToneBusy(true);
    await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    try {
      task();
    } finally {
      setAutoToneBusy(false);
    }
  }, []);

  const onAutoExposure = useCallback(() => {
    if (autoToneBusy) return;
    void runAutoToneTask(() => {
      const sample = currentToneAutoSample();
      if (!sample) return;
      setExposureEv(findAutoExposure(sample, temperature, tint));
    });
  }, [autoToneBusy, currentToneAutoSample, runAutoToneTask, temperature, tint]);

  const onAutoLogarithm = useCallback(() => {
    if (autoToneBusy) return;
    void runAutoToneTask(() => {
      const sample = currentToneAutoSample();
      if (!sample) return;
      setScaledLog(findAutoLogarithm(sample, temperature, tint, exposureEv));
    });
  }, [autoToneBusy, currentToneAutoSample, exposureEv, runAutoToneTask, temperature, tint]);

  const onAutoSigmoid = useCallback(() => {
    if (autoToneBusy) return;
    void runAutoToneTask(() => {
      const sample = currentToneAutoSample();
      if (!sample) return;
      setSigmoid(findAutoSigmoid(sample, temperature, tint, exposureEv, scaledLog));
    });
  }, [autoToneBusy, currentToneAutoSample, exposureEv, runAutoToneTask, scaledLog, temperature, tint]);

  const onAutoTone = useCallback(() => {
    if (autoToneBusy) return;
    void runAutoToneTask(() => {
      const sample = currentToneAutoSample();
      if (!sample) return;
      const autoExposure = findAutoExposure(sample, temperature, tint);
      const autoLogarithm = findAutoLogarithm(sample, temperature, tint, autoExposure);
      const autoSigmoid = findAutoSigmoid(
        sample,
        temperature,
        tint,
        autoExposure,
        autoLogarithm,
      );
      setExposureEv(autoExposure);
      setScaledLog(autoLogarithm);
      setSigmoid(autoSigmoid);
    });
  }, [autoToneBusy, currentToneAutoSample, runAutoToneTask, temperature, tint]);

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
      rotationDegrees: normalizeRotationDegrees(rotationDegrees),
      temperature: clampWhiteBalanceValue(temperature),
      tint: clampWhiteBalanceValue(tint),
      exposureEv: clampExposureEv(exposureEv),
      scaledLog: clampScaledLog(scaledLog),
      sigmoid: clampSigmoid(sigmoid),
      vibrance: clampColorAdjustment(vibrance),
      saturation: clampColorAdjustment(saturation),
      resizePercent: Math.min(100, Math.max(1, Math.round(resizePercent))),
      mosaicRegions: normalizeMosaicRegions(mosaicRegions),
      textOverlays: normalizeTextOverlays(textOverlays),
    });
  }, [
    displayed.w,
    displayed.h,
    displayed.x,
    displayed.y,
    cropRect,
    rotationDegrees,
    temperature,
    tint,
    exposureEv,
    scaledLog,
    sigmoid,
    vibrance,
    saturation,
    resizePercent,
    mosaicRegions,
    textOverlays,
    onApply,
  ]);

  const onReset = useCallback(() => {
    const params = normalizeEditParams(
      defaultParams ?? buildDefaultEditParams(natural?.w, natural?.h),
      natural?.w,
      natural?.h,
    );
    setRotationDegrees(params.rotationDegrees);
    setRotationMode(false);
    rotationDragState.current = null;
    setTemperature(params.temperature);
    setTint(params.tint);
    setExposureEv(params.exposureEv);
    setScaledLog(params.scaledLog);
    setSigmoid(params.sigmoid);
    setVibrance(params.vibrance);
    setSaturation(params.saturation);
    setResizePercent(params.resizePercent);
    setTextMode(false);
    setActiveTextId(null);
    textMoveState.current = null;
    setTextOverlays(params.textOverlays);
    setMosaicRegions(params.mosaicRegions);
    mosaicMoveState.current = null;
    setMosaicDraft(null);
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
    <div
      className="fixed inset-0 z-[70] bg-black/70 flex items-center justify-center p-4"
      onClick={
        eyedropperMode
          ? () => setEyedropperMode(false)
          : rotationMode
            ? () => {
                setRotationMode(false);
                rotationDragState.current = null;
              }
            : onCancel
      }
      onContextMenuCapture={() => {
        if (eyedropperMode) setEyedropperMode(false);
      }}
    >
      <div
        className="bg-white rounded shadow max-w-[95vw] max-h-[95dvh] overflow-y-auto w-[min(1100px,95vw)] p-4"
        onClick={(e) => {
          e.stopPropagation();
          if (eyedropperMode) setEyedropperMode(false);
          if (rotationMode) {
            setRotationMode(false);
            rotationDragState.current = null;
          }
        }}
      >
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-base font-semibold break-all">Edit image</h2>
          <div className="flex items-center gap-3">
            <label className="inline-flex items-center gap-2 text-sm text-gray-700 select-none">
              <input
                type="checkbox"
                checked={textMode}
                onChange={(e) => {
                  const next = e.target.checked;
                  if (next) {
                    setTextMode(true);
                    setActiveTextId(null);
                    textMoveState.current = null;
                    setEyedropperMode(false);
                    setRotationMode(false);
                    rotationDragState.current = null;
                    setMosaicMode(false);
                    mosaicDragStart.current = null;
                    mosaicMoveState.current = null;
                    setMosaicDraft(null);
                    dragState.current = null;
                  } else {
                    setTextMode(false);
                    setActiveTextId(null);
                    textMoveState.current = null;
                  }
                }}
              />
              <span>Text</span>
            </label>
            <label className="inline-flex items-center gap-2 text-sm text-gray-700 select-none">
              <input
                type="checkbox"
                checked={mosaicMode}
                onChange={(e) => {
                  const next = e.target.checked;
                  setMosaicMode(next);
                  if (next) {
                    setTextMode(false);
                    setActiveTextId(null);
                    textMoveState.current = null;
                    setEyedropperMode(false);
                    setRotationMode(false);
                    rotationDragState.current = null;
                  }
                  mosaicDragStart.current = null;
                  mosaicMoveState.current = null;
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

        <div className="mt-3 grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_250px] gap-4 lg:items-stretch">
          <div
            ref={containerRef}
            className={`relative w-full h-[42vh] min-h-[270px] lg:h-auto rounded border bg-gray-200 overflow-hidden touch-none ${textMode ? "cursor-text" : !eyedropperMode && !rotationMode && mosaicMode ? "cursor-crosshair" : ""}`}
            onPointerDown={eyedropperMode || rotationMode ? undefined : textMode ? onTextPointerDown : mosaicMode ? onMosaicPointerDown : undefined}
            onPointerMove={eyedropperMode ? undefined : rotationMode ? onRotationPointerMove : mosaicMode ? onMosaicPointerMove : onPointerMove}
            onPointerUp={eyedropperMode ? undefined : rotationMode ? onRotationPointerUp : mosaicMode ? onMosaicPointerUp : onPointerUp}
            onPointerCancel={eyedropperMode ? undefined : rotationMode ? onRotationPointerUp : mosaicMode ? onMosaicPointerCancel : onPointerUp}
          >
              {imgUrl && natural ? (
                <>
                  {!eyedropperMode && showHistogram && histogramPaths && (
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
                  {autoToneBusy && (
                    <div className="absolute inset-0 z-40 flex items-center justify-center pointer-events-none">
                      <div className="h-10 w-10 rounded-full border-4 border-white/40 border-t-white animate-spin shadow-[0_0_0_1px_rgba(0,0,0,0.25)]" />
                    </div>
                  )}
                  {eyedropperMode && (
                    <div
                      className="absolute z-30 cursor-crosshair"
                      style={{
                        left: displayed.x,
                        top: displayed.y,
                        width: displayed.w,
                        height: displayed.h,
                      }}
                      onPointerDown={onEyedropperPointerDown}
                      onClick={(e) => e.stopPropagation()}
                      aria-label="Pick neutral white balance point"
                    />
                  )}
                  {!eyedropperMode && rotationMode && (
                    <div
                      className="absolute z-30"
                      style={{
                        left: displayed.x,
                        top: displayed.y,
                        width: displayed.w,
                        height: displayed.h,
                      }}
                      onPointerDown={(e) => e.stopPropagation()}
                      onClick={(e) => e.stopPropagation()}
                      aria-label="Rotate image"
                    >
                      {(["nw", "ne", "sw", "se"] as EditCorner[]).map((corner) => {
                        const style =
                          corner === "nw"
                            ? { left: -7, top: -7 }
                            : corner === "ne"
                              ? { right: -7, top: -7 }
                              : corner === "sw"
                                ? { left: -7, bottom: -7 }
                                : { right: -7, bottom: -7 };
                        return (
                          <div
                            key={corner}
                            className="absolute w-4 h-4 rounded-full bg-white border border-black shadow cursor-grab active:cursor-grabbing"
                            style={style}
                            onPointerDown={onRotationHandlePointerDown}
                            aria-label="Rotation handle"
                            title="Drag to rotate"
                          />
                        );
                      })}
                    </div>
                  )}
                  {!eyedropperMode && !rotationMode && !mosaicMode && !textMode && (
                    <svg className="absolute inset-0 w-full h-full pointer-events-none" aria-hidden="true">
                      <path d={`${overlayPath.outer} ${overlayPath.inner}`} fill="rgba(0,0,0,0.45)" fillRule="evenodd" />
                    </svg>
                  )}
                  {!eyedropperMode && showHistogram && histogramPaths && (
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
                  {!eyedropperMode && !rotationMode && previewTextLayouts.map((layout) => {
                    const overlay = textOverlays.find((item) => item.id === layout.id);
                    if (!overlay) return null;
                    const active = textMode && activeTextId === layout.id;
                    return (
                      <div
                        key={layout.id}
                        ref={active ? activeTextBoxRef : undefined}
                        className={`absolute z-30 ${textMode ? "pointer-events-auto" : "pointer-events-none"}`}
                        style={{
                          left: layout.x,
                          top: layout.y,
                          minWidth: layout.width,
                          minHeight: layout.height,
                        }}
                        onPointerDown={(e) => {
                          if (!textMode) return;
                          e.stopPropagation();
                        }}
                        onClick={(e) => {
                          if (!textMode) return;
                          e.stopPropagation();
                          setActiveTextId(layout.id);
                        }}
                      >
                        {active ? (
                          <>
                            <textarea
                              value={overlay.text}
                              autoFocus
                              wrap="off"
                              onChange={(e) => updateTextOverlay(layout.id, (current) => ({ ...current, text: e.target.value }))}
                              onBlur={() => onTextOverlayBlur(layout.id)}
                              className="block resize-none overflow-hidden rounded border border-black/40 bg-white/55 px-[6px] py-[4px] outline-none"
                              style={{
                                width: layout.width,
                                height: layout.height,
                                color: TEXT_OVERLAY_COLORS[layout.colorIndex],
                                WebkitTextFillColor: TEXT_OVERLAY_COLORS[layout.colorIndex],
                                fontSize: layout.fontSize,
                                lineHeight: `${TEXT_OVERLAY_LINE_HEIGHT}`,
                                fontFamily: TEXT_OVERLAY_FONT_FAMILY,
                                whiteSpace: "pre",
                                overflowWrap: "normal",
                                wordBreak: "normal",
                                ...textOverlayOutlineStyle(layout.fontSize, layout.outlineColorIndex),
                              }}
                            />
                            <div className="absolute -left-2.5 -top-2.5 flex items-center gap-1">
                              <button
                                type="button"
                                className="flex h-5 w-5 cursor-move items-center justify-center rounded-full border border-white bg-black/80 text-white"
                                onPointerDown={onTextMovePointerDown(layout.id, layout)}
                                onPointerMove={onTextMovePointerMove}
                                onPointerUp={onTextMovePointerUp}
                                onPointerCancel={onTextMovePointerUp}
                                aria-label="Move text overlay"
                                title="Drag to move text"
                              >
                                <Move size={12} strokeWidth={2} />
                              </button>
                              <button
                                type="button"
                                className="flex h-5 min-w-5 items-center justify-center rounded border border-white bg-black/80 px-1 text-[11px] leading-none text-white"
                                onMouseDown={(e) => e.preventDefault()}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  updateTextOverlay(layout.id, (current) => ({
                                    ...current,
                                    fontSize: Math.max(1, Math.round(current.fontSize / TEXT_OVERLAY_FONT_STEP)),
                                  }));
                                }}
                                aria-label="Decrease font size"
                              >
                                −
                              </button>
                              <button
                                type="button"
                                className="flex h-5 min-w-5 items-center justify-center rounded border border-white bg-black/80 px-1 text-[11px] leading-none text-white"
                                onMouseDown={(e) => e.preventDefault()}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  updateTextOverlay(layout.id, (current) => ({
                                    ...current,
                                    fontSize: Math.max(1, Math.round(current.fontSize * TEXT_OVERLAY_FONT_STEP)),
                                  }));
                                }}
                                aria-label="Increase font size"
                              >
                                ＋
                              </button>
                              <button
                                type="button"
                                className="flex h-5 min-w-5 items-center justify-center rounded border border-white bg-black/80 px-1 text-white"
                                onMouseDown={(e) => e.preventDefault()}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  updateTextOverlay(layout.id, (current) => ({
                                    ...current,
                                    colorIndex: (current.colorIndex + 1) % TEXT_OVERLAY_COLORS.length,
                                  }));
                                }}
                                aria-label="Change text color"
                                title="Change text color"
                              >
                                <Palette size={13} strokeWidth={1.8} />
                              </button>
                              <button
                                type="button"
                                className="flex h-5 min-w-5 items-center justify-center rounded border border-white bg-black/80 px-1 text-white"
                                onMouseDown={(e) => e.preventDefault()}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  updateTextOverlay(layout.id, (current) => ({
                                    ...current,
                                    outlineColorIndex: nextOutlineColorIndex(current.outlineColorIndex),
                                  }));
                                }}
                                aria-label="Change text outline color"
                                title="Change text outline color"
                              >
                                <span
                                  aria-hidden="true"
                                  className="text-[11px] font-bold leading-none"
                                  style={{ color: "transparent", WebkitTextStroke: "1px #ffffff" }}
                                >
                                  A
                                </span>
                              </button>
                            </div>
                            <button
                              type="button"
                              className="absolute -right-2.5 -top-2.5 flex h-5 w-5 items-center justify-center rounded-full border border-white bg-black/80 text-[12px] leading-none text-white"
                              onMouseDown={(e) => e.preventDefault()}
                              onClick={(e) => {
                                e.stopPropagation();
                                removeTextOverlay(layout.id);
                              }}
                              aria-label="Remove text overlay"
                            >
                              ✕
                            </button>
                          </>
                        ) : (
                          <div
                            className={textMode ? "cursor-text" : ""}
                            style={{
                              color: TEXT_OVERLAY_COLORS[layout.colorIndex],
                              WebkitTextFillColor: TEXT_OVERLAY_COLORS[layout.colorIndex],
                              fontSize: layout.fontSize,
                              lineHeight: `${TEXT_OVERLAY_LINE_HEIGHT}`,
                              fontFamily: TEXT_OVERLAY_FONT_FAMILY,
                              whiteSpace: "pre",
                              ...textOverlayOutlineStyle(layout.fontSize, layout.outlineColorIndex),
                            }}
                          >
                            {layout.text}
                          </div>
                        )}
                      </div>
                    );
                  })}
                  {!eyedropperMode && !rotationMode && mosaicMode && mosaicRegions.map((region, index) => (
                    <div
                      key={index}
                      className="absolute border-2 border-dashed border-white shadow-[0_0_0_1px_rgba(0,0,0,0.65)]"
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
                  {!eyedropperMode && !rotationMode && mosaicMode && mosaicDraft && (
                    <div
                      className="absolute border-2 border-dashed border-white bg-black/10 shadow-[0_0_0_1px_rgba(0,0,0,0.65)] pointer-events-none"
                      style={{ left: mosaicDraft.x, top: mosaicDraft.y, width: mosaicDraft.w, height: mosaicDraft.h }}
                    />
                  )}
                  {!eyedropperMode && !rotationMode && !mosaicMode && !textMode && (
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
                  <button
                    type="button"
                    className={`inline-flex h-5 w-5 shrink-0 items-center justify-center rounded border ${
                      rotationMode
                        ? "border-blue-500 bg-blue-50 text-blue-700"
                        : "border-gray-300 bg-white text-gray-700 hover:bg-gray-100"
                    }`}
                    onClick={(e) => {
                      e.stopPropagation();
                      setTextMode(false);
                      setActiveTextId(null);
                      textMoveState.current = null;
                      setRotationMode((current) => !current);
                      setEyedropperMode(false);
                      rotationDragState.current = null;
                      mosaicDragStart.current = null;
                      mosaicMoveState.current = null;
                      setMosaicDraft(null);
                      dragState.current = null;
                    }}
                    aria-label="Rotate image"
                    aria-pressed={rotationMode}
                    title="Rotate image"
                  >
                    <RotateCw size={13} strokeWidth={1.8} />
                  </button>
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
              <div className="flex items-center gap-1 font-medium">
                <span>White balance</span>
                <button
                  type="button"
                  className={`inline-flex h-5 w-5 items-center justify-center rounded border ${
                    eyedropperMode
                      ? "border-blue-500 bg-blue-50 text-blue-700"
                      : "border-gray-300 bg-white text-gray-700 hover:bg-gray-100"
                  }`}
                  onClick={() => {
                    setTextMode(false);
                    setActiveTextId(null);
                    textMoveState.current = null;
                    setEyedropperMode((current) => !current);
                    setRotationMode(false);
                    rotationDragState.current = null;
                    mosaicDragStart.current = null;
                    mosaicMoveState.current = null;
                    setMosaicDraft(null);
                    dragState.current = null;
                  }}
                  aria-label="White balance eyedropper"
                  aria-pressed={eyedropperMode}
                  title="White balance eyedropper"
                >
                  <Pipette size={13} strokeWidth={1.8} />
                </button>
              </div>
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
                  onDoubleClick={() => setTemperature(sliderDefaults.temperature)}
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
                  onDoubleClick={() => setTint(sliderDefaults.tint)}
                  className="col-start-2 row-start-1 lg:col-span-2 lg:col-start-1 lg:row-start-2 w-full"
                />
              </label>
            </div>

            <div className="rounded border p-3 space-y-2 lg:space-y-3">
              <div className="flex items-center gap-2 font-medium">
                <span>Tone</span>
                <button
                  type="button"
                  className="h-5 rounded border border-gray-300 bg-white px-1.5 text-[10px] font-normal text-gray-700 hover:bg-gray-100 disabled:cursor-default disabled:opacity-60"
                  onClick={onAutoTone}
                  disabled={autoToneBusy}
                  title="Auto tone: Exposure, Logarithm, then Sigmoid"
                >
                  Auto
                </button>
              </div>
              <div className="grid grid-cols-[112px_minmax(0,1fr)_56px] lg:grid-cols-2 items-center gap-x-2 gap-y-1">
                <div className="col-start-1 row-start-1 flex min-w-0 items-center gap-1">
                  <span>Exposure</span>
                  <button
                    type="button"
                    className="h-5 rounded border border-gray-300 bg-white px-1 text-[10px] text-gray-700 hover:bg-gray-100 disabled:cursor-default disabled:opacity-60"
                    onClick={onAutoExposure}
                    disabled={autoToneBusy}
                    title="Auto exposure"
                  >
                    Auto
                  </button>
                </div>
                <span className="col-start-3 row-start-1 w-14 text-right lg:w-auto lg:col-start-2 justify-self-end font-mono text-[12px]">{formatSignedEv(exposureEv)}</span>
                <input
                  aria-label="Exposure"
                  type="range"
                  min={-5}
                  max={5}
                  step={0.1}
                  value={exposureEv}
                  onChange={(e) => setExposureEv(clampExposureEv(Number(e.target.value)))}
                  onDoubleClick={() => setExposureEv(sliderDefaults.exposureEv)}
                  className="col-start-2 row-start-1 lg:col-span-2 lg:col-start-1 lg:row-start-2 w-full"
                />
              </div>
              <div className="grid grid-cols-[112px_minmax(0,1fr)_56px] lg:grid-cols-2 items-center gap-x-2 gap-y-1">
                <div className="col-start-1 row-start-1 flex min-w-0 items-center gap-1">
                  <span>Logarithm</span>
                  <button
                    type="button"
                    className="h-5 rounded border border-gray-300 bg-white px-1 text-[10px] text-gray-700 hover:bg-gray-100 disabled:cursor-default disabled:opacity-60"
                    onClick={onAutoLogarithm}
                    disabled={autoToneBusy}
                    title="Auto logarithm"
                  >
                    Auto
                  </button>
                </div>
                <span className="col-start-3 row-start-1 w-14 text-right lg:w-auto lg:col-start-2 justify-self-end font-mono text-[12px]">{scaledLog >= 0 ? "+" : ""}{scaledLog.toFixed(1)}</span>
                <input
                  aria-label="Logarithm"
                  type="range"
                  min={-16}
                  max={16}
                  step={0.1}
                  value={scaledLog}
                  onChange={(e) => setScaledLog(clampScaledLog(Number(e.target.value)))}
                  onDoubleClick={() => setScaledLog(sliderDefaults.scaledLog)}
                  className="col-start-2 row-start-1 lg:col-span-2 lg:col-start-1 lg:row-start-2 w-full"
                />
              </div>
              <div className="grid grid-cols-[112px_minmax(0,1fr)_56px] lg:grid-cols-2 items-center gap-x-2 gap-y-1">
                <div className="col-start-1 row-start-1 flex min-w-0 items-center gap-1">
                  <span>Sigmoid</span>
                  <button
                    type="button"
                    className="h-5 rounded border border-gray-300 bg-white px-1 text-[10px] text-gray-700 hover:bg-gray-100 disabled:cursor-default disabled:opacity-60"
                    onClick={onAutoSigmoid}
                    disabled={autoToneBusy}
                    title="Auto sigmoid"
                  >
                    Auto
                  </button>
                </div>
                <span className="col-start-3 row-start-1 w-14 text-right lg:w-auto lg:col-start-2 justify-self-end font-mono text-[12px]">{sigmoid >= 0 ? "+" : ""}{sigmoid.toFixed(1)}</span>
                <input
                  aria-label="Sigmoid"
                  type="range"
                  min={-10}
                  max={10}
                  step={0.1}
                  value={sigmoid}
                  onChange={(e) => setSigmoid(clampSigmoid(Number(e.target.value)))}
                  onDoubleClick={() => setSigmoid(sliderDefaults.sigmoid)}
                  className="col-start-2 row-start-1 lg:col-span-2 lg:col-start-1 lg:row-start-2 w-full"
                />
              </div>
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
                  onDoubleClick={() => setVibrance(sliderDefaults.vibrance)}
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
                  onDoubleClick={() => setSaturation(sliderDefaults.saturation)}
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
                  onDoubleClick={() => setResizePercent(sliderDefaults.resizePercent)}
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
