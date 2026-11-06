// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-nocheck
// Local Stack Studio controller. The algorithms are preserved from the standalone tool,
// but runtime/image primitives are imported from STGY shared modules.
import * as UTIF from "utif";
import {
  convertLinearProPhotoToOutputRgbInto,
  createRgb8ToLinearProphotoConverter,
  encodedRgbToLinearProphotoInto,
} from "@/image/color";
import {
  buildRawLensfunCorrection,
  lensfunOutputRegion,
} from "@/image/lensfun";
import { createLibRawInstance, createLibRawWorkerFailure, isRawImageFile } from "@/image/libraw";
import { getOpenCv } from "@/image/opencv";
import { encodeFromLinearProPhoto } from "@/image/tiff";
import type { DecodedRgbImage16, ImageEditOutputColorProfile } from "@/components/image-editor/types";
import { applySharpenToCanvas, applySharpenToRgb16 } from "@/components/image-editor/sharpen";
import { getCanvas2dContext, getCanvasImageData } from "@/components/image-editor/canvas";
import {
  adjustStackLinearData,
  adjustStackLinearDataPostTone,
  buildStackClaheMapFromToneAdjusted,
  buildStackToneAdjustedLinearData,
  computeStackFinalRolloff,
  computeStackHighlightInputP998,
  clampStackClahe,
  clampStackScaledLog,
} from "./postprocess";
import {
  createStackScratchSessionId as createMedianScratchSessionId,
  createStackScratchSessionId as createStfAdditionalBlurScratchSessionId,
  deleteStackScratchBuffers as deleteScratchBuffers,
  deleteStackScratchSession as deleteMedianScratchSession,
  deleteStackScratchSession as deleteStfAdditionalBlurScratchSession,
  getStackScratchBuffers as getScratchBuffers,
  getStackScratchBuffers as getStfAdditionalBlurScratchBuffers,
  openStackScratchDb as openMedianScratchDb,
  openStackScratchDb as openStfAdditionalBlurScratchDb,
  putStackScratchBuffers as putMedianScratchTiles,
  putStackScratchBuffers as putStfAdditionalBlurScratchBuffers,
} from "./scratch";
import { isAlignmentImplementationError } from "../workers/alignment-error";
import {
  createHdrDebevecReinhardStreamWorkerClient,
  createHdrMertensStreamWorkerClient,
  EccWorkerClient,
  FocusWorkerClient,
  MedianWorkerClient,
  OrbWorkerClient,
  PanoramaWorkerClient,
} from "./worker-clients";
import {
  runAlignmentPool,
  runProgressivePipelinedPool,
} from "./alignment-pool";
import { startProgressiveAlignmentFrames } from "./alignment-frame-worker-pool";
import { runMedianPool } from "./median-pool";
import {
  alignmentFrameCacheKey, getCachedAlignmentFrame, putCachedAlignmentFrame,
} from "./alignment-frame-cache";
import { MEDIAN_TILE_SIZE } from "./median";
import { runFocusFeaturePool } from "./focus-pool";
import { LinearMergeWorkerClient } from "./linear-merge-client";
import {
  buildLinearMergeStripeJobs,
  resolveLinearMergeWorkerCount,
  runLinearMergePool,
} from "./linear-merge-pool";
import {
  applyExposureAndRolloffInPlace,
} from "./linear-merge";
import {
  canonicalFilesSignature,
  completeCanonicalSession,
  createCanonicalSession,
  deleteCanonicalSession,
  estimateCanonicalCapacity,
  materializeCanonicalLinearImage,
  writeCanonicalLinearImage,
  writeCanonicalStoredImage,
} from "./canonical-source";
import { AlignedImageReader } from "./aligned-reader";
import { runLensfunCorrectionPool } from "./lensfun-pool";
import { buildStfApertureWeights, DEFAULT_STF_BLEND_WEIGHT } from "./stf-weights";
import { buildStfAdditionalBlurPlan, DEFAULT_STF_ADDITIONAL_BLUR_OPTIONS, STF_BLUR_STRENGTH_VALUES, STF_BLUR_AREA_GUARD_VALUES, STF_BLUR_RATIO_VALUES, STF_BLUR_SIGMOID_VALUES } from "./stf-additional-blur-mode";
import {
  DEFAULT_PANORAMA_DOWNSCALE_MEGAPIXELS,
  DEFAULT_PANORAMA_FINISH_MODE,
  parsePanoramaDownscaleMegapixels,
  parsePanoramaFinishMode,
} from "./panorama-options";
import { buildStfToneMatchPlans } from "./stf-tone-match";
import {
  computeFocusFinalMaps,
  computeFocusTileScores,
  emptyFocusRunningStats,
  focusGridDimensions,
  focusRunningStatsStd,
  focusSharpnessWorkingDimensions,
  mergeFocusRunningStats,
} from "./focus-math";
import {
  EXPOSURE_ROLLOFF_A,
  ROLLOFF_SAVING_LIMIT_FACTOR,
  applyRolloffMaxChannelLinearRgbInto,
  applyScaledLogLinear,
  applySigmoidLinear,
  applySigmoidLinearAtMidpoint,
  clamp01,
  srgbChannelToLinear,
  toneLinearIntensity,
  TONE_GAMMA20_GAIN_LUT_FINAL_SIZE,
  clampColorAdjustment,
  clampExposureEv,
  clampSigmoid,
  clampToneRangeAdjustment,
  rolloffParams,
} from "@/image/tone";

export type LocalStackStudioEditRequest = {
  file: File;
  decodedImage: DecodedRgbImage16;
  outputColorProfile: ImageEditOutputColorProfile;
  onApply: (editedImage: DecodedRgbImage16) => void;
  onCancel: () => void;
  onError: (message: string) => void;
};

type LocalStackStudioOptions = {
  onEditRequest?: (request: LocalStackStudioEditRequest) => void;
};

