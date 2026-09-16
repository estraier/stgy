import {
  ROLLOFF_SAVING_LIMIT_FACTOR,
  SIGMOID_WORKING_GAMMA,
  applyRolloffScalar,
  applyScaledLogLinear,
  rolloffParams,
  type RolloffParams,
} from "@/image/tone";

export type RawHeadroomStatistics = {
  step: number;
  histogramMax: number;
  bins: number[];
  overflowCount: number;
  pixelCount: number;
  maxRgb: number;
};

export type RawVignettingMap = {
  gridWidth: number;
  gridHeight: number;
  step: number;
  data: Float32Array;
};

export type RawMatchedTonePlan = {
  gain: number;
  scaledLog: number;
  sigmoid: number;
  toneSlopeAtWhite: number;
  rolloff: RolloffParams | null;
};

export type RawStorageTransfer = "linear" | "gamma20";

export type RawFallbackPlan = {
  factor: number;
  rolloff: RolloffParams | null;
};

export type RawLensfunCorrectionMaps = {
  gridWidth: number;
  gridHeight: number;
  step: number;
  geometry: Float32Array;
  distortion: boolean;
  crop?: { top: number; bottom: number; left: number; right: number };
  combined?: Float32Array;
  tca?: Float32Array;
  vignetting?: Float32Array;
  vignettingBaked?: boolean;
};

export type RawColorPassPlan = {
  hasSaturation: boolean;
  hasVibrance: boolean;
  saturationFactor: number;
  vibranceFactor: number;
  saturationRolloff: RolloffParams | null;
};

export type RawFallbackResult = {
  exposureEv: number;
  headroom: RawHeadroomStatistics;
  plan: RawFallbackPlan;
};

export type RawDenoiseMaskAnalysis = {
  weight: Float32Array;
  width: number;
  height: number;
  smoothMean: number;
  smoothStddev: number;
  shadowMean: number;
  shadowStddev: number;
  weightMean: number;
  weightStddev: number;
  weightP50: number;
  weightP90: number;
  weightP99: number;
};

export const RAW_DEVELOPED_LINEAR_RANGE_MAX = 4;
export const RAW_DEVELOPED_ROLLOFF_A = 2;
const RAW_DEVELOPED_ROLLOFF_SAVING_LIMIT = ROLLOFF_SAVING_LIMIT_FACTOR;
const RAW_DEVELOPED_ROLLOFF_PERCENTILE = 99.8;
const RAW_ROLLOFF_SAMPLE_LIMIT = 65_536;
const RAW_HEADROOM_HISTOGRAM_STEP = 0.1;
const RAW_HEADROOM_HISTOGRAM_MAX = RAW_DEVELOPED_LINEAR_RANGE_MAX;
const RAW_BASELINE_PERCENTILE = 98;
const RAW_BASELINE_TARGET = 0.9;
const RAW_THUMBNAIL_MATCH_LOG_MIN = -16;
const RAW_THUMBNAIL_MATCH_LOG_MAX = 16;
const RAW_THUMBNAIL_MATCH_SIGMOID_MIN = -10;
const RAW_THUMBNAIL_MATCH_SIGMOID_MAX = 10;
const RAW_DENOISE_ISO_NEUTRAL = 400;
const RAW_DENOISE_ISO_LOG_PER_STOP = 2;
const PROPHOTO_LUMA_R = 0.2880402;
const PROPHOTO_LUMA_G = 0.7118741;
const PROPHOTO_LUMA_B = 0.0000857;

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function smoothstep(low: number, high: number, value: number): number {
  const t = clamp01((value - low) / Math.max(high - low, 1e-12));
  return t * t * (3 - 2 * t);
}

function decodeLinearUint16(value: number, linearRangeMax: number): number {
  return clamp01(value / 65535) * linearRangeMax;
}

function decodeGamma20Uint16(value: number, linearRangeMax: number): number {
  const encoded = clamp01(value / 65535);
  return encoded * encoded * linearRangeMax;
}

function decodeStoredUint16(
  value: number,
  linearRangeMax: number,
  transfer: RawStorageTransfer,
): number {
  return transfer === "gamma20"
    ? decodeGamma20Uint16(value, linearRangeMax)
    : decodeLinearUint16(value, linearRangeMax);
}

function encodeGamma20Uint16(value: number, linearRangeMax: number): number {
  return Math.round(Math.sqrt(clamp01(value / linearRangeMax)) * 65535);
}

function naiveSigmoid(value: number, gain: number, mid: number): number {
  return 1 / (1 + Math.exp((mid - value) * gain));
}

function naiveInverseSigmoid(value: number, gain: number, mid: number): number {
  const minVal = naiveSigmoid(0, gain, mid);
  const maxVal = naiveSigmoid(1, gain, mid);
  const a = (maxVal - minVal) * value + minVal;
  return -Math.log(1 / a - 1) / gain;
}

function applyRawBaselineScaledLogLinear(value: number, factor: number): number {
  const x = clamp01(value);
  const f = Math.min(RAW_THUMBNAIL_MATCH_LOG_MAX, Math.max(RAW_THUMBNAIL_MATCH_LOG_MIN, factor));
  if (f > 1e-8) return clamp01(Math.log1p(x * f) / Math.log1p(f));
  if (f < -1e-8) {
    const magnitude = -f;
    return clamp01(Math.expm1(x * Math.log1p(magnitude)) / magnitude);
  }
  return x;
}

function applyRawBaselineSigmoidLinear(value: number, gain: number): number {
  const x = clamp01(value);
  const g = Math.min(
    RAW_THUMBNAIL_MATCH_SIGMOID_MAX,
    Math.max(RAW_THUMBNAIL_MATCH_SIGMOID_MIN, gain),
  );
  const mid = 0.5;
  const gamma = SIGMOID_WORKING_GAMMA;
  const encoded = Math.pow(x, 1 / gamma);
  if (g > 1e-8) {
    const minVal = naiveSigmoid(0, g, mid);
    const maxVal = naiveSigmoid(1, g, mid);
    const adjusted = clamp01((naiveSigmoid(encoded, g, mid) - minVal) / (maxVal - minVal));
    return clamp01(Math.pow(adjusted, gamma));
  }
  if (g < -1e-8) {
    const magnitude = -g;
    const minVal = naiveInverseSigmoid(0, magnitude, mid);
    const maxVal = naiveInverseSigmoid(1, magnitude, mid);
    const adjusted = clamp01(
      (naiveInverseSigmoid(encoded, magnitude, mid) - minVal) / (maxVal - minVal),
    );
    return clamp01(Math.pow(adjusted, gamma));
  }
  return x;
}

function rawBaselineToneCurveValue(value: number, scaledLog: number, sigmoid: number): number {
  return applyRawBaselineSigmoidLinear(
    applyRawBaselineScaledLogLinear(value, scaledLog),
    sigmoid,
  );
}

function transformedRawLumaValueExtended(
  rawLuma: number,
  gain: number,
  scaledLog: number,
  sigmoid: number,
  toneSlopeAtWhite: number,
): number {
  const exposed = rawLuma * gain;
  if (exposed <= 1) return rawBaselineToneCurveValue(exposed, scaledLog, sigmoid);
  return 1 + toneSlopeAtWhite * (exposed - 1);
}

function histogramPercentile16(
  histogram: Uint32Array,
  sampleCount: number,
  percentile: number,
): number {
  if (sampleCount <= 0) return 0;
  const rank = (sampleCount - 1) * Math.min(100, Math.max(0, percentile)) / 100;
  const lowerRank = Math.floor(rank);
  const upperRank = Math.ceil(rank);
  const fraction = rank - lowerRank;
  let cumulative = 0;
  let lowerLevel = histogram.length - 1;
  let upperLevel = histogram.length - 1;
  let lowerFound = false;
  for (let level = 0; level < histogram.length; level++) {
    cumulative += histogram[level] ?? 0;
    if (!lowerFound && cumulative > lowerRank) {
      lowerLevel = level;
      lowerFound = true;
    }
    if (cumulative > upperRank) {
      upperLevel = level;
      break;
    }
  }
  return lowerLevel + (upperLevel - lowerLevel) * fraction;
}

