/// <reference lib="webworker" />

import { encodedRgbToLinearProphotoInto } from "@/image/color";

type RawEditableThumbnailRequest = {
  type: "build-editable-thumbnail";
  blob: Blob;
  width: number;
  height: number;
};

type RawEditableThumbnailResponse = {
  type: "editable-thumbnail-complete";
  width: number;
  height: number;
  dataBuffer: ArrayBuffer;
};

const workerScope = self as unknown as DedicatedWorkerGlobalScope;

function encodeGamma20Rgb16(linear: number): number {
  const normalized = Math.min(1, Math.max(0, linear));
  return Math.round(Math.sqrt(normalized) * 65535);
}

function postError(error: unknown): void {
  workerScope.postMessage({
    type: "error",
    message: error instanceof Error ? error.message : String(error),
  });
}

workerScope.onmessage = async (event: MessageEvent<RawEditableThumbnailRequest>) => {
  const message = event.data;
  if (message?.type !== "build-editable-thumbnail") return;

  let bitmap: ImageBitmap | null = null;
  try {
    bitmap = await createImageBitmap(message.blob, { colorSpaceConversion: "default" });
    const width = Math.max(1, Math.round(bitmap.width || message.width || 1));
    const height = Math.max(1, Math.round(bitmap.height || message.height || 1));
    if (typeof OffscreenCanvas !== "function") throw new Error("OffscreenCanvas unavailable");
    const canvas = new OffscreenCanvas(width, height);
    const ctx = canvas.getContext(
      "2d",
      { willReadFrequently: true, colorSpace: "srgb" } as unknown as CanvasRenderingContext2DSettings,
    );
    if (!ctx) throw new Error("2D context unavailable");
    ctx.drawImage(bitmap, 0, 0, width, height);

    const rgb16 = new Uint16Array(width * height * 3);
    const linear: [number, number, number] = [0, 0, 0];
    const targetChunkBytes = 4 * 1024 * 1024;
    const rowsPerChunk = Math.max(1, Math.floor(targetChunkBytes / Math.max(4, width * 4)));
    for (let y = 0; y < height; y += rowsPerChunk) {
      const chunkHeight = Math.min(rowsPerChunk, height - y);
      const rgba8 = ctx.getImageData(0, y, width, chunkHeight).data;
      const count = width * chunkHeight;
      const destinationPixelOffset = y * width;
      for (let pixel = 0; pixel < count; pixel++) {
        const si = pixel * 4;
        const di = (destinationPixelOffset + pixel) * 3;
        encodedRgbToLinearProphotoInto(
          (rgba8[si] ?? 0) / 255,
          (rgba8[si + 1] ?? 0) / 255,
          (rgba8[si + 2] ?? 0) / 255,
          "srgb",
          linear,
        );
        rgb16[di] = encodeGamma20Rgb16(linear[0]);
        rgb16[di + 1] = encodeGamma20Rgb16(linear[1]);
        rgb16[di + 2] = encodeGamma20Rgb16(linear[2]);
      }
    }

    const response: RawEditableThumbnailResponse = {
      type: "editable-thumbnail-complete",
      width,
      height,
      dataBuffer: rgb16.buffer,
    };
    workerScope.postMessage(response, [rgb16.buffer]);
  } catch (error) {
    postError(error);
  } finally {
    bitmap?.close?.();
  }
};
