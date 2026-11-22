/**
 * STF frame weights depend only on (CoC radius, linear-light edge density).
 * Each target profile specifies the ideal cumulative luminance at the sampled
 * disc radii. The virtual zero radius sits a profile-dependent fractional
 * geometric step outside the largest disc radius.
 */
export type StfWeightedImage<T = number> = {
  image: T;
  radiusFNumber: number;
  edgeDensity: number;
};

export const STF_SMOOTHSTEP_ATTENUATIONS = [
  "smoothstep-weak", "smoothstep-medium", "smoothstep-strong",
] as const;
// Legacy export name kept for compatibility. The value is now the default
// virtual-zero outer-step fraction, not an apodization ratio.
export const STF_OUTER_SHELL_APODIZATION_RATIO = 0.8;
export type StfRadialAttenuation = -2 | -1 | 0 | 1 | 2 | 3 |
  typeof STF_SMOOTHSTEP_ATTENUATIONS[number];

export function isStfRadialAttenuation(value: unknown): value is StfRadialAttenuation {
  return (typeof value === "number" && Number.isInteger(value) && value >= -2 && value <= 3) ||
    (typeof value === "string" && STF_SMOOTHSTEP_ATTENUATIONS.some((mode) => mode === value));
}

export function parseStfRadialAttenuation(value: string): StfRadialAttenuation | null {
  if (STF_SMOOTHSTEP_ATTENUATIONS.some((mode) => mode === value)) {
    return value as typeof STF_SMOOTHSTEP_ATTENUATIONS[number];
  }
  // A numeric mode must match its whole option string, not a numeric prefix.
  if (!/^-?[0-9]+$/.test(value)) return null;
  const numeric = Number(value);
  return isStfRadialAttenuation(numeric) ? numeric : null;
}

export type StfRadialWeightPlan = {
  weights: Float32Array;
  rawWeights: Float64Array;
  // In original input order; differences between consecutive target levels.
  idealDrops: Float64Array;
  // Actual relative luminance contributions after weighting; currently equal to idealDrops.
  adjustedDrops: Float64Array;
  virtualZeroRadius: number;
  outerShellApodizationApplied: boolean;
};

type OrderedFrame = { index: number; radius: number; density: number };

function orderByRadius<T>(samples: readonly StfWeightedImage<T>[]): OrderedFrame[] {
  if (samples.length === 0) throw new Error("STF requires at least one input image.");
  const ordered = samples.map((sample, index) => {
    const radius = 1 / sample.radiusFNumber;
    if (!(Number.isFinite(radius) && radius > 0)) {
      throw new Error(`STF frame ${index + 1} has an invalid radius F-number.`);
    }
    if (!(Number.isFinite(sample.edgeDensity) && sample.edgeDensity > 0)) {
      throw new Error(`STF frame ${index + 1} has an invalid linear edge density.`);
    }
    return { index, radius, density: sample.edgeDensity };
  }).sort((a, b) => a.radius - b.radius);
  for (let i = 1; i < ordered.length; i++) {
    if (!(ordered[i].radius > ordered[i - 1].radius)) {
      throw new Error("STF requires distinct circle-of-confusion radii.");
    }
  }
  return ordered;
}

/** Target 1 at the smallest real/virtual disc radius; 0 at a profile-dependent outer zero. */
function radialTarget(
  attenuation: StfRadialAttenuation, radius: number, min: number, zero: number,
): number {
  if (radius <= min) return 1;
  if (radius >= zero) return 0;
  if (typeof attenuation === "number") {
    const span = Math.log(zero / min);
    const position = Math.log(zero / radius);
    return attenuation === 0 ? position / span :
      Math.expm1(-attenuation * position) / Math.expm1(-attenuation * span);
  }
  const t = (zero - radius) / (zero - min); // 1 at inner rim, 0 at virtual zero.
  if (attenuation === "smoothstep-weak") return t * t * (3 - 2 * t);
  if (attenuation === "smoothstep-medium") return t ** 3 * (10 + t * (-15 + 6 * t));
  // Seventh-order smootherstep: third derivative also vanishes at the endpoints.
  return t ** 4 * (35 + t * (-84 + t * (70 - 20 * t)));
}

function normalize(raw: Float64Array): Float64Array {
  const sum = raw.reduce((a, b) => a + b, 0);
  if (!(Number.isFinite(sum) && sum > 0)) throw new Error("STF radial weight total is invalid.");
  return Float64Array.from(raw, (x) => x / sum);
}

function virtualZeroOuterStep(attenuation: StfRadialAttenuation): number {
  if (typeof attenuation !== "number") return STF_OUTER_SHELL_APODIZATION_RATIO;
  return attenuation <= 0 ? STF_OUTER_SHELL_APODIZATION_RATIO :
    STF_OUTER_SHELL_APODIZATION_RATIO - 0.1 * attenuation;
}

/**
 * Choose the virtual zero from all available radii (real and generated).
 * Match the target exactly at each disc radius, starting outside-in.
 * The profile-dependent virtual-zero placement replaces the previous
 * outer-shell apodization step.
 */
export function calculateStfWeights<T>(
  samples: readonly StfWeightedImage<T>[], attenuation: StfRadialAttenuation,
): StfRadialWeightPlan {
  if (!isStfRadialAttenuation(attenuation)) {
    throw new Error("STF Radial attenuation is unsupported.");
  }
  const ordered = orderByRadius(samples);
  const n = ordered.length;
  if (n === 1) {
    return { weights: new Float32Array([1]), rawWeights: new Float64Array([1 / ordered[0].density]),
      idealDrops: new Float64Array([1]), adjustedDrops: new Float64Array([1]),
      virtualZeroRadius: ordered[0].radius, outerShellApodizationApplied: false };
  }

  const minRadius = ordered[0].radius;
  const maxRadius = ordered[n - 1].radius;
  const logStep = Math.log(maxRadius / minRadius) / (n - 1);
  const zeroStep = virtualZeroOuterStep(attenuation);
  const virtualZeroRadius = maxRadius * Math.exp(logStep * zeroStep);
  if (!(Number.isFinite(virtualZeroRadius) && virtualZeroRadius > maxRadius)) {
    throw new Error("STF virtual zero radius is invalid.");
  }

  const idealDrops = new Float64Array(n);
  let previous = 0;
  for (let i = n - 1; i >= 0; i--) {
    const frame = ordered[i];
    const level = radialTarget(attenuation, frame.radius, minRadius, virtualZeroRadius);
    const drop = level - previous;
    if (!(Number.isFinite(drop) && drop > 0)) {
      throw new Error("STF radial luminance drop is invalid.");
    }
    idealDrops[frame.index] = drop;
    previous = level;
  }

  const rawWeights = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    rawWeights[i] = idealDrops[i] / samples[i].edgeDensity;
  }
  const weights = Float32Array.from(normalize(rawWeights));
  return { weights, rawWeights, idealDrops: normalize(idealDrops), adjustedDrops: normalize(idealDrops),
    virtualZeroRadius, outerShellApodizationApplied: false };
}
