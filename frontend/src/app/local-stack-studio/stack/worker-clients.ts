import type { FocusRunningStats } from "./focus-math";
import type {
  AlignmentWorkerRequest,
  EccReadyResponse,
  EccResultResponse,
  EccWorkerResponse,
  OrbReadyResponse,
  OrbResultResponse,
  OrbWorkerResponse,
} from "../workers/protocols/alignment-protocol";
import type {
  FocusWorkerRequest,
  FocusWorkerResponse,
} from "../workers/protocols/focus-protocol";
import type {
  Hdr1ResultResponse,
  Hdr1StreamAbortRequest,
  Hdr1StreamFinalizeRequest,
  Hdr1StreamImageRequest,
  Hdr1StreamInitRequest,
  Hdr2ResultResponse,
  Hdr2StreamAbortRequest,
  Hdr2StreamFinalizeRequest,
  Hdr2StreamImageRequest,
  Hdr2StreamInitRequest,
  HdrWorkerResponse,
} from "../workers/protocols/hdr-protocol";

// Worker protocol types are intentionally kept local to Local Stack Studio.
// The generated worker bundles are implementation details; callers use these typed clients.

type FocusRequestWithoutId = FocusWorkerRequest extends infer Request
  ? Request extends FocusWorkerRequest
    ? Omit<Request, "requestId">
    : never
  : never;

type FocusResponseType = FocusWorkerResponse["type"];
type FocusResponseOf<Type extends FocusResponseType> = Extract<FocusWorkerResponse, { type: Type }>;

type FocusPendingRequest = {
  resolve: (value: FocusWorkerResponse) => void;
  reject: (reason?: unknown) => void;
  expectedType: FocusResponseType;
};

function asFocusWorkerResponse(value: unknown): FocusWorkerResponse | null {
  if (typeof value !== "object" || value === null) return null;
  const message = value as { type?: unknown; requestId?: unknown };
  if (typeof message.type !== "string" || typeof message.requestId !== "number") return null;
  return value as FocusWorkerResponse;
}

function asArrayBuffer(value: unknown, label: string): ArrayBuffer {
  if (value instanceof ArrayBuffer) return value;
  throw new Error(`Worker response did not include a valid ${label} buffer.`);
}

function typedArrayBuffer(value: Uint16Array | Float32Array | Uint8Array): ArrayBuffer {
  if (value.buffer instanceof ArrayBuffer) return value.buffer;
  return value.slice().buffer as ArrayBuffer;
}

function copiedTypedArrayBuffer(value: Uint16Array | Float32Array | Uint8Array): ArrayBuffer {
  return value.slice().buffer as ArrayBuffer;
}

export class FocusWorkerClient {
  private readonly worker: Worker;
  private readonly pending = new Map<number, FocusPendingRequest>();
  private nextRequestId = 1;

  constructor(url: URL, private readonly onProgress?: (message: string) => void) {
    this.worker = new Worker(url);
    this.worker.onmessage = (event) => this.handleMessage(event.data);
    this.worker.onerror = (event) => {
      const error = new Error(event.message || "Focus worker failed.");
      for (const pending of this.pending.values()) pending.reject(error);
      this.pending.clear();
    };
  }

  computeSharpnessFeatures(
    gamma2Rgb: Uint16Array,
    width: number,
    height: number,
    progressMessage: string,
  ): Promise<{
    features: Float32Array;
    workingWidth: number;
    workingHeight: number;
    lapStats: FocusRunningStats;
    sobelStats: FocusRunningStats;
  }> {
    const gamma2Buffer = typedArrayBuffer(gamma2Rgb);
    return this.request(
      { type: "sharpness-features", width, height, gamma2Buffer, progressMessage },
      [gamma2Buffer],
      "sharpness-features-result",
    ).then((message) => ({
      features: new Float32Array(asArrayBuffer(message.featureBuffer, "sharpness feature")),
      workingWidth: Number(message.workingWidth),
      workingHeight: Number(message.workingHeight),
      lapStats: {
        count: Number(message.lapCount),
        mean: Number(message.lapMean),
        m2: Number(message.lapM2),
      },
      sobelStats: {
        count: Number(message.sobelCount),
        mean: Number(message.sobelMean),
        m2: Number(message.sobelM2),
      },
    }));
  }