function createHeadroomAccumulator() {
  return {
    bins: new Uint32Array(Math.round(RAW_HEADROOM_HISTOGRAM_MAX / RAW_HEADROOM_HISTOGRAM_STEP)),
    overflowCount: 0,
    pixelCount: 0,
    maxRgb: 0,
  };
}

function recordHeadroom(
  accumulator: ReturnType<typeof createHeadroomAccumulator>,
  r: number,
  g: number,
  b: number,
): void {
  const maxRgb = Math.max(r, g, b);
  if (!Number.isFinite(maxRgb)) return;
  accumulator.pixelCount++;
  accumulator.maxRgb = Math.max(accumulator.maxRgb, maxRgb);
  if (maxRgb > RAW_HEADROOM_HISTOGRAM_MAX) {
    accumulator.overflowCount++;
    return;
  }
  const index = Math.min(
    accumulator.bins.length - 1,
    Math.floor(Math.max(0, maxRgb) / RAW_HEADROOM_HISTOGRAM_STEP),
  );
  accumulator.bins[Math.max(0, index)]++;
}

function finishHeadroom(
  accumulator: ReturnType<typeof createHeadroomAccumulator>,
): RawHeadroomStatistics {
  return {
    step: RAW_HEADROOM_HISTOGRAM_STEP,
    histogramMax: RAW_HEADROOM_HISTOGRAM_MAX,
    bins: Array.from(accumulator.bins),
    overflowCount: accumulator.overflowCount,
    pixelCount: accumulator.pixelCount,
    maxRgb: accumulator.maxRgb,
  };
}

function vignettingGainInto(
  map: RawVignettingMap | undefined,
  x: number,
  y: number,
  output: [number, number, number],
): void {
  if (!map) {
    output[0] = 1;
    output[1] = 1;
    output[2] = 1;
    return;
  }
  const gx = Math.max(0, Math.min(map.gridWidth - 1, x / map.step));
  const gy = Math.max(0, Math.min(map.gridHeight - 1, y / map.step));
  const x0 = Math.floor(gx);
  const y0 = Math.floor(gy);
  const x1 = Math.min(map.gridWidth - 1, x0 + 1);
  const y1 = Math.min(map.gridHeight - 1, y0 + 1);
  const tx = gx - x0;
  const ty = gy - y0;
  const w00 = (1 - tx) * (1 - ty);
  const w10 = tx * (1 - ty);
  const w01 = (1 - tx) * ty;
  const w11 = tx * ty;
  const i00 = (y0 * map.gridWidth + x0) * 3;
  const i10 = (y0 * map.gridWidth + x1) * 3;
  const i01 = (y1 * map.gridWidth + x0) * 3;
  const i11 = (y1 * map.gridWidth + x1) * 3;
  for (let channel = 0; channel < 3; channel++) {
    const value =
      (map.data[i00 + channel] ?? 0) * w00 +
      (map.data[i10 + channel] ?? 0) * w10 +
      (map.data[i01 + channel] ?? 0) * w01 +
      (map.data[i11 + channel] ?? 0) * w11;
    output[channel] = Number.isFinite(value) ? Math.max(0, value) : 1;
  }
}

export function applyRawMatchedTonePass(
  data: Uint16Array,
  width: number,
  height: number,
  sourceLinearRangeMax: number,
  vignetting: RawVignettingMap | undefined,
  plan: RawMatchedTonePlan,
  sourceTransfer: RawStorageTransfer = "linear",
): RawHeadroomStatistics {
  const headroom = createHeadroomAccumulator();
  const gains: [number, number, number] = [1, 1, 1];
  let i = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++, i += 3) {
      vignettingGainInto(vignetting, x, y, gains);
      const r = decodeStoredUint16(data[i] ?? 0, sourceLinearRangeMax, sourceTransfer) * gains[0];
      const g = decodeStoredUint16(data[i + 1] ?? 0, sourceLinearRangeMax, sourceTransfer) * gains[1];
      const b = decodeStoredUint16(data[i + 2] ?? 0, sourceLinearRangeMax, sourceTransfer) * gains[2];
      const luma = PROPHOTO_LUMA_R * r + PROPHOTO_LUMA_G * g + PROPHOTO_LUMA_B * b;
      if (!(luma > 1e-12)) {
        data[i] = 0;
        data[i + 1] = 0;
        data[i + 2] = 0;
        recordHeadroom(headroom, 0, 0, 0);
        continue;
      }
      const adjustedLuma = transformedRawLumaValueExtended(
        luma,
        plan.gain,
        plan.scaledLog,
        plan.sigmoid,
        plan.toneSlopeAtWhite,
      );
      const scale = adjustedLuma / luma;
      let adjustedR = r * scale;
      let adjustedG = g * scale;
      let adjustedB = b * scale;
      const adjustedMax = Math.max(adjustedR, adjustedG, adjustedB);
      if (plan.rolloff && adjustedMax > plan.rolloff.inflection) {
        const rolledMax = applyRolloffScalar(adjustedMax, plan.rolloff);
        const rolloffScale = rolledMax / adjustedMax;
        adjustedR *= rolloffScale;
        adjustedG *= rolloffScale;
        adjustedB *= rolloffScale;
      }
      recordHeadroom(headroom, adjustedR, adjustedG, adjustedB);
      data[i] = encodeGamma20Uint16(adjustedR, RAW_DEVELOPED_LINEAR_RANGE_MAX);
      data[i + 1] = encodeGamma20Uint16(adjustedG, RAW_DEVELOPED_LINEAR_RANGE_MAX);
      data[i + 2] = encodeGamma20Uint16(adjustedB, RAW_DEVELOPED_LINEAR_RANGE_MAX);
    }
  }
  return finishHeadroom(headroom);
}

export function sampleRawLinearRgb(
  data: Uint16Array,
  width: number,
  height: number,
  linearRangeMax: number,
  targetPixels: number,
): Float32Array {
  const sourceW = Math.max(1, Math.round(width));
  const sourceH = Math.max(1, Math.round(height));
  const normalizedTarget = Number.isFinite(targetPixels) && targetPixels > 0
    ? targetPixels
    : sourceW * sourceH;
  const scale = Math.min(1, Math.sqrt(normalizedTarget / (sourceW * sourceH)));
  const sampleW = Math.max(1, Math.round(sourceW * scale));
  const sampleH = Math.max(1, Math.round(sourceH * scale));
  const output = new Float32Array(sampleW * sampleH * 3);

  // Use an area-weighted box average rather than point sampling. Besides making
  // the statistical sample size depend on area instead of aspect ratio, this
  // deliberately averages sensor/color noise before thumbnail matching.
  for (let y = 0; y < sampleH; y++) {
    const sy0 = y * sourceH / sampleH;
    const sy1 = (y + 1) * sourceH / sampleH;
    const iy0 = Math.max(0, Math.floor(sy0));
    const iy1 = Math.min(sourceH, Math.ceil(sy1));
    for (let x = 0; x < sampleW; x++) {
      const sx0 = x * sourceW / sampleW;
      const sx1 = (x + 1) * sourceW / sampleW;
      const ix0 = Math.max(0, Math.floor(sx0));
      const ix1 = Math.min(sourceW, Math.ceil(sx1));
      let sumR = 0;
      let sumG = 0;
      let sumB = 0;
      let totalWeight = 0;
      for (let sy = iy0; sy < iy1; sy++) {
        const wy = Math.max(0, Math.min(sy + 1, sy1) - Math.max(sy, sy0));
        if (!(wy > 0)) continue;
        for (let sx = ix0; sx < ix1; sx++) {
          const wx = Math.max(0, Math.min(sx + 1, sx1) - Math.max(sx, sx0));
          const area = wx * wy;
          if (!(area > 0)) continue;
          const sourceIndex = (sy * sourceW + sx) * 3;
          sumR += decodeGamma20Uint16(data[sourceIndex] ?? 0, linearRangeMax) * area;
          sumG += decodeGamma20Uint16(data[sourceIndex + 1] ?? 0, linearRangeMax) * area;
          sumB += decodeGamma20Uint16(data[sourceIndex + 2] ?? 0, linearRangeMax) * area;
          totalWeight += area;
        }
      }
      const invWeight = totalWeight > 0 ? 1 / totalWeight : 0;
      const targetIndex = (y * sampleW + x) * 3;
      output[targetIndex] = sumR * invWeight;
      output[targetIndex + 1] = sumG * invWeight;
      output[targetIndex + 2] = sumB * invWeight;
    }
  }
  return output;
}

