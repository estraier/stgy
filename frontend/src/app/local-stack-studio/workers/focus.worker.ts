// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-nocheck
// Local Stack Studio worker source. Built to public/generated/local-stack-studio.
import { loadWorkerOpenCv } from "./opencv-runtime";

(() => {
  "use strict";

  const RESULT_BUFFER_MAX_UINT16 = 65535;
  const SHARPNESS_BASE_AREA = 1000000;
  const SHARPNESS_BLUR_RADIUS = 2;
  const SHARPNESS_CLAHE_CLIP_LIMIT = 0.3;
  const SHARPNESS_CLAHE_GAMMA = 2.8;
  const SHARPNESS_HIGH_LOW_BALANCE = 0.5;
  const SHARPNESS_SUPPRESS_NOISE = 0.5;

  let cvPromise = null;

  self.onmessage = async (event) => {
    const message = event.data || {};
    const requestId = message.requestId;
    try {
      if (message.type === "sharpness") {
        const cv = await getOpenCv();
        postProgress(requestId, message.progressMessage || "Computing focus sharpness map...");
        const sharpness = computeSharpnessMap(
          cv,
          new Uint16Array(message.gamma2Buffer),
          Number(message.width),
          Number(message.height),
        );
        self.postMessage(
          { type: "sharpness-result", requestId, sharpnessBuffer: sharpness.buffer },
          [sharpness.buffer],
        );
        return;
      }

      if (message.type === "tau-stats") {
        const sharpnessTiles = (message.sharpnessBuffers || []).map((buffer) => new Float32Array(buffer));
        const stats = computeTauStats(sharpnessTiles);
        self.postMessage({ type: "tau-stats-result", requestId, ...stats });
        return;
      }

      if (message.type === "merge-tile") {
        const cv = await getOpenCv();
        const rgbTiles = (message.rgbBuffers || []).map((buffer) => new Uint16Array(buffer));
        const sharpnessTiles = (message.sharpnessBuffers || []).map((buffer) => new Float32Array(buffer));
        const merged = mergeFocusTile(
          cv,
          rgbTiles,
          sharpnessTiles,
          Number(message.width),
          Number(message.height),
          Number(message.tau),
          Number(message.pyramidLevels),
        );
        self.postMessage(
          { type: "merge-tile-result", requestId, gamma2Buffer: merged.buffer },
          [merged.buffer],
        );
      }
    } catch (error) {
      self.postMessage({
        type: "error",
        requestId,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  };

  function postProgress(requestId, message) {
    self.postMessage({ type: "progress", requestId, message });
  }

  async function getOpenCv() {
    if (!cvPromise) cvPromise = loadWorkerOpenCv("Focus").then((cv) => { assertFocusApis(cv); return cv; });
    return cvPromise;
  }

  function assertFocusApis(cv) {
    const missing = [];
    if (!cv.createCLAHE && !cv.CLAHE) missing.push("CLAHE");
    if (!cv.GaussianBlur) missing.push("GaussianBlur");
    if (!cv.Laplacian) missing.push("Laplacian");
    if (!cv.Sobel) missing.push("Sobel");
    if (!cv.resize) missing.push("resize");
    if (!cv.pyrDown) missing.push("pyrDown");
    if (!cv.pyrUp) missing.push("pyrUp");
    if (cv.CV_8UC1 === undefined) missing.push("CV_8UC1");
    if (cv.CV_32FC1 === undefined) missing.push("CV_32FC1");
    if (cv.CV_32FC3 === undefined) missing.push("CV_32FC3");
    if (missing.length > 0) {
      throw new Error(`This OpenCV.js build is missing Focus APIs: ${missing.join(", ")}`);
    }
  }

  function computeSharpnessMap(cv, gamma2Rgb, width, height) {
    const expectedLength = width * height * 3;
    if (!(Number.isInteger(width) && width > 0 && Number.isInteger(height) && height > 0)) {
      throw new Error("Focus sharpness received invalid image dimensions.");
    }
    if (gamma2Rgb.length !== expectedLength) {
      throw new Error("Focus sharpness received an invalid gamma-2 RGB buffer.");
    }

    let gray = new cv.Mat(height, width, cv.CV_32FC1);
    for (let pixel = 0, source = 0; pixel < width * height; pixel += 1, source += 3) {
      const r = gamma2Uint16ToLinear(gamma2Rgb[source]);
      const g = gamma2Uint16ToLinear(gamma2Rgb[source + 1]);
      const b = gamma2Uint16ToLinear(gamma2Rgb[source + 2]);
      gray.data32F[pixel] = 0.299 * r + 0.587 * g + 0.114 * b;
    }

    let working = null;
    let blurred = null;
    let laplacian = null;
    let sobelX = null;
    let sobelY = null;
    let sharpSmallMat = null;
    let sharpFullMat = null;
    try {
      const claheGray = applyClaheGrayImage(cv, gray, SHARPNESS_CLAHE_CLIP_LIMIT, SHARPNESS_CLAHE_GAMMA);
      gray.delete();
      gray = claheGray;

      const area = width * height;
      let workingWidth = width;
      let workingHeight = height;
      const isScaled = area > SHARPNESS_BASE_AREA * 2;
      if (isScaled) {
        const scale = Math.sqrt(SHARPNESS_BASE_AREA / area);
        workingWidth = Math.ceil(width * scale);
        workingHeight = Math.ceil(height * scale);
        working = new cv.Mat();
        cv.resize(gray, working, new cv.Size(workingWidth, workingHeight), 0, 0, cv.INTER_AREA);
      } else {
        working = gray.clone();
      }

      if (SHARPNESS_BLUR_RADIUS > 1) {
        const ksize = Math.ceil(2 * SHARPNESS_BLUR_RADIUS) + 1;
        blurred = new cv.Mat();
        cv.GaussianBlur(working, blurred, new cv.Size(ksize, ksize), 0, 0, cv.BORDER_DEFAULT);
      } else {
        blurred = working.clone();
      }

      laplacian = new cv.Mat();
      cv.Laplacian(blurred, laplacian, cv.CV_32F ?? cv.CV_32FC1, 3);
      const absLap = new Float32Array(laplacian.data32F.length);
      let lapMean = 0;
      for (let i = 0; i < absLap.length; i += 1) {
        const value = Math.abs(laplacian.data32F[i]);
        absLap[i] = value;
        lapMean += value;
      }
      lapMean = absLap.length > 0 ? lapMean / absLap.length : 0;
      if (SHARPNESS_SUPPRESS_NOISE > 0) {
        const noiseFloor = Math.min(
          estimateWhiteNoiseLevelFromLaplacian(absLap, workingWidth, workingHeight),
          lapMean * 0.5,
        );
        const subtract = SHARPNESS_SUPPRESS_NOISE * noiseFloor;
        for (let i = 0; i < absLap.length; i += 1) {
          absLap[i] = Math.max(0, absLap[i] - subtract);
        }
      }
      zScoreInPlace(absLap);

      sobelX = new cv.Mat();
      sobelY = new cv.Mat();
      cv.Sobel(blurred, sobelX, cv.CV_32F ?? cv.CV_32FC1, 1, 0, 3);
      cv.Sobel(blurred, sobelY, cv.CV_32F ?? cv.CV_32FC1, 0, 1, 3);
      const sobel = new Float32Array(sobelX.data32F.length);
      for (let i = 0; i < sobel.length; i += 1) {
        sobel[i] = Math.hypot(sobelX.data32F[i], sobelY.data32F[i]);
      }
      zScoreInPlace(sobel);

      const sharpSmall = new Float32Array(absLap.length);
      for (let i = 0; i < sharpSmall.length; i += 1) {
        sharpSmall[i] = SHARPNESS_HIGH_LOW_BALANCE * absLap[i] +
          (1 - SHARPNESS_HIGH_LOW_BALANCE) * sobel[i];
      }

      let sharpness;
      if (isScaled) {
        sharpSmallMat = new cv.Mat(workingHeight, workingWidth, cv.CV_32FC1);
        sharpSmallMat.data32F.set(sharpSmall);
        sharpFullMat = new cv.Mat();
        cv.resize(sharpSmallMat, sharpFullMat, new cv.Size(width, height), 0, 0, cv.INTER_LANCZOS4);
        sharpness = new Float32Array(sharpFullMat.data32F);
      } else {
        sharpness = sharpSmall;
      }

      zScoreInPlace(sharpness);
      for (let i = 0; i < sharpness.length; i += 1) {
        sharpness[i] = Math.max(-10, Math.min(10, sharpness[i]));
      }
      return sharpness;
    } finally {
      if (sharpFullMat) sharpFullMat.delete();
      if (sharpSmallMat) sharpSmallMat.delete();
      if (sobelY) sobelY.delete();
      if (sobelX) sobelX.delete();
      if (laplacian) laplacian.delete();
      if (blurred) blurred.delete();
      if (working) working.delete();
      if (gray) gray.delete();
    }
  }

  function applyClaheGrayImage(cv, gray, clipLimit, gamma) {
    const pixelCount = gray.rows * gray.cols;
    const bytes = new Uint8Array(pixelCount);
    const floatRatio = new Float32Array(pixelCount);
    const image255 = new Float32Array(pixelCount);
    for (let i = 0; i < pixelCount; i += 1) {
      const value255 = Math.pow(clamp01(gray.data32F[i]), 1 / gamma) * 255;
      image255[i] = value255;
      const byteValue = Math.max(0, Math.min(255, Math.trunc(value255)));
      bytes[i] = byteValue;
      floatRatio[i] = byteValue > 0 ? byteValue / Math.max(value255, 1e-6) : 1;
    }

    const src = new cv.Mat(gray.rows, gray.cols, cv.CV_8UC1);
    const dst = new cv.Mat();
    src.data.set(bytes);
    const tileGridSize = new cv.Size(8, 8);
    const clahe = cv.createCLAHE
      ? cv.createCLAHE(clipLimit, tileGridSize)
      : new cv.CLAHE(clipLimit, tileGridSize);
    try {
      clahe.apply(src, dst);
      const restored = new cv.Mat(gray.rows, gray.cols, cv.CV_32FC1);
      for (let i = 0; i < pixelCount; i += 1) {
        const converted = dst.data[i];
        let restored255 = converted / Math.max(floatRatio[i], 0.5);
        if (converted === 0) restored255 = Math.min(image255[i] * 0.9, 0.9);
        restored.data32F[i] = clamp01(Math.pow(Math.max(0, restored255) / 255, gamma));
      }
      return restored;
    } finally {
      if (clahe && typeof clahe.delete === "function") clahe.delete();
      src.delete();
      dst.delete();
    }
  }

  function estimateWhiteNoiseLevelFromLaplacian(absLap, width, height, numTiles = 400, percentile = 10) {
    const area = width * height;
    const tileUnit = Math.max(Math.round(Math.sqrt(area) / Math.sqrt(numTiles)), 1);
    const tileSizeMax = Math.trunc(tileUnit * 1.5);
    const means = [];
    let x = 0;
    while (x < width) {
      let tileWidth = tileUnit;
      if (x + tileSizeMax >= width) tileWidth = width - x;
      let y = 0;
      while (y < height) {
        let tileHeight = tileUnit;
        if (y + tileSizeMax >= height) tileHeight = height - y;
        let sum = 0;
        let count = 0;
        for (let localY = 0; localY < tileHeight; localY += 1) {
          const rowStart = (y + localY) * width + x;
          for (let localX = 0; localX < tileWidth; localX += 1) {
            sum += absLap[rowStart + localX];
            count += 1;
          }
        }
        if (count > 0) means.push(sum / count);
        y += tileHeight;
      }
      x += tileWidth;
    }
    if (means.length === 0) return 0;
    means.sort((a, b) => a - b);
    const k = Math.max(1, Math.trunc(means.length * percentile / 100));
    let sum = 0;
    for (let i = 0; i < k; i += 1) sum += means[i];
    return sum / k;
  }

  function zScoreInPlace(values) {
    if (values.length === 0) return;
    let sum = 0;
    for (let i = 0; i < values.length; i += 1) sum += values[i];
    const mean = sum / values.length;
    let varianceSum = 0;
    for (let i = 0; i < values.length; i += 1) {
      const delta = values[i] - mean;
      varianceSum += delta * delta;
    }
    const std = Math.sqrt(varianceSum / values.length);
    const divisor = std + 1e-6;
    for (let i = 0; i < values.length; i += 1) values[i] = (values[i] - mean) / divisor;
  }

  function computeTauStats(sharpnessTiles) {
    validateSharpnessTiles(sharpnessTiles);
    const pixelCount = sharpnessTiles[0].length;
    let sum = 0;
    let sumSq = 0;
    let count = 0;
    for (let pixel = 0; pixel < pixelCount; pixel += 1) {
      let maxValue = -Infinity;
      for (let imageIndex = 0; imageIndex < sharpnessTiles.length; imageIndex += 1) {
        const value = sharpnessTiles[imageIndex][pixel];
        if (value > maxValue) maxValue = value;
      }
      for (let imageIndex = 0; imageIndex < sharpnessTiles.length; imageIndex += 1) {
        const adjusted = sharpnessTiles[imageIndex][pixel] - maxValue;
        sum += adjusted;
        sumSq += adjusted * adjusted;
        count += 1;
      }
    }
    return { sum, sumSq, count };
  }

  function mergeFocusTile(cv, rgbTiles, sharpnessTiles, width, height, tau, requestedLevels) {
    if (!(Number.isInteger(width) && width > 0 && Number.isInteger(height) && height > 0)) {
      throw new Error("Focus merge received invalid tile dimensions.");
    }
    if (!(Number.isFinite(tau) && tau > 0)) throw new Error("Focus merge received an invalid softmax tau.");
    if (!Array.isArray(rgbTiles) || rgbTiles.length === 0 || rgbTiles.length !== sharpnessTiles.length) {
      throw new Error("Focus merge tile inputs are incomplete.");
    }
    const pixelCount = width * height;
    const rgbLength = pixelCount * 3;
    for (let i = 0; i < rgbTiles.length; i += 1) {
      if (!(rgbTiles[i] instanceof Uint16Array) || rgbTiles[i].length !== rgbLength) {
        throw new Error(`Focus RGB tile ${i + 1} has an invalid size.`);
      }
    }
    validateSharpnessTiles(sharpnessTiles, pixelCount);

    const maxValues = new Float32Array(pixelCount);
    const denominators = new Float32Array(pixelCount);
    maxValues.fill(-Infinity);
    for (let imageIndex = 0; imageIndex < sharpnessTiles.length; imageIndex += 1) {
      const sharpness = sharpnessTiles[imageIndex];
      for (let pixel = 0; pixel < pixelCount; pixel += 1) {
        if (sharpness[pixel] > maxValues[pixel]) maxValues[pixel] = sharpness[pixel];
      }
    }
    for (let imageIndex = 0; imageIndex < sharpnessTiles.length; imageIndex += 1) {
      const sharpness = sharpnessTiles[imageIndex];
      for (let pixel = 0; pixel < pixelCount; pixel += 1) {
        denominators[pixel] += Math.exp((sharpness[pixel] - maxValues[pixel]) / tau);
      }
    }

    const maxLevels = Math.max(0, Math.floor(Math.log2(Math.min(width, height))) - 3);
    const pyramidLevels = Math.max(0, Math.min(Math.trunc(requestedLevels), maxLevels));
    let mergedLinear;
    if (pyramidLevels <= 1 || Math.min(width, height) < 256) {
      mergedLinear = mergeFocusDirect(rgbTiles, sharpnessTiles, maxValues, denominators, tau, pixelCount);
    } else {
      mergedLinear = mergeFocusPyramids(
        cv,
        rgbTiles,
        sharpnessTiles,
        maxValues,
        denominators,
        tau,
        width,
        height,
        pyramidLevels,
      );
    }
    return encodeLinearToGamma2Uint16(mergedLinear);
  }

  function mergeFocusDirect(rgbTiles, sharpnessTiles, maxValues, denominators, tau, pixelCount) {
    const output = new Float32Array(pixelCount * 3);
    for (let imageIndex = 0; imageIndex < rgbTiles.length; imageIndex += 1) {
      const rgb = rgbTiles[imageIndex];
      const sharpness = sharpnessTiles[imageIndex];
      for (let pixel = 0; pixel < pixelCount; pixel += 1) {
        const weight = Math.exp((sharpness[pixel] - maxValues[pixel]) / tau) /
          Math.max(denominators[pixel], 1e-8);
        const offset = pixel * 3;
        output[offset] += gamma2Uint16ToLinear(rgb[offset]) * weight;
        output[offset + 1] += gamma2Uint16ToLinear(rgb[offset + 1]) * weight;
        output[offset + 2] += gamma2Uint16ToLinear(rgb[offset + 2]) * weight;
      }
    }
    return output;
  }

  function mergeFocusPyramids(
    cv,
    rgbTiles,
    sharpnessTiles,
    maxValues,
    denominators,
    tau,
    width,
    height,
    pyramidLevels,
  ) {
    const dimensions = [{ width, height }];
    for (let level = 0; level < pyramidLevels; level += 1) {
      const previous = dimensions[dimensions.length - 1];
      dimensions.push({
        width: Math.ceil(previous.width / 2),
        height: Math.ceil(previous.height / 2),
      });
    }
    const fused = dimensions.map(({ width: w, height: h }) => new Float32Array(w * h * 3));
    const pixelCount = width * height;

    for (let imageIndex = 0; imageIndex < rgbTiles.length; imageIndex += 1) {
      let currentRgb = new cv.Mat(height, width, cv.CV_32FC3);
      let currentWeight = new cv.Mat(height, width, cv.CV_32FC1);
      const rgb = rgbTiles[imageIndex];
      const sharpness = sharpnessTiles[imageIndex];
      for (let pixel = 0; pixel < pixelCount; pixel += 1) {
        const offset = pixel * 3;
        currentRgb.data32F[offset] = gamma2Uint16ToLinear(rgb[offset]);
        currentRgb.data32F[offset + 1] = gamma2Uint16ToLinear(rgb[offset + 1]);
        currentRgb.data32F[offset + 2] = gamma2Uint16ToLinear(rgb[offset + 2]);
        currentWeight.data32F[pixel] = Math.exp((sharpness[pixel] - maxValues[pixel]) / tau) /
          Math.max(denominators[pixel], 1e-8);
      }

      try {
        for (let level = 0; level < pyramidLevels; level += 1) {
          const nextDim = dimensions[level + 1];
          const nextRgb = new cv.Mat();
          const nextWeight = new cv.Mat();
          const upRgb = new cv.Mat();
          try {
            cv.pyrDown(currentRgb, nextRgb, new cv.Size(nextDim.width, nextDim.height));
            cv.pyrDown(currentWeight, nextWeight, new cv.Size(nextDim.width, nextDim.height));
            cv.pyrUp(nextRgb, upRgb, new cv.Size(currentRgb.cols, currentRgb.rows));

            const rgbData = currentRgb.data32F;
            const upData = upRgb.data32F;
            const weightData = currentWeight.data32F;
            const target = fused[level];
            for (let pixel = 0; pixel < weightData.length; pixel += 1) {
              const weight = weightData[pixel];
              const offset = pixel * 3;
              target[offset] += (rgbData[offset] - upData[offset]) * weight;
              target[offset + 1] += (rgbData[offset + 1] - upData[offset + 1]) * weight;
              target[offset + 2] += (rgbData[offset + 2] - upData[offset + 2]) * weight;
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

        const lowestTarget = fused[pyramidLevels];
        const lowestRgb = currentRgb.data32F;
        const lowestWeight = currentWeight.data32F;
        for (let pixel = 0; pixel < lowestWeight.length; pixel += 1) {
          const weight = lowestWeight[pixel];
          const offset = pixel * 3;
          lowestTarget[offset] += lowestRgb[offset] * weight;
          lowestTarget[offset + 1] += lowestRgb[offset + 1] * weight;
          lowestTarget[offset + 2] += lowestRgb[offset + 2] * weight;
        }
      } finally {
        if (currentRgb) currentRgb.delete();
        if (currentWeight) currentWeight.delete();
      }
    }

    let reconstructed = fused[pyramidLevels];
    for (let level = pyramidLevels - 1; level >= 0; level -= 1) {
      const sourceDim = dimensions[level + 1];
      const targetDim = dimensions[level];
      const sourceMat = new cv.Mat(sourceDim.height, sourceDim.width, cv.CV_32FC3);
      const up = new cv.Mat();
      sourceMat.data32F.set(reconstructed);
      try {
        cv.pyrUp(sourceMat, up, new cv.Size(targetDim.width, targetDim.height));
        const next = fused[level];
        const upData = up.data32F;
        for (let i = 0; i < next.length; i += 1) next[i] += upData[i];
        reconstructed = next;
      } finally {
        sourceMat.delete();
        up.delete();
      }
    }
    return reconstructed;
  }

  function validateSharpnessTiles(tiles, expectedLength = null) {
    if (!Array.isArray(tiles) || tiles.length === 0) throw new Error("Focus sharpness tile set is empty.");
    const length = expectedLength ?? tiles[0].length;
    for (let i = 0; i < tiles.length; i += 1) {
      if (!(tiles[i] instanceof Float32Array) || tiles[i].length !== length) {
        throw new Error(`Focus sharpness tile ${i + 1} has an invalid size.`);
      }
    }
  }

  function encodeLinearToGamma2Uint16(linear) {
    const output = new Uint16Array(linear.length);
    for (let i = 0; i < linear.length; i += 1) {
      output[i] = Math.round(Math.sqrt(clamp01(linear[i])) * RESULT_BUFFER_MAX_UINT16);
    }
    return output;
  }

  function gamma2Uint16ToLinear(value) {
    const encoded = value / RESULT_BUFFER_MAX_UINT16;
    return encoded * encoded;
  }

  function clamp01(value) {
    if (!Number.isFinite(value) || value <= 0) return 0;
    if (value >= 1) return 1;
    return value;
  }
})();
