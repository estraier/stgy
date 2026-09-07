"use client";

import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import NextImage from "next/image";
import { createPortal } from "react-dom";
import { Move, Palette, Pipette, RotateCw } from "lucide-react";
import { formatBytes } from "@/utils/format";
import {
  buildRawLensfunCorrection,
  lensfunVignettingGain,
  summarizeLensfunCorrection,
  type LensfunCorrection,
  type RawLensMetadata,
} from "@/utils/lensfunCorrection";
import { Config } from "@/config";
import {
  presignImageUpload,
  uploadToPresigned,
  finalizeImage,
  getImagesMonthlyQuota,
  checkImageExistenceDirectly,
} from "@/api/media";
import type {
  DecodedImage,
  DecodedRgbImage16,
  EditPoint,
  HistogramData,
  ImageEditOutputColorProfile,
  ImageInputColorProfile,
  LinearRgbSample,
  RawDevelopmentHeadroomStatistics,
  RawDevelopmentLensfunSettings,
  RawDevelopmentLuminanceSettings,
  RawDevelopmentSaturationSettings,
  RawDevelopmentSettings,
  ToneAutoSample,
} from "./image-editor/types";
export type { DecodedImage, ImageEditOutputColorProfile } from "./image-editor/types";
import {
  HISTOGRAM_DISPLAY_GAMMA,
  applyColorAdjustmentsLinearRgb,
  applyRolloffScalar,
  applyScaledLogLinear,
  applyWhiteBalanceLinear,
  clamp01,
  clampColorAdjustment,
  clampExposureEv,
  clampSharpen,
  clampSigmoid,
  clampScaledLog,
  clampToneRangeAdjustment,
  clampWhiteBalanceValue,
  colorSaturationFactor,
  colorVibranceFactor,
  hsvToRgb,
  linearChannelToSrgb,
  naiveInverseSigmoid,
  naiveSigmoid,
  rgbToHsv,
  rolloffParams,
  srgbChannelToLinear,
  whiteBalanceGains,
  type ColorAdjustmentContext,
} from "./image-editor/tone";
import {
  PROPHOTO_LUMA_B,
  PROPHOTO_LUMA_G,
  PROPHOTO_LUMA_R,
  convertLinearProPhotoToOutputRgb,
  encodedRgbToLinearProphoto,
} from "./image-editor/color";
import { getCanvas2dContext, getCanvasImageData } from "./image-editor/canvas";
import {
  decodeStoredRgb16Channel,
  encodeStoredRgb16Channel,
  getAnalysisLinearRgbSample,
  getRenderedLinearRgbSample,
  inverseRotatePoint,
  normalizeRotationDegrees,
} from "./image-editor/sampling";
import {
  buildColorAdjustmentContextFromLinearRgbSample,
  colorAdjustmentContextFromLinearRgbSample,
  computeHistogramDataFromRgb16,
  createToneAutoSampleFromRgb16,
  findAutoExposure,
  findAutoLogarithm,
  findAutoShadow,
  findAutoSigmoid,
  percentileFromValues,
  percentilesFromValues,
} from "./image-editor/analysis";
import { renderAdjustedLinearRgbSampleToCanvas, renderAdjustedRgb16ToCanvas } from "./image-editor/render";
export { __imageEditorCharacterization } from "./image-editor/characterization";


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
  fontIndex: number;
  colorIndex: number;
  outlineColorIndex: number | null;
};

export type ImageDrawTool = "line" | "rect" | "ellipse";

export type ImageDrawOverlay = {
  id: string;
  type: ImageDrawTool;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  strokeWidth: number;
  colorIndex: number;
};

export type ImageEditParams = {
  crop: ImageCropInsets;
  rotationDegrees: number;
  temperature: number;
  tint: number;
  exposureEv: number;
  shadow: number;
  highlight: number;
  scaledLog: number;
  sigmoid: number;
  vibrance: number;
  saturation: number;
  resizePercent: number;
  sharpen: number;
  mosaicRegions: ImageMosaicRegion[];
  textOverlays: ImageTextOverlay[];
  drawOverlays: ImageDrawOverlay[];
};

export type ImageEditOutputFormat = "image/webp" | "image/jpeg" | "image/png";
export type RawDemosaicQuality = 0 | 1 | 2 | 3 | 4 | 11 | 12;
export type RawHighlightMode = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;

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

function isHeif(name: string, type: string) {
  const t = (type || "").toLowerCase();
  if (t === "image/heic" || t === "image/heif") return true;
  const ext = (name.split(".").pop() || "").toLowerCase();
  return ext === "heic" || ext === "heif";
}

const RAW_IMAGE_EXTS = new Set([
  "3fr",
  "ari",
  "arw",
  "bay",
  "cap",
  "cr2",
  "cr3",
  "crw",
  "dcr",
  "dcs",
  "dng",
  "drf",
  "eip",
  "erf",
  "fff",
  "gpr",
  "iiq",
  "k25",
  "kdc",
  "mdc",
  "mef",
  "mos",
  "mrw",
  "nef",
  "nrw",
  "obm",
  "orf",
  "pef",
  "ptx",
  "pxn",
  "raf",
  "raw",
  "rwl",
  "rw2",
  "rwz",
  "sr2",
  "srf",
  "srw",
  "x3f",
]);

const RAW_IMAGE_MIMES = new Set([
  "image/x-adobe-dng",
  "image/x-canon-cr2",
  "image/x-canon-cr3",
  "image/x-epson-erf",
  "image/x-fuji-raf",
  "image/x-kodak-dcr",
  "image/x-kodak-k25",
  "image/x-minolta-mrw",
  "image/x-nikon-nef",
  "image/x-olympus-orf",
  "image/x-panasonic-rw2",
  "image/x-pentax-pef",
  "image/x-sony-arw",
  "image/x-sony-sr2",
  "image/x-sony-srf",
  "image/x-sigma-x3f",
  "image/dng",
]);

export function isRawImageFile(name: string, type: string) {
  const t = (type || "").toLowerCase();
  if (RAW_IMAGE_MIMES.has(t)) return true;
  const ext = (name.split(".").pop() || "").toLowerCase();
  return RAW_IMAGE_EXTS.has(ext);
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

type EditableImageMeta = {
  decodable: boolean;
  width?: number;
  height?: number;
  previewUrl?: string;
};

type LibRawSettingsLike = {
  outputColor?: number;
  outputBps?: 8 | 16;
  gamm?: [number, number, number, number, number, number];
  useCameraWb?: boolean;
  useCameraMatrix?: number;
  noAutoBright?: boolean;
  adjustMaximumThr?: number;
  threshold?: number;
  medPasses?: number;
  fbddNoiserd?: number;
  highlight?: number;
  userFlip?: number;
  userQual?: number;
};

type LibRawLensMakerNotesLike = {
  Lens?: string;
  CurFocal?: number;
  CurAp?: number;
  FocalLengthIn35mmFormat?: number;
  [key: string]: unknown;
};

type LibRawLensInfoLike = {
  Lens?: string;
  LensMake?: string;
  makernotes?: LibRawLensMakerNotesLike;
  [key: string]: unknown;
};

type LibRawMetadataLike = {
  width?: number;
  height?: number;
  iso_speed?: number;
  aperture?: number;
  focal_len?: number;
  camera_make?: string;
  camera_model?: string;
  normalized_make?: string;
  normalized_model?: string;
  lens?: LibRawLensInfoLike;
  [key: string]: unknown;
};

type LibRawImageDataLike = {
  width: number;
  height: number;
  colors: number;
  bits: number;
  data: Uint8Array | Uint8ClampedArray | Uint16Array;
};

type LibRawThumbnailDataLike = {
  width: number;
  height: number;
  format: "jpeg" | "bitmap" | "unknown";
  data: Uint8Array;
};

type ImageLoadEmbeddedPreview = {
  blob: Blob;
  width: number;
  height: number;
};

type ImageLoadProgress = {
  stage: string;
  embeddedPreview?: ImageLoadEmbeddedPreview;
};

type ImageLoadProgressListener = (progress: ImageLoadProgress) => void;

type LibRawInstanceLike = {
  worker?: Worker;
  open(bytes: BufferSource, settings?: LibRawSettingsLike): Promise<void>;
  metadata(fullOutput?: boolean): Promise<LibRawMetadataLike | undefined>;
  imageData(): Promise<LibRawImageDataLike | undefined>;
  thumbnailData?(): Promise<LibRawThumbnailDataLike | undefined>;
  dispose?: () => void;
};

const RAW_DECODE_SETTINGS: LibRawSettingsLike = {
  outputColor: 4,
  outputBps: 16,
  gamm: [1, 1, 0, 0, 0, 0],
  useCameraWb: true,
  useCameraMatrix: 1,
  noAutoBright: true,
  adjustMaximumThr: 0,
  threshold: 0,
  fbddNoiserd: 0,
  highlight: 2,
  userQual: 11,
};

const RAW_BASELINE_PERCENTILE = 98;
const RAW_BASELINE_TARGET = 0.9;
const RAW_DEVELOPED_LINEAR_RANGE_MAX = 2;
const RAW_HEADROOM_HISTOGRAM_STEP = 0.1;
const RAW_HEADROOM_HISTOGRAM_MAX = 2;
const RAW_TONE_SLOPE_EPSILON = 1e-5;
const RAW_MEDIAN_DENOISE_WEAK_ISO = 800;
const RAW_MEDIAN_DENOISE_STRONG_ISO = 3200;
const RAW_BASELINE_ROLLOFF_PERCENTILE = 99.8;
const RAW_BASELINE_ROLLOFF_ASYMPTOTIC = 0.5;
const RAW_THUMBNAIL_MATCH_ITERATIONS = 20;
const RAW_THUMBNAIL_MATCH_SEARCH_STEPS = 24;
const RAW_THUMBNAIL_MATCH_GAIN_MAX = 1 << 16;
const RAW_THUMBNAIL_MATCH_LOG_MIN = -16;
const RAW_THUMBNAIL_MATCH_LOG_MAX = 16;
const RAW_THUMBNAIL_MATCH_SIGMOID_MIN = -10;
const RAW_THUMBNAIL_MATCH_SIGMOID_MAX = 10;
const RAW_THUMBNAIL_MATCH_SIGMOID_STEP = 0.01;
const RAW_THUMBNAIL_MATCH_EXPOSURE_RELAXATION = 0.7;
const RAW_THUMBNAIL_MATCH_LOG_RELAXATION = 0.4;
const RAW_THUMBNAIL_MATCH_SIGMOID_RELAXATION = 0.2;
const RAW_THUMBNAIL_MATCH_RELAXATION_FINAL_SCALE = 0.5;
const RAW_THUMBNAIL_MATCH_COLOR_ITERATIONS = 20;
const RAW_THUMBNAIL_MATCH_SATURATION_RELAXATION = 0.7;
const RAW_THUMBNAIL_MATCH_VIBRANCE_RELAXATION = 0.5;
const RAW_THUMBNAIL_MATCH_COLOR_SEARCH_STEPS = 24;
const RAW_THUMBNAIL_MATCH_SATURATION_PERCENTILE = 95;
const RAW_THUMBNAIL_MATCH_VIBRANCE_PERCENTILE = 50;
const RAW_THUMBNAIL_MATCH_COLOR_VALUE_TRIM_FRACTION = 0.1;
const DEBUG_PERCENTILES = [0, 1, 2, 5, 25, 50, 75, 95, 98, 99, 100] as const;
const RAW_THUMBNAIL_MATCH_SAMPLE_MAX_SIDE = 256;

type DebugPercentileValues = number[];

type DebugPercentileStatistics = {
  luminance: DebugPercentileValues;
  saturation: DebugPercentileValues;
};

type RawThumbnailMatchReference = {
  lumaPercentiles: DebugPercentileValues;
  saturationPercentiles: DebugPercentileValues;
  linearSrgbSample: Float32Array;
};

const LIBRAW_BROWSER_MODULE_URL = "/vendor/libraw-wasm/index.js";

function logImageLoadStage(file: File, stage: string, startedAt: number): void {
  console.info(`[image-editor load] ${file.name}: ${stage} ${(performance.now() - startedAt).toFixed(1)}ms`);
}

async function rawEmbeddedPreviewFromThumbnail(
  thumbnail: LibRawThumbnailDataLike | undefined,
): Promise<ImageLoadEmbeddedPreview | undefined> {
  if (!thumbnail?.data?.length || thumbnail.width <= 0 || thumbnail.height <= 0) return undefined;
  if (thumbnail.format === "jpeg") {
    const bytes = new Uint8Array(thumbnail.data.byteLength);
    bytes.set(thumbnail.data);
    return {
      blob: new Blob([bytes.buffer], { type: "image/jpeg" }),
      width: thumbnail.width,
      height: thumbnail.height,
    };
  }
  if (thumbnail.format !== "bitmap") return undefined;
  const pixelCount = thumbnail.width * thumbnail.height;
  const channels = thumbnail.data.length >= pixelCount * 4 ? 4 : 3;
  if (thumbnail.data.length < pixelCount * channels) return undefined;
  const canvas = document.createElement("canvas");
  canvas.width = thumbnail.width;
  canvas.height = thumbnail.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return undefined;
  const imageData = ctx.createImageData(thumbnail.width, thumbnail.height);
  for (let pixel = 0; pixel < pixelCount; pixel++) {
    const si = pixel * channels;
    const di = pixel * 4;
    imageData.data[di] = thumbnail.data[si] ?? 0;
    imageData.data[di + 1] = thumbnail.data[si + 1] ?? 0;
    imageData.data[di + 2] = thumbnail.data[si + 2] ?? 0;
    imageData.data[di + 3] = channels === 4 ? (thumbnail.data[si + 3] ?? 255) : 255;
  }
  ctx.putImageData(imageData, 0, 0);
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.9));
  canvas.width = 0;
  canvas.height = 0;
  return blob ? { blob, width: thumbnail.width, height: thumbnail.height } : undefined;
}

async function createLibRawInstance(): Promise<LibRawInstanceLike> {
  // Keep LibRaw's worker/WASM files out of Next/Webpack's chunk graph. STGY
  // builds the LibRaw-Wasm 1.6.0 runtime without pthread/OpenMP and publishes
  // those files under public/vendor/libraw-wasm before dev/build starts.
  const moduleUrl = LIBRAW_BROWSER_MODULE_URL;
  const mod = (await import(/* webpackIgnore: true */ moduleUrl)) as {
    default: new () => LibRawInstanceLike;
  };
  return new mod.default();
}

async function readRawMeta(file: File): Promise<EditableImageMeta> {
  let raw: LibRawInstanceLike | null = null;
  try {
    raw = await createLibRawInstance();
    await raw.open(new Uint8Array(await file.arrayBuffer()));
    const meta = await raw.metadata(false);
    const width = Number(meta?.width || 0);
    const height = Number(meta?.height || 0);
    if (width > 0 && height > 0) {
      return { decodable: false, width, height };
    }
    return { decodable: false };
  } catch {
    return { decodable: false };
  } finally {
    raw?.dispose?.();
  }
}

async function readTiffMeta(file: File): Promise<EditableImageMeta> {
  try {
    const UTIF: typeof import("utif") = await import("utif");
    const ifds = UTIF.decode(await file.arrayBuffer());
    if (!ifds?.length) return { decodable: false };
    const ifd = ifds[0] as unknown as TiffIfdLike;
    const width = Number(ifd.t256?.[0] ?? ifd.width ?? 0);
    const height = Number(ifd.t257?.[0] ?? ifd.height ?? 0);
    return width > 0 && height > 0
      ? { decodable: true, width, height }
      : { decodable: false };
  } catch {
    return { decodable: false };
  }
}

