/** The complete public configuration of STF additional blur. */
export const STF_BLUR_STRENGTH_VALUES = [
  "none", "weak", "medium", "strong", "gate",
  "exp-sharpness-16mp", "exp-sharpness-16mp-dilated", "exp-sharpness-0.5mp",
  "exp-ratio-dilated-x1.0", "exp-ratio-dilated-x1.3", "exp-after-volume-closing",
  "exp-after-graph-cut-boost", "exp-after-sigmoid",
] as const;
export type StfSharpnessVisualization =
  | "fine"
  | "fine-dilated"
  | "coarse"
  | "ratio-dilated-x1.0"
  | "ratio-dilated-x1.3"
  | "after-volume-closing"
  | "after-graph-cut-boost"
  | "after-sigmoid";
export function stfSharpnessVisualization(strength: StfBlurStrength): StfSharpnessVisualization | null {
  if (strength === "exp-sharpness-16mp") return "fine";
  if (strength === "exp-sharpness-16mp-dilated") return "fine-dilated";
  if (strength === "exp-sharpness-0.5mp") return "coarse";
  if (strength === "exp-ratio-dilated-x1.0") return "ratio-dilated-x1.0";
  if (strength === "exp-ratio-dilated-x1.3") return "ratio-dilated-x1.3";
  if (strength === "exp-after-volume-closing") return "after-volume-closing";
  if (strength === "exp-after-graph-cut-boost") return "after-graph-cut-boost";
  if (strength === "exp-after-sigmoid") return "after-sigmoid";
  return null;
}
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
  gateOnly: boolean;
  sharpnessVisualization: StfSharpnessVisualization | null;
  strengthMultiplier: 1 | 2 | 3 | null;
  useDilatedRatio: boolean;
  dilatedRatioExponent: 1 | 1.3 | null;
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
  const enabled = options.strength !== "none";
  const gateOnly = options.strength === "gate";
  const sharpnessVisualization = stfSharpnessVisualization(options.strength);
  const rawDiagnostic = sharpnessVisualization === "fine" || sharpnessVisualization === "fine-dilated" ||
    sharpnessVisualization === "coarse" || sharpnessVisualization === "ratio-dilated-x1.0" ||
    sharpnessVisualization === "ratio-dilated-x1.3";
  const useDilatedRatio = options.strength === "weak" || options.strength === "medium" ||
    options.strength === "strong" || options.strength === "gate" ||
    sharpnessVisualization === "ratio-dilated-x1.0" ||
    sharpnessVisualization === "ratio-dilated-x1.3" ||
    sharpnessVisualization === "after-volume-closing" ||
    sharpnessVisualization === "after-graph-cut-boost" ||
    sharpnessVisualization === "after-sigmoid";
  const dilatedRatioExponent = sharpnessVisualization === "ratio-dilated-x1.0" ? 1 : useDilatedRatio ? 1.3 : null;
  const areaExponent = !enabled || rawDiagnostic || options.areaGuard === "none" ? null
    : options.areaGuard === "weak" ? 0.95 : options.areaGuard === "medium" ? 0.85 : 0.75;
  const strengthMultiplier = !enabled || gateOnly || sharpnessVisualization !== null ? null
    : options.strength === "weak" ? 1
      : options.strength === "medium" ? 2 : 3;
  const effectiveRatio = enabled && !rawDiagnostic && (areaExponent !== null || options.sigmoid !== 0) ? options.ratio : null;
  return { ...options, enabled, gateOnly, useDilatedRatio, dilatedRatioExponent,
    sharpnessVisualization, strengthMultiplier, areaExponent, effectiveRatio };
}

/** Gate-only preview uses medium-strength dilation without performing Gaussian blur. */
export function resolveStfGateExpansionMultiplier(plan: StfAdditionalBlurPlan): 1 | 2 | 3 {
  if (!plan.enabled) throw new Error("STF gate expansion is disabled.");
  if (plan.gateOnly) return 2;
  if (plan.strengthMultiplier === null) throw new Error("STF blur strength multiplier is missing.");
  return plan.strengthMultiplier;
}
