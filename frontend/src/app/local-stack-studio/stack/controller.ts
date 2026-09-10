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
  applyLensfunCorrectionToLinearRgb,
  buildRawLensfunCorrection,
  summarizeLensfunCorrection,
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
  clampStackClahe,
  clampStackScaledLog,
  computeStackHighlightP100,
} from "./postprocess";
import {
  createStackScratchSessionId as createMedianScratchSessionId,
  deleteStackScratchSession as deleteMedianScratchSession,
  getStackRgbTiles as getMedianScratchTiles,
  getStackScratchBuffers as getScratchBuffers,
  openStackScratchDb as openMedianScratchDb,
  putStackScratchBuffer as putMedianScratchTile,
  stackRgbTileKey as medianScratchTileKey,
} from "./scratch";
import { FocusWorkerClient, OrbWorkerClient } from "./worker-clients";
import {
  applySigmoidLinear,
  applySigmoidLinearAtMidpoint,
  clamp01,
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
const SINGLE_SHOT_HDR1_EXPOSURE_TIMES = new Float32Array([1, 4, 16]);
const SINGLE_SHOT_HDR2_EXPOSURE_EVS = new Float32Array([-2, 0, 2]);
const SINGLE_SHOT_HDR_OUTER_SIGMOID_GAIN = 2;
const MULTI_SHOT_HDR2_SIGMOID_GAIN = 4;
const SINGLE_SHOT_HDR_SATURATION_WEIGHT = 0.1;
const SINGLE_SHOT_HDR_EXPOSURE_WEIGHT = 1.0;
const RESULT_BUFFER_GAMMA = 2.0;
const RESULT_BUFFER_MAX_UINT16 = 65535;
const MEDIAN_TILE_SIZE = 1024;
const FOCUS_TILE_SIZE = 1024;
const FOCUS_SMOOTHNESS = 0.5;
const FOCUS_PYRAMID_LEVELS = 8;

const inputFiles = getElement("input-files");
const fileCount = getElement("file-count");
const mergeMode = getElement("merge-mode");
const alignmentMode = getElement("alignment-mode");
const processButton = getElement("process-button");
const progressPanel = getElement("progress-panel");
const progressMessage = getElement("progress-message");
const errorPanel = getElement("error-panel");
const resultPanel = getElement("result-panel");
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
let currentPreviewColorSpace = "srgb";
let currentInputFiles = [];
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
let previewClaheMapCache = null;
let previewStageCache = null;
let previewPostToneCache = null;
let previewPostClaheCache = null;
let currentActivePreviewControl = null;
let zoomRenderRequestId = 0;
let zoomPanState = null;

const listenerCleanups = [];
function listen(target, type, listener, options) {
  target.addEventListener(type, listener, options);
  listenerCleanups.push(() => target.removeEventListener(type, listener, options));
}

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
    if (!["average", "median", "stf", "hdr1", "hdr2", "focus"].includes(mergeMode.value)) {
      throw new Error(`Unsupported merge mode: ${mergeMode.value}`);
    }
    if (!["auto", "center-crop", "fit", "feature-match"].includes(alignmentMode.value)) {
      throw new Error(`Unsupported alignment mode: ${alignmentMode.value}`);
    }

    setProgress("Loading OpenCV.js...");
    const cv = await getOpenCv();
    assertMainOpenCvApis(cv);
    const buildInfo = typeof cv.getBuildInformation === "function" ? cv.getBuildInformation() : "";
    console.info(buildInfo ? `OpenCV.js is ready:
${buildInfo}` : "OpenCV.js is ready.");

    setProgress("Reading metadata, ICC profiles, and image sizes...");
    const inputInfos = await readInputInfos(files);
    const useSyntheticSingleInputHdr = files.length === 1 && (mergeMode.value === "hdr1" || mergeMode.value === "hdr2");
    const effectiveMergeMode = useSyntheticSingleInputHdr ? mergeMode.value : files.length === 1 ? "average" : mergeMode.value;
    if (files.length === 1) {
      console.info(
        useSyntheticSingleInputHdr
          ? `${files[0].name}: single input ${mergeMode.value.toUpperCase()} mode; generating three synthetic materials and skipping ORB alignment.`
          : `${files[0].name}: single input; skipping ORB alignment and merge operation.`,
      );
    }
    const mergePlan = buildMergePlan(files, inputInfos, effectiveMergeMode);
    const alignmentPlan = buildAlignmentPlan(files, inputInfos, alignmentMode.value, effectiveMergeMode);
    currentPreviewColorSpace = chooseOutputColorSpace(inputInfos);
    console.info(`Output color space: ${formatColorSpaceName(currentPreviewColorSpace)}`);
    console.info(
      `Alignment: ${alignmentPlan.selectedMode}` +
      (alignmentPlan.selectedMode === alignmentPlan.effectiveMode ? "" : ` -> ${alignmentPlan.effectiveMode}`) +
      (alignmentPlan.normalizationMode === alignmentPlan.effectiveMode
        ? ""
        : ` (preprocess: ${alignmentPlan.normalizationMode})`) +
      ` (${alignmentPlan.targetWidth}x${alignmentPlan.targetHeight})`,
    );

    currentStackResult = await alignAndMergeFilesWithOpenCv(
      cv,
      files,
      inputInfos,
      mergePlan,
      alignmentPlan,
      currentPreviewColorSpace,
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
    resultPanel.classList.remove("hidden");
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
    const cache = ensureFullSizeRenderCache();
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
          resultPanel.classList.remove("hidden");
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
    const cache = ensureFullSizeRenderCache();
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
        applySharpenToRgb16(sharpenedStored, outputDimensions.width, outputDimensions.height, 1);
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
        applySharpenToCanvas(canvas, 1, currentPreviewColorSpace);
      }

      if (format === "jpeg" || format === "webp") {
        downloadButtonLabel.textContent = `Encoding ${format === "webp" ? "WebP" : "JPEG"}...`;
        await waitForBusyPaint();
        const blob = await canvasToImageBlob(canvas, format);
        downloadBlob(blob, buildOutputFileName(currentInputFiles, format));
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
  const highlightP100 = getCurrentHighlightP100();
  const adjustedLinear = getCurrentPreviewAdjustedLinear(highlightP100);
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
  resultPanel.classList.remove("hidden");
}

function getCurrentHighlightP100() {
  if (!currentStackResult || currentPreviewHighlight === 0) return null;
  return computeStackHighlightP100(
    currentStackResult.analysisLinearProPhotoRgb,
    Math.pow(2, currentPreviewExposureEv),
    currentPreviewShadow,
  );
}

function getCurrentPreviewAdjustedLinear(highlightP100) {
  if (!currentStackResult) {
    throw new Error("No stacked image is available.");
  }
  if (currentActivePreviewControl === "vibrance" || currentActivePreviewControl === "saturation") {
    const postClahe = getCurrentPreviewPostClaheBase(highlightP100);
    return adjustStackLinearDataPostTone(
      postClahe,
      currentStackResult.previewWidth,
      currentStackResult.previewHeight,
      0,
      currentPreviewVibrance,
      currentPreviewSaturation,
      null,
    );
  }

  const toneAdjusted = getCurrentPreviewFullTone(highlightP100);
  const claheMap = getCurrentClaheMap(highlightP100, toneAdjusted);
  return adjustStackLinearDataPostTone(
    toneAdjusted,
    currentStackResult.previewWidth,
    currentStackResult.previewHeight,
    currentPreviewClahe,
    currentPreviewVibrance,
    currentPreviewSaturation,
    claheMap,
  );
}

function getCurrentClaheMap(highlightP100, toneAdjustedLinear = null) {
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
    currentStackResult.exposureRolloffBaseP998,
    highlightP100,
  ]);
  if (previewClaheMapCache && previewClaheMapCache.key === key) {
    return previewClaheMapCache.map;
  }
  const toneAdjusted = toneAdjustedLinear ?? getCurrentPreviewFullTone(highlightP100);
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
  currentActivePreviewControl = null;
}

function getCurrentPreviewFullTone(highlightP100) {
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
    currentStackResult.exposureRolloffBaseP998,
    highlightP100,
  ]);
  if (previewPostToneCache && previewPostToneCache.key === key) {
    return previewPostToneCache.data;
  }
  const data = getPreviewToneAdjustedForActiveControl(highlightP100);
  previewPostToneCache = { key, data };
  return data;
}

function getPreviewToneAdjustedForActiveControl(highlightP100) {
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
      currentStackResult.exposureRolloffBaseP998,
      highlightP100,
    );
  }
  const prefixData = getCachedPreviewToneStage(config.prefixStage, highlightP100);
  return buildStackToneAdjustedLinearData(
    prefixData,
    currentStackResult.previewWidth,
    currentStackResult.previewHeight,
    currentPreviewExposureEv,
    currentPreviewShadow,
    currentPreviewHighlight,
    currentPreviewLogarithm,
    currentPreviewSigmoid,
    currentStackResult.exposureRolloffBaseP998,
    highlightP100,
    config.prefixStage,
    "sigmoid",
  );
}

function getCurrentPreviewPostClaheBase(highlightP100) {
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
    currentStackResult.exposureRolloffBaseP998,
    highlightP100,
  ]);
  if (previewPostClaheCache && previewPostClaheCache.key === key) {
    return previewPostClaheCache.data;
  }
  const toneAdjusted = getCurrentPreviewFullTone(highlightP100);
  const claheMap = getCurrentClaheMap(highlightP100, toneAdjusted);
  const data = adjustStackLinearDataPostTone(
    toneAdjusted,
    currentStackResult.previewWidth,
    currentStackResult.previewHeight,
    currentPreviewClahe,
    0,
    0,
    claheMap,
  );
  previewPostClaheCache = { key, data };
  return data;
}