function applyRawColorToLinearRgb(
  r: number,
  g: number,
  b: number,
  plan: RawColorPassPlan,
  vibranceFactor: number,
  output: [number, number, number],
  vibranceLog1pMagnitude?: number,
  saturationRolloffInflection?: number,
  saturationRolloffShoulder?: number,
): void {
  const extendedScale = Math.max(1, r, g, b);
  r /= extendedScale;
  g /= extendedScale;
  b /= extendedScale;

  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;
  let h = 0;
  if (delta > 1e-6) {
    if (max === r) h = ((g - b) / delta) % 6;
    else if (max === g) h = (b - r) / delta + 2;
    else h = (r - g) / delta + 4;
    h /= 6;
    if (h < 0) h += 1;
  }
  let saturation = max <= 1e-6 ? 0 : delta / max;
  const value = max;
  saturation = clamp01(saturation);
  if (plan.hasSaturation) {
    const scaledSaturation = saturation * plan.saturationFactor;
    if (
      saturationRolloffShoulder !== undefined
      && saturationRolloffInflection !== undefined
    ) {
      saturation = scaledSaturation > saturationRolloffInflection && saturationRolloffShoulder > 0
        ? saturationRolloffInflection
          + saturationRolloffShoulder * (
            1 - Math.exp(-(scaledSaturation - saturationRolloffInflection) / saturationRolloffShoulder)
          )
        : scaledSaturation;
      saturation = clamp01(saturation);
    } else {
      saturation = clamp01(
        applyRolloffScalar(scaledSaturation, plan.saturationRolloff),
      );
    }
  }
  if (plan.hasVibrance) {
    const x = clamp01(saturation);
    if (vibranceFactor > 1e-6) {
      const denominator = vibranceLog1pMagnitude ?? Math.log1p(vibranceFactor);
      saturation = clamp01(Math.log1p(x * vibranceFactor) / denominator);
    } else if (vibranceFactor < -1e-6) {
      const magnitude = -vibranceFactor;
      const logarithm = vibranceLog1pMagnitude ?? Math.log1p(magnitude);
      saturation = clamp01(Math.expm1(x * logarithm) / magnitude);
    } else saturation = x;
  }

  const hh = ((h % 1) + 1) % 1 * 6;
  const c = clamp01(value) * clamp01(saturation);
  const xx = c * (1 - Math.abs(hh % 2 - 1));
  const m = clamp01(value) - c;
  let rp = 0;
  let gp = 0;
  let bp = 0;
  if (hh < 1) {
    rp = c; gp = xx;
  } else if (hh < 2) {
    rp = xx; gp = c;
  } else if (hh < 3) {
    gp = c; bp = xx;
  } else if (hh < 4) {
    gp = xx; bp = c;
  } else if (hh < 5) {
    rp = xx; bp = c;
  } else {
    rp = c; bp = xx;
  }
  output[0] = clamp01(rp + m) * extendedScale;
  output[1] = clamp01(gp + m) * extendedScale;
  output[2] = clamp01(bp + m) * extendedScale;
}

function applyColorPixelInPlace(
  data: Uint16Array,
  i: number,
  linearRangeMax: number,
  plan: RawColorPassPlan,
  vibranceFactor: number,
  output: [number, number, number],
): void {
  applyRawColorToLinearRgb(
    decodeGamma20Uint16(data[i] ?? 0, linearRangeMax),
    decodeGamma20Uint16(data[i + 1] ?? 0, linearRangeMax),
    decodeGamma20Uint16(data[i + 2] ?? 0, linearRangeMax),
    plan,
    vibranceFactor,
    output,
  );
  data[i] = encodeGamma20Uint16(output[0], linearRangeMax);
  data[i + 1] = encodeGamma20Uint16(output[1], linearRangeMax);
  data[i + 2] = encodeGamma20Uint16(output[2], linearRangeMax);
}

export function applyRawColorPass(
  data: Uint16Array,
  linearRangeMax: number,
  plan: RawColorPassPlan,
): void {
  if (!plan.hasSaturation && !plan.hasVibrance) return;
  const vibranceFactor = plan.hasVibrance
    ? Math.min(16, Math.max(-16, Math.round(plan.vibranceFactor * 10) / 10))
    : 0;
  const output: [number, number, number] = [0, 0, 0];
  for (let i = 0; i < data.length; i += 3) {
    applyColorPixelInPlace(data, i, linearRangeMax, plan, vibranceFactor, output);
  }
}

export function applyRawFallbackPlanPass(
  data: Uint16Array,
  width: number,
  height: number,
  sourceLinearRangeMax: number,
  vignetting: RawVignettingMap | undefined,
  plan: RawFallbackPlan,
  sourceTransfer: RawStorageTransfer = "linear",
): RawHeadroomStatistics {
  const headroom = createHeadroomAccumulator();
  const gains: [number, number, number] = [1, 1, 1];
  let i = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++, i += 3) {
      vignettingGainInto(vignetting, x, y, gains);
      let r = decodeStoredUint16(data[i] ?? 0, sourceLinearRangeMax, sourceTransfer) * gains[0] * plan.factor;
      let g = decodeStoredUint16(data[i + 1] ?? 0, sourceLinearRangeMax, sourceTransfer) * gains[1] * plan.factor;
      let b = decodeStoredUint16(data[i + 2] ?? 0, sourceLinearRangeMax, sourceTransfer) * gains[2] * plan.factor;
      const maxChannel = Math.max(r, g, b);
      if (plan.rolloff && maxChannel > plan.rolloff.inflection) {
        const rolledMax = applyRolloffScalar(maxChannel, plan.rolloff);
        const rolloffScale = rolledMax / maxChannel;
        r *= rolloffScale;
        g *= rolloffScale;
        b *= rolloffScale;
      }
      recordHeadroom(headroom, r, g, b);
      data[i] = encodeGamma20Uint16(r, RAW_DEVELOPED_LINEAR_RANGE_MAX);
      data[i + 1] = encodeGamma20Uint16(g, RAW_DEVELOPED_LINEAR_RANGE_MAX);
      data[i + 2] = encodeGamma20Uint16(b, RAW_DEVELOPED_LINEAR_RANGE_MAX);
    }
  }
  return finishHeadroom(headroom);
}

