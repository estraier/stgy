/// <reference lib="webworker" />

import {
  RAW_DEVELOPED_LINEAR_RANGE_MAX,
  developRawMasterOnePassRowsToGamma20,
  developRawMasterOnePassToGamma20,
} from "../../../components/image-editor/raw-development-core";
import type {
  LensfunWorkerRequest,
  LensfunWorkerResponse,
} from "./protocols/lensfun-protocol";

const workerScope = self as unknown as DedicatedWorkerGlobalScope;

function post(response: LensfunWorkerResponse, transfer: Transferable[] = []): void {
  workerScope.postMessage(response, transfer);
}

workerScope.onmessage = (event: MessageEvent<LensfunWorkerRequest>) => {
  try {
    const message = event.data;
    if (message.type === "process-shared") {
      const source = new Uint16Array(message.sourceBuffer);
      const output = new Uint16Array(message.outputBuffer);
      const result = developRawMasterOnePassRowsToGamma20(
        source,
        message.width,
        message.height,
        message.sourceLinearRangeMax,
        message.sourceTransfer,
        message.correction,
        message.outputCrop,
        undefined,
        undefined,
        undefined,
        output,
        message.rowStart,
        message.rowEnd,
      );
      post({
        type: "process-shared-complete",
        workerIndex: message.workerIndex,
        rowStart: message.rowStart,
        rowEnd: message.rowEnd,
        width: result.width,
        height: result.height,
        linearRangeMax: RAW_DEVELOPED_LINEAR_RANGE_MAX,
        transfer: "gamma20",
      });
      return;
    }

    const source = new Uint16Array(message.sourceBuffer);
    const result = developRawMasterOnePassToGamma20(
      source,
      message.width,
      message.height,
      message.sourceLinearRangeMax,
      message.sourceTransfer,
      message.correction,
      message.outputCrop,
      undefined,
      undefined,
      undefined,
    );
    const outputBuffer = result.data.buffer as ArrayBuffer;
    post({
      type: "process-single-complete",
      outputBuffer,
      width: result.width,
      height: result.height,
      linearRangeMax: RAW_DEVELOPED_LINEAR_RANGE_MAX,
      transfer: "gamma20",
    }, [outputBuffer]);
  } catch (error) {
    post({
      type: "error",
      message: error instanceof Error ? error.message : String(error),
    });
  }
};
