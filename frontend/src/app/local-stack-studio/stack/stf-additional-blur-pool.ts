import type { StfAdditionalBlurWorkerConfig } from "../workers/protocols/stf-additional-blur-protocol";
import {
  StfAdditionalBlurWorkerClient,
  type StfAdditionalBlurAnalyzeResult,
  type StfAdditionalBlurBlurRequest,
  type StfAdditionalBlurRatioRequest,
} from "./stf-additional-blur-client";
import type { LinearMergeStripeJob } from "./linear-merge-pool";
import {
  STF_ADDITIONAL_BLUR_MAX_WORKERS,
  STF_RELATIVE_CHANNEL_BRIGHTNESS_FLOOR,
  type StfRelativeChannelFloors,
  type StfSampleGrid,
  validateStfRelativeChannelFloors,
} from "./stf-additional-blur";

export type StfAdditionalBlurPoolReady = {
  workerCount: number;
  imageCount: number;
  width: number;
  height: number;
  analysisHalo: number;
  groupCount: number;
  relativeSharpness: boolean;
  relativeBrightnessFloor: number;
  relativeCombineMode: "mean" | "rms";
  relativeChannelFloors?: StfRelativeChannelFloors;
};

export class StfAdditionalBlurWorkerPool {
  private constructor(
    private readonly clients: StfAdditionalBlurWorkerClient[],
    readonly ready: StfAdditionalBlurPoolReady,
  ) {}

  static async create({
    jobCount,
    config,
    workerUrl,
    hardwareConcurrency,
  }: {
    jobCount: number;
    config: StfAdditionalBlurWorkerConfig;
    workerUrl: URL;
    hardwareConcurrency?: number | null;
  }): Promise<StfAdditionalBlurWorkerPool> {
    const workers = Math.max(1, Math.min(
      STF_ADDITIONAL_BLUR_MAX_WORKERS,
      Math.max(1, Math.floor(Number.isFinite(hardwareConcurrency) ? Number(hardwareConcurrency) : STF_ADDITIONAL_BLUR_MAX_WORKERS)),
      Math.max(1, Math.floor(jobCount)),
    ));
    const clients = Array.from({ length: workers }, () => new StfAdditionalBlurWorkerClient(workerUrl));
    try {
      const responses = await Promise.all(clients.map((client) => client.initialize(config)));
      const first = responses[0];
      // An old generated Worker silently ignores new init options. Verify its
      // effective configuration before accepting any relative-sharpness data.
      if (config.relativeSharpness === true) {
        const expectedFloor = config.relativeBrightnessFloor ?? STF_RELATIVE_CHANNEL_BRIGHTNESS_FLOOR;
        const expectedCombineMode = config.relativeCombineMode === "rms" ? "rms" : "mean";
        for (const response of responses) {
          if (response.relativeSharpness !== true || response.relativeBrightnessFloor !== expectedFloor || response.relativeCombineMode !== expectedCombineMode) {
            throw new Error(
              "STF relative sharpness Worker is out of date or has the wrong brightness floor. " +
              "Rebuild local stack workers and reload the page.",
            );
          }
        }
      }
      for (const response of responses) {
        if (
          response.imageCount !== first.imageCount
          || response.width !== first.width
          || response.height !== first.height
          || response.analysisHalo !== first.analysisHalo
          || response.groupCount !== first.groupCount
        ) {
          throw new Error("STF Additional blur workers initialized inconsistently.");
        }
      }
      return new StfAdditionalBlurWorkerPool(clients, {
        workerCount: workers,
        imageCount: first.imageCount,
        width: first.width,
        height: first.height,
        analysisHalo: first.analysisHalo,
        groupCount: first.groupCount,
        relativeSharpness: first.relativeSharpness,
        relativeBrightnessFloor: first.relativeBrightnessFloor,
        relativeCombineMode: first.relativeCombineMode,
      });
    } catch (error) {
      for (const client of clients) client.terminate();
      throw error;
    }
  }

