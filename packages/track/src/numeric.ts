export type FiniteNumberRange = {
  min: number;
  max: number;
};

export function getFiniteNumberRange(
  values: Iterable<number>,
): FiniteNumberRange | undefined {
  let min = Infinity;
  let max = -Infinity;
  let found = false;

  for (const value of values) {
    if (!Number.isFinite(value)) {
      continue;
    }

    found = true;
    if (value < min) {
      min = value;
    }
    if (value > max) {
      max = value;
    }
  }

  return found ? { min, max } : undefined;
}
