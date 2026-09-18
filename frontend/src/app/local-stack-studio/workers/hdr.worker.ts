// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-nocheck
// Local Stack Studio worker source. Built to public/generated/local-stack-studio.
import { loadWorkerOpenCv } from "./opencv-runtime";
const HDR_FLOAT_MIN_RESPONSE = 1e-12;
const HDR_FLOAT_WEIGHT_EPSILON = 1e-12;
const REINHARD_GAMMA = 1.0;
const REINHARD_INTENSITY = 0.0;
const REINHARD_LIGHT_ADAPT = 0.5;
const REINHARD_COLOR_ADAPT = 0.5;
const BRIGHTNESS_MAX_TRIES = 10;
const BRIGHTNESS_MAX_DIST = 0.01;
const PROPHOTO_TONE_LUMA_R = 0.2880402;
const PROPHOTO_TONE_LUMA_G = 0.7118741;
const PROPHOTO_TONE_LUMA_B = 0.0000857;
const HDR1_RESPONSE_KNOT_COUNT = 256;
const HDR1_RESPONSE_SAMPLE_LIMIT = 4096;
const HDR1_RESPONSE_SAMPLE_OBSERVATION_TARGET = 32768;
const HDR1_RESPONSE_SMOOTHNESS = 10;
const HDR1_RESPONSE_RIDGE = 1e-10;

let debevecStreamState = null;
let mertensStreamState = null;
let workerMessageQueue = Promise.resolve();

self.onmessage = (event) => {
  const message = event.data || {};
  workerMessageQueue = workerMessageQueue
    .then(() => dispatchWorkerMessage(message))
    .catch(async (error) => {
      if (debevecStreamState) {
        try {
          await cleanupDebevecStreamState();
        } catch {
          // Best-effort scratch cleanup; report the original processing error.
        }
      }
      if (mertensStreamState) {
        try {
          await cleanupMertensStreamState();
        } catch {
          // Best-effort scratch cleanup; report the original processing error.
        }
      }
      self.postMessage({
        type: "error",
        message: error instanceof Error ? error.message : String(error),
      });
    });
};

async function dispatchWorkerMessage(message) {
  if (message.type === "merge") {
    processDebevecMessage(message);
    return;
  }
  if (message.type === "merge-stream-init") {
    await initializeDebevecStream(message);
    return;
  }
  if (message.type === "merge-stream-image") {
    await appendDebevecStreamImage(message);
    return;
  }
  if (message.type === "merge-stream-finalize") {
    await finalizeDebevecStream(message);
    return;
  }
  if (message.type === "merge-stream-abort") {
    const requestId = message.requestId;
    await cleanupDebevecStreamState();
    self.postMessage({ type: "merge-stream-aborted", requestId });
    return;
  }
  if (message.type === "mertens") {
    await processMertensMessage(message);
    return;
  }
  if (message.type === "mertens-stream-init") {
    await initializeMertensStream(message);
    return;
  }
  if (message.type === "mertens-stream-image") {
    await appendMertensStreamImage(message);
    return;
  }
  if (message.type === "mertens-stream-finalize") {
    await finalizeMertensStream(message);
    return;
  }
  if (message.type === "mertens-stream-abort") {
    const requestId = message.requestId;
    await cleanupMertensStreamState();
    self.postMessage({ type: "mertens-stream-aborted", requestId });
  }
}

function processDebevecMessage(message) {
  const width = Number(message.width);
  const height = Number(message.height);
  const imageBuffers = Array.isArray(message.imageBuffers) ? message.imageBuffers : [];
  const suppliedExposureTimes = new Float32Array(message.exposureTimesBuffer);
  const brightnesses = new Float32Array(message.brightnessesBuffer);

  validateInputs(width, height, imageBuffers, suppliedExposureTimes, brightnesses);
  const images = imageBuffers.map((buffer) => new Float32Array(buffer));
  const exposureTimes = resolveExposureTimes(suppliedExposureTimes, brightnesses);
  const targetBrightness = meanArray(brightnesses);

  postProgress("Merging HDR with Debevec...");
  const hdr = mergeDebevecWithLinearResponse(images, exposureTimes, width, height);
  images.length = 0;
  imageBuffers.length = 0;

  postProgress("Tone mapping HDR with Reinhard...");
  tonemapReinhardInPlace(
    hdr,
    REINHARD_GAMMA,
    REINHARD_INTENSITY,
    REINHARD_LIGHT_ADAPT,
    REINHARD_COLOR_ADAPT,
  );


  postProgress("Restoring HDR brightness...");
  adjustExposureToBrightnessInPlace(hdr, targetBrightness);

  self.postMessage(
    { type: "result", linearProPhotoBuffer: hdr.buffer },
    [hdr.buffer],
  );
}


async function initializeDebevecStream(message) {
  if (debevecStreamState) throw new Error("HDR1 stream worker is already initialized.");
  const width = Number(message.width);
  const height = Number(message.height);
  const imageCount = Number(message.imageCount);
  const suppliedExposureTimes = new Float32Array(message.exposureTimesBuffer || new ArrayBuffer(0));
  const suppliedLinearResponseFlags = new Uint8Array(message.linearResponseFlagsBuffer || new ArrayBuffer(0));
  if (!(Number.isFinite(width) && width > 0 && Number.isFinite(height) && height > 0)) {
    throw new Error("HDR worker received invalid image dimensions.");
  }
  if (!(Number.isInteger(imageCount) && imageCount >= 2)) {
    throw new Error("HDR1 streaming requires at least two input images.");
  }
  if (suppliedExposureTimes.length !== 0 && suppliedExposureTimes.length !== imageCount) {
    throw new Error("HDR exposure-time count does not match the image count.");
  }
  for (let i = 0; i < suppliedExposureTimes.length; i += 1) {
    if (!(Number.isFinite(suppliedExposureTimes[i]) && suppliedExposureTimes[i] > 0)) {
      throw new Error(`HDR input ${i + 1} has an invalid exposure value.`);
    }
  }
  if (suppliedLinearResponseFlags.length !== 0 && suppliedLinearResponseFlags.length !== imageCount) {
    throw new Error("HDR response-mode count does not match the image count.");
  }

  const linearResponseFlags = suppliedLinearResponseFlags.length > 0
    ? new Uint8Array(suppliedLinearResponseFlags)
    : new Uint8Array(imageCount).fill(1);
  const needsResponseCalibration = linearResponseFlags.some((value) => value === 0);
  const pixelCount = width * height;
  const sampleCount = needsResponseCalibration
    ? chooseDebevecResponseSampleCount(pixelCount, imageCount)
    : 0;
  let db = null;
  if (needsResponseCalibration) {
    try {
      db = await openHdr2ScratchDb();
    } catch (error) {
      console.warn("HDR1 IndexedDB scratch is unavailable; using in-memory calibration fallback:", error);
    }
  }

  debevecStreamState = {
    width,
    height,
    imageCount,
    receivedCount: 0,
    responseSums: needsResponseCalibration ? null : new Float32Array(pixelCount * 3),
    weightSums: needsResponseCalibration ? null : new Float32Array(pixelCount * 3),
    weightedLogBrightnessSums: !needsResponseCalibration && suppliedExposureTimes.length === 0
      ? new Float32Array(pixelCount * 3)
      : null,
    brightnesses: new Float32Array(imageCount),
    receivedFlags: new Uint8Array(imageCount),
    suppliedExposureTimes,
    linearResponseFlags,
    needsResponseCalibration,
    responseSampleIndices: needsResponseCalibration ? buildDebevecResponseSampleIndices(width, height, sampleCount) : null,
    responseSamples: needsResponseCalibration ? new Float32Array(imageCount * sampleCount * 3) : null,
    responseSampleCount: sampleCount,
    db,
    sessionId: needsResponseCalibration ? `hdr1-${createHdr2ScratchSessionId()}` : null,
    memoryImages: new Map(),
    scratchWriteDisabled: needsResponseCalibration && !db,
  };
  debevecStreamState.brightnesses.fill(Number.NaN);
  self.postMessage({ type: "merge-stream-ready", requestId: message.requestId });
}