export function applyRawFallbackBaselinePass(
  data: Uint16Array,
  width: number,
  height: number,
  sourceLinearRangeMax: number,
  vignetting: RawVignettingMap | undefined,
  sourceTransfer: RawStorageTransfer = "linear",
): RawFallbackResult | null {
  const rmsHistogram = new Uint32Array(65536);
  const pixelCount = width * height;
  if (pixelCount <= 0) return null;
  const gains: [number, number, number] = [1, 1, 1];
  const sampleStride = Math.max(1, Math.ceil(pixelCount / RAW_ROLLOFF_SAMPLE_LIMIT));
  const maxSamples = new Float32Array(Math.ceil(pixelCount / sampleStride));
  let maxSampleCount = 0;
  let pixelIndex = 0;
  let i = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++, i += 3) {
      vignettingGainInto(vignetting, x, y, gains);
      const r = decodeStoredUint16(data[i] ?? 0, sourceLinearRangeMax, sourceTransfer) * gains[0];
      const g = decodeStoredUint16(data[i + 1] ?? 0, sourceLinearRangeMax, sourceTransfer) * gains[1];
      const b = decodeStoredUint16(data[i + 2] ?? 0, sourceLinearRangeMax, sourceTransfer) * gains[2];
      const rms = Math.sqrt((r * r + g * g + b * b) / 3);
      rmsHistogram[Math.min(65535, Math.max(0, Math.round(rms * 65535)))]++;
      if (pixelIndex % sampleStride === 0 && maxSampleCount < maxSamples.length) {
        maxSamples[maxSampleCount++] = Math.max(r, g, b);
      }
      pixelIndex++;
    }
  }
  const p98 = histogramPercentile16(rmsHistogram, pixelCount, RAW_BASELINE_PERCENTILE) / 65535;
  if (!(p98 > 0)) return null;
  const factor = RAW_BASELINE_TARGET / p98;
  const sortedMaxSamples = maxSampleCount === maxSamples.length
    ? maxSamples
    : maxSamples.slice(0, maxSampleCount);
  sortedMaxSamples.sort();
  const maxP998 = scalarPercentile(sortedMaxSamples, RAW_DEVELOPED_ROLLOFF_PERCENTILE) * factor;
  const plan: RawFallbackPlan = {
    factor,
    rolloff: rolloffParams(
      maxP998,
      RAW_DEVELOPED_ROLLOFF_A,
      RAW_DEVELOPED_ROLLOFF_SAVING_LIMIT,
      RAW_DEVELOPED_LINEAR_RANGE_MAX,
    ),
  };
  const headroom = applyRawFallbackPlanPass(
    data,
    width,
    height,
    sourceLinearRangeMax,
    vignetting,
    plan,
    sourceTransfer,
  );
  return {
    exposureEv: Math.log2(Math.max(factor, Number.MIN_VALUE)),
    headroom,
    plan,
  };
}

function interpolateRawLensfunMapInto(
  correction: RawLensfunCorrectionMaps,
  map: Float32Array,
  stride: number,
  x: number,
  y: number,
  output: number[] | Float32Array,
): void {
  const gx = Math.max(0, Math.min(correction.gridWidth - 1, x / correction.step));
  const gy = Math.max(0, Math.min(correction.gridHeight - 1, y / correction.step));
  const x0 = Math.floor(gx);
  const y0 = Math.floor(gy);
  const x1 = Math.min(correction.gridWidth - 1, x0 + 1);
  const y1 = Math.min(correction.gridHeight - 1, y0 + 1);
  const tx = gx - x0;
  const ty = gy - y0;
  const w00 = (1 - tx) * (1 - ty);
  const w10 = tx * (1 - ty);
  const w01 = (1 - tx) * ty;
  const w11 = tx * ty;
  const i00 = (y0 * correction.gridWidth + x0) * stride;
  const i10 = (y0 * correction.gridWidth + x1) * stride;
  const i01 = (y1 * correction.gridWidth + x0) * stride;
  const i11 = (y1 * correction.gridWidth + x1) * stride;
  for (let channel = 0; channel < stride; channel++) {
    output[channel] =
      (map[i00 + channel] ?? 0) * w00 +
      (map[i10 + channel] ?? 0) * w10 +
      (map[i01 + channel] ?? 0) * w01 +
      (map[i11 + channel] ?? 0) * w11;
  }
}

function rawLensfunSourceCoordinatesInto(
  correction: RawLensfunCorrectionMaps | undefined,
  x: number,
  y: number,
  output: [number, number, number, number, number, number],
): void {
  if (!correction) {
    output[0] = x; output[1] = y;
    output[2] = x; output[3] = y;
    output[4] = x; output[5] = y;
    return;
  }
  if (correction.combined) {
    interpolateRawLensfunMapInto(correction, correction.combined, 6, x, y, output);
    return;
  }
  let geometryX = x;
  let geometryY = y;
  if (correction.distortion) {
    const geometry: [number, number, number, number, number, number] = [0, 0, 0, 0, 0, 0];
    interpolateRawLensfunMapInto(correction, correction.geometry, 2, x, y, geometry);
    geometryX = geometry[0] ?? x;
    geometryY = geometry[1] ?? y;
  }
  if (correction.tca) {
    interpolateRawLensfunMapInto(correction, correction.tca, 6, geometryX, geometryY, output);
    return;
  }
  output[0] = geometryX; output[1] = geometryY;
  output[2] = geometryX; output[3] = geometryY;
  output[4] = geometryX; output[5] = geometryY;
}

function rawLensfunVignettingGainInto(
  correction: RawLensfunCorrectionMaps | undefined,
  x: number,
  y: number,
  output: [number, number, number],
): void {
  if (!correction?.vignetting || correction.vignettingBaked) {
    output[0] = 1; output[1] = 1; output[2] = 1;
    return;
  }
  interpolateRawLensfunMapInto(correction, correction.vignetting, 3, x, y, output);
  output[0] = Number.isFinite(output[0]) ? Math.max(0, output[0]) : 1;
  output[1] = Number.isFinite(output[1]) ? Math.max(0, output[1]) : 1;
  output[2] = Number.isFinite(output[2]) ? Math.max(0, output[2]) : 1;
}

function normalizedRawLensfunCrop(
  correction: RawLensfunCorrectionMaps | undefined,
): { top: number; bottom: number; left: number; right: number } {
  const crop = correction?.crop;
  if (!crop) return { top: 0, bottom: 0, left: 0, right: 0 };
  const left = Math.min(0.495, Math.max(0, crop.left));
  const right = Math.min(0.495, Math.max(0, crop.right));
  const top = Math.min(0.495, Math.max(0, crop.top));
  const bottom = Math.min(0.495, Math.max(0, crop.bottom));
  return {
    left,
    right: Math.min(right, Math.max(0, 0.99 - left)),
    top,
    bottom: Math.min(bottom, Math.max(0, 0.99 - top)),
  };
}

export function rawLensfunOutputDimensions(
  sourceWidth: number,
  sourceHeight: number,
  correction: RawLensfunCorrectionMaps | undefined,
): { width: number; height: number } {
  const crop = normalizedRawLensfunCrop(correction);
  return {
    width: Math.max(1, Math.round(sourceWidth * Math.max(0.01, 1 - crop.left - crop.right))),
    height: Math.max(1, Math.round(sourceHeight * Math.max(0.01, 1 - crop.top - crop.bottom))),
  };
}

function rawLensfunOutputCoordinate(
  index: number,
  outputSize: number,
  sourceSize: number,
  leadingCrop: number,
  trailingCrop: number,
): number {
  const startEdge = sourceSize * leadingCrop;
  const croppedSize = sourceSize * Math.max(0.01, 1 - leadingCrop - trailingCrop);
  return startEdge + (index + 0.5) * croppedSize / Math.max(1, outputSize) - 0.5;
}

function sampleRawStoredChannelBilinear(
  data: Uint16Array,
  width: number,
  height: number,
  x: number,
  y: number,
  channel: 0 | 1 | 2,
  linearRangeMax: number,
  transfer: RawStorageTransfer,
): number | null {
  if (x < 0 || x > width - 1 || y < 0 || y > height - 1) return null;
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const x1 = Math.min(width - 1, x0 + 1);
  const y1 = Math.min(height - 1, y0 + 1);
  const tx = x - x0;
  const ty = y - y0;
  const w00 = (1 - tx) * (1 - ty);
  const w10 = tx * (1 - ty);
  const w01 = (1 - tx) * ty;
  const w11 = tx * ty;
  const i00 = (y0 * width + x0) * 3 + channel;
  const i10 = (y0 * width + x1) * 3 + channel;
  const i01 = (y1 * width + x0) * 3 + channel;
  const i11 = (y1 * width + x1) * 3 + channel;
  return (
    decodeStoredUint16(data[i00] ?? 0, linearRangeMax, transfer) * w00 +
    decodeStoredUint16(data[i10] ?? 0, linearRangeMax, transfer) * w10 +
    decodeStoredUint16(data[i01] ?? 0, linearRangeMax, transfer) * w01 +
    decodeStoredUint16(data[i11] ?? 0, linearRangeMax, transfer) * w11
  );
}

