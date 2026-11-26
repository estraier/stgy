// Local Stack Studio Blend/STF stripe worker. Built to public/generated/local-stack-studio.
import { addWeightedLinearToAccumulator, mergeLinearFloatIntoAccumulator } from "../stack/linear-merge";
import { applyStfToneMatchInPlace, buildStfToneMatchLut, type StfToneMatchLut } from "../stack/stf-tone-match";
import { WorkerCanonicalReader } from "../stack/worker-canonical-reader";
import { sampleStfRestoreStripe, type StfRestoreSampleStripe } from "../stack/stf-restore-sampling";
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
let scaledLogs: Float32Array | null = null;
let weights: Float32Array | null = null;
let toneMatchLuts: Array<StfToneMatchLut | null> | null = null;
let exposureRolloffMaxP998AfterGain: Array<number | null> | null = null;
let restoreReferenceIndex = -1;

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
      restoreReferenceIndex = message.restoreReferenceIndex ?? -1;
      gains = new Float32Array(message.gains);
      scaledLogs = new Float32Array(message.scaledLogs);
      weights = new Float32Array(message.weights);
      toneMatchLuts = Array.from({ length: gains.length }, (_, index) => {
        const gain = gains![index];
        const scaledLog = scaledLogs![index];
        return Math.abs(gain - 1) > 1e-8 || Math.abs(scaledLog) > 1e-8
          ? buildStfToneMatchLut(gain, scaledLog)
          : null;
      });
      exposureRolloffMaxP998AfterGain = Array.from(message.exposureRolloffMaxP998AfterGain, (value) =>
        typeof value === "number" && Number.isFinite(value) ? value : null,
      );
      if (
        gains.length !== reader.imageCount ||
        scaledLogs.length !== reader.imageCount ||
        weights.length !== reader.imageCount ||
        exposureRolloffMaxP998AfterGain.length !== reader.imageCount
      ) {
        throw new Error("Linear merge worker configuration length does not match image count.");
      }
      if (!Number.isInteger(restoreReferenceIndex) || restoreReferenceIndex < -1 || restoreReferenceIndex >= reader.imageCount) {
        throw new Error("STF Restore sample reference index is invalid.");
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
      if (!reader || !gains || !scaledLogs || !weights || !exposureRolloffMaxP998AfterGain) {
        throw new Error("Linear merge worker is not initialized.");
      }
      const y = Number(message.y);
      const height = Number(message.height);
      if (!(Number.isInteger(y) && y >= 0 && Number.isInteger(height) && height > 0 && y + height <= reader.height)) {
        throw new Error("Linear merge worker received an invalid stripe region.");
      }
      const result = await buildStandardMergeStripe(y, height);
      const sampleBuffer = result.referenceSample?.sums.buffer as ArrayBuffer | undefined;
      post({
        type: "merge-stripe-result",
        requestId,
        y,
        height,
        linearBuffer: result.linearBuffer,
        ...(sampleBuffer ? { restoreSampleY: result.referenceSample!.firstSampleY,
          restoreSampleBuffer: sampleBuffer } : {}),
      }, sampleBuffer ? [result.linearBuffer, sampleBuffer] : [result.linearBuffer]);
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

async function buildStandardMergeStripe(y: number, height: number): Promise<{
  linearBuffer: ArrayBuffer; referenceSample: StfRestoreSampleStripe | null;
}> {
  if (!reader || !gains || !scaledLogs || !weights || !exposureRolloffMaxP998AfterGain) {
    throw new Error("Linear merge worker is not initialized.");
  }
  const accumulator = new Float32Array(reader.width * height * 3);
  let referenceSample: StfRestoreSampleStripe | null = null;
  // Preserve the historical Float32 accumulation order exactly. Different
  // output stripes may run concurrently, but every stripe visits inputs in
  // the same image-index order as the former full-image loop.
  for (let imageIndex = 0; imageIndex < reader.imageCount; imageIndex += 1) {
    const linear = await reader.readLinearRegion(imageIndex, 0, y, reader.width, height);
    const toneMatchLut = toneMatchLuts?.[imageIndex] ?? null;
    if (imageIndex === restoreReferenceIndex) {
      // Apply identical STF normalization to the sampled reference while it is
      // already resident. The usual LUT branch below will reuse this buffer.
      const samplePixels = !toneMatchLut && (gains[imageIndex] !== 1 || scaledLogs[imageIndex] !== 0)
        ? linear.slice() : linear;
      if (toneMatchLut) applyStfToneMatchInPlace(linear, gains[imageIndex], scaledLogs[imageIndex], toneMatchLut);
      else if (samplePixels !== linear) applyStfToneMatchInPlace(samplePixels, gains[imageIndex], scaledLogs[imageIndex]);
      referenceSample = sampleStfRestoreStripe(samplePixels, reader.width, reader.height, y);
    }
    if (toneMatchLut) {
      if (imageIndex !== restoreReferenceIndex) applyStfToneMatchInPlace(
        linear,
        gains[imageIndex],
        scaledLogs[imageIndex],
        toneMatchLut,
      );
      addWeightedLinearToAccumulator(accumulator, linear, weights[imageIndex]);
    } else {
      mergeLinearFloatIntoAccumulator(
        linear,
        accumulator,
        gains[imageIndex],
        weights[imageIndex],
        null,
        exposureRolloffMaxP998AfterGain[imageIndex],
      );
    }
  }
  return { linearBuffer: accumulator.buffer as ArrayBuffer, referenceSample };
}

function post(message: LinearMergeWorkerResponse, transfer: Transferable[] = []): void {
  workerScope.postMessage(message, transfer);
}
