import type { DecodedRgbImage16, ImageEditOutputColorProfile, LinearRgbSample } from "./types";
import { applyDefringeLinearRgbInto, applyDefringeToRenderedSample, type DefringeAnalysisMap } from "./defringe";
import { createCanvasImageData, getCanvas2dContext } from "./canvas";
import { convertLinearProPhotoToOutputRgbInto } from "@/image/color";
import { buildInteractiveColorAdjustmentContextFromLinearRgbSample } from "./analysis";
import {
  buildRenderedPixelToSourceTransform,
  createRgb16SamplingScratch,
  getAnalysisLinearRgbSample,
  sampleLinearRgb16BilinearInto,
} from "./sampling";
import type { LinearRgbBuffer } from "./sampling";
import {
  applyColorAdjustmentsAfterToneLinearRgbInto,
  applyColorAdjustmentsLinearRgbInto,
  applyLuminanceGainPreservingAboveOneLinearRgbInto,
  applyToneAdjustmentsLinearRgbInto,
  applyToneAdjustmentsLinearRgbRangeInto,
  clamp01,
  hasColorAdjustmentContextChanges,
  type ColorAdjustmentContext,
  type ToneAdjustmentStage,
} from "@/image/tone";
import {
  isUsableImageEditClarityMap,
  sampleImageEditClarityGain,
  type ImageEditClarityMap,
} from "./clarity";

type ImageEditClaritySourceGeometry = {
  sourceWidth: number;
  sourceHeight: number;
  sourceRect: { x: number; y: number; w: number; h: number };
  rotationDegrees: number;
};


const LINEAR_TO_SRGB_BYTE_LUT = buildLinearToSrgbByteLut(16384);

function buildLinearToSrgbByteLut(size: number): Uint8ClampedArray {
  const length = Math.max(2, Math.round(size));
  const lut = new Uint8ClampedArray(length);
  const scale = length - 1;
  for (let index = 0; index < length; index += 1) {
    const x = index / scale;
    const srgb = x <= 0.0031308 ? x * 12.92 : 1.055 * Math.pow(x, 1 / 2.4) - 0.055;
    lut[index] = Math.round(clamp01(srgb) * 255);
  }
  return lut;
}

function linearChannelToSrgbByteFromLut(linear: number): number {
  if (!(linear > 0)) return 0;
  if (linear >= 1) return 255;
  return LINEAR_TO_SRGB_BYTE_LUT[Math.round(linear * (LINEAR_TO_SRGB_BYTE_LUT.length - 1))] ?? 0;
}

function createCanvasImageDataFromReusableBuffer(
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  width: number,
  height: number,
  outputColorProfile: ImageEditOutputColorProfile,
  reusableRgba8: Uint8ClampedArray | null | undefined,
): ImageData {
  if (reusableRgba8 && reusableRgba8.length === width * height * 4) {
    const reusableBuffer = reusableRgba8.buffer;
    if (reusableBuffer instanceof ArrayBuffer) {
      const imageDataArray = new Uint8ClampedArray(
        reusableBuffer,
        reusableRgba8.byteOffset,
        reusableRgba8.byteLength,
      );
      try {
        return new ImageData(
          imageDataArray,
          width,
          height,
          { colorSpace: outputColorProfile } as unknown as ImageDataSettings,
        );
      } catch {
        try {
          return new ImageData(imageDataArray, width, height);
        } catch {}
      }
    }
  }
  return createCanvasImageData(ctx, width, height, outputColorProfile);
}

export type ImageEditPreviewSliderStage =
  | Exclude<ToneAdjustmentStage, "after-tone">
  | "clarity"
  | "color";

export function isTonePreviewSliderStage(
  stage: ImageEditPreviewSliderStage | null | undefined,
): stage is Exclude<ToneAdjustmentStage, "after-tone"> {
  return !!stage && stage !== "clarity" && stage !== "color";
}

