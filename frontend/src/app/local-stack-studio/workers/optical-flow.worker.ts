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
import { buildStfFlowNormGate, stfFlowNormGateFactor, type StfFlowNormGate } from "../stack/stf-flow-norm-gate";
import type {
  OpticalFlowPerformanceStats,
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
    const coldStart = directionPoolPromise === null;
    const pool = await ensureDirectionPool();
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
      warmupMs: poolWarmupMs,
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

  // Allow at most two transferred stripes to be in flight. The main thread
  // may accumulate stripe N while the worker is rendering stripe N+1, but
  // every stripe is still individually acknowledged after consumption.
  const MAX_INFLIGHT_STRIPES = 2;
  type StripeWaiter = { resolve: () => void; reject: (error: Error) => void };
  const awaitingStripe = new Map<number, Map<string, StripeWaiter>>();
  const stripeKey = (kind: "primary" | "additional", y: number) => `${kind}:${y}`;

  function sendStripe(
    requestId: number, kind: "primary" | "additional", y: number, height: number,
    width: number, rgb: Uint16Array,
  ): Promise<void> {
    const gamma2Buffer = transferableBuffer(rgb);
    return new Promise<void>((resolve, reject) => {
      let pending = awaitingStripe.get(requestId);
      if (!pending) {
        pending = new Map();
        awaitingStripe.set(requestId, pending);
      }
      const key = stripeKey(kind, y);
      if (pending.has(key)) {
        reject(new Error("Duplicate STF Flow stripe"));
        return;
      }
      pending.set(key, { resolve, reject });
      try {
        workerScope.postMessage({ type: "stripe", requestId, kind, y, height, width, gamma2Buffer }, [gamma2Buffer]);
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
    if (method === "inverse-warp") return streaming ? stripeBytes : width * height * 6;
    // Full-frame fallback/non-streaming geometry estimate. Normal streamed
    // FS reports its actual destination-band buffer size from streamVariant.
    // Lookup tables: x/y Flow indices (2 x Int32) + fractions (Float64).
    const lookupBytes = (width + height) * (2 * 4 + 8);
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

  // Flow sampling geometry is invariant across FS variants (and both Flow
  // directions) for the same image/Flow dimensions. Keep just one small
  // worker-local lookup, replacing it whenever the geometry changes.
  type SplatFlowLookup = {
    width: number; height: number; flowWidth: number; flowHeight: number;
    scaleX: number; scaleY: number;
    x0: Int32Array; x1: Int32Array; fx: Float64Array;
    y0: Int32Array; y1: Int32Array; fy: Float64Array;
  };
  let splatFlowLookup: SplatFlowLookup | null = null;

  function getSplatFlowLookup(
    width: number, height: number, flowWidth: number, flowHeight: number,
  ): SplatFlowLookup {
    const existing = splatFlowLookup;
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
    splatFlowLookup = lookup;
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
    uncovered: number;
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
    const lookup = getSplatFlowLookup(width, height, flowWidth, flowHeight);
    // A forward splat uses the source-coordinate geometric scale, not the
    // inverse-warp scale applied to output-position sampling.
    const { previousFactor, nextFactor, usePrevious, useNext } =
      resolveVariantFactors(variant, forwardSplatScale ?? inverseWarpScale);
    const weights = new Float32Array(width * height);
    const accum = new Float32Array(width * height * 3);
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
          const w00 = (1 - fx) * (1 - fy);
          const w10 = fx * (1 - fy);
          const w01 = (1 - fx) * fy;
          const w11 = fx * fy;
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
      inverseWarpScale, forwardSplatScale, uncovered: 0,
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
        state.uncovered++;
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

  function logForwardSplatCompletion(state: ForwardSplatState, width: number, height: number): void {
    const { variant, uncovered, searchCounts, neighborCounts, inverseWarpScale, forwardSplatScale } = state;
    console.info(`[LSS STF FS] ${variant}: uncovered ${uncovered}/${width * height} ` +
      `(${(100 * uncovered / (width * height)).toFixed(2)}%); ` +
      `inverseScale=${inverseWarpScale ?? "default"}, forwardScale=${forwardSplatScale ?? "default"}` +
      `; fallbackSearch(0=source-copy,1=cardinal4,2=diagonal4,3..9=radius2..8)=[${searchCounts.join(",")}]` +
      `; fallbackNeighborsUsed(count:holes)=[${neighborCounts.map((holes, count) => holes ? `${count}:${holes}` : "").filter(Boolean).join(",")}].`);
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
    lookup: SplatFlowLookup;
  };

  function buildSplatRowReach(
    variant: OpticalFlowVariant, width: number, height: number,
    forward: Float32Array, backward: Float32Array,
    flowWidth: number, flowHeight: number, forwardScale?: number,
  ): SplatRowReach | null {
    const factors = resolveVariantFactors(variant, forwardScale);
    const lookup = getSplatFlowLookup(width, height, flowWidth, flowHeight);
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
    for (let y = 0; y < height; y++) {
      const lo = lookup.y0[y] / (flowWidth * 2);
      const hi = lookup.y1[y] / (flowWidth * 2);
      const first = factors.usePrevious ?
        Math.max(forwardMax[lo], forwardMax[hi]) * Math.abs(factors.previousFactor) : 0;
      const second = factors.useNext ?
        Math.max(backwardMax[lo], backwardMax[hi]) * Math.abs(factors.nextFactor) : 0;
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
    lookup: SplatFlowLookup, reach: Float64Array,
    bandStartY: number, bandEndY: number,
    weights: Float32Array, accum: Float32Array,
  ): void {
    for (let y = 0; y < height; y++) {
      if (y + reach[y] < bandStartY || y - reach[y] >= bandEndY) continue;
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
        const w00 = (1 - fx) * (1 - fy);
        const w10 = fx * (1 - fy);
        const w01 = (1 - fx) * fy;
        const w11 = fx * fy;
        // Destination arrays hold only [bandStartY, bandEndY). No splat may
        // escape the band; source rows that can hit it are processed in the
        // original source ordering, so every retained pixel is bit-identical.
        if (y0 >= bandStartY && y0 < bandEndY) {
          if (w00 > 0) {
            const index = (y0 - bandStartY) * width + x0;
            const base = index * 3;
            weights[index] += w00;
            accum[base] += r * w00;
            accum[base + 1] += g * w00;
            accum[base + 2] += b * w00;
          }
          if (w10 > 0) {
            const index = (y0 - bandStartY) * width + x1;
            const base = index * 3;
            weights[index] += w10;
            accum[base] += r * w10;
            accum[base + 1] += g * w10;
            accum[base + 2] += b * w10;
          }
        }
        if (y1 >= bandStartY && y1 < bandEndY) {
          if (w01 > 0) {
            const index = (y1 - bandStartY) * width + x0;
            const base = index * 3;
            weights[index] += w01;
            accum[base] += r * w01;
            accum[base + 1] += g * w01;
            accum[base + 2] += b * w01;
          }
          if (w11 > 0) {
            const index = (y1 - bandStartY) * width + x1;
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
  ): SplatTilePlan | null {
    const reach = buildSplatRowReach(variant, width, height, forward, backward,
      flowWidth, flowHeight, forwardScale);
    if (!reach) return null;
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
    if (!rows) return null;
    const bandRows = Math.min(height, rows + STF_SPLAT_HOLE_MAX_RADIUS * 2);
    const stripeBytes = Math.min(2, Math.ceil(height / transferRows)) *
      Math.min(height, transferRows) * width * 6;
    const lookupBytes = (width + height) * 16;
    const reachBytes = height * 8 + flowHeight * 16;
    return { rows, bands, sourceRowPasses, reach,
      scratchBytes: bandRows * width * 16 + stripeBytes + lookupBytes + reachBytes };
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
  ): Uint16Array {
    const state = accumulateForwardSplat(variant, previousGamma2Rgb, nextGamma2Rgb,
      width, height, flowForward, flowBackward, flowWidth, flowHeight,
      inverseWarpScale, normGate, forwardSplatScale);
    const output = renderForwardSplatStripe(state, previousGamma2Rgb, nextGamma2Rgb,
      width, height, 0, height);
    logForwardSplatCompletion(state, width, height);
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
  ): Promise<{ warpMs: number; waitMs: number; scratchBytes: number }> {
    let warpMs = 0;
    let waitMs = 0;
    let scratchBytes = geometryScratchBytes(width, height, true, warpMethod);
    // Convert each completion into a fulfilled outcome immediately so a fast
    // stripe-abort cannot create an unhandled rejection while another stripe
    // is still being rendered. Never exceed two unacknowledged stripe buffers.
    const pending: Array<Promise<Error | null>> = [];
    const accept = async (y: number, chunkHeight: number, stripe: Uint16Array): Promise<void> => {
      pending.push(sendStripe(requestId, kind, y, chunkHeight, width, stripe).then(
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
          flowWidth, flowHeight, forwardVariantScale);
        if (!plan) {
          const state = accumulateForwardSplat(variant, previous, next, width, height,
            forward, backward, flowWidth, flowHeight, variantScale, normGate, forwardVariantScale);
          warpMs += performance.now() - started;
          for (let y = 0; y < height; y += rows) {
            const chunkHeight = Math.min(rows, height - y);
            const renderStarted = performance.now();
            const stripe = renderForwardSplatStripe(state, previous, next, width, height, y, chunkHeight);
            warpMs += performance.now() - renderStarted;
            await accept(y, chunkHeight, stripe);
          }
          while (pending.length) {
            const began = performance.now();
            const error = await pending.shift()!;
            waitMs += performance.now() - began;
            if (error) throw error;
          }
          logForwardSplatCompletion(state, width, height);
          console.info(`[LSS STF FS tiled] ${variant}: fallback=full-frame ` +
            `(source-row rescans too expensive or Flow bounds invalid), ` +
            `scratch=${(scratchBytes / 1048576).toFixed(1)}MiB.`);
        } else {
          scratchBytes = plan.scratchBytes;
          const { rows: tileRows, reach } = plan;
          const capacity = Math.min(height, tileRows + STF_SPLAT_HOLE_MAX_RADIUS * 2) * width;
          // One temporary band per virtual frame, not a persistent worker-
          // global pool. Memory is released when the request is completed.
          const weights = new Float32Array(capacity);
          const accum = new Float32Array(capacity * 3);
          const state: ForwardSplatState = {
            variant, weights, accum,
            usePrevious: reach.factors.usePrevious, useNext: reach.factors.useNext,
            inverseWarpScale: variantScale, forwardSplatScale: forwardVariantScale,
            uncovered: 0, accumulatorStartPixel: 0,
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
                reach.lookup, reach.displacement, haloStart, haloEnd, weights, accum);
            }
            if (reach.factors.useNext) {
              splatSourceIntoBand(next, backward, reach.factors.nextFactor,
                variant === "mid" ? null : normGate, width, height,
                reach.lookup, reach.displacement, haloStart, haloEnd, weights, accum);
            }
            state.accumulatorStartPixel = haloStart * width;
            warpMs += performance.now() - accumulateStarted;
            for (let y = tileStart; y < tileEnd; y += rows) {
              const chunkHeight = Math.min(rows, tileEnd - y);
              const renderStarted = performance.now();
              const stripe = renderForwardSplatStripe(state, previous, next, width, height, y, chunkHeight);
              warpMs += performance.now() - renderStarted;
              await accept(y, chunkHeight, stripe);
            }
          }
          while (pending.length) {
            const began = performance.now();
            const error = await pending.shift()!;
            waitMs += performance.now() - began;
            if (error) throw error;
          }
          logForwardSplatCompletion(state, width, height);
          console.info(`[LSS STF FS tiled] ${variant}: bands=${plan.bands} ` +
            `tileRows=${plan.rows} sourceRowPasses=${plan.sourceRowPasses}/${height} ` +
            `maxDy=${reach.maxDisplacement.toFixed(1)}px ` +
            `scratch=${(scratchBytes / 1048576).toFixed(1)}MiB.`);
        }
      } else {
        for (let y = 0; y < height; y += rows) {
          const chunkHeight = Math.min(rows, height - y);
          const started = performance.now();
          const stripe = synthesizeFlowVariant(variant, previous, next, width, height,
            forward, backward, flowWidth, flowHeight, variantScale, normGate, y, chunkHeight);
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

  workerScope.onmessage = async (event: MessageEvent<OpticalFlowWorkerRequest>) => {
    const message = event.data;
    if (message.type === "stripe-ack" || message.type === "stripe-abort") {
      const pending = awaitingStripe.get(message.requestId);
      if (pending) {
        if (message.type === "stripe-abort") {
          awaitingStripe.delete(message.requestId);
          for (const entry of pending.values()) entry.reject(new Error(message.message));
        } else {
          const key = stripeKey(message.kind, message.y);
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
        const warpMethod = message.warpMethod ?? "inverse-warp";
        const knownSourceFlowBytes = current.source.byteLength + current.flow.byteLength;
        if (message.streamStripes) {
          const { warpMs, waitMs, scratchBytes } = await streamVariant(message.requestId, "primary", message.variant,
            current.source, current.source, geometry.imageWidth, geometry.imageHeight,
            current.flow, current.flow, geometry.width, geometry.height, message.variantScale, current.gate,
            warpMethod, message.forwardVariantScale);
          workerScope.postMessage({ type: "stream-result", requestId: message.requestId,
            width: geometry.imageWidth, height: geometry.imageHeight, warpMs,
            stripeAckWaitMs: waitMs,
            warpScratchBytes: scratchBytes,
            estimatedPeakBytes: knownSourceFlowBytes + scratchBytes });
        } else {
          const output = warpMethod !== "inverse-warp"
            ? synthesizeFlowVariantForwardSplat(message.variant, current.source, current.source,
                geometry.imageWidth, geometry.imageHeight, current.flow, current.flow,
                geometry.width, geometry.height, message.variantScale, current.gate,
                message.forwardVariantScale)
            : synthesizeFlowVariant(message.variant, current.source, current.source,
                geometry.imageWidth, geometry.imageHeight, current.flow, current.flow,
                geometry.width, geometry.height, message.variantScale, current.gate);
          const gamma2Buffer = transferableBuffer(output);
          workerScope.postMessage({ type: "warp-result", requestId: message.requestId,
            width: geometry.imageWidth, height: geometry.imageHeight,
            gamma2Buffer, warpMs: performance.now() - started,
            warpScratchBytes: geometryScratchBytes(geometry.imageWidth, geometry.imageHeight, false, warpMethod),
            estimatedPeakBytes: knownSourceFlowBytes +
              geometryScratchBytes(geometry.imageWidth, geometry.imageHeight, false, warpMethod),
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

    const workerStartedAt = performance.now();
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
    const cached = flowCacheKey
      ? await readStfCachedFlow(message.sessionId!, flowCacheKey, flowSize.width, flowSize.height) : null;
    const flowCacheReadMs = performance.now() - cacheReadStarted;

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
    let prepareFlowInputsMs = 0;
    let computedNextGray: Uint8Array | null = null;
    let computedFlows: Awaited<ReturnType<typeof computeBidirectionalFlow>> | null = null;
    if (!cached) {
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
          openingAverage = buildStfAverageFlow(openingSamples, flowSize.width, flowSize.height);
          openingSamples.length = 0;
        }
      }
    }
    // Begin best-effort persistence while the CPU is busy warping. Await its
    // completion before returning so that terminating this Worker cannot lose
    // a pending IndexedDB transaction.
    const cacheWriteStarted = performance.now();
    const cacheDiagnostics: StfFlowCacheWriteDiagnostics = {};
    const cacheWrite = flowCacheKey && !cached
      ? writeStfCachedFlow(message.sessionId!, flowCacheKey, message.sessionCreatedAt!,
          flowSize.width, flowSize.height, flows.forward, flows.backward,
          undefined, cacheDiagnostics).then((saved) => ({
            saved, durationMs: performance.now() - cacheWriteStarted,
            status: cacheDiagnostics.status ?? (saved ? "admitted" as const : "error" as const),
          }))
      : Promise.resolve({ saved: false, durationMs: 0,
          status: cached ? "hit" as const : "disabled" as const });

    const normGates: NormGateCache = {};
    const warpMethod = message.warpMethod ?? "inverse-warp";
    postProgress(message.requestId, `Warping Optical Flow ${describeVariant(message.variant)} image...`);
    const warpStartedAt = performance.now();
    const primaryGate = gateForVariant(message.variant, flows.forward, flows.backward, normGates);
    const output = message.streamStripes ? undefined : (warpMethod !== "inverse-warp"
      ? synthesizeFlowVariantForwardSplat(message.variant, previousGamma2Rgb, nextGamma2Rgb, width, height,
          flows.forward, flows.backward, flowSize.width, flowSize.height, message.variantScale, primaryGate,
          message.forwardVariantScale)
      : synthesizeFlowVariant(message.variant, previousGamma2Rgb, nextGamma2Rgb, width, height,
          flows.forward, flows.backward, flowSize.width, flowSize.height, message.variantScale, primaryGate));
    const primaryStream = message.streamStripes
      ? await streamVariant(message.requestId, "primary", message.variant,
          previousGamma2Rgb, nextGamma2Rgb, width, height, flows.forward, flows.backward,
          flowSize.width, flowSize.height, message.variantScale, primaryGate, warpMethod,
          message.forwardVariantScale)
      : null;
    const warpMs = primaryStream?.warpMs ?? (performance.now() - warpStartedAt);
    // Both frames use the *same* native 4MP forward/backward fields. Never
    // start an extra Farneback computation just to synthesize the outer image.
    const additionalWarpStartedAt = performance.now();
    const extraGate = message.additionalVariant
      ? gateForVariant(message.additionalVariant, flows.forward, flows.backward, normGates) : null;
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
          message.additionalForwardVariantScale)
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
      flowCacheAdmissionMs: cacheDiagnostics.admissionMs ?? 0,
      flowCacheValidationMs: cacheDiagnostics.validationMs ?? 0,
      flowCachePutMs: cacheDiagnostics.putMs ?? 0,
      flowCacheCommitMs: cacheDiagnostics.commitMs ?? 0,
      flowCacheTailWaitMs,
      flowCacheSaveStatus,
      ...(cacheDiagnostics.retainedBytes !== undefined ? {
        flowCacheRetainedBytes: cacheDiagnostics.retainedBytes,
      } : {}),
      ...(cacheDiagnostics.incomingBytes !== undefined ? {
        flowCacheIncomingBytes: cacheDiagnostics.incomingBytes,
      } : {}),
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
