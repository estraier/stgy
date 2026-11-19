
export type OpticalFlowOpeningVariant = "ext1" | `ext1-${2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12}`;
export type OpticalFlowVariant = "mid" | OpticalFlowOpeningVariant | "ext2";

export type OpticalFlowWorkerInterpolateRequest = {
  type: "interpolate";
  // Request stripes instead of full-resolution RGB16 output images.
  streamStripes?: boolean;
  requestId: number;
  width: number;
  height: number;
  variant: OpticalFlowVariant;
  variantScale?: number;
  additionalVariant?: OpticalFlowVariant;
  additionalVariantScale?: number;
  // Average opening-side extrapolation reuses up to the first three adjacent
  // real-pair forward fields, normalized by the positive 1/F interval.
  openingAverageRadiusSpan?: number;
  // Fixed aperture-dependent Farneback window for this real-image pair.
  winsize?: number;
  // STF-only: Flow persistence is strictly scoped to one Canonical session.
  persistFlow?: boolean;
  sessionId?: string;
  sessionCreatedAt?: number;
  alignmentKey?: string;
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

export type OpticalFlowWorkerWarpOpeningAverageRequest = {
  type: "warp-opening-average";
  streamStripes?: boolean;
  requestId: number;
  sourceImageId: number;
  // The first request provides the opening-side source RGB16; subsequent
  // ext1-2..12 requests reuse the retained buffer.
  sourceGamma2Buffer?: ArrayBuffer;
  variant: OpticalFlowOpeningVariant;
  variantScale: number;
};

export type OpticalFlowWorkerStripeAckRequest = {
  type: "stripe-ack";
  requestId: number;
  y: number;
  kind: "primary" | "additional";
};
export type OpticalFlowWorkerStripeAbortRequest = {
  type: "stripe-abort";
  requestId: number;
  message: string;
};

export type OpticalFlowWorkerReleaseRetainedRequest = { type: "release-retained"; requestId: number };
export type OpticalFlowWorkerRequest = OpticalFlowWorkerInterpolateRequest | OpticalFlowWorkerWarmupRequest |
  OpticalFlowWorkerWarpOpeningAverageRequest | OpticalFlowWorkerReleaseRetainedRequest |
  OpticalFlowWorkerStripeAckRequest | OpticalFlowWorkerStripeAbortRequest;

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
  flowCacheHit?: boolean;
  flowCacheSaved?: boolean;
  flowCacheReadMs?: number;
  flowCacheWriteMs?: number;
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

export type OpticalFlowWorkerStripeResponse = {
  type: "stripe";
  requestId: number;
  kind: "primary" | "additional";
  y: number;
  height: number;
  width: number;
  gamma2Buffer: ArrayBuffer;
};

export type OpticalFlowWorkerStreamResultResponse = {
  type: "stream-result";
  requestId: number;
  width: number;
  height: number;
  performance?: OpticalFlowPerformanceStats;
  warpMs?: number;
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
  | OpticalFlowWorkerStripeResponse
  | OpticalFlowWorkerStreamResultResponse
  | OpticalFlowWorkerResultResponse
  | OpticalFlowWorkerErrorResponse;
