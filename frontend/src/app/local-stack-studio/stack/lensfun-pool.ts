import type { LensfunCorrection } from "@/image/lensfun";
import {
  RAW_DEVELOPED_LINEAR_RANGE_MAX,
  rawLensfunOutputDimensions,
  type RawLensfunCorrectionMaps,
  type RawOutputCrop,
  type RawStorageTransfer,
} from "@/components/image-editor/raw-development-core";
import type {
  LensfunSharedResponse,
  LensfunSingleResponse,
  LensfunWorkerRequest,
  LensfunWorkerResponse,
} from "../workers/protocols/lensfun-protocol";

const MAX_LENSFUN_WORKERS = 4;

export type LensfunStoredImage = {
  data: Uint16Array;
  width: number;
  height: number;
  linearRangeMax: typeof RAW_DEVELOPED_LINEAR_RANGE_MAX;
  transfer: "gamma20";
};

type LensfunSource = {
  data: Uint16Array;
  width: number;
  height: number;
  linearRangeMax: number;
  transfer: RawStorageTransfer;
};

type RunLensfunOptions = {
  source: LensfunSource;
  correction?: LensfunCorrection | null;
  outputCrop?: RawOutputCrop | null;
  hardwareConcurrency?: number;
  onProgress?: (progress: number) => void;
  createWorker?: () => Worker;
};

export function resolveLensfunWorkerCount(
  outputHeight: number,
  hardwareConcurrency: number = typeof navigator === "object" ? navigator.hardwareConcurrency : 1,
): number {
  const hardware = Number.isFinite(hardwareConcurrency) && hardwareConcurrency > 0
    ? Math.max(1, Math.floor(hardwareConcurrency))
    : 1;
  return Math.max(1, Math.min(MAX_LENSFUN_WORKERS, hardware, Math.max(1, Math.floor(outputHeight))));
}

function createDefaultWorker(): Worker {
  if (typeof Worker !== "function") throw new Error("LensFun worker API is unavailable.");
  return new Worker(new URL("/generated/local-stack-studio/lensfun.worker.js", window.location.origin));
}

function requestWorker<T extends LensfunWorkerResponse>(
  worker: Worker,
  expectedType: T["type"],
  message: LensfunWorkerRequest,
  transfer: Transferable[] = [],
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const cleanup = () => {
      worker.removeEventListener("message", onMessage);
      worker.removeEventListener("error", onError);
      worker.removeEventListener("messageerror", onMessageError);
    };
    const onMessage = (event: MessageEvent<LensfunWorkerResponse>) => {
      if (event.data?.type === "error") {
        cleanup();
        reject(new Error(event.data.message || "LensFun worker failed."));
        return;
      }
      if (event.data?.type !== expectedType) return;
      cleanup();
      resolve(event.data as T);
    };
    const onError = (event: ErrorEvent) => {
      cleanup();
      reject(new Error(event.message || "LensFun worker failed."));
    };
    const onMessageError = () => {
      cleanup();
      reject(new Error("LensFun worker communication failed."));
    };
    worker.addEventListener("message", onMessage);
    worker.addEventListener("error", onError);
    worker.addEventListener("messageerror", onMessageError);
    worker.postMessage(message, transfer);
  });
}

export function lensfunCorrectionToRawMaps(
  correction: LensfunCorrection | null | undefined,
): RawLensfunCorrectionMaps | undefined {
  if (!correction) return undefined;
  return {
    gridWidth: correction.gridWidth,
    gridHeight: correction.gridHeight,
    step: correction.step,
    geometry: correction.geometry,
    distortion: correction.distortion,
    ...(correction.autoCrop ? { crop: correction.autoCrop } : {}),
    ...(correction.combined ? { combined: correction.combined } : {}),
    ...(correction.tca ? { tca: correction.tca } : {}),
    ...(correction.vignetting ? { vignetting: correction.vignetting } : {}),
    ...(correction.vignettingBaked ? { vignettingBaked: true } : {}),
  };
}

function sharedFloat32(source: Float32Array | undefined): Float32Array | undefined {
  if (!source) return undefined;
  const buffer = new SharedArrayBuffer(source.byteLength);
  const output = new Float32Array(buffer);
  output.set(source);
  return output;
}

