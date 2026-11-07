import { isAlignmentImplementationError } from "../workers/alignment-error";

export const ALIGNMENT_MAX_WORKERS = 4;

export type AlignmentPoolFrame = {
  width: number;
  height: number;
  grayBytes: Uint8Array | ArrayBufferLike;
  exposureScalar: number | null;
  refinement?: { width: number; height: number; grayBytes: Uint8Array | ArrayBufferLike };
};

export type AlignmentPoolJob = {
  id: number;
  fileName: string;
  frame: AlignmentPoolFrame;
};

export type AlignmentPoolClient<Ready, Result> = {
  initialize(
    width: number,
    height: number,
    grayBytes: Uint8Array,
    exposureScalar?: number | null,
    refinement?: AlignmentPoolFrame["refinement"],
  ): Promise<Ready>;
  align(
    id: number,
    fileName: string,
    grayBytes: Uint8Array,
    exposureScalar?: number | null,
    refinement?: AlignmentPoolFrame["refinement"],
  ): Promise<Result>;
  terminate(): void;
};

export type AlignmentPoolSuccess<Result> = {
  job: AlignmentPoolJob;
  result: Result;
};

export type AlignmentPoolFailure = {
  job: AlignmentPoolJob;
  error: Error;
};

export type AlignmentPoolResult<Ready, Result> = {
  workerCount: number;
  /** Wall-clock time for worker startup and reference initialization (ms). */
  initializationMs: number;
  /** Wall-clock time for all target jobs, including parallel scheduling (ms). */
  jobsMs: number;
  ready: Ready[];
  successes: AlignmentPoolSuccess<Result>[];
  failures: AlignmentPoolFailure[];
};

export function resolveAlignmentWorkerCount(
  jobCount: number,
  hardwareConcurrency?: number | null,
): number {
  const jobs = Math.max(0, Math.floor(jobCount));
  if (jobs === 0) return 0;
  const hardware = Number.isFinite(hardwareConcurrency)
    ? Math.max(1, Math.floor(Number(hardwareConcurrency)))
    : ALIGNMENT_MAX_WORKERS;
  return Math.max(1, Math.min(ALIGNMENT_MAX_WORKERS, hardware, jobs));
}

function copyGrayBytes(frame: AlignmentPoolFrame): Uint8Array {
  if (frame.grayBytes instanceof Uint8Array) return new Uint8Array(frame.grayBytes);
  return new Uint8Array(frame.grayBytes).slice();
}

function asError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

