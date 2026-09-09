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
};

export type RawColorPassPlan = {
  rolloff: { inflection: number; scale: number } | null;
  hasSaturation: boolean;
  hasVibrance: boolean;
  saturationFactor: number;
  vibranceFactor: number;
  saturationRolloff: { inflection: number; scale: number } | null;
};

export type RawFallbackResult = {
  exposureEv: number;
  headroom: RawHeadroomStatistics;
};

const HISTOGRAM_DISPLAY_GAMMA = 2.4;
const RAW_DEVELOPED_LINEAR_RANGE_MAX = 2;
const RAW_HEADROOM_HISTOGRAM_STEP = 0.1;
const RAW_HEADROOM_HISTOGRAM_MAX = 2;
const RAW_BASELINE_PERCENTILE = 98;
const RAW_BASELINE_TARGET = 0.9;
const RAW_BASELINE_ROLLOFF_PERCENTILE = 99.8;
const RAW_BASELINE_ROLLOFF_ASYMPTOTIC = 0.5;
const RAW_THUMBNAIL_MATCH_LOG_MIN = -16;
const RAW_THUMBNAIL_MATCH_LOG_MAX = 16;
const RAW_THUMBNAIL_MATCH_SIGMOID_MIN = -10;
const RAW_THUMBNAIL_MATCH_SIGMOID_MAX = 10;
const PROPHOTO_LUMA_R = 0.2880402;
const PROPHOTO_LUMA_G = 0.7118741;
const PROPHOTO_LUMA_B = 0.0000857;

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function decodeLinearUint16(value: number, linearRangeMax: number): number {
  return clamp01(value / 65535) * linearRangeMax;
}

function decodeGamma20Uint16(value: number, linearRangeMax: number): number {
  const encoded = clamp01(value / 65535);
  return encoded * encoded * linearRangeMax;
}

function encodeGamma20Uint16(value: number, linearRangeMax: number): number {
  return Math.round(Math.sqrt(clamp01(value / linearRangeMax)) * 65535);
}

function applyRolloffScalar(
  value: number,
  rolloff: { inflection: number; scale: number } | null,
): number {
  if (!rolloff || value <= rolloff.inflection) return value;
  return rolloff.inflection + (value - rolloff.inflection) * rolloff.scale;
}

function rolloffParams(
  maxVal: number,
  asymptotic = 0.5,
  savingLimit = 4,
): { inflection: number; scale: number } | null {
  if (maxVal <= 1) return null;
  if (maxVal > savingLimit) {
    asymptotic = Math.pow(asymptotic, savingLimit / maxVal);
  }
  const inflection = asymptotic + (1 - asymptotic) / maxVal;
  const scale = (1 - inflection) / (maxVal - inflection + 1e-6);
  return { inflection, scale };
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
  const gamma = HISTOGRAM_DISPLAY_GAMMA;
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
): RawHeadroomStatistics {
  const headroom = createHeadroomAccumulator();
  const gains: [number, number, number] = [1, 1, 1];
  let i = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++, i += 3) {
      vignettingGainInto(vignetting, x, y, gains);
      const r = decodeLinearUint16(data[i] ?? 0, sourceLinearRangeMax) * gains[0];
      const g = decodeLinearUint16(data[i + 1] ?? 0, sourceLinearRangeMax) * gains[1];
      const b = decodeLinearUint16(data[i + 2] ?? 0, sourceLinearRangeMax) * gains[2];
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
      const adjustedR = r * scale;
      const adjustedG = g * scale;
      const adjustedB = b * scale;
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
  maxSide: number,
): Float32Array {
  const scale = Math.min(1, maxSide / Math.max(width, height));
  const sampleW = Math.max(1, Math.round(width * scale));
  const sampleH = Math.max(1, Math.round(height * scale));
  const output = new Float32Array(sampleW * sampleH * 3);
  for (let y = 0; y < sampleH; y++) {
    const sy = Math.min(height - 1, Math.floor((y + 0.5) * height / sampleH));
    for (let x = 0; x < sampleW; x++) {
      const sx = Math.min(width - 1, Math.floor((x + 0.5) * width / sampleW));
      const sourceIndex = (sy * width + sx) * 3;
      const targetIndex = (y * sampleW + x) * 3;
      output[targetIndex] = decodeGamma20Uint16(data[sourceIndex] ?? 0, linearRangeMax);
      output[targetIndex + 1] = decodeGamma20Uint16(data[sourceIndex + 1] ?? 0, linearRangeMax);
      output[targetIndex + 2] = decodeGamma20Uint16(data[sourceIndex + 2] ?? 0, linearRangeMax);
    }
  }
  return output;
}

