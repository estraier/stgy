import { applyUnitScaledSigmoid, createUnitScaledSigmoid } from "./scaled-sigmoid";

// Production STF gate: RGB-relative Sobel, 16MP / 0.5MP, P3/P97 normalized once.
export const STF_ADDITIONAL_BLUR_FINE_REFERENCE_PIXELS = 16_000_000;
export const STF_ADDITIONAL_BLUR_COARSE_REFERENCE_PIXELS = 500_000;
export const STF_ADDITIONAL_BLUR_MAX_WORKERS = 4;
export const STF_ADDITIONAL_BLUR_SAMPLE_LIMIT = 65_536;
export const STF_RELATIVE_BRIGHTNESS_P50_DIVISOR = 64;
export const STF_SHARPNESS_RATIO_P50_DIVISOR = 64;
export const STF_SHARPNESS_RATIO_V2_P50_DIVISOR = 32;
export const STF_SHARPNESS_RATIO_X12 = 1.2;
export const STF_SHARPNESS_RATIO_X13 = 1.3;
export const STF_SHARPNESS_RATIO_X14 = 1.4;
export const STF_SHARPNESS_RATIO_X15 = 1.5;
export const STF_SHARPNESS_RATIO_X16 = 1.6;
export const STF_SHARPNESS_RATIO_X20 = 2.0;
export const STF_SHARPNESS_DILATED_PERCENTILE = 0.8;
const SHARPNESS_RGB_WEIGHTS = [0.3, 0.4, 0.3] as const;
const LOG_FLOOR = 1e-12;
const BLUR_MIN_RADIUS = 2;
const BLUR_MAX_RADIUS = 15;
const GATE_SEED_THRESHOLD = 0.7;
const GATE_EXPANSION_RADIUS_FACTOR = 0.5;
const GATE_EXPANSION_SIGMA_FACTOR = 0.2;
export const STF_LOG_RATIO_NORMALIZATION_LOWER_PERCENTILE = 0.03;
export const STF_LOG_RATIO_NORMALIZATION_UPPER_PERCENTILE = 0.97;

export type StfSharpnessScratch = { a: Float32Array; b: Float32Array; c: Float32Array };
export type StfRelativeChannelFloors = [number, number, number];
export type StfSampleGrid = { stride: number; offsetX: number; offsetY: number };
export type StfLogRatioNormalizationPlan = {
  lowerPercentile: number; upperPercentile: number; lowerValue: number;
  upperValue: number; range: number; finiteCount: number; degenerate: boolean;
};
export type StfSigmoidPlan = {
  sharpFraction: number; thresholdPercentile: number; lowerPercentile: number;
  upperPercentile: number; threshold: number; lowerValue: number; upperValue: number;
  robustScale: number; strength: number;
};

export function sameStfFNumber(a: number, b: number): boolean {
  if (!(Number.isFinite(a) && Number.isFinite(b) && a > 0 && b > 0)) return false;
  const scale = Math.max(1, Math.abs(a), Math.abs(b));
  return Math.abs(a - b) <= scale * 1e-6;
}

export function buildStfApertureGroups(fNumbers: ArrayLike<number>): {
  imageGroupIndexes: Int32Array;
  groupImageCounts: Int32Array;
} {
  const entries: Array<{ index: number; fNumber: number }> = [];
  for (let index = 0; index < fNumbers.length; index += 1) {
    const fNumber = Number(fNumbers[index]);
    if (!(Number.isFinite(fNumber) && fNumber > 0)) {
      throw new Error("STF Additional blur requires valid F-numbers for every input image.");
    }
    entries.push({ index, fNumber });
  }
  if (entries.length < 2) throw new Error("STF Additional blur requires at least two input images.");
  entries.sort((left, right) => left.fNumber - right.fNumber || left.index - right.index);

  const indexes = new Int32Array(entries.length);
  indexes.fill(-1);
  const counts: number[] = [];
  let position = 0;
  let groupIndex = 0;
  while (position < entries.length) {
    const groupFNumber = entries[position].fNumber;
    let count = 0;
    while (position < entries.length && sameStfFNumber(entries[position].fNumber, groupFNumber)) {
      indexes[entries[position].index] = groupIndex;
      count += 1;
      position += 1;
    }
    counts.push(count);
    groupIndex += 1;
  }
  if (counts.length < 2) throw new Error("STF Additional blur requires at least two distinct F-numbers.");
  return { imageGroupIndexes: indexes, groupImageCounts: Int32Array.from(counts) };
}

export function resolveStfSharpnessScale(width: number, height: number, referencePixels: number): number {
  const pixels = Math.max(1, width * height);
  if (!(Number.isFinite(referencePixels) && referencePixels > 0)) {
    throw new Error("STF Additional blur sharpness reference size is invalid.");
  }
  return Math.sqrt(pixels / referencePixels);
}

export function resolveStfSharpnessHalo(scale: number): number {
  const safeScale = Number.isFinite(scale) && scale > 0 ? scale : 1;
  return Math.max(2, 2 * Math.ceil(safeScale));
}

export function createStfSharpnessScratch(pixelCount: number): StfSharpnessScratch {
  const length = Math.max(0, Math.floor(pixelCount));
  return {
    a: new Float32Array(length),
    b: new Float32Array(length),
    c: new Float32Array(length),
  };
}

