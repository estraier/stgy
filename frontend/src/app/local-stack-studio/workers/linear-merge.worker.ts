// Local Stack Studio Blend/STF stripe worker. Built to public/generated/local-stack-studio.
import { mergeLinearFloatIntoAccumulator } from "../stack/linear-merge";
import { WorkerCanonicalReader } from "../stack/worker-canonical-reader";
import type {
  LinearMergeWorkerRequest,
  LinearMergeWorkerResponse,
} from "./protocols/linear-merge-protocol";

type WorkerScope = {
  onmessage: ((event: MessageEvent<LinearMergeWorkerRequest>) => void | Promise<void>) | null;
  postMessage: (message: LinearMergeWorkerResponse, transfer?: Transferable[]) => void;
};

const workerScope = globalThis as unknown as WorkerScope;
let reader: WorkerCanonicalReader | null = null;
let gains: Float32Array | null = null;
let weights: Float32Array | null = null;
let exposureRolloffMaxP998AfterGain: Array<number | null> | null = null;

workerScope.onmessage = async (event: MessageEvent<LinearMergeWorkerRequest>) => {
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
      gains = new Float32Array(message.gains);
      weights = new Float32Array(message.weights);
      exposureRolloffMaxP998AfterGain = Array.from(message.exposureRolloffMaxP998AfterGain, (value) =>
        typeof value === "number" && Number.isFinite(value) ? value : null,
      );
      if (
        gains.length !== reader.imageCount ||
        weights.length !== reader.imageCount ||
        exposureRolloffMaxP998AfterGain.length !== reader.imageCount
      ) {
        throw new Error("Linear merge worker configuration length does not match image count.");
      }
      post({
        type: "ready",
        requestId,
        imageCount: reader.imageCount,
        width: reader.width,
        height: reader.height,
      });
      return;
    }

    if (message.type === "merge-stripe") {
      if (!reader || !gains || !weights || !exposureRolloffMaxP998AfterGain) {
        throw new Error("Linear merge worker is not initialized.");
      }
      const y = Number(message.y);
      const height = Number(message.height);
      if (!(Number.isInteger(y) && y >= 0 && Number.isInteger(height) && height > 0 && y + height <= reader.height)) {
        throw new Error("Linear merge worker received an invalid stripe region.");
      }
      const accumulator = new Float32Array(reader.width * height * 3);
      // Preserve the historical Float32 accumulation order exactly. Different
      // output stripes may run concurrently, but every stripe visits inputs in
      // the same image-index order as the former full-image loop.
      for (let imageIndex = 0; imageIndex < reader.imageCount; imageIndex += 1) {
        const linear = await reader.readLinearRegion(imageIndex, 0, y, reader.width, height);
        mergeLinearFloatIntoAccumulator(
          linear,
          accumulator,
          gains[imageIndex],
          weights[imageIndex],
          null,
          exposureRolloffMaxP998AfterGain[imageIndex],
        );
      }
      const linearBuffer = accumulator.buffer as ArrayBuffer;
      post({ type: "merge-stripe-result", requestId, y, height, linearBuffer }, [linearBuffer]);
      return;
    }

    throw new Error(`Unsupported linear merge worker request: ${String((message as { type?: unknown }).type)}`);
  } catch (error) {
    post({
      type: "error",
      requestId,
      message: error instanceof Error ? error.message : String(error),
    });
  }
};

function post(message: LinearMergeWorkerResponse, transfer: Transferable[] = []): void {
  workerScope.postMessage(message, transfer);
}
