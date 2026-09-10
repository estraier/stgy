// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-nocheck
// Local Stack Studio worker source. Built to public/generated/local-stack-studio.
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

  postProgress("Merging HDR2 with Mertens exposure fusion...");
  const merged = mergeMertensExposureFusion(
    images,
    width,
    height,
    saturationWeight,
    exposureWeight,
  );

  // Mertens/Laplacian reconstruction can overshoot its nominal LDR range.
  // HDR2 deliberately clips immediately after Mertens, before the stored
  // gamma-2 result buffer is created on the main thread.
  for (let i = 0; i < merged.length; i += 1) merged[i] = clamp01(merged[i]);

  if (Math.abs(preBrightnessSigmoidGain) > 1e-6) {
    postProgress("Applying single-shot HDR2 sigmoid...");
    applySigmoidInPlace(merged, preBrightnessSigmoidGain, 0.5);
  }

  postProgress("Restoring HDR2 brightness...");
  adjustExposureToBrightnessInPlace(merged, targetBrightness);

  self.postMessage(
    { type: "mertens-result", gamma2Buffer: merged.buffer },
    [merged.buffer],
  );
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

function mergeMertensExposureFusion(images, width, height, saturationWeight, exposureWeight) {
  const pixelCount = width * height;
  const weightSums = new Float32Array(pixelCount);

  // First pass: compute the full-resolution denominator for normalized Mertens
  // weights using only saturation and well-exposedness.
  for (let imageIndex = 0; imageIndex < images.length; imageIndex += 1) {
    postProgress(`Computing HDR2 Mertens weights ${imageIndex + 1}/${images.length}...`);
    accumulateMertensWeightSums(
      images[imageIndex],
      width,
      height,
      saturationWeight,
      exposureWeight,
      weightSums,
    );
  }

  const dimensions = buildPyramidDimensions(width, height);
  const fusedLevels = dimensions.map(({ width: levelWidth, height: levelHeight }) =>
    new Float32Array(levelWidth * levelHeight * 3));

  // Second pass: normalize each image's base weights, build the weight Gaussian
  // pyramid and image Laplacian pyramid incrementally, and accumulate each
  // weighted level. Only one image pyramid is resident at a time.
  for (let imageIndex = 0; imageIndex < images.length; imageIndex += 1) {
    postProgress(`Fusing HDR2 Mertens pyramid ${imageIndex + 1}/${images.length}...`);
    let currentWidth = width;
    let currentHeight = height;
    let currentRgb = images[imageIndex];
    let currentWeight = buildNormalizedMertensWeights(
      images[imageIndex],
      width,
      height,
      saturationWeight,
      exposureWeight,
      weightSums,
    );

    // This image is no longer needed in full-resolution form after the second-pass base
    // arrays have been constructed, so release the reference before building
    // the pyramid to keep peak memory down on large RAW files.
    images[imageIndex] = null;

    for (let level = 0; level < dimensions.length; level += 1) {
      const fused = fusedLevels[level];
      if (level === dimensions.length - 1) {
        accumulateWeightedRgb(fused, currentRgb, currentWeight);
        break;
      }

      const nextWidth = dimensions[level + 1].width;
      const nextHeight = dimensions[level + 1].height;
      const nextRgb = downsampleRgb2x2(currentRgb, currentWidth, currentHeight, nextWidth, nextHeight);
      const nextWeight = downsampleScalar2x2(currentWeight, currentWidth, currentHeight, nextWidth, nextHeight);
      accumulateWeightedLaplacian(
        fused,
        currentRgb,
        currentWeight,
        currentWidth,
        currentHeight,
        nextRgb,
        nextWidth,
        nextHeight,
      );
      currentRgb = nextRgb;
      currentWeight = nextWeight;
      currentWidth = nextWidth;
      currentHeight = nextHeight;
    }
  }

  postProgress("Reconstructing HDR2 Mertens pyramid...");
  let reconstructed = fusedLevels[fusedLevels.length - 1];
  for (let level = fusedLevels.length - 2; level >= 0; level -= 1) {
    const { width: levelWidth, height: levelHeight } = dimensions[level];
    const { width: sourceWidth, height: sourceHeight } = dimensions[level + 1];
    const expanded = upsampleRgbBilinear(
      reconstructed,
      sourceWidth,
      sourceHeight,
      levelWidth,
      levelHeight,
    );
    const laplacian = fusedLevels[level];
    for (let i = 0; i < expanded.length; i += 1) expanded[i] += laplacian[i];
    reconstructed = expanded;
  }
  return reconstructed;
}

