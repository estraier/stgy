import {
  applyHsvSaturationPreservingProPhotoLuminance,
  applyScaledLogLinearExtended,
  clamp01,
  colorVibranceFactor,
  hsvToRgb,
  rgbToHsvExtended,
} from "@/image/tone";

export const IMAGE_MIXER_LUT_SIZE = 32;
export const IMAGE_MIXER_LUT_CHANNELS = 3;
export const IMAGE_MIXER_SETTING_COUNT = 45;

const MIXER_RELATIVE_CHROMA_L_MIN = 0.20;
const MIXER_RELATIVE_CHROMA_L_MAX = 0.95;
const MIXER_SATURATION_RELATIVE_CHROMA_ZERO = 0.05;
const MIXER_SATURATION_RELATIVE_CHROMA_FULL = 0.35;
const MIXER_LUMINANCE_RELATIVE_CHROMA_ZERO = 0.10;
const MIXER_LUMINANCE_RELATIVE_CHROMA_FULL = 0.50;
const MIXER_CMAX_BINARY_SEARCH_STEPS = 14;
const MIXER_CMAX_LIGHTNESS_BINS = 128;
const MIXER_CMAX_HUE_BINS = 360;
const mixerCmaxCache = new Float32Array(
  (MIXER_CMAX_LIGHTNESS_BINS + 1) * MIXER_CMAX_HUE_BINS,
);
mixerCmaxCache.fill(Number.NaN);
const MIXER_HUE_MAX_SHIFT_DEGREES = 60;
const MIXER_SATURATION_VIBRANCE_STRENGTH = 1.0;
const MIXER_LUMINANCE_MIDTONE_MAX = 20;
const PROPHOTO_LUMA_R = 0.2880402;
const PROPHOTO_LUMA_G = 0.7118741;
const PROPHOTO_LUMA_B = 0.0000857;

// Mixer color centers are 12 equal 30-degree divisions of OKLab hue,
// globally offset by 22.5 degrees. The UI palette, picker classification, and
// processing all use this same coordinate system directly.
const MIXER_COLOR_COUNT = 12;
const MIXER_HUE_STEP_DEGREES = 360 / MIXER_COLOR_COUNT;
const MIXER_HUE_OFFSET_DEGREES = 22.5;
const MIXER_PRIMARY_COUNT = 3;
const MIXER_PRIMARY_HUE_RADIUS_DEGREES = 90;
const MIXER_PRIMARY_SETTINGS_OFFSET = MIXER_COLOR_COUNT * 3;

export type ImageMixerLut = {
  key: string;
  size: number;
  data: Float32Array;
};

export type ImageMixerLutBuildResult = ImageMixerLut;

function clampMixerControl(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(-100, Math.min(100, value));
}

export function imageMixerLutKey(settings: ArrayLike<number>): string {
  const values: string[] = [];
  for (let i = 0; i < IMAGE_MIXER_SETTING_COUNT; i += 1) {
    values.push(String(Math.round(clampMixerControl(settings[i] ?? 0))));
  }
  return values.join(",");
}

function circularHueDistanceDegrees(a: number, b: number): number {
  const raw = Math.abs(a - b) % 360;
  return Math.min(raw, 360 - raw);
}

function primaryMixerWeight(hueDegrees: number, centerDegrees: number): number {
  const distance = circularHueDistanceDegrees(hueDegrees, centerDegrees);
  if (distance >= MIXER_PRIMARY_HUE_RADIUS_DEGREES) return 0;
  return 0.5 * (1 + Math.cos(Math.PI * distance / MIXER_PRIMARY_HUE_RADIUS_DEGREES));
}

function mixerGainHill(distanceDegrees: number): number {
  const distance = Math.abs(distanceDegrees);
  if (distance >= 60) return 0;
  const raisedCosine = 0.5 * (1 + Math.cos(Math.PI * distance / 60));
  return 2 * raisedCosine * raisedCosine;
}

function composeMixerControl(weightedSum: number, strongestAdjustment: number): number {
  if (!(strongestAdjustment > 0)) return 0;
  // The hill's 2.0 center is overlap/competition headroom, not a 2x control gain.
  // Normalize by the strongest active slider, combine all hue contributions,
  // clamp that combined weight to [-1, 1], then restore the slider scale.
  const combinedWeight = Math.max(-1, Math.min(1, weightedSum / strongestAdjustment));
  return combinedWeight * strongestAdjustment;
}

