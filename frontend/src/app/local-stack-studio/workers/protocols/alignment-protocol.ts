import type { AlignmentExposureMatchSource } from "../alignment-preprocess";

export type AlignmentAlgorithm = "ECC" | "ORB";

export type AlignmentInitRequest = {
  type: "init";
  requestId: number;
  width: number;
  height: number;
  grayBuffer: ArrayBuffer;
  exposureScalar: number | null;
};

export type AlignmentAlignRequest = {
  type: "align";
  requestId: number;
  id: number;
  fileName: string;
  grayBuffer: ArrayBuffer;
  exposureScalar: number | null;
};

export type AlignmentWorkerRequest = AlignmentInitRequest | AlignmentAlignRequest;

export type AlignmentErrorResponse = {
  type: "error";
  requestId: number | null;
  id: number | null;
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
};

export type OrbWorkerResponse = OrbReadyResponse | OrbResultResponse | AlignmentErrorResponse;
