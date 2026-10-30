/** Experimental grayscale Volume Closing in a [0, 1] sharpness-confidence map. */
export const STF_VOLUME_INTERPOLATED_COST_PER_MP = 256;
export const STF_VOLUME_INTERPOLATED_MAX_WORK_PIXELS = 2_000_000;
const LEVEL_COUNT = 65_536;
const LOGIT_EPSILON = 1e-7;
export type StfVolumeFillMode = "parent" | "rim-mean";

function sigmoid(logRatio: number): number {
  if (Number.isNaN(logRatio) || logRatio === -Infinity) return 0;
  if (logRatio === Infinity) return 1;
  return logRatio >= 0
    ? 1 / (1 + Math.exp(-logRatio))
    : Math.exp(logRatio) / (1 + Math.exp(logRatio));
}

function logit(value: number): number {
  const clamped = Math.max(LOGIT_EPSILON, Math.min(1 - LOGIT_EPSILON, value));
  return Math.log(clamped / (1 - clamped));
}

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
 * the rim mean changes after filling, it need not be idempotent; this preview
 * deliberately applies exactly one pass. The optional rim-mean fill mode
 * only changes the reconstruction height; the component tree and volume
 * decision are identical to the original parent-height mode.
 */
export function volumeCloseGrayscaleInPlace(
  values: Float32Array, width: number, height: number, volumeThreshold: number,
  fillMode: StfVolumeFillMode = "parent",
): void {
  const pixels = width * height;
  if (!Number.isSafeInteger(pixels) || pixels < 1 || values.length !== pixels ||
    !Number.isInteger(width) || width < 1 || !Number.isInteger(height) || height < 1 ||
    !Number.isFinite(volumeThreshold) || volumeThreshold < 0 ||
    (fillMode !== "parent" && fillMode !== "rim-mean")) {
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
      // Volume interpolated 2 uses the already measured mean of the ORIGINAL
      // exterior rim, rather than being limited to the parent/saddle height.
      // Parent propagation ensures descendants are not left below a filled
      // ancestor. The original volume mode retains its exact behavior.
      // Apply the mean only at a genuine rise to a higher tree level.
      // Equal-level nodes are intermediate union bookkeeping: applying their
      // partial rim means would hollow out protected deep flat basins.
      const rimMean = fillMode === "rim-mean" && rimEdges[p] > 0 && levels[parent[p]] > levels[p]
        ? rimSum[p] / rimEdges[p] : values[parent[p]];
      values[p] = Math.max(values[p], values[parent[p]], rimMean);
    }
  }
}

/**
 * Perform Volume Closing on the display-normalized [0,1] ratio map, but
 * return an updated log-ratio map for the existing raw-ratio preview path.
 * Only closing-derived increases are propagated through down/up sampling;
 * other numeric values (including unfilled NaN pixels) remain unchanged.
 */
export function interpolateStfVolumeLogRatioInPlace(
  source: Float32Array,
  width: number,
  height: number,
  maxWorkPixels = STF_VOLUME_INTERPOLATED_MAX_WORK_PIXELS,
  volumePerMP = STF_VOLUME_INTERPOLATED_COST_PER_MP,
  fillMode: StfVolumeFillMode = "parent",
): { workingWidth: number; workingHeight: number; volumeThreshold: number } {
  const pixels = width * height;
  if (!Number.isSafeInteger(pixels) || pixels < 1 || !Number.isInteger(width) || width < 1 ||
    !Number.isInteger(height) || height < 1 || source.length !== pixels ||
    !Number.isInteger(maxWorkPixels) || maxWorkPixels < 1 ||
    !Number.isFinite(volumePerMP) || volumePerMP <= 0) {
    throw new Error("STF Volume Closing sharpness geometry is invalid.");
  }
  const scale = Math.min(1, Math.sqrt(maxWorkPixels / pixels));
  const workingWidth = Math.max(1, Math.round(width * scale));
  const workingHeight = Math.max(1, Math.round(height * scale));
  const workingPixels = workingWidth * workingHeight;
  const volumeThreshold = volumePerMP * workingPixels / 1_000_000;
  const info = { workingWidth, workingHeight, volumeThreshold };
  if (!(volumeThreshold > 0)) return info;
  const reduced = new Float32Array(workingPixels);
  if (workingPixels === pixels) {
    for (let i = 0; i < pixels; i++) reduced[i] = sigmoid(source[i]);
  } else {
    const sums = new Float64Array(workingPixels);
    const counts = new Uint32Array(workingPixels);
    for (let y = 0; y < height; y++) {
      const dy = Math.min(workingHeight - 1, Math.floor(y * workingHeight / height));
      for (let x = 0; x < width; x++) {
        const dest = dy * workingWidth + Math.min(workingWidth - 1, Math.floor(x * workingWidth / width));
        sums[dest] += sigmoid(source[y * width + x]);
        counts[dest]++;
      }
    }
    for (let i = 0; i < workingPixels; i++) reduced[i] = counts[i] ? sums[i] / counts[i] : 0;
  }
  const before = workingPixels === pixels ? null : reduced.slice();
  volumeCloseGrayscaleInPlace(reduced, workingWidth, workingHeight, volumeThreshold, fillMode);
  if (workingPixels === pixels) {
    for (let i = 0; i < pixels; i++) {
      if (reduced[i] > sigmoid(source[i]) + 1e-7) source[i] = logit(reduced[i]);
    }
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
      const old = sigmoid(source[index]);
      // No geometric interpolation by itself can increase an unmodified pixel.
      const newValue = Math.min(1, old + uplift);
      if (newValue > old + 1e-7) source[index] = logit(newValue);
    }
  }
  return info;
}
