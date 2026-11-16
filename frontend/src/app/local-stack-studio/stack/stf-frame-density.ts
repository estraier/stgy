import { calculateStfWeights, type StfRadialAttenuation } from "./stf-radial-weights";
import type { StfFrameSet } from "./stf-frame-generation";
import { transformStfToneIntensity, type StfToneMatchPlan } from "./stf-tone-match";

/**
 * The synthetic RGB16 pixels are blended *before* tone matching in gamma-2
 * space. A generated disc therefore inherits its real sources' densities,
 * not the density of a hypothetical exposure at its virtual aperture.
 *
 * These tone plans are also used by the virtual Source compositor. This
 * contract is essential: planning with one tone curve and rendering with a
 * different per-virtual-frame curve invalidates w_i * D_i = targetDrop_i.
 */
export type StfTonePreparedFrameSet = StfFrameSet & {
  virtualTonePlans: {
    middle: readonly StfToneMatchPlan[];
    outer: readonly StfToneMatchPlan[];
  };
  edgeDensities: readonly number[];
};

/**
 * Build ordinary object-valued tone plans from the MergePlan's numeric typed
 * arrays. Float32Array.map() must NOT be used here: its result is another
 * Float32Array, so mapping to { gain, scaledLog } would turn every object into
 * NaN and cause the midpoint tone-plan validation to fail.
 */
export function createStfSourceTonePlans(
  gains: ArrayLike<number>, scaledLogs: ArrayLike<number>,
): StfToneMatchPlan[] {
  if (gains.length !== scaledLogs.length) {
    throw new Error("STF source tone plan gain/log array lengths do not match.");
  }
  return Array.from({ length: gains.length }, (_, index) => {
    const gain = gains[index];
    const scaledLog = scaledLogs[index];
    if (!(Number.isFinite(gain) && gain > 0 && Number.isFinite(scaledLog))) {
      throw new Error(`STF source tone plan ${index + 1} requires a finite positive gain and a finite scaledLog.`);
    }
    return { gain, scaledLog };
  });
}

export function interpolateStfTonePlan(
  previous: StfToneMatchPlan, next: StfToneMatchPlan,
): StfToneMatchPlan {
  if (!(Number.isFinite(previous.gain) && previous.gain > 0 &&
      Number.isFinite(next.gain) && next.gain > 0 &&
      Number.isFinite(previous.scaledLog) && Number.isFinite(next.scaledLog))) {
    throw new Error("STF source tone plans must be finite and positive.");
  }
  // Equal interpolation weights match the Optical Flow Worker's gamma-2
  // 50:50 midpoint. Log-gain blending is symmetric for exposure ratios.
  return {
    gain: Math.sqrt(previous.gain * next.gain),
    scaledLog: (previous.scaledLog + next.scaledLog) / 2,
  };
}

/**
 * Prepare the actual compositing weights from (image, radiusFNumber, density).
 *
 * The reference P95 is a *calibration scale*, not a measured CoC rim.
 * Choosing C = P95_ref / max(F_real)^2 keeps all unmodified model densities
 * inside the canonical 0..1 tone calibration range; no artificial clipping.
 * The model assumes real D_i=C*F_i^2 before the actual real tone plan.
 * The same transform applied to constant discs is used by the compositor.
 */
export function prepareStfFrameSetForTone(
  frameSet: StfFrameSet,
  realFNumbers: readonly (number | null | undefined)[],
  realTonePlans: readonly StfToneMatchPlan[],
  referenceP95: number,
  radialAttenuation: StfRadialAttenuation,
): StfTonePreparedFrameSet {
  if (frameSet.allFNumbers.length < realFNumbers.length ||
      realTonePlans.length !== realFNumbers.length) {
    throw new Error("STF frame density inputs do not match the real-image count.");
  }
  const f = realFNumbers.map((number) => Number(number));
  const hasInvalid = f.some((number) => !(Number.isFinite(number) && number > 0));
  const hasDuplicates = new Set(f).size < f.length;
  if (frameSet.mode === "off" && (hasInvalid || hasDuplicates)) {
    // Explicit historical fallback; missing F must not be invented.
    return { ...frameSet, virtualTonePlans: { middle: [], outer: [] }, edgeDensities: [] };
  }
  if (hasInvalid || hasDuplicates ||
      !(Number.isFinite(referenceP95) && referenceP95 > 0 && referenceP95 <= 1)) {
    throw new Error("STF radius/density calibration requires distinct valid F-numbers and reference P95.");
  }
  const maxRealF = Math.max(...f);
  const densityScale = referenceP95 / (maxRealF * maxRealF);
  const rawRealDensities = f.map((fNumber) => densityScale * fNumber * fNumber);
  const edgeDensities = rawRealDensities.map((density, i) =>
    transformStfToneIntensity(density, realTonePlans[i].gain, realTonePlans[i].scaledLog));

  const midpointTonePlans = frameSet.middleFrames.map((frame) =>
    interpolateStfTonePlan(realTonePlans[frame.previousIndex], realTonePlans[frame.nextIndex]));
  for (let i = 0; i < frameSet.middleFrames.length; i += 1) {
    const frame = frameSet.middleFrames[i];
    const midGamma = (Math.sqrt(rawRealDensities[frame.previousIndex]) +
      Math.sqrt(rawRealDensities[frame.nextIndex])) / 2;
    const tone = midpointTonePlans[i];
    edgeDensities.push(transformStfToneIntensity(midGamma * midGamma, tone.gain, tone.scaledLog));
  }

  const outerTonePlans = frameSet.outerFrames.map((frame) =>
    realTonePlans[frame.variant === "ext2" ? frame.nextIndex : frame.previousIndex]);
  for (const frame of frameSet.outerFrames) {
    // Warp preserves a spatially constant disc's gamma-2 value, and its
    // source tone plan is inherited unchanged. Hence D_outer = D_source.
    edgeDensities.push(edgeDensities[frame.variant === "ext2" ? frame.nextIndex : frame.previousIndex]);
  }
  if (edgeDensities.length !== frameSet.allFNumbers.length) {
    throw new Error("STF prepared edge-density count does not match the frame set.");
  }
  const calculated = calculateStfWeights(frameSet.allFNumbers.map((radiusFNumber, image) => ({
    image, radiusFNumber, edgeDensity: edgeDensities[image],
  })), radialAttenuation);
  const allWeights = calculated.weights;
  return {
    ...frameSet,
    allWeights,
    realWeights: allWeights.slice(0, f.length),
    middleFrames: frameSet.middleFrames.map((frame, i) => ({ ...frame, weight: allWeights[f.length + i] })),
    outerFrames: frameSet.outerFrames.map((frame, i) => ({ ...frame, weight: allWeights[f.length + frameSet.middleFrames.length + i] })),
    virtualTonePlans: { middle: midpointTonePlans, outer: outerTonePlans },
    edgeDensities,
  };
}
