import { addStfGeneratedRgb16StripeToAccumulator, buildStfToneMatchLut, type StfToneMatchPlan, type StfToneMatchLut } from "./stf-tone-match";
import { StfOpticalFlowClient, type StfFlowStripe } from "./stf-optical-flow-client";
import { stfPairFarnebackWinsize } from "./stf-farneback-winsize";
import type { AlignedImageReader } from "./aligned-reader";
import type { StfOuterFrame } from "./stf-frame-generation";
import type { OpticalFlowWarpMethod, StfFlowGenerationProfile } from "../workers/protocols/optical-flow-protocol";
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
    const lutStartedAt = performance.now();
    const lut = buildStfToneMatchLut(plan.gain, plan.scaledLog);
    toneLutBuildMs += performance.now() - lutStartedAt;
    toneLutBuilds++;
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
    const readStartedAt = performance.now();
    const image = await reader.readGamma2Image(imageIndex, 4);
    inputReadMs += performance.now() - readStartedAt;
    inputReadBytes += image.byteLength;
    imageCache.set(imageIndex, image);
    return image;
  };

  const openingOuterFrames = frameSet.outerFrames.filter((outer) => outer.variant !== "ext2");
  const closingOuterFrame = frameSet.outerFrames.find((outer) => outer.variant === "ext2") ?? null;
  // Extrapolation always has one middle frame per real-image pair.
  const openingAveragePairCount = Math.min(frameSet.middleFrames.length, 3);
  const middleWarpMethod: OpticalFlowWarpMethod = "inverse-warp";
  const openingWarpMethod: OpticalFlowWarpMethod = "forward-splat";
  const reportMb = (bytes: number | undefined) => Number.isFinite(bytes)
    ? `${(bytes! / (1024 * 1024)).toFixed(1)}MiB` : "n/a";
  const startedAt = performance.now();
  let virtualWarpMs = 0;
  let virtualStripeAckWaitMs = 0;
  let virtualMergeMs = 0;
  let virtualStripes = 0;
  let inputReadMs = 0;
  let inputReadBytes = 0;
  let inputCloneMs = 0;
  let inputClonedBytes = 0;
  let inputPostMs = 0;
  let toneLutBuildMs = 0;
  let toneLutBuilds = 0;
  const profileKeys = ["gateNormsMs", "gateSortMs", "averageFlowMs", "fsPlanMs",
    "fsRowReachMs", "fsTileSearchMs", "fsSplatMs", "fsRenderMs"] as const;
  const profileTotals: Record<(typeof profileKeys)[number], number> = {
    gateNormsMs: 0, gateSortMs: 0, averageFlowMs: 0, fsPlanMs: 0,
    fsRowReachMs: 0, fsTileSearchMs: 0, fsSplatMs: 0, fsRenderMs: 0,
  };
  let gateBuilds = 0;
  const addProfile = (profile?: StfFlowGenerationProfile) => {
    if (!profile) return;
    for (const key of profileKeys) profileTotals[key] += profile[key] ?? 0;
    gateBuilds += profile.gateBuilds ?? 0;
  };
  const ms = (value: number | undefined) => value === undefined ? "n/a" : `${value.toFixed(1)}ms`;
  let peakKnownWorkerBytes = 0;
  let generatedFrames = 0;

  let flowCacheHits = 0;
  let flowCacheMisses = 0;
  let flowCacheWrites = 0;
  let cacheReadMs = 0;
  let flowComputeMs = 0;
  let flowInputPrepareMs = 0;
  let flowCacheWriteMs = 0;
  const cacheSaveOutcomes = new Map<string, number>();
  let client: Pick<StfOpticalFlowClient,
    "generateStripes" | "warpOpeningAverageStripes" | "releaseRetained" | "terminate"> | null = null;
  try {
    let pairIndex = 0;
    for (let middleIndex = 0; middleIndex < frameSet.middleFrames.length;) {
      const middle = frameSet.middleFrames[middleIndex];
      const pairFrames = [middle];
      while (middleIndex + pairFrames.length < frameSet.middleFrames.length) {
        const candidate = frameSet.middleFrames[middleIndex + pairFrames.length];
        if (candidate.previousIndex !== middle.previousIndex || candidate.nextIndex !== middle.nextIndex) break;
        pairFrames.push(candidate);
      }
      if (!client) {
        client = options.createFlowClient
          ? options.createFlowClient(options.progress)
          : new StfOpticalFlowClient(options.progress);
      }
      const readBefore = inputReadMs;
      const previous = await getImage(middle.previousIndex);
      const next = await getImage(middle.nextIndex);
      const isLastPair = middleIndex + pairFrames.length === frameSet.middleFrames.length;
      const openingAverageRadiusSpan = openingOuterFrames.length > 0 && pairIndex < openingAveragePairCount
        ? 1 / frameSet.allFNumbers[middle.previousIndex] - 1 / frameSet.allFNumbers[middle.nextIndex]
        : undefined;
      const pairWinsize = stfPairFarnebackWinsize(
        frameSet.allFNumbers[frameSet.middleFrames[0].previousIndex],
        frameSet.allFNumbers[frameSet.middleFrames[0].nextIndex],
        frameSet.allFNumbers[middle.previousIndex],
        frameSet.allFNumbers[middle.nextIndex],
      );
      options.progress?.(`Generating ${pairFrames.length} STF virtual frame(s) for pair ${middle.pairLabel}...`);
      const closingTone = isLastPair && closingOuterFrame ? toneForOuter(closingOuterFrame) : null;
      const pairStarted = performance.now();
      const mergeBefore = virtualMergeMs;
      const lutBefore = toneLutBuildMs;
      const flowPerformance = await client.generateStripes({
        width: reader.width, height: reader.height,
        previousImageId: middle.previousIndex, nextImageId: middle.nextIndex,
        previousGamma2: previous, nextGamma2: next, variant: "mid",
        ...(pairFrames.length > 1 ? { middleFractions: pairFrames.map((frame) => frame.interpolationFraction) } : {}),
        ...(closingTone && closingOuterFrame ? {
          additionalVariant: closingOuterFrame.variant,
          additionalVariantScale: closingOuterFrame.inverseWarpScale,
          additionalWarpMethod: middleWarpMethod,
        } : {}),
        warpMethod: middleWarpMethod,
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
          const localIndex = stripe.middleIndex ?? 0;
          const selected = pairFrames[localIndex];
          if (!selected) throw new Error("Unexpected STF middle frame index in Flow stripe");
          const selectedTone = toneForMiddle(middleIndex + localIndex);
          const mergeStarted = performance.now();
          mergeGeneratedStripe(accumulator, stripe, selected.weight,
            reader.width, selectedTone, toneLut(selectedTone));
          virtualMergeMs += performance.now() - mergeStarted;
          virtualStripes++;
        }
      });
      if (flowPerformance.flowCacheHit) flowCacheHits++;
      else flowCacheMisses++;
      if (flowPerformance.flowCacheSaved) flowCacheWrites++;
      cacheReadMs += flowPerformance.flowCacheReadMs ?? 0;
      flowComputeMs += flowPerformance.flowWallMs ?? 0;
      flowInputPrepareMs += flowPerformance.prepareFlowInputsMs ?? 0;
      flowCacheWriteMs += flowPerformance.flowCacheWriteMs ?? 0;
      const cacheSaveStatus = flowPerformance.flowCacheSaveStatus ??
        (flowPerformance.flowCacheHit ? "hit" : flowPerformance.flowCacheSaved ? "admitted" : "unknown");
      cacheSaveOutcomes.set(cacheSaveStatus, (cacheSaveOutcomes.get(cacheSaveStatus) ?? 0) + 1);
      virtualWarpMs += (flowPerformance.warpMs ?? 0) + (flowPerformance.additionalWarpMs ?? 0);
      addProfile(flowPerformance.profile);
      inputCloneMs += flowPerformance.inputCloneMs ?? 0;
      inputClonedBytes += flowPerformance.inputClonedBytes ?? 0;
      inputPostMs += flowPerformance.inputPostMs ?? 0;
      virtualStripeAckWaitMs += flowPerformance.stripeAckWaitMs ?? 0;
      peakKnownWorkerBytes = Math.max(peakKnownWorkerBytes, flowPerformance.estimatedPeakBytes ?? 0);
      generatedFrames += pairFrames.length + (closingTone ? 1 : 0);
      console.info(`[LSS STF timing] mode=${frameSet.mode} method=${middleWarpMethod} ` +
        `pair=${middle.pairLabel} middleFrames=${pairFrames.length}${closingTone ? "+closing" : ""} ` +
        `wall=${(performance.now() - pairStarted).toFixed(1)}ms ` +
        `worker=${(flowPerformance.totalWorkerMs ?? 0).toFixed(1)}ms ` +
        `flow=${(flowPerformance.flowWallMs ?? 0).toFixed(1)}ms ` +
        `flowPrepare=${(flowPerformance.prepareFlowInputsMs ?? 0).toFixed(1)}ms ` +
        `flowWorkers=${flowPerformance.flowWorkerCount ?? 0} ` +
        `flowForward=${(flowPerformance.forwardFlowMs ?? 0).toFixed(1)}ms ` +
        `flowBackward=${(flowPerformance.backwardFlowMs ?? 0).toFixed(1)}ms ` +
        `flowWarmup=${(flowPerformance.warmupMs ?? 0).toFixed(1)}ms ` +
        `cacheRead=${(flowPerformance.flowCacheReadMs ?? 0).toFixed(1)}ms ` +
        `cacheWrite=${(flowPerformance.flowCacheWriteMs ?? 0).toFixed(1)}ms ` +
        `cacheAdmission=${(flowPerformance.flowCacheAdmissionMs ?? 0).toFixed(1)}ms ` +
        `cacheValidation=${(flowPerformance.flowCacheValidationMs ?? 0).toFixed(1)}ms ` +
        `cachePut=${(flowPerformance.flowCachePutMs ?? 0).toFixed(1)}ms ` +
        `cacheCommit=${(flowPerformance.flowCacheCommitMs ?? 0).toFixed(1)}ms ` +
        `cacheTailWait=${(flowPerformance.flowCacheTailWaitMs ?? 0).toFixed(1)}ms ` +
        `cacheSave=${cacheSaveStatus} ` +
        `cacheRetained=${reportMb(flowPerformance.flowCacheRetainedBytes)} ` +
        `cacheIncoming=${reportMb(flowPerformance.flowCacheIncomingBytes)} ` +
        `warp=${(flowPerformance.warpMs ?? 0).toFixed(1)}ms ` +
        `closingWarp=${(flowPerformance.additionalWarpMs ?? 0).toFixed(1)}ms ` +
        `merge=${(virtualMergeMs - mergeBefore).toFixed(1)}ms ` +
        `stripeWait=${(flowPerformance.stripeAckWaitMs ?? 0).toFixed(1)}ms ` +
        `workerKnownPeak=${reportMb(flowPerformance.estimatedPeakBytes)} ` +
        `warpScratch=${reportMb(flowPerformance.warpScratchBytes)} ` +
        `cache=${flowPerformance.flowCacheHit ? "hit" : "miss"}.`);
      const detail = flowPerformance.profile;
      console.info(`[LSS STF profile] type=pair pair=${middle.pairLabel} ` +
        `middleWarpMs=[${(detail?.middleFrameWarpMs ?? []).map((value) => value.toFixed(1)).join(",")}] ` +
        `middleSharedWarp=${ms(detail?.middleSharedWarpMs)} ` +
        `middleFractions=[${pairFrames.map((frame) => frame.interpolationFraction.toFixed(5)).join(",")}] ` +
        `inputRead=${ms(inputReadMs - readBefore)} ` +
        `inputClone=${ms(flowPerformance.inputCloneMs)} ` +
        `inputCloned=${reportMb(flowPerformance.inputClonedBytes)} ` +
        `inputPostSync=${ms(flowPerformance.inputPostMs)} ` +
        `gateNorms=${ms(detail?.gateNormsMs)} gateSort=${ms(detail?.gateSortMs)} ` +
        `gateBuilds=${detail?.gateBuilds ?? 0} averageFlow=${ms(detail?.averageFlowMs)} ` +
        `fsPlan=${ms(detail?.fsPlanMs)} fsRowReach=${ms(detail?.fsRowReachMs)} ` +
        `fsTileSearch=${ms(detail?.fsTileSearchMs)} fsSplat=${ms(detail?.fsSplatMs)} ` +
        `fsRender=${ms(detail?.fsRenderMs)} ` +
        `mergeFused=${ms(virtualMergeMs - mergeBefore)} ` +
        `toneLutBuild=${ms(toneLutBuildMs - lutBefore)} ` +
        `mergePixels=${reader.width * reader.height * (pairFrames.length + (closingTone ? 1 : 0))}.`);

      imageCache.delete(middle.previousIndex);
      middleIndex += pairFrames.length;
      pairIndex++;
    }

    if (openingOuterFrames.length > 0) {
      if (!client) throw new Error("STF opening Average Flow has no client.");
      let firstWarp = true;
      for (const outer of openingOuterFrames) {
        options.progress?.(`Generating STF Average Flow frame ${outer.pairLabel}...`);
        const readBefore = inputReadMs;
        const source = firstWarp ? await getImage(outer.previousIndex) : undefined;
        const tone = toneForOuter(outer);
        const outerStarted = performance.now();
        const mergeBefore = virtualMergeMs;
        const lutBefore = toneLutBuildMs;
        const outerPerformance = await client.warpOpeningAverageStripes({
          width: reader.width, height: reader.height,
          sourceImageId: outer.previousIndex, variant: outer.variant,
          variantScale: outer.inverseWarpScale,
          forwardVariantScale: outer.forwardSplatScale,
          warpMethod: openingWarpMethod,
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
        addProfile(outerPerformance.profile);
        inputCloneMs += outerPerformance.inputCloneMs ?? 0;
        inputClonedBytes += outerPerformance.inputClonedBytes ?? 0;
        inputPostMs += outerPerformance.inputPostMs ?? 0;
        virtualStripeAckWaitMs += outerPerformance.stripeAckWaitMs ?? 0;
        peakKnownWorkerBytes = Math.max(peakKnownWorkerBytes, outerPerformance.estimatedPeakBytes ?? 0);
        generatedFrames++;
        console.info(`[LSS STF timing] mode=${frameSet.mode} method=${openingWarpMethod} ` +
          `opening=${outer.variant} wall=${(performance.now() - outerStarted).toFixed(1)}ms ` +
          `warp=${outerPerformance.warpMs.toFixed(1)}ms ` +
          `merge=${(virtualMergeMs - mergeBefore).toFixed(1)}ms ` +
          `stripeWait=${(outerPerformance.stripeAckWaitMs ?? 0).toFixed(1)}ms ` +
          `workerKnownPeak=${reportMb(outerPerformance.estimatedPeakBytes)} ` +
          `warpScratch=${reportMb(outerPerformance.warpScratchBytes)} ` +
          `inverseScale=${outer.inverseWarpScale.toFixed(5)} ` +
          `forwardScale=${outer.forwardSplatScale.toFixed(5)}.`);
        const detail = outerPerformance.profile;
        console.info(`[LSS STF profile] type=opening frame=${outer.variant} ` +
          `inputRead=${ms(inputReadMs - readBefore)} ` +
          `inputClone=${ms(outerPerformance.inputCloneMs)} ` +
          `inputCloned=${reportMb(outerPerformance.inputClonedBytes)} ` +
          `inputPostSync=${ms(outerPerformance.inputPostMs)} ` +
          `gateNorms=${ms(detail?.gateNormsMs)} gateSort=${ms(detail?.gateSortMs)} ` +
          `gateBuilds=${detail?.gateBuilds ?? 0} averageFlow=${ms(detail?.averageFlowMs)} ` +
          `fsPlan=${ms(detail?.fsPlanMs)} fsRowReach=${ms(detail?.fsRowReachMs)} ` +
          `fsTileSearch=${ms(detail?.fsTileSearchMs)} fsSplat=${ms(detail?.fsSplatMs)} ` +
          `fsRender=${ms(detail?.fsRenderMs)} ` +
          `fsFallback=${detail?.fsFullFrameFallback === true} ` +
          `mergeFused=${ms(virtualMergeMs - mergeBefore)} ` +
          `toneLutBuild=${ms(toneLutBuildMs - lutBefore)} ` +
          `mergePixels=${reader.width * reader.height}.`);
        if (firstWarp) imageCache.delete(outer.previousIndex);
        firstWarp = false;
      }
      client.releaseRetained();
    }

    console.info(`[LSS STF] Flow cache: ${flowCacheHits} hit, ${flowCacheMisses} miss, ` +
      `${flowCacheWrites} saved bidirectional real pair(s); ` +
      `cacheRead=${cacheReadMs.toFixed(1)}ms, cacheWrite=${flowCacheWriteMs.toFixed(1)}ms, ` +
      `grayPrepare=${flowInputPrepareMs.toFixed(1)}ms, bidirectionalFlowWall=${flowComputeMs.toFixed(1)}ms ` +
      `(excludes worker startup, includes direction-worker transport); ` +
      `cacheSaveOutcomes=${JSON.stringify(Object.fromEntries(cacheSaveOutcomes))}.`);
    console.info(`[LSS STF profile summary] mode=${frameSet.mode} ` +
      `inputRead=${ms(inputReadMs)} inputReadBytes=${reportMb(inputReadBytes)} ` +
      `inputClone=${ms(inputCloneMs)} inputCloned=${reportMb(inputClonedBytes)} ` +
      `inputPostSync=${ms(inputPostMs)} ` +
      `gateNorms=${ms(profileTotals.gateNormsMs)} gateSort=${ms(profileTotals.gateSortMs)} ` +
      `gateBuilds=${gateBuilds} averageFlow=${ms(profileTotals.averageFlowMs)} ` +
      `fsPlan=${ms(profileTotals.fsPlanMs)} fsRowReach=${ms(profileTotals.fsRowReachMs)} ` +
      `fsTileSearch=${ms(profileTotals.fsTileSearchMs)} ` +
      `fsSplat=${ms(profileTotals.fsSplatMs)} fsRender=${ms(profileTotals.fsRenderMs)} ` +
      `mergeFused=${ms(virtualMergeMs)} toneLutBuild=${ms(toneLutBuildMs)} ` +
      `toneLutBuilds=${toneLutBuilds} ` +
      `mergePixels=${generatedFrames * reader.width * reader.height} ` +
      `(substeps are nested in warp/merge; inputPostSync excludes asynchronous transport).`);
    console.info(`[LSS STF summary] mode=${frameSet.mode} method=hybrid(mid=${middleWarpMethod},closing=${middleWarpMethod},opening=${openingWarpMethod}) ` +
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
