/** Parallel canonical -> 1MP frame preparation. Workers read from the existing
 * IndexedDB canonical session, so no full-resolution buffers cross threads. */
export type PreparedAlignmentFrame = {
  width: number; height: number; fullWidth: number; fullHeight: number;
  exposureScalar: number | null; grayBytes: Uint8Array;
};
export type FrameTiming = {
  readMs: number; normMs: number; colorConversionMs: number;
  resizeMs: number; grayMs: number; totalMs: number;
  workerIndex?: number; queueMs?: number; wallMs?: number;
};
export type FramePreparationJob = {
  index: number; targetWidth: number; targetHeight: number;
  normalizationMode: string; exposureScalar: number | null;
  maxArea?: number;
};

type Response = { type: "ready" | "frame" | "error"; requestId: number; message?: string;
  grayBuffer?: ArrayBuffer; width?: number; height?: number; fullWidth?: number; fullHeight?: number;
  exposureScalar?: number | null; readMs?: number; normMs?: number; colorConversionMs?: number;
  resizeMs?: number; grayMs?: number; totalMs?: number };

export class AlignmentFrameWorkerClient {
  private worker: Worker;
  private nextRequest = 1;
  private pending = new Map<number, { resolve: (message: Response) => void; reject: (error: Error) => void }>();
  constructor(url: URL) {
    this.worker = new Worker(url);
    this.worker.onmessage = ({ data }: MessageEvent<Response>) => {
      const pending = this.pending.get(data.requestId);
      if (!pending) return;
      this.pending.delete(data.requestId);
      if (data.type === "error") pending.reject(new Error(data.message || "Alignment frame generation failed."));
      else pending.resolve(data);
    };
    this.worker.onerror = (event) => { this.failAll(new Error(event.message || "Alignment frame worker failed.")); };
    this.worker.onmessageerror = () => { this.failAll(new Error("Unreadable frame worker response.")); };
  }
  private failAll(error: Error) {
    for (const entry of this.pending.values()) entry.reject(error);
    this.pending.clear();
  }
  private request(message: Record<string, unknown>): Promise<Response> {
    const requestId = this.nextRequest++;
    return new Promise<Response>((resolve, reject) => {
      this.pending.set(requestId, { resolve, reject });
      try { this.worker.postMessage({ ...message, requestId }); }
      catch (error) { this.pending.delete(requestId); reject(error instanceof Error ? error : new Error(String(error))); }
    });
  }
  async initialize(sessionId: string): Promise<void> {
    const response = await this.request({ type: "init", sessionId });
    if (response.type !== "ready") throw new Error("Unexpected alignment frame initialization response.");
  }
  async generate(job: FramePreparationJob): Promise<{ frame: PreparedAlignmentFrame; timing: FrameTiming }> {
    const response = await this.request({ type: "frame", imageIndex: job.index, targetWidth: job.targetWidth,
      targetHeight: job.targetHeight, normalizationMode: job.normalizationMode,
      exposureScalar: job.exposureScalar, maxArea: job.maxArea ?? 1_000_000 });
    if (response.type !== "frame" || !(response.grayBuffer instanceof ArrayBuffer) ||
      !response.width || !response.height || !response.fullWidth || !response.fullHeight) {
      throw new Error("Invalid alignment frame worker result.");
    }
    return { frame: { width: response.width, height: response.height,
      fullWidth: response.fullWidth, fullHeight: response.fullHeight,
      exposureScalar: response.exposureScalar ?? null, grayBytes: new Uint8Array(response.grayBuffer) },
      timing: { readMs: response.readMs ?? 0, normMs: response.normMs ?? 0,
        colorConversionMs: response.colorConversionMs ?? 0, resizeMs: response.resizeMs ?? 0,
        grayMs: response.grayMs ?? 0, totalMs: response.totalMs ?? 0 } };
  }
  terminate(): void { this.failAll(new Error("Alignment frame worker terminated.")); this.worker.terminate(); }
}

