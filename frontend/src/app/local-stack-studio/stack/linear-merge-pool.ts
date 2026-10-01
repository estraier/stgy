import type { LinearMergeWorkerConfig } from "../workers/protocols/linear-merge-protocol";

export const LINEAR_MERGE_MAX_WORKERS = 4;
export const LINEAR_MERGE_TARGET_STRIPE_BYTES = 8 * 1024 * 1024;

export type LinearMergeStripeJob = {
  index: number;
  y: number;
  height: number;
};

export type LinearMergePoolClient = {
  initialize(config: LinearMergeWorkerConfig): Promise<{ imageCount: number; width: number; height: number }>;
  mergeStripe(job: LinearMergeStripeJob): Promise<Float32Array>;
  terminate(): void;
};

export function resolveLinearMergeWorkerCount(
  jobCount: number,
  hardwareConcurrency?: number | null,
): number {
  const jobs = Math.max(0, Math.floor(jobCount));
  if (jobs === 0) return 0;
  const hardware = Number.isFinite(hardwareConcurrency)
    ? Math.max(1, Math.floor(Number(hardwareConcurrency)))
    : LINEAR_MERGE_MAX_WORKERS;
  return Math.max(1, Math.min(LINEAR_MERGE_MAX_WORKERS, hardware, jobs));
}

export function buildLinearMergeStripeJobs(
  width: number,
  height: number,
  targetBytes = LINEAR_MERGE_TARGET_STRIPE_BYTES,
): LinearMergeStripeJob[] {
  if (!(Number.isInteger(width) && width > 0 && Number.isInteger(height) && height > 0)) {
    throw new Error("Linear merge stripe builder received invalid dimensions.");
  }
  const rowBytes = width * 3 * Float32Array.BYTES_PER_ELEMENT;
  const safeTarget = Number.isFinite(targetBytes) && targetBytes > 0
    ? Math.max(rowBytes, Math.floor(targetBytes))
    : LINEAR_MERGE_TARGET_STRIPE_BYTES;
  const rowsPerStripe = Math.max(1, Math.floor(safeTarget / rowBytes));
  const jobs: LinearMergeStripeJob[] = [];
  for (let y = 0, index = 0; y < height; y += rowsPerStripe, index += 1) {
    jobs.push({ index, y, height: Math.min(rowsPerStripe, height - y) });
  }
  return jobs;
}

export async function runLinearMergePool({
  jobs,
  config,
  createClient,
  hardwareConcurrency,
  onJobStart,
  onJobComplete,
}: {
  jobs: LinearMergeStripeJob[];
  config: LinearMergeWorkerConfig;
  createClient: () => LinearMergePoolClient;
  hardwareConcurrency?: number | null;
  onJobStart?: (job: LinearMergeStripeJob, workerIndex: number) => void;
  onJobComplete?: (
    job: LinearMergeStripeJob,
    workerIndex: number,
    stripe: Float32Array,
    completedCount: number,
    totalCount: number,
  ) => void;
}): Promise<{ workerCount: number }> {
  if (jobs.length === 0) return { workerCount: 0 };

  const workerCount = resolveLinearMergeWorkerCount(jobs.length, hardwareConcurrency);
  const clients = Array.from({ length: workerCount }, () => createClient());
  let nextJobIndex = 0;
  let completedCount = 0;
  let firstError: Error | null = null;

  const terminateAll = () => {
    for (const client of clients) {
      try { client.terminate(); } catch { /* Best-effort termination only. */ }
    }
  };

  try {
    await Promise.all(clients.map(async (client) => {
      const ready = await client.initialize(config);
      if (ready.imageCount !== config.matrices.length) {
        throw new Error(
          `Linear merge worker image count ${ready.imageCount} does not match alignment matrix count ${config.matrices.length}.`,
        );
      }
      if (ready.width !== config.alignmentPlan.targetWidth || ready.height !== config.alignmentPlan.targetHeight) {
        throw new Error(
          `Linear merge worker size ${ready.width}x${ready.height} does not match expected ` +
          `${config.alignmentPlan.targetWidth}x${config.alignmentPlan.targetHeight}.`,
        );
      }
    }));

    const runWorker = async (client: LinearMergePoolClient, workerIndex: number) => {
      while (!firstError) {
        const jobIndex = nextJobIndex;
        nextJobIndex += 1;
        if (jobIndex >= jobs.length) return;
        const job = jobs[jobIndex];
        onJobStart?.(job, workerIndex);
        try {
          const stripe = await client.mergeStripe(job);
          const expectedLength = config.alignmentPlan.targetWidth * job.height * 3;
          if (stripe.length !== expectedLength) {
            throw new Error(`Linear merge worker returned an invalid stripe ${job.index + 1}.`);
          }
          completedCount += 1;
          onJobComplete?.(job, workerIndex, stripe, completedCount, jobs.length);
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
