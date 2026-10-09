import {
  resolveStfAdditionalBlurWorkerCount,
  runStfAdditionalBlurAnalysisPool,
  runStfAdditionalBlurApplyPool,
  type StfAdditionalBlurPoolClient,
} from "./stf-additional-blur-pool";
import type { StfAdditionalBlurWorkerConfig } from "../workers/protocols/stf-additional-blur-protocol";

const config: StfAdditionalBlurWorkerConfig = {
  sessionId: "test-session",
  alignmentPlan: { normalizationMode: "feature-match", targetWidth: 4, targetHeight: 8 },
  matrices: [null, null],
  gains: new Float32Array([1, 1]),
  scaledLogs: new Float32Array([0, 0]),
  weights: new Float32Array([0.5, 0.5]),
  fNumbers: new Float32Array([2, 2.8]),
  apertureOrder: new Int32Array([0, 1]),
  exposureRolloffMaxP998AfterGain: [null, null],
};

const jobs = Array.from({ length: 8 }, (_, index) => ({ index, y: index, height: 1 }));

class MockClient implements StfAdditionalBlurPoolClient {
  static running = 0;
  static maxRunning = 0;
  async initialize() { return { imageCount: 2, width: 4, height: 8 }; }
  async analyzeMaskStripe(job: { index: number; height: number }) {
    MockClient.running += 1;
    MockClient.maxRunning = Math.max(MockClient.maxRunning, MockClient.running);
    await new Promise((resolve) => setTimeout(resolve, 2));
    MockClient.running -= 1;
    return {
      mask: new Uint16Array(4 * job.height).fill(job.index),
      edgeProtection: new Uint16Array(4 * job.height),
      histogram: new Uint32Array(4096),
      sampleCount: 4 * job.height,
    };
  }
  async applyBlurStripe(
    job: { index: number; height: number },
    mask: Uint16Array,
    edgeProtection: Uint16Array,
  ) {
    expect(mask.length).toBe(4 * job.height);
    expect(edgeProtection.length).toBe(4 * job.height);
    return new Float32Array(4 * job.height * 3).fill(job.index);
  }
  terminate() {}
}

describe("STF Additional Blur pool", () => {
  beforeEach(() => {
    MockClient.running = 0;
    MockClient.maxRunning = 0;
  });

  test("worker count is capped at four", () => {
    expect(resolveStfAdditionalBlurWorkerCount(10, 16)).toBe(4);
    expect(resolveStfAdditionalBlurWorkerCount(2, 16)).toBe(2);
  });

  test("runs mask analysis concurrently", async () => {
    const completed: number[] = [];
    await runStfAdditionalBlurAnalysisPool({
      jobs,
      config,
      createClient: () => new MockClient(),
      hardwareConcurrency: 4,
      onJobComplete: (job) => { completed.push(job.index); },
    });
    expect(MockClient.maxRunning).toBe(4);
    expect(completed.sort((a, b) => a - b)).toEqual(jobs.map((job) => job.index));
  });

  test("loads saved mask and edge protection per apply stripe", async () => {
    const completed: number[] = [];
    await runStfAdditionalBlurApplyPool({
      jobs,
      config,
      createClient: () => new MockClient(),
      loadMask: async (job) => new Uint16Array(4 * job.height).fill(job.index),
      loadEdgeProtection: async (job) => new Uint16Array(4 * job.height),
      scaledLogFactor: 3,
      hardwareConcurrency: 4,
      onJobComplete: (job) => { completed.push(job.index); },
    });
    expect(completed.sort((a, b) => a - b)).toEqual(jobs.map((job) => job.index));
  });
});
