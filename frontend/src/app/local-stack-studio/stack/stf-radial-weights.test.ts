import { calculateStfWeights, parseStfRadialAttenuation, type StfRadialAttenuation } from "./stf-radial-weights";

const allProfiles: StfRadialAttenuation[] = [
  -2, -1, 0, 1, 2, 3, "smoothstep-weak", "smoothstep-medium", "smoothstep-strong",
];
const f = Array.from({ length: 7 }, (_, i) => 2 * 2 ** (i / 6));
const inputs = f.map((radiusFNumber, image) => ({ image, radiusFNumber, edgeDensity: radiusFNumber ** 2 }));

function outerToInnerDrops(plan: ReturnType<typeof calculateStfWeights>) {
  return Array.from(plan.adjustedDrops);
}

describe("STF radial attenuation profiles", () => {
  test.each(allProfiles)("%s uses a positive nine-profile result with correct normalization", (profile) => {
    const plan = calculateStfWeights(inputs, profile);
    expect(plan.weights).toHaveLength(7);
    expect(plan.virtualZeroRadius).toBeCloseTo(2 ** (1 / 6) / 2, 12);
    expect(plan.weights.every((weight) => Number.isFinite(weight) && weight > 0)).toBe(true);
    expect(Array.from(plan.weights).reduce((sum, weight) => sum + weight, 0)).toBeCloseTo(1, 6);
    expect(outerToInnerDrops(plan).reduce((sum, drop) => sum + drop, 0)).toBeCloseTo(1, 12);
  });

  test("correct q=-2 weights are equal for a geometric series with D=F²", () => {
    const plan = calculateStfWeights(inputs, -2);
    plan.weights.forEach((weight) => expect(weight).toBeCloseTo(1 / 7, 6));
    expect(plan.outerShellApodizationApplied).toBe(false);
  });

  test("linear and quadratic/cubic profiles apodize only the first two contributions", () => {
    for (const q of [1, 2, 3] as const) {
      const plan = calculateStfWeights(inputs, q);
      expect(plan.outerShellApodizationApplied).toBe(true);
      expect(plan.adjustedDrops[0]).toBeCloseTo(plan.adjustedDrops[1], 12);
      expect(plan.adjustedDrops[0] + plan.adjustedDrops[1])
        .toBeCloseTo(plan.idealDrops[0] + plan.idealDrops[1], 12);
      for (let i = 2; i < 7; i++) expect(plan.adjustedDrops[i]).toBeCloseTo(plan.idealDrops[i], 12);
    }
  });

  test.each([
    ["smoothstep-weak", 0.10089, 0.16682],
    ["smoothstep-medium", 0.05545, 0.09239],
    ["smoothstep-strong", 0.03151, 0.05275],
  ] as const)("%s preserves its naturally dark outer shell", (profile, expectedDrop, expectedWeight) => {
    const plan = calculateStfWeights(inputs, profile);
    expect(plan.outerShellApodizationApplied).toBe(false);
    expect(plan.adjustedDrops[0]).toBeCloseTo(expectedDrop, 4);
    expect(plan.weights[0]).toBeCloseTo(expectedWeight, 4);
  });

  test("unusually close first F-values cannot cause an excessive outer drop reduction", () => {
    const irregular = [2, 2.02, 2.10, 2.20, 2.40, 3.4, 4];
    const plan = calculateStfWeights(irregular.map((radiusFNumber, image) => ({
      image, radiusFNumber, edgeDensity: radiusFNumber ** 2,
    })), 1);
    expect(plan.outerShellApodizationApplied).toBe(true);
    expect(plan.adjustedDrops[0]).toBeCloseTo(plan.adjustedDrops[1], 12);
    expect(plan.adjustedDrops[0]).toBeCloseTo(
      (plan.idealDrops[0] + plan.idealDrops[1]) / 2, 12);
  });

  test("frame order, edge densities, and profile selection remain independent", () => {
    const order = [4, 2, 6, 0, 5, 3, 1];
    const shuffled = order.map((i) => inputs[i]);
    for (const profile of allProfiles) {
      const first = calculateStfWeights(inputs, profile);
      const second = calculateStfWeights(shuffled, profile);
      order.forEach((i, j) => {
        expect(second.weights[j]).toBeCloseTo(first.weights[i], 6);
        expect(second.adjustedDrops[j]).toBeCloseTo(first.adjustedDrops[i], 12);
      });
      const differentDensity = shuffled.map((sample, i) => ({
        ...sample, edgeDensity: sample.edgeDensity * (i === 2 ? 2 : 1),
      }));
      const changed = calculateStfWeights(differentDensity, profile);
      second.adjustedDrops.forEach((drop, j) => expect(changed.adjustedDrops[j]).toBeCloseTo(drop, 12));
    }
  });

  test("supports exact UI values and rejects unknown modes", () => {
    for (const profile of allProfiles) {
      expect(parseStfRadialAttenuation(String(profile))).toBe(profile);
    }
    for (const invalid of ["", "1.1", "2junk", "4", "-3", "smoothstep", "smoothstep-stronger"]) {
      expect(parseStfRadialAttenuation(invalid)).toBeNull();
    }
    expect(() => calculateStfWeights(inputs, 4 as StfRadialAttenuation)).toThrow("Radial attenuation");
    expect(() => calculateStfWeights(inputs, "cosine" as StfRadialAttenuation)).toThrow("Radial attenuation");
    expect(() => calculateStfWeights([{ image: 0, radiusFNumber: 2, edgeDensity: 0 }], 1))
      .toThrow("edge density");
  });
});
