export function choosePanoramaComposeScale(options: {
  fullUnionPixels: number;
  cropRatio: number;
  maxOutputPixels: number | null;
}): number {
  const { fullUnionPixels, cropRatio, maxOutputPixels } = options;
  if (maxOutputPixels === null) return 1;
  if (
    !Number.isFinite(fullUnionPixels)
    || fullUnionPixels <= 0
    || !Number.isFinite(cropRatio)
    || cropRatio <= 0
    || !Number.isFinite(maxOutputPixels)
    || maxOutputPixels <= 0
  ) {
    return 1;
  }

  // Downscale is intentionally an approximate pre-compose memory target, not
  // a strict output-size cap. Estimate the cropped full-resolution panorama
  // from OpenCV's projected union area and the crop ratio measured from the
  // low-resolution GraphCut seam coverage. Because image area scales with the
  // square of the linear compose scale, take the square root of the pixel ratio.
  const estimatedCropPixels = fullUnionPixels * cropRatio;
  if (!Number.isFinite(estimatedCropPixels) || estimatedCropPixels <= maxOutputPixels) return 1;
  return Math.min(1, Math.max(0.01, Math.sqrt(maxOutputPixels / estimatedCropPixels)));
}
