import type { ImageEditOutputColorProfile } from "@/image/types";
import {
  FINAL_DISPLAY_ROLLOFF_A,
  ROLLOFF_SAVING_LIMIT_FACTOR,
  SATURATION_ROLLOFF_A,
  applyLuminanceGainPreservingAboveOneLinearRgbInto,
  applySaturationVibranceAndFinalRolloffLinearRgbInto,
  applyToneAdjustmentsLinearRgbRangeInto,
  clampScaledLog,
  clampSigmoid,
  clampToneRangeAdjustment,
  colorSaturationFactor,
  rgbSaturationExtended,
  rolloffParams,
  type ColorAdjustmentContext,
  type RolloffParams,
  type ToneAdjustmentStage,
} from "@/image/tone";
import {
  buildImageEditClarityMapFromToneSample,
  clampClarity,
  isUsableImageEditClarityMap,
  sampleImageEditClarityGain,
  type ImageEditClarityMap,
} from "@/components/image-editor/clarity";

export const STACK_LOGARITHM_LIMIT = 20;
const STACK_FINAL_ROLLOFF_PERCENTILE = 0.998;
const STACK_FINAL_ROLLOFF_A = FINAL_DISPLAY_ROLLOFF_A;
const STACK_FINAL_ROLLOFF_SAVING_LIMIT = ROLLOFF_SAVING_LIMIT_FACTOR;

export type StackClaheMap = ImageEditClarityMap;

function stackFinalDisplayRolloffParams(maxVal: number): RolloffParams {
  const rolloff = rolloffParams(
    maxVal,
    STACK_FINAL_ROLLOFF_A,
    STACK_FINAL_ROLLOFF_SAVING_LIMIT,
    1,
  );
  if (rolloff) return rolloff;
  return {
    inflection: 1,
    inputMax: Number.isFinite(maxVal) ? Math.max(0, maxVal) : 0,
    outputMax: 1,
  };
}

export type StackToneStage =
  | "source"
  | "exposure"
  | "logarithm"
  | "sigmoid"
  | "shadow"
  | "highlight";

export type StackFinalRolloff = {
  saturationRolloff: RolloffParams | null;
  finalRolloff: RolloffParams | null;
} | null;

const STACK_TONE_STAGE_BOUNDARY: Record<StackToneStage, ToneAdjustmentStage> = {
  source: "exposure",
  exposure: "scaled-log",
  logarithm: "sigmoid",
  sigmoid: "shadow",
  shadow: "highlight",
  highlight: "black",
};

type StackToneContext = ColorAdjustmentContext;

export function clampStackScaledLog(value: number): number {
  return clampScaledLog(value);
}

export function clampStackClahe(value: number): number {
  return clampClarity(value);
}

export function computeStackFinalRolloff(
  sourceLinear: Float32Array | null | undefined,
  exposureEv: number,
  shadow: number,
  highlight: number,
  scaledLog: number,
  sigmoid: number,
  vibrance: number,
  saturation: number,
): StackFinalRolloff {
  if (!sourceLinear || sourceLinear.length < 3) {
    return { saturationRolloff: null, finalRolloff: null };
  }
  const toneContext = buildStackToneContext(
    exposureEv,
    shadow,
    highlight,
    scaledLog,
    sigmoid,
  );
  const pixelCount = Math.floor(sourceLinear.length / 3);
  if (pixelCount <= 0) return { saturationRolloff: null, finalRolloff: null };

  const toneAdjusted = new Float32Array(pixelCount * 3);
  const saturationFactor = colorSaturationFactor(saturation);
  const saturationValues = saturationFactor > 1 ? new Float32Array(pixelCount) : null;
  let saturationCount = 0;
  const adjusted: [number, number, number] = [0, 0, 0];
  for (let pixel = 0, sourceIndex = 0; pixel < pixelCount; pixel += 1, sourceIndex += 3) {
    applyStackToneAdjustmentsLinearRgbRangeInto(
      sourceLinear[sourceIndex] ?? 0,
      sourceLinear[sourceIndex + 1] ?? 0,
      sourceLinear[sourceIndex + 2] ?? 0,
      toneContext,
      "source",
      "highlight",
      adjusted,
    );
    toneAdjusted[sourceIndex] = adjusted[0];
    toneAdjusted[sourceIndex + 1] = adjusted[1];
    toneAdjusted[sourceIndex + 2] = adjusted[2];
    if (saturationValues) {
      saturationValues[saturationCount++] = rgbSaturationExtended(adjusted[0], adjusted[1], adjusted[2]);
    }
  }

  let saturationRolloff: RolloffParams | null = null;
  if (saturationValues && saturationCount > 0) {
    const sorted = saturationCount === saturationValues.length
      ? saturationValues
      : saturationValues.slice(0, saturationCount);
    sorted.sort();
    const p998 = percentileFromSortedFloat32(sorted, STACK_FINAL_ROLLOFF_PERCENTILE);
    saturationRolloff = rolloffParams(p998 * saturationFactor, SATURATION_ROLLOFF_A, ROLLOFF_SAVING_LIMIT_FACTOR, 1);
  }

  const maxima = new Float32Array(pixelCount);
  let count = 0;
  for (let sourceIndex = 0; sourceIndex + 2 < toneAdjusted.length; sourceIndex += 3) {
    const r = toneAdjusted[sourceIndex] ?? 0;
    const g = toneAdjusted[sourceIndex + 1] ?? 0;
    const b = toneAdjusted[sourceIndex + 2] ?? 0;
    applySaturationVibranceAndFinalRolloffLinearRgbInto(
      r,
      g,
      b,
      saturation,
      vibrance,
      false,
      undefined,
      saturationRolloff,
      adjusted,
    );
    const maxChannel = Math.max(adjusted[0], adjusted[1], adjusted[2]);
    if (Number.isFinite(maxChannel)) maxima[count++] = maxChannel;
  }
  if (count <= 0) return { saturationRolloff, finalRolloff: null };
  const sorted = count === maxima.length ? maxima : maxima.slice(0, count);
  sorted.sort();
  const p998 = percentileFromSortedFloat32(sorted, STACK_FINAL_ROLLOFF_PERCENTILE);
  return {
    saturationRolloff,
    finalRolloff: stackFinalDisplayRolloffParams(p998),
  };
}