export function mountLocalStackStudio(options: LocalStackStudioOptions = {}): () => void {
const RAW_DECODE_SETTINGS = {
  outputColor: 4,
  outputBps: 16,
  gamm: [1, 1, 0, 0, 0, 0],
  useCameraWb: true,
  useCameraMatrix: 1,
  noAutoBright: true,
  adjustMaximumThr: 0,
  threshold: 0,
  medPasses: 0,
  fbddNoiserd: 0,
  highlight: 2,
  userQual: 11,
};
const PREVIEW_TARGET_PIXELS = 1_000_000;
const CENTER_FILL_GRAY_BYTE = 128;
const CENTER_FILL_GRAY_LINEAR = srgbChannelToLinear(CENTER_FILL_GRAY_BYTE);
const TILE_BORDER_MIN_PIXELS = 2;
const TILE_BORDER_DIAGONAL_RATIO = 0.01;
const PREVIEW_COLOR_SPACE = "srgb";
const LINEAR_TO_SRGB_BYTE_LUT = buildLinearToSrgbByteLut(16384);
const OUTPUT_SIZE_PRESETS = [
  { value: "16mp", label: "16MP", pixels: 16_000_000 },
  { value: "8mp", label: "8MP", pixels: 8_000_000 },
  { value: "4mp", label: "4MP", pixels: 4_000_000 },
  { value: "2mp", label: "2MP", pixels: 2_000_000 },
  { value: "1mp", label: "1MP", pixels: 1_000_000 },
];


const TONE_ANALYSIS_TARGET_PIXELS = 256 * 256;
const SINGLE_SHOT_HDR1_EXPOSURE_EVS = new Float32Array([-2, 0, 2]);
const SINGLE_SHOT_HDR1_SIGMOID_GAINS = new Float32Array([4, 2, 4]);
const SINGLE_SHOT_HDR1_EXPOSURE_TIMES = new Float32Array([1, 4, 16]);
// Single-shot HDR2 follows the scaled-log pair used by jkzr_proc DRO:
//   light: log(1 + c*x) / log(1 + c)
//   dark:  ((1 + c)^x - 1) / c
// c=4 matches the previous ±2 EV material strength while avoiding linear exposure scaling.
const SINGLE_SHOT_HDR2_SCALED_LOGS = new Float32Array([-4, 0, 4]);
const SINGLE_SHOT_HDR2_SIGMOID_GAINS = new Float32Array([4, 2, 4]);
const MULTI_SHOT_HDR2_SIGMOID_GAIN = 4;
const SINGLE_SHOT_HDR2_BASE_HEADROOM_GAIN = 0.95;
const SINGLE_SHOT_HDR_SATURATION_WEIGHT = 0.1;
const SINGLE_SHOT_HDR_EXPOSURE_WEIGHT = 1.0;
const RESULT_BUFFER_GAMMA = 2.0;
const RESULT_BUFFER_MAX_UINT16 = 65535;
const CENTER_FILL_GRAY_STORED_GAMMA2 = Math.round(
  Math.sqrt(CENTER_FILL_GRAY_LINEAR) * RESULT_BUFFER_MAX_UINT16,
);
// FocusGrid is scoring-only; processing and storage tiling remain independent.
const FOCUS_PROCESSING_CORE_SIZE = 1024;
// Five pyrDown operations require about 124px of source support; keep a 128px halo.
const FOCUS_HALO_SIZE = 128;
const DEFAULT_FOCUS_SOFTNESS = 0.1;
const FOCUS_MAX_PYRAMID_DOWNSAMPLES = 5;
const FOCUS_MERGE_MAX_WORKERS = 4;

const inputFiles = getElement("input-files");
const fileCount = getElement("file-count");
const mergeMode = getElement("merge-mode");
const mergeOptionsRow = getElement("merge-options-row");
const hdrSubmodeOption = getElement("hdr-submode-option");
const hdrSubmode = getElement("hdr-submode");
const tileDirectionOption = getElement("tile-direction-option");
const tileDirection = getElement("tile-direction");
const tileFoldingOption = getElement("tile-folding-option");
const tileFolding = getElement("tile-folding");
const panoramaDownscaleOption = getElement("panorama-downscale-option");
const panoramaDownscale = getElement("panorama-downscale");
const panoramaFinishOption = getElement("panorama-finish-option");
const panoramaFinish = getElement("panorama-finish");
const focusSoftnessOption = getElement("focus-softness-option");
const focusSoftness = getElement("focus-softness");
const stfBlendWeightOption = getElement("stf-blend-weight-option");
const stfBlendWeight = getElement("stf-blend-weight");
const stfBlurStrengthOption = getElement("stf-blur-strength-option");
const stfBlurStrength = getElement("stf-blur-strength");
const stfBlurRatioOption = getElement("stf-blur-ratio-option");
const stfBlurRatio = getElement("stf-blur-ratio");
const stfBlurAreaGuardOption = getElement("stf-blur-area-guard-option");
const stfBlurAreaGuard = getElement("stf-blur-area-guard");
const stfBlurSigmoidOption = getElement("stf-blur-sigmoid-option");
const stfBlurSigmoid = getElement("stf-blur-sigmoid");
const alignmentMode = getElement("alignment-mode");
const processButton = getElement("process-button");
const progressPanel = getElement("progress-panel");
const progressMessage = getElement("progress-message");
const errorPanel = getElement("error-panel");
const resultPanel = getElement("result-panel");
const usagePanel = getElement("usage-panel");
const previewImage = getElement("preview-image");
const previewExposure = getElement("preview-exposure");
const previewExposureValue = getElement("preview-exposure-value");
const previewShadow = getElement("preview-shadow");
const previewShadowValue = getElement("preview-shadow-value");
const previewHighlight = getElement("preview-highlight");
const previewHighlightValue = getElement("preview-highlight-value");
const previewLogarithm = getElement("preview-logarithm");
const previewLogarithmValue = getElement("preview-logarithm-value");
const previewSigmoid = getElement("preview-sigmoid");
const previewSigmoidValue = getElement("preview-sigmoid-value");
const previewClahe = getElement("preview-clahe");
const previewClaheValue = getElement("preview-clahe-value");
const previewVibrance = getElement("preview-vibrance");
const previewVibranceValue = getElement("preview-vibrance-value");
const previewSaturation = getElement("preview-saturation");
const previewSaturationValue = getElement("preview-saturation-value");
const editButton = getElement("edit-button");
const editButtonSpinner = getElement("edit-button-spinner");
const outputFormat = getElement("output-format");
const outputSize = getElement("output-size");
const downloadButton = getElement("download-button");
const downloadButtonSpinner = getElement("download-button-spinner");
const downloadButtonLabel = getElement("download-button-label");
const zoomModal = getElement("zoom-modal");
const zoomCloseButton = getElement("zoom-close-button");
const zoomLoading = getElement("zoom-loading");
const zoomMessage = getElement("zoom-message");
const zoomScrollContainer = getElement("zoom-scroll-container");
const zoomImage = getElement("zoom-image");

let currentStackResult = null;
let exifMetadataModulePromise = null;

function loadExifMetadataModule() {
  if (!exifMetadataModulePromise) {
    exifMetadataModulePromise = import("@/image/exif-metadata").catch((error) => {
      exifMetadataModulePromise = null;
      throw error;
    });
  }
  return exifMetadataModulePromise;
}

let currentCanonicalSession = null;
let currentPreviewColorSpace = "srgb";
let currentInputFiles = [];
let currentOutputMetadata = null;
let currentPreviewExposureEv = 0;
let currentPreviewShadow = 0;
let currentPreviewHighlight = 0;
let currentPreviewLogarithm = 0;
let currentPreviewSigmoid = 0;
let currentPreviewClahe = 0;
let currentPreviewVibrance = 0;
let currentPreviewSaturation = 0;
let previewRenderScheduled = false;
let currentZoomViewUrl = null;
let currentStackResultRevision = 0;
let fullSizeRenderCache = null;
let fullSizeRenderPending = null;
let fullSizeSharedSourceCache = null;
let fullSizeSharedClaheMapCache = new WeakMap();
let previewClaheMapCache = null;
let previewStageCache = null;
let previewPostToneCache = null;
let previewPostClaheCache = null;
let previewFinalRolloffCache = null;
let previewHighlightInputP998Cache = null;
let currentActivePreviewControl = null;
let zoomRenderRequestId = 0;
let zoomPanState = null;
let processingActive = false;

const listenerCleanups = [];
function listen(target, type, listener, options) {
  target.addEventListener(type, listener, options);
  listenerCleanups.push(() => target.removeEventListener(type, listener, options));
}

const STF_BLEND_WEIGHT_VALUES = new Set([1, 2, 4, 8, 16, 32]);
const FOCUS_SOFTNESS_VALUES = new Set([0, 0.05, 0.1, 0.15, 0.2, 0.25, 0.3, 0.35, 0.4, 0.45, 0.5]);

function updateAlignmentAvailability() {
  alignmentMode.disabled = processingActive || mergeMode.value === "panorama";
}

function updateMergeOptionsVisibility() {
  const isHdr = mergeMode.value === "hdr";
  const isStf = mergeMode.value === "stf";
  const isFocus = mergeMode.value === "focus";
  const isPanorama = mergeMode.value === "panorama";
  const isTile = mergeMode.value === "tile";
  mergeOptionsRow.classList.toggle("hidden", !isHdr && !isStf && !isFocus && !isPanorama && !isTile);
  hdrSubmodeOption.classList.toggle("hidden", !isHdr);
  hdrSubmodeOption.classList.toggle("flex", isHdr);
  tileDirectionOption.classList.toggle("hidden", !isTile);
  tileDirectionOption.classList.toggle("flex", isTile);
  tileFoldingOption.classList.toggle("hidden", !isTile);
  tileFoldingOption.classList.toggle("flex", isTile);
  panoramaDownscaleOption.classList.toggle("hidden", !isPanorama);
  panoramaDownscaleOption.classList.toggle("flex", isPanorama);
  panoramaFinishOption.classList.toggle("hidden", !isPanorama);
  panoramaFinishOption.classList.toggle("flex", isPanorama);
  focusSoftnessOption.classList.toggle("hidden", !isFocus);
  focusSoftnessOption.classList.toggle("flex", isFocus);
  stfBlendWeightOption.classList.toggle("hidden", !isStf);
  stfBlendWeightOption.classList.toggle("flex", isStf);
  stfBlurStrengthOption.classList.toggle("hidden", !isStf);
  stfBlurStrengthOption.classList.toggle("flex", isStf);
  updateStfBlurOptionsVisibility();
  updateAlignmentAvailability();
}

function updateStfBlurOptionsVisibility() {
  const active = mergeMode.value === "stf" && stfBlurStrength.value !== "none";
  for (const element of [stfBlurRatioOption, stfBlurAreaGuardOption, stfBlurSigmoidOption]) {
    element.classList.toggle("hidden", !active);
    element.classList.toggle("flex", active);
  }
  // Without Graph Cut and without sigmoid, Blur ratio is unused.
  stfBlurRatio.disabled = processingActive || !active ||
    (stfBlurAreaGuard.value === "none" && stfBlurSigmoid.value === "0");
  stfBlurRatio.title = stfBlurRatio.disabled && active && !processingActive
    ? "This setting is not used when area guard is none and sigmoid is 0%." : "";
}

function selectedInternalMergeMode() {
  if (mergeMode.value === "hdr") {
    return hdrSubmode.value === "mertens" ? "hdr2" : "hdr1";
  }
  if (mergeMode.value === "tile") {
    return tileDirection.value === "horizontal" ? "tile-horizontal" : "tile-vertical";
  }
  return mergeMode.value;
}

function selectedTileFolding() {
  if (tileFolding.value === "none") return null;
  const value = Number.parseInt(tileFolding.value, 10);
  return Number.isInteger(value) && value >= 2 && value <= 8 ? value : null;
}

function selectedPanoramaMaxOutputMegapixels() {
  const value = parsePanoramaDownscaleMegapixels(panoramaDownscale.value);
  return value === undefined ? DEFAULT_PANORAMA_DOWNSCALE_MEGAPIXELS : value;
}

function selectedPanoramaFinishMode() {
  return parsePanoramaFinishMode(panoramaFinish.value) ?? DEFAULT_PANORAMA_FINISH_MODE;
}

function selectedFocusSoftness() {
  const value = Number.parseFloat(focusSoftness.value);
  return FOCUS_SOFTNESS_VALUES.has(value) ? value : DEFAULT_FOCUS_SOFTNESS;
}

function selectedStfBlendWeight() {
  const value = Number.parseFloat(stfBlendWeight.value);
  return STF_BLEND_WEIGHT_VALUES.has(value) ? value : DEFAULT_STF_BLEND_WEIGHT;
}

function selectedStfBlurPlan() {
  // Reject any stale option that is not part of the production configuration.
  const strength = STF_BLUR_STRENGTH_VALUES.includes(stfBlurStrength.value)
    ? stfBlurStrength.value : DEFAULT_STF_ADDITIONAL_BLUR_OPTIONS.strength;
  const ratio = Number(stfBlurRatio.value);
  const areaGuard = stfBlurAreaGuard.value;
  const sigmoid = Number(stfBlurSigmoid.value);
  return buildStfAdditionalBlurPlan({
    strength,
    ratio: STF_BLUR_RATIO_VALUES.some((v) => Math.abs(v - ratio) < 1e-9) ? ratio : DEFAULT_STF_ADDITIONAL_BLUR_OPTIONS.ratio,
    areaGuard: STF_BLUR_AREA_GUARD_VALUES.includes(areaGuard) ? areaGuard : DEFAULT_STF_ADDITIONAL_BLUR_OPTIONS.areaGuard,
    sigmoid: STF_BLUR_SIGMOID_VALUES.includes(sigmoid) ? sigmoid : DEFAULT_STF_ADDITIONAL_BLUR_OPTIONS.sigmoid,
  });
}

updateMergeOptionsVisibility();
listen(mergeMode, "change", updateMergeOptionsVisibility);
listen(stfBlurStrength, "change", updateStfBlurOptionsVisibility);
listen(stfBlurAreaGuard, "change", updateStfBlurOptionsVisibility);
listen(stfBlurSigmoid, "change", updateStfBlurOptionsVisibility);

updateToneControlLabels();
previewExposure.disabled = true;
previewShadow.disabled = true;
previewHighlight.disabled = true;
previewLogarithm.disabled = true;
previewSigmoid.disabled = true;
previewClahe.disabled = true;
previewVibrance.disabled = true;
previewSaturation.disabled = true;
editButton.disabled = true;
outputSize.disabled = true;

listen(inputFiles, "change", () => {
  const previousCanonicalSession = currentCanonicalSession;
  currentCanonicalSession = null;
  resetStfGateCache();
  if (previousCanonicalSession) {
    deleteCanonicalSession(previousCanonicalSession).catch(() => {});
  }
  const count = inputFiles.files ? inputFiles.files.length : 0;
  fileCount.textContent = count === 0
    ? "No files selected"
    : count === 1
      ? "1 file selected"
      : `${count} files selected`;
  mergeMode.disabled = false;
});

function bindPreviewSlider(control, name, clampValue, assignValue) {
  listen(control, "input", () => {
    setActivePreviewControl(name);
    const value = clampValue(Number.parseFloat(control.value));
    assignValue(value);
    control.value = String(value);
    updateToneControlLabels();
    if (currentStackResult) schedulePreviewRender();
  });
  listen(control, "change", () => {
    currentActivePreviewControl = null;
  });
}

bindPreviewSlider(previewExposure, "exposure", clampExposureEv, (value) => {
  currentPreviewExposureEv = value;
});
bindPreviewSlider(previewShadow, "shadow", clampToneRangeAdjustment, (value) => {
  currentPreviewShadow = value;
});
bindPreviewSlider(previewHighlight, "highlight", clampToneRangeAdjustment, (value) => {
  currentPreviewHighlight = value;
});
bindPreviewSlider(previewLogarithm, "logarithm", clampStackScaledLog, (value) => {
  currentPreviewLogarithm = value;
});
bindPreviewSlider(previewSigmoid, "sigmoid", clampSigmoid, (value) => {
  currentPreviewSigmoid = value;
});
bindPreviewSlider(previewClahe, "clahe", clampStackClahe, (value) => {
  currentPreviewClahe = value;
});
bindPreviewSlider(previewVibrance, "vibrance", clampColorAdjustment, (value) => {
  currentPreviewVibrance = value;
});
bindPreviewSlider(previewSaturation, "saturation", clampColorAdjustment, (value) => {
  currentPreviewSaturation = value;
});

listen(previewExposure, "dblclick", () => resetToneControl("exposure"));
listen(previewShadow, "dblclick", () => resetToneControl("shadow"));
listen(previewHighlight, "dblclick", () => resetToneControl("highlight"));
listen(previewLogarithm, "dblclick", () => resetToneControl("logarithm"));
listen(previewSigmoid, "dblclick", () => resetToneControl("sigmoid"));
listen(previewClahe, "dblclick", () => resetToneControl("clahe"));
listen(previewVibrance, "dblclick", () => resetToneControl("vibrance"));
listen(previewSaturation, "dblclick", () => resetToneControl("saturation"));

listen(previewImage, "click", async (event) => {
  if (!currentStackResult) {
    return;
  }
  const clickPoint = getNormalizedImageClickPoint(event, previewImage);
  if (!clickPoint) {
    return;
  }
  await openZoomModalForPoint(clickPoint.x, clickPoint.y);
});

listen(zoomModal, "click", (event) => {
  if (event.target === zoomModal) {
    closeZoomModal();
  }
});
listen(zoomCloseButton, "click", (event) => {
  event.preventDefault();
  event.stopPropagation();
  closeZoomModal();
});
zoomImage.draggable = false;
listen(zoomImage, "dragstart", (event) => event.preventDefault());
listen(zoomScrollContainer, "pointerdown", beginZoomPan);
listen(zoomScrollContainer, "pointermove", moveZoomPan);
listen(zoomScrollContainer, "pointerup", endZoomPan);
listen(zoomScrollContainer, "pointercancel", endZoomPan);
listen(zoomScrollContainer, "lostpointercapture", endZoomPan);
listen(window, "keydown", (event) => {
  if (event.key === "Escape" && !zoomModal.classList.contains("hidden")) {
    closeZoomModal();
  }
});

listen(processButton, "click", async () => {
  const files = naturalSortFiles(Array.from(inputFiles.files || []));
  clearError();
  clearResult();
  setProcessing(true);

  try {
    if (files.length < 1) {
      throw new Error("Choose at least one input image.");
    }
    if (!["average", "median", "stf", "hdr", "focus", "panorama", "tile"].includes(mergeMode.value)) {
      throw new Error(`Unsupported merge mode: ${mergeMode.value}`);
    }
    if (mergeMode.value === "hdr" && !["debevec", "mertens"].includes(hdrSubmode.value)) {
      throw new Error(`Unsupported HDR submode: ${hdrSubmode.value}`);
    }
    if (mergeMode.value === "tile" && !["vertical", "horizontal"].includes(tileDirection.value)) {
      throw new Error(`Unsupported Tile direction: ${tileDirection.value}`);
    }
    if (mergeMode.value === "tile" && tileFolding.value !== "none") {
      const folding = Number.parseInt(tileFolding.value, 10);
      if (!Number.isInteger(folding) || folding < 2 || folding > 8) {
        throw new Error(`Unsupported Tile folding: ${tileFolding.value}`);
      }
    }
    if (mergeMode.value === "panorama") {
      const downscale = parsePanoramaDownscaleMegapixels(panoramaDownscale.value);
      if (downscale === undefined) {
        throw new Error(`Unsupported Panorama downscale: ${panoramaDownscale.value}`);
      }
      const finishMode = parsePanoramaFinishMode(panoramaFinish.value);
      if (finishMode === undefined) {
        throw new Error(`Unsupported Panorama finish: ${panoramaFinish.value}`);
      }
    }
    const selectedMergeMode = selectedInternalMergeMode();
    if (selectedMergeMode === "panorama" && files.length < 2) {
      throw new Error("Panorama requires at least two input images.");
    }
    if (!["auto", "center-crop", "center-fit", "center-fill", "top-left-fill", "feature-match-ecc", "feature-match-orb"].includes(alignmentMode.value)) {
      throw new Error(`Unsupported alignment mode: ${alignmentMode.value}`);
    }

    let cv = null;
    if (selectedMergeMode !== "panorama") {
      setProgress("Loading OpenCV.js...");
      cv = await getOpenCv();
      assertMainOpenCvApis(cv);
    }
    setProgress("Reading metadata, ICC profiles, and image sizes...");
    const inputInfos = await readInputInfos(files);
    const { mergeStackMetadata } = await loadExifMetadataModule();
    currentOutputMetadata = mergeStackMetadata(inputInfos.map((info) => info.preservedMetadata ?? null));
    const requireStfToneStatistics = files.length > 1 && selectedMergeMode === "stf";
    currentCanonicalSession = await ensureCanonicalSession(
      files,
      inputInfos,
      currentCanonicalSession,
      requireStfToneStatistics,
    );
    const useSyntheticSingleInputHdr = files.length === 1 && (selectedMergeMode === "hdr1" || selectedMergeMode === "hdr2");
    const preserveSingleInputMerge = isTileMergeMode(selectedMergeMode) || selectedMergeMode === "panorama";
    const effectiveMergeMode = useSyntheticSingleInputHdr
      ? selectedMergeMode
      : files.length === 1 && !preserveSingleInputMerge
        ? "average"
        : selectedMergeMode;
    const mergePlan = buildMergePlan(
      files,
      inputInfos,
      effectiveMergeMode,
      currentCanonicalSession.images,
      selectedStfBlendWeight(),
      selectedStfBlurPlan(),
      selectedTileFolding(),
      selectedFocusSoftness(),
      selectedPanoramaMaxOutputMegapixels(),
      selectedPanoramaFinishMode(),
    );
    const alignmentPlan = effectiveMergeMode === "panorama"
      ? null
      : buildAlignmentPlan(files, inputInfos, alignmentMode.value, effectiveMergeMode);
    currentPreviewColorSpace = chooseOutputColorSpace(inputInfos);

    currentStackResult = await alignAndMergeFilesWithOpenCv(
      cv,
      files,
      inputInfos,
      mergePlan,
      alignmentPlan,
      currentPreviewColorSpace,
      currentCanonicalSession,
    );
    currentStackResultRevision += 1;
    clearFullSizeRenderCache();
    clearPreviewRenderCaches();
    currentInputFiles = files.slice();
    currentPreviewExposureEv = 0;
    currentPreviewShadow = 0;
    currentPreviewHighlight = 0;
    currentPreviewLogarithm = 0;
    currentPreviewSigmoid = 0;
    currentPreviewClahe = 0;
    currentPreviewVibrance = 0;
    currentPreviewSaturation = 0;
    previewExposure.value = "0";
    previewShadow.value = "0";
    previewHighlight.value = "0";
    previewLogarithm.value = "0";
    previewSigmoid.value = "0";
    previewClahe.value = "0";
    previewVibrance.value = "0";
    previewSaturation.value = "0";
    updateToneControlLabels();
    updateOutputSizeOptions();
    renderPreviewForCurrentTone();
    setResultPanelVisible(true);
    setProgress("Done.");
  } catch (error) {
    showError(error);
  } finally {
    setProcessing(false);
  }
});

listen(editButton, "click", async () => {
  if (!currentStackResult) return;
  clearError();
  if (!options.onEditRequest) {
    showError(new Error("The image editor is not available."));
    return;
  }

  editButton.disabled = true;
  setEditButtonBusy(true);

  try {
    await waitForBusyPaint();
    const cache = await ensureFullSizeRenderCache();
    const decodedImage = {
      colorSpace: "prophoto",
      transfer: "gamma20",
      linearRangeMax: 1,
      width: currentStackResult.width,
      height: currentStackResult.height,
      data: encodeLinearToStoredGamma2(cache.adjustedLinear),
      cleanup: () => {},
    };
    const editFile = new File([], buildOutputFileName(currentInputFiles, "tiff16"), {
      type: "image/tiff",
    });
    let finished = false;

    options.onEditRequest({
      file: editFile,
      decodedImage,
      outputColorProfile: currentPreviewColorSpace === "display-p3" ? "display-p3" : "srgb",
      onApply: (editedImage) => {
        if (finished) return;
        finished = true;
        try {
          if (
            !editedImage ||
            editedImage.colorSpace !== "prophoto" ||
            editedImage.transfer !== "gamma20" ||
            !(editedImage.data instanceof Uint16Array) ||
            editedImage.width <= 0 ||
            editedImage.height <= 0 ||
            editedImage.data.length !== editedImage.width * editedImage.height * 3
          ) {
            throw new Error("The image editor returned an invalid image buffer.");
          }
          currentStackResult = finalizeStoredGamma2Result(
            new Uint16Array(editedImage.data),
            editedImage.width,
            editedImage.height,
            currentPreviewColorSpace,
          );
          currentStackResultRevision += 1;
          clearFullSizeRenderCache();
          clearPreviewRenderCaches();
          resetAllToneControls();
          updateOutputSizeOptions();
          closeZoomModal();
          renderPreviewForCurrentTone();
          setResultPanelVisible(true);
        } catch (error) {
          showError(error);
        } finally {
          editButton.disabled = !currentStackResult;
        }
      },
      onCancel: () => {
        if (finished) return;
        finished = true;
        editButton.disabled = !currentStackResult;
      },
      onError: (message) => {
        if (finished) return;
        finished = true;
        editButton.disabled = !currentStackResult;
        showError(new Error(message));
      },
    });
    setEditButtonBusy(false);
  } catch (error) {
    setEditButtonBusy(false);
    editButton.disabled = !currentStackResult;
    showError(error);
  }
});

listen(downloadButton, "click", async () => {
  if (!currentStackResult) return;
  clearError();
  const previousText = downloadButtonLabel.textContent;
  downloadButton.disabled = true;
  editButton.disabled = true;
  outputFormat.disabled = true;
  outputSize.disabled = true;
  previewExposure.disabled = true;
  previewShadow.disabled = true;
  previewHighlight.disabled = true;
  previewLogarithm.disabled = true;
  previewSigmoid.disabled = true;
  previewClahe.disabled = true;
  previewVibrance.disabled = true;
  previewSaturation.disabled = true;
  setDownloadButtonBusy(true);

  try {
    await waitForBusyPaint();
    const format = outputFormat.value;
    const cache = await ensureFullSizeRenderCache();
    const outputDimensions = getSelectedOutputDimensions(
      currentStackResult.width,
      currentStackResult.height,
    );
    const resized = outputDimensions.width !== currentStackResult.width || outputDimensions.height !== currentStackResult.height;

    if (format === "jpeg" && !resized) {
      downloadButtonLabel.textContent = "Encoding JPEG...";
      let jpegBlob = cache.jpegBlob;
      if (!jpegBlob) {
        jpegBlob = await linearAccumulatorToJpeg(
          cache.adjustedLinear,
          currentStackResult.width,
          currentStackResult.height,
          currentPreviewColorSpace,
        );
        {
          const { attachWhitelistedMetadata } = await loadExifMetadataModule();
          jpegBlob = await attachWhitelistedMetadata(jpegBlob, currentOutputMetadata);
        }
        if (fullSizeRenderCache === cache && cache.key === getFullSizeRenderCacheKey()) {
          cache.jpegBlob = jpegBlob;
        }
      }
      downloadBlob(jpegBlob, buildOutputFileName(currentInputFiles, "jpeg"));
      return;
    }

    if (format === "tiff8" && !resized) {
      downloadButtonLabel.textContent = "Encoding TIFF-8...";
      const encoded = await encodeFromLinearProPhoto({
        data: cache.adjustedLinear,
        width: currentStackResult.width,
        height: currentStackResult.height,
        bitsPerSample: 8,
        outputColorSpace: currentPreviewColorSpace,
        preferDeflate: true,
        metadata: currentOutputMetadata,
      });
      downloadBlob(encoded.blob, buildOutputFileName(currentInputFiles, "tiff8"));
      return;
    }

    if (format === "tiff16") {
      downloadButtonLabel.textContent = resized ? "Resizing TIFF-16..." : "Encoding TIFF-16...";
      let linearForTiff = cache.adjustedLinear;
      if (resized) {
        const resizedLinear = resizeLinearProPhotoBilinear(
          cache.adjustedLinear,
          currentStackResult.width,
          currentStackResult.height,
          outputDimensions.width,
          outputDimensions.height,
        );
        const sharpenedStored = encodeLinearToStoredGamma2(resizedLinear);
        applySharpenToRgb16(sharpenedStored, outputDimensions.width, outputDimensions.height, 2);
        linearForTiff = decodeStoredGamma2ToLinear(sharpenedStored);
        downloadButtonLabel.textContent = "Encoding TIFF-16...";
        await waitForBusyPaint();
      }
      const encoded = await encodeFromLinearProPhoto({
        data: linearForTiff,
        width: outputDimensions.width,
        height: outputDimensions.height,
        bitsPerSample: 16,
        outputColorSpace: currentPreviewColorSpace,
        preferDeflate: true,
        metadata: currentOutputMetadata,
      });
      downloadBlob(encoded.blob, buildOutputFileName(currentInputFiles, "tiff16"));
      return;
    }

    if (format === "jpeg" || format === "webp" || format === "tiff8") {
      downloadButtonLabel.textContent = resized ? "Resizing..." : `Encoding ${format === "webp" ? "WebP" : format === "jpeg" ? "JPEG" : "TIFF-8"}...`;
      const canvas = buildOutputCanvas(
        cache.adjustedLinear,
        currentStackResult.width,
        currentStackResult.height,
        outputDimensions.width,
        outputDimensions.height,
        currentPreviewColorSpace,
        resized,
      );
      if (resized) {
        applySharpenToCanvas(canvas, 2, currentPreviewColorSpace);
      }

      if (format === "jpeg" || format === "webp") {
        downloadButtonLabel.textContent = `Encoding ${format === "webp" ? "WebP" : "JPEG"}...`;
        await waitForBusyPaint();
        const blob = await canvasToImageBlob(canvas, format);
        const { attachWhitelistedMetadata } = await loadExifMetadataModule();
        const metadataBlob = await attachWhitelistedMetadata(blob, currentOutputMetadata);
        downloadBlob(metadataBlob, buildOutputFileName(currentInputFiles, format));
        return;
      }

      downloadButtonLabel.textContent = "Encoding TIFF-8...";
      await waitForBusyPaint();
      const resizedLinear = canvasToLinearProPhoto(canvas, currentPreviewColorSpace);
      const encoded = await encodeFromLinearProPhoto({
        data: resizedLinear,
        width: outputDimensions.width,
        height: outputDimensions.height,
        bitsPerSample: 8,
        outputColorSpace: currentPreviewColorSpace,
        preferDeflate: true,
        metadata: currentOutputMetadata,
      });
      downloadBlob(encoded.blob, buildOutputFileName(currentInputFiles, "tiff8"));
      return;
    }

    throw new Error(`Unsupported output format: ${format}`);
  } catch (error) {
    showError(error);
  } finally {
    setDownloadButtonBusy(false);
    downloadButton.disabled = false;
    editButton.disabled = !currentStackResult;
    outputFormat.disabled = false;
    outputSize.disabled = !currentStackResult;
    previewExposure.disabled = false;
    previewShadow.disabled = false;
    previewHighlight.disabled = false;
    previewLogarithm.disabled = false;
    previewSigmoid.disabled = false;
    previewClahe.disabled = false;
    previewVibrance.disabled = false;
    previewSaturation.disabled = false;
    downloadButtonLabel.textContent = previousText;
  }
});

function updateToneControlLabels() {
  previewExposureValue.textContent = `${formatToneControlValue(currentPreviewExposureEv)} EV`;
  previewShadowValue.textContent = formatIntegerToneControlValue(currentPreviewShadow);
  previewHighlightValue.textContent = formatIntegerToneControlValue(currentPreviewHighlight);
  previewLogarithmValue.textContent = formatToneControlValue(currentPreviewLogarithm);
  previewSigmoidValue.textContent = formatToneControlValue(currentPreviewSigmoid);
  previewClaheValue.textContent = formatIntegerToneControlValue(currentPreviewClahe);
  previewVibranceValue.textContent = formatIntegerToneControlValue(currentPreviewVibrance);
  previewSaturationValue.textContent = formatIntegerToneControlValue(currentPreviewSaturation);
}

function formatToneControlValue(value) {
  if (Math.abs(value) < 0.0001) return "0";
  return `${value > 0 ? "+" : ""}${value.toFixed(1)}`;
}

function formatIntegerToneControlValue(value) {
  if (!Number.isFinite(value) || value === 0) return "0";
  return `${value > 0 ? "+" : ""}${Math.round(value)}`;
}

function resetAllToneControls() {
  currentPreviewExposureEv = 0;
  currentPreviewShadow = 0;
  currentPreviewHighlight = 0;
  currentPreviewLogarithm = 0;
  currentPreviewSigmoid = 0;
  currentPreviewClahe = 0;
  currentPreviewVibrance = 0;
  currentPreviewSaturation = 0;
  previewExposure.value = "0";
  previewShadow.value = "0";
  previewHighlight.value = "0";
  previewLogarithm.value = "0";
  previewSigmoid.value = "0";
  previewClahe.value = "0";
  previewVibrance.value = "0";
  previewSaturation.value = "0";
  updateToneControlLabels();
}

function resetToneControl(name) {
  if (name === "exposure") {
    currentPreviewExposureEv = 0;
    previewExposure.value = "0";
  } else if (name === "shadow") {
    currentPreviewShadow = 0;
    previewShadow.value = "0";
  } else if (name === "highlight") {
    currentPreviewHighlight = 0;
    previewHighlight.value = "0";
  } else if (name === "logarithm") {
    currentPreviewLogarithm = 0;
    previewLogarithm.value = "0";
  } else if (name === "sigmoid") {
    currentPreviewSigmoid = 0;
    previewSigmoid.value = "0";
  } else if (name === "clahe") {
    currentPreviewClahe = 0;
    previewClahe.value = "0";
  } else if (name === "vibrance") {
    currentPreviewVibrance = 0;
    previewVibrance.value = "0";
  } else if (name === "saturation") {
    currentPreviewSaturation = 0;
    previewSaturation.value = "0";
  }
  updateToneControlLabels();
  setActivePreviewControl(name);
  if (currentStackResult) schedulePreviewRender();
}

function schedulePreviewRender() {
  if (previewRenderScheduled) return;
  previewRenderScheduled = true;
  window.requestAnimationFrame(() => {
    previewRenderScheduled = false;
    try {
      renderPreviewForCurrentTone();
    } catch (error) {
      showError(error);
    }
  });
}

function renderPreviewForCurrentTone() {
  if (!currentStackResult) return;
  const adjustedLinear = getCurrentPreviewAdjustedLinear();
  renderLinearDataToCanvas(
    previewImage,
    adjustedLinear,
    currentStackResult.previewWidth,
    currentStackResult.previewHeight,
    PREVIEW_COLOR_SPACE,
    currentStackResult.previewRgba8,
  );
  previewExposure.disabled = false;
  previewShadow.disabled = false;
  previewHighlight.disabled = false;
  previewLogarithm.disabled = false;
  previewSigmoid.disabled = false;
  previewClahe.disabled = false;
  previewVibrance.disabled = false;
  previewSaturation.disabled = false;
  setResultPanelVisible(true);
}

function getCurrentHighlightInputP998() {
  if (!currentStackResult || currentPreviewHighlight >= 0) return 1;
  const key = JSON.stringify([
    currentStackResultRevision,
    currentPreviewExposureEv,
    currentPreviewShadow,
    currentPreviewHighlight,
    currentPreviewLogarithm,
    currentPreviewSigmoid,
  ]);
  if (previewHighlightInputP998Cache && previewHighlightInputP998Cache.key === key) {
    return previewHighlightInputP998Cache.value;
  }
  const value = computeStackHighlightInputP998(
    currentStackResult.analysisLinearProPhotoRgb,
    currentPreviewExposureEv,
    currentPreviewShadow,
    currentPreviewHighlight,
    currentPreviewLogarithm,
    currentPreviewSigmoid,
  );
  previewHighlightInputP998Cache = { key, value };
  return value;
}

function getCurrentFinalRolloff() {
  if (!currentStackResult) return null;
  const key = JSON.stringify([
    currentStackResultRevision,
    currentPreviewExposureEv,
    currentPreviewShadow,
    currentPreviewHighlight,
    currentPreviewLogarithm,
    currentPreviewSigmoid,
    currentPreviewVibrance,
    currentPreviewSaturation,
  ]);
  if (previewFinalRolloffCache && previewFinalRolloffCache.key === key) {
    return previewFinalRolloffCache.rolloff;
  }
  const rolloff = computeStackFinalRolloff(
    currentStackResult.analysisLinearProPhotoRgb,
    currentPreviewExposureEv,
    currentPreviewShadow,
    currentPreviewHighlight,
    currentPreviewLogarithm,
    currentPreviewSigmoid,
    currentPreviewVibrance,
    currentPreviewSaturation,
    getCurrentHighlightInputP998(),
  );
  previewFinalRolloffCache = { key, rolloff };
  return rolloff;
}

function getCurrentPreviewAdjustedLinear() {
  if (!currentStackResult) {
    throw new Error("No stacked image is available.");
  }
  const finalRolloff = getCurrentFinalRolloff();
  if (currentActivePreviewControl === "vibrance" || currentActivePreviewControl === "saturation") {
    const postClahe = getCurrentPreviewPostClaheBase();
    return adjustStackLinearDataPostTone(
      postClahe,
      currentStackResult.previewWidth,
      currentStackResult.previewHeight,
      0,
      currentPreviewVibrance,
      currentPreviewSaturation,
      null,
      currentPreviewColorSpace,
      true,
      finalRolloff,
    );
  }

  const toneAdjusted = getCurrentPreviewFullTone();
  const claheMap = getCurrentClaheMap(toneAdjusted);
  return adjustStackLinearDataPostTone(
    toneAdjusted,
    currentStackResult.previewWidth,
    currentStackResult.previewHeight,
    currentPreviewClahe,
    currentPreviewVibrance,
    currentPreviewSaturation,
    claheMap,
    currentPreviewColorSpace,
    true,
    finalRolloff,
  );
}

function getCurrentClaheMap(toneAdjustedLinear = null) {
  if (!currentStackResult) return null;
  const normalizedClahe = clampStackClahe(currentPreviewClahe);
  if (normalizedClahe === 0) {
    previewClaheMapCache = null;
    return null;
  }
  const key = JSON.stringify([
    currentStackResultRevision,
    currentStackResult.previewWidth,
    currentStackResult.previewHeight,
    currentPreviewExposureEv,
    currentPreviewShadow,
    currentPreviewHighlight,
    currentPreviewLogarithm,
    currentPreviewSigmoid,
    normalizedClahe,
  ]);
  if (previewClaheMapCache && previewClaheMapCache.key === key) {
    return previewClaheMapCache.map;
  }
  const toneAdjusted = toneAdjustedLinear ?? getCurrentPreviewFullTone();
  const map = buildStackClaheMapFromToneAdjusted(
    toneAdjusted,
    currentStackResult.previewWidth,
    currentStackResult.previewHeight,
    normalizedClahe,
  );
  previewClaheMapCache = map ? { key, map } : null;
  return map;
}

function setActivePreviewControl(name) {
  if (currentActivePreviewControl === name) return;
  currentActivePreviewControl = name;
  previewStageCache = null;
  previewPostToneCache = null;
  previewPostClaheCache = null;
}

function clearPreviewRenderCaches() {
  previewClaheMapCache = null;
  previewStageCache = null;
  previewPostToneCache = null;
  previewPostClaheCache = null;
  previewFinalRolloffCache = null;
  previewHighlightInputP998Cache = null;
  currentActivePreviewControl = null;
}

function getCurrentPreviewFullTone() {
  if (!currentStackResult) {
    throw new Error("No stacked image is available.");
  }
  const key = JSON.stringify([
    currentStackResultRevision,
    currentStackResult.previewWidth,
    currentStackResult.previewHeight,
    currentPreviewExposureEv,
    currentPreviewShadow,
    currentPreviewHighlight,
    currentPreviewLogarithm,
    currentPreviewSigmoid,
  ]);
  if (previewPostToneCache && previewPostToneCache.key === key) {
    return previewPostToneCache.data;
  }
  const data = getPreviewToneAdjustedForActiveControl();
  previewPostToneCache = { key, data };
  return data;
}

function getPreviewToneAdjustedForActiveControl() {
  if (!currentStackResult) {
    throw new Error("No stacked image is available.");
  }
  const config = getPreviewTonePrefixConfig(currentActivePreviewControl);
  if (!config || config.prefixStage === "source") {
    return buildStackToneAdjustedLinearData(
      currentStackResult.previewLinearProPhotoRgb,
      currentStackResult.previewWidth,
      currentStackResult.previewHeight,
      currentPreviewExposureEv,
      currentPreviewShadow,
      currentPreviewHighlight,
      currentPreviewLogarithm,
      currentPreviewSigmoid,
      "source",
      "highlight",
      undefined,
      getCurrentHighlightInputP998(),
    );
  }
  const prefixData = getCachedPreviewToneStage(config.prefixStage);
  return buildStackToneAdjustedLinearData(
    prefixData,
    currentStackResult.previewWidth,
    currentStackResult.previewHeight,
    currentPreviewExposureEv,
    currentPreviewShadow,
    currentPreviewHighlight,
    currentPreviewLogarithm,
    currentPreviewSigmoid,
    config.prefixStage,
    "highlight",
    undefined,
    getCurrentHighlightInputP998(),
  );
}

function getCurrentPreviewPostClaheBase() {
  if (!currentStackResult) {
    throw new Error("No stacked image is available.");
  }
  const key = JSON.stringify([
    currentStackResultRevision,
    currentStackResult.previewWidth,
    currentStackResult.previewHeight,
    currentPreviewExposureEv,
    currentPreviewShadow,
    currentPreviewHighlight,
    currentPreviewLogarithm,
    currentPreviewSigmoid,
    currentPreviewClahe,
    currentPreviewColorSpace,
  ]);
  if (previewPostClaheCache && previewPostClaheCache.key === key) {
    return previewPostClaheCache.data;
  }
  const toneAdjusted = getCurrentPreviewFullTone();
  const claheMap = getCurrentClaheMap(toneAdjusted);
  const data = adjustStackLinearDataPostTone(
    toneAdjusted,
    currentStackResult.previewWidth,
    currentStackResult.previewHeight,
    currentPreviewClahe,
    0,
    0,
    claheMap,
    currentPreviewColorSpace,
    false,
  );
  previewPostClaheCache = { key, data };
  return data;
}

function getCachedPreviewToneStage(stage) {
  if (!currentStackResult) {
    throw new Error("No stacked image is available.");
  }
  if (stage === "source") return currentStackResult.previewLinearProPhotoRgb;

  const stageOrder = ["source", "exposure", "logarithm", "sigmoid", "shadow", "highlight"];
  const stageIndex = stageOrder.indexOf(stage);
  const includes = (candidate) => stageIndex >= stageOrder.indexOf(candidate);
  const key = JSON.stringify([
    currentStackResultRevision,
    stage,
    currentStackResult.previewWidth,
    currentStackResult.previewHeight,
    includes("exposure") ? currentPreviewExposureEv : null,
    includes("logarithm") ? currentPreviewLogarithm : null,
    includes("sigmoid") ? currentPreviewSigmoid : null,
    includes("shadow") ? currentPreviewShadow : null,
    includes("highlight") ? currentPreviewHighlight : null,
  ]);
  if (previewStageCache && previewStageCache.key === key) {
    return previewStageCache.data;
  }
  const data = buildStackToneAdjustedLinearData(
    currentStackResult.previewLinearProPhotoRgb,
    currentStackResult.previewWidth,
    currentStackResult.previewHeight,
    currentPreviewExposureEv,
    currentPreviewShadow,
    currentPreviewHighlight,
    currentPreviewLogarithm,
    currentPreviewSigmoid,
    "source",
    stage,
    undefined,
    getCurrentHighlightInputP998(),
  );
  previewStageCache = { key, data };
  return data;
}

function getPreviewTonePrefixConfig(control) {
  if (control === "logarithm") return { prefixStage: "exposure" };
  if (control === "sigmoid") return { prefixStage: "logarithm" };
  if (control === "shadow") return { prefixStage: "sigmoid" };
  if (control === "highlight") return { prefixStage: "shadow" };
  if (control === "clahe" || control === "vibrance" || control === "saturation") {
    return { prefixStage: "highlight" };
  }
  return { prefixStage: "source" };
}

function setEditButtonBusy(busy) {
  editButtonSpinner.classList.toggle("hidden", !busy);
  editButton.setAttribute("aria-busy", busy ? "true" : "false");
}

function setDownloadButtonBusy(busy) {
  downloadButtonSpinner.classList.toggle("hidden", !busy);
  downloadButton.setAttribute("aria-busy", busy ? "true" : "false");
}

function getFullSizeRenderCacheKey() {
  if (!currentStackResult) return null;
  return JSON.stringify([
    currentStackResultRevision,
    currentStackResult.width,
    currentStackResult.height,
    currentPreviewColorSpace,
    currentPreviewExposureEv,
    currentPreviewShadow,
    currentPreviewHighlight,
    currentPreviewLogarithm,
    currentPreviewSigmoid,
    currentPreviewClahe,
    currentPreviewVibrance,
    currentPreviewSaturation,
  ]);
}


async function ensureFullSizeRenderCache() {
  if (!currentStackResult) {
    throw new Error("No stacked image is available.");
  }
  const key = getFullSizeRenderCacheKey();
  if (fullSizeRenderCache && fullSizeRenderCache.key === key) {
    return fullSizeRenderCache;
  }
  if (fullSizeRenderPending && fullSizeRenderPending.key === key) {
    return fullSizeRenderPending.promise;
  }

  const stackResult = currentStackResult;
  const resultRevision = currentStackResultRevision;
  const promise = buildFullSizeRenderCache(stackResult, key, resultRevision);
  fullSizeRenderPending = { key, promise };
  try {
    const cache = await promise;
    if (
      currentStackResult === stackResult &&
      currentStackResultRevision === resultRevision &&
      getFullSizeRenderCacheKey() === key
    ) {
      fullSizeRenderCache = cache;
      return cache;
    }
    // The former synchronous path implicitly froze UI state while rendering.
    // Workers make the UI responsive, so a slider/result may change mid-render;
    // in that case render the newest state instead of returning a stale image.
    if (currentStackResult) {
      return await ensureFullSizeRenderCache();
    }
    throw new Error("No stacked image is available.");
  } finally {
    if (fullSizeRenderPending?.promise === promise) {
      fullSizeRenderPending = null;
    }
  }
}

async function buildFullSizeRenderCache(stackResult, key, resultRevision) {
  const claheMap = getCurrentClaheMap();
  const finalRolloff = getCurrentFinalRolloff();
  const outputColorProfile = currentPreviewColorSpace;
  const options = {
    exposureEv: currentPreviewExposureEv,
    highlightInputP998: getCurrentHighlightInputP998(),
    shadow: currentPreviewShadow,
    highlight: currentPreviewHighlight,
    scaledLog: currentPreviewLogarithm,
    sigmoid: currentPreviewSigmoid,
    clahe: currentPreviewClahe,
    vibrance: currentPreviewVibrance,
    saturation: currentPreviewSaturation,
    claheMap,
    applyFinalRolloff: true,
    finalRolloff,
    toneLutSize: TONE_GAMMA20_GAIN_LUT_FINAL_SIZE,
  };

  let adjustedLinear = null;
  if (
    typeof Worker === "function" &&
    typeof SharedArrayBuffer === "function" &&
    globalThis.crossOriginIsolated === true
  ) {
    try {
      adjustedLinear = await renderFullSizeStackInWorkers(
        stackResult,
        resultRevision,
        options,
      );
    } catch {}
  }

  if (!adjustedLinear) {
    const sourceLinear = decodeStoredGamma2ToLinear(stackResult.gamma2ProPhotoRgb16);
    adjustedLinear = adjustStackLinearData(
      sourceLinear,
      stackResult.width,
      stackResult.height,
      options.exposureEv,
      options.shadow,
      options.highlight,
      options.scaledLog,
      options.sigmoid,
      options.clahe,
      options.vibrance,
      options.saturation,
      options.claheMap,
      outputColorProfile,
      options.finalRolloff,
      options.toneLutSize,
      options.highlightInputP998,
    );
  }

  return {
    key,
    adjustedLinear,
    jpegBlob: null,
  };
}

async function renderFullSizeStackInWorkers(stackResult, resultRevision, options) {
  const width = stackResult.width;
  const height = stackResult.height;
  const sourceBuffer = getFullSizeSharedSourceBuffer(stackResult, resultRevision);
  const outputBuffer = new SharedArrayBuffer(
    width * height * 3 * Float32Array.BYTES_PER_ELEMENT,
  );
  const sharedClaheMap = getFullSizeSharedClaheMap(options.claheMap);
  const workerOptions = {
    ...options,
    claheMap: sharedClaheMap,
  };
  const hardwareConcurrency = typeof navigator === "object"
    ? Math.max(1, Math.floor(navigator.hardwareConcurrency || 4))
    : 4;
  const workerCount = Math.max(1, Math.min(4, hardwareConcurrency, height));
  const workers = [];

  try {
    const workerUrl = new URL("/generated/local-stack-studio/full-render.worker.js", window.location.origin);
    for (let workerIndex = 0; workerIndex < workerCount; workerIndex += 1) {
      workers.push(new Worker(workerUrl));
    }
    await Promise.all(workers.map((worker, workerIndex) => {
      const rowStart = Math.floor(height * workerIndex / workerCount);
      const rowEnd = Math.floor(height * (workerIndex + 1) / workerCount);
      return requestFullSizeRenderWorker(worker, {
        type: "render-rows",
        requestId: workerIndex + 1,
        workerIndex,
        sourceBuffer,
        outputBuffer,
        width,
        height,
        rowStart,
        rowEnd,
        options: workerOptions,
      });
    }));
    return new Float32Array(outputBuffer);
  } finally {
    for (const worker of workers) worker.terminate();
  }
}

function requestFullSizeRenderWorker(worker, message) {
  return new Promise((resolve, reject) => {
    const requestId = message.requestId;
    worker.onmessage = (event) => {
      const response = event.data || {};
      if (response.requestId !== requestId) return;
      if (response.type === "error") {
        reject(new Error(response.message || "LSS full-size render worker failed."));
        return;
      }
      if (response.type === "render-rows-complete") resolve(response);
    };
    worker.onerror = (event) => {
      reject(new Error(event.message || "LSS full-size render worker failed."));
    };
    worker.postMessage(message);
  });
}

function getFullSizeSharedSourceBuffer(stackResult, resultRevision) {
  if (
    fullSizeSharedSourceCache &&
    fullSizeSharedSourceCache.revision === resultRevision &&
    fullSizeSharedSourceCache.source === stackResult.gamma2ProPhotoRgb16
  ) {
    return fullSizeSharedSourceCache.buffer;
  }
  const buffer = new SharedArrayBuffer(stackResult.gamma2ProPhotoRgb16.byteLength);
  new Uint16Array(buffer).set(stackResult.gamma2ProPhotoRgb16);
  fullSizeSharedSourceCache = {
    revision: resultRevision,
    source: stackResult.gamma2ProPhotoRgb16,
    buffer,
  };
  return buffer;
}

function getFullSizeSharedClaheMap(claheMap) {
  if (!claheMap) return null;
  const cached = fullSizeSharedClaheMapCache.get(claheMap);
  if (cached) return cached;
  const gainBuffer = new SharedArrayBuffer(claheMap.gain.byteLength);
  new Float32Array(gainBuffer).set(claheMap.gain);
  const shared = {
    width: claheMap.width,
    height: claheMap.height,
    strength: claheMap.strength,
    gainBuffer,
  };
  fullSizeSharedClaheMapCache.set(claheMap, shared);
  return shared;
}

function clearFullSizeRenderCache() {
  fullSizeRenderCache = null;
  fullSizeRenderPending = null;
  fullSizeSharedSourceCache = null;
  fullSizeSharedClaheMapCache = new WeakMap();
}

function renderLinearDataToCanvas(
  canvas,
  sourceLinear,
  width,
  height,
  outputColorSpace,
  output,
) {
  const converted = new Float32Array(3);
  for (let outputIndex = 0, sourceIndex = 0; outputIndex < output.length; outputIndex += 4, sourceIndex += 3) {
    convertLinearProPhotoToOutputRgbInto(
      sourceLinear[sourceIndex],
      sourceLinear[sourceIndex + 1],
      sourceLinear[sourceIndex + 2],
      outputColorSpace,
      converted,
    );
    output[outputIndex] = linearToSrgbByteFast(converted[0]);
    output[outputIndex + 1] = linearToSrgbByteFast(converted[1]);
    output[outputIndex + 2] = linearToSrgbByteFast(converted[2]);
    output[outputIndex + 3] = 255;
  }

  if (canvas.width !== width) canvas.width = width;
  if (canvas.height !== height) canvas.height = height;
  let context = canvas.getContext("2d", { colorSpace: outputColorSpace, willReadFrequently: false });
  if (!context) context = canvas.getContext("2d");
  if (!context) throw new Error("Could not create a 2D canvas context for the preview.");
  context.putImageData(createColorManagedImageData(output, width, height, outputColorSpace), 0, 0);
}

function linearToSrgbByteFast(linear) {
  if (!Number.isFinite(linear) || linear <= 0) return 0;
  if (linear >= 1) return 255;
  return LINEAR_TO_SRGB_BYTE_LUT[Math.round(linear * (LINEAR_TO_SRGB_BYTE_LUT.length - 1))];
}

function getNormalizedImageClickPoint(event, imageElement) {
  const rect = imageElement.getBoundingClientRect();
  if (!(rect.width > 0 && rect.height > 0)) {
    return null;
  }
  const x = (event.clientX - rect.left) / rect.width;
  const y = (event.clientY - rect.top) / rect.height;
  return {
    x: Math.max(0, Math.min(1, x)),
    y: Math.max(0, Math.min(1, y)),
  };
}

function waitForBusyPaint() {
  return new Promise((resolve) => {
    requestAnimationFrame(() => {
      requestAnimationFrame(resolve);
    });
  });
}

async function openZoomModalForPoint(normalizedX, normalizedY) {
  if (!currentStackResult) return;
  const requestId = ++zoomRenderRequestId;
  const cacheKey = getFullSizeRenderCacheKey();
  const hasCachedJpeg = Boolean(
    fullSizeRenderCache &&
    fullSizeRenderCache.key === cacheKey &&
    fullSizeRenderCache.jpegBlob,
  );

  zoomModal.classList.remove("hidden");
  zoomLoading.classList.toggle("hidden", hasCachedJpeg);
  zoomScrollContainer.classList.add("hidden");
  zoomMessage.textContent = "Rendering full-size view...";
  clearZoomView();

  if (!hasCachedJpeg) {
    // Give the browser a chance to paint the modal and spinner before the
    // full-size worker render begins.
    await waitForBusyPaint();
    if (requestId !== zoomRenderRequestId) {
      return;
    }
  }

  try {
    const cache = await ensureFullSizeRenderCache();
    let blob = cache.jpegBlob;
    if (!blob) {
      blob = await linearAccumulatorToJpeg(
        cache.adjustedLinear,
        currentStackResult.width,
        currentStackResult.height,
        currentPreviewColorSpace,
      );
      if (fullSizeRenderCache === cache && cache.key === getFullSizeRenderCacheKey()) {
        cache.jpegBlob = blob;
      }
    }
    if (requestId !== zoomRenderRequestId) {
      return;
    }
    currentZoomViewUrl = URL.createObjectURL(blob);
    await loadZoomImage(currentZoomViewUrl);
    zoomLoading.classList.add("hidden");
    zoomScrollContainer.classList.remove("hidden");
    centerZoomOnPoint(normalizedX, normalizedY);
  } catch (error) {
    if (requestId === zoomRenderRequestId) {
      closeZoomModal();
    }
    throw error;
  }
}

function loadZoomImage(url) {
  return new Promise((resolve, reject) => {
    zoomImage.onload = () => resolve();
    zoomImage.onerror = () => reject(new Error("Failed to render the full-size preview image."));
    zoomImage.src = url;
  });
}

function centerZoomOnPoint(normalizedX, normalizedY) {
  const container = zoomScrollContainer;
  const imageWidth = zoomImage.naturalWidth || zoomImage.width;
  const imageHeight = zoomImage.naturalHeight || zoomImage.height;
  const maxLeft = Math.max(0, imageWidth - container.clientWidth);
  const maxTop = Math.max(0, imageHeight - container.clientHeight);
  const targetLeft = normalizedX * imageWidth - container.clientWidth / 2;
  const targetTop = normalizedY * imageHeight - container.clientHeight / 2;
  container.scrollLeft = Math.max(0, Math.min(maxLeft, targetLeft));
  container.scrollTop = Math.max(0, Math.min(maxTop, targetTop));
}

function beginZoomPan(event) {
  if (event.target !== zoomImage) return;
  if (event.pointerType === "touch") return;
  if (event.button !== 0) return;

  zoomPanState = {
    pointerId: event.pointerId,
    startX: event.clientX,
    startY: event.clientY,
    startScrollLeft: zoomScrollContainer.scrollLeft,
    startScrollTop: zoomScrollContainer.scrollTop,
  };
  zoomScrollContainer.classList.add("is-dragging");
  zoomScrollContainer.setPointerCapture(event.pointerId);
  event.preventDefault();
}

function moveZoomPan(event) {
  if (!zoomPanState || event.pointerId !== zoomPanState.pointerId) return;
  const dx = event.clientX - zoomPanState.startX;
  const dy = event.clientY - zoomPanState.startY;
  zoomScrollContainer.scrollLeft = zoomPanState.startScrollLeft - dx;
  zoomScrollContainer.scrollTop = zoomPanState.startScrollTop - dy;
  event.preventDefault();
}

function endZoomPan(event) {
  if (!zoomPanState || event.pointerId !== zoomPanState.pointerId) return;
  if (zoomScrollContainer.hasPointerCapture?.(event.pointerId)) {
    zoomScrollContainer.releasePointerCapture(event.pointerId);
  }
  zoomPanState = null;
  zoomScrollContainer.classList.remove("is-dragging");
}

function closeZoomModal() {
  zoomRenderRequestId += 1;
  zoomPanState = null;
  zoomScrollContainer.classList.remove("is-dragging");
  zoomModal.classList.add("hidden");
  zoomLoading.classList.add("hidden");
  zoomScrollContainer.classList.add("hidden");
  clearZoomView();
}

function clearZoomView() {
  zoomImage.onload = null;
  zoomImage.onerror = null;
  zoomImage.removeAttribute("src");
  if (currentZoomViewUrl) {
    URL.revokeObjectURL(currentZoomViewUrl);
    currentZoomViewUrl = null;
  }
}

function downloadBlob(blob, fileName) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

function updateOutputSizeOptions() {
  const previousValue = outputSize.value || "full";
  const sourcePixels = currentStackResult
    ? currentStackResult.width * currentStackResult.height
    : 0;
  outputSize.replaceChildren();

  const fullOption = document.createElement("option");
  fullOption.value = "full";
  fullOption.textContent = "Full-size";
  outputSize.appendChild(fullOption);

  if (currentStackResult) {
    for (const preset of OUTPUT_SIZE_PRESETS) {
      if (preset.pixels > sourcePixels) continue;
      const option = document.createElement("option");
      option.value = preset.value;
      option.textContent = preset.label;
      outputSize.appendChild(option);
    }
  }

  const previousStillAvailable = Array.from(outputSize.options).some((option) => option.value === previousValue);
  outputSize.value = previousStillAvailable ? previousValue : "full";
  outputSize.disabled = !currentStackResult;
}

function getSelectedOutputDimensions(sourceWidth, sourceHeight) {
  const sourcePixels = sourceWidth * sourceHeight;
  const preset = OUTPUT_SIZE_PRESETS.find((item) => item.value === outputSize.value);
  if (!preset || preset.pixels >= sourcePixels) {
    return { width: sourceWidth, height: sourceHeight };
  }
  const scale = Math.sqrt(preset.pixels / sourcePixels);
  return {
    width: Math.max(1, Math.round(sourceWidth * scale)),
    height: Math.max(1, Math.round(sourceHeight * scale)),
  };
}

function buildOutputFileName(files, format) {
  const names = files.map((file) => basename(file.name)).filter((name) => name.length > 0);
  const firstName = names[0] || "merged";
  const commonPrefix = findCommonPrefix(names);
  const selectedPrefix = commonPrefix.length >= 3 ? commonPrefix : firstName;
  const withoutExtension = removeFileExtension(selectedPrefix);
  const cleanedPrefix = withoutExtension.replace(/[-_]+$/, "");
  const stem = `${cleanedPrefix}-merged`;
  const extension = format === "jpeg" ? ".jpg" : format === "webp" ? ".webp" : ".tif";
  return `${stem}${extension}`;
}

function basename(fileName) {
  const parts = String(fileName).split(/[\\/]/);
  return parts[parts.length - 1] || "";
}

function findCommonPrefix(names) {
  if (names.length === 0) return "";
  let prefix = names[0];
  for (let nameIndex = 1; nameIndex < names.length && prefix.length > 0; nameIndex += 1) {
    const name = names[nameIndex];
    const limit = Math.min(prefix.length, name.length);
    let charIndex = 0;
    while (charIndex < limit && prefix[charIndex] === name[charIndex]) {
      charIndex += 1;
    }
    prefix = prefix.slice(0, charIndex);
  }
  return prefix;
}

function removeFileExtension(fileName) {
  const lastDot = fileName.lastIndexOf(".");
  return lastDot > 0 ? fileName.slice(0, lastDot) : fileName;
}

async function readInputInfos(files) {
  const infos = [];
  for (let index = 0; index < files.length; index += 1) {
    setProgress(`Reading metadata, ICC, and size ${index + 1}/${files.length}...`);
    infos.push(await extractInputInfo(files[index]));
    await yieldToBrowser();
  }
  return infos;
}

function formatAlignmentModeName(mode) {
  if (mode === "center-crop") return "Center crop";
  if (mode === "center-fit") return "Center fit";
  if (mode === "center-fill") return "Center fill";
  if (mode === "top-left-fill") return "Top left fill";
  if (mode === "feature-match") return "Content match";
  if (mode === "feature-match-ecc") return "Content match (ECC)";
  if (mode === "feature-match-orb") return "Content match (ORB)";
  return "Auto";
}

function isFeatureMatchAlignmentMode(mode) {
  return mode === "feature-match-ecc" || mode === "feature-match-orb";
}

function alignmentAlgorithmFromMode(mode) {
  if (mode === "feature-match-ecc") return "ECC";
  if (mode === "feature-match-orb") return "ORB";
  return null;
}

function resolveAutoAlignmentMode(mergeMode) {
  if (isTileMergeMode(mergeMode)) return "center-fill";
  if (mergeMode === "average") return "center-crop";
  return "feature-match-ecc";
}

function computeExifLightValue(inputInfo) {
  const exposureTime = Number(inputInfo?.exposureTime);
  const fNumber = Number(inputInfo?.fNumber);
  const iso = Number(inputInfo?.iso);
  if (!(exposureTime > 0 && fNumber > 0 && iso > 0)) return null;
  const lightValue = Math.log2((fNumber * fNumber) / exposureTime) - Math.log2(iso / 100);
  return Number.isFinite(lightValue) ? lightValue : null;
}

function chooseAlignmentReferenceIndex(inputInfos, mergeMode) {
  const count = inputInfos.length;
  if (count <= 1) return 0;

  if (mergeMode === "focus") {
    return Math.floor(count / 2);
  }

  const lightValues = inputInfos.map(computeExifLightValue);
  if (!lightValues.every((value) => Number.isFinite(value))) return 0;

  const minLightValue = Math.min(...lightValues);
  const maxLightValue = Math.max(...lightValues);
  if (maxLightValue - minLightValue < 1) return 0;

  const centerLightValue = (minLightValue + maxLightValue) / 2;
  let bestIndex = 0;
  let bestDistance = Infinity;
  for (let index = 0; index < lightValues.length; index += 1) {
    const distance = Math.abs(lightValues[index] - centerLightValue);
    if (distance < bestDistance) {
      bestDistance = distance;
      bestIndex = index;
    }
  }
  return bestIndex;
}

function isTileMergeMode(mode) {
  return mode === "tile-vertical" || mode === "tile-horizontal";
}

const ALIGNMENT_FRAME_BASE_AREA = 1_000_000;
const PROGRESSIVE_ORB_FRAME_AREA = 8_000_000;

function alignmentFrameDimensions(fullWidth, fullHeight, maxArea = ALIGNMENT_FRAME_BASE_AREA) {
  const area = fullWidth * fullHeight;
  if (area <= maxArea) {
    return { width: fullWidth, height: fullHeight };
  }
  const scale = Math.sqrt(maxArea / area);
  return {
    width: Math.max(1, Math.round(fullWidth * scale)),
    height: Math.max(1, Math.round(fullHeight * scale)),
  };
}

// Produce both resolutions directly from the normalized source to avoid
// changing the coarse ORB features through a second resampling stage.
function createAlignmentFramesFromRgba(cv, rgba, fullWidth, fullHeight, exposureScalar, makeBase, makeFine, timings) {
  const fineDimensions = alignmentFrameDimensions(fullWidth, fullHeight, PROGRESSIVE_ORB_FRAME_AREA);
  const baseDimensions = alignmentFrameDimensions(fullWidth, fullHeight, ALIGNMENT_FRAME_BASE_AREA);
  let fineRgba = null;
  const makeGrayFrame = (input, dimensions, fineStage) => {
    const gray = new cv.Mat();
    try {
      const grayStartedAt = performance.now();
      cv.cvtColor(input, gray, cv.COLOR_RGBA2GRAY);
      const grayBytes = copyMatBytes(gray, dimensions.width * dimensions.height);
      timings[fineStage ? "gray8mpMs" : "gray1mpMs"] += performance.now() - grayStartedAt;
      return { width: dimensions.width, height: dimensions.height, grayBytes };
    } finally {
      gray.delete();
    }
  };
  try {
    // Build the finer pyramid level first if it is needed, including when
    // the coarse level is already cached.
    let refinement = null;
    if (makeFine) {
      const resizeStartedAt = performance.now();
      if (fineDimensions.width !== fullWidth || fineDimensions.height !== fullHeight) {
        fineRgba = new cv.Mat();
        cv.resize(rgba, fineRgba, new cv.Size(fineDimensions.width, fineDimensions.height), 0, 0, cv.INTER_AREA);
      }
      timings.resize8mpMs += performance.now() - resizeStartedAt;
      refinement = makeGrayFrame(fineRgba || rgba, fineDimensions, true);
    }

    let base = null;
    if (makeBase) {
      const source = rgba;
      const sourceWidth = fullWidth;
      const sourceHeight = fullHeight;
      const resized = baseDimensions.width === sourceWidth && baseDimensions.height === sourceHeight
        ? null : new cv.Mat();
      try {
        const resizeStartedAt = performance.now();
        if (resized) {
          cv.resize(source, resized, new cv.Size(baseDimensions.width, baseDimensions.height), 0, 0, cv.INTER_AREA);
        }
        timings.resize1mpMs += performance.now() - resizeStartedAt;
        base = {
          ...makeGrayFrame(resized || source, baseDimensions, false),
          fullWidth, fullHeight, exposureScalar,
        };
      } finally {
        if (resized) resized.delete();
      }
    }
    return { base, refinement };
  } finally {
    if (fineRgba) fineRgba.delete();
  }
}

function scaleAlignmentMatrixToFullResolution(matrix, referenceFrame, targetFrame) {
  const referenceScaleX = referenceFrame.width / referenceFrame.fullWidth;
  const referenceScaleY = referenceFrame.height / referenceFrame.fullHeight;
  const targetScaleX = targetFrame.width / targetFrame.fullWidth;
  const targetScaleY = targetFrame.height / targetFrame.fullHeight;
  if (
    !(referenceScaleX > 0 && referenceScaleY > 0 && targetScaleX > 0 && targetScaleY > 0)
  ) {
    throw new Error("Alignment frame scale is invalid.");
  }
  const result = new Float64Array([
    matrix[0] * targetScaleX / referenceScaleX,
    matrix[1] * targetScaleY / referenceScaleX,
    matrix[2] / referenceScaleX,
    matrix[3] * targetScaleX / referenceScaleY,
    matrix[4] * targetScaleY / referenceScaleY,
    matrix[5] / referenceScaleY,
    0,
    0,
    1,
  ]);
  for (const value of result) {
    if (!Number.isFinite(value)) throw new Error("Scaled alignment matrix contains a non-finite value.");
  }
  return result;
}

function secondaryAlignmentAlgorithm(primaryAlgorithm) {
  return primaryAlgorithm === "ECC" ? "ORB" : "ECC";
}

function createAlignmentWorkerClient(algorithm) {
  if (algorithm === "ECC") {
    return new EccWorkerClient(
      new URL("/generated/local-stack-studio/ecc.worker.js", window.location.origin),
    );
  }
  if (algorithm === "ORB") {
    return new OrbWorkerClient(
      new URL("/generated/local-stack-studio/orb.worker.js", window.location.origin),
    );
  }
  throw new Error(`Unsupported alignment algorithm: ${algorithm}`);
}

function createAlignmentWorkers() {
  return {
    ECC: createAlignmentWorkerClient("ECC"),
    ORB: createAlignmentWorkerClient("ORB"),
  };
}

async function initializeAlignmentReference(
  alignmentWorkers,
  preferredAlgorithm,
  referenceFrame,
) {
  const tried = [];
  for (const algorithm of [preferredAlgorithm, secondaryAlignmentAlgorithm(preferredAlgorithm)]) {
    try {
      const ready = await alignmentWorkers[algorithm].initialize(
        referenceFrame.width,
        referenceFrame.height,
        new Uint8Array(referenceFrame.grayBytes),
        referenceFrame.exposureScalar,
        referenceFrame.refinement,
      );
      return { algorithm, ready };
    } catch (error) {
      if (isAlignmentImplementationError(error)) throw error;
      const message = error instanceof Error ? error.message : String(error);
      tried.push(`${algorithm}: ${message}`);
    }
  }
  throw new Error(`Could not initialize alignment reference. ${tried.join("; ")}`);
}

async function alignWithFallback(
  alignmentWorkers,
  primaryAlgorithm,
  referenceContext,
  id,
  fileName,
  targetFrame,
) {
  const tried = [];
  for (const algorithm of [primaryAlgorithm, secondaryAlignmentAlgorithm(primaryAlgorithm)]) {
    try {
      if (algorithm !== referenceContext.algorithm) {
        await alignmentWorkers[algorithm].initialize(
          referenceContext.frame.width,
          referenceContext.frame.height,
          new Uint8Array(referenceContext.frame.grayBytes),
          referenceContext.frame.exposureScalar,
          referenceContext.frame.refinement,
        );
      }
      const result = await alignmentWorkers[algorithm].align(
        id,
        fileName,
        new Uint8Array(targetFrame.grayBytes),
        targetFrame.exposureScalar,
        targetFrame.refinement,
      );
      return {
        algorithm,
        result: {
          ...result,
          matrix: scaleAlignmentMatrixToFullResolution(
            result.matrix,
            referenceContext.frame,
            targetFrame,
          ),
        },
      };
    } catch (error) {
      if (isAlignmentImplementationError(error)) throw error;
      const message = error instanceof Error ? error.message : String(error);
      tried.push(`${algorithm}: ${message}`);
    }
  }
  throw new Error(tried.join("; "));
}

function buildTileLayout(mode, imageWidth, imageHeight, imageCount, folding = null) {
  if (!isTileMergeMode(mode)) {
    throw new Error(`Unsupported tile mode: ${mode}`);
  }
  const count = Math.max(1, Math.round(Number(imageCount) || 0));
  const border = Math.max(
    TILE_BORDER_MIN_PIXELS,
    Math.round(Math.hypot(imageWidth, imageHeight) * TILE_BORDER_DIAGONAL_RATIO),
  );
  const vertical = mode === "tile-vertical";
  const requestedFolding = Number.isInteger(folding) && folding >= 2 && folding <= 8
    ? folding
    : null;
  const primaryCount = requestedFolding == null
    ? count
    : Math.min(count, requestedFolding);
  const rows = vertical ? primaryCount : Math.ceil(count / primaryCount);
  const columns = vertical ? Math.ceil(count / primaryCount) : primaryCount;
  const outputWidth = imageWidth * columns + border * (columns + 1);
  const outputHeight = imageHeight * rows + border * (rows + 1);
  const positions = Array.from({ length: count }, (_, index) => {
    const row = vertical ? index % primaryCount : Math.floor(index / primaryCount);
    const column = vertical ? Math.floor(index / primaryCount) : index % primaryCount;
    return {
      x: border + column * (imageWidth + border),
      y: border + row * (imageHeight + border),
    };
  });
  return { border, outputWidth, outputHeight, positions };
}

function buildAlignmentPlan(files, inputInfos, selectedMode, mergeMode) {
  const validModes = ["auto", "center-crop", "center-fit", "center-fill", "top-left-fill", "feature-match-ecc", "feature-match-orb"];
  if (!validModes.includes(selectedMode)) {
    throw new Error(`Unsupported alignment mode: ${selectedMode}`);
  }

  const dimensions = inputInfos.map((inputInfo, index) => ({
    fileName: files[index]?.name || `image-${index + 1}`,
    width: Math.round(Number(inputInfo?.width) || 0),
    height: Math.round(Number(inputInfo?.height) || 0),
  }));
  const invalid = dimensions.find((entry) => entry.width <= 0 || entry.height <= 0);
  if (invalid) {
    throw new Error(`Could not determine image dimensions for ${invalid.fileName}.`);
  }

  if (dimensions.length === 0) {
    const effectiveMode = selectedMode === "auto" ? resolveAutoAlignmentMode(mergeMode) : selectedMode;
    return {
      selectedMode,
      effectiveMode,
      normalizationMode: isFeatureMatchAlignmentMode(effectiveMode) ? "feature-match" : effectiveMode,
      targetWidth: 0,
      targetHeight: 0,
    };
  }

  const first = dimensions[0];
  const allSameSize = dimensions.every(
    (entry) => entry.width === first.width && entry.height === first.height,
  );
  const centerCropWidth = Math.min(...dimensions.map((entry) => entry.width));
  const centerCropHeight = Math.min(...dimensions.map((entry) => entry.height));
  const centerFillWidth = Math.max(...dimensions.map((entry) => entry.width));
  const centerFillHeight = Math.max(...dimensions.map((entry) => entry.height));
  const effectiveMode = selectedMode === "auto"
    ? resolveAutoAlignmentMode(mergeMode)
    : selectedMode;

  if (isFeatureMatchAlignmentMode(effectiveMode)) {
    return {
      selectedMode,
      effectiveMode,
      normalizationMode: allSameSize ? "feature-match" : "center-crop",
      targetWidth: allSameSize ? first.width : centerCropWidth,
      targetHeight: allSameSize ? first.height : centerCropHeight,
    };
  }

  if (effectiveMode === "center-crop") {
    return {
      selectedMode,
      effectiveMode,
      normalizationMode: "center-crop",
      targetWidth: centerCropWidth,
      targetHeight: centerCropHeight,
    };
  }

  if (effectiveMode === "center-fit") {
    const largest = dimensions.reduce((best, entry) => {
      const bestPixels = best.width * best.height;
      const entryPixels = entry.width * entry.height;
      return entryPixels > bestPixels ? entry : best;
    }, dimensions[0]);
    return {
      selectedMode,
      effectiveMode,
      normalizationMode: "center-fit",
      targetWidth: largest.width,
      targetHeight: largest.height,
    };
  }

  if (effectiveMode === "center-fill" || effectiveMode === "top-left-fill") {
    return {
      selectedMode,
      effectiveMode,
      normalizationMode: effectiveMode,
      targetWidth: centerFillWidth,
      targetHeight: centerFillHeight,
    };
  }

  throw new Error(`Unsupported effective alignment mode: ${effectiveMode}`);
}

function buildMergePlan(
  files,
  inputInfos,
  mode,
  canonicalImages = [],
  stfBlendWeightValue = DEFAULT_STF_BLEND_WEIGHT,
  stfBlurPlan = buildStfAdditionalBlurPlan(DEFAULT_STF_ADDITIONAL_BLUR_OPTIONS),
  tileFoldingValue = null,
  focusSoftnessValue = DEFAULT_FOCUS_SOFTNESS,
  panoramaMaxOutputMegapixels = 16,
  panoramaFinishMode = DEFAULT_PANORAMA_FINISH_MODE,
) {
  const imageCount = files.length;
  const weights = new Float32Array(imageCount);
  const gains = new Float32Array(imageCount);
  const scaledLogs = new Float32Array(imageCount);

  for (let i = 0; i < imageCount; i += 1) {
    weights[i] = mode === "average" ? 1 / imageCount : 1;
    gains[i] = 1;
    scaledLogs[i] = 0;
  }

  if (mode === "hdr1" || mode === "hdr2") {
    if (imageCount === 1) {
      const syntheticMaterials = buildSingleShotHdrSyntheticMaterials(mode);
      return {
        mode,
        weights: new Float32Array(syntheticMaterials.length).fill(1),
        gains: new Float32Array(syntheticMaterials.length).fill(1),
        hdrExposureTimes: mode === "hdr1" ? SINGLE_SHOT_HDR1_EXPOSURE_TIMES : null,
        syntheticMaterials,
      };
    }
    return {
      mode,
      weights,
      gains,
      hdrExposureTimes: mode === "hdr1" ? buildHdrExposureTimes(inputInfos) : null,
    };
  }

  if (mode === "median") {
    return { mode, weights, gains };
  }

  if (mode === "focus") {
    return { mode, weights, gains, focusSoftness: focusSoftnessValue };
  }

  if (mode === "panorama") {
    return { mode, weights, gains, scaledLogs, panoramaMaxOutputMegapixels, panoramaFinishMode };
  }

  if (isTileMergeMode(mode)) {
    return { mode, weights, gains, scaledLogs, tileFolding: tileFoldingValue };
  }

  if (mode !== "stf") {
    return { mode, weights, gains, scaledLogs };
  }

  const fNumbers = inputInfos.map((entry) => entry.fNumber);
  const stfWeights = buildStfApertureWeights(fNumbers, stfBlendWeightValue);
  if (stfWeights) {
    for (let i = 0; i < imageCount; i += 1) {
      weights[i] = stfWeights[i];
    }
  } else {
    const uniformWeight = 1 / imageCount;
    for (let i = 0; i < imageCount; i += 1) {
      weights[i] = uniformWeight;
    }
  }

  const toneStatistics = canonicalImages.map((entry) => entry?.toneStatistics);
  const toneMatch = toneStatistics.length === imageCount
    ? buildStfToneMatchPlans(toneStatistics)
    : null;
  if (!toneMatch) {
    throw new Error("STF tone matching requires valid mean/P50/P95 statistics for every input image.");
  }
  for (let i = 0; i < imageCount; i += 1) {
    gains[i] = toneMatch.plans[i].gain;
    scaledLogs[i] = toneMatch.plans[i].scaledLog;
  }

  return {
    mode,
    weights,
    gains,
    scaledLogs,
    toneReferenceIndex: toneMatch.referenceIndex,
    stfBlurPlan,
  };
}

function buildSingleShotHdrSyntheticMaterials(mode) {
  if (mode === "hdr1") {
    return [
      {
        label: "dark",
        exposureEv: SINGLE_SHOT_HDR1_EXPOSURE_EVS[0],
        sigmoidGain: SINGLE_SHOT_HDR1_SIGMOID_GAINS[0],
        sigmoidMidpoint: 1,
      },
      {
        label: "medium",
        exposureEv: SINGLE_SHOT_HDR1_EXPOSURE_EVS[1],
        sigmoidGain: SINGLE_SHOT_HDR1_SIGMOID_GAINS[1],
        sigmoidMidpoint: 0.5,
      },
      {
        label: "light",
        exposureEv: SINGLE_SHOT_HDR1_EXPOSURE_EVS[2],
        sigmoidGain: SINGLE_SHOT_HDR1_SIGMOID_GAINS[2],
        sigmoidMidpoint: 0,
      },
    ];
  }
  return [
    {
      label: "dark",
      scaledLog: SINGLE_SHOT_HDR2_SCALED_LOGS[0],
      sigmoidGain: SINGLE_SHOT_HDR2_SIGMOID_GAINS[0],
      sigmoidMidpoint: 1,
    },
    {
      label: "medium",
      scaledLog: SINGLE_SHOT_HDR2_SCALED_LOGS[1],
      sigmoidGain: SINGLE_SHOT_HDR2_SIGMOID_GAINS[1],
      sigmoidMidpoint: 0.5,
    },
    {
      label: "light",
      scaledLog: SINGLE_SHOT_HDR2_SCALED_LOGS[2],
      sigmoidGain: SINGLE_SHOT_HDR2_SIGMOID_GAINS[2],
      sigmoidMidpoint: 0,
    },
  ];
}

function buildHdrExposureTimes(inputInfos) {
  const exposureScalars = inputInfos.map((entry) => entry.exposureScalar);
  if (exposureScalars.every((value) => Number.isFinite(value) && value > 0)) {
    const minExposure = Math.max(Math.min(...exposureScalars), 0.0001);
    return new Float32Array(exposureScalars.map((value) => value / minExposure));
  }

  return null;
}

async function alignAndMergeFilesWithOpenCv(
  cv,
  files,
  inputInfos,
  mergePlan,
  alignmentPlan,
  outputColorSpace,
  canonicalSession,
) {
  if (!canonicalSession || canonicalSession.images.length !== files.length) {
    throw new Error("Canonical input session is not ready.");
  }
  if (mergePlan.mode === "panorama") {
    return mergePanoramaFromCanonical(
      canonicalSession,
      outputColorSpace,
      mergePlan.panoramaMaxOutputMegapixels ?? null,
      mergePlan.panoramaFinishMode ?? DEFAULT_PANORAMA_FINISH_MODE,
    );
  }
  if (!alignmentPlan) throw new Error("Alignment plan is required for this merge mode.");
  const needsAlignment = files.length > 1 && isFeatureMatchAlignmentMode(alignmentPlan.effectiveMode);
  const alignmentReferenceIndex = needsAlignment
    ? chooseAlignmentReferenceIndex(inputInfos, mergePlan.mode)
    : 0;
  const matrices = new Array(files.length).fill(null);
  const alignmentFrames = new Array(files.length).fill(null);
  // Timings cover alignment frame preparation through transform estimation,
  // excluding the later image merge. Per-target timings overlap across workers.
  const alignmentTimingStart = needsAlignment ? performance.now() : 0;
  let framePreparationMs = 0;
  let prepareProgressiveFine = null;
  let coarseReadyByIndex = null;
  let fineReadyByIndex = null;
  let coarsePreparation = null;
  let finePreparation = null;
  let progressiveFrameDiagnostics = null;
  let progressiveFrameStartMs = 0;
  let progressiveFineWindow = null;
  let frameCacheHits = 0;
  let transformCacheHit = false;
  let recoveryMs = 0;
  const alignmentJobTimings = [];
  const alignmentBatchTimings = [];
  let alignmentWorkers = null;
  let focusWorker = null;
  let focusScratchDb = null;
  let focusScratchSessionId = null;
  let hdr1StreamWorker = null;
  let hdr2StreamWorker = null;

  try {
    if (files.length === 1 && (mergePlan.mode === "hdr1" || mergePlan.mode === "hdr2") && Array.isArray(mergePlan.syntheticMaterials) && mergePlan.syntheticMaterials.length > 0) {
      const baseLinear = await materializeCanonicalLinearImage(canonicalSession, 0);
      return await processSingleInputHdrFromCanonical(baseLinear, canonicalSession.images[0].width, canonicalSession.images[0].height, mergePlan, outputColorSpace);
    }

    // Phase C: prepare all alignment frames before any merge starts.
    if (needsAlignment) {
      const preparationStartedAt = performance.now();
      progressiveFrameStartMs = preparationStartedAt;
      setProgress("Preparing alignment frames from canonical inputs...");
      const frameCache = canonicalSession.alignmentFrameCache || (canonicalSession.alignmentFrameCache = new Map());
      const progressive = alignmentPlan.effectiveMode === "feature-match-orb";
      const framePreparationDetails = [];
      const frameDiagnosticEvents = [];
      if (progressive) {
        progressiveFrameDiagnostics = { details: framePreparationDetails, events: frameDiagnosticEvents };
      }
      if (progressive) {
        // Start two actual CPU workers. They read canonical chunks directly from
        // IndexedDB; full-resolution RGB buffers never cross worker boundaries.
        const resolvers = [];
        const coarsePromises = files.map((_, index) => new Promise((resolve) => { resolvers[index] = resolve; }));
        const missing = [];
        for (let index = 0; index < files.length; index += 1) {
          const baseKey = alignmentFrameCacheKey(alignmentPlan.normalizationMode,
            alignmentPlan.targetWidth, alignmentPlan.targetHeight, index);
          const fineKey = alignmentFrameCacheKey(alignmentPlan.normalizationMode,
            alignmentPlan.targetWidth, alignmentPlan.targetHeight, index, true);
          const base = getCachedAlignmentFrame(frameCache, baseKey);
          const refinement = getCachedAlignmentFrame(frameCache, fineKey);
          if (base && refinement) frameCacheHits++;
          const detail = { image: files[index].name,
            cache: `${base ? "1MP hit" : "1MP miss"} / ${refinement ? "8MP hit" : "8MP miss"}`,
            canonicalReadMs: 0, normalizationMs: 0, rgbaAllocationMs: 0,
            colorConversionMs: 0, resize1mpMs: 0, coarseFrom8mp: false,
            gray1mpMs: 0, resize8mpMs: 0, gray8mpMs: 0, yieldMs: 0, totalMs: 0 };
          if (refinement) detail.fine = { cacheHit: true, totalWallMs: 0 };
          framePreparationDetails[index] = detail;
          alignmentFrames[index] = base ? { ...base, refinement } : { refinement };
          if (base) {
            frameDiagnosticEvents.push({ image: files[index].name, stage: "1mp-cache-hit", atMs: performance.now() - preparationStartedAt });
            resolvers[index]();
          } else missing.push({ index, targetWidth: alignmentPlan.targetWidth,
            targetHeight: alignmentPlan.targetHeight,
            normalizationMode: alignmentPlan.normalizationMode,
            exposureScalar: inputInfos[index].exposureScalar });
        }
        const ordered = missing.sort((a, b) =>
          (a.index === alignmentReferenceIndex ? -1 : b.index === alignmentReferenceIndex ? 1 : a.index - b.index));
        // The same two CPU workers produce both resolutions. 1MP jobs take
        // priority, and independent 8MP completions unblock refinement.
        const fineResolvers = [];
        const finePromises = files.map((_, index) => new Promise((resolve) => { fineResolvers[index] = resolve; }));
        const fineMissing = [];
        for (let index = 0; index < files.length; index += 1) {
          if (alignmentFrames[index].refinement) fineResolvers[index]();
          else fineMissing.push({ index, targetWidth: alignmentPlan.targetWidth,
            targetHeight: alignmentPlan.targetHeight,
            normalizationMode: alignmentPlan.normalizationMode,
            exposureScalar: inputInfos[index].exposureScalar });
        }
        fineMissing.sort((a, b) =>
          (a.index === alignmentReferenceIndex ? -1 : b.index === alignmentReferenceIndex ? 1 : a.index - b.index));
        let firstFineStart = null;
        let lastFineEnd = null;
        const producer = startProgressiveAlignmentFrames({
          sessionId: canonicalSession.id, coarseJobs: ordered, fineJobs: fineMissing,
          hardwareConcurrency: typeof navigator === "object" ? navigator.hardwareConcurrency || 4 : 4,
          onCoarse: (index, base, timing) => {
            Object.assign(alignmentFrames[index], base);
            const key = alignmentFrameCacheKey(alignmentPlan.normalizationMode,
              alignmentPlan.targetWidth, alignmentPlan.targetHeight, index);
            putCachedAlignmentFrame(frameCache, key, base);
            const detail = framePreparationDetails[index];
            detail.canonicalReadMs = timing.readMs;
            detail.normalizationMs = timing.normMs;
            detail.colorConversionMs = timing.colorConversionMs;
            detail.resize1mpMs = timing.resizeMs;
            detail.gray1mpMs = timing.grayMs;
            detail.totalMs = timing.totalMs;
            detail.coarseWorker = timing.workerIndex;
            detail.coarseQueueMs = timing.queueMs;
            detail.coarseWallMs = timing.wallMs;
            frameDiagnosticEvents.push({ image: files[index].name, stage: "1mp-ready", atMs: performance.now() - preparationStartedAt });
            resolvers[index]();
          },
          onFineStart: (index) => {
            const at = performance.now() - preparationStartedAt;
            if (firstFineStart === null) {
              firstFineStart = at;
              progressiveFineWindow = { startMs: at, endMs: null, wallMs: null };
            }
            frameDiagnosticEvents.push({ image: files[index].name, stage: "8mp-start", atMs: at });
          },
          onFine: (index, fine, timing) => {
            // Preserve the placeholder identity used by pending ORB jobs.
            alignmentFrames[index].refinement = fine;
            const fineKey = alignmentFrameCacheKey(alignmentPlan.normalizationMode,
              alignmentPlan.targetWidth, alignmentPlan.targetHeight, index, true);
            putCachedAlignmentFrame(frameCache, fineKey, fine);
            const at = performance.now() - preparationStartedAt;
            lastFineEnd = at;
            const detail = framePreparationDetails[index];
            detail.fine = { canonicalReadMs: timing.readMs,
              normalizationMs: timing.normMs, rgbaAllocationMs: 0,
              colorConversionMs: timing.colorConversionMs,
              resize1mpMs: 0, gray1mpMs: 0, resize8mpMs: timing.resizeMs,
              gray8mpMs: timing.grayMs, yieldMs: 0,
              totalWallMs: timing.wallMs, startMs: at - timing.wallMs,
              endMs: at, cacheHit: false, worker: timing.workerIndex,
              queueMs: timing.queueMs, workerTotalMs: timing.totalMs };
            frameDiagnosticEvents.push({ image: detail.image, stage: "8mp-ready", atMs: at });
            fineResolvers[index]();
          },
        });
        coarsePreparation = { done: producer.coarseDone, stop: producer.stop };
        finePreparation = producer;
        prepareProgressiveFine = async () => {
          await producer.done;
          if (progressiveFineWindow && lastFineEnd !== null) {
            progressiveFineWindow.endMs = lastFineEnd;
            progressiveFineWindow.wallMs = lastFineEnd - firstFineStart;
          }
        };
        coarseReadyByIndex = (index) => Promise.race([coarsePromises[index], producer.coarseDone.then(() => {
          if (!alignmentFrames[index].grayBytes) throw new Error(`Missing 1MP frame: ${files[index].name}`);
        })]);
        fineReadyByIndex = (index) => Promise.race([
          Promise.all([finePromises[alignmentReferenceIndex], finePromises[index]]).then(() => undefined),
          producer.done.then(() => {
            if (!alignmentFrames[alignmentReferenceIndex].refinement || !alignmentFrames[index].refinement)
              throw new Error(`Missing 8MP frame: ${files[index].name}`);
          }),
        ]);
        // Begin coarse ORB as soon as the reference exists. Remaining 1MP
        // images continue to arrive independently, before all frames finish.
        await coarseReadyByIndex(alignmentReferenceIndex);
        frameDiagnosticEvents.push({ image: files[alignmentReferenceIndex].name, stage: "reference-1mp-ready", atMs: performance.now() - preparationStartedAt });
      } else {
      for (let index = 0; index < files.length; index += 1) {
        const baseKey = alignmentFrameCacheKey(
          alignmentPlan.normalizationMode, alignmentPlan.targetWidth, alignmentPlan.targetHeight, index,
        );
        // ECC shares the 1MP frame cache with ORB; it does not require 8MP.
        let base = getCachedAlignmentFrame(frameCache, baseKey);
        const hadBase = Boolean(base);
        const detail = {
          image: files[index].name,
          cache: hadBase ? "1MP hit" : "1MP miss",
          canonicalReadMs: 0,
          normalizationMs: 0,
          rgbaAllocationMs: 0,
          colorConversionMs: 0,
          resize1mpMs: 0,
          coarseFrom8mp: false,
          gray1mpMs: 0,
          resize8mpMs: 0,
          gray8mpMs: 0,
          yieldMs: 0,
          totalMs: 0,
        };
        const itemStartedAt = performance.now();
        if (!base) {
          const normalized = await materializeNormalizedCanonicalLinear(cv, canonicalSession, index, alignmentPlan, detail);
          detail.coarseFrom8mp = false;
          const prepared = createAlignmentFramesFromLinearProPhoto(
            cv,
            normalized,
            alignmentPlan.targetWidth,
            alignmentPlan.targetHeight,
            inputInfos[index].exposureScalar,
            !base,
            false,
            detail,
          );
          if (!base) {
            base = prepared.base;
            putCachedAlignmentFrame(frameCache, baseKey, base);
          }
        }
        if (!base) throw new Error(`Could not prepare 1MP alignment frame for ${files[index].name}.`);
        alignmentFrames[index] = base;
        if (hadBase) frameCacheHits += 1;
        const yieldStartedAt = performance.now();
        if (index + 1 < files.length) await yieldToBrowser();
        detail.yieldMs = performance.now() - yieldStartedAt;
        detail.totalMs = performance.now() - itemStartedAt;
        framePreparationDetails.push(detail);
      }
      }
      // ORB diagnostics are emitted once after both producers and
      // transform workers settle; ECC uses the simple per-frame log.
      const logPreparedFrames = () => {
        console.info(`[Alignment Frames] ${alignmentPlan.effectiveMode} JSON\n` +
          JSON.stringify({ schemaVersion: 1, mode: alignmentPlan.effectiveMode,
            frames: framePreparationDetails }, null, 2));
      };
      if (!progressive) logPreparedFrames();
      framePreparationMs = performance.now() - preparationStartedAt;
    }

    // Phase D: resolve all transforms. No merge/decode occurs in this phase.
    if (needsAlignment) {
      const alignmentAlgorithm = alignmentAlgorithmFromMode(alignmentPlan.effectiveMode);
      if (!alignmentAlgorithm) throw new Error(`Unsupported feature matching mode: ${alignmentPlan.effectiveMode}`);
      const transformCache = canonicalSession.alignmentTransformCache || (canonicalSession.alignmentTransformCache = new Map());
      // Distinguish the new two-resolution ORB from transforms cached by the
      // retired single-resolution ORB while this canonical session is alive.
      const modeCacheKey = alignmentPlan.effectiveMode === "feature-match-orb"
        ? "feature-match-orb-1mp8mp-v1" : alignmentPlan.effectiveMode;
      const transformKey = `${modeCacheKey}:${alignmentPlan.normalizationMode}:${alignmentPlan.targetWidth}x${alignmentPlan.targetHeight}:ref=${alignmentReferenceIndex}`;
      const cachedMatrices = transformCache.get(transformKey);
      if (cachedMatrices && cachedMatrices.length === files.length) {
        transformCacheHit = true;
        for (let index = 0; index < files.length; index += 1) matrices[index] = new Float64Array(cachedMatrices[index]);
      } else {
        const referenceFrame = alignmentFrames[alignmentReferenceIndex];
        matrices[alignmentReferenceIndex] = identityAlignmentMatrix();
        const alignedIndices = new Set([alignmentReferenceIndex]);
        const directJobs = [];
        for (let index = 0; index < files.length; index += 1) {
          if (index === alignmentReferenceIndex) continue;
          directJobs.push({
            id: index,
            fileName: files[index].name,
            frame: alignmentFrames[index],
          });
        }
        const hardwareConcurrency = typeof navigator === "object"
          ? Math.max(1, Math.floor(navigator.hardwareConcurrency || 4)) : 4;

        const runDirectBatch = async (algorithm, jobs, phaseLabel) => {
          const algorithmLabel = algorithm;
          const batchStartedAt = performance.now();
          const jobStartedAt = new Map();
          let started = 0;
          let completed = 0;
          const pipeline = algorithm === "ORB" && phaseLabel === "primary" && prepareProgressiveFine;
          const batch = await (pipeline ? runProgressivePipelinedPool : runAlignmentPool)({
            jobs,
            referenceFrame,
            createClient: () => createAlignmentWorkerClient(algorithm),
            hardwareConcurrency,
            ...(pipeline ? { prepareRefinement: prepareProgressiveFine, coarseReady: coarseReadyByIndex,
              refinementReady: fineReadyByIndex, coarsePreparation: coarsePreparation?.done,
              onStageEvent: (job, workerIndex, stage) => progressiveFrameDiagnostics?.events.push({
                image: job.fileName, worker: workerIndex + 1, stage,
                atMs: performance.now() - progressiveFrameStartMs,
              }) } : {}),
            onJobStart: (job) => {
              jobStartedAt.set(job.id, performance.now());
              started += 1;
              setProgress(
                `Aligning ${job.fileName} with ${algorithmLabel} feature matching ` +
                `(${phaseLabel}, ${started}/${jobs.length} started)...`,
              );
            },
            onJobComplete: (job, workerIndex, outcome) => {
              const startedAt = jobStartedAt.get(job.id);
              const elapsedMs = startedAt === undefined ? null : performance.now() - startedAt;
              alignmentJobTimings.push({
                image: job.fileName,
                method: algorithmLabel,
                phase: phaseLabel,
                worker: workerIndex + 1,
                elapsedMs: elapsedMs === null ? null : Number(elapsedMs.toFixed(1)),
                result: "error" in outcome ? `failed: ${outcome.error.message}` : "ok",
              });
              if (algorithm === "ORB" && "result" in outcome) {
                const stats = outcome.result;
                console.info(`[ORB] ${job.fileName}: ${stats.refinementStatus ?? "not reported"}`, {
                  candidates: stats.refinementMatches,
                  inliers: stats.refinementInliers,
                  medianError: stats.refinementMedianError,
                  correctionPx: stats.refinementCorrectionPx,
                });
              }
              completed += 1;
              setProgress(
                `${algorithmLabel} ${phaseLabel} alignment ${completed}/${jobs.length} completed...`,
              );
            },
          });
          alignmentBatchTimings.push({
            method: algorithmLabel,
            phase: phaseLabel,
            workers: batch.workerCount,
            initializationMs: Number(batch.initializationMs.toFixed(1)),
            jobsMs: Number(batch.jobsMs.toFixed(1)),
            wallMs: Number((performance.now() - batchStartedAt).toFixed(1)),
          });
          return batch;
        };

        const primaryBatch = await runDirectBatch(alignmentAlgorithm, directJobs, "primary");
        for (const success of primaryBatch.successes) {
          const result = {
            ...success.result,
            matrix: scaleAlignmentMatrixToFullResolution(
              success.result.matrix,
              referenceFrame,
              success.job.frame,
            ),
          };
          matrices[success.job.id] = result.matrix;
          alignedIndices.add(success.job.id);
        }

        const primaryFailures = new Map(
          primaryBatch.failures.map((failure) => [failure.job.id, failure]),
        );
        let finalFailures = primaryBatch.failures.map((failure) => ({
          job: failure.job,
          message: `${alignmentAlgorithm}: ${failure.error.message}`,
        }));

        if (primaryBatch.failures.length > 0) {
          const secondaryAlgorithm = secondaryAlignmentAlgorithm(alignmentAlgorithm);
          const secondaryBatch = await runDirectBatch(
            secondaryAlgorithm,
            primaryBatch.failures.map((failure) => failure.job),
            "fallback",
          );
          for (const success of secondaryBatch.successes) {
            const result = {
              ...success.result,
              matrix: scaleAlignmentMatrixToFullResolution(
                success.result.matrix,
                referenceFrame,
                success.job.frame,
              ),
            };
            matrices[success.job.id] = result.matrix;
            alignedIndices.add(success.job.id);
          }
          finalFailures = secondaryBatch.failures.map((failure) => {
            const primary = primaryFailures.get(failure.job.id);
            const primaryMessage = primary
              ? `${alignmentAlgorithm}: ${primary.error.message}; `
              : "";
            return {
              job: failure.job,
              message: `${primaryMessage}${secondaryAlgorithm}: ${failure.error.message}`,
            };
          });
        }

        const deferredAlignments = finalFailures.map((failure) => ({
          index: failure.job.id,
          initialError: failure.message,
          attemptedReferences: new Set([alignmentReferenceIndex]),
          attempts: [],
        }));

        if (deferredAlignments.length > 0) {
          const recoveryStartedAt = performance.now();
          alignmentWorkers = createAlignmentWorkers();
          try {
            await recoverDeferredAlignments(
              alignmentWorkers,
              files,
              alignmentFrames,
              alignmentAlgorithm,
              matrices,
              alignedIndices,
              deferredAlignments,
            );
          } finally {
            recoveryMs += performance.now() - recoveryStartedAt;
          }
          const unresolved = deferredAlignments.filter((entry) => !matrices[entry.index]);
          if (unresolved.length > 0) {
            const details = unresolved.map((entry) => `${files[entry.index].name}: ${entry.initialError}`).join("\n");
            throw new Error(`Could not align ${unresolved.length} image${unresolved.length === 1 ? "" : "s"}:\n${details}`);
          }
        }
        transformCache.set(transformKey, matrices.map((matrix) => Array.from(matrix)));
      }
    } else {
      for (let index = 0; index < files.length; index += 1) matrices[index] = identityAlignmentMatrix();
    }

    if (needsAlignment) {
      const totalMs = performance.now() - alignmentTimingStart;
      // Overlapping 8MP preparation is included in elapsed transform-stage wall time.
      const transformMs = Math.max(0, totalMs - framePreparationMs);
      const modeLabel = alignmentPlan.effectiveMode === "feature-match-ecc" ? "ECC" : "ORB";
      if (modeLabel === "ECC") {
        console.info(
          `[Alignment Timing] ${modeLabel}: total ${totalMs.toFixed(1)} ms ` +
          `(frames ${framePreparationMs.toFixed(1)} ms, transforms ${transformMs.toFixed(1)} ms, ` +
          `recovery ${recoveryMs.toFixed(1)} ms). ` +
          `Frames cached ${frameCacheHits}/${files.length}; ` +
          `transforms ${transformCacheHit ? "CACHE HIT (not recomputed)" : "computed"}.`,
        );
        if (alignmentBatchTimings.length > 0) {
          console.info("[Alignment Timing] Worker batches (wall time, parallel workers):");
          console.table(alignmentBatchTimings);
        }
        if (alignmentJobTimings.length > 0) {
          console.info("[Alignment Timing] Each target (elapsed wall time; jobs run concurrently):");
          console.table(alignmentJobTimings.sort((a, b) => a.image.localeCompare(b.image) || a.phase.localeCompare(b.phase)));
        }
      }
    }

    // Do not let unfinished 1MP producers outlive the alignment phase,
    // including when the transform cache bypasses the worker pool.
    if (coarsePreparation) {
      await coarsePreparation.done;
      await finePreparation?.done;
      if (progressiveFrameDiagnostics) {
        const round = (n) => typeof n === "number" && Number.isFinite(n) ? Number(n.toFixed(2)) : n;
        const perImage = progressiveFrameDiagnostics.details.map((detail) => {
          const fine = detail.fine ?? { cacheHit: Boolean(alignmentFrames[files.findIndex((f) => f.name === detail.image)]?.refinement) };
          return {
            image: detail.image, cache: detail.cache,
            coarse1mp: { worker: detail.coarseWorker ?? null,
              queueMs: round(detail.coarseQueueMs ?? 0), wallMs: round(detail.coarseWallMs ?? 0),
              canonicalReadMs: round(detail.canonicalReadMs), normalizationMs: round(detail.normalizationMs),
              colorConversionMs: round(detail.colorConversionMs), resizeMs: round(detail.resize1mpMs),
              grayscaleMs: round(detail.gray1mpMs), workerTotalMs: round(detail.totalMs) },
            fine8mp: Object.fromEntries(Object.entries(fine).map(([key, value]) => [key, round(value)])),
          };
        });
        const totals = { coarse1mpWorkerStageSumMs: {}, fine8mpStageSumMs: {} };
        for (const [key, target, selector] of [
          ["coarse1mp", totals.coarse1mpWorkerStageSumMs, ["canonicalReadMs", "normalizationMs", "colorConversionMs", "resizeMs", "grayscaleMs"]],
          ["fine8mp", totals.fine8mpStageSumMs, ["canonicalReadMs", "normalizationMs", "rgbaAllocationMs", "colorConversionMs", "resize8mpMs", "gray8mpMs", "yieldMs"]],
        ]) for (const name of selector) target[name] = round(perImage.reduce((sum, frame) => sum + (frame[key]?.[name] ?? 0), 0));
        const totalMs = performance.now() - alignmentTimingStart;
        const payload = {
          schemaVersion: 1, mode: "ORB", algorithm: "progressive 1MP/8MP", unit: "ms",
          notes: ["Wall times of overlapping stages must not be added together.",
            "Worker stage sums are CPU/worker elapsed sums, not end-to-end elapsed times.",
            "1MP and 8MP preparation share a bounded two-worker pool; 8MP frames may overlap."],
          summary: { totalWallMs: round(totalMs), reference1mpReadyMs: round(framePreparationMs),
            remainingWallAfterReferenceMs: round(totalMs - framePreparationMs),
            fine8mpWindow: progressiveFineWindow && Object.fromEntries(Object.entries(progressiveFineWindow).map(([k,v]) => [k, round(v)])),
            coarseCacheHits: perImage.filter((f) => f.cache.startsWith("1MP hit")).length,
            fineCacheHits: perImage.filter((f) => f.cache.includes("8MP hit")).length,
            transformCacheHit, recoveryMs: round(recoveryMs), workerBatches: alignmentBatchTimings,
            workerJobs: alignmentJobTimings },
          stageSums: totals, frames: perImage,
          timeline: progressiveFrameDiagnostics.events.map((event) => ({ ...event, atMs: round(event.atMs) })),
        };
        console.info("[Alignment Diagnostics JSON]\n" + JSON.stringify(payload, null, 2));
      }
    }

    const alignment = { matrices };
    const reader = new AlignedImageReader(canonicalSession, alignmentPlan, alignment);
    const width = reader.width;
    const height = reader.height;

    // Phase E: execute merge entirely from Canonical Source + resolved transforms.
    if (mergePlan.mode === "median") {
      return finalizeStoredGamma2Result(
        await mergeMedianFromWorkerPool(
          canonicalSession.id,
          alignmentPlan,
          matrices,
          width,
          height,
        ),
        width,
        height,
        outputColorSpace,
      );
    }

    if (mergePlan.mode === "focus") {
      focusScratchDb = await openMedianScratchDb("Focus features");
      focusScratchSessionId = createMedianScratchSessionId();
      const focusCanonicalConfig = {
        sessionId: canonicalSession.id,
        alignmentPlan: {
          normalizationMode: alignmentPlan.normalizationMode,
          targetWidth: alignmentPlan.targetWidth,
          targetHeight: alignmentPlan.targetHeight,
        },
        matrices,
      };
      await computeFocusSharpnessFeaturesParallel(
        focusScratchDb,
        focusScratchSessionId,
        focusCanonicalConfig,
        files.length,
        width,
        height,
      );
      focusWorker = new FocusWorkerClient(
        new URL("/generated/local-stack-studio/focus.worker.js", window.location.origin),
        setProgress,
      );
      const focusStored = await mergeFocusFromCanonical(
        focusScratchDb,
        focusScratchSessionId,
        focusWorker,
        focusCanonicalConfig,
        files.length,
        width,
        height,
        mergePlan.focusSoftness,
      );
      return finalizeStoredGamma2Result(focusStored, width, height, outputColorSpace);
    }

    if (isTileMergeMode(mergePlan.mode)) {
      const layout = buildTileLayout(
        mergePlan.mode,
        width,
        height,
        files.length,
        mergePlan.tileFolding,
      );
      const output = new Uint16Array(layout.outputWidth * layout.outputHeight * 3);
      output.fill(CENTER_FILL_GRAY_STORED_GAMMA2);
      for (let index = 0; index < files.length; index += 1) {
        setProgress(`Placing tile image ${index + 1}/${files.length}...`);
        const stored = await reader.readGamma2Image(index, 1);
        placeStoredTileImage(index, stored, output, layout, width, height);
      }
      return finalizeStoredGamma2Result(output, layout.outputWidth, layout.outputHeight, outputColorSpace);
    }

    if (mergePlan.mode === "hdr1") {
      hdr1StreamWorker = createHdrDebevecReinhardStreamWorker(
        width,
        height,
        files.length,
        mergePlan.hdrExposureTimes,
        new Uint8Array(inputInfos.map((info) => info.isRaw ? 1 : 0)),
      );
      for (let index = 0; index < files.length; index += 1) {
        setProgress(`Streaming HDR1 response pass ${index + 1}/${files.length} from canonical cache...`);
        const linear = await reader.readLinearImage(index);
        const prepared = linearProPhotoFloatsToHdr1AndBrightness(linear);
        await hdr1StreamWorker.addImage(index, prepared.floats, prepared.brightness);
        await yieldToBrowser();
      }
      if (inputInfos.some((info) => !info.isRaw)) {
        await hdr1StreamWorker.beginSecondPass();
        for (let index = 0; index < files.length; index += 1) {
          setProgress(`Replaying HDR1 radiance pass ${index + 1}/${files.length} from canonical cache...`);
          const linear = await reader.readLinearImage(index);
          const prepared = linearProPhotoFloatsToHdr1AndBrightness(linear);
          await hdr1StreamWorker.addSecondPassImage(index, prepared.floats);
          await yieldToBrowser();
        }
      }
      const result = await hdr1StreamWorker.finalize();
      return finalizeStoredResult(result, width, height, outputColorSpace, false);
    }

    if (mergePlan.mode === "hdr2") {
      hdr2StreamWorker = createHdrMertensStreamWorker(width, height, files.length);
      for (let index = 0; index < files.length; index += 1) {
        setProgress(`Analyzing HDR2 weights ${index + 1}/${files.length} from canonical cache...`);
        const linear = await reader.readLinearImage(index);
        const prepared = linearProPhotoFloatsToHdr2AndBrightness(linear);
        await hdr2StreamWorker.addImage(index, prepared.floats, prepared.brightness);
        await yieldToBrowser();
      }
      await hdr2StreamWorker.beginSecondPass();
      for (let index = 0; index < files.length; index += 1) {
        setProgress(`Replaying HDR2 pyramid pass ${index + 1}/${files.length} from canonical cache...`);
        const linear = await reader.readLinearImage(index);
        const prepared = linearProPhotoFloatsToHdr2AndBrightness(linear);
        await hdr2StreamWorker.addSecondPassImage(index, prepared.floats);
        await yieldToBrowser();
      }
      const result = await hdr2StreamWorker.finalize();
      return finalizeStoredResult(result, width, height, outputColorSpace, true);
    }

    if (mergePlan.mode === "stf" && mergePlan.stfBlurPlan?.enabled) {
      return mergeStfWithAdditionalBlur(
        canonicalSession.id,
        reader,
        alignmentPlan,
        matrices,
        inputInfos,
        mergePlan,
        width,
        height,
        outputColorSpace,
      );
    }

    if (mergePlan.mode === "average" || mergePlan.mode === "stf") {
      const accumulator = await mergeLinearFromWorkerPool(
        canonicalSession.id,
        reader,
        alignmentPlan,
        matrices,
        mergePlan,
        width,
        height,
      );
      return finalizeStoredResult(
        accumulator,
        width,
        height,
        outputColorSpace,
        mergePlan.mode === "stf",
      );
    }

    throw new Error(`Unsupported merge mode: ${mergePlan.mode}`);
  } finally {
    coarsePreparation?.stop();
    if (alignmentWorkers) {
      alignmentWorkers.ECC.terminate();
      alignmentWorkers.ORB.terminate();
    }
    focusWorker?.terminate();
    hdr1StreamWorker?.terminate();
    hdr2StreamWorker?.terminate();
    if (focusScratchDb) {
      if (focusScratchSessionId) {
        try { await deleteMedianScratchSession(focusScratchDb, focusScratchSessionId); } catch {}
      }
      focusScratchDb.close();
    }
  }
}

async function mergePanoramaFromCanonical(
  canonicalSession,
  outputColorSpace,
  maxOutputMegapixels,
  finishMode,
) {
  const worker = new PanoramaWorkerClient(
    new URL("/generated/local-stack-studio/panorama.worker.js", window.location.origin),
    (message) => setProgress(message),
  );
  try {
    const result = await worker.stitch(canonicalSession.id, maxOutputMegapixels, finishMode);
    return finalizeStoredGamma2Result(
      result.gamma2Rgb,
      result.width,
      result.height,
      outputColorSpace,
    );
  } finally {
    worker.terminate();
  }
}

async function materializeNormalizedCanonicalLinear(cv, session, imageIndex, alignmentPlan, timings = null) {
  const meta = session.images[imageIndex];
  const readStartedAt = performance.now();
  const linear = await materializeCanonicalLinearImage(session, imageIndex);
  if (timings) timings.canonicalReadMs += performance.now() - readStartedAt;
  if (
    alignmentPlan.normalizationMode === "feature-match" ||
    (meta.width === alignmentPlan.targetWidth && meta.height === alignmentPlan.targetHeight)
  ) return linear;
  const normalizeStartedAt = performance.now();
  const normalized = transformLinearProPhotoForAlignment(
    cv,
    linear,
    meta.width,
    meta.height,
    alignmentPlan.targetWidth,
    alignmentPlan.targetHeight,
    alignmentPlan.normalizationMode,
  );
  if (timings) timings.normalizationMs += performance.now() - normalizeStartedAt;
  return normalized;
}

function createAlignmentFramesFromLinearProPhoto(cv, linear, width, height, exposureScalar, makeBase, makeFine, timings) {
  // Avoid the full-resolution Uint8ClampedArray + ImageData + matFromImageData
  // copy: write exactly the same byte values directly to OpenCV's RGBA Mat.
  const matStartedAt = performance.now();
  const rgba = new cv.Mat(height, width, cv.CV_8UC4);
  timings.rgbaAllocationMs += performance.now() - matStartedAt;
  try {
    const bytes = rgba.data;
    if (!bytes || bytes.length !== width * height * 4 || linear.length !== width * height * 3) {
      throw new Error("Could not allocate the alignment RGBA image.");
    }
    const converted = new Float32Array(3);
    const startedAt = performance.now();
    for (let dst = 0, src = 0; dst < bytes.length; dst += 4, src += 3) {
      convertLinearProPhotoToOutputRgbInto(linear[src], linear[src + 1], linear[src + 2], "srgb", converted);
      bytes[dst] = linearToSrgbByteFast(converted[0]);
      bytes[dst + 1] = linearToSrgbByteFast(converted[1]);
      bytes[dst + 2] = linearToSrgbByteFast(converted[2]);
      bytes[dst + 3] = 255;
    }
    timings.colorConversionMs += performance.now() - startedAt;
    return createAlignmentFramesFromRgba(cv, rgba, width, height, exposureScalar, makeBase, makeFine, timings);
  } finally {
    rgba.delete();
  }
}

function placeStoredTileImage(index, source, output, layout, width, height) {
  const position = layout.positions[index];
  const rowLength = width * 3;
  for (let y = 0; y < height; y += 1) {
    const sourceStart = y * rowLength;
    const targetStart = ((position.y + y) * layout.outputWidth + position.x) * 3;
    output.set(source.subarray(sourceStart, sourceStart + rowLength), targetStart);
  }
}

async function mergeLinearFromWorkerPool(
  sessionId,
  reader,
  alignmentPlan,
  matrices,
  mergePlan,
  width,
  height,
) {
  const imageCount = matrices.length;
  const exposureRolloffMaxP998AfterGain = new Array(imageCount).fill(null);
  const jobs = buildLinearMergeStripeJobs(width, height);
  const accumulator = new Float32Array(width * height * 3);
  const hardwareConcurrency = typeof navigator === "object"
    ? Math.max(1, Math.floor(navigator.hardwareConcurrency || 4))
    : 4;
  const workerUrl = new URL("/generated/local-stack-studio/linear-merge.worker.js", window.location.origin);
  const label = mergePlan.mode === "stf" ? "STF" : "Blend";
  const workerCount = resolveLinearMergeWorkerCount(jobs.length, hardwareConcurrency);
  setProgress(
    `${label} merging stripes 0/${jobs.length} with ${workerCount} worker${workerCount === 1 ? "" : "s"}...`,
  );

  const result = await runLinearMergePool({
    jobs,
    config: {
      sessionId,
      alignmentPlan: {
        normalizationMode: alignmentPlan.normalizationMode,
        targetWidth: alignmentPlan.targetWidth,
        targetHeight: alignmentPlan.targetHeight,
      },
      matrices,
      gains: new Float32Array(mergePlan.gains),
      scaledLogs: new Float32Array(mergePlan.scaledLogs || imageCount),
      weights: new Float32Array(mergePlan.weights),
      exposureRolloffMaxP998AfterGain,
    },
    createClient: () => new LinearMergeWorkerClient(workerUrl),
    hardwareConcurrency,
    onJobComplete: (job, _workerIndex, stripe, completedCount, totalCount) => {
      const targetStart = job.y * width * 3;
      accumulator.set(stripe, targetStart);
      setProgress(
        `${label} merging stripes ${completedCount}/${totalCount}` +
        `${workerCount > 0 ? ` with ${workerCount} worker${workerCount === 1 ? "" : "s"}` : ""}...`,
      );
    },
  });
  if (result.workerCount !== workerCount) {
    throw new Error(`${label} merge worker count changed unexpectedly.`);
  }
  return accumulator;
}


// Only the current canonical/alignment/merge combination may reuse the gate.
// Full-resolution float images are kept only under a strict cache memory budget.
const STF_GATE_CACHE_MAX_BYTES = 192 * 1024 * 1024;
let stfGateCache = null;
function resetStfGateCache() { stfGateCache = null; }
function stfGateCacheBytes(cache) {
  const buffers = new Set();
  for (const value of [cache?.ratio, cache?.source, cache?.base, cache?.expanded, cache?.mask]) {
    if (value?.buffer) buffers.add(value.buffer);
  }
  let bytes = 0;
  for (const buffer of buffers) bytes += buffer.byteLength;
  return bytes;
}
function canCacheStfBuffer(cache, buffer) {
  return cache && buffer && stfGateCacheBytes(cache) + buffer.byteLength <= STF_GATE_CACHE_MAX_BYTES;
}
function stfGateSourceKey(sessionId, alignmentPlan, matrices, inputInfos, mergePlan, width, height) {
  return JSON.stringify(["stf-p3p97-before-closing-production-v1", sessionId, width, height,
    alignmentPlan.normalizationMode, alignmentPlan.targetWidth, alignmentPlan.targetHeight,
    matrices.map((m) => m === null ? null : Array.from(m)),
    Array.from(mergePlan.gains), Array.from(mergePlan.scaledLogs), Array.from(mergePlan.weights),
    inputInfos.map((info) => Number(info?.fNumber))]);
}

function stfAdditionalBlurScratchKeys(sessionId, jobIndex) {
  const prefix = `${sessionId}:${jobIndex}`;
  return {
    fineLogSum: `${prefix}:fine-log-sum`,
    fineZero: `${prefix}:fine-zero`,
    coarseGroups: `${prefix}:coarse-groups`,
  };
}

function finalizeStfBasicGate(values, width, height, outputColorSpace) {
  if (values.length !== width * height) throw new Error("STF gate dimensions are invalid.");
  const stored = new Uint16Array(values.length * 3);
  for (let i = 0, o = 0; i < values.length; i++, o += 3) {
    const value = values[i];
    if (!Number.isFinite(value) || value < 0 || value > 1) throw new Error("STF gate must be in [0,1].");
    const encoded = Math.round(Math.sqrt(value) * RESULT_BUFFER_MAX_UINT16);
    stored[o] = stored[o + 1] = stored[o + 2] = encoded;
  }
  return finalizeStoredGamma2Result(stored, width, height, outputColorSpace);
}

async function mergeStfWithAdditionalBlur(
  sessionId, reader, alignmentPlan, matrices, inputInfos, mergePlan, width, height, outputColorSpace,
) {
  const plan = mergePlan.stfBlurPlan;
  if (!plan?.enabled) throw new Error("STF Additional blur was invoked while disabled.");
  const fNumbers = inputInfos.map((info) => Number(info?.fNumber));
  const [algorithm, poolModule, graphCutModule, stagingModule] = await Promise.all([
    import("./stf-additional-blur"),
    import("./stf-additional-blur-pool"),
    plan.areaExponent === null ? Promise.resolve(null) : import("./stf-graph-cut"),
    import("./stf-derived-staging"),
  ]);
  algorithm.buildStfApertureGroups(fNumbers);
  const sourceKey = stfGateSourceKey(sessionId, alignmentPlan, matrices, inputInfos, mergePlan, width, height);
  if (!stfGateCache || stfGateCache.key !== sourceKey) {
    resetStfGateCache();
    stfGateCache = { key: sourceKey, ratio: null, source: null, mask: null, maskRatio: null,
      maskInfo: null, base: null, baseKey: null, expanded: null, expandedKey: null };
  }
  const cache = stfGateCache;
  const jobs = buildLinearMergeStripeJobs(width, height);
  const hardwareConcurrency = typeof navigator === "object"
    ? Math.max(1, Math.floor(navigator.hardwareConcurrency || 4)) : 4;
  const workerUrl = new URL("/generated/local-stack-studio/stf-additional-blur.worker.js", window.location.origin);
  workerUrl.searchParams.set("revision", "stf-gate-optimized-sampled-p50-expansion-20261105");
  const timings = {};
  const stamp = () => performance.now();
  let pool = null;
  // Avoid writing temporary Sobel arrays to IndexedDB when a bounded amount
  // of RAM is enough; large images still spill to scratch storage as before.
  const derivedStaging = new stagingModule.StfDerivedStripeStaging(
    plan.gateOnly ? 96 * 1024 * 1024 : 64 * 1024 * 1024,
  );
  let scratchDbPromise = null;
  let scratchSessionId = null;
  let storedStripes = 0;
  let residentStripes = 0;
  const ensureScratchDb = () => {
    if (!scratchDbPromise) scratchDbPromise = openStfAdditionalBlurScratchDb("STF Additional blur");
    return scratchDbPromise;
  };
  let source = null;
  let activeRatio = cache.ratio;
  const ensurePool = async () => {
    if (pool) return pool;
    pool = await poolModule.StfAdditionalBlurWorkerPool.create({
      jobCount: jobs.length,
      config: {
        sessionId,
        alignmentPlan: { normalizationMode: alignmentPlan.normalizationMode,
          targetWidth: alignmentPlan.targetWidth, targetHeight: alignmentPlan.targetHeight },
        matrices,
        gains: new Float32Array(mergePlan.gains),
        scaledLogs: new Float32Array(mergePlan.scaledLogs),
        weights: new Float32Array(mergePlan.weights), fNumbers,
      },
      workerUrl, hardwareConcurrency,
    });
    return pool;
  };
  try {
    if (!cache.ratio) {
      const p = await ensurePool();
      const sampleGrid = algorithm.buildStfSampleGrid(width, height);
      const brightnessSamples = [[], [], []];
      let t = stamp();
      setProgress(`STF sampling RGB brightness 0/${jobs.length}...`);
      await p.sampleBrightnessStripes(jobs, sampleGrid, (_job, samples, completed, total) => {
        if (samples.length % 3 !== 0) throw new Error("STF Worker returned invalid brightness samples.");
        for (let i = 0; i < samples.length; i += 3) {
          brightnessSamples[0].push(samples[i]);
          brightnessSamples[1].push(samples[i + 1]);
          brightnessSamples[2].push(samples[i + 2]);
        }
        setProgress(`STF sampling RGB brightness ${completed}/${total}...`);
      });
      const floors = algorithm.deriveStfRelativeChannelFloorsFromSamples(brightnessSamples);
      await p.configureRelativeChannelFloors(floors);
      timings.brightnessP50 = stamp() - t;
      console.info("STF relative RGB brightness P50/64", { floors, sampleCount: brightnessSamples[0].length });

      // Defer opening scratch storage until a stripe exceeds the RAM budget.
      scratchSessionId = createStfAdditionalBlurScratchSessionId();
      const groupCount = p.ready.groupCount;
      const sharpnessSamples = [];
      if (!plan.gateOnly) source = new Float32Array(width * height * 3);
      t = stamp();
      setProgress(`STF analyzing Sobel sharpness 0/${jobs.length}...`);
      await p.runAnalysisJobs(jobs, !plan.gateOnly, async (job, result, completed, total) => {
        const pixels = width * job.height;
        if (result.linear.length !== (plan.gateOnly ? 0 : pixels * 3) || result.fineLogSum.length !== pixels ||
            result.fineZero.length !== pixels || result.coarseGroups.length !== pixels * groupCount ||
            result.groupCount !== groupCount) {
          throw new Error("STF Additional blur Worker returned invalid analysis geometry.");
        }
        if (source) source.set(result.linear, job.y * width * 3);
        algorithm.appendPersistentCoarseSamplesFromStripe(sharpnessSamples, result.coarseGroups,
          groupCount, width, job.y, job.height, sampleGrid);
        if (derivedStaging.put(job.index, result)) {
          residentStripes++;
        } else {
          const db = await ensureScratchDb();
          const keys = stfAdditionalBlurScratchKeys(scratchSessionId, job.index);
          await putStfAdditionalBlurScratchBuffers(db, [
            { key: keys.fineLogSum, buffer: result.fineLogSum.buffer },
            { key: keys.fineZero, buffer: result.fineZero.buffer },
            { key: keys.coarseGroups, buffer: result.coarseGroups.buffer },
          ], "STF Additional blur Sobel analysis");
          storedStripes++;
        }
        setProgress(`STF analyzing Sobel sharpness ${completed}/${total}...`);
      });
      timings.sobelAnalysis = stamp() - t;
      timings.intermediateStripesInRam = residentStripes;
      timings.intermediateStripesInScratch = storedStripes;
      const coarseP50 = algorithm.deriveStfMedianSharpnessC(sharpnessSamples);
      const epsilon = algorithm.deriveStfRatioEpsilon(coarseP50);
      console.info("STF coarse sharpness P50/64", { coarseP50, epsilon });
      let unitRatio = new Float32Array(width * height);
      t = stamp();
      setProgress(`STF generating log-ratios 0/${jobs.length}...`);
      await p.runRatioJobs(jobs,
        async (job) => {
          const resident = derivedStaging.take(job.index);
          if (resident) return { ...resident, groupCount, epsilon };
          const db = await ensureScratchDb();
          const keys = stfAdditionalBlurScratchKeys(scratchSessionId, job.index);
          const [fineLogSumBuffer, fineZeroBuffer, coarseGroupsBuffer] = await getStfAdditionalBlurScratchBuffers(
            db, [keys.fineLogSum, keys.fineZero, keys.coarseGroups],
            `STF Additional blur stripe ${job.index + 1}`);
          return { fineLogSum: new Float32Array(fineLogSumBuffer),
            fineZero: new Uint8Array(fineZeroBuffer), coarseGroups: new Float32Array(coarseGroupsBuffer),
            groupCount, epsilon };
        },
        (job, result, completed, total) => {
          if (result.length !== width * job.height) throw new Error("STF log-ratio stripe has invalid size.");
          unitRatio.set(result, job.y * width);
          setProgress(`STF generating log-ratios ${completed}/${total}...`);
        });
      timings.ratioGeneration = stamp() - t;
      t = stamp();
      // This is the only P3/P97 normalization; after this point all steps
      // take the same [0,1] scale, including Volume Closing 2.
      const norm = algorithm.normalizeStfLogRatioBufferInPlace(unitRatio);
      timings.p3p97 = stamp() - t;
      if (norm.degenerate) console.warn("STF P3/P97 normalization fallback: degenerate ratio distribution.", norm);
      else console.info("STF P3/P97 normalized before Volume Closing 2", norm);
      t = stamp();
      setProgress("STF applying Volume Closing 2...");
      const closed = await p.volumeClose(unitRatio, width, height);
      unitRatio = closed.values;
      timings.volumeClosing2 = stamp() - t;
      console.info("STF Volume Closing 2", closed.info);
      activeRatio = unitRatio;
      // Store large full-resolution buffers only within the cache budget;
      // oversized maps remain local to this Process and are released after it.
      if (canCacheStfBuffer(cache, unitRatio)) cache.ratio = unitRatio;
      if (source && cache.ratio && canCacheStfBuffer(cache, source)) cache.source = source;
    } else {
      timings.reusedRatioAnalysis = true;
      if (!plan.gateOnly && cache.source) source = cache.source;
    }

    const ratio = activeRatio;
    if (!ratio || ratio.length !== width * height) throw new Error("STF base sharpness gate is missing.");
    const effectiveRatio = plan.effectiveRatio;
    const baseKey = JSON.stringify([effectiveRatio, plan.areaExponent, plan.sigmoid]);
    let base = cache.baseKey === baseKey ? cache.base : null;
    if (!base) {
      let gated = ratio;
      if (plan.areaExponent !== null) {
        let t = stamp();
        if (!cache.mask || cache.maskRatio !== effectiveRatio) {
          const p = await ensurePool();
          setProgress("STF computing Graph Cut mask...");
          const graph = await p.graphCut(ratio.slice(), width, height, effectiveRatio);
          cache.mask = graph.mask;
          cache.maskInfo = graph.info;
          cache.maskRatio = effectiveRatio;
          timings.graphCut = stamp() - t;
          console.info("STF Graph Cut partition", graph.info);
        } else {
          timings.reusedCutMask = true;
        }
        t = stamp();
        gated = graphCutModule.applyStfGraphCutBoost(ratio, width, height,
          cache.mask, cache.maskInfo.workingWidth, cache.maskInfo.workingHeight, plan.areaExponent);
        timings.areaPowerBoost = stamp() - t;
      }
      if (plan.sigmoid !== 0) {
        const t = stamp();
        if (gated === ratio) gated = ratio.slice();
        const sigmoid = algorithm.applyStfSigmoidGateInPlace(gated, width, height, effectiveRatio, plan.sigmoid);
        timings.sigmoid = stamp() - t;
        console.info("STF endpoint-fixed sigmoid", { ...sigmoid, percent: plan.sigmoid });
      }
      base = gated;
      // Cache always prioritizes RatioAnalysis and the latest BaseGate.
      cache.base = null; cache.baseKey = null;
      cache.expanded = null; cache.expandedKey = null;
      if (cache.ratio && (base === ratio || canCacheStfBuffer(cache, base))) {
        cache.base = base;
        cache.baseKey = baseKey;
      }
    } else {
      timings.reusedBaseGate = true;
    }
    if (plan.gateOnly) {
      console.info("STF Additional blur stage timings (ms)", timings);
      return finalizeStfBasicGate(base, width, height, outputColorSpace);
    }
    const blurRadius = algorithm.resolveStfAdditionalBlurRadius(width, height, plan.strengthMultiplier);
    const expandedKey = JSON.stringify([baseKey, blurRadius, 0.5, 0.2, 0.7]);
    let expanded = cache.expandedKey === expandedKey ? cache.expanded : null;
    if (!expanded) {
      const t = stamp();
      const p = await ensurePool();
      const expansionHalo = Math.max(1, Math.round(blurRadius * 0.5));
      const completedGate = new Float32Array(width * height);
      setProgress(`STF expanding protection gate 0/${jobs.length}...`);
      await p.runGateExpansionJobs(jobs,
        (job) => {
          const regionY = Math.max(0, job.y - expansionHalo);
          const regionEnd = Math.min(height, job.y + job.height + expansionHalo);
          return { regionHeight: regionEnd - regionY, coreOffsetY: job.y - regionY,
            coreHeight: job.height, radius: blurRadius,
            gate: base.slice(regionY * width, regionEnd * width) };
        },
        (job, stripe, completed, total) => {
          if (stripe.length !== width * job.height) throw new Error("STF expanded gate stripe has invalid size.");
          completedGate.set(stripe, job.y * width);
          setProgress(`STF expanding protection gate ${completed}/${total}...`);
        });
      expanded = completedGate;
      timings.expandedGate = stamp() - t;
      cache.expanded = null; cache.expandedKey = null;
      if (cache.base && canCacheStfBuffer(cache, expanded)) {
        cache.expanded = expanded;
        cache.expandedKey = expandedKey;
      }
    } else timings.reusedExpandedGate = true;
    if (!source) {
      const t = stamp();
      setProgress("STF merging source for additional blur...");
      // Re-merging is much cheaper than Sobel analysis and avoids persisting
      // 240MB of linear RGB for 20MP images just to support option switching.
      source = await mergeLinearFromWorkerPool(sessionId, reader, alignmentPlan, matrices, mergePlan, width, height);
      timings.sourceMerge = stamp() - t;
      if (cache.ratio && canCacheStfBuffer(cache, source)) cache.source = source;
    }
    const p = await ensurePool();
    const blurred = new Float32Array(source.length);
    const t = stamp();
    setProgress(`STF guarded Gaussian blur 0/${jobs.length}...`);
    await p.runBlurJobs(jobs,
      (job) => {
        const regionY = Math.max(0, job.y - blurRadius);
        const regionEnd = Math.min(height, job.y + job.height + blurRadius);
        return { regionHeight: regionEnd - regionY, coreOffsetY: job.y - regionY,
          coreHeight: job.height, radius: blurRadius,
          source: source.slice(regionY * width * 3, regionEnd * width * 3),
          gate: expanded.slice(regionY * width, regionEnd * width) };
      },
      (job, stripe, completed, total) => {
        if (stripe.length !== width * job.height * 3) throw new Error("STF Gaussian stripe has invalid size.");
        blurred.set(stripe, job.y * width * 3);
        setProgress(`STF guarded Gaussian blur ${completed}/${total}...`);
      });
    timings.guardedGaussian = stamp() - t;
    console.info("STF Additional blur stage timings (ms)", { ...timings, blurRadius,
      cacheBytes: stfGateCacheBytes(cache), workers: p.ready.workerCount });
    return finalizeStoredResult(blurred, width, height, outputColorSpace, true);
  } finally {
    pool?.terminate();
    derivedStaging.clear();
    if (scratchDbPromise) {
      try {
        const db = await scratchDbPromise;
        try { await deleteStfAdditionalBlurScratchSession(db, scratchSessionId); }
        catch (error) { console.warn("STF Additional blur scratch cleanup failed", error); }
        db.close();
      } catch (error) { console.warn("STF Additional blur scratch cleanup unavailable", error); }
    }
  }
}

async function mergeMedianFromWorkerPool(sessionId, alignmentPlan, matrices, width, height) {
  const output = new Uint16Array(width * height * 3);
  const columns = Math.ceil(width / MEDIAN_TILE_SIZE);
  const rows = Math.ceil(height / MEDIAN_TILE_SIZE);
  const jobs = [];
  let index = 0;
  for (let ty = 0; ty < rows; ty += 1) {
    const y = ty * MEDIAN_TILE_SIZE;
    const h = Math.min(MEDIAN_TILE_SIZE, height - y);
    for (let tx = 0; tx < columns; tx += 1) {
      const x = tx * MEDIAN_TILE_SIZE;
      const w = Math.min(MEDIAN_TILE_SIZE, width - x);
      jobs.push({ index, x, y, width: w, height: h });
      index += 1;
    }
  }

  setProgress(`Computing median tiles 0/${jobs.length}...`);
  const workerUrl = new URL("/generated/local-stack-studio/median.worker.js", window.location.origin);
  await runMedianPool({
    jobs,
    config: {
      sessionId,
      alignmentPlan: {
        normalizationMode: alignmentPlan.normalizationMode,
        targetWidth: alignmentPlan.targetWidth,
        targetHeight: alignmentPlan.targetHeight,
      },
      matrices,
    },
    createClient: () => new MedianWorkerClient(workerUrl),
    hardwareConcurrency: globalThis.navigator?.hardwareConcurrency,
    onJobComplete(job, _workerIndex, median, completed, total) {
      const rowLength = job.width * 3;
      for (let ly = 0; ly < job.height; ly += 1) {
        output.set(
          median.subarray(ly * rowLength, (ly + 1) * rowLength),
          ((job.y + ly) * width + job.x) * 3,
        );
      }
      setProgress(`Computing median tiles ${completed}/${total} (${job.width}x${job.height})...`);
    },
  });
  return output;
}

async function storeFocusSharpnessFeatureResult(db, sessionId, imageIndex, featureResult, width, height) {
  const expectedWorking = focusSharpnessWorkingDimensions(width, height);
  const workingPixels = expectedWorking.width * expectedWorking.height;
  if (
    featureResult.workingWidth !== expectedWorking.width ||
    featureResult.workingHeight !== expectedWorking.height ||
    !(featureResult.features instanceof Float32Array) ||
    featureResult.features.length !== workingPixels * 2
  ) throw new Error("Focus worker returned invalid sharpness features.");
  const metadata = encodeFocusFeatureMetadata(featureResult);
  await putMedianScratchTiles(
    db,
    [
      { key: focusFeatureKey(sessionId, imageIndex), buffer: featureResult.features.buffer },
      { key: focusFeatureMetadataKey(sessionId, imageIndex), buffer: metadata.buffer },
    ],
    "Focus sharpness feature buffers",
  );
}

async function computeFocusSharpnessFeaturesParallel(
  db,
  sessionId,
  canonicalConfig,
  imageCount,
  width,
  height,
) {
  const workerUrl = new URL("/generated/local-stack-studio/focus.worker.js", window.location.origin);
  let completed = 0;
  setProgress(`Computing Focus sharpness features 0/${imageCount}...`);
  await runFocusFeaturePool({
    imageCount,
    width,
    height,
    config: canonicalConfig,
    createClient: () => new FocusWorkerClient(workerUrl),
    hardwareConcurrency: globalThis.navigator?.hardwareConcurrency,
    async onJobComplete(imageIndex, _workerIndex, featureResult, completedCount, totalCount) {
      await storeFocusSharpnessFeatureResult(
        db,
        sessionId,
        imageIndex,
        featureResult,
        width,
        height,
      );
      completed = completedCount;
      setProgress(`Computing Focus sharpness features ${completed}/${totalCount}...`);
    },
  });
}

function linearProPhotoFloatsToHdr1AndBrightness(linear) {
  const floats = new Float32Array(linear.length);
  let brightnessSum = 0;
  const pixels = linear.length / 3;
  for (let i=0;i<linear.length;i+=3) {
    const r=clamp01(linear[i]), g=clamp01(linear[i+1]), b=clamp01(linear[i+2]);
    floats[i]=r; floats[i+1]=g; floats[i+2]=b;
    brightnessSum += toneLinearIntensity(r,g,b);
  }
  return { floats, brightness: pixels > 0 ? brightnessSum / pixels : 0 };
}

function linearProPhotoFloatsToHdr2AndBrightness(linear) {
  return linearProPhotoArrayToHdr2FloatsAndBrightness(linear);
}

async function processSingleInputHdrFromCanonical(baseLinear, width, height, mergePlan, outputColorSpace) {
  const materials = mergePlan.syntheticMaterials;
  if (!Array.isArray(materials) || materials.length !== 3) throw new Error(`Single-input ${mergePlan.mode.toUpperCase()} requires three synthetic materials.`);
  if (mergePlan.mode === "hdr1") {
    const hdrBase = buildSingleShotHdrBaseLinear(baseLinear, width, height, null, true);
    const worker = createHdrDebevecReinhardStreamWorker(width, height, materials.length, mergePlan.hdrExposureTimes, new Uint8Array(materials.length).fill(1));
    try {
      const brightness = computeAverageBrightnessFromLinear(hdrBase.linear);
      for (let i=0;i<materials.length;i+=1) await worker.addImage(i, buildSingleShotHdr1Material(hdrBase.linear, hdrBase.p998, materials[i]), brightness);
      return finalizeStoredResult(await worker.finalize(), width, height, outputColorSpace, false);
    } finally { worker.terminate(); }
  }
  const contrastStretch = prepareSingleShotHdrContrastStretch(baseLinear, width, height);
  const hdrBase = buildSingleShotHdrBaseLinear(baseLinear, width, height, contrastStretch, true);
  applyLinearGainInPlace(hdrBase.linear, SINGLE_SHOT_HDR2_BASE_HEADROOM_GAIN);
  const brightness = computeAverageBrightnessFromLinear(hdrBase.linear);
  const worker = createHdrMertensStreamWorker(width, height, materials.length);
  try {
    for (let i=0;i<materials.length;i+=1) await worker.addImage(i, buildSingleShotHdr2Material(hdrBase.linear, materials[i]), brightness);
    await worker.beginSecondPass();
    for (let i=0;i<materials.length;i+=1) await worker.addSecondPassImage(i, buildSingleShotHdr2Material(hdrBase.linear, materials[i]));
    return finalizeStoredResult(await worker.finalize(), width, height, outputColorSpace, true);
  } finally { worker.terminate(); }
}

async function recoverDeferredAlignments(
  alignmentWorkers,
  files,
  alignmentFrames,
  alignmentAlgorithm,
  alignmentMatrices,
  alignedIndices,
  deferredAlignments,
) {
  let madeProgress = true;

  while (madeProgress) {
    madeProgress = false;

    for (const entry of deferredAlignments) {
      if (alignmentMatrices[entry.index]) continue;

      const referenceIndices = Array.from(alignedIndices)
        .filter((referenceIndex) => (
          referenceIndex !== entry.index &&
          !entry.attemptedReferences.has(referenceIndex) &&
          alignmentMatrices[referenceIndex]
        ))
        .sort((a, b) => {
          const distanceDiff = Math.abs(a - entry.index) - Math.abs(b - entry.index);
          return distanceDiff !== 0 ? distanceDiff : a - b;
        });

      for (const referenceIndex of referenceIndices) {
        entry.attemptedReferences.add(referenceIndex);
        const referenceFile = files[referenceIndex];
        const targetFile = files[entry.index];
        setProgress(
          `Retrying ${targetFile.name} against ${referenceFile.name} ` +
          `(${entry.attemptedReferences.size - 1} alternate reference${entry.attemptedReferences.size === 2 ? "" : "s"} tried)...`,
        );

        try {
          const referenceFrame = alignmentFrames[referenceIndex];
          const targetFrame = alignmentFrames[entry.index];
          if (!referenceFrame || !targetFrame) {
            throw new Error("Cached alignment frame is unavailable.");
          }
          const initialized = await initializeAlignmentReference(
            alignmentWorkers,
            alignmentAlgorithm,
            referenceFrame,
          );
          const aligned = await alignWithFallback(
            alignmentWorkers,
            initialized.algorithm,
            {
              algorithm: initialized.algorithm,
              frame: referenceFrame,
            },
            entry.index,
            targetFile.name,
            targetFrame,
          );
          const composedMatrix = multiplyAlignmentMatrices(
            alignmentMatrices[referenceIndex],
            aligned.result.matrix,
          );

          alignmentMatrices[entry.index] = composedMatrix;
          alignedIndices.add(entry.index);
          madeProgress = true;

          break;
        } catch (error) {
          if (isAlignmentImplementationError(error)) throw error;
          const message = error instanceof Error ? error.message : String(error);
          entry.attempts.push({ referenceIndex, error: message });
        }
      }
    }
  }
}


const FOCUS_FEATURE_METADATA_VERSION = 1;

function focusFeatureKey(sessionId, imageIndex) {
  return `${sessionId}:sharp-feature:${imageIndex}`;
}

function focusFeatureMetadataKey(sessionId, imageIndex) {
  return `${sessionId}:sharp-feature-meta:${imageIndex}`;
}

function encodeFocusFeatureMetadata(featureResult) {
  return new Float64Array([
    FOCUS_FEATURE_METADATA_VERSION,
    featureResult.workingWidth,
    featureResult.workingHeight,
    featureResult.lapStats.count,
    featureResult.lapStats.mean,
    featureResult.lapStats.m2,
    featureResult.sobelStats.count,
    featureResult.sobelStats.mean,
    featureResult.sobelStats.m2,
  ]);
}

function decodeFocusFeatureMetadata(buffer) {
  const values = new Float64Array(buffer);
  if (values.length !== 9 || values[0] !== FOCUS_FEATURE_METADATA_VERSION) {
    throw new Error("Focus sharpness feature metadata is invalid.");
  }
  const metadata = {
    workingWidth: values[1],
    workingHeight: values[2],
    lapStats: { count: values[3], mean: values[4], m2: values[5] },
    sobelStats: { count: values[6], mean: values[7], m2: values[8] },
  };
  const stats = [metadata.lapStats, metadata.sobelStats];
  if (
    !Number.isInteger(metadata.workingWidth) || metadata.workingWidth <= 0 ||
    !Number.isInteger(metadata.workingHeight) || metadata.workingHeight <= 0 ||
    stats.some((entry) =>
      !Number.isInteger(entry.count) || entry.count < 0 ||
      !Number.isFinite(entry.mean) || !Number.isFinite(entry.m2) || entry.m2 < 0
    )
  ) {
    throw new Error("Focus sharpness feature metadata contains invalid statistics.");
  }
  return metadata;
}

async function prepareFocusSharpnessMaps(
  db,
  sessionId,
  focusWorker,
  imageCount,
  width,
  height,
) {
  if (!focusWorker) throw new Error("Focus worker is not initialized.");
  const expectedWorking = focusSharpnessWorkingDimensions(width, height);
  const workingPixels = expectedWorking.width * expectedWorking.height;
  setProgress("Computing stack-global Focus sharpness statistics...");
  const metadataBuffers = await getScratchBuffers(
    db,
    Array.from({ length: imageCount }, (_, imageIndex) =>
      focusFeatureMetadataKey(sessionId, imageIndex)),
    "Focus sharpness feature metadata",
  );

  let lapStats = emptyFocusRunningStats();
  let sobelStats = emptyFocusRunningStats();
  const metadata = metadataBuffers.map((buffer, imageIndex) => {
    const decoded = decodeFocusFeatureMetadata(buffer);
    if (
      decoded.workingWidth !== expectedWorking.width ||
      decoded.workingHeight !== expectedWorking.height ||
      decoded.lapStats.count !== workingPixels ||
      decoded.sobelStats.count !== workingPixels
    ) {
      throw new Error(`Focus sharpness features for image ${imageIndex + 1} have inconsistent dimensions.`);
    }
    lapStats = mergeFocusRunningStats(lapStats, decoded.lapStats);
    sobelStats = mergeFocusRunningStats(sobelStats, decoded.sobelStats);
    return decoded;
  });

  const globalLapStd = focusRunningStatsStd(lapStats);
  const globalSobelStd = focusRunningStatsStd(sobelStats);
  if (!(lapStats.count > 0 && sobelStats.count > 0)) {
    throw new Error("Focus sharpness feature statistics are empty.");
  }

  const sharpnessMaps = [];
  for (let imageIndex = 0; imageIndex < imageCount; imageIndex += 1) {
    setProgress(`Normalizing Focus sharpness ${imageIndex + 1}/${imageCount} across the stack...`);
    const [featureBuffer] = await getScratchBuffers(
      db,
      [focusFeatureKey(sessionId, imageIndex)],
      `Focus sharpness features ${imageIndex + 1}`,
    );
    const features = new Float32Array(featureBuffer);
    if (features.length !== workingPixels * 2) {
      throw new Error(`Focus sharpness features for image ${imageIndex + 1} have an invalid size.`);
    }
    const sharpness = await focusWorker.composeSharpness(
      features,
      metadata[imageIndex].workingWidth,
      metadata[imageIndex].workingHeight,
      width,
      height,
      lapStats.mean,
      globalLapStd,
      sobelStats.mean,
      globalSobelStd,
      `Composing stack-normalized Focus sharpness ${imageIndex + 1}/${imageCount}...`,
    );
    if (!(sharpness instanceof Float32Array) || sharpness.length !== workingPixels) {
      throw new Error(`Focus sharpness map for image ${imageIndex + 1} has an invalid size.`);
    }
    sharpnessMaps.push(sharpness);
    await deleteScratchBuffers(
      db,
      [
        focusFeatureKey(sessionId, imageIndex),
        focusFeatureMetadataKey(sessionId, imageIndex),
      ],
      `Focus sharpness features ${imageIndex + 1}`,
    );
    await yieldToBrowser();
  }

  return {
    workingWidth: expectedWorking.width,
    workingHeight: expectedWorking.height,
    sharpnessMaps,
  };
}

function computeFocusGlobalTau(stats, softness = DEFAULT_FOCUS_SOFTNESS) {
  if (!(stats && stats.count > 0)) throw new Error("Focus sharpness statistics are empty.");
  if (!(Number.isFinite(softness) && softness >= 0 && softness <= 0.5)) {
    throw new Error(`Focus Softness is invalid: ${softness}`);
  }
  const mean = stats.sum / stats.count;
  const variance = Math.max(0, stats.sumSq / stats.count - mean * mean);
  return Math.max(Math.sqrt(variance) * softness, 1e-4);
}

async function mergeFocusFromCanonical(db, sessionId, focusWorker, canonicalConfig, imageCount, width, height, softness = DEFAULT_FOCUS_SOFTNESS) {
  if (!focusWorker) throw new Error("Focus worker is not initialized.");
  const preparedSharpness = await prepareFocusSharpnessMaps(
    db,
    sessionId,
    focusWorker,
    imageCount,
    width,
    height,
  );
  const focusGrid = focusGridDimensions(width, height);
  setProgress(`Aggregating Focus support grid ${focusGrid.cols}x${focusGrid.rows}...`);
  const tileScores = computeFocusTileScores(
    preparedSharpness.sharpnessMaps,
    preparedSharpness.workingWidth,
    preparedSharpness.workingHeight,
    focusGrid,
  );
  setProgress("Composing Focus final map and weight statistics...");
  const finalMapResult = computeFocusFinalMaps(
    preparedSharpness.sharpnessMaps,
    preparedSharpness.workingWidth,
    preparedSharpness.workingHeight,
    tileScores,
    focusGrid,
  );
  const finalMaps = finalMapResult.finalMaps;
  preparedSharpness.sharpnessMaps.length = 0;
  tileScores.length = 0;

  const tau = computeFocusGlobalTau(finalMapResult.stats, softness);

  const output = new Uint16Array(width * height * 3);
  const imageShortSide = Math.min(width, height);
  const pyramidDownsamples = Math.max(
    0,
    Math.min(
      FOCUS_MAX_PYRAMID_DOWNSAMPLES,
      Math.floor(Math.log2(Math.max(1, imageShortSide))) - 3,
    ),
  );

  const coreColumns = Math.ceil(width / FOCUS_PROCESSING_CORE_SIZE);
  const coreRows = Math.ceil(height / FOCUS_PROCESSING_CORE_SIZE);
  const coreCount = coreColumns * coreRows;
  const hardwareConcurrency = typeof navigator === "object"
    ? Math.max(1, Math.floor(navigator.hardwareConcurrency || FOCUS_MERGE_MAX_WORKERS))
    : FOCUS_MERGE_MAX_WORKERS;
  const mergeWorkerCount = Math.max(
    1,
    Math.min(FOCUS_MERGE_MAX_WORKERS, hardwareConcurrency, coreCount),
  );
  const mergeWorkers = [focusWorker];
  const extraMergeWorkers = [];
  const workerUrl = new URL("/generated/local-stack-studio/focus.worker.js", window.location.origin);
  for (let workerIndex = 1; workerIndex < mergeWorkerCount; workerIndex += 1) {
    const worker = new FocusWorkerClient(workerUrl);
    mergeWorkers.push(worker);
    extraMergeWorkers.push(worker);
  }

  try {
    setProgress(`Initializing ${mergeWorkerCount} Focus merge worker${mergeWorkerCount === 1 ? "" : "s"} from canonical inputs...`);
    await Promise.all(mergeWorkers.map(async (worker) => {
      const ready = await worker.initializeCanonical(canonicalConfig);
      if (ready.imageCount !== imageCount || ready.width !== width || ready.height !== height) {
        throw new Error(
          `Focus worker canonical input ${ready.imageCount} images at ${ready.width}x${ready.height} ` +
          `does not match expected ${imageCount} images at ${width}x${height}.`,
        );
      }
    }));
    if (extraMergeWorkers.length > 0) {
      await Promise.all(extraMergeWorkers.map((worker) =>
        worker.initializeWorkingSharpness(
          finalMaps,
          preparedSharpness.workingWidth,
          preparedSharpness.workingHeight,
          width,
          height,
        )));
    }
    await focusWorker.initializeWorkingSharpness(
      finalMaps,
      preparedSharpness.workingWidth,
      preparedSharpness.workingHeight,
      width,
      height,
      true,
    );
    finalMaps.length = 0;

    let nextCoreIndex = 0;
    let completedCoreCount = 0;
    setProgress(`Focus merging cores 0/${coreCount} with ${mergeWorkerCount} worker${mergeWorkerCount === 1 ? "" : "s"}...`);

    const runMergeWorker = async (worker) => {
      while (true) {
        const coreIndex = nextCoreIndex;
        nextCoreIndex += 1;
        if (coreIndex >= coreCount) return;

        const coreY = Math.floor(coreIndex / coreColumns);
        const coreX = coreIndex % coreColumns;
        const y0 = coreY * FOCUS_PROCESSING_CORE_SIZE;
        const x0 = coreX * FOCUS_PROCESSING_CORE_SIZE;
        const coreHeight = Math.min(FOCUS_PROCESSING_CORE_SIZE, height - y0);
        const coreWidth = Math.min(FOCUS_PROCESSING_CORE_SIZE, width - x0);
        const regionX = Math.max(0, x0 - FOCUS_HALO_SIZE);
        const regionY = Math.max(0, y0 - FOCUS_HALO_SIZE);
        const regionRight = Math.min(width, x0 + coreWidth + FOCUS_HALO_SIZE);
        const regionBottom = Math.min(height, y0 + coreHeight + FOCUS_HALO_SIZE);
        const regionWidth = regionRight - regionX;
        const regionHeight = regionBottom - regionY;
        const coreOffsetX = x0 - regionX;
        const coreOffsetY = y0 - regionY;

        const focusCore = await worker.mergeFocusCoreFromCanonical(
          regionX,
          regionY,
          regionWidth,
          regionHeight,
          coreOffsetX,
          coreOffsetY,
          coreWidth,
          coreHeight,
          tau,
          pyramidDownsamples,
        );
        if (focusCore.length !== coreWidth * coreHeight * 3) {
          throw new Error("Focus worker returned an invalid core size.");
        }
        const coreRowLength = coreWidth * 3;
        for (let localY = 0; localY < coreHeight; localY += 1) {
          const sourceStart = localY * coreRowLength;
          const targetStart = ((y0 + localY) * width + x0) * 3;
          output.set(focusCore.subarray(sourceStart, sourceStart + coreRowLength), targetStart);
        }
        completedCoreCount += 1;
        setProgress(
          `Focus merging cores ${completedCoreCount}/${coreCount} with ` +
          `${mergeWorkerCount} worker${mergeWorkerCount === 1 ? "" : "s"}...`,
        );
        await yieldToBrowser();
      }
    };

    await Promise.all(mergeWorkers.map((worker) => runMergeWorker(worker)));
    return output;
  } finally {
    preparedSharpness.sharpnessMaps.length = 0;
    finalMaps.length = 0;
    for (const worker of extraMergeWorkers) worker.terminate();
  }
}

function identityAlignmentMatrix() {
  return new Float64Array([
    1, 0, 0,
    0, 1, 0,
    0, 0, 1,
  ]);
}

function multiplyAlignmentMatrices(left, right) {
  const result = new Float64Array(9);
  for (let row = 0; row < 3; row += 1) {
    for (let col = 0; col < 3; col += 1) {
      let value = 0;
      for (let k = 0; k < 3; k += 1) {
        value += left[row * 3 + k] * right[k * 3 + col];
      }
      result[row * 3 + col] = value;
    }
  }

  const denominator = result[8];
  if (!Number.isFinite(denominator) || Math.abs(denominator) < 1e-12) {
    throw new Error("Composed alignment transform is invalid.");
  }
  for (let i = 0; i < result.length; i += 1) {
    result[i] /= denominator;
    if (!Number.isFinite(result[i])) {
      throw new Error("Composed alignment transform contains a non-finite value.");
    }
  }
  return result;
}

function copyMatBytes(mat, expectedLength) {
  if (!mat.data || mat.data.length < expectedLength) {
    throw new Error("OpenCV returned an invalid grayscale image buffer.");
  }
  // Mat.data is a Uint8Array: one copy suffices (slice + constructor copied twice).
  return new Uint8Array(mat.data.subarray(0, expectedLength));
}

function matFromLinearProPhoto(cv, linear, width, height) {
  if (cv.CV_32FC3 === undefined) {
    throw new Error("This OpenCV.js build is missing CV_32FC3 required for 16-bit RAW stacking.");
  }
  if (!(linear instanceof Float32Array) || linear.length !== width * height * 3) {
    throw new Error("RAW decoder returned an invalid linear ProPhoto RGB buffer.");
  }
  const mat = new cv.Mat(height, width, cv.CV_32FC3);
  if (!mat.data32F || mat.data32F.length !== linear.length) {
    mat.delete();
    throw new Error("OpenCV could not allocate a Float32 RGB image for RAW stacking.");
  }
  mat.data32F.set(linear);
  return mat;
}



function createHdrDebevecReinhardStreamWorker(
  width,
  height,
  imageCount,
  exposureTimes,
  linearResponseFlags = null,
) {
  return createHdrDebevecReinhardStreamWorkerClient(
    new URL("/generated/local-stack-studio/hdr.worker.js", window.location.origin),
    setProgress,
    width,
    height,
    imageCount,
    exposureTimes,
    linearResponseFlags,
  );
}

function createHdrMertensStreamWorker(width, height, imageCount) {
  return createHdrMertensStreamWorkerClient(
    new URL("/generated/local-stack-studio/hdr.worker.js", window.location.origin),
    setProgress,
    width,
    height,
    imageCount,
    SINGLE_SHOT_HDR_SATURATION_WEIGHT,
    SINGLE_SHOT_HDR_EXPOSURE_WEIGHT,
  );
}

function buildSingleShotHdr1Material(sourceLinear, baseP998, material) {
  const adjusted = applySingleShotHdrExposureToLinear(sourceLinear, baseP998, material, true);
  const floats = new Float32Array(adjusted.length);
  const sigmoidGain = Number.isFinite(material.sigmoidGain) ? material.sigmoidGain : 0;
  const sigmoidMidpoint = Number.isFinite(material.sigmoidMidpoint) ? material.sigmoidMidpoint : 0.5;
  const hasSigmoid = Math.abs(sigmoidGain) > 1e-6;
  for (let i = 0; i < adjusted.length; i += 3) {
    const r = adjusted[i];
    const g = adjusted[i + 1];
    const b = adjusted[i + 2];
    const maxChannel = Math.max(r, g, b);
    if (hasSigmoid && maxChannel > 1e-12) {
      const rolledMax = clamp01(applySigmoidLinearAtMidpoint(maxChannel, sigmoidGain, sigmoidMidpoint));
      const scale = rolledMax / maxChannel;
      floats[i] = clamp01(r * scale);
      floats[i + 1] = clamp01(g * scale);
      floats[i + 2] = clamp01(b * scale);
    } else {
      floats[i] = clamp01(r);
      floats[i + 1] = clamp01(g);
      floats[i + 2] = clamp01(b);
    }
  }
  return floats;
}

function buildSingleShotHdr2Material(sourceLinear, material) {
  const scaledLog = Number.isFinite(material.scaledLog) ? material.scaledLog : 0;
  const sigmoidGain = Number.isFinite(material.sigmoidGain) ? material.sigmoidGain : 0;
  const hasScaledLog = Math.abs(scaledLog) > 1e-6;
  const hasSigmoid = Math.abs(sigmoidGain) > 1e-6;
  const sigmoidMidpoint = Number.isFinite(material.sigmoidMidpoint) ? material.sigmoidMidpoint : 0.5;
  const floats = new Float32Array(sourceLinear.length);
  for (let i = 0; i < sourceLinear.length; i += 3) {
    let r = sourceLinear[i];
    let g = sourceLinear[i + 1];
    let b = sourceLinear[i + 2];

    if (hasScaledLog) {
      const sourceLuminance = toneLinearIntensity(r, g, b);
      if (sourceLuminance > 1e-12) {
        const targetLuminance = applyScaledLogLinear(sourceLuminance, scaledLog);
        const scale = targetLuminance / sourceLuminance;
        r *= scale;
        g *= scale;
        b *= scale;
      }
    }

    if (hasSigmoid) {
      const sourceLuminance = toneLinearIntensity(r, g, b);
      if (sourceLuminance > 1e-12) {
        const targetLuminance = applySigmoidLinearAtMidpoint(
          sourceLuminance,
          sigmoidGain,
          sigmoidMidpoint,
        );
        const scale = targetLuminance / sourceLuminance;
        r *= scale;
        g *= scale;
        b *= scale;
      }
    }

    r = Math.max(0, r);
    g = Math.max(0, g);
    b = Math.max(0, b);
    const maxChannel = Math.max(r, g, b);
    if (maxChannel > 1) {
      const fitScale = 1 / maxChannel;
      r *= fitScale;
      g *= fitScale;
      b *= fitScale;
    }
    floats[i] = r;
    floats[i + 1] = g;
    floats[i + 2] = b;
  }
  return floats;
}

function prepareSingleShotHdrContrastStretch(sourceLinear, width, height) {
  const p98 = estimateMaxChannelPercentileSampled(sourceLinear, width, height, 0.98, 256);
  const p998 = estimateMaxChannelPercentileSampled(sourceLinear, width, height, 0.998, 256);
  const stretchGain = Number.isFinite(p98) && p98 > 1e-6 && p98 < 0.9 ? 0.9 / p98 : 1;
  return {
    p998,
    stretchGain,
  };
}

function buildSingleShotHdrBaseLinear(sourceLinear, width, height, contrastStretch, useRolloff) {
  const result = new Float32Array(sourceLinear);
  const gain = contrastStretch && Number.isFinite(contrastStretch.stretchGain)
    ? contrastStretch.stretchGain
    : 1;
  if (gain > 1) {
    if (useRolloff) {
      applyExposureAndRolloffInPlace(result, gain, contrastStretch ? contrastStretch.p998 : null);
    } else {
      applyLinearGainInPlace(result, gain);
    }
  }
  return {
    linear: result,
    p998: estimateMaxChannelPercentileSampled(result, width, height, 0.998, 256),
  };
}

function applySingleShotHdrExposureToLinear(baseLinear, baseP998, material, useRolloff) {
  const result = new Float32Array(baseLinear);
  const gain = Number.isFinite(material.exposureEv) ? Math.pow(2, material.exposureEv) : 1;
  if (gain !== 1) {
    if (useRolloff) {
      applyExposureAndRolloffInPlace(result, gain, baseP998);
    } else {
      applyLinearGainInPlace(result, gain);
    }
  }
  return result;
}

function computeAverageBrightnessFromLinear(sourceLinear) {
  const pixelCount = sourceLinear.length / 3;
  if (pixelCount <= 0) return 0;
  let brightnessSum = 0;
  for (let i = 0; i < sourceLinear.length; i += 3) {
    brightnessSum += toneLinearIntensity(sourceLinear[i], sourceLinear[i + 1], sourceLinear[i + 2]);
  }
  return brightnessSum / pixelCount;
}

function applyLinearGainInPlace(linear, gain) {
  if (!(Number.isFinite(gain) && gain > 0)) return;
  for (let i = 0; i < linear.length; i += 1) {
    linear[i] *= gain;
  }
}

function linearProPhotoArrayToHdr2FloatsAndBrightness(linear) {
  if (!(linear instanceof Float32Array)) {
    throw new Error("Expected a linear ProPhoto RGB Float32Array.");
  }
  const floats = new Float32Array(linear.length);
  let brightnessSum = 0;
  const pixelCount = linear.length / 3;
  for (let i = 0; i < linear.length; i += 3) {
    let r = linear[i];
    let g = linear[i + 1];
    let b = linear[i + 2];
    const sourceLuminance = toneLinearIntensity(r, g, b);
    if (sourceLuminance > 1e-12) {
      const targetLuminance = applySigmoidLinear(sourceLuminance, MULTI_SHOT_HDR2_SIGMOID_GAIN);
      const scale = targetLuminance / sourceLuminance;
      r *= scale;
      g *= scale;
      b *= scale;
    }
    r = Math.max(0, r);
    g = Math.max(0, g);
    b = Math.max(0, b);
    const maxChannel = Math.max(r, g, b);
    if (maxChannel > 1) {
      const fitScale = 1 / maxChannel;
      r *= fitScale;
      g *= fitScale;
      b *= fitScale;
    }
    brightnessSum += toneLinearIntensity(r, g, b);
    floats[i] = r;
    floats[i + 1] = g;
    floats[i + 2] = b;
  }
  return { floats, brightness: pixelCount > 0 ? brightnessSum / pixelCount : 0 };
}

function applyFinalStorageRolloffInPlace(linear, width, height) {
  if (!(linear instanceof Float32Array) || linear.length !== width * height * 3) return;
  let actualMax = 0;
  for (let i = 0; i + 2 < linear.length; i += 3) {
    actualMax = Math.max(actualMax, linear[i] ?? 0, linear[i + 1] ?? 0, linear[i + 2] ?? 0);
  }
  if (!(actualMax > 1)) return;
  const p998 = estimateMaxChannelPercentileSampled(linear, width, height, 0.998, 256);
  const rolloffBase = p998 > 1 ? p998 : actualMax;
  const rolloff = rolloffParams(rolloffBase, EXPOSURE_ROLLOFF_A, ROLLOFF_SAVING_LIMIT_FACTOR, 1);
  if (!rolloff) return;
  const adjusted = [0, 0, 0];
  for (let i = 0; i + 2 < linear.length; i += 3) {
    applyRolloffMaxChannelLinearRgbInto(
      linear[i] ?? 0,
      linear[i + 1] ?? 0,
      linear[i + 2] ?? 0,
      rolloff,
      adjusted,
    );
    linear[i] = adjusted[0];
    linear[i + 1] = adjusted[1];
    linear[i + 2] = adjusted[2];
  }
}

function encodeLinearToStoredGamma2(linear) {
  const stored = new Uint16Array(linear.length);
  for (let i = 0; i < linear.length; i += 1) {
    stored[i] = Math.round(Math.sqrt(clamp01(linear[i])) * RESULT_BUFFER_MAX_UINT16);
  }
  return stored;
}

function decodeStoredGamma2ToLinear(stored) {
  if (!(stored instanceof Uint16Array)) {
    throw new Error("Stored result buffer is not a Uint16 gamma-2 image.");
  }
  const linear = new Float32Array(stored.length);
  const inverseMax = 1 / RESULT_BUFFER_MAX_UINT16;
  for (let i = 0; i < stored.length; i += 1) {
    const encoded = stored[i] * inverseMax;
    linear[i] = Math.pow(encoded, RESULT_BUFFER_GAMMA);
  }
  return linear;
}

function finalizeStoredResult(source, width, height, outputColorSpace, applyFinalRolloff = false) {
  if (applyFinalRolloff) {
    applyFinalStorageRolloffInPlace(source, width, height);
  }
  const gamma2ProPhotoRgb16 = encodeLinearToStoredGamma2(source);
  return finalizeStoredGamma2Result(gamma2ProPhotoRgb16, width, height, outputColorSpace);
}

function finalizeStoredGamma2Result(gamma2ProPhotoRgb16, width, height, outputColorSpace) {
  if (!(gamma2ProPhotoRgb16 instanceof Uint16Array) || gamma2ProPhotoRgb16.length !== width * height * 3) {
    throw new Error("Stored gamma-2 result has an invalid Uint16 RGB buffer.");
  }
  setProgress(`Preparing ${formatColorSpaceName(outputColorSpace)} preview buffer...`);
  // Keep the full-resolution stack in its compact Uint16 gamma-2 representation.
  // Preview/analysis/rolloff only need sparse or downsampled reads, so decoding the
  // entire image to Float32 here would create a large temporary buffer that is
  // immediately discarded (about 275 MiB for a 24 MP RGB image).
  const preview = buildPreviewLinearProPhotoFromStoredGamma2ForTargetPixels(
    gamma2ProPhotoRgb16,
    width,
    height,
    PREVIEW_TARGET_PIXELS,
  );
  const analysis = buildPreviewLinearProPhotoFromStoredGamma2ForTargetPixels(
    gamma2ProPhotoRgb16,
    width,
    height,
    TONE_ANALYSIS_TARGET_PIXELS,
  );
  return {
    width,
    height,
    gamma2ProPhotoRgb16,
    previewLinearProPhotoRgb: preview.data,
    previewWidth: preview.width,
    previewHeight: preview.height,
    analysisLinearProPhotoRgb: analysis.data,
    previewRgba8: new Uint8ClampedArray(preview.width * preview.height * 4),
  };
}

let storedGamma2LinearLookup = null;

function getStoredGamma2LinearLookup() {
  if (storedGamma2LinearLookup) return storedGamma2LinearLookup;
  const lookup = new Float32Array(RESULT_BUFFER_MAX_UINT16 + 1);
  const inverseMax = 1 / RESULT_BUFFER_MAX_UINT16;
  for (let value = 0; value <= RESULT_BUFFER_MAX_UINT16; value += 1) {
    const encoded = value * inverseMax;
    // Match assignment into decodeStoredGamma2ToLinear()'s Float32Array so the
    // direct-sampling path remains numerically identical to the former full decode.
    lookup[value] = Math.pow(encoded, RESULT_BUFFER_GAMMA);
  }
  storedGamma2LinearLookup = lookup;
  return lookup;
}


function buildPreviewLinearProPhotoFromStoredGamma2ForTargetPixels(stored, width, height, targetPixels) {
  const scale = Math.min(1, Math.sqrt(targetPixels / Math.max(1, width * height)));
  const maxDimension = Math.max(1, Math.round(Math.max(width, height) * scale));
  return buildPreviewLinearProPhotoFromStoredGamma2(stored, width, height, maxDimension);
}

function buildPreviewLinearProPhotoFromStoredGamma2(stored, width, height, maxDimension) {
  const linearLookup = getStoredGamma2LinearLookup();
  const sourceMax = Math.max(width, height);
  if (!(sourceMax > maxDimension)) {
    const data = new Float32Array(stored.length);
    for (let i = 0; i < stored.length; i += 1) {
      data[i] = linearLookup[stored[i]];
    }
    return { data, width, height };
  }

  const scale = maxDimension / sourceMax;
  const previewWidth = Math.max(1, Math.round(width * scale));
  const previewHeight = Math.max(1, Math.round(height * scale));
  const previewData = new Float32Array(previewWidth * previewHeight * 3);
  const xScale = width / previewWidth;
  const yScale = height / previewHeight;

  for (let y = 0; y < previewHeight; y += 1) {
    const sourceY = (y + 0.5) * yScale - 0.5;
    const y0 = Math.max(0, Math.min(height - 1, Math.floor(sourceY)));
    const y1 = Math.min(height - 1, y0 + 1);
    const fy = Math.max(0, Math.min(1, sourceY - y0));
    for (let x = 0; x < previewWidth; x += 1) {
      const sourceX = (x + 0.5) * xScale - 0.5;
      const x0 = Math.max(0, Math.min(width - 1, Math.floor(sourceX)));
      const x1 = Math.min(width - 1, x0 + 1);
      const fx = Math.max(0, Math.min(1, sourceX - x0));
      const w00 = (1 - fx) * (1 - fy);
      const w10 = fx * (1 - fy);
      const w01 = (1 - fx) * fy;
      const w11 = fx * fy;
      const dst = (y * previewWidth + x) * 3;
      const s00 = (y0 * width + x0) * 3;
      const s10 = (y0 * width + x1) * 3;
      const s01 = (y1 * width + x0) * 3;
      const s11 = (y1 * width + x1) * 3;
      for (let channel = 0; channel < 3; channel += 1) {
        previewData[dst + channel] =
          linearLookup[stored[s00 + channel]] * w00 +
          linearLookup[stored[s10 + channel]] * w10 +
          linearLookup[stored[s01 + channel]] * w01 +
          linearLookup[stored[s11 + channel]] * w11;
      }
    }
  }

  return {
    data: previewData,
    width: previewWidth,
    height: previewHeight,
  };
}

function estimateMaxChannelPercentileSampled(source, width, height, q, maxSide) {
  const scale = Math.min(1, maxSide / Math.max(width, height));
  const sampleWidth = Math.max(1, Math.round(width * scale));
  const sampleHeight = Math.max(1, Math.round(height * scale));
  const maxima = new Float32Array(sampleWidth * sampleHeight);
  let targetIndex = 0;
  for (let y = 0; y < sampleHeight; y += 1) {
    const sourceY = Math.min(height - 1, Math.floor((y + 0.5) * height / sampleHeight));
    for (let x = 0; x < sampleWidth; x += 1) {
      const sourceX = Math.min(width - 1, Math.floor((x + 0.5) * width / sampleWidth));
      const sourceIndex = (sourceY * width + sourceX) * 3;
      maxima[targetIndex++] = Math.max(
        source[sourceIndex],
        source[sourceIndex + 1],
        source[sourceIndex + 2],
      );
    }
  }
  return percentileFromFloatArray(maxima, q);
}

function percentileFromFloatArray(values, q) {
  if (values.length === 0) return 0;
  const copy = Array.from(values);
  copy.sort((a, b) => a - b);
  const index = Math.min(copy.length - 1, Math.max(0, Math.floor((copy.length - 1) * q)));
  return copy[index];
}

async function linearAccumulatorToJpeg(accumulator, width, height, outputColorSpace) {
  const output = new Uint8ClampedArray(width * height * 4);

  for (let outputIndex = 0, sourceIndex = 0; outputIndex < output.length; outputIndex += 4, sourceIndex += 3) {
    const encoded = proPhotoLinearToEncodedOutput(
      accumulator[sourceIndex],
      accumulator[sourceIndex + 1],
      accumulator[sourceIndex + 2],
      outputColorSpace,
    );
    output[outputIndex] = encoded[0];
    output[outputIndex + 1] = encoded[1];
    output[outputIndex + 2] = encoded[2];
    output[outputIndex + 3] = 255;
  }

  const imageData = createColorManagedImageData(output, width, height, outputColorSpace);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  let context = canvas.getContext("2d", { colorSpace: outputColorSpace, willReadFrequently: false });
  if (!context) {
    context = canvas.getContext("2d");
  }
  if (!context) {
    throw new Error("Could not create a 2D canvas context for the JPEG preview.");
  }
  context.putImageData(imageData, 0, 0);
  return await canvasToImageBlob(canvas, "jpeg");
}

function linearAccumulatorToCanvas(accumulator, width, height, outputColorSpace) {
  const output = new Uint8ClampedArray(width * height * 4);
  const converted = new Float32Array(3);

  for (let outputIndex = 0, sourceIndex = 0; outputIndex < output.length; outputIndex += 4, sourceIndex += 3) {
    convertLinearProPhotoToOutputRgbInto(
      accumulator[sourceIndex],
      accumulator[sourceIndex + 1],
      accumulator[sourceIndex + 2],
      outputColorSpace,
      converted,
    );
    output[outputIndex] = linearToSrgbByteFast(converted[0]);
    output[outputIndex + 1] = linearToSrgbByteFast(converted[1]);
    output[outputIndex + 2] = linearToSrgbByteFast(converted[2]);
    output[outputIndex + 3] = 255;
  }

  const imageData = createColorManagedImageData(output, width, height, outputColorSpace);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = getCanvas2dContext(canvas, outputColorSpace, false);
  if (!context) {
    throw new Error("Could not create a 2D canvas context for the stacked image.");
  }
  context.putImageData(imageData, 0, 0);
  return canvas;
}

function buildOutputCanvas(
  accumulator,
  sourceWidth,
  sourceHeight,
  outputWidth,
  outputHeight,
  outputColorSpace,
  resized,
) {
  const sourceCanvas = linearAccumulatorToCanvas(
    accumulator,
    sourceWidth,
    sourceHeight,
    outputColorSpace,
  );
  if (!resized) return sourceCanvas;

  const outputCanvas = document.createElement("canvas");
  outputCanvas.width = outputWidth;
  outputCanvas.height = outputHeight;
  const context = getCanvas2dContext(outputCanvas, outputColorSpace, false);
  if (!context) {
    throw new Error("Could not create a 2D canvas context for resizing the stacked image.");
  }
  context.imageSmoothingEnabled = true;
  try {
    context.imageSmoothingQuality = "high";
  } catch {
    // Older canvas implementations may not expose imageSmoothingQuality.
  }
  context.drawImage(sourceCanvas, 0, 0, outputWidth, outputHeight);
  return outputCanvas;
}

function canvasToLinearProPhoto(canvas, outputColorSpace) {
  const context = getCanvas2dContext(canvas, outputColorSpace, true);
  if (!context) {
    throw new Error("Could not read the resized canvas.");
  }
  const imageData = getCanvasImageData(
    context,
    0,
    0,
    canvas.width,
    canvas.height,
    outputColorSpace,
  );
  const values = imageData.data;
  const linear = new Float32Array(canvas.width * canvas.height * 3);
  const convertRgb8 = createRgb8ToLinearProphotoConverter(outputColorSpace);
  const converted = new Float32Array(3);
  for (let sourceIndex = 0, targetIndex = 0; sourceIndex < values.length; sourceIndex += 4, targetIndex += 3) {
    convertRgb8(
      values[sourceIndex] ?? 0,
      values[sourceIndex + 1] ?? 0,
      values[sourceIndex + 2] ?? 0,
      converted,
    );
    linear[targetIndex] = converted[0];
    linear[targetIndex + 1] = converted[1];
    linear[targetIndex + 2] = converted[2];
  }
  return linear;
}

function resizeLinearProPhotoBilinear(source, sourceWidth, sourceHeight, outputWidth, outputHeight) {
  if (sourceWidth === outputWidth && sourceHeight === outputHeight) {
    return new Float32Array(source);
  }
  const output = new Float32Array(outputWidth * outputHeight * 3);
  const xScale = sourceWidth / outputWidth;
  const yScale = sourceHeight / outputHeight;

  for (let y = 0; y < outputHeight; y += 1) {
    const sourceY = (y + 0.5) * yScale - 0.5;
    const y0 = Math.max(0, Math.min(sourceHeight - 1, Math.floor(sourceY)));
    const y1 = Math.min(sourceHeight - 1, y0 + 1);
    const fy = Math.max(0, Math.min(1, sourceY - y0));
    for (let x = 0; x < outputWidth; x += 1) {
      const sourceX = (x + 0.5) * xScale - 0.5;
      const x0 = Math.max(0, Math.min(sourceWidth - 1, Math.floor(sourceX)));
      const x1 = Math.min(sourceWidth - 1, x0 + 1);
      const fx = Math.max(0, Math.min(1, sourceX - x0));
      const w00 = (1 - fx) * (1 - fy);
      const w10 = fx * (1 - fy);
      const w01 = (1 - fx) * fy;
      const w11 = fx * fy;
      const dst = (y * outputWidth + x) * 3;
      const s00 = (y0 * sourceWidth + x0) * 3;
      const s10 = (y0 * sourceWidth + x1) * 3;
      const s01 = (y1 * sourceWidth + x0) * 3;
      const s11 = (y1 * sourceWidth + x1) * 3;
      output[dst] = source[s00] * w00 + source[s10] * w10 + source[s01] * w01 + source[s11] * w11;
      output[dst + 1] = source[s00 + 1] * w00 + source[s10 + 1] * w10 + source[s01 + 1] * w01 + source[s11 + 1] * w11;
      output[dst + 2] = source[s00 + 2] * w00 + source[s10 + 2] * w10 + source[s01 + 2] * w01 + source[s11 + 2] * w11;
    }
  }

  return output;
}

function createColorManagedImageData(data, width, height, outputColorSpace) {
  try {
    return new ImageData(data, width, height, { colorSpace: outputColorSpace });
  } catch {
    return new ImageData(data, width, height);
  }
}

function proPhotoLinearToEncodedOutput(r, g, b, outputColorSpace) {
  const converted = new Float32Array(3);
  convertLinearProPhotoToOutputRgbInto(r, g, b, outputColorSpace, converted);
  return [
    linearToSrgbByteFast(converted[0]),
    linearToSrgbByteFast(converted[1]),
    linearToSrgbByteFast(converted[2]),
  ];
}

async function extractInputInfo(file) {
  const lowerName = file.name.toLowerCase();
  if (isRawImageFile(file.name, file.type)) {
    return await readRawInputInfo(file);
  }

  const buffer = await file.arrayBuffer();
  const { extractWhitelistedMetadataFromBuffer } = await loadExifMetadataModule();
  const preservedMetadata = extractWhitelistedMetadataFromBuffer(buffer);
  const iccProfile = await extractEmbeddedIccProfile(lowerName, buffer);
  const sourceColorSpace = classifyIccProfile(iccProfile);

  if (isTiffFile(lowerName, file.type)) {
    const tiffInfo = await parseTiffInfo(buffer, preservedMetadata);
    return {
      fNumber: tiffInfo.fNumber,
      exposureTime: tiffInfo.exposureTime,
      iso: tiffInfo.iso,
      exposureScalar: tiffInfo.exposureScalar,
      sourceColorSpace,
      isRaw: false,
      width: tiffInfo.width,
      height: tiffInfo.height,
      preservedMetadata,
    };
  }

  const dimensions = await readBitmapDimensions(file);

  if (/^image\/jpe?g$/i.test(file.type) || /\.(jpe?g)$/i.test(lowerName)) {
    const exif = parseJpegExif(buffer);
    const fNumber = positiveNumberOrNull(preservedMetadata?.fNumber) ?? exif.fNumber;
    const exposureTime = positiveNumberOrNull(preservedMetadata?.exposureTime) ?? exif.exposureTime;
    const iso = positiveNumberOrNull(preservedMetadata?.iso) ?? exif.iso;
    const normalizedIso = Number.isFinite(iso) && iso > 0 ? iso : 100;
    const exposureScalar =
      Number.isFinite(exposureTime) && exposureTime > 0 && Number.isFinite(fNumber) && fNumber > 0
        ? (exposureTime * normalizedIso) / (fNumber * fNumber * 100)
        : exif.exposureScalar;
    return {
      fNumber,
      exposureTime,
      iso,
      exposureScalar,
      sourceColorSpace,
      isRaw: false,
      width: dimensions.width,
      height: dimensions.height,
      preservedMetadata,
    };
  }

  const fNumber = positiveNumberOrNull(preservedMetadata?.fNumber);
  const exposureTime = positiveNumberOrNull(preservedMetadata?.exposureTime);
  const iso = positiveNumberOrNull(preservedMetadata?.iso);
  const exposureScalar = exposureTime && fNumber
    ? (exposureTime * (iso || 100)) / (fNumber * fNumber * 100)
    : null;
  return {
    fNumber,
    exposureTime,
    iso,
    exposureScalar,
    sourceColorSpace,
    isRaw: false,
    width: dimensions.width,
    height: dimensions.height,
    preservedMetadata,
  };
}

async function readRawInputInfo(file) {
  let raw = null;
  let workerFailure = null;
  try {
    raw = await createLibRawInstance();
    workerFailure = createLibRawWorkerFailure(raw);
    const rawBuffer = await file.arrayBuffer();
    const { extractWhitelistedMetadataFromBuffer, extractWhitelistedMetadataFromLibRaw } = await loadExifMetadataModule();
    const embeddedMetadata = extractWhitelistedMetadataFromBuffer(rawBuffer);
    await Promise.race([
      raw.open(new Uint8Array(rawBuffer)),
      workerFailure.promise,
    ]);
    const metadata = await Promise.race([raw.metadata(true), workerFailure.promise]);
    const rawPreservedMetadata = extractWhitelistedMetadataFromLibRaw(metadata);
    const preservedMetadata = embeddedMetadata
      ? { ...rawPreservedMetadata, ...embeddedMetadata, gps: embeddedMetadata.gps ?? rawPreservedMetadata?.gps }
      : rawPreservedMetadata;
    const exposureTime =
      positiveNumberOrNull(metadata?.shutter) ?? positiveNumberOrNull(preservedMetadata?.exposureTime);
    const fNumber =
      positiveNumberOrNull(metadata?.aperture) ?? positiveNumberOrNull(preservedMetadata?.fNumber);
    const iso =
      positiveNumberOrNull(metadata?.iso_speed) ?? positiveNumberOrNull(preservedMetadata?.iso);
    const exposureScalar = exposureTime && fNumber
      ? (exposureTime * (iso || 100)) / (fNumber * fNumber * 100)
      : null;
    let dimensions = rawMetadataImageDimensions(metadata);
    if (!dimensions) {
      const image = await Promise.race([raw.imageData(), workerFailure.promise]);
      const width = Math.round(Number(image?.width) || 0);
      const height = Math.round(Number(image?.height) || 0);
      if (width > 0 && height > 0) dimensions = { width, height };
    }
    if (!dimensions) {
      throw new Error("RAW dimensions are unavailable");
    }
    const sourceWidth = dimensions.width;
    const sourceHeight = dimensions.height;
    const outputCrop = rawInsetOutputCropFromMetadata(metadata, sourceWidth, sourceHeight);
    const lensfunFrame = outputCrop ?? { left: 0, top: 0, width: sourceWidth, height: sourceHeight };
    const lensMetadata = rawLensMetadata(metadata);
    const lensCorrection = lensMetadata
      ? await buildRawLensfunCorrection(lensMetadata, lensfunFrame.width, lensfunFrame.height)
      : undefined;
    const outputRegion = lensfunOutputRegion(lensCorrection, lensfunFrame.width, lensfunFrame.height);
    dimensions = {
      width: Math.max(1, Math.round(outputRegion.width)),
      height: Math.max(1, Math.round(outputRegion.height)),
    };
    return {
      fNumber,
      exposureTime,
      iso,
      exposureScalar,
      sourceColorSpace: "prophoto-rgb",
      isRaw: true,
      lensMetadata,
      lensCorrection,
      width: dimensions.width,
      height: dimensions.height,
      preservedMetadata,
    };
  } catch (error) {
    const detail = error instanceof Error ? `: ${error.message}` : "";
    throw new Error(`Failed to read RAW metadata from ${file.name}${detail}`);
  } finally {
    workerFailure?.cleanup?.();
    raw?.dispose?.();
  }
}

function rawMetadataImageDimensions(metadata) {
  if (!metadata || typeof metadata !== "object") return null;
  const candidates = [
    [metadata.width, metadata.height],
    [metadata.iwidth, metadata.iheight],
    [metadata.raw_width, metadata.raw_height],
    [metadata.rawWidth, metadata.rawHeight],
    [metadata.sizes?.width, metadata.sizes?.height],
    [metadata.sizes?.iwidth, metadata.sizes?.iheight],
    [metadata.sizes?.raw_width, metadata.sizes?.raw_height],
  ];
  for (const [rawWidth, rawHeight] of candidates) {
    const width = Math.round(Number(rawWidth) || 0);
    const height = Math.round(Number(rawHeight) || 0);
    if (width > 0 && height > 0) return { width, height };
  }
  return null;
}

function rawMetadataNonnegativeInteger(value) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? Math.round(number) : null;
}

