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

function snapToneUnitBoundary(value: number): number {
  return Number.isFinite(value) && Math.abs(value - 1) <= TONE_LUMINANCE_EPSILON ? 1 : value;
}

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

export const SHADOW_MAX_GAMMA = 2.5;
export const HIGHLIGHT_MAX_GAMMA = 5;
export const BLACK_MAX_TOE_WIDTH = 0.08;
const BLACK_LOCAL_TOE_END_MULTIPLIER = 4;

// White intentionally duplicates the Black curve parameters instead of
// referencing Black's implementation or constants.  The two controls must
// remain code-independent even though their displayed curves are designed to
// be exact mirrors in gamma-2.4 space.
export const WHITE_MIRROR_MAX_TOE_WIDTH = 0.08;
export const WHITE_MIRROR_GAMMA = 2.4;
const WHITE_MIRROR_LOCAL_END_MULTIPLIER = 4;

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

export function applyShadowLinear(value: number, shadow: number): number {
  const normalized = clampToneRangeAdjustment(shadow);
  const snapped = snapToneUnitBoundary(value);
  if (normalized === 0 || !Number.isFinite(snapped) || snapped <= 0 || snapped >= 1) return snapped;

  // Pure gamma correction over display-referred luminance [0, 1]. Positive
  // Shadow lifts dark tones with gamma < 1; negative Shadow deepens them with
  // the reciprocal gamma. Values above display white stay untouched so RAW
  // highlight headroom remains available to later extended-highlight handling.
  const gamma = Math.pow(SHADOW_MAX_GAMMA, -normalized / 100);
  return Math.pow(snapped, gamma);
}

