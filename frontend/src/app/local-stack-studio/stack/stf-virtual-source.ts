import { computeCanonicalToneStatisticsFromStoredRgb16, type CanonicalImageRecord } from "./canonical-source";
import { addWeightedLinearToAccumulator } from "./linear-merge";
import { buildLinearMergeStripeJobs } from "./linear-merge-pool";
import { applyStfToneMatchInPlace, buildStfToneMatchLut, buildStfToneMatchPlanToReference } from "./stf-tone-match";
import { StfOpticalFlowClient } from "./stf-optical-flow-client";
import type { AlignedImageReader } from "./aligned-reader";
import type { StfFrameSet, StfMiddleFrame, StfOuterFrame } from "./stf-frame-generation";

export function decodeStfGeneratedStripe(pixels: Uint16Array, offset: number, length: number): Float32Array {
  if (offset < 0 || length < 0 || offset + length > pixels.length) throw new Error("Invalid generated STF stripe");
  const linear = new Float32Array(length);
  for (let j = 0; j < length; j += 1) {
    const encoded = pixels[offset + j] / 65535;
    linear[j] = 4 * encoded * encoded;
  }
  return linear;
}

function outerFramesForPair(frameSet: StfFrameSet, frame: StfMiddleFrame): StfOuterFrame[] {
  return frameSet.outerFrames.filter((outer) => outer.previousIndex === frame.previousIndex && outer.nextIndex === frame.nextIndex);
}

async function mergeGeneratedFrame(
  accumulator: Float32Array,
  pixels: Uint16Array,
  weight: number,
  width: number,
  height: number,
  reference: NonNullable<CanonicalImageRecord["toneStatistics"]>,
): Promise<void> {
  const stats = computeCanonicalToneStatisticsFromStoredRgb16(pixels, width, height);
  const tone = buildStfToneMatchPlanToReference(stats, reference);
  const toneLut = buildStfToneMatchLut(tone.gain, tone.scaledLog);
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
    frameSet: StfFrameSet;
    sessionId: string;
    sessionCreatedAt: number;
    alignmentKey: string;
    reader: AlignedImageReader;
    canonicalImages: readonly CanonicalImageRecord[];
    toneReferenceIndex: number;
    progress?: (message: string) => void;
    // Injectable for deterministic cache/Flow integration tests.
    createFlowClient?: (onProgress?: (message: string) => void) => Pick<StfOpticalFlowClient,
      "warmup" | "generate" | "warpRetained" | "releaseRetained" | "terminate">;
  },
): Promise<void> {
  const { frameSet, reader } = options;
  if (frameSet.mode === "off") return;
  if (accumulator.length !== reader.width * reader.height * 3) {
    throw new Error("STF virtual accumulator dimensions are invalid");
  }
  const reference = options.canonicalImages[options.toneReferenceIndex]?.toneStatistics;
  if (!reference) throw new Error("STF virtual frames require a real-image tone reference");

  const imageCache = new Map<number, Uint16Array>();
  const getImage = async (imageIndex: number): Promise<Uint16Array> => {
    const cached = imageCache.get(imageIndex);
    if (cached) return cached;
    const image = await reader.readGamma2Image(imageIndex, 4);
    imageCache.set(imageIndex, image);
    return image;
  };

  let flowCacheHits = 0;
  let flowCacheMisses = 0;
  let flowCacheWrites = 0;
  let cacheReadMs = 0;
  let flowComputeMs = 0;
  let client: Pick<StfOpticalFlowClient,
    "warmup" | "generate" | "warpRetained" | "releaseRetained" | "terminate"> | null = null;
  try {
    for (const middle of frameSet.middleFrames) {
      const outerFrames = outerFramesForPair(frameSet, middle);
      if (!client) {
        client = options.createFlowClient
          ? options.createFlowClient(options.progress)
          : new StfOpticalFlowClient(options.progress);
      }
      // No unconditional warmup: an IndexedDB hit must not start native WASM
      // workers. The Flow worker initializes them lazily on a miss.
      const previous = await getImage(middle.previousIndex);
      const next = await getImage(middle.nextIndex);
      const firstOuter = outerFrames[0];
      options.progress?.(`Generating STF virtual frame ${middle.pairLabel}...`);
      // Limit the lifetime of both full-resolution result buffers: do not
      // hold the midpoint/first-outer arrays during the remaining 2..32 warps.
      {
        const generated = await client.generate(
          reader.width, reader.height, middle.previousIndex, middle.nextIndex,
          previous, next, "mid", undefined,
          firstOuter?.variant, firstOuter?.inverseWarpScale,
          outerFrames.length > 1, true,
          options.sessionId, options.sessionCreatedAt, options.alignmentKey,
        );
        if (generated.performance.flowCacheHit) flowCacheHits++;
        else flowCacheMisses++;
        if (generated.performance.flowCacheSaved) flowCacheWrites++;
        cacheReadMs += generated.performance.flowCacheReadMs ?? 0;
        flowComputeMs += generated.performance.flowWallMs ?? 0;
        // Keep the original midpoint -> opening-1 -> opening-N order; on
      // the final real pair also append its single closing-side frame.
        await mergeGeneratedFrame(accumulator, generated.pixels, middle.weight,
          reader.width, reader.height, reference);
        if (firstOuter) {
          if (!generated.additionalPixels) throw new Error("STF Flow did not return the requested outer frame.");
          await mergeGeneratedFrame(accumulator, generated.additionalPixels, firstOuter.weight,
            reader.width, reader.height, reference);
        }
      }
      try {
        for (const outer of outerFrames.slice(1)) {
          options.progress?.(`Generating STF virtual frame ${outer.pairLabel}...`);
          const warped = await client.warpRetained(
            reader.width, reader.height, middle.previousIndex, middle.nextIndex,
            outer.variant, outer.inverseWarpScale,
          );
          await mergeGeneratedFrame(accumulator, warped.pixels, outer.weight,
            reader.width, reader.height, reference);
        }
      } finally {
        if (outerFrames.length > 1) client.releaseRetained();
      }
      // Keep only the next real RGB16 for the adjacent pair. Never retain
      // generated RGB16 after its weighted contribution has been accumulated.
      imageCache.delete(middle.previousIndex);
    }
    console.info(`[LSS STF] Flow cache: ${flowCacheHits} hit, ${flowCacheMisses} miss, ` +
      `${flowCacheWrites} saved bidirectional real pair(s); ` +
      `session cache read ${cacheReadMs.toFixed(1)}ms, native Flow ${flowComputeMs.toFixed(1)}ms.`);
  } finally {
    client?.terminate();
  }
}
