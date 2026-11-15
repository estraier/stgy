export type OpticalFlowOpeningVariant = "ext1" | `ext1-${2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10}`;
export type OpticalFlowVariant = "mid" | OpticalFlowOpeningVariant | "ext2";

export type OpticalFlowWorkerInterpolateRequest = {
  type: "interpolate";
  requestId: number;
  width: number;
  height: number;
  variant: OpticalFlowVariant;
  variantScale?: number;
  additionalVariant?: OpticalFlowVariant;
  additionalVariantScale?: number;
  retainPair?: boolean;
  linearRangeMax?: 1 | 4;
  previousImageId?: number;
  nextImageId?: number;
  previousGamma2Buffer: ArrayBuffer;
  nextGamma2Buffer: ArrayBuffer;
  previousGrayBuffer?: ArrayBuffer;
  nextGrayBuffer?: ArrayBuffer;
};

export type OpticalFlowWorkerWarmupRequest = {
  type: "warmup";
  requestId: number;
};

export type OpticalFlowWorkerWarpRetainedRequest = {
  type: "warp-retained";
  requestId: number;
  previousImageId: number;
  nextImageId: number;
  variant: OpticalFlowVariant;
  variantScale?: number;
};

export type OpticalFlowWorkerReleaseRetainedRequest = { type: "release-retained"; requestId: number };
export type OpticalFlowWorkerRequest = OpticalFlowWorkerInterpolateRequest | OpticalFlowWorkerWarmupRequest |
  OpticalFlowWorkerWarpRetainedRequest | OpticalFlowWorkerReleaseRetainedRequest;

export type OpticalFlowPerformanceStats = {
  sourceWidth: number;
  sourceHeight: number;
  flowWidth: number;
  flowHeight: number;
  prepareFlowInputsMs: number;
  forwardFlowMs: number;
  backwardFlowMs: number;
  flowWallMs: number;
  flowWorkerCount: number;
  warmupMs: number;
  warpMs: number;
  additionalWarpMs?: number;
  totalWorkerMs: number;
  estimatedPeakBytes: number;
  inputGamma2Bytes: number;
  flowFieldBytes: number;
  outputBytes: number;
};

export type OpticalFlowWorkerReadyResponse = {
  type: "ready";
  requestId: number;
  flowWorkerCount: number;
  warmupMs: number;
};

export type OpticalFlowWorkerProgressResponse = {
  type: "progress";
  requestId: number;
  message: string;
};

export type OpticalFlowWorkerResultResponse = {
  type: "result";
  requestId: number;
  width: number;
  height: number;
  gamma2Buffer: ArrayBuffer;
  additionalGamma2Buffer?: ArrayBuffer;
  flowWidth: number;
  flowHeight: number;
  performance: OpticalFlowPerformanceStats;
};

export type OpticalFlowWorkerWarpRetainedResponse = {
  type: "warp-result";
  requestId: number;
  width: number;
  height: number;
  gamma2Buffer: ArrayBuffer;
  warpMs: number;
};

export type OpticalFlowWorkerErrorResponse = {
  type: "error";
  requestId: number;
  message: string;
};

export type OpticalFlowWorkerResponse =
  | OpticalFlowWorkerReadyResponse
  | OpticalFlowWorkerProgressResponse
  | OpticalFlowWorkerWarpRetainedResponse
  | OpticalFlowWorkerResultResponse
  | OpticalFlowWorkerErrorResponse;
