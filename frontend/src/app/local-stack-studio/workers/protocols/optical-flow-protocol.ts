export type OpticalFlowVariant = "mid" | "ext1" | "ext2";

export type OpticalFlowWorkerInterpolateRequest = {
  type: "interpolate";
  requestId: number;
  width: number;
  height: number;
  variant: OpticalFlowVariant;
  /** Generate a second variant from the same bidirectional Flow without recomputation. */
  additionalVariant?: OpticalFlowVariant;
  /** Canonical STF uses gamma-2 RGB16 with linear range 4; legacy standalone uses 1. */
  linearRangeMax?: 1 | 4;
  previousImageId?: number;
  nextImageId?: number;
  previousGamma2Buffer: ArrayBuffer;
  nextGamma2Buffer: ArrayBuffer;
  /** Optional exact Gray8 proxies shared between adjacent STF pairs. Supply both or neither. */
  previousGrayBuffer?: ArrayBuffer;
  nextGrayBuffer?: ArrayBuffer;
};

export type OpticalFlowWorkerWarmupRequest = {
  type: "warmup";
  requestId: number;
};

export type OpticalFlowWorkerRequest = OpticalFlowWorkerInterpolateRequest | OpticalFlowWorkerWarmupRequest;

export type OpticalFlowPerformanceStats = {
  sourceWidth: number;
  sourceHeight: number;
  flowWidth: number;
  flowHeight: number;
  prepareFlowInputsMs: number;
  forwardFlowMs: number;
  backwardFlowMs: number;
  /** Wall-clock time for the two Flow requests, including worker transfer. */
  flowWallMs: number;
  /** 1 = sequential, 2 = parallel; numerical algorithm is unchanged. */
  flowWorkerCount: number;
  /** First-run native-worker initialization; excluded from warmed-up STF cost. */
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

export type OpticalFlowWorkerErrorResponse = {
  type: "error";
  requestId: number;
  message: string;
};

export type OpticalFlowWorkerResponse =
  | OpticalFlowWorkerReadyResponse
  | OpticalFlowWorkerProgressResponse
  | OpticalFlowWorkerResultResponse
  | OpticalFlowWorkerErrorResponse;
