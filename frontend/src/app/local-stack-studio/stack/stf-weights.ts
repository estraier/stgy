const STF_OUTER_EDGE_LUMINANCE_SCALE = 0.5;

/**
 * Builds STF blend weights from aperture-derived circle-of-confusion radii.
 *
 * Radius is proportional to 1 / F. The interior weights are the discrete
 * differences of a linear radial luminance profile. The widest-aperture edge
 * luminance is based on one extrapolated aperture step and then halved to
 * soften the remaining outer discontinuity.
 *
 * Returns null when the aperture sequence cannot define that profile, so the
 * caller can preserve the historical uniform-weight fallback.
 */
export function buildStfApertureWeights(fNumbers: readonly number[]): Float64Array | null {
  const imageCount = fNumbers.length;
  if (imageCount === 0) return null;
  if (imageCount === 1) {
    return Number.isFinite(fNumbers[0]) && fNumbers[0] > 0
      ? new Float64Array([1])
      : null;
  }

  const apertures = fNumbers.map((fNumber, index) => ({
    index,
    fNumber,
    radius: 1 / fNumber,
  }));
  if (apertures.some((entry) => !(Number.isFinite(entry.fNumber) && entry.fNumber > 0))) {
    return null;
  }

  apertures.sort((left, right) => left.fNumber - right.fNumber);
  for (let i = 1; i < apertures.length; i += 1) {
    if (!(apertures[i].fNumber > apertures[i - 1].fNumber)) return null;
  }

  const widest = apertures[0];
  const secondWidest = apertures[1];
  const narrowest = apertures[apertures.length - 1];
  const radiusSpan = widest.radius - narrowest.radius;
  if (!(Number.isFinite(radiusSpan) && radiusSpan > 0)) return null;

  // Continue the first aperture ratio one step beyond the widest aperture.
  const outerRadius = widest.radius * (secondWidest.fNumber / widest.fNumber);
  const outerSpan = outerRadius - narrowest.radius;
  const oldOuterEdgeLuminance = (outerRadius - widest.radius) / outerSpan;
  if (
    !(
      Number.isFinite(oldOuterEdgeLuminance)
      && oldOuterEdgeLuminance > 0
      && oldOuterEdgeLuminance < 1
    )
  ) {
    return null;
  }

  const outerEdgeLuminance = oldOuterEdgeLuminance * STF_OUTER_EDGE_LUMINANCE_SCALE;
  const sortedWeights = new Float64Array(imageCount);
  sortedWeights[0] = outerEdgeLuminance;

  const interiorScale = (1 - outerEdgeLuminance) / radiusSpan;
  for (let i = 1; i < apertures.length; i += 1) {
    const radiusStep = apertures[i - 1].radius - apertures[i].radius;
    if (!(Number.isFinite(radiusStep) && radiusStep > 0)) return null;
    sortedWeights[i] = radiusStep * interiorScale;
  }

  let totalWeight = 0;
  for (const weight of sortedWeights) totalWeight += weight;
  if (!(Number.isFinite(totalWeight) && totalWeight > 0)) return null;

  const weights = new Float64Array(imageCount);
  for (let i = 0; i < apertures.length; i += 1) {
    weights[apertures[i].index] = sortedWeights[i] / totalWeight;
  }
  return weights;
}
