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

self.onmessage = async (event) => {
  const message = event.data || {};

  try {
    if (message.type === "merge") {
      processDebevecMessage(message);
      return;
    }
    if (message.type === "mertens") {
      await processMertensMessage(message);
    }
  } catch (error) {
    self.postMessage({
      type: "error",
      message: error instanceof Error ? error.message : String(error),
    });
  }
};

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
  const preBrightnessSigmoidGain = Number.isFinite(message.preBrightnessSigmoidGain)
    ? Number(message.preBrightnessSigmoidGain)
    : 0;

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

  if (Math.abs(preBrightnessSigmoidGain) > 1e-6) {
    postProgress("Applying single-shot HDR1 sigmoid...");
    applySigmoidInPlace(hdr, preBrightnessSigmoidGain, 0.5);
  }

  postProgress("Restoring HDR brightness...");
  adjustExposureToBrightnessInPlace(hdr, targetBrightness);

  self.postMessage(
    { type: "result", linearProPhotoBuffer: hdr.buffer },
    [hdr.buffer],
  );
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
  const preBrightnessSigmoidGain = Number.isFinite(message.preBrightnessSigmoidGain)
    ? Number(message.preBrightnessSigmoidGain)
    : 0;

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

  if (Math.abs(preBrightnessSigmoidGain) > 1e-6) {
    postProgress("Applying single-shot HDR2 sigmoid...");
    applySigmoidInPlace(merged, preBrightnessSigmoidGain, 0.5);
  }

  postProgress("Restoring HDR2 brightness...");
  adjustExposureToBrightnessInPlace(merged, targetBrightness);

  // `gamma2Buffer` is retained as the transport field name for compatibility.
  // The buffer contents are linear ProPhoto RGB; no gamma-2 transform is applied here.
  self.postMessage(
    { type: "mertens-result", gamma2Buffer: merged.buffer },
    [merged.buffer],
  );
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
  const fusedLevels = dimensions.map(({ width: levelWidth, height: levelHeight }) =>
    new Float32Array(levelWidth * levelHeight * 3));

  for (let imageIndex = 0; imageIndex < images.length; imageIndex += 1) {
    const source = images[imageIndex];
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
        const weight = openCvMertensPixelWeightEncoded(
          r,
          g,
          b,
          saturationWeight,
          exposureWeight,
        );
        weightData[pixel] = denominator > 1e-20 ? weight / denominator : 1 / images.length;
      }

      // Release the original full-resolution source reference once this image's
      // OpenCV mats have been populated. Only one image pyramid is resident.
      images[imageIndex] = null;

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
    let sumR = 0;
    let sumG = 0;
    let sumB = 0;
    let weightSum = 0;

    for (let imageIndex = 0; imageIndex < images.length; imageIndex += 1) {
      const image = images[imageIndex];
      const r = clamp01(image[offset]);
      const g = clamp01(image[offset + 1]);
      const b = clamp01(image[offset + 2]);
      const weight = (debevecWeightFloat(r) + debevecWeightFloat(g) + debevecWeightFloat(b)) / 3;
      const logTime = logTimes[imageIndex];
      sumR += weight * (debevecLogResponseFloat(r) - logTime);
      sumG += weight * (debevecLogResponseFloat(g) - logTime);
      sumB += weight * (debevecLogResponseFloat(b) - logTime);
      weightSum += weight;
    }

    const inverseWeight = weightSum > 0 ? 1 / weightSum : 0;
    result[offset] = sanitizeHdrValue(Math.exp(sumR * inverseWeight));
    result[offset + 1] = sanitizeHdrValue(Math.exp(sumG * inverseWeight));
    result[offset + 2] = sanitizeHdrValue(Math.exp(sumB * inverseWeight));
  }

  return result;
}

function sanitizeHdrValue(value) {
  if (Number.isNaN(value) || value === -Infinity || value < 0) return 0;
  if (value === Infinity) return 1;
  return value;
}

