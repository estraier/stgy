// Local Stack Studio worker source. Built to public/generated/local-stack-studio.
import {
  loadWorkerOpenCv,
  type OpenCvDynamic,
  type OpenCvRuntime,
} from "./opencv-runtime";
import {
  applyAlignmentExposureToGrayBytes,
  positiveExposureOrNull,
  prepareAlignmentExposurePair,
  type AlignmentExposureMatchSource,
} from "./alignment-preprocess";
import { transferableBuffer } from "./transfer-buffer";
import type {
  AlignmentInitRequest,
  AlignmentWorkerRequest,
  OrbFallbackMode,
  OrbReadyResponse,
  OrbResultResponse,
  OrbWorkerResponse,
} from "./protocols/alignment-protocol";

(() => {
  "use strict";

  type WorkerScope = {
    onmessage: ((event: MessageEvent<AlignmentWorkerRequest>) => void | Promise<void>) | null;
    postMessage: (message: OrbWorkerResponse, transfer?: Transferable[]) => void;
  };
  const workerScope = globalThis as unknown as WorkerScope;

  type MatchCandidate = {
    referenceX: number;
    referenceY: number;
    targetX: number;
    targetY: number;
    distance: number;
  };
  type ReprojectionStats = {
    inlierCount: number;
    medianError: number;
    p95Error: number;
  };
  type PartialAffineEstimate = {
    matrix: Float64Array;
    reprojection: ReprojectionStats;
  };
  type OrbPreprocessing = {
    referenceGray: OpenCvDynamic;
    targetGray: OpenCvDynamic;
    referenceExposureGain: number;
    targetExposureGain: number;
    exposureMatchSource: AlignmentExposureMatchSource;
  };

  type OrbAlignmentComputationResult = {
    matrix: Float64Array;
    referenceFeatureCount: number;
    targetFeatureCount: number;
    matchCount: number;
    usableMatchCount: number;
    matchShiftLimit: number;
    fallbackMode: OrbFallbackMode;
    reprojectionInlierCount: number;
    reprojectionMedianError: number;
    reprojectionP95Error: number;
    referenceExposureGain: number;
    targetExposureGain: number;
    exposureMatchSource: AlignmentExposureMatchSource;
    claheClipLimit: number;
  };

  const ORB_MAX_FEATURES = 5000;
  const ORB_MATCH_SHIFT_LIMIT = 0.10;
  const ORB_FALLBACK_MATCH_SHIFT_LIMIT = 0.20;
  const ORB_MIN_GOOD_MATCHES = 11;
  const ORB_MIN_FALLBACK_MATCHES = 6;
  const ORB_RANSAC_REPROJECTION_THRESHOLD = 5.0;
  const ORB_RANSAC_MAX_ITERATIONS = 2000;
  const ORB_FALLBACK_MEDIAN_REPROJECTION_ERROR = 3.0;
  const ORB_FALLBACK_P95_REPROJECTION_ERROR = 10.0;
  const ALIGNMENT_BILATERAL_DIAMETER = 5;
  const ALIGNMENT_BILATERAL_SIGMA_COLOR = 20;
  const ALIGNMENT_BILATERAL_SIGMA_SPACE = 10;
  const ALIGNMENT_CLAHE_CLIP_LIMIT = 1.0;
  const ALIGNMENT_CLAHE_TILE_GRID = 8;

  let cv: OpenCvRuntime;
  let orb: OpenCvDynamic = null;
  let matcher: OpenCvDynamic = null;
  let emptyMask: OpenCvDynamic = null;
  let referenceGrayBytes: Uint8Array | null = null;
  let referenceExposureScalar: number | null = null;
  let width = 0;
  let height = 0;
  let ready = false;

  workerScope.onmessage = async (event: MessageEvent<AlignmentWorkerRequest>) => {
    const message = event.data;
    try {
      if (message.type === "init") {
        const referenceFeatureCount = await initialize(message);
        const response: OrbReadyResponse = {
          type: "ready",
          requestId: message.requestId,
          referenceFeatureCount,
        };
        workerScope.postMessage(response);
        return;
      }

      if (message.type === "align") {
        if (!ready) throw new Error("ORB worker is not initialized.");
        const result = alignTarget(
          message.grayBuffer,
          message.fileName || `image ${message.id}`,
          message.exposureScalar,
        );
        const matrixBuffer = transferableBuffer(result.matrix);
        const response: OrbResultResponse = {
            type: "result",
            requestId: message.requestId,
            id: message.id,
            fileName: message.fileName,
            matrixBuffer,
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

    const baselineGray = preprocessAlignmentGray(applyAlignmentExposureToGrayBytes(referenceGrayBytes, 1));
    try {
      const referenceFeatureCount = countOrbFeatures(baselineGray);
      ready = true;
      return referenceFeatureCount;
    } finally {
      baselineGray.delete();
    }
  }

  function alignTarget(grayBuffer: ArrayBuffer, fileName: string, targetExposureScalar: number | null): OrbAlignmentComputationResult {
    const targetGrayBytes = new Uint8Array(grayBuffer);
    if (targetGrayBytes.length !== width * height) {
      throw new Error(`Invalid target grayscale buffer size: ${targetGrayBytes.length} vs ${width * height}.`);
    }

    if (!referenceGrayBytes) throw new Error("ORB reference grayscale buffer is unavailable.");
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

  function estimateAlignment(candidates: MatchCandidate[], validateLowMatchFallback: boolean): PartialAffineEstimate {
    const matrix = estimatePartialAffineRansac(candidates);
    if (!isPartialAffinePlausible(matrix)) {
      throw new Error("ORB produced an implausible partial affine transform.");
    }

    const reprojection = measureReprojectionErrors(matrix, candidates);
    if (validateLowMatchFallback) {
      validateFallbackReprojection(reprojection);
    }

    return { matrix, reprojection };
  }

  function estimatePartialAffineRansac(candidates: MatchCandidate[]): Float64Array {
    if (!Array.isArray(candidates) || candidates.length < 2) {
      throw new Error("ORB needs at least two matches for a partial affine transform.");
    }

    const thresholdSq = ORB_RANSAC_REPROJECTION_THRESHOLD * ORB_RANSAC_REPROJECTION_THRESHOLD;
    const count = candidates.length;
    const maxIterations = Math.min(
      ORB_RANSAC_MAX_ITERATIONS,
      Math.max(1, count * (count - 1) / 2),
    );
    let bestModel = null;
    let bestInlierCount = -1;
    let bestInlierError = Number.POSITIVE_INFINITY;

    if (count * (count - 1) / 2 <= ORB_RANSAC_MAX_ITERATIONS) {
      outer:
      for (let i = 0; i < count - 1; i += 1) {
        for (let j = i + 1; j < count; j += 1) {
          const model = partialAffineFromTwoMatches(candidates[i], candidates[j]);
          if (!model) continue;
          const score = scorePartialAffineModel(model, candidates, thresholdSq);
          if (
            score.inlierCount > bestInlierCount ||
            (score.inlierCount === bestInlierCount && score.inlierError < bestInlierError)
          ) {
            bestModel = model;
            bestInlierCount = score.inlierCount;
            bestInlierError = score.inlierError;
            if (bestInlierCount === count) break outer;
          }
        }
      }
    } else {
      let state = (0x9e3779b9 ^ count) >>> 0;
      for (let iteration = 0; iteration < maxIterations; iteration += 1) {
        state = nextRansacState(state);
        const i = state % count;
        state = nextRansacState(state);
        let j = state % count;
        if (j === i) j = (j + 1) % count;
        const model = partialAffineFromTwoMatches(candidates[i], candidates[j]);
        if (!model) continue;
        const score = scorePartialAffineModel(model, candidates, thresholdSq);
        if (
          score.inlierCount > bestInlierCount ||
          (score.inlierCount === bestInlierCount && score.inlierError < bestInlierError)
        ) {
          bestModel = model;
          bestInlierCount = score.inlierCount;
          bestInlierError = score.inlierError;
          if (bestInlierCount === count) break;
        }
      }
    }

    if (!bestModel || bestInlierCount < 2) {
      throw new Error("ORB could not estimate a partial affine transform.");
    }

    const inliers = collectPartialAffineInliers(bestModel, candidates, thresholdSq);
    let refined = fitPartialAffineLeastSquares(inliers);
    if (!refined) refined = bestModel;

    const refinedInliers = collectPartialAffineInliers(refined, candidates, thresholdSq);
    if (refinedInliers.length >= 2) {
      const secondRefinement = fitPartialAffineLeastSquares(refinedInliers);
      if (secondRefinement) refined = secondRefinement;
    }
    return refined;
  }

  function nextRansacState(state: number): number {
    return (Math.imul(state, 1664525) + 1013904223) >>> 0;
  }

  function partialAffineFromTwoMatches(first: MatchCandidate, second: MatchCandidate): Float64Array | null {
    const px = second.targetX - first.targetX;
    const py = second.targetY - first.targetY;
    const qx = second.referenceX - first.referenceX;
    const qy = second.referenceY - first.referenceY;
    const denominator = px * px + py * py;
    if (!(denominator > 1e-8)) return null;

    const a = (px * qx + py * qy) / denominator;
    const b = (px * qy - py * qx) / denominator;
    const tx = first.referenceX - a * first.targetX + b * first.targetY;
    const ty = first.referenceY - b * first.targetX - a * first.targetY;
    const matrix = new Float64Array([
      a, -b, tx,
      b, a, ty,
      0, 0, 1,
    ]);
    return isFiniteAlignmentMatrix(matrix) ? matrix : null;
  }

  function scorePartialAffineModel(matrix: Float64Array, candidates: MatchCandidate[], thresholdSq: number) {
    let inlierCount = 0;
    let inlierError = 0;
    for (const match of candidates) {
      const dx = matrix[0] * match.targetX + matrix[1] * match.targetY + matrix[2] - match.referenceX;
      const dy = matrix[3] * match.targetX + matrix[4] * match.targetY + matrix[5] - match.referenceY;
      const errorSq = dx * dx + dy * dy;
      if (Number.isFinite(errorSq) && errorSq <= thresholdSq) {
        inlierCount += 1;
        inlierError += errorSq;
      }
    }
    return { inlierCount, inlierError };
  }

  function collectPartialAffineInliers(matrix: Float64Array, candidates: MatchCandidate[], thresholdSq: number): MatchCandidate[] {
    const inliers = [];
    for (const match of candidates) {
      const dx = matrix[0] * match.targetX + matrix[1] * match.targetY + matrix[2] - match.referenceX;
      const dy = matrix[3] * match.targetX + matrix[4] * match.targetY + matrix[5] - match.referenceY;
      const errorSq = dx * dx + dy * dy;
      if (Number.isFinite(errorSq) && errorSq <= thresholdSq) inliers.push(match);
    }
    return inliers;
  }

  function fitPartialAffineLeastSquares(matches: MatchCandidate[]): Float64Array | null {
    if (!Array.isArray(matches) || matches.length < 2) return null;
    let sourceMeanX = 0;
    let sourceMeanY = 0;
    let targetMeanX = 0;
    let targetMeanY = 0;
    for (const match of matches) {
      sourceMeanX += match.targetX;
      sourceMeanY += match.targetY;
      targetMeanX += match.referenceX;
      targetMeanY += match.referenceY;
    }
    const inverseCount = 1 / matches.length;
    sourceMeanX *= inverseCount;
    sourceMeanY *= inverseCount;
    targetMeanX *= inverseCount;
    targetMeanY *= inverseCount;

    let dot = 0;
    let cross = 0;
    let denominator = 0;
    for (const match of matches) {
      const px = match.targetX - sourceMeanX;
      const py = match.targetY - sourceMeanY;
      const qx = match.referenceX - targetMeanX;
      const qy = match.referenceY - targetMeanY;
      dot += px * qx + py * qy;
      cross += px * qy - py * qx;
      denominator += px * px + py * py;
    }
    if (!(denominator > 1e-8)) return null;

    const a = dot / denominator;
    const b = cross / denominator;
    const tx = targetMeanX - a * sourceMeanX + b * sourceMeanY;
    const ty = targetMeanY - b * sourceMeanX - a * sourceMeanY;
    const matrix = new Float64Array([
      a, -b, tx,
      b, a, ty,
      0, 0, 1,
    ]);
    return isFiniteAlignmentMatrix(matrix) ? matrix : null;
  }

  function isFiniteAlignmentMatrix(matrix: ArrayLike<number> | null): boolean {
    if (!matrix || matrix.length < 9) return false;
    for (let i = 0; i < 9; i += 1) {
      if (!Number.isFinite(matrix[i])) return false;
    }
    return true;
  }

  function buildAlignmentResult(
    alignment: PartialAffineEstimate,
    referenceFeatureCount: number,
    targetFeatureCount: number,
    matchCount: number,
    usableMatchCount: number,
    matchShiftLimit: number,
    fallbackMode: OrbFallbackMode,
    preprocessing: OrbPreprocessing,
  ): OrbAlignmentComputationResult {
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

  function prepareAlignmentPair(
    referenceBytes: Uint8Array,
    targetBytes: Uint8Array,
    referenceExposure: number | null,
    targetExposure: number | null,
  ): OrbPreprocessing {
    const exposure = prepareAlignmentExposurePair(
      referenceBytes,
      targetBytes,
      referenceExposure,
      targetExposure,
    );
    const referenceGray = preprocessAlignmentGray(exposure.referenceBytes);
    try {
      return {
        referenceGray,
        targetGray: preprocessAlignmentGray(exposure.targetBytes),
        referenceExposureGain: exposure.referenceExposureGain,
        targetExposureGain: exposure.targetExposureGain,
        exposureMatchSource: exposure.exposureMatchSource,
      };
    } catch (error) {
      referenceGray.delete();
      throw error;
    }
  }

  function preprocessAlignmentGray(bytes: Uint8Array): OpenCvDynamic {
    const source = makeGrayMatFromBytes(bytes);
    const bilateral = new cv.Mat();
    const output = new cv.Mat();
    let clahe: OpenCvDynamic | null = null;

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

  function createClahe(): OpenCvDynamic {
    const tileGridSize = new cv.Size(ALIGNMENT_CLAHE_TILE_GRID, ALIGNMENT_CLAHE_TILE_GRID);
    if (typeof cv.createCLAHE === "function") {
      return cv.createCLAHE(ALIGNMENT_CLAHE_CLIP_LIMIT, tileGridSize);
    }
    if (typeof cv.CLAHE === "function") {
      return new cv.CLAHE(ALIGNMENT_CLAHE_CLIP_LIMIT, tileGridSize);
    }
    throw new Error("This OpenCV.js build does not provide CLAHE.");
  }

  function countOrbFeatures(gray: OpenCvDynamic): number {
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

  function makeGrayMatFromBytes(bytes: Uint8Array): OpenCvDynamic {
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

  function collectMatchCandidates(matches: OpenCvDynamic, referenceKeypoints: OpenCvDynamic, targetKeypoints: OpenCvDynamic, shiftLimit: number): MatchCandidate[] {
    const sidesMean = (width + height) / 2;
    const candidates: MatchCandidate[] = [];

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

  function measureReprojectionErrors(matrix: Float64Array, candidates: MatchCandidate[]): ReprojectionStats {
    const errors: number[] = [];
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

  function validateFallbackReprojection(reprojection: ReprojectionStats): void {
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

  function percentileSorted(values: number[], q: number): number {
    if (values.length === 0) return Number.POSITIVE_INFINITY;
    const rank = Math.ceil(Math.max(0, Math.min(1, q)) * values.length);
    const index = Math.min(values.length - 1, Math.max(0, rank - 1));
    return values[index];
  }

  function formatPixels(value: number): string {
    return Number.isFinite(value) ? `${value.toFixed(2)} px` : "non-finite";
  }

  function createOrb(cv: OpenCvRuntime): OpenCvDynamic {
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

  function createHammingMatcher(cv: OpenCvRuntime): OpenCvDynamic {
    if (cv.BFMatcher && typeof cv.BFMatcher.create === "function") {
      return cv.BFMatcher.create(cv.NORM_HAMMING, true);
    }
    if (typeof cv.BFMatcher === "function") {
      return new cv.BFMatcher(cv.NORM_HAMMING, true);
    }
    throw new Error("This OpenCV.js build does not provide BFMatcher.");
  }

  function isPartialAffinePlausible(m: ArrayLike<number>): boolean {
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

  function assertOrbApis(cv: OpenCvRuntime): void {
    const missing: string[] = [];
    if (!cv.ORB && !cv.ORB_create) missing.push("ORB");
    if (!cv.BFMatcher) missing.push("BFMatcher");
    if (!cv.KeyPointVector) missing.push("KeyPointVector");
    if (!cv.DMatchVector) missing.push("DMatchVector");
    if (!cv.bilateralFilter) missing.push("bilateralFilter");
    if (!cv.createCLAHE && !cv.CLAHE) missing.push("CLAHE");
    if (!cv.Size) missing.push("Size");
    if (cv.CV_8UC1 === undefined) missing.push("CV_8UC1");
    if (cv.NORM_HAMMING === undefined) missing.push("NORM_HAMMING");
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
