// Local Stack Studio STF Additional blur production Worker.
import { applyStfToneMatchInPlace, buildStfToneMatchLut, type StfToneMatchLut } from "../stack/stf-tone-match";
import {
  STF_ADDITIONAL_BLUR_COARSE_REFERENCE_PIXELS, STF_ADDITIONAL_BLUR_FINE_REFERENCE_PIXELS,
  applyGuardedGaussianBlurRegion, buildStfLogRatioFromDerived,
  buildStfApertureGroups, buildStfRelativeSharpnessMapAtScaleInto,
  type StfRelativeChannelFloors, validateStfRelativeChannelFloors,
  createStfSharpnessScratch, resolveStfSharpnessHalo, resolveStfSharpnessScale,
} from "../stack/stf-additional-blur";
import { WorkerCanonicalReader } from "../stack/worker-canonical-reader";
import { interpolateStfVolumeUnitRatioInPlace } from "../stack/stf-volume-closing";
import { buildStfGraphCutMask } from "../stack/stf-graph-cut";
import {
  STF_ADDITIONAL_BLUR_PROTOCOL_VERSION,
  type StfAdditionalBlurWorkerRequest, type StfAdditionalBlurWorkerResponse,
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
let toneMatchLuts: Array<StfToneMatchLut | null> | null = null;
let imageGroupIndexes: Int32Array | null = null;
let groupImageCounts: Int32Array | null = null;
let fineScale = 1;
let coarseScale = 1;
let analysisHalo = 2;
let relativeChannelFloors: StfRelativeChannelFloors | null = null;

workerScope.onmessage = async (event: MessageEvent<StfAdditionalBlurWorkerRequest>) => {
  const message = event.data;
  const requestId = Number(message?.requestId);
  try {
    if (message.type === "init") {
      reader?.close();
      reader = await WorkerCanonicalReader.open({
        sessionId: message.sessionId, alignmentPlan: message.alignmentPlan,
        matrices: message.matrices, cacheBytes: message.cacheBytes,
      });
      gains = new Float32Array(message.gains);
      scaledLogs = new Float32Array(message.scaledLogs);
      weights = new Float32Array(message.weights);
      relativeChannelFloors = null;
      const fNumbers = Array.from(message.fNumbers, Number);
      if (gains.length !== reader.imageCount || scaledLogs.length !== reader.imageCount ||
          weights.length !== reader.imageCount || fNumbers.length !== reader.imageCount) {
        throw new Error("STF Additional blur worker configuration length does not match image count.");
      }
      toneMatchLuts = Array.from({ length: reader.imageCount }, (_, index) => {
        const gain = gains![index], scaledLog = scaledLogs![index];
        return Math.abs(gain - 1) > 1e-8 || Math.abs(scaledLog) > 1e-8
          ? buildStfToneMatchLut(gain, scaledLog) : null;
      });
      const groups = buildStfApertureGroups(fNumbers);
      imageGroupIndexes = groups.imageGroupIndexes;
      groupImageCounts = groups.groupImageCounts;
      fineScale = resolveStfSharpnessScale(reader.width, reader.height, STF_ADDITIONAL_BLUR_FINE_REFERENCE_PIXELS);
      coarseScale = resolveStfSharpnessScale(reader.width, reader.height, STF_ADDITIONAL_BLUR_COARSE_REFERENCE_PIXELS);
      analysisHalo = resolveStfSharpnessHalo(Math.max(fineScale, coarseScale));
      post({ type: "ready", requestId, protocolVersion: STF_ADDITIONAL_BLUR_PROTOCOL_VERSION,
        imageCount: reader.imageCount, width: reader.width, height: reader.height,
        analysisHalo, groupCount: groupImageCounts.length });
      return;
    }
    if (message.type === "sample-brightness-stripe") {
      ensureInitialized();
      const samples = await sampleBrightnessStripe(message.y, message.height, message.stride, message.offsetX, message.offsetY);
      post({ type: "sample-brightness-stripe-result", requestId, samplesBuffer: samples.buffer as ArrayBuffer },
        [samples.buffer as ArrayBuffer]);
      return;
    }
    if (message.type === "configure-relative-floors") {
      ensureInitialized();
      relativeChannelFloors = validateStfRelativeChannelFloors(message.floors);
      post({ type: "relative-floors-configured", requestId, floors: relativeChannelFloors });
      return;
    }
    if (message.type === "analyze-stripe") {
      ensureInitialized();
      const y = Number(message.y), height = Number(message.height);
      if (!Number.isInteger(y) || y < 0 || !Number.isInteger(height) || height < 1 || y + height > reader!.height) {
        throw new Error("STF Additional blur Worker received invalid analysis stripe geometry.");
      }
      if (!relativeChannelFloors) throw new Error("STF Additional blur requires configured RGB floors.");
      if (typeof message.includeSource !== "boolean") throw new Error("STF Worker source flag is invalid.");
      const result = await analyzeStripe(y, height, message.includeSource);
      post({ type: "analyze-stripe-result", requestId, y, height, groupCount: groupImageCounts!.length,
        linearBuffer: result.linear.buffer as ArrayBuffer,
        fineLogSumBuffer: result.fineLogSum.buffer as ArrayBuffer,
        fineZeroBuffer: result.fineZero.buffer as ArrayBuffer,
        coarseGroupsBuffer: result.coarseGroups.buffer as ArrayBuffer,
      }, [result.linear.buffer, result.fineLogSum.buffer, result.fineZero.buffer, result.coarseGroups.buffer] as ArrayBuffer[]);
      return;
    }
    if (message.type === "ratio-stripe") {
      const { pixelCount, groupCount, epsilon } = message;
      if (!Number.isInteger(pixelCount) || pixelCount < 1 || !Number.isInteger(groupCount) || groupCount < 2 ||
          !Number.isFinite(epsilon) || epsilon <= 0) throw new Error("STF ratio Worker parameters invalid.");
      const fineLogSum = new Float32Array(message.fineLogSumBuffer);
      const fineZero = new Uint8Array(message.fineZeroBuffer);
      const coarseGroups = new Float32Array(message.coarseGroupsBuffer);
      if (fineLogSum.length !== pixelCount || fineZero.length !== pixelCount || coarseGroups.length !== pixelCount * groupCount) {
        throw new Error("STF ratio Worker buffers are invalid.");
      }
      const logRatio = buildStfLogRatioFromDerived(fineLogSum, fineZero, coarseGroups, groupCount, epsilon);
      post({ type: "ratio-stripe-result", requestId, logRatioBuffer: logRatio.buffer as ArrayBuffer },
        [logRatio.buffer as ArrayBuffer]);
      return;
    }
    if (message.type === "volume-close") {
      ensureInitialized();
      const { width, height } = message;
      if (width !== reader!.width || height !== reader!.height || message.unitRatioBuffer.byteLength !== width * height * 4) {
        throw new Error("STF Volume Closing Worker geometry is invalid.");
      }
      const values = new Float32Array(message.unitRatioBuffer);
      const info = interpolateStfVolumeUnitRatioInPlace(values, width, height);
      post({ type: "volume-close-result", requestId, protocolVersion: STF_ADDITIONAL_BLUR_PROTOCOL_VERSION,
        unitRatioBuffer: values.buffer as ArrayBuffer, ...info }, [values.buffer as ArrayBuffer]);
      return;
    }
    if (message.type === "graph-cut") {
      ensureInitialized();
      const { width, height, blurRatio } = message;
      if (width !== reader!.width || height !== reader!.height || message.confidenceBuffer.byteLength !== width * height * 4) {
        throw new Error("STF Graph Cut Worker geometry is invalid.");
      }
      const result = buildStfGraphCutMask(new Float32Array(message.confidenceBuffer), width, height, blurRatio);
      post({ type: "graph-cut-result", requestId, protocolVersion: STF_ADDITIONAL_BLUR_PROTOCOL_VERSION,
        maskBuffer: result.mask.buffer as ArrayBuffer, ...result.info }, [result.mask.buffer as ArrayBuffer]);
      return;
    }
    if (message.type === "blur-stripe") {
      ensureInitialized();
      const { regionHeight, coreOffsetY, coreHeight, radius } = message;
      const source = new Float32Array(message.sourceBuffer);
      const gate = new Float32Array(message.gateBuffer);
      if (!Number.isInteger(regionHeight) || regionHeight < 1 || !Number.isInteger(coreOffsetY) || coreOffsetY < 0 ||
          !Number.isInteger(coreHeight) || coreHeight < 1 || coreOffsetY + coreHeight > regionHeight ||
          !Number.isInteger(radius) || radius < 2 || radius > 15 ||
          source.length !== reader!.width * regionHeight * 3 || gate.length !== reader!.width * regionHeight) {
        throw new Error("STF Guarded Gaussian Worker geometry is invalid.");
      }
      const output = applyGuardedGaussianBlurRegion(source, reader!.width, regionHeight,
        gate, radius, coreOffsetY, coreHeight);
      post({ type: "blur-stripe-result", requestId, protocolVersion: STF_ADDITIONAL_BLUR_PROTOCOL_VERSION,
        coreHeight, linearBuffer: output.buffer as ArrayBuffer }, [output.buffer as ArrayBuffer]);
      return;
    }
    throw new Error(`Unsupported STF Additional blur Worker request: ${String((message as { type?: unknown }).type)}`);
  } catch (error) {
    post({ type: "error", requestId, message: error instanceof Error ? error.message : String(error) });
  }
};
function ensureInitialized(): void {
  if (!reader || !gains || !scaledLogs || !weights || !toneMatchLuts || !imageGroupIndexes || !groupImageCounts) {
    throw new Error("STF Additional blur Worker was not initialized.");
  }
}

async function sampleBrightnessStripe(
  y: number, height: number, stride: number, offsetX: number, offsetY: number,
): Promise<Float32Array> {
  ensureInitialized();
  if (!(Number.isInteger(y) && y >= 0 && Number.isInteger(height) && height > 0 && y + height <= reader!.height
    && Number.isInteger(stride) && stride >= 1
    && Number.isInteger(offsetX) && offsetX >= 0 && offsetX < reader!.width
    && Number.isInteger(offsetY) && offsetY >= 0 && offsetY < reader!.height)) {
    throw new Error("STF brightness sample geometry is invalid.");
  }
  const width = reader!.width;
  const positions: number[] = [];
  const startY = offsetY + Math.max(0, Math.ceil((y - offsetY) / stride)) * stride;
  for (let globalY = startY; globalY < y + height; globalY += stride) {
    for (let x = offsetX; x < width; x += stride) positions.push(((globalY - y) * width + x) * 3);
  }
  const samples = new Float32Array(positions.length * 3);
  for (let imageIndex = 0; imageIndex < reader!.imageCount; imageIndex += 1) {
    const linear = await reader!.readLinearRegion(imageIndex, 0, y, width, height);
    const lut = toneMatchLuts![imageIndex];
    if (lut) applyStfToneMatchInPlace(linear, gains![imageIndex], scaledLogs![imageIndex], lut);
    const weight = weights![imageIndex];
    for (let i = 0; i < positions.length; i += 1) {
      const source = positions[i];
      const target = i * 3;
      samples[target] += (linear[source] ?? 0) * weight;
      samples[target + 1] += (linear[source + 1] ?? 0) * weight;
      samples[target + 2] += (linear[source + 2] ?? 0) * weight;
    }
  }
  return samples;
}


async function analyzeStripe(y: number, height: number, includeSource: boolean): Promise<{
  linear: Float32Array;
  fineLogSum: Float32Array;
  fineZero: Uint8Array;
  coarseGroups: Float32Array;
}> {
  ensureInitialized();
  const width = reader!.width;
  const regionY = Math.max(0, y - analysisHalo);
  const regionEnd = Math.min(reader!.height, y + height + analysisHalo);
  const regionHeight = regionEnd - regionY;
  const coreOffsetY = y - regionY;
  const corePixels = width * height;
  const regionPixels = width * regionHeight;
  const groupCount = groupImageCounts!.length;

  const linearAccumulator = new Float32Array(includeSource ? corePixels * 3 : 0);
  const fineGroups = Array.from({ length: groupCount }, () => new Float32Array(corePixels));
  const coarseGroups = new Float32Array(corePixels * groupCount);
  const fineMap = new Float32Array(regionPixels);
  const coarseMap = new Float32Array(regionPixels);
  const scratch = createStfSharpnessScratch(regionPixels);

  for (let imageIndex = 0; imageIndex < reader!.imageCount; imageIndex += 1) {
    const linear = await reader!.readLinearRegion(imageIndex, 0, regionY, width, regionHeight);
    const lut = toneMatchLuts![imageIndex];
    if (lut) applyStfToneMatchInPlace(linear, gains![imageIndex], scaledLogs![imageIndex], lut);

    if (includeSource) {
      const mergeWeight = weights![imageIndex];
      for (let localY = 0; localY < height; localY += 1) {
        const sourceStart = (coreOffsetY + localY) * width * 3;
        const targetStart = localY * width * 3;
        for (let offset = 0; offset < width * 3; offset += 1) {
          linearAccumulator[targetStart + offset] += linear[sourceStart + offset] * mergeWeight;
        }
      }
    }

    buildStfRelativeSharpnessMapAtScaleInto(linear, width, regionHeight, fineScale, fineMap, scratch, relativeChannelFloors!);
    buildStfRelativeSharpnessMapAtScaleInto(linear, width, regionHeight, coarseScale, coarseMap, scratch, relativeChannelFloors!);
    const group = imageGroupIndexes![imageIndex];
    const fineTarget = fineGroups[group];
    const coarseBase = group * corePixels;
    for (let localY = 0; localY < height; localY += 1) {
      const sourceStart = (coreOffsetY + localY) * width;
      const targetStart = localY * width;
      for (let x = 0; x < width; x += 1) {
        const sourcePixel = sourceStart + x;
        const targetPixel = targetStart + x;
        fineTarget[targetPixel] += fineMap[sourcePixel];
        coarseGroups[coarseBase + targetPixel] += coarseMap[sourcePixel];
      }
    }
  }

  const fineLogSum = new Float32Array(corePixels);
  const fineZero = new Uint8Array(corePixels);
  for (let group = 0; group < groupCount; group += 1) {
    const count = groupImageCounts![group];
    const inverse = 1 / count;
    const fine = fineGroups[group];
    const coarseBase = group * corePixels;
    for (let pixel = 0; pixel < corePixels; pixel += 1) {
      const fineValue = Math.fround(fine[pixel] * inverse);
      const coarseIndex = coarseBase + pixel;
      coarseGroups[coarseIndex] = Math.fround(coarseGroups[coarseIndex] * inverse);
      if (!(Number.isFinite(fineValue) && fineValue > 0)) fineZero[pixel] = 1;
      else if (!fineZero[pixel]) fineLogSum[pixel] += Math.log(fineValue);
    }
  }

  return { linear: linearAccumulator, fineLogSum, fineZero, coarseGroups };
}


function post(message: StfAdditionalBlurWorkerResponse, transfer: Transferable[] = []): void {
  workerScope.postMessage(message, transfer);
}
