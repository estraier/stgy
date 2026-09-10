import {
  applyToneAdjustmentsLinearRgbRange,
  clamp01,
  type ColorAdjustmentContext,
  type ToneAdjustmentStage,
} from "@/image/tone";
import type { LinearRgbSample } from "./types";

export type ImageEditClarityMap = {
  width: number;
  height: number;
  gain: Float32Array;
};

export function clampClarity(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(-100, Math.min(100, Math.round(value)));
}

function clarityClipLimitFromStrength(strength: number): number {
  const normalized = Math.abs(clampClarity(strength));
  if (normalized <= 0) return 0;
  const t = normalized / 100;
  return 8 * t * t;
}

function computeClarityTileGrid(width: number, height: number) {
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
  valid: Uint8Array | undefined,
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

  // Keep invalid rotation-border pixels out of the local mean. The two-pass box
  // filter carries both luminance sum and valid-pixel count.
  const horizontalSum = new Float64Array(pixelCount);
  const horizontalCount = new Uint32Array(pixelCount);
  for (let y = 0; y < height; y += 1) {
    const rowOffset = y * width;
    let left = 0;
    let right = Math.min(width - 1, rx);
    let sum = 0;
    let count = 0;
    for (let x = left; x <= right; x += 1) {
      const index = rowOffset + x;
      if (!valid || valid[index]) {
        sum += source[index] ?? 0;
        count += 1;
      }
    }
    for (let x = 0; x < width; x += 1) {
      const index = rowOffset + x;
      horizontalSum[index] = sum;
      horizontalCount[index] = count;
      const nextLeft = Math.max(0, x + 1 - rx);
      const nextRight = Math.min(width - 1, x + 1 + rx);
      while (left < nextLeft) {
        const leaving = rowOffset + left;
        if (!valid || valid[leaving]) {
          sum -= source[leaving] ?? 0;
          count -= 1;
        }
        left += 1;
      }
      while (right < nextRight) {
        right += 1;
        const entering = rowOffset + right;
        if (!valid || valid[entering]) {
          sum += source[entering] ?? 0;
          count += 1;
        }
      }
    }
  }

  const blurred = new Float32Array(pixelCount);
  for (let x = 0; x < width; x += 1) {
    let top = 0;
    let bottom = Math.min(height - 1, ry);
    let sum = 0;
    let count = 0;
    for (let y = top; y <= bottom; y += 1) {
      const index = y * width + x;
      sum += horizontalSum[index] ?? 0;
      count += horizontalCount[index] ?? 0;
    }
    for (let y = 0; y < height; y += 1) {
      const index = y * width + x;
      blurred[index] = count > 0 ? sum / count : (source[index] ?? 0);
      const nextTop = Math.max(0, y + 1 - ry);
      const nextBottom = Math.min(height - 1, y + 1 + ry);
      while (top < nextTop) {
        const leaving = top * width + x;
        sum -= horizontalSum[leaving] ?? 0;
        count -= horizontalCount[leaving] ?? 0;
        top += 1;
      }
      while (bottom < nextBottom) {
        bottom += 1;
        const entering = bottom * width + x;
        sum += horizontalSum[entering] ?? 0;
        count += horizontalCount[entering] ?? 0;
      }
    }
  }
  return blurred;
}

/**
 * Apply all adjustments that precede Clarity to a preview-sized RGB sample.
 * The result can be shared by Clarity analysis and preview rendering so Tone
 * is not evaluated twice for the same preview pixels.
 */
export function buildImageEditToneSample(
  sample: LinearRgbSample,
  context: ColorAdjustmentContext,
  startStage: ToneAdjustmentStage = "white-balance",
): LinearRgbSample {
  const width = Math.max(1, Math.round(sample.width));
  const height = Math.max(1, Math.round(sample.height));
  const pixelCount = width * height;
  if (sample.data.length !== pixelCount * 3) return sample;

  const data = new Float32Array(sample.data.length);
  const valid = sample.valid;
  for (let pixelIndex = 0, sourceIndex = 0; pixelIndex < pixelCount; pixelIndex += 1, sourceIndex += 3) {
    if (valid && !valid[pixelIndex]) continue;
    const [toneR, toneG, toneB] = applyToneAdjustmentsLinearRgbRange(
      sample.data[sourceIndex] ?? 0,
      sample.data[sourceIndex + 1] ?? 0,
      sample.data[sourceIndex + 2] ?? 0,
      context,
      startStage,
      "after-tone",
    );
    data[sourceIndex] = Math.fround(toneR);
    data[sourceIndex + 1] = Math.fround(toneG);
    data[sourceIndex + 2] = Math.fround(toneB);
  }
  return { data, width, height, ...(valid ? { valid } : {}) };
}

