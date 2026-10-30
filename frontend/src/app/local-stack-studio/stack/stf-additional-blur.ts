export const STF_ADDITIONAL_BLUR_FINE_REFERENCE_PIXELS = 16_000_000;
export const STF_ADDITIONAL_BLUR_COARSE_REFERENCE_PIXELS = 500_000;
export const STF_ADDITIONAL_BLUR_MAX_WORKERS = 4;
export const STF_ADDITIONAL_BLUR_SAMPLE_LIMIT = 65_536;

const SHARPNESS_RGB_WEIGHTS = [0.3, 0.4, 0.3] as const;
const LOG_FLOOR = 1e-12;
const MIN_VARIANCE = 1e-8;
const GMM_ITERATIONS = 32;
const BLUR_MIN_RADIUS = 2;
const BLUR_MAX_RADIUS = 15;
const GATE_SEED_THRESHOLD = 0.7;
const GATE_EXPANSION_RADIUS_FACTOR = 0.4;
const GATE_EXPANSION_SIGMA_FACTOR = 0.2;

export type StfSharpnessScratch = {
  a: Float32Array;
  b: Float32Array;
  c: Float32Array;
};

export type StfDynamicSharpnessPlan = {
  c: number;
  method: "gmm-intersection" | "median-fallback";
  sampleCount: number;
};

export type StfSigmoidPlan = {
  sharpFraction: number;
  thresholdPercentile: number;
  lowerPercentile: number;
  upperPercentile: number;
  thresholdLog: number;
  lowerLog: number;
  upperLog: number;
  robustScale: number;
  strength: number;
};

export type StfRelativeCombineMode = "mean" | "rms";

