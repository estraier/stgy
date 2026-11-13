/** Worker client for STF midpoint and endpoint extrapolation. Reuses one pair Worker
 * (and its two persistent native OpenCV direction Workers) across all adjacent pairs.
 */
import type {
  OpticalFlowPerformanceStats, OpticalFlowVariant, OpticalFlowWorkerRequest, OpticalFlowWorkerResponse,
} from "../workers/protocols/optical-flow-protocol";

type Pending = {
  resolve: (response: OpticalFlowWorkerResponse) => void;
  reject: (error: Error) => void;
};
export class StfOpticalFlowClient {
  private readonly worker: Worker;
  private readonly requests = new Map<number, Pending>();
  private nextRequestId = 1;

  constructor(onProgress?: (message: string) => void) {
    this.worker = new Worker(new URL("/generated/local-stack-studio/optical-flow.worker.js", window.location.origin));
    this.worker.onmessage = (event: MessageEvent<OpticalFlowWorkerResponse>) => {
      const message = event.data;
      if (!message || typeof message.requestId !== "number") return;
      const pending = this.requests.get(message.requestId);
      if (!pending) return;
      if (message.type === "progress") { onProgress?.(message.message); return; }
      this.requests.delete(message.requestId);
      if (message.type === "error") pending.reject(new Error(message.message));
      else pending.resolve(message);
    };
    this.worker.onerror = (event) => this.failAll(new Error(event.message || "STF Optical Flow worker error"));
    this.worker.onmessageerror = () => this.failAll(new Error("STF Optical Flow worker message error"));
  }

  private failAll(error: Error): void {
    for (const waiting of this.requests.values()) waiting.reject(error);
    this.requests.clear();
  }
  private request(message: Omit<Extract<OpticalFlowWorkerRequest, {type: "interpolate"}>, "requestId"> |
    Omit<Extract<OpticalFlowWorkerRequest, {type: "warmup"}>, "requestId">,
    transfer: Transferable[] = []): Promise<OpticalFlowWorkerResponse> {
    const requestId = this.nextRequestId++;
    return new Promise((resolve, reject) => {
      this.requests.set(requestId, { resolve, reject });
      try { this.worker.postMessage({ ...message, requestId }, transfer); }
      catch (error) { this.requests.delete(requestId); reject(error instanceof Error ? error : new Error(String(error))); }
    });
  }

  async warmup(): Promise<{ flowWorkerCount: number; warmupMs: number }> {
    const result = await this.request({ type: "warmup" });
    if (result.type !== "ready") throw new Error("Unexpected STF Flow warmup response");
    return { flowWorkerCount: result.flowWorkerCount, warmupMs: result.warmupMs };
  }

  async generate(width: number, height: number, previousImageId: number, nextImageId: number,
    previousGamma2: Uint16Array, nextGamma2: Uint16Array, variant: OpticalFlowVariant = "mid",
    additionalVariant?: OpticalFlowVariant,
    sharedGray?: { previous: Uint8Array; next: Uint8Array }): Promise<{
      pixels: Uint16Array; additionalPixels?: Uint16Array; performance: OpticalFlowPerformanceStats;
    }> {
    // The previous image is never used again after this pair: transfer its
    // ownership instead of allocating an unnecessary 115MiB copy. Keep the
    // next image for the following adjacent pair by copying that one only.
    // Shared inputs must remain usable by neighboring, possibly concurrent
    // pairs. Transfer only private copies to the Worker in this path.
    const previousGamma2Buffer = sharedGray
      ? previousGamma2.buffer.slice(previousGamma2.byteOffset, previousGamma2.byteOffset + previousGamma2.byteLength) as ArrayBuffer
      : previousGamma2.buffer instanceof ArrayBuffer &&
        previousGamma2.byteOffset === 0 && previousGamma2.byteLength === previousGamma2.buffer.byteLength
        ? previousGamma2.buffer
        : previousGamma2.buffer.slice(previousGamma2.byteOffset, previousGamma2.byteOffset + previousGamma2.byteLength) as ArrayBuffer;
    const nextGamma2Buffer = nextGamma2.buffer.slice(nextGamma2.byteOffset, nextGamma2.byteOffset + nextGamma2.byteLength) as ArrayBuffer;
    const previousGrayBuffer = sharedGray?.previous.slice().buffer as ArrayBuffer | undefined;
    const nextGrayBuffer = sharedGray?.next.slice().buffer as ArrayBuffer | undefined;
    const transfer: Transferable[] = [previousGamma2Buffer, nextGamma2Buffer];
    if (previousGrayBuffer && nextGrayBuffer) transfer.push(previousGrayBuffer, nextGrayBuffer);
    const result = await this.request({ type: "interpolate", variant, ...(additionalVariant ? { additionalVariant } : {}), width, height,
      previousImageId, nextImageId, linearRangeMax: 4, previousGamma2Buffer, nextGamma2Buffer,
      ...(previousGrayBuffer && nextGrayBuffer ? { previousGrayBuffer, nextGrayBuffer } : {}) }, transfer);
    if (result.type !== "result" || result.width !== width || result.height !== height) {
      throw new Error("Invalid STF midpoint result");
    }
    const pixels = new Uint16Array(result.gamma2Buffer);
    if (pixels.length !== width * height * 3) throw new Error("STF Flow returned an invalid RGB16 buffer");
    const additionalPixels = result.additionalGamma2Buffer
      ? new Uint16Array(result.additionalGamma2Buffer) : undefined;
    if (additionalVariant && (!additionalPixels || additionalPixels.length !== width * height * 3)) {
      throw new Error("STF Flow returned an invalid additional RGB16 buffer");
    }
    if (!additionalVariant && additionalPixels) throw new Error("STF Flow returned an unsolicited frame");
    return { pixels, ...(additionalPixels ? { additionalPixels } : {}), performance: result.performance };
  }

  async midpoint(width: number, height: number, previousImageId: number, nextImageId: number,
    previousGamma2: Uint16Array, nextGamma2: Uint16Array) {
    return this.generate(width, height, previousImageId, nextImageId, previousGamma2, nextGamma2);
  }

  terminate(): void {
    this.failAll(new Error("STF Optical Flow terminated"));
    this.worker.terminate();
  }
}
