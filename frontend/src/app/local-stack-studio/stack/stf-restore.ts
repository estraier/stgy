/**
 * STF Restore: match the already tone-normalized selected real
 * reference frame toward the COMPLETE STF merge (90% merge, 10% real-frame targets),
 * before the existing guarded replacement.
 *
 * The solvers, 30-pass under-relaxation constants, 3:5:2 tone axis, 65,536
 * area-averaged sample, and color percentile targets follow the LIS RAW
 * embedded-thumbnail matcher in ImageUploadDialog.tsx. Both samples are
 * linear ProPhoto here, so the LIS sRGB-thumbnail input is converted only
 * when measuring display saturation, not before solving/applying corrections.
 * The same correction is used by Restore and Restore+W/M/S.
 */
import {
  SATURATION_ROLLOFF_A, ROLLOFF_SAVING_LIMIT_FACTOR, SIGMOID_WORKING_GAMMA,
  clamp01, clampColorAdjustment, colorSaturationFactor, colorVibranceFactor,
  toneLinearIntensity, naiveSigmoid, naiveInverseSigmoid, rgbToHsv, hsvToRgb,
  applyRolloffScalar, applyScaledLogLinear, rolloffParams,
} from "@/image/tone";
import { convertLinearProPhotoToOutputRgb } from "@/image/color";

const ITERATIONS = 30;
const SEARCH_STEPS = 24;
const GAIN_MAX = 1 << 16;
const LOG_MIN = -2;
const LOG_MAX = 4;
const SIGMOID_MIN = -2;
const SIGMOID_MAX = 3;
const SIGMOID_STEP = 0.1;
const FINAL_RELAXATION_SCALE = 0.5;
// Converge to a 90% STF / 10% selected-reference statistical target; this is
// independent of the existing 30-step under-relaxation of solver parameters.
const MERGE_TARGET_WEIGHT = 0.9;

function restorationTarget(source: number, merged: number): number {
  return source + MERGE_TARGET_WEIGHT * (merged - source);
}
const LOWER_COLOR_PERCENTILES = [20, 25, 30, 35, 40, 45, 50, 55, 60] as const;
const COLOR_UPPER_PERCENTILE = 90;
const COLOR_VALUE_MIN = 0.2;
const HIST_BINS = 4096;
const TONE_EPS = 1e-12;
const GAMMA = SIGMOID_WORKING_GAMMA;

export type StfRestorePlan = {
  gain: number;
  scaledLog: number;
  sigmoid: number;
  saturation: number;
  vibrance: number;
  saturationRolloff: ReturnType<typeof rolloffParams>;
};

function percentile(sorted: readonly number[] | Float32Array, p: number): number {
  if (!sorted.length) return 0;
  const position = (sorted.length - 1) * Math.max(0, Math.min(100, p)) / 100;
  const low = Math.floor(position);
  const high = Math.ceil(position);
  return (sorted[low] ?? 0) * (1 - (position - low)) + (sorted[high] ?? 0) * (position - low);
}

function sortedLuminance(sample: Float32Array): number[] {
  const values: number[] = [];
  for (let i = 0; i < sample.length; i += 3) {
    values.push(clamp01(toneLinearIntensity(sample[i], sample[i + 1], sample[i + 2])));
  }
  return values.sort((a, b) => a - b);
}

function scaledLog(x: number, factor: number): number {
  const value = clamp01(x);
  if (factor > 1e-8) return clamp01(Math.log1p(value * factor) / Math.log1p(factor));
  if (factor < -1e-8) {
    const magnitude = -factor;
    return clamp01(Math.expm1(value * Math.log1p(magnitude)) / magnitude);
  }
  return value;
}

function sigmoid(x: number, value: number): number {
  const encoded = Math.pow(clamp01(x), 1 / GAMMA);
  if (value > 1e-8) {
    const lo = naiveSigmoid(0, value, 0.5);
    const hi = naiveSigmoid(1, value, 0.5);
    return Math.pow(clamp01((naiveSigmoid(encoded, value, 0.5) - lo) / (hi - lo)), GAMMA);
  }
  if (value < -1e-8) {
    const magnitude = -value;
    const lo = naiveInverseSigmoid(0, magnitude, 0.5);
    const hi = naiveInverseSigmoid(1, magnitude, 0.5);
    return Math.pow(clamp01((naiveInverseSigmoid(encoded, magnitude, 0.5) - lo) / (hi - lo)), GAMMA);
  }
  return clamp01(x);
}

