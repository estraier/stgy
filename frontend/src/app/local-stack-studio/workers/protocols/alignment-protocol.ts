import type { AlignmentErrorKind } from "../alignment-error";
import type { AlignmentExposureMatchSource } from "../alignment-preprocess";

export type AlignmentAlgorithm = "ECC" | "ORB";

export type AlignmentInitRequest = {
  type: "init";
  requestId: number;
  width: number;
  height: number;
  grayBuffer: ArrayBuffer;
  exposureScalar: number | null;
  refinementOnly?: boolean;
  refinement?: { width: number; height: number; grayBuffer: ArrayBuffer };
};

export type AlignmentAlignRequest = {
  type: "align";
  requestId: number;
  id: number;
  fileName: string;
  grayBuffer: ArrayBuffer;
  exposureScalar: number | null;
  refinement?: { width: number; height: number; grayBuffer: ArrayBuffer };
};

export type ProgressiveCoarseRequest = Omit<AlignmentAlignRequest, "type" | "refinement"> & { type: "coarse" };
export type ProgressiveRefineRequest = {
  type: "refine";
  requestId: number;
  id: number;
  fileName: string;
  refinement: { width: number; height: number; grayBuffer: ArrayBuffer };
  referenceRefinement?: { width: number; height: number; grayBuffer: ArrayBuffer };
};

/** Refine an externally estimated target->reference affine (e.g. 1MP ECC). */
export type ExternalRefineRequest = {
  type: "refine-external";
  requestId: number;
  id: number;
  fileName: string;
  initialMatrixBuffer: ArrayBuffer;
  exposureScalar: number | null;
  refinement: { width: number; height: number; grayBuffer: ArrayBuffer };
};

export type AlignmentWorkerRequest = AlignmentInitRequest | AlignmentAlignRequest |
  ProgressiveCoarseRequest | ProgressiveRefineRequest | ExternalRefineRequest;

export type AlignmentErrorResponse = {
  type: "error";
  requestId: number | null;
  id: number | null;
  errorKind: AlignmentErrorKind;
  message: string;
};

export type EccReadyResponse = {
  type: "ready";
  requestId: number;
  workingWidth: number;
  workingHeight: number;
  pyramidLevels: number;
};

export type EccResultResponse = {
  type: "result";
  requestId: number;
  id: number;
  fileName: string;
  matrixBuffer: ArrayBuffer;
  correlation: number;
  initialCorrelation: number;
  correlationImprovement: number;
  workingWidth: number;
  workingHeight: number;
  pyramidLevels: number;
  scaleX: number;
  scaleY: number;
  shearCosine: number;
  translationRatio: number;
  referenceExposureGain: number;
  targetExposureGain: number;
  exposureMatchSource: AlignmentExposureMatchSource;
  maskCoverage: number;
};

export type EccWorkerResponse = EccReadyResponse | EccResultResponse | AlignmentErrorResponse;

export type OrbReadyResponse = {
  type: "ready";
  requestId: number;
  referenceFeatureCount: number;
};

export type OrbFallbackMode = "none" | "relaxed-shift" | "low-match-validated";

export type OrbResultResponse = {
  type: "result";
  requestId: number;
  id: number;
  fileName: string;
  matrixBuffer: ArrayBuffer;
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
  refinementStatus?: string;
  refinementMatches?: number;
  refinementInliers?: number;
  refinementMedianError?: number;
  refinementP95Error?: number;
  refinementInitialInliers?: number;
  refinementInitialMedianError?: number;
  refinementInitialP95Error?: number;
  refinementCorrectionPx?: number;
};

export type OrbWorkerResponse = OrbReadyResponse | OrbResultResponse | AlignmentErrorResponse;
