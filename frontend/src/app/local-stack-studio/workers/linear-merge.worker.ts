// Local Stack Studio Blend/STF stripe worker. Built to public/generated/local-stack-studio.
import { addWeightedLinearToAccumulator, mergeLinearFloatIntoAccumulator } from "../stack/linear-merge";
import {
  computeStfExperimentBlurTerms,
  computeStfExperimentOriginallyUnsharpGate,
  computeStfExperimentResponses,
  isStfExperimentMode,
  resolveStfExperimentBlurRadius,
  resolveStfExperimentHalo,
  sameFNumber,
  type StfExperimentMode,
} from "../stack/stf-experiments";
import { applyStfToneMatchInPlace, buildStfToneMatchLut, type StfToneMatchLut } from "../stack/stf-tone-match";
import { WorkerCanonicalReader } from "../stack/worker-canonical-reader";
import type {
  LinearMergeWorkerMaskDiagnostics,
  LinearMergeWorkerMetricStats,
  LinearMergeWorkerMode,
  LinearMergeWorkerRequest,
  LinearMergeWorkerResponse,
} from "./protocols/linear-merge-protocol";

type WorkerScope = {
  onmessage: ((event: MessageEvent<LinearMergeWorkerRequest>) => void | Promise<void>) | null;
  postMessage: (message: LinearMergeWorkerResponse, transfer?: Transferable[]) => void;
};

const workerScope = globalThis as unknown as WorkerScope;
let reader: WorkerCanonicalReader | null = null;
let mode: LinearMergeWorkerMode = "average";
let gains: Float32Array | null = null;
let scaledLogs: Float32Array | null = null;
let weights: Float32Array | null = null;
let fNumbers: Float32Array | null = null;
let apertureOrder: Int32Array | null = null;
let toneMatchLuts: Array<StfToneMatchLut | null> | null = null;
let exposureRolloffMaxP998AfterGain: Array<number | null> | null = null;
let stfBlurAnalysisOnly = false;
let stfBlurMaskScaleK = 0;

const MASK_DIAGNOSTIC_HISTOGRAM_BINS = 2048;