export function buildStfRelativeSharpnessMapAtScaleInto(
  linear: Float32Array, width: number, height: number, scale: number,
  output: Float32Array, scratch: StfSharpnessScratch, floors: StfRelativeChannelFloors,
): void {
  validateStfRelativeChannelFloors(floors);
  buildStfSharpnessMapAtScaleInternal(linear, width, height, scale, output, scratch, floors);
}

export function deriveStfRelativeChannelFloorsFromSamples(
  samples: readonly [ArrayLike<number>, ArrayLike<number>, ArrayLike<number>],
): StfRelativeChannelFloors {
  return samples.map((values) => {
    const sorted: number[] = [];
    for (let i = 0; i < values.length; i += 1) {
      const value = Number(values[i]);
      if (Number.isFinite(value)) sorted.push(Math.max(0, value));
    }
    if (sorted.length === 0) throw new Error("STF production requires finite RGB brightness samples.");
    sorted.sort((a, b) => a - b);
    return Math.max(LOG_FLOOR, percentileFromSorted(sorted, 0.5) / STF_RELATIVE_BRIGHTNESS_P50_DIVISOR);
  }) as StfRelativeChannelFloors;
}

export function validateStfRelativeChannelFloors(floors: readonly number[]): StfRelativeChannelFloors {
  if (floors.length !== 3 || !floors.every((value) => Number.isFinite(value) && value > 0)) {
    throw new Error("STF production RGB brightness floors are invalid.");
  }
  return [floors[0], floors[1], floors[2]];
}

function buildStfSharpnessMapAtScaleInternal(
  linear: Float32Array, width: number, height: number, scale: number,
  output: Float32Array, scratch: StfSharpnessScratch, floors: StfRelativeChannelFloors,
): void {
  const pixels = width * height;
  if (linear.length !== pixels * 3 || output.length !== pixels ||
      scratch.a.length !== pixels || scratch.b.length !== pixels || scratch.c.length !== pixels) {
    throw new Error("STF sharpness buffer geometry is invalid.");
  }
  if (!(Number.isFinite(scale) && scale > 0)) throw new Error("STF Sobel scale is invalid.");
  output.fill(0);
  for (let channel = 0; channel < 3; channel++) {
    for (let pixel = 0, i = channel; pixel < pixels; pixel++, i += 3) scratch.a[pixel] = linear[i];
    binomialBlurHorizontalScaledInto(scratch.a, width, height, scale, scratch.b);
    binomialBlurVerticalScaledInto(scratch.b, width, height, scale, scratch.c);
    binomialBlurVerticalScaledInto(scratch.c, width, height, scale, scratch.a);
    binomialBlurHorizontalScaledInto(scratch.c, width, height, scale, scratch.b);
    accumulateSobelMagnitudeScaledInto(
      scratch.a, scratch.b, width, height, scale,
      SHARPNESS_RGB_WEIGHTS[channel], output, floors[channel],
    );
  }
  for (let pixel = 0; pixel < pixels; pixel++) output[pixel] = Math.fround(Math.sqrt(Math.max(0, output[pixel])));
}

export function buildStfSampleGrid(width: number, height: number, target = STF_ADDITIONAL_BLUR_SAMPLE_LIMIT): StfSampleGrid {
  const pixelCount = Math.max(1, width * height);
  const safeTarget = Number.isFinite(target) && target > 0 ? Math.floor(target) : STF_ADDITIONAL_BLUR_SAMPLE_LIMIT;
  const stride = Math.max(1, Math.ceil(Math.sqrt(pixelCount / safeTarget)));
  return {
    stride,
    offsetX: Math.min(Math.max(0, width - 1), Math.floor(stride / 2)),
    offsetY: Math.min(Math.max(0, height - 1), Math.floor(stride / 2)),
  };
}

export function appendPersistentCoarseSamplesFromStripe(
  target: number[],
  packedGroups: Float32Array,
  groupCount: number,
  width: number,
  stripeY: number,
  stripeHeight: number,
  grid: StfSampleGrid,
): void {
  const stripePixels = width * stripeHeight;
  if (packedGroups.length !== stripePixels * groupCount) {
    throw new Error("STF Additional blur coarse-group buffer has an invalid size.");
  }
  const firstSampleY = firstGridCoordinateAtOrAfter(stripeY, grid.offsetY, grid.stride);
  const stripeEnd = stripeY + stripeHeight;
  for (let y = firstSampleY; y < stripeEnd; y += grid.stride) {
    const localY = y - stripeY;
    for (let x = grid.offsetX; x < width; x += grid.stride) {
      const localPixel = localY * width + x;
      let logSum = 0;
      let valid = true;
      for (let group = 0; group < groupCount; group += 1) {
        const value = packedGroups[group * stripePixels + localPixel] ?? 0;
        if (!(Number.isFinite(value) && value > 0)) {
          valid = false;
          break;
        }
        logSum += Math.log(value);
      }
      if (valid) target.push(Math.exp(logSum / groupCount));
    }
  }
}

