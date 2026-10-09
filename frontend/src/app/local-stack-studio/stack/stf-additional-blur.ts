export const STF_ADDITIONAL_BLUR_TARGET_VALUES = [0, 0.3, 0.4, 0.5, 0.6, 0.7] as const;
export const DEFAULT_STF_ADDITIONAL_BLUR_TARGET = 0;
export const STF_ADDITIONAL_BLUR_HISTOGRAM_BINS = 4096;

const STF_ADDITIONAL_BLUR_EDGE_SUPPORT_SOFTNESS = 0.01;
const STF_ADDITIONAL_BLUR_BASELINE_SHARP_LOW = 0.45;
const STF_ADDITIONAL_BLUR_BASELINE_SHARP_HIGH = 0.75;
const STF_ADDITIONAL_BLUR_RADIUS_AT_1MP = 2;
const STF_ADDITIONAL_BLUR_MIN_RADIUS = 2;
const STF_ADDITIONAL_BLUR_MAX_RADIUS = 12;
const STF_ADDITIONAL_BLUR_MASK_MAX = 65535;
const STF_ADDITIONAL_BLUR_SCALE_FACTOR_MAX = 1e12;

export function isStfAdditionalBlurTarget(value: number): boolean {
  return STF_ADDITIONAL_BLUR_TARGET_VALUES.some((candidate) => Math.abs(candidate - value) < 1e-12);
}

export function shouldApplyStfAdditionalBlur(targetMedian: number): boolean {
  return isStfAdditionalBlurTarget(targetMedian) && targetMedian > 0;
}

export function sameStfAdditionalBlurFNumber(a: number, b: number): boolean {
  if (!(Number.isFinite(a) && Number.isFinite(b) && a > 0 && b > 0)) return false;
  const scale = Math.max(1, Math.abs(a), Math.abs(b));
  return Math.abs(a - b) <= scale * 1e-6;
}

export function buildStfAdditionalBlurApertureOrder(fNumbers: ArrayLike<number>): Int32Array | null {
  const entries: Array<{ index: number; fNumber: number }> = [];
  for (let index = 0; index < fNumbers.length; index += 1) {
    const fNumber = Number(fNumbers[index]);
    if (!(Number.isFinite(fNumber) && fNumber > 0)) return null;
    entries.push({ index, fNumber });
  }
  if (entries.length < 2) return null;
  entries.sort((left, right) => left.fNumber - right.fNumber || left.index - right.index);

  let distinctCount = 1;
  for (let index = 1; index < entries.length; index += 1) {
    if (!sameStfAdditionalBlurFNumber(entries[index].fNumber, entries[index - 1].fNumber)) {
      distinctCount += 1;
    }
  }
  if (distinctCount < 2) return null;
  return Int32Array.from(entries.map((entry) => entry.index));
}

export function resolveStfAdditionalBlurRadius(width: number, height: number): number {
  const scale = Math.sqrt(Math.max(1, width * height) / 1_000_000);
  const radius = Math.round(STF_ADDITIONAL_BLUR_RADIUS_AT_1MP * Math.max(1, scale));
  return Math.max(STF_ADDITIONAL_BLUR_MIN_RADIUS, Math.min(STF_ADDITIONAL_BLUR_MAX_RADIUS, radius));
}

export function resolveStfAdditionalBlurMaskHalo(width: number, height: number): number {
  return 2 + 2 * resolveStfAdditionalBlurRadius(width, height);
}

export function resolveStfAdditionalBlurApplyHalo(width: number, height: number): number {
  return resolveStfAdditionalBlurRadius(width, height);
}

export function clampStfAdditionalBlurUnit(value: number): number {
  if (!(value > 0)) return 0;
  if (value >= 1) return 1;
  return value;
}

