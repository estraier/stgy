/// <reference lib="webworker" />

type RawThumbnailAnalysisTimingEntry = {
  name: string;
  elapsedMs: number;
};

type RawThumbnailAnalysisRequest = {
  type: "analyze";
  format: "jpeg" | "bitmap";
  width: number;
  height: number;
  dataBuffer: ArrayBuffer;
  targetPixels: number;
  percentiles: number[];
  colorLowerValuePercentiles: number[];
  colorUpperValuePercentile: number;
  saturationPercentile: number;
  vibrancePercentile: number;
};

type RawThumbnailColorTarget = {
  lowerValuePercentile: number;
  saturationP95: number;
  saturationP50: number;
};

type RawThumbnailAnalysisResponse = {
  type: "thumbnail-analysis-complete";
  lumaPercentiles: number[];
  saturationPercentiles: number[];
  sampleBuffer: ArrayBuffer;
  colorTargets: RawThumbnailColorTarget[];
  timingEntries: RawThumbnailAnalysisTimingEntry[];
};

const workerScope = self as unknown as DedicatedWorkerGlobalScope;

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function srgbChannelToLinear(value: number): number {
  const x = clamp01(value / 255);
  if (x <= 0.04045) return x / 12.92;
  return Math.pow((x + 0.055) / 1.055, 2.4);
}

// Embedded thumbnails are 8-bit. Avoid millions of repeated pow() calls while
// area-averaging the analysis sample; 256 exact double values are enough.
const SRGB8_TO_LINEAR_LUT = (() => {
  const lut = new Array<number>(256);
  for (let value = 0; value < lut.length; value++) {
    lut[value] = srgbChannelToLinear(value);
  }
  return lut;
})();

function analysisSampleDimensions(
  width: number,
  height: number,
  targetPixels: number,
): { width: number; height: number } {
  const sourceW = Number.isFinite(width) && width > 0 ? width : 1;
  const sourceH = Number.isFinite(height) && height > 0 ? height : 1;
  const normalizedTarget = Number.isFinite(targetPixels) && targetPixels > 0 ? targetPixels : 65_536;
  const scale = Math.min(1, Math.sqrt(normalizedTarget / (sourceW * sourceH)));
  return {
    width: Math.max(1, Math.round(sourceW * scale)),
    height: Math.max(1, Math.round(sourceH * scale)),
  };
}

function areaAverageRawThumbnailLinearSrgbSample(
  source: Uint8Array | Uint8ClampedArray,
  sourceWidth: number,
  sourceHeight: number,
  channels: number,
  targetPixels: number,
): { data: Float32Array; width: number; height: number } | null {
  if (sourceWidth <= 0 || sourceHeight <= 0 || channels < 3) return null;
  if (source.length < sourceWidth * sourceHeight * channels) return null;
  const dimensions = analysisSampleDimensions(sourceWidth, sourceHeight, targetPixels);
  const sampleW = dimensions.width;
  const sampleH = dimensions.height;
  const sample = new Float32Array(sampleW * sampleH * 3);
  for (let y = 0; y < sampleH; y++) {
    const sy0 = y * sourceHeight / sampleH;
    const sy1 = (y + 1) * sourceHeight / sampleH;
    const iy0 = Math.max(0, Math.floor(sy0));
    const iy1 = Math.min(sourceHeight, Math.ceil(sy1));
    for (let x = 0; x < sampleW; x++) {
      const sx0 = x * sourceWidth / sampleW;
      const sx1 = (x + 1) * sourceWidth / sampleW;
      const ix0 = Math.max(0, Math.floor(sx0));
      const ix1 = Math.min(sourceWidth, Math.ceil(sx1));
      let sumR = 0;
      let sumG = 0;
      let sumB = 0;
      let totalWeight = 0;
      for (let sy = iy0; sy < iy1; sy++) {
        const wy = Math.max(0, Math.min(sy + 1, sy1) - Math.max(sy, sy0));
        if (!(wy > 0)) continue;
        for (let sx = ix0; sx < ix1; sx++) {
          const wx = Math.max(0, Math.min(sx + 1, sx1) - Math.max(sx, sx0));
          const area = wx * wy;
          if (!(area > 0)) continue;
          const sourceIndex = (sy * sourceWidth + sx) * channels;
          sumR += (SRGB8_TO_LINEAR_LUT[source[sourceIndex] ?? 0] ?? 0) * area;
          sumG += (SRGB8_TO_LINEAR_LUT[source[sourceIndex + 1] ?? 0] ?? 0) * area;
          sumB += (SRGB8_TO_LINEAR_LUT[source[sourceIndex + 2] ?? 0] ?? 0) * area;
          totalWeight += area;
        }
      }
      const invWeight = totalWeight > 0 ? 1 / totalWeight : 0;
      const targetIndex = (y * sampleW + x) * 3;
      sample[targetIndex] = sumR * invWeight;
      sample[targetIndex + 1] = sumG * invWeight;
      sample[targetIndex + 2] = sumB * invWeight;
    }
  }
  return { data: sample, width: sampleW, height: sampleH };
}

