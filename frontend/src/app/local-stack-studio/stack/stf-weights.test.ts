import { buildStfApertureWeights } from "./stf-weights";

const STF_PROFILE_WEIGHT_RATIO = 2.8;

function sum(values: ArrayLike<number>): number {
  let total = 0;
  for (let i = 0; i < values.length; i += 1) total += Number(values[i]);
  return total;
}

function computeProfile(progress: number): number {
  if (Math.abs(STF_PROFILE_WEIGHT_RATIO - 1) < 1e-12) {
    return 1 - Math.log2(2 - progress);
  }
  const exponent = Math.log2(STF_PROFILE_WEIGHT_RATIO);
  return (
    STF_PROFILE_WEIGHT_RATIO - (2 - progress) ** exponent
  ) / (STF_PROFILE_WEIGHT_RATIO - 1);
}

describe("STF aperture weights", () => {
  test("uses the W=2.8 profile with a minimax outer edge for a 7-shot 1/3EV bracket", () => {
    const fNumbers = Array.from({ length: 7 }, (_, index) => 2 * 2 ** (index / 6));
    const weights = buildStfApertureWeights(fNumbers);
    expect(weights).not.toBeNull();
    if (!weights) return;

    expect(sum(weights)).toBeCloseTo(1, 12);

    const expected = [
      0.19697446472254565,
      0.19697446472254565,
      0.16591421263889206,
      0.13975174901151888,
      0.11771475777235736,
      0.09915270682059697,
      0.08351764431154343,
    ];
    for (let i = 0; i < expected.length; i += 1) {
      expect(weights[i]).toBeCloseTo(expected[i], 12);
    }

    const radii = fNumbers.map((fNumber) => 1 / fNumber);
    const radiusSpan = radii[0] - radii[radii.length - 1];
    const profileValues = radii.map((radius) =>
      computeProfile((radii[0] - radius) / radiusSpan),
    );
    const profileSteps = profileValues.slice(1).map((value, index) => value - profileValues[index]);
    const maxInteriorStep = Math.max(...profileSteps);
    const expectedOuterEdge = maxInteriorStep / (1 + maxInteriorStep);

    expect(weights[0]).toBeCloseTo(expectedOuterEdge, 12);
    expect(weights[1]).toBeCloseTo(expectedOuterEdge, 12);

    for (let i = 1; i < weights.length; i += 1) {
      expect(weights[i]).toBeCloseTo((1 - expectedOuterEdge) * profileSteps[i - 1], 12);
    }
  });

  test("balances the outermost drop against the largest interior step for arbitrary aperture spacing", () => {
    const fNumbers = [2, 2.8, 4, 5.6];
    const weights = buildStfApertureWeights(fNumbers);
    expect(weights).not.toBeNull();
    if (!weights) return;

    expect(sum(weights)).toBeCloseTo(1, 12);

    const radii = fNumbers.map((fNumber) => 1 / fNumber);
    const radiusSpan = radii[0] - radii[radii.length - 1];
    const profileValues = radii.map((radius) =>
      computeProfile((radii[0] - radius) / radiusSpan),
    );
    const profileSteps = profileValues.slice(1).map((value, index) => value - profileValues[index]);
    const maxInteriorStep = Math.max(...profileSteps);
    const expectedOuterEdge = maxInteriorStep / (1 + maxInteriorStep);

    expect(weights[0]).toBeCloseTo(expectedOuterEdge, 12);
    const interiorSteps = weights.slice(1).map((weight) => weight / (1 - expectedOuterEdge));
    for (let i = 0; i < interiorSteps.length; i += 1) {
      expect(interiorSteps[i]).toBeCloseTo(profileSteps[i], 12);
    }

    expect(Math.max(...weights.slice(1))).toBeCloseTo(weights[0], 12);
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
