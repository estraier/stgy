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
import {
  AlignmentImplementationError,
  alignmentErrorKind,
  wrapAlignmentImplementationError,
} from "./alignment-error";
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

  // 1MP affine initialization for ECC + 8MP ORB residual alignment.
  const ECC_BASE_AREA = 1_000_000;
  const ECC_MAX_PYRAMID_DOWNSAMPLES = 3;
  const ECC_MIN_COARSE_SHORT_SIDE = 96;
  // Final ECC mode favors robust coarse alignment over expensive full convergence.
  const ECC_CONVERGENCE = {
    coarseMaxIterations: 50,
    intermediateMaxIterations: 25,
    fineMaxIterations: 15,
    epsilon: 1e-4,
  };
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
  const convergence = ECC_CONVERGENCE;

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
        if (!ready) throw new AlignmentImplementationError("ECC worker is not initialized.");
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
        errorKind: alignmentErrorKind(error),
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

    try {
      cv = await loadWorkerOpenCv("ECC");
    } catch (error) {
      throw wrapAlignmentImplementationError(error);
    }
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


  function convergenceForLevel(level: number, levelCount: number): { maxIterations: number; epsilon: number } {
    // Level 0 is the finest. The coarsest level runs first. One-level
    // pyramids have no coarse-to-fine handoff, so use the final limit.
    const maxIterations = level === 0 ? convergence.fineMaxIterations :
      level === levelCount - 1 ? convergence.coarseMaxIterations :
        convergence.intermediateMaxIterations;
    return { maxIterations, epsilon: convergence.epsilon };
  }

  // OpenCV.js sometimes throws a plain object (or a numeric WASM exception
  // pointer) instead of an Error. Do not lose its useful fields in [object Object].
  function describeEccError(error: unknown): string {
    if (error instanceof Error) return `${error.name}: ${error.message}`;
    // OpenCV.js/Emscripten may throw a numeric pointer to a native cv::Exception.
    // String(error) only prints its WASM address, not its actual error code or message.
    if (typeof error === "number" && Number.isSafeInteger(error) && error > 0) {
      let nativeException: OpenCvDynamic | null = null;
      try {
        if (typeof cv?.exceptionFromPtr === "function") {
          nativeException = cv.exceptionFromPtr(error);
          const message = typeof cv.getExceptionMsg === "function"
            ? cv.getExceptionMsg(nativeException)
            : nativeException?.msg;
          const code = nativeException?.code;
          const details = [
            typeof code === "number" ? `OpenCV code=${code}` : null,
            typeof message === "string" && message.length ? message : null,
          ].filter((part): part is string => part !== null);
          if (details.length) return details.join("; ");
        }
        if (typeof cv?.getExceptionMessage === "function") {
          const description = cv.getExceptionMessage(error);
          if (Array.isArray(description)) return description.join(": ");
          if (typeof description === "string" && description.length) return description;
        }
      } catch (decodeError) {
        const detail = decodeError instanceof Error ? decodeError.message : String(decodeError);
        return `OpenCV native exception pointer ${error} (decode failed: ${detail})`;
      } finally {
        // exceptionFromPtr returns an Embind-managed *copy*, whose wrapper
        // must be deleted. Never free the original pointer here.
        if (nativeException && typeof nativeException.delete === "function") {
          nativeException.delete();
        }
      }
      return `OpenCV native exception pointer ${error} (exception decoder unavailable)`;
    }
    if (error && typeof error === "object") {
      const record = error as Record<string, unknown>;
      const descriptions: string[] = [];
      for (const name of ["name", "message", "msg", "what", "code"]) {
        const value = record[name];
        if (typeof value === "string" || typeof value === "number") {
          descriptions.push(`${name}=${String(value)}`);
        }
      }
      if (descriptions.length) return descriptions.join("; ");
      try {
        const text = JSON.stringify(error);
        if (text && text !== "{}") return text;
      } catch {
        // Some browser/OpenCV objects cannot be serialized.
      }
    }
    return String(error);
  }

  function alignTarget(grayBuffer: ArrayBuffer, fileName: string, targetExposureScalar: number | null) {
    const stage = { name: "not started" };
    try {
      return alignTargetMeasured(grayBuffer, fileName, targetExposureScalar, stage);
    } catch (error) {
      const explanation = `${fileName}: ECC failed at ${stage.name}: ${describeEccError(error)}`;
      if (error instanceof AlignmentImplementationError) {
        throw new AlignmentImplementationError(explanation);
      }
      throw new Error(explanation);
    }
  }

  function alignTargetMeasured(
    grayBuffer: ArrayBuffer,
    fileName: string,
    targetExposureScalar: number | null,
    stage: { name: string },
  ) {
    stage.name = "validate-target-input";
    const bytes = new Uint8Array(grayBuffer);
    if (bytes.length !== width * height) {
      throw new Error(`Invalid ECC target grayscale buffer size for ${fileName}: ${bytes.length} vs ${width * height}.`);
    }

    if (!referenceGrayBytes) throw new AlignmentImplementationError("ECC reference grayscale buffer is unavailable.");
    stage.name = "preprocess";
    const preprocessing = prepareEccPair(
      referenceGrayBytes,
      bytes,
      referenceExposureScalar,
      targetExposureScalar,
    );
    // Enter the cleanup scope BEFORE allocating any of the three pyramids.
    // A failure in the second/third pyramid must release the earlier ones.
    let referencePyramid: OpenCvDynamic[] | null = null;
    let targetPyramid: OpenCvDynamic[] | null = null;
    let maskPyramid: OpenCvDynamic[] | null = null;
    let warp: OpenCvDynamic | null = null;
    let lastWidth = 0;
    let lastHeight = 0;
    let correlation = NaN;
    let initialCorrelation = NaN;
    try {
      stage.name = "reference-pyramid";
      referencePyramid = buildEccPyramid(preprocessing.referenceBytes);
      preprocessing.referenceBytes = new Uint8Array(0); // Release transient exposure-adjusted bytes.

      stage.name = "target-pyramid";
      targetPyramid = buildEccPyramid(preprocessing.targetBytes);
      preprocessing.targetBytes = new Uint8Array(0);

      stage.name = "mask-pyramid";
      maskPyramid = buildMaskPyramid(preprocessing.maskBytes);
      preprocessing.maskBytes = new Uint8Array(0);

      if (
        targetPyramid.length !== referencePyramid.length ||
        maskPyramid.length !== referencePyramid.length
      ) {
        throw new Error("ECC reference, target, and mask pyramids do not match.");
      }

      stage.name = "initial-correlation";
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
        stage.name = `ecc-level-${level} (${reference.cols}x${reference.rows})`;
        try {
          if (!warp) {
            warp = cv.matFromArray(2, 3, cv.CV_32F, [1, 0, 0, 0, 1, 0]);
          } else {
            const scaleX = reference.cols / lastWidth;
            const scaleY = reference.rows / lastHeight;
            rescaleAffineWarpInPlace(warp.data32F, scaleX, scaleY);
          }

          const criteria = convergenceForLevel(level, referencePyramid.length);
          correlation = runFindTransformEcc(reference, target, warp, mask,
            criteria.maxIterations, criteria.epsilon);
          if (!Number.isFinite(correlation)) {
            throw new Error(`ECC returned a non-finite correlation for ${fileName}.`);
          }
          lastWidth = reference.cols;
          lastHeight = reference.rows;
        } finally {
          // This level is never accessed again: release all three Mats before
          // moving to the next (finer) level. Keep the array lengths unchanged.
          referencePyramid[level] = null;
          targetPyramid[level] = null;
          maskPyramid[level] = null;
          reference.delete();
          target.delete();
          mask.delete();
        }
      }

      stage.name = "validate-final-transform";
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
      stage.name = "completed";
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
      referencePyramid = null;
      targetPyramid = null;
      maskPyramid = null;
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
    let referenceFiltered: OpenCvDynamic | null = null;
    let targetFiltered: OpenCvDynamic | null = null;
    try {
      referenceFiltered = new cv.Mat();
      targetFiltered = new cv.Mat();
      const kernel = new cv.Size(ECC_GAUSSIAN_FILTER_SIZE, ECC_GAUSSIAN_FILTER_SIZE);
      const borderType = cv.BORDER_DEFAULT !== undefined ? cv.BORDER_DEFAULT : 4;
      cv.GaussianBlur(reference, referenceFiltered, kernel, 0, 0, borderType);
      cv.GaussianBlur(target, targetFiltered, kernel, 0, 0, borderType);
      return computeMaskedCorrelation(referenceFiltered, targetFiltered, mask);
    } finally {
      targetFiltered?.delete();
      referenceFiltered?.delete();
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


  function runFindTransformEcc(reference: OpenCvDynamic, target: OpenCvDynamic, warp: OpenCvDynamic,
    mask: OpenCvDynamic, maxIterations: number, epsilon: number): number {
    // The unified @banou/opencv-wasm binding accepts cv::TermCriteria as a
    // JavaScript value object, not an OpenCV.js `new cv.TermCriteria()` handle.
    // OpenCV's COUNT=1 and EPS=2 flags are stable enum values. A value object
    // does not allocate a WASM handle and must not be deleted.
    const criteria = { type: 1 | 2, maxCount: maxIterations, epsilon };
    return cv.findTransformECC(
      reference,
      target,
      warp,
      cv.MOTION_AFFINE,
      criteria,
      mask,
      ECC_GAUSSIAN_FILTER_SIZE,
    );
  }

  function buildEccPyramid(grayBytes: Uint8Array): OpenCvDynamic[] {
    const pyramid: OpenCvDynamic[] = [];
    let source: OpenCvDynamic | null = null;
    try {
      source = new cv.Mat(height, width, cv.CV_8UC1);
      source.data.set(grayBytes);
      if (workingWidth !== width || workingHeight !== height) {
        const resized = new cv.Mat();
        try {
          cv.resize(source, resized, new cv.Size(workingWidth, workingHeight), 0, 0, cv.INTER_AREA);
        } catch (error) {
          resized.delete();
          throw error;
        }
        source.delete();
        source = resized;
      }
      // GaussianBlur supports in-place processing, avoiding both the original
      // full-size clone and a separate full-size smoothed image.
      const borderType = cv.BORDER_DEFAULT !== undefined ? cv.BORDER_DEFAULT : 4;
      cv.GaussianBlur(source, source,
        new cv.Size(ECC_PRE_BLUR_SIZE, ECC_PRE_BLUR_SIZE), 0, 0, borderType);
      pyramid.push(source);
      source = null; // Pyramid now owns this Mat.

      for (let downsample = 0; downsample < ECC_MAX_PYRAMID_DOWNSAMPLES; downsample += 1) {
        const previous = pyramid[pyramid.length - 1];
        const nextWidth = Math.ceil(previous.cols / 2);
        const nextHeight = Math.ceil(previous.rows / 2);
        if (Math.min(nextWidth, nextHeight) < ECC_MIN_COARSE_SHORT_SIDE) break;
        const next = new cv.Mat();
        try {
          cv.pyrDown(previous, next, new cv.Size(nextWidth, nextHeight));
          pyramid.push(next);
        } catch (error) {
          next.delete();
          throw error;
        }
      }
      return pyramid;
    } catch (error) {
      deleteMatArray(pyramid);
      throw error;
    } finally {
      source?.delete();
    }
  }

  function buildMaskPyramid(maskBytes: Uint8Array): OpenCvDynamic[] {
    const pyramid: OpenCvDynamic[] = [];
    let source: OpenCvDynamic | null = null;
    try {
      source = new cv.Mat(height, width, cv.CV_8UC1);
      source.data.set(maskBytes);
      if (workingWidth !== width || workingHeight !== height) {
        const resized = new cv.Mat();
        try {
          cv.resize(source, resized, new cv.Size(workingWidth, workingHeight), 0, 0, cv.INTER_AREA);
          binarizeMaskMatInPlace(resized);
        } catch (error) {
          resized.delete();
          throw error;
        }
        source.delete();
        source = resized;
      }
      // The mask is already binary: no need to clone it at equal dimensions.
      pyramid.push(source);
      source = null;

      for (let downsample = 0; downsample < ECC_MAX_PYRAMID_DOWNSAMPLES; downsample += 1) {
        const previous = pyramid[pyramid.length - 1];
        const nextWidth = Math.ceil(previous.cols / 2);
        const nextHeight = Math.ceil(previous.rows / 2);
        if (Math.min(nextWidth, nextHeight) < ECC_MIN_COARSE_SHORT_SIDE) break;
        const next = new cv.Mat();
        try {
          cv.pyrDown(previous, next, new cv.Size(nextWidth, nextHeight));
          binarizeMaskMatInPlace(next);
          pyramid.push(next);
        } catch (error) {
          next.delete();
          throw error;
        }
      }
      return pyramid;
    } catch (error) {
      deleteMatArray(pyramid);
      throw error;
    } finally {
      source?.delete();
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
    if (runtime.MOTION_AFFINE === undefined) missing.push("MOTION_AFFINE");
    if (!runtime.resize) missing.push("resize");
    if (!runtime.pyrDown) missing.push("pyrDown");
    if (!runtime.GaussianBlur) missing.push("GaussianBlur");
    if (!runtime.matFromArray) missing.push("matFromArray");
    if (runtime.CV_8UC1 === undefined) missing.push("CV_8UC1");
    if (runtime.CV_32F === undefined) missing.push("CV_32F");
    if (runtime.INTER_AREA === undefined) missing.push("INTER_AREA");
    if (missing.length > 0) {
      throw new AlignmentImplementationError(`The native OpenCV build is missing ECC APIs: ${missing.join(", ")}`);
    }
  }
})();