  composeSharpness(
    features: Float32Array,
    workingWidth: number,
    workingHeight: number,
    width: number,
    height: number,
    globalLapMean: number,
    globalLapStd: number,
    globalSobelMean: number,
    globalSobelStd: number,
    progressMessage: string,
  ): Promise<Float32Array> {
    const featureBuffer = typedArrayBuffer(features);
    return this.request(
      {
        type: "sharpness-compose",
        workingWidth,
        workingHeight,
        width,
        height,
        globalLapMean,
        globalLapStd,
        globalSobelMean,
        globalSobelStd,
        featureBuffer,
        progressMessage,
      },
      [featureBuffer],
      "sharpness-compose-result",
    ).then((message) => new Float32Array(asArrayBuffer(message.sharpnessBuffer, "sharpness")));
  }

  computeTauStats(sharpnessTiles: Float32Array[]): Promise<{ sum: number; sumSq: number; count: number }> {
    const buffers = sharpnessTiles.map(copiedTypedArrayBuffer);
    return this.request(
      { type: "tau-stats", sharpnessBuffers: buffers },
      buffers,
      "tau-stats-result",
    ).then((message) => ({
      sum: Number(message.sum),
      sumSq: Number(message.sumSq),
      count: Number(message.count),
    }));
  }

  mergeTile(
    rgbTiles: Uint16Array[],
    sharpnessTiles: Float32Array[],
    width: number,
    height: number,
    tau: number,
    pyramidLevels: number,
  ): Promise<Uint16Array> {
    const rgbBuffers = rgbTiles.map(typedArrayBuffer);
    const sharpnessBuffers = sharpnessTiles.map(typedArrayBuffer);
    return this.request(
      { type: "merge-tile", width, height, tau, pyramidLevels, rgbBuffers, sharpnessBuffers },
      [...rgbBuffers, ...sharpnessBuffers],
      "merge-tile-result",
    ).then((message) => new Uint16Array(asArrayBuffer(message.gamma2Buffer, "focus merge")));
  }

  initializeWorkingSharpness(
    sharpnessMaps: Float32Array[],
    workingWidth: number,
    workingHeight: number,
    imageWidth: number,
    imageHeight: number,
    transferOwnership = false,
  ): Promise<void> {
    const sharpnessBuffers = transferOwnership
      ? sharpnessMaps.map(typedArrayBuffer)
      : sharpnessMaps.map(copiedTypedArrayBuffer);
    return this.request(
      { type: "working-sharpness-init", sharpnessBuffers, workingWidth, workingHeight, imageWidth, imageHeight },
      [...sharpnessBuffers],
      "working-sharpness-init-result",
    ).then(() => undefined);
  }

  beginFocusCore(
    regionX: number,
    regionY: number,
    regionWidth: number,
    regionHeight: number,
    coreOffsetX: number,
    coreOffsetY: number,
    coreWidth: number,
    coreHeight: number,
    tau: number,
    pyramidDownsamples: number,
  ): Promise<void> {
    return this.request(
      {
        type: "focus-core-begin",
        regionX, regionY, regionWidth, regionHeight,
        coreOffsetX, coreOffsetY, coreWidth, coreHeight,
        tau, pyramidDownsamples,
      },
      [],
      "focus-core-begin-result",
    ).then(() => undefined);
  }

  addFocusCoreImage(imageIndex: number, rgb: Uint16Array): Promise<void> {
    const rgbBuffer = typedArrayBuffer(rgb);
    return this.request(
      { type: "focus-core-add-image", imageIndex, rgbBuffer },
      [rgbBuffer],
      "focus-core-add-image-result",
    ).then(() => undefined);
  }

  finishFocusCore(): Promise<Uint16Array> {
    return this.request(
      { type: "focus-core-finish" },
      [],
      "focus-core-finish-result",
    ).then((message) => new Uint16Array(asArrayBuffer(message.gamma2Buffer, "focus merge")));
  }

  private request<Type extends FocusResponseType>(
    message: FocusRequestWithoutId,
    transfer: Transferable[],
    expectedType: Type,
  ): Promise<FocusResponseOf<Type>> {
    const promise = new Promise<FocusWorkerResponse>((resolve, reject) => {
      const requestId = this.nextRequestId++;
      this.pending.set(requestId, { resolve, reject, expectedType });
      try {
        this.worker.postMessage({ ...message, requestId }, transfer);
      } catch (error) {
        this.pending.delete(requestId);
        reject(error);
      }
    });
    return promise.then((response) => response as FocusResponseOf<Type>);
  }

