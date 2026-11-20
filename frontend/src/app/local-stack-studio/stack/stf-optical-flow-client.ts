import { STF_FARNEBACK_BASE_WINSIZE } from "./stf-farneback-winsize";
import type {
  OpticalFlowOpeningVariant,
  OpticalFlowPerformanceStats,
  OpticalFlowVariant,
  OpticalFlowWarpMethod,
  OpticalFlowWorkerRequest,
  OpticalFlowWorkerResponse,
} from "../workers/protocols/optical-flow-protocol";

// Ownership transfer is opt-in: borrowed or sliced buffers must remain intact.
// A transferred input is detached from the caller after postMessage succeeds.
type InputOwnership = { previous?: boolean; next?: boolean };

// Cross-realm ArrayBuffers do not necessarily pass `instanceof ArrayBuffer`.
// This type predicate also lets TypeScript distinguish ArrayBuffer from SharedArrayBuffer.
function isTransferableArrayBuffer(buffer: ArrayBufferLike): buffer is ArrayBuffer {
  return Object.prototype.toString.call(buffer) === "[object ArrayBuffer]";
}

function workerInputBuffer(pixels: Uint16Array, transferOwnership: boolean): ArrayBuffer {
  const buffer = pixels.buffer;
  if (isTransferableArrayBuffer(buffer)) {
    // Only full, explicitly owned ArrayBuffers may be detached by postMessage.
    if (transferOwnership && pixels.byteOffset === 0 && pixels.byteLength === buffer.byteLength) {
      return buffer;
    }
    return buffer.slice(pixels.byteOffset, pixels.byteOffset + pixels.byteLength);
  }
  // SharedArrayBuffer is not transferable: copy the view into a new ArrayBuffer.
  const copy = new ArrayBuffer(pixels.byteLength);
  new Uint16Array(copy).set(pixels);
  return copy;
}

export type StfFlowStripe = {
  kind: "primary" | "additional";
  y: number;
  height: number;
  pixels: Uint16Array;
};

type StripeHandler = {
  width: number;
  height: number;
  additional: boolean;
  nextPrimaryY: number;
  nextAdditionalY: number;
  // Enforce exactly one consuming callback at a time for pipelined delivery.
  delivery: Promise<void>;
  onStripe: (stripe: StfFlowStripe) => void | Promise<void>;
};

type Pending = {
  stripes?: StripeHandler;
  resolve: (response: OpticalFlowWorkerResponse) => void;
  reject: (error: Error) => void;
};

export class StfOpticalFlowClient {
  private readonly worker: Worker;
  private readonly requests = new Map<number, Pending>();
  private nextRequestId = 1;

  constructor(onProgress?: (message: string) => void) {
    const workerUrl = new URL("/generated/local-stack-studio/optical-flow.worker.js", window.location.origin);
    workerUrl.searchParams.set("revision", "stf-session-flow-20261120-r20-stream-pipelining");
    this.worker = new Worker(workerUrl);
    this.worker.onmessage = (event: MessageEvent<OpticalFlowWorkerResponse>) => {
      const message = event.data;
      if (!message || typeof message.requestId !== "number") return;
      const pending = this.requests.get(message.requestId);
      if (!pending) return;
      if (message.type === "progress") {
        onProgress?.(message.message);
        return;
      }
      if (message.type === "stripe") {
        const state = pending.stripes;
        if (!state) {
          pending.reject(new Error("Unexpected STF Flow stripe"));
          this.requests.delete(message.requestId);
        } else {
          // Concurrent worker messages cannot reorder callbacks or acks.
          state.delivery = state.delivery.then(() => this.receiveStripe(message, pending));
        }
        return;
      }
      this.requests.delete(message.requestId);
      if (message.type === "error") pending.reject(new Error(message.message));
      else if (pending.stripes && (message.type !== "stream-result" ||
          pending.stripes.nextPrimaryY !== pending.stripes.height ||
          (pending.stripes.additional && pending.stripes.nextAdditionalY !== pending.stripes.height))) {
        pending.reject(new Error("STF Flow stream finished without all stripes"));
      } else pending.resolve(message);
    };
    this.worker.onerror = (event) => this.failAll(new Error(event.message || "STF Optical Flow worker error"));
    this.worker.onmessageerror = () => this.failAll(new Error("STF Optical Flow worker message error"));
  }

