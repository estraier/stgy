/// <reference lib="webworker" />
import { analyzeDefringeSample } from "./defringe";
import type { LinearRgbSample } from "./types";

const scope = self as unknown as DedicatedWorkerGlobalScope;
scope.onmessage = (event: MessageEvent<{ dataBuffer: ArrayBuffer; width: number; height: number }>) => {
  try {
    const sample: LinearRgbSample = {
      data: new Float32Array(event.data.dataBuffer),
      width: event.data.width,
      height: event.data.height,
    };
    const map = analyzeDefringeSample(sample);
    const magentaBuffer = map.magenta.buffer as ArrayBuffer;
    const greenBuffer = map.green.buffer as ArrayBuffer;
    scope.postMessage(
      { type: "complete", width: map.width, height: map.height, magentaBuffer, greenBuffer },
      [magentaBuffer, greenBuffer],
    );
  } catch (error) {
    scope.postMessage({ type: "error", message: error instanceof Error ? error.message : String(error) });
  }
};