function medianFilterChannel5x5(source: Float32Array, width: number, height: number): Float32Array {
  const output = new Float32Array(source.length);
  const scratch = new Float32Array(25);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let count = 0;
      for (let dy = -2; dy <= 2; dy++) {
        const sy = Math.max(0, Math.min(height - 1, y + dy));
        for (let dx = -2; dx <= 2; dx++) {
          const sx = Math.max(0, Math.min(width - 1, x + dx));
          scratch[count++] = source[sy * width + sx] ?? 0;
        }
      }
      for (let i = 1; i < count; i++) {
        const value = scratch[i] ?? 0;
        let j = i - 1;
        while (j >= 0 && (scratch[j] ?? 0) > value) {
          scratch[j + 1] = scratch[j] ?? 0;
          j--;
        }
        scratch[j + 1] = value;
      }
      output[y * width + x] = scratch[Math.floor(count / 2)] ?? 0;
    }
  }
  return output;
}

function percentileFromSortedValues(values: number[], percentile: number): number {
  if (!values.length) return 0;
  const rank = (values.length - 1) * Math.min(100, Math.max(0, percentile)) / 100;
  const lower = Math.floor(rank);
  const upper = Math.ceil(rank);
  const fraction = rank - lower;
  const lo = values[lower] ?? 0;
  const hi = values[upper] ?? lo;
  return lo + (hi - lo) * fraction;
}

function percentilesFromValues(values: number[], percentiles: readonly number[]): number[] {
  if (!values.length) return percentiles.map(() => 0);
  const normalized = percentiles.map((percentile) => Math.min(100, Math.max(0, percentile)));
  const needsSortedValues = normalized.some((percentile) => percentile > 0 && percentile < 100);
  if (!needsSortedValues) {
    let min = values[0] ?? 0;
    let max = min;
    for (let i = 1; i < values.length; i++) {
      const value = values[i] ?? min;
      min = Math.min(min, value);
      max = Math.max(max, value);
    }
    return normalized.map((percentile) => percentile <= 0 ? min : max);
  }
  values.sort((a, b) => a - b);
  return normalized.map((percentile) => percentileFromSortedValues(values, percentile));
}

function saturationFromRgb(r: number, g: number, b: number): number {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;
  return max <= 1e-6 ? 0 : clamp01(delta / max);
}

function histogramPercentile(
  histogram: Uint32Array,
  sampleCount: number,
  percentile: number,
): number {
  if (sampleCount <= 0) return 0;
  const rank = (sampleCount - 1) * Math.min(100, Math.max(0, percentile)) / 100;
  const lowerRank = Math.floor(rank);
  const upperRank = Math.ceil(rank);
  const fraction = rank - lowerRank;
  let cumulative = 0;
  let lowerLevel = histogram.length - 1;
  let upperLevel = histogram.length - 1;
  let lowerFound = false;
  for (let level = 0; level < histogram.length; level++) {
    cumulative += histogram[level] ?? 0;
    if (!lowerFound && cumulative > lowerRank) {
      lowerLevel = level;
      lowerFound = true;
    }
    if (cumulative > upperRank) {
      upperLevel = level;
      break;
    }
  }
  return lowerLevel + (upperLevel - lowerLevel) * fraction;
}

