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

// Float32Array sorts numerically. Only the two low-end order statistics are
// needed, but a native typed-array sort is measurably faster than a JS-level
// quickselect here and avoids assumptions about the distribution shape.
export function buildStfFlowNormGate(flow: Float32Array): StfFlowNormGate | null {
  if (flow.length < 4 || flow.length % 2 !== 0) return null;
  const count = flow.length / 2;
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
  norms.sort();
  const p5 = norms[Math.floor((count - 1) * 0.05)];
  const p10 = norms[Math.floor((count - 1) * 0.10)];
  if (!(p10 > p5 + Math.max(1e-6, p5 * 1e-5))) return null;
  return { p5, p10, p5Squared: p5 * p5, p10Squared: p10 * p10 };
}

/** Returns 0 below P5, a cubic Smoothstep from P5 to P10, and 1 above P10. */
export function stfFlowNormGateFactor(x: number, y: number, gate: StfFlowNormGate): number {
  const squared = x * x + y * y;
  if (squared <= gate.p5Squared) return 0;
  if (squared >= gate.p10Squared) return 1;
  const t = (Math.sqrt(squared) - gate.p5) / (gate.p10 - gate.p5);
  return t * t * (3 - 2 * t);
}