function getCachedPreviewToneStage(stage, highlightP100) {
  if (!currentStackResult) {
    throw new Error("No stacked image is available.");
  }
  if (stage === "source") return currentStackResult.previewLinearProPhotoRgb;
  const key = JSON.stringify([
    currentStackResultRevision,
    stage,
    currentStackResult.previewWidth,
    currentStackResult.previewHeight,
    currentPreviewExposureEv,
    stage === "exposure" ? null : currentPreviewShadow,
    stage === "exposure" || stage === "shadow" ? null : currentPreviewHighlight,
    stage === "exposure" || stage === "shadow" || stage === "highlight" ? null : currentPreviewLogarithm,
    stage === "exposure" || stage === "shadow" || stage === "highlight" || stage === "logarithm" ? null : currentPreviewSigmoid,
    currentStackResult.exposureRolloffBaseP998,
    stage === "exposure" || stage === "shadow" ? null : highlightP100,
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
    currentStackResult.exposureRolloffBaseP998,
    highlightP100,
    "source",
    stage,
  );
  previewStageCache = { key, data };
  return data;
}

function getPreviewTonePrefixConfig(control) {
  if (control === "shadow") return { prefixStage: "exposure" };
  if (control === "highlight") return { prefixStage: "shadow" };
  if (control === "logarithm") return { prefixStage: "highlight" };
  if (control === "sigmoid") return { prefixStage: "logarithm" };
  if (control === "clahe" || control === "vibrance" || control === "saturation") {
    return { prefixStage: "sigmoid" };
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

function hasCurrentToneAdjustments() {
  return (
    currentPreviewExposureEv !== 0 ||
    currentPreviewShadow !== 0 ||
    currentPreviewHighlight !== 0 ||
    currentPreviewLogarithm !== 0 ||
    currentPreviewSigmoid !== 0 ||
    currentPreviewClahe !== 0 ||
    currentPreviewVibrance !== 0 ||
    currentPreviewSaturation !== 0
  );
}

function ensureFullSizeRenderCache() {
  if (!currentStackResult) {
    throw new Error("No stacked image is available.");
  }
  const key = getFullSizeRenderCacheKey();
  if (fullSizeRenderCache && fullSizeRenderCache.key === key) {
    return fullSizeRenderCache;
  }

  const sourceLinear = decodeStoredGamma2ToLinear(currentStackResult.gamma2ProPhotoRgb16);
  const claheMap = getCurrentClaheMap(getCurrentHighlightP100());
  const adjustedLinear = hasCurrentToneAdjustments()
    ? adjustStackLinearData(
        sourceLinear,
        currentStackResult.width,
        currentStackResult.height,
        currentPreviewExposureEv,
        currentPreviewShadow,
        currentPreviewHighlight,
        currentPreviewLogarithm,
        currentPreviewSigmoid,
        currentPreviewClahe,
        currentPreviewVibrance,
        currentPreviewSaturation,
        currentStackResult.exposureRolloffBaseP998,
        getCurrentHighlightP100(),
        claheMap,
      )
    : sourceLinear;

  fullSizeRenderCache = {
    key,
    adjustedLinear,
    jpegBlob: null,
  };
  return fullSizeRenderCache;
}

function clearFullSizeRenderCache() {
  fullSizeRenderCache = null;
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
    // full-size tone/color conversion starts blocking the main thread.
    await waitForBusyPaint();
    if (requestId !== zoomRenderRequestId) {
      return;
    }
  }

  try {
    const cache = ensureFullSizeRenderCache();
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
  if (mode === "fit") return "Fit";
  if (mode === "feature-match") return "Feature match";
  return "Auto";
}

function buildAlignmentPlan(files, inputInfos, selectedMode, mergeMode) {
  const validModes = ["auto", "center-crop", "fit", "feature-match"];
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
    return {
      selectedMode,
      effectiveMode: "feature-match",
      normalizationMode: "feature-match",
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
  const effectiveMode = selectedMode === "auto"
    ? (mergeMode === "average" ? "center-crop" : "feature-match")
    : selectedMode;

  if (effectiveMode === "feature-match") {
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

  const largest = dimensions.reduce((best, entry) => {
    const bestPixels = best.width * best.height;
    const entryPixels = entry.width * entry.height;
    return entryPixels > bestPixels ? entry : best;
  }, dimensions[0]);
  return {
    selectedMode,
    effectiveMode,
    normalizationMode: "fit",
    targetWidth: largest.width,
    targetHeight: largest.height,
  };
}

function buildMergePlan(files, inputInfos, mode) {
  const imageCount = files.length;
  const weights = new Float32Array(imageCount);
  const gains = new Float32Array(imageCount);

  for (let i = 0; i < imageCount; i += 1) {
    weights[i] = mode === "average" ? 1 / imageCount : 1;
    gains[i] = 1;
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
      hdrExposureTimes: mode === "hdr1" ? buildHdrExposureTimes(files, inputInfos) : null,
    };
  }

  if (mode === "median") {
    return { mode, weights, gains };
  }

  if (mode === "focus") {
    return { mode, weights, gains };
  }

  if (mode !== "stf") {
    return { mode, weights, gains };
  }

  const fNumbers = inputInfos.map((entry) => entry.fNumber);
  const allFNumbersValid = fNumbers.every((value) => Number.isFinite(value) && value > 0);
  if (allFNumbersValid) {
    const blurRadii = fNumbers.map((fNumber) => 1 / fNumber);
    const minBlurRadius = Math.min(...blurRadii);
    let totalWeight = 0;
    for (let i = 0; i < imageCount; i += 1) {
      const weight = blurRadii[i] + minBlurRadius / 4;
      weights[i] = weight;
      totalWeight += weight;
    }
    if (totalWeight > 0) {
      for (let i = 0; i < imageCount; i += 1) {
        weights[i] /= totalWeight;
      }
    }
  } else {
    const uniformWeight = 1 / imageCount;
    for (let i = 0; i < imageCount; i += 1) {
      weights[i] = uniformWeight;
    }
  }

  const exposures = inputInfos.map((entry) => entry.exposureScalar);
  const validExposures = exposures.filter((value) => Number.isFinite(value) && value > 0);
  if (validExposures.length === imageCount) {
    let logSum = 0;
    for (const value of validExposures) logSum += Math.log(value);
    const targetExposure = Math.exp(logSum / imageCount);
    for (let i = 0; i < imageCount; i += 1) {
      const gain = targetExposure / exposures[i];
      gains[i] = Number.isFinite(gain) && gain > 0 ? gain : 1;
    }
  }

  return { mode, weights, gains };
}

function buildSingleShotHdrSyntheticMaterials(mode) {
  if (mode === "hdr1") {
    return [
      {
        label: "dark",
        exposureEv: SINGLE_SHOT_HDR1_EXPOSURE_EVS[0],
        sigmoidGain: SINGLE_SHOT_HDR_OUTER_SIGMOID_GAIN,
        sigmoidMidpoint: 1,
      },
      {
        label: "medium",
        exposureEv: SINGLE_SHOT_HDR1_EXPOSURE_EVS[1],
        sigmoidGain: 4,
        sigmoidMidpoint: 0.5,
      },
      {
        label: "light",
        exposureEv: SINGLE_SHOT_HDR1_EXPOSURE_EVS[2],
        sigmoidGain: SINGLE_SHOT_HDR_OUTER_SIGMOID_GAIN,
        sigmoidMidpoint: 0,
      },
    ];
  }
  return [
    {
      label: "dark",
      exposureEv: SINGLE_SHOT_HDR2_EXPOSURE_EVS[0],
      sigmoidGain: SINGLE_SHOT_HDR_OUTER_SIGMOID_GAIN,
      sigmoidMidpoint: 1,
    },
    {
      label: "medium",
      exposureEv: SINGLE_SHOT_HDR2_EXPOSURE_EVS[1],
      sigmoidGain: 4,
      sigmoidMidpoint: 0.5,
    },
    {
      label: "light",
      exposureEv: SINGLE_SHOT_HDR2_EXPOSURE_EVS[2],
      sigmoidGain: SINGLE_SHOT_HDR_OUTER_SIGMOID_GAIN,
      sigmoidMidpoint: 0,
    },
  ];
}

function buildHdrExposureTimes(files, inputInfos) {
  const exposureScalars = inputInfos.map((entry) => entry.exposureScalar);
  if (exposureScalars.every((value) => Number.isFinite(value) && value > 0)) {
    const minExposure = Math.max(Math.min(...exposureScalars), 0.0001);
    return new Float32Array(exposureScalars.map((value) => value / minExposure));
  }

  console.warn(
    "HDR: complete light-value metadata is unavailable. " +
    "Matching itb_stack.py, Debevec exposures will be estimated from input brightness."
  );
  return null;
}

async function alignAndMergeFilesWithOpenCv(cv, files, inputInfos, mergePlan, alignmentPlan, outputColorSpace) {
  let accumulator = null;
  let alignmentWorker = null;
  let width = 0;
  let height = 0;
  const hdrImages = new Array(files.length);
  const hdrBrightnesses = new Array(files.length);
  const alignmentMatrices = new Array(files.length).fill(null);
  const alignedIndices = new Set();
  const deferredAlignments = [];
  let medianScratchDb = null;
  let medianScratchSessionId = null;
  let focusWorker = null;

  try {
    const needsAlignment = files.length > 1 && alignmentPlan.effectiveMode === "feature-match";
    if (mergePlan.mode === "median" || mergePlan.mode === "focus") {
      const scratchLabel = mergePlan.mode === "focus" ? "Focus" : "Denoise (median)";
      setProgress(`Opening IndexedDB scratch space for ${scratchLabel} tiles...`);
      medianScratchDb = await openMedianScratchDb(scratchLabel);
      medianScratchSessionId = createMedianScratchSessionId();
      if (mergePlan.mode === "focus") {
        focusWorker = new FocusWorkerClient(
          new URL("/generated/local-stack-studio/focus.worker.js", window.location.origin),
          setProgress,
        );
      }
    }
    const syntheticSingleInputHdr = !needsAlignment && (mergePlan.mode === "hdr1" || mergePlan.mode === "hdr2") && Array.isArray(mergePlan.syntheticMaterials) && mergePlan.syntheticMaterials.length > 0;
    if (syntheticSingleInputHdr) {
      return await processSingleInputHdrWithOpenCv(cv, files[0], inputInfos[0], mergePlan, outputColorSpace);
    }
    if (needsAlignment) {
      alignmentWorker = new OrbWorkerClient(new URL("/generated/local-stack-studio/orb.worker.js", window.location.origin));
    }

    for (let index = 0; index < files.length; index += 1) {
      const file = files[index];
      const inputInfo = inputInfos[index];
      setProgress(`${inputInfo.isRaw ? "Developing RAW" : "Reading image"} ${index + 1}/${files.length}...`);
      const decoded = await decodeFileToDecodedImage(file, inputInfo);
      const normalizedDecoded = normalizeDecodedImageForAlignment(
        cv,
        decoded,
        alignmentPlan.normalizationMode,
        alignmentPlan.targetWidth,
        alignmentPlan.targetHeight,
      );
      let imageData = normalizedDecoded.alignmentImageData || normalizedDecoded.imageData;
      const decodedWidth = normalizedDecoded.width || imageData.width;
      const decodedHeight = normalizedDecoded.height || imageData.height;

      if (index === 0) {
        width = decodedWidth;
        height = decodedHeight;
        if (mergePlan.mode !== "hdr1" && mergePlan.mode !== "hdr2" && mergePlan.mode !== "median" && mergePlan.mode !== "focus") {
          accumulator = new Float32Array(width * height * 3);
        }
        if (mergePlan.mode === "median") {
          warnIfMedianScratchMayExceedQuota(width, height, files.length);
        } else if (mergePlan.mode === "focus") {
          warnIfFocusScratchMayExceedQuota(width, height, files.length);
        }
      } else if (decodedWidth !== width || decodedHeight !== height) {
        throw new Error(
          `${file.name} is ${decodedWidth}x${decodedHeight}, but the first image is ${width}x${height}. ` +
          "All input images must have identical dimensions after alignment normalization."
        );
      }

      const rgba = cv.matFromImageData(imageData);
      if (normalizedDecoded.alignmentImageData) normalizedDecoded.alignmentImageData = null;
      imageData = null;
      const gray = needsAlignment ? new cv.Mat() : null;
      const hasLinearProPhoto = normalizedDecoded.linearProPhotoRgb instanceof Float32Array;
      let rgb = null;
      let linearRgb = null;
      let alignedRgb = null;
      let alignedLinearRgb = null;
      let homography = null;
      let shouldMerge = true;

      try {
        if (gray) {
          cv.cvtColor(rgba, gray, cv.COLOR_RGBA2GRAY);
        }
        if (hasLinearProPhoto) {
          linearRgb = matFromLinearProPhoto(cv, normalizedDecoded.linearProPhotoRgb, width, height);
          normalizedDecoded.linearProPhotoRgb = null;
        } else {
          rgb = new cv.Mat();
          cv.cvtColor(rgba, rgb, cv.COLOR_RGBA2RGB);
        }
        const grayBytes = gray ? copyMatBytes(gray, width * height) : null;
        let mergeSource = linearRgb || rgb;

        if (index === 0) {
          alignmentMatrices[index] = identityHomography();
          alignedIndices.add(index);
          if (needsAlignment) {
            if (alignmentPlan.normalizationMode !== "feature-match") {
              setProgress(
                `Applying ${formatAlignmentModeName(alignmentPlan.normalizationMode)} preprocessing and detecting reference features...`,
              );
            } else {
              setProgress("Initializing ORB worker and detecting reference features...");
            }
            const ready = await alignmentWorker.initialize(width, height, grayBytes, inputInfo.exposureScalar);
            console.info(`Reference ORB baseline features: ${ready.referenceFeatureCount}`);
          } else {
            setProgress(`Applying ${formatAlignmentModeName(alignmentPlan.normalizationMode)} alignment...`);
          }
        } else if (needsAlignment) {
          setProgress(`Aligning image ${index + 1}/${files.length} with feature matching...`);
          const retryGrayBytes = new Uint8Array(grayBytes);
          try {
            const result = await alignmentWorker.align(index, file.name, grayBytes, inputInfo.exposureScalar);
            logOrbAlignmentResult(file.name, result);
            alignmentMatrices[index] = result.matrix;
            alignedIndices.add(index);

            homography = cv.matFromArray(3, 3, cv.CV_64F, Array.from(result.matrix));
            if (linearRgb) {
              alignedLinearRgb = new cv.Mat();
              cv.warpPerspective(
                linearRgb,
                alignedLinearRgb,
                homography,
                new cv.Size(width, height),
                cv.INTER_LINEAR,
                cv.BORDER_REPLICATE,
                new cv.Scalar(0, 0, 0, 0),
              );
              mergeSource = alignedLinearRgb;
            } else {
              alignedRgb = new cv.Mat();
              cv.warpPerspective(
                rgb,
                alignedRgb,
                homography,
                new cv.Size(width, height),
                cv.INTER_LINEAR,
                cv.BORDER_REPLICATE,
                new cv.Scalar(0, 0, 0, 0),
              );
              mergeSource = alignedRgb;
            }
          } catch (error) {
            shouldMerge = false;
            const initialError = error instanceof Error ? error.message : String(error);
            deferredAlignments.push({
              index,
              grayBytes: retryGrayBytes,
              initialError,
              attemptedReferences: new Set([0]),
              attempts: [],
            });
            console.warn(
              `${file.name}: alignment against the first image failed; deferring until the initial pass completes: ${initialError}`,
            );
          }
        }

        if (shouldMerge) {
          setProgress(describeMergeStep(index, files.length, mergePlan));
          if (mergePlan.mode === "median") {
            await storeMedianAlignedImageTiles(
              medianScratchDb,
              medianScratchSessionId,
              index,
              mergeSource,
              hasLinearProPhoto,
              inputInfo.sourceColorSpace,
              width,
              height,
              files.length,
            );
          } else if (mergePlan.mode === "focus") {
            await storeFocusAlignedImage(
              medianScratchDb,
              medianScratchSessionId,
              focusWorker,
              index,
              mergeSource,
              hasLinearProPhoto,
              inputInfo.sourceColorSpace,
              width,
              height,
              files.length,
            );
          } else {
            mergeStackSource(
              index,
              mergeSource,
              hasLinearProPhoto,
              inputInfo,
              mergePlan,
              accumulator,
              hdrImages,
              hdrBrightnesses,
            );
          }
        }
      } finally {
        if (homography) homography.delete();
        if (alignedLinearRgb) alignedLinearRgb.delete();
        if (alignedRgb) alignedRgb.delete();
        if (linearRgb) linearRgb.delete();
        if (rgb) rgb.delete();
        if (gray) gray.delete();
        rgba.delete();
      }

      await yieldToBrowser();
    }

    if (deferredAlignments.length > 0) {
      await recoverDeferredAlignments(
        cv,
        alignmentWorker,
        files,
        inputInfos,
        width,
        height,
        alignmentPlan,
        alignmentMatrices,
        alignedIndices,
        deferredAlignments,
      );

      const unresolved = deferredAlignments.filter((entry) => !alignmentMatrices[entry.index]);
      if (unresolved.length > 0) {
        const details = unresolved.map((entry) => {
          const alternateDetails = entry.attempts.length > 0
            ? entry.attempts.map((attempt) => `${files[attempt.referenceIndex].name}: ${attempt.error}`).join("; ")
            : "no alternate reference could be tried";
          return `${files[entry.index].name}: initial=${entry.initialError}; alternates=${alternateDetails}`;
        });
        throw new Error(
          `Could not align ${unresolved.length} image${unresolved.length === 1 ? "" : "s"} after trying all successfully aligned references:\n` +
          details.join("\n"),
        );
      }

      for (const entry of deferredAlignments) {
        await mergeDeferredAlignedImage(
          cv,
          entry.index,
          files,
          inputInfos,
          width,
          height,
          alignmentMatrices[entry.index],
          mergePlan,
          alignmentPlan,
          accumulator,
          hdrImages,
          hdrBrightnesses,
          medianScratchDb,
          medianScratchSessionId,
          focusWorker,
        );
        await yieldToBrowser();
      }
    }


    if (mergePlan.mode === "median") {
      setProgress("Computing exact median from IndexedDB tiles...");
      const medianStored = await mergeMedianScratchTiles(
        medianScratchDb,
        medianScratchSessionId,
        files.length,
        width,
        height,
      );
      return finalizeStoredGamma2Result(medianStored, width, height, outputColorSpace);
    }

    if (mergePlan.mode === "focus") {
      const focusStored = await mergeFocusScratchTiles(
        medianScratchDb,
        medianScratchSessionId,
        focusWorker,
        files.length,
        width,
        height,
      );
      return finalizeStoredGamma2Result(focusStored, width, height, outputColorSpace);
    }

    if (mergePlan.mode === "hdr1" || mergePlan.mode === "hdr2") {
      for (let index = 0; index < files.length; index += 1) {
        const validImage = mergePlan.mode === "hdr1"
          ? hdrImages[index] instanceof Float32Array
          : hdrImages[index] instanceof Float32Array;
        if (!validImage || !Number.isFinite(hdrBrightnesses[index])) {
          throw new Error(`${mergePlan.mode.toUpperCase()} input preparation failed for ${files[index].name}.`);
        }
      }
      if (mergePlan.mode === "hdr1") {
        accumulator = await mergeHdrDebevecReinhardInWorker(
          hdrImages,
          mergePlan.hdrExposureTimes,
          hdrBrightnesses,
          width,
          height,
        );
      } else {
        setProgress("Merging HDR2 with Mertens exposure fusion...");
        accumulator = await mergeHdrMertensInWorker(hdrImages, hdrBrightnesses, width, height);
      }
      hdrImages.length = 0;
      hdrBrightnesses.length = 0;
    }

    if (!accumulator) {
      throw new Error("No input images were processed.");
    }

    return finalizeStoredResult(accumulator, width, height, outputColorSpace);
  } finally {
    if (alignmentWorker) alignmentWorker.terminate();
    if (focusWorker) focusWorker.terminate();
    if (medianScratchDb) {
      if (medianScratchSessionId) {
        try {
          await deleteMedianScratchSession(medianScratchDb, medianScratchSessionId);
        } catch (error) {
          console.warn("Could not fully clear scratch tiles:", error);
        }
      }
      medianScratchDb.close();
    }
  }
}

async function recoverDeferredAlignments(
  cv,
  alignmentWorker,
  files,
  inputInfos,
  width,
  height,
  alignmentPlan,
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
          const referenceGrayBytes = await decodeAlignmentGrayBytes(
            cv,
            referenceFile,
            inputInfos[referenceIndex],
            width,
            height,
            alignmentPlan.normalizationMode,
          );
          const ready = await alignmentWorker.initialize(
            width,
            height,
            referenceGrayBytes,
            inputInfos[referenceIndex].exposureScalar,
          );
          const result = await alignmentWorker.align(
            entry.index,
            targetFile.name,
            new Uint8Array(entry.grayBytes),
            inputInfos[entry.index].exposureScalar,
          );
          const composedMatrix = multiplyHomographies(
            alignmentMatrices[referenceIndex],
            result.matrix,
          );

          alignmentMatrices[entry.index] = composedMatrix;
          alignedIndices.add(entry.index);
          madeProgress = true;

          console.info(
            `${targetFile.name}: recovered by matching against ${referenceFile.name} ` +
            `(reference ORB features=${ready.referenceFeatureCount})`,
          );
          logOrbAlignmentResult(targetFile.name, result, `local to ${referenceFile.name}`);
          console.info(
            `${targetFile.name}: composed transform to first image, ${describeHomography(composedMatrix)}`,
          );
          break;
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          entry.attempts.push({ referenceIndex, error: message });
          console.info(
            `${targetFile.name}: alternate ORB reference ${referenceFile.name} did not match: ${message}`,
          );
        }
      }
    }
  }
}

