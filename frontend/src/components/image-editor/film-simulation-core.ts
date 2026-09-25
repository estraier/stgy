import {
  applyScaledLogLinearExtended,
  clamp01,
  hsvToRgb,
  rgbToHsvExtended,
} from "@/image/tone";
import {
  PROPHOTO_LUMA_B,
  PROPHOTO_LUMA_G,
  PROPHOTO_LUMA_R,
} from "@/image/color";
import type { FilmSimulationParams } from "./film-simulation-params";

const PRIMARY_HUE_RADIUS_DEGREES = 90;
const HSL_HUE_SCALE_DEGREES = 0.30;
const HSL_LUMINANCE_SATURATION_LOW = 0.02;
const HSL_LUMINANCE_SATURATION_HIGH = 0.12;
const SHADOW_TINT_GREEN_PER_UNIT = 0.003;
const HSL_HUE_CENTERS = [0, 30, 60, 120, 180, 240, 270, 300] as const;

type CompiledToneSpline = {
  points: readonly (readonly [number, number])[];
  slopes: readonly number[];
};

export type CompiledFilmSimulation = {
  params: FilmSimulationParams;
  toneSpline: CompiledToneSpline;
};

function smoothstep01(value: number): number {
  const t = clamp01(value);
  return t * t * (3 - 2 * t);
}

function normalizeHueDegrees(value: number): number {
  return ((value % 360) + 360) % 360;
}

function circularHueDistanceDegrees(a: number, b: number): number {
  const distance = Math.abs(normalizeHueDegrees(a) - normalizeHueDegrees(b));
  return Math.min(distance, 360 - distance);
}

function primaryWeight(hueDegrees: number, centerDegrees: number): number {
  const distance = circularHueDistanceDegrees(hueDegrees, centerDegrees);
  if (distance >= PRIMARY_HUE_RADIUS_DEGREES) return 0;
  return 0.5 * (1 + Math.cos(Math.PI * distance / PRIMARY_HUE_RADIUS_DEGREES));
}

function prophotoLuma(r: number, g: number, b: number): number {
  return Math.max(0, r * PROPHOTO_LUMA_R + g * PROPHOTO_LUMA_G + b * PROPHOTO_LUMA_B);
}

function scaleRgbToLuma(r: number, g: number, b: number, targetLuma: number): [number, number, number] {
  const sourceLuma = prophotoLuma(r, g, b);
  if (!(sourceLuma > 1e-12) || !Number.isFinite(sourceLuma) || !Number.isFinite(targetLuma)) {
    return [r, g, b];
  }
  const scale = Math.max(0, targetLuma) / sourceLuma;
  return [Math.max(0, r * scale), Math.max(0, g * scale), Math.max(0, b * scale)];
}

function limitToUnitMax(r: number, g: number, b: number): [number, number, number] {
  const maxChannel = Math.max(r, g, b);
  if (!(maxChannel > 1)) return [Math.max(0, r), Math.max(0, g), Math.max(0, b)];
  const scale = 1 / maxChannel;
  return [Math.max(0, r * scale), Math.max(0, g * scale), Math.max(0, b * scale)];
}

function interpolateHueControls(hueDegrees: number, values: readonly number[]): number {
  const hue = normalizeHueDegrees(hueDegrees);
  const count = Math.min(HSL_HUE_CENTERS.length, values.length);
  if (count === 0) return 0;

  for (let i = 0; i < count; i += 1) {
    const center = HSL_HUE_CENTERS[i] ?? 0;
    const nextIndex = (i + 1) % count;
    const nextCenterRaw = HSL_HUE_CENTERS[nextIndex] ?? 360;
    const nextCenter = nextIndex === 0 ? 360 : nextCenterRaw;
    const adjustedHue = i === count - 1 && hue < center ? hue + 360 : hue;
    if (adjustedHue < center || adjustedHue > nextCenter) continue;
    const span = Math.max(1e-9, nextCenter - center);
    const t = smoothstep01((adjustedHue - center) / span);
    const a = values[i] ?? 0;
    const b = values[nextIndex] ?? 0;
    return a * (1 - t) + b * t;
  }
  return values[0] ?? 0;
}

function compileMonotoneSpline(points: readonly (readonly [number, number])[]): CompiledToneSpline {
  const n = points.length;
  if (n < 2) return { points, slopes: new Array(n).fill(0) };
  const h = new Array<number>(n - 1);
  const delta = new Array<number>(n - 1);
  for (let i = 0; i < n - 1; i += 1) {
    const p0 = points[i] ?? [0, 0];
    const p1 = points[i + 1] ?? p0;
    h[i] = Math.max(1e-9, p1[0] - p0[0]);
    delta[i] = (p1[1] - p0[1]) / h[i];
  }

  const slopes = new Array<number>(n).fill(0);
  slopes[0] = delta[0] ?? 0;
  slopes[n - 1] = delta[n - 2] ?? 0;
  for (let i = 1; i < n - 1; i += 1) {
    const d0 = delta[i - 1] ?? 0;
    const d1 = delta[i] ?? 0;
    if (d0 === 0 || d1 === 0 || d0 * d1 <= 0) {
      slopes[i] = 0;
      continue;
    }
    const h0 = h[i - 1] ?? 1;
    const h1 = h[i] ?? 1;
    const w1 = 2 * h1 + h0;
    const w2 = h1 + 2 * h0;
    slopes[i] = (w1 + w2) / (w1 / d0 + w2 / d1);
  }

  if (n > 2) {
    const endpoint = (h0: number, h1: number, d0: number, d1: number): number => {
      let m = ((2 * h0 + h1) * d0 - h0 * d1) / Math.max(1e-9, h0 + h1);
      if (m * d0 <= 0) return 0;
      if (d0 * d1 < 0 && Math.abs(m) > Math.abs(3 * d0)) m = 3 * d0;
      return m;
    };
    slopes[0] = endpoint(h[0] ?? 1, h[1] ?? 1, delta[0] ?? 0, delta[1] ?? 0);
    slopes[n - 1] = endpoint(
      h[n - 2] ?? 1,
      h[n - 3] ?? 1,
      delta[n - 2] ?? 0,
      delta[n - 3] ?? 0,
    );
  }

  return { points, slopes };
}

