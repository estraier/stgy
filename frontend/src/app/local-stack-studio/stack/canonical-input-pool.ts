// Shared image-task queue. Idle workers take the next admissible image;
// memory-weighted admission prevents oversized TIFF/RAW batches from exhausting
// the browser heap. The caller retains session/error lifecycle ownership.
import type { CanonicalImageRecord, CanonicalInputInfo } from "./canonical-source";
import type {
  CanonicalInputWorkerRequest,
  CanonicalInputWorkerResponse,
} from "../workers/protocols/canonical-input-protocol";

const MIB = 1024 * 1024;
const DEFAULT_MEMORY_BUDGET = 1536 * MIB;
export const MAX_CANONICAL_INPUT_WORKERS = 4;

export type CanonicalInputTask = {
  imageIndex: number;
  file: File;
  inputInfo: CanonicalInputInfo;
};

export type CanonicalTaskExecutor = {
  process(task: CanonicalInputTask, sessionId: string): Promise<CanonicalImageRecord>;
  terminate(): void;
};

export function estimateCanonicalTaskBytes(task: CanonicalInputTask): number {
  const pixels = Math.max(0, task.inputInfo.width * task.inputInfo.height);
  const rawMultiplier = task.inputInfo.isRaw ? 32 : 20;
  const fileOverhead = Math.min(task.file.size, pixels * 8);
  return Math.max(128 * MIB, Math.ceil(pixels * rawMultiplier + fileOverhead + 64 * MIB));
}

export function resolveCanonicalInputWorkerCount(imageCount: number, concurrency?: number): number {
  const cores = Number.isFinite(concurrency) && (concurrency ?? 0) > 0
    ? Math.floor(concurrency!) : 4;
  return Math.max(1, Math.min(MAX_CANONICAL_INPUT_WORKERS, cores, imageCount));
}

export function resolveCanonicalInputMemoryBudget(deviceMemoryGiB?: number): number {
  if (!(typeof deviceMemoryGiB === "number" && Number.isFinite(deviceMemoryGiB) && deviceMemoryGiB > 0)) {
    return DEFAULT_MEMORY_BUDGET;
  }
  return Math.max(512 * MIB, Math.min(DEFAULT_MEMORY_BUDGET, Math.floor(deviceMemoryGiB * 0.3 * 1024 * MIB)));
}

export class CanonicalInputWorkerClient implements CanonicalTaskExecutor {
  private readonly worker: Worker;
  private pending: {
    requestId: number;
    resolve: (value: CanonicalImageRecord) => void;
    reject: (reason: Error) => void;
    progress?: (message: string) => void;
  } | null = null;
  private nextRequestId = 1;

  constructor(url: URL, private readonly onProgress?: (message: string) => void) {
    this.worker = new Worker(url);
    this.worker.onmessage = (event: MessageEvent<CanonicalInputWorkerResponse>) => {
      const message = event.data;
      const pending = this.pending;
      if (!pending || message?.requestId !== pending.requestId) return;
      if (message.type === "progress") {
        pending.progress?.(message.message);
        return;
      }
      this.pending = null;
      if (message.type === "error") {
        pending.reject(new Error(message.message));
      } else if (message.type === "result") {
        if (message.record?.imageIndex !== message.imageIndex || message.imageIndex < 0) {
          pending.reject(new Error("Canonical input Worker returned inconsistent image metadata."));
        } else {
          pending.resolve(message.record);
        }
      }
    };
    this.worker.onerror = (event) => {
      this.failPending(new Error(event.message || "Canonical input Worker failed."));
    };
    this.worker.onmessageerror = () => this.failPending(new Error("Canonical input Worker message could not be decoded."));
  }

  private failPending(error: Error): void {
    const pending = this.pending;
    this.pending = null;
    pending?.reject(error);
  }

