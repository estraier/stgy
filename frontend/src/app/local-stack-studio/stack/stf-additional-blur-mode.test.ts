import {
  buildStfAdditionalBlurPlan, resolveStfGateExpansionMultiplier, DEFAULT_STF_ADDITIONAL_BLUR_OPTIONS,
  STF_BLUR_STRENGTH_VALUES, STF_BLUR_AREA_GUARD_VALUES,
  STF_BLUR_RATIO_VALUES, STF_BLUR_SIGMOID_VALUES,
} from "./stf-additional-blur-mode";

describe("STF Additional Blur production option specification", () => {
  test("only the approved option values and defaults are exposed", () => {
    expect([...STF_BLUR_STRENGTH_VALUES]).toEqual([
      "none", "weak", "medium", "strong", "gate",
      "exp-sharpness-16mp", "exp-sharpness-16mp-dilated", "exp-sharpness-0.5mp",
      "exp-ratio-dilated-x1.0", "exp-ratio-dilated-x1.3", "exp-after-volume-closing",
      "exp-after-graph-cut-boost", "exp-after-sigmoid",
    ]);
    expect([...STF_BLUR_AREA_GUARD_VALUES]).toEqual(["none", "weak", "medium", "strong"]);
    expect(STF_BLUR_RATIO_VALUES).toHaveLength(17);
    expect(STF_BLUR_RATIO_VALUES[0]).toBeCloseTo(0.1);
    expect(STF_BLUR_RATIO_VALUES[16]).toBeCloseTo(0.9);
    expect(STF_BLUR_SIGMOID_VALUES).toHaveLength(21);
    expect(STF_BLUR_SIGMOID_VALUES[0]).toBe(0);
    expect(STF_BLUR_SIGMOID_VALUES[20]).toBe(100);
    expect(DEFAULT_STF_ADDITIONAL_BLUR_OPTIONS).toEqual({ strength: "none", ratio: 0.5, areaGuard: "medium", sigmoid: 75 });
  });

  test("none disables processing and gate preview uses medium expansion", () => {
    const disabled = buildStfAdditionalBlurPlan(DEFAULT_STF_ADDITIONAL_BLUR_OPTIONS);
    expect(disabled.enabled).toBe(false);
    expect(disabled.strengthMultiplier).toBeNull();
    expect(disabled.areaExponent).toBeNull();
    expect(disabled.effectiveRatio).toBeNull();

    const gate = buildStfAdditionalBlurPlan({ ...DEFAULT_STF_ADDITIONAL_BLUR_OPTIONS, strength: "gate" });
    expect(gate.enabled).toBe(true);
    expect(gate.useDilatedRatio).toBe(true);
    expect(gate.dilatedRatioExponent).toBe(1.3);
    expect(gate.gateOnly).toBe(true);
    expect(gate.strengthMultiplier).toBeNull();
    expect(resolveStfGateExpansionMultiplier(gate)).toBe(2);
    expect(() => resolveStfGateExpansionMultiplier(disabled)).toThrow();
  });

  test("experimental sharpness and raw-ratio previews bypass post-ratio processing", () => {
    for (const [strength, visualization] of [
      ["exp-sharpness-16mp", "fine"],
      ["exp-sharpness-16mp-dilated", "fine-dilated"],
      ["exp-sharpness-0.5mp", "coarse"],
      ["exp-ratio-dilated-x1.0", "ratio-dilated-x1.0"],
      ["exp-ratio-dilated-x1.3", "ratio-dilated-x1.3"],
    ] as const) {
      const plan = buildStfAdditionalBlurPlan({ strength, ratio: 0.75, areaGuard: "strong", sigmoid: 100 });
      expect(plan.enabled).toBe(true);
      expect(plan.gateOnly).toBe(false);
      expect(plan.sharpnessVisualization).toBe(visualization);
      expect(plan.areaExponent).toBeNull();
      expect(plan.effectiveRatio).toBeNull();
      expect(plan.strengthMultiplier).toBeNull();
      expect(() => resolveStfGateExpansionMultiplier(plan)).toThrow();
    }
  });

  test("raw ratio without exponent uses the same dilated fine map and P50/32 floor", () => {
    const baseline = buildStfAdditionalBlurPlan({
      ...DEFAULT_STF_ADDITIONAL_BLUR_OPTIONS, strength: "exp-ratio-dilated-x1.0",
    });
    const weighted = buildStfAdditionalBlurPlan({
      ...DEFAULT_STF_ADDITIONAL_BLUR_OPTIONS, strength: "exp-ratio-dilated-x1.3",
    });
    expect(baseline.useDilatedRatio).toBe(true);
    expect(weighted.useDilatedRatio).toBe(true);
    expect(baseline.dilatedRatioExponent).toBe(1);
    expect(weighted.dilatedRatioExponent).toBe(1.3);
    expect(baseline.sharpnessVisualization).toBe("ratio-dilated-x1.0");
    expect(baseline.strengthMultiplier).toBeNull();
    expect(baseline.effectiveRatio).toBeNull();
  });

  test("experimental post-stage previews keep the official v3 pipeline settings", () => {
    for (const preview of ["exp-after-volume-closing", "exp-after-graph-cut-boost", "exp-after-sigmoid"] as const) {
      const plan = buildStfAdditionalBlurPlan({ strength: preview, ratio: 0.65, areaGuard: "medium", sigmoid: 75 });
      expect(plan.enabled).toBe(true);
      expect(plan.useDilatedRatio).toBe(true);
      expect(plan.dilatedRatioExponent).toBe(1.3);
      expect(plan.sharpnessVisualization).toBe(
        preview === "exp-after-volume-closing" ? "after-volume-closing"
          : preview === "exp-after-graph-cut-boost" ? "after-graph-cut-boost"
            : "after-sigmoid");
      expect(plan.strengthMultiplier).toBeNull();
      expect(plan.areaExponent).toBe(0.85);
      expect(plan.effectiveRatio).toBe(0.65);
    }
  });

  test("official weak/medium/strong use the v3 dilated x1.3 ratio", () => {
    for (const [strength, multiplier] of [["weak", 1], ["medium", 2], ["strong", 3]] as const) {
      for (const [areaGuard, exponent] of [["none", null], ["weak", 0.95], ["medium", 0.85], ["strong", 0.75]] as const) {
        const plan = buildStfAdditionalBlurPlan({ strength, ratio: 0.7, areaGuard, sigmoid: 75 });
        expect(plan.enabled).toBe(true);
        expect(plan.useDilatedRatio).toBe(true);
        expect(plan.dilatedRatioExponent).toBe(1.3);
        expect(plan.sharpnessVisualization).toBeNull();
        expect(plan.strengthMultiplier).toBe(multiplier);
        expect(resolveStfGateExpansionMultiplier(plan)).toBe(multiplier);
        expect(plan.areaExponent).toBe(exponent);
        expect(plan.effectiveRatio).toBe(0.7);
      }
    }
  });

  test("ratio is inert if Graph Cut and sigmoid are both disabled", () => {
    const a = buildStfAdditionalBlurPlan({ strength: "medium", ratio: 0.1, areaGuard: "none", sigmoid: 0 });
    const b = buildStfAdditionalBlurPlan({ strength: "medium", ratio: 0.9, areaGuard: "none", sigmoid: 0 });
    expect(a.effectiveRatio).toBeNull();
    expect(b.effectiveRatio).toBeNull();
    expect(a.areaExponent).toBeNull();
    expect(a.strengthMultiplier).toBe(2);
  });

  test("invalid input fails rather than selecting an unsupported pipeline", () => {
    expect(() => buildStfAdditionalBlurPlan({ ...DEFAULT_STF_ADDITIONAL_BLUR_OPTIONS, strength: "sigma" as never })).toThrow();
    expect(() => buildStfAdditionalBlurPlan({ ...DEFAULT_STF_ADDITIONAL_BLUR_OPTIONS, ratio: 0.475 })).toThrow();
    expect(() => buildStfAdditionalBlurPlan({ ...DEFAULT_STF_ADDITIONAL_BLUR_OPTIONS, sigmoid: 74 })).toThrow();
  });
});
