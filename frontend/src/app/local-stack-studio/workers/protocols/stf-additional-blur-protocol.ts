export type StfAdditionalBlurWorkerAlignmentPlan = {
  normalizationMode: "feature-match" | "center-crop" | "center-fit" | "center-fill" | "top-left-fill";
  targetWidth: number;
  targetHeight: number;
};

export type StfAdditionalBlurWorkerMatrix = Float64Array | number[] | null;

export type StfAdditionalBlurWorkerConfig = {
  sessionId: string;
  alignmentPlan: StfAdditionalBlurWorkerAlignmentPlan;
  matrices: StfAdditionalBlurWorkerMatrix[];
  gains: Float32Array;
  scaledLogs: Float32Array;
  weights: Float32Array;
  fNumbers: number[];
  relativeSharpness?: boolean;
  relativeBrightnessFloor?: number;
  relativeCombineMode?: "mean" | "rms";
  cacheBytes?: number;
};

export type StfAdditionalBlurWorkerInitRequest = StfAdditionalBlurWorkerConfig & {
  type: "init";
  requestId: number;
};

export type StfAdditionalBlurWorkerAnalyzeStripeRequest = {
  type: "analyze-stripe";
  requestId: number;
  y: number;
  height: number;
};

export type StfAdditionalBlurWorkerBrightnessSampleRequest = {
  type: "sample-brightness-stripe";
  requestId: number;
  y: number;
  height: number;
  stride: number;
  offsetX: number;
  offsetY: number;
};

export type StfAdditionalBlurWorkerConfigureFloorsRequest = {
  type: "configure-relative-floors";
  requestId: number;
  floors: [number, number, number];
};

export type StfAdditionalBlurWorkerRatioStripeRequest = {
  type: "ratio-stripe";
  requestId: number;
  pixelCount: number;
  groupCount: number;
  epsilon: number;
  fineLogSumBuffer: ArrayBuffer;
  fineZeroBuffer: ArrayBuffer;
  coarseGroupsBuffer: ArrayBuffer;
};

export type StfAdditionalBlurWorkerAreaClosingRequest = {
  type: "area-close";
  closingMode?: "area" | "volume" | "volume2";
  requestId: number;
  width: number;
  height: number;
  logRatioBuffer: ArrayBuffer;
};

export type StfAdditionalBlurWorkerBlurStripeRequest = {
  type: "blur-stripe";
  requestId: number;
  regionHeight: number;
  coreOffsetY: number;
  coreHeight: number;
  radius: number;
  sourceBuffer: ArrayBuffer;
  gateBuffer: ArrayBuffer;
};

export type StfAdditionalBlurWorkerRequest =
  | StfAdditionalBlurWorkerInitRequest
  | StfAdditionalBlurWorkerAnalyzeStripeRequest
  | StfAdditionalBlurWorkerBrightnessSampleRequest
  | StfAdditionalBlurWorkerConfigureFloorsRequest
  | StfAdditionalBlurWorkerRatioStripeRequest
  | StfAdditionalBlurWorkerAreaClosingRequest
  | StfAdditionalBlurWorkerBlurStripeRequest;

export type StfAdditionalBlurWorkerReadyResponse = {
  type: "ready";
  requestId: number;
  imageCount: number;
  width: number;
  height: number;
  analysisHalo: number;
  groupCount: number;
  // Echoed by the running Worker so a stale generated bundle cannot silently
  // process relative requests with the absolute-sharpness algorithm.
  relativeSharpness: boolean;
  relativeBrightnessFloor: number;
  relativeCombineMode: "mean" | "rms";
};

export type StfAdditionalBlurWorkerAnalyzeStripeResponse = {
  type: "analyze-stripe-result";
  requestId: number;
  y: number;
  height: number;
  groupCount: number;
  linearBuffer: ArrayBuffer;
  fineLogSumBuffer: ArrayBuffer;
  fineZeroBuffer: ArrayBuffer;
  coarseGroupsBuffer: ArrayBuffer;
};

export type StfAdditionalBlurWorkerBrightnessSampleResponse = {
  type: "sample-brightness-stripe-result";
  requestId: number;
  samplesBuffer: ArrayBuffer;
};

export type StfAdditionalBlurWorkerConfigureFloorsResponse = {
  type: "relative-floors-configured";
  requestId: number;
  floors: [number, number, number];
};

export type StfAdditionalBlurWorkerRatioStripeResponse = {
  type: "ratio-stripe-result";
  requestId: number;
  logRatioBuffer: ArrayBuffer;
};

export type StfAdditionalBlurWorkerAreaClosingResponse = {
  type: "area-close-result";
  closingMode: "area" | "volume" | "volume2";
  /** Explicit capability marker so old workers cannot silently run Area Closing for volume2. */
  closingImplementation?: "rim-mean-v2";
  requestId: number;
  logRatioBuffer: ArrayBuffer;
  workingWidth: number;
  workingHeight: number;
  areaThreshold?: number;
  volumeThreshold?: number;
};

export type StfAdditionalBlurWorkerBlurStripeResponse = {
  type: "blur-stripe-result";
  requestId: number;
  coreHeight: number;
  linearBuffer: ArrayBuffer;
};

export type StfAdditionalBlurWorkerErrorResponse = {
  type: "error";
  requestId: number;
  message: string;
};

export type StfAdditionalBlurWorkerResponse =
  | StfAdditionalBlurWorkerReadyResponse
  | StfAdditionalBlurWorkerAnalyzeStripeResponse
  | StfAdditionalBlurWorkerBrightnessSampleResponse
  | StfAdditionalBlurWorkerConfigureFloorsResponse
  | StfAdditionalBlurWorkerRatioStripeResponse
  | StfAdditionalBlurWorkerAreaClosingResponse
  | StfAdditionalBlurWorkerBlurStripeResponse
  | StfAdditionalBlurWorkerErrorResponse;