workerScope.onmessage = async (event: MessageEvent<LinearMergeWorkerRequest>) => {
  const message = event.data;
  const requestId = Number(message?.requestId);
  try {
    if (message.type === "init") {
      reader?.close();
      reader = await WorkerCanonicalReader.open({
        sessionId: message.sessionId,
        alignmentPlan: message.alignmentPlan,
        matrices: message.matrices,
        cacheBytes: message.cacheBytes,
      });
      mode = message.mode;
      gains = new Float32Array(message.gains);
      scaledLogs = new Float32Array(message.scaledLogs);
      weights = new Float32Array(message.weights);
      fNumbers = message.fNumbers ? new Float32Array(message.fNumbers) : null;
      apertureOrder = message.apertureOrder ? new Int32Array(message.apertureOrder) : null;
      toneMatchLuts = Array.from({ length: gains.length }, (_, index) => {
        const gain = gains![index];
        const scaledLog = scaledLogs![index];
        return Math.abs(gain - 1) > 1e-8 || Math.abs(scaledLog) > 1e-8
          ? buildStfToneMatchLut(gain, scaledLog)
          : null;
      });
      exposureRolloffMaxP998AfterGain = Array.from(message.exposureRolloffMaxP998AfterGain, (value) =>
        typeof value === "number" && Number.isFinite(value) ? value : null,
      );
      stfBlurAnalysisOnly = message.stfBlurAnalysisOnly === true;
      stfBlurMaskScaleK = typeof message.stfBlurMaskScaleK === "number" && Number.isFinite(message.stfBlurMaskScaleK)
        ? message.stfBlurMaskScaleK
        : 0;
      if (
        gains.length !== reader.imageCount ||
        scaledLogs.length !== reader.imageCount ||
        weights.length !== reader.imageCount ||
        exposureRolloffMaxP998AfterGain.length !== reader.imageCount
      ) {
        throw new Error("Linear merge worker configuration length does not match image count.");
      }
      if (isStfExperimentMode(mode) || mode === "stf-blur") {
        if (!fNumbers || fNumbers.length !== reader.imageCount || !apertureOrder || apertureOrder.length !== reader.imageCount) {
          throw new Error("STF sharpness-analysis mode requires valid F-number ordering.");
        }
      }
      post({
        type: "ready",
        requestId,
        imageCount: reader.imageCount,
        width: reader.width,
        height: reader.height,
      });
      return;
    }

    if (message.type === "merge-stripe") {
      if (!reader || !gains || !scaledLogs || !weights || !exposureRolloffMaxP998AfterGain) {
        throw new Error("Linear merge worker is not initialized.");
      }
      const y = Number(message.y);
      const height = Number(message.height);
      if (!(Number.isInteger(y) && y >= 0 && Number.isInteger(height) && height > 0 && y + height <= reader.height)) {
        throw new Error("Linear merge worker received an invalid stripe region.");
      }
      let linearBuffer: ArrayBuffer;
      let maskStats: { sum: number; sumSquares: number; pixelCount: number } | null = null;
      let maskDiagnostics: LinearMergeWorkerMaskDiagnostics | null = null;
      if (isStfExperimentMode(mode) || mode === "stf-blur") {
        const result = await buildExperimentOrBlurStripe(mode, y, height);
        linearBuffer = result.linearBuffer;
        maskStats = result.maskStats;
        maskDiagnostics = result.maskDiagnostics;
      } else {
        linearBuffer = await buildStandardMergeStripe(y, height);
      }
      post({
        type: "merge-stripe-result",
        requestId,
        y,
        height,
        linearBuffer,
        ...(maskStats ? {
          maskSum: maskStats.sum,
          maskSumSquares: maskStats.sumSquares,
          maskPixelCount: maskStats.pixelCount,
        } : {}),
        ...(maskDiagnostics ? { maskDiagnostics } : {}),
      }, [linearBuffer]);
      return;
    }

    throw new Error(`Unsupported linear merge worker request: ${String((message as { type?: unknown }).type)}`);
  } catch (error) {
    post({
      type: "error",
      requestId,
      message: error instanceof Error ? error.message : String(error),
    });
  }
};

async function buildStandardMergeStripe(y: number, height: number): Promise<ArrayBuffer> {
  if (!reader || !gains || !scaledLogs || !weights || !exposureRolloffMaxP998AfterGain) {
    throw new Error("Linear merge worker is not initialized.");
  }
  const accumulator = new Float32Array(reader.width * height * 3);
  // Preserve the historical Float32 accumulation order exactly. Different
  // output stripes may run concurrently, but every stripe visits inputs in
  // the same image-index order as the former full-image loop.
  for (let imageIndex = 0; imageIndex < reader.imageCount; imageIndex += 1) {
    const linear = await reader.readLinearRegion(imageIndex, 0, y, reader.width, height);
    const toneMatchLut = toneMatchLuts?.[imageIndex] ?? null;
    if (toneMatchLut) {
      applyStfToneMatchInPlace(
        linear,
        gains[imageIndex],
        scaledLogs[imageIndex],
        toneMatchLut,
      );
      addWeightedLinearToAccumulator(accumulator, linear, weights[imageIndex]);
    } else {
      mergeLinearFloatIntoAccumulator(
        linear,
        accumulator,
        gains[imageIndex],
        weights[imageIndex],
        null,
        exposureRolloffMaxP998AfterGain[imageIndex],
      );
    }
  }
  return accumulator.buffer as ArrayBuffer;
}

