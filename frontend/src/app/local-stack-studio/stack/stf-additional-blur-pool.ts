import type { LinearMergeStripeJob } from "./linear-merge-pool";
import type { StfAdditionalBlurMaskStripe } from "./stf-additional-blur-client";
import type { StfAdditionalBlurWorkerConfig } from "../workers/protocols/stf-additional-blur-protocol";

export const STF_ADDITIONAL_BLUR_MAX_WORKERS = 4;

export type StfAdditionalBlurPoolClient = {
  initialize(config: StfAdditionalBlurWorkerConfig): Promise<{ imageCount: number; width: number; height: number }>;
  analyzeMaskStripe(job: LinearMergeStripeJob): Promise<StfAdditionalBlurMaskStripe>;
  applyBlurStripe(
    job: LinearMergeStripeJob,
    mask: Uint16Array,
    edgeProtection: Uint16Array,
    scaledLogFactor: number,
  ): Promise<Float32Array>;
  terminate(): void;
};

export function resolveStfAdditionalBlurWorkerCount(
  jobCount: number,
  hardwareConcurrency?: number | null,
): number {
  const jobs = Math.max(0, Math.floor(jobCount));
  if (jobs === 0) return 0;
  const hardware = Number.isFinite(hardwareConcurrency)
    ? Math.max(1, Math.floor(Number(hardwareConcurrency)))
    : STF_ADDITIONAL_BLUR_MAX_WORKERS;
  return Math.max(1, Math.min(STF_ADDITIONAL_BLUR_MAX_WORKERS, hardware, jobs));
}

async function initializeClients(
  clients: StfAdditionalBlurPoolClient[],
  config: StfAdditionalBlurWorkerConfig,
): Promise<void> {
  await Promise.all(clients.map(async (client) => {
    const ready = await client.initialize(config);
    if (ready.imageCount !== config.matrices.length) {
      throw new Error(
        `STF Additional Blur worker image count ${ready.imageCount} does not match expected ${config.matrices.length}.`,
      );
    }
    if (
      ready.width !== config.alignmentPlan.targetWidth
      || ready.height !== config.alignmentPlan.targetHeight
    ) {
      throw new Error(
        `STF Additional Blur worker size ${ready.width}x${ready.height} does not match expected `
        + `${config.alignmentPlan.targetWidth}x${config.alignmentPlan.targetHeight}.`,
      );
    }
  }));
}

function terminateAll(clients: StfAdditionalBlurPoolClient[]): void {
  for (const client of clients) {
    try { client.terminate(); } catch { /* Best-effort termination only. */ }
  }
}

export async function runStfAdditionalBlurAnalysisPool({
  jobs,
  config,
  createClient,
  hardwareConcurrency,
  onJobComplete,
}: {
  jobs: LinearMergeStripeJob[];
  config: StfAdditionalBlurWorkerConfig;
  createClient: () => StfAdditionalBlurPoolClient;
  hardwareConcurrency?: number | null;
  onJobComplete?: (
    job: LinearMergeStripeJob,
    workerIndex: number,
    result: StfAdditionalBlurMaskStripe,
    completedCount: number,
    totalCount: number,
  ) => void | Promise<void>;
}): Promise<{ workerCount: number }> {
  if (jobs.length === 0) return { workerCount: 0 };
  const workerCount = resolveStfAdditionalBlurWorkerCount(jobs.length, hardwareConcurrency);
  const clients = Array.from({ length: workerCount }, () => createClient());
  let nextJobIndex = 0;
  let completedCount = 0;
  let firstError: Error | null = null;
  try {
    await initializeClients(clients, config);
    const runWorker = async (client: StfAdditionalBlurPoolClient, workerIndex: number) => {
      while (!firstError) {
        const jobIndex = nextJobIndex;
        nextJobIndex += 1;
        if (jobIndex >= jobs.length) return;
        const job = jobs[jobIndex];
        try {
          const result = await client.analyzeMaskStripe(job);
          completedCount += 1;
          await onJobComplete?.(job, workerIndex, result, completedCount, jobs.length);
        } catch (error) {
          if (!firstError) {
            firstError = error instanceof Error ? error : new Error(String(error));
            terminateAll(clients);
          }
          throw firstError;
        }
      }
    };
    await Promise.all(clients.map((client, workerIndex) => runWorker(client, workerIndex)));
    if (firstError) throw firstError;
    return { workerCount };
  } finally {
    terminateAll(clients);
  }
}

export async function runStfAdditionalBlurApplyPool({
  jobs,
  config,
  createClient,
  loadMask,
  loadEdgeProtection,
  scaledLogFactor,
  hardwareConcurrency,
  onJobComplete,
}: {
  jobs: LinearMergeStripeJob[];
  config: StfAdditionalBlurWorkerConfig;
  createClient: () => StfAdditionalBlurPoolClient;
  loadMask: (job: LinearMergeStripeJob) => Promise<Uint16Array>;
  loadEdgeProtection: (job: LinearMergeStripeJob) => Promise<Uint16Array>;
  scaledLogFactor: number;
  hardwareConcurrency?: number | null;
  onJobComplete?: (
    job: LinearMergeStripeJob,
    workerIndex: number,
    result: Float32Array,
    completedCount: number,
    totalCount: number,
  ) => void | Promise<void>;
}): Promise<{ workerCount: number }> {
  if (jobs.length === 0) return { workerCount: 0 };
  const workerCount = resolveStfAdditionalBlurWorkerCount(jobs.length, hardwareConcurrency);
  const clients = Array.from({ length: workerCount }, () => createClient());
  let nextJobIndex = 0;
  let completedCount = 0;
  let firstError: Error | null = null;
  try {
    await initializeClients(clients, config);
    const runWorker = async (client: StfAdditionalBlurPoolClient, workerIndex: number) => {
      while (!firstError) {
        const jobIndex = nextJobIndex;
        nextJobIndex += 1;
        if (jobIndex >= jobs.length) return;
        const job = jobs[jobIndex];
        try {
          const [mask, edgeProtection] = await Promise.all([
            loadMask(job),
            loadEdgeProtection(job),
          ]);
          const result = await client.applyBlurStripe(job, mask, edgeProtection, scaledLogFactor);
          completedCount += 1;
          await onJobComplete?.(job, workerIndex, result, completedCount, jobs.length);
        } catch (error) {
          if (!firstError) {
            firstError = error instanceof Error ? error : new Error(String(error));
            terminateAll(clients);
          }
          throw firstError;
        }
      }
    };
    await Promise.all(clients.map((client, workerIndex) => runWorker(client, workerIndex)));
    if (firstError) throw firstError;
    return { workerCount };
  } finally {
    terminateAll(clients);
  }
}
