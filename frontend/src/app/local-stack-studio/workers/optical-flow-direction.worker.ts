// Local Stack Studio Optical Flow native-compute worker.
// Each instance owns an independent OpenCV WASM heap. The numerical Farneback
// parameters match the original single-worker implementation exactly.
import { loadWorkerOpenCv, type OpenCvDynamic, type OpenCvRuntime } from "./opencv-runtime";
import { transferableBuffer } from "./transfer-buffer";
import type {
  OpticalFlowDirectionRequest,
  OpticalFlowDirectionResponse,
} from "./protocols/optical-flow-direction-protocol";

(() => {
  "use strict";

  type WorkerScope = {
    onmessage: ((event: MessageEvent<OpticalFlowDirectionRequest>) => void | Promise<void>) | null;
    postMessage: (message: OpticalFlowDirectionResponse, transfer?: Transferable[]) => void;
  };
  const scope = globalThis as unknown as WorkerScope;

  // Do not modify these values without a separate image-quality evaluation.
  const FARNEBACK_PYR_SCALE = 0.5;
  const FARNEBACK_LEVELS = 5;
  const FARNEBACK_WINDOW_SIZE = 21;
  const FARNEBACK_ITERATIONS = 3;
  const FARNEBACK_POLY_N = 7;
  const FARNEBACK_POLY_SIGMA = 1.5;
  const FARNEBACK_FLAGS = 0;

  let nativePromise: Promise<OpenCvRuntime> | null = null;

  function initialize(): Promise<OpenCvRuntime> {
    if (!nativePromise) {
      nativePromise = loadWorkerOpenCv("Optical Flow direction").then((cv) => {
        const missing: string[] = [];
        if (!cv.Mat) missing.push("Mat");
        if (cv.CV_8UC1 === undefined) missing.push("CV_8UC1");
        if (typeof cv.calcOpticalFlowFarneback !== "function") missing.push("calcOpticalFlowFarneback");
        if (missing.length) throw new Error(`Optical Flow OpenCV is missing: ${missing.join(", ")}`);
        return cv;
      }).catch((error) => {
        nativePromise = null;
        throw error;
      });
    }
    return nativePromise;
  }

  function computeFlow(cv: OpenCvRuntime, source: OpenCvDynamic, target: OpenCvDynamic): {
    flow: Float32Array;
    elapsedMs: number;
  } {
    const mat = new cv.Mat();
    try {
      const started = performance.now();
      cv.calcOpticalFlowFarneback(
        source,
        target,
        mat,
        FARNEBACK_PYR_SCALE,
        FARNEBACK_LEVELS,
        FARNEBACK_WINDOW_SIZE,
        FARNEBACK_ITERATIONS,
        FARNEBACK_POLY_N,
        FARNEBACK_POLY_SIGMA,
        FARNEBACK_FLAGS,
      );
      const elapsedMs = performance.now() - started;
      // Native heaps cannot be transferred to another Worker. Copy exactly
      // once, then transfer ownership to the compositing worker.
      return { flow: new Float32Array(mat.data32F as Float32Array), elapsedMs };
    } finally {
      mat.delete();
    }
  }

  scope.onmessage = async (event: MessageEvent<OpticalFlowDirectionRequest>) => {
    const message = event.data;
    try {
      const cv = await initialize();
      if (message.type === "init") {
        scope.postMessage({ type: "ready", requestId: message.requestId });
        return;
      }
      if (message.type !== "compute" && message.type !== "compute-pair") {
        throw new Error("Unsupported Optical Flow direction request.");
      }
      const { width, height } = message;
      if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1) {
        throw new Error("Invalid Optical Flow working image size.");
      }
      const previousGray = new Uint8Array(message.previousGrayBuffer);
      const nextGray = new Uint8Array(message.nextGrayBuffer);
      if (previousGray.length !== width * height || nextGray.length !== width * height) {
        throw new Error("Invalid Optical Flow grayscale buffer length.");
      }
      const previousMat = new cv.Mat(height, width, cv.CV_8UC1);
      const nextMat = new cv.Mat(height, width, cv.CV_8UC1);
      try {
        previousMat.data.set(previousGray);
        nextMat.data.set(nextGray);
        const forward = computeFlow(cv, previousMat, nextMat);
        const forwardBuffer = transferableBuffer(forward.flow);
        if (message.type === "compute") {
          scope.postMessage({
            type: "result", requestId: message.requestId,
            flowBuffer: forwardBuffer, computeMs: forward.elapsedMs,
          }, [forwardBuffer]);
        } else {
          const backward = computeFlow(cv, nextMat, previousMat);
          const backwardBuffer = transferableBuffer(backward.flow);
          scope.postMessage({
            type: "pair-result", requestId: message.requestId,
            forwardBuffer, backwardBuffer,
            forwardMs: forward.elapsedMs, backwardMs: backward.elapsedMs,
          }, [forwardBuffer, backwardBuffer]);
        }
      } finally {
        previousMat.delete();
        nextMat.delete();
      }
    } catch (error) {
      scope.postMessage({
        type: "error", requestId: message.requestId,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  };
})();
