import { addWeightedLinearToAccumulator } from "./linear-merge";
import { buildLinearMergeStripeJobs } from "./linear-merge-pool";
import { applyStfToneMatchInPlace, buildStfToneMatchLut, type StfToneMatchPlan, type StfToneMatchLut } from "./stf-tone-match";
import { StfOpticalFlowClient } from "./stf-optical-flow-client";
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

async function mergeGeneratedFrame(
  accumulator: Float32Array,
  pixels: Uint16Array,
  weight: number,
  width: number,
  height: number,
  tone: StfToneMatchPlan,
  toneLut: StfToneMatchLut,
): Promise<void> {
  for (const stripe of buildLinearMergeStripeJobs(width, height)) {
    const start = stripe.y * width * 3;
    const length = stripe.height * width * 3;
    const linear = decodeStfGeneratedStripe(pixels, start, length);
    applyStfToneMatchInPlace(linear, tone.gain, tone.scaledLog, toneLut);
    addWeightedLinearToAccumulator(accumulator.subarray(start, start + length), linear, weight);
  }
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
      "warmup" | "generate" | "warpOpeningAverage" | "releaseRetained" | "terminate">;
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

  let flowCacheHits = 0;
  let flowCacheMisses = 0;
  let flowCacheWrites = 0;
  let cacheReadMs = 0;
  let flowComputeMs = 0;
  let client: Pick<StfOpticalFlowClient,
    "warmup" | "generate" | "warpOpeningAverage" | "releaseRetained" | "terminate"> | null = null;
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
      const generated = await client.generate(
        reader.width, reader.height, middle.previousIndex, middle.nextIndex,
        previous, next, "mid", undefined,
        isLastPair && closingOuterFrame ? closingOuterFrame.variant : undefined,
        isLastPair && closingOuterFrame ? closingOuterFrame.inverseWarpScale : undefined,
        true,
        options.sessionId, options.sessionCreatedAt, options.alignmentKey,
        openingAverageRadiusSpan, pairWinsize,
      );
      if (generated.performance.flowCacheHit) flowCacheHits++;
      else flowCacheMisses++;
      if (generated.performance.flowCacheSaved) flowCacheWrites++;
      cacheReadMs += generated.performance.flowCacheReadMs ?? 0;
      flowComputeMs += generated.performance.flowWallMs ?? 0;

      const middleTone = toneForMiddle(middleIndex);
      await mergeGeneratedFrame(accumulator, generated.pixels, middle.weight,
        reader.width, reader.height, middleTone, toneLut(middleTone));
      if (isLastPair && closingOuterFrame) {
        if (!generated.additionalPixels) throw new Error("STF Flow did not return the requested closing outer frame.");
        const outerTone = toneForOuter(closingOuterFrame);
        await mergeGeneratedFrame(accumulator, generated.additionalPixels, closingOuterFrame.weight,
          reader.width, reader.height, outerTone, toneLut(outerTone));
      }
      imageCache.delete(middle.previousIndex);
    }

    if (openingOuterFrames.length > 0) {
      if (!client) throw new Error("STF opening Average Flow has no client.");
      let firstWarp = true;
      for (const outer of openingOuterFrames) {
        options.progress?.(`Generating STF Average Flow frame ${outer.pairLabel}...`);
        const source = firstWarp ? await getImage(outer.previousIndex) : undefined;
        const warped = await client.warpOpeningAverage(reader.width, reader.height,
          outer.previousIndex, outer.variant, outer.inverseWarpScale, source);
        const tone = toneForOuter(outer);
        await mergeGeneratedFrame(accumulator, warped.pixels, outer.weight,
          reader.width, reader.height, tone, toneLut(tone));
        if (firstWarp) imageCache.delete(outer.previousIndex);
        firstWarp = false;
      }
      client.releaseRetained();
    }

    console.info(`[LSS STF] Flow cache: ${flowCacheHits} hit, ${flowCacheMisses} miss, ` +
      `${flowCacheWrites} saved bidirectional real pair(s); ` +
      `session cache read ${cacheReadMs.toFixed(1)}ms, native Flow ${flowComputeMs.toFixed(1)}ms.`);
  } finally {
    client?.terminate();
  }
}
