// Shared OpenCV bootstrap for Local Stack Studio workers.
const OPENCV_SCRIPT_URL = "/vendor/opencv/opencv.js";

type OpenCvRuntime = {
  Mat: unknown;
  [key: string]: unknown;
};

type WorkerOpenCvGlobal = typeof globalThis & {
  cv?: unknown;
  importScripts?: (...urls: string[]) => void;
};

function workerGlobal(): WorkerOpenCvGlobal {
  return globalThis as WorkerOpenCvGlobal;
}

function isThenable(value: unknown): value is PromiseLike<unknown> {
  if ((typeof value !== "object" && typeof value !== "function") || value === null) return false;
  return typeof (value as { then?: unknown }).then === "function";
}

function isOpenCvRuntime(value: unknown): value is OpenCvRuntime {
  if ((typeof value !== "object" && typeof value !== "function") || value === null) return false;
  return Boolean((value as { Mat?: unknown }).Mat);
}

export async function loadWorkerOpenCv(workerLabel: string): Promise<OpenCvRuntime> {
  const scope = workerGlobal();
  try {
    if (!scope.cv) {
      if (typeof scope.importScripts !== "function") {
        throw new Error("Worker importScripts API is unavailable.");
      }
      scope.importScripts(OPENCV_SCRIPT_URL);
    }
  } catch (error) {
    const detail = error instanceof Error ? `: ${error.message}` : "";
    throw new Error(`Failed to load OpenCV.js in the ${workerLabel} worker${detail}`);
  }

  const runtime = await resolveWorkerOpenCvRuntime(
    scope,
    `Timed out while initializing OpenCV.js in the ${workerLabel} worker.`,
  );
  if (!isOpenCvRuntime(runtime)) {
    throw new Error(`OpenCV.js failed to initialize in the ${workerLabel} worker.`);
  }
  return runtime;
}

async function resolveWorkerOpenCvRuntime(
  scope: WorkerOpenCvGlobal,
  timeoutMessage: string,
): Promise<OpenCvRuntime> {
  const deadline = Date.now() + 30000;
  let candidate: unknown = scope.cv;
  while (Date.now() < deadline) {
    if (isThenable(candidate)) {
      candidate = await candidate;
      continue;
    }
    if (isOpenCvRuntime(candidate)) return candidate;
    await new Promise<void>((resolve) => setTimeout(resolve, 20));
    candidate = scope.cv;
  }
  throw new Error(timeoutMessage);
}