export async function runAlignmentPool<Ready, Result>({
  jobs,
  referenceFrame,
  createClient,
  hardwareConcurrency,
  onReady,
  onJobStart,
  onJobComplete,
  jobReady,
}: {
  jobs: AlignmentPoolJob[];
  referenceFrame: AlignmentPoolFrame;
  jobReady?: (id: number) => Promise<void>;
  createClient: () => AlignmentPoolClient<Ready, Result>;
  hardwareConcurrency?: number | null;
  onReady?: (workerIndex: number, ready: Ready) => void;
  onJobStart?: (job: AlignmentPoolJob, workerIndex: number) => void;
  onJobComplete?: (
    job: AlignmentPoolJob,
    workerIndex: number,
    outcome: { result: Result } | { error: Error },
  ) => void;
}): Promise<AlignmentPoolResult<Ready, Result>> {
  if (jobs.length === 0) {
    return { workerCount: 0, initializationMs: 0, jobsMs: 0, ready: [], successes: [], failures: [] };
  }

  const initializationStartedAt = performance.now();
  const workerCount = resolveAlignmentWorkerCount(jobs.length, hardwareConcurrency);
  const clients = Array.from({ length: workerCount }, () => createClient());
  const ready = new Array<Ready>(workerCount);
  const successes: AlignmentPoolSuccess<Result>[] = [];
  const failures: AlignmentPoolFailure[] = [];
  const initializationErrors: Error[] = [];
  let fatalError: Error | null = null;
  let nextJobIndex = 0;

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
    const initializedClients: Array<{ workerIndex: number; client: AlignmentPoolClient<Ready, Result> }> = [];
    await Promise.all(clients.map(async (client, workerIndex) => {
      try {
        const initialized = await client.initialize(
          referenceFrame.width,
          referenceFrame.height,
          copyGrayBytes(referenceFrame),
          referenceFrame.exposureScalar,
          referenceFrame.refinement,
        );
        ready[workerIndex] = initialized;
        initializedClients.push({ workerIndex, client });
        onReady?.(workerIndex, initialized);
      } catch (error) {
        if (isAlignmentImplementationError(error)) {
          fatalError = asError(error);
          terminateAll();
          throw fatalError;
        }
        initializationErrors.push(asError(error));
        try {
          client.terminate();
        } catch {
          // Best-effort termination only.
        }
      }
    }));

    if (fatalError) throw fatalError;
    const initializationMs = performance.now() - initializationStartedAt;
    if (initializedClients.length === 0) {
      const details = Array.from(new Set(initializationErrors.map((error) => error.message)))
        .filter(Boolean)
        .join("; ");
      const error = new Error(
        details
          ? `Could not initialize alignment reference. ${details}`
          : "Could not initialize alignment reference.",
      );
      return {
        workerCount: 0,
        initializationMs,
        jobsMs: 0,
        ready: [],
        successes,
        failures: jobs.map((job) => ({ job, error })),
      };
    }

    const runWorker = async ({ workerIndex, client }: { workerIndex: number; client: AlignmentPoolClient<Ready, Result> }) => {
      while (!fatalError) {
        const jobIndex = nextJobIndex;
        nextJobIndex += 1;
        if (jobIndex >= jobs.length) return;
        const job = jobs[jobIndex];
        try {
          if (jobReady) await jobReady(job.id);
          if (fatalError) return;
          onJobStart?.(job, workerIndex);
          const result = await client.align(
            job.id,
            job.fileName,
            copyGrayBytes(job.frame),
            job.frame.exposureScalar,
            job.frame.refinement,
          );
          successes.push({ job, result });
          onJobComplete?.(job, workerIndex, { result });
        } catch (error) {
          if (isAlignmentImplementationError(error)) {
            fatalError = asError(error);
            terminateAll();
            throw fatalError;
          }
          const failure = asError(error);
          failures.push({ job, error: failure });
          onJobComplete?.(job, workerIndex, { error: failure });
        }
      }
    };

    const jobsStartedAt = performance.now();
    await Promise.all(initializedClients.map(runWorker));
    const jobsMs = performance.now() - jobsStartedAt;
    if (fatalError) throw fatalError;
    return {
      workerCount: initializedClients.length,
      initializationMs,
      jobsMs,
      ready: initializedClients.map(({ workerIndex }) => ready[workerIndex]),
      successes,
      failures,
    };
  } finally {
    terminateAll();
  }
}

/** Each worker retains its 1MP estimates by image ID. When it has no more
 * 1MP jobs, it refines whichever of its images has an 8MP frame ready first.
 * A slow 8MP frame never blocks another ready refinement on that worker. */
