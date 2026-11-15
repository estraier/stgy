import { computeCanonicalToneStatisticsFromStoredRgb16, type CanonicalImageRecord } from "./canonical-source";
import { addWeightedLinearToAccumulator } from "./linear-merge";
import { buildLinearMergeStripeJobs } from "./linear-merge-pool";
import { applyStfToneMatchInPlace, buildStfToneMatchLut, buildStfToneMatchPlanToReference } from "./stf-tone-match";
import { StfOpticalFlowClient } from "./stf-optical-flow-client";
import type { AlignedImageReader } from "./aligned-reader";
import type { StfFrameSet, StfMiddleFrame, StfOuterFrame } from "./stf-frame-generation";
import type { OpticalFlowVariant } from "../workers/protocols/optical-flow-protocol";
import { buildStfVirtualFrameKey, type StfVirtualFrameCache } from "./stf-process-cache";

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
    reader: AlignedImageReader;
    canonicalImages: readonly CanonicalImageRecord[];
    toneReferenceIndex: number;
    progress?: (message: string) => void;
    frameCache?: StfVirtualFrameCache;
    frameContextKey?: string;
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

  let cacheHits = 0;
  let cacheMisses = 0;
  let flowPairs = 0;
  let client: Pick<StfOpticalFlowClient,
    "warmup" | "generate" | "warpRetained" | "releaseRetained" | "terminate"> | null = null;
  const expectedPixels = reader.width * reader.height * 3;
  try {
    for (const middle of frameSet.middleFrames) {
      const outerFrames = outerFramesForPair(frameSet, middle);
      const variants: Array<{
        variant: OpticalFlowVariant;
        scale?: number;
        weight: number;
        label: string;
      }> = [
        { variant: "mid", weight: middle.weight, label: middle.pairLabel },
        ...outerFrames.map((frame) => ({ variant: frame.variant,
          scale: frame.openingInverseWarpScale, weight: frame.weight, label: frame.pairLabel })),
      ];
      // Snapshot hits before insertion into a bounded LRU: a new frame must
      // never evict a later hit and accidentally trigger a second Flow pass.
      const entries = variants.map((variant) => {
        const key = options.frameContextKey
          ? buildStfVirtualFrameKey(options.frameContextKey,
            middle.previousIndex, middle.nextIndex, variant.variant, variant.scale)
          : null;
        const pixels = key && options.frameCache
          ? options.frameCache.get(key, expectedPixels) : null;
        return { ...variant, key, pixels };
      });
      const missed = entries.filter((entry) => !entry.pixels).length;
      cacheHits += entries.length - missed;
      cacheMisses += missed;
      let flowReady = false;
      let additional: { index: number; pixels: Uint16Array } | null = null;
      for (let entryIndex = 0; entryIndex < entries.length; entryIndex += 1) {
        const entry = entries[entryIndex];
        let pixels = entry.pixels ?? (additional?.index === entryIndex ? additional.pixels : null);
        if (!pixels) {
          if (!client) {
            client = options.createFlowClient
              ? options.createFlowClient(options.progress)
              : new StfOpticalFlowClient(options.progress);
            await client.warmup();
          }
          options.progress?.(`Generating STF virtual frame ${entry.label}...`);
          if (!flowReady) {
            const previous = await getImage(middle.previousIndex);
            const next = await getImage(middle.nextIndex);
            // Preserve the original dual-warp request (mid + first outer)
            // when the next frame also misses. No extra Flow or roundtrip.
            const nextEntry = entries[entryIndex + 1];
            const batchNext = nextEntry && !nextEntry.pixels;
            flowPairs++;
            const generated = await client.generate(
              reader.width, reader.height,
              middle.previousIndex, middle.nextIndex,
              previous, next,
              entry.variant, entry.scale,
              batchNext ? nextEntry.variant : undefined,
              batchNext ? nextEntry.scale : undefined,
              missed > (batchNext ? 2 : 1),
            );
            pixels = generated.pixels;
            if (batchNext) {
              if (!generated.additionalPixels) throw new Error("STF Flow did not return the requested second virtual frame.");
              additional = { index: entryIndex + 1, pixels: generated.additionalPixels };
            }
            flowReady = true;
          } else {
            const warped = await client.warpRetained(
              reader.width, reader.height,
              middle.previousIndex, middle.nextIndex,
              entry.variant, entry.scale,
            );
            pixels = warped.pixels;
          }
        }
        // Preserve the original mid -> opening-1 -> opening-N summation order
        // for numerical identity between cached and uncached execution.
        await mergeGeneratedFrame(accumulator, pixels, entry.weight,
          reader.width, reader.height, reference);
        // Cache only successfully tone-processed frames. A corrupt buffer
        // that fails this merge must never poison later Process attempts.
        if (!entry.pixels && entry.key) options.frameCache?.put(entry.key, pixels);
      }
      if (flowReady && missed > 1) client?.releaseRetained();
      // Keep only the next real RGB16 for the adjacent pair; never retain the
      // entire original bracket in memory.
      imageCache.delete(middle.previousIndex);
    }
    if (options.frameCache && options.frameContextKey) {
      console.info(`[LSS STF] Virtual cache: ${cacheHits} hit, ${cacheMisses} generated, ` +
        `${flowPairs} real pair(s) required Optical Flow.`);
    }
  } finally {
    client?.terminate();
  }
}
