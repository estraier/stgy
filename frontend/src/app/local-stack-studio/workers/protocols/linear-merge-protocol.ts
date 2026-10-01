export type LinearMergeWorkerAlignmentPlan = {
  normalizationMode: "feature-match" | "center-crop" | "center-fit" | "center-fill" | "top-left-fill";
  targetWidth: number;
  targetHeight: number;
};

export type LinearMergeWorkerMatrix = Float64Array | number[] | null;

export type LinearMergeWorkerConfig = {
  sessionId: string;
  alignmentPlan: LinearMergeWorkerAlignmentPlan;
  matrices: LinearMergeWorkerMatrix[];
  gains: Float32Array;
  weights: Float32Array;
  exposureRolloffMaxP998AfterGain: Array<number | null>;
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

export type LinearMergeWorkerStripeResponse = {
  type: "merge-stripe-result";
  requestId: number;
  y: number;
  height: number;
  linearBuffer: ArrayBuffer;
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
