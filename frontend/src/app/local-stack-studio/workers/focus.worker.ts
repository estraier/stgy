// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-nocheck
// Local Stack Studio worker source. Built to public/generated/local-stack-studio.
import { loadWorkerOpenCv } from "./opencv-runtime";
import {
  focusSharpnessWorkingDimensions,
  isUsableFocusStd,
} from "../stack/focus-math";

(() => {
  "use strict";

  const RESULT_BUFFER_MAX_UINT16 = 65535;
  const SHARPNESS_BLUR_RADIUS = 2;
  const SHARPNESS_CLAHE_CLIP_LIMIT = 0.3;
  const SHARPNESS_CLAHE_GAMMA = 2.8;
  const SHARPNESS_HIGH_LOW_BALANCE = 0.5;
  const SHARPNESS_SUPPRESS_NOISE = 0.5;

  let cvPromise = null;
  let workingSharpnessState = null;
  let focusCoreState = null;

  self.onmessage = async (event) => {
    const message = event.data || {};
    const requestId = message.requestId;
    try {
      if (message.type === "sharpness-features") {
        const cv = await getOpenCv();
        postProgress(requestId, message.progressMessage || "Computing focus sharpness features...");
        const result = computeSharpnessFeatures(
          cv,
          new Uint16Array(message.gamma2Buffer),
          Number(message.width),
          Number(message.height),
        );
        self.postMessage(
          {
            type: "sharpness-features-result",
            requestId,
            featureBuffer: result.features.buffer,
            workingWidth: result.workingWidth,
            workingHeight: result.workingHeight,
            lapCount: result.lapStats.count,
            lapMean: result.lapStats.mean,
            lapM2: result.lapStats.m2,
            sobelCount: result.sobelStats.count,
            sobelMean: result.sobelStats.mean,
            sobelM2: result.sobelStats.m2,
          },
          [result.features.buffer],
        );
        return;
      }

      if (message.type === "sharpness-compose") {
        postProgress(requestId, message.progressMessage || "Composing focus sharpness map...");
        const sharpness = composeSharpnessMap(
          new Float32Array(message.featureBuffer),
          Number(message.workingWidth),
          Number(message.workingHeight),
          Number(message.width),
          Number(message.height),
          Number(message.globalLapMean),
          Number(message.globalLapStd),
          Number(message.globalSobelMean),
          Number(message.globalSobelStd),
        );
        self.postMessage(
          { type: "sharpness-compose-result", requestId, sharpnessBuffer: sharpness.buffer },
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

      if (message.type === "working-sharpness-init") {
        const sharpnessMaps = (message.sharpnessBuffers || []).map((buffer) => new Float32Array(buffer));
        const workingWidth = Number(message.workingWidth);
        const workingHeight = Number(message.workingHeight);
        const imageWidth = Number(message.imageWidth);
        const imageHeight = Number(message.imageHeight);
        const expectedWorking = focusSharpnessWorkingDimensions(imageWidth, imageHeight);
        if (
          workingWidth !== expectedWorking.width ||
          workingHeight !== expectedWorking.height ||
          sharpnessMaps.length === 0 ||
          sharpnessMaps.some((map) => map.length !== workingWidth * workingHeight)
        ) {
          throw new Error("Focus worker received invalid cached working sharpness maps.");
        }
        workingSharpnessState = {
          sharpnessMaps,
          workingWidth,
          workingHeight,
          imageWidth,
          imageHeight,
        };
        focusCoreState = null;
        self.postMessage({ type: "working-sharpness-init-result", requestId });
        return;
      }

      if (message.type === "focus-core-begin") {
        await getOpenCv();
        if (!workingSharpnessState) {
          throw new Error("Focus worker working sharpness cache is not initialized.");
        }
        if (focusCoreState) {
          throw new Error("Focus worker already has an active core.");
        }
        focusCoreState = beginFocusCore(
          workingSharpnessState,
          Number(message.regionX),
          Number(message.regionY),
          Number(message.regionWidth),
          Number(message.regionHeight),
          Number(message.coreOffsetX),
          Number(message.coreOffsetY),
          Number(message.coreWidth),
          Number(message.coreHeight),
          Number(message.tau),
          Number(message.pyramidDownsamples),
        );
        self.postMessage({ type: "focus-core-begin-result", requestId });
        return;
      }

      if (message.type === "focus-core-add-image") {
        const cv = await getOpenCv();
        if (!workingSharpnessState || !focusCoreState) {
          throw new Error("Focus worker core is not initialized.");
        }
        addFocusCoreImage(
          cv,
          workingSharpnessState,
          focusCoreState,
          Number(message.imageIndex),
          new Uint16Array(message.rgbBuffer),
        );
        self.postMessage({ type: "focus-core-add-image-result", requestId });
        return;
      }

      if (message.type === "focus-core-finish") {
        const cv = await getOpenCv();
        if (!workingSharpnessState || !focusCoreState) {
          throw new Error("Focus worker core is not initialized.");
        }
        const completedState = focusCoreState;
        focusCoreState = null;
        const merged = finishFocusCore(cv, workingSharpnessState, completedState);
        self.postMessage(
          { type: "focus-core-finish-result", requestId, gamma2Buffer: merged.buffer },
          [merged.buffer],
        );
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
        return;
      }

      if (message.type === "merge-tile-working") {
        const cv = await getOpenCv();
        if (!workingSharpnessState) {
          throw new Error("Focus worker working sharpness cache is not initialized.");
        }
        const rgbTiles = (message.rgbBuffers || []).map((buffer) => new Uint16Array(buffer));
        const regionWidth = Number(message.regionWidth);
        const regionHeight = Number(message.regionHeight);
        if (rgbTiles.length !== workingSharpnessState.sharpnessMaps.length) {
          throw new Error("Focus merge RGB image count does not match cached sharpness maps.");
        }
        const sharpnessTiles = workingSharpnessState.sharpnessMaps.map((sharpness) =>
          expandSharpnessRegionBilinear(
            sharpness,
            workingSharpnessState.workingWidth,
            workingSharpnessState.workingHeight,
            workingSharpnessState.imageWidth,
            workingSharpnessState.imageHeight,
            Number(message.regionX),
            Number(message.regionY),
            regionWidth,
            regionHeight,
          ));
        const merged = mergeFocusTile(
          cv,
          rgbTiles,
          sharpnessTiles,
          regionWidth,
          regionHeight,
          Number(message.tau),
          Number(message.pyramidLevels),
        );
        self.postMessage(
          { type: "merge-tile-working-result", requestId, gamma2Buffer: merged.buffer },
          [merged.buffer],
        );
        return;
      }
    } catch (error) {
      if (typeof message.type === "string" && message.type.startsWith("focus-core-")) {
        focusCoreState = null;
      }
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

  function computeSharpnessFeatures(cv, gamma2Rgb, width, height) {
    const expectedLength = width * height * 3;
    const workingDimensions = focusSharpnessWorkingDimensions(width, height);
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
    let claheWorking = null;
    let blurred = null;
    let laplacian = null;
    let sobelX = null;
    let sobelY = null;
    try {
      if (workingDimensions.isScaled) {
        working = new cv.Mat();
        cv.resize(
          gray,
          working,
          new cv.Size(workingDimensions.width, workingDimensions.height),
          0,
          0,
          cv.INTER_AREA,
        );
      } else {
        working = gray.clone();
      }
      gray.delete();
      gray = null;

      claheWorking = applyClaheGrayImage(cv, working, SHARPNESS_CLAHE_CLIP_LIMIT, SHARPNESS_CLAHE_GAMMA);
      working.delete();
      working = null;

      if (SHARPNESS_BLUR_RADIUS > 1) {
        const ksize = Math.ceil(2 * SHARPNESS_BLUR_RADIUS) + 1;
        blurred = new cv.Mat();
        cv.GaussianBlur(claheWorking, blurred, new cv.Size(ksize, ksize), 0, 0, cv.BORDER_DEFAULT);
      } else {
        blurred = claheWorking.clone();
      }

      laplacian = new cv.Mat();
      cv.Laplacian(blurred, laplacian, cv.CV_32F ?? cv.CV_32FC1, 3);
      const pixelCount = laplacian.data32F.length;
      const features = new Float32Array(pixelCount * 2);
      const absLap = features.subarray(0, pixelCount);
      let lapMean = 0;
      for (let i = 0; i < pixelCount; i += 1) {
        const value = Math.abs(laplacian.data32F[i]);
        absLap[i] = value;
        lapMean += value;
      }
      lapMean = pixelCount > 0 ? lapMean / pixelCount : 0;
      if (SHARPNESS_SUPPRESS_NOISE > 0) {
        const noiseFloor = Math.min(
          estimateWhiteNoiseLevelFromLaplacian(
            absLap,
            workingDimensions.width,
            workingDimensions.height,
          ),
          lapMean * 0.5,
        );
        const subtract = SHARPNESS_SUPPRESS_NOISE * noiseFloor;
        for (let i = 0; i < pixelCount; i += 1) {
          absLap[i] = Math.max(0, absLap[i] - subtract);
        }
      }
      const lapStats = createRunningStats();
      for (let i = 0; i < pixelCount; i += 1) {
        updateRunningStats(lapStats, absLap[i]);
      }

      sobelX = new cv.Mat();
      sobelY = new cv.Mat();
      cv.Sobel(blurred, sobelX, cv.CV_32F ?? cv.CV_32FC1, 1, 0, 3);
      cv.Sobel(blurred, sobelY, cv.CV_32F ?? cv.CV_32FC1, 0, 1, 3);
      const sobel = features.subarray(pixelCount);
      const sobelStats = createRunningStats();
      for (let i = 0; i < pixelCount; i += 1) {
        const value = Math.hypot(sobelX.data32F[i], sobelY.data32F[i]);
        sobel[i] = value;
        updateRunningStats(sobelStats, value);
      }

      return {
        features,
        workingWidth: workingDimensions.width,
        workingHeight: workingDimensions.height,
        lapStats: finalizeRunningStats(lapStats),
        sobelStats: finalizeRunningStats(sobelStats),
      };
    } finally {
      if (sobelY) sobelY.delete();
      if (sobelX) sobelX.delete();
      if (laplacian) laplacian.delete();
      if (blurred) blurred.delete();
      if (claheWorking) claheWorking.delete();
      if (working) working.delete();
      if (gray) gray.delete();
    }
  }

  function composeSharpnessMap(
    features,
    workingWidth,
    workingHeight,
    width,
    height,
    globalLapMean,
    globalLapStd,
    globalSobelMean,
    globalSobelStd,
  ) {
    const expectedWorking = focusSharpnessWorkingDimensions(width, height);
    if (
      workingWidth !== expectedWorking.width ||
      workingHeight !== expectedWorking.height ||
      !(Number.isInteger(workingWidth) && workingWidth > 0 && Number.isInteger(workingHeight) && workingHeight > 0)
    ) {
      throw new Error("Focus sharpness features have invalid working dimensions.");
    }
    const pixelCount = workingWidth * workingHeight;
    if (features.length !== pixelCount * 2) {
      throw new Error("Focus sharpness features have an invalid buffer size.");
    }
    if (!Number.isFinite(globalLapMean) || !Number.isFinite(globalSobelMean)) {
      throw new Error("Focus sharpness received invalid global means.");
    }

    const useLap = isUsableFocusStd(globalLapStd);
    const useSobel = isUsableFocusStd(globalSobelStd);
    const sharpSmall = new Float32Array(pixelCount);
    for (let i = 0; i < pixelCount; i += 1) {
      const lapZ = useLap ? (features[i] - globalLapMean) / globalLapStd : 0;
      const sobelZ = useSobel ? (features[pixelCount + i] - globalSobelMean) / globalSobelStd : 0;
      const value = SHARPNESS_HIGH_LOW_BALANCE * lapZ +
        (1 - SHARPNESS_HIGH_LOW_BALANCE) * sobelZ;
      sharpSmall[i] = Math.max(-10, Math.min(10, Number.isFinite(value) ? value : 0));
    }
    return sharpSmall;
  }

  function applyClaheGrayImage(cv, gray, clipLimit, gamma) {
    const pixelCount = gray.rows * gray.cols;
    const src = new cv.Mat(gray.rows, gray.cols, cv.CV_8UC1);
    const dst = new cv.Mat();
    const ratio = new Float32Array(pixelCount);
    for (let i = 0; i < pixelCount; i += 1) {
      const value255 = Math.pow(clamp01(gray.data32F[i]), 1 / gamma) * 255;
      const byteValue = Math.max(0, Math.min(255, Math.trunc(value255)));
      src.data[i] = byteValue;
      ratio[i] = byteValue > 0 ? byteValue / Math.max(value255, 1e-6) : 1;
    }

    const tileGridSize = new cv.Size(8, 8);
    const clahe = cv.createCLAHE
      ? cv.createCLAHE(clipLimit, tileGridSize)
      : new cv.CLAHE(clipLimit, tileGridSize);
    try {
      clahe.apply(src, dst);
      const restored = new cv.Mat(gray.rows, gray.cols, cv.CV_32FC1);
      for (let i = 0; i < pixelCount; i += 1) {
        const converted = dst.data[i];
        let restored255 = converted / Math.max(ratio[i], 0.5);
        if (converted === 0) {
          restored255 = Math.min(Math.pow(clamp01(gray.data32F[i]), 1 / gamma) * 255 * 0.9, 0.9);
        }
        restored.data32F[i] = clamp01(Math.pow(Math.max(0, restored255) / 255, gamma));
      }
      return restored;
    } finally {
      if (clahe && typeof clahe.delete === "function") clahe.delete();
      src.delete();
      dst.delete();
    }
  }

  function createRunningStats() {
    return { count: 0, mean: 0, m2: 0 };
  }

  function updateRunningStats(stats, value) {
    if (!Number.isFinite(value)) return;
    stats.count += 1;
    const delta = value - stats.mean;
    stats.mean += delta / stats.count;
    const delta2 = value - stats.mean;
    stats.m2 += delta * delta2;
  }

  function finalizeRunningStats(stats) {
    return { count: stats.count, mean: stats.mean, m2: Math.max(0, stats.m2) };
  }

  function expandSharpnessRegionBilinear(
    sharpness,
    workingWidth,
    workingHeight,
    imageWidth,
    imageHeight,
    regionX,
    regionY,
    regionWidth,
    regionHeight,
  ) {
    if (sharpness.length !== workingWidth * workingHeight) {
      throw new Error("Focus sharpness working map has an invalid size.");
    }
    const out = new Float32Array(regionWidth * regionHeight);
    const scaleX = workingWidth / imageWidth;
    const scaleY = workingHeight / imageHeight;
    for (let y = 0; y < regionHeight; y += 1) {
      const srcY = (regionY + y + 0.5) * scaleY - 0.5;
      const y0 = Math.max(0, Math.min(workingHeight - 1, Math.floor(srcY)));
      const y1 = Math.max(0, Math.min(workingHeight - 1, y0 + 1));
      const fy = Math.max(0, Math.min(1, srcY - y0));
      const row0 = y0 * workingWidth;
      const row1 = y1 * workingWidth;
      for (let x = 0; x < regionWidth; x += 1) {
        const srcX = (regionX + x + 0.5) * scaleX - 0.5;
        const x0 = Math.max(0, Math.min(workingWidth - 1, Math.floor(srcX)));
        const x1 = Math.max(0, Math.min(workingWidth - 1, x0 + 1));
        const fx = Math.max(0, Math.min(1, srcX - x0));
        const v00 = sharpness[row0 + x0];
        const v01 = sharpness[row0 + x1];
        const v10 = sharpness[row1 + x0];
        const v11 = sharpness[row1 + x1];
        const top = v00 + (v01 - v00) * fx;
        const bottom = v10 + (v11 - v10) * fx;
        out[y * regionWidth + x] = top + (bottom - top) * fy;
      }
    }
    return out;
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

  function buildRegionSamplingState(state, regionX, regionY, regionWidth, regionHeight) {
    const workingX0 = new Int32Array(regionWidth);
    const workingX1 = new Int32Array(regionWidth);
    const workingFx = new Float32Array(regionWidth);
    for (let localX = 0; localX < regionWidth; localX += 1) {
      const imageX = regionX + localX;
      const srcX = (imageX + 0.5) * state.workingWidth / state.imageWidth - 0.5;
      const workingX0Raw = Math.floor(srcX);
      workingFx[localX] = Math.max(0, Math.min(1, srcX - workingX0Raw));
      workingX0[localX] = Math.max(0, Math.min(state.workingWidth - 1, workingX0Raw));
      workingX1[localX] = Math.max(0, Math.min(state.workingWidth - 1, workingX0Raw + 1));
    }

    const workingY0 = new Int32Array(regionHeight);
    const workingY1 = new Int32Array(regionHeight);
    const workingFy = new Float32Array(regionHeight);
    for (let localY = 0; localY < regionHeight; localY += 1) {
      const imageY = regionY + localY;
      const srcY = (imageY + 0.5) * state.workingHeight / state.imageHeight - 0.5;
      const workingY0Raw = Math.floor(srcY);
      workingFy[localY] = Math.max(0, Math.min(1, srcY - workingY0Raw));
      workingY0[localY] = Math.max(0, Math.min(state.workingHeight - 1, workingY0Raw));
      workingY1[localY] = Math.max(0, Math.min(state.workingHeight - 1, workingY0Raw + 1));
    }

    return {
      workingX0,
      workingX1,
      workingFx,
      workingY0,
      workingY1,
      workingFy,
    };
  }

  function sampleWorkingSharpnessRegion(state, sampling, imageIndex, localX, localY) {
    const sharpness = state.sharpnessMaps[imageIndex];
    const x0 = sampling.workingX0[localX];
    const x1 = sampling.workingX1[localX];
    const y0 = sampling.workingY0[localY];
    const y1 = sampling.workingY1[localY];
    const fx = sampling.workingFx[localX];
    const fy = sampling.workingFy[localY];
    const v00 = sharpness[y0 * state.workingWidth + x0];
    const v10 = sharpness[y0 * state.workingWidth + x1];
    const v01 = sharpness[y1 * state.workingWidth + x0];
    const v11 = sharpness[y1 * state.workingWidth + x1];
    const top = v00 + (v10 - v00) * fx;
    const bottom = v01 + (v11 - v01) * fx;
    return top + (bottom - top) * fy;
  }



  function beginFocusCore(
    workingState,
    regionX,
    regionY,
    regionWidth,
    regionHeight,
    coreOffsetX,
    coreOffsetY,
    coreWidth,
    coreHeight,
    tau,
    requestedDownsamples,
  ) {
    if (!(Number.isInteger(regionX) && regionX >= 0 && Number.isInteger(regionY) && regionY >= 0)) {
      throw new Error("Focus core received invalid region coordinates.");
    }
    if (!(Number.isInteger(regionWidth) && regionWidth > 0 && Number.isInteger(regionHeight) && regionHeight > 0)) {
      throw new Error("Focus core received invalid region dimensions.");
    }
    if (
      regionX + regionWidth > workingState.imageWidth ||
      regionY + regionHeight > workingState.imageHeight
    ) {
      throw new Error("Focus core region is outside the image bounds.");
    }
    if (
      !(Number.isInteger(coreOffsetX) && coreOffsetX >= 0 && Number.isInteger(coreOffsetY) && coreOffsetY >= 0) ||
      !(Number.isInteger(coreWidth) && coreWidth > 0 && Number.isInteger(coreHeight) && coreHeight > 0) ||
      coreOffsetX + coreWidth > regionWidth ||
      coreOffsetY + coreHeight > regionHeight
    ) {
      throw new Error("Focus core crop is outside the processing region.");
    }
    if (!(Number.isFinite(tau) && tau > 0)) throw new Error("Focus core received an invalid softmax tau.");

    const maxDownsamples = Math.max(0, Math.floor(Math.log2(Math.min(regionWidth, regionHeight))));
    const pyramidDownsamples = Math.max(
      0,
      Math.min(Math.trunc(requestedDownsamples), maxDownsamples),
    );
    const usePyramid = pyramidDownsamples > 1 && Math.min(regionWidth, regionHeight) >= 256;
    const dimensions = [{ width: regionWidth, height: regionHeight }];
    if (usePyramid) {
      for (let level = 0; level < pyramidDownsamples; level += 1) {
        const previous = dimensions[dimensions.length - 1];
        dimensions.push({
          width: Math.ceil(previous.width / 2),
          height: Math.ceil(previous.height / 2),
        });
      }
    }

    const pixelCount = regionWidth * regionHeight;
    const logZ = new Float32Array(pixelCount);
    const imageCount = workingState.sharpnessMaps.length;
    const sampling = buildRegionSamplingState(
      workingState,
      regionX,
      regionY,
      regionWidth,
      regionHeight,
    );
    for (let localY = 0; localY < regionHeight; localY += 1) {
      for (let localX = 0; localX < regionWidth; localX += 1) {
        const pixel = localY * regionWidth + localX;
        let maxScaled = -Infinity;
        let expSum = 0;
        for (let imageIndex = 0; imageIndex < imageCount; imageIndex += 1) {
          const finalScore = sampleWorkingSharpnessRegion(workingState, sampling, imageIndex, localX, localY);
          const scaled = finalScore / tau;
          if (scaled <= maxScaled) {
            expSum += Math.exp(scaled - maxScaled);
          } else {
            expSum = maxScaled === -Infinity ? 1 : expSum * Math.exp(maxScaled - scaled) + 1;
            maxScaled = scaled;
          }
        }
        logZ[pixel] = maxScaled + Math.log(Math.max(expSum, 1e-30));
      }
    }

    return {
      regionX,
      regionY,
      regionWidth,
      regionHeight,
      coreOffsetX,
      coreOffsetY,
      coreWidth,
      coreHeight,
      tau,
      pyramidDownsamples,
      usePyramid,
      dimensions,
      sampling,
      logZ,
      fused: usePyramid
        ? dimensions.map(({ width, height }) => new Float32Array(width * height * 3))
        : null,
      directOutput: usePyramid ? null : new Float32Array(pixelCount * 3),
      processedImages: 0,
    };
  }

  function focusWeightForPixel(workingState, coreState, imageIndex, pixel, localX, localY) {
    const finalScore = sampleWorkingSharpnessRegion(
      workingState,
      coreState.sampling,
      imageIndex,
      localX,
      localY,
    );
    return Math.exp(finalScore / coreState.tau - coreState.logZ[pixel]);
  }

  function addFocusCoreImage(cv, workingState, coreState, imageIndex, rgb) {
    const imageCount = workingState.sharpnessMaps.length;
    if (!(Number.isInteger(imageIndex) && imageIndex >= 0 && imageIndex < imageCount)) {
      throw new Error("Focus core received an invalid image index.");
    }
    if (imageIndex !== coreState.processedImages) {
      throw new Error("Focus core images must be streamed in input order.");
    }
    const pixelCount = coreState.regionWidth * coreState.regionHeight;
    if (!(rgb instanceof Uint16Array) || rgb.length !== pixelCount * 3) {
      throw new Error(`Focus RGB image ${imageIndex + 1} has an invalid region size.`);
    }

    if (!coreState.usePyramid) {
      const output = coreState.directOutput;
      for (let localY = 0; localY < coreState.regionHeight; localY += 1) {
        for (let localX = 0; localX < coreState.regionWidth; localX += 1) {
          const pixel = localY * coreState.regionWidth + localX;
          const weight = focusWeightForPixel(workingState, coreState, imageIndex, pixel, localX, localY);
          const offset = pixel * 3;
          output[offset] += gamma2Uint16ToLinear(rgb[offset]) * weight;
          output[offset + 1] += gamma2Uint16ToLinear(rgb[offset + 1]) * weight;
          output[offset + 2] += gamma2Uint16ToLinear(rgb[offset + 2]) * weight;
        }
      }
      coreState.processedImages += 1;
      return;
    }

    let currentRgb = new cv.Mat(coreState.regionHeight, coreState.regionWidth, cv.CV_32FC3);
    let currentWeight = new cv.Mat(coreState.regionHeight, coreState.regionWidth, cv.CV_32FC1);
    for (let localY = 0; localY < coreState.regionHeight; localY += 1) {
      for (let localX = 0; localX < coreState.regionWidth; localX += 1) {
        const pixel = localY * coreState.regionWidth + localX;
        const offset = pixel * 3;
        currentRgb.data32F[offset] = gamma2Uint16ToLinear(rgb[offset]);
        currentRgb.data32F[offset + 1] = gamma2Uint16ToLinear(rgb[offset + 1]);
        currentRgb.data32F[offset + 2] = gamma2Uint16ToLinear(rgb[offset + 2]);
        currentWeight.data32F[pixel] = focusWeightForPixel(
          workingState,
          coreState,
          imageIndex,
          pixel,
          localX,
          localY,
        );
      }
    }

    try {
      for (let level = 0; level < coreState.pyramidDownsamples; level += 1) {
        const nextDim = coreState.dimensions[level + 1];
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
          const target = coreState.fused[level];
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

      const lowestTarget = coreState.fused[coreState.pyramidDownsamples];
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
    coreState.processedImages += 1;
  }

  function finishFocusCore(cv, workingState, coreState) {
    if (coreState.processedImages !== workingState.sharpnessMaps.length) {
      throw new Error("Focus core is incomplete.");
    }

    let reconstructed;
    if (coreState.usePyramid) {
      reconstructed = coreState.fused[coreState.pyramidDownsamples];
      for (let level = coreState.pyramidDownsamples - 1; level >= 0; level -= 1) {
        const sourceDim = coreState.dimensions[level + 1];
        const targetDim = coreState.dimensions[level];
        const sourceMat = new cv.Mat(sourceDim.height, sourceDim.width, cv.CV_32FC3);
        const up = new cv.Mat();
        sourceMat.data32F.set(reconstructed);
        try {
          cv.pyrUp(sourceMat, up, new cv.Size(targetDim.width, targetDim.height));
          const next = coreState.fused[level];
          const upData = up.data32F;
          for (let i = 0; i < next.length; i += 1) next[i] += upData[i];
          reconstructed = next;
        } finally {
          sourceMat.delete();
          up.delete();
        }
      }
    } else {
      reconstructed = coreState.directOutput;
    }

    return encodeLinearCoreToGamma2Uint16(
      reconstructed,
      coreState.regionWidth,
      coreState.coreOffsetX,
      coreState.coreOffsetY,
      coreState.coreWidth,
      coreState.coreHeight,
    );
  }

  function encodeLinearCoreToGamma2Uint16(
    linear,
    regionWidth,
    coreOffsetX,
    coreOffsetY,
    coreWidth,
    coreHeight,
  ) {
    const output = new Uint16Array(coreWidth * coreHeight * 3);
    const rowLength = coreWidth * 3;
    for (let y = 0; y < coreHeight; y += 1) {
      const sourceStart = ((coreOffsetY + y) * regionWidth + coreOffsetX) * 3;
      const targetStart = y * rowLength;
      for (let i = 0; i < rowLength; i += 1) {
        output[targetStart + i] = Math.round(Math.sqrt(clamp01(linear[sourceStart + i])) * RESULT_BUFFER_MAX_UINT16);
      }
    }
    return output;
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

    // The controller chooses one pyramid depth from the full image dimensions
    // and uses it for every haloed processing region.  Edge regions can be
    // smaller than the central core, so only clamp when a region is genuinely
    // too small to downsample to the requested image-wide depth.
    const maxLevels = Math.max(0, Math.floor(Math.log2(Math.min(width, height))));
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
