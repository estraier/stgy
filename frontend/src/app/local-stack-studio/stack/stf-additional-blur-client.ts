import type {
  StfAdditionalBlurWorkerAreaClosingResponse,
  StfAdditionalBlurWorkerAnalyzeStripeResponse,
  StfAdditionalBlurWorkerBrightnessSampleResponse,
  StfAdditionalBlurWorkerConfigureFloorsResponse,
  StfAdditionalBlurWorkerBlurStripeResponse,
  StfAdditionalBlurWorkerConfig,
  StfAdditionalBlurWorkerReadyResponse,
  StfAdditionalBlurWorkerRequest,
  StfAdditionalBlurWorkerResponse,
  StfAdditionalBlurWorkerRatioStripeResponse,
} from "../workers/protocols/stf-additional-blur-protocol";
import type { LinearMergeStripeJob } from "./linear-merge-pool";
import type { StfRelativeChannelFloors, StfSampleGrid } from "./stf-additional-blur";

export type StfAdditionalBlurAnalyzeResult = {
  linear: Float32Array;
  fineLogSum: Float32Array;
  fineZero: Uint8Array;
  coarseGroups: Float32Array;
  groupCount: number;
};

export type StfAdditionalBlurRatioRequest = {
  fineLogSum: Float32Array;
  fineZero: Uint8Array;
  coarseGroups: Float32Array;
  groupCount: number;
  epsilon: number;
};

export type StfAdditionalBlurBlurRequest = {
  regionHeight: number;
  coreOffsetY: number;
  coreHeight: number;
  radius: number;
  source: Float32Array;
  gate: Float32Array;
};

type RequestWithoutId = StfAdditionalBlurWorkerRequest extends infer Request
  ? Request extends StfAdditionalBlurWorkerRequest ? Omit<Request, "requestId"> : never
  : never;

type ResponseType = StfAdditionalBlurWorkerResponse["type"];
type ResponseOf<Type extends ResponseType> = Extract<StfAdditionalBlurWorkerResponse, { type: Type }>;

type PendingRequest = {
  resolve: (value: StfAdditionalBlurWorkerResponse) => void;
  reject: (reason?: unknown) => void;
  expectedType: ResponseType;
};

function asResponse(value: unknown): StfAdditionalBlurWorkerResponse | null {
  if (typeof value !== "object" || value === null) return null;
  const message = value as { type?: unknown; requestId?: unknown };
  if (typeof message.type !== "string" || typeof message.requestId !== "number") return null;
  return value as StfAdditionalBlurWorkerResponse;
}

function asArrayBuffer(value: unknown, label: string): ArrayBuffer {
  if (value instanceof ArrayBuffer) return value;
  throw new Error(`STF Additional blur worker response did not include a valid ${label} buffer.`);
}

export class StfAdditionalBlurWorkerClient {
  private readonly worker: Worker;
  private readonly pending = new Map<number, PendingRequest>();
  private nextRequestId = 1;

  constructor(url: URL) {
    this.worker = new Worker(url);
    this.worker.onmessage = (event) => this.handleMessage(event.data);
    this.worker.onerror = (event) => this.rejectAll(new Error(event.message || "STF Additional blur worker failed."));
    this.worker.onmessageerror = () => this.rejectAll(new Error("STF Additional blur worker returned an unreadable message."));
  }

  initialize(config: StfAdditionalBlurWorkerConfig): Promise<StfAdditionalBlurWorkerReadyResponse> {
    return this.request("ready", {
      type: "init",
      sessionId: config.sessionId,
      alignmentPlan: config.alignmentPlan,
      matrices: config.matrices,
      gains: config.gains,
      scaledLogs: config.scaledLogs,
      weights: config.weights,
      fNumbers: config.fNumbers,
      relativeSharpness: config.relativeSharpness,
      relativeBrightnessFloor: config.relativeBrightnessFloor,
      relativeCombineMode: config.relativeCombineMode,
      cacheBytes: config.cacheBytes,
    }, []);
  }

  analyzeStripe(job: LinearMergeStripeJob): Promise<StfAdditionalBlurAnalyzeResult> {
    return this.request("analyze-stripe-result", {
      type: "analyze-stripe",
      y: job.y,
      height: job.height,
    }, []).then((message) => {
      const response = message as StfAdditionalBlurWorkerAnalyzeStripeResponse;
      return {
        linear: new Float32Array(asArrayBuffer(response.linearBuffer, "linear")),
        fineLogSum: new Float32Array(asArrayBuffer(response.fineLogSumBuffer, "fine log sum")),
        fineZero: new Uint8Array(asArrayBuffer(response.fineZeroBuffer, "fine zero mask")),
        coarseGroups: new Float32Array(asArrayBuffer(response.coarseGroupsBuffer, "coarse groups")),
        groupCount: Number(response.groupCount),
      };
    });
  }

