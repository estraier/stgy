export type Hdr1StreamInitRequest = {
  type: "merge-stream-init";
  requestId: number;
  width: number;
  height: number;
  imageCount: number;
  exposureTimesBuffer: ArrayBuffer;
  linearResponseFlagsBuffer: ArrayBuffer;
};

export type Hdr1StreamImageRequest = {
  type: "merge-stream-image";
  requestId: number;
  imageIndex: number;
  brightness: number;
  imageBuffer: ArrayBuffer;
};

export type Hdr1StreamFinalizeRequest = {
  type: "merge-stream-finalize";
  requestId: number;
};

export type Hdr1StreamAbortRequest = {
  type: "merge-stream-abort";
  requestId: number;
};

export type Hdr2StreamInitRequest = {
  type: "mertens-stream-init";
  requestId: number;
  width: number;
  height: number;
  imageCount: number;
  saturationWeight: number;
  exposureWeight: number;
};

export type Hdr2StreamImageRequest = {
  type: "mertens-stream-image";
  requestId: number;
  imageIndex: number;
  brightness: number;
  imageBuffer: ArrayBuffer;
};

export type Hdr2StreamFinalizeRequest = {
  type: "mertens-stream-finalize";
  requestId: number;
};

export type Hdr2StreamAbortRequest = {
  type: "mertens-stream-abort";
  requestId: number;
};

export type HdrLegacyMergeRequest = {
  type: "merge";
  requestId?: number;
  width: number;
  height: number;
  imageBuffers: ArrayBuffer[];
  exposureTimesBuffer: ArrayBuffer;
  brightnessesBuffer: ArrayBuffer;
};

export type HdrLegacyMertensRequest = {
  type: "mertens";
  requestId?: number;
  width: number;
  height: number;
  imageBuffers: ArrayBuffer[];
  brightnessesBuffer: ArrayBuffer;
  saturationWeight: number;
  exposureWeight: number;
};

export type HdrWorkerRequest =
  | Hdr1StreamInitRequest
  | Hdr1StreamImageRequest
  | Hdr1StreamFinalizeRequest
  | Hdr1StreamAbortRequest
  | Hdr2StreamInitRequest
  | Hdr2StreamImageRequest
  | Hdr2StreamFinalizeRequest
  | Hdr2StreamAbortRequest
  | HdrLegacyMergeRequest
  | HdrLegacyMertensRequest;

export type HdrProgressResponse = {
  type: "progress";
  requestId?: number;
  message: string;
};

export type HdrErrorResponse = {
  type: "error";
  requestId?: number;
  message: string;
};

export type Hdr1StreamReadyResponse = {
  type: "merge-stream-ready";
  requestId: number;
};

export type Hdr1StreamImageStoredResponse = {
  type: "merge-stream-image-stored";
  requestId: number;
  imageIndex: number;
};

export type Hdr1StreamAbortedResponse = {
  type: "merge-stream-aborted";
  requestId: number;
};

export type Hdr1ResultResponse = {
  type: "result";
  requestId?: number;
  linearProPhotoBuffer: ArrayBuffer;
};

export type Hdr2StreamReadyResponse = {
  type: "mertens-stream-ready";
  requestId: number;
};

export type Hdr2StreamImageStoredResponse = {
  type: "mertens-stream-image-stored";
  requestId: number;
  imageIndex: number;
};

export type Hdr2StreamAbortedResponse = {
  type: "mertens-stream-aborted";
  requestId: number;
};

export type Hdr2ResultResponse = {
  type: "mertens-result";
  requestId?: number;
  gamma2Buffer: ArrayBuffer;
};

export type HdrWorkerResponse =
  | HdrProgressResponse
  | HdrErrorResponse
  | Hdr1StreamReadyResponse
  | Hdr1StreamImageStoredResponse
  | Hdr1StreamAbortedResponse
  | Hdr1ResultResponse
  | Hdr2StreamReadyResponse
  | Hdr2StreamImageStoredResponse
  | Hdr2StreamAbortedResponse
  | Hdr2ResultResponse;

const HDR_REQUEST_TYPES = new Set<HdrWorkerRequest["type"]>([
  "merge",
  "merge-stream-init",
  "merge-stream-image",
  "merge-stream-finalize",
  "merge-stream-abort",
  "mertens",
  "mertens-stream-init",
  "mertens-stream-image",
  "mertens-stream-finalize",
  "mertens-stream-abort",
]);

export function asHdrWorkerRequest(value: unknown): HdrWorkerRequest | null {
  if (typeof value !== "object" || value === null) return null;
  const type = (value as { type?: unknown }).type;
  if (typeof type !== "string" || !HDR_REQUEST_TYPES.has(type as HdrWorkerRequest["type"])) return null;
  return value as HdrWorkerRequest;
}