export function buildStfLogRatioNormalizationPlan(
  rawSamples: ArrayLike<number>,
  lowerPercentile = STF_LOG_RATIO_NORMALIZATION_LOWER_PERCENTILE,
  upperPercentile = STF_LOG_RATIO_NORMALIZATION_UPPER_PERCENTILE,
): StfLogRatioNormalizationPlan {
  if (!(Number.isFinite(lowerPercentile) && Number.isFinite(upperPercentile)
    && lowerPercentile >= 0 && upperPercentile <= 1 && lowerPercentile < upperPercentile)) {
    throw new Error("STF log-ratio normalization percentiles are invalid.");
  }
  // The input is a full-resolution spatial map.  Keep the original untouched:
  // quickselect permutes its workspace, while the next stage still needs every
  // log-ratio at its original pixel position.
  // A typed workspace avoids materializing tens of millions of boxed numbers.
  // Float32 input stays Float32 so that percentile interpolation is identical
  // to sorting the original numbers; other inputs retain Float64 precision.
  const finite: Float32Array | Float64Array = rawSamples instanceof Float32Array
    ? new Float32Array(rawSamples.length)
    : new Float64Array(rawSamples.length);
  let finiteCount = 0;
  for (let index = 0; index < rawSamples.length; index += 1) {
    const value = Number(rawSamples[index]);
    if (Number.isFinite(value)) finite[finiteCount++] = value;
    else if (!Number.isNaN(value)) throw new Error("STF log-ratio contains an unexpected infinity.");
  }
  if (finiteCount === 0) {
    return {
      lowerPercentile, upperPercentile,
      lowerValue: 0, upperValue: 1, range: 1, finiteCount: 0, degenerate: true,
    };
  }
  // Select the two order statistics, not a complete O(N log N) ordering.
  // The percentile definition is unchanged: linear interpolation at q * (N-1).
  const lowerPosition = lowerPercentile * (finiteCount - 1);
  const upperPosition = upperPercentile * (finiteCount - 1);
  const lowerIndex = Math.floor(lowerPosition);
  const upperIndex = Math.floor(upperPosition);
  const lowerBase = selectStfOrderStatistic(finite, 0, finiteCount - 1, lowerIndex);
  const upperBase = upperIndex === lowerIndex
    ? lowerBase
    : selectStfOrderStatistic(finite, lowerIndex + 1, finiteCount - 1, upperIndex);
  const lowerFraction = lowerPosition - lowerIndex;
  const upperFraction = upperPosition - upperIndex;
  const lowerNext = lowerIndex + 1 < finiteCount
    ? smallestStfValueAfter(finite, lowerIndex, finiteCount) : lowerBase;
  const upperNext = upperIndex + 1 < finiteCount
    ? smallestStfValueAfter(finite, upperIndex, finiteCount) : upperBase;
  const lowerValue = lowerBase + (lowerNext - lowerBase) * lowerFraction;
  const upperValue = upperBase + (upperNext - upperBase) * upperFraction;
  const range = upperValue - lowerValue;
  const degenerate = !(range > 1e-12);

  return {
    lowerPercentile, upperPercentile,
    lowerValue, upperValue, range: degenerate ? 1 : range, finiteCount, degenerate,
  };
}

// Percentile-normalized [0,1] mapping for raw log-ratios.
// P3 maps to 0, P97 maps to 1, and outliers are clipped.
export function normalizeStfLogRatioValue(value: number, plan: StfLogRatioNormalizationPlan): number {
  if (!Number.isFinite(value)) {
    if (Number.isNaN(value)) return 0; // zero fine-sharpness: no protection evidence
    throw new Error("STF log-ratio contains an unexpected infinity.");
  }
  if (plan.degenerate) return 0.5;
  return clampUnit((value - plan.lowerValue) / plan.range);
}

export function normalizeStfLogRatioBufferInPlace(values: Float32Array): StfLogRatioNormalizationPlan {
  const plan = buildStfLogRatioNormalizationPlan(values);
  for (let index = 0; index < values.length; index += 1) {
    values[index] = normalizeStfLogRatioValue(values[index], plan);
  }
  return plan;
}

export function deriveStfMedianSharpnessC(rawSamples: ArrayLike<number>): number {
  const sorted: number[] = [];
  for (let index = 0; index < rawSamples.length; index += 1) {
    const value = Number(rawSamples[index]);
    if (Number.isFinite(value) && value > 0) sorted.push(value);
  }
  if (sorted.length === 0) return LOG_FLOOR;
  sorted.sort((a, b) => a - b);
  return Math.max(LOG_FLOOR, percentileFromSorted(sorted, 0.5));
}

export function deriveStfRatioEpsilon(c: number, divisor = STF_SHARPNESS_RATIO_P50_DIVISOR): number {
  const value = Number(c);
  if (!(Number.isFinite(value) && value > 0)) throw new Error("STF Additional blur dynamic c is invalid.");
  if (!(Number.isFinite(divisor) && divisor > 0)) throw new Error("STF Additional blur ratio epsilon divisor is invalid.");
  return Math.max(LOG_FLOOR, value / divisor);
}

/**
 * Ratio calculated from the dilated fine map and the unchanged coarse map.
 * Written directly into the caller's output buffer to avoid a full-resolution
 * allocation for diagnostic and production v2/v3 pipelines.
 */
export function buildStfDilatedLogRatioInto(
  dilatedFine: Float32Array, coarse: Float32Array,
  epsilon: number, fineExponent: number, output: Float32Array,
): void {
  if (dilatedFine.length !== coarse.length || output.length !== dilatedFine.length ||
      !(Number.isFinite(epsilon) && epsilon > 0 && Number.isFinite(fineExponent) && fineExponent > 0)) {
    throw new Error("STF dilated sharpness ratio parameters are invalid.");
  }
  for (let i = 0; i < output.length; i += 1) {
    const fineValue = dilatedFine[i];
    const coarseValue = coarse[i];
    output[i] = fineValue > 0
      ? Math.log(fineValue) * fineExponent - Math.log(Math.max(epsilon, coarseValue + epsilon))
      : Number.NaN;
  }
}

