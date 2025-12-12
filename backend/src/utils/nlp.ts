let decodeLut: Float32Array | null = null;

function buildDecodeLut(): Float32Array {
  if (decodeLut) return decodeLut;
  const lut = new Float32Array(256);
  for (let i = 0; i < 256; i++) {
    const q = i - 128;
    lut[i] = q === -128 ? -1 : q / 127;
  }
  decodeLut = lut;
  return lut;
}

function computePercentile(values: number[], percentile: number): number {
  if (values.length === 0) return 1;
  const p = Math.min(Math.max(percentile, 0), 1);
  if (p === 0) {
    let min = values[0];
    for (let i = 1; i < values.length; i++) {
      if (values[i] < min) min = values[i];
    }
    return min <= 0 ? 1 : min;
  }
  const copy = values.slice().sort((a, b) => a - b);
  const idx = Math.floor((copy.length - 1) * p);
  const v = copy[idx];
  return v <= 0 || !Number.isFinite(v) ? 1 : v;
}

export function encodeFeatures(
  input: number[],
  dim = 512,
  percentile = 0.95,
  gamma = 0.5,
): Int8Array {
  const d = dim > 0 ? dim : 512;
  const data = new Array<number>(d);
  for (let i = 0; i < d; i++) {
    const v = i < input.length ? input[i] : 0;
    data[i] = Number.isFinite(v) ? v : 0;
  }
  const mags = new Array<number>(d);
  for (let i = 0; i < d; i++) {
    mags[i] = Math.abs(data[i]);
  }
  let scale = computePercentile(mags, percentile);
  if (!Number.isFinite(scale) || scale <= 0) scale = 1;
  const g = gamma > 0 ? gamma : 1;
  const out = new Int8Array(d);
  for (let i = 0; i < d; i++) {
    let v = data[i];
    const sign = v < 0 ? -1 : 1;
    let m = Math.abs(v);
    if (m > scale) m = scale;
    let n = m / scale;
    if (n < 0) n = 0;
    if (n > 1) n = 1;
    const nGamma = Math.pow(n, g);
    const s = nGamma * sign;
    let q = Math.round(s * 127);
    if (q > 127) q = 127;
    if (q < -128) q = -128;
    out[i] = q;
  }
  return out;
}

export function decodeFeatures(
  encoded: ArrayLike<number>,
  gamma = 0.5,
): number[] {
  const lut = buildDecodeLut();
  const invGamma = gamma > 0 ? 1 / gamma : 1;
  const out = new Array<number>(encoded.length);
  for (let i = 0; i < encoded.length; i++) {
    let q = encoded[i];
    if (q < -128 || q > 127) {
      q = q > 127 ? q - 256 : q;
    }
    const n = lut[q + 128];
    const sign = n < 0 ? -1 : 1;
    const mag = Math.abs(n);
    const restored = sign * Math.pow(mag, invGamma);
    out[i] = restored;
  }
  return out;
}

export function countPseudoTokens(text: string): number {
  let count = 0;
  for (let i = 0; i < text.length; ) {
    const cp = text.codePointAt(i)!;
    const unitLen = cp > 0xffff ? 2 : 1;
    count += cp < 0x2000 ? 1 : 2;
    i += unitLen;
  }
  return count;
}

export function sliceByPseudoTokens(text: string, start: number, end: number): string {
  if (start < 0) start = 0;
  if (end < 0) end = 0;
  if (end <= start) return "";
  let pseudo = 0;
  let started = false;
  let startIdx = 0;
  let endIdx = text.length;
  for (let i = 0; i < text.length; ) {
    const cp = text.codePointAt(i)!;
    const unitLen = cp > 0xffff ? 2 : 1;
    const weight = cp < 0x2000 ? 1 : 2;
    const nextPseudo = pseudo + weight;
    if (!started && nextPseudo > start) {
      started = true;
      startIdx = i;
    }
    if (started && nextPseudo >= end) {
      endIdx = i + unitLen;
      break;
    }
    pseudo = nextPseudo;
    i += unitLen;
  }
  if (!started) return "";
  return text.slice(startIdx, endIdx);
}