export function applyHighlightLinear(value: number, highlight: number): number {
  const normalized = clampToneRangeAdjustment(highlight);
  const snapped = snapToneUnitBoundary(value);
  if (normalized === 0 || !Number.isFinite(snapped) || snapped <= 0 || snapped >= 1) return snapped;

  // White-side mirror of a gamma correction. Positive Highlight bends the
  // curve above identity; negative Highlight bends it below identity. Keep
  // extended RAW values above display white unchanged; >1 highlight recovery
  // is handled separately from the display-range Highlight/White curves.
  const gamma = Math.pow(HIGHLIGHT_MAX_GAMMA, normalized / 100);
  return 1 - Math.pow(1 - snapped, gamma);
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


/**
 * White-side local curve, implemented independently from Black.
 *
 * The visible White curve is the gamma-2.4 mirror of Black:
 *   u = x^(1/g)
 *   z = (1-u)^g
 *   z' = independentBlackShape(z, -white)
 *   y = (1-z'^(1/g))^g
 *
 * The local toe/shoulder arithmetic below is intentionally duplicated.
 * Do not replace it with a call to applyBlackLinear/applyLocalizedBlackLinear
 * or with Black constants: White and Black must not depend on each other.
 *
 * The mirror transform itself is confined to display range [0,1]. Positive
 * White leaves values above 1 untouched. Negative White then applies an
 * independent extended-highlight rescue as a post-process: the excess above
 * display white is reduced in proportion to slider strength, reaching y=1
 * for every value above 1 at White=-100.
 */
function applyIndependentWhiteMirrorShapeLinear(
  value: number,
  white: number,
): number {
  const normalized = clampToneRangeAdjustment(white);
  if (normalized === 0 || !Number.isFinite(value) || value <= 0) return value;

  const pivot = WHITE_MIRROR_MAX_TOE_WIDTH * Math.abs(normalized) / 100;
  if (!(pivot > 0)) return value;
  const localEnd = pivot * WHITE_MIRROR_LOCAL_END_MULTIPLIER;

  // Positive White mirrors negative Black, so the mirrored-side value is
  // compressed with the quartic local toe.
  if (normalized > 0) {
    if (value >= localEnd) return value;
    if (value <= pivot) return Math.pow(value, 4) / (4 * Math.pow(pivot, 3));

    const s = (value - pivot) / (localEnd - pivot);
    const smooth = s * s * (3 - 2 * s);
    return value - pivot * 0.75 * (1 - smooth);
  }

  // Negative White mirrors positive Black: exact inverse of the branch above.
  const toeOutput = pivot * 0.25;
  if (value >= localEnd) return value;
  if (value <= toeOutput) return Math.pow(4 * Math.pow(pivot, 3) * value, 0.25);

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

function applyWhiteExtendedHighlightRescueLinear(
  value: number,
  normalizedWhite: number,
): number {
  if (!(value > 1) || normalizedWhite >= 0) return value;

  // This is deliberately separate from the gamma-2.4 mirror geometry. Let
  // t=-white/100: the excess (value-1) keeps the fraction (1-t), so -50
  // halves it and -100 maps every value above display white exactly to 1.
  const rescueStrength = -normalizedWhite / 100;
  return 1 + (value - 1) * (1 - rescueStrength);
}

export function applyWhiteLinear(
  value: number,
  white: number,
): number {
  const normalized = clampToneRangeAdjustment(white);
  const snapped = snapToneUnitBoundary(value);
  if (normalized === 0 || !Number.isFinite(snapped) || snapped <= 0) return snapped;

  // First apply only the display-range White geometry. It remains the exact
  // gamma-2.4 mirror of the independently duplicated Black shape.
  let adjusted = snapped;
  if (snapped <= 1) {
    const gamma = WHITE_MIRROR_GAMMA;
    const encoded = Math.pow(snapped, 1 / gamma);
    const mirroredEncoded = 1 - encoded;
    const mirroredLinear = Math.pow(mirroredEncoded, gamma);
    const adjustedMirroredLinear = applyIndependentWhiteMirrorShapeLinear(
      mirroredLinear,
      normalized,
    );
    const adjustedMirroredEncoded = Math.pow(
      Math.max(0, adjustedMirroredLinear),
      1 / gamma,
    );
    const adjustedEncoded = 1 - adjustedMirroredEncoded;
    adjusted = Math.pow(Math.max(0, adjustedEncoded), gamma);
  }

  // Then run the independent >1 rescue post-process. For [0,1] this is a
  // no-op, so the Black/White mirror relationship is not affected.
  return applyWhiteExtendedHighlightRescueLinear(adjusted, normalized);
}

export function applyShadowHighlightLinearToRgb(
  r: number,
  g: number,
  b: number,
  shadow: number,
  highlight: number,
): [number, number, number] {
  r = applyShadowLinear(r, shadow);
  g = applyShadowLinear(g, shadow);
  b = applyShadowLinear(b, shadow);

  const maxChannel = Math.max(r, g, b);
  if (maxChannel <= 0) return [r, g, b];
  const adjustedMax = applyHighlightLinear(maxChannel, highlight);
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


export type ToneCurvePoint = {
  x: number;
  y: number;
};

export const TONE_CURVE_DISPLAY_GAMMA = 2.4;

export function toneCurveLinearToDisplay(value: number): number {
  return Math.pow(clamp01(value), 1 / TONE_CURVE_DISPLAY_GAMMA);
}

export function toneCurveDisplayToLinear(value: number): number {
  return Math.pow(clamp01(value), TONE_CURVE_DISPLAY_GAMMA);
}

export function normalizeToneCurvePoints(
  points: readonly ToneCurvePoint[] | null | undefined,
): ToneCurvePoint[] {
  if (!points?.length) return [];
  const normalized = points
    .map((point) => ({ x: clamp01(point.x), y: clamp01(point.y) }))
    .filter((point) => point.x > 1e-6 && point.x < 1 - 1e-6)
    .sort((a, b) => a.x - b.x);
  const result: ToneCurvePoint[] = [];
  for (const point of normalized) {
    const previous = result[result.length - 1];
    if (previous && Math.abs(previous.x - point.x) < 1e-5) {
      previous.y = point.y;
    } else {
      result.push(point);
    }
  }
  return result;
}

export type ToneCurveSpline = {
  knots: ToneCurvePoint[];
  tangents: Float64Array;
};

function toneCurveEndpointTangent(
  h0: number,
  h1: number,
  delta0: number,
  delta1: number,
): number {
  const tangent = ((2 * h0 + h1) * delta0 - h0 * delta1) / Math.max(1e-12, h0 + h1);
  if (tangent * delta0 <= 0) return 0;
  if (delta0 * delta1 < 0 && Math.abs(tangent) > Math.abs(3 * delta0)) return 3 * delta0;
  return tangent;
}

/**
 * Build a shape-preserving cubic Hermite spline through the fixed endpoints
 * and user control points. The Fritsch-Carlson/PCHIP-style tangents prevent
 * each interval from overshooting the Y range of its endpoints while still
 * allowing the overall curve to rise and fall across successive intervals.
 */
export function buildToneCurveSpline(
  points: readonly ToneCurvePoint[] | null | undefined,
): ToneCurveSpline | null {
  const normalized = normalizeToneCurvePoints(points);
  if (!normalized.length) return null;

  const knots: ToneCurvePoint[] = [{ x: 0, y: 0 }, ...normalized, { x: 1, y: 1 }];
  const count = knots.length;
  const h = new Float64Array(count - 1);
  const delta = new Float64Array(count - 1);
  for (let i = 0; i < count - 1; i += 1) {
    const width = Math.max(1e-12, knots[i + 1].x - knots[i].x);
    h[i] = width;
    delta[i] = (knots[i + 1].y - knots[i].y) / width;
  }

  const tangents = new Float64Array(count);
  if (count === 2) {
    tangents[0] = delta[0];
    tangents[1] = delta[0];
  } else {
    tangents[0] = toneCurveEndpointTangent(h[0], h[1], delta[0], delta[1]);
    for (let i = 1; i < count - 1; i += 1) {
      const left = delta[i - 1];
      const right = delta[i];
      if (left * right <= 0) {
        tangents[i] = 0;
        continue;
      }
      const w1 = 2 * h[i] + h[i - 1];
      const w2 = h[i] + 2 * h[i - 1];
      tangents[i] = (w1 + w2) / (w1 / left + w2 / right);
    }
    tangents[count - 1] = toneCurveEndpointTangent(
      h[count - 2],
      h[count - 3],
      delta[count - 2],
      delta[count - 3],
    );
  }

  return { knots, tangents };
}

/** Evaluate the linear-Y tone curve directly. Values outside [0, 1] are identity. */
export function sampleToneCurveSpline(
  spline: ToneCurveSpline | null,
  value: number,
): number {
  const snapped = snapToneUnitBoundary(value);
  if (!spline || !Number.isFinite(snapped) || snapped < 0 || snapped > 1) return snapped;
  if (snapped <= 0) return 0;
  if (snapped >= 1) return 1;
  value = snapped;

  const knots = spline.knots;
  let low = 0;
  let high = knots.length - 2;
  while (low <= high) {
    const middle = (low + high) >> 1;
    if (value < knots[middle].x) {
      high = middle - 1;
    } else if (value > knots[middle + 1].x) {
      low = middle + 1;
    } else {
      const p0 = knots[middle];
      const p1 = knots[middle + 1];
      if (Math.abs(value - p0.x) <= 1e-12) return p0.y;
      if (Math.abs(value - p1.x) <= 1e-12) return p1.y;
      const width = Math.max(1e-12, p1.x - p0.x);
      const t = clamp01((value - p0.x) / width);
      const t2 = t * t;
      const t3 = t2 * t;
      const h00 = 2 * t3 - 3 * t2 + 1;
      const h10 = t3 - 2 * t2 + t;
      const h01 = -2 * t3 + 3 * t2;
      const h11 = t3 - t2;
      const result = h00 * p0.y
        + h10 * width * spline.tangents[middle]
        + h01 * p1.y
        + h11 * width * spline.tangents[middle + 1];
      // Shape-preserving tangents keep the result inside the interval endpoints;
      // clamp only for floating-point noise at 0/1.
      return clamp01(result);
    }
  }
  return value;
}

export type ToneAdjustmentFlags = {
  hasExposure: boolean;
  hasShadow: boolean;
  hasHighlight: boolean;
  hasBlack?: boolean;
  hasWhite?: boolean;
  hasToneCurve?: boolean;
  toneCurve?: ToneCurveSpline | null;
  hasScaledLog: boolean;
  hasSigmoid: boolean;
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
  scaledLog: number,
  sigmoid: number,
  flags?: ToneAdjustmentFlags,
  black = 0,
  white = 0,
): [number, number, number] {
  const hasExposure = flags?.hasExposure ?? factor !== 1;
  const hasShadow = flags?.hasShadow ?? shadow !== 0;
  const hasHighlight = flags?.hasHighlight ?? highlight !== 0;
  const hasBlack = flags?.hasBlack ?? black !== 0;
  const hasWhite = flags?.hasWhite ?? white !== 0;
  const hasToneCurve = flags?.hasToneCurve ?? !!flags?.toneCurve;
  const hasScaledLog = flags?.hasScaledLog ?? scaledLog !== 0;
  const hasSigmoid = flags?.hasSigmoid ?? sigmoid !== 0;

  if (hasWhiteBalance) [r, g, b] = applyWhiteBalanceLinear(r, g, b, gains);
  const sourceLuminance = proPhotoLinearLuminance(r, g, b);
  if (!(sourceLuminance > TONE_LUMINANCE_EPSILON)) return [r, g, b];

  let luminance = sourceLuminance;
  if (hasExposure) luminance *= factor;
  if (hasScaledLog) luminance = applyScaledLogLinearExtended(luminance, scaledLog);
  if (hasSigmoid) luminance = applySigmoidLinearExtended(luminance, sigmoid);
  if (hasShadow) luminance = applyShadowLinear(luminance, shadow);
  if (hasHighlight) luminance = applyHighlightLinear(luminance, highlight);
  if (hasBlack) luminance = applyBlackLinear(luminance, black);
  if (hasWhite) luminance = applyWhiteLinear(luminance, white);
  if (hasToneCurve) luminance = sampleToneCurveSpline(flags?.toneCurve ?? null, luminance);

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
  scaledLog: number,
  sigmoid: number,
  output: ToneRgbBuffer,
  flags?: ToneAdjustmentFlags,
  black = 0,
  white = 0,
): void {
  const hasExposure = flags?.hasExposure ?? factor !== 1;
  const hasShadow = flags?.hasShadow ?? shadow !== 0;
  const hasHighlight = flags?.hasHighlight ?? highlight !== 0;
  const hasBlack = flags?.hasBlack ?? black !== 0;
  const hasWhite = flags?.hasWhite ?? white !== 0;
  const hasToneCurve = flags?.hasToneCurve ?? !!flags?.toneCurve;
  const hasScaledLog = flags?.hasScaledLog ?? scaledLog !== 0;
  const hasSigmoid = flags?.hasSigmoid ?? sigmoid !== 0;

  if (hasWhiteBalance) {
    applyWhiteBalanceLinearInto(r, g, b, gains, output);
    r = output[0] ?? 0; g = output[1] ?? 0; b = output[2] ?? 0;
  }
  const sourceLuminance = proPhotoLinearLuminance(r, g, b);
  if (!(sourceLuminance > TONE_LUMINANCE_EPSILON)) {
    output[0] = r; output[1] = g; output[2] = b;
    return;
  }

  let luminance = sourceLuminance;
  if (hasExposure) luminance *= factor;
  if (hasScaledLog) luminance = applyScaledLogLinearExtended(luminance, scaledLog);
  if (hasSigmoid) luminance = applySigmoidLinearExtended(luminance, sigmoid);
  if (hasShadow) luminance = applyShadowLinear(luminance, shadow);
  if (hasHighlight) luminance = applyHighlightLinear(luminance, highlight);
  if (hasBlack) luminance = applyBlackLinear(luminance, black);
  if (hasWhite) luminance = applyWhiteLinear(luminance, white);
  if (hasToneCurve) luminance = sampleToneCurveSpline(flags?.toneCurve ?? null, luminance);

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
  hasToneCurve: boolean;
  toneCurve: ToneCurveSpline | null;
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
  // Saturation and final display shoulders are percentile-derived rolloffs.
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
  | "tone-curve"
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
  "tone-curve": 8,
  "after-tone": 9,
};

const TONE_GAMMA20_GAIN_LUT_SIZE = 4096;
const TONE_LUMINANCE_STAGE_START_INDEX = TONE_ADJUSTMENT_STAGE_INDEX.exposure;
const TONE_AFTER_STAGE_INDEX = TONE_ADJUSTMENT_STAGE_INDEX["after-tone"];

function hasActiveToneLuminanceStage(
  context: ColorAdjustmentContext,
  stageIndex: number,
): boolean {
  switch (stageIndex) {
    case 1: return context.hasExposure;
    case 2: return context.hasScaledLog;
    case 3: return context.hasSigmoid;
    case 4: return context.hasShadow;
    case 5: return context.hasHighlight;
    case 6: return context.hasBlack;
    case 7: return context.hasWhite;
    case 8: return context.hasToneCurve;
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
  if (startIndex <= 1 && endIndex > 1 && context.hasExposure) {
    adjusted *= context.factor;
  }
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
    adjusted = applyHighlightLinear(adjusted, context.highlight);
  }
  if (startIndex <= 6 && endIndex > 6 && context.hasBlack) {
    adjusted = applyBlackLinear(adjusted, context.black);
  }
  if (startIndex <= 7 && endIndex > 7 && context.hasWhite) {
    adjusted = applyWhiteLinear(adjusted, context.white);
  }
  if (startIndex <= 8 && endIndex > 8 && context.hasToneCurve) {
    adjusted = sampleToneCurveSpline(context.toneCurve, adjusted);
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

const TONE_ADAPTIVE_LUT_ERROR_TOLERANCE = 1e-5;
const TONE_ADAPTIVE_LUT_MAX_DEPTH = 40;

type ToneAdjustmentAdaptiveLutCell = {
  fractions: Float64Array;
  outputs: Float64Array;
};

function evaluateToneLuminanceForLut(
  sourceLuminance: number,
  context: ColorAdjustmentContext,
  start: number,
  end: number,
): number {
  if (!(sourceLuminance > TONE_LUMINANCE_EPSILON)) return sourceLuminance;
  return applyToneLuminanceAdjustmentStages(sourceLuminance, context, start, end);
}

function appendAdaptiveToneLutCellInterval(
  evaluate: (fraction: number) => number,
  fractionA: number,
  outputA: number,
  fractionB: number,
  outputB: number,
  depth: number,
  fractions: number[],
  outputs: number[],
): void {
  const width = fractionB - fractionA;
  if (!(width > 0)) return;
  if (depth >= TONE_ADAPTIVE_LUT_MAX_DEPTH || width <= 1e-12) {
    fractions.push(fractionB);
    outputs.push(outputB);
    return;
  }

  const quarter = fractionA + width * 0.25;
  const middle = fractionA + width * 0.5;
  const threeQuarter = fractionA + width * 0.75;
  const outputQuarter = evaluate(quarter);
  const outputMiddle = evaluate(middle);
  const outputThreeQuarter = evaluate(threeQuarter);
  if (!Number.isFinite(outputQuarter)
    || !Number.isFinite(outputMiddle)
    || !Number.isFinite(outputThreeQuarter)) {
    fractions.push(fractionB);
    outputs.push(outputB);
    return;
  }

  const delta = outputB - outputA;
  const error = Math.max(
    Math.abs(outputQuarter - (outputA + delta * 0.25)),
    Math.abs(outputMiddle - (outputA + delta * 0.5)),
    Math.abs(outputThreeQuarter - (outputA + delta * 0.75)),
  );
  if (error <= TONE_ADAPTIVE_LUT_ERROR_TOLERANCE) {
    fractions.push(fractionB);
    outputs.push(outputB);
    return;
  }

  appendAdaptiveToneLutCellInterval(
    evaluate,
    fractionA,
    outputA,
    middle,
    outputMiddle,
    depth + 1,
    fractions,
    outputs,
  );
  appendAdaptiveToneLutCellInterval(
    evaluate,
    middle,
    outputMiddle,
    fractionB,
    outputB,
    depth + 1,
    fractions,
    outputs,
  );
}

function buildAdaptiveToneLutCell(
  context: ColorAdjustmentContext,
  start: number,
  end: number,
  rangeMax: number,
  sampleScale: number,
  cellIndex: number,
  lowerGain: number,
  upperGain: number,
): ToneAdjustmentAdaptiveLutCell | null {
  const gammaA = cellIndex / sampleScale;
  const gammaB = (cellIndex + 1) / sampleScale;
  const sourceA = toneLinearFromGamma20Coordinate(gammaA, rangeMax);
  const sourceB = toneLinearFromGamma20Coordinate(gammaB, rangeMax);
  const outputA = evaluateToneLuminanceForLut(sourceA, context, start, end);
  const outputB = evaluateToneLuminanceForLut(sourceB, context, start, end);
  if (!Number.isFinite(outputA) || !Number.isFinite(outputB)) return null;

  const exactAt = (fraction: number): number => {
    const gamma = gammaA + (gammaB - gammaA) * fraction;
    const source = toneLinearFromGamma20Coordinate(gamma, rangeMax);
    return evaluateToneLuminanceForLut(source, context, start, end);
  };
  const mainAt = (fraction: number): number => {
    const gamma = gammaA + (gammaB - gammaA) * fraction;
    const source = toneLinearFromGamma20Coordinate(gamma, rangeMax);
    const gain = lowerGain + (upperGain - lowerGain) * fraction;
    return source * gain;
  };

  const probes = [0.25, 0.5, 0.75] as const;
  let needsRefinement = false;
  for (const fraction of probes) {
    const exact = exactAt(fraction);
    if (!Number.isFinite(exact)
      || Math.abs(exact - mainAt(fraction)) > TONE_ADAPTIVE_LUT_ERROR_TOLERANCE) {
      needsRefinement = true;
      break;
    }
  }
  if (!needsRefinement) return null;

  const fractions: number[] = [0];
  const outputs: number[] = [outputA];
  appendAdaptiveToneLutCellInterval(
    exactAt,
    0,
    outputA,
    1,
    outputB,
    0,
    fractions,
    outputs,
  );
  return fractions.length >= 2
    ? { fractions: Float64Array.from(fractions), outputs: Float64Array.from(outputs) }
    : null;
}

function sampleAdaptiveToneLutCell(
  cell: ToneAdjustmentAdaptiveLutCell,
  fraction: number,
): number | null {
  const fractions = cell.fractions;
  const outputs = cell.outputs;
  if (fractions.length < 2 || outputs.length !== fractions.length) return null;
  if (fraction <= 0) return outputs[0] ?? null;
  if (fraction >= 1) return outputs[outputs.length - 1] ?? null;

  let low = 0;
  let high = fractions.length - 2;
  while (low <= high) {
    const middle = (low + high) >> 1;
    const fractionA = fractions[middle] ?? 0;
    const fractionB = fractions[middle + 1] ?? 1;
    if (fraction < fractionA) high = middle - 1;
    else if (fraction > fractionB) low = middle + 1;
    else {
      const outputA = outputs[middle] ?? 0;
      const outputB = outputs[middle + 1] ?? outputA;
      if (!(fractionB > fractionA)) return outputA;
      const localFraction = (fraction - fractionA) / (fractionB - fractionA);
      return outputA + (outputB - outputA) * localFraction;
    }
  }
  return null;
}

export type ToneAdjustmentGamma20GainLut = {
  gammaRangeMax: number;
  sampleScale: number;
  startStage: ToneAdjustmentStage;
  endStage: ToneAdjustmentStage;
  values: Float32Array;
  adaptiveCells?: Array<ToneAdjustmentAdaptiveLutCell | null>;
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
    const adjustedLuminance = evaluateToneLuminanceForLut(
      sourceLuminance,
      context,
      start,
      end,
    );
    // Preserve the signed scalar mapping. Clamping the gain here would make
    // the LUT path diverge from the direct Tone functions.
    const gain = sourceLuminance > TONE_LUMINANCE_EPSILON && Number.isFinite(adjustedLuminance)
      ? adjustedLuminance / sourceLuminance
      : 1;
    values[i] = Math.fround(gain);
  }
  values[0] = values[1] ?? 1;
  const adaptiveCells: Array<ToneAdjustmentAdaptiveLutCell | null> = new Array(
    TONE_GAMMA20_GAIN_LUT_SIZE - 1,
  ).fill(null);
  let hasAdaptiveCell = false;
  for (let cellIndex = 0; cellIndex < adaptiveCells.length; cellIndex += 1) {
    const cell = buildAdaptiveToneLutCell(
      context,
      start,
      end,
      normalizedRange,
      sampleScale,
      cellIndex,
      values[cellIndex] ?? 1,
      values[cellIndex + 1] ?? values[cellIndex] ?? 1,
    );
    if (cell) {
      adaptiveCells[cellIndex] = cell;
      hasAdaptiveCell = true;
    }
  }

  return {
    gammaRangeMax: normalizedRange,
    sampleScale,
    startStage,
    endStage,
    values,
    ...(hasAdaptiveCell ? { adaptiveCells } : {}),
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
  if (sourceLuminance > TONE_LUMINANCE_EPSILON && lower < lut.values.length - 1) {
    const adaptiveCell = lut.adaptiveCells?.[lower] ?? null;
    if (adaptiveCell) {
      const adjustedLuminance = sampleAdaptiveToneLutCell(adaptiveCell, fraction);
      if (adjustedLuminance !== null && Number.isFinite(adjustedLuminance)) {
        return adjustedLuminance / sourceLuminance;
      }
    }
  }
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
  const sourceLuminance = proPhotoLinearLuminance(r, g, b);
  if (!(sourceLuminance > TONE_LUMINANCE_EPSILON)) return [r, g, b];
  let luminance = sourceLuminance;

  if (start <= 1 && end > 1 && context.hasExposure) {
    luminance *= context.factor;
  }
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
    luminance = applyHighlightLinear(luminance, context.highlight);
  }
  if (start <= 6 && end > 6 && context.hasBlack) {
    luminance = applyBlackLinear(luminance, context.black);
  }
  if (start <= 7 && end > 7 && context.hasWhite) {
    luminance = applyWhiteLinear(luminance, context.white);
  }
  if (start <= 8 && end > 8 && context.hasToneCurve) {
    luminance = sampleToneCurveSpline(context.toneCurve, luminance);
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
  const sourceLuminance = proPhotoLinearLuminance(r, g, b);
  if (!(sourceLuminance > TONE_LUMINANCE_EPSILON)) {
    output[0] = r; output[1] = g; output[2] = b;
    return;
  }
  let luminance = sourceLuminance;

  if (start <= 1 && end > 1 && context.hasExposure) {
    luminance *= context.factor;
  }
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
    luminance = applyHighlightLinear(luminance, context.highlight);
  }
  if (start <= 6 && end > 6 && context.hasBlack) {
    luminance = applyBlackLinear(luminance, context.black);
  }
  if (start <= 7 && end > 7 && context.hasWhite) {
    luminance = applyWhiteLinear(luminance, context.white);
  }
  if (start <= 8 && end > 8 && context.hasToneCurve) {
    luminance = sampleToneCurveSpline(context.toneCurve, luminance);
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
    context.scaledLog,
    context.sigmoid,
    context,
    context.black,
    context.white,
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
    context.scaledLog,
    context.sigmoid,
    output,
    context,
    context.black,
    context.white,
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
    || context.hasToneCurve
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