function rawMetadataPositiveInteger(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.round(number) : null;
}

function rawInsetOutputCropFromMetadata(metadata, sourceWidth, sourceHeight) {
  if (!metadata || sourceWidth <= 0 || sourceHeight <= 0) return null;
  const sourceCrops = Array.isArray(metadata.raw_inset_crops) ? metadata.raw_inset_crops : [];
  const crop = sourceCrops[0];
  if (!crop) return null;

  const insetLeft = rawMetadataNonnegativeInteger(crop.cleft);
  const insetTop = rawMetadataNonnegativeInteger(crop.ctop);
  const insetWidth = rawMetadataPositiveInteger(crop.cwidth);
  const insetHeight = rawMetadataPositiveInteger(crop.cheight);
  if (
    insetLeft === null
    || insetTop === null
    || insetWidth === null
    || insetHeight === null
    || insetLeft >= 0xffff
    || insetTop >= 0xffff
  ) {
    return null;
  }

  const rawWidth = rawMetadataPositiveInteger(metadata.raw_width);
  const rawHeight = rawMetadataPositiveInteger(metadata.raw_height);
  const visibleWidth = rawMetadataPositiveInteger(metadata.width);
  const visibleHeight = rawMetadataPositiveInteger(metadata.height);
  const leftMargin = rawMetadataNonnegativeInteger(metadata.left_margin) ?? 0;
  const topMargin = rawMetadataNonnegativeInteger(metadata.top_margin) ?? 0;

  const fits = (left, top) => {
    if (left < 0 || top < 0) return null;
    if (left + insetWidth > sourceWidth || top + insetHeight > sourceHeight) return null;
    if (left === 0 && top === 0 && insetWidth === sourceWidth && insetHeight === sourceHeight) return null;
    return { left, top, width: insetWidth, height: insetHeight };
  };

  if (rawWidth === sourceWidth && rawHeight === sourceHeight) {
    return fits(insetLeft, insetTop);
  }
  if (visibleWidth === sourceWidth && visibleHeight === sourceHeight) {
    return fits(insetLeft - leftMargin, insetTop - topMargin);
  }
  return fits(insetLeft, insetTop)
    ?? fits(insetLeft - leftMargin, insetTop - topMargin);
}

