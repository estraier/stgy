import { calculateStfWeights, parseStfRadialAttenuation, STF_OUTER_SHELL_APODIZATION_RATIO, type StfRadialAttenuation } from "./stf-radial-weights";

const allProfiles: StfRadialAttenuation[] = [
  -2, -1, 0, 1, 2, 3, "smoothstep-weak", "smoothstep-medium", "smoothstep-strong",
];
const f = Array.from({ length: 7 }, (_, i) => 2 * 2 ** (i / 6));
const inputs = f.map((radiusFNumber, image) => ({ image, radiusFNumber, edgeDensity: radiusFNumber ** 2 }));

function expectedOuterStep(profile: StfRadialAttenuation): number {
  if (typeof profile !== "number") return 0.8;
  return profile <= 0 ? 0.8 : 0.8 - 0.1 * profile;
}

describe("STF radial attenuation profiles", () => {
  test.each(allProfiles)("%s uses a positive nine-profile result with correct normalization", (profile) => {
    const plan = calculateStfWeights(inputs, profile);
    const minRadius = 1 / f[f.length - 1];
    const maxRadius = 1 / f[0];
    const logStep = Math.log(maxRadius / minRadius) / (f.length - 1);
    expect(plan.weights).toHaveLength(7);
    expect(plan.virtualZeroRadius).toBeCloseTo(maxRadius * Math.exp(logStep * expectedOuterStep(profile)), 12);
    expect(plan.weights.every((weight) => Number.isFinite(weight) && weight > 0)).toBe(true);
    expect(Array.from(plan.weights).reduce((sum, weight) => sum + weight, 0)).toBeCloseTo(1, 6);
    expect(Array.from(plan.adjustedDrops).reduce((sum, drop) => sum + drop, 0)).toBeCloseTo(1, 12);
    plan.adjustedDrops.forEach((drop, i) => expect(drop).toBeCloseTo(plan.idealDrops[i], 12));
    expect(plan.outerShellApodizationApplied).toBe(false);
  });

  test("the legacy 0.8 export is now the default virtual-zero outer step", () => {
    expect(STF_OUTER_SHELL_APODIZATION_RATIO).toBe(0.8);
    expect(calculateStfWeights(inputs, -1).virtualZeroRadius)
      .toBeCloseTo(calculateStfWeights(inputs, "smoothstep-strong").virtualZeroRadius, 12);
  });

  test("positive Power profiles progressively move the virtual zero inward", () => {
    const linear = calculateStfWeights(inputs, 1);
    const quadratic = calculateStfWeights(inputs, 2);
    const cubic = calculateStfWeights(inputs, 3);
    expect(linear.virtualZeroRadius).toBeGreaterThan(quadratic.virtualZeroRadius);
    expect(quadratic.virtualZeroRadius).toBeGreaterThan(cubic.virtualZeroRadius);
    expect(linear.adjustedDrops[0]).toBeLessThan(quadratic.adjustedDrops[0]);
    expect(quadratic.adjustedDrops[0]).toBeLessThan(cubic.adjustedDrops[0]);
  });

  test("non-positive Power and S-curve profiles keep the 0.8-step boundary", () => {
    const qNeg2 = calculateStfWeights(inputs, -2);
    const qNeg1 = calculateStfWeights(inputs, -1);
    const qZero = calculateStfWeights(inputs, 0);
    const sWeak = calculateStfWeights(inputs, "smoothstep-weak");
    const sMedium = calculateStfWeights(inputs, "smoothstep-medium");
    const sStrong = calculateStfWeights(inputs, "smoothstep-strong");
    expect(qNeg2.virtualZeroRadius).toBeCloseTo(qNeg1.virtualZeroRadius, 12);
    expect(qNeg1.virtualZeroRadius).toBeCloseTo(qZero.virtualZeroRadius, 12);
    expect(sWeak.virtualZeroRadius).toBeCloseTo(sMedium.virtualZeroRadius, 12);
    expect(sMedium.virtualZeroRadius).toBeCloseTo(sStrong.virtualZeroRadius, 12);
    expect(sStrong.virtualZeroRadius).toBeCloseTo(qZero.virtualZeroRadius, 12);
  });

  test("edge-density changes affect weights but preserve the normalized radial luminance target", () => {
    const profile = 1;
    const first = calculateStfWeights(inputs, profile);
    const changedInputs = inputs.map((sample, i) => ({
      ...sample, edgeDensity: sample.edgeDensity * (i === 2 ? 2 : 1),
    }));
    const second = calculateStfWeights(changedInputs, profile);
    expect(Array.from(second.weights)).not.toEqual(Array.from(first.weights));
    second.adjustedDrops.forEach((drop, i) => expect(drop).toBeCloseTo(first.adjustedDrops[i], 12));
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