async function appendDebevecStreamImage(message) {
  const state = debevecStreamState;
  if (!state) throw new Error("HDR1 stream worker was not initialized.");
  const imageIndex = Number(message.imageIndex);
  const brightness = Number(message.brightness);
  if (!(Number.isInteger(imageIndex) && imageIndex >= 0 && imageIndex < state.imageCount)) {
    throw new Error("HDR1 stream worker received an invalid image index.");
  }
  if (state.receivedFlags[imageIndex]) {
    throw new Error(`HDR input ${imageIndex + 1} was sent more than once.`);
  }
  if (!(Number.isFinite(brightness) && brightness >= 0)) {
    throw new Error(`HDR input ${imageIndex + 1} has an invalid brightness value.`);
  }
  const imageBuffer = message.imageBuffer;
  const expectedLength = state.width * state.height * 3;
  const expectedByteLength = expectedLength * Float32Array.BYTES_PER_ELEMENT;
  if (!(imageBuffer instanceof ArrayBuffer) || imageBuffer.byteLength !== expectedByteLength) {
    throw new Error(`HDR input ${imageIndex + 1} has an invalid Float32 RGB buffer.`);
  }
  const image = new Float32Array(imageBuffer);

  if (state.needsResponseCalibration) {
    captureDebevecResponseSamples(state, imageIndex, image);
    if (!state.scratchWriteDisabled && state.db) {
      postProgress(`Storing HDR1 input ${imageIndex + 1}/${state.imageCount} for response calibration...`);
      try {
        await putHdr2ScratchImage(state.db, hdr2ScratchKey(state.sessionId, imageIndex), imageBuffer);
      } catch (error) {
        state.scratchWriteDisabled = true;
        state.memoryImages.set(imageIndex, imageBuffer);
        console.warn("HDR1 scratch write failed; keeping remaining inputs in worker memory:", error);
      }
    } else {
      state.memoryImages.set(imageIndex, imageBuffer);
    }
  } else {
    accumulateLinearDebevecImage(state, imageIndex, image, brightness);
  }

  state.receivedFlags[imageIndex] = 1;
  state.brightnesses[imageIndex] = brightness;
  state.receivedCount += 1;
  self.postMessage({
    type: "merge-stream-image-stored",
    requestId: message.requestId,
    imageIndex,
  });
}

async function finalizeDebevecStream(message) {
  const state = debevecStreamState;
  if (!state) throw new Error("HDR1 stream worker was not initialized.");
  if (state.receivedCount !== state.imageCount) {
    throw new Error(
      `HDR1 stream worker received ${state.receivedCount}/${state.imageCount} input images.`
    );
  }
  const brightnesses = state.brightnesses;
  for (let i = 0; i < brightnesses.length; i += 1) {
    if (!(Number.isFinite(brightnesses[i]) && brightnesses[i] >= 0)) {
      throw new Error(`HDR input ${i + 1} has an invalid brightness value.`);
    }
  }

  let hdr;
  if (state.needsResponseCalibration) {
    postProgress("Calibrating HDR1 Debevec response curve...");
    const exposureTimes = resolveExposureTimes(state.suppliedExposureTimes, brightnesses);
    const responseCurves = estimateDebevecResponseCurves(state, exposureTimes);
    postProgress("Merging HDR1 radiance with calibrated Debevec response...");
    hdr = await mergeCalibratedDebevecStream(state, exposureTimes, responseCurves);
  } else {
    postProgress("Finalizing streamed HDR with linear Debevec response...");
    hdr = finalizeLinearDebevecStreamToHdr(state);
  }

  const targetBrightness = meanArray(brightnesses);
  try {
    await cleanupDebevecStreamState();
  } catch (error) {
    console.warn("Could not fully clear HDR1 scratch images:", error);
  }

  postProgress("Tone mapping HDR with Reinhard...");
  tonemapReinhardInPlace(
    hdr,
    REINHARD_GAMMA,
    REINHARD_INTENSITY,
    REINHARD_LIGHT_ADAPT,
    REINHARD_COLOR_ADAPT,
  );


  postProgress("Restoring HDR brightness...");
  adjustExposureToBrightnessInPlace(hdr, targetBrightness);

  self.postMessage(
    { type: "result", requestId: message.requestId, linearProPhotoBuffer: hdr.buffer },
    [hdr.buffer],
  );
}

function accumulateLinearDebevecImage(state, imageIndex, image, brightness) {
  const responseSums = state.responseSums;
  const weightSums = state.weightSums;
  const weightedLogBrightnessSums = state.weightedLogBrightnessSums;
  const suppliedExposureTimes = state.suppliedExposureTimes;
  const hasExposureTimes = suppliedExposureTimes.length > 0;
  const logExposureTime = hasExposureTimes ? Math.log(suppliedExposureTimes[imageIndex]) : 0;
  const logBrightness = hasExposureTimes ? 0 : Math.log(Math.max(brightness, 0.0001));
  const pixelCount = state.width * state.height;

  for (let pixel = 0, offset = 0; pixel < pixelCount; pixel += 1, offset += 3) {
    for (let channel = 0; channel < 3; channel += 1) {
      const value = clamp01(image[offset + channel]);
      const weight = debevecWeightFloat(value);
      responseSums[offset + channel] += weight * (
        debevecLogResponseFloat(value) - logExposureTime
      );
      weightSums[offset + channel] += weight;
      if (weightedLogBrightnessSums) {
        weightedLogBrightnessSums[offset + channel] += weight * logBrightness;
      }
    }
  }
}

function finalizeLinearDebevecStreamToHdr(state) {
  const responseSums = state.responseSums;
  const weightSums = state.weightSums;
  const weightedLogBrightnessSums = state.weightedLogBrightnessSums;
  let minBrightness = Infinity;
  if (weightedLogBrightnessSums) {
    for (let i = 0; i < state.brightnesses.length; i += 1) {
      if (state.brightnesses[i] < minBrightness) minBrightness = state.brightnesses[i];
    }
    minBrightness = Math.max(minBrightness, 0.0001);
  }
  const minLogBrightness = weightedLogBrightnessSums ? Math.log(minBrightness) : 0;

  for (let offset = 0; offset < responseSums.length; offset += 1) {
    const weightSum = weightSums[offset];
    const weightedLogTime = weightedLogBrightnessSums
      ? weightedLogBrightnessSums[offset] - minLogBrightness * weightSum
      : 0;
    const logRadiance = weightSum > 0
      ? (responseSums[offset] - weightedLogTime) / weightSum
      : 0;
    responseSums[offset] = sanitizeHdrValue(Math.exp(logRadiance));
  }
  return responseSums;
}

function chooseDebevecResponseSampleCount(pixelCount, imageCount) {
  const observationLimited = Math.max(
    512,
    Math.floor(HDR1_RESPONSE_SAMPLE_OBSERVATION_TARGET / Math.max(2, imageCount)),
  );
  return Math.max(1, Math.min(pixelCount, HDR1_RESPONSE_SAMPLE_LIMIT, observationLimited));
}

function buildDebevecResponseSampleIndices(width, height, sampleCount) {
  const indices = new Uint32Array(sampleCount);
  const used = new Set();
  let output = 0;
  let sequenceIndex = 1;
  while (output < sampleCount) {
    const x = Math.min(width - 1, Math.floor(radicalInverse(sequenceIndex, 2) * width));
    const y = Math.min(height - 1, Math.floor(radicalInverse(sequenceIndex, 3) * height));
    const pixel = y * width + x;
    sequenceIndex += 1;
    if (used.has(pixel)) continue;
    used.add(pixel);
    indices[output] = pixel;
    output += 1;
    if (used.size >= width * height) break;
  }
  if (output < sampleCount) {
    for (let pixel = 0; pixel < width * height && output < sampleCount; pixel += 1) {
      if (used.has(pixel)) continue;
      used.add(pixel);
      indices[output++] = pixel;
    }
  }
  return indices;
}