async function buildExperimentOrBlurStripe(
  experimentMode: StfExperimentMode | "stf-blur",
  y: number,
  height: number,
): Promise<{
  linearBuffer: ArrayBuffer;
  maskStats: { sum: number; sumSquares: number; pixelCount: number } | null;
  maskDiagnostics: LinearMergeWorkerMaskDiagnostics | null;
}> {
  if (!reader || !gains || !scaledLogs || !weights || !fNumbers || !apertureOrder) {
    throw new Error("STF sharpness-analysis worker is not initialized.");
  }
  const blurRadius = resolveStfExperimentBlurRadius(reader.width, reader.height);
  const halo = resolveStfExperimentHalo(reader.width, reader.height);
  const readY = Math.max(0, y - halo);
  const readBottom = Math.min(reader.height, y + height + halo);
  const readHeight = readBottom - readY;
  const pixelCount = reader.width * readHeight;
  const dofPeakRise = new Float32Array(pixelCount);
  const cocPeakRise = new Float32Array(pixelCount);
  const cocPeakSharpness = new Float32Array(pixelCount);
  const cocBaselineSharpness = new Float32Array(pixelCount);
  const maxSharpness = new Float32Array(pixelCount);
  let apertureGroupCount = 0;
  let previousSharpness: Float32Array | null = null;
  let orderIndex = 0;
  while (orderIndex < apertureOrder.length) {
    const firstImageIndex = apertureOrder[orderIndex];
    const groupFNumber = Number(fNumbers?.[firstImageIndex]);
    if (!(Number.isFinite(groupFNumber) && groupFNumber > 0)) {
      throw new Error("STF experiment worker received an invalid F-number group.");
    }

    const groupSharpness = new Float32Array(pixelCount);
    let groupCount = 0;
    while (orderIndex < apertureOrder.length) {
      const imageIndex = apertureOrder[orderIndex];
      const currentFNumber = Number(fNumbers?.[imageIndex]);
      if (!sameFNumber(currentFNumber, groupFNumber)) break;
      const linear = await reader.readLinearRegion(imageIndex, 0, readY, reader.width, readHeight);
      const toneMatchLut = toneMatchLuts?.[imageIndex] ?? null;
      if (toneMatchLut) {
        applyStfToneMatchInPlace(linear, gains[imageIndex], scaledLogs[imageIndex], toneMatchLut);
      }
      const sharpness = buildSharpnessMap(linear, reader.width, readHeight);
      for (let index = 0; index < pixelCount; index += 1) {
        groupSharpness[index] += sharpness[index] ?? 0;
      }
      groupCount += 1;
      orderIndex += 1;
    }
    if (groupCount <= 0) {
      throw new Error("STF experiment worker could not build an aperture group.");
    }
    if (groupCount > 1) {
      const inverseCount = 1 / groupCount;
      for (let index = 0; index < pixelCount; index += 1) {
        groupSharpness[index] *= inverseCount;
      }
    }

    for (let index = 0; index < pixelCount; index += 1) {
      const curr = groupSharpness[index] ?? 0;
      if (apertureGroupCount === 0 || curr > maxSharpness[index]) maxSharpness[index] = curr;
    }
    apertureGroupCount += 1;

    if (previousSharpness) {
      for (let index = 0; index < pixelCount; index += 1) {
        const prev = previousSharpness[index] ?? 0;
        const curr = groupSharpness[index] ?? 0;
        if (curr > prev) {
          const rise = curr - prev;
          if (rise > dofPeakRise[index]) dofPeakRise[index] = rise;
        } else if (prev > curr) {
          const rise = prev - curr;
          if (rise > cocPeakRise[index]) {
            cocPeakRise[index] = rise;
            // apertureOrder is open -> stopped down.  For the reverse
            // (stopped -> open) CoC rise, curr is the sharpness immediately
            // before the rise and prev is the sharpness immediately after it.
            cocBaselineSharpness[index] = curr;
            cocPeakSharpness[index] = prev;
          }
        }
      }
    }
    previousSharpness = groupSharpness;
  }
  if (apertureGroupCount < 2) {
    throw new Error("STF experiment requires at least two distinct aperture groups.");
  }

  let blurMask: Float32Array | null = null;
  let blurProtection: Float32Array | null = null;
  if (experimentMode === "stf-exp-blur" || experimentMode === "stf-blur") {
    blurMask = new Float32Array(pixelCount);
    blurProtection = new Float32Array(pixelCount);
  }
  const scalar = new Float32Array(pixelCount);
  const diagnosticStats = experimentMode === "stf-blur"
    ? {
        support: createWorkerMetricStats(),
        originallyUnsharpGate: createWorkerMetricStats(),
        rawBlur: createWorkerMetricStats(),
      }
    : null;
  const coreStartIndex = (y - readY) * reader.width;
  const coreEndIndex = coreStartIndex + height * reader.width;
  for (let index = 0; index < pixelCount; index += 1) {
    // Blur uses the strongest single rise toward the open side.  Its baseline
    // is the sharpness immediately before that same rise, not the minimum from
    // an unrelated aperture.
    const blurBaselineSharpness = Math.max(0, cocBaselineSharpness[index]);
    const blurPeakSharpness = Math.max(0, cocPeakSharpness[index]);
    let value: number;
    if (experimentMode === "stf-blur") {
      const terms = computeStfExperimentBlurTerms(
        cocPeakRise[index],
        dofPeakRise[index],
        blurPeakSharpness,
        blurBaselineSharpness,
      );
      if (diagnosticStats && index >= coreStartIndex && index < coreEndIndex) {
        addWorkerMetricSample(diagnosticStats.support, terms.support);
        addWorkerMetricSample(diagnosticStats.originallyUnsharpGate, terms.originallyUnsharpGate);
        addWorkerMetricSample(diagnosticStats.rawBlur, terms.rawBlur);
      }
      value = terms.rawBlur;
    } else if (experimentMode === "stf-exp-blur") {
      value = computeStfExperimentBlurTerms(
        cocPeakRise[index],
        dofPeakRise[index],
        blurPeakSharpness,
        blurBaselineSharpness,
      ).rawBlur;
    } else {
      const responses = computeStfExperimentResponses(
        cocPeakRise[index],
        dofPeakRise[index],
        maxSharpness[index],
      );
      value = experimentMode === "stf-exp-dof" ? responses.dof : responses.coc;
    }
    scalar[index] = value;
    if (blurMask && blurProtection) {
      blurMask[index] = value;
      blurProtection[index] = computeStfExperimentOriginallyUnsharpGate(
        blurPeakSharpness,
        blurBaselineSharpness,
      );
    }
  }
  if (blurMask && blurProtection) {
    const smoothed = boxBlurGray(blurMask, reader.width, readHeight, blurRadius);
    for (let index = 0; index < pixelCount; index += 1) {
      // Spatial smoothing must not leak Blur into edges that were classified as
      // already sharp.  Re-apply the protection gate after smoothing.
      scalar[index] = smoothed[index] * blurProtection[index];
    }
  }

  if ((experimentMode === "stf-blur" || experimentMode === "stf-exp-blur") && Math.abs(stfBlurMaskScaleK) > 1e-9) {
    applyScaledLogMaskInPlace(scalar, stfBlurMaskScaleK);
  }

  if (experimentMode === "stf-blur") {
    if (!diagnosticStats) {
      throw new Error("STF Blur diagnostics were not initialized.");
    }
    const finalMaskStats = computeCoreUnitStats(scalar, reader.width, readY, y, height);
    const maskDiagnostics: LinearMergeWorkerMaskDiagnostics = {
      ...diagnosticStats,
      finalMask: finalMaskStats,
    };
    const maskStats = {
      sum: finalMaskStats.sum,
      sumSquares: finalMaskStats.sumSquares,
      pixelCount: finalMaskStats.pixelCount,
    };
    if (stfBlurAnalysisOnly) {
      return {
        linearBuffer: cropScalarStripeToRgbBuffer(scalar, reader.width, readHeight, readY, y, height).buffer as ArrayBuffer,
        maskStats,
        maskDiagnostics,
      };
    }
    // Apply the current Exp.3 Blur mask to the ordinary STF result.
    const stfLinear = new Float32Array(await buildStandardMergeStripe(readY, readHeight));
    const blurred = gaussianBlurRgb(stfLinear, reader.width, readHeight, blurRadius);
    const mixed = new Float32Array(stfLinear.length);
    for (let pixel = 0, source = 0; pixel < pixelCount; pixel += 1, source += 3) {
      const mask = scalar[pixel] ?? 0;
      const keep = 1 - mask;
      mixed[source] = stfLinear[source] * keep + blurred[source] * mask;
      mixed[source + 1] = stfLinear[source + 1] * keep + blurred[source + 1] * mask;
      mixed[source + 2] = stfLinear[source + 2] * keep + blurred[source + 2] * mask;
    }
    return {
      linearBuffer: cropRgbStripe(mixed, reader.width, readHeight, readY, y, height).buffer as ArrayBuffer,
      maskStats,
      maskDiagnostics,
    };
  }

  return {
    linearBuffer: cropScalarStripeToRgbBuffer(scalar, reader.width, readHeight, readY, y, height).buffer as ArrayBuffer,
    maskStats: null,
    maskDiagnostics: null,
  };
}