export function buildStfFineGeometricMeanFromDerived(
  fineLogSum: Float32Array,
  fineZero: Uint8Array,
  groupCount: number,
): Float32Array {
  const pixelCount = fineLogSum.length;
  if (fineZero.length !== pixelCount || !(Number.isInteger(groupCount) && groupCount >= 2)) {
    throw new Error("STF Additional blur fine sharpness parameters are invalid.");
  }
  const output = new Float32Array(pixelCount);
  for (let pixel = 0; pixel < pixelCount; pixel += 1) {
    output[pixel] = fineZero[pixel] ? 0 : Math.exp(fineLogSum[pixel] / groupCount);
  }
  return output;
}

export function buildStfCoarseGeometricMeanFromDerived(
  coarseGroups: Float32Array,
  groupCount: number,
): Float32Array {
  const pixelCount = Math.floor(coarseGroups.length / groupCount);
  if (coarseGroups.length !== pixelCount * groupCount || !(Number.isInteger(groupCount) && groupCount >= 2)) {
    throw new Error("STF Additional blur coarse sharpness parameters are invalid.");
  }
  const output = new Float32Array(pixelCount);
  for (let pixel = 0; pixel < pixelCount; pixel += 1) {
    let logSum = 0;
    let valid = true;
    for (let group = 0; group < groupCount; group += 1) {
      const coarse = coarseGroups[group * pixelCount + pixel] ?? 0;
      if (!(Number.isFinite(coarse) && coarse > 0)) {
        valid = false;
        break;
      }
      logSum += Math.log(coarse);
    }
    output[pixel] = valid ? Math.exp(logSum / groupCount) : 0;
  }
  return output;
}

export function resolveStfDilatedFineRadius(width: number, height: number): number {
  const fineScale = resolveStfSharpnessScale(width, height, STF_ADDITIONAL_BLUR_FINE_REFERENCE_PIXELS);
  const coarseScale = resolveStfSharpnessScale(width, height, STF_ADDITIONAL_BLUR_COARSE_REFERENCE_PIXELS);
  return Math.max(1, Math.round(Math.max(0, coarseScale - fineScale)));
}

export function dilateStfSharpnessAbovePercentile(
  source: Float32Array,
  width: number,
  height: number,
  thresholdPercentile = STF_SHARPNESS_DILATED_PERCENTILE,
  radius = 1,
): Float32Array {
  const pixels = width * height;
  if (source.length !== pixels) throw new Error("STF Additional blur dilated sharpness source has invalid size.");
  if (!(Number.isFinite(radius) && radius >= 1)) return source.slice();
  const finite: number[] = [];
  for (let i = 0; i < pixels; i += 1) {
    const value = source[i] ?? 0;
    if (Number.isFinite(value) && value > 0) finite.push(value);
  }
  if (finite.length === 0) return source.slice();
  finite.sort((a, b) => a - b);
  const threshold = percentileFromSorted(finite, thresholdPercentile);
  const seeded = new Float32Array(pixels);
  for (let i = 0; i < pixels; i += 1) {
    const value = source[i] ?? 0;
    seeded[i] = value >= threshold ? value : 0;
  }
  const expanded = dilateMaxSeparable(seeded, width, height, Math.floor(radius));
  for (let i = 0; i < pixels; i += 1) expanded[i] = Math.max(source[i] ?? 0, expanded[i] ?? 0);
  return expanded;
}

function dilateMaxSeparable(source: Float32Array, width: number, height: number, radius: number): Float32Array {
  const horizontal = new Float32Array(source.length);
  for (let y = 0; y < height; y += 1) {
    const row = y * width;
    for (let x = 0; x < width; x += 1) {
      let maximum = 0;
      const start = Math.max(0, x - radius);
      const end = Math.min(width - 1, x + radius);
      for (let xx = start; xx <= end; xx += 1) maximum = Math.max(maximum, source[row + xx] ?? 0);
      horizontal[row + x] = maximum;
    }
  }
  const output = new Float32Array(source.length);
  for (let x = 0; x < width; x += 1) {
    for (let y = 0; y < height; y += 1) {
      let maximum = 0;
      const start = Math.max(0, y - radius);
      const end = Math.min(height - 1, y + radius);
      for (let yy = start; yy <= end; yy += 1) maximum = Math.max(maximum, horizontal[yy * width + x] ?? 0);
      output[y * width + x] = maximum;
    }
  }
  return output;
}

export function buildStfLogRatioFromDerived(
  fineLogSum: Float32Array,
  fineZero: Uint8Array,
  coarseGroups: Float32Array,
  groupCount: number,
  epsilon: number,
  fineExponent = 1,
): Float32Array {
  const pixelCount = fineLogSum.length;
  if (fineZero.length !== pixelCount || coarseGroups.length !== pixelCount * groupCount) {
    throw new Error("STF Additional blur derived sharpness buffers have invalid sizes.");
  }
  if (!(Number.isInteger(groupCount) && groupCount >= 2 && Number.isFinite(epsilon) && epsilon > 0 &&
      Number.isFinite(fineExponent) && fineExponent > 0)) {
    throw new Error("STF Additional blur ratio parameters are invalid.");
  }
  const output = new Float32Array(pixelCount);
  for (let pixel = 0; pixel < pixelCount; pixel += 1) {
    if (fineZero[pixel]) {
      output[pixel] = Number.NaN;
      continue;
    }
    let coarseLogSum = 0;
    for (let group = 0; group < groupCount; group += 1) {
      const coarse = coarseGroups[group * pixelCount + pixel] ?? 0;
      coarseLogSum += Math.log(Math.max(epsilon, coarse + epsilon));
    }
    output[pixel] = (fineLogSum[pixel] * fineExponent) / groupCount - coarseLogSum / groupCount;
  }
  return output;
}

