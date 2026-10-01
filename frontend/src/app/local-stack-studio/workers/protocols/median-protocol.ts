export type MedianWorkerAlignmentPlan = {
  normalizationMode: "feature-match" | "center-crop" | "center-fit" | "center-fill" | "top-left-fill";
  targetWidth: number;
  targetHeight: number;
};

export type MedianWorkerMatrix = Float64Array | number[] | null;

export type MedianWorkerConfig = {
  sessionId: string;
  alignmentPlan: MedianWorkerAlignmentPlan;
  matrices: MedianWorkerMatrix[];
  cacheBytes?: number;
};

export type MedianWorkerInitRequest = MedianWorkerConfig & {
  type: "init";
  requestId: number;
};

export type MedianWorkerTileRequest = {
  type: "merge-tile";
  requestId: number;
  x: number;
  y: number;
  width: number;
  height: number;
};

export type MedianWorkerRequest = MedianWorkerInitRequest | MedianWorkerTileRequest;

export type MedianWorkerReadyResponse = {
  type: "ready";
  requestId: number;
  imageCount: number;
};

export type MedianWorkerTileResponse = {
  type: "merge-tile-result";
  requestId: number;
  x: number;
  y: number;
  width: number;
  height: number;
  gamma2Buffer: ArrayBuffer;
};

export type MedianWorkerErrorResponse = {
  type: "error";
  requestId: number;
  message: string;
};

export type MedianWorkerResponse =
  | MedianWorkerReadyResponse
  | MedianWorkerTileResponse
  | MedianWorkerErrorResponse;
