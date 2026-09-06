// Pure tone/color-adjustment math. This module deliberately has no DOM or React dependency.

export function clamp01(v: number): number {
  return Math.min(1, Math.max(0, v));
}

export function clampExposureEv(v: number): number {
  return Math.min(5, Math.max(-5, Math.round(v * 10) / 10));
}

export function clampWhiteBalanceValue(v: number): number {
  return Math.min(100, Math.max(-100, Math.round(v)));
}

export function clampScaledLog(v: number): number {
  return Math.min(16, Math.max(-16, Math.round(v * 10) / 10));
}

export function clampSigmoid(v: number): number {
  return Math.min(10, Math.max(-10, Math.round(v * 10) / 10));
}

export function clampToneRangeAdjustment(v: number): number {
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

export function applyScaledLogLinear(value: number, factor: number): number {
  const x = clamp01(value);
  const f = clampScaledLog(factor);
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
  if (maxVal <= 1) return null;
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

export const SHADOW_ADJUSTMENT_END = 0.4;
export const SHADOW_MAX_POINT_X = 0.15;
export const SHADOW_MAX_POINT_Y = 0.05;
export const SHADOW_SOFT_POINT_CURVE_X =
  SHADOW_MAX_POINT_X / (1 - Math.sqrt(SHADOW_MAX_POINT_Y / SHADOW_MAX_POINT_X));
export const HIGHLIGHT_MAX_SIGMOID_GAIN = 4;
export const HIGHLIGHT_WORKING_EXPONENT = 2.4;

export type HighlightRange = {
  p0: number;
  p100: number;
};

export function cubicHermiteScalar(
  value: number,
  x0: number,
  y0: number,
  slope0: number,
  x1: number,
  y1: number,
  slope1: number,
): number {
  const span = x1 - x0;
  if (span <= 0) return y1;
  const t = Math.min(1, Math.max(0, (value - x0) / span));
  const t2 = t * t;
  const t3 = t2 * t;
  const h00 = 2 * t3 - 3 * t2 + 1;
  const h10 = t3 - 2 * t2 + t;
  const h01 = -2 * t3 + 3 * t2;
  const h11 = t3 - t2;
  return h00 * y0 + h10 * span * slope0 + h01 * y1 + h11 * span * slope1;
}

export function monotoneInteriorSlope(
  leftWidth: number,
  rightWidth: number,
  leftSlope: number,
  rightSlope: number,
): number {
  if (leftSlope <= 0 || rightSlope <= 0) return 0;
  const w1 = 2 * rightWidth + leftWidth;
  const w2 = rightWidth + 2 * leftWidth;
  return (w1 + w2) / (w1 / leftSlope + w2 / rightSlope);
}

export function applyShadowLinear(value: number, shadow: number): number {
  const normalized = clampToneRangeAdjustment(shadow);
  if (normalized === 0 || value >= SHADOW_ADJUSTMENT_END) return value;

  const p = -(SHADOW_MAX_POINT_X / 100) * normalized;
  if (normalized < 0) {
    if (value <= 0) return 0;
    const shadowPointY = p * Math.pow(1 - p / SHADOW_SOFT_POINT_CURVE_X, 2);
    const leftSlope = shadowPointY / p;
    const rightSlope = (SHADOW_ADJUSTMENT_END - shadowPointY) / (SHADOW_ADJUSTMENT_END - p);
    const middleSlope = monotoneInteriorSlope(
      p,
      SHADOW_ADJUSTMENT_END - p,
      leftSlope,
      rightSlope,
    );
    if (value <= p) {
      return cubicHermiteScalar(value, 0, 0, leftSlope, p, shadowPointY, middleSlope);
    }
    return cubicHermiteScalar(
      value,
      p,
      shadowPointY,
      middleSlope,
      SHADOW_ADJUSTMENT_END,
      SHADOW_ADJUSTMENT_END,
      1,
    );
  }

  if (value <= p) return 0;
  const secantSlope = SHADOW_ADJUSTMENT_END / (SHADOW_ADJUSTMENT_END - p);
  return cubicHermiteScalar(
    value,
    p,
    0,
    secantSlope,
    SHADOW_ADJUSTMENT_END,
    SHADOW_ADJUSTMENT_END,
    1,
  );
}

export function applyHighlightLinear(
  value: number,
  highlight: number,
  range: HighlightRange | null,
): number {
  const normalized = clampToneRangeAdjustment(highlight);
  if (normalized === 0 || !range) return value;

  const { p0, p100 } = range;
  const span = p100 - p0;
  if (!(span > 1e-12) || value <= p0 || value >= p100) return value;

  const x = Math.min(1, Math.max(0, (value - p0) / span));
  const workingX = Math.pow(x, HIGHLIGHT_WORKING_EXPONENT);
  const gain = HIGHLIGHT_MAX_SIGMOID_GAIN * Math.abs(normalized) / 100;
  if (!(gain > 1e-12)) return value;

  // The Highlight knee is fixed at the top of the normalized working domain.
  // Slider magnitude changes sigmoid gain itself rather than blending a fixed
  // maximum-strength curve with identity.
  const workingMid = 1;
  const minVal = naiveSigmoid(0, gain, workingMid);
  const maxVal = naiveSigmoid(1, gain, workingMid);
  const sigmoidSpan = maxVal - minVal;
  if (!(sigmoidSpan > 1e-12)) return value;

  const workingSigmoid = Math.min(
    1,
    Math.max(
      0,
      (naiveSigmoid(workingX, gain, workingMid) - minVal) / sigmoidSpan,
    ),
  );
  // Negative Highlight uses the endpoint-normalized sigmoid. Positive Highlight
  // mirrors the same displacement around identity, keeping both directions tied
  // to the same fixed knee at 1.
  const adjustedWorking = normalized < 0
    ? workingSigmoid
    : 2 * workingX - workingSigmoid;
  const adjusted = Math.pow(clamp01(adjustedWorking), 1 / HIGHLIGHT_WORKING_EXPONENT);

  return p0 + span * adjusted;
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
): [number, number, number] {
  if (hasWhiteBalance) {
    [r, g, b] = applyWhiteBalanceLinear(r, g, b, gains);
  }
  [r, g, b] = applyExposureLinearToRgb(r, g, b, factor);
  [r, g, b] = applyShadowHighlightLinearToRgb(
    r,
    g,
    b,
    shadow,
    highlight,
    highlightRange,
  );

  // Rolloff and clipping together form the boundary from extended-range linear
  // editing into the bounded [0,1] tone domain used by Logarithm and Sigmoid.
  [r, g, b] = applyDisplayRolloffAndClipLinearToRgb(r, g, b, rolloff);
  r = applyScaledLogLinear(r, scaledLog);
  g = applyScaledLogLinear(g, scaledLog);
  b = applyScaledLogLinear(b, scaledLog);
  r = applySigmoidLinear(r, sigmoid);
  g = applySigmoidLinear(g, sigmoid);
  b = applySigmoidLinear(b, sigmoid);
  return [r, g, b];
}

export type ColorAdjustmentContext = {
  gains: WhiteBalanceGains;
  hasWhiteBalance: boolean;
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

export function applyColorAdjustmentsLinearRgb(
  r: number,
  g: number,
  b: number,
  context: ColorAdjustmentContext,
): [number, number, number] {
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
  );
  if (context.normalizedSaturation !== 0 || context.normalizedVibrance !== 0) {
    const [h, initialS, v] = rgbToHsv(r, g, b);
    let s = initialS;
    if (context.normalizedSaturation !== 0) {
      s = applyRolloffScalar(s * context.saturationFactor, context.saturationRolloff);
      s = clamp01(s);
    }
    if (context.normalizedVibrance !== 0) {
      s = applyScaledLogLinear(s, context.vibranceFactor);
    }
    [r, g, b] = hsvToRgb(h, s, v);
  }
  return [r, g, b];
}

export const HISTOGRAM_DISPLAY_GAMMA = 2.4;