  private handleMessage(value: unknown): void {
    const message = asFocusWorkerResponse(value);
    if (!message) return;
    if (message.type === "progress") {
      if (message.message) this.onProgress?.(message.message);
      return;
    }
    const pending = this.pending.get(message.requestId);
    if (!pending) return;
    if (message.type === "error") {
      this.pending.delete(message.requestId);
      pending.reject(new Error(message.message || "Focus worker failed."));
      return;
    }
    if (message.type !== pending.expectedType) return;
    this.pending.delete(message.requestId);
    pending.resolve(message);
  }

  terminate(): void {
    const error = new Error("Focus worker was terminated.");
    for (const pending of this.pending.values()) pending.reject(error);
    this.pending.clear();
    this.worker.terminate();
  }
}

export type EccAlignmentResult = Omit<
  EccResultResponse,
  "type" | "requestId" | "id" | "fileName" | "matrixBuffer"
> & { matrix: Float64Array };

export type OrbAlignmentResult = Omit<
  OrbResultResponse,
  "type" | "requestId" | "id" | "fileName" | "matrixBuffer"
> & { matrix: Float64Array };


type AlignmentRequestWithoutId = AlignmentWorkerRequest extends infer Request
  ? Request extends AlignmentWorkerRequest
    ? Omit<Request, "requestId">
    : never
  : never;

type AlignmentWorkerResponse = EccWorkerResponse | OrbWorkerResponse;
type AlignmentResponseType = AlignmentWorkerResponse["type"];

type AlignmentPendingRequest = {
  resolve: (value: AlignmentWorkerResponse) => void;
  reject: (reason?: unknown) => void;
  expectedType: AlignmentResponseType;
};

function asAlignmentWorkerResponse(value: unknown): AlignmentWorkerResponse | null {
  if (typeof value !== "object" || value === null) return null;
  const message = value as { type?: unknown; requestId?: unknown };
  if (typeof message.type !== "string") return null;
  if (message.type !== "error" && typeof message.requestId !== "number") return null;
  return value as AlignmentWorkerResponse;
}
class AlignmentWorkerRpcClient {
  private readonly worker: Worker;
  private readonly pending = new Map<number, AlignmentPendingRequest>();
  private nextMessageId = 1;

  constructor(url: URL, private readonly label: string) {
    this.worker = new Worker(url);
    this.worker.onmessage = (event) => this.handleMessage(event.data);
    this.worker.onerror = (event) => {
      const error = new Error(event.message || `${this.label} worker failed.`);
      for (const pending of this.pending.values()) pending.reject(error);
      this.pending.clear();
    };
  }

  protected request<Response extends AlignmentWorkerResponse>(
    message: AlignmentRequestWithoutId,
    transfers: Transferable[],
    expectedType: Response["type"],
  ): Promise<Response> {
    const requestId = this.nextMessageId++;
    const requestMessage = { ...message, requestId } as AlignmentWorkerRequest;
    return new Promise<AlignmentWorkerResponse>((resolve, reject) => {
      this.pending.set(requestId, { resolve, reject, expectedType });
      try {
        this.worker.postMessage(requestMessage, transfers);
      } catch (error) {
        this.pending.delete(requestId);
        reject(error);
      }
    }).then((response) => response as Response);
  }

  private handleMessage(value: unknown): void {
    const message = asAlignmentWorkerResponse(value);
    if (!message) return;
    const requestId = typeof message.requestId === "number" ? message.requestId : null;
    let pending = requestId !== null ? this.pending.get(requestId) ?? null : null;
    if (!pending && this.pending.size === 1) {
      const key = this.pending.keys().next().value as number | undefined;
      if (key !== undefined) {
        pending = this.pending.get(key) ?? null;
        this.pending.delete(key);
      }
    } else if (pending && requestId !== null) {
      this.pending.delete(requestId);
    }
    if (!pending) return;
    if (message.type === "error") {
      pending.reject(new Error(message.message || `${this.label} worker failed.`));
      return;
    }
    if (message.type !== pending.expectedType) {
      pending.reject(new Error(`Unexpected ${this.label} worker response: ${String(message.type)}`));
      return;
    }
    pending.resolve(message);
  }