export type StfSampleGrid = {
  stride: number;
  offsetX: number;
  offsetY: number;
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

// The production sharpness remains absolute. Only the experimental relative
// preview normalizes each channel before applying the RGB 3:4:3 weights.
export function buildStfSharpnessMapAtScaleInto(
  linear: Float32Array,
  width: number,
  height: number,
  scale: number,
  output: Float32Array,
  scratch: StfSharpnessScratch,
): void {
  buildStfSharpnessMapAtScaleInternal(linear, width, height, scale, output, scratch, false);
}

export function buildStfRelativeSharpnessMapAtScaleInto(
  linear: Float32Array,
  width: number,
  height: number,
  scale: number,
  output: Float32Array,
  scratch: StfSharpnessScratch,
  brightnessFloor: number | StfRelativeChannelFloors = STF_RELATIVE_CHANNEL_BRIGHTNESS_FLOOR,
  combineMode: StfRelativeCombineMode = "mean",
): void {
  if (typeof brightnessFloor === "number") {
    if (!(Number.isFinite(brightnessFloor) && brightnessFloor > 0)) {
      throw new Error("STF relative sharpness brightness floor must be positive and finite.");
    }
  } else validateStfRelativeChannelFloors(brightnessFloor);
  if (combineMode !== "mean" && combineMode !== "rms") {
    throw new Error("STF relative sharpness RGB combine mode is invalid.");
  }
  buildStfSharpnessMapAtScaleInternal(linear, width, height, scale, output, scratch, true, brightnessFloor, combineMode);
}

// Linear RGB input: use the same scale-aware low-pass samples as the Sobel
// measurement for the local intensity. A modest fixed floor prevents very dark
// channels from turning tiny gradients/noise into arbitrarily large ratios.
export const STF_RELATIVE_CHANNEL_BRIGHTNESS_FLOOR = 1e-4;
export const STF_RELATIVE2_CHANNEL_BRIGHTNESS_FLOOR = 1e-5;
export type StfRelativeChannelFloors = [number, number, number];

// Relative3 / relative4 / relative5: one global median per channel, measured from spatially sampled
// tone-matched STF composite RGB before starting the sharpness pass.
export function deriveStfRelativeChannelFloorsFromSamples(
  samples: readonly [ArrayLike<number>, ArrayLike<number>, ArrayLike<number>],
  divisor: 4 | 8 | 16 = 4,
): StfRelativeChannelFloors {
  return samples.map((values) => {
    const sorted: number[] = [];
    for (let i = 0; i < values.length; i += 1) {
      const value = Number(values[i]);
      if (Number.isFinite(value)) sorted.push(Math.max(0, value));
    }
    if (sorted.length === 0) throw new Error("STF relative3 requires finite RGB brightness samples.");
    sorted.sort((a, b) => a - b);
    return Math.max(LOG_FLOOR, percentileFromSorted(sorted, 0.5) / divisor);
  }) as StfRelativeChannelFloors;
}

export function validateStfRelativeChannelFloors(floors: readonly number[]): StfRelativeChannelFloors {
  if (floors.length !== 3 || !floors.every((value) => Number.isFinite(value) && value > 0)) {
    throw new Error("STF relative3 RGB brightness floors are invalid.");
  }
  return [floors[0], floors[1], floors[2]];
}

function buildStfSharpnessMapAtScaleInternal(
  linear: Float32Array,
  width: number,
  height: number,
  scale: number,
  output: Float32Array,
  scratch: StfSharpnessScratch,
  relative: boolean,
  brightnessFloor: number | StfRelativeChannelFloors = STF_RELATIVE_CHANNEL_BRIGHTNESS_FLOOR,
  combineMode: StfRelativeCombineMode = "mean",
): void {
  const pixelCount = width * height;
  if (linear.length !== pixelCount * 3 || output.length !== pixelCount) {
    throw new Error("STF Additional blur sharpness buffer has an invalid size.");
  }
  if (scratch.a.length !== pixelCount || scratch.b.length !== pixelCount || scratch.c.length !== pixelCount) {
    throw new Error("STF Additional blur sharpness scratch buffer has an invalid size.");
  }
  const safeScale = Number.isFinite(scale) && scale > 0 ? scale : 1;
  output.fill(0);
  const useRmsCombine = relative && combineMode === "rms";
  for (let channel = 0; channel < 3; channel += 1) {
    for (let pixel = 0, source = channel; pixel < pixelCount; pixel += 1, source += 3) {
      scratch.a[pixel] = linear[source] ?? 0;
    }
    binomialBlurHorizontalScaledInto(scratch.a, width, height, safeScale, scratch.b);
    binomialBlurVerticalScaledInto(scratch.b, width, height, safeScale, scratch.c);
    binomialBlurVerticalScaledInto(scratch.c, width, height, safeScale, scratch.a);
    binomialBlurHorizontalScaledInto(scratch.c, width, height, safeScale, scratch.b);
    accumulateSobelMagnitudeScaledInto(
      scratch.a,
      scratch.b,
      width,
      height,
      safeScale,
      SHARPNESS_RGB_WEIGHTS[channel],
      output,
      relative,
      typeof brightnessFloor === "number" ? brightnessFloor : brightnessFloor[channel],
      useRmsCombine,
    );
  }
  if (useRmsCombine) {
    for (let pixel = 0; pixel < pixelCount; pixel += 1) output[pixel] = Math.fround(Math.sqrt(Math.max(0, output[pixel])));
  }
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

// The 0.5MP preview and the ratio previews must use the very same
// per-aperture-group values as the production Additional blur gate.
export function buildStfPersistentCoarseSharpnessStripe(
  packedGroups: Float32Array,
  groupCount: number,
): Float32Array {
  if (!(Number.isInteger(groupCount) && groupCount >= 2 && packedGroups.length > 0
    && packedGroups.length % groupCount === 0)) {
    throw new Error("STF coarse sharpness preview has invalid aperture-group data.");
  }
  const pixelCount = packedGroups.length / groupCount;
  const output = new Float32Array(pixelCount);
  for (let pixel = 0; pixel < pixelCount; pixel += 1) {
    let logSum = 0;
    let valid = true;
    for (let group = 0; group < groupCount; group += 1) {
      const value = packedGroups[group * pixelCount + pixel];
      if (!(Number.isFinite(value) && value > 0)) {
        valid = false;
        break;
      }
      logSum += Math.log(value);
    }
    output[pixel] = valid ? Math.exp(logSum / groupCount) : 0;
  }
  return output;
}

// The fine-side log sum already contains one log-sharpness per F-number group.
// Convert it back to the same geometric-mean sharpness used for coarse previews.
export function buildStfPersistentFineSharpnessStripe(
  fineLogSum: Float32Array,
  fineZero: Uint8Array,
  groupCount: number,
): Float32Array {
  if (!(Number.isInteger(groupCount) && groupCount >= 2 && fineLogSum.length > 0
    && fineZero.length === fineLogSum.length)) {
    throw new Error("STF fine sharpness preview has invalid aperture-group data.");
  }
  const output = new Float32Array(fineLogSum.length);
  for (let pixel = 0; pixel < output.length; pixel += 1) {
    const logSum = fineLogSum[pixel];
    output[pixel] = !fineZero[pixel] && Number.isFinite(logSum)
      ? Math.exp(logSum / groupCount)
      : 0;
  }
  return output;
}

export function normalizeStfSharpnessForPreview(value: number, c: number): number {
  return Number.isFinite(value) && value > 0 && Number.isFinite(c) && c > 0
    ? value / (value + c)
    : 0;
}

// ratio/(ratio+1), evaluated without overflowing exp for very large log-ratios.
export function normalizeStfLogRatioForPreview(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return value >= 0
    ? 1 / (1 + Math.exp(-value))
    : Math.exp(value) / (1 + Math.exp(value));
}

// P50 of the positive, uncompressed 0.5MP sharpness samples. Use the same
// samples as the GMM mode so the only difference in the ratio is epsilon.
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

export function deriveStfRatioEpsilon(c: number, divisor = 4): number {
  const value = Number(c);
  if (!(Number.isFinite(value) && value > 0)) throw new Error("STF Additional blur dynamic c is invalid.");
  if (!(Number.isFinite(divisor) && divisor > 0)) throw new Error("STF Additional blur epsilon divisor is invalid.");
  return Math.max(LOG_FLOOR, value / divisor);
}

export function deriveStfDynamicSharpnessC(rawSamples: ArrayLike<number>): StfDynamicSharpnessPlan {
  const logs: number[] = [];
  for (let index = 0; index < rawSamples.length; index += 1) {
    const value = Number(rawSamples[index]);
    if (Number.isFinite(value) && value > 0) logs.push(Math.log(Math.max(value, LOG_FLOOR)));
  }
  logs.sort((a, b) => a - b);
  const sampleCount = logs.length;
  if (sampleCount === 0) return { c: LOG_FLOOR, method: "median-fallback", sampleCount: 0 };

  const p30 = percentileFromSorted(logs, 0.3);
  const p50 = percentileFromSorted(logs, 0.5);
  const p70 = percentileFromSorted(logs, 0.7);

  let mean1 = 0;
  for (const value of logs) mean1 += value;
  mean1 /= sampleCount;
  let variance1 = 0;
  for (const value of logs) {
    const delta = value - mean1;
    variance1 += delta * delta;
  }
  variance1 = Math.max(MIN_VARIANCE, variance1 / sampleCount);
  let likelihood1 = 0;
  for (const value of logs) likelihood1 += gaussianLogDensity(value, mean1, variance1);
  const bic1 = 2 * Math.log(sampleCount) - 2 * likelihood1;

  let lowMean = p30;
  let highMean = p70;
  if (!(highMean > lowMean)) lowMean = highMean = mean1;
  let lowVariance = variance1;
  let highVariance = variance1;
  let lowWeight = 0.5;
  let highWeight = 0.5;
  let likelihood2 = Number.NEGATIVE_INFINITY;
  const lowResponsibilities = new Float64Array(sampleCount);

  for (let iteration = 0; iteration < GMM_ITERATIONS; iteration += 1) {
    let lowMass = 0;
    let highMass = 0;
    let lowSum = 0;
    let highSum = 0;
    let nextLikelihood = 0;
    for (let index = 0; index < sampleCount; index += 1) {
      const value = logs[index];
      const lowLog = Math.log(Math.max(lowWeight, Number.EPSILON)) + gaussianLogDensity(value, lowMean, lowVariance);
      const highLog = Math.log(Math.max(highWeight, Number.EPSILON)) + gaussianLogDensity(value, highMean, highVariance);
      const maximum = Math.max(lowLog, highLog);
      const lowExp = Math.exp(lowLog - maximum);
      const highExp = Math.exp(highLog - maximum);
      const denominator = lowExp + highExp;
      const lowResponsibility = denominator > 0 ? lowExp / denominator : 0.5;
      lowResponsibilities[index] = lowResponsibility;
      const highResponsibility = 1 - lowResponsibility;
      lowMass += lowResponsibility;
      highMass += highResponsibility;
      lowSum += lowResponsibility * value;
      highSum += highResponsibility * value;
      nextLikelihood += maximum + Math.log(Math.max(denominator, Number.MIN_VALUE));
    }
    if (!(lowMass > 0 && highMass > 0)) break;
    const nextLowMean = lowSum / lowMass;
    const nextHighMean = highSum / highMass;
    let nextLowVariance = 0;
    let nextHighVariance = 0;
    for (let index = 0; index < sampleCount; index += 1) {
      const value = logs[index];
      const lowResponsibility = lowResponsibilities[index];
      const highResponsibility = 1 - lowResponsibility;
      const lowDelta = value - nextLowMean;
      const highDelta = value - nextHighMean;
      nextLowVariance += lowResponsibility * lowDelta * lowDelta;
      nextHighVariance += highResponsibility * highDelta * highDelta;
    }
    lowMean = nextLowMean;
    highMean = nextHighMean;
    lowVariance = Math.max(MIN_VARIANCE, nextLowVariance / lowMass);
    highVariance = Math.max(MIN_VARIANCE, nextHighVariance / highMass);
    lowWeight = lowMass / sampleCount;
    highWeight = highMass / sampleCount;
    if (Number.isFinite(likelihood2) && Math.abs(nextLikelihood - likelihood2) <= 1e-9 * (1 + Math.abs(likelihood2))) {
      likelihood2 = nextLikelihood;
      break;
    }
    likelihood2 = nextLikelihood;
  }

  if (lowMean > highMean) {
    [lowMean, highMean] = [highMean, lowMean];
    [lowVariance, highVariance] = [highVariance, lowVariance];
    [lowWeight, highWeight] = [highWeight, lowWeight];
  }

  likelihood2 = 0;
  for (const value of logs) {
    const lowLog = Math.log(Math.max(lowWeight, Number.EPSILON)) + gaussianLogDensity(value, lowMean, lowVariance);
    const highLog = Math.log(Math.max(highWeight, Number.EPSILON)) + gaussianLogDensity(value, highMean, highVariance);
    const maximum = Math.max(lowLog, highLog);
    likelihood2 += maximum + Math.log(Math.exp(lowLog - maximum) + Math.exp(highLog - maximum));
  }
  const bic2 = 5 * Math.log(sampleCount) - 2 * likelihood2;

  const difference = (value: number): number => (
    Math.log(Math.max(lowWeight, Number.EPSILON)) + gaussianLogDensity(value, lowMean, lowVariance)
    - Math.log(Math.max(highWeight, Number.EPSILON)) - gaussianLogDensity(value, highMean, highVariance)
  );
  let intersection = Number.NaN;
  if (highMean > lowMean) {
    let left = lowMean;
    let right = highMean;
    let leftValue = difference(left);
    let rightValue = difference(right);
    if (Number.isFinite(leftValue) && Number.isFinite(rightValue)) {
      if (leftValue === 0) intersection = left;
      else if (rightValue === 0) intersection = right;
      else if (leftValue * rightValue < 0) {
        for (let iteration = 0; iteration < 80; iteration += 1) {
          const middle = (left + right) * 0.5;
          const middleValue = difference(middle);
          if (!Number.isFinite(middleValue)) break;
          if (Math.abs(middleValue) <= 1e-12) {
            left = right = middle;
            break;
          }
          if (leftValue * middleValue <= 0) {
            right = middle;
            rightValue = middleValue;
          } else {
            left = middle;
            leftValue = middleValue;
          }
        }
        intersection = (left + right) * 0.5;
      }
    }
  }

  const useMixture = bic2 < bic1 && Number.isFinite(intersection) && intersection >= lowMean && intersection <= highMean;
  const selected = useMixture ? intersection : p50;
  return {
    c: Math.max(LOG_FLOOR, Math.exp(selected)),
    method: useMixture ? "gmm-intersection" : "median-fallback",
    sampleCount,
  };
}

export function buildStfLogRatioFromDerived(
  fineLogSum: Float32Array,
  fineZero: Uint8Array,
  coarseGroups: Float32Array,
  groupCount: number,
  epsilon: number,
): Float32Array {
  const pixelCount = fineLogSum.length;
  if (fineZero.length !== pixelCount || coarseGroups.length !== pixelCount * groupCount) {
    throw new Error("STF Additional blur derived sharpness buffers have invalid sizes.");
  }
  if (!(Number.isInteger(groupCount) && groupCount >= 2 && Number.isFinite(epsilon) && epsilon > 0)) {
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
    output[pixel] = fineLogSum[pixel] / groupCount - coarseLogSum / groupCount;
  }
  return output;
}

export function buildStfSigmoidPlan(logSamples: ArrayLike<number>, blurRatio: number): StfSigmoidPlan {
  const safeBokeh = Math.max(0.1, Math.min(0.9, Number.isFinite(blurRatio) ? blurRatio : 0.5));
  const sharpFraction = 1 - safeBokeh;
  const thresholdPercentile = safeBokeh;
  const lowerPercentile = Math.max(0, thresholdPercentile - 0.1);
  const upperPercentile = Math.min(1, thresholdPercentile + 0.1);
  const finite = Array.from(logSamples, Number).filter(Number.isFinite);
  if (finite.length < 2) {
    const thresholdLog = finite[0] ?? Math.log(LOG_FLOOR);
    return {
      sharpFraction,
      thresholdPercentile,
      lowerPercentile,
      upperPercentile,
      thresholdLog,
      lowerLog: thresholdLog,
      upperLog: thresholdLog,
      robustScale: 1,
      strength: 1,
    };
  }
  finite.sort((a, b) => a - b);
  const thresholdLog = percentileFromSorted(finite, thresholdPercentile);
  const lowerLog = percentileFromSorted(finite, lowerPercentile);
  const upperLog = percentileFromSorted(finite, upperPercentile);
  let robustScale = percentileFromSorted(finite, 0.84) - percentileFromSorted(finite, 0.16);
  if (!(robustScale > 1e-12)) robustScale = percentileFromSorted(finite, 0.75) - percentileFromSorted(finite, 0.25);
  if (!(robustScale > 1e-12)) robustScale = (finite[finite.length - 1] ?? 0) - (finite[0] ?? 0);
  if (!(robustScale > 1e-12)) robustScale = 1;

  const lowerDistance = Math.max(0, thresholdLog - lowerLog);
  const upperDistance = Math.max(0, upperLog - thresholdLog);
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
  return { sharpFraction, thresholdPercentile, lowerPercentile, upperPercentile, thresholdLog, lowerLog, upperLog, robustScale, strength };
}

export function applyStfSigmoidGateInPlace(logRatio: Float32Array, width: number, height: number, blurRatio: number): StfSigmoidPlan {
  if (logRatio.length !== width * height) throw new Error("STF Additional blur ratio map has an invalid size.");
  const grid = buildStfSampleGrid(width, height);
  const samples: number[] = [];
  const logFloor = Math.log(LOG_FLOOR);
  for (let y = grid.offsetY; y < height; y += grid.stride) {
    const row = y * width;
    for (let x = grid.offsetX; x < width; x += grid.stride) {
      const value = logRatio[row + x];
      samples.push(Number.isFinite(value) ? value : logFloor);
    }
  }
  if (samples.length < 2) {
    samples.push(Number.isFinite(logRatio[0]) ? logRatio[0] : logFloor);
    samples.push(Number.isFinite(logRatio[Math.max(0, logRatio.length - 1)]) ? logRatio[Math.max(0, logRatio.length - 1)] : logFloor);
  }
  const plan = buildStfSigmoidPlan(samples, blurRatio);
  for (let index = 0; index < logRatio.length; index += 1) {
    const value = Number.isFinite(logRatio[index]) ? logRatio[index] : logFloor;
    logRatio[index] = applyLogSigmoid(value, plan.thresholdLog, plan.robustScale, plan.strength);
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

function gaussianLogDensity(value: number, mean: number, variance: number): number {
  const safeVariance = Math.max(MIN_VARIANCE, variance);
  const delta = value - mean;
  return -0.5 * (Math.log(2 * Math.PI * safeVariance) + delta * delta / safeVariance);
}

function applyLogSigmoid(value: number, threshold: number, scale: number, strength: number): number {
  const x = strength * (value - threshold) / Math.max(1e-12, scale);
  if (x >= 40) return 1;
  if (x <= -40) return 0;
  return 1 / (1 + Math.exp(-x));
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
  relative = false,
  brightnessFloor = STF_RELATIVE_CHANNEL_BRIGHTNESS_FLOOR,
  rmsCombine = false,
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
      if (relative) {
        const localBrightness = Math.max(0, ((verticalForGx[pixel] ?? 0) + (horizontalForGy[pixel] ?? 0)) * 0.5);
        const normalized = magnitude / Math.max(localBrightness, brightnessFloor);
        output[pixel] += rmsCombine ? normalized * normalized * weight : normalized * weight;
      } else {
        output[pixel] += magnitude * weight;
      }
    }
  }
}