function applyScaledLogMaskInPlace(mask: Float32Array, k: number): void {
  if (!(Math.abs(k) > 1e-9)) return;
  const denominator = Math.log1p(k);
  if (!Number.isFinite(denominator) || Math.abs(denominator) < 1e-12) return;
  for (let index = 0; index < mask.length; index += 1) {
    const value = mask[index] ?? 0;
    if (!(value > 0)) {
      mask[index] = 0;
    } else if (value >= 1) {
      mask[index] = 1;
    } else {
      const mapped = Math.log1p(k * value) / denominator;
      mask[index] = Number.isFinite(mapped) ? Math.max(0, Math.min(1, mapped)) : value;
    }
  }
}

function createWorkerMetricStats(): LinearMergeWorkerMetricStats {
  return {
    sum: 0,
    sumSquares: 0,
    max: 0,
    pixelCount: 0,
    histogram: new Uint32Array(MASK_DIAGNOSTIC_HISTOGRAM_BINS),
  };
}

function addWorkerMetricSample(stats: LinearMergeWorkerMetricStats, sample: number): void {
  const value = Math.max(0, Math.min(1, Number.isFinite(sample) ? sample : 0));
  stats.sum += value;
  stats.sumSquares += value * value;
  if (value > stats.max) stats.max = value;
  stats.pixelCount += 1;
  const bin = Math.min(stats.histogram.length - 1, Math.floor(value * stats.histogram.length));
  stats.histogram[bin] += 1;
}

