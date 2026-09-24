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