export function developRawMasterOnePassRowsToGamma20(
  data: Uint16Array,
  sourceWidth: number,
  sourceHeight: number,
  sourceLinearRangeMax: number,
  sourceTransfer: RawStorageTransfer,
  correction: RawLensfunCorrectionMaps | undefined,
  tonePlan: RawMatchedTonePlan | undefined,
  fallbackPlan: RawFallbackPlan | undefined,
  colorPlan: RawColorPassPlan | undefined,
  output: Uint16Array,
  rowStart: number,
  rowEnd: number,
): { width: number; height: number; headroom?: RawHeadroomStatistics } {
  const outputDimensions = rawLensfunOutputDimensions(sourceWidth, sourceHeight, correction);
  const outputWidth = outputDimensions.width;
  const outputHeight = outputDimensions.height;
  const crop = normalizedRawLensfunCrop(correction);
  const expectedOutputLength = outputWidth * outputHeight * 3;
  if (output.length < expectedOutputLength) {
    throw new Error("RAW master one-pass output buffer is too small");
  }
  const startRow = Math.min(outputHeight, Math.max(0, Math.floor(rowStart)));
  const endRow = Math.min(outputHeight, Math.max(startRow, Math.floor(rowEnd)));
  const coordinates: [number, number, number, number, number, number] = [0, 0, 0, 0, 0, 0];
  const gains: [number, number, number] = [1, 1, 1];
  const colorOutput: [number, number, number] = [0, 0, 0];
  const headroomAccumulator = tonePlan || fallbackPlan ? createHeadroomAccumulator() : null;
  const vibranceFactor = colorPlan?.hasVibrance
    ? Math.min(16, Math.max(-16, Math.round(colorPlan.vibranceFactor * 10) / 10))
    : 0;

  // Precompute plan-only constants once. The old path rebuilt logarithm
  // denominators, sigmoid endpoint normalization, rolloff shoulders, and
  // vibrance logarithms for every full-resolution pixel.
  const toneGain = tonePlan?.gain ?? 0;
  const toneSlopeAtWhite = tonePlan?.toneSlopeAtWhite ?? 1;
  const toneScaledLog = tonePlan
    ? Math.min(
      RAW_THUMBNAIL_MATCH_LOG_MAX,
      Math.max(RAW_THUMBNAIL_MATCH_LOG_MIN, tonePlan.scaledLog),
    )
    : 0;
  const toneScaledLogMode = toneScaledLog > 1e-8 ? 1 : toneScaledLog < -1e-8 ? -1 : 0;
  const toneScaledLogMagnitude = Math.abs(toneScaledLog);
  const toneScaledLogDenominator = toneScaledLogMode === 0
    ? 0
    : Math.log1p(toneScaledLogMagnitude);

  const toneSigmoid = tonePlan
    ? Math.min(
      RAW_THUMBNAIL_MATCH_SIGMOID_MAX,
      Math.max(RAW_THUMBNAIL_MATCH_SIGMOID_MIN, tonePlan.sigmoid),
    )
    : 0;
  const toneSigmoidMode = toneSigmoid > 1e-8 ? 1 : toneSigmoid < -1e-8 ? -1 : 0;
  const toneSigmoidMagnitude = Math.abs(toneSigmoid);
  let toneSigmoidMin = 0;
  let toneSigmoidRange = 1;
  let toneSigmoidLogisticMin = 0;
  let toneSigmoidLogisticRange = 0;
  if (toneSigmoidMode > 0) {
    toneSigmoidMin = naiveSigmoid(0, toneSigmoidMagnitude, 0.5);
    const maxVal = naiveSigmoid(1, toneSigmoidMagnitude, 0.5);
    toneSigmoidRange = maxVal - toneSigmoidMin;
  } else if (toneSigmoidMode < 0) {
    toneSigmoidLogisticMin = naiveSigmoid(0, toneSigmoidMagnitude, 0.5);
    const logisticMax = naiveSigmoid(1, toneSigmoidMagnitude, 0.5);
    toneSigmoidLogisticRange = logisticMax - toneSigmoidLogisticMin;
    const inverseEndpoint = (value: number): number => {
      const a = toneSigmoidLogisticRange * value + toneSigmoidLogisticMin;
      return -Math.log(1 / a - 1) / toneSigmoidMagnitude;
    };
    toneSigmoidMin = inverseEndpoint(0);
    toneSigmoidRange = inverseEndpoint(1) - toneSigmoidMin;
  }

  const toneRolloffInflection = tonePlan?.rolloff?.inflection ?? Number.POSITIVE_INFINITY;
  const toneRolloffShoulder = tonePlan?.rolloff
    ? tonePlan.rolloff.outputMax - tonePlan.rolloff.inflection
    : 0;
  const fallbackFactor = fallbackPlan?.factor ?? 1;
  const fallbackRolloffInflection = fallbackPlan?.rolloff?.inflection ?? Number.POSITIVE_INFINITY;
  const fallbackRolloffShoulder = fallbackPlan?.rolloff
    ? fallbackPlan.rolloff.outputMax - fallbackPlan.rolloff.inflection
    : 0;
  const vibranceLog1pMagnitude = Math.abs(vibranceFactor) > 1e-6
    ? Math.log1p(Math.abs(vibranceFactor))
    : 0;
  const saturationRolloffInflection = colorPlan?.saturationRolloff?.inflection
    ?? Number.POSITIVE_INFINITY;
  const saturationRolloffShoulder = colorPlan?.saturationRolloff
    ? colorPlan.saturationRolloff.outputMax - colorPlan.saturationRolloff.inflection
    : 0;

  let targetIndex = startRow * outputWidth * 3;
  for (let y = startRow; y < endRow; y++) {
    const outputY = rawLensfunOutputCoordinate(
      y,
      outputHeight,
      sourceHeight,
      crop.top,
      crop.bottom,
    );
    for (let x = 0; x < outputWidth; x++, targetIndex += 3) {
      const outputX = rawLensfunOutputCoordinate(
        x,
        outputWidth,
        sourceWidth,
        crop.left,
        crop.right,
      );
      rawLensfunSourceCoordinatesInto(correction, outputX, outputY, coordinates);
      const sampledR = sampleRawStoredChannelBilinear(
        data, sourceWidth, sourceHeight, coordinates[0], coordinates[1], 0,
        sourceLinearRangeMax, sourceTransfer,
      );
      const sampledG = sampleRawStoredChannelBilinear(
        data, sourceWidth, sourceHeight, coordinates[2], coordinates[3], 1,
        sourceLinearRangeMax, sourceTransfer,
      );
      const sampledB = sampleRawStoredChannelBilinear(
        data, sourceWidth, sourceHeight, coordinates[4], coordinates[5], 2,
        sourceLinearRangeMax, sourceTransfer,
      );
      if (sampledR === null || sampledG === null || sampledB === null) {
        if (headroomAccumulator) recordHeadroom(headroomAccumulator, 0, 0, 0);
        continue;
      }

      let r = sampledR;
      let g = sampledG;
      let b = sampledB;
      if (correction?.vignetting && !correction.vignettingBaked) {
        rawLensfunVignettingGainInto(correction, coordinates[0], coordinates[1], gains);
        r *= gains[0];
        rawLensfunVignettingGainInto(correction, coordinates[2], coordinates[3], gains);
        g *= gains[1];
        rawLensfunVignettingGainInto(correction, coordinates[4], coordinates[5], gains);
        b *= gains[2];
      }

      // Preserve the former LensFun-resample buffer's [0,2] representable range,
      // but keep the values in float until the final gamma-2.0 encode.
      r = Math.min(RAW_DEVELOPED_LINEAR_RANGE_MAX, Math.max(0, r));
      g = Math.min(RAW_DEVELOPED_LINEAR_RANGE_MAX, Math.max(0, g));
      b = Math.min(RAW_DEVELOPED_LINEAR_RANGE_MAX, Math.max(0, b));

      if (tonePlan) {
        const luma = PROPHOTO_LUMA_R * r + PROPHOTO_LUMA_G * g + PROPHOTO_LUMA_B * b;
        if (luma > 1e-12) {
          const exposed = luma * toneGain;
          let adjustedLuma: number;
          if (exposed <= 1) {
            let logarithmic = clamp01(exposed);
            if (toneScaledLogMode > 0) {
              logarithmic = clamp01(
                Math.log1p(logarithmic * toneScaledLogMagnitude) / toneScaledLogDenominator,
              );
            } else if (toneScaledLogMode < 0) {
              logarithmic = clamp01(
                Math.expm1(logarithmic * toneScaledLogDenominator) / toneScaledLogMagnitude,
              );
            }

            if (toneSigmoidMode === 0) {
              adjustedLuma = logarithmic;
            } else {
              const gamma = SIGMOID_WORKING_GAMMA;
              const encoded = Math.pow(logarithmic, 1 / gamma);
              let adjustedEncoded: number;
              if (toneSigmoidMode > 0) {
                const sigmoid = 1 / (
                  1 + Math.exp((0.5 - encoded) * toneSigmoidMagnitude)
                );
                adjustedEncoded = clamp01(
                  (sigmoid - toneSigmoidMin) / toneSigmoidRange,
                );
              } else {
                const a = toneSigmoidLogisticRange * encoded + toneSigmoidLogisticMin;
                const inverse = -Math.log(1 / a - 1) / toneSigmoidMagnitude;
                adjustedEncoded = clamp01(
                  (inverse - toneSigmoidMin) / toneSigmoidRange,
                );
              }
              adjustedLuma = clamp01(Math.pow(adjustedEncoded, gamma));
            }
          } else {
            adjustedLuma = 1 + toneSlopeAtWhite * (exposed - 1);
          }
          const scale = adjustedLuma / luma;
          r *= scale;
          g *= scale;
          b *= scale;
          const maxChannel = Math.max(r, g, b);
          if (maxChannel > toneRolloffInflection && toneRolloffShoulder > 0) {
            const rolledMax = toneRolloffInflection
              + toneRolloffShoulder * (
                1 - Math.exp(-(maxChannel - toneRolloffInflection) / toneRolloffShoulder)
              );
            const rolloffScale = rolledMax / maxChannel;
            r *= rolloffScale;
            g *= rolloffScale;
            b *= rolloffScale;
          }
        } else {
          r = 0;
          g = 0;
          b = 0;
        }
      } else if (fallbackPlan) {
        r *= fallbackFactor;
        g *= fallbackFactor;
        b *= fallbackFactor;
        const maxChannel = Math.max(r, g, b);
        if (maxChannel > fallbackRolloffInflection && fallbackRolloffShoulder > 0) {
          const rolledMax = fallbackRolloffInflection
            + fallbackRolloffShoulder * (
              1 - Math.exp(-(maxChannel - fallbackRolloffInflection) / fallbackRolloffShoulder)
            );
          const rolloffScale = rolledMax / maxChannel;
          r *= rolloffScale;
          g *= rolloffScale;
          b *= rolloffScale;
        }
      }

      if (headroomAccumulator) recordHeadroom(headroomAccumulator, r, g, b);

      if (colorPlan && (colorPlan.hasSaturation || colorPlan.hasVibrance)) {
        applyRawColorToLinearRgb(
          r,
          g,
          b,
          colorPlan,
          vibranceFactor,
          colorOutput,
          vibranceLog1pMagnitude,
          saturationRolloffInflection,
          saturationRolloffShoulder,
        );
        r = colorOutput[0];
        g = colorOutput[1];
        b = colorOutput[2];
      }

      output[targetIndex] = encodeGamma20Uint16(r, RAW_DEVELOPED_LINEAR_RANGE_MAX);
      output[targetIndex + 1] = encodeGamma20Uint16(g, RAW_DEVELOPED_LINEAR_RANGE_MAX);
      output[targetIndex + 2] = encodeGamma20Uint16(b, RAW_DEVELOPED_LINEAR_RANGE_MAX);
    }
  }

  return {
    width: outputWidth,
    height: outputHeight,
    ...(headroomAccumulator ? { headroom: finishHeadroom(headroomAccumulator) } : {}),
  };
}

