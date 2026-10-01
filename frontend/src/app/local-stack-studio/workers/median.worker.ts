// Local Stack Studio Denoise (median) worker. Built to public/generated/local-stack-studio.
import { exactMedianUint16Tile } from "../stack/median";
import { WorkerCanonicalReader } from "../stack/worker-canonical-reader";
import type {
  MedianWorkerRequest,
  MedianWorkerResponse,
} from "./protocols/median-protocol";

type WorkerScope = {
  onmessage: ((event: MessageEvent<MedianWorkerRequest>) => void | Promise<void>) | null;
  postMessage: (message: MedianWorkerResponse, transfer?: Transferable[]) => void;
};
const workerScope = globalThis as unknown as WorkerScope;
let reader: WorkerCanonicalReader | null = null;

workerScope.onmessage = async (event: MessageEvent<MedianWorkerRequest>) => {
  const message = event.data;
  const requestId = Number(message?.requestId);
  try {
    if (message.type === "init") {
      reader?.close();
      reader = await WorkerCanonicalReader.open({
        sessionId: message.sessionId,
        alignmentPlan: message.alignmentPlan,
        matrices: message.matrices,
        cacheBytes: message.cacheBytes,
      });
      post({ type: "ready", requestId, imageCount: reader.imageCount });
      return;
    }

    if (message.type === "merge-tile") {
      if (!reader) throw new Error("Median worker canonical reader is not initialized.");
      const x = Number(message.x);
      const y = Number(message.y);
      const width = Number(message.width);
      const height = Number(message.height);
      if (![x, y, width, height].every(Number.isFinite) || width <= 0 || height <= 0) {
        throw new Error("Median worker received an invalid tile region.");
      }
      const tiles: Uint16Array[] = [];
      for (let imageIndex = 0; imageIndex < reader.imageCount; imageIndex += 1) {
        // Keep the exact historical Denoise ordering and storage domain: every
        // aligned image is sampled in image-index order into gamma-2 Uint16,
        // linearRangeMax=1, before the exact median is computed.
        tiles.push(await reader.readGamma2Region(imageIndex, x, y, width, height, 1));
      }
      const median = exactMedianUint16Tile(tiles);
      const gamma2Buffer = median.buffer as ArrayBuffer;
      post(
        { type: "merge-tile-result", requestId, x, y, width, height, gamma2Buffer },
        [gamma2Buffer],
      );
      return;
    }

    throw new Error(`Unsupported Median worker request: ${String((message as { type?: unknown }).type)}`);
  } catch (error) {
    post({
      type: "error",
      requestId,
      message: error instanceof Error ? error.message : String(error),
    });
  }
};

function post(message: MedianWorkerResponse, transfer: Transferable[] = []): void {
  workerScope.postMessage(message, transfer);
}
