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

export function clampStackScaledLog(value: number): number {
  return clampScaledLog(value, STACK_LOGARITHM_LIMIT);
}

export function clampStackClahe(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, Math.round(value)));
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
): Float32Array {
  const gain = Math.pow(2, exposureEv);
  const normalizedShadow = clampToneRangeAdjustment(shadow);
  const normalizedHighlight = clampToneRangeAdjustment(highlight);
  const normalizedLog = clampStackScaledLog(scaledLog);
  const normalizedSigmoid = clampSigmoid(sigmoid);
  const normalizedClahe = clampStackClahe(clahe);
  const normalizedVibrance = clampColorAdjustment(vibrance);
  const normalizedSaturation = clampColorAdjustment(saturation);
  const maxVal = Number.isFinite(exposureRolloffBaseP998)
    ? Number(exposureRolloffBaseP998) * gain
    : null;
  const rolloff = maxVal === null ? null : rolloffParams(maxVal);
  const hasExposure = Number.isFinite(gain) && Math.abs(gain - 1) >= 1e-6;
  const hasShadow = normalizedShadow !== 0;
  const hasHighlight =
    normalizedHighlight !== 0 && Number.isFinite(highlightP100) && Number(highlightP100) > 0;
  const hasLogarithm = normalizedLog !== 0;
  const hasSigmoid = normalizedSigmoid !== 0;
  const hasClahe = normalizedClahe !== 0;
  const hasVibrance = normalizedVibrance !== 0;
  const hasSaturation = normalizedSaturation !== 0;
  if (
    !hasExposure &&
    !hasShadow &&
    !hasHighlight &&
    !hasLogarithm &&
    !hasSigmoid &&
    !hasClahe &&
    !hasVibrance &&
    !hasSaturation &&
    !rolloff
  ) {
    return sourceLinear;
  }

  const copy = new Float32Array(sourceLinear.length);
  const highlightRange = hasHighlight ? { p100: Number(highlightP100) } : null;
  for (let i = 0; i + 2 < sourceLinear.length; i += 3) {
    let r = (sourceLinear[i] ?? 0) * gain;
    let g = (sourceLinear[i + 1] ?? 0) * gain;
    let b = (sourceLinear[i + 2] ?? 0) * gain;

    if (hasShadow) {
      r = applyShadowLinear(r, normalizedShadow);
      g = applyShadowLinear(g, normalizedShadow);
      b = applyShadowLinear(b, normalizedShadow);
    }
    if (highlightRange) {
      const maxChannel = Math.max(r, g, b);
      if (maxChannel > 0) {
        const adjustedMax = applyHighlightLinear(maxChannel, normalizedHighlight, highlightRange);
        const scale = adjustedMax / maxChannel;
        r *= scale;
        g *= scale;
        b *= scale;
      }
    }

    r = applyDisplayRolloffLinear(r, rolloff);
    g = applyDisplayRolloffLinear(g, rolloff);
    b = applyDisplayRolloffLinear(b, rolloff);
    if (hasLogarithm) {
      r = applyScaledLogLinear(r, normalizedLog, STACK_LOGARITHM_LIMIT);
      g = applyScaledLogLinear(g, normalizedLog, STACK_LOGARITHM_LIMIT);
      b = applyScaledLogLinear(b, normalizedLog, STACK_LOGARITHM_LIMIT);
    }
    if (hasSigmoid) {
      r = applySigmoidLinear(r, normalizedSigmoid);
      g = applySigmoidLinear(g, normalizedSigmoid);
      b = applySigmoidLinear(b, normalizedSigmoid);
    }
    copy[i] = r;
    copy[i + 1] = g;
    copy[i + 2] = b;
  }
  const toneAdjusted = hasClahe
    ? applyClaheToLinearLuminance(copy, width, height, normalizedClahe)
    : copy;
  if (!hasVibrance && !hasSaturation) return toneAdjusted;
  return applyStackColorAdjustmentsLinearRgb(
    toneAdjusted,
    normalizedVibrance,
    normalizedSaturation,
  );
}