function positiveNumberOrNull(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}

function rawMetadataString(value) {
  return typeof value === "string" ? value.trim() : "";
}

function rawMetadataPositiveNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : undefined;
}

function rawLensMetadata(metadata) {
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

async function extractEmbeddedIccProfile(lowerName, buffer) {
  if (isTiffFile(lowerName, "")) {
    const tiffInfo = await parseTiffInfo(buffer);
    return tiffInfo.iccProfile;
  }
  if (isJpegBuffer(buffer)) {
    return parseJpegIccProfile(buffer);
  }
  if (isPngBuffer(buffer)) {
    return await parsePngIccProfile(buffer);
  }
  if (isWebPBuffer(buffer)) {
    return parseWebPIccProfile(buffer);
  }
  return null;
}

function getTiffIfdDimensions(ifd) {
  const width = Math.max(0, Math.round(
    Number(ifd?.width) || Number(ifd?.t256?.[0]) || 0,
  ));
  const height = Math.max(0, Math.round(
    Number(ifd?.height) || Number(ifd?.t257?.[0]) || 0,
  ));
  return { width, height };
}

async function parseTiffInfo(buffer, preservedMetadata = null) {
  const ifds = UTIF.decode(buffer);
  if (!ifds || ifds.length === 0) {
    return {
      fNumber: null,
      exposureTime: null,
      iso: null,
      exposureScalar: null,
      iccProfile: null,
      width: 0,
      height: 0,
    };
  }
  const ifd = ifds[0];
  const dimensions = getTiffIfdDimensions(ifd);
  const iccProfile = getTiffTagBytes(ifd, 34675);
  const exposureTime =
    positiveNumberOrNull(preservedMetadata?.exposureTime) ?? getFirstNumericTagValue(ifd, [33434]);
  const fNumber =
    positiveNumberOrNull(preservedMetadata?.fNumber) ?? getFirstNumericTagValue(ifd, [33437]);
  const iso =
    positiveNumberOrNull(preservedMetadata?.iso) ?? getFirstNumericTagValue(ifd, [34855]);
  const normalizedIso = Number.isFinite(iso) && iso > 0 ? iso : 100;
  const exposureScalar =
    Number.isFinite(exposureTime) && exposureTime > 0 && Number.isFinite(fNumber) && fNumber > 0
      ? (exposureTime * normalizedIso) / (fNumber * fNumber * 100)
      : null;
  return {
    fNumber,
    exposureTime,
    iso,
    exposureScalar,
    iccProfile,
    width: dimensions.width,
    height: dimensions.height,
  };
}

async function readBitmapDimensions(file) {
  let bitmap = null;
  try {
    bitmap = await createImageBitmap(file, {
      imageOrientation: "from-image",
      colorSpaceConversion: "none",
    });
    return { width: bitmap.width, height: bitmap.height };
  } catch (error) {
    const detail = error instanceof Error ? `: ${error.message}` : "";
    throw new Error(`Failed to read image dimensions from ${file.name}${detail}`);
  } finally {
    bitmap?.close?.();
  }
}

function getTiffTagBytes(ifd, tagNumber) {
  const value = ifd[`t${tagNumber}`];
  if (!value) return null;
  if (value instanceof Float32Array) return value;
  if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength));
  if (Array.isArray(value)) return Uint8Array.from(value);
  return null;
}

