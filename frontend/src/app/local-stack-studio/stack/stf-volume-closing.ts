/** Rim-mean grayscale Volume Closing 2 for an already normalized [0,1] protection map. */
export const STF_VOLUME_INTERPOLATED_COST_PER_MP = 256;
export const STF_VOLUME_INTERPOLATED_MAX_WORK_PIXELS = 2_000_000;
const LEVEL_COUNT = 65_536;

/**
 * Four-neighbor component-tree closing with a rim-mean volume criterion.
 * The lower-level component's rim is all adjacent outside pixels (counted by
 * boundary edge). Its volume is area * arithmeticMean(rim) - sum(interior).
 * A monotone envelope of this cost on the min-tree prevents non-monotone
 * decisions when the rim changes as components merge. Components touching
 * the image boundary are never raised as whole open-background basins.
 *
 * This is a rim-mean variant of grayscale volume closing, NOT a standard
 * volume attribute computed from a component's saddle height. Because
 * the rim mean changes after filling, it need not be idempotent; the
 * production algorithm deliberately applies exactly one pass.
 */
export function volumeCloseGrayscaleInPlace(
  values: Float32Array, width: number, height: number, volumeThreshold: number,
): void {
  const pixels = width * height;
  if (!Number.isSafeInteger(pixels) || pixels < 1 || values.length !== pixels ||
    !Number.isInteger(width) || width < 1 || !Number.isInteger(height) || height < 1 ||
    !Number.isFinite(volumeThreshold) || volumeThreshold < 0) {
    throw new Error("STF Volume Closing parameters are invalid.");
  }
  if (volumeThreshold === 0 || pixels <= 1) return;
  const histogram = new Uint32Array(LEVEL_COUNT);
  const levels = new Uint16Array(pixels);
  for (let i = 0; i < pixels; i++) {
    const value = values[i];
    if (!Number.isFinite(value) || value < 0 || value > 1) {
      throw new Error("STF Volume Closing expects finite values in [0, 1].");
    }
    const level = Math.round(value * (LEVEL_COUNT - 1));
    levels[i] = level;
    histogram[level]++;
  }
  const offsets = new Uint32Array(LEVEL_COUNT);
  let total = 0;
  for (let i = 0; i < LEVEL_COUNT; i++) { offsets[i] = total; total += histogram[i]; }
  const sorted = new Uint32Array(pixels);
  for (let i = 0; i < pixels; i++) sorted[offsets[levels[i]]++] = i;

  const uf = new Int32Array(pixels);
  uf.fill(-1);
  const parent = new Int32Array(pixels);
  const componentArea = new Uint32Array(pixels);
  const insideSum = new Float64Array(pixels);
  const rimSum = new Float64Array(pixels);
  const rimEdges = new Int32Array(pixels);
  const cost = new Float64Array(pixels);
  const touchesBorder = new Uint8Array(pixels);
  const find = (initial: number): number => {
    let root = initial;
    while (uf[root] !== root) root = uf[root];
    let node = initial;
    while (node !== root) {
      const next = uf[node];
      uf[node] = root;
      node = next;
    }
    return root;
  };
  for (let i = 0; i < pixels; i++) {
    const p = sorted[i];
    const x = p % width;
    const y = (p / width) | 0;
    uf[p] = p;
    parent[p] = p;
    componentArea[p] = 1;
    insideSum[p] = values[p];
    touchesBorder[p] = x === 0 || y === 0 || x + 1 === width || y + 1 === height ? 1 : 0;
    let inherited = 0;
    // Each non-active neighbor contributes an exterior rim edge. Each active
    // neighbor's rim had an edge leading to p: subtract it upon union.
    for (let direction = 0; direction < 4; direction++) {
      const q = direction === 0 ? (x > 0 ? p - 1 : -1)
        : direction === 1 ? (x + 1 < width ? p + 1 : -1)
        : direction === 2 ? (y > 0 ? p - width : -1)
        : (y + 1 < height ? p + width : -1);
      if (q < 0) continue;
      if (uf[q] < 0) {
        rimSum[p] += values[q];
        rimEdges[p] += 1;
      } else {
        const root = find(q);
        rimSum[p] -= values[p];
        rimEdges[p] -= 1;
        if (root !== p) {
          inherited = Math.max(inherited, cost[root]);
          rimSum[p] += rimSum[root];
          rimEdges[p] += rimEdges[root];
          componentArea[p] += componentArea[root];
          insideSum[p] += insideSum[root];
          touchesBorder[p] |= touchesBorder[root];
          parent[root] = p;
          uf[root] = p;
        }
      }
    }
    // Open regions and the root are never filled. The monotone envelope makes
    // sure a deep protected child cannot be overfilled through its parent.
    const localCost = touchesBorder[p] || rimEdges[p] <= 0
      ? Infinity
      : Math.max(0, (rimSum[p] / rimEdges[p]) * componentArea[p] - insideSum[p]);
    cost[p] = Math.max(inherited, localCost);
  }
  // Parents precede children in reverse sorted order. No pixel may be lowered.
  for (let i = pixels - 1; i >= 0; i--) {
    const p = sorted[i];
    if (parent[p] !== p && cost[p] < volumeThreshold) {
      // Use the mean of the ORIGINAL exterior rim. Only a genuine rise to a
      // higher tree level may apply this height; equal-level nodes are bookkeeping.
      // Equal-level nodes are intermediate union bookkeeping: applying their
      // partial rim means would hollow out protected deep flat basins.
      const rimMean = rimEdges[p] > 0 && levels[parent[p]] > levels[p]
        ? rimSum[p] / rimEdges[p] : values[parent[p]];
      values[p] = Math.max(values[p], values[parent[p]], rimMean);
    }
  }
}

