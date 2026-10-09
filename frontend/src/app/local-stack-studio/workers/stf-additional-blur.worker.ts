import { addWeightedLinearToAccumulator, mergeLinearFloatIntoAccumulator } from "../stack/linear-merge";
import {
  STF_ADDITIONAL_BLUR_HISTOGRAM_BINS,
  applyStfAdditionalBlurEdgeProtection,
  applyStfAdditionalBlurScaledLog,
  computeStfAdditionalBlurOriginallyUnsharpGate,
  computeStfAdditionalBlurPersistentEdgeProtection,
  dilateStfAdditionalBlurProtection,
  computeStfAdditionalBlurTerms,
  dequantizeStfAdditionalBlurMask,
  quantizeStfAdditionalBlurMask,
  resolveStfAdditionalBlurApplyHalo,
  resolveStfAdditionalBlurMaskHalo,
  resolveStfAdditionalBlurRadius,
  sameStfAdditionalBlurFNumber,
  stfAdditionalBlurHistogramBin,
} from "../stack/stf-additional-blur";
import { applyStfToneMatchInPlace, buildStfToneMatchLut, type StfToneMatchLut } from "../stack/stf-tone-match";
import { WorkerCanonicalReader } from "../stack/worker-canonical-reader";
import type {
  StfAdditionalBlurWorkerRequest,
  StfAdditionalBlurWorkerResponse,
} from "./protocols/stf-additional-blur-protocol";

type WorkerScope = {
  onmessage: ((event: MessageEvent<StfAdditionalBlurWorkerRequest>) => void | Promise<void>) | null;
  postMessage: (message: StfAdditionalBlurWorkerResponse, transfer?: Transferable[]) => void;
};

const workerScope = globalThis as unknown as WorkerScope;
let reader: WorkerCanonicalReader | null = null;
let gains: Float32Array | null = null;
let scaledLogs: Float32Array | null = null;
let weights: Float32Array | null = null;
let fNumbers: Float32Array | null = null;
let apertureOrder: Int32Array | null = null;
let toneMatchLuts: Array<StfToneMatchLut | null> | null = null;
let exposureRolloffMaxP998AfterGain: Array<number | null> | null = null;

workerScope.onmessage = async (event: MessageEvent<StfAdditionalBlurWorkerRequest>) => {
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
      gains = new Float32Array(message.gains);
      scaledLogs = new Float32Array(message.scaledLogs);
      weights = new Float32Array(message.weights);
      fNumbers = new Float32Array(message.fNumbers);
      apertureOrder = new Int32Array(message.apertureOrder);
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
      if (
        gains.length !== reader.imageCount
        || scaledLogs.length !== reader.imageCount
        || weights.length !== reader.imageCount
        || fNumbers.length !== reader.imageCount
        || apertureOrder.length !== reader.imageCount
        || exposureRolloffMaxP998AfterGain.length !== reader.imageCount
      ) {
        throw new Error("STF Additional Blur worker configuration length does not match image count.");
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

    if (message.type === "analyze-mask-stripe") {
      ensureInitialized();
      const stripe = validateStripe(message.y, message.height);
      const { mask, edgeProtection, histogram } = await analyzeMaskStripe(stripe.y, stripe.height);
      const maskBuffer = mask.buffer as ArrayBuffer;
      const edgeProtectionBuffer = edgeProtection.buffer as ArrayBuffer;
      const histogramBuffer = histogram.buffer as ArrayBuffer;
      post({
        type: "analyze-mask-stripe-result",
        requestId,
        stripeIndex: message.stripeIndex,
        y: stripe.y,
        height: stripe.height,
        maskBuffer,
        edgeProtectionBuffer,
        histogramBuffer,
        sampleCount: mask.length,
      }, [maskBuffer, edgeProtectionBuffer, histogramBuffer]);
      return;
    }

    if (message.type === "apply-blur-stripe") {
      ensureInitialized();
      const stripe = validateStripe(message.y, message.height);
      const mask = new Uint16Array(message.maskBuffer);
      const edgeProtection = new Uint16Array(message.edgeProtectionBuffer);
      const expectedMaskLength = reader!.width * stripe.height;
      if (mask.length !== expectedMaskLength) {
        throw new Error(
          `STF Additional Blur mask length ${mask.length} does not match expected ${expectedMaskLength}.`,
        );
      }
      if (edgeProtection.length !== expectedMaskLength) {
        throw new Error(
          `STF Additional Blur edge protection length ${edgeProtection.length} does not match expected ${expectedMaskLength}.`,
        );
      }
      const linear = await applyBlurStripe(
        stripe.y,
        stripe.height,
        mask,
        edgeProtection,
        Number(message.scaledLogFactor),
      );
      const linearBuffer = linear.buffer as ArrayBuffer;
      post({
        type: "apply-blur-stripe-result",
        requestId,
        stripeIndex: message.stripeIndex,
        y: stripe.y,
        height: stripe.height,
        linearBuffer,
      }, [linearBuffer]);
      return;
    }

    throw new Error(`Unsupported STF Additional Blur worker request: ${String((message as { type?: unknown }).type)}`);
  } catch (error) {
    post({
      type: "error",
      requestId,
      message: error instanceof Error ? error.message : String(error),
    });
  }
};