async function readMeta(file: File): Promise<EditableImageMeta> {
  if (isRawImageFile(file.name || "", file.type || "")) {
    return readRawMeta(file);
  }
  if (isTiff(file.name || "", file.type || "")) {
    return readTiffMeta(file);
  }
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

export async function probeEditableImage(file: File): Promise<EditableImageMeta> {
  const meta = await readMeta(file);
  if (meta.previewUrl) URL.revokeObjectURL(meta.previewUrl);
  return { decodable: meta.decodable, width: meta.width, height: meta.height };
}

function computeScale(w: number, h: number): number {
  const longSide = Math.max(w, h);
  const s1 = Config.IMAGE_OPTIMIZE_TARGET_LONGSIDE / longSide;
  const s2 = Math.sqrt(Config.IMAGE_OPTIMIZE_TARGET_PIXELS / (w * h));
  return Math.min(1, s1, s2);
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

function normalizeTextFontIndex(value: number): number {
  if (!Number.isFinite(value)) return 0;
  const rounded = Math.round(value);
  const mod = rounded % TEXT_OVERLAY_FONTS.length;
  return mod >= 0 ? mod : mod + TEXT_OVERLAY_FONTS.length;
}

function normalizeTextOverlay(overlay: Partial<ImageTextOverlay>): ImageTextOverlay {
  return {
    id: typeof overlay.id === "string" && overlay.id ? overlay.id : makeOverlayId("text"),
    left: clamp01(overlay.left ?? 0),
    top: clamp01(overlay.top ?? 0),
    text: typeof overlay.text === "string" ? overlay.text : "",
    fontSize: Math.max(1, Math.round(Number.isFinite(overlay.fontSize) ? overlay.fontSize ?? 1 : 1)),
    fontIndex: normalizeTextFontIndex(overlay.fontIndex ?? 0),
    colorIndex: normalizeTextColorIndex(overlay.colorIndex ?? 0),
    outlineColorIndex: normalizeOptionalTextColorIndex(overlay.outlineColorIndex),
  };
}

function normalizeTextOverlays(overlays?: ImageTextOverlay[]): ImageTextOverlay[] {
  if (!overlays?.length) return [];
  return overlays.map((overlay) => normalizeTextOverlay(overlay));
}

function normalizeDrawTool(value: unknown): ImageDrawTool {
  return value === "rect" || value === "ellipse" ? value : "line";
}

function normalizeDrawOverlay(overlay: Partial<ImageDrawOverlay>): ImageDrawOverlay | null {
  const type = normalizeDrawTool(overlay.type);
  let x1 = clamp01(Number.isFinite(overlay.x1) ? overlay.x1 ?? 0 : 0);
  let y1 = clamp01(Number.isFinite(overlay.y1) ? overlay.y1 ?? 0 : 0);
  let x2 = clamp01(Number.isFinite(overlay.x2) ? overlay.x2 ?? 0 : 0);
  let y2 = clamp01(Number.isFinite(overlay.y2) ? overlay.y2 ?? 0 : 0);
  if (type !== "line") {
    [x1, x2] = [Math.min(x1, x2), Math.max(x1, x2)];
    [y1, y2] = [Math.min(y1, y2), Math.max(y1, y2)];
  }
  const width = Math.max(1, Number.isFinite(overlay.strokeWidth) ? overlay.strokeWidth ?? 1 : 1);
  const colorIndex = normalizeTextColorIndex(overlay.colorIndex ?? 0);
  if (type === "line") {
    if (Math.hypot(x2 - x1, y2 - y1) <= 1e-6) return null;
  } else if (x2 - x1 <= 1e-6 || y2 - y1 <= 1e-6) {
    return null;
  }
  return {
    id: typeof overlay.id === "string" && overlay.id ? overlay.id : makeOverlayId("draw"),
    type,
    x1,
    y1,
    x2,
    y2,
    strokeWidth: width,
    colorIndex,
  };
}

function normalizeDrawOverlays(overlays?: ImageDrawOverlay[]): ImageDrawOverlay[] {
  if (!overlays?.length) return [];
  return overlays
    .map((overlay) => normalizeDrawOverlay(overlay))
    .filter((overlay): overlay is ImageDrawOverlay => overlay !== null);
}

export function buildDefaultEditParams(w?: number, h?: number): ImageEditParams {
  return {
    crop: { top: 0, bottom: 0, left: 0, right: 0 },
    rotationDegrees: 0,
    temperature: 0,
    tint: 0,
    exposureEv: 0,
    shadow: 0,
    highlight: 0,
    scaledLog: 0,
    sigmoid: 0,
    vibrance: 0,
    saturation: 0,
    resizePercent: defaultResizePercent(w, h),
    sharpen: 0,
    mosaicRegions: [],
    textOverlays: [],
    drawOverlays: [],
  };
}

function buildUploadDefaultEditParams(
  name: string,
  type: string,
  w?: number,
  h?: number,
): ImageEditParams {
  const defaults = buildDefaultEditParams(w, h);
  return {
    ...defaults,
    sharpen: isRawImageFile(name, type) ? 1 : defaults.resizePercent !== 100 ? 1 : 0,
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
    shadow: clampToneRangeAdjustment(params?.shadow ?? defaults.shadow),
    highlight: clampToneRangeAdjustment(params?.highlight ?? defaults.highlight),
    scaledLog: clampScaledLog(params?.scaledLog ?? defaults.scaledLog),
    sigmoid: clampSigmoid(params?.sigmoid ?? defaults.sigmoid),
    vibrance: clampColorAdjustment(params?.vibrance ?? defaults.vibrance),
    saturation: clampColorAdjustment(params?.saturation ?? defaults.saturation),
    resizePercent: Math.min(100, Math.max(1, Math.round(params?.resizePercent ?? defaults.resizePercent))),
    sharpen: clampSharpen(params?.sharpen ?? defaults.sharpen),
    mosaicRegions: normalizeMosaicRegions(params?.mosaicRegions ?? defaults.mosaicRegions),
    textOverlays: normalizeTextOverlays(params?.textOverlays ?? defaults.textOverlays),
    drawOverlays: normalizeDrawOverlays(params?.drawOverlays ?? defaults.drawOverlays),
  };
}

function isMeaningfullyEdited(
  params: ImageEditParams | undefined,
  w?: number,
  h?: number,
  defaultsOverride?: ImageEditParams,
): boolean {
  if (!params) return false;
  const normalized = normalizeEditParams(params, w, h);
  const defaults = defaultsOverride ?? buildDefaultEditParams(w, h);
  return (
    normalized.crop.top > 0 ||
    normalized.crop.bottom > 0 ||
    normalized.crop.left > 0 ||
    normalized.crop.right > 0 ||
    Math.abs(normalized.rotationDegrees) > 0.0001 ||
    normalized.temperature !== 0 ||
    normalized.tint !== 0 ||
    Math.abs(normalized.exposureEv) > 0.0001 ||
    normalized.shadow !== 0 ||
    normalized.highlight !== 0 ||
    Math.abs(normalized.scaledLog) > 0.0001 ||
    Math.abs(normalized.sigmoid) > 0.0001 ||
    normalized.vibrance !== 0 ||
    normalized.saturation !== 0 ||
    normalized.resizePercent !== defaults.resizePercent ||
    normalized.sharpen !== defaults.sharpen ||
    normalized.mosaicRegions.length > 0 ||
    normalized.textOverlays.length > 0 ||
    normalized.drawOverlays.length > 0
  );
}

function formatSignedEv(v: number): string {
  return `${v >= 0 ? "+" : ""}${v.toFixed(1)}EV`;
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
  image: CanvasImageSource,
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

type SharpenPreset = {
  radius: number;
  sigma: number;
  amount: number;
  threshold: number;
};

const SHARPEN_GAMMA = 1.4;
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

function applySharpenToCanvas(
  canvas: HTMLCanvasElement | OffscreenCanvas,
  level: number,
  outputColorProfile: ImageEditOutputColorProfile = "srgb",
) {
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
  const inverseGamma = 1 / SHARPEN_GAMMA;

  const readLinear = (index: number): number => srgbChannelToLinear(values[index] ?? 0);
  const readGamma = (index: number): number => clamp01((values[index] ?? 0) / 255);
  const writeGamma = (index: number, value: number) => {
    values[index] = Math.round(clamp01(value) * 255);
  };
  const writeLinear = (index: number, value: number) => {
    values[index] = linearChannelToSrgb(clamp01(value));
  };

  for (let channel = 0; channel < 3; channel++) {
    // The reference implementation sharpens in a gamma=1.4 working space.
    // Temporarily store that channel in the ImageData itself so the only large
    // scratch allocation is the single horizontal-blur plane below.
    for (let pixel = 0; pixel < pixelCount; pixel++) {
      const index = pixel * 4 + channel;
      writeGamma(index, Math.pow(readLinear(index), inverseGamma));
    }

    for (let y = 0; y < height; y++) {
      const row = y * width;
      for (let x = 0; x < width; x++) {
        let sum = 0;
        for (let k = -half; k <= half; k++) {
          const sx = sharpenReflect101Index(x + k, width);
          sum += readGamma((row + sx) * 4 + channel) * kernel[k + half];
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
        const originalGamma = readGamma(index);
        const diff = originalGamma - blurred;
        const sharpenedGamma = Math.abs(diff) > preset.threshold
          ? originalGamma + preset.amount * diff
          : originalGamma;
        writeLinear(index, Math.pow(clamp01(sharpenedGamma), SHARPEN_GAMMA));
      }
    }
  }

  ctx.putImageData(imageData, 0, 0);
}

type MosaicPixelRect = { x: number; y: number; w: number; h: number };

function applyMosaicRectsToCanvas(
  canvas: HTMLCanvasElement | OffscreenCanvas,
  rects: MosaicPixelRect[],
  divisions = 16,
  outputColorProfile: ImageEditOutputColorProfile = "srgb",
) {
  if (!rects.length || divisions <= 0) return;
  const ctx = getCanvas2dContext(canvas, outputColorProfile, true);
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
    const imageData = getCanvasImageData(ctx, x0, y0, rw, rh, outputColorProfile);
    const rgba8 = imageData.data;
    for (let gy = 0; gy < grid; gy++) {
      const ty = Math.floor((gy * rh) / grid);
      const yEnd = Math.floor(((gy + 1) * rh) / grid);
      const th = yEnd - ty;
      if (th <= 0) continue;
      for (let gx = 0; gx < grid; gx++) {
        const tx = Math.floor((gx * rw) / grid);
        const xEnd = Math.floor(((gx + 1) * rw) / grid);
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
            sumR += rgba8[offset];
            sumG += rgba8[offset + 1];
            sumB += rgba8[offset + 2];
            sumA += rgba8[offset + 3];
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
            rgba8[offset] = avgR;
            rgba8[offset + 1] = avgG;
            rgba8[offset + 2] = avgB;
            rgba8[offset + 3] = avgA;
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

function textOverlayFontFamily(fontIndex: number): string {
  return TEXT_OVERLAY_FONTS[normalizeTextFontIndex(fontIndex)].family;
}

function textOverlayFontWeight(fontIndex: number): number {
  return TEXT_OVERLAY_FONTS[normalizeTextFontIndex(fontIndex)].weight;
}

function textOverlayCanvasFont(fontIndex: number, fontSize: number): string {
  return `${textOverlayFontWeight(fontIndex)} ${Math.max(1, fontSize)}px ${textOverlayFontFamily(fontIndex)}`;
}

function textOverlayFontLoadDescriptor(fontIndex: number, fontSize = 16): string {
  return `${textOverlayFontWeight(fontIndex)} ${Math.max(1, fontSize)}px ${TEXT_OVERLAY_FONTS[normalizeTextFontIndex(fontIndex)].loadFamily}`;
}

function measureTextOverlayLayout(text: string, fontSize: number, fontIndex: number): Pick<TextOverlayLayout, "width" | "height" | "lineHeight"> {
  const size = Math.max(1, fontSize);
  const lineHeight = Math.max(1, size * TEXT_OVERLAY_LINE_HEIGHT);
  const paddingX = size * TEXT_OVERLAY_TEXT_INSET_X_EM;
  const paddingY = size * TEXT_OVERLAY_TEXT_INSET_Y_EM;
  const lines = text.split("\n");
  const ctx = getTextMeasureContext();
  let maxWidth = size;
  if (ctx) {
    ctx.font = textOverlayCanvasFont(fontIndex, size);
    maxWidth = Math.max(
      size,
      ...lines.map((line) => ctx.measureText(line.length > 0 ? line : "　").width),
    );
  }
  return {
    width: Math.max(
      TEXT_OVERLAY_MIN_BOX_WIDTH,
      size + paddingX * 2,
      Math.ceil(maxWidth + paddingX * 2),
    ),
    height: Math.max(
      lineHeight + paddingY * 2,
      Math.ceil(lines.length * lineHeight + paddingY * 2),
    ),
    lineHeight,
  };
}

function textOverlayRenderOffset(fontSize: number): { x: number; y: number } {
  // Editing, committed preview, and baked canvas all use the same font-relative text
  // inset. Avoid fixed CSS-pixel padding here: it cannot stay aligned across font sizes.
  return {
    x: fontSize * TEXT_OVERLAY_TEXT_INSET_X_EM,
    y: fontSize * TEXT_OVERLAY_TEXT_INSET_Y_EM,
  };
}

type TextOverlayFontMetrics = {
  ascent: number;
  descent: number;
  baselineFromLineTop: number;
};

function textOverlayFontMetrics(
  ctx: RotationCanvasContext,
  fontSize: number,
  lineHeight: number,
): TextOverlayFontMetrics {
  // CSS lays glyphs out on an alphabetic baseline inside the line box. Recreate
  // that baseline from the font metrics instead of using canvas "top", whose
  // meaning varies noticeably between Japanese font families.
  const metrics = ctx.measureText("あAg");
  const measuredAscent = metrics.fontBoundingBoxAscent;
  const measuredDescent = metrics.fontBoundingBoxDescent;
  const ascent = Number.isFinite(measuredAscent) && measuredAscent > 0
    ? measuredAscent
    : Number.isFinite(metrics.actualBoundingBoxAscent) && metrics.actualBoundingBoxAscent > 0
      ? metrics.actualBoundingBoxAscent
      : fontSize * 0.8;
  const descent = Number.isFinite(measuredDescent) && measuredDescent >= 0
    ? measuredDescent
    : Number.isFinite(metrics.actualBoundingBoxDescent) && metrics.actualBoundingBoxDescent >= 0
      ? metrics.actualBoundingBoxDescent
      : fontSize * 0.2;
  const leading = lineHeight - ascent - descent;
  return {
    ascent,
    descent,
    baselineFromLineTop: leading / 2 + ascent,
  };
}

type TextOverlayInkBounds = {
  left: number;
  top: number;
  right: number;
  bottom: number;
};

function textOverlayInkBounds(
  ctx: RotationCanvasContext,
  text: string,
  fallback: TextOverlayFontMetrics,
): TextOverlayInkBounds {
  const metrics = ctx.measureText(text);
  const actualLeft = Number.isFinite(metrics.actualBoundingBoxLeft)
    ? Math.max(0, metrics.actualBoundingBoxLeft)
    : 0;
  const actualRight = Number.isFinite(metrics.actualBoundingBoxRight)
    ? Math.max(0, metrics.actualBoundingBoxRight)
    : Math.max(0, metrics.width);
  const actualAscent = Number.isFinite(metrics.actualBoundingBoxAscent)
    ? Math.max(0, metrics.actualBoundingBoxAscent)
    : fallback.ascent;
  const actualDescent = Number.isFinite(metrics.actualBoundingBoxDescent)
    ? Math.max(0, metrics.actualBoundingBoxDescent)
    : fallback.descent;
  return {
    left: -actualLeft,
    top: -actualAscent,
    right: actualRight,
    bottom: actualDescent,
  };
}

function textOverlayOutlineRadius(fontSize: number): number {
  return Math.max(1.5, fontSize * 0.015);
}

const TEXT_OVERLAY_OUTLINE_OPACITY = 0.8;
const TEXT_OVERLAY_PREVIEW_SHADOW_OPACITY = 0.28;
const EDIT_GRID_DIAGONAL_DIVISOR = 14;

function hexColorWithAlpha(color: string, alpha: number): string {
  const match = /^#([0-9a-f]{6})$/i.exec(color);
  if (!match) return color;
  const value = Number.parseInt(match[1], 16);
  const r = (value >> 16) & 0xff;
  const g = (value >> 8) & 0xff;
  const b = value & 0xff;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function editGridCellSize(displayW: number, displayH: number): number {
  const diagonal = Math.hypot(displayW, displayH);
  return Math.max(8, Math.round(diagonal / EDIT_GRID_DIAGONAL_DIVISOR));
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
  // text-shadow copies overlap, so each preview copy uses a lower alpha. The final
  // image composites the already-unioned outline mask once at exactly 0.8 opacity.
  const color = hexColorWithAlpha(
    TEXT_OVERLAY_COLORS[normalizeTextColorIndex(outlineColorIndex)],
    TEXT_OVERLAY_PREVIEW_SHADOW_OPACITY,
  );
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

async function ensureTextOverlayFontReady(fontIndex: number, text = "あ"): Promise<void> {
  if (typeof document === "undefined") return;
  const doc = document as Document & {
    fonts?: {
      load?: (font: string) => Promise<unknown>;
      check?: (font: string, text?: string) => boolean;
      ready?: Promise<unknown>;
    };
  };
  const descriptor = textOverlayFontLoadDescriptor(fontIndex);
  const sample = text.length > 0 ? text : "あ";
  try {
    await doc.fonts?.ready;
    if (doc.fonts?.check?.(descriptor, sample)) return;
    await doc.fonts?.load?.(descriptor, sample);
  } catch {}
}

function isTextOverlayFontReady(fontIndex: number, text = "あ"): boolean {
  if (typeof document === "undefined") return true;
  const fonts = (document as Document & {
    fonts?: { check?: (font: string, text?: string) => boolean };
  }).fonts;
  if (!fonts?.check) return true;
  try {
    return fonts.check(
      textOverlayFontLoadDescriptor(fontIndex),
      text.length > 0 ? text : "あ",
    );
  } catch {
    return true;
  }
}

async function ensureTextOverlayFontsReady(overlays: ImageTextOverlay[]): Promise<void> {
  const byFont = new Map<number, string[]>();
  for (const overlay of overlays) {
    const fontIndex = normalizeTextFontIndex(overlay.fontIndex);
    const texts = byFont.get(fontIndex) ?? [];
    texts.push(overlay.text);
    byFont.set(fontIndex, texts);
  }
  await Promise.all(
    Array.from(byFont, ([fontIndex, texts]) => ensureTextOverlayFontReady(fontIndex, texts.join("\n"))),
  );
}

function drawOverlaysToContext(
  ctx: RotationCanvasContext,
  overlays: ImageDrawOverlay[],
  sourceW: number,
  sourceH: number,
  cropW: number,
  cropH: number,
  outputW: number,
  outputH: number,
) {
  if (!overlays.length) return;
  const resizeScaleX = outputW / cropW;
  const resizeScaleY = outputH / cropH;
  ctx.save();
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  for (const overlay of overlays) {
    const x1 = overlay.x1 * sourceW * resizeScaleX;
    const y1 = overlay.y1 * sourceH * resizeScaleY;
    const x2 = overlay.x2 * sourceW * resizeScaleX;
    const y2 = overlay.y2 * sourceH * resizeScaleY;
    ctx.strokeStyle = TEXT_OVERLAY_COLORS[normalizeTextColorIndex(overlay.colorIndex)];
    ctx.lineWidth = Math.max(1, overlay.strokeWidth * Math.min(resizeScaleX, resizeScaleY));
    ctx.beginPath();
    if (overlay.type === "line") {
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
    } else if (overlay.type === "rect") {
      ctx.rect(Math.min(x1, x2), Math.min(y1, y2), Math.abs(x2 - x1), Math.abs(y2 - y1));
    } else {
      const left = Math.min(x1, x2);
      const top = Math.min(y1, y2);
      const width = Math.abs(x2 - x1);
      const height = Math.abs(y2 - y1);
      ctx.ellipse(left + width / 2, top + height / 2, width / 2, height / 2, 0, 0, Math.PI * 2);
    }
    ctx.stroke();
  }
  ctx.restore();
}

function drawTextOverlaysToContext(
  ctx: RotationCanvasContext,
  overlays: ImageTextOverlay[],
  sourceW: number,
  sourceH: number,
  cropW: number,
  cropH: number,
  outputW: number,
  outputH: number,
  outputColorProfile: ImageEditOutputColorProfile = "srgb",
) {
  if (!overlays.length) return;
  const resizeScaleX = outputW / cropW;
  const resizeScaleY = outputH / cropH;
  ctx.save();
  ctx.textBaseline = "alphabetic";
  for (const overlay of overlays) {
    const fontSize = Math.max(1, overlay.fontSize * Math.min(resizeScaleX, resizeScaleY));
    const lineHeight = Math.max(1, fontSize * TEXT_OVERLAY_LINE_HEIGHT);
    const renderOffset = textOverlayRenderOffset(fontSize);
    // Text overlays live in the post-crop/post-rotation output frame. Crop and
    // rotation change the image underneath, but never transform the overlay.
    const x = overlay.left * sourceW * resizeScaleX + renderOffset.x;
    const y = overlay.top * sourceH * resizeScaleY + renderOffset.y;
    ctx.font = textOverlayCanvasFont(overlay.fontIndex, fontSize);
    const fontMetrics = textOverlayFontMetrics(ctx, fontSize, lineHeight);
    const fillColor = TEXT_OVERLAY_COLORS[normalizeTextColorIndex(overlay.colorIndex)];
    ctx.fillStyle = fillColor;
    const outlineColor = normalizeOptionalTextColorIndex(overlay.outlineColorIndex);
    const outlineOffsets = outlineColor == null ? [] : textOverlayOutlineOffsets(fontSize);
    const lines = overlay.text.split("\n");
    for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
      const line = lines[lineIndex];
      const lineTop = y + lineIndex * lineHeight;
      const baselineY = lineTop + fontMetrics.baselineFromLineTop;
      if (outlineColor != null) {
        const margin = Math.ceil(textOverlayOutlineRadius(fontSize) + 2);
        const ink = textOverlayInkBounds(ctx, line, fontMetrics);
        // Use the actual glyph ink bounds, not the CSS line-height, so fonts with
        // tall ascenders (notably Zen Old Mincho 900) cannot be clipped at the
        // temporary outline surface edge. Floor/ceil also preserves sub-pixel AA.
        const surfaceLeft = Math.floor(ink.left - margin);
        const surfaceTop = Math.floor(ink.top - margin);
        const surfaceRight = Math.ceil(ink.right + margin);
        const surfaceBottom = Math.ceil(ink.bottom + margin);
        const surface = line.length > 0 ? createTextOutlineSurface(
          Math.max(1, surfaceRight - surfaceLeft),
          Math.max(1, surfaceBottom - surfaceTop),
          outputColorProfile,
        ) : null;
        if (surface) {
          surface.ctx.font = ctx.font;
          surface.ctx.textBaseline = "alphabetic";
          surface.ctx.fillStyle = TEXT_OVERLAY_COLORS[outlineColor];
          const surfaceAnchorX = -surfaceLeft;
          const surfaceBaselineY = -surfaceTop;
          for (const [dx, dy] of outlineOffsets) {
            surface.ctx.fillText(line, surfaceAnchorX + dx, surfaceBaselineY + dy);
          }
          const previousAlpha = ctx.globalAlpha;
          ctx.globalAlpha = previousAlpha * TEXT_OVERLAY_OUTLINE_OPACITY;
          ctx.drawImage(surface.canvas, x + surfaceLeft, baselineY + surfaceTop);
          ctx.globalAlpha = previousAlpha;
        } else {
          const previousAlpha = ctx.globalAlpha;
          ctx.globalAlpha = previousAlpha * TEXT_OVERLAY_OUTLINE_OPACITY;
          ctx.fillStyle = TEXT_OVERLAY_COLORS[outlineColor];
          for (const [dx, dy] of outlineOffsets) {
            ctx.fillText(line, x + dx, baselineY + dy);
          }
          ctx.globalAlpha = previousAlpha;
        }
        ctx.fillStyle = fillColor;
      }
      ctx.fillText(line, x, baselineY);
    }
  }
  ctx.restore();
}

type RotationCanvasContext = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

function createTextOutlineSurface(
  width: number,
  height: number,
  outputColorProfile: ImageEditOutputColorProfile = "srgb",
): { canvas: HTMLCanvasElement | OffscreenCanvas; ctx: RotationCanvasContext } | null {
  const w = Math.max(1, width);
  const h = Math.max(1, height);
  const OSC = getOffscreenCanvasCtor();
  if (OSC) {
    const canvas = new OSC(w, h);
    const ctx = getCanvas2dContext(canvas, outputColorProfile);
    if (ctx) return { canvas, ctx };
  }
  if (typeof document === "undefined") return null;
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = getCanvas2dContext(canvas, outputColorProfile);
  return ctx ? { canvas, ctx } : null;
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

type RawBaselineApplicationResult = {
  luminance: RawDevelopmentLuminanceSettings;
  headroom: RawDevelopmentHeadroomStatistics;
};

type RawDevelopmentMemoryUsage = {
  bufferBytes: number;
  heapBytes?: number;
  totalBytes?: number;
};

type RawDevelopmentCacheEntry = {
  itemId: string;
  file: File;
  decoded: DecodedRgbImage16;
};
const PROFILE_SNIFF_BYTES = 1024 * 1024;
const DISPLAY_P3_PROFILE_LABEL_RE = /display[ _-]?p3/i;
const PROPHOTO_PROFILE_LABEL_RE = /(?:prophoto|romm)[ _-]?rgb/i;
const ADOBE_RGB_PROFILE_LABEL_RE = /adobe[ _-]?rgb(?:[ _-]?\(?1998\)?)?/i;
const REC_2020_PROFILE_LABEL_RE = /(?:rec(?:\.|ommendation)?|bt)[\s._-]*2020/i;

function inputColorProfileToBestOutputProfile(profile: ImageInputColorProfile): ImageEditOutputColorProfile {
  return profile === "display-p3" || profile === "prophoto" || profile === "adobe-rgb" || profile === "rec2020"
    ? "display-p3"
    : "srgb";
}

type TiffIfdLike = {
  width?: number;
  height?: number;
  data?: Uint8Array;
  t256?: number[];
  t257?: number[];
  t258?: number[];
  t262?: number[];
  t277?: number[];
  t284?: number[];
  t338?: number[];
  t339?: number[];
  t34675?: unknown;
};

function profileLabelText(bytes: Uint8Array): string {
  // ICC v4 descriptions are often UTF-16BE. Removing NUL bytes lets the same
  // conservative label matcher handle both ASCII and the common BMP-string form.
  return new TextDecoder("latin1").decode(bytes).replace(/\0/g, "");
}

function sniffImageInputColorProfile(bytes: Uint8Array): ImageInputColorProfile {
  const text = profileLabelText(bytes);
  if (DISPLAY_P3_PROFILE_LABEL_RE.test(text)) return "display-p3";
  if (PROPHOTO_PROFILE_LABEL_RE.test(text)) return "prophoto";
  if (ADOBE_RGB_PROFILE_LABEL_RE.test(text)) return "adobe-rgb";
  if (REC_2020_PROFILE_LABEL_RE.test(text)) return "rec2020";
  return "srgb";
}

function bytesFromTiffTag(value: unknown): Uint8Array | null {
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (ArrayBuffer.isView(value)) {
    const view = value as ArrayBufferView;
    return new Uint8Array(view.buffer, view.byteOffset, view.byteLength);
  }
  if (Array.isArray(value)) {
    const numeric = value.filter((item): item is number => typeof item === "number");
    if (numeric.length === value.length) return Uint8Array.from(numeric, (item) => item & 0xff);
  }
  return null;
}

function tiffInputColorProfile(ifd: TiffIfdLike): ImageInputColorProfile {
  const icc = bytesFromTiffTag(ifd.t34675);
  return icc?.length ? sniffImageInputColorProfile(icc) : "srgb";
}

type HeifNclxColorInfo = {
  colourPrimaries: number;
  transferCharacteristics: number;
  matrixCoefficients: number;
  fullRangeFlag: boolean;
};

type HeifColorInfo =
  | { kind: "nclx"; nclx: HeifNclxColorInfo }
  | { kind: "icc"; icc: Uint8Array };

type IsoBox = {
  type: string;
  start: number;
  size: number;
  headerSize: number;
  contentStart: number;
  end: number;
};

function readIsoBoxSize(view: DataView, offset: number): number {
  const size32 = view.getUint32(offset, false);
  if (size32 !== 1) return size32;
  const hi = view.getUint32(offset + 8, false);
  const lo = view.getUint32(offset + 12, false);
  return hi * 0x100000000 + lo;
}

function readIsoBoxes(view: DataView, start: number, end: number): IsoBox[] {
  const boxes: IsoBox[] = [];
  let offset = start;
  while (offset + 8 <= end) {
    const size32 = view.getUint32(offset, false);
    const type = String.fromCharCode(
      view.getUint8(offset + 4),
      view.getUint8(offset + 5),
      view.getUint8(offset + 6),
      view.getUint8(offset + 7),
    );
    const headerSize = size32 === 1 ? 16 : 8;
    if (offset + headerSize > end) break;
    const size = size32 === 0 ? end - offset : readIsoBoxSize(view, offset);
    if (!Number.isFinite(size) || size < headerSize || offset + size > end) break;
    boxes.push({
      type,
      start: offset,
      size,
      headerSize,
      contentStart: offset + headerSize,
      end: offset + size,
    });
    offset += size;
  }
  return boxes;
}

function parseHeifColrBox(bytes: Uint8Array, box: IsoBox): HeifColorInfo | null {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (box.contentStart + 4 > box.end) return null;
  const colourType = String.fromCharCode(
    view.getUint8(box.contentStart),
    view.getUint8(box.contentStart + 1),
    view.getUint8(box.contentStart + 2),
    view.getUint8(box.contentStart + 3),
  );
  if (colourType === "nclx") {
    if (box.contentStart + 11 > box.end) return null;
    const flags = view.getUint8(box.contentStart + 10);
    return {
      kind: "nclx",
      nclx: {
        colourPrimaries: view.getUint16(box.contentStart + 4, false),
        transferCharacteristics: view.getUint16(box.contentStart + 6, false),
        matrixCoefficients: view.getUint16(box.contentStart + 8, false),
        fullRangeFlag: (flags & 0x80) !== 0,
      },
    };
  }
  if (colourType === "prof" || colourType === "rICC") {
    return {
      kind: "icc",
      icc: bytes.slice(box.contentStart + 4, box.end),
    };
  }
  return null;
}

function parsePrimaryHeifColorInfo(bytes: Uint8Array): HeifColorInfo | null {
  try {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const topLevelBoxes = readIsoBoxes(view, 0, bytes.byteLength);
    const metaBox = topLevelBoxes.find((box) => box.type === "meta");
    if (!metaBox || metaBox.contentStart + 4 > metaBox.end) return null;
    const metaChildren = readIsoBoxes(view, metaBox.contentStart + 4, metaBox.end);
    const pitmBox = metaChildren.find((box) => box.type === "pitm");
    const iprpBox = metaChildren.find((box) => box.type === "iprp");
    if (!pitmBox || !iprpBox || pitmBox.contentStart + 6 > pitmBox.end) return null;

    const pitmVersion = view.getUint8(pitmBox.contentStart);
    const primaryItemId = pitmVersion >= 1
      ? view.getUint32(pitmBox.contentStart + 4, false)
      : view.getUint16(pitmBox.contentStart + 4, false);

    const iprpChildren = readIsoBoxes(view, iprpBox.contentStart, iprpBox.end);
    const ipcoBox = iprpChildren.find((box) => box.type === "ipco");
    const ipmaBoxes = iprpChildren.filter((box) => box.type === "ipma");
    if (!ipcoBox || !ipmaBoxes.length) return null;

    const propertyBoxes = readIsoBoxes(view, ipcoBox.contentStart, ipcoBox.end);
    let colorPropertyIndices: number[] | null = null;

    for (const ipmaBox of ipmaBoxes) {
      if (ipmaBox.contentStart + 8 > ipmaBox.end) continue;
      const version = view.getUint8(ipmaBox.contentStart);
      const flags =
        (view.getUint8(ipmaBox.contentStart + 1) << 16)
        | (view.getUint8(ipmaBox.contentStart + 2) << 8)
        | view.getUint8(ipmaBox.contentStart + 3);
      const largePropertyIndex = (flags & 1) !== 0;
      let offset = ipmaBox.contentStart + 4;
      if (offset + 4 > ipmaBox.end) continue;
      const entryCount = view.getUint32(offset, false);
      offset += 4;
      for (let entry = 0; entry < entryCount && offset < ipmaBox.end; entry++) {
        if (version >= 1) {
          if (offset + 4 > ipmaBox.end) break;
        } else if (offset + 2 > ipmaBox.end) break;
        const itemId = version >= 1 ? view.getUint32(offset, false) : view.getUint16(offset, false);
        offset += version >= 1 ? 4 : 2;
        if (offset + 1 > ipmaBox.end) break;
        const associationCount = view.getUint8(offset);
        offset += 1;
        const propertyIndices: number[] = [];
        for (let i = 0; i < associationCount && offset < ipmaBox.end; i++) {
          if (largePropertyIndex) {
            if (offset + 2 > ipmaBox.end) break;
            const value = view.getUint16(offset, false);
            offset += 2;
            propertyIndices.push(value & 0x7fff);
          } else {
            const value = view.getUint8(offset);
            offset += 1;
            propertyIndices.push(value & 0x7f);
          }
        }
        if (itemId === primaryItemId) {
          colorPropertyIndices = propertyIndices;
          break;
        }
      }
      if (colorPropertyIndices) break;
    }

    if (!colorPropertyIndices?.length) return null;
    for (const propertyIndex of colorPropertyIndices) {
      const propertyBox = propertyBoxes[propertyIndex - 1];
      if (!propertyBox || propertyBox.type !== "colr") continue;
      const parsed = parseHeifColrBox(bytes, propertyBox);
      if (parsed) return parsed;
    }
  } catch {}
  return null;
}

function heifColorInfoToInputColorProfile(colorInfo: HeifColorInfo): ImageInputColorProfile {
  if (colorInfo.kind === "icc") return sniffImageInputColorProfile(colorInfo.icc);
  switch (colorInfo.nclx.colourPrimaries) {
    case 12:
      return "display-p3";
    case 9:
      return "rec2020";
    default:
      return "srgb";
  }
}

async function detectHeifOutputColorProfile(file: File): Promise<ImageEditOutputColorProfile> {
  try {
    const bytes = new Uint8Array(await file.slice(0, PROFILE_SNIFF_BYTES).arrayBuffer());
    const colorInfo = parsePrimaryHeifColorInfo(bytes);
    if (colorInfo) {
      const profile = heifColorInfoToInputColorProfile(colorInfo);
      return inputColorProfileToBestOutputProfile(profile);
    }
    return inputColorProfileToBestOutputProfile(sniffImageInputColorProfile(bytes));
  } catch {}
  return "srgb";
}

async function detectTiffOutputColorProfile(file: File): Promise<ImageEditOutputColorProfile> {
  try {
    const UTIF: typeof import("utif") = await import("utif");
    const ifds = UTIF.decode(await file.arrayBuffer());
    if (ifds?.length) {
      const profile = tiffInputColorProfile(ifds[0] as unknown as TiffIfdLike);
      return inputColorProfileToBestOutputProfile(profile);
    }
  } catch {}
  return "srgb";
}

export async function detectEditableImageColorProfile(file: File): Promise<ImageEditOutputColorProfile> {
  if (isRawImageFile(file.name || "", file.type || "")) return "srgb";
  if (isTiff(file.name || "", file.type || "")) return detectTiffOutputColorProfile(file);
  if (isHeif(file.name || "", file.type || "")) return detectHeifOutputColorProfile(file);
  try {
    const bytes = new Uint8Array(await file.slice(0, PROFILE_SNIFF_BYTES).arrayBuffer());
    return inputColorProfileToBestOutputProfile(sniffImageInputColorProfile(bytes));
  } catch {
    return "srgb";
  }
}

export async function detectBestEditableImageOutputColorProfile(
  file: File,
): Promise<ImageEditOutputColorProfile> {
  if (isRawImageFile(file.name || "", file.type || "")) return "display-p3";
  return detectEditableImageColorProfile(file);
}

type Rgb16PercentileDebugCacheEntry = {
  input: DebugPercentileStatistics;
  outputKey?: string;
  output?: DebugPercentileStatistics;
};
const RGB16_EDIT_PERCENTILE_DEBUG_CACHE = new WeakMap<
  LinearRgbSample,
  Rgb16PercentileDebugCacheEntry
>();

function scaleSampleTo16(v: number, bits: number): number {
  const b = Math.max(1, Math.min(16, Math.round(bits || 16)));
  if (b >= 16) return Math.max(0, Math.min(65535, Math.round(v)));
  const max = (1 << b) - 1;
  return max > 0 ? Math.round((Math.max(0, v) / max) * 65535) : 0;
}

function writeRgba8ToDecodedRgb16(
  rgba8: Uint8Array | Uint8ClampedArray,
  rgb16: Uint16Array,
  destinationPixelOffset: number,
  profile: ImageInputColorProfile,
): void {
  const count = Math.floor(rgba8.length / 4);
  for (let i = 0; i < count; i++) {
    const si = i * 4;
    const di = (destinationPixelOffset + i) * 3;
    const [r, g, b] = encodedRgbToLinearProphoto(
      (rgba8[si] ?? 0) / 255,
      (rgba8[si + 1] ?? 0) / 255,
      (rgba8[si + 2] ?? 0) / 255,
      profile,
    );
    rgb16[di] = encodeStoredRgb16Channel(r, "gamma20", 1);
    rgb16[di + 1] = encodeStoredRgb16Channel(g, "gamma20", 1);
    rgb16[di + 2] = encodeStoredRgb16Channel(b, "gamma20", 1);
  }
}

function rgba8ToDecodedRgb16(
  rgba8: Uint8Array | Uint8ClampedArray,
  width: number,
  height: number,
  profile: ImageInputColorProfile,
): DecodedRgbImage16 {
  const rgb16 = new Uint16Array(width * height * 3);
  writeRgba8ToDecodedRgb16(rgba8, rgb16, 0, profile);
  return {
    colorSpace: "prophoto",
    transfer: "gamma20",
    linearRangeMax: 1,
    width,
    height,
    data: rgb16,
    cleanup: () => {},
  };
}

function nativeRgbTiffToDecodedRgb16(
  ifd: TiffIfdLike,
  profile: ImageInputColorProfile,
): DecodedRgbImage16 | null {
  const width = Math.max(0, Math.round(Number(ifd.width ?? ifd.t256?.[0] ?? 0)));
  const height = Math.max(0, Math.round(Number(ifd.height ?? ifd.t257?.[0] ?? 0)));
  const data = ifd.data;
  const photometric = Number(ifd.t262?.[0] ?? 2);
  const samplesPerPixel = Math.max(1, Math.round(Number(ifd.t277?.[0] ?? 3)));
  const planarConfiguration = Math.round(Number(ifd.t284?.[0] ?? 1));
  const bitsTag = ifd.t258?.length ? ifd.t258 : [8];
  const sampleFormatTag = ifd.t339?.length ? ifd.t339 : [1];
  if (!width || !height || !data || photometric !== 2 || samplesPerPixel < 3) return null;
  if (planarConfiguration !== 1 && !(planarConfiguration === 2 && samplesPerPixel === 3)) return null;

  const bits = Array.from({ length: samplesPerPixel }, (_, i) => Number(bitsTag[Math.min(i, bitsTag.length - 1)] ?? bitsTag[0]));
  const formats = Array.from({ length: samplesPerPixel }, (_, i) => Number(sampleFormatTag[Math.min(i, sampleFormatTag.length - 1)] ?? 1));
  const bitDepth = bits[0];
  if ((bitDepth !== 8 && bitDepth !== 16) || bits.some((value) => value !== bitDepth)) return null;
  if (formats.some((value) => value !== 1)) return null;
  // UTIF's planar-2 interleave path is byte-oriented, so preserve native 16-bit
  // precision only for chunky TIFFs. Other layouts use the compatibility fallback.
  if (bitDepth === 16 && planarConfiguration !== 1) return null;

  const bytesPerSample = bitDepth / 8;
  const requiredBytes = width * height * samplesPerPixel * bytesPerSample;
  if (data.byteLength < requiredBytes) return null;

  const rgb16 = new Uint16Array(width * height * 3);
  const alphaKind = Number(ifd.t338?.[0] ?? 0); // 1=associated, 2=unassociated
  const hasAlpha = samplesPerPixel >= 4 && (alphaKind === 1 || alphaKind === 2);
  const readSample = bitDepth === 8
    ? (sampleIndex: number) => (data[sampleIndex] ?? 0) / 255
    : (sampleIndex: number) => {
        const byteIndex = sampleIndex * 2;
        return (((data[byteIndex] ?? 0) | ((data[byteIndex + 1] ?? 0) << 8)) >>> 0) / 65535;
      };

  const count = width * height;
  for (let i = 0; i < count; i++) {
    const base = i * samplesPerPixel;
    let r = readSample(base);
    let g = readSample(base + 1);
    let b = readSample(base + 2);
    if (hasAlpha && alphaKind === 1) {
      const alpha = clamp01(readSample(base + 3));
      if (alpha > 0) {
        r = clamp01(r / alpha);
        g = clamp01(g / alpha);
        b = clamp01(b / alpha);
      } else {
        r = g = b = 0;
      }
    }
    const [pr, pg, pb] = encodedRgbToLinearProphoto(r, g, b, profile);
    const di = i * 3;
    rgb16[di] = encodeStoredRgb16Channel(pr, "gamma20", 1);
    rgb16[di + 1] = encodeStoredRgb16Channel(pg, "gamma20", 1);
    rgb16[di + 2] = encodeStoredRgb16Channel(pb, "gamma20", 1);
  }

  return {
    colorSpace: "prophoto",
    transfer: "gamma20",
    linearRangeMax: 1,
    width,
    height,
    data: rgb16,
    cleanup: () => {},
  };
}

function convertDecodedRgb16Transfer(
  decoded: DecodedRgbImage16,
  transfer: DecodedRgbImage16["transfer"],
): void {
  if (decoded.transfer === transfer) return;
  const data = decoded.data;
  for (let i = 0; i < data.length; i += 3) {
    data[i] = encodeStoredRgb16Channel(
      decodeStoredRgb16Channel(data[i] ?? 0, decoded.transfer, decoded.linearRangeMax),
      transfer,
      decoded.linearRangeMax,
    );
    data[i + 1] = encodeStoredRgb16Channel(
      decodeStoredRgb16Channel(data[i + 1] ?? 0, decoded.transfer, decoded.linearRangeMax),
      transfer,
      decoded.linearRangeMax,
    );
    data[i + 2] = encodeStoredRgb16Channel(
      decodeStoredRgb16Channel(data[i + 2] ?? 0, decoded.transfer, decoded.linearRangeMax),
      transfer,
      decoded.linearRangeMax,
    );
  }
  decoded.transfer = transfer;
}

function histogramPercentile16(
  histogram: Uint32Array,
  sampleCount: number,
  percentile: number,
): number {
  if (sampleCount <= 0) return 0;
  const rank = (sampleCount - 1) * Math.min(100, Math.max(0, percentile)) / 100;
  const lowerRank = Math.floor(rank);
  const upperRank = Math.ceil(rank);
  const fraction = rank - lowerRank;
  let cumulative = 0;
  let lowerLevel = histogram.length - 1;
  let upperLevel = histogram.length - 1;
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
  return lowerLevel + (upperLevel - lowerLevel) * fraction;
}

function applyRawBaselineScaledLogLinear(value: number, factor: number): number {
  const x = clamp01(value);
  const f = Math.min(RAW_THUMBNAIL_MATCH_LOG_MAX, Math.max(RAW_THUMBNAIL_MATCH_LOG_MIN, factor));
  if (f > 1e-8) {
    return clamp01(Math.log1p(x * f) / Math.log1p(f));
  }
  if (f < -1e-8) {
    const magnitude = -f;
    return clamp01(Math.expm1(x * Math.log1p(magnitude)) / magnitude);
  }
  return x;
}

function applyRawBaselineSigmoidLinear(value: number, gain: number): number {
  const x = clamp01(value);
  const g = Math.min(
    RAW_THUMBNAIL_MATCH_SIGMOID_MAX,
    Math.max(RAW_THUMBNAIL_MATCH_SIGMOID_MIN, gain),
  );
  const mid = 0.5;
  const gamma = HISTOGRAM_DISPLAY_GAMMA;
  const encoded = Math.pow(x, 1 / gamma);
  if (g > 1e-8) {
    const minVal = naiveSigmoid(0, g, mid);
    const maxVal = naiveSigmoid(1, g, mid);
    const adjusted = clamp01((naiveSigmoid(encoded, g, mid) - minVal) / (maxVal - minVal));
    return clamp01(Math.pow(adjusted, gamma));
  }
  if (g < -1e-8) {
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

function rawBaselineToneCurveValue(
  value: number,
  scaledLog: number,
  sigmoid: number,
): number {
  const logarithmic = applyRawBaselineScaledLogLinear(value, scaledLog);
  return applyRawBaselineSigmoidLinear(logarithmic, sigmoid);
}

function rawBaselineToneSlopeAtWhite(
  scaledLog: number,
  sigmoid: number,
): number {
  const epsilon = RAW_TONE_SLOPE_EPSILON;
  const slope = (
    rawBaselineToneCurveValue(1, scaledLog, sigmoid)
    - rawBaselineToneCurveValue(1 - epsilon, scaledLog, sigmoid)
  ) / epsilon;
  return Number.isFinite(slope) && slope >= 0 ? slope : 1;
}

function transformedRawLumaValue(
  rawLuma: number,
  gain: number,
  scaledLog: number,
  sigmoid: number,
): number {
  return rawBaselineToneCurveValue(rawLuma * gain, scaledLog, sigmoid);
}

function transformedRawLumaValueExtended(
  rawLuma: number,
  gain: number,
  scaledLog: number,
  sigmoid: number,
  toneSlopeAtWhite: number,
): number {
  const exposed = rawLuma * gain;
  if (exposed <= 1) return rawBaselineToneCurveValue(exposed, scaledLog, sigmoid);
  return 1 + toneSlopeAtWhite * (exposed - 1);
}

function createRawHeadroomStatisticsAccumulator(): {
  bins: Uint32Array;
  overflowCount: number;
  pixelCount: number;
  maxRgb: number;
} {
  const binCount = Math.round(RAW_HEADROOM_HISTOGRAM_MAX / RAW_HEADROOM_HISTOGRAM_STEP);
  return {
    bins: new Uint32Array(binCount),
    overflowCount: 0,
    pixelCount: 0,
    maxRgb: 0,
  };
}

function recordRawHeadroomPixel(
  accumulator: ReturnType<typeof createRawHeadroomStatisticsAccumulator>,
  r: number,
  g: number,
  b: number,
): void {
  const maxRgb = Math.max(r, g, b);
  if (!Number.isFinite(maxRgb)) return;
  accumulator.pixelCount++;
  accumulator.maxRgb = Math.max(accumulator.maxRgb, maxRgb);
  if (maxRgb > RAW_HEADROOM_HISTOGRAM_MAX) {
    accumulator.overflowCount++;
    return;
  }
  const normalized = Math.max(0, maxRgb);
  const index = Math.min(
    accumulator.bins.length - 1,
    Math.floor(normalized / RAW_HEADROOM_HISTOGRAM_STEP),
  );
  accumulator.bins[Math.max(0, index)]++;
}

function finishRawHeadroomStatistics(
  accumulator: ReturnType<typeof createRawHeadroomStatisticsAccumulator>,
): RawDevelopmentHeadroomStatistics {
  return {
    step: RAW_HEADROOM_HISTOGRAM_STEP,
    histogramMax: RAW_HEADROOM_HISTOGRAM_MAX,
    bins: Array.from(accumulator.bins),
    overflowCount: accumulator.overflowCount,
    pixelCount: accumulator.pixelCount,
    maxRgb: accumulator.maxRgb,
  };
}

function solveRawThumbnailMatchGain(
  rawP98: number,
  scaledLog: number,
  sigmoid: number,
  targetP98: number,
): number {
  const target = clamp01(targetP98);
  if (!(target > 0) || !(rawP98 > 0)) return 0;

  let upper = 1;
  let upperValue = transformedRawLumaValue(rawP98, upper, scaledLog, sigmoid);
  while (upperValue < target && upper < RAW_THUMBNAIL_MATCH_GAIN_MAX) {
    upper = Math.min(RAW_THUMBNAIL_MATCH_GAIN_MAX, upper * 2);
    upperValue = transformedRawLumaValue(rawP98, upper, scaledLog, sigmoid);
  }
  if (upperValue < target) return upper;

  let lower = 0;
  for (let i = 0; i < RAW_THUMBNAIL_MATCH_SEARCH_STEPS; i++) {
    const mid = (lower + upper) / 2;
    const value = transformedRawLumaValue(rawP98, mid, scaledLog, sigmoid);
    if (value < target) lower = mid;
    else upper = mid;
  }
  return upper;
}

function solveRawThumbnailMatchLog(
  rawP50: number,
  gain: number,
  sigmoid: number,
  targetP50: number,
): number {
  const target = clamp01(targetP50);
  let lower = RAW_THUMBNAIL_MATCH_LOG_MIN;
  let upper = RAW_THUMBNAIL_MATCH_LOG_MAX;
  const lowerValue = transformedRawLumaValue(rawP50, gain, lower, sigmoid);
  if (target <= lowerValue) return lower;
  const upperValue = transformedRawLumaValue(rawP50, gain, upper, sigmoid);
  if (target >= upperValue) return upper;

  for (let i = 0; i < RAW_THUMBNAIL_MATCH_SEARCH_STEPS; i++) {
    const mid = (lower + upper) / 2;
    const value = transformedRawLumaValue(rawP50, gain, mid, sigmoid);
    if (value < target) lower = mid;
    else upper = mid;
  }
  return (lower + upper) / 2;
}

function rawThumbnailContrast(p25: number, p75: number): number {
  const gamma = HISTOGRAM_DISPLAY_GAMMA;
  return Math.pow(clamp01(p75), 1 / gamma) - Math.pow(clamp01(p25), 1 / gamma);
}

function solveRawThumbnailMatchSigmoid(
  rawP25: number,
  rawP75: number,
  gain: number,
  scaledLog: number,
  targetContrast: number,
): number {
  let bestSigmoid = 0;
  let bestError = Number.POSITIVE_INFINITY;
  for (
    let sigmoid = RAW_THUMBNAIL_MATCH_SIGMOID_MIN;
    sigmoid <= RAW_THUMBNAIL_MATCH_SIGMOID_MAX + RAW_THUMBNAIL_MATCH_SIGMOID_STEP / 2;
    sigmoid += RAW_THUMBNAIL_MATCH_SIGMOID_STEP
  ) {
    const p25 = transformedRawLumaValue(rawP25, gain, scaledLog, sigmoid);
    const p75 = transformedRawLumaValue(rawP75, gain, scaledLog, sigmoid);
    const error = Math.abs(rawThumbnailContrast(p25, p75) - targetContrast);
    if (
      error < bestError - 1e-12 ||
      (Math.abs(error - bestError) <= 1e-12 && Math.abs(sigmoid) < Math.abs(bestSigmoid))
    ) {
      bestError = error;
      bestSigmoid = sigmoid;
    }
  }
  return Math.min(
    RAW_THUMBNAIL_MATCH_SIGMOID_MAX,
    Math.max(RAW_THUMBNAIL_MATCH_SIGMOID_MIN, bestSigmoid),
  );
}

function applyRawThumbnailMatchedBaseline(
  decoded: DecodedRgbImage16,
  thumbnailPercentiles: DebugPercentileValues,
): RawBaselineApplicationResult | null {
  const p25Index = DEBUG_PERCENTILES.indexOf(25);
  const p50Index = DEBUG_PERCENTILES.indexOf(50);
  const p75Index = DEBUG_PERCENTILES.indexOf(75);
  const p98Index = DEBUG_PERCENTILES.indexOf(98);
  const targetP25 = thumbnailPercentiles[p25Index];
  const targetP50 = thumbnailPercentiles[p50Index];
  const targetP75 = thumbnailPercentiles[p75Index];
  const targetP98 = thumbnailPercentiles[p98Index];
  if (
    !Number.isFinite(targetP25) ||
    !Number.isFinite(targetP50) ||
    !Number.isFinite(targetP75) ||
    !Number.isFinite(targetP98) ||
    !(targetP98 > 1e-6)
  ) {
    return null;
  }

  const sample = sampleRawThumbnailMatchLinearRgbFromRgb16(decoded);
  if (!sample.length) return null;
  const rawPercentiles = debugPercentilesFromLinearRgbSample(sample, "prophoto");
  const rawP25 = rawPercentiles[p25Index];
  const rawP50 = rawPercentiles[p50Index];
  const rawP75 = rawPercentiles[p75Index];
  const rawP98 = rawPercentiles[p98Index];
  if (
    !(rawP25 >= 0) ||
    !(rawP50 >= 0) ||
    !(rawP75 >= rawP25) ||
    !(rawP98 > 1e-6)
  ) {
    return null;
  }

  const targetContrast = rawThumbnailContrast(targetP25, targetP75);

  // All RAW baseline operations are monotonic functions of linear luminance and
  // RGB is scaled only by Y'/Y. Pixel luminance ordering therefore never changes,
  // so P25/P50/P75/P98 are selected once and the iterations are scalar-only.
  // Under-relax each coupled update to suppress oscillation between the three targets.
  let gain = 1;
  let scaledLog = 0;
  let sigmoid = 0;
  for (let i = 0; i < RAW_THUMBNAIL_MATCH_ITERATIONS; i++) {
    const progress = i / Math.max(1, RAW_THUMBNAIL_MATCH_ITERATIONS - 1);
    const relaxationScale = Math.pow(RAW_THUMBNAIL_MATCH_RELAXATION_FINAL_SCALE, progress);

    const targetGain = solveRawThumbnailMatchGain(rawP98, scaledLog, sigmoid, targetP98);
    if (targetGain > 0 && gain > 0) {
      gain *= Math.pow(
        targetGain / gain,
        RAW_THUMBNAIL_MATCH_EXPOSURE_RELAXATION * relaxationScale,
      );
    }

    const targetLog = solveRawThumbnailMatchLog(rawP50, gain, sigmoid, targetP50);
    scaledLog += RAW_THUMBNAIL_MATCH_LOG_RELAXATION * relaxationScale * (targetLog - scaledLog);

    const targetSigmoid = solveRawThumbnailMatchSigmoid(
      rawP25,
      rawP75,
      gain,
      scaledLog,
      targetContrast,
    );
    sigmoid += RAW_THUMBNAIL_MATCH_SIGMOID_RELAXATION * relaxationScale * (targetSigmoid - sigmoid);
  }

  const data = decoded.data;
  const pixelCount = decoded.width * decoded.height;
  const sourceLinearRangeMax = decoded.linearRangeMax;
  const destinationLinearRangeMax = RAW_DEVELOPED_LINEAR_RANGE_MAX;
  const toneSlopeAtWhite = rawBaselineToneSlopeAtWhite(scaledLog, sigmoid);
  const headroom = createRawHeadroomStatisticsAccumulator();
  for (let pixel = 0; pixel < pixelCount; pixel++) {
    const i = pixel * 3;
    const x = pixel % decoded.width;
    const y = Math.floor(pixel / decoded.width);
    const [rGain, gGain, bGain] = pendingLensfunVignettingGain(decoded, x, y);
    const r = decodeStoredRgb16Channel(data[i] ?? 0, decoded.transfer, sourceLinearRangeMax) * rGain;
    const g = decodeStoredRgb16Channel(data[i + 1] ?? 0, decoded.transfer, sourceLinearRangeMax) * gGain;
    const b = decodeStoredRgb16Channel(data[i + 2] ?? 0, decoded.transfer, sourceLinearRangeMax) * bGain;
    const luma = PROPHOTO_LUMA_R * r + PROPHOTO_LUMA_G * g + PROPHOTO_LUMA_B * b;
    if (!(luma > 1e-12)) {
      data[i] = 0;
      data[i + 1] = 0;
      data[i + 2] = 0;
      recordRawHeadroomPixel(headroom, 0, 0, 0);
      continue;
    }
    const adjustedLuma = transformedRawLumaValueExtended(
      luma,
      gain,
      scaledLog,
      sigmoid,
      toneSlopeAtWhite,
    );
    const scale = adjustedLuma / luma;
    const adjustedR = r * scale;
    const adjustedG = g * scale;
    const adjustedB = b * scale;
    // Auto Color changes hue/saturation while preserving HSV Value, so max(R,G,B)
    // remains unchanged. Recording here therefore represents the final developed
    // headroom while still seeing values that the 0..linearRangeMax buffer will clip.
    recordRawHeadroomPixel(headroom, adjustedR, adjustedG, adjustedB);
    data[i] = encodeStoredRgb16Channel(adjustedR, decoded.transfer, destinationLinearRangeMax);
    data[i + 1] = encodeStoredRgb16Channel(adjustedG, decoded.transfer, destinationLinearRangeMax);
    data[i + 2] = encodeStoredRgb16Channel(adjustedB, decoded.transfer, destinationLinearRangeMax);
  }
  decoded.linearRangeMax = destinationLinearRangeMax;
  finishLensfunVignettingBake(decoded);
  return {
    luminance: {
      exposureEv: Math.log2(Math.max(gain, Number.MIN_VALUE)),
      logarithm: scaledLog,
      sigmoid,
      toneSlopeAtWhite,
    },
    headroom: finishRawHeadroomStatistics(headroom),
  };
}

function buildCentralValueMask(
  values: Float32Array,
): { mask: Uint8Array; count: number } {
  const count = values.length;
  const mask = new Uint8Array(count);
  if (count <= 0) return { mask, count: 0 };

  const indices = Array.from({ length: count }, (_, index) => index);
  indices.sort((a, b) => {
    const diff = (values[a] ?? 0) - (values[b] ?? 0);
    return diff !== 0 ? diff : a - b;
  });
  const trimCount = Math.min(
    Math.floor(count * RAW_THUMBNAIL_MATCH_COLOR_VALUE_TRIM_FRACTION),
    Math.floor((count - 1) / 2),
  );
  const start = trimCount;
  const end = count - trimCount;
  for (let i = start; i < end; i++) {
    const index = indices[i];
    if (index !== undefined) mask[index] = 1;
  }
  return { mask, count: end - start };
}

function hsvSaturationPercentileFromLinearSrgbSample(
  sample: Float32Array,
  percentile: number,
): number {
  const count = Math.floor(sample.length / 3);
  if (count <= 0) return 0;
  const saturationValues = new Float32Array(count);
  const valueValues = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    const si = i * 3;
    const [, saturation, value] = rgbToHsv(
      clamp01(sample[si] ?? 0),
      clamp01(sample[si + 1] ?? 0),
      clamp01(sample[si + 2] ?? 0),
    );
    saturationValues[i] = saturation;
    valueValues[i] = value;
  }
  const central = buildCentralValueMask(valueValues);
  if (central.count <= 0) return 0;

  const bins = 4096;
  const histogram = new Uint32Array(bins);
  for (let i = 0; i < count; i++) {
    if (!central.mask[i]) continue;
    const saturation = saturationValues[i] ?? 0;
    histogram[Math.min(bins - 1, Math.max(0, Math.round(saturation * (bins - 1))))]++;
  }
  return histogramPercentile16(histogram, central.count, percentile) / (bins - 1);
}

type RawAutoColorSample = {
  hue: Float32Array;
  saturation: Float32Array;
  value: Float32Array;
  saturationP99: number;
  statisticsMask: Uint8Array;
  statisticsCount: number;
};

function buildRawAutoColorSample(sample: Float32Array): RawAutoColorSample {
  const count = Math.floor(sample.length / 3);
  const hue = new Float32Array(count);
  const saturation = new Float32Array(count);
  const value = new Float32Array(count);
  const statisticsValue = new Float32Array(count);
  const saturationValues = new Array<number>(count);
  for (let i = 0; i < count; i++) {
    const si = i * 3;
    const r = sample[si] ?? 0;
    const g = sample[si + 1] ?? 0;
    const b = sample[si + 2] ?? 0;
    const [h, s, v] = rgbToHsv(r, g, b);
    hue[i] = h;
    saturation[i] = s;
    value[i] = v;
    saturationValues[i] = s;

    // Choose the central 80% by Value in the same linear-sRGB comparison
    // space used for the thumbnail. The mask stays fixed while the solver
    // varies Saturation/Vibrance, which keeps the optimization stable.
    const [sr, sg, sb] = convertLinearProPhotoToOutputRgb(r, g, b, "srgb");
    const [, , comparisonValue] = rgbToHsv(
      clamp01(sr),
      clamp01(sg),
      clamp01(sb),
    );
    statisticsValue[i] = comparisonValue;
  }
  const central = buildCentralValueMask(statisticsValue);
  return {
    hue,
    saturation,
    value,
    saturationP99: percentileFromValues(saturationValues, 99),
    statisticsMask: central.mask,
    statisticsCount: central.count,
  };
}

function rawAutoColorSaturationPercentile(
  sample: RawAutoColorSample,
  saturation: number,
  vibrance: number,
  percentile: number,
): number {
  const normalizedSaturation = clampColorAdjustment(saturation);
  const normalizedVibrance = clampColorAdjustment(vibrance);
  const saturationFactor = colorSaturationFactor(normalizedSaturation);
  const vibranceFactor = colorVibranceFactor(normalizedVibrance);
  // Match the manual Saturation path exactly: its rolloff is determined from
  // the P99 saturation after the linear multiplier, before Vibrance.
  const saturationRolloff = saturationFactor > 1
    ? rolloffParams(sample.saturationP99 * saturationFactor, 0.7, 4)
    : null;
  const bins = 4096;
  const histogram = new Uint32Array(bins);
  for (let i = 0; i < sample.saturation.length; i++) {
    if (!sample.statisticsMask[i]) continue;
    let s = sample.saturation[i] ?? 0;
    if (normalizedSaturation !== 0) {
      s = applyRolloffScalar(s * saturationFactor, saturationRolloff);
      s = clamp01(s);
    }
    if (normalizedVibrance !== 0) {
      s = applyScaledLogLinear(s, vibranceFactor);
    }
    const [pr, pg, pb] = hsvToRgb(
      sample.hue[i] ?? 0,
      s,
      sample.value[i] ?? 0,
    );
    const [sr, sg, sb] = convertLinearProPhotoToOutputRgb(pr, pg, pb, "srgb");
    const [, outputSaturation] = rgbToHsv(
      clamp01(sr),
      clamp01(sg),
      clamp01(sb),
    );
    histogram[Math.min(bins - 1, Math.max(0, Math.round(outputSaturation * (bins - 1))))]++;
  }
  return histogramPercentile16(histogram, sample.statisticsCount, percentile) / (bins - 1);
}

function solveRawThumbnailMatchColorParameter(
  sample: RawAutoColorSample,
  target: number,
  percentile: number,
  fixedSaturation: number,
  parameter: "saturation" | "vibrance",
): number {
  const evaluate = (value: number) => rawAutoColorSaturationPercentile(
    sample,
    parameter === "saturation" ? value : fixedSaturation,
    parameter === "vibrance" ? value : 0,
    percentile,
  );
  let lower = -100;
  let upper = 100;
  let lowerValue = evaluate(lower);
  let upperValue = evaluate(upper);
  const clampedTarget = clamp01(target);

  // The manual HSV adjustment is normally monotonic in this statistic. If a
  // gamut-clipping edge case reverses the endpoints, keep the search ordered.
  if (lowerValue > upperValue) {
    [lower, upper] = [upper, lower];
    [lowerValue, upperValue] = [upperValue, lowerValue];
  }
  if (clampedTarget <= lowerValue) return lower;
  if (clampedTarget >= upperValue) return upper;

  for (let i = 0; i < RAW_THUMBNAIL_MATCH_COLOR_SEARCH_STEPS; i++) {
    const mid = (lower + upper) / 2;
    const value = evaluate(mid);
    if (value < clampedTarget) {
      lower = mid;
      lowerValue = value;
    } else {
      upper = mid;
      upperValue = value;
    }
  }
  return Math.abs(lowerValue - clampedTarget) <= Math.abs(upperValue - clampedTarget)
    ? lower
    : upper;
}

function applyColorAdjustmentsLinearRgbPreservingExtendedRange(
  r: number,
  g: number,
  b: number,
  context: ColorAdjustmentContext,
): [number, number, number] {
  const scale = Math.max(1, r, g, b);
  const [adjustedR, adjustedG, adjustedB] = applyColorAdjustmentsLinearRgb(
    r / scale,
    g / scale,
    b / scale,
    context,
  );
  return [adjustedR * scale, adjustedG * scale, adjustedB * scale];
}

function applyRawThumbnailMatchedColor(
  decoded: DecodedRgbImage16,
  thumbnailLinearSrgbSample: Float32Array,
): RawDevelopmentSaturationSettings | null {
  if (!thumbnailLinearSrgbSample.length) return null;
  const rawLinearProPhotoSample = sampleRawThumbnailMatchLinearRgbFromRgb16(decoded);
  if (!rawLinearProPhotoSample.length) return null;

  const targetP95 = hsvSaturationPercentileFromLinearSrgbSample(
    thumbnailLinearSrgbSample,
    RAW_THUMBNAIL_MATCH_SATURATION_PERCENTILE,
  );
  const targetP50 = hsvSaturationPercentileFromLinearSrgbSample(
    thumbnailLinearSrgbSample,
    RAW_THUMBNAIL_MATCH_VIBRANCE_PERCENTILE,
  );
  if (!Number.isFinite(targetP95) || !Number.isFinite(targetP50)) return null;

  const sample = buildRawAutoColorSample(rawLinearProPhotoSample);
  const targetSaturation = solveRawThumbnailMatchColorParameter(
    sample,
    targetP95,
    RAW_THUMBNAIL_MATCH_SATURATION_PERCENTILE,
    0,
    "saturation",
  );
  let saturation = 0;
  for (let i = 0; i < RAW_THUMBNAIL_MATCH_COLOR_ITERATIONS; i++) {
    saturation += RAW_THUMBNAIL_MATCH_SATURATION_RELAXATION * (targetSaturation - saturation);
  }
  saturation = clampColorAdjustment(saturation);

  const targetVibrance = solveRawThumbnailMatchColorParameter(
    sample,
    targetP50,
    RAW_THUMBNAIL_MATCH_VIBRANCE_PERCENTILE,
    saturation,
    "vibrance",
  );
  let vibrance = 0;
  for (let i = 0; i < RAW_THUMBNAIL_MATCH_COLOR_ITERATIONS; i++) {
    vibrance += RAW_THUMBNAIL_MATCH_VIBRANCE_RELAXATION * (targetVibrance - vibrance);
  }
  vibrance = clampColorAdjustment(vibrance);

  if (Math.abs(saturation) < 1e-6 && Math.abs(vibrance) < 1e-6) {
    return { saturation, vibrance };
  }
  const context = colorAdjustmentContextFromLinearRgbSample(
    rawLinearProPhotoSample,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    vibrance,
    saturation,
  );
  const data = decoded.data;
  for (let i = 0; i < data.length; i += 3) {
    const [r, g, b] = applyColorAdjustmentsLinearRgbPreservingExtendedRange(
      decodeStoredRgb16Channel(data[i] ?? 0, decoded.transfer, decoded.linearRangeMax),
      decodeStoredRgb16Channel(data[i + 1] ?? 0, decoded.transfer, decoded.linearRangeMax),
      decodeStoredRgb16Channel(data[i + 2] ?? 0, decoded.transfer, decoded.linearRangeMax),
      context,
    );
    data[i] = encodeStoredRgb16Channel(r, decoded.transfer, decoded.linearRangeMax);
    data[i + 1] = encodeStoredRgb16Channel(g, decoded.transfer, decoded.linearRangeMax);
    data[i + 2] = encodeStoredRgb16Channel(b, decoded.transfer, decoded.linearRangeMax);
  }
  return { saturation, vibrance };
}

function applyRawBaselineExposure(
  decoded: DecodedRgbImage16,
): RawBaselineApplicationResult | null {
  const data = decoded.data;
  const rmsHistogram = new Uint32Array(65536);
  const channelHistogram = new Uint32Array(65536);
  const pixelCount = decoded.width * decoded.height;
  if (pixelCount <= 0) return null;

  const sourceLinearRangeMax = decoded.linearRangeMax;
  for (let pixel = 0; pixel < pixelCount; pixel++) {
    const i = pixel * 3;
    const x = pixel % decoded.width;
    const y = Math.floor(pixel / decoded.width);
    const [rGain, gGain, bGain] = pendingLensfunVignettingGain(decoded, x, y);
    const r = decodeStoredRgb16Channel(data[i] ?? 0, decoded.transfer, sourceLinearRangeMax) * rGain;
    const g = decodeStoredRgb16Channel(data[i + 1] ?? 0, decoded.transfer, sourceLinearRangeMax) * gGain;
    const b = decodeStoredRgb16Channel(data[i + 2] ?? 0, decoded.transfer, sourceLinearRangeMax) * bGain;
    const rms = Math.sqrt((r * r + g * g + b * b) / 3);
    const rmsLevel = Math.min(65535, Math.max(0, Math.round(rms * 65535)));
    rmsHistogram[rmsLevel]++;
    channelHistogram[Math.min(65535, Math.max(0, Math.round(r * 65535)))]++;
    channelHistogram[Math.min(65535, Math.max(0, Math.round(g * 65535)))]++;
    channelHistogram[Math.min(65535, Math.max(0, Math.round(b * 65535)))]++;
  }

  const p98 = histogramPercentile16(
    rmsHistogram,
    pixelCount,
    RAW_BASELINE_PERCENTILE,
  ) / 65535;
  if (!(p98 > 0)) return null;

  const factor = RAW_BASELINE_TARGET / p98;
  const channelMax = histogramPercentile16(
    channelHistogram,
    pixelCount * 3,
    RAW_BASELINE_ROLLOFF_PERCENTILE,
  ) / 65535 * factor;
  const rolloff = rolloffParams(
    channelMax,
    RAW_BASELINE_ROLLOFF_ASYMPTOTIC,
    4,
  );

  const destinationLinearRangeMax = RAW_DEVELOPED_LINEAR_RANGE_MAX;
  const headroom = createRawHeadroomStatisticsAccumulator();
  for (let pixel = 0; pixel < pixelCount; pixel++) {
    const i = pixel * 3;
    const x = pixel % decoded.width;
    const y = Math.floor(pixel / decoded.width);
    const [rGain, gGain, bGain] = pendingLensfunVignettingGain(decoded, x, y);
    const r = applyRolloffScalar(
      decodeStoredRgb16Channel(data[i] ?? 0, decoded.transfer, sourceLinearRangeMax) * rGain * factor,
      rolloff,
    );
    const g = applyRolloffScalar(
      decodeStoredRgb16Channel(data[i + 1] ?? 0, decoded.transfer, sourceLinearRangeMax) * gGain * factor,
      rolloff,
    );
    const b = applyRolloffScalar(
      decodeStoredRgb16Channel(data[i + 2] ?? 0, decoded.transfer, sourceLinearRangeMax) * bGain * factor,
      rolloff,
    );
    recordRawHeadroomPixel(headroom, r, g, b);
    data[i] = encodeStoredRgb16Channel(r, decoded.transfer, destinationLinearRangeMax);
    data[i + 1] = encodeStoredRgb16Channel(g, decoded.transfer, destinationLinearRangeMax);
    data[i + 2] = encodeStoredRgb16Channel(b, decoded.transfer, destinationLinearRangeMax);
  }
  decoded.linearRangeMax = destinationLinearRangeMax;
  finishLensfunVignettingBake(decoded);
  return {
    luminance: {
      exposureEv: Math.log2(Math.max(factor, Number.MIN_VALUE)),
      logarithm: 0,
      sigmoid: 0,
      toneSlopeAtWhite: 1,
    },
    headroom: finishRawHeadroomStatistics(headroom),
  };
}

function debugPercentilesFromLinearRgbSample(
  sample: Float32Array | LinearRgbSample,
  colorSpace: "srgb" | "prophoto" = "srgb",
): DebugPercentileValues {
  const data = sample instanceof Float32Array ? sample : sample.data;
  const valid = sample instanceof Float32Array ? undefined : sample.valid;
  const count = Math.floor(data.length / 3);
  if (count <= 0) return DEBUG_PERCENTILES.map(() => 0);
  const lumaR = colorSpace === "prophoto" ? PROPHOTO_LUMA_R : 0.2126;
  const lumaG = colorSpace === "prophoto" ? PROPHOTO_LUMA_G : 0.7152;
  const lumaB = colorSpace === "prophoto" ? PROPHOTO_LUMA_B : 0.0722;
  const luma: number[] = [];
  for (let i = 0; i < count; i++) {
    if (valid && !valid[i]) continue;
    const si = i * 3;
    const r = data[si] ?? 0;
    const g = data[si + 1] ?? 0;
    const b = data[si + 2] ?? 0;
    luma.push(clamp01(lumaR * r + lumaG * g + lumaB * b));
  }
  if (!luma.length) return DEBUG_PERCENTILES.map(() => 0);
  return percentilesFromValues(luma, DEBUG_PERCENTILES);
}

function debugSaturationPercentilesFromLinearRgbSample(
  sample: Float32Array | LinearRgbSample,
  colorSpace: "srgb" | "prophoto" = "srgb",
): DebugPercentileValues {
  const data = sample instanceof Float32Array ? sample : sample.data;
  const valid = sample instanceof Float32Array ? undefined : sample.valid;
  const count = Math.floor(data.length / 3);
  if (count <= 0) return DEBUG_PERCENTILES.map(() => 0);
  const values: number[] = [];
  for (let i = 0; i < count; i++) {
    if (valid && !valid[i]) continue;
    const si = i * 3;
    let r = data[si] ?? 0;
    let g = data[si + 1] ?? 0;
    let b = data[si + 2] ?? 0;
    if (colorSpace === "prophoto") {
      [r, g, b] = convertLinearProPhotoToOutputRgb(r, g, b, "srgb");
    }
    const [, saturation] = rgbToHsv(clamp01(r), clamp01(g), clamp01(b));
    values.push(saturation);
  }
  if (!values.length) return DEBUG_PERCENTILES.map(() => 0);
  return percentilesFromValues(values, DEBUG_PERCENTILES);
}

function debugStatisticsFromLinearRgbSample(
  sample: Float32Array | LinearRgbSample,
  colorSpace: "srgb" | "prophoto" = "srgb",
): DebugPercentileStatistics {
  return {
    luminance: debugPercentilesFromLinearRgbSample(sample, colorSpace),
    saturation: debugSaturationPercentilesFromLinearRgbSample(sample, colorSpace),
  };
}

// RAW thumbnail matching is part of the existing development baseline, not the
// editor analysis policy. Keep its historical max-side sampling unchanged in
// this commit so the RAW baseline does not move together with editor statistics.
function sampleRawThumbnailMatchLinearRgbFromRgb16(decoded: DecodedRgbImage16): Float32Array {
  const scale = Math.min(
    1,
    RAW_THUMBNAIL_MATCH_SAMPLE_MAX_SIDE / Math.max(decoded.width, decoded.height),
  );
  const sampleW = Math.max(1, Math.round(decoded.width * scale));
  const sampleH = Math.max(1, Math.round(decoded.height * scale));
  const output = new Float32Array(sampleW * sampleH * 3);
  for (let y = 0; y < sampleH; y++) {
    const sy = Math.min(decoded.height - 1, Math.floor((y + 0.5) * decoded.height / sampleH));
    for (let x = 0; x < sampleW; x++) {
      const sx = Math.min(decoded.width - 1, Math.floor((x + 0.5) * decoded.width / sampleW));
      const sourceIndex = (sy * decoded.width + sx) * 3;
      const targetIndex = (y * sampleW + x) * 3;
      const [rGain, gGain, bGain] = pendingLensfunVignettingGain(decoded, sx, sy);
      output[targetIndex] =
        decodeStoredRgb16Channel(decoded.data[sourceIndex] ?? 0, decoded.transfer, decoded.linearRangeMax) * rGain;
      output[targetIndex + 1] =
        decodeStoredRgb16Channel(decoded.data[sourceIndex + 1] ?? 0, decoded.transfer, decoded.linearRangeMax) * gGain;
      output[targetIndex + 2] =
        decodeStoredRgb16Channel(decoded.data[sourceIndex + 2] ?? 0, decoded.transfer, decoded.linearRangeMax) * bGain;
    }
  }
  return output;
}

function adjustedDebugStatisticsFromLinearRgbSample(
  sample: LinearRgbSample,
  temperature: number,
  tint: number,
  exposureEv: number,
  shadow: number,
  highlight: number,
  scaledLog: number,
  sigmoid: number,
  vibrance: number,
  saturation: number,
  colorSpace: "srgb" | "prophoto" = "srgb",
): DebugPercentileStatistics {
  const context = buildColorAdjustmentContextFromLinearRgbSample(
    sample,
    temperature,
    tint,
    exposureEv,
    shadow,
    highlight,
    scaledLog,
    sigmoid,
    vibrance,
    saturation,
    true,
  );
  const adjusted = new Float32Array(sample.data.length);
  const pixelCount = Math.floor(sample.data.length / 3);
  for (let pixel = 0; pixel < pixelCount; pixel++) {
    if (sample.valid && !sample.valid[pixel]) continue;
    const i = pixel * 3;
    const [r, g, b] = applyColorAdjustmentsLinearRgb(
      sample.data[i] ?? 0,
      sample.data[i + 1] ?? 0,
      sample.data[i + 2] ?? 0,
      context,
    );
    adjusted[i] = r;
    adjusted[i + 1] = g;
    adjusted[i + 2] = b;
  }
  return debugStatisticsFromLinearRgbSample(
    { ...sample, data: adjusted },
    colorSpace,
  );
}

async function rawThumbnailMatchReferenceFromThumbnail(
  thumbnail: LibRawThumbnailDataLike | undefined,
): Promise<RawThumbnailMatchReference | undefined> {
  if (!thumbnail?.data?.length || thumbnail.width <= 0 || thumbnail.height <= 0) return undefined;

  let sample: Float32Array | null = null;
  if (thumbnail.format === "bitmap") {
    const pixelCount = thumbnail.width * thumbnail.height;
    const channels = thumbnail.data.length >= pixelCount * 4 ? 4 : 3;
    if (thumbnail.data.length < pixelCount * channels) return undefined;
    const scale = Math.min(
      1,
      RAW_THUMBNAIL_MATCH_SAMPLE_MAX_SIDE / Math.max(thumbnail.width, thumbnail.height),
    );
    const sampleW = Math.max(1, Math.round(thumbnail.width * scale));
    const sampleH = Math.max(1, Math.round(thumbnail.height * scale));
    sample = new Float32Array(sampleW * sampleH * 3);
    // LibRaw bitmap thumbnails do not carry an ICC payload here. Preserve the
    // existing sRGB assumption, while JPEG thumbnails below are color-managed.
    for (let y = 0; y < sampleH; y++) {
      const sy = Math.min(thumbnail.height - 1, Math.floor((y + 0.5) * thumbnail.height / sampleH));
      for (let x = 0; x < sampleW; x++) {
        const sx = Math.min(thumbnail.width - 1, Math.floor((x + 0.5) * thumbnail.width / sampleW));
        const sourceIndex = (sy * thumbnail.width + sx) * channels;
        const targetIndex = (y * sampleW + x) * 3;
        sample[targetIndex] = srgbChannelToLinear(thumbnail.data[sourceIndex] ?? 0);
        sample[targetIndex + 1] = srgbChannelToLinear(thumbnail.data[sourceIndex + 1] ?? 0);
        sample[targetIndex + 2] = srgbChannelToLinear(thumbnail.data[sourceIndex + 2] ?? 0);
      }
    }
  } else if (thumbnail.format === "jpeg") {
    const jpegBytes = new Uint8Array(thumbnail.data.byteLength);
    jpegBytes.set(thumbnail.data);
    const blob = new Blob([jpegBytes.buffer], { type: "image/jpeg" });
    let source: CanvasImageSource | null = null;
    let cleanup = () => {};
    try {
      try {
        // The default conversion honors the JPEG's embedded ICC profile. Drawing
        // into an explicit sRGB canvas then normalizes all tagged thumbnails to
        // the same comparison primaries before HSV statistics are computed.
        const bitmap = await createImageBitmap(blob, { colorSpaceConversion: "default" });
        source = bitmap;
        cleanup = () => bitmap.close?.();
      } catch {
        const file = new File([blob], "raw-thumbnail.jpg", { type: "image/jpeg" });
        source = await decodeViaImg(file);
      }
      const width = Number((source as ImageBitmap).width || (source as HTMLImageElement).naturalWidth || thumbnail.width);
      const height = Number((source as ImageBitmap).height || (source as HTMLImageElement).naturalHeight || thumbnail.height);
      const scale = Math.min(1, RAW_THUMBNAIL_MATCH_SAMPLE_MAX_SIDE / Math.max(width, height));
      const sampleW = Math.max(1, Math.round(width * scale));
      const sampleH = Math.max(1, Math.round(height * scale));
      const canvas = document.createElement("canvas");
      canvas.width = sampleW;
      canvas.height = sampleH;
      const ctx = getCanvas2dContext(canvas, "srgb", true);
      if (!ctx) return undefined;
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(source, 0, 0, width, height, 0, 0, sampleW, sampleH);
      const rgba = ctx.getImageData(0, 0, sampleW, sampleH).data;
      sample = new Float32Array(sampleW * sampleH * 3);
      for (let i = 0, oi = 0; i < rgba.length; i += 4, oi += 3) {
        sample[oi] = srgbChannelToLinear(rgba[i] ?? 0);
        sample[oi + 1] = srgbChannelToLinear(rgba[i + 1] ?? 0);
        sample[oi + 2] = srgbChannelToLinear(rgba[i + 2] ?? 0);
      }
    } finally {
      cleanup();
    }
  }

  if (!sample?.length) return undefined;
  return {
    lumaPercentiles: debugPercentilesFromLinearRgbSample(sample),
    saturationPercentiles: debugSaturationPercentilesFromLinearRgbSample(sample),
    linearSrgbSample: sample,
  };
}

async function debugStatisticsFromRawThumbnail(
  thumbnail: LibRawThumbnailDataLike | undefined,
): Promise<DebugPercentileStatistics | undefined> {
  const reference = await rawThumbnailMatchReferenceFromThumbnail(thumbnail);
  if (!reference) return undefined;
  return {
    luminance: reference.lumaPercentiles,
    saturation: reference.saturationPercentiles,
  };
}

function rawMetadataString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function rawMetadataPositiveNumber(value: unknown): number | undefined {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : undefined;
}

function rawLensMetadata(metadata: LibRawMetadataLike | undefined): RawLensMetadata | null {
  if (!metadata) return null;
  const cameraMaker = rawMetadataString(metadata.normalized_make) || rawMetadataString(metadata.camera_make);
  const cameraModel = rawMetadataString(metadata.normalized_model) || rawMetadataString(metadata.camera_model);
  const lensInfo = metadata.lens;
  const makerNotes = lensInfo?.makernotes;
  const lensModel = rawMetadataString(lensInfo?.Lens) || rawMetadataString(makerNotes?.Lens);
  const lensMaker = rawMetadataString(lensInfo?.LensMake);
  const focal = rawMetadataPositiveNumber(metadata.focal_len) ?? rawMetadataPositiveNumber(makerNotes?.CurFocal);
  if (!cameraMaker || !cameraModel || !lensModel || !focal) return null;
  const aperture = rawMetadataPositiveNumber(metadata.aperture) ?? rawMetadataPositiveNumber(makerNotes?.CurAp);
  const equivalent35mm = rawMetadataPositiveNumber(makerNotes?.FocalLengthIn35mmFormat);
  const cropFactor = equivalent35mm && focal > 0 ? equivalent35mm / focal : undefined;
  return {
    cameraMaker,
    cameraModel,
    ...(lensMaker ? { lensMaker } : {}),
    lensModel,
    focal,
    ...(aperture ? { aperture } : {}),
    ...(cropFactor && Number.isFinite(cropFactor) && cropFactor > 0 ? { cropFactor } : {}),
  };
}

function rawLensLabelFromMetadata(metadata: RawLensMetadata): string {
  const lensMaker = typeof metadata.lensMaker === "string" ? metadata.lensMaker.trim() : "";
  const lensModel = typeof metadata.lensModel === "string" ? metadata.lensModel.trim() : "";
  if (!lensMaker) return lensModel;
  if (!lensModel) return lensMaker;
  return lensModel.toLowerCase().startsWith(lensMaker.toLowerCase())
    ? lensModel
    : `${lensMaker} ${lensModel}`;
}

function buildRawDevelopmentLensfunSettings(
  metadata: RawLensMetadata | null,
  correction: LensfunCorrection | undefined,
  width: number,
  height: number,
): RawDevelopmentLensfunSettings | undefined {
  if (!metadata && !correction) return undefined;

  const summary = correction ? summarizeLensfunCorrection(correction, width, height) : undefined;
  const name = summary?.lensLabel || (metadata ? rawLensLabelFromMetadata(metadata) : "");
  return {
    name,
    focal: summary?.focal ?? metadata?.focal ?? null,
    aperture: summary?.aperture ?? metadata?.aperture ?? null,
    cropFactor: summary?.cropFactor ?? metadata?.cropFactor ?? null,
    distortionPercent: summary?.distortionPercent ?? null,
    tcaRedPercent: summary?.tcaRedPercent ?? null,
    tcaBluePercent: summary?.tcaBluePercent ?? null,
    vignettingPercent: summary?.vignettingPercent ?? null,
    vignettingEv: summary?.vignettingEv ?? null,
  };
}

function pendingLensfunVignettingGain(
  decoded: DecodedRgbImage16,
  x: number,
  y: number,
): [number, number, number] {
  const correction = decoded.lensCorrection;
  if (!correction?.vignetting || correction.vignettingBaked) return [1, 1, 1];
  return lensfunVignettingGain(correction, x, y);
}

function finishLensfunVignettingBake(decoded: DecodedRgbImage16): void {
  const correction = decoded.lensCorrection;
  if (!correction?.vignetting) return;

  correction.vignettingBaked = true;
  delete correction.vignetting;
  if (!correction.distortion && !correction.tca) {
    decoded.lensCorrection = undefined;
  }
}

function libRawImageDataToDecoded(image: LibRawImageDataLike): DecodedRgbImage16 {
  const width = Math.max(1, Math.round(image.width || 0));
  const height = Math.max(1, Math.round(image.height || 0));
  const colors = Math.max(1, Math.round(image.colors || 3));
  const bits = Math.max(1, Math.round(image.bits || 8));
  const count = width * height;
  const src = image.data;
  const rgb = new Uint16Array(count * 3);

  for (let i = 0; i < count; i++) {
    const si = i * colors;
    const r = Number(src[si] ?? 0);
    const g = Number(src[si + (colors >= 2 ? 1 : 0)] ?? r);
    const b = Number(src[si + (colors >= 3 ? 2 : colors >= 2 ? 1 : 0)] ?? g);
    const di = i * 3;
    rgb[di] = scaleSampleTo16(r, bits);
    rgb[di + 1] = scaleSampleTo16(g, bits);
    rgb[di + 2] = scaleSampleTo16(b, bits);
  }

  return {
    colorSpace: "prophoto",
    transfer: "linear",
    linearRangeMax: 1,
    width,
    height,
    data: rgb,
    cleanup: () => {},
  };
}

function createLibRawWorkerFailure(raw: LibRawInstanceLike): {
  promise: Promise<never>;
  cleanup: () => void;
} {
  const worker = raw.worker;
  if (!worker) {
    return { promise: new Promise<never>(() => {}), cleanup: () => {} };
  }

  let onError: ((event: ErrorEvent) => void) | null = null;
  let onMessageError: (() => void) | null = null;
  const promise = new Promise<never>((_, reject) => {
    onError = (event) => reject(new Error(event.message || "RAW decoder failed"));
    onMessageError = () => reject(new Error("RAW decoder worker communication failed"));
    worker.addEventListener("error", onError);
    worker.addEventListener("messageerror", onMessageError);
  });

  return {
    promise,
    cleanup: () => {
      if (onError) worker.removeEventListener("error", onError);
      if (onMessageError) worker.removeEventListener("messageerror", onMessageError);
    },
  };
}

function rawMedianDenoisePassesForIso(iso: number): number {
  if (!Number.isFinite(iso) || iso <= 0) return 0;
  if (iso >= RAW_MEDIAN_DENOISE_STRONG_ISO) return 2;
  if (iso >= RAW_MEDIAN_DENOISE_WEAK_ISO) return 1;
  return 0;
}

function formatRawDevelopmentSetting(value: number): string {
  if (!Number.isFinite(value)) return "n/a";
  const normalized = Math.abs(value) < 0.0005 ? 0 : value;
  return normalized.toFixed(2).replace(/\.?0+$/, "");
}

function formatSignedLensfunValue(value: number, digits: number, suffix = ""): string {
  if (!Number.isFinite(value)) return "n/a";
  const threshold = 0.5 * 10 ** (-digits);
  const normalized = Math.abs(value) < threshold ? 0 : value;
  const sign = normalized > 0 ? "+" : normalized < 0 ? "-" : "";
  return `${sign}${Math.abs(normalized).toFixed(digits).replace(/\.?0+$/, "")}${suffix}`;
}

function formatRawDevelopmentLensfunCorrection(settings: RawDevelopmentLensfunSettings): string {
  const parts: string[] = [];
  if (settings.distortionPercent !== null) {
    parts.push(`distortion=${formatSignedLensfunValue(settings.distortionPercent, 1, "%")}`);
  }
  if (settings.tcaRedPercent !== null || settings.tcaBluePercent !== null) {
    parts.push(
      `TCA R=${settings.tcaRedPercent === null ? "n/a" : formatSignedLensfunValue(settings.tcaRedPercent, 3, "%")} B=${settings.tcaBluePercent === null ? "n/a" : formatSignedLensfunValue(settings.tcaBluePercent, 3, "%")}`,
    );
  }
  if (settings.vignettingPercent !== null || settings.vignettingEv !== null) {
    const gain = settings.vignettingPercent === null
      ? "n/a"
      : `${(1 + settings.vignettingPercent / 100).toFixed(3)}x`;
    const ev = settings.vignettingEv === null ? "n/a" : formatSignedLensfunValue(settings.vignettingEv, 2, "EV");
    parts.push(`vignetting=${gain} (${ev})`);
  }
  return parts.length ? parts.join(", ") : "unavailable";
}

function formatMemoryMiB(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(1)}MiB`;
}

const RAW_THUMBNAIL_DEBUG_STATISTICS_CACHE = new WeakMap<
  File,
  Promise<DebugPercentileStatistics | undefined>
>();

async function readRawThumbnailDebugStatisticsUncached(
  file: File,
): Promise<DebugPercentileStatistics | undefined> {
  let raw: LibRawInstanceLike | null = null;
  let workerFailure: ReturnType<typeof createLibRawWorkerFailure> | null = null;
  try {
    raw = await createLibRawInstance();
    workerFailure = createLibRawWorkerFailure(raw);
    await Promise.race([
      raw.open(new Uint8Array(await file.arrayBuffer())),
      workerFailure.promise,
    ]);
    if (!raw.thumbnailData) return undefined;
    const thumbnail = await Promise.race([raw.thumbnailData(), workerFailure.promise]);
    return await debugStatisticsFromRawThumbnail(thumbnail);
  } catch {
    return undefined;
  } finally {
    workerFailure?.cleanup();
    if (raw?.dispose) raw.dispose();
    else raw?.worker?.terminate();
  }
}

function readRawThumbnailDebugStatistics(
  file: File,
): Promise<DebugPercentileStatistics | undefined> {
  const cached = RAW_THUMBNAIL_DEBUG_STATISTICS_CACHE.get(file);
  if (cached) return cached;
  const pending = readRawThumbnailDebugStatisticsUncached(file);
  RAW_THUMBNAIL_DEBUG_STATISTICS_CACHE.set(file, pending);
  return pending;
}

async function decodeRawImage(
  file: File,
  rawDemosaicQuality?: RawDemosaicQuality,
  rawHighlightMode?: RawHighlightMode,
  onProgress?: ImageLoadProgressListener,
): Promise<DecodedRgbImage16> {
  const rawDevelopmentStartedAt = performance.now();
  async function runStage<T>(stage: string, task: () => Promise<T>): Promise<T> {
    onProgress?.({ stage });
    const startedAt = performance.now();
    try {
      return await task();
    } finally {
      if (onProgress) logImageLoadStage(file, stage.replace(/…$/, ""), startedAt);
    }
  }
  async function runBlockingStage<T>(stage: string, task: () => T): Promise<T> {
    onProgress?.({ stage });
    if (onProgress) {
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
    }
    const startedAt = performance.now();
    try {
      return task();
    } finally {
      if (onProgress) logImageLoadStage(file, stage.replace(/…$/, ""), startedAt);
    }
  }

  let raw: LibRawInstanceLike | null = null;
  let workerFailure: ReturnType<typeof createLibRawWorkerFailure> | null = null;
  try {
    raw = await runStage("Loading RAW decoder…", () => createLibRawInstance());
    workerFailure = createLibRawWorkerFailure(raw);
    const rawBytes = await runStage("Reading file…", async () => new Uint8Array(await file.arrayBuffer()));
    const rawDecodeSettings: LibRawSettingsLike = {
      ...RAW_DECODE_SETTINGS,
      ...(rawDemosaicQuality === undefined ? {} : { userQual: rawDemosaicQuality }),
      ...(rawHighlightMode === undefined ? {} : { highlight: rawHighlightMode }),
    };
    await runStage("Opening RAW…", () => Promise.race([
      raw!.open(rawBytes, rawDecodeSettings),
      workerFailure!.promise,
    ]));

    const metadata = await runStage("Reading metadata…", () => Promise.race([
      raw!.metadata(true),
      workerFailure!.promise,
    ]));
    const isoValue = Number(metadata?.iso_speed);
    const medPasses = rawMedianDenoisePassesForIso(isoValue);

    let thumbnailReference: RawThumbnailMatchReference | undefined;
    if (raw.thumbnailData) {
      try {
        const thumbnail = await runStage("Reading preview…", () => Promise.race([
          raw!.thumbnailData!(),
          workerFailure!.promise,
        ]));
        const embeddedPreview = onProgress
          ? await runStage("Preparing preview…", () => rawEmbeddedPreviewFromThumbnail(thumbnail))
          : undefined;
        onProgress?.({ stage: "Analyzing preview…", embeddedPreview });
        const startedAt = performance.now();
        try {
          thumbnailReference = await rawThumbnailMatchReferenceFromThumbnail(thumbnail);
        } finally {
          if (onProgress) logImageLoadStage(file, "Analyzing preview", startedAt);
        }
      } catch {
        thumbnailReference = undefined;
      }
    }

    // LibRaw-Wasm transfers the Uint8Array's backing ArrayBuffer to its Worker
    // on open(), which detaches rawBytes in this thread. If ISO metadata enables
    // medPasses, obtain a fresh buffer for the second open instead of reusing the
    // detached one.
    if (medPasses > 0) {
      const denoiseRawBytes = await runStage("Reading file again…", async () =>
        new Uint8Array(await file.arrayBuffer()),
      );
      await runStage("Reopening RAW…", () => Promise.race([
        raw!.open(denoiseRawBytes, { ...rawDecodeSettings, medPasses }),
        workerFailure!.promise,
      ]));
    }

    const image = await runStage("Demosaicing…", () => Promise.race([
      raw!.imageData(),
      workerFailure!.promise,
    ]));
    if (!image || !image.width || !image.height || !image.data) {
      throw new Error("RAW decode failed");
    }

    const decoded = await runBlockingStage("Converting pixels…", () => libRawImageDataToDecoded(image));
    const lensMetadata = rawLensMetadata(metadata);
    decoded.lensCorrection = await runStage("Correcting lens…", () => buildRawLensfunCorrection(
      lensMetadata,
      decoded.width,
      decoded.height,
    ));
    // Capture the effective Lensfun values while every generated map is still
    // present. Vignetting is baked into the RAW pixels during baseline tone
    // processing and its map is then discarded to release memory.
    const lensfunSettings = buildRawDevelopmentLensfunSettings(
      lensMetadata,
      decoded.lensCorrection,
      decoded.width,
      decoded.height,
    );
    let mode: RawDevelopmentSettings["mode"] = "fallback";
    let luminanceSettings: RawDevelopmentLuminanceSettings | null = null;
    let headroomSettings: RawDevelopmentHeadroomStatistics | undefined;
    let saturationSettings: RawDevelopmentSaturationSettings = {
      saturation: 0,
      vibrance: 0,
    };
    if (thumbnailReference) {
      const matchedBaseline = await runBlockingStage("Developing tone…", () =>
        applyRawThumbnailMatchedBaseline(decoded, thumbnailReference.lumaPercentiles),
      );
      if (matchedBaseline) {
        mode = "thumbnail-match";
        luminanceSettings = matchedBaseline.luminance;
        headroomSettings = matchedBaseline.headroom;
        // Match color only after the thumbnail-driven tone baseline is fixed.
        // Saturation follows HSV P95 first, then Vibrance follows HSV P50.
        saturationSettings = await runBlockingStage("Developing color…", () =>
          applyRawThumbnailMatchedColor(decoded, thumbnailReference.linearSrgbSample),
        ) ?? saturationSettings;
      } else {
        const fallbackBaseline = await runBlockingStage("Developing tone…", () =>
          applyRawBaselineExposure(decoded),
        );
        luminanceSettings = fallbackBaseline?.luminance ?? null;
        headroomSettings = fallbackBaseline?.headroom;
      }
    } else {
      const fallbackBaseline = await runBlockingStage("Developing tone…", () =>
        applyRawBaselineExposure(decoded),
      );
      luminanceSettings = fallbackBaseline?.luminance ?? null;
      headroomSettings = fallbackBaseline?.headroom;
    }
    await runBlockingStage("Encoding buffer…", () => convertDecodedRgb16Transfer(decoded, "gamma20"));
    decoded.rawDevelopment = {
      mode,
      iso: Number.isFinite(isoValue) && isoValue > 0 ? isoValue : null,
      medPasses,
      luminance: luminanceSettings,
      saturation: saturationSettings,
      headroom: headroomSettings,
      lensfun: lensfunSettings,
      elapsedSeconds: (performance.now() - rawDevelopmentStartedAt) / 1000,
    };
    if (onProgress) {
      console.info(
        `[image-editor load] ${file.name}: RAW total ${(performance.now() - rawDevelopmentStartedAt).toFixed(1)}ms`,
      );
    }
    return decoded;
  } finally {
    workerFailure?.cleanup();
    if (raw?.dispose) raw.dispose();
    else raw?.worker?.terminate();
  }
}

// RAW development is expensive and React Strict Mode may start the same editor effect
// twice in development. Share only the in-flight Promise; the durable decoded result is
// owned by ImageUploadDialog's one-entry RAW development cache.
type RawDevelopmentInFlightEntry = {
  promise: Promise<DecodedRgbImage16>;
  listeners: Set<ImageLoadProgressListener>;
  lastProgress?: ImageLoadProgress;
};

const RAW_DEVELOPMENT_IN_FLIGHT = new WeakMap<
  File,
  Map<string, RawDevelopmentInFlightEntry>
>();

function decodeRawImageShared(
  file: File,
  rawDemosaicQuality?: RawDemosaicQuality,
  rawHighlightMode?: RawHighlightMode,
  onProgress?: ImageLoadProgressListener,
): Promise<DecodedRgbImage16> {
  const key = `${rawDemosaicQuality ?? "default"}:${rawHighlightMode ?? "default"}`;
  let pendingByQuality = RAW_DEVELOPMENT_IN_FLIGHT.get(file);
  if (!pendingByQuality) {
    pendingByQuality = new Map();
    RAW_DEVELOPMENT_IN_FLIGHT.set(file, pendingByQuality);
  }
  const existing = pendingByQuality.get(key);
  if (existing) {
    if (onProgress) {
      existing.listeners.add(onProgress);
      if (existing.lastProgress) onProgress(existing.lastProgress);
    }
    return existing.promise;
  }

  const entry: RawDevelopmentInFlightEntry = {
    promise: Promise.resolve(null as unknown as DecodedRgbImage16),
    listeners: new Set(onProgress ? [onProgress] : []),
  };
  const emitProgress: ImageLoadProgressListener = (progress) => {
    entry.lastProgress = progress;
    for (const listener of entry.listeners) listener(progress);
  };
  const promise = decodeRawImage(
    file,
    rawDemosaicQuality,
    rawHighlightMode,
    onProgress ? emitProgress : undefined,
  ).finally(() => {
      const current = RAW_DEVELOPMENT_IN_FLIGHT.get(file);
      if (current?.get(key) === entry) {
        current.delete(key);
        if (current.size === 0) RAW_DEVELOPMENT_IN_FLIGHT.delete(file);
      }
      entry.listeners.clear();
    });
  entry.promise = promise;
  pendingByQuality.set(key, entry);
  return promise;
}

function canvasSourceToDecodedRgb16(
  source: CanvasImageSource,
  width: number,
  height: number,
  sourceColorProfile: ImageEditOutputColorProfile,
): DecodedRgbImage16 {
  const canvas = createImageEditCanvas(width, height);
  try {
    const ctx = getCanvas2dContext(canvas, sourceColorProfile, true);
    if (!ctx) throw new Error("2D context unavailable");
    ctx.drawImage(source, 0, 0, width, height);

    const rgb16 = new Uint16Array(width * height * 3);
    const targetChunkBytes = 4 * 1024 * 1024;
    const rowsPerChunk = Math.max(1, Math.floor(targetChunkBytes / Math.max(4, width * 4)));
    for (let y = 0; y < height; y += rowsPerChunk) {
      const chunkHeight = Math.min(rowsPerChunk, height - y);
      const rgba8 = getCanvasImageData(
        ctx,
        0,
        y,
        width,
        chunkHeight,
        sourceColorProfile,
      ).data;
      writeRgba8ToDecodedRgb16(
        rgba8,
        rgb16,
        y * width,
        sourceColorProfile,
      );
    }
    return {
      colorSpace: "prophoto",
      transfer: "gamma20",
      linearRangeMax: 1,
      width,
      height,
      data: rgb16,
      cleanup: () => {},
    };
  } finally {
    releaseCanvasIfNeeded(canvas);
  }
}


async function decodeTiffImage(file: File): Promise<DecodedRgbImage16> {
  const UTIF: typeof import("utif") = await import("utif");
  const buf = await file.arrayBuffer();
  const ifds = UTIF.decode(buf);
  if (!ifds || ifds.length === 0) throw new Error("TIFF decode failed: no IFD");
  const originalIfd = ifds[0];
  UTIF.decodeImage(buf, originalIfd);
  const ifd = originalIfd as unknown as TiffIfdLike;
  const width = Math.max(0, Math.round(Number(ifd.width ?? ifd.t256?.[0] ?? 0)));
  const height = Math.max(0, Math.round(Number(ifd.height ?? ifd.t257?.[0] ?? 0)));
  if (!width || !height) throw new Error("TIFF decode failed: invalid size");
  const profile = tiffInputColorProfile(ifd);
  const native = nativeRgbTiffToDecodedRgb16(ifd, profile);
  if (native) return native;

  // Preserve support for non-RGB / unusual TIFF layouts through UTIF's existing
  // universal RGBA8 converter, but immediately normalize that result into the
  // common 16-bit ProPhoto/gamma20 RGB editing container.
  const rgba = UTIF.toRGBA8(originalIfd);
  return rgba8ToDecodedRgb16(rgba, width, height, profile);
}

async function decodeImage(
  file: File,
  srcW = 0,
  srcH = 0,
  name?: string,
  type?: string,
  rawDemosaicQuality?: RawDemosaicQuality,
  rawHighlightMode?: RawHighlightMode,
  onProgress?: ImageLoadProgressListener,
): Promise<DecodedImage> {
  async function runStage<T>(stage: string, task: () => Promise<T>): Promise<T> {
    onProgress?.({ stage });
    const startedAt = performance.now();
    try {
      return await task();
    } finally {
      if (onProgress) logImageLoadStage(file, stage.replace(/…$/, ""), startedAt);
    }
  }
  async function runBlockingStage<T>(stage: string, task: () => T): Promise<T> {
    onProgress?.({ stage });
    if (onProgress) {
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
    }
    const startedAt = performance.now();
    try {
      return task();
    } finally {
      if (onProgress) logImageLoadStage(file, stage.replace(/…$/, ""), startedAt);
    }
  }

  if (isRawImageFile(name || "", type || "")) {
    return decodeRawImageShared(file, rawDemosaicQuality, rawHighlightMode, onProgress);
  }

  if (isTiff(name || "", type || "")) {
    return runStage("Decoding TIFF…", () => decodeTiffImage(file));
  }

  if (isSvg(name || "", type || "")) {
    const svgText = await runStage("Reading SVG…", () => file.text());
    let size = parseSvgSize(svgText);
    if (!size) {
      const fallback = Math.max(1, Number(Config.IMAGE_OPTIMIZE_TARGET_LONGSIDE) || 1200);
      size = { w: fallback, h: fallback };
    }
    const normalizedSvg = normalizeSvg(svgText, size.w, size.h);
    const svgBlob = new Blob([normalizedSvg], { type: "image/svg+xml" });
    try {
      const bmp = await runStage("Decoding image…", () =>
        createImageBitmap(svgBlob, { colorSpaceConversion: "default" }),
      );
      try {
        return await runBlockingStage("Converting pixels…", () => canvasSourceToDecodedRgb16(
          bmp,
          bmp.width || size!.w,
          bmp.height || size!.h,
          "srgb",
        ));
      } finally {
        bmp.close?.();
      }
    } catch {
      const url = URL.createObjectURL(svgBlob);
      try {
        const img = document.createElement("img");
        img.decoding = "async";
        const ok = await runStage("Decoding image…", () => new Promise<boolean>((resolve) => {
          img.onload = () => resolve(true);
          img.onerror = () => resolve(false);
          img.src = url;
        }));
        if (!ok) throw new Error("svg decode via <img> failed");
        return await runBlockingStage("Converting pixels…", () => canvasSourceToDecodedRgb16(
          img,
          img.naturalWidth || size!.w,
          img.naturalHeight || size!.h,
          "srgb",
        ));
      } finally {
        URL.revokeObjectURL(url);
      }
    }
  }

  // Browser decoders handle JPEG/WebP/PNG/HEIF and embedded ICC/nclx metadata.
  // Rasterize once into an explicit sRGB or Display-P3 8-bit Canvas, then
  // immediately normalize into the common ProPhoto/gamma2.0 Uint16 container.
  // 8-bit inputs do not gain source precision, but all subsequent editor math
  // shares the same 16-bit source representation as RAW/TIFF.
  const decodeColorProfile = await runStage("Detecting color…", () =>
    detectEditableImageColorProfile(file),
  );
  try {
    const bmp = await runStage("Decoding image…", () =>
      createImageBitmap(file, { colorSpaceConversion: "default" }),
    );
    try {
      return await runBlockingStage("Converting pixels…", () => canvasSourceToDecodedRgb16(
        bmp,
        bmp.width || srcW,
        bmp.height || srcH,
        decodeColorProfile,
      ));
    } finally {
      bmp.close?.();
    }
  } catch {
    const img = await runStage("Decoding image…", () => decodeViaImg(file));
    return await runBlockingStage("Converting pixels…", () => canvasSourceToDecodedRgb16(
      img,
      img.naturalWidth || srcW,
      img.naturalHeight || srcH,
      decodeColorProfile,
    ));
  }
}

export type ImageEditPreparedVariant = {
  canvas: HTMLCanvasElement | OffscreenCanvas;
  width: number;
  height: number;
  colorProfile: ImageEditOutputColorProfile;
};

function createImageEditCanvas(width: number, height: number): HTMLCanvasElement | OffscreenCanvas {
  const OSC = getOffscreenCanvasCtor();
  if (OSC) return new OSC(width, height);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

function releaseCanvasIfNeeded(canvas: HTMLCanvasElement | OffscreenCanvas): void {
  canvas.width = 0;
  canvas.height = 0;
}

async function buildEditedVariantFromDecoded(
  decoded: DecodedRgbImage16,
  params: ImageEditParams,
  outputColorProfile: ImageEditOutputColorProfile,
): Promise<ImageEditPreparedVariant> {
  const w = decoded.width;
  const h = decoded.height;
  const crop = normalizeCrop(params.crop);
  const sx = Math.max(0, Math.min(w - 1, Math.round(w * crop.left)));
  const sy = Math.max(0, Math.min(h - 1, Math.round(h * crop.top)));
  const ex = Math.max(sx + 1, Math.min(w, Math.round(w * (1 - crop.right))));
  const ey = Math.max(sy + 1, Math.min(h, Math.round(h * (1 - crop.bottom))));
  const sw = Math.max(1, ex - sx);
  const sh = Math.max(1, ey - sy);
  const dw = Math.max(1, Math.round(sw * params.resizePercent / 100));
  const dh = Math.max(1, Math.round(sh * params.resizePercent / 100));
  if (params.textOverlays.length > 0) {
    await ensureTextOverlayFontsReady(params.textOverlays);
  }

  // Keep the common ProPhoto/gamma2.0 Uint16 RGB source representation through crop/rotation
  // sampling, all tone/color math, and output-primary conversion. Quantize only when
  // the result must cross the browser's 8-bit Canvas ImageData boundary. When resize is
  // effectively 1:1, render straight into the output canvas instead of allocating and
  // copying an equally-sized intermediate canvas.
  const output = createImageEditCanvas(dw, dh);
  if (dw === sw && dh === sh) {
    renderAdjustedRgb16ToCanvas(
      output,
      decoded,
      { x: sx, y: sy, w: sw, h: sh },
      params.rotationDegrees,
      params.temperature,
      params.tint,
      params.exposureEv,
      params.shadow,
      params.highlight,
      params.scaledLog,
      params.sigmoid,
      params.vibrance,
      params.saturation,
      outputColorProfile,
    );
  } else {
    const cropped = createImageEditCanvas(sw, sh);
    try {
      renderAdjustedRgb16ToCanvas(
        cropped,
        decoded,
        { x: sx, y: sy, w: sw, h: sh },
        params.rotationDegrees,
        params.temperature,
        params.tint,
        params.exposureEv,
        params.shadow,
        params.highlight,
        params.scaledLog,
        params.sigmoid,
        params.vibrance,
        params.saturation,
        outputColorProfile,
      );
      const outputCtx = getCanvas2dContext(output, outputColorProfile);
      if (!outputCtx) throw new Error("2D context unavailable");
      outputCtx.imageSmoothingEnabled = true;
      outputCtx.imageSmoothingQuality = "high";
      outputCtx.drawImage(cropped, 0, 0, sw, sh, 0, 0, dw, dh);
    } finally {
      releaseCanvasIfNeeded(cropped);
    }
  }

  const outputCtx = getCanvas2dContext(output, outputColorProfile);
  if (!outputCtx) throw new Error("2D context unavailable");
  applySharpenToCanvas(output, params.sharpen, outputColorProfile);
  applyMosaicRectsToCanvas(
    output,
    mosaicRegionsToOutputRects(params.mosaicRegions, w, h, sx, sy, sw, sh, dw, dh),
    16,
    outputColorProfile,
  );
  drawOverlaysToContext(
    outputCtx,
    params.drawOverlays,
    w,
    h,
    sw,
    sh,
    dw,
    dh,
  );
  drawTextOverlaysToContext(
    outputCtx,
    params.textOverlays,
    w,
    h,
    sw,
    sh,
    dw,
    dh,
    outputColorProfile,
  );
  return { canvas: output, width: dw, height: dh, colorProfile: outputColorProfile };
}

export async function buildEditedVariant(
  file: File,
  srcW: number,
  srcH: number,
  name?: string,
  type?: string,
  edit?: ImageEditParams,
  decodedImage?: DecodedImage,
  outputColorProfile: ImageEditOutputColorProfile = "srgb",
  rawDemosaicQuality?: RawDemosaicQuality,
): Promise<ImageEditPreparedVariant> {
  const params = normalizeEditParams(edit, srcW, srcH);
  const ownsDecodedImage = !decodedImage;
  const decoded = decodedImage ?? await decodeImage(
    file,
    srcW,
    srcH,
    name,
    type,
    rawDemosaicQuality,
  );
  try {
    return await buildEditedVariantFromDecoded(decoded, params, outputColorProfile);
  } finally {
    if (ownsDecodedImage) decoded.cleanup();
  }
}

async function encodeImageEditCanvas(
  canvas: HTMLCanvasElement | OffscreenCanvas,
  outputFormat: ImageEditOutputFormat,
  quality: number,
): Promise<Blob> {
  if ("convertToBlob" in canvas) {
    type EncodeOpts = { type?: string; quality?: number };
    const conv = (canvas as OffscreenCanvas & { convertToBlob(options?: EncodeOpts): Promise<Blob> }).convertToBlob;
    return conv.call(canvas, { type: outputFormat, quality });
  }
  return new Promise<Blob>((resolve, reject) =>
    (canvas as HTMLCanvasElement).toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("toBlob returned null"))),
      outputFormat,
      quality,
    ),
  );
}

export async function encodeEditedVariant(
  prepared: ImageEditPreparedVariant,
  quality = 0.8,
  outputFormat: ImageEditOutputFormat = "image/webp",
  outputColorProfile: ImageEditOutputColorProfile = prepared.colorProfile,
): Promise<{ blob: Blob; width: number; height: number }> {
  if (prepared.colorProfile === outputColorProfile) {
    const blob = await encodeImageEditCanvas(prepared.canvas, outputFormat, quality);
    return { blob, width: prepared.width, height: prepared.height };
  }

  const converted = createImageEditCanvas(prepared.width, prepared.height);
  try {
    const ctx = getCanvas2dContext(converted, outputColorProfile);
    if (!ctx) throw new Error("2D context unavailable");
    ctx.drawImage(prepared.canvas, 0, 0, prepared.width, prepared.height);
    const blob = await encodeImageEditCanvas(converted, outputFormat, quality);
    return { blob, width: prepared.width, height: prepared.height };
  } finally {
    releaseCanvasIfNeeded(converted);
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
  decodedImage?: DecodedImage,
  outputColorProfile?: ImageEditOutputColorProfile,
): Promise<{ blob: Blob; width: number; height: number }> {
  const resolvedOutputColorProfile =
    outputColorProfile ?? (await detectBestEditableImageOutputColorProfile(file));
  const prepared = await buildEditedVariant(
    file,
    srcW,
    srcH,
    name,
    type,
    edit,
    decodedImage,
    resolvedOutputColorProfile,
  );
  try {
    return await encodeEditedVariant(prepared, quality, outputFormat, resolvedOutputColorProfile);
  } finally {
    releaseCanvasIfNeeded(prepared.canvas);
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
  initialDecodedImage?: DecodedImage;
  rawDemosaicQuality?: RawDemosaicQuality;
  rawHighlightMode?: RawHighlightMode;
  onRawDevelopmentReady?: (decodedImage: DecodedRgbImage16) => void;
  onCancel: () => void;
  onApply: (params: ImageEditParams, decodedImage?: DecodedImage) => void;
  onError?: (message: string) => void;
};

type EditRect = { x: number; y: number; w: number; h: number };
type EditCorner = "nw" | "ne" | "sw" | "se";
type DrawHandle = EditCorner | "start" | "end";
type DrawCreateState = {
  pointerId: number;
  startPoint: EditPoint;
  type: ImageDrawTool;
  strokeWidth: number;
  colorIndex: number;
};
type DrawEditState =
  | {
      mode: "move";
      pointerId: number;
      id: string;
      startPoint: EditPoint;
      startOverlay: ImageDrawOverlay;
    }
  | {
      mode: "handle";
      pointerId: number;
      id: string;
      handle: DrawHandle;
      startOverlay: ImageDrawOverlay;
    };
type TextOverlayLayout = {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  fontSize: number;
  lineHeight: number;
  text: string;
  fontIndex: number;
  colorIndex: number;
  outlineColorIndex: number | null;
};

type PercentileDebugData = {
  input: DebugPercentileStatistics;
  thumbnail?: DebugPercentileStatistics;
  output: DebugPercentileStatistics;
};
const EDIT_PREVIEW_MARGIN_PX = 8;
const TEXT_OVERLAY_DEFAULT_FONT_SIZE_RATIO = 0.05;
const TEXT_OVERLAY_FONT_STEP = Math.pow(2, 1 / 8);
const TEXT_OVERLAY_FONTS = [
  { name: "Noto Sans JP", family: '"Noto Sans JP", sans-serif', loadFamily: '"Noto Sans JP"', weight: 400 },
  { name: "Noto Serif JP", family: '"Noto Serif JP", serif', loadFamily: '"Noto Serif JP"', weight: 400 },
  { name: "Klee One", family: '"Klee One", serif', loadFamily: '"Klee One"', weight: 400 },
  { name: "Dela Gothic One", family: '"Dela Gothic One", sans-serif', loadFamily: '"Dela Gothic One"', weight: 400 },
  { name: "Zen Old Mincho Black", family: '"Zen Old Mincho", serif', loadFamily: '"Zen Old Mincho"', weight: 900 },
] as const;
const TEXT_OVERLAY_LINE_HEIGHT = 1.2;
const TEXT_OVERLAY_TEXT_INSET_X_EM = 0.09;
const TEXT_OVERLAY_TEXT_INSET_Y_EM = 0.06;
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
const DRAW_STROKE_WIDTH_RATIOS = [0.001, 0.002, 0.004, 0.008] as const;
const DRAW_STROKE_WIDTH_LABELS = ["Thin", "Medium", "Thick", "Extra thick"] as const;
const TEXT_OVERLAY_MIN_BOX_WIDTH =
  TEXT_OVERLAY_CONTROL_BUTTON_SIZE * 6 +
  TEXT_OVERLAY_CONTROL_GAP * 5 +
  TEXT_OVERLAY_DELETE_BUTTON_SIZE +
  TEXT_OVERLAY_CONTROL_SAFE_GAP;

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

export function ImageEditDialog({
  file,
  initialParams,
  defaultParams,
  initialDecodedImage,
  rawDemosaicQuality,
  rawHighlightMode,
  onRawDevelopmentReady,
  onCancel,
  onApply,
  onError,
}: EditDialogProps) {
  const [mounted, setMounted] = useState(false);
  const [imageReady, setImageReady] = useState(false);
  const [loadingStage, setLoadingStage] = useState<string | null>("Loading image…");
  const [embeddedRawPreview, setEmbeddedRawPreview] = useState<{
    url: string;
    width: number;
    height: number;
  } | null>(null);
  const embeddedRawPreviewUrlRef = useRef<string | null>(null);
  const initialPreviewReadyRef = useRef(false);
  const [natural, setNatural] = useState<{ w: number; h: number } | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const previewCanvasRef = useRef<HTMLCanvasElement>(null);
  const previewRenderedRef = useRef<{
    decoded: DecodedRgbImage16;
    width: number;
    height: number;
    key: string;
  } | null>(null);
  const decodedImageRef = useRef<DecodedImage | null>(null);
  const transferredDecodedImageRef = useRef<DecodedImage | null>(null);
  const onErrorRef = useRef(onError);
  const onRawDevelopmentReadyRef = useRef(onRawDevelopmentReady);
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
  const [shadow, setShadow] = useState<number>(clampToneRangeAdjustment(initialParams.shadow ?? 0));
  const [highlight, setHighlight] = useState<number>(clampToneRangeAdjustment(initialParams.highlight ?? 0));
  const [scaledLog, setScaledLog] = useState<number>(clampScaledLog(initialParams.scaledLog));
  const [sigmoid, setSigmoid] = useState<number>(clampSigmoid(initialParams.sigmoid));
  const [vibrance, setVibrance] = useState<number>(clampColorAdjustment(initialParams.vibrance));
  const [saturation, setSaturation] = useState<number>(clampColorAdjustment(initialParams.saturation));
  const [resizePercent, setResizePercent] = useState<number>(
    Math.min(100, Math.max(1, Math.round(initialParams.resizePercent))),
  );
  const [sharpen, setSharpen] = useState<number>(clampSharpen(initialParams.sharpen ?? 0));
  const [previewSharpenSuppressed, setPreviewSharpenSuppressed] = useState(false);
  const [textMode, setTextMode] = useState(false);
  const [textOverlays, setTextOverlays] = useState<ImageTextOverlay[]>(
    normalizeTextOverlays(initialParams.textOverlays),
  );
  const [activeTextId, setActiveTextId] = useState<string | null>(null);
  const [fontLoadingTextId, setFontLoadingTextId] = useState<string | null>(null);
  const [drawMode, setDrawMode] = useState(false);
  const [drawTool, setDrawTool] = useState<ImageDrawTool>("line");
  const [drawStrokeWidthIndex, setDrawStrokeWidthIndex] = useState(1);
  const [drawColorIndex, setDrawColorIndex] = useState(0);
  const [drawOverlays, setDrawOverlays] = useState<ImageDrawOverlay[]>(
    normalizeDrawOverlays(initialParams.drawOverlays),
  );
  const [drawDraft, setDrawDraft] = useState<ImageDrawOverlay | null>(null);
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
  const [showPercentileDebug, setShowPercentileDebug] = useState(false);
  const [percentileDebug, setPercentileDebug] = useState<PercentileDebugData | null>(null);
  const [rawThumbnailDebugStatistics, setRawThumbnailDebugStatistics] = useState<DebugPercentileStatistics | undefined>(undefined);
  const [rawDevelopmentMemoryUsage, setRawDevelopmentMemoryUsage] = useState<RawDevelopmentMemoryUsage | undefined>(undefined);
  const [showGrid, setShowGrid] = useState(false);
  const [histogram, setHistogram] = useState<HistogramData | null>(null);
  const [histogramGeometryDragging, setHistogramGeometryDragging] = useState(false);
  const [eyedropperMode, setEyedropperMode] = useState(false);
  const [autoToneBusy, setAutoToneBusy] = useState(false);
  const [applyBusy, setApplyBusy] = useState(false);
  const applyPendingRef = useRef(false);
  const percentilePanelRef = useRef<HTMLDivElement | null>(null);
  const activeTextBoxRef = useRef<HTMLDivElement | null>(null);
  const textMoveState = useRef<
    | null
    | { pointerId: number; id: string; offsetX: number; offsetY: number }
  >(null);
  const drawCreateState = useRef<DrawCreateState | null>(null);
  const drawEditState = useRef<DrawEditState | null>(null);
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
    onErrorRef.current = onError;
  }, [onError]);

  useEffect(() => {
    onRawDevelopmentReadyRef.current = onRawDevelopmentReady;
  }, [onRawDevelopmentReady]);

  const clearEmbeddedRawPreview = useCallback(() => {
    const currentUrl = embeddedRawPreviewUrlRef.current;
    embeddedRawPreviewUrlRef.current = null;
    setEmbeddedRawPreview(null);
    if (currentUrl) URL.revokeObjectURL(currentUrl);
  }, []);

  const showEmbeddedRawPreview = useCallback((preview: ImageLoadEmbeddedPreview) => {
    const nextUrl = URL.createObjectURL(preview.blob);
    const previousUrl = embeddedRawPreviewUrlRef.current;
    embeddedRawPreviewUrlRef.current = nextUrl;
    setEmbeddedRawPreview({
      url: nextUrl,
      width: preview.width,
      height: preview.height,
    });
    if (previousUrl) URL.revokeObjectURL(previousUrl);
  }, []);

  useEffect(() => {
    if (!showPercentileDebug) return;
    const onDocumentClick = (event: MouseEvent) => {
      const panel = percentilePanelRef.current;
      if (panel && event.target instanceof Node && !panel.contains(event.target)) {
        setShowPercentileDebug(false);
      }
    };
    document.addEventListener("click", onDocumentClick);
    return () => document.removeEventListener("click", onDocumentClick);
  }, [showPercentileDebug]);

  useEffect(() => {
    let cancelled = false;
    let decodedForEffect: DecodedImage | null = null;
    let cleanup: (() => void) | null = null;
    const ownsDecodedImage = !initialDecodedImage;
    const interactiveLoadStartedAt = performance.now();
    initialPreviewReadyRef.current = false;
    setImageReady(false);
    setLoadingStage(initialDecodedImage ? "Preparing preview…" : "Loading image…");
    clearEmbeddedRawPreview();
    setNatural(null);
    setShowPercentileDebug(false);
    setPercentileDebug(null);
    setRawThumbnailDebugStatistics(undefined);
    setRawDevelopmentMemoryUsage(undefined);
    decodedImageRef.current = null;
    transferredDecodedImageRef.current = null;
    previewRenderedRef.current = null;

    const onLoadProgress: ImageLoadProgressListener = (progress) => {
      if (cancelled) return;
      setLoadingStage(progress.stage);
      if (progress.embeddedPreview) {
        showEmbeddedRawPreview(progress.embeddedPreview);
      }
    };

    void (async () => {
      try {
        if (initialDecodedImage) {
          console.info(`[image-editor load] ${file.name}: using cached decode`);
        }
        const decoded = initialDecodedImage ?? await decodeImage(
          file,
          0,
          0,
          file.name,
          file.type,
          rawDemosaicQuality,
          rawHighlightMode,
          onLoadProgress,
        );
        decodedForEffect = decoded;
        if (isRawImageFile(file.name, file.type)) {
          onRawDevelopmentReadyRef.current?.(decoded);
        }
        if (cancelled) {
          if (
            ownsDecodedImage &&
            !(isRawImageFile(file.name, file.type) && onRawDevelopmentReadyRef.current)
          ) {
            decoded.cleanup();
          }
          return;
        }
        cleanup = decoded.cleanup;
        decodedImageRef.current = decoded;
        setLoadingStage("Preparing preview…");
        setNatural({ w: decoded.width, h: decoded.height });
        setImageReady(true);
        console.info(
          `[image-editor load] ${file.name}: decoded ${(performance.now() - interactiveLoadStartedAt).toFixed(1)}ms total`,
        );
      } catch (error) {
        if (!cancelled) {
          decodedImageRef.current = null;
          setNatural(null);
          setImageReady(false);
          setLoadingStage(null);
          clearEmbeddedRawPreview();
          onErrorRef.current?.(error instanceof Error ? error.message : String(error));
        }
      }
    })();

    return () => {
      cancelled = true;
      decodedImageRef.current = null;
      const embeddedPreviewUrl = embeddedRawPreviewUrlRef.current;
      embeddedRawPreviewUrlRef.current = null;
      if (embeddedPreviewUrl) URL.revokeObjectURL(embeddedPreviewUrl);
      if (
        ownsDecodedImage &&
        !(
          decodedForEffect &&
          isRawImageFile(file.name, file.type) &&
          onRawDevelopmentReadyRef.current
        ) &&
        (!decodedForEffect || transferredDecodedImageRef.current !== decodedForEffect)
      ) {
        cleanup?.();
      }
      transferredDecodedImageRef.current = null;
    };
  }, [
    file,
    initialDecodedImage,
    rawDemosaicQuality,
    rawHighlightMode,
    clearEmbeddedRawPreview,
    showEmbeddedRawPreview,
  ]);

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

  const clampPointToCropRect = useCallback((point: EditPoint): EditPoint => ({
    x: Math.max(cropRect.x, Math.min(cropRect.x + cropRect.w, point.x)),
    y: Math.max(cropRect.y, Math.min(cropRect.y + cropRect.h, point.y)),
  }), [cropRect]);

  const cropPointToNormalized = useCallback((point: EditPoint): EditPoint | null => {
    if (displayed.w <= 0 || displayed.h <= 0) return null;
    return {
      x: clamp01((point.x - cropRect.x) / displayed.w),
      y: clamp01((point.y - cropRect.y) / displayed.h),
    };
  }, [cropRect.x, cropRect.y, displayed.h, displayed.w]);

  const normalizedToCropPoint = useCallback((x: number, y: number): EditPoint => ({
    x: cropRect.x + x * displayed.w,
    y: cropRect.y + y * displayed.h,
  }), [cropRect.x, cropRect.y, displayed.h, displayed.w]);

  const constrainDrawEndPoint = useCallback((
    type: ImageDrawTool,
    start: EditPoint,
    rawEnd: EditPoint,
    constrain: boolean,
  ): EditPoint => {
    const end = clampPointToCropRect(rawEnd);
    if (!constrain) return end;

    const dx = end.x - start.x;
    const dy = end.y - start.y;
    if (type === "line") {
      const length = Math.hypot(dx, dy);
      if (length <= 0) return end;
      const step = Math.PI / 4;
      const angle = Math.round(Math.atan2(dy, dx) / step) * step;
      const ux = Math.cos(angle);
      const uy = Math.sin(angle);
      let maxLength = Number.POSITIVE_INFINITY;
      if (ux > 1e-9) maxLength = Math.min(maxLength, (cropRect.x + cropRect.w - start.x) / ux);
      else if (ux < -1e-9) maxLength = Math.min(maxLength, (cropRect.x - start.x) / ux);
      if (uy > 1e-9) maxLength = Math.min(maxLength, (cropRect.y + cropRect.h - start.y) / uy);
      else if (uy < -1e-9) maxLength = Math.min(maxLength, (cropRect.y - start.y) / uy);
      const snappedLength = Math.max(0, Math.min(length, maxLength));
      return { x: start.x + ux * snappedLength, y: start.y + uy * snappedLength };
    }

    const signX = dx < 0 ? -1 : 1;
    const signY = dy < 0 ? -1 : 1;
    const wantedSize = Math.max(Math.abs(dx), Math.abs(dy));
    const availableX = signX > 0 ? cropRect.x + cropRect.w - start.x : start.x - cropRect.x;
    const availableY = signY > 0 ? cropRect.y + cropRect.h - start.y : start.y - cropRect.y;
    const size = Math.max(0, Math.min(wantedSize, availableX, availableY));
    return { x: start.x + signX * size, y: start.y + signY * size };
  }, [clampPointToCropRect, cropRect]);

  const previewToOverlayPoint = useCallback((point: EditPoint): { left: number; top: number } | null => {
    if (displayed.w <= 0 || displayed.h <= 0) return null;
    const clamped = clampPointToCropRect(point);
    return {
      left: clamp01((clamped.x - cropRect.x) / displayed.w),
      top: clamp01((clamped.y - cropRect.y) / displayed.h),
    };
  }, [clampPointToCropRect, cropRect.x, cropRect.y, displayed.h, displayed.w]);

  const overlayToPreviewTextPoint = useCallback((overlay: ImageTextOverlay): EditPoint | null => {
    if (!natural || displayed.w <= 0 || displayed.h <= 0) return null;
    return {
      x: cropRect.x + overlay.left * displayed.w,
      y: cropRect.y + overlay.top * displayed.h,
    };
  }, [cropRect.x, cropRect.y, displayed.h, displayed.w, natural]);

  const previewTextLayouts = useMemo<TextOverlayLayout[]>(() => {
    if (!natural || displayed.w <= 0 || displayed.h <= 0) return [];
    const previewScale = displayed.w / natural.w;
    return textOverlays.map((overlay) => {
      const point = overlayToPreviewTextPoint(overlay) ?? { x: displayed.x, y: displayed.y };
      const fontSize = Math.max(1, overlay.fontSize * previewScale);
      const { width, height, lineHeight } = measureTextOverlayLayout(overlay.text, fontSize, overlay.fontIndex);
      return {
        id: overlay.id,
        x: point.x,
        y: point.y,
        width,
        height,
        fontSize,
        lineHeight,
        text: overlay.text,
        fontIndex: overlay.fontIndex,
        colorIndex: overlay.colorIndex,
        outlineColorIndex: overlay.outlineColorIndex,
      };
    });
  }, [natural, displayed, textOverlays, overlayToPreviewTextPoint]);

  const updateTextOverlay = useCallback((id: string, updater: (overlay: ImageTextOverlay) => ImageTextOverlay) => {
    setTextOverlays((current) => current.map((overlay) => (overlay.id === id ? normalizeTextOverlay(updater(overlay)) : overlay)));
  }, []);

  const switchTextOverlayFont = useCallback(async (id: string) => {
    const overlay = textOverlays.find((item) => item.id === id);
    if (!overlay) return;
    const nextFontIndex = (normalizeTextFontIndex(overlay.fontIndex) + 1) % TEXT_OVERLAY_FONTS.length;
    const needsLoad = !isTextOverlayFontReady(nextFontIndex, overlay.text);
    if (needsLoad) setFontLoadingTextId(id);
    try {
      if (needsLoad) await ensureTextOverlayFontReady(nextFontIndex, overlay.text);
      updateTextOverlay(id, (current) => ({ ...current, fontIndex: nextFontIndex }));
    } finally {
      if (needsLoad) {
        setFontLoadingTextId((current) => (current === id ? null : current));
      }
    }
  }, [textOverlays, updateTextOverlay]);

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
    const sourcePoint = previewToOverlayPoint({
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
  }, [previewToOverlayPoint, toLocal, updateTextOverlay]);

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
      point.x < cropRect.x ||
      point.x > cropRect.x + cropRect.w ||
      point.y < cropRect.y ||
      point.y > cropRect.y + cropRect.h
    ) {
      return;
    }
    e.preventDefault();
    e.stopPropagation();
    const sourcePoint = previewToOverlayPoint(point);
    if (!sourcePoint || !natural) return;
    const overlay = normalizeTextOverlay({
      id: makeOverlayId("text"),
      left: sourcePoint.left,
      top: sourcePoint.top,
      text: "",
      fontSize: Math.round(Math.hypot(natural.w, natural.h) * TEXT_OVERLAY_DEFAULT_FONT_SIZE_RATIO),
      fontIndex: 0,
      colorIndex: 0,
      outlineColorIndex: null,
    });
    setTextOverlays((current) => [...current, overlay]);
    setActiveTextId(overlay.id);
  }, [cropRect, displayed.h, displayed.w, natural, previewToOverlayPoint, textMode, toLocal]);

  const updateDrawOverlay = useCallback((id: string, updater: (overlay: ImageDrawOverlay) => ImageDrawOverlay) => {
    setDrawOverlays((current) => current.map((overlay) => (overlay.id === id ? updater(overlay) : overlay)));
  }, []);

  const removeDrawOverlay = useCallback((id: string) => {
    setDrawOverlays((current) => current.filter((overlay) => overlay.id !== id));
    drawEditState.current = null;
  }, []);

  const drawOverlayFromPreviewPoints = useCallback((
    id: string,
    type: ImageDrawTool,
    start: EditPoint,
    end: EditPoint,
    strokeWidth: number,
    colorIndex: number,
  ): ImageDrawOverlay | null => {
    const a = cropPointToNormalized(start);
    const b = cropPointToNormalized(end);
    if (!a || !b) return null;
    if (type === "line") {
      return {
        id,
        type,
        x1: a.x,
        y1: a.y,
        x2: b.x,
        y2: b.y,
        strokeWidth,
        colorIndex: normalizeTextColorIndex(colorIndex),
      };
    }
    return {
      id,
      type,
      x1: Math.min(a.x, b.x),
      y1: Math.min(a.y, b.y),
      x2: Math.max(a.x, b.x),
      y2: Math.max(a.y, b.y),
      strokeWidth,
      colorIndex: normalizeTextColorIndex(colorIndex),
    };
  }, [cropPointToNormalized]);

  const onDrawPointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!drawMode || e.button !== 0 || !natural || cropRect.w <= 0 || cropRect.h <= 0) return;
    const point = toLocal(e);
    if (
      point.x < cropRect.x ||
      point.x > cropRect.x + cropRect.w ||
      point.y < cropRect.y ||
      point.y > cropRect.y + cropRect.h
    ) {
      return;
    }
    const startPoint = clampPointToCropRect(point);
    const strokeWidth = Math.max(
      1,
      Math.hypot(natural.w, natural.h) * DRAW_STROKE_WIDTH_RATIOS[drawStrokeWidthIndex],
    );
    drawCreateState.current = {
      pointerId: e.pointerId,
      startPoint,
      type: drawTool,
      strokeWidth,
      colorIndex: drawColorIndex,
    };
    e.currentTarget.setPointerCapture(e.pointerId);
    setDrawDraft(drawOverlayFromPreviewPoints(
      "draw-draft",
      drawTool,
      startPoint,
      startPoint,
      strokeWidth,
      drawColorIndex,
    ) ?? {
      id: "draw-draft",
      type: drawTool,
      x1: 0,
      y1: 0,
      x2: 0,
      y2: 0,
      strokeWidth,
      colorIndex: drawColorIndex,
    });
    e.preventDefault();
    e.stopPropagation();
  }, [
    clampPointToCropRect,
    cropRect,
    drawColorIndex,
    drawMode,
    drawOverlayFromPreviewPoints,
    drawStrokeWidthIndex,
    drawTool,
    natural,
    toLocal,
  ]);

  const onDrawPointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    const state = drawCreateState.current;
    if (!state || state.pointerId !== e.pointerId) return;
    const endPoint = constrainDrawEndPoint(state.type, state.startPoint, toLocal(e), e.shiftKey);
    const draft = drawOverlayFromPreviewPoints(
      "draw-draft",
      state.type,
      state.startPoint,
      endPoint,
      state.strokeWidth,
      state.colorIndex,
    );
    if (draft) setDrawDraft(draft);
    e.preventDefault();
    e.stopPropagation();
  }, [constrainDrawEndPoint, drawOverlayFromPreviewPoints, toLocal]);

  const finishDrawCreation = useCallback((e: React.PointerEvent<HTMLDivElement>, cancelled = false) => {
    const state = drawCreateState.current;
    if (!state || state.pointerId !== e.pointerId) return;
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {}
    if (!cancelled) {
      const endPoint = constrainDrawEndPoint(state.type, state.startPoint, toLocal(e), e.shiftKey);
      const distance = state.type === "line"
        ? Math.hypot(endPoint.x - state.startPoint.x, endPoint.y - state.startPoint.y)
        : Math.max(Math.abs(endPoint.x - state.startPoint.x), Math.abs(endPoint.y - state.startPoint.y));
      if (distance >= 3) {
        const overlay = drawOverlayFromPreviewPoints(
          makeOverlayId("draw"),
          state.type,
          state.startPoint,
          endPoint,
          state.strokeWidth,
          state.colorIndex,
        );
        if (overlay) setDrawOverlays((current) => [...current, overlay]);
      }
    }
    drawCreateState.current = null;
    setDrawDraft(null);
    e.preventDefault();
    e.stopPropagation();
  }, [constrainDrawEndPoint, drawOverlayFromPreviewPoints, toLocal]);

  const onDrawMovePointerDown = useCallback((overlay: ImageDrawOverlay) =>
    (e: React.PointerEvent<SVGElement>) => {
      if (!drawMode || e.button !== 0) return;
      drawEditState.current = {
        mode: "move",
        pointerId: e.pointerId,
        id: overlay.id,
        startPoint: toLocal(e),
        startOverlay: { ...overlay },
      };
      e.currentTarget.setPointerCapture(e.pointerId);
      e.preventDefault();
      e.stopPropagation();
    }, [drawMode, toLocal]);

  const onDrawHandlePointerDown = useCallback((overlay: ImageDrawOverlay, handle: DrawHandle) =>
    (e: React.PointerEvent<HTMLButtonElement>) => {
      if (!drawMode || e.button !== 0) return;
      drawEditState.current = {
        mode: "handle",
        pointerId: e.pointerId,
        id: overlay.id,
        handle,
        startOverlay: { ...overlay },
      };
      e.currentTarget.setPointerCapture(e.pointerId);
      e.preventDefault();
      e.stopPropagation();
    }, [drawMode]);

  const onDrawEditPointerMove = useCallback((e: React.PointerEvent<Element>) => {
    const state = drawEditState.current;
    if (!state || state.pointerId !== e.pointerId || cropRect.w <= 0 || cropRect.h <= 0) return;
    const point = clampPointToCropRect(toLocal(e));
    if (state.mode === "move") {
      const dx = (point.x - state.startPoint.x) / displayed.w;
      const dy = (point.y - state.startPoint.y) / displayed.h;
      const start = state.startOverlay;
      const minX = Math.min(start.x1, start.x2);
      const maxX = Math.max(start.x1, start.x2);
      const minY = Math.min(start.y1, start.y2);
      const maxY = Math.max(start.y1, start.y2);
      const frameMaxX = cropRect.w / displayed.w;
      const frameMaxY = cropRect.h / displayed.h;
      const clampedDx = maxX - minX <= frameMaxX
        ? Math.max(-minX, Math.min(frameMaxX - maxX, dx))
        : dx;
      const clampedDy = maxY - minY <= frameMaxY
        ? Math.max(-minY, Math.min(frameMaxY - maxY, dy))
        : dy;
      updateDrawOverlay(state.id, () => ({
        ...start,
        x1: start.x1 + clampedDx,
        y1: start.y1 + clampedDy,
        x2: start.x2 + clampedDx,
        y2: start.y2 + clampedDy,
      }));
    } else {
      const start = state.startOverlay;
      if (start.type === "line") {
        const fixed = state.handle === "start"
          ? normalizedToCropPoint(start.x2, start.y2)
          : normalizedToCropPoint(start.x1, start.y1);
        const moving = constrainDrawEndPoint("line", fixed, point, e.shiftKey);
        const normalized = cropPointToNormalized(moving);
        if (!normalized) return;
        updateDrawOverlay(state.id, () => state.handle === "start"
          ? { ...start, x1: normalized.x, y1: normalized.y }
          : { ...start, x2: normalized.x, y2: normalized.y });
      } else {
        const fixedNormalized = state.handle === "nw"
          ? { x: start.x2, y: start.y2 }
          : state.handle === "ne"
            ? { x: start.x1, y: start.y2 }
            : state.handle === "sw"
              ? { x: start.x2, y: start.y1 }
              : { x: start.x1, y: start.y1 };
        const fixed = normalizedToCropPoint(fixedNormalized.x, fixedNormalized.y);
        const moving = constrainDrawEndPoint(start.type, fixed, point, e.shiftKey);
        const normalized = cropPointToNormalized(moving);
        if (!normalized) return;
        updateDrawOverlay(state.id, () => ({
          ...start,
          x1: Math.min(fixedNormalized.x, normalized.x),
          y1: Math.min(fixedNormalized.y, normalized.y),
          x2: Math.max(fixedNormalized.x, normalized.x),
          y2: Math.max(fixedNormalized.y, normalized.y),
        }));
      }
    }
    e.preventDefault();
    e.stopPropagation();
  }, [
    clampPointToCropRect,
    constrainDrawEndPoint,
    cropPointToNormalized,
    cropRect.h,
    cropRect.w,
    displayed.h,
    displayed.w,
    normalizedToCropPoint,
    toLocal,
    updateDrawOverlay,
  ]);

  const onDrawEditPointerUp = useCallback((e: React.PointerEvent<Element>) => {
    const state = drawEditState.current;
    if (!state || state.pointerId !== e.pointerId) return;
    try {
      (e.currentTarget as Element).releasePointerCapture(e.pointerId);
    } catch {}
    drawEditState.current = null;
    e.preventDefault();
    e.stopPropagation();
  }, []);

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
    const img = previewCanvasRef.current;
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
    const sampleSourceWidth = resizedWidth;
    const sampleSourceHeight = resizedHeight;
    const rgb = sampleEyedropperRgb8(
      img,
      sampleSourceWidth,
      sampleSourceHeight,
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
    setHistogramGeometryDragging(true);
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
    setHistogramGeometryDragging(false);
  }, []);

  const onCropPointerDown = useCallback(
    (e: React.PointerEvent) => {
      (e.currentTarget as Element).setPointerCapture(e.pointerId);
      dragState.current = { mode: "move", startP: toLocal(e), startCrop: cropRect };
      setHistogramGeometryDragging(true);
      e.preventDefault();
    },
    [cropRect, toLocal],
  );

  const onHandlePointerDown = useCallback(
    (corner: EditCorner) => (e: React.PointerEvent) => {
      (e.currentTarget as Element).setPointerCapture(e.pointerId);
      dragState.current = { mode: "resize", corner, startP: toLocal(e), startCrop: cropRect };
      setHistogramGeometryDragging(true);
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
    setHistogramGeometryDragging(false);
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
  const cropMarginsText = `T=${(displayed.h ? ((cropRect.y - displayed.y) / displayed.h) * 100 : 0).toFixed(1)}% B=${(displayed.h ? (1 - (cropRect.y + cropRect.h - displayed.y) / displayed.h) * 100 : 0).toFixed(1)}% L=${(displayed.w ? ((cropRect.x - displayed.x) / displayed.w) * 100 : 0).toFixed(1)}% R=${(displayed.w ? (1 - (cropRect.x + cropRect.w - displayed.x) / displayed.w) * 100 : 0).toFixed(1)}%`;
  const analysisSourceRect = useMemo(() => {
    if (!natural || !displayed.w || !displayed.h || !cropRect.w || !cropRect.h) {
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
    return { x: sx, y: sy, w: ex - sx, h: ey - sy };
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
  ]);
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

  const beginPreviewFastSliderInteraction = useCallback(() => {
    setPreviewSharpenSuppressed(true);
  }, []);

  useEffect(() => {
    if (!previewSharpenSuppressed) return;
    const finishPreviewFastSliderInteraction = () => {
      setPreviewSharpenSuppressed(false);
    };
    window.addEventListener("pointerup", finishPreviewFastSliderInteraction);
    window.addEventListener("pointercancel", finishPreviewFastSliderInteraction);
    return () => {
      window.removeEventListener("pointerup", finishPreviewFastSliderInteraction);
      window.removeEventListener("pointercancel", finishPreviewFastSliderInteraction);
    };
  }, [previewSharpenSuppressed]);

  const overlayPath = useMemo(() => {
    return {
      outer: `M${displayed.x},${displayed.y} H${displayed.x + displayed.w} V${displayed.y + displayed.h} H${displayed.x} Z`,
      inner: `M${cropRect.x},${cropRect.y} H${cropRect.x + cropRect.w} V${cropRect.y + cropRect.h} H${cropRect.x} Z`,
    };
  }, [cropRect, displayed.x, displayed.y, displayed.w, displayed.h]);

  useEffect(() => {
    const canvas = previewCanvasRef.current;
    const decoded = decodedImageRef.current;
    if (!canvas || !decoded || !displayed.w || !displayed.h) return;
    const width = Math.max(1, Math.round(displayed.w));
    const height = Math.max(1, Math.round(displayed.h));
    const previewColorProfile: ImageEditOutputColorProfile = "srgb";
    const includeMosaic = !eyedropperMode && !rotationMode && mosaicRegions.length > 0 && !!natural?.w;
    const previewSharpen = previewSharpenSuppressed ? 0 : sharpen;
    const renderedPreviewKey = JSON.stringify([
      width,
      height,
      previewColorProfile,
      rotationDegrees,
      temperature,
      tint,
      exposureEv,
      shadow,
      highlight,
      scaledLog,
      sigmoid,
      vibrance,
      saturation,
      previewSharpen,
      includeMosaic ? mosaicRegions : null,
    ]);

    const rendered = previewRenderedRef.current;
    if (
      rendered?.decoded === decoded &&
      rendered.key === renderedPreviewKey &&
      rendered.width === width &&
      rendered.height === height &&
      canvas.width === width &&
      canvas.height === height
    ) {
      return;
    }

    // Preview rendering is intentionally coalesced to the next animation frame. During
    // a rapid slider/pointer sequence React may commit several states before that frame;
    // cleanup cancels the obsolete request so only the latest state is rendered.
    const frameId = requestAnimationFrame(() => {
      if (previewCanvasRef.current !== canvas || decodedImageRef.current !== decoded) return;
      const isInitialPreview = !initialPreviewReadyRef.current;
      const initialPreviewStartedAt = isInitialPreview ? performance.now() : 0;
      if (canvas.width !== width) canvas.width = width;
      if (canvas.height !== height) canvas.height = height;

      const previewSourceRect = { x: 0, y: 0, w: decoded.width, h: decoded.height };
      let stageStartedAt = isInitialPreview ? performance.now() : 0;
      const previewSourceSample = getRenderedLinearRgbSample(
        decoded,
        previewSourceRect,
        rotationDegrees,
        width,
        height,
      );
      if (isInitialPreview) {
        logImageLoadStage(file, "Sampling preview", stageStartedAt);
        stageStartedAt = performance.now();
      }
      const previewContextSample = getAnalysisLinearRgbSample(
        decoded,
        previewSourceRect,
        rotationDegrees,
      );
      if (isInitialPreview) {
        logImageLoadStage(file, "Analyzing preview", stageStartedAt);
        stageStartedAt = performance.now();
      }
      renderAdjustedLinearRgbSampleToCanvas(
        canvas,
        previewSourceSample,
        previewContextSample,
        temperature,
        tint,
        exposureEv,
        shadow,
        highlight,
        scaledLog,
        sigmoid,
        vibrance,
        saturation,
        previewColorProfile,
      );
      if (isInitialPreview) {
        logImageLoadStage(file, "Rendering preview", stageStartedAt);
        stageStartedAt = performance.now();
      }
      applySharpenToCanvas(canvas, previewSharpen, previewColorProfile);
      if (includeMosaic) {
        applyMosaicRectsToCanvas(
          canvas,
          mosaicRegions.map((region) => ({
            x: region.left * canvas.width,
            y: region.top * canvas.height,
            w: (region.right - region.left) * canvas.width,
            h: (region.bottom - region.top) * canvas.height,
          })),
          16,
          previewColorProfile,
        );
      }
      if (isInitialPreview) {
        logImageLoadStage(file, "Finishing preview", stageStartedAt);
      }

      previewRenderedRef.current = {
        decoded,
        width,
        height,
        key: renderedPreviewKey,
      };
      if (isInitialPreview) {
        initialPreviewReadyRef.current = true;
        setLoadingStage(null);
        clearEmbeddedRawPreview();
        console.info(
          `[image-editor load] ${file.name}: preview total ${(performance.now() - initialPreviewStartedAt).toFixed(1)}ms`,
        );
      }
    });

    return () => cancelAnimationFrame(frameId);
  }, [
    displayed.w,
    displayed.h,
    temperature,
    tint,
    exposureEv,
    shadow,
    highlight,
    scaledLog,
    sigmoid,
    vibrance,
    saturation,
    sharpen,
    previewSharpenSuppressed,
    rotationDegrees,
    rotationMode,
    natural,
    mosaicRegions,
    eyedropperMode,
    file,
    clearEmbeddedRawPreview,
  ]);

  useEffect(() => {
    if (!showHistogram || eyedropperMode) {
      setHistogram(null);
      return;
    }
    if (histogramGeometryDragging) return;
    const decoded = decodedImageRef.current;
    if (!decoded || !analysisSourceRect) {
      setHistogram(null);
      return;
    }
    setHistogram(
      computeHistogramDataFromRgb16(
        decoded,
        analysisSourceRect,
        rotationDegrees,
        temperature,
        tint,
        exposureEv,
        shadow,
        highlight,
        scaledLog,
        sigmoid,
        vibrance,
        saturation,
      ),
    );
  }, [
    showHistogram,
    histogramGeometryDragging,
    analysisSourceRect,
    temperature,
    tint,
    exposureEv,
    shadow,
    highlight,
    scaledLog,
    sigmoid,
    vibrance,
    saturation,
    rotationDegrees,
    eyedropperMode,
  ]);

  useEffect(() => {
    let cancelled = false;
    if (
      !showHistogram ||
      !showPercentileDebug ||
      !isRawImageFile(file.name, file.type) ||
      rawThumbnailDebugStatistics
    ) {
      return () => {
        cancelled = true;
      };
    }
    void readRawThumbnailDebugStatistics(file).then((thumbnail) => {
      if (!cancelled) setRawThumbnailDebugStatistics(thumbnail);
    });
    return () => {
      cancelled = true;
    };
  }, [showHistogram, showPercentileDebug, file, rawThumbnailDebugStatistics]);

  useEffect(() => {
    let cancelled = false;
    if (
      !showHistogram ||
      !showPercentileDebug ||
      !imageReady ||
      !isRawImageFile(file.name, file.type)
    ) {
      setRawDevelopmentMemoryUsage(undefined);
      return () => {
        cancelled = true;
      };
    }

    const decoded = decodedImageRef.current;
    if (!decoded) {
      setRawDevelopmentMemoryUsage(undefined);
      return () => {
        cancelled = true;
      };
    }

    type PerformanceWithMemory = Performance & {
      memory?: { usedJSHeapSize?: number };
      measureUserAgentSpecificMemory?: () => Promise<{ bytes?: number }>;
    };
    const perf = performance as PerformanceWithMemory;
    const heapBytes = perf.memory?.usedJSHeapSize;
    const initialUsage: RawDevelopmentMemoryUsage = {
      bufferBytes: decoded.data.byteLength,
      ...(typeof heapBytes === "number" && Number.isFinite(heapBytes)
        ? { heapBytes }
        : {}),
    };
    setRawDevelopmentMemoryUsage(initialUsage);

    const measureTotal = perf.measureUserAgentSpecificMemory;
    if (typeof measureTotal === "function") {
      void measureTotal.call(perf).then(
        (measurement) => {
          const totalBytes = measurement?.bytes;
          if (!cancelled && typeof totalBytes === "number" && Number.isFinite(totalBytes)) {
            setRawDevelopmentMemoryUsage({ ...initialUsage, totalBytes });
          }
        },
        () => {
          // total is optional; keep buffer/heap when the browser cannot measure it.
        },
      );
    }

    return () => {
      cancelled = true;
    };
  }, [showHistogram, showPercentileDebug, imageReady, file]);

  useEffect(() => {
    if (!showHistogram) {
      setShowPercentileDebug(false);
      setPercentileDebug(null);
      return;
    }
    if (!showPercentileDebug || !imageReady || !analysisSourceRect) {
      setPercentileDebug(null);
      return;
    }

    const decoded = decodedImageRef.current;
    if (!decoded) {
      setPercentileDebug(null);
      return;
    }

    const sample = getAnalysisLinearRgbSample(decoded, analysisSourceRect, rotationDegrees);
    if (!sample.data.length) {
      setPercentileDebug(null);
      return;
    }

    let cached = RGB16_EDIT_PERCENTILE_DEBUG_CACHE.get(sample);
    if (!cached) {
      cached = {
        input: debugStatisticsFromLinearRgbSample(sample, "prophoto"),
      };
      RGB16_EDIT_PERCENTILE_DEBUG_CACHE.set(sample, cached);
    }

    const outputKey = [
      temperature,
      tint,
      exposureEv,
      shadow,
      highlight,
      scaledLog,
      sigmoid,
      vibrance,
      saturation,
    ].join("|");
    let outputStatistics = cached.outputKey === outputKey
      ? cached.output
      : undefined;
    if (!outputStatistics) {
      outputStatistics = adjustedDebugStatisticsFromLinearRgbSample(
        sample,
        temperature,
        tint,
        exposureEv,
        shadow,
        highlight,
        scaledLog,
        sigmoid,
        vibrance,
        saturation,
        "prophoto",
      );
      cached.outputKey = outputKey;
      cached.output = outputStatistics;
    }
    setPercentileDebug({
      input: cached.input,
      thumbnail: rawThumbnailDebugStatistics,
      output: outputStatistics,
    });
  }, [
    showHistogram,
    showPercentileDebug,
    imageReady,
    analysisSourceRect,
    rotationDegrees,
    rawThumbnailDebugStatistics,
    temperature,
    tint,
    exposureEv,
    shadow,
    highlight,
    scaledLog,
    sigmoid,
    vibrance,
    saturation,
  ]);

  const currentToneAutoSample = useCallback((): ToneAutoSample | null => {
    const decoded = decodedImageRef.current;
    if (!decoded || !analysisSourceRect) return null;
    return createToneAutoSampleFromRgb16(decoded, analysisSourceRect, rotationDegrees);
  }, [analysisSourceRect, rotationDegrees]);

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

  const onAutoShadow = useCallback(() => {
    if (autoToneBusy) return;
    void runAutoToneTask(() => {
      const sample = currentToneAutoSample();
      if (!sample) return;
      setShadow(findAutoShadow(sample, temperature, tint, exposureEv));
    });
  }, [autoToneBusy, currentToneAutoSample, exposureEv, runAutoToneTask, temperature, tint]);

  const onAutoLogarithm = useCallback(() => {
    if (autoToneBusy) return;
    void runAutoToneTask(() => {
      const sample = currentToneAutoSample();
      if (!sample) return;
      setScaledLog(findAutoLogarithm(sample, temperature, tint, exposureEv, shadow));
    });
  }, [autoToneBusy, currentToneAutoSample, exposureEv, runAutoToneTask, shadow, temperature, tint]);

  const onAutoSigmoid = useCallback(() => {
    if (autoToneBusy) return;
    void runAutoToneTask(() => {
      const sample = currentToneAutoSample();
      if (!sample) return;
      setSigmoid(findAutoSigmoid(sample, temperature, tint, exposureEv, shadow, scaledLog));
    });
  }, [autoToneBusy, currentToneAutoSample, exposureEv, runAutoToneTask, scaledLog, shadow, temperature, tint]);

  const onAutoTone = useCallback(() => {
    if (autoToneBusy) return;
    void runAutoToneTask(() => {
      const sample = currentToneAutoSample();
      if (!sample) return;
      const autoExposure = findAutoExposure(sample, temperature, tint);
      const autoShadow = findAutoShadow(sample, temperature, tint, autoExposure);
      const autoLogarithm = findAutoLogarithm(
        sample,
        temperature,
        tint,
        autoExposure,
        autoShadow,
      );
      const autoSigmoid = findAutoSigmoid(
        sample,
        temperature,
        tint,
        autoExposure,
        autoShadow,
        autoLogarithm,
      );
      setExposureEv(autoExposure);
      setShadow(autoShadow);
      setHighlight(0);
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

  const gridPaths = useMemo(() => {
    if (!showGrid || displayed.w <= 0 || displayed.h <= 0) return null;
    const width = displayed.w;
    const height = displayed.h;
    const cell = editGridCellSize(width, height);
    const vertical: string[] = [];
    const horizontal: string[] = [];
    for (let x = cell; x < width; x += cell) {
      vertical.push(`M${x},0 V${height}`);
    }
    for (let y = cell; y < height; y += cell) {
      horizontal.push(`M0,${y} H${width}`);
    }
    return {
      width,
      height,
      cell,
      vertical: vertical.join(" "),
      horizontal: horizontal.join(" "),
    };
  }, [showGrid, displayed.w, displayed.h]);

  const cropDragging = histogramGeometryDragging && dragState.current !== null;

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
    if (!displayed.w || !displayed.h || applyPendingRef.current) return;
    const left = (cropRect.x - displayed.x) / displayed.w;
    const top = (cropRect.y - displayed.y) / displayed.h;
    const right = 1 - (cropRect.x + cropRect.w - displayed.x) / displayed.w;
    const bottom = 1 - (cropRect.y + cropRect.h - displayed.y) / displayed.h;
    const params: ImageEditParams = {
      crop: normalizeCrop({ left, top, right, bottom }),
      rotationDegrees: normalizeRotationDegrees(rotationDegrees),
      temperature: clampWhiteBalanceValue(temperature),
      tint: clampWhiteBalanceValue(tint),
      exposureEv: clampExposureEv(exposureEv),
      shadow: clampToneRangeAdjustment(shadow),
      highlight: clampToneRangeAdjustment(highlight),
      scaledLog: clampScaledLog(scaledLog),
      sigmoid: clampSigmoid(sigmoid),
      vibrance: clampColorAdjustment(vibrance),
      saturation: clampColorAdjustment(saturation),
      resizePercent: Math.min(100, Math.max(1, Math.round(resizePercent))),
      sharpen: clampSharpen(sharpen),
      mosaicRegions: normalizeMosaicRegions(mosaicRegions),
      textOverlays: normalizeTextOverlays(textOverlays),
      drawOverlays: normalizeDrawOverlays(drawOverlays),
    };
    applyPendingRef.current = true;
    setApplyBusy(true);
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        const decodedImage = decodedImageRef.current;
        if (decodedImage) transferredDecodedImageRef.current = decodedImage;
        onApply(params, decodedImage ?? undefined);
      });
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
    shadow,
    highlight,
    scaledLog,
    sigmoid,
    vibrance,
    saturation,
    resizePercent,
    sharpen,
    mosaicRegions,
    textOverlays,
    drawOverlays,
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
    setShadow(params.shadow);
    setHighlight(params.highlight);
    setScaledLog(params.scaledLog);
    setSigmoid(params.sigmoid);
    setVibrance(params.vibrance);
    setSaturation(params.saturation);
    setResizePercent(params.resizePercent);
    setSharpen(params.sharpen);
    setTextMode(false);
    setActiveTextId(null);
    textMoveState.current = null;
    setTextOverlays(params.textOverlays);
    setDrawMode(false);
    setDrawTool("line");
    setDrawStrokeWidthIndex(1);
    setDrawColorIndex(0);
    setDrawOverlays(params.drawOverlays);
    setDrawDraft(null);
    drawCreateState.current = null;
    drawEditState.current = null;
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

  const rawDevelopmentSettings = (() => {
    if (!isRawImageFile(file.name, file.type)) return undefined;
    const decoded = decodedImageRef.current;
    return decoded?.rawDevelopment;
  })();

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
        className="bg-white rounded shadow max-w-[95vw] max-h-[95dvh] overflow-y-auto w-[min(1400px,95vw)] p-4"
        onClick={(e) => {
          e.stopPropagation();
          if (eyedropperMode) setEyedropperMode(false);
          if (rotationMode) {
            setRotationMode(false);
            rotationDragState.current = null;
          }
        }}
      >
        <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between lg:gap-3">
          <h2 className="text-base font-semibold break-all">Edit image</h2>
          <div className="grid grid-cols-3 items-center gap-x-3 gap-y-2 lg:flex lg:gap-3">
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
                    setDrawMode(false);
                    setDrawDraft(null);
                    drawCreateState.current = null;
                    drawEditState.current = null;
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
                checked={drawMode}
                onChange={(e) => {
                  const next = e.target.checked;
                  setDrawMode(next);
                  drawCreateState.current = null;
                  drawEditState.current = null;
                  setDrawDraft(null);
                  if (next) {
                    setTextMode(false);
                    setActiveTextId(null);
                    textMoveState.current = null;
                    setMosaicMode(false);
                    mosaicDragStart.current = null;
                    mosaicMoveState.current = null;
                    setMosaicDraft(null);
                    setEyedropperMode(false);
                    setRotationMode(false);
                    rotationDragState.current = null;
                    dragState.current = null;
                  }
                }}
              />
              <span>Draw</span>
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
                    setDrawMode(false);
                    setDrawDraft(null);
                    drawCreateState.current = null;
                    drawEditState.current = null;
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
            <label className="inline-flex items-center gap-2 text-sm text-gray-700 select-none">
              <input
                type="checkbox"
                checked={showGrid}
                onChange={(e) => setShowGrid(e.target.checked)}
              />
              <span>Grid</span>
            </label>
            <button
              className="col-span-3 justify-self-start px-2 py-0.5 text-sm rounded border border-gray-300 hover:bg-gray-100 lg:col-auto lg:justify-self-auto"
              onClick={onReset}
            >
              Reset
            </button>
          </div>
        </div>

        <div className="mt-3 grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_250px] gap-4 lg:items-stretch">
          <div
            ref={containerRef}
            className={`relative w-full h-[42vh] min-h-[270px] lg:h-auto rounded border bg-gray-200 overflow-hidden touch-none ${textMode ? "cursor-text" : !eyedropperMode && !rotationMode && (drawMode || mosaicMode) ? "cursor-crosshair" : ""}`}
            onPointerDown={eyedropperMode || rotationMode ? undefined : textMode ? onTextPointerDown : drawMode ? onDrawPointerDown : mosaicMode ? onMosaicPointerDown : undefined}
            onPointerMove={eyedropperMode ? undefined : rotationMode ? onRotationPointerMove : drawMode ? onDrawPointerMove : mosaicMode ? onMosaicPointerMove : onPointerMove}
            onPointerUp={eyedropperMode ? undefined : rotationMode ? onRotationPointerUp : drawMode ? (e) => finishDrawCreation(e) : mosaicMode ? onMosaicPointerUp : onPointerUp}
            onPointerCancel={eyedropperMode ? undefined : rotationMode ? onRotationPointerUp : drawMode ? (e) => finishDrawCreation(e, true) : mosaicMode ? onMosaicPointerCancel : onPointerUp}
          >
              {embeddedRawPreview && (
                <NextImage
                  src={embeddedRawPreview.url}
                  alt=""
                  fill
                  unoptimized
                  className="object-contain p-[18px] select-none"
                  sizes="(max-width: 1024px) 95vw, 1100px"
                  aria-hidden="true"
                />
              )}
              {loadingStage && (
                <div className="absolute inset-0 z-[60] flex items-center justify-center bg-black/10 pointer-events-none">
                  <div className="flex flex-col items-center gap-2 text-white">
                    <div className="rounded bg-black/45 p-3 shadow">
                      <div className="h-10 w-10 rounded-full border-4 border-white/40 border-t-white animate-spin" />
                    </div>
                    <div className="rounded bg-black/45 px-3 py-1.5 text-xs font-medium tracking-wide shadow">
                      {loadingStage}
                    </div>
                  </div>
                </div>
              )}
              {imageReady && natural ? (
                <>
                  {!eyedropperMode && showHistogram && histogramPaths && (
                    <div
                      className="absolute left-2 bottom-2 z-[33] w-[294px] h-[138px] rounded bg-black pointer-events-none"
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
                  {(autoToneBusy || applyBusy) && (
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
                  {!eyedropperMode && !rotationMode && (
                    <svg className="absolute inset-0 w-full h-full pointer-events-none" aria-hidden="true">
                      <path d={`${overlayPath.outer} ${overlayPath.inner}`} fill="rgba(0,0,0,0.45)" fillRule="evenodd" />
                    </svg>
                  )}
                  {!eyedropperMode && !cropDragging && gridPaths && (
                    <div
                      className="absolute pointer-events-none"
                      style={{
                        left: displayed.x,
                        top: displayed.y,
                        width: displayed.w,
                        height: displayed.h,
                      }}
                      aria-hidden="true"
                    >
                      <svg
                        className="absolute inset-0 w-full h-full"
                        viewBox={`0 0 ${gridPaths.width} ${gridPaths.height}`}
                        preserveAspectRatio="none"
                      >
                        {gridPaths.vertical ? (
                          <path d={gridPaths.vertical} stroke="rgba(255,255,255,0.45)" strokeWidth="1" fill="none" />
                        ) : null}
                        {gridPaths.horizontal ? (
                          <path d={gridPaths.horizontal} stroke="rgba(255,255,255,0.45)" strokeWidth="1" fill="none" />
                        ) : null}
                      </svg>
                    </div>
                  )}
                  {!eyedropperMode && drawMode && (
                    <div
                      className="absolute right-2 top-2 z-[35] flex items-center gap-1 rounded border border-black/30 bg-white/90 p-1 shadow"
                      onPointerDown={(e) => e.stopPropagation()}
                      onClick={(e) => e.stopPropagation()}
                    >
                      {([
                        ["line", "Line"],
                        ["rect", "Rectangle"],
                        ["ellipse", "Ellipse"],
                      ] as const).map(([tool, label]) => (
                        <button
                          key={tool}
                          type="button"
                          className={`flex h-7 w-8 items-center justify-center rounded border ${
                            drawTool === tool
                              ? "border-blue-500 bg-blue-50 text-blue-700"
                              : "border-gray-300 bg-white text-gray-700 hover:bg-gray-100"
                          }`}
                          onClick={() => setDrawTool(tool)}
                          aria-label={label}
                          title={label}
                        >
                          <svg width="20" height="16" viewBox="0 0 20 16" aria-hidden="true">
                            {tool === "line" ? (
                              <line x1="3" y1="13" x2="17" y2="3" stroke="currentColor" strokeWidth="1.8" />
                            ) : tool === "rect" ? (
                              <rect x="3" y="3" width="14" height="10" fill="none" stroke="currentColor" strokeWidth="1.6" />
                            ) : (
                              <ellipse cx="10" cy="8" rx="7" ry="5" fill="none" stroke="currentColor" strokeWidth="1.6" />
                            )}
                          </svg>
                        </button>
                      ))}
                      <button
                        type="button"
                        className="flex h-7 w-8 items-center justify-center rounded border border-gray-300 bg-white hover:bg-gray-100"
                        onClick={() => setDrawStrokeWidthIndex((current) => (current + 1) % DRAW_STROKE_WIDTH_RATIOS.length)}
                        aria-label={`Stroke width: ${DRAW_STROKE_WIDTH_LABELS[drawStrokeWidthIndex]}`}
                        title={`Stroke width: ${DRAW_STROKE_WIDTH_LABELS[drawStrokeWidthIndex]}`}
                      >
                        <span
                          className="block w-5 border-t border-current"
                          style={{ borderTopWidth: 1 + drawStrokeWidthIndex * 1.5 }}
                        />
                      </button>
                      <button
                        type="button"
                        className="flex h-7 w-8 items-center justify-center rounded border border-gray-300 bg-white hover:bg-gray-100"
                        onClick={() => setDrawColorIndex((current) => (current + 1) % TEXT_OVERLAY_COLORS.length)}
                        aria-label="Change drawing color"
                        title="Drawing color"
                      >
                        <span
                          className="h-4 w-4 rounded-full border border-black/40"
                          style={{ backgroundColor: TEXT_OVERLAY_COLORS[drawColorIndex] }}
                        />
                      </button>
                    </div>
                  )}
                  {!eyedropperMode && cropRect.w > 0 && cropRect.h > 0 && (drawOverlays.length > 0 || drawDraft) && (
                    <svg
                      className="absolute z-20 overflow-visible"
                      style={{
                        left: cropRect.x,
                        top: cropRect.y,
                        width: cropRect.w,
                        height: cropRect.h,
                        pointerEvents: "none",
                      }}
                      viewBox={`0 0 ${cropRect.w} ${cropRect.h}`}
                      preserveAspectRatio="none"
                      aria-hidden="true"
                    >
                      {drawOverlays.map((overlay) => {
                        const x1 = overlay.x1 * displayed.w;
                        const y1 = overlay.y1 * displayed.h;
                        const x2 = overlay.x2 * displayed.w;
                        const y2 = overlay.y2 * displayed.h;
                        const strokeWidth = Math.max(1, overlay.strokeWidth * displayed.w / natural.w);
                        const stroke = TEXT_OVERLAY_COLORS[normalizeTextColorIndex(overlay.colorIndex)];
                        const commonHitProps = {
                          onPointerDown: onDrawMovePointerDown(overlay),
                          onPointerMove: onDrawEditPointerMove,
                          onPointerUp: onDrawEditPointerUp,
                          onPointerCancel: onDrawEditPointerUp,
                        };
                        if (overlay.type === "line") {
                          return (
                            <g key={overlay.id}>
                              <line x1={x1} y1={y1} x2={x2} y2={y2} stroke={stroke} strokeWidth={strokeWidth} strokeLinecap="round" />
                              {drawMode && (
                                <line
                                  x1={x1}
                                  y1={y1}
                                  x2={x2}
                                  y2={y2}
                                  stroke="rgba(0,0,0,0.001)"
                                  strokeWidth={Math.max(12, strokeWidth + 10)}
                                  strokeLinecap="round"
                                  style={{ pointerEvents: "stroke", cursor: "move" }}
                                  {...commonHitProps}
                                />
                              )}
                            </g>
                          );
                        }
                        const left = Math.min(x1, x2);
                        const top = Math.min(y1, y2);
                        const width = Math.abs(x2 - x1);
                        const height = Math.abs(y2 - y1);
                        return (
                          <g key={overlay.id}>
                            {overlay.type === "rect" ? (
                              <rect x={left} y={top} width={width} height={height} fill="none" stroke={stroke} strokeWidth={strokeWidth} />
                            ) : (
                              <ellipse cx={left + width / 2} cy={top + height / 2} rx={width / 2} ry={height / 2} fill="none" stroke={stroke} strokeWidth={strokeWidth} />
                            )}
                            {drawMode && (overlay.type === "rect" ? (
                              <rect
                                x={left}
                                y={top}
                                width={width}
                                height={height}
                                fill="rgba(0,0,0,0.001)"
                                stroke="rgba(0,0,0,0.001)"
                                strokeWidth={Math.max(12, strokeWidth + 10)}
                                style={{ pointerEvents: "all", cursor: "move" }}
                                {...commonHitProps}
                              />
                            ) : (
                              <ellipse
                                cx={left + width / 2}
                                cy={top + height / 2}
                                rx={width / 2}
                                ry={height / 2}
                                fill="rgba(0,0,0,0.001)"
                                stroke="rgba(0,0,0,0.001)"
                                strokeWidth={Math.max(12, strokeWidth + 10)}
                                style={{ pointerEvents: "all", cursor: "move" }}
                                {...commonHitProps}
                              />
                            ))}
                          </g>
                        );
                      })}
                      {drawDraft && (() => {
                        const x1 = drawDraft.x1 * displayed.w;
                        const y1 = drawDraft.y1 * displayed.h;
                        const x2 = drawDraft.x2 * displayed.w;
                        const y2 = drawDraft.y2 * displayed.h;
                        const strokeWidth = Math.max(1, drawDraft.strokeWidth * displayed.w / natural.w);
                        const stroke = TEXT_OVERLAY_COLORS[normalizeTextColorIndex(drawDraft.colorIndex)];
                        if (drawDraft.type === "line") {
                          return <line x1={x1} y1={y1} x2={x2} y2={y2} stroke={stroke} strokeWidth={strokeWidth} strokeLinecap="round" />;
                        }
                        const left = Math.min(x1, x2);
                        const top = Math.min(y1, y2);
                        const width = Math.abs(x2 - x1);
                        const height = Math.abs(y2 - y1);
                        return drawDraft.type === "rect" ? (
                          <rect x={left} y={top} width={width} height={height} fill="none" stroke={stroke} strokeWidth={strokeWidth} />
                        ) : (
                          <ellipse cx={left + width / 2} cy={top + height / 2} rx={width / 2} ry={height / 2} fill="none" stroke={stroke} strokeWidth={strokeWidth} />
                        );
                      })()}
                    </svg>
                  )}
                  {!eyedropperMode && drawMode && cropRect.w > 0 && cropRect.h > 0 && drawOverlays.map((overlay) => {
                    const x1 = cropRect.x + overlay.x1 * displayed.w;
                    const y1 = cropRect.y + overlay.y1 * displayed.h;
                    const x2 = cropRect.x + overlay.x2 * displayed.w;
                    const y2 = cropRect.y + overlay.y2 * displayed.h;
                    const handles: Array<[DrawHandle, number, number]> = overlay.type === "line"
                      ? [["start", x1, y1], ["end", x2, y2]]
                      : [
                          ["nw", Math.min(x1, x2), Math.min(y1, y2)],
                          ["ne", Math.max(x1, x2), Math.min(y1, y2)],
                          ["sw", Math.min(x1, x2), Math.max(y1, y2)],
                          ["se", Math.max(x1, x2), Math.max(y1, y2)],
                        ];
                    const deleteX = Math.max(x1, x2) + 5;
                    const deleteY = Math.min(y1, y2) - 10;
                    return (
                      <div key={`${overlay.id}-controls`} className="contents">
                        {handles.map(([handle, x, y]) => (
                          <button
                            key={handle}
                            type="button"
                            className="absolute z-[31] h-3 w-3 rounded-full border border-black bg-white shadow"
                            style={{ left: x - 6, top: y - 6 }}
                            onPointerDown={onDrawHandlePointerDown(overlay, handle)}
                            onPointerMove={onDrawEditPointerMove}
                            onPointerUp={onDrawEditPointerUp}
                            onPointerCancel={onDrawEditPointerUp}
                            aria-label="Resize drawing"
                          />
                        ))}
                        <button
                          type="button"
                          className="absolute z-[32] flex h-5 w-5 items-center justify-center rounded-full border border-white bg-black/80 text-[12px] leading-none text-white"
                          style={{ left: deleteX, top: deleteY }}
                          onPointerDown={(e) => e.stopPropagation()}
                          onClick={(e) => {
                            e.stopPropagation();
                            removeDrawOverlay(overlay.id);
                          }}
                          aria-label="Remove drawing"
                        >
                          ✕
                        </button>
                      </div>
                    );
                  })}
                  {!eyedropperMode && showHistogram && histogramPaths && (
                    <div className="absolute left-2 bottom-2 z-[33] w-[294px] h-[138px] rounded border border-white/40 bg-black/80 shadow-sm pointer-events-none">
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
                  {!eyedropperMode && showHistogram && (
                    <button
                      type="button"
                      className="absolute right-2 bottom-2 z-30 flex h-6 w-6 items-center justify-center rounded border border-black/40 bg-white/80 text-xs font-semibold text-black opacity-10 transition-opacity hover:opacity-100 focus:opacity-100"
                      onPointerDown={(e) => e.stopPropagation()}
                      onClick={(e) => {
                        e.stopPropagation();
                        setShowPercentileDebug(true);
                      }}
                      aria-label="Show percentile statistics"
                      title="Percentile statistics"
                    >
                      P
                    </button>
                  )}
                  {!eyedropperMode && showHistogram && showPercentileDebug && (
                    <div
                      className="absolute inset-0 z-50"
                      onPointerDown={(e) => e.stopPropagation()}
                      onClick={(e) => {
                        e.stopPropagation();
                        setShowPercentileDebug(false);
                      }}
                    >
                      <div
                        ref={percentilePanelRef}
                        className="absolute left-2 top-2 max-w-[480px] overflow-x-auto rounded border border-white/40 bg-black/85 p-2 text-[11px] leading-tight text-white shadow-lg"
                        onPointerDown={(e) => e.stopPropagation()}
                        onClick={(e) => e.stopPropagation()}
                      >
                        <div className="flex items-start gap-3">
                          {([
                            ["luminance", "luminance"],
                            ["saturation", "saturation"],
                          ] as const).map(([label, key]) => (
                            <div key={key}>
                              <div className="px-1 pb-1 font-medium">{label}</div>
                              <table className="border-collapse tabular-nums">
                                <thead>
                                  <tr>
                                    <th className="border border-gray-600 px-1 py-0.5 text-left font-normal" />
                                    {percentileDebug?.thumbnail && (
                                      <th className="border border-gray-600 px-1 py-0.5 text-right font-normal">thumbnail</th>
                                    )}
                                    <th className="border border-gray-600 px-1 py-0.5 text-right font-normal">input</th>
                                    <th className="border border-gray-600 px-1 py-0.5 text-right font-normal">output</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {DEBUG_PERCENTILES.map((percentile, index) => (
                                    <tr key={percentile}>
                                      <th className="border border-gray-600 px-1 py-0.5 text-left font-normal">P{percentile}</th>
                                      {percentileDebug?.thumbnail && (
                                        <td className="border border-gray-600 px-1 py-0.5 text-right">
                                          {percentileDebug.thumbnail[key][index].toFixed(3)}
                                        </td>
                                      )}
                                      <td className="border border-gray-600 px-1 py-0.5 text-right">
                                        {percentileDebug ? percentileDebug.input[key][index].toFixed(3) : "..."}
                                      </td>
                                      <td className="border border-gray-600 px-1 py-0.5 text-right">
                                        {percentileDebug ? percentileDebug.output[key][index].toFixed(3) : "..."}
                                      </td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          ))}
                        </div>
                        {rawDevelopmentSettings && (
                          <div className="mt-2 border-t border-gray-600 pt-2">
                            <div className="font-medium">RAW development settings</div>
                            <div className="mt-1 space-y-0.5 font-mono tabular-nums">
                              <div>
                                luminance: {rawDevelopmentSettings.luminance
                                  ? `exposure=${formatRawDevelopmentSetting(rawDevelopmentSettings.luminance.exposureEv)}, logarithm=${formatRawDevelopmentSetting(rawDevelopmentSettings.luminance.logarithm)}, sigmoid=${formatRawDevelopmentSetting(rawDevelopmentSettings.luminance.sigmoid)}, tone slope@1=${rawDevelopmentSettings.luminance.toneSlopeAtWhite.toFixed(6)}`
                                  : "n/a"}
                              </div>
                              <div>
                                saturation: saturation={formatRawDevelopmentSetting(rawDevelopmentSettings.saturation.saturation)}, vibrance={formatRawDevelopmentSetting(rawDevelopmentSettings.saturation.vibrance)}
                              </div>
                              <div>
                                source: ISO={rawDevelopmentSettings.iso === null ? "n/a" : formatRawDevelopmentSetting(rawDevelopmentSettings.iso)}, medPasses={rawDevelopmentSettings.medPasses}, mode={rawDevelopmentSettings.mode === "thumbnail-match" ? "thumbnail match" : "fallback"}
                              </div>
                              {rawDevelopmentSettings.lensfun && (
                                <>
                                  <div>
                                    lens: {[
                                      rawDevelopmentSettings.lensfun.name || "n/a",
                                      rawDevelopmentSettings.lensfun.focal === null
                                        ? null
                                        : `${formatRawDevelopmentSetting(rawDevelopmentSettings.lensfun.focal)}mm`,
                                      rawDevelopmentSettings.lensfun.aperture === null
                                        ? null
                                        : `f/${formatRawDevelopmentSetting(rawDevelopmentSettings.lensfun.aperture)}`,
                                      rawDevelopmentSettings.lensfun.cropFactor === null
                                        ? null
                                        : `crop=${formatRawDevelopmentSetting(rawDevelopmentSettings.lensfun.cropFactor)}`,
                                    ].filter(Boolean).join(", ")}
                                  </div>
                                  <div>
                                    lens correction: {formatRawDevelopmentLensfunCorrection(rawDevelopmentSettings.lensfun)}
                                  </div>
                                </>
                              )}
                              {rawDevelopmentMemoryUsage && (
                                <div>
                                  memory usage: {[
                                    `buffer=${formatMemoryMiB(rawDevelopmentMemoryUsage.bufferBytes)}`,
                                    ...(rawDevelopmentMemoryUsage.heapBytes === undefined
                                      ? []
                                      : [`heap=${formatMemoryMiB(rawDevelopmentMemoryUsage.heapBytes)}`]),
                                    ...(rawDevelopmentMemoryUsage.totalBytes === undefined
                                      ? []
                                      : [`total=${formatMemoryMiB(rawDevelopmentMemoryUsage.totalBytes)}`]),
                                  ].join(", ")}
                                </div>
                              )}
                              <div>buffer linearRangeMax={formatRawDevelopmentSetting(decodedImageRef.current?.linearRangeMax ?? 1)}</div>
                              <div>elapsed time: real={formatRawDevelopmentSetting(rawDevelopmentSettings.elapsedSeconds)}s</div>
                              {rawDevelopmentSettings.headroom && (
                                <div className="mt-2 border-t border-gray-600 pt-2">
                                  <div className="font-medium">RAW developed max RGB histogram (linear ProPhoto)</div>
                                  <div>
                                    max={rawDevelopmentSettings.headroom.maxRgb.toFixed(3)}, {`>${rawDevelopmentSettings.headroom.histogramMax.toFixed(1)}`}={rawDevelopmentSettings.headroom.overflowCount}
                                    {rawDevelopmentSettings.headroom.pixelCount > 0
                                      ? ` (${(rawDevelopmentSettings.headroom.overflowCount / rawDevelopmentSettings.headroom.pixelCount * 100).toFixed(4)}%)`
                                      : ""}
                                  </div>
                                  <div className="mt-1 grid grid-cols-2 gap-x-4">
                                    {rawDevelopmentSettings.headroom.bins.map((count, index) => {
                                      const headroom = rawDevelopmentSettings.headroom!;
                                      const low = index * headroom.step;
                                      const percent = headroom.pixelCount > 0
                                        ? count / headroom.pixelCount * 100
                                        : 0;
                                      return (
                                        <div key={index}>
                                          {low.toFixed(1)}: {count} ({percent.toFixed(4)}%)
                                        </div>
                                      );
                                    })}
                                  </div>
                                </div>
                              )}
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                  {!eyedropperMode && previewTextLayouts.map((layout) => {
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
                              className="block resize-none appearance-none overflow-hidden rounded border-0 bg-white/55 outline-none"
                              style={{
                                width: layout.width,
                                height: layout.height,
                                boxSizing: "border-box",
                                padding: `${TEXT_OVERLAY_TEXT_INSET_Y_EM}em ${TEXT_OVERLAY_TEXT_INSET_X_EM}em`,
                                boxShadow: "inset 0 0 0 1px rgba(0,0,0,0.4)",
                                color: TEXT_OVERLAY_COLORS[layout.colorIndex],
                                WebkitTextFillColor: TEXT_OVERLAY_COLORS[layout.colorIndex],
                                fontSize: layout.fontSize,
                                lineHeight: `${TEXT_OVERLAY_LINE_HEIGHT}`,
                                fontFamily: textOverlayFontFamily(layout.fontIndex),
                                fontWeight: textOverlayFontWeight(layout.fontIndex),
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
                              <button
                                type="button"
                                className="flex h-5 min-w-5 items-center justify-center rounded border border-white bg-black/80 px-1 text-white disabled:cursor-wait"
                                onMouseDown={(e) => e.preventDefault()}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  void switchTextOverlayFont(layout.id);
                                }}
                                disabled={fontLoadingTextId === layout.id}
                                aria-label={`Change font from ${TEXT_OVERLAY_FONTS[normalizeTextFontIndex(layout.fontIndex)].name}`}
                                title={`Font: ${TEXT_OVERLAY_FONTS[normalizeTextFontIndex(layout.fontIndex)].name}. Click to switch to ${TEXT_OVERLAY_FONTS[(normalizeTextFontIndex(layout.fontIndex) + 1) % TEXT_OVERLAY_FONTS.length].name}`}
                              >
                                {fontLoadingTextId === layout.id ? (
                                  <span
                                    aria-hidden="true"
                                    className="h-3 w-3 animate-spin rounded-full border-2 border-white/40 border-t-white"
                                  />
                                ) : (
                                  <span
                                    aria-hidden="true"
                                    className="text-[11px] leading-none"
                                    style={{
                                      fontFamily: textOverlayFontFamily(layout.fontIndex),
                                      fontWeight: textOverlayFontWeight(layout.fontIndex),
                                    }}
                                  >
                                    あ
                                  </span>
                                )}
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
                              width: layout.width,
                              height: layout.height,
                              boxSizing: "border-box",
                              padding: `${TEXT_OVERLAY_TEXT_INSET_Y_EM}em ${TEXT_OVERLAY_TEXT_INSET_X_EM}em`,
                              color: TEXT_OVERLAY_COLORS[layout.colorIndex],
                              WebkitTextFillColor: TEXT_OVERLAY_COLORS[layout.colorIndex],
                              fontSize: layout.fontSize,
                              lineHeight: `${TEXT_OVERLAY_LINE_HEIGHT}`,
                              fontFamily: textOverlayFontFamily(layout.fontIndex),
                              fontWeight: textOverlayFontWeight(layout.fontIndex),
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
                  {!eyedropperMode && !rotationMode && (
                    <div
                      className={`absolute border-2 border-white shadow-[0_0_0_1px_rgba(0,0,0,0.45)] bg-transparent ${mosaicMode || textMode || drawMode ? "pointer-events-none" : "cursor-move"}`}
                      style={{ left: cropRect.x, top: cropRect.y, width: cropRect.w, height: cropRect.h }}
                      onPointerDown={mosaicMode || textMode || drawMode ? undefined : onCropPointerDown}
                    >
                      {cropDragging && (
                        <svg
                          className="absolute inset-0 h-full w-full pointer-events-none"
                          viewBox="0 0 6 6"
                          preserveAspectRatio="none"
                          aria-hidden="true"
                        >
                          <path
                            d="M3,0 V6 M0,3 H6"
                            stroke="rgba(255,255,255,0.72)"
                            strokeWidth="1"
                            vectorEffect="non-scaling-stroke"
                            fill="none"
                          />
                          <path
                            d="M2,0 V6 M4,0 V6 M0,2 H6 M0,4 H6"
                            stroke="rgba(255,255,255,0.52)"
                            strokeWidth="1"
                            vectorEffect="non-scaling-stroke"
                            fill="none"
                          />
                        </svg>
                      )}
                      {!mosaicMode && !textMode && !drawMode && (["nw", "ne", "sw", "se"] as EditCorner[]).map((corner) => {
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
              <div className="flex flex-wrap items-center gap-x-1 gap-y-2 lg:gap-x-2">
                <div className="shrink-0 font-medium">Crop</div>
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
                    setDrawMode(false);
                    setDrawDraft(null);
                    drawCreateState.current = null;
                    drawEditState.current = null;
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
                <div className="lg:hidden min-w-0 text-[10px] text-gray-700 leading-5 font-mono whitespace-nowrap">
                  {cropMarginsText}
                </div>
              </div>
              <div className="hidden lg:block min-w-0 text-[10px] text-gray-700 leading-5 font-mono whitespace-nowrap">
                {cropMarginsText}
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
                    setDrawMode(false);
                    setDrawDraft(null);
                    drawCreateState.current = null;
                    drawEditState.current = null;
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
                  onPointerDown={beginPreviewFastSliderInteraction}
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
                  onPointerDown={beginPreviewFastSliderInteraction}
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
                  title="Auto tone: Exposure, Shadow, Logarithm, then Sigmoid; reset Highlight"
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
                  onPointerDown={beginPreviewFastSliderInteraction}
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
                  onPointerDown={beginPreviewFastSliderInteraction}
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
                  onPointerDown={beginPreviewFastSliderInteraction}
                  min={-10}
                  max={10}
                  step={0.1}
                  value={sigmoid}
                  onChange={(e) => setSigmoid(clampSigmoid(Number(e.target.value)))}
                  onDoubleClick={() => setSigmoid(sliderDefaults.sigmoid)}
                  className="col-start-2 row-start-1 lg:col-span-2 lg:col-start-1 lg:row-start-2 w-full"
                />
              </div>
              <div className="grid grid-cols-[112px_minmax(0,1fr)_56px] lg:grid-cols-2 items-center gap-x-2 gap-y-1">
                <div className="col-start-1 row-start-1 flex min-w-0 items-center gap-1">
                  <span>Shadow</span>
                  <button
                    type="button"
                    className="h-5 rounded border border-gray-300 bg-white px-1 text-[10px] text-gray-700 hover:bg-gray-100 disabled:cursor-default disabled:opacity-60"
                    onClick={onAutoShadow}
                    disabled={autoToneBusy}
                    title="Auto shadow: place the shadow point at post-exposure P2"
                  >
                    Auto
                  </button>
                </div>
                <span className="col-start-3 row-start-1 w-14 text-right lg:w-auto lg:col-start-2 justify-self-end font-mono text-[12px]">{shadow >= 0 ? "+" : ""}{shadow}</span>
                <input
                  aria-label="Shadow"
                  type="range"
                  onPointerDown={beginPreviewFastSliderInteraction}
                  min={-100}
                  max={100}
                  step={1}
                  value={shadow}
                  onChange={(e) => setShadow(clampToneRangeAdjustment(Number(e.target.value)))}
                  onDoubleClick={() => setShadow(sliderDefaults.shadow)}
                  className="col-start-2 row-start-1 lg:col-span-2 lg:col-start-1 lg:row-start-2 w-full"
                />
              </div>
              <label className="grid grid-cols-[112px_minmax(0,1fr)_56px] lg:grid-cols-2 items-center gap-x-2 gap-y-1">
                <span className="col-start-1 row-start-1">Highlight</span>
                <span className="col-start-3 row-start-1 w-14 text-right lg:w-auto lg:col-start-2 justify-self-end font-mono text-[12px]">{highlight >= 0 ? "+" : ""}{highlight}</span>
                <input
                  aria-label="Highlight"
                  type="range"
                  onPointerDown={beginPreviewFastSliderInteraction}
                  min={-100}
                  max={100}
                  step={1}
                  value={highlight}
                  onChange={(e) => setHighlight(clampToneRangeAdjustment(Number(e.target.value)))}
                  onDoubleClick={() => setHighlight(sliderDefaults.highlight)}
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
                  onPointerDown={beginPreviewFastSliderInteraction}
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
                  onPointerDown={beginPreviewFastSliderInteraction}
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

            <div className="rounded border p-3 space-y-2 lg:space-y-3">
              <div className="font-medium">Finishing</div>
              <div className="grid grid-cols-[112px_minmax(0,1fr)_56px] lg:grid-cols-2 items-center gap-x-2 gap-y-1">
                <div className="col-start-1 row-start-1 flex min-w-0 items-center gap-1">
                  <span>Resize</span>
                  {([
                    ["1MP", 1_000_000],
                    ["4MP", 4_000_000],
                  ] as const).map(([label, targetPixels]) => (
                    <button
                      key={label}
                      type="button"
                      className="h-5 rounded border border-gray-300 bg-white px-1 text-[10px] text-gray-700 hover:bg-gray-100"
                      onClick={() => applyResizeTargetPixels(targetPixels)}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                <span className="col-start-3 row-start-1 w-14 text-right lg:w-auto lg:col-start-2 justify-self-end font-mono text-[12px]">{resizePercent}%</span>
                <input
                  type="range"
                  onPointerDown={beginPreviewFastSliderInteraction}
                  aria-label="Resize"
                  min={1}
                  max={100}
                  step={1}
                  value={resizePercent}
                  onChange={(e) => setResizePercent(Math.min(100, Math.max(1, Number(e.target.value) || 100)))}
                  onDoubleClick={() => setResizePercent(sliderDefaults.resizePercent)}
                  className="col-start-2 row-start-1 lg:col-span-2 lg:col-start-1 lg:row-start-2 w-full"
                />
              </div>
              <label className="grid grid-cols-[112px_minmax(0,1fr)_56px] lg:grid-cols-2 items-center gap-x-2 gap-y-1">
                <span className="col-start-1 row-start-1">Sharpen</span>
                <span className="col-start-3 row-start-1 w-14 text-right lg:w-auto lg:col-start-2 justify-self-end font-mono text-[12px]">{sharpen}</span>
                <input
                  type="range"
                  onPointerDown={beginPreviewFastSliderInteraction}
                  aria-label="Sharpen"
                  min={0}
                  max={3}
                  step={1}
                  value={sharpen}
                  onChange={(e) => setSharpen(clampSharpen(Number(e.target.value)))}
                  onDoubleClick={() => setSharpen(sliderDefaults.sharpen)}
                  className="col-start-2 row-start-1 lg:col-span-2 lg:col-start-1 lg:row-start-2 w-full"
                />
              </label>
            </div>
          </div>
        </div>

        <div className="mt-4 flex flex-col gap-2 lg:flex-row lg:items-center">
          <div className="flex flex-col gap-y-0.5 text-[12px] text-gray-600 font-mono whitespace-nowrap lg:mr-auto lg:flex-row lg:flex-nowrap lg:gap-x-6 lg:gap-y-0">
            <span>
              Input ({natural ? `${natural.w}x${natural.h}, ${(natural.w * natural.h / 1_000_000).toFixed(1)}MP` : "—"})
            </span>
            <span>
              Output ({outputDimensions ? `${outputDimensions.w}x${outputDimensions.h}, ${(outputDimensions.w * outputDimensions.h / 1_000_000).toFixed(1)}MP` : "—"})
            </span>
          </div>
          <div className="flex justify-end gap-2">
            <button
              className="px-3 py-1 rounded border border-gray-300 bg-white hover:bg-gray-100 disabled:opacity-50"
              onClick={onCancel}
              disabled={applyBusy}
            >
              Cancel
            </button>
            <button
              className="px-3 py-1 rounded border border-blue-700 bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"
              onClick={onSubmit}
              disabled={applyBusy}
            >
              Edit
            </button>
          </div>
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
  const rawDevelopmentCacheRef = useRef<RawDevelopmentCacheEntry | null>(null);

  const storeRawDevelopmentCache = useCallback((
    itemId: string,
    file: File,
    decoded: DecodedRgbImage16,
  ) => {
    const cached = rawDevelopmentCacheRef.current;
    if (cached?.itemId === itemId && cached.file === file && cached.decoded === decoded) {
      return;
    }
    if (cached?.decoded !== decoded) cached?.decoded.cleanup();
    rawDevelopmentCacheRef.current = { itemId, file, decoded };
  }, []);

  useEffect(() => {
    const cached = rawDevelopmentCacheRef.current;
    if (!cached) return;
    const stillSelected = files
      .slice(0, maxCount)
      .some((item) => item.id === cached.itemId && item.file === cached.file);
    if (!stillSelected) {
      cached.decoded.cleanup();
      rawDevelopmentCacheRef.current = null;
    }
  }, [files, maxCount]);

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
          let decodedForOptimize: DecodedImage | undefined;
          if (isRawImageFile(f.name, f.type)) {
            const cached = rawDevelopmentCacheRef.current;
            if (cached?.itemId === f.id && cached.file === f.file) {
              decodedForOptimize = cached.decoded;
            } else {
              decodedForOptimize = await decodeImage(
                f.file,
                meta.width ?? 0,
                meta.height ?? 0,
                f.name,
                f.type,
              );
              if (cancelled) return;
              storeRawDevelopmentCache(f.id, f.file, decodedForOptimize);
            }
          }

          const out = await buildOptimizedVariant(
            f.file,
            meta.width ?? 0,
            meta.height ?? 0,
            0.8,
            f.name,
            f.type,
            buildUploadDefaultEditParams(
              f.name,
              f.type,
              meta.width ?? 0,
              meta.height ?? 0,
            ),
            "image/webp",
            decodedForOptimize,
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
  }, [files, maxCount, SINGLE_LIMIT, storeRawDevelopmentCache]);

  useEffect(() => {
    return () => {
      for (const url of revokeQueue.current) URL.revokeObjectURL(url);
      revokeQueue.current = [];
      rawDevelopmentCacheRef.current?.decoded.cleanup();
      rawDevelopmentCacheRef.current = null;
    };
  }, []);

  const reprocessItem = useCallback(async (
    snapshot: SelectedItem,
    nextEdit: ImageEditParams,
    decodedImage?: DecodedImage,
  ) => {
    let processingDecoded = decodedImage;
    let cleanupProcessingDecoded = !!decodedImage;

    if (
      isRawImageFile(snapshot.name, snapshot.type) &&
      decodedImage
    ) {
      storeRawDevelopmentCache(snapshot.id, snapshot.file, decodedImage);
      processingDecoded = decodedImage;
      cleanupProcessingDecoded = false;
    } else if (isRawImageFile(snapshot.name, snapshot.type) && !decodedImage) {
      const cached = rawDevelopmentCacheRef.current;
      if (cached?.itemId === snapshot.id && cached.file === snapshot.file) {
        processingDecoded = cached.decoded;
        cleanupProcessingDecoded = false;
      }
    }

    if (!snapshot.width || !snapshot.height) {
      if (cleanupProcessingDecoded) processingDecoded?.cleanup();
      return;
    }
    const token = (optimizeJobs.current.get(snapshot.id) || 0) + 1;
    optimizeJobs.current.set(snapshot.id, token);
    setItems((prev) =>
      prev.map((x) =>
        x.id === snapshot.id
          ? {
              ...x,
              edit: nextEdit,
              reuse: isMeaningfullyEdited(
                nextEdit,
                x.width,
                x.height,
                buildUploadDefaultEditParams(x.name, x.type, x.width, x.height),
              )
                ? false
                : x.reuse,
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
        "image/webp",
        processingDecoded,
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
    } finally {
      if (cleanupProcessingDecoded) processingDecoded?.cleanup();
    }
  }, [storeRawDevelopmentCache]);

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
      const hasMeaningfulEdit = isMeaningfullyEdited(
        it.edit,
        it.width,
        it.height,
        buildUploadDefaultEditParams(it.name, it.type, it.width, it.height),
      );

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
          initialParams={normalizeEditParams(
            editingItem.edit ??
              buildUploadDefaultEditParams(
                editingItem.name,
                editingItem.type,
                editingItem.width,
                editingItem.height,
              ),
            editingItem.width,
            editingItem.height,
          )}
          defaultParams={buildUploadDefaultEditParams(
            editingItem.name,
            editingItem.type,
            editingItem.width,
            editingItem.height,
          )}
          initialDecodedImage={
            rawDevelopmentCacheRef.current?.itemId === editingItem.id &&
            rawDevelopmentCacheRef.current.file === editingItem.file
              ? rawDevelopmentCacheRef.current.decoded
              : undefined
          }
          onRawDevelopmentReady={(decodedImage) => {
            storeRawDevelopmentCache(editingItem.id, editingItem.file, decodedImage);
          }}
          onCancel={() => setEditingItemId(null)}
          onError={(message) => {
            setEditingItemId(null);
            setItems((prev) =>
              prev.map((x) =>
                x.id === editingItem.id ? { ...x, status: "error", error: message } : x,
              ),
            );
          }}
          onApply={(params, decodedImage) => {
            setEditingItemId(null);
            void reprocessItem(editingItem, params, decodedImage);
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
              const hasMeaningfulEdit = isMeaningfullyEdited(
                it.edit,
                it.width,
                it.height,
                buildUploadDefaultEditParams(it.name, it.type, it.width, it.height),
              );
              const isUsingExistingData = !!(it.reusableUserId && it.reusableRestPath && it.reuse);
              return (
                <li
                  key={it.id}
                  className="w-[70vw] sm:w-[44vw] md:w-[28vw] lg:w-[24vw] xl:w-[22vw] rounded border bg-white overflow-hidden mx-auto"
                >
                  <div className="relative w-full aspect-video bg-gray-50">
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

                  <div className="p-3 text-sm text-gray-800 space-y-2 min-w-0 sm:min-w-[260px]">
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
