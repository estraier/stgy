import { calculateStfWeights, isStfRadialAttenuation, type StfRadialAttenuation } from "./stf-radial-weights";
import type { OpticalFlowOpeningVariant } from "../workers/protocols/optical-flow-protocol";

export const STF_EXTRAPOLATION_COUNTS = [1, 2, 4, 8, 16, 32] as const;
export type StfExtrapolationCount = typeof STF_EXTRAPOLATION_COUNTS[number];
export type StfFrameGenerationMode = "off" | "interpolation" | `extrapolation-${StfExtrapolationCount}`;
const STF_EXTRAPOLATION_MODE_SET: ReadonlySet<string> = new Set(
  STF_EXTRAPOLATION_COUNTS.map((count) => `extrapolation-${count}`),
);

export function isStfFrameGenerationMode(value: string): value is StfFrameGenerationMode {
  return value === "off" || value === "interpolation" || STF_EXTRAPOLATION_MODE_SET.has(value);
}

export type StfMiddleFrame = {
  previousIndex: number;
  nextIndex: number;
  fNumber: number;
  weight: number;
  pairLabel: string;
};

export type StfOuterFrame = StfMiddleFrame & (
  | {
      variant: OpticalFlowOpeningVariant;
      // Outward radius-domain displacement, used only for geometry/diagnostics.
      openingFlowScale: number;
      // Reverse sampling scale, not the forward radius-domain displacement.
      inverseWarpScale: number;
    }
  | {
      // One half-step beyond the smallest CoC on the maximum-F side.
      variant: "ext2";
      // Reverse sampling of the max-F real frame along backward (last->prev) Flow.
      inverseWarpScale: number;
    }
);

export type StfFrameSet = {
  mode: StfFrameGenerationMode;
  realWeights: Float32Array;
  middleFrames: StfMiddleFrame[];
  outerFrames: StfOuterFrame[];
  allWeights: Float32Array;
  allFNumbers: number[];
};

function validateMode(mode: string): asserts mode is StfFrameGenerationMode {
  if (!isStfFrameGenerationMode(mode)) {
    throw new Error(`Unsupported STF Frame generation: ${mode}`);
  }
}

