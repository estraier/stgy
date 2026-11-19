// Local Stack Studio Optical Flow worker. Built to public/generated/local-stack-studio.
import type {
  OpticalFlowDirectionRequest,
  OpticalFlowDirectionResponse,
} from "./protocols/optical-flow-direction-protocol";
import { transferableBuffer } from "./transfer-buffer";
import { readStfCachedFlow, writeStfCachedFlow, stfFlowSessionKey } from "../stack/stf-flow-cache";
import { stfFlowWorkingSize, stfGamma2RgbToGray8Resampled } from "../stack/stf-flow-gray";
import { isStfFarnebackWinsize, STF_FARNEBACK_BASE_WINSIZE } from "../stack/stf-farneback-winsize";
import { buildStfAverageFlow, type StfAverageFlowSample } from "../stack/stf-average-flow";
import { buildStfFlowNormGate, stfFlowNormGateFactor, type StfFlowNormGate } from "../stack/stf-flow-norm-gate";
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
    private readonly worker = new Worker("/generated/local-stack-studio/optical-flow-direction.worker.js?revision=stf-fixed31-f-dependent-r1");
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
    winsize: number,
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
        type: "compute-pair", width, height, winsize,
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
        type: "compute", width, height, winsize,
        previousGrayBuffer: forwardPrevious, nextGrayBuffer: forwardNext,
      }, [forwardPrevious, forwardNext]),
      pool.clients[1].request({
        type: "compute", width, height, winsize,
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

  // A pair can be used for multiple opening-side variants. Derive each
  // direction's native Flow percentiles once, never from scaled extrapolation.
  type NormGateCache = { forward?: StfFlowNormGate | null; backward?: StfFlowNormGate | null };

  function gateForVariant(
    variant: OpticalFlowVariant,
    forward: Float32Array,
    backward: Float32Array,
    cache: NormGateCache,
  ): StfFlowNormGate | null {
    if (variant === "mid") return null; // Interpolation must remain unchanged.
    if (variant === "ext2") {
      if (cache.backward === undefined) cache.backward = buildStfFlowNormGate(backward);
      return cache.backward;
    }
    if (cache.forward === undefined) cache.forward = buildStfFlowNormGate(forward);
    return cache.forward;
  }

  // Opening-side average extrapolation keeps up to the first three native
  // forward Flow fields. IndexedDB persistence remains per real adjacent pair.
  const openingSamples: StfAverageFlowSample[] = [];
  let openingAverage: Float32Array | null = null;
  let openingAverageGeometry: { width: number; height: number; imageWidth: number; imageHeight: number;
    sourceImageId: number; nextPreviousImageId: number } | null = null;
  let openingAverageWarp: { sourceImageId: number; source: Uint16Array;
    flow: Float32Array; gate: StfFlowNormGate | null } | null = null;

  // One outstanding stripe per request: the main thread acknowledges a stripe
  // only after applying its tone curve and accumulation. Never queue a whole
  // image worth of messages or detached allocations in either thread.
  const awaitingStripe = new Map<number, {
    y: number; kind: "primary" | "additional";
    resolve: () => void; reject: (error: Error) => void;
  }>();

  async function sendStripe(
    requestId: number, kind: "primary" | "additional", y: number, height: number,
    width: number, rgb: Uint16Array,
  ): Promise<void> {
    const gamma2Buffer = transferableBuffer(rgb);
    await new Promise<void>((resolve, reject) => {
      awaitingStripe.set(requestId, { y, kind, resolve, reject });
      try {
        workerScope.postMessage({ type: "stripe", requestId, kind, y, height, width, gamma2Buffer }, [gamma2Buffer]);
      } catch (error) {
        awaitingStripe.delete(requestId);
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }

  // Cap each transferred RGB16 stripe at approximately 4 MiB and 128 rows.
  function stripeRows(width: number): number {
    return Math.max(1, Math.min(128, Math.floor((4 * 1024 * 1024) / (width * 6))));
  }

  // Calculate the exact old warp pixels, but only for a stripe's y-range.
  async function streamVariant(
    requestId: number, kind: "primary" | "additional", variant: OpticalFlowVariant,
    previous: Uint16Array, next: Uint16Array, width: number, height: number,
    forward: Float32Array, backward: Float32Array, flowWidth: number, flowHeight: number,
    variantScale: number | undefined, normGate: StfFlowNormGate | null,
  ): Promise<{ warpMs: number; waitMs: number }> {
    let warpMs = 0;
    let waitMs = 0;
    const rows = stripeRows(width);
    for (let y = 0; y < height; y += rows) {
      const chunkHeight = Math.min(rows, height - y);
      const started = performance.now();
      const pixels = synthesizeFlowVariant(variant, previous, next, width, height,
        forward, backward, flowWidth, flowHeight, variantScale, normGate, y, chunkHeight);
      warpMs += performance.now() - started;
      const waitStarted = performance.now();
      await sendStripe(requestId, kind, y, chunkHeight, width, pixels);
      waitMs += performance.now() - waitStarted;
    }
    return { warpMs, waitMs };
  }

  workerScope.onmessage = async (event: MessageEvent<OpticalFlowWorkerRequest>) => {
    const message = event.data;
    if (message.type === "stripe-ack" || message.type === "stripe-abort") {
      const waiter = awaitingStripe.get(message.requestId);
      if (waiter) {
        awaitingStripe.delete(message.requestId);
        if (message.type === "stripe-abort") waiter.reject(new Error(message.message));
        else if (message.y === waiter.y && message.kind === waiter.kind) waiter.resolve();
        else waiter.reject(new Error("STF Flow stripe acknowledgement mismatch"));
      }
      return;
    }
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
      if (message.type === "release-retained") {
        openingAverageWarp = null;
        return;
      }
      if (message.type === "warp-opening-average") {
        const geometry = openingAverageGeometry;
        if (!geometry) throw new Error("STF opening Average Flow has no real-pair fields.");
        if (message.sourceImageId !== geometry.sourceImageId) {
          throw new Error("STF opening Average Flow source ID mismatch.");
        }
        const started = performance.now();
        if (message.sourceGamma2Buffer) {
          const source = new Uint16Array(message.sourceGamma2Buffer);
          if (source.length !== geometry.imageWidth * geometry.imageHeight * 3) {
            throw new Error("STF opening Average Flow source image size mismatch.");
          }
          if (!openingAverage && !openingSamples.length) {
            throw new Error("STF opening Average Flow lacks a source Flow field.");
          }
          const flow = openingAverage ?? buildStfAverageFlow(openingSamples, geometry.width, geometry.height);
          openingAverageWarp = { sourceImageId: geometry.sourceImageId, source, flow,
            gate: buildStfFlowNormGate(flow) };
          openingSamples.length = 0;
          openingAverage = null;
        }
        const current = openingAverageWarp;
        if (!current || current.sourceImageId !== message.sourceImageId) {
          throw new Error("STF opening Average Flow needs an initialized real source image.");
        }
        if (message.streamStripes) {
          const { warpMs } = await streamVariant(message.requestId, "primary", message.variant,
            current.source, current.source, geometry.imageWidth, geometry.imageHeight,
            current.flow, current.flow, geometry.width, geometry.height, message.variantScale, current.gate);
          workerScope.postMessage({ type: "stream-result", requestId: message.requestId,
            width: geometry.imageWidth, height: geometry.imageHeight, warpMs });
        } else {
          const output = synthesizeFlowVariant(message.variant, current.source, current.source,
            geometry.imageWidth, geometry.imageHeight, current.flow, current.flow,
            geometry.width, geometry.height, message.variantScale, current.gate);
          const gamma2Buffer = transferableBuffer(output);
          workerScope.postMessage({ type: "warp-result", requestId: message.requestId,
            width: geometry.imageWidth, height: geometry.imageHeight,
            gamma2Buffer, warpMs: performance.now() - started }, [gamma2Buffer]);
        }
        return;
      }
      if (message.type !== "interpolate") {
        throw new Error(`Unsupported Optical Flow worker request: ${String((message as { type?: unknown }).type)}`);
      }
      const result = await interpolateMiddleFrame(message);
      if (message.streamStripes) {
        workerScope.postMessage({ type: "stream-result", requestId: message.requestId,
          width: result.width, height: result.height, performance: result.performance });
      } else {
        if (!result.gamma2Rgb) throw new Error("STF Flow did not generate an RGB16 midpoint");
        const gamma2Buffer = transferableBuffer(result.gamma2Rgb);
        const additionalGamma2Buffer = result.additionalGamma2Rgb
          ? transferableBuffer(result.additionalGamma2Rgb) : undefined;
        workerScope.postMessage({
          type: "result", requestId: message.requestId,
          width: result.width, height: result.height, gamma2Buffer,
          ...(additionalGamma2Buffer ? { additionalGamma2Buffer } : {}),
          flowWidth: result.flowWidth, flowHeight: result.flowHeight,
          performance: result.performance,
        }, additionalGamma2Buffer ? [gamma2Buffer, additionalGamma2Buffer] : [gamma2Buffer]);
      }
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
    const winsize = message.winsize ?? STF_FARNEBACK_BASE_WINSIZE;
    if (!isStfFarnebackWinsize(winsize)) {
      throw new Error("STF Optical Flow requires a valid odd Farneback window.");
    }
    const flowSize = stfFlowWorkingSize(width, height);
    // Grayscale is only for Farneback; the persistent cache identity is the
    // Canonical session plus image pair and alignment parameters, never pixels.
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

    const cacheReadStarted = performance.now();
    if (message.persistFlow && (!message.sessionId || !message.alignmentKey ||
        !Number.isSafeInteger(message.sessionCreatedAt) || message.sessionCreatedAt! < 0)) {
      throw new Error("STF persistent Flow requires a Canonical session identity");
    }
    const flowCacheKey = message.persistFlow
      ? stfFlowSessionKey(message.sessionId!, message.previousImageId!, message.nextImageId!,
          message.alignmentKey!, flowSize.width, flowSize.height, winsize) : null;
    const cached = flowCacheKey
      ? await readStfCachedFlow(message.sessionId!, flowCacheKey, flowSize.width, flowSize.height) : null;
    const flowCacheReadMs = performance.now() - cacheReadStarted;
    if (!cached) postProgress(message.requestId,
      `Computing bidirectional Optical Flow (${flowSize.width}×${flowSize.height}, winsize=${winsize})...`);
    const flows = cached ? {
      ...cached, forwardMs: 0, backwardMs: 0, wallMs: 0, workerCount: 0, warmupMs: 0,
    } : await computeBidirectionalFlow(gray0, gray1, flowSize.width, flowSize.height, winsize);
    if (flows.forward.length !== flowSize.width * flowSize.height * 2 ||
        flows.backward.length !== flowSize.width * flowSize.height * 2) {
      throw new Error("Optical Flow direction worker returned an invalid vector field.");
    }
    if (message.openingAverageRadiusSpan !== undefined) {
      if (!(message.openingAverageRadiusSpan > 0) || !Number.isFinite(message.openingAverageRadiusSpan) ||
          message.previousImageId === undefined || message.nextImageId === undefined) {
        throw new Error("STF opening Average Flow received an invalid aperture interval or image IDs.");
      }
      if (openingAverageGeometry && (openingAverageGeometry.width !== flowSize.width ||
          openingAverageGeometry.height !== flowSize.height ||
          openingAverageGeometry.imageWidth !== width || openingAverageGeometry.imageHeight !== height ||
          openingAverageGeometry.nextPreviousImageId !== message.previousImageId)) {
        throw new Error("STF opening Average Flow received a nonconsecutive real-image pair or changed dimensions.");
      }
      if (!openingAverageGeometry) {
        openingAverageGeometry = { width: flowSize.width, height: flowSize.height,
          imageWidth: width, imageHeight: height, sourceImageId: message.previousImageId,
          nextPreviousImageId: message.nextImageId };
      } else {
        openingAverageGeometry.nextPreviousImageId = message.nextImageId;
      }
      if (!openingAverage && openingSamples.length < 3) {
        openingSamples.push({ flow: flows.forward, radiusSpan: message.openingAverageRadiusSpan });
        if (openingSamples.length === 3) {
          // Collapse three 32 MiB fields into one before the remaining pairs
          // are processed.
          openingAverage = buildStfAverageFlow(openingSamples, flowSize.width, flowSize.height);
          openingSamples.length = 0;
        }
      }
    }
    // Begin best-effort persistence while the CPU is busy warping. Await its
    // completion before returning so that terminating this Worker cannot lose
    // a pending IndexedDB transaction.
    const cacheWriteStarted = performance.now();
    const cacheWrite = flowCacheKey && !cached
      ? writeStfCachedFlow(message.sessionId!, flowCacheKey, message.sessionCreatedAt!,
          flowSize.width, flowSize.height, flows.forward, flows.backward)
      : Promise.resolve(false);

    const normGates: NormGateCache = {};
    postProgress(message.requestId, `Warping Optical Flow ${describeVariant(message.variant)} image...`);
    const warpStartedAt = performance.now();
    const primaryGate = gateForVariant(message.variant, flows.forward, flows.backward, normGates);
    const output = message.streamStripes ? undefined : synthesizeFlowVariant(
      message.variant, previousGamma2Rgb, nextGamma2Rgb, width, height,
      flows.forward, flows.backward, flowSize.width, flowSize.height, message.variantScale, primaryGate);
    const primaryStream = message.streamStripes
      ? await streamVariant(message.requestId, "primary", message.variant,
          previousGamma2Rgb, nextGamma2Rgb, width, height, flows.forward, flows.backward,
          flowSize.width, flowSize.height, message.variantScale, primaryGate)
      : null;
    const warpMs = primaryStream?.warpMs ?? (performance.now() - warpStartedAt);
    // Both frames use the *same* native 4MP forward/backward fields. Never
    // start an extra Farneback computation just to synthesize the outer image.
    const additionalWarpStartedAt = performance.now();
    const extraGate = message.additionalVariant
      ? gateForVariant(message.additionalVariant, flows.forward, flows.backward, normGates) : null;
    const additionalGamma2Rgb = message.additionalVariant && !message.streamStripes
      ? synthesizeFlowVariant(message.additionalVariant, previousGamma2Rgb, nextGamma2Rgb,
          width, height, flows.forward, flows.backward, flowSize.width, flowSize.height, message.additionalVariantScale,
          extraGate)
      : undefined;
    const additionalStream = message.additionalVariant && message.streamStripes
      ? await streamVariant(message.requestId, "additional", message.additionalVariant,
          previousGamma2Rgb, nextGamma2Rgb, width, height, flows.forward, flows.backward,
          flowSize.width, flowSize.height, message.additionalVariantScale, extraGate)
      : null;
    const additionalWarpMs = message.additionalVariant
      ? additionalStream?.warpMs ?? (performance.now() - additionalWarpStartedAt)
      : undefined;
    const flowCacheSaved = await cacheWrite;
    const flowCacheWriteMs = flowCacheSaved ? performance.now() - cacheWriteStarted : 0;
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
      // Exclude main-thread acknowledgement waits from Worker execution time.
      totalWorkerMs: performance.now() - workerStartedAt -
        (primaryStream?.waitMs ?? 0) - (additionalStream?.waitMs ?? 0),
      estimatedPeakBytes: estimatePeakBytes(width, height, flowSize.width, flowSize.height, flows.workerCount,
        message.streamStripes ? Math.min(height, stripeRows(width)) * width * 6 : undefined),
      inputGamma2Bytes: previousGamma2Rgb.byteLength + nextGamma2Rgb.byteLength,
      flowFieldBytes: flows.forward.byteLength + flows.backward.byteLength,
      flowCacheHit: Boolean(cached), flowCacheSaved, flowCacheReadMs, flowCacheWriteMs,
      outputBytes: width * height * 6 * (message.additionalVariant ? 2 : 1),
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
    variantScale?: number,
    normGate: StfFlowNormGate | null = null,
    startY = 0,
    stripeHeight = height,
  ): Uint16Array {
    if (!Number.isInteger(startY) || !Number.isInteger(stripeHeight) ||
        startY < 0 || stripeHeight <= 0 || startY + stripeHeight > height) {
      throw new Error("Invalid STF Flow stripe bounds");
    }
    const output = new Uint16Array(width * stripeHeight * 3);
    const scaleX = width / flowWidth;
    const scaleY = height / flowHeight;
    const edgeX = Math.max(0, flowWidth - 1);
    const edgeY = Math.max(0, flowHeight - 1);
    // Opening-side and closing-side variants each use an inverse-warp
    // multiplier derived from the virtual F-number outside the Worker.
    const openingStep = variant === "ext1" ? 1 : variant.startsWith("ext1-") ? Number(variant.slice(5)) : 0;
    if (openingStep && (!Number.isInteger(openingStep) || openingStep < 1 || openingStep > 12)) {
      throw new Error("STF Optical Flow received an unsupported opening extrapolation step.");
    }
    const defaultScale = openingStep ? openingStep * 0.5 : 0.5;
    const resolvedScale = variantScale === undefined ? defaultScale : variantScale;
    if (!Number.isFinite(resolvedScale) || resolvedScale <= 0) {
      throw new Error("STF Optical Flow extrapolation scale must be finite and positive.");
    }
    const previousFactor = openingStep ? -resolvedScale : 0.5;
    const nextFactor = openingStep ? 1 + resolvedScale : variant === "ext2" ? -resolvedScale : 0.5;
    const usePrevious = variant !== "ext2";
    const useNext = !openingStep;

    for (let y = startY; y < startY + stripeHeight; y += 1) {
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
        // Extrapolation samples only its source direction. Avoid interpolating
        // the unused Flow field for every output pixel; midpoint still needs both.
        const forwardX = usePrevious
          ? flowForward[ff00] * flowW00 + flowForward[ff10] * flowW10 + flowForward[ff01] * flowW01 + flowForward[ff11] * flowW11
          : 0;
        const forwardY = usePrevious
          ? flowForward[ff00 + 1] * flowW00 + flowForward[ff10 + 1] * flowW10 + flowForward[ff01 + 1] * flowW01 + flowForward[ff11 + 1] * flowW11
          : 0;
        const backwardX = useNext
          ? flowBackward[ff00] * flowW00 + flowBackward[ff10] * flowW10 + flowBackward[ff01] * flowW01 + flowBackward[ff11] * flowW11
          : 0;
        const backwardY = useNext
          ? flowBackward[ff00 + 1] * flowW00 + flowBackward[ff10 + 1] * flowW10 + flowBackward[ff01 + 1] * flowW01 + flowBackward[ff11 + 1] * flowW11
          : 0;
        // Gate only the direction used by extrapolation. The percentile
        // thresholds were derived in native Flow pixels *before* applying the
        // virtual-F scaling, so ext1..32 share one stable cutoff.
        const flowGateFactor = !normGate ? 1 : openingStep
          ? stfFlowNormGateFactor(forwardX, forwardY, normGate)
          : stfFlowNormGateFactor(backwardX, backwardY, normGate);

        let previousR = 0;
        let previousG = 0;
        let previousB = 0;
        if (usePrevious) {
          const previousX = clamp(x - previousFactor * forwardX * flowGateFactor * scaleX, 0, width - 1);
          const previousY = clamp(y - previousFactor * forwardY * flowGateFactor * scaleY, 0, height - 1);
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
          const nextX = clamp(x - nextFactor * backwardX * flowGateFactor * scaleX, 0, width - 1);
          const nextY = clamp(y - nextFactor * backwardY * flowGateFactor * scaleY, 0, height - 1);
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

        const out = ((y - startY) * width + x) * 3;
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
    if (variant === "ext1" || variant.startsWith("ext1-")) return `${variant} extrapolated`;
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

  function estimatePeakBytes(sourceWidth: number, sourceHeight: number, flowWidth: number, flowHeight: number,
    workerCount: number, streamingOutputBytes?: number): number {
    const gamma2Bytes = sourceWidth * sourceHeight * 3 * 2 * 2;
    const flowGrayBytes = flowWidth * flowHeight * 2;
    const transferredGrayBytes = flowGrayBytes * workerCount;
    const nativeGrayBytes = flowGrayBytes * workerCount;
    const nativeFlowBytes = flowWidth * flowHeight * 2 * 4 * 2;
    const returnedFlowBytes = nativeFlowBytes;
    const outputBytes = streamingOutputBytes ?? sourceWidth * sourceHeight * 3 * 2;
    // Known buffer sizes only; excludes OpenCV temporary pyramids and WASM
    // heap capacity. Not an actual browser peak-memory measurement.
    return gamma2Bytes + flowGrayBytes + transferredGrayBytes + nativeGrayBytes + nativeFlowBytes + returnedFlowBytes + outputBytes;
  }

  function postProgress(requestId: number, message: string): void {
    workerScope.postMessage({ type: "progress", requestId, message });
  }

})();