function ensureInitialized(): void {
  if (!reader || !gains || !scaledLogs || !weights || !fNumbers || !apertureOrder || !exposureRolloffMaxP998AfterGain) {
    throw new Error("STF Additional Blur worker is not initialized.");
  }
}

function validateStripe(yValue: number, heightValue: number): { y: number; height: number } {
  const y = Number(yValue);
  const height = Number(heightValue);
  if (!reader || !(Number.isInteger(y) && y >= 0 && Number.isInteger(height) && height > 0 && y + height <= reader.height)) {
    throw new Error("STF Additional Blur worker received an invalid stripe region.");
  }
  return { y, height };
}

async function readToneMatchedLinearRegion(
  imageIndex: number,
  y: number,
  height: number,
): Promise<Float32Array> {
  const linear = await reader!.readLinearRegion(imageIndex, 0, y, reader!.width, height);
  const toneMatchLut = toneMatchLuts?.[imageIndex] ?? null;
  if (toneMatchLut) {
    applyStfToneMatchInPlace(linear, gains![imageIndex], scaledLogs![imageIndex], toneMatchLut);
  }
  return linear;
}

async function analyzeMaskStripe(y: number, height: number): Promise<{
  mask: Uint16Array;
  edgeProtection: Uint16Array;
  histogram: Uint32Array;
}> {
  const width = reader!.width;
  const halo = resolveStfAdditionalBlurMaskHalo(width, reader!.height);
  const readY = Math.max(0, y - halo);
  const readBottom = Math.min(reader!.height, y + height + halo);
  const readHeight = readBottom - readY;
  const pixelCount = width * readHeight;
  const cocPeakRise = new Float32Array(pixelCount);
  const cocPeakSharpness = new Float32Array(pixelCount);
  const cocBaselineSharpness = new Float32Array(pixelCount);
  const persistentSharpness = new Float32Array(pixelCount);

  let previousSharpness: Float32Array | null = null;
  let groupCountTotal = 0;
  let orderIndex = 0;
  while (orderIndex < apertureOrder!.length) {
    const firstImageIndex = apertureOrder![orderIndex];
    const groupFNumber = Number(fNumbers![firstImageIndex]);
    if (!(Number.isFinite(groupFNumber) && groupFNumber > 0)) {
      throw new Error("STF Additional Blur worker received an invalid F-number group.");
    }

    const groupSharpness = new Float32Array(pixelCount);
    let groupImageCount = 0;
    while (orderIndex < apertureOrder!.length) {
      const imageIndex = apertureOrder![orderIndex];
      const currentFNumber = Number(fNumbers![imageIndex]);
      if (!sameStfAdditionalBlurFNumber(currentFNumber, groupFNumber)) break;
      const linear = await readToneMatchedLinearRegion(imageIndex, readY, readHeight);
      const sharpness = buildSharpnessMap(linear, width, readHeight);
      for (let index = 0; index < pixelCount; index += 1) {
        groupSharpness[index] += sharpness[index] ?? 0;
      }
      groupImageCount += 1;
      orderIndex += 1;
    }
    if (groupImageCount <= 0) throw new Error("STF Additional Blur worker could not build an aperture group.");
    if (groupImageCount > 1) {
      const inverseCount = 1 / groupImageCount;
      for (let index = 0; index < pixelCount; index += 1) groupSharpness[index] *= inverseCount;
    }
    for (let index = 0; index < pixelCount; index += 1) {
      const sharpness = groupSharpness[index] ?? 0;
      if (groupCountTotal === 0 || sharpness < persistentSharpness[index]) {
        persistentSharpness[index] = sharpness;
      }
    }
    groupCountTotal += 1;

    if (previousSharpness) {
      for (let index = 0; index < pixelCount; index += 1) {
        const openSharpness = previousSharpness[index] ?? 0;
        const stoppedSharpness = groupSharpness[index] ?? 0;
        if (openSharpness <= stoppedSharpness) continue;
        const rise = openSharpness - stoppedSharpness;
        if (rise <= cocPeakRise[index]) continue;
        cocPeakRise[index] = rise;
        cocPeakSharpness[index] = openSharpness;
        cocBaselineSharpness[index] = stoppedSharpness;
      }
    }
    previousSharpness = groupSharpness;
  }
  if (groupCountTotal < 2) {
    throw new Error("STF Additional Blur requires at least two distinct aperture groups.");
  }

  const rawMask = new Float32Array(pixelCount);
  const protection = new Float32Array(pixelCount);
  for (let index = 0; index < pixelCount; index += 1) {
    const peak = cocPeakSharpness[index] ?? 0;
    const baseline = cocBaselineSharpness[index] ?? 0;
    const terms = computeStfAdditionalBlurTerms(cocPeakRise[index] ?? 0, peak, baseline);
    rawMask[index] = terms.rawMask;
    protection[index] = computeStfAdditionalBlurOriginallyUnsharpGate(peak, baseline);
    persistentSharpness[index] = computeStfAdditionalBlurPersistentEdgeProtection(
      persistentSharpness[index] ?? 0,
    );
  }

  const radius = resolveStfAdditionalBlurRadius(width, reader!.height);
  const smoothedMask = boxBlurGrayTwoPasses(rawMask, width, readHeight, radius);
  const expandedEdgeProtection = dilateStfAdditionalBlurProtection(
    persistentSharpness,
    width,
    readHeight,
    radius,
  );
  const coreStartRow = y - readY;
  const output = new Uint16Array(width * height);
  const edgeProtectionOutput = new Uint16Array(width * height);
  const histogram = new Uint32Array(STF_ADDITIONAL_BLUR_HISTOGRAM_BINS);
  for (let coreY = 0; coreY < height; coreY += 1) {
    const sourceRow = (coreStartRow + coreY) * width;
    const targetRow = coreY * width;
    for (let x = 0; x < width; x += 1) {
      const sourceIndex = sourceRow + x;
      const targetIndex = targetRow + x;
      const localProtection = protection[sourceIndex] ?? 0;
      const value = (smoothedMask[sourceIndex] ?? 0) * localProtection;
      const edgeExclusion = expandedEdgeProtection[sourceIndex] ?? 0;
      output[targetIndex] = quantizeStfAdditionalBlurMask(value);
      edgeProtectionOutput[targetIndex] = quantizeStfAdditionalBlurMask(edgeExclusion);
      histogram[stfAdditionalBlurHistogramBin(value)] += 1;
    }
  }
  return { mask: output, edgeProtection: edgeProtectionOutput, histogram };
}