function getFirstNumericTagValue(ifd, tagNumbers) {
  for (const tagNumber of tagNumbers) {
    const raw = ifd[`t${tagNumber}`];
    const value = normalizeExifNumber(raw);
    if (Number.isFinite(value)) return value;
  }
  return null;
}

function normalizeExifNumber(raw) {
  if (raw == null) return null;
  if (typeof raw === "number") return raw;
  if (Array.isArray(raw)) return normalizeExifNumber(raw[0]);
  if (ArrayBuffer.isView(raw)) return raw.length > 0 ? normalizeExifNumber(raw[0]) : null;
  if (typeof raw === "object") {
    if (typeof raw.numerator === "number" && typeof raw.denominator === "number" && raw.denominator !== 0) {
      return raw.numerator / raw.denominator;
    }
    if (typeof raw.num === "number" && typeof raw.den === "number" && raw.den !== 0) {
      return raw.num / raw.den;
    }
    if (typeof raw.value === "number") return raw.value;
  }
  return null;
}

function parseJpegIccProfile(buffer) {
  const view = new DataView(buffer);
  if (view.byteLength < 4 || view.getUint16(0, false) !== 0xffd8) return null;
  let offset = 2;
  const chunks = [];

  while (offset + 4 <= view.byteLength) {
    if (view.getUint8(offset) !== 0xff) break;
    const marker = view.getUint8(offset + 1);
    offset += 2;
    if (marker === 0xd9 || marker === 0xda) break;
    if (offset + 2 > view.byteLength) break;
    const segmentLength = view.getUint16(offset, false);
    if (segmentLength < 2 || offset + segmentLength > view.byteLength) break;
    const segmentStart = offset + 2;
    const segmentDataLength = segmentLength - 2;

    if (marker === 0xe2 && segmentDataLength >= 14) {
      const label = readAscii(view, segmentStart, 12);
      if (label === "ICC_PROFILE\u0000") {
        const sequence = view.getUint8(segmentStart + 12);
        const payload = new Uint8Array(buffer, segmentStart + 14, segmentDataLength - 14);
        chunks.push({ sequence, payload: new Uint8Array(payload) });
      }
    }

    offset += segmentLength;
  }

  if (chunks.length === 0) return null;
  chunks.sort((a, b) => a.sequence - b.sequence);
  let totalLength = 0;
  for (const chunk of chunks) totalLength += chunk.payload.length;
  const profile = new Uint8Array(totalLength);
  let position = 0;
  for (const chunk of chunks) {
    profile.set(chunk.payload, position);
    position += chunk.payload.length;
  }
  return profile;
}