function buildPyramidDimensions(width, height) {
  const dimensions = [];
  let currentWidth = width;
  let currentHeight = height;
  while (true) {
    dimensions.push({ width: currentWidth, height: currentHeight });
    if (currentWidth === 1 && currentHeight === 1) break;
    currentWidth = Math.max(1, Math.ceil(currentWidth / 2));
    currentHeight = Math.max(1, Math.ceil(currentHeight / 2));
  }
  return dimensions;
}

function accumulateMertensWeightSums(
  image,
  width,
  height,
  saturationWeight,
  exposureWeight,
  sums,
) {
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const pixel = y * width + x;
      sums[pixel] += mertensPixelWeight(
        image,
        width,
        height,
        x,
        y,
        saturationWeight,
        exposureWeight,
      );
    }
  }
}

function buildNormalizedMertensWeights(
  image,
  width,
  height,
  saturationWeight,
  exposureWeight,
  sums,
) {
  const weights = new Float32Array(width * height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const pixel = y * width + x;
      const weight = mertensPixelWeight(
        image,
        width,
        height,
        x,
        y,
        saturationWeight,
        exposureWeight,
      );
      const denominator = sums[pixel];
      weights[pixel] = denominator > 1e-20 ? weight / denominator : 1;
    }
  }
  return weights;
}

function mertensPixelWeight(image, width, height, x, y, saturationWeight, exposureWeight) {
  const offset = (y * width + x) * 3;
  const r = clamp01(image[offset]);
  const g = clamp01(image[offset + 1]);
  const b = clamp01(image[offset + 2]);
  let weight = 1;

  if (saturationWeight !== 0) {
    const mean = (r + g + b) / 3;
    const saturation = Math.sqrt(
      ((r - mean) * (r - mean) + (g - mean) * (g - mean) + (b - mean) * (b - mean)) / 3,
    );
    weight *= Math.pow(Math.max(saturation, 1e-12), saturationWeight);
  }

  if (exposureWeight !== 0) {
    // Mertens well-exposedness: a Gaussian centered at 0.5 with sigma=0.2,
    // multiplied across RGB channels.
    const sigma = 0.2;
    const denominator = 2 * sigma * sigma;
    const exposedness =
      Math.exp(-((r - 0.5) * (r - 0.5)) / denominator) *
      Math.exp(-((g - 0.5) * (g - 0.5)) / denominator) *
      Math.exp(-((b - 0.5) * (b - 0.5)) / denominator);
    weight *= Math.pow(Math.max(exposedness, 1e-12), exposureWeight);
  }

  return weight + 1e-12;
}

function downsampleScalar2x2(source, width, height, targetWidth, targetHeight) {
  const target = new Float32Array(targetWidth * targetHeight);
  for (let ty = 0; ty < targetHeight; ty += 1) {
    const sy0 = Math.min(height - 1, ty * 2);
    const sy1 = Math.min(height - 1, sy0 + 1);
    for (let tx = 0; tx < targetWidth; tx += 1) {
      const sx0 = Math.min(width - 1, tx * 2);
      const sx1 = Math.min(width - 1, sx0 + 1);
      const a = source[sy0 * width + sx0];
      const b = source[sy0 * width + sx1];
      const c = source[sy1 * width + sx0];
      const d = source[sy1 * width + sx1];
      target[ty * targetWidth + tx] = (a + b + c + d) * 0.25;
    }
  }
  return target;
}

