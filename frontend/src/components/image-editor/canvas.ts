import type { ImageEditOutputColorProfile } from "./types";

// Small Canvas compatibility helpers shared by preview/final rendering and post-processing.

export type Canvas2dContextLike = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

export type ImageEditCanvasColorSpace = ImageEditOutputColorProfile;

export function getCanvas2dContext(
  canvas: HTMLCanvasElement | OffscreenCanvas,
  colorSpace: ImageEditCanvasColorSpace = "srgb",
  willReadFrequently = false,
): Canvas2dContextLike | null {
  const options: {
    colorSpace?: ImageEditCanvasColorSpace;
    willReadFrequently?: boolean;
  } = { colorSpace };
  if (willReadFrequently) options.willReadFrequently = true;
  try {
    const ctx = (canvas as HTMLCanvasElement).getContext(
      "2d",
      options as unknown as CanvasRenderingContext2DSettings,
    );
    if (ctx) return ctx as Canvas2dContextLike;
  } catch {}
  if (willReadFrequently) {
    try {
      const ctx = (canvas as HTMLCanvasElement).getContext(
        "2d",
        { willReadFrequently: true } as unknown as CanvasRenderingContext2DSettings,
      );
      if (ctx) return ctx as Canvas2dContextLike;
    } catch {}
  }
  return (canvas as HTMLCanvasElement).getContext("2d") as Canvas2dContextLike | null;
}

export function getCanvasImageData(
  ctx: Canvas2dContextLike,
  x: number,
  y: number,
  width: number,
  height: number,
  colorSpace: ImageEditCanvasColorSpace = "srgb",
): ImageData {
  try {
    return (ctx as CanvasRenderingContext2D & {
      getImageData(
        sx: number,
        sy: number,
        sw: number,
        sh: number,
        settings?: { colorSpace?: ImageEditCanvasColorSpace },
      ): ImageData;
    }).getImageData(x, y, width, height, { colorSpace });
  } catch {
    return ctx.getImageData(x, y, width, height);
  }
}

export function createCanvasImageData(
  ctx: Canvas2dContextLike,
  width: number,
  height: number,
  colorSpace: ImageEditCanvasColorSpace = "srgb",
): ImageData {
  try {
    return new ImageData(
      new Uint8ClampedArray(width * height * 4),
      width,
      height,
      { colorSpace } as unknown as ImageDataSettings,
    );
  } catch {
    return ctx.createImageData(width, height);
  }
}
