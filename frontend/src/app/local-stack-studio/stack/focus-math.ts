export const FOCUS_SHARPNESS_BASE_AREA = 1_000_000;
export const FOCUS_ZSCORE_STD_EPSILON = 1e-6;

export type FocusRunningStats = {
  count: number;
  mean: number;
  m2: number;
};

export function emptyFocusRunningStats(): FocusRunningStats {
  return { count: 0, mean: 0, m2: 0 };
}

export function focusRunningStatsFromValues(values: ArrayLike<number>): FocusRunningStats {
  let count = 0;
  let mean = 0;
  let m2 = 0;
  for (let i = 0; i < values.length; i += 1) {
    const value = Number(values[i]);
    if (!Number.isFinite(value)) continue;
    count += 1;
    const delta = value - mean;
    mean += delta / count;
    const delta2 = value - mean;
    m2 += delta * delta2;
  }
  return { count, mean, m2: Math.max(0, m2) };
}

export function mergeFocusRunningStats(
  left: FocusRunningStats,
  right: FocusRunningStats,
): FocusRunningStats {
  if (!(left.count > 0)) return { ...right };
  if (!(right.count > 0)) return { ...left };
  const count = left.count + right.count;
  const delta = right.mean - left.mean;
  return {
    count,
    mean: left.mean + delta * right.count / count,
    m2: Math.max(0, left.m2 + right.m2 + delta * delta * left.count * right.count / count),
  };
}

export function focusRunningStatsStd(stats: FocusRunningStats): number {
  if (!(stats.count > 0) || !Number.isFinite(stats.m2)) return 0;
  return Math.sqrt(Math.max(0, stats.m2 / stats.count));
}

export function isUsableFocusStd(std: number): boolean {
  return Number.isFinite(std) && std > FOCUS_ZSCORE_STD_EPSILON;
}

export function focusSharpnessWorkingDimensions(
  width: number,
  height: number,
): { width: number; height: number; isScaled: boolean } {
  if (!(Number.isInteger(width) && width > 0 && Number.isInteger(height) && height > 0)) {
    throw new Error("Focus sharpness received invalid image dimensions.");
  }
  const area = width * height;
  const isScaled = area > FOCUS_SHARPNESS_BASE_AREA * 2;
  if (!isScaled) return { width, height, isScaled: false };
  const scale = Math.sqrt(FOCUS_SHARPNESS_BASE_AREA / area);
  return {
    width: Math.ceil(width * scale),
    height: Math.ceil(height * scale),
    isScaled: true,
  };
}

export const FOCUS_TILE_TARGET_CELLS = 80;
export const FOCUS_TILE_GAIN_SIGMA = 1.0;

export type FocusGridDimensions = {
  cols: number;
  rows: number;
};

export function focusGridDimensions(
  width: number,
  height: number,
  targetCells = FOCUS_TILE_TARGET_CELLS,
): FocusGridDimensions {
  if (!(Number.isFinite(width) && width > 0 && Number.isFinite(height) && height > 0)) {
    throw new Error("Focus grid received invalid image dimensions.");
  }
  if (!(Number.isInteger(targetCells) && targetCells > 0)) {
    throw new Error("Focus grid received an invalid target cell count.");
  }

  const minCells = Math.max(1, Math.floor(targetCells * 0.5));
  const maxCells = Math.max(minCells, Math.ceil(targetCells * 1.5));
  const maxCols = Math.max(1, Math.min(maxCells, Math.floor(width)));
  const maxRows = Math.max(1, Math.min(maxCells, Math.floor(height)));
  let bestCols = 1;
  let bestRows = 1;
  let bestScore = Infinity;
  let bestCountDistance = Infinity;

  for (let rows = 1; rows <= maxRows; rows += 1) {
    for (let cols = 1; cols <= maxCols; cols += 1) {
      const cellCount = rows * cols;
      if (maxCols * maxRows >= minCells && (cellCount < minCells || cellCount > maxCells)) continue;
      const tileWidth = width / cols;
      const tileHeight = height / rows;
      const shapeError = Math.log(tileWidth / tileHeight) ** 2;
      const countError = Math.log(cellCount / targetCells) ** 2;
      const score = shapeError + countError;
      const countDistance = Math.abs(cellCount - targetCells);
      if (
        score < bestScore - 1e-12 ||
        (Math.abs(score - bestScore) <= 1e-12 && countDistance < bestCountDistance)
      ) {
        bestScore = score;
        bestCountDistance = countDistance;
        bestCols = cols;
        bestRows = rows;
      }
    }
  }

  return { cols: bestCols, rows: bestRows };
}

