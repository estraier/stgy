/** Adds generated STF frames to the weighted source. Neither midpoint nor
 * extrapolated images participate in the real-only sharpness / Gate analysis.
 */
import { computeCanonicalToneStatisticsFromStoredRgb16, type CanonicalImageRecord } from "./canonical-source";
import { addWeightedLinearToAccumulator } from "./linear-merge";
import { applyStfToneMatchInPlace, buildStfToneMatchLut, buildStfToneMatchPlanToReference } from "./stf-tone-match";
import { buildLinearMergeStripeJobs } from "./linear-merge-pool";
import { stfMiddleFrameCacheKey, stfOuterFrameCacheKey,
  type StfFrameSet, type StfMiddleFrame, type StfOuterFrame } from "./stf-frame-generation";
import { StfGeneratedFrameCache } from "./stf-generated-cache";
import { StfOpticalFlowClient } from "./stf-optical-flow-client";
import { StfFlowInputPool, stfFlowPairConcurrency } from "./stf-flow-input-pool";
import { runStfOrderedPairs } from "./stf-ordered-pairs";
import type { OpticalFlowVariant } from "../workers/protocols/optical-flow-protocol";
import type { AlignedImageReader } from "./aligned-reader";
import type { StfPhase0Diagnostics } from "./stf-phase0-diagnostics";

/** The linear range is 0..4; the uint16 buffer stores sqrt(linear/4). */
export function decodeStfGeneratedStripe(pixels: Uint16Array, offset: number, length: number): Float32Array {
  if (offset < 0 || length < 0 || offset + length > pixels.length) throw new Error("Invalid generated STF stripe");
  const linear = new Float32Array(length);
  for (let j = 0; j < length; j++) {
    const encoded = pixels[offset + j] / 65535;
    linear[j] = 4 * encoded * encoded;
  }
  return linear;
}

type GeneratedTask = {
  frame: StfMiddleFrame | StfOuterFrame;
  variant: OpticalFlowVariant;
  key: string;
  pixels: Uint16Array | null;
  wasCached: boolean;
};

/** The exact Phase 2 midpoint cache keys survive +extrapolation mode. */
function taskForFrame(frame: StfMiddleFrame | StfOuterFrame, variant: OpticalFlowVariant,
  options: Parameters<typeof appendStfVirtualSource>[1]): GeneratedTask {
  const key = variant === "mid"
    ? stfMiddleFrameCacheKey(options.sessionId, options.normalizationMode, options.matrices,
      frame, options.reader.width, options.reader.height)
    : stfOuterFrameCacheKey(options.sessionId, options.normalizationMode, options.matrices,
      frame as StfOuterFrame, options.reader.width, options.reader.height);
  return { frame, variant, key, pixels: null, wasCached: false };
}

/** Only the first and last real neighbor pairs can have outer frames. */
export function findStfPairOuterFrames(frameSet: StfFrameSet, frame: StfMiddleFrame): StfOuterFrame[] {
  return frameSet.outerFrames.filter((outer) =>
    outer.previousIndex === frame.previousIndex && outer.nextIndex === frame.nextIndex);
}

/**
 * Phase 4 pipeline: at most two adjacent Flow pairs may generate concurrently.
 * Results are accumulated strictly in the existing pair/frame order, which
 * preserves the Float32 accumulation order and therefore the STF image.
 * Cache reads, Flow and Warp of pair N+1 overlap tone/merge/write of pair N.
 */
