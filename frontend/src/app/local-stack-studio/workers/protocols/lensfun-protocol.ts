import type {
  RawLensfunCorrectionMaps,
  RawOutputCrop,
  RawStorageTransfer,
} from "../../../../components/image-editor/raw-development-core";

export type LensfunSharedRequest = {
  type: "process-shared";
  sourceBuffer: SharedArrayBuffer;
  outputBuffer: SharedArrayBuffer;
  width: number;
  height: number;
  sourceLinearRangeMax: number;
  sourceTransfer: RawStorageTransfer;
  correction?: RawLensfunCorrectionMaps;
  outputCrop?: RawOutputCrop;
  rowStart: number;
  rowEnd: number;
  workerIndex: number;
};

export type LensfunSingleRequest = {
  type: "process-single";
  sourceBuffer: ArrayBuffer;
  width: number;
  height: number;
  sourceLinearRangeMax: number;
  sourceTransfer: RawStorageTransfer;
  correction?: RawLensfunCorrectionMaps;
  outputCrop?: RawOutputCrop;
};

export type LensfunWorkerRequest = LensfunSharedRequest | LensfunSingleRequest;

export type LensfunSharedResponse = {
  type: "process-shared-complete";
  workerIndex: number;
  rowStart: number;
  rowEnd: number;
  width: number;
  height: number;
  linearRangeMax: number;
  transfer: "gamma20";
};

export type LensfunSingleResponse = {
  type: "process-single-complete";
  outputBuffer: ArrayBuffer;
  width: number;
  height: number;
  linearRangeMax: number;
  transfer: "gamma20";
};

export type LensfunErrorResponse = {
  type: "error";
  message: string;
};

export type LensfunWorkerResponse = LensfunSharedResponse | LensfunSingleResponse | LensfunErrorResponse;
