import type { FocusRunningStats } from "./focus-math";
import type { FocusWorkerCanonicalConfig } from "../workers/protocols/focus-protocol";

export const FOCUS_FEATURE_MAX_WORKERS = 4;

export type FocusFeatureResult = {
  features: Float32Array;
  workingWidth: number;
  workingHeight: number;
  lapStats: FocusRunningStats;
  sobelStats: FocusRunningStats;
};

export type FocusFeaturePoolClient = {
  initializeCanonical(config: FocusWorkerCanonicalConfig): Promise<{
    imageCount: number;
    width: number;
    height: number;
  }>;
  computeSharpnessFeaturesFromCanonical(
    imageIndex: number,
    progressMessage: string,
  ): Promise<FocusFeatureResult>;
  terminate(): void;
};

export function resolveFocusFeatureWorkerCount(
  imageCount: number,
  hardwareConcurrency?: number | null,
): number {
  const jobs = Math.max(0, Math.floor(imageCount));
  if (jobs === 0) return 0;
  const hardware = Number.isFinite(hardwareConcurrency)
    ? Math.max(1, Math.floor(Number(hardwareConcurrency)))
    : FOCUS_FEATURE_MAX_WORKERS;
  return Math.max(1, Math.min(FOCUS_FEATURE_MAX_WORKERS, hardware, jobs));
}

export async function runFocusFeaturePool({
  imageCount,
  width,
  height,
  config,
  createClient,
  hardwareConcurrency,
  onJobStart,
  onJobComplete,
}: {
  imageCount: number;
  width: number;
  height: number;
  config: FocusWorkerCanonicalConfig;
  createClient: () => FocusFeaturePoolClient;
  hardwareConcurrency?: number | null;
  onJobStart?: (imageIndex: number, workerIndex: number) => void;
  onJobComplete?: (
    imageIndex: number,
    workerIndex: number,
    result: FocusFeatureResult,
    completedCount: number,
    totalCount: number,
  ) => void | Promise<void>;
}): Promise<{ workerCount: number }> {
  if (!(Number.isInteger(imageCount) && imageCount > 0)) {
    throw new Error("Focus feature pool requires at least one image.");
  }
  if (!(Number.isInteger(width) && width > 0 && Number.isInteger(height) && height > 0)) {
    throw new Error("Focus feature pool received invalid image dimensions.");
  }

  const workerCount = resolveFocusFeatureWorkerCount(imageCount, hardwareConcurrency);
  const clients = Array.from({ length: workerCount }, () => createClient());
  let nextImageIndex = 0;
  let completedCount = 0;
  let firstError: Error | null = null;

  const terminateAll = () => {
    for (const client of clients) {
      try {
        client.terminate();
      } catch {
        // Best-effort termination only.
      }
    }
  };

  try {
    await Promise.all(clients.map(async (client) => {
      const ready = await client.initializeCanonical(config);
      if (ready.imageCount !== imageCount) {
        throw new Error(
          `Focus worker image count ${ready.imageCount} does not match expected image count ${imageCount}.`,
        );
      }
      if (ready.width !== width || ready.height !== height) {
        throw new Error(
          `Focus worker image size ${ready.width}x${ready.height} does not match expected ${width}x${height}.`,
        );
      }
    }));

    const runWorker = async (client: FocusFeaturePoolClient, workerIndex: number) => {
      while (!firstError) {
        const imageIndex = nextImageIndex;
        nextImageIndex += 1;
        if (imageIndex >= imageCount) return;
        onJobStart?.(imageIndex, workerIndex);
        try {
          const result = await client.computeSharpnessFeaturesFromCanonical(
            imageIndex,
            `Computing Focus sharpness features ${imageIndex + 1}/${imageCount}...`,
          );
          completedCount += 1;
          await onJobComplete?.(
            imageIndex,
            workerIndex,
            result,
            completedCount,
            imageCount,
          );
        } catch (error) {
          if (!firstError) {
            firstError = error instanceof Error ? error : new Error(String(error));
            terminateAll();
          }
          throw firstError;
        }
      }
    };

    await Promise.all(clients.map((client, workerIndex) => runWorker(client, workerIndex)));
    if (firstError) throw firstError;
    return { workerCount };
  } finally {
    terminateAll();
  }
}