async function decodeAlignmentGrayBytes(
  cv,
  file,
  inputInfo,
  expectedWidth,
  expectedHeight,
  normalizationMode = "feature-match",
) {
  setProgress(`Preparing alternate ORB reference ${file.name}...`);
  const decoded = await decodeFileToDecodedImage(file, inputInfo);
  const normalizedDecoded = normalizeDecodedImageForAlignment(
    cv,
    decoded,
    normalizationMode,
    expectedWidth,
    expectedHeight,
  );
  let imageData = normalizedDecoded.alignmentImageData || normalizedDecoded.imageData;
  const decodedWidth = normalizedDecoded.width || imageData.width;
  const decodedHeight = normalizedDecoded.height || imageData.height;

  if (decodedWidth !== expectedWidth || decodedHeight !== expectedHeight) {
    throw new Error(
      `${file.name} is ${decodedWidth}x${decodedHeight}, expected ${expectedWidth}x${expectedHeight}.`,
    );
  }

  const rgba = cv.matFromImageData(imageData);
  if (normalizedDecoded.alignmentImageData) normalizedDecoded.alignmentImageData = null;
  imageData = null;
  const gray = new cv.Mat();
  try {
    cv.cvtColor(rgba, gray, cv.COLOR_RGBA2GRAY);
    return copyMatBytes(gray, expectedWidth * expectedHeight);
  } finally {
    gray.delete();
    rgba.delete();
  }
}