  terminate(): void {
    this.worker.terminate();
    const error = new Error(`${this.label} worker terminated.`);
    for (const pending of this.pending.values()) pending.reject(error);
    this.pending.clear();
  }
}

export class EccWorkerClient extends AlignmentWorkerRpcClient {
  constructor(url: URL) {
    super(url, "ECC");
  }

  initialize(
    width: number,
    height: number,
    grayBytes: Uint8Array,
    exposureScalar: number | null = null,
  ): Promise<EccReadyResponse> {
    const grayBuffer = typedArrayBuffer(grayBytes);
    return this.request<EccReadyResponse>(
      { type: "init", width, height, grayBuffer, exposureScalar },
      [grayBuffer],
      "ready",
    );
  }

  align(
    id: number,
    fileName: string,
    grayBytes: Uint8Array,
    exposureScalar: number | null = null,
  ): Promise<EccAlignmentResult> {
    const grayBuffer = typedArrayBuffer(grayBytes);
    return this.request<EccResultResponse>(
      { type: "align", id, fileName, grayBuffer, exposureScalar },
      [grayBuffer],
      "result",
    ).then((response) => ({
      matrix: new Float64Array(asArrayBuffer(response.matrixBuffer, "alignment matrix")),
      correlation: Number(response.correlation),
      initialCorrelation: Number(response.initialCorrelation),
      correlationImprovement: Number(response.correlationImprovement),
      workingWidth: Number(response.workingWidth),
      workingHeight: Number(response.workingHeight),
      pyramidLevels: Number(response.pyramidLevels),
      scaleX: Number(response.scaleX),
      scaleY: Number(response.scaleY),
      shearCosine: Number(response.shearCosine),
      translationRatio: Number(response.translationRatio),
      referenceExposureGain: Number(response.referenceExposureGain),
      targetExposureGain: Number(response.targetExposureGain),
      exposureMatchSource: response.exposureMatchSource,
      maskCoverage: Number(response.maskCoverage),
    }));
  }
}

export class OrbWorkerClient extends AlignmentWorkerRpcClient {
  constructor(url: URL) {
    super(url, "ORB");
  }

  initialize(
    width: number,
    height: number,
    grayBytes: Uint8Array,
    exposureScalar: number | null = null,
  ): Promise<OrbReadyResponse> {
    const grayBuffer = typedArrayBuffer(grayBytes);
    return this.request<OrbReadyResponse>(
      { type: "init", width, height, grayBuffer, exposureScalar },
      [grayBuffer],
      "ready",
    );
  }

  align(
    id: number,
    fileName: string,
    grayBytes: Uint8Array,
    exposureScalar: number | null = null,
  ): Promise<OrbAlignmentResult> {
    const grayBuffer = typedArrayBuffer(grayBytes);
    return this.request<OrbResultResponse>(
      { type: "align", id, fileName, grayBuffer, exposureScalar },
      [grayBuffer],
      "result",
    ).then((response) => ({
      matrix: new Float64Array(asArrayBuffer(response.matrixBuffer, "alignment matrix")),
      referenceFeatureCount: Number(response.referenceFeatureCount),
      targetFeatureCount: Number(response.targetFeatureCount),
      matchCount: Number(response.matchCount),
      usableMatchCount: Number(response.usableMatchCount),
      matchShiftLimit: Number(response.matchShiftLimit),
      fallbackMode: response.fallbackMode,
      reprojectionInlierCount: Number(response.reprojectionInlierCount),
      reprojectionMedianError: Number(response.reprojectionMedianError),
      reprojectionP95Error: Number(response.reprojectionP95Error),
      referenceExposureGain: Number(response.referenceExposureGain),
      targetExposureGain: Number(response.targetExposureGain),
      exposureMatchSource: response.exposureMatchSource,
      claheClipLimit: Number(response.claheClipLimit),
    }));
  }
}


export type HdrStreamWorkerClient = {
  addImage(index: number, image: Float32Array, brightness: number): Promise<void>;
  finalize(): Promise<Float32Array>;
  terminate(): void;
};

type HdrStreamRequest =
  | Hdr1StreamInitRequest
  | Hdr1StreamImageRequest
  | Hdr1StreamFinalizeRequest
  | Hdr1StreamAbortRequest
  | Hdr2StreamInitRequest
  | Hdr2StreamImageRequest
  | Hdr2StreamFinalizeRequest
  | Hdr2StreamAbortRequest;

