/// <reference lib="webworker" />

import {
  adjustStackStoredGamma2RowsToLinear,
  type StackClaheMap,
  type StackFullRenderOptions,
} from "../stack/postprocess";

type FullRenderRequest = {
  type: "render-rows";
  requestId: number;
  workerIndex: number;
  sourceBuffer: SharedArrayBuffer;
  outputBuffer: SharedArrayBuffer;
  width: number;
  height: number;
  rowStart: number;
  rowEnd: number;
  options: Omit<StackFullRenderOptions, "claheMap"> & {
    claheMap: null | {
      width: number;
      height: number;
      gainBuffer: SharedArrayBuffer;
    };
  };
};

const workerScope = self as unknown as DedicatedWorkerGlobalScope;

workerScope.onmessage = (event: MessageEvent<FullRenderRequest>) => {
  const message = event.data;
  if (!message || message.type !== "render-rows") return;

  try {
    const claheMap: StackClaheMap | null = message.options.claheMap
      ? {
          width: message.options.claheMap.width,
          height: message.options.claheMap.height,
          gain: new Float32Array(message.options.claheMap.gainBuffer),
        }
      : null;
    adjustStackStoredGamma2RowsToLinear(
      new Uint16Array(message.sourceBuffer),
      new Float32Array(message.outputBuffer),
      message.width,
      message.height,
      message.rowStart,
      message.rowEnd,
      { ...message.options, claheMap },
    );
    workerScope.postMessage({
      type: "render-rows-complete",
      requestId: message.requestId,
      workerIndex: message.workerIndex,
      rowStart: message.rowStart,
      rowEnd: message.rowEnd,
    });
  } catch (error) {
    workerScope.postMessage({
      type: "error",
      requestId: message.requestId,
      workerIndex: message.workerIndex,
      message: error instanceof Error ? error.message : String(error),
    });
  }
};
