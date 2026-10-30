/** Area closing of log-sharpness ratio. This is an experimental, gate-free preview. */
export const STF_INTERPOLATED_AREA_PER_MP = 512;
export const STF_INTERPOLATED_MAX_WORK_PIXELS = 2_000_000;
const LEVEL_COUNT = 65_536;

/**
 * Fill connected dark components whose area is STRICTLY smaller than areaThreshold.
 * Four-neighbor, grayscale area closing via a minimum component tree.
 *
 * The component tree is built in ascending order with an O(N) 16-bit bucket
 * ordering, avoiding an O(N log N) sort of millions of floating-point pixels.
 * Values used for ordering are quantized; the input levels are not altered
 * unless a component is filled. An independent UF parent is necessary because
 * path compression must never alter the actual component tree.
 */
export function areaCloseGrayscaleInPlace(values: Float32Array, width: number, height: number, areaThreshold: number): void {
  const pixels = width * height;
  if (!Number.isSafeInteger(pixels) || pixels <= 0 || values.length !== pixels || !Number.isInteger(areaThreshold) || areaThreshold < 1) {
    throw new Error("STF Area Closing parameters are invalid.");
  }
  if (areaThreshold <= 1 || pixels <= 1) return;
  let min = Infinity;
  let max = -Infinity;
  for (let i = 0; i < pixels; i++) {
    const value = values[i];
    if (!Number.isFinite(value)) throw new Error("STF Area Closing requires finite grayscale values.");
    min = Math.min(min, value);
    max = Math.max(max, value);
  }
  if (!(max > min)) return;

  // Counting sort all pixels by increasing gray level, preserving plateau
  // behavior up to 16-bit gray-level quantization.
  const histogram = new Uint32Array(LEVEL_COUNT);
  const levels = new Uint16Array(pixels);
  const scale = (LEVEL_COUNT - 1) / (max - min);
  for (let i = 0; i < pixels; i++) {
    const level = Math.max(0, Math.min(LEVEL_COUNT - 1, Math.round((values[i] - min) * scale)));
    levels[i] = level;
    histogram[level]++;
  }
  const offsets = new Uint32Array(LEVEL_COUNT);
  let total = 0;
  for (let i = 0; i < LEVEL_COUNT; i++) {
    offsets[i] = total;
    total += histogram[i];
  }
  const sorted = new Uint32Array(pixels);
  for (let i = 0; i < pixels; i++) sorted[offsets[levels[i]]++] = i;

  // A pixel points to a later-visited pixel on the min-tree. Its subtree size
  // equals the area of the connected lower level set at that tree node.
  const uf = new Int32Array(pixels);
  uf.fill(-1);
  const parent = new Int32Array(pixels);
  const area = new Uint32Array(pixels);
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
    uf[p] = p;
    parent[p] = p;
    area[p] = 1;
    const x = p % width;
    const y = (p / width) | 0;
    // Only already active neighbors may be merged. A root is always the
    // most recently inserted pixel in its connected component.
    const neighbors = [x > 0 ? p - 1 : -1, x + 1 < width ? p + 1 : -1,
      y > 0 ? p - width : -1, y + 1 < height ? p + width : -1];
    for (const q of neighbors) {
      if (q < 0 || uf[q] < 0) continue;
      const root = find(q);
      if (root === p) continue;
      parent[root] = p;
      uf[root] = p;
    }
  }

  for (let i = 0; i < pixels; i++) {
    const p = sorted[i];
    if (parent[p] !== p) area[parent[p]] += area[p];
  }
  // Parent's result is computed before its children. Restore the intensity
  // of the first ancestor whose sublevel component is large enough.
  const cap = Math.min(areaThreshold, pixels);
  for (let i = pixels - 1; i >= 0; i--) {
    const p = sorted[i];
    if (parent[p] !== p && area[p] < cap) {
      values[p] = Math.max(values[p], values[parent[p]]);
    }
  }
}

/**
 * Downsample, area-close, and bilinearly restore at source size.
 * The original per-pixel value is never lowered. Nonfinite input represents
 * absent fine-frequency evidence and is left nonfinite unless filled by a
 * sufficiently surrounded high-confidence region.
 * Heavy work runs inside the STF Additional Blur worker, not the UI thread.
 */