export function computeFocusTileScores(
  sharpnessMaps: readonly Float32Array[],
  workingWidth: number,
  workingHeight: number,
  grid: FocusGridDimensions,
): Float32Array[] {
  if (!(Number.isInteger(workingWidth) && workingWidth > 0 && Number.isInteger(workingHeight) && workingHeight > 0)) {
    throw new Error("Focus tile score received invalid working dimensions.");
  }
  if (!(Number.isInteger(grid.cols) && grid.cols > 0 && Number.isInteger(grid.rows) && grid.rows > 0)) {
    throw new Error("Focus tile score received invalid grid dimensions.");
  }
  if (!Array.isArray(sharpnessMaps) || sharpnessMaps.length === 0) {
    throw new Error("Focus tile score received no sharpness maps.");
  }

  const pixelCount = workingWidth * workingHeight;
  for (let imageIndex = 0; imageIndex < sharpnessMaps.length; imageIndex += 1) {
    if (!(sharpnessMaps[imageIndex] instanceof Float32Array) || sharpnessMaps[imageIndex].length !== pixelCount) {
      throw new Error(`Focus sharpness map ${imageIndex + 1} has an invalid size.`);
    }
  }

  const tileCount = grid.cols * grid.rows;
  const counts = new Uint32Array(tileCount);
  const sums = sharpnessMaps.map(() => new Float64Array(tileCount));
  for (let y = 0; y < workingHeight; y += 1) {
    const gridY = Math.min(grid.rows - 1, Math.floor((y + 0.5) * grid.rows / workingHeight));
    for (let x = 0; x < workingWidth; x += 1) {
      const gridX = Math.min(grid.cols - 1, Math.floor((x + 0.5) * grid.cols / workingWidth));
      const tileIndex = gridY * grid.cols + gridX;
      const pixel = y * workingWidth + x;
      counts[tileIndex] += 1;
      for (let imageIndex = 0; imageIndex < sharpnessMaps.length; imageIndex += 1) {
        sums[imageIndex][tileIndex] += sharpnessMaps[imageIndex][pixel];
      }
    }
  }

  return sums.map((sum) => {
    const scores = new Float32Array(tileCount);
    for (let tileIndex = 0; tileIndex < tileCount; tileIndex += 1) {
      scores[tileIndex] = counts[tileIndex] > 0 ? sum[tileIndex] / counts[tileIndex] : 0;
    }
    return scores;
  });
}

export function sampleFocusGridBilinear(
  values: ArrayLike<number>,
  cols: number,
  rows: number,
  normalizedX: number,
  normalizedY: number,
): number {
  if (values.length !== cols * rows || cols <= 0 || rows <= 0) {
    throw new Error("Focus grid sample received invalid dimensions.");
  }
  const gx = normalizedX * cols - 0.5;
  const gy = normalizedY * rows - 0.5;
  const x0Raw = Math.floor(gx);
  const y0Raw = Math.floor(gy);
  const fx = Math.max(0, Math.min(1, gx - x0Raw));
  const fy = Math.max(0, Math.min(1, gy - y0Raw));
  const x0 = Math.max(0, Math.min(cols - 1, x0Raw));
  const y0 = Math.max(0, Math.min(rows - 1, y0Raw));
  const x1 = Math.max(0, Math.min(cols - 1, x0Raw + 1));
  const y1 = Math.max(0, Math.min(rows - 1, y0Raw + 1));
  const v00 = Number(values[y0 * cols + x0]);
  const v10 = Number(values[y0 * cols + x1]);
  const v01 = Number(values[y1 * cols + x0]);
  const v11 = Number(values[y1 * cols + x1]);
  const top = v00 + (v10 - v00) * fx;
  const bottom = v01 + (v11 - v01) * fx;
  return top + (bottom - top) * fy;
}