  runAnalysisJobs(
    jobs: readonly LinearMergeStripeJob[],
    onComplete: (job: LinearMergeStripeJob, result: StfAdditionalBlurAnalyzeResult, completed: number, total: number) => void | Promise<void>,
  ): Promise<void> {
    return this.runJobs(jobs, (client, job) => client.analyzeStripe(job), onComplete);
  }

  runRatioJobs(
    jobs: readonly LinearMergeStripeJob[],
    buildRequest: (job: LinearMergeStripeJob) => Promise<StfAdditionalBlurRatioRequest>,
    onComplete: (job: LinearMergeStripeJob, result: Float32Array, completed: number, total: number) => void | Promise<void>,
  ): Promise<void> {
    return this.runJobs(jobs, async (client, job) => client.ratioStripe(await buildRequest(job)), onComplete);
  }

  interpolateLogRatio(values: Float32Array, width: number, height: number, closingMode: "area" | "volume" | "volume2" = "area"): Promise<{
    values: Float32Array;
    info: { workingWidth: number; workingHeight: number; areaThreshold?: number; volumeThreshold?: number };
  }> {
    return this.clients[0].interpolateLogRatio(values, width, height, closingMode);
  }

  runBlurJobs(
    jobs: readonly LinearMergeStripeJob[],
    buildRequest: (job: LinearMergeStripeJob) => StfAdditionalBlurBlurRequest,
    onComplete: (job: LinearMergeStripeJob, result: Float32Array, completed: number, total: number) => void | Promise<void>,
  ): Promise<void> {
    return this.runJobs(jobs, (client, job) => client.blurStripe(buildRequest(job)), onComplete);
  }

  sampleBrightnessStripes(
    jobs: readonly LinearMergeStripeJob[],
    grid: StfSampleGrid,
    onComplete: (job: LinearMergeStripeJob, samples: Float32Array, completed: number, total: number) => void | Promise<void>,
  ): Promise<void> {
    return this.runJobs(jobs, (client, job) => client.sampleBrightnessStripe(job, grid), onComplete);
  }

  async configureRelativeChannelFloors(floors: StfRelativeChannelFloors): Promise<void> {
    const expected = validateStfRelativeChannelFloors(floors);
    if (!this.ready.relativeSharpness) throw new Error("STF relative3 requires relative sharpness mode.");
    const responses = await Promise.all(this.clients.map((client) => client.configureRelativeChannelFloors(expected)));
    for (const response of responses) {
      if (!Array.isArray(response) || response.length !== 3 || response.some((value, i) => value !== expected[i])) {
        throw new Error("STF relative3 Worker did not confirm RGB brightness floors. Rebuild workers and reload.");
      }
    }
    this.ready.relativeChannelFloors = expected;
  }

  terminate(): void {
    for (const client of this.clients) client.terminate();
  }

  private async runJobs<Result>(
    jobs: readonly LinearMergeStripeJob[],
    run: (client: StfAdditionalBlurWorkerClient, job: LinearMergeStripeJob) => Promise<Result>,
    onComplete: (job: LinearMergeStripeJob, result: Result, completed: number, total: number) => void | Promise<void>,
  ): Promise<void> {
    let nextJob = 0;
    let completed = 0;
    let firstError: Error | null = null;
    const runWorker = async (client: StfAdditionalBlurWorkerClient) => {
      while (!firstError) {
        const index = nextJob++;
        if (index >= jobs.length) return;
        const job = jobs[index];
        try {
          const result = await run(client, job);
          completed += 1;
          await onComplete(job, result, completed, jobs.length);
        } catch (error) {
          if (!firstError) firstError = error instanceof Error ? error : new Error(String(error));
          throw firstError;
        }
      }
    };
    await Promise.all(this.clients.map((client) => runWorker(client)));
    if (firstError) throw firstError;
  }
}
