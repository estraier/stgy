/** Extrapolation-only suppression of the smallest native-resolution Flow vectors.
 * P5 and P10 are measured on the *unscaled*, full Flow field. A zero-width
 * percentile interval is left untouched rather than introducing a hard edge.
 */
export type StfFlowNormGate = {
  p5: number;
  p10: number;
  p5Squared: number;
  p10Squared: number;
};

// The non-negative Float32 norms have monotonically ordered IEEE-754 bits.
// Radix selection finds the exact two order statistics in four linear passes,
// without sorting the full 4MP array or approximating its spatial distribution.
export type StfFlowNormGateTiming = { normsMs?: number; sortMs?: number };

function selectFlowNormPercentiles(norms: Float32Array): [number, number] {
  const bits = new Uint32Array(norms.buffer, norms.byteOffset, norms.length);
  let rank5 = Math.floor((norms.length - 1) * 0.05);
  let rank10 = Math.floor((norms.length - 1) * 0.10);
  let prefix5 = 0;
  let prefix10 = 0;
  const counts5 = new Uint32Array(256);
  const counts10 = new Uint32Array(256);

  const digitAtRank = (counts: Uint32Array, rank: number): [number, number] => {
    for (let digit = 0; digit < 256; digit++) {
      const count = counts[digit];
      if (rank < count) return [digit, rank];
      rank -= count;
    }
    throw new Error("STF Flow percentile selection failed.");
  };

  for (let shift = 24; shift >= 0; shift -= 8) {
    counts5.fill(0);
    counts10.fill(0);
    const knownMask = shift === 24 ? 0 : (0xffffffff << (shift + 8)) >>> 0;
    const samePrefix = prefix5 === prefix10;
    for (let index = 0; index < bits.length; index++) {
      const word = bits[index];
      const digit = (word >>> shift) & 255;
      if (((word & knownMask) >>> 0) === prefix5) counts5[digit]++;
      if (!samePrefix && ((word & knownMask) >>> 0) === prefix10) counts10[digit]++;
    }
    const [digit5, remaining5] = digitAtRank(counts5, rank5);
    const [digit10, remaining10] = digitAtRank(samePrefix ? counts5 : counts10, rank10);
    prefix5 = (prefix5 | (digit5 << shift)) >>> 0;
    prefix10 = (prefix10 | (digit10 << shift)) >>> 0;
    rank5 = remaining5;
    rank10 = remaining10;
  }
  const selected = new Uint32Array([prefix5, prefix10]);
  const floats = new Float32Array(selected.buffer);
  return [floats[0], floats[1]];
}

export function buildStfFlowNormGate(
  flow: Float32Array, timing?: StfFlowNormGateTiming,
): StfFlowNormGate | null {
  if (flow.length < 4 || flow.length % 2 !== 0) return null;
  const count = flow.length / 2;
  const normsStartedAt = performance.now();
  const norms = new Float32Array(count);
  for (let index = 0; index < count; index++) {
    const x = flow[index * 2];
    const y = flow[index * 2 + 1];
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      throw new Error("STF extrapolation Flow has a non-finite vector.");
    }
    const norm = Math.hypot(x, y);
    if (!Number.isFinite(norm)) throw new Error("STF extrapolation Flow norm is not finite.");
    norms[index] = norm;
  }
  // Compute actual image-wide percentiles, not estimates from a spatial
  // subsample, since the local low-magnitude portion may be unevenly placed.
  // Nearest-lower order statistics avoid a hard dependency on interpolation.
  if (timing) timing.normsMs = performance.now() - normsStartedAt;
  const sortStartedAt = performance.now();
  const [p5, p10] = selectFlowNormPercentiles(norms);
  // Keep the existing log field for comparable before/after measurements.
  if (timing) timing.sortMs = performance.now() - sortStartedAt;
  if (!(p10 > p5 + Math.max(1e-6, p5 * 1e-5))) return null;
  return { p5, p10, p5Squared: p5 * p5, p10Squared: p10 * p10 };
}

/** Returns 0 below P5, linearly rises to 1 at P10, and stays at 1 above P10. */
export function stfFlowNormGateFactor(x: number, y: number, gate: StfFlowNormGate): number {
  const squared = x * x + y * y;
  if (squared <= gate.p5Squared) return 0;
  if (squared >= gate.p10Squared) return 1;
  return (Math.sqrt(squared) - gate.p5) / (gate.p10 - gate.p5);
}