export function developRawMasterOnePassToGamma20(
  data: Uint16Array,
  sourceWidth: number,
  sourceHeight: number,
  sourceLinearRangeMax: number,
  sourceTransfer: RawStorageTransfer,
  correction: RawLensfunCorrectionMaps | undefined,
  tonePlan: RawMatchedTonePlan | undefined,
  fallbackPlan: RawFallbackPlan | undefined,
  colorPlan: RawColorPassPlan | undefined,
): { data: Uint16Array; width: number; height: number; headroom?: RawHeadroomStatistics } {
  const outputDimensions = rawLensfunOutputDimensions(sourceWidth, sourceHeight, correction);
  const output = new Uint16Array(outputDimensions.width * outputDimensions.height * 3);
  const result = developRawMasterOnePassRowsToGamma20(
    data,
    sourceWidth,
    sourceHeight,
    sourceLinearRangeMax,
    sourceTransfer,
    correction,
    tonePlan,
    fallbackPlan,
    colorPlan,
    output,
    0,
    outputDimensions.height,
  );
  return { data: output, ...result };
}

export function resampleRawWithLensfunToGamma20(
  data: Uint16Array,
  sourceWidth: number,
  sourceHeight: number,
  sourceLinearRangeMax: number,
  sourceTransfer: RawStorageTransfer,
  correction: RawLensfunCorrectionMaps | undefined,
  targetWidth: number,
  targetHeight: number,
): Uint16Array {
  const outputWidth = Math.max(1, Math.round(targetWidth));
  const outputHeight = Math.max(1, Math.round(targetHeight));
  const crop = normalizedRawLensfunCrop(correction);
  const output = new Uint16Array(outputWidth * outputHeight * 3);
  const coordinates: [number, number, number, number, number, number] = [0, 0, 0, 0, 0, 0];
  const gains: [number, number, number] = [1, 1, 1];
  let targetIndex = 0;
  for (let y = 0; y < outputHeight; y++) {
    const outputY = rawLensfunOutputCoordinate(
      y,
      outputHeight,
      sourceHeight,
      crop.top,
      crop.bottom,
    );
    for (let x = 0; x < outputWidth; x++, targetIndex += 3) {
      const outputX = rawLensfunOutputCoordinate(
        x,
        outputWidth,
        sourceWidth,
        crop.left,
        crop.right,
      );
      rawLensfunSourceCoordinatesInto(correction, outputX, outputY, coordinates);
      const r = sampleRawStoredChannelBilinear(
        data, sourceWidth, sourceHeight, coordinates[0], coordinates[1], 0,
        sourceLinearRangeMax, sourceTransfer,
      );
      const g = sampleRawStoredChannelBilinear(
        data, sourceWidth, sourceHeight, coordinates[2], coordinates[3], 1,
        sourceLinearRangeMax, sourceTransfer,
      );
      const b = sampleRawStoredChannelBilinear(
        data, sourceWidth, sourceHeight, coordinates[4], coordinates[5], 2,
        sourceLinearRangeMax, sourceTransfer,
      );
      if (r === null || g === null || b === null) continue;
      let rr = r;
      let gg = g;
      let bb = b;
      if (correction?.vignetting && !correction.vignettingBaked) {
        rawLensfunVignettingGainInto(correction, coordinates[0], coordinates[1], gains);
        rr *= gains[0];
        rawLensfunVignettingGainInto(correction, coordinates[2], coordinates[3], gains);
        gg *= gains[1];
        rawLensfunVignettingGainInto(correction, coordinates[4], coordinates[5], gains);
        bb *= gains[2];
      }
      output[targetIndex] = encodeGamma20Uint16(rr, RAW_DEVELOPED_LINEAR_RANGE_MAX);
      output[targetIndex + 1] = encodeGamma20Uint16(gg, RAW_DEVELOPED_LINEAR_RANGE_MAX);
      output[targetIndex + 2] = encodeGamma20Uint16(bb, RAW_DEVELOPED_LINEAR_RANGE_MAX);
    }
  }
  return output;
}

