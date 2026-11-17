import type {
  OpticalFlowOpeningVariant,
  OpticalFlowPerformanceStats,
  OpticalFlowVariant,
  OpticalFlowWorkerRequest,
  OpticalFlowWorkerResponse,
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
    const workerUrl = new URL("/generated/local-stack-studio/optical-flow.worker.js", window.location.origin);
    workerUrl.searchParams.set("revision", "stf-session-flow-20261117-r8-opening-average");
    this.worker = new Worker(workerUrl);
    this.worker.onmessage = (event: MessageEvent<OpticalFlowWorkerResponse>) => {
      const message = event.data;
      if (!message || typeof message.requestId !== "number") return;
      const pending = this.requests.get(message.requestId);
      if (!pending) return;
      if (message.type === "progress") {
        onProgress?.(message.message);
        return;
      }
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

  private request(
    message: Omit<Extract<OpticalFlowWorkerRequest, { type: "interpolate" }>, "requestId"> |
      Omit<Extract<OpticalFlowWorkerRequest, { type: "warmup" }>, "requestId"> |
      Omit<Extract<OpticalFlowWorkerRequest, { type: "warp-retained" }>, "requestId"> |
      Omit<Extract<OpticalFlowWorkerRequest, { type: "warp-opening-average" }>, "requestId">,
    transfer: Transferable[] = [],
  ): Promise<OpticalFlowWorkerResponse> {
    const requestId = this.nextRequestId++;
    return new Promise((resolve, reject) => {
      this.requests.set(requestId, { resolve, reject });
      try {
        this.worker.postMessage({ ...message, requestId }, transfer);
      } catch (error) {
        this.requests.delete(requestId);
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }

  async warmup(): Promise<{ flowWorkerCount: number; warmupMs: number }> {
    const result = await this.request({ type: "warmup" });
    if (result.type !== "ready") throw new Error("Unexpected STF Flow warmup response");
    return { flowWorkerCount: result.flowWorkerCount, warmupMs: result.warmupMs };
  }

  async generate(
    width: number,
    height: number,
    previousImageId: number,
    nextImageId: number,
    previousGamma2: Uint16Array,
    nextGamma2: Uint16Array,
    variant: OpticalFlowVariant = "mid",
    variantScale?: number,
    additionalVariant?: OpticalFlowVariant,
    additionalVariantScale?: number,
    retainPair = false,
    persistFlow = false,
    sessionId?: string,
    sessionCreatedAt?: number,
    alignmentKey?: string,
    openingAverageRadiusSpan?: number,
  ): Promise<{ pixels: Uint16Array; additionalPixels?: Uint16Array; performance: OpticalFlowPerformanceStats }> {
    const previousGamma2Buffer = previousGamma2.buffer.slice(
      previousGamma2.byteOffset,
      previousGamma2.byteOffset + previousGamma2.byteLength,
    ) as ArrayBuffer;
    const nextGamma2Buffer = nextGamma2.buffer.slice(
      nextGamma2.byteOffset,
      nextGamma2.byteOffset + nextGamma2.byteLength,
    ) as ArrayBuffer;
    const transfer: Transferable[] = [previousGamma2Buffer, nextGamma2Buffer];
    const result = await this.request({
      type: "interpolate",
      variant,
      ...(variantScale !== undefined ? { variantScale } : {}),
      ...(additionalVariant ? { additionalVariant } : {}),
      ...(additionalVariantScale !== undefined ? { additionalVariantScale } : {}),
      ...(retainPair ? { retainPair: true } : {}),
      ...(openingAverageRadiusSpan !== undefined ? { openingAverageRadiusSpan } : {}),
      ...(persistFlow ? { persistFlow: true, sessionId, sessionCreatedAt, alignmentKey } : {}),
      width,
      height,
      previousImageId,
      nextImageId,
      linearRangeMax: 4,
      previousGamma2Buffer,
      nextGamma2Buffer,
    }, transfer);
    if (result.type !== "result" || result.width !== width || result.height !== height) {
      throw new Error("Invalid STF midpoint result");
    }
    const pixels = new Uint16Array(result.gamma2Buffer);
    if (pixels.length !== width * height * 3) throw new Error("STF Flow returned an invalid RGB16 buffer");
    const additionalPixels = result.additionalGamma2Buffer ? new Uint16Array(result.additionalGamma2Buffer) : undefined;
    if (additionalVariant && (!additionalPixels || additionalPixels.length !== width * height * 3)) {
      throw new Error("STF Flow returned an invalid additional RGB16 buffer");
    }
    return { pixels, ...(additionalPixels ? { additionalPixels } : {}), performance: result.performance };
  }

  async warpRetained(
    width: number,
    height: number,
    previousImageId: number,
    nextImageId: number,
    variant: OpticalFlowVariant,
    variantScale?: number,
  ): Promise<{ pixels: Uint16Array; warpMs: number }> {
    const result = await this.request({ type: "warp-retained", previousImageId, nextImageId, variant,
      ...(variantScale !== undefined ? { variantScale } : {}) });
    if (result.type !== "warp-result" || result.width !== width || result.height !== height) {
      throw new Error("Invalid STF retained Flow warp result");
    }
    const pixels = new Uint16Array(result.gamma2Buffer);
    if (pixels.length !== width * height * 3) throw new Error("Invalid STF retained Flow RGB16 buffer");
    return { pixels, warpMs: result.warpMs };
  }

  async warpOpeningAverage(
    width: number, height: number, sourceImageId: number,
    variant: OpticalFlowOpeningVariant, variantScale: number,
    sourceGamma2?: Uint16Array,
  ): Promise<{ pixels: Uint16Array; warpMs: number }> {
    const buffer = sourceGamma2?.buffer.slice(sourceGamma2.byteOffset,
      sourceGamma2.byteOffset + sourceGamma2.byteLength) as ArrayBuffer | undefined;
    const result = await this.request({
      type: "warp-opening-average", sourceImageId, variant, variantScale,
      ...(buffer ? { sourceGamma2Buffer: buffer } : {}),
    }, buffer ? [buffer] : []);
    if (result.type !== "warp-result" || result.width !== width || result.height !== height) {
      throw new Error("Invalid STF opening Average Flow warp result");
    }
    const pixels = new Uint16Array(result.gamma2Buffer);
    if (pixels.length !== width * height * 3) throw new Error("Invalid STF opening Average Flow RGB16 buffer");
    return { pixels, warpMs: result.warpMs };
  }

  releaseRetained(): void {
    this.worker.postMessage({ type: "release-retained", requestId: 0 });
  }

  terminate(): void {
    this.failAll(new Error("STF Optical Flow terminated"));
    this.worker.terminate();
  }
}
