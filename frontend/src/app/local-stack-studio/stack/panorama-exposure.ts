export type PanoramaExposureProxy = {
  cornerX: number;
  cornerY: number;
  width: number;
  height: number;
  // Unclipped linear BGR (the same light values used for final composition).
  bgr: Float32Array;
  mask: Uint8Array;
};

export type PanoramaGainMap = {
  width: number;
  height: number;
  data: Float32Array;
  // Precomputed node log-gains for fast, consistent bilinear interpolation.
  logData?: Float32Array;
};

const BLOCK_SIZE = 32;
const SAMPLE_STEP = 2;
// The exposure proxies are linear RGB, not an 8-bit image.
const MIN_SAMPLE_VALUE = 10 / 255;
const MIN_GAIN = 2 / 3;
const MAX_GAIN = 1.5;
const MAX_LOG_GAIN = Math.log(MAX_GAIN);
const MIN_CELL_SAMPLES = 6;
const SMOOTHNESS_WEIGHT = 0.08;
const NEUTRAL_WEIGHT = 0.000001;
const SOLVER_ITERATIONS = 120;

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

type GainGrid = {
  width: number;
  height: number;
  offset: number;
  imageWidth: number;
  imageHeight: number;
};

type PairSampleAccumulator = {
  indices: Int32Array;
  // Separate coefficient sums for B, G and R because valid pixels can differ.
  coefficients: Float64Array;
  targets: Float64Array;
  counts: Uint32Array;
};

type GainConstraint = {
  indices: Int32Array;
  coefficients: Float64Array;
  targets: Float64Array;
  strengths: Float64Array;
};

type SmoothEdge = { first: number; second: number };

// Matches samplePanoramaGainBgrInto() exactly. Both sides of an overlap
// contribute the same bilinearly interpolated log-gain that composition uses.
function fillGainWeights(
  grid: GainGrid,
  x: number,
  y: number,
  indices: Int32Array,
  weights: Float64Array,
  start: number,
  sign: number,
): number {
  const gx = clamp(((x + 0.5) * grid.width / grid.imageWidth) - 0.5, 0, grid.width - 1);
  const gy = clamp(((y + 0.5) * grid.height / grid.imageHeight) - 0.5, 0, grid.height - 1);
  const x0 = Math.floor(gx);
  const y0 = Math.floor(gy);
  const x1 = Math.min(grid.width - 1, x0 + 1);
  const y1 = Math.min(grid.height - 1, y0 + 1);
  const fx = gx - x0;
  const fy = gy - y0;
  indices[start] = grid.offset + y0 * grid.width + x0;
  indices[start + 1] = grid.offset + y0 * grid.width + x1;
  indices[start + 2] = grid.offset + y1 * grid.width + x0;
  indices[start + 3] = grid.offset + y1 * grid.width + x1;
  weights[start] = sign * (1 - fx) * (1 - fy);
  weights[start + 1] = sign * fx * (1 - fy);
  weights[start + 2] = sign * (1 - fx) * fy;
  weights[start + 3] = sign * fx * fy;
  return y0 * grid.width + x0;
}

