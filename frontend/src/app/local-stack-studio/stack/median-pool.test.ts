import {
  MEDIAN_MAX_WORKERS,
  resolveMedianWorkerCount,
  runMedianPool,
  type MedianPoolClient,
} from "./median-pool";

const config = {
  sessionId: "session",
  alignmentPlan: {
    normalizationMode: "feature-match" as const,
    targetWidth: 8,
    targetHeight: 8,
  },
  matrices: [new Float64Array([1, 0, 0, 0, 1, 0, 0, 0, 1])],
};

function jobs(count: number) {
  return Array.from({ length: count }, (_, index) => ({
    index,
    x: index * 2,
    y: 0,
    width: 2,
    height: 1,
  }));
}

describe("Median worker pool", () => {
  test("caps workers by hardware concurrency, job count, and the LSS maximum", () => {
    expect(resolveMedianWorkerCount(0, 8)).toBe(0);
    expect(resolveMedianWorkerCount(2, 8)).toBe(2);
    expect(resolveMedianWorkerCount(8, 2)).toBe(2);
    expect(resolveMedianWorkerCount(8, 32)).toBe(MEDIAN_MAX_WORKERS);
  });

  test("runs independent output tiles concurrently", async () => {
    let active = 0;
    let maxActive = 0;
    let terminated = 0;
    const completed: number[] = [];
    const createClient = (): MedianPoolClient => ({
      async initialize() {
        return { imageCount: 1 };
      },
      async mergeTile(job) {
        active += 1;
        maxActive = Math.max(maxActive, active);
        await new Promise((resolve) => setTimeout(resolve, 5));
        active -= 1;
        return new Uint16Array(job.width * job.height * 3).fill(job.index);
      },
      terminate() {
        terminated += 1;
      },
    });

    const result = await runMedianPool({
      jobs: jobs(4),
      config,
      createClient,
      hardwareConcurrency: 4,
      onJobComplete(job) {
        completed.push(job.index);
      },
    });

    expect(result.workerCount).toBe(4);
    expect(completed.sort((a, b) => a - b)).toEqual([0, 1, 2, 3]);
    expect(maxActive).toBeGreaterThan(1);
    expect(terminated).toBe(4);
  });

  test("aborts all workers when any tile fails", async () => {
    let terminated = 0;
    const createClient = (): MedianPoolClient => ({
      async initialize() {
        return { imageCount: 1 };
      },
      async mergeTile(job) {
        if (job.index === 0) throw new Error("tile failed");
        await new Promise((resolve) => setTimeout(resolve, 20));
        return new Uint16Array(job.width * job.height * 3);
      },
      terminate() {
        terminated += 1;
      },
    });

    await expect(runMedianPool({
      jobs: jobs(4),
      config,
      createClient,
      hardwareConcurrency: 4,
    })).rejects.toThrow("tile failed");

    expect(terminated).toBeGreaterThanOrEqual(4);
  });

  test("rejects a worker initialized for a different image count", async () => {
    const createClient = (): MedianPoolClient => ({
      async initialize() {
        return { imageCount: 2 };
      },
      async mergeTile(job) {
        return new Uint16Array(job.width * job.height * 3);
      },
      terminate() {},
    });

    await expect(runMedianPool({
      jobs: jobs(1),
      config,
      createClient,
      hardwareConcurrency: 1,
    })).rejects.toThrow("does not match alignment matrix count");
  });
});