async function applyBlurStripe(
  y: number,
  height: number,
  mask: Uint16Array,
  edgeProtection: Uint16Array,
  scaledLogFactor: number,
): Promise<Float32Array> {
  const width = reader!.width;
  const radius = resolveStfAdditionalBlurRadius(width, reader!.height);
  const halo = resolveStfAdditionalBlurApplyHalo(width, reader!.height);
  const readY = Math.max(0, y - halo);
  const readBottom = Math.min(reader!.height, y + height + halo);
  const readHeight = readBottom - readY;
  const accumulator = new Float32Array(width * readHeight * 3);

  // Preserve the ordinary STF accumulation order exactly inside the haloed region.
  for (let imageIndex = 0; imageIndex < reader!.imageCount; imageIndex += 1) {
    const linear = await reader!.readLinearRegion(imageIndex, 0, readY, width, readHeight);
    const toneMatchLut = toneMatchLuts?.[imageIndex] ?? null;
    if (toneMatchLut) {
      applyStfToneMatchInPlace(linear, gains![imageIndex], scaledLogs![imageIndex], toneMatchLut);
      addWeightedLinearToAccumulator(accumulator, linear, weights![imageIndex]);
    } else {
      mergeLinearFloatIntoAccumulator(
        linear,
        accumulator,
        gains![imageIndex],
        weights![imageIndex],
        null,
        exposureRolloffMaxP998AfterGain![imageIndex],
      );
    }
  }

  const blurred = gaussianBlurRgb(accumulator, width, readHeight, radius);
  const output = new Float32Array(width * height * 3);
  const coreStartRow = y - readY;
  for (let coreY = 0; coreY < height; coreY += 1) {
    for (let x = 0; x < width; x += 1) {
      const corePixel = coreY * width + x;
      const sourcePixel = (coreStartRow + coreY) * width + x;
      const source = sourcePixel * 3;
      const target = corePixel * 3;
      const normalizedMask = applyStfAdditionalBlurScaledLog(
        dequantizeStfAdditionalBlurMask(mask[corePixel] ?? 0),
        scaledLogFactor,
      );
      // Re-apply the radius-expanded persistent-edge protection after global
      // P50 normalization so scaled-log cannot lift a protected halo back up.
      const edgeExclusion = dequantizeStfAdditionalBlurMask(edgeProtection[corePixel] ?? 0);
      const maskValue = applyStfAdditionalBlurEdgeProtection(normalizedMask, edgeExclusion);
      const keep = 1 - maskValue;
      output[target] = accumulator[source] * keep + blurred[source] * maskValue;
      output[target + 1] = accumulator[source + 1] * keep + blurred[source + 1] * maskValue;
      output[target + 2] = accumulator[source + 2] * keep + blurred[source + 2] * maskValue;
    }
  }
  return output;
}