export async function runProgressivePipelinedPool<Ready, Result>({
  jobs, referenceFrame, createClient, hardwareConcurrency, prepareRefinement,
  coarseReady, coarsePreparation, refinementReady, onJobStart, onJobComplete, onStageEvent,
}: {
  jobs: AlignmentPoolJob[];
  referenceFrame: AlignmentPoolFrame;
  createClient: () => AlignmentPoolClient<Ready, Result> & {
    alignCoarse(id: number, fileName: string, grayBytes: Uint8Array, exposureScalar: number | null): Promise<Result>;
    refine(id: number, fileName: string, refinement: NonNullable<AlignmentPoolFrame["refinement"]>,
      referenceRefinement: NonNullable<AlignmentPoolFrame["refinement"]>): Promise<Result>;
  };
  hardwareConcurrency?: number | null;
  prepareRefinement: () => Promise<void>;
  coarseReady?: (id: number) => Promise<void>;
  coarsePreparation?: Promise<void>;
  /** Resolves when both the reference and this target have 8MP frames. */
  refinementReady?: (id: number) => Promise<void>;
  onStageEvent?: (job: AlignmentPoolJob, workerIndex: number, stage: string) => void;
  onJobStart?: (job: AlignmentPoolJob, workerIndex: number) => void;
  onJobComplete?: (job: AlignmentPoolJob, workerIndex: number,
    outcome: { result: Result } | { error: Error }) => void;
}): Promise<AlignmentPoolResult<Ready, Result>> {
  if (!jobs.length) return { workerCount: 0, initializationMs: 0, jobsMs: 0, ready: [], successes: [], failures: [] };
  const count = resolveAlignmentWorkerCount(jobs.length, hardwareConcurrency);
  const clients = Array.from({ length: count }, createClient);
  const successes: AlignmentPoolSuccess<Result>[] = [];
  const failures: AlignmentPoolFailure[] = [];
  const ready: Ready[] = [];
  const initialized: Array<{ client: typeof clients[number]; index: number }> = [];
  const terminateAll = () => { for (const client of clients) { try { client.terminate(); } catch { /* best effort */ } } };
  const initializationStartedAt = performance.now();
  let fatalError: Error | null = null;
  try {
    const initErrors: Error[] = [];
    await Promise.all(clients.map(async (client, index) => {
      try {
        const result = await client.initialize(referenceFrame.width, referenceFrame.height,
          copyGrayBytes(referenceFrame), referenceFrame.exposureScalar);
        ready[index] = result;
        initialized.push({ client, index });
      } catch (error) {
        if (isAlignmentImplementationError(error)) {
          fatalError = asError(error); terminateAll(); throw fatalError;
        }
        initErrors.push(asError(error)); client.terminate();
      }
    }));
    if (fatalError) throw fatalError;
    const initializationMs = performance.now() - initializationStartedAt;
    if (!initialized.length) {
      const error = new Error(`Could not initialize ORB: ${initErrors.map((e) => e.message).join("; ")}`);
      return { workerCount: 0, initializationMs, jobsMs: 0, ready: [], successes: [],
        failures: jobs.map((job) => ({ job, error })) };
    }
    const startedAt = performance.now();
    let nextJob = 0;
    const owned = initialized.map(() => [] as AlignmentPoolJob[]);
    const recordFailure = (job: AlignmentPoolJob, workerIndex: number, error: unknown) => {
      const failure = asError(error);
      if (isAlignmentImplementationError(failure)) {
        fatalError = failure; terminateAll(); throw failure;
      }
      failures.push({ job, error: failure });
      onJobComplete?.(job, workerIndex, { error: failure });
    };
    const runCoarse = async (slot: number) => {
      const { client, index } = initialized[slot];
      while (!fatalError) {
        const i = nextJob++;
        if (i >= jobs.length) break;
        const job = jobs[i];
        try {
          if (coarseReady) await coarseReady(job.id);
          if (fatalError) break;
          onJobStart?.(job, index);
          onStageEvent?.(job, index, "orb-1mp-start");
          await client.alignCoarse(job.id, job.fileName, copyGrayBytes(job.frame), job.frame.exposureScalar);
          onStageEvent?.(job, index, "orb-1mp-ready");
          owned[slot].push(job);
        } catch (error) { recordFailure(job, index, error); }
      }
    };
    // The producer runs concurrently with coarse ORB. Its failure must be
    // observed even if a worker is still processing 1MP jobs.
    const fineWork = Promise.resolve().then(prepareRefinement);
    // Handle rejection promptly; the settled result is checked below.
    fineWork.catch(() => {});
    const runFine = async (slot: number) => {
      const { client, index } = initialized[slot];
      // Do not wait for the first owned image if a later one is ready.
      // Each readiness promise settles to a value so Promise.race never
      // leaves an unhandled rejection for a non-selected image.
      const pending = owned[slot].map((job) => ({
        job,
        ready: Promise.race([
          refinementReady ? refinementReady(job.id) : fineWork,
          fineWork.then(() => {
            if (!referenceFrame.refinement || !job.frame.refinement) {
              throw new Error(`Missing 8MP frame for ${job.fileName}.`);
            }
          }),
        ]).then(() => ({ job, error: null as Error | null }),
          (error: unknown) => ({ job, error: asError(error) })),
      }));
      while (pending.length && !fatalError) {
        const next = await Promise.race(pending.map((item) => item.ready));
        const position = pending.findIndex((item) => item.job === next.job);
        pending.splice(position, 1);
        if (next.error) {
          recordFailure(next.job, index, next.error);
          continue;
        }
        try {
          if (!referenceFrame.refinement || !next.job.frame.refinement) {
            throw new Error(`Missing 8MP frame for ${next.job.fileName}.`);
          }
          onStageEvent?.(next.job, index, "orb-8mp-start");
          const result = await client.refine(next.job.id, next.job.fileName,
            next.job.frame.refinement, referenceFrame.refinement);
          onStageEvent?.(next.job, index, "orb-8mp-ready");
          successes.push({ job: next.job, result });
          onJobComplete?.(next.job, index, { result });
        } catch (error) { recordFailure(next.job, index, error); }
      }
    };
    // Coarse jobs always get priority on their worker. Once that worker's
    // coarse queue is drained, it may refine immediately, without a global
    // barrier for other workers or for the remaining 8MP frames.
    const workerWork = Promise.allSettled(initialized.map(async (_, slot) => {
      await runCoarse(slot);
      if (!fatalError) await runFine(slot);
    }));
    const [workerResults, fineResult, coarseResult] = await Promise.all([
      workerWork,
      fineWork.then(() => ({ error: null as unknown }), (error: unknown) => ({ error })),
      (coarsePreparation ?? Promise.resolve()).then(() => ({ error: null as unknown }),
        (error: unknown) => ({ error })),
    ]);
    const workerFailure = workerResults.find((result) => result.status === "rejected");
    if (workerFailure?.status === "rejected") throw workerFailure.reason;
    if (fineResult.error) throw fineResult.error;
    if (coarseResult.error) throw coarseResult.error;
    if (fatalError) throw fatalError;
    return { workerCount: initialized.length, initializationMs,
      jobsMs: performance.now() - startedAt, ready, successes, failures };
  } finally { terminateAll(); }
}

