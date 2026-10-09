import type { LinearMergeStripeJob } from "./linear-merge-pool";
import type {
  StfAdditionalBlurAnalyzeMaskResponse,
  StfAdditionalBlurApplyResponse,
  StfAdditionalBlurReadyResponse,
  StfAdditionalBlurWorkerConfig,
  StfAdditionalBlurWorkerRequest,
  StfAdditionalBlurWorkerResponse,
} from "../workers/protocols/stf-additional-blur-protocol";

type RequestWithoutId = StfAdditionalBlurWorkerRequest extends infer Request
  ? Request extends StfAdditionalBlurWorkerRequest
    ? Omit<Request, "requestId">
    : never
  : never;

type ResponseType = StfAdditionalBlurWorkerResponse["type"];
type ResponseOf<Type extends ResponseType> = Extract<StfAdditionalBlurWorkerResponse, { type: Type }>;

type PendingRequest = {
  resolve: (value: StfAdditionalBlurWorkerResponse) => void;
  reject: (reason?: unknown) => void;
  expectedType: ResponseType;
};

export type StfAdditionalBlurMaskStripe = {
  mask: Uint16Array;
  edgeProtection: Uint16Array;
  histogram: Uint32Array;
  sampleCount: number;
};

function asResponse(value: unknown): StfAdditionalBlurWorkerResponse | null {
  if (typeof value !== "object" || value === null) return null;
  const message = value as { type?: unknown; requestId?: unknown };
  if (typeof message.type !== "string" || typeof message.requestId !== "number") return null;
  return value as StfAdditionalBlurWorkerResponse;
}

function asArrayBuffer(value: unknown, label: string): ArrayBuffer {
  if (value instanceof ArrayBuffer) return value;
  throw new Error(`STF Additional Blur worker response did not include a valid ${label} buffer.`);
}

export class StfAdditionalBlurWorkerClient {
  private readonly worker: Worker;
  private readonly pending = new Map<number, PendingRequest>();
  private nextRequestId = 1;

  constructor(url: URL) {
    this.worker = new Worker(url);
    this.worker.onmessage = (event) => this.handleMessage(event.data);
    this.worker.onerror = (event) => {
      const error = new Error(event.message || "STF Additional Blur worker failed.");
      for (const pending of this.pending.values()) pending.reject(error);
      this.pending.clear();
    };
    this.worker.onmessageerror = () => {
      const error = new Error("STF Additional Blur worker returned an unreadable message.");
      for (const pending of this.pending.values()) pending.reject(error);
      this.pending.clear();
    };
  }

  initialize(config: StfAdditionalBlurWorkerConfig): Promise<{ imageCount: number; width: number; height: number }> {
    return this.request<"ready">(
      {
        type: "init",
        sessionId: config.sessionId,
        alignmentPlan: config.alignmentPlan,
        matrices: config.matrices,
        gains: config.gains,
        scaledLogs: config.scaledLogs,
        weights: config.weights,
        fNumbers: config.fNumbers,
        apertureOrder: config.apertureOrder,
        exposureRolloffMaxP998AfterGain: config.exposureRolloffMaxP998AfterGain,
        cacheBytes: config.cacheBytes,
      },
      [],
      "ready",
    ).then((message) => {
      const response = message as StfAdditionalBlurReadyResponse;
      return {
        imageCount: Number(response.imageCount),
        width: Number(response.width),
        height: Number(response.height),
      };
    });
  }

  analyzeMaskStripe(job: LinearMergeStripeJob): Promise<StfAdditionalBlurMaskStripe> {
    return this.request<"analyze-mask-stripe-result">(
      { type: "analyze-mask-stripe", stripeIndex: job.index, y: job.y, height: job.height },
      [],
      "analyze-mask-stripe-result",
    ).then((message) => {
      const response = message as StfAdditionalBlurAnalyzeMaskResponse;
      return {
        mask: new Uint16Array(asArrayBuffer(response.maskBuffer, "mask")),
        edgeProtection: new Uint16Array(asArrayBuffer(response.edgeProtectionBuffer, "edge protection")),
        histogram: new Uint32Array(asArrayBuffer(response.histogramBuffer, "histogram")),
        sampleCount: Number(response.sampleCount),
      };
    });
  }

  applyBlurStripe(
    job: LinearMergeStripeJob,
    mask: Uint16Array,
    edgeProtection: Uint16Array,
    scaledLogFactor: number,
  ): Promise<Float32Array> {
    const maskBuffer = mask.buffer as ArrayBuffer;
    const edgeProtectionBuffer = edgeProtection.buffer as ArrayBuffer;
    return this.request<"apply-blur-stripe-result">(
      {
        type: "apply-blur-stripe",
        stripeIndex: job.index,
        y: job.y,
        height: job.height,
        maskBuffer,
        edgeProtectionBuffer,
        scaledLogFactor,
      },
      [maskBuffer, edgeProtectionBuffer],
      "apply-blur-stripe-result",
    ).then((message) => {
      const response = message as StfAdditionalBlurApplyResponse;
      return new Float32Array(asArrayBuffer(response.linearBuffer, "linear"));
    });
  }

  private request<Type extends ResponseType>(
    message: RequestWithoutId,
    transfers: Transferable[],
    expectedType: Type,
  ): Promise<ResponseOf<Type>> {
    const requestId = this.nextRequestId++;
    return new Promise<StfAdditionalBlurWorkerResponse>((resolve, reject) => {
      this.pending.set(requestId, { resolve, reject, expectedType });
      try {
        this.worker.postMessage({ ...message, requestId }, transfers);
      } catch (error) {
        this.pending.delete(requestId);
        reject(error);
      }
    }).then((response) => response as ResponseOf<Type>);
  }

  private handleMessage(value: unknown): void {
    const message = asResponse(value);
    if (!message) return;
    const pending = this.pending.get(message.requestId);
    if (!pending) return;
    this.pending.delete(message.requestId);
    if (message.type === "error") {
      pending.reject(new Error(message.message || "STF Additional Blur worker failed."));
      return;
    }
    if (message.type !== pending.expectedType) {
      pending.reject(new Error(`Unexpected STF Additional Blur worker response: ${message.type}`));
      return;
    }
    pending.resolve(message);
  }

  terminate(): void {
    const error = new Error("STF Additional Blur worker was terminated.");
    for (const pending of this.pending.values()) pending.reject(error);
    this.pending.clear();
    this.worker.terminate();
  }
}