function buildThumbnailColorTargets(
  sample: Float32Array,
  lowerPercentiles: readonly number[],
  upperPercentile: number,
  saturationPercentile: number,
  vibrancePercentile: number,
): RawThumbnailColorTarget[] {
  const count = Math.floor(sample.length / 3);
  if (count <= 0) return [];
  const saturationValues = new Float32Array(count);
  const valueValues = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    const si = i * 3;
    const r = clamp01(sample[si] ?? 0);
    const g = clamp01(sample[si + 1] ?? 0);
    const b = clamp01(sample[si + 2] ?? 0);
    saturationValues[i] = saturationFromRgb(r, g, b);
    valueValues[i] = Math.max(r, g, b);
  }
  const sortedIndices = Array.from({ length: count }, (_, index) => index);
  sortedIndices.sort((a, b) => {
    const diff = (valueValues[a] ?? 0) - (valueValues[b] ?? 0);
    return diff !== 0 ? diff : a - b;
  });
  const bins = 4096;
  return lowerPercentiles.map((lowerValuePercentile) => {
    const lower = Math.min(100, Math.max(0, lowerValuePercentile));
    const upper = Math.min(100, Math.max(lower, upperPercentile));
    const start = Math.min(count - 1, Math.max(0, Math.floor(count * lower / 100)));
    const end = Math.max(start + 1, Math.min(count, Math.ceil(count * upper / 100)));
    const histogram = new Uint32Array(bins);
    for (let position = start; position < end; position++) {
      const index = sortedIndices[position] ?? 0;
      const saturation = saturationValues[index] ?? 0;
      histogram[Math.min(bins - 1, Math.max(0, Math.round(saturation * (bins - 1))))]++;
    }
    const selectedCount = end - start;
    return {
      lowerValuePercentile,
      saturationP95: histogramPercentile(histogram, selectedCount, saturationPercentile) / (bins - 1),
      saturationP50: histogramPercentile(histogram, selectedCount, vibrancePercentile) / (bins - 1),
    };
  });
}

function postError(error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  workerScope.postMessage({ type: "error", message });
}

