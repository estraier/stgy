import { addStfGeneratedRgb16StripeToAccumulator, buildStfToneMatchLut, type StfToneMatchPlan, type StfToneMatchLut } from "./stf-tone-match";
import { StfOpticalFlowClient, type StfFlowStripe } from "./stf-optical-flow-client";
import { stfPairFarnebackWinsize } from "./stf-farneback-winsize";
import type { AlignedImageReader } from "./aligned-reader";
import type { StfOuterFrame } from "./stf-frame-generation";
import type { OpticalFlowWarpMethod } from "../workers/protocols/optical-flow-protocol";
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
      "generateStripes" | "warpOpeningAverageStripes" | "releaseRetained" | "terminate"> &
      Partial<Pick<StfOpticalFlowClient, "prefetchFlow">>;
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
  const pendingImages = new Map<number, Promise<Uint16Array>>();
  // Prefetch requests can overlap. Keep Canonical reads serialized and share
  // in-flight reads of the middle image common to consecutive pairs.
  let readTail: Promise<void> = Promise.resolve();
  const getImage = (imageIndex: number): Promise<Uint16Array> => {
    const cached = imageCache.get(imageIndex);
    if (cached) return Promise.resolve(cached);
    const pending = pendingImages.get(imageIndex);
    if (pending) return pending;
    const read = readTail.then(async () => {
      const image = await reader.readGamma2Image(imageIndex, 4);
      imageCache.set(imageIndex, image);
      return image;
    });
    readTail = read.then(() => {}, () => {});
    pendingImages.set(imageIndex, read);
    void read.finally(() => pendingImages.delete(imageIndex)).catch(() => {});
    return read;
  };

  const openingOuterFrames = frameSet.outerFrames.filter((outer) => outer.variant !== "ext2");
  const closingOuterFrame = frameSet.outerFrames.find((outer) => outer.variant === "ext2") ?? null;
  // Extrapolation always has one middle frame per real-image pair.
  const openingAveragePairCount = Math.min(frameSet.middleFrames.length, 3);
  const middleWarpMethod: OpticalFlowWarpMethod = "inverse-warp";
  const openingWarpMethod: OpticalFlowWarpMethod = "forward-splat";
  let client: (Pick<StfOpticalFlowClient,
    "generateStripes" | "warpOpeningAverageStripes" | "releaseRetained" | "terminate"> &
    Partial<Pick<StfOpticalFlowClient, "prefetchFlow">>) | null = null;
  // Group the existing middle frames by real-image pair without changing their
  // order. Only Flow runs ahead; output stripes and merging remain sequential.
  const pairs: Array<{ middleIndex: number; pairFrames: typeof frameSet.middleFrames }> = [];
  for (let middleIndex = 0; middleIndex < frameSet.middleFrames.length;) {
    const middle = frameSet.middleFrames[middleIndex];
    const pairFrames = [middle];
    while (middleIndex + pairFrames.length < frameSet.middleFrames.length) {
      const candidate = frameSet.middleFrames[middleIndex + pairFrames.length];
      if (candidate.previousIndex !== middle.previousIndex || candidate.nextIndex !== middle.nextIndex) break;
      pairFrames.push(candidate);
    }
    pairs.push({ middleIndex, pairFrames });
    middleIndex += pairFrames.length;
  }
  const deviceMemory = typeof navigator !== "undefined"
    ? (navigator as Navigator & { deviceMemory?: number }).deviceMemory : undefined;
  const supportsFourDirectionWorkers = typeof navigator !== "undefined" &&
    (navigator.hardwareConcurrency || 1) >= 4 && !(deviceMemory !== undefined && deviceMemory < 8);
  const prefetched = new Map<number, Promise<Error | null>>();
  let prefetchEnabled = false;
  const queuePrefetch = (index: number) => {
    if (!prefetchEnabled || !client?.prefetchFlow || index >= pairs.length || prefetched.has(index)) return;
    const middle = pairs[index].pairFrames[0];
    const winsize = stfPairFarnebackWinsize(
      frameSet.allFNumbers[pairs[0].pairFrames[0].previousIndex],
      frameSet.allFNumbers[pairs[0].pairFrames[0].nextIndex],
      frameSet.allFNumbers[middle.previousIndex], frameSet.allFNumbers[middle.nextIndex]);
    const flowClient = client;
    // Convert rejection to a value immediately: the second prefetch can
    // fail before its turn to be consumed, without an unhandled rejection.
    const request = (async () => {
      const previousGamma2 = await getImage(middle.previousIndex);
      const nextGamma2 = await getImage(middle.nextIndex);
      await flowClient.prefetchFlow!({
        width: reader.width, height: reader.height,
        previousImageId: middle.previousIndex, nextImageId: middle.nextIndex,
        previousGamma2, nextGamma2, winsize,
        sessionId: options.sessionId, sessionCreatedAt: options.sessionCreatedAt,
        alignmentKey: options.alignmentKey,
      });
    })().then(() => null, (cause: unknown) => cause instanceof Error ? cause : new Error(String(cause)));
    prefetched.set(index, request);
  };
  // Only the ordered consumer can release a prefetch slot. Refill it as soon
  // as the worker confirms acquisition of its Flow, not after Warp/merge.
  // Older test clients without the notification retain the prior fallback.
  const advancePrefetch = (index: number) => {
    if (prefetched.delete(index)) queuePrefetch(index + 2);
  };
  try {
    for (let pairIndex = 0; pairIndex < pairs.length; pairIndex++) {
      const { middleIndex, pairFrames } = pairs[pairIndex];
      const middle = pairFrames[0];
      if (!client) {
        client = options.createFlowClient
          ? options.createFlowClient(options.progress)
          : new StfOpticalFlowClient(options.progress);
        prefetchEnabled = pairs.length > 1 && typeof client.prefetchFlow === "function" &&
          (Boolean(options.createFlowClient) || supportsFourDirectionWorkers);
        if (prefetchEnabled) {
          queuePrefetch(0);
          queuePrefetch(1);
        }
      }
      if (prefetchEnabled) {
        const error = await prefetched.get(pairIndex);
        if (error) throw error;
      }
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
      await client.generateStripes({
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
          mergeGeneratedStripe(accumulator, stripe, closingOuterFrame.weight,
            reader.width, closingTone, toneLut(closingTone));
        } else {
          const localIndex = stripe.middleIndex ?? 0;
          const selected = pairFrames[localIndex];
          if (!selected) throw new Error("Unexpected STF middle frame index in Flow stripe");
          const selectedTone = toneForMiddle(middleIndex + localIndex);
          mergeGeneratedStripe(accumulator, stripe, selected.weight,
            reader.width, selectedTone, toneLut(selectedTone));
        }
      }, () => advancePrefetch(pairIndex));
      imageCache.delete(middle.previousIndex);
      if (prefetchEnabled) advancePrefetch(pairIndex);
    }

    if (openingOuterFrames.length > 0) {
      if (!client) throw new Error("STF opening Average Flow has no client.");
      let firstWarp = true;
      for (const outer of openingOuterFrames) {
        options.progress?.(`Generating STF Average Flow frame ${outer.pairLabel}...`);
        const source = firstWarp ? await getImage(outer.previousIndex) : undefined;
        const tone = toneForOuter(outer);
        await client.warpOpeningAverageStripes({
          width: reader.width, height: reader.height,
          sourceImageId: outer.previousIndex, variant: outer.variant,
          variantScale: outer.inverseWarpScale,
          forwardVariantScale: outer.forwardSplatScale,
          warpMethod: openingWarpMethod,
          sourceGamma2: source, transferSourceOwnership: firstWarp,
        }, (stripe) => {
          if (stripe.kind !== "primary") throw new Error("Unexpected STF Average Flow stripe kind");
          mergeGeneratedStripe(accumulator, stripe, outer.weight,
            reader.width, tone, toneLut(tone));
        });
        if (firstWarp) imageCache.delete(outer.previousIndex);
        firstWarp = false;
      }
      client.releaseRetained();
    }
  } finally {
    client?.terminate();
  }
}
