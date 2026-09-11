import type { DecodedRgbImage16, HistogramData, LinearRgbSample, ToneAutoSample } from "./types";
import {
  PROPHOTO_LUMA_R, PROPHOTO_LUMA_G, PROPHOTO_LUMA_B,
  PROPHOTO_TO_SRGB_M00, PROPHOTO_TO_SRGB_M01, PROPHOTO_TO_SRGB_M02,
  PROPHOTO_TO_SRGB_M10, PROPHOTO_TO_SRGB_M11, PROPHOTO_TO_SRGB_M12,
  PROPHOTO_TO_SRGB_M20, PROPHOTO_TO_SRGB_M21, PROPHOTO_TO_SRGB_M22,
} from "@/image/color";
import { buildRenderedPixelToSourceTransform, getAnalysisLinearRgbSample } from "./sampling";
import {
  isUsableImageEditClarityMap,
  applyPositiveImageEditClarityOutputRolloffInto,
  sampleImageEditClarityGain,
  type ImageEditClarityMap,
} from "./clarity";
import {
  HISTOGRAM_DISPLAY_GAMMA,
  applyColorAdjustmentsAfterToneLinearRgb, applyColorAdjustmentsLinearRgb,
  applyShadowLinear, applyToneAdjustmentsLinearRgb, applyToneLinearToRgb,
  applyWhiteBalanceLinear, clamp01, clampColorAdjustment, clampExposureEv,
  clampScaledLog, clampSigmoid, clampToneRangeAdjustment, clampWhiteBalanceValue,
  colorSaturationFactor, colorVibranceFactor, rgbToHsv, rolloffParams,
  srgbChannelToLinear, whiteBalanceGains, type ColorAdjustmentContext, type HighlightRange,
} from "@/image/tone";

// Statistical analysis and Auto Tone share the fixed-area analysis sample.

export function percentileFromSortedValues(values: number[], percentile: number): number {
  if (!values.length) return 0;
  const rank = (values.length - 1) * Math.min(100, Math.max(0, percentile)) / 100;
  const lower = Math.floor(rank);
  const upper = Math.ceil(rank);
  const fraction = rank - lower;
  const lo = values[lower] ?? 0;
  const hi = values[upper] ?? lo;
  return lo + (hi - lo) * fraction;
}

export function percentilesFromValues(
  values: number[],
  percentiles: readonly number[],
): number[] {
  if (!values.length) return percentiles.map(() => 0);
  const normalized = percentiles.map((percentile) => Math.min(100, Math.max(0, percentile)));
  const needsSortedValues = normalized.some((percentile) => percentile > 0 && percentile < 100);
  if (!needsSortedValues) {
    let min = values[0] ?? 0;
    let max = min;
    for (let i = 1; i < values.length; i++) {
      const value = values[i] ?? min;
      min = Math.min(min, value);
      max = Math.max(max, value);
    }
    return normalized.map((percentile) => percentile <= 0 ? min : max);
  }
  values.sort((a, b) => a - b);
  return normalized.map((percentile) => percentileFromSortedValues(values, percentile));
}

export function percentileFromValues(values: number[], percentile: number): number {
  return percentilesFromValues(values, [percentile])[0] ?? 0;
}