function radicalInverse(index, base) {
  let value = 0;
  let denominator = 1;
  let remaining = index;
  while (remaining > 0) {
    denominator *= base;
    value += (remaining % base) / denominator;
    remaining = Math.floor(remaining / base);
  }
  return value;
}

function captureDebevecResponseSamples(state, imageIndex, image) {
  const sampleIndices = state.responseSampleIndices;
  const sampleCount = state.responseSampleCount;
  const destinationBase = imageIndex * sampleCount * 3;
  for (let sample = 0; sample < sampleCount; sample += 1) {
    const sourceOffset = sampleIndices[sample] * 3;
    const destinationOffset = destinationBase + sample * 3;
    state.responseSamples[destinationOffset] = clamp01(image[sourceOffset]);
    state.responseSamples[destinationOffset + 1] = clamp01(image[sourceOffset + 1]);
    state.responseSamples[destinationOffset + 2] = clamp01(image[sourceOffset + 2]);
  }
}

function estimateDebevecResponseCurves(state, exposureTimes) {
  const curves = new Array(3);
  for (let channel = 0; channel < 3; channel += 1) {
    curves[channel] = estimateDebevecResponseCurve(state, exposureTimes, channel);
  }
  return curves;
}

function estimateDebevecResponseCurve(state, exposureTimes, channel) {
  // Debevec-Malik data term with the per-sample log-radiance variables
  // analytically eliminated.  The weighted-variance identity turns each
  // sample into pairwise equations between exposures; this is the same
  // least-squares objective without allocating one unknown E_j per sample.
  // Rendered inputs interpolate a smooth response g(z); RAW inputs contribute
  // the known scene-linear response log(z), which also fixes the absolute
  // response scale when RAW and rendered inputs are mixed.
  const knotCount = HDR1_RESPONSE_KNOT_COUNT;
  const matrix = new Float64Array(knotCount * knotCount);
  const rhs = new Float64Array(knotCount);
  const logTimes = new Float64Array(exposureTimes.length);
  for (let i = 0; i < exposureTimes.length; i += 1) logTimes[i] = Math.log(exposureTimes[i]);
  const sampleCount = state.responseSampleCount;
  const imageCount = state.imageCount;
  const samples = state.responseSamples;
  const linearFlags = state.linearResponseFlags;
  const observationWeights = new Float64Array(imageCount);
  const constants = new Float64Array(imageCount);
  const interpolationLeft = new Int32Array(imageCount);
  const interpolationFraction = new Float64Array(imageCount);
  let dataEquationCount = 0;

  for (let sample = 0; sample < sampleCount; sample += 1) {
    let totalObservationWeight = 0;
    for (let imageIndex = 0; imageIndex < imageCount; imageIndex += 1) {
      const sampleOffset = (imageIndex * sampleCount + sample) * 3 + channel;
      const value = clamp01(samples[sampleOffset]);
      const rowWeight = debevecCalibrationWeight(value);
      const observationWeight = rowWeight * rowWeight;
      observationWeights[imageIndex] = observationWeight;
      totalObservationWeight += observationWeight;
      if (linearFlags[imageIndex]) {
        constants[imageIndex] = debevecLogResponseFloat(value) - logTimes[imageIndex];
        interpolationLeft[imageIndex] = -1;
        interpolationFraction[imageIndex] = 0;
      } else {
        constants[imageIndex] = -logTimes[imageIndex];
        const position = value * (knotCount - 1);
        const left = Math.min(knotCount - 2, Math.max(0, Math.floor(position)));
        interpolationLeft[imageIndex] = left;
        interpolationFraction[imageIndex] = position - left;
      }
    }
    if (!(totalObservationWeight > 1e-12)) continue;

    for (let first = 0; first < imageCount - 1; first += 1) {
      const firstWeight = observationWeights[first];
      if (!(firstWeight > 0)) continue;
      for (let second = first + 1; second < imageCount; second += 1) {
        const secondWeight = observationWeights[second];
        if (!(secondWeight > 0)) continue;
        if (linearFlags[first] && linearFlags[second]) continue;
        const equationWeight = firstWeight * secondWeight / totalObservationWeight;
        if (!(equationWeight > 1e-14)) continue;

        const coefficientIndices = [];
        const coefficientValues = [];
        if (!linearFlags[first]) {
          appendDebevecInterpolationCoefficients(
            coefficientIndices,
            coefficientValues,
            interpolationLeft[first],
            interpolationFraction[first],
            1,
          );
        }
        if (!linearFlags[second]) {
          appendDebevecInterpolationCoefficients(
            coefficientIndices,
            coefficientValues,
            interpolationLeft[second],
            interpolationFraction[second],
            -1,
          );
        }
        const constantDifference = constants[first] - constants[second];
        accumulateDebevecNormalEquation(
          matrix,
          rhs,
          knotCount,
          coefficientIndices,
          coefficientValues,
          constantDifference,
          equationWeight,
        );
        dataEquationCount += 1;
      }
    }
  }

  if (dataEquationCount === 0) {
    console.warn(`HDR1 response channel ${channel}: calibration had no usable cross-exposure samples; using linear response.`);
    return buildLinearDebevecResponseCurve(knotCount);
  }

  for (let knot = 1; knot < knotCount - 1; knot += 1) {
    const z = knot / (knotCount - 1);
    const rowWeight = HDR1_RESPONSE_SMOOTHNESS * debevecCalibrationWeight(z);
    const equationWeight = rowWeight * rowWeight;
    if (!(equationWeight > 0)) continue;
    accumulateDebevecNormalEquation(
      matrix,
      rhs,
      knotCount,
      [knot - 1, knot, knot + 1],
      [1, -2, 1],
      0,
      equationWeight,
    );
  }

  const hasKnownLinearInput = linearFlags.some((value) => value !== 0);
  if (!hasKnownLinearInput) {
    const anchor = Math.floor((knotCount - 1) / 2);
    matrix[anchor * knotCount + anchor] += 1;
  }
  for (let knot = 0; knot < knotCount; knot += 1) {
    matrix[knot * knotCount + knot] += HDR1_RESPONSE_RIDGE;
  }

  let curve;
  try {
    curve = solveDebevecSymmetricPositiveSystem(matrix, rhs, knotCount);
  } catch (error) {
    console.warn(`HDR1 response channel ${channel}: calibration solver failed; using linear response.`, error);
    return buildLinearDebevecResponseCurve(knotCount);
  }
  if (!curve.every(Number.isFinite)) {
    console.warn(`HDR1 response channel ${channel}: calibration produced non-finite values; using linear response.`);
    return buildLinearDebevecResponseCurve(knotCount);
  }
  return curve;
}

function appendDebevecInterpolationCoefficients(indices, coefficients, left, fraction, sign) {
  const entries = [
    [left, sign * (1 - fraction)],
    [left + 1, sign * fraction],
  ];
  for (const [index, coefficient] of entries) {
    if (Math.abs(coefficient) <= 1e-15) continue;
    const existing = indices.indexOf(index);
    if (existing >= 0) {
      coefficients[existing] += coefficient;
    } else {
      indices.push(index);
      coefficients.push(coefficient);
    }
  }
}

function accumulateDebevecNormalEquation(
  matrix,
  rhs,
  size,
  indices,
  coefficients,
  constant,
  equationWeight,
) {
  for (let a = 0; a < indices.length; a += 1) {
    const rowIndex = indices[a];
    const rowCoefficient = coefficients[a];
    rhs[rowIndex] -= equationWeight * rowCoefficient * constant;
    const rowOffset = rowIndex * size;
    for (let b = 0; b < indices.length; b += 1) {
      matrix[rowOffset + indices[b]] += equationWeight * rowCoefficient * coefficients[b];
    }
  }
}

