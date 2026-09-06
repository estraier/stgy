import type { DecodedRgbImage16, ImageEditOutputColorProfile } from "./types";
import { createCanvasImageData, getCanvas2dContext } from "./canvas";
import { convertLinearProPhotoToOutputRgb } from "./color";
import { buildColorAdjustmentContextFromLinearRgbSample } from "./analysis";
import { getAnalysisLinearRgbSample, renderedPixelToSourcePoint, sampleLinearRgb16Bilinear } from "./sampling";
import { applyColorAdjustmentsLinearRgb, linearChannelToSrgb } from "./tone";

// Pixel rendering is kept separate from React/UI state so later hot-loop optimization is isolated.

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
  const scaleX = width / Math.max(1, sourceRect.w);
  const scaleY = height / Math.max(1, sourceRect.h);
  const sampleRenderedPixel = (x: number, y: number): [number, number, number] | null => {
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
      return null;
    }
    return sampleLinearRgb16Bilinear(decoded, sourcePoint.x, sourcePoint.y);
  };
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const di = (y * width + x) * 4;
      const sample = sampleRenderedPixel(x, y);
      if (!sample) {
        output[di] = 128;
        output[di + 1] = 128;
        output[di + 2] = 128;
        output[di + 3] = 255;
        continue;
      }
      let [r, g, b] = sample;
      [r, g, b] = applyColorAdjustmentsLinearRgb(r, g, b, context);
      [r, g, b] = convertLinearProPhotoToOutputRgb(r, g, b, outputColorProfile);
      output[di] = linearChannelToSrgb(r);
      output[di + 1] = linearChannelToSrgb(g);
      output[di + 2] = linearChannelToSrgb(b);
      output[di + 3] = 255;
    }
  }
  ctx.putImageData(imageData, 0, 0);
}