export function buildColorAdjustmentContextFromLinearRgbSample(
  sample: LinearRgbSample,
  temperature: number,
  tint: number,
  exposureEv: number,
  shadow: number,
  highlight: number,
  scaledLog: number,
  sigmoid: number,
  vibrance: number,
  saturation: number,
  ignoreInvalid = false,
): ColorAdjustmentContext {
  const normalizedTemperature = clampWhiteBalanceValue(temperature);
  const normalizedTint = clampWhiteBalanceValue(tint);
  const normalizedShadow = clampToneRangeAdjustment(shadow);
  const normalizedHighlight = clampToneRangeAdjustment(highlight);
  const normalizedScaledLog = clampScaledLog(scaledLog);
  const normalizedSigmoid = clampSigmoid(sigmoid);
  const normalizedVibrance = clampColorAdjustment(vibrance);
  const normalizedSaturation = clampColorAdjustment(saturation);
  const factor = Math.pow(2, exposureEv);
  const gains = whiteBalanceGains(normalizedTemperature, normalizedTint);
  const hasWhiteBalance = normalizedTemperature !== 0 || normalizedTint !== 0;
  const hasExposure = factor !== 1;
  const hasShadow = normalizedShadow !== 0;
  const hasScaledLog = normalizedScaledLog !== 0;
  const hasSigmoid = normalizedSigmoid !== 0;
  const hasSaturation = normalizedSaturation !== 0;
  const hasVibrance = normalizedVibrance !== 0;
  const hasSaturationOrVibrance = hasSaturation || hasVibrance;
  const needsHighlightRange = normalizedHighlight !== 0;

  const exposedValues: number[] = [];
  let highlightMax = -Infinity;
  const data = sample.data;
  const valid = sample.valid;
  const count = Math.floor(data.length / 3);
  for (let pixel = 0; pixel < count; pixel++) {
    if (ignoreInvalid && valid && !valid[pixel]) continue;
    const i = pixel * 3;
    let r = data[i] ?? 0;
    let g = data[i + 1] ?? 0;
    let b = data[i + 2] ?? 0;
    if (hasWhiteBalance) {
      [r, g, b] = applyWhiteBalanceLinear(r, g, b, gains);
    }
    let exposedR = r;
    let exposedG = g;
    let exposedB = b;
    if (hasExposure) {
      exposedR *= factor;
      exposedG *= factor;
      exposedB *= factor;
    }
    exposedValues.push(exposedR, exposedG, exposedB);
    if (needsHighlightRange) {
      const highlightValue = hasShadow
        ? Math.max(
            applyShadowLinear(exposedR, normalizedShadow),
            applyShadowLinear(exposedG, normalizedShadow),
            applyShadowLinear(exposedB, normalizedShadow),
          )
        : Math.max(exposedR, exposedG, exposedB);
      highlightMax = Math.max(highlightMax, highlightValue);
    }
  }
  // Rolloff depends on the post-exposure signal range, not on the sign of the
  // Exposure control. RAW buffers may already contain values above 1 at 0 EV.
  const maxVal = percentileFromValues(exposedValues, 99.8);
  const rolloff = rolloffParams(maxVal, 0.5, 4);
  const highlightRange: HighlightRange | null = normalizedHighlight !== 0 && Number.isFinite(highlightMax)
    ? { p100: highlightMax }
    : null;
  const hasHighlight = normalizedHighlight !== 0 && highlightRange !== null;
  const toneFlags = {
    hasExposure,
    hasShadow,
    hasHighlight,
    hasScaledLog,
    hasSigmoid,
  };
  const saturationFactor = colorSaturationFactor(normalizedSaturation);
  const vibranceFactor = colorVibranceFactor(normalizedVibrance);
  const saturationValues: number[] = [];
  if (saturationFactor > 1) {
    for (let pixel = 0; pixel < count; pixel++) {
      if (ignoreInvalid && valid && !valid[pixel]) continue;
      const i = pixel * 3;
      const [r, g, b] = applyToneLinearToRgb(
        data[i] ?? 0,
        data[i + 1] ?? 0,
        data[i + 2] ?? 0,
        gains,
        hasWhiteBalance,
        factor,
        normalizedShadow,
        normalizedHighlight,
        highlightRange,
        rolloff,
        normalizedScaledLog,
        normalizedSigmoid,
        toneFlags,
      );
      const [, s] = rgbToHsv(r, g, b);
      saturationValues.push(s * saturationFactor);
    }
  }
  const saturationRolloff = saturationFactor > 1
    ? rolloffParams(percentileFromValues(saturationValues, 99), 0.7, 4)
    : null;

  return {
    gains,
    hasWhiteBalance,
    hasExposure,
    hasShadow,
    hasHighlight,
    hasScaledLog,
    hasSigmoid,
    hasSaturation,
    hasVibrance,
    hasSaturationOrVibrance,
    factor,
    shadow: normalizedShadow,
    highlight: normalizedHighlight,
    highlightRange,
    rolloff,
    scaledLog: normalizedScaledLog,
    sigmoid: normalizedSigmoid,
    normalizedVibrance,
    normalizedSaturation,
    saturationFactor,
    vibranceFactor,
    saturationRolloff,
  };
}

