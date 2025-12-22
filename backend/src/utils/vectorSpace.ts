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
  if (!Number.isFinite(v) || v <= 0) {
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
  for (let i = 0; i < d; i++) mags[i] = Math.abs(data[i]);
  const scale = computePercentile(mags, percentile);
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