function solveDebevecSymmetricPositiveSystem(matrix, rhs, size) {
  const lower = new Float64Array(matrix);
  const pivotFloor = 1e-12;
  for (let row = 0; row < size; row += 1) {
    for (let column = 0; column <= row; column += 1) {
      let sum = lower[row * size + column];
      for (let k = 0; k < column; k += 1) {
        sum -= lower[row * size + k] * lower[column * size + k];
      }
      if (row === column) {
        if (!(sum > pivotFloor)) sum = pivotFloor;
        lower[row * size + column] = Math.sqrt(sum);
      } else {
        lower[row * size + column] = sum / lower[column * size + column];
      }
    }
    for (let column = row + 1; column < size; column += 1) {
      lower[row * size + column] = 0;
    }
  }

  const intermediate = new Float64Array(size);
  for (let row = 0; row < size; row += 1) {
    let sum = rhs[row];
    for (let column = 0; column < row; column += 1) {
      sum -= lower[row * size + column] * intermediate[column];
    }
    intermediate[row] = sum / lower[row * size + row];
  }

  const solution = new Float64Array(size);
  for (let row = size - 1; row >= 0; row -= 1) {
    let sum = intermediate[row];
    for (let column = row + 1; column < size; column += 1) {
      sum -= lower[column * size + row] * solution[column];
    }
    solution[row] = sum / lower[row * size + row];
  }
  return solution;
}

function buildLinearDebevecResponseCurve(knotCount) {
  const curve = new Float64Array(knotCount);
  for (let knot = 0; knot < knotCount; knot += 1) {
    curve[knot] = debevecLogResponseFloat(knot / (knotCount - 1));
  }
  return curve;
}

function debevecCalibrationWeight(value) {
  // Normalized triangular Debevec weight.  Squaring happens when the weighted
  // residual row is converted to the normal equations.
  const x = clamp01(value);
  return Math.max(0, 1 - Math.abs(2 * x - 1));
}

function evaluateDebevecResponseCurve(curve, value) {
  const position = clamp01(value) * (curve.length - 1);
  const left = Math.min(curve.length - 2, Math.max(0, Math.floor(position)));
  const fraction = position - left;
  return curve[left] * (1 - fraction) + curve[left + 1] * fraction;
}

async function getDebevecStreamImageBuffer(state, imageIndex) {
  const memoryBuffer = state.memoryImages.get(imageIndex);
  if (memoryBuffer instanceof ArrayBuffer) return memoryBuffer;
  if (!state.db) throw new Error(`HDR1 input ${imageIndex + 1} is unavailable.`);
  return await getHdr2ScratchImage(state.db, hdr2ScratchKey(state.sessionId, imageIndex));
}

async function releaseDebevecStreamImage(state, imageIndex) {
  if (state.memoryImages.delete(imageIndex)) return;
  if (!state.db) return;
  try {
    await deleteHdr2ScratchImage(state.db, hdr2ScratchKey(state.sessionId, imageIndex));
  } catch (error) {
    console.warn(`Could not delete HDR1 scratch input ${imageIndex + 1}:`, error);
  }
}

async function mergeCalibratedDebevecStream(state, exposureTimes, responseCurves) {
  const pixelCount = state.width * state.height;
  const responseSums = new Float32Array(pixelCount * 3);
  const weightSums = new Float32Array(pixelCount * 3);
  const logTimes = new Float64Array(exposureTimes.length);
  for (let i = 0; i < exposureTimes.length; i += 1) logTimes[i] = Math.log(exposureTimes[i]);
  const expectedByteLength = pixelCount * 3 * Float32Array.BYTES_PER_ELEMENT;

  // Samples are no longer needed once the response curves have been solved.
  state.responseSamples = null;
  state.responseSampleIndices = null;

  for (let imageIndex = 0; imageIndex < state.imageCount; imageIndex += 1) {
    postProgress(`Merging calibrated HDR1 input ${imageIndex + 1}/${state.imageCount}...`);
    const buffer = await getDebevecStreamImageBuffer(state, imageIndex);
    if (buffer.byteLength !== expectedByteLength) {
      throw new Error(`HDR1 scratch input ${imageIndex + 1} has an invalid size.`);
    }
    const image = new Float32Array(buffer);
    const linearResponse = state.linearResponseFlags[imageIndex] !== 0;
    const logTime = logTimes[imageIndex];
    for (let offset = 0; offset < image.length; offset += 3) {
      for (let channel = 0; channel < 3; channel += 1) {
        const value = clamp01(image[offset + channel]);
        const weight = debevecWeightFloat(value);
        const response = linearResponse
          ? debevecLogResponseFloat(value)
          : evaluateDebevecResponseCurve(responseCurves[channel], value);
        responseSums[offset + channel] += weight * (response - logTime);
        weightSums[offset + channel] += weight;
      }
    }
    await releaseDebevecStreamImage(state, imageIndex);
  }

  for (let offset = 0; offset < responseSums.length; offset += 1) {
    const weightSum = weightSums[offset];
    const logRadiance = weightSum > 0 ? responseSums[offset] / weightSum : 0;
    responseSums[offset] = sanitizeHdrValue(Math.exp(logRadiance));
  }
  return responseSums;
}

async function cleanupDebevecStreamState() {
  const state = debevecStreamState;
  debevecStreamState = null;
  if (!state) return;
  state.memoryImages?.clear?.();
  if (!state.db || !state.sessionId) return;
  try {
    await deleteHdr2ScratchSession(state.db, state.sessionId);
  } finally {
    state.db.close();
  }
}

async function processMertensMessage(message) {
  const width = Number(message.width);
  const height = Number(message.height);
  const imageBuffers = Array.isArray(message.imageBuffers) ? message.imageBuffers : [];
  const brightnesses = new Float32Array(message.brightnessesBuffer || new ArrayBuffer(0));
  validateMertensInputs(width, height, imageBuffers, brightnesses);
  const images = imageBuffers.map((buffer) => new Float32Array(buffer));
  const saturationWeight = Number.isFinite(message.saturationWeight) ? Number(message.saturationWeight) : 0.1;
  const exposureWeight = Number.isFinite(message.exposureWeight) ? Number(message.exposureWeight) : 1;
  const targetBrightness = meanArray(brightnesses);
  postProgress("Loading OpenCV for HDR2 Mertens exposure fusion...");
  const cv = await loadWorkerOpenCv("HDR2");
  if (typeof cv.pyrDown !== "function" || typeof cv.pyrUp !== "function") {
    throw new Error("OpenCV.js does not provide pyrDown()/pyrUp() required for HDR2 Mertens fusion.");
  }

  postProgress("Merging HDR2 with OpenCV Gaussian/Laplacian Mertens fusion...");
  const merged = mergeMertensWithOpenCvPyramids(
    cv,
    images,
    width,
    height,
    saturationWeight,
    exposureWeight,
  );

  postProgress("Restoring HDR2 brightness...");
  adjustExposureToBrightnessInPlace(merged, targetBrightness);

  // `gamma2Buffer` is retained as the transport field name for compatibility.
  // The buffer contents are linear ProPhoto RGB; no gamma-2 transform is applied here.
  self.postMessage(
    { type: "mertens-result", gamma2Buffer: merged.buffer },
    [merged.buffer],
  );
}

const HDR2_SCRATCH_DB_NAME = "local-stack-studio-hdr2-scratch";
const HDR2_SCRATCH_DB_VERSION = 1;
const HDR2_SCRATCH_STORE = "images";

function createHdr2ScratchSessionId() {
  if (self.crypto && typeof self.crypto.randomUUID === "function") return self.crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function openHdr2ScratchDb() {
  return new Promise((resolve, reject) => {
    if (!("indexedDB" in self)) {
      reject(new Error("HDR2 streaming requires IndexedDB support in this browser."));
      return;
    }
    const request = indexedDB.open(HDR2_SCRATCH_DB_NAME, HDR2_SCRATCH_DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(HDR2_SCRATCH_STORE)) db.createObjectStore(HDR2_SCRATCH_STORE);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("Could not open HDR2 scratch storage."));
    request.onblocked = () => reject(new Error("HDR2 scratch storage is blocked by another Local Stack Studio tab."));
  });
}