function tonemapReinhardInPlace(image, gamma, intensity, lightAdapt, colorAdapt) {
  // Mirrors OpenCV TonemapReinhardImpl::process().
  normalizeRgbInPlace(image);

  const pixelCount = image.length / 3;
  let sumLog = 0;
  let logMin = Infinity;
  let logMax = -Infinity;
  let sumR = 0;
  let sumG = 0;
  let sumB = 0;
  let sumGray = 0;

  for (let i = 0; i < image.length; i += 3) {
    const r = image[i];
    const g = image[i + 1];
    const b = image[i + 2];
    const gray = 0.299 * r + 0.587 * g + 0.114 * b;
    const logGray = Math.log(Math.max(gray, 1e-4));
    sumLog += logGray;
    if (logGray < logMin) logMin = logGray;
    if (logGray > logMax) logMax = logGray;
    sumR += r;
    sumG += g;
    sumB += b;
    sumGray += gray;
  }

  const logMean = sumLog / pixelCount;
  const logRange = logMax - logMin;
  const key = logRange > Number.EPSILON ? (logMax - logMean) / logRange : 0.5;
  const mapKey = 0.3 + 0.7 * Math.pow(Math.max(0, key), 1.4);
  const intensityScale = Math.exp(-intensity);
  const channelMeanR = sumR / pixelCount;
  const channelMeanG = sumG / pixelCount;
  const channelMeanB = sumB / pixelCount;
  const grayMean = sumGray / pixelCount;

  for (let i = 0; i < image.length; i += 3) {
    const r = image[i];
    const g = image[i + 1];
    const b = image[i + 2];
    const gray = 0.299 * r + 0.587 * g + 0.114 * b;

    const localR = colorAdapt * r + (1 - colorAdapt) * gray;
    const localG = colorAdapt * g + (1 - colorAdapt) * gray;
    const localB = colorAdapt * b + (1 - colorAdapt) * gray;
    const globalR = colorAdapt * channelMeanR + (1 - colorAdapt) * grayMean;
    const globalG = colorAdapt * channelMeanG + (1 - colorAdapt) * grayMean;
    const globalB = colorAdapt * channelMeanB + (1 - colorAdapt) * grayMean;

    const adaptR = lightAdapt * localR + (1 - lightAdapt) * globalR;
    const adaptG = lightAdapt * localG + (1 - lightAdapt) * globalG;
    const adaptB = lightAdapt * localB + (1 - lightAdapt) * globalB;

    const mappedAdaptR = Math.pow(Math.max(0, intensityScale * adaptR), mapKey);
    const mappedAdaptG = Math.pow(Math.max(0, intensityScale * adaptG), mapKey);
    const mappedAdaptB = Math.pow(Math.max(0, intensityScale * adaptB), mapKey);

    image[i] = r / (mappedAdaptR + r);
    image[i + 1] = g / (mappedAdaptG + g);
    image[i + 2] = b / (mappedAdaptB + b);
  }

  normalizeRgbInPlace(image);
  if (gamma !== 1) {
    const exponent = 1 / gamma;
    for (let i = 0; i < image.length; i += 1) {
      image[i] = Math.pow(Math.max(0, image[i]), exponent);
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
  if (factor > 1e-6) {
    const denominator = Math.log1p(factor);
    for (let i = 0; i < image.length; i += 1) {
      output[i] = clamp01(Math.log1p(image[i] * factor) / denominator);
    }
    return output;
  }
  if (factor < -1e-6) {
    const positiveFactor = -factor;
    const logFactor = Math.log1p(positiveFactor);
    for (let i = 0; i < image.length; i += 1) {
      output[i] = clamp01(Math.expm1(image[i] * logFactor) / positiveFactor);
    }
    return output;
  }
  output.set(image);
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
  let minValue = Infinity;
  let maxValue = -Infinity;
  for (let i = 0; i < image.length; i += 1) {
    const value = image[i];
    if (!Number.isFinite(value)) continue;
    if (value < minValue) minValue = value;
    if (value > maxValue) maxValue = value;
  }

  if (!(Number.isFinite(minValue) && Number.isFinite(maxValue))) {
    throw new Error("HDR processing produced non-finite image values.");
  }
  const range = maxValue - minValue;
  if (!(range > Number.EPSILON)) return;

  const inverseRange = 1 / range;
  for (let i = 0; i < image.length; i += 1) {
    const value = image[i];
    image[i] = Number.isFinite(value) ? (value - minValue) * inverseRange : 0;
  }
}

function naiveSigmoid(x, gain, midpoint) {
  return 1 / (1 + Math.exp(-gain * (x - midpoint)));
}

function naiveInverseSigmoid(x, gain, midpoint) {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const minVal = naiveSigmoid(0, gain, midpoint);
  const maxVal = naiveSigmoid(1, gain, midpoint);
  const a = (maxVal - minVal) * x + minVal;
  return -Math.log(1 / a - 1) / gain;
}

function clampSigmoid(value) {
  if (!Number.isFinite(value)) return 0;
  if (value < -30) return -30;
  if (value > 30) return 30;
  return value;
}

function applySigmoidValue(value, gain, midpoint) {
  const x = clamp01(value);
  const g = clampSigmoid(gain);
  const mid = clamp01(midpoint);
  const gamma = 2.4;
  const encoded = Math.pow(x, 1 / gamma);
  if (g > 1e-6) {
    const minVal = naiveSigmoid(0, g, mid);
    const maxVal = naiveSigmoid(1, g, mid);
    const adjusted = clamp01((naiveSigmoid(encoded, g, mid) - minVal) / (maxVal - minVal));
    return clamp01(Math.pow(adjusted, gamma));
  }
  if (g < -1e-6) {
    const magnitude = -g;
    const minVal = naiveInverseSigmoid(0, magnitude, mid);
    const maxVal = naiveInverseSigmoid(1, magnitude, mid);
    const adjusted = clamp01((naiveInverseSigmoid(encoded, magnitude, mid) - minVal) / (maxVal - minVal));
    return clamp01(Math.pow(adjusted, gamma));
  }
  return x;
}

function applySigmoidInPlace(image, gain, midpoint) {
  for (let i = 0; i < image.length; i += 1) {
    image[i] = applySigmoidValue(image[i], gain, midpoint);
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
