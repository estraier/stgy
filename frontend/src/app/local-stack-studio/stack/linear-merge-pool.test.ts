import {
  buildLinearMergeStripeJobs,
  resolveLinearMergeWorkerCount,
  runLinearMergePool,
  type LinearMergePoolClient,
} from "./linear-merge-pool";
import type { LinearMergeWorkerConfig } from "../workers/protocols/linear-merge-protocol";

const config: LinearMergeWorkerConfig = {
  sessionId: "test-session",
  alignmentPlan: { normalizationMode: "feature-match", targetWidth: 4, targetHeight: 8 },
  matrices: [null, null],
  gains: new Float32Array([1, 1]),
  scaledLogs: new Float32Array([0, 0]),
  weights: new Float32Array([0.5, 0.5]),
  exposureRolloffMaxP998AfterGain: [null, null],
};

describe("linear merge pool", () => {
  test("worker count is capped at four", () => {
    expect(resolveLinearMergeWorkerCount(10, 16)).toBe(4);
    expect(resolveLinearMergeWorkerCount(2, 16)).toBe(2);
    expect(resolveLinearMergeWorkerCount(10, 2)).toBe(2);
  });

  test("stripe builder targets bounded Float32 RGB regions", () => {
    const jobs = buildLinearMergeStripeJobs(1024, 1000, 1024 * 3 * 4 * 100);
    expect(jobs[0]).toEqual({ index: 0, y: 0, height: 100 });
    const lastJob = jobs[jobs.length - 1];
    expect(lastJob.y + lastJob.height).toBe(1000);
  });

  test("runs independent stripes concurrently", async () => {
    const jobs = Array.from({ length: 8 }, (_, index) => ({ index, y: index, height: 1 }));
    let running = 0;
    let maxRunning = 0;
    const completed: number[] = [];
    class MockClient implements LinearMergePoolClient {
      async initialize() { return { imageCount: 2, width: 4, height: 8 }; }
      async mergeStripe(job: { index: number; y: number; height: number }) {
        running += 1;
        maxRunning = Math.max(maxRunning, running);
        await new Promise((resolve) => setTimeout(resolve, 5));
        running -= 1;
        return new Float32Array(4 * job.height * 3).fill(job.index);
      }
      terminate() {}
    }
    await runLinearMergePool({
      jobs,
      config,
      createClient: () => new MockClient(),
      hardwareConcurrency: 4,
      onJobComplete: (job) => completed.push(job.index),
    });
    expect(maxRunning).toBe(4);
    expect(completed.sort((a, b) => a - b)).toEqual(jobs.map((job) => job.index));
  });

  test("terminates the pool when a stripe fails", async () => {
    const jobs = [
      { index: 0, y: 0, height: 1 },
      { index: 1, y: 1, height: 1 },
      { index: 2, y: 2, height: 1 },
    ];
    let terminateCount = 0;
    class MockClient implements LinearMergePoolClient {
      async initialize() { return { imageCount: 2, width: 4, height: 8 }; }
      async mergeStripe(job: { index: number; height: number }) {
        if (job.index === 1) throw new Error("stripe failed");
        return new Float32Array(4 * job.height * 3);
      }
      terminate() { terminateCount += 1; }
    }
    await expect(runLinearMergePool({
      jobs,
      config,
      createClient: () => new MockClient(),
      hardwareConcurrency: 3,
    })).rejects.toThrow("stripe failed");
    expect(terminateCount).toBeGreaterThanOrEqual(3);
  });
});