async function mergeDeferredAlignedImage(
  cv,
  index,
  files,
  inputInfos,
  width,
  height,
  matrix,
  mergePlan,
  alignmentPlan,
  accumulator,
  hdrImages,
  hdrBrightnesses,
  medianScratchDb,
  medianScratchSessionId,
  focusWorker,
) {
  const file = files[index];
  const inputInfo = inputInfos[index];
  setProgress(`Re-reading recovered image ${index + 1}/${files.length}: ${file.name}...`);
  const decoded = await decodeFileToDecodedImage(file, inputInfo);
  const normalizedDecoded = normalizeDecodedImageForAlignment(
    cv,
    decoded,
    alignmentPlan.normalizationMode,
    width,
    height,
  );
  let imageData = normalizedDecoded.alignmentImageData || normalizedDecoded.imageData;
  const decodedWidth = normalizedDecoded.width || imageData.width;
  const decodedHeight = normalizedDecoded.height || imageData.height;

  if (decodedWidth !== width || decodedHeight !== height) {
    throw new Error(
      `${file.name} is ${decodedWidth}x${decodedHeight}, but the first image is ${width}x${height}. ` +
      "All input images must have identical dimensions after alignment normalization."
    );
  }

  const rgba = cv.matFromImageData(imageData);
  if (normalizedDecoded.alignmentImageData) normalizedDecoded.alignmentImageData = null;
  imageData = null;
  const hasLinearProPhoto = normalizedDecoded.linearProPhotoRgb instanceof Float32Array;
  let rgb = null;
  let linearRgb = null;
  let alignedRgb = null;
  let alignedLinearRgb = null;
  let homography = null;

  try {
    if (hasLinearProPhoto) {
      linearRgb = matFromLinearProPhoto(cv, normalizedDecoded.linearProPhotoRgb, width, height);
      normalizedDecoded.linearProPhotoRgb = null;
    } else {
      rgb = new cv.Mat();
      cv.cvtColor(rgba, rgb, cv.COLOR_RGBA2RGB);
    }

    homography = cv.matFromArray(3, 3, cv.CV_64F, Array.from(matrix));
    let mergeSource;
    if (linearRgb) {
      alignedLinearRgb = new cv.Mat();
      cv.warpPerspective(
        linearRgb,
        alignedLinearRgb,
        homography,
        new cv.Size(width, height),
        cv.INTER_LINEAR,
        cv.BORDER_REPLICATE,
        new cv.Scalar(0, 0, 0, 0),
      );
      mergeSource = alignedLinearRgb;
    } else {
      alignedRgb = new cv.Mat();
      cv.warpPerspective(
        rgb,
        alignedRgb,
        homography,
        new cv.Size(width, height),
        cv.INTER_LINEAR,
        cv.BORDER_REPLICATE,
        new cv.Scalar(0, 0, 0, 0),
      );
      mergeSource = alignedRgb;
    }

    setProgress(describeMergeStep(index, files.length, mergePlan));
    if (mergePlan.mode === "median") {
      await storeMedianAlignedImageTiles(
        medianScratchDb,
        medianScratchSessionId,
        index,
        mergeSource,
        hasLinearProPhoto,
        inputInfo.sourceColorSpace,
        width,
        height,
        files.length,
      );
    } else if (mergePlan.mode === "focus") {
      await storeFocusAlignedImage(
        medianScratchDb,
        medianScratchSessionId,
        focusWorker,
        index,
        mergeSource,
        hasLinearProPhoto,
        inputInfo.sourceColorSpace,
        width,
        height,
        files.length,
      );
    } else {
      mergeStackSource(
        index,
        mergeSource,
        hasLinearProPhoto,
        inputInfo,
        mergePlan,
        accumulator,
        hdrImages,
        hdrBrightnesses,
      );
    }
  } finally {
    if (homography) homography.delete();
    if (alignedLinearRgb) alignedLinearRgb.delete();
    if (alignedRgb) alignedRgb.delete();
    if (linearRgb) linearRgb.delete();
    if (rgb) rgb.delete();
    rgba.delete();
  }
}

function mergeStackSource(
  index,
  mergeSource,
  hasLinearProPhoto,
  inputInfo,
  mergePlan,
  accumulator,
  hdrImages,
  hdrBrightnesses,
) {
  if (mergePlan.mode === "hdr1" || mergePlan.mode === "hdr2") {
    const useHdr2Preparation = mergePlan.mode === "hdr2";
    const prepared = hasLinearProPhoto
      ? (useHdr2Preparation
        ? linearProPhotoMatToHdr2FloatsAndBrightness(mergeSource)
        : linearProPhotoMatToFloatsAndBrightness(mergeSource))
      : (useHdr2Preparation
        ? rgbMatToHdr2FloatsAndBrightness(mergeSource, inputInfo.sourceColorSpace)
        : rgbMatToLinearProPhotoFloatsAndBrightness(mergeSource, inputInfo.sourceColorSpace));
    hdrImages[index] = prepared.floats;
    hdrBrightnesses[index] = prepared.brightness;
  } else if (hasLinearProPhoto) {
    mergeLinearProPhotoMatIntoAccumulator(
      mergeSource,
      accumulator,
      mergePlan.gains[index],
      mergePlan.weights[index],
    );
  } else {
    mergeRgbIntoAccumulator(
      mergeSource,
      accumulator,
      inputInfo.sourceColorSpace,
      mergePlan.gains[index],
      mergePlan.weights[index],
    );
  }
}

function warnIfMedianScratchMayExceedQuota(width, height, imageCount) {
  if (!(navigator.storage && typeof navigator.storage.estimate === "function")) return;
  const requiredBytes = width * height * 3 * Uint16Array.BYTES_PER_ELEMENT * imageCount;
  navigator.storage.estimate().then(({ quota, usage }) => {
    if (!(Number.isFinite(quota) && Number.isFinite(usage))) return;
    const available = quota - usage;
    if (available < requiredBytes * 1.1) {
      console.warn(
        `Denoise (median) scratch may need about ${(requiredBytes / (1024 ** 3)).toFixed(2)} GiB, ` +
        `but the browser currently reports ${(Math.max(0, available) / (1024 ** 3)).toFixed(2)} GiB available.`,
      );
    }
  }).catch(() => {});
}

async function storeMedianAlignedImageTiles(
  db,
  sessionId,
  imageIndex,
  mat,
  hasLinearProPhoto,
  sourceColorSpace,
  width,
  height,
  imageCount,
) {
  if (!db || !sessionId) {
    throw new Error("Median scratch storage is not initialized.");
  }
  const tileColumns = Math.ceil(width / MEDIAN_TILE_SIZE);
  const tileRows = Math.ceil(height / MEDIAN_TILE_SIZE);
  const tileCount = tileColumns * tileRows;
  const source = hasLinearProPhoto ? mat.data32F : mat.data;
  const expectedLength = width * height * 3;
  if (!source || source.length !== expectedLength) {
    throw new Error("Median input has an invalid aligned RGB buffer.");
  }

  const convertRgb8 = hasLinearProPhoto ? null : createRgb8ToLinearProphotoConverter(sourceColorSpace);
  const converted = new Float32Array(3);
  let tileNumber = 0;

  for (let tileY = 0; tileY < tileRows; tileY += 1) {
    const y0 = tileY * MEDIAN_TILE_SIZE;
    const tileHeight = Math.min(MEDIAN_TILE_SIZE, height - y0);
    for (let tileX = 0; tileX < tileColumns; tileX += 1) {
      const x0 = tileX * MEDIAN_TILE_SIZE;
      const tileWidth = Math.min(MEDIAN_TILE_SIZE, width - x0);
      const tile = new Uint16Array(tileWidth * tileHeight * 3);
      let targetOffset = 0;

      for (let localY = 0; localY < tileHeight; localY += 1) {
        let sourceOffset = ((y0 + localY) * width + x0) * 3;
        for (let localX = 0; localX < tileWidth; localX += 1) {
          if (hasLinearProPhoto) {
            tile[targetOffset] = Math.round(Math.sqrt(clamp01(source[sourceOffset])) * RESULT_BUFFER_MAX_UINT16);
            tile[targetOffset + 1] = Math.round(Math.sqrt(clamp01(source[sourceOffset + 1])) * RESULT_BUFFER_MAX_UINT16);
            tile[targetOffset + 2] = Math.round(Math.sqrt(clamp01(source[sourceOffset + 2])) * RESULT_BUFFER_MAX_UINT16);
          } else {
            convertRgb8(
              source[sourceOffset],
              source[sourceOffset + 1],
              source[sourceOffset + 2],
              converted,
            );
            tile[targetOffset] = Math.round(Math.sqrt(clamp01(converted[0])) * RESULT_BUFFER_MAX_UINT16);
            tile[targetOffset + 1] = Math.round(Math.sqrt(clamp01(converted[1])) * RESULT_BUFFER_MAX_UINT16);
            tile[targetOffset + 2] = Math.round(Math.sqrt(clamp01(converted[2])) * RESULT_BUFFER_MAX_UINT16);
          }
          sourceOffset += 3;
          targetOffset += 3;
        }
      }

      tileNumber += 1;
      setProgress(
        `Storing denoise image ${imageIndex + 1}/${imageCount}, tile ${tileNumber}/${tileCount} (${tileWidth}x${tileHeight})...`,
      );
      try {
        await putMedianScratchTile(
          db,
          medianScratchTileKey(sessionId, imageIndex, tileX, tileY),
          tile.buffer,
        );
      } catch (error) {
        if (error && (error.name === "QuotaExceededError" || error.name === "UnknownError")) {
          throw new Error("Browser scratch storage is full while writing Denoise (median) tiles.");
        }
        throw error;
      }
      await yieldToBrowser();
    }
  }
}

function exactMedianUint16Tile(tiles) {
  if (!Array.isArray(tiles) || tiles.length === 0) {
    throw new Error("Median tile set is empty.");
  }
  const length = tiles[0].length;
  for (let index = 1; index < tiles.length; index += 1) {
    if (!(tiles[index] instanceof Uint16Array) || tiles[index].length !== length) {
      throw new Error("Median tile set has inconsistent dimensions.");
    }
  }

  const output = new Uint16Array(length);
  const count = tiles.length;
  if (count === 1) {
    output.set(tiles[0]);
    return output;
  }
  if (count === 2) {
    const a = tiles[0];
    const b = tiles[1];
    for (let i = 0; i < length; i += 1) output[i] = Math.round((a[i] + b[i]) / 2);
    return output;
  }
  if (count === 3) {
    const a = tiles[0];
    const b = tiles[1];
    const c = tiles[2];
    for (let i = 0; i < length; i += 1) {
      const av = a[i];
      const bv = b[i];
      const cv = c[i];
      output[i] = av > bv
        ? (bv > cv ? bv : Math.min(av, cv))
        : (av > cv ? av : Math.min(bv, cv));
    }
    return output;
  }

  const scratch = new Uint16Array(count);
  const upperMiddle = count >> 1;
  const even = (count & 1) === 0;
  for (let offset = 0; offset < length; offset += 1) {
    for (let imageIndex = 0; imageIndex < count; imageIndex += 1) {
      const value = tiles[imageIndex][offset];
      let insertAt = imageIndex;
      while (insertAt > 0 && scratch[insertAt - 1] > value) {
        scratch[insertAt] = scratch[insertAt - 1];
        insertAt -= 1;
      }
      scratch[insertAt] = value;
    }
    output[offset] = even
      ? Math.round((scratch[upperMiddle - 1] + scratch[upperMiddle]) / 2)
      : scratch[upperMiddle];
  }
  return output;
}

async function mergeMedianScratchTiles(db, sessionId, imageCount, width, height) {
  const output = new Uint16Array(width * height * 3);
  const tileColumns = Math.ceil(width / MEDIAN_TILE_SIZE);
  const tileRows = Math.ceil(height / MEDIAN_TILE_SIZE);
  const tileCount = tileColumns * tileRows;
  let tileNumber = 0;

  for (let tileY = 0; tileY < tileRows; tileY += 1) {
    const y0 = tileY * MEDIAN_TILE_SIZE;
    const tileHeight = Math.min(MEDIAN_TILE_SIZE, height - y0);
    for (let tileX = 0; tileX < tileColumns; tileX += 1) {
      const x0 = tileX * MEDIAN_TILE_SIZE;
      const tileWidth = Math.min(MEDIAN_TILE_SIZE, width - x0);
      tileNumber += 1;
      setProgress(`Computing median tile ${tileNumber}/${tileCount} (${tileWidth}x${tileHeight})...`);
      const tiles = await getMedianScratchTiles(db, sessionId, imageCount, tileX, tileY);
      const expectedLength = tileWidth * tileHeight * 3;
      if (tiles.some((tile) => tile.length !== expectedLength)) {
        throw new Error(`Median scratch tile ${tileX},${tileY} has an invalid size.`);
      }
      const medianTile = exactMedianUint16Tile(tiles);
      const rowLength = tileWidth * 3;
      for (let localY = 0; localY < tileHeight; localY += 1) {
        const sourceStart = localY * rowLength;
        const targetStart = ((y0 + localY) * width + x0) * 3;
        output.set(medianTile.subarray(sourceStart, sourceStart + rowLength), targetStart);
      }
      await yieldToBrowser();
    }
  }
  return output;
}


