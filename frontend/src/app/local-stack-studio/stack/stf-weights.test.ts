import { buildStfApertureWeights } from "./stf-weights";

function sum(values: ArrayLike<number>): number {
  let total = 0;
  for (let i = 0; i < values.length; i += 1) total += Number(values[i]);
  return total;
}

describe("STF aperture weights", () => {
  test("halves the extrapolated outer-edge luminance while preserving a linear radial profile", () => {
    const fNumbers = Array.from({ length: 7 }, (_, index) => 2 * 2 ** (index / 6));
    const weights = buildStfApertureWeights(fNumbers);
    expect(weights).not.toBeNull();
    if (!weights) return;

    const radii = fNumbers.map((fNumber) => 1 / fNumber);
    const outerRadius = radii[0] * (fNumbers[1] / fNumbers[0]);
    const oldOuterEdge = (outerRadius - radii[0]) / (outerRadius - radii[radii.length - 1]);
    const expectedOuterEdge = oldOuterEdge / 2;

    expect(sum(weights)).toBeCloseTo(1, 12);
    expect(weights[0]).toBeCloseTo(expectedOuterEdge, 12);
    expect(weights[0]).toBeCloseTo(0.098, 3);

    let cumulative = 0;
    for (let i = 0; i < weights.length; i += 1) {
      cumulative += weights[i];
      const expected = expectedOuterEdge
        + (1 - expectedOuterEdge)
          * (radii[0] - radii[i])
          / (radii[0] - radii[radii.length - 1]);
      expect(cumulative).toBeCloseTo(expected, 12);
    }
  });

  test("uses radius interval widths for arbitrary aperture spacing", () => {
    const fNumbers = [2, 2.8, 4, 5.6];
    const weights = buildStfApertureWeights(fNumbers);
    expect(weights).not.toBeNull();
    if (!weights) return;

    const radii = fNumbers.map((fNumber) => 1 / fNumber);
    const intervalRatios = [1, 2, 3].map((i) =>
      weights[i] / (radii[i - 1] - radii[i]),
    );
    expect(intervalRatios[1]).toBeCloseTo(intervalRatios[0], 12);
    expect(intervalRatios[2]).toBeCloseTo(intervalRatios[0], 12);
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
