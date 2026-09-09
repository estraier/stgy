// Worker protocol types are intentionally kept local to Local Stack Studio.
// The generated worker bundles are implementation details; callers use these typed clients.

type WorkerMessage = {
  [key: string]: unknown;
  type?: string;
  requestId?: number;
  message?: string;
};

type PendingRequest = {
  resolve: (value: WorkerMessage) => void;
  reject: (reason?: unknown) => void;
  expectedType: string;
};

function asWorkerMessage(value: unknown): WorkerMessage {
  return typeof value === "object" && value !== null ? (value as WorkerMessage) : {};
}

function asArrayBuffer(value: unknown, label: string): ArrayBuffer {
  if (value instanceof ArrayBuffer) return value;
  throw new Error(`Worker response did not include a valid ${label} buffer.`);
}

function typedArrayBuffer(value: Uint16Array | Float32Array | Uint8Array): ArrayBuffer {
  if (value.buffer instanceof ArrayBuffer) return value.buffer;
  return value.slice().buffer as ArrayBuffer;
}

export class FocusWorkerClient {
  private readonly worker: Worker;
  private readonly pending = new Map<number, PendingRequest>();
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

  computeSharpness(
    gamma2Rgb: Uint16Array,
    width: number,
    height: number,
    progressMessage: string,
  ): Promise<Float32Array> {
    const gamma2Buffer = typedArrayBuffer(gamma2Rgb);
    return this.request(
      "sharpness",
      {
        width,
        height,
        gamma2Buffer,
        progressMessage,
      },
      [gamma2Buffer],
      "sharpness-result",
    ).then((message) => new Float32Array(asArrayBuffer(message.sharpnessBuffer, "sharpness")));
  }

  computeTauStats(sharpnessTiles: Float32Array[]): Promise<{ sum: number; sumSq: number; count: number }> {
    const buffers = sharpnessTiles.map(typedArrayBuffer);
    return this.request(
      "tau-stats",
      { sharpnessBuffers: buffers },
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
      "merge-tile",
      {
        width,
        height,
        tau,
        pyramidLevels,
        rgbBuffers,
        sharpnessBuffers,
      },
      [...rgbBuffers, ...sharpnessBuffers],
      "merge-tile-result",
    ).then((message) => new Uint16Array(asArrayBuffer(message.gamma2Buffer, "focus merge")));
  }

  private request(
    type: string,
    payload: Record<string, unknown>,
    transfer: Transferable[],
    expectedType: string,
  ): Promise<WorkerMessage> {
    return new Promise((resolve, reject) => {
      const requestId = this.nextRequestId++;
      this.pending.set(requestId, { resolve, reject, expectedType });
      try {
        this.worker.postMessage({ type, requestId, ...payload }, transfer);
      } catch (error) {
        this.pending.delete(requestId);
        reject(error);
      }
    });
  }

  private handleMessage(value: unknown): void {
    const message = asWorkerMessage(value);
    if (message.type === "progress") {
      if (message.message) this.onProgress?.(String(message.message));
      return;
    }
    const requestId = typeof message.requestId === "number" ? message.requestId : null;
    if (requestId === null) return;
    const pending = this.pending.get(requestId);
    if (!pending) return;
    if (message.type === "error") {
      this.pending.delete(requestId);
      pending.reject(new Error(message.message || "Focus worker failed."));
      return;
    }
    if (message.type !== pending.expectedType) return;
    this.pending.delete(requestId);
    pending.resolve(message);
  }

  terminate(): void {
    const error = new Error("Focus worker was terminated.");
    for (const pending of this.pending.values()) pending.reject(error);
    this.pending.clear();
    this.worker.terminate();
  }
}

export type OrbAlignmentResult = {
  matrix: Float64Array;
  referenceFeatureCount: number;
  targetFeatureCount: number;
  matchCount: number;
  usableMatchCount: number;
  matchShiftLimit: number;
  fallbackMode: boolean;
  reprojectionInlierCount: number;
  reprojectionMedianError: number;
  reprojectionP95Error: number;
  referenceExposureGain: number;
  targetExposureGain: number;
  exposureMatchSource: string;
  claheClipLimit: number;
};

export class OrbWorkerClient {
  private readonly worker: Worker;
  private readonly pending = new Map<number, PendingRequest>();
  private nextMessageId = 1;

  constructor(url: URL) {
    this.worker = new Worker(url);
    this.worker.onmessage = (event) => this.handleMessage(event.data);
    this.worker.onerror = (event) => {
      const error = new Error(event.message || "ORB worker failed.");
      for (const pending of this.pending.values()) pending.reject(error);
      this.pending.clear();
    };
  }

  initialize(
    width: number,
    height: number,
    grayBytes: Uint8Array,
    exposureScalar: number | null = null,
  ): Promise<WorkerMessage> {
    const grayBuffer = typedArrayBuffer(grayBytes);
    return this.request(
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
    return this.request(
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
      fallbackMode: Boolean(response.fallbackMode),
      reprojectionInlierCount: Number(response.reprojectionInlierCount),
      reprojectionMedianError: Number(response.reprojectionMedianError),
      reprojectionP95Error: Number(response.reprojectionP95Error),
      referenceExposureGain: Number(response.referenceExposureGain),
      targetExposureGain: Number(response.targetExposureGain),
      exposureMatchSource: String(response.exposureMatchSource ?? ""),
      claheClipLimit: Number(response.claheClipLimit),
    }));
  }

  private request(
    message: Record<string, unknown>,
    transfers: Transferable[],
    expectedType: string,
  ): Promise<WorkerMessage> {
    const requestId = this.nextMessageId++;
    const requestMessage = { ...message, requestId };
    return new Promise((resolve, reject) => {
      this.pending.set(requestId, { resolve, reject, expectedType });
      try {
        this.worker.postMessage(requestMessage, transfers);
      } catch (error) {
        this.pending.delete(requestId);
        reject(error);
      }
    });
  }

  private handleMessage(value: unknown): void {
    const message = asWorkerMessage(value);
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
      pending.reject(new Error(message.message || "ORB worker failed."));
      return;
    }
    if (message.type !== pending.expectedType) {
      pending.reject(new Error(`Unexpected ORB worker response: ${String(message.type)}`));
      return;
    }
    pending.resolve(message);
  }

  terminate(): void {
    this.worker.terminate();
    const error = new Error("ORB worker terminated.");
    for (const pending of this.pending.values()) pending.reject(error);
    this.pending.clear();
  }
}