function focusSharpnessTileKey(sessionId, imageIndex, tileX, tileY) {
  return `${sessionId}:sharp:${imageIndex}:${tileY}:${tileX}`;
}

function warnIfFocusScratchMayExceedQuota(width, height, imageCount) {
  if (!(navigator.storage && typeof navigator.storage.estimate === "function")) return;
  const rgbBytes = width * height * 3 * Uint16Array.BYTES_PER_ELEMENT * imageCount;
  const sharpnessBytes = width * height * Float32Array.BYTES_PER_ELEMENT * imageCount;
  const requiredBytes = rgbBytes + sharpnessBytes;
  navigator.storage.estimate().then(({ quota, usage }) => {
    if (!(Number.isFinite(quota) && Number.isFinite(usage))) return;
    const available = quota - usage;
    if (available < requiredBytes * 1.1) {
      console.warn(
        `Focus scratch may need about ${(requiredBytes / (1024 ** 3)).toFixed(2)} GiB, ` +
        `but the browser currently reports ${(Math.max(0, available) / (1024 ** 3)).toFixed(2)} GiB available.`,
      );
    }
  }).catch(() => {});
}

async function storeFocusAlignedImage(
  db,
  sessionId,
  focusWorker,
  imageIndex,
  mat,
  hasLinearProPhoto,
  sourceColorSpace,
  width,
  height,
  imageCount,
) {
  if (!db || !sessionId || !focusWorker) {
    throw new Error("Focus scratch storage is not initialized.");
  }

  setProgress(`Preparing Focus RGB ${imageIndex + 1}/${imageCount}...`);
  const stored = alignedMatToGamma2Uint16(
    mat,
    hasLinearProPhoto,
    sourceColorSpace,
    width,
    height,
  );
  await storeFocusRgbTiles(db, sessionId, imageIndex, stored, width, height, imageCount);

  setProgress(`Computing full-image sharpness map ${imageIndex + 1}/${imageCount}...`);
  const sharpness = await focusWorker.computeSharpness(
    stored,
    width,
    height,
    `Computing full-image sharpness map ${imageIndex + 1}/${imageCount}...`,
  );
  await storeFocusSharpnessTiles(db, sessionId, imageIndex, sharpness, width, height, imageCount);
}

function alignedMatToGamma2Uint16(mat, hasLinearProPhoto, sourceColorSpace, width, height) {
  const source = hasLinearProPhoto ? mat.data32F : mat.data;
  const expectedLength = width * height * 3;
  if (!source || source.length !== expectedLength) {
    throw new Error("Focus input has an invalid aligned RGB buffer.");
  }

  const output = new Uint16Array(expectedLength);
  if (hasLinearProPhoto) {
    for (let i = 0; i < source.length; i += 1) {
      output[i] = Math.round(Math.sqrt(clamp01(source[i])) * RESULT_BUFFER_MAX_UINT16);
    }
    return output;
  }

  const convertRgb8 = createRgb8ToLinearProphotoConverter(sourceColorSpace);
  const converted = new Float32Array(3);
  for (let i = 0; i < source.length; i += 3) {
    convertRgb8(source[i], source[i + 1], source[i + 2], converted);
    output[i] = Math.round(Math.sqrt(clamp01(converted[0])) * RESULT_BUFFER_MAX_UINT16);
    output[i + 1] = Math.round(Math.sqrt(clamp01(converted[1])) * RESULT_BUFFER_MAX_UINT16);
    output[i + 2] = Math.round(Math.sqrt(clamp01(converted[2])) * RESULT_BUFFER_MAX_UINT16);
  }
  return output;
}

async function storeFocusRgbTiles(db, sessionId, imageIndex, stored, width, height, imageCount) {
  const tileColumns = Math.ceil(width / FOCUS_TILE_SIZE);
  const tileRows = Math.ceil(height / FOCUS_TILE_SIZE);
  const tileCount = tileColumns * tileRows;
  let tileNumber = 0;
  for (let tileY = 0; tileY < tileRows; tileY += 1) {
    const y0 = tileY * FOCUS_TILE_SIZE;
    const tileHeight = Math.min(FOCUS_TILE_SIZE, height - y0);
    for (let tileX = 0; tileX < tileColumns; tileX += 1) {
      const x0 = tileX * FOCUS_TILE_SIZE;
      const tileWidth = Math.min(FOCUS_TILE_SIZE, width - x0);
      const tile = new Uint16Array(tileWidth * tileHeight * 3);
      const rowLength = tileWidth * 3;
      for (let localY = 0; localY < tileHeight; localY += 1) {
        const sourceStart = ((y0 + localY) * width + x0) * 3;
        const targetStart = localY * rowLength;
        tile.set(stored.subarray(sourceStart, sourceStart + rowLength), targetStart);
      }
      tileNumber += 1;
      setProgress(
        `Storing Focus RGB ${imageIndex + 1}/${imageCount}, tile ${tileNumber}/${tileCount} (${tileWidth}x${tileHeight})...`,
      );
      try {
        await putMedianScratchTile(
          db,
          medianScratchTileKey(sessionId, imageIndex, tileX, tileY),
          tile.buffer,
        );
      } catch (error) {
        if (error && (error.name === "QuotaExceededError" || error.name === "UnknownError")) {
          throw new Error("Browser scratch storage is full while writing Focus RGB tiles.");
        }
        throw error;
      }
      await yieldToBrowser();
    }
  }
}

async function storeFocusSharpnessTiles(db, sessionId, imageIndex, sharpness, width, height, imageCount) {
  if (!(sharpness instanceof Float32Array) || sharpness.length !== width * height) {
    throw new Error("Focus worker returned an invalid full-image sharpness map.");
  }
  const tileColumns = Math.ceil(width / FOCUS_TILE_SIZE);
  const tileRows = Math.ceil(height / FOCUS_TILE_SIZE);
  const tileCount = tileColumns * tileRows;
  let tileNumber = 0;
  for (let tileY = 0; tileY < tileRows; tileY += 1) {
    const y0 = tileY * FOCUS_TILE_SIZE;
    const tileHeight = Math.min(FOCUS_TILE_SIZE, height - y0);
    for (let tileX = 0; tileX < tileColumns; tileX += 1) {
      const x0 = tileX * FOCUS_TILE_SIZE;
      const tileWidth = Math.min(FOCUS_TILE_SIZE, width - x0);
      const tile = new Float32Array(tileWidth * tileHeight);
      for (let localY = 0; localY < tileHeight; localY += 1) {
        const sourceStart = (y0 + localY) * width + x0;
        const targetStart = localY * tileWidth;
        tile.set(sharpness.subarray(sourceStart, sourceStart + tileWidth), targetStart);
      }
      tileNumber += 1;
      setProgress(
        `Storing Focus sharpness ${imageIndex + 1}/${imageCount}, tile ${tileNumber}/${tileCount}...`,
      );
      try {
        await putMedianScratchTile(
          db,
          focusSharpnessTileKey(sessionId, imageIndex, tileX, tileY),
          tile.buffer,
        );
      } catch (error) {
        if (error && (error.name === "QuotaExceededError" || error.name === "UnknownError")) {
          throw new Error("Browser scratch storage is full while writing Focus sharpness tiles.");
        }
        throw error;
      }
      await yieldToBrowser();
    }
  }
}

function getFocusSharpnessTiles(db, sessionId, imageCount, tileX, tileY) {
  return getScratchBuffers(
    db,
    Array.from({ length: imageCount }, (_, imageIndex) =>
      focusSharpnessTileKey(sessionId, imageIndex, tileX, tileY)),
    `Focus sharpness tile ${tileX},${tileY}`,
  ).then((buffers) => buffers.map((buffer) => new Float32Array(buffer)));
}

async function getFocusRgbAndSharpnessTiles(db, sessionId, imageCount, tileX, tileY) {
  const keys = [];
  for (let imageIndex = 0; imageIndex < imageCount; imageIndex += 1) {
    keys.push(medianScratchTileKey(sessionId, imageIndex, tileX, tileY));
  }
  for (let imageIndex = 0; imageIndex < imageCount; imageIndex += 1) {
    keys.push(focusSharpnessTileKey(sessionId, imageIndex, tileX, tileY));
  }
  const buffers = await getScratchBuffers(db, keys, `Focus tile ${tileX},${tileY}`);
  return {
    rgbTiles: buffers.slice(0, imageCount).map((buffer) => new Uint16Array(buffer)),
    sharpnessTiles: buffers.slice(imageCount).map((buffer) => new Float32Array(buffer)),
  };
}

async function computeFocusGlobalTau(db, sessionId, focusWorker, imageCount, width, height) {
  const tileColumns = Math.ceil(width / FOCUS_TILE_SIZE);
  const tileRows = Math.ceil(height / FOCUS_TILE_SIZE);
  const tileCount = tileColumns * tileRows;
  let tileNumber = 0;
  let sum = 0;
  let sumSq = 0;
  let count = 0;
  for (let tileY = 0; tileY < tileRows; tileY += 1) {
    for (let tileX = 0; tileX < tileColumns; tileX += 1) {
      tileNumber += 1;
      setProgress(`Analyzing Focus weights ${tileNumber}/${tileCount}...`);
      const sharpnessTiles = await getFocusSharpnessTiles(db, sessionId, imageCount, tileX, tileY);
      const stats = await focusWorker.computeTauStats(sharpnessTiles);
      sum += stats.sum;
      sumSq += stats.sumSq;
      count += stats.count;
      await yieldToBrowser();
    }
  }
  if (!(count > 0)) throw new Error("Focus sharpness statistics are empty.");
  const mean = sum / count;
  const variance = Math.max(0, sumSq / count - mean * mean);
  return Math.max(Math.sqrt(variance) * FOCUS_SMOOTHNESS, 1e-4);
}

async function mergeFocusScratchTiles(db, sessionId, focusWorker, imageCount, width, height) {
  if (!focusWorker) throw new Error("Focus worker is not initialized.");
  setProgress("Computing global Focus softmax scale...");
  const tau = await computeFocusGlobalTau(db, sessionId, focusWorker, imageCount, width, height);
  console.info(`Focus global tau=${tau.toFixed(6)}, smoothness=${FOCUS_SMOOTHNESS}`);

  const output = new Uint16Array(width * height * 3);
  const tileColumns = Math.ceil(width / FOCUS_TILE_SIZE);
  const tileRows = Math.ceil(height / FOCUS_TILE_SIZE);
  const tileCount = tileColumns * tileRows;
  let tileNumber = 0;
  for (let tileY = 0; tileY < tileRows; tileY += 1) {
    const y0 = tileY * FOCUS_TILE_SIZE;
    const tileHeight = Math.min(FOCUS_TILE_SIZE, height - y0);
    for (let tileX = 0; tileX < tileColumns; tileX += 1) {
      const x0 = tileX * FOCUS_TILE_SIZE;
      const tileWidth = Math.min(FOCUS_TILE_SIZE, width - x0);
      tileNumber += 1;
      setProgress(`Focus merging tile ${tileNumber}/${tileCount} (${tileWidth}x${tileHeight})...`);
      const { rgbTiles, sharpnessTiles } = await getFocusRgbAndSharpnessTiles(
        db,
        sessionId,
        imageCount,
        tileX,
        tileY,
      );
      const focusTile = await focusWorker.mergeTile(
        rgbTiles,
        sharpnessTiles,
        tileWidth,
        tileHeight,
        tau,
        FOCUS_PYRAMID_LEVELS,
      );
      const rowLength = tileWidth * 3;
      for (let localY = 0; localY < tileHeight; localY += 1) {
        const sourceStart = localY * rowLength;
        const targetStart = ((y0 + localY) * width + x0) * 3;
        output.set(focusTile.subarray(sourceStart, sourceStart + rowLength), targetStart);
      }
      await yieldToBrowser();
    }
  }
  return output;
}