function percentileFromSortedFloat32(sorted: Float32Array, quantile: number): number {
  if (!sorted.length) return 0;
  const rank = (sorted.length - 1) * Math.min(1, Math.max(0, quantile));
  const lower = Math.floor(rank);
  const upper = Math.ceil(rank);
  const fraction = rank - lower;
  const lo = sorted[lower] ?? 0;
  const hi = sorted[upper] ?? lo;
  return lo + (hi - lo) * fraction;
}

export function isUsableStackClaheMap(
  map: StackClaheMap | null | undefined,
): map is StackClaheMap {
  return isUsableImageEditClarityMap(map);
}

export function sampleStackClaheGain(
  map: StackClaheMap,
  renderedSourceX: number,
  renderedSourceY: number,
  sourceWidth: number,
  sourceHeight: number,
): number {
  return sampleImageEditClarityGain(
    map,
    renderedSourceX,
    renderedSourceY,
    sourceWidth,
    sourceHeight,
  );
}

export function buildStackClaheMap(
  sourceLinear: Float32Array,
  width: number,
  height: number,
  exposureEv: number,
  shadow: number,
  highlight: number,
  scaledLog: number,
  sigmoid: number,
  clahe: number,
): StackClaheMap | null {
  const toneAdjusted = buildStackToneAdjustedLinearData(
    sourceLinear,
    width,
    height,
    exposureEv,
    shadow,
    highlight,
    scaledLog,
    sigmoid,
  );
  return buildStackClaheMapFromToneAdjusted(toneAdjusted, width, height, clahe);
}

export function buildStackClaheMapFromToneAdjusted(
  toneAdjustedLinear: Float32Array,
  width: number,
  height: number,
  clahe: number,
): StackClaheMap | null {
  const normalizedClahe = clampStackClahe(clahe);
  if (normalizedClahe === 0) return null;
  return buildImageEditClarityMapFromToneSample(
    {
      data: toneAdjustedLinear,
      width,
      height,
      linearRangeMax: 1,
    },
    normalizedClahe,
  );
}

export type StackFullRenderOptions = {
  exposureEv: number;
  shadow: number;
  highlight: number;
  scaledLog: number;
  sigmoid: number;
  clahe: number;
  vibrance: number;
  saturation: number;
  claheMap: StackClaheMap | null;
  applyFinalRolloff: boolean;
  finalRolloff: StackFinalRolloff | undefined;
};

/**
 * Decode stored gamma-2 ProPhoto RGB and apply the complete LSS tone/color
 * pipeline for a row range in one pixel pass. This is used by the full-size
 * render workers so the large intermediate linear/tone-adjusted buffers do not
 * have to be materialized on the main thread.
 */