export function convertRawLinearToGamma20InPlace(
  data: Uint16Array,
  linearRangeMax: number,
): void {
  for (let i = 0; i < data.length; i++) {
    const linear = decodeLinearUint16(data[i] ?? 0, linearRangeMax);
    data[i] = encodeGamma20Uint16(linear, linearRangeMax);
  }
}

function scalarMeanStddev(data: Float32Array): { mean: number; stddev: number } {
  if (!data.length) return { mean: 0, stddev: 0 };
  let sum = 0;
  let sumSq = 0;
  for (let i = 0; i < data.length; i++) {
    const value = data[i] ?? 0;
    sum += value;
    sumSq += value * value;
  }
  const mean = sum / data.length;
  const variance = Math.max(0, sumSq / data.length - mean * mean);
  return { mean, stddev: Math.sqrt(variance) };
}

function scalarPercentile(sorted: Float32Array, percentile: number): number {
  if (!sorted.length) return 0;
  const position = clamp01(percentile / 100) * (sorted.length - 1);
  const lower = Math.floor(position);
  const upper = Math.min(sorted.length - 1, lower + 1);
  const fraction = position - lower;
  return (sorted[lower] ?? 0) * (1 - fraction) + (sorted[upper] ?? 0) * fraction;
}

function gaussianBlurScalar(
  source: Float32Array,
  width: number,
  height: number,
  sigma: number,
): Float32Array {
  if (sigma <= 0 || width <= 1 || height <= 1) return source.slice();
  const radius = Math.max(1, Math.ceil(sigma * 3));
  const kernel = new Float32Array(radius * 2 + 1);
  let kernelSum = 0;
  for (let offset = -radius; offset <= radius; offset++) {
    const value = Math.exp(-(offset * offset) / (2 * sigma * sigma));
    kernel[offset + radius] = value;
    kernelSum += value;
  }
  for (let i = 0; i < kernel.length; i++) kernel[i] /= kernelSum;

  const horizontal = new Float32Array(source.length);
  for (let y = 0; y < height; y++) {
    const row = y * width;
    for (let x = 0; x < width; x++) {
      let value = 0;
      for (let offset = -radius; offset <= radius; offset++) {
        const sx = Math.min(width - 1, Math.max(0, x + offset));
        value += (source[row + sx] ?? 0) * (kernel[offset + radius] ?? 0);
      }
      horizontal[row + x] = value;
    }
  }

  const output = new Float32Array(source.length);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let value = 0;
      for (let offset = -radius; offset <= radius; offset++) {
        const sy = Math.min(height - 1, Math.max(0, y + offset));
        value += (horizontal[sy * width + x] ?? 0) * (kernel[offset + radius] ?? 0);
      }
      output[y * width + x] = value;
    }
  }
  return output;
}

function estimateLaplacianNoiseFloor(
  laplacian: Float32Array,
  width: number,
  height: number,
  numTiles = 400,
  percentile = 10,
): number {
  if (!laplacian.length) return 0;
  const tileSide = Math.max(1, Math.round(Math.sqrt(width * height / numTiles)));
  const tileMeans: number[] = [];
  for (let y0 = 0; y0 < height; y0 += tileSide) {
    const y1 = Math.min(height, y0 + tileSide);
    for (let x0 = 0; x0 < width; x0 += tileSide) {
      const x1 = Math.min(width, x0 + tileSide);
      let sum = 0;
      let count = 0;
      for (let y = y0; y < y1; y++) {
        const row = y * width;
        for (let x = x0; x < x1; x++) {
          sum += laplacian[row + x] ?? 0;
          count++;
        }
      }
      if (count > 0) tileMeans.push(sum / count);
    }
  }
  if (!tileMeans.length) return 0;
  tileMeans.sort((a, b) => a - b);
  const count = Math.max(1, Math.floor(tileMeans.length * percentile / 100));
  let sum = 0;
  for (let i = 0; i < count; i++) sum += tileMeans[i] ?? 0;
  return sum / count;
}