/**
 * Build the Clarity gain field from an already Tone-adjusted preview sample.
 */
export function buildImageEditClarityMapFromToneSample(
  toneSample: LinearRgbSample,
  clarity: number,
): ImageEditClarityMap | null {
  const normalized = clampClarity(clarity);
  if (normalized === 0) return null;
  const width = Math.max(1, Math.round(toneSample.width));
  const height = Math.max(1, Math.round(toneSample.height));
  const pixelCount = width * height;
  if (toneSample.data.length !== pixelCount * 3) return null;

  const valid = toneSample.valid;
  const luminance = new Float32Array(pixelCount);
  const encodedLuminance = normalized > 0 ? new Uint8Array(pixelCount) : null;

  for (let pixelIndex = 0, sourceIndex = 0; pixelIndex < pixelCount; pixelIndex += 1, sourceIndex += 3) {
    if (valid && !valid[pixelIndex]) continue;
    // Keep the preview-map behavior aligned with LSS: CLAHE operates on a
    // perceptually encoded Rec.601-style luminance while RGB itself stays linear.
    const r = toneSample.data[sourceIndex] ?? 0;
    const g = toneSample.data[sourceIndex + 1] ?? 0;
    const b = toneSample.data[sourceIndex + 2] ?? 0;
    const linearLuma = Math.max(
      0,
      0.299 * Math.max(0, r) + 0.587 * Math.max(0, g) + 0.114 * Math.max(0, b),
    );
    luminance[pixelIndex] = linearLuma;
    if (encodedLuminance) {
      encodedLuminance[pixelIndex] = Math.max(
        0,
        Math.min(255, Math.round(Math.sqrt(clamp01(linearLuma)) * 255)),
      );
    }
  }

  const { tilesX, tilesY, tileWidth, tileHeight } = computeClarityTileGrid(width, height);
  const gain = new Float32Array(pixelCount);
  gain.fill(1);

  if (normalized < 0) {
    const t = Math.abs(normalized) / 100;
    const radiusX = Math.max(1, Math.round(tileWidth / 2));
    const radiusY = Math.max(1, Math.round(tileHeight / 2));
    const localMean = boxBlurLinearLuminance(
      luminance,
      valid,
      width,
      height,
      radiusX,
      radiusY,
    );
    const detailAttenuation = 1 / (1 + 4 * t);
    for (let pixelIndex = 0; pixelIndex < pixelCount; pixelIndex += 1) {
      if (valid && !valid[pixelIndex]) continue;
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

  const encoded = encodedLuminance!;
  const bins = 256;
  const tileCount = tilesX * tilesY;
  const luts = new Float32Array(tileCount * bins);
  const clipMultiple = clarityClipLimitFromStrength(normalized);

  for (let tileY = 0; tileY < tilesY; tileY += 1) {
    const y0 = tileY * tileHeight;
    const y1 = Math.min(height, y0 + tileHeight);
    for (let tileX = 0; tileX < tilesX; tileX += 1) {
      const x0 = tileX * tileWidth;
      const x1 = Math.min(width, x0 + tileWidth);
      const hist = new Uint32Array(bins);
      let area = 0;
      for (let y = y0; y < y1; y += 1) {
        let pixelIndex = y * width + x0;
        for (let x = x0; x < x1; x += 1, pixelIndex += 1) {
          if (valid && !valid[pixelIndex]) continue;
          hist[encoded[pixelIndex] ?? 0] += 1;
          area += 1;
        }
      }

      const lutOffset = (tileY * tilesX + tileX) * bins;
      if (area <= 0) {
        for (let bin = 0; bin < bins; bin += 1) luts[lutOffset + bin] = bin / (bins - 1);
        continue;
      }

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
      const pixelIndex = y * width + x;
      if (valid && !valid[pixelIndex]) continue;

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

      const bin = encoded[pixelIndex] ?? 0;
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

/**
 * Build the Clarity gain field from a source sample. Full-resolution/fallback
 * callers retain the previous one-shot API; the interactive preview uses the
 * split Tone + Clarity functions above so it can reuse its ~1 MP Tone buffer.
 */
export function buildImageEditClarityMap(
  sample: LinearRgbSample,
  context: ColorAdjustmentContext,
  clarity: number,
): ImageEditClarityMap | null {
  const normalized = clampClarity(clarity);
  if (normalized === 0) return null;
  return buildImageEditClarityMapFromToneSample(
    buildImageEditToneSample(sample, context),
    normalized,
  );
}

export function isUsableImageEditClarityMap(
  map: ImageEditClarityMap | null | undefined,
): map is ImageEditClarityMap {
  return !!map && map.width > 0 && map.height > 0 && map.gain.length === map.width * map.height;
}

export function sampleImageEditClarityGain(
  map: ImageEditClarityMap,
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