function smoothstepWeight(value: number, zero: number, full: number): number {
  const span = full - zero;
  if (!(span > 0)) return value > zero ? 1 : 0;
  const t = clamp01((value - zero) / span);
  return t * t * (3 - 2 * t);
}

function mixerSaturationRelativeChromaWeight(relativeChroma: number): number {
  return smoothstepWeight(
    relativeChroma,
    MIXER_SATURATION_RELATIVE_CHROMA_ZERO,
    MIXER_SATURATION_RELATIVE_CHROMA_FULL,
  );
}

function mixerLuminanceRelativeChromaWeight(relativeChroma: number): number {
  return smoothstepWeight(
    relativeChroma,
    MIXER_LUMINANCE_RELATIVE_CHROMA_ZERO,
    MIXER_LUMINANCE_RELATIVE_CHROMA_FULL,
  );
}

function normalizeDegrees(value: number): number {
  return ((value % 360) + 360) % 360;
}

export function imageMixerColorIndexForLinearProPhoto(
  r: number,
  g: number,
  b: number,
): number | null {
  const [, a, bb] = linearProPhotoToOklab(r, g, b);
  const chroma = Math.hypot(a, bb);
  if (!(chroma > 1e-6)) return null;
  const hueDegrees = normalizeDegrees(Math.atan2(bb, a) * 180 / Math.PI);
  const shiftedHue = normalizeDegrees(hueDegrees - MIXER_HUE_OFFSET_DEGREES);
  return Math.round(shiftedHue / MIXER_HUE_STEP_DEGREES) % MIXER_COLOR_COUNT;
}

export function imageMixerPrimaryIndexForLinearProPhoto(
  r: number,
  g: number,
  b: number,
): number | null {
  const [hue, saturation] = rgbToHsvExtended(r, g, b);
  if (!(saturation > 1e-6)) return null;
  const hueDegrees = normalizeDegrees(hue * 360);
  let bestIndex: number | null = null;
  let bestWeight = 0;
  for (let i = 0; i < MIXER_PRIMARY_COUNT; i += 1) {
    const center = i * 120;
    const weight = primaryMixerWeight(hueDegrees, center);
    if (weight > bestWeight) {
      bestWeight = weight;
      bestIndex = i;
    }
  }
  return bestWeight > 0 ? bestIndex : null;
}

function linearProPhotoToOklab(r: number, g: number, b: number): [number, number, number] {
  // Linear ProPhoto RGB (D50) -> XYZ D50.
  const x50 = 0.7976749 * r + 0.1351917 * g + 0.0313534 * b;
  const y50 = 0.2880402 * r + 0.7118741 * g + 0.0000857 * b;
  const z50 = 0.8252100 * b;

  // Bradford D50 -> D65.
  const x65 = 0.9555766 * x50 - 0.0230393 * y50 + 0.0631636 * z50;
  const y65 = -0.0282895 * x50 + 1.0099416 * y50 + 0.0210077 * z50;
  const z65 = 0.0122982 * x50 - 0.0204830 * y50 + 1.3299098 * z50;

  // XYZ D65 -> linear sRGB -> OKLab. Using the published linear-sRGB
  // OKLab matrices here keeps the forward/inverse pair numerically stable.
  const sr = 3.2404542 * x65 - 1.5371385 * y65 - 0.4985314 * z65;
  const sg = -0.9692660 * x65 + 1.8760108 * y65 + 0.0415560 * z65;
  const sb = 0.0556434 * x65 - 0.2040259 * y65 + 1.0572252 * z65;

  const l = 0.4122214708 * sr + 0.5363325363 * sg + 0.0514459929 * sb;
  const m = 0.2119034982 * sr + 0.6806995451 * sg + 0.1073969566 * sb;
  const ss = 0.0883024619 * sr + 0.2817188376 * sg + 0.6299787005 * sb;
  const lRoot = Math.cbrt(l);
  const mRoot = Math.cbrt(m);
  const sRoot = Math.cbrt(ss);

  return [
    0.2104542553 * lRoot + 0.7936177850 * mRoot - 0.0040720468 * sRoot,
    1.9779984951 * lRoot - 2.4285922050 * mRoot + 0.4505937099 * sRoot,
    0.0259040371 * lRoot + 0.7827717662 * mRoot - 0.8086757660 * sRoot,
  ];
}

