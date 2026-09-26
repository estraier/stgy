// Pure tone/color-adjustment math. This module deliberately has no DOM or React dependency.

export function clamp01(v: number): number {
  return Math.min(1, Math.max(0, v));
}

export function clampExposureEv(v: number): number {
  if (!Number.isFinite(v)) return 0;
  return Math.min(5, Math.max(-5, Math.round(v * 10) / 10));
}

export function clampWhiteBalanceValue(v: number): number {
  return Math.min(100, Math.max(-100, Math.round(v)));
}

export function clampScaledLog(v: number, limit = 20): number {
  if (!Number.isFinite(v)) return 0;
  const bound = Number.isFinite(limit) && limit > 0 ? limit : 20;
  return Math.min(bound, Math.max(-bound, Math.round(v * 10) / 10));
}

export function clampSigmoid(v: number): number {
  if (!Number.isFinite(v)) return 0;
  return Math.min(10, Math.max(-10, Math.round(v * 10) / 10));
}

export function clampToneRangeAdjustment(v: number): number {
  if (!Number.isFinite(v)) return 0;
  return Math.min(100, Math.max(-100, Math.round(v)));
}

export function clampColorAdjustment(v: number): number {
  return Math.min(100, Math.max(-100, Math.round(v)));
}

export function clampSharpen(v: number): number {
  return Math.min(7, Math.max(0, Math.round(Number.isFinite(v) ? v : 0)));
}

export function colorSaturationFactor(saturation: number): number {
  return Math.max(0, 1 + clampColorAdjustment(saturation) / 100);
}

export function colorVibranceFactor(vibrance: number): number {
  return clampColorAdjustment(vibrance) * 3 / 100;
}

// Linear ProPhoto RGB luminance (XYZ D50 Y row). Keep these here instead of
// importing color.ts because color.ts already depends on this module.
export const PROPHOTO_TONE_LUMA_R = 0.2880402;
export const PROPHOTO_TONE_LUMA_G = 0.7118741;
export const PROPHOTO_TONE_LUMA_B = 0.0000857;
export const EXPOSURE_ROLLOFF_A = 0.5;
export const SATURATION_ROLLOFF_A = 0.7;
export const FINAL_DISPLAY_ROLLOFF_A = 0.5;
export const ROLLOFF_SAVING_LIMIT_FACTOR = 4;

export type RolloffParams = {
  inflection: number;
  // P99.8 reference value M used to place the inflection. This is not a clip point.
  inputMax: number;
  outputMax: number;
};

export type ToneRgbBuffer = [number, number, number] | number[];

const TONE_ENDPOINT_SLOPE_EPSILON = 1e-5;
const TONE_LUMINANCE_EPSILON = 1e-12;

export function proPhotoLinearLuminance(r: number, g: number, b: number): number {
  return PROPHOTO_TONE_LUMA_R * r + PROPHOTO_TONE_LUMA_G * g + PROPHOTO_TONE_LUMA_B * b;
}

function applyUnitIntervalTangentExtension(
  value: number,
  evaluator: (x: number) => number,
): number {
  if (!Number.isFinite(value)) return value;
  if (value >= 0 && value <= 1) return evaluator(value);
  const epsilon = TONE_ENDPOINT_SLOPE_EPSILON;
  if (value > 1) {
    const atOne = evaluator(1);
    const beforeOne = evaluator(1 - epsilon);
    const slope = (atOne - beforeOne) / epsilon;
    return atOne + (Number.isFinite(slope) ? slope : 1) * (value - 1);
  }
  const atZero = evaluator(0);
  const afterZero = evaluator(epsilon);
  const slope = (afterZero - atZero) / epsilon;
  return atZero + (Number.isFinite(slope) ? slope : 1) * value;
}

export function applyLuminanceMappingToRgb(
  r: number,
  g: number,
  b: number,
  mapper: (luminance: number) => number,
): [number, number, number] {
  const sourceLuminance = proPhotoLinearLuminance(r, g, b);
  if (!(sourceLuminance > TONE_LUMINANCE_EPSILON)) return [r, g, b];
  const targetLuminance = mapper(sourceLuminance);
  if (!Number.isFinite(targetLuminance)) return [r, g, b];
  const scale = targetLuminance / sourceLuminance;
  return [r * scale, g * scale, b * scale];
}

export function applyLuminanceGainPreservingAboveOneLinearRgb(
  r: number,
  g: number,
  b: number,
  gain: number,
): [number, number, number] {
  // CLAHE only defines a mapping through display white. Keep extended highlights
  // untouched even when a lower-resolution gain map is sampled at this pixel.
  if (proPhotoLinearLuminance(r, g, b) > 1 || !Number.isFinite(gain)) return [r, g, b];
  return [Math.max(0, r * gain), Math.max(0, g * gain), Math.max(0, b * gain)];
}

export function applyLuminanceGainPreservingAboveOneLinearRgbInto(
  r: number,
  g: number,
  b: number,
  gain: number,
  output: ToneRgbBuffer,
): void {
  if (proPhotoLinearLuminance(r, g, b) > 1 || !Number.isFinite(gain)) {
    output[0] = r; output[1] = g; output[2] = b;
    return;
  }
  output[0] = Math.max(0, r * gain);
  output[1] = Math.max(0, g * gain);
  output[2] = Math.max(0, b * gain);
}

export function srgbChannelToLinear(v: number): number {
  const x = clamp01(v / 255);
  if (x <= 0.04045) return x / 12.92;
  return Math.pow((x + 0.055) / 1.055, 2.4);
}

export function linearChannelToSrgb(linear: number): number {
  const x = clamp01(linear);
  const srgb = x <= 0.0031308 ? x * 12.92 : 1.055 * Math.pow(x, 1 / 2.4) - 0.055;
  return Math.round(clamp01(srgb) * 255);
}

export type WhiteBalanceGains = { r: number; g: number; b: number };

export function whiteBalanceGains(temperature: number, tint: number): WhiteBalanceGains {
  const t = clampWhiteBalanceValue(temperature) / 100;
  const m = clampWhiteBalanceValue(tint) / 100;

  // Work in log2 gain space so the three gains have a geometric mean of 1.
  // Positive temperature warms (R up, B down); positive tint moves toward magenta
  // (R/B up, G down) without introducing a global exposure shift.
  const temperatureStops = t * 1.5;
  const tintStops = m * 0.75;
  const rStops = temperatureStops + tintStops / 2;
  const gStops = -tintStops;
  const bStops = -temperatureStops + tintStops / 2;
  return {
    r: Math.pow(2, rStops),
    g: Math.pow(2, gStops),
    b: Math.pow(2, bStops),
  };
}

export function applyWhiteBalanceLinear(
  r: number,
  g: number,
  b: number,
  gains: WhiteBalanceGains,
): [number, number, number] {
  // Progressively reduce correction toward white while retaining more WB
  // through the midtones by applying gamma 0.5 to the protection mask.
  const gray = proPhotoLinearLuminance(r, g, b);
  const whiteThreshold = 0.98;
  const weight = Math.sqrt(1 - clamp01((gray - (1 - whiteThreshold)) / whiteThreshold));
  const wr = weight * gains.r + (1 - weight);
  const wg = weight * gains.g + (1 - weight);
  const wb = weight * gains.b + (1 - weight);
  // Preserve extended linear values; WB may carry values above 1 into Tone.
  return [r * wr, g * wg, b * wb];
}