export function smoothstepStfAdditionalBlur(edge0: number, edge1: number, value: number): number {
  if (!(edge1 > edge0)) return value >= edge1 ? 1 : 0;
  const t = clampStfAdditionalBlurUnit((value - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
}

export function computeStfAdditionalBlurOriginallyUnsharpGate(
  peakSharpness: number,
  baselineSharpness: number,
): number {
  const peak = Number.isFinite(peakSharpness) && peakSharpness > 0 ? peakSharpness : 0;
  const baseline = Number.isFinite(baselineSharpness) && baselineSharpness > 0 ? baselineSharpness : 0;
  if (!(peak > 0)) return 0;
  const ratio = baseline / (peak + 1e-12);
  return 1 - smoothstepStfAdditionalBlur(
    STF_ADDITIONAL_BLUR_BASELINE_SHARP_LOW,
    STF_ADDITIONAL_BLUR_BASELINE_SHARP_HIGH,
    ratio,
  );
}

export type StfAdditionalBlurTerms = {
  support: number;
  originallyUnsharpGate: number;
  rawMask: number;
};

export function computeStfAdditionalBlurTerms(
  openRise: number,
  openPeakSharpness: number,
  baselineSharpness: number,
): StfAdditionalBlurTerms {
  const rise = Number.isFinite(openRise) && openRise > 0 ? openRise : 0;
  const peak = Number.isFinite(openPeakSharpness) && openPeakSharpness > 0 ? openPeakSharpness : 0;
  if (!(rise > 0) || !(peak > 0)) {
    return { support: 0, originallyUnsharpGate: 0, rawMask: 0 };
  }
  const edgeSupport = peak / (peak + STF_ADDITIONAL_BLUR_EDGE_SUPPORT_SOFTNESS);
  const changeSupport = rise / (peak + rise);
  const support = clampStfAdditionalBlurUnit(edgeSupport * changeSupport * 2);
  const originallyUnsharpGate = computeStfAdditionalBlurOriginallyUnsharpGate(peak, baselineSharpness);
  return {
    support,
    originallyUnsharpGate,
    rawMask: clampStfAdditionalBlurUnit(support * originallyUnsharpGate),
  };
}

export function quantizeStfAdditionalBlurMask(value: number): number {
  return Math.round(clampStfAdditionalBlurUnit(value) * STF_ADDITIONAL_BLUR_MASK_MAX);
}

export function dequantizeStfAdditionalBlurMask(value: number): number {
  if (!(Number.isFinite(value) && value > 0)) return 0;
  if (value >= STF_ADDITIONAL_BLUR_MASK_MAX) return 1;
  return value / STF_ADDITIONAL_BLUR_MASK_MAX;
}

export function stfAdditionalBlurHistogramBin(value: number, binCount = STF_ADDITIONAL_BLUR_HISTOGRAM_BINS): number {
  const count = Math.max(2, Math.floor(binCount));
  const unit = clampStfAdditionalBlurUnit(value);
  return Math.min(count - 1, Math.floor(unit * count));
}

export function stfAdditionalBlurHistogramPercentile(
  histogram: ArrayLike<number>,
  sampleCount: number,
  percentile: number,
): number {
  if (!(histogram.length > 1) || !(sampleCount > 0)) return 0;
  const p = clampStfAdditionalBlurUnit(percentile);
  const target = Math.max(1, Math.ceil(sampleCount * p));
  let cumulative = 0;
  for (let index = 0; index < histogram.length; index += 1) {
    cumulative += Number(histogram[index]) || 0;
    if (cumulative >= target) return index / (histogram.length - 1);
  }
  return 1;
}

export function applyStfAdditionalBlurScaledLog(value: number, factor: number): number {
  const x = clampStfAdditionalBlurUnit(value);
  const f = Number.isFinite(factor) ? factor : 0;
  if (f > 1e-8) {
    return clampStfAdditionalBlurUnit(Math.log1p(x * f) / Math.log1p(f));
  }
  if (f < -1e-8) {
    const magnitude = -f;
    return clampStfAdditionalBlurUnit(Math.expm1(x * Math.log1p(magnitude)) / magnitude);
  }
  return x;
}

export function solveStfAdditionalBlurScaledLogFactor(
  sourceMedian: number,
  targetMedian: number,
): number {
  const source = clampStfAdditionalBlurUnit(sourceMedian);
  const target = clampStfAdditionalBlurUnit(targetMedian);
  if (!(source > 0 && source < 1 && target > 0 && target < 1)) return 0;
  if (Math.abs(source - target) <= 1e-9) return 0;

  if (target > source) {
    let low = 0;
    let high = 1;
    while (
      applyStfAdditionalBlurScaledLog(source, high) < target
      && high < STF_ADDITIONAL_BLUR_SCALE_FACTOR_MAX
    ) {
      high = Math.min(STF_ADDITIONAL_BLUR_SCALE_FACTOR_MAX, high * 2);
    }
    for (let iteration = 0; iteration < 80; iteration += 1) {
      const middle = (low + high) * 0.5;
      if (applyStfAdditionalBlurScaledLog(source, middle) < target) low = middle;
      else high = middle;
    }
    return high;
  }

  let lowMagnitude = 0;
  let highMagnitude = 1;
  while (
    applyStfAdditionalBlurScaledLog(source, -highMagnitude) > target
    && highMagnitude < STF_ADDITIONAL_BLUR_SCALE_FACTOR_MAX
  ) {
    highMagnitude = Math.min(STF_ADDITIONAL_BLUR_SCALE_FACTOR_MAX, highMagnitude * 2);
  }
  for (let iteration = 0; iteration < 80; iteration += 1) {
    const middleMagnitude = (lowMagnitude + highMagnitude) * 0.5;
    if (applyStfAdditionalBlurScaledLog(source, -middleMagnitude) > target) lowMagnitude = middleMagnitude;
    else highMagnitude = middleMagnitude;
  }
  return -highMagnitude;
}