export function colorAdjustmentContextFromLinearRgbSample(
  sample: Float32Array,
  temperature: number,
  tint: number,
  exposureEv: number,
  shadow: number,
  highlight: number,
  scaledLog: number,
  sigmoid: number,
  vibrance: number,
  saturation: number,
): ColorAdjustmentContext {
  return buildColorAdjustmentContextFromLinearRgbSample(
    { data: sample, width: Math.floor(sample.length / 3), height: 1 },
    temperature,
    tint,
    exposureEv,
    shadow,
    highlight,
    scaledLog,
    sigmoid,
    vibrance,
    saturation,
  );
}

export function computeHistogramDataFromRgb16(
  decoded: DecodedRgbImage16,
  sourceRect: { x: number; y: number; w: number; h: number },
  rotationDegrees: number,
  temperature: number,
  tint: number,
  exposureEv: number,
  shadow: number,
  highlight: number,
  scaledLog: number,
  sigmoid: number,
  vibrance: number,
  saturation: number,
  clarityMap: ImageEditClarityMap | null = null,
): HistogramData | null {
  if (decoded.width <= 0 || decoded.height <= 0) return null;
  const sample = getAnalysisLinearRgbSample(decoded, sourceRect, rotationDegrees);
  if (!sample.data.length) return null;
  const adjustment = buildColorAdjustmentContextFromLinearRgbSample(
    sample,
    temperature,
    tint,
    exposureEv,
    shadow,
    highlight,
    scaledLog,
    sigmoid,
    vibrance,
    saturation,
    true,
  );
  const activeClarityMap = isUsableImageEditClarityMap(clarityMap) ? clarityMap : null;
  const hasClarity = activeClarityMap !== null;
  const clarityRolloffOutput = activeClarityMap && activeClarityMap.strength > 0 ? new Float32Array(3) : null;
  const clarityRolloffProPhoto = activeClarityMap && activeClarityMap.strength > 0 ? new Float32Array(3) : null;
  const r = new Array<number>(HISTOGRAM_BINS).fill(0);
  const g = new Array<number>(HISTOGRAM_BINS).fill(0);
  const b = new Array<number>(HISTOGRAM_BINS).fill(0);
  const luma = new Array<number>(HISTOGRAM_BINS).fill(0);
  const areaWeight = sourceRect.w * sourceRect.h / Math.max(1, sample.width * sample.height);
  const clarityTransform = hasClarity
    ? buildRenderedPixelToSourceTransform(
        decoded.width,
        decoded.height,
        sourceRect.x,
        sourceRect.y,
        sample.width / Math.max(1, sourceRect.w),
        sample.height / Math.max(1, sourceRect.h),
        rotationDegrees,
      )
    : null;
  const pixelCount = Math.floor(sample.data.length / 3);
  for (let pixel = 0; pixel < pixelCount; pixel++) {
    const i = pixel * 3;
    if (sample.valid && !sample.valid[pixel]) {
      const grayDisplay = histogramDisplayValue(srgbChannelToLinear(128));
      addHistogramInterval(r, grayDisplay, grayDisplay, areaWeight);
      addHistogramInterval(g, grayDisplay, grayDisplay, areaWeight);
      addHistogramInterval(b, grayDisplay, grayDisplay, areaWeight);
      addHistogramInterval(luma, grayDisplay, grayDisplay, areaWeight);
      continue;
    }
    let rr = sample.data[i] ?? 0;
    let gg = sample.data[i + 1] ?? 0;
    let bb = sample.data[i + 2] ?? 0;
    if (hasClarity) {
      [rr, gg, bb] = applyToneAdjustmentsLinearRgb(rr, gg, bb, adjustment);
      const x = pixel % sample.width;
      const y = Math.floor(pixel / sample.width);
      const sourceX = clarityTransform
        ? clarityTransform.originX + x * clarityTransform.columnStepX + y * clarityTransform.rowStepX
        : sourceRect.x + (x + 0.5) * sourceRect.w / sample.width;
      const sourceY = clarityTransform
        ? clarityTransform.originY + x * clarityTransform.columnStepY + y * clarityTransform.rowStepY
        : sourceRect.y + (y + 0.5) * sourceRect.h / sample.height;
      const clarityGain = sampleImageEditClarityGain(
        activeClarityMap,
        sourceX,
        sourceY,
        decoded.width,
        decoded.height,
      );
      rr = Math.max(0, rr * clarityGain);
      gg = Math.max(0, gg * clarityGain);
      bb = Math.max(0, bb * clarityGain);
      if (activeClarityMap.strength > 0 && clarityRolloffOutput && clarityRolloffProPhoto) {
        applyPositiveImageEditClarityOutputRolloffInto(
          rr,
          gg,
          bb,
          "srgb",
          clarityRolloffOutput,
          clarityRolloffProPhoto,
        );
        rr = clarityRolloffProPhoto[0];
        gg = clarityRolloffProPhoto[1];
        bb = clarityRolloffProPhoto[2];
      }
      [rr, gg, bb] = applyColorAdjustmentsAfterToneLinearRgb(rr, gg, bb, adjustment);
    } else {
      [rr, gg, bb] = applyColorAdjustmentsLinearRgb(rr, gg, bb, adjustment);
    }
    const sr = clamp01(PROPHOTO_TO_SRGB_M00 * rr + PROPHOTO_TO_SRGB_M01 * gg + PROPHOTO_TO_SRGB_M02 * bb);
    const sg = clamp01(PROPHOTO_TO_SRGB_M10 * rr + PROPHOTO_TO_SRGB_M11 * gg + PROPHOTO_TO_SRGB_M12 * bb);
    const sb = clamp01(PROPHOTO_TO_SRGB_M20 * rr + PROPHOTO_TO_SRGB_M21 * gg + PROPHOTO_TO_SRGB_M22 * bb);
    const yy = clamp01(0.2126 * sr + 0.7152 * sg + 0.0722 * sb);
    const dr = histogramDisplayValue(sr);
    const dg = histogramDisplayValue(sg);
    const db = histogramDisplayValue(sb);
    const dy = histogramDisplayValue(yy);
    addHistogramInterval(r, dr, dr, areaWeight);
    addHistogramInterval(g, dg, dg, areaWeight);
    addHistogramInterval(b, db, db, areaWeight);
    addHistogramInterval(luma, dy, dy, areaWeight);
  }
  let maxCount = 0;
  for (let i = 0; i < HISTOGRAM_BINS; i++) {
    maxCount = Math.max(maxCount, r[i] ?? 0, g[i] ?? 0, b[i] ?? 0, luma[i] ?? 0);
  }
  return { r, g, b, luma, maxCount };
}