export async function appendStfVirtualSource(
  accumulator: Float32Array,
  options: {
    sessionId: string;
    frameSet: StfFrameSet;
    reader: AlignedImageReader;
    matrices: readonly (ArrayLike<number> | null)[];
    normalizationMode: string;
    canonicalImages: readonly CanonicalImageRecord[];
    diagnostic?: StfPhase0Diagnostics | null;
    toneReferenceIndex: number;
    progress?: (message: string) => void;
  },
): Promise<void> {
  const { frameSet, reader, diagnostic } = options;
  if (frameSet.mode === "off") return;
  if (accumulator.length !== reader.width * reader.height * 3) throw new Error("STF virtual accumulator dimensions are invalid");
  const reference = options.canonicalImages[options.toneReferenceIndex]?.toneStatistics;
  if (!reference) throw new Error("STF virtual frames require a real-image tone reference");

  const cores = typeof navigator === "object" ? navigator.hardwareConcurrency : undefined;
  const deviceMemoryGiB = typeof navigator === "object"
    ? (navigator as Navigator & { deviceMemory?: number }).deviceMemory : undefined;
  const pairConcurrency = stfFlowPairConcurrency(reader.width, reader.height, cores, deviceMemoryGiB);
  const inputPool = new StfFlowInputPool(reader, pairConcurrency + 1);
  const store = new StfGeneratedFrameCache();
  const clients: Array<StfOpticalFlowClient | null> = Array(pairConcurrency).fill(null);
  const warmups: Array<Promise<void> | null> = Array(pairConcurrency).fill(null);
  const operationStarted = performance.now();
  let midpointHits = 0;
  let midpointMisses = 0;
  let outerHits = 0;
  let outerMisses = 0;
  let sharedFlowPairs = 0;
  let flowCount = 0;
  let activeFlowPairs = 0;
  let peakActiveFlowPairs = 0;
  let nativeDirectionWorkers = 0;

  const ensureFlowClient = (lane: number): { client: StfOpticalFlowClient; warmup: Promise<void> } => {
    if (!clients[lane]) {
      const client = new StfOpticalFlowClient(options.progress);
      clients[lane] = client;
      const started = performance.now();
      warmups[lane] = client.warmup().then(({ flowWorkerCount }) => {
        nativeDirectionWorkers += flowWorkerCount;
        diagnostic?.stage(`STF Optical Flow warmup lane ${lane + 1}`, performance.now() - started,
          `${flowWorkerCount} native direction workers; overlapped with aligned input reads`);
        diagnostic?.workers("STF Optical Flow directions", nativeDirectionWorkers);
      });
      // The aligned-image read runs concurrently with warmup. Observe an
      // early warmup failure immediately; the original promise still rejects
      // at its await site so errors are never silently suppressed.
      void warmups[lane].catch(() => {});
    }
    return { client: clients[lane]!, warmup: warmups[lane]! };
  };

  /** Phase 2/3 cache keys, F-values, native Flow settings and warp equations are unchanged. */
  const preparePair = async (i: number): Promise<GeneratedTask[]> => {
    const middle = frameSet.middleFrames[i];
    const tasks: GeneratedTask[] = [taskForFrame(middle, "mid", options),
      ...findStfPairOuterFrames(frameSet, middle).map((outer) => taskForFrame(outer, outer.variant, options))];

    for (const task of tasks) {
      options.progress?.(`STF virtual ${task.frame.pairLabel}...`);
      const readStart = performance.now();
      task.pixels = await store.read(task.key, reader.width, reader.height);
      diagnostic?.stage(`STF virtual ${task.frame.pairLabel} cache read`, performance.now() - readStart);
      task.wasCached = Boolean(task.pixels);
      if (task.variant === "mid") {
        if (task.wasCached) midpointHits++; else midpointMisses++;
      } else {
        if (task.wasCached) outerHits++; else outerMisses++;
      }
    }
    if (tasks.every((task) => task.pixels !== null)) return tasks;

    const lane = i % pairConcurrency;
    const { client, warmup } = ensureFlowClient(lane);
    const inputsStarted = performance.now();
    const pair = await inputPool.acquirePair(middle.previousIndex, middle.nextIndex);
    diagnostic?.stage(`STF virtual ${middle.pairLabel} aligned reads`, performance.now() - inputsStarted,
      "Shared full-resolution aligned inputs and Gray8 proxies; includes waiting on concurrent reads");
    try {
      await warmup;
      const singleFrameBytes = reader.width * reader.height * 3 * 2;
      const pairOutputs = (deviceMemoryGiB === undefined || deviceMemoryGiB >= 8) &&
        singleFrameBytes <= 160 * 1024 * 1024;
      for (let taskIndex = 0; taskIndex < tasks.length; taskIndex++) {
        const task = tasks[taskIndex];
        if (task.pixels) continue;
        const additional = pairOutputs && taskIndex + 1 < tasks.length && !tasks[taskIndex + 1].pixels
          ? tasks[taskIndex + 1] : null;
        activeFlowPairs++;
        peakActiveFlowPairs = Math.max(peakActiveFlowPairs, activeFlowPairs);
        let result: Awaited<ReturnType<StfOpticalFlowClient["generate"]>>;
        try {
          result = await client.generate(reader.width, reader.height,
            middle.previousIndex, middle.nextIndex, pair.previous.rgb, pair.next.rgb,
            task.variant, additional?.variant,
            { previous: pair.previous.gray, next: pair.next.gray });
          flowCount++;
        } finally {
          activeFlowPairs--;
        }
        task.pixels = result.pixels;
        if (additional) {
          if (!result.additionalPixels) throw new Error("STF Flow did not return the second generated frame");
          additional.pixels = result.additionalPixels;
          sharedFlowPairs++;
          diagnostic?.stage(`STF virtual ${middle.pairLabel} shared Flow`, 0,
            `One bidirectional 4MP Flow for ${task.variant} + ${additional.variant}`);
        }
        diagnostic?.stage(`STF virtual ${middle.pairLabel} gray proxy`, result.performance.prepareFlowInputsMs,
          "Shared Gray8 proxies provided; no Worker resampling");
        diagnostic?.cache(`STF virtual ${middle.pairLabel} working buffers`, "estimated", "Flow Workers",
          result.performance.estimatedPeakBytes + (result.additionalPixels?.byteLength ?? 0),
          "Known buffers only; excludes native WASM pyramids and main-thread shared inputs");
        diagnostic?.stage(`STF virtual ${middle.pairLabel} Flow wall`, result.performance.flowWallMs,
          `forward=${result.performance.forwardFlowMs.toFixed(1)}ms backward=${result.performance.backwardFlowMs.toFixed(1)}ms 4MP`);
        diagnostic?.stage(`STF virtual ${task.frame.pairLabel} warp`, result.performance.warpMs,
          `variant=${task.variant}`);
        if (additional) diagnostic?.stage(`STF virtual ${additional.frame.pairLabel} warp`,
          result.performance.additionalWarpMs ?? 0, `variant=${additional.variant}; shared Flow`);
      }
    } finally {
      pair.release();
    }
    return tasks;
  };

  try {
    await runStfOrderedPairs(frameSet.middleFrames.length, pairConcurrency, preparePair, async (_index, tasks) => {
      // The merge order remains midpoint followed by optional endpoint for
      // each pair; never merge based on which asynchronous Worker finished first.
      for (const task of tasks) {
        const pixels = task.pixels;
        if (!pixels) throw new Error(`STF generated ${task.variant} frame was not produced`);
        const toneStart = performance.now();
        const stats = computeCanonicalToneStatisticsFromStoredRgb16(pixels, reader.width, reader.height);
        const tone = buildStfToneMatchPlanToReference(stats, reference);
        const toneLut = buildStfToneMatchLut(tone.gain, tone.scaledLog);
        diagnostic?.stage(`STF virtual ${task.frame.pairLabel} tone stats`, performance.now() - toneStart,
          `gain=${tone.gain.toFixed(5)}, log=${tone.scaledLog.toFixed(5)}`);
        const blendStart = performance.now();
        for (const stripe of buildLinearMergeStripeJobs(reader.width, reader.height)) {
          const start = stripe.y * reader.width * 3;
          const length = stripe.height * reader.width * 3;
          const linear = decodeStfGeneratedStripe(pixels, start, length);
          applyStfToneMatchInPlace(linear, tone.gain, tone.scaledLog, toneLut);
          addWeightedLinearToAccumulator(accumulator.subarray(start, start + length), linear, task.frame.weight);
        }
        diagnostic?.stage(`STF virtual ${task.frame.pairLabel} weighted merge`, performance.now() - blendStart,
          `W=${task.frame.weight.toFixed(8)}, F=${task.frame.fNumber.toFixed(5)}; ${task.variant}`);
        if (!task.wasCached) {
          const writeStart = performance.now();
          const stored = await store.write(task.key, reader.width, reader.height, pixels);
          diagnostic?.stage(`STF virtual ${task.frame.pairLabel} cache write`, performance.now() - writeStart,
            stored ? "stored, gamma20 range4" : "skipped; storage budget or unavailable");
        }
        task.pixels = null;
      }
    });
    const frameBytes = reader.width * reader.height * 3 * 2;
    diagnostic?.cache("STF generated midpoints", `${midpointHits} hit / ${midpointMisses} miss`, "IndexedDB",
      frameBytes * frameSet.middleFrames.length,
      "Phase 2 per-frame keys unchanged; independent of W, Blur and outer mode");
    if (frameSet.outerFrames.length) diagnostic?.cache("STF generated outer frames",
      `${outerHits} hit / ${outerMisses} miss`, "IndexedDB",
      frameBytes * frameSet.outerFrames.length, "ext1 and ext2 stored separately; real-only Gate unaffected");
    if (frameSet.outerFrames.length) diagnostic?.stage("STF endpoint Flow shared", 0,
      `${sharedFlowPairs} pairs generated mid + ext with one Flow`);
    const shared = inputPool.stats();
    diagnostic?.stage("STF shared aligned input reads", shared.alignedReadMs,
      `${shared.alignedReads} actual image reads, ${shared.sharedImageHits} reuse(s); cumulative, overlaps concurrent pairs`);
    diagnostic?.stage("STF shared Gray8 preparation", shared.grayPreparationMs,
      `${shared.grayPreparations} real-image proxies; exact Phase 3 pixel-center grayscale math`);
    diagnostic?.cache("STF aligned/Gray8 input pool", "bounded RAM", "RAM",
      shared.peakResidentBytes, `${pairConcurrency + 1} image slots; peak estimate, released after Process`);
    diagnostic?.stage("STF Flow pair scheduler", 0,
      `${pairConcurrency} pair lane(s), peak ${peakActiveFlowPairs} active, ${flowCount} bidirectional Flow calculations`);
    diagnostic?.stage("STF virtual frames total", performance.now() - operationStarted);
  } finally {
    // Let speculative jobs settle before terminating their Workers or closing
    // IndexedDB, even when a different pair reported an error.
    for (const client of clients) client?.terminate();
    inputPool.clear();
    store.close();
  }
}
