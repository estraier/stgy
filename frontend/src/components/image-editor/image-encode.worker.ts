/// <reference lib="webworker" />

export {};

type ImageEncodeRequest = {
  type: "encode-canvas";
  canvas: OffscreenCanvas;
  mimeType: string;
  quality: number;
};

type ImageEncodeResponse = {
  type: "encode-complete";
  blob: Blob;
};

const workerScope = self as unknown as DedicatedWorkerGlobalScope;

workerScope.onmessage = async (event: MessageEvent<ImageEncodeRequest>) => {
  const message = event.data;
  if (message?.type !== "encode-canvas") return;
  try {
    const blob = await message.canvas.convertToBlob({
      type: message.mimeType,
      quality: message.quality,
    });
    const response: ImageEncodeResponse = { type: "encode-complete", blob };
    workerScope.postMessage(response);
  } catch (error) {
    workerScope.postMessage({
      type: "error",
      message: error instanceof Error ? error.message : String(error),
    });
  }
};
