export type StfExperimentMode = "stf-exp-dof" | "stf-exp-coc" | "stf-exp-blur";

const STF_EXPERIMENT_EDGE_SUPPORT_SOFTNESS = 0.01;
const STF_EXPERIMENT_SHARE_LOW = 0.55;
const STF_EXPERIMENT_SHARE_HIGH = 0.85;
const STF_EXPERIMENT_BASELINE_SHARP_LOW = 0.45;
const STF_EXPERIMENT_BASELINE_SHARP_HIGH = 0.75;
const STF_EXPERIMENT_BLUR_RADIUS_AT_1MP = 2;
const STF_EXPERIMENT_BLUR_MIN_RADIUS = 2;
const STF_EXPERIMENT_BLUR_MAX_RADIUS = 12;

export function isStfExperimentMode(mode: string): mode is StfExperimentMode {
  return mode === "stf-exp-dof" || mode === "stf-exp-coc" || mode === "stf-exp-blur";
}

export function buildStfExperimentApertureOrder(fNumbers: ArrayLike<number>): Int32Array | null {
  const entries: Array<{ index: number; fNumber: number }> = [];
  for (let index = 0; index < fNumbers.length; index += 1) {
    const fNumber = Number(fNumbers[index]);
    if (!(Number.isFinite(fNumber) && fNumber > 0)) return null;
    entries.push({ index, fNumber });
  }
  if (entries.length < 2) return null;
  entries.sort((a, b) => a.fNumber - b.fNumber || a.index - b.index);

  let distinctCount = entries.length > 0 ? 1 : 0;
  for (let index = 1; index < entries.length; index += 1) {
    if (!sameFNumber(entries[index].fNumber, entries[index - 1].fNumber)) {
      distinctCount += 1;
    }
  }
  if (distinctCount < 2) return null;
  return Int32Array.from(entries.map((entry) => entry.index));
}

export function sameFNumber(a: number, b: number): boolean {
  if (!(Number.isFinite(a) && Number.isFinite(b) && a > 0 && b > 0)) return false;
  const scale = Math.max(1, Math.abs(a), Math.abs(b));
  return Math.abs(a - b) <= scale * 1e-6;
}

export function resolveStfExperimentBlurRadius(width: number, height: number): number {
  const scale = Math.sqrt(Math.max(1, width * height) / 1_000_000);
  const radius = Math.round(STF_EXPERIMENT_BLUR_RADIUS_AT_1MP * Math.max(1, scale));
  return Math.max(STF_EXPERIMENT_BLUR_MIN_RADIUS, Math.min(STF_EXPERIMENT_BLUR_MAX_RADIUS, radius));
}

export function resolveStfExperimentHalo(width: number, height: number): number {
  return 2 + 2 * resolveStfExperimentBlurRadius(width, height);
}

export type StfExperimentResponses = {
  dof: number;
  coc: number;
  blur: number;
};

export type StfExperimentBlurTerms = {
  support: number;
  originallyUnsharpGate: number;
  rawBlur: number;
  openShare: number;
  stopShare: number;
};

export function computeStfExperimentBlurTerms(
  openRise: number,
  stopRise: number,
  openPeakSharpness: number,
  baselineSharpness = openPeakSharpness,
): StfExperimentBlurTerms {
  const safeOpen = Number.isFinite(openRise) && openRise > 0 ? openRise : 0;
  const safeStop = Number.isFinite(stopRise) && stopRise > 0 ? stopRise : 0;
  const safePeak = Number.isFinite(openPeakSharpness) && openPeakSharpness > 0 ? openPeakSharpness : 0;
  const safeBaseline = Number.isFinite(baselineSharpness) && baselineSharpness > 0 ? baselineSharpness : 0;
  const totalRise = safeOpen + safeStop;
  if (!(safePeak > 0) || !(safeOpen > 0)) {
    return {
      support: 0,
      originallyUnsharpGate: 0,
      rawBlur: 0,
      openShare: 0,
      stopShare: 0,
    };
  }

  const openShare = totalRise > 0 ? safeOpen / totalRise : 0;
  const stopShare = totalRise > 0 ? safeStop / totalRise : 0;
  // Blur support is driven only by the strongest rise toward the open side.
  // A strong DoF rise in another aperture interval must not create Blur.
  const edgeSupport = safePeak / (safePeak + STF_EXPERIMENT_EDGE_SUPPORT_SOFTNESS);
  const changeSupport = safeOpen / (safePeak + safeOpen);
  const support = clamp01(edgeSupport * changeSupport * 2);
  const originallyUnsharpGate = computeStfExperimentOriginallyUnsharpGate(safePeak, safeBaseline);
  const rawBlur = clamp01(support * originallyUnsharpGate);

  return {
    support,
    originallyUnsharpGate,
    rawBlur,
    openShare,
    stopShare,
  };
}

export function computeStfExperimentResponses(
  openRise: number,
  stopRise: number,
  peakSharpness: number,
  baselineSharpness = peakSharpness,
): StfExperimentResponses {
  const safeOpen = Number.isFinite(openRise) && openRise > 0 ? openRise : 0;
  const safeStop = Number.isFinite(stopRise) && stopRise > 0 ? stopRise : 0;
  const safePeak = Number.isFinite(peakSharpness) && peakSharpness > 0 ? peakSharpness : 0;
  const totalRise = safeOpen + safeStop;
  const dominantRise = Math.max(safeOpen, safeStop);
  let dof = 0;
  let coc = 0;
  if (safePeak > 0 && dominantRise > 0) {
    const openShare = safeOpen / totalRise;
    const stopShare = safeStop / totalRise;
    const edgeSupport = safePeak / (safePeak + STF_EXPERIMENT_EDGE_SUPPORT_SOFTNESS);
    const changeSupport = dominantRise / (safePeak + dominantRise);
    const support = clamp01(edgeSupport * changeSupport * 2);
    dof = clamp01(support * smoothstep(STF_EXPERIMENT_SHARE_LOW, STF_EXPERIMENT_SHARE_HIGH, stopShare));
    coc = clamp01(support * smoothstep(STF_EXPERIMENT_SHARE_LOW, STF_EXPERIMENT_SHARE_HIGH, openShare));
  }
  const blur = computeStfExperimentBlurTerms(
    safeOpen,
    safeStop,
    safePeak,
    baselineSharpness,
  ).rawBlur;
  return { dof, coc, blur };
}

export function computeStfExperimentOriginallyUnsharpGate(
  peakSharpness: number,
  baselineSharpness: number,
): number {
  const safePeak = Number.isFinite(peakSharpness) && peakSharpness > 0 ? peakSharpness : 0;
  const safeBaseline = Number.isFinite(baselineSharpness) && baselineSharpness > 0 ? baselineSharpness : 0;
  if (!(safePeak > 0)) return 0;
  const baselinePeakRatio = safeBaseline / (safePeak + 1e-12);
  return 1 - smoothstep(
    STF_EXPERIMENT_BASELINE_SHARP_LOW,
    STF_EXPERIMENT_BASELINE_SHARP_HIGH,
    baselinePeakRatio,
  );
}

export function clamp01(value: number): number {
  if (!(value > 0)) return 0;
  if (value >= 1) return 1;
  return value;
}

export function smoothstep(edge0: number, edge1: number, value: number): number {
  if (!(edge1 > edge0)) return value >= edge1 ? 1 : 0;
  const t = clamp01((value - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
}
