import { applyHighlightLinear, applyRolloffScalar, applyScaledLogLinear, applyShadowLinear, applySigmoidLinear, applyToneLinearToRgb, rolloffParams } from "./tone";
import { analysisSampleDimensions, decodeStoredRgb16Channel, encodeStoredRgb16Channel, getAnalysisLinearRgbSample, renderedPixelToSourcePoint, sampleLinearRgb16Bilinear, sampleLinearRgb16BilinearAtSource } from "./sampling";
import { buildColorAdjustmentContextFromLinearRgbSample, findAutoExposure, findAutoLogarithm, findAutoShadow, findAutoSigmoid, percentileFromValues, percentilesFromValues } from "./analysis";
import { renderAdjustedRgb16ToCanvas } from "./render";

// Test-only characterization surface. Keep these references pointed at the production
// implementations so refactors/optimizations are checked against the frozen behavior.
export const __imageEditorCharacterization = {
  applyScaledLogLinear,
  applySigmoidLinear,
  rolloffParams,
  applyRolloffScalar,
  applyShadowLinear,
  applyHighlightLinear,
  applyToneLinearToRgb,
  decodeStoredRgb16Channel,
  encodeStoredRgb16Channel,
  sampleLinearRgb16BilinearAtSource,
  sampleLinearRgb16Bilinear,
  analysisSampleDimensions,
  getAnalysisLinearRgbSample,
  renderedPixelToSourcePoint,
  renderAdjustedRgb16ToCanvas,
  buildColorAdjustmentContextFromLinearRgbSample,
  percentileFromValues,
  percentilesFromValues,
  findAutoExposure,
  findAutoShadow,
  findAutoLogarithm,
  findAutoSigmoid,
};