function oklabToLinearProPhoto(L: number, a: number, b: number): [number, number, number] {
  const lRoot = L + 0.3963377774 * a + 0.2158037573 * b;
  const mRoot = L - 0.1055613458 * a - 0.0638541728 * b;
  const sRoot = L - 0.0894841775 * a - 1.2914855480 * b;
  const l = lRoot * lRoot * lRoot;
  const m = mRoot * mRoot * mRoot;
  const ss = sRoot * sRoot * sRoot;

  const sr = 4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * ss;
  const sg = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * ss;
  const sb = -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * ss;

  // linear sRGB -> XYZ D65.
  const x65 = 0.4124564 * sr + 0.3575761 * sg + 0.1804375 * sb;
  const y65 = 0.2126729 * sr + 0.7151522 * sg + 0.0721750 * sb;
  const z65 = 0.0193339 * sr + 0.1191920 * sg + 0.9503041 * sb;

  // Bradford D65 -> D50.
  const x50 = 1.0478112 * x65 + 0.0228866 * y65 - 0.0501270 * z65;
  const y50 = 0.0295424 * x65 + 0.9904844 * y65 - 0.0170491 * z65;
  const z50 = -0.0092345 * x65 + 0.0150436 * y65 + 0.7521316 * z65;

  // XYZ D50 -> linear ProPhoto RGB.
  return [
    1.3459433 * x50 - 0.2556075 * y50 - 0.0511118 * z50,
    -0.5445989 * x50 + 1.5081673 * y50 + 0.0205351 * z50,
    1.2118128 * z50,
  ];
}

function isLinearProPhotoUnitGamut(r: number, g: number, b: number): boolean {
  return Number.isFinite(r) && Number.isFinite(g) && Number.isFinite(b)
    && r >= 0 && r <= 1
    && g >= 0 && g <= 1
    && b >= 0 && b <= 1;
}

function maxOklabChromaForLinearProPhotoGamut(L: number, hueDegrees: number): number {
  const hueRadians = hueDegrees * Math.PI / 180;
  const hueA = Math.cos(hueRadians);
  const hueB = Math.sin(hueRadians);

  const isInGamut = (chroma: number): boolean => {
    const [r, g, b] = oklabToLinearProPhoto(L, chroma * hueA, chroma * hueB);
    return isLinearProPhotoUnitGamut(r, g, b);
  };

  // Find an out-of-gamut upper bound first. ProPhoto is wide enough that a
  // fixed sRGB-like Chroma ceiling would bias the normalization by hue.
  let low = 0;
  let high = 0.25;
  while (high < 2 && isInGamut(high)) {
    low = high;
    high *= 2;
  }
  if (high > 2) high = 2;
  if (isInGamut(high)) return high;

  for (let i = 0; i < MIXER_CMAX_BINARY_SEARCH_STEPS; i += 1) {
    const mid = (low + high) * 0.5;
    if (isInGamut(mid)) low = mid;
    else high = mid;
  }
  return low;
}

function cachedMaxOklabChromaForMixerReference(L: number, hueDegrees: number): number {
  const lightnessSpan = MIXER_RELATIVE_CHROMA_L_MAX - MIXER_RELATIVE_CHROMA_L_MIN;
  const normalizedL = lightnessSpan > 0
    ? clamp01((L - MIXER_RELATIVE_CHROMA_L_MIN) / lightnessSpan)
    : 0;
  const lightnessIndex = Math.round(normalizedL * MIXER_CMAX_LIGHTNESS_BINS);
  const hueIndex = Math.round(normalizeDegrees(hueDegrees)) % MIXER_CMAX_HUE_BINS;
  const cacheIndex = lightnessIndex * MIXER_CMAX_HUE_BINS + hueIndex;
  const cached = mixerCmaxCache[cacheIndex];
  if (Number.isFinite(cached)) return cached;

  const quantizedL = MIXER_RELATIVE_CHROMA_L_MIN
    + lightnessSpan * (lightnessIndex / MIXER_CMAX_LIGHTNESS_BINS);
  const quantizedHue = hueIndex * (360 / MIXER_CMAX_HUE_BINS);
  const maxChroma = maxOklabChromaForLinearProPhotoGamut(quantizedL, quantizedHue);
  mixerCmaxCache[cacheIndex] = maxChroma;
  return maxChroma;
}

