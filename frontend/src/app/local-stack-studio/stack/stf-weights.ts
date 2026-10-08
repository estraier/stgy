const STF_OUTER_EDGE_LUMINANCE_SCALE = 0.5;
const STF_PROFILE_WEIGHT_RATIO = 4.0;
const STF_PROFILE_EXPONENT = Math.log2(STF_PROFILE_WEIGHT_RATIO);

function stfProfileLuminance(progress: number): number {
  return (
    STF_PROFILE_WEIGHT_RATIO
    - (2 - progress) ** STF_PROFILE_EXPONENT
  ) / (STF_PROFILE_WEIGHT_RATIO - 1);
}

/**
 * Builds STF blend weights from aperture-derived circle-of-confusion radii.
 *
 * Radius is proportional to 1 / F. The interior weights are the discrete
 * differences of the W=4 radial luminance profile; W=2 is exactly linear,
 * while W=4 gives the fuller profile preferred by the STF model.
 * The widest-aperture edge luminance is based on one extrapolated aperture
 * step and then halved to soften the remaining outer discontinuity.
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

  let previousCumulative = outerEdgeLuminance;
  for (let i = 1; i < apertures.length; i += 1) {
    const radiusStep = apertures[i - 1].radius - apertures[i].radius;
    if (!(Number.isFinite(radiusStep) && radiusStep > 0)) return null;

    const progress = (widest.radius - apertures[i].radius) / radiusSpan;
    const profileLuminance = stfProfileLuminance(progress);
    if (!(Number.isFinite(profileLuminance) && profileLuminance > 0 && profileLuminance <= 1)) {
      return null;
    }

    const cumulative = outerEdgeLuminance
      + (1 - outerEdgeLuminance) * profileLuminance;
    const weight = cumulative - previousCumulative;
    if (!(Number.isFinite(weight) && weight > 0)) return null;
    sortedWeights[i] = weight;
    previousCumulative = cumulative;
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
