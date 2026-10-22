export type PanoramaStitchRequest = {
  type: "stitch";
  requestId: number;
  sessionId: string;
  cacheBytes?: number;
  maxOutputMegapixels?: number | null;
  finishMode?: "trim" | "fill";
};

export type PanoramaWorkerRequest = PanoramaStitchRequest;

export type PanoramaProgressResponse = {
  type: "progress";
  requestId: number;
  message: string;
};

export type PanoramaResultResponse = {
  type: "result";
  requestId: number;
  width: number;
  height: number;
  gamma2Buffer: ArrayBuffer;
};

export type PanoramaErrorResponse = {
  type: "error";
  requestId: number;
  message: string;
};

export type PanoramaWorkerResponse =
  | PanoramaProgressResponse
  | PanoramaResultResponse
  | PanoramaErrorResponse;