/**
 * Diagnostic display before P3/P97 normalization and Volume Closing.
 * Each map is the geometric mean of the per-aperture-group sharpness maps;
 * both ratio modes remain identical to the production log-ratio calculation
 * apart from the supplied epsilon floor.
 */
export function buildStfSharpnessDiagnosticLogFromDerived(
  fineLogSum: Float32Array, fineZero: Uint8Array, coarseGroups: Float32Array,
  groupCount: number, epsilon: number,
  visualization: "fine" | "coarse" | "ratio" | "ratio-v2" | "ratio-x1.2" | "ratio-x1.4" | "ratio-x1.5" | "ratio-x1.6" | "ratio-x2.0",
): Float32Array {
  if (visualization === "ratio" || visualization === "ratio-v2") {
    return buildStfLogRatioFromDerived(fineLogSum, fineZero, coarseGroups, groupCount, epsilon);
  }
  if (visualization === "ratio-x1.2") {
    return buildStfLogRatioFromDerived(fineLogSum, fineZero, coarseGroups, groupCount, epsilon, STF_SHARPNESS_RATIO_X12);
  }
  if (visualization === "ratio-x1.4") {
    return buildStfLogRatioFromDerived(fineLogSum, fineZero, coarseGroups, groupCount, epsilon, STF_SHARPNESS_RATIO_X14);
  }
  if (visualization === "ratio-x1.5") {
    return buildStfLogRatioFromDerived(fineLogSum, fineZero, coarseGroups, groupCount, epsilon, STF_SHARPNESS_RATIO_X15);
  }
  if (visualization === "ratio-x1.6") {
    return buildStfLogRatioFromDerived(fineLogSum, fineZero, coarseGroups, groupCount, epsilon, STF_SHARPNESS_RATIO_X16);
  }
  if (visualization === "ratio-x2.0") {
    return buildStfLogRatioFromDerived(fineLogSum, fineZero, coarseGroups, groupCount, epsilon, STF_SHARPNESS_RATIO_X20);
  }
  const pixelCount = fineLogSum.length;
  if ((visualization !== "fine" && visualization !== "coarse") ||
      fineZero.length !== pixelCount || coarseGroups.length !== pixelCount * groupCount ||
      !Number.isInteger(groupCount) || groupCount < 2) {
    throw new Error("STF diagnostic sharpness parameters are invalid.");
  }
  const output = new Float32Array(pixelCount);
  for (let pixel = 0; pixel < pixelCount; pixel += 1) {
    if (visualization === "fine") {
      output[pixel] = fineZero[pixel] ? Number.NaN : fineLogSum[pixel] / groupCount;
    } else {
      let logSum = 0;
      for (let group = 0; group < groupCount; group += 1) {
        const value = coarseGroups[group * pixelCount + pixel];
        if (!Number.isFinite(value) || value < 0) throw new Error("STF coarse sharpness is invalid.");
        logSum += Math.log(Math.max(LOG_FLOOR, value));
      }
      output[pixel] = logSum / groupCount;
    }
  }
  return output;
}

/** Determine the adaptive quantiles and steepness from unit-interval samples. */
export function buildStfSigmoidPlan(unitSamples: ArrayLike<number>, blurRatio: number): StfSigmoidPlan {
  const safeBokeh = Math.max(0.1, Math.min(0.9, Number.isFinite(blurRatio) ? blurRatio : 0.5));
  const sharpFraction = 1 - safeBokeh;
  const thresholdPercentile = safeBokeh;
  // Adopted asymmetric 20-percentage-point reference interval.
  const lowerPercentile = thresholdPercentile * 0.8;
  const upperPercentile = thresholdPercentile + (1 - thresholdPercentile) * 0.2;
  const finite = Array.from(unitSamples, Number);
  for (const value of finite) {
    if (!Number.isFinite(value) || value < 0 || value > 1) {
      throw new Error("STF sigmoid samples must be in [0,1].");
    }
  }
  if (finite.length < 2) {
    const threshold = finite[0] ?? 0;
    return {
      sharpFraction, thresholdPercentile, lowerPercentile, upperPercentile,
      threshold, lowerValue: threshold, upperValue: threshold,
      robustScale: 1, strength: 1,
    };
  }
  finite.sort((a, b) => a - b);
  const threshold = percentileFromSorted(finite, thresholdPercentile);
  const lowerValue = percentileFromSorted(finite, lowerPercentile);
  const upperValue = percentileFromSorted(finite, upperPercentile);
  let robustScale = percentileFromSorted(finite, 0.84) - percentileFromSorted(finite, 0.16);
  if (!(robustScale > 1e-12)) robustScale = percentileFromSorted(finite, 0.75) - percentileFromSorted(finite, 0.25);
  if (!(robustScale > 1e-12)) robustScale = (finite[finite.length - 1] ?? 0) - (finite[0] ?? 0);
  if (!(robustScale > 1e-12)) robustScale = 1;

  const lowerDistance = Math.max(0, threshold - lowerValue);
  const upperDistance = Math.max(0, upperValue - threshold);
  const logit08 = Math.log(4);
  let strength = 1;
  if (lowerDistance > 1e-12 && upperDistance > 1e-12) {
    strength = (2 * logit08 * robustScale) / (lowerDistance + upperDistance);
  } else if (lowerDistance > 1e-12) {
    strength = (logit08 * robustScale) / lowerDistance;
  } else if (upperDistance > 1e-12) {
    strength = (logit08 * robustScale) / upperDistance;
  }
  strength = Math.max(1, Math.min(10, Number.isFinite(strength) ? strength : 1));
  return { sharpFraction, thresholdPercentile, lowerPercentile, upperPercentile,
    threshold, lowerValue, upperValue, robustScale, strength };
}