function curve(x: number, logarithm: number, contrast: number): number {
  return sigmoid(scaledLog(x, logarithm), contrast);
}

function slopeAtWhite(logarithm: number, contrast: number): number {
  const epsilon = 1e-5;
  const slope = (curve(1, logarithm, contrast) - curve(1 - epsilon, logarithm, contrast)) / epsilon;
  return Number.isFinite(slope) && slope >= 0 ? slope : 1;
}

export function transformStfRestoreTone(x: number, plan: Pick<StfRestorePlan, "gain" | "scaledLog" | "sigmoid">): number {
  const exposed = x * plan.gain;
  if (exposed <= 1) return curve(exposed, plan.scaledLog, plan.sigmoid);
  return 1 + slopeAtWhite(plan.scaledLog, plan.sigmoid) * (exposed - 1);
}

function solveGain(source: number, logarithm: number, contrast: number, target: number): number {
  if (!(target > 0) || !(source > 0)) return 0;
  let upper = 1;
  let value = transformStfRestoreTone(source, { gain: upper, scaledLog: logarithm, sigmoid: contrast });
  while (value < target && upper < GAIN_MAX) {
    upper = Math.min(GAIN_MAX, upper * 2);
    value = transformStfRestoreTone(source, { gain: upper, scaledLog: logarithm, sigmoid: contrast });
  }
  if (value < target) return upper;
  let lower = 0;
  for (let i = 0; i < SEARCH_STEPS; i++) {
    const middle = (lower + upper) / 2;
    if (transformStfRestoreTone(source, { gain: middle, scaledLog: logarithm, sigmoid: contrast }) < target) lower = middle;
    else upper = middle;
  }
  return upper;
}

function solveLog(source: number, gain: number, contrast: number, target: number): number {
  if (source <= TONE_EPS || target <= TONE_EPS) return 0;
  const valueAt = (logarithm: number) => transformStfRestoreTone(source, { gain, scaledLog: logarithm, sigmoid: contrast });
  if (target <= valueAt(LOG_MIN)) return LOG_MIN;
  if (target >= valueAt(LOG_MAX)) return LOG_MAX;
  let lower = LOG_MIN;
  let upper = LOG_MAX;
  for (let i = 0; i < SEARCH_STEPS; i++) {
    const middle = (lower + upper) / 2;
    if (valueAt(middle) < target) lower = middle;
    else upper = middle;
  }
  return (lower + upper) / 2;
}

function solveSigmoid(p25: number, p75: number, gain: number, logarithm: number, targetContrast: number): number {
  const a = Math.pow(clamp01(scaledLog(p25 * gain, logarithm)), 1 / GAMMA);
  const b = Math.pow(clamp01(scaledLog(p75 * gain, logarithm)), 1 / GAMMA);
  let best = 0;
  let bestError = Number.POSITIVE_INFINITY;
  const encoded = (v: number, contrast: number): number => {
    if (contrast > 1e-8) {
      const lo = naiveSigmoid(0, contrast, 0.5);
      const hi = naiveSigmoid(1, contrast, 0.5);
      return clamp01((naiveSigmoid(v, contrast, 0.5) - lo) / (hi - lo));
    }
    if (contrast < -1e-8) {
      const strength = -contrast;
      const lo = naiveInverseSigmoid(0, strength, 0.5);
      const hi = naiveInverseSigmoid(1, strength, 0.5);
      return clamp01((naiveInverseSigmoid(v, strength, 0.5) - lo) / (hi - lo));
    }
    return clamp01(v);
  };
  for (let i = 0; i <= Math.round((SIGMOID_MAX - SIGMOID_MIN) / SIGMOID_STEP); i++) {
    const candidate = SIGMOID_MIN + i * SIGMOID_STEP;
    const error = Math.abs((encoded(b, candidate) - encoded(a, candidate)) - targetContrast);
    if (error < bestError - 1e-12 || (Math.abs(error - bestError) <= 1e-12 && Math.abs(candidate) < Math.abs(best))) {
      best = candidate;
      bestError = error;
    }
  }
  return best;
}