function computeCoreUnitStats(
  map: Float32Array,
  width: number,
  sourceY: number,
  targetY: number,
  targetHeight: number,
): LinearMergeWorkerMetricStats {
  const startRow = targetY - sourceY;
  if (!(startRow >= 0)) throw new Error("Invalid Blur mask core start row.");
  const stats = createWorkerMetricStats();
  for (let y = 0; y < targetHeight; y += 1) {
    const row = (startRow + y) * width;
    for (let x = 0; x < width; x += 1) {
      addWorkerMetricSample(stats, map[row + x] ?? 0);
    }
  }
  return stats;
}

function buildSharpnessMap(linear: Float32Array, width: number, height: number): Float32Array {
  const luminance = buildLuminance(linear);
  const blurred = binomialBlurGray(luminance, width, height);
  return sobelMagnitudeGray(blurred, width, height);
}

function buildLuminance(linear: Float32Array): Float32Array {
  const luminance = new Float32Array(linear.length / 3);
  for (let source = 0, pixel = 0; source < linear.length; source += 3, pixel += 1) {
    luminance[pixel] = (linear[source] ?? 0) * 0.3 + (linear[source + 1] ?? 0) * 0.5 + (linear[source + 2] ?? 0) * 0.2;
  }
  return luminance;
}

