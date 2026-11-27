/** Gate-guided middle-aperture replacement for STF Restore. */
// A fixed second sigmoid suppresses weak restoration outside the guarded subject
// while retaining strong restoration inside it. The blur gate is not modified.
export const STF_RESTORE_SIGMOID_CENTER = 0.7;
export const STF_RESTORE_SIGMOID_STEEPNESS = 20;
const restoreSigmoid = (x: number) => 1 / (1 + Math.exp(-STF_RESTORE_SIGMOID_STEEPNESS * (x - STF_RESTORE_SIGMOID_CENTER)));
const restoreSigmoidLow = restoreSigmoid(0);
const restoreSigmoidHigh = restoreSigmoid(1);

/** Fixed-endpoint sigmoid with the exact 0.7 -> 0.5 midpoint. */
export function shapeStfRestoreGateValue(value: number): number {
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new Error("STF Restore gate must be in [0,1].");
  }
  if (value === 0 || value === 1) return value;
  const sigmoid = restoreSigmoid(value);
  return value <= STF_RESTORE_SIGMOID_CENTER
    ? 0.5 * (sigmoid - restoreSigmoidLow) / (0.5 - restoreSigmoidLow)
    : 0.5 + 0.5 * (sigmoid - 0.5) / (restoreSigmoidHigh - 0.5);
}

/** Centered feather radius scales with the image diagonal; no morphological expansion. */
export function resolveStfRestoreFeatherRadius(width: number, height: number): number {
  if (!Number.isInteger(width) || width <= 0 || !Number.isInteger(height) || height <= 0) {
    throw new Error("STF Restore dimensions are invalid.");
  }
  return Math.max(1, Math.round(Math.hypot(width, height) * 0.003));
}

/**
 * Shape the blur gate with a 0.7-centered sigmoid, then feather the resulting
 * Restore alpha (not the RGB image) with a centered, separable Gaussian.
 * No dilation is applied; the original blur gate is left untouched.
 * Edge pixels are replicated to avoid weakening image borders.
 */
export function featherStfRestoreGate(
  gate: Float32Array, width: number, height: number, radius = resolveStfRestoreFeatherRadius(width, height),
): Float32Array {
  if (!Number.isInteger(width) || width <= 0 || !Number.isInteger(height) || height <= 0 ||
      gate.length !== width * height || !Number.isInteger(radius) || radius < 0) {
    throw new Error("STF Restore gate geometry is invalid.");
  }
  // Precompute the sigmoid once per pixel rather than inside every Gaussian
  // tap. Reuse this allocation as the final output to avoid a third image map.
  const result = Float32Array.from(gate, shapeStfRestoreGateValue);
  if (radius === 0) return result;
  const sigma = Math.max(0.5, radius / 2);
  const weights = new Float64Array(radius * 2 + 1);
  let sum = 0;
  for (let offset = -radius; offset <= radius; offset++) {
    const weight = Math.exp(-0.5 * (offset / sigma) ** 2);
    weights[offset + radius] = weight;
    sum += weight;
  }
  for (let i = 0; i < weights.length; i++) weights[i] /= sum;
  const horizontal = new Float32Array(gate.length);
  for (let y = 0; y < height; y++) {
    const row = y * width;
    for (let x = 0; x < width; x++) {
      let value = 0;
      for (let k = -radius; k <= radius; k++) {
        const sample = result[row + Math.max(0, Math.min(width - 1, x + k))];
        value += sample * weights[k + radius];
      }
      horizontal[row + x] = value;
    }
  }
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let value = 0;
      for (let k = -radius; k <= radius; k++) {
        value += horizontal[Math.max(0, Math.min(height - 1, y + k)) * width + x] * weights[k + radius];
      }
      result[y * width + x] = Math.max(0, Math.min(1, value));
    }
  }
  return result;
}

/** Select the real aperture closest to the geometric midpoint of the bracket. */
export function chooseStfRestoreIndex(fNumbers: readonly number[]): number {
  if (fNumbers.length === 0 || fNumbers.some((f) => !Number.isFinite(f) || !(f > 0))) {
    throw new Error("STF Restore requires valid real-image F-numbers.");
  }
  let minLog = Infinity;
  let maxLog = -Infinity;
  for (const f of fNumbers) {
    const log = Math.log(f);
    minLog = Math.min(minLog, log);
    maxLog = Math.max(maxLog, log);
  }
  const midpoint = (minLog + maxLog) / 2;
  let closest = 0;
  let closestDistance = Infinity;
  for (let i = 0; i < fNumbers.length; i++) {
    const distance = Math.abs(Math.log(fNumbers[i]) - midpoint);
    if (distance < closestDistance - 1e-12) {
      closestDistance = distance;
      closest = i;
    }
  }
  return closest;
}

/**
 * Replace pixels of a single STF source stripe in-place, using a tone-matched
 * aligned real frame and the existing post-Graph-Cut/post-sigmoid gate.
 * Any centered feathering is applied to the gate before this operation.
 */
export function blendStfRestoreStripe(
  source: Float32Array,
  reference: Float32Array,
  gate: Float32Array,
  width: number,
  startY: number,
): void {
  if (!Number.isInteger(width) || width <= 0 || !Number.isInteger(startY) || startY < 0 ||
      source.length !== reference.length || source.length % (3 * width) !== 0 ||
      (startY * width + source.length / 3) > gate.length) {
    throw new Error("STF Restore stripe geometry is invalid.");
  }
  const firstPixel = startY * width;
  for (let i = 0; i < source.length / 3; i++) {
    const guard = gate[firstPixel + i];
    if (!Number.isFinite(guard) || guard < 0 || guard > 1) {
      throw new Error("STF Restore gate must be in [0,1].");
    }
    if (guard <= 0) continue;
    const o = i * 3;
    const retained = 1 - guard;
    source[o] = source[o] * retained + reference[o] * guard;
    source[o + 1] = source[o + 1] * retained + reference[o + 1] * guard;
    source[o + 2] = source[o + 2] * retained + reference[o + 2] * guard;
  }
}