  private async receiveStripe(
    message: Extract<OpticalFlowWorkerResponse, { type: "stripe" }>, pending: Pending,
  ): Promise<void> {
    const state = pending.stripes;
    if (this.requests.get(message.requestId) !== pending) return;
    try {
      if (!state || message.width !== state.width || !Number.isInteger(message.height) || message.height <= 0 ||
          (message.kind !== "primary" && message.kind !== "additional")) {
        throw new Error("Invalid STF Flow stream stripe metadata");
      }
      const expectedY = message.kind === "primary" ? state.nextPrimaryY : state.nextAdditionalY;
      if (message.y !== expectedY || message.y + message.height > state.height ||
          (message.kind === "additional" && (!state.additional || state.nextPrimaryY !== state.height)) ||
          (message.kind === "primary" && state.nextAdditionalY !== 0)) {
        throw new Error("STF Flow stream stripe order is invalid");
      }
      const pixels = new Uint16Array(message.gamma2Buffer);
      if (pixels.length !== state.width * message.height * 3) {
        throw new Error("STF Flow stream stripe length is invalid");
      }
      await state.onStripe({ kind: message.kind, y: message.y, height: message.height, pixels });
      if (message.kind === "primary") state.nextPrimaryY += message.height;
      else state.nextAdditionalY += message.height;
      // Backpressure: the worker may synthesize the next stripe only after
      // tone matching and accumulator writes for this stripe are complete.
      this.worker.postMessage({ type: "stripe-ack", requestId: message.requestId,
        kind: message.kind, y: message.y });
    } catch (error) {
      const problem = error instanceof Error ? error : new Error(String(error));
      if (this.requests.get(message.requestId) !== pending) return;
      this.requests.delete(message.requestId);
      try { this.worker.postMessage({ type: "stripe-abort", requestId: message.requestId, message: problem.message }); }
      catch { /* Worker may have been terminated; preserve original error. */ }
      pending.reject(problem);
    }
  }

  private failAll(error: Error): void {
    for (const waiting of this.requests.values()) waiting.reject(error);
    this.requests.clear();
  }