function mixerRelativeChroma(L: number, chroma: number, hueDegrees: number): number {
  if (!(chroma > 1e-12)) return 0;
  // Clamp only the lightness used to define the reference gamut boundary.
  // This prevents tiny dark-noise chroma from becoming fully chromatic as
  // Cmax collapses near black, and also avoids overrating tiny near-white
  // color differences.
  const referenceL = Math.max(
    MIXER_RELATIVE_CHROMA_L_MIN,
    Math.min(MIXER_RELATIVE_CHROMA_L_MAX, L),
  );
  const maxChroma = cachedMaxOklabChromaForMixerReference(referenceL, hueDegrees);
  if (!(maxChroma > 1e-12) || !Number.isFinite(maxChroma)) return 0;
  return Math.max(0, chroma / maxChroma);
}

function prophotoLuma(r: number, g: number, b: number): number {
  return Math.max(0, r * PROPHOTO_LUMA_R + g * PROPHOTO_LUMA_G + b * PROPHOTO_LUMA_B);
}

function scaleRgbToLuma(r: number, g: number, b: number, targetLuma: number): [number, number, number] {
  const sourceLuma = prophotoLuma(r, g, b);
  if (!(sourceLuma > 1e-12) || !Number.isFinite(sourceLuma) || !Number.isFinite(targetLuma)) {
    return [r, g, b];
  }
  const scale = targetLuma / sourceLuma;
  return [r * scale, g * scale, b * scale];
}

function applyPrimaryMixerLinearRgb(
  r: number,
  g: number,
  b: number,
  settings: ArrayLike<number>,
): [number, number, number] {
  const originalLuma = prophotoLuma(r, g, b);
  if (!(originalLuma > 1e-12)) return [r, g, b];

  let [hue, saturation] = rgbToHsvExtended(r, g, b);
  const hueDegrees = normalizeDegrees(hue * 360);

  let hueControl = 0;
  let saturationControl = 0;
  let luminanceControl = 0;
  let hueControlLimit = 0;
  let saturationControlLimit = 0;
  let luminanceControlLimit = 0;

  for (let primaryIndex = 0; primaryIndex < MIXER_PRIMARY_COUNT; primaryIndex += 1) {
    const base = MIXER_PRIMARY_SETTINGS_OFFSET + primaryIndex * 3;
    const hueAdjustment = clampMixerControl(settings[base] ?? 0);
    const saturationAdjustment = clampMixerControl(settings[base + 1] ?? 0);
    const luminanceAdjustment = clampMixerControl(settings[base + 2] ?? 0);
    if (hueAdjustment === 0 && saturationAdjustment === 0 && luminanceAdjustment === 0) continue;
    const weight = primaryMixerWeight(hueDegrees, primaryIndex * 120);
    if (!(weight > 0)) continue;

    if (hueAdjustment !== 0) {
      hueControl += hueAdjustment * weight;
      hueControlLimit = Math.max(hueControlLimit, Math.abs(hueAdjustment));
    }
    if (saturationAdjustment !== 0) {
      saturationControl += saturationAdjustment * weight;
      saturationControlLimit = Math.max(saturationControlLimit, Math.abs(saturationAdjustment));
    }
    if (luminanceAdjustment !== 0) {
      luminanceControl += luminanceAdjustment * weight;
      luminanceControlLimit = Math.max(luminanceControlLimit, Math.abs(luminanceAdjustment));
    }
  }

  hueControl = composeMixerControl(hueControl, hueControlLimit);
  saturationControl = composeMixerControl(saturationControl, saturationControlLimit);
  luminanceControl = composeMixerControl(luminanceControl, luminanceControlLimit);

  const hueShift = (hueControl / 100) * MIXER_HUE_MAX_SHIFT_DEGREES;
  const saturationAmount = saturationControl;
  const luminanceAmount = luminanceControl;

  let mixedR = r;
  let mixedG = g;
  let mixedB = b;

  if (Math.abs(hueShift) > 1e-9) {
    const [, , value] = rgbToHsvExtended(mixedR, mixedG, mixedB);
    [mixedR, mixedG, mixedB] = hsvToRgb(normalizeDegrees(hueDegrees + hueShift) / 360, saturation, value);
    [mixedR, mixedG, mixedB] = scaleRgbToLuma(mixedR, mixedG, mixedB, originalLuma);
  }

  if (Math.abs(saturationAmount) > 1e-9) {
    const [, currentSaturation] = rgbToHsvExtended(mixedR, mixedG, mixedB);
    const targetSaturation = Math.max(0, applyScaledLogLinearExtended(
      currentSaturation,
      colorVibranceFactor(saturationAmount) * MIXER_SATURATION_VIBRANCE_STRENGTH,
    ));
    [mixedR, mixedG, mixedB] = applyHsvSaturationPreservingProPhotoLuminance(
      mixedR,
      mixedG,
      mixedB,
      targetSaturation,
    );
  }

  if (Math.abs(luminanceAmount) > 1e-9) {
    const scaledLog = luminanceAmount * (MIXER_LUMINANCE_MIDTONE_MAX / 100);
    const targetLuma = applyScaledLogLinearExtended(originalLuma, scaledLog);
    [mixedR, mixedG, mixedB] = scaleRgbToLuma(mixedR, mixedG, mixedB, targetLuma);
  }

  return [mixedR, mixedG, mixedB];
}

