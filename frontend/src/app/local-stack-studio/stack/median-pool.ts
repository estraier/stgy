import type { MedianWorkerConfig } from "../workers/protocols/median-protocol";

export const MEDIAN_MAX_WORKERS = 4;

export type MedianTileJob = {
  index: number;
  x: number;
  y: number;
  width: number;
  height: number;
};

export type MedianPoolClient = {
  initialize(config: MedianWorkerConfig): Promise<{ imageCount: number }>;
  mergeTile(job: MedianTileJob): Promise<Uint16Array>;
  terminate(): void;
};

export function resolveMedianWorkerCount(
  jobCount: number,
  hardwareConcurrency?: number | null,
): number {
  const jobs = Math.max(0, Math.floor(jobCount));
  if (jobs === 0) return 0;
  const hardware = Number.isFinite(hardwareConcurrency)
    ? Math.max(1, Math.floor(Number(hardwareConcurrency)))
    : MEDIAN_MAX_WORKERS;
  return Math.max(1, Math.min(MEDIAN_MAX_WORKERS, hardware, jobs));
}

export async function runMedianPool({
  jobs,
  config,
  createClient,
  hardwareConcurrency,
  onJobStart,
  onJobComplete,
}: {
  jobs: MedianTileJob[];
  config: MedianWorkerConfig;
  createClient: () => MedianPoolClient;
  hardwareConcurrency?: number | null;
  onJobStart?: (job: MedianTileJob, workerIndex: number) => void;
  onJobComplete?: (
    job: MedianTileJob,
    workerIndex: number,
    tile: Uint16Array,
    completedCount: number,
    totalCount: number,
  ) => void;
}): Promise<{ workerCount: number }> {
  if (jobs.length === 0) return { workerCount: 0 };

  const workerCount = resolveMedianWorkerCount(jobs.length, hardwareConcurrency);
  const clients = Array.from({ length: workerCount }, () => createClient());
  let nextJobIndex = 0;
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
      const ready = await client.initialize(config);
      if (ready.imageCount !== config.matrices.length) {
        throw new Error(
          `Median worker image count ${ready.imageCount} does not match alignment matrix count ${config.matrices.length}.`,
        );
      }
    }));

    const runWorker = async (client: MedianPoolClient, workerIndex: number) => {
      while (!firstError) {
        const jobIndex = nextJobIndex;
        nextJobIndex += 1;
        if (jobIndex >= jobs.length) return;
        const job = jobs[jobIndex];
        onJobStart?.(job, workerIndex);
        try {
          const tile = await client.mergeTile(job);
          if (tile.length !== job.width * job.height * 3) {
            throw new Error(`Median worker returned an invalid tile ${job.index + 1}.`);
          }
          completedCount += 1;
          onJobComplete?.(job, workerIndex, tile, completedCount, jobs.length);
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