type HdrStreamRequestWithoutId = HdrStreamRequest extends infer Request
  ? Request extends HdrStreamRequest
    ? Omit<Request, "requestId">
    : never
  : never;

type HdrResponseType = HdrWorkerResponse["type"];
type HdrResponseOf<Type extends HdrResponseType> = Extract<HdrWorkerResponse, { type: Type }>;

type HdrPendingRequest = {
  resolve: (value: HdrWorkerResponse) => void;
  reject: (reason?: unknown) => void;
  expectedType: HdrResponseType;
};

function asHdrWorkerResponse(value: unknown): HdrWorkerResponse | null {
  if (typeof value !== "object" || value === null) return null;
  const message = value as { type?: unknown };
  if (typeof message.type !== "string") return null;
  return value as HdrWorkerResponse;
}

class HdrStreamWorkerRpcClient {
  private readonly worker: Worker;
  private readonly pending = new Map<number, HdrPendingRequest>();
  private nextRequestId = 1;
  private terminated = false;
  private settled = false;

  constructor(
    private readonly url: URL,
    private readonly label: string,
    private readonly onProgress?: (message: string) => void,
  ) {
    this.worker = new Worker(url);
    this.worker.onmessage = (event) => this.handleMessage(event.data);
    this.worker.onerror = (event) => {
      if (this.settled || this.terminated) return;
      const detail = event.message ? `: ${event.message}` : "";
      this.fail(new Error(`Failed to start ${this.label} worker ${this.url.pathname}${detail}`));
    };
    this.worker.onmessageerror = () => {
      if (this.settled || this.terminated) return;
      this.fail(new Error(`${this.label} worker ${this.url.pathname} returned an unreadable message.`));
    };
  }

  request<Type extends HdrResponseType>(
    message: HdrStreamRequestWithoutId,
    transfers: Transferable[],
    expectedType: Type,
  ): Promise<HdrResponseOf<Type>> {
    if (this.terminated) {
      return Promise.reject(new Error(`${this.label} worker is no longer available.`));
    }
    const promise = new Promise<HdrWorkerResponse>((resolve, reject) => {
      const requestId = this.nextRequestId++;
      this.pending.set(requestId, { resolve, reject, expectedType });
      try {
        this.worker.postMessage({ ...message, requestId }, transfers);
      } catch (error) {
        this.pending.delete(requestId);
        reject(error);
      }
    });
    return promise.then((response) => response as HdrResponseOf<Type>);
  }

  markSettledAndTerminate(): void {
    this.settled = true;
    this.cleanup();
  }

  terminateWithAbort(
    abortType: "merge-stream-abort" | "mertens-stream-abort",
    abortedType: "merge-stream-aborted" | "mertens-stream-aborted",
  ): void {
    if (this.terminated || this.settled) return;
    const error = new Error(`${this.label} worker was terminated.`);
    this.failAll(error);
    const requestId = this.nextRequestId++;
    try {
      const message: Hdr1StreamAbortRequest | Hdr2StreamAbortRequest = abortType === "merge-stream-abort"
        ? { type: "merge-stream-abort", requestId }
        : { type: "mertens-stream-abort", requestId };
      this.worker.postMessage(message);
    } catch {
      this.cleanup();
      return;
    }
    const timeout = setTimeout(() => this.cleanup(), 1000);
    const previousOnMessage = this.worker.onmessage;
    this.worker.onmessage = (event) => {
      const message = asHdrWorkerResponse(event.data);
      if (
        message &&
        message.type === abortedType &&
        "requestId" in message &&
        message.requestId === requestId
      ) {
        clearTimeout(timeout);
        this.cleanup();
        return;
      }
      previousOnMessage?.call(this.worker, event);
    };
  }

  private handleMessage(value: unknown): void {
    const message = asHdrWorkerResponse(value);
    if (!message) return;
    if (message.type === "progress") {
      if (message.message) this.onProgress?.(message.message);
      return;
    }
    if (message.type === "error") {
      if (this.settled) return;
      this.fail(new Error(message.message || `${this.label} worker failed.`));
      return;
    }
    if (!("requestId" in message) || typeof message.requestId !== "number") return;
    const pending = this.pending.get(message.requestId);
    if (!pending) return;
    if (message.type !== pending.expectedType) {
      this.pending.delete(message.requestId);
      pending.reject(new Error(
        `${this.label} worker returned ${message.type}; expected ${pending.expectedType}.`,
      ));
      return;
    }
    this.pending.delete(message.requestId);
    pending.resolve(message);
  }