workerScope.onmessage = async (event: MessageEvent<RawThumbnailAnalysisRequest>) => {
  const timings: RawThumbnailAnalysisTimingEntry[] = [];
  const measure = <T,>(name: string, task: () => T): T => {
    const startedAt = performance.now();
    try {
      return task();
    } finally {
      timings.push({ name, elapsedMs: performance.now() - startedAt });
    }
  };
  const measureAsync = async <T,>(name: string, task: () => Promise<T>): Promise<T> => {
    const startedAt = performance.now();
    try {
      return await task();
    } finally {
      timings.push({ name, elapsedMs: performance.now() - startedAt });
    }
  };

  try {
    const message = event.data;
    if (message.type !== "analyze") return;
    const sourceBytes = new Uint8Array(message.dataBuffer);
    let resized: { data: Float32Array; width: number; height: number } | null = null;

    if (message.format === "bitmap") {
      const pixelCount = message.width * message.height;
      const channels = sourceBytes.length >= pixelCount * 4 ? 4 : 3;
      resized = measure("Downsampling embedded thumbnail analysis sample", () =>
        areaAverageRawThumbnailLinearSrgbSample(
          sourceBytes,
          message.width,
          message.height,
          channels,
          message.targetPixels,
        ),
      );
    } else {
      const blob = new Blob([sourceBytes.buffer], { type: "image/jpeg" });
      const bitmap = await measureAsync("Decoding embedded thumbnail JPEG", () =>
        createImageBitmap(blob, { colorSpaceConversion: "default" }),
      );
      try {
        if (typeof OffscreenCanvas !== "function") throw new Error("OffscreenCanvas unavailable");
        const width = bitmap.width || message.width;
        const height = bitmap.height || message.height;
        const canvas = new OffscreenCanvas(width, height);
        const ctx = canvas.getContext("2d", { willReadFrequently: true, colorSpace: "srgb" });
        if (!ctx) throw new Error("2D context unavailable");
        measure("Drawing embedded thumbnail to sRGB canvas", () => {
          ctx.drawImage(bitmap, 0, 0, width, height);
        });
        const rgba = measure("Reading embedded thumbnail canvas pixels", () =>
          ctx.getImageData(0, 0, width, height).data,
        );
        resized = measure("Downsampling embedded thumbnail analysis sample", () =>
          areaAverageRawThumbnailLinearSrgbSample(rgba, width, height, 4, message.targetPixels),
        );
      } finally {
        bitmap.close?.();
      }
    }

    if (!resized?.data.length) throw new Error("Embedded thumbnail analysis sample is empty");
    const pixels = resized.width * resized.height;
    const channels = measure("Preparing embedded thumbnail chroma channels", () => {
      const luma = new Float32Array(pixels);
      const chromaR = new Float32Array(pixels);
      const chromaB = new Float32Array(pixels);
      for (let i = 0; i < pixels; i++) {
        const si = i * 3;
        const r = resized!.data[si] ?? 0;
        const g = resized!.data[si + 1] ?? 0;
        const b = resized!.data[si + 2] ?? 0;
        const y = 0.2126 * r + 0.7152 * g + 0.0722 * b;
        luma[i] = y;
        chromaR[i] = r - y;
        chromaB[i] = b - y;
      }
      return { luma, chromaR, chromaB };
    });

    const filteredRPass1 = measure("Embedded thumbnail chroma R median pass 1", () =>
      medianFilterChannel5x5(channels.chromaR, resized!.width, resized!.height),
    );
    const filteredR = measure("Embedded thumbnail chroma R median pass 2", () =>
      medianFilterChannel5x5(filteredRPass1, resized!.width, resized!.height),
    );
    const filteredBPass1 = measure("Embedded thumbnail chroma B median pass 1", () =>
      medianFilterChannel5x5(channels.chromaB, resized!.width, resized!.height),
    );
    const filteredB = measure("Embedded thumbnail chroma B median pass 2", () =>
      medianFilterChannel5x5(filteredBPass1, resized!.width, resized!.height),
    );

    const statisticsSample = measure("Reconstructing embedded thumbnail chroma sample", () => {
      const output = new Float32Array(resized!.data.length);
      for (let i = 0; i < pixels; i++) {
        const y = channels.luma[i] ?? 0;
        const r = y + (filteredR[i] ?? 0);
        const b = y + (filteredB[i] ?? 0);
        const g = (y - 0.2126 * r - 0.0722 * b) / 0.7152;
        const oi = i * 3;
        output[oi] = clamp01(r);
        output[oi + 1] = clamp01(g);
        output[oi + 2] = clamp01(b);
      }
      return output;
    });

    const lumaPercentiles = measure("Computing embedded thumbnail luminance percentiles", () => {
      const values = new Array<number>(pixels);
      for (let i = 0; i < pixels; i++) {
        const si = i * 3;
        values[i] = clamp01(
          0.2126 * (statisticsSample[si] ?? 0)
          + 0.7152 * (statisticsSample[si + 1] ?? 0)
          + 0.0722 * (statisticsSample[si + 2] ?? 0),
        );
      }
      return percentilesFromValues(values, message.percentiles);
    });

    const saturationPercentiles = measure("Computing embedded thumbnail saturation percentiles", () => {
      const values = new Array<number>(pixels);
      for (let i = 0; i < pixels; i++) {
        const si = i * 3;
        values[i] = saturationFromRgb(
          clamp01(statisticsSample[si] ?? 0),
          clamp01(statisticsSample[si + 1] ?? 0),
          clamp01(statisticsSample[si + 2] ?? 0),
        );
      }
      return percentilesFromValues(values, message.percentiles);
    });

    const colorTargets = measure("Precomputing embedded thumbnail color targets", () =>
      buildThumbnailColorTargets(
        statisticsSample,
        message.colorLowerValuePercentiles,
        message.colorUpperValuePercentile,
        message.saturationPercentile,
        message.vibrancePercentile,
      ),
    );

    const sampleBuffer = statisticsSample.buffer as ArrayBuffer;
    const response: RawThumbnailAnalysisResponse = {
      type: "thumbnail-analysis-complete",
      lumaPercentiles,
      saturationPercentiles,
      sampleBuffer,
      colorTargets,
      timingEntries: timings,
    };
    workerScope.postMessage(response, [sampleBuffer]);
  } catch (error) {
    postError(error);
  }
};