export function adjustStackStoredGamma2RowsToLinear(
  sourceStored: Uint16Array,
  outputLinear: Float32Array,
  width: number,
  height: number,
  rowStart: number,
  rowEnd: number,
  options: StackFullRenderOptions,
): void {
  const expectedLength = width * height * 3;
  if (sourceStored.length < expectedLength || outputLinear.length < expectedLength) {
    throw new Error("LSS full-size render buffer is too small");
  }

  const startRow = Math.max(0, Math.min(height, Math.floor(rowStart)));
  const endRow = Math.max(startRow, Math.min(height, Math.floor(rowEnd)));
  const toneContext = buildStackToneContext(
    options.exposureEv,
    options.shadow,
    options.highlight,
    options.scaledLog,
    options.sigmoid,
  );
  const normalizedClahe = clampStackClahe(options.clahe);
  const activeClaheMap = normalizedClahe !== 0 && isUsableStackClaheMap(options.claheMap)
    ? options.claheMap
    : null;
  const inverseMax = 1 / 65535;
  const hasToneAdjustments = toneContext.hasExposure || toneContext.hasScaledLog || toneContext.hasSigmoid
    || toneContext.hasShadow || toneContext.hasHighlight;
  const hasPostToneAdjustments = activeClaheMap !== null || options.vibrance !== 0
    || options.saturation !== 0 || options.applyFinalRolloff;
  const adjusted: [number, number, number] = [0, 0, 0];

  for (let y = startRow; y < endRow; y += 1) {
    let sourceIndex = y * width * 3;
    for (let x = 0; x < width; x += 1, sourceIndex += 3) {
      const encodedR = (sourceStored[sourceIndex] ?? 0) * inverseMax;
      const encodedG = (sourceStored[sourceIndex + 1] ?? 0) * inverseMax;
      const encodedB = (sourceStored[sourceIndex + 2] ?? 0) * inverseMax;
      // Match the former materialized Float32 source/tone buffers exactly: the
      // one-pass path keeps those two Float32 quantization boundaries via fround.
      let r = Math.fround(Math.pow(encodedR, 2));
      let g = Math.fround(Math.pow(encodedG, 2));
      let b = Math.fround(Math.pow(encodedB, 2));

      if (hasToneAdjustments) {
        applyStackToneAdjustmentsLinearRgbRangeInto(
          r,
          g,
          b,
          toneContext,
          "source",
          "highlight",
          adjusted,
        );
        r = Math.fround(adjusted[0]);
        g = Math.fround(adjusted[1]);
        b = Math.fround(adjusted[2]);
      }

      if (activeClaheMap) {
        const clarityGain = sampleStackClaheGain(activeClaheMap, x + 0.5, y + 0.5, width, height);
        applyLuminanceGainPreservingAboveOneLinearRgbInto(r, g, b, clarityGain, adjusted);
        r = adjusted[0]; g = adjusted[1]; b = adjusted[2];
      }

      if (hasPostToneAdjustments) {
        applySaturationVibranceAndFinalRolloffLinearRgbInto(
          r,
          g,
          b,
          options.saturation,
          options.vibrance,
          options.applyFinalRolloff,
          options.finalRolloff?.finalRolloff,
          options.finalRolloff?.saturationRolloff ?? null,
          adjusted,
        );
        r = adjusted[0]; g = adjusted[1]; b = adjusted[2];
      }
      outputLinear[sourceIndex] = r;
      outputLinear[sourceIndex + 1] = g;
      outputLinear[sourceIndex + 2] = b;
    }
  }
}

export function adjustStackLinearData(
  sourceLinear: Float32Array,
  width: number,
  height: number,
  exposureEv: number,
  shadow: number,
  highlight: number,
  scaledLog: number,
  sigmoid: number,
  clahe: number,
  vibrance: number,
  saturation: number,
  claheMap: StackClaheMap | null = null,
  outputColorProfile: ImageEditOutputColorProfile = "srgb",
  finalRolloff: StackFinalRolloff | undefined = undefined,
): Float32Array {
  const toneAdjusted = buildStackToneAdjustedLinearData(
    sourceLinear,
    width,
    height,
    exposureEv,
    shadow,
    highlight,
    scaledLog,
    sigmoid,
  );
  return adjustStackLinearDataPostTone(
    toneAdjusted,
    width,
    height,
    clahe,
    vibrance,
    saturation,
    claheMap,
    outputColorProfile,
    true,
    finalRolloff,
  );
}

export function buildStackToneAdjustedLinearData(
  sourceLinear: Float32Array,
  _width: number,
  _height: number,
  exposureEv: number,
  shadow: number,
  highlight: number,
  scaledLog: number,
  sigmoid: number,
  startStage: StackToneStage = "source",
  endStage: StackToneStage = "highlight",
): Float32Array {
  const toneContext = buildStackToneContext(
    exposureEv,
    shadow,
    highlight,
    scaledLog,
    sigmoid,
  );
  if (startStage === endStage) return sourceLinear;
  const result = new Float32Array(sourceLinear.length);
  const adjusted: [number, number, number] = [0, 0, 0];
  for (let sourceIndex = 0; sourceIndex < sourceLinear.length; sourceIndex += 3) {
    applyStackToneAdjustmentsLinearRgbRangeInto(
      sourceLinear[sourceIndex] ?? 0,
      sourceLinear[sourceIndex + 1] ?? 0,
      sourceLinear[sourceIndex + 2] ?? 0,
      toneContext,
      startStage,
      endStage,
      adjusted,
    );
    result[sourceIndex] = adjusted[0];
    result[sourceIndex + 1] = adjusted[1];
    result[sourceIndex + 2] = adjusted[2];
  }
  return result;
}

