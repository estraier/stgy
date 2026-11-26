
export type OpticalFlowOpeningVariant = "ext1" | `ext1-${2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12}`;
export type OpticalFlowVariant = "mid" | OpticalFlowOpeningVariant | "ext2";
export type OpticalFlowWarpMethod = "inverse-warp" | "forward-splat";
export type OpticalFlowWorkerInterpolateRequest = {
  type: "interpolate";
  // Request stripes instead of full-resolution RGB16 output images.
  streamStripes?: boolean;
  requestId: number;
  warpMethod?: OpticalFlowWarpMethod;
  width: number;
  height: number;
  variant: OpticalFlowVariant;
  // Optional streamed midpoint fractions, synthesized in one request using
  // the same real-pair forward/backward Flow. Omitted means a single 50% frame.
  middleFractions?: number[];
  // Inverse Warp's destination-indexed sampling factor. FS does not
  // use this for projection or hole filling (FS uses covered neighbors).
  variantScale?: number;
  // Signed direction is selected by the variant; this is the positive scale
  // for source->destination splatting, distinct from inverseWarpScale.
  forwardVariantScale?: number;
  additionalVariant?: OpticalFlowVariant;
  additionalVariantScale?: number;
  additionalForwardVariantScale?: number;
  additionalWarpMethod?: OpticalFlowWarpMethod;
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

// Two-phase prefetch: check IndexedDB first, so cached pairs never need
// grayscale conversion. Misses send only two 4MP Gray8 proxies, not RGB16.
export type OpticalFlowWorkerPrefetchCheckRequest = {
  type: "prefetch-check";
  requestId: number;
  width: number;
  height: number;
  previousImageId: number;
  nextImageId: number;
  winsize: number;
  sessionId: string;
  sessionCreatedAt: number;
  alignmentKey: string;
};
export type OpticalFlowWorkerPrefetchComputeRequest = {
  type: "prefetch-compute";
  requestId: number;
  width: number;
  height: number;
  previousImageId: number;
  nextImageId: number;
  winsize: number;
  sessionId: string;
  alignmentKey: string;
  previousGrayBuffer: ArrayBuffer;
  nextGrayBuffer: ArrayBuffer;
  prepareFlowInputsMs: number;
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
  warpMethod?: OpticalFlowWarpMethod;
  // The first request provides the opening-side source RGB16; subsequent
  // ext1-2..12 requests reuse the retained buffer.
  sourceGamma2Buffer?: ArrayBuffer;
  variant: OpticalFlowOpeningVariant;
  variantScale: number;
  forwardVariantScale?: number;
};

export type OpticalFlowWorkerStripeAckRequest = {
  type: "stripe-ack";
  requestId: number;
  y: number;
  kind: "primary" | "additional";
  middleIndex?: number;
};
export type OpticalFlowWorkerStripeAbortRequest = {
  type: "stripe-abort";
  requestId: number;
  message: string;
};

export type OpticalFlowWorkerReleaseRetainedRequest = { type: "release-retained"; requestId: number };
export type OpticalFlowWorkerRequest = OpticalFlowWorkerInterpolateRequest | OpticalFlowWorkerWarmupRequest |
  OpticalFlowWorkerPrefetchCheckRequest | OpticalFlowWorkerPrefetchComputeRequest |
  OpticalFlowWorkerWarpOpeningAverageRequest | OpticalFlowWorkerReleaseRetainedRequest |
  OpticalFlowWorkerStripeAckRequest | OpticalFlowWorkerStripeAbortRequest;

/** Timings of existing STF generation stages. Overlapping/nested stages are noted
 * in the console output; no per-pixel clock reads are performed. */
export type StfFlowGenerationProfile = {
  gateNormsMs?: number;
  gateSortMs?: number;
  gateBuilds?: number;
  averageFlowMs?: number;
  fsPlanMs?: number;
  fsRowReachMs?: number;
  fsTileSearchMs?: number;
  fsSplatMs?: number;
  fsRenderMs?: number;
  fsFullFrameFallback?: boolean;
  // One entry for each requested middle frame, in interpolation order.
  middleFrameWarpMs?: number[];
  // Multi-interpolation samples the bidirectional Flow once per output pixel
  // across all requested fractions; timings cannot be separated by frame.
  middleSharedWarpMs?: number;
};

export type OpticalFlowPerformanceStats = {
  profile?: StfFlowGenerationProfile;
  // Main-thread synchronous input preparation and postMessage timings.
  inputCloneMs?: number;
  inputClonedBytes?: number;
  inputPostMs?: number;
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
  // Time the worker is blocked by the bounded stripe-ack window (excluding
  // the time spent producing stripes). Useful to diagnose transport overlap.
  stripeAckWaitMs?: number;
  estimatedPeakBytes: number;
  // Known working allocations specifically for the geometry renderer;
  // excludes native OpenCV/WASM temporaries and GC-retained allocations.
  warpScratchBytes?: number;
  additionalWarpScratchBytes?: number;
  inputGamma2Bytes: number;
  flowFieldBytes: number;
  flowCacheHit?: boolean;
  flowCacheSaved?: boolean;
  flowCacheReadMs?: number;
  flowCacheWriteMs?: number;
  flowCacheValidationMs?: number;
  flowCachePutMs?: number;
  flowCacheCommitMs?: number;
  // Time spent awaiting the cache write after the final Warp/stripe ACK.
  flowCacheTailWaitMs?: number;
  // Outcome of best-effort persistence; a miss never fails image generation.
  flowCacheSaveStatus?: "admitted" | "quota-limit" | "session-deleted" | "invalid" | "error" | "hit" | "disabled";
  flowCacheIncomingBytes?: number;
  outputBytes: number;
};

export type OpticalFlowWorkerReadyResponse = {
  type: "ready";
  requestId: number;
  flowWorkerCount: number;
  warmupMs: number;
};

export type OpticalFlowWorkerPrefetchStatusResponse = {
  type: "prefetch-status";
  requestId: number;
  needsGray: boolean;
};
export type OpticalFlowWorkerPrefetchReadyResponse = {
  type: "prefetch-ready";
  requestId: number;
};
// Sent after the ordered consumer takes a prefetched pair out of the
// two-slot Flow queue. The caller may immediately schedule another pair.
export type OpticalFlowWorkerFlowConsumedResponse = {
  type: "flow-consumed";
  requestId: number;
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
  warpScratchBytes?: number;
  estimatedPeakBytes?: number;
  profile?: StfFlowGenerationProfile;
};

export type OpticalFlowWorkerStripeResponse = {
  type: "stripe";
  requestId: number;
  kind: "primary" | "additional";
  // Identifies which of this pair's middle frames the primary stripe belongs to.
  middleIndex?: number;
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
  stripeAckWaitMs?: number;
  warpScratchBytes?: number;
  estimatedPeakBytes?: number;
  profile?: StfFlowGenerationProfile;
};

export type OpticalFlowWorkerErrorResponse = {
  type: "error";
  requestId: number;
  message: string;
};

export type OpticalFlowWorkerResponse =
  | OpticalFlowWorkerReadyResponse
  | OpticalFlowWorkerPrefetchStatusResponse
  | OpticalFlowWorkerPrefetchReadyResponse
  | OpticalFlowWorkerFlowConsumedResponse
  | OpticalFlowWorkerProgressResponse
  | OpticalFlowWorkerWarpRetainedResponse
  | OpticalFlowWorkerStripeResponse
  | OpticalFlowWorkerStreamResultResponse
  | OpticalFlowWorkerResultResponse
  | OpticalFlowWorkerErrorResponse;