function applyRichMixerLinearRgb(
  r: number,
  g: number,
  b: number,
  settings: ArrayLike<number>,
): [number, number, number] {
  const originalLuma = prophotoLuma(r, g, b);
  if (!(originalLuma > 1e-12)) return [r, g, b];

  const [L, a, bb] = linearProPhotoToOklab(r, g, b);
  const chroma = Math.hypot(a, bb);
  const hueDegrees = chroma > 1e-12 ? normalizeDegrees(Math.atan2(bb, a) * 180 / Math.PI) : 0;
  const mixerHueDegrees = hueDegrees;

  let hueControl = 0;
  let saturationControl = 0;
  let luminanceControl = 0;
  let hueControlLimit = 0;
  let saturationControlLimit = 0;
  let luminanceControlLimit = 0;

  for (let colorIndex = 0; colorIndex < MIXER_COLOR_COUNT; colorIndex += 1) {
    const base = colorIndex * 3;
    const hueAdjustment = clampMixerControl(settings[base] ?? 0);
    const saturationAdjustment = clampMixerControl(settings[base + 1] ?? 0);
    const luminanceAdjustment = clampMixerControl(settings[base + 2] ?? 0);
    if (hueAdjustment === 0 && saturationAdjustment === 0 && luminanceAdjustment === 0) continue;
    const center = normalizeDegrees(MIXER_HUE_OFFSET_DEGREES + colorIndex * MIXER_HUE_STEP_DEGREES);
    const distance = circularHueDistanceDegrees(mixerHueDegrees, center);
    const gainHill = mixerGainHill(distance);
    if (!(gainHill > 0)) continue;

    if (hueAdjustment !== 0) {
      hueControl += hueAdjustment * gainHill;
      hueControlLimit = Math.max(hueControlLimit, Math.abs(hueAdjustment));
    }
    if (saturationAdjustment !== 0) {
      saturationControl += saturationAdjustment * gainHill;
      saturationControlLimit = Math.max(saturationControlLimit, Math.abs(saturationAdjustment));
    }
    if (luminanceAdjustment !== 0) {
      luminanceControl += luminanceAdjustment * gainHill;
      luminanceControlLimit = Math.max(luminanceControlLimit, Math.abs(luminanceAdjustment));
    }
  }

  hueControl = composeMixerControl(hueControl, hueControlLimit);
  saturationControl = composeMixerControl(saturationControl, saturationControlLimit);
  luminanceControl = composeMixerControl(luminanceControl, luminanceControlLimit);

  let saturationRelativeChromaWeight = 0;
  let luminanceRelativeChromaWeight = 0;
  if (Math.abs(saturationControl) > 1e-9 || Math.abs(luminanceControl) > 1e-9) {
    const relativeChroma = mixerRelativeChroma(L, chroma, mixerHueDegrees);
    if (Math.abs(saturationControl) > 1e-9) {
      saturationRelativeChromaWeight = mixerSaturationRelativeChromaWeight(relativeChroma);
    }
    if (Math.abs(luminanceControl) > 1e-9) {
      luminanceRelativeChromaWeight = mixerLuminanceRelativeChromaWeight(relativeChroma);
    }
  }

  const hueShift = (hueControl / 100) * MIXER_HUE_MAX_SHIFT_DEGREES;
  const saturationAmount = saturationControl * saturationRelativeChromaWeight;
  const luminanceAmount = luminanceControl * luminanceRelativeChromaWeight;

  let mixedR = r;
  let mixedG = g;
  let mixedB = b;

  if (Math.abs(hueShift) > 1e-9) {
    const adjustedMixerHue = normalizeDegrees(mixerHueDegrees + hueShift);
    const hueRadians = adjustedMixerHue * Math.PI / 180;
    const adjustedA = chroma * Math.cos(hueRadians);
    const adjustedB = chroma * Math.sin(hueRadians);
    [mixedR, mixedG, mixedB] = oklabToLinearProPhoto(L, adjustedA, adjustedB);

    // Hue edits should not implicitly alter image brightness. Restore the
    // original ProPhoto luminance before Saturation/Luminance adjustment.
    [mixedR, mixedG, mixedB] = scaleRgbToLuma(mixedR, mixedG, mixedB, originalLuma);
  }

  if (Math.abs(saturationAmount) > 1e-9) {
    const [, currentSaturation] = rgbToHsvExtended(mixedR, mixedG, mixedB);
    const targetSaturation = Math.max(0, applyScaledLogLinearExtended(
      currentSaturation,
      colorVibranceFactor(saturationAmount) * MIXER_SATURATION_VIBRANCE_STRENGTH,
    ));
    [mixedR, mixedG, mixedB] = applyHsvSaturationPreservingProPhotoLuminance(
      mixedR,
      mixedG,
      mixedB,
      targetSaturation,
    );
  }

  if (Math.abs(luminanceAmount) > 1e-9) {
    const scaledLog = luminanceAmount * (MIXER_LUMINANCE_MIDTONE_MAX / 100);
    const targetLuma = applyScaledLogLinearExtended(originalLuma, scaledLog);
    [mixedR, mixedG, mixedB] = scaleRgbToLuma(mixedR, mixedG, mixedB, targetLuma);
  }

  return [mixedR, mixedG, mixedB];
}