function evaluateMonotoneSpline(spline: CompiledToneSpline, value: number): number {
  const x = clamp01(value);
  const { points, slopes } = spline;
  if (points.length < 2) return x;
  for (let i = 0; i < points.length - 1; i += 1) {
    const p0 = points[i];
    const p1 = points[i + 1];
    if (!p0 || !p1 || x < p0[0] || x > p1[0]) continue;
    const h = Math.max(1e-9, p1[0] - p0[0]);
    const t = (x - p0[0]) / h;
    const t2 = t * t;
    const t3 = t2 * t;
    const h00 = 2 * t3 - 3 * t2 + 1;
    const h10 = t3 - 2 * t2 + t;
    const h01 = -2 * t3 + 3 * t2;
    const h11 = t3 - t2;
    return clamp01(
      h00 * p0[1]
      + h10 * h * (slopes[i] ?? 0)
      + h01 * p1[1]
      + h11 * h * (slopes[i + 1] ?? 0),
    );
  }
  return x;
}

export function compileFilmSimulation(params: FilmSimulationParams): CompiledFilmSimulation {
  return { params, toneSpline: compileMonotoneSpline(params.toneCurve) };
}

export function applyFilmSimulationCoreLinearRgb(
  r: number,
  g: number,
  b: number,
  compiled: CompiledFilmSimulation,
): [number, number, number] {
  const params = compiled.params;
  let rr = clamp01(r);
  let gg = clamp01(g);
  let bb = clamp01(b);

  let [hue, saturation, value] = rgbToHsvExtended(rr, gg, bb);
  const hueDegrees = normalizeHueDegrees(hue * 360);
  const redWeight = primaryWeight(hueDegrees, 0);
  const greenWeight = primaryWeight(hueDegrees, 120);
  const blueWeight = primaryWeight(hueDegrees, 240);
  const primaryHueShift = redWeight * params.primary.redHue
    + greenWeight * params.primary.greenHue
    + blueWeight * params.primary.blueHue;
  const primarySaturation = redWeight * params.primary.redSaturation
    + greenWeight * params.primary.greenSaturation
    + blueWeight * params.primary.blueSaturation;
  hue = normalizeHueDegrees(hueDegrees + primaryHueShift) / 360;
  saturation = clamp01(saturation * (1 + primarySaturation * 0.01));
  [rr, gg, bb] = hsvToRgb(hue, saturation, value);

  [hue, saturation, value] = rgbToHsvExtended(rr, gg, bb);
  const adjustedHueDegrees = normalizeHueDegrees(hue * 360);
  const hslHueShift = interpolateHueControls(adjustedHueDegrees, params.hslHue) * HSL_HUE_SCALE_DEGREES;
  const hslSaturation = interpolateHueControls(adjustedHueDegrees, params.hslSaturation);
  const hslLuminanceWeight = smoothstep01(
    (saturation - HSL_LUMINANCE_SATURATION_LOW)
      / (HSL_LUMINANCE_SATURATION_HIGH - HSL_LUMINANCE_SATURATION_LOW),
  );
  const hslLuminance = interpolateHueControls(adjustedHueDegrees, params.hslLuminance)
    * hslLuminanceWeight;
  hue = normalizeHueDegrees(adjustedHueDegrees + hslHueShift) / 360;
  saturation = clamp01(saturation * (1 + hslSaturation * 0.01));
  [rr, gg, bb] = hsvToRgb(hue, saturation, value);

  if (Math.abs(hslLuminance) > 1e-9) {
    const currentLuma = prophotoLuma(rr, gg, bb);
    [rr, gg, bb] = scaleRgbToLuma(rr, gg, bb, currentLuma * Math.pow(2, hslLuminance * 0.01));
  }

  [hue, saturation, value] = rgbToHsvExtended(rr, gg, bb);
  if (params.globalSaturation !== 0) {
    saturation = clamp01(saturation * (1 + params.globalSaturation * 0.01));
  }
  if (params.vibrance !== 0) {
    saturation = clamp01(applyScaledLogLinearExtended(saturation, params.vibrance * 0.01));
  }
  [rr, gg, bb] = hsvToRgb(hue, saturation, value);

  const tintLuma = prophotoLuma(rr, gg, bb);
  const shadowTintWeight = Math.pow(1 - clamp01(tintLuma), 2);
  gg *= 1 - params.shadowTint * SHADOW_TINT_GREEN_PER_UNIT * shadowTintWeight;

  const toneInputLuma = prophotoLuma(rr, gg, bb);
  const targetLuma = evaluateMonotoneSpline(compiled.toneSpline, toneInputLuma);
  [rr, gg, bb] = scaleRgbToLuma(rr, gg, bb, targetLuma);

  return limitToUnitMax(rr, gg, bb);
}
