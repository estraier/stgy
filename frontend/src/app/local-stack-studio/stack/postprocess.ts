import {
  applyHighlightLinear,
  applyRolloffScalar,
  applyScaledLogLinear,
  applyShadowLinear,
  applySigmoidLinear,
  clamp01,
  clampColorAdjustment,
  clampScaledLog,
  clampSigmoid,
  clampToneRangeAdjustment,
  colorSaturationFactor,
  colorVibranceFactor,
  hsvToRgb,
  rgbToHsv,
  rolloffParams,
} from "@/image/tone";

export const STACK_LOGARITHM_LIMIT = 30;

export type StackClaheMap = {
  width: number;
  height: number;
  gain: Float32Array;
};

export type StackToneStage = "source" | "exposure" | "shadow" | "highlight" | "logarithm" | "sigmoid";

type StackToneContext = {
  gain: number;
  normalizedShadow: number;
  normalizedHighlight: number;
  normalizedLog: number;
  normalizedSigmoid: number;
  rolloff: { inflection: number; scale: number } | null;
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

export function computeStackHighlightP100(
  sourceLinear: Float32Array | null | undefined,
  gain: number,
  shadow: number,
): number | null {
  if (!sourceLinear || sourceLinear.length < 3) return null;
  const normalizedShadow = clampToneRangeAdjustment(shadow);
  let p100 = -Infinity;
  for (let i = 0; i + 2 < sourceLinear.length; i += 3) {
    let r = (sourceLinear[i] ?? 0) * gain;
    let g = (sourceLinear[i + 1] ?? 0) * gain;
    let b = (sourceLinear[i + 2] ?? 0) * gain;
    if (normalizedShadow !== 0) {
      r = applyShadowLinear(r, normalizedShadow);
      g = applyShadowLinear(g, normalizedShadow);
      b = applyShadowLinear(b, normalizedShadow);
    }
    p100 = Math.max(p100, r, g, b);
  }
  return Number.isFinite(p100) ? p100 : null;
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
  if (
    !Number.isFinite(pixelCount) ||
    pixelCount <= 0 ||
    toneAdjustedLinear.length !== pixelCount * 3
  ) {
    return null;
  }

  const luminance = new Float32Array(pixelCount);
  const gain = new Float32Array(pixelCount);
  gain.fill(1);

  if (normalizedClahe < 0) {
    for (let pixelIndex = 0, sourceIndex = 0; pixelIndex < pixelCount; pixelIndex += 1, sourceIndex += 3) {
      const r = toneAdjustedLinear[sourceIndex] ?? 0;
      const g = toneAdjustedLinear[sourceIndex + 1] ?? 0;
      const b = toneAdjustedLinear[sourceIndex + 2] ?? 0;
      luminance[pixelIndex] = Math.max(0, 0.299 * Math.max(0, r) + 0.587 * Math.max(0, g) + 0.114 * Math.max(0, b));
    }
    const { tileWidth, tileHeight } = computeClaheTileGrid(width, height);
    const t = Math.abs(normalizedClahe) / 100;
    const radiusX = Math.max(1, Math.round(tileWidth / 2));
    const radiusY = Math.max(1, Math.round(tileHeight / 2));
    const localMean = boxBlurLinearLuminance(luminance, width, height, radiusX, radiusY);
    const detailAttenuation = 1 / (1 + 4 * t);
    for (let pixelIndex = 0; pixelIndex < pixelCount; pixelIndex += 1) {
      const sourceLinearLuma = luminance[pixelIndex] ?? 0;
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
    const r = toneAdjustedLinear[sourceIndex] ?? 0;
    const g = toneAdjustedLinear[sourceIndex + 1] ?? 0;
    const b = toneAdjustedLinear[sourceIndex + 2] ?? 0;
    const linearLuma = Math.max(0, 0.299 * Math.max(0, r) + 0.587 * Math.max(0, g) + 0.114 * Math.max(0, b));
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
      tileY0 = 0;
      tileY1 = 0;
      fy = 0;
    } else if (tileY1 >= tilesY) {
      tileY0 = tilesY - 1;
      tileY1 = tilesY - 1;
      fy = 0;
    }
    for (let x = 0; x < width; x += 1) {
      const gridX = x / tileWidth - 0.5;
      let tileX0 = Math.floor(gridX);
      let fx = gridX - tileX0;
      let tileX1 = tileX0 + 1;
      if (tilesX <= 1 || tileX0 < 0) {
        tileX0 = 0;
        tileX1 = 0;
        fx = 0;
      } else if (tileX1 >= tilesX) {
        tileX0 = tilesX - 1;
        tileX1 = tilesX - 1;
        fx = 0;
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
      gain[pixelIndex] = sourceLinearLuma > 1e-8 ? targetLinearLuma / sourceLinearLuma : 0;
    }
  }

  return { width, height, gain };
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
  return adjustStackLinearDataPostTone(
    toneAdjusted,
    width,
    height,
    clahe,
    vibrance,
    saturation,
    claheMap,
  );
}

export function buildStackToneAdjustedLinearData(
  sourceLinear: Float32Array,
  width: number,
  height: number,
  exposureEv: number,
  shadow: number,
  highlight: number,
  scaledLog: number,
  sigmoid: number,
  exposureRolloffBaseP998: number | null = null,
  highlightP100: number | null = null,
  startStage: StackToneStage = "source",
  endStage: StackToneStage = "sigmoid",
): Float32Array {
  const toneContext = buildStackToneContext(
    exposureEv,
    shadow,
    highlight,
    scaledLog,
    sigmoid,
    exposureRolloffBaseP998,
    highlightP100,
  );
  if (startStage === endStage) {
    return sourceLinear;
  }
  const result = new Float32Array(sourceLinear.length);
  for (let sourceIndex = 0; sourceIndex < sourceLinear.length; sourceIndex += 3) {
    let r = sourceLinear[sourceIndex] ?? 0;
    let g = sourceLinear[sourceIndex + 1] ?? 0;
    let b = sourceLinear[sourceIndex + 2] ?? 0;
    [r, g, b] = applyStackToneAdjustmentsLinearRgbRange(r, g, b, toneContext, startStage, endStage);
    result[sourceIndex] = r;
    result[sourceIndex + 1] = g;
    result[sourceIndex + 2] = b;
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
): Float32Array {
  const normalizedClahe = clampStackClahe(clahe);
  const normalizedVibrance = clampColorAdjustment(vibrance);
  const normalizedSaturation = clampColorAdjustment(saturation);
  const activeClaheMap = normalizedClahe !== 0 && isUsableStackClaheMap(claheMap) ? claheMap : null;
  const hasClahe = activeClaheMap !== null;
  const hasVibrance = normalizedVibrance !== 0;
  const hasSaturation = normalizedSaturation !== 0;
  const saturationFactor = colorSaturationFactor(normalizedSaturation);
  const vibranceFactor = colorVibranceFactor(normalizedVibrance);
  const saturationRolloff = hasSaturation && saturationFactor > 1
    ? computeStackSaturationRolloffFromToneAdjusted(
        toneAdjustedLinear,
        width,
        height,
        activeClaheMap,
        saturationFactor,
      )
    : null;

  if (!hasClahe && !hasVibrance && !hasSaturation) {
    return toneAdjustedLinear;
  }

  const result = new Float32Array(toneAdjustedLinear.length);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const pixelIndex = y * width + x;
      const sourceIndex = pixelIndex * 3;
      let r = toneAdjustedLinear[sourceIndex] ?? 0;
      let g = toneAdjustedLinear[sourceIndex + 1] ?? 0;
      let b = toneAdjustedLinear[sourceIndex + 2] ?? 0;

      if (hasClahe && activeClaheMap) {
        const clarityGain = sampleStackClaheGain(activeClaheMap, x + 0.5, y + 0.5, width, height);
        r = Math.max(0, r * clarityGain);
        g = Math.max(0, g * clarityGain);
        b = Math.max(0, b * clarityGain);
      }

      if (hasSaturation || hasVibrance) {
        const [h, initialS, v] = rgbToHsv(r, g, b);
        let adjustedS = initialS;
        if (hasSaturation) {
          adjustedS = clamp01(applyRolloffScalar(adjustedS * saturationFactor, saturationRolloff));
        }
        if (hasVibrance) {
          adjustedS = applyScaledLogLinear(adjustedS, vibranceFactor);
        }
        [r, g, b] = hsvToRgb(h, adjustedS, v);
      }

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
  const maxVal = Number.isFinite(exposureRolloffBaseP998)
    ? Number(exposureRolloffBaseP998) * gain
    : null;
  const rolloff = maxVal === null ? null : rolloffParams(maxVal);
  const hasExposure = Number.isFinite(gain) && Math.abs(gain - 1) >= 1e-6;
  const hasShadow = normalizedShadow !== 0;
  const highlightRange = normalizedHighlight !== 0 && Number.isFinite(highlightP100) && Number(highlightP100) > 0
    ? { p100: Number(highlightP100) }
    : null;
  const hasHighlight = highlightRange !== null;
  const hasLogarithm = normalizedLog !== 0;
  const hasSigmoid = normalizedSigmoid !== 0;
  return {
    gain,
    normalizedShadow,
    normalizedHighlight,
    normalizedLog,
    normalizedSigmoid,
    rolloff,
    highlightRange,
    hasExposure,
    hasShadow,
    hasHighlight,
    hasLogarithm,
    hasSigmoid,
  };
}

function applyStackToneAdjustmentsLinearRgb(
  r: number,
  g: number,
  b: number,
  context: StackToneContext,
): [number, number, number] {
  return applyStackToneAdjustmentsLinearRgbRange(r, g, b, context, "source", "sigmoid");
}

function applyStackToneAdjustmentsLinearRgbRange(
  r: number,
  g: number,
  b: number,
  context: StackToneContext,
  startStage: StackToneStage,
  endStage: StackToneStage,
): [number, number, number] {
  const stageOrder: StackToneStage[] = ["source", "exposure", "shadow", "highlight", "logarithm", "sigmoid"];
  const startIndex = Math.max(0, stageOrder.indexOf(startStage));
  const endIndex = Math.max(0, stageOrder.indexOf(endStage));
  for (let index = startIndex + 1; index <= endIndex; index += 1) {
    const stage = stageOrder[index];
    if (stage === "exposure" && context.hasExposure) {
      r *= context.gain;
      g *= context.gain;
      b *= context.gain;
    } else if (stage === "shadow" && context.hasShadow) {
      r = applyShadowLinear(r, context.normalizedShadow);
      g = applyShadowLinear(g, context.normalizedShadow);
      b = applyShadowLinear(b, context.normalizedShadow);
    } else if (stage === "highlight") {
      if (context.hasHighlight && context.highlightRange) {
        const maxChannel = Math.max(r, g, b);
        if (maxChannel > 0) {
          const adjustedMax = applyHighlightLinear(maxChannel, context.normalizedHighlight, context.highlightRange);
          const scale = adjustedMax / maxChannel;
          r *= scale;
          g *= scale;
          b *= scale;
        }
      }
      r = applyDisplayRolloffLinear(r, context.rolloff);
      g = applyDisplayRolloffLinear(g, context.rolloff);
      b = applyDisplayRolloffLinear(b, context.rolloff);
    } else if (stage === "logarithm" && context.hasLogarithm) {
      r = applyScaledLogLinear(r, context.normalizedLog, STACK_LOGARITHM_LIMIT);
      g = applyScaledLogLinear(g, context.normalizedLog, STACK_LOGARITHM_LIMIT);
      b = applyScaledLogLinear(b, context.normalizedLog, STACK_LOGARITHM_LIMIT);
    } else if (stage === "sigmoid" && context.hasSigmoid) {
      r = applySigmoidLinear(r, context.normalizedSigmoid);
      g = applySigmoidLinear(g, context.normalizedSigmoid);
      b = applySigmoidLinear(b, context.normalizedSigmoid);
    }
  }
  return [r, g, b];
}

function computeStackSaturationRolloffFromToneAdjusted(
  toneAdjustedLinear: Float32Array,
  width: number,
  height: number,
  claheMap: StackClaheMap | null,
  saturationFactor: number,
): { inflection: number; scale: number } | null {
  if (saturationFactor <= 1) return null;
  const targetPixels = 256 * 256;
  const scale = Math.min(1, Math.sqrt(targetPixels / Math.max(1, width * height)));
  const sampleWidth = Math.max(1, Math.round(width * scale));
  const sampleHeight = Math.max(1, Math.round(height * scale));
  const values = new Float32Array(sampleWidth * sampleHeight);
  let count = 0;
  for (let y = 0; y < sampleHeight; y += 1) {
    const sourceY = Math.min(height - 1, Math.floor((y + 0.5) * height / sampleHeight));
    for (let x = 0; x < sampleWidth; x += 1) {
      const sourceX = Math.min(width - 1, Math.floor((x + 0.5) * width / sampleWidth));
      const sourceIndex = (sourceY * width + sourceX) * 3;
      let r = toneAdjustedLinear[sourceIndex] ?? 0;
      let g = toneAdjustedLinear[sourceIndex + 1] ?? 0;
      let b = toneAdjustedLinear[sourceIndex + 2] ?? 0;
      if (claheMap) {
        const clarityGain = sampleStackClaheGain(claheMap, sourceX + 0.5, sourceY + 0.5, width, height);
        r = Math.max(0, r * clarityGain);
        g = Math.max(0, g * clarityGain);
        b = Math.max(0, b * clarityGain);
      }
      const [, s] = rgbToHsv(r, g, b);
      values[count++] = s * saturationFactor;
    }
  }
  if (count <= 0) return null;
  const sorted = Array.from(values.subarray(0, count));
  sorted.sort((a, b) => a - b);
  const rank = 0.99 * (sorted.length - 1);
  const lower = Math.floor(rank);
  const upper = Math.ceil(rank);
  const weight = rank - lower;
  const p99 = (sorted[lower] ?? 0) * (1 - weight) + (sorted[upper] ?? 0) * weight;
  return rolloffParams(p99, 0.7, 4);
}

function applyDisplayRolloffLinear(
  value: number,
  rolloff: { inflection: number; scale: number } | null,
): number {
  if (!Number.isFinite(value) || value <= 0) return 0;
  const adjusted = applyRolloffScalar(value, rolloff);
  return Number.isFinite(adjusted) && adjusted > 0 ? adjusted : 0;
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
