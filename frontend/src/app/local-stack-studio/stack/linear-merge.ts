import {
  EXPOSURE_ROLLOFF_A,
  ROLLOFF_SAVING_LIMIT_FACTOR,
  applyRolloffMaxChannelLinearRgbInto,
  rolloffParams,
} from "@/image/tone";

export const LINEAR_MERGE_PERCENTILE = 0.998;

export function percentileFromLinearFloatArray(values: Float32Array, q: number): number {
  if (values.length === 0) return 0;
  const copy = Array.from(values);
  copy.sort((a, b) => a - b);
  const index = Math.min(copy.length - 1, Math.max(0, Math.floor((copy.length - 1) * q)));
  return copy[index];
}

export function computeLinearMaxChannelPercentile(
  linear: Float32Array,
  q = LINEAR_MERGE_PERCENTILE,
): number {
  if (linear.length % 3 !== 0) {
    throw new Error("Linear RGB buffer length is not divisible by three.");
  }
  const pixelCount = linear.length / 3;
  const maxima = new Float32Array(pixelCount);
  for (let pixelIndex = 0, sourceIndex = 0; pixelIndex < pixelCount; pixelIndex += 1, sourceIndex += 3) {
    maxima[pixelIndex] = Math.max(
      linear[sourceIndex] ?? 0,
      linear[sourceIndex + 1] ?? 0,
      linear[sourceIndex + 2] ?? 0,
    );
  }
  return percentileFromLinearFloatArray(maxima, q);
}

export function computeExposureRolloffMaxP998AfterGain(
  linear: Float32Array,
  gain: number,
): number | null {
  if (!(Number.isFinite(gain) && gain > 1)) return null;
  if (linear.length % 3 !== 0) {
    throw new Error("Linear RGB buffer length is not divisible by three.");
  }
  const pixelCount = linear.length / 3;
  const maxima = new Float32Array(pixelCount);
  for (let pixelIndex = 0, sourceIndex = 0; pixelIndex < pixelCount; pixelIndex += 1, sourceIndex += 3) {
    const r = linear[sourceIndex] * gain;
    const g = linear[sourceIndex + 1] * gain;
    const b = linear[sourceIndex + 2] * gain;
    // Match the historical implementation exactly: Math.max is evaluated in
    // Number precision and then assigned into the Float32 maxima buffer.
    maxima[pixelIndex] = Math.max(r, g, b);
  }
  return percentileFromLinearFloatArray(maxima, LINEAR_MERGE_PERCENTILE);
}

export function applyExposureAndRolloffInPlace(
  linear: Float32Array,
  gain: number,
  exposureRolloffBaseP998: number | null = null,
  exposureRolloffMaxP998AfterGain: number | null = null,
): void {
  if (!(Number.isFinite(gain) && gain > 0) || gain === 1) return;

  if (gain <= 1) {
    for (let i = 0; i < linear.length; i += 1) linear[i] *= gain;
    return;
  }

  const hasPostGainOverride = Number.isFinite(exposureRolloffMaxP998AfterGain);
  let maxVal = hasPostGainOverride
    ? Number(exposureRolloffMaxP998AfterGain)
    : Number.isFinite(exposureRolloffBaseP998)
      ? Number(exposureRolloffBaseP998) * gain
      : null;

  if (!hasPostGainOverride && !(Number.isFinite(maxVal) && Number(maxVal) > 0)) {
    const pixelCount = linear.length / 3;
    const maxima = new Float32Array(pixelCount);
    for (let pixelIndex = 0, sourceIndex = 0; pixelIndex < pixelCount; pixelIndex += 1, sourceIndex += 3) {
      const r = linear[sourceIndex] * gain;
      const g = linear[sourceIndex + 1] * gain;
      const b = linear[sourceIndex + 2] * gain;
      linear[sourceIndex] = r;
      linear[sourceIndex + 1] = g;
      linear[sourceIndex + 2] = b;
      maxima[pixelIndex] = Math.max(r, g, b);
    }
    maxVal = percentileFromLinearFloatArray(maxima, LINEAR_MERGE_PERCENTILE);
  } else {
    for (let i = 0; i < linear.length; i += 1) linear[i] *= gain;
  }

  const rolloff = rolloffParams(Number(maxVal), EXPOSURE_ROLLOFF_A, ROLLOFF_SAVING_LIMIT_FACTOR, 1);
  if (!rolloff) return;
  const adjusted: [number, number, number] = [0, 0, 0];
  for (let i = 0; i + 2 < linear.length; i += 3) {
    applyRolloffMaxChannelLinearRgbInto(
      linear[i] ?? 0,
      linear[i + 1] ?? 0,
      linear[i + 2] ?? 0,
      rolloff,
      adjusted,
    );
    linear[i] = adjusted[0];
    linear[i + 1] = adjusted[1];
    linear[i + 2] = adjusted[2];
  }
}

export function addWeightedLinearToAccumulator(
  accumulator: Float32Array,
  linear: Float32Array,
  weight: number,
): void {
  if (accumulator.length !== linear.length) {
    throw new Error("Linear merge source and accumulator sizes do not match.");
  }
  for (let i = 0; i < accumulator.length; i += 1) {
    accumulator[i] += linear[i] * weight;
  }
}

export function mergeLinearFloatIntoAccumulator(
  source: Float32Array,
  accumulator: Float32Array,
  gain: number,
  weight: number,
  exposureRolloffBaseP998: number | null = null,
  exposureRolloffMaxP998AfterGain: number | null = null,
): void {
  if (Number.isFinite(gain) && gain > 0 && Math.abs(gain - 1) > 1e-6) {
    const adjusted = new Float32Array(source);
    applyExposureAndRolloffInPlace(
      adjusted,
      gain,
      exposureRolloffBaseP998,
      exposureRolloffMaxP998AfterGain,
    );
    addWeightedLinearToAccumulator(accumulator, adjusted, weight);
    return;
  }
  addWeightedLinearToAccumulator(accumulator, source, weight);
}
