import { buildStfApertureWeights } from "./stf-weights";

const STF_PROFILE_WEIGHT_RATIO = 2.8;
const STF_PROFILE_EXPONENT = Math.log2(STF_PROFILE_WEIGHT_RATIO);

function sum(values: ArrayLike<number>): number {
  let total = 0;
  for (let i = 0; i < values.length; i += 1) total += Number(values[i]);
  return total;
}

function profileLuminance(progress: number): number {
  return (
    STF_PROFILE_WEIGHT_RATIO
    - (2 - progress) ** STF_PROFILE_EXPONENT
  ) / (STF_PROFILE_WEIGHT_RATIO - 1);
}

function expectedOuterEdge(fNumbers: readonly number[]): number {
  const radii = fNumbers.map((fNumber) => 1 / fNumber);
  const outerRadius = radii[0] * (fNumbers[1] / fNumbers[0]);
  return (outerRadius - radii[0]) / (outerRadius - radii[radii.length - 1]) / 2;
}

describe("STF aperture weights", () => {
  test("halves the extrapolated outer-edge luminance while applying the W=2.8 radial profile", () => {
    const fNumbers = Array.from({ length: 7 }, (_, index) => 2 * 2 ** (index / 6));
    const weights = buildStfApertureWeights(fNumbers);
    expect(weights).not.toBeNull();
    if (!weights) return;

    const radii = fNumbers.map((fNumber) => 1 / fNumber);
    const outerEdge = expectedOuterEdge(fNumbers);
    const radiusSpan = radii[0] - radii[radii.length - 1];

    expect(sum(weights)).toBeCloseTo(1, 12);
    expect(weights[0]).toBeCloseTo(outerEdge, 12);
    expect(weights[0]).toBeCloseTo(0.098, 3);

    let cumulative = 0;
    for (let i = 0; i < weights.length; i += 1) {
      cumulative += weights[i];
      const progress = (radii[0] - radii[i]) / radiusSpan;
      const expected = outerEdge
        + (1 - outerEdge) * profileLuminance(progress);
      expect(cumulative).toBeCloseTo(expected, 12);
    }

    expect(weights[1]).toBeCloseTo(0.221161418186, 12);
    expect(weights[weights.length - 1]).toBeCloseTo(0.093772970448, 12);
  });

  test("keeps the minimax outer-edge correction dependent on the aperture spacing", () => {
    const expectedByCount = new Map<number, number>([
      [5, 0.137264336717],
      [7, 0.098369088238],
      [9, 0.076635518604],
    ]);

    for (const [count, expected] of expectedByCount) {
      const fNumbers = Array.from({ length: count }, (_, index) =>
        2 * 2 ** (index / (count - 1))
      );
      const weights = buildStfApertureWeights(fNumbers);
      expect(weights).not.toBeNull();
      if (!weights) continue;

      expect(weights[0]).toBeCloseTo(expected, 12);
      expect(weights[0]).toBeCloseTo(expectedOuterEdge(fNumbers), 12);
      expect(sum(weights)).toBeCloseTo(1, 12);
    }
  });

  test("uses actual radius positions for arbitrary aperture spacing", () => {
    const fNumbers = [2, 2.8, 4, 5.6];
    const weights = buildStfApertureWeights(fNumbers);
    expect(weights).not.toBeNull();
    if (!weights) return;

    const radii = fNumbers.map((fNumber) => 1 / fNumber);
    const outerEdge = expectedOuterEdge(fNumbers);
    const radiusSpan = radii[0] - radii[radii.length - 1];

    let cumulative = 0;
    for (let i = 0; i < weights.length; i += 1) {
      cumulative += weights[i];
      const progress = (radii[0] - radii[i]) / radiusSpan;
      const expected = outerEdge
        + (1 - outerEdge) * profileLuminance(progress);
      expect(cumulative).toBeCloseTo(expected, 12);
    }
    expect(sum(weights)).toBeCloseTo(1, 12);
  });

  test("maps weights back to the original image order", () => {
    const sortedFNumbers = [2, 2.8, 4, 5.6];
    const sortedWeights = buildStfApertureWeights(sortedFNumbers);
    const shuffledFNumbers = [4, 2, 5.6, 2.8];
    const shuffledWeights = buildStfApertureWeights(shuffledFNumbers);
    expect(sortedWeights).not.toBeNull();
    expect(shuffledWeights).not.toBeNull();
    if (!sortedWeights || !shuffledWeights) return;

    const expectedByFNumber = new Map(
      sortedFNumbers.map((fNumber, index) => [fNumber, sortedWeights[index]]),
    );
    for (let i = 0; i < shuffledFNumbers.length; i += 1) {
      expect(shuffledWeights[i]).toBeCloseTo(
        expectedByFNumber.get(shuffledFNumbers[i])!,
        12,
      );
    }
  });

  test("keeps one valid input at full weight", () => {
    expect(Array.from(buildStfApertureWeights([2.8]) ?? [])).toEqual([1]);
  });

  test("returns null when aperture metadata cannot define an STF bracket", () => {
    expect(buildStfApertureWeights([2, Number.NaN, 4])).toBeNull();
    expect(buildStfApertureWeights([2, 2, 4])).toBeNull();
    expect(buildStfApertureWeights([4, 4])).toBeNull();
  });
});
