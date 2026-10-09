export const DEFAULT_STF_BLEND_WEIGHT = 2.8;

/**
 * Builds STF blend weights from aperture-derived circle-of-confusion radii.
 *
 * Radius is proportional to 1 / F. The interior weights follow a W-shaped
 * radial-luminance profile whose W=2 case is linear and whose larger W values
 * become more "full" in the middle. The widest-aperture outer-edge luminance
 * is then chosen by a minimax rule: it is set so that the final outermost drop
 * to zero equals the largest remaining interior step. This keeps the largest
 * discontinuity as small as possible for the chosen profile.
 *
 * Returns null when the aperture sequence cannot define that profile, so the
 * caller can preserve the historical uniform-weight fallback.
 */
export function buildStfApertureWeights(
  fNumbers: readonly number[],
  blendWeight = DEFAULT_STF_BLEND_WEIGHT,
): Float64Array | null {
  const fail = (): null => null;

  const imageCount = fNumbers.length;
  if (imageCount === 0) return fail();
  if (imageCount === 1) {
    if (!(Number.isFinite(fNumbers[0]) && fNumbers[0] > 0)) return fail();
    return new Float64Array([1]);
  }

  const apertures = fNumbers.map((fNumber, index) => ({
    index,
    fNumber,
    radius: 1 / fNumber,
  }));
  if (apertures.some((entry) => !(Number.isFinite(entry.fNumber) && entry.fNumber > 0))) {
    return fail();
  }

  apertures.sort((left, right) => left.fNumber - right.fNumber);
  for (let i = 1; i < apertures.length; i += 1) {
    if (!(apertures[i].fNumber > apertures[i - 1].fNumber)) return fail();
  }

  const widest = apertures[0];
  const narrowest = apertures[apertures.length - 1];
  const radiusSpan = widest.radius - narrowest.radius;
  if (!(Number.isFinite(radiusSpan) && radiusSpan > 0)) return fail();

  if (!(Number.isFinite(blendWeight) && blendWeight >= 1)) return fail();
  const profileExponent = Math.log2(blendWeight);
  if (!(Number.isFinite(profileExponent) && profileExponent >= 0)) return fail();

  const sortedProgresses = new Float64Array(imageCount);
  const sortedProfile = new Float64Array(imageCount);
  sortedProgresses[0] = 0;
  sortedProfile[0] = 0;

  const computeProfile = (progress: number): number => {
    if (!(Number.isFinite(progress) && progress >= 0 && progress <= 1)) return Number.NaN;
    if (Math.abs(blendWeight - 1) < 1e-12) {
      const base = 2 - progress;
      return 1 - Math.log2(base);
    }
    return (
      blendWeight
      - (2 - progress) ** profileExponent
    ) / (blendWeight - 1);
  };

  let maxInteriorStep = 0;
  for (let i = 1; i < apertures.length; i += 1) {
    const progress = (widest.radius - apertures[i].radius) / radiusSpan;
    if (!(Number.isFinite(progress) && progress > sortedProgresses[i - 1] && progress <= 1)) {
      return fail();
    }
    const profileValue = computeProfile(progress);
    if (!(Number.isFinite(profileValue) && profileValue > sortedProfile[i - 1] && profileValue <= 1)) {
      return fail();
    }
    const profileStep = profileValue - sortedProfile[i - 1];
    if (!(Number.isFinite(profileStep) && profileStep > 0)) return fail();
    if (profileStep > maxInteriorStep) maxInteriorStep = profileStep;
    sortedProgresses[i] = progress;
    sortedProfile[i] = profileValue;
  }

  if (!(Number.isFinite(maxInteriorStep) && maxInteriorStep > 0)) return fail();

  const outerEdgeLuminance = maxInteriorStep / (1 + maxInteriorStep);
  if (!(Number.isFinite(outerEdgeLuminance) && outerEdgeLuminance > 0 && outerEdgeLuminance < 1)) {
    return fail();
  }

  const sortedWeights = new Float64Array(imageCount);
  sortedWeights[0] = outerEdgeLuminance;
  let previousProfile = 0;
  for (let i = 1; i < apertures.length; i += 1) {
    const profileStep = sortedProfile[i] - previousProfile;
    sortedWeights[i] = (1 - outerEdgeLuminance) * profileStep;
    previousProfile = sortedProfile[i];
  }

  let totalWeight = 0;
  for (const weight of sortedWeights) totalWeight += weight;
  if (!(Number.isFinite(totalWeight) && totalWeight > 0)) return fail();

  const weights = new Float64Array(imageCount);
  for (let i = 0; i < apertures.length; i += 1) {
    weights[apertures[i].index] = sortedWeights[i] / totalWeight;
  }
  return weights;
}
