import { addStfGeneratedRgb16StripeToAccumulator, buildStfToneMatchLut, type StfToneMatchPlan, type StfToneMatchLut } from "./stf-tone-match";
import { StfOpticalFlowClient, type StfFlowStripe } from "./stf-optical-flow-client";
import { stfPairFarnebackWinsize } from "./stf-farneback-winsize";
import type { AlignedImageReader } from "./aligned-reader";
import type { StfOuterFrame } from "./stf-frame-generation";
import type { StfTonePreparedFrameSet } from "./stf-frame-density";

export function decodeStfGeneratedStripe(pixels: Uint16Array, offset: number, length: number): Float32Array {
  if (offset < 0 || length < 0 || offset + length > pixels.length) throw new Error("Invalid generated STF stripe");
  const linear = new Float32Array(length);
  for (let j = 0; j < length; j += 1) {
    const encoded = pixels[offset + j] / 65535;
    linear[j] = 4 * encoded * encoded;
  }
  return linear;
}

function mergeGeneratedStripe(
  accumulator: Float32Array,
  stripe: StfFlowStripe,
  weight: number,
  width: number,
  tone: StfToneMatchPlan,
  toneLut: StfToneMatchLut,
): void {
  const start = stripe.y * width * 3;
  const length = stripe.height * width * 3;
  // One pass; no intermediate RGB Float32 buffer or accumulator subarray.
  // The client validates size, ordering, and completeness before acking.
  addStfGeneratedRgb16StripeToAccumulator(accumulator, start, stripe.pixels, length,
    weight, tone.gain, tone.scaledLog, toneLut);
}