/** Apply the same endpoint-normalized sigmoid to every unit gate, regardless of provenance. */
export function applyStfSigmoidGateInPlace(unitGate: Float32Array, width: number, height: number, blurRatio: number, strengthPercent: number): StfSigmoidPlan {
  if (!(Number.isFinite(strengthPercent) && strengthPercent > 0 && strengthPercent <= 100)) {
    throw new Error("STF Blur sigmoid must be in (0,100].");
  }
  if (unitGate.length !== width * height) throw new Error("STF Additional blur gate has an invalid size.");
  const grid = buildStfSampleGrid(width, height);
  const samples: number[] = [];
  for (let y = grid.offsetY; y < height; y += grid.stride) {
    const row = y * width;
    for (let x = grid.offsetX; x < width; x += grid.stride) {
      samples.push(unitGate[row + x]);
    }
  }
  if (samples.length < 2) {
    samples.push(unitGate[0]);
    samples.push(unitGate[Math.max(0, unitGate.length - 1)]);
  }
  const plan = buildStfSigmoidPlan(samples, blurRatio);
  // Clamp automatic strength to [1,10] first, then apply the specified percentage.
  const sigmoid = createUnitScaledSigmoid(plan.threshold, plan.robustScale,
    plan.strength * strengthPercent / 100);
  for (let index = 0; index < unitGate.length; index += 1) {
    unitGate[index] = applyUnitScaledSigmoid(unitGate[index], sigmoid);
  }
  return plan;
}

export function resolveStfAdditionalBlurRadius(
  width: number,
  height: number,
  strengthMultiplier: number,
): number {
  if (![1, 2, 3].includes(strengthMultiplier)) {
    throw new Error("STF Blur strength multiplier must be 1, 2, or 3.");
  }
  const scale = Math.sqrt(Math.max(1, width * height) / 1_000_000);
  return Math.max(BLUR_MIN_RADIUS, Math.min(BLUR_MAX_RADIUS, Math.round(strengthMultiplier * scale)));
}

export function applyStfGateExpansion(gate: Float32Array, width: number, height: number, blurRadius: number): Float32Array {
  if (gate.length !== width * height) throw new Error("STF Additional blur gate has an invalid size.");
  const radius = Math.max(1, Math.round(blurRadius * GATE_EXPANSION_RADIUS_FACTOR));
  const sigma = Math.max(0.75, blurRadius * GATE_EXPANSION_SIGMA_FACTOR);
  const weights = new Float32Array(radius + 1);
  for (let offset = 0; offset <= radius; offset += 1) {
    weights[offset] = Math.exp(-(offset * offset) / (2 * sigma * sigma));
  }
  const seed = new Float32Array(gate.length);
  const inverseRange = 1 / (1 - GATE_SEED_THRESHOLD);
  for (let index = 0; index < gate.length; index += 1) {
    const value = clampUnit(gate[index]);
    seed[index] = value > GATE_SEED_THRESHOLD ? (value - GATE_SEED_THRESHOLD) * inverseRange : 0;
  }
  const temp = new Float32Array(gate.length);
  const output = new Float32Array(gate.length);
  for (let y = 0; y < height; y += 1) {
    const row = y * width;
    for (let x = 0; x < width; x += 1) {
      let best = 0;
      for (let offset = -radius; offset <= radius; offset += 1) {
        const sampleX = x + offset;
        if (sampleX < 0 || sampleX >= width) continue;
        const value = seed[row + sampleX] * weights[Math.abs(offset)];
        if (value > best) best = value;
      }
      temp[row + x] = best;
    }
  }
  for (let y = 0; y < height; y += 1) {
    const row = y * width;
    for (let x = 0; x < width; x += 1) {
      let best = 0;
      for (let offset = -radius; offset <= radius; offset += 1) {
        const sampleY = y + offset;
        if (sampleY < 0 || sampleY >= height) continue;
        const value = temp[sampleY * width + x] * weights[Math.abs(offset)];
        if (value > best) best = value;
      }
      const original = clampUnit(gate[row + x]);
      output[row + x] = best > original ? best : original;
    }
  }
  return output;
}

