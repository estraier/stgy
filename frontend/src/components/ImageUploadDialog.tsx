"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState, useCallback } from "react";
import NextImage from "next/image";
import { createPortal } from "react-dom";
import { ChevronDown, ChevronUp, Move, Palette, Pipette, RotateCw } from "lucide-react";
import { formatBytes } from "@/utils/format";
import {
  buildRawLensfunCorrection,
  lensfunVignettingGainInto,
  summarizeLensfunCorrection,
  type LensfunCorrection,
  type RawLensMetadata,
} from "@/image/lensfun";
import { Config } from "@/config";
import {
  createLibRawInstance,
  createLibRawWorkerFailure,
  isRawImageFile,
  resolveLibRawOpenMpThreads,
  resolveLibRawRuntimeMode,
  type LibRawImageDataLike,
  type LibRawInstanceLike,
  type LibRawMetadataLike,
  type LibRawSettingsLike,
  type LibRawThumbnailDataLike,
} from "@/image/libraw";
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
  RawDevelopmentRawGeometry,
  RawDevelopmentCropSettings,
  RawDenoiseDevelopmentResult,
  RawDenoiseSettings,
  RawDenoiseWeightMap,
  RawDevelopmentLuminanceSettings,
  RawDevelopmentSaturationSettings,
  RawDevelopmentSettings,
  RawDevelopmentTiming,
  RawDevelopmentTimingEntry,
  ToneAutoSample,
} from "./image-editor/types";
export type { DecodedImage, ImageEditOutputColorProfile } from "./image-editor/types";
import {
  ROLLOFF_SAVING_LIMIT_FACTOR,
  SATURATION_ROLLOFF_A,
  SIGMOID_WORKING_GAMMA,
  applyColorAdjustmentsAfterToneLinearRgbInto,
  applyColorAdjustmentsLinearRgbInto,
  applyHsvSaturationPreservingProPhotoLuminance,
  applyLuminanceGainPreservingAboveOneLinearRgbInto,
  applyToneAdjustmentsLinearRgbInto,
  applyRolloffScalar,
  applyScaledLogLinear,
  applyScaledLogLinearExtended,
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
  rgbToHsvExtended,
  rolloffParams as toneRolloffParams,
  srgbChannelToLinear,
  whiteBalanceGains,
  type ColorAdjustmentContext,
} from "@/image/tone";
import {
  PROPHOTO_LUMA_B,
  PROPHOTO_LUMA_G,
  PROPHOTO_LUMA_R,
  convertLinearProPhotoToOutputRgb,
  convertLinearProPhotoToOutputRgbInto,
  encodedRgbToLinearProphoto,
  encodedRgbToLinearProphotoInto,
} from "@/image/color";
import { createCanvasImageData, getCanvas2dContext, getCanvasImageData } from "./image-editor/canvas";
import { applySharpenToCanvas, applySharpenToRgb16 } from "./image-editor/sharpen";
import { applyDenoiseToCanvas, applyDenoiseToRgb16, clampDenoise } from "./image-editor/denoise";
import {
  DEFRINGE_ANALYSIS_TARGET_PIXELS,
  analyzeDefringeSample,
  applyDefringeLinearRgbInto,
  applyDefringeToRenderedSample,
  type DefringeAnalysisMap,
} from "./image-editor/defringe";
import {
  buildImageEditClarityMap,
  buildImageEditClarityMapFromToneSample,
  buildImageEditToneSample,
  clampClarity,
  isUsableImageEditClarityMap,
  sampleImageEditClarityGain,
  type ImageEditClarityMap,
} from "./image-editor/clarity";
import {
  buildRenderedPixelToSourceTransform,
  createRgb16SamplingScratch,
  decodeStoredRgb16Channel,
  encodeStoredRgb16Channel,
  analysisSampleDimensions,
  clearRgb16SampleCaches,
  getAnalysisLinearRgbSample,
  getRenderedLinearRgbSample,
  inverseRotatePoint,
  normalizeRotationDegrees,
  rotatePoint,
  sampleLinearRgb16BilinearInto,
  type LinearRgbBuffer,
} from "./image-editor/sampling";
import {
  buildInteractiveColorAdjustmentContextFromLinearRgbSample,
  computeHistogramDataFromRgb16,
  createToneAutoSampleFromRgb16,
  findAutoExposure,
  findAutoLogarithm,
  findAutoSigmoid,
  percentileFromValues,
  percentilesFromValues,
} from "./image-editor/analysis";
import {
  buildImageEditPreviewSliderPrefixSample,
  isTonePreviewSliderStage,
  renderAdjustedLinearRgbSampleToCanvas,
  renderAdjustedRgb16ToCanvas,
  renderAdjustedRgb16RegionToCanvas,
  type ImageEditPreviewSliderStage,
} from "./image-editor/render";
import {
  RAW_DEVELOPED_LINEAR_RANGE_MAX,
  RAW_DEVELOPED_ROLLOFF_A,
  analyzeRawDenoiseMask,
  applyRawColorPass,
  applyRawFallbackBaselinePass,
  applyRawMatchedTonePass,
  developRawMasterOnePassToGamma20,
  mergeRawDenoiseGamma20InPlaceRows,
  rawLensfunOutputDimensions,
  rawLensfunOutputRegion,
  resampleRawWithLensfunToGamma20,
  type RawColorPassPlan,
  type RawFallbackPlan,
  type RawLensfunCorrectionMaps,
  type RawMatchedTonePlan,
  type RawOutputCrop,
} from "./image-editor/raw-development-core";
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
  fillColorIndex: number | null;
};

export type ImageVignetteOverlay = {
  id: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  strengthEv: number;
};

export type ImageMonochromePreset = "rec709" | "rec601" | "average" | "red" | "yellow" | "blue";
export type ImagePhotochemicalFilterPreset =
  | "sepia"
  | "cyanotype"
  | "cross-process"
  | "bleach-bypass"
  | "negative"
  | "solarization";
export type ImageChannelSwapPreset =
  | "swap-rgb-rbg"
  | "swap-rgb-grb"
  | "swap-rgb-gbr"
  | "swap-rgb-brg"
  | "swap-rgb-bgr";
export type ImageDichromePreset =
  | "dichrome-rk"
  | "dichrome-yk"
  | "dichrome-gk"
  | "dichrome-ck"
  | "dichrome-bk"
  | "dichrome-mk"
  | "dichrome-rg"
  | "dichrome-bg"
  | "dichrome-rb";
export type ImageTrichromePreset = "trichrome-yb" | "trichrome-rc" | "trichrome-gm";
export type ImagePartColorPreset =
  | "part-color-red"
  | "part-color-yellow"
  | "part-color-green"
  | "part-color-cyan"
  | "part-color-blue"
  | "part-color-magenta";
export type ImageDuotonePreset =
  | "duotone-red"
  | "duotone-yellow"
  | "duotone-green"
  | "duotone-cyan"
  | "duotone-blue"
  | "duotone-magenta";
export type ImageEdgePreset = "edge-canny" | "edge-xdog" | "edge-multiscale";
export type ImageOtherFilterPreset =
  | ImageChannelSwapPreset
  | ImageDichromePreset
  | ImageTrichromePreset
  | ImagePartColorPreset
  | ImageDuotonePreset
  | ImageEdgePreset
  | "classic-chrome"
  | "velvia";
export type ImageNonMonochromeFilterPreset = ImagePhotochemicalFilterPreset | ImageOtherFilterPreset;

export type ImageFilter =
  | {
      kind: "monochrome";
      preset: ImageMonochromePreset;
    }
  | {
      kind: "other";
      preset: ImageNonMonochromeFilterPreset;
    };

export type ImageEditParams = {
  crop: ImageCropInsets;
  rotationDegrees: number;
  temperature: number;
  tint: number;
  denoise: number;
  defringe: number;
  exposureEv: number;
  shadow: number;
  highlight: number;
  scaledLog: number;
  sigmoid: number;
  clarity: number;
  vibrance: number;
  saturation: number;
  resizePercent: number;
  sharpen: number;
  mosaicRegions: ImageMosaicRegion[];
  textOverlays: ImageTextOverlay[];
  drawOverlays: ImageDrawOverlay[];
  vignetteOverlay: ImageVignetteOverlay | null;
  filter: ImageFilter | null;
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

type ImageLoadEmbeddedPreview = {
  blob: Blob;
  width: number;
  height: number;
  sourceWidth?: number;
  sourceHeight?: number;
};

type ImageLoadProgress = {
  stage: string;
  embeddedPreview?: ImageLoadEmbeddedPreview;
  rawTiming?: RawDevelopmentTiming;
};

type ImageLoadProgressListener = (progress: ImageLoadProgress) => void;

const RAW_USE_THUMBNAIL = true;
const RAW_TONE_SLOPE_EPSILON = 1e-5;
const RAW_MEDIAN_DENOISE_WEAK_ISO = 800;
const RAW_MEDIAN_DENOISE_STRONG_ISO = 3200;
const RAW_THUMBNAIL_MATCH_ITERATIONS = 20;
const RAW_THUMBNAIL_MATCH_SEARCH_STEPS = 24;
const RAW_THUMBNAIL_MATCH_GAIN_MAX = 1 << 16;
const RAW_THUMBNAIL_MATCH_LOG_MIN = -3;
const RAW_THUMBNAIL_MATCH_LOG_MAX = 3;
const RAW_THUMBNAIL_MATCH_SIGMOID_MIN = -3;
const RAW_THUMBNAIL_MATCH_SIGMOID_MAX = 3;
const RAW_THUMBNAIL_MATCH_SIGMOID_STEP = 0.1;
const RAW_THUMBNAIL_MATCH_EXPOSURE_RELAXATION = 0.7;
const RAW_THUMBNAIL_MATCH_LOG_RELAXATION = 0.3;
const RAW_THUMBNAIL_MATCH_SIGMOID_RELAXATION = 0.2;
const RAW_THUMBNAIL_MATCH_RELAXATION_FINAL_SCALE = 0.5;
const RAW_THUMBNAIL_MATCH_COLOR_ITERATIONS = 20;
const RAW_THUMBNAIL_MATCH_SATURATION_RELAXATION = 0.7;
const RAW_THUMBNAIL_MATCH_VIBRANCE_RELAXATION = 0.5;
const RAW_THUMBNAIL_MATCH_VIBRANCE_SEARCH_STEPS = 8;
const RAW_THUMBNAIL_MATCH_SATURATION_PERCENTILE = 95;
const RAW_THUMBNAIL_MATCH_VIBRANCE_PERCENTILE = 50;
const RAW_THUMBNAIL_MATCH_COLOR_AUTO_MIN = -5;
const RAW_THUMBNAIL_MATCH_COLOR_VALUE_LOWER_PERCENTILES = [20, 25, 30, 35, 40, 45, 50, 55, 60] as const;
const RAW_THUMBNAIL_MATCH_COLOR_VALUE_UPPER_PERCENTILE = 90;
const RAW_THUMBNAIL_MATCH_COLOR_VALUE_MIN = 0.2;
const DEBUG_PERCENTILES = [0, 1, 2, 5, 25, 50, 75, 90, 91, 92, 93, 94, 95, 96, 97, 98, 99, 100] as const;
const RAW_THUMBNAIL_MATCH_SAMPLE_TARGET_PIXELS = 65_536;
const RAW_EDITOR_PREVIEW_TARGET_PIXELS = 1_000_000;
const RAW_DENOISE_FULL_ISO = 800;
const IMAGE_EDIT_CLAHE_MIN_PIXELS = 80 * 256 * 20; // 409,600 pixels.
const RAW_PREVIEW_DEMOSAIC_QUALITY: RawDemosaicQuality = 2;

type DebugPercentileValues = number[];

type DebugPercentileStatistics = {
  luminance: DebugPercentileValues;
  saturation: DebugPercentileValues;
};

type RawThumbnailColorTarget = {
  lowerValuePercentile: number;
  saturationP95: number;
  saturationP50: number;
};

type RawThumbnailMatchReference = {
  lumaPercentiles: DebugPercentileValues;
  saturationPercentiles: DebugPercentileValues;
  linearSrgbSample: Float32Array;
  colorTargets?: RawThumbnailColorTarget[];
};

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

async function rawEditableThumbnailToDecoded(
  preview: ImageLoadEmbeddedPreview,
): Promise<DecodedRgbImage16> {
  let source: CanvasImageSource | null = null;
  let cleanup = () => {};
  try {
    try {
      const bitmap = await createImageBitmap(preview.blob, { colorSpaceConversion: "default" });
      source = bitmap;
      cleanup = () => bitmap.close?.();
    } catch {
      const file = new File([preview.blob], "raw-thumbnail.jpg", { type: preview.blob.type || "image/jpeg" });
      source = await decodeViaImg(file);
    }
    if (!source) throw new Error("Embedded RAW thumbnail decode failed");
    const width = Math.max(1, Math.round(Number(
      (source as ImageBitmap).width
      || (source as HTMLImageElement).naturalWidth
      || preview.width,
    )));
    const height = Math.max(1, Math.round(Number(
      (source as ImageBitmap).height
      || (source as HTMLImageElement).naturalHeight
      || preview.height,
    )));
    return canvasSourceToDecodedRgb16(source, width, height, "srgb");
  } finally {
    cleanup();
  }
}

type RawEditableThumbnailWorkerResponse = {
  type: "editable-thumbnail-complete";
  width: number;
  height: number;
  dataBuffer: ArrayBuffer;
};

function createRawEditableThumbnailWorker(): Worker | null {
  if (typeof Worker !== "function") return null;
  try {
    return new Worker(new URL("./image-editor/raw-editable-thumbnail.worker.ts", import.meta.url), {
      type: "module",
    });
  } catch {
    return null;
  }
}

async function rawEditableThumbnailToDecodedParallel(
  preview: ImageLoadEmbeddedPreview,
): Promise<DecodedRgbImage16> {
  const worker = createRawEditableThumbnailWorker();
  if (!worker) return rawEditableThumbnailToDecoded(preview);
  try {
    const response = await new Promise<RawEditableThumbnailWorkerResponse>((resolve, reject) => {
      let timeoutId: ReturnType<typeof setTimeout> | null = null;
      const cleanup = () => {
        if (timeoutId !== null) {
          clearTimeout(timeoutId);
          timeoutId = null;
        }
        worker.removeEventListener("message", onMessage);
        worker.removeEventListener("error", onError);
        worker.removeEventListener("messageerror", onMessageError);
      };
      const onMessage = (event: MessageEvent) => {
        const payload = event.data as RawEditableThumbnailWorkerResponse | { type?: string; message?: string };
        if (payload?.type === "error") {
          cleanup();
          reject(new Error(payload.message || "Editable thumbnail worker failed"));
          return;
        }
        if (payload?.type !== "editable-thumbnail-complete") return;
        cleanup();
        resolve(payload as RawEditableThumbnailWorkerResponse);
      };
      const onError = (event: ErrorEvent) => {
        cleanup();
        reject(new Error(event.message || "Editable thumbnail worker failed"));
      };
      const onMessageError = () => {
        cleanup();
        reject(new Error("Editable thumbnail worker message failed"));
      };
      worker.addEventListener("message", onMessage);
      worker.addEventListener("error", onError);
      worker.addEventListener("messageerror", onMessageError);
      timeoutId = setTimeout(() => {
        cleanup();
        reject(new Error("Editable thumbnail worker timed out"));
      }, 30_000);
      worker.postMessage({
        type: "build-editable-thumbnail",
        blob: preview.blob,
        width: preview.width,
        height: preview.height,
      });
    });
    return {
      colorSpace: "prophoto",
      transfer: "gamma20",
      linearRangeMax: 1,
      width: response.width,
      height: response.height,
      data: new Uint16Array(response.dataBuffer),
      cleanup: () => {},
    };
  } catch {
    return rawEditableThumbnailToDecoded(preview);
  } finally {
    worker.terminate();
  }
}

async function readRawMeta(file: File): Promise<EditableImageMeta> {
  let raw: LibRawInstanceLike | null = null;
  let workerFailure: ReturnType<typeof createLibRawWorkerFailure> | null = null;
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  try {
    raw = await createLibRawInstance();
    workerFailure = createLibRawWorkerFailure(raw);
    const timeout = new Promise<never>((_, reject) => {
      timeoutId = setTimeout(
        () => reject(new Error("RAW decoder did not respond while reading metadata.")),
        30_000,
      );
    });
    await Promise.race([
      raw.open(new Uint8Array(await file.arrayBuffer())),
      workerFailure.promise,
      timeout,
    ]);
    const meta = await Promise.race([
      raw.metadata(false),
      workerFailure.promise,
      timeout,
    ]);
    const width = Number(meta?.width || 0);
    const height = Number(meta?.height || 0);
    if (width > 0 && height > 0) {
      return { decodable: false, width, height };
    }
    return { decodable: false };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`RAW metadata probe failed: ${message}`);
  } finally {
    if (timeoutId !== null) clearTimeout(timeoutId);
    workerFailure?.cleanup();
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
  const fillColorIndex = type === "line" ? null : normalizeOptionalTextColorIndex(overlay.fillColorIndex);
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
    fillColorIndex,
  };
}

function normalizeDrawOverlays(overlays?: ImageDrawOverlay[]): ImageDrawOverlay[] {
  if (!overlays?.length) return [];
  return overlays
    .map((overlay) => normalizeDrawOverlay(overlay))
    .filter((overlay): overlay is ImageDrawOverlay => overlay !== null);
}

const MONOCHROME_PRESET_LABELS: Record<ImageMonochromePreset, string> = {
  rec709: "Rec 709",
  rec601: "Rec 601",
  average: "Average",
  red: "Red",
  yellow: "Yellow",
  blue: "Blue",
};

const MONOCHROME_PRESET_WEIGHTS: Record<ImageMonochromePreset, readonly [number, number, number]> = {
  rec709: [0.2126, 0.7152, 0.0722],
  rec601: [0.299, 0.587, 0.114],
  average: [1 / 3, 1 / 3, 1 / 3],
  red: [0.545, 0.44, 0.015],
  yellow: [0.295, 0.683, 0.022],
  blue: [0.098, 0.236, 0.666],
};

const PHOTOCHEMICAL_FILTER_LABELS: Record<ImagePhotochemicalFilterPreset, string> = {
  sepia: "Sepia",
  cyanotype: "Cyanotype",
  negative: "Negative",
  solarization: "Solarization",
  "cross-process": "Cross Process",
  "bleach-bypass": "Bleach Bypass",
};

const PHOTOCHEMICAL_PRESET_SEQUENCE: readonly ImagePhotochemicalFilterPreset[] = [
  "sepia",
  "cyanotype",
  "negative",
  "solarization",
  "cross-process",
  "bleach-bypass",
];

const SWAP_RGB_PRESET_SEQUENCE: readonly ImageChannelSwapPreset[] = [
  "swap-rgb-bgr",
  "swap-rgb-gbr",
  "swap-rgb-brg",
  "swap-rgb-rbg",
  "swap-rgb-grb",
];

const DICHROME_PRESET_SEQUENCE: readonly ImageDichromePreset[] = [
  "dichrome-rk",
  "dichrome-yk",
  "dichrome-gk",
  "dichrome-ck",
  "dichrome-bk",
  "dichrome-mk",
  "dichrome-rg",
  "dichrome-bg",
  "dichrome-rb",
];

const TRICHROME_PRESET_SEQUENCE: readonly ImageTrichromePreset[] = [
  "trichrome-yb",
  "trichrome-rc",
  "trichrome-gm",
];

const PART_COLOR_PRESET_SEQUENCE: readonly ImagePartColorPreset[] = [
  "part-color-red",
  "part-color-yellow",
  "part-color-green",
  "part-color-cyan",
  "part-color-blue",
  "part-color-magenta",
];

const DUOTONE_PRESET_SEQUENCE: readonly ImageDuotonePreset[] = [
  "duotone-red",
  "duotone-yellow",
  "duotone-green",
  "duotone-cyan",
  "duotone-blue",
  "duotone-magenta",
];

const OTHER_FILTER_LABELS: Record<Extract<ImageOtherFilterPreset, "classic-chrome" | "velvia">, string> = {
  velvia: "Velvia",
  "classic-chrome": "C. Chrome",
};

const EDGE_PRESET_SEQUENCE: readonly ImageEdgePreset[] = [
  "edge-canny",
  "edge-xdog",
  "edge-multiscale",
] as const;

const TRICHROME_TARGET_PERCENTILE = 0.50;
const SOLARIZATION_PEAK = 0.97;
const SOLARIZATION_TARGET_PERCENTILE = 0.50;

const EDGE_PYRAMID_MIN_AREA = 200_000;
const EDGE_SOBEL_WEIGHT = 0.55;
const EDGE_LAPLACIAN_WEIGHT = 0.45;
const EDGE_LEVEL_WEIGHT_DECAY = 0.78;
const EDGE_LEVEL_RESPONSE_GAIN = 4.0;
const EDGE_OUTPUT_GAMMA = 0.7;
const EDGE_CANNY_GAUSSIAN_SIGMA = 1.1;
const EDGE_CANNY_HIGH_PERCENTILE = 0.90;
const EDGE_CANNY_LOW_THRESHOLD_RATIO = 0.45;
const EDGE_CANNY_OUTPUT_GAMMA = 0.9;
const EDGE_XDOG_SIGMA = 0.8;
const EDGE_XDOG_SIGMA_RATIO = 1.6;
const EDGE_XDOG_TAU = 0.98;
const EDGE_XDOG_EPSILON = 0.01;
const EDGE_XDOG_PHI = 12;
const EDGE_XDOG_OUTPUT_GAMMA = 0.8;

const SEPIA_GRAIN_AMOUNT = 0.002;
const SEPIA_GRAIN_SHADOW_EXPONENT = 1.1;
const CYANOTYPE_GRAIN_AMOUNT = 0.003;
const CYANOTYPE_GRAIN_SHADOW_EXPONENT = 1.1;
const SEPIA_MATERIAL_R = 0.020;
const SEPIA_MATERIAL_G = 0.010;
const SEPIA_MATERIAL_B = 0.002;
const CYANOTYPE_MATERIAL_R = 0.001;
const CYANOTYPE_MATERIAL_G = 0.015;
const CYANOTYPE_MATERIAL_B = 0.130;
const SEPIA_AGED_PAPER_R = 0.832402;
const SEPIA_AGED_PAPER_G = 0.736109;
const SEPIA_AGED_PAPER_B = 0.515596;
const CYANOTYPE_AGED_PAPER_R = 0.793110;
const CYANOTYPE_AGED_PAPER_G = 0.717623;
const CYANOTYPE_AGED_PAPER_B = 0.546751;
const PHOTOCHEMICAL_GRAIN_FINE_CYCLES_PER_DIAGONAL = 900;
const PHOTOCHEMICAL_GRAIN_COARSE_CYCLES_PER_DIAGONAL = 260;
const PHOTOCHEMICAL_PAPER_BROAD_CYCLES_PER_DIAGONAL = 3;
const PHOTOCHEMICAL_PAPER_MEDIUM_CYCLES_PER_DIAGONAL = 7;
const PHOTOCHEMICAL_STAIN_BROAD_CYCLES_PER_DIAGONAL = 12;
const PHOTOCHEMICAL_STAIN_MEDIUM_CYCLES_PER_DIAGONAL = 24;
const PHOTOCHEMICAL_STAIN_MAX_OPACITY = 0.02;
const PHOTOCHEMICAL_TARGET_PERCENTILE = 0.50;
const CROSS_PROCESS_TONE_MIX = 0.95;
const CROSS_PROCESS_CONTRAST_LOW_PERCENTILE = 0.10;
const CROSS_PROCESS_TARGET_PERCENTILE = 0.50;
const CROSS_PROCESS_CONTRAST_HIGH_PERCENTILE = 0.90;
const BLEACH_BYPASS_SATURATION_SHADOW = 0.45;
const BLEACH_BYPASS_SATURATION_HIGHLIGHT = 0.95;
const BLEACH_BYPASS_VIBRANCE_SHADOW = -0.35;
const BLEACH_BYPASS_VIBRANCE_HIGHLIGHT = -0.08;
const BLEACH_BYPASS_SATURATION_SAME_HUE = 1.0;
const BLEACH_BYPASS_SATURATION_OPPOSITE_HUE = 0.95;
const BLEACH_BYPASS_VIBRANCE_SAME_HUE = -0.35;
const BLEACH_BYPASS_VIBRANCE_OPPOSITE_HUE = -0.08;
const BLEACH_BYPASS_VALUE_AMOUNT = 0.5;
const BLEACH_BYPASS_TARGET_HUE_DEGREES = 200;
const BLEACH_BYPASS_SATURATION_DISTANCE_MAX_DEGREES = 180;
const BLEACH_BYPASS_HUE_EXPONENT = 1.2;
const BLEACH_BYPASS_TARGET_PERCENTILE = 0.50;
const CLASSIC_CHROME_CONTRAST_LOW_PERCENTILE = 0.10;
const CLASSIC_CHROME_TARGET_PERCENTILE = 0.50;
const CLASSIC_CHROME_CONTRAST_HIGH_PERCENTILE = 0.90;
const CLASSIC_CHROME_TARGET_CONTRAST_SCALE = 1.10;
const CLASSIC_CHROME_CALIBRATION_STRENGTH = 0.40;
const CLASSIC_CHROME_GLOBAL_SATURATION = 0.95;
const CLASSIC_CHROME_VIBRANCE = -0.15;
const CLASSIC_CHROME_SHADOW_GREEN_AMOUNT = 0.006;
const CLASSIC_CHROME_HIGHLIGHT_EV = 0.10;
const CLASSIC_CHROME_SHADOW_EV = -0.05;
const CLASSIC_CHROME_WHITE_EV = -0.16;
const CLASSIC_CHROME_HUE_ADJUSTMENTS: readonly (readonly [number, number])[] = [
  [0, -5],
  [30, 0],
  [60, 5],
  [120, 10],
  [180, 5],
  [240, 0],
  [270, 0],
  [300, 0],
  [360, -5],
];
const CLASSIC_CHROME_LUMINANCE_ADJUSTMENTS: readonly (readonly [number, number])[] = [
  [0, 5],
  [30, -5],
  [60, -10],
  [120, -10],
  [180, -10],
  [240, -10],
  [270, -10],
  [300, -5],
  [360, 5],
];
const VELVIA_CONTRAST_LOW_PERCENTILE = 0.10;
const VELVIA_TARGET_PERCENTILE = 0.50;
const VELVIA_CONTRAST_HIGH_PERCENTILE = 0.90;
const VELVIA_TARGET_CONTRAST_SCALE = 1.05;
const VELVIA_CALIBRATION_STRENGTH = 0.45;
const VELVIA_VIBRANCE = 0.25;
const VELVIA_SHADOW_MAGENTA_AMOUNT = 0.009;
const VELVIA_BLACK_EV = -0.20;
const VELVIA_SHADOW_EV = 0.04;
const VELVIA_HIGHLIGHT_EV = -0.04;
const VELVIA_WHITE_EV = -0.18;
const VELVIA_HUE_ADJUSTMENTS: readonly (readonly [number, number])[] = [
  [0, 1],
  [30, -2],
  [60, -5],
  [120, 5],
  [180, 10],
  [240, 5],
  [270, 0],
  [300, 0],
  [360, 1],
];
const VELVIA_SATURATION_ADJUSTMENTS: readonly (readonly [number, number])[] = [
  [0, 0],
  [30, 0],
  [60, -10],
  [120, -5],
  [180, 0],
  [240, 0],
  [270, 0],
  [300, 0],
  [360, 0],
];
const VELVIA_LUMINANCE_ADJUSTMENTS: readonly (readonly [number, number])[] = [
  [0, 40],
  [30, 15],
  [60, -5],
  [120, -5],
  [180, -5],
  [240, -5],
  [270, 15],
  [300, 30],
  [360, 40],
];
const FILTER_HUE_GATE_SATURATION_LOW = 0.02;
const FILTER_HUE_GATE_SATURATION_HIGH = 0.12;
const PART_COLOR_CORE_HALF_WIDTH_DEGREES = 30;
const PART_COLOR_OUTER_HALF_WIDTH_DEGREES = 60;
const PART_COLOR_OUTSIDE_SATURATION_SCALE = 0.05;
const PART_COLOR_HUE_PULL_INNER_RADIUS_DEGREES = 60;
const PART_COLOR_HUE_PULL_INNER_SCALE = 0.5;
const FILTER_LOG_HISTOGRAM_BINS = 1024;
const FILTER_LOG_LUMA_MIN_EV = -16;
const FILTER_LOG_LUMA_MAX_EV = 2;
const FILTER_TONE_RECOVERY_LOG_LIMIT = 20;

function prophotoLumaForFilter(r: number, g: number, b: number): number {
  return Math.max(0, r * PROPHOTO_LUMA_R + g * PROPHOTO_LUMA_G + b * PROPHOTO_LUMA_B);
}

function clampHistogramUnitValue(value: number): number {
  return clamp01(Number.isFinite(value) ? value : 0);
}

function accumulateLogLumaHistogram(histogram: Uint32Array, luma: number): void {
  const bins = histogram.length;
  if (bins <= 0) return;
  const ev = Math.log2(Math.max(1e-8, clampHistogramUnitValue(luma)));
  const normalized = clamp01((ev - FILTER_LOG_LUMA_MIN_EV) / (FILTER_LOG_LUMA_MAX_EV - FILTER_LOG_LUMA_MIN_EV));
  const index = Math.max(0, Math.min(bins - 1, Math.round(normalized * (bins - 1))));
  histogram[index] = (histogram[index] ?? 0) + 1;
}

function estimateLogPercentileFromHistogram(histogram: Uint32Array, percentile: number): number {
  let total = 0;
  for (let i = 0; i < histogram.length; i += 1) total += histogram[i] ?? 0;
  if (total <= 0) return FILTER_LOG_LUMA_MIN_EV;
  const target = Math.max(0, Math.min(total - 1, Math.floor((total - 1) * clamp01(percentile))));
  let cumulative = 0;
  for (let i = 0; i < histogram.length; i += 1) {
    cumulative += histogram[i] ?? 0;
    if (cumulative > target) {
      const bins = histogram.length;
      if (bins <= 1) return FILTER_LOG_LUMA_MIN_EV;
      return FILTER_LOG_LUMA_MIN_EV + (i / (bins - 1)) * (FILTER_LOG_LUMA_MAX_EV - FILTER_LOG_LUMA_MIN_EV);
    }
  }
  return FILTER_LOG_LUMA_MAX_EV;
}

function solveFilterScaledLogForTargetLuma(sourceLuma: number, targetLuma: number): number {
  if (!(sourceLuma > 0) || !(targetLuma > 0) || !Number.isFinite(sourceLuma) || !Number.isFinite(targetLuma)) {
    return 0;
  }
  if (Math.abs(targetLuma - sourceLuma) <= 1e-8 * Math.max(1, sourceLuma, targetLuma)) {
    return 0;
  }

  const limit = FILTER_TONE_RECOVERY_LOG_LIMIT;
  const sourceValue = applyScaledLogLinearExtended(sourceLuma, 0, limit);
  if (!Number.isFinite(sourceValue)) return 0;
  const needsPositive = targetLuma > sourceValue;
  let low = needsPositive ? 0 : -limit;
  let high = needsPositive ? limit : 0;
  let lowValue = applyScaledLogLinearExtended(sourceLuma, low, limit);
  let highValue = applyScaledLogLinearExtended(sourceLuma, high, limit);
  if (!Number.isFinite(lowValue) || !Number.isFinite(highValue)) return 0;

  if (needsPositive) {
    if (targetLuma >= highValue) return high;
  } else if (targetLuma <= lowValue) {
    return low;
  }

  for (let iter = 0; iter < 32; iter += 1) {
    const mid = (low + high) / 2;
    const midValue = applyScaledLogLinearExtended(sourceLuma, mid, limit);
    if (!Number.isFinite(midValue)) break;
    if (midValue < targetLuma) {
      low = mid;
      lowValue = midValue;
    } else {
      high = mid;
      highValue = midValue;
    }
  }

  return Math.abs(targetLuma - lowValue) <= Math.abs(highValue - targetLuma) ? low : high;
}

function applyFilterScaledLogToLinearRgb(r: number, g: number, b: number, scaledLog: number): [number, number, number] {
  if (!Number.isFinite(scaledLog) || Math.abs(scaledLog) < 1e-6) return [r, g, b];
  const sourceLuma = prophotoLumaForFilter(r, g, b);
  if (!(sourceLuma > 1e-12)) return [r, g, b];
  const targetLuma = applyScaledLogLinearExtended(sourceLuma, scaledLog, FILTER_TONE_RECOVERY_LOG_LIMIT);
  if (!Number.isFinite(targetLuma)) return [r, g, b];
  const scale = targetLuma / sourceLuma;
  return [Math.max(0, r * scale), Math.max(0, g * scale), Math.max(0, b * scale)];
}

type CrossProcessToneRecovery = {
  beforeP50Ev: number;
  filteredP50Ev: number;
  contrastScale: number;
};

function computeCrossProcessToneRecovery(
  beforeHistogram: Uint32Array,
  filteredHistogram: Uint32Array,
): CrossProcessToneRecovery {
  const beforeP10Ev = estimateLogPercentileFromHistogram(
    beforeHistogram,
    CROSS_PROCESS_CONTRAST_LOW_PERCENTILE,
  );
  const beforeP50Ev = estimateLogPercentileFromHistogram(
    beforeHistogram,
    CROSS_PROCESS_TARGET_PERCENTILE,
  );
  const beforeP90Ev = estimateLogPercentileFromHistogram(
    beforeHistogram,
    CROSS_PROCESS_CONTRAST_HIGH_PERCENTILE,
  );
  const filteredP10Ev = estimateLogPercentileFromHistogram(
    filteredHistogram,
    CROSS_PROCESS_CONTRAST_LOW_PERCENTILE,
  );
  const filteredP50Ev = estimateLogPercentileFromHistogram(
    filteredHistogram,
    CROSS_PROCESS_TARGET_PERCENTILE,
  );
  const filteredP90Ev = estimateLogPercentileFromHistogram(
    filteredHistogram,
    CROSS_PROCESS_CONTRAST_HIGH_PERCENTILE,
  );
  const beforeContrastEv = Math.max(0, beforeP90Ev - beforeP10Ev);
  const filteredContrastEv = Math.max(0, filteredP90Ev - filteredP10Ev);
  const contrastScale = filteredContrastEv > beforeContrastEv && filteredContrastEv > 1e-6
    ? clamp01(beforeContrastEv / filteredContrastEv)
    : 1;
  return { beforeP50Ev, filteredP50Ev, contrastScale };
}

function applyCrossProcessToneRecoveryLinearRgb(
  r: number,
  g: number,
  b: number,
  recovery: CrossProcessToneRecovery,
): [number, number, number] {
  const sourceLuma = prophotoLumaForFilter(r, g, b);
  if (!(sourceLuma > 1e-12)) return [r, g, b];
  const sourceEv = Math.log2(Math.max(1e-8, sourceLuma));
  const targetEv = recovery.beforeP50Ev
    + (sourceEv - recovery.filteredP50Ev) * recovery.contrastScale;
  const targetLuma = Math.pow(2, targetEv);
  if (!(targetLuma >= 0) || !Number.isFinite(targetLuma)) return [r, g, b];
  const scale = targetLuma / sourceLuma;
  return [Math.max(0, r * scale), Math.max(0, g * scale), Math.max(0, b * scale)];
}

type ClassicChromeToneRecovery = {
  beforeP50Ev: number;
  filteredP50Ev: number;
  contrastScale: number;
};

function interpolateFilterHueTable(
  hueDegrees: number,
  table: readonly (readonly [number, number])[],
): number {
  if (table.length === 0) return 0;
  let hue = hueDegrees % 360;
  if (hue < 0) hue += 360;
  for (let index = 0; index < table.length - 1; index += 1) {
    const current = table[index];
    const next = table[index + 1];
    if (!current || !next) continue;
    if (hue < current[0] || hue > next[0]) continue;
    const span = Math.max(1e-9, next[0] - current[0]);
    const t = smoothstep01((hue - current[0]) / span);
    return current[1] * (1 - t) + next[1] * t;
  }
  return table[table.length - 1]?.[1] ?? 0;
}

function filterHueDependenceWeight(saturation: number): number {
  const span = FILTER_HUE_GATE_SATURATION_HIGH - FILTER_HUE_GATE_SATURATION_LOW;
  if (!(span > 0)) return saturation > FILTER_HUE_GATE_SATURATION_LOW ? 1 : 0;
  return smoothstep01((saturation - FILTER_HUE_GATE_SATURATION_LOW) / span);
}

function limitFilterLinearRgbToUnitMax(r: number, g: number, b: number): [number, number, number] {
  const maxChannel = Math.max(r, g, b);
  if (!(maxChannel > 1)) return [Math.max(0, r), Math.max(0, g), Math.max(0, b)];
  const scale = 1 / maxChannel;
  return [Math.max(0, r * scale), Math.max(0, g * scale), Math.max(0, b * scale)];
}

function scaleLinearRgbToFilterLuma(
  r: number,
  g: number,
  b: number,
  targetLuma: number,
): [number, number, number] {
  const sourceLuma = prophotoLumaForFilter(r, g, b);
  if (!(sourceLuma > 1e-12) || !(targetLuma >= 0) || !Number.isFinite(targetLuma)) {
    return [r, g, b];
  }
  const scale = targetLuma / sourceLuma;
  return [Math.max(0, r * scale), Math.max(0, g * scale), Math.max(0, b * scale)];
}

function applyClassicChromeToneCurve(luma: number): number {
  const x = clamp01(luma);
  const points: readonly (readonly [number, number])[] = [
    [0, 0],
    [5 / 255, 5 / 255],
    [150 / 255, 162 / 255],
    [250 / 255, 250 / 255],
    [1, 1],
  ];
  for (let index = 0; index < points.length - 1; index += 1) {
    const current = points[index];
    const next = points[index + 1];
    if (!current || !next || x < current[0] || x > next[0]) continue;
    const t = (x - current[0]) / Math.max(1e-9, next[0] - current[0]);
    return current[1] * (1 - t) + next[1] * t;
  }
  return x;
}

function applyClassicChromeLinearRgb(r: number, g: number, b: number): [number, number, number] {
  const workR = clamp01(r);
  const workG = clamp01(g);
  const workB = clamp01(b);
  const originalLuma = prophotoLumaForFilter(workR, workG, workB);
  const [baseHue, baseSaturation, baseValue] = rgbToHsv(workR, workG, workB);
  const maxChannel = Math.max(workR, workG, workB);
  const minChannel = Math.min(workR, workG, workB);
  const chroma = Math.max(1e-8, maxChannel - minChannel);
  const redDominance = clamp01((workR - Math.max(workG, workB)) / chroma);
  const blueDominance = clamp01((workB - Math.max(workR, workG)) / chroma);
  const hueDependenceWeight = filterHueDependenceWeight(baseSaturation);

  // Hue becomes numerically unstable close to neutral gray. Fade all hue-dependent
  // calibration/HSL operations out there so tiny RGB differences cannot become bands.
  const calibrationHueShift = hueDependenceWeight * CLASSIC_CHROME_CALIBRATION_STRENGTH
    * (5 * redDominance - 15 * blueDominance);
  const calibratedHueDegrees = ((baseHue * 360 + calibrationHueShift) % 360 + 360) % 360;
  const hueAdjustment = hueDependenceWeight * interpolateFilterHueTable(
    calibratedHueDegrees,
    CLASSIC_CHROME_HUE_ADJUSTMENTS,
  );
  const luminanceAdjustment = hueDependenceWeight * interpolateFilterHueTable(
    calibratedHueDegrees,
    CLASSIC_CHROME_LUMINANCE_ADJUSTMENTS,
  );
  const adjustedHue = ((calibratedHueDegrees + hueAdjustment) % 360 + 360) % 360 / 360;
  const calibratedSaturation = clamp01(
    baseSaturation * (1 - hueDependenceWeight * CLASSIC_CHROME_CALIBRATION_STRENGTH * 0.05 * redDominance),
  );
  let [linearR, linearG, linearB] = hsvToRgb(adjustedHue, calibratedSaturation, baseValue);

  // Hue changes should not accidentally redefine brightness; apply the preset's
  // HSL luminance adjustments explicitly in log-luminance instead.
  const hueTargetLuma = originalLuma * Math.pow(2, luminanceAdjustment * 0.01);
  [linearR, linearG, linearB] = scaleLinearRgbToFilterLuma(
    linearR,
    linearG,
    linearB,
    hueTargetLuma,
  );

  const [, currentSaturation] = rgbToHsvExtended(linearR, linearG, linearB);
  const globallyReducedSaturation = currentSaturation * CLASSIC_CHROME_GLOBAL_SATURATION;
  const targetSaturation = applyScaledLogLinearExtended(
    globallyReducedSaturation,
    CLASSIC_CHROME_VIBRANCE,
  );
  [linearR, linearG, linearB] = applyHsvSaturationPreservingProPhotoLuminance(
    linearR,
    linearG,
    linearB,
    targetSaturation,
  );

  // ShadowTint=-2: a very small green bias in shadows, with luminance restored.
  const preTintLuma = prophotoLumaForFilter(linearR, linearG, linearB);
  const shadowTintWeight = Math.pow(1 - clamp01(preTintLuma), 2);
  linearG *= 1 + CLASSIC_CHROME_SHADOW_GREEN_AMOUNT * shadowTintWeight;
  [linearR, linearG, linearB] = scaleLinearRgbToFilterLuma(
    linearR,
    linearG,
    linearB,
    preTintLuma,
  );

  const toneInputLuma = prophotoLumaForFilter(linearR, linearG, linearB);
  const curvedLuma = applyClassicChromeToneCurve(toneInputLuma);
  const shadowWeight = 1 - smoothstep01((toneInputLuma - 0.08) / 0.35);
  const highlightWeight = smoothstep01((toneInputLuma - 0.45) / 0.35)
    * (1 - smoothstep01((toneInputLuma - 0.86) / 0.14));
  const whiteWeight = smoothstep01((toneInputLuma - 0.72) / 0.28);
  const toneEv = CLASSIC_CHROME_SHADOW_EV * shadowWeight
    + CLASSIC_CHROME_HIGHLIGHT_EV * highlightWeight
    + CLASSIC_CHROME_WHITE_EV * whiteWeight;
  const targetToneLuma = curvedLuma * Math.pow(2, toneEv);
  [linearR, linearG, linearB] = scaleLinearRgbToFilterLuma(
    linearR,
    linearG,
    linearB,
    targetToneLuma,
  );

  return limitFilterLinearRgbToUnitMax(linearR, linearG, linearB);
}

function computeClassicChromeToneRecovery(
  beforeHistogram: Uint32Array,
  filteredHistogram: Uint32Array,
): ClassicChromeToneRecovery {
  const beforeP10Ev = estimateLogPercentileFromHistogram(
    beforeHistogram,
    CLASSIC_CHROME_CONTRAST_LOW_PERCENTILE,
  );
  const beforeP50Ev = estimateLogPercentileFromHistogram(
    beforeHistogram,
    CLASSIC_CHROME_TARGET_PERCENTILE,
  );
  const beforeP90Ev = estimateLogPercentileFromHistogram(
    beforeHistogram,
    CLASSIC_CHROME_CONTRAST_HIGH_PERCENTILE,
  );
  const filteredP10Ev = estimateLogPercentileFromHistogram(
    filteredHistogram,
    CLASSIC_CHROME_CONTRAST_LOW_PERCENTILE,
  );
  const filteredP50Ev = estimateLogPercentileFromHistogram(
    filteredHistogram,
    CLASSIC_CHROME_TARGET_PERCENTILE,
  );
  const filteredP90Ev = estimateLogPercentileFromHistogram(
    filteredHistogram,
    CLASSIC_CHROME_CONTRAST_HIGH_PERCENTILE,
  );
  const beforeContrastEv = Math.max(1e-6, beforeP90Ev - beforeP10Ev);
  const filteredContrastEv = Math.max(1e-6, filteredP90Ev - filteredP10Ev);
  const targetContrastEv = beforeContrastEv * CLASSIC_CHROME_TARGET_CONTRAST_SCALE;
  const contrastScale = Math.max(0.75, Math.min(1.25, targetContrastEv / filteredContrastEv));
  return { beforeP50Ev, filteredP50Ev, contrastScale };
}

function applyClassicChromeToneRecoveryLinearRgb(
  r: number,
  g: number,
  b: number,
  recovery: ClassicChromeToneRecovery,
): [number, number, number] {
  const sourceLuma = prophotoLumaForFilter(r, g, b);
  if (!(sourceLuma > 1e-12)) return [r, g, b];
  const sourceEv = Math.log2(Math.max(1e-8, sourceLuma));
  const targetEv = recovery.beforeP50Ev
    + (sourceEv - recovery.filteredP50Ev) * recovery.contrastScale;
  const targetLuma = Math.pow(2, targetEv);
  return scaleLinearRgbToFilterLuma(r, g, b, targetLuma);
}

type VelviaToneRecovery = {
  beforeP50Ev: number;
  filteredP50Ev: number;
  contrastScale: number;
};

function applyVelviaToneCurve(luma: number): number {
  const x = clamp01(luma);
  const points: readonly (readonly [number, number])[] = [
    [0, 0],
    [5 / 255, 5 / 255],
    [150 / 255, 162 / 255],
    [250 / 255, 250 / 255],
    [1, 1],
  ];
  for (let index = 0; index < points.length - 1; index += 1) {
    const current = points[index];
    const next = points[index + 1];
    if (!current || !next || x < current[0] || x > next[0]) continue;
    const t = (x - current[0]) / Math.max(1e-9, next[0] - current[0]);
    return current[1] * (1 - t) + next[1] * t;
  }
  return x;
}

function applyVelviaLinearRgb(r: number, g: number, b: number): [number, number, number] {
  const workR = clamp01(r);
  const workG = clamp01(g);
  const workB = clamp01(b);
  const originalLuma = prophotoLumaForFilter(workR, workG, workB);
  const [baseHue, baseSaturation, baseValue] = rgbToHsv(workR, workG, workB);
  const maxChannel = Math.max(workR, workG, workB);
  const minChannel = Math.min(workR, workG, workB);
  const chroma = Math.max(1e-8, maxChannel - minChannel);
  const redDominance = clamp01((workR - Math.max(workG, workB)) / chroma);
  const greenDominance = clamp01((workG - Math.max(workR, workB)) / chroma);
  const blueDominance = clamp01((workB - Math.max(workR, workG)) / chroma);
  const hueDependenceWeight = filterHueDependenceWeight(baseSaturation);

  // Weak approximation of Lightroom primary calibration: RedSat +10,
  // GreenHue -2, BlueHue +4. Fade it out near neutral gray where hue is unstable.
  const calibrationHueShift = hueDependenceWeight * VELVIA_CALIBRATION_STRENGTH
    * (-2 * greenDominance + 4 * blueDominance);
  const calibratedHueDegrees = ((baseHue * 360 + calibrationHueShift) % 360 + 360) % 360;
  const hueAdjustment = hueDependenceWeight * interpolateFilterHueTable(
    calibratedHueDegrees,
    VELVIA_HUE_ADJUSTMENTS,
  );
  const saturationAdjustment = hueDependenceWeight * interpolateFilterHueTable(
    calibratedHueDegrees,
    VELVIA_SATURATION_ADJUSTMENTS,
  );
  const luminanceAdjustment = hueDependenceWeight * interpolateFilterHueTable(
    calibratedHueDegrees,
    VELVIA_LUMINANCE_ADJUSTMENTS,
  );
  const adjustedHue = ((calibratedHueDegrees + hueAdjustment) % 360 + 360) % 360 / 360;
  const calibratedSaturation = clamp01(
    baseSaturation * (1 + hueDependenceWeight * VELVIA_CALIBRATION_STRENGTH * 0.10 * redDominance),
  );
  const hslAdjustedSaturation = clamp01(
    calibratedSaturation * (1 + saturationAdjustment * 0.01),
  );
  let [linearR, linearG, linearB] = hsvToRgb(adjustedHue, hslAdjustedSaturation, baseValue);

  // Apply HSL luminance adjustments in luminance rather than changing RGB
  // independently, so hue remains stable.
  const hueTargetLuma = originalLuma * Math.pow(2, luminanceAdjustment * 0.01);
  [linearR, linearG, linearB] = scaleLinearRgbToFilterLuma(
    linearR,
    linearG,
    linearB,
    hueTargetLuma,
  );

  // Velvia relies more on vibrance than on a global saturation multiplier.
  const [, currentSaturation] = rgbToHsvExtended(linearR, linearG, linearB);
  const targetSaturation = applyScaledLogLinearExtended(
    currentSaturation,
    VELVIA_VIBRANCE,
  );
  [linearR, linearG, linearB] = applyHsvSaturationPreservingProPhotoLuminance(
    linearR,
    linearG,
    linearB,
    targetSaturation,
  );

  // ShadowTint=+3: a small magenta bias in shadows, with luminance restored.
  const preTintLuma = prophotoLumaForFilter(linearR, linearG, linearB);
  const shadowTintWeight = Math.pow(1 - clamp01(preTintLuma), 2);
  linearG *= 1 - VELVIA_SHADOW_MAGENTA_AMOUNT * shadowTintWeight;
  [linearR, linearG, linearB] = scaleLinearRgbToFilterLuma(
    linearR,
    linearG,
    linearB,
    preTintLuma,
  );

  const toneInputLuma = prophotoLumaForFilter(linearR, linearG, linearB);
  const curvedLuma = applyVelviaToneCurve(toneInputLuma);
  const blackWeight = 1 - smoothstep01((toneInputLuma - 0.015) / 0.14);
  const shadowWeight = smoothstep01((toneInputLuma - 0.035) / 0.18)
    * (1 - smoothstep01((toneInputLuma - 0.30) / 0.24));
  const highlightWeight = smoothstep01((toneInputLuma - 0.45) / 0.30)
    * (1 - smoothstep01((toneInputLuma - 0.86) / 0.14));
  const whiteWeight = smoothstep01((toneInputLuma - 0.72) / 0.28);
  const toneEv = VELVIA_BLACK_EV * blackWeight
    + VELVIA_SHADOW_EV * shadowWeight
    + VELVIA_HIGHLIGHT_EV * highlightWeight
    + VELVIA_WHITE_EV * whiteWeight;
  const targetToneLuma = curvedLuma * Math.pow(2, toneEv);
  [linearR, linearG, linearB] = scaleLinearRgbToFilterLuma(
    linearR,
    linearG,
    linearB,
    targetToneLuma,
  );

  return limitFilterLinearRgbToUnitMax(linearR, linearG, linearB);
}

function computeVelviaToneRecovery(
  beforeHistogram: Uint32Array,
  filteredHistogram: Uint32Array,
): VelviaToneRecovery {
  const beforeP10Ev = estimateLogPercentileFromHistogram(
    beforeHistogram,
    VELVIA_CONTRAST_LOW_PERCENTILE,
  );
  const beforeP50Ev = estimateLogPercentileFromHistogram(
    beforeHistogram,
    VELVIA_TARGET_PERCENTILE,
  );
  const beforeP90Ev = estimateLogPercentileFromHistogram(
    beforeHistogram,
    VELVIA_CONTRAST_HIGH_PERCENTILE,
  );
  const filteredP10Ev = estimateLogPercentileFromHistogram(
    filteredHistogram,
    VELVIA_CONTRAST_LOW_PERCENTILE,
  );
  const filteredP50Ev = estimateLogPercentileFromHistogram(
    filteredHistogram,
    VELVIA_TARGET_PERCENTILE,
  );
  const filteredP90Ev = estimateLogPercentileFromHistogram(
    filteredHistogram,
    VELVIA_CONTRAST_HIGH_PERCENTILE,
  );
  const beforeContrastEv = Math.max(1e-6, beforeP90Ev - beforeP10Ev);
  const filteredContrastEv = Math.max(1e-6, filteredP90Ev - filteredP10Ev);
  const targetContrastEv = beforeContrastEv * VELVIA_TARGET_CONTRAST_SCALE;
  const contrastScale = Math.max(0.80, Math.min(1.20, targetContrastEv / filteredContrastEv));
  return { beforeP50Ev, filteredP50Ev, contrastScale };
}

function applyVelviaToneRecoveryLinearRgb(
  r: number,
  g: number,
  b: number,
  recovery: VelviaToneRecovery,
): [number, number, number] {
  const sourceLuma = prophotoLumaForFilter(r, g, b);
  if (!(sourceLuma > 1e-12)) return [r, g, b];
  const sourceEv = Math.log2(Math.max(1e-8, sourceLuma));
  const targetEv = recovery.beforeP50Ev
    + (sourceEv - recovery.filteredP50Ev) * recovery.contrastScale;
  const targetLuma = Math.pow(2, targetEv);
  return scaleLinearRgbToFilterLuma(r, g, b, targetLuma);
}

function applyFilterScaledLogToRgb16(data: Uint16Array, width: number, height: number, scaledLog: number): void {
  if (!Number.isFinite(scaledLog) || Math.abs(scaledLog) < 1e-6 || width <= 0 || height <= 0) return;
  const pixelCount = width * height;
  for (let pixel = 0; pixel < pixelCount; pixel += 1) {
    const index = pixel * 3;
    const r = decodeStoredRgb16Channel(data[index] ?? 0, "gamma20", 1);
    const g = decodeStoredRgb16Channel(data[index + 1] ?? 0, "gamma20", 1);
    const b = decodeStoredRgb16Channel(data[index + 2] ?? 0, "gamma20", 1);
    const [nr, ng, nb] = applyFilterScaledLogToLinearRgb(r, g, b, scaledLog);
    data[index] = encodeStoredRgb16Channel(nr, "gamma20", 1);
    data[index + 1] = encodeStoredRgb16Channel(ng, "gamma20", 1);
    data[index + 2] = encodeStoredRgb16Channel(nb, "gamma20", 1);
  }
}

function hashNoise01(ix: number, iy: number, seed: number): number {
  let h = (ix | 0) * 374761393 + (iy | 0) * 668265263 + (seed | 0) * 69069;
  h = (h ^ (h >>> 13)) | 0;
  h = Math.imul(h, 1274126177);
  h = (h ^ (h >>> 16)) >>> 0;
  return h / 4294967295;
}

function smoothstep01(x: number): number {
  const t = clamp01(x);
  return t * t * (3 - 2 * t);
}

function mixUnit(a: number, b: number, t: number): number {
  const u = clamp01(t);
  return a * (1 - u) + b * u;
}

function valueNoise2d(x: number, y: number, scale: number, seed: number): number {
  const sx = x * scale;
  const sy = y * scale;
  const x0 = Math.floor(sx);
  const y0 = Math.floor(sy);
  const tx = smoothstep01(sx - x0);
  const ty = smoothstep01(sy - y0);
  const n00 = hashNoise01(x0, y0, seed);
  const n10 = hashNoise01(x0 + 1, y0, seed);
  const n01 = hashNoise01(x0, y0 + 1, seed);
  const n11 = hashNoise01(x0 + 1, y0 + 1, seed);
  const nx0 = n00 * (1 - tx) + n10 * tx;
  const nx1 = n01 * (1 - tx) + n11 * tx;
  return nx0 * (1 - ty) + nx1 * ty;
}

function photochemicalDiagonalScale(width: number, height: number): number {
  return Math.max(1, Math.hypot(width, height));
}

function samplePhotochemicalGrain(x: number, y: number, width: number, height: number): number {
  const diagonal = photochemicalDiagonalScale(width, height);
  const nx = x / diagonal;
  const ny = y / diagonal;
  const fine = valueNoise2d(nx, ny, PHOTOCHEMICAL_GRAIN_FINE_CYCLES_PER_DIAGONAL, 11);
  const coarse = valueNoise2d(nx, ny, PHOTOCHEMICAL_GRAIN_COARSE_CYCLES_PER_DIAGONAL, 37);
  return ((fine * 0.75 + coarse * 0.25) - 0.5) * 2;
}

function samplePhotochemicalPaperAging(x: number, y: number, width: number, height: number): number {
  const diagonal = photochemicalDiagonalScale(width, height);
  const nx = x / diagonal;
  const ny = y / diagonal;
  const broad = valueNoise2d(nx, ny, PHOTOCHEMICAL_PAPER_BROAD_CYCLES_PER_DIAGONAL, 53);
  const medium = valueNoise2d(nx, ny, PHOTOCHEMICAL_PAPER_MEDIUM_CYCLES_PER_DIAGONAL, 79);
  return clamp01(0.18 + broad * 0.22 + medium * 0.10);
}

function samplePhotochemicalResidualStainOpacity(x: number, y: number, width: number, height: number): number {
  const diagonal = photochemicalDiagonalScale(width, height);
  const nx = x / diagonal;
  const ny = y / diagonal;
  const broad = valueNoise2d(nx, ny, PHOTOCHEMICAL_STAIN_BROAD_CYCLES_PER_DIAGONAL, 101);
  const medium = valueNoise2d(nx, ny, PHOTOCHEMICAL_STAIN_MEDIUM_CYCLES_PER_DIAGONAL, 131);
  const stain = broad * 0.65 + medium * 0.35;
  return clamp01(stain) * PHOTOCHEMICAL_STAIN_MAX_OPACITY;
}

function samplePhotochemicalPaperColor(
  x: number,
  y: number,
  width: number,
  height: number,
  baseR: number,
  baseG: number,
  baseB: number,
  agedR: number,
  agedG: number,
  agedB: number,
): [number, number, number] {
  const aging = samplePhotochemicalPaperAging(x, y, width, height);
  return [
    mixUnit(baseR, agedR, aging),
    mixUnit(baseG, agedG, aging),
    mixUnit(baseB, agedB, aging),
  ];
}

type SepiaFilterBaseState = {
  imageR: number;
  imageG: number;
  imageB: number;
  imageOpacity: number;
};

type CyanotypeFilterBaseState = {
  imageR: number;
  imageG: number;
  imageB: number;
  imageOpacity: number;
};

function composePhotochemicalImage(
  paperR: number,
  paperG: number,
  paperB: number,
  imageR: number,
  imageG: number,
  imageB: number,
  baseImageOpacity: number,
  residualStainOpacity: number,
): [number, number, number] {
  const imageOpacity = residualStainOpacity + (1 - residualStainOpacity) * clamp01(baseImageOpacity);
  return [
    mixUnit(paperR, imageR, imageOpacity),
    mixUnit(paperG, imageG, imageOpacity),
    mixUnit(paperB, imageB, imageOpacity),
  ];
}

function computeSepiaExposure(r: number, g: number, b: number): number {
  return clamp01(0.098 * r + 0.236 * g + 0.666 * b);
}

function computeCyanotypeExposure(r: number, g: number, b: number): number {
  return clamp01(0.0 * r + 0.10 * g + 0.90 * b);
}

function solvePhotochemicalExposureScaledLog(
  sourceExposureP50: number,
  targetOutputLumaP50: number,
  materialR: number,
  materialG: number,
  materialB: number,
): number {
  const materialLuma = prophotoLumaForFilter(materialR, materialG, materialB);
  const range = 1 - materialLuma;
  if (!(range > 1e-8)) return 0;
  const targetExposure = clamp01((targetOutputLumaP50 - materialLuma) / range);
  return solveFilterScaledLogForTargetLuma(sourceExposureP50, targetExposure);
}

function applyPhotochemicalExposureScaledLog(exposure: number, scaledLog: number): number {
  return applyScaledLogLinear(clamp01(exposure), scaledLog, FILTER_TONE_RECOVERY_LOG_LIMIT);
}

function computeSepiaFilterTexturedState(
  r: number,
  g: number,
  b: number,
  x: number,
  yPos: number,
  width: number,
  height: number,
  exposureScaledLog: number,
): SepiaFilterBaseState {
  const baseExposure = computeSepiaExposure(r, g, b);
  const correctedExposure = applyPhotochemicalExposureScaledLog(baseExposure, exposureScaledLog);
  const grain = samplePhotochemicalGrain(x, yPos, width, height);
  const shadowWeight = Math.pow(1 - correctedExposure, SEPIA_GRAIN_SHADOW_EXPONENT);
  const texturedExposure = clamp01(correctedExposure + grain * SEPIA_GRAIN_AMOUNT * shadowWeight);
  return {
    imageR: SEPIA_MATERIAL_R,
    imageG: SEPIA_MATERIAL_G,
    imageB: SEPIA_MATERIAL_B,
    imageOpacity: 1 - texturedExposure,
  };
}

function computeCyanotypeFilterTexturedState(
  r: number,
  g: number,
  b: number,
  x: number,
  yPos: number,
  width: number,
  height: number,
  exposureScaledLog: number,
): CyanotypeFilterBaseState {
  const baseExposure = computeCyanotypeExposure(r, g, b);
  const correctedExposure = applyPhotochemicalExposureScaledLog(baseExposure, exposureScaledLog);
  const grain = samplePhotochemicalGrain(x, yPos, width, height);
  const shadowWeight = Math.pow(1 - correctedExposure, CYANOTYPE_GRAIN_SHADOW_EXPONENT);
  const texturedExposure = clamp01(correctedExposure + grain * CYANOTYPE_GRAIN_AMOUNT * shadowWeight);

  return {
    imageR: CYANOTYPE_MATERIAL_R,
    imageG: CYANOTYPE_MATERIAL_G,
    imageB: CYANOTYPE_MATERIAL_B,
    imageOpacity: 1 - texturedExposure,
  };
}

function normalizeMonochromePreset(value: unknown): ImageMonochromePreset {
  return value === "rec601" || value === "average" || value === "red" || value === "yellow" || value === "blue"
    ? value
    : "rec709";
}

function isChannelSwapPreset(value: unknown): value is ImageChannelSwapPreset {
  return typeof value === "string" && (SWAP_RGB_PRESET_SEQUENCE as readonly string[]).includes(value);
}

function isDichromePreset(value: unknown): value is ImageDichromePreset {
  return typeof value === "string" && (DICHROME_PRESET_SEQUENCE as readonly string[]).includes(value);
}

function isTrichromePreset(value: unknown): value is ImageTrichromePreset {
  return typeof value === "string" && (TRICHROME_PRESET_SEQUENCE as readonly string[]).includes(value);
}

function isPartColorPreset(value: unknown): value is ImagePartColorPreset {
  return typeof value === "string" && (PART_COLOR_PRESET_SEQUENCE as readonly string[]).includes(value);
}

function isDuotonePreset(value: unknown): value is ImageDuotonePreset {
  return typeof value === "string" && (DUOTONE_PRESET_SEQUENCE as readonly string[]).includes(value);
}

function isEdgePreset(value: unknown): value is ImageEdgePreset {
  return typeof value === "string" && (EDGE_PRESET_SEQUENCE as readonly string[]).includes(value);
}

function cycleOtherFilterPreset<T extends ImageOtherFilterPreset>(
  current: ImageFilter | null | undefined,
  sequence: readonly T[],
): ImageFilter | null {
  const first = sequence[0];
  if (!first) return null;
  if (!current || current.kind !== "other") return { kind: "other", preset: first };
  const index = sequence.indexOf(current.preset as T);
  if (index < 0) return { kind: "other", preset: first };
  const next = sequence[index + 1];
  return next ? { kind: "other", preset: next } : null;
}

function normalizeNonMonochromeFilterPreset(value: unknown): ImageNonMonochromeFilterPreset | null {
  if (
    isChannelSwapPreset(value)
    || isDichromePreset(value)
    || isTrichromePreset(value)
    || isPartColorPreset(value)
    || isDuotonePreset(value)
    || isEdgePreset(value)
  ) {
    return value;
  }
  if (
    value === "cyanotype" ||
    value === "cross-process" ||
    value === "bleach-bypass" ||
    value === "negative" ||
    value === "solarization" ||
    value === "classic-chrome" ||
    value === "velvia"
  ) {
    return value;
  }
  return "sepia";
}

function normalizeImageFilter(filter?: Partial<ImageFilter> | null): ImageFilter | null {
  if (!filter) return null;
  if (filter.kind === "monochrome") {
    return {
      kind: "monochrome",
      preset: normalizeMonochromePreset(filter.preset),
    };
  }
  if (filter.kind === "other") {
    const preset = normalizeNonMonochromeFilterPreset(filter.preset);
    return preset ? { kind: "other", preset } : null;
  }
  return null;
}

function resolveMonochromeWeights(filter: ImageFilter | null | undefined): readonly [number, number, number] | null {
  if (!filter || filter.kind !== "monochrome") return null;
  return MONOCHROME_PRESET_WEIGHTS[filter.preset];
}

function clampVignetteStrengthEv(value: number): number {
  if (!Number.isFinite(value)) return 1;
  return Math.min(4, Math.max(0, value));
}

function clampVignetteCoordinate(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(8, Math.max(-8, value));
}

function normalizeVignetteOverlay(overlay?: Partial<ImageVignetteOverlay> | null): ImageVignetteOverlay | null {
  if (!overlay) return null;
  const x1 = clampVignetteCoordinate(Math.min(overlay.x1 ?? 0, overlay.x2 ?? 0));
  const y1 = clampVignetteCoordinate(Math.min(overlay.y1 ?? 0, overlay.y2 ?? 0));
  const x2 = clampVignetteCoordinate(Math.max(overlay.x1 ?? 0, overlay.x2 ?? 0));
  const y2 = clampVignetteCoordinate(Math.max(overlay.y1 ?? 0, overlay.y2 ?? 0));
  if (x2 - x1 <= 1e-6 || y2 - y1 <= 1e-6) return null;
  return {
    id: typeof overlay.id === "string" && overlay.id ? overlay.id : makeOverlayId("vignette"),
    x1,
    y1,
    x2,
    y2,
    strengthEv: clampVignetteStrengthEv(overlay.strengthEv ?? 1),
  };
}

function clampDefringe(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(100, Math.max(0, Math.round(value)));
}

export function buildDefaultEditParams(w?: number, h?: number): ImageEditParams {
  return {
    crop: { top: 0, bottom: 0, left: 0, right: 0 },
    rotationDegrees: 0,
    temperature: 0,
    tint: 0,
    denoise: 0,
    defringe: 0,
    exposureEv: 0,
    shadow: 0,
    highlight: 0,
    scaledLog: 0,
    sigmoid: 0,
    clarity: 0,
    vibrance: 0,
    saturation: 0,
    resizePercent: defaultResizePercent(w, h),
    sharpen: 0,
    mosaicRegions: [],
    textOverlays: [],
    drawOverlays: [],
    vignetteOverlay: null,
    filter: null,
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
    sharpen: isRawImageFile(name, type) ? 2 : defaults.resizePercent !== 100 ? 2 : 0,
  };
}

function normalizeEditParams(params: ImageEditParams | undefined, w?: number, h?: number): ImageEditParams {
  const defaults = buildDefaultEditParams(w, h);
  return {
    crop: normalizeCrop(params?.crop ?? defaults.crop),
    rotationDegrees: normalizeRotationDegrees(params?.rotationDegrees ?? defaults.rotationDegrees),
    temperature: clampWhiteBalanceValue(params?.temperature ?? defaults.temperature),
    tint: clampWhiteBalanceValue(params?.tint ?? defaults.tint),
    denoise: clampDenoise(params?.denoise ?? defaults.denoise),
    defringe: clampDefringe(params?.defringe ?? defaults.defringe),
    exposureEv: clampExposureEv(params?.exposureEv ?? defaults.exposureEv),
    shadow: clampToneRangeAdjustment(params?.shadow ?? defaults.shadow),
    highlight: clampToneRangeAdjustment(params?.highlight ?? defaults.highlight),
    scaledLog: clampScaledLog(params?.scaledLog ?? defaults.scaledLog),
    sigmoid: clampSigmoid(params?.sigmoid ?? defaults.sigmoid),
    clarity: clampClarity(params?.clarity ?? defaults.clarity),
    vibrance: clampColorAdjustment(params?.vibrance ?? defaults.vibrance),
    saturation: clampColorAdjustment(params?.saturation ?? defaults.saturation),
    resizePercent: Math.min(100, Math.max(1, Math.round(params?.resizePercent ?? defaults.resizePercent))),
    sharpen: clampSharpen(params?.sharpen ?? defaults.sharpen),
    mosaicRegions: normalizeMosaicRegions(params?.mosaicRegions ?? defaults.mosaicRegions),
    textOverlays: normalizeTextOverlays(params?.textOverlays ?? defaults.textOverlays),
    drawOverlays: normalizeDrawOverlays(params?.drawOverlays ?? defaults.drawOverlays),
    vignetteOverlay: normalizeVignetteOverlay(params?.vignetteOverlay ?? defaults.vignetteOverlay),
    filter: normalizeImageFilter(params?.filter ?? defaults.filter),
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
    normalized.denoise !== 0 ||
    normalized.defringe !== 0 ||
    Math.abs(normalized.exposureEv) > 0.0001 ||
    normalized.shadow !== 0 ||
    normalized.highlight !== 0 ||
    Math.abs(normalized.scaledLog) > 0.0001 ||
    Math.abs(normalized.sigmoid) > 0.0001 ||
    normalized.clarity !== 0 ||
    normalized.vibrance !== 0 ||
    normalized.saturation !== 0 ||
    normalized.resizePercent !== defaults.resizePercent ||
    normalized.sharpen !== defaults.sharpen ||
    normalized.mosaicRegions.length > 0 ||
    normalized.textOverlays.length > 0 ||
    normalized.drawOverlays.length > 0 ||
    normalized.vignetteOverlay !== null ||
    normalized.filter !== null
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


type VignetteGeometry = {
  frameX: number;
  frameY: number;
  frameW: number;
  frameH: number;
  cx: number;
  cy: number;
  rx: number;
  ry: number;
  maxDistance: number;
  strengthEv: number;
};

function resolveVignetteGeometry(
  overlay: ImageVignetteOverlay | null | undefined,
  sourceW: number,
  sourceH: number,
  cropX: number,
  cropY: number,
  cropW: number,
  cropH: number,
  frameX: number,
  frameY: number,
  frameW: number,
  frameH: number,
): VignetteGeometry | null {
  if (!overlay || sourceW <= 0 || sourceH <= 0 || cropW <= 0 || cropH <= 0 || frameW <= 0 || frameH <= 0) {
    return null;
  }
  const scaleX = frameW / cropW;
  const scaleY = frameH / cropH;
  const left = frameX + ((overlay.x1 * sourceW) - cropX) * scaleX;
  const top = frameY + ((overlay.y1 * sourceH) - cropY) * scaleY;
  const right = frameX + ((overlay.x2 * sourceW) - cropX) * scaleX;
  const bottom = frameY + ((overlay.y2 * sourceH) - cropY) * scaleY;
  const width = Math.max(0, right - left);
  const height = Math.max(0, bottom - top);
  if (width <= 1e-6 || height <= 1e-6) return null;
  const cx = left + width / 2;
  const cy = top + height / 2;
  const rx = width / 2;
  const ry = height / 2;
  const corners: Array<[number, number]> = [
    [frameX + 0.5, frameY + 0.5],
    [frameX + frameW - 0.5, frameY + 0.5],
    [frameX + 0.5, frameY + frameH - 0.5],
    [frameX + frameW - 0.5, frameY + frameH - 0.5],
  ];
  const maxDistance = corners.reduce((best, [x, y]) => Math.max(best, Math.hypot(x - cx, y - cy)), 0);
  if (!(maxDistance > 0)) return null;
  return {
    frameX,
    frameY,
    frameW,
    frameH,
    cx,
    cy,
    rx,
    ry,
    maxDistance,
    strengthEv: clampVignetteStrengthEv(overlay.strengthEv),
  };
}

function vignetteStrengthAtPoint(geometry: VignetteGeometry, x: number, y: number): number {
  const dx = x - geometry.cx;
  const dy = y - geometry.cy;
  const normalizedRadius = Math.hypot(dx / Math.max(1e-6, geometry.rx), dy / Math.max(1e-6, geometry.ry));
  if (normalizedRadius <= 1) return 0;
  const distance = Math.hypot(dx, dy);
  if (!(distance > 0)) return 0;
  const boundaryDistance = distance / normalizedRadius;
  const denominator = geometry.maxDistance - boundaryDistance;
  if (denominator <= 1e-6) return geometry.strengthEv;
  const t = clamp01((distance - boundaryDistance) / denominator);
  return geometry.strengthEv * t * t;
}

function applyVignetteToCanvas(
  canvas: HTMLCanvasElement | OffscreenCanvas,
  overlay: ImageVignetteOverlay | null | undefined,
  sourceW: number,
  sourceH: number,
  cropX: number,
  cropY: number,
  cropW: number,
  cropH: number,
  frameX: number,
  frameY: number,
  frameW: number,
  frameH: number,
  outputColorProfile: ImageEditOutputColorProfile = "srgb",
): void {
  const geometry = resolveVignetteGeometry(overlay, sourceW, sourceH, cropX, cropY, cropW, cropH, frameX, frameY, frameW, frameH);
  if (!geometry || geometry.strengthEv <= 0) return;
  const ctx = getCanvas2dContext(canvas, outputColorProfile, true);
  if (!ctx) return;
  const x0 = Math.max(0, Math.floor(geometry.frameX));
  const y0 = Math.max(0, Math.floor(geometry.frameY));
  const x1 = Math.min(canvas.width, Math.ceil(geometry.frameX + geometry.frameW));
  const y1 = Math.min(canvas.height, Math.ceil(geometry.frameY + geometry.frameH));
  const width = x1 - x0;
  const height = y1 - y0;
  if (width <= 0 || height <= 0) return;
  const imageData = getCanvasImageData(ctx, x0, y0, width, height, outputColorProfile);
  const rgba = imageData.data;
  for (let py = 0; py < height; py += 1) {
    const y = y0 + py + 0.5;
    for (let px = 0; px < width; px += 1) {
      const x = x0 + px + 0.5;
      const ev = vignetteStrengthAtPoint(geometry, x, y);
      if (ev <= 0) continue;
      const gain = Math.pow(2, -ev);
      const index = (py * width + px) * 4;
      rgba[index] = Math.max(0, Math.min(255, Math.round((rgba[index] ?? 0) * gain)));
      rgba[index + 1] = Math.max(0, Math.min(255, Math.round((rgba[index + 1] ?? 0) * gain)));
      rgba[index + 2] = Math.max(0, Math.min(255, Math.round((rgba[index + 2] ?? 0) * gain)));
    }
  }
  ctx.putImageData(imageData, x0, y0);
}

function applyVignetteToRgb16(
  data: Uint16Array,
  width: number,
  height: number,
  overlay: ImageVignetteOverlay | null | undefined,
  sourceW: number,
  sourceH: number,
  cropX: number,
  cropY: number,
  cropW: number,
  cropH: number,
): void {
  const geometry = resolveVignetteGeometry(overlay, sourceW, sourceH, cropX, cropY, cropW, cropH, 0, 0, width, height);
  if (!geometry || geometry.strengthEv <= 0) return;
  for (let py = 0; py < height; py += 1) {
    const y = py + 0.5;
    for (let px = 0; px < width; px += 1) {
      const x = px + 0.5;
      const ev = vignetteStrengthAtPoint(geometry, x, y);
      if (ev <= 0) continue;
      const gain = Math.pow(2, -ev);
      const index = (py * width + px) * 3;
      data[index] = encodeStoredRgb16Channel(decodeStoredRgb16Channel(data[index] ?? 0, "gamma20", 1) * gain, "gamma20", 1);
      data[index + 1] = encodeStoredRgb16Channel(decodeStoredRgb16Channel(data[index + 1] ?? 0, "gamma20", 1) * gain, "gamma20", 1);
      data[index + 2] = encodeStoredRgb16Channel(decodeStoredRgb16Channel(data[index + 2] ?? 0, "gamma20", 1) * gain, "gamma20", 1);
    }
  }
}


function applySepiaLinearRgb(
  r: number,
  g: number,
  b: number,
  x: number,
  yPos: number,
  width: number,
  height: number,
  exposureScaledLog: number,
): [number, number, number] {
  const texturedState = computeSepiaFilterTexturedState(
    r,
    g,
    b,
    x,
    yPos,
    width,
    height,
    exposureScaledLog,
  );
  const [paperR, paperG, paperB] = samplePhotochemicalPaperColor(
    x,
    yPos,
    width,
    height,
    1,
    1,
    1,
    SEPIA_AGED_PAPER_R,
    SEPIA_AGED_PAPER_G,
    SEPIA_AGED_PAPER_B,
  );
  const residualStainOpacity = samplePhotochemicalResidualStainOpacity(x, yPos, width, height);
  const [fr, fg, fb] = composePhotochemicalImage(
    paperR,
    paperG,
    paperB,
    texturedState.imageR,
    texturedState.imageG,
    texturedState.imageB,
    texturedState.imageOpacity,
    residualStainOpacity,
  );
  return [clamp01(fr), clamp01(fg), clamp01(fb)];
}

function applyChemicalCrossProcessLinearRgb(r: number, g: number, b: number): [number, number, number] {
  const clampInput = (value: number) => Math.max(0.0001, Math.min(1, value));
  const applyHDCurve = (x: number, k: number, x0: number) => {
    const val = 1 / (1 + Math.exp(-k * (x - x0)));
    const min = 1 / (1 + Math.exp(-k * (0 - x0)));
    const max = 1 / (1 + Math.exp(-k * (1 - x0)));
    return max - min > 1e-9 ? (val - min) / (max - min) : 0;
  };

  const workR = clampInput(r);
  const workG = clampInput(g);
  const workB = clampInput(b);

  const devR = applyHDCurve(workR, 4.25, 0.516);
  const devG = applyHDCurve(workG, 4.00, 0.500);
  const devB = applyHDCurve(workB, 3.75, 0.484);

  const crossR = workR * (1 - CROSS_PROCESS_TONE_MIX) + devR * CROSS_PROCESS_TONE_MIX;
  const crossG = workG * (1 - CROSS_PROCESS_TONE_MIX) + devG * CROSS_PROCESS_TONE_MIX;
  const crossB = workB * (1 - CROSS_PROCESS_TONE_MIX) + devB * CROSS_PROCESS_TONE_MIX;

  const dyeR = 1.014 * crossR - 0.009 * crossG - 0.002 * crossB;
  const dyeG = -0.007 * crossR + 1.014 * crossG - 0.007 * crossB;
  const dyeB = -0.009 * crossR - 0.015 * crossG + 1.022 * crossB;

  return [clamp01(dyeR), clamp01(dyeG), clamp01(dyeB)];
}

function applyBleachBypassLinearRgb(r: number, g: number, b: number): [number, number, number] {
  const workR = clamp01(r);
  const workG = clamp01(g);
  const workB = clamp01(b);

  const [h, s, v] = rgbToHsv(workR, workG, workB);
  const hueDependenceWeight = filterHueDependenceWeight(s);
  const valueShadowWeight = Math.pow(1 - v, 1.5);
  const bleachBypassBlueTargetHue = BLEACH_BYPASS_TARGET_HUE_DEGREES / 360;
  let signedHueDistance = h - bleachBypassBlueTargetHue;
  if (signedHueDistance > 0.5) signedHueDistance -= 1;
  if (signedHueDistance < -0.5) signedHueDistance += 1;
  const hueDistanceDegrees = Math.abs(signedHueDistance) * 360;
  const hueDistanceFactor = Math.min(
    1,
    hueDistanceDegrees / BLEACH_BYPASS_SATURATION_DISTANCE_MAX_DEGREES,
  );
  const shiftedHueDistanceDegrees =
    Math.pow(
      hueDistanceDegrees / BLEACH_BYPASS_SATURATION_DISTANCE_MAX_DEGREES,
      BLEACH_BYPASS_HUE_EXPONENT,
    ) * BLEACH_BYPASS_SATURATION_DISTANCE_MAX_DEGREES;
  const effectiveHueDistanceDegrees = hueDistanceDegrees
    + (shiftedHueDistanceDegrees - hueDistanceDegrees) * hueDependenceWeight;
  const shiftedHue =
    bleachBypassBlueTargetHue + Math.sign(signedHueDistance) * (effectiveHueDistanceDegrees / 360);
  const normalizedShiftedHue = ((shiftedHue % 1) + 1) % 1;
  const saturationByValue =
    BLEACH_BYPASS_SATURATION_SHADOW
    + (BLEACH_BYPASS_SATURATION_HIGHLIGHT - BLEACH_BYPASS_SATURATION_SHADOW) * v;
  const saturationByHueRaw =
    BLEACH_BYPASS_SATURATION_SAME_HUE
    + (BLEACH_BYPASS_SATURATION_OPPOSITE_HUE - BLEACH_BYPASS_SATURATION_SAME_HUE) * hueDistanceFactor;
  const saturationByHue = 1 + (saturationByHueRaw - 1) * hueDependenceWeight;
  const linearlyReducedS = clamp01(s * saturationByValue * saturationByHue);
  let [linearR, linearG, linearB] = hsvToRgb(
    normalizedShiftedHue,
    linearlyReducedS,
    v,
  );

  const vibranceByValue =
    BLEACH_BYPASS_VIBRANCE_SHADOW
    + (BLEACH_BYPASS_VIBRANCE_HIGHLIGHT - BLEACH_BYPASS_VIBRANCE_SHADOW) * v;
  const vibranceByHue = hueDependenceWeight * (
    BLEACH_BYPASS_VIBRANCE_SAME_HUE
    + (BLEACH_BYPASS_VIBRANCE_OPPOSITE_HUE - BLEACH_BYPASS_VIBRANCE_SAME_HUE) * hueDistanceFactor
  );
  const [, currentSaturation] = rgbToHsvExtended(linearR, linearG, linearB);
  const targetSaturation = applyScaledLogLinearExtended(
    currentSaturation,
    vibranceByValue * vibranceByHue,
  );
  [linearR, linearG, linearB] = applyHsvSaturationPreservingProPhotoLuminance(
    linearR,
    linearG,
    linearB,
    targetSaturation,
  );

  const filteredV = clamp01(v * (1 - BLEACH_BYPASS_VALUE_AMOUNT * valueShadowWeight));
  const valueScale = v > 1e-6 ? filteredV / v : 0;
  return [
    clamp01(linearR * valueScale),
    clamp01(linearG * valueScale),
    clamp01(linearB * valueScale),
  ];
}


function applyCyanotypeLinearRgb(
  r: number,
  g: number,
  b: number,
  x: number,
  yPos: number,
  width: number,
  height: number,
  exposureScaledLog: number,
): [number, number, number] {
  const texturedState = computeCyanotypeFilterTexturedState(
    r,
    g,
    b,
    x,
    yPos,
    width,
    height,
    exposureScaledLog,
  );
  const [paperR, paperG, paperB] = samplePhotochemicalPaperColor(
    x,
    yPos,
    width,
    height,
    1,
    1,
    1,
    CYANOTYPE_AGED_PAPER_R,
    CYANOTYPE_AGED_PAPER_G,
    CYANOTYPE_AGED_PAPER_B,
  );
  const residualStainOpacity = samplePhotochemicalResidualStainOpacity(x, yPos, width, height);
  const [fr, fg, fb] = composePhotochemicalImage(
    paperR,
    paperG,
    paperB,
    texturedState.imageR,
    texturedState.imageG,
    texturedState.imageB,
    texturedState.imageOpacity,
    residualStainOpacity,
  );
  return [clamp01(fr), clamp01(fg), clamp01(fb)];
}

function applySepiaFilterToCanvasData(
  rgba8: Uint8ClampedArray,
  width: number,
  height: number,
  profile: ImageEditOutputColorProfile,
): void {
  const beforeHistogram = new Uint32Array(FILTER_LOG_HISTOGRAM_BINS);
  const exposureHistogram = new Uint32Array(FILTER_LOG_HISTOGRAM_BINS);

  for (let i = 0; i < rgba8.length; i += 4) {
    const [r, g, b] = encodedRgbToLinearProphoto(
      (rgba8[i] ?? 0) / 255,
      (rgba8[i + 1] ?? 0) / 255,
      (rgba8[i + 2] ?? 0) / 255,
      profile,
    );
    accumulateLogLumaHistogram(beforeHistogram, prophotoLumaForFilter(r, g, b));
    accumulateLogLumaHistogram(exposureHistogram, computeSepiaExposure(r, g, b));
  }

  const beforeP50Ev = estimateLogPercentileFromHistogram(beforeHistogram, PHOTOCHEMICAL_TARGET_PERCENTILE);
  const exposureP50Ev = estimateLogPercentileFromHistogram(exposureHistogram, PHOTOCHEMICAL_TARGET_PERCENTILE);
  const beforeP50Luma = Math.pow(2, beforeP50Ev);
  const exposureP50 = Math.pow(2, exposureP50Ev);
  const exposureScaledLog = solvePhotochemicalExposureScaledLog(
    exposureP50,
    beforeP50Luma,
    SEPIA_MATERIAL_R,
    SEPIA_MATERIAL_G,
    SEPIA_MATERIAL_B,
  );

  for (let i = 0; i < rgba8.length; i += 4) {
    const pixelIndex = Math.floor(i / 4);
    const px = pixelIndex % width;
    const py = Math.floor(pixelIndex / width);
    const x = px + 0.5;
    const yPos = py + 0.5;
    const [r, g, b] = encodedRgbToLinearProphoto(
      (rgba8[i] ?? 0) / 255,
      (rgba8[i + 1] ?? 0) / 255,
      (rgba8[i + 2] ?? 0) / 255,
      profile,
    );
    const [fr, fg, fb] = applySepiaLinearRgb(r, g, b, x, yPos, width, height, exposureScaledLog);
    const [er, eg, eb] = convertLinearProPhotoToOutputRgb(fr, fg, fb, profile);
    rgba8[i] = linearChannelToSrgb(er);
    rgba8[i + 1] = linearChannelToSrgb(eg);
    rgba8[i + 2] = linearChannelToSrgb(eb);
  }
}

function applyCrossProcessFilterToCanvasData(
  rgba8: Uint8ClampedArray,
  width: number,
  height: number,
  profile: ImageEditOutputColorProfile,
): void {
  const beforeHistogram = new Uint32Array(FILTER_LOG_HISTOGRAM_BINS);
  const filteredHistogram = new Uint32Array(FILTER_LOG_HISTOGRAM_BINS);
  const filteredLinear = new Float32Array(width * height * 3);

  for (let i = 0; i < rgba8.length; i += 4) {
    const pixelIndex = Math.floor(i / 4);
    const linearIndex = pixelIndex * 3;
    const [r, g, b] = encodedRgbToLinearProphoto(
      (rgba8[i] ?? 0) / 255,
      (rgba8[i + 1] ?? 0) / 255,
      (rgba8[i + 2] ?? 0) / 255,
      profile,
    );
    const [fr, fg, fb] = applyChemicalCrossProcessLinearRgb(r, g, b);
    accumulateLogLumaHistogram(beforeHistogram, prophotoLumaForFilter(r, g, b));
    accumulateLogLumaHistogram(filteredHistogram, prophotoLumaForFilter(fr, fg, fb));
    filteredLinear[linearIndex] = fr;
    filteredLinear[linearIndex + 1] = fg;
    filteredLinear[linearIndex + 2] = fb;
  }

  const toneRecovery = computeCrossProcessToneRecovery(beforeHistogram, filteredHistogram);

  for (let i = 0; i < rgba8.length; i += 4) {
    const pixelIndex = Math.floor(i / 4);
    const linearIndex = pixelIndex * 3;
    const [recoveredR, recoveredG, recoveredB] = applyCrossProcessToneRecoveryLinearRgb(
      filteredLinear[linearIndex] ?? 0,
      filteredLinear[linearIndex + 1] ?? 0,
      filteredLinear[linearIndex + 2] ?? 0,
      toneRecovery,
    );
    const [er, eg, eb] = convertLinearProPhotoToOutputRgb(recoveredR, recoveredG, recoveredB, profile);
    rgba8[i] = linearChannelToSrgb(er);
    rgba8[i + 1] = linearChannelToSrgb(eg);
    rgba8[i + 2] = linearChannelToSrgb(eb);
  }
}

function applyCyanotypeFilterToCanvasData(
  rgba8: Uint8ClampedArray,
  width: number,
  height: number,
  profile: ImageEditOutputColorProfile,
): void {
  const beforeHistogram = new Uint32Array(FILTER_LOG_HISTOGRAM_BINS);
  const exposureHistogram = new Uint32Array(FILTER_LOG_HISTOGRAM_BINS);

  for (let i = 0; i < rgba8.length; i += 4) {
    const [r, g, b] = encodedRgbToLinearProphoto(
      (rgba8[i] ?? 0) / 255,
      (rgba8[i + 1] ?? 0) / 255,
      (rgba8[i + 2] ?? 0) / 255,
      profile,
    );
    accumulateLogLumaHistogram(beforeHistogram, prophotoLumaForFilter(r, g, b));
    accumulateLogLumaHistogram(exposureHistogram, computeCyanotypeExposure(r, g, b));
  }

  const beforeP50Ev = estimateLogPercentileFromHistogram(beforeHistogram, PHOTOCHEMICAL_TARGET_PERCENTILE);
  const exposureP50Ev = estimateLogPercentileFromHistogram(exposureHistogram, PHOTOCHEMICAL_TARGET_PERCENTILE);
  const beforeP50Luma = Math.pow(2, beforeP50Ev);
  const exposureP50 = Math.pow(2, exposureP50Ev);
  const exposureScaledLog = solvePhotochemicalExposureScaledLog(
    exposureP50,
    beforeP50Luma,
    CYANOTYPE_MATERIAL_R,
    CYANOTYPE_MATERIAL_G,
    CYANOTYPE_MATERIAL_B,
  );

  for (let i = 0; i < rgba8.length; i += 4) {
    const pixelIndex = Math.floor(i / 4);
    const px = pixelIndex % width;
    const py = Math.floor(pixelIndex / width);
    const x = px + 0.5;
    const yPos = py + 0.5;
    const [r, g, b] = encodedRgbToLinearProphoto(
      (rgba8[i] ?? 0) / 255,
      (rgba8[i + 1] ?? 0) / 255,
      (rgba8[i + 2] ?? 0) / 255,
      profile,
    );
    const [fr, fg, fb] = applyCyanotypeLinearRgb(r, g, b, x, yPos, width, height, exposureScaledLog);
    const [er, eg, eb] = convertLinearProPhotoToOutputRgb(fr, fg, fb, profile);
    rgba8[i] = linearChannelToSrgb(er);
    rgba8[i + 1] = linearChannelToSrgb(eg);
    rgba8[i + 2] = linearChannelToSrgb(eb);
  }
}

function applyClassicChromeFilterToCanvasData(
  rgba8: Uint8ClampedArray,
  width: number,
  height: number,
  profile: ImageEditOutputColorProfile,
): void {
  const beforeHistogram = new Uint32Array(FILTER_LOG_HISTOGRAM_BINS);
  const filteredHistogram = new Uint32Array(FILTER_LOG_HISTOGRAM_BINS);
  const filteredLinear = new Float32Array(width * height * 3);

  for (let i = 0; i < rgba8.length; i += 4) {
    const pixelIndex = Math.floor(i / 4);
    const linearIndex = pixelIndex * 3;
    const [r, g, b] = encodedRgbToLinearProphoto(
      (rgba8[i] ?? 0) / 255,
      (rgba8[i + 1] ?? 0) / 255,
      (rgba8[i + 2] ?? 0) / 255,
      profile,
    );
    const [fr, fg, fb] = applyClassicChromeLinearRgb(r, g, b);
    accumulateLogLumaHistogram(beforeHistogram, prophotoLumaForFilter(r, g, b));
    accumulateLogLumaHistogram(filteredHistogram, prophotoLumaForFilter(fr, fg, fb));
    filteredLinear[linearIndex] = fr;
    filteredLinear[linearIndex + 1] = fg;
    filteredLinear[linearIndex + 2] = fb;
  }

  const toneRecovery = computeClassicChromeToneRecovery(beforeHistogram, filteredHistogram);
  for (let i = 0; i < rgba8.length; i += 4) {
    const pixelIndex = Math.floor(i / 4);
    const linearIndex = pixelIndex * 3;
    const [recoveredR, recoveredG, recoveredB] = applyClassicChromeToneRecoveryLinearRgb(
      filteredLinear[linearIndex] ?? 0,
      filteredLinear[linearIndex + 1] ?? 0,
      filteredLinear[linearIndex + 2] ?? 0,
      toneRecovery,
    );
    const [limitedR, limitedG, limitedB] = limitFilterLinearRgbToUnitMax(
      recoveredR,
      recoveredG,
      recoveredB,
    );
    const [er, eg, eb] = convertLinearProPhotoToOutputRgb(
      limitedR,
      limitedG,
      limitedB,
      profile,
    );
    rgba8[i] = linearChannelToSrgb(er);
    rgba8[i + 1] = linearChannelToSrgb(eg);
    rgba8[i + 2] = linearChannelToSrgb(eb);
  }
}

function applyVelviaFilterToCanvasData(
  rgba8: Uint8ClampedArray,
  width: number,
  height: number,
  profile: ImageEditOutputColorProfile,
): void {
  const beforeHistogram = new Uint32Array(FILTER_LOG_HISTOGRAM_BINS);
  const filteredHistogram = new Uint32Array(FILTER_LOG_HISTOGRAM_BINS);
  const filteredLinear = new Float32Array(width * height * 3);

  for (let i = 0; i < rgba8.length; i += 4) {
    const pixelIndex = Math.floor(i / 4);
    const linearIndex = pixelIndex * 3;
    const [r, g, b] = encodedRgbToLinearProphoto(
      (rgba8[i] ?? 0) / 255,
      (rgba8[i + 1] ?? 0) / 255,
      (rgba8[i + 2] ?? 0) / 255,
      profile,
    );
    const [fr, fg, fb] = applyVelviaLinearRgb(r, g, b);
    accumulateLogLumaHistogram(beforeHistogram, prophotoLumaForFilter(r, g, b));
    accumulateLogLumaHistogram(filteredHistogram, prophotoLumaForFilter(fr, fg, fb));
    filteredLinear[linearIndex] = fr;
    filteredLinear[linearIndex + 1] = fg;
    filteredLinear[linearIndex + 2] = fb;
  }

  const toneRecovery = computeVelviaToneRecovery(beforeHistogram, filteredHistogram);
  for (let i = 0; i < rgba8.length; i += 4) {
    const pixelIndex = Math.floor(i / 4);
    const linearIndex = pixelIndex * 3;
    const [recoveredR, recoveredG, recoveredB] = applyVelviaToneRecoveryLinearRgb(
      filteredLinear[linearIndex] ?? 0,
      filteredLinear[linearIndex + 1] ?? 0,
      filteredLinear[linearIndex + 2] ?? 0,
      toneRecovery,
    );
    const [limitedR, limitedG, limitedB] = limitFilterLinearRgbToUnitMax(
      recoveredR,
      recoveredG,
      recoveredB,
    );
    const [er, eg, eb] = convertLinearProPhotoToOutputRgb(
      limitedR,
      limitedG,
      limitedB,
      profile,
    );
    rgba8[i] = linearChannelToSrgb(er);
    rgba8[i + 1] = linearChannelToSrgb(eg);
    rgba8[i + 2] = linearChannelToSrgb(eb);
  }
}

function applyBleachBypassFilterToCanvasData(
  rgba8: Uint8ClampedArray,
  width: number,
  height: number,
  profile: ImageEditOutputColorProfile,
): void {
  const beforeHistogram = new Uint32Array(FILTER_LOG_HISTOGRAM_BINS);
  const filteredHistogram = new Uint32Array(FILTER_LOG_HISTOGRAM_BINS);
  const filteredLinear = new Float32Array(width * height * 3);

  for (let i = 0; i < rgba8.length; i += 4) {
    const pixelIndex = Math.floor(i / 4);
    const linearIndex = pixelIndex * 3;
    const [r, g, b] = encodedRgbToLinearProphoto(
      (rgba8[i] ?? 0) / 255,
      (rgba8[i + 1] ?? 0) / 255,
      (rgba8[i + 2] ?? 0) / 255,
      profile,
    );
    const [fr, fg, fb] = applyBleachBypassLinearRgb(r, g, b);
    accumulateLogLumaHistogram(beforeHistogram, prophotoLumaForFilter(r, g, b));
    accumulateLogLumaHistogram(filteredHistogram, prophotoLumaForFilter(fr, fg, fb));
    filteredLinear[linearIndex] = fr;
    filteredLinear[linearIndex + 1] = fg;
    filteredLinear[linearIndex + 2] = fb;
  }

  const beforeP50Ev = estimateLogPercentileFromHistogram(beforeHistogram, BLEACH_BYPASS_TARGET_PERCENTILE);
  const filteredP50Ev = estimateLogPercentileFromHistogram(filteredHistogram, BLEACH_BYPASS_TARGET_PERCENTILE);
  const beforeP50Luma = Math.pow(2, beforeP50Ev);
  const filteredP50Luma = Math.pow(2, filteredP50Ev);
  const recoveryScaledLog = solveFilterScaledLogForTargetLuma(filteredP50Luma, beforeP50Luma);

  for (let i = 0; i < rgba8.length; i += 4) {
    const pixelIndex = Math.floor(i / 4);
    const linearIndex = pixelIndex * 3;
    const [recoveredR, recoveredG, recoveredB] = applyFilterScaledLogToLinearRgb(
      filteredLinear[linearIndex] ?? 0,
      filteredLinear[linearIndex + 1] ?? 0,
      filteredLinear[linearIndex + 2] ?? 0,
      recoveryScaledLog,
    );
    const [er, eg, eb] = convertLinearProPhotoToOutputRgb(recoveredR, recoveredG, recoveredB, profile);
    rgba8[i] = linearChannelToSrgb(er);
    rgba8[i + 1] = linearChannelToSrgb(eg);
    rgba8[i + 2] = linearChannelToSrgb(eb);
  }
}

function partColorTargetHueDegrees(preset: ImagePartColorPreset): number {
  switch (preset) {
    case "part-color-yellow":
      return 60;
    case "part-color-green":
      return 120;
    case "part-color-cyan":
      return 180;
    case "part-color-blue":
      return 240;
    case "part-color-magenta":
      return 300;
    case "part-color-red":
    default:
      return 0;
  }
}

function applyPartColorLinearRgb(
  r: number,
  g: number,
  b: number,
  preset: ImagePartColorPreset,
): [number, number, number] {
  const workR = clamp01(r);
  const workG = clamp01(g);
  const workB = clamp01(b);
  const originalLuma = prophotoLumaForFilter(workR, workG, workB);
  const [hue, saturation, value] = rgbToHsv(workR, workG, workB);
  if (!(saturation > 0)) return [workR, workG, workB];

  const targetHueDegrees = partColorTargetHueDegrees(preset);
  let signedHueDistance = hue - targetHueDegrees / 360;
  if (signedHueDistance > 0.5) signedHueDistance -= 1;
  if (signedHueDistance < -0.5) signedHueDistance += 1;
  const hueDistanceDegrees = Math.abs(signedHueDistance) * 360;
  const transitionSpan = Math.max(
    1e-9,
    PART_COLOR_OUTER_HALF_WIDTH_DEGREES - PART_COLOR_CORE_HALF_WIDTH_DEGREES,
  );
  const outsideWeight = smoothstep01(
    (hueDistanceDegrees - PART_COLOR_CORE_HALF_WIDTH_DEGREES) / transitionSpan,
  );
  const hueMaskSaturationScale =
    1 - outsideWeight * (1 - PART_COLOR_OUTSIDE_SATURATION_SCALE);

  // Hue is unstable near neutral. Fade the selective-color decision out there so
  // tiny RGB differences in mist/gray gradients cannot become color banding.
  const hueDependenceWeight = filterHueDependenceWeight(saturation);
  const saturationScale = 1 + (hueMaskSaturationScale - 1) * hueDependenceWeight;
  const targetSaturation = clamp01(saturation * saturationScale);

  // Pull hue toward the pure primary target. Inside 60 degrees, compress the
  // angular distance linearly to half. Outside that region, continue pulling in
  // a continuous linear way by connecting (60, 30) to (180, 180). Low-sat hues
  // remain guarded so mist/gray gradients do not turn into banding.
  const shiftedHueDistanceDegrees = hueDistanceDegrees <= PART_COLOR_HUE_PULL_INNER_RADIUS_DEGREES
    ? hueDistanceDegrees * PART_COLOR_HUE_PULL_INNER_SCALE
    : 1.25 * hueDistanceDegrees - 45;
  const effectiveHueDistanceDegrees = hueDistanceDegrees
    + (shiftedHueDistanceDegrees - hueDistanceDegrees) * hueDependenceWeight;
  const shiftedHue = targetHueDegrees / 360
    + Math.sign(signedHueDistance) * (effectiveHueDistanceDegrees / 360);
  const normalizedShiftedHue = ((shiftedHue % 1) + 1) % 1;

  let [linearR, linearG, linearB] = hsvToRgb(
    normalizedShiftedHue,
    targetSaturation,
    value,
  );
  [linearR, linearG, linearB] = scaleLinearRgbToFilterLuma(
    linearR,
    linearG,
    linearB,
    originalLuma,
  );
  return limitFilterLinearRgbToUnitMax(linearR, linearG, linearB);
}

function applyPartColorFilterToCanvasData(
  rgba8: Uint8ClampedArray,
  profile: ImageEditOutputColorProfile,
  preset: ImagePartColorPreset,
): void {
  for (let i = 0; i < rgba8.length; i += 4) {
    const [r, g, b] = encodedRgbToLinearProphoto(
      (rgba8[i] ?? 0) / 255,
      (rgba8[i + 1] ?? 0) / 255,
      (rgba8[i + 2] ?? 0) / 255,
      profile,
    );
    const [fr, fg, fb] = applyPartColorLinearRgb(r, g, b, preset);
    const [er, eg, eb] = convertLinearProPhotoToOutputRgb(fr, fg, fb, profile);
    rgba8[i] = linearChannelToSrgb(er);
    rgba8[i + 1] = linearChannelToSrgb(eg);
    rgba8[i + 2] = linearChannelToSrgb(eb);
  }
}

function applyPartColorFilterToRgb16(
  data: Uint16Array,
  width: number,
  height: number,
  preset: ImagePartColorPreset,
): void {
  const pixelCount = width * height;
  for (let pixel = 0; pixel < pixelCount; pixel += 1) {
    const index = pixel * 3;
    const r = decodeStoredRgb16Channel(data[index] ?? 0, "gamma20", 1);
    const g = decodeStoredRgb16Channel(data[index + 1] ?? 0, "gamma20", 1);
    const b = decodeStoredRgb16Channel(data[index + 2] ?? 0, "gamma20", 1);
    const [fr, fg, fb] = applyPartColorLinearRgb(r, g, b, preset);
    data[index] = encodeStoredRgb16Channel(fr, "gamma20", 1);
    data[index + 1] = encodeStoredRgb16Channel(fg, "gamma20", 1);
    data[index + 2] = encodeStoredRgb16Channel(fb, "gamma20", 1);
  }
}

type DuotoneEndpointColor = readonly [number, number, number];

const DUOTONE_ENDPOINT_LUMA_CENTER = 0.5;
const DUOTONE_ENDPOINT_LUMA_DIFFERENCE = 0.75;
const DUOTONE_HIGHLIGHT_MIN_LUMA = Math.min(1, DUOTONE_ENDPOINT_LUMA_CENTER + DUOTONE_ENDPOINT_LUMA_DIFFERENCE / 2);
const DUOTONE_SHADOW_MAX_LUMA = Math.max(0, DUOTONE_ENDPOINT_LUMA_CENTER - DUOTONE_ENDPOINT_LUMA_DIFFERENCE / 2);
const DUOTONE_SHADOW_DETAIL = 0.5;

function duotonePureHighlightColor(preset: ImageDuotonePreset): DuotoneEndpointColor {
  switch (preset) {
    case "duotone-red":
      return [1, 0, 0];
    case "duotone-yellow":
      return [1, 1, 0];
    case "duotone-green":
      return [0, 1, 0];
    case "duotone-cyan":
      return [0, 1, 1];
    case "duotone-blue":
      return [0, 0, 1];
    case "duotone-magenta":
      return [1, 0, 1];
  }
  const exhaustiveCheck: never = preset;
  void exhaustiveCheck;
  return [1, 0, 0];
}

function duotonePureShadowColor(preset: ImageDuotonePreset): DuotoneEndpointColor {
  switch (preset) {
    case "duotone-red":
      return [0, 1, 1];
    case "duotone-yellow":
      return [0, 0, 1];
    case "duotone-green":
      return [1, 0, 1];
    case "duotone-cyan":
      return [1, 0, 0];
    case "duotone-blue":
      return [1, 1, 0];
    case "duotone-magenta":
      return [0, 1, 0];
  }
  const exhaustiveCheck: never = preset;
  void exhaustiveCheck;
  return [0, 0, 0];
}

function duotoneRec709Luma(color: DuotoneEndpointColor): number {
  const [wr, wg, wb] = MONOCHROME_PRESET_WEIGHTS.rec709;
  return color[0] * wr + color[1] * wg + color[2] * wb;
}

function duotoneTintTowardWhite(color: DuotoneEndpointColor, minLuma: number): DuotoneEndpointColor {
  const sourceLuma = duotoneRec709Luma(color);
  if (sourceLuma >= minLuma) return color;
  const denominator = 1 - sourceLuma;
  if (!(denominator > 1e-12)) return color;
  const t = clamp01((minLuma - sourceLuma) / denominator);
  return [
    color[0] + (1 - color[0]) * t,
    color[1] + (1 - color[1]) * t,
    color[2] + (1 - color[2]) * t,
  ];
}

function duotoneShadeTowardBlack(color: DuotoneEndpointColor, maxLuma: number): DuotoneEndpointColor {
  const sourceLuma = duotoneRec709Luma(color);
  if (sourceLuma <= maxLuma) return color;
  if (!(sourceLuma > 1e-12)) return color;
  const scale = clamp01(maxLuma / sourceLuma);
  return [color[0] * scale, color[1] * scale, color[2] * scale];
}

function applyDuotoneToneMapping(grayscale: number): number {
  const x = clamp01(grayscale);
  const k = clamp01(DUOTONE_SHADOW_DETAIL);
  return clamp01(x + k * x * (1 - x) * (1 - 2 * x));
}

function duotoneShadowColor(preset: ImageDuotonePreset): DuotoneEndpointColor {
  return duotoneShadeTowardBlack(duotonePureShadowColor(preset), DUOTONE_SHADOW_MAX_LUMA);
}

function duotoneHighlightColor(preset: ImageDuotonePreset): DuotoneEndpointColor {
  return duotoneTintTowardWhite(duotonePureHighlightColor(preset), DUOTONE_HIGHLIGHT_MIN_LUMA);
}

function applyDuotoneLinearRgb(
  r: number,
  g: number,
  b: number,
  preset: ImageDuotonePreset,
): [number, number, number] {
  const [wr, wg, wb] = MONOCHROME_PRESET_WEIGHTS.rec709;
  const grayscale = clamp01(r * wr + g * wg + b * wb);
  const tone = applyDuotoneToneMapping(grayscale);
  const [shadowR, shadowG, shadowB] = duotoneShadowColor(preset);
  const [highlightR, highlightG, highlightB] = duotoneHighlightColor(preset);
  return [
    shadowR + (highlightR - shadowR) * tone,
    shadowG + (highlightG - shadowG) * tone,
    shadowB + (highlightB - shadowB) * tone,
  ];
}

function applyDuotoneFilterToCanvasData(
  rgba8: Uint8ClampedArray,
  profile: ImageEditOutputColorProfile,
  preset: ImageDuotonePreset,
): void {
  for (let i = 0; i < rgba8.length; i += 4) {
    const [r, g, b] = encodedRgbToLinearProphoto(
      (rgba8[i] ?? 0) / 255,
      (rgba8[i + 1] ?? 0) / 255,
      (rgba8[i + 2] ?? 0) / 255,
      profile,
    );
    const [fr, fg, fb] = applyDuotoneLinearRgb(r, g, b, preset);
    const [er, eg, eb] = convertLinearProPhotoToOutputRgb(fr, fg, fb, profile);
    rgba8[i] = linearChannelToSrgb(er);
    rgba8[i + 1] = linearChannelToSrgb(eg);
    rgba8[i + 2] = linearChannelToSrgb(eb);
  }
}

function applyDuotoneFilterToRgb16(
  data: Uint16Array,
  width: number,
  height: number,
  preset: ImageDuotonePreset,
): void {
  const pixelCount = width * height;
  for (let pixel = 0; pixel < pixelCount; pixel += 1) {
    const index = pixel * 3;
    const r = decodeStoredRgb16Channel(data[index] ?? 0, "gamma20", 1);
    const g = decodeStoredRgb16Channel(data[index + 1] ?? 0, "gamma20", 1);
    const b = decodeStoredRgb16Channel(data[index + 2] ?? 0, "gamma20", 1);
    const [fr, fg, fb] = applyDuotoneLinearRgb(r, g, b, preset);
    data[index] = encodeStoredRgb16Channel(fr, "gamma20", 1);
    data[index + 1] = encodeStoredRgb16Channel(fg, "gamma20", 1);
    data[index + 2] = encodeStoredRgb16Channel(fb, "gamma20", 1);
  }
}

const DICHROME_SPOT_HUE_CORE_HALF_WIDTH_DEGREES = 30;
const DICHROME_SPOT_HUE_OUTER_HALF_WIDTH_DEGREES = 60;
const DICHROME_SPOT_KEEP_CHANNEL_ABSORPTION = 0.15;
const DICHROME_SPOT_BLOCK_CHANNEL_ABSORPTION = 1.0;
const DICHROME_TWO_SPOT_EPSILON = 1e-6;
const DICHROME_TWO_SPOT_MAX_PLATE_DENSITY = 1.6;
const DICHROME_TWO_SPOT_PAPER: readonly [number, number, number] = [1.0, 0.992, 0.975];
const DICHROME_TWO_SPOT_RED_ABSORPTION: readonly [number, number, number] = [0.25, 1.45, 1.8];
const DICHROME_TWO_SPOT_GREEN_TOWARD_BLUE_ABSORPTION: readonly [number, number, number] = [1.35, 0.42, 1.1];
const DICHROME_TWO_SPOT_GREEN_TOWARD_RED_ABSORPTION: readonly [number, number, number] = [0.9, 0.42, 1.7];
const DICHROME_TWO_SPOT_BLUE_ABSORPTION: readonly [number, number, number] = [1.55, 1.25, 0.25];

function dichromeSpotTargetHueDegrees(preset: ImageDichromePreset): number | null {
  switch (preset) {
    case "dichrome-rk":
      return 0;
    case "dichrome-gk":
      return 120;
    case "dichrome-bk":
      return 240;
    default:
      return null;
  }
}

function dichromeSpotPlateDensity(
  r: number,
  g: number,
  b: number,
  targetHueDegrees: number,
): number {
  const [hue, saturation, value] = rgbToHsv(r, g, b);
  if (!(saturation > 0 && value > 0)) return 0;
  const hueDegrees = hue * 360;
  const rawDistance = Math.abs(hueDegrees - targetHueDegrees);
  const hueDistanceDegrees = Math.min(rawDistance, 360 - rawDistance);
  const transitionSpan = Math.max(
    1e-9,
    DICHROME_SPOT_HUE_OUTER_HALF_WIDTH_DEGREES - DICHROME_SPOT_HUE_CORE_HALF_WIDTH_DEGREES,
  );
  const outsideWeight = smoothstep01(
    (hueDistanceDegrees - DICHROME_SPOT_HUE_CORE_HALF_WIDTH_DEGREES) / transitionSpan,
  );
  const hueMask = 1 - outsideWeight;
  const hueDependenceWeight = filterHueDependenceWeight(saturation);
  return clamp01(hueMask * hueDependenceWeight * saturation * value);
}
type DichromeSpotAbsorption = readonly [number, number, number];

function dichromeTwoSpotAbsorptions(
  preset: ImageDichromePreset,
): readonly [DichromeSpotAbsorption, DichromeSpotAbsorption] | null {
  switch (preset) {
    case "dichrome-rg":
      return [DICHROME_TWO_SPOT_RED_ABSORPTION, DICHROME_TWO_SPOT_GREEN_TOWARD_BLUE_ABSORPTION];
    case "dichrome-bg":
      return [DICHROME_TWO_SPOT_BLUE_ABSORPTION, DICHROME_TWO_SPOT_GREEN_TOWARD_RED_ABSORPTION];
    case "dichrome-rb":
      return [DICHROME_TWO_SPOT_RED_ABSORPTION, DICHROME_TWO_SPOT_BLUE_ABSORPTION];
    default:
      return null;
  }
}

function dichromeTwoSpotProjectDensityToRgb(
  firstDensity: number,
  secondDensity: number,
  firstAbsorption: DichromeSpotAbsorption,
  secondAbsorption: DichromeSpotAbsorption,
): [number, number, number] {
  const opticalR = firstDensity * firstAbsorption[0] + secondDensity * secondAbsorption[0];
  const opticalG = firstDensity * firstAbsorption[1] + secondDensity * secondAbsorption[1];
  const opticalB = firstDensity * firstAbsorption[2] + secondDensity * secondAbsorption[2];
  return [
    clamp01(DICHROME_TWO_SPOT_PAPER[0] * Math.exp(-opticalR)),
    clamp01(DICHROME_TWO_SPOT_PAPER[1] * Math.exp(-opticalG)),
    clamp01(DICHROME_TWO_SPOT_PAPER[2] * Math.exp(-opticalB)),
  ];
}

function solveDichromeTwoSpotPlateDensities(
  r: number,
  g: number,
  b: number,
  firstAbsorption: DichromeSpotAbsorption,
  secondAbsorption: DichromeSpotAbsorption,
): [number, number] {
  const targetR = clamp01(r) / DICHROME_TWO_SPOT_PAPER[0];
  const targetG = clamp01(g) / DICHROME_TWO_SPOT_PAPER[1];
  const targetB = clamp01(b) / DICHROME_TWO_SPOT_PAPER[2];
  const y0 = -Math.log(Math.max(DICHROME_TWO_SPOT_EPSILON, targetR));
  const y1 = -Math.log(Math.max(DICHROME_TWO_SPOT_EPSILON, targetG));
  const y2 = -Math.log(Math.max(DICHROME_TWO_SPOT_EPSILON, targetB));
  const a0 = firstAbsorption[0];
  const a1 = firstAbsorption[1];
  const a2 = firstAbsorption[2];
  const b0 = secondAbsorption[0];
  const b1 = secondAbsorption[1];
  const b2 = secondAbsorption[2];
  const aa = a0 * a0 + a1 * a1 + a2 * a2;
  const bb = b0 * b0 + b1 * b1 + b2 * b2;
  const ab = a0 * b0 + a1 * b1 + a2 * b2;
  const ay = a0 * y0 + a1 * y1 + a2 * y2;
  const by = b0 * y0 + b1 * y1 + b2 * y2;
  const det = aa * bb - ab * ab;

  const candidates: Array<readonly [number, number]> = [[0, 0]];
  if (aa > 1e-9) {
    candidates.push([Math.min(DICHROME_TWO_SPOT_MAX_PLATE_DENSITY, Math.max(0, ay / aa)), 0]);
  }
  if (bb > 1e-9) {
    candidates.push([0, Math.min(DICHROME_TWO_SPOT_MAX_PLATE_DENSITY, Math.max(0, by / bb))]);
  }
  if (Math.abs(det) > 1e-9) {
    const firstDensity = (ay * bb - by * ab) / det;
    const secondDensity = (aa * by - ab * ay) / det;
    if (firstDensity >= 0 && secondDensity >= 0) {
      candidates.push([
        Math.min(DICHROME_TWO_SPOT_MAX_PLATE_DENSITY, firstDensity),
        Math.min(DICHROME_TWO_SPOT_MAX_PLATE_DENSITY, secondDensity),
      ]);
    }
  }

  let best: readonly [number, number] = candidates[0];
  let bestErr = Number.POSITIVE_INFINITY;
  for (const [firstDensity, secondDensity] of candidates) {
    const projectedR = firstDensity * a0 + secondDensity * b0;
    const projectedG = firstDensity * a1 + secondDensity * b1;
    const projectedB = firstDensity * a2 + secondDensity * b2;
    const err = (projectedR - y0) ** 2 + (projectedG - y1) ** 2 + (projectedB - y2) ** 2;
    if (err < bestErr) {
      bestErr = err;
      best = [firstDensity, secondDensity];
    }
  }
  return [best[0], best[1]];
}

function applyDichromeCmykLinearRgb(
  r: number,
  g: number,
  b: number,
  preset: ImageDichromePreset,
): [number, number, number] {
  const workR = clamp01(r);
  const workG = clamp01(g);
  const workB = clamp01(b);
  const c0 = 1 - workR;
  const m0 = 1 - workG;
  const y0 = 1 - workB;
  const k = Math.min(c0, m0, y0);
  const c = c0 - k;
  const m = m0 - k;
  const y = y0 - k;

  if (preset === "dichrome-ck" || preset === "dichrome-mk" || preset === "dichrome-yk") {
    const keepC = preset === "dichrome-ck" ? c : 0;
    const keepM = preset === "dichrome-mk" ? m : 0;
    const keepY = preset === "dichrome-yk" ? y : 0;
    return [
      clamp01(1 - Math.min(1, keepC + k)),
      clamp01(1 - Math.min(1, keepM + k)),
      clamp01(1 - Math.min(1, keepY + k)),
    ];
  }

  const twoSpotAbsorptions = dichromeTwoSpotAbsorptions(preset);
  if (twoSpotAbsorptions) {
    const [firstAbsorption, secondAbsorption] = twoSpotAbsorptions;
    const [firstDensity, secondDensity] = solveDichromeTwoSpotPlateDensities(
      workR,
      workG,
      workB,
      firstAbsorption,
      secondAbsorption,
    );
    return dichromeTwoSpotProjectDensityToRgb(
      firstDensity,
      secondDensity,
      firstAbsorption,
      secondAbsorption,
    );
  }

  const targetHueDegrees = dichromeSpotTargetHueDegrees(preset);
  const spotDensity = targetHueDegrees == null
    ? 0
    : dichromeSpotPlateDensity(workR, workG, workB, targetHueDegrees);
  let absorptionR = DICHROME_SPOT_BLOCK_CHANNEL_ABSORPTION;
  let absorptionG = DICHROME_SPOT_BLOCK_CHANNEL_ABSORPTION;
  let absorptionB = DICHROME_SPOT_BLOCK_CHANNEL_ABSORPTION;
  if (preset === "dichrome-rk") {
    absorptionR = DICHROME_SPOT_KEEP_CHANNEL_ABSORPTION;
  } else if (preset === "dichrome-gk") {
    absorptionG = DICHROME_SPOT_KEEP_CHANNEL_ABSORPTION;
  } else if (preset === "dichrome-bk") {
    absorptionB = DICHROME_SPOT_KEEP_CHANNEL_ABSORPTION;
  }
  return [
    clamp01(1 - Math.min(1, k + spotDensity * absorptionR)),
    clamp01(1 - Math.min(1, k + spotDensity * absorptionG)),
    clamp01(1 - Math.min(1, k + spotDensity * absorptionB)),
  ];
}

function applyDichromeFilterToCanvasData(
  rgba8: Uint8ClampedArray,
  profile: ImageEditOutputColorProfile,
  preset: ImageDichromePreset,
): void {
  for (let i = 0; i < rgba8.length; i += 4) {
    const [r, g, b] = encodedRgbToLinearProphoto(
      (rgba8[i] ?? 0) / 255,
      (rgba8[i + 1] ?? 0) / 255,
      (rgba8[i + 2] ?? 0) / 255,
      profile,
    );
    const [fr, fg, fb] = applyDichromeCmykLinearRgb(r, g, b, preset);
    const [er, eg, eb] = convertLinearProPhotoToOutputRgb(fr, fg, fb, profile);
    rgba8[i] = linearChannelToSrgb(er);
    rgba8[i + 1] = linearChannelToSrgb(eg);
    rgba8[i + 2] = linearChannelToSrgb(eb);
  }
}

function applyDichromeFilterToRgb16(
  data: Uint16Array,
  width: number,
  height: number,
  preset: ImageDichromePreset,
): void {
  const pixelCount = width * height;
  for (let pixel = 0; pixel < pixelCount; pixel += 1) {
    const index = pixel * 3;
    const r = decodeStoredRgb16Channel(data[index] ?? 0, "gamma20", 1);
    const g = decodeStoredRgb16Channel(data[index + 1] ?? 0, "gamma20", 1);
    const b = decodeStoredRgb16Channel(data[index + 2] ?? 0, "gamma20", 1);
    const [fr, fg, fb] = applyDichromeCmykLinearRgb(r, g, b, preset);
    data[index] = encodeStoredRgb16Channel(fr, "gamma20", 1);
    data[index + 1] = encodeStoredRgb16Channel(fg, "gamma20", 1);
    data[index + 2] = encodeStoredRgb16Channel(fb, "gamma20", 1);
  }
}

function applyTrichromeChannelProjectionLinearRgb(
  r: number,
  g: number,
  b: number,
  preset: ImageTrichromePreset,
): [number, number, number] {
  if (preset === "trichrome-yb") {
    const yellow = (r + g) * 0.5;
    return [yellow, yellow, b];
  }
  if (preset === "trichrome-rc") {
    const cyan = (g + b) * 0.5;
    return [r, cyan, cyan];
  }
  const magenta = (r + b) * 0.5;
  return [magenta, g, magenta];
}

function applyTrichromeFilterToCanvasData(
  rgba8: Uint8ClampedArray,
  width: number,
  height: number,
  profile: ImageEditOutputColorProfile,
  preset: ImageTrichromePreset,
): void {
  const beforeHistogram = new Uint32Array(FILTER_LOG_HISTOGRAM_BINS);
  const filteredHistogram = new Uint32Array(FILTER_LOG_HISTOGRAM_BINS);
  const filteredLinear = new Float32Array(width * height * 3);

  for (let i = 0; i < rgba8.length; i += 4) {
    const pixelIndex = Math.floor(i / 4);
    const linearIndex = pixelIndex * 3;
    const [r, g, b] = encodedRgbToLinearProphoto(
      (rgba8[i] ?? 0) / 255,
      (rgba8[i + 1] ?? 0) / 255,
      (rgba8[i + 2] ?? 0) / 255,
      profile,
    );
    const [fr, fg, fb] = applyTrichromeChannelProjectionLinearRgb(r, g, b, preset);
    accumulateLogLumaHistogram(beforeHistogram, prophotoLumaForFilter(r, g, b));
    accumulateLogLumaHistogram(filteredHistogram, prophotoLumaForFilter(fr, fg, fb));
    filteredLinear[linearIndex] = fr;
    filteredLinear[linearIndex + 1] = fg;
    filteredLinear[linearIndex + 2] = fb;
  }

  const beforeP50Ev = estimateLogPercentileFromHistogram(beforeHistogram, TRICHROME_TARGET_PERCENTILE);
  const filteredP50Ev = estimateLogPercentileFromHistogram(filteredHistogram, TRICHROME_TARGET_PERCENTILE);
  const beforeP50Luma = Math.pow(2, beforeP50Ev);
  const filteredP50Luma = Math.pow(2, filteredP50Ev);
  const recoveryScaledLog = solveFilterScaledLogForTargetLuma(filteredP50Luma, beforeP50Luma);

  for (let i = 0; i < rgba8.length; i += 4) {
    const pixelIndex = Math.floor(i / 4);
    const linearIndex = pixelIndex * 3;
    const [recoveredR, recoveredG, recoveredB] = applyFilterScaledLogToLinearRgb(
      filteredLinear[linearIndex] ?? 0,
      filteredLinear[linearIndex + 1] ?? 0,
      filteredLinear[linearIndex + 2] ?? 0,
      recoveryScaledLog,
    );
    const [er, eg, eb] = convertLinearProPhotoToOutputRgb(recoveredR, recoveredG, recoveredB, profile);
    rgba8[i] = linearChannelToSrgb(er);
    rgba8[i + 1] = linearChannelToSrgb(eg);
    rgba8[i + 2] = linearChannelToSrgb(eb);
  }
}

function applyTrichromeFilterToRgb16(
  data: Uint16Array,
  width: number,
  height: number,
  preset: ImageTrichromePreset,
): void {
  const beforeHistogram = new Uint32Array(FILTER_LOG_HISTOGRAM_BINS);
  const filteredHistogram = new Uint32Array(FILTER_LOG_HISTOGRAM_BINS);
  const pixelCount = width * height;

  for (let pixel = 0; pixel < pixelCount; pixel += 1) {
    const index = pixel * 3;
    const r = decodeStoredRgb16Channel(data[index] ?? 0, "gamma20", 1);
    const g = decodeStoredRgb16Channel(data[index + 1] ?? 0, "gamma20", 1);
    const b = decodeStoredRgb16Channel(data[index + 2] ?? 0, "gamma20", 1);
    const [fr, fg, fb] = applyTrichromeChannelProjectionLinearRgb(r, g, b, preset);
    accumulateLogLumaHistogram(beforeHistogram, prophotoLumaForFilter(r, g, b));
    accumulateLogLumaHistogram(filteredHistogram, prophotoLumaForFilter(fr, fg, fb));
    data[index] = encodeStoredRgb16Channel(fr, "gamma20", 1);
    data[index + 1] = encodeStoredRgb16Channel(fg, "gamma20", 1);
    data[index + 2] = encodeStoredRgb16Channel(fb, "gamma20", 1);
  }

  const beforeP50Ev = estimateLogPercentileFromHistogram(beforeHistogram, TRICHROME_TARGET_PERCENTILE);
  const filteredP50Ev = estimateLogPercentileFromHistogram(filteredHistogram, TRICHROME_TARGET_PERCENTILE);
  const beforeP50Luma = Math.pow(2, beforeP50Ev);
  const filteredP50Luma = Math.pow(2, filteredP50Ev);
  const recoveryScaledLog = solveFilterScaledLogForTargetLuma(filteredP50Luma, beforeP50Luma);
  applyFilterScaledLogToRgb16(data, width, height, recoveryScaledLog);
}

function buildFilterLumaFromCanvasData(
  rgba8: Uint8ClampedArray,
  width: number,
  height: number,
  profile: ImageEditOutputColorProfile,
): Float32Array {
  const luma = new Float32Array(width * height);
  for (let pixel = 0; pixel < width * height; pixel += 1) {
    const index = pixel * 4;
    const [r, g, b] = encodedRgbToLinearProphoto(
      (rgba8[index] ?? 0) / 255,
      (rgba8[index + 1] ?? 0) / 255,
      (rgba8[index + 2] ?? 0) / 255,
      profile,
    );
    luma[pixel] = prophotoLumaForFilter(r, g, b);
  }
  return luma;
}

function buildFilterLumaFromRgb16(data: Uint16Array, width: number, height: number): Float32Array {
  const luma = new Float32Array(width * height);
  for (let pixel = 0; pixel < width * height; pixel += 1) {
    const index = pixel * 3;
    const r = decodeStoredRgb16Channel(data[index] ?? 0, "gamma20", 1);
    const g = decodeStoredRgb16Channel(data[index + 1] ?? 0, "gamma20", 1);
    const b = decodeStoredRgb16Channel(data[index + 2] ?? 0, "gamma20", 1);
    luma[pixel] = prophotoLumaForFilter(r, g, b);
  }
  return luma;
}

type GrayFloatImage = {
  width: number;
  height: number;
  data: Float32Array;
};

function downsampleGrayFloatImage2x(level: GrayFloatImage): GrayFloatImage {
  const dstWidth = Math.max(1, Math.floor(level.width / 2));
  const dstHeight = Math.max(1, Math.floor(level.height / 2));
  if (dstWidth === level.width && dstHeight === level.height) return level;
  const dst = new Float32Array(dstWidth * dstHeight);
  for (let y = 0; y < dstHeight; y += 1) {
    const sy0 = Math.min(level.height - 1, y * 2);
    const sy1 = Math.min(level.height - 1, sy0 + 1);
    for (let x = 0; x < dstWidth; x += 1) {
      const sx0 = Math.min(level.width - 1, x * 2);
      const sx1 = Math.min(level.width - 1, sx0 + 1);
      const a = level.data[sy0 * level.width + sx0] ?? 0;
      const b = level.data[sy0 * level.width + sx1] ?? 0;
      const c = level.data[sy1 * level.width + sx0] ?? 0;
      const d = level.data[sy1 * level.width + sx1] ?? 0;
      dst[y * dstWidth + x] = (a + b + c + d) * 0.25;
    }
  }
  return { width: dstWidth, height: dstHeight, data: dst };
}

function resizeGrayFloatImageBilinear(src: GrayFloatImage, dstWidth: number, dstHeight: number): Float32Array {
  if (src.width === dstWidth && src.height === dstHeight) return src.data.slice();
  const dst = new Float32Array(dstWidth * dstHeight);
  const scaleX = src.width / Math.max(1, dstWidth);
  const scaleY = src.height / Math.max(1, dstHeight);
  for (let y = 0; y < dstHeight; y += 1) {
    const sy = (y + 0.5) * scaleY - 0.5;
    const y0 = Math.max(0, Math.min(src.height - 1, Math.floor(sy)));
    const y1 = Math.max(0, Math.min(src.height - 1, y0 + 1));
    const ty = sy - y0;
    for (let x = 0; x < dstWidth; x += 1) {
      const sx = (x + 0.5) * scaleX - 0.5;
      const x0 = Math.max(0, Math.min(src.width - 1, Math.floor(sx)));
      const x1 = Math.max(0, Math.min(src.width - 1, x0 + 1));
      const tx = sx - x0;
      const p00 = src.data[y0 * src.width + x0] ?? 0;
      const p10 = src.data[y0 * src.width + x1] ?? 0;
      const p01 = src.data[y1 * src.width + x0] ?? 0;
      const p11 = src.data[y1 * src.width + x1] ?? 0;
      const top = p00 + (p10 - p00) * tx;
      const bottom = p01 + (p11 - p01) * tx;
      dst[y * dstWidth + x] = top + (bottom - top) * ty;
    }
  }
  return dst;
}

function buildGaussianKernel1d(sigma: number): Float32Array {
  const safeSigma = Math.max(1e-6, sigma);
  const radius = Math.max(1, Math.ceil(safeSigma * 3));
  const size = radius * 2 + 1;
  const kernel = new Float32Array(size);
  let sum = 0;
  for (let i = -radius; i <= radius; i += 1) {
    const value = Math.exp(-(i * i) / (2 * safeSigma * safeSigma));
    kernel[i + radius] = value;
    sum += value;
  }
  const inv = sum > 0 ? 1 / sum : 1;
  for (let i = 0; i < size; i += 1) kernel[i] *= inv;
  return kernel;
}

function convolveGrayFloatImageSeparable(
  src: Float32Array,
  width: number,
  height: number,
  kernel: Float32Array,
): Float32Array {
  const radius = Math.floor(kernel.length / 2);
  const tmp = new Float32Array(width * height);
  const dst = new Float32Array(width * height);
  for (let y = 0; y < height; y += 1) {
    const row = y * width;
    for (let x = 0; x < width; x += 1) {
      let sum = 0;
      for (let k = -radius; k <= radius; k += 1) {
        const sx = Math.max(0, Math.min(width - 1, x + k));
        sum += (src[row + sx] ?? 0) * (kernel[k + radius] ?? 0);
      }
      tmp[row + x] = sum;
    }
  }
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let sum = 0;
      for (let k = -radius; k <= radius; k += 1) {
        const sy = Math.max(0, Math.min(height - 1, y + k));
        sum += (tmp[sy * width + x] ?? 0) * (kernel[k + radius] ?? 0);
      }
      dst[y * width + x] = sum;
    }
  }
  return dst;
}

function blurGrayFloatImageGaussian(
  src: Float32Array,
  width: number,
  height: number,
  sigma: number,
): Float32Array {
  return convolveGrayFloatImageSeparable(src, width, height, buildGaussianKernel1d(sigma));
}

function computeFloatArrayPercentile(values: Float32Array, percentile: number): number {
  if (values.length <= 0) return 0;
  const clamped = clamp01(percentile);
  const sorted = Array.from(values).sort((a, b) => a - b);
  const index = Math.max(0, Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * clamped)));
  return sorted[index] ?? 0;
}

function computeMultiScaleEdgeLevel(level: GrayFloatImage, scaleIndex: number): Float32Array {
  const { width, height, data } = level;
  const result = new Float32Array(width * height);
  const sobelScale = Math.pow(2, scaleIndex);
  const laplacianScale = sobelScale * sobelScale;
  let sum = 0;

  for (let y = 0; y < height; y += 1) {
    const y0 = Math.max(0, y - 1);
    const y1 = Math.min(height - 1, y + 1);
    for (let x = 0; x < width; x += 1) {
      const x0 = Math.max(0, x - 1);
      const x1 = Math.min(width - 1, x + 1);
      const tl = data[y0 * width + x0] ?? 0;
      const tc = data[y0 * width + x] ?? 0;
      const tr = data[y0 * width + x1] ?? 0;
      const ml = data[y * width + x0] ?? 0;
      const mc = data[y * width + x] ?? 0;
      const mr = data[y * width + x1] ?? 0;
      const bl = data[y1 * width + x0] ?? 0;
      const bc = data[y1 * width + x] ?? 0;
      const br = data[y1 * width + x1] ?? 0;

      const gx = -tl - 2 * ml - bl + tr + 2 * mr + br;
      const gy = -tl - 2 * tc - tr + bl + 2 * bc + br;
      const sobel = Math.hypot(gx, gy) * 0.25 * sobelScale;
      const laplacian = Math.abs(4 * mc - tc - ml - mr - bc) * laplacianScale;
      const response = EDGE_SOBEL_WEIGHT * sobel + EDGE_LAPLACIAN_WEIGHT * laplacian;
      const index = y * width + x;
      result[index] = response;
      sum += response;
    }
  }

  const gain = 1 / Math.max(1e-6, (sum / Math.max(1, width * height)) * EDGE_LEVEL_RESPONSE_GAIN);
  for (let i = 0; i < result.length; i += 1) result[i] = clamp01(result[i] * gain);
  return result;
}

function blendEdgeResponses(
  fine: Float32Array,
  coarse: Float32Array,
  coarseWeight: number,
): Float32Array {
  const output = new Float32Array(fine.length);
  const clampedWeight = Math.max(0, coarseWeight);
  const norm = 1 / (1 + clampedWeight);
  for (let i = 0; i < fine.length; i += 1) {
    const fineValue = fine[i] ?? 0;
    const coarseValue = (coarse[i] ?? 0) * clampedWeight;
    output[i] = (fineValue + coarseValue) * norm;
  }
  return output;
}

function computeMultiScaleEdgeMapFromLuma(baseLuma: Float32Array, width: number, height: number): Float32Array {
  const levels: GrayFloatImage[] = [{ width, height, data: baseLuma }];
  while (true) {
    const current = levels[levels.length - 1];
    if (!current) break;
    if (current.width * current.height <= EDGE_PYRAMID_MIN_AREA) break;
    if (current.width <= 1 && current.height <= 1) break;
    const next = downsampleGrayFloatImage2x(current);
    if (next.width === current.width && next.height === current.height) break;
    levels.push(next);
  }

  const responses = levels.map((level, levelIndex) => ({
    width: level.width,
    height: level.height,
    data: computeMultiScaleEdgeLevel(level, levelIndex),
  }));
  let blended = responses[responses.length - 1];
  if (!blended) return new Float32Array(width * height);

  for (let levelIndex = responses.length - 2; levelIndex >= 0; levelIndex -= 1) {
    const fine = responses[levelIndex];
    const upsampledCoarse = resizeGrayFloatImageBilinear(blended, fine.width, fine.height);
    const relativeIndex = responses.length - 1 - levelIndex;
    const coarseWeight = Math.pow(EDGE_LEVEL_WEIGHT_DECAY, relativeIndex);
    blended = {
      width: fine.width,
      height: fine.height,
      data: blendEdgeResponses(fine.data, upsampledCoarse, coarseWeight),
    };
  }

  const output = blended.width === width && blended.height === height
    ? blended.data.slice()
    : resizeGrayFloatImageBilinear(blended, width, height);
  let maxValue = 0;
  for (let i = 0; i < output.length; i += 1) {
    if (output[i] > maxValue) maxValue = output[i];
  }
  const scale = maxValue > 1e-6 ? 1 / maxValue : 1;
  for (let i = 0; i < output.length; i += 1) output[i] = Math.pow(clamp01(output[i] * scale), EDGE_OUTPUT_GAMMA);
  return output;
}

function computeCannyEdgeMapFromLuma(baseLuma: Float32Array, width: number, height: number): Float32Array {
  const blurred = blurGrayFloatImageGaussian(baseLuma, width, height, EDGE_CANNY_GAUSSIAN_SIGMA);
  const magnitude = new Float32Array(width * height);
  const angle = new Float32Array(width * height);
  let maxMagnitude = 0;
  for (let y = 0; y < height; y += 1) {
    const y0 = Math.max(0, y - 1);
    const y1 = Math.min(height - 1, y + 1);
    for (let x = 0; x < width; x += 1) {
      const x0 = Math.max(0, Math.min(width - 1, x - 1));
      const x1 = Math.max(0, Math.min(width - 1, x + 1));
      const tl = blurred[y0 * width + x0] ?? 0;
      const tc = blurred[y0 * width + x] ?? 0;
      const tr = blurred[y0 * width + x1] ?? 0;
      const ml = blurred[y * width + x0] ?? 0;
      const mr = blurred[y * width + x1] ?? 0;
      const bl = blurred[y1 * width + x0] ?? 0;
      const bc = blurred[y1 * width + x] ?? 0;
      const br = blurred[y1 * width + x1] ?? 0;
      const gx = -tl - 2 * ml - bl + tr + 2 * mr + br;
      const gy = -tl - 2 * tc - tr + bl + 2 * bc + br;
      const index = y * width + x;
      const mag = Math.hypot(gx, gy);
      magnitude[index] = mag;
      angle[index] = Math.atan2(gy, gx);
      if (mag > maxMagnitude) maxMagnitude = mag;
    }
  }
  const normalize = maxMagnitude > 1e-9 ? 1 / maxMagnitude : 1;
  for (let i = 0; i < magnitude.length; i += 1) magnitude[i] *= normalize;

  const suppressed = new Float32Array(width * height);
  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const index = y * width + x;
      const mag = magnitude[index] ?? 0;
      const degrees = ((angle[index] ?? 0) * 180 / Math.PI + 180) % 180;
      let n1 = 0;
      let n2 = 0;
      if (degrees < 22.5 || degrees >= 157.5) {
        n1 = magnitude[index - 1] ?? 0;
        n2 = magnitude[index + 1] ?? 0;
      } else if (degrees < 67.5) {
        n1 = magnitude[(y - 1) * width + (x + 1)] ?? 0;
        n2 = magnitude[(y + 1) * width + (x - 1)] ?? 0;
      } else if (degrees < 112.5) {
        n1 = magnitude[(y - 1) * width + x] ?? 0;
        n2 = magnitude[(y + 1) * width + x] ?? 0;
      } else {
        n1 = magnitude[(y - 1) * width + (x - 1)] ?? 0;
        n2 = magnitude[(y + 1) * width + (x + 1)] ?? 0;
      }
      if (mag >= n1 && mag >= n2) suppressed[index] = mag;
    }
  }

  const high = Math.max(1e-4, computeFloatArrayPercentile(suppressed, EDGE_CANNY_HIGH_PERCENTILE));
  const low = high * EDGE_CANNY_LOW_THRESHOLD_RATIO;
  const result = new Float32Array(width * height);
  const visited = new Uint8Array(width * height);
  const stack = new Int32Array(width * height);
  let stackSize = 0;
  for (let i = 0; i < suppressed.length; i += 1) {
    if ((suppressed[i] ?? 0) >= high) {
      visited[i] = 1;
      stack[stackSize] = i;
      stackSize += 1;
    }
  }
  while (stackSize > 0) {
    stackSize -= 1;
    const index = stack[stackSize] ?? 0;
    const value = suppressed[index] ?? 0;
    result[index] = Math.max(result[index] ?? 0, value);
    const x = index % width;
    const y = Math.floor(index / width);
    for (let oy = -1; oy <= 1; oy += 1) {
      const ny = y + oy;
      if (ny < 0 || ny >= height) continue;
      for (let ox = -1; ox <= 1; ox += 1) {
        const nx = x + ox;
        if (nx < 0 || nx >= width) continue;
        const neighbor = ny * width + nx;
        if (visited[neighbor]) continue;
        if ((suppressed[neighbor] ?? 0) >= low) {
          visited[neighbor] = 1;
          stack[stackSize] = neighbor;
          stackSize += 1;
        }
      }
    }
  }
  for (let i = 0; i < result.length; i += 1) result[i] = Math.pow(clamp01(result[i]), EDGE_CANNY_OUTPUT_GAMMA);
  return result;
}

function computeXDoGEdgeMapFromLuma(baseLuma: Float32Array, width: number, height: number): Float32Array {
  const blur1 = blurGrayFloatImageGaussian(baseLuma, width, height, EDGE_XDOG_SIGMA);
  const blur2 = blurGrayFloatImageGaussian(baseLuma, width, height, EDGE_XDOG_SIGMA * EDGE_XDOG_SIGMA_RATIO);
  const output = new Float32Array(width * height);
  let maxValue = 0;
  for (let i = 0; i < output.length; i += 1) {
    const dog = (blur1[i] ?? 0) - EDGE_XDOG_TAU * (blur2[i] ?? 0);
    const whiteBg = dog >= EDGE_XDOG_EPSILON ? 1 : 1 + Math.tanh(EDGE_XDOG_PHI * (dog - EDGE_XDOG_EPSILON));
    const edge = clamp01(1 - whiteBg);
    output[i] = edge;
    if (edge > maxValue) maxValue = edge;
  }
  const scale = maxValue > 1e-6 ? 1 / maxValue : 1;
  for (let i = 0; i < output.length; i += 1) output[i] = Math.pow(clamp01(output[i] * scale), EDGE_XDOG_OUTPUT_GAMMA);
  return output;
}

function computeEdgeMapFromLuma(
  baseLuma: Float32Array,
  width: number,
  height: number,
  preset: ImageEdgePreset,
): Float32Array {
  switch (preset) {
    case "edge-canny":
      return computeCannyEdgeMapFromLuma(baseLuma, width, height);
    case "edge-xdog":
      return computeXDoGEdgeMapFromLuma(baseLuma, width, height);
    case "edge-multiscale":
    default:
      return computeMultiScaleEdgeMapFromLuma(baseLuma, width, height);
  }
}

function applyEdgeFilterToCanvasData(
  rgba8: Uint8ClampedArray,
  width: number,
  height: number,
  profile: ImageEditOutputColorProfile,
  preset: ImageEdgePreset,
): void {
  const luma = buildFilterLumaFromCanvasData(rgba8, width, height, profile);
  const edge = computeEdgeMapFromLuma(luma, width, height, preset);
  for (let pixel = 0; pixel < width * height; pixel += 1) {
    const gray = edge[pixel] ?? 0;
    const [er, eg, eb] = convertLinearProPhotoToOutputRgb(gray, gray, gray, profile);
    const index = pixel * 4;
    rgba8[index] = linearChannelToSrgb(er);
    rgba8[index + 1] = linearChannelToSrgb(eg);
    rgba8[index + 2] = linearChannelToSrgb(eb);
  }
}

function applyEdgeFilterToRgb16(data: Uint16Array, width: number, height: number, preset: ImageEdgePreset): void {
  const luma = buildFilterLumaFromRgb16(data, width, height);
  const edge = computeEdgeMapFromLuma(luma, width, height, preset);
  for (let pixel = 0; pixel < width * height; pixel += 1) {
    const gray = edge[pixel] ?? 0;
    const encoded = encodeStoredRgb16Channel(gray, "gamma20", 1);
    const index = pixel * 3;
    data[index] = encoded;
    data[index + 1] = encoded;
    data[index + 2] = encoded;
  }
}

function applyImageFilterToCanvas(
  canvas: HTMLCanvasElement | OffscreenCanvas,
  filter: ImageFilter | null | undefined,
  outputColorProfile: ImageEditOutputColorProfile = "srgb",
): void {
  if (!filter) return;
  const ctx = getCanvas2dContext(canvas, outputColorProfile, true);
  if (!ctx) return;
  const width = canvas.width;
  const height = canvas.height;
  if (width <= 0 || height <= 0) return;
  const imageData = getCanvasImageData(ctx, 0, 0, width, height, outputColorProfile);
  const rgba8 = imageData.data;

  if (filter.kind === "monochrome") {
    const weights = resolveMonochromeWeights(filter);
    if (!weights) return;
    const [wr, wg, wb] = weights;
    for (let i = 0; i < rgba8.length; i += 4) {
      const y = Math.max(
        0,
        Math.min(255, Math.round((rgba8[i] ?? 0) * wr + (rgba8[i + 1] ?? 0) * wg + (rgba8[i + 2] ?? 0) * wb)),
      );
      rgba8[i] = y;
      rgba8[i + 1] = y;
      rgba8[i + 2] = y;
    }
  } else {
    const profile: ImageEditOutputColorProfile = outputColorProfile === "display-p3" ? "display-p3" : "srgb";
    if (isChannelSwapPreset(filter.preset)) {
      applyChannelSwapFilterToCanvasData(rgba8, profile, filter.preset);
    } else if (isDichromePreset(filter.preset)) {
      applyDichromeFilterToCanvasData(rgba8, profile, filter.preset);
    } else if (isTrichromePreset(filter.preset)) {
      applyTrichromeFilterToCanvasData(rgba8, width, height, profile, filter.preset);
    } else if (isPartColorPreset(filter.preset)) {
      applyPartColorFilterToCanvasData(rgba8, profile, filter.preset);
    } else if (isDuotonePreset(filter.preset)) {
      applyDuotoneFilterToCanvasData(rgba8, profile, filter.preset);
    } else {
      switch (filter.preset) {
        case "sepia":
          applySepiaFilterToCanvasData(rgba8, width, height, profile);
          break;
        case "cross-process":
          applyCrossProcessFilterToCanvasData(rgba8, width, height, profile);
          break;
        case "bleach-bypass":
          applyBleachBypassFilterToCanvasData(rgba8, width, height, profile);
          break;
        case "cyanotype":
          applyCyanotypeFilterToCanvasData(rgba8, width, height, profile);
          break;
        case "negative":
          applyNegativeFilterToCanvasData(rgba8, profile);
          break;
        case "solarization":
          applySolarizationFilterToCanvasData(rgba8, profile);
          break;
        case "classic-chrome":
          applyClassicChromeFilterToCanvasData(rgba8, width, height, profile);
          break;
        case "velvia":
          applyVelviaFilterToCanvasData(rgba8, width, height, profile);
          break;
        case "edge-canny":
        case "edge-xdog":
        case "edge-multiscale":
          applyEdgeFilterToCanvasData(rgba8, width, height, profile, filter.preset);
          break;
      }
    }
  }

  ctx.putImageData(imageData, 0, 0);
}

function applyGammaSpaceInversion(channel: number): number {
  const gammaEncoded = Math.pow(clamp01(channel), 1 / 2.4);
  return Math.pow(1 - gammaEncoded, 2.4);
}

function applySolarizationTone(channel: number): number {
  const x = clamp01(channel);
  const base = 4 * x * (1 - x);
  const solarized = x > 0.5
    ? 1 - (1 - base) * 0.85
    : base;
  return clamp01(SOLARIZATION_PEAK * solarized);
}

function applyNegativeFilterToCanvasData(
  rgba8: Uint8ClampedArray,
  profile: ImageEditOutputColorProfile,
): void {
  for (let i = 0; i < rgba8.length; i += 4) {
    const [r, g, b] = encodedRgbToLinearProphoto(
      (rgba8[i] ?? 0) / 255,
      (rgba8[i + 1] ?? 0) / 255,
      (rgba8[i + 2] ?? 0) / 255,
      profile,
    );
    const [er, eg, eb] = convertLinearProPhotoToOutputRgb(
      applyGammaSpaceInversion(r),
      applyGammaSpaceInversion(g),
      applyGammaSpaceInversion(b),
      profile,
    );
    rgba8[i] = linearChannelToSrgb(er);
    rgba8[i + 1] = linearChannelToSrgb(eg);
    rgba8[i + 2] = linearChannelToSrgb(eb);
  }
}

function applyNegativeFilterToRgb16(data: Uint16Array, width: number, height: number): void {
  const pixelCount = width * height;
  for (let pixel = 0; pixel < pixelCount; pixel += 1) {
    const index = pixel * 3;
    const r = decodeStoredRgb16Channel(data[index] ?? 0, "gamma20", 1);
    const g = decodeStoredRgb16Channel(data[index + 1] ?? 0, "gamma20", 1);
    const b = decodeStoredRgb16Channel(data[index + 2] ?? 0, "gamma20", 1);
    data[index] = encodeStoredRgb16Channel(applyGammaSpaceInversion(r), "gamma20", 1);
    data[index + 1] = encodeStoredRgb16Channel(applyGammaSpaceInversion(g), "gamma20", 1);
    data[index + 2] = encodeStoredRgb16Channel(applyGammaSpaceInversion(b), "gamma20", 1);
  }
}

function applySolarizationLinearRgb(r: number, g: number, b: number): [number, number, number] {
  return [
    applySolarizationTone(r),
    applySolarizationTone(g),
    applySolarizationTone(b),
  ];
}

function applySolarizationFilterToCanvasData(
  rgba8: Uint8ClampedArray,
  profile: ImageEditOutputColorProfile,
): void {
  const beforeHistogram = new Uint32Array(FILTER_LOG_HISTOGRAM_BINS);
  const filteredHistogram = new Uint32Array(FILTER_LOG_HISTOGRAM_BINS);

  for (let i = 0; i < rgba8.length; i += 4) {
    const [r, g, b] = encodedRgbToLinearProphoto(
      (rgba8[i] ?? 0) / 255,
      (rgba8[i + 1] ?? 0) / 255,
      (rgba8[i + 2] ?? 0) / 255,
      profile,
    );
    const [fr, fg, fb] = applySolarizationLinearRgb(r, g, b);
    accumulateLogLumaHistogram(beforeHistogram, prophotoLumaForFilter(r, g, b));
    accumulateLogLumaHistogram(filteredHistogram, prophotoLumaForFilter(fr, fg, fb));
  }

  const beforeP50Ev = estimateLogPercentileFromHistogram(beforeHistogram, SOLARIZATION_TARGET_PERCENTILE);
  const filteredP50Ev = estimateLogPercentileFromHistogram(filteredHistogram, SOLARIZATION_TARGET_PERCENTILE);
  const beforeP50Luma = Math.pow(2, beforeP50Ev);
  const filteredP50Luma = Math.pow(2, filteredP50Ev);
  const recoveryScaledLog = solveFilterScaledLogForTargetLuma(filteredP50Luma, beforeP50Luma);

  for (let i = 0; i < rgba8.length; i += 4) {
    const [r, g, b] = encodedRgbToLinearProphoto(
      (rgba8[i] ?? 0) / 255,
      (rgba8[i + 1] ?? 0) / 255,
      (rgba8[i + 2] ?? 0) / 255,
      profile,
    );
    const [fr, fg, fb] = applySolarizationLinearRgb(r, g, b);
    const [recoveredR, recoveredG, recoveredB] = applyFilterScaledLogToLinearRgb(
      fr,
      fg,
      fb,
      recoveryScaledLog,
    );
    const [er, eg, eb] = convertLinearProPhotoToOutputRgb(recoveredR, recoveredG, recoveredB, profile);
    rgba8[i] = linearChannelToSrgb(er);
    rgba8[i + 1] = linearChannelToSrgb(eg);
    rgba8[i + 2] = linearChannelToSrgb(eb);
  }
}

function applySolarizationFilterToRgb16(data: Uint16Array, width: number, height: number): void {
  const beforeHistogram = new Uint32Array(FILTER_LOG_HISTOGRAM_BINS);
  const filteredHistogram = new Uint32Array(FILTER_LOG_HISTOGRAM_BINS);
  const pixelCount = width * height;

  for (let pixel = 0; pixel < pixelCount; pixel += 1) {
    const index = pixel * 3;
    const r = decodeStoredRgb16Channel(data[index] ?? 0, "gamma20", 1);
    const g = decodeStoredRgb16Channel(data[index + 1] ?? 0, "gamma20", 1);
    const b = decodeStoredRgb16Channel(data[index + 2] ?? 0, "gamma20", 1);
    const [fr, fg, fb] = applySolarizationLinearRgb(r, g, b);
    accumulateLogLumaHistogram(beforeHistogram, prophotoLumaForFilter(r, g, b));
    accumulateLogLumaHistogram(filteredHistogram, prophotoLumaForFilter(fr, fg, fb));
  }

  const beforeP50Ev = estimateLogPercentileFromHistogram(beforeHistogram, SOLARIZATION_TARGET_PERCENTILE);
  const filteredP50Ev = estimateLogPercentileFromHistogram(filteredHistogram, SOLARIZATION_TARGET_PERCENTILE);
  const beforeP50Luma = Math.pow(2, beforeP50Ev);
  const filteredP50Luma = Math.pow(2, filteredP50Ev);
  const recoveryScaledLog = solveFilterScaledLogForTargetLuma(filteredP50Luma, beforeP50Luma);

  for (let pixel = 0; pixel < pixelCount; pixel += 1) {
    const index = pixel * 3;
    const r = decodeStoredRgb16Channel(data[index] ?? 0, "gamma20", 1);
    const g = decodeStoredRgb16Channel(data[index + 1] ?? 0, "gamma20", 1);
    const b = decodeStoredRgb16Channel(data[index + 2] ?? 0, "gamma20", 1);
    const [fr, fg, fb] = applySolarizationLinearRgb(r, g, b);
    const [recoveredR, recoveredG, recoveredB] = applyFilterScaledLogToLinearRgb(
      fr,
      fg,
      fb,
      recoveryScaledLog,
    );
    data[index] = encodeStoredRgb16Channel(recoveredR, "gamma20", 1);
    data[index + 1] = encodeStoredRgb16Channel(recoveredG, "gamma20", 1);
    data[index + 2] = encodeStoredRgb16Channel(recoveredB, "gamma20", 1);
  }
}

function applyChannelSwapLinearRgb(
  r: number,
  g: number,
  b: number,
  preset: ImageChannelSwapPreset,
): [number, number, number] {
  switch (preset) {
    case "swap-rgb-rbg":
      return [r, b, g];
    case "swap-rgb-grb":
      return [g, r, b];
    case "swap-rgb-gbr":
      return [g, b, r];
    case "swap-rgb-brg":
      return [b, r, g];
    case "swap-rgb-bgr":
      return [b, g, r];
  }
}

function applyChannelSwapFilterToCanvasData(
  rgba8: Uint8ClampedArray,
  profile: ImageEditOutputColorProfile,
  preset: ImageChannelSwapPreset,
): void {
  for (let i = 0; i < rgba8.length; i += 4) {
    const [r, g, b] = encodedRgbToLinearProphoto(
      (rgba8[i] ?? 0) / 255,
      (rgba8[i + 1] ?? 0) / 255,
      (rgba8[i + 2] ?? 0) / 255,
      profile,
    );
    const [sr, sg, sb] = applyChannelSwapLinearRgb(r, g, b, preset);
    const [er, eg, eb] = convertLinearProPhotoToOutputRgb(sr, sg, sb, profile);
    rgba8[i] = linearChannelToSrgb(er);
    rgba8[i + 1] = linearChannelToSrgb(eg);
    rgba8[i + 2] = linearChannelToSrgb(eb);
  }
}

function applyChannelSwapFilterToRgb16(
  data: Uint16Array,
  width: number,
  height: number,
  preset: ImageChannelSwapPreset,
): void {
  const pixelCount = width * height;
  for (let pixel = 0; pixel < pixelCount; pixel += 1) {
    const index = pixel * 3;
    const r = decodeStoredRgb16Channel(data[index] ?? 0, "gamma20", 1);
    const g = decodeStoredRgb16Channel(data[index + 1] ?? 0, "gamma20", 1);
    const b = decodeStoredRgb16Channel(data[index + 2] ?? 0, "gamma20", 1);
    const [sr, sg, sb] = applyChannelSwapLinearRgb(r, g, b, preset);
    data[index] = encodeStoredRgb16Channel(sr, "gamma20", 1);
    data[index + 1] = encodeStoredRgb16Channel(sg, "gamma20", 1);
    data[index + 2] = encodeStoredRgb16Channel(sb, "gamma20", 1);
  }
}

function applySepiaFilterToRgb16(data: Uint16Array, width: number, height: number): void {
  const beforeHistogram = new Uint32Array(FILTER_LOG_HISTOGRAM_BINS);
  const exposureHistogram = new Uint32Array(FILTER_LOG_HISTOGRAM_BINS);
  const pixelCount = width * height;
  for (let pixel = 0; pixel < pixelCount; pixel += 1) {
    const index = pixel * 3;
    const r = decodeStoredRgb16Channel(data[index] ?? 0, "gamma20", 1);
    const g = decodeStoredRgb16Channel(data[index + 1] ?? 0, "gamma20", 1);
    const b = decodeStoredRgb16Channel(data[index + 2] ?? 0, "gamma20", 1);
    accumulateLogLumaHistogram(beforeHistogram, prophotoLumaForFilter(r, g, b));
    accumulateLogLumaHistogram(exposureHistogram, computeSepiaExposure(r, g, b));
  }

  const beforeP50Ev = estimateLogPercentileFromHistogram(beforeHistogram, PHOTOCHEMICAL_TARGET_PERCENTILE);
  const exposureP50Ev = estimateLogPercentileFromHistogram(exposureHistogram, PHOTOCHEMICAL_TARGET_PERCENTILE);
  const beforeP50Luma = Math.pow(2, beforeP50Ev);
  const exposureP50 = Math.pow(2, exposureP50Ev);
  const exposureScaledLog = solvePhotochemicalExposureScaledLog(
    exposureP50,
    beforeP50Luma,
    SEPIA_MATERIAL_R,
    SEPIA_MATERIAL_G,
    SEPIA_MATERIAL_B,
  );

  for (let pixel = 0; pixel < pixelCount; pixel += 1) {
    const index = pixel * 3;
    const px = pixel % width;
    const py = Math.floor(pixel / width);
    const x = px + 0.5;
    const yPos = py + 0.5;
    const r = decodeStoredRgb16Channel(data[index] ?? 0, "gamma20", 1);
    const g = decodeStoredRgb16Channel(data[index + 1] ?? 0, "gamma20", 1);
    const b = decodeStoredRgb16Channel(data[index + 2] ?? 0, "gamma20", 1);
    const [fr, fg, fb] = applySepiaLinearRgb(r, g, b, x, yPos, width, height, exposureScaledLog);
    data[index] = encodeStoredRgb16Channel(fr, "gamma20", 1);
    data[index + 1] = encodeStoredRgb16Channel(fg, "gamma20", 1);
    data[index + 2] = encodeStoredRgb16Channel(fb, "gamma20", 1);
  }
}

function applyCrossProcessFilterToRgb16(data: Uint16Array, width: number, height: number): void {
  const beforeHistogram = new Uint32Array(FILTER_LOG_HISTOGRAM_BINS);
  const filteredHistogram = new Uint32Array(FILTER_LOG_HISTOGRAM_BINS);
  const pixelCount = width * height;
  for (let pixel = 0; pixel < pixelCount; pixel += 1) {
    const index = pixel * 3;
    const r = decodeStoredRgb16Channel(data[index] ?? 0, "gamma20", 1);
    const g = decodeStoredRgb16Channel(data[index + 1] ?? 0, "gamma20", 1);
    const b = decodeStoredRgb16Channel(data[index + 2] ?? 0, "gamma20", 1);
    const [fr, fg, fb] = applyChemicalCrossProcessLinearRgb(r, g, b);
    accumulateLogLumaHistogram(beforeHistogram, prophotoLumaForFilter(r, g, b));
    accumulateLogLumaHistogram(filteredHistogram, prophotoLumaForFilter(fr, fg, fb));
    data[index] = encodeStoredRgb16Channel(fr, "gamma20", 1);
    data[index + 1] = encodeStoredRgb16Channel(fg, "gamma20", 1);
    data[index + 2] = encodeStoredRgb16Channel(fb, "gamma20", 1);
  }

  const toneRecovery = computeCrossProcessToneRecovery(beforeHistogram, filteredHistogram);
  for (let pixel = 0; pixel < pixelCount; pixel += 1) {
    const index = pixel * 3;
    const r = decodeStoredRgb16Channel(data[index] ?? 0, "gamma20", 1);
    const g = decodeStoredRgb16Channel(data[index + 1] ?? 0, "gamma20", 1);
    const b = decodeStoredRgb16Channel(data[index + 2] ?? 0, "gamma20", 1);
    const [recoveredR, recoveredG, recoveredB] = applyCrossProcessToneRecoveryLinearRgb(
      r,
      g,
      b,
      toneRecovery,
    );
    data[index] = encodeStoredRgb16Channel(recoveredR, "gamma20", 1);
    data[index + 1] = encodeStoredRgb16Channel(recoveredG, "gamma20", 1);
    data[index + 2] = encodeStoredRgb16Channel(recoveredB, "gamma20", 1);
  }
}

function applyCyanotypeFilterToRgb16(data: Uint16Array, width: number, height: number): void {
  const beforeHistogram = new Uint32Array(FILTER_LOG_HISTOGRAM_BINS);
  const exposureHistogram = new Uint32Array(FILTER_LOG_HISTOGRAM_BINS);
  const pixelCount = width * height;
  for (let pixel = 0; pixel < pixelCount; pixel += 1) {
    const index = pixel * 3;
    const r = decodeStoredRgb16Channel(data[index] ?? 0, "gamma20", 1);
    const g = decodeStoredRgb16Channel(data[index + 1] ?? 0, "gamma20", 1);
    const b = decodeStoredRgb16Channel(data[index + 2] ?? 0, "gamma20", 1);
    accumulateLogLumaHistogram(beforeHistogram, prophotoLumaForFilter(r, g, b));
    accumulateLogLumaHistogram(exposureHistogram, computeCyanotypeExposure(r, g, b));
  }

  const beforeP50Ev = estimateLogPercentileFromHistogram(beforeHistogram, PHOTOCHEMICAL_TARGET_PERCENTILE);
  const exposureP50Ev = estimateLogPercentileFromHistogram(exposureHistogram, PHOTOCHEMICAL_TARGET_PERCENTILE);
  const beforeP50Luma = Math.pow(2, beforeP50Ev);
  const exposureP50 = Math.pow(2, exposureP50Ev);
  const exposureScaledLog = solvePhotochemicalExposureScaledLog(
    exposureP50,
    beforeP50Luma,
    CYANOTYPE_MATERIAL_R,
    CYANOTYPE_MATERIAL_G,
    CYANOTYPE_MATERIAL_B,
  );

  for (let pixel = 0; pixel < pixelCount; pixel += 1) {
    const index = pixel * 3;
    const px = pixel % width;
    const py = Math.floor(pixel / width);
    const x = px + 0.5;
    const yPos = py + 0.5;
    const r = decodeStoredRgb16Channel(data[index] ?? 0, "gamma20", 1);
    const g = decodeStoredRgb16Channel(data[index + 1] ?? 0, "gamma20", 1);
    const b = decodeStoredRgb16Channel(data[index + 2] ?? 0, "gamma20", 1);
    const [fr, fg, fb] = applyCyanotypeLinearRgb(r, g, b, x, yPos, width, height, exposureScaledLog);
    data[index] = encodeStoredRgb16Channel(fr, "gamma20", 1);
    data[index + 1] = encodeStoredRgb16Channel(fg, "gamma20", 1);
    data[index + 2] = encodeStoredRgb16Channel(fb, "gamma20", 1);
  }
}

function applyClassicChromeFilterToRgb16(data: Uint16Array, width: number, height: number): void {
  const beforeHistogram = new Uint32Array(FILTER_LOG_HISTOGRAM_BINS);
  const filteredHistogram = new Uint32Array(FILTER_LOG_HISTOGRAM_BINS);
  const pixelCount = width * height;

  for (let pixel = 0; pixel < pixelCount; pixel += 1) {
    const index = pixel * 3;
    const r = decodeStoredRgb16Channel(data[index] ?? 0, "gamma20", 1);
    const g = decodeStoredRgb16Channel(data[index + 1] ?? 0, "gamma20", 1);
    const b = decodeStoredRgb16Channel(data[index + 2] ?? 0, "gamma20", 1);
    const [fr, fg, fb] = applyClassicChromeLinearRgb(r, g, b);
    accumulateLogLumaHistogram(beforeHistogram, prophotoLumaForFilter(r, g, b));
    accumulateLogLumaHistogram(filteredHistogram, prophotoLumaForFilter(fr, fg, fb));
    data[index] = encodeStoredRgb16Channel(fr, "gamma20", 1);
    data[index + 1] = encodeStoredRgb16Channel(fg, "gamma20", 1);
    data[index + 2] = encodeStoredRgb16Channel(fb, "gamma20", 1);
  }

  const toneRecovery = computeClassicChromeToneRecovery(beforeHistogram, filteredHistogram);
  for (let pixel = 0; pixel < pixelCount; pixel += 1) {
    const index = pixel * 3;
    const r = decodeStoredRgb16Channel(data[index] ?? 0, "gamma20", 1);
    const g = decodeStoredRgb16Channel(data[index + 1] ?? 0, "gamma20", 1);
    const b = decodeStoredRgb16Channel(data[index + 2] ?? 0, "gamma20", 1);
    const [recoveredR, recoveredG, recoveredB] = applyClassicChromeToneRecoveryLinearRgb(
      r,
      g,
      b,
      toneRecovery,
    );
    const [limitedR, limitedG, limitedB] = limitFilterLinearRgbToUnitMax(
      recoveredR,
      recoveredG,
      recoveredB,
    );
    data[index] = encodeStoredRgb16Channel(limitedR, "gamma20", 1);
    data[index + 1] = encodeStoredRgb16Channel(limitedG, "gamma20", 1);
    data[index + 2] = encodeStoredRgb16Channel(limitedB, "gamma20", 1);
  }
}

function applyVelviaFilterToRgb16(data: Uint16Array, width: number, height: number): void {
  const beforeHistogram = new Uint32Array(FILTER_LOG_HISTOGRAM_BINS);
  const filteredHistogram = new Uint32Array(FILTER_LOG_HISTOGRAM_BINS);
  const pixelCount = width * height;

  for (let pixel = 0; pixel < pixelCount; pixel += 1) {
    const index = pixel * 3;
    const r = decodeStoredRgb16Channel(data[index] ?? 0, "gamma20", 1);
    const g = decodeStoredRgb16Channel(data[index + 1] ?? 0, "gamma20", 1);
    const b = decodeStoredRgb16Channel(data[index + 2] ?? 0, "gamma20", 1);
    const [fr, fg, fb] = applyVelviaLinearRgb(r, g, b);
    accumulateLogLumaHistogram(beforeHistogram, prophotoLumaForFilter(r, g, b));
    accumulateLogLumaHistogram(filteredHistogram, prophotoLumaForFilter(fr, fg, fb));
    data[index] = encodeStoredRgb16Channel(fr, "gamma20", 1);
    data[index + 1] = encodeStoredRgb16Channel(fg, "gamma20", 1);
    data[index + 2] = encodeStoredRgb16Channel(fb, "gamma20", 1);
  }

  const toneRecovery = computeVelviaToneRecovery(beforeHistogram, filteredHistogram);
  for (let pixel = 0; pixel < pixelCount; pixel += 1) {
    const index = pixel * 3;
    const r = decodeStoredRgb16Channel(data[index] ?? 0, "gamma20", 1);
    const g = decodeStoredRgb16Channel(data[index + 1] ?? 0, "gamma20", 1);
    const b = decodeStoredRgb16Channel(data[index + 2] ?? 0, "gamma20", 1);
    const [recoveredR, recoveredG, recoveredB] = applyVelviaToneRecoveryLinearRgb(
      r,
      g,
      b,
      toneRecovery,
    );
    const [limitedR, limitedG, limitedB] = limitFilterLinearRgbToUnitMax(
      recoveredR,
      recoveredG,
      recoveredB,
    );
    data[index] = encodeStoredRgb16Channel(limitedR, "gamma20", 1);
    data[index + 1] = encodeStoredRgb16Channel(limitedG, "gamma20", 1);
    data[index + 2] = encodeStoredRgb16Channel(limitedB, "gamma20", 1);
  }
}

function applyBleachBypassFilterToRgb16(data: Uint16Array, width: number, height: number): void {
  const beforeHistogram = new Uint32Array(FILTER_LOG_HISTOGRAM_BINS);
  const filteredHistogram = new Uint32Array(FILTER_LOG_HISTOGRAM_BINS);
  const pixelCount = width * height;

  for (let pixel = 0; pixel < pixelCount; pixel += 1) {
    const index = pixel * 3;
    const r = decodeStoredRgb16Channel(data[index] ?? 0, "gamma20", 1);
    const g = decodeStoredRgb16Channel(data[index + 1] ?? 0, "gamma20", 1);
    const b = decodeStoredRgb16Channel(data[index + 2] ?? 0, "gamma20", 1);
    const [fr, fg, fb] = applyBleachBypassLinearRgb(r, g, b);
    accumulateLogLumaHistogram(beforeHistogram, prophotoLumaForFilter(r, g, b));
    accumulateLogLumaHistogram(filteredHistogram, prophotoLumaForFilter(fr, fg, fb));
    data[index] = encodeStoredRgb16Channel(fr, "gamma20", 1);
    data[index + 1] = encodeStoredRgb16Channel(fg, "gamma20", 1);
    data[index + 2] = encodeStoredRgb16Channel(fb, "gamma20", 1);
  }

  const beforeP50Ev = estimateLogPercentileFromHistogram(beforeHistogram, BLEACH_BYPASS_TARGET_PERCENTILE);
  const filteredP50Ev = estimateLogPercentileFromHistogram(filteredHistogram, BLEACH_BYPASS_TARGET_PERCENTILE);
  const beforeP50Luma = Math.pow(2, beforeP50Ev);
  const filteredP50Luma = Math.pow(2, filteredP50Ev);
  const recoveryScaledLog = solveFilterScaledLogForTargetLuma(filteredP50Luma, beforeP50Luma);
  applyFilterScaledLogToRgb16(data, width, height, recoveryScaledLog);
}

function applyImageFilterToRgb16(
  data: Uint16Array,
  width: number,
  height: number,
  filter: ImageFilter | null | undefined,
): void {
  if (!filter || width <= 0 || height <= 0) return;

  if (filter.kind === "monochrome") {
    const weights = resolveMonochromeWeights(filter);
    if (!weights) return;
    const [wr, wg, wb] = weights;
    const maxValue = 65535;
    const pixelCount = width * height;
    for (let pixel = 0; pixel < pixelCount; pixel += 1) {
      const index = pixel * 3;
      const y = Math.max(
        0,
        Math.min(
          maxValue,
          Math.round((data[index] ?? 0) * wr + (data[index + 1] ?? 0) * wg + (data[index + 2] ?? 0) * wb),
        ),
      );
      data[index] = y;
      data[index + 1] = y;
      data[index + 2] = y;
    }
    return;
  }

  if (isChannelSwapPreset(filter.preset)) {
    applyChannelSwapFilterToRgb16(data, width, height, filter.preset);
    return;
  }
  if (isDichromePreset(filter.preset)) {
    applyDichromeFilterToRgb16(data, width, height, filter.preset);
    return;
  }
  if (isTrichromePreset(filter.preset)) {
    applyTrichromeFilterToRgb16(data, width, height, filter.preset);
    return;
  }
  if (isPartColorPreset(filter.preset)) {
    applyPartColorFilterToRgb16(data, width, height, filter.preset);
    return;
  }
  if (isDuotonePreset(filter.preset)) {
    applyDuotoneFilterToRgb16(data, width, height, filter.preset);
    return;
  }

  switch (filter.preset) {
    case "sepia":
      applySepiaFilterToRgb16(data, width, height);
      return;
    case "cross-process":
      applyCrossProcessFilterToRgb16(data, width, height);
      return;
    case "bleach-bypass":
      applyBleachBypassFilterToRgb16(data, width, height);
      return;
    case "cyanotype":
      applyCyanotypeFilterToRgb16(data, width, height);
      return;
    case "negative":
      applyNegativeFilterToRgb16(data, width, height);
      return;
    case "solarization":
      applySolarizationFilterToRgb16(data, width, height);
      return;
    case "classic-chrome":
      applyClassicChromeFilterToRgb16(data, width, height);
      return;
    case "velvia":
      applyVelviaFilterToRgb16(data, width, height);
      return;
    case "edge-canny":
    case "edge-xdog":
    case "edge-multiscale":
      applyEdgeFilterToRgb16(data, width, height, filter.preset);
      return;
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
function hexColorWithAlpha(color: string, alpha: number): string {
  const match = /^#([0-9a-f]{6})$/i.exec(color);
  if (!match) return color;
  const value = Number.parseInt(match[1], 16);
  const r = (value >> 16) & 0xff;
  const g = (value >> 8) & 0xff;
  const b = value & 0xff;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
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

function sourceNormalizedPointToRenderedPoint(
  x: number,
  y: number,
  sourceW: number,
  sourceH: number,
  cropX: number,
  cropY: number,
  cropW: number,
  cropH: number,
  outputW: number,
  outputH: number,
  rotationDegrees: number,
): EditPoint {
  const rotated = rotatePoint(
    x * sourceW,
    y * sourceH,
    sourceW / 2,
    sourceH / 2,
    rotationDegrees,
  );
  return {
    x: (rotated.x - cropX) * outputW / Math.max(1e-9, cropW),
    y: (rotated.y - cropY) * outputH / Math.max(1e-9, cropH),
  };
}

function drawOverlaysToContext(
  ctx: RotationCanvasContext,
  overlays: ImageDrawOverlay[],
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
  const resizeScaleX = outputW / cropW;
  const resizeScaleY = outputH / cropH;
  ctx.save();
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  for (const overlay of overlays) {
    const p1 = sourceNormalizedPointToRenderedPoint(
      overlay.x1, overlay.y1, sourceW, sourceH, cropX, cropY, cropW, cropH, outputW, outputH, rotationDegrees,
    );
    const p2 = sourceNormalizedPointToRenderedPoint(
      overlay.x2, overlay.y2, sourceW, sourceH, cropX, cropY, cropW, cropH, outputW, outputH, rotationDegrees,
    );
    const x1 = p1.x;
    const y1 = p1.y;
    const x2 = p2.x;
    const y2 = p2.y;
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
    if (overlay.type !== "line" && overlay.fillColorIndex != null) {
      ctx.fillStyle = TEXT_OVERLAY_COLORS[normalizeTextColorIndex(overlay.fillColorIndex)];
      ctx.fill();
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
  cropX: number,
  cropY: number,
  cropW: number,
  cropH: number,
  outputW: number,
  outputH: number,
  rotationDegrees: number,
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
    // Overlay coordinates are fixed to the original, unprocessed image. Geometry
    // changes only how that source position is projected into the rendered frame.
    const anchor = sourceNormalizedPointToRenderedPoint(
      overlay.left, overlay.top, sourceW, sourceH, cropX, cropY, cropW, cropH, outputW, outputH, rotationDegrees,
    );
    const x = anchor.x + renderOffset.x;
    const y = anchor.y + renderOffset.y;
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

type RawMatchedTonePlanningResult = {
  plan: RawMatchedTonePlan;
  luminance: RawDevelopmentLuminanceSettings;
};

type RawMatchedColorPlanningResult = {
  settings: RawDevelopmentSaturationSettings;
  pass: RawColorPassPlan | null;
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
  const linear: [number, number, number] = [0, 0, 0];
  for (let i = 0; i < count; i++) {
    const si = i * 4;
    const di = (destinationPixelOffset + i) * 3;
    encodedRgbToLinearProphotoInto(
      (rgba8[si] ?? 0) / 255,
      (rgba8[si + 1] ?? 0) / 255,
      (rgba8[si + 2] ?? 0) / 255,
      profile,
      linear,
    );
    rgb16[di] = encodeStoredRgb16Channel(linear[0], "gamma20", 1);
    rgb16[di + 1] = encodeStoredRgb16Channel(linear[1], "gamma20", 1);
    rgb16[di + 2] = encodeStoredRgb16Channel(linear[2], "gamma20", 1);
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
  const gamma = SIGMOID_WORKING_GAMMA;
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

const RAW_THUMBNAIL_MATCH_EXPOSURE_PERCENTILE_MAX = 98;
const RAW_THUMBNAIL_MATCH_EXPOSURE_PERCENTILE_MIN = 90;
const RAW_THUMBNAIL_MATCH_EXPOSURE_SATURATION_LIMIT = 0.97;

function selectRawThumbnailMatchExposurePercentile(
  thumbnailPercentiles: DebugPercentileValues,
  rawPercentiles: DebugPercentileValues,
): { percentile: number; targetValue: number; rawValue: number } | null {
  for (
    let percentile = RAW_THUMBNAIL_MATCH_EXPOSURE_PERCENTILE_MAX;
    percentile >= RAW_THUMBNAIL_MATCH_EXPOSURE_PERCENTILE_MIN;
    percentile -= 1
  ) {
    const index = DEBUG_PERCENTILES.indexOf(percentile as (typeof DEBUG_PERCENTILES)[number]);
    if (index < 0) continue;
    const targetValue = thumbnailPercentiles[index];
    const rawValue = rawPercentiles[index];
    if (
      !Number.isFinite(targetValue)
      || !Number.isFinite(rawValue)
      || !(targetValue > 1e-6)
      || !(rawValue > 1e-6)
    ) {
      continue;
    }
    if (
      targetValue <= RAW_THUMBNAIL_MATCH_EXPOSURE_SATURATION_LIMIT
      && rawValue <= RAW_THUMBNAIL_MATCH_EXPOSURE_SATURATION_LIMIT
    ) {
      return { percentile, targetValue, rawValue };
    }
  }
  const fallbackIndex = DEBUG_PERCENTILES.indexOf(RAW_THUMBNAIL_MATCH_EXPOSURE_PERCENTILE_MIN as (typeof DEBUG_PERCENTILES)[number]);
  if (fallbackIndex < 0) return null;
  const targetValue = thumbnailPercentiles[fallbackIndex];
  const rawValue = rawPercentiles[fallbackIndex];
  if (
    !Number.isFinite(targetValue)
    || !Number.isFinite(rawValue)
    || !(targetValue > 1e-6)
    || !(rawValue > 1e-6)
  ) {
    return null;
  }
  return {
    percentile: RAW_THUMBNAIL_MATCH_EXPOSURE_PERCENTILE_MIN,
    targetValue,
    rawValue,
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
  const gamma = SIGMOID_WORKING_GAMMA;
  return Math.pow(clamp01(p75), 1 / gamma) - Math.pow(clamp01(p25), 1 / gamma);
}

function solveRawThumbnailMatchSigmoid(
  rawP25: number,
  rawP75: number,
  gain: number,
  scaledLog: number,
  targetContrast: number,
): number {
  const gamma = SIGMOID_WORKING_GAMMA;
  const encodedP25 = Math.pow(
    clamp01(applyRawBaselineScaledLogLinear(rawP25 * gain, scaledLog)),
    1 / gamma,
  );
  const encodedP75 = Math.pow(
    clamp01(applyRawBaselineScaledLogLinear(rawP75 * gain, scaledLog)),
    1 / gamma,
  );

  const encodedSigmoidValue = (encoded: number, sigmoid: number): number => {
    if (sigmoid > 1e-8) {
      const minVal = naiveSigmoid(0, sigmoid, 0.5);
      const maxVal = naiveSigmoid(1, sigmoid, 0.5);
      return clamp01((naiveSigmoid(encoded, sigmoid, 0.5) - minVal) / (maxVal - minVal));
    }
    if (sigmoid < -1e-8) {
      const magnitude = -sigmoid;
      const minVal = naiveInverseSigmoid(0, magnitude, 0.5);
      const maxVal = naiveInverseSigmoid(1, magnitude, 0.5);
      return clamp01(
        (naiveInverseSigmoid(encoded, magnitude, 0.5) - minVal) / (maxVal - minVal),
      );
    }
    return clamp01(encoded);
  };

  let bestSigmoid = 0;
  let bestError = Number.POSITIVE_INFINITY;
  // Sigmoid is exposed at 0.1 precision, so scan the complete -10..10 grid
  // at that precision. Keep the global search because P25-P75 contrast is not
  // guaranteed to be monotonic in sigmoid strength.
  for (
    let sigmoid = RAW_THUMBNAIL_MATCH_SIGMOID_MIN;
    sigmoid <= RAW_THUMBNAIL_MATCH_SIGMOID_MAX + RAW_THUMBNAIL_MATCH_SIGMOID_STEP / 2;
    sigmoid += RAW_THUMBNAIL_MATCH_SIGMOID_STEP
  ) {
    const p25 = encodedSigmoidValue(encodedP25, sigmoid);
    const p75 = encodedSigmoidValue(encodedP75, sigmoid);
    const error = Math.abs((p75 - p25) - targetContrast);
    if (
      error < bestError - 1e-12
      || (Math.abs(error - bestError) <= 1e-12 && Math.abs(sigmoid) < Math.abs(bestSigmoid))
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

function planRawThumbnailMatchedBaseline(
  decoded: DecodedRgbImage16,
  thumbnailPercentiles: DebugPercentileValues,
): RawMatchedTonePlanningResult | null {
  const p25Index = DEBUG_PERCENTILES.indexOf(25);
  const p50Index = DEBUG_PERCENTILES.indexOf(50);
  const p75Index = DEBUG_PERCENTILES.indexOf(75);
  const targetP25 = thumbnailPercentiles[p25Index];
  const targetP50 = thumbnailPercentiles[p50Index];
  const targetP75 = thumbnailPercentiles[p75Index];
  if (
    !Number.isFinite(targetP25) ||
    !Number.isFinite(targetP50) ||
    !Number.isFinite(targetP75)
  ) {
    return null;
  }

  const sample = sampleRawThumbnailMatchLinearRgbFromRgb16(decoded);
  if (!sample.length) return null;
  // Tone matching uses luminance only. Chroma denoise is intentionally kept in
  // color planning, where it prevents high-ISO color noise from inflating the
  // measured saturation, but it is unnecessary here.
  const rawPercentiles = debugPercentilesFromLinearRgbSample(sample, "prophoto");
  const rawP25 = rawPercentiles[p25Index];
  const rawP50 = rawPercentiles[p50Index];
  const rawP75 = rawPercentiles[p75Index];
  if (
    !(rawP25 >= 0) ||
    !(rawP50 >= 0) ||
    !(rawP75 >= rawP25)
  ) {
    return null;
  }

  const exposureMatch = selectRawThumbnailMatchExposurePercentile(
    thumbnailPercentiles,
    rawPercentiles,
  );
  if (!exposureMatch) return null;
  const targetExposureValue = exposureMatch.targetValue;
  const rawExposureValue = exposureMatch.rawValue;

  const targetContrast = rawThumbnailContrast(targetP25, targetP75);
  let gain = 1;
  let scaledLog = 0;
  let sigmoid = 0;
  for (let i = 0; i < RAW_THUMBNAIL_MATCH_ITERATIONS; i++) {
    const progress = i / Math.max(1, RAW_THUMBNAIL_MATCH_ITERATIONS - 1);
    const relaxationScale = Math.pow(RAW_THUMBNAIL_MATCH_RELAXATION_FINAL_SCALE, progress);

    const targetGain = solveRawThumbnailMatchGain(rawExposureValue, scaledLog, sigmoid, targetExposureValue);
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

  const toneSlopeAtWhite = rawBaselineToneSlopeAtWhite(scaledLog, sigmoid);
  const maxChannels = new Array<number>(Math.floor(sample.length / 3));
  for (let pixel = 0; pixel < maxChannels.length; pixel += 1) {
    const i = pixel * 3;
    const r = sample[i] ?? 0;
    const g = sample[i + 1] ?? 0;
    const b = sample[i + 2] ?? 0;
    const luma = PROPHOTO_LUMA_R * r + PROPHOTO_LUMA_G * g + PROPHOTO_LUMA_B * b;
    let adjustedLuma = 0;
    if (luma > 1e-12) {
      const exposed = luma * gain;
      adjustedLuma = exposed <= 1
        ? rawBaselineToneCurveValue(exposed, scaledLog, sigmoid)
        : 1 + toneSlopeAtWhite * (exposed - 1);
    }
    const scale = luma > 1e-12 ? adjustedLuma / luma : 0;
    maxChannels[pixel] = Math.max(r * scale, g * scale, b * scale);
  }
  const maxP998 = percentileFromValues(maxChannels, 99.8);
  const rolloff = toneRolloffParams(
    maxP998,
    RAW_DEVELOPED_ROLLOFF_A,
    ROLLOFF_SAVING_LIMIT_FACTOR,
    RAW_DEVELOPED_LINEAR_RANGE_MAX,
  );
  return {
    plan: { gain, scaledLog, sigmoid, toneSlopeAtWhite, rolloff },
    luminance: {
      exposureEv: Math.log2(Math.max(gain, Number.MIN_VALUE)),
      logarithm: scaledLog,
      sigmoid,
      toneSlopeAtWhite,
    },
  };
}

function sortedValueIndices(values: Float32Array): number[] {
  const indices = Array.from({ length: values.length }, (_, index) => index);
  indices.sort((a, b) => {
    const diff = (values[a] ?? 0) - (values[b] ?? 0);
    return diff !== 0 ? diff : a - b;
  });
  return indices;
}

function percentileFromSortedValueIndices(
  values: Float32Array,
  indices: number[],
  percentile: number,
): number {
  if (!indices.length) return 0;
  const rank = (indices.length - 1) * Math.min(100, Math.max(0, percentile)) / 100;
  const lower = Math.floor(rank);
  const upper = Math.ceil(rank);
  const fraction = rank - lower;
  const lowerIndex = indices[lower] ?? 0;
  const upperIndex = indices[upper] ?? lowerIndex;
  const lo = values[lowerIndex] ?? 0;
  const hi = values[upperIndex] ?? lo;
  return lo + (hi - lo) * fraction;
}

function valuePercentileRangeIndices(
  sortedIndices: number[],
  lowerPercentile: number,
  upperPercentile: number,
): Uint32Array {
  const count = sortedIndices.length;
  if (count <= 0) return new Uint32Array(0);
  const lower = Math.min(100, Math.max(0, lowerPercentile));
  const upper = Math.min(100, Math.max(lower, upperPercentile));
  const start = Math.min(count - 1, Math.max(0, Math.floor(count * lower / 100)));
  const end = Math.max(start + 1, Math.min(count, Math.ceil(count * upper / 100)));
  const selected = new Uint32Array(end - start);
  for (let i = start; i < end; i++) selected[i - start] = sortedIndices[i] ?? 0;
  return selected;
}

function buildThumbnailColorTargetsFromLinearSrgbSample(
  sample: Float32Array,
): RawThumbnailColorTarget[] {
  const count = Math.floor(sample.length / 3);
  if (count <= 0) return [];
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
  const sortedIndices = sortedValueIndices(valueValues);
  const bins = 4096;
  return RAW_THUMBNAIL_MATCH_COLOR_VALUE_LOWER_PERCENTILES.map((lowerValuePercentile) => {
    const selected = valuePercentileRangeIndices(
      sortedIndices,
      lowerValuePercentile,
      RAW_THUMBNAIL_MATCH_COLOR_VALUE_UPPER_PERCENTILE,
    );
    if (!selected.length) {
      return { lowerValuePercentile, saturationP95: 0, saturationP50: 0 };
    }
    const histogram = new Uint32Array(bins);
    for (let position = 0; position < selected.length; position++) {
      const i = selected[position] ?? 0;
      const saturation = saturationValues[i] ?? 0;
      histogram[Math.min(bins - 1, Math.max(0, Math.round(saturation * (bins - 1))))]++;
    }
    return {
      lowerValuePercentile,
      saturationP95: histogramPercentile16(
        histogram,
        selected.length,
        RAW_THUMBNAIL_MATCH_SATURATION_PERCENTILE,
      ) / (bins - 1),
      saturationP50: histogramPercentile16(
        histogram,
        selected.length,
        RAW_THUMBNAIL_MATCH_VIBRANCE_PERCENTILE,
      ) / (bins - 1),
    };
  });
}

type RawAutoColorSample = {
  hue: Float32Array;
  saturation: Float32Array;
  value: Float32Array;
  saturationP998: number;
  statisticsIndices: Uint32Array;
  lowerValuePercentile: number;
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

    // Compute the sRGB Value population once. The same sorted order chooses the
    // adaptive lower percentile and builds the statistics interval.
    const [sr, sg, sb] = convertLinearProPhotoToOutputRgb(r, g, b, "srgb");
    const [, , comparisonValue] = rgbToHsv(clamp01(sr), clamp01(sg), clamp01(sb));
    statisticsValue[i] = comparisonValue;
  }

  const sortedIndices = sortedValueIndices(statisticsValue);
  let lowerValuePercentile = RAW_THUMBNAIL_MATCH_COLOR_VALUE_LOWER_PERCENTILES[
    RAW_THUMBNAIL_MATCH_COLOR_VALUE_LOWER_PERCENTILES.length - 1
  ] ?? 60;
  for (const percentile of RAW_THUMBNAIL_MATCH_COLOR_VALUE_LOWER_PERCENTILES) {
    if (percentileFromSortedValueIndices(statisticsValue, sortedIndices, percentile) > RAW_THUMBNAIL_MATCH_COLOR_VALUE_MIN) {
      lowerValuePercentile = percentile;
      break;
    }
  }

  const statisticsIndices = valuePercentileRangeIndices(
    sortedIndices,
    lowerValuePercentile,
    RAW_THUMBNAIL_MATCH_COLOR_VALUE_UPPER_PERCENTILE,
  );
  return {
    hue,
    saturation,
    value,
    saturationP998: percentileFromValues(saturationValues, 99.8),
    statisticsIndices,
    lowerValuePercentile,
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
  // P99.8 saturation after the linear multiplier, before Vibrance.
  const saturationRolloff = saturationFactor > 1
    ? toneRolloffParams(sample.saturationP998 * saturationFactor, SATURATION_ROLLOFF_A, ROLLOFF_SAVING_LIMIT_FACTOR, 1)
    : null;
  const bins = 4096;
  const histogram = new Uint32Array(bins);
  for (let position = 0; position < sample.statisticsIndices.length; position++) {
    const i = sample.statisticsIndices[position] ?? 0;
    let s = sample.saturation[i] ?? 0;
    if (normalizedSaturation !== 0) {
      s = applyRolloffScalar(s * saturationFactor, saturationRolloff);
      s = clamp01(s);
    }
    if (normalizedVibrance !== 0) s = applyScaledLogLinear(s, vibranceFactor);
    const [pr, pg, pb] = hsvToRgb(sample.hue[i] ?? 0, s, sample.value[i] ?? 0);
    const [sr, sg, sb] = convertLinearProPhotoToOutputRgb(pr, pg, pb, "srgb");
    const [, outputSaturation] = rgbToHsv(clamp01(sr), clamp01(sg), clamp01(sb));
    histogram[Math.min(bins - 1, Math.max(0, Math.round(outputSaturation * (bins - 1))))]++;
  }
  return sample.statisticsIndices.length > 0
    ? histogramPercentile16(histogram, sample.statisticsIndices.length, percentile) / (bins - 1)
    : 0;
}

function solveRawThumbnailMatchSaturation(
  sample: RawAutoColorSample,
  target: number,
  percentile: number,
): number {
  const clampedTarget = clamp01(target);
  const source = rawAutoColorSaturationPercentile(sample, 0, 0, percentile);
  let estimated = 0;
  if (source > 1e-8) {
    estimated = clampColorAdjustment((clampedTarget / source - 1) * 100);
  } else if (clampedTarget > source) {
    estimated = 100;
  }

  let best = estimated;
  let bestError = Number.POSITIVE_INFINITY;
  // Saturation itself is a linear multiplier, so use target/source as the
  // first estimate. sRGB conversion and saturation rolloff make that only an
  // approximation; verify the nearby integer settings with the exact current
  // rendering/statistics path and keep the best one.
  for (let offset = -2; offset <= 2; offset++) {
    const candidate = clampColorAdjustment(estimated + offset);
    const value = rawAutoColorSaturationPercentile(sample, candidate, 0, percentile);
    const error = Math.abs(value - clampedTarget);
    if (
      error < bestError - 1e-12
      || (Math.abs(error - bestError) <= 1e-12 && Math.abs(candidate) < Math.abs(best))
    ) {
      best = candidate;
      bestError = error;
    }
  }
  return best;
}

function solveRawThumbnailMatchVibrance(
  sample: RawAutoColorSample,
  target: number,
  percentile: number,
  fixedSaturation: number,
): number {
  const evaluate = (candidate: number) => rawAutoColorSaturationPercentile(
    sample,
    fixedSaturation,
    candidate,
    percentile,
  );
  const clampedTarget = clamp01(target);
  let lower = -100;
  let upper = 100;
  let lowerValue = evaluate(lower);
  let upperValue = evaluate(upper);
  const ascending = lowerValue <= upperValue;

  if (ascending) {
    if (clampedTarget <= lowerValue) return lower;
    if (clampedTarget >= upperValue) return upper;
  } else {
    if (clampedTarget >= lowerValue) return lower;
    if (clampedTarget <= upperValue) return upper;
  }

  // Vibrance is an integer control over a monotonic statistic. Eight binary
  // steps are sufficient to resolve all 201 values in [-100, 100].
  for (let i = 0; i < RAW_THUMBNAIL_MATCH_VIBRANCE_SEARCH_STEPS && upper - lower > 1; i++) {
    const mid = Math.floor((lower + upper) / 2);
    const value = evaluate(mid);
    if ((ascending && value < clampedTarget) || (!ascending && value > clampedTarget)) {
      lower = mid;
      lowerValue = value;
    } else {
      upper = mid;
      upperValue = value;
    }
  }

  const lowerError = Math.abs(lowerValue - clampedTarget);
  const upperError = Math.abs(upperValue - clampedTarget);
  if (lowerError < upperError - 1e-12) return lower;
  if (upperError < lowerError - 1e-12) return upper;
  return Math.abs(lower) <= Math.abs(upper) ? lower : upper;
}

function medianFilterRawThumbnailMatchChannel5x5(
  source: Float32Array,
  width: number,
  height: number,
): Float32Array {
  const output = new Float32Array(source.length);
  const scratch = new Float32Array(25);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let count = 0;
      for (let dy = -2; dy <= 2; dy++) {
        const sy = Math.max(0, Math.min(height - 1, y + dy));
        for (let dx = -2; dx <= 2; dx++) {
          const sx = Math.max(0, Math.min(width - 1, x + dx));
          scratch[count++] = source[sy * width + sx] ?? 0;
        }
      }
      for (let i = 1; i < count; i++) {
        const value = scratch[i] ?? 0;
        let j = i - 1;
        while (j >= 0 && (scratch[j] ?? 0) > value) {
          scratch[j + 1] = scratch[j] ?? 0;
          j--;
        }
        scratch[j + 1] = value;
      }
      output[y * width + x] = scratch[Math.floor(count / 2)] ?? 0;
    }
  }
  return output;
}

function denoiseRawThumbnailMatchChroma(
  linearRgbSample: Float32Array,
  width: number,
  height: number,
  colorSpace: "srgb" | "prophoto",
  timing?: RawDevelopmentTiming,
): Float32Array {
  const pixels = Math.floor(linearRgbSample.length / 3);
  if (pixels <= 0 || width <= 0 || height <= 0 || width * height !== pixels) {
    return linearRgbSample.slice();
  }

  const lumaR = colorSpace === "prophoto" ? PROPHOTO_LUMA_R : 0.2126;
  const lumaG = colorSpace === "prophoto" ? PROPHOTO_LUMA_G : 0.7152;
  const lumaB = colorSpace === "prophoto" ? PROPHOTO_LUMA_B : 0.0722;
  const rangeMax = colorSpace === "prophoto" ? RAW_DEVELOPED_LINEAR_RANGE_MAX : 1;
  const { luma, chromaR, chromaB } = measureRawTimingSync(
    timing,
    "preview",
    "Preparing embedded thumbnail chroma channels",
    () => {
      const nextLuma = new Float32Array(pixels);
      const nextChromaR = new Float32Array(pixels);
      const nextChromaB = new Float32Array(pixels);
      for (let i = 0; i < pixels; i++) {
        const si = i * 3;
        const r = linearRgbSample[si] ?? 0;
        const g = linearRgbSample[si + 1] ?? 0;
        const b = linearRgbSample[si + 2] ?? 0;
        const y = lumaR * r + lumaG * g + lumaB * b;
        nextLuma[i] = y;
        nextChromaR[i] = r - y;
        nextChromaB[i] = b - y;
      }
      return { luma: nextLuma, chromaR: nextChromaR, chromaB: nextChromaB };
    },
  );

  // Automatic thumbnail matching compares like with like: both RAW and the
  // embedded thumbnail are resized to the same target-area rule first, then
  // receive the same two strong 5x5 chroma-median passes. Luminance is kept
  // separate so this cleanup suppresses color noise rather than tone detail.
  const filteredRPass1 = measureRawTimingSync(
    timing,
    "preview",
    "Embedded thumbnail chroma R median pass 1",
    () => medianFilterRawThumbnailMatchChannel5x5(chromaR, width, height),
  );
  const filteredR = measureRawTimingSync(
    timing,
    "preview",
    "Embedded thumbnail chroma R median pass 2",
    () => medianFilterRawThumbnailMatchChannel5x5(filteredRPass1, width, height),
  );
  const filteredBPass1 = measureRawTimingSync(
    timing,
    "preview",
    "Embedded thumbnail chroma B median pass 1",
    () => medianFilterRawThumbnailMatchChannel5x5(chromaB, width, height),
  );
  const filteredB = measureRawTimingSync(
    timing,
    "preview",
    "Embedded thumbnail chroma B median pass 2",
    () => medianFilterRawThumbnailMatchChannel5x5(filteredBPass1, width, height),
  );

  return measureRawTimingSync(
    timing,
    "preview",
    "Reconstructing embedded thumbnail chroma sample",
    () => {
      const output = new Float32Array(linearRgbSample.length);
      for (let i = 0; i < pixels; i++) {
        const y = luma[i] ?? 0;
        const r = y + (filteredR[i] ?? 0);
        const b = y + (filteredB[i] ?? 0);
        const g = lumaG > 1e-12
          ? (y - lumaR * r - lumaB * b) / lumaG
          : y;
        const oi = i * 3;
        output[oi] = Math.max(0, Math.min(rangeMax, r));
        output[oi + 1] = Math.max(0, Math.min(rangeMax, g));
        output[oi + 2] = Math.max(0, Math.min(rangeMax, b));
      }
      return output;
    },
  );
}

function planRawThumbnailMatchedColor(
  rawLinearProPhotoSample: Float32Array,
  rawSampleWidth: number,
  rawSampleHeight: number,
  thumbnailLinearSrgbSample: Float32Array,
  thumbnailColorTargets?: RawThumbnailColorTarget[],
): RawMatchedColorPlanningResult | null {
  if (!thumbnailLinearSrgbSample.length || !rawLinearProPhotoSample.length) return null;

  // Chroma denoise is intentionally mandatory for color planning. It keeps
  // high-ISO color noise from being interpreted as real saturation, and is
  // applied consistently at all ISO values for stable behavior.
  const statisticsSample = denoiseRawThumbnailMatchChroma(
    rawLinearProPhotoSample,
    rawSampleWidth,
    rawSampleHeight,
    "prophoto",
  );
  const sample = buildRawAutoColorSample(statisticsSample);
  const targets = thumbnailColorTargets?.length
    ? thumbnailColorTargets
    : buildThumbnailColorTargetsFromLinearSrgbSample(thumbnailLinearSrgbSample);
  const target = targets.find((entry) => entry.lowerValuePercentile === sample.lowerValuePercentile);
  const targetP95 = target?.saturationP95;
  const targetP50 = target?.saturationP50;
  if (!Number.isFinite(targetP95) || !Number.isFinite(targetP50)) return null;

  const targetSaturation = solveRawThumbnailMatchSaturation(
    sample,
    targetP95!,
    RAW_THUMBNAIL_MATCH_SATURATION_PERCENTILE,
  );
  let saturation = 0;
  for (let i = 0; i < RAW_THUMBNAIL_MATCH_COLOR_ITERATIONS; i++) {
    saturation += RAW_THUMBNAIL_MATCH_SATURATION_RELAXATION * (targetSaturation - saturation);
  }
  saturation = Math.max(
    RAW_THUMBNAIL_MATCH_COLOR_AUTO_MIN,
    clampColorAdjustment(saturation),
  );

  const targetVibrance = solveRawThumbnailMatchVibrance(
    sample,
    targetP50!,
    RAW_THUMBNAIL_MATCH_VIBRANCE_PERCENTILE,
    saturation,
  );
  let vibrance = 0;
  for (let i = 0; i < RAW_THUMBNAIL_MATCH_COLOR_ITERATIONS; i++) {
    vibrance += RAW_THUMBNAIL_MATCH_VIBRANCE_RELAXATION * (targetVibrance - vibrance);
  }
  vibrance = Math.max(
    RAW_THUMBNAIL_MATCH_COLOR_AUTO_MIN,
    clampColorAdjustment(vibrance),
  );

  const settings = { saturation, vibrance };
  if (Math.abs(saturation) < 1e-6 && Math.abs(vibrance) < 1e-6) {
    return { settings, pass: null };
  }
  const normalizedSaturation = clampColorAdjustment(saturation);
  const normalizedVibrance = clampColorAdjustment(vibrance);
  const saturationFactor = colorSaturationFactor(normalizedSaturation);
  const vibranceFactor = colorVibranceFactor(normalizedVibrance);
  const saturationRolloff = saturationFactor > 1
    ? toneRolloffParams(sample.saturationP998 * saturationFactor, SATURATION_ROLLOFF_A, ROLLOFF_SAVING_LIMIT_FACTOR, 1)
    : null;
  return {
    settings,
    pass: {
      hasSaturation: normalizedSaturation !== 0,
      hasVibrance: normalizedVibrance !== 0,
      saturationFactor,
      vibranceFactor,
      saturationRolloff,
    },
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

// Thumbnail matching uses a fixed sample area so statistics are comparable
// across aspect ratios. Area averaging also suppresses single-pixel RAW noise
// before the color solver sees the sample.
function sampleRawThumbnailMatchLinearRgbFromRgb16(decoded: DecodedRgbImage16): Float32Array {
  const dimensions = analysisSampleDimensions(
    decoded.width,
    decoded.height,
    RAW_THUMBNAIL_MATCH_SAMPLE_TARGET_PIXELS,
  );
  const sampleW = dimensions.width;
  const sampleH = dimensions.height;
  const output = new Float32Array(sampleW * sampleH * 3);
  const vignettingGain: [number, number, number] = [1, 1, 1];

  for (let y = 0; y < sampleH; y++) {
    const sy0 = y * decoded.height / sampleH;
    const sy1 = (y + 1) * decoded.height / sampleH;
    const iy0 = Math.max(0, Math.floor(sy0));
    const iy1 = Math.min(decoded.height, Math.ceil(sy1));
    for (let x = 0; x < sampleW; x++) {
      const sx0 = x * decoded.width / sampleW;
      const sx1 = (x + 1) * decoded.width / sampleW;
      const ix0 = Math.max(0, Math.floor(sx0));
      const ix1 = Math.min(decoded.width, Math.ceil(sx1));
      let sumR = 0;
      let sumG = 0;
      let sumB = 0;
      let totalWeight = 0;
      for (let sy = iy0; sy < iy1; sy++) {
        const wy = Math.max(0, Math.min(sy + 1, sy1) - Math.max(sy, sy0));
        if (!(wy > 0)) continue;
        for (let sx = ix0; sx < ix1; sx++) {
          const wx = Math.max(0, Math.min(sx + 1, sx1) - Math.max(sx, sx0));
          const area = wx * wy;
          if (!(area > 0)) continue;
          const sourceIndex = (sy * decoded.width + sx) * 3;
          pendingLensfunVignettingGainInto(decoded, sx, sy, vignettingGain);
          sumR += decodeStoredRgb16Channel(
            decoded.data[sourceIndex] ?? 0,
            decoded.transfer,
            decoded.linearRangeMax,
          ) * vignettingGain[0] * area;
          sumG += decodeStoredRgb16Channel(
            decoded.data[sourceIndex + 1] ?? 0,
            decoded.transfer,
            decoded.linearRangeMax,
          ) * vignettingGain[1] * area;
          sumB += decodeStoredRgb16Channel(
            decoded.data[sourceIndex + 2] ?? 0,
            decoded.transfer,
            decoded.linearRangeMax,
          ) * vignettingGain[2] * area;
          totalWeight += area;
        }
      }
      const invWeight = totalWeight > 0 ? 1 / totalWeight : 0;
      const targetIndex = (y * sampleW + x) * 3;
      output[targetIndex] = sumR * invWeight;
      output[targetIndex + 1] = sumG * invWeight;
      output[targetIndex + 2] = sumB * invWeight;
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
  const context = buildInteractiveColorAdjustmentContextFromLinearRgbSample(
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
  const adjustedRgb: [number, number, number] = [0, 0, 0];
  const pixelCount = Math.floor(sample.data.length / 3);
  for (let pixel = 0; pixel < pixelCount; pixel++) {
    if (sample.valid && !sample.valid[pixel]) continue;
    const i = pixel * 3;
    applyColorAdjustmentsLinearRgbInto(
      sample.data[i] ?? 0,
      sample.data[i + 1] ?? 0,
      sample.data[i + 2] ?? 0,
      context,
      adjustedRgb,
    );
    adjusted[i] = adjustedRgb[0];
    adjusted[i + 1] = adjustedRgb[1];
    adjusted[i + 2] = adjustedRgb[2];
  }
  return debugStatisticsFromLinearRgbSample(
    { ...sample, data: adjusted },
    colorSpace,
  );
}

const RAW_THUMBNAIL_SRGB8_TO_LINEAR_LUT = (() => {
  const lut = new Array<number>(256);
  for (let value = 0; value < lut.length; value++) {
    lut[value] = srgbChannelToLinear(value);
  }
  return lut;
})();

function areaAverageRawThumbnailLinearSrgbSample(
  source: Uint8Array | Uint8ClampedArray,
  sourceWidth: number,
  sourceHeight: number,
  channels: number,
): { data: Float32Array; width: number; height: number } | null {
  if (sourceWidth <= 0 || sourceHeight <= 0 || channels < 3) return null;
  if (source.length < sourceWidth * sourceHeight * channels) return null;
  const dimensions = analysisSampleDimensions(
    sourceWidth,
    sourceHeight,
    RAW_THUMBNAIL_MATCH_SAMPLE_TARGET_PIXELS,
  );
  const sampleW = dimensions.width;
  const sampleH = dimensions.height;
  const sample = new Float32Array(sampleW * sampleH * 3);
  for (let y = 0; y < sampleH; y++) {
    const sy0 = y * sourceHeight / sampleH;
    const sy1 = (y + 1) * sourceHeight / sampleH;
    const iy0 = Math.max(0, Math.floor(sy0));
    const iy1 = Math.min(sourceHeight, Math.ceil(sy1));
    for (let x = 0; x < sampleW; x++) {
      const sx0 = x * sourceWidth / sampleW;
      const sx1 = (x + 1) * sourceWidth / sampleW;
      const ix0 = Math.max(0, Math.floor(sx0));
      const ix1 = Math.min(sourceWidth, Math.ceil(sx1));
      let sumR = 0;
      let sumG = 0;
      let sumB = 0;
      let totalWeight = 0;
      for (let sy = iy0; sy < iy1; sy++) {
        const wy = Math.max(0, Math.min(sy + 1, sy1) - Math.max(sy, sy0));
        if (!(wy > 0)) continue;
        for (let sx = ix0; sx < ix1; sx++) {
          const wx = Math.max(0, Math.min(sx + 1, sx1) - Math.max(sx, sx0));
          const area = wx * wy;
          if (!(area > 0)) continue;
          const sourceIndex = (sy * sourceWidth + sx) * channels;
          sumR += (RAW_THUMBNAIL_SRGB8_TO_LINEAR_LUT[source[sourceIndex] ?? 0] ?? 0) * area;
          sumG += (RAW_THUMBNAIL_SRGB8_TO_LINEAR_LUT[source[sourceIndex + 1] ?? 0] ?? 0) * area;
          sumB += (RAW_THUMBNAIL_SRGB8_TO_LINEAR_LUT[source[sourceIndex + 2] ?? 0] ?? 0) * area;
          totalWeight += area;
        }
      }
      const invWeight = totalWeight > 0 ? 1 / totalWeight : 0;
      const targetIndex = (y * sampleW + x) * 3;
      sample[targetIndex] = sumR * invWeight;
      sample[targetIndex + 1] = sumG * invWeight;
      sample[targetIndex + 2] = sumB * invWeight;
    }
  }
  return { data: sample, width: sampleW, height: sampleH };
}

async function rawThumbnailMatchReferenceFromThumbnail(
  thumbnail: LibRawThumbnailDataLike | undefined,
  timing?: RawDevelopmentTiming,
): Promise<RawThumbnailMatchReference | undefined> {
  if (!thumbnail?.data?.length || thumbnail.width <= 0 || thumbnail.height <= 0) return undefined;

  let resized: { data: Float32Array; width: number; height: number } | null = null;
  if (thumbnail.format === "bitmap") {
    const pixelCount = thumbnail.width * thumbnail.height;
    const channels = thumbnail.data.length >= pixelCount * 4 ? 4 : 3;
    resized = measureRawTimingSync(
      timing,
      "preview",
      "Downsampling embedded thumbnail analysis sample",
      () => areaAverageRawThumbnailLinearSrgbSample(
        thumbnail.data,
        thumbnail.width,
        thumbnail.height,
        channels,
      ),
    );
  } else if (thumbnail.format === "jpeg") {
    const jpegBytes = new Uint8Array(thumbnail.data.byteLength);
    jpegBytes.set(thumbnail.data);
    const blob = new Blob([jpegBytes.buffer], { type: "image/jpeg" });
    let source: CanvasImageSource | null = null;
    let cleanup = () => {};
    try {
      source = await (timing
        ? measureRawTiming(timing, "preview", "Decoding embedded thumbnail JPEG", async () => {
            try {
              // Normalize embedded ICC profiles into sRGB before the shared linear
              // area-average + chroma-NR statistics pipeline.
              const bitmap = await createImageBitmap(blob, { colorSpaceConversion: "default" });
              cleanup = () => bitmap.close?.();
              return bitmap;
            } catch {
              const file = new File([blob], "raw-thumbnail.jpg", { type: "image/jpeg" });
              return decodeViaImg(file);
            }
          })
        : (async () => {
            try {
              const bitmap = await createImageBitmap(blob, { colorSpaceConversion: "default" });
              cleanup = () => bitmap.close?.();
              return bitmap;
            } catch {
              const file = new File([blob], "raw-thumbnail.jpg", { type: "image/jpeg" });
              return decodeViaImg(file);
            }
          })());
      const width = Number(
        (source as ImageBitmap).width
        || (source as HTMLImageElement).naturalWidth
        || thumbnail.width,
      );
      const height = Number(
        (source as ImageBitmap).height
        || (source as HTMLImageElement).naturalHeight
        || thumbnail.height,
      );
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = getCanvas2dContext(canvas, "srgb", true);
      if (!ctx) return undefined;
      measureRawTimingSync(timing, "preview", "Drawing embedded thumbnail to sRGB canvas", () => {
        ctx.drawImage(source!, 0, 0, width, height);
      });
      const rgba = measureRawTimingSync(
        timing,
        "preview",
        "Reading embedded thumbnail canvas pixels",
        () => ctx.getImageData(0, 0, width, height).data,
      );
      resized = measureRawTimingSync(
        timing,
        "preview",
        "Downsampling embedded thumbnail analysis sample",
        () => areaAverageRawThumbnailLinearSrgbSample(rgba, width, height, 4),
      );
    } finally {
      cleanup();
    }
  }

  if (!resized?.data.length) return undefined;
  const statisticsSample = denoiseRawThumbnailMatchChroma(
    resized.data,
    resized.width,
    resized.height,
    "srgb",
    timing,
  );
  const lumaPercentiles = measureRawTimingSync(
    timing,
    "preview",
    "Computing embedded thumbnail luminance percentiles",
    () => debugPercentilesFromLinearRgbSample(statisticsSample),
  );
  const saturationPercentiles = measureRawTimingSync(
    timing,
    "preview",
    "Computing embedded thumbnail saturation percentiles",
    () => debugSaturationPercentilesFromLinearRgbSample(statisticsSample),
  );
  return {
    lumaPercentiles,
    saturationPercentiles,
    linearSrgbSample: statisticsSample,
    colorTargets: buildThumbnailColorTargetsFromLinearSrgbSample(statisticsSample),
  };
}

type RawThumbnailAnalysisWorkerResponse = {
  type: "thumbnail-analysis-complete";
  lumaPercentiles: number[];
  saturationPercentiles: number[];
  sampleBuffer: ArrayBuffer;
  colorTargets: RawThumbnailColorTarget[];
  timingEntries: RawDevelopmentTimingEntry[];
};

function createRawThumbnailAnalysisWorker(): Worker | null {
  if (typeof Worker !== "function") return null;
  try {
    return new Worker(new URL("./image-editor/raw-thumbnail-analysis.worker.ts", import.meta.url), {
      type: "module",
    });
  } catch {
    return null;
  }
}

async function rawThumbnailMatchReferenceFromThumbnailParallel(
  thumbnail: LibRawThumbnailDataLike | undefined,
  timing?: RawDevelopmentTiming,
): Promise<RawThumbnailMatchReference | undefined> {
  if (!thumbnail?.data?.length || thumbnail.width <= 0 || thumbnail.height <= 0) return undefined;
  if (thumbnail.format !== "jpeg" && thumbnail.format !== "bitmap") {
    return rawThumbnailMatchReferenceFromThumbnail(thumbnail, timing);
  }

  const worker = createRawThumbnailAnalysisWorker();
  if (!worker) return rawThumbnailMatchReferenceFromThumbnail(thumbnail, timing);

  const data = new Uint8Array(thumbnail.data.byteLength);
  data.set(thumbnail.data);
  try {
    const response = await new Promise<RawThumbnailAnalysisWorkerResponse>((resolve, reject) => {
      const cleanup = () => {
        worker.removeEventListener("message", onMessage);
        worker.removeEventListener("error", onError);
        worker.removeEventListener("messageerror", onMessageError);
      };
      const onMessage = (event: MessageEvent) => {
        const payload = event.data as RawThumbnailAnalysisWorkerResponse | { type?: string; message?: string };
        if (payload?.type === "error") {
          cleanup();
          reject(new Error(payload.message || "Embedded thumbnail analysis worker failed"));
          return;
        }
        if (payload?.type !== "thumbnail-analysis-complete") return;
        cleanup();
        resolve(payload as RawThumbnailAnalysisWorkerResponse);
      };
      const onError = (event: ErrorEvent) => {
        cleanup();
        reject(new Error(event.message || "Embedded thumbnail analysis worker failed"));
      };
      const onMessageError = () => {
        cleanup();
        reject(new Error("Embedded thumbnail analysis worker message failed"));
      };
      worker.addEventListener("message", onMessage);
      worker.addEventListener("error", onError);
      worker.addEventListener("messageerror", onMessageError);
      worker.postMessage(
        {
          type: "analyze",
          format: thumbnail.format,
          width: thumbnail.width,
          height: thumbnail.height,
          dataBuffer: data.buffer,
          targetPixels: RAW_THUMBNAIL_MATCH_SAMPLE_TARGET_PIXELS,
          percentiles: Array.from(DEBUG_PERCENTILES),
          colorLowerValuePercentiles: Array.from(RAW_THUMBNAIL_MATCH_COLOR_VALUE_LOWER_PERCENTILES),
          colorUpperValuePercentile: RAW_THUMBNAIL_MATCH_COLOR_VALUE_UPPER_PERCENTILE,
          saturationPercentile: RAW_THUMBNAIL_MATCH_SATURATION_PERCENTILE,
          vibrancePercentile: RAW_THUMBNAIL_MATCH_VIBRANCE_PERCENTILE,
        },
        [data.buffer],
      );
    });
    if (timing) {
      for (const entry of response.timingEntries) {
        recordRawTiming(timing, "preview", entry.name, entry.elapsedMs);
      }
    }
    return {
      lumaPercentiles: response.lumaPercentiles,
      saturationPercentiles: response.saturationPercentiles,
      linearSrgbSample: new Float32Array(response.sampleBuffer),
      colorTargets: response.colorTargets,
    };
  } catch {
    return rawThumbnailMatchReferenceFromThumbnail(thumbnail, timing);
  } finally {
    worker.terminate();
  }
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

function rawMetadataNonnegativeInteger(value: unknown): number | null {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? Math.round(number) : null;
}

function rawMetadataPositiveInteger(value: unknown): number | null {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.round(number) : null;
}

function rawGeometryFromMetadata(metadata: LibRawMetadataLike | undefined): RawDevelopmentRawGeometry | undefined {
  if (!metadata) return undefined;
  const rawWidth = rawMetadataPositiveInteger(metadata.raw_width);
  const rawHeight = rawMetadataPositiveInteger(metadata.raw_height);
  const visibleWidth = rawMetadataPositiveInteger(metadata.width);
  const visibleHeight = rawMetadataPositiveInteger(metadata.height);
  const leftMargin = rawMetadataNonnegativeInteger(metadata.left_margin);
  const topMargin = rawMetadataNonnegativeInteger(metadata.top_margin);
  const sourceCrops = Array.isArray(metadata.raw_inset_crops) ? metadata.raw_inset_crops : [];
  const insetCrops = ([0, 1] as const).map((index) => {
    const crop = sourceCrops[index];
    if (!crop) return null;
    const left = rawMetadataNonnegativeInteger(crop.cleft);
    const top = rawMetadataNonnegativeInteger(crop.ctop);
    const width = rawMetadataPositiveInteger(crop.cwidth);
    const height = rawMetadataPositiveInteger(crop.cheight);
    // LibRaw uses 0xffff for an uninitialized inset crop.
    if (left === null || top === null || width === null || height === null || left >= 0xffff || top >= 0xffff) {
      return null;
    }
    if (rawWidth !== null && left + width > rawWidth) return null;
    if (rawHeight !== null && top + height > rawHeight) return null;
    return { left, top, width, height };
  }) as RawDevelopmentRawGeometry["insetCrops"];

  if (
    rawWidth === null
    && rawHeight === null
    && visibleWidth === null
    && visibleHeight === null
    && leftMargin === null
    && topMargin === null
    && insetCrops[0] === null
    && insetCrops[1] === null
  ) {
    return undefined;
  }
  return {
    rawWidth,
    rawHeight,
    visibleWidth,
    visibleHeight,
    leftMargin,
    topMargin,
    insetCrops,
  };
}

function rawInsetOutputCropFromMetadata(
  metadata: LibRawMetadataLike | undefined,
  sourceWidth: number,
  sourceHeight: number,
): RawOutputCrop | undefined {
  const geometry = rawGeometryFromMetadata(metadata);
  const inset = geometry?.insetCrops[0];
  if (!inset || sourceWidth <= 0 || sourceHeight <= 0) return undefined;

  const fits = (left: number, top: number): RawOutputCrop | undefined => {
    if (left < 0 || top < 0) return undefined;
    if (left + inset.width > sourceWidth || top + inset.height > sourceHeight) return undefined;
    if (left === 0 && top === 0 && inset.width === sourceWidth && inset.height === sourceHeight) {
      return undefined;
    }
    return { left, top, width: inset.width, height: inset.height };
  };

  // raw_inset_crops[] is expressed in the full RAW sensor coordinate system.
  // LibRaw imageData() may expose either that full geometry or the visible area
  // with left/top margins already removed. Preserve the original sensor
  // coordinate whenever the decoded buffer matches raw_width/raw_height; only
  // subtract margins when the decoded buffer matches the visible dimensions.
  if (geometry?.rawWidth === sourceWidth && geometry.rawHeight === sourceHeight) {
    return fits(inset.left, inset.top);
  }
  if (geometry?.visibleWidth === sourceWidth && geometry.visibleHeight === sourceHeight) {
    return fits(
      inset.left - (geometry.leftMargin ?? 0),
      inset.top - (geometry.topMargin ?? 0),
    );
  }

  return fits(inset.left, inset.top)
    ?? fits(
      inset.left - (geometry?.leftMargin ?? 0),
      inset.top - (geometry?.topMargin ?? 0),
    );
}

function buildRawDevelopmentCropSettings(
  sourceWidth: number,
  sourceHeight: number,
  correction: LensfunCorrection | undefined,
  metadataCrop: RawOutputCrop | undefined,
): RawDevelopmentCropSettings | undefined {
  if (!correction?.autoCrop && !metadataCrop) return undefined;
  const correctionMaps = rawLensfunCorrectionMaps(correction);
  const frame = metadataCrop ?? { left: 0, top: 0, width: sourceWidth, height: sourceHeight };
  const lensfunLocalRegion = rawLensfunOutputRegion(
    sourceWidth,
    sourceHeight,
    correctionMaps,
    metadataCrop,
  );
  const toBackingRegion = (region: RawOutputCrop): RawOutputCrop => ({
    left: frame.left + region.left,
    top: frame.top + region.top,
    width: region.width,
    height: region.height,
  });
  return {
    lensfunAutoCrop: correction?.autoCrop ? toBackingRegion(lensfunLocalRegion) : null,
    metadataCrop: metadataCrop ?? null,
    finalCrop: toBackingRegion(lensfunLocalRegion),
  };
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

function pendingLensfunVignettingGainInto(
  decoded: DecodedRgbImage16,
  x: number,
  y: number,
  output: [number, number, number],
): [number, number, number] {
  const correction = decoded.lensCorrection;
  if (!correction?.vignetting || correction.vignettingBaked) {
    output[0] = 1;
    output[1] = 1;
    output[2] = 1;
    return output;
  }
  return lensfunVignettingGainInto(correction, x, y, output);
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

function rawMedianDenoisePassesForIso(iso: number): number {
  if (!Number.isFinite(iso) || iso <= 0) return 0;
  if (iso >= RAW_MEDIAN_DENOISE_STRONG_ISO) return 2;
  if (iso >= RAW_MEDIAN_DENOISE_WEAK_ISO) return 1;
  return 0;
}

type RawDenoiseDecodeSettings = {
  fbddNoiserd: 1 | 2;
  fbdd: RawDenoiseSettings["fbdd"];
  medPasses: 1 | 2;
  threshold: 100 | 200;
};

function rawDenoiseDecodeSettingsForIso(iso: number): RawDenoiseDecodeSettings {
  if (Number.isFinite(iso) && iso >= RAW_DENOISE_FULL_ISO) {
    return { fbddNoiserd: 2, fbdd: "full", medPasses: 2, threshold: 200 };
  }
  return { fbddNoiserd: 1, fbdd: "light", medPasses: 1, threshold: 100 };
}

function formatRawDevelopmentSetting(value: number): string {
  if (!Number.isFinite(value)) return "n/a";
  const normalized = Math.abs(value) < 0.0005 ? 0 : value;
  return normalized.toFixed(2).replace(/\.?0+$/, "");
}

function formatRawDevelopmentGeometry(geometry: RawDevelopmentRawGeometry): string {
  const dimensions = (width: number | null, height: number | null) =>
    width === null || height === null ? "n/a" : `${width}x${height}`;
  const crop = (value: RawDevelopmentRawGeometry["insetCrops"][number]) =>
    value
      ? `left=${value.left} top=${value.top} width=${value.width} height=${value.height}`
      : "unset";
  return [
    `raw=${dimensions(geometry.rawWidth, geometry.rawHeight)}`,
    `visible=${dimensions(geometry.visibleWidth, geometry.visibleHeight)}`,
    `margins=left=${geometry.leftMargin ?? "n/a"} top=${geometry.topMargin ?? "n/a"}`,
    `inset[0]=${crop(geometry.insetCrops[0])}`,
    `inset[1]=${crop(geometry.insetCrops[1])}`,
  ].join(", ");
}

function formatRawDevelopmentCropValue(value: number): string {
  if (!Number.isFinite(value)) return "n/a";
  const rounded = Math.round(value * 100) / 100;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(2).replace(/\.?0+$/, "");
}

function formatRawDevelopmentCropRect(value: RawDevelopmentCropSettings["finalCrop"] | null): string {
  if (!value) return "none";
  return `left=${formatRawDevelopmentCropValue(value.left)} top=${formatRawDevelopmentCropValue(value.top)} width=${formatRawDevelopmentCropValue(value.width)} height=${formatRawDevelopmentCropValue(value.height)}`;
}

function formatRawDevelopmentCropSettings(settings: RawDevelopmentCropSettings): string {
  return [
    `lensfun auto=${formatRawDevelopmentCropRect(settings.lensfunAutoCrop)}`,
    `metadata=${formatRawDevelopmentCropRect(settings.metadataCrop)}`,
    `final=${formatRawDevelopmentCropRect(settings.finalCrop)}`,
  ].join(", ");
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


type RawDevelopmentWorkerError = Error & {
  dataBuffer?: ArrayBuffer;
  linearRangeMax?: number;
  transfer?: DecodedRgbImage16["transfer"];
};

type RawWorkerToneResponse = {
  type: "tone-complete";
  headroom: RawDevelopmentHeadroomStatistics;
  colorSample: ArrayBuffer;
};

type RawWorkerFallbackResponse = {
  type: "fallback-tone-complete";
  result: {
    exposureEv: number;
    headroom: RawDevelopmentHeadroomStatistics;
    plan: RawFallbackPlan;
  } | null;
};

type RawWorkerColorResponse = {
  type: "color-complete";
};

type RawWorkerEncodeResponse = {
  type: "encode-complete";
  dataBuffer: ArrayBuffer;
  linearRangeMax: number;
};

type RawWorkerLensfunResampleResponse = {
  type: "lensfun-resample-complete";
  dataBuffer: ArrayBuffer;
  width: number;
  height: number;
  linearRangeMax: number;
  transfer: DecodedRgbImage16["transfer"];
};

type RawWorkerMasterOnePassResponse = {
  type: "master-one-pass-complete";
  dataBuffer: ArrayBuffer;
  width: number;
  height: number;
  linearRangeMax: number;
  transfer: DecodedRgbImage16["transfer"];
  headroom?: RawDevelopmentHeadroomStatistics;
};

type RawWorkerMasterOnePassSharedResponse = {
  type: "master-one-pass-shared-complete";
  workerIndex: number;
  rowStart: number;
  rowEnd: number;
  width: number;
  height: number;
  linearRangeMax: number;
  transfer: DecodedRgbImage16["transfer"];
  headroom?: RawDevelopmentHeadroomStatistics;
};

type RawWorkerDenoiseAnalyzeResponse = {
  type: "denoise-analyze-complete";
  weightBuffer: ArrayBuffer;
  width: number;
  height: number;
  smoothMean: number;
  smoothStddev: number;
  shadowMean: number;
  shadowStddev: number;
  weightMean: number;
  weightStddev: number;
  weightP50: number;
  weightP90: number;
  weightP99: number;
};

type RawWorkerDenoiseMergeReadyResponse = {
  type: "denoise-merge-ready";
};

type RawWorkerDenoiseMergeChunkResponse = {
  type: "denoise-merge-chunk-complete";
  denoiseBuffer: ArrayBuffer;
  rowStart: number;
  rowCount: number;
};

type RawWorkerDenoiseMergeSharedResponse = {
  type: "denoise-merge-shared-complete";
  workerIndex: number;
  rowStart: number;
  rowEnd: number;
};

type RawProgressiveDevelopmentPlan = {
  mode: RawDevelopmentSettings["mode"];
  previewIso?: number | null;
  rawGeometry?: RawDevelopmentRawGeometry;
  luminance: RawDevelopmentLuminanceSettings | null;
  headroom?: RawDevelopmentHeadroomStatistics;
  saturation: RawDevelopmentSaturationSettings;
  previewElapsedSeconds?: number;
  timing: RawDevelopmentTiming;
  tonePlan?: RawMatchedTonePlan;
  fallbackPlan?: RawFallbackPlan;
  colorPlan?: RawColorPassPlan;
};

type RawPreviewDevelopmentResult = {
  decoded: DecodedRgbImage16;
  plan: RawProgressiveDevelopmentPlan;
};

type RawTimingSection = "preview" | "master" | "denoise";

function createRawDevelopmentTiming(): RawDevelopmentTiming {
  return {
    startedAtMs: performance.now(),
    runtimeMode: resolveLibRawRuntimeMode(),
    openMpThreads: resolveLibRawOpenMpThreads(),
    preview: [],
    master: [],
    denoise: [],
  };
}

function rawTimingEntries(
  timing: RawDevelopmentTiming,
  section: RawTimingSection,
): RawDevelopmentTimingEntry[] {
  return timing[section];
}

function recordRawTiming(
  timing: RawDevelopmentTiming,
  section: RawTimingSection,
  name: string,
  elapsedMs: number,
): void {
  rawTimingEntries(timing, section).push({ name, elapsedMs });
}

function recordRawTimingOnce(
  timing: RawDevelopmentTiming,
  section: RawTimingSection,
  name: string,
  elapsedMs: number,
): void {
  const entries = rawTimingEntries(timing, section);
  if (entries.some((entry) => entry.name === name)) return;
  entries.push({ name, elapsedMs });
}

async function measureRawTiming<T>(
  timing: RawDevelopmentTiming,
  section: RawTimingSection,
  name: string,
  task: () => T | Promise<T>,
): Promise<T> {
  const startedAt = performance.now();
  try {
    return await task();
  } finally {
    recordRawTiming(timing, section, name, performance.now() - startedAt);
  }
}

function measureRawTimingSync<T>(
  timing: RawDevelopmentTiming | undefined,
  section: RawTimingSection,
  name: string,
  task: () => T,
): T {
  if (!timing) return task();
  const startedAt = performance.now();
  try {
    return task();
  } finally {
    recordRawTiming(timing, section, name, performance.now() - startedAt);
  }
}

function rawTimingSubtotal(
  entries: readonly RawDevelopmentTimingEntry[],
  names: readonly string[],
): number {
  const wanted = new Set(names);
  return entries.reduce((sum, entry) => sum + (wanted.has(entry.name) ? entry.elapsedMs : 0), 0);
}

function logRawTimingSection(
  title: "RAW Preview" | "Master" | "Denoise",
  timing: RawDevelopmentTiming,
  entries: readonly RawDevelopmentTimingEntry[],
): void {
  console.group(`[RAW timing] ${title}`);
  console.info(
    `LibRaw runtime=${timing.runtimeMode}, OpenMP threads=${timing.openMpThreads}${
      timing.runtimeMode === "threaded" ? " (configured; C++ runtime prints max/actual parallel thread counts)" : ""
    }`,
  );
  console.table(entries.map((entry) => ({
    Processing: entry.name,
    "Time (ms)": Number(entry.elapsedMs.toFixed(1)),
  })));
  console.groupEnd();
}

export type ImageEditTimingTrace = {
  startedAtMs: number;
  entries: RawDevelopmentTimingEntry[];
  logged: boolean;
};

function createImageEditTimingTrace(): ImageEditTimingTrace {
  return { startedAtMs: performance.now(), entries: [], logged: false };
}

export function recordImageEditTiming(
  timing: ImageEditTimingTrace | undefined,
  name: string,
  elapsedMs: number,
): void {
  timing?.entries.push({ name, elapsedMs });
}

function measureImageEditTimingSync<T>(
  timing: ImageEditTimingTrace | undefined,
  name: string,
  task: () => T,
): T {
  if (!timing) return task();
  const startedAt = performance.now();
  try {
    return task();
  } finally {
    recordImageEditTiming(timing, name, performance.now() - startedAt);
  }
}

export async function measureImageEditTiming<T>(
  timing: ImageEditTimingTrace | undefined,
  name: string,
  task: () => T | Promise<T>,
): Promise<T> {
  if (!timing) return task();
  const startedAt = performance.now();
  try {
    return await task();
  } finally {
    recordImageEditTiming(timing, name, performance.now() - startedAt);
  }
}

function logImageEditTiming(timing: ImageEditTimingTrace): void {
  console.group("[RAW timing] Edit");
  console.table(timing.entries.map((entry) => ({
    Processing: entry.name,
    "Time (ms)": Number(entry.elapsedMs.toFixed(1)),
  })));
  console.groupEnd();
}

export function finalizeImageEditTiming(
  timing: ImageEditTimingTrace,
  elapsedMs: number,
  terminalName = "Edited result image painted",
): void {
  if (timing.logged) return;
  if (!timing.entries.some((entry) => entry.name === terminalName)) {
    recordImageEditTiming(timing, terminalName, elapsedMs);
  }
  timing.logged = true;
  logImageEditTiming(timing);
}

function scheduleImageEditTimingFinalization(
  timing: ImageEditTimingTrace,
): void {
  // The real result <img> onLoad handler is the preferred measurement. If that
  // callback never arrives, finalize from the main thread after two seconds.
  // Do not rely on console output or timers inside an image/RAW worker.
  window.setTimeout(() => {
    if (timing.logged) return;
    finalizeImageEditTiming(
      timing,
      performance.now() - timing.startedAtMs,
    );
  }, 2_000);
}

async function buildDefringeAnalysisSample(decoded: DecodedRgbImage16): Promise<LinearRgbSample> {
  const sourceW = Math.max(1, decoded.width);
  const sourceH = Math.max(1, decoded.height);
  const dimensions = analysisSampleDimensions(sourceW, sourceH, DEFRINGE_ANALYSIS_TARGET_PIXELS);
  const sampleW = dimensions.width;
  const sampleH = dimensions.height;
  const output = new Float32Array(sampleW * sampleH * 3);

  for (let y = 0; y < sampleH; y += 1) {
    const sy0 = y * sourceH / sampleH;
    const sy1 = (y + 1) * sourceH / sampleH;
    const iy0 = Math.max(0, Math.floor(sy0));
    const iy1 = Math.min(sourceH, Math.ceil(sy1));
    for (let x = 0; x < sampleW; x += 1) {
      const sx0 = x * sourceW / sampleW;
      const sx1 = (x + 1) * sourceW / sampleW;
      const ix0 = Math.max(0, Math.floor(sx0));
      const ix1 = Math.min(sourceW, Math.ceil(sx1));
      let sumR = 0;
      let sumG = 0;
      let sumB = 0;
      let totalWeight = 0;
      for (let sy = iy0; sy < iy1; sy += 1) {
        const wy = Math.max(0, Math.min(sy + 1, sy1) - Math.max(sy, sy0));
        if (!(wy > 0)) continue;
        for (let sx = ix0; sx < ix1; sx += 1) {
          const wx = Math.max(0, Math.min(sx + 1, sx1) - Math.max(sx, sx0));
          const area = wx * wy;
          if (!(area > 0)) continue;
          const sourceIndex = (sy * sourceW + sx) * 3;
          sumR += decodeStoredRgb16Channel(decoded.data[sourceIndex] ?? 0, decoded.transfer, decoded.linearRangeMax) * area;
          sumG += decodeStoredRgb16Channel(decoded.data[sourceIndex + 1] ?? 0, decoded.transfer, decoded.linearRangeMax) * area;
          sumB += decodeStoredRgb16Channel(decoded.data[sourceIndex + 2] ?? 0, decoded.transfer, decoded.linearRangeMax) * area;
          totalWeight += area;
        }
      }
      const invWeight = totalWeight > 0 ? 1 / totalWeight : 0;
      const targetIndex = (y * sampleW + x) * 3;
      output[targetIndex] = sumR * invWeight;
      output[targetIndex + 1] = sumG * invWeight;
      output[targetIndex + 2] = sumB * invWeight;
    }
    if ((y & 15) === 15 && y + 1 < sampleH) {
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
    }
  }
  return { data: output, width: sampleW, height: sampleH };
}

function createDefringeWorker(): Worker | null {
  if (typeof Worker !== "function") return null;
  try {
    return new Worker(new URL("./image-editor/defringe.worker.ts", import.meta.url), { type: "module" });
  } catch {
    return null;
  }
}

function analyzeDefringeSampleAsync(sample: LinearRgbSample): Promise<DefringeAnalysisMap> {
  const worker = createDefringeWorker();
  if (!worker) return Promise.resolve(analyzeDefringeSample(sample));
  const data = sample.data;
  return new Promise<DefringeAnalysisMap>((resolve, reject) => {
    const cleanup = () => worker.terminate();
    worker.onmessage = (event: MessageEvent) => {
      const response = event.data as {
        type?: string;
        message?: string;
        width?: number;
        height?: number;
        magentaBuffer?: ArrayBuffer;
        greenBuffer?: ArrayBuffer;
        magentaExpanded1Buffer?: ArrayBuffer;
        greenExpanded1Buffer?: ArrayBuffer;
        magentaExpanded2Buffer?: ArrayBuffer;
        greenExpanded2Buffer?: ArrayBuffer;
      };
      if (response.type === "error") {
        cleanup();
        reject(new Error(response.message || "Defringe analysis failed"));
        return;
      }
      if (response.type !== "complete" || !response.magentaBuffer || !response.greenBuffer) return;
      cleanup();
      resolve({
        width: Math.max(1, Math.round(response.width ?? sample.width)),
        height: Math.max(1, Math.round(response.height ?? sample.height)),
        magenta: new Uint8Array(response.magentaBuffer),
        green: new Uint8Array(response.greenBuffer),
        ...(response.magentaExpanded1Buffer
          ? { magentaExpanded1: new Uint8Array(response.magentaExpanded1Buffer) }
          : {}),
        ...(response.greenExpanded1Buffer
          ? { greenExpanded1: new Uint8Array(response.greenExpanded1Buffer) }
          : {}),
        ...(response.magentaExpanded2Buffer
          ? { magentaExpanded2: new Uint8Array(response.magentaExpanded2Buffer) }
          : {}),
        ...(response.greenExpanded2Buffer
          ? { greenExpanded2: new Uint8Array(response.greenExpanded2Buffer) }
          : {}),
      });
    };
    worker.onerror = (event) => {
      cleanup();
      reject(new Error(event.message || "Defringe analysis worker failed"));
    };
    worker.postMessage(
      { dataBuffer: data.buffer, width: sample.width, height: sample.height },
      [data.buffer],
    );
  });
}

function createRawDevelopmentWorker(): Worker | null {
  if (typeof Worker !== "function") return null;
  try {
    return new Worker(new URL("./image-editor/raw-development.worker.ts", import.meta.url), {
      type: "module",
    });
  } catch {
    return null;
  }
}

function requestRawDevelopmentWorker<T extends { type: string }>(
  worker: Worker,
  expectedType: T["type"],
  message: unknown,
  transfer: Transferable[] = [],
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const cleanup = () => {
      worker.removeEventListener("message", onMessage);
      worker.removeEventListener("error", onError);
      worker.removeEventListener("messageerror", onMessageError);
    };
    const onMessage = (event: MessageEvent) => {
      const response = event.data as {
        type?: string;
        message?: string;
        dataBuffer?: ArrayBuffer;
        linearRangeMax?: number;
        transfer?: DecodedRgbImage16["transfer"];
      };
      if (response?.type === "error") {
        cleanup();
        const error = new Error(response.message || "RAW development worker failed") as RawDevelopmentWorkerError;
        error.dataBuffer = response.dataBuffer;
        error.linearRangeMax = response.linearRangeMax;
        error.transfer = response.transfer;
        reject(error);
        return;
      }
      if (response?.type !== expectedType) return;
      cleanup();
      resolve(event.data as T);
    };
    const onError = (event: ErrorEvent) => {
      cleanup();
      reject(new Error(event.message || "RAW development worker failed"));
    };
    const onMessageError = () => {
      cleanup();
      reject(new Error("RAW development worker communication failed"));
    };
    worker.addEventListener("message", onMessage);
    worker.addEventListener("error", onError);
    worker.addEventListener("messageerror", onMessageError);
    worker.postMessage(message, transfer);
  });
}

function rawLensfunCorrectionMaps(
  correction: LensfunCorrection | undefined,
): RawLensfunCorrectionMaps | undefined {
  if (!correction) return undefined;
  return {
    gridWidth: correction.gridWidth,
    gridHeight: correction.gridHeight,
    step: correction.step,
    geometry: correction.geometry,
    distortion: correction.distortion,
    ...(correction.autoCrop ? { crop: correction.autoCrop } : {}),
    ...(correction.combined ? { combined: correction.combined } : {}),
    ...(correction.tca ? { tca: correction.tca } : {}),
    ...(correction.vignetting ? { vignetting: correction.vignetting } : {}),
    ...(correction.vignettingBaked ? { vignettingBaked: true } : {}),
  };
}

function rawLensfunMapTransferables(correction: LensfunCorrection | undefined): Transferable[] {
  if (!correction) return [];
  const buffers = [
    correction.geometry.buffer,
    correction.combined?.buffer,
    correction.tca?.buffer,
    correction.vignetting?.buffer,
  ];
  const unique = new Set<ArrayBuffer>();
  for (const buffer of buffers) {
    if (buffer instanceof ArrayBuffer) unique.add(buffer);
  }
  return Array.from(unique);
}

const RAW_MASTER_ONE_PASS_MAX_WORKERS = 4;
const RAW_DENOISE_MERGE_MAX_WORKERS = 4;
const RAW_DENOISE_MERGE_CHUNK_ROWS = 128;

function sharedFloat32Copy(source: Float32Array | undefined): Float32Array | undefined {
  if (!source) return undefined;
  const buffer = new SharedArrayBuffer(source.byteLength);
  const output = new Float32Array(buffer);
  output.set(source);
  return output;
}

function sharedRawLensfunCorrectionMaps(
  correction: RawLensfunCorrectionMaps | undefined,
): RawLensfunCorrectionMaps | undefined {
  if (!correction) return undefined;
  const geometry = sharedFloat32Copy(correction.geometry);
  if (!geometry) return undefined;
  const combined = sharedFloat32Copy(correction.combined);
  const tca = sharedFloat32Copy(correction.tca);
  const vignetting = sharedFloat32Copy(correction.vignetting);
  return {
    gridWidth: correction.gridWidth,
    gridHeight: correction.gridHeight,
    step: correction.step,
    geometry,
    distortion: correction.distortion,
    ...(correction.crop ? { crop: correction.crop } : {}),
    ...(combined ? { combined } : {}),
    ...(tca ? { tca } : {}),
    ...(vignetting ? { vignetting } : {}),
    ...(correction.vignettingBaked ? { vignettingBaked: true } : {}),
  };
}

function mergeRawHeadroomStatistics(
  parts: Array<RawDevelopmentHeadroomStatistics | undefined>,
): RawDevelopmentHeadroomStatistics | undefined {
  const first = parts.find((part): part is RawDevelopmentHeadroomStatistics => Boolean(part));
  if (!first) return undefined;
  const bins = new Array<number>(first.bins.length).fill(0);
  let overflowCount = 0;
  let pixelCount = 0;
  let maxRgb = 0;
  for (const part of parts) {
    if (!part) continue;
    for (let i = 0; i < bins.length; i++) bins[i] += part.bins[i] ?? 0;
    overflowCount += part.overflowCount;
    pixelCount += part.pixelCount;
    maxRgb = Math.max(maxRgb, part.maxRgb);
  }
  return {
    step: first.step,
    histogramMax: first.histogramMax,
    bins,
    overflowCount,
    pixelCount,
    maxRgb,
  };
}

function rawPreviewDimensions(width: number, height: number): { width: number; height: number } {
  return analysisSampleDimensions(width, height, RAW_EDITOR_PREVIEW_TARGET_PIXELS);
}

type RawDenoiseAnalysisInput = {
  width: number;
  height: number;
  linearRangeMax: number;
  transfer: DecodedRgbImage16["transfer"];
  data: Uint16Array;
};

type RawDenoiseAnalysisResult = Omit<RawWorkerDenoiseAnalyzeResponse, "type" | "weightBuffer"> & {
  weightMap: RawDenoiseWeightMap;
};

function buildRawDenoiseAnalysisInput(preview: DecodedRgbImage16): RawDenoiseAnalysisInput {
  const dimensions = analysisSampleDimensions(
    preview.width,
    preview.height,
    RAW_EDITOR_PREVIEW_TARGET_PIXELS,
  );
  const data = new Uint16Array(dimensions.width * dimensions.height * 3);
  let targetIndex = 0;
  for (let y = 0; y < dimensions.height; y++) {
    const sy = Math.min(
      preview.height - 1,
      Math.max(0, Math.floor((y + 0.5) * preview.height / dimensions.height)),
    );
    for (let x = 0; x < dimensions.width; x++, targetIndex += 3) {
      const sx = Math.min(
        preview.width - 1,
        Math.max(0, Math.floor((x + 0.5) * preview.width / dimensions.width)),
      );
      const sourceIndex = (sy * preview.width + sx) * 3;
      data[targetIndex] = preview.data[sourceIndex] ?? 0;
      data[targetIndex + 1] = preview.data[sourceIndex + 1] ?? 0;
      data[targetIndex + 2] = preview.data[sourceIndex + 2] ?? 0;
    }
  }
  return {
    width: dimensions.width,
    height: dimensions.height,
    linearRangeMax: preview.linearRangeMax,
    transfer: preview.transfer,
    data,
  };
}

async function analyzeRawDenoiseInWorker(
  preview: DecodedRgbImage16,
  iso?: number | null,
): Promise<RawDenoiseAnalysisResult> {
  // Build the same <=1 MP nearest-neighbour sample used by Denoise analysis,
  // but keep it only for this operation.
  const input = buildRawDenoiseAnalysisInput(preview);
  const worker = createRawDevelopmentWorker();
  if (!worker) {
    const analysis = analyzeRawDenoiseMask(
      input.data,
      input.width,
      input.height,
      input.linearRangeMax,
      input.transfer,
      iso,
    );
    return {
      width: analysis.width,
      height: analysis.height,
      smoothMean: analysis.smoothMean,
      smoothStddev: analysis.smoothStddev,
      shadowMean: analysis.shadowMean,
      shadowStddev: analysis.shadowStddev,
      weightMean: analysis.weightMean,
      weightStddev: analysis.weightStddev,
      weightP50: analysis.weightP50,
      weightP90: analysis.weightP90,
      weightP99: analysis.weightP99,
      weightMap: {
        width: analysis.width,
        height: analysis.height,
        data: analysis.weight,
      },
    };
  }

  // Transfer this sole temporary sample to the worker immediately. Unlike the
  // old debug path there is no retained copy and no second .slice().
  const dataBuffer = input.data.buffer as ArrayBuffer;
  try {
    const response = await requestRawDevelopmentWorker<RawWorkerDenoiseAnalyzeResponse>(
      worker,
      "denoise-analyze-complete",
      {
        type: "denoise-analyze",
        dataBuffer,
        width: input.width,
        height: input.height,
        sourceLinearRangeMax: input.linearRangeMax,
        sourceTransfer: input.transfer,
        iso,
      },
      [dataBuffer],
    );
    return {
      width: response.width,
      height: response.height,
      smoothMean: response.smoothMean,
      smoothStddev: response.smoothStddev,
      shadowMean: response.shadowMean,
      shadowStddev: response.shadowStddev,
      weightMean: response.weightMean,
      weightStddev: response.weightStddev,
      weightP50: response.weightP50,
      weightP90: response.weightP90,
      weightP99: response.weightP99,
      weightMap: {
        width: response.width,
        height: response.height,
        data: new Float32Array(response.weightBuffer),
      },
    };
  } finally {
    worker.terminate();
  }
}


async function mergeRawMasterIntoDenoiseInPlace(
  master: DecodedRgbImage16,
  denoise: DecodedRgbImage16,
  weightMap: RawDenoiseWeightMap,
  shouldCancel: () => boolean,
): Promise<boolean> {
  if (
    master.width !== denoise.width ||
    master.height !== denoise.height ||
    master.transfer !== "gamma20" ||
    denoise.transfer !== "gamma20" ||
    master.linearRangeMax !== denoise.linearRangeMax
  ) {
    throw new Error("RAW denoise merge inputs do not match Master");
  }
  if (
    weightMap.width <= 0 ||
    weightMap.height <= 0 ||
    weightMap.data.length < weightMap.width * weightMap.height
  ) {
    throw new Error("RAW denoise weight map is invalid");
  }
  if (shouldCancel()) return false;

  const width = master.width;
  const height = master.height;
  const hardwareConcurrency = typeof navigator === "object"
    ? Math.max(1, Math.floor(navigator.hardwareConcurrency || RAW_DENOISE_MERGE_MAX_WORKERS))
    : RAW_DENOISE_MERGE_MAX_WORKERS;

  if (
    typeof Worker === "function"
    && typeof SharedArrayBuffer === "function"
    && globalThis.crossOriginIsolated === true
    && master.data.buffer instanceof SharedArrayBuffer
    && denoise.data.buffer instanceof SharedArrayBuffer
  ) {
    const workerCount = Math.min(RAW_DENOISE_MERGE_MAX_WORKERS, hardwareConcurrency, height);
    const workers: Worker[] = [];
    let workersReady = true;
    for (let i = 0; i < workerCount; i++) {
      const worker = createRawDevelopmentWorker();
      if (!worker) {
        workersReady = false;
        break;
      }
      workers.push(worker);
    }

    if (workersReady && workers.length === workerCount) {
      const sharedWeightBuffer = new SharedArrayBuffer(weightMap.data.byteLength);
      new Float32Array(sharedWeightBuffer).set(weightMap.data);
      try {
        await Promise.all(workers.map((worker, workerIndex) => {
          const rowStart = Math.floor(height * workerIndex / workerCount);
          const rowEnd = Math.floor(height * (workerIndex + 1) / workerCount);
          return requestRawDevelopmentWorker<RawWorkerDenoiseMergeSharedResponse>(
            worker,
            "denoise-merge-shared-complete",
            {
              type: "denoise-merge-shared",
              masterBuffer: master.data.buffer as SharedArrayBuffer,
              denoiseBuffer: denoise.data.buffer as SharedArrayBuffer,
              weightBuffer: sharedWeightBuffer,
              width,
              height,
              weightWidth: weightMap.width,
              weightHeight: weightMap.height,
              rowStart,
              rowEnd,
              workerIndex,
            },
          );
        }));
        return !shouldCancel();
      } finally {
        for (const worker of workers) worker.terminate();
      }
    }

    for (const worker of workers) worker.terminate();
  }

  const worker = createRawDevelopmentWorker();
  if (worker) {
    let completedRow = 0;
    try {
      const weightCopy = weightMap.data.slice();
      const weightBuffer = weightCopy.buffer as ArrayBuffer;
      await requestRawDevelopmentWorker<RawWorkerDenoiseMergeReadyResponse>(
        worker,
        "denoise-merge-ready",
        {
          type: "denoise-merge-init",
          weightBuffer,
          weightWidth: weightMap.width,
          weightHeight: weightMap.height,
          imageWidth: width,
          imageHeight: height,
        },
        [weightBuffer],
      );

      const rowStride = width * 3;
      for (let startRow = 0; startRow < height; startRow += RAW_DENOISE_MERGE_CHUNK_ROWS) {
        if (shouldCancel()) return false;
        const endRow = Math.min(height, startRow + RAW_DENOISE_MERGE_CHUNK_ROWS);
        const startIndex = startRow * rowStride;
        const endIndex = endRow * rowStride;
        const masterChunk = master.data.slice(startIndex, endIndex);
        const denoiseChunk = denoise.data.slice(startIndex, endIndex);
        const masterBuffer = masterChunk.buffer as ArrayBuffer;
        const denoiseBuffer = denoiseChunk.buffer as ArrayBuffer;
        const response = await requestRawDevelopmentWorker<RawWorkerDenoiseMergeChunkResponse>(
          worker,
          "denoise-merge-chunk-complete",
          {
            type: "denoise-merge-chunk",
            masterBuffer,
            denoiseBuffer,
            rowStart: startRow,
          },
          [masterBuffer, denoiseBuffer],
        );
        if (shouldCancel()) return false;
        denoise.data.set(new Uint16Array(response.denoiseBuffer), startIndex);
        completedRow = endRow;
      }
      return !shouldCancel();
    } catch {
      // Temporary chunks are transferred, never the live Master/Denoise buffers.
      // Rows already committed are complete, so a worker failure can safely
      // continue on the main thread from the first uncommitted row.
      const rowsPerChunk = 32;
      for (let startRow = completedRow; startRow < height; startRow += rowsPerChunk) {
        if (shouldCancel()) return false;
        mergeRawDenoiseGamma20InPlaceRows(
          master.data,
          denoise.data,
          width,
          height,
          weightMap.data,
          weightMap.width,
          weightMap.height,
          startRow,
          Math.min(height, startRow + rowsPerChunk),
        );
        if (startRow + rowsPerChunk < height) {
          await new Promise<void>((resolve) => setTimeout(resolve, 0));
        }
      }
      return !shouldCancel();
    } finally {
      worker.terminate();
    }
  }

  const rowsPerChunk = 32;
  for (let startRow = 0; startRow < height; startRow += rowsPerChunk) {
    if (shouldCancel()) return false;
    mergeRawDenoiseGamma20InPlaceRows(
      master.data,
      denoise.data,
      width,
      height,
      weightMap.data,
      weightMap.width,
      weightMap.height,
      startRow,
      Math.min(height, startRow + rowsPerChunk),
    );
    if (startRow + rowsPerChunk < height) {
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
    }
  }
  return !shouldCancel();
}


function imageEditPreviewDimensions(
  sourceWidth: number,
  sourceHeight: number,
  maxRasterWidth: number,
  maxRasterHeight: number,
): { width: number; height: number } {
  const sourceW = Math.max(1, Math.round(Number.isFinite(sourceWidth) ? sourceWidth : 1));
  const sourceH = Math.max(1, Math.round(Number.isFinite(sourceHeight) ? sourceHeight : 1));
  const sourcePixels = sourceW * sourceH;
  const pixelBudgetScale = sourcePixels > RAW_EDITOR_PREVIEW_TARGET_PIXELS
    ? Math.sqrt(RAW_EDITOR_PREVIEW_TARGET_PIXELS / sourcePixels)
    : 1;
  const budgetWidth = Math.max(1, Math.floor(sourceW * pixelBudgetScale));
  const budgetHeight = Math.max(1, Math.floor(sourceH * pixelBudgetScale));
  const rasterW = Math.max(1, Math.floor(Number.isFinite(maxRasterWidth) && maxRasterWidth > 0 ? maxRasterWidth : 1));
  const rasterH = Math.max(1, Math.floor(Number.isFinite(maxRasterHeight) && maxRasterHeight > 0 ? maxRasterHeight : 1));
  const fitScale = Math.min(1, rasterW / budgetWidth, rasterH / budgetHeight);
  return {
    width: Math.max(1, Math.floor(budgetWidth * fitScale)),
    height: Math.max(1, Math.floor(budgetHeight * fitScale)),
  };
}

async function resampleRawDecodedInWorker(
  decoded: DecodedRgbImage16,
  targetWidth: number,
  targetHeight: number,
  outputCrop?: RawOutputCrop,
): Promise<DecodedRgbImage16> {
  const correction = decoded.lensCorrection;
  const correctionMaps = rawLensfunCorrectionMaps(correction);
  const worker = createRawDevelopmentWorker();
  if (!worker) {
    const output = resampleRawWithLensfunToGamma20(
      decoded.data,
      decoded.width,
      decoded.height,
      decoded.linearRangeMax,
      decoded.transfer,
      correctionMaps,
      outputCrop,
      targetWidth,
      targetHeight,
    );
    return {
      colorSpace: "prophoto",
      transfer: "gamma20",
      linearRangeMax: RAW_DEVELOPED_LINEAR_RANGE_MAX,
      width: Math.max(1, Math.round(targetWidth)),
      height: Math.max(1, Math.round(targetHeight)),
      data: output,
      cleanup: () => {},
    };
  }
  const sourceBuffer = decoded.data.buffer as ArrayBuffer;
  try {
    const response = await requestRawDevelopmentWorker<RawWorkerLensfunResampleResponse>(
      worker,
      "lensfun-resample-complete",
      {
        type: "lensfun-resample",
        dataBuffer: sourceBuffer,
        width: decoded.width,
        height: decoded.height,
        sourceLinearRangeMax: decoded.linearRangeMax,
        sourceTransfer: decoded.transfer,
        correction: correctionMaps,
        outputCrop,
        targetWidth,
        targetHeight,
      },
      [sourceBuffer, ...rawLensfunMapTransferables(correction)],
    );
    return {
      colorSpace: "prophoto",
      transfer: "gamma20",
      linearRangeMax: response.linearRangeMax,
      width: response.width,
      height: response.height,
      data: new Uint16Array(response.dataBuffer),
      cleanup: () => {},
    };
  } finally {
    worker.terminate();
  }
}

async function developRawMasterOnePassInWorker(
  sourceDecoded: DecodedRgbImage16,
  plan: RawProgressiveDevelopmentPlan,
  outputCrop?: RawOutputCrop,
): Promise<{ decoded: DecodedRgbImage16; headroom?: RawDevelopmentHeadroomStatistics }> {
  const correction = sourceDecoded.lensCorrection;
  const correctionMaps = rawLensfunCorrectionMaps(correction);

  if (
    typeof Worker === "function"
    && typeof SharedArrayBuffer === "function"
    && globalThis.crossOriginIsolated === true
  ) {
    const outputDimensions = rawLensfunOutputDimensions(
      sourceDecoded.width,
      sourceDecoded.height,
      correctionMaps,
      outputCrop,
    );
    const hardwareConcurrency = typeof navigator === "object"
      ? Math.max(1, Math.floor(navigator.hardwareConcurrency || RAW_MASTER_ONE_PASS_MAX_WORKERS))
      : RAW_MASTER_ONE_PASS_MAX_WORKERS;
    const workerCount = Math.min(
      RAW_MASTER_ONE_PASS_MAX_WORKERS,
      hardwareConcurrency,
      outputDimensions.height,
    );

    if (workerCount >= 2) {
      const workers: Worker[] = [];
      try {
        for (let i = 0; i < workerCount; i++) {
          const worker = createRawDevelopmentWorker();
          if (!worker) throw new Error("Unable to create RAW master development worker");
          workers.push(worker);
        }

        const sharedSourceBuffer = new SharedArrayBuffer(sourceDecoded.data.byteLength);
        new Uint16Array(sharedSourceBuffer).set(sourceDecoded.data);
        const sharedOutputBuffer = new SharedArrayBuffer(
          outputDimensions.width * outputDimensions.height * 3 * Uint16Array.BYTES_PER_ELEMENT,
        );
        const sharedCorrection = sharedRawLensfunCorrectionMaps(correctionMaps);

        const responses = await Promise.all(workers.map((worker, workerIndex) => {
          const rowStart = Math.floor(outputDimensions.height * workerIndex / workerCount);
          const rowEnd = Math.floor(outputDimensions.height * (workerIndex + 1) / workerCount);
          return requestRawDevelopmentWorker<RawWorkerMasterOnePassSharedResponse>(
            worker,
            "master-one-pass-shared-complete",
            {
              type: "master-one-pass-shared",
              dataBuffer: sharedSourceBuffer,
              outputBuffer: sharedOutputBuffer,
              width: sourceDecoded.width,
              height: sourceDecoded.height,
              sourceLinearRangeMax: sourceDecoded.linearRangeMax,
              sourceTransfer: sourceDecoded.transfer,
              correction: sharedCorrection,
              outputCrop,
              tonePlan: plan.tonePlan,
              fallbackPlan: plan.fallbackPlan,
              colorPlan: plan.colorPlan,
              rowStart,
              rowEnd,
              workerIndex,
            },
          );
        }));

        return {
          decoded: {
            colorSpace: "prophoto",
            transfer: "gamma20",
            linearRangeMax: RAW_DEVELOPED_LINEAR_RANGE_MAX,
            width: outputDimensions.width,
            height: outputDimensions.height,
            data: new Uint16Array(sharedOutputBuffer),
            cleanup: () => {},
          },
          headroom: mergeRawHeadroomStatistics(responses.map((response) => response.headroom)),
        };
      } catch {
        // Keep the established single-worker path as a compatibility fallback.
        // The original buffers have not been transferred, so it remains safe.
      } finally {
        for (const worker of workers) worker.terminate();
      }
    }
  }

  const worker = createRawDevelopmentWorker();
  if (!worker) {
    const result = developRawMasterOnePassToGamma20(
      sourceDecoded.data,
      sourceDecoded.width,
      sourceDecoded.height,
      sourceDecoded.linearRangeMax,
      sourceDecoded.transfer,
      correctionMaps,
      outputCrop,
      plan.tonePlan,
      plan.fallbackPlan,
      plan.colorPlan,
    );
    return {
      decoded: {
        colorSpace: "prophoto",
        transfer: "gamma20",
        linearRangeMax: RAW_DEVELOPED_LINEAR_RANGE_MAX,
        width: result.width,
        height: result.height,
        data: result.data,
        cleanup: () => {},
      },
      headroom: result.headroom,
    };
  }

  const sourceBuffer = sourceDecoded.data.buffer as ArrayBuffer;
  try {
    const response = await requestRawDevelopmentWorker<RawWorkerMasterOnePassResponse>(
      worker,
      "master-one-pass-complete",
      {
        type: "master-one-pass",
        dataBuffer: sourceBuffer,
        width: sourceDecoded.width,
        height: sourceDecoded.height,
        sourceLinearRangeMax: sourceDecoded.linearRangeMax,
        sourceTransfer: sourceDecoded.transfer,
        correction: correctionMaps,
        outputCrop,
        tonePlan: plan.tonePlan,
        fallbackPlan: plan.fallbackPlan,
        colorPlan: plan.colorPlan,
      },
      [sourceBuffer, ...rawLensfunMapTransferables(correction)],
    );
    return {
      decoded: {
        colorSpace: "prophoto",
        transfer: response.transfer,
        linearRangeMax: response.linearRangeMax,
        width: response.width,
        height: response.height,
        data: new Uint16Array(response.dataBuffer),
        cleanup: () => {},
      },
      headroom: response.headroom,
    };
  } finally {
    worker.terminate();
  }
}

function developRawPreviewPixelsSync(
  decoded: DecodedRgbImage16,
  thumbnailReference: RawThumbnailMatchReference | undefined,
  timing: RawDevelopmentTiming,
): RawProgressiveDevelopmentPlan {
  let mode: RawDevelopmentSettings["mode"] = "fallback";
  let luminance: RawDevelopmentLuminanceSettings | null = null;
  let headroom: RawDevelopmentHeadroomStatistics | undefined;
  let saturation: RawDevelopmentSaturationSettings = { saturation: 0, vibrance: 0 };
  let tonePlan: RawMatchedTonePlan | undefined;
  let fallbackPlan: RawFallbackPlan | undefined;
  let colorPlan: RawColorPassPlan | undefined;

  const matched = thumbnailReference
    ? planRawThumbnailMatchedBaseline(decoded, thumbnailReference.lumaPercentiles)
    : null;
  if (matched) {
    tonePlan = matched.plan;
    headroom = applyRawMatchedTonePass(
      decoded.data,
      decoded.width,
      decoded.height,
      decoded.linearRangeMax,
      undefined,
      tonePlan,
      decoded.transfer,
    );
    decoded.linearRangeMax = RAW_DEVELOPED_LINEAR_RANGE_MAX;
    decoded.transfer = "gamma20";
    mode = "thumbnail-match";
    luminance = matched.luminance;

    const rawColorSample = sampleRawThumbnailMatchLinearRgbFromRgb16(decoded);
    const rawColorSampleDimensions = analysisSampleDimensions(
      decoded.width,
      decoded.height,
      RAW_THUMBNAIL_MATCH_SAMPLE_TARGET_PIXELS,
    );
    const plannedColor = planRawThumbnailMatchedColor(
      rawColorSample,
      rawColorSampleDimensions.width,
      rawColorSampleDimensions.height,
      thumbnailReference!.linearSrgbSample,
      thumbnailReference!.colorTargets,
    );
    if (plannedColor) {
      saturation = plannedColor.settings;
      colorPlan = plannedColor.pass ?? undefined;
      if (colorPlan) applyRawColorPass(decoded.data, decoded.linearRangeMax, colorPlan);
    }
  } else {
    const fallback = applyRawFallbackBaselinePass(
      decoded.data,
      decoded.width,
      decoded.height,
      decoded.linearRangeMax,
      undefined,
      decoded.transfer,
    );
    if (fallback) {
      fallbackPlan = fallback.plan;
      headroom = fallback.headroom;
      decoded.linearRangeMax = RAW_DEVELOPED_LINEAR_RANGE_MAX;
      decoded.transfer = "gamma20";
      luminance = {
        exposureEv: fallback.exposureEv,
        logarithm: 0,
        sigmoid: 0,
        toneSlopeAtWhite: 1,
      };
    }
  }

  return {
    mode,
    luminance,
    headroom,
    saturation,
    timing,
    ...(tonePlan ? { tonePlan } : {}),
    ...(fallbackPlan ? { fallbackPlan } : {}),
    ...(colorPlan ? { colorPlan } : {}),
  };
}


async function developRawPreviewPixels(
  decoded: DecodedRgbImage16,
  thumbnailReference: RawThumbnailMatchReference | undefined,
  timing: RawDevelopmentTiming,
  onProgress?: ImageLoadProgressListener,
): Promise<RawProgressiveDevelopmentPlan> {
  const worker = createRawDevelopmentWorker();
  if (!worker) return developRawPreviewPixelsSync(decoded, thumbnailReference, timing);

  const stage = async <T,>(name: string, task: () => Promise<T>): Promise<T> => {
    onProgress?.({ stage: name, rawTiming: timing });
    if (onProgress) await new Promise<void>((resolve) => setTimeout(resolve, 0));
    return measureRawTiming(timing, "preview", name.replace(/…$/, ""), task);
  };

  let transferred = false;
  try {
    onProgress?.({ stage: "Planning RAW preview tone…", rawTiming: timing });
    if (onProgress) await new Promise<void>((resolve) => setTimeout(resolve, 0));
    const matched = await measureRawTiming(timing, "preview", "Planning RAW preview tone", () =>
      thumbnailReference
        ? planRawThumbnailMatchedBaseline(decoded, thumbnailReference.lumaPercentiles)
        : null,
    );
    let plan: RawProgressiveDevelopmentPlan;

    if (matched) {
      const sourceBuffer = decoded.data.buffer as ArrayBuffer;
      const toneResponse = await stage<RawWorkerToneResponse>("Developing RAW preview tone…", () => {
        transferred = true;
        return requestRawDevelopmentWorker<RawWorkerToneResponse>(
          worker,
          "tone-complete",
          {
            type: "matched-tone",
            dataBuffer: sourceBuffer,
            width: decoded.width,
            height: decoded.height,
            sourceLinearRangeMax: decoded.linearRangeMax,
            sourceTransfer: decoded.transfer,
            plan: matched.plan,
            sampleTargetPixels: RAW_THUMBNAIL_MATCH_SAMPLE_TARGET_PIXELS,
          },
          [sourceBuffer],
        );
      });
      decoded.linearRangeMax = RAW_DEVELOPED_LINEAR_RANGE_MAX;
      decoded.transfer = "gamma20";

      const rawColorSample = new Float32Array(toneResponse.colorSample);
      const rawColorSampleDimensions = analysisSampleDimensions(
        decoded.width,
        decoded.height,
        RAW_THUMBNAIL_MATCH_SAMPLE_TARGET_PIXELS,
      );
      onProgress?.({ stage: "Planning RAW preview color…", rawTiming: timing });
      if (onProgress) await new Promise<void>((resolve) => setTimeout(resolve, 0));
      const plannedColor = await measureRawTiming(timing, "preview", "Planning RAW preview color", () =>
        planRawThumbnailMatchedColor(
          rawColorSample,
          rawColorSampleDimensions.width,
          rawColorSampleDimensions.height,
          thumbnailReference!.linearSrgbSample,
          thumbnailReference!.colorTargets,
        ),
      );
      if (plannedColor?.pass) {
        await stage<RawWorkerColorResponse>("Developing RAW preview color…", () =>
          requestRawDevelopmentWorker<RawWorkerColorResponse>(
            worker,
            "color-complete",
            { type: "color", plan: plannedColor.pass! },
          ),
        );
      }
      plan = {
        mode: "thumbnail-match",
        luminance: matched.luminance,
        headroom: toneResponse.headroom,
        saturation: plannedColor?.settings ?? { saturation: 0, vibrance: 0 },
        timing,
        tonePlan: matched.plan,
        ...(plannedColor?.pass ? { colorPlan: plannedColor.pass } : {}),
      };
    } else {
      const sourceBuffer = decoded.data.buffer as ArrayBuffer;
      const fallbackResponse = await stage<RawWorkerFallbackResponse>("Developing RAW preview tone…", () => {
        transferred = true;
        return requestRawDevelopmentWorker<RawWorkerFallbackResponse>(
          worker,
          "fallback-tone-complete",
          {
            type: "fallback-tone",
            dataBuffer: sourceBuffer,
            width: decoded.width,
            height: decoded.height,
            sourceLinearRangeMax: decoded.linearRangeMax,
            sourceTransfer: decoded.transfer,
          },
          [sourceBuffer],
        );
      });
      const fallback = fallbackResponse.result;
      if (fallback) {
        decoded.linearRangeMax = RAW_DEVELOPED_LINEAR_RANGE_MAX;
        decoded.transfer = "gamma20";
        plan = {
          mode: "fallback",
          luminance: {
            exposureEv: fallback.exposureEv,
            logarithm: 0,
            sigmoid: 0,
            toneSlopeAtWhite: 1,
          },
          headroom: fallback.headroom,
          saturation: { saturation: 0, vibrance: 0 },
          timing,
          fallbackPlan: fallback.plan,
        };
      } else {
        plan = {
          mode: "fallback",
          luminance: null,
          saturation: { saturation: 0, vibrance: 0 },
          timing,
        };
      }
    }

    const encodeResponse = await stage<RawWorkerEncodeResponse>("Encoding RAW preview gamma2 buffer…", () =>
      requestRawDevelopmentWorker<RawWorkerEncodeResponse>(
        worker,
        "encode-complete",
        { type: "encode" },
      ),
    );
    decoded.data = new Uint16Array(encodeResponse.dataBuffer);
    decoded.linearRangeMax = encodeResponse.linearRangeMax;
    decoded.transfer = "gamma20";
    transferred = false;
    return plan;
  } catch (error) {
    const workerError = error as RawDevelopmentWorkerError;
    if (workerError.dataBuffer) {
      decoded.data = new Uint16Array(workerError.dataBuffer);
      if (Number.isFinite(workerError.linearRangeMax)) {
        decoded.linearRangeMax = workerError.linearRangeMax as number;
      }
      if (workerError.transfer === "linear" || workerError.transfer === "gamma20") {
        decoded.transfer = workerError.transfer;
      }
    }
    if (!transferred) return developRawPreviewPixelsSync(decoded, thumbnailReference, timing);
    throw error;
  } finally {
    worker.terminate();
  }
}

async function decodeRawPreviewImage(
  file: File,
  timing: RawDevelopmentTiming,
  rawHighlightMode?: RawHighlightMode,
  onProgress?: ImageLoadProgressListener,
): Promise<RawPreviewDevelopmentResult> {
  async function runStage<T>(stage: string, task: () => Promise<T>): Promise<T> {
    onProgress?.({ stage, rawTiming: timing });
    return measureRawTiming(timing, "preview", stage.replace(/…$/, ""), task);
  }
  async function runBlockingStage<T>(stage: string, task: () => T): Promise<T> {
    onProgress?.({ stage, rawTiming: timing });
    if (onProgress) await new Promise<void>((resolve) => setTimeout(resolve, 0));
    return measureRawTiming(timing, "preview", stage.replace(/…$/, ""), task);
  }

  let raw: LibRawInstanceLike | null = null;
  let workerFailure: ReturnType<typeof createLibRawWorkerFailure> | null = null;
  try {
    raw = await runStage("Loading RAW preview decoder…", () => createLibRawInstance());
    workerFailure = createLibRawWorkerFailure(raw);
    const rawBytes = await runStage("Reading RAW for preview…", async () =>
      new Uint8Array(await file.arrayBuffer()),
    );
    const settings: LibRawSettingsLike = {
      ...RAW_DECODE_SETTINGS,
      userQual: RAW_PREVIEW_DEMOSAIC_QUALITY,
      ...(rawHighlightMode === undefined ? {} : { highlight: rawHighlightMode }),
    };
    await runStage("Opening RAW preview…", () => Promise.race([
      raw!.open(rawBytes, settings),
      workerFailure!.promise,
    ]));
    const metadata = await runStage("Reading preview metadata…", () => Promise.race([
      raw!.metadata(true),
      workerFailure!.promise,
    ]));
    const isoValue = Number(metadata?.iso_speed);

    let thumbnailReferencePromise: Promise<RawThumbnailMatchReference | undefined> = Promise.resolve(undefined);
    if (RAW_USE_THUMBNAIL && raw.thumbnailData) {
      try {
        const thumbnail = await runStage("Reading embedded thumbnail…", () => Promise.race([
          raw!.thumbnailData!(),
          workerFailure!.promise,
        ]));
        const embeddedPreviewBase = await runStage(
          "Preparing embedded thumbnail display…",
          () => rawEmbeddedPreviewFromThumbnail(thumbnail),
        );
        const metadataGeometry = rawGeometryFromMetadata(metadata);
        const insetPreviewCrop = metadataGeometry?.insetCrops[0];
        const metadataWidth = insetPreviewCrop?.width
          ?? Math.max(0, Math.round(Number(metadata?.width ?? 0)));
        const metadataHeight = insetPreviewCrop?.height
          ?? Math.max(0, Math.round(Number(metadata?.height ?? 0)));
        const embeddedPreview = embeddedPreviewBase
          ? {
              ...embeddedPreviewBase,
              ...(metadataWidth > 0 && metadataHeight > 0
                ? { sourceWidth: metadataWidth, sourceHeight: metadataHeight }
                : {}),
            }
          : undefined;
        onProgress?.({ stage: "Analyzing embedded thumbnail…", embeddedPreview, rawTiming: timing });
        // Thumbnail analysis runs in its own worker and is intentionally not awaited
        // here. Linear RAW demosaic can therefore proceed concurrently on the
        // LibRaw worker. The reference is only needed immediately before tone/color.
        thumbnailReferencePromise = measureRawTiming(
          timing,
          "preview",
          "Embedded thumbnail analysis subtotal",
          () => rawThumbnailMatchReferenceFromThumbnailParallel(thumbnail, timing),
        ).catch(() => undefined);
      } catch {
        thumbnailReferencePromise = Promise.resolve(undefined);
      }
    }

    const image = await runStage("Demosaicing RAW preview…", () => Promise.race([
      raw!.imageData(),
      workerFailure!.promise,
    ]));
    if (!image || !image.width || !image.height || !image.data) {
      throw new Error("RAW preview decode failed");
    }
    const sourceDecoded = await runBlockingStage("Converting RAW preview pixels…", () =>
      libRawImageDataToDecoded(image),
    );
    const rawOutputCrop = rawInsetOutputCropFromMetadata(metadata, sourceDecoded.width, sourceDecoded.height);
    const lensfunFrameWidth = rawOutputCrop?.width ?? sourceDecoded.width;
    const lensfunFrameHeight = rawOutputCrop?.height ?? sourceDecoded.height;
    const lensMetadata = rawLensMetadata(metadata);
    sourceDecoded.lensCorrection = await runStage("Correcting RAW preview lens…", () =>
      buildRawLensfunCorrection(lensMetadata, lensfunFrameWidth, lensfunFrameHeight),
    );
    const lensfunSettings = buildRawDevelopmentLensfunSettings(
      lensMetadata,
      sourceDecoded.lensCorrection,
      lensfunFrameWidth,
      lensfunFrameHeight,
    );
    const cropSettings = buildRawDevelopmentCropSettings(
      sourceDecoded.width,
      sourceDecoded.height,
      sourceDecoded.lensCorrection,
      rawOutputCrop,
    );
    const correctedDimensions = rawLensfunOutputDimensions(
      sourceDecoded.width,
      sourceDecoded.height,
      rawLensfunCorrectionMaps(sourceDecoded.lensCorrection),
      rawOutputCrop,
    );
    const dimensions = rawPreviewDimensions(correctedDimensions.width, correctedDimensions.height);
    const decoded = await runStage("Building RAW preview image…", () =>
      resampleRawDecodedInWorker(
        sourceDecoded,
        dimensions.width,
        dimensions.height,
        rawOutputCrop,
      ),
    );

    const thumbnailReference = await measureRawTiming(
      timing,
      "preview",
      "Waiting for embedded thumbnail analysis",
      () => thumbnailReferencePromise,
    );
    const plan = await developRawPreviewPixels(decoded, thumbnailReference, timing, onProgress);
    plan.previewIso = Number.isFinite(isoValue) && isoValue > 0 ? isoValue : null;
    plan.rawGeometry = rawGeometryFromMetadata(metadata);
    const previewElapsedMs = performance.now() - timing.startedAtMs;
    const previewElapsedSeconds = previewElapsedMs / 1000;
    plan.previewElapsedSeconds = previewElapsedSeconds;
    const toneColorSubtotal = rawTimingSubtotal(timing.preview, [
      "Planning RAW preview tone",
      "Developing RAW preview tone",
      "Planning RAW preview color",
      "Developing RAW preview color",
      "Encoding RAW preview gamma2 buffer",
    ]);
    recordRawTiming(timing, "preview", "RAW preview tone/color subtotal", toneColorSubtotal);
    recordRawTiming(timing, "preview", "RAW preview buffer ready", previewElapsedMs);
    decoded.rawDevelopment = {
      mode: plan.mode,
      iso: Number.isFinite(isoValue) && isoValue > 0 ? isoValue : null,
      medPasses: 0,
      luminance: plan.luminance,
      saturation: plan.saturation,
      headroom: plan.headroom,
      rawGeometry: plan.rawGeometry,
      crop: cropSettings,
      lensfun: lensfunSettings,
      runtimeMode: timing.runtimeMode,
      openMpThreads: timing.openMpThreads,
      timing,
      previewElapsedSeconds,
      elapsedSeconds: previewElapsedSeconds,
    };
    onProgress?.({ stage: "Preparing RAW preview…", rawTiming: timing });
    return { decoded, plan };
  } finally {
    workerFailure?.cleanup();
    if (raw?.dispose) raw.dispose();
    else raw?.worker?.terminate();
  }
}

async function decodeRawMasterImage(
  file: File,
  plan: RawProgressiveDevelopmentPlan,
  rawDemosaicQuality?: RawDemosaicQuality,
  rawHighlightMode?: RawHighlightMode,
): Promise<DecodedRgbImage16> {
  const startedAt = performance.now();
  const timing = plan.timing;
  let raw: LibRawInstanceLike | null = null;
  let workerFailure: ReturnType<typeof createLibRawWorkerFailure> | null = null;
  try {
    raw = await measureRawTiming(timing, "master", "Loading RAW master decoder", () => createLibRawInstance());
    workerFailure = createLibRawWorkerFailure(raw);
    const rawBytes = await measureRawTiming(timing, "master", "Reading RAW for master", async () =>
      new Uint8Array(await file.arrayBuffer()),
    );
    const plannedMedPasses = rawMedianDenoisePassesForIso(plan.previewIso ?? Number.NaN);
    const settings: LibRawSettingsLike = {
      ...RAW_DECODE_SETTINGS,
      userQual: rawDemosaicQuality ?? 11,
      ...(plannedMedPasses > 0 ? { medPasses: plannedMedPasses } : {}),
      ...(rawHighlightMode === undefined ? {} : { highlight: rawHighlightMode }),
    };
    await measureRawTiming(timing, "master", "Opening RAW master", () =>
      Promise.race([raw!.open(rawBytes, settings), workerFailure!.promise]),
    );
    const metadata = await measureRawTiming(timing, "master", "Reading master metadata", () =>
      Promise.race([raw!.metadata(true), workerFailure!.promise]),
    );
    const isoValue = Number(metadata?.iso_speed);
    const rawGeometry = rawGeometryFromMetadata(metadata) ?? plan.rawGeometry;
    const medPasses = rawMedianDenoisePassesForIso(isoValue);
    if (medPasses !== plannedMedPasses) {
      // Preview already supplied the ISO in the normal path, so Master opens the
      // RAW only once. If metadata disagrees enough to cross a median-denoise
      // threshold, reopen with the corrected setting. Reuse the existing bytes
      // when the LibRaw adapter has not transferred/detached them.
      const reopenBytes = rawBytes.byteLength > 0
        ? rawBytes
        : new Uint8Array(await measureRawTiming(
            timing,
            "master",
            "Rereading RAW for master median denoise",
            () => file.arrayBuffer(),
          ));
      await measureRawTiming(timing, "master", "Reopening RAW master for median denoise", () =>
        Promise.race([
          raw!.open(reopenBytes, {
            ...settings,
            ...(medPasses > 0 ? { medPasses } : { medPasses: 0 }),
          }),
          workerFailure!.promise,
        ]),
      );
    }
    const image = await measureRawTiming(timing, "master", "Demosaicing master", () =>
      Promise.race([raw!.imageData(), workerFailure!.promise]),
    );
    if (!image || !image.width || !image.height || !image.data) {
      throw new Error("RAW master decode failed");
    }
    const sourceDecoded = await measureRawTiming(timing, "master", "Converting master pixels", () =>
      libRawImageDataToDecoded(image),
    );
    const rawOutputCrop = rawInsetOutputCropFromMetadata(metadata, sourceDecoded.width, sourceDecoded.height);
    const lensfunFrameWidth = rawOutputCrop?.width ?? sourceDecoded.width;
    const lensfunFrameHeight = rawOutputCrop?.height ?? sourceDecoded.height;
    const lensMetadata = rawLensMetadata(metadata);
    sourceDecoded.lensCorrection = await measureRawTiming(
      timing,
      "master",
      "Building LensFun master correction",
      () => buildRawLensfunCorrection(
        lensMetadata,
        lensfunFrameWidth,
        lensfunFrameHeight,
      ),
    );
    const lensfunSettings = buildRawDevelopmentLensfunSettings(
      lensMetadata,
      sourceDecoded.lensCorrection,
      lensfunFrameWidth,
      lensfunFrameHeight,
    );
    const cropSettings = buildRawDevelopmentCropSettings(
      sourceDecoded.width,
      sourceDecoded.height,
      sourceDecoded.lensCorrection,
      rawOutputCrop,
    );
    const masterResult = await measureRawTiming(timing, "master", "Master one-pass", () =>
      developRawMasterOnePassInWorker(sourceDecoded, plan, rawOutputCrop),
    );
    const decoded = masterResult.decoded;
    decoded.rawDevelopment = {
      mode: plan.mode,
      iso: Number.isFinite(isoValue) && isoValue > 0 ? isoValue : null,
      medPasses,
      luminance: plan.luminance,
      saturation: plan.saturation,
      headroom: masterResult.headroom ?? plan.headroom,
      rawGeometry,
      crop: cropSettings,
      lensfun: lensfunSettings,
      runtimeMode: timing.runtimeMode,
      openMpThreads: timing.openMpThreads,
      timing,
      previewElapsedSeconds: plan.previewElapsedSeconds,
      elapsedSeconds: (performance.now() - startedAt) / 1000,
    };
    recordRawTiming(timing, "master", "Full-resolution Master ready", performance.now() - timing.startedAtMs);
    logRawTimingSection("Master", timing, timing.master);
    return decoded;
  } finally {
    workerFailure?.cleanup();
    if (raw?.dispose) raw.dispose();
    else raw?.worker?.terminate();
  }
}

async function decodeRawDenoiseImage(
  file: File,
  preview: DecodedRgbImage16,
  master: DecodedRgbImage16,
  plan: RawProgressiveDevelopmentPlan,
  rawDemosaicQuality?: RawDemosaicQuality,
  rawHighlightMode?: RawHighlightMode,
): Promise<RawDenoiseDevelopmentResult> {
  const startedAt = performance.now();
  const timing = plan.timing;
  let raw: LibRawInstanceLike | null = null;
  let workerFailure: ReturnType<typeof createLibRawWorkerFailure> | null = null;
  try {
    const isoValue = master.rawDevelopment?.iso ?? Number.NaN;
    const analysis = await measureRawTiming(timing, "denoise", "Analyzing denoise weights", () =>
      analyzeRawDenoiseInWorker(
        preview,
        Number.isFinite(isoValue) && isoValue > 0 ? isoValue : null,
      ),
    );

    const denoiseSettings = rawDenoiseDecodeSettingsForIso(isoValue);
    raw = await measureRawTiming(timing, "denoise", "Loading RAW denoise decoder", () => createLibRawInstance());
    workerFailure = createLibRawWorkerFailure(raw);
    const rawBytes = await measureRawTiming(timing, "denoise", "Reading RAW for denoise", async () =>
      new Uint8Array(await file.arrayBuffer()),
    );
    const settings: LibRawSettingsLike = {
      ...RAW_DECODE_SETTINGS,
      // LibRaw wavelet threshold uses a special internal bitmap path. Keep the
      // normal Preview/Master demosaic unchanged, but use AHD for Denoise so
      // threshold does not run through the DHT path that can corrupt tiles.
      userQual: 3,
      fbddNoiserd: denoiseSettings.fbddNoiserd,
      medPasses: denoiseSettings.medPasses,
      threshold: denoiseSettings.threshold,
      ...(rawHighlightMode === undefined ? {} : { highlight: rawHighlightMode }),
    };
    await measureRawTiming(timing, "denoise", "Opening RAW denoise", () =>
      Promise.race([raw!.open(rawBytes, settings), workerFailure!.promise]),
    );
    const metadata = await measureRawTiming(timing, "denoise", "Reading denoise metadata", () =>
      Promise.race([raw!.metadata(true), workerFailure!.promise]),
    );
    const image = await measureRawTiming(timing, "denoise", "Demosaicing denoise", () =>
      Promise.race([raw!.imageData(), workerFailure!.promise]),
    );
    if (!image || !image.width || !image.height || !image.data) {
      throw new Error("RAW denoise decode failed");
    }
    const sourceDecoded = await measureRawTiming(timing, "denoise", "Converting denoise pixels", () =>
      libRawImageDataToDecoded(image),
    );
    const rawOutputCrop = rawInsetOutputCropFromMetadata(metadata, sourceDecoded.width, sourceDecoded.height);
    const lensfunFrameWidth = rawOutputCrop?.width ?? sourceDecoded.width;
    const lensfunFrameHeight = rawOutputCrop?.height ?? sourceDecoded.height;
    const lensMetadata = rawLensMetadata(metadata);
    sourceDecoded.lensCorrection = await measureRawTiming(
      timing,
      "denoise",
      "Building LensFun denoise correction",
      () => buildRawLensfunCorrection(
        lensMetadata,
        lensfunFrameWidth,
        lensfunFrameHeight,
      ),
    );
    // Run the denoise source through exactly the same LensFun/tone/color path
    // as Master. Keep D alive: the mounted editor will blend Master into this
    // buffer in place using the low-resolution weight map, then adopt D as the
    // final Denoised master.
    const denoiseResult = await measureRawTiming(timing, "denoise", "Denoise one-pass", () =>
      developRawMasterOnePassInWorker(sourceDecoded, plan, rawOutputCrop),
    );
    const decoded = denoiseResult.decoded;
    const denoiseDevelopment: RawDenoiseSettings = {
      fbdd: denoiseSettings.fbdd,
      medPasses: denoiseSettings.medPasses,
      smoothMean: analysis.smoothMean,
      smoothStddev: analysis.smoothStddev,
      shadowMean: analysis.shadowMean,
      shadowStddev: analysis.shadowStddev,
      weightMean: analysis.weightMean,
      weightStddev: analysis.weightStddev,
      weightP50: analysis.weightP50,
      weightP90: analysis.weightP90,
      weightP99: analysis.weightP99,
      elapsedSeconds: (performance.now() - startedAt) / 1000,
    };
    decoded.rawDevelopment = {
      ...(master.rawDevelopment ?? {
        mode: plan.mode,
        iso: Number.isFinite(isoValue) && isoValue > 0 ? isoValue : null,
        medPasses: 0,
        luminance: plan.luminance,
        saturation: plan.saturation,
        previewElapsedSeconds: plan.previewElapsedSeconds,
        elapsedSeconds: 0,
      }),
      denoise: denoiseDevelopment,
    };
    recordRawTiming(timing, "denoise", "Denoise buffer ready", performance.now() - startedAt);
    logRawTimingSection("Denoise", timing, timing.denoise);
    return { decoded, weightMap: analysis.weightMap };
  } finally {
    workerFailure?.cleanup();
    if (raw?.dispose) raw.dispose();
    else raw?.worker?.terminate();
  }
}

async function decodeRawImage(
  file: File,
  rawDemosaicQuality?: RawDemosaicQuality,
  rawHighlightMode?: RawHighlightMode,
  onProgress?: ImageLoadProgressListener,
): Promise<DecodedRgbImage16> {
  const timing = createRawDevelopmentTiming();
  const preview = await decodeRawPreviewImage(file, timing, rawHighlightMode, onProgress);
  const masterPromise = decodeRawMasterImage(
    file,
    preview.plan,
    rawDemosaicQuality,
    rawHighlightMode,
  );
  const denoisePromise = masterPromise.then((master) => {
    // Keep the background continuation reachable from a cached Master result.
    // The callback runs only after denoisePromise has been initialized.
    master.rawDenoisePromise = denoisePromise;
    return decodeRawDenoiseImage(
      file,
      preview.decoded,
      master,
      preview.plan,
      rawDemosaicQuality,
      rawHighlightMode,
    );
  });
  // Preview is the foreground result. Master starts only after Preview has
  // completed, and Denoise starts only after Master has completed. Background
  // failures do not invalidate Preview/Master editing.
  void masterPromise.catch(() => {});
  void denoisePromise.catch(() => {});
  preview.decoded.rawMasterPromise = masterPromise;
  preview.decoded.rawDenoisePromise = denoisePromise;
  return preview.decoded;
}

async function decodeRawUploadFastPath(
  file: File,
  rawDemosaicQuality?: RawDemosaicQuality,
  rawHighlightMode?: RawHighlightMode,
): Promise<DecodedRgbImage16> {
  const timing = createRawDevelopmentTiming();
  const startedAt = performance.now();
  let raw: LibRawInstanceLike | null = null;
  let workerFailure: ReturnType<typeof createLibRawWorkerFailure> | null = null;
  try {
    raw = await measureRawTiming(timing, "master", "Loading RAW master decoder", () => createLibRawInstance());
    workerFailure = createLibRawWorkerFailure(raw);
    const rawBytes = await measureRawTiming(timing, "master", "Reading RAW for master", async () =>
      new Uint8Array(await file.arrayBuffer()),
    );
    const settings: LibRawSettingsLike = {
      ...RAW_DECODE_SETTINGS,
      userQual: rawDemosaicQuality ?? 11,
      ...(rawHighlightMode === undefined ? {} : { highlight: rawHighlightMode }),
    };
    await measureRawTiming(timing, "master", "Opening RAW master", () =>
      Promise.race([raw!.open(rawBytes, settings), workerFailure!.promise]),
    );
    const metadata = await measureRawTiming(timing, "master", "Reading master metadata", () =>
      Promise.race([raw!.metadata(true), workerFailure!.promise]),
    );
    const isoValue = Number(metadata?.iso_speed);

    let thumbnailReferencePromise: Promise<RawThumbnailMatchReference | undefined> = Promise.resolve(undefined);
    if (RAW_USE_THUMBNAIL && raw.thumbnailData) {
      try {
        const thumbnail = await measureRawTiming(timing, "master", "Reading embedded thumbnail", () =>
          Promise.race([raw!.thumbnailData!(), workerFailure!.promise]),
        );
        thumbnailReferencePromise = rawThumbnailMatchReferenceFromThumbnailParallel(thumbnail, timing)
          .catch(() => undefined);
      } catch {
        thumbnailReferencePromise = Promise.resolve(undefined);
      }
    }

    const medPasses = rawMedianDenoisePassesForIso(isoValue);
    if (medPasses > 0) {
      const reopenBytes = rawBytes.byteLength > 0
        ? rawBytes
        : new Uint8Array(await file.arrayBuffer());
      await measureRawTiming(timing, "master", "Reopening RAW master for median denoise", () =>
        Promise.race([
          raw!.open(reopenBytes, { ...settings, medPasses }),
          workerFailure!.promise,
        ]),
      );
    }

    const image = await measureRawTiming(timing, "master", "Demosaicing master", () =>
      Promise.race([raw!.imageData(), workerFailure!.promise]),
    );
    if (!image || !image.width || !image.height || !image.data) {
      throw new Error("RAW master decode failed");
    }
    const sourceDecoded = await measureRawTiming(timing, "master", "Converting master pixels", () =>
      libRawImageDataToDecoded(image),
    );
    const rawOutputCrop = rawInsetOutputCropFromMetadata(metadata, sourceDecoded.width, sourceDecoded.height);
    const lensfunFrameWidth = rawOutputCrop?.width ?? sourceDecoded.width;
    const lensfunFrameHeight = rawOutputCrop?.height ?? sourceDecoded.height;
    const lensMetadata = rawLensMetadata(metadata);
    sourceDecoded.lensCorrection = await measureRawTiming(
      timing,
      "master",
      "Building LensFun master correction",
      () => buildRawLensfunCorrection(lensMetadata, lensfunFrameWidth, lensfunFrameHeight),
    );
    const lensfunSettings = buildRawDevelopmentLensfunSettings(
      lensMetadata,
      sourceDecoded.lensCorrection,
      lensfunFrameWidth,
      lensfunFrameHeight,
    );
    const cropSettings = buildRawDevelopmentCropSettings(
      sourceDecoded.width,
      sourceDecoded.height,
      sourceDecoded.lensCorrection,
      rawOutputCrop,
    );

    const correctionMaps = rawLensfunCorrectionMaps(sourceDecoded.lensCorrection);
    const correctedDimensions = rawLensfunOutputDimensions(
      sourceDecoded.width,
      sourceDecoded.height,
      correctionMaps,
      rawOutputCrop,
    );
    const sampleDimensions = rawPreviewDimensions(correctedDimensions.width, correctedDimensions.height);
    const planningSample: DecodedRgbImage16 = {
      colorSpace: "prophoto",
      transfer: "gamma20",
      linearRangeMax: RAW_DEVELOPED_LINEAR_RANGE_MAX,
      width: sampleDimensions.width,
      height: sampleDimensions.height,
      data: await measureRawTiming(timing, "master", "Building master analysis sample", () =>
        resampleRawWithLensfunToGamma20(
          sourceDecoded.data,
          sourceDecoded.width,
          sourceDecoded.height,
          sourceDecoded.linearRangeMax,
          sourceDecoded.transfer,
          correctionMaps,
          rawOutputCrop,
          sampleDimensions.width,
          sampleDimensions.height,
        ),
      ),
      cleanup: () => {},
    };

    const thumbnailReference = await thumbnailReferencePromise;
    const plan = await developRawPreviewPixels(planningSample, thumbnailReference, timing);
    plan.previewIso = Number.isFinite(isoValue) && isoValue > 0 ? isoValue : null;
    plan.previewElapsedSeconds = (performance.now() - startedAt) / 1000;

    const masterResult = await measureRawTiming(timing, "master", "Master one-pass", () =>
      developRawMasterOnePassInWorker(sourceDecoded, plan, rawOutputCrop),
    );
    const decoded = masterResult.decoded;
    decoded.rawDevelopment = {
      mode: plan.mode,
      iso: Number.isFinite(isoValue) && isoValue > 0 ? isoValue : null,
      medPasses,
      luminance: plan.luminance,
      saturation: plan.saturation,
      headroom: masterResult.headroom ?? plan.headroom,
      rawGeometry: rawGeometryFromMetadata(metadata),
      crop: cropSettings,
      lensfun: lensfunSettings,
      runtimeMode: timing.runtimeMode,
      openMpThreads: timing.openMpThreads,
      timing,
      previewElapsedSeconds: plan.previewElapsedSeconds,
      elapsedSeconds: (performance.now() - startedAt) / 1000,
    };
    recordRawTiming(timing, "master", "Full-resolution Master ready", performance.now() - timing.startedAtMs);
    logRawTimingSection("Master", timing, timing.master);
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
  embeddedPreview?: ImageLoadEmbeddedPreview;
};

const RAW_DEVELOPMENT_IN_FLIGHT = new WeakMap<
  File,
  Map<string, RawDevelopmentInFlightEntry>
>();

const RAW_UPLOAD_FAST_PATH_IN_FLIGHT = new WeakMap<
  File,
  Map<string, Promise<DecodedRgbImage16>>
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
      if (existing.lastProgress) {
        onProgress({
          ...existing.lastProgress,
          ...(existing.embeddedPreview ? { embeddedPreview: existing.embeddedPreview } : {}),
        });
      }
    }
    return existing.promise;
  }

  const entry: RawDevelopmentInFlightEntry = {
    promise: Promise.resolve(null as unknown as DecodedRgbImage16),
    listeners: new Set(onProgress ? [onProgress] : []),
  };
  const emitProgress: ImageLoadProgressListener = (progress) => {
    entry.lastProgress = progress;
    if (progress.embeddedPreview) entry.embeddedPreview = progress.embeddedPreview;
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

function decodeRawUploadFastPathShared(
  file: File,
  rawDemosaicQuality?: RawDemosaicQuality,
  rawHighlightMode?: RawHighlightMode,
): Promise<DecodedRgbImage16> {
  const key = `${rawDemosaicQuality ?? "default"}:${rawHighlightMode ?? "default"}`;
  let pendingByQuality = RAW_UPLOAD_FAST_PATH_IN_FLIGHT.get(file);
  if (!pendingByQuality) {
    pendingByQuality = new Map();
    RAW_UPLOAD_FAST_PATH_IN_FLIGHT.set(file, pendingByQuality);
  }
  const existing = pendingByQuality.get(key);
  if (existing) return existing;
  const promise = decodeRawUploadFastPath(file, rawDemosaicQuality, rawHighlightMode).finally(() => {
    const current = RAW_UPLOAD_FAST_PATH_IN_FLIGHT.get(file);
    if (current?.get(key) === promise) {
      current.delete(key);
      if (current.size === 0) RAW_UPLOAD_FAST_PATH_IN_FLIGHT.delete(file);
    }
  });
  pendingByQuality.set(key, promise);
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
    return task();
  }
  async function runBlockingStage<T>(stage: string, task: () => T): Promise<T> {
    onProgress?.({ stage });
    if (onProgress) {
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
    }
    return task();
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

const PEEP_DENOISE_HALO_PX = 16;
const PEEP_OUTPUT_HALO_PX = 4;
const PEEP_TILE_SIZE_PX = 400;
const PEEP_TILE_CACHE_LIMIT = 128;
const PEEP_TILE_PREFETCH_RINGS = 1;
const PEEP_TILE_SLIDER_IDLE_MS = 200;

type PeepOutputRect = { x: number; y: number; w: number; h: number };
type PeepTileSource = ImageBitmap | HTMLCanvasElement | OffscreenCanvas;
type PeepTileCacheEntry = { source: PeepTileSource; width: number; height: number };
type PeepTileJob = { revision: number; tx: number; ty: number; rect: PeepOutputRect };

function releasePeepTileSource(source: PeepTileSource): void {
  if (typeof ImageBitmap !== "undefined" && source instanceof ImageBitmap) {
    source.close();
    return;
  }
  releaseCanvasIfNeeded(source as HTMLCanvasElement | OffscreenCanvas);
}

function peepTileKey(tx: number, ty: number): string {
  return `${tx}:${ty}`;
}

function collectPeepTileCoordsSpiral(
  rect: PeepOutputRect,
  outputW: number,
  outputH: number,
  prefetchRings = 0,
): Array<{ tx: number; ty: number }> {
  const maxTx = Math.max(0, Math.ceil(outputW / PEEP_TILE_SIZE_PX) - 1);
  const maxTy = Math.max(0, Math.ceil(outputH / PEEP_TILE_SIZE_PX) - 1);
  const visibleMinTx = Math.max(0, Math.floor(rect.x / PEEP_TILE_SIZE_PX));
  const visibleMinTy = Math.max(0, Math.floor(rect.y / PEEP_TILE_SIZE_PX));
  const visibleMaxTx = Math.min(maxTx, Math.floor((rect.x + Math.max(0, rect.w - 1)) / PEEP_TILE_SIZE_PX));
  const visibleMaxTy = Math.min(maxTy, Math.floor((rect.y + Math.max(0, rect.h - 1)) / PEEP_TILE_SIZE_PX));
  const minTx = Math.max(0, visibleMinTx - prefetchRings);
  const minTy = Math.max(0, visibleMinTy - prefetchRings);
  const maxWantedTx = Math.min(maxTx, visibleMaxTx + prefetchRings);
  const maxWantedTy = Math.min(maxTy, visibleMaxTy + prefetchRings);
  const centerTx = Math.max(minTx, Math.min(maxWantedTx, Math.floor((rect.x + rect.w / 2) / PEEP_TILE_SIZE_PX)));
  const centerTy = Math.max(minTy, Math.min(maxWantedTy, Math.floor((rect.y + rect.h / 2) / PEEP_TILE_SIZE_PX)));

  const spiral = (filter: (tx: number, ty: number) => boolean) => {
    const result: Array<{ tx: number; ty: number }> = [];
    const maxRadius = Math.max(
      Math.abs(centerTx - minTx),
      Math.abs(maxWantedTx - centerTx),
      Math.abs(centerTy - minTy),
      Math.abs(maxWantedTy - centerTy),
    );
    const push = (tx: number, ty: number) => {
      if (tx < minTx || tx > maxWantedTx || ty < minTy || ty > maxWantedTy || !filter(tx, ty)) return;
      result.push({ tx, ty });
    };
    push(centerTx, centerTy);
    for (let radius = 1; radius <= maxRadius; radius += 1) {
      const left = centerTx - radius;
      const right = centerTx + radius;
      const top = centerTy - radius;
      const bottom = centerTy + radius;
      for (let tx = left; tx <= right; tx += 1) push(tx, top);
      for (let ty = top + 1; ty <= bottom; ty += 1) push(right, ty);
      for (let tx = right - 1; tx >= left; tx -= 1) push(tx, bottom);
      for (let ty = bottom - 1; ty >= top; ty -= 1) push(left, ty);
    }
    return result;
  };

  const isVisible = (tx: number, ty: number) => (
    tx >= visibleMinTx && tx <= visibleMaxTx && ty >= visibleMinTy && ty <= visibleMaxTy
  );
  const visible = spiral(isVisible);
  if (prefetchRings <= 0) return visible;
  return visible.concat(spiral((tx, ty) => !isVisible(tx, ty)));
}

async function buildPeepTileCanvasFromDecoded(
  decoded: DecodedRgbImage16,
  params: ImageEditParams,
  peepRect: PeepOutputRect,
  outputColorProfile: ImageEditOutputColorProfile = "srgb",
  previewClarityMap?: ImageEditClarityMap | null,
  defringeMap?: DefringeAnalysisMap | null,
): Promise<HTMLCanvasElement | OffscreenCanvas> {
  const sourceW = decoded.width;
  const sourceH = decoded.height;
  const crop = normalizeCrop(params.crop);
  const sx = Math.max(0, Math.min(sourceW - 1, Math.round(sourceW * crop.left)));
  const sy = Math.max(0, Math.min(sourceH - 1, Math.round(sourceH * crop.top)));
  const ex = Math.max(sx + 1, Math.min(sourceW, Math.round(sourceW * (1 - crop.right))));
  const ey = Math.max(sy + 1, Math.min(sourceH, Math.round(sourceH * (1 - crop.bottom))));
  const cropW = Math.max(1, ex - sx);
  const cropH = Math.max(1, ey - sy);
  const outputW = Math.max(1, Math.round(cropW * params.resizePercent / 100));
  const outputH = Math.max(1, Math.round(cropH * params.resizePercent / 100));
  const targetW = Math.max(1, Math.min(outputW, Math.round(peepRect.w)));
  const targetH = Math.max(1, Math.min(outputH, Math.round(peepRect.h)));
  const targetX = Math.max(0, Math.min(outputW - targetW, Math.round(peepRect.x)));
  const targetY = Math.max(0, Math.min(outputH - targetH, Math.round(peepRect.y)));
  const extX0 = Math.max(0, targetX - PEEP_OUTPUT_HALO_PX);
  const extY0 = Math.max(0, targetY - PEEP_OUTPUT_HALO_PX);
  const extX1 = Math.min(outputW, targetX + targetW + PEEP_OUTPUT_HALO_PX);
  const extY1 = Math.min(outputH, targetY + targetH + PEEP_OUTPUT_HALO_PX);
  const extW = Math.max(1, extX1 - extX0);
  const extH = Math.max(1, extY1 - extY0);
  const scaleX = outputW / cropW;
  const scaleY = outputH / cropH;
  const preX0 = Math.max(0, Math.floor(extX0 / Math.max(1e-9, scaleX)) - PEEP_DENOISE_HALO_PX);
  const preY0 = Math.max(0, Math.floor(extY0 / Math.max(1e-9, scaleY)) - PEEP_DENOISE_HALO_PX);
  const preX1 = Math.min(cropW, Math.ceil(extX1 / Math.max(1e-9, scaleX)) + PEEP_DENOISE_HALO_PX);
  const preY1 = Math.min(cropH, Math.ceil(extY1 / Math.max(1e-9, scaleY)) + PEEP_DENOISE_HALO_PX);
  const preW = Math.max(1, preX1 - preX0);
  const preH = Math.max(1, preY1 - preY0);

  if (params.textOverlays.length > 0) await ensureTextOverlayFontsReady(params.textOverlays);
  const activeDefringeMap = clampDefringe(params.defringe) > 0 ? defringeMap ?? null : null;
  const clarityMap = resolveImageEditClarityMap(decoded, params, previewClarityMap, activeDefringeMap);
  const sourceRect = { x: sx, y: sy, w: cropW, h: cropH };
  const preCanvas = createImageEditCanvas(preW, preH);
  const extCanvas = createImageEditCanvas(extW, extH);
  try {
    renderAdjustedRgb16RegionToCanvas(
      preCanvas,
      decoded,
      sourceRect,
      cropW,
      cropH,
      preX0,
      preY0,
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
      clarityMap,
      activeDefringeMap,
      clampDefringe(params.defringe) / 100,
    );
    applyDenoiseToCanvas(preCanvas, params.denoise, outputColorProfile);

    const extCtx = getCanvas2dContext(extCanvas, outputColorProfile);
    if (!extCtx) throw new Error("2D context unavailable");
    extCtx.imageSmoothingEnabled = true;
    extCtx.imageSmoothingQuality = "high";
    extCtx.drawImage(
      preCanvas,
      extX0 / Math.max(1e-9, scaleX) - preX0,
      extY0 / Math.max(1e-9, scaleY) - preY0,
      extW / Math.max(1e-9, scaleX),
      extH / Math.max(1e-9, scaleY),
      0,
      0,
      extW,
      extH,
    );

    applySharpenToCanvas(extCanvas, params.sharpen, outputColorProfile);
    applyVignetteToCanvas(
      extCanvas,
      params.vignetteOverlay,
      sourceW,
      sourceH,
      sx,
      sy,
      cropW,
      cropH,
      -extX0,
      -extY0,
      outputW,
      outputH,
      outputColorProfile,
    );
    applyImageFilterToCanvas(extCanvas, params.filter, outputColorProfile);
    applyMosaicRectsToCanvas(
      extCanvas,
      mosaicRegionsToOutputRects(
        params.mosaicRegions,
        sourceW,
        sourceH,
        sx,
        sy,
        cropW,
        cropH,
        outputW,
        outputH,
      ).map((rect) => ({ ...rect, x: rect.x - extX0, y: rect.y - extY0 })),
      16,
      outputColorProfile,
    );
    if (params.drawOverlays.length > 0 || params.textOverlays.length > 0) {
      extCtx.save();
      extCtx.translate(-extX0, -extY0);
      drawOverlaysToContext(
        extCtx,
        params.drawOverlays,
        sourceW,
        sourceH,
        sx,
        sy,
        cropW,
        cropH,
        outputW,
        outputH,
        params.rotationDegrees,
      );
      drawTextOverlaysToContext(
        extCtx,
        params.textOverlays,
        sourceW,
        sourceH,
        sx,
        sy,
        cropW,
        cropH,
        outputW,
        outputH,
        params.rotationDegrees,
        outputColorProfile,
      );
      extCtx.restore();
    }

    const result = createImageEditCanvas(targetW, targetH);
    const resultCtx = getCanvas2dContext(result, outputColorProfile);
    if (!resultCtx) {
      releaseCanvasIfNeeded(result);
      throw new Error("2D context unavailable");
    }
    resultCtx.drawImage(
      extCanvas,
      targetX - extX0,
      targetY - extY0,
      targetW,
      targetH,
      0,
      0,
      targetW,
      targetH,
    );
    return result;
  } finally {
    releaseCanvasIfNeeded(preCanvas);
    releaseCanvasIfNeeded(extCanvas);
  }
}

async function materializePeepTileSource(
  canvas: HTMLCanvasElement | OffscreenCanvas,
): Promise<PeepTileSource> {
  if (typeof createImageBitmap === "function") {
    try {
      const bitmap = await createImageBitmap(canvas);
      releaseCanvasIfNeeded(canvas);
      return bitmap;
    } catch {
      // Keep the canvas as the cached source when ImageBitmap conversion is unavailable.
    }
  }
  return canvas;
}

function storePeepTileCacheEntry(
  cache: Map<string, PeepTileCacheEntry>,
  key: string,
  entry: PeepTileCacheEntry,
): void {
  const previous = cache.get(key);
  if (previous && previous.source !== entry.source) releasePeepTileSource(previous.source);
  cache.delete(key);
  cache.set(key, entry);
  while (cache.size > PEEP_TILE_CACHE_LIMIT) {
    const oldestKey = cache.keys().next().value as string | undefined;
    if (oldestKey === undefined) break;
    const oldest = cache.get(oldestKey);
    cache.delete(oldestKey);
    if (oldest) releasePeepTileSource(oldest.source);
  }
}

function buildFallbackImageEditClarityMap(
  decoded: DecodedRgbImage16,
  params: ImageEditParams,
  defringeMap?: DefringeAnalysisMap | null,
): ImageEditClarityMap | null {
  const normalizedClarity = clampClarity(params.clarity);
  if (normalizedClarity === 0) return null;
  const sourceRect = { x: 0, y: 0, w: decoded.width, h: decoded.height };
  const rawInternalPreview = getAnalysisLinearRgbSample(
    decoded,
    sourceRect,
    0,
    IMAGE_EDIT_CLAHE_MIN_PIXELS,
  );
  const rawContextSample = getAnalysisLinearRgbSample(decoded, sourceRect, 0);
  const defringeAmount = clampDefringe(params.defringe) / 100;
  const internalPreview = defringeMap && defringeAmount > 0
    ? applyDefringeToRenderedSample(
        rawInternalPreview, defringeMap, defringeAmount,
        decoded.width, decoded.height, sourceRect, 0,
      )
    : rawInternalPreview;
  const contextSample = defringeMap && defringeAmount > 0
    ? applyDefringeToRenderedSample(
        rawContextSample, defringeMap, defringeAmount,
        decoded.width, decoded.height, sourceRect, 0,
      )
    : rawContextSample;
  const context = buildInteractiveColorAdjustmentContextFromLinearRgbSample(
    contextSample,
    params.temperature,
    params.tint,
    params.exposureEv,
    params.shadow,
    params.highlight,
    params.scaledLog,
    params.sigmoid,
    0,
    0,
    true,
  );
  return buildImageEditClarityMap(internalPreview, context, normalizedClarity);
}

function resolveImageEditClarityMap(
  decoded: DecodedRgbImage16,
  params: ImageEditParams,
  previewClarityMap?: ImageEditClarityMap | null,
  defringeMap?: DefringeAnalysisMap | null,
): ImageEditClarityMap | null {
  if (clampClarity(params.clarity) === 0) return null;
  if (isUsableImageEditClarityMap(previewClarityMap)) return previewClarityMap;
  return buildFallbackImageEditClarityMap(decoded, params, defringeMap);
}

async function buildEditedVariantFromDecoded(
  decoded: DecodedRgbImage16,
  params: ImageEditParams,
  outputColorProfile: ImageEditOutputColorProfile,
  previewClarityMap?: ImageEditClarityMap | null,
  defringeMap?: DefringeAnalysisMap | null,
  timing?: ImageEditTimingTrace,
): Promise<ImageEditPreparedVariant> {
  const variantStartedAt = timing ? performance.now() : 0;
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
  const renderStartedAt = timing ? performance.now() : 0;
  const clarityMap = resolveImageEditClarityMap(decoded, params, previewClarityMap, defringeMap);

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
      clarityMap,
      defringeMap ?? null,
      clampDefringe(params.defringe) / 100,
    );
    applyDenoiseToCanvas(output, params.denoise, outputColorProfile);
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
        clarityMap,
        defringeMap ?? null,
        clampDefringe(params.defringe) / 100,
      );
      applyDenoiseToCanvas(cropped, params.denoise, outputColorProfile);
      const outputCtx = getCanvas2dContext(output, outputColorProfile);
      if (!outputCtx) throw new Error("2D context unavailable");
      outputCtx.imageSmoothingEnabled = true;
      outputCtx.imageSmoothingQuality = "high";
      outputCtx.drawImage(cropped, 0, 0, sw, sh, 0, 0, dw, dh);
    } finally {
      releaseCanvasIfNeeded(cropped);
    }
  }
  if (timing) {
    recordImageEditTiming(timing, "Rendering adjusted full output", performance.now() - renderStartedAt);
  }

  const outputCtx = getCanvas2dContext(output, outputColorProfile);
  if (!outputCtx) throw new Error("2D context unavailable");
  measureImageEditTimingSync(timing, "Applying sharpen", () =>
    applySharpenToCanvas(output, params.sharpen, outputColorProfile),
  );
  measureImageEditTimingSync(timing, "Applying vignette", () =>
    applyVignetteToCanvas(
      output,
      params.vignetteOverlay,
      w,
      h,
      sx,
      sy,
      sw,
      sh,
      0,
      0,
      dw,
      dh,
      outputColorProfile,
    ),
  );
  measureImageEditTimingSync(timing, "Applying filter", () =>
    applyImageFilterToCanvas(output, params.filter, outputColorProfile),
  );
  measureImageEditTimingSync(timing, "Applying mosaic", () =>
    applyMosaicRectsToCanvas(
      output,
      mosaicRegionsToOutputRects(params.mosaicRegions, w, h, sx, sy, sw, sh, dw, dh),
      16,
      outputColorProfile,
    ),
  );
  measureImageEditTimingSync(timing, "Drawing vector overlays", () =>
    drawOverlaysToContext(
      outputCtx,
      params.drawOverlays,
      w,
      h,
      sx,
      sy,
      sw,
      sh,
      dw,
      dh,
      params.rotationDegrees,
    ),
  );
  measureImageEditTimingSync(timing, "Drawing text overlays", () =>
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
      outputColorProfile,
    ),
  );
  if (timing) {
    recordImageEditTiming(
      timing,
      "Building full-resolution edited variant",
      performance.now() - variantStartedAt,
    );
  }
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
  previewClarityMap?: ImageEditClarityMap | null,
  defringeMap?: DefringeAnalysisMap | null,
  timing?: ImageEditTimingTrace,
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
    const resolvedDefringeMap = clampDefringe(params.defringe) > 0
      ? defringeMap ?? await analyzeDefringeSampleAsync(await buildDefringeAnalysisSample(decoded))
      : null;
    return await buildEditedVariantFromDecoded(
      decoded, params, outputColorProfile, previewClarityMap, resolvedDefringeMap, timing,
    );
  } finally {
    if (ownsDecodedImage) decoded.cleanup();
  }
}

async function buildRawUploadDefaultFastVariant(
  decoded: DecodedRgbImage16,
  params: ImageEditParams,
  outputColorProfile: ImageEditOutputColorProfile,
): Promise<ImageEditPreparedVariant> {
  const sourceW = decoded.width;
  const sourceH = decoded.height;
  const outputW = Math.max(1, Math.round(sourceW * params.resizePercent / 100));
  const outputH = Math.max(1, Math.round(sourceH * params.resizePercent / 100));
  const sourceCanvas = createImageEditCanvas(sourceW, sourceH);
  let output: HTMLCanvasElement | OffscreenCanvas = sourceCanvas;
  let succeeded = false;
  try {
    const sourceCtx = getCanvas2dContext(sourceCanvas, outputColorProfile);
    if (!sourceCtx) throw new Error("2D context unavailable");
    const imageData = createCanvasImageData(sourceCtx, sourceW, sourceH, outputColorProfile);
    const rgba = imageData.data;
    const converted: [number, number, number] = [0, 0, 0];
    const pixels = sourceW * sourceH;
    let si = 0;
    let di = 0;
    for (let pixel = 0; pixel < pixels; pixel += 1, si += 3, di += 4) {
      const r = decodeStoredRgb16Channel(decoded.data[si] ?? 0, decoded.transfer, decoded.linearRangeMax);
      const g = decodeStoredRgb16Channel(decoded.data[si + 1] ?? 0, decoded.transfer, decoded.linearRangeMax);
      const b = decodeStoredRgb16Channel(decoded.data[si + 2] ?? 0, decoded.transfer, decoded.linearRangeMax);
      convertLinearProPhotoToOutputRgbInto(r, g, b, outputColorProfile, converted);
      rgba[di] = linearChannelToSrgb(converted[0]);
      rgba[di + 1] = linearChannelToSrgb(converted[1]);
      rgba[di + 2] = linearChannelToSrgb(converted[2]);
      rgba[di + 3] = 255;
    }
    sourceCtx.putImageData(imageData, 0, 0);

    if (outputW !== sourceW || outputH !== sourceH) {
      output = createImageEditCanvas(outputW, outputH);
      const outputCtx = getCanvas2dContext(output, outputColorProfile);
      if (!outputCtx) throw new Error("2D context unavailable");
      outputCtx.imageSmoothingEnabled = true;
      outputCtx.imageSmoothingQuality = "high";
      outputCtx.drawImage(sourceCanvas, 0, 0, sourceW, sourceH, 0, 0, outputW, outputH);
    }
    applySharpenToCanvas(output, params.sharpen, outputColorProfile);
    succeeded = true;
    return { canvas: output, width: outputW, height: outputH, colorProfile: outputColorProfile };
  } finally {
    if (output !== sourceCanvas) {
      releaseCanvasIfNeeded(sourceCanvas);
      if (!succeeded) releaseCanvasIfNeeded(output);
    } else if (!succeeded) {
      releaseCanvasIfNeeded(sourceCanvas);
    }
  }
}

export async function buildEditedDecodedRgb16(
  decoded: DecodedRgbImage16,
  edit: ImageEditParams,
  outputColorProfile: ImageEditOutputColorProfile = "display-p3",
  previewClarityMap?: ImageEditClarityMap | null,
  defringeMap?: DefringeAnalysisMap | null,
): Promise<DecodedRgbImage16> {
  const params = normalizeEditParams(edit, decoded.width, decoded.height);
  const activeDefringeMap = clampDefringe(params.defringe) > 0
    ? defringeMap ?? await analyzeDefringeSampleAsync(await buildDefringeAnalysisSample(decoded))
    : null;
  const sourceW = decoded.width;
  const sourceH = decoded.height;
  const crop = normalizeCrop(params.crop);
  const sx = Math.max(0, Math.min(sourceW - 1, Math.round(sourceW * crop.left)));
  const sy = Math.max(0, Math.min(sourceH - 1, Math.round(sourceH * crop.top)));
  const ex = Math.max(sx + 1, Math.min(sourceW, Math.round(sourceW * (1 - crop.right))));
  const ey = Math.max(sy + 1, Math.min(sourceH, Math.round(sourceH * (1 - crop.bottom))));
  const cropW = Math.max(1, ex - sx);
  const cropH = Math.max(1, ey - sy);
  const outputW = Math.max(1, Math.round(cropW * params.resizePercent / 100));
  const outputH = Math.max(1, Math.round(cropH * params.resizePercent / 100));

  if (params.textOverlays.length > 0) {
    await ensureTextOverlayFontsReady(params.textOverlays);
  }
  const clarityMap = resolveImageEditClarityMap(decoded, params, previewClarityMap, defringeMap);
  const hasClarity = clarityMap !== null;

  const sourceRect = { x: sx, y: sy, w: cropW, h: cropH };
  const rawContextSample = getAnalysisLinearRgbSample(decoded, sourceRect, params.rotationDegrees);
  const defringeAmount = clampDefringe(params.defringe) / 100;
  const contextSample = activeDefringeMap && defringeAmount > 0
    ? applyDefringeToRenderedSample(
        rawContextSample, activeDefringeMap, defringeAmount,
        sourceW, sourceH, sourceRect, params.rotationDegrees,
      )
    : rawContextSample;
  const adjustmentContext = buildInteractiveColorAdjustmentContextFromLinearRgbSample(
    contextSample,
    params.temperature,
    params.tint,
    params.exposureEv,
    params.shadow,
    params.highlight,
    params.scaledLog,
    params.sigmoid,
    params.vibrance,
    params.saturation,
    true,
  );
  const transform = buildRenderedPixelToSourceTransform(
    sourceW,
    sourceH,
    sx,
    sy,
    outputW / cropW,
    outputH / cropH,
    params.rotationDegrees,
  );
  const result = new Uint16Array(outputW * outputH * 3);
  const canUseExactGeometry =
    sx === 0 &&
    sy === 0 &&
    cropW === sourceW &&
    cropH === sourceH &&
    outputW === sourceW &&
    outputH === sourceH &&
    normalizeRotationDegrees(params.rotationDegrees) === 0 &&
    !decoded.lensCorrection;
  const canCopyBaseExactly =
    canUseExactGeometry &&
    params.temperature === 0 &&
    params.tint === 0 &&
    params.defringe === 0 &&
    params.exposureEv === 0 &&
    params.shadow === 0 &&
    params.highlight === 0 &&
    params.scaledLog === 0 &&
    params.sigmoid === 0 &&
    params.clarity === 0 &&
    params.vibrance === 0 &&
    params.saturation === 0 &&
    decoded.transfer === "gamma20" &&
    decoded.linearRangeMax === 1;
  if (canCopyBaseExactly) {
    result.set(decoded.data);
  }
  const sample: LinearRgbBuffer = [0, 0, 0];
  const adjustedRgb: [number, number, number] = [0, 0, 0];
  const defringeConfidence: [number, number] = [0, 0];
  const samplingScratch = createRgb16SamplingScratch();
  const fallbackProfile: ImageInputColorProfile = outputColorProfile === "display-p3" ? "display-p3" : "srgb";
  const fallbackLinear = encodedRgbToLinearProphoto(128 / 255, 128 / 255, 128 / 255, fallbackProfile);

  if (!canCopyBaseExactly && canUseExactGeometry) {
    for (let pixel = 0; pixel < outputW * outputH; pixel += 1) {
      const index = pixel * 3;
      let r = decodeStoredRgb16Channel(decoded.data[index] ?? 0, decoded.transfer, decoded.linearRangeMax);
      let g = decodeStoredRgb16Channel(decoded.data[index + 1] ?? 0, decoded.transfer, decoded.linearRangeMax);
      let b = decodeStoredRgb16Channel(decoded.data[index + 2] ?? 0, decoded.transfer, decoded.linearRangeMax);
      if (activeDefringeMap && defringeAmount > 0) {
        const x = pixel % outputW;
        const y = Math.floor(pixel / outputW);
        applyDefringeLinearRgbInto(
          r, g, b, activeDefringeMap, defringeAmount,
          sourceW > 1 ? x / (sourceW - 1) : 0.5,
          sourceH > 1 ? y / (sourceH - 1) : 0.5,
          adjustedRgb,
          defringeConfidence,
        );
        r = adjustedRgb[0]; g = adjustedRgb[1]; b = adjustedRgb[2];
      }
      if (hasClarity) {
        applyToneAdjustmentsLinearRgbInto(r, g, b, adjustmentContext, adjustedRgb);
        r = adjustedRgb[0]; g = adjustedRgb[1]; b = adjustedRgb[2];
        const x = pixel % outputW;
        const y = Math.floor(pixel / outputW);
        const clarityGain = sampleImageEditClarityGain(
          clarityMap,
          x + 0.5,
          y + 0.5,
          sourceW,
          sourceH,
        );
        applyLuminanceGainPreservingAboveOneLinearRgbInto(r, g, b, clarityGain, adjustedRgb);
        r = adjustedRgb[0]; g = adjustedRgb[1]; b = adjustedRgb[2];
        applyColorAdjustmentsAfterToneLinearRgbInto(r, g, b, adjustmentContext, true, adjustedRgb);
        r = adjustedRgb[0]; g = adjustedRgb[1]; b = adjustedRgb[2];
      } else {
        applyColorAdjustmentsLinearRgbInto(r, g, b, adjustmentContext, adjustedRgb);
        r = adjustedRgb[0]; g = adjustedRgb[1]; b = adjustedRgb[2];
      }
      result[index] = encodeStoredRgb16Channel(r, "gamma20", 1);
      result[index + 1] = encodeStoredRgb16Channel(g, "gamma20", 1);
      result[index + 2] = encodeStoredRgb16Channel(b, "gamma20", 1);
    }
  } else if (!canCopyBaseExactly) {
    let rowSourceX = transform.originX;
    let rowSourceY = transform.originY;
    for (let y = 0; y < outputH; y += 1) {
      let sourceX = rowSourceX;
      let sourceY = rowSourceY;
      for (let x = 0; x < outputW; x += 1) {
        const dst = (y * outputW + x) * 3;
        let r = fallbackLinear[0];
        let g = fallbackLinear[1];
        let b = fallbackLinear[2];
        if (
          sourceX >= 0 &&
          sourceX < sourceW &&
          sourceY >= 0 &&
          sourceY < sourceH &&
          sampleLinearRgb16BilinearInto(decoded, sourceX, sourceY, sample, samplingScratch)
        ) {
          let sourceR = sample[0];
          let sourceG = sample[1];
          let sourceB = sample[2];
          if (activeDefringeMap && defringeAmount > 0) {
            applyDefringeLinearRgbInto(
              sourceR, sourceG, sourceB, activeDefringeMap, defringeAmount,
              sourceW > 1 ? sourceX / (sourceW - 1) : 0.5,
              sourceH > 1 ? sourceY / (sourceH - 1) : 0.5,
              adjustedRgb,
              defringeConfidence,
            );
            sourceR = adjustedRgb[0]; sourceG = adjustedRgb[1]; sourceB = adjustedRgb[2];
          }
          if (hasClarity) {
            applyToneAdjustmentsLinearRgbInto(
              sourceR,
              sourceG,
              sourceB,
              adjustmentContext,
              adjustedRgb,
            );
            r = adjustedRgb[0]; g = adjustedRgb[1]; b = adjustedRgb[2];
            const clarityGain = sampleImageEditClarityGain(
              clarityMap,
              sourceX,
              sourceY,
              sourceW,
              sourceH,
            );
            applyLuminanceGainPreservingAboveOneLinearRgbInto(r, g, b, clarityGain, adjustedRgb);
            r = adjustedRgb[0]; g = adjustedRgb[1]; b = adjustedRgb[2];
            applyColorAdjustmentsAfterToneLinearRgbInto(r, g, b, adjustmentContext, true, adjustedRgb);
            r = adjustedRgb[0]; g = adjustedRgb[1]; b = adjustedRgb[2];
          } else {
            applyColorAdjustmentsLinearRgbInto(
              sourceR, sourceG, sourceB, adjustmentContext, adjustedRgb,
            );
            r = adjustedRgb[0]; g = adjustedRgb[1]; b = adjustedRgb[2];
          }
        }
        result[dst] = encodeStoredRgb16Channel(r, "gamma20", 1);
        result[dst + 1] = encodeStoredRgb16Channel(g, "gamma20", 1);
        result[dst + 2] = encodeStoredRgb16Channel(b, "gamma20", 1);
        sourceX += transform.columnStepX;
        sourceY += transform.columnStepY;
      }
      rowSourceX += transform.rowStepX;
      rowSourceY += transform.rowStepY;
    }
  }

  applyDenoiseToRgb16(result, outputW, outputH, params.denoise);
  applySharpenToRgb16(result, outputW, outputH, params.sharpen);
  applyVignetteToRgb16(
    result,
    outputW,
    outputH,
    params.vignetteOverlay,
    sourceW,
    sourceH,
    sx,
    sy,
    cropW,
    cropH,
  );
  applyImageFilterToRgb16(result, outputW, outputH, params.filter);
  applyMosaicRectsToRgb16(
    result,
    outputW,
    outputH,
    mosaicRegionsToOutputRects(
      params.mosaicRegions,
      sourceW,
      sourceH,
      sx,
      sy,
      cropW,
      cropH,
      outputW,
      outputH,
    ),
  );
  applyOverlaysToRgb16(
    result,
    outputW,
    outputH,
    params,
    sourceW,
    sourceH,
    sx,
    sy,
    cropW,
    cropH,
    params.rotationDegrees,
    outputColorProfile,
  );

  return {
    colorSpace: "prophoto",
    transfer: "gamma20",
    linearRangeMax: 1,
    width: outputW,
    height: outputH,
    data: result,
    cleanup: () => {},
  };
}

function applyMosaicRectsToRgb16(
  data: Uint16Array,
  width: number,
  height: number,
  rects: MosaicPixelRect[],
  divisions = 16,
): void {
  if (!rects.length || divisions <= 0) return;
  const grid = Math.max(1, Math.round(divisions));
  for (const rect of rects) {
    const x0 = Math.max(0, Math.min(width, Math.floor(rect.x)));
    const y0 = Math.max(0, Math.min(height, Math.floor(rect.y)));
    const x1 = Math.max(x0, Math.min(width, Math.ceil(rect.x + rect.w)));
    const y1 = Math.max(y0, Math.min(height, Math.ceil(rect.y + rect.h)));
    const rw = x1 - x0;
    const rh = y1 - y0;
    if (rw <= 0 || rh <= 0) continue;
    for (let gy = 0; gy < grid; gy += 1) {
      const ty = y0 + Math.floor((gy * rh) / grid);
      const yEnd = y0 + Math.floor(((gy + 1) * rh) / grid);
      if (yEnd <= ty) continue;
      for (let gx = 0; gx < grid; gx += 1) {
        const tx = x0 + Math.floor((gx * rw) / grid);
        const xEnd = x0 + Math.floor(((gx + 1) * rw) / grid);
        if (xEnd <= tx) continue;
        let sumR = 0;
        let sumG = 0;
        let sumB = 0;
        let count = 0;
        for (let py = ty; py < yEnd; py += 1) {
          for (let px = tx; px < xEnd; px += 1) {
            const index = (py * width + px) * 3;
            sumR += data[index] ?? 0;
            sumG += data[index + 1] ?? 0;
            sumB += data[index + 2] ?? 0;
            count += 1;
          }
        }
        if (!count) continue;
        const averageR = Math.round(sumR / count);
        const averageG = Math.round(sumG / count);
        const averageB = Math.round(sumB / count);
        for (let py = ty; py < yEnd; py += 1) {
          for (let px = tx; px < xEnd; px += 1) {
            const index = (py * width + px) * 3;
            data[index] = averageR;
            data[index + 1] = averageG;
            data[index + 2] = averageB;
          }
        }
      }
    }
  }
}

function applyOverlaysToRgb16(
  data: Uint16Array,
  width: number,
  height: number,
  params: ImageEditParams,
  sourceW: number,
  sourceH: number,
  cropX: number,
  cropY: number,
  cropW: number,
  cropH: number,
  rotationDegrees: number,
  outputColorProfile: ImageEditOutputColorProfile,
): void {
  if (!params.drawOverlays.length && !params.textOverlays.length) return;
  const canvas = createImageEditCanvas(width, height);
  try {
    const ctx = getCanvas2dContext(canvas, outputColorProfile, true);
    if (!ctx) throw new Error("2D context unavailable");
    ctx.clearRect(0, 0, width, height);
    drawOverlaysToContext(
      ctx,
      params.drawOverlays,
      sourceW,
      sourceH,
      cropX,
      cropY,
      cropW,
      cropH,
      width,
      height,
      rotationDegrees,
    );
    drawTextOverlaysToContext(
      ctx,
      params.textOverlays,
      sourceW,
      sourceH,
      cropX,
      cropY,
      cropW,
      cropH,
      width,
      height,
      rotationDegrees,
      outputColorProfile,
    );
    const overlay = getCanvasImageData(ctx, 0, 0, width, height, outputColorProfile).data;
    const profile: ImageInputColorProfile = outputColorProfile === "display-p3" ? "display-p3" : "srgb";
    for (let pixel = 0; pixel < width * height; pixel += 1) {
      const overlayIndex = pixel * 4;
      const alpha = (overlay[overlayIndex + 3] ?? 0) / 255;
      if (alpha <= 0) continue;
      const overlayLinear = encodedRgbToLinearProphoto(
        (overlay[overlayIndex] ?? 0) / 255,
        (overlay[overlayIndex + 1] ?? 0) / 255,
        (overlay[overlayIndex + 2] ?? 0) / 255,
        profile,
      );
      const index = pixel * 3;
      for (let channel = 0; channel < 3; channel += 1) {
        const baseLinear = decodeStoredRgb16Channel(data[index + channel] ?? 0, "gamma20", 1);
        const composed = baseLinear * (1 - alpha) + overlayLinear[channel] * alpha;
        data[index + channel] = encodeStoredRgb16Channel(composed, "gamma20", 1);
      }
    }
  } finally {
    releaseCanvasIfNeeded(canvas);
  }
}

type ImageEncodeWorkerResponse = {
  type: "encode-complete";
  blob: Blob;
};

function createImageEncodeWorker(): Worker | null {
  if (typeof Worker !== "function") return null;
  try {
    return new Worker(new URL("./image-editor/image-encode.worker.ts", import.meta.url), {
      type: "module",
    });
  } catch {
    return null;
  }
}

async function encodeImageEditCanvasInWorker(
  canvas: HTMLCanvasElement | OffscreenCanvas,
  outputFormat: ImageEditOutputFormat,
  quality: number,
  outputColorProfile: ImageEditOutputColorProfile,
): Promise<Blob | null> {
  if (outputFormat !== "image/webp") return null;
  const OSC = getOffscreenCanvasCtor();
  if (!OSC) return null;
  const worker = createImageEncodeWorker();
  if (!worker) return null;

  let transferableCanvas: OffscreenCanvas | null = null;
  try {
    transferableCanvas = new OSC(canvas.width, canvas.height);
    const ctx = getCanvas2dContext(transferableCanvas, outputColorProfile);
    if (!ctx) return null;
    ctx.drawImage(canvas, 0, 0, canvas.width, canvas.height);

    return await new Promise<Blob>((resolve, reject) => {
      let timeoutId: ReturnType<typeof setTimeout> | null = null;
      const cleanup = () => {
        if (timeoutId !== null) {
          clearTimeout(timeoutId);
          timeoutId = null;
        }
        worker.removeEventListener("message", onMessage);
        worker.removeEventListener("error", onError);
        worker.removeEventListener("messageerror", onMessageError);
      };
      const onMessage = (event: MessageEvent) => {
        const payload = event.data as ImageEncodeWorkerResponse | { type?: string; message?: string };
        if (payload?.type === "error") {
          cleanup();
          reject(new Error(payload.message || "Image encode worker failed"));
          return;
        }
        if (payload?.type !== "encode-complete") return;
        cleanup();
        resolve((payload as ImageEncodeWorkerResponse).blob);
      };
      const onError = (event: ErrorEvent) => {
        cleanup();
        reject(new Error(event.message || "Image encode worker failed"));
      };
      const onMessageError = () => {
        cleanup();
        reject(new Error("Image encode worker message failed"));
      };
      worker.addEventListener("message", onMessage);
      worker.addEventListener("error", onError);
      worker.addEventListener("messageerror", onMessageError);
      timeoutId = setTimeout(() => {
        cleanup();
        reject(new Error("Image encode worker timed out"));
      }, 30_000);
      const transferred = transferableCanvas!;
      worker.postMessage(
        {
          type: "encode-canvas",
          canvas: transferred,
          mimeType: outputFormat,
          quality,
        },
        [transferred],
      );
      transferableCanvas = null;
    });
  } catch {
    return null;
  } finally {
    if (transferableCanvas) releaseCanvasIfNeeded(transferableCanvas);
    worker.terminate();
  }
}

async function encodeImageEditCanvas(
  canvas: HTMLCanvasElement | OffscreenCanvas,
  outputFormat: ImageEditOutputFormat,
  quality: number,
  outputColorProfile: ImageEditOutputColorProfile,
): Promise<Blob> {
  const workerBlob = await encodeImageEditCanvasInWorker(
    canvas,
    outputFormat,
    quality,
    outputColorProfile,
  );
  if (workerBlob) return workerBlob;

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
    const blob = await encodeImageEditCanvas(
      prepared.canvas,
      outputFormat,
      quality,
      outputColorProfile,
    );
    return { blob, width: prepared.width, height: prepared.height };
  }

  const converted = createImageEditCanvas(prepared.width, prepared.height);
  try {
    const ctx = getCanvas2dContext(converted, outputColorProfile);
    if (!ctx) throw new Error("2D context unavailable");
    ctx.drawImage(prepared.canvas, 0, 0, prepared.width, prepared.height);
    const blob = await encodeImageEditCanvas(
      converted,
      outputFormat,
      quality,
      outputColorProfile,
    );
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
  previewClarityMap?: ImageEditClarityMap | null,
  defringeMap?: DefringeAnalysisMap | null,
  timing?: ImageEditTimingTrace,
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
    undefined,
    previewClarityMap,
    defringeMap,
    timing,
  );
  try {
    return await measureImageEditTiming(
      timing,
      outputFormat === "image/webp" ? "Encoding result WebP" : `Encoding result ${outputFormat}`,
      () => encodeEditedVariant(prepared, quality, outputFormat, resolvedOutputColorProfile),
    );
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
  onApply: (
    params: ImageEditParams,
    decodedImage?: DecodedImage,
    clarityMap?: ImageEditClarityMap | null,
    defringeMap?: DefringeAnalysisMap | null,
    timing?: ImageEditTimingTrace,
  ) => void;
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
type VignetteCreateState = {
  pointerId: number;
  startPoint: EditPoint;
  strengthEv: number;
};
type VignetteEditState =
  | {
      mode: "move";
      pointerId: number;
      startPoint: EditPoint;
      startOverlay: ImageVignetteOverlay;
    }
  | {
      mode: "handle";
      pointerId: number;
      handle: EditCorner;
      startOverlay: ImageVignetteOverlay;
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
const DRAW_DEFAULT_STROKE_WIDTH_INDEX = 1;
const DRAW_DEFAULT_COLOR_INDEX = 0;
const VIGNETTE_DEFAULT_RADIUS_FRACTION = 0.5;
const VIGNETTE_DEFAULT_STRENGTH_EV = 0.5;
const VIGNETTE_OUTLINE_COLOR = "rgba(59,130,246,0.95)";
const VIGNETTE_OUTLINE_WIDTH_PX = 2;

function drawStrokeWidthIndexForOverlay(
  strokeWidth: number,
  sourceW: number,
  sourceH: number,
): number {
  const diagonal = Math.max(1, Math.hypot(sourceW, sourceH));
  const ratio = strokeWidth / diagonal;
  let closest = 0;
  let closestDistance = Infinity;
  for (let index = 0; index < DRAW_STROKE_WIDTH_RATIOS.length; index++) {
    const distance = Math.abs(ratio - DRAW_STROKE_WIDTH_RATIOS[index]);
    if (distance < closestDistance) {
      closest = index;
      closestDistance = distance;
    }
  }
  return closest;
}

function nextDrawFillColorIndex(value: number | null): number | null {
  if (value == null) return 0;
  return value + 1 >= TEXT_OVERLAY_COLORS.length ? null : value + 1;
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


type ImageEditPanelKey = "crop" | "whiteBalance" | "tone" | "color" | "finishing";

type ImageEditUiCollapsePreferences = {
  panels: Record<ImageEditPanelKey, boolean>;
  mobileToolsCollapsed: boolean;
};

const IMAGE_EDIT_UI_COLLAPSE_STORAGE_KEY = "stgy:image-edit-ui-collapse:v1";

function expandedImageEditPanels(): Record<ImageEditPanelKey, boolean> {
  return { crop: false, whiteBalance: false, tone: false, color: false, finishing: false };
}

function collapsedImageEditPanels(): Record<ImageEditPanelKey, boolean> {
  return { crop: true, whiteBalance: true, tone: true, color: true, finishing: true };
}

function loadImageEditUiCollapsePreferences(): ImageEditUiCollapsePreferences | null {
  try {
    const raw = localStorage.getItem(IMAGE_EDIT_UI_COLLAPSE_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<ImageEditUiCollapsePreferences> | null;
    if (!parsed || typeof parsed !== "object" || !parsed.panels || typeof parsed.panels !== "object") {
      return null;
    }
    const defaults = expandedImageEditPanels();
    const panels = { ...defaults };
    for (const panel of Object.keys(defaults) as ImageEditPanelKey[]) {
      const value = parsed.panels[panel];
      if (typeof value === "boolean") panels[panel] = value;
    }
    return {
      panels,
      mobileToolsCollapsed: parsed.mobileToolsCollapsed === true,
    };
  } catch {
    return null;
  }
}

function saveImageEditUiCollapsePreferences(preferences: ImageEditUiCollapsePreferences): void {
  try {
    localStorage.setItem(IMAGE_EDIT_UI_COLLAPSE_STORAGE_KEY, JSON.stringify(preferences));
  } catch {}
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
  const [rawThumbnailRasterSize, setRawThumbnailRasterSize] = useState<{ width: number; height: number } | null>(null);
  const [previewRasterSize, setPreviewRasterSize] = useState<{ width: number; height: number } | null>(null);
  const previewRasterSizeRef = useRef<{ width: number; height: number } | null>(null);
  const [fullResolutionReady, setFullResolutionReady] = useState(false);
  const [rawDevelopmentStage, setRawDevelopmentStage] = useState<"thumbnail" | "preview" | "master" | "denoised" | null>(null);
  const initialPreviewReadyRef = useRef(false);
  const [natural, setNatural] = useState<{ w: number; h: number } | null>(null);
  const previewAreaRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const previewCanvasRef = useRef<HTMLCanvasElement>(null);
  const previewRenderedRef = useRef<{
    decoded: DecodedRgbImage16;
    width: number;
    height: number;
    key: string;
  } | null>(null);
  const previewSourceSampleRef = useRef<{
    decoded: DecodedRgbImage16;
    sample: LinearRgbSample;
    claritySample: LinearRgbSample;
    contextSample: LinearRgbSample;
  } | null>(null);
  const previewToneSampleCacheRef = useRef<{
    source: LinearRgbSample;
    key: string;
    sample: LinearRgbSample;
  } | null>(null);
  const previewClarityMapCacheRef = useRef<{
    source: LinearRgbSample;
    key: string;
    map: ImageEditClarityMap;
  } | null>(null);
  const previewContinuousSliderRef = useRef<ImageEditPreviewSliderStage | null>(null);
  const previewContinuousPrefixCacheRef = useRef<{
    source: LinearRgbSample;
    stage: ImageEditPreviewSliderStage;
    key: string;
    clarityMap: ImageEditClarityMap | null;
    sample: LinearRgbSample;
  } | null>(null);
  const previewRgba8Ref = useRef<Uint8ClampedArray | null>(null);
  const defringeMapRef = useRef<{ decoded: DecodedRgbImage16; map: DefringeAnalysisMap } | null>(null);
  const defringeMapPromiseRef = useRef<{ decoded: DecodedRgbImage16; requestId: number; promise: Promise<DefringeAnalysisMap> } | null>(null);
  const defringeRequestIdRef = useRef(0);
  const decodedImageRef = useRef<DecodedImage | null>(null);
  const transferredDecodedImageRef = useRef<DecodedImage | null>(null);
  const rawMasterPromiseRef = useRef<Promise<DecodedRgbImage16> | null>(null);
  const rawDenoisePromiseRef = useRef<Promise<RawDenoiseDevelopmentResult> | null>(null);
  const rawForegroundPromiseRef = useRef<Promise<DecodedRgbImage16> | null>(null);
  const rawDevelopmentTimingRef = useRef<RawDevelopmentTiming | null>(null);
  const editableThumbnailRequestRef = useRef(0);
  const editableThumbnailReadyRef = useRef(false);
  const rawLogicalSizeRef = useRef<{ width: number; height: number } | null>(null);
  const [decodedRevision, setDecodedRevision] = useState(0);
  const onErrorRef = useRef(onError);
  const onRawDevelopmentReadyRef = useRef(onRawDevelopmentReady);
  const [displayPixelRatio, setDisplayPixelRatio] = useState(1);
  const [desktopEditorZoomEnabled, setDesktopEditorZoomEnabled] = useState(false);
  const [viewportSize, setViewportSize] = useState<{ w: number; h: number }>({ w: 0, h: 0 });
  const [previewAreaSize, setPreviewAreaSize] = useState<{ w: number; h: number }>({ w: 0, h: 0 });
  const [containerSize, setContainerSize] = useState<{ w: number; h: number }>({ w: 0, h: 0 });
  const [displayed, setDisplayed] = useState<EditRect>({ x: 0, y: 0, w: 0, h: 0 });
  const [cropRect, setCropRect] = useState<EditRect>({ x: 0, y: 0, w: 0, h: 0 });
  const displayedRef = useRef<EditRect>({ x: 0, y: 0, w: 0, h: 0 });
  const cropRectRef = useRef<EditRect>({ x: 0, y: 0, w: 0, h: 0 });
  const layoutInitializedRef = useRef(false);
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
  const [denoise, setDenoise] = useState<number>(clampDenoise(initialParams.denoise ?? 0));
  const [defringe, setDefringe] = useState<number>(clampDefringe(initialParams.defringe ?? 0));
  const [exposureEv, setExposureEv] = useState<number>(clampExposureEv(initialParams.exposureEv));
  const [shadow, setShadow] = useState<number>(clampToneRangeAdjustment(initialParams.shadow ?? 0));
  const [highlight, setHighlight] = useState<number>(clampToneRangeAdjustment(initialParams.highlight ?? 0));
  const [scaledLog, setScaledLog] = useState<number>(clampScaledLog(initialParams.scaledLog));
  const [sigmoid, setSigmoid] = useState<number>(clampSigmoid(initialParams.sigmoid));
  const [clarity, setClarity] = useState<number>(clampClarity(initialParams.clarity ?? 0));
  const [vibrance, setVibrance] = useState<number>(clampColorAdjustment(initialParams.vibrance));
  const [saturation, setSaturation] = useState<number>(clampColorAdjustment(initialParams.saturation));
  const [resizePercent, setResizePercent] = useState<number>(
    Math.min(100, Math.max(1, Math.round(initialParams.resizePercent))),
  );
  const [sharpen, setSharpen] = useState<number>(clampSharpen(initialParams.sharpen ?? 0));
  const [filterMode, setFilterMode] = useState(false);
  const [imageFilter, setImageFilter] = useState<ImageFilter | null>(
    normalizeImageFilter(initialParams.filter),
  );
  const [textMode, setTextMode] = useState(false);
  const [textOverlays, setTextOverlays] = useState<ImageTextOverlay[]>(
    normalizeTextOverlays(initialParams.textOverlays),
  );
  const [activeTextId, setActiveTextId] = useState<string | null>(null);
  const [fontLoadingTextId, setFontLoadingTextId] = useState<string | null>(null);
  const [drawMode, setDrawMode] = useState(false);
  const [drawTool, setDrawTool] = useState<ImageDrawTool>("line");
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
  const [vignetteMode, setVignetteMode] = useState(false);
  const [vignetteOverlay, setVignetteOverlay] = useState<ImageVignetteOverlay | null>(
    normalizeVignetteOverlay(initialParams.vignetteOverlay),
  );
  const [vignetteDraft, setVignetteDraft] = useState<ImageVignetteOverlay | null>(null);
  const vignetteCreateState = useRef<VignetteCreateState | null>(null);
  const vignetteEditState = useRef<VignetteEditState | null>(null);
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
  const [autoToneStage, setAutoToneStage] = useState<string | null>(null);
  const [applyBusy, setApplyBusy] = useState(false);
  const [collapsedPanels, setCollapsedPanels] = useState<Record<ImageEditPanelKey, boolean>>(
    expandedImageEditPanels,
  );
  const [mobileToolsCollapsed, setMobileToolsCollapsed] = useState(false);
  const finishButtonRef = useRef<HTMLButtonElement>(null);
  const initialPanelFitCheckedRef = useRef(false);
  const collapsePreferencesLoadedRef = useRef(false);
  const hasStoredCollapsePreferencesRef = useRef(false);
  const [peepMode, setPeepMode] = useState(false);
  const [peepExpanded, setPeepExpanded] = useState(false);
  const [peepRect, setPeepRect] = useState<EditRect>({ x: 0, y: 0, w: 0, h: 0 });
  const peepRectRef = useRef<EditRect>({ x: 0, y: 0, w: 0, h: 0 });
  const [peepRenderRevision, setPeepRenderRevision] = useState(0);
  const [peepTileQueueTick, setPeepTileQueueTick] = useState(0);
  const peepDisplayCanvasRef = useRef<HTMLCanvasElement>(null);
  const peepRequestedCenterRef = useRef<EditPoint | null>(null);
  const peepTileCacheRef = useRef<Map<string, PeepTileCacheEntry>>(new Map());
  const peepTileQueueRef = useRef<PeepTileJob[]>([]);
  const peepTileRevisionRef = useRef(0);
  const peepTileSettingsKeyRef = useRef<string | null>(null);
  const peepTileRenderingRef = useRef(false);
  const peepTileResumeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const peepSliderPointerActiveRef = useRef(false);
  const peepSliderLastInputAtRef = useRef(0);
  const peepSliderLastReleaseAtRef = useRef(0);
  const peepSessionActiveRef = useRef(false);
  const peepCompositeRafRef = useRef<number | null>(null);
  const peepCompositePendingRectRef = useRef<EditRect | null>(null);
  const peepPanRafRef = useRef<number | null>(null);
  const peepPanPendingRectRef = useRef<EditRect | null>(null);
  const peepExpandedDragStateRef = useRef<
    | null
    | {
      pointerId: number;
      startClientX: number;
      startClientY: number;
      startRect: EditRect;
      viewWidth: number;
      viewHeight: number;
      moved: boolean;
    }
  >(null);
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

  useEffect(() => {
    const preferences = loadImageEditUiCollapsePreferences();
    if (preferences) {
      setCollapsedPanels(preferences.panels);
      setMobileToolsCollapsed(preferences.mobileToolsCollapsed);
      hasStoredCollapsePreferencesRef.current = true;
    }
    collapsePreferencesLoadedRef.current = true;
    setMounted(true);
  }, []);

  const togglePanelCollapsed = useCallback((panel: ImageEditPanelKey) => {
    setCollapsedPanels((current) => ({ ...current, [panel]: !current[panel] }));
  }, []);

  useEffect(() => {
    if (!mounted || initialPanelFitCheckedRef.current) return;
    if (hasStoredCollapsePreferencesRef.current) {
      initialPanelFitCheckedRef.current = true;
      return;
    }
    if (typeof window === "undefined" || !window.matchMedia("(max-width: 1023px)").matches) {
      initialPanelFitCheckedRef.current = true;
      return;
    }
    let secondFrame = 0;
    const firstFrame = window.requestAnimationFrame(() => {
      secondFrame = window.requestAnimationFrame(() => {
        const finishButton = finishButtonRef.current;
        if (!finishButton) return;
        initialPanelFitCheckedRef.current = true;
        const viewportHeight = window.visualViewport?.height ?? window.innerHeight;
        const rect = finishButton.getBoundingClientRect();
        if (rect.top < 0 || rect.bottom > viewportHeight) {
          setCollapsedPanels(collapsedImageEditPanels());
          setMobileToolsCollapsed(true);
        }
      });
    });
    return () => {
      window.cancelAnimationFrame(firstFrame);
      if (secondFrame) window.cancelAnimationFrame(secondFrame);
    };
  }, [mounted]);

  useEffect(() => {
    if (
      !mounted
      || !collapsePreferencesLoadedRef.current
      || !initialPanelFitCheckedRef.current
    ) return;
    saveImageEditUiCollapsePreferences({ panels: collapsedPanels, mobileToolsCollapsed });
  }, [collapsedPanels, mobileToolsCollapsed, mounted]);

  useEffect(() => {
    onErrorRef.current = onError;
  }, [onError]);

  useEffect(() => {
    onRawDevelopmentReadyRef.current = onRawDevelopmentReady;
  }, [onRawDevelopmentReady]);

  useEffect(() => {
    const peepTileCache = peepTileCacheRef.current;
    return () => {
      if (peepCompositeRafRef.current !== null) cancelAnimationFrame(peepCompositeRafRef.current);
      if (peepPanRafRef.current !== null) cancelAnimationFrame(peepPanRafRef.current);
      if (peepTileResumeTimerRef.current !== null) {
        clearTimeout(peepTileResumeTimerRef.current);
        peepTileResumeTimerRef.current = null;
      }
      peepTileQueueRef.current = [];
      for (const entry of peepTileCache.values()) releasePeepTileSource(entry.source);
      peepTileCache.clear();
    };
  }, []);


  useEffect(() => {
    peepRectRef.current = peepRect;
  }, [peepRect]);

  const invalidateRenderDerivedCaches = useCallback(() => {
    previewRenderedRef.current = null;
    previewSourceSampleRef.current = null;
    previewToneSampleCacheRef.current = null;
    previewClarityMapCacheRef.current = null;
    previewContinuousPrefixCacheRef.current = null;
    previewRgba8Ref.current = null;
    previewRasterSizeRef.current = null;
    setPreviewRasterSize(null);
    setHistogram(null);
    setPercentileDebug(null);
  }, []);

  const invalidateBaseDerivedCaches = useCallback((previous?: DecodedRgbImage16 | null) => {
    if (previous) clearRgb16SampleCaches(previous);
    const current = decodedImageRef.current;
    if (current && current !== previous) clearRgb16SampleCaches(current);
    invalidateRenderDerivedCaches();
    defringeRequestIdRef.current += 1;
    defringeMapRef.current = null;
    defringeMapPromiseRef.current = null;
  }, [invalidateRenderDerivedCaches]);

  const ensureDefringeMap = useCallback((decoded: DecodedRgbImage16): Promise<DefringeAnalysisMap> => {
    const cached = defringeMapRef.current;
    if (cached?.decoded === decoded) return Promise.resolve(cached.map);
    const active = defringeMapPromiseRef.current;
    if (active?.decoded === decoded) return active.promise;

    const requestId = ++defringeRequestIdRef.current;
    const promise = buildDefringeAnalysisSample(decoded)
      .then((sample) => analyzeDefringeSampleAsync(sample))
      .then((map) => {
      if (defringeRequestIdRef.current === requestId && decodedImageRef.current === decoded) {
        defringeMapRef.current = { decoded, map };
        defringeMapPromiseRef.current = null;
      }
      return map;
    }).catch((error) => {
      if (defringeRequestIdRef.current === requestId) {
        defringeMapPromiseRef.current = null;
      }
      throw error;
    });
    defringeMapPromiseRef.current = { decoded, requestId, promise };
    return promise;
  }, []);

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
    setRawThumbnailRasterSize({ width: preview.width, height: preview.height });
    setRawDevelopmentStage("thumbnail");
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
    initialPreviewReadyRef.current = false;
    layoutInitializedRef.current = false;
    setImageReady(false);
    setLoadingStage(initialDecodedImage ? "Preparing preview…" : "Loading image…");
    clearEmbeddedRawPreview();
    setNatural(null);
    setShowPercentileDebug(false);
    setPercentileDebug(null);
    setRawThumbnailDebugStatistics(undefined);
    setRawDevelopmentMemoryUsage(undefined);
    const previousBaseDecoded = decodedImageRef.current;
    invalidateBaseDerivedCaches(previousBaseDecoded);
    decodedImageRef.current = null;
    transferredDecodedImageRef.current = null;
    rawMasterPromiseRef.current = null;
    rawDenoisePromiseRef.current = null;
    rawForegroundPromiseRef.current = null;
    rawDevelopmentTimingRef.current = null;
    editableThumbnailRequestRef.current += 1;
    editableThumbnailReadyRef.current = false;
    previewRenderedRef.current = null;
    previewRasterSizeRef.current = null;
    setPreviewRasterSize(null);
    setRawThumbnailRasterSize(null);
    setFullResolutionReady(false);
    setRawDevelopmentStage(null);
    rawLogicalSizeRef.current = null;

    const onLoadProgress: ImageLoadProgressListener = (progress) => {
      if (cancelled) return;
      if (progress.rawTiming) rawDevelopmentTimingRef.current = progress.rawTiming;
      if (!editableThumbnailReadyRef.current) setLoadingStage(progress.stage);
      if (progress.embeddedPreview) {
        showEmbeddedRawPreview(progress.embeddedPreview);
        const preview = progress.embeddedPreview;
        const timing = progress.rawTiming ?? rawDevelopmentTimingRef.current ?? undefined;
        const editableThumbnailStartedAt = performance.now();
        const requestId = ++editableThumbnailRequestRef.current;
        void rawEditableThumbnailToDecodedParallel(preview).then((thumbnailDecoded) => {
          if (cancelled || editableThumbnailRequestRef.current !== requestId) {
            thumbnailDecoded.cleanup();
            return;
          }
          if (timing) {
            recordRawTimingOnce(
              timing,
              "preview",
              "Building editable thumbnail buffer",
              performance.now() - editableThumbnailStartedAt,
            );
            recordRawTimingOnce(
              timing,
              "preview",
              "Editable thumbnail buffer ready",
              performance.now() - timing.startedAtMs,
            );
          }
          const previousDecoded = decodedImageRef.current;
          decodedImageRef.current = thumbnailDecoded;
          cleanup = thumbnailDecoded.cleanup;
          editableThumbnailReadyRef.current = true;
          invalidateBaseDerivedCaches(previousDecoded);
          const logicalWidth = preview.sourceWidth && preview.sourceWidth > 0 ? preview.sourceWidth : preview.width;
          const logicalHeight = preview.sourceHeight && preview.sourceHeight > 0 ? preview.sourceHeight : preview.height;
          rawLogicalSizeRef.current = { width: logicalWidth, height: logicalHeight };
          setNatural({ w: logicalWidth, h: logicalHeight });
          setImageReady(true);
          setFullResolutionReady(false);
          setRawDevelopmentStage("thumbnail");
          setLoadingStage(null);
          setDecodedRevision((revision) => revision + 1);
          if (previousDecoded && previousDecoded !== thumbnailDecoded) previousDecoded.cleanup();
        }).catch(() => {
          // Embedded preview remains visible while the normal RAW Preview loads.
        });
      }
    };

    void (async () => {
      try {
        const isRaw = isRawImageFile(file.name, file.type);
        const foregroundPromise = initialDecodedImage
          ? Promise.resolve(initialDecodedImage)
          : decodeImage(
              file,
              0,
              0,
              file.name,
              file.type,
              rawDemosaicQuality,
              rawHighlightMode,
              onLoadProgress,
            );
        if (isRaw) rawForegroundPromiseRef.current = foregroundPromise;
        const decoded = await foregroundPromise;
        decodedForEffect = decoded;
        if (isRaw) {
          onRawDevelopmentReadyRef.current?.(decoded);
        }
        if (cancelled) {
          if (ownsDecodedImage && !(isRaw && onRawDevelopmentReadyRef.current)) {
            decoded.cleanup();
          }
          return;
        }
        const previousDecoded = decodedImageRef.current;
        editableThumbnailRequestRef.current += 1;
        editableThumbnailReadyRef.current = false;
        cleanup = decoded.cleanup;
        decodedImageRef.current = decoded;
        invalidateBaseDerivedCaches(previousDecoded);
        if (previousDecoded && previousDecoded !== decoded) previousDecoded.cleanup();
        setLoadingStage(null);
        const logicalSize = isRaw ? rawLogicalSizeRef.current : null;
        setNatural(logicalSize
          ? { w: logicalSize.width, h: logicalSize.height }
          : { w: decoded.width, h: decoded.height });
        setImageReady(true);
        setFullResolutionReady(!(isRaw && decoded.rawMasterPromise));
        if (isRaw) {
          setRawDevelopmentStage(
            decoded.rawDevelopment?.denoise
              ? "denoised"
              : decoded.rawMasterPromise
                ? "preview"
                : "master",
          );
        }

        if (isRaw && decoded.rawDenoisePromise) {
          const denoisePromise = decoded.rawDenoisePromise;
          rawDenoisePromiseRef.current = denoisePromise;
          void denoisePromise.then(async (denoiseResult) => {
            const denoiseDecoded = denoiseResult.decoded;
            const weightMap = denoiseResult.weightMap;
            let adopted = false;
            try {
              if (cancelled || rawDenoisePromiseRef.current !== denoisePromise) return;
              const masterDecoded = decodedImageRef.current;
              if (!masterDecoded) {
                throw new Error("RAW denoise merge inputs are unavailable");
              }
              const mergeStartedAt = performance.now();
              const merged = await mergeRawMasterIntoDenoiseInPlace(
                masterDecoded,
                denoiseDecoded,
                weightMap,
                () => cancelled || rawDenoisePromiseRef.current !== denoisePromise,
              );
              if (!merged || cancelled || rawDenoisePromiseRef.current !== denoisePromise) return;

              const denoiseDevelopment = denoiseDecoded.rawDevelopment?.denoise;
              if (denoiseDevelopment) {
                denoiseDevelopment.elapsedSeconds += (performance.now() - mergeStartedAt) / 1000;
              }
              // The merge has consumed the low-resolution weight map. Drop its
              // backing store even if a settled background Promise remains reachable.
              denoiseResult.weightMap = { width: 0, height: 0, data: new Float32Array(0) };
              masterDecoded.rawDenoisePromise = undefined;
              const previousCleanup = cleanup;
              decodedImageRef.current = denoiseDecoded;
              decodedForEffect = denoiseDecoded;
              cleanup = denoiseDecoded.cleanup;
              rawDenoisePromiseRef.current = null;
              invalidateBaseDerivedCaches(masterDecoded);
              const logicalSize = rawLogicalSizeRef.current;
              setNatural(logicalSize
                ? { w: logicalSize.width, h: logicalSize.height }
                : { w: denoiseDecoded.width, h: denoiseDecoded.height });
              setRawDevelopmentStage("denoised");
              setDecodedRevision((revision) => revision + 1);
              onRawDevelopmentReadyRef.current?.(denoiseDecoded);
              adopted = true;
              if (masterDecoded !== denoiseDecoded) previousCleanup?.();
            } finally {
              if (!adopted) denoiseDecoded.cleanup();
            }
          }).catch(() => {
            // Denoise is an optional background quality stage. Preview/Master
            // remain valid if it fails.
          });
        }

        if (isRaw && decoded.rawMasterPromise) {
          const masterPromise = decoded.rawMasterPromise;
          rawMasterPromiseRef.current = masterPromise;
          void masterPromise.then((masterDecoded) => {
            if (cancelled || rawMasterPromiseRef.current !== masterPromise) return;
            const previousDecoded = decodedImageRef.current;
            decodedImageRef.current = masterDecoded;
            decodedForEffect = masterDecoded;
            cleanup = masterDecoded.cleanup;
            invalidateBaseDerivedCaches(previousDecoded);
            const logicalSize = rawLogicalSizeRef.current;
            setNatural(logicalSize
              ? { w: logicalSize.width, h: logicalSize.height }
              : { w: masterDecoded.width, h: masterDecoded.height });
            setFullResolutionReady(true);
            setRawDevelopmentStage("master");
            setDecodedRevision((revision) => revision + 1);
            onRawDevelopmentReadyRef.current?.(masterDecoded);
          }).catch(() => {
            // Preview editing remains usable. The error is surfaced if an operation
            // actually requires the full-resolution Master image.
          });
        }
      } catch (error) {
        if (!cancelled) {
          invalidateBaseDerivedCaches(decodedImageRef.current);
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
      editableThumbnailRequestRef.current += 1;
      rawForegroundPromiseRef.current = null;
      rawLogicalSizeRef.current = null;
      invalidateBaseDerivedCaches(decodedImageRef.current);
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
    invalidateBaseDerivedCaches,
  ]);

  useEffect(() => {
    const decoded = decodedImageRef.current;
    if (!decoded || clampDefringe(defringe) === 0) return;
    void ensureDefringeMap(decoded).catch((error) => {
      onErrorRef.current?.(error instanceof Error ? error.message : String(error));
    });
  }, [defringe, decodedRevision, ensureDefringeMap]);

  useEffect(() => {
    if (!mounted || typeof window === "undefined") return;
    let resolutionQuery: MediaQueryList | null = null;
    const updatePixelRatio = () => {
      const next = Number.isFinite(window.devicePixelRatio) && window.devicePixelRatio > 0
        ? window.devicePixelRatio
        : 1;
      setDisplayPixelRatio((current) => Math.abs(current - next) > 1e-6 ? next : current);
      if (resolutionQuery) resolutionQuery.removeEventListener("change", updatePixelRatio);
      resolutionQuery = window.matchMedia(`(resolution: ${next}dppx)`);
      resolutionQuery.addEventListener("change", updatePixelRatio);
    };
    updatePixelRatio();
    window.addEventListener("resize", updatePixelRatio);
    return () => {
      window.removeEventListener("resize", updatePixelRatio);
      resolutionQuery?.removeEventListener("change", updatePixelRatio);
    };
  }, [mounted]);

  useEffect(() => {
    if (!mounted || typeof window === "undefined") return;
    const desktopInputQuery = window.matchMedia("(hover: hover) and (pointer: fine)");
    const updateDesktopEditorZoom = () => setDesktopEditorZoomEnabled(desktopInputQuery.matches);
    updateDesktopEditorZoom();
    desktopInputQuery.addEventListener("change", updateDesktopEditorZoom);
    return () => desktopInputQuery.removeEventListener("change", updateDesktopEditorZoom);
  }, [mounted]);

  useEffect(() => {
    if (!mounted || typeof window === "undefined") return;
    const updateViewportSize = () => {
      const visualViewport = window.visualViewport;
      const w = Math.max(1, visualViewport?.width ?? document.documentElement.clientWidth ?? window.innerWidth ?? 1);
      const h = Math.max(1, visualViewport?.height ?? document.documentElement.clientHeight ?? window.innerHeight ?? 1);
      setViewportSize((current) =>
        Math.abs(current.w - w) > 0.01 || Math.abs(current.h - h) > 0.01 ? { w, h } : current,
      );
    };
    updateViewportSize();
    window.addEventListener("resize", updateViewportSize);
    window.visualViewport?.addEventListener("resize", updateViewportSize);
    return () => {
      window.removeEventListener("resize", updateViewportSize);
      window.visualViewport?.removeEventListener("resize", updateViewportSize);
    };
  }, [mounted]);

  const editorUiZoom = desktopEditorZoomEnabled ? 1 / Math.max(1e-6, displayPixelRatio) : 1;
  const imageStageZoom = desktopEditorZoomEnabled ? Math.max(1e-6, displayPixelRatio) : 1;
  const editorLayoutViewport = useMemo(() => {
    if (!desktopEditorZoomEnabled) return viewportSize;
    return {
      w: viewportSize.w / Math.max(1e-6, editorUiZoom),
      h: viewportSize.h / Math.max(1e-6, editorUiZoom),
    };
  }, [desktopEditorZoomEnabled, editorUiZoom, viewportSize]);
  const desktopDialogWidth = desktopEditorZoomEnabled && editorLayoutViewport.w > 0
    ? Math.min(1400, editorLayoutViewport.w * 0.95)
    : undefined;
  const editorUsesSidePanel = editorLayoutViewport.w >= 1024;
  const desktopDialogMaxHeight = desktopEditorZoomEnabled && editorLayoutViewport.h > 0
    ? (editorLayoutViewport.h < 1400
        ? Math.max(1, (viewportSize.h - 4) / Math.max(1e-6, editorUiZoom))
        : editorLayoutViewport.h * 0.95)
    : undefined;

  useEffect(() => {
    if (!mounted || typeof window === "undefined") return;
    const previewArea = previewAreaRef.current;
    if (!previewArea) return;
    const updateSize = () => {
      const rect = previewArea.getBoundingClientRect();
      const viewportHeight = Math.max(1, window.visualViewport?.height ?? document.documentElement.clientHeight ?? window.innerHeight ?? 1);
      const uiScreenScale = desktopEditorZoomEnabled ? editorUiZoom : 1;
      const availableHeight = desktopEditorZoomEnabled
        ? Math.min(1100 * uiScreenScale, Math.max(1, viewportHeight - 120 * uiScreenScale))
        : Math.max(270, viewportHeight * 0.42);
      let targetHeight = availableHeight;
      if (!editorUsesSidePanel && natural && rect.width > 0 && displayPixelRatio > 0) {
        const margin = EDIT_PREVIEW_MARGIN_PX;
        const innerWidth = Math.max(1, rect.width - margin * 2);
        const innerHeight = Math.max(1, availableHeight - margin * 2);
        const raster = imageEditPreviewDimensions(
          natural.w,
          natural.h,
          innerWidth * displayPixelRatio,
          innerHeight * displayPixelRatio,
        );
        targetHeight = Math.min(
          availableHeight,
          Math.max(1, raster.height / displayPixelRatio + margin * 2),
        );
      }
      setPreviewAreaSize((current) =>
        Math.abs(current.w - rect.width) > 0.01 || Math.abs(current.h - targetHeight) > 0.01
          ? { w: rect.width, h: targetHeight }
          : current,
      );
    };
    updateSize();
    const ro = new ResizeObserver(updateSize);
    ro.observe(previewArea);
    window.addEventListener("resize", updateSize);
    window.visualViewport?.addEventListener("resize", updateSize);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", updateSize);
      window.visualViewport?.removeEventListener("resize", updateSize);
    };
  }, [mounted, desktopEditorZoomEnabled, editorUiZoom, editorUsesSidePanel, natural, displayPixelRatio]);

  useEffect(() => {
    if (!mounted) return;
    const container = containerRef.current;
    if (!container) return;
    const updateSize = () => {
      // Use fractional CSS pixels so raster/DPR can remain an exact display size.
      const rect = container.getBoundingClientRect();
      setContainerSize((current) =>
        Math.abs(current.w - rect.width) > 0.01 || Math.abs(current.h - rect.height) > 0.01
          ? { w: rect.width, h: rect.height }
          : current,
      );
    };
    updateSize();
    const ro = new ResizeObserver(updateSize);
    ro.observe(container);
    return () => ro.disconnect();
  }, [mounted]);

  useEffect(() => {
    displayedRef.current = displayed;
  }, [displayed]);

  useEffect(() => {
    cropRectRef.current = cropRect;
  }, [cropRect]);

  const fitImage = useCallback((nat: { w: number; h: number }, cw: number, ch: number): EditRect => {
    if (nat.w <= 0 || nat.h <= 0 || cw <= 0 || ch <= 0 || displayPixelRatio <= 0) {
      return { x: 0, y: 0, w: 0, h: 0 };
    }
    const margin = EDIT_PREVIEW_MARGIN_PX;
    const innerW = Math.max(1, cw - margin * 2);
    const innerH = Math.max(1, ch - margin * 2);
    const raster = imageEditPreviewDimensions(
      nat.w,
      nat.h,
      innerW * displayPixelRatio,
      innerH * displayPixelRatio,
    );
    const w = raster.width / displayPixelRatio;
    const h = raster.height / displayPixelRatio;
    return {
      x: (cw - w) / 2,
      y: (ch - h) / 2,
      w,
      h,
    };
  }, [displayPixelRatio]);

  useEffect(() => {
    if (!natural || containerSize.w <= 0 || containerSize.h <= 0) return;
    const previousDisplayed = displayedRef.current;
    const previousCropRect = cropRectRef.current;
    const d = fitImage(natural, containerSize.w, containerSize.h);
    let crop = normalizeCrop(initialParams.crop);
    if (
      layoutInitializedRef.current &&
      previousDisplayed.w > 0 &&
      previousDisplayed.h > 0 &&
      previousCropRect.w > 0 &&
      previousCropRect.h > 0
    ) {
      crop = normalizeCrop({
        left: (previousCropRect.x - previousDisplayed.x) / previousDisplayed.w,
        top: (previousCropRect.y - previousDisplayed.y) / previousDisplayed.h,
        right: 1 - (previousCropRect.x + previousCropRect.w - previousDisplayed.x) / previousDisplayed.w,
        bottom: 1 - (previousCropRect.y + previousCropRect.h - previousDisplayed.y) / previousDisplayed.h,
      });
    }
    const x = d.x + d.w * crop.left;
    const y = d.y + d.h * crop.top;
    const right = d.x + d.w * (1 - crop.right);
    const bottom = d.y + d.h * (1 - crop.bottom);
    const nextCropRect = {
      x,
      y,
      w: Math.max(40, right - x),
      h: Math.max(40, bottom - y),
    };
    layoutInitializedRef.current = true;
    displayedRef.current = d;
    cropRectRef.current = nextCropRect;
    setDisplayed(d);
    setCropRect(nextCropRect);
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

  const toLocal = useCallback((e: React.PointerEvent | React.MouseEvent): EditPoint => {
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

  const previewPointToSourceNormalized = useCallback((point: EditPoint): EditPoint | null => {
    if (!natural || displayed.w <= 0 || displayed.h <= 0) return null;
    const renderedX = (point.x - displayed.x) / displayed.w * natural.w;
    const renderedY = (point.y - displayed.y) / displayed.h * natural.h;
    const source = inverseRotatePoint(
      renderedX,
      renderedY,
      natural.w / 2,
      natural.h / 2,
      rotationDegrees,
    );
    if (source.x < 0 || source.x > natural.w || source.y < 0 || source.y > natural.h) return null;
    return {
      x: clamp01(source.x / natural.w),
      y: clamp01(source.y / natural.h),
    };
  }, [displayed.h, displayed.w, displayed.x, displayed.y, natural, rotationDegrees]);

  const sourceNormalizedToPreviewPoint = useCallback((x: number, y: number): EditPoint | null => {
    if (!natural || displayed.w <= 0 || displayed.h <= 0) return null;
    const rendered = rotatePoint(
      x * natural.w,
      y * natural.h,
      natural.w / 2,
      natural.h / 2,
      rotationDegrees,
    );
    return {
      x: displayed.x + rendered.x / natural.w * displayed.w,
      y: displayed.y + rendered.y / natural.h * displayed.h,
    };
  }, [displayed.h, displayed.w, displayed.x, displayed.y, natural, rotationDegrees]);

  const displayPointToNormalized = useCallback((point: EditPoint): EditPoint | null => {
    if (displayed.w <= 0 || displayed.h <= 0) return null;
    return {
      x: (point.x - displayed.x) / displayed.w,
      y: (point.y - displayed.y) / displayed.h,
    };
  }, [displayed.h, displayed.w, displayed.x, displayed.y]);

  const normalizedToDisplayPoint = useCallback((x: number, y: number): EditPoint => ({
    x: displayed.x + x * displayed.w,
    y: displayed.y + y * displayed.h,
  }), [displayed.h, displayed.w, displayed.x, displayed.y]);

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

  const constrainVignetteEndPoint = useCallback((
    start: EditPoint,
    rawEnd: EditPoint,
    constrain: boolean,
  ): EditPoint => {
    const end = clampPointToDisplayed(rawEnd);
    if (!constrain) return end;
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const signX = dx < 0 ? -1 : 1;
    const signY = dy < 0 ? -1 : 1;
    const wantedSize = Math.max(Math.abs(dx), Math.abs(dy));
    const availableX = signX > 0 ? displayed.x + displayed.w - start.x : start.x - displayed.x;
    const availableY = signY > 0 ? displayed.y + displayed.h - start.y : start.y - displayed.y;
    const size = Math.max(0, Math.min(wantedSize, availableX, availableY));
    return { x: start.x + signX * size, y: start.y + signY * size };
  }, [clampPointToDisplayed, displayed]);

  const previewToOverlayPoint = useCallback((point: EditPoint): { left: number; top: number } | null => {
    const source = previewPointToSourceNormalized(clampPointToCropRect(point));
    return source ? { left: source.x, top: source.y } : null;
  }, [clampPointToCropRect, previewPointToSourceNormalized]);

  const overlayToPreviewTextPoint = useCallback((overlay: ImageTextOverlay): EditPoint | null =>
    sourceNormalizedToPreviewPoint(overlay.left, overlay.top),
  [sourceNormalizedToPreviewPoint]);

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

  const cycleDrawOverlayStrokeWidth = useCallback((id: string) => {
    if (!natural) return;
    const diagonal = Math.max(1, Math.hypot(natural.w, natural.h));
    updateDrawOverlay(id, (current) => {
      const currentIndex = drawStrokeWidthIndexForOverlay(
        current.strokeWidth,
        natural.w,
        natural.h,
      );
      const nextIndex = (currentIndex + 1) % DRAW_STROKE_WIDTH_RATIOS.length;
      return {
        ...current,
        strokeWidth: Math.max(1, diagonal * DRAW_STROKE_WIDTH_RATIOS[nextIndex]),
      };
    });
  }, [natural, updateDrawOverlay]);

  const cycleDrawOverlayStrokeColor = useCallback((id: string) => {
    updateDrawOverlay(id, (current) => ({
      ...current,
      colorIndex: (normalizeTextColorIndex(current.colorIndex) + 1) % TEXT_OVERLAY_COLORS.length,
    }));
  }, [updateDrawOverlay]);

  const cycleDrawOverlayFillColor = useCallback((id: string) => {
    updateDrawOverlay(id, (current) => current.type === "line"
      ? current
      : {
          ...current,
          fillColorIndex: nextDrawFillColorIndex(current.fillColorIndex),
        });
  }, [updateDrawOverlay]);

  const drawOverlayFromPreviewPoints = useCallback((
    id: string,
    type: ImageDrawTool,
    start: EditPoint,
    end: EditPoint,
    strokeWidth: number,
    colorIndex: number,
  ): ImageDrawOverlay | null => {
    const a = previewPointToSourceNormalized(start);
    const b = previewPointToSourceNormalized(end);
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
        fillColorIndex: null,
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
      fillColorIndex: null,
    };
  }, [previewPointToSourceNormalized]);

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
      Math.hypot(natural.w, natural.h) * DRAW_STROKE_WIDTH_RATIOS[DRAW_DEFAULT_STROKE_WIDTH_INDEX],
    );
    drawCreateState.current = {
      pointerId: e.pointerId,
      startPoint,
      type: drawTool,
      strokeWidth,
      colorIndex: DRAW_DEFAULT_COLOR_INDEX,
    };
    e.currentTarget.setPointerCapture(e.pointerId);
    setDrawDraft(drawOverlayFromPreviewPoints(
      "draw-draft",
      drawTool,
      startPoint,
      startPoint,
      strokeWidth,
      DRAW_DEFAULT_COLOR_INDEX,
    ) ?? {
      id: "draw-draft",
      type: drawTool,
      x1: 0,
      y1: 0,
      x2: 0,
      y2: 0,
      strokeWidth,
      colorIndex: DRAW_DEFAULT_COLOR_INDEX,
      fillColorIndex: null,
    });
    e.preventDefault();
    e.stopPropagation();
  }, [
    clampPointToCropRect,
    cropRect,
    drawMode,
    drawOverlayFromPreviewPoints,
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
      const start = state.startOverlay;
      const p1 = sourceNormalizedToPreviewPoint(start.x1, start.y1);
      const p2 = sourceNormalizedToPreviewPoint(start.x2, start.y2);
      if (!p1 || !p2) return;
      const rawDx = point.x - state.startPoint.x;
      const rawDy = point.y - state.startPoint.y;
      const minX = Math.min(p1.x, p2.x);
      const maxX = Math.max(p1.x, p2.x);
      const minY = Math.min(p1.y, p2.y);
      const maxY = Math.max(p1.y, p2.y);
      const clampedDx = maxX - minX <= cropRect.w
        ? Math.max(cropRect.x - minX, Math.min(cropRect.x + cropRect.w - maxX, rawDx))
        : rawDx;
      const clampedDy = maxY - minY <= cropRect.h
        ? Math.max(cropRect.y - minY, Math.min(cropRect.y + cropRect.h - maxY, rawDy))
        : rawDy;
      const n1 = previewPointToSourceNormalized({ x: p1.x + clampedDx, y: p1.y + clampedDy });
      const n2 = previewPointToSourceNormalized({ x: p2.x + clampedDx, y: p2.y + clampedDy });
      if (!n1 || !n2) return;
      updateDrawOverlay(state.id, () => ({
        ...start,
        x1: n1.x,
        y1: n1.y,
        x2: n2.x,
        y2: n2.y,
      }));
    } else {
      const start = state.startOverlay;
      if (start.type === "line") {
        const fixed = state.handle === "start"
          ? sourceNormalizedToPreviewPoint(start.x2, start.y2)
          : sourceNormalizedToPreviewPoint(start.x1, start.y1);
        if (!fixed) return;
        const moving = constrainDrawEndPoint("line", fixed, point, e.shiftKey);
        const normalized = previewPointToSourceNormalized(moving);
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
        const fixed = sourceNormalizedToPreviewPoint(fixedNormalized.x, fixedNormalized.y);
        if (!fixed) return;
        const moving = constrainDrawEndPoint(start.type, fixed, point, e.shiftKey);
        const normalized = previewPointToSourceNormalized(moving);
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
    previewPointToSourceNormalized,
    cropRect.h,
    cropRect.w,
    cropRect.x,
    cropRect.y,
    sourceNormalizedToPreviewPoint,
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

  const vignetteOverlayFromPreviewPoints = useCallback((
    id: string,
    start: EditPoint,
    end: EditPoint,
    strengthEv: number,
  ): ImageVignetteOverlay | null => {
    const a = displayPointToNormalized(start);
    const b = displayPointToNormalized(end);
    if (!a || !b) return null;
    return normalizeVignetteOverlay({
      id,
      x1: Math.min(a.x, b.x),
      y1: Math.min(a.y, b.y),
      x2: Math.max(a.x, b.x),
      y2: Math.max(a.y, b.y),
      strengthEv,
    });
  }, [displayPointToNormalized]);

  const onVignettePointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!vignetteMode || e.button !== 0 || displayed.w <= 0 || displayed.h <= 0) return;
    const point = toLocal(e);
    if (
      point.x < displayed.x ||
      point.x > displayed.x + displayed.w ||
      point.y < displayed.y ||
      point.y > displayed.y + displayed.h
    ) {
      return;
    }
    const startPoint = clampPointToDisplayed(point);
    vignetteCreateState.current = {
      pointerId: e.pointerId,
      startPoint,
      strengthEv: vignetteOverlay?.strengthEv ?? VIGNETTE_DEFAULT_STRENGTH_EV,
    };
    e.currentTarget.setPointerCapture(e.pointerId);
    setVignetteDraft(vignetteOverlayFromPreviewPoints(
      "vignette-draft",
      startPoint,
      startPoint,
      vignetteOverlay?.strengthEv ?? VIGNETTE_DEFAULT_STRENGTH_EV,
    ) ?? {
      id: "vignette-draft",
      x1: 0,
      y1: 0,
      x2: 0,
      y2: 0,
      strengthEv: vignetteOverlay?.strengthEv ?? VIGNETTE_DEFAULT_STRENGTH_EV,
    });
    e.preventDefault();
    e.stopPropagation();
  }, [clampPointToDisplayed, displayed.h, displayed.w, displayed.x, displayed.y, toLocal, vignetteMode, vignetteOverlay, vignetteOverlayFromPreviewPoints]);

  const onVignettePointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    const state = vignetteCreateState.current;
    if (!state || state.pointerId !== e.pointerId) return;
    const endPoint = constrainVignetteEndPoint(state.startPoint, toLocal(e), e.shiftKey);
    const draft = vignetteOverlayFromPreviewPoints(
      "vignette-draft",
      state.startPoint,
      endPoint,
      state.strengthEv,
    );
    if (draft) setVignetteDraft(draft);
    e.preventDefault();
    e.stopPropagation();
  }, [constrainVignetteEndPoint, toLocal, vignetteOverlayFromPreviewPoints]);

  const finishVignetteCreation = useCallback((e: React.PointerEvent<HTMLDivElement>, cancelled = false) => {
    const state = vignetteCreateState.current;
    if (!state || state.pointerId !== e.pointerId) return;
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {}
    if (!cancelled) {
      const endPoint = constrainVignetteEndPoint(state.startPoint, toLocal(e), e.shiftKey);
      const distance = Math.max(Math.abs(endPoint.x - state.startPoint.x), Math.abs(endPoint.y - state.startPoint.y));
      if (distance >= 3) {
        const overlay = vignetteOverlayFromPreviewPoints(
          vignetteOverlay?.id ?? makeOverlayId("vignette"),
          state.startPoint,
          endPoint,
          state.strengthEv,
        );
        if (overlay) setVignetteOverlay(overlay);
      }
    }
    vignetteCreateState.current = null;
    setVignetteDraft(null);
    e.preventDefault();
    e.stopPropagation();
  }, [constrainVignetteEndPoint, toLocal, vignetteOverlay, vignetteOverlayFromPreviewPoints]);

  const onVignetteMovePointerDown = useCallback((overlay: ImageVignetteOverlay) =>
    (e: React.PointerEvent<SVGSVGElement>) => {
      if (!vignetteMode || e.button !== 0) return;
      vignetteEditState.current = {
        mode: "move",
        pointerId: e.pointerId,
        startPoint: toLocal(e),
        startOverlay: overlay,
      };
      e.currentTarget.setPointerCapture(e.pointerId);
      e.preventDefault();
      e.stopPropagation();
    },
  [toLocal, vignetteMode]);

  const onVignetteHandlePointerDown = useCallback((overlay: ImageVignetteOverlay, handle: EditCorner) =>
    (e: React.PointerEvent<HTMLButtonElement>) => {
      if (!vignetteMode || e.button !== 0) return;
      vignetteEditState.current = {
        mode: "handle",
        pointerId: e.pointerId,
        handle,
        startOverlay: overlay,
      };
      e.currentTarget.setPointerCapture(e.pointerId);
      e.preventDefault();
      e.stopPropagation();
    },
  [vignetteMode]);

  const onVignetteEditPointerMove = useCallback((e: React.PointerEvent<Element>) => {
    const state = vignetteEditState.current;
    if (!state || state.pointerId !== e.pointerId || displayed.w <= 0 || displayed.h <= 0) return;
    const point = clampPointToDisplayed(toLocal(e));
    if (state.mode === "move") {
      const dx = (point.x - state.startPoint.x) / displayed.w;
      const dy = (point.y - state.startPoint.y) / displayed.h;
      const start = state.startOverlay;
      setVignetteOverlay(normalizeVignetteOverlay({
        ...start,
        x1: start.x1 + dx,
        y1: start.y1 + dy,
        x2: start.x2 + dx,
        y2: start.y2 + dy,
      }));
    } else {
      const start = state.startOverlay;
      const fixedNormalized = state.handle === "nw"
        ? { x: start.x2, y: start.y2 }
        : state.handle === "ne"
          ? { x: start.x1, y: start.y2 }
          : state.handle === "sw"
            ? { x: start.x2, y: start.y1 }
            : { x: start.x1, y: start.y1 };
      const fixed = normalizedToDisplayPoint(fixedNormalized.x, fixedNormalized.y);
      const moving = constrainVignetteEndPoint(fixed, point, e.shiftKey);
      const normalized = displayPointToNormalized(moving);
      if (!normalized) return;
      setVignetteOverlay(normalizeVignetteOverlay({
        ...start,
        x1: Math.min(fixedNormalized.x, normalized.x),
        y1: Math.min(fixedNormalized.y, normalized.y),
        x2: Math.max(fixedNormalized.x, normalized.x),
        y2: Math.max(fixedNormalized.y, normalized.y),
      }));
    }
    e.preventDefault();
    e.stopPropagation();
  }, [clampPointToDisplayed, constrainVignetteEndPoint, displayPointToNormalized, displayed.h, displayed.w, normalizedToDisplayPoint, toLocal]);

  const onVignetteEditPointerUp = useCallback((e: React.PointerEvent<Element>) => {
    const state = vignetteEditState.current;
    if (!state || state.pointerId !== e.pointerId) return;
    try {
      (e.currentTarget as Element).releasePointerCapture(e.pointerId);
    } catch {}
    vignetteEditState.current = null;
    e.preventDefault();
    e.stopPropagation();
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
    const sampleSourceWidth = Math.max(1, img.width);
    const sampleSourceHeight = Math.max(1, img.height);
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

  const overlayPath = useMemo(() => {
    return {
      outer: `M${displayed.x},${displayed.y} H${displayed.x + displayed.w} V${displayed.y + displayed.h} H${displayed.x} Z`,
      inner: `M${cropRect.x},${cropRect.y} H${cropRect.x + cropRect.w} V${cropRect.y + cropRect.h} H${cropRect.x} Z`,
    };
  }, [cropRect, displayed.x, displayed.y, displayed.w, displayed.h]);

  const resolvePreviewSourceSample = useCallback((
    decoded: DecodedRgbImage16,
  ): { decoded: DecodedRgbImage16; sample: LinearRgbSample; claritySample: LinearRgbSample; contextSample: LinearRgbSample } => {
    const previewSource = decoded;
    const previewSize = imageEditPreviewDimensions(
      previewSource.width,
      previewSource.height,
      displayed.w * displayPixelRatio,
      displayed.h * displayPixelRatio,
    );
    const cached = previewSourceSampleRef.current;
    if (
      cached?.decoded === previewSource
      && cached.sample.width === previewSize.width
      && cached.sample.height === previewSize.height
    ) {
      return cached;
    }

    const sourceRect = { x: 0, y: 0, w: previewSource.width, h: previewSource.height };
    const sample = getRenderedLinearRgbSample(
      previewSource,
      sourceRect,
      0,
      previewSize.width,
      previewSize.height,
    );
    const claritySample = sample.width * sample.height >= IMAGE_EDIT_CLAHE_MIN_PIXELS
      ? sample
      : getAnalysisLinearRgbSample(previewSource, sourceRect, 0, IMAGE_EDIT_CLAHE_MIN_PIXELS);
    const next = {
      decoded: previewSource,
      sample,
      claritySample,
      contextSample: getAnalysisLinearRgbSample(previewSource, sourceRect, 0),
    };
    previewSourceSampleRef.current = next;
    previewToneSampleCacheRef.current = null;
    previewClarityMapCacheRef.current = null;
    previewContinuousPrefixCacheRef.current = null;
    return next;
  }, [displayed.h, displayed.w, displayPixelRatio]);

  const previewContinuousPrefixKey = useCallback((stage: ImageEditPreviewSliderStage): string => {
    const values: Array<number | null> = [
      clampWhiteBalanceValue(temperature),
      clampWhiteBalanceValue(tint),
      clampExposureEv(exposureEv),
      clampToneRangeAdjustment(shadow),
      clampToneRangeAdjustment(highlight),
      clampScaledLog(scaledLog),
      clampSigmoid(sigmoid),
      clampClarity(clarity),
      clampColorAdjustment(saturation),
      clampColorAdjustment(vibrance),
    ];
    if (stage === "white-balance") {
      values[0] = null;
      values[1] = null;
    } else if (stage === "exposure") {
      values[2] = null;
    } else if (stage === "shadow") {
      values[3] = null;
    } else if (stage === "highlight") {
      values[4] = null;
    } else if (stage === "scaled-log") {
      values[5] = null;
    } else if (stage === "sigmoid") {
      values[6] = null;
    } else if (stage === "clarity") {
      values[7] = null;
    } else if (stage === "color") {
      values[8] = null;
      values[9] = null;
    }
    return JSON.stringify(values);
  }, [
    temperature,
    tint,
    exposureEv,
    shadow,
    highlight,
    scaledLog,
    sigmoid,
    clarity,
    saturation,
    vibrance,
  ]);

  const resolvePreviewContinuousPrefixSample = useCallback((
    sourceSample: LinearRgbSample,
    context: ColorAdjustmentContext,
    clarityMap: ImageEditClarityMap | null = null,
    fullToneSample: LinearRgbSample | null = null,
  ): { stage: ImageEditPreviewSliderStage; sample: LinearRgbSample } | null => {
    const stage = previewContinuousSliderRef.current;
    if (!stage) return null;
    const key = previewContinuousPrefixKey(stage);
    const prefixClarityMap = stage === "color" ? clarityMap : null;
    const cached = previewContinuousPrefixCacheRef.current;
    if (
      cached?.source === sourceSample
      && cached.stage === stage
      && cached.key === key
      && cached.clarityMap === prefixClarityMap
    ) {
      return { stage, sample: cached.sample };
    }

    const sample = buildImageEditPreviewSliderPrefixSample(
      sourceSample,
      context,
      stage,
      prefixClarityMap,
      fullToneSample,
    );
    previewContinuousPrefixCacheRef.current = {
      source: sourceSample,
      stage,
      key,
      clarityMap: prefixClarityMap,
      sample,
    };
    return { stage, sample };
  }, [previewContinuousPrefixKey]);

  const resolvePreviewToneSample = useCallback((
    decoded: DecodedRgbImage16,
  ): LinearRgbSample | null => {
    if (clampClarity(clarity) === 0) return null;
    const internalPreview = resolvePreviewSourceSample(decoded);
    const key = JSON.stringify([
      clampWhiteBalanceValue(temperature),
      clampWhiteBalanceValue(tint),
      clampExposureEv(exposureEv),
      clampToneRangeAdjustment(shadow),
      clampToneRangeAdjustment(highlight),
      clampScaledLog(scaledLog),
      clampSigmoid(sigmoid),
    ]);
    const toneSourceSample = internalPreview.claritySample;
    const cached = previewToneSampleCacheRef.current;
    if (cached?.source === toneSourceSample && cached.key === key) return cached.sample;

    const context = buildInteractiveColorAdjustmentContextFromLinearRgbSample(
      internalPreview.contextSample,
      temperature,
      tint,
      exposureEv,
      shadow,
      highlight,
      scaledLog,
      sigmoid,
      0,
      0,
      true,
    );
    const activeStage = previewContinuousSliderRef.current;
    const tonePrefix = isTonePreviewSliderStage(activeStage)
      ? resolvePreviewContinuousPrefixSample(toneSourceSample, context)
      : null;
    const sample = tonePrefix && isTonePreviewSliderStage(tonePrefix.stage)
      ? buildImageEditToneSample(tonePrefix.sample, context, tonePrefix.stage)
      : buildImageEditToneSample(toneSourceSample, context);
    previewToneSampleCacheRef.current = { source: toneSourceSample, key, sample };
    previewClarityMapCacheRef.current = null;
    return sample;
  }, [
    clarity,
    temperature,
    tint,
    exposureEv,
    shadow,
    highlight,
    scaledLog,
    sigmoid,
    resolvePreviewSourceSample,
    resolvePreviewContinuousPrefixSample,
  ]);

  const resolvePreviewClarityMap = useCallback((
    decoded: DecodedRgbImage16,
  ): ImageEditClarityMap | null => {
    const normalizedClarity = clampClarity(clarity);
    if (normalizedClarity === 0) {
      previewClarityMapCacheRef.current = null;
      return null;
    }

    const toneSample = resolvePreviewToneSample(decoded);
    if (!toneSample) return null;
    const key = String(normalizedClarity);
    const cached = previewClarityMapCacheRef.current;
    if (cached?.source === toneSample && cached.key === key) return cached.map;

    const map = buildImageEditClarityMapFromToneSample(toneSample, normalizedClarity);
    if (!map) return null;
    previewClarityMapCacheRef.current = { source: toneSample, key, map };
    return map;
  }, [clarity, resolvePreviewToneSample]);

  useEffect(() => {
    const canvas = previewCanvasRef.current;
    const decoded = decodedImageRef.current;
    if (!canvas || !decoded || !displayed.w || !displayed.h) return;

    // The preview backing raster is capped at 1 MP and sized to the physical
    // on-screen image (CSS size × devicePixelRatio), so the browser never has
    // to upscale the normal preview.
    const internalPreview = resolvePreviewSourceSample(decoded);
    const previewSource = internalPreview.decoded;
    const width = internalPreview.sample.width;
    const height = internalPreview.sample.height;
    const previewColorProfile: ImageEditOutputColorProfile = "srgb";
    const includeMosaic = !eyedropperMode && !rotationMode && mosaicRegions.length > 0 && !!natural?.w;
    const previewVignetteOverlay = !eyedropperMode && !rotationMode ? (vignetteDraft ?? vignetteOverlay) : null;
    const previewFilter = !eyedropperMode && !rotationMode ? imageFilter : null;
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
      clarity,
      vibrance,
      saturation,
      previewVignetteOverlay,
      previewFilter,
      includeMosaic ? mosaicRegions : null,
    ]);

    const rendered = previewRenderedRef.current;
    if (
      rendered?.decoded === previewSource &&
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
      if (canvas.width !== width) canvas.width = width;
      if (canvas.height !== height) canvas.height = height;

      const previewSourceRect = { x: 0, y: 0, w: previewSource.width, h: previewSource.height };
      const normalizedRotation = normalizeRotationDegrees(rotationDegrees);
      const previewSourceSample = normalizedRotation === 0
        ? internalPreview.sample
        : getRenderedLinearRgbSample(
            previewSource,
            previewSourceRect,
            normalizedRotation,
            width,
            height,
          );
      const previewContextSample = normalizedRotation === 0
        ? internalPreview.contextSample
        : getAnalysisLinearRgbSample(
            previewSource,
            previewSourceRect,
            normalizedRotation,
          );
      const adjustmentContext = buildInteractiveColorAdjustmentContextFromLinearRgbSample(
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
        true,
      );
      const clarityMap = resolvePreviewClarityMap(decoded);
      const previewToneSample = clarityMap && normalizedRotation === 0
        ? resolvePreviewToneSample(decoded)
        : null;
      const continuousPrefix = normalizedRotation === 0
        ? resolvePreviewContinuousPrefixSample(
            internalPreview.sample,
            adjustmentContext,
            clarityMap,
            previewToneSample,
          )
        : null;
      const previewPixelCount = width * height;
      if (!previewRgba8Ref.current || previewRgba8Ref.current.length !== previewPixelCount * 4) {
        previewRgba8Ref.current = new Uint8ClampedArray(previewPixelCount * 4);
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
        clarityMap,
        adjustmentContext,
        clarityMap && normalizedRotation !== 0
          ? {
              sourceWidth: previewSource.width,
              sourceHeight: previewSource.height,
              sourceRect: previewSourceRect,
              rotationDegrees: normalizedRotation,
            }
          : undefined,
        previewToneSample ?? undefined,
        continuousPrefix?.stage,
        continuousPrefix?.sample,
        previewRgba8Ref.current,
      );
      if (previewVignetteOverlay && cropRect.w > 0 && cropRect.h > 0 && displayed.w > 0 && displayed.h > 0) {
        applyVignetteToCanvas(
          canvas,
          previewVignetteOverlay,
          displayed.w,
          displayed.h,
          cropRect.x - displayed.x,
          cropRect.y - displayed.y,
          cropRect.w,
          cropRect.h,
          ((cropRect.x - displayed.x) / displayed.w) * canvas.width,
          ((cropRect.y - displayed.y) / displayed.h) * canvas.height,
          (cropRect.w / displayed.w) * canvas.width,
          (cropRect.h / displayed.h) * canvas.height,
          previewColorProfile,
        );
      }
      applyImageFilterToCanvas(canvas, previewFilter, previewColorProfile);
      if (includeMosaic) {
        const previewScale = width / Math.max(1, displayed.w);
        applyMosaicRectsToCanvas(
          canvas,
          mosaicRegions.map((region) => ({
            x: region.left * canvas.width,
            y: region.top * canvas.height,
            w: (region.right - region.left) * canvas.width,
            h: (region.bottom - region.top) * canvas.height,
          })),
          Math.max(1, Math.round(16 * previewScale)),
          previewColorProfile,
        );
      }

      previewRenderedRef.current = {
        decoded: previewSource,
        width,
        height,
        key: renderedPreviewKey,
      };
      const rawTiming = decoded.rawDevelopment?.timing ?? rawDevelopmentTimingRef.current;
      if (rawTiming) {
        if (editableThumbnailReadyRef.current && !decoded.rawDevelopment?.timing) {
          recordRawTimingOnce(
            rawTiming,
            "preview",
            "Initial editable thumbnail painted",
            performance.now() - rawTiming.startedAtMs,
          );
        } else if (decoded.rawDevelopment?.timing && decoded.rawMasterPromise) {
          const alreadyPainted = rawTiming.preview.some((entry) => entry.name === "RAW preview painted");
          if (!alreadyPainted) {
            recordRawTiming(
              rawTiming,
              "preview",
              "RAW preview painted",
              performance.now() - rawTiming.startedAtMs,
            );
            logRawTimingSection("RAW Preview", rawTiming, rawTiming.preview);
          }
        }
      }
      const currentPreviewRasterSize = previewRasterSizeRef.current;
      if (
        !currentPreviewRasterSize ||
        currentPreviewRasterSize.width !== width ||
        currentPreviewRasterSize.height !== height
      ) {
        const nextPreviewRasterSize = { width, height };
        previewRasterSizeRef.current = nextPreviewRasterSize;
        setPreviewRasterSize(nextPreviewRasterSize);
      }
      if (peepExpanded) setPeepRenderRevision((revision) => revision + 1);
      if (isInitialPreview) {
        initialPreviewReadyRef.current = true;
        setLoadingStage(null);
        clearEmbeddedRawPreview();
      }
    });

    return () => cancelAnimationFrame(frameId);
  }, [
    displayed.x,
    displayed.y,
    displayed.w,
    displayed.h,
    peepExpanded,
    cropRect.x,
    cropRect.y,
    cropRect.w,
    cropRect.h,
    decodedRevision,
    temperature,
    tint,
    exposureEv,
    shadow,
    highlight,
    scaledLog,
    sigmoid,
    clarity,
    vibrance,
    saturation,
    rotationDegrees,
    rotationMode,
    natural,
    mosaicRegions,
    vignetteOverlay,
    vignetteDraft,
    imageFilter,
    eyedropperMode,
    clearEmbeddedRawPreview,
    resolvePreviewSourceSample,
    resolvePreviewToneSample,
    resolvePreviewClarityMap,
    resolvePreviewContinuousPrefixSample,
  ]);

  useEffect(() => {
    if (!showHistogram || eyedropperMode || peepExpanded) {
      setHistogram(null);
      return;
    }
    if (histogramGeometryDragging) return;
    const decoded = decodedImageRef.current;
    if (!decoded || !analysisSourceRect) {
      setHistogram(null);
      return;
    }
    const clarityMap = resolvePreviewClarityMap(decoded);
    const histogramSample = getAnalysisLinearRgbSample(decoded, analysisSourceRect, rotationDegrees);
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
        clarityMap,
        histogramSample,
      ),
    );
  }, [
    showHistogram,
    peepExpanded,
    histogramGeometryDragging,
    decodedRevision,
    analysisSourceRect,
    temperature,
    tint,
    exposureEv,
    shadow,
    highlight,
    scaledLog,
    sigmoid,
    clarity,
    vibrance,
    saturation,
    rotationDegrees,
    eyedropperMode,
    displayed.w,
    displayed.h,
    resolvePreviewClarityMap,
  ]);

  useEffect(() => {
    let cancelled = false;
    if (
      !RAW_USE_THUMBNAIL ||
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
  }, [showHistogram, showPercentileDebug, imageReady, decodedRevision, file]);

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
    decodedRevision,
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

  const waitForAutoToneStagePaint = useCallback(async () => {
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  }, []);

  const runAutoToneTask = useCallback(async (
    task: (setStage: (stage: string) => Promise<void>) => void | Promise<void>,
  ) => {
    setAutoToneBusy(true);
    setAutoToneStage("Sampling image…");
    await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    const setStage = async (stage: string) => {
      setAutoToneStage(stage);
      await waitForAutoToneStagePaint();
    };
    try {
      await task(setStage);
    } finally {
      setAutoToneStage(null);
      setAutoToneBusy(false);
    }
  }, [waitForAutoToneStagePaint]);

  const onAutoExposure = useCallback(() => {
    if (autoToneBusy) return;
    void runAutoToneTask(async (setStage) => {
      const sample = currentToneAutoSample();
      if (!sample) return;
      await setStage("Optimizing exposure…");
      setExposureEv(findAutoExposure(sample, temperature, tint));
      await setStage("Rendering preview…");
      await waitForAutoToneStagePaint();
    });
  }, [autoToneBusy, currentToneAutoSample, runAutoToneTask, temperature, tint, waitForAutoToneStagePaint]);

  const onAutoLogarithm = useCallback(() => {
    if (autoToneBusy) return;
    void runAutoToneTask(async (setStage) => {
      const sample = currentToneAutoSample();
      if (!sample) return;
      await setStage("Optimizing logarithm…");
      setScaledLog(findAutoLogarithm(sample, temperature, tint, exposureEv));
      await setStage("Rendering preview…");
      await waitForAutoToneStagePaint();
    });
  }, [autoToneBusy, currentToneAutoSample, exposureEv, runAutoToneTask, temperature, tint, waitForAutoToneStagePaint]);

  const onAutoSigmoid = useCallback(() => {
    if (autoToneBusy) return;
    void runAutoToneTask(async (setStage) => {
      const sample = currentToneAutoSample();
      if (!sample) return;
      await setStage("Optimizing sigmoid…");
      setSigmoid(findAutoSigmoid(sample, temperature, tint, exposureEv, scaledLog));
      await setStage("Rendering preview…");
      await waitForAutoToneStagePaint();
    });
  }, [autoToneBusy, currentToneAutoSample, exposureEv, runAutoToneTask, scaledLog, temperature, tint, waitForAutoToneStagePaint]);

  const onAutoTone = useCallback(() => {
    if (autoToneBusy) return;
    void runAutoToneTask(async (setStage) => {
      const sample = currentToneAutoSample();
      if (!sample) return;
      setShadow(0);
      setHighlight(0);
      setClarity(0);
      await setStage("Optimizing exposure…");
      const autoExposure = findAutoExposure(sample, temperature, tint);
      await setStage("Optimizing logarithm…");
      const autoLogarithm = findAutoLogarithm(
        sample,
        temperature,
        tint,
        autoExposure,
      );
      await setStage("Optimizing sigmoid…");
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
      await setStage("Rendering preview…");
      await waitForAutoToneStagePaint();
    });
  }, [autoToneBusy, currentToneAutoSample, runAutoToneTask, temperature, tint, waitForAutoToneStagePaint]);

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
    const divisions = 10;
    const vertical: string[] = [];
    const horizontal: string[] = [];
    for (let i = 1; i < divisions; i += 1) {
      const x = (width * i) / divisions;
      const y = (height * i) / divisions;
      vertical.push(`M${x},0 V${height}`);
      horizontal.push(`M0,${y} H${width}`);
    }
    return {
      width,
      height,
      divisions,
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

  // Peep tiles are rendered from the current full-resolution decoded image. RAW
  // Preview/Master can have a different raster size from `natural` because LensFun
  // auto-crop is applied after the metadata frame is established. Derive Peep's
  // output grid from the same final raster geometry that the tile renderer uses,
  // rather than from the UI's logical `natural` size.
  const peepOutputDimensions = useMemo(() => {
    // decodedImageRef is updated together with decodedRevision; reading the ref here
    // intentionally avoids keeping a second copy of the large decoded object in state.
    void decodedRevision;
    const decoded = decodedImageRef.current;
    if (!decoded || displayed.w <= 0 || displayed.h <= 0 || cropRect.w <= 0 || cropRect.h <= 0) {
      return outputDimensions;
    }
    const finalRawCrop = decoded.rawDevelopment?.crop?.finalCrop;
    const sourceW = Math.max(1, Math.round(finalRawCrop?.width ?? decoded.width));
    const sourceH = Math.max(1, Math.round(finalRawCrop?.height ?? decoded.height));
    const crop = normalizeCrop({
      left: (cropRect.x - displayed.x) / displayed.w,
      top: (cropRect.y - displayed.y) / displayed.h,
      right: 1 - (cropRect.x + cropRect.w - displayed.x) / displayed.w,
      bottom: 1 - (cropRect.y + cropRect.h - displayed.y) / displayed.h,
    });
    const sx = Math.max(0, Math.min(sourceW - 1, Math.round(sourceW * crop.left)));
    const sy = Math.max(0, Math.min(sourceH - 1, Math.round(sourceH * crop.top)));
    const ex = Math.max(sx + 1, Math.min(sourceW, Math.round(sourceW * (1 - crop.right))));
    const ey = Math.max(sy + 1, Math.min(sourceH, Math.round(sourceH * (1 - crop.bottom))));
    const percent = Math.min(100, Math.max(1, Math.round(resizePercent)));
    return {
      w: Math.max(1, Math.round((ex - sx) * percent / 100)),
      h: Math.max(1, Math.round((ey - sy) * percent / 100)),
    };
  }, [decodedRevision, displayed, cropRect, resizePercent, outputDimensions]);

  const peepTargetRasterSize = useMemo(() => {
    if (!peepOutputDimensions || displayed.w <= 0 || displayed.h <= 0) return null;
    return {
      width: Math.min(peepOutputDimensions.w, Math.max(1, Math.floor(displayed.w * displayPixelRatio))),
      height: Math.min(peepOutputDimensions.h, Math.max(1, Math.floor(displayed.h * displayPixelRatio))),
    };
  }, [peepOutputDimensions, displayed.w, displayed.h, displayPixelRatio]);

  useEffect(() => {
    if (!peepMode || !peepOutputDimensions || !peepTargetRasterSize || cropRect.w <= 0 || cropRect.h <= 0) return;
    const width = Math.max(1, cropRect.w * peepTargetRasterSize.width / Math.max(1, peepOutputDimensions.w));
    const height = Math.max(1, cropRect.h * peepTargetRasterSize.height / Math.max(1, peepOutputDimensions.h));
    setPeepRect((current) => {
      const requestedCenter = peepRequestedCenterRef.current;
      const centerX = requestedCenter?.x
        ?? (current.w > 0 ? current.x + current.w / 2 : cropRect.x + cropRect.w / 2);
      const centerY = requestedCenter?.y
        ?? (current.h > 0 ? current.y + current.h / 2 : cropRect.y + cropRect.h / 2);
      const w = Math.min(cropRect.w, width);
      const h = Math.min(cropRect.h, height);
      const x = Math.max(cropRect.x, Math.min(cropRect.x + cropRect.w - w, centerX - w / 2));
      const y = Math.max(cropRect.y, Math.min(cropRect.y + cropRect.h - h, centerY - h / 2));
      peepRequestedCenterRef.current = null;
      const next = { x, y, w, h };
      peepRectRef.current = next;
      return next;
    });
  }, [peepMode, peepOutputDimensions, peepTargetRasterSize, cropRect]);

  const buildCurrentEditParams = useCallback((): ImageEditParams => {
    const left = displayed.w > 0 ? (cropRect.x - displayed.x) / displayed.w : 0;
    const top = displayed.h > 0 ? (cropRect.y - displayed.y) / displayed.h : 0;
    const right = displayed.w > 0 ? 1 - (cropRect.x + cropRect.w - displayed.x) / displayed.w : 0;
    const bottom = displayed.h > 0 ? 1 - (cropRect.y + cropRect.h - displayed.y) / displayed.h : 0;
    return {
      crop: normalizeCrop({ left, top, right, bottom }),
      rotationDegrees: normalizeRotationDegrees(rotationDegrees),
      temperature: clampWhiteBalanceValue(temperature),
      tint: clampWhiteBalanceValue(tint),
      denoise: clampDenoise(denoise),
      defringe: clampDefringe(defringe),
      exposureEv: clampExposureEv(exposureEv),
      shadow: clampToneRangeAdjustment(shadow),
      highlight: clampToneRangeAdjustment(highlight),
      scaledLog: clampScaledLog(scaledLog),
      sigmoid: clampSigmoid(sigmoid),
      clarity: clampClarity(clarity),
      vibrance: clampColorAdjustment(vibrance),
      saturation: clampColorAdjustment(saturation),
      resizePercent: Math.min(100, Math.max(1, Math.round(resizePercent))),
      sharpen: clampSharpen(sharpen),
      mosaicRegions: normalizeMosaicRegions(mosaicRegions),
      textOverlays: normalizeTextOverlays(textOverlays),
      drawOverlays: normalizeDrawOverlays(drawOverlays),
      vignetteOverlay: normalizeVignetteOverlay(vignetteOverlay),
      filter: normalizeImageFilter(imageFilter),
    };
  }, [
    displayed,
    cropRect,
    rotationDegrees,
    temperature,
    tint,
    denoise,
    defringe,
    exposureEv,
    shadow,
    highlight,
    scaledLog,
    sigmoid,
    clarity,
    vibrance,
    saturation,
    resizePercent,
    sharpen,
    mosaicRegions,
    textOverlays,
    drawOverlays,
    vignetteOverlay,
    imageFilter,
  ]);

  const resolvePeepOutputRect = useCallback((rectOverride?: EditRect | null): PeepOutputRect | null => {
    const rect = rectOverride ?? peepRectRef.current;
    if (!peepOutputDimensions || !peepTargetRasterSize || cropRect.w <= 0 || cropRect.h <= 0 || rect.w <= 0 || rect.h <= 0) {
      return null;
    }
    const w = peepTargetRasterSize.width;
    const h = peepTargetRasterSize.height;
    const x = Math.max(
      0,
      Math.min(
        peepOutputDimensions.w - w,
        Math.round((rect.x - cropRect.x) / cropRect.w * peepOutputDimensions.w),
      ),
    );
    const y = Math.max(
      0,
      Math.min(
        peepOutputDimensions.h - h,
        Math.round((rect.y - cropRect.y) / cropRect.h * peepOutputDimensions.h),
      ),
    );
    return { x, y, w, h };
  }, [peepOutputDimensions, peepTargetRasterSize, cropRect]);

  const peepTileSettingsKey = useMemo(() => JSON.stringify([
    decodedRevision,
    cropRect.x,
    cropRect.y,
    cropRect.w,
    cropRect.h,
    rotationDegrees,
    temperature,
    tint,
    denoise,
    defringe,
    exposureEv,
    shadow,
    highlight,
    scaledLog,
    sigmoid,
    clarity,
    vibrance,
    saturation,
    resizePercent,
    sharpen,
    imageFilter,
    vignetteOverlay,
    mosaicRegions,
    textOverlays,
    drawOverlays,
  ]), [
    decodedRevision,
    cropRect,
    rotationDegrees,
    temperature,
    tint,
    denoise,
    defringe,
    exposureEv,
    shadow,
    highlight,
    scaledLog,
    sigmoid,
    clarity,
    vibrance,
    saturation,
    resizePercent,
    sharpen,
    imageFilter,
    vignetteOverlay,
    mosaicRegions,
    textOverlays,
    drawOverlays,
  ]);

  const drawPeepComposite = useCallback((rectOverride?: EditRect | null) => {
    const displayCanvas = peepDisplayCanvasRef.current;
    const rect = rectOverride ?? peepRectRef.current;
    const outputRect = resolvePeepOutputRect(rect);
    if (!displayCanvas || !outputRect || displayed.w <= 0 || displayed.h <= 0) return;

    const width = Math.max(1, Math.round(outputRect.w));
    const height = Math.max(1, Math.round(outputRect.h));
    if (displayCanvas.width !== width) displayCanvas.width = width;
    if (displayCanvas.height !== height) displayCanvas.height = height;
    const ctx = displayCanvas.getContext("2d", { alpha: false });
    if (!ctx) return;
    ctx.save();
    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, width, height);

    // Immediate fallback: magnify exactly the rectangle that is visible in the
    // normal preview. The preview canvas is already the rendered/rotated image and
    // is stretched into `displayed`, so display-space is the authoritative mapping
    // for this fallback. Full-resolution tiles use `peepOutputDimensions`; PeepRect
    // itself is the bridge between these two representations.
    const preview = previewCanvasRef.current;
    if (preview && preview.width > 0 && preview.height > 0 && displayed.w > 0 && displayed.h > 0) {
      const sx = (rect.x - displayed.x) / displayed.w * preview.width;
      const sy = (rect.y - displayed.y) / displayed.h * preview.height;
      const sw = rect.w / displayed.w * preview.width;
      const sh = rect.h / displayed.h * preview.height;
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(preview, sx, sy, sw, sh, 0, 0, width, height);
    }

    const revision = peepTileRevisionRef.current;
    const visibleTiles = collectPeepTileCoordsSpiral(
      outputRect,
      peepOutputDimensions?.w ?? width,
      peepOutputDimensions?.h ?? height,
      0,
    );
    const cache = peepTileCacheRef.current;
    for (const { tx, ty } of visibleTiles) {
      const key = `${revision}:${peepTileKey(tx, ty)}`;
      const entry = cache.get(key);
      if (!entry) continue;
      // Touch the entry so the Map itself acts as an LRU queue.
      cache.delete(key);
      cache.set(key, entry);
      const tileX = tx * PEEP_TILE_SIZE_PX;
      const tileY = ty * PEEP_TILE_SIZE_PX;
      const ix0 = Math.max(outputRect.x, tileX);
      const iy0 = Math.max(outputRect.y, tileY);
      const ix1 = Math.min(outputRect.x + outputRect.w, tileX + entry.width);
      const iy1 = Math.min(outputRect.y + outputRect.h, tileY + entry.height);
      if (ix1 <= ix0 || iy1 <= iy0) continue;
      ctx.drawImage(
        entry.source,
        ix0 - tileX,
        iy0 - tileY,
        ix1 - ix0,
        iy1 - iy0,
        ix0 - outputRect.x,
        iy0 - outputRect.y,
        ix1 - ix0,
        iy1 - iy0,
      );
    }
    ctx.restore();
  }, [resolvePeepOutputRect, displayed, peepOutputDimensions]);

  const schedulePeepComposite = useCallback((rectOverride?: EditRect | null) => {
    if (rectOverride) peepCompositePendingRectRef.current = rectOverride;
    if (peepCompositeRafRef.current !== null) return;
    peepCompositeRafRef.current = requestAnimationFrame(() => {
      peepCompositeRafRef.current = null;
      const pending = peepCompositePendingRectRef.current;
      peepCompositePendingRectRef.current = null;
      drawPeepComposite(pending);
    });
  }, [drawPeepComposite]);

  const enqueuePeepTiles = useCallback((rectOverride?: EditRect | null) => {
    const outputRect = resolvePeepOutputRect(rectOverride);
    if (!outputRect || !peepOutputDimensions) return;
    const revision = peepTileRevisionRef.current;
    const cache = peepTileCacheRef.current;
    const coords = collectPeepTileCoordsSpiral(
      outputRect,
      peepOutputDimensions.w,
      peepOutputDimensions.h,
      PEEP_TILE_PREFETCH_RINGS,
    );
    const jobs: PeepTileJob[] = [];
    for (const { tx, ty } of coords) {
      const key = `${revision}:${peepTileKey(tx, ty)}`;
      if (cache.has(key)) continue;
      const x = tx * PEEP_TILE_SIZE_PX;
      const y = ty * PEEP_TILE_SIZE_PX;
      const w = Math.max(0, Math.min(PEEP_TILE_SIZE_PX, peepOutputDimensions.w - x));
      const h = Math.max(0, Math.min(PEEP_TILE_SIZE_PX, peepOutputDimensions.h - y));
      if (w <= 0 || h <= 0) continue;
      jobs.push({ revision, tx, ty, rect: { x, y, w, h } });
    }
    // Replacing the queue makes a newly panned viewport immediately outrank stale
    // prefetch jobs from the previous location. A currently-rendering tile is allowed
    // to finish, then the render loop observes this new queue.
    peepTileQueueRef.current = jobs;
    if (jobs.length > 0 && !peepTileRenderingRef.current) {
      setPeepTileQueueTick((tick) => tick + 1);
    }
  }, [resolvePeepOutputRect, peepOutputDimensions]);

  const cancelPeepTileResume = useCallback(() => {
    if (peepTileResumeTimerRef.current !== null) {
      clearTimeout(peepTileResumeTimerRef.current);
      peepTileResumeTimerRef.current = null;
    }
  }, []);

  const schedulePeepTileResume = useCallback((delayMs: number) => {
    cancelPeepTileResume();
    peepTileResumeTimerRef.current = setTimeout(() => {
      peepTileResumeTimerRef.current = null;
      if (!peepSessionActiveRef.current || !peepExpanded) return;
      enqueuePeepTiles();
    }, Math.max(0, delayMs));
  }, [cancelPeepTileResume, enqueuePeepTiles, peepExpanded]);

  const deactivatePeepMode = useCallback(() => {
    peepSessionActiveRef.current = false;
    if (peepTileResumeTimerRef.current !== null) {
      clearTimeout(peepTileResumeTimerRef.current);
      peepTileResumeTimerRef.current = null;
    }
    peepSliderPointerActiveRef.current = false;
    peepTileQueueRef.current = [];
    setPeepMode(false);
    setPeepExpanded(false);
    peepRectRef.current = { x: 0, y: 0, w: 0, h: 0 };
    peepRequestedCenterRef.current = null;
    peepExpandedDragStateRef.current = null;
    peepCompositePendingRectRef.current = null;
    peepPanPendingRectRef.current = null;
    if (peepCompositeRafRef.current !== null) {
      cancelAnimationFrame(peepCompositeRafRef.current);
      peepCompositeRafRef.current = null;
    }
    if (peepPanRafRef.current !== null) {
      cancelAnimationFrame(peepPanRafRef.current);
      peepPanRafRef.current = null;
    }
  }, []);

  const closePeepExpanded = useCallback(() => {
    deactivatePeepMode();
  }, [deactivatePeepMode]);

  const beginPeepMode = useCallback((center: EditPoint | null = null) => {
    peepSessionActiveRef.current = true;
    peepExpandedDragStateRef.current = null;
    if (center && peepOutputDimensions && peepTargetRasterSize && cropRect.w > 0 && cropRect.h > 0) {
      const targetWidth = peepTargetRasterSize.width;
      const targetHeight = peepTargetRasterSize.height;
      const w = Math.min(
        cropRect.w,
        Math.max(1, cropRect.w * targetWidth / Math.max(1, peepOutputDimensions.w)),
      );
      const h = Math.min(
        cropRect.h,
        Math.max(1, cropRect.h * targetHeight / Math.max(1, peepOutputDimensions.h)),
      );
      const centerX = Math.max(cropRect.x, Math.min(cropRect.x + cropRect.w, center.x));
      const centerY = Math.max(cropRect.y, Math.min(cropRect.y + cropRect.h, center.y));
      const next = {
        x: Math.max(cropRect.x, Math.min(cropRect.x + cropRect.w - w, centerX - w / 2)),
        y: Math.max(cropRect.y, Math.min(cropRect.y + cropRect.h - h, centerY - h / 2)),
        w,
        h,
      };
      peepRequestedCenterRef.current = null;
      peepRectRef.current = next;
      setPeepRect(next);
    } else {
      peepRequestedCenterRef.current = center;
      if (center) {
        const next = { x: center.x, y: center.y, w: 0, h: 0 };
        peepRectRef.current = next;
        setPeepRect(next);
      }
    }

    // Open immediately. The first paint uses the existing preview image, so no
    // full-resolution work is on the interaction critical path.
    setPeepMode(true);
    setPeepExpanded(true);
  }, [cropRect, peepOutputDimensions, peepTargetRasterSize]);

  const processPeepTileQueue = useCallback(async () => {
    if (peepTileRenderingRef.current) return;
    const job = peepTileQueueRef.current.shift();
    if (!job) return;
    peepTileRenderingRef.current = true;
    try {
      if (job.revision !== peepTileRevisionRef.current) return;
      const cacheKey = `${job.revision}:${peepTileKey(job.tx, job.ty)}`;
      if (peepTileCacheRef.current.has(cacheKey)) return;

      // Process one tile per invocation. This intentionally prevents a long-lived
      // async loop from retaining edit-parameter closures from an older render.
      // The next tile is scheduled through React after this one finishes, so every
      // tile starts with the latest settings callbacks.
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      if (!peepSessionActiveRef.current || job.revision !== peepTileRevisionRef.current) return;

      try {
        let decoded = decodedImageRef.current;
        const masterPromise = rawMasterPromiseRef.current;
        if (masterPromise && rawDevelopmentStage !== "master" && rawDevelopmentStage !== "denoised") {
          decoded = await masterPromise;
        }
        if (!decoded || !peepSessionActiveRef.current || job.revision !== peepTileRevisionRef.current) return;
        const params = buildCurrentEditParams();
        const defringeMap = clampDefringe(params.defringe) > 0
          ? await ensureDefringeMap(decoded)
          : null;
        if (!peepSessionActiveRef.current || job.revision !== peepTileRevisionRef.current) return;
        const clarityMap = resolvePreviewClarityMap(decoded);
        const tileCanvas = await buildPeepTileCanvasFromDecoded(
          decoded,
          params,
          job.rect,
          "srgb",
          clarityMap,
          defringeMap,
        );
        if (!peepSessionActiveRef.current || job.revision !== peepTileRevisionRef.current) {
          releaseCanvasIfNeeded(tileCanvas);
          return;
        }
        const source = await materializePeepTileSource(tileCanvas);
        if (!peepSessionActiveRef.current || job.revision !== peepTileRevisionRef.current) {
          releasePeepTileSource(source);
          return;
        }
        storePeepTileCacheEntry(peepTileCacheRef.current, cacheKey, {
          source,
          width: Math.round(job.rect.w),
          height: Math.round(job.rect.h),
        });
        schedulePeepComposite();
      } catch (error) {
        if (peepSessionActiveRef.current && job.revision === peepTileRevisionRef.current) {
          onErrorRef.current?.(error instanceof Error ? error.message : String(error));
        }
      }
    } finally {
      peepTileRenderingRef.current = false;
      if (peepSessionActiveRef.current && peepTileQueueRef.current.length > 0) {
        setPeepTileQueueTick((tick) => tick + 1);
      }
    }
  }, [
    rawDevelopmentStage,
    buildCurrentEditParams,
    ensureDefringeMap,
    resolvePreviewClarityMap,
    schedulePeepComposite,
  ]);

  useEffect(() => {
    if (!peepExpanded) return;
    void processPeepTileQueue();
  }, [peepExpanded, peepTileQueueTick, processPeepTileQueue]);

  useLayoutEffect(() => {
    if (peepTileSettingsKeyRef.current === null) {
      peepTileSettingsKeyRef.current = peepTileSettingsKey;
      return;
    }
    if (peepTileSettingsKeyRef.current === peepTileSettingsKey) return;
    peepTileSettingsKeyRef.current = peepTileSettingsKey;

    // A cached tile is a finished image for one exact settings snapshot.
    // Invalidate synchronously before the browser paints the new slider state,
    // so an old tile can never survive visually into the new revision.
    cancelPeepTileResume();
    for (const entry of peepTileCacheRef.current.values()) releasePeepTileSource(entry.source);
    peepTileCacheRef.current.clear();

    const revision = peepTileRevisionRef.current + 1;
    peepTileRevisionRef.current = revision;
    peepTileQueueRef.current = [];
    if (peepMode && peepExpanded) {
      // Immediately redraw from the low-resolution preview. Full-resolution tiles
      // are intentionally deferred while a range slider is moving.
      schedulePeepComposite();
      const now = performance.now();
      const sliderInputStillPending = peepSliderLastInputAtRef.current > peepSliderLastReleaseAtRef.current
        && now - peepSliderLastInputAtRef.current <= PEEP_TILE_SLIDER_IDLE_MS;
      if (peepSliderPointerActiveRef.current || sliderInputStillPending) {
        schedulePeepTileResume(PEEP_TILE_SLIDER_IDLE_MS);
      } else {
        enqueuePeepTiles();
      }
    }
  }, [
    peepMode,
    peepExpanded,
    peepTileSettingsKey,
    schedulePeepComposite,
    enqueuePeepTiles,
    cancelPeepTileResume,
    schedulePeepTileResume,
  ]);

  useEffect(() => {
    if (!peepExpanded || peepRect.w <= 0 || peepRect.h <= 0) return;
    schedulePeepComposite(peepRect);
    enqueuePeepTiles(peepRect);
  }, [peepExpanded, peepRect, schedulePeepComposite, enqueuePeepTiles]);

  useEffect(() => {
    if (!peepExpanded) return;
    schedulePeepComposite();
  }, [peepExpanded, peepRenderRevision, schedulePeepComposite]);

  const onEditDialogPointerDownCapture = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    const target = e.target;
    if (!(target instanceof HTMLInputElement) || target.type !== "range") return;
    peepSliderPointerActiveRef.current = true;
    cancelPeepTileResume();
  }, [cancelPeepTileResume]);

  const onEditDialogInputCapture = useCallback((e: React.FormEvent<HTMLDivElement>) => {
    const target = e.target;
    if (!(target instanceof HTMLInputElement) || target.type !== "range") return;
    peepSliderLastInputAtRef.current = performance.now();
    // A previously scheduled 200 ms idle render must not fire after the slider
    // has started moving again. The settings layout effect schedules a fresh one.
    cancelPeepTileResume();
  }, [cancelPeepTileResume]);

  useEffect(() => {
    const releaseSlider = () => {
      if (!peepSliderPointerActiveRef.current) return;
      peepSliderPointerActiveRef.current = false;
      peepSliderLastReleaseAtRef.current = performance.now();
      if (peepSessionActiveRef.current && peepExpanded) {
        // setTimeout(0) lets the final range input/state commit invalidate the
        // previous revision before full-resolution tile generation resumes.
        schedulePeepTileResume(0);
      }
    };
    window.addEventListener("pointerup", releaseSlider, true);
    window.addEventListener("pointercancel", releaseSlider, true);
    return () => {
      window.removeEventListener("pointerup", releaseSlider, true);
      window.removeEventListener("pointercancel", releaseSlider, true);
    };
  }, [peepExpanded, schedulePeepTileResume]);

  const onPreviewDoubleClick = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (
      filterMode
      || textMode
      || drawMode
      || mosaicMode
      || vignetteMode
      || eyedropperMode
      || rotationMode
      || peepExpanded
      || displayed.w <= 0
      || displayed.h <= 0
      || cropRect.w <= 0
      || cropRect.h <= 0
    ) {
      return;
    }
    const point = toLocal(e);
    if (
      point.x < displayed.x
      || point.x > displayed.x + displayed.w
      || point.y < displayed.y
      || point.y > displayed.y + displayed.h
    ) {
      return;
    }
    e.preventDefault();
    e.stopPropagation();
    beginPeepMode({
      x: Math.max(cropRect.x, Math.min(cropRect.x + cropRect.w, point.x)),
      y: Math.max(cropRect.y, Math.min(cropRect.y + cropRect.h, point.y)),
    });
  }, [
    filterMode,
    textMode,
    drawMode,
    mosaicMode,
    vignetteMode,
    eyedropperMode,
    rotationMode,
    peepExpanded,
    displayed,
    cropRect,
    toLocal,
    beginPeepMode,
  ]);

  const onPeepExpandedPointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!peepExpanded || e.button !== 0) return;
    const canvas = peepDisplayCanvasRef.current;
    const rect = canvas?.getBoundingClientRect();
    if (!rect || rect.width <= 0 || rect.height <= 0) return;
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
    peepExpandedDragStateRef.current = {
      pointerId: e.pointerId,
      startClientX: e.clientX,
      startClientY: e.clientY,
      startRect: peepRectRef.current,
      viewWidth: rect.width,
      viewHeight: rect.height,
      moved: false,
    };
    e.preventDefault();
    e.stopPropagation();
  }, [peepExpanded]);

  const onPeepExpandedPointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    const state = peepExpandedDragStateRef.current;
    if (!state || state.pointerId !== e.pointerId || !peepOutputDimensions || state.viewWidth <= 0 || state.viewHeight <= 0) return;
    const dxCss = e.clientX - state.startClientX;
    const dyCss = e.clientY - state.startClientY;
    if (Math.abs(dxCss) >= 2 || Math.abs(dyCss) >= 2) state.moved = true;
    const targetW = peepTargetRasterSize?.width ?? 1;
    const targetH = peepTargetRasterSize?.height ?? 1;
    const dxOutput = dxCss * targetW / state.viewWidth;
    const dyOutput = dyCss * targetH / state.viewHeight;
    const dxDisplay = dxOutput * cropRect.w / Math.max(1, peepOutputDimensions.w);
    const dyDisplay = dyOutput * cropRect.h / Math.max(1, peepOutputDimensions.h);
    const nextX = Math.max(
      cropRect.x,
      Math.min(cropRect.x + cropRect.w - state.startRect.w, state.startRect.x - dxDisplay),
    );
    const nextY = Math.max(
      cropRect.y,
      Math.min(cropRect.y + cropRect.h - state.startRect.h, state.startRect.y - dyDisplay),
    );
    peepPanPendingRectRef.current = { ...state.startRect, x: nextX, y: nextY };
    if (peepPanRafRef.current === null) {
      peepPanRafRef.current = requestAnimationFrame(() => {
        peepPanRafRef.current = null;
        const next = peepPanPendingRectRef.current;
        peepPanPendingRectRef.current = null;
        if (!next) return;
        peepRectRef.current = next;
        // Keep pointer tracking out of React's render cycle. The display is composited
        // directly at requestAnimationFrame cadence, and newly exposed tiles are
        // reprioritized immediately. The final rectangle is committed on pointer-up.
        drawPeepComposite(next);
        enqueuePeepTiles(next);
      });
    }
    e.preventDefault();
    e.stopPropagation();
  }, [peepOutputDimensions, peepTargetRasterSize, cropRect, drawPeepComposite, enqueuePeepTiles]);

  const onPeepExpandedPointerUp = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    const state = peepExpandedDragStateRef.current;
    if (!state || state.pointerId !== e.pointerId) return;
    try {
      (e.currentTarget as Element).releasePointerCapture(e.pointerId);
    } catch {}
    peepExpandedDragStateRef.current = null;
    const pending = peepPanPendingRectRef.current;
    peepPanPendingRectRef.current = null;
    const finalRect = pending ?? peepRectRef.current;
    peepRectRef.current = finalRect;
    setPeepRect(finalRect);
    drawPeepComposite(finalRect);
    enqueuePeepTiles(finalRect);
    e.preventDefault();
    e.stopPropagation();
  }, [drawPeepComposite, enqueuePeepTiles]);

  const onSubmit = useCallback(() => {
    if (!displayed.w || !displayed.h || applyPendingRef.current) return;
    const editTiming = createImageEditTimingTrace();
    const collectStartedAt = performance.now();
    const left = (cropRect.x - displayed.x) / displayed.w;
    const top = (cropRect.y - displayed.y) / displayed.h;
    const right = 1 - (cropRect.x + cropRect.w - displayed.x) / displayed.w;
    const bottom = 1 - (cropRect.y + cropRect.h - displayed.y) / displayed.h;
    const params: ImageEditParams = {
      crop: normalizeCrop({ left, top, right, bottom }),
      rotationDegrees: normalizeRotationDegrees(rotationDegrees),
      temperature: clampWhiteBalanceValue(temperature),
      tint: clampWhiteBalanceValue(tint),
      denoise: clampDenoise(denoise),
      defringe: clampDefringe(defringe),
      exposureEv: clampExposureEv(exposureEv),
      shadow: clampToneRangeAdjustment(shadow),
      highlight: clampToneRangeAdjustment(highlight),
      scaledLog: clampScaledLog(scaledLog),
      sigmoid: clampSigmoid(sigmoid),
      clarity: clampClarity(clarity),
      vibrance: clampColorAdjustment(vibrance),
      saturation: clampColorAdjustment(saturation),
      resizePercent: Math.min(100, Math.max(1, Math.round(resizePercent))),
      sharpen: clampSharpen(sharpen),
      mosaicRegions: normalizeMosaicRegions(mosaicRegions),
      textOverlays: normalizeTextOverlays(textOverlays),
      drawOverlays: normalizeDrawOverlays(drawOverlays),
      vignetteOverlay: normalizeVignetteOverlay(vignetteOverlay),
      filter: normalizeImageFilter(imageFilter),
    };
    recordImageEditTiming(
      editTiming,
      "Collecting edit parameters",
      performance.now() - collectStartedAt,
    );
    // Finish never waits for the optional Denoise stage. Invalidate any
    // in-progress merge immediately so the Master buffer can be handed to the
    // downstream pipeline without a concurrent background reader.
    rawDenoisePromiseRef.current = null;
    applyPendingRef.current = true;
    setApplyBusy(true);
    const spinnerStartedAt = performance.now();
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        recordImageEditTiming(
          editTiming,
          "Showing busy spinner / entering async work",
          performance.now() - spinnerStartedAt,
        );
        void (async () => {
          try {
            const masterWaitStartedAt = performance.now();
            let masterPromise = rawMasterPromiseRef.current;
            if (isRawImageFile(file.name, file.type) && !fullResolutionReady && !masterPromise) {
              const foregroundPromise = rawForegroundPromiseRef.current;
              if (foregroundPromise) {
                const previewDecoded = await foregroundPromise;
                masterPromise = previewDecoded.rawMasterPromise ?? null;
                if (!masterPromise) decodedImageRef.current = previewDecoded;
              }
            }
            if (masterPromise && !fullResolutionReady) {
              const masterDecoded = await masterPromise;
              const previousDecoded = decodedImageRef.current;
              decodedImageRef.current = masterDecoded;
              invalidateBaseDerivedCaches(previousDecoded);
              rawMasterPromiseRef.current = null;
            }
            recordImageEditTiming(
              editTiming,
              "Waiting for full-resolution Master",
              performance.now() - masterWaitStartedAt,
            );
            // Finish never adopts an optional Denoise result, even when it was
            // started while the foreground Preview/Master chain was resolving.
            rawDenoisePromiseRef.current = null;
            const decodedImage = decodedImageRef.current;
            const analysisStartedAt = performance.now();
            const finalDefringeMap = decodedImage && clampDefringe(params.defringe) > 0
              ? await ensureDefringeMap(decodedImage)
              : null;
            const clarityMap = decodedImage ? resolvePreviewClarityMap(decodedImage) : null;
            recordImageEditTiming(
              editTiming,
              "Preparing edit analysis",
              performance.now() - analysisStartedAt,
            );
            if (decodedImage) transferredDecodedImageRef.current = decodedImage;
            onApply(params, decodedImage ?? undefined, clarityMap, finalDefringeMap, editTiming);
          } catch (error) {
            applyPendingRef.current = false;
            setApplyBusy(false);
            onErrorRef.current?.(error instanceof Error ? error.message : String(error));
          }
        })();
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
    denoise,
    defringe,
    exposureEv,
    shadow,
    highlight,
    scaledLog,
    sigmoid,
    clarity,
    vibrance,
    saturation,
    resizePercent,
    sharpen,
    imageFilter,
    mosaicRegions,
    textOverlays,
    drawOverlays,
    vignetteOverlay,
    fullResolutionReady,
    file,
    resolvePreviewClarityMap,
    ensureDefringeMap,
    invalidateBaseDerivedCaches,
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
    peepSessionActiveRef.current = false;
    if (peepTileResumeTimerRef.current !== null) {
      clearTimeout(peepTileResumeTimerRef.current);
      peepTileResumeTimerRef.current = null;
    }
    peepSliderPointerActiveRef.current = false;
    peepTileQueueRef.current = [];
    setPeepMode(false);
    setPeepExpanded(false);
    peepExpandedDragStateRef.current = null;
    peepRequestedCenterRef.current = null;
    peepCompositePendingRectRef.current = null;
    peepPanPendingRectRef.current = null;
    if (peepCompositeRafRef.current !== null) {
      cancelAnimationFrame(peepCompositeRafRef.current);
      peepCompositeRafRef.current = null;
    }
    if (peepPanRafRef.current !== null) {
      cancelAnimationFrame(peepPanRafRef.current);
      peepPanRafRef.current = null;
    }
    for (const entry of peepTileCacheRef.current.values()) releasePeepTileSource(entry.source);
    peepTileCacheRef.current.clear();
    peepTileSettingsKeyRef.current = null;
    peepTileRevisionRef.current += 1;
    setTemperature(params.temperature);
    setTint(params.tint);
    setDenoise(params.denoise);
    setDefringe(params.defringe);
    setExposureEv(params.exposureEv);
    setShadow(params.shadow);
    setHighlight(params.highlight);
    setScaledLog(params.scaledLog);
    setSigmoid(params.sigmoid);
    setClarity(params.clarity);
    setVibrance(params.vibrance);
    setSaturation(params.saturation);
    setResizePercent(params.resizePercent);
    setSharpen(params.sharpen);
    setFilterMode(false);
    setImageFilter(params.filter);
    setTextMode(false);
    setActiveTextId(null);
    textMoveState.current = null;
    setTextOverlays(params.textOverlays);
    setDrawMode(false);
    setDrawTool("line");
    setDrawOverlays(params.drawOverlays);
    setDrawDraft(null);
    drawCreateState.current = null;
    drawEditState.current = null;
    setMosaicRegions(params.mosaicRegions);
    mosaicMoveState.current = null;
    setMosaicDraft(null);
    setVignetteMode(false);
    setVignetteOverlay(params.vignetteOverlay);
    setVignetteDraft(null);
    vignetteCreateState.current = null;
    vignetteEditState.current = null;
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

  const panelCollapseButton = (panel: ImageEditPanelKey, label: string) => {
    const collapsed = collapsedPanels[panel];
    return (
      <button
        type="button"
        className={`inline-flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded border border-gray-300 bg-white text-gray-700 hover:bg-gray-100 ${
          panel === "crop" ? "-mr-1" : "-mr-1.5"
        }`}
        onClick={() => togglePanelCollapsed(panel)}
        aria-label={`${collapsed ? "Expand" : "Collapse"} ${label} panel`}
        aria-expanded={!collapsed}
        title={`${collapsed ? "Expand" : "Collapse"} ${label}`}
      >
        {collapsed ? <ChevronDown size={13} strokeWidth={1.8} /> : <ChevronUp size={13} strokeWidth={1.8} />}
      </button>
    );
  };

  const rawDevelopmentSettings = (() => {
    if (!isRawImageFile(file.name, file.type)) return undefined;
    const decoded = decodedImageRef.current;
    return decoded?.rawDevelopment;
  })();
  const rawDevelopmentPreviewSize = (() => {
    if (!rawDevelopmentSettings) return undefined;
    const previewSample = previewSourceSampleRef.current?.sample;
    const width = previewSample?.width ?? previewRenderedRef.current?.width ?? 0;
    const height = previewSample?.height ?? previewRenderedRef.current?.height ?? 0;
    const pixels = width * height;
    const bytes = previewSample?.data.byteLength
      ?? pixels * 3 * Float32Array.BYTES_PER_ELEMENT;
    return { width, height, pixels, bytes };
  })();
  const rawDevelopmentMasterSize = (() => {
    if (!rawDevelopmentSettings || !fullResolutionReady) return undefined;
    const decoded = decodedImageRef.current;
    if (!decoded) return undefined;
    return {
      width: decoded.width,
      height: decoded.height,
      pixels: decoded.width * decoded.height,
      bytes: decoded.data.byteLength,
    };
  })();

  if (!mounted) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[70] bg-black/70 flex items-center justify-center p-4 [@media(max-height:1399px)]:py-[2px] [@media(max-width:999px)]:px-[2px]"
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
        className="bg-white rounded shadow max-w-[95vw] max-h-[95dvh] overflow-y-auto w-[min(1400px,95vw)] p-4 [zoom:var(--editor-ui-zoom)] [@media(max-height:1399px)]:max-h-[calc(100dvh-4px)] [@media(max-width:999px)]:max-w-[calc(100vw-4px)] [@media(max-width:999px)]:w-[min(1400px,calc(100vw-4px))]"
        style={{
          "--editor-ui-zoom": editorUiZoom,
          ...(desktopDialogWidth !== undefined
            ? { width: desktopDialogWidth, maxWidth: desktopDialogWidth }
            : {}),
          ...(desktopDialogMaxHeight !== undefined ? { maxHeight: desktopDialogMaxHeight } : {}),
        } as React.CSSProperties}
        onPointerDownCapture={onEditDialogPointerDownCapture}
        onInputCapture={onEditDialogInputCapture}
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
            <div className={mobileToolsCollapsed ? "hidden lg:contents" : "contents"}>
            <label className="inline-flex items-center gap-2 text-sm text-gray-700 select-none">
              <input
                type="checkbox"
                checked={filterMode}
                onChange={(e) => {
                  const next = e.target.checked;
                  setFilterMode(next);
                  if (next) {
                    setTextMode(false);
                    setActiveTextId(null);
                    textMoveState.current = null;
                    setDrawMode(false);
                    setDrawDraft(null);
                    drawCreateState.current = null;
                    drawEditState.current = null;
                    setMosaicMode(false);
                    mosaicDragStart.current = null;
                    mosaicMoveState.current = null;
                    setMosaicDraft(null);
                    setVignetteMode(false);
                    setVignetteDraft(null);
                    vignetteCreateState.current = null;
                    vignetteEditState.current = null;
                    setEyedropperMode(false);
                    setRotationMode(false);
                    rotationDragState.current = null;
                    dragState.current = null;
                  }
                }}
              />
              <span>Filter</span>
            </label>
            <label className="inline-flex items-center gap-2 text-sm text-gray-700 select-none">
              <input
                type="checkbox"
                checked={textMode}
                onChange={(e) => {
                  const next = e.target.checked;
                  if (next) {
                    setFilterMode(false);
                    setTextMode(true);
                    setActiveTextId(null);
                    textMoveState.current = null;
                    setDrawMode(false);
                    setDrawDraft(null);
                    drawCreateState.current = null;
                    drawEditState.current = null;
                    setVignetteMode(false);
                    setVignetteDraft(null);
                    vignetteCreateState.current = null;
                    vignetteEditState.current = null;
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
                    setFilterMode(false);
                    setTextMode(false);
                    setActiveTextId(null);
                    textMoveState.current = null;
                    setMosaicMode(false);
                    mosaicDragStart.current = null;
                    mosaicMoveState.current = null;
                    setMosaicDraft(null);
                    setVignetteMode(false);
                    setVignetteDraft(null);
                    vignetteCreateState.current = null;
                    vignetteEditState.current = null;
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
                    setFilterMode(false);
                    setTextMode(false);
                    setActiveTextId(null);
                    textMoveState.current = null;
                    setDrawMode(false);
                    setDrawDraft(null);
                    drawCreateState.current = null;
                    drawEditState.current = null;
                    setVignetteMode(false);
                    setVignetteDraft(null);
                    vignetteCreateState.current = null;
                    vignetteEditState.current = null;
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
                checked={vignetteMode}
                onChange={(e) => {
                  const next = e.target.checked;
                  setVignetteMode(next);
                  vignetteCreateState.current = null;
                  vignetteEditState.current = null;
                  setVignetteDraft(null);
                  if (next) {
                    setFilterMode(false);
                    setTextMode(false);
                    setActiveTextId(null);
                    textMoveState.current = null;
                    setDrawMode(false);
                    setDrawDraft(null);
                    drawCreateState.current = null;
                    drawEditState.current = null;
                    setMosaicMode(false);
                    mosaicDragStart.current = null;
                    mosaicMoveState.current = null;
                    setMosaicDraft(null);
                    setEyedropperMode(false);
                    setRotationMode(false);
                    rotationDragState.current = null;
                    dragState.current = null;
                    if (!vignetteOverlay && displayed.w > 0 && displayed.h > 0) {
                      const radius = VIGNETTE_DEFAULT_RADIUS_FRACTION * Math.hypot(displayed.w / 2, displayed.h / 2);
                      setVignetteOverlay(normalizeVignetteOverlay({
                        id: makeOverlayId("vignette"),
                        x1: 0.5 - radius / displayed.w,
                        y1: 0.5 - radius / displayed.h,
                        x2: 0.5 + radius / displayed.w,
                        y2: 0.5 + radius / displayed.h,
                        strengthEv: VIGNETTE_DEFAULT_STRENGTH_EV,
                      }));
                    }
                  }
                }}
              />
              <span>Vignette</span>
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
            </div>
            <div className="col-span-3 flex items-center justify-between lg:contents">
              <button
                className="justify-self-start px-2 py-0.5 text-sm rounded border border-gray-300 hover:bg-gray-100 lg:col-auto lg:justify-self-auto"
                onClick={onReset}
              >
                Reset
              </button>
              <button
                type="button"
                className="inline-flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded border border-gray-300 bg-white text-gray-700 hover:bg-gray-100 lg:hidden"
                onClick={() => setMobileToolsCollapsed((current) => !current)}
                aria-label={`${mobileToolsCollapsed ? "Expand" : "Collapse"} editor tools`}
                aria-expanded={!mobileToolsCollapsed}
                title={`${mobileToolsCollapsed ? "Expand" : "Collapse"} editor tools`}
              >
                {mobileToolsCollapsed ? (
                  <ChevronDown size={13} strokeWidth={1.8} />
                ) : (
                  <ChevronUp size={13} strokeWidth={1.8} />
                )}
              </button>
            </div>
          </div>
        </div>

        <div
          className="mt-3 grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_250px] gap-4 items-stretch"
          style={desktopEditorZoomEnabled
            ? { gridTemplateColumns: editorUsesSidePanel ? "minmax(0,1fr) 250px" : "minmax(0,1fr)" }
            : undefined}
        >
          <div
            ref={previewAreaRef}
            className="flex w-full h-[42vh] min-h-[270px] lg:h-[calc(100dvh-120px)] lg:max-h-[1100px] items-center justify-center [zoom:var(--image-stage-zoom)]"
            style={{
              "--image-stage-zoom": imageStageZoom,
              ...(previewAreaSize.h > 0
                ? {
                    height: previewAreaSize.h,
                    minHeight: previewAreaSize.h,
                    maxHeight: previewAreaSize.h,
                  }
                : {}),
            } as React.CSSProperties}
          >
          <div
            ref={containerRef}
            className={`relative rounded border bg-gray-200 overflow-hidden touch-none ${textMode ? "cursor-text" : !eyedropperMode && !rotationMode && (drawMode || mosaicMode || vignetteMode) ? "cursor-crosshair" : ""}`}
            style={{ width: "100%", height: "100%" }}
            onPointerDown={eyedropperMode || rotationMode ? undefined : textMode ? onTextPointerDown : drawMode ? onDrawPointerDown : mosaicMode ? onMosaicPointerDown : vignetteMode ? onVignettePointerDown : undefined}
            onPointerMove={eyedropperMode ? undefined : rotationMode ? onRotationPointerMove : drawMode ? onDrawPointerMove : mosaicMode ? onMosaicPointerMove : vignetteMode ? onVignettePointerMove : onPointerMove}
            onPointerUp={eyedropperMode ? undefined : rotationMode ? onRotationPointerUp : drawMode ? (e) => finishDrawCreation(e) : mosaicMode ? onMosaicPointerUp : vignetteMode ? (e) => finishVignetteCreation(e) : onPointerUp}
            onPointerCancel={eyedropperMode ? undefined : rotationMode ? onRotationPointerUp : drawMode ? (e) => finishDrawCreation(e, true) : mosaicMode ? onMosaicPointerCancel : vignetteMode ? (e) => finishVignetteCreation(e, true) : onPointerUp}
            onDoubleClick={onPreviewDoubleClick}
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
                  {!eyedropperMode && !rotationMode && vignetteMode && displayed.w > 0 && displayed.h > 0 && (vignetteOverlay || vignetteDraft) && (() => {
                    const overlay = vignetteDraft ?? vignetteOverlay;
                    if (!overlay) return null;
                    const left = displayed.x + overlay.x1 * displayed.w;
                    const top = displayed.y + overlay.y1 * displayed.h;
                    const width = (overlay.x2 - overlay.x1) * displayed.w;
                    const height = (overlay.y2 - overlay.y1) * displayed.h;
                    if (width <= 0 || height <= 0) return null;
                    const isCommitted = overlay === vignetteOverlay;
                    const controlsLeft = Math.max(displayed.x + 2, Math.min(displayed.x + displayed.w - 140, left));
                    const controlsTop = Math.max(displayed.y + 2, top - 28);
                    const deleteLeft = Math.min(displayed.x + displayed.w - 20, Math.max(displayed.x + 2, left + width + 5));
                    const deleteTop = Math.max(displayed.y + 2, top - 10);
                    const handles: Array<[EditCorner, number, number]> = [
                      ["nw", left, top],
                      ["ne", left + width, top],
                      ["sw", left, top + height],
                      ["se", left + width, top + height],
                    ];
                    return (
                      <div key={`${overlay.id}-vignette`} className="contents">
                        <svg
                          className="absolute z-[23]"
                          style={{ left, top, width, height, pointerEvents: isCommitted ? "auto" : "none", overflow: "visible" }}
                          onPointerDown={isCommitted ? onVignetteMovePointerDown(overlay) : undefined}
                          onPointerMove={isCommitted ? onVignetteEditPointerMove : undefined}
                          onPointerUp={isCommitted ? onVignetteEditPointerUp : undefined}
                          onPointerCancel={isCommitted ? onVignetteEditPointerUp : undefined}
                        >
                          <ellipse
                            cx={width / 2}
                            cy={height / 2}
                            rx={width / 2}
                            ry={height / 2}
                            fill="none"
                            stroke={VIGNETTE_OUTLINE_COLOR}
                            strokeWidth={VIGNETTE_OUTLINE_WIDTH_PX}
                            vectorEffect="non-scaling-stroke"
                            style={{ cursor: isCommitted ? "move" : "default" }}
                          />
                        </svg>
                        {isCommitted && (
                          <>
                            <div
                              className="absolute z-[33] flex items-center gap-2 rounded border border-white bg-black/80 px-2 py-1 text-white"
                              style={{ left: controlsLeft, top: controlsTop }}
                              onPointerDown={(e) => e.stopPropagation()}
                              onClick={(e) => e.stopPropagation()}
                            >
                              <input
                                type="range"
                                min={0}
                                max={4}
                                step={0.1}
                                value={overlay.strengthEv}
                                className="w-24"
                                onChange={(e) => setVignetteOverlay((current) => current ? { ...current, strengthEv: clampVignetteStrengthEv(Number(e.target.value)) } : current)}
                                aria-label="Vignette strength"
                                title="Vignette strength"
                              />
                              <span className="min-w-[3.8em] text-[11px] font-mono">{overlay.strengthEv.toFixed(1)}EV</span>
                            </div>
                            {handles.map(([handle, x, y]) => (
                              <button
                                key={handle}
                                type="button"
                                className="absolute z-[31] h-3 w-3 rounded-full border border-black bg-white shadow"
                                style={{ left: x - 6, top: y - 6 }}
                                onPointerDown={onVignetteHandlePointerDown(overlay, handle)}
                                onPointerMove={onVignetteEditPointerMove}
                                onPointerUp={onVignetteEditPointerUp}
                                onPointerCancel={onVignetteEditPointerUp}
                                aria-label="Resize vignette"
                              />
                            ))}
                            <button
                              type="button"
                              className="absolute z-[32] flex h-5 w-5 items-center justify-center rounded-full border border-white bg-black/80 text-[12px] leading-none text-white"
                              style={{ left: deleteLeft, top: deleteTop }}
                              onPointerDown={(e) => e.stopPropagation()}
                              onClick={(e) => {
                                e.stopPropagation();
                                setVignetteOverlay(null);
                                vignetteEditState.current = null;
                                vignetteCreateState.current = null;
                                setVignetteDraft(null);
                              }}
                              aria-label="Remove vignette"
                            >
                              ✕
                            </button>
                          </>
                        )}
                      </div>
                    );
                  })()}
                  {!eyedropperMode && showHistogram && histogramPaths && (
                    <div
                      className="absolute left-2 bottom-2 z-[33] w-[294px] h-[138px] rounded bg-black pointer-events-none lg:w-[382.2px] lg:h-[179.4px] [zoom:var(--editor-ui-zoom)]"
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
                    <div className="absolute inset-0 z-40 flex items-center justify-center bg-black/10 pointer-events-none">
                      <div className="flex flex-col items-center gap-2 text-white">
                        <div className="rounded bg-black/45 p-3 shadow">
                          <div className="h-10 w-10 rounded-full border-4 border-white/40 border-t-white animate-spin" />
                        </div>
                        <div className="rounded bg-black/45 px-3 py-1.5 text-xs font-medium tracking-wide shadow">
                          {autoToneStage ?? "Optimizing tone…"}
                        </div>
                      </div>
                    </div>
                  )}
                  {!autoToneBusy && applyBusy && (
                    <div className="absolute inset-0 z-40 flex items-center justify-center pointer-events-none">
                      <div className="h-10 w-10 rounded-full border-4 border-white/40 border-t-white animate-spin shadow-[0_0_0_1px_rgba(0,0,0,0.25)]" />
                    </div>
                  )}
                  {peepExpanded && (
                    <div
                      className="absolute z-[38] flex items-center justify-center overflow-hidden bg-black"
                      style={{ left: displayed.x, top: displayed.y, width: displayed.w, height: displayed.h }}
                      onPointerDown={onPeepExpandedPointerDown}
                      onPointerMove={onPeepExpandedPointerMove}
                      onPointerUp={onPeepExpandedPointerUp}
                      onPointerCancel={onPeepExpandedPointerUp}
                      onDoubleClick={(e) => {
                        const canvas = peepDisplayCanvasRef.current;
                        const rect = canvas?.getBoundingClientRect();
                        if (!rect || rect.width <= 0 || rect.height <= 0 || peepRect.w <= 0 || peepRect.h <= 0) return;
                        const fx = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
                        const fy = Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height));
                        const centerX = peepRect.x + fx * peepRect.w;
                        const centerY = peepRect.y + fy * peepRect.h;
                        const nextX = Math.max(cropRect.x, Math.min(cropRect.x + cropRect.w - peepRect.w, centerX - peepRect.w / 2));
                        const nextY = Math.max(cropRect.y, Math.min(cropRect.y + cropRect.h - peepRect.h, centerY - peepRect.h / 2));
                        const next = { ...peepRectRef.current, x: nextX, y: nextY };
                        peepRectRef.current = next;
                        setPeepRect(next);
                        drawPeepComposite(next);
                        enqueuePeepTiles(next);
                        e.preventDefault();
                        e.stopPropagation();
                      }}
                      onClick={(e) => e.stopPropagation()}
                    >
                      <canvas
                        ref={peepDisplayCanvasRef}
                        className="block"
                        style={peepTargetRasterSize
                          ? {
                              width: Math.min(displayed.w, peepTargetRasterSize.width / displayPixelRatio),
                              height: Math.min(displayed.h, peepTargetRasterSize.height / displayPixelRatio),
                            }
                          : undefined}
                      />
                      <button
                        type="button"
                        className="absolute right-2 top-2 z-[40] flex h-7 w-7 items-center justify-center rounded-full border border-white bg-black/75 text-sm leading-none text-white hover:bg-black"
                        onPointerDown={(e) => e.stopPropagation()}
                        onClick={(e) => { e.stopPropagation(); closePeepExpanded(); }}
                        aria-label="Close Peep preview"
                        title="Close Peep preview"
                      >
                        ✕
                      </button>
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
                  {!eyedropperMode && filterMode && (
                    <div
                      className="absolute right-2 top-2 z-[35] flex max-h-[calc(100%-1rem)] max-w-[min(340px,calc(100%-1rem))] flex-col gap-1 overflow-y-auto overscroll-contain rounded border border-black/30 bg-white/90 p-2 shadow [zoom:var(--editor-ui-zoom)]"
                      onPointerDown={(e) => e.stopPropagation()}
                      onClick={(e) => e.stopPropagation()}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-xs font-medium text-gray-700">Filter</span>
                        <button
                          type="button"
                          className={`rounded border px-2 py-0.5 text-[11px] ${
                            imageFilter === null
                              ? "border-blue-500 bg-blue-50 text-blue-700"
                              : "border-gray-300 bg-white text-gray-700 hover:bg-gray-100"
                          }`}
                          onClick={() => setImageFilter(null)}
                          aria-label="Disable filter"
                          title="Disable filter"
                        >
                          Off
                        </button>
                      </div>
                      <div className="flex flex-col gap-1">
                        <span className="text-xs font-medium text-gray-700">Monochrome</span>
                        <div className="grid grid-cols-3 gap-1">
                          {(Object.entries(MONOCHROME_PRESET_LABELS) as Array<[ImageMonochromePreset, string]>).map(([preset, label]) => {
                            const selected = imageFilter?.kind === "monochrome" && imageFilter.preset === preset;
                            return (
                              <button
                                key={preset}
                                type="button"
                                className={`rounded border px-2 py-1 text-[11px] ${
                                  selected
                                    ? "border-blue-500 bg-blue-50 text-blue-700"
                                    : "border-gray-300 bg-white text-gray-700 hover:bg-gray-100"
                                }`}
                                onClick={() =>
                                  setImageFilter(selected ? null : { kind: "monochrome", preset })}
                                aria-label={label}
                                title={label}
                              >
                                {label}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                      <div className="flex flex-col gap-1">
                        <span className="text-xs font-medium text-gray-700">Photochemical</span>
                        <div className="grid grid-cols-2 gap-1">
                          {PHOTOCHEMICAL_PRESET_SEQUENCE.map((preset) => {
                            const label = PHOTOCHEMICAL_FILTER_LABELS[preset];
                            const selected = imageFilter?.kind === "other" && imageFilter.preset === preset;
                            return (
                              <button
                                key={preset}
                                type="button"
                                className={`rounded border px-2 py-1 text-[11px] ${
                                  selected
                                    ? "border-blue-500 bg-blue-50 text-blue-700"
                                    : "border-gray-300 bg-white text-gray-700 hover:bg-gray-100"
                                }`}
                                onClick={() => setImageFilter(selected ? null : { kind: "other", preset })}
                                aria-label={label}
                                title={label}
                              >
                                {label}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                      <div className="flex flex-col gap-1">
                        <span className="text-xs font-medium text-gray-700">Others</span>
                        <div className="grid grid-cols-2 gap-1">
                          {(() => {
                            const preset = imageFilter?.kind === "other" && isChannelSwapPreset(imageFilter.preset)
                              ? imageFilter.preset
                              : null;
                            const label = "Swap RGB";
                            return (
                              <button
                                type="button"
                                className={`rounded border px-2 py-1 text-[11px] ${
                                  preset
                                    ? "border-blue-500 bg-blue-50 text-blue-700"
                                    : "border-gray-300 bg-white text-gray-700 hover:bg-gray-100"
                                }`}
                                onClick={() => setImageFilter((current) => cycleOtherFilterPreset(current, SWAP_RGB_PRESET_SEQUENCE))}
                                aria-label={label}
                                title="Swap RGB; click to cycle RGB permutations and Off"
                              >
                                {label}
                              </button>
                            );
                          })()}
                          {(() => {
                            const preset = imageFilter?.kind === "other" && isPartColorPreset(imageFilter.preset)
                              ? imageFilter.preset
                              : null;
                            const label = "Part Color";
                            return (
                              <button
                                type="button"
                                className={`rounded border px-2 py-1 text-[11px] ${
                                  preset
                                    ? "border-blue-500 bg-blue-50 text-blue-700"
                                    : "border-gray-300 bg-white text-gray-700 hover:bg-gray-100"
                                }`}
                                onClick={() => setImageFilter((current) => cycleOtherFilterPreset(current, PART_COLOR_PRESET_SEQUENCE))}
                                aria-label={label}
                                title="Part Color; click to cycle Red, Yellow, Green, Cyan, Blue, Magenta, and Off"
                              >
                                {label}
                              </button>
                            );
                          })()}
                          {(() => {
                            const preset = imageFilter?.kind === "other" && isDichromePreset(imageFilter.preset)
                              ? imageFilter.preset
                              : null;
                            const label = "Dichrome";
                            return (
                              <button
                                type="button"
                                className={`rounded border px-2 py-1 text-[11px] ${
                                  preset
                                    ? "border-blue-500 bg-blue-50 text-blue-700"
                                    : "border-gray-300 bg-white text-gray-700 hover:bg-gray-100"
                                }`}
                                onClick={() => setImageFilter((current) => cycleOtherFilterPreset(current, DICHROME_PRESET_SEQUENCE))}
                                aria-label={label}
                                title="Dichrome; click to cycle R+K, Y+K, G+K, C+K, B+K, M+K, R+G, B+G, R+B, and Off"
                              >
                                {label}
                              </button>
                            );
                          })()}
                          {(() => {
                            const preset = imageFilter?.kind === "other" && isTrichromePreset(imageFilter.preset)
                              ? imageFilter.preset
                              : null;
                            const label = "Trichrome";
                            return (
                              <button
                                type="button"
                                className={`rounded border px-2 py-1 text-[11px] ${
                                  preset
                                    ? "border-blue-500 bg-blue-50 text-blue-700"
                                    : "border-gray-300 bg-white text-gray-700 hover:bg-gray-100"
                                }`}
                                onClick={() => setImageFilter((current) => cycleOtherFilterPreset(current, TRICHROME_PRESET_SEQUENCE))}
                                aria-label={label}
                                title="Trichrome; click to cycle YB, RC, GM, and Off"
                              >
                                {label}
                              </button>
                            );
                          })()}
                          {(() => {
                            const preset = imageFilter?.kind === "other" && isDuotonePreset(imageFilter.preset)
                              ? imageFilter.preset
                              : null;
                            const label = "Duotone";
                            return (
                              <button
                                type="button"
                                className={`rounded border px-2 py-1 text-[11px] ${
                                  preset
                                    ? "border-blue-500 bg-blue-50 text-blue-700"
                                    : "border-gray-300 bg-white text-gray-700 hover:bg-gray-100"
                                }`}
                                onClick={() => setImageFilter((current) => cycleOtherFilterPreset(current, DUOTONE_PRESET_SEQUENCE))}
                                aria-label={label}
                                title="Duotone; click to cycle Red, Yellow, Green, Cyan, Blue, Magenta, and Off"
                              >
                                {label}
                              </button>
                            );
                          })()}
                          {(() => {
                            const preset = imageFilter?.kind === "other" && isEdgePreset(imageFilter.preset)
                              ? imageFilter.preset
                              : null;
                            const label = "Edge";
                            const title = preset === "edge-canny"
                              ? "Edge (Canny); click to cycle Canny, XDoG, Multi-scale, and Off"
                              : preset === "edge-xdog"
                                ? "Edge (XDoG); click to cycle Canny, XDoG, Multi-scale, and Off"
                                : preset === "edge-multiscale"
                                  ? "Edge (Multi-scale); click to cycle Canny, XDoG, Multi-scale, and Off"
                                  : "Edge; click to cycle Canny, XDoG, Multi-scale, and Off";
                            return (
                              <button
                                type="button"
                                className={`rounded border px-2 py-1 text-[11px] ${
                                  preset
                                    ? "border-blue-500 bg-blue-50 text-blue-700"
                                    : "border-gray-300 bg-white text-gray-700 hover:bg-gray-100"
                                }`}
                                onClick={() => setImageFilter((current) => cycleOtherFilterPreset(current, EDGE_PRESET_SEQUENCE))}
                                aria-label={label}
                                title={title}
                              >
                                {label}
                              </button>
                            );
                          })()}
                          {(["velvia", "classic-chrome"] as const).map((preset) => {
                            const label = OTHER_FILTER_LABELS[preset];
                            const selected = imageFilter?.kind === "other" && imageFilter.preset === preset;
                            return (
                              <button
                                key={preset}
                                type="button"
                                className={`rounded border px-2 py-1 text-[11px] ${
                                  selected
                                    ? "border-blue-500 bg-blue-50 text-blue-700"
                                    : "border-gray-300 bg-white text-gray-700 hover:bg-gray-100"
                                }`}
                                onClick={() => setImageFilter(selected ? null : { kind: "other", preset })}
                                aria-label={label}
                                title={label}
                              >
                                {label}
                              </button>
                            );
                          })}
                        </div>
                      </div>
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
                        const p1 = sourceNormalizedToPreviewPoint(overlay.x1, overlay.y1);
                        const p2 = sourceNormalizedToPreviewPoint(overlay.x2, overlay.y2);
                        if (!p1 || !p2) return null;
                        const x1 = p1.x - cropRect.x;
                        const y1 = p1.y - cropRect.y;
                        const x2 = p2.x - cropRect.x;
                        const y2 = p2.y - cropRect.y;
                        const strokeWidth = Math.max(1, overlay.strokeWidth * displayed.w / natural.w);
                        const stroke = TEXT_OVERLAY_COLORS[normalizeTextColorIndex(overlay.colorIndex)];
                        const fill = overlay.type === "line" || overlay.fillColorIndex == null
                          ? "none"
                          : TEXT_OVERLAY_COLORS[normalizeTextColorIndex(overlay.fillColorIndex)];
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
                              <rect x={left} y={top} width={width} height={height} fill={fill} stroke={stroke} strokeWidth={strokeWidth} />
                            ) : (
                              <ellipse cx={left + width / 2} cy={top + height / 2} rx={width / 2} ry={height / 2} fill={fill} stroke={stroke} strokeWidth={strokeWidth} />
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
                        const p1 = sourceNormalizedToPreviewPoint(drawDraft.x1, drawDraft.y1);
                        const p2 = sourceNormalizedToPreviewPoint(drawDraft.x2, drawDraft.y2);
                        if (!p1 || !p2) return null;
                        const x1 = p1.x - cropRect.x;
                        const y1 = p1.y - cropRect.y;
                        const x2 = p2.x - cropRect.x;
                        const y2 = p2.y - cropRect.y;
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
                    const p1 = sourceNormalizedToPreviewPoint(overlay.x1, overlay.y1);
                    const p2 = sourceNormalizedToPreviewPoint(overlay.x2, overlay.y2);
                    if (!p1 || !p2) return null;
                    const x1 = p1.x;
                    const y1 = p1.y;
                    const x2 = p2.x;
                    const y2 = p2.y;
                    const handles: Array<[DrawHandle, number, number]> = overlay.type === "line"
                      ? [["start", x1, y1], ["end", x2, y2]]
                      : [
                          ["nw", Math.min(x1, x2), Math.min(y1, y2)],
                          ["ne", Math.max(x1, x2), Math.min(y1, y2)],
                          ["sw", Math.min(x1, x2), Math.max(y1, y2)],
                          ["se", Math.max(x1, x2), Math.max(y1, y2)],
                        ];
                    const objectLeft = Math.min(x1, x2);
                    const objectTop = Math.min(y1, y2);
                    const deleteX = Math.max(x1, x2) + 5;
                    const deleteY = objectTop - 10;
                    const strokeWidthIndex = natural
                      ? drawStrokeWidthIndexForOverlay(overlay.strokeWidth, natural.w, natural.h)
                      : DRAW_DEFAULT_STROKE_WIDTH_INDEX;
                    const fillColorIndex = overlay.type === "line"
                      ? null
                      : normalizeOptionalTextColorIndex(overlay.fillColorIndex);
                    return (
                      <div key={`${overlay.id}-controls`} className="contents">
                        <div
                          className="absolute z-[33] flex w-max items-center gap-1"
                          style={{ left: objectLeft, top: objectTop - 24 }}
                          onPointerDown={(e) => e.stopPropagation()}
                          onClick={(e) => e.stopPropagation()}
                        >
                          <button
                            type="button"
                            className="flex h-5 min-w-5 items-center justify-center rounded border border-white bg-black/80 px-1 text-white"
                            onClick={() => cycleDrawOverlayStrokeWidth(overlay.id)}
                            aria-label={`Stroke width: ${DRAW_STROKE_WIDTH_LABELS[strokeWidthIndex]}`}
                            title={`Stroke width: ${DRAW_STROKE_WIDTH_LABELS[strokeWidthIndex]}`}
                          >
                            <span
                              className="block w-4 border-t border-current"
                              style={{ borderTopWidth: 1 + strokeWidthIndex * 1.25 }}
                            />
                          </button>
                          <button
                            type="button"
                            className="flex h-5 min-w-5 items-center justify-center rounded border border-white bg-black/80 px-1 text-white"
                            onClick={() => cycleDrawOverlayStrokeColor(overlay.id)}
                            aria-label="Change stroke color"
                            title="Stroke color"
                          >
                            <span
                              className="h-3 w-3 rounded-full border border-white/70"
                              style={{ backgroundColor: TEXT_OVERLAY_COLORS[normalizeTextColorIndex(overlay.colorIndex)] }}
                            />
                          </button>
                          {overlay.type !== "line" && (
                            <button
                              type="button"
                              className="flex h-5 min-w-5 items-center justify-center rounded border border-white bg-black/80 px-1 text-white"
                              onClick={() => cycleDrawOverlayFillColor(overlay.id)}
                              aria-label={fillColorIndex == null ? "Fill color: Transparent" : "Change fill color"}
                              title={fillColorIndex == null ? "Fill: Transparent" : "Fill color"}
                            >
                              {fillColorIndex == null ? (
                                <span className="flex h-3 w-3 items-center justify-center rounded-[2px] border border-white/70 text-[9px] leading-none">∅</span>
                              ) : (
                                <span
                                  className="h-3 w-3 rounded-[2px] border border-white/70"
                                  style={{ backgroundColor: TEXT_OVERLAY_COLORS[fillColorIndex] }}
                                />
                              )}
                            </button>
                          )}
                        </div>
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
                    <div className="absolute left-2 bottom-2 z-[33] w-[294px] h-[138px] rounded border border-white/40 bg-black/80 shadow-sm pointer-events-none lg:w-[382.2px] lg:h-[179.4px] [zoom:var(--editor-ui-zoom)]">
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
                        className="absolute left-2 top-2 max-h-[max(180px,28vh)] max-w-[480px] overflow-x-auto overflow-y-auto rounded border border-white/40 bg-black/85 p-2 text-[11px] leading-tight text-white shadow-lg lg:max-h-[800px] [zoom:var(--editor-ui-zoom)]"
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
                              {rawDevelopmentPreviewSize && (
                                <div>
                                  preview size: width={rawDevelopmentPreviewSize.width}, height={rawDevelopmentPreviewSize.height}, pixels={rawDevelopmentPreviewSize.pixels}, bytes={formatMemoryMiB(rawDevelopmentPreviewSize.bytes)}
                                </div>
                              )}
                              {rawDevelopmentMasterSize ? (
                                <div>
                                  master size: width={rawDevelopmentMasterSize.width}, height={rawDevelopmentMasterSize.height}, pixels={rawDevelopmentMasterSize.pixels}, bytes={formatMemoryMiB(rawDevelopmentMasterSize.bytes)}
                                </div>
                              ) : (
                                <div>master size: processing...</div>
                              )}
                              {rawDevelopmentSettings.rawGeometry && (
                                <div>
                                  raw geometry: {formatRawDevelopmentGeometry(rawDevelopmentSettings.rawGeometry)}
                                </div>
                              )}
                              {rawDevelopmentSettings.crop && (
                                <div>
                                  crop: {formatRawDevelopmentCropSettings(rawDevelopmentSettings.crop)}
                                </div>
                              )}
                              <div>
                                luminance: {rawDevelopmentSettings.luminance
                                  ? `exposure=${formatRawDevelopmentSetting(rawDevelopmentSettings.luminance.exposureEv)}, logarithm=${formatRawDevelopmentSetting(rawDevelopmentSettings.luminance.logarithm)}, sigmoid=${formatRawDevelopmentSetting(rawDevelopmentSettings.luminance.sigmoid)}, tone slope@1=${rawDevelopmentSettings.luminance.toneSlopeAtWhite.toFixed(6)}`
                                  : "n/a"}
                              </div>
                              <div>
                                saturation: saturation={formatRawDevelopmentSetting(colorSaturationFactor(rawDevelopmentSettings.saturation.saturation))}, vibrance={formatRawDevelopmentSetting(colorVibranceFactor(rawDevelopmentSettings.saturation.vibrance))}
                              </div>
                              {rawDevelopmentSettings.runtimeMode && (
                                <div>
                                  runtime: LibRaw={rawDevelopmentSettings.runtimeMode}, OpenMP threads={rawDevelopmentSettings.openMpThreads ?? 1}
                                </div>
                              )}
                              <div>
                                source: ISO={rawDevelopmentSettings.iso === null ? "n/a" : formatRawDevelopmentSetting(rawDevelopmentSettings.iso)}, medPasses={rawDevelopmentSettings.medPasses}, mode={rawDevelopmentSettings.mode === "thumbnail-match" ? "thumbnail match" : "fallback"}
                              </div>
                              {(rawDevelopmentSettings.denoise || rawDenoisePromiseRef.current) && (() => {
                                const denoise = rawDevelopmentSettings.denoise;
                                const pending = rawDenoiseDecodeSettingsForIso(rawDevelopmentSettings.iso ?? Number.NaN);
                                return (
                                  <div>
                                    denoise: fbs={denoise?.fbdd ?? pending.fbdd}, medPasses={denoise?.medPasses ?? pending.medPasses}{denoise
                                      ? `, smooth mean=${denoise.smoothMean.toFixed(3)}, smooth stddev=${denoise.smoothStddev.toFixed(3)}, shadow mean=${denoise.shadowMean.toFixed(3)}, shadow stddev=${denoise.shadowStddev.toFixed(3)}, weight mean=${denoise.weightMean.toFixed(3)}, weight stddev=${denoise.weightStddev.toFixed(3)}, weight p50=${denoise.weightP50.toFixed(3)}, weight p90=${denoise.weightP90.toFixed(3)}, weight p99=${denoise.weightP99.toFixed(3)}`
                                      : ", processing..."}
                                  </div>
                                );
                              })()}
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
                              <div>
                                time: preview={rawDevelopmentSettings.previewElapsedSeconds === undefined
                                  ? "n/a"
                                  : `${rawDevelopmentSettings.previewElapsedSeconds.toFixed(2)}s`}, master={fullResolutionReady
                                    ? `${rawDevelopmentSettings.elapsedSeconds.toFixed(2)}s`
                                    : "processing..."}, denoise={rawDevelopmentSettings.denoise
                                      ? `${rawDevelopmentSettings.denoise.elapsedSeconds.toFixed(2)}s`
                                      : rawDenoisePromiseRef.current
                                        ? "processing..."
                                        : "n/a"}
                              </div>
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
                            <div className="absolute left-0 bottom-[calc(100%+4px)] flex w-max items-center gap-1">
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
                      className={`absolute border-2 border-white shadow-[0_0_0_1px_rgba(0,0,0,0.45)] bg-transparent ${mosaicMode || textMode || drawMode || vignetteMode ? "pointer-events-none" : "cursor-move"}`}
                      style={{ left: cropRect.x, top: cropRect.y, width: cropRect.w, height: cropRect.h }}
                      onPointerDown={mosaicMode || textMode || drawMode || vignetteMode ? undefined : onCropPointerDown}
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
          </div>

          <div className="space-y-4 text-sm text-gray-800 select-none">
            <div className={`rounded border px-2 ${collapsedPanels.crop ? "py-1.5" : "py-3 lg:space-y-2"}`}>
              <div className="flex items-start justify-between gap-2">
                <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-1 gap-y-2 lg:gap-x-2">
                  <div className="shrink-0 font-medium">Crop</div>
                  {!collapsedPanels.crop && (
                    <>
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
                          setFilterMode(false);
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
                    </>
                  )}
                </div>
                {panelCollapseButton("crop", "Crop")}
              </div>
              {!collapsedPanels.crop && (
                <div className="hidden lg:block min-w-0 text-[10px] text-gray-700 leading-5 font-mono whitespace-nowrap">
                  {cropMarginsText}
                </div>
              )}
            </div>

            <div className={`rounded border px-3 ${collapsedPanels.whiteBalance ? "py-1.5" : "py-3 space-y-2 lg:space-y-3"}`}>
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-1 font-medium">
                  <span>White balance</span>
                  {!collapsedPanels.whiteBalance && (
                  <button
                  type="button"
                  className={`inline-flex h-5 w-5 items-center justify-center rounded border ${
                    eyedropperMode
                      ? "border-blue-500 bg-blue-50 text-blue-700"
                      : "border-gray-300 bg-white text-gray-700 hover:bg-gray-100"
                  }`}
                  onClick={() => {
                    setFilterMode(false);
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
                    setVignetteMode(false);
                    setVignetteDraft(null);
                    vignetteCreateState.current = null;
                    vignetteEditState.current = null;
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
                  )}
                </div>
                {panelCollapseButton("whiteBalance", "White balance")}
              </div>
              <div className={collapsedPanels.whiteBalance ? "hidden" : "space-y-2 lg:space-y-3"}>
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
                  onChange={(e) => { previewContinuousSliderRef.current = "white-balance"; setTemperature(clampWhiteBalanceValue(Number(e.target.value))); }}
                  onDoubleClick={() => { previewContinuousSliderRef.current = "white-balance"; setTemperature(sliderDefaults.temperature); }}
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
                  onChange={(e) => { previewContinuousSliderRef.current = "white-balance"; setTint(clampWhiteBalanceValue(Number(e.target.value))); }}
                  onDoubleClick={() => { previewContinuousSliderRef.current = "white-balance"; setTint(sliderDefaults.tint); }}
                  className="col-start-2 row-start-1 lg:col-span-2 lg:col-start-1 lg:row-start-2 w-full"
                />
              </label>
              </div>
            </div>

            <div className={`rounded border px-3 ${collapsedPanels.tone ? "py-1.5" : "py-3 space-y-2 lg:space-y-3"}`}>
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 font-medium">
                  <span>Tone</span>
                  {!collapsedPanels.tone && (
                <button
                  type="button"
                  className="h-5 rounded border border-gray-300 bg-white px-1.5 text-[10px] font-normal text-gray-700 hover:bg-gray-100 disabled:cursor-default disabled:opacity-60"
                  onClick={onAutoTone}
                  disabled={autoToneBusy}
                  title="Auto tone: reset Shadow/Highlight/Clarity, then optimize Exposure, Midtone, and Contrast"
                >
                    Auto
                  </button>
                  )}
                </div>
                {panelCollapseButton("tone", "Tone")}
              </div>
              <div className={collapsedPanels.tone ? "hidden" : "space-y-2 lg:space-y-3"}>
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
                  onChange={(e) => { previewContinuousSliderRef.current = "exposure"; setExposureEv(clampExposureEv(Number(e.target.value))); }}
                  onDoubleClick={() => { previewContinuousSliderRef.current = "exposure"; setExposureEv(sliderDefaults.exposureEv); }}
                  className="col-start-2 row-start-1 lg:col-span-2 lg:col-start-1 lg:row-start-2 w-full"
                />
              </div>
              <div className="grid grid-cols-[112px_minmax(0,1fr)_56px] lg:grid-cols-2 items-center gap-x-2 gap-y-1">
                <div className="col-start-1 row-start-1 flex min-w-0 items-center gap-1">
                  <span>Midtone</span>
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
                  aria-label="Midtone"
                  type="range"
                  min={-20}
                  max={20}
                  step={0.1}
                  value={scaledLog}
                  onChange={(e) => { previewContinuousSliderRef.current = "scaled-log"; setScaledLog(clampScaledLog(Number(e.target.value))); }}
                  onDoubleClick={() => { previewContinuousSliderRef.current = "scaled-log"; setScaledLog(sliderDefaults.scaledLog); }}
                  className="col-start-2 row-start-1 lg:col-span-2 lg:col-start-1 lg:row-start-2 w-full"
                />
              </div>
              <div className="grid grid-cols-[112px_minmax(0,1fr)_56px] lg:grid-cols-2 items-center gap-x-2 gap-y-1">
                <div className="col-start-1 row-start-1 flex min-w-0 items-center gap-1">
                  <span>Contrast</span>
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
                  aria-label="Contrast"
                  type="range"
                  min={-10}
                  max={10}
                  step={0.1}
                  value={sigmoid}
                  onChange={(e) => { previewContinuousSliderRef.current = "sigmoid"; setSigmoid(clampSigmoid(Number(e.target.value))); }}
                  onDoubleClick={() => { previewContinuousSliderRef.current = "sigmoid"; setSigmoid(sliderDefaults.sigmoid); }}
                  className="col-start-2 row-start-1 lg:col-span-2 lg:col-start-1 lg:row-start-2 w-full"
                />
              </div>
              <div className="grid grid-cols-[112px_minmax(0,1fr)_56px] lg:grid-cols-2 items-center gap-x-2 gap-y-1">
                <div className="col-start-1 row-start-1 flex min-w-0 items-center gap-1">
                  <span>Shadow</span>
                </div>
                <span className="col-start-3 row-start-1 w-14 text-right lg:w-auto lg:col-start-2 justify-self-end font-mono text-[12px]">{shadow >= 0 ? "+" : ""}{shadow}</span>
                <input
                  aria-label="Shadow"
                  type="range"
                  min={-100}
                  max={100}
                  step={1}
                  value={shadow}
                  onChange={(e) => { previewContinuousSliderRef.current = "shadow"; setShadow(clampToneRangeAdjustment(Number(e.target.value))); }}
                  onDoubleClick={() => { previewContinuousSliderRef.current = "shadow"; setShadow(sliderDefaults.shadow); }}
                  className="col-start-2 row-start-1 lg:col-span-2 lg:col-start-1 lg:row-start-2 w-full"
                />
              </div>
              <label className="grid grid-cols-[112px_minmax(0,1fr)_56px] lg:grid-cols-2 items-center gap-x-2 gap-y-1">
                <span className="col-start-1 row-start-1">Highlight</span>
                <span className="col-start-3 row-start-1 w-14 text-right lg:w-auto lg:col-start-2 justify-self-end font-mono text-[12px]">{highlight >= 0 ? "+" : ""}{highlight}</span>
                <input
                  aria-label="Highlight"
                  type="range"
                  min={-100}
                  max={100}
                  step={1}
                  value={highlight}
                  onChange={(e) => { previewContinuousSliderRef.current = "highlight"; setHighlight(clampToneRangeAdjustment(Number(e.target.value))); }}
                  onDoubleClick={() => { previewContinuousSliderRef.current = "highlight"; setHighlight(sliderDefaults.highlight); }}
                  className="col-start-2 row-start-1 lg:col-span-2 lg:col-start-1 lg:row-start-2 w-full"
                />
              </label>
              <label className="grid grid-cols-[112px_minmax(0,1fr)_56px] lg:grid-cols-2 items-center gap-x-2 gap-y-1">
                <span className="col-start-1 row-start-1">Clarity</span>
                <span className="col-start-3 row-start-1 w-14 text-right lg:w-auto lg:col-start-2 justify-self-end font-mono text-[12px]">{clarity >= 0 ? "+" : ""}{clarity}</span>
                <input
                  aria-label="Clarity"
                  type="range"
                  min={-100}
                  max={100}
                  step={1}
                  value={clarity}
                  onChange={(e) => { previewContinuousSliderRef.current = "clarity"; setClarity(clampClarity(Number(e.target.value))); }}
                  onDoubleClick={() => { previewContinuousSliderRef.current = "clarity"; setClarity(sliderDefaults.clarity); }}
                  className="col-start-2 row-start-1 lg:col-span-2 lg:col-start-1 lg:row-start-2 w-full"
                />
              </label>
              </div>
            </div>

            <div className={`rounded border px-3 ${collapsedPanels.color ? "py-1.5" : "py-3 space-y-2 lg:space-y-3"}`}>
              <div className="flex items-center justify-between gap-2">
                <div className="font-medium">Color</div>
                {panelCollapseButton("color", "Color")}
              </div>
              <div className={collapsedPanels.color ? "hidden" : "space-y-2 lg:space-y-3"}>
              <label className="grid grid-cols-[96px_minmax(0,1fr)_56px] lg:grid-cols-2 items-center gap-x-2 gap-y-1">
                <span className="col-start-1 row-start-1">Saturation</span>
                <span className="col-start-3 row-start-1 w-14 text-right lg:w-auto lg:col-start-2 justify-self-end font-mono text-[12px]">{saturation >= 0 ? "+" : ""}{saturation}</span>
                <input
                  type="range"
                  min={-100}
                  max={100}
                  step={1}
                  value={saturation}
                  onChange={(e) => { previewContinuousSliderRef.current = "color"; setSaturation(clampColorAdjustment(Number(e.target.value))); }}
                  onDoubleClick={() => { previewContinuousSliderRef.current = "color"; setSaturation(sliderDefaults.saturation); }}
                  className="col-start-2 row-start-1 lg:col-span-2 lg:col-start-1 lg:row-start-2 w-full"
                />
              </label>
              <label className="grid grid-cols-[96px_minmax(0,1fr)_56px] lg:grid-cols-2 items-center gap-x-2 gap-y-1">
                <span className="col-start-1 row-start-1">Vibrance</span>
                <span className="col-start-3 row-start-1 w-14 text-right lg:w-auto lg:col-start-2 justify-self-end font-mono text-[12px]">{vibrance >= 0 ? "+" : ""}{vibrance}</span>
                <input
                  type="range"
                  min={-100}
                  max={100}
                  step={1}
                  value={vibrance}
                  onChange={(e) => { previewContinuousSliderRef.current = "color"; setVibrance(clampColorAdjustment(Number(e.target.value))); }}
                  onDoubleClick={() => { previewContinuousSliderRef.current = "color"; setVibrance(sliderDefaults.vibrance); }}
                  className="col-start-2 row-start-1 lg:col-span-2 lg:col-start-1 lg:row-start-2 w-full"
                />
              </label>
              </div>
            </div>

            <div className={`rounded border px-3 ${collapsedPanels.finishing ? "py-1.5" : "py-3 space-y-2 lg:space-y-3"}`}>
              <div className="flex items-center justify-between gap-2">
                <div className="font-medium">Finishing</div>
                {panelCollapseButton("finishing", "Finishing")}
              </div>
              <div className={collapsedPanels.finishing ? "hidden" : "space-y-2 lg:space-y-3"}>
              <label className="grid grid-cols-[112px_minmax(0,1fr)_56px] lg:grid-cols-2 items-center gap-x-2 gap-y-1">
                <span className="col-start-1 row-start-1">Denoise</span>
                <span className="col-start-3 row-start-1 w-14 text-right lg:w-auto lg:col-start-2 justify-self-end font-mono text-[12px]">{denoise}</span>
                <input
                  aria-label="Denoise"
                  type="range"
                  min={0}
                  max={100}
                  step={1}
                  value={denoise}
                  onChange={(e) => setDenoise(clampDenoise(Number(e.target.value)))}
                  onDoubleClick={() => setDenoise(sliderDefaults.denoise)}
                  className="col-start-2 row-start-1 lg:col-span-2 lg:col-start-1 lg:row-start-2 w-full"
                />
              </label>
              <label className="grid grid-cols-[112px_minmax(0,1fr)_56px] lg:grid-cols-2 items-center gap-x-2 gap-y-1">
                <span className="col-start-1 row-start-1">Defringe</span>
                <span className="col-start-3 row-start-1 w-14 text-right lg:w-auto lg:col-start-2 justify-self-end font-mono text-[12px]">{defringe}</span>
                <input
                  aria-label="Defringe"
                  type="range"
                  min={0}
                  max={100}
                  step={1}
                  value={defringe}
                  onChange={(e) => setDefringe(clampDefringe(Number(e.target.value)))}
                  onDoubleClick={() => setDefringe(sliderDefaults.defringe)}
                  className="col-start-2 row-start-1 lg:col-span-2 lg:col-start-1 lg:row-start-2 w-full"
                />
              </label>
              <div className="grid grid-cols-[112px_minmax(0,1fr)_56px] lg:grid-cols-2 items-center gap-x-2 gap-y-1">
                <div className="col-start-1 row-start-1 flex min-w-0 items-center gap-1">
                  <span>Resize</span>
                  {([
                    ["2MP", 2_000_000],
                    ["5MP", 5_000_000],
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
                  aria-label="Sharpen"
                  min={0}
                  max={7}
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
        </div>

        <div className="mt-4 flex flex-col gap-2 lg:flex-row lg:items-center">
          <div className="flex flex-col gap-y-0.5 text-[12px] text-gray-600 font-mono whitespace-nowrap lg:mr-auto lg:flex-row lg:flex-nowrap lg:gap-x-6 lg:gap-y-0">
            <span>
              Input: {natural ? `${natural.w}x${natural.h}, ${(natural.w * natural.h / 1_000_000).toFixed(1)}MP` : "—"}
            </span>
            <span>
              {isRawImageFile(file.name, file.type)
                ? rawDevelopmentStage === "thumbnail"
                  ? rawThumbnailRasterSize
                    ? `Thumbnail: ${rawThumbnailRasterSize.width}x${rawThumbnailRasterSize.height}, ${(rawThumbnailRasterSize.width * rawThumbnailRasterSize.height / 1_000_000).toFixed(1)}MP`
                    : "Thumbnail: —"
                  : rawDevelopmentStage === "preview"
                    ? previewRasterSize
                      ? `Preview: ${previewRasterSize.width}x${previewRasterSize.height}, ${(previewRasterSize.width * previewRasterSize.height / 1_000_000).toFixed(1)}MP`
                      : natural
                        ? `Preview: ${natural.w}x${natural.h}, ${(natural.w * natural.h / 1_000_000).toFixed(1)}MP`
                        : "Preview: —"
                    : rawDevelopmentStage === "denoised"
                      ? `Denoised: ${outputDimensions ? `${outputDimensions.w}x${outputDimensions.h}, ${(outputDimensions.w * outputDimensions.h / 1_000_000).toFixed(1)}MP` : "—"}`
                      : rawDevelopmentStage === "master"
                        ? `Master: ${outputDimensions ? `${outputDimensions.w}x${outputDimensions.h}, ${(outputDimensions.w * outputDimensions.h / 1_000_000).toFixed(1)}MP` : "—"}`
                        : "Preview: —"
                : `Output: ${outputDimensions ? `${outputDimensions.w}x${outputDimensions.h}, ${(outputDimensions.w * outputDimensions.h / 1_000_000).toFixed(1)}MP` : "—"}`}
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
              ref={finishButtonRef}
              className="px-3 py-1 rounded border border-blue-700 bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"
              onClick={onSubmit}
              disabled={applyBusy}
            >
              Finish
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
  const editTimingByPreviewUrlRef = useRef<Map<string, ImageEditTimingTrace>>(new Map());

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
              decodedForOptimize = await decodeRawUploadFastPathShared(f.file);
              if (cancelled) return;
              storeRawDevelopmentCache(f.id, f.file, decodedForOptimize);
            }

            const defaultEdit = buildUploadDefaultEditParams(
              f.name,
              f.type,
              meta.width ?? 0,
              meta.height ?? 0,
            );
            const outputColorProfile = await detectBestEditableImageOutputColorProfile(f.file);
            const prepared = await buildRawUploadDefaultFastVariant(
              decodedForOptimize,
              defaultEdit,
              outputColorProfile,
            );
            let out: { blob: Blob; width: number; height: number };
            try {
              out = await encodeEditedVariant(
                prepared,
                0.8,
                "image/webp",
                outputColorProfile,
              );
            } finally {
              releaseCanvasIfNeeded(prepared.canvas);
            }

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
            continue;
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
    const editTimingByPreviewUrl = editTimingByPreviewUrlRef.current;
    return () => {
      for (const url of revokeQueue.current) URL.revokeObjectURL(url);
      revokeQueue.current = [];
      editTimingByPreviewUrl.clear();
      rawDevelopmentCacheRef.current?.decoded.cleanup();
      rawDevelopmentCacheRef.current = null;
    };
  }, []);

  const reprocessItem = useCallback(async (
    snapshot: SelectedItem,
    nextEdit: ImageEditParams,
    decodedImage?: DecodedImage,
    previewClarityMap?: ImageEditClarityMap | null,
    defringeMap?: DefringeAnalysisMap | null,
    editTiming?: ImageEditTimingTrace,
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
        undefined,
        previewClarityMap,
        defringeMap,
        editTiming,
      );
      if (optimizeJobs.current.get(snapshot.id) !== token) {
        if (editTiming) {
          finalizeImageEditTiming(
            editTiming,
            performance.now() - editTiming.startedAtMs,
            "Finish result superseded",
          );
        }
        return;
      }
      const processedPreviewUrl = measureImageEditTimingSync(
        editTiming,
        "Creating result Blob URL",
        () => URL.createObjectURL(out.blob),
      );
      if (editTiming) editTimingByPreviewUrlRef.current.set(processedPreviewUrl, editTiming);
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
      if (editTiming) {
        // NextImage.onLoad is the preferred measurement because it observes the
        // actual preview element. A main-thread timer is the fallback; do not
        // depend on worker console output or worker-side timers.
        scheduleImageEditTimingFinalization(editTiming);
      }
    } catch (error) {
      if (editTiming) {
        console.error("[RAW timing] Finish failed on main thread", error);
        finalizeImageEditTiming(
          editTiming,
          performance.now() - editTiming.startedAtMs,
          "Finish failed",
        );
      }
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
          onApply={(params, decodedImage, previewClarityMap, defringeMap, editTiming) => {
            setEditingItemId(null);
            void reprocessItem(
              editingItem,
              params,
              decodedImage,
              previewClarityMap,
              defringeMap,
              editTiming,
            );
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
                        onLoad={() => {
                          const timing = it.previewUrl
                            ? editTimingByPreviewUrlRef.current.get(it.previewUrl)
                            : undefined;
                          if (!timing || !it.previewUrl) return;
                          editTimingByPreviewUrlRef.current.delete(it.previewUrl);
                          finalizeImageEditTiming(
                            timing,
                            performance.now() - timing.startedAtMs,
                          );
                        }}
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