export function createToneAutoSampleFromRgb16(
  decoded: DecodedRgbImage16,
  sourceRect: { x: number; y: number; w: number; h: number },
  rotationDegrees: number,
): ToneAutoSample | null {
  const sample = getAnalysisLinearRgbSample(decoded, sourceRect, rotationDegrees);
  return sample.data.length ? sample : null;
}

export const HISTOGRAM_BINS = 256;

export function histogramDisplayValue(linear: number): number {
  return Math.pow(clamp01(linear), 1 / HISTOGRAM_DISPLAY_GAMMA);
}

export function addHistogramInterval(
  output: number[],
  lo: number,
  hi: number,
  weight: number,
) {
  if (weight <= 0) return;
  const displayLo = clamp01(Math.min(lo, hi));
  const displayHi = clamp01(Math.max(lo, hi));
  const width = displayHi - displayLo;
  if (width <= 1e-12) {
    const bin = Math.min(
      HISTOGRAM_BINS - 1,
      Math.max(0, Math.floor(displayLo * HISTOGRAM_BINS)),
    );
    output[bin] += weight;
    return;
  }

  const firstBin = Math.min(
    HISTOGRAM_BINS - 1,
    Math.max(0, Math.floor(displayLo * HISTOGRAM_BINS)),
  );
  const lastBin = Math.min(
    HISTOGRAM_BINS - 1,
    Math.max(0, Math.ceil(displayHi * HISTOGRAM_BINS) - 1),
  );
  for (let bin = firstBin; bin <= lastBin; bin++) {
    const binLo = bin / HISTOGRAM_BINS;
    const binHi = (bin + 1) / HISTOGRAM_BINS;
    const overlap = Math.min(displayHi, binHi) - Math.max(displayLo, binLo);
    if (overlap > 0) output[bin] += weight * overlap / width;
  }
}

