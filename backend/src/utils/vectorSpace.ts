const FEATURE_CODEC_GAMMA = 0.7;

function computePercentile(values: number[], percentile: number): number {
  if (values.length === 0) {
    throw new Error("computePercentile: values is empty");
  }
  if (!Number.isFinite(percentile) || percentile < 0 || percentile > 1) {
    throw new Error(`computePercentile: invalid percentile=${percentile}`);
  }
  const copy = values.slice().sort((a, b) => a - b);
  const idx = Math.floor((copy.length - 1) * percentile);
  const v = copy[idx];
  if (!Number.isFinite(v) || v < 0) {
    throw new Error(`computePercentile: invalid scale=${v}`);
  }
  return v;
}

export function encodeFeatures(input: number[], dim = 512, percentile = 0.95): Int8Array {
  if (!Number.isInteger(dim) || dim <= 0) {
    throw new Error(`encodeFeatures: invalid dim=${dim}`);
  }
  const d = dim;
  const data = new Array<number>(d);
  for (let i = 0; i < d; i++) {
    const v = i < input.length ? input[i] : 0;
    if (!Number.isFinite(v)) {
      throw new Error(`encodeFeatures: non-finite input at i=${i}`);
    }
    data[i] = v;
  }
  const mags = new Array<number>(d);
  let maxMag = 0;
  for (let i = 0; i < d; i++) {
    const m = Math.abs(data[i]);
    mags[i] = m;
    if (m > maxMag) maxMag = m;
  }
  let scale = computePercentile(mags, percentile);
  if (scale === 0) {
    if (maxMag === 0) return new Int8Array(d);
    scale = maxMag;
  }
  const out = new Int8Array(d);
  for (let i = 0; i < d; i++) {
    const v = data[i];
    const sign = v < 0 ? -1 : 1;
    let m = Math.abs(v);
    if (m > scale) m = scale;
    const n = m / scale;
    const s = Math.pow(n, FEATURE_CODEC_GAMMA) * sign;
    let q = Math.round(s * 127);
    if (q > 127) q = 127;
    if (q < -127) q = -127;
    out[i] = q;
  }
  return out;
}

export function decodeFeatures(encoded: Int8Array): number[] {
  const out = new Array<number>(encoded.length);
  const invGamma = 1 / FEATURE_CODEC_GAMMA;
  for (let i = 0; i < encoded.length; i++) {
    const q = encoded[i];
    if (q < -127 || q > 127) {
      throw new Error(`decodeFeatures: out-of-range q=${q} at i=${i}`);
    }
    const n = q / 127;
    const sign = n < 0 ? -1 : 1;
    const mag = Math.abs(n);
    out[i] = sign * Math.pow(mag, invGamma);
  }
  return out;
}

export function cosineSimilarity(a: ArrayLike<number>, b: ArrayLike<number>): number {
  const n = a.length;
  if (n !== b.length) {
    throw new Error(`vector dimensions mismatch: a=${n} b=${b.length}`);
  }
  if (n <= 0) {
    throw new Error("vector dimension must be > 0");
  }
  let dot = 0;
  let normA2 = 0;
  let normB2 = 0;
  for (let i = 0; i < n; i++) {
    const x = a[i];
    const y = b[i];
    dot += x * y;
    normA2 += x * x;
    normB2 += y * y;
  }
  if (normA2 === 0 || normB2 === 0) return 0;
  const denom = Math.sqrt(normA2 * normB2);
  let v = dot / denom;
  if (v > 1) v = 1;
  if (v < -1) v = -1;
  return v;
}

export function normalizeL2(vec: ArrayLike<number>): number[] {
  const n = vec.length;
  let norm2 = 0;
  for (let i = 0; i < n; i++) {
    const x = vec[i];
    norm2 += x * x;
  }
  const out = new Array<number>(n);
  if (norm2 === 0) {
    out.fill(0);
    return out;
  }
  const inv = 1 / Math.sqrt(norm2);
  for (let i = 0; i < n; i++) {
    out[i] = vec[i] * inv;
  }
  return out;
}

export function addVectors(a: ArrayLike<number>, b: ArrayLike<number>): number[] {
  const n = a.length;
  if (n !== b.length) {
    throw new Error(`vector dimensions mismatch: a=${n} b=${b.length}`);
  }
  const out = new Array<number>(n);
  for (let i = 0; i < n; i++) {
    out[i] = a[i] + b[i];
  }
  return out;
}

export function naiveSigmoid(x: number, gain: number, mid: number): number {
  const t = (x - mid) * gain;
  if (t >= 0) {
    const e = Math.exp(-t);
    return 1 / (1 + e);
  }
  const e = Math.exp(t);
  return e / (1 + e);
}

