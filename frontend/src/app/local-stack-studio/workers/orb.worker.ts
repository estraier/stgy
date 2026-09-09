// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-nocheck
// Local Stack Studio worker source. Built to public/generated/local-stack-studio.
import { loadWorkerOpenCv } from "./opencv-runtime";

(() => {
  "use strict";

  const ORB_MAX_FEATURES = 5000;
  const ORB_MATCH_SHIFT_LIMIT = 0.10;
  const ORB_FALLBACK_MATCH_SHIFT_LIMIT = 0.20;
  const ORB_MIN_GOOD_MATCHES = 11;
  const ORB_MIN_FALLBACK_MATCHES = 6;
  const ORB_RANSAC_REPROJECTION_THRESHOLD = 5.0;
  const ORB_FALLBACK_MEDIAN_REPROJECTION_ERROR = 3.0;
  const ORB_FALLBACK_P95_REPROJECTION_ERROR = 10.0;
  const ALIGNMENT_BILATERAL_DIAMETER = 5;
  const ALIGNMENT_BILATERAL_SIGMA_COLOR = 20;
  const ALIGNMENT_BILATERAL_SIGMA_SPACE = 10;
  const ALIGNMENT_CLAHE_CLIP_LIMIT = 1.0;
  const ALIGNMENT_CLAHE_TILE_GRID = 8;
  const ALIGNMENT_EXPOSURE_MAX_GAIN = 16;
  const ALIGNMENT_EXPOSURE_SAMPLE_LIMIT = 65536;
  const SRGB_TO_LINEAR_LUT = buildSrgbToLinearLut();

  let cv = null;
  let orb = null;
  let matcher = null;
  let emptyMask = null;
  let referenceGrayBytes = null;
  let referenceExposureScalar = null;
  let width = 0;
  let height = 0;
  let ready = false;

  self.onmessage = async (event) => {
    const message = event.data;
    try {
      if (message.type === "init") {
        const referenceFeatureCount = await initialize(message);
        self.postMessage({
          type: "ready",
          requestId: message.requestId,
          referenceFeatureCount,
        });
        return;
      }

      if (message.type === "align") {
        if (!ready) throw new Error("ORB worker is not initialized.");
        const result = alignTarget(
          message.grayBuffer,
          message.fileName || `image ${message.id}`,
          message.exposureScalar,
        );
        self.postMessage(
          {
            type: "result",
            requestId: message.requestId,
            id: message.id,
            fileName: message.fileName,
            matrixBuffer: result.matrix.buffer,
            referenceFeatureCount: result.referenceFeatureCount,
            targetFeatureCount: result.targetFeatureCount,
            matchCount: result.matchCount,
            usableMatchCount: result.usableMatchCount,
            matchShiftLimit: result.matchShiftLimit,
            fallbackMode: result.fallbackMode,
            reprojectionInlierCount: result.reprojectionInlierCount,
            reprojectionMedianError: result.reprojectionMedianError,
            reprojectionP95Error: result.reprojectionP95Error,
            referenceExposureGain: result.referenceExposureGain,
            targetExposureGain: result.targetExposureGain,
            exposureMatchSource: result.exposureMatchSource,
            claheClipLimit: result.claheClipLimit,
          },
          [result.matrix.buffer],
        );
      }
    } catch (error) {
      const response = {
        type: "error",
        requestId: message && typeof message.requestId === "number" ? message.requestId : null,
        id: message && typeof message.id === "number" ? message.id : null,
        message: error instanceof Error ? error.message : String(error),
      };
      self.postMessage(response);
    }
  };

  async function initialize(message) {
    cleanup();
    width = message.width;
    height = message.height;
    if (!(width > 0 && height > 0)) throw new Error("Invalid reference image size.");

    const bytes = new Uint8Array(message.grayBuffer);
    if (bytes.length !== width * height) {
      throw new Error(`Invalid reference grayscale buffer size: ${bytes.length} vs ${width * height}.`);
    }

    cv = await loadWorkerOpenCv("ORB");
    assertOrbApis(cv);
    orb = createOrb(cv);
    matcher = createHammingMatcher(cv);
    emptyMask = new cv.Mat();
    referenceGrayBytes = bytes;
    referenceExposureScalar = positiveExposureOrNull(message.exposureScalar);

    const baselineGray = preprocessAlignmentGray(referenceGrayBytes, 1);
    try {
      const referenceFeatureCount = countOrbFeatures(baselineGray);
      ready = true;
      return referenceFeatureCount;
    } finally {
      baselineGray.delete();
    }
  }

  function alignTarget(grayBuffer, fileName, targetExposureScalar) {
    const targetGrayBytes = new Uint8Array(grayBuffer);
    if (targetGrayBytes.length !== width * height) {
      throw new Error(`Invalid target grayscale buffer size: ${targetGrayBytes.length} vs ${width * height}.`);
    }

    const preprocessing = prepareAlignmentPair(
      referenceGrayBytes,
      targetGrayBytes,
      referenceExposureScalar,
      positiveExposureOrNull(targetExposureScalar),
    );
    const referenceKeypoints = new cv.KeyPointVector();
    const referenceDescriptors = new cv.Mat();
    const targetKeypoints = new cv.KeyPointVector();
    const targetDescriptors = new cv.Mat();
    const matches = new cv.DMatchVector();

    try {
      orb.detectAndCompute(
        preprocessing.referenceGray,
        emptyMask,
        referenceKeypoints,
        referenceDescriptors,
      );
      orb.detectAndCompute(
        preprocessing.targetGray,
        emptyMask,
        targetKeypoints,
        targetDescriptors,
      );

      if (referenceKeypoints.size() < ORB_MIN_FALLBACK_MATCHES || referenceDescriptors.rows <= 0) {
        throw new Error(
          `The exposure-matched reference has too few ORB features (${referenceKeypoints.size()}).`,
        );
      }
      if (targetKeypoints.size() < ORB_MIN_FALLBACK_MATCHES || targetDescriptors.rows <= 0) {
        throw new Error(`${fileName} has too few ORB features (${targetKeypoints.size()}) after preprocessing.`);
      }

      matcher.match(referenceDescriptors, targetDescriptors, matches);
      const strictCandidates = collectMatchCandidates(
        matches,
        referenceKeypoints,
        targetKeypoints,
        ORB_MATCH_SHIFT_LIMIT,
      );
      let lastError = null;

      if (strictCandidates.length >= ORB_MIN_GOOD_MATCHES) {
        try {
          return buildAlignmentResult(
            estimateAlignment(strictCandidates, false),
            referenceKeypoints.size(),
            targetKeypoints.size(),
            matches.size(),
            strictCandidates.length,
            ORB_MATCH_SHIFT_LIMIT,
            "none",
            preprocessing,
          );
        } catch (error) {
          lastError = error;
        }
      }

      const relaxedCandidates = collectMatchCandidates(
        matches,
        referenceKeypoints,
        targetKeypoints,
        ORB_FALLBACK_MATCH_SHIFT_LIMIT,
      );

      if (relaxedCandidates.length >= ORB_MIN_GOOD_MATCHES) {
        try {
          return buildAlignmentResult(
            estimateAlignment(relaxedCandidates, false),
            referenceKeypoints.size(),
            targetKeypoints.size(),
            matches.size(),
            relaxedCandidates.length,
            ORB_FALLBACK_MATCH_SHIFT_LIMIT,
            "relaxed-shift",
            preprocessing,
          );
        } catch (error) {
          lastError = error;
        }
      }

      if (relaxedCandidates.length >= ORB_MIN_FALLBACK_MATCHES) {
        try {
          return buildAlignmentResult(
            estimateAlignment(relaxedCandidates, true),
            referenceKeypoints.size(),
            targetKeypoints.size(),
            matches.size(),
            relaxedCandidates.length,
            ORB_FALLBACK_MATCH_SHIFT_LIMIT,
            "low-match-validated",
            preprocessing,
          );
        } catch (error) {
          lastError = error;
        }
      }

      if (lastError) {
        throw new Error(
          `${fileName} ORB fallback failed after ${strictCandidates.length} matches at ` +
          `${Math.round(ORB_MATCH_SHIFT_LIMIT * 100)}% shift and ${relaxedCandidates.length} at ` +
          `${Math.round(ORB_FALLBACK_MATCH_SHIFT_LIMIT * 100)}% shift: ` +
          `${lastError instanceof Error ? lastError.message : String(lastError)}`,
        );
      }

      throw new Error(
        `${fileName} has only ${strictCandidates.length} usable ORB matches at ` +
        `${Math.round(ORB_MATCH_SHIFT_LIMIT * 100)}% shift and ${relaxedCandidates.length} at ` +
        `${Math.round(ORB_FALLBACK_MATCH_SHIFT_LIMIT * 100)}% shift; ` +
        `${ORB_MIN_FALLBACK_MATCHES} are required for the validated fallback.`,
      );
    } finally {
      matches.delete();
      targetDescriptors.delete();
      targetKeypoints.delete();
      referenceDescriptors.delete();
      referenceKeypoints.delete();
      preprocessing.targetGray.delete();
      preprocessing.referenceGray.delete();
    }
  }

  function estimateAlignment(candidates, validateLowMatchFallback) {
    const targetPoints = [];
    const referencePoints = [];
    for (const match of candidates) {
      targetPoints.push(match.targetX, match.targetY);
      referencePoints.push(match.referenceX, match.referenceY);
    }

    const targetPointsMat = cv.matFromArray(candidates.length, 1, cv.CV_32FC2, targetPoints);
    const referencePointsMat = cv.matFromArray(candidates.length, 1, cv.CV_32FC2, referencePoints);
    let homography = null;

    try {
      const ransacMethod = cv.RANSAC !== undefined ? cv.RANSAC : cv.FM_RANSAC;
      homography = cv.findHomography(
        targetPointsMat,
        referencePointsMat,
        ransacMethod,
        ORB_RANSAC_REPROJECTION_THRESHOLD,
      );

      if (!homography || homography.rows !== 3 || homography.cols !== 3) {
        throw new Error("ORB could not estimate a homography.");
      }

      const matrix = readHomography(homography);
      if (!isHomographyPlausible(matrix)) {
        throw new Error("ORB produced an implausible homography.");
      }

      const reprojection = measureReprojectionErrors(matrix, candidates);
      if (validateLowMatchFallback) {
        validateFallbackReprojection(reprojection);
      }

      return { matrix, reprojection };
    } finally {
      if (homography) homography.delete();
      referencePointsMat.delete();
      targetPointsMat.delete();
    }
  }

  function buildAlignmentResult(
    alignment,
    referenceFeatureCount,
    targetFeatureCount,
    matchCount,
    usableMatchCount,
    matchShiftLimit,
    fallbackMode,
    preprocessing,
  ) {
    return {
      matrix: alignment.matrix,
      referenceFeatureCount,
      targetFeatureCount,
      matchCount,
      usableMatchCount,
      matchShiftLimit,
      fallbackMode,
      reprojectionInlierCount: alignment.reprojection.inlierCount,
      reprojectionMedianError: alignment.reprojection.medianError,
      reprojectionP95Error: alignment.reprojection.p95Error,
      referenceExposureGain: preprocessing.referenceExposureGain,
      targetExposureGain: preprocessing.targetExposureGain,
      exposureMatchSource: preprocessing.exposureMatchSource,
      claheClipLimit: ALIGNMENT_CLAHE_CLIP_LIMIT,
    };
  }

  function prepareAlignmentPair(referenceBytes, targetBytes, referenceExposure, targetExposure) {
    const exposure = resolvePairExposure(referenceBytes, targetBytes, referenceExposure, targetExposure);
    const referenceGray = preprocessAlignmentGray(referenceBytes, exposure.referenceGain);
    try {
      return {
        referenceGray,
        targetGray: preprocessAlignmentGray(targetBytes, exposure.targetGain),
        referenceExposureGain: exposure.referenceGain,
        targetExposureGain: exposure.targetGain,
        exposureMatchSource: exposure.source,
      };
    } catch (error) {
      referenceGray.delete();
      throw error;
    }
  }

  function resolvePairExposure(referenceBytes, targetBytes, referenceExposure, targetExposure) {
    let referenceLevel;
    let targetLevel;
    let source;

    if (positiveExposureOrNull(referenceExposure) && positiveExposureOrNull(targetExposure)) {
      referenceLevel = referenceExposure;
      targetLevel = targetExposure;
      source = "metadata";
    } else {
      referenceLevel = estimateRobustExposureLevel(referenceBytes);
      targetLevel = estimateRobustExposureLevel(targetBytes);
      source = "image-statistics";
    }

    if (!(referenceLevel > 0 && targetLevel > 0)) {
      return { referenceGain: 1, targetGain: 1, source: "none" };
    }

    const midpoint = Math.sqrt(referenceLevel * targetLevel);
    const referenceGain = clampExposureGain(midpoint / referenceLevel);
    const targetGain = clampExposureGain(midpoint / targetLevel);
    return { referenceGain, targetGain, source };
  }

  function positiveExposureOrNull(value) {
    const number = Number(value);
    return Number.isFinite(number) && number > 0 ? number : null;
  }

  function clampExposureGain(gain) {
    if (!(Number.isFinite(gain) && gain > 0)) return 1;
    return Math.max(1 / ALIGNMENT_EXPOSURE_MAX_GAIN, Math.min(ALIGNMENT_EXPOSURE_MAX_GAIN, gain));
  }

  function estimateRobustExposureLevel(bytes) {
    const histogram = buildSampledByteHistogram(bytes);
    let total = 0;
    for (let value = 1; value < 255; value += 1) total += histogram[value];
    if (total <= 0) return 0;

    const targetRank = Math.max(1, Math.ceil(total * 0.60));
    let cumulative = 0;
    for (let value = 1; value < 255; value += 1) {
      cumulative += histogram[value];
      if (cumulative >= targetRank) {
        return Math.max(SRGB_TO_LINEAR_LUT[value], 1e-6);
      }
    }
    return Math.max(SRGB_TO_LINEAR_LUT[254], 1e-6);
  }

  function buildSampledByteHistogram(bytes) {
    const histogram = new Uint32Array(256);
    const stride = Math.max(1, Math.ceil(bytes.length / ALIGNMENT_EXPOSURE_SAMPLE_LIMIT));
    const offset = Math.floor(stride / 2);
    for (let i = offset; i < bytes.length; i += stride) {
      histogram[bytes[i]] += 1;
    }
    return histogram;
  }

  function estimateScaledLinearPercentile(bytes, gain, q) {
    const histogram = buildSampledByteHistogram(bytes);
    let total = 0;
    for (let value = 0; value < 256; value += 1) total += histogram[value];
    if (total <= 0) return 0;
    const rank = Math.max(1, Math.ceil(total * Math.max(0, Math.min(1, q))));
    let cumulative = 0;
    for (let value = 0; value < 256; value += 1) {
      cumulative += histogram[value];
      if (cumulative >= rank) return SRGB_TO_LINEAR_LUT[value] * gain;
    }
    return gain;
  }

  function preprocessAlignmentGray(bytes, gain) {
    const exposedBytes = applyExposureToGrayBytes(bytes, gain);
    const source = makeGrayMatFromBytes(exposedBytes);
    const bilateral = new cv.Mat();
    const output = new cv.Mat();
    let clahe = null;

    try {
      const borderType = cv.BORDER_DEFAULT !== undefined ? cv.BORDER_DEFAULT : 4;
      cv.bilateralFilter(
        source,
        bilateral,
        ALIGNMENT_BILATERAL_DIAMETER,
        ALIGNMENT_BILATERAL_SIGMA_COLOR,
        ALIGNMENT_BILATERAL_SIGMA_SPACE,
        borderType,
      );
      clahe = createClahe();
      clahe.apply(bilateral, output);
      return output;
    } catch (error) {
      output.delete();
      throw error;
    } finally {
      if (clahe) {
        if (typeof clahe.collectGarbage === "function") clahe.collectGarbage();
        if (typeof clahe.delete === "function") clahe.delete();
      }
      bilateral.delete();
      source.delete();
    }
  }

  function applyExposureToGrayBytes(bytes, gain) {
    const adjustedGain = clampExposureGain(gain);
    const maxVal = adjustedGain > 1
      ? estimateScaledLinearPercentile(bytes, adjustedGain, 0.998)
      : 0;
    const rolloff = alignmentExposureRolloffParams(maxVal);
    const lut = new Uint8Array(256);

    for (let value = 0; value < 256; value += 1) {
      let linear = SRGB_TO_LINEAR_LUT[value] * adjustedGain;
      if (rolloff && linear > rolloff.inflection) {
        linear = rolloff.inflection + (linear - rolloff.inflection) * rolloff.scale;
      }
      lut[value] = linearToSrgbByte(linear);
    }

    const output = new Uint8Array(bytes.length);
    for (let i = 0; i < bytes.length; i += 1) output[i] = lut[bytes[i]];
    return output;
  }

  function alignmentExposureRolloffParams(maxVal) {
    if (!(Number.isFinite(maxVal) && maxVal > 1)) return null;
    const asymptotic = maxVal > 4 ? Math.pow(0.5, 4 / maxVal) : 0.5;
    const inflection = asymptotic + (1 - asymptotic) / maxVal;
    if (!(Number.isFinite(inflection) && inflection < maxVal)) return null;
    const scale = (1 - inflection) / (maxVal - inflection + 1e-6);
    if (!(Number.isFinite(scale) && scale > 0)) return null;
    return { inflection, scale };
  }

  function buildSrgbToLinearLut() {
    const lut = new Float32Array(256);
    for (let value = 0; value < 256; value += 1) {
      const encoded = value / 255;
      lut[value] = encoded <= 0.04045
        ? encoded / 12.92
        : Math.pow((encoded + 0.055) / 1.055, 2.4);
    }
    return lut;
  }

  function linearToSrgbByte(linear) {
    if (!(Number.isFinite(linear) && linear > 0)) return 0;
    if (linear >= 1) return 255;
    const encoded = linear <= 0.0031308
      ? linear * 12.92
      : 1.055 * Math.pow(linear, 1 / 2.4) - 0.055;
    return Math.max(0, Math.min(255, Math.round(encoded * 255)));
  }

  function createClahe() {
    const tileGridSize = new cv.Size(ALIGNMENT_CLAHE_TILE_GRID, ALIGNMENT_CLAHE_TILE_GRID);
    if (typeof cv.createCLAHE === "function") {
      return cv.createCLAHE(ALIGNMENT_CLAHE_CLIP_LIMIT, tileGridSize);
    }
    if (typeof cv.CLAHE === "function") {
      return new cv.CLAHE(ALIGNMENT_CLAHE_CLIP_LIMIT, tileGridSize);
    }
    throw new Error("This OpenCV.js build does not provide CLAHE.");
  }

  function countOrbFeatures(gray) {
    const keypoints = new cv.KeyPointVector();
    const descriptors = new cv.Mat();
    try {
      orb.detectAndCompute(gray, emptyMask, keypoints, descriptors);
      return keypoints.size();
    } finally {
      descriptors.delete();
      keypoints.delete();
    }
  }

  function makeGrayMatFromBytes(bytes) {
    if (bytes.length !== width * height) {
      throw new Error(`Invalid grayscale buffer size: ${bytes.length} vs ${width * height}.`);
    }
    const mat = new cv.Mat(height, width, cv.CV_8UC1);
    if (!mat.data || mat.data.length < bytes.length) {
      mat.delete();
      throw new Error("OpenCV could not allocate the grayscale alignment buffer.");
    }
    mat.data.set(bytes);
    return mat;
  }

  function collectMatchCandidates(matches, referenceKeypoints, targetKeypoints, shiftLimit) {
    const sidesMean = (width + height) / 2;
    const candidates = [];

    for (let i = 0; i < matches.size(); i += 1) {
      const match = matches.get(i);
      const referencePoint = referenceKeypoints.get(match.queryIdx).pt;
      const targetPoint = targetKeypoints.get(match.trainIdx).pt;
      const normalizedShift = Math.hypot(
        referencePoint.x - targetPoint.x,
        referencePoint.y - targetPoint.y,
      ) / sidesMean;

      if (normalizedShift <= shiftLimit) {
        candidates.push({
          distance: match.distance,
          referenceX: referencePoint.x,
          referenceY: referencePoint.y,
          targetX: targetPoint.x,
          targetY: targetPoint.y,
        });
      }
    }

    candidates.sort((a, b) => a.distance - b.distance);
    return candidates;
  }

  function measureReprojectionErrors(matrix, candidates) {
    const errors = [];
    let inlierCount = 0;

    for (const match of candidates) {
      const denominator =
        matrix[6] * match.targetX + matrix[7] * match.targetY + matrix[8];
      if (!Number.isFinite(denominator) || Math.abs(denominator) < 1e-12) {
        errors.push(Number.POSITIVE_INFINITY);
        continue;
      }

      const projectedX =
        (matrix[0] * match.targetX + matrix[1] * match.targetY + matrix[2]) / denominator;
      const projectedY =
        (matrix[3] * match.targetX + matrix[4] * match.targetY + matrix[5]) / denominator;
      const error = Math.hypot(
        projectedX - match.referenceX,
        projectedY - match.referenceY,
      );
      errors.push(error);
      if (Number.isFinite(error) && error <= ORB_RANSAC_REPROJECTION_THRESHOLD) {
        inlierCount += 1;
      }
    }

    errors.sort((a, b) => a - b);
    return {
      inlierCount,
      medianError: percentileSorted(errors, 0.5),
      p95Error: percentileSorted(errors, 0.95),
    };
  }

  function validateFallbackReprojection(reprojection) {
    if (reprojection.inlierCount < ORB_MIN_FALLBACK_MATCHES) {
      throw new Error(
        `validated fallback has only ${reprojection.inlierCount} reprojection inliers ` +
        `(need ${ORB_MIN_FALLBACK_MATCHES})`,
      );
    }
    if (!(reprojection.medianError <= ORB_FALLBACK_MEDIAN_REPROJECTION_ERROR)) {
      throw new Error(
        `validated fallback median reprojection error is ${formatPixels(reprojection.medianError)} ` +
        `(limit ${ORB_FALLBACK_MEDIAN_REPROJECTION_ERROR.toFixed(1)} px)`,
      );
    }
    if (!(reprojection.p95Error <= ORB_FALLBACK_P95_REPROJECTION_ERROR)) {
      throw new Error(
        `validated fallback 95th-percentile reprojection error is ${formatPixels(reprojection.p95Error)} ` +
        `(limit ${ORB_FALLBACK_P95_REPROJECTION_ERROR.toFixed(1)} px)`,
      );
    }
  }

  function percentileSorted(values, q) {
    if (values.length === 0) return Number.POSITIVE_INFINITY;
    const rank = Math.ceil(Math.max(0, Math.min(1, q)) * values.length);
    const index = Math.min(values.length - 1, Math.max(0, rank - 1));
    return values[index];
  }

  function formatPixels(value) {
    return Number.isFinite(value) ? `${value.toFixed(2)} px` : "non-finite";
  }

  function createOrb(cv) {
    let instance;
    if (cv.ORB && typeof cv.ORB.create === "function") {
      instance = cv.ORB.create();
    } else if (typeof cv.ORB_create === "function") {
      instance = cv.ORB_create();
    } else if (typeof cv.ORB === "function") {
      instance = new cv.ORB();
    } else {
      throw new Error("This OpenCV.js build does not provide ORB.");
    }
    if (typeof instance.setMaxFeatures === "function") {
      instance.setMaxFeatures(ORB_MAX_FEATURES);
    }
    return instance;
  }

  function createHammingMatcher(cv) {
    if (cv.BFMatcher && typeof cv.BFMatcher.create === "function") {
      return cv.BFMatcher.create(cv.NORM_HAMMING, true);
    }
    if (typeof cv.BFMatcher === "function") {
      return new cv.BFMatcher(cv.NORM_HAMMING, true);
    }
    throw new Error("This OpenCV.js build does not provide BFMatcher.");
  }

  function readHomography(homography) {
    let source = null;
    if (homography.data64F && homography.data64F.length >= 9) {
      source = homography.data64F;
    } else if (homography.data32F && homography.data32F.length >= 9) {
      source = homography.data32F;
    }
    if (!source) {
      throw new Error("OpenCV returned a homography with an unsupported data layout.");
    }

    const denominator = source[8];
    if (!Number.isFinite(denominator) || Math.abs(denominator) < 1e-12) {
      throw new Error("OpenCV returned an invalid homography.");
    }

    const matrix = new Float64Array(9);
    for (let i = 0; i < 9; i += 1) {
      matrix[i] = source[i] / denominator;
      if (!Number.isFinite(matrix[i])) {
        throw new Error("OpenCV returned an invalid homography.");
      }
    }
    return matrix;
  }

  function isHomographyPlausible(m) {
    const scaleAllowance = 0.05;
    const shiftAllowance = 0.05;
    const rotationAllowance = 0.05;
    const scaleX = Math.hypot(m[0], m[1]);
    const scaleY = Math.hypot(m[4], m[3]);
    const rotation = Math.atan2(m[3], m[0]) / Math.PI;
    const minScale = 1 - scaleAllowance;
    const maxScale = 1 / minScale;

    return (
      -shiftAllowance <= m[2] / width && m[2] / width <= shiftAllowance &&
      -shiftAllowance <= m[5] / height && m[5] / height <= shiftAllowance &&
      minScale <= scaleX && scaleX <= maxScale &&
      minScale <= scaleY && scaleY <= maxScale &&
      Math.abs(rotation) <= rotationAllowance
    );
  }

  function assertOrbApis(cv) {
    const missing = [];
    if (!cv.ORB && !cv.ORB_create) missing.push("ORB");
    if (!cv.BFMatcher) missing.push("BFMatcher");
    if (!cv.KeyPointVector) missing.push("KeyPointVector");
    if (!cv.DMatchVector) missing.push("DMatchVector");
    if (!cv.findHomography) missing.push("findHomography");
    if (!cv.matFromArray) missing.push("matFromArray");
    if (!cv.bilateralFilter) missing.push("bilateralFilter");
    if (!cv.createCLAHE && !cv.CLAHE) missing.push("CLAHE");
    if (!cv.Size) missing.push("Size");
    if (cv.CV_8UC1 === undefined) missing.push("CV_8UC1");
    if (cv.CV_32FC2 === undefined) missing.push("CV_32FC2");
    if (cv.NORM_HAMMING === undefined) missing.push("NORM_HAMMING");
    if (cv.RANSAC === undefined && cv.FM_RANSAC === undefined) missing.push("RANSAC");
    if (missing.length > 0) {
      throw new Error(`This OpenCV.js build is missing ORB APIs: ${missing.join(", ")}`);
    }
  }

  function cleanup() {
    ready = false;
    if (emptyMask) emptyMask.delete();
    if (matcher) matcher.delete();
    if (orb) orb.delete();
    emptyMask = null;
    matcher = null;
    orb = null;
    referenceGrayBytes = null;
    referenceExposureScalar = null;
  }

})();