async function parsePngIccProfile(buffer) {
  const view = new DataView(buffer);
  if (!isPngBuffer(buffer)) return null;
  let offset = 8;
  while (offset + 12 <= view.byteLength) {
    const length = view.getUint32(offset, false);
    const type = readAscii(view, offset + 4, 4);
    const dataOffset = offset + 8;
    if (dataOffset + length + 4 > view.byteLength) break;
    if (type === "iCCP") {
      const bytes = new Uint8Array(buffer, dataOffset, length);
      let cursor = 0;
      while (cursor < bytes.length && bytes[cursor] !== 0) cursor += 1;
      if (cursor + 2 > bytes.length) return null;
      const compressionMethod = bytes[cursor + 1];
      if (compressionMethod !== 0) return null;
      const compressed = bytes.subarray(cursor + 2);
      return await inflateZlibBytes(compressed);
    }
    offset = dataOffset + length + 4;
  }
  return null;
}

function parseWebPIccProfile(buffer) {
  const view = new DataView(buffer);
  if (!isWebPBuffer(buffer)) return null;
  let offset = 12;
  while (offset + 8 <= view.byteLength) {
    const type = readAscii(view, offset, 4);
    const length = view.getUint32(offset + 4, true);
    const dataOffset = offset + 8;
    if (dataOffset + length > view.byteLength) break;
    if (type === "ICCP") {
      return new Uint8Array(buffer.slice(dataOffset, dataOffset + length));
    }
    offset = dataOffset + length + (length % 2);
  }
  return null;
}