export function buildStfFrameSet(
  fNumbers: readonly (number | null | undefined)[],
  radialAttenuation: StfRadialAttenuation,
  mode: StfFrameGenerationMode,
): StfFrameSet {
  validateMode(mode);
  if (!isStfRadialAttenuation(radialAttenuation)) {
    throw new Error("STF Radial attenuation is unsupported.");
  }
  if (fNumbers.length === 0) throw new Error("STF requires at least one input image.");

  const realFNumbers = fNumbers.map((f) => Number(f));
  const hasOnlyValidPositiveFNumbers = realFNumbers.every((f) => Number.isFinite(f) && f > 0);
  if (mode === "off" && !hasOnlyValidPositiveFNumbers) {
    // Historical fallback: when any real image lacks a usable F-number,
    // retain every selected image and merge them uniformly.
    const weights = Float32Array.from(realFNumbers, () => 1 / realFNumbers.length);
    return {
      mode,
      realWeights: weights,
      middleFrames: [],
      outerFrames: [],
      allWeights: weights,
      allFNumbers: realFNumbers,
    };
  }

  if (mode !== "off" && (realFNumbers.length < 2 || !hasOnlyValidPositiveFNumbers)) {
    throw new Error("STF Frame generation requires at least two inputs with valid EXIF F-numbers.");
  }

  const sorted = realFNumbers
    .map((fNumber, index) => ({ fNumber, index }))
    .sort((a, b) => a.fNumber - b.fNumber);

  if (mode === "off") {
    if (realFNumbers.length === 1) {
      const weights = new Float32Array([1]);
      return {
        mode,
        realWeights: weights,
        middleFrames: [],
        outerFrames: [],
        allWeights: weights,
        allFNumbers: realFNumbers,
      };
    }
    for (let i = 1; i < sorted.length; i += 1) {
      if (!(sorted[i].fNumber > sorted[i - 1].fNumber)) {
        const weights = Float32Array.from(realFNumbers, () => 1 / realFNumbers.length);
        return {
          mode,
          realWeights: weights,
          middleFrames: [],
          outerFrames: [],
          allWeights: weights,
          allFNumbers: realFNumbers,
        };
      }
    }
  }

  const middleFrames: StfMiddleFrame[] = [];
  const outerFrames: StfOuterFrame[] = [];
  if (mode !== "off") {
    for (let i = 1; i < sorted.length; i += 1) {
      if (!(sorted[i].fNumber > sorted[i - 1].fNumber)) {
        throw new Error("STF Frame generation requires distinct EXIF F-numbers for every input.");
      }
      middleFrames.push({
        previousIndex: sorted[i - 1].index,
        nextIndex: sorted[i].index,
        fNumber: Math.sqrt(sorted[i - 1].fNumber * sorted[i].fNumber),
        weight: 0,
        pairLabel: `${i}/${sorted.length - 1}`,
      });
    }

    const openingCount = mode.startsWith("extrapolation-") ? Number.parseInt(mode.slice("extrapolation-".length), 10) : 0;
    if (openingCount > 0) {
      const first = sorted[0].fNumber;
      const second = sorted[1].fNumber;
      const openingRatio = first / second;
      const openingRadiusDelta = (1 / first) - (1 / second);
      for (let step = 1; step <= openingCount; step += 1) {
        const outerFNumber = step === 1 ? first / Math.sqrt(second / first) : first * openingRatio ** (step / 2);
        const openingFlowScale = ((1 / outerFNumber) - (1 / first)) / openingRadiusDelta;
        const openingInverseWarpScale = (1 - outerFNumber / first) / (1 - first / second);
        outerFrames.push({
          previousIndex: sorted[0].index,
          nextIndex: sorted[1].index,
          fNumber: outerFNumber,
          weight: 0,
          pairLabel: `first-ext${step}`,
          variant: (step === 1 ? "ext1" : `ext1-${step}`) as OpticalFlowOpeningVariant,
          openingFlowScale,
          inverseWarpScale: openingInverseWarpScale,
        });
      }
      // Retain the original single closing-side half-step for every extrapolation
      // mode, even when openingCount > 1. Its Flow comes from the last real pair.
      const previous = sorted[sorted.length - 2].fNumber;
      const last = sorted[sorted.length - 1].fNumber;
      const closingFNumber = last * Math.sqrt(last / previous);
      // The backward Flow (last -> previous) is an outward displacement. To
      // synthesize a smaller disc from the last real frame, inverse-sample at
      // x_source / x_target = F_closing/F_last, rather than treating a forward
      // radius multiplier as the sampling scale.
      const closingInverseWarpScale = (closingFNumber / last - 1) / (last / previous - 1);
      outerFrames.push({
        previousIndex: sorted[sorted.length - 2].index,
        nextIndex: sorted[sorted.length - 1].index,
        fNumber: closingFNumber,
        weight: 0,
        pairLabel: "last-ext2",
        variant: "ext2",
        inverseWarpScale: closingInverseWarpScale,
      });
    }

    if (outerFrames.some((frame) => !(Number.isFinite(frame.fNumber) && frame.fNumber > 0 &&
        Number.isFinite(frame.inverseWarpScale) && frame.inverseWarpScale > 0 &&
        (frame.variant === "ext2" || (Number.isFinite(frame.openingFlowScale) && frame.openingFlowScale > 0))))) {
      throw new Error("STF extrapolation produced an invalid extended EXIF F-number.");
    }
  }

  const allFNumbers = [
    ...realFNumbers,
    ...middleFrames.map((frame) => frame.fNumber),
    ...outerFrames.map((frame) => frame.fNumber),
  ];
  // Initial ideal-disc model. The runtime recalculates final weights from
  // the SAME radii and the independently propagated, tone-matched densities.
  const densityFNumbers = [
    ...realFNumbers,
    ...middleFrames.map((frame) =>
      (realFNumbers[frame.previousIndex] + realFNumbers[frame.nextIndex]) / 2),
    ...outerFrames.map((frame) => realFNumbers[
      frame.variant === "ext2" ? frame.nextIndex : frame.previousIndex]),
  ];
  const allWeights = calculateStfWeights(allFNumbers.map((radiusFNumber, image) => ({
    image,
    radiusFNumber,
    edgeDensity: densityFNumbers[image] ** 2,
  })), radialAttenuation).weights;
  const realWeights = allWeights.slice(0, realFNumbers.length);
  for (let i = 0; i < middleFrames.length; i += 1) {
    middleFrames[i].weight = allWeights[realFNumbers.length + i];
  }
  for (let i = 0; i < outerFrames.length; i += 1) {
    outerFrames[i].weight = allWeights[realFNumbers.length + middleFrames.length + i];
  }

  return { mode, realWeights, middleFrames, outerFrames, allWeights, allFNumbers };
}
