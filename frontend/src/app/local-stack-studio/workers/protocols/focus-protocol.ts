export type FocusSharpnessFeaturesRequest = {
  type: "sharpness-features";
  requestId: number;
  width: number;
  height: number;
  gamma2Buffer: ArrayBuffer;
  progressMessage: string;
};

export type FocusSharpnessComposeRequest = {
  type: "sharpness-compose";
  requestId: number;
  workingWidth: number;
  workingHeight: number;
  width: number;
  height: number;
  globalLapMean: number;
  globalLapStd: number;
  globalSobelMean: number;
  globalSobelStd: number;
  featureBuffer: ArrayBuffer;
  progressMessage: string;
};

export type FocusTauStatsRequest = {
  type: "tau-stats";
  requestId: number;
  sharpnessBuffers: ArrayBuffer[];
};

export type FocusWorkingSharpnessInitRequest = {
  type: "working-sharpness-init";
  requestId: number;
  sharpnessBuffers: ArrayBuffer[];
  workingWidth: number;
  workingHeight: number;
  imageWidth: number;
  imageHeight: number;
};

export type FocusCoreBeginRequest = {
  type: "focus-core-begin";
  requestId: number;
  regionX: number;
  regionY: number;
  regionWidth: number;
  regionHeight: number;
  coreOffsetX: number;
  coreOffsetY: number;
  coreWidth: number;
  coreHeight: number;
  tau: number;
  pyramidDownsamples: number;
};

export type FocusCoreAddImageRequest = {
  type: "focus-core-add-image";
  requestId: number;
  imageIndex: number;
  rgbBuffer: ArrayBuffer;
};

export type FocusCoreFinishRequest = {
  type: "focus-core-finish";
  requestId: number;
};

export type FocusMergeTileRequest = {
  type: "merge-tile";
  requestId: number;
  width: number;
  height: number;
  tau: number;
  pyramidLevels: number;
  rgbBuffers: ArrayBuffer[];
  sharpnessBuffers: ArrayBuffer[];
};

export type FocusMergeTileWorkingRequest = {
  type: "merge-tile-working";
  requestId: number;
  regionX: number;
  regionY: number;
  regionWidth: number;
  regionHeight: number;
  tau: number;
  pyramidLevels: number;
  rgbBuffers: ArrayBuffer[];
};

export type FocusWorkerRequest =
  | FocusSharpnessFeaturesRequest
  | FocusSharpnessComposeRequest
  | FocusTauStatsRequest
  | FocusWorkingSharpnessInitRequest
  | FocusCoreBeginRequest
  | FocusCoreAddImageRequest
  | FocusCoreFinishRequest
  | FocusMergeTileRequest
  | FocusMergeTileWorkingRequest;

export type FocusProgressResponse = {
  type: "progress";
  requestId: number;
  message: string;
};

export type FocusErrorResponse = {
  type: "error";
  requestId: number;
  message: string;
};

export type FocusSharpnessFeaturesResponse = {
  type: "sharpness-features-result";
  requestId: number;
  featureBuffer: ArrayBuffer;
  workingWidth: number;
  workingHeight: number;
  lapCount: number;
  lapMean: number;
  lapM2: number;
  sobelCount: number;
  sobelMean: number;
  sobelM2: number;
};

export type FocusSharpnessComposeResponse = {
  type: "sharpness-compose-result";
  requestId: number;
  sharpnessBuffer: ArrayBuffer;
};

export type FocusTauStatsResponse = {
  type: "tau-stats-result";
  requestId: number;
  sum: number;
  sumSq: number;
  count: number;
};

export type FocusWorkingSharpnessInitResponse = {
  type: "working-sharpness-init-result";
  requestId: number;
};

export type FocusCoreBeginResponse = {
  type: "focus-core-begin-result";
  requestId: number;
};

export type FocusCoreAddImageResponse = {
  type: "focus-core-add-image-result";
  requestId: number;
};

export type FocusCoreFinishResponse = {
  type: "focus-core-finish-result";
  requestId: number;
  gamma2Buffer: ArrayBuffer;
};

export type FocusMergeTileResponse = {
  type: "merge-tile-result";
  requestId: number;
  gamma2Buffer: ArrayBuffer;
};

export type FocusMergeTileWorkingResponse = {
  type: "merge-tile-working-result";
  requestId: number;
  gamma2Buffer: ArrayBuffer;
};

export type FocusWorkerResponse =
  | FocusProgressResponse
  | FocusErrorResponse
  | FocusSharpnessFeaturesResponse
  | FocusSharpnessComposeResponse
  | FocusTauStatsResponse
  | FocusWorkingSharpnessInitResponse
  | FocusCoreBeginResponse
  | FocusCoreAddImageResponse
  | FocusCoreFinishResponse
  | FocusMergeTileResponse
  | FocusMergeTileWorkingResponse;
