import {
  STF_ADDITIONAL_BLUR_PROTOCOL_VERSION,
  type StfAdditionalBlurWorkerConfig,
  type StfAdditionalBlurWorkerRequest,
  type StfAdditionalBlurWorkerResponse,
  type StfAdditionalBlurWorkerReadyResponse,
  type StfAdditionalBlurWorkerAnalyzeStripeResponse,
  type StfAdditionalBlurWorkerRatioStripeResponse,
  type StfAdditionalBlurWorkerGraphCutResponse,
  type StfAdditionalBlurWorkerVolumeClosingResponse,
  type StfAdditionalBlurWorkerBlurStripeResponse,
  type StfAdditionalBlurWorkerExpandGateStripeResponse,
} from "../workers/protocols/stf-additional-blur-protocol";
import type { LinearMergeStripeJob } from "./linear-merge-pool";
import type { StfRelativeChannelFloors, StfSampleGrid } from "./stf-additional-blur";

export type StfAdditionalBlurAnalyzeResult = {
  linear: Float32Array; fineLogSum: Float32Array; fineZero: Uint8Array;
  coarseGroups: Float32Array; groupCount: number;
};
export type StfAdditionalBlurRatioRequest = {
  fineLogSum: Float32Array; fineZero: Uint8Array; coarseGroups: Float32Array;
  groupCount: number; epsilon: number; visualization?: "fine" | "coarse" | "ratio" | "ratio-v2" | "ratio-x1.2" | "ratio-x1.4" | "ratio-x1.5" | "ratio-x1.6" | "ratio-x2.0";
};
export type StfAdditionalBlurExpandGateRequest = {
  regionHeight: number; coreOffsetY: number; coreHeight: number; radius: number; gate: Float32Array;
};
export type StfAdditionalBlurBlurRequest = {
  regionHeight: number; coreOffsetY: number; coreHeight: number; radius: number;
  source: Float32Array; gate: Float32Array;
};
type RequestWithoutId = StfAdditionalBlurWorkerRequest extends infer Request
  ? Request extends StfAdditionalBlurWorkerRequest ? Omit<Request, "requestId"> : never : never;
