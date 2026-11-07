import { composeOrbResidual, orbCornerCorrection, orbResidualCandidates, scaleOrbAffine } from "./progressive-orb-matching";

const transform = (m: ArrayLike<number>, x: number, y: number) => [
  m[0] * x + m[1] * y + m[2],
  m[3] * x + m[4] * y + m[5],
];

describe("ECC affine + ORB residual", () => {
  test("applies similarity after six-DOF ECC without discarding shear", () => {
    const ecc = new Float64Array([1.012, 0.023, 7, -0.019, 0.997, -5, 0, 0, 1]);
    const similarity = new Float64Array([1.0002, -0.0007, 0.7, 0.0007, 1.0002, -1.1, 0, 0, 1]);
    const final = composeOrbResidual(ecc, similarity);
    for (const [x, y] of [[0, 0], [124, 251], [3265, 2448]]) {
      const [qx, qy] = transform(ecc, x, y);
      const [expectedX, expectedY] = transform(similarity, qx, qy);
      const [actualX, actualY] = transform(final, x, y);
      expect(actualX).toBeCloseTo(expectedX, 9);
      expect(actualY).toBeCloseTo(expectedY, 9);
    }
    expect(final[1]).not.toBeCloseTo(-final[3], 5); // not reduced to a similarity
  });

  test("warps only estimation source points and retains reference matches", () => {
    const initial = new Float64Array([1.01, 0.02, 3, -0.03, 1, -4, 0, 0, 1]);
    const candidates = [{ targetX: 50, targetY: 30, referenceX: 57, referenceY: 23, distance: 12 }];
    const warped = orbResidualCandidates(initial, candidates);
    expect(warped[0].targetX).toBeCloseTo(54.1, 9);
    expect(warped[0].targetY).toBeCloseTo(24.5, 9);
    expect(warped[0].referenceX).toBe(57);
    expect(candidates[0].targetX).toBe(50);
  });

  test("refinement correction is measured in 8MP pixels and scales back to 1MP", () => {
    const ecc = new Float64Array([1.01, 0.02, 2, -0.015, 0.995, -1, 0, 0, 1]);
    const high = scaleOrbAffine(ecc, 1000, 750, 3200, 2400);
    const finalHigh = composeOrbResidual(high, new Float64Array([1, 0, 3, 0, 1, -4, 0, 0, 1]));
    expect(orbCornerCorrection(high, finalHigh, 3200, 2400)).toBeCloseTo(5, 9);
    const low = scaleOrbAffine(finalHigh, 3200, 2400, 1000, 750);
    expect(low[2]).toBeCloseTo(ecc[2] + 3 / 3.2, 9);
    expect(low[5]).toBeCloseTo(ecc[5] - 4 / 3.2, 9);
    expect(low[1]).toBeCloseTo(ecc[1], 9);
  });
});