export function computeFocusFinalMaps(
  sharpnessMaps: readonly Float32Array[],
  workingWidth: number,
  workingHeight: number,
  tileScores: readonly Float32Array[],
  grid: FocusGridDimensions,
  sigma = FOCUS_TILE_GAIN_SIGMA,
): Float32Array[] {
  if (!(Number.isInteger(workingWidth) && workingWidth > 0 && Number.isInteger(workingHeight) && workingHeight > 0)) {
    throw new Error("Focus final map received invalid working dimensions.");
  }
  if (!(Number.isInteger(grid.cols) && grid.cols > 0 && Number.isInteger(grid.rows) && grid.rows > 0)) {
    throw new Error("Focus final map received invalid grid dimensions.");
  }
  if (!(Number.isFinite(sigma) && sigma > 0)) {
    throw new Error("Focus final map received an invalid tile gain sigma.");
  }
  if (!Array.isArray(sharpnessMaps) || sharpnessMaps.length === 0) {
    throw new Error("Focus final map received no sharpness maps.");
  }
  if (!Array.isArray(tileScores) || tileScores.length !== sharpnessMaps.length) {
    throw new Error("Focus final map received mismatched tile scores.");
  }

  const pixelCount = workingWidth * workingHeight;
  const tileCount = grid.cols * grid.rows;
  for (let imageIndex = 0; imageIndex < sharpnessMaps.length; imageIndex += 1) {
    if (!(sharpnessMaps[imageIndex] instanceof Float32Array) || sharpnessMaps[imageIndex].length !== pixelCount) {
      throw new Error(`Focus sharpness map ${imageIndex + 1} has an invalid size.`);
    }
    if (!(tileScores[imageIndex] instanceof Float32Array) || tileScores[imageIndex].length !== tileCount) {
      throw new Error(`Focus tile score ${imageIndex + 1} has an invalid size.`);
    }
  }

  const finals = sharpnessMaps.map(() => new Float32Array(pixelCount));
  for (let y = 0; y < workingHeight; y += 1) {
    const normalizedY = (y + 0.5) / workingHeight;
    for (let x = 0; x < workingWidth; x += 1) {
      const normalizedX = (x + 0.5) / workingWidth;
      const pixel = y * workingWidth + x;
      let best = -Infinity;
      let second = -Infinity;
      for (let imageIndex = 0; imageIndex < sharpnessMaps.length; imageIndex += 1) {
        const value = sharpnessMaps[imageIndex][pixel];
        if (value > best) {
          second = best;
          best = value;
        } else if (value > second) {
          second = value;
        }
      }
      const gain = focusTileGain(best - second, sigma);
      for (let imageIndex = 0; imageIndex < sharpnessMaps.length; imageIndex += 1) {
        finals[imageIndex][pixel] = sharpnessMaps[imageIndex][pixel] + gain * sampleFocusGridBilinear(
          tileScores[imageIndex],
          grid.cols,
          grid.rows,
          normalizedX,
          normalizedY,
        );
      }
    }
  }
  return finals;
}

export function focusTileGain(mapMargin: number, sigma = FOCUS_TILE_GAIN_SIGMA): number {
  if (!(Number.isFinite(sigma) && sigma > 0)) throw new Error("Focus tile gain sigma must be positive.");
  if (mapMargin === Infinity) return 0;
  const margin = Math.max(0, Number.isFinite(mapMargin) ? mapMargin : 0);
  const scaled = margin / sigma;
  return Math.exp(-(scaled * scaled));
}
