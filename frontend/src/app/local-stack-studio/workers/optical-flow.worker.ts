// Local Stack Studio Optical Flow worker. Built to public/generated/local-stack-studio.
import type {
  OpticalFlowDirectionRequest,
  OpticalFlowDirectionResponse,
} from "./protocols/optical-flow-direction-protocol";
import { transferableBuffer } from "./transfer-buffer";
import {
  fillStfSplatHole, STF_SPLAT_HOLE_MAX_RADIUS, STF_SPLAT_HOLE_NEIGHBOR_BUCKET_COUNT, STF_SPLAT_HOLE_SEARCH_BUCKET_COUNT,
} from "./stf-splat-hole-fill";
import {
  readStfCachedFlow, writeStfCachedFlow, stfFlowSessionKey,
  type StfFlowCacheWriteDiagnostics,
} from "../stack/stf-flow-cache";
import { stfFlowWorkingSize, stfGamma2RgbToGray8Resampled } from "../stack/stf-flow-gray";
import { isStfFarnebackWinsize, STF_FARNEBACK_BASE_WINSIZE } from "../stack/stf-farneback-winsize";
import { buildStfAverageFlow, type StfAverageFlowSample } from "../stack/stf-average-flow";
import { stfSplatCompressionWeight } from "../stack/stf-splat-geometry";
import { buildStfFlowNormGate, stfFlowNormGateFactor, type StfFlowNormGate } from "../stack/stf-flow-norm-gate";
import type {
  OpticalFlowPerformanceStats,
  StfFlowGenerationProfile,
  OpticalFlowVariant,
  OpticalFlowWarpMethod,
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
    private readonly worker = new Worker("/generated/local-stack-studio/optical-flow-direction.worker.js?revision=stf-base21-f-dependent-r2");
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
  let extraDirectionPoolPromise: Promise<DirectionPool> | null = null;

  function supportsTwoDirectionPairs(): boolean {
    const availableCores = navigator.hardwareConcurrency || 1;
    const deviceMemory = (navigator as Navigator & { deviceMemory?: number }).deviceMemory;
    // Preserve the legacy fallback for <4 cores or reported RAM below 8 GiB.
    return availableCores >= 4 && !(deviceMemory !== undefined && deviceMemory < 8);
  }

  function directionWorkerCount(): number {
    return supportsTwoDirectionPairs() ? 2 : 1;
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

  // Spawn the second direction pair lazily, not for a one-pair STF operation.
  async function ensureDirectionPair(slot: number): Promise<DirectionPool> {
    const pool = await ensureDirectionPool();
    if (slot === 0) return pool;
    if (slot !== 1 || !supportsTwoDirectionPairs()) {
      throw new Error("STF Flow has no second direction pair available.");
    }
    if (extraDirectionPoolPromise) return extraDirectionPoolPromise;
    extraDirectionPoolPromise = (async () => {
      const start = performance.now();
      const clients = [new DirectionClient(), new DirectionClient()];
      try {
        const ready = await Promise.all(clients.map((client) => client.request({ type: "init" })));
        if (ready.some((entry) => entry.type !== "ready")) {
          throw new Error("Optical Flow second direction pair initialization failed.");
        }
        pool.clients.push(...clients);
        pool.warmupMs += performance.now() - start;
        return pool;
      } catch (error) {
        for (const client of clients) client.terminate();
        throw error;
      }
    })().catch((error) => {
      extraDirectionPoolPromise = null;
      throw error;
    });
    return extraDirectionPoolPromise;
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
    pairSlot = 0,
  ): Promise<{
    forward: Float32Array;
    backward: Float32Array;
    forwardMs: number;
    backwardMs: number;
    wallMs: number;
    workerCount: number;
    warmupMs: number;
  }> {
    const coldStart = directionPoolPromise === null;
    const pool = await ensureDirectionPair(pairSlot);
    if (pairSlot !== 0 && (pairSlot !== 1 || pool.clients.length < 4)) {
      throw new Error("STF Flow prefetch requires an available two-direction slot.");
    }
    const poolWarmupMs = coldStart ? pool.warmupMs : 0;
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
        warmupMs: poolWarmupMs,
      };
    }

    const forwardPrevious = grayCopyBuffer(previousGray);
    const forwardNext = grayCopyBuffer(nextGray);
    const backwardPrevious = grayCopyBuffer(nextGray);
    const backwardNext = grayCopyBuffer(previousGray);
    const firstWorker = pairSlot * 2;
    const [forwardResult, backwardResult] = await Promise.all([
      pool.clients[firstWorker].request({
        type: "compute", width, height, winsize,
        previousGrayBuffer: forwardPrevious, nextGrayBuffer: forwardNext,
      }, [forwardPrevious, forwardNext]),
      pool.clients[firstWorker + 1].request({
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
      warmupMs: poolWarmupMs,
    };
  }

  // Prefetched pairs are held only in this per-Process worker. Their results
  // are consumed in real-pair order by interpolateMiddleFrame, preserving the
  // opening Average Flow accumulator and all existing Warp/stripe behavior.
  type ComputedFlow = Awaited<ReturnType<typeof computeBidirectionalFlow>>;
  type PrefetchedPair = {
    slot: number;
    status: "checking" | "needs-gray" | "computing" | "ready";
    cacheReadMs: number;
    prepareFlowInputsMs: number;
    cached: boolean;
    flows: ComputedFlow | null;
  };
  const prefetchedPairs = new Map<string, PrefetchedPair>();
  function prefetchIdentity(args: {
    width: number; height: number; previousImageId: number; nextImageId: number;
    winsize: number; sessionId: string; alignmentKey: string;
  }): { key: string; width: number; height: number } {
    if (!Number.isInteger(args.width) || !Number.isInteger(args.height) ||
        args.width <= 0 || args.height <= 0 || !isStfFarnebackWinsize(args.winsize)) {
      throw new Error("Invalid STF Flow prefetch geometry or winsize.");
    }
    const size = stfFlowWorkingSize(args.width, args.height);
    const key = stfFlowSessionKey(args.sessionId, args.previousImageId, args.nextImageId,
      args.alignmentKey, size.width, size.height, args.winsize);
    if (!key) throw new Error("Invalid STF Flow prefetch session or pair identity.");
    return { key, width: size.width, height: size.height };
  }

  // A pair can be used for multiple opening-side variants. Derive each
  // direction's native Flow percentiles once, never from scaled extrapolation.
  type NormGateCache = { forward?: StfFlowNormGate | null; backward?: StfFlowNormGate | null };

  function measuredNormGate(flow: Float32Array, profile: StfFlowGenerationProfile): StfFlowNormGate | null {
    const timing: { normsMs?: number; sortMs?: number } = {};
    const gate = buildStfFlowNormGate(flow, timing);
    profile.gateNormsMs = (profile.gateNormsMs ?? 0) + (timing.normsMs ?? 0);
    profile.gateSortMs = (profile.gateSortMs ?? 0) + (timing.sortMs ?? 0);
    profile.gateBuilds = (profile.gateBuilds ?? 0) + 1;
    return gate;
  }

  function gateForVariant(
    variant: OpticalFlowVariant,
    forward: Float32Array,
    backward: Float32Array,
    cache: NormGateCache,
    profile: StfFlowGenerationProfile,
  ): StfFlowNormGate | null {
    if (variant === "mid") return null; // Interpolation must remain unchanged.
    if (variant === "ext2") {
      if (cache.backward === undefined) cache.backward = measuredNormGate(backward, profile);
      return cache.backward;
    }
    if (cache.forward === undefined) cache.forward = measuredNormGate(forward, profile);
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

  // Single-variant Warp permits two transferred stripes in flight. Shared-
  // Flow multi-interpolation instead uses two complete row groups below;
  // every stripe is still individually acknowledged after consumption.
  const MAX_INFLIGHT_STRIPES = 2;
  // Shared-Flow interpolation generates one stripe for every fraction at
  // the same y. Bound the pipeline by completed row groups instead of
  // stalling halfway through each group after two individual sends.
  const MAX_INFLIGHT_MIDDLE_GROUPS = 2;
  type StripeWaiter = { resolve: () => void; reject: (error: Error) => void };
  const awaitingStripe = new Map<number, Map<string, StripeWaiter>>();
  const stripeKey = (kind: "primary" | "additional", y: number, middleIndex?: number) =>
    `${kind}:${middleIndex ?? 0}:${y}`;

  function sendStripe(
    requestId: number, kind: "primary" | "additional", y: number, height: number,
    width: number, rgb: Uint16Array, middleIndex?: number,
  ): Promise<void> {
    const gamma2Buffer = transferableBuffer(rgb);
    return new Promise<void>((resolve, reject) => {
      let pending = awaitingStripe.get(requestId);
      if (!pending) {
        pending = new Map();
        awaitingStripe.set(requestId, pending);
      }
      const key = stripeKey(kind, y, middleIndex);
      if (pending.has(key)) {
        reject(new Error("Duplicate STF Flow stripe"));
        return;
      }
      pending.set(key, { resolve, reject });
      try {
        workerScope.postMessage({ type: "stripe", requestId, kind,
          ...(middleIndex !== undefined ? { middleIndex } : {}),
          y, height, width, gamma2Buffer }, [gamma2Buffer]);
      } catch (error) {
        pending.delete(key);
        if (pending.size === 0) awaitingStripe.delete(requestId);
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }

  // Cap each transferred RGB16 stripe at approximately 4 MiB and 128 rows.
  function stripeRows(width: number): number {
    return Math.max(1, Math.min(128, Math.floor((4 * 1024 * 1024) / (width * 6))));
  }

  function geometryScratchBytes(width: number, height: number,
    streaming: boolean, method: OpticalFlowWarpMethod): number {
    // Double-buffered transfer permits one stripe to be consumed while the
    // next is rendered/sent, so up to two RGB16 stripe buffers can coexist.
    const stripeBytes = streaming ? Math.min(2, Math.ceil(height / stripeRows(width))) *
      Math.min(height, stripeRows(width)) * width * 6 : 0;
    // Inverse Warp and Forward Splat share one persistent Flow-coordinate
    // lookup: x/y Flow indices (2 x Int32) and fractions (Float64).
    const lookupBytes = (width + height) * (2 * 4 + 8);
    if (method === "inverse-warp") return (streaming ? stripeBytes : width * height * 6) + lookupBytes;
    // Full-frame fallback/non-streaming geometry estimate. Normal streamed
    // FS reports its actual destination-band buffer size from streamVariant.
    return width * height * (12 + 4 + (streaming ? 0 : 6)) + stripeBytes + lookupBytes;
  }

  function flowSamplingGeometry(width: number, height: number, flowWidth: number, flowHeight: number) {
    return {
      scaleX: width / flowWidth,
      scaleY: height / flowHeight,
      edgeX: Math.max(0, flowWidth - 1),
      edgeY: Math.max(0, flowHeight - 1),
    };
  }

  function resolveVariantFactors(variant: OpticalFlowVariant, variantScale?: number) {
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
    return {
      openingStep,
      resolvedScale,
      previousFactor,
      nextFactor,
      usePrevious: variant !== "ext2",
      useNext: !openingStep,
    };
  }

  // Flow sampling geometry is invariant across FS and inverse Warp variants
  // (and both Flow directions) for the same image/Flow dimensions. Keep just
  // one small worker-local lookup, replacing it when the geometry changes.
  type FlowSampleLookup = {
    width: number; height: number; flowWidth: number; flowHeight: number;
    scaleX: number; scaleY: number;
    x0: Int32Array; x1: Int32Array; fx: Float64Array;
    y0: Int32Array; y1: Int32Array; fy: Float64Array;
  };
  let flowSampleLookup: FlowSampleLookup | null = null;

  function getFlowSampleLookup(
    width: number, height: number, flowWidth: number, flowHeight: number,
  ): FlowSampleLookup {
    const existing = flowSampleLookup;
    if (existing && existing.width === width && existing.height === height &&
        existing.flowWidth === flowWidth && existing.flowHeight === flowHeight) {
      return existing;
    }
    const { scaleX, scaleY, edgeX, edgeY } = flowSamplingGeometry(width, height, flowWidth, flowHeight);
    const x0 = new Int32Array(width);
    const x1 = new Int32Array(width);
    const fx = new Float64Array(width);
    for (let x = 0; x < width; x++) {
      const flowX = flowWidth === 1 ? 0 : ((x + 0.5) * flowWidth / width) - 0.5;
      const clamped = clamp(flowX, 0, edgeX);
      const first = Math.floor(clamped);
      x0[x] = first * 2;
      x1[x] = Math.min(edgeX, first + 1) * 2;
      fx[x] = clamped - first;
    }
    const y0 = new Int32Array(height);
    const y1 = new Int32Array(height);
    const fy = new Float64Array(height);
    for (let y = 0; y < height; y++) {
      const flowY = flowHeight === 1 ? 0 : ((y + 0.5) * flowHeight / height) - 0.5;
      const clamped = clamp(flowY, 0, edgeY);
      const first = Math.floor(clamped);
      y0[y] = first * flowWidth * 2;
      y1[y] = Math.min(edgeY, first + 1) * flowWidth * 2;
      fy[y] = clamped - first;
    }
    const lookup = { width, height, flowWidth, flowHeight, scaleX, scaleY, x0, x1, fx, y0, y1, fy };
    flowSampleLookup = lookup;
    return lookup;
  }

  type ForwardSplatState = {
    variant: OpticalFlowVariant;
    weights: Float32Array;
    accum: Float32Array;
    usePrevious: boolean;
    useNext: boolean;
    inverseWarpScale: number | undefined;
    forwardSplatScale: number | undefined;
    searchCounts: number[];
    neighborCounts: number[];
    accumulatorStartPixel: number;
  };

  function fallbackPixel(
    output: Uint16Array,
    outputPixelIndex: number,
    previousGamma2Rgb: Uint16Array,
    nextGamma2Rgb: Uint16Array,
    pixelIndex: number,
    usePrevious: boolean,
    useNext: boolean,
  ): void {
    const base = pixelIndex * 3;
    const out = outputPixelIndex * 3;
    if (usePrevious && useNext) {
      output[out] = clampUint16((previousGamma2Rgb[base] + nextGamma2Rgb[base]) * 0.5);
      output[out + 1] = clampUint16((previousGamma2Rgb[base + 1] + nextGamma2Rgb[base + 1]) * 0.5);
      output[out + 2] = clampUint16((previousGamma2Rgb[base + 2] + nextGamma2Rgb[base + 2]) * 0.5);
    } else if (usePrevious) {
      output[out] = previousGamma2Rgb[base];
      output[out + 1] = previousGamma2Rgb[base + 1];
      output[out + 2] = previousGamma2Rgb[base + 2];
    } else {
      output[out] = nextGamma2Rgb[base];
      output[out + 1] = nextGamma2Rgb[base + 1];
      output[out + 2] = nextGamma2Rgb[base + 2];
    }
  }

  function accumulateForwardSplat(
    variant: OpticalFlowVariant,
    previousGamma2Rgb: Uint16Array,
    nextGamma2Rgb: Uint16Array,
    width: number,
    height: number,
    flowForward: Float32Array,
    flowBackward: Float32Array,
    flowWidth: number,
    flowHeight: number,
    inverseWarpScale?: number,
    normGate: StfFlowNormGate | null = null,
    forwardSplatScale?: number,
  ): ForwardSplatState {
    if (variant !== "mid" && !(forwardSplatScale !== undefined &&
        Number.isFinite(forwardSplatScale) && forwardSplatScale > 0)) {
      throw new Error("STF forward splatting requires an explicit source-coordinate extrapolation scale.");
    }
    const lookup = getFlowSampleLookup(width, height, flowWidth, flowHeight);
    // A forward splat uses the source-coordinate geometric scale, not the
    // inverse-warp scale applied to output-position sampling.
    const { previousFactor, nextFactor, usePrevious, useNext } =
      resolveVariantFactors(variant, forwardSplatScale ?? inverseWarpScale);
    const weights = new Float32Array(width * height);
    const accum = new Float32Array(width * height * 3);
    const compressionEnabled = variant.startsWith("ext1");
    const addSource = (
      source: Uint16Array,
      flow: Float32Array,
      factor: number,
      gate: StfFlowNormGate | null,
    ) => {
      for (let y = 0; y < height; y++) {
        const row0 = lookup.y0[y];
        const row1 = lookup.y1[y];
        const flowFy = lookup.fy[y];
        const oneMinusFy = 1 - flowFy;
        for (let x = 0; x < width; x++) {
          const col0 = lookup.x0[x];
          const col1 = lookup.x1[x];
          const flowFx = lookup.fx[x];
          const oneMinusFx = 1 - flowFx;
          const flowW00 = oneMinusFx * oneMinusFy;
          const flowW10 = flowFx * oneMinusFy;
          const flowW01 = oneMinusFx * flowFy;
          const flowW11 = flowFx * flowFy;
          const ff00 = row0 + col0;
          const ff10 = row0 + col1;
          const ff01 = row1 + col0;
          const ff11 = row1 + col1;
          // No allocation of a {x,y} sample object inside the pixel loop.
          // Keep the same accumulation order as the original bilinear sampler.
          const flowX = flow[ff00] * flowW00 + flow[ff10] * flowW10 +
            flow[ff01] * flowW01 + flow[ff11] * flowW11;
          const flowY = flow[ff00 + 1] * flowW00 + flow[ff10 + 1] * flowW10 +
            flow[ff01 + 1] * flowW01 + flow[ff11 + 1] * flowW11;
          const gateFactor = gate ? stfFlowNormGateFactor(flowX, flowY, gate) : 1;
          const tx = clamp(x + factor * flowX * gateFactor * lookup.scaleX, 0, width - 1);
          const ty = clamp(y + factor * flowY * gateFactor * lookup.scaleY, 0, height - 1);
          const sourceIndex = (y * width + x) * 3;
          const r = source[sourceIndex];
          const g = source[sourceIndex + 1];
          const b = source[sourceIndex + 2];
          const x0 = Math.floor(tx);
          const y0 = Math.floor(ty);
          const x1 = Math.min(width - 1, x0 + 1);
          const y1 = Math.min(height - 1, y0 + 1);
          const fx = tx - x0;
          const fy = ty - y0;
          const priority = compressionEnabled
            ? stfSplatCompressionWeight(Math.hypot(tx - x, ty - y)) : 1;
          const w00 = (1 - fx) * (1 - fy) * priority;
          const w10 = fx * (1 - fy) * priority;
          const w01 = (1 - fx) * fy * priority;
          const w11 = fx * fy * priority;
          // Inline the four splat contributions: no per-pixel closure,
          // repeated height calculation or per-pixel helper call.
          if (w00 > 0) {
            const index = y0 * width + x0;
            const base = index * 3;
            weights[index] += w00;
            accum[base] += r * w00;
            accum[base + 1] += g * w00;
            accum[base + 2] += b * w00;
          }
          if (w10 > 0) {
            const index = y0 * width + x1;
            const base = index * 3;
            weights[index] += w10;
            accum[base] += r * w10;
            accum[base + 1] += g * w10;
            accum[base + 2] += b * w10;
          }
          if (w01 > 0) {
            const index = y1 * width + x0;
            const base = index * 3;
            weights[index] += w01;
            accum[base] += r * w01;
            accum[base + 1] += g * w01;
            accum[base + 2] += b * w01;
          }
          if (w11 > 0) {
            const index = y1 * width + x1;
            const base = index * 3;
            weights[index] += w11;
            accum[base] += r * w11;
            accum[base + 1] += g * w11;
            accum[base + 2] += b * w11;
          }
        }
      }
    };
    if (usePrevious) addSource(previousGamma2Rgb, flowForward, previousFactor, variant === "mid" ? null : normGate);
    if (useNext) addSource(nextGamma2Rgb, flowBackward, nextFactor, variant === "mid" ? null : normGate);
    return {
      variant, weights, accum, usePrevious, useNext,
      inverseWarpScale, forwardSplatScale,
      searchCounts: new Array<number>(STF_SPLAT_HOLE_SEARCH_BUCKET_COUNT).fill(0),
      neighborCounts: new Array<number>(STF_SPLAT_HOLE_NEIGHBOR_BUCKET_COUNT).fill(0),
      accumulatorStartPixel: 0,
    };
  }

  function renderForwardSplatStripe(
    state: ForwardSplatState,
    previousGamma2Rgb: Uint16Array,
    nextGamma2Rgb: Uint16Array,
    width: number,
    height: number,
    startY: number,
    stripeHeight: number,
  ): Uint16Array {
    const output = new Uint16Array(width * stripeHeight * 3);
    const startPixel = startY * width;
    const endPixel = (startY + stripeHeight) * width;
    const { weights, accum, searchCounts, neighborCounts, usePrevious, useNext } = state;
    for (let pixel = startPixel; pixel < endPixel; pixel++) {
      const out = (pixel - startPixel) * 3;
      const bandPixel = pixel - state.accumulatorStartPixel;
      const base = bandPixel * 3;
      const weight = weights[bandPixel];
      if (weight > 0) {
        output[out] = clampUint16(accum[base] / weight);
        output[out + 1] = clampUint16(accum[base + 1] / weight);
        output[out + 2] = clampUint16(accum[base + 2] / weight);
      } else {
        const filled = fillStfSplatHole(output, pixel, width, height, weights, accum,
          searchCounts, neighborCounts, startPixel, state.accumulatorStartPixel);
        if (!filled) {
          // Last-resort original-source copy; never run inverse warping.
          fallbackPixel(output, pixel - startPixel, previousGamma2Rgb, nextGamma2Rgb,
            pixel, usePrevious, useNext);
        }
      }
    }
    return output;
  }

  // Forward splatting normally requires 16 bytes per output pixel (RGB F32
  // accumulators plus F32 weight). In streaming mode, the source image may
  // splat outside its original row. Accumulate *destination* bands including
  // eight untouched FS rows of halo on each side for ring hole filling.
  // Each band visits source rows in the SAME source/row/column order as the
  // original full-frame implementation, preserving Float32 summation exactly.
  //
  // To exclude unrelated source rows safely, first bound every native Flow
  // row's |dy|. Bilinear interpolation and the extrapolation norm gate are
  // convex/bounded, so the bound also covers every full-resolution sample.
  type SplatRowReach = {
    displacement: Float64Array;
    maxDisplacement: number;
    factors: ReturnType<typeof resolveVariantFactors>;
    lookup: FlowSampleLookup;
  };

  function buildSplatRowReach(
    variant: OpticalFlowVariant, width: number, height: number,
    forward: Float32Array, backward: Float32Array,
    flowWidth: number, flowHeight: number, forwardScale?: number,
  ): SplatRowReach | null {
    const factors = resolveVariantFactors(variant, forwardScale);
    const lookup = getFlowSampleLookup(width, height, flowWidth, flowHeight);
    const forwardMax = new Float64Array(flowHeight);
    const backwardMax = new Float64Array(flowHeight);
    const collect = (flow: Float32Array, output: Float64Array): boolean => {
      for (let y = 0; y < flowHeight; y++) {
        let maximum = 0;
        for (let x = 0; x < flowWidth; x++) {
          const dy = flow[(y * flowWidth + x) * 2 + 1];
          if (!Number.isFinite(dy)) return false;
          maximum = Math.max(maximum, Math.abs(dy));
        }
        output[y] = maximum;
      }
      return true;
    };
    if (factors.usePrevious && !collect(forward, forwardMax)) return null;
    if (factors.useNext && !collect(backward, backwardMax)) return null;
    const displacement = new Float64Array(height);
    let maxDisplacement = 0;
    const maxRows = (values: Float64Array, lo: number, hi: number) => Math.max(values[lo], values[hi]);
    for (let y = 0; y < height; y++) {
      const lo = lookup.y0[y] / (flowWidth * 2);
      const hi = lookup.y1[y] / (flowWidth * 2);
      const first = factors.usePrevious ? maxRows(forwardMax, lo, hi) * Math.abs(factors.previousFactor) : 0;
      const second = factors.useNext ? maxRows(backwardMax, lo, hi) * Math.abs(factors.nextFactor) : 0;
      const bound = Math.max(first, second) * lookup.scaleY;
      if (!Number.isFinite(bound)) return null;
      // 2px conservatism covers bilinear footprint and floating-point edge
      // rounding. It does not alter the splat calculation itself.
      displacement[y] = bound + 2;
      maxDisplacement = Math.max(maxDisplacement, bound);
    }
    return { displacement, maxDisplacement, factors, lookup };
  }

  function bandSourceRows(reach: Float64Array, bandStartY: number, bandEndY: number): number {
    let count = 0;
    for (let y = 0; y < reach.length; y++) {
      if (y + reach[y] >= bandStartY && y - reach[y] < bandEndY) count++;
    }
    return count;
  }


  function splatSourceIntoBand(
    source: Uint16Array, flow: Float32Array, factor: number,
    gate: StfFlowNormGate | null, width: number, height: number,
    lookup: FlowSampleLookup, reach: Float64Array,
    bandStartY: number, bandEndY: number,
    weights: Float32Array, accum: Float32Array,
    compressionEnabled = false,
  ): void {
    const lastX = width - 1;
    const lastY = height - 1;
    const sourceRowStride = width * 3;
    for (let y = 0; y < height; y++) {
      const sourceRowStart = y * sourceRowStride;
      if (y + reach[y] < bandStartY || y - reach[y] >= bandEndY) continue;
      const row0 = lookup.y0[y];
      const row1 = lookup.y1[y];
      const flowFy = lookup.fy[y];
      const oneMinusFy = 1 - flowFy;
      for (let x = 0, sourceIndex = sourceRowStart; x < width; x++, sourceIndex += 3) {
        const col0 = lookup.x0[x];
        const col1 = lookup.x1[x];
        const flowFx = lookup.fx[x];
        const oneMinusFx = 1 - flowFx;
        const flowW00 = oneMinusFx * oneMinusFy;
        const flowW10 = flowFx * oneMinusFy;
        const flowW01 = oneMinusFx * flowFy;
        const flowW11 = flowFx * flowFy;
        const ff00 = row0 + col0;
        const ff10 = row0 + col1;
        const ff01 = row1 + col0;
        const ff11 = row1 + col1;
        const flowX = flow[ff00] * flowW00 + flow[ff10] * flowW10 +
          flow[ff01] * flowW01 + flow[ff11] * flowW11;
        const flowY = flow[ff00 + 1] * flowW00 + flow[ff10 + 1] * flowW10 +
          flow[ff01 + 1] * flowW01 + flow[ff11 + 1] * flowW11;
        const gateFactor = gate ? stfFlowNormGateFactor(flowX, flowY, gate) : 1;
        const tx = clamp(x + factor * flowX * gateFactor * lookup.scaleX, 0, lastX);
        const ty = clamp(y + factor * flowY * gateFactor * lookup.scaleY, 0, lastY);
        const r = source[sourceIndex];
        const g = source[sourceIndex + 1];
        const b = source[sourceIndex + 2];
        const x0 = Math.floor(tx);
        const y0 = Math.floor(ty);
        // When fx/fy are positive, their next pixel is necessarily in bounds;
        // a clamped right/bottom edge has a zero next-pixel weight.
        const x1 = x0 + 1;
        const y1 = y0 + 1;
        const fx = tx - x0;
        const fy = ty - y0;
        const priority = compressionEnabled
          ? stfSplatCompressionWeight(Math.hypot(tx - x, ty - y)) : 1;
        const w00 = (1 - fx) * (1 - fy) * priority;
        const w10 = fx * (1 - fy) * priority;
        const w01 = (1 - fx) * fy * priority;
        const w11 = fx * fy * priority;
        // Most splats touch four valid destinations inside this band. Keep
        // the same Float32 update order, but avoid six per-corner checks and
        // repeated row/index calculations on this common interior path.
        if (y0 >= bandStartY && y1 < bandEndY && x0 < lastX) {
          const index00 = (y0 - bandStartY) * width + x0;
          const index10 = index00 + 1;
          const index01 = index00 + width;
          const index11 = index01 + 1;
          const base00 = index00 * 3;
          const base10 = base00 + 3;
          const base01 = base00 + sourceRowStride;
          const base11 = base01 + 3;
          weights[index00] += w00;
          accum[base00] += r * w00;
          accum[base00 + 1] += g * w00;
          accum[base00 + 2] += b * w00;
          weights[index10] += w10;
          accum[base10] += r * w10;
          accum[base10 + 1] += g * w10;
          accum[base10 + 2] += b * w10;
          weights[index01] += w01;
          accum[base01] += r * w01;
          accum[base01 + 1] += g * w01;
          accum[base01 + 2] += b * w01;
          weights[index11] += w11;
          accum[base11] += r * w11;
          accum[base11 + 1] += g * w11;
          accum[base11 + 2] += b * w11;
          continue;
        }
        // Destination arrays hold only [bandStartY, bandEndY). No splat may
        // escape the band; source rows that can hit it are processed in the
        // original source ordering, so every retained pixel is bit-identical.
        if (y0 >= bandStartY && y0 < bandEndY) {
          const rowIndex = (y0 - bandStartY) * width;
          if (w00 > 0) {
            const index = rowIndex + x0;
            const base = index * 3;
            weights[index] += w00;
            accum[base] += r * w00;
            accum[base + 1] += g * w00;
            accum[base + 2] += b * w00;
          }
          if (w10 > 0) {
            const index = rowIndex + x1;
            const base = index * 3;
            weights[index] += w10;
            accum[base] += r * w10;
            accum[base + 1] += g * w10;
            accum[base + 2] += b * w10;
          }
        }
        if (y1 >= bandStartY && y1 < bandEndY) {
          const rowIndex = (y1 - bandStartY) * width;
          if (w01 > 0) {
            const index = rowIndex + x0;
            const base = index * 3;
            weights[index] += w01;
            accum[base] += r * w01;
            accum[base + 1] += g * w01;
            accum[base + 2] += b * w01;
          }
          if (w11 > 0) {
            const index = rowIndex + x1;
            const base = index * 3;
            weights[index] += w11;
            accum[base] += r * w11;
            accum[base + 1] += g * w11;
            accum[base + 2] += b * w11;
          }
        }
      }
    }
  }

  type SplatTilePlan = {
    rows: number;
    bands: number;
    sourceRowPasses: number;
    reach: SplatRowReach;
    scratchBytes: number;
  };

  function planSplatTiles(
    variant: OpticalFlowVariant, width: number, height: number,
    forward: Float32Array, backward: Float32Array,
    flowWidth: number, flowHeight: number, forwardScale: number | undefined,
    profile?: StfFlowGenerationProfile,
  ): SplatTilePlan | null {
    const reachStartedAt = performance.now();
    const reach = buildSplatRowReach(variant, width, height, forward, backward,
      flowWidth, flowHeight, forwardScale);
    if (profile) profile.fsRowReachMs = (profile.fsRowReachMs ?? 0) + performance.now() - reachStartedAt;
    if (!reach) return null;
    const searchStartedAt = performance.now();
    // Render several transfer stripes from one destination band, amortizing
    // rescanning of input rows close to a band boundary.
    const transferRows = stripeRows(width);
    const minimumRows = transferRows * Math.ceil(Math.max(transferRows * 4, 512) / transferRows);
    let rows = 0;
    let bands = 0;
    let sourceRowPasses = 0;
    // Increase band height when Flow moves source pixels far vertically.
    // Larger bands trade a little memory for fewer repeated source visits.
    // Keep bands aligned to transfer stripes, so stripe order and size stay
    // unchanged. In the extreme, retain the original full-frame algorithm.
    const candidates = [1, 1.5, 2, 3, 4, 6];
    let previousCandidate = 0;
    for (const multiplier of candidates) {
      const candidate = transferRows * Math.ceil(minimumRows * multiplier / transferRows);
      if (candidate === previousCandidate || candidate >= height) continue;
      previousCandidate = candidate;
      let visits = 0;
      let count = 0;
      for (let startY = 0; startY < height; startY += candidate) {
        const endY = Math.min(height, startY + candidate);
        const haloStart = Math.max(0, startY - STF_SPLAT_HOLE_MAX_RADIUS);
        const haloEnd = Math.min(height, endY + STF_SPLAT_HOLE_MAX_RADIUS);
        visits += bandSourceRows(reach.displacement, haloStart, haloEnd);
        count++;
      }
      if (visits <= height * 1.9) {
        rows = candidate;
        bands = count;
        sourceRowPasses = visits;
        break;
      }
    }
    if (profile) profile.fsTileSearchMs = (profile.fsTileSearchMs ?? 0) + performance.now() - searchStartedAt;
    if (!rows) return null;
    const bandRows = Math.min(height, rows + STF_SPLAT_HOLE_MAX_RADIUS * 2);
    const stripeBytes = Math.min(2, Math.ceil(height / transferRows)) *
      Math.min(height, transferRows) * width * 6;
    const lookupBytes = (width + height) * 16;
    const reachBytes = height * 8 + flowHeight * 16;
    return { rows, bands, sourceRowPasses, reach,
      scratchBytes: bandRows * width * 16 +
        stripeBytes + lookupBytes + reachBytes };
  }

  function synthesizeFlowVariantForwardSplat(
    variant: OpticalFlowVariant,
    previousGamma2Rgb: Uint16Array,
    nextGamma2Rgb: Uint16Array,
    width: number,
    height: number,
    flowForward: Float32Array,
    flowBackward: Float32Array,
    flowWidth: number,
    flowHeight: number,
    inverseWarpScale?: number,
    normGate: StfFlowNormGate | null = null,
    forwardSplatScale?: number,
    profile?: StfFlowGenerationProfile,
  ): Uint16Array {
    const splatStartedAt = performance.now();
    const state = accumulateForwardSplat(variant, previousGamma2Rgb, nextGamma2Rgb,
      width, height, flowForward, flowBackward, flowWidth, flowHeight,
      inverseWarpScale, normGate, forwardSplatScale);
    if (profile) profile.fsSplatMs = (profile.fsSplatMs ?? 0) + performance.now() - splatStartedAt;
    const renderStartedAt = performance.now();
    const output = renderForwardSplatStripe(state, previousGamma2Rgb, nextGamma2Rgb,
      width, height, 0, height);
    if (profile) profile.fsRenderMs = (profile.fsRenderMs ?? 0) + performance.now() - renderStartedAt;
    return output;
  }

  // Calculate the exact old warp pixels, but only for a stripe's y-range.
  async function streamVariant(
    requestId: number, kind: "primary" | "additional", variant: OpticalFlowVariant,
    previous: Uint16Array, next: Uint16Array, width: number, height: number,
    forward: Float32Array, backward: Float32Array, flowWidth: number, flowHeight: number,
    variantScale: number | undefined, normGate: StfFlowNormGate | null,
    warpMethod: OpticalFlowWarpMethod,
    forwardVariantScale?: number,
    middleFraction = 0.5,
    middleIndex?: number,
    profile?: StfFlowGenerationProfile,
  ): Promise<{ warpMs: number; waitMs: number; scratchBytes: number }> {
    let warpMs = 0;
    let waitMs = 0;
    let scratchBytes = geometryScratchBytes(width, height, true, warpMethod);
    // Convert each completion into a fulfilled outcome immediately so a fast
    // stripe-abort cannot create an unhandled rejection while another stripe
    // is still being rendered. Never exceed two unacknowledged stripe buffers.
    const pending: Array<Promise<Error | null>> = [];
    const accept = async (y: number, chunkHeight: number, stripe: Uint16Array): Promise<void> => {
      pending.push(sendStripe(requestId, kind, y, chunkHeight, width, stripe, middleIndex).then(
        () => null, (reason: unknown) => reason instanceof Error ? reason : new Error(String(reason)),
      ));
      if (pending.length >= MAX_INFLIGHT_STRIPES) {
        const began = performance.now();
        const error = await pending.shift()!;
        waitMs += performance.now() - began;
        if (error) throw error;
      }
    };
    try {
      const rows = stripeRows(width);
      if (warpMethod !== "inverse-warp") {
        if (variant !== "mid" && !(forwardVariantScale !== undefined &&
            Number.isFinite(forwardVariantScale) && forwardVariantScale > 0)) {
          throw new Error("STF forward splatting requires an explicit source-coordinate extrapolation scale.");
        }
        const started = performance.now();
        // The full-frame renderer remains the fallback for unusually large
        // vertical motions, where source-row rescanning would become slower
        // than a full-frame accumulator. Non-streaming calls also stay full.
        const plan = planSplatTiles(variant, width, height, forward, backward,
          flowWidth, flowHeight, forwardVariantScale, profile);
        if (profile) profile.fsPlanMs = (profile.fsPlanMs ?? 0) + performance.now() - started;
        if (!plan) {
          if (profile) profile.fsFullFrameFallback = true;
          const splatStartedAt = performance.now();
          const state = accumulateForwardSplat(variant, previous, next, width, height,
            forward, backward, flowWidth, flowHeight, variantScale, normGate, forwardVariantScale);
          if (profile) profile.fsSplatMs = (profile.fsSplatMs ?? 0) + performance.now() - splatStartedAt;
          warpMs += performance.now() - started;
          for (let y = 0; y < height; y += rows) {
            const chunkHeight = Math.min(rows, height - y);
            const renderStarted = performance.now();
            const stripe = renderForwardSplatStripe(state, previous, next, width, height, y, chunkHeight);
            const renderedMs = performance.now() - renderStarted;
            if (profile) profile.fsRenderMs = (profile.fsRenderMs ?? 0) + renderedMs;
            warpMs += renderedMs;
            await accept(y, chunkHeight, stripe);
          }
          while (pending.length) {
            const began = performance.now();
            const error = await pending.shift()!;
            waitMs += performance.now() - began;
            if (error) throw error;
          }
              } else {
          scratchBytes = plan.scratchBytes;
          const { rows: tileRows, reach } = plan;
          const capacity = Math.min(height, tileRows + STF_SPLAT_HOLE_MAX_RADIUS * 2) * width;
          // One temporary band per virtual frame, not a persistent worker-
          // global pool. Memory is released when the request is completed.
          const weights = new Float32Array(capacity);
          const accum = new Float32Array(capacity * 3);
          const compressionEnabled = variant.startsWith("ext1");
          const state: ForwardSplatState = {
            variant, weights, accum,
            usePrevious: reach.factors.usePrevious, useNext: reach.factors.useNext,
            inverseWarpScale: variantScale, forwardSplatScale: forwardVariantScale,
            accumulatorStartPixel: 0,
            searchCounts: new Array<number>(STF_SPLAT_HOLE_SEARCH_BUCKET_COUNT).fill(0),
            neighborCounts: new Array<number>(STF_SPLAT_HOLE_NEIGHBOR_BUCKET_COUNT).fill(0),
          };
          warpMs += performance.now() - started;
          for (let tileStart = 0; tileStart < height; tileStart += tileRows) {
            const tileEnd = Math.min(height, tileStart + tileRows);
            const haloStart = Math.max(0, tileStart - STF_SPLAT_HOLE_MAX_RADIUS);
            const haloEnd = Math.min(height, tileEnd + STF_SPLAT_HOLE_MAX_RADIUS);
            const bandPixels = (haloEnd - haloStart) * width;
            const accumulateStarted = performance.now();
            weights.fill(0, 0, bandPixels);
            accum.fill(0, 0, bandPixels * 3);
            if (reach.factors.usePrevious) {
              splatSourceIntoBand(previous, forward, reach.factors.previousFactor,
                variant === "mid" ? null : normGate, width, height,
                reach.lookup, reach.displacement, haloStart, haloEnd, weights, accum, compressionEnabled);
            }
            if (reach.factors.useNext) {
              splatSourceIntoBand(next, backward, reach.factors.nextFactor,
                variant === "mid" ? null : normGate, width, height,
                reach.lookup, reach.displacement, haloStart, haloEnd, weights, accum, compressionEnabled);
            }
            state.accumulatorStartPixel = haloStart * width;
            const splatMs = performance.now() - accumulateStarted;
            if (profile) profile.fsSplatMs = (profile.fsSplatMs ?? 0) + splatMs;
            warpMs += splatMs;
            for (let y = tileStart; y < tileEnd; y += rows) {
              const chunkHeight = Math.min(rows, tileEnd - y);
              const renderStarted = performance.now();
              const stripe = renderForwardSplatStripe(state, previous, next, width, height, y, chunkHeight);
              const renderedMs = performance.now() - renderStarted;
              if (profile) profile.fsRenderMs = (profile.fsRenderMs ?? 0) + renderedMs;
              warpMs += renderedMs;
              await accept(y, chunkHeight, stripe);
            }
          }
          while (pending.length) {
            const began = performance.now();
            const error = await pending.shift()!;
            waitMs += performance.now() - began;
            if (error) throw error;
          }
              }
      } else {
        for (let y = 0; y < height; y += rows) {
          const chunkHeight = Math.min(rows, height - y);
          const started = performance.now();
          const stripe = synthesizeFlowVariant(variant, previous, next, width, height,
            forward, backward, flowWidth, flowHeight, variantScale, normGate, y, chunkHeight, middleFraction);
          warpMs += performance.now() - started;
          await accept(y, chunkHeight, stripe);
        }
        while (pending.length) {
          const began = performance.now();
          const error = await pending.shift()!;
          waitMs += performance.now() - began;
          if (error) throw error;
        }
      }
      return { warpMs, waitMs, scratchBytes };
    } catch (error) {
      // A rejected stripe may leave a second message outstanding. Abort the
      // request locally; a late main-thread acknowledgement is then ignored.
      const waiting = awaitingStripe.get(requestId);
      if (waiting) {
        awaitingStripe.delete(requestId);
        for (const entry of waiting.values()) entry.reject(error instanceof Error ? error : new Error(String(error)));
      }
      throw error;
    }
  }

  async function streamMiddleFractionsSharedFlow(
    requestId: number, previous: Uint16Array, next: Uint16Array,
    width: number, height: number, forward: Float32Array, backward: Float32Array,
    flowWidth: number, flowHeight: number, fractions: readonly number[],
    profile: StfFlowGenerationProfile,
  ): Promise<{ warpMs: number; waitMs: number; scratchBytes: number }> {
    let warpMs = 0;
    let waitMs = 0;
    const rows = stripeRows(width);
    // Each group consists of all fractions at one y. Acknowledgements
    // remain per stripe; capture their outcomes immediately so an abort
    // cannot create an unhandled rejection while another group is rendered.
    const pendingGroups: Array<Promise<Error | null>> = [];
    const sharedLookupBytes = (width + height) * (2 * 4 + 8);
    const scratchBytes = (geometryScratchBytes(width, height, true, "inverse-warp") - sharedLookupBytes) *
      fractions.length + sharedLookupBytes;
    try {
      for (let y = 0; y < height; y += rows) {
        const chunkHeight = Math.min(rows, height - y);
        const started = performance.now();
        const stripes = synthesizeMiddleStripeSharedFlow(previous, next, width, height,
          forward, backward, flowWidth, flowHeight, y, chunkHeight, fractions);
        warpMs += performance.now() - started;
        const acknowledgements = stripes.map((stripe, index) =>
          sendStripe(requestId, "primary", y, chunkHeight, width, stripe, index).then(
            () => null, (reason: unknown) => reason instanceof Error ? reason : new Error(String(reason)),
          ));
        pendingGroups.push(Promise.all(acknowledgements).then(
          (results) => results.find((error) => error !== null) ?? null,
        ));
        // At most two complete groups (2 * fractions.length stripes) can
        // remain in flight. The third is never generated before group 1
        // has been fully consumed, preserving the existing memory estimate.
        if (pendingGroups.length >= MAX_INFLIGHT_MIDDLE_GROUPS) {
          const began = performance.now();
          const error = await pendingGroups.shift()!;
          waitMs += performance.now() - began;
          if (error) throw error;
        }
      }
      while (pendingGroups.length) {
        const began = performance.now();
        const error = await pendingGroups.shift()!;
        waitMs += performance.now() - began;
        if (error) throw error;
      }
      profile.middleSharedWarpMs = warpMs;
      return { warpMs, waitMs, scratchBytes };
    } catch (error) {
      const waiting = awaitingStripe.get(requestId);
      if (waiting) {
        awaitingStripe.delete(requestId);
        for (const entry of waiting.values()) entry.reject(error instanceof Error ? error : new Error(String(error)));
      }
      throw error;
    }
  }

  workerScope.onmessage = async (event: MessageEvent<OpticalFlowWorkerRequest>) => {
    const message = event.data;
    if (message.type === "stripe-ack" || message.type === "stripe-abort") {
      const pending = awaitingStripe.get(message.requestId);
      if (pending) {
        if (message.type === "stripe-abort") {
          awaitingStripe.delete(message.requestId);
          for (const entry of pending.values()) entry.reject(new Error(message.message));
        } else {
          const key = stripeKey(message.kind, message.y, message.middleIndex);
          const waiter = pending.get(key);
          if (waiter) {
            pending.delete(key);
            if (pending.size === 0) awaitingStripe.delete(message.requestId);
            waiter.resolve();
          } else {
            awaitingStripe.delete(message.requestId);
            for (const entry of pending.values()) entry.reject(new Error("STF Flow stripe acknowledgement mismatch"));
          }
        }
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
      if (message.type === "prefetch-check") {
        if (!Number.isSafeInteger(message.sessionCreatedAt) || message.sessionCreatedAt < 0) {
          throw new Error("STF Flow prefetch requires a valid session timestamp.");
        }
        const { key, width, height } = prefetchIdentity(message);
        if (prefetchedPairs.has(key) || prefetchedPairs.size >= 2) {
          throw new Error("STF Flow permits at most two distinct prefetched pairs.");
        }
        const slot = [...prefetchedPairs.values()].some((entry) => entry.slot === 0) ? 1 : 0;
        const entry: PrefetchedPair = {
          slot, status: "checking", cacheReadMs: 0, prepareFlowInputsMs: 0,
          cached: false, flows: null,
        };
        prefetchedPairs.set(key, entry);
        try {
          const started = performance.now();
          const cached = await readStfCachedFlow(message.sessionId, key, width, height);
          entry.cacheReadMs = performance.now() - started;
          if (cached) {
            entry.cached = true;
            entry.flows = { ...cached, forwardMs: 0, backwardMs: 0, wallMs: 0,
              workerCount: 0, warmupMs: 0 };
            entry.status = "ready";
          } else entry.status = "needs-gray";
          workerScope.postMessage({ type: "prefetch-status", requestId: message.requestId,
            needsGray: !cached });
        } catch (error) {
          prefetchedPairs.delete(key);
          throw error;
        }
        return;
      }
      if (message.type === "prefetch-compute") {
        const { key, width, height } = prefetchIdentity(message);
        const entry = prefetchedPairs.get(key);
        if (!entry || entry.status !== "needs-gray" ||
            !Number.isFinite(message.prepareFlowInputsMs) || message.prepareFlowInputsMs < 0) {
          throw new Error("STF Flow prefetch has no matching pending cache miss.");
        }
        const previousGray = new Uint8Array(message.previousGrayBuffer);
        const nextGray = new Uint8Array(message.nextGrayBuffer);
        if (previousGray.length !== width * height || nextGray.length !== width * height) {
          prefetchedPairs.delete(key);
          throw new Error("Invalid STF Flow prefetch Gray8 dimensions.");
        }
        try {
          entry.status = "computing";
          entry.prepareFlowInputsMs = message.prepareFlowInputsMs;
          entry.flows = await computeBidirectionalFlow(previousGray, nextGray,
            width, height, message.winsize, entry.slot);
          entry.status = "ready";
          workerScope.postMessage({ type: "prefetch-ready", requestId: message.requestId });
        } catch (error) {
          prefetchedPairs.delete(key);
          throw error;
        }
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
        const profile: StfFlowGenerationProfile = {};
        if (message.sourceGamma2Buffer) {
          const source = new Uint16Array(message.sourceGamma2Buffer);
          if (source.length !== geometry.imageWidth * geometry.imageHeight * 3) {
            throw new Error("STF opening Average Flow source image size mismatch.");
          }
          if (!openingAverage && !openingSamples.length) {
            throw new Error("STF opening Average Flow lacks a source Flow field.");
          }
          const averageStartedAt = performance.now();
          const flow = openingAverage ?? buildStfAverageFlow(openingSamples, geometry.width, geometry.height);
          if (!openingAverage) profile.averageFlowMs = performance.now() - averageStartedAt;
          openingAverageWarp = { sourceImageId: geometry.sourceImageId, source, flow,
            gate: measuredNormGate(flow, profile) };
          openingSamples.length = 0;
          openingAverage = null;
        }
        const current = openingAverageWarp;
        if (!current || current.sourceImageId !== message.sourceImageId) {
          throw new Error("STF opening Average Flow needs an initialized real source image.");
        }
        const warpMethod = message.warpMethod ?? "inverse-warp";
        const knownSourceFlowBytes = current.source.byteLength + current.flow.byteLength;
        if (message.streamStripes) {
          const { warpMs, waitMs, scratchBytes } = await streamVariant(message.requestId, "primary", message.variant,
            current.source, current.source, geometry.imageWidth, geometry.imageHeight,
            current.flow, current.flow, geometry.width, geometry.height, message.variantScale, current.gate,
            warpMethod, message.forwardVariantScale, 0.5, undefined, profile);
          workerScope.postMessage({ type: "stream-result", requestId: message.requestId,
            width: geometry.imageWidth, height: geometry.imageHeight, warpMs,
            profile,
            stripeAckWaitMs: waitMs,
            warpScratchBytes: scratchBytes,
            estimatedPeakBytes: knownSourceFlowBytes + scratchBytes });
        } else {
          const output = warpMethod !== "inverse-warp"
            ? synthesizeFlowVariantForwardSplat(message.variant, current.source, current.source,
                geometry.imageWidth, geometry.imageHeight, current.flow, current.flow,
                geometry.width, geometry.height, message.variantScale, current.gate,
                message.forwardVariantScale, profile)
            : synthesizeFlowVariant(message.variant, current.source, current.source,
                geometry.imageWidth, geometry.imageHeight, current.flow, current.flow,
                geometry.width, geometry.height, message.variantScale, current.gate);
          const gamma2Buffer = transferableBuffer(output);
          const warpScratchBytes = geometryScratchBytes(geometry.imageWidth, geometry.imageHeight,
            false, warpMethod);
          workerScope.postMessage({ type: "warp-result", requestId: message.requestId,
            width: geometry.imageWidth, height: geometry.imageHeight,
            gamma2Buffer, warpMs: performance.now() - started,
            warpScratchBytes,
            estimatedPeakBytes: knownSourceFlowBytes + warpScratchBytes,
          }, [gamma2Buffer]);
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
    const middleFractions = message.middleFractions ?? [0.5];
    if (message.middleFractions !== undefined &&
        (message.variant !== "mid" || !message.streamStripes ||
          !Array.isArray(middleFractions) || middleFractions.length < 1 || middleFractions.length > 4 ||
          middleFractions.some((fraction, index) =>
            !(typeof fraction === "number" && Number.isFinite(fraction) && fraction > 0 && fraction < 1 &&
              (index === 0 || fraction > middleFractions[index - 1]))))) {
      throw new Error("STF Flow received invalid middle interpolation fractions.");
    }

    const workerStartedAt = performance.now();
    const profile: StfFlowGenerationProfile = {};
    const winsize = message.winsize ?? STF_FARNEBACK_BASE_WINSIZE;
    if (!isStfFarnebackWinsize(winsize)) {
      throw new Error("STF Optical Flow requires a valid odd Farneback window.");
    }
    const flowSize = stfFlowWorkingSize(width, height);
    // The cache key depends on the Canonical session, adjacent image IDs,
    // alignment and Flow geometry. It does NOT depend on Gray8 pixel content.
    // Check IndexedDB first: cached Flow needs no Gray8 proxy at all.
    if (message.persistFlow && (!message.sessionId || !message.alignmentKey ||
        !Number.isSafeInteger(message.sessionCreatedAt) || message.sessionCreatedAt! < 0)) {
      throw new Error("STF persistent Flow requires a Canonical session identity");
    }
    const cacheReadStarted = performance.now();
    const flowCacheKey = message.persistFlow
      ? stfFlowSessionKey(message.sessionId!, message.previousImageId!, message.nextImageId!,
          message.alignmentKey!, flowSize.width, flowSize.height, winsize) : null;
    const prefetched = flowCacheKey ? prefetchedPairs.get(flowCacheKey) : undefined;
    if (prefetched && (prefetched.status !== "ready" || !prefetched.flows)) {
      throw new Error("STF Flow attempted to consume an incomplete prefetched pair.");
    }
    // Release the pair slot as soon as the ordered consumer acquires its
    // fields, allowing the next adjacent pair to start in parallel with Warp.
    if (prefetched && flowCacheKey) prefetchedPairs.delete(flowCacheKey);
    const cached = prefetched ? (prefetched.cached ? prefetched.flows : null) :
      (flowCacheKey ? await readStfCachedFlow(message.sessionId!, flowCacheKey, flowSize.width, flowSize.height) : null);
    const flowCacheReadMs = prefetched ? prefetched.cacheReadMs : performance.now() - cacheReadStarted;

    // Validate externally supplied proxies even on a cache hit. No image
    // conversion, resizing, or Gray8 caching happens when Flow was restored.
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
    let prepareFlowInputsMs = prefetched?.prepareFlowInputsMs ?? 0;
    let computedNextGray: Uint8Array | null = null;
    let computedFlows: ComputedFlow | null = prefetched && !prefetched.cached ? prefetched.flows : null;
    if (!cached && !computedFlows) {
      postProgress(message.requestId, "Preparing Optical Flow grayscale proxies...");
      const prepareStartedAt = performance.now();
      const grayScale = message.linearRangeMax === 4 ? 2 : 1;
      const previousGray = externalPrevious ??
        (message.previousImageId === undefined ? null : grayCache.get(message.previousImageId));
      const nextGray = externalNext ??
        (message.nextImageId === undefined ? null : grayCache.get(message.nextImageId));
      const gray0 = previousGray ?? stfGamma2RgbToGray8Resampled(previousGamma2Rgb, width, height,
        flowSize.width, flowSize.height, grayScale);
      const gray1 = nextGray ?? stfGamma2RgbToGray8Resampled(nextGamma2Rgb, width, height,
        flowSize.width, flowSize.height, grayScale);
      prepareFlowInputsMs = performance.now() - prepareStartedAt;
      postProgress(message.requestId,
        `Computing bidirectional Optical Flow (${flowSize.width}×${flowSize.height}, winsize=${winsize})...`);
      computedFlows = await computeBidirectionalFlow(gray0, gray1, flowSize.width, flowSize.height, winsize);
      if (!externalGray && message.nextImageId !== undefined) computedNextGray = gray1;
    }
    const flows = cached ? {
      ...cached, forwardMs: 0, backwardMs: 0, wallMs: 0, workerCount: 0, warmupMs: 0,
    } : computedFlows!;
    if (flows.forward.length !== flowSize.width * flowSize.height * 2 ||
        flows.backward.length !== flowSize.width * flowSize.height * 2) {
      throw new Error("Optical Flow direction worker returned an invalid vector field.");
    }
    // The next real pair can reuse this pair's second Gray8 only if this
    // request had to compute it. Hits drop the previous proxy and allocate
    // no new one; the next miss will regenerate it if needed.
    grayCache.clear();
    if (computedNextGray && message.nextImageId !== undefined) {
      grayCache.set(message.nextImageId, computedNextGray);
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
          const averageStartedAt = performance.now();
          openingAverage = buildStfAverageFlow(openingSamples, flowSize.width, flowSize.height);
          profile.averageFlowMs = performance.now() - averageStartedAt;
          openingSamples.length = 0;
        }
      }
    }
    // Prefetched Flow is now owned by this ordered Warp request, not the
    // two-slot prefetch queue. Tell the caller to refill that slot while the
    // current frame is being warped; the release itself occurred above.
    if (prefetched) workerScope.postMessage({ type: "flow-consumed", requestId: message.requestId });
    // Begin best-effort persistence while the CPU is busy warping. Await its
    // completion before returning so that terminating this Worker cannot lose
    // a pending IndexedDB transaction.
    const cacheWriteStarted = performance.now();
    const cacheDiagnostics: StfFlowCacheWriteDiagnostics = {};
    const cacheWrite = flowCacheKey && !cached
      ? writeStfCachedFlow(message.sessionId!, flowCacheKey, message.sessionCreatedAt!,
          flowSize.width, flowSize.height, flows.forward, flows.backward,
          cacheDiagnostics).then((saved) => ({
            saved, durationMs: performance.now() - cacheWriteStarted,
            status: cacheDiagnostics.status ?? (saved ? "admitted" as const : "error" as const),
          }))
      : Promise.resolve({ saved: false, durationMs: 0,
          status: cached ? "hit" as const : "disabled" as const });

    const normGates: NormGateCache = {};
    const warpMethod = message.warpMethod ?? "inverse-warp";
    postProgress(message.requestId, `Warping Optical Flow ${describeVariant(message.variant)} image...`);
    const warpStartedAt = performance.now();
    const primaryGate = gateForVariant(message.variant, flows.forward, flows.backward, normGates, profile);
    const output = message.streamStripes ? undefined : (warpMethod !== "inverse-warp"
      ? synthesizeFlowVariantForwardSplat(message.variant, previousGamma2Rgb, nextGamma2Rgb, width, height,
          flows.forward, flows.backward, flowSize.width, flowSize.height, message.variantScale, primaryGate,
          message.forwardVariantScale)
      : synthesizeFlowVariant(message.variant, previousGamma2Rgb, nextGamma2Rgb, width, height,
          flows.forward, flows.backward, flowSize.width, flowSize.height, message.variantScale, primaryGate));
    const primaryStream = message.streamStripes
      ? await (async () => {
          if (message.variant === "mid" && warpMethod === "inverse-warp" && middleFractions.length > 1) {
            return streamMiddleFractionsSharedFlow(message.requestId, previousGamma2Rgb, nextGamma2Rgb,
              width, height, flows.forward, flows.backward, flowSize.width, flowSize.height,
              middleFractions, profile);
          }
          let warpMs = 0;
          let waitMs = 0;
          let scratchBytes = 0;
          const frameWarpMs: number[] = [];
          for (let index = 0; index < middleFractions.length; index++) {
            const part = await streamVariant(message.requestId, "primary", message.variant,
              previousGamma2Rgb, nextGamma2Rgb, width, height, flows.forward, flows.backward,
              flowSize.width, flowSize.height, message.variantScale, primaryGate, warpMethod,
              message.forwardVariantScale, middleFractions[index],
              // Preserve the old single-midpoint stripe protocol.
              message.middleFractions === undefined ? undefined : index, profile);
            frameWarpMs.push(part.warpMs);
            warpMs += part.warpMs;
            waitMs += part.waitMs;
            scratchBytes = Math.max(scratchBytes, part.scratchBytes);
          }
          profile.middleFrameWarpMs = frameWarpMs;
          return { warpMs, waitMs, scratchBytes };
        })()
      : null;
    const warpMs = primaryStream?.warpMs ?? (performance.now() - warpStartedAt);
    // Both frames use the *same* native 4MP forward/backward fields. Never
    // start an extra Farneback computation just to synthesize the outer image.
    const additionalWarpStartedAt = performance.now();
    const extraGate = message.additionalVariant
      ? gateForVariant(message.additionalVariant, flows.forward, flows.backward, normGates, profile) : null;
    const additionalWarpMethod = message.additionalWarpMethod ?? warpMethod;
    const additionalGamma2Rgb = message.additionalVariant && !message.streamStripes
      ? (additionalWarpMethod !== "inverse-warp"
        ? synthesizeFlowVariantForwardSplat(message.additionalVariant, previousGamma2Rgb, nextGamma2Rgb,
            width, height, flows.forward, flows.backward, flowSize.width, flowSize.height, message.additionalVariantScale,
            extraGate, message.additionalForwardVariantScale)
        : synthesizeFlowVariant(message.additionalVariant, previousGamma2Rgb, nextGamma2Rgb,
            width, height, flows.forward, flows.backward, flowSize.width, flowSize.height, message.additionalVariantScale,
            extraGate))
      : undefined;
    const additionalStream = message.additionalVariant && message.streamStripes
      ? await streamVariant(message.requestId, "additional", message.additionalVariant,
          previousGamma2Rgb, nextGamma2Rgb, width, height, flows.forward, flows.backward,
          flowSize.width, flowSize.height, message.additionalVariantScale, extraGate, additionalWarpMethod,
          message.additionalForwardVariantScale, 0.5, undefined, profile)
      : null;
    const additionalWarpMs = message.additionalVariant
      ? additionalStream?.warpMs ?? (performance.now() - additionalWarpStartedAt)
      : undefined;
    // Capture completion when IndexedDB resolves, not after all subsequent
    // Warp stripes have been acknowledged by the main thread.
    const cacheTailStartedAt = performance.now();
    const { saved: flowCacheSaved, durationMs: flowCacheWriteMs,
      status: flowCacheSaveStatus } = await cacheWrite;
    const flowCacheTailWaitMs = performance.now() - cacheTailStartedAt;
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
      profile,
      stripeAckWaitMs: (primaryStream?.waitMs ?? 0) + (additionalStream?.waitMs ?? 0),
      ...(additionalWarpMs !== undefined ? { additionalWarpMs } : {}),
      // Exclude main-thread acknowledgement waits from Worker execution time.
      totalWorkerMs: performance.now() - workerStartedAt -
        (primaryStream?.waitMs ?? 0) - (additionalStream?.waitMs ?? 0),
      estimatedPeakBytes: estimatePeakBytes(width, height, flowSize.width, flowSize.height, flows.workerCount,
        Math.max(primaryStream?.scratchBytes ?? geometryScratchBytes(width, height, false, warpMethod),
          additionalStream?.scratchBytes ?? 0)),
      warpScratchBytes: primaryStream?.scratchBytes ?? geometryScratchBytes(width, height, false, warpMethod),
      ...(message.additionalVariant ? {
        additionalWarpScratchBytes: additionalStream?.scratchBytes ??
          geometryScratchBytes(width, height, false, additionalWarpMethod),
      } : {}),
      inputGamma2Bytes: previousGamma2Rgb.byteLength + nextGamma2Rgb.byteLength,
      flowFieldBytes: flows.forward.byteLength + flows.backward.byteLength,
      flowCacheHit: Boolean(cached), flowCacheSaved, flowCacheReadMs, flowCacheWriteMs,
      flowCacheValidationMs: cacheDiagnostics.validationMs ?? 0,
      flowCachePutMs: cacheDiagnostics.putMs ?? 0,
      flowCacheCommitMs: cacheDiagnostics.commitMs ?? 0,
      flowCacheTailWaitMs,
      flowCacheSaveStatus,
      ...(cacheDiagnostics.incomingBytes !== undefined ? {
        flowCacheIncomingBytes: cacheDiagnostics.incomingBytes,
      } : {}),
      outputBytes: width * height * 6 * (middleFractions.length + (message.additionalVariant ? 1 : 0)),
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
    middleFraction = 0.5,
  ): Uint16Array {
    if (!Number.isInteger(startY) || !Number.isInteger(stripeHeight) ||
        startY < 0 || stripeHeight <= 0 || startY + stripeHeight > height) {
      throw new Error("Invalid STF Flow stripe bounds");
    }
    const output = new Uint16Array(width * stripeHeight * 3);
    const flowLookup = getFlowSampleLookup(width, height, flowWidth, flowHeight);
    const scaleX = flowLookup.scaleX;
    const scaleY = flowLookup.scaleY;
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
    const previousFactor = openingStep ? -resolvedScale : variant === "mid" ? middleFraction : 0.5;
    const nextFactor = openingStep ? 1 + resolvedScale : variant === "mid" ? 1 - middleFraction :
      variant === "ext2" ? -resolvedScale : 0.5;
    const usePrevious = variant !== "ext2";
    const useNext = !openingStep;
    const midpointBlend = middleFraction === 0.5;
    const fromPrevious = 1 - middleFraction;

    for (let y = startY; y < startY + stripeHeight; y += 1) {
      const flowFy = flowLookup.fy[y];
      const flowRow00 = flowLookup.y0[y];
      const flowRow10 = flowLookup.y1[y];
      for (let x = 0; x < width; x += 1) {
        const flowFx = flowLookup.fx[x];
        const flowW00 = (1 - flowFx) * (1 - flowFy);
        const flowW10 = flowFx * (1 - flowFy);
        const flowW01 = (1 - flowFx) * flowFy;
        const flowW11 = flowFx * flowFy;
        const ff00 = flowRow00 + flowLookup.x0[x];
        const ff10 = flowRow00 + flowLookup.x1[x];
        const ff01 = flowRow10 + flowLookup.x0[x];
        const ff11 = flowRow10 + flowLookup.x1[x];
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
          if (midpointBlend) {
            // Preserve exact historical midpoint arithmetic (and its fast path).
            output[out] = clampUint16((previousR + nextR) * 0.5);
            output[out + 1] = clampUint16((previousG + nextG) * 0.5);
            output[out + 2] = clampUint16((previousB + nextB) * 0.5);
          } else {
            output[out] = clampUint16(previousR * fromPrevious + nextR * middleFraction);
            output[out + 1] = clampUint16(previousG * fromPrevious + nextG * middleFraction);
            output[out + 2] = clampUint16(previousB * fromPrevious + nextB * middleFraction);
          }
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

  // Render all midpoint fractions for one stripe while sampling each native
  // bidirectional Flow field only once per output pixel. Do not round Flow
  // samples to Float32 (the original sampler accumulates them in Float64).
  // RGB sampling, rounding, and per-pixel frame order match synthesizeFlowVariant.
  function synthesizeMiddleStripeSharedFlow(
    previous: Uint16Array, next: Uint16Array, width: number, height: number,
    forward: Float32Array, backward: Float32Array, flowWidth: number, flowHeight: number,
    startY: number, stripeHeight: number, fractions: readonly number[],
  ): Uint16Array[] {
    const outputs = fractions.map(() => new Uint16Array(width * stripeHeight * 3));
    const flowLookup = getFlowSampleLookup(width, height, flowWidth, flowHeight);
    const scaleX = flowLookup.scaleX;
    const scaleY = flowLookup.scaleY;
    for (let y = startY; y < startY + stripeHeight; y++) {
      const flowFy = flowLookup.fy[y];
      const flowRow00 = flowLookup.y0[y];
      const flowRow10 = flowLookup.y1[y];
      for (let x = 0; x < width; x++) {
        const flowFx = flowLookup.fx[x];
        const flowW00 = (1 - flowFx) * (1 - flowFy);
        const flowW10 = flowFx * (1 - flowFy);
        const flowW01 = (1 - flowFx) * flowFy;
        const flowW11 = flowFx * flowFy;
        const ff00 = flowRow00 + flowLookup.x0[x];
        const ff10 = flowRow00 + flowLookup.x1[x];
        const ff01 = flowRow10 + flowLookup.x0[x];
        const ff11 = flowRow10 + flowLookup.x1[x];
        const forwardX = forward[ff00] * flowW00 + forward[ff10] * flowW10 + forward[ff01] * flowW01 + forward[ff11] * flowW11;
        const forwardY = forward[ff00 + 1] * flowW00 + forward[ff10 + 1] * flowW10 + forward[ff01 + 1] * flowW01 + forward[ff11 + 1] * flowW11;
        const backwardX = backward[ff00] * flowW00 + backward[ff10] * flowW10 + backward[ff01] * flowW01 + backward[ff11] * flowW11;
        const backwardY = backward[ff00 + 1] * flowW00 + backward[ff10 + 1] * flowW10 + backward[ff01 + 1] * flowW01 + backward[ff11 + 1] * flowW11;
        const out = ((y - startY) * width + x) * 3;
        for (let index = 0; index < fractions.length; index++) {
          const middleFraction = fractions[index];
          const previousFactor = middleFraction;
          const nextFactor = 1 - middleFraction;
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
          const previousR = previous[previousI00] * previousW00 + previous[previousI10] * previousW10 + previous[previousI01] * previousW01 + previous[previousI11] * previousW11;
          const previousG = previous[previousI00 + 1] * previousW00 + previous[previousI10 + 1] * previousW10 + previous[previousI01 + 1] * previousW01 + previous[previousI11 + 1] * previousW11;
          const previousB = previous[previousI00 + 2] * previousW00 + previous[previousI10 + 2] * previousW10 + previous[previousI01 + 2] * previousW01 + previous[previousI11 + 2] * previousW11;

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
          const nextR = next[nextI00] * nextW00 + next[nextI10] * nextW10 + next[nextI01] * nextW01 + next[nextI11] * nextW11;
          const nextG = next[nextI00 + 1] * nextW00 + next[nextI10 + 1] * nextW10 + next[nextI01 + 1] * nextW01 + next[nextI11 + 1] * nextW11;
          const nextB = next[nextI00 + 2] * nextW00 + next[nextI10 + 2] * nextW10 + next[nextI01 + 2] * nextW01 + next[nextI11 + 2] * nextW11;
          const output = outputs[index];
          if (middleFraction === 0.5) {
            output[out] = clampUint16((previousR + nextR) * 0.5);
            output[out + 1] = clampUint16((previousG + nextG) * 0.5);
            output[out + 2] = clampUint16((previousB + nextB) * 0.5);
          } else {
            const fromPrevious = 1 - middleFraction;
            output[out] = clampUint16(previousR * fromPrevious + nextR * middleFraction);
            output[out + 1] = clampUint16(previousG * fromPrevious + nextG * middleFraction);
            output[out + 2] = clampUint16(previousB * fromPrevious + nextB * middleFraction);
          }
        }
      }
    }
    return outputs;
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