  private request(
    message: Omit<Extract<OpticalFlowWorkerRequest, { type: "interpolate" }>, "requestId"> |
      Omit<Extract<OpticalFlowWorkerRequest, { type: "warmup" }>, "requestId"> |
      Omit<Extract<OpticalFlowWorkerRequest, { type: "warp-opening-average" }>, "requestId">,
    transfer: Transferable[] = [],
    stripes?: Omit<StripeHandler, "nextPrimaryY" | "nextAdditionalY" | "delivery">,
  ): Promise<OpticalFlowWorkerResponse> {
    const requestId = this.nextRequestId++;
    return new Promise((resolve, reject) => {
      this.requests.set(requestId, { resolve, reject, ...(stripes ? { stripes: {
        ...stripes, nextPrimaryY: 0, nextAdditionalY: 0, delivery: Promise.resolve(),
      } } : {}) });
      try {
        this.worker.postMessage({ ...message, requestId }, transfer);
      } catch (error) {
        this.requests.delete(requestId);
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }

  async warmup(): Promise<{ flowWorkerCount: number; warmupMs: number }> {
    const result = await this.request({ type: "warmup" });
    if (result.type !== "ready") throw new Error("Unexpected STF Flow warmup response");
    return { flowWorkerCount: result.flowWorkerCount, warmupMs: result.warmupMs };
  }

  async generate(
    width: number,
    height: number,
    previousImageId: number,
    nextImageId: number,
    previousGamma2: Uint16Array,
    nextGamma2: Uint16Array,
    variant: OpticalFlowVariant = "mid",
    variantScale?: number,
    additionalVariant?: OpticalFlowVariant,
    additionalVariantScale?: number,
    persistFlow = false,
    sessionId?: string,
    sessionCreatedAt?: number,
    alignmentKey?: string,
    openingAverageRadiusSpan?: number,
    winsize = STF_FARNEBACK_BASE_WINSIZE,
    inputOwnership: InputOwnership = {},
    warpMethod: OpticalFlowWarpMethod = "inverse-warp",
    forwardVariantScale?: number,
    additionalForwardVariantScale?: number,
  ): Promise<{ pixels: Uint16Array; additionalPixels?: Uint16Array; performance: OpticalFlowPerformanceStats }> {
    const previousGamma2Buffer = workerInputBuffer(previousGamma2, inputOwnership.previous === true);
    const nextGamma2Buffer = workerInputBuffer(nextGamma2, inputOwnership.next === true);
    const transfer: Transferable[] = [previousGamma2Buffer, nextGamma2Buffer];
    const result = await this.request({
      type: "interpolate",
      warpMethod,
      variant,
      ...(variantScale !== undefined ? { variantScale } : {}),
      ...(forwardVariantScale !== undefined ? { forwardVariantScale } : {}),
      ...(additionalVariant ? { additionalVariant } : {}),
      ...(additionalVariantScale !== undefined ? { additionalVariantScale } : {}),
      ...(additionalForwardVariantScale !== undefined ? { additionalForwardVariantScale } : {}),
      ...(openingAverageRadiusSpan !== undefined ? { openingAverageRadiusSpan } : {}),
      winsize,
      ...(persistFlow ? { persistFlow: true, sessionId, sessionCreatedAt, alignmentKey } : {}),
      width,
      height,
      previousImageId,
      nextImageId,
      linearRangeMax: 4,
      previousGamma2Buffer,
      nextGamma2Buffer,
    }, transfer);
    if (result.type !== "result" || result.width !== width || result.height !== height) {
      throw new Error("Invalid STF midpoint result");
    }
    const pixels = new Uint16Array(result.gamma2Buffer);
    if (pixels.length !== width * height * 3) throw new Error("STF Flow returned an invalid RGB16 buffer");
    const additionalPixels = result.additionalGamma2Buffer ? new Uint16Array(result.additionalGamma2Buffer) : undefined;
    if (additionalVariant && (!additionalPixels || additionalPixels.length !== width * height * 3)) {
      throw new Error("STF Flow returned an invalid additional RGB16 buffer");
    }
    return { pixels, ...(additionalPixels ? { additionalPixels } : {}), performance: result.performance };
  }

  // STF hot path: stream bounded RGB16 stripes. Unlike generate(), this
  // never materializes a full-resolution virtual image on either side.
  async generateStripes(
    args: {
      width: number; height: number; previousImageId: number; nextImageId: number;
      previousGamma2: Uint16Array; nextGamma2: Uint16Array;
      variant: OpticalFlowVariant; variantScale?: number;
      forwardVariantScale?: number;
      additionalVariant?: OpticalFlowVariant; additionalVariantScale?: number;
      additionalForwardVariantScale?: number;
      warpMethod?: OpticalFlowWarpMethod;
      sessionId: string; sessionCreatedAt: number; alignmentKey: string;
      openingAverageRadiusSpan?: number; winsize: number; inputOwnership: InputOwnership;
    },
    onStripe: (stripe: StfFlowStripe) => void | Promise<void>,
  ): Promise<OpticalFlowPerformanceStats> {
    const previousGamma2Buffer = workerInputBuffer(args.previousGamma2, args.inputOwnership.previous === true);
    const nextGamma2Buffer = workerInputBuffer(args.nextGamma2, args.inputOwnership.next === true);
    const response = await this.request({
      type: "interpolate", streamStripes: true,
      warpMethod: args.warpMethod ?? "inverse-warp",
      width: args.width, height: args.height,
      previousImageId: args.previousImageId, nextImageId: args.nextImageId,
      previousGamma2Buffer, nextGamma2Buffer, variant: args.variant,
      ...(args.variantScale !== undefined ? { variantScale: args.variantScale } : {}),
      ...(args.forwardVariantScale !== undefined ? { forwardVariantScale: args.forwardVariantScale } : {}),
      ...(args.additionalVariant ? { additionalVariant: args.additionalVariant } : {}),
      ...(args.additionalVariantScale !== undefined ? { additionalVariantScale: args.additionalVariantScale } : {}),
      ...(args.additionalForwardVariantScale !== undefined
        ? { additionalForwardVariantScale: args.additionalForwardVariantScale } : {}),
      ...(args.openingAverageRadiusSpan !== undefined ? { openingAverageRadiusSpan: args.openingAverageRadiusSpan } : {}),
      winsize: args.winsize, persistFlow: true,
      sessionId: args.sessionId, sessionCreatedAt: args.sessionCreatedAt, alignmentKey: args.alignmentKey,
      linearRangeMax: 4,
    }, [previousGamma2Buffer, nextGamma2Buffer], {
      width: args.width, height: args.height, additional: Boolean(args.additionalVariant), onStripe,
    });
    if (response.type !== "stream-result" || response.width !== args.width ||
        response.height !== args.height || !response.performance) {
      throw new Error("Invalid STF streamed midpoint result");
    }
    return response.performance;
  }

  async warpOpeningAverageStripes(
    args: {
      width: number; height: number; sourceImageId: number;
      variant: OpticalFlowOpeningVariant; variantScale: number;
      forwardVariantScale?: number;
      warpMethod?: OpticalFlowWarpMethod;
      sourceGamma2?: Uint16Array; transferSourceOwnership?: boolean;
    },
    onStripe: (stripe: StfFlowStripe) => void | Promise<void>,
  ): Promise<{ warpMs: number; stripeAckWaitMs?: number; warpScratchBytes?: number; estimatedPeakBytes?: number }> {
    const buffer = args.sourceGamma2
      ? workerInputBuffer(args.sourceGamma2, args.transferSourceOwnership === true) : undefined;
    const response = await this.request({
      type: "warp-opening-average", streamStripes: true,
      warpMethod: args.warpMethod ?? "inverse-warp",
      sourceImageId: args.sourceImageId, variant: args.variant, variantScale: args.variantScale,
      ...(args.forwardVariantScale !== undefined ? { forwardVariantScale: args.forwardVariantScale } : {}),
      ...(buffer ? { sourceGamma2Buffer: buffer } : {}),
    }, buffer ? [buffer] : [], {
      width: args.width, height: args.height, additional: false, onStripe,
    });
    if (response.type !== "stream-result" || response.width !== args.width ||
        response.height !== args.height || typeof response.warpMs !== "number") {
      throw new Error("Invalid STF streamed opening Average Flow result");
    }
    return { warpMs: response.warpMs, stripeAckWaitMs: response.stripeAckWaitMs,
      warpScratchBytes: response.warpScratchBytes,
      estimatedPeakBytes: response.estimatedPeakBytes };
  }

  async warpOpeningAverage(
    width: number, height: number, sourceImageId: number,
    variant: OpticalFlowOpeningVariant, variantScale: number,
    sourceGamma2?: Uint16Array,
    transferSourceOwnership = false,
    warpMethod: OpticalFlowWarpMethod = "inverse-warp",
    forwardVariantScale?: number,
  ): Promise<{ pixels: Uint16Array; warpMs: number }> {
    const buffer = sourceGamma2 ? workerInputBuffer(sourceGamma2, transferSourceOwnership) : undefined;
    const result = await this.request({
      type: "warp-opening-average", sourceImageId, variant, variantScale, warpMethod,
      ...(forwardVariantScale !== undefined ? { forwardVariantScale } : {}),
      ...(buffer ? { sourceGamma2Buffer: buffer } : {}),
    }, buffer ? [buffer] : []);
    if (result.type !== "warp-result" || result.width !== width || result.height !== height) {
      throw new Error("Invalid STF opening Average Flow warp result");
    }
    const pixels = new Uint16Array(result.gamma2Buffer);
    if (pixels.length !== width * height * 3) throw new Error("Invalid STF opening Average Flow RGB16 buffer");
    return { pixels, warpMs: result.warpMs };
  }

  releaseRetained(): void {
    this.worker.postMessage({ type: "release-retained", requestId: 0 });
  }

  terminate(): void {
    this.failAll(new Error("STF Optical Flow terminated"));
    this.worker.terminate();
  }
}