function buildSharpnessMap(linear: Float32Array, width: number, height: number): Float32Array {
  const luminance = new Float32Array(linear.length / 3);
  for (let source = 0, pixel = 0; source < linear.length; source += 3, pixel += 1) {
    luminance[pixel] = (linear[source] ?? 0) * 0.3
      + (linear[source + 1] ?? 0) * 0.5
      + (linear[source + 2] ?? 0) * 0.2;
  }
  return sobelMagnitudeGray(binomialBlurGray(luminance, width, height), width, height);
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

function boxBlurGrayTwoPasses(source: Float32Array, width: number, height: number, radius: number): Float32Array {
  let current = new Float32Array(source);
  for (let pass = 0; pass < 2; pass += 1) {
    const horizontal = new Float32Array(source.length);
    const vertical = new Float32Array(source.length);
    const window = radius * 2 + 1;
    for (let y = 0; y < height; y += 1) {
      const row = y * width;
      let sum = 0;
      for (let x = -radius; x <= radius; x += 1) {
        sum += current[row + Math.max(0, Math.min(width - 1, x))] ?? 0;
      }
      for (let x = 0; x < width; x += 1) {
        horizontal[row + x] = sum / window;
        const removeX = Math.max(0, Math.min(width - 1, x - radius));
        const addX = Math.max(0, Math.min(width - 1, x + radius + 1));
        sum += (current[row + addX] ?? 0) - (current[row + removeX] ?? 0);
      }
    }
    for (let x = 0; x < width; x += 1) {
      let sum = 0;
      for (let y = -radius; y <= radius; y += 1) {
        sum += horizontal[Math.max(0, Math.min(height - 1, y)) * width + x] ?? 0;
      }
      for (let y = 0; y < height; y += 1) {
        vertical[y * width + x] = sum / window;
        const removeY = Math.max(0, Math.min(height - 1, y - radius));
        const addY = Math.max(0, Math.min(height - 1, y + radius + 1));
        sum += (horizontal[addY * width + x] ?? 0) - (horizontal[removeY * width + x] ?? 0);
      }
    }
    current = vertical;
  }
  return current;
}

function gaussianKernel(radius: number, sigma: number): Float32Array {
  const kernel = new Float32Array(radius * 2 + 1);
  let sum = 0;
  for (let offset = -radius; offset <= radius; offset += 1) {
    const value = Math.exp(-(offset * offset) / (2 * sigma * sigma));
    kernel[offset + radius] = value;
    sum += value;
  }
  if (!(sum > 0)) return kernel;
  for (let index = 0; index < kernel.length; index += 1) kernel[index] /= sum;
  return kernel;
}

function gaussianBlurRgb(source: Float32Array, width: number, height: number, radius: number): Float32Array {
  const sigma = Math.max(0.75, radius / 2);
  const kernel = gaussianKernel(radius, sigma);
  const temp = new Float32Array(source.length);
  const output = new Float32Array(source.length);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      for (let channel = 0; channel < 3; channel += 1) {
        let sum = 0;
        for (let offset = -radius; offset <= radius; offset += 1) {
          const sampleX = Math.max(0, Math.min(width - 1, x + offset));
          sum += (source[(y * width + sampleX) * 3 + channel] ?? 0) * kernel[offset + radius];
        }
        temp[(y * width + x) * 3 + channel] = sum;
      }
    }
  }
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      for (let channel = 0; channel < 3; channel += 1) {
        let sum = 0;
        for (let offset = -radius; offset <= radius; offset += 1) {
          const sampleY = Math.max(0, Math.min(height - 1, y + offset));
          sum += (temp[(sampleY * width + x) * 3 + channel] ?? 0) * kernel[offset + radius];
        }
        output[(y * width + x) * 3 + channel] = sum;
      }
    }
  }
  return output;
}

function post(message: StfAdditionalBlurWorkerResponse, transfer: Transferable[] = []): void {
  workerScope.postMessage(message, transfer);
}