/** 1MP 6-DOF ECC followed by 8MP 4-DOF ORB residual refinement.
 * ECC and ORB use separate worker pools; 8MP frames and each ECC result can
 * arrive independently. Refinement never replaces a valid ECC result on error.
 */
export async function runProgressiveEccPool<
  CoarseReady,
  CoarseResult extends { matrix: Float64Array },
  FineResult extends { matrix: Float64Array; refinementStatus?: string;
    refinementMatches?: number; refinementInliers?: number;
    refinementInitialInliers?: number; refinementInitialMedianError?: number;
    refinementInitialP95Error?: number; refinementMedianError?: number;
    refinementP95Error?: number; refinementCorrectionPx?: number },
>({
  jobs, referenceFrame, createClient, createFineClient, hardwareConcurrency,
  prepareRefinement, coarseReady, refinementReady, coarsePreparation,
  onJobStart, onJobComplete, onStageEvent, onTransformOutcome, referenceFrameIndex,
}: {
  jobs: AlignmentPoolJob[];
  referenceFrame: AlignmentPoolFrame;
  referenceFrameIndex: number;
  createClient: () => AlignmentPoolClient<CoarseReady, CoarseResult>;
  createFineClient: () => {
    initialize(width: number, height: number, grayBytes: Uint8Array,
      exposureScalar: number | null, refinement: NonNullable<AlignmentPoolFrame["refinement"]>): Promise<unknown>;
    refineExternal(id: number, fileName: string, matrix: ArrayLike<number>, exposureScalar: number | null,
      refinement: NonNullable<AlignmentPoolFrame["refinement"]>): Promise<FineResult>;
    terminate(): void;
  };
  hardwareConcurrency?: number | null;
  prepareRefinement: () => Promise<void>;
  coarseReady?: (id: number) => Promise<void>;
  refinementReady?: (id: number) => Promise<void>;
  coarsePreparation?: Promise<void>;
  onStageEvent?: (job: AlignmentPoolJob, workerIndex: number, stage: string) => void;
  /** Observe both matrices before the fine result overwrites the ECC matrix.
   * Diagnostics only: does not change transform selection or scheduling. */
  onTransformOutcome?: (job: AlignmentPoolJob, coarse: CoarseResult,
    final: CoarseResult & Partial<FineResult>) => void;
  onJobStart?: (job: AlignmentPoolJob, workerIndex: number) => void;
  onJobComplete?: (job: AlignmentPoolJob, workerIndex: number,
    outcome: { result: CoarseResult & Partial<FineResult> } | { error: Error }) => void;
}): Promise<AlignmentPoolResult<CoarseReady, CoarseResult & Partial<FineResult>>> {
  if (!jobs.length) return { workerCount: 0, initializationMs: 0, jobsMs: 0, ready: [], successes: [], failures: [] };
  // Keep two frame producers and both transform stages bounded. Limit active
  // transform workers to the remaining CPU budget (at least one per stage).
  const hardware = Number.isFinite(hardwareConcurrency) ? Math.max(1, Math.floor(Number(hardwareConcurrency))) : 4;
  // At most four transform workers, split between ECC and ORB. Frame
  // generation is independently capped at two workers and completes early.
  const transformBudget = Math.max(2, Math.min(ALIGNMENT_MAX_WORKERS, hardware));
  const coarseWorkers = Math.max(1, Math.min(jobs.length, Math.ceil(transformBudget / 2)));
  const fineWorkers = Math.max(1, Math.min(jobs.length, transformBudget - coarseWorkers));
  const fineClients = Array.from({ length: fineWorkers }, createFineClient);
  const successes: AlignmentPoolSuccess<CoarseResult & Partial<FineResult>>[] = [];
  const startedAt = performance.now();
  type CoarseOutcome = { result: CoarseResult; error?: never } | { error: Error; result?: never };
  const outcomes = new Map<number, { promise: Promise<CoarseOutcome>; resolve: (outcome: CoarseOutcome) => void }>();
  for (const job of jobs) {
    let resolve!: (outcome: CoarseOutcome) => void;
    const promise = new Promise<CoarseOutcome>((done) => { resolve = done; });
    outcomes.set(job.id, { promise, resolve });
  }
  const resolved = new Set<number>();
  const completeCoarse = (job: AlignmentPoolJob, result: CoarseOutcome) => {
    if (resolved.has(job.id)) return;
    resolved.add(job.id);
    outcomes.get(job.id)?.resolve(result);
  };
  const terminateFine = () => {
    for (const client of fineClients) { try { client.terminate(); } catch { /* best effort */ } }
  };
  // Start both resolutions immediately; an ECC result does not need to wait
  // for unrelated 8MP frames or for other ECC results.
  const finePreparation = Promise.resolve().then(prepareRefinement);
  finePreparation.catch(() => {});
  const coarseBatchTask = runAlignmentPool({
    jobs, referenceFrame, createClient, hardwareConcurrency: coarseWorkers, jobReady: coarseReady,
    onJobStart: (job, workerIndex) => {
      onStageEvent?.(job, workerIndex, "ecc-1mp-start");
      onJobStart?.(job, workerIndex);
    },
    onJobComplete: (job, workerIndex, outcome) => {
      onStageEvent?.(job, workerIndex, "ecc-1mp-ready");
      completeCoarse(job, "result" in outcome ? { result: outcome.result } : { error: outcome.error });
    },
  }).then((batch) => {
    // Reference initialization failure reports failures without job callbacks.
    for (const failure of batch.failures) completeCoarse(failure.job, { error: failure.error });
    return batch;
  }, (error: unknown) => {
    const failure = asError(error);
    for (const job of jobs) completeCoarse(job, { error: failure });
    throw failure;
  });
  coarseBatchTask.catch(() => {});
  try {
    const pending = jobs.map((job) => ({
      job,
      ready: outcomes.get(job.id)!.promise.then(async (coarse) => {
        if (coarse.error) return { job, coarse, refinementError: null as Error | null };
        try {
          if (refinementReady) await refinementReady(job.id);
          else await finePreparation;
          if (!referenceFrame.refinement || !job.frame.refinement) {
            throw new Error(`Missing 8MP frame for ${job.fileName}.`);
          }
          return { job, coarse, refinementError: null as Error | null };
        } catch (error) {
          return { job, coarse, refinementError: asError(error) };
        }
      }),
    }));
    const runFine = async (workerIndex: number) => {
      const client = fineClients[workerIndex];
      let initializationError: Error | null = null;
      try {
        if (refinementReady) await refinementReady(referenceFrameIndex);
        else await finePreparation;
        if (!referenceFrame.refinement) throw new Error("8MP reference frame is unavailable.");
        await client.initialize(referenceFrame.width, referenceFrame.height,
          copyGrayBytes(referenceFrame), referenceFrame.exposureScalar, referenceFrame.refinement);
      } catch (error) {
        initializationError = asError(error);
      }
      // Use ready-first scheduling, so one slowly generated 8MP frame does
      // not block another target on the same worker.
      while (pending.length) {
        const next = await Promise.race(pending.map((item) => item.ready));
        const position = pending.findIndex((item) => item.job === next.job);
        // Multiple ORB workers can wake up for the same ready item. Only the
        // first claims it; a second wake-up must not process it twice or
        // accidentally remove the final pending item via splice(-1, 1).
        if (position < 0) continue;
        pending.splice(position, 1);
        if (!next.coarse.result) continue; // ECC failures remain hard failures.
        const coarse = next.coarse.result;
        let result: CoarseResult & Partial<FineResult> = { ...coarse } as CoarseResult & Partial<FineResult>;
        if (initializationError || next.refinementError) {
          const error = initializationError || next.refinementError;
          result = { ...coarse, refinementStatus: `8MP refinement unavailable: ${error?.message}; kept ECC` } as typeof result;
        } else {
          try {
            onStageEvent?.(next.job, coarseWorkers + workerIndex, "orb-8mp-start");
            const fine = await client.refineExternal(next.job.id, next.job.fileName, coarse.matrix,
              next.job.frame.exposureScalar, next.job.frame.refinement!);
            // Keep ECC's correlation, confidence and exposure statistics.
            // Import only the fine transform and ORB refinement diagnostics.
            result = { ...coarse, matrix: fine.matrix,
              refinementStatus: fine.refinementStatus,
              refinementMatches: fine.refinementMatches,
              refinementInliers: fine.refinementInliers,
              refinementMedianError: fine.refinementMedianError,
              refinementP95Error: fine.refinementP95Error,
              refinementInitialInliers: fine.refinementInitialInliers,
              refinementInitialMedianError: fine.refinementInitialMedianError,
              refinementInitialP95Error: fine.refinementInitialP95Error,
              refinementCorrectionPx: fine.refinementCorrectionPx,
            } as CoarseResult & Partial<FineResult>;
            onStageEvent?.(next.job, coarseWorkers + workerIndex, "orb-8mp-ready");
          } catch (error) {
            const detail = asError(error);
            result = { ...coarse, refinementStatus: `8MP refinement failed: ${detail.message}; kept ECC` } as typeof result;
          }
        }
        onTransformOutcome?.(next.job, coarse, result);
        successes.push({ job: next.job, result });
        onJobComplete?.(next.job, coarseWorkers + workerIndex, { result });
      }
    };
    const fineTasks = Promise.all(fineClients.map((_, index) => runFine(index)));
    // All stages must settle before their workers are destroyed, including if
    // the frame producer or ECC fails while another stage is still active.
    const settled = await Promise.allSettled([coarseBatchTask, fineTasks, finePreparation,
      coarsePreparation ?? Promise.resolve()]);
    const failure = settled.find((entry) => entry.status === "rejected");
    if (failure?.status === "rejected") throw failure.reason;
    const coarseBatch = (settled[0] as PromiseFulfilledResult<
      AlignmentPoolResult<CoarseReady, CoarseResult>>).value;
    return { workerCount: coarseBatch.workerCount + fineClients.length,
      initializationMs: coarseBatch.initializationMs,
      jobsMs: performance.now() - startedAt, ready: coarseBatch.ready,
      successes, failures: coarseBatch.failures };
  } finally {
    terminateFine();
  }
}