function hdr2ScratchKey(sessionId, imageIndex) {
  return `${sessionId}:${imageIndex}`;
}

function putHdr2ScratchImage(db, key, buffer) {
  return new Promise((resolve, reject) => {
    let transaction;
    try {
      transaction = db.transaction(HDR2_SCRATCH_STORE, "readwrite");
      transaction.objectStore(HDR2_SCRATCH_STORE).put(buffer, key);
    } catch (error) {
      reject(error);
      return;
    }
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error || new Error("Could not write HDR2 scratch image."));
    transaction.onabort = () => reject(transaction.error || new Error("HDR2 scratch image write was aborted."));
  });
}

function getHdr2ScratchImage(db, key) {
  return new Promise((resolve, reject) => {
    let transaction;
    try {
      transaction = db.transaction(HDR2_SCRATCH_STORE, "readonly");
    } catch (error) {
      reject(error);
      return;
    }
    const request = transaction.objectStore(HDR2_SCRATCH_STORE).get(key);
    request.onsuccess = () => {
      if (!(request.result instanceof ArrayBuffer)) {
        reject(new Error("HDR2 scratch image is missing or invalid."));
        return;
      }
      resolve(request.result);
    };
    request.onerror = () => reject(request.error || new Error("Could not read HDR2 scratch image."));
  });
}

function deleteHdr2ScratchImage(db, key) {
  return new Promise((resolve, reject) => {
    let transaction;
    try {
      transaction = db.transaction(HDR2_SCRATCH_STORE, "readwrite");
      transaction.objectStore(HDR2_SCRATCH_STORE).delete(key);
    } catch (error) {
      reject(error);
      return;
    }
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error || new Error("Could not delete HDR2 scratch image."));
    transaction.onabort = () => reject(transaction.error || new Error("HDR2 scratch image deletion was aborted."));
  });
}

function deleteHdr2ScratchSession(db, sessionId) {
  return new Promise((resolve, reject) => {
    let transaction;
    try {
      transaction = db.transaction(HDR2_SCRATCH_STORE, "readwrite");
    } catch (error) {
      reject(error);
      return;
    }
    const store = transaction.objectStore(HDR2_SCRATCH_STORE);
    const prefix = `${sessionId}:`;
    const request = store.openCursor(IDBKeyRange.bound(prefix, `${prefix}\uffff`));
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) return;
      cursor.delete();
      cursor.continue();
    };
    request.onerror = () => reject(request.error || new Error("Could not enumerate HDR2 scratch images."));
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error || new Error("Could not clear HDR2 scratch images."));
    transaction.onabort = () => reject(transaction.error || new Error("HDR2 scratch cleanup was aborted."));
  });
}

async function initializeMertensStream(message) {
  if (mertensStreamState) throw new Error("HDR2 stream worker is already initialized.");
  const width = Number(message.width);
  const height = Number(message.height);
  const imageCount = Number(message.imageCount);
  if (!(Number.isInteger(width) && width > 0 && Number.isInteger(height) && height > 0)) {
    throw new Error("HDR2 worker received invalid image dimensions.");
  }
  if (!(Number.isInteger(imageCount) && imageCount >= 2)) {
    throw new Error("HDR2 streaming requires at least two input images.");
  }
  let db = null;
  try {
    db = await openHdr2ScratchDb();
  } catch (error) {
    console.warn("HDR2 IndexedDB scratch is unavailable; using in-memory streaming fallback:", error);
  }
  mertensStreamState = {
    width,
    height,
    imageCount,
    receivedCount: 0,
    brightnesses: new Float32Array(imageCount),
    receivedFlags: new Uint8Array(imageCount),
    saturationWeight: Number.isFinite(message.saturationWeight) ? Number(message.saturationWeight) : 0.1,
    exposureWeight: Number.isFinite(message.exposureWeight) ? Number(message.exposureWeight) : 1,
    db,
    sessionId: createHdr2ScratchSessionId(),
    memoryImages: new Map(),
    scratchWriteDisabled: !db,
  };
  mertensStreamState.brightnesses.fill(Number.NaN);
  self.postMessage({ type: "mertens-stream-ready", requestId: message.requestId });
}

async function appendMertensStreamImage(message) {
  const state = mertensStreamState;
  if (!state) throw new Error("HDR2 stream worker was not initialized.");
  const imageIndex = Number(message.imageIndex);
  const brightness = Number(message.brightness);
  if (!(Number.isInteger(imageIndex) && imageIndex >= 0 && imageIndex < state.imageCount)) {
    throw new Error("HDR2 stream worker received an invalid image index.");
  }
  if (state.receivedFlags[imageIndex]) throw new Error(`HDR2 input ${imageIndex + 1} was sent more than once.`);
  if (!(Number.isFinite(brightness) && brightness >= 0)) {
    throw new Error(`HDR2 input ${imageIndex + 1} has an invalid brightness value.`);
  }
  const imageBuffer = message.imageBuffer;
  const expectedByteLength = state.width * state.height * 3 * Float32Array.BYTES_PER_ELEMENT;
  if (!(imageBuffer instanceof ArrayBuffer) || imageBuffer.byteLength !== expectedByteLength) {
    throw new Error(`HDR2 input ${imageIndex + 1} has an invalid Float32 RGB buffer.`);
  }
  if (!state.scratchWriteDisabled && state.db) {
    postProgress(`Storing HDR2 input ${imageIndex + 1}/${state.imageCount} in scratch space...`);
    try {
      await putHdr2ScratchImage(state.db, hdr2ScratchKey(state.sessionId, imageIndex), imageBuffer);
    } catch (error) {
      state.scratchWriteDisabled = true;
      state.memoryImages.set(imageIndex, imageBuffer);
      console.warn("HDR2 scratch write failed; keeping remaining inputs in worker memory:", error);
    }
  } else {
    state.memoryImages.set(imageIndex, imageBuffer);
  }
  state.receivedFlags[imageIndex] = 1;
  state.brightnesses[imageIndex] = brightness;
  state.receivedCount += 1;
  self.postMessage({
    type: "mertens-stream-image-stored",
    requestId: message.requestId,
    imageIndex,
  });
}

async function getMertensStreamImageBuffer(state, imageIndex) {
  const memoryBuffer = state.memoryImages.get(imageIndex);
  if (memoryBuffer instanceof ArrayBuffer) return memoryBuffer;
  if (!state.db) throw new Error(`HDR2 input ${imageIndex + 1} is unavailable.`);
  return await getHdr2ScratchImage(state.db, hdr2ScratchKey(state.sessionId, imageIndex));
}

async function releaseMertensStreamImage(state, imageIndex) {
  if (state.memoryImages.delete(imageIndex)) return;
  if (!state.db) return;
  try {
    await deleteHdr2ScratchImage(state.db, hdr2ScratchKey(state.sessionId, imageIndex));
  } catch (error) {
    console.warn(`Could not delete HDR2 scratch input ${imageIndex + 1}:`, error);
  }
}

