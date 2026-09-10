import type { DecodedRgbImage16, ImageEditOutputColorProfile, LinearRgbSample } from "./types";
import { createCanvasImageData, getCanvas2dContext } from "./canvas";
import { convertLinearProPhotoToOutputRgb } from "@/image/color";
import { buildColorAdjustmentContextFromLinearRgbSample } from "./analysis";
import {
  buildRenderedPixelToSourceTransform,
  createRgb16SamplingScratch,
  getAnalysisLinearRgbSample,
  sampleLinearRgb16BilinearInto,
} from "./sampling";
import type { LinearRgbBuffer } from "./sampling";
import {
  applyColorAdjustmentsAfterToneLinearRgb,
  applyColorAdjustmentsLinearRgb,
  applyToneAdjustmentsLinearRgb,
  applyToneAdjustmentsLinearRgbRange,
  linearChannelToSrgb,
  type ColorAdjustmentContext,
  type ToneAdjustmentStage,
} from "@/image/tone";
import {
  isUsableImageEditClarityMap,
  restorePositiveImageEditClaritySaturationInto,
  sampleImageEditClarityGain,
  type ImageEditClarityMap,
} from "./clarity";

type ImageEditClaritySourceGeometry = {
  sourceWidth: number;
  sourceHeight: number;
  sourceRect: { x: number; y: number; w: number; h: number };
  rotationDegrees: number;
};

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
  outputColorProfile: ImageEditOutputColorProfile = "srgb",
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
  const restoreOldOutput = activeClarityMap && activeClarityMap.strength > 0 ? new Float32Array(3) : null;
  const restoreNewOutput = activeClarityMap && activeClarityMap.strength > 0 ? new Float32Array(3) : null;
  const restoreProPhoto = activeClarityMap && activeClarityMap.strength > 0 ? new Float32Array(3) : null;
  const tonePrefixEnd: ToneAdjustmentStage = isTonePreviewSliderStage(stage)
    ? stage
    : "after-tone";
  const toneSource = !isTonePreviewSliderStage(stage) && fullToneSample
    && fullToneSample.width === width
    && fullToneSample.height === height
    && fullToneSample.data.length === sample.data.length
    ? fullToneSample.data
    : null;

  for (let pixel = 0, si = 0; pixel < pixelCount; pixel += 1, si += 3) {
    if (valid && !valid[pixel]) continue;
    let r = toneSource ? (toneSource[si] ?? 0) : (sample.data[si] ?? 0);
    let g = toneSource ? (toneSource[si + 1] ?? 0) : (sample.data[si + 1] ?? 0);
    let b = toneSource ? (toneSource[si + 2] ?? 0) : (sample.data[si + 2] ?? 0);

    if (!toneSource) {
      [r, g, b] = applyToneAdjustmentsLinearRgbRange(
        r,
        g,
        b,
        context,
        "white-balance",
        tonePrefixEnd,
      );
    }

    if (stage === "color" && activeClarityMap) {
      const preClarityR = r;
      const preClarityG = g;
      const preClarityB = b;
      const clarityGain = activeClarityMap.width === width && activeClarityMap.height === height
        ? (activeClarityMap.gain[pixel] ?? 1)
        : sampleImageEditClarityGain(
            activeClarityMap,
            (pixel % width) + 0.5,
            Math.floor(pixel / width) + 0.5,
            width,
            height,
          );
      r = Math.max(0, r * clarityGain);
      g = Math.max(0, g * clarityGain);
      b = Math.max(0, b * clarityGain);
      if (activeClarityMap.strength > 0 && restoreOldOutput && restoreNewOutput && restoreProPhoto) {
        restorePositiveImageEditClaritySaturationInto(
          preClarityR,
          preClarityG,
          preClarityB,
          r,
          g,
          b,
          outputColorProfile,
          restoreOldOutput,
          restoreNewOutput,
          restoreProPhoto,
        );
        r = restoreProPhoto[0];
        g = restoreProPhoto[1];
        b = restoreProPhoto[2];
      }
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
) {
  const ctx = getCanvas2dContext(canvas, outputColorProfile);
  if (!ctx) throw new Error("2D context unavailable");
  const width = Math.max(1, canvas.width);
  const height = Math.max(1, canvas.height);
  const imageData = createCanvasImageData(ctx, width, height, outputColorProfile);
  const output = imageData.data;
  const context = suppliedContext ?? buildColorAdjustmentContextFromLinearRgbSample(
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
  const restoreOldOutput = activeClarityMap && activeClarityMap.strength > 0 ? new Float32Array(3) : null;
  const restoreNewOutput = activeClarityMap && activeClarityMap.strength > 0 ? new Float32Array(3) : null;
  const restoreProPhoto = activeClarityMap && activeClarityMap.strength > 0 ? new Float32Array(3) : null;
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
        [r, g, b] = applyToneAdjustmentsLinearRgbRange(r, g, b, context, stage, "after-tone");
      }

      if (stage !== "color") {
        if (hasClarity) {
          const preClarityR = r;
          const preClarityG = g;
          const preClarityB = b;
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
          r = Math.max(0, r * clarityGain);
          g = Math.max(0, g * clarityGain);
          b = Math.max(0, b * clarityGain);
          if (activeClarityMap.strength > 0 && restoreOldOutput && restoreNewOutput && restoreProPhoto) {
            restorePositiveImageEditClaritySaturationInto(
              preClarityR,
              preClarityG,
              preClarityB,
              r,
              g,
              b,
              outputColorProfile,
              restoreOldOutput,
              restoreNewOutput,
              restoreProPhoto,
            );
            r = restoreProPhoto[0];
            g = restoreProPhoto[1];
            b = restoreProPhoto[2];
          }
        }
      }
      [r, g, b] = applyColorAdjustmentsAfterToneLinearRgb(r, g, b, context);
    } else if (hasClarity) {
      if (!toneData) {
        [r, g, b] = applyToneAdjustmentsLinearRgb(r, g, b, context);
      }
      const preClarityR = r;
      const preClarityG = g;
      const preClarityB = b;
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
      r = Math.max(0, r * clarityGain);
      g = Math.max(0, g * clarityGain);
      b = Math.max(0, b * clarityGain);
      if (activeClarityMap.strength > 0 && restoreOldOutput && restoreNewOutput && restoreProPhoto) {
        restorePositiveImageEditClaritySaturationInto(
          preClarityR,
          preClarityG,
          preClarityB,
          r,
          g,
          b,
          outputColorProfile,
          restoreOldOutput,
          restoreNewOutput,
          restoreProPhoto,
        );
        r = restoreProPhoto[0];
        g = restoreProPhoto[1];
        b = restoreProPhoto[2];
      }
      [r, g, b] = applyColorAdjustmentsAfterToneLinearRgb(r, g, b, context);
    } else {
      [r, g, b] = applyColorAdjustmentsLinearRgb(r, g, b, context);
    }
    [r, g, b] = convertLinearProPhotoToOutputRgb(r, g, b, outputColorProfile);
    output[di] = linearChannelToSrgb(r);
    output[di + 1] = linearChannelToSrgb(g);
    output[di + 2] = linearChannelToSrgb(b);
    output[di + 3] = 255;
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
) {
  const ctx = getCanvas2dContext(canvas, outputColorProfile);
  if (!ctx) throw new Error("2D context unavailable");
  const width = Math.max(1, canvas.width);
  const height = Math.max(1, canvas.height);
  const imageData = createCanvasImageData(ctx, width, height, outputColorProfile);
  const output = imageData.data;
  const contextSample = getAnalysisLinearRgbSample(decoded, sourceRect, rotationDegrees);
  const context = buildColorAdjustmentContextFromLinearRgbSample(
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
  const restoreOldOutput = activeClarityMap && activeClarityMap.strength > 0 ? new Float32Array(3) : null;
  const restoreNewOutput = activeClarityMap && activeClarityMap.strength > 0 ? new Float32Array(3) : null;
  const restoreProPhoto = activeClarityMap && activeClarityMap.strength > 0 ? new Float32Array(3) : null;
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
        if (hasClarity) {
          [r, g, b] = applyToneAdjustmentsLinearRgb(r, g, b, context);
          const preClarityR = r;
          const preClarityG = g;
          const preClarityB = b;
          const clarityGain = sampleImageEditClarityGain(
            activeClarityMap,
            sourceX,
            sourceY,
            decoded.width,
            decoded.height,
          );
          r = Math.max(0, r * clarityGain);
          g = Math.max(0, g * clarityGain);
          b = Math.max(0, b * clarityGain);
          if (activeClarityMap.strength > 0 && restoreOldOutput && restoreNewOutput && restoreProPhoto) {
            restorePositiveImageEditClaritySaturationInto(
              preClarityR,
              preClarityG,
              preClarityB,
              r,
              g,
              b,
              outputColorProfile,
              restoreOldOutput,
              restoreNewOutput,
              restoreProPhoto,
            );
            r = restoreProPhoto[0];
            g = restoreProPhoto[1];
            b = restoreProPhoto[2];
          }
          [r, g, b] = applyColorAdjustmentsAfterToneLinearRgb(r, g, b, context);
        } else {
          [r, g, b] = applyColorAdjustmentsLinearRgb(r, g, b, context);
        }
        [r, g, b] = convertLinearProPhotoToOutputRgb(r, g, b, outputColorProfile);
        output[di] = linearChannelToSrgb(r);
        output[di + 1] = linearChannelToSrgb(g);
        output[di + 2] = linearChannelToSrgb(b);
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
