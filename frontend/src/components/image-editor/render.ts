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
  linearChannelToSrgb,
  type ColorAdjustmentContext,
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
    let r = data[si] ?? 0;
    let g = data[si + 1] ?? 0;
    let b = data[si + 2] ?? 0;
    if (hasClarity) {
      [r, g, b] = applyToneAdjustmentsLinearRgb(r, g, b, context);
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
