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
  fNumbers: Float32Array;
  apertureOrder: Int32Array;
  exposureRolloffMaxP998AfterGain: Array<number | null>;
  cacheBytes?: number;
};

export type StfAdditionalBlurWorkerInitRequest = StfAdditionalBlurWorkerConfig & {
  type: "init";
  requestId: number;
};

export type StfAdditionalBlurAnalyzeMaskRequest = {
  type: "analyze-mask-stripe";
  requestId: number;
  stripeIndex: number;
  y: number;
  height: number;
};

export type StfAdditionalBlurApplyRequest = {
  type: "apply-blur-stripe";
  requestId: number;
  stripeIndex: number;
  y: number;
  height: number;
  maskBuffer: ArrayBuffer;
  edgeProtectionBuffer: ArrayBuffer;
  scaledLogFactor: number;
};

export type StfAdditionalBlurWorkerRequest =
  | StfAdditionalBlurWorkerInitRequest
  | StfAdditionalBlurAnalyzeMaskRequest
  | StfAdditionalBlurApplyRequest;

export type StfAdditionalBlurReadyResponse = {
  type: "ready";
  requestId: number;
  imageCount: number;
  width: number;
  height: number;
};

export type StfAdditionalBlurAnalyzeMaskResponse = {
  type: "analyze-mask-stripe-result";
  requestId: number;
  stripeIndex: number;
  y: number;
  height: number;
  maskBuffer: ArrayBuffer;
  edgeProtectionBuffer: ArrayBuffer;
  histogramBuffer: ArrayBuffer;
  sampleCount: number;
};

export type StfAdditionalBlurApplyResponse = {
  type: "apply-blur-stripe-result";
  requestId: number;
  stripeIndex: number;
  y: number;
  height: number;
  linearBuffer: ArrayBuffer;
};

export type StfAdditionalBlurErrorResponse = {
  type: "error";
  requestId: number;
  message: string;
};

export type StfAdditionalBlurWorkerResponse =
  | StfAdditionalBlurReadyResponse
  | StfAdditionalBlurAnalyzeMaskResponse
  | StfAdditionalBlurApplyResponse
  | StfAdditionalBlurErrorResponse;