function createGainConstraints(
  images: ReadonlyArray<PanoramaExposureProxy>,
  grids: ReadonlyArray<GainGrid>,
): GainConstraint[] {
  const result: GainConstraint[] = [];
  const indices = new Int32Array(8);
  const weights = new Float64Array(8);
  for (let firstIndex = 0; firstIndex < images.length; firstIndex += 1) {
    const first = images[firstIndex]!;
    const firstGrid = grids[firstIndex]!;
    for (let secondIndex = firstIndex + 1; secondIndex < images.length; secondIndex += 1) {
      const second = images[secondIndex]!;
      const secondGrid = grids[secondIndex]!;
      const left = Math.max(first.cornerX, second.cornerX);
      const top = Math.max(first.cornerY, second.cornerY);
      const right = Math.min(first.cornerX + first.width, second.cornerX + second.width);
      const bottom = Math.min(first.cornerY + first.height, second.cornerY + second.height);
      if (right <= left || bottom <= top) continue;
      // Accumulate each pair of interpolation cells, not just a single
      // independently corrected block. This avoids O(overlap pixels) storage.
      const cellPairs = new Map<number, PairSampleAccumulator>();
      for (let globalY = top; globalY < bottom; globalY += SAMPLE_STEP) {
        const firstY = globalY - first.cornerY;
        const secondY = globalY - second.cornerY;
        for (let globalX = left; globalX < right; globalX += SAMPLE_STEP) {
          const firstX = globalX - first.cornerX;
          const secondX = globalX - second.cornerX;
          const firstPixel = firstY * first.width + firstX;
          const secondPixel = secondY * second.width + secondX;
          if (first.mask[firstPixel] === 0 || second.mask[secondPixel] === 0) continue;

          const firstCell = fillGainWeights(firstGrid, firstX, firstY, indices, weights, 0, 1);
          const secondCell = fillGainWeights(secondGrid, secondX, secondY, indices, weights, 4, -1);
          const key = firstCell * (secondGrid.width * secondGrid.height) + secondCell;
          let cell = cellPairs.get(key);
          for (let channel = 0; channel < 3; channel += 1) {
            const firstValue = first.bgr[firstPixel * 3 + channel]!;
            const secondValue = second.bgr[secondPixel * 3 + channel]!;
            if (
              !Number.isFinite(firstValue) || !Number.isFinite(secondValue)
              || firstValue < MIN_SAMPLE_VALUE || secondValue < MIN_SAMPLE_VALUE
            ) continue;
            if (!cell) {
              cell = {
                indices: indices.slice(),
                coefficients: new Float64Array(24),
                targets: new Float64Array(3),
                counts: new Uint32Array(3),
              };
              cellPairs.set(key, cell);
            }
            // The desired relation is gain(first) - gain(second) = log(B/A).
            // Bound individual outliers from parallax/moving objects while
            // preserving the full observed ratio for ordinary exposures.
            cell.targets[channel] += clamp(
              Math.log(secondValue / firstValue),
              -2 * MAX_LOG_GAIN,
              2 * MAX_LOG_GAIN,
            );
            cell.counts[channel] += 1;
            for (let weightIndex = 0; weightIndex < 8; weightIndex += 1) {
              cell.coefficients[channel * 8 + weightIndex] += weights[weightIndex]!;
            }
          }
        }
      }
      for (const cell of cellPairs.values()) {
        const strengths = new Float64Array(3);
        const averageTargets = new Float64Array(3);
        const averageCoefficients = new Float64Array(24);
        let useful = false;
        for (let channel = 0; channel < 3; channel += 1) {
          const count = cell.counts[channel]!;
          if (count < MIN_CELL_SAMPLES) continue;
          // A well-observed cell is one constraint, regardless of its area.
          // Sparse intersections get appropriately smaller confidence.
          strengths[channel] = Math.min(1, count / 32);
          averageTargets[channel] = cell.targets[channel]! / count;
          for (let k = 0; k < 8; k += 1) {
            averageCoefficients[channel * 8 + k] = cell.coefficients[channel * 8 + k]! / count;
          }
          useful = true;
        }
        if (useful) result.push({
          indices: cell.indices,
          coefficients: averageCoefficients,
          targets: averageTargets,
          strengths,
        });
      }
    }
  }
  return result;
}

function createSmoothEdges(grids: ReadonlyArray<GainGrid>): SmoothEdge[] {
  const edges: SmoothEdge[] = [];
  for (const grid of grids) {
    for (let y = 0; y < grid.height; y += 1) {
      for (let x = 0; x < grid.width; x += 1) {
        const index = grid.offset + y * grid.width + x;
        if (x + 1 < grid.width) edges.push({ first: index, second: index + 1 });
        if (y + 1 < grid.height) edges.push({ first: index, second: index + grid.width });
      }
    }
  }
  return edges;
}