function planTone(reference: Float32Array, target: Float32Array): Pick<StfRestorePlan, "gain" | "scaledLog" | "sigmoid"> {
  const source = sortedLuminance(reference);
  const dest = sortedLuminance(target);
  if (!source.length || source.length !== dest.length) throw new Error("STF Restore tone samples are invalid.");
  const sourceP25 = percentile(source, 25);
  const sourceP50 = percentile(source, 50);
  const sourceP75 = percentile(source, 75);
  const targetP50 = restorationTarget(sourceP50, percentile(dest, 50));
  const sourceContrast = Math.pow(sourceP75, 1 / GAMMA) - Math.pow(sourceP25, 1 / GAMMA);
  const mergeContrast = Math.pow(percentile(dest, 75), 1 / GAMMA) - Math.pow(percentile(dest, 25), 1 / GAMMA);
  const targetContrast = restorationTarget(sourceContrast, mergeContrast);
  // Same LIS P98..P90 exposure selection: use the brightest non-clipped pair.
  // Blend each *statistical goal*, not the relaxation step or final RGB image.
  let sourceExposure = percentile(source, 90);
  let mergeExposure = percentile(dest, 90);
  for (let p = 98; p >= 90; p--) {
    const src = percentile(source, p);
    const dst = percentile(dest, p);
    if (src > 1e-6 && dst > 1e-6 && src <= 0.97 && dst <= 0.97) {
      sourceExposure = src;
      mergeExposure = dst;
      break;
    }
  }
  const targetExposure = restorationTarget(sourceExposure, mergeExposure);
  if (!(sourceExposure > 1e-6 && targetExposure > 1e-6)) return { gain: 1, scaledLog: 0, sigmoid: 0 };
  let gain = 1;
  let scaledLog = 0;
  let contrast = 0;
  for (let i = 0; i < ITERATIONS; i++) {
    const relaxation = Math.pow(FINAL_RELAXATION_SCALE, i / Math.max(1, ITERATIONS - 1));
    const targetGain = solveGain(sourceExposure, scaledLog, contrast, targetExposure);
    if (targetGain > 0 && gain > 0) gain *= Math.pow(targetGain / gain, 0.7 * relaxation);
    const targetLog = solveLog(sourceP50, gain, contrast, targetP50);
    scaledLog += 0.3 * relaxation * (targetLog - scaledLog);
    const targetSigmoid = solveSigmoid(sourceP25, sourceP75, gain, scaledLog, targetContrast);
    contrast += 0.2 * relaxation * (targetSigmoid - contrast);
  }
  if (!(Number.isFinite(gain) && gain > 0 && Number.isFinite(scaledLog) && Number.isFinite(contrast))) {
    throw new Error("STF Restore tone match produced invalid parameters.");
  }
  return { gain, scaledLog, sigmoid: contrast };
}

function median5x5(channel: Float32Array, width: number, height: number): Float32Array {
  const result = new Float32Array(channel.length);
  const scratch = new Float32Array(25);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let count = 0;
      for (let dy = -2; dy <= 2; dy++) {
        const sy = Math.max(0, Math.min(height - 1, y + dy));
        for (let dx = -2; dx <= 2; dx++) {
          const sx = Math.max(0, Math.min(width - 1, x + dx));
          scratch[count++] = channel[sy * width + sx];
        }
      }
      for (let i = 1; i < count; i++) {
        const value = scratch[i];
        let j = i - 1;
        while (j >= 0 && scratch[j] > value) {
          scratch[j + 1] = scratch[j];
          j--;
        }
        scratch[j + 1] = value;
      }
      result[y * width + x] = scratch[12];
    }
  }
  return result;
}

function denoiseChroma(sample: Float32Array, width: number, height: number): Float32Array {
  // Same two 5x5 chroma-median passes as LIS, retaining intensity separately.
  const pixels = width * height;
  const luma = new Float32Array(pixels);
  const chromaR = new Float32Array(pixels);
  const chromaB = new Float32Array(pixels);
  const lR = 0.2880402;
  const lG = 0.7118741;
  const lB = 0.0000857;
  for (let i = 0; i < pixels; i++) {
    const o = i * 3;
    const r = sample[o];
    const g = sample[o + 1];
    const b = sample[o + 2];
    const y = lR * r + lG * g + lB * b;
    luma[i] = y;
    chromaR[i] = r - y;
    chromaB[i] = b - y;
  }
  const filteredR = median5x5(median5x5(chromaR, width, height), width, height);
  const filteredB = median5x5(median5x5(chromaB, width, height), width, height);
  const output = new Float32Array(sample.length);
  for (let i = 0; i < pixels; i++) {
    const y = luma[i];
    const r = y + filteredR[i];
    const b = y + filteredB[i];
    const g = (y - lR * r - lB * b) / lG;
    const o = i * 3;
    output[o] = Math.max(0, Math.min(4, r));
    output[o + 1] = Math.max(0, Math.min(4, g));
    output[o + 2] = Math.max(0, Math.min(4, b));
  }
  return output;
}