export function sigmoidalContrast(x: number, gain: number, mid: number): number {
  const minVal = naiveSigmoid(0, gain, mid);
  const maxVal = naiveSigmoid(1, gain, mid);
  const diff = maxVal - minVal;
  const y = (naiveSigmoid(x, gain, mid) - minVal) / diff;
  return Math.max(0, Math.min(1, y));
}

export type KMeansOptions = {
  seed?: number;
  maxIterations?: number;
  normalize?: boolean;
};

export function clusterVectorsByKMeans(
  vectors: ArrayLike<number>[],
  numClusters: number,
  options?: KMeansOptions,
): number[] {
  const mulberry32 = (seed: number): (() => number) => {
    let a = seed >>> 0;
    return () => {
      a |= 0;
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  };
  const l2Norm = (v: ArrayLike<number>): number => {
    let s = 0;
    for (let i = 0; i < v.length; i++) {
      const x = Number(v[i]);
      s += x * x;
    }
    return Math.sqrt(s);
  };
  const toFloat32 = (v: ArrayLike<number>, normalize: boolean): Float32Array => {
    const out = new Float32Array(v.length);
    for (let i = 0; i < v.length; i++) out[i] = Number(v[i]);
    if (!normalize) return out;
    const n = l2Norm(out);
    if (!Number.isFinite(n) || n <= 0) throw new Error("invalid vector");
    if (Math.abs(n - 1) < 1e-3) return out;
    for (let i = 0; i < out.length; i++) out[i] /= n;
    return out;
  };
  const euclideanDistanceSquared = (a: ArrayLike<number>, b: ArrayLike<number>): number => {
    let sum = 0;
    for (let i = 0; i < a.length; i++) {
      const diff = Number(a[i]) - Number(b[i]);
      sum += diff * diff;
    }
    return sum;
  };
  const shuffledIndices = (n: number, rnd: () => number): number[] => {
    const idx = Array.from({ length: n }, (_, i) => i);
    for (let i = n - 1; i > 0; i--) {
      const j = Math.floor(rnd() * (i + 1));
      const tmp = idx[i];
      idx[i] = idx[j];
      idx[j] = tmp;
    }
    return idx;
  };
  if (!Array.isArray(vectors) || vectors.length === 0) throw new Error("empty vectors");
  if (!Number.isInteger(numClusters) || numClusters <= 0) throw new Error("invalid numClusters");
  const numVectors = vectors.length;
  if (numVectors < numClusters) throw new Error("insufficient elements");
  const dimensions = vectors[0].length;
  if (!Number.isInteger(dimensions) || dimensions <= 0) throw new Error("invalid dimensions");
  for (let i = 1; i < vectors.length; i++) {
    if (vectors[i].length !== dimensions) throw new Error("inconsistent dimensions");
  }
  const normalize = options?.normalize ?? true;
  const xs = vectors.map((v) => toFloat32(v, normalize));
  const rnd = options?.seed === undefined ? Math.random : mulberry32(options.seed);
  const pick = shuffledIndices(numVectors, rnd).slice(0, numClusters);
  let centroids = pick.map((i) => new Float32Array(xs[i]));
  const assignments = new Array<number>(numVectors).fill(-1);
  let changed = true;
  let iterations = 0;
  const maxIterations = options?.maxIterations ?? 100;
  while (changed && iterations < maxIterations) {
    changed = false;
    iterations++;
    for (let i = 0; i < numVectors; i++) {
      let minDist = Infinity;
      let closest = -1;
      for (let j = 0; j < numClusters; j++) {
        const dist = euclideanDistanceSquared(xs[i], centroids[j]);
        if (dist < minDist) {
          minDist = dist;
          closest = j;
        }
      }
      if (assignments[i] !== closest) {
        assignments[i] = closest;
        changed = true;
      }
    }
    if (changed) {
      const newCentroids = Array.from({ length: numClusters }, () => new Float32Array(dimensions));
      const counts = new Array<number>(numClusters).fill(0);
      for (let i = 0; i < numVectors; i++) {
        const c = assignments[i];
        for (let d = 0; d < dimensions; d++) newCentroids[c][d] += xs[i][d];
        counts[c]++;
      }
      for (let j = 0; j < numClusters; j++) {
        if (counts[j] > 0) {
          for (let d = 0; d < dimensions; d++) newCentroids[j][d] /= counts[j];
          centroids[j] = newCentroids[j];
        }
      }
    }
  }
  return assignments;
}