export function buildImageEditPreviewSliderPrefixSample(
  sample: LinearRgbSample,
  context: ColorAdjustmentContext,
  stage: ImageEditPreviewSliderStage,
  clarityMap: ImageEditClarityMap | null = null,
  fullToneSample?: LinearRgbSample | null,
  _outputColorProfile: ImageEditOutputColorProfile = "srgb",
): LinearRgbSample {
  if (stage === "white-balance") return sample;
  if (stage === "clarity" && fullToneSample) return fullToneSample;

  const width = Math.max(1, Math.round(sample.width));
  const height = Math.max(1, Math.round(sample.height));
  const pixelCount = width * height;
  if (sample.data.length !== pixelCount * 3) return sample;

  const data = new Float32Array(sample.data.length);
  const valid = sample.valid;
  const activeClarityMap = isUsableImageEditClarityMap(clarityMap) ? clarityMap : null;
  const tonePrefixEnd: ToneAdjustmentStage = isTonePreviewSliderStage(stage)
    ? stage
    : "after-tone";
  const toneSource = !isTonePreviewSliderStage(stage) && fullToneSample
    && fullToneSample.width === width
    && fullToneSample.height === height
    && fullToneSample.data.length === sample.data.length
    ? fullToneSample.data
    : null;
  const adjusted: [number, number, number] = [0, 0, 0];

  for (let pixel = 0, si = 0; pixel < pixelCount; pixel += 1, si += 3) {
    if (valid && !valid[pixel]) continue;
    let r = toneSource ? (toneSource[si] ?? 0) : (sample.data[si] ?? 0);
    let g = toneSource ? (toneSource[si + 1] ?? 0) : (sample.data[si + 1] ?? 0);
    let b = toneSource ? (toneSource[si + 2] ?? 0) : (sample.data[si + 2] ?? 0);

    if (!toneSource) {
      applyToneAdjustmentsLinearRgbRangeInto(
        r,
        g,
        b,
        context,
        "white-balance",
        tonePrefixEnd,
        adjusted,
      );
      r = adjusted[0]; g = adjusted[1]; b = adjusted[2];
    }

    if (stage === "color" && activeClarityMap) {
      const clarityGain = activeClarityMap.width === width && activeClarityMap.height === height
        ? (activeClarityMap.gain[pixel] ?? 1)
        : sampleImageEditClarityGain(
            activeClarityMap,
            (pixel % width) + 0.5,
            Math.floor(pixel / width) + 0.5,
            width,
            height,
          );
      applyLuminanceGainPreservingAboveOneLinearRgbInto(r, g, b, clarityGain, adjusted);
      r = adjusted[0]; g = adjusted[1]; b = adjusted[2];
    }

    data[si] = Math.fround(r);
    data[si + 1] = Math.fround(g);
    data[si + 2] = Math.fround(b);
  }
  return { data, width, height, ...(valid ? { valid } : {}) };
}

// Pixel rendering is kept separate from React/UI state so later hot-loop optimization is isolated.

