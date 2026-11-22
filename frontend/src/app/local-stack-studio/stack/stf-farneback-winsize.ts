/** Fixed aperture-dependent Farneback window at the capped STF Flow resolution. */
export const STF_FARNEBACK_BASE_WINSIZE = 21;
export const STF_FARNEBACK_MIN_WINSIZE = 11;

/** Defensive validation of the Flow worker protocol. */
export function isStfFarnebackWinsize(value: number): boolean {
  return Number.isSafeInteger(value) && value >= STF_FARNEBACK_MIN_WINSIZE &&
    value <= STF_FARNEBACK_BASE_WINSIZE && value % 2 === 1;
}

/** F-dependent window: the most-open real pair uses the configured base window,
 * and the remaining pairs scale with their inverse-F interval. Preserve the
 * established odd rounding, lower bound, and ordering checks.
 */
export function stfPairFarnebackWinsize(
  lowestF: number, secondLowestF: number, pairLowF: number, pairHighF: number,
): number {
  if (![lowestF, secondLowestF, pairLowF, pairHighF].every((f) => Number.isFinite(f) && f > 0) ||
      !(secondLowestF > lowestF) || !(pairHighF > pairLowF)) {
    throw new Error("STF Farneback window requires ordered positive F-number pairs.");
  }
  const referenceSpan = 1 / lowestF - 1 / secondLowestF;
  const pairSpan = 1 / pairLowF - 1 / pairHighF;
  if (!(referenceSpan > 0) || !Number.isFinite(referenceSpan) ||
      !(pairSpan > 0) || !Number.isFinite(pairSpan)) {
    throw new Error("STF Farneback window received an invalid inverse-F interval.");
  }
  const target = (STF_FARNEBACK_BASE_WINSIZE + 0.5) * pairSpan / referenceSpan;
  const bounded = Math.max(STF_FARNEBACK_MIN_WINSIZE, Math.min(STF_FARNEBACK_BASE_WINSIZE, target));
  return 2 * Math.round((bounded - 1) / 2) + 1;
}