  sampleBrightnessStripe(job: LinearMergeStripeJob, grid: StfSampleGrid): Promise<Float32Array> {
    return this.request("sample-brightness-stripe-result", {
      type: "sample-brightness-stripe",
      y: job.y,
      height: job.height,
      stride: grid.stride,
      offsetX: grid.offsetX,
      offsetY: grid.offsetY,
    }, []).then((message) => {
      const response = message as StfAdditionalBlurWorkerBrightnessSampleResponse;
      return new Float32Array(asArrayBuffer(response.samplesBuffer, "RGB brightness samples"));
    });
  }

  configureRelativeChannelFloors(floors: StfRelativeChannelFloors): Promise<StfRelativeChannelFloors> {
    return this.request("relative-floors-configured", {
      type: "configure-relative-floors",
      floors,
    }, []).then((message) => (message as StfAdditionalBlurWorkerConfigureFloorsResponse).floors);
  }

  ratioStripe(request: StfAdditionalBlurRatioRequest): Promise<Float32Array> {
    const fineLogSumBuffer = request.fineLogSum.buffer as ArrayBuffer;
    const fineZeroBuffer = request.fineZero.buffer as ArrayBuffer;
    const coarseGroupsBuffer = request.coarseGroups.buffer as ArrayBuffer;
    return this.request("ratio-stripe-result", {
      type: "ratio-stripe",
      pixelCount: request.fineLogSum.length,
      groupCount: request.groupCount,
      epsilon: request.epsilon,
      fineLogSumBuffer,
      fineZeroBuffer,
      coarseGroupsBuffer,
    }, [fineLogSumBuffer, fineZeroBuffer, coarseGroupsBuffer]).then((message) => {
      const response = message as StfAdditionalBlurWorkerRatioStripeResponse;
      return new Float32Array(asArrayBuffer(response.logRatioBuffer, "log ratio"));
    });
  }

  interpolateLogRatio(values: Float32Array, width: number, height: number, closingMode: "area" | "volume" | "volume2" = "area"): Promise<{
    values: Float32Array;
    info: { workingWidth: number; workingHeight: number; areaThreshold?: number; volumeThreshold?: number };
  }> {
    const buffer = values.buffer as ArrayBuffer;
    return this.request("area-close-result", {
      type: "area-close",
      closingMode,
      width,
      height,
      logRatioBuffer: buffer,
    }, [buffer]).then((message) => {
      const response = message as StfAdditionalBlurWorkerAreaClosingResponse;
      if (response.closingMode !== closingMode
        || (closingMode === "volume2" && response.closingImplementation !== "rim-mean-v2")) {
        throw new Error("STF Closing Worker is outdated or returned a different mode. Rebuild workers and reload.");
      }
      return {
        values: new Float32Array(asArrayBuffer(response.logRatioBuffer, "interpolated ratio")),
        info: {
          workingWidth: response.workingWidth,
          workingHeight: response.workingHeight,
          areaThreshold: response.areaThreshold,
          volumeThreshold: response.volumeThreshold,
        },
      };
    });
  }

  blurStripe(request: StfAdditionalBlurBlurRequest): Promise<Float32Array> {
    const sourceBuffer = request.source.buffer as ArrayBuffer;
    const gateBuffer = request.gate.buffer as ArrayBuffer;
    return this.request("blur-stripe-result", {
      type: "blur-stripe",
      regionHeight: request.regionHeight,
      coreOffsetY: request.coreOffsetY,
      coreHeight: request.coreHeight,
      radius: request.radius,
      sourceBuffer,
      gateBuffer,
    }, [sourceBuffer, gateBuffer]).then((message) => {
      const response = message as StfAdditionalBlurWorkerBlurStripeResponse;
      return new Float32Array(asArrayBuffer(response.linearBuffer, "blurred linear"));
    });
  }

  terminate(): void {
    this.rejectAll(new Error("STF Additional blur worker was terminated."));
    this.worker.terminate();
  }

  private request<Type extends ResponseType>(
    expectedType: Type,
    message: RequestWithoutId,
    transfer: Transferable[],
  ): Promise<ResponseOf<Type>> {
    const requestId = this.nextRequestId++;
    return new Promise<StfAdditionalBlurWorkerResponse>((resolve, reject) => {
      this.pending.set(requestId, { resolve, reject, expectedType });
      try {
        this.worker.postMessage({ ...message, requestId }, transfer);
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
      pending.reject(new Error(message.message || "STF Additional blur worker failed."));
      return;
    }
    if (message.type !== pending.expectedType) {
      pending.reject(new Error(`Unexpected STF Additional blur worker response: ${message.type}`));
      return;
    }
    pending.resolve(message);
  }

  private rejectAll(error: Error): void {
    for (const pending of this.pending.values()) pending.reject(error);
    this.pending.clear();
  }
}