function applyStackColorAdjustmentsLinearRgb(
  sourceLinear: Float32Array,
  vibrance: number,
  saturation: number,
): Float32Array {
  const normalizedVibrance = clampColorAdjustment(vibrance);
  const normalizedSaturation = clampColorAdjustment(saturation);
  const hasVibrance = normalizedVibrance !== 0;
  const hasSaturation = normalizedSaturation !== 0;
  if (!hasVibrance && !hasSaturation) return sourceLinear;

  const saturationFactor = colorSaturationFactor(normalizedSaturation);
  const vibranceFactor = colorVibranceFactor(normalizedVibrance);
  const saturationRolloff = saturationFactor > 1
    ? computeStackSaturationRolloff(sourceLinear, saturationFactor)
    : null;
  const result = new Float32Array(sourceLinear.length);

  for (let i = 0; i + 2 < sourceLinear.length; i += 3) {
    const [h, initialS, v] = rgbToHsv(
      sourceLinear[i] ?? 0,
      sourceLinear[i + 1] ?? 0,
      sourceLinear[i + 2] ?? 0,
    );
    let adjustedS = initialS;
    if (hasSaturation) {
      adjustedS = clamp01(applyRolloffScalar(adjustedS * saturationFactor, saturationRolloff));
    }
    if (hasVibrance) {
      adjustedS = applyScaledLogLinear(adjustedS, vibranceFactor);
    }
    const [r, g, b] = hsvToRgb(h, adjustedS, v);
    result[i] = r;
    result[i + 1] = g;
    result[i + 2] = b;
  }
  return result;
}

function computeStackSaturationRolloff(
  sourceLinear: Float32Array,
  saturationFactor: number,
): { inflection: number; scale: number } | null {
  const pixelCount = Math.floor(sourceLinear.length / 3);
  if (pixelCount <= 0 || saturationFactor <= 1) return null;
  const targetSamples = 256 * 256;
  const stride = Math.max(1, Math.ceil(pixelCount / targetSamples));
  const values: number[] = [];
  for (let pixel = 0; pixel < pixelCount; pixel += stride) {
    const i = pixel * 3;
    const [, s] = rgbToHsv(
      sourceLinear[i] ?? 0,
      sourceLinear[i + 1] ?? 0,
      sourceLinear[i + 2] ?? 0,
    );
    values.push(s * saturationFactor);
  }
  values.sort((a, b) => a - b);
  if (values.length === 0) return null;
  const rank = 0.99 * (values.length - 1);
  const lower = Math.floor(rank);
  const upper = Math.ceil(rank);
  const weight = rank - lower;
  const p99 = (values[lower] ?? 0) * (1 - weight) + (values[upper] ?? 0) * weight;
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
  const normalized = clampStackClahe(strength);
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

function applyClaheToLinearLuminance(
  sourceLinear: Float32Array,
  width: number,
  height: number,
  strength: number,
): Float32Array {
  const normalized = clampStackClahe(strength);
  if (normalized === 0) return sourceLinear;
  const pixelCount = width * height;
  if (!Number.isFinite(pixelCount) || pixelCount <= 0 || sourceLinear.length !== pixelCount * 3) {
    return sourceLinear;
  }

  const luminance = new Float32Array(pixelCount);
  const encodedLuminance = new Uint8Array(pixelCount);
  for (let pixelIndex = 0, sourceIndex = 0; pixelIndex < pixelCount; pixelIndex += 1, sourceIndex += 3) {
    const r = Math.max(0, sourceLinear[sourceIndex] ?? 0);
    const g = Math.max(0, sourceLinear[sourceIndex + 1] ?? 0);
    const b = Math.max(0, sourceLinear[sourceIndex + 2] ?? 0);
    const linearLuma = Math.max(0, 0.299 * r + 0.587 * g + 0.114 * b);
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
  const clipMultiple = claheClipLimitFromStrength(normalized);

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

  const result = new Float32Array(sourceLinear.length);
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
      const scale = sourceLinearLuma > 1e-8 ? targetLinearLuma / sourceLinearLuma : 0;
      const sourceIndex = pixelIndex * 3;
      result[sourceIndex] = Math.max(0, (sourceLinear[sourceIndex] ?? 0) * scale);
      result[sourceIndex + 1] = Math.max(0, (sourceLinear[sourceIndex + 1] ?? 0) * scale);
      result[sourceIndex + 2] = Math.max(0, (sourceLinear[sourceIndex + 2] ?? 0) * scale);
    }
  }
  return result;
}
