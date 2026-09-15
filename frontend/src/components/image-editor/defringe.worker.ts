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
    const magentaExpanded1Buffer = map.magentaExpanded1?.buffer as ArrayBuffer | undefined;
    const greenExpanded1Buffer = map.greenExpanded1?.buffer as ArrayBuffer | undefined;
    const magentaExpanded2Buffer = map.magentaExpanded2?.buffer as ArrayBuffer | undefined;
    const greenExpanded2Buffer = map.greenExpanded2?.buffer as ArrayBuffer | undefined;
    const transfer: Transferable[] = [magentaBuffer, greenBuffer];
    if (magentaExpanded1Buffer) transfer.push(magentaExpanded1Buffer);
    if (greenExpanded1Buffer) transfer.push(greenExpanded1Buffer);
    if (magentaExpanded2Buffer) transfer.push(magentaExpanded2Buffer);
    if (greenExpanded2Buffer) transfer.push(greenExpanded2Buffer);
    scope.postMessage(
      {
        type: "complete",
        width: map.width,
        height: map.height,
        magentaBuffer,
        greenBuffer,
        magentaExpanded1Buffer,
        greenExpanded1Buffer,
        magentaExpanded2Buffer,
        greenExpanded2Buffer,
      },
      transfer,
    );
  } catch (error) {
    scope.postMessage({ type: "error", message: error instanceof Error ? error.message : String(error) });
  }
};
