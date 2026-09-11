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

export type RawStorageTransfer = "linear" | "gamma20";

export type RawFallbackPlan = {
  factor: number;
  rolloff: { inflection: number; scale: number } | null;
};

export type RawLensfunCorrectionMaps = {
  gridWidth: number;
  gridHeight: number;
  step: number;
  geometry: Float32Array;
  distortion: boolean;
  combined?: Float32Array;
  tca?: Float32Array;
  vignetting?: Float32Array;
  vignettingBaked?: boolean;
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
  plan: RawFallbackPlan;
};

const HISTOGRAM_DISPLAY_GAMMA = 2.4;
const RAW_DEVELOPED_LINEAR_RANGE_MAX = 2;
const RAW_HEADROOM_HISTOGRAM_STEP = 0.1;
const RAW_HEADROOM_HISTOGRAM_MAX = 2;
const RAW_BASELINE_PERCENTILE = 98;
const RAW_BASELINE_TARGET = 0.9;
const RAW_BASELINE_ROLLOFF_PERCENTILE = 99.8;
const RAW_BASELINE_ROLLOFF_TARGET = RAW_DEVELOPED_LINEAR_RANGE_MAX;
const RAW_BASELINE_ROLLOFF_ASYMPTOTIC = 1;
const RAW_BASELINE_ROLLOFF_SAVING_LIMIT = 8;
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

function applyRolloffScalar(
  value: number,
  rolloff: { inflection: number; scale: number } | null,
): number {
  if (!rolloff || value <= rolloff.inflection) return value;
  return rolloff.inflection + (value - rolloff.inflection) * rolloff.scale;
}

function rolloffParams(
  maxVal: number,
  target: number,
  asymptotic: number,
  savingLimit: number,
): { inflection: number; scale: number } | null {
  if (maxVal <= target) return null;
  if (maxVal > savingLimit) {
    asymptotic = target * Math.pow(asymptotic / target, savingLimit / maxVal);
  }
  const inflection = asymptotic + target * (target - asymptotic) / maxVal;
  const scale = (target - inflection) / (maxVal - inflection + 1e-6);
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

function applyRawColorToLinearRgb(
  r: number,
  g: number,
  b: number,
  plan: RawColorPassPlan,
  vibranceFactor: number,
  output: [number, number, number],
): void {
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
  let saturation = max <= 1e-6 ? 0 : delta / max;
  const value = max;
  saturation = clamp01(saturation);
  if (plan.hasSaturation) {
    saturation = clamp01(
      applyRolloffScalar(saturation * plan.saturationFactor, plan.saturationRolloff),
    );
  }
  if (plan.hasVibrance) {
    const x = clamp01(saturation);
    if (vibranceFactor > 1e-6) {
      saturation = clamp01(Math.log1p(x * vibranceFactor) / Math.log1p(vibranceFactor));
    } else if (vibranceFactor < -1e-6) {
      const magnitude = -vibranceFactor;
      saturation = clamp01(Math.expm1(x * Math.log1p(magnitude)) / magnitude);
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
      const r = applyRolloffScalar(
        decodeStoredUint16(data[i] ?? 0, sourceLinearRangeMax, sourceTransfer) * gains[0] * plan.factor,
        plan.rolloff,
      );
      const g = applyRolloffScalar(
        decodeStoredUint16(data[i + 1] ?? 0, sourceLinearRangeMax, sourceTransfer) * gains[1] * plan.factor,
        plan.rolloff,
      );
      const b = applyRolloffScalar(
        decodeStoredUint16(data[i + 2] ?? 0, sourceLinearRangeMax, sourceTransfer) * gains[2] * plan.factor,
        plan.rolloff,
      );
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
  const channelHistogram = new Uint32Array(65536);
  const pixelCount = width * height;
  if (pixelCount <= 0) return null;
  const gains: [number, number, number] = [1, 1, 1];
  let i = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++, i += 3) {
      vignettingGainInto(vignetting, x, y, gains);
      const r = decodeStoredUint16(data[i] ?? 0, sourceLinearRangeMax, sourceTransfer) * gains[0];
      const g = decodeStoredUint16(data[i + 1] ?? 0, sourceLinearRangeMax, sourceTransfer) * gains[1];
      const b = decodeStoredUint16(data[i + 2] ?? 0, sourceLinearRangeMax, sourceTransfer) * gains[2];
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
  const plan: RawFallbackPlan = {
    factor,
    rolloff: rolloffParams(
      channelMax,
      RAW_BASELINE_ROLLOFF_TARGET,
      RAW_BASELINE_ROLLOFF_ASYMPTOTIC,
      RAW_BASELINE_ROLLOFF_SAVING_LIMIT,
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
): { data: Uint16Array; headroom?: RawHeadroomStatistics } {
  const outputWidth = Math.max(1, Math.round(sourceWidth));
  const outputHeight = Math.max(1, Math.round(sourceHeight));
  const output = new Uint16Array(outputWidth * outputHeight * 3);
  const coordinates: [number, number, number, number, number, number] = [0, 0, 0, 0, 0, 0];
  const gains: [number, number, number] = [1, 1, 1];
  const colorOutput: [number, number, number] = [0, 0, 0];
  const headroomAccumulator = tonePlan || fallbackPlan ? createHeadroomAccumulator() : null;
  const vibranceFactor = colorPlan?.hasVibrance
    ? Math.min(16, Math.max(-16, Math.round(colorPlan.vibranceFactor * 10) / 10))
    : 0;

  let targetIndex = 0;
  for (let y = 0; y < outputHeight; y++) {
    for (let x = 0; x < outputWidth; x++, targetIndex += 3) {
      rawLensfunSourceCoordinatesInto(correction, x, y, coordinates);
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
          const adjustedLuma = transformedRawLumaValueExtended(
            luma,
            tonePlan.gain,
            tonePlan.scaledLog,
            tonePlan.sigmoid,
            tonePlan.toneSlopeAtWhite,
          );
          const scale = adjustedLuma / luma;
          r *= scale;
          g *= scale;
          b *= scale;
        } else {
          r = 0;
          g = 0;
          b = 0;
        }
      } else if (fallbackPlan) {
        r = applyRolloffScalar(r * fallbackPlan.factor, fallbackPlan.rolloff);
        g = applyRolloffScalar(g * fallbackPlan.factor, fallbackPlan.rolloff);
        b = applyRolloffScalar(b * fallbackPlan.factor, fallbackPlan.rolloff);
      }

      if (headroomAccumulator) recordHeadroom(headroomAccumulator, r, g, b);

      if (colorPlan && (colorPlan.hasSaturation || colorPlan.hasVibrance)) {
        applyRawColorToLinearRgb(r, g, b, colorPlan, vibranceFactor, colorOutput);
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
    data: output,
    ...(headroomAccumulator ? { headroom: finishHeadroom(headroomAccumulator) } : {}),
  };
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
  const output = new Uint16Array(outputWidth * outputHeight * 3);
  const coordinates: [number, number, number, number, number, number] = [0, 0, 0, 0, 0, 0];
  const gains: [number, number, number] = [1, 1, 1];
  let targetIndex = 0;
  for (let y = 0; y < outputHeight; y++) {
    const outputY = (y + 0.5) * sourceHeight / outputHeight - 0.5;
    for (let x = 0; x < outputWidth; x++, targetIndex += 3) {
      const outputX = (x + 0.5) * sourceWidth / outputWidth - 0.5;
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
