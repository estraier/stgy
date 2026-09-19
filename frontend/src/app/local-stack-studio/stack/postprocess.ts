import type { ImageEditOutputColorProfile } from "@/image/types";
import {
  EXPOSURE_ROLLOFF_A,
  FINAL_DISPLAY_ROLLOFF_A,
  ROLLOFF_SAVING_LIMIT_FACTOR,
  SATURATION_ROLLOFF_A,
  applyHighlightLinear,
  applyHighlightRolloffLinearRgbInto,
  applyLuminanceGainPreservingAboveOneLinearRgbInto,
  applySaturationVibranceAndFinalRolloffLinearRgbInto,
  applyScaledLogLinearExtended,
  applyShadowLinear,
  applySigmoidLinearExtended,
  clamp01,
  clampScaledLog,
  clampSigmoid,
  clampToneRangeAdjustment,
  colorSaturationFactor,
  proPhotoLinearLuminance,
  rgbSaturationExtended,
  rolloffParams,
  type RolloffParams,
} from "@/image/tone";

export const STACK_LOGARITHM_LIMIT = 30;
const STACK_FINAL_ROLLOFF_PERCENTILE = 0.998;
const STACK_FINAL_ROLLOFF_A = FINAL_DISPLAY_ROLLOFF_A;
const STACK_FINAL_ROLLOFF_SAVING_LIMIT = ROLLOFF_SAVING_LIMIT_FACTOR;

export type StackClaheMap = {
  width: number;
  height: number;
  gain: Float32Array;
};

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

const STACK_TONE_STAGE_INDEX: Record<StackToneStage, number> = {
  source: 0,
  exposure: 1,
  logarithm: 2,
  sigmoid: 3,
  shadow: 4,
  highlight: 5,
};

type StackToneContext = {
  gain: number;
  exposureRolloff: RolloffParams | null;
  normalizedShadow: number;
  normalizedHighlight: number;
  normalizedLog: number;
  normalizedSigmoid: number;
  highlightRange: { p100: number } | null;
  hasExposure: boolean;
  hasShadow: boolean;
  hasHighlight: boolean;
  hasLogarithm: boolean;
  hasSigmoid: boolean;
};

export function clampStackScaledLog(value: number): number {
  return clampScaledLog(value, STACK_LOGARITHM_LIMIT);
}

export function clampStackClahe(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(-100, Math.min(100, Math.round(value)));
}

function resolveStackExposureRolloffBaseP998(
  sourceLinear: Float32Array,
  supplied: number | null | undefined,
): number | null {
  if (Number.isFinite(supplied)) return Number(supplied);
  const pixelCount = Math.floor(sourceLinear.length / 3);
  if (pixelCount <= 0) return null;
  const maxima = new Float32Array(pixelCount);
  let count = 0;
  for (let i = 0; i + 2 < sourceLinear.length; i += 3) {
    const maxChannel = Math.max(sourceLinear[i] ?? 0, sourceLinear[i + 1] ?? 0, sourceLinear[i + 2] ?? 0);
    if (Number.isFinite(maxChannel)) maxima[count++] = maxChannel;
  }
  if (count <= 0) return null;
  const sorted = count === maxima.length ? maxima : maxima.slice(0, count);
  sorted.sort();
  return percentileFromSortedFloat32(sorted, STACK_FINAL_ROLLOFF_PERCENTILE);
}