function downsampleRgb2x2(source, width, height, targetWidth, targetHeight) {
  const target = new Float32Array(targetWidth * targetHeight * 3);
  for (let ty = 0; ty < targetHeight; ty += 1) {
    const sy0 = Math.min(height - 1, ty * 2);
    const sy1 = Math.min(height - 1, sy0 + 1);
    for (let tx = 0; tx < targetWidth; tx += 1) {
      const sx0 = Math.min(width - 1, tx * 2);
      const sx1 = Math.min(width - 1, sx0 + 1);
      const o00 = (sy0 * width + sx0) * 3;
      const o01 = (sy0 * width + sx1) * 3;
      const o10 = (sy1 * width + sx0) * 3;
      const o11 = (sy1 * width + sx1) * 3;
      const targetOffset = (ty * targetWidth + tx) * 3;
      target[targetOffset] = (source[o00] + source[o01] + source[o10] + source[o11]) * 0.25;
      target[targetOffset + 1] = (source[o00 + 1] + source[o01 + 1] + source[o10 + 1] + source[o11 + 1]) * 0.25;
      target[targetOffset + 2] = (source[o00 + 2] + source[o01 + 2] + source[o10 + 2] + source[o11 + 2]) * 0.25;
    }
  }
  return target;
}

function accumulateWeightedRgb(target, source, weights) {
  for (let pixel = 0, offset = 0; pixel < weights.length; pixel += 1, offset += 3) {
    const weight = weights[pixel];
    target[offset] += source[offset] * weight;
    target[offset + 1] += source[offset + 1] * weight;
    target[offset + 2] += source[offset + 2] * weight;
  }
}

function accumulateWeightedLaplacian(
  target,
  source,
  weights,
  width,
  height,
  coarse,
  coarseWidth,
  coarseHeight,
) {
  for (let y = 0; y < height; y += 1) {
    const fy = coarseHeight === 1 || height === 1 ? 0 : y * (coarseHeight - 1) / (height - 1);
    const y0 = Math.floor(fy);
    const y1 = Math.min(coarseHeight - 1, y0 + 1);
    const wy = fy - y0;
    for (let x = 0; x < width; x += 1) {
      const fx = coarseWidth === 1 || width === 1 ? 0 : x * (coarseWidth - 1) / (width - 1);
      const x0 = Math.floor(fx);
      const x1 = Math.min(coarseWidth - 1, x0 + 1);
      const wx = fx - x0;
      const w00 = (1 - wx) * (1 - wy);
      const w01 = wx * (1 - wy);
      const w10 = (1 - wx) * wy;
      const w11 = wx * wy;
      const c00 = (y0 * coarseWidth + x0) * 3;
      const c01 = (y0 * coarseWidth + x1) * 3;
      const c10 = (y1 * coarseWidth + x0) * 3;
      const c11 = (y1 * coarseWidth + x1) * 3;
      const pixel = y * width + x;
      const offset = pixel * 3;
      const weight = weights[pixel];
      for (let channel = 0; channel < 3; channel += 1) {
        const expanded =
          coarse[c00 + channel] * w00 +
          coarse[c01 + channel] * w01 +
          coarse[c10 + channel] * w10 +
          coarse[c11 + channel] * w11;
        target[offset + channel] += (source[offset + channel] - expanded) * weight;
      }
    }
  }
}

function upsampleRgbBilinear(source, width, height, targetWidth, targetHeight) {
  const target = new Float32Array(targetWidth * targetHeight * 3);
  for (let y = 0; y < targetHeight; y += 1) {
    const fy = height === 1 || targetHeight === 1 ? 0 : y * (height - 1) / (targetHeight - 1);
    const y0 = Math.floor(fy);
    const y1 = Math.min(height - 1, y0 + 1);
    const wy = fy - y0;
    for (let x = 0; x < targetWidth; x += 1) {
      const fx = width === 1 || targetWidth === 1 ? 0 : x * (width - 1) / (targetWidth - 1);
      const x0 = Math.floor(fx);
      const x1 = Math.min(width - 1, x0 + 1);
      const wx = fx - x0;
      const w00 = (1 - wx) * (1 - wy);
      const w01 = wx * (1 - wy);
      const w10 = (1 - wx) * wy;
      const w11 = wx * wy;
      const o00 = (y0 * width + x0) * 3;
      const o01 = (y0 * width + x1) * 3;
      const o10 = (y1 * width + x0) * 3;
      const o11 = (y1 * width + x1) * 3;
      const targetOffset = (y * targetWidth + x) * 3;
      for (let channel = 0; channel < 3; channel += 1) {
        target[targetOffset + channel] =
          source[o00 + channel] * w00 +
          source[o01 + channel] * w01 +
          source[o10 + channel] * w10 +
          source[o11 + channel] * w11;
      }
    }
  }
  return target;
}
