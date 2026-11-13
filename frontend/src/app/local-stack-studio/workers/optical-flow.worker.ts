// Local Stack Studio Optical Flow worker. Built to public/generated/local-stack-studio.
import type {
  OpticalFlowDirectionRequest,
  OpticalFlowDirectionResponse,
} from "./protocols/optical-flow-direction-protocol";
import { transferableBuffer } from "./transfer-buffer";
import { stfFlowWorkingSize, stfGamma2RgbToGray8Resampled } from "../stack/stf-flow-gray";
import type {
  OpticalFlowPerformanceStats,
  OpticalFlowVariant,
  OpticalFlowWorkerRequest,
  OpticalFlowWorkerResponse,
} from "./protocols/optical-flow-protocol";

(() => {
  "use strict";

  type WorkerScope = {
    onmessage: ((event: MessageEvent<OpticalFlowWorkerRequest>) => void | Promise<void>) | null;
    postMessage: (message: OpticalFlowWorkerResponse, transfer?: Transferable[]) => void;
  };
  const workerScope = globalThis as unknown as WorkerScope;

  // Image-index proxies are reused for adjacent pairs within one STF Process.
  const grayCache = new Map<number, Uint8Array>();
  // Reuse the native Flow workers across requests. In a future STF pipeline,
  // adjacent input pairs can share this same pool and amortize OpenCV startup.
  type DirectionRequestWithoutId = OpticalFlowDirectionRequest extends infer Request
    ? Request extends OpticalFlowDirectionRequest
      ? Omit<Request, "requestId">
      : never
    : never;

  class DirectionClient {
    private readonly worker = new Worker("/generated/local-stack-studio/optical-flow-direction.worker.js");
    private readonly pending = new Map<number, {
      resolve: (value: OpticalFlowDirectionResponse) => void;
      reject: (reason: Error) => void;
    }>();
    private nextRequestId = 1;

    constructor() {
      this.worker.onmessage = (event: MessageEvent<OpticalFlowDirectionResponse>) => {
        const message = event.data;
        const waiting = this.pending.get(message.requestId);
        if (!waiting) return;
        this.pending.delete(message.requestId);
        if (message.type === "error") waiting.reject(new Error(message.message));
        else waiting.resolve(message);
      };
      this.worker.onerror = (event) => this.failAll(new Error(event.message || "Optical Flow direction worker failed."));
      this.worker.onmessageerror = () => this.failAll(new Error("Optical Flow direction worker sent unreadable data."));
    }

    private failAll(error: Error): void {
      for (const waiting of this.pending.values()) waiting.reject(error);
      this.pending.clear();
    }

    request(message: DirectionRequestWithoutId, transfer: Transferable[] = []): Promise<OpticalFlowDirectionResponse> {
      const requestId = this.nextRequestId++;
      return new Promise<OpticalFlowDirectionResponse>((resolve, reject) => {
        this.pending.set(requestId, { resolve, reject });
        try {
          this.worker.postMessage({ ...message, requestId }, transfer);
        } catch (error) {
          this.pending.delete(requestId);
          reject(error);
        }
      });
    }

    terminate(): void {
      this.failAll(new Error("Optical Flow direction worker terminated."));
      this.worker.terminate();
    }
  }

  type DirectionPool = { clients: DirectionClient[]; warmupMs: number };
  let directionPoolPromise: Promise<DirectionPool> | null = null;

  function directionWorkerCount(): number {
    const availableCores = navigator.hardwareConcurrency || 1;
    const deviceMemory = (navigator as Navigator & { deviceMemory?: number }).deviceMemory;
    // Avoid allocating a second independent native WASM heap on machines that
    // advertise fewer than four logical cores or less than 8 GiB of RAM.
    return availableCores >= 4 && !(deviceMemory !== undefined && deviceMemory < 8) ? 2 : 1;
  }

  function ensureDirectionPool(): Promise<DirectionPool> {
    if (directionPoolPromise) return directionPoolPromise;
    directionPoolPromise = (async () => {
      const start = performance.now();
      const clients = Array.from({ length: directionWorkerCount() }, () => new DirectionClient());
      try {
        const ready = await Promise.all(clients.map((client) => client.request({ type: "init" })));
        if (ready.some((entry) => entry.type !== "ready")) {
          throw new Error("Optical Flow direction worker initialization failed.");
        }
        return { clients, warmupMs: performance.now() - start };
      } catch (error) {
        for (const client of clients) client.terminate();
        throw error;
      }
    })().catch((error) => {
      directionPoolPromise = null;
      throw error;
    });
    return directionPoolPromise;
  }

  function grayCopyBuffer(gray: Uint8Array): ArrayBuffer {
    // Both Flow directions require the same two proxies. Separate copies
    // avoid SharedArrayBuffer / cross-origin-isolation requirements.
    return new Uint8Array(gray).buffer as ArrayBuffer;
  }

  async function computeBidirectionalFlow(
    previousGray: Uint8Array,
    nextGray: Uint8Array,
    width: number,
    height: number,
  ): Promise<{
    forward: Float32Array;
    backward: Float32Array;
    forwardMs: number;
    backwardMs: number;
    wallMs: number;
    workerCount: number;
    warmupMs: number;
  }> {
    const pool = await ensureDirectionPool();
    const started = performance.now();
    if (pool.clients.length === 1) {
      const previousGrayBuffer = grayCopyBuffer(previousGray);
      const nextGrayBuffer = grayCopyBuffer(nextGray);
      const result = await pool.clients[0].request({
        type: "compute-pair", width, height,
        previousGrayBuffer, nextGrayBuffer,
      }, [previousGrayBuffer, nextGrayBuffer]);
      if (result.type !== "pair-result") throw new Error("Unexpected Optical Flow pair response.");
      return {
        forward: new Float32Array(result.forwardBuffer),
        backward: new Float32Array(result.backwardBuffer),
        forwardMs: result.forwardMs,
        backwardMs: result.backwardMs,
        wallMs: performance.now() - started,
        workerCount: 1,
        warmupMs: pool.warmupMs,
      };
    }

    const forwardPrevious = grayCopyBuffer(previousGray);
    const forwardNext = grayCopyBuffer(nextGray);
    const backwardPrevious = grayCopyBuffer(nextGray);
    const backwardNext = grayCopyBuffer(previousGray);
    const [forwardResult, backwardResult] = await Promise.all([
      pool.clients[0].request({
        type: "compute", width, height,
        previousGrayBuffer: forwardPrevious, nextGrayBuffer: forwardNext,
      }, [forwardPrevious, forwardNext]),
      pool.clients[1].request({
        type: "compute", width, height,
        previousGrayBuffer: backwardPrevious, nextGrayBuffer: backwardNext,
      }, [backwardPrevious, backwardNext]),
    ]);
    if (forwardResult.type !== "result" || backwardResult.type !== "result") {
      throw new Error("Unexpected Optical Flow direction response.");
    }
    return {
      forward: new Float32Array(forwardResult.flowBuffer),
      backward: new Float32Array(backwardResult.flowBuffer),
      forwardMs: forwardResult.computeMs,
      backwardMs: backwardResult.computeMs,
      wallMs: performance.now() - started,
      workerCount: 2,
      warmupMs: pool.warmupMs,
    };
  }

  workerScope.onmessage = async (event: MessageEvent<OpticalFlowWorkerRequest>) => {
    const message = event.data;
    try {
      if (message.type === "warmup") {
        const pool = await ensureDirectionPool();
        workerScope.postMessage({
          type: "ready", requestId: message.requestId,
          flowWorkerCount: pool.clients.length,
          warmupMs: pool.warmupMs,
        });
        return;
      }
      if (message.type !== "interpolate") {
        throw new Error(`Unsupported Optical Flow worker request: ${String((message as { type?: unknown }).type)}`);
      }
      const result = await interpolateMiddleFrame(message);
      const gamma2Buffer = transferableBuffer(result.gamma2Rgb);
      const additionalGamma2Buffer = result.additionalGamma2Rgb
        ? transferableBuffer(result.additionalGamma2Rgb) : undefined;
      workerScope.postMessage({
        type: "result",
        requestId: message.requestId,
        width: result.width,
        height: result.height,
        gamma2Buffer,
        ...(additionalGamma2Buffer ? { additionalGamma2Buffer } : {}),
        flowWidth: result.flowWidth,
        flowHeight: result.flowHeight,
        performance: result.performance,
      }, additionalGamma2Buffer ? [gamma2Buffer, additionalGamma2Buffer] : [gamma2Buffer]);
    } catch (error) {
      workerScope.postMessage({
        type: "error",
        requestId: message.requestId,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  };

  async function interpolateMiddleFrame(message: Extract<OpticalFlowWorkerRequest, { type: "interpolate" }>) {
    const width = Math.round(Number(message.width));
    const height = Math.round(Number(message.height));
    if (!(width > 0 && height > 0)) {
      throw new Error("Optical Flow received an invalid image size.");
    }
    const expectedSamples = width * height * 3;
    const previousGamma2Rgb = new Uint16Array(message.previousGamma2Buffer);
    const nextGamma2Rgb = new Uint16Array(message.nextGamma2Buffer);
    if (previousGamma2Rgb.length !== expectedSamples || nextGamma2Rgb.length !== expectedSamples) {
      throw new Error("Optical Flow received an invalid gamma-2 RGB buffer.");
    }

    const workerStartedAt = performance.now();
    const flowSize = stfFlowWorkingSize(width, height);
    postProgress(message.requestId, "Preparing Optical Flow grayscale proxies...");
    const prepareStartedAt = performance.now();
    const grayScale = message.linearRangeMax === 4 ? 2 : 1;
    const externalGray = message.previousGrayBuffer !== undefined || message.nextGrayBuffer !== undefined;
    if (externalGray && (!message.previousGrayBuffer || !message.nextGrayBuffer)) {
      throw new Error("STF Flow requires both shared grayscale proxies");
    }
    const expectedGrayLength = flowSize.width * flowSize.height;
    const externalPrevious = message.previousGrayBuffer ? new Uint8Array(message.previousGrayBuffer) : null;
    const externalNext = message.nextGrayBuffer ? new Uint8Array(message.nextGrayBuffer) : null;
    if ((externalPrevious && externalPrevious.length !== expectedGrayLength) ||
        (externalNext && externalNext.length !== expectedGrayLength)) {
      throw new Error("STF Flow grayscale proxy has invalid dimensions");
    }
    const previousGray = externalPrevious ?? (message.previousImageId === undefined ? null : grayCache.get(message.previousImageId));
    const nextGray = externalNext ?? (message.nextImageId === undefined ? null : grayCache.get(message.nextImageId));
    const gray0 = previousGray ?? stfGamma2RgbToGray8Resampled(previousGamma2Rgb, width, height, flowSize.width, flowSize.height, grayScale);
    const gray1 = nextGray ?? stfGamma2RgbToGray8Resampled(nextGamma2Rgb, width, height, flowSize.width, flowSize.height, grayScale);
    if (!externalGray && message.previousImageId !== undefined && !previousGray) grayCache.set(message.previousImageId, gray0);
    if (!externalGray && message.nextImageId !== undefined && !nextGray) grayCache.set(message.nextImageId, gray1);
    const prepareFlowInputsMs = performance.now() - prepareStartedAt;

    postProgress(message.requestId, `Computing bidirectional Optical Flow (${flowSize.width}×${flowSize.height})...`);
    const flows = await computeBidirectionalFlow(gray0, gray1, flowSize.width, flowSize.height);
    if (flows.forward.length !== flowSize.width * flowSize.height * 2 ||
        flows.backward.length !== flowSize.width * flowSize.height * 2) {
      throw new Error("Optical Flow direction worker returned an invalid vector field.");
    }

    postProgress(message.requestId, `Warping Optical Flow ${describeVariant(message.variant)} image...`);
    const warpStartedAt = performance.now();
    const output = synthesizeFlowVariant(
      message.variant,
      previousGamma2Rgb,
      nextGamma2Rgb,
      width,
      height,
      flows.forward,
      flows.backward,
      flowSize.width,
      flowSize.height,
    );
    const warpMs = performance.now() - warpStartedAt;
    // Both frames use the *same* native 4MP forward/backward fields. Never
    // start an extra Farneback computation just to synthesize the outer image.
    const additionalWarpStartedAt = performance.now();
    const additionalGamma2Rgb = message.additionalVariant
      ? synthesizeFlowVariant(message.additionalVariant, previousGamma2Rgb, nextGamma2Rgb,
        width, height, flows.forward, flows.backward, flowSize.width, flowSize.height)
      : undefined;
    const additionalWarpMs = additionalGamma2Rgb ? performance.now() - additionalWarpStartedAt : undefined;
    const performanceStats: OpticalFlowPerformanceStats = {
      sourceWidth: width,
      sourceHeight: height,
      flowWidth: flowSize.width,
      flowHeight: flowSize.height,
      prepareFlowInputsMs,
      forwardFlowMs: flows.forwardMs,
      backwardFlowMs: flows.backwardMs,
      flowWallMs: flows.wallMs,
      flowWorkerCount: flows.workerCount,
      warmupMs: flows.warmupMs,
      warpMs,
      ...(additionalWarpMs !== undefined ? { additionalWarpMs } : {}),
      totalWorkerMs: performance.now() - workerStartedAt,
      estimatedPeakBytes: estimatePeakBytes(width, height, flowSize.width, flowSize.height, flows.workerCount),
      inputGamma2Bytes: previousGamma2Rgb.byteLength + nextGamma2Rgb.byteLength,
      flowFieldBytes: flows.forward.byteLength + flows.backward.byteLength,
      outputBytes: output.byteLength + (additionalGamma2Rgb?.byteLength ?? 0),
    };
    return { width, height, gamma2Rgb: output, additionalGamma2Rgb, flowWidth: flowSize.width, flowHeight: flowSize.height, performance: performanceStats };
  }

  function synthesizeFlowVariant(
    variant: OpticalFlowVariant,
    previousGamma2Rgb: Uint16Array,
    nextGamma2Rgb: Uint16Array,
    width: number,
    height: number,
    flowForward: Float32Array,
    flowBackward: Float32Array,
    flowWidth: number,
    flowHeight: number,
  ): Uint16Array {
    const output = new Uint16Array(width * height * 3);
    const scaleX = width / flowWidth;
    const scaleY = height / flowHeight;
    const edgeX = Math.max(0, flowWidth - 1);
    const edgeY = Math.max(0, flowHeight - 1);
    const previousFactor = variant === "ext2" ? 2 : variant === "ext1" ? -1 : 0.5;
    const nextFactor = variant === "ext2" ? -1 : variant === "ext1" ? 2 : 0.5;
    const usePrevious = variant !== "ext2";
    const useNext = variant !== "ext1";

    for (let y = 0; y < height; y += 1) {
      const flowY = flowHeight === 1 ? 0 : ((y + 0.5) * flowHeight / height) - 0.5;
      const clampedFlowY = clamp(flowY, 0, edgeY);
      const flowY0 = Math.floor(clampedFlowY);
      const flowY1 = Math.min(edgeY, flowY0 + 1);
      const flowFy = clampedFlowY - flowY0;
      const flowRow00 = flowY0 * flowWidth;
      const flowRow10 = flowY1 * flowWidth;
      for (let x = 0; x < width; x += 1) {
        const flowX = flowWidth === 1 ? 0 : ((x + 0.5) * flowWidth / width) - 0.5;
        const clampedFlowX = clamp(flowX, 0, edgeX);
        const flowX0 = Math.floor(clampedFlowX);
        const flowX1 = Math.min(edgeX, flowX0 + 1);
        const flowFx = clampedFlowX - flowX0;
        const flowW00 = (1 - flowFx) * (1 - flowFy);
        const flowW10 = flowFx * (1 - flowFy);
        const flowW01 = (1 - flowFx) * flowFy;
        const flowW11 = flowFx * flowFy;
        const ff00 = (flowRow00 + flowX0) * 2;
        const ff10 = (flowRow00 + flowX1) * 2;
        const ff01 = (flowRow10 + flowX0) * 2;
        const ff11 = (flowRow10 + flowX1) * 2;
        const forwardX = flowForward[ff00] * flowW00 + flowForward[ff10] * flowW10 + flowForward[ff01] * flowW01 + flowForward[ff11] * flowW11;
        const forwardY = flowForward[ff00 + 1] * flowW00 + flowForward[ff10 + 1] * flowW10 + flowForward[ff01 + 1] * flowW01 + flowForward[ff11 + 1] * flowW11;
        const backwardX = flowBackward[ff00] * flowW00 + flowBackward[ff10] * flowW10 + flowBackward[ff01] * flowW01 + flowBackward[ff11] * flowW11;
        const backwardY = flowBackward[ff00 + 1] * flowW00 + flowBackward[ff10 + 1] * flowW10 + flowBackward[ff01 + 1] * flowW01 + flowBackward[ff11 + 1] * flowW11;

        let previousR = 0;
        let previousG = 0;
        let previousB = 0;
        if (usePrevious) {
          const previousX = clamp(x - previousFactor * forwardX * scaleX, 0, width - 1);
          const previousY = clamp(y - previousFactor * forwardY * scaleY, 0, height - 1);
          const previousX0 = Math.floor(previousX);
          const previousY0 = Math.floor(previousY);
          const previousX1 = Math.min(width - 1, previousX0 + 1);
          const previousY1 = Math.min(height - 1, previousY0 + 1);
          const previousFx = previousX - previousX0;
          const previousFy = previousY - previousY0;
          const previousW00 = (1 - previousFx) * (1 - previousFy);
          const previousW10 = previousFx * (1 - previousFy);
          const previousW01 = (1 - previousFx) * previousFy;
          const previousW11 = previousFx * previousFy;
          const previousI00 = (previousY0 * width + previousX0) * 3;
          const previousI10 = (previousY0 * width + previousX1) * 3;
          const previousI01 = (previousY1 * width + previousX0) * 3;
          const previousI11 = (previousY1 * width + previousX1) * 3;
          previousR = previousGamma2Rgb[previousI00] * previousW00 + previousGamma2Rgb[previousI10] * previousW10 + previousGamma2Rgb[previousI01] * previousW01 + previousGamma2Rgb[previousI11] * previousW11;
          previousG = previousGamma2Rgb[previousI00 + 1] * previousW00 + previousGamma2Rgb[previousI10 + 1] * previousW10 + previousGamma2Rgb[previousI01 + 1] * previousW01 + previousGamma2Rgb[previousI11 + 1] * previousW11;
          previousB = previousGamma2Rgb[previousI00 + 2] * previousW00 + previousGamma2Rgb[previousI10 + 2] * previousW10 + previousGamma2Rgb[previousI01 + 2] * previousW01 + previousGamma2Rgb[previousI11 + 2] * previousW11;
        }

        let nextR = 0;
        let nextG = 0;
        let nextB = 0;
        if (useNext) {
          const nextX = clamp(x - nextFactor * backwardX * scaleX, 0, width - 1);
          const nextY = clamp(y - nextFactor * backwardY * scaleY, 0, height - 1);
          const nextX0 = Math.floor(nextX);
          const nextY0 = Math.floor(nextY);
          const nextX1 = Math.min(width - 1, nextX0 + 1);
          const nextY1 = Math.min(height - 1, nextY0 + 1);
          const nextFx = nextX - nextX0;
          const nextFy = nextY - nextY0;
          const nextW00 = (1 - nextFx) * (1 - nextFy);
          const nextW10 = nextFx * (1 - nextFy);
          const nextW01 = (1 - nextFx) * nextFy;
          const nextW11 = nextFx * nextFy;
          const nextI00 = (nextY0 * width + nextX0) * 3;
          const nextI10 = (nextY0 * width + nextX1) * 3;
          const nextI01 = (nextY1 * width + nextX0) * 3;
          const nextI11 = (nextY1 * width + nextX1) * 3;
          nextR = nextGamma2Rgb[nextI00] * nextW00 + nextGamma2Rgb[nextI10] * nextW10 + nextGamma2Rgb[nextI01] * nextW01 + nextGamma2Rgb[nextI11] * nextW11;
          nextG = nextGamma2Rgb[nextI00 + 1] * nextW00 + nextGamma2Rgb[nextI10 + 1] * nextW10 + nextGamma2Rgb[nextI01 + 1] * nextW01 + nextGamma2Rgb[nextI11 + 1] * nextW11;
          nextB = nextGamma2Rgb[nextI00 + 2] * nextW00 + nextGamma2Rgb[nextI10 + 2] * nextW10 + nextGamma2Rgb[nextI01 + 2] * nextW01 + nextGamma2Rgb[nextI11 + 2] * nextW11;
        }

        const out = (y * width + x) * 3;
        if (usePrevious && useNext) {
          output[out] = clampUint16((previousR + nextR) * 0.5);
          output[out + 1] = clampUint16((previousG + nextG) * 0.5);
          output[out + 2] = clampUint16((previousB + nextB) * 0.5);
        } else if (usePrevious) {
          output[out] = clampUint16(previousR);
          output[out + 1] = clampUint16(previousG);
          output[out + 2] = clampUint16(previousB);
        } else {
          output[out] = clampUint16(nextR);
          output[out + 1] = clampUint16(nextG);
          output[out + 2] = clampUint16(nextB);
        }
      }
    }
    return output;
  }

  function describeVariant(variant: OpticalFlowVariant): string {
    if (variant === "ext1") return "ext1 extrapolated";
    if (variant === "ext2") return "ext2 extrapolated";
    return "midpoint";
  }

  function clamp(value: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, value));
  }

  function clampUint16(value: number): number {
    if (!(value > 0)) return 0;
    if (value >= 65535) return 65535;
    return Math.round(value);
  }

  function estimatePeakBytes(sourceWidth: number, sourceHeight: number, flowWidth: number, flowHeight: number, workerCount: number): number {
    const gamma2Bytes = sourceWidth * sourceHeight * 3 * 2 * 2;
    const flowGrayBytes = flowWidth * flowHeight * 2;
    const transferredGrayBytes = flowGrayBytes * workerCount;
    const nativeGrayBytes = flowGrayBytes * workerCount;
    const nativeFlowBytes = flowWidth * flowHeight * 2 * 4 * 2;
    const returnedFlowBytes = nativeFlowBytes;
    const outputBytes = sourceWidth * sourceHeight * 3 * 2;
    // Known buffer sizes only; excludes OpenCV temporary pyramids and WASM
    // heap capacity. Not an actual browser peak-memory measurement.
    return gamma2Bytes + flowGrayBytes + transferredGrayBytes + nativeGrayBytes + nativeFlowBytes + returnedFlowBytes + outputBytes;
  }

  function postProgress(requestId: number, message: string): void {
    workerScope.postMessage({ type: "progress", requestId, message });
  }

})();