/** Starts immediately; individual frames become available before `done`. */
export function startParallelAlignmentFrames({ sessionId, jobs, hardwareConcurrency, onFrame } : {
  sessionId: string; jobs: FramePreparationJob[]; hardwareConcurrency: number;
  onFrame: (index: number, frame: PreparedAlignmentFrame, timing: FrameTiming) => void;
}): { done: Promise<void>; stop: () => void } {
  if (!jobs.length) return { done: Promise.resolve(), stop: () => {} };
  // Preserve the existing two-worker limit to leave headroom for ORB.
  const workers = Array.from({ length: Math.min(2, Math.max(1, hardwareConcurrency - 1), jobs.length) },
    () => new AlignmentFrameWorkerClient(new URL("/generated/local-stack-studio/alignment-frame.worker.js", window.location.origin)));
  let next = 0;
  const stop = () => workers.forEach((worker) => worker.terminate());
  const done = (async () => {
    try {
      await Promise.all(workers.map(async (worker, workerIndex) => {
        await worker.initialize(sessionId);
        while (next < jobs.length) {
          const job = jobs[next++];
          const requestStartedAt = performance.now();
          const { frame, timing } = await worker.generate(job);
          const wallMs = performance.now() - requestStartedAt;
          onFrame(job.index, frame, { ...timing, workerIndex: workerIndex + 1,
            wallMs, queueMs: Math.max(0, wallMs - timing.totalMs) });
        }
      }));
    } finally { stop(); }
  })();
  return { done, stop };
}

/** Phase 2: one bounded pool for both resolutions. All missing coarse frames
 * are dispatched before fine frames, but the fine producer starts as soon as
 * a worker finishes its coarse queue; no main-thread 8MP conversion is used.
 * `coarseDone` is independent of `done`, allowing ORB to begin immediately.
 */
export function startProgressiveAlignmentFrames({
  sessionId, coarseJobs, fineJobs, hardwareConcurrency, onCoarse, onFine, onFineStart,
}: {
  sessionId: string; coarseJobs: FramePreparationJob[]; fineJobs: FramePreparationJob[];
  hardwareConcurrency: number;
  onCoarse: (index: number, frame: PreparedAlignmentFrame, timing: FrameTiming) => void;
  onFine: (index: number, frame: PreparedAlignmentFrame, timing: FrameTiming) => void;
  onFineStart?: (index: number) => void;
}): { coarseDone: Promise<void>; done: Promise<void>; stop: () => void } {
  const tasks = [
    ...coarseJobs.map((job) => ({ job, fine: false })),
    ...fineJobs.map((job) => ({ job, fine: true })),
  ];
  if (!tasks.length) return { coarseDone: Promise.resolve(), done: Promise.resolve(), stop: () => {} };
  const count = Math.min(2, Math.max(1, hardwareConcurrency - 1), tasks.length);
  const workers = Array.from({ length: count },
    () => new AlignmentFrameWorkerClient(new URL("/generated/local-stack-studio/alignment-frame.worker.js", window.location.origin)));
  let cursor = 0;
  let remainingCoarse = coarseJobs.length;
  let coarseResolve!: () => void;
  let coarseReject!: (error: Error) => void;
  const coarseDone = new Promise<void>((resolve, reject) => {
    coarseResolve = resolve;
    coarseReject = reject;
  });
  // The caller may observe coarseDone after another asynchronous operation.
  coarseDone.catch(() => {});
  if (!remainingCoarse) coarseResolve();
  let stopped = false;
  const stop = () => {
    if (stopped) return;
    stopped = true;
    workers.forEach((worker) => worker.terminate());
  };
  const done = (async () => {
    try {
      await Promise.all(workers.map(async (worker, workerIndex) => {
        await worker.initialize(sessionId);
        while (!stopped && cursor < tasks.length) {
          const { job, fine } = tasks[cursor++];
          if (fine) onFineStart?.(job.index);
          const started = performance.now();
          const { frame, timing } = await worker.generate({ ...job, maxArea: fine ? 8_000_000 : 1_000_000 });
          const wallMs = performance.now() - started;
          const measured = { ...timing, workerIndex: workerIndex + 1,
            wallMs, queueMs: Math.max(0, wallMs - timing.totalMs) };
          if (fine) onFine(job.index, frame, measured);
          else {
            onCoarse(job.index, frame, measured);
            if (--remainingCoarse === 0) coarseResolve();
          }
        }
      }));
    } catch (error) {
      coarseReject(error instanceof Error ? error : new Error(String(error)));
      throw error;
    } finally { stop(); }
  })();
  done.catch(() => {});
  return { coarseDone, done, stop };
}
