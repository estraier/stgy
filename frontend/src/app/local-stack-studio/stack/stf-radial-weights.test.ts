import { calculateStfWeights, parseStfRadialAttenuation, STF_OUTER_SHELL_APODIZATION_RATIO, type StfRadialAttenuation } from "./stf-radial-weights";

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

  test("the 0.8 trigger covers q=-1, 0, 1, 2, 3, but not q=-2 or smoothstep", () => {
    expect(STF_OUTER_SHELL_APODIZATION_RATIO).toBe(0.8);
    for (const profile of allProfiles) {
      const plan = calculateStfWeights(inputs, profile);
      const expected = plan.idealDrops[0] > 0.8 * plan.idealDrops[1] + 1e-12;
      expect(plan.outerShellApodizationApplied).toBe(expected);
      if (!expected) {
        plan.adjustedDrops.forEach((drop, i) => expect(drop).toBeCloseTo(plan.idealDrops[i], 12));
      }
    }
  });

  test("apodization solves the post-redistribution 0.8 luminance ratio analytically", () => {
    for (const q of [-1, 0, 1, 2, 3] as const) {
      const plan = calculateStfWeights(inputs, q);
      expect(plan.outerShellApodizationApplied).toBe(true);
      const idealRaw = inputs.map((sample, i) => plan.idealDrops[i] / sample.edgeDensity);
      const d0 = inputs[0].edgeDensity;
      const d1 = inputs[1].edgeDensity;
      const n = inputs.length;
      const removal = n * (plan.idealDrops[0] - 0.8 * plan.idealDrops[1]) /
        ((n - 1) * d0 + 0.8 * d1);
      expect(removal).toBeGreaterThan(0);
      expect(removal).toBeLessThan(idealRaw[0]);
      const share = removal / n;
      const expectedRaw = idealRaw.map((value, i) => value + share - (i === 0 ? removal : 0));
      const sum = expectedRaw.reduce((total, value) => total + value, 0);
      expectedRaw.forEach((value, i) => {
        expect(plan.rawWeights[i]).toBeCloseTo(value, 12);
        expect(plan.weights[i]).toBeCloseTo(value / sum, 6);
      });
      expect(plan.adjustedDrops[0] / plan.adjustedDrops[1]).toBeCloseTo(0.8, 12);
      // Uniformly distributed IMAGE weights also change the inner shells.
      expect(plan.rawWeights[6]).toBeGreaterThan(idealRaw[6]);
      expect(plan.adjustedDrops.reduce((total, value) => total + value, 0)).toBeCloseTo(1, 12);
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

  test("irregular F spacing meets the 0.8 target without blindly halving the outer weight", () => {
    const irregular = [2, 2.02, 2.10, 2.20, 2.40, 3.4, 4];
    const samples = irregular.map((radiusFNumber, image) => ({
      image, radiusFNumber, edgeDensity: radiusFNumber ** 2,
    }));
    const plan = calculateStfWeights(samples, 1);
    expect(plan.outerShellApodizationApplied).toBe(true);
    expect(plan.adjustedDrops[0] / plan.adjustedDrops[1]).toBeCloseTo(0.8, 12);
    const idealRaw = Array.from(plan.idealDrops, (drop, i) => drop / samples[i].edgeDensity);
    const removal = (idealRaw[0] - plan.rawWeights[0]) * samples.length / (samples.length - 1);
    expect(removal).toBeGreaterThan(0);
    expect(plan.rawWeights[1]).toBeCloseTo(idealRaw[1] + removal / samples.length, 12);
    expect(plan.rawWeights[6]).toBeCloseTo(idealRaw[6] + removal / samples.length, 12);
  });

  test("if densities are reversed, removal cannot exceed the available outer weight", () => {
    const samples = [
      { image: 0, radiusFNumber: 2, edgeDensity: 100 },
      { image: 1, radiusFNumber: 2.0001, edgeDensity: 0.001 },
      { image: 2, radiusFNumber: 4, edgeDensity: 0.01 },
    ];
    const plan = calculateStfWeights(samples, 1);
    expect(plan.outerShellApodizationApplied).toBe(true);
    const idealOuterWeight = plan.idealDrops[0] / samples[0].edgeDensity;
    expect(plan.rawWeights[0]).toBeCloseTo(idealOuterWeight / samples.length, 12);
    expect(plan.rawWeights.every((value) => Number.isFinite(value) && value > 0)).toBe(true);
    expect(plan.adjustedDrops.reduce((sum, value) => sum + value, 0)).toBeCloseTo(1, 12);
  });

  test("exactly 0.8 and lower leave the ideal drops unchanged", () => {
    // q=-2 geometric series has dropOuter/dropSecond = 1/g².
    const g = Math.sqrt(1 / 0.8);
    const thresholdSeries = Array.from({ length: 7 }, (_, i) => {
      const radiusFNumber = 2 * g ** i;
      return { image: i, radiusFNumber, edgeDensity: radiusFNumber ** 2 };
    });
    const boundary = calculateStfWeights(thresholdSeries, -2);
    expect(boundary.outerShellApodizationApplied).toBe(false);
    expect(boundary.adjustedDrops[0] / boundary.adjustedDrops[1]).toBeCloseTo(0.8, 12);
    const lower = calculateStfWeights(inputs, -2);
    expect(lower.outerShellApodizationApplied).toBe(false);
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
      // With an active apodization, equally redistributed image weights
      // become different luminance contributions when their densities change.
      expect(changed.adjustedDrops.every((drop) => Number.isFinite(drop) && drop > 0)).toBe(true);
      if (first.outerShellApodizationApplied) {
        expect(Array.from(changed.adjustedDrops)).not.toEqual(Array.from(second.adjustedDrops));
      } else {
        second.adjustedDrops.forEach((drop, j) => expect(changed.adjustedDrops[j]).toBeCloseTo(drop, 12));
      }
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