// Solve the same global weighted least-squares problem for each RGB channel.
// Overlapping images share observation constraints, so triple overlaps cannot
// independently choose mutually inconsistent gains. Smoothness acts only on
// the gain fields; there is no preselected Graph Cut seam in this objective.
function solveChannel(
  channel: number,
  nodeCount: number,
  constraints: ReadonlyArray<GainConstraint>,
  edges: ReadonlyArray<SmoothEdge>,
): Float64Array {
  const rhs = new Float64Array(nodeCount);
  const diagonal = new Float64Array(nodeCount).fill(NEUTRAL_WEIGHT);
  for (const constraint of constraints) {
    const strength = constraint.strengths[channel]!;
    if (strength === 0) continue;
    const target = constraint.targets[channel]!;
    for (let i = 0; i < 8; i += 1) {
      const index = constraint.indices[i]!;
      const coefficient = constraint.coefficients[channel * 8 + i]!;
      rhs[index] += strength * coefficient * target;
      diagonal[index] += strength * coefficient * coefficient;
    }
  }
  for (const edge of edges) {
    diagonal[edge.first] += SMOOTHNESS_WEIGHT;
    diagonal[edge.second] += SMOOTHNESS_WEIGHT;
  }

  const multiply = (input: Float64Array, output: Float64Array): void => {
    for (let i = 0; i < nodeCount; i += 1) output[i] = NEUTRAL_WEIGHT * input[i]!;
    for (const constraint of constraints) {
      const strength = constraint.strengths[channel]!;
      if (strength === 0) continue;
      let projection = 0;
      for (let k = 0; k < 8; k += 1) {
        projection += constraint.coefficients[channel * 8 + k]! * input[constraint.indices[k]!]!;
      }
      const weighted = strength * projection;
      for (let k = 0; k < 8; k += 1) {
        output[constraint.indices[k]!] += constraint.coefficients[channel * 8 + k]! * weighted;
      }
    }
    for (const edge of edges) {
      const delta = SMOOTHNESS_WEIGHT * (input[edge.first]! - input[edge.second]!);
      output[edge.first] += delta;
      output[edge.second] -= delta;
    }
  };

  const solution = new Float64Array(nodeCount);
  const residual = rhs.slice();
  const direction = new Float64Array(nodeCount);
  const operatorDirection = new Float64Array(nodeCount);
  let residualEnergy = 0;
  let initialNorm = 0;
  for (let i = 0; i < nodeCount; i += 1) {
    direction[i] = residual[i]! / diagonal[i]!;
    residualEnergy += residual[i]! * direction[i]!;
    initialNorm += rhs[i]! * rhs[i]!;
  }
  if (initialNorm === 0) return solution;
  const tolerance = Math.sqrt(initialNorm) * 1e-5;
  for (let iteration = 0; iteration < SOLVER_ITERATIONS; iteration += 1) {
    multiply(direction, operatorDirection);
    let denominator = 0;
    for (let i = 0; i < nodeCount; i += 1) denominator += direction[i]! * operatorDirection[i]!;
    if (!(denominator > 0) || !Number.isFinite(denominator)) break;
    const alpha = residualEnergy / denominator;
    let norm = 0;
    for (let i = 0; i < nodeCount; i += 1) {
      solution[i] += alpha * direction[i]!;
      residual[i] -= alpha * operatorDirection[i]!;
      norm += residual[i]! * residual[i]!;
    }
    if (Math.sqrt(norm) <= tolerance) break;
    let nextEnergy = 0;
    for (let i = 0; i < nodeCount; i += 1) nextEnergy += residual[i]! * residual[i]! / diagonal[i]!;
    if (!(nextEnergy > 0) || !Number.isFinite(nextEnergy)) break;
    const beta = nextEnergy / residualEnergy;
    for (let i = 0; i < nodeCount; i += 1) {
      direction[i] = residual[i]! / diagonal[i]! + beta * direction[i]!;
    }
    residualEnergy = nextEnergy;
  }
  return solution;
}

export function estimatePanoramaGainMaps(
  images: ReadonlyArray<PanoramaExposureProxy>,
): PanoramaGainMap[] {
  let offset = 0;
  const grids = images.map((image) => {
    if (
      !Number.isInteger(image.width) || !Number.isInteger(image.height)
      || image.width <= 0 || image.height <= 0
      || image.bgr.length < image.width * image.height * 3
      || image.mask.length < image.width * image.height
    ) throw new Error("Panorama exposure proxy has an invalid pixel buffer.");
    const width = Math.max(1, Math.ceil(image.width / BLOCK_SIZE));
    const height = Math.max(1, Math.ceil(image.height / BLOCK_SIZE));
    const grid = { width, height, offset, imageWidth: image.width, imageHeight: image.height };
    offset += width * height;
    return grid;
  });
  if (offset === 0) return [];
  const constraints = createGainConstraints(images, grids);
  const edges = createSmoothEdges(grids);
  const solutions = [0, 1, 2].map((channel) => solveChannel(channel, offset, constraints, edges));
  return grids.map((grid) => {
    const data = new Float32Array(grid.width * grid.height * 3);
    const logData = new Float32Array(data.length);
    for (let node = 0; node < grid.width * grid.height; node += 1) {
      for (let channel = 0; channel < 3; channel += 1) {
        const index = node * 3 + channel;
        const logGain = clamp(solutions[channel]![grid.offset + node]!, -MAX_LOG_GAIN, MAX_LOG_GAIN);
        logData[index] = logGain;
        data[index] = Math.exp(logGain);
      }
    }
    return { width: grid.width, height: grid.height, data, logData };
  });
}

