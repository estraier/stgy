/**
 * Endpoint-normalized sigmoid on the unit interval.
 *
 * Neither the input's origin nor any particular interior value is special.
 * The caller chooses a threshold and slope; the transform always maps
 * 0 exactly to 0 and 1 exactly to 1.
 */
export type UnitScaledSigmoid = {
  threshold: number;
  slope: number;
  low: number;
  inverseRange: number;
};

function logistic(x: number): number {
  return x >= 0
    ? 1 / (1 + Math.exp(-x))
    : Math.exp(x) / (1 + Math.exp(x));
}

export function createUnitScaledSigmoid(threshold: number, scale: number, strength: number): UnitScaledSigmoid {
  if (!Number.isFinite(threshold) || threshold < 0 || threshold > 1 ||
      !Number.isFinite(scale) || !(scale > 0) ||
      !Number.isFinite(strength) || !(strength > 0)) {
    throw new Error("Unit scaled sigmoid parameters are invalid.");
  }
  const slope = strength / scale;
  const low = logistic(-slope * threshold);
  const high = logistic(slope * (1 - threshold));
  const range = high - low;
  if (!(range > 0) || !Number.isFinite(range)) {
    throw new Error("Unit scaled sigmoid has a degenerate output range.");
  }
  return { threshold, slope, low, inverseRange: 1 / range };
}

export function applyUnitScaledSigmoid(value: number, plan: UnitScaledSigmoid): number {
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new Error("Unit scaled sigmoid input must be in [0,1].");
  }
  if (value === 0) return 0;
  if (value === 1) return 1;
  const normalized = (logistic(plan.slope * (value - plan.threshold)) - plan.low) * plan.inverseRange;
  return Math.min(1, Math.max(0, normalized));
}