  private fail(error: Error): void {
    this.settled = true;
    this.failAll(error);
    this.cleanup();
  }

  private failAll(error: Error): void {
    for (const request of this.pending.values()) request.reject(error);
    this.pending.clear();
  }

  private cleanup(): void {
    if (this.terminated) return;
    this.terminated = true;
    this.worker.terminate();
  }
}

export function createHdrDebevecReinhardStreamWorkerClient(
  url: URL,
  onProgress: (message: string) => void,
  width: number,
  height: number,
  imageCount: number,
  exposureTimes: Float32Array | number[] | null,
  linearResponseFlags: Uint8Array | null = null,
): HdrStreamWorkerClient {
  const rpc = new HdrStreamWorkerRpcClient(url, "HDR1 stream", onProgress);
  const times = exposureTimes ? new Float32Array(exposureTimes) : new Float32Array(0);
  const flags = linearResponseFlags
    ? new Uint8Array(linearResponseFlags)
    : new Uint8Array(imageCount).fill(1);
  const ready = rpc.request(
    {
      type: "merge-stream-init",
      width,
      height,
      imageCount,
      exposureTimesBuffer: times.buffer as ArrayBuffer,
      linearResponseFlagsBuffer: flags.buffer as ArrayBuffer,
    },
    [times.buffer as ArrayBuffer, flags.buffer as ArrayBuffer],
    "merge-stream-ready",
  );

  return {
    async addImage(index: number, image: Float32Array, brightness: number): Promise<void> {
      await ready;
      if (!(image instanceof Float32Array)) {
        throw new Error("HDR1 stream input is not a Float32 RGB buffer.");
      }
      const imageBuffer = typedArrayBuffer(image);
      await rpc.request(
        { type: "merge-stream-image", imageIndex: index, brightness, imageBuffer },
        [imageBuffer],
        "merge-stream-image-stored",
      );
    },
    async finalize(): Promise<Float32Array> {
      await ready;
      onProgress("Merging HDR1 with Debevec radiance recovery...");
      const response = await rpc.request(
        { type: "merge-stream-finalize" },
        [],
        "result",
      ) as Hdr1ResultResponse;
      const result = new Float32Array(response.linearProPhotoBuffer);
      rpc.markSettledAndTerminate();
      return result;
    },
    terminate(): void {
      rpc.terminateWithAbort("merge-stream-abort", "merge-stream-aborted");
    },
  };
}

export function createHdrMertensStreamWorkerClient(
  url: URL,
  onProgress: (message: string) => void,
  width: number,
  height: number,
  imageCount: number,
  saturationWeight: number,
  exposureWeight: number,
): HdrStreamWorkerClient {
  const rpc = new HdrStreamWorkerRpcClient(url, "HDR2 Mertens stream", onProgress);
  const ready = rpc.request(
    { type: "mertens-stream-init", width, height, imageCount, saturationWeight, exposureWeight },
    [],
    "mertens-stream-ready",
  );

  return {
    async addImage(index: number, image: Float32Array, brightness: number): Promise<void> {
      await ready;
      if (!(image instanceof Float32Array)) {
        throw new Error("HDR2 stream input is not a Float32 RGB buffer.");
      }
      const imageBuffer = typedArrayBuffer(image);
      await rpc.request(
        { type: "mertens-stream-image", imageIndex: index, brightness, imageBuffer },
        [imageBuffer],
        "mertens-stream-image-stored",
      );
    },
    async finalize(): Promise<Float32Array> {
      await ready;
      onProgress("Merging HDR2 with Mertens exposure fusion...");
      const response = await rpc.request(
        { type: "mertens-stream-finalize" },
        [],
        "mertens-result",
      ) as Hdr2ResultResponse;
      const result = new Float32Array(response.gamma2Buffer);
      rpc.markSettledAndTerminate();
      return result;
    },
    terminate(): void {
      rpc.terminateWithAbort("mertens-stream-abort", "mertens-stream-aborted");
    },
  };
}
