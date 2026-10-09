export type LinearMergeWorkerAlignmentPlan = {
  normalizationMode: "feature-match" | "center-crop" | "center-fit" | "center-fill" | "top-left-fill";
  targetWidth: number;
  targetHeight: number;
};

export type LinearMergeWorkerMatrix = Float64Array | number[] | null;

export type LinearMergeWorkerMode =
  | "average"
  | "stf"
  | "stf-blur"
  | "stf-exp-dof"
  | "stf-exp-coc"
  | "stf-exp-blur";

export type LinearMergeWorkerConfig = {
  sessionId: string;
  alignmentPlan: LinearMergeWorkerAlignmentPlan;
  matrices: LinearMergeWorkerMatrix[];
  mode: LinearMergeWorkerMode;
  gains: Float32Array;
  scaledLogs: Float32Array;
  weights: Float32Array;
  fNumbers: Float32Array | null;
  apertureOrder: Int32Array | null;
  exposureRolloffMaxP998AfterGain: Array<number | null>;
  stfBlurAnalysisOnly?: boolean;
  stfBlurMaskScaleK?: number | null;
  cacheBytes?: number;
};

export type LinearMergeWorkerInitRequest = LinearMergeWorkerConfig & {
  type: "init";
  requestId: number;
};

export type LinearMergeWorkerStripeRequest = {
  type: "merge-stripe";
  requestId: number;
  y: number;
  height: number;
};

export type LinearMergeWorkerRequest = LinearMergeWorkerInitRequest | LinearMergeWorkerStripeRequest;

export type LinearMergeWorkerReadyResponse = {
  type: "ready";
  requestId: number;
  imageCount: number;
  width: number;
  height: number;
};


export type LinearMergeWorkerMetricStats = {
  sum: number;
  sumSquares: number;
  max: number;
  pixelCount: number;
  histogram: Uint32Array;
};

export type LinearMergeWorkerMaskDiagnostics = {
  support: LinearMergeWorkerMetricStats;
  originallyUnsharpGate: LinearMergeWorkerMetricStats;
  rawBlur: LinearMergeWorkerMetricStats;
  finalMask: LinearMergeWorkerMetricStats;
};

export type LinearMergeWorkerStripeResponse = {
  type: "merge-stripe-result";
  requestId: number;
  y: number;
  height: number;
  linearBuffer: ArrayBuffer;
  maskSum?: number;
  maskSumSquares?: number;
  maskPixelCount?: number;
  maskDiagnostics?: LinearMergeWorkerMaskDiagnostics;
};

export type LinearMergeWorkerErrorResponse = {
  type: "error";
  requestId: number;
  message: string;
};

export type LinearMergeWorkerResponse =
  | LinearMergeWorkerReadyResponse
  | LinearMergeWorkerStripeResponse
  | LinearMergeWorkerErrorResponse;