function applyColorPixelInPlace(
  data: Uint16Array,
  i: number,
  linearRangeMax: number,
  plan: RawColorPassPlan,
  vibranceFactor: number,
): void {
  let r = decodeGamma20Uint16(data[i] ?? 0, linearRangeMax);
  let g = decodeGamma20Uint16(data[i + 1] ?? 0, linearRangeMax);
  let b = decodeGamma20Uint16(data[i + 2] ?? 0, linearRangeMax);
  const extendedScale = Math.max(1, r, g, b);
  r /= extendedScale;
  g /= extendedScale;
  b /= extendedScale;

  r = clamp01(applyRolloffScalar(r, plan.rolloff));
  g = clamp01(applyRolloffScalar(g, plan.rolloff));
  b = clamp01(applyRolloffScalar(b, plan.rolloff));

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
  let s = max <= 1e-6 ? 0 : delta / max;
  const v = max;
  s = clamp01(s);
  if (plan.hasSaturation) {
    s = clamp01(applyRolloffScalar(s * plan.saturationFactor, plan.saturationRolloff));
  }
  if (plan.hasVibrance) {
    const x = clamp01(s);
    if (vibranceFactor > 1e-6) {
      s = clamp01(Math.log1p(x * vibranceFactor) / Math.log1p(vibranceFactor));
    } else if (vibranceFactor < -1e-6) {
      const magnitude = -vibranceFactor;
      s = clamp01(Math.expm1(x * Math.log1p(magnitude)) / magnitude);
    } else s = x;
  }

  const hh = ((h % 1) + 1) % 1 * 6;
  const c = clamp01(v) * clamp01(s);
  const xx = c * (1 - Math.abs(hh % 2 - 1));
  const m = clamp01(v) - c;
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
  r = clamp01(rp + m) * extendedScale;
  g = clamp01(gp + m) * extendedScale;
  b = clamp01(bp + m) * extendedScale;
  data[i] = encodeGamma20Uint16(r, linearRangeMax);
  data[i + 1] = encodeGamma20Uint16(g, linearRangeMax);
  data[i + 2] = encodeGamma20Uint16(b, linearRangeMax);
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
  for (let i = 0; i < data.length; i += 3) {
    applyColorPixelInPlace(data, i, linearRangeMax, plan, vibranceFactor);
  }
}

export function applyRawFallbackBaselinePass(
  data: Uint16Array,
  width: number,
  height: number,
  sourceLinearRangeMax: number,
  vignetting: RawVignettingMap | undefined,
): RawFallbackResult | null {
  const rmsHistogram = new Uint32Array(65536);
  const channelHistogram = new Uint32Array(65536);
  const pixelCount = width * height;
  if (pixelCount <= 0) return null;
  const gains: [number, number, number] = [1, 1, 1];
  let i = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++, i += 3) {
      vignettingGainInto(vignetting, x, y, gains);
      const r = decodeLinearUint16(data[i] ?? 0, sourceLinearRangeMax) * gains[0];
      const g = decodeLinearUint16(data[i + 1] ?? 0, sourceLinearRangeMax) * gains[1];
      const b = decodeLinearUint16(data[i + 2] ?? 0, sourceLinearRangeMax) * gains[2];
      const rms = Math.sqrt((r * r + g * g + b * b) / 3);
      rmsHistogram[Math.min(65535, Math.max(0, Math.round(rms * 65535)))]++;
      channelHistogram[Math.min(65535, Math.max(0, Math.round(r * 65535)))]++;
      channelHistogram[Math.min(65535, Math.max(0, Math.round(g * 65535)))]++;
      channelHistogram[Math.min(65535, Math.max(0, Math.round(b * 65535)))]++;
    }
  }
  const p98 = histogramPercentile16(rmsHistogram, pixelCount, RAW_BASELINE_PERCENTILE) / 65535;
  if (!(p98 > 0)) return null;
  const factor = RAW_BASELINE_TARGET / p98;
  const channelMax = histogramPercentile16(
    channelHistogram,
    pixelCount * 3,
    RAW_BASELINE_ROLLOFF_PERCENTILE,
  ) / 65535 * factor;
  const rolloff = rolloffParams(channelMax, RAW_BASELINE_ROLLOFF_ASYMPTOTIC, 4);
  const headroom = createHeadroomAccumulator();
  i = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++, i += 3) {
      vignettingGainInto(vignetting, x, y, gains);
      const r = applyRolloffScalar(
        decodeLinearUint16(data[i] ?? 0, sourceLinearRangeMax) * gains[0] * factor,
        rolloff,
      );
      const g = applyRolloffScalar(
        decodeLinearUint16(data[i + 1] ?? 0, sourceLinearRangeMax) * gains[1] * factor,
        rolloff,
      );
      const b = applyRolloffScalar(
        decodeLinearUint16(data[i + 2] ?? 0, sourceLinearRangeMax) * gains[2] * factor,
        rolloff,
      );
      recordHeadroom(headroom, r, g, b);
      data[i] = encodeGamma20Uint16(r, RAW_DEVELOPED_LINEAR_RANGE_MAX);
      data[i + 1] = encodeGamma20Uint16(g, RAW_DEVELOPED_LINEAR_RANGE_MAX);
      data[i + 2] = encodeGamma20Uint16(b, RAW_DEVELOPED_LINEAR_RANGE_MAX);
    }
  }
  return {
    exposureEv: Math.log2(Math.max(factor, Number.MIN_VALUE)),
    headroom: finishHeadroom(headroom),
  };
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
