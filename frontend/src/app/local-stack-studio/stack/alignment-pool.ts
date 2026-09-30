import { isAlignmentImplementationError } from "../workers/alignment-error";

export const ALIGNMENT_MAX_WORKERS = 4;

export type AlignmentPoolFrame = {
  width: number;
  height: number;
  grayBytes: Uint8Array | ArrayBufferLike;
  exposureScalar: number | null;
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
  ): Promise<Ready>;
  align(
    id: number,
    fileName: string,
    grayBytes: Uint8Array,
    exposureScalar?: number | null,
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
}: {
  jobs: AlignmentPoolJob[];
  referenceFrame: AlignmentPoolFrame;
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
    return { workerCount: 0, ready: [], successes: [], failures: [] };
  }

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
        onJobStart?.(job, workerIndex);
        try {
          const result = await client.align(
            job.id,
            job.fileName,
            copyGrayBytes(job.frame),
            job.frame.exposureScalar,
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

    await Promise.all(initializedClients.map(runWorker));
    if (fatalError) throw fatalError;
    return {
      workerCount: initializedClients.length,
      ready: initializedClients.map(({ workerIndex }) => ready[workerIndex]),
      successes,
      failures,
    };
  } finally {
    terminateAll();
  }
}