function sharedCorrection(
  correction: RawLensfunCorrectionMaps | undefined,
): RawLensfunCorrectionMaps | undefined {
  if (!correction) return undefined;
  const geometry = sharedFloat32(correction.geometry);
  if (!geometry) return undefined;
  const combined = sharedFloat32(correction.combined);
  const tca = sharedFloat32(correction.tca);
  const vignetting = sharedFloat32(correction.vignetting);
  return {
    gridWidth: correction.gridWidth,
    gridHeight: correction.gridHeight,
    step: correction.step,
    geometry,
    distortion: correction.distortion,
    ...(correction.crop ? { crop: correction.crop } : {}),
    ...(combined ? { combined } : {}),
    ...(tca ? { tca } : {}),
    ...(vignetting ? { vignetting } : {}),
    ...(correction.vignettingBaked ? { vignettingBaked: true } : {}),
  };
}

export async function runLensfunCorrectionPool(options: RunLensfunOptions): Promise<LensfunStoredImage> {
  const { source } = options;
  if (!(source.data instanceof Uint16Array) || source.data.length !== source.width * source.height * 3) {
    throw new Error("LensFun source buffer is invalid.");
  }
  const correction = lensfunCorrectionToRawMaps(options.correction);
  const outputCrop = options.outputCrop ?? undefined;
  const outputDimensions = rawLensfunOutputDimensions(
    source.width,
    source.height,
    correction,
    outputCrop,
  );
  const createWorker = options.createWorker ?? createDefaultWorker;
  const canUseShared = typeof SharedArrayBuffer === "function" && globalThis.crossOriginIsolated === true;
  const workerCount = canUseShared
    ? resolveLensfunWorkerCount(outputDimensions.height, options.hardwareConcurrency)
    : 1;
  options.onProgress?.(0);

  if (workerCount >= 2) {
    const workers: Worker[] = [];
    try {
      for (let index = 0; index < workerCount; index += 1) workers.push(createWorker());
      const sourceBuffer = new SharedArrayBuffer(source.data.byteLength);
      new Uint16Array(sourceBuffer).set(source.data);
      const outputBuffer = new SharedArrayBuffer(
        outputDimensions.width * outputDimensions.height * 3 * Uint16Array.BYTES_PER_ELEMENT,
      );
      const maps = sharedCorrection(correction);
      let completed = 0;
      await Promise.all(workers.map((worker, workerIndex) => {
        const rowStart = Math.floor(outputDimensions.height * workerIndex / workerCount);
        const rowEnd = Math.floor(outputDimensions.height * (workerIndex + 1) / workerCount);
        return requestWorker<LensfunSharedResponse>(worker, "process-shared-complete", {
          type: "process-shared",
          sourceBuffer,
          outputBuffer,
          width: source.width,
          height: source.height,
          sourceLinearRangeMax: source.linearRangeMax,
          sourceTransfer: source.transfer,
          correction: maps,
          outputCrop,
          rowStart,
          rowEnd,
          workerIndex,
        }).then(() => {
          completed += 1;
          options.onProgress?.(completed / workerCount);
        });
      }));
      return {
        data: new Uint16Array(outputBuffer),
        width: outputDimensions.width,
        height: outputDimensions.height,
        linearRangeMax: RAW_DEVELOPED_LINEAR_RANGE_MAX,
        transfer: "gamma20",
      };
    } finally {
      for (const worker of workers) worker.terminate();
    }
  }

  const worker = createWorker();
  try {
    const sourceCopy = source.data.slice();
    const response = await requestWorker<LensfunSingleResponse>(worker, "process-single-complete", {
      type: "process-single",
      sourceBuffer: sourceCopy.buffer as ArrayBuffer,
      width: source.width,
      height: source.height,
      sourceLinearRangeMax: source.linearRangeMax,
      sourceTransfer: source.transfer,
      correction,
      outputCrop,
    }, [sourceCopy.buffer]);
    options.onProgress?.(1);
    return {
      data: new Uint16Array(response.outputBuffer),
      width: response.width,
      height: response.height,
      linearRangeMax: RAW_DEVELOPED_LINEAR_RANGE_MAX,
      transfer: "gamma20",
    };
  } finally {
    worker.terminate();
  }
}