/**
 * Apply Volume Closing directly to an already P3/P97-normalized [0,1] map.
 * Down/up sampling propagates only positive Closing changes; the working
 * resolution and the original map do not introduce any further normalization.
 */
export function interpolateStfVolumeUnitRatioInPlace(
  source: Float32Array,
  width: number,
  height: number,
  maxWorkPixels = STF_VOLUME_INTERPOLATED_MAX_WORK_PIXELS,
  volumePerMP = STF_VOLUME_INTERPOLATED_COST_PER_MP,
): { workingWidth: number; workingHeight: number; volumeThreshold: number } {
  const pixels = width * height;
  if (!Number.isSafeInteger(pixels) || pixels < 1 || !Number.isInteger(width) || width < 1 ||
    !Number.isInteger(height) || height < 1 || source.length !== pixels ||
    !Number.isInteger(maxWorkPixels) || maxWorkPixels < 1 ||
    !Number.isFinite(volumePerMP) || volumePerMP <= 0) {
    throw new Error("STF Volume Closing sharpness geometry is invalid.");
  }
  for (let i = 0; i < pixels; i++) {
    if (!Number.isFinite(source[i]) || source[i] < 0 || source[i] > 1) {
      throw new Error("STF Volume Closing requires normalized values in [0,1].");
    }
  }
  const scale = Math.min(1, Math.sqrt(maxWorkPixels / pixels));
  let workingWidth = Math.max(1, Math.round(width * scale));
  let workingHeight = Math.max(1, Math.round(height * scale));
  // Independent width/height rounding can exceed the exact working-pixel cap.
  while (workingWidth * workingHeight > maxWorkPixels) {
    if (workingWidth >= workingHeight && workingWidth > 1) workingWidth--;
    else workingHeight--;
  }
  const workingPixels = workingWidth * workingHeight;
  const volumeThreshold = volumePerMP * workingPixels / 1_000_000;
  const info = { workingWidth, workingHeight, volumeThreshold };
  if (!(volumeThreshold > 0)) return info;

  const reduced = new Float32Array(workingPixels);
  if (workingPixels === pixels) {
    reduced.set(source);
  } else {
    const sums = new Float64Array(workingPixels);
    const counts = new Uint32Array(workingPixels);
    for (let y = 0; y < height; y++) {
      const dy = Math.min(workingHeight - 1, Math.floor(y * workingHeight / height));
      for (let x = 0; x < width; x++) {
        const dest = dy * workingWidth + Math.min(workingWidth - 1, Math.floor(x * workingWidth / width));
        sums[dest] += source[y * width + x];
        counts[dest]++;
      }
    }
    for (let i = 0; i < workingPixels; i++) reduced[i] = counts[i] ? sums[i] / counts[i] : 0;
  }
  const before = workingPixels === pixels ? null : reduced.slice();
  volumeCloseGrayscaleInPlace(reduced, workingWidth, workingHeight, volumeThreshold);
  if (workingPixels === pixels) {
    for (let i = 0; i < pixels; i++) source[i] = Math.max(source[i], reduced[i]);
    return info;
  }
  const delta = new Float32Array(workingPixels);
  for (let i = 0; i < workingPixels; i++) delta[i] = Math.max(0, reduced[i] - before![i]);
  for (let y = 0; y < height; y++) {
    const fy = Math.max(0, Math.min(workingHeight - 1, (y + 0.5) * workingHeight / height - 0.5));
    const y0 = Math.floor(fy), y1 = Math.min(workingHeight - 1, y0 + 1), ty = fy - y0;
    for (let x = 0; x < width; x++) {
      const fx = Math.max(0, Math.min(workingWidth - 1, (x + 0.5) * workingWidth / width - 0.5));
      const x0 = Math.floor(fx), x1 = Math.min(workingWidth - 1, x0 + 1), tx = fx - x0;
      const top = delta[y0 * workingWidth + x0] * (1 - tx) + delta[y0 * workingWidth + x1] * tx;
      const bottom = delta[y1 * workingWidth + x0] * (1 - tx) + delta[y1 * workingWidth + x1] * tx;
      const uplift = top * (1 - ty) + bottom * ty;
      if (uplift <= 1e-7) continue;
      const index = y * width + x;
      source[index] = Math.min(1, source[index] + uplift);
    }
  }
  return info;
}
