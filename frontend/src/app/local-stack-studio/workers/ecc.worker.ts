// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-nocheck
// Local Stack Studio ECC alignment worker. Built to public/generated/local-stack-studio.
import { loadWorkerOpenCv } from "./opencv-runtime";

(() => {
  "use strict";

  const ECC_BASE_AREA = 1_000_000;
  const ECC_MAX_PYRAMID_DOWNSAMPLES = 3;
  const ECC_MIN_COARSE_SHORT_SIDE = 96;
  const ECC_MAX_ITERATIONS = 100;
  const ECC_EPSILON = 1e-5;
  const ECC_GAUSSIAN_FILTER_SIZE = 5;
  const ECC_PRE_BLUR_SIZE = 5;
  const ECC_MAX_SCALE_DEVIATION = 0.25;
  const ECC_MAX_SHEAR_COSINE = 0.30;
  const ECC_MAX_TRANSLATION_DIAGONAL_RATIO = 0.35;
  const ALIGNMENT_EXPOSURE_MAX_GAIN = 16;
  const ALIGNMENT_EXPOSURE_SAMPLE_LIMIT = 65536;
  const ALIGNMENT_EXPOSURE_ROLLOFF_A = 0.5;
  const ALIGNMENT_EXPOSURE_ROLLOFF_OUTPUT_MAX = 1;
  const ALIGNMENT_EXPOSURE_ROLLOFF_SAVING_LIMIT_FACTOR = 4;
  const ECC_MASK_LOW_BYTE = 5;
  const ECC_MASK_HIGH_BYTE = 250;
  const ECC_MIN_MASK_RATIO = 0.02;
  const ECC_MIN_MASK_PIXELS = 1024;
  const SRGB_TO_LINEAR_LUT = buildSrgbToLinearLut();

  let cv = null;
  let width = 0;
  let height = 0;
  let workingWidth = 0;
  let workingHeight = 0;
  let referenceGrayBytes = null;
  let referenceExposureScalar = null;
  let ready = false;

  self.onmessage = async (event) => {
    const message = event.data || {};
    try {
      if (message.type === "init") {
        const result = await initialize(message);
        self.postMessage({
          type: "ready",
          requestId: message.requestId,
          workingWidth: result.workingWidth,
          workingHeight: result.workingHeight,
          pyramidLevels: result.pyramidLevels,
        });
        return;
      }

      if (message.type === "align") {
        if (!ready) throw new Error("ECC worker is not initialized.");
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
            correlation: result.correlation,
            workingWidth,
            workingHeight,
            pyramidLevels: result.pyramidLevels,
            scaleX: result.scaleX,
            scaleY: result.scaleY,
            shearCosine: result.shearCosine,
            translationRatio: result.translationRatio,
            referenceExposureGain: result.referenceExposureGain,
            targetExposureGain: result.targetExposureGain,
            exposureMatchSource: result.exposureMatchSource,
            maskCoverage: result.maskCoverage,
          },
          [result.matrix.buffer],
        );
      }
    } catch (error) {
      self.postMessage({
        type: "error",
        requestId: typeof message.requestId === "number" ? message.requestId : null,
        id: typeof message.id === "number" ? message.id : null,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  };

  async function initialize(message) {
    cleanup();
    width = Number(message.width);
    height = Number(message.height);
    if (!(Number.isInteger(width) && width > 0 && Number.isInteger(height) && height > 0)) {
      throw new Error("Invalid ECC reference image size.");
    }

    const bytes = new Uint8Array(message.grayBuffer);
    if (bytes.length !== width * height) {
      throw new Error(`Invalid ECC reference grayscale buffer size: ${bytes.length} vs ${width * height}.`);
    }

    cv = await loadWorkerOpenCv("ECC");
    assertEccApis(cv);
    const dimensions = eccWorkingDimensions(width, height);
    workingWidth = dimensions.width;
    workingHeight = dimensions.height;
    referenceGrayBytes = new Uint8Array(bytes);
    referenceExposureScalar = positiveExposureOrNull(message.exposureScalar);
    ready = true;
    return {
      workingWidth,
      workingHeight,
      pyramidLevels: countEccPyramidLevels(workingWidth, workingHeight),
    };
  }

  function alignTarget(grayBuffer, fileName, targetExposureScalar) {
    const bytes = new Uint8Array(grayBuffer);
    if (bytes.length !== width * height) {
      throw new Error(`Invalid ECC target grayscale buffer size for ${fileName}: ${bytes.length} vs ${width * height}.`);
    }

    const preprocessing = prepareEccPair(
      referenceGrayBytes,
      bytes,
      referenceExposureScalar,
      targetExposureScalar,
    );
    const referencePyramid = buildEccPyramid(preprocessing.referenceBytes);
    const targetPyramid = buildEccPyramid(preprocessing.targetBytes);
    const maskPyramid = buildMaskPyramid(preprocessing.maskBytes);
    let warp = null;
    let lastWidth = 0;
    let lastHeight = 0;
    let correlation = NaN;
    try {
      if (
        targetPyramid.length !== referencePyramid.length ||
        maskPyramid.length !== referencePyramid.length
      ) {
        throw new Error("ECC reference, target, and mask pyramids do not match.");
      }

      for (let level = referencePyramid.length - 1; level >= 0; level -= 1) {
        const reference = referencePyramid[level];
        const target = targetPyramid[level];
        const mask = maskPyramid[level];
        if (!warp) {
          warp = cv.matFromArray(2, 3, cv.CV_32F, [1, 0, 0, 0, 1, 0]);
        } else {
          const scaleX = reference.cols / lastWidth;
          const scaleY = reference.rows / lastHeight;
          rescaleAffineWarpInPlace(warp.data32F, scaleX, scaleY);
        }

        correlation = runFindTransformEcc(reference, target, warp, mask);
        if (!Number.isFinite(correlation)) {
          throw new Error(`ECC returned a non-finite correlation for ${fileName}.`);
        }
        lastWidth = reference.cols;
        lastHeight = reference.rows;
      }

      const workingForward = affine2x3ToMatrix3x3(warp.data32F);
      const fullForward = scaleAffineBetweenCoordinateSystems(
        workingForward,
        workingWidth / width,
        workingHeight / height,
      );
      const targetToReference = invertAffineMatrix3x3(fullForward);
      const metrics = validateEccTransform(targetToReference, width, height, fileName);
      return {
        matrix: new Float64Array(targetToReference),
        correlation,
        pyramidLevels: referencePyramid.length,
        referenceExposureGain: preprocessing.referenceExposureGain,
        targetExposureGain: preprocessing.targetExposureGain,
        exposureMatchSource: preprocessing.exposureMatchSource,
        maskCoverage: preprocessing.maskCoverage,
        ...metrics,
      };
    } finally {
      if (warp) warp.delete();
      deleteMatArray(referencePyramid);
      deleteMatArray(targetPyramid);
      deleteMatArray(maskPyramid);
    }
  }

  function prepareEccPair(referenceBytes, targetBytes, referenceExposure, targetExposure) {
    const exposure = resolvePairExposure(referenceBytes, targetBytes, referenceExposure, targetExposure);
    const referenceAdjusted = applyExposureToGrayBytes(referenceBytes, exposure.referenceGain);
    const targetAdjusted = applyExposureToGrayBytes(targetBytes, exposure.targetGain);
    const maskBytes = buildEccPairMask(referenceBytes, targetBytes, referenceAdjusted, targetAdjusted);
    return {
      referenceBytes: referenceAdjusted,
      targetBytes: targetAdjusted,
      maskBytes,
      maskCoverage: countMaskCoverage(maskBytes),
      referenceExposureGain: exposure.referenceGain,
      targetExposureGain: exposure.targetGain,
      exposureMatchSource: exposure.source,
    };
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
    return {
      referenceGain: clampExposureGain(midpoint / referenceLevel),
      targetGain: clampExposureGain(midpoint / targetLevel),
      source,
    };
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
    for (let i = offset; i < bytes.length; i += stride) histogram[bytes[i]] += 1;
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

  function applyExposureToGrayBytes(bytes, gain) {
    const adjustedGain = clampExposureGain(gain);
    const maxVal = adjustedGain > 1 ? estimateScaledLinearPercentile(bytes, adjustedGain, 0.998) : 0;
    const rolloff = alignmentExposureRolloffParams(maxVal);
    const lut = new Uint8Array(256);
    for (let value = 0; value < 256; value += 1) {
      let linear = SRGB_TO_LINEAR_LUT[value] * adjustedGain;
      if (rolloff) linear = applyAlignmentExposureRolloffScalar(linear, rolloff);
      lut[value] = linearToSrgbByte(linear);
    }
    const output = new Uint8Array(bytes.length);
    for (let i = 0; i < bytes.length; i += 1) output[i] = lut[bytes[i]];
    return output;
  }

  function alignmentExposureRolloffParams(maxVal) {
    if (!(Number.isFinite(maxVal) && maxVal > 1)) return null;
    const outputMax = ALIGNMENT_EXPOSURE_ROLLOFF_OUTPUT_MAX;
    const savingLimitValue = outputMax * ALIGNMENT_EXPOSURE_ROLLOFF_SAVING_LIMIT_FACTOR;
    let a = ALIGNMENT_EXPOSURE_ROLLOFF_A;
    if (maxVal > savingLimitValue) {
      a = Math.pow(a / outputMax, savingLimitValue / maxVal) * outputMax;
    }
    const inflection = a + (outputMax - a) * outputMax / maxVal;
    if (!(outputMax > inflection)) return null;
    return { inflection, inputMax: maxVal, outputMax };
  }

  function applyAlignmentExposureRolloffScalar(value, rolloff) {
    if (!rolloff || !Number.isFinite(value) || value <= rolloff.inflection) return value;
    const shoulder = rolloff.outputMax - rolloff.inflection;
    if (!(shoulder > 0)) return value;
    return rolloff.inflection
      + shoulder * (1 - Math.exp(-(value - rolloff.inflection) / shoulder));
  }

  function buildEccPairMask(referenceOriginal, targetOriginal, referenceAdjusted, targetAdjusted) {
    const mask = new Uint8Array(referenceOriginal.length);
    let valid = 0;
    for (let i = 0; i < mask.length; i += 1) {
      const isValid = isUsableEccMaskValue(referenceOriginal[i]) &&
        isUsableEccMaskValue(targetOriginal[i]) &&
        isUsableEccMaskValue(referenceAdjusted[i]) &&
        isUsableEccMaskValue(targetAdjusted[i]);
      if (isValid) {
        mask[i] = 255;
        valid += 1;
      }
    }
    if (valid < Math.max(ECC_MIN_MASK_PIXELS, Math.floor(mask.length * ECC_MIN_MASK_RATIO))) {
      mask.fill(255);
    }
    return mask;
  }

  function isUsableEccMaskValue(value) {
    return value >= ECC_MASK_LOW_BYTE && value <= ECC_MASK_HIGH_BYTE;
  }

  function countMaskCoverage(maskBytes) {
    let valid = 0;
    for (let i = 0; i < maskBytes.length; i += 1) {
      if (maskBytes[i] > 0) valid += 1;
    }
    return valid / Math.max(maskBytes.length, 1);
  }

  function runFindTransformEcc(reference, target, warp, mask) {
    const criteria = new cv.TermCriteria(
      cv.TermCriteria_COUNT | cv.TermCriteria_EPS,
      ECC_MAX_ITERATIONS,
      ECC_EPSILON,
    );
    try {
      return cv.findTransformECC(
        reference,
        target,
        warp,
        cv.MOTION_AFFINE,
        criteria,
        mask,
        ECC_GAUSSIAN_FILTER_SIZE,
      );
    } finally {
      if (criteria && typeof criteria.delete === "function") criteria.delete();
    }
  }

  function buildEccPyramid(grayBytes) {
    const source = new cv.Mat(height, width, cv.CV_8UC1);
    source.data.set(grayBytes);
    const pyramid = [];
    let resized = null;
    let smoothed = null;
    try {
      if (workingWidth === width && workingHeight === height) {
        resized = source.clone();
      } else {
        resized = new cv.Mat();
        cv.resize(source, resized, new cv.Size(workingWidth, workingHeight), 0, 0, cv.INTER_AREA);
      }
      smoothed = new cv.Mat();
      const borderType = cv.BORDER_DEFAULT !== undefined ? cv.BORDER_DEFAULT : 4;
      cv.GaussianBlur(
        resized,
        smoothed,
        new cv.Size(ECC_PRE_BLUR_SIZE, ECC_PRE_BLUR_SIZE),
        0,
        0,
        borderType,
      );
      pyramid.push(smoothed);
      smoothed = null;

      for (let downsample = 0; downsample < ECC_MAX_PYRAMID_DOWNSAMPLES; downsample += 1) {
        const previous = pyramid[pyramid.length - 1];
        const nextWidth = Math.ceil(previous.cols / 2);
        const nextHeight = Math.ceil(previous.rows / 2);
        if (Math.min(nextWidth, nextHeight) < ECC_MIN_COARSE_SHORT_SIDE) break;
        const next = new cv.Mat();
        cv.pyrDown(previous, next, new cv.Size(nextWidth, nextHeight));
        pyramid.push(next);
      }
      return pyramid;
    } catch (error) {
      if (resized) resized.delete();
      if (smoothed) smoothed.delete();
      deleteMatArray(pyramid);
      throw error;
    } finally {
      if (resized) resized.delete();
      source.delete();
    }
  }

  function buildMaskPyramid(maskBytes) {
    const source = new cv.Mat(height, width, cv.CV_8UC1);
    source.data.set(maskBytes);
    const pyramid = [];
    let working = null;
    try {
      if (workingWidth === width && workingHeight === height) {
        working = source.clone();
      } else {
        working = new cv.Mat();
        cv.resize(source, working, new cv.Size(workingWidth, workingHeight), 0, 0, cv.INTER_AREA);
        binarizeMaskMatInPlace(working);
      }
      pyramid.push(working);
      working = null;

      for (let downsample = 0; downsample < ECC_MAX_PYRAMID_DOWNSAMPLES; downsample += 1) {
        const previous = pyramid[pyramid.length - 1];
        const nextWidth = Math.ceil(previous.cols / 2);
        const nextHeight = Math.ceil(previous.rows / 2);
        if (Math.min(nextWidth, nextHeight) < ECC_MIN_COARSE_SHORT_SIDE) break;
        const next = new cv.Mat();
        cv.pyrDown(previous, next, new cv.Size(nextWidth, nextHeight));
        binarizeMaskMatInPlace(next);
        pyramid.push(next);
      }
      return pyramid;
    } catch (error) {
      if (working) working.delete();
      deleteMatArray(pyramid);
      throw error;
    } finally {
      source.delete();
    }
  }

  function binarizeMaskMatInPlace(mask) {
    const data = mask.data;
    for (let i = 0; i < data.length; i += 1) data[i] = data[i] >= 128 ? 255 : 0;
  }

  function countEccPyramidLevels(baseWidth, baseHeight) {
    let levels = 1;
    let cols = baseWidth;
    let rows = baseHeight;
    for (let downsample = 0; downsample < ECC_MAX_PYRAMID_DOWNSAMPLES; downsample += 1) {
      const nextWidth = Math.ceil(cols / 2);
      const nextHeight = Math.ceil(rows / 2);
      if (Math.min(nextWidth, nextHeight) < ECC_MIN_COARSE_SHORT_SIDE) break;
      levels += 1;
      cols = nextWidth;
      rows = nextHeight;
    }
    return levels;
  }

  function eccWorkingDimensions(imageWidth, imageHeight) {
    const area = imageWidth * imageHeight;
    if (area <= ECC_BASE_AREA) return { width: imageWidth, height: imageHeight };
    const scale = Math.sqrt(ECC_BASE_AREA / area);
    return {
      width: Math.max(1, Math.round(imageWidth * scale)),
      height: Math.max(1, Math.round(imageHeight * scale)),
    };
  }

  function rescaleAffineWarpInPlace(values, scaleX, scaleY) {
    if (!values || values.length < 6) throw new Error("ECC affine warp is invalid.");
    if (!(Number.isFinite(scaleX) && scaleX > 0 && Number.isFinite(scaleY) && scaleY > 0)) {
      throw new Error("ECC pyramid scale is invalid.");
    }
    values[1] *= scaleX / scaleY;
    values[2] *= scaleX;
    values[3] *= scaleY / scaleX;
    values[5] *= scaleY;
  }

  function affine2x3ToMatrix3x3(values) {
    if (!values || values.length < 6) throw new Error("ECC returned an invalid affine matrix.");
    return [
      Number(values[0]), Number(values[1]), Number(values[2]),
      Number(values[3]), Number(values[4]), Number(values[5]),
      0, 0, 1,
    ];
  }

  function scaleAffineBetweenCoordinateSystems(matrix, scaleX, scaleY) {
    if (!(Number.isFinite(scaleX) && scaleX > 0 && Number.isFinite(scaleY) && scaleY > 0)) {
      throw new Error("ECC working scale is invalid.");
    }
    return [
      matrix[0], matrix[1] * scaleY / scaleX, matrix[2] / scaleX,
      matrix[3] * scaleX / scaleY, matrix[4], matrix[5] / scaleY,
      0, 0, 1,
    ];
  }

  function invertAffineMatrix3x3(matrix) {
    const a = matrix[0];
    const b = matrix[1];
    const tx = matrix[2];
    const c = matrix[3];
    const d = matrix[4];
    const ty = matrix[5];
    const determinant = a * d - b * c;
    if (!(Number.isFinite(determinant) && Math.abs(determinant) > 1e-10)) {
      throw new Error("ECC produced a singular affine transform.");
    }
    const invDet = 1 / determinant;
    const ia = d * invDet;
    const ib = -b * invDet;
    const ic = -c * invDet;
    const id = a * invDet;
    return [
      ia, ib, -(ia * tx + ib * ty),
      ic, id, -(ic * tx + id * ty),
      0, 0, 1,
    ];
  }

  function validateEccTransform(matrix, imageWidth, imageHeight, fileName) {
    for (let i = 0; i < matrix.length; i += 1) {
      if (!Number.isFinite(matrix[i])) {
        throw new Error(`${fileName} ECC produced a non-finite affine transform.`);
      }
    }
    const a = matrix[0];
    const b = matrix[1];
    const tx = matrix[2];
    const c = matrix[3];
    const d = matrix[4];
    const ty = matrix[5];
    const determinant = a * d - b * c;
    if (!(determinant > 0)) {
      throw new Error(`${fileName} ECC produced a reflected or singular affine transform.`);
    }

    const scaleX = Math.hypot(a, c);
    const scaleY = Math.hypot(b, d);
    if (
      Math.abs(scaleX - 1) > ECC_MAX_SCALE_DEVIATION ||
      Math.abs(scaleY - 1) > ECC_MAX_SCALE_DEVIATION
    ) {
      throw new Error(
        `${fileName} ECC scale is implausible (${scaleX.toFixed(4)}, ${scaleY.toFixed(4)}).`,
      );
    }

    const shearCosine = Math.abs((a * b + c * d) / Math.max(scaleX * scaleY, 1e-12));
    if (shearCosine > ECC_MAX_SHEAR_COSINE) {
      throw new Error(`${fileName} ECC shear is implausible (${shearCosine.toFixed(4)}).`);
    }

    const diagonal = Math.hypot(imageWidth, imageHeight);
    const translationRatio = Math.hypot(tx, ty) / Math.max(diagonal, 1);
    if (translationRatio > ECC_MAX_TRANSLATION_DIAGONAL_RATIO) {
      throw new Error(
        `${fileName} ECC translation is implausible (${(translationRatio * 100).toFixed(1)}% of diagonal).`,
      );
    }

    return { scaleX, scaleY, shearCosine, translationRatio };
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

  function deleteMatArray(mats) {
    if (!Array.isArray(mats)) return;
    for (const mat of mats) if (mat) mat.delete();
  }

  function cleanup() {
    ready = false;
    width = 0;
    height = 0;
    workingWidth = 0;
    workingHeight = 0;
    referenceGrayBytes = null;
    referenceExposureScalar = null;
  }

  function assertEccApis(runtime) {
    const missing = [];
    if (!runtime.findTransformECC) missing.push("findTransformECC");
    if (!runtime.TermCriteria) missing.push("TermCriteria");
    if (runtime.TermCriteria_COUNT === undefined) missing.push("TermCriteria_COUNT");
    if (runtime.TermCriteria_EPS === undefined) missing.push("TermCriteria_EPS");
    if (runtime.MOTION_AFFINE === undefined) missing.push("MOTION_AFFINE");
    if (!runtime.resize) missing.push("resize");
    if (!runtime.pyrDown) missing.push("pyrDown");
    if (!runtime.GaussianBlur) missing.push("GaussianBlur");
    if (!runtime.matFromArray) missing.push("matFromArray");
    if (runtime.CV_8UC1 === undefined) missing.push("CV_8UC1");
    if (runtime.CV_32F === undefined) missing.push("CV_32F");
    if (runtime.INTER_AREA === undefined) missing.push("INTER_AREA");
    if (missing.length > 0) {
      throw new Error(`This OpenCV.js build is missing ECC APIs: ${missing.join(", ")}`);
    }
  }
})();