async function finalizeMertensStream(message) {
  const state = mertensStreamState;
  if (!state) throw new Error("HDR2 stream worker was not initialized.");
  if (state.receivedCount !== state.imageCount) {
    throw new Error(`HDR2 stream worker received ${state.receivedCount}/${state.imageCount} input images.`);
  }
  for (let i = 0; i < state.brightnesses.length; i += 1) {
    if (!(Number.isFinite(state.brightnesses[i]) && state.brightnesses[i] >= 0)) {
      throw new Error(`HDR2 input ${i + 1} has an invalid brightness value.`);
    }
  }

  postProgress("Loading OpenCV for HDR2 Mertens exposure fusion...");
  const cv = await loadWorkerOpenCv("HDR2");
  if (typeof cv.pyrDown !== "function" || typeof cv.pyrUp !== "function") {
    throw new Error("OpenCV.js does not provide pyrDown()/pyrUp() required for HDR2 Mertens fusion.");
  }
  const dimensions = buildOpenCvMertensPyramidDimensions(state.width, state.height);
  const fusedLevels = createMertensFusedLevels(dimensions);
  const expectedByteLength = state.width * state.height * 3 * Float32Array.BYTES_PER_ELEMENT;
  const weightSums = new Float32Array(state.width * state.height);

  // Mertens normalization is a two-pass algorithm. Read scratch inputs in
  // image-index order for both passes so Float32 accumulation order matches
  // the former all-in-memory implementation even when alignment recovery
  // delivered some images out of order.
  for (let imageIndex = 0; imageIndex < state.imageCount; imageIndex += 1) {
    postProgress(`Analyzing HDR2 weights ${imageIndex + 1}/${state.imageCount}...`);
    const buffer = await getMertensStreamImageBuffer(state, imageIndex);
    if (buffer.byteLength !== expectedByteLength) {
      throw new Error(`HDR2 scratch input ${imageIndex + 1} has an invalid size.`);
    }
    accumulateOpenCvMertensWeightSums(
      new Float32Array(buffer),
      state.width,
      state.height,
      state.saturationWeight,
      state.exposureWeight,
      weightSums,
    );
  }

  for (let imageIndex = 0; imageIndex < state.imageCount; imageIndex += 1) {
    postProgress(`Merging HDR2 input ${imageIndex + 1}/${state.imageCount}...`);
    const buffer = await getMertensStreamImageBuffer(state, imageIndex);
    if (buffer.byteLength !== expectedByteLength) {
      throw new Error(`HDR2 scratch input ${imageIndex + 1} has an invalid size.`);
    }
    accumulateMertensImagePyramid(
      cv,
      new Float32Array(buffer),
      state.imageCount,
      state.width,
      state.height,
      state.saturationWeight,
      state.exposureWeight,
      weightSums,
      dimensions,
      fusedLevels,
    );
    await releaseMertensStreamImage(state, imageIndex);
  }

  const merged = reconstructMertensFusedLevels(cv, fusedLevels, dimensions, state.width, state.height);
  postProgress("Restoring HDR2 brightness...");
  adjustExposureToBrightnessInPlace(merged, meanArray(state.brightnesses));
  try {
    await cleanupMertensStreamState();
  } catch (error) {
    console.warn("Could not fully clear HDR2 scratch images:", error);
  }
  self.postMessage(
    { type: "mertens-result", requestId: message.requestId, gamma2Buffer: merged.buffer },
    [merged.buffer],
  );
}

async function cleanupMertensStreamState() {
  const state = mertensStreamState;
  mertensStreamState = null;
  if (!state) return;
  state.memoryImages.clear();
  if (!state.db) return;
  try {
    await deleteHdr2ScratchSession(state.db, state.sessionId);
  } finally {
    state.db.close();
  }
}

const MERTENS_PROCESSING_GAMMA = 2.4;
const MERTENS_WEIGHT_EPSILON = 1e-12;

function mergeMertensWithOpenCvPyramids(cv, images, width, height, saturationWeight, exposureWeight) {
  const pixelCount = width * height;
  const weightSums = new Float32Array(pixelCount);

  // Build full-resolution Mertens weights in the gamma-2.4
  // processing domain. contrastWeight is fixed to zero for LSS HDR2.
  for (let imageIndex = 0; imageIndex < images.length; imageIndex += 1) {
    accumulateOpenCvMertensWeightSums(
      images[imageIndex],
      width,
      height,
      saturationWeight,
      exposureWeight,
      weightSums,
    );
  }

  const dimensions = buildOpenCvMertensPyramidDimensions(width, height);
  const fusedLevels = createMertensFusedLevels(dimensions);
  for (let imageIndex = 0; imageIndex < images.length; imageIndex += 1) {
    accumulateMertensImagePyramid(
      cv,
      images[imageIndex],
      images.length,
      width,
      height,
      saturationWeight,
      exposureWeight,
      weightSums,
      dimensions,
      fusedLevels,
    );
    images[imageIndex] = null;
  }
  return reconstructMertensFusedLevels(cv, fusedLevels, dimensions, width, height);
}

function createMertensFusedLevels(dimensions) {
  return dimensions.map(({ width: levelWidth, height: levelHeight }) =>
    new Float32Array(levelWidth * levelHeight * 3));
}

function accumulateMertensImagePyramid(
  cv,
  source,
  imageCount,
  width,
  height,
  saturationWeight,
  exposureWeight,
  weightSums,
  dimensions,
  fusedLevels,
) {
  const pixelCount = width * height;
  let currentRgb = new cv.Mat(height, width, cv.CV_32FC3);
  let currentWeight = new cv.Mat(height, width, cv.CV_32FC1);
  try {
    const rgbData = currentRgb.data32F;
    const weightData = currentWeight.data32F;
    for (let pixel = 0; pixel < pixelCount; pixel += 1) {
      const offset = pixel * 3;
      const r = mertensGammaEncode(source[offset]);
      const g = mertensGammaEncode(source[offset + 1]);
      const b = mertensGammaEncode(source[offset + 2]);
      rgbData[offset] = r;
      rgbData[offset + 1] = g;
      rgbData[offset + 2] = b;
      const denominator = weightSums[pixel];
      const weight = openCvMertensPixelWeightEncoded(r, g, b, saturationWeight, exposureWeight);
      weightData[pixel] = denominator > 1e-20 ? weight / denominator : 1 / imageCount;
    }

    for (let level = 0; level < dimensions.length - 1; level += 1) {
      const nextDim = dimensions[level + 1];
      const nextRgb = new cv.Mat();
      const nextWeight = new cv.Mat();
      const upRgb = new cv.Mat();
      try {
        cv.pyrDown(currentRgb, nextRgb, new cv.Size(nextDim.width, nextDim.height));
        cv.pyrDown(currentWeight, nextWeight, new cv.Size(nextDim.width, nextDim.height));
        cv.pyrUp(nextRgb, upRgb, new cv.Size(currentRgb.cols, currentRgb.rows));

        const currentRgbData = currentRgb.data32F;
        const expandedRgbData = upRgb.data32F;
        const currentWeightData = currentWeight.data32F;
        const fused = fusedLevels[level];
        for (let pixel = 0; pixel < currentWeightData.length; pixel += 1) {
          const weight = currentWeightData[pixel];
          const offset = pixel * 3;
          fused[offset] += (currentRgbData[offset] - expandedRgbData[offset]) * weight;
          fused[offset + 1] += (currentRgbData[offset + 1] - expandedRgbData[offset + 1]) * weight;
          fused[offset + 2] += (currentRgbData[offset + 2] - expandedRgbData[offset + 2]) * weight;
        }
      } catch (error) {
        nextRgb.delete();
        nextWeight.delete();
        throw error;
      } finally {
        upRgb.delete();
      }
      currentRgb.delete();
      currentWeight.delete();
      currentRgb = nextRgb;
      currentWeight = nextWeight;
    }

    const lowestLevel = fusedLevels[fusedLevels.length - 1];
    const lowestRgb = currentRgb.data32F;
    const lowestWeight = currentWeight.data32F;
    for (let pixel = 0; pixel < lowestWeight.length; pixel += 1) {
      const weight = lowestWeight[pixel];
      const offset = pixel * 3;
      lowestLevel[offset] += lowestRgb[offset] * weight;
      lowestLevel[offset + 1] += lowestRgb[offset + 1] * weight;
      lowestLevel[offset + 2] += lowestRgb[offset + 2] * weight;
    }
  } finally {
    if (currentRgb) currentRgb.delete();
    if (currentWeight) currentWeight.delete();
  }
}

