import type {
  LinearMergeWorkerConfig,
  LinearMergeWorkerRequest,
  LinearMergeWorkerResponse,
  LinearMergeWorkerReadyResponse,
  LinearMergeWorkerStripeResponse,
} from "../workers/protocols/linear-merge-protocol";
import type { LinearMergeStripeJob } from "./linear-merge-pool";

type LinearMergeRequestWithoutId = LinearMergeWorkerRequest extends infer Request
  ? Request extends LinearMergeWorkerRequest
    ? Omit<Request, "requestId">
    : never
  : never;

type LinearMergeResponseType = LinearMergeWorkerResponse["type"];
type LinearMergeResponseOf<Type extends LinearMergeResponseType> = Extract<LinearMergeWorkerResponse, { type: Type }>;

type PendingRequest = {
  resolve: (value: LinearMergeWorkerResponse) => void;
  reject: (reason?: unknown) => void;
  expectedType: LinearMergeResponseType;
};

function asResponse(value: unknown): LinearMergeWorkerResponse | null {
  if (typeof value !== "object" || value === null) return null;
  const message = value as { type?: unknown; requestId?: unknown };
  if (typeof message.type !== "string" || typeof message.requestId !== "number") return null;
  return value as LinearMergeWorkerResponse;
}

function asArrayBuffer(value: unknown, label: string): ArrayBuffer {
  if (value instanceof ArrayBuffer) return value;
  throw new Error(`Worker response did not include a valid ${label} buffer.`);
}

export class LinearMergeWorkerClient {
  private readonly worker: Worker;
  private readonly pending = new Map<number, PendingRequest>();
  private nextRequestId = 1;

  constructor(url: URL) {
    this.worker = new Worker(url);
    this.worker.onmessage = (event) => this.handleMessage(event.data);
    this.worker.onerror = (event) => {
      const error = new Error(event.message || "Linear merge worker failed.");
      for (const pending of this.pending.values()) pending.reject(error);
      this.pending.clear();
    };
    this.worker.onmessageerror = () => {
      const error = new Error("Linear merge worker returned an unreadable message.");
      for (const pending of this.pending.values()) pending.reject(error);
      this.pending.clear();
    };
  }

  initialize(config: LinearMergeWorkerConfig): Promise<{ imageCount: number; width: number; height: number }> {
    return this.request<"ready">(
      {
        type: "init",
        sessionId: config.sessionId,
        alignmentPlan: config.alignmentPlan,
        matrices: config.matrices,
        gains: config.gains,
        weights: config.weights,
        exposureRolloffMaxP998AfterGain: config.exposureRolloffMaxP998AfterGain,
        cacheBytes: config.cacheBytes,
      },
      [],
      "ready",
    ).then((message) => {
      const response = message as LinearMergeWorkerReadyResponse;
      return {
        imageCount: Number(response.imageCount),
        width: Number(response.width),
        height: Number(response.height),
      };
    });
  }

  mergeStripe(job: LinearMergeStripeJob): Promise<Float32Array> {
    return this.request<"merge-stripe-result">(
      { type: "merge-stripe", y: job.y, height: job.height },
      [],
      "merge-stripe-result",
    ).then((message) => {
      const response = message as LinearMergeWorkerStripeResponse;
      return new Float32Array(asArrayBuffer(response.linearBuffer, "linear merge stripe"));
    });
  }

  private request<Type extends LinearMergeResponseType>(
    message: LinearMergeRequestWithoutId,
    transfers: Transferable[],
    expectedType: Type,
  ): Promise<LinearMergeResponseOf<Type>> {
    const requestId = this.nextRequestId++;
    return new Promise<LinearMergeWorkerResponse>((resolve, reject) => {
      this.pending.set(requestId, { resolve, reject, expectedType });
      try {
        this.worker.postMessage({ ...message, requestId }, transfers);
      } catch (error) {
        this.pending.delete(requestId);
        reject(error);
      }
    }).then((response) => response as LinearMergeResponseOf<Type>);
  }

  private handleMessage(value: unknown): void {
    const message = asResponse(value);
    if (!message) return;
    const pending = this.pending.get(message.requestId);
    if (!pending) return;
    this.pending.delete(message.requestId);
    if (message.type === "error") {
      pending.reject(new Error(message.message || "Linear merge worker failed."));
      return;
    }
    if (message.type !== pending.expectedType) {
      pending.reject(new Error(`Unexpected linear merge worker response: ${message.type}`));
      return;
    }
    pending.resolve(message);
  }

  terminate(): void {
    const error = new Error("Linear merge worker was terminated.");
    for (const pending of this.pending.values()) pending.reject(error);
    this.pending.clear();
    this.worker.terminate();
  }
}