type ResponseType = StfAdditionalBlurWorkerResponse["type"];
type ResponseOf<Type extends ResponseType> = Extract<StfAdditionalBlurWorkerResponse, { type: Type }>;
type PendingRequest = {
  resolve: (value: StfAdditionalBlurWorkerResponse) => void;
  reject: (reason?: unknown) => void;
  expectedType: ResponseType;
};
function asBuffer(value: unknown, label: string): ArrayBuffer {
  if (value instanceof ArrayBuffer) return value;
  throw new Error(`STF Additional blur Worker returned an invalid ${label} buffer.`);
}
function checkVersion(actual: string): void {
  if (actual !== STF_ADDITIONAL_BLUR_PROTOCOL_VERSION) {
    throw new Error("STF Additional blur Worker is outdated. Rebuild workers and reload the page.");
  }
}
export class StfAdditionalBlurWorkerClient {
  private readonly worker: Worker;
  private readonly pending = new Map<number, PendingRequest>();
  private nextRequestId = 1;
  constructor(url: URL) {
    this.worker = new Worker(url);
    this.worker.onmessage = (e) => this.handleMessage(e.data);
    this.worker.onerror = (e) => this.rejectAll(new Error(e.message || "STF Additional blur Worker failed."));
    this.worker.onmessageerror = () => this.rejectAll(new Error("STF Additional blur Worker sent an unreadable message."));
  }
  initialize(config: StfAdditionalBlurWorkerConfig): Promise<StfAdditionalBlurWorkerReadyResponse> {
    return this.request("ready", { type: "init", ...config }, []).then((response) => {
      checkVersion(response.protocolVersion);
      return response;
    });
  }
  analyzeStripe(job: LinearMergeStripeJob, includeSource: boolean): Promise<StfAdditionalBlurAnalyzeResult> {
    return this.request("analyze-stripe-result", { type: "analyze-stripe", y: job.y, height: job.height, includeSource }, []).then((value) => {
      const r = value as StfAdditionalBlurWorkerAnalyzeStripeResponse;
      return { linear: new Float32Array(asBuffer(r.linearBuffer, "linear")),
        fineLogSum: new Float32Array(asBuffer(r.fineLogSumBuffer, "fine log sum")),
        fineZero: new Uint8Array(asBuffer(r.fineZeroBuffer, "fine zero")),
        coarseGroups: new Float32Array(asBuffer(r.coarseGroupsBuffer, "coarse groups")),
        groupCount: Number(r.groupCount) };
    });
  }
  sampleBrightnessStripe(job: LinearMergeStripeJob, grid: StfSampleGrid): Promise<Float32Array> {
    return this.request("sample-brightness-stripe-result", {
      type: "sample-brightness-stripe", y: job.y, height: job.height,
      stride: grid.stride, offsetX: grid.offsetX, offsetY: grid.offsetY,
    }, []).then((r) => new Float32Array(asBuffer(r.samplesBuffer, "brightness samples")));
  }
  configureRelativeChannelFloors(floors: StfRelativeChannelFloors): Promise<StfRelativeChannelFloors> {
    return this.request("relative-floors-configured", { type: "configure-relative-floors", floors }, []).then((r) => r.floors);
  }
  ratioStripe(r: StfAdditionalBlurRatioRequest): Promise<Float32Array> {
    const fineLogSumBuffer = r.fineLogSum.buffer as ArrayBuffer;
    const fineZeroBuffer = r.fineZero.buffer as ArrayBuffer;
    const coarseGroupsBuffer = r.coarseGroups.buffer as ArrayBuffer;
    return this.request("ratio-stripe-result", {
      type: "ratio-stripe", pixelCount: r.fineLogSum.length, groupCount: r.groupCount, epsilon: r.epsilon,
      visualization: r.visualization,
      fineLogSumBuffer, fineZeroBuffer, coarseGroupsBuffer,
    }, [fineLogSumBuffer, fineZeroBuffer, coarseGroupsBuffer]).then((value: StfAdditionalBlurWorkerRatioStripeResponse) =>
      new Float32Array(asBuffer(value.logRatioBuffer, "log ratio")));
  }
  volumeClose(values: Float32Array, width: number, height: number): Promise<{
    values: Float32Array; info: { workingWidth: number; workingHeight: number; volumeThreshold: number };
  }> {
    const unitRatioBuffer = values.buffer as ArrayBuffer;
    return this.request("volume-close-result", { type: "volume-close", width, height, unitRatioBuffer },
      [unitRatioBuffer]).then((r: StfAdditionalBlurWorkerVolumeClosingResponse) => {
      checkVersion(r.protocolVersion);
      return { values: new Float32Array(asBuffer(r.unitRatioBuffer, "closed gate")),
        info: { workingWidth: r.workingWidth, workingHeight: r.workingHeight, volumeThreshold: r.volumeThreshold } };
    });
  }
  graphCut(confidence: Float32Array, width: number, height: number, blurRatio: number): Promise<{
    mask: Uint8Array; info: Omit<StfAdditionalBlurWorkerGraphCutResponse, "type" | "requestId" | "maskBuffer">;
  }> {
    const confidenceBuffer = confidence.buffer as ArrayBuffer;
    return this.request("graph-cut-result", { type: "graph-cut", width, height, blurRatio, confidenceBuffer },
      [confidenceBuffer]).then((r: StfAdditionalBlurWorkerGraphCutResponse) => {
      checkVersion(r.protocolVersion);
      return { mask: new Uint8Array(asBuffer(r.maskBuffer, "cut mask")),
        info: { protocolVersion: r.protocolVersion, workingWidth: r.workingWidth, workingHeight: r.workingHeight,
          targetWhiteFraction: r.targetWhiteFraction, achievedWhiteFraction: r.achievedWhiteFraction,
          cuts: r.cuts, areaBias: r.areaBias } };
    });
  }
  expandGateStripe(r: StfAdditionalBlurExpandGateRequest): Promise<Float32Array> {
    const gateBuffer = r.gate.buffer as ArrayBuffer;
    return this.request("expand-gate-stripe-result", {
      type: "expand-gate-stripe", regionHeight: r.regionHeight, coreOffsetY: r.coreOffsetY,
      coreHeight: r.coreHeight, radius: r.radius, gateBuffer,
    }, [gateBuffer]).then((value: StfAdditionalBlurWorkerExpandGateStripeResponse) => {
      checkVersion(value.protocolVersion);
      return new Float32Array(asBuffer(value.gateBuffer, "expanded gate"));
    });
  }
  blurStripe(r: StfAdditionalBlurBlurRequest): Promise<Float32Array> {
    const sourceBuffer = r.source.buffer as ArrayBuffer;
    const gateBuffer = r.gate.buffer as ArrayBuffer;
    return this.request("blur-stripe-result", {
      type: "blur-stripe", regionHeight: r.regionHeight, coreOffsetY: r.coreOffsetY,
      coreHeight: r.coreHeight, radius: r.radius, sourceBuffer, gateBuffer,
    }, [sourceBuffer, gateBuffer]).then((value: StfAdditionalBlurWorkerBlurStripeResponse) => {
      checkVersion(value.protocolVersion);
      return new Float32Array(asBuffer(value.linearBuffer, "blurred linear"));
    });
  }
  terminate(): void {
    this.rejectAll(new Error("STF Additional blur Worker terminated."));
    this.worker.terminate();
  }
  private request<T extends ResponseType>(type: T, message: RequestWithoutId, transfer: Transferable[]): Promise<ResponseOf<T>> {
    const requestId = this.nextRequestId++;
    return new Promise<StfAdditionalBlurWorkerResponse>((resolve, reject) => {
      this.pending.set(requestId, { resolve, reject, expectedType: type });
      try { this.worker.postMessage({ ...message, requestId }, transfer); }
      catch (error) { this.pending.delete(requestId); reject(error); }
    }) as Promise<ResponseOf<T>>;
  }
  private handleMessage(value: unknown): void {
    if (!value || typeof value !== "object" || !("requestId" in value)) {
      this.rejectAll(new Error("STF Additional blur Worker returned an invalid response.")); return;
    }
    const msg = value as StfAdditionalBlurWorkerResponse;
    const pending = this.pending.get(msg.requestId);
    if (!pending) return;
    this.pending.delete(msg.requestId);
    if (msg.type === "error") { pending.reject(new Error(msg.message)); return; }
    if (msg.type !== pending.expectedType) {
      pending.reject(new Error(`STF Additional blur Worker response mismatch: ${msg.type}.`)); return;
    }
    pending.resolve(msg);
  }
  private rejectAll(error: Error): void {
    for (const req of this.pending.values()) req.reject(error);
    this.pending.clear();
  }
}