export function samplePanoramaGainBgrInto(
  map: PanoramaGainMap,
  x: number,
  y: number,
  imageWidth: number,
  imageHeight: number,
  output: Float32Array,
): void {
  if (output.length < 3) throw new Error("Panorama gain sample output must have three channels.");
  if (map.width <= 1 && map.height <= 1) {
    output[0] = map.data[0] ?? 1;
    output[1] = map.data[1] ?? 1;
    output[2] = map.data[2] ?? 1;
    return;
  }
  const gx = clamp(((x + 0.5) * map.width / Math.max(1, imageWidth)) - 0.5, 0, map.width - 1);
  const gy = clamp(((y + 0.5) * map.height / Math.max(1, imageHeight)) - 0.5, 0, map.height - 1);
  const x0 = Math.floor(gx);
  const y0 = Math.floor(gy);
  const x1 = Math.min(map.width - 1, x0 + 1);
  const y1 = Math.min(map.height - 1, y0 + 1);
  const fx = gx - x0;
  const fy = gy - y0;
  const values = map.logData ?? map.data;
  for (let channel = 0; channel < 3; channel += 1) {
    const v00 = values[(y0 * map.width + x0) * 3 + channel] ?? 0;
    const v10 = values[(y0 * map.width + x1) * 3 + channel] ?? 0;
    const v01 = values[(y1 * map.width + x0) * 3 + channel] ?? 0;
    const v11 = values[(y1 * map.width + x1) * 3 + channel] ?? 0;
    const top = v00 + (v10 - v00) * fx;
    const bottom = v01 + (v11 - v01) * fx;
    const interpolated = top + (bottom - top) * fy;
    output[channel] = map.logData ? Math.exp(interpolated) : interpolated;
  }
}

export function samplePanoramaGainBgr(
  map: PanoramaGainMap,
  x: number,
  y: number,
  imageWidth: number,
  imageHeight: number,
  channel: number,
): number {
  if (map.width <= 1 && map.height <= 1) return map.data[channel] ?? 1;
  const gx = clamp(((x + 0.5) * map.width / Math.max(1, imageWidth)) - 0.5, 0, map.width - 1);
  const gy = clamp(((y + 0.5) * map.height / Math.max(1, imageHeight)) - 0.5, 0, map.height - 1);
  const x0 = Math.floor(gx);
  const y0 = Math.floor(gy);
  const x1 = Math.min(map.width - 1, x0 + 1);
  const y1 = Math.min(map.height - 1, y0 + 1);
  const fx = gx - x0;
  const fy = gy - y0;
  const values = map.logData ?? map.data;
  const v00 = values[(y0 * map.width + x0) * 3 + channel] ?? 0;
  const v10 = values[(y0 * map.width + x1) * 3 + channel] ?? 0;
  const v01 = values[(y1 * map.width + x0) * 3 + channel] ?? 0;
  const v11 = values[(y1 * map.width + x1) * 3 + channel] ?? 0;
  const top = v00 + (v10 - v00) * fx;
  const bottom = v01 + (v11 - v01) * fx;
  const interpolated = top + (bottom - top) * fy;
  return map.logData ? Math.exp(interpolated) : interpolated;
}

export function applyPanoramaGainBgrInPlace(
  bgr: Float32Array,
  width: number,
  height: number,
  map: PanoramaGainMap,
): void {
  if (bgr.length < width * height * 3) {
    throw new Error("Panorama gain application received an invalid pixel buffer.");
  }
  const gains = new Float32Array(3);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 3;
      samplePanoramaGainBgrInto(map, x, y, width, height, gains);
      bgr[offset] *= gains[0]!;
      bgr[offset + 1] *= gains[1]!;
      bgr[offset + 2] *= gains[2]!;
    }
  }
}