function binomialBlurGray(source: Float32Array, width: number, height: number): Float32Array {
  const temp = new Float32Array(source.length);
  const output = new Float32Array(source.length);
  for (let y = 0; y < height; y += 1) {
    const row = y * width;
    for (let x = 0; x < width; x += 1) {
      const left = source[row + Math.max(0, x - 1)] ?? 0;
      const center = source[row + x] ?? 0;
      const right = source[row + Math.min(width - 1, x + 1)] ?? 0;
      temp[row + x] = (left + center * 2 + right) * 0.25;
    }
  }
  for (let y = 0; y < height; y += 1) {
    const y0 = Math.max(0, y - 1);
    const y1 = Math.min(height - 1, y + 1);
    for (let x = 0; x < width; x += 1) {
      const top = temp[y0 * width + x] ?? 0;
      const center = temp[y * width + x] ?? 0;
      const bottom = temp[y1 * width + x] ?? 0;
      output[y * width + x] = (top + center * 2 + bottom) * 0.25;
    }
  }
  return output;
}

function sobelMagnitudeGray(source: Float32Array, width: number, height: number): Float32Array {
  const output = new Float32Array(source.length);
  for (let y = 0; y < height; y += 1) {
    const ym1 = Math.max(0, y - 1);
    const yp1 = Math.min(height - 1, y + 1);
    for (let x = 0; x < width; x += 1) {
      const xm1 = Math.max(0, x - 1);
      const xp1 = Math.min(width - 1, x + 1);
      const p00 = source[ym1 * width + xm1] ?? 0;
      const p01 = source[ym1 * width + x] ?? 0;
      const p02 = source[ym1 * width + xp1] ?? 0;
      const p10 = source[y * width + xm1] ?? 0;
      const p12 = source[y * width + xp1] ?? 0;
      const p20 = source[yp1 * width + xm1] ?? 0;
      const p21 = source[yp1 * width + x] ?? 0;
      const p22 = source[yp1 * width + xp1] ?? 0;
      const gx = -p00 + p02 - 2 * p10 + 2 * p12 - p20 + p22;
      const gy = -p00 - 2 * p01 - p02 + p20 + 2 * p21 + p22;
      output[y * width + x] = Math.hypot(gx, gy) * 0.125;
    }
  }
  return output;
}

function boxBlurGray(source: Float32Array, width: number, height: number, radius: number): Float32Array {
  if (!(radius > 0)) return new Float32Array(source);
  let current = new Float32Array(source);
  for (let pass = 0; pass < 2; pass += 1) {
    const horizontal = new Float32Array(source.length);
    const vertical = new Float32Array(source.length);
    for (let y = 0; y < height; y += 1) {
      const row = y * width;
      let sum = 0;
      for (let x = -radius; x <= radius; x += 1) {
        const sampleX = Math.max(0, Math.min(width - 1, x));
        sum += current[row + sampleX] ?? 0;
      }
      for (let x = 0; x < width; x += 1) {
        horizontal[row + x] = sum / (radius * 2 + 1);
        const removeX = Math.max(0, Math.min(width - 1, x - radius));
        const addX = Math.max(0, Math.min(width - 1, x + radius + 1));
        sum += (current[row + addX] ?? 0) - (current[row + removeX] ?? 0);
      }
    }
    for (let x = 0; x < width; x += 1) {
      let sum = 0;
      for (let y0 = -radius; y0 <= radius; y0 += 1) {
        const sampleY = Math.max(0, Math.min(height - 1, y0));
        sum += horizontal[sampleY * width + x] ?? 0;
      }
      for (let y = 0; y < height; y += 1) {
        vertical[y * width + x] = sum / (radius * 2 + 1);
        const removeY = Math.max(0, Math.min(height - 1, y - radius));
        const addY = Math.max(0, Math.min(height - 1, y + radius + 1));
        sum += (horizontal[addY * width + x] ?? 0) - (horizontal[removeY * width + x] ?? 0);
      }
    }
    current = vertical;
  }
  return current;
}