export const TONE_AUTO_EXPOSURE_CLIP_PENALTY = 50;
export const TONE_AUTO_EXPOSURE_HIGHLIGHT_START = 0.95;
export const TONE_AUTO_EXPOSURE_HIGHLIGHT_PENALTY = 1;
export const TONE_AUTO_LOG_MIN = -3;
export const TONE_AUTO_LOG_MAX = 3;
export const TONE_AUTO_LOG_LOWER = 0.42;
export const TONE_AUTO_LOG_UPPER = 0.58;
export const TONE_AUTO_SIGMOID_MAX = 3;
export const TONE_AUTO_SIGMOID_BLACK_THRESHOLD = 0.05;
export const TONE_AUTO_SIGMOID_WHITE_THRESHOLD = 0.95;
export const TONE_AUTO_SIGMOID_BLACK_PENALTY = 2;
export const TONE_AUTO_SIGMOID_WHITE_PENALTY = 2;

export function toneHistogramPercentile(histogram: Float64Array, total: number, percentile: number): number {
  if (total <= 0) return 0;
  const target = clamp01(percentile) * total;
  let cumulative = 0;
  for (let bin = 0; bin < histogram.length; bin++) {
    const count = histogram[bin];
    const next = cumulative + count;
    if (target <= next || bin === histogram.length - 1) {
      const fraction = count > 0 ? clamp01((target - cumulative) / count) : 0.5;
      return clamp01((bin + fraction) / histogram.length);
    }
    cumulative = next;
  }
  return 1;
}

export function toneHistogramTrimmedMean(
  histogram: Float64Array,
  total: number,
  lowerFraction = 0.25,
  upperFraction = 0.75,
): number {
  if (total <= 0) return 0.5;
  const lower = clamp01(lowerFraction) * total;
  const upper = clamp01(upperFraction) * total;
  if (upper <= lower) return 0.5;
  let cumulative = 0;
  let weightedSum = 0;
  let included = 0;
  for (let bin = 0; bin < histogram.length; bin++) {
    const count = histogram[bin];
    const next = cumulative + count;
    const overlap = Math.max(0, Math.min(next, upper) - Math.max(cumulative, lower));
    if (overlap > 0) {
      weightedSum += overlap * ((bin + 0.5) / histogram.length);
      included += overlap;
    }
    cumulative = next;
    if (cumulative >= upper) break;
  }
  return included > 0 ? weightedSum / included : 0.5;
}

export function toneHistogramTailFraction(
  histogram: Float64Array,
  total: number,
  lowerExclusive: number,
  upperInclusive: number,
): number {
  if (total <= 0) return 0;
  let count = 0;
  for (let bin = 0; bin < histogram.length; bin++) {
    const center = (bin + 0.5) / histogram.length;
    if (center < lowerExclusive || center > upperInclusive) {
      count += histogram[bin];
    }
  }
  return count / total;
}

export function buildToneLumaHistogram(
  sample: ToneAutoSample,
  temperature: number,
  tint: number,
  exposureEv: number,
  scaledLog: number,
  sigmoid: number,
): { histogram: Float64Array; total: number } {
  const histogram = new Float64Array(HISTOGRAM_BINS);
  const context = buildColorAdjustmentContextFromLinearRgbSample(
    { data: sample.data, width: sample.width, height: sample.height, valid: sample.valid },
    temperature,
    tint,
    exposureEv,
    0,
    0,
    scaledLog,
    sigmoid,
    0,
    0,
    true,
  );
  let total = 0;
  const pixelCount = Math.floor(sample.data.length / 3);
  for (let pixel = 0; pixel < pixelCount; pixel++) {
    if (sample.valid && !sample.valid[pixel]) continue;
    const i = pixel * 3;
    let r = sample.data[i] ?? 0;
    let g = sample.data[i + 1] ?? 0;
    let b = sample.data[i + 2] ?? 0;
    [r, g, b] = applyToneLinearToRgb(
      r,
      g,
      b,
      context.gains,
      context.hasWhiteBalance,
      context.factor,
      context.shadow,
      context.highlight,
      context.highlightRange,
      context.rolloff,
      context.scaledLog,
      context.sigmoid,
      context,
    );
    const y = clamp01(PROPHOTO_LUMA_R * r + PROPHOTO_LUMA_G * g + PROPHOTO_LUMA_B * b);
    const display = histogramDisplayValue(y);
    const bin = Math.min(HISTOGRAM_BINS - 1, Math.max(0, Math.floor(display * HISTOGRAM_BINS)));
    histogram[bin] += 1;
    total += 1;
  }
  return { histogram, total };
}

