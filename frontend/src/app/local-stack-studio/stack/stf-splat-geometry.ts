/**
 * Fixed STF opening-extrapolation priority: the adopted one-pass Compression 2.
 * Only source-to-destination displacement affects the weight, never RGB.
 * Keep this function identical to the former Compression 2 branch so the
 * production output and the existing one-pass cache remain equivalent.
 */
export function stfSplatCompressionWeight(advance: number): number {
  if (!Number.isFinite(advance) || advance < 0) return 0;
  return Math.exp(2 * Math.max(0, advance - 0.5) / (1.5 + advance * 0.1));
}
