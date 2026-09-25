// Local Stack Studio ECC alignment worker. Built to public/generated/local-stack-studio.
import {
  loadWorkerOpenCv,
  type OpenCvDynamic,
  type OpenCvRuntime,
} from "./opencv-runtime";
import {
  positiveExposureOrNull,
  prepareAlignmentExposurePair,
  type AlignmentExposureMatchSource,
} from "./alignment-preprocess";
import { transferableBuffer } from "./transfer-buffer";
import type {
  AlignmentInitRequest,
  AlignmentWorkerRequest,
  EccReadyResponse,
  EccResultResponse,
  EccWorkerResponse,
} from "./protocols/alignment-protocol";

(() => {
  "use strict";

  type WorkerScope = {
    onmessage: ((event: MessageEvent<AlignmentWorkerRequest>) => void | Promise<void>) | null;
    postMessage: (message: EccWorkerResponse, transfer?: Transferable[]) => void;
  };
  const workerScope = globalThis as unknown as WorkerScope;

  type EccPreprocessing = {
    referenceBytes: Uint8Array;
    targetBytes: Uint8Array;
    maskBytes: Uint8Array;
    maskCoverage: number;
    referenceExposureGain: number;
    targetExposureGain: number;
    exposureMatchSource: AlignmentExposureMatchSource;
  };
  type EccTransformMetrics = {
    scaleX: number;
    scaleY: number;
    shearCosine: number;
    translationRatio: number;
  };

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
  const ECC_MIN_FINAL_CORRELATION = 0.65;
  const ECC_HIGH_INITIAL_CORRELATION = 0.90;
  const ECC_MIN_CORRELATION_IMPROVEMENT = 0.01;
  const ECC_MAX_CORRELATION_REGRESSION = 0.002;
  const ECC_IDENTITY_TRANSLATION_RATIO = 0.001;
  const ECC_IDENTITY_SCALE_DEVIATION = 0.0015;
  const ECC_IDENTITY_SHEAR_COSINE = 0.002;
  const ECC_IDENTITY_ROTATION_RADIANS = 0.001;
  const ECC_MASK_LOW_BYTE = 5;
  const ECC_MASK_HIGH_BYTE = 250;
  const ECC_MIN_MASK_RATIO = 0.02;
  const ECC_MIN_MASK_PIXELS = 1024;

  let cv: OpenCvRuntime;
  let width = 0;
  let height = 0;
  let workingWidth = 0;
  let workingHeight = 0;
  let referenceGrayBytes: Uint8Array | null = null;
  let referenceExposureScalar: number | null = null;
  let ready = false;

  workerScope.onmessage = async (event: MessageEvent<AlignmentWorkerRequest>) => {
    const message = event.data;
    try {
      if (message.type === "init") {
        const result = await initialize(message);
        const response: EccReadyResponse = {
          type: "ready",
          requestId: message.requestId,
          workingWidth: result.workingWidth,
          workingHeight: result.workingHeight,
          pyramidLevels: result.pyramidLevels,
        };
        workerScope.postMessage(response);
        return;
      }

      if (message.type === "align") {
        if (!ready) throw new Error("ECC worker is not initialized.");
        const result = alignTarget(
          message.grayBuffer,
          message.fileName || `image ${message.id}`,
          message.exposureScalar,
        );
        const matrixBuffer = transferableBuffer(result.matrix);
        const response: EccResultResponse = {
            type: "result",
            requestId: message.requestId,
            id: message.id,
            fileName: message.fileName,
            matrixBuffer,
            correlation: result.correlation,
            initialCorrelation: result.initialCorrelation,
            correlationImprovement: result.correlationImprovement,
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
          };
        workerScope.postMessage(response, [matrixBuffer]);
      }
    } catch (error) {
      workerScope.postMessage({
        type: "error",
        requestId: message.requestId,
        id: message.type === "align" ? message.id : null,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  };

  async function initialize(message: AlignmentInitRequest) {
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

  function alignTarget(grayBuffer: ArrayBuffer, fileName: string, targetExposureScalar: number | null) {
    const bytes = new Uint8Array(grayBuffer);
    if (bytes.length !== width * height) {
      throw new Error(`Invalid ECC target grayscale buffer size for ${fileName}: ${bytes.length} vs ${width * height}.`);
    }

    if (!referenceGrayBytes) throw new Error("ECC reference grayscale buffer is unavailable.");
    const preprocessing = prepareEccPair(
      referenceGrayBytes,
      bytes,
      referenceExposureScalar,
      targetExposureScalar,
    );
    const referencePyramid = buildEccPyramid(preprocessing.referenceBytes);
    const targetPyramid = buildEccPyramid(preprocessing.targetBytes);
    const maskPyramid = buildMaskPyramid(preprocessing.maskBytes);
    let warp: OpenCvDynamic | null = null;
    let lastWidth = 0;
    let lastHeight = 0;
    let correlation = NaN;
    let initialCorrelation = NaN;
    try {
      if (
        targetPyramid.length !== referencePyramid.length ||
        maskPyramid.length !== referencePyramid.length
      ) {
        throw new Error("ECC reference, target, and mask pyramids do not match.");
      }

      initialCorrelation = computeInitialEccCorrelation(
        referencePyramid[0],
        targetPyramid[0],
        maskPyramid[0],
      );
      if (!Number.isFinite(initialCorrelation)) {
        throw new Error(`${fileName} ECC could not measure the initial image correlation.`);
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
      const correlationImprovement = validateEccConfidence(
        initialCorrelation,
        correlation,
        targetToReference,
        metrics,
        fileName,
      );
      return {
        matrix: new Float64Array(targetToReference),
        correlation,
        initialCorrelation,
        correlationImprovement,
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

  function prepareEccPair(
    referenceBytes: Uint8Array,
    targetBytes: Uint8Array,
    referenceExposure: number | null,
    targetExposure: number | null,
  ): EccPreprocessing {
    const exposure = prepareAlignmentExposurePair(
      referenceBytes,
      targetBytes,
      referenceExposure,
      targetExposure,
    );
    const maskBytes = buildEccPairMask(
      referenceBytes,
      targetBytes,
      exposure.referenceBytes,
      exposure.targetBytes,
    );
    return {
      referenceBytes: exposure.referenceBytes,
      targetBytes: exposure.targetBytes,
      maskBytes,
      maskCoverage: countMaskCoverage(maskBytes),
      referenceExposureGain: exposure.referenceExposureGain,
      targetExposureGain: exposure.targetExposureGain,
      exposureMatchSource: exposure.exposureMatchSource,
    };
  }

  function buildEccPairMask(referenceOriginal: Uint8Array, targetOriginal: Uint8Array, referenceAdjusted: Uint8Array, targetAdjusted: Uint8Array): Uint8Array {
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

  function isUsableEccMaskValue(value: number): boolean {
    return value >= ECC_MASK_LOW_BYTE && value <= ECC_MASK_HIGH_BYTE;
  }

  function countMaskCoverage(maskBytes: Uint8Array): number {
    let valid = 0;
    for (let i = 0; i < maskBytes.length; i += 1) {
      if (maskBytes[i] > 0) valid += 1;
    }
    return valid / Math.max(maskBytes.length, 1);
  }

  function computeInitialEccCorrelation(reference: OpenCvDynamic, target: OpenCvDynamic, mask: OpenCvDynamic): number {
    if (ECC_GAUSSIAN_FILTER_SIZE <= 1) {
      return computeMaskedCorrelation(reference, target, mask);
    }
    const referenceFiltered = new cv.Mat();
    const targetFiltered = new cv.Mat();
    const kernel = new cv.Size(ECC_GAUSSIAN_FILTER_SIZE, ECC_GAUSSIAN_FILTER_SIZE);
    const borderType = cv.BORDER_DEFAULT !== undefined ? cv.BORDER_DEFAULT : 4;
    try {
      cv.GaussianBlur(reference, referenceFiltered, kernel, 0, 0, borderType);
      cv.GaussianBlur(target, targetFiltered, kernel, 0, 0, borderType);
      return computeMaskedCorrelation(referenceFiltered, targetFiltered, mask);
    } finally {
      targetFiltered.delete();
      referenceFiltered.delete();
    }
  }

  function computeMaskedCorrelation(reference: OpenCvDynamic, target: OpenCvDynamic, mask: OpenCvDynamic): number {
    if (
      reference.rows !== target.rows || reference.cols !== target.cols ||
      reference.rows !== mask.rows || reference.cols !== mask.cols
    ) {
      throw new Error("ECC correlation inputs do not have matching dimensions.");
    }
    const referenceData = reference.data;
    const targetData = target.data;
    const maskData = mask.data;
    let count = 0;
    let sumReference = 0;
    let sumTarget = 0;
    let sumReferenceSq = 0;
    let sumTargetSq = 0;
    let sumProduct = 0;
    for (let i = 0; i < referenceData.length; i += 1) {
      if (maskData[i] === 0) continue;
      const referenceValue = referenceData[i];
      const targetValue = targetData[i];
      count += 1;
      sumReference += referenceValue;
      sumTarget += targetValue;
      sumReferenceSq += referenceValue * referenceValue;
      sumTargetSq += targetValue * targetValue;
      sumProduct += referenceValue * targetValue;
    }
    if (count < 2) return NaN;
    const covariance = count * sumProduct - sumReference * sumTarget;
    const referenceVariance = count * sumReferenceSq - sumReference * sumReference;
    const targetVariance = count * sumTargetSq - sumTarget * sumTarget;
    const denominator = Math.sqrt(Math.max(0, referenceVariance) * Math.max(0, targetVariance));
    if (!(denominator > 0)) return NaN;
    return Math.max(-1, Math.min(1, covariance / denominator));
  }

  function validateEccConfidence(initialCorrelation: number, finalCorrelation: number, matrix: ArrayLike<number>, metrics: EccTransformMetrics, fileName: string): number {
    if (!(Number.isFinite(initialCorrelation) && Number.isFinite(finalCorrelation))) {
      throw new Error(`${fileName} ECC correlation confidence is not finite.`);
    }
    const improvement = finalCorrelation - initialCorrelation;
    if (finalCorrelation < ECC_MIN_FINAL_CORRELATION) {
      throw new Error(
        `${fileName} ECC correlation is too low (${finalCorrelation.toFixed(4)} < ` +
        `${ECC_MIN_FINAL_CORRELATION.toFixed(2)}; initial=${initialCorrelation.toFixed(4)}).`,
      );
    }
    if (improvement < -ECC_MAX_CORRELATION_REGRESSION) {
      throw new Error(
        `${fileName} ECC reduced correlation (${initialCorrelation.toFixed(4)} -> ` +
        `${finalCorrelation.toFixed(4)}).`,
      );
    }

    const rotationRadians = Math.abs(Math.atan2(matrix[3], matrix[0]));
    const significantTransform =
      metrics.translationRatio > ECC_IDENTITY_TRANSLATION_RATIO ||
      Math.abs(metrics.scaleX - 1) > ECC_IDENTITY_SCALE_DEVIATION ||
      Math.abs(metrics.scaleY - 1) > ECC_IDENTITY_SCALE_DEVIATION ||
      metrics.shearCosine > ECC_IDENTITY_SHEAR_COSINE ||
      rotationRadians > ECC_IDENTITY_ROTATION_RADIANS;
    if (
      significantTransform &&
      initialCorrelation < ECC_HIGH_INITIAL_CORRELATION &&
      improvement < ECC_MIN_CORRELATION_IMPROVEMENT
    ) {
      throw new Error(
        `${fileName} ECC correlation improvement is too small for a non-trivial transform (` +
        `${initialCorrelation.toFixed(4)} -> ${finalCorrelation.toFixed(4)}, ` +
        `delta=${improvement.toFixed(4)}).`,
      );
    }
    return improvement;
  }

  function runFindTransformEcc(reference: OpenCvDynamic, target: OpenCvDynamic, warp: OpenCvDynamic, mask: OpenCvDynamic): number {
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

  function buildEccPyramid(grayBytes: Uint8Array): OpenCvDynamic[] {
    const source = new cv.Mat(height, width, cv.CV_8UC1);
    source.data.set(grayBytes);
    const pyramid: OpenCvDynamic[] = [];
    let resized: OpenCvDynamic | null = null;
    let smoothed: OpenCvDynamic | null = null;
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

  function buildMaskPyramid(maskBytes: Uint8Array): OpenCvDynamic[] {
    const source = new cv.Mat(height, width, cv.CV_8UC1);
    source.data.set(maskBytes);
    const pyramid: OpenCvDynamic[] = [];
    let working: OpenCvDynamic | null = null;
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

  function binarizeMaskMatInPlace(mask: OpenCvDynamic): void {
    const data = mask.data;
    for (let i = 0; i < data.length; i += 1) data[i] = data[i] >= 128 ? 255 : 0;
  }

  function countEccPyramidLevels(baseWidth: number, baseHeight: number): number {
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

  function eccWorkingDimensions(imageWidth: number, imageHeight: number): { width: number; height: number } {
    const area = imageWidth * imageHeight;
    if (area <= ECC_BASE_AREA) return { width: imageWidth, height: imageHeight };
    const scale = Math.sqrt(ECC_BASE_AREA / area);
    return {
      width: Math.max(1, Math.round(imageWidth * scale)),
      height: Math.max(1, Math.round(imageHeight * scale)),
    };
  }

  function rescaleAffineWarpInPlace(values: Float32Array, scaleX: number, scaleY: number): void {
    if (!values || values.length < 6) throw new Error("ECC affine warp is invalid.");
    if (!(Number.isFinite(scaleX) && scaleX > 0 && Number.isFinite(scaleY) && scaleY > 0)) {
      throw new Error("ECC pyramid scale is invalid.");
    }
    values[1] *= scaleX / scaleY;
    values[2] *= scaleX;
    values[3] *= scaleY / scaleX;
    values[5] *= scaleY;
  }

  function affine2x3ToMatrix3x3(values: ArrayLike<number>): number[] {
    if (!values || values.length < 6) throw new Error("ECC returned an invalid affine matrix.");
    return [
      Number(values[0]), Number(values[1]), Number(values[2]),
      Number(values[3]), Number(values[4]), Number(values[5]),
      0, 0, 1,
    ];
  }

  function scaleAffineBetweenCoordinateSystems(matrix: ArrayLike<number>, scaleX: number, scaleY: number): number[] {
    if (!(Number.isFinite(scaleX) && scaleX > 0 && Number.isFinite(scaleY) && scaleY > 0)) {
      throw new Error("ECC working scale is invalid.");
    }
    return [
      matrix[0], matrix[1] * scaleY / scaleX, matrix[2] / scaleX,
      matrix[3] * scaleX / scaleY, matrix[4], matrix[5] / scaleY,
      0, 0, 1,
    ];
  }

  function invertAffineMatrix3x3(matrix: ArrayLike<number>): number[] {
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

  function validateEccTransform(matrix: ArrayLike<number>, imageWidth: number, imageHeight: number, fileName: string): EccTransformMetrics {
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

  function deleteMatArray(mats: OpenCvDynamic[] | null): void {
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

  function assertEccApis(runtime: OpenCvRuntime): void {
    const missing: string[] = [];
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