function orderedValueIndices(values: Float32Array): number[] {
  return Array.from({ length: values.length }, (_, i) => i).sort((a, b) => values[a] - values[b] || a - b);
}

function percentileByIndices(values: Float32Array, indices: readonly number[], p: number): number {
  if (!indices.length) return 0;
  const pos = (indices.length - 1) * Math.min(100, Math.max(0, p)) / 100;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return values[indices[lo]] * (1 - (pos - lo)) + values[indices[hi]] * (pos - lo);
}

function selectValuePopulation(sortedIndices: readonly number[], lowerPercentile: number): Uint32Array {
  const count = sortedIndices.length;
  const start = Math.min(count - 1, Math.floor(count * lowerPercentile / 100));
  const end = Math.max(start + 1, Math.min(count, Math.ceil(count * COLOR_UPPER_PERCENTILE / 100)));
  return Uint32Array.from(sortedIndices.slice(start, end));
}

function histogramPercentile(histogram: Uint32Array, count: number, p: number): number {
  if (!count) return 0;
  const position = (count - 1) * p / 100;
  let cumulative = 0;
  let lo = histogram.length - 1;
  let hi = histogram.length - 1;
  let found = false;
  for (let i = 0; i < histogram.length; i++) {
    cumulative += histogram[i];
    if (!found && cumulative > Math.floor(position)) { lo = i; found = true; }
    if (cumulative > Math.ceil(position)) { hi = i; break; }
  }
  return (lo + (hi - lo) * (position - Math.floor(position))) / (histogram.length - 1);
}

type ColorStatistics = {
  hue: Float32Array;
  saturation: Float32Array;
  value: Float32Array;
  indices: Uint32Array;
  saturationP998: number;
  targetP50: number;
  targetP95: number;
};

function makeColorStatistics(reference: Float32Array, target: Float32Array): ColorStatistics {
  const count = reference.length / 3;
  const hue = new Float32Array(count);
  const saturation = new Float32Array(count);
  const value = new Float32Array(count);
  const sourceValue = new Float32Array(count);
  const targetValue = new Float32Array(count);
  const targetSaturation = new Float32Array(count);
  const saturationValues: number[] = [];
  for (let i = 0; i < count; i++) {
    const o = i * 3;
    const [h, s, v] = rgbToHsv(reference[o], reference[o + 1], reference[o + 2]);
    hue[i] = h;
    saturation[i] = s;
    value[i] = v;
    saturationValues.push(s);
    const [srcR, srcG, srcB] = convertLinearProPhotoToOutputRgb(reference[o], reference[o + 1], reference[o + 2], "srgb");
    sourceValue[i] = rgbToHsv(clamp01(srcR), clamp01(srcG), clamp01(srcB))[2];
    const [dstR, dstG, dstB] = convertLinearProPhotoToOutputRgb(target[o], target[o + 1], target[o + 2], "srgb");
    const [, dstS, dstV] = rgbToHsv(clamp01(dstR), clamp01(dstG), clamp01(dstB));
    targetSaturation[i] = dstS;
    targetValue[i] = dstV;
  }
  const sortedSource = orderedValueIndices(sourceValue);
  const sortedTarget = orderedValueIndices(targetValue);
  let lower = LOWER_COLOR_PERCENTILES[LOWER_COLOR_PERCENTILES.length - 1];
  for (const p of LOWER_COLOR_PERCENTILES) {
    if (percentileByIndices(sourceValue, sortedSource, p) > COLOR_VALUE_MIN) { lower = p; break; }
  }
  // Source determines the adaptive lower Value rank (same LIS behavior).
  const indices = selectValuePopulation(sortedSource, lower);
  const targetIndices = selectValuePopulation(sortedTarget, lower);
  const histogram = new Uint32Array(HIST_BINS);
  for (const i of targetIndices) {
    const s = targetSaturation[i];
    histogram[Math.max(0, Math.min(HIST_BINS - 1, Math.round(s * (HIST_BINS - 1))))]++;
  }
  saturationValues.sort((a, b) => a - b);
  return {
    hue, saturation, value, indices,
    saturationP998: percentile(saturationValues, 99.8),
    targetP50: histogramPercentile(histogram, targetIndices.length, 50),
    targetP95: histogramPercentile(histogram, targetIndices.length, 95),
  };
}

