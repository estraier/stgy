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
  return Math.min(3, Math.max(0, Math.round(Number.isFinite(v) ? v : 0)));
}

export function colorSaturationFactor(saturation: number): number {
  return Math.max(0, 1 + clampColorAdjustment(saturation) / 100);
}

export function colorVibranceFactor(vibrance: number): number {
  return clampColorAdjustment(vibrance) * 3 / 100;
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
  const gray = 0.299 * r + 0.587 * g + 0.114 * b;
  const whiteThreshold = 0.98;
  const weight = Math.sqrt(1 - clamp01((gray - (1 - whiteThreshold)) / whiteThreshold));
  const wr = weight * gains.r + (1 - weight);
  const wg = weight * gains.g + (1 - weight);
  const wb = weight * gains.b + (1 - weight);
  return [clamp01(r * wr), clamp01(g * wg), clamp01(b * wb)];
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
  const gamma = HISTOGRAM_DISPLAY_GAMMA;
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

export function rolloffParams(
  maxVal: number,
  asymptotic = 0.5,
  savingLimit = 4,
): { inflection: number; scale: number } | null {
  if (!(Number.isFinite(maxVal) && maxVal > 1)) return null;
  if (maxVal > savingLimit) {
    asymptotic = Math.pow(asymptotic, savingLimit / maxVal);
  }
  const inflection = asymptotic + (1 - asymptotic) / maxVal;
  const scale = (1 - inflection) / (maxVal - inflection + 1e-6);
  return { inflection, scale };
}

export function applyRolloffScalar(value: number, rolloff: { inflection: number; scale: number } | null): number {
  if (!rolloff || value <= rolloff.inflection) return value;
  return rolloff.inflection + (value - rolloff.inflection) * rolloff.scale;
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
  const gamma = HISTOGRAM_DISPLAY_GAMMA;
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
    : HISTOGRAM_DISPLAY_GAMMA;
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
  rolloff: { inflection: number; scale: number } | null,
): [number, number, number] {
  return [
    clamp01(applyRolloffScalar(r, rolloff)),
    clamp01(applyRolloffScalar(g, rolloff)),
    clamp01(applyRolloffScalar(b, rolloff)),
  ];
}

export type ToneAdjustmentFlags = {
  hasExposure: boolean;
  hasShadow: boolean;
  hasHighlight: boolean;
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
  highlightRange: HighlightRange | null,
  rolloff: { inflection: number; scale: number } | null,
  scaledLog: number,
  sigmoid: number,
  flags?: ToneAdjustmentFlags,
): [number, number, number] {
  const hasExposure = flags?.hasExposure ?? factor !== 1;
  const hasShadow = flags?.hasShadow ?? shadow !== 0;
  const hasHighlight = flags?.hasHighlight ?? (highlight !== 0 && highlightRange !== null);
  const hasScaledLog = flags?.hasScaledLog ?? scaledLog !== 0;
  const hasSigmoid = flags?.hasSigmoid ?? sigmoid !== 0;

  if (hasWhiteBalance) {
    [r, g, b] = applyWhiteBalanceLinear(r, g, b, gains);
  }
  if (hasExposure) {
    [r, g, b] = applyExposureLinearToRgb(r, g, b, factor);
  }
  if (hasShadow) {
    r = applyShadowLinear(r, shadow);
    g = applyShadowLinear(g, shadow);
    b = applyShadowLinear(b, shadow);
  }
  if (hasHighlight) {
    const maxChannel = Math.max(r, g, b);
    if (maxChannel > 0) {
      const adjustedMax = applyHighlightLinear(maxChannel, highlight, highlightRange);
      const scale = adjustedMax / maxChannel;
      r *= scale;
      g *= scale;
      b *= scale;
    }
  }

  // Rolloff and clipping together form the boundary from extended-range linear
  // editing into the bounded [0,1] tone domain used by Logarithm and Sigmoid.
  [r, g, b] = applyDisplayRolloffAndClipLinearToRgb(r, g, b, rolloff);
  if (hasScaledLog) {
    r = applyScaledLogLinear(r, scaledLog);
    g = applyScaledLogLinear(g, scaledLog);
    b = applyScaledLogLinear(b, scaledLog);
  }
  if (hasSigmoid) {
    r = applySigmoidLinear(r, sigmoid);
    g = applySigmoidLinear(g, sigmoid);
    b = applySigmoidLinear(b, sigmoid);
  }
  return [r, g, b];
}

export type ColorAdjustmentContext = {
  gains: WhiteBalanceGains;
  hasWhiteBalance: boolean;
  hasExposure: boolean;
  hasShadow: boolean;
  hasHighlight: boolean;
  hasScaledLog: boolean;
  hasSigmoid: boolean;
  hasSaturation: boolean;
  hasVibrance: boolean;
  hasSaturationOrVibrance: boolean;
  factor: number;
  shadow: number;
  highlight: number;
  highlightRange: HighlightRange | null;
  rolloff: { inflection: number; scale: number } | null;
  scaledLog: number;
  sigmoid: number;
  normalizedVibrance: number;
  normalizedSaturation: number;
  saturationFactor: number;
  vibranceFactor: number;
  saturationRolloff: { inflection: number; scale: number } | null;
};

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
    context.rolloff,
    context.scaledLog,
    context.sigmoid,
    context,
  );
}

export function applyColorAdjustmentsAfterToneLinearRgb(
  r: number,
  g: number,
  b: number,
  context: ColorAdjustmentContext,
): [number, number, number] {
  if (context.hasSaturationOrVibrance) {
    const [h, initialS, v] = rgbToHsv(r, g, b);
    let s = initialS;
    if (context.hasSaturation) {
      s = applyRolloffScalar(s * context.saturationFactor, context.saturationRolloff);
      s = clamp01(s);
    }
    if (context.hasVibrance) {
      s = applyScaledLogLinear(s, context.vibranceFactor);
    }
    [r, g, b] = hsvToRgb(h, s, v);
  }
  return [r, g, b];
}

export function applyColorAdjustmentsLinearRgb(
  r: number,
  g: number,
  b: number,
  context: ColorAdjustmentContext,
): [number, number, number] {
  [r, g, b] = applyToneAdjustmentsLinearRgb(r, g, b, context);
  return applyColorAdjustmentsAfterToneLinearRgb(r, g, b, context);
}

export const HISTOGRAM_DISPLAY_GAMMA = 2.4;