export function applyGuardedGaussianBlurRegion(
  sourceLinearRgb: Float32Array,
  width: number,
  height: number,
  gate: Float32Array,
  radius: number,
  coreY: number,
  coreHeight: number,
): Float32Array {
  const pixelCount = width * height;
  if (sourceLinearRgb.length !== pixelCount * 3 || gate.length !== pixelCount) {
    throw new Error("STF Additional blur Gaussian buffers have invalid sizes.");
  }
  if (!(Number.isInteger(coreY) && coreY >= 0 && Number.isInteger(coreHeight) && coreHeight > 0 && coreY + coreHeight <= height)) {
    throw new Error("STF Additional blur Gaussian core region is invalid.");
  }
  const safeRadius = Math.max(0, Math.floor(radius));
  if (safeRadius === 0) {
    const output = new Float32Array(width * coreHeight * 3);
    output.set(sourceLinearRgb.subarray(coreY * width * 3, (coreY + coreHeight) * width * 3));
    return output;
  }
  const kernel = gaussianKernel(safeRadius);
  const clampedGate = new Float32Array(pixelCount);
  const eligible = new Float32Array(pixelCount);
  for (let index = 0; index < pixelCount; index += 1) {
    const preserve = clampUnit(gate[index]);
    clampedGate[index] = preserve;
    eligible[index] = 1 - preserve;
  }

  const horizontal = new Float32Array(pixelCount * 4);
  for (let y = 0; y < height; y += 1) {
    const row = y * width;
    for (let x = 0; x < width; x += 1) {
      let sumGate = 0, sumR = 0, sumG = 0, sumB = 0;
      for (let offset = -safeRadius; offset <= safeRadius; offset += 1) {
        const sampleX = Math.max(0, Math.min(width - 1, x + offset));
        const sample = row + sampleX;
        const weight = kernel[offset + safeRadius];
        const blurWeight = eligible[sample];
        const rgb = sample * 3;
        sumGate += clampedGate[sample] * weight;
        sumR += Math.fround(sourceLinearRgb[rgb] * blurWeight) * weight;
        sumG += Math.fround(sourceLinearRgb[rgb + 1] * blurWeight) * weight;
        sumB += Math.fround(sourceLinearRgb[rgb + 2] * blurWeight) * weight;
      }
      const target = (row + x) * 4;
      horizontal[target] = sumGate;
      horizontal[target + 1] = sumR;
      horizontal[target + 2] = sumG;
      horizontal[target + 3] = sumB;
    }
  }

  const output = new Float32Array(width * coreHeight * 3);
  for (let localY = 0; localY < coreHeight; localY += 1) {
    const y = coreY + localY;
    for (let x = 0; x < width; x += 1) {
      let sumGate = 0, sumR = 0, sumG = 0, sumB = 0;
      for (let offset = -safeRadius; offset <= safeRadius; offset += 1) {
        const sampleY = Math.max(0, Math.min(height - 1, y + offset));
        const source = (sampleY * width + x) * 4;
        const weight = kernel[offset + safeRadius];
        sumGate += horizontal[source] * weight;
        sumR += horizontal[source + 1] * weight;
        sumG += horizontal[source + 2] * weight;
        sumB += horizontal[source + 3] * weight;
      }
      const pixel = y * width + x;
      const sourceRgb = pixel * 3;
      const targetRgb = (localY * width + x) * 3;
      const preserve = clampedGate[pixel];
      const blurAmount = 1 - preserve;
      const rejected = Math.fround(sumGate);
      const sourceR = sourceLinearRgb[sourceRgb];
      const sourceG = sourceLinearRgb[sourceRgb + 1];
      const sourceB = sourceLinearRgb[sourceRgb + 2];
      const guardedR = Math.fround(sumR) + sourceR * rejected;
      const guardedG = Math.fround(sumG) + sourceG * rejected;
      const guardedB = Math.fround(sumB) + sourceB * rejected;
      output[targetRgb] = sourceR * preserve + guardedR * blurAmount;
      output[targetRgb + 1] = sourceG * preserve + guardedG * blurAmount;
      output[targetRgb + 2] = sourceB * preserve + guardedB * blurAmount;
    }
  }
  return output;
}

function firstGridCoordinateAtOrAfter(value: number, offset: number, stride: number): number {
  if (value <= offset) return offset;
  return offset + Math.ceil((value - offset) / stride) * stride;
}

/**
 * Select a sorted rank within [left, right], permuting only the workspace.
 * 3-way partitioning makes large flat/quantized regions cheap.  The bounded
 * fallback protects against unusual adversarial pivot sequences without
 * ever sorting the entire image in the normal case.
 */
function selectStfOrderStatistic(
  values: Float32Array | Float64Array, left: number, right: number, rank: number,
): number {
  let remainingDepth = Math.max(4, 2 * Math.ceil(Math.log2(right - left + 1)));
  while (left < right) {
    if (remainingDepth-- === 0) {
      values.subarray(left, right + 1).sort();
      return values[rank];
    }
    const mid = left + Math.floor((right - left) / 2);
    const a = values[left];
    const b = values[mid];
    const c = values[right];
    // Median-of-three limits poor pivots on already sorted/reverse-sorted maps.
    const pivot = a < b ? (b < c ? b : (a < c ? c : a)) : (a < c ? a : (b < c ? c : b));
    let lt = left;
    let i = left;
    let gt = right;
    while (i <= gt) {
      const value = values[i];
      if (value < pivot) {
        values[i] = values[lt];
        values[lt++] = value;
        i++;
      } else if (value > pivot) {
        values[i] = values[gt];
        values[gt--] = value;
      } else {
        i++;
      }
    }
    if (rank < lt) right = lt - 1;
    else if (rank > gt) left = gt + 1;
    else return values[rank];
  }
  return values[rank];
}

