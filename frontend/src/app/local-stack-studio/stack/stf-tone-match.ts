import { clamp01, toneLinearIntensity } from "@/image/tone";

export type StfToneStatistics = {
  sampleCount: number;
  mean: number;
  p50: number;
  p95: number;
};

export type StfToneMatchPlan = {
  gain: number;
  scaledLog: number;
};

export type StfToneMatchResult = {
  referenceIndex: number;
  targetMean: number;
  plans: StfToneMatchPlan[];
};

const STF_TONE_MATCH_ITERATIONS = 20;
const STF_TONE_MATCH_SEARCH_STEPS = 24;
const STF_TONE_MATCH_GAIN_MAX = 1 << 16;
const STF_TONE_MATCH_LOG_MIN = -2;
const STF_TONE_MATCH_LOG_MAX = 4;
const STF_TONE_MATCH_EXPOSURE_RELAXATION = 0.7;
const STF_TONE_MATCH_LOG_RELAXATION = 0.3;
const STF_TONE_MATCH_RELAXATION_FINAL_SCALE = 0.5;
const STF_TONE_EPSILON = 1e-12;
const STF_TONE_REFERENCE_TIE_EPSILON = 1e-12;

function validStatistics(value: StfToneStatistics): boolean {
  return (
    Number.isInteger(value.sampleCount)
    && value.sampleCount > 0
    && Number.isFinite(value.mean)
    && value.mean >= 0
    && value.mean <= 1
    && Number.isFinite(value.p50)
    && value.p50 >= 0
    && value.p50 <= 1
    && Number.isFinite(value.p95)
    && value.p95 >= value.p50
    && value.p95 > STF_TONE_EPSILON
    && value.p95 <= 1
  );
}

function median(values: readonly number[]): number {
  if (values.length === 0) return Number.NaN;
  const sorted = Array.from(values).sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
}

export function chooseStfToneReferenceIndex(statistics: readonly StfToneStatistics[]): number | null {
  if (statistics.length === 0 || statistics.some((entry) => !validStatistics(entry))) return null;
  const targetMean = median(statistics.map((entry) => entry.mean));
  if (!Number.isFinite(targetMean)) return null;
  let bestIndex = 0;
  let bestDistance = Infinity;
  for (let index = 0; index < statistics.length; index += 1) {
    const distance = Math.abs(statistics[index].mean - targetMean);
    const isClearlyCloser = distance < bestDistance - STF_TONE_REFERENCE_TIE_EPSILON;
    const isNumericalTie = Math.abs(distance - bestDistance) <= STF_TONE_REFERENCE_TIE_EPSILON;
    const isDarkerTieBreak = isNumericalTie && statistics[index].mean < statistics[bestIndex].mean;
    if (isClearlyCloser || isDarkerTieBreak) {
      bestDistance = distance;
      bestIndex = index;
    }
  }
  return bestIndex;
}

function applyScaledLogUnit(value: number, factor: number): number {
  const x = clamp01(value);
  if (factor > 1e-8) return clamp01(Math.log1p(x * factor) / Math.log1p(factor));
  if (factor < -1e-8) {
    const magnitude = -factor;
    return clamp01(Math.expm1(x * Math.log1p(magnitude)) / magnitude);
  }
  return x;
}

function scaledLogSlopeAtWhite(factor: number): number {
  if (factor > 1e-8) {
    const denominator = (1 + factor) * Math.log1p(factor);
    return denominator > 0 ? factor / denominator : 1;
  }
  if (factor < -1e-8) {
    const magnitude = -factor;
    return Math.log1p(magnitude) * (1 + magnitude) / magnitude;
  }
  return 1;
}

export function transformStfToneIntensity(value: number, gain: number, scaledLog: number): number {
  if (!(Number.isFinite(value) && value >= 0 && Number.isFinite(gain) && gain > 0 && Number.isFinite(scaledLog))) {
    return value;
  }
  const exposed = value * gain;
  if (exposed <= 1) return applyScaledLogUnit(exposed, scaledLog);
  return 1 + scaledLogSlopeAtWhite(scaledLog) * (exposed - 1);
}

function solveGain(sourceP95: number, scaledLog: number, targetP95: number): number {
  const target = clamp01(targetP95);
  if (!(target > 0) || !(sourceP95 > 0)) return 0;
  let upper = 1;
  let upperValue = transformStfToneIntensity(sourceP95, upper, scaledLog);
  while (upperValue < target && upper < STF_TONE_MATCH_GAIN_MAX) {
    upper = Math.min(STF_TONE_MATCH_GAIN_MAX, upper * 2);
    upperValue = transformStfToneIntensity(sourceP95, upper, scaledLog);
  }
  if (upperValue < target) return upper;

  let lower = 0;
  for (let i = 0; i < STF_TONE_MATCH_SEARCH_STEPS; i += 1) {
    const mid = (lower + upper) / 2;
    const value = transformStfToneIntensity(sourceP95, mid, scaledLog);
    if (value < target) lower = mid;
    else upper = mid;
  }
  return upper;
}

function solveScaledLog(sourceP50: number, gain: number, targetP50: number): number {
  const target = clamp01(targetP50);
  const lowerValue = transformStfToneIntensity(sourceP50, gain, STF_TONE_MATCH_LOG_MIN);
  if (target <= lowerValue) return STF_TONE_MATCH_LOG_MIN;
  const upperValue = transformStfToneIntensity(sourceP50, gain, STF_TONE_MATCH_LOG_MAX);
  if (target >= upperValue) return STF_TONE_MATCH_LOG_MAX;

  let lower = STF_TONE_MATCH_LOG_MIN;
  let upper = STF_TONE_MATCH_LOG_MAX;
  for (let i = 0; i < STF_TONE_MATCH_SEARCH_STEPS; i += 1) {
    const mid = (lower + upper) / 2;
    const value = transformStfToneIntensity(sourceP50, gain, mid);
    if (value < target) lower = mid;
    else upper = mid;
  }
  return (lower + upper) / 2;
}