  process(task: CanonicalInputTask, sessionId: string): Promise<CanonicalImageRecord> {
    if (this.pending) return Promise.reject(new Error("Canonical input Worker already has a pending image."));
    const requestId = this.nextRequestId++;
    const request: CanonicalInputWorkerRequest = {
      type: "process",
      requestId,
      sessionId,
      imageIndex: task.imageIndex,
      file: task.file,
      inputInfo: {
        width: task.inputInfo.width,
        height: task.inputInfo.height,
        isRaw: false,
        sourceColorSpace: task.inputInfo.sourceColorSpace,
        fNumber: task.inputInfo.fNumber,
        exposureTime: task.inputInfo.exposureTime,
        iso: task.inputInfo.iso,
        exposureScalar: task.inputInfo.exposureScalar,
      },
    };
    return new Promise((resolve, reject) => {
      this.pending = { requestId, resolve, reject, progress: this.onProgress };
      try {
        this.worker.postMessage(request);
      } catch (error) {
        this.failPending(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }

  terminate(): void {
    this.failPending(new Error("Canonical input Worker stopped."));
    this.worker.terminate();
  }
}

export async function runCanonicalInputTaskQueue(options: {
  tasks: readonly CanonicalInputTask[];
  sessionId: string;
  workerCount: number;
  memoryBudgetBytes?: number;
  createExecutor: () => CanonicalTaskExecutor;
  runRaw: (task: CanonicalInputTask) => Promise<CanonicalImageRecord>;
  onStart?: (task: CanonicalInputTask) => void;
  onComplete?: (task: CanonicalInputTask, record: CanonicalImageRecord, completeCount: number) => void;
}): Promise<void> {
  const { tasks, sessionId } = options;
  if (tasks.length === 0) return;
  const requestedWorkers = Number.isFinite(options.workerCount) ? Math.floor(options.workerCount) : 1;
  const workerCount = Math.max(1, Math.min(MAX_CANONICAL_INPUT_WORKERS, requestedWorkers, tasks.length));
  const budget = Math.max(128 * MIB, options.memoryBudgetBytes ?? DEFAULT_MEMORY_BUDGET);
  const waiting = tasks.slice();
  const executors: CanonicalTaskExecutor[] = [];
  let activeBytes = 0;
  let rawBusy = false;
  let completed = 0;
  let failure: Error | null = null;
  let waiters: Array<() => void> = [];

  function wake(): void {
    const current = waiters;
    waiters = [];
    for (const resolve of current) resolve();
  }

  function claim(): { task: CanonicalInputTask; bytes: number } | null {
    if (failure) return null;
    for (let index = 0; index < waiting.length; index += 1) {
      const task = waiting[index];
      if (task.inputInfo.isRaw && rawBusy) continue;
      const bytes = estimateCanonicalTaskBytes(task);
      // An individual oversized image must still be admitted when no other
      // jobs run; otherwise all lanes could wait forever.
      if (activeBytes + bytes > budget && activeBytes !== 0) continue;
      waiting.splice(index, 1);
      activeBytes += bytes;
      if (task.inputInfo.isRaw) rawBusy = true;
      return { task, bytes };
    }
    return null;
  }

  let firstExecutorFailure: Error | null = null;
  try {
    // Keep a bounded, reusable pool. RAW jobs use their established LibRaw
    // route on the main thread, with a single RAW job active at a time.
    const nonRawTasks = tasks.filter((task) => !task.inputInfo.isRaw);
    const smallestTaskBytes = nonRawTasks.length > 0
      ? Math.min(...nonRawTasks.map(estimateCanonicalTaskBytes)) : budget;
    const practicalWorkerCount = Math.max(1, Math.floor(budget / smallestTaskBytes));
    for (let index = 0; index < Math.min(workerCount, nonRawTasks.length, practicalWorkerCount); index += 1) {
      executors.push(options.createExecutor());
    }
  } catch (error) {
    firstExecutorFailure = error instanceof Error ? error : new Error(String(error));
  }
  if (firstExecutorFailure) {
    for (const executor of executors) executor.terminate();
    throw firstExecutorFailure;
  }

  // A lane can execute either a non-RAW Worker task or a RAW job. If every
  // image is RAW, there is one lane and no unnecessary Worker allocation.
  const lanes: Array<CanonicalTaskExecutor | null> = executors.length > 0 ? executors : [null];
  async function consume(executor: CanonicalTaskExecutor | null): Promise<void> {
    while (true) {
      const claimed = claim();
      if (!claimed) {
        if (failure || waiting.length === 0) return;
        await new Promise<void>((resolve) => { waiters.push(resolve); });
        continue;
      }
      const { task, bytes } = claimed;
      try {
        options.onStart?.(task);
        if (!task.inputInfo.isRaw && !executor) {
          throw new Error("No Canonical input Worker is available for this image.");
        }
        const record = task.inputInfo.isRaw
          ? await options.runRaw(task)
          : await executor!.process(task, sessionId);
        if (record.imageIndex !== task.imageIndex || record.sessionId !== sessionId || !record.complete) {
          throw new Error(`Canonical input ${task.imageIndex + 1} returned invalid cache metadata.`);
        }
        completed += 1;
        options.onComplete?.(task, record, completed);
      } catch (error) {
        if (!failure) {
          const detail = error instanceof Error ? error.message : String(error);
          failure = new Error(`Failed to prepare ${task.file.name}: ${detail}`);
        }
      } finally {
        activeBytes -= bytes;
        if (task.inputInfo.isRaw) rawBusy = false;
        wake();
      }
    }
  }

  try {
    await Promise.all(lanes.map((executor) => consume(executor)));
    if (failure) throw failure;
    if (completed !== tasks.length) throw new Error("Canonical input queue did not complete every image.");
  } finally {
    for (const executor of executors) executor.terminate();
  }
}
