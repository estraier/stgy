import {
  buildStfAdditionalBlurPlan, resolveStfGateExpansionMultiplier, DEFAULT_STF_ADDITIONAL_BLUR_OPTIONS,
  STF_BLUR_STRENGTH_VALUES, STF_BLUR_AREA_GUARD_VALUES,
  STF_BLUR_RATIO_VALUES, STF_BLUR_SIGMOID_VALUES,
} from "./stf-additional-blur-mode";

describe("STF Additional Blur production option specification", () => {
  test("only official values and defaults are exposed", () => {
    expect([...STF_BLUR_STRENGTH_VALUES]).toEqual([
      "none", "weak", "medium", "strong", "restore", "restore-weak", "restore-medium", "restore-strong", "gate", "gate-restore",
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

  test("none disables processing; gate is medium-strength expanded mask without Gaussian blur", () => {
    const disabled = buildStfAdditionalBlurPlan(DEFAULT_STF_ADDITIONAL_BLUR_OPTIONS);
    expect(disabled.enabled).toBe(false);
    expect(disabled.strengthMultiplier).toBeNull();
    expect(disabled.areaExponent).toBeNull();
    expect(disabled.effectiveRatio).toBeNull();
    const gate = buildStfAdditionalBlurPlan({ ...DEFAULT_STF_ADDITIONAL_BLUR_OPTIONS, strength: "gate" });
    expect(gate.enabled).toBe(true);
    expect(gate.gateOnly).toBe(true);
    expect(gate.strengthMultiplier).toBeNull();
    expect(gate.areaExponent).toBe(0.85);
    expect(gate.effectiveRatio).toBe(0.5);
    expect(resolveStfGateExpansionMultiplier(gate)).toBe(2);
    expect(() => resolveStfGateExpansionMultiplier(disabled)).toThrow();
  });

  test("Gate (R) previews the Restore gate with no source or blur expansion", () => {
    const gateR = buildStfAdditionalBlurPlan({ ...DEFAULT_STF_ADDITIONAL_BLUR_OPTIONS, strength: "gate-restore" });
    expect(gateR.enabled).toBe(true);
    expect(gateR.gateOnly).toBe(true);
    expect(gateR.restoreGateOnly).toBe(true);
    expect(gateR.restoreEnabled).toBe(false);
    expect(gateR.blurEnabled).toBe(false);
    expect(gateR.strengthMultiplier).toBeNull();
    expect(gateR.areaExponent).toBe(0.85);
    expect(gateR.effectiveRatio).toBe(0.5);
    expect(() => resolveStfGateExpansionMultiplier(gateR)).toThrow();
    const gateB = buildStfAdditionalBlurPlan({ ...DEFAULT_STF_ADDITIONAL_BLUR_OPTIONS, strength: "gate" });
    expect(gateB.restoreGateOnly).toBe(false);
    expect(gateB.blurEnabled).toBe(true);
  });

  test("official weak/medium/strong have unchanged radius multipliers and Graph Cut guards", () => {
    for (const [strength, multiplier] of [["weak", 1], ["medium", 2], ["strong", 3]] as const) {
      for (const [areaGuard, exponent] of [["none", null], ["weak", 0.95], ["medium", 0.85], ["strong", 0.75]] as const) {
        const plan = buildStfAdditionalBlurPlan({ strength, ratio: 0.7, areaGuard, sigmoid: 75 });
        expect(plan.enabled).toBe(true);
        expect(plan.gateOnly).toBe(false);
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

  test("Restore only keeps the protected-region replacement but skips Gaussian blur and expansion", () => {
    const restore = buildStfAdditionalBlurPlan({ ...DEFAULT_STF_ADDITIONAL_BLUR_OPTIONS, strength: "restore" });
    expect(restore.enabled).toBe(true);
    expect(restore.blurEnabled).toBe(false);
    expect(restore.gateOnly).toBe(false);
    expect(restore.restoreEnabled).toBe(true);
    expect(restore.strengthMultiplier).toBeNull();
    expect(restore.areaExponent).toBe(0.85);
    expect(restore.effectiveRatio).toBe(0.5);
    expect(() => resolveStfGateExpansionMultiplier(restore)).toThrow();
  });

  test("rejects obsolete experimental mode values", () => {
    expect(STF_BLUR_STRENGTH_VALUES.some((value) => value === ("legacy-restore" as string))).toBe(false);
    expect(() => buildStfAdditionalBlurPlan({
      ...DEFAULT_STF_ADDITIONAL_BLUR_OPTIONS, strength: "legacy-restore" as never,
    })).toThrow();
  });

  test("Restore+W/M/S retain the restoration gate and use the corresponding blur strength", () => {
    for (const [restoreStrength, blurStrength, multiplier] of [
      ["restore-weak", "weak", 1],
      ["restore-medium", "medium", 2],
      ["restore-strong", "strong", 3],
    ] as const) {
      for (const areaGuard of STF_BLUR_AREA_GUARD_VALUES) {
        for (const sigmoid of [0, 75, 100]) {
          const settings = { ...DEFAULT_STF_ADDITIONAL_BLUR_OPTIONS, areaGuard, sigmoid, ratio: 0.7 };
          const regular = buildStfAdditionalBlurPlan({ ...settings, strength: blurStrength });
          const restore = buildStfAdditionalBlurPlan({ ...settings, strength: restoreStrength });
          expect(restore.enabled).toBe(true);
          expect(restore.blurEnabled).toBe(true);
          expect(restore.gateOnly).toBe(false);
          expect(restore.restoreEnabled).toBe(true);
          expect(regular.restoreEnabled).toBe(false);
          expect(restore.strengthMultiplier).toBe(multiplier);
          expect(restore.strengthMultiplier).toBe(regular.strengthMultiplier);
          expect(restore.areaExponent).toBe(regular.areaExponent);
          expect(restore.effectiveRatio).toBe(regular.effectiveRatio);
          expect(resolveStfGateExpansionMultiplier(restore)).toBe(multiplier);
        }
      }
    }
  });

  test("Restore without blur still honors disabled guard and sigmoid settings", () => {
    const a = buildStfAdditionalBlurPlan({ strength: "restore", ratio: 0.1, areaGuard: "none", sigmoid: 0 });
    const b = buildStfAdditionalBlurPlan({ strength: "restore", ratio: 0.9, areaGuard: "none", sigmoid: 0 });
    expect(a.enabled).toBe(true);
    expect(b.enabled).toBe(true);
    expect(a.restoreEnabled).toBe(true);
    expect(a.blurEnabled).toBe(false);
    expect(a.areaExponent).toBeNull();
    expect(a.effectiveRatio).toBeNull();
    expect(b.effectiveRatio).toBeNull();
  });

  test("unsupported or invalid options are rejected", () => {
    expect(() => buildStfAdditionalBlurPlan({ ...DEFAULT_STF_ADDITIONAL_BLUR_OPTIONS, strength: "invalid" as never })).toThrow();
    expect(() => buildStfAdditionalBlurPlan({ ...DEFAULT_STF_ADDITIONAL_BLUR_OPTIONS, ratio: 0.475 })).toThrow();
    expect(() => buildStfAdditionalBlurPlan({ ...DEFAULT_STF_ADDITIONAL_BLUR_OPTIONS, sigmoid: 74 })).toThrow();
  });
});