async function inflateZlibBytes(bytes) {
  if (typeof DecompressionStream !== "function") return null;
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("deflate"));
  const arrayBuffer = await new Response(stream).arrayBuffer();
  return new Uint8Array(arrayBuffer);
}

function classifyIccProfile(iccProfile) {
  if (!iccProfile || iccProfile.length === 0) {
    return "srgb";
  }
  const text = iccBytesToSearchText(iccProfile);
  if (text.includes("display p3") || text.includes("displayp3") || text.includes("dci-p3")) {
    return "display-p3";
  }
  if (text.includes("prophoto") || text.includes("romm rgb") || text.includes("rommrgb")) {
    return "prophoto-rgb";
  }
  if (text.includes("adobe rgb") || text.includes("adobergb")) {
    return "adobe-rgb";
  }
  if (text.includes("srgb") || text.includes("iec61966-2.1") || text.includes("iec 61966-2.1")) {
    return "srgb";
  }
  if (text.includes("p3")) {
    return "display-p3";
  }
  return "srgb";
}

function iccBytesToSearchText(bytes) {
  let text = "";
  for (let i = 0; i < bytes.length; i += 1) {
    const value = bytes[i];
    if (value >= 32 && value <= 126) {
      text += String.fromCharCode(value);
    }
  }
  return text.toLowerCase();
}