function gaussianBlurRgb(source: Float32Array, width: number, height: number, radius: number): Float32Array {
  if (!(radius > 0)) return new Float32Array(source);
  const sigma = Math.max(0.75, radius / 2);
  const kernelSize = radius * 2 + 1;
  const kernel = new Float32Array(kernelSize);
  let kernelSum = 0;
  for (let offset = -radius; offset <= radius; offset += 1) {
    const value = Math.exp(-(offset * offset) / (2 * sigma * sigma));
    kernel[offset + radius] = value;
    kernelSum += value;
  }
  for (let index = 0; index < kernel.length; index += 1) kernel[index] /= kernelSum;

  const temp = new Float32Array(source.length);
  const output = new Float32Array(source.length);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const dst = (y * width + x) * 3;
      let r = 0;
      let g = 0;
      let b = 0;
      for (let offset = -radius; offset <= radius; offset += 1) {
        const sampleX = Math.max(0, Math.min(width - 1, x + offset));
        const src = (y * width + sampleX) * 3;
        const weight = kernel[offset + radius];
        r += source[src] * weight;
        g += source[src + 1] * weight;
        b += source[src + 2] * weight;
      }
      temp[dst] = r;
      temp[dst + 1] = g;
      temp[dst + 2] = b;
    }
  }
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const dst = (y * width + x) * 3;
      let r = 0;
      let g = 0;
      let b = 0;
      for (let offset = -radius; offset <= radius; offset += 1) {
        const sampleY = Math.max(0, Math.min(height - 1, y + offset));
        const src = (sampleY * width + x) * 3;
        const weight = kernel[offset + radius];
        r += temp[src] * weight;
        g += temp[src + 1] * weight;
        b += temp[src + 2] * weight;
      }
      output[dst] = r;
      output[dst + 1] = g;
      output[dst + 2] = b;
    }
  }
  return output;
}

function cropRgbStripe(
  source: Float32Array,
  width: number,
  sourceHeight: number,
  sourceY: number,
  targetY: number,
  targetHeight: number,
): Float32Array {
  const startRow = targetY - sourceY;
  if (!(startRow >= 0 && startRow + targetHeight <= sourceHeight)) {
    throw new Error("Invalid STF blur stripe crop.");
  }
  const rowLength = width * 3;
  const output = new Float32Array(rowLength * targetHeight);
  for (let y = 0; y < targetHeight; y += 1) {
    const sourceStart = (startRow + y) * rowLength;
    const targetStart = y * rowLength;
    output.set(source.subarray(sourceStart, sourceStart + rowLength), targetStart);
  }
  return output;
}

function cropScalarStripeToRgbBuffer(
  source: Float32Array,
  width: number,
  sourceHeight: number,
  sourceY: number,
  targetY: number,
  targetHeight: number,
): Float32Array {
  const startRow = targetY - sourceY;
  if (!(startRow >= 0 && startRow + targetHeight <= sourceHeight)) {
    throw new Error("Invalid experiment stripe crop.");
  }
  const output = new Float32Array(width * targetHeight * 3);
  for (let y = 0; y < targetHeight; y += 1) {
    const sourceRow = (startRow + y) * width;
    const targetRow = y * width * 3;
    for (let x = 0; x < width; x += 1) {
      const value = source[sourceRow + x] ?? 0;
      const targetIndex = targetRow + x * 3;
      output[targetIndex] = value;
      output[targetIndex + 1] = value;
      output[targetIndex + 2] = value;
    }
  }
  return output;
}

function post(message: LinearMergeWorkerResponse, transfer: Transferable[] = []): void {
  workerScope.postMessage(message, transfer);
}
