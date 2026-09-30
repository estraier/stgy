// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-nocheck
// Local Stack Studio worker source. Built to public/generated/local-stack-studio.
import { loadWorkerOpenCv } from "./opencv-runtime";
import { asHdrWorkerRequest, type HdrWorkerRequest } from "./protocols/hdr-protocol";
const HDR_FLOAT_MIN_RESPONSE = 1e-12;
const HDR_FLOAT_WEIGHT_EPSILON = 1e-12;
const REINHARD_GAMMA = 1.0;
const REINHARD_INTENSITY = 0.0;
const REINHARD_LIGHT_ADAPT = 0.5;
const REINHARD_COLOR_ADAPT = 0.5;
const BRIGHTNESS_MAX_TRIES = 10;
const BRIGHTNESS_MAX_DIST = 0.01;
// Physical/colorimetric ProPhoto RGB -> XYZ D50 Y. Reinhard uses this
// luminance by design; editorial brightness restoration uses the separate
// 3:5:2 Tone intensity below.
const PROPHOTO_XYZ_Y_R = 0.2880402;
const PROPHOTO_XYZ_Y_G = 0.7118741;
const PROPHOTO_XYZ_Y_B = 0.0000857;
const TONE_INTENSITY_R = 0.3;
const TONE_INTENSITY_G = 0.5;
const TONE_INTENSITY_B = 0.2;
const HDR1_RESPONSE_KNOT_COUNT = 256;
const HDR1_RESPONSE_SAMPLE_LIMIT = 4096;
const HDR1_RESPONSE_SAMPLE_OBSERVATION_TARGET = 32768;
const HDR1_RESPONSE_SMOOTHNESS = 10;
const HDR1_RESPONSE_RIDGE = 1e-10;

let debevecStreamState = null;
let mertensStreamState = null;
let workerMessageQueue = Promise.resolve();

self.onmessage = (event) => {
  const message = asHdrWorkerRequest(event.data);
  if (!message) {
    self.postMessage({ type: "error", message: "HDR worker received an unsupported message." });
    return;
  }
  workerMessageQueue = workerMessageQueue
    .then(() => dispatchWorkerMessage(message))
    .catch(async (error) => {
      if (debevecStreamState) {
        try {
          await cleanupDebevecStreamState();
        } catch {
          // Best-effort state cleanup; report the original processing error.
        }
      }
      if (mertensStreamState) {
        try {
          await cleanupMertensStreamState();
        } catch {
          // Best-effort state cleanup; report the original processing error.
        }
      }
      self.postMessage({
        type: "error",
        message: error instanceof Error ? error.message : String(error),
      });
    });
};