export function computeStackHighlightP100(
  sourceLinear: Float32Array | null | undefined,
  gain: number,
  shadow: number,
  scaledLog = 0,
  sigmoid = 0,
  exposureRolloffBaseP998: number | null = null,
): number | null {
  if (!sourceLinear || sourceLinear.length < 3) return null;
  const normalizedShadow = clampToneRangeAdjustment(shadow);
  const normalizedLog = clampStackScaledLog(scaledLog);
  const normalizedSigmoid = clampSigmoid(sigmoid);
  const resolvedExposureBaseP998 = resolveStackExposureRolloffBaseP998(
    sourceLinear,
    exposureRolloffBaseP998,
  );
  const exposureRolloff = gain > 1 && Number.isFinite(resolvedExposureBaseP998)
    ? rolloffParams(
        Number(resolvedExposureBaseP998) * gain,
        EXPOSURE_ROLLOFF_A,
        ROLLOFF_SAVING_LIMIT_FACTOR,
        1,
      )
    : null;
  let p100 = -Infinity;
  const adjusted: [number, number, number] = [0, 0, 0];
  for (let i = 0; i + 2 < sourceLinear.length; i += 3) {
    applyHighlightRolloffLinearRgbInto(
      (sourceLinear[i] ?? 0) * gain,
      (sourceLinear[i + 1] ?? 0) * gain,
      (sourceLinear[i + 2] ?? 0) * gain,
      exposureRolloff,
      adjusted,
    );
    let luminance = proPhotoLinearLuminance(adjusted[0], adjusted[1], adjusted[2]);
    if (normalizedLog !== 0) {
      luminance = applyScaledLogLinearExtended(luminance, normalizedLog, STACK_LOGARITHM_LIMIT);
    }
    if (normalizedSigmoid !== 0) {
      luminance = applySigmoidLinearExtended(luminance, normalizedSigmoid);
    }
    if (normalizedShadow !== 0) {
      luminance = applyShadowLinear(luminance, normalizedShadow);
    }
    p100 = Math.max(p100, luminance);
  }
  return Number.isFinite(p100) ? p100 : null;
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
  highlightP100: number | null = null,
  exposureRolloffBaseP998: number | null = null,
): StackFinalRolloff {
  if (!sourceLinear || sourceLinear.length < 3) {
    return { saturationRolloff: null, finalRolloff: null };
  }
  const resolvedExposureBaseP998 = resolveStackExposureRolloffBaseP998(
    sourceLinear,
    exposureRolloffBaseP998,
  );
  const toneContext = buildStackToneContext(
    exposureEv,
    shadow,
    highlight,
    scaledLog,
    sigmoid,
    resolvedExposureBaseP998,
    highlightP100,
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
    finalRolloff: rolloffParams(
      p998,
      STACK_FINAL_ROLLOFF_A,
      STACK_FINAL_ROLLOFF_SAVING_LIMIT,
      1,
    ),
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
  return !!map && map.width > 0 && map.height > 0 && map.gain.length === map.width * map.height;
}

export function sampleStackClaheGain(
  map: StackClaheMap,
  renderedSourceX: number,
  renderedSourceY: number,
  sourceWidth: number,
  sourceHeight: number,
): number {
  const mapX = renderedSourceX * map.width / Math.max(1, sourceWidth) - 0.5;
  const mapY = renderedSourceY * map.height / Math.max(1, sourceHeight) - 0.5;
  const x0 = Math.max(0, Math.min(map.width - 1, Math.floor(mapX)));
  const y0 = Math.max(0, Math.min(map.height - 1, Math.floor(mapY)));
  const x1 = Math.min(map.width - 1, x0 + 1);
  const y1 = Math.min(map.height - 1, y0 + 1);
  const fx = Math.max(0, Math.min(1, mapX - x0));
  const fy = Math.max(0, Math.min(1, mapY - y0));
  const top = (map.gain[y0 * map.width + x0] ?? 1) * (1 - fx)
    + (map.gain[y0 * map.width + x1] ?? 1) * fx;
  const bottom = (map.gain[y1 * map.width + x0] ?? 1) * (1 - fx)
    + (map.gain[y1 * map.width + x1] ?? 1) * fx;
  return top * (1 - fy) + bottom * fy;
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
  exposureRolloffBaseP998: number | null = null,
  highlightP100: number | null = null,
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
    exposureRolloffBaseP998,
    highlightP100,
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
  const pixelCount = width * height;
  if (!Number.isFinite(pixelCount) || pixelCount <= 0 || toneAdjustedLinear.length !== pixelCount * 3) {
    return null;
  }

  const luminance = new Float32Array(pixelCount);
  const gain = new Float32Array(pixelCount);
  gain.fill(1);

  if (normalizedClahe < 0) {
    for (let pixelIndex = 0, sourceIndex = 0; pixelIndex < pixelCount; pixelIndex += 1, sourceIndex += 3) {
      luminance[pixelIndex] = Math.max(0, proPhotoLinearLuminance(
        toneAdjustedLinear[sourceIndex] ?? 0,
        toneAdjustedLinear[sourceIndex + 1] ?? 0,
        toneAdjustedLinear[sourceIndex + 2] ?? 0,
      ));
    }
    const { tileWidth, tileHeight } = computeClaheTileGrid(width, height);
    const t = Math.abs(normalizedClahe) / 100;
    const radiusX = Math.max(1, Math.round(tileWidth / 2));
    const radiusY = Math.max(1, Math.round(tileHeight / 2));
    const localMean = boxBlurLinearLuminance(luminance, width, height, radiusX, radiusY);
    const detailAttenuation = 1 / (1 + 4 * t);
    for (let pixelIndex = 0; pixelIndex < pixelCount; pixelIndex += 1) {
      const sourceLinearLuma = luminance[pixelIndex] ?? 0;
      if (sourceLinearLuma > 1) {
        gain[pixelIndex] = 1;
        continue;
      }
      const meanLinearLuma = localMean[pixelIndex] ?? sourceLinearLuma;
      const targetLinearLuma = Math.max(
        0,
        meanLinearLuma + (sourceLinearLuma - meanLinearLuma) * detailAttenuation,
      );
      gain[pixelIndex] = sourceLinearLuma > 1e-8 ? targetLinearLuma / sourceLinearLuma : 0;
    }
    return { width, height, gain };
  }

  const encodedLuminance = new Uint8Array(pixelCount);
  for (let pixelIndex = 0, sourceIndex = 0; pixelIndex < pixelCount; pixelIndex += 1, sourceIndex += 3) {
    const linearLuma = Math.max(0, proPhotoLinearLuminance(
      toneAdjustedLinear[sourceIndex] ?? 0,
      toneAdjustedLinear[sourceIndex + 1] ?? 0,
      toneAdjustedLinear[sourceIndex + 2] ?? 0,
    ));
    luminance[pixelIndex] = linearLuma;
    encodedLuminance[pixelIndex] = Math.max(
      0,
      Math.min(255, Math.round(Math.sqrt(clamp01(linearLuma)) * 255)),
    );
  }

  const { tilesX, tilesY, tileWidth, tileHeight } = computeClaheTileGrid(width, height);
  const bins = 256;
  const tileCount = tilesX * tilesY;
  const luts = new Float32Array(tileCount * bins);
  const clipMultiple = claheClipLimitFromStrength(normalizedClahe);

  for (let tileY = 0; tileY < tilesY; tileY += 1) {
    const y0 = tileY * tileHeight;
    const y1 = Math.min(height, y0 + tileHeight);
    for (let tileX = 0; tileX < tilesX; tileX += 1) {
      const x0 = tileX * tileWidth;
      const x1 = Math.min(width, x0 + tileWidth);
      const hist = new Uint32Array(bins);
      for (let y = y0; y < y1; y += 1) {
        let pixelIndex = y * width + x0;
        for (let x = x0; x < x1; x += 1, pixelIndex += 1) {
          hist[encodedLuminance[pixelIndex] ?? 0] += 1;
        }
      }
      const area = Math.max(1, (x1 - x0) * (y1 - y0));
      const averagePerBin = area / bins;
      const clipLimit = Math.max(1, Math.floor(averagePerBin * clipMultiple));
      let excess = 0;
      for (let bin = 0; bin < bins; bin += 1) {
        const value = hist[bin] ?? 0;
        if (value > clipLimit) {
          excess += value - clipLimit;
          hist[bin] = clipLimit;
        }
      }
      if (excess > 0) {
        const redistribute = Math.floor(excess / bins);
        const remainder = excess - redistribute * bins;
        for (let bin = 0; bin < bins; bin += 1) hist[bin] = (hist[bin] ?? 0) + redistribute;
        if (remainder > 0) {
          const step = bins / remainder;
          for (let i = 0; i < remainder; i += 1) {
            const bin = Math.min(bins - 1, Math.floor(i * step));
            hist[bin] = (hist[bin] ?? 0) + 1;
          }
        }
      }
      let cdf = 0;
      let cdfMin = -1;
      const lutOffset = (tileY * tilesX + tileX) * bins;
      for (let bin = 0; bin < bins; bin += 1) {
        cdf += hist[bin] ?? 0;
        if (cdfMin < 0 && cdf > 0) cdfMin = cdf;
        const denominator = Math.max(1, area - Math.max(0, cdfMin));
        luts[lutOffset + bin] = cdfMin < 0 ? 0 : clamp01((cdf - cdfMin) / denominator);
      }
    }
  }

  for (let y = 0; y < height; y += 1) {
    const gridY = y / tileHeight - 0.5;
    let tileY0 = Math.floor(gridY);
    let fy = gridY - tileY0;
    let tileY1 = tileY0 + 1;
    if (tilesY <= 1 || tileY0 < 0) {
      tileY0 = 0; tileY1 = 0; fy = 0;
    } else if (tileY1 >= tilesY) {
      tileY0 = tilesY - 1; tileY1 = tilesY - 1; fy = 0;
    }
    for (let x = 0; x < width; x += 1) {
      const gridX = x / tileWidth - 0.5;
      let tileX0 = Math.floor(gridX);
      let fx = gridX - tileX0;
      let tileX1 = tileX0 + 1;
      if (tilesX <= 1 || tileX0 < 0) {
        tileX0 = 0; tileX1 = 0; fx = 0;
      } else if (tileX1 >= tilesX) {
        tileX0 = tilesX - 1; tileX1 = tilesX - 1; fx = 0;
      }

      const pixelIndex = y * width + x;
      const bin = encodedLuminance[pixelIndex] ?? 0;
      const lut00 = luts[(tileY0 * tilesX + tileX0) * bins + bin] ?? 0;
      const lut10 = luts[(tileY0 * tilesX + tileX1) * bins + bin] ?? 0;
      const lut01 = luts[(tileY1 * tilesX + tileX0) * bins + bin] ?? 0;
      const lut11 = luts[(tileY1 * tilesX + tileX1) * bins + bin] ?? 0;
      const top = lut00 * (1 - fx) + lut10 * fx;
      const bottom = lut01 * (1 - fx) + lut11 * fx;
      const encodedEqualized = top * (1 - fy) + bottom * fy;
      const targetLinearLuma = encodedEqualized * encodedEqualized;
      const sourceLinearLuma = luminance[pixelIndex] ?? 0;
      gain[pixelIndex] = sourceLinearLuma > 1
        ? 1
        : sourceLinearLuma > 1e-8
          ? targetLinearLuma / sourceLinearLuma
          : 0;
    }
  }

  return { width, height, gain };
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
  exposureRolloffBaseP998: number | null;
  highlightP100: number | null;
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
    options.exposureRolloffBaseP998,
    options.highlightP100,
  );
  const normalizedClahe = clampStackClahe(options.clahe);
  const activeClaheMap = normalizedClahe !== 0 && isUsableStackClaheMap(options.claheMap)
    ? options.claheMap
    : null;
  const inverseMax = 1 / 65535;
  const hasToneAdjustments = toneContext.hasExposure || toneContext.hasLogarithm || toneContext.hasSigmoid
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
  exposureRolloffBaseP998: number | null = null,
  highlightP100: number | null = null,
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
    exposureRolloffBaseP998,
    highlightP100,
  );
  const hasAnyAdjustment = exposureEv !== 0 || shadow !== 0 || highlight !== 0
    || scaledLog !== 0 || sigmoid !== 0 || clahe !== 0 || vibrance !== 0 || saturation !== 0;
  return adjustStackLinearDataPostTone(
    toneAdjusted,
    width,
    height,
    clahe,
    vibrance,
    saturation,
    claheMap,
    outputColorProfile,
    hasAnyAdjustment,
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
  exposureRolloffBaseP998: number | null = null,
  highlightP100: number | null = null,
  startStage: StackToneStage = "source",
  endStage: StackToneStage = "highlight",
): Float32Array {
  const resolvedExposureBaseP998 = resolveStackExposureRolloffBaseP998(
    sourceLinear,
    exposureRolloffBaseP998,
  );
  const toneContext = buildStackToneContext(
    exposureEv,
    shadow,
    highlight,
    scaledLog,
    sigmoid,
    resolvedExposureBaseP998,
    highlightP100,
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
  exposureRolloffBaseP998: number | null,
  highlightP100: number | null,
): StackToneContext {
  const gain = Math.pow(2, exposureEv);
  const normalizedShadow = clampToneRangeAdjustment(shadow);
  const normalizedHighlight = clampToneRangeAdjustment(highlight);
  const normalizedLog = clampStackScaledLog(scaledLog);
  const normalizedSigmoid = clampSigmoid(sigmoid);
  const hasExposure = Number.isFinite(gain) && Math.abs(gain - 1) >= 1e-6;
  const exposureRolloff = gain > 1 && Number.isFinite(exposureRolloffBaseP998)
    ? rolloffParams(
        Number(exposureRolloffBaseP998) * gain,
        EXPOSURE_ROLLOFF_A,
        ROLLOFF_SAVING_LIMIT_FACTOR,
        1,
      )
    : null;
  const hasShadow = normalizedShadow !== 0;
  const highlightRange = normalizedHighlight !== 0 && Number.isFinite(highlightP100) && Number(highlightP100) > 0
    ? { p100: Number(highlightP100) }
    : null;
  return {
    gain,
    exposureRolloff,
    normalizedShadow,
    normalizedHighlight,
    normalizedLog,
    normalizedSigmoid,
    highlightRange,
    hasExposure,
    hasShadow,
    hasHighlight: highlightRange !== null,
    hasLogarithm: normalizedLog !== 0,
    hasSigmoid: normalizedSigmoid !== 0,
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
  const startIndex = STACK_TONE_STAGE_INDEX[startStage];
  const endIndex = STACK_TONE_STAGE_INDEX[endStage];
  for (let index = startIndex + 1; index <= endIndex; index += 1) {
    const stage = index === 1 ? "exposure"
      : index === 2 ? "logarithm"
        : index === 3 ? "sigmoid"
          : index === 4 ? "shadow"
            : "highlight";
    if (stage === "exposure" && context.hasExposure) {
      applyHighlightRolloffLinearRgbInto(
        r * context.gain,
        g * context.gain,
        b * context.gain,
        context.exposureRolloff,
        output,
      );
      r = output[0]; g = output[1]; b = output[2];
      continue;
    }
    const sourceLuminance = proPhotoLinearLuminance(r, g, b);
    if (!(sourceLuminance > 1e-12)) continue;
    let targetLuminance = sourceLuminance;
    if (stage === "logarithm" && context.hasLogarithm) {
      targetLuminance = applyScaledLogLinearExtended(
        sourceLuminance, context.normalizedLog, STACK_LOGARITHM_LIMIT,
      );
    } else if (stage === "sigmoid" && context.hasSigmoid) {
      targetLuminance = applySigmoidLinearExtended(sourceLuminance, context.normalizedSigmoid);
    } else if (stage === "shadow" && context.hasShadow) {
      targetLuminance = applyShadowLinear(sourceLuminance, context.normalizedShadow);
    } else if (stage === "highlight" && context.hasHighlight && context.highlightRange) {
      targetLuminance = applyHighlightLinear(
        sourceLuminance, context.normalizedHighlight, context.highlightRange,
      );
    } else {
      continue;
    }
    if (!Number.isFinite(targetLuminance)) continue;
    const scale = targetLuminance / sourceLuminance;
    r *= scale; g *= scale; b *= scale;
  }
  output[0] = r; output[1] = g; output[2] = b;
}

function claheClipLimitFromStrength(strength: number): number {
  const normalized = Math.abs(clampStackClahe(strength));
  if (normalized <= 0) return 0;
  const t = normalized / 100;
  return 8 * t * t;
}

function computeClaheTileGrid(width: number, height: number) {
  const normalizedWidth = Math.max(1, Math.round(width));
  const normalizedHeight = Math.max(1, Math.round(height));
  const targetTileCount = 80;
  const minTileSize = 64;
  const maxTilesX = Math.max(1, Math.ceil(normalizedWidth / minTileSize));
  const maxTilesY = Math.max(1, Math.ceil(normalizedHeight / minTileSize));

  let bestTilesX = 1;
  let bestTilesY = 1;
  let bestScore = Number.POSITIVE_INFINITY;
  let bestCountError = Number.POSITIVE_INFINITY;
  let bestShapeError = Number.POSITIVE_INFINITY;

  for (let candidateTilesX = 1; candidateTilesX <= maxTilesX; candidateTilesX += 1) {
    for (let candidateTilesY = 1; candidateTilesY <= maxTilesY; candidateTilesY += 1) {
      const tileCount = candidateTilesX * candidateTilesY;
      const tileWidth = normalizedWidth / candidateTilesX;
      const tileHeight = normalizedHeight / candidateTilesY;
      const tileAspectRatio = tileHeight > 0 ? tileWidth / tileHeight : 1;
      const countError = Math.abs(tileCount - targetTileCount) / targetTileCount;
      const shapeError = Math.abs(Math.log(tileAspectRatio));
      const score = countError + shapeError * 2;

      if (
        score < bestScore - 1e-9 ||
        (Math.abs(score - bestScore) <= 1e-9 && countError < bestCountError - 1e-9) ||
        (
          Math.abs(score - bestScore) <= 1e-9 &&
          Math.abs(countError - bestCountError) <= 1e-9 &&
          shapeError < bestShapeError - 1e-9
        )
      ) {
        bestTilesX = candidateTilesX;
        bestTilesY = candidateTilesY;
        bestScore = score;
        bestCountError = countError;
        bestShapeError = shapeError;
      }
    }
  }

  return {
    tilesX: bestTilesX,
    tilesY: bestTilesY,
    tileWidth: Math.max(1, Math.ceil(normalizedWidth / bestTilesX)),
    tileHeight: Math.max(1, Math.ceil(normalizedHeight / bestTilesY)),
  };
}

function boxBlurLinearLuminance(
  source: Float32Array,
  width: number,
  height: number,
  radiusX: number,
  radiusY: number,
): Float32Array {
  const pixelCount = width * height;
  if (pixelCount <= 0 || source.length !== pixelCount) return source;
  const rx = Math.max(0, Math.floor(radiusX));
  const ry = Math.max(0, Math.floor(radiusY));
  if (rx === 0 && ry === 0) return new Float32Array(source);

  const horizontal = new Float32Array(pixelCount);
  if (rx === 0) {
    horizontal.set(source);
  } else {
    for (let y = 0; y < height; y += 1) {
      const rowOffset = y * width;
      let left = 0;
      let right = Math.min(width - 1, rx);
      let sum = 0;
      for (let x = left; x <= right; x += 1) sum += source[rowOffset + x] ?? 0;
      for (let x = 0; x < width; x += 1) {
        horizontal[rowOffset + x] = sum / Math.max(1, right - left + 1);
        const nextLeft = Math.max(0, x + 1 - rx);
        const nextRight = Math.min(width - 1, x + 1 + rx);
        while (left < nextLeft) {
          sum -= source[rowOffset + left] ?? 0;
          left += 1;
        }
        while (right < nextRight) {
          right += 1;
          sum += source[rowOffset + right] ?? 0;
        }
      }
    }
  }

  if (ry === 0) return horizontal;
  const blurred = new Float32Array(pixelCount);
  for (let x = 0; x < width; x += 1) {
    let top = 0;
    let bottom = Math.min(height - 1, ry);
    let sum = 0;
    for (let y = top; y <= bottom; y += 1) sum += horizontal[y * width + x] ?? 0;
    for (let y = 0; y < height; y += 1) {
      blurred[y * width + x] = sum / Math.max(1, bottom - top + 1);
      const nextTop = Math.max(0, y + 1 - ry);
      const nextBottom = Math.min(height - 1, y + 1 + ry);
      while (top < nextTop) {
        sum -= horizontal[top * width + x] ?? 0;
        top += 1;
      }
      while (bottom < nextBottom) {
        bottom += 1;
        sum += horizontal[bottom * width + x] ?? 0;
      }
    }
  }
  return blurred;
}