export function buildImageMixerLut(
  settings: ArrayLike<number>,
  key = imageMixerLutKey(settings),
): ImageMixerLutBuildResult {
  const size = IMAGE_MIXER_LUT_SIZE;
  const data = new Float32Array(size * size * size * IMAGE_MIXER_LUT_CHANNELS);
  const maxIndex = size - 1;
  let offset = 0;

  for (let ri = 0; ri < size; ri += 1) {
    const encodedR = ri / maxIndex;
    const r = encodedR * encodedR;
    for (let gi = 0; gi < size; gi += 1) {
      const encodedG = gi / maxIndex;
      const g = encodedG * encodedG;
      for (let bi = 0; bi < size; bi += 1) {
        const encodedB = bi / maxIndex;
        const b = encodedB * encodedB;
        const [pr, pg, pb] = applyPrimaryMixerLinearRgb(r, g, b, settings);
        const [mr, mg, mb] = applyRichMixerLinearRgb(pr, pg, pb, settings);
        data[offset] = Math.sqrt(clamp01(mr));
        data[offset + 1] = Math.sqrt(clamp01(mg));
        data[offset + 2] = Math.sqrt(clamp01(mb));
        offset += 3;
      }
    }
  }

  return { key, size, data };
}

function lutOffset(size: number, r: number, g: number, b: number): number {
  return ((r * size + g) * size + b) * 3;
}

function addVertex(
  data: Float32Array,
  size: number,
  r: number,
  g: number,
  b: number,
  weight: number,
  out: number[],
): void {
  if (!(weight !== 0)) return;
  const index = lutOffset(size, r, g, b);
  out[0] = (out[0] ?? 0) + (data[index] ?? 0) * weight;
  out[1] = (out[1] ?? 0) + (data[index + 1] ?? 0) * weight;
  out[2] = (out[2] ?? 0) + (data[index + 2] ?? 0) * weight;
}