export function applyWhiteBalanceLinearInto(
  r: number,
  g: number,
  b: number,
  gains: WhiteBalanceGains,
  output: ToneRgbBuffer,
): void {
  const gray = proPhotoLinearLuminance(r, g, b);
  const whiteThreshold = 0.98;
  const weight = Math.sqrt(1 - clamp01((gray - (1 - whiteThreshold)) / whiteThreshold));
  const wr = weight * gains.r + (1 - weight);
  const wg = weight * gains.g + (1 - weight);
  const wb = weight * gains.b + (1 - weight);
  output[0] = r * wr;
  output[1] = g * wg;
  output[2] = b * wb;
}

export function applyScaledLogLinear(value: number, factor: number, limit = 20): number {
  const x = clamp01(value);
  const f = clampScaledLog(factor, limit);
  if (f > 1e-6) {
    return clamp01(Math.log1p(x * f) / Math.log1p(f));
  }
  if (f < -1e-6) {
    const magnitude = -f;
    return clamp01(Math.expm1(x * Math.log1p(magnitude)) / magnitude);
  }
  return x;
}

export function applyScaledLogLinearExtended(value: number, factor: number, limit = 20): number {
  return applyUnitIntervalTangentExtension(value, (x) => applyScaledLogLinear(x, factor, limit));
}

export function naiveSigmoid(value: number, gain: number, mid: number): number {
  return 1 / (1 + Math.exp((mid - value) * gain));
}

export function naiveInverseSigmoid(value: number, gain: number, mid: number): number {
  const minVal = naiveSigmoid(0, gain, mid);
  const maxVal = naiveSigmoid(1, gain, mid);
  const a = (maxVal - minVal) * value + minVal;
  return -Math.log(1 / a - 1) / gain;
}

