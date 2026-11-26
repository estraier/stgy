/** Official STF additional-blur configuration (dilated 16MP^1.3 / 0.5MP). */
export const STF_BLUR_STRENGTH_VALUES = [
  "none", "weak", "medium", "strong", "restore", "restore-weak", "restore-medium", "restore-strong", "gate",
] as const;
export const STF_BLUR_AREA_GUARD_VALUES = ["none", "weak", "medium", "strong"] as const;
export const STF_BLUR_RATIO_VALUES = Array.from({ length: 17 }, (_, i) => (10 + i * 5) / 100);
export const STF_BLUR_SIGMOID_VALUES = Array.from({ length: 21 }, (_, i) => i * 5);
export type StfBlurStrength = (typeof STF_BLUR_STRENGTH_VALUES)[number];
export type StfBlurAreaGuard = (typeof STF_BLUR_AREA_GUARD_VALUES)[number];

export type StfAdditionalBlurOptions = {
  strength: StfBlurStrength;
  ratio: number;
  areaGuard: StfBlurAreaGuard;
  sigmoid: number;
};

export type StfAdditionalBlurPlan = StfAdditionalBlurOptions & {
  enabled: boolean;
  blurEnabled: boolean;
  gateOnly: boolean;
  restoreEnabled: boolean;
  strengthMultiplier: 1 | 2 | 3 | null;
  areaExponent: number | null;
  effectiveRatio: number | null;
};

export const DEFAULT_STF_ADDITIONAL_BLUR_OPTIONS: StfAdditionalBlurOptions = {
  strength: "none", ratio: 0.5, areaGuard: "medium", sigmoid: 75,
};

export function buildStfAdditionalBlurPlan(options: StfAdditionalBlurOptions): StfAdditionalBlurPlan {
  if (!STF_BLUR_STRENGTH_VALUES.includes(options.strength) ||
      !STF_BLUR_AREA_GUARD_VALUES.includes(options.areaGuard) ||
      !STF_BLUR_RATIO_VALUES.some((v) => Math.abs(v - options.ratio) < 1e-9) ||
      !STF_BLUR_SIGMOID_VALUES.includes(options.sigmoid)) {
    throw new Error("STF Additional blur options are invalid.");
  }
  const gateOnly = options.strength === "gate";
  const restoreEnabled = options.strength === "restore" || options.strength === "restore-weak" ||
    options.strength === "restore-medium" || options.strength === "restore-strong";
  // Restore without a suffix replaces the guarded region without Gaussian blur.
  // Gate retains its existing expansion-only preview path.
  const blurEnabled = options.strength !== "none" && options.strength !== "restore";
  const enabled = blurEnabled || restoreEnabled;
  const areaExponent = !enabled || options.areaGuard === "none" ? null
    : options.areaGuard === "weak" ? 0.95 : options.areaGuard === "medium" ? 0.85 : 0.75;
  const strengthMultiplier = !blurEnabled || gateOnly ? null
    : options.strength === "weak" || options.strength === "restore-weak" ? 1
    : options.strength === "medium" || options.strength === "restore-medium" ? 2 : 3;
  // Neither Graph Cut nor sigmoid reads Blur ratio when both are disabled.
  const effectiveRatio = enabled && (areaExponent !== null || options.sigmoid !== 0) ? options.ratio : null;
  return { ...options, enabled, blurEnabled, gateOnly, restoreEnabled, strengthMultiplier, areaExponent, effectiveRatio };
}

/** Gate-only preview uses medium-strength expansion without Gaussian blur. */
export function resolveStfGateExpansionMultiplier(plan: StfAdditionalBlurPlan): 1 | 2 | 3 {
  if (!plan.enabled) throw new Error("STF gate expansion is disabled.");
  if (plan.gateOnly) return 2;
  if (plan.strengthMultiplier === null) throw new Error("STF blur strength multiplier is missing.");
  return plan.strengthMultiplier;
}