export function evaluateAutoExposure(
  sample: ToneAutoSample,
  temperature: number,
  tint: number,
  exposureEv: number,
): { richness: number; clipRate: number; highlightPressure: number } {
  const histogram = new Float64Array(HISTOGRAM_BINS);
  let total = 0;
  let clipped = 0;
  let highlightPressure = 0;
  const context = buildColorAdjustmentContextFromLinearRgbSample(
    { data: sample.data, width: sample.width, height: sample.height, valid: sample.valid },
    temperature,
    tint,
    exposureEv,
    0,
    0,
    0,
    0,
    0,
    0,
    true,
  );
  const pixelCount = Math.floor(sample.data.length / 3);
  for (let pixel = 0; pixel < pixelCount; pixel++) {
    if (sample.valid && !sample.valid[pixel]) continue;
    const i = pixel * 3;
    let r = sample.data[i] ?? 0;
    let g = sample.data[i + 1] ?? 0;
    let b = sample.data[i + 2] ?? 0;
    if (context.hasWhiteBalance) {
      [r, g, b] = applyWhiteBalanceLinear(r, g, b, context.gains);
    }
    if (context.hasExposure) {
      r *= context.factor;
      g *= context.factor;
      b *= context.factor;
    }
    const maxChannel = Math.max(r, g, b);
    if (maxChannel >= 1) clipped += 1;
    if (maxChannel > TONE_AUTO_EXPOSURE_HIGHLIGHT_START) {
      const pressure = clamp01(
        (Math.min(maxChannel, 1) - TONE_AUTO_EXPOSURE_HIGHLIGHT_START) /
          (1 - TONE_AUTO_EXPOSURE_HIGHLIGHT_START),
      );
      highlightPressure += pressure * pressure;
    }
    const y = clamp01(
      PROPHOTO_LUMA_R * clamp01(r) +
      PROPHOTO_LUMA_G * clamp01(g) +
      PROPHOTO_LUMA_B * clamp01(b),
    );
    const display = histogramDisplayValue(y);
    const bin = Math.min(HISTOGRAM_BINS - 1, Math.max(0, Math.floor(display * HISTOGRAM_BINS)));
    histogram[bin] += 1;
    total += 1;
  }
  if (total <= 0) return { richness: 0, clipRate: 0, highlightPressure: 0 };

  let entropy = 0;
  for (let bin = 0; bin < histogram.length; bin++) {
    const count = histogram[bin];
    if (count <= 0) continue;
    const p = count / total;
    entropy -= p * Math.log(p);
  }
  const normalizedEntropy = entropy / Math.log(HISTOGRAM_BINS);
  const p2 = toneHistogramPercentile(histogram, total, 0.02);
  const p98 = toneHistogramPercentile(histogram, total, 0.98);
  return {
    richness: normalizedEntropy * Math.max(0, p98 - p2),
    clipRate: clipped / total,
    highlightPressure: highlightPressure / total,
  };
}

export function findAutoExposure(
  sample: ToneAutoSample,
  temperature: number,
  tint: number,
): number {
  const baseline = evaluateAutoExposure(sample, temperature, tint, 0);
  const baselineClip = baseline.clipRate;
  const baselineHighlightPressure = baseline.highlightPressure;
  let bestEv = 0;
  let bestScore = -Infinity;
  for (let step = -30; step <= 30; step++) {
    const ev = step / 10;
    const evaluation = evaluateAutoExposure(sample, temperature, tint, ev);
    const newClip = Math.max(0, evaluation.clipRate - baselineClip);
    const newHighlightPressure = Math.max(
      0,
      evaluation.highlightPressure - baselineHighlightPressure,
    );
    const score =
      evaluation.richness -
      TONE_AUTO_EXPOSURE_CLIP_PENALTY * newClip -
      TONE_AUTO_EXPOSURE_HIGHLIGHT_PENALTY * newHighlightPressure;
    if (
      score > bestScore + 1e-12 ||
      (Math.abs(score - bestScore) <= 1e-12 && Math.abs(ev) < Math.abs(bestEv))
    ) {
      bestScore = score;
      bestEv = ev;
    }
  }
  return clampExposureEv(bestEv);
}

