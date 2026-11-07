/** Geometry-only alignment diagnostics. No image processing or optimizer work. */
export type AffineDisplacement = {
  topLeftPx: number;
  topRightPx: number;
  bottomLeftPx: number;
  bottomRightPx: number;
  centerPx: number;
  maxCornerPx: number;
};

/** Compare two target->reference affine matrices in target-image pixel units.
 * Values are Euclidean displacement at the four corners and center. */
export function affineDisplacement(
  initial: ArrayLike<number>, final: ArrayLike<number>, width: number, height: number,
): AffineDisplacement {
  if (initial.length !== 9 || final.length !== 9 ||
      !(Number.isFinite(width) && width > 0 && Number.isFinite(height) && height > 0)) {
    throw new Error("Invalid affine displacement input.");
  }
  for (let index = 0; index < 9; index += 1) {
    if (!Number.isFinite(initial[index]) || !Number.isFinite(final[index])) {
      throw new Error("Non-finite affine matrix in displacement diagnostics.");
    }
  }
  const displacement = (x: number, y: number): number => Math.hypot(
    (final[0] - initial[0]) * x + (final[1] - initial[1]) * y + final[2] - initial[2],
    (final[3] - initial[3]) * x + (final[4] - initial[4]) * y + final[5] - initial[5],
  );
  const topLeftPx = displacement(0, 0);
  const topRightPx = displacement(width, 0);
  const bottomLeftPx = displacement(0, height);
  const bottomRightPx = displacement(width, height);
  return {
    topLeftPx, topRightPx, bottomLeftPx, bottomRightPx,
    centerPx: displacement(width / 2, height / 2),
    maxCornerPx: Math.max(topLeftPx, topRightPx, bottomLeftPx, bottomRightPx),
  };
}