export function analyzeRawDenoiseMask(
  data: Uint16Array,
  width: number,
  height: number,
  linearRangeMax: number,
  transfer: RawStorageTransfer,
  iso?: number | null,
): RawDenoiseMaskAnalysis {
  const pixels = Math.max(0, width * height);
  if (!pixels || data.length < pixels * 3) {
    return {
      weight: new Float32Array(),
      width,
      height,
      smoothMean: 0,
      smoothStddev: 0,
      shadowMean: 0,
      shadowStddev: 0,
      weightMean: 0,
      weightStddev: 0,
      weightP50: 0,
      weightP90: 0,
      weightP99: 0,
    };
  }

  const luma = new Float32Array(pixels);
  for (let pixel = 0, source = 0; pixel < pixels; pixel++, source += 3) {
    const r = decodeStoredUint16(data[source] ?? 0, linearRangeMax, transfer);
    const g = decodeStoredUint16(data[source + 1] ?? 0, linearRangeMax, transfer);
    const b = decodeStoredUint16(data[source + 2] ?? 0, linearRangeMax, transfer);
    luma[pixel] = PROPHOTO_LUMA_R * r + PROPHOTO_LUMA_G * g + PROPHOTO_LUMA_B * b;
  }

  // Suppress single-pixel noise before measuring structure. This follows the
  // existing itb_stack sharpness idea: combine high-frequency Laplacian with
  // lower-frequency Sobel after a small blur, and subtract an estimated noise floor.
  const blurred = gaussianBlurScalar(luma, width, height, 1.0);
  const laplacian = new Float32Array(pixels);
  const sobel = new Float32Array(pixels);
  for (let y = 0; y < height; y++) {
    const ym = Math.max(0, y - 1);
    const yp = Math.min(height - 1, y + 1);
    for (let x = 0; x < width; x++) {
      const xm = Math.max(0, x - 1);
      const xp = Math.min(width - 1, x + 1);
      const center = blurred[y * width + x] ?? 0;
      const left = blurred[y * width + xm] ?? 0;
      const right = blurred[y * width + xp] ?? 0;
      const top = blurred[ym * width + x] ?? 0;
      const bottom = blurred[yp * width + x] ?? 0;
      laplacian[y * width + x] = Math.abs(left + right + top + bottom - 4 * center);

      const tl = blurred[ym * width + xm] ?? 0;
      const tc = blurred[ym * width + x] ?? 0;
      const tr = blurred[ym * width + xp] ?? 0;
      const ml = blurred[y * width + xm] ?? 0;
      const mr = blurred[y * width + xp] ?? 0;
      const bl = blurred[yp * width + xm] ?? 0;
      const bc = blurred[yp * width + x] ?? 0;
      const br = blurred[yp * width + xp] ?? 0;
      const gx = -tl + tr - 2 * ml + 2 * mr - bl + br;
      const gy = -tl - 2 * tc - tr + bl + 2 * bc + br;
      sobel[y * width + x] = Math.hypot(gx, gy);
    }
  }

  const noiseFloor = estimateLaplacianNoiseFloor(laplacian, width, height);
  for (let i = 0; i < laplacian.length; i++) {
    laplacian[i] = Math.max(0, (laplacian[i] ?? 0) - 0.5 * noiseFloor);
  }
  const lapStats = scalarMeanStddev(laplacian);
  const sobelStats = scalarMeanStddev(sobel);
  const sharp = new Float32Array(pixels);
  for (let i = 0; i < pixels; i++) {
    const lapZ = ((laplacian[i] ?? 0) - lapStats.mean) / Math.max(lapStats.stddev, 1e-12);
    const sobelZ = ((sobel[i] ?? 0) - sobelStats.mean) / Math.max(sobelStats.stddev, 1e-12);
    sharp[i] = 0.5 * lapZ + 0.5 * sobelZ;
  }

  // Normalize the combined sharpness field once more after mixing Laplacian
  // and Sobel. Their individual z-scores do not guarantee unit variance after
  // combination. A +/-1.5 sigma transition keeps the mask soft instead of
  // snapping a large fraction of pixels to fully smooth or fully sharp.
  const sharpStats = scalarMeanStddev(sharp);
  const sharpStddev = Math.max(sharpStats.stddev, 1e-12);

  // Judge shadow depth relative to the image instead of against fixed display
  // luminance thresholds. Global exposure/ISO gain shifts log luminance by an
  // approximately constant amount, which disappears after z-score normalization.
  // A small floor prevents clipped black pixels from producing -Infinity.
  const logLuma = new Float32Array(pixels);
  for (let i = 0; i < pixels; i++) {
    logLuma[i] = Math.log2(Math.max(luma[i] ?? 0, 1e-6));
  }
  const logLumaStats = scalarMeanStddev(logLuma);
  const logLumaStddev = Math.max(logLumaStats.stddev, 1e-12);

  const rawWeight = new Float32Array(pixels);
  let smoothSum = 0;
  let smoothSumSq = 0;
  let shadowSum = 0;
  let shadowSumSq = 0;
  for (let i = 0; i < pixels; i++) {
    const sharpZ = ((sharp[i] ?? 0) - sharpStats.mean) / sharpStddev;
    const smooth = 1 - smoothstep(-1.5, 1.5, sharpZ);
    const lumaZ = ((logLuma[i] ?? 0) - logLumaStats.mean) / logLumaStddev;
    const shadow = 1 - smoothstep(-1.5, 1.5, lumaZ);
    rawWeight[i] = smooth * (0.25 + 0.75 * shadow);
    smoothSum += smooth;
    smoothSumSq += smooth * smooth;
    shadowSum += shadow;
    shadowSumSq += shadow * shadow;
  }

  // The displayed/debugged map is the actual final blend weight, including the
  // soft spatial transition that will later be sampled at Master resolution.
  // ISO then bends only the blend strength, not the spatial classification:
  // ISO 400 is neutral, and every stop changes logarithm by +/-2 using the same
  // scaled-log mapping as the Tone logarithm control.
  const weight = gaussianBlurScalar(rawWeight, width, height, 1.2);
  const validIso = typeof iso === "number" && Number.isFinite(iso) && iso > 0;
  const isoLogarithm = validIso
    ? RAW_DENOISE_ISO_LOG_PER_STOP * Math.log2(iso / RAW_DENOISE_ISO_NEUTRAL)
    : 0;
  for (let i = 0; i < weight.length; i++) {
    const baseWeight = clamp01(weight[i] ?? 0);
    weight[i] = applyScaledLogLinear(baseWeight, isoLogarithm);
  }
  const weightStats = scalarMeanStddev(weight);
  const sortedWeight = weight.slice();
  sortedWeight.sort();
  const smoothMean = smoothSum / pixels;
  const shadowMean = shadowSum / pixels;

  return {
    weight,
    width,
    height,
    smoothMean,
    smoothStddev: Math.sqrt(Math.max(0, smoothSumSq / pixels - smoothMean * smoothMean)),
    shadowMean,
    shadowStddev: Math.sqrt(Math.max(0, shadowSumSq / pixels - shadowMean * shadowMean)),
    weightMean: weightStats.mean,
    weightStddev: weightStats.stddev,
    weightP50: scalarPercentile(sortedWeight, 50),
    weightP90: scalarPercentile(sortedWeight, 90),
    weightP99: scalarPercentile(sortedWeight, 99),
  };
}

export function mergeRawDenoiseGamma20InPlaceRows(
  master: Uint16Array,
  denoise: Uint16Array,
  width: number,
  height: number,
  weight: Float32Array,
  weightWidth: number,
  weightHeight: number,
  startRow: number,
  endRow: number,
): void {
  const imageWidth = Math.max(1, Math.round(width));
  const imageHeight = Math.max(1, Math.round(height));
  const maskWidth = Math.max(1, Math.round(weightWidth));
  const maskHeight = Math.max(1, Math.round(weightHeight));
  if (master.length < imageWidth * imageHeight * 3 || denoise.length < imageWidth * imageHeight * 3) {
    throw new Error("RAW denoise merge buffer is smaller than the image");
  }
  if (weight.length < maskWidth * maskHeight) {
    throw new Error("RAW denoise weight map buffer is smaller than the mask");
  }

  const yBegin = Math.max(0, Math.min(imageHeight, Math.floor(startRow)));
  const yEnd = Math.max(yBegin, Math.min(imageHeight, Math.ceil(endRow)));
  const invMax = 1 / 65535;

  for (let y = yBegin; y < yEnd; y++) {
    const maskY = Math.max(0, Math.min(
      maskHeight - 1,
      (y + 0.5) * maskHeight / imageHeight - 0.5,
    ));
    const y0 = Math.floor(maskY);
    const y1 = Math.min(maskHeight - 1, y0 + 1);
    const ty = maskY - y0;
    const row0 = y0 * maskWidth;
    const row1 = y1 * maskWidth;
    for (let x = 0; x < imageWidth; x++) {
      const maskX = Math.max(0, Math.min(
        maskWidth - 1,
        (x + 0.5) * maskWidth / imageWidth - 0.5,
      ));
      const x0 = Math.floor(maskX);
      const x1 = Math.min(maskWidth - 1, x0 + 1);
      const tx = maskX - x0;
      const w00 = weight[row0 + x0] ?? 0;
      const w10 = weight[row0 + x1] ?? 0;
      const w01 = weight[row1 + x0] ?? 0;
      const w11 = weight[row1 + x1] ?? 0;
      const top = w00 + (w10 - w00) * tx;
      const bottom = w01 + (w11 - w01) * tx;
      const blend = clamp01(top + (bottom - top) * ty);
      const base = (y * imageWidth + x) * 3;
      for (let channel = 0; channel < 3; channel++) {
        const index = base + channel;
        const masterEncoded = (master[index] ?? 0) * invMax;
        const denoiseEncoded = (denoise[index] ?? 0) * invMax;
        // Both developed images use gamma 2.0 storage with the same linear range.
        // Decode to linear light, blend there, then encode back into D in place.
        // Use weighted geometric mean instead of arithmetic mean so that, in
        // shadow regions, the blend tends to favor the lower signal estimate and
        // suppress positive-going bright noise more aggressively.
        const masterLinear = masterEncoded * masterEncoded;
        const denoiseLinear = denoiseEncoded * denoiseEncoded;
        const epsilon = invMax * invMax;
        const mixedLinear = Math.exp(
          (1 - blend) * Math.log(masterLinear + epsilon)
          + blend * Math.log(denoiseLinear + epsilon),
        ) - epsilon;
        denoise[index] = Math.round(Math.sqrt(Math.max(0, mixedLinear)) * 65535);
      }
    }
  }
}