/** After selecting rank k, rank k+1 is the minimum of its right partition. */
function smallestStfValueAfter(
  values: Float32Array | Float64Array, index: number, count: number,
): number {
  let minimum = values[index + 1];
  for (let i = index + 2; i < count; i++) {
    if (values[i] < minimum) minimum = values[i];
  }
  return minimum;
}

function percentileFromSorted(sorted: readonly number[], q: number): number {
  if (sorted.length === 0) return 0;
  const clamped = Math.max(0, Math.min(1, Number.isFinite(q) ? q : 0));
  if (sorted.length === 1) return sorted[0];
  const position = clamped * (sorted.length - 1);
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  const fraction = position - lower;
  const a = sorted[lower];
  const b = sorted[upper];
  return a + (b - a) * fraction;
}

function clampUnit(value: number): number {
  if (!(value > 0)) return 0;
  if (value >= 1) return 1;
  return value;
}

function gaussianKernel(radius: number): Float32Array {
  const kernel = new Float32Array(radius * 2 + 1);
  const sigma = Math.max(0.75, radius / 2);
  let sum = 0;
  for (let offset = -radius; offset <= radius; offset += 1) {
    const value = Math.exp(-(offset * offset) / (2 * sigma * sigma));
    kernel[offset + radius] = value;
    sum += value;
  }
  for (let index = 0; index < kernel.length; index += 1) kernel[index] /= sum;
  return kernel;
}

function sampleHorizontalScaled(
  source: Float32Array,
  row: number,
  width: number,
  x: number,
  direction: -1 | 1,
  wholeStep: number,
  fractionalStep: number,
): number {
  const nearX = Math.max(0, Math.min(width - 1, x + direction * wholeStep));
  if (!(fractionalStep > 0)) return source[row + nearX] ?? 0;
  const farX = Math.max(0, Math.min(width - 1, nearX + direction));
  const near = source[row + nearX] ?? 0;
  const far = source[row + farX] ?? 0;
  return near + (far - near) * fractionalStep;
}

function sampleVerticalScaled(
  source: Float32Array,
  x: number,
  width: number,
  height: number,
  y: number,
  direction: -1 | 1,
  wholeStep: number,
  fractionalStep: number,
): number {
  const nearY = Math.max(0, Math.min(height - 1, y + direction * wholeStep));
  if (!(fractionalStep > 0)) return source[nearY * width + x] ?? 0;
  const farY = Math.max(0, Math.min(height - 1, nearY + direction));
  const near = source[nearY * width + x] ?? 0;
  const far = source[farY * width + x] ?? 0;
  return near + (far - near) * fractionalStep;
}

function binomialBlurHorizontalScaledInto(
  source: Float32Array,
  width: number,
  height: number,
  scale: number,
  output: Float32Array,
): void {
  const wholeStep = Math.floor(scale);
  const fractionalStep = scale - wholeStep;
  for (let y = 0; y < height; y += 1) {
    const row = y * width;
    for (let x = 0; x < width; x += 1) {
      const left = sampleHorizontalScaled(source, row, width, x, -1, wholeStep, fractionalStep);
      const center = source[row + x] ?? 0;
      const right = sampleHorizontalScaled(source, row, width, x, 1, wholeStep, fractionalStep);
      output[row + x] = (left + center * 2 + right) * 0.25;
    }
  }
}

function binomialBlurVerticalScaledInto(
  source: Float32Array,
  width: number,
  height: number,
  scale: number,
  output: Float32Array,
): void {
  const wholeStep = Math.floor(scale);
  const fractionalStep = scale - wholeStep;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const top = sampleVerticalScaled(source, x, width, height, y, -1, wholeStep, fractionalStep);
      const center = source[y * width + x] ?? 0;
      const bottom = sampleVerticalScaled(source, x, width, height, y, 1, wholeStep, fractionalStep);
      output[y * width + x] = (top + center * 2 + bottom) * 0.25;
    }
  }
}

function accumulateSobelMagnitudeScaledInto(
  verticalForGx: Float32Array,
  horizontalForGy: Float32Array,
  width: number,
  height: number,
  scale: number,
  weight: number,
  output: Float32Array,
  brightnessFloor: number,
): void {
  const wholeStep = Math.floor(scale);
  const fractionalStep = scale - wholeStep;
  for (let y = 0; y < height; y += 1) {
    const row = y * width;
    for (let x = 0; x < width; x += 1) {
      const pixel = row + x;
      const left = sampleHorizontalScaled(verticalForGx, row, width, x, -1, wholeStep, fractionalStep);
      const right = sampleHorizontalScaled(verticalForGx, row, width, x, 1, wholeStep, fractionalStep);
      const top = sampleVerticalScaled(horizontalForGy, x, width, height, y, -1, wholeStep, fractionalStep);
      const bottom = sampleVerticalScaled(horizontalForGy, x, width, height, y, 1, wholeStep, fractionalStep);
      const gx = (right - left) * 0.5;
      const gy = (bottom - top) * 0.5;
      const magnitude = Math.fround(Math.sqrt(gx * gx + gy * gy));
      const localBrightness = Math.max(0, ((verticalForGx[pixel] ?? 0) + (horizontalForGy[pixel] ?? 0)) * 0.5);
      const normalized = magnitude / (localBrightness + brightnessFloor);
      output[pixel] += normalized * normalized * weight;
    }
  }
}
