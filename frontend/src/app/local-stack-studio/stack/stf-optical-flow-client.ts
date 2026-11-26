import { stfFlowWorkingSize, stfGamma2RgbToGray8Resampled } from "./stf-flow-gray";
import { STF_FARNEBACK_BASE_WINSIZE } from "./stf-farneback-winsize";
import type {
  OpticalFlowOpeningVariant,
  StfFlowGenerationProfile,
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

type InputCopyTiming = { copiedBytes: number };
function workerInputBuffer(
  pixels: Uint16Array, transferOwnership: boolean, timing?: InputCopyTiming,
): ArrayBuffer {
  const buffer = pixels.buffer;
  if (isTransferableArrayBuffer(buffer)) {
    // Only full, explicitly owned ArrayBuffers may be detached by postMessage.
    if (transferOwnership && pixels.byteOffset === 0 && pixels.byteLength === buffer.byteLength) {
      return buffer;
    }
    if (timing) timing.copiedBytes += pixels.byteLength;
    return buffer.slice(pixels.byteOffset, pixels.byteOffset + pixels.byteLength);
  }
  // SharedArrayBuffer is not transferable: copy the view into a new ArrayBuffer.
  if (timing) timing.copiedBytes += pixels.byteLength;
  const copy = new ArrayBuffer(pixels.byteLength);
  new Uint16Array(copy).set(pixels);
  return copy;
}

export type StfFlowStripe = {
  kind: "primary" | "additional";
  middleIndex?: number;
  y: number;
  height: number;
  pixels: Uint16Array;
};

type StripeHandler = {
  width: number;
  height: number;
  additional: boolean;
  primaryCount: number;
  interleavedPrimary: boolean;
  nextPrimaryIndex: number;
  nextPrimaryY: number;
  nextAdditionalY: number;
  // Enforce exactly one consuming callback at a time for pipelined delivery.
  delivery: Promise<void>;
  onStripe: (stripe: StfFlowStripe) => void | Promise<void>;
  onFlowConsumed?: () => void;
  flowConsumed: boolean;
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
  private readonly grayPrefetchCache = new Map<number, Uint8Array>();

  constructor(onProgress?: (message: string) => void) {
    const workerUrl = new URL("/generated/local-stack-studio/optical-flow.worker.js", window.location.origin);
    workerUrl.searchParams.set("revision", "stf-opening-compression2-one-pass-v1");
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
      if (message.type === "flow-consumed") {
        const state = pending.stripes;
        if (state && !state.flowConsumed) {
          state.flowConsumed = true;
          state.onFlowConsumed?.();
        }
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
          pending.stripes.nextPrimaryIndex !== pending.stripes.primaryCount ||
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
      const middleIndex = message.middleIndex ?? 0;
      if (message.y !== expectedY || message.y + message.height > state.height ||
          (message.kind === "primary" && (middleIndex !== state.nextPrimaryIndex ||
            state.nextAdditionalY !== 0)) ||
          (message.kind === "additional" && (!state.additional ||
            state.nextPrimaryIndex !== state.primaryCount || message.middleIndex !== undefined))) {
        throw new Error("STF Flow stream stripe order is invalid");
      }
      const pixels = new Uint16Array(message.gamma2Buffer);
      if (pixels.length !== state.width * message.height * 3) {
        throw new Error("STF Flow stream stripe length is invalid");
      }
      await state.onStripe({ kind: message.kind,
        ...(message.kind === "primary" ? { middleIndex } : {}),
        y: message.y, height: message.height, pixels });
      if (message.kind === "primary") {
        if (state.interleavedPrimary) {
          // Each output stripe is generated for all fractions before the
          // next y. For any one pixel, the accumulator still receives the
          // frames in the same order as the original frame-major stream.
          state.nextPrimaryIndex++;
          if (state.nextPrimaryIndex === state.primaryCount) {
            state.nextPrimaryY += message.height;
            state.nextPrimaryIndex = state.nextPrimaryY === state.height ? state.primaryCount : 0;
            if (state.nextPrimaryY === state.height) state.nextPrimaryY = 0;
          }
        } else {
          state.nextPrimaryY += message.height;
          if (state.nextPrimaryY === state.height) {
            state.nextPrimaryY = 0;
            state.nextPrimaryIndex++;
          }
        }
      } else state.nextAdditionalY += message.height;
      // Backpressure: the worker may synthesize the next stripe only after
      // tone matching and accumulator writes for this stripe are complete.
      this.worker.postMessage({ type: "stripe-ack", requestId: message.requestId,
        kind: message.kind, y: message.y,
        ...(message.middleIndex !== undefined ? { middleIndex: message.middleIndex } : {}) });
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
      Omit<Extract<OpticalFlowWorkerRequest, { type: "warp-opening-average" }>, "requestId"> |
      Omit<Extract<OpticalFlowWorkerRequest, { type: "prefetch-check" }>, "requestId"> |
      Omit<Extract<OpticalFlowWorkerRequest, { type: "prefetch-compute" }>, "requestId">,
    transfer: Transferable[] = [],
    stripes?: Omit<StripeHandler, "nextPrimaryIndex" | "nextPrimaryY" | "nextAdditionalY" | "delivery" | "flowConsumed">,
    postTiming?: { ms: number },
  ): Promise<OpticalFlowWorkerResponse> {
    const requestId = this.nextRequestId++;
    return new Promise((resolve, reject) => {
      this.requests.set(requestId, { resolve, reject, ...(stripes ? { stripes: {
        ...stripes, nextPrimaryIndex: 0, nextPrimaryY: 0,
        nextAdditionalY: 0, delivery: Promise.resolve(), flowConsumed: false,
      } } : {}) });
      try {
        const postedAt = performance.now();
        try {
          this.worker.postMessage({ ...message, requestId }, transfer);
        } finally {
          if (postTiming) postTiming.ms += performance.now() - postedAt;
        }
      } catch (error) {
        this.requests.delete(requestId);
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }

  /** Prime at most two adjacent real pairs while another pair is being warped.
   * A cache hit does not create Gray8 proxies; a miss sends only downsampled
   * proxies and keeps the full RGB16 buffers untouched for ordered Warp.
   */
  async prefetchFlow(args: {
    width: number; height: number;
    previousImageId: number; nextImageId: number;
    previousGamma2: Uint16Array; nextGamma2: Uint16Array;
    winsize: number; sessionId: string; sessionCreatedAt: number; alignmentKey: string;
  }): Promise<void> {
    const identity = {
      width: args.width, height: args.height,
      previousImageId: args.previousImageId, nextImageId: args.nextImageId,
      winsize: args.winsize, sessionId: args.sessionId,
      sessionCreatedAt: args.sessionCreatedAt, alignmentKey: args.alignmentKey,
    };
    const check = await this.request({ type: "prefetch-check", ...identity });
    if (check.type !== "prefetch-status") throw new Error("Invalid STF Flow prefetch check response");
    if (!check.needsGray) return;
    const started = performance.now();
    const { width, height } = stfFlowWorkingSize(args.width, args.height);
    const grayFor = (index: number, rgb: Uint16Array): Uint8Array => {
      const reused = this.grayPrefetchCache.get(index);
      if (reused) return reused;
      const gray = stfGamma2RgbToGray8Resampled(rgb, args.width, args.height, width, height, 2);
      this.grayPrefetchCache.set(index, gray);
      return gray;
    };
    const previousGray = grayFor(args.previousImageId, args.previousGamma2);
    const nextGray = grayFor(args.nextImageId, args.nextGamma2);
    const prepareFlowInputsMs = performance.now() - started;
    // Keep only proxies that an adjacent in-flight pair might use.
    for (const index of this.grayPrefetchCache.keys()) {
      if (index !== args.previousImageId && index !== args.nextImageId) this.grayPrefetchCache.delete(index);
    }
    const previousGrayBuffer = new Uint8Array(previousGray).buffer;
    const nextGrayBuffer = new Uint8Array(nextGray).buffer;
    const result = await this.request({
      type: "prefetch-compute", ...identity, previousGrayBuffer, nextGrayBuffer, prepareFlowInputsMs,
    }, [previousGrayBuffer, nextGrayBuffer]);
    if (result.type !== "prefetch-ready") throw new Error("Invalid STF Flow prefetch compute response");
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
    additionalWarpMethod?: OpticalFlowWarpMethod,
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
      ...(additionalWarpMethod !== undefined ? { additionalWarpMethod } : {}),
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
      middleFractions?: number[];
      forwardVariantScale?: number;
      additionalVariant?: OpticalFlowVariant; additionalVariantScale?: number;
      additionalForwardVariantScale?: number;
      additionalWarpMethod?: OpticalFlowWarpMethod;
      warpMethod?: OpticalFlowWarpMethod;
      sessionId: string; sessionCreatedAt: number; alignmentKey: string;
      openingAverageRadiusSpan?: number; winsize: number; inputOwnership: InputOwnership;
    },
    onStripe: (stripe: StfFlowStripe) => void | Promise<void>,
    onFlowConsumed?: () => void,
  ): Promise<OpticalFlowPerformanceStats> {
    const copying = { copiedBytes: 0 };
    const copyStartedAt = performance.now();
    const previousGamma2Buffer = workerInputBuffer(args.previousGamma2, args.inputOwnership.previous === true, copying);
    const nextGamma2Buffer = workerInputBuffer(args.nextGamma2, args.inputOwnership.next === true, copying);
    const inputCloneMs = performance.now() - copyStartedAt;
    const postTiming = { ms: 0 };
    const response = await this.request({
      type: "interpolate", streamStripes: true,
      warpMethod: args.warpMethod ?? "inverse-warp",
      width: args.width, height: args.height,
      previousImageId: args.previousImageId, nextImageId: args.nextImageId,
      previousGamma2Buffer, nextGamma2Buffer, variant: args.variant,
      ...(args.middleFractions !== undefined ? { middleFractions: args.middleFractions } : {}),
      ...(args.variantScale !== undefined ? { variantScale: args.variantScale } : {}),
      ...(args.forwardVariantScale !== undefined ? { forwardVariantScale: args.forwardVariantScale } : {}),
      ...(args.additionalVariant ? { additionalVariant: args.additionalVariant } : {}),
      ...(args.additionalVariantScale !== undefined ? { additionalVariantScale: args.additionalVariantScale } : {}),
      ...(args.additionalForwardVariantScale !== undefined
        ? { additionalForwardVariantScale: args.additionalForwardVariantScale } : {}),
      ...(args.additionalWarpMethod !== undefined ? { additionalWarpMethod: args.additionalWarpMethod } : {}),
      ...(args.openingAverageRadiusSpan !== undefined ? { openingAverageRadiusSpan: args.openingAverageRadiusSpan } : {}),
      winsize: args.winsize, persistFlow: true,
      sessionId: args.sessionId, sessionCreatedAt: args.sessionCreatedAt, alignmentKey: args.alignmentKey,
      linearRangeMax: 4,
    }, [previousGamma2Buffer, nextGamma2Buffer], {
      width: args.width, height: args.height, additional: Boolean(args.additionalVariant),
      primaryCount: args.middleFractions?.length ?? 1,
      interleavedPrimary: (args.middleFractions?.length ?? 1) > 1 && (args.warpMethod ?? "inverse-warp") === "inverse-warp",
      onStripe, onFlowConsumed,
    }, postTiming);
    if (response.type !== "stream-result" || response.width !== args.width ||
        response.height !== args.height || !response.performance) {
      throw new Error("Invalid STF streamed midpoint result");
    }
    return { ...response.performance, inputCloneMs, inputClonedBytes: copying.copiedBytes,
      inputPostMs: postTiming.ms };
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
  ): Promise<{ warpMs: number; stripeAckWaitMs?: number; warpScratchBytes?: number; estimatedPeakBytes?: number;
    profile?: StfFlowGenerationProfile; inputCloneMs?: number; inputClonedBytes?: number; inputPostMs?: number }> {
    const copying = { copiedBytes: 0 };
    const copyStartedAt = performance.now();
    const buffer = args.sourceGamma2
      ? workerInputBuffer(args.sourceGamma2, args.transferSourceOwnership === true, copying) : undefined;
    const inputCloneMs = performance.now() - copyStartedAt;
    const postTiming = { ms: 0 };
    const response = await this.request({
      type: "warp-opening-average", streamStripes: true,
      warpMethod: args.warpMethod ?? "inverse-warp",
      sourceImageId: args.sourceImageId, variant: args.variant, variantScale: args.variantScale,
      ...(args.forwardVariantScale !== undefined ? { forwardVariantScale: args.forwardVariantScale } : {}),
      ...(buffer ? { sourceGamma2Buffer: buffer } : {}),
    }, buffer ? [buffer] : [], {
      width: args.width, height: args.height, additional: false, primaryCount: 1,
      interleavedPrimary: false, onStripe,
    }, postTiming);
    if (response.type !== "stream-result" || response.width !== args.width ||
        response.height !== args.height || typeof response.warpMs !== "number") {
      throw new Error("Invalid STF streamed opening Average Flow result");
    }
    return { warpMs: response.warpMs, stripeAckWaitMs: response.stripeAckWaitMs,
      warpScratchBytes: response.warpScratchBytes,
      estimatedPeakBytes: response.estimatedPeakBytes, profile: response.profile,
      inputCloneMs, inputClonedBytes: copying.copiedBytes, inputPostMs: postTiming.ms };
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
    this.grayPrefetchCache.clear();
    this.worker.terminate();
  }
}
