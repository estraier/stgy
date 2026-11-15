/**
 * STF weighting is defined by (frame reference, CoC radius F-number, edge density).
 * The edge density is a positive linear-light *model estimate* at the agreed
 * calibration luminance after tone matching; it must never be inferred from
 * the virtual F-number alone.
 */
export type StfWeightedImage<T = number> = {
  image: T;
  radiusFNumber: number;
  edgeDensity: number;
};

export type StfRadialWeightPlan = {
  // Stage 1: weights obtained from the target drop over Voronoi radius cells.
  priorWeights: Float64Array;
  // Stage 2: minimax step levels on every annulus, then divide by density.
  weights: Float32Array;
  // For single-pass deferred normalization: rawWeight = optimalDrop / edgeDensity.
  rawWeights: Float64Array;
  optimalDrops: Float64Array;
  priorMaximumError: number;
  minimaxMaximumError: number;
};

type OrderedFrame = { index: number; radius: number; density: number };

function validateAttenuation(q: number): void {
  if (!(Number.isInteger(q) && q >= -2 && q <= 3)) {
    throw new Error("STF Radial attenuation must be an integer from -2 to 3.");
  }
}

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

function radialTarget(q: number, min: number, max: number): (radius: number) => number {
  const span = Math.log(max / min);
  if (!(Number.isFinite(span) && span > 0)) {
    throw new Error("STF requires distinct finite circle-of-confusion radii.");
  }
  return (radius: number) => {
    const position = Math.log(radius / min);
    if (q === 0) return 1 - position / span;
    return (Math.expm1(q * span) - Math.expm1(q * position)) / Math.expm1(q * span);
  };
}

/** Final minimax luminance drops in ORIGINAL frame order; independent of D. */
export function buildStfMinimaxDrops(
  radiusFNumbers: readonly number[], q: number,
): Float64Array {
  validateAttenuation(q);
  const ordered = orderByRadius(radiusFNumbers.map((radiusFNumber, image) => ({
    image, radiusFNumber, edgeDensity: 1,
  })));
  const drops = new Float64Array(ordered.length);
  if (ordered.length === 1) {
    drops[0] = 1;
    return drops;
  }
  const target = radialTarget(q, ordered[0].radius, ordered[ordered.length - 1].radius);
  let previousLevel = 1;
  for (let i = 0; i < ordered.length; i++) {
    const nextLevel = i + 1 === ordered.length ? 0
      : (target(ordered[i].radius) + target(ordered[i + 1].radius)) / 2;
    const drop = previousLevel - nextLevel;
    if (!(Number.isFinite(drop) && drop > 0)) throw new Error("STF minimax drop is invalid.");
    drops[ordered[i].index] = drop;
    previousLevel = nextLevel;
  }
  return drops;
}

function normalize(raw: Float64Array): Float64Array {
  const sum = raw.reduce((a, b) => a + b, 0);
  if (!(Number.isFinite(sum) && sum > 0)) throw new Error("STF radial weight total is invalid.");
  return Float64Array.from(raw, (x) => x / sum);
}

function maximumProfileError(
  ordered: OrderedFrame[], relativeWeights: ArrayLike<number>, target: (radius: number) => number,
): number {
  const drops = ordered.map((frame) => relativeWeights[frame.index] * frame.density);
  const total = drops.reduce((sum, x) => sum + x, 0);
  if (!(Number.isFinite(total) && total > 0)) throw new Error("STF profile luminance is invalid.");
  let previousDrop = drops[0] / total;
  let maximum = 0;
  for (let i = 0; i + 1 < ordered.length; i++) {
    const level = 1 - previousDrop;
    maximum = Math.max(maximum,
      Math.abs(level - target(ordered[i].radius)),
      Math.abs(level - target(ordered[i + 1].radius)));
    previousDrop += drops[i + 1] / total;
  }
  return maximum;
}

/**
 * Stage 1: radius-cell allocation / density; Stage 2: exact annulus minimax.
 * Neither stage changes the user's chosen q, including outside real apertures.
 */
export function calculateStfWeights<T>(
  samples: readonly StfWeightedImage<T>[], q: number,
): StfRadialWeightPlan {
  validateAttenuation(q);
  const ordered = orderByRadius(samples);
  const n = ordered.length;
  if (n === 1) {
    return { priorWeights: new Float64Array([1]), weights: new Float32Array([1]),
      rawWeights: new Float64Array([1 / ordered[0].density]),
      optimalDrops: new Float64Array([1]), priorMaximumError: 0, minimaxMaximumError: 0 };
  }
  const target = radialTarget(q, ordered[0].radius, ordered[n - 1].radius);
  const boundaries = [ordered[0].radius];
  for (let i = 1; i < n; i++) boundaries.push((ordered[i - 1].radius + ordered[i].radius) / 2);
  boundaries.push(ordered[n - 1].radius);
  const priorRaw = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const drop = target(boundaries[i]) - target(boundaries[i + 1]);
    if (!(Number.isFinite(drop) && drop > 0)) throw new Error("STF radius-cell allocation is invalid.");
    priorRaw[ordered[i].index] = drop / ordered[i].density;
  }
  const priorWeights = normalize(priorRaw);
  const optimalDrops = buildStfMinimaxDrops(samples.map((x) => x.radiusFNumber), q);
  const rawWeights = new Float64Array(n);
  for (let i = 0; i < n; i++) rawWeights[i] = optimalDrops[i] / samples[i].edgeDensity;
  const weights = Float32Array.from(normalize(rawWeights));
  const priorMaximumError = maximumProfileError(ordered, priorWeights, target);
  const minimaxMaximumError = maximumProfileError(ordered, normalize(rawWeights), target);
  if (minimaxMaximumError > priorMaximumError + 1e-10) {
    throw new Error("STF minimax increased the radial profile maximum error.");
  }
  return { priorWeights, weights, rawWeights, optimalDrops,
    priorMaximumError, minimaxMaximumError };
}