function evaluateSaturation(sample: ColorStatistics, saturation: number, vibrance: number, p: number): number {
  const factor = colorSaturationFactor(saturation);
  const vibFactor = colorVibranceFactor(vibrance);
  const saturationRolloff = factor > 1
    ? rolloffParams(sample.saturationP998 * factor, SATURATION_ROLLOFF_A, ROLLOFF_SAVING_LIMIT_FACTOR, 1)
    : null;
  const histogram = new Uint32Array(HIST_BINS);
  for (const i of sample.indices) {
    let s = sample.saturation[i];
    if (saturation !== 0) s = clamp01(applyRolloffScalar(s * factor, saturationRolloff));
    if (vibrance !== 0) s = applyScaledLogLinear(s, vibFactor);
    const [r, g, b] = hsvToRgb(sample.hue[i], s, sample.value[i]);
    const [sr, sg, sb] = convertLinearProPhotoToOutputRgb(r, g, b, "srgb");
    const outputSaturation = rgbToHsv(clamp01(sr), clamp01(sg), clamp01(sb))[1];
    histogram[Math.max(0, Math.min(HIST_BINS - 1, Math.round(outputSaturation * (HIST_BINS - 1))))]++;
  }
  return histogramPercentile(histogram, sample.indices.length, p);
}

function solveSaturation(sample: ColorStatistics): number {
  const base = evaluateSaturation(sample, 0, 0, 95);
  const estimate = base > 1e-8 ? clampColorAdjustment((sample.targetP95 / base - 1) * 100)
    : sample.targetP95 > base ? 100 : 0;
  let best = estimate;
  let bestError = Number.POSITIVE_INFINITY;
  for (let delta = -2; delta <= 2; delta++) {
    const candidate = clampColorAdjustment(estimate + delta);
    const error = Math.abs(evaluateSaturation(sample, candidate, 0, 95) - sample.targetP95);
    if (error < bestError - 1e-12 || (Math.abs(error - bestError) <= 1e-12 && Math.abs(candidate) < Math.abs(best))) {
      best = candidate;
      bestError = error;
    }
  }
  return best;
}

function solveVibrance(sample: ColorStatistics, saturation: number): number {
  const evaluate = (v: number) => evaluateSaturation(sample, saturation, v, 50);
  let lower = -100;
  let upper = 100;
  let lowerValue = evaluate(lower);
  let upperValue = evaluate(upper);
  const increasing = lowerValue <= upperValue;
  if (increasing ? sample.targetP50 <= lowerValue : sample.targetP50 >= lowerValue) return lower;
  if (increasing ? sample.targetP50 >= upperValue : sample.targetP50 <= upperValue) return upper;
  for (let i = 0; i < 8 && upper - lower > 1; i++) {
    const middle = Math.floor((upper + lower) / 2);
    const value = evaluate(middle);
    if ((increasing && value < sample.targetP50) || (!increasing && value > sample.targetP50)) {
      lower = middle;
      lowerValue = value;
    } else {
      upper = middle;
      upperValue = value;
    }
  }
  const loError = Math.abs(lowerValue - sample.targetP50);
  const hiError = Math.abs(upperValue - sample.targetP50);
  return loError < hiError - 1e-12 ? lower : hiError < loError - 1e-12 ? upper
    : Math.abs(lower) <= Math.abs(upper) ? lower : upper;
}