export async function appendStfVirtualSource(
  accumulator: Float32Array,
  options: {
    frameSet: StfTonePreparedFrameSet;
    sessionId: string;
    sessionCreatedAt: number;
    alignmentKey: string;
    reader: AlignedImageReader;
    progress?: (message: string) => void;
    // Injectable for deterministic cache/Flow integration tests.
    createFlowClient?: (onProgress?: (message: string) => void) => Pick<StfOpticalFlowClient,
      "generateStripes" | "warpOpeningAverageStripes" | "releaseRetained" | "terminate">;
  },
): Promise<void> {
  const { frameSet, reader } = options;
  if (frameSet.mode === "off") return;
  if (accumulator.length !== reader.width * reader.height * 3) {
    throw new Error("STF virtual accumulator dimensions are invalid");
  }
  if (frameSet.virtualTonePlans.middle.length !== frameSet.middleFrames.length ||
      frameSet.virtualTonePlans.outer.length !== frameSet.outerFrames.length) {
    throw new Error("STF virtual frame tone plans are missing or inconsistent with the weights.");
  }
  const lutCache = new Map<string, StfToneMatchLut>();
  const toneLut = (plan: StfToneMatchPlan): StfToneMatchLut => {
    const key = `${plan.gain}:${plan.scaledLog}`;
    const cached = lutCache.get(key);
    if (cached) return cached;
    const lut = buildStfToneMatchLut(plan.gain, plan.scaledLog);
    lutCache.set(key, lut);
    return lut;
  };
  const toneForMiddle = (index: number) => frameSet.virtualTonePlans.middle[index];
  const toneForOuter = (frame: StfOuterFrame) => {
    const index = frameSet.outerFrames.indexOf(frame);
    if (index < 0) throw new Error("STF outer frame is absent from the prepared frame set.");
    return frameSet.virtualTonePlans.outer[index];
  };

  const imageCache = new Map<number, Uint16Array>();
  const getImage = async (imageIndex: number): Promise<Uint16Array> => {
    const cached = imageCache.get(imageIndex);
    if (cached) return cached;
    const image = await reader.readGamma2Image(imageIndex, 4);
    imageCache.set(imageIndex, image);
    return image;
  };

  const openingOuterFrames = frameSet.outerFrames.filter((outer) => outer.variant !== "ext2");
  const closingOuterFrame = frameSet.outerFrames.find((outer) => outer.variant === "ext2") ?? null;
  const openingAveragePairCount = Math.min(frameSet.middleFrames.length, 3);
  const reportMb = (bytes: number | undefined) => Number.isFinite(bytes)
    ? `${(bytes! / (1024 * 1024)).toFixed(1)}MiB` : "n/a";
  const startedAt = performance.now();
  let virtualWarpMs = 0;
  let virtualStripeAckWaitMs = 0;
  let virtualMergeMs = 0;
  let virtualStripes = 0;
  let peakKnownWorkerBytes = 0;
  let generatedFrames = 0;

  let flowCacheHits = 0;
  let flowCacheMisses = 0;
  let flowCacheWrites = 0;
  let cacheReadMs = 0;
  let flowComputeMs = 0;
  let client: Pick<StfOpticalFlowClient,
    "generateStripes" | "warpOpeningAverageStripes" | "releaseRetained" | "terminate"> | null = null;
  try {
    for (const [middleIndex, middle] of frameSet.middleFrames.entries()) {
      if (!client) {
        client = options.createFlowClient
          ? options.createFlowClient(options.progress)
          : new StfOpticalFlowClient(options.progress);
      }
      const previous = await getImage(middle.previousIndex);
      const next = await getImage(middle.nextIndex);
      const isLastPair = middleIndex === frameSet.middleFrames.length - 1;
      const openingAverageRadiusSpan = openingOuterFrames.length > 0 && middleIndex < openingAveragePairCount
        ? 1 / frameSet.allFNumbers[middle.previousIndex] - 1 / frameSet.allFNumbers[middle.nextIndex]
        : undefined;
      const pairWinsize = stfPairFarnebackWinsize(
        frameSet.allFNumbers[frameSet.middleFrames[0].previousIndex],
        frameSet.allFNumbers[frameSet.middleFrames[0].nextIndex],
        frameSet.allFNumbers[middle.previousIndex],
        frameSet.allFNumbers[middle.nextIndex],
      );
      options.progress?.(`Generating STF virtual frame ${middle.pairLabel}...`);
      const middleTone = toneForMiddle(middleIndex);
      const closingTone = isLastPair && closingOuterFrame ? toneForOuter(closingOuterFrame) : null;
      const pairStarted = performance.now();
      const mergeBefore = virtualMergeMs;
      const flowPerformance = await client.generateStripes({
        width: reader.width, height: reader.height,
        previousImageId: middle.previousIndex, nextImageId: middle.nextIndex,
        previousGamma2: previous, nextGamma2: next, variant: "mid",
        ...(closingTone && closingOuterFrame ? {
          additionalVariant: closingOuterFrame.variant,
          additionalVariantScale: closingOuterFrame.inverseWarpScale,
          additionalForwardVariantScale: closingOuterFrame.forwardSplatScale,
        } : {}),
        warpMethod: frameSet.virtualFrameKernel,
        sessionId: options.sessionId, sessionCreatedAt: options.sessionCreatedAt,
        alignmentKey: options.alignmentKey, openingAverageRadiusSpan,
        winsize: pairWinsize,
        inputOwnership: { previous: true, next: isLastPair },
      }, (stripe) => {
        if (stripe.kind === "additional") {
          if (!closingTone || !closingOuterFrame) throw new Error("Unexpected STF closing outer frame stripe");
          const mergeStarted = performance.now();
          mergeGeneratedStripe(accumulator, stripe, closingOuterFrame.weight,
            reader.width, closingTone, toneLut(closingTone));
          virtualMergeMs += performance.now() - mergeStarted;
          virtualStripes++;
        } else {
          const mergeStarted = performance.now();
          mergeGeneratedStripe(accumulator, stripe, middle.weight,
            reader.width, middleTone, toneLut(middleTone));
          virtualMergeMs += performance.now() - mergeStarted;
          virtualStripes++;
        }
      });
      if (flowPerformance.flowCacheHit) flowCacheHits++;
      else flowCacheMisses++;
      if (flowPerformance.flowCacheSaved) flowCacheWrites++;
      cacheReadMs += flowPerformance.flowCacheReadMs ?? 0;
      flowComputeMs += flowPerformance.flowWallMs ?? 0;
      virtualWarpMs += (flowPerformance.warpMs ?? 0) + (flowPerformance.additionalWarpMs ?? 0);
      virtualStripeAckWaitMs += flowPerformance.stripeAckWaitMs ?? 0;
      peakKnownWorkerBytes = Math.max(peakKnownWorkerBytes, flowPerformance.estimatedPeakBytes ?? 0);
      generatedFrames += closingTone ? 2 : 1;
      console.info(`[LSS STF timing] mode=${frameSet.mode} method=${frameSet.virtualFrameKernel} ` +
        `pair=${middle.pairLabel}${closingTone ? "+closing" : ""} ` +
        `wall=${(performance.now() - pairStarted).toFixed(1)}ms ` +
        `worker=${(flowPerformance.totalWorkerMs ?? 0).toFixed(1)}ms ` +
        `flow=${(flowPerformance.flowWallMs ?? 0).toFixed(1)}ms ` +
        `warp=${(flowPerformance.warpMs ?? 0).toFixed(1)}ms ` +
        `closingWarp=${(flowPerformance.additionalWarpMs ?? 0).toFixed(1)}ms ` +
        `merge=${(virtualMergeMs - mergeBefore).toFixed(1)}ms ` +
        `stripeWait=${(flowPerformance.stripeAckWaitMs ?? 0).toFixed(1)}ms ` +
        `workerKnownPeak=${reportMb(flowPerformance.estimatedPeakBytes)} ` +
        `warpScratch=${reportMb(flowPerformance.warpScratchBytes)} ` +
        `cache=${flowPerformance.flowCacheHit ? "hit" : "miss"}.`);

      imageCache.delete(middle.previousIndex);
    }

    if (openingOuterFrames.length > 0) {
      if (!client) throw new Error("STF opening Average Flow has no client.");
      let firstWarp = true;
      for (const outer of openingOuterFrames) {
        options.progress?.(`Generating STF Average Flow frame ${outer.pairLabel}...`);
        const source = firstWarp ? await getImage(outer.previousIndex) : undefined;
        const tone = toneForOuter(outer);
        const outerStarted = performance.now();
        const mergeBefore = virtualMergeMs;
        const outerPerformance = await client.warpOpeningAverageStripes({
          width: reader.width, height: reader.height,
          sourceImageId: outer.previousIndex, variant: outer.variant,
          variantScale: outer.inverseWarpScale,
          forwardVariantScale: outer.forwardSplatScale,
          warpMethod: frameSet.virtualFrameKernel,
          sourceGamma2: source, transferSourceOwnership: firstWarp,
        }, (stripe) => {
          if (stripe.kind !== "primary") throw new Error("Unexpected STF Average Flow stripe kind");
          const mergeStarted = performance.now();
          mergeGeneratedStripe(accumulator, stripe, outer.weight,
            reader.width, tone, toneLut(tone));
          virtualMergeMs += performance.now() - mergeStarted;
          virtualStripes++;
        });
        virtualWarpMs += outerPerformance.warpMs;
        virtualStripeAckWaitMs += outerPerformance.stripeAckWaitMs ?? 0;
        peakKnownWorkerBytes = Math.max(peakKnownWorkerBytes, outerPerformance.estimatedPeakBytes ?? 0);
        generatedFrames++;
        console.info(`[LSS STF timing] mode=${frameSet.mode} method=${frameSet.virtualFrameKernel} ` +
          `opening=${outer.variant} wall=${(performance.now() - outerStarted).toFixed(1)}ms ` +
          `warp=${outerPerformance.warpMs.toFixed(1)}ms ` +
          `merge=${(virtualMergeMs - mergeBefore).toFixed(1)}ms ` +
          `stripeWait=${(outerPerformance.stripeAckWaitMs ?? 0).toFixed(1)}ms ` +
          `workerKnownPeak=${reportMb(outerPerformance.estimatedPeakBytes)} ` +
          `warpScratch=${reportMb(outerPerformance.warpScratchBytes)} ` +
          `inverseScale=${outer.inverseWarpScale.toFixed(5)} ` +
          `forwardScale=${outer.forwardSplatScale.toFixed(5)}.`);
        if (firstWarp) imageCache.delete(outer.previousIndex);
        firstWarp = false;
      }
      client.releaseRetained();
    }

    console.info(`[LSS STF] Flow cache: ${flowCacheHits} hit, ${flowCacheMisses} miss, ` +
      `${flowCacheWrites} saved bidirectional real pair(s); ` +
      `session cache read ${cacheReadMs.toFixed(1)}ms, native Flow ${flowComputeMs.toFixed(1)}ms.`);
    console.info(`[LSS STF summary] mode=${frameSet.mode} method=${frameSet.virtualFrameKernel} ` +
      `generated=${generatedFrames} wall=${(performance.now() - startedAt).toFixed(1)}ms ` +
      `warp=${virtualWarpMs.toFixed(1)}ms ` +
      `merge=${virtualMergeMs.toFixed(1)}ms stripes=${virtualStripes} ` +
      `stripeWait=${virtualStripeAckWaitMs.toFixed(1)}ms ` +
      `workerKnownPeak=${reportMb(peakKnownWorkerBytes || undefined)} ` +
      `mainAccumulator=${reportMb(accumulator.byteLength)} ` +
      `(estimated known allocations only; excludes native OpenCV/WASM heap, GC and browser overhead).`);
  } finally {
    client?.terminate();
  }
}