function reconstructMertensFusedLevels(cv, fusedLevels, dimensions, width, height) {
  let reconstructed = fusedLevels[fusedLevels.length - 1];
  for (let level = fusedLevels.length - 2; level >= 0; level -= 1) {
    const sourceDim = dimensions[level + 1];
    const targetDim = dimensions[level];
    const sourceMat = new cv.Mat(sourceDim.height, sourceDim.width, cv.CV_32FC3);
    const up = new cv.Mat();
    sourceMat.data32F.set(reconstructed);
    try {
      cv.pyrUp(sourceMat, up, new cv.Size(targetDim.width, targetDim.height));
      const next = fusedLevels[level];
      const upData = up.data32F;
      for (let i = 0; i < next.length; i += 1) next[i] += upData[i];
      reconstructed = next;
    } finally {
      sourceMat.delete();
      up.delete();
    }
  }
  return decodeMertensGammaBuffer(reconstructed, width * height * 3);
}

function buildOpenCvMertensPyramidDimensions(width, height) {
  // OpenCV MergeMertens uses floor(log2(min(width,height))) as maxlevel.
  const maxLevel = Math.max(0, Math.floor(Math.log2(Math.max(1, Math.min(width, height)))));
  const dimensions = [{ width, height }];
  for (let level = 0; level < maxLevel; level += 1) {
    const previous = dimensions[dimensions.length - 1];
    dimensions.push({
      width: Math.max(1, Math.ceil(previous.width / 2)),
      height: Math.max(1, Math.ceil(previous.height / 2)),
    });
  }
  return dimensions;
}

function accumulateOpenCvMertensWeightSums(
  image,
  width,
  height,
  saturationWeight,
  exposureWeight,
  sums,
) {
  const pixelCount = width * height;
  for (let pixel = 0; pixel < pixelCount; pixel += 1) {
    const offset = pixel * 3;
    const r = mertensGammaEncode(image[offset]);
    const g = mertensGammaEncode(image[offset + 1]);
    const b = mertensGammaEncode(image[offset + 2]);
    sums[pixel] += openCvMertensPixelWeightEncoded(r, g, b, saturationWeight, exposureWeight);
  }
}

function openCvMertensPixelWeightEncoded(r, g, b, saturationWeight, exposureWeight) {
  let weight = 1;
  if (saturationWeight !== 0) {
    const mean = (r + g + b) / 3;
    // OpenCV uses sqrt(sum((channel - mean)^2)); it does not divide by the
    // number of channels before sqrt.
    const saturation = Math.sqrt(
      (r - mean) * (r - mean)
      + (g - mean) * (g - mean)
      + (b - mean) * (b - mean),
    );
    weight *= Math.pow(Math.max(saturation, MERTENS_WEIGHT_EPSILON), saturationWeight);
  }
  if (exposureWeight !== 0) {
    // Well-exposedness: exp(-(channel - 0.5)^2 / 0.08), multiplied across RGB.
    const dr = r - 0.5;
    const dg = g - 0.5;
    const db = b - 0.5;
    const exposedness = Math.exp(-(dr * dr + dg * dg + db * db) / 0.08);
    weight *= Math.pow(Math.max(exposedness, MERTENS_WEIGHT_EPSILON), exposureWeight);
  }
  return weight + MERTENS_WEIGHT_EPSILON;
}

function mertensGammaEncode(value) {
  return Math.pow(clamp01(value), 1 / MERTENS_PROCESSING_GAMMA);
}

function decodeMertensGammaBuffer(encoded, expectedLength) {
  const output = new Float32Array(expectedLength);
  for (let i = 0; i < expectedLength; i += 1) {
    // Laplacian reconstruction can overshoot its nominal range. Clamp before
    // inverse gamma so negative values cannot generate NaNs.
    output[i] = Math.pow(clamp01(encoded[i]), MERTENS_PROCESSING_GAMMA);
  }
  return output;
}

function validateInputs(width, height, imageBuffers, exposureTimes, brightnesses) {
  if (!(Number.isInteger(width) && width > 0 && Number.isInteger(height) && height > 0)) {
    throw new Error("HDR worker received invalid image dimensions.");
  }
  if (imageBuffers.length < 2) {
    throw new Error("HDR (Debevec) requires at least two input images.");
  }
  if (exposureTimes.length !== 0 && exposureTimes.length !== imageBuffers.length) {
    throw new Error("HDR exposure-time count does not match the image count.");
  }
  if (brightnesses.length !== imageBuffers.length) {
    throw new Error("HDR brightness count does not match the image count.");
  }

  const expectedLength = width * height * 3;
  const expectedByteLength = expectedLength * Float32Array.BYTES_PER_ELEMENT;
  for (let i = 0; i < imageBuffers.length; i += 1) {
    if (!(imageBuffers[i] instanceof ArrayBuffer) || imageBuffers[i].byteLength !== expectedByteLength) {
      throw new Error(`HDR input ${i + 1} has an invalid Float32 RGB buffer.`);
    }
    if (exposureTimes.length > 0 && !(Number.isFinite(exposureTimes[i]) && exposureTimes[i] > 0)) {
      throw new Error(`HDR input ${i + 1} has an invalid exposure value.`);
    }
    if (!(Number.isFinite(brightnesses[i]) && brightnesses[i] >= 0)) {
      throw new Error(`HDR input ${i + 1} has an invalid brightness value.`);
    }
  }
}

function postProgress(message) {
  self.postMessage({ type: "progress", message });
}

function debevecWeightFloat(value) {
  const x = clamp01(value);
  if (x <= 0 || x >= 1) return HDR_FLOAT_WEIGHT_EPSILON;
  return Math.min(x, 1 - x);
}

function debevecLogResponseFloat(value) {
  // Float32 HDR1 materials are normalized linear RGB in [0,1].
  // Keep the normalized linear Float32 value continuous.  The floor is well
  // below the smallest non-zero value produced by decoding a gamma-2 Uint16
  // sample, so HDR1 does not throw away that shadow precision before log().
  return Math.log(Math.max(clamp01(value), HDR_FLOAT_MIN_RESPONSE));
}

function resolveExposureTimes(suppliedExposureTimes, brightnesses) {
  if (suppliedExposureTimes.length > 0) {
    return suppliedExposureTimes;
  }

  let minBrightness = Infinity;
  for (let i = 0; i < brightnesses.length; i += 1) {
    if (brightnesses[i] < minBrightness) minBrightness = brightnesses[i];
  }
  const denominator = Math.max(minBrightness, 0.0001);
  const exposureTimes = new Float32Array(brightnesses.length);
  for (let i = 0; i < brightnesses.length; i += 1) {
    exposureTimes[i] = Math.max(brightnesses[i] / denominator, 1e-6);
  }
  return exposureTimes;
}

function mergeDebevecWithLinearResponse(images, exposureTimes, width, height) {
  const pixelCount = width * height;
  const result = new Float32Array(pixelCount * 3);
  const logTimes = new Float64Array(exposureTimes.length);
  for (let i = 0; i < exposureTimes.length; i += 1) {
    logTimes[i] = Math.log(exposureTimes[i]);
  }

  for (let pixel = 0, offset = 0; pixel < pixelCount; pixel += 1, offset += 3) {
    const sums = [0, 0, 0];
    const weightSums = [0, 0, 0];
    for (let imageIndex = 0; imageIndex < images.length; imageIndex += 1) {
      const image = images[imageIndex];
      const logTime = logTimes[imageIndex];
      for (let channel = 0; channel < 3; channel += 1) {
        const value = clamp01(image[offset + channel]);
        const weight = debevecWeightFloat(value);
        sums[channel] += weight * (debevecLogResponseFloat(value) - logTime);
        weightSums[channel] += weight;
      }
    }
    for (let channel = 0; channel < 3; channel += 1) {
      result[offset + channel] = sanitizeHdrValue(Math.exp(
        weightSums[channel] > 0 ? sums[channel] / weightSums[channel] : 0,
      ));
    }
  }

  return result;
}

function sanitizeHdrValue(value) {
  if (Number.isNaN(value) || value === -Infinity || value < 0) return 0;
  if (value === Infinity) return 1;
  return value;
}

