import { computeCanonicalToneStatisticsFromStoredRgb16, type CanonicalImageRecord } from "./canonical-source";
import { addWeightedLinearToAccumulator } from "./linear-merge";
import { buildLinearMergeStripeJobs } from "./linear-merge-pool";
import { applyStfToneMatchInPlace, buildStfToneMatchLut, buildStfToneMatchPlanToReference } from "./stf-tone-match";
import { StfOpticalFlowClient } from "./stf-optical-flow-client";
import type { AlignedImageReader } from "./aligned-reader";
import type { StfFrameSet, StfMiddleFrame, StfOuterFrame } from "./stf-frame-generation";
import type { OpticalFlowVariant } from "../workers/protocols/optical-flow-protocol";

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

  const client = new StfOpticalFlowClient(options.progress);
  try {
    await client.warmup();
    for (const middle of frameSet.middleFrames) {
      const outerFrames = outerFramesForPair(frameSet, middle);
      const previous = await getImage(middle.previousIndex);
      const next = await getImage(middle.nextIndex);
      const firstOuterVariant = outerFrames[0]?.variant as OpticalFlowVariant | undefined;
      const firstOuterScale = outerFrames[0]?.openingInverseWarpScale;
      const retainPair = outerFrames.length > 1;
      options.progress?.(`Generating STF virtual frame ${middle.pairLabel}...`);
      const generated = await client.generate(
        reader.width,
        reader.height,
        middle.previousIndex,
        middle.nextIndex,
        previous,
        next,
        "mid",
        undefined,
        firstOuterVariant,
        firstOuterScale,
        retainPair,
      );
      await mergeGeneratedFrame(accumulator, generated.pixels, middle.weight, reader.width, reader.height, reference);
      if (firstOuterVariant && generated.additionalPixels) {
        await mergeGeneratedFrame(accumulator, generated.additionalPixels, outerFrames[0].weight, reader.width, reader.height, reference);
      }
      for (let i = retainPair ? 1 : outerFrames.length; i < outerFrames.length; i += 1) {
        const outer = outerFrames[i];
        options.progress?.(`Generating STF virtual frame ${outer.pairLabel}...`);
        const warped = await client.warpRetained(
          reader.width,
          reader.height,
          middle.previousIndex,
          middle.nextIndex,
          outer.variant,
          outer.openingInverseWarpScale,
        );
        await mergeGeneratedFrame(accumulator, warped.pixels, outer.weight, reader.width, reader.height, reference);
      }
      if (retainPair) client.releaseRetained();
      // Neighboring aperture pairs reuse only the next real image. Evict the
      // completed image to avoid retaining every full-size RGB16 input in RAM.
      imageCache.delete(middle.previousIndex);
    }
  } finally {
    client.terminate();
  }
}