async function ensureCanonicalSession(files, inputInfos, existingSession, requireToneStatistics = false) {
  const signature = canonicalFilesSignature(files);
  if (
    existingSession &&
    existingSession.filesSignature === signature &&
    existingSession.images?.length === files.length &&
    existingSession.images.every((image) => (
      image?.complete
      && (
        !requireToneStatistics
        || (
          Number.isInteger(image?.toneStatistics?.sampleCount)
          && image.toneStatistics.sampleCount > 0
          && Number.isFinite(image.toneStatistics.mean)
          && Number.isFinite(image.toneStatistics.p50)
          && Number.isFinite(image.toneStatistics.p95)
        )
      )
    ))
  ) {
    return existingSession;
  }

  if (existingSession) {
    try { await deleteCanonicalSession(existingSession); } catch {}
  }
  await estimateCanonicalCapacity(files, inputInfos);
  const session = await createCanonicalSession(files, inputInfos);
  try {
    for (let index = 0; index < files.length; index += 1) {
      const file = files[index];
      const inputInfo = inputInfos[index];
      setProgress(`${inputInfo.isRaw ? "Developing RAW" : "Reading image"} ${index + 1}/${files.length} for canonical cache...`);
      const decoded = await decodeFileToDecodedImage(file, inputInfo);
      if (decoded?.canonicalStoredRgb16 instanceof Uint16Array) {
        await writeCanonicalStoredImage(
          session,
          index,
          file,
          inputInfo,
          decoded.width,
          decoded.height,
          decoded.canonicalStoredRgb16,
          (message) => setProgress(message),
        );
      } else {
        const linear = decodedImageToLinearProPhoto(decoded);
        await writeCanonicalLinearImage(
          session,
          index,
          file,
          inputInfo,
          decoded.width,
          decoded.height,
          linear,
          (message) => setProgress(message),
        );
      }
      await yieldToBrowser();
    }
    await completeCanonicalSession(session);
    return session;
  } catch (error) {
    try { await deleteCanonicalSession(session); } catch {}
    throw error;
  }
}

function decodedImageToLinearProPhoto(decoded) {
  if (decoded?.linearProPhotoRgb instanceof Float32Array) {
    return decoded.linearProPhotoRgb;
  }
  const imageData = decoded?.imageData || decoded?.alignmentImageData;
  if (!imageData?.data) throw new Error("Decoded image does not contain pixel data for canonical conversion.");
  const pixelCount = decoded.width * decoded.height;
  const output = new Float32Array(pixelCount * 3);
  const convert = createRgb8ToLinearProphotoConverter(decoded.sourceColorSpace || "srgb");
  const converted = new Float32Array(3);
  for (let pixel = 0; pixel < pixelCount; pixel += 1) {
    const source = pixel * 4;
    const target = pixel * 3;
    convert(imageData.data[source], imageData.data[source + 1], imageData.data[source + 2], converted);
    output[target] = converted[0];
    output[target + 1] = converted[1];
    output[target + 2] = converted[2];
  }
  return output;
}

function chooseOutputColorSpace(inputInfos) {
  return inputInfos.some((info) => info.sourceColorSpace !== "srgb") ? "display-p3" : "srgb";
}

function transformLinearProPhotoForAlignment(
  cv,
  linearProPhotoRgb,
  sourceWidth,
  sourceHeight,
  targetWidth,
  targetHeight,
  alignmentMode,
) {
  const expectedSourceLength = sourceWidth * sourceHeight * 3;
  if (!(linearProPhotoRgb instanceof Float32Array) || linearProPhotoRgb.length !== expectedSourceLength) {
    throw new Error(
      `Linear ProPhoto buffer size ${linearProPhotoRgb?.length ?? 0} does not match source dimensions ${sourceWidth}x${sourceHeight}.`,
    );
  }

  if (alignmentMode === "center-crop") {
    if (targetWidth > sourceWidth || targetHeight > sourceHeight) {
      throw new Error(
        `Center crop target ${targetWidth}x${targetHeight} is larger than source ${sourceWidth}x${sourceHeight}.`,
      );
    }
    const cropX = Math.floor((sourceWidth - targetWidth) / 2);
    const cropY = Math.floor((sourceHeight - targetHeight) / 2);
    const output = new Float32Array(targetWidth * targetHeight * 3);
    const sourceRowLength = sourceWidth * 3;
    const targetRowLength = targetWidth * 3;
    const sourceCropOffset = cropX * 3;
    for (let y = 0; y < targetHeight; y += 1) {
      const sourceStart = (cropY + y) * sourceRowLength + sourceCropOffset;
      const targetStart = y * targetRowLength;
      output.set(
        linearProPhotoRgb.subarray(sourceStart, sourceStart + targetRowLength),
        targetStart,
      );
    }
    return output;
  }

  if (alignmentMode === "center-fill" || alignmentMode === "top-left-fill") {
    if (sourceWidth > targetWidth || sourceHeight > targetHeight) {
      throw new Error(
        `${formatAlignmentModeName(alignmentMode)} target ${targetWidth}x${targetHeight} is smaller than source ${sourceWidth}x${sourceHeight}.`,
      );
    }
    const output = new Float32Array(targetWidth * targetHeight * 3);
    output.fill(CENTER_FILL_GRAY_LINEAR);
    const dx = alignmentMode === "center-fill"
      ? Math.floor((targetWidth - sourceWidth) / 2)
      : 0;
    const dy = alignmentMode === "center-fill"
      ? Math.floor((targetHeight - sourceHeight) / 2)
      : 0;
    const sourceRowLength = sourceWidth * 3;
    for (let y = 0; y < sourceHeight; y += 1) {
      const sourceStart = y * sourceRowLength;
      const targetStart = ((dy + y) * targetWidth + dx) * 3;
      output.set(linearProPhotoRgb.subarray(sourceStart, sourceStart + sourceRowLength), targetStart);
    }
    return output;
  }

  const sourceMat = matFromLinearProPhoto(cv, linearProPhotoRgb, sourceWidth, sourceHeight);
  let resized = null;
  let roi = null;
  let transformed = null;
  try {
    if (alignmentMode === "center-fit") {
      const scale = Math.max(targetWidth / sourceWidth, targetHeight / sourceHeight);
      const resizedWidth = Math.max(targetWidth, Math.round(sourceWidth * scale));
      const resizedHeight = Math.max(targetHeight, Math.round(sourceHeight * scale));
      resized = new cv.Mat();
      cv.resize(
        sourceMat,
        resized,
        new cv.Size(resizedWidth, resizedHeight),
        0,
        0,
        cv.INTER_LINEAR,
      );
      const cropX = Math.floor((resizedWidth - targetWidth) / 2);
      const cropY = Math.floor((resizedHeight - targetHeight) / 2);
      roi = resized.roi(new cv.Rect(cropX, cropY, targetWidth, targetHeight));
      transformed = roi.clone();
    } else {
      throw new Error(`Unsupported alignment mode: ${alignmentMode}`);
    }

    const output = new Float32Array(targetWidth * targetHeight * 3);
    output.set(transformed.data32F);
    return output;
  } finally {
    if (transformed) transformed.delete();
    if (roi) roi.delete();
    if (resized) resized.delete();
    sourceMat.delete();
  }
}

async function decodeFileToDecodedImage(file, inputInfo) {
  const lowerName = file.name.toLowerCase();
  const isRawInput = isRawImageFile(file.name, file.type);
  if (isRawInput) {
    return await decodeRawFileToDecodedImage(
      file,
      inputInfo?.lensMetadata || null,
      inputInfo?.lensCorrection || null,
    );
  }
  if (inputInfo.isRaw) {
    // Metadata classification must never send a RAW file through the browser
    // image decoder. Keep this fallback explicit in case MIME/extension
    // handling changes later.
    return await decodeRawFileToDecodedImage(
      file,
      inputInfo?.lensMetadata || null,
      inputInfo?.lensCorrection || null,
    );
  }

  if (isTiffFile(lowerName, file.type)) {
    const buffer = await file.arrayBuffer();
        const ifds = UTIF.decode(buffer);
    if (!ifds || ifds.length === 0) {
      throw new Error(`Failed to parse TIFF structure from ${file.name}.`);
    }
    const ifd = ifds[0];
    UTIF.decodeImage(buffer, ifd);
    const dimensions = getTiffIfdDimensions(ifd);
    if (!(dimensions.width > 0 && dimensions.height > 0)) {
      throw new Error(`Could not determine TIFF dimensions for ${file.name}.`);
    }

    const linearProPhotoRgb = decodeTiff16RgbToLinearProPhoto(
      buffer,
      ifd,
      inputInfo.sourceColorSpace,
    );
    if (linearProPhotoRgb) {
      const alignmentImageData = linearProPhotoToAlignmentImageData(
        linearProPhotoRgb,
        dimensions.width,
        dimensions.height,
      );
      return {
        width: dimensions.width,
        height: dimensions.height,
        sourceColorSpace: "prophoto-rgb",
        linearProPhotoRgb,
        alignmentImageData,
      };
    }

    const rgbaBytes = UTIF.toRGBA8(ifd);
    const imageData = new ImageData(
      new Uint8ClampedArray(rgbaBytes),
      dimensions.width,
      dimensions.height,
    );
    return {
      imageData,
      sourceColorSpace: inputInfo.sourceColorSpace,
      width: dimensions.width,
      height: dimensions.height,
    };
  }

  let bitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: "from-image", colorSpaceConversion: "none" });
  } catch (error) {
    const detail = error instanceof Error ? `: ${error.message}` : "";
    throw new Error(`Failed to decode ${file.name}${detail}`);
  }

  try {
    const canvas = document.createElement("canvas");
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) throw new Error("Could not create a 2D canvas context.");
    context.drawImage(bitmap, 0, 0);
    return {
      imageData: context.getImageData(0, 0, bitmap.width, bitmap.height),
      sourceColorSpace: inputInfo.sourceColorSpace,
      width: bitmap.width,
      height: bitmap.height,
    };
  } finally {
    bitmap.close();
  }
}

function decodeTiff16RgbToLinearProPhoto(buffer, ifd, sourceColorSpace) {
  const bitsPerSample = Array.isArray(ifd?.t258) ? ifd.t258 : [];
  const samplesPerPixel = Number(ifd?.t277?.[0] ?? bitsPerSample.length);
  const photometric = Number(ifd?.t262?.[0] ?? -1);
  const planarConfiguration = Number(ifd?.t284?.[0] ?? 1);
  const sampleFormat = Array.isArray(ifd?.t339) && ifd.t339.length > 0 ? ifd.t339 : [1];

  if (
    photometric !== 2 ||
    planarConfiguration !== 1 ||
    samplesPerPixel < 3 ||
    bitsPerSample.length < 3 ||
    bitsPerSample[0] !== 16 ||
    bitsPerSample[1] !== 16 ||
    bitsPerSample[2] !== 16 ||
    sampleFormat.some((value) => Number(value) !== 1)
  ) {
    return null;
  }

  const { width, height } = getTiffIfdDimensions(ifd);
  if (!(width > 0 && height > 0)) return null;

  const raw = tiffDecodedByteView(ifd.data);
  const bytesPerPixel = samplesPerPixel * 2;
  const expectedLength = width * height * bytesPerPixel;
  if (!raw || raw.byteLength < expectedLength) return null;

  const fileBytes = new Uint8Array(buffer, 0, Math.min(2, buffer.byteLength));
  const littleEndian = fileBytes.length >= 2 && fileBytes[0] === 0x49 && fileBytes[1] === 0x49;
  const bigEndian = fileBytes.length >= 2 && fileBytes[0] === 0x4d && fileBytes[1] === 0x4d;
  if (!littleEndian && !bigEndian) return null;

  const view = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
  const linear = new Float32Array(width * height * 3);
  const converted = new Float32Array(3);
  let sourceOffset = 0;
  let outputOffset = 0;
  for (let pixel = 0; pixel < width * height; pixel += 1) {
    const er = view.getUint16(sourceOffset, littleEndian) / 65535;
    const eg = view.getUint16(sourceOffset + 2, littleEndian) / 65535;
    const eb = view.getUint16(sourceOffset + 4, littleEndian) / 65535;
    sourceOffset += bytesPerPixel;

    encodedRgbToLinearProphotoInto(er, eg, eb, sourceColorSpace, converted);
    linear[outputOffset] = converted[0];
    linear[outputOffset + 1] = converted[1];
    linear[outputOffset + 2] = converted[2];
    outputOffset += 3;
  }
  return linear;
}

function tiffDecodedByteView(data) {
  if (data instanceof Float32Array) return data;
  if (ArrayBuffer.isView(data)) {
    return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  }
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  return null;
}

async function decodeRawFileToDecodedImage(file, knownLensMetadata = null, knownLensCorrection = null) {
  let raw = null;
  let workerFailure = null;
  try {
    raw = await createLibRawInstance();
    workerFailure = createLibRawWorkerFailure(raw);
    await Promise.race([
      raw.open(new Uint8Array(await file.arrayBuffer()), RAW_DECODE_SETTINGS),
      workerFailure.promise,
    ]);

    let metadata = null;
    try {
      metadata = await Promise.race([raw.metadata(true), workerFailure.promise]);
    } catch {
      metadata = null;
    }
    const lensMetadata = knownLensMetadata ?? rawLensMetadata(metadata);

    const image = await Promise.race([raw.imageData(), workerFailure.promise]);
    if (!image || !image.width || !image.height || !image.data) {
      throw new Error("RAW decode failed");
    }
    const outputCrop = rawInsetOutputCropFromMetadata(metadata, image.width, image.height);
    const lensfunFrame = outputCrop ?? { left: 0, top: 0, width: image.width, height: image.height };
    const sourceRgb16 = libRawImageDataToLinearRgb16(image);
    let correction = knownLensCorrection;
    if (!correction && lensMetadata) {
      try {
        correction = await buildRawLensfunCorrection(lensMetadata, lensfunFrame.width, lensfunFrame.height);
      } catch {
        correction = null;
      }
    }

    let corrected;
    try {
      setProgress(correction ? "Correcting lens with LensFun..." : "Applying RAW image crop...");
      corrected = await runLensfunCorrectionPool({
        source: {
          data: sourceRgb16,
          width: image.width,
          height: image.height,
          linearRangeMax: 1,
          transfer: "linear",
        },
        correction,
        outputCrop,
        onProgress: (progress) => setProgress(
          correction
            ? `Correcting lens with LensFun... ${Math.round(progress * 100)}%`
            : `Applying RAW image crop... ${Math.round(progress * 100)}%`,
        ),
      });

    } catch {
      corrected = await runLensfunCorrectionPool({
        source: {
          data: sourceRgb16,
          width: image.width,
          height: image.height,
          linearRangeMax: 1,
          transfer: "linear",
        },
        correction: null,
        outputCrop,
        onProgress: (progress) => setProgress(`Applying RAW image crop... ${Math.round(progress * 100)}%`),
      });
    }

    return {
      width: corrected.width,
      height: corrected.height,
      sourceColorSpace: "prophoto-rgb",
      canonicalStoredRgb16: corrected.data,
    };
  } catch (error) {
    const detail = error instanceof Error ? `: ${error.message}` : "";
    throw new Error(`Failed to develop RAW image ${file.name}${detail}`);
  } finally {
    workerFailure?.cleanup?.();
    raw?.dispose?.();
  }
}

function libRawImageDataToLinearRgb16(image) {
  const width = Math.max(1, Math.round(Number(image.width) || 0));
  const height = Math.max(1, Math.round(Number(image.height) || 0));
  const colors = Math.max(1, Math.round(Number(image.colors) || 3));
  const bits = Math.max(1, Math.min(16, Math.round(Number(image.bits) || 16)));
  const pixelCount = width * height;
  const source = image.data;
  if (!source || source.length < pixelCount * colors) {
    throw new Error("LibRaw returned an incomplete image buffer.");
  }
  const maxSample = bits >= 16 ? 65535 : Math.pow(2, bits) - 1;
  const scale = maxSample > 0 ? 65535 / maxSample : 1;
  const stored = new Uint16Array(pixelCount * 3);
  for (let pixelIndex = 0; pixelIndex < pixelCount; pixelIndex += 1) {
    const sourceIndex = pixelIndex * colors;
    const destinationIndex = pixelIndex * 3;
    const r = Number(source[sourceIndex] ?? 0);
    const g = Number(source[sourceIndex + (colors >= 2 ? 1 : 0)] ?? r);
    const b = Number(source[sourceIndex + (colors >= 3 ? 2 : colors >= 2 ? 1 : 0)] ?? g);
    stored[destinationIndex] = Math.min(65535, Math.max(0, Math.round(r * scale)));
    stored[destinationIndex + 1] = Math.min(65535, Math.max(0, Math.round(g * scale)));
    stored[destinationIndex + 2] = Math.min(65535, Math.max(0, Math.round(b * scale)));
  }
  return stored;
}

function linearProPhotoToAlignmentImageData(linear, width, height) {
  const rgba = new Uint8ClampedArray(width * height * 4);
  const converted = new Float32Array(3);
  for (let outputIndex = 0, sourceIndex = 0; outputIndex < rgba.length; outputIndex += 4, sourceIndex += 3) {
    convertLinearProPhotoToOutputRgbInto(
      linear[sourceIndex],
      linear[sourceIndex + 1],
      linear[sourceIndex + 2],
      "srgb",
      converted,
    );
    rgba[outputIndex] = linearToSrgbByteFast(converted[0]);
    rgba[outputIndex + 1] = linearToSrgbByteFast(converted[1]);
    rgba[outputIndex + 2] = linearToSrgbByteFast(converted[2]);
    rgba[outputIndex + 3] = 255;
  }
  return new ImageData(rgba, width, height);
}

function canvasToImageBlob(canvas, format) {
  const mimeType = format === "webp" ? "image/webp" : "image/jpeg";
  const formatName = format === "webp" ? "WebP" : "JPEG";
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          reject(new Error(`Failed to encode the stacked image as ${formatName}.`));
          return;
        }
        if (format === "webp" && blob.type !== "image/webp") {
          reject(new Error("This browser does not support WebP encoding through Canvas."));
          return;
        }
        resolve(blob);
      },
      mimeType,
      0.92,
    );
  });
}

function isTiffFile(lowerName, mimeType) {
  return /^image\/tiff$/i.test(mimeType) || /\.(tif|tiff)$/i.test(lowerName);
}

function isJpegBuffer(buffer) {
  const view = new DataView(buffer);
  return view.byteLength >= 2 && view.getUint16(0, false) === 0xffd8;
}

function isPngBuffer(buffer) {
  const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  const bytes = new Uint8Array(buffer, 0, Math.min(signature.length, buffer.byteLength));
  if (bytes.length < signature.length) return false;
  for (let i = 0; i < signature.length; i += 1) if (bytes[i] !== signature[i]) return false;
  return true;
}

function isWebPBuffer(buffer) {
  const view = new DataView(buffer);
  return view.byteLength >= 12 && readAscii(view, 0, 4) === "RIFF" && readAscii(view, 8, 4) === "WEBP";
}

function readAscii(view, offset, length) {
  let text = "";
  for (let i = 0; i < length; i += 1) {
    text += String.fromCharCode(view.getUint8(offset + i));
  }
  return text;
}

function assertMainOpenCvApis(cv) {
  const missing = [];
  if (!cv.warpPerspective) missing.push("warpPerspective");
  if (!cv.matFromArray) missing.push("matFromArray");
  if (cv.CV_64F === undefined) missing.push("CV_64F");
  if (cv.INTER_LINEAR === undefined) missing.push("INTER_LINEAR");
  if (cv.BORDER_REPLICATE === undefined) missing.push("BORDER_REPLICATE");
  if (missing.length > 0) {
    throw new Error(`This OpenCV.js build is missing required APIs: ${missing.join(", ")}`);
  }
}

function buildLinearToSrgbByteLut(size) {
  const lut = new Uint8Array(size + 1);
  for (let i = 0; i <= size; i += 1) {
    const x = i / size;
    const encoded = x <= 0.0031308 ? x * 12.92 : 1.055 * Math.pow(x, 1 / 2.4) - 0.055;
    lut[i] = Math.min(255, Math.max(0, Math.round(encoded * 255)));
  }
  return lut;
}



function naturalSortFiles(files) {
  return files.slice().sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" }));
}

function formatColorSpaceName(colorSpace) {
  return colorSpace === "display-p3" ? "Display P3" : "sRGB";
}

function setProcessing(processing) {
  processingActive = processing;
  inputFiles.disabled = processing;
  mergeMode.disabled = processing;
  hdrSubmode.disabled = processing;
  tileDirection.disabled = processing;
  tileFolding.disabled = processing;
  panoramaDownscale.disabled = processing;
  panoramaFinish.disabled = processing;
  stfBlendWeight.disabled = processing;
  stfBlurStrength.disabled = processing;
  stfBlurRatio.disabled = processing;
  stfBlurAreaGuard.disabled = processing;
  stfBlurSigmoid.disabled = processing;
  if (!processing) updateStfBlurOptionsVisibility();
  outputFormat.disabled = processing;
  outputSize.disabled = processing || !currentStackResult;
  previewExposure.disabled = processing || !currentStackResult;
  previewShadow.disabled = processing || !currentStackResult;
  previewHighlight.disabled = processing || !currentStackResult;
  previewLogarithm.disabled = processing || !currentStackResult;
  previewSigmoid.disabled = processing || !currentStackResult;
  previewClahe.disabled = processing || !currentStackResult;
  previewVibrance.disabled = processing || !currentStackResult;
  previewSaturation.disabled = processing || !currentStackResult;
  editButton.disabled = processing || !currentStackResult;
  processButton.disabled = processing;
  progressPanel.classList.toggle("hidden", !processing);
  updateAlignmentAvailability();
}

function setProgress(message) {
  progressMessage.textContent = message;
}

function clearResult() {
  currentStackResult = null;
  currentStackResultRevision += 1;
  clearFullSizeRenderCache();
  clearPreviewRenderCaches();
  currentPreviewColorSpace = "srgb";
  currentInputFiles = [];
  currentOutputMetadata = null;
  currentPreviewExposureEv = 0;
  currentPreviewShadow = 0;
  currentPreviewHighlight = 0;
  currentPreviewLogarithm = 0;
  currentPreviewSigmoid = 0;
  currentPreviewClahe = 0;
  currentPreviewVibrance = 0;
  currentPreviewSaturation = 0;
  previewExposure.value = "0";
  previewShadow.value = "0";
  previewHighlight.value = "0";
  previewLogarithm.value = "0";
  previewSigmoid.value = "0";
  previewClahe.value = "0";
  previewVibrance.value = "0";
  previewSaturation.value = "0";
  updateToneControlLabels();
  updateOutputSizeOptions();
  previewImage.width = 1;
  previewImage.height = 1;
  previewExposure.disabled = true;
  previewShadow.disabled = true;
  previewHighlight.disabled = true;
  previewLogarithm.disabled = true;
  previewSigmoid.disabled = true;
  previewClahe.disabled = true;
  previewVibrance.disabled = true;
  previewSaturation.disabled = true;
  editButton.disabled = true;
  closeZoomModal();
  setResultPanelVisible(false);
}

function setResultPanelVisible(visible) {
  resultPanel.classList.toggle("hidden", !visible);
  usagePanel.classList.toggle("hidden", visible);
}

function clearError() {
  errorPanel.textContent = "";
  errorPanel.classList.add("hidden");
}

function showError(error) {
  const message = error instanceof Error ? error.message : String(error);
  errorPanel.textContent = message;
  errorPanel.classList.remove("hidden");
}

function getElement(id) {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Missing #${id}`);
  return element;
}

function yieldToBrowser() {
  return new Promise((resolve) => window.setTimeout(resolve, 0));
}

function parseJpegExif(buffer) {
  const view = new DataView(buffer);
  if (view.byteLength < 4 || view.getUint16(0, false) !== 0xffd8) {
    return { fNumber: null, exposureTime: null, iso: null, exposureScalar: null };
  }

  let offset = 2;
  while (offset + 4 <= view.byteLength) {
    if (view.getUint8(offset) !== 0xff) break;
    const marker = view.getUint8(offset + 1);
    offset += 2;
    if (marker === 0xd9 || marker === 0xda) break;
    if (offset + 2 > view.byteLength) break;
    const segmentLength = view.getUint16(offset, false);
    if (segmentLength < 2 || offset + segmentLength > view.byteLength) break;

    if (marker === 0xe1 && segmentLength >= 8) {
      const headerOffset = offset + 2;
      if (
        view.getUint8(headerOffset) === 0x45 &&
        view.getUint8(headerOffset + 1) === 0x78 &&
        view.getUint8(headerOffset + 2) === 0x69 &&
        view.getUint8(headerOffset + 3) === 0x66 &&
        view.getUint8(headerOffset + 4) === 0x00 &&
        view.getUint8(headerOffset + 5) === 0x00
      ) {
        return parseExifTiff(view, headerOffset + 6, segmentLength - 8);
      }
    }

    offset += segmentLength;
  }

  return { fNumber: null, exposureTime: null, iso: null, exposureScalar: null };
}

function parseExifTiff(view, tiffStart, byteLength) {
  if (byteLength < 8 || tiffStart + byteLength > view.byteLength) {
    return { fNumber: null, exposureTime: null, iso: null, exposureScalar: null };
  }
  const byteOrder = view.getUint16(tiffStart, false);
  let littleEndian;
  if (byteOrder === 0x4949) {
    littleEndian = true;
  } else if (byteOrder === 0x4d4d) {
    littleEndian = false;
  } else {
    return { fNumber: null, exposureTime: null, iso: null, exposureScalar: null };
  }
  if (view.getUint16(tiffStart + 2, littleEndian) !== 42) {
    return { fNumber: null, exposureTime: null, iso: null, exposureScalar: null };
  }
  const ifd0Offset = view.getUint32(tiffStart + 4, littleEndian);
  const exifIfdPointer = findIfdTagValue(view, tiffStart, byteLength, ifd0Offset, 0x8769, littleEndian);
  if (!Number.isFinite(exifIfdPointer) || exifIfdPointer <= 0) {
    return { fNumber: null, exposureTime: null, iso: null, exposureScalar: null };
  }
  const exposureTime = findIfdTagValue(view, tiffStart, byteLength, exifIfdPointer, 0x829a, littleEndian);
  const fNumber = findIfdTagValue(view, tiffStart, byteLength, exifIfdPointer, 0x829d, littleEndian);
  const iso = findIfdTagValue(view, tiffStart, byteLength, exifIfdPointer, 0x8827, littleEndian);
  const normalizedIso = Number.isFinite(iso) && iso > 0 ? iso : 100;
  const exposureScalar =
    Number.isFinite(exposureTime) && exposureTime > 0 && Number.isFinite(fNumber) && fNumber > 0
      ? (exposureTime * normalizedIso) / (fNumber * fNumber * 100)
      : null;
  return { fNumber, exposureTime, iso: Number.isFinite(iso) ? iso : null, exposureScalar };
}

function findIfdTagValue(view, tiffStart, byteLength, ifdOffset, targetTag, littleEndian) {
  const entryCountOffset = tiffStart + ifdOffset;
  if (entryCountOffset + 2 > tiffStart + byteLength) return null;
  const entryCount = view.getUint16(entryCountOffset, littleEndian);
  const entryBase = entryCountOffset + 2;
  for (let entryIndex = 0; entryIndex < entryCount; entryIndex += 1) {
    const entryOffset = entryBase + entryIndex * 12;
    if (entryOffset + 12 > tiffStart + byteLength) return null;
    const tag = view.getUint16(entryOffset, littleEndian);
    if (tag !== targetTag) continue;
    const type = view.getUint16(entryOffset + 2, littleEndian);
    const count = view.getUint32(entryOffset + 4, littleEndian);
    const valueOffset = entryOffset + 8;
    return readTiffValue(view, tiffStart, byteLength, type, count, valueOffset, littleEndian);
  }
  return null;
}

function readTiffValue(view, tiffStart, byteLength, type, count, valueOffset, littleEndian) {
  const typeSizes = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 7: 1, 9: 4, 10: 8 };
  const unitSize = typeSizes[type];
  if (!unitSize) return null;
  const totalSize = unitSize * count;
  let dataOffset = valueOffset;
  if (totalSize > 4) {
    const pointedOffset = view.getUint32(valueOffset, littleEndian);
    dataOffset = tiffStart + pointedOffset;
  }
  if (dataOffset < tiffStart || dataOffset + totalSize > tiffStart + byteLength) return null;
  switch (type) {
    case 3:
      return count > 0 ? view.getUint16(dataOffset, littleEndian) : null;
    case 4:
      return count > 0 ? view.getUint32(dataOffset, littleEndian) : null;
    case 5: {
      if (count <= 0) return null;
      const numerator = view.getUint32(dataOffset, littleEndian);
      const denominator = view.getUint32(dataOffset + 4, littleEndian);
      return denominator !== 0 ? numerator / denominator : null;
    }
    case 9:
      return count > 0 ? view.getInt32(dataOffset, littleEndian) : null;
    case 10: {
      if (count <= 0) return null;
      const numerator = view.getInt32(dataOffset, littleEndian);
      const denominator = view.getInt32(dataOffset + 4, littleEndian);
      return denominator !== 0 ? numerator / denominator : null;
    }
    default:
      return null;
  }
}

return () => {
  for (let i = listenerCleanups.length - 1; i >= 0; i -= 1) {
    listenerCleanups[i]();
  }
  clearZoomView();
  clearFullSizeRenderCache();
  resetStfGateCache();
  if (currentCanonicalSession) {
    const session = currentCanonicalSession;
    currentCanonicalSession = null;
    deleteCanonicalSession(session).catch(() => {});
  }
};
}