function proPhotoLinearLuminance(r, g, b) {
  return PROPHOTO_TONE_LUMA_R * r + PROPHOTO_TONE_LUMA_G * g + PROPHOTO_TONE_LUMA_B * b;
}

function tonemapReinhardInPlace(image, gamma, intensity, lightAdapt, colorAdapt) {
  // Keep HDR tone mapping chroma-preserving: derive the Reinhard mapping from
  // one ProPhoto luminance value and apply the resulting scale to R/G/B.
  // colorAdapt is intentionally ignored because channel-specific adaptation
  // changes chromaticity.
  void colorAdapt;
  normalizeRgbInPlace(image);

  const pixelCount = image.length / 3;
  let sumLog = 0;
  let logMin = Infinity;
  let logMax = -Infinity;
  let sumLuminance = 0;

  for (let i = 0; i < image.length; i += 3) {
    const luminance = Math.max(0, proPhotoLinearLuminance(image[i], image[i + 1], image[i + 2]));
    const logLuminance = Math.log(Math.max(luminance, 1e-4));
    sumLog += logLuminance;
    if (logLuminance < logMin) logMin = logLuminance;
    if (logLuminance > logMax) logMax = logLuminance;
    sumLuminance += luminance;
  }

  const logMean = sumLog / pixelCount;
  const logRange = logMax - logMin;
  const key = logRange > Number.EPSILON ? (logMax - logMean) / logRange : 0.5;
  const mapKey = 0.3 + 0.7 * Math.pow(Math.max(0, key), 1.4);
  const intensityScale = Math.exp(-intensity);
  const globalLuminance = sumLuminance / pixelCount;

  for (let i = 0; i < image.length; i += 3) {
    const r = image[i];
    const g = image[i + 1];
    const b = image[i + 2];
    const luminance = Math.max(0, proPhotoLinearLuminance(r, g, b));
    if (!(luminance > 1e-12)) continue;

    const adapt = lightAdapt * luminance + (1 - lightAdapt) * globalLuminance;
    const mappedAdapt = Math.pow(Math.max(0, intensityScale * adapt), mapKey);
    const targetLuminance = luminance / (mappedAdapt + luminance);
    const scale = targetLuminance / luminance;
    image[i] = r * scale;
    image[i + 1] = g * scale;
    image[i + 2] = b * scale;
  }

  normalizeRgbInPlace(image);
  if (gamma !== 1) {
    const exponent = 1 / gamma;
    for (let i = 0; i < image.length; i += 3) {
      const r = image[i];
      const g = image[i + 1];
      const b = image[i + 2];
      const luminance = Math.max(0, proPhotoLinearLuminance(r, g, b));
      if (!(luminance > 1e-12)) continue;
      const targetLuminance = Math.pow(luminance, exponent);
      const scale = targetLuminance / luminance;
      image[i] = r * scale;
      image[i + 1] = g * scale;
      image[i + 2] = b * scale;
    }
  }
}

function adjustExposureToBrightnessInPlace(image, targetBrightness) {
  const target = clamp01(targetBrightness);
  let brightness = computeBrightness(image) + 1e-6;
  let distance = Math.abs(Math.log(Math.max(target, 1e-6) / brightness));
  if (distance < BRIGHTNESS_MAX_DIST) return;

  const increase = target > brightness;
  let upper = 8.0;
  let lower = 1 / upper;

  for (let attempt = 1; attempt <= BRIGHTNESS_MAX_TRIES; attempt += 1) {
    let gain = Math.sqrt(upper * lower);
    if (!increase) gain *= -1;

    const candidate = applyScaledLog(image, gain);
    brightness = computeBrightness(candidate) + 1e-6;
    distance = Math.abs(Math.log(Math.max(target, 1e-6) / brightness));
    if (distance < BRIGHTNESS_MAX_DIST || attempt >= BRIGHTNESS_MAX_TRIES) {
      image.set(candidate);
      return;
    }

    if (increase) {
      if (target > brightness) {
        if (attempt < BRIGHTNESS_MAX_TRIES / 2) upper *= 2;
        lower = gain;
      } else {
        upper = gain;
      }
    } else if (target < brightness) {
      if (attempt < BRIGHTNESS_MAX_TRIES / 2) upper *= 2;
      lower = -gain;
    } else {
      upper = -gain;
    }
  }
}

function applyScaledLog(image, factor) {
  const output = new Float32Array(image.length);
  for (let i = 0; i < image.length; i += 3) {
    const r = Math.max(0, image[i]);
    const g = Math.max(0, image[i + 1]);
    const b = Math.max(0, image[i + 2]);
    const luminance = Math.max(0, proPhotoLinearLuminance(r, g, b));
    let scale = 1;
    if (luminance > 1e-12) {
      let targetLuminance = luminance;
      if (factor > 1e-6) {
        const denominator = Math.log1p(factor);
        targetLuminance = Math.log1p(clamp01(luminance) * factor) / denominator;
      } else if (factor < -1e-6) {
        const positiveFactor = -factor;
        const logFactor = Math.log1p(positiveFactor);
        targetLuminance = Math.expm1(clamp01(luminance) * logFactor) / positiveFactor;
      }
      scale = targetLuminance / luminance;
    }

    let outR = r * scale;
    let outG = g * scale;
    let outB = b * scale;
    const maxChannel = Math.max(outR, outG, outB);
    if (maxChannel > 1) {
      const fitScale = 1 / maxChannel;
      outR *= fitScale;
      outG *= fitScale;
      outB *= fitScale;
    }
    output[i] = outR;
    output[i + 1] = outG;
    output[i + 2] = outB;
  }
  return output;
}

function computeBrightness(image) {
  let sum = 0;
  const pixelCount = image.length / 3;
  for (let i = 0; i < image.length; i += 3) {
    sum += 0.299 * image[i] + 0.587 * image[i + 1] + 0.114 * image[i + 2];
  }
  return pixelCount > 0 ? sum / pixelCount : 0;
}

function meanArray(values) {
  if (values.length === 0) return 0;
  let sum = 0;
  for (let i = 0; i < values.length; i += 1) sum += values[i];
  return sum / values.length;
}

function normalizeRgbInPlace(image) {
  let maxValue = 0;
  for (let i = 0; i < image.length; i += 1) {
    const value = image[i];
    if (!Number.isFinite(value)) {
      throw new Error("HDR processing produced non-finite image values.");
    }
    if (value > maxValue) maxValue = value;
  }
  if (!(maxValue > Number.EPSILON)) return;
  const scale = 1 / maxValue;
  for (let i = 0; i < image.length; i += 1) {
    image[i] = Math.max(0, image[i]) * scale;
  }
}

function clamp01(value) {
  if (!Number.isFinite(value) || value <= 0) return 0;
  if (value >= 1) return 1;
  return value;
}

function validateMertensInputs(width, height, imageBuffers, brightnesses) {
  if (!(Number.isInteger(width) && width > 0 && Number.isInteger(height) && height > 0)) {
    throw new Error("HDR2 worker received invalid image dimensions.");
  }
  if (imageBuffers.length < 2) {
    throw new Error("HDR2 (Mertens) requires at least two input images.");
  }
  if (brightnesses.length !== imageBuffers.length) {
    throw new Error("HDR2 brightness count does not match the image count.");
  }
  const expectedLength = width * height * 3;
  const expectedByteLength = expectedLength * Float32Array.BYTES_PER_ELEMENT;
  for (let i = 0; i < imageBuffers.length; i += 1) {
    if (!(imageBuffers[i] instanceof ArrayBuffer) || imageBuffers[i].byteLength !== expectedByteLength) {
      throw new Error(`HDR2 input ${i + 1} has an invalid Float32 RGB buffer.`);
    }
    if (!(Number.isFinite(brightnesses[i]) && brightnesses[i] >= 0)) {
      throw new Error(`HDR2 input ${i + 1} has an invalid brightness value.`);
    }
  }
}