export function findAutoLogarithm(
  sample: ToneAutoSample,
  temperature: number,
  tint: number,
  exposureEv: number,
): number {
  const initial = buildToneLumaHistogram(sample, temperature, tint, exposureEv, 0, 0);
  const initialMean = toneHistogramTrimmedMean(initial.histogram, initial.total);
  if (initialMean >= TONE_AUTO_LOG_LOWER && initialMean <= TONE_AUTO_LOG_UPPER) return 0;

  if (initialMean < TONE_AUTO_LOG_LOWER) {
    for (let step = 1; step <= Math.round(TONE_AUTO_LOG_MAX * 10); step++) {
      const value = step / 10;
      const result = buildToneLumaHistogram(sample, temperature, tint, exposureEv, value, 0);
      if (toneHistogramTrimmedMean(result.histogram, result.total) >= TONE_AUTO_LOG_LOWER) {
        return clampScaledLog(value);
      }
    }
    return clampScaledLog(TONE_AUTO_LOG_MAX);
  }

  for (let step = 1; step <= Math.round(Math.abs(TONE_AUTO_LOG_MIN) * 10); step++) {
    const value = -step / 10;
    const result = buildToneLumaHistogram(sample, temperature, tint, exposureEv, value, 0);
    if (toneHistogramTrimmedMean(result.histogram, result.total) <= TONE_AUTO_LOG_UPPER) {
      return clampScaledLog(value);
    }
  }
  return clampScaledLog(TONE_AUTO_LOG_MIN);
}

export function findAutoSigmoid(
  sample: ToneAutoSample,
  temperature: number,
  tint: number,
  exposureEv: number,
  scaledLog: number,
): number {
  const baseline = buildToneLumaHistogram(
    sample,
    temperature,
    tint,
    exposureEv,
    scaledLog,
    0,
  );
  const baselineBlack = toneHistogramTailFraction(
    baseline.histogram,
    baseline.total,
    TONE_AUTO_SIGMOID_BLACK_THRESHOLD,
    1,
  );
  const baselineWhite = toneHistogramTailFraction(
    baseline.histogram,
    baseline.total,
    0,
    TONE_AUTO_SIGMOID_WHITE_THRESHOLD,
  );

  let bestValue = 0;
  let bestScore = -Infinity;

  for (
    let step = -Math.round(TONE_AUTO_SIGMOID_MAX * 10);
    step <= Math.round(TONE_AUTO_SIGMOID_MAX * 10);
    step++
  ) {
    const value = step / 10;
    const result = buildToneLumaHistogram(
      sample,
      temperature,
      tint,
      exposureEv,
      scaledLog,
      value,
    );
    if (result.total <= 0) continue;

    let entropy = 0;
    for (let bin = 0; bin < result.histogram.length; bin++) {
      const count = result.histogram[bin];
      if (count <= 0) continue;
      const p = count / result.total;
      entropy -= p * Math.log(p);
    }
    const normalizedEntropy = entropy / Math.log(HISTOGRAM_BINS);
    const blackFraction = toneHistogramTailFraction(
      result.histogram,
      result.total,
      TONE_AUTO_SIGMOID_BLACK_THRESHOLD,
      1,
    );
    const whiteFraction = toneHistogramTailFraction(
      result.histogram,
      result.total,
      0,
      TONE_AUTO_SIGMOID_WHITE_THRESHOLD,
    );
    const newBlack = Math.max(0, blackFraction - baselineBlack);
    const newWhite = Math.max(0, whiteFraction - baselineWhite);
    const score =
      normalizedEntropy -
      TONE_AUTO_SIGMOID_BLACK_PENALTY * newBlack -
      TONE_AUTO_SIGMOID_WHITE_PENALTY * newWhite;

    if (
      score > bestScore + 1e-12 ||
      (Math.abs(score - bestScore) <= 1e-12 && Math.abs(value) < Math.abs(bestValue))
    ) {
      bestScore = score;
      bestValue = value;
    }
  }

  return clampSigmoid(bestValue);
}