export function applySigmoidLinear(value: number, gain: number): number {
  const x = clamp01(value);
  const g = clampSigmoid(gain);
  const mid = 0.5;
  const gamma = SIGMOID_WORKING_GAMMA;
  const encoded = Math.pow(x, 1 / gamma);
  if (g > 1e-6) {
    const minVal = naiveSigmoid(0, g, mid);
    const maxVal = naiveSigmoid(1, g, mid);
    const adjusted = clamp01((naiveSigmoid(encoded, g, mid) - minVal) / (maxVal - minVal));
    return clamp01(Math.pow(adjusted, gamma));
  }
  if (g < -1e-6) {
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

export function applySigmoidLinearExtended(value: number, gain: number): number {
  return applyUnitIntervalTangentExtension(value, (x) => applySigmoidLinear(x, gain));
}

export function rgbToHsv(r: number, g: number, b: number): [number, number, number] {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;
  let h = 0;
  if (delta > 1e-6) {
    if (max === r) {
      h = ((g - b) / delta) % 6;
    } else if (max === g) {
      h = (b - r) / delta + 2;
    } else {
      h = (r - g) / delta + 4;
    }
    h /= 6;
    if (h < 0) h += 1;
  }
  const s = max <= 1e-6 ? 0 : delta / max;
  const v = max;
  return [h, clamp01(s), clamp01(v)];
}

export function hsvToRgb(h: number, s: number, v: number): [number, number, number] {
  const hh = ((h % 1) + 1) % 1 * 6;
  const c = clamp01(v) * clamp01(s);
  const x = c * (1 - Math.abs(hh % 2 - 1));
  const m = clamp01(v) - c;
  let rp = 0;
  let gp = 0;
  let bp = 0;
  if (hh < 1) {
    rp = c;
    gp = x;
  } else if (hh < 2) {
    rp = x;
    gp = c;
  } else if (hh < 3) {
    gp = c;
    bp = x;
  } else if (hh < 4) {
    gp = x;
    bp = c;
  } else if (hh < 5) {
    rp = x;
    bp = c;
  } else {
    rp = c;
    bp = x;
  }
  return [clamp01(rp + m), clamp01(gp + m), clamp01(bp + m)];
}

export function rgbToHsvExtended(r: number, g: number, b: number): [number, number, number] {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;
  let h = 0;
  if (delta > 1e-12) {
    if (max === r) h = ((g - b) / delta) % 6;
    else if (max === g) h = (b - r) / delta + 2;
    else h = (r - g) / delta + 4;
    h /= 6;
    if (h < 0) h += 1;
  }
  const saturation = max > 1e-12 ? delta / max : 0;
  return [h, Math.max(0, Number.isFinite(saturation) ? saturation : 0), max];
}

export function rgbSaturationExtended(r: number, g: number, b: number): number {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const saturation = max > 1e-12 ? (max - min) / max : 0;
  return Math.max(0, Number.isFinite(saturation) ? saturation : 0);
}

function hsvUnitValueShape(h: number, saturation: number): [number, number, number] {
  const hh = ((h % 1) + 1) % 1 * 6;
  const s = Math.max(0, Number.isFinite(saturation) ? saturation : 0);
  const c = s;
  const x = c * (1 - Math.abs(hh % 2 - 1));
  const m = 1 - c;
  let rp = 0;
  let gp = 0;
  let bp = 0;
  if (hh < 1) { rp = c; gp = x; }
  else if (hh < 2) { rp = x; gp = c; }
  else if (hh < 3) { gp = c; bp = x; }
  else if (hh < 4) { gp = x; bp = c; }
  else if (hh < 5) { rp = x; bp = c; }
  else { rp = c; bp = x; }
  return [rp + m, gp + m, bp + m];
}

function hsvUnitValueShapeInto(
  h: number,
  saturation: number,
  output: ToneRgbBuffer,
): void {
  const hh = ((h % 1) + 1) % 1 * 6;
  const s = Math.max(0, Number.isFinite(saturation) ? saturation : 0);
  const c = s;
  const x = c * (1 - Math.abs(hh % 2 - 1));
  const m = 1 - c;
  let rp = 0;
  let gp = 0;
  let bp = 0;
  if (hh < 1) { rp = c; gp = x; }
  else if (hh < 2) { rp = x; gp = c; }
  else if (hh < 3) { gp = c; bp = x; }
  else if (hh < 4) { gp = x; bp = c; }
  else if (hh < 5) { rp = x; bp = c; }
  else { rp = c; bp = x; }
  output[0] = rp + m;
  output[1] = gp + m;
  output[2] = bp + m;
}

export function applyHsvSaturationPreservingProPhotoLuminance(
  r: number,
  g: number,
  b: number,
  targetSaturation: number,
): [number, number, number] {
  const luminance = proPhotoLinearLuminance(r, g, b);
  if (!(luminance > TONE_LUMINANCE_EPSILON)) return [r, g, b];
  const [h] = rgbToHsvExtended(r, g, b);
  const [shapeR, shapeG, shapeB] = hsvUnitValueShape(h, targetSaturation);
  const shapeLuminance = proPhotoLinearLuminance(shapeR, shapeG, shapeB);
  if (!(shapeLuminance > TONE_LUMINANCE_EPSILON) || !Number.isFinite(shapeLuminance)) return [r, g, b];
  const scale = luminance / shapeLuminance;
  return [shapeR * scale, shapeG * scale, shapeB * scale];
}

export function applyHsvSaturationPreservingProPhotoLuminanceInto(
  r: number,
  g: number,
  b: number,
  targetSaturation: number,
  output: ToneRgbBuffer,
): void {
  const luminance = proPhotoLinearLuminance(r, g, b);
  if (!(luminance > TONE_LUMINANCE_EPSILON)) {
    output[0] = r; output[1] = g; output[2] = b;
    return;
  }
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;
  let h = 0;
  if (delta > 1e-12) {
    if (max === r) h = ((g - b) / delta) % 6;
    else if (max === g) h = (b - r) / delta + 2;
    else h = (r - g) / delta + 4;
    h /= 6;
    if (h < 0) h += 1;
  }
  hsvUnitValueShapeInto(h, targetSaturation, output);
  const shapeR = output[0] ?? 0;
  const shapeG = output[1] ?? 0;
  const shapeB = output[2] ?? 0;
  const shapeLuminance = proPhotoLinearLuminance(shapeR, shapeG, shapeB);
  if (!(shapeLuminance > TONE_LUMINANCE_EPSILON) || !Number.isFinite(shapeLuminance)) {
    output[0] = r; output[1] = g; output[2] = b;
    return;
  }
  const scale = luminance / shapeLuminance;
  output[0] = shapeR * scale;
  output[1] = shapeG * scale;
  output[2] = shapeB * scale;
}

export function rolloffParams(
  maxVal: number,
  a = EXPOSURE_ROLLOFF_A,
  savingLimit = ROLLOFF_SAVING_LIMIT_FACTOR,
  outputMax = 1,
): RolloffParams | null {
  if (!(Number.isFinite(outputMax) && outputMax > 0)) return null;
  if (!(Number.isFinite(maxVal) && maxVal > outputMax)) return null;
  if (!(Number.isFinite(a) && a >= 0 && a < outputMax)) return null;
  const savingLimitFactor = Number.isFinite(savingLimit) && savingLimit > 0
    ? savingLimit
    : ROLLOFF_SAVING_LIMIT_FACTOR;
  const savingLimitValue = outputMax * savingLimitFactor;

  // Preserve the original saving-limit behavior in normalized output-range
  // coordinates. The limit is outputMax * savingLimitFactor, not A * factor.
  let adjustedA = a;
  if (maxVal > savingLimitValue) {
    const normalizedA = a / outputMax;
    adjustedA = outputMax * Math.pow(
      normalizedA,
      savingLimitValue / maxVal,
    );
  }

  const inflection = adjustedA
    + (outputMax - adjustedA) * outputMax / maxVal;
  if (!(outputMax > inflection)) return null;
  return { inflection, inputMax: maxVal, outputMax };
}

export function applyRolloffScalar(value: number, rolloff: RolloffParams | null): number {
  if (!rolloff || !Number.isFinite(value) || value <= rolloff.inflection) return value;
  const shoulder = rolloff.outputMax - rolloff.inflection;
  if (!(shoulder > 0)) return value;
  // Smooth nonlinear shoulder. P99.8/M and A determine the inflection via
  // rolloffParams(); above that point the curve joins with slope 1 and
  // approaches outputMax asymptotically without introducing a hard clipping
  // point at M.
  return rolloff.inflection
    + shoulder * (1 - Math.exp(-(value - rolloff.inflection) / shoulder));
}

export function applyRolloffMaxChannelLinearRgb(
  r: number,
  g: number,
  b: number,
  rolloff: RolloffParams | null,
): [number, number, number] {
  const maxChannel = Math.max(r, g, b);
  if (!rolloff || !Number.isFinite(maxChannel) || maxChannel <= rolloff.inflection || maxChannel <= 0) {
    return [r, g, b];
  }
  const rolledMax = applyRolloffScalar(maxChannel, rolloff);
  if (!Number.isFinite(rolledMax)) return [r, g, b];
  const scale = rolledMax / maxChannel;
  return [r * scale, g * scale, b * scale];
}

export function applyRolloffMaxChannelLinearRgbInto(
  r: number,
  g: number,
  b: number,
  rolloff: RolloffParams | null,
  output: ToneRgbBuffer,
): void {
  const maxChannel = Math.max(r, g, b);
  if (!rolloff || !Number.isFinite(maxChannel) || maxChannel <= rolloff.inflection || maxChannel <= 0) {
    output[0] = r; output[1] = g; output[2] = b;
    return;
  }
  const rolledMax = applyRolloffScalar(maxChannel, rolloff);
  if (!Number.isFinite(rolledMax)) {
    output[0] = r; output[1] = g; output[2] = b;
    return;
  }
  const scale = rolledMax / maxChannel;
  output[0] = r * scale;
  output[1] = g * scale;
  output[2] = b * scale;
}

export function applyHighlightRolloffResultLinearRgbInto(
  r: number,
  g: number,
  b: number,
  maxChannel: number,
  rolledMax: number,
  output: ToneRgbBuffer,
): void {
  if (!(Number.isFinite(maxChannel) && maxChannel > 0 && Number.isFinite(rolledMax))) {
    output[0] = r; output[1] = g; output[2] = b;
    return;
  }
  const scale = rolledMax / maxChannel;
  if (!Number.isFinite(scale)) {
    output[0] = r; output[1] = g; output[2] = b;
    return;
  }

  const scaledR = r * scale;
  const scaledG = g * scale;
  const scaledB = b * scale;
  // Desaturation is part of the highlight rolloff itself, not a rule for values
  // above any absolute RGB threshold. Preserve the old result when there is no
  // compression, and progressively approach neutral rolledMax as the actual
  // max-channel compression becomes stronger.
  const saturationRetention = Math.min(1, Math.max(0, scale));
  if (!(saturationRetention < 1)) {
    output[0] = scaledR; output[1] = scaledG; output[2] = scaledB;
    return;
  }
  output[0] = rolledMax + (scaledR - rolledMax) * saturationRetention;
  output[1] = rolledMax + (scaledG - rolledMax) * saturationRetention;
  output[2] = rolledMax + (scaledB - rolledMax) * saturationRetention;
}

export function applyHighlightRolloffLinearRgb(
  r: number,
  g: number,
  b: number,
  rolloff: RolloffParams | null,
): [number, number, number] {
  const output: [number, number, number] = [r, g, b];
  applyHighlightRolloffLinearRgbInto(r, g, b, rolloff, output);
  return output;
}

export function applyHighlightRolloffLinearRgbInto(
  r: number,
  g: number,
  b: number,
  rolloff: RolloffParams | null,
  output: ToneRgbBuffer,
): void {
  const maxChannel = Math.max(r, g, b);
  if (!rolloff || !Number.isFinite(maxChannel) || maxChannel <= rolloff.inflection || maxChannel <= 0) {
    output[0] = r; output[1] = g; output[2] = b;
    return;
  }
  const rolledMax = applyRolloffScalar(maxChannel, rolloff);
  if (!Number.isFinite(rolledMax)) {
    output[0] = r; output[1] = g; output[2] = b;
    return;
  }
  applyHighlightRolloffResultLinearRgbInto(r, g, b, maxChannel, rolledMax, output);
}

export function applyExposureLinearToRgb(
  r: number,
  g: number,
  b: number,
  factor: number,
): [number, number, number] {
  return [r * factor, g * factor, b * factor];
}

export const SHADOW_MAX_SIGMOID_GAIN = 4;
export const SHADOW_WORKING_GAMMA = 12;
export const HIGHLIGHT_MAX_SIGMOID_GAIN = 4;
export const BLACK_MAX_TOE_WIDTH = 0.08;
export const WHITE_MAX_SHOULDER_WIDTH = 0.16;
const BLACK_LOCAL_TOE_END_MULTIPLIER = 4;
export const HIGHLIGHT_WORKING_GAMMA = 0.48;

export type HighlightRange = {
  p100: number;
};

export function applySigmoidLinearAtMidpoint(
  value: number,
  gain: number,
  midpoint: number,
): number {
  const x = clamp01(value);
  const g = clampSigmoid(gain);
  const mid = clamp01(midpoint);
  const gamma = SIGMOID_WORKING_GAMMA;
  const encoded = Math.pow(x, 1 / gamma);
  if (g > 1e-6) {
    const minVal = naiveSigmoid(0, g, mid);
    const maxVal = naiveSigmoid(1, g, mid);
    const adjusted = clamp01((naiveSigmoid(encoded, g, mid) - minVal) / (maxVal - minVal));
    return clamp01(Math.pow(adjusted, gamma));
  }
  if (g < -1e-6) {
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

export function applySigmoidLinearAtMidpointWithWorkingGamma(
  value: number,
  gain: number,
  midpoint: number,
  workingGamma: number,
): number {
  if (!Number.isFinite(value) || value <= 0) return 0;
  const g = clampSigmoid(gain);
  if (Math.abs(g) <= 1e-6 || value >= 1) return value;
  const mid = clamp01(midpoint);
  const gamma = Number.isFinite(workingGamma) && workingGamma > 0
    ? workingGamma
    : SIGMOID_WORKING_GAMMA;
  const encoded = Math.pow(clamp01(value), 1 / gamma);
  if (g > 1e-6) {
    const minVal = naiveSigmoid(0, g, mid);
    const maxVal = naiveSigmoid(1, g, mid);
    const adjusted = clamp01((naiveSigmoid(encoded, g, mid) - minVal) / (maxVal - minVal));
    return Math.pow(adjusted, gamma);
  }
  const magnitude = -g;
  const minVal = naiveInverseSigmoid(0, magnitude, mid);
  const maxVal = naiveInverseSigmoid(1, magnitude, mid);
  const adjusted = clamp01(
    (naiveInverseSigmoid(encoded, magnitude, mid) - minVal) / (maxVal - minVal),
  );
  return Math.pow(adjusted, gamma);
}

export function applyShadowLinear(value: number, shadow: number): number {
  const normalized = clampToneRangeAdjustment(shadow);
  if (normalized === 0) return value;
  const gain = SHADOW_MAX_SIGMOID_GAIN * normalized / 100;
  return applySigmoidLinearAtMidpointWithWorkingGamma(
    value,
    gain,
    0,
    SHADOW_WORKING_GAMMA,
  );
}

export function applyHighlightLinear(
  value: number,
  highlight: number,
  range: HighlightRange | null,
): number {
  const normalized = clampToneRangeAdjustment(highlight);
  if (normalized === 0 || !range) return value;

  const { p100 } = range;
  if (!(Number.isFinite(p100) && p100 > 1e-12) || value <= 0 || value >= p100) return value;

  // Normalize sampled P100 to 1, apply a high-end-focused sigmoid there,
  // then restore the original P100 scale. P100 itself stays fixed, while values
  // between display white (1) and P100 can move back below 1 when Highlight is reduced.
  const gain = -HIGHLIGHT_MAX_SIGMOID_GAIN * normalized / 100;
  const normalizedValue = value / p100;
  const adjustedNormalizedValue = applySigmoidLinearAtMidpointWithWorkingGamma(
    normalizedValue,
    gain,
    1,
    HIGHLIGHT_WORKING_GAMMA,
  );
  return adjustedNormalizedValue * p100;
}

/**
 * Move only the local black-toe region without changing hue/chroma.
 *
 * Negative Black keeps the existing quartic toe through x=k, where
 * (k, k/4) and slope 1 are preserved. Instead of carrying the resulting
 * -3k/4 offset through every brighter tone, that offset is smoothly removed
 * over [k, 4k]. Values at and above 4k are therefore exact identity.
 *
 * Positive Black is the exact inverse of this localized negative curve.
 * This preserves reversibility around zero while preventing Black from acting
 * as a broad brightness shift.
 */
function applyLocalizedBlackLinear(
  value: number,
  black: number,
  maxToeWidth: number,
): number {
  const normalized = clampToneRangeAdjustment(black);
  if (normalized === 0 || !Number.isFinite(value) || value <= 0) return value;

  const pivot = maxToeWidth * Math.abs(normalized) / 100;
  if (!(pivot > 0)) return value;

  const localEnd = pivot * BLACK_LOCAL_TOE_END_MULTIPLIER;

  if (normalized < 0) {
    if (value >= localEnd) return value;
    if (value <= pivot) return Math.pow(value, 4) / (4 * Math.pow(pivot, 3));

    // Remove the old -3k/4 continuation smoothly while matching slope 1 at
    // both ends. smoothstep has zero endpoint derivatives, so this joins the
    // quartic toe and the identity branch without a tonal kink.
    const s = (value - pivot) / (localEnd - pivot);
    const smooth = s * s * (3 - 2 * s);
    return value - pivot * 0.75 * (1 - smooth);
  }

  // Positive Black is the exact inverse of the localized negative curve.
  const toeOutput = pivot * 0.25;
  if (value >= localEnd) return value;
  if (value <= toeOutput) return Math.pow(4 * Math.pow(pivot, 3) * value, 0.25);

  // In the recovery interval, write x=k(1+3s). The negative curve becomes
  // y/k = 1/4 + 3s + 9s^2/4 - 3s^3/2, which is strictly increasing on
  // s in [0,1]. A few Newton steps therefore recover the exact inverse using
  // only inexpensive arithmetic.
  const target = value / pivot;
  let s = Math.min(1, Math.max(0, (target - 0.25) / 3.75));
  for (let iteration = 0; iteration < 4; iteration += 1) {
    const s2 = s * s;
    const f = 0.25 + 3 * s + 2.25 * s2 - 1.5 * s2 * s - target;
    const derivative = 3 + 4.5 * s - 4.5 * s2;
    s = Math.min(1, Math.max(0, s - f / derivative));
  }
  return pivot * (1 + 3 * s);
}

export function applyBlackLinear(value: number, black: number): number {
  return applyLocalizedBlackLinear(value, black, BLACK_MAX_TOE_WIDTH);
}


export type WhiteRange = {
  p998: number;
};

/**
 * Apply White with the same localized curve shape as Black, vertically mirrored
 * around display white 1.0, but with its own independent shoulder width.
 *
 * In [0, 1], the base transform is:
 *   White(x, w) = 1 - LocalBlack(1 - x, -w, WHITE_MAX_SHOULDER_WIDTH)
 *
 * Positive White uses that mirrored transform directly and leaves values above
 * 1 unchanged. Negative White additionally rescues highlight headroom when
 * P99.8=M extends above 1. The mirrored inverse-Black branch joins its upper
 * shoulder at:
 *   k = WHITE_MAX_SHOULDER_WIDTH * abs(w) / 100
 *   P = 1 - k/4, Y(P) = 1 - k
 *
 * From that slider-dependent join point to M, use a monotonic linear rescue
 * segment. Its endpoint is interpolated by the negative slider strength t:
 *   T(M) = M - (M - 1) * t
 * so White=-100 maps M to 1 exactly, while weaker negative values rescue only
 * the corresponding fraction. Above M the curve continues with slope 1-t;
 * therefore White=-100 caps all higher luminance at 1.
 *
 * If M<=1 there is no P99.8 headroom interval to rescue. The mirrored White
 * curve is kept through 1, and only luminance above 1 is compressed with
 * slope 1-t so the -100 endpoint still cannot exceed display white.
 */
export function applyWhiteLinear(
  value: number,
  white: number,
  range: WhiteRange | null,
): number {
  const normalized = clampToneRangeAdjustment(white);
  if (normalized === 0 || !range || !Number.isFinite(value) || value < 0) return value;

  const M = range.p998;
  if (!(Number.isFinite(M) && M > 0)) return value;

  // Mirror the localized Black curve shape around display white, using the
  // independent White shoulder width. Non-positive mirrored coordinates pass
  // through unchanged, so values above 1 are only changed by negative rescue.
  const mirrored = 1 - applyLocalizedBlackLinear(
    1 - value,
    -normalized,
    WHITE_MAX_SHOULDER_WIDTH,
  );
  if (normalized > 0) return mirrored;

  const strength = -normalized / 100;
  if (!(strength > 0)) return mirrored;

  // Without P99.8 headroom above display white, preserve the exact mirrored
  // curve through x=1 and only compress the excess above 1. At -100 this
  // becomes a hard y=1 continuation, so no highlight can remain above white.
  if (M <= 1) {
    if (value <= 1) return mirrored;
    return 1 + (value - 1) * (1 - strength);
  }

  const pivot = WHITE_MAX_SHOULDER_WIDTH * strength;
  const rescueStart = 1 - pivot * 0.25;
  if (value <= rescueStart) return mirrored;

  // At the inverse-Black/mirrored shoulder join, x=P maps exactly to 1-k.
  const rescueStartOutput = 1 - pivot;
  const rescuedAtM = M - (M - 1) * strength;

  if (value <= M) {
    const span = M - rescueStart;
    if (!(span > TONE_LUMINANCE_EPSILON)) return mirrored;
    const t = (value - rescueStart) / span;
    return rescueStartOutput + (rescuedAtM - rescueStartOutput) * t;
  }

  // Keep the mapping continuous above sampled P99.8. Full negative White has
  // zero slope here (all values stay at 1); partial strength retains 1-t of
  // the original excess instead of creating a discontinuity at M.
  return rescuedAtM + (value - M) * (1 - strength);
}

export function applyShadowHighlightLinearToRgb(
  r: number,
  g: number,
  b: number,
  shadow: number,
  highlight: number,
  highlightRange: HighlightRange | null,
): [number, number, number] {
  r = applyShadowLinear(r, shadow);
  g = applyShadowLinear(g, shadow);
  b = applyShadowLinear(b, shadow);

  const maxChannel = Math.max(r, g, b);
  if (maxChannel <= 0) return [r, g, b];
  const adjustedMax = applyHighlightLinear(maxChannel, highlight, highlightRange);
  const scale = adjustedMax / maxChannel;
  return [r * scale, g * scale, b * scale];
}

export function applyDisplayRolloffAndClipLinearToRgb(
  r: number,
  g: number,
  b: number,
  rolloff: RolloffParams | null,
): [number, number, number] {
  [r, g, b] = applyHighlightRolloffLinearRgb(r, g, b, rolloff);
  return [clamp01(r), clamp01(g), clamp01(b)];
}

export function applyDisplayRolloffAndClipLinearToRgbInto(
  r: number,
  g: number,
  b: number,
  rolloff: RolloffParams | null,
  output: ToneRgbBuffer,
): void {
  applyHighlightRolloffLinearRgbInto(r, g, b, rolloff, output);
  output[0] = clamp01(output[0] ?? 0);
  output[1] = clamp01(output[1] ?? 0);
  output[2] = clamp01(output[2] ?? 0);
}

export type ToneAdjustmentFlags = {
  hasExposure: boolean;
  hasShadow: boolean;
  hasHighlight: boolean;
  hasBlack?: boolean;
  hasWhite?: boolean;
  hasScaledLog: boolean;
  hasSigmoid: boolean;
  exposureRolloff?: RolloffParams | null;
};

export function applyToneLinearToRgb(
  r: number,
  g: number,
  b: number,
  gains: WhiteBalanceGains,
  hasWhiteBalance: boolean,
  factor: number,
  shadow: number,
  highlight: number,
  highlightRange: HighlightRange | null,
  scaledLog: number,
  sigmoid: number,
  flags?: ToneAdjustmentFlags,
  black = 0,
  white = 0,
  whiteRange: WhiteRange | null = null,
): [number, number, number] {
  const hasExposure = flags?.hasExposure ?? factor !== 1;
  const hasShadow = flags?.hasShadow ?? shadow !== 0;
  const hasHighlight = flags?.hasHighlight ?? (highlight !== 0 && highlightRange !== null);
  const hasBlack = flags?.hasBlack ?? black !== 0;
  const hasWhite = flags?.hasWhite ?? (white !== 0 && whiteRange !== null);
  const hasScaledLog = flags?.hasScaledLog ?? scaledLog !== 0;
  const hasSigmoid = flags?.hasSigmoid ?? sigmoid !== 0;

  if (hasWhiteBalance) [r, g, b] = applyWhiteBalanceLinear(r, g, b, gains);
  if (hasExposure) {
    [r, g, b] = applyHighlightRolloffLinearRgb(
      r * factor,
      g * factor,
      b * factor,
      flags?.exposureRolloff ?? null,
    );
  }
  const sourceLuminance = proPhotoLinearLuminance(r, g, b);
  if (!(sourceLuminance > TONE_LUMINANCE_EPSILON)) return [r, g, b];

  let luminance = sourceLuminance;
  if (hasScaledLog) luminance = applyScaledLogLinearExtended(luminance, scaledLog);
  if (hasSigmoid) luminance = applySigmoidLinearExtended(luminance, sigmoid);
  if (hasShadow) luminance = applyShadowLinear(luminance, shadow);
  if (hasHighlight) luminance = applyHighlightLinear(luminance, highlight, highlightRange);
  if (hasBlack) luminance = applyBlackLinear(luminance, black);
  if (hasWhite) luminance = applyWhiteLinear(luminance, white, whiteRange);

  if (!Number.isFinite(luminance)) return [r, g, b];
  const scale = luminance / sourceLuminance;
  return [r * scale, g * scale, b * scale];
}

export function applyToneLinearToRgbInto(
  r: number,
  g: number,
  b: number,
  gains: WhiteBalanceGains,
  hasWhiteBalance: boolean,
  factor: number,
  shadow: number,
  highlight: number,
  highlightRange: HighlightRange | null,
  scaledLog: number,
  sigmoid: number,
  output: ToneRgbBuffer,
  flags?: ToneAdjustmentFlags,
  black = 0,
  white = 0,
  whiteRange: WhiteRange | null = null,
): void {
  const hasExposure = flags?.hasExposure ?? factor !== 1;
  const hasShadow = flags?.hasShadow ?? shadow !== 0;
  const hasHighlight = flags?.hasHighlight ?? (highlight !== 0 && highlightRange !== null);
  const hasBlack = flags?.hasBlack ?? black !== 0;
  const hasWhite = flags?.hasWhite ?? (white !== 0 && whiteRange !== null);
  const hasScaledLog = flags?.hasScaledLog ?? scaledLog !== 0;
  const hasSigmoid = flags?.hasSigmoid ?? sigmoid !== 0;

  if (hasWhiteBalance) {
    applyWhiteBalanceLinearInto(r, g, b, gains, output);
    r = output[0] ?? 0; g = output[1] ?? 0; b = output[2] ?? 0;
  }
  if (hasExposure) {
    applyHighlightRolloffLinearRgbInto(
      r * factor, g * factor, b * factor, flags?.exposureRolloff ?? null, output,
    );
    r = output[0] ?? 0; g = output[1] ?? 0; b = output[2] ?? 0;
  }
  const sourceLuminance = proPhotoLinearLuminance(r, g, b);
  if (!(sourceLuminance > TONE_LUMINANCE_EPSILON)) {
    output[0] = r; output[1] = g; output[2] = b;
    return;
  }

  let luminance = sourceLuminance;
  if (hasScaledLog) luminance = applyScaledLogLinearExtended(luminance, scaledLog);
  if (hasSigmoid) luminance = applySigmoidLinearExtended(luminance, sigmoid);
  if (hasShadow) luminance = applyShadowLinear(luminance, shadow);
  if (hasHighlight) luminance = applyHighlightLinear(luminance, highlight, highlightRange);
  if (hasBlack) luminance = applyBlackLinear(luminance, black);
  if (hasWhite) luminance = applyWhiteLinear(luminance, white, whiteRange);

  if (!Number.isFinite(luminance)) {
    output[0] = r; output[1] = g; output[2] = b;
    return;
  }
  const scale = luminance / sourceLuminance;
  output[0] = r * scale;
  output[1] = g * scale;
  output[2] = b * scale;
}

export type ColorAdjustmentContext = {
  gains: WhiteBalanceGains;
  hasWhiteBalance: boolean;
  hasExposure: boolean;
  hasShadow: boolean;
  hasHighlight: boolean;
  hasBlack: boolean;
  hasWhite: boolean;
  hasScaledLog: boolean;
  hasSigmoid: boolean;
  hasSaturation: boolean;
  hasVibrance: boolean;
  hasSaturationOrVibrance: boolean;
  factor: number;
  shadow: number;
  highlight: number;
  black: number;
  white: number;
  highlightRange: HighlightRange | null;
  whiteRange: WhiteRange | null;
  // Exposure, Saturation and final display shoulders are percentile-derived rolloffs.
  exposureRolloff: RolloffParams | null;
  saturationRolloff: RolloffParams | null;
  finalRolloff: RolloffParams | null;
  scaledLog: number;
  sigmoid: number;
  normalizedVibrance: number;
  normalizedSaturation: number;
  saturationFactor: number;
  vibranceFactor: number;
};

export type ToneAdjustmentStage =
  | "white-balance"
  | "exposure"
  | "scaled-log"
  | "sigmoid"
  | "shadow"
  | "highlight"
  | "black"
  | "white"
  | "after-tone";

const TONE_ADJUSTMENT_STAGE_INDEX: Record<ToneAdjustmentStage, number> = {
  "white-balance": 0,
  exposure: 1,
  "scaled-log": 2,
  sigmoid: 3,
  shadow: 4,
  highlight: 5,
  black: 6,
  white: 7,
  "after-tone": 8,
};

const TONE_GAMMA20_GAIN_LUT_SIZE = 4096;
const TONE_LUMINANCE_STAGE_START_INDEX = TONE_ADJUSTMENT_STAGE_INDEX["scaled-log"];
const TONE_AFTER_STAGE_INDEX = TONE_ADJUSTMENT_STAGE_INDEX["after-tone"];

function hasActiveToneLuminanceStage(
  context: ColorAdjustmentContext,
  stageIndex: number,
): boolean {
  switch (stageIndex) {
    case 2: return context.hasScaledLog;
    case 3: return context.hasSigmoid;
    case 4: return context.hasShadow;
    case 5: return context.hasHighlight;
    case 6: return context.hasBlack;
    case 7: return context.hasWhite;
    default: return false;
  }
}

function applyToneLuminanceAdjustmentStages(
  luminance: number,
  context: ColorAdjustmentContext,
  startIndex: number,
  endIndex: number,
): number {
  let adjusted = luminance;
  if (startIndex <= 2 && endIndex > 2 && context.hasScaledLog) {
    adjusted = applyScaledLogLinearExtended(adjusted, context.scaledLog);
  }
  if (startIndex <= 3 && endIndex > 3 && context.hasSigmoid) {
    adjusted = applySigmoidLinearExtended(adjusted, context.sigmoid);
  }
  if (startIndex <= 4 && endIndex > 4 && context.hasShadow) {
    adjusted = applyShadowLinear(adjusted, context.shadow);
  }
  if (startIndex <= 5 && endIndex > 5 && context.hasHighlight) {
    adjusted = applyHighlightLinear(adjusted, context.highlight, context.highlightRange);
  }
  if (startIndex <= 6 && endIndex > 6 && context.hasBlack) {
    adjusted = applyBlackLinear(adjusted, context.black);
  }
  if (startIndex <= 7 && endIndex > 7 && context.hasWhite) {
    adjusted = applyWhiteLinear(adjusted, context.white, context.whiteRange);
  }
  return adjusted;
}

function normalizeToneGamma20RangeMax(rangeMax: number): number {
  return Number.isFinite(rangeMax) && rangeMax > 0 ? rangeMax : 1;
}

function toneGamma20CoordinateFromLinear(value: number, rangeMax: number): number {
  if (!(value > 0)) return 0;
  return Math.sqrt(value * rangeMax);
}

function toneLinearFromGamma20Coordinate(value: number, rangeMax: number): number {
  if (!(value > 0)) return 0;
  return value * value / rangeMax;
}

export type ToneAdjustmentGamma20GainLut = {
  gammaRangeMax: number;
  sampleScale: number;
  startStage: ToneAdjustmentStage;
  endStage: ToneAdjustmentStage;
  values: Float32Array;
};

export function buildToneAdjustmentGamma20GainLut(
  context: ColorAdjustmentContext,
  startStage: ToneAdjustmentStage = "white-balance",
  endStage: ToneAdjustmentStage = "after-tone",
  gammaRangeMax = 1,
): ToneAdjustmentGamma20GainLut | null {
  const start = Math.max(
    TONE_LUMINANCE_STAGE_START_INDEX,
    TONE_ADJUSTMENT_STAGE_INDEX[startStage],
  );
  const end = Math.min(TONE_AFTER_STAGE_INDEX, TONE_ADJUSTMENT_STAGE_INDEX[endStage]);
  if (start >= end) return null;

  let hasActiveStage = false;
  for (let stage = start; stage < end; stage += 1) {
    if (hasActiveToneLuminanceStage(context, stage)) {
      hasActiveStage = true;
      break;
    }
  }
  if (!hasActiveStage) return null;

  const normalizedRange = normalizeToneGamma20RangeMax(gammaRangeMax);
  const sampleScale = (TONE_GAMMA20_GAIN_LUT_SIZE - 1) / normalizedRange;
  const values = new Float32Array(TONE_GAMMA20_GAIN_LUT_SIZE);
  values.fill(1);

  for (let i = 1; i < TONE_GAMMA20_GAIN_LUT_SIZE; i += 1) {
    const gammaValue = i / sampleScale;
    const sourceLuminance = toneLinearFromGamma20Coordinate(gammaValue, normalizedRange);
    const adjustedLuminance = applyToneLuminanceAdjustmentStages(
      sourceLuminance,
      context,
      start,
      end,
    );
    // Preserve the scalar tone mapping exactly, including negative luminance
    // produced by the Black-mirrored negative White curve near black. Clamping
    // this gain to zero would make the CLAHE/LUT path disagree with direct tone.
    const gain = sourceLuminance > TONE_LUMINANCE_EPSILON && Number.isFinite(adjustedLuminance)
      ? adjustedLuminance / sourceLuminance
      : 1;
    values[i] = Math.fround(gain);
  }
  values[0] = values[1] ?? 1;

  return {
    gammaRangeMax: normalizedRange,
    sampleScale,
    startStage,
    endStage,
    values,
  };
}

export function sampleToneAdjustmentGamma20GainLut(
  lut: ToneAdjustmentGamma20GainLut,
  sourceLuminance: number,
): number | null {
  if (!(sourceLuminance >= 0)) return null;
  const gammaValue = toneGamma20CoordinateFromLinear(sourceLuminance, lut.gammaRangeMax);
  if (!Number.isFinite(gammaValue) || gammaValue > lut.gammaRangeMax) return null;

  const position = gammaValue * lut.sampleScale;
  const lower = Math.max(0, Math.min(lut.values.length - 1, Math.floor(position)));
  const upper = Math.min(lut.values.length - 1, lower + 1);
  const fraction = position - lower;
  const lo = lut.values[lower] ?? 1;
  const hi = lut.values[upper] ?? lo;
  return lo + (hi - lo) * fraction;
}

export function applyToneAdjustmentsLinearRgbRangeWithGamma20GainLutInto(
  r: number,
  g: number,
  b: number,
  context: ColorAdjustmentContext,
  startStage: ToneAdjustmentStage,
  endStage: ToneAdjustmentStage,
  lut: ToneAdjustmentGamma20GainLut | null,
  output: ToneRgbBuffer,
): void {
  const start = TONE_ADJUSTMENT_STAGE_INDEX[startStage];
  const end = TONE_ADJUSTMENT_STAGE_INDEX[endStage];
  if (start >= end) {
    output[0] = r; output[1] = g; output[2] = b;
    return;
  }

  if (start <= 0 && end > 0 && context.hasWhiteBalance) {
    applyWhiteBalanceLinearInto(r, g, b, context.gains, output);
    r = output[0] ?? 0; g = output[1] ?? 0; b = output[2] ?? 0;
  }
  if (start <= 1 && end > 1 && context.hasExposure) {
    applyHighlightRolloffLinearRgbInto(
      r * context.factor,
      g * context.factor,
      b * context.factor,
      context.exposureRolloff,
      output,
    );
    r = output[0] ?? 0; g = output[1] ?? 0; b = output[2] ?? 0;
  }

  const luminanceStart = Math.max(start, TONE_LUMINANCE_STAGE_START_INDEX);
  if (luminanceStart >= end) {
    output[0] = r; output[1] = g; output[2] = b;
    return;
  }

  const sourceLuminance = proPhotoLinearLuminance(r, g, b);
  if (!(sourceLuminance > TONE_LUMINANCE_EPSILON)) {
    output[0] = r; output[1] = g; output[2] = b;
    return;
  }

  const gain = lut ? sampleToneAdjustmentGamma20GainLut(lut, sourceLuminance) : null;
  if (gain !== null && Number.isFinite(gain)) {
    output[0] = r * gain;
    output[1] = g * gain;
    output[2] = b * gain;
    return;
  }

  const luminance = applyToneLuminanceAdjustmentStages(sourceLuminance, context, luminanceStart, end);
  if (!Number.isFinite(luminance)) {
    output[0] = r; output[1] = g; output[2] = b;
    return;
  }

  const scale = luminance / sourceLuminance;
  output[0] = r * scale;
  output[1] = g * scale;
  output[2] = b * scale;
}

/** Apply a contiguous subrange of the luminance Tone pipeline. `endStage` is exclusive. */
export function applyToneAdjustmentsLinearRgbRange(
  r: number,
  g: number,
  b: number,
  context: ColorAdjustmentContext,
  startStage: ToneAdjustmentStage = "white-balance",
  endStage: ToneAdjustmentStage = "after-tone",
): [number, number, number] {
  const start = TONE_ADJUSTMENT_STAGE_INDEX[startStage];
  const end = TONE_ADJUSTMENT_STAGE_INDEX[endStage];
  if (start >= end) return [r, g, b];

  if (start <= 0 && end > 0 && context.hasWhiteBalance) {
    [r, g, b] = applyWhiteBalanceLinear(r, g, b, context.gains);
  }
  if (start <= 1 && end > 1 && context.hasExposure) {
    [r, g, b] = applyHighlightRolloffLinearRgb(
      r * context.factor,
      g * context.factor,
      b * context.factor,
      context.exposureRolloff,
    );
  }

  const sourceLuminance = proPhotoLinearLuminance(r, g, b);
  if (!(sourceLuminance > TONE_LUMINANCE_EPSILON)) return [r, g, b];
  let luminance = sourceLuminance;

  if (start <= 2 && end > 2 && context.hasScaledLog) {
    luminance = applyScaledLogLinearExtended(luminance, context.scaledLog);
  }
  if (start <= 3 && end > 3 && context.hasSigmoid) {
    luminance = applySigmoidLinearExtended(luminance, context.sigmoid);
  }
  if (start <= 4 && end > 4 && context.hasShadow) {
    luminance = applyShadowLinear(luminance, context.shadow);
  }
  if (start <= 5 && end > 5 && context.hasHighlight) {
    luminance = applyHighlightLinear(luminance, context.highlight, context.highlightRange);
  }
  if (start <= 6 && end > 6 && context.hasBlack) {
    luminance = applyBlackLinear(luminance, context.black);
  }
  if (start <= 7 && end > 7 && context.hasWhite) {
    luminance = applyWhiteLinear(luminance, context.white, context.whiteRange);
  }

  if (!Number.isFinite(luminance)) return [r, g, b];
  const scale = luminance / sourceLuminance;
  return [r * scale, g * scale, b * scale];
}

export function applyToneAdjustmentsLinearRgbRangeInto(
  r: number,
  g: number,
  b: number,
  context: ColorAdjustmentContext,
  startStage: ToneAdjustmentStage,
  endStage: ToneAdjustmentStage,
  output: ToneRgbBuffer,
): void {
  const start = TONE_ADJUSTMENT_STAGE_INDEX[startStage];
  const end = TONE_ADJUSTMENT_STAGE_INDEX[endStage];
  if (start >= end) {
    output[0] = r; output[1] = g; output[2] = b;
    return;
  }

  if (start <= 0 && end > 0 && context.hasWhiteBalance) {
    applyWhiteBalanceLinearInto(r, g, b, context.gains, output);
    r = output[0] ?? 0; g = output[1] ?? 0; b = output[2] ?? 0;
  }
  if (start <= 1 && end > 1 && context.hasExposure) {
    applyHighlightRolloffLinearRgbInto(
      r * context.factor, g * context.factor, b * context.factor, context.exposureRolloff, output,
    );
    r = output[0] ?? 0; g = output[1] ?? 0; b = output[2] ?? 0;
  }

  const sourceLuminance = proPhotoLinearLuminance(r, g, b);
  if (!(sourceLuminance > TONE_LUMINANCE_EPSILON)) {
    output[0] = r; output[1] = g; output[2] = b;
    return;
  }
  let luminance = sourceLuminance;

  if (start <= 2 && end > 2 && context.hasScaledLog) {
    luminance = applyScaledLogLinearExtended(luminance, context.scaledLog);
  }
  if (start <= 3 && end > 3 && context.hasSigmoid) {
    luminance = applySigmoidLinearExtended(luminance, context.sigmoid);
  }
  if (start <= 4 && end > 4 && context.hasShadow) {
    luminance = applyShadowLinear(luminance, context.shadow);
  }
  if (start <= 5 && end > 5 && context.hasHighlight) {
    luminance = applyHighlightLinear(luminance, context.highlight, context.highlightRange);
  }
  if (start <= 6 && end > 6 && context.hasBlack) {
    luminance = applyBlackLinear(luminance, context.black);
  }
  if (start <= 7 && end > 7 && context.hasWhite) {
    luminance = applyWhiteLinear(luminance, context.white, context.whiteRange);
  }

  if (!Number.isFinite(luminance)) {
    output[0] = r; output[1] = g; output[2] = b;
    return;
  }
  const scale = luminance / sourceLuminance;
  output[0] = r * scale;
  output[1] = g * scale;
  output[2] = b * scale;
}

export function applyToneAdjustmentsLinearRgb(
  r: number,
  g: number,
  b: number,
  context: ColorAdjustmentContext,
): [number, number, number] {
  return applyToneLinearToRgb(
    r,
    g,
    b,
    context.gains,
    context.hasWhiteBalance,
    context.factor,
    context.shadow,
    context.highlight,
    context.highlightRange,
    context.scaledLog,
    context.sigmoid,
    context,
    context.black,
    context.white,
    context.whiteRange,
  );
}

export function applyToneAdjustmentsLinearRgbInto(
  r: number,
  g: number,
  b: number,
  context: ColorAdjustmentContext,
  output: ToneRgbBuffer,
): void {
  applyToneLinearToRgbInto(
    r, g, b,
    context.gains,
    context.hasWhiteBalance,
    context.factor,
    context.shadow,
    context.highlight,
    context.highlightRange,
    context.scaledLog,
    context.sigmoid,
    output,
    context,
    context.black,
    context.white,
    context.whiteRange,
  );
}

export function applySaturationVibranceAndFinalRolloffLinearRgb(
  r: number,
  g: number,
  b: number,
  saturation: number,
  vibrance: number,
  applyFinalRolloff = true,
  finalRolloff: RolloffParams | null | undefined = undefined,
  saturationRolloff: RolloffParams | null = null,
): [number, number, number] {
  const normalizedSaturation = clampColorAdjustment(saturation);
  const normalizedVibrance = clampColorAdjustment(vibrance);
  if (normalizedSaturation !== 0) {
    const [, currentSaturation] = rgbToHsvExtended(r, g, b);
    const scaledSaturation = currentSaturation * colorSaturationFactor(normalizedSaturation);
    const targetSaturation = applyRolloffScalar(scaledSaturation, saturationRolloff);
    [r, g, b] = applyHsvSaturationPreservingProPhotoLuminance(
      r, g, b,
      targetSaturation,
    );
  }
  if (normalizedVibrance !== 0) {
    const [, currentSaturation] = rgbToHsvExtended(r, g, b);
    const targetSaturation = applyScaledLogLinearExtended(
      currentSaturation,
      colorVibranceFactor(normalizedVibrance),
    );
    [r, g, b] = applyHsvSaturationPreservingProPhotoLuminance(
      r, g, b,
      targetSaturation,
    );
  }
  if (!applyFinalRolloff) return [r, g, b];
  // A null percentile-derived rolloff means P99.8 is already within the
  // display range; clip only the exceptional outliers.
  return applyDisplayRolloffAndClipLinearToRgb(r, g, b, finalRolloff ?? null);
}

export function applySaturationVibranceAndFinalRolloffLinearRgbInto(
  r: number,
  g: number,
  b: number,
  saturation: number,
  vibrance: number,
  applyFinalRolloff: boolean,
  finalRolloff: RolloffParams | null | undefined,
  saturationRolloff: RolloffParams | null,
  output: ToneRgbBuffer,
): void {
  const normalizedSaturation = clampColorAdjustment(saturation);
  const normalizedVibrance = clampColorAdjustment(vibrance);
  if (normalizedSaturation !== 0) {
    const currentSaturation = rgbSaturationExtended(r, g, b);
    const scaledSaturation = currentSaturation * colorSaturationFactor(normalizedSaturation);
    const targetSaturation = applyRolloffScalar(scaledSaturation, saturationRolloff);
    applyHsvSaturationPreservingProPhotoLuminanceInto(r, g, b, targetSaturation, output);
    r = output[0] ?? 0; g = output[1] ?? 0; b = output[2] ?? 0;
  }
  if (normalizedVibrance !== 0) {
    const currentSaturation = rgbSaturationExtended(r, g, b);
    const targetSaturation = applyScaledLogLinearExtended(
      currentSaturation,
      colorVibranceFactor(normalizedVibrance),
    );
    applyHsvSaturationPreservingProPhotoLuminanceInto(r, g, b, targetSaturation, output);
    r = output[0] ?? 0; g = output[1] ?? 0; b = output[2] ?? 0;
  }
  if (!applyFinalRolloff) {
    output[0] = r; output[1] = g; output[2] = b;
    return;
  }
  applyDisplayRolloffAndClipLinearToRgbInto(r, g, b, finalRolloff ?? null, output);
}

export function applyColorAdjustmentsAfterToneLinearRgb(
  r: number,
  g: number,
  b: number,
  context: ColorAdjustmentContext,
  applyFinalRolloff = true,
): [number, number, number] {
  [r, g, b] = applySaturationVibranceAndFinalRolloffLinearRgb(
    r,
    g,
    b,
    context.normalizedSaturation,
    context.normalizedVibrance,
    false,
    undefined,
    context.saturationRolloff,
  );
  if (!applyFinalRolloff) return [r, g, b];
  return applyDisplayRolloffAndClipLinearToRgb(r, g, b, context.finalRolloff);
}

export function applyColorAdjustmentsAfterToneLinearRgbInto(
  r: number,
  g: number,
  b: number,
  context: ColorAdjustmentContext,
  applyFinalRolloff: boolean,
  output: ToneRgbBuffer,
): void {
  applySaturationVibranceAndFinalRolloffLinearRgbInto(
    r,
    g,
    b,
    context.normalizedSaturation,
    context.normalizedVibrance,
    false,
    undefined,
    context.saturationRolloff,
    output,
  );
  if (!applyFinalRolloff) return;
  applyDisplayRolloffAndClipLinearToRgbInto(
    output[0] ?? 0, output[1] ?? 0, output[2] ?? 0, context.finalRolloff, output,
  );
}

export function hasColorAdjustmentContextChanges(context: ColorAdjustmentContext): boolean {
  return context.hasWhiteBalance
    || context.hasExposure
    || context.hasScaledLog
    || context.hasSigmoid
    || context.hasShadow
    || context.hasHighlight
    || context.hasBlack
    || context.hasWhite
    || context.hasSaturation
    || context.hasVibrance;
}

export function applyColorAdjustmentsLinearRgb(
  r: number,
  g: number,
  b: number,
  context: ColorAdjustmentContext,
): [number, number, number] {
  [r, g, b] = applyToneAdjustmentsLinearRgb(r, g, b, context);
  return applyColorAdjustmentsAfterToneLinearRgb(
    r,
    g,
    b,
    context,
    true,
  );
}

export function applyColorAdjustmentsLinearRgbInto(
  r: number,
  g: number,
  b: number,
  context: ColorAdjustmentContext,
  output: ToneRgbBuffer,
): void {
  applyToneAdjustmentsLinearRgbInto(r, g, b, context, output);
  applyColorAdjustmentsAfterToneLinearRgbInto(
    output[0] ?? 0,
    output[1] ?? 0,
    output[2] ?? 0,
    context,
    true,
    output,
  );
}

// Shared working gamma for the standard Sigmoid and RAW thumbnail tone matching.
export const SIGMOID_WORKING_GAMMA = 2.4;
// Histogram display currently uses the same transfer, but remains a separate semantic alias.
export const HISTOGRAM_DISPLAY_GAMMA = SIGMOID_WORKING_GAMMA;
