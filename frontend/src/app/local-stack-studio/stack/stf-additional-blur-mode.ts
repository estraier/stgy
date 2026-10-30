// Raw-ratio comparisons stay independent: relative3 uses a P50/4 brightness
// floor and weighted arithmetic mean, while relative4 uses P50/8 and the same
// arithmetic mean. Selecting "none" bypasses this pipeline upstream.
export function usesStfRelative3Sharpness(visualizationMode: string | null): boolean {
  return visualizationMode === "raw-ratio-relative3";
}

// The sigmoid/dilated previews and all production blur strengths now use
// relative5: channel-wise P50/16 brightness floors and weighted RGB RMS.
export function usesStfRelative5Sharpness(visualizationMode: string | null): boolean {
  return visualizationMode === null
    || visualizationMode === "sigmoid"
    || visualizationMode === "dilated"
    || visualizationMode === "raw-ratio-relative5"
    || visualizationMode === "interpolated"
    || visualizationMode === "volume-interpolated"
    || visualizationMode === "volume-interpolated-2";
}

// Return the divisor of each RGB channel's brightness P50. The ratio epsilon
// remains P50/4 of the *coarse relative sharpness* for all these modes.
export function resolveStfRelativeBrightnessP50Divisor(visualizationMode: string | null): 4 | 8 | 16 | null {
  if (usesStfRelative5Sharpness(visualizationMode)) return 16;
  if (visualizationMode === "raw-ratio-relative4") return 8;
  return usesStfRelative3Sharpness(visualizationMode) ? 4 : null;
}

// Only relative5 and the production gate/blur paths combine the three
// brightness-normalized Sobel magnitudes using weighted RMS.
export function resolveStfRelativeCombineMode(visualizationMode: string | null): "mean" | "rms" | null {
  const divisor = resolveStfRelativeBrightnessP50Divisor(visualizationMode);
  if (divisor === null && visualizationMode !== "raw-ratio-relative" && visualizationMode !== "raw-ratio-relative2") return null;
  return usesStfRelative5Sharpness(visualizationMode) ? "rms" : "mean";
}

// The Area Closing experiment remains independent. Production sigmoid,
// dilated, and weak/medium/strong blur use Volume Closing 2 instead.
// All raw-ratio comparison modes, including the original Volume preview,
// retain their own processing paths.
export function resolveStfGateClosingMode(visualizationMode: string | null): "area" | "volume2" | null {
  if (visualizationMode === "interpolated") return "area";
  if (visualizationMode === null || visualizationMode === "sigmoid" || visualizationMode === "dilated") {
    return "volume2";
  }
  return null;
}

export function usesStfInterpolatedGate(visualizationMode: string | null): boolean {
  return resolveStfGateClosingMode(visualizationMode) !== null;
}