function solvePlan(source: StfToneStatistics, target: StfToneStatistics): StfToneMatchPlan {
  let gain = 1;
  let scaledLog = 0;
  for (let i = 0; i < STF_TONE_MATCH_ITERATIONS; i += 1) {
    const progress = i / Math.max(1, STF_TONE_MATCH_ITERATIONS - 1);
    const relaxationScale = Math.pow(STF_TONE_MATCH_RELAXATION_FINAL_SCALE, progress);

    const targetGain = solveGain(source.p95, scaledLog, target.p95);
    if (targetGain > 0 && gain > 0) {
      gain *= Math.pow(
        targetGain / gain,
        STF_TONE_MATCH_EXPOSURE_RELAXATION * relaxationScale,
      );
    }

    const targetLog = solveScaledLog(source.p50, gain, target.p50);
    scaledLog += STF_TONE_MATCH_LOG_RELAXATION * relaxationScale * (targetLog - scaledLog);
  }
  return {
    gain: Number.isFinite(gain) && gain > 0 ? gain : 1,
    scaledLog: Number.isFinite(scaledLog) ? scaledLog : 0,
  };
}

export function buildStfToneMatchPlans(
  statistics: readonly StfToneStatistics[],
): StfToneMatchResult | null {
  const referenceIndex = chooseStfToneReferenceIndex(statistics);
  if (referenceIndex == null) return null;
  const target = statistics[referenceIndex];
  const targetMean = median(statistics.map((entry) => entry.mean));
  const plans = statistics.map((entry, index) => (
    index === referenceIndex ? { gain: 1, scaledLog: 0 } : solvePlan(entry, target)
  ));
  return { referenceIndex, targetMean, plans };
}


export type StfToneMatchLut = {
  values: Float32Array;
  sampleScale: number;
  gammaRangeMax: number;
};

const STF_TONE_MATCH_LUT_SIZE = 4097;
const STF_TONE_MATCH_LUT_LINEAR_RANGE_MAX = 4;

export function buildStfToneMatchLut(gain: number, scaledLog: number): StfToneMatchLut {
  // Sample uniformly in gamma-2 coordinates over the canonical 0..4 linear domain.
  // 4097 points keep linear T=1 exactly on a LUT sample (index 2048).
  const gammaRangeMax = STF_TONE_MATCH_LUT_LINEAR_RANGE_MAX;
  const sampleScale = (STF_TONE_MATCH_LUT_SIZE - 1) / gammaRangeMax;
  const values = new Float32Array(STF_TONE_MATCH_LUT_SIZE);
  for (let i = 0; i < values.length; i += 1) {
    const gammaValue = i / sampleScale;
    const sourceIntensity = gammaValue * gammaValue / STF_TONE_MATCH_LUT_LINEAR_RANGE_MAX;
    values[i] = Math.fround(transformStfToneIntensity(sourceIntensity, gain, scaledLog));
  }
  return { values, sampleScale, gammaRangeMax };
}

function sampleStfToneMatchLut(lut: StfToneMatchLut, sourceIntensity: number): number | null {
  if (!(sourceIntensity >= 0) || sourceIntensity > STF_TONE_MATCH_LUT_LINEAR_RANGE_MAX) return null;
  const gammaValue = Math.sqrt(sourceIntensity * STF_TONE_MATCH_LUT_LINEAR_RANGE_MAX);
  if (!Number.isFinite(gammaValue) || gammaValue > lut.gammaRangeMax) return null;
  const position = gammaValue * lut.sampleScale;
  const lower = Math.max(0, Math.min(lut.values.length - 1, Math.floor(position)));
  const upper = Math.min(lut.values.length - 1, lower + 1);
  const fraction = position - lower;
  const lo = lut.values[lower] ?? sourceIntensity;
  const hi = lut.values[upper] ?? lo;
  return lo + (hi - lo) * fraction;
}

export function applyStfToneMatchInPlace(
  linear: Float32Array,
  gain: number,
  scaledLog: number,
  lut: StfToneMatchLut | null = null,
): void {
  if (!(Number.isFinite(gain) && gain > 0 && Number.isFinite(scaledLog))) {
    throw new Error("STF tone-match parameters are invalid.");
  }
  if (Math.abs(gain - 1) <= 1e-8 && Math.abs(scaledLog) <= 1e-8) return;
  if (linear.length % 3 !== 0) throw new Error("STF tone-match RGB buffer length is invalid.");

  for (let i = 0; i < linear.length; i += 3) {
    const r = linear[i] ?? 0;
    const g = linear[i + 1] ?? 0;
    const b = linear[i + 2] ?? 0;
    const intensity = toneLinearIntensity(r, g, b);
    if (!(intensity > STF_TONE_EPSILON)) continue;
    const sampled = lut ? sampleStfToneMatchLut(lut, intensity) : null;
    const targetIntensity = sampled ?? transformStfToneIntensity(intensity, gain, scaledLog);
    if (!(Number.isFinite(targetIntensity) && targetIntensity >= 0)) continue;
    const scale = targetIntensity / intensity;
    linear[i] = r * scale;
    linear[i + 1] = g * scale;
    linear[i + 2] = b * scale;
  }
}