/** LIS 30-step tone + 30-step color planning, with STF merge as target. */
export function planStfRestore(reference: Float32Array, target: Float32Array, width: number, height: number): StfRestorePlan {
  if (reference.length !== target.length || reference.length !== width * height * 3 || reference.length === 0) {
    throw new Error("STF Restore target/reference sample dimensions do not match.");
  }
  for (let i = 0; i < reference.length; i++) {
    if (!Number.isFinite(reference[i]) || !Number.isFinite(target[i])) {
      throw new Error("STF Restore samples contain a non-finite pixel.");
    }
  }
  // Identical samples should remain exactly unchanged, not receive a tiny
  // one-bin rounding correction from the HSV histogram searches.
  let identical = true;
  for (let i = 0; i < reference.length; i++) {
    if (reference[i] !== target[i]) { identical = false; break; }
  }
  if (identical) {
    return { gain: 1, scaledLog: 0, sigmoid: 0, saturation: 0, vibrance: 0, saturationRolloff: null };
  }
  const tone = planTone(reference, target);
  const sample = makeColorStatistics(
    denoiseChroma(reference, width, height),
    denoiseChroma(target, width, height),
  );
  // Match P95 (saturation) and P50 (vibrance) to 10% of the unadjusted
  // selected-reference statistics plus 90% of the merged STF statistics. Measure
  // both endpoints with the same display-saturation evaluator and population,
  // so the blend is in the actual statistics that the LIS-style solvers fit.
  const colorTargets: ColorStatistics = {
    ...sample,
    targetP50: restorationTarget(evaluateSaturation(sample, 0, 0, 50), sample.targetP50),
    targetP95: restorationTarget(evaluateSaturation(sample, 0, 0, 95), sample.targetP95),
  };
  const targetSaturation = solveSaturation(colorTargets);
  let saturation = 0;
  for (let i = 0; i < ITERATIONS; i++) saturation += 0.7 * (targetSaturation - saturation);
  // Restore must be able to reduce saturation beyond the LIS -5 preview floor.
  saturation = clampColorAdjustment(saturation);
  const targetVibrance = solveVibrance(colorTargets, saturation);
  let vibrance = 0;
  for (let i = 0; i < ITERATIONS; i++) vibrance += 0.5 * (targetVibrance - vibrance);
  vibrance = clampColorAdjustment(vibrance);
  const factor = colorSaturationFactor(saturation);
  const saturationRolloff = factor > 1
    ? rolloffParams(sample.saturationP998 * factor, SATURATION_ROLLOFF_A, ROLLOFF_SAVING_LIMIT_FACTOR, 1)
    : null;
  return { ...tone, saturation, vibrance, saturationRolloff };
}

/** In-place correction of the real aligned stripe, before its guard-alpha blend. */
export function applyStfRestoreInPlace(rgb: Float32Array, plan: StfRestorePlan): void {
  const { gain, scaledLog: logarithm, sigmoid: contrast, saturation, vibrance, saturationRolloff } = plan;
  const toneSlope = slopeAtWhite(logarithm, contrast);
  const saturationFactor = colorSaturationFactor(saturation);
  const vibranceFactor = colorVibranceFactor(vibrance);
  for (let o = 0; o < rgb.length; o += 3) {
    let r = rgb[o];
    let g = rgb[o + 1];
    let b = rgb[o + 2];
    const intensity = toneLinearIntensity(r, g, b);
    if (intensity > TONE_EPS) {
      const exposed = intensity * gain;
      const adjusted = exposed <= 1 ? curve(exposed, logarithm, contrast)
        : 1 + toneSlope * (exposed - 1);
      const factor = adjusted / intensity;
      r *= factor; g *= factor; b *= factor;
    } else {
      r = 0; g = 0; b = 0;
    }
    if (saturation !== 0 || vibrance !== 0) {
      // The LIS RAW color pass adjusts HSV saturation then Vibrance in ProPhoto.
      // Preserve linear headroom >1 exactly as its extendedScale path does.
      const headroom = Math.max(1, r, g, b);
      const [h, originalS, value] = rgbToHsv(r / headroom, g / headroom, b / headroom);
      let s = originalS;
      if (saturation !== 0) s = clamp01(applyRolloffScalar(s * saturationFactor, saturationRolloff));
      if (vibrance !== 0) s = applyScaledLogLinear(s, vibranceFactor);
      const [sr, sg, sb] = hsvToRgb(h, s, value);
      r = sr * headroom; g = sg * headroom; b = sb * headroom;
    }
    if (!(Number.isFinite(r) && Number.isFinite(g) && Number.isFinite(b))) {
      throw new Error("STF Restore produced a non-finite color value.");
    }
    rgb[o] = r;
    rgb[o + 1] = g;
    rgb[o + 2] = b;
  }
}
