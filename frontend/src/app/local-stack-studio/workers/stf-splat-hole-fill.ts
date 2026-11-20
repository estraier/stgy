/**
 * Local hole filling for STF forward splatting.
 *
 * Only pixels with a positive ORIGINAL splat weight are sampling candidates.
 * Filled pixels never become candidates, so the result is independent of
 * output traversal order. No inverse warp, Flow sampling, or image-sized
 * auxiliary allocation is needed.
 */
export const STF_SPLAT_HOLE_MAX_RADIUS = 8;

// Buckets: 0=source-copy, 1=cardinal4, 2=diagonal4, 3..9=square rings r=2..8.
export const STF_SPLAT_HOLE_SEARCH_BUCKET_COUNT = STF_SPLAT_HOLE_MAX_RADIUS + 2;
// A complete radius-8 ring contains 64 pixels; bucket 0 is source-copy.
export const STF_SPLAT_HOLE_NEIGHBOR_BUCKET_COUNT = STF_SPLAT_HOLE_MAX_RADIUS * 8 + 1;

function clampUint16(value: number): number {
  if (!(value > 0)) return 0;
  if (value >= 65535) return 65535;
  return Math.round(value);
}

/**
 * Fill a single uncovered pixel from the nearest nonempty set of FS-covered
 * neighbors. First inspect four cardinal pixels; next four diagonals; then
 * each Chebyshev-distance ring from radius 2 through radius 8. The nearest
 * NONEMPTY group alone contributes, with equal weight per covered pixel.
 *
 * For every attempt update searchCounts[0..9] and neighborsUsedCounts[0..64].
 * Return false if no covered neighbor exists within radius 8; the caller then
 * copies its original same-position source pixel. outputStartPixel is
 * the first global pixel in output (zero for full-image output).
 */
export function fillStfSplatHole(
  output: Uint16Array,
  pixel: number,
  width: number,
  height: number,
  weights: Float32Array,
  accum: Float32Array,
  searchCounts: number[],
  neighborsUsedCounts: number[],
  outputStartPixel = 0,
): boolean {
  const x = pixel % width;
  const y = Math.floor(pixel / width);
  let count = 0;
  let red = 0;
  let green = 0;
  let blue = 0;

  // Called only for uncovered pixels (at most 0.72% in the observed ext1-12
  // test). Use original FS accumulators, never the mutable filled output.
  const visit = (nx: number, ny: number): void => {
    if (nx < 0 || nx >= width || ny < 0 || ny >= height) return;
    const neighbor = ny * width + nx;
    const weight = weights[neighbor];
    if (!(weight > 0)) return;
    const base = neighbor * 3;
    red += clampUint16(accum[base] / weight);
    green += clampUint16(accum[base + 1] / weight);
    blue += clampUint16(accum[base + 2] / weight);
    count++;
  };

  const writeIfFound = (bucket: number): boolean => {
    if (count === 0) return false;
    // The output can be just one streamed stripe, while neighbors are read
    // from the original full-image FS accumulators and coverage weights.
    const base = (pixel - outputStartPixel) * 3;
    output[base] = clampUint16(red / count);
    output[base + 1] = clampUint16(green / count);
    output[base + 2] = clampUint16(blue / count);
    searchCounts[bucket]++;
    neighborsUsedCounts[count]++;
    return true;
  };

  // Cardinal neighbors have precedence over the diagonals even at the same
  // Chebyshev distance, preserving the behavior of the adopted FS behavior.
  visit(x, y - 1);
  visit(x - 1, y);
  visit(x + 1, y);
  visit(x, y + 1);
  if (writeIfFound(1)) return true;

  visit(x - 1, y - 1);
  visit(x + 1, y - 1);
  visit(x - 1, y + 1);
  visit(x + 1, y + 1);
  if (writeIfFound(2)) return true;

  for (let radius = 2; radius <= STF_SPLAT_HOLE_MAX_RADIUS; radius++) {
    // Top/bottom edges including corners, then left/right edges excluding
    // corners. Each ring pixel is visited at most once (8 * radius samples).
    for (let dx = -radius; dx <= radius; dx++) {
      visit(x + dx, y - radius);
      visit(x + dx, y + radius);
    }
    for (let dy = -radius + 1; dy < radius; dy++) {
      visit(x - radius, y + dy);
      visit(x + radius, y + dy);
    }
    if (writeIfFound(radius + 1)) return true;
  }

  // No suitable FS color. Preserve the caller's original source fallback.
  searchCounts[0]++;
  neighborsUsedCounts[0]++;
  return false;
}
