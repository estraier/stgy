export type StfFrameGenerationMode = "off" | "interpolation" | "extrapolation-1" | "extrapolation-2" | "extrapolation-3" | "extrapolation-4" | "extrapolation-5" | "extrapolation-6" | "extrapolation-7" | "extrapolation-8" | "extrapolation-9" | "extrapolation-10";

export type StfMiddleFrame = {
  previousIndex: number;
  nextIndex: number;
  fNumber: number;
  weight: number;
  pairLabel: string;
};

export type StfOuterFrame = StfMiddleFrame & (
  | {
      variant: "ext1" | "ext1-2" | "ext1-3" | "ext1-4" | "ext1-5" | "ext1-6" |
        "ext1-7" | "ext1-8" | "ext1-9" | "ext1-10";
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
  if (mode !== "off" && mode !== "interpolation" && !/^extrapolation-(?:[1-9]|10)$/.test(mode)) {
    throw new Error(`Unsupported STF Frame generation: ${mode}`);
  }
}

export function buildStfFrameSet(
  fNumbers: readonly (number | null | undefined)[],
  radialAttenuation: number,
  mode: StfFrameGenerationMode,
): StfFrameSet {
  validateMode(mode);
  if (!(Number.isInteger(radialAttenuation) && radialAttenuation >= -2 && radialAttenuation <= 3)) {
    throw new Error("STF Radial attenuation must be an integer from -2 to 3.");
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
          variant: (step === 1 ? "ext1" : `ext1-${step}`) as StfOuterFrame["variant"],
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
  // All real/generated images are treated as uniform defocus discs. Specify
  // the desired *final radial luminance*, then invert the disc contributions
  // to obtain blend weights. q=1 is exactly linear in radius; the other q
  // values preserve the historical logarithmic/deep-DoF/large-bokeh ordering.
  const exponent = radialAttenuation;
  const densityFNumbers = [
    ...realFNumbers,
    ...middleFrames.map((frame) =>
      (realFNumbers[frame.previousIndex] + realFNumbers[frame.nextIndex]) / 2),
    ...outerFrames.map((frame) => realFNumbers[
      frame.variant === "ext2" ? frame.nextIndex : frame.previousIndex]),
  ];

  const byIncreasingRadius = allFNumbers
    .map((fNumber, index) => ({ index, radius: 1 / fNumber }))
    .sort((a, b) => a.radius - b.radius);
  const minRadius = byIncreasingRadius[0].radius;
  const maxRadius = byIncreasingRadius[byIncreasingRadius.length - 1].radius;
  const logRadiusSpan = Math.log(maxRadius / minRadius);
  if (!(Number.isFinite(logRadiusSpan) && logRadiusSpan > 0)) {
    throw new Error("STF generated frames require distinct finite circle-of-confusion radii.");
  }

  // L_q(r) = (Rmax^q - r^q) / (Rmax^q - Rmin^q),
  // with the logarithmic limit for q=0. Use dimensionless radii
  // and expm1 to avoid subtracting nearly equal powers.
  const radialLuminance = (radius: number): number => {
    const logPosition = Math.log(radius / minRadius);
    if (Math.abs(exponent) < 1e-12) return 1 - logPosition / logRadiusSpan;
    return (Math.expm1(exponent * logRadiusSpan) - Math.expm1(exponent * logPosition)) /
      Math.expm1(exponent * logRadiusSpan);
  };

  const rawWeights = new Float64Array(allFNumbers.length);
  let rawTotal = 0;
  let currentLuminance = 1;
  for (let i = 0; i < byIncreasingRadius.length; i += 1) {
    // Minimax constant approximation on each radial annulus: its luminance
    // is the mean of the target at the two endpoints. The final annulus
    // therefore fades to zero with half of the target's last radial drop.
    const nextLuminance = i + 1 < byIncreasingRadius.length
      ? (radialLuminance(byIncreasingRadius[i].radius) +
          radialLuminance(byIncreasingRadius[i + 1].radius)) / 2
      : 0;
    const radialDrop = currentLuminance - nextLuminance;
    const index = byIncreasingRadius[i].index;
    // The source image's disc intensity is proportional to F_density².
    // A virtual outer disc is warped without losing source brightness;
    // a midpoint's source density remains the mean of its real F values.
    const sourceDensity = densityFNumbers[index] ** 2;
    const weight = radialDrop / sourceDensity;
    if (!(Number.isFinite(weight) && weight > 0)) {
      throw new Error("STF radial minimax weight is invalid.");
    }
    rawWeights[index] = weight;
    rawTotal += weight;
    currentLuminance = nextLuminance;
  }
  if (!(Number.isFinite(rawTotal) && rawTotal > 0)) {
    throw new Error("STF radial minimax weight total is invalid.");
  }
  const allWeights = Float32Array.from(rawWeights, (weight) => weight / rawTotal);
  const realWeights = allWeights.slice(0, fNumbers.length);
  for (let i = 0; i < middleFrames.length; i += 1) {
    middleFrames[i].weight = allWeights[fNumbers.length + i];
  }
  for (let i = 0; i < outerFrames.length; i += 1) {
    outerFrames[i].weight = allWeights[fNumbers.length + middleFrames.length + i];
  }

  return { mode, realWeights, middleFrames, outerFrames, allWeights, allFNumbers };
}
