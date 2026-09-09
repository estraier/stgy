import { applyHighlightLinear, applyRolloffScalar, applyScaledLogLinear, applyShadowLinear, applySigmoidLinear, applyToneLinearToRgb, rolloffParams } from "@/image/tone";
import { analysisSampleDimensions, buildRenderedPixelToSourceTransform, createRgb16SamplingScratch, decodeStoredRgb16Channel, encodeStoredRgb16Channel, getAnalysisLinearRgbSample, getRenderedLinearRgbSample, renderedPixelToSourcePoint, sampleLinearRgb16Bilinear, sampleLinearRgb16BilinearAtSource, sampleLinearRgb16BilinearAtSourceInto, sampleLinearRgb16BilinearInto, sampleLinearRgbFromRgb16RegionAtSize } from "./sampling";
import { buildColorAdjustmentContextFromLinearRgbSample, findAutoExposure, findAutoLogarithm, findAutoSigmoid, percentileFromValues, percentilesFromValues } from "./analysis";
import { renderAdjustedLinearRgbSampleToCanvas, renderAdjustedRgb16ToCanvas } from "./render";

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
  sampleLinearRgb16BilinearAtSourceInto,
  sampleLinearRgb16Bilinear,
  sampleLinearRgb16BilinearInto,
  createRgb16SamplingScratch,
  buildRenderedPixelToSourceTransform,
  analysisSampleDimensions,
  getAnalysisLinearRgbSample,
  getRenderedLinearRgbSample,
  sampleLinearRgbFromRgb16RegionAtSize,
  renderedPixelToSourcePoint,
  renderAdjustedLinearRgbSampleToCanvas,
  renderAdjustedRgb16ToCanvas,
  buildColorAdjustmentContextFromLinearRgbSample,
  percentileFromValues,
  percentilesFromValues,
  findAutoExposure,
  findAutoLogarithm,
  findAutoSigmoid,
};