export function sampleImageMixerLutTetrahedralInto(
  lut: ImageMixerLut,
  encodedR: number,
  encodedG: number,
  encodedB: number,
  out: number[],
): void {
  const size = lut.size;
  const maxIndex = size - 1;
  const xr = clamp01(encodedR) * maxIndex;
  const xg = clamp01(encodedG) * maxIndex;
  const xb = clamp01(encodedB) * maxIndex;
  const r0 = Math.min(maxIndex - 1, Math.floor(xr));
  const g0 = Math.min(maxIndex - 1, Math.floor(xg));
  const b0 = Math.min(maxIndex - 1, Math.floor(xb));
  const fr = xr - r0;
  const fg = xg - g0;
  const fb = xb - b0;
  const r1 = r0 + 1;
  const g1 = g0 + 1;
  const b1 = b0 + 1;

  out[0] = 0;
  out[1] = 0;
  out[2] = 0;

  if (fr >= fg) {
    if (fg >= fb) {
      // r >= g >= b
      addVertex(lut.data, size, r0, g0, b0, 1 - fr, out);
      addVertex(lut.data, size, r1, g0, b0, fr - fg, out);
      addVertex(lut.data, size, r1, g1, b0, fg - fb, out);
      addVertex(lut.data, size, r1, g1, b1, fb, out);
    } else if (fr >= fb) {
      // r >= b > g
      addVertex(lut.data, size, r0, g0, b0, 1 - fr, out);
      addVertex(lut.data, size, r1, g0, b0, fr - fb, out);
      addVertex(lut.data, size, r1, g0, b1, fb - fg, out);
      addVertex(lut.data, size, r1, g1, b1, fg, out);
    } else {
      // b > r >= g
      addVertex(lut.data, size, r0, g0, b0, 1 - fb, out);
      addVertex(lut.data, size, r0, g0, b1, fb - fr, out);
      addVertex(lut.data, size, r1, g0, b1, fr - fg, out);
      addVertex(lut.data, size, r1, g1, b1, fg, out);
    }
  } else if (fr >= fb) {
    // g > r >= b
    addVertex(lut.data, size, r0, g0, b0, 1 - fg, out);
    addVertex(lut.data, size, r0, g1, b0, fg - fr, out);
    addVertex(lut.data, size, r1, g1, b0, fr - fb, out);
    addVertex(lut.data, size, r1, g1, b1, fb, out);
  } else if (fg >= fb) {
    // g >= b > r
    addVertex(lut.data, size, r0, g0, b0, 1 - fg, out);
    addVertex(lut.data, size, r0, g1, b0, fg - fb, out);
    addVertex(lut.data, size, r0, g1, b1, fb - fr, out);
    addVertex(lut.data, size, r1, g1, b1, fr, out);
  } else {
    // b > g > r
    addVertex(lut.data, size, r0, g0, b0, 1 - fb, out);
    addVertex(lut.data, size, r0, g0, b1, fb - fg, out);
    addVertex(lut.data, size, r0, g1, b1, fg - fr, out);
    addVertex(lut.data, size, r1, g1, b1, fr, out);
  }
}

const MIXER_LUT_CACHE_MAX = 6;
const mixerLutCache = new Map<string, ImageMixerLut>();

export function getCachedImageMixerLut(key: string): ImageMixerLut | null {
  const lut = mixerLutCache.get(key);
  if (!lut || lut.size !== IMAGE_MIXER_LUT_SIZE) {
    if (lut) mixerLutCache.delete(key);
    return null;
  }
  mixerLutCache.delete(key);
  mixerLutCache.set(key, lut);
  return lut;
}

export function cacheImageMixerLut(lut: ImageMixerLut): void {
  if (lut.size !== IMAGE_MIXER_LUT_SIZE) return;
  mixerLutCache.delete(lut.key);
  mixerLutCache.set(lut.key, lut);
  while (mixerLutCache.size > MIXER_LUT_CACHE_MAX) {
    const oldest = mixerLutCache.keys().next().value as string | undefined;
    if (oldest === undefined) break;
    mixerLutCache.delete(oldest);
  }
}

export function getOrBuildImageMixerLut(settings: ArrayLike<number>): ImageMixerLut {
  const key = imageMixerLutKey(settings);
  const cached = getCachedImageMixerLut(key);
  if (cached) return cached;
  const built = buildImageMixerLut(settings, key);
  cacheImageMixerLut(built);
  return built;
}
