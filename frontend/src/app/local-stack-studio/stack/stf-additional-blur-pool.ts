import type { StfAdditionalBlurWorkerConfig } from "../workers/protocols/stf-additional-blur-protocol";
import {
  StfAdditionalBlurWorkerClient, type StfAdditionalBlurAnalyzeResult,
  type StfAdditionalBlurBlurRequest, type StfAdditionalBlurRatioRequest,
} from "./stf-additional-blur-client";
import type { LinearMergeStripeJob } from "./linear-merge-pool";
import {
  STF_ADDITIONAL_BLUR_MAX_WORKERS, type StfRelativeChannelFloors,
  type StfSampleGrid, validateStfRelativeChannelFloors,
} from "./stf-additional-blur";

export type StfAdditionalBlurPoolReady = {
  workerCount: number; imageCount: number; width: number; height: number;
  analysisHalo: number; groupCount: number; relativeChannelFloors?: StfRelativeChannelFloors;
};
export class StfAdditionalBlurWorkerPool {
  private constructor(private readonly clients: StfAdditionalBlurWorkerClient[], readonly ready: StfAdditionalBlurPoolReady) {}
  static async create({ jobCount, config, workerUrl, hardwareConcurrency }: {
    jobCount: number; config: StfAdditionalBlurWorkerConfig; workerUrl: URL;
    hardwareConcurrency?: number | null;
  }): Promise<StfAdditionalBlurWorkerPool> {
    const workers = Math.max(1, Math.min(STF_ADDITIONAL_BLUR_MAX_WORKERS,
      Math.max(1, Math.floor(Number.isFinite(hardwareConcurrency) ? Number(hardwareConcurrency) : STF_ADDITIONAL_BLUR_MAX_WORKERS)),
      Math.max(1, Math.floor(jobCount))));
    const clients = Array.from({ length: workers }, () => new StfAdditionalBlurWorkerClient(workerUrl));
    try {
      const responses = await Promise.all(clients.map((client) => client.initialize(config)));
      const first = responses[0];
      for (const r of responses) {
        if (r.imageCount !== first.imageCount || r.width !== first.width || r.height !== first.height ||
            r.analysisHalo !== first.analysisHalo || r.groupCount !== first.groupCount) {
          throw new Error("STF Additional blur Workers initialized inconsistently.");
        }
      }
      return new StfAdditionalBlurWorkerPool(clients, { workerCount: workers, imageCount: first.imageCount,
        width: first.width, height: first.height, analysisHalo: first.analysisHalo, groupCount: first.groupCount });
    } catch (error) {
      for (const client of clients) client.terminate();
      throw error;
    }
  }
  runAnalysisJobs(jobs: readonly LinearMergeStripeJob[], includeSource: boolean,
    onComplete: (job: LinearMergeStripeJob, result: StfAdditionalBlurAnalyzeResult, completed: number, total: number) => void | Promise<void>) {
    return this.runJobs(jobs, (client, job) => client.analyzeStripe(job, includeSource), onComplete);
  }
  runRatioJobs(jobs: readonly LinearMergeStripeJob[],
    buildRequest: (job: LinearMergeStripeJob) => Promise<StfAdditionalBlurRatioRequest>,
    onComplete: (job: LinearMergeStripeJob, result: Float32Array, completed: number, total: number) => void | Promise<void>) {
    return this.runJobs(jobs, async (client, job) => client.ratioStripe(await buildRequest(job)), onComplete);
  }
  runBlurJobs(jobs: readonly LinearMergeStripeJob[],
    buildRequest: (job: LinearMergeStripeJob) => StfAdditionalBlurBlurRequest,
    onComplete: (job: LinearMergeStripeJob, result: Float32Array, completed: number, total: number) => void | Promise<void>) {
    return this.runJobs(jobs, (client, job) => client.blurStripe(buildRequest(job)), onComplete);
  }
  sampleBrightnessStripes(jobs: readonly LinearMergeStripeJob[], grid: StfSampleGrid,
    onComplete: (job: LinearMergeStripeJob, samples: Float32Array, completed: number, total: number) => void | Promise<void>) {
    return this.runJobs(jobs, (client, job) => client.sampleBrightnessStripe(job, grid), onComplete);
  }
  volumeClose(values: Float32Array, width: number, height: number) {
    return this.clients[0].volumeClose(values, width, height);
  }
  graphCut(values: Float32Array, width: number, height: number, ratio: number) {
    return this.clients[0].graphCut(values, width, height, ratio);
  }
  async configureRelativeChannelFloors(floors: StfRelativeChannelFloors): Promise<void> {
    const valid = validateStfRelativeChannelFloors(floors);
    const responses = await Promise.all(this.clients.map((client) => client.configureRelativeChannelFloors(valid)));
    for (const response of responses) {
      if (response.length !== 3 || response.some((v, i) => v !== valid[i])) {
        throw new Error("STF RGB brightness Worker was not configured correctly.");
      }
    }
    this.ready.relativeChannelFloors = valid;
  }
  terminate(): void {
    for (const client of this.clients) client.terminate();
  }
  private async runJobs<Result>(jobs: readonly LinearMergeStripeJob[],
    run: (client: StfAdditionalBlurWorkerClient, job: LinearMergeStripeJob) => Promise<Result>,
    onComplete: (job: LinearMergeStripeJob, result: Result, completed: number, total: number) => void | Promise<void>): Promise<void> {
    let nextJob = 0, completed = 0;
    let firstError: Error | null = null;
    const runWorker = async (client: StfAdditionalBlurWorkerClient) => {
      while (!firstError) {
        const index = nextJob++;
        if (index >= jobs.length) return;
        try {
          const result = await run(client, jobs[index]);
          completed++;
          await onComplete(jobs[index], result, completed, jobs.length);
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