function identityHomography() {
  return new Float64Array([
    1, 0, 0,
    0, 1, 0,
    0, 0, 1,
  ]);
}

function multiplyHomographies(left, right) {
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
    throw new Error("Composed ORB homography is invalid.");
  }
  for (let i = 0; i < result.length; i += 1) {
    result[i] /= denominator;
    if (!Number.isFinite(result[i])) {
      throw new Error("Composed ORB homography contains a non-finite value.");
    }
  }
  return result;
}

function logOrbAlignmentResult(fileName, result, context = "") {
  const fallbackDetail = result.fallbackMode && result.fallbackMode !== "none"
    ? `, fallback=${result.fallbackMode}`
    : "";
  const reprojectionDetail = Number.isFinite(result.reprojectionMedianError)
    ? `, reprojection=inliers ${result.reprojectionInlierCount}/${result.usableMatchCount}, ` +
      `median ${result.reprojectionMedianError.toFixed(2)}px, p95 ${result.reprojectionP95Error.toFixed(2)}px`
    : "";
  const shiftDetail = Number.isFinite(result.matchShiftLimit)
    ? ` @ ${(result.matchShiftLimit * 100).toFixed(0)}% shift`
    : "";
  const preprocessingDetail = Number.isFinite(result.referenceExposureGain) && Number.isFinite(result.targetExposureGain)
    ? `, preprocess=${result.exposureMatchSource || "unknown"} midpoint ` +
      `gains(ref=${result.referenceExposureGain.toFixed(3)}, target=${result.targetExposureGain.toFixed(3)}), ` +
      `bilateral, CLAHE=${Number(result.claheClipLimit || 0).toFixed(1)}`
    : "";
  const referenceFeatureDetail = Number.isFinite(result.referenceFeatureCount)
    ? `ref=${result.referenceFeatureCount}, target=${result.targetFeatureCount}`
    : `target=${result.targetFeatureCount}`;
  const contextDetail = context ? ` (${context})` : "";
  console.info(
    `${fileName}${contextDetail}: ORB features(${referenceFeatureDetail}), matches=${result.matchCount}, ` +
    `usable=${result.usableMatchCount}${shiftDetail}` +
    `${fallbackDetail}${reprojectionDetail}${preprocessingDetail}, ${describeHomography(result.matrix)}`,
  );
}

function describeMergeStep(index, total, mergePlan) {
  if (mergePlan.mode === "hdr1" || mergePlan.mode === "hdr2") {
    return `Preparing ${mergePlan.mode.toUpperCase()} exposure ${index + 1}/${total}...`;
  }
  if (mergePlan.mode === "median") {
    return `Storing aligned denoise tiles ${index + 1}/${total}...`;
  }
  if (mergePlan.mode === "focus") {
    return `Preparing focus image ${index + 1}/${total}...`;
  }
  if (mergePlan.mode === "stf") {
    return `Applying STF ${index + 1}/${total}...`;
  }
  return `Blending image ${index + 1}/${total}...`;
}


function copyMatBytes(mat, expectedLength) {
  if (!mat.data || mat.data.length < expectedLength) {
    throw new Error("OpenCV returned an invalid grayscale image buffer.");
  }
  return new Uint8Array(mat.data.slice(0, expectedLength));
}

function describeHomography(m) {
  const scaleX = Math.hypot(m[0], m[1]);
  const scaleY = Math.hypot(m[4], m[3]);
  const angle = Math.atan2(m[3], m[0]) * 180 / Math.PI;
  return `translation=(${m[2].toFixed(2)}, ${m[5].toFixed(2)}), scale=(${scaleX.toFixed(4)}, ${scaleY.toFixed(4)}), rotation=${angle.toFixed(2)}deg`;
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

function linearProPhotoMatToFloatsAndBrightness(mat) {
  const linear = mat.data32F;
  if (!linear || linear.length !== mat.rows * mat.cols * 3) {
    throw new Error("OpenCV returned an invalid linear ProPhoto RGB matrix.");
  }
  const floats = new Float32Array(linear.length);
  let brightnessSum = 0;
  const pixelCount = linear.length / 3;
  for (let i = 0; i < linear.length; i += 3) {
    const r = clamp01(linear[i]);
    const g = clamp01(linear[i + 1]);
    const b = clamp01(linear[i + 2]);
    brightnessSum += 0.299 * r + 0.587 * g + 0.114 * b;
    floats[i] = r;
    floats[i + 1] = g;
    floats[i + 2] = b;
  }
  return { floats, brightness: pixelCount > 0 ? brightnessSum / pixelCount : 0 };
}


function linearProPhotoMatToHdr2FloatsAndBrightness(mat) {
  const linear = mat.data32F;
  if (!linear || linear.length !== mat.rows * mat.cols * 3) {
    throw new Error("OpenCV returned an invalid linear ProPhoto RGB matrix.");
  }
  return linearProPhotoArrayToHdr2FloatsAndBrightness(linear);
}

function mergeLinearProPhotoMatIntoAccumulator(mat, accumulator, gain, weight) {
  const source = mat.data32F;
  if (!source || source.length !== accumulator.length) {
    throw new Error("OpenCV returned an invalid linear ProPhoto RGB matrix.");
  }
  if (Number.isFinite(gain) && gain > 0 && Math.abs(gain - 1) > 1e-6) {
    const adjusted = new Float32Array(source);
    applyExposureAndRolloffInPlace(adjusted, gain);
    addWeightedLinearToAccumulator(accumulator, adjusted, weight);
    return;
  }
  addWeightedLinearToAccumulator(accumulator, source, weight);
}

function rgbMatToLinearProPhotoFloatsAndBrightness(rgb, sourceColorSpace) {
  const linear = rgbMatToLinearProPhoto(rgb, sourceColorSpace);
  const floats = new Float32Array(linear.length);
  let brightnessSum = 0;
  const pixelCount = linear.length / 3;

  for (let i = 0; i < linear.length; i += 3) {
    const r = clamp01(linear[i]);
    const g = clamp01(linear[i + 1]);
    const b = clamp01(linear[i + 2]);
    brightnessSum += 0.299 * r + 0.587 * g + 0.114 * b;
    floats[i] = r;
    floats[i + 1] = g;
    floats[i + 2] = b;
  }

  return {
    floats,
    brightness: pixelCount > 0 ? brightnessSum / pixelCount : 0,
  };
}


function rgbMatToHdr2FloatsAndBrightness(rgb, sourceColorSpace) {
  const linear = rgbMatToLinearProPhoto(rgb, sourceColorSpace);
  return linearProPhotoArrayToHdr2FloatsAndBrightness(linear);
}

function mergeHdrDebevecReinhardInWorker(images, exposureTimes, brightnesses, width, height) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL("/generated/local-stack-studio/hdr.worker.js", window.location.origin));
    let settled = false;
    const cleanup = () => worker.terminate();
    worker.onmessage = (event) => {
      const message = event.data || {};
      if (message.type === "progress") {
        if (message.message) setProgress(message.message);
        return;
      }
      if (message.type === "result") {
        settled = true;
        cleanup();
        resolve(new Float32Array(message.linearProPhotoBuffer));
        return;
      }
      if (message.type === "error") {
        settled = true;
        cleanup();
        reject(new Error(message.message || "HDR worker failed."));
      }
    };
    worker.onerror = (event) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(new Error(event.message || "HDR worker failed."));
    };

    const imageBuffers = images.map((image) => image.buffer);
    const times = exposureTimes ? new Float32Array(exposureTimes) : new Float32Array(0);
    const inputBrightnesses = new Float32Array(brightnesses);
    worker.postMessage(
      {
        type: "merge",
        width,
        height,
        imageBuffers,
        exposureTimesBuffer: times.buffer,
        brightnessesBuffer: inputBrightnesses.buffer,
      },
      [...imageBuffers, times.buffer, inputBrightnesses.buffer],
    );
  });
}

function mergeHdrMertensInWorker(images, brightnesses, width, height, preBrightnessSigmoidGain = 0) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL("/generated/local-stack-studio/hdr.worker.js", window.location.origin));
    let settled = false;
    const cleanup = () => worker.terminate();
    worker.onmessage = (event) => {
      const message = event.data || {};
      if (message.type === "progress") {
        if (message.message) setProgress(message.message);
        return;
      }
      if (message.type === "mertens-result") {
        settled = true;
        cleanup();
        // Keep the legacy transport field name for compatibility with the generated worker asset.
        // Its payload is linear ProPhoto RGB after the HDR2 processing-space gamma removal.
        resolve(new Float32Array(message.gamma2Buffer));
        return;
      }
      if (message.type === "error") {
        settled = true;
        cleanup();
        reject(new Error(message.message || "HDR2 Mertens worker failed."));
      }
    };
    worker.onerror = (event) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(new Error(event.message || "HDR2 Mertens worker failed."));
    };

    const imageBuffers = images.map((image) => image.buffer);
    const inputBrightnesses = new Float32Array(brightnesses);
    worker.postMessage(
      {
        type: "mertens",
        width,
        height,
        imageBuffers,
        brightnessesBuffer: inputBrightnesses.buffer,
        saturationWeight: SINGLE_SHOT_HDR_SATURATION_WEIGHT,
        exposureWeight: SINGLE_SHOT_HDR_EXPOSURE_WEIGHT,
        preBrightnessSigmoidGain,
      },
      [...imageBuffers, inputBrightnesses.buffer],
    );
  });
}

async function processSingleInputHdrWithOpenCv(cv, file, inputInfo, mergePlan, outputColorSpace) {
  setProgress(`${inputInfo.isRaw ? "Developing RAW" : "Reading image"} 1/1...`);
  const decoded = await decodeFileToDecodedImage(file, inputInfo);
  const imageData = decoded.alignmentImageData || decoded.imageData;
  const width = decoded.width || imageData.width;
  const height = decoded.height || imageData.height;
  let rgba = null;
  let rgb = null;
  let baseLinear = null;

  try {
    if (decoded.linearProPhotoRgb instanceof Float32Array) {
      baseLinear = decoded.linearProPhotoRgb;
      decoded.linearProPhotoRgb = null;
    } else {
      rgba = cv.matFromImageData(imageData);
      rgb = new cv.Mat();
      cv.cvtColor(rgba, rgb, cv.COLOR_RGBA2RGB);
      baseLinear = rgbMatToLinearProPhoto(rgb, inputInfo.sourceColorSpace);
    }

    const materials = mergePlan.syntheticMaterials;
    const expectedMaterialCount = 3;
    if (!Array.isArray(materials) || materials.length !== expectedMaterialCount) {
      throw new Error(`Single-input ${mergePlan.mode.toUpperCase()} requires ${expectedMaterialCount} synthetic materials.`);
    }

    const contrastStretch = prepareSingleShotHdrContrastStretch(baseLinear, width, height);

    if (mergePlan.mode === "hdr1") {
      const hdrBase = buildSingleShotHdrBaseLinear(baseLinear, width, height, contrastStretch, false);
      const hdrBaseLinear = hdrBase.linear;
      const images = [];
      const brightnesses = new Float32Array(materials.length);
      brightnesses.fill(computeAverageBrightnessFromLinear(hdrBaseLinear));
      for (let i = 0; i < materials.length; i += 1) {
        const material = materials[i];
        setProgress(`Preparing HDR1 synthetic material ${i + 1}/${materials.length} (${material.label})...`);
        images.push(buildSingleShotHdr1Material(hdrBaseLinear, material));
        await yieldToBrowser();
      }
      const linearResult = await mergeHdrDebevecReinhardInWorker(
        images,
        mergePlan.hdrExposureTimes,
        brightnesses,
        width,
        height,
      );
      return finalizeStoredResult(linearResult, width, height, outputColorSpace);
    }

    if (mergePlan.mode !== "hdr2") {
      throw new Error(`Unsupported single-input HDR mode: ${mergePlan.mode}`);
    }

    const hdrBase = buildSingleShotHdrBaseLinear(baseLinear, width, height, contrastStretch, true);
    const hdrBaseLinear = hdrBase.linear;
    const images = [];
    const brightnesses = new Float32Array(materials.length);
    brightnesses.fill(computeAverageBrightnessFromLinear(hdrBaseLinear));
    for (let i = 0; i < materials.length; i += 1) {
      const material = materials[i];
      setProgress(`Preparing HDR2 synthetic material ${i + 1}/${materials.length} (${material.label})...`);
      images.push(buildSingleShotHdr2Material(hdrBaseLinear, hdrBase.p998, material));
      await yieldToBrowser();
    }
    setProgress("Merging HDR2 with Mertens exposure fusion...");
    const linearResult = await mergeHdrMertensInWorker(images, brightnesses, width, height, 2);
    return finalizeStoredResult(linearResult, width, height, outputColorSpace);
  } finally {
    if (rgb) rgb.delete();
    if (rgba) rgba.delete();
  }
}

