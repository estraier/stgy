/** STF production additional-blur Worker protocol. */
export const STF_ADDITIONAL_BLUR_PROTOCOL_VERSION = "stf-sharpness-diagnostics-20261109c";

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
  cacheBytes?: number;
};
export type StfAdditionalBlurWorkerRequest =
  | (StfAdditionalBlurWorkerConfig & { type: "init"; requestId: number })
  | { type: "sample-brightness-stripe"; requestId: number; y: number; height: number; stride: number; offsetX: number; offsetY: number }
  | { type: "configure-relative-floors"; requestId: number; floors: [number, number, number] }
  | { type: "analyze-stripe"; requestId: number; y: number; height: number; includeSource: boolean }
  | { type: "ratio-stripe"; requestId: number; pixelCount: number; groupCount: number; epsilon: number;
      visualization?: "fine" | "coarse" | "ratio" | "ratio-v2" | "ratio-x1.2" | "ratio-x1.4" | "ratio-x1.5" | "ratio-x1.6" | "ratio-x2.0";
      fineLogSumBuffer: ArrayBuffer; fineZeroBuffer: ArrayBuffer; coarseGroupsBuffer: ArrayBuffer }
  | { type: "volume-close"; requestId: number; width: number; height: number; unitRatioBuffer: ArrayBuffer }
  | { type: "graph-cut"; requestId: number; width: number; height: number; blurRatio: number; confidenceBuffer: ArrayBuffer }
  | { type: "expand-gate-stripe"; requestId: number; regionHeight: number; coreOffsetY: number; coreHeight: number;
      radius: number; gateBuffer: ArrayBuffer }
  | { type: "blur-stripe"; requestId: number; regionHeight: number; coreOffsetY: number; coreHeight: number;
      radius: number; sourceBuffer: ArrayBuffer; gateBuffer: ArrayBuffer };
export type StfAdditionalBlurWorkerReadyResponse = {
  type: "ready"; requestId: number; protocolVersion: string;
  imageCount: number; width: number; height: number; analysisHalo: number; groupCount: number;
};
export type StfAdditionalBlurWorkerAnalyzeStripeResponse = {
  type: "analyze-stripe-result"; requestId: number; y: number; height: number; groupCount: number;
  linearBuffer: ArrayBuffer; fineLogSumBuffer: ArrayBuffer; fineZeroBuffer: ArrayBuffer; coarseGroupsBuffer: ArrayBuffer;
};
export type StfAdditionalBlurWorkerBrightnessSampleResponse = {
  type: "sample-brightness-stripe-result"; requestId: number; samplesBuffer: ArrayBuffer;
};
export type StfAdditionalBlurWorkerConfigureFloorsResponse = {
  type: "relative-floors-configured"; requestId: number; floors: [number, number, number];
};
export type StfAdditionalBlurWorkerRatioStripeResponse = {
  type: "ratio-stripe-result"; requestId: number; logRatioBuffer: ArrayBuffer;
};
export type StfAdditionalBlurWorkerVolumeClosingResponse = {
  type: "volume-close-result"; requestId: number; protocolVersion: string;
  unitRatioBuffer: ArrayBuffer; workingWidth: number; workingHeight: number; volumeThreshold: number;
};
export type StfAdditionalBlurWorkerGraphCutResponse = {
  type: "graph-cut-result"; requestId: number; protocolVersion: string;
  maskBuffer: ArrayBuffer; workingWidth: number; workingHeight: number;
  targetWhiteFraction: number; achievedWhiteFraction: number; cuts: number; areaBias: number;
};
export type StfAdditionalBlurWorkerExpandGateStripeResponse = {
  type: "expand-gate-stripe-result"; requestId: number; protocolVersion: string;
  coreHeight: number; gateBuffer: ArrayBuffer;
};
export type StfAdditionalBlurWorkerBlurStripeResponse = {
  type: "blur-stripe-result"; requestId: number; protocolVersion: string;
  coreHeight: number; linearBuffer: ArrayBuffer;
};
export type StfAdditionalBlurWorkerResponse =
  | StfAdditionalBlurWorkerReadyResponse
  | StfAdditionalBlurWorkerAnalyzeStripeResponse
  | StfAdditionalBlurWorkerBrightnessSampleResponse
  | StfAdditionalBlurWorkerConfigureFloorsResponse
  | StfAdditionalBlurWorkerRatioStripeResponse
  | StfAdditionalBlurWorkerVolumeClosingResponse
  | StfAdditionalBlurWorkerGraphCutResponse
  | StfAdditionalBlurWorkerBlurStripeResponse
  | StfAdditionalBlurWorkerExpandGateStripeResponse
  | { type: "error"; requestId: number; message: string };
