const LANCZOS_RADIUS = 3;
const UINT16_MAX = 65535;

type AxisContributions = {
  offsets: Int32Array;
  indices: Int32Array;
  weights: Float64Array;
};

function sincPi(x: number): number {
  if (Math.abs(x) < 1e-12) return 1;
  const px = Math.PI * x;
  return Math.sin(px) / px;
}

function lanczos3(x: number): number {
  const ax = Math.abs(x);
  if (ax >= LANCZOS_RADIUS) return 0;
  return sincPi(x) * sincPi(x / LANCZOS_RADIUS);
}

function buildAxisContributions(sourceSize: number, targetSize: number): AxisContributions {
  const src = Math.max(1, Math.round(sourceSize));
  const dst = Math.max(1, Math.round(targetSize));
  const scale = dst / src;
  const filterScale = Math.min(1, scale);
  const support = LANCZOS_RADIUS / Math.max(filterScale, 1e-12);
  const offsets = new Int32Array(dst + 1);
  const indexList: number[] = [];
  const weightList: number[] = [];

  for (let target = 0; target < dst; target += 1) {
    offsets[target] = indexList.length;
    const center = (target + 0.5) / scale - 0.5;
    const start = Math.ceil(center - support);
    const end = Math.floor(center + support);
    let sum = 0;
    const localStart = weightList.length;

    for (let source = start; source <= end; source += 1) {
      if (source < 0 || source >= src) continue;
      const weight = lanczos3((source - center) * filterScale);
      if (Math.abs(weight) < 1e-15) continue;
      indexList.push(source);
      weightList.push(weight);
      sum += weight;
    }

    if (weightList.length === localStart || Math.abs(sum) < 1e-15) {
      const nearest = Math.max(0, Math.min(src - 1, Math.round(center)));
      indexList.push(nearest);
      weightList.push(1);
    } else {
      const invSum = 1 / sum;
      for (let i = localStart; i < weightList.length; i += 1) {
        weightList[i] *= invSum;
      }
    }
  }
  offsets[dst] = indexList.length;
  return {
    offsets,
    indices: Int32Array.from(indexList),
    weights: Float64Array.from(weightList),
  };
}

function clampUint16(value: number): number {
  if (!(value > 0)) return 0;
  if (value >= UINT16_MAX) return UINT16_MAX;
  return Math.round(value);
}

function resampleHorizontalRow(
  source: Uint16Array,
  sourceWidth: number,
  sourceY: number,
  targetWidth: number,
  contributions: AxisContributions,
): Float32Array {
  const output = new Float32Array(targetWidth * 3);
  const sourceRow = sourceY * sourceWidth * 3;
  for (let x = 0; x < targetWidth; x += 1) {
    let r = 0;
    let g = 0;
    let b = 0;
    const start = contributions.offsets[x] ?? 0;
    const end = contributions.offsets[x + 1] ?? start;
    for (let tap = start; tap < end; tap += 1) {
      const sourceX = contributions.indices[tap] ?? 0;
      const weight = contributions.weights[tap] ?? 0;
      const index = sourceRow + sourceX * 3;
      r += (source[index] ?? 0) * weight;
      g += (source[index + 1] ?? 0) * weight;
      b += (source[index + 2] ?? 0) * weight;
    }
    const dst = x * 3;
    output[dst] = r;
    output[dst + 1] = g;
    output[dst + 2] = b;
  }
  return output;
}

/**
 * Resample gamma-2.0 encoded ProPhoto RGB16 with a separable Lanczos-3 filter.
 *
 * For downscaling, the kernel footprint is widened by 1 / scale before sampling.
 * This integrates the source footprint instead of treating Lanczos as a fixed-radius
 * interpolation kernel, which suppresses aliasing at substantial reductions.
 */
export function resizeGamma20Rgb16Lanczos3(
  source: Uint16Array,
  sourceWidth: number,
  sourceHeight: number,
  targetWidth: number,
  targetHeight: number,
): Uint16Array {
  const srcW = Math.max(1, Math.round(sourceWidth));
  const srcH = Math.max(1, Math.round(sourceHeight));
  const dstW = Math.max(1, Math.round(targetWidth));
  const dstH = Math.max(1, Math.round(targetHeight));
  if (source.length !== srcW * srcH * 3) {
    throw new Error("Lanczos RGB16 source dimensions do not match the buffer length.");
  }
  if (srcW === dstW && srcH === dstH) return source.slice();

  const horizontal = buildAxisContributions(srcW, dstW);
  const vertical = buildAxisContributions(srcH, dstH);
  const result = new Uint16Array(dstW * dstH * 3);
  const rowCache = new Map<number, Float32Array>();

  const getHorizontalRow = (sourceY: number): Float32Array => {
    const cached = rowCache.get(sourceY);
    if (cached) return cached;
    const row = resampleHorizontalRow(source, srcW, sourceY, dstW, horizontal);
    rowCache.set(sourceY, row);
    return row;
  };

  for (let y = 0; y < dstH; y += 1) {
    const start = vertical.offsets[y] ?? 0;
    const end = vertical.offsets[y + 1] ?? start;
    let minimumSourceY = srcH;
    for (let tap = start; tap < end; tap += 1) {
      minimumSourceY = Math.min(minimumSourceY, vertical.indices[tap] ?? srcH);
    }
    for (const cachedY of rowCache.keys()) {
      if (cachedY < minimumSourceY) rowCache.delete(cachedY);
    }

    const outputRow = y * dstW * 3;
    for (let x = 0; x < dstW; x += 1) {
      let r = 0;
      let g = 0;
      let b = 0;
      const x3 = x * 3;
      for (let tap = start; tap < end; tap += 1) {
        const sourceY = vertical.indices[tap] ?? 0;
        const weight = vertical.weights[tap] ?? 0;
        const row = getHorizontalRow(sourceY);
        r += (row[x3] ?? 0) * weight;
        g += (row[x3 + 1] ?? 0) * weight;
        b += (row[x3 + 2] ?? 0) * weight;
      }
      const dst = outputRow + x3;
      result[dst] = clampUint16(r);
      result[dst + 1] = clampUint16(g);
      result[dst + 2] = clampUint16(b);
    }
  }

  return result;
}