async function dispatchWorkerMessage(message: HdrWorkerRequest) {
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
  if (message.type === "merge-stream-pass2-begin") {
    await beginDebevecSecondPass(message);
    return;
  }
  if (message.type === "merge-stream-pass2-image") {
    await appendDebevecSecondPassImage(message);
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
  if (message.type === "mertens-stream-pass2-begin") {
    await beginMertensSecondPass(message);
    return;
  }
  if (message.type === "mertens-stream-pass2-image") {
    await appendMertensSecondPassImage(message);
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
  debevecStreamState = {
    width,
    height,
    imageCount,
    receivedCount: 0,
    responseSums: needsResponseCalibration ? null : new Float32Array(pixelCount * 3),
    weightSums: needsResponseCalibration ? null : new Float32Array(pixelCount),
    weightedLogBrightnessSums: !needsResponseCalibration && suppliedExposureTimes.length === 0
      ? new Float32Array(pixelCount)
      : null,
    brightnesses: new Float32Array(imageCount),
    receivedFlags: new Uint8Array(imageCount),
    suppliedExposureTimes,
    linearResponseFlags,
    needsResponseCalibration,
    responseSampleIndices: needsResponseCalibration ? buildDebevecResponseSampleIndices(width, height, sampleCount) : null,
    responseSamples: needsResponseCalibration ? new Float32Array(imageCount * sampleCount * 3) : null,
    responseSampleCount: sampleCount,
    calibratedExposureTimes: null,
    calibratedResponseCurves: null,
    calibratedResponseSums: null,
    calibratedWeightSums: null,
    pass2ReceivedFlags: null,
    pass2ReceivedCount: 0,
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
    if (state.pass2ReceivedCount !== state.imageCount || !state.calibratedResponseSums || !state.calibratedWeightSums) {
      throw new Error(`HDR1 calibrated second pass received ${state.pass2ReceivedCount}/${state.imageCount} input images.`);
    }
    postProgress("Finalizing calibrated HDR1 radiance...");
    hdr = finalizeCalibratedDebevecAccumulation(state);
  } else {
    postProgress("Finalizing streamed HDR with linear Debevec response...");
    hdr = finalizeLinearDebevecStreamToHdr(state);
  }

  const targetBrightness = meanArray(brightnesses);
  try {
    await cleanupDebevecStreamState();
  } catch (error) {
    console.warn("Could not fully clear HDR1 stream state:", error);
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
    const r = clamp01(image[offset]);
    const g = clamp01(image[offset + 1]);
    const b = clamp01(image[offset + 2]);
    const weight = debevecPixelWeight(r, g, b);
    responseSums[offset] += weight * (debevecLogResponseFloat(r) - logExposureTime);
    responseSums[offset + 1] += weight * (debevecLogResponseFloat(g) - logExposureTime);
    responseSums[offset + 2] += weight * (debevecLogResponseFloat(b) - logExposureTime);
    weightSums[pixel] += weight;
    if (weightedLogBrightnessSums) {
      weightedLogBrightnessSums[pixel] += weight * logBrightness;
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
  const pixelCount = state.width * state.height;

  for (let pixel = 0, offset = 0; pixel < pixelCount; pixel += 1, offset += 3) {
    const weightSum = weightSums[pixel];
    const weightedLogTime = weightedLogBrightnessSums
      ? weightedLogBrightnessSums[pixel] - minLogBrightness * weightSum
      : 0;
    for (let channel = 0; channel < 3; channel += 1) {
      const logRadiance = weightSum > 0
        ? (responseSums[offset + channel] - weightedLogTime) / weightSum
        : 0;
      responseSums[offset + channel] = sanitizeHdrValue(Math.exp(logRadiance));
    }
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

async function beginDebevecSecondPass(message) {
  const state = debevecStreamState;
  if (!state) throw new Error("HDR1 stream worker was not initialized.");
  if (!state.needsResponseCalibration) {
    self.postMessage({ type: "merge-stream-pass2-ready", requestId: message.requestId });
    return;
  }
  if (state.receivedCount !== state.imageCount) {
    throw new Error(`HDR1 response pass received ${state.receivedCount}/${state.imageCount} input images.`);
  }
  postProgress("Calibrating HDR1 Debevec response curve...");
  state.calibratedExposureTimes = resolveExposureTimes(state.suppliedExposureTimes, state.brightnesses);
  state.calibratedResponseCurves = estimateDebevecResponseCurves(state, state.calibratedExposureTimes);
  const pixelCount = state.width * state.height;
  state.calibratedResponseSums = new Float32Array(pixelCount * 3);
  state.calibratedWeightSums = new Float32Array(pixelCount);
  state.pass2ReceivedFlags = new Uint8Array(state.imageCount);
  state.pass2ReceivedCount = 0;
  state.responseSamples = null;
  state.responseSampleIndices = null;
  self.postMessage({ type: "merge-stream-pass2-ready", requestId: message.requestId });
}

async function appendDebevecSecondPassImage(message) {
  const state = debevecStreamState;
  if (!state || !state.needsResponseCalibration) throw new Error("HDR1 calibrated second pass is not initialized.");
  if (!state.calibratedExposureTimes || !state.calibratedResponseCurves || !state.calibratedResponseSums || !state.calibratedWeightSums || !state.pass2ReceivedFlags) {
    throw new Error("HDR1 calibrated second pass has not begun.");
  }
  const imageIndex = Number(message.imageIndex);
  if (!(Number.isInteger(imageIndex) && imageIndex >= 0 && imageIndex < state.imageCount)) throw new Error("HDR1 second pass received an invalid image index.");
  if (state.pass2ReceivedFlags[imageIndex]) throw new Error(`HDR1 second-pass input ${imageIndex + 1} was sent more than once.`);
  const buffer = message.imageBuffer;
  const expected = state.width * state.height * 3 * Float32Array.BYTES_PER_ELEMENT;
  if (!(buffer instanceof ArrayBuffer) || buffer.byteLength !== expected) throw new Error(`HDR1 second-pass input ${imageIndex + 1} has an invalid Float32 RGB buffer.`);
  accumulateCalibratedDebevecImage(state, imageIndex, new Float32Array(buffer));
  state.pass2ReceivedFlags[imageIndex] = 1;
  state.pass2ReceivedCount += 1;
  self.postMessage({ type: "merge-stream-pass2-image-accepted", requestId: message.requestId, imageIndex });
}

function accumulateCalibratedDebevecImage(state, imageIndex, image) {
  const exposureTimes = state.calibratedExposureTimes;
  const curves = state.calibratedResponseCurves;
  const responseSums = state.calibratedResponseSums;
  const weightSums = state.calibratedWeightSums;
  const logTime = Math.log(exposureTimes[imageIndex]);
  const linearResponse = state.linearResponseFlags[imageIndex] !== 0;
  const pixelCount = state.width * state.height;
  for (let pixel = 0, offset = 0; pixel < pixelCount; pixel += 1, offset += 3) {
    const r = clamp01(image[offset]), g = clamp01(image[offset + 1]), b = clamp01(image[offset + 2]);
    const weight = debevecPixelWeight(r, g, b);
    responseSums[offset] += weight * ((linearResponse ? debevecLogResponseFloat(r) : evaluateDebevecResponseCurve(curves[0], r)) - logTime);
    responseSums[offset + 1] += weight * ((linearResponse ? debevecLogResponseFloat(g) : evaluateDebevecResponseCurve(curves[1], g)) - logTime);
    responseSums[offset + 2] += weight * ((linearResponse ? debevecLogResponseFloat(b) : evaluateDebevecResponseCurve(curves[2], b)) - logTime);
    weightSums[pixel] += weight;
  }
}

function finalizeCalibratedDebevecAccumulation(state) {
  const responseSums = state.calibratedResponseSums;
  const weightSums = state.calibratedWeightSums;
  const pixelCount = state.width * state.height;
  for (let pixel = 0, offset = 0; pixel < pixelCount; pixel += 1, offset += 3) {
    const weightSum = weightSums[pixel];
    for (let channel = 0; channel < 3; channel += 1) {
      const logRadiance = weightSum > 0 ? responseSums[offset + channel] / weightSum : 0;
      responseSums[offset + channel] = sanitizeHdrValue(Math.exp(logRadiance));
    }
  }
  return responseSums;
}

async function cleanupDebevecStreamState() {
  debevecStreamState = null;
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
  const saturationWeight = Number.isFinite(message.saturationWeight) ? Number(message.saturationWeight) : 0.1;
  const exposureWeight = Number.isFinite(message.exposureWeight) ? Number(message.exposureWeight) : 1;
  mertensStreamState = {
    width,
    height,
    imageCount,
    receivedCount: 0,
    brightnesses: new Float32Array(imageCount),
    receivedFlags: new Uint8Array(imageCount),
    saturationWeight,
    exposureWeight,
    weightSums: new Float32Array(width * height),
    cv: null,
    dimensions: null,
    fusedLevels: null,
    pass2ReceivedFlags: null,
    pass2ReceivedCount: 0,
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
  accumulateOpenCvMertensWeightSums(
    new Float32Array(imageBuffer),
    state.width,
    state.height,
    state.saturationWeight,
    state.exposureWeight,
    state.weightSums,
  );
  state.receivedFlags[imageIndex] = 1;
  state.brightnesses[imageIndex] = brightness;
  state.receivedCount += 1;
  self.postMessage({ type: "mertens-stream-image-stored", requestId: message.requestId, imageIndex });
}

async function beginMertensSecondPass(message) {
  const state = mertensStreamState;
  if (!state) throw new Error("HDR2 stream worker was not initialized.");
  if (state.receivedCount !== state.imageCount) {
    throw new Error(`HDR2 weight pass received ${state.receivedCount}/${state.imageCount} input images.`);
  }
  for (let i = 0; i < state.brightnesses.length; i += 1) {
    if (!(Number.isFinite(state.brightnesses[i]) && state.brightnesses[i] >= 0)) {
      throw new Error(`HDR2 input ${i + 1} has an invalid brightness value.`);
    }
  }
  postProgress("Loading OpenCV for HDR2 Mertens pyramid pass...");
  const cv = await loadWorkerOpenCv("HDR2");
  if (typeof cv.pyrDown !== "function" || typeof cv.pyrUp !== "function") {
    throw new Error("OpenCV.js does not provide pyrDown()/pyrUp() required for HDR2 Mertens fusion.");
  }
  state.cv = cv;
  state.dimensions = buildOpenCvMertensPyramidDimensions(state.width, state.height);
  state.fusedLevels = createMertensFusedLevels(state.dimensions);
  state.pass2ReceivedFlags = new Uint8Array(state.imageCount);
  state.pass2ReceivedCount = 0;
  self.postMessage({ type: "mertens-stream-pass2-ready", requestId: message.requestId });
}

async function appendMertensSecondPassImage(message) {
  const state = mertensStreamState;
  if (!state || !state.cv || !state.dimensions || !state.fusedLevels || !state.pass2ReceivedFlags) {
    throw new Error("HDR2 pyramid pass has not begun.");
  }
  const imageIndex = Number(message.imageIndex);
  if (!(Number.isInteger(imageIndex) && imageIndex >= 0 && imageIndex < state.imageCount)) {
    throw new Error("HDR2 pyramid pass received an invalid image index.");
  }
  if (state.pass2ReceivedFlags[imageIndex]) throw new Error(`HDR2 second-pass input ${imageIndex + 1} was sent more than once.`);
  // Preserve the former all-in-memory accumulation order exactly.
  if (imageIndex !== state.pass2ReceivedCount) {
    throw new Error(`HDR2 pyramid pass expected input ${state.pass2ReceivedCount + 1}, received ${imageIndex + 1}.`);
  }
  const imageBuffer = message.imageBuffer;
  const expectedByteLength = state.width * state.height * 3 * Float32Array.BYTES_PER_ELEMENT;
  if (!(imageBuffer instanceof ArrayBuffer) || imageBuffer.byteLength !== expectedByteLength) {
    throw new Error(`HDR2 second-pass input ${imageIndex + 1} has an invalid Float32 RGB buffer.`);
  }
  accumulateMertensImagePyramid(
    state.cv,
    new Float32Array(imageBuffer),
    state.imageCount,
    state.width,
    state.height,
    state.saturationWeight,
    state.exposureWeight,
    state.weightSums,
    state.dimensions,
    state.fusedLevels,
  );
  state.pass2ReceivedFlags[imageIndex] = 1;
  state.pass2ReceivedCount += 1;
  self.postMessage({ type: "mertens-stream-pass2-image-accepted", requestId: message.requestId, imageIndex });
}

async function finalizeMertensStream(message) {
  const state = mertensStreamState;
  if (!state) throw new Error("HDR2 stream worker was not initialized.");
  if (state.pass2ReceivedCount !== state.imageCount || !state.cv || !state.dimensions || !state.fusedLevels) {
    throw new Error(`HDR2 pyramid pass received ${state.pass2ReceivedCount}/${state.imageCount} input images.`);
  }
  const merged = reconstructMertensFusedLevels(state.cv, state.fusedLevels, state.dimensions, state.width, state.height);
  postProgress("Restoring HDR2 brightness...");
  adjustExposureToBrightnessInPlace(merged, meanArray(state.brightnesses));
  await cleanupMertensStreamState();
  self.postMessage({ type: "mertens-result", requestId: message.requestId, gamma2Buffer: merged.buffer }, [merged.buffer]);
}

async function cleanupMertensStreamState() {
  mertensStreamState = null;
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
    // Laplacian reconstruction can overshoot its nominal range. Preserve
    // positive highlight overshoot and clamp only negative values so inverse
    // gamma cannot generate NaNs.
    const value = encoded[i];
    output[i] = value > 0 ? Math.pow(value, MERTENS_PROCESSING_GAMMA) : 0;
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

function debevecPixelWeight(r, g, b) {
  return (
    debevecWeightFloat(r) +
    debevecWeightFloat(g) +
    debevecWeightFloat(b)
  ) / 3;
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
    let weightSum = 0;
    for (let imageIndex = 0; imageIndex < images.length; imageIndex += 1) {
      const image = images[imageIndex];
      const logTime = logTimes[imageIndex];
      const r = clamp01(image[offset]);
      const g = clamp01(image[offset + 1]);
      const b = clamp01(image[offset + 2]);
      const weight = debevecPixelWeight(r, g, b);
      sums[0] += weight * (debevecLogResponseFloat(r) - logTime);
      sums[1] += weight * (debevecLogResponseFloat(g) - logTime);
      sums[2] += weight * (debevecLogResponseFloat(b) - logTime);
      weightSum += weight;
    }
    for (let channel = 0; channel < 3; channel += 1) {
      result[offset + channel] = sanitizeHdrValue(Math.exp(
        weightSum > 0 ? sums[channel] / weightSum : 0,
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
  return PROPHOTO_XYZ_Y_R * r + PROPHOTO_XYZ_Y_G * g + PROPHOTO_XYZ_Y_B * b;
}

function toneLinearIntensity(r, g, b) {
  return TONE_INTENSITY_R * r + TONE_INTENSITY_G * g + TONE_INTENSITY_B * b;
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
    const toneIntensity = Math.max(0, toneLinearIntensity(r, g, b));
    let scale = 1;
    if (toneIntensity > 1e-12) {
      let targetToneIntensity = toneIntensity;
      if (factor > 1e-6) {
        const denominator = Math.log1p(factor);
        targetToneIntensity = Math.log1p(clamp01(toneIntensity) * factor) / denominator;
      } else if (factor < -1e-6) {
        const positiveFactor = -factor;
        const logFactor = Math.log1p(positiveFactor);
        targetToneIntensity = Math.expm1(clamp01(toneIntensity) * logFactor) / positiveFactor;
      }
      scale = targetToneIntensity / toneIntensity;
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
    sum += toneLinearIntensity(image[i], image[i + 1], image[i + 2]);
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
