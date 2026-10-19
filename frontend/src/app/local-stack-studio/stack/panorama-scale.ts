const MEGAPIXEL = 1_000_000;

export function estimatePanoramaCompositingResolutionMpx(options: {
  probeCompositingResolutionMpx: number;
  probeOutputPixels: number;
  referenceInputPixels: number;
  maxOutputPixels: number;
}): number {
  const {
    probeCompositingResolutionMpx,
    probeOutputPixels,
    referenceInputPixels,
    maxOutputPixels,
  } = options;
  if (
    !Number.isFinite(probeCompositingResolutionMpx)
    || probeCompositingResolutionMpx <= 0
    || !Number.isFinite(probeOutputPixels)
    || probeOutputPixels <= 0
    || !Number.isFinite(referenceInputPixels)
    || referenceInputPixels <= 0
    || !Number.isFinite(maxOutputPixels)
    || maxOutputPixels <= 0
  ) {
    return -1;
  }

  // OpenCV's compositingResol is expressed as megapixels of the reference
  // source image. If the requested probe resolution is larger than that image,
  // the effective probe is simply full-size. The returned resolution is an
  // estimate used to reduce Stitcher's memory use; the final cropped panorama
  // is intentionally not resized again just to enforce the requested pixel
  // count exactly.
  const referenceInputMpx = referenceInputPixels / MEGAPIXEL;
  const effectiveProbeMpx = Math.min(
    referenceInputMpx,
    probeCompositingResolutionMpx,
  );
  const estimatedFullOutputPixels = probeOutputPixels
    * (referenceInputMpx / effectiveProbeMpx);
  if (maxOutputPixels >= estimatedFullOutputPixels) return -1;

  return effectiveProbeMpx * (maxOutputPixels / probeOutputPixels);
}