export function renderAdjustedLinearRgbSampleToCanvas(
  canvas: HTMLCanvasElement | OffscreenCanvas,
  renderedSample: LinearRgbSample,
  contextSample: LinearRgbSample,
  temperature: number,
  tint: number,
  exposureEv: number,
  shadow: number,
  highlight: number,
  scaledLog: number,
  sigmoid: number,
  vibrance: number,
  saturation: number,
  outputColorProfile: ImageEditOutputColorProfile = "srgb",
  clarityMap: ImageEditClarityMap | null = null,
  suppliedContext?: ColorAdjustmentContext,
  claritySourceGeometry?: ImageEditClaritySourceGeometry,
  preTonedSample?: LinearRgbSample,
  continuousEditStage?: ImageEditPreviewSliderStage,
  continuousPrefixSample?: LinearRgbSample,
  reusableRgba8?: Uint8ClampedArray | null,
) {
  const ctx = getCanvas2dContext(canvas, outputColorProfile);
  if (!ctx) throw new Error("2D context unavailable");
  const width = Math.max(1, canvas.width);
  const height = Math.max(1, canvas.height);
  const imageData = createCanvasImageDataFromReusableBuffer(
    ctx,
    width,
    height,
    outputColorProfile,
    reusableRgba8,
  );
  const output = imageData.data;
  const context = suppliedContext ?? buildInteractiveColorAdjustmentContextFromLinearRgbSample(
    contextSample,
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
  const activeClarityMap = isUsableImageEditClarityMap(clarityMap) ? clarityMap : null;
  const hasClarity = activeClarityMap !== null;
  const clarityTransform = hasClarity && claritySourceGeometry
    ? buildRenderedPixelToSourceTransform(
        claritySourceGeometry.sourceWidth,
        claritySourceGeometry.sourceHeight,
        claritySourceGeometry.sourceRect.x,
        claritySourceGeometry.sourceRect.y,
        width / Math.max(1, claritySourceGeometry.sourceRect.w),
        height / Math.max(1, claritySourceGeometry.sourceRect.h),
        claritySourceGeometry.rotationDegrees,
      )
    : null;
  const claritySameSize = !!activeClarityMap && !clarityTransform &&
    activeClarityMap.width === width && activeClarityMap.height === height;
  const data = renderedSample.data;
  const valid = renderedSample.valid;
  const reusableToneSample = hasClarity
    && preTonedSample
    && preTonedSample.width === renderedSample.width
    && preTonedSample.height === renderedSample.height
    && preTonedSample.data.length === renderedSample.data.length
    ? preTonedSample
    : null;
  const toneData = reusableToneSample?.data;
  const reusableContinuousPrefix = continuousEditStage
    && continuousPrefixSample
    && continuousPrefixSample.width === renderedSample.width
    && continuousPrefixSample.height === renderedSample.height
    && continuousPrefixSample.data.length === renderedSample.data.length
    ? continuousPrefixSample
    : null;
  const continuousData = reusableContinuousPrefix?.data;
  const pixelCount = Math.floor(data.length / 3);
  const converted: [number, number, number] = [0, 0, 0];
  const adjusted: [number, number, number] = [0, 0, 0];
  let di = 0;
  for (let pixel = 0; pixel < pixelCount; pixel++, di += 4) {
    if (valid && !valid[pixel]) {
      output[di] = 128;
      output[di + 1] = 128;
      output[di + 2] = 128;
      output[di + 3] = 255;
      continue;
    }
    const si = pixel * 3;
    let r: number;
    let g: number;
    let b: number;
    const stage = continuousData ? continuousEditStage : undefined;
    const useFullToneCache = hasClarity && toneData && (!stage || isTonePreviewSliderStage(stage));
    if (stage && continuousData && !useFullToneCache) {
      r = continuousData[si] ?? 0;
      g = continuousData[si + 1] ?? 0;
      b = continuousData[si + 2] ?? 0;
    } else if (useFullToneCache) {
      r = toneData[si] ?? 0;
      g = toneData[si + 1] ?? 0;
      b = toneData[si + 2] ?? 0;
    } else {
      r = data[si] ?? 0;
      g = data[si + 1] ?? 0;
      b = data[si + 2] ?? 0;
    }

    if (stage && continuousData && !useFullToneCache) {
      if (isTonePreviewSliderStage(stage)) {
        applyToneAdjustmentsLinearRgbRangeInto(r, g, b, context, stage, "after-tone", adjusted);
        r = adjusted[0]; g = adjusted[1]; b = adjusted[2];
      }

      if (stage !== "color") {
        if (hasClarity) {
          let clarityGain: number;
          if (clarityTransform && claritySourceGeometry) {
            const x = pixel % width;
            const y = Math.floor(pixel / width);
            const sourceX = clarityTransform.originX
              + x * clarityTransform.columnStepX
              + y * clarityTransform.rowStepX;
            const sourceY = clarityTransform.originY
              + x * clarityTransform.columnStepY
              + y * clarityTransform.rowStepY;
            clarityGain = sampleImageEditClarityGain(
              activeClarityMap,
              sourceX,
              sourceY,
              claritySourceGeometry.sourceWidth,
              claritySourceGeometry.sourceHeight,
            );
          } else if (claritySameSize) {
            clarityGain = activeClarityMap.gain[pixel] ?? 1;
          } else {
            const x = pixel % width;
            const y = Math.floor(pixel / width);
            clarityGain = sampleImageEditClarityGain(activeClarityMap, x + 0.5, y + 0.5, width, height);
          }
          applyLuminanceGainPreservingAboveOneLinearRgbInto(r, g, b, clarityGain, adjusted);
          r = adjusted[0]; g = adjusted[1]; b = adjusted[2];
        }
      }
      applyColorAdjustmentsAfterToneLinearRgbInto(
        r,
        g,
        b,
        context,
        hasClarity || hasColorAdjustmentContextChanges(context),
        adjusted,
      );
      r = adjusted[0]; g = adjusted[1]; b = adjusted[2];
    } else if (hasClarity) {
      if (!toneData) {
        applyToneAdjustmentsLinearRgbInto(r, g, b, context, adjusted);
        r = adjusted[0]; g = adjusted[1]; b = adjusted[2];
      }
      let clarityGain: number;
      if (clarityTransform && claritySourceGeometry) {
        const x = pixel % width;
        const y = Math.floor(pixel / width);
        const sourceX = clarityTransform.originX
          + x * clarityTransform.columnStepX
          + y * clarityTransform.rowStepX;
        const sourceY = clarityTransform.originY
          + x * clarityTransform.columnStepY
          + y * clarityTransform.rowStepY;
        clarityGain = sampleImageEditClarityGain(
          activeClarityMap,
          sourceX,
          sourceY,
          claritySourceGeometry.sourceWidth,
          claritySourceGeometry.sourceHeight,
        );
      } else if (claritySameSize) {
        clarityGain = activeClarityMap.gain[pixel] ?? 1;
      } else {
        const x = pixel % width;
        const y = Math.floor(pixel / width);
        clarityGain = sampleImageEditClarityGain(activeClarityMap, x + 0.5, y + 0.5, width, height);
      }
      applyLuminanceGainPreservingAboveOneLinearRgbInto(r, g, b, clarityGain, adjusted);
      r = adjusted[0]; g = adjusted[1]; b = adjusted[2];
      applyColorAdjustmentsAfterToneLinearRgbInto(r, g, b, context, true, adjusted);
      r = adjusted[0]; g = adjusted[1]; b = adjusted[2];
    } else {
      applyColorAdjustmentsLinearRgbInto(r, g, b, context, adjusted);
      r = adjusted[0]; g = adjusted[1]; b = adjusted[2];
    }
    convertLinearProPhotoToOutputRgbInto(r, g, b, outputColorProfile, converted);
    output[di] = linearChannelToSrgbByteFromLut(converted[0]);
    output[di + 1] = linearChannelToSrgbByteFromLut(converted[1]);
    output[di + 2] = linearChannelToSrgbByteFromLut(converted[2]);
    output[di + 3] = 255;
  }
  ctx.putImageData(imageData, 0, 0);
}

export function renderAdjustedRgb16RegionToCanvas(
  canvas: HTMLCanvasElement | OffscreenCanvas,
  decoded: DecodedRgbImage16,
  sourceRect: { x: number; y: number; w: number; h: number },
  fullOutputWidth: number,
  fullOutputHeight: number,
  regionX: number,
  regionY: number,
  rotationDegrees: number,
  temperature: number,
  tint: number,
  exposureEv: number,
  shadow: number,
  highlight: number,
  scaledLog: number,
  sigmoid: number,
  vibrance: number,
  saturation: number,
  outputColorProfile: ImageEditOutputColorProfile = "srgb",
  clarityMap: ImageEditClarityMap | null = null,
  defringeMap: DefringeAnalysisMap | null = null,
  defringeAmount = 0,
) {
  const ctx = getCanvas2dContext(canvas, outputColorProfile);
  if (!ctx) throw new Error("2D context unavailable");
  const width = Math.max(1, canvas.width);
  const height = Math.max(1, canvas.height);
  const fullWidth = Math.max(1, Math.round(fullOutputWidth));
  const fullHeight = Math.max(1, Math.round(fullOutputHeight));
  const imageData = createCanvasImageData(ctx, width, height, outputColorProfile);
  const output = imageData.data;
  const rawContextSample = getAnalysisLinearRgbSample(decoded, sourceRect, rotationDegrees);
  const contextSample = defringeMap && defringeAmount > 0
    ? applyDefringeToRenderedSample(
        rawContextSample,
        defringeMap,
        defringeAmount,
        decoded.width,
        decoded.height,
        sourceRect,
        rotationDegrees,
      )
    : rawContextSample;
  const context = buildInteractiveColorAdjustmentContextFromLinearRgbSample(
    contextSample,
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
  const activeClarityMap = isUsableImageEditClarityMap(clarityMap) ? clarityMap : null;
  const hasClarity = activeClarityMap !== null;
  const transform = buildRenderedPixelToSourceTransform(
    decoded.width,
    decoded.height,
    sourceRect.x,
    sourceRect.y,
    fullWidth / Math.max(1, sourceRect.w),
    fullHeight / Math.max(1, sourceRect.h),
    rotationDegrees,
  );
  const sample: LinearRgbBuffer = [0, 0, 0];
  const converted: [number, number, number] = [0, 0, 0];
  const adjusted: [number, number, number] = [0, 0, 0];
  const defringeConfidence: [number, number] = [0, 0];
  const samplingScratch = createRgb16SamplingScratch();
  let rowSourceX = transform.originX
    + regionX * transform.columnStepX
    + regionY * transform.rowStepX;
  let rowSourceY = transform.originY
    + regionX * transform.columnStepY
    + regionY * transform.rowStepY;
  let di = 0;
  for (let y = 0; y < height; y++) {
    let sourceX = rowSourceX;
    let sourceY = rowSourceY;
    for (let x = 0; x < width; x++, di += 4) {
      if (
        sourceX < 0 ||
        sourceX >= decoded.width ||
        sourceY < 0 ||
        sourceY >= decoded.height ||
        !sampleLinearRgb16BilinearInto(decoded, sourceX, sourceY, sample, samplingScratch)
      ) {
        output[di] = 128;
        output[di + 1] = 128;
        output[di + 2] = 128;
        output[di + 3] = 255;
      } else {
        let r = sample[0];
        let g = sample[1];
        let b = sample[2];
        if (defringeMap && defringeAmount > 0) {
          applyDefringeLinearRgbInto(
            r,
            g,
            b,
            defringeMap,
            defringeAmount,
            decoded.width > 1 ? sourceX / (decoded.width - 1) : 0.5,
            decoded.height > 1 ? sourceY / (decoded.height - 1) : 0.5,
            adjusted,
            defringeConfidence,
          );
          r = adjusted[0]; g = adjusted[1]; b = adjusted[2];
        }
        if (hasClarity) {
          applyToneAdjustmentsLinearRgbInto(r, g, b, context, adjusted);
          r = adjusted[0]; g = adjusted[1]; b = adjusted[2];
          const clarityGain = sampleImageEditClarityGain(
            activeClarityMap,
            sourceX,
            sourceY,
            decoded.width,
            decoded.height,
          );
          applyLuminanceGainPreservingAboveOneLinearRgbInto(r, g, b, clarityGain, adjusted);
          r = adjusted[0]; g = adjusted[1]; b = adjusted[2];
          applyColorAdjustmentsAfterToneLinearRgbInto(r, g, b, context, true, adjusted);
          r = adjusted[0]; g = adjusted[1]; b = adjusted[2];
        } else {
          applyColorAdjustmentsLinearRgbInto(r, g, b, context, adjusted);
          r = adjusted[0]; g = adjusted[1]; b = adjusted[2];
        }
        convertLinearProPhotoToOutputRgbInto(r, g, b, outputColorProfile, converted);
        output[di] = linearChannelToSrgbByteFromLut(converted[0]);
        output[di + 1] = linearChannelToSrgbByteFromLut(converted[1]);
        output[di + 2] = linearChannelToSrgbByteFromLut(converted[2]);
        output[di + 3] = 255;
      }
      sourceX += transform.columnStepX;
      sourceY += transform.columnStepY;
    }
    rowSourceX += transform.rowStepX;
    rowSourceY += transform.rowStepY;
  }
  ctx.putImageData(imageData, 0, 0);
}

export function renderAdjustedRgb16ToCanvas(
  canvas: HTMLCanvasElement | OffscreenCanvas,
  decoded: DecodedRgbImage16,
  sourceRect: { x: number; y: number; w: number; h: number },
  rotationDegrees: number,
  temperature: number,
  tint: number,
  exposureEv: number,
  shadow: number,
  highlight: number,
  scaledLog: number,
  sigmoid: number,
  vibrance: number,
  saturation: number,
  outputColorProfile: ImageEditOutputColorProfile = "srgb",
  clarityMap: ImageEditClarityMap | null = null,
  defringeMap: DefringeAnalysisMap | null = null,
  defringeAmount = 0,
) {
  const ctx = getCanvas2dContext(canvas, outputColorProfile);
  if (!ctx) throw new Error("2D context unavailable");
  const width = Math.max(1, canvas.width);
  const height = Math.max(1, canvas.height);
  const imageData = createCanvasImageData(ctx, width, height, outputColorProfile);
  const output = imageData.data;
  const rawContextSample = getAnalysisLinearRgbSample(decoded, sourceRect, rotationDegrees);
  const contextSample = defringeMap && defringeAmount > 0
    ? applyDefringeToRenderedSample(
        rawContextSample,
        defringeMap,
        defringeAmount,
        decoded.width,
        decoded.height,
        sourceRect,
        rotationDegrees,
      )
    : rawContextSample;
  const context = buildInteractiveColorAdjustmentContextFromLinearRgbSample(
    contextSample,
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
  const activeClarityMap = isUsableImageEditClarityMap(clarityMap) ? clarityMap : null;
  const hasClarity = activeClarityMap !== null;
  const scaleX = width / Math.max(1, sourceRect.w);
  const scaleY = height / Math.max(1, sourceRect.h);
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
  const converted: [number, number, number] = [0, 0, 0];
  const adjusted: [number, number, number] = [0, 0, 0];
  const defringeConfidence: [number, number] = [0, 0];
  const samplingScratch = createRgb16SamplingScratch();
  let rowSourceX = transform.originX;
  let rowSourceY = transform.originY;
  let di = 0;
  for (let y = 0; y < height; y++) {
    let sourceX = rowSourceX;
    let sourceY = rowSourceY;
    for (let x = 0; x < width; x++, di += 4) {
      if (
        sourceX < 0 ||
        sourceX >= decoded.width ||
        sourceY < 0 ||
        sourceY >= decoded.height ||
        !sampleLinearRgb16BilinearInto(decoded, sourceX, sourceY, sample, samplingScratch)
      ) {
        output[di] = 128;
        output[di + 1] = 128;
        output[di + 2] = 128;
        output[di + 3] = 255;
      } else {
        let r = sample[0];
        let g = sample[1];
        let b = sample[2];
        if (defringeMap && defringeAmount > 0) {
          applyDefringeLinearRgbInto(
            r, g, b, defringeMap, defringeAmount,
            decoded.width > 1 ? sourceX / (decoded.width - 1) : 0.5,
            decoded.height > 1 ? sourceY / (decoded.height - 1) : 0.5,
            adjusted,
            defringeConfidence,
          );
          r = adjusted[0]; g = adjusted[1]; b = adjusted[2];
        }
        if (hasClarity) {
          applyToneAdjustmentsLinearRgbInto(r, g, b, context, adjusted);
          r = adjusted[0]; g = adjusted[1]; b = adjusted[2];
          const clarityGain = sampleImageEditClarityGain(
            activeClarityMap,
            sourceX,
            sourceY,
            decoded.width,
            decoded.height,
          );
          applyLuminanceGainPreservingAboveOneLinearRgbInto(r, g, b, clarityGain, adjusted);
          r = adjusted[0]; g = adjusted[1]; b = adjusted[2];
          applyColorAdjustmentsAfterToneLinearRgbInto(r, g, b, context, true, adjusted);
          r = adjusted[0]; g = adjusted[1]; b = adjusted[2];
        } else {
          applyColorAdjustmentsLinearRgbInto(r, g, b, context, adjusted);
          r = adjusted[0]; g = adjusted[1]; b = adjusted[2];
        }
        convertLinearProPhotoToOutputRgbInto(r, g, b, outputColorProfile, converted);
        output[di] = linearChannelToSrgbByteFromLut(converted[0]);
        output[di + 1] = linearChannelToSrgbByteFromLut(converted[1]);
        output[di + 2] = linearChannelToSrgbByteFromLut(converted[2]);
        output[di + 3] = 255;
      }
      sourceX += transform.columnStepX;
      sourceY += transform.columnStepY;
    }
    rowSourceX += transform.rowStepX;
    rowSourceY += transform.rowStepY;
  }
  ctx.putImageData(imageData, 0, 0);
}