function buildSingleShotHdr1Material(sourceLinear, material) {
  const adjusted = applySingleShotHdrExposureToLinear(sourceLinear, null, material, false);
  const floats = new Float32Array(adjusted.length);
  for (let i = 0; i < adjusted.length; i += 3) {
    floats[i] = clamp01(applySigmoidLinearAtMidpoint(adjusted[i], material.sigmoidGain, material.sigmoidMidpoint));
    floats[i + 1] = clamp01(applySigmoidLinearAtMidpoint(adjusted[i + 1], material.sigmoidGain, material.sigmoidMidpoint));
    floats[i + 2] = clamp01(applySigmoidLinearAtMidpoint(adjusted[i + 2], material.sigmoidGain, material.sigmoidMidpoint));
  }
  return floats;
}

function buildSingleShotHdr2Material(sourceLinear, baseP998, material) {
  const adjusted = applySingleShotHdrExposureToLinear(sourceLinear, baseP998, material, true);
  const floats = new Float32Array(adjusted.length);
  for (let i = 0; i < adjusted.length; i += 3) {
    floats[i] = clamp01(applySigmoidLinearAtMidpoint(adjusted[i], material.sigmoidGain, material.sigmoidMidpoint));
    floats[i + 1] = clamp01(applySigmoidLinearAtMidpoint(adjusted[i + 1], material.sigmoidGain, material.sigmoidMidpoint));
    floats[i + 2] = clamp01(applySigmoidLinearAtMidpoint(adjusted[i + 2], material.sigmoidGain, material.sigmoidMidpoint));
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
    brightnessSum += 0.299 * sourceLinear[i] + 0.587 * sourceLinear[i + 1] + 0.114 * sourceLinear[i + 2];
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
    const r = applySigmoidLinear(linear[i], MULTI_SHOT_HDR2_SIGMOID_GAIN);
    const g = applySigmoidLinear(linear[i + 1], MULTI_SHOT_HDR2_SIGMOID_GAIN);
    const b = applySigmoidLinear(linear[i + 2], MULTI_SHOT_HDR2_SIGMOID_GAIN);
    brightnessSum += 0.299 * r + 0.587 * g + 0.114 * b;
    floats[i] = clamp01(r);
    floats[i + 1] = clamp01(g);
    floats[i + 2] = clamp01(b);
  }
  return { floats, brightness: pixelCount > 0 ? brightnessSum / pixelCount : 0 };
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

function finalizeStoredResult(source, width, height, outputColorSpace) {
  const gamma2ProPhotoRgb16 = encodeLinearToStoredGamma2(source);
  return finalizeStoredGamma2Result(gamma2ProPhotoRgb16, width, height, outputColorSpace);
}

function finalizeStoredGamma2Result(gamma2ProPhotoRgb16, width, height, outputColorSpace) {
  if (!(gamma2ProPhotoRgb16 instanceof Uint16Array) || gamma2ProPhotoRgb16.length !== width * height * 3) {
    throw new Error("Stored gamma-2 result has an invalid Uint16 RGB buffer.");
  }
  const linear = decodeStoredGamma2ToLinear(gamma2ProPhotoRgb16);
  setProgress(`Preparing ${formatColorSpaceName(outputColorSpace)} preview buffer...`);
  const preview = buildPreviewLinearProPhotoForTargetPixels(linear, width, height, PREVIEW_TARGET_PIXELS);
  const analysis = buildPreviewLinearProPhotoForTargetPixels(linear, width, height, TONE_ANALYSIS_TARGET_PIXELS);
  const exposureRolloffBaseP998 = estimateMaxChannelPercentileSampled(linear, width, height, 0.998, 256);
  return {
    width,
    height,
    gamma2ProPhotoRgb16,
    previewLinearProPhotoRgb: preview.data,
    previewWidth: preview.width,
    previewHeight: preview.height,
    analysisLinearProPhotoRgb: analysis.data,
    previewRgba8: new Uint8ClampedArray(preview.width * preview.height * 4),
    exposureRolloffBaseP998,
  };
}

function mergeRgbIntoAccumulator(rgb, accumulator, sourceColorSpace, gain, weight) {
  const linear = rgbMatToLinearProPhoto(rgb, sourceColorSpace);
  applyExposureAndRolloffInPlace(linear, gain);
  addWeightedLinearToAccumulator(accumulator, linear, weight);
}

function rgbMatToLinearProPhoto(rgb, sourceColorSpace) {
  if (!rgb.data || rgb.data.length !== rgb.rows * rgb.cols * 3) {
    throw new Error("OpenCV returned an invalid RGB image buffer.");
  }
  const source = rgb.data;
  const result = new Float32Array(source.length);
  const convertRgb8 = createRgb8ToLinearProphotoConverter(sourceColorSpace);
  const converted = new Float32Array(3);
  for (let i = 0; i < source.length; i += 3) {
    convertRgb8(source[i], source[i + 1], source[i + 2], converted);
    result[i] = converted[0];
    result[i + 1] = converted[1];
    result[i + 2] = converted[2];
  }
  return result;
}

function applyExposureAndRolloffInPlace(linear, gain, exposureRolloffBaseP998 = null) {
  if (!(Number.isFinite(gain) && gain > 0) || gain === 1) {
    return;
  }

  if (gain <= 1) {
    for (let i = 0; i < linear.length; i += 1) {
      linear[i] *= gain;
    }
    return;
  }

  let maxVal = Number.isFinite(exposureRolloffBaseP998)
    ? exposureRolloffBaseP998 * gain
    : null;

  if (!(Number.isFinite(maxVal) && maxVal > 0)) {
    const pixelCount = linear.length / 3;
    const maxima = new Float32Array(pixelCount);
    for (let pixelIndex = 0, sourceIndex = 0; pixelIndex < pixelCount; pixelIndex += 1, sourceIndex += 3) {
      const r = linear[sourceIndex] * gain;
      const g = linear[sourceIndex + 1] * gain;
      const b = linear[sourceIndex + 2] * gain;
      linear[sourceIndex] = r;
      linear[sourceIndex + 1] = g;
      linear[sourceIndex + 2] = b;
      maxima[pixelIndex] = Math.max(r, g, b);
    }
    maxVal = percentileFromFloatArray(maxima, 0.998);
  } else {
    for (let i = 0; i < linear.length; i += 1) {
      linear[i] *= gain;
    }
  }

  const rolloff = rolloffParams(maxVal);
  if (!rolloff) return;
  for (let i = 0; i < linear.length; i += 1) {
    const value = linear[i];
    if (value > rolloff.inflection) {
      linear[i] = rolloff.inflection + (value - rolloff.inflection) * rolloff.scale;
    }
  }
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

function addWeightedLinearToAccumulator(accumulator, linear, weight) {
  for (let i = 0; i < accumulator.length; i += 1) {
    accumulator[i] += linear[i] * weight;
  }
}

function buildPreviewLinearProPhotoForTargetPixels(source, width, height, targetPixels) {
  const scale = Math.min(1, Math.sqrt(targetPixels / Math.max(1, width * height)));
  const maxDimension = Math.max(1, Math.round(Math.max(width, height) * scale));
  return buildPreviewLinearProPhoto(source, width, height, maxDimension);
}

function buildPreviewLinearProPhoto(source, width, height, maxDimension) {
  const sourceMax = Math.max(width, height);
  if (!(sourceMax > maxDimension)) {
    return {
      data: new Float32Array(source),
      width,
      height,
    };
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
      previewData[dst] = source[s00] * w00 + source[s10] * w10 + source[s01] * w01 + source[s11] * w11;
      previewData[dst + 1] = source[s00 + 1] * w00 + source[s10 + 1] * w10 + source[s01 + 1] * w01 + source[s11 + 1] * w11;
      previewData[dst + 2] = source[s00 + 2] * w00 + source[s10 + 2] * w10 + source[s01 + 2] * w01 + source[s11 + 2] * w11;
    }
  }

  return {
    data: previewData,
    width: previewWidth,
    height: previewHeight,
  };
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
  const iccProfile = await extractEmbeddedIccProfile(lowerName, buffer);
  const sourceColorSpace = classifyIccProfile(iccProfile, lowerName);

  if (isTiffFile(lowerName, file.type)) {
    const tiffInfo = await parseTiffInfo(buffer);
    return {
      fNumber: tiffInfo.fNumber,
      exposureTime: tiffInfo.exposureTime,
      iso: tiffInfo.iso,
      exposureScalar: tiffInfo.exposureScalar,
      sourceColorSpace,
      isRaw: false,
      width: tiffInfo.width,
      height: tiffInfo.height,
    };
  }

  const dimensions = await readBitmapDimensions(file);

  if (/^image\/jpe?g$/i.test(file.type) || /\.(jpe?g)$/i.test(lowerName)) {
    const exif = parseJpegExif(buffer);
    return {
      ...exif,
      sourceColorSpace,
      isRaw: false,
      width: dimensions.width,
      height: dimensions.height,
    };
  }

  return {
    fNumber: null,
    exposureTime: null,
    iso: null,
    exposureScalar: null,
    sourceColorSpace,
    isRaw: false,
    width: dimensions.width,
    height: dimensions.height,
  };
}

async function readRawInputInfo(file) {
  let raw = null;
  let workerFailure = null;
  try {
    raw = await createLibRawInstance();
    workerFailure = createLibRawWorkerFailure(raw);
    await Promise.race([
      raw.open(new Uint8Array(await file.arrayBuffer())),
      workerFailure.promise,
    ]);
    const metadata = await Promise.race([raw.metadata(false), workerFailure.promise]);
    const exposureTime = positiveNumberOrNull(metadata?.shutter);
    const fNumber = positiveNumberOrNull(metadata?.aperture);
    const iso = positiveNumberOrNull(metadata?.iso_speed);
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
    return {
      fNumber,
      exposureTime,
      iso,
      exposureScalar,
      sourceColorSpace: "prophoto-rgb",
      isRaw: true,
      lensMetadata: rawLensMetadata(metadata),
      width: dimensions.width,
      height: dimensions.height,
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

async function parseTiffInfo(buffer) {
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
  const iccProfile = getTiffTagBytes(ifd, 34675);
  const exposureTime = getFirstNumericTagValue(ifd, [33434]);
  const fNumber = getFirstNumericTagValue(ifd, [33437]);
  const iso = getFirstNumericTagValue(ifd, [34855]);
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
    width: Math.round(Number(ifd.width) || 0),
    height: Math.round(Number(ifd.height) || 0),
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
  let expectedCount = 0;

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
        const total = view.getUint8(segmentStart + 13);
        const payload = new Uint8Array(buffer, segmentStart + 14, segmentDataLength - 14);
        chunks.push({ sequence, payload: new Uint8Array(payload) });
        expectedCount = total;
      }
    }

    offset += segmentLength;
  }

  if (chunks.length === 0) return null;
  chunks.sort((a, b) => a.sequence - b.sequence);
  if (expectedCount && chunks.length !== expectedCount) {
    console.warn("Incomplete JPEG ICC profile; proceeding with available segments.");
  }
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
  if (typeof DecompressionStream !== "function") {
    console.warn("DecompressionStream is unavailable; PNG ICC profiles will be ignored.");
    return null;
  }
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("deflate"));
  const arrayBuffer = await new Response(stream).arrayBuffer();
  return new Uint8Array(arrayBuffer);
}