export function adjustStackLinearDataPostTone(
  toneAdjustedLinear: Float32Array,
  width: number,
  height: number,
  clahe: number,
  vibrance: number,
  saturation: number,
  claheMap: StackClaheMap | null = null,
  _outputColorProfile: ImageEditOutputColorProfile = "srgb",
  applyFinalRolloff = true,
  finalRolloff: StackFinalRolloff | undefined = undefined,
): Float32Array {
  const normalizedClahe = clampStackClahe(clahe);
  const activeClaheMap = normalizedClahe !== 0 && isUsableStackClaheMap(claheMap) ? claheMap : null;
  const hasClahe = activeClaheMap !== null;
  if (!hasClahe && vibrance === 0 && saturation === 0 && !applyFinalRolloff) return toneAdjustedLinear;

  const result = new Float32Array(toneAdjustedLinear.length);
  const adjusted: [number, number, number] = [0, 0, 0];
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const pixelIndex = y * width + x;
      const sourceIndex = pixelIndex * 3;
      let r = toneAdjustedLinear[sourceIndex] ?? 0;
      let g = toneAdjustedLinear[sourceIndex + 1] ?? 0;
      let b = toneAdjustedLinear[sourceIndex + 2] ?? 0;

      if (hasClahe && activeClaheMap) {
        const clarityGain = sampleStackClaheGain(activeClaheMap, x + 0.5, y + 0.5, width, height);
        applyLuminanceGainPreservingAboveOneLinearRgbInto(r, g, b, clarityGain, adjusted);
        r = adjusted[0]; g = adjusted[1]; b = adjusted[2];
      }

      applySaturationVibranceAndFinalRolloffLinearRgbInto(
        r,
        g,
        b,
        saturation,
        vibrance,
        applyFinalRolloff,
        finalRolloff?.finalRolloff,
        finalRolloff?.saturationRolloff ?? null,
        adjusted,
      );
      r = adjusted[0]; g = adjusted[1]; b = adjusted[2];
      result[sourceIndex] = r;
      result[sourceIndex + 1] = g;
      result[sourceIndex + 2] = b;
    }
  }
  return result;
}

function buildStackToneContext(
  exposureEv: number,
  shadow: number,
  highlight: number,
  scaledLog: number,
  sigmoid: number,
): StackToneContext {
  const factor = Math.pow(2, exposureEv);
  const normalizedShadow = clampToneRangeAdjustment(shadow);
  const normalizedHighlight = clampToneRangeAdjustment(highlight);
  const normalizedLog = clampStackScaledLog(scaledLog);
  const normalizedSigmoid = clampSigmoid(sigmoid);
  const normalizedSaturation = 0;
  const normalizedVibrance = 0;
  return {
    gains: { r: 1, g: 1, b: 1 },
    hasWhiteBalance: false,
    hasExposure: Number.isFinite(factor) && Math.abs(factor - 1) >= 1e-6,
    hasShadow: normalizedShadow !== 0,
    hasHighlight: normalizedHighlight !== 0,
    hasBlack: false,
    hasWhite: false,
    hasToneCurve: false,
    toneCurve: null,
    hasScaledLog: normalizedLog !== 0,
    hasSigmoid: normalizedSigmoid !== 0,
    hasSaturation: false,
    hasVibrance: false,
    hasSaturationOrVibrance: false,
    factor,
    shadow: normalizedShadow,
    highlight: normalizedHighlight,
    black: 0,
    white: 0,
    saturationRolloff: null,
    finalRolloff: null,
    scaledLog: normalizedLog,
    sigmoid: normalizedSigmoid,
    normalizedVibrance,
    normalizedSaturation,
    saturationFactor: 1,
    vibranceFactor: 0,
  };
}

function applyStackToneAdjustmentsLinearRgbRangeInto(
  r: number,
  g: number,
  b: number,
  context: StackToneContext,
  startStage: StackToneStage,
  endStage: StackToneStage,
  output: [number, number, number],
): void {
  applyToneAdjustmentsLinearRgbRangeInto(
    r,
    g,
    b,
    context,
    STACK_TONE_STAGE_BOUNDARY[startStage],
    STACK_TONE_STAGE_BOUNDARY[endStage],
    output,
  );
}