export function interpolateStfLogRatioInPlace(
  source: Float32Array,
  width: number,
  height: number,
  maxWorkPixels = STF_INTERPOLATED_MAX_WORK_PIXELS,
  areaPerMP = STF_INTERPOLATED_AREA_PER_MP,
): { workingWidth: number; workingHeight: number; areaThreshold: number } {
  const pixels = width * height;
  if (!Number.isSafeInteger(pixels) || pixels < 1 || !Number.isInteger(width) || width < 1 || !Number.isInteger(height) || height < 1 || source.length !== pixels
    || !(Number.isInteger(maxWorkPixels) && maxWorkPixels >= 1)
    || !(Number.isFinite(areaPerMP) && areaPerMP > 0)) {
    throw new Error("STF interpolated sharpness geometry is invalid.");
  }
  let min = Infinity;
  let max = -Infinity;
  for (let i = 0; i < pixels; i++) {
    const value = source[i];
    if (Number.isFinite(value)) {
      min = Math.min(min, value);
      max = Math.max(max, value);
    }
  }
  const scale = Math.min(1, Math.sqrt(maxWorkPixels / pixels));
  const workingWidth = Math.max(1, Math.round(width * scale));
  const workingHeight = Math.max(1, Math.round(height * scale));
  const workingPixels = workingWidth * workingHeight;
  const areaThreshold = Math.max(1, Math.round(areaPerMP * workingPixels / 1_000_000));
  const info = { workingWidth, workingHeight, areaThreshold };
  if (!(max >= min) || areaThreshold <= 1) return info;

  // The raw ratio may be NaN where fine-scale sharpness is exactly zero.
  // Treat these as the darkest values for connectivity, but preserve a NaN
  // when a region is too large / open and so cannot be reconstructed.
  const missing = min - Math.max(1, max - min);
  const reduced = new Float32Array(workingPixels);
  if (workingPixels === pixels) {
    for (let i = 0; i < pixels; i++) reduced[i] = Number.isFinite(source[i]) ? source[i] : missing;
  } else {
    const sums = new Float64Array(workingPixels);
    const counts = new Uint32Array(workingPixels);
    for (let y = 0; y < height; y++) {
      const dy = Math.min(workingHeight - 1, Math.floor(y * workingHeight / height));
      for (let x = 0; x < width; x++) {
        const i = y * width + x;
        const dest = dy * workingWidth + Math.min(workingWidth - 1, Math.floor(x * workingWidth / width));
        sums[dest] += Number.isFinite(source[i]) ? source[i] : missing;
        counts[dest]++;
      }
    }
    for (let i = 0; i < workingPixels; i++) reduced[i] = counts[i] ? sums[i] / counts[i] : missing;
  }
  // Keep the unmodified downsampled map. Upscaling the filled map directly
  // would also raise values because of resampling alone; compare the two maps
  // so only changes caused by Area Closing are propagated to full resolution.
  const originalReduced = workingPixels === pixels ? null : reduced.slice();
  areaCloseGrayscaleInPlace(reduced, workingWidth, workingHeight, areaThreshold);

  if (workingPixels === pixels) {
    for (let i = 0; i < pixels; i++) {
      if (reduced[i] > missing) source[i] = Math.max(Number.isFinite(source[i]) ? source[i] : -Infinity, reduced[i]);
    }
  } else {
    // Bilinear upscaling restores smooth boundaries while retaining every
    // original strong peak, rather than re-blurring high sharpness evidence.
    for (let y = 0; y < height; y++) {
      const fy = Math.max(0, Math.min(workingHeight - 1, (y + 0.5) * workingHeight / height - 0.5));
      const y0 = Math.floor(fy);
      const y1 = Math.min(workingHeight - 1, y0 + 1);
      const ty = fy - y0;
      for (let x = 0; x < width; x++) {
        const fx = Math.max(0, Math.min(workingWidth - 1, (x + 0.5) * workingWidth / width - 0.5));
        const x0 = Math.floor(fx);
        const x1 = Math.min(workingWidth - 1, x0 + 1);
        const tx = fx - x0;
        const top = reduced[y0 * workingWidth + x0] * (1 - tx) + reduced[y0 * workingWidth + x1] * tx;
        const bottom = reduced[y1 * workingWidth + x0] * (1 - tx) + reduced[y1 * workingWidth + x1] * tx;
        const interpolated = top * (1 - ty) + bottom * ty;
        const beforeTop = originalReduced![y0 * workingWidth + x0] * (1 - tx) + originalReduced![y0 * workingWidth + x1] * tx;
        const beforeBottom = originalReduced![y1 * workingWidth + x0] * (1 - tx) + originalReduced![y1 * workingWidth + x1] * tx;
        const uplift = interpolated - (beforeTop * (1 - ty) + beforeBottom * ty);
        if (!(uplift > 1e-7)) continue;
        const index = y * width + x;
        // Limit the raised value to the reconstructed local level. A high
        // original feature must not be amplified just because a nearby dark
        // component was filled at the working resolution.
        if (Number.isFinite(source[index])) {
          source[index] = Math.max(source[index], Math.min(interpolated, source[index] + uplift));
        } else if (interpolated > missing) {
          source[index] = interpolated;
        }
      }
    }
  }
  return info;
}