function classifyIccProfile(iccProfile, lowerName) {
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
  console.warn(`Unknown ICC profile in ${lowerName}; assuming sRGB.`);
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

function chooseOutputColorSpace(inputInfos) {
  return inputInfos.some((info) => info.sourceColorSpace !== "srgb") ? "display-p3" : "srgb";
}

function normalizeDecodedImageForAlignment(cv, decoded, alignmentMode, targetWidth, targetHeight) {
  if (
    alignmentMode === "feature-match" ||
    (decoded.width === targetWidth && decoded.height === targetHeight)
  ) {
    return decoded;
  }

  if (decoded.linearProPhotoRgb instanceof Float32Array) {
    const linearProPhotoRgb = transformLinearProPhotoForAlignment(
      cv,
      decoded.linearProPhotoRgb,
      decoded.width,
      decoded.height,
      targetWidth,
      targetHeight,
      alignmentMode,
    );
    return {
      width: targetWidth,
      height: targetHeight,
      sourceColorSpace: decoded.sourceColorSpace,
      linearProPhotoRgb,
      alignmentImageData: linearProPhotoToAlignmentImageData(
        linearProPhotoRgb,
        targetWidth,
        targetHeight,
      ),
    };
  }

  const sourceImageData = decoded.alignmentImageData || decoded.imageData;
  if (!sourceImageData) {
    throw new Error("Decoded image does not contain pixel data.");
  }
  return {
    width: targetWidth,
    height: targetHeight,
    sourceColorSpace: decoded.sourceColorSpace,
    imageData: transformImageDataForAlignment(
      sourceImageData,
      targetWidth,
      targetHeight,
      alignmentMode,
    ),
  };
}

function transformImageDataForAlignment(sourceImageData, targetWidth, targetHeight, alignmentMode) {
  const sourceCanvas = document.createElement("canvas");
  sourceCanvas.width = sourceImageData.width;
  sourceCanvas.height = sourceImageData.height;
  const sourceContext = sourceCanvas.getContext("2d", { willReadFrequently: true });
  if (!sourceContext) throw new Error("Could not create a 2D canvas context.");
  sourceContext.putImageData(sourceImageData, 0, 0);

  const outputCanvas = document.createElement("canvas");
  outputCanvas.width = targetWidth;
  outputCanvas.height = targetHeight;
  const outputContext = outputCanvas.getContext("2d", { willReadFrequently: true });
  if (!outputContext) throw new Error("Could not create a 2D canvas context.");
  outputContext.imageSmoothingEnabled = true;
  outputContext.imageSmoothingQuality = "high";

  if (alignmentMode === "center-crop") {
    const sx = Math.floor((sourceImageData.width - targetWidth) / 2);
    const sy = Math.floor((sourceImageData.height - targetHeight) / 2);
    outputContext.drawImage(
      sourceCanvas,
      sx,
      sy,
      targetWidth,
      targetHeight,
      0,
      0,
      targetWidth,
      targetHeight,
    );
  } else {
    const scale = Math.max(
      targetWidth / sourceImageData.width,
      targetHeight / sourceImageData.height,
    );
    const drawWidth = Math.max(targetWidth, Math.round(sourceImageData.width * scale));
    const drawHeight = Math.max(targetHeight, Math.round(sourceImageData.height * scale));
    const dx = Math.floor((targetWidth - drawWidth) / 2);
    const dy = Math.floor((targetHeight - drawHeight) / 2);
    outputContext.drawImage(sourceCanvas, dx, dy, drawWidth, drawHeight);
  }
  return outputContext.getImageData(0, 0, targetWidth, targetHeight);
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
  const sourceMat = matFromLinearProPhoto(cv, linearProPhotoRgb, sourceWidth, sourceHeight);
  let resized = null;
  let roi = null;
  let transformed = null;
  try {
    if (alignmentMode === "center-crop") {
      const cropX = Math.floor((sourceWidth - targetWidth) / 2);
      const cropY = Math.floor((sourceHeight - targetHeight) / 2);
      roi = sourceMat.roi(new cv.Rect(cropX, cropY, targetWidth, targetHeight));
      transformed = roi.clone();
    } else {
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
    console.info(`${file.name}: using LibRaw decoder path`);
    return await decodeRawFileToDecodedImage(file, inputInfo?.lensMetadata || null);
  }
  if (inputInfo.isRaw) {
    // Metadata classification must never send a RAW file through the browser
    // image decoder. Keep this fallback explicit in case MIME/extension
    // handling changes later.
    console.info(`${file.name}: using LibRaw decoder path from metadata classification`);
    return await decodeRawFileToDecodedImage(file, inputInfo?.lensMetadata || null);
  }

  if (isTiffFile(lowerName, file.type)) {
    const buffer = await file.arrayBuffer();
        const ifds = UTIF.decode(buffer);
    if (!ifds || ifds.length === 0) {
      throw new Error(`Failed to parse TIFF structure from ${file.name}.`);
    }
    const ifd = ifds[0];
    UTIF.decodeImage(buffer, ifd);

    const linearProPhotoRgb = decodeTiff16RgbToLinearProPhoto(
      buffer,
      ifd,
      inputInfo.sourceColorSpace,
    );
    if (linearProPhotoRgb) {
      console.info(`${file.name}: preserving 16-bit TIFF samples through the linear Float32 path`);
      const alignmentImageData = linearProPhotoToAlignmentImageData(
        linearProPhotoRgb,
        ifd.width,
        ifd.height,
      );
      return {
        width: ifd.width,
        height: ifd.height,
        sourceColorSpace: "prophoto-rgb",
        linearProPhotoRgb,
        alignmentImageData,
      };
    }

    const rgbaBytes = UTIF.toRGBA8(ifd);
    const imageData = new ImageData(new Uint8ClampedArray(rgbaBytes), ifd.width, ifd.height);
    return { imageData, sourceColorSpace: inputInfo.sourceColorSpace, width: ifd.width, height: ifd.height };
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

  const width = Math.max(0, Math.round(Number(ifd.width) || 0));
  const height = Math.max(0, Math.round(Number(ifd.height) || 0));
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

async function decodeRawFileToDecodedImage(file, knownLensMetadata = null) {
  let raw = null;
  let workerFailure = null;
  try {
    raw = await createLibRawInstance();
    workerFailure = createLibRawWorkerFailure(raw);
    await Promise.race([
      raw.open(new Uint8Array(await file.arrayBuffer()), RAW_DECODE_SETTINGS),
      workerFailure.promise,
    ]);

    let lensMetadata = knownLensMetadata;
    if (!lensMetadata) {
      try {
        const metadata = await Promise.race([raw.metadata(false), workerFailure.promise]);
        lensMetadata = rawLensMetadata(metadata);
      } catch {
        lensMetadata = null;
      }
    }

    const image = await Promise.race([raw.imageData(), workerFailure.promise]);
    if (!image || !image.width || !image.height || !image.data) {
      throw new Error("RAW decode failed");
    }
    let linearProPhotoRgb = libRawImageDataToLinearProPhoto(image);

    if (lensMetadata) {
      try {
        setProgress("Correcting lens with LensFun...");
        const correction = await buildRawLensfunCorrection(lensMetadata, image.width, image.height);
        if (correction) {
          const summary = summarizeLensfunCorrection(correction, image.width, image.height);
          linearProPhotoRgb = await applyLensfunCorrectionToLinearRgb(
            linearProPhotoRgb,
            image.width,
            image.height,
            correction,
            (progress) => setProgress(`Correcting lens with LensFun... ${Math.round(progress * 100)}%`),
          );
          const parts = [summary.lensLabel];
          if (Number.isFinite(summary.distortionPercent)) parts.push(`distortion=${summary.distortionPercent.toFixed(1)}%`);
          if (Number.isFinite(summary.tcaRedPercent) || Number.isFinite(summary.tcaBluePercent)) {
            const r = Number.isFinite(summary.tcaRedPercent) ? `${summary.tcaRedPercent.toFixed(3)}%` : "n/a";
            const b = Number.isFinite(summary.tcaBluePercent) ? `${summary.tcaBluePercent.toFixed(3)}%` : "n/a";
            parts.push(`TCA R=${r} B=${b}`);
          }
          if (Number.isFinite(summary.vignettingEv)) parts.push(`vignetting=${summary.vignettingEv.toFixed(2)}EV`);
          console.info(`${file.name}: LensFun correction applied (${parts.join(", ")})`);
        }
      } catch (error) {
        console.warn(`${file.name}: LensFun correction skipped`, error);
      }
    }

    const alignmentImageData = linearProPhotoToAlignmentImageData(
      linearProPhotoRgb,
      image.width,
      image.height,
    );
    return {
      width: image.width,
      height: image.height,
      sourceColorSpace: "prophoto-rgb",
      linearProPhotoRgb,
      alignmentImageData,
    };
  } catch (error) {
    const detail = error instanceof Error ? `: ${error.message}` : "";
    throw new Error(`Failed to develop RAW image ${file.name}${detail}`);
  } finally {
    workerFailure?.cleanup?.();
    raw?.dispose?.();
  }
}

function libRawImageDataToLinearProPhoto(image) {
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
  const scale = maxSample > 0 ? 1 / maxSample : 1 / 65535;
  const linear = new Float32Array(pixelCount * 3);
  for (let pixelIndex = 0; pixelIndex < pixelCount; pixelIndex += 1) {
    const sourceIndex = pixelIndex * colors;
    const destinationIndex = pixelIndex * 3;
    const r = Number(source[sourceIndex] ?? 0);
    const g = Number(source[sourceIndex + (colors >= 2 ? 1 : 0)] ?? r);
    const b = Number(source[sourceIndex + (colors >= 3 ? 2 : colors >= 2 ? 1 : 0)] ?? g);
    linear[destinationIndex] = r * scale;
    linear[destinationIndex + 1] = g * scale;
    linear[destinationIndex + 2] = b * scale;
  }
  return linear;
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
  inputFiles.disabled = processing;
  mergeMode.disabled = processing;
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
  resultPanel.classList.add("hidden");
}

function clearError() {
  errorPanel.textContent = "";
  errorPanel.classList.add("hidden");
}

function showError(error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(error);
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
};
}
