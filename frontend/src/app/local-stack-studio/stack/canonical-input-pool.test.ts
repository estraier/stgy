import {
  estimateCanonicalTaskBytes,
  resolveCanonicalInputMemoryBudget,
  resolveCanonicalInputWorkerCount,
  runCanonicalInputTaskQueue,
  type CanonicalInputTask,
  type CanonicalTaskExecutor,
} from "./canonical-input-pool";
import type { CanonicalImageRecord } from "./canonical-source";

const mib = 1024 * 1024;

function task(index: number, raw = false, width = 1000, height = 1000): CanonicalInputTask {
  return {
    imageIndex: index,
    file: { name: `image-${index}.${raw ? "nef" : "tif"}`, size: 16 * mib } as File,
    inputInfo: { width, height, isRaw: raw, sourceColorSpace: "srgb" },
  };
}

function record(job: CanonicalInputTask): CanonicalImageRecord {
  return { sessionId: "session", imageIndex: job.imageIndex, complete: true } as CanonicalImageRecord;
}

function deferred(): { promise: Promise<void>; release: () => void } {
  let release: () => void = () => {};
  const promise = new Promise<void>((resolve) => { release = resolve; });
  return { promise, release };
}

describe("Canonical input task queue", () => {
  test("worker count and memory budget are bounded", () => {
    expect(resolveCanonicalInputWorkerCount(9, 16)).toBe(4);
    expect(resolveCanonicalInputWorkerCount(2, 16)).toBe(2);
    expect(resolveCanonicalInputWorkerCount(9, 2)).toBe(2);
    expect(resolveCanonicalInputMemoryBudget(2)).toBeLessThan(resolveCanonicalInputMemoryBudget(16));
    expect(estimateCanonicalTaskBytes(task(0, false, 4000, 4000))).toBeGreaterThan(128 * mib);
  });

  test("idle workers share a queue; completion order does not change image indices", async () => {
    const releaseFirst = deferred();
    const started: number[] = [];
    const done: number[] = [];
    let active = 0;
    let maxActive = 0;
    let terminated = 0;
    const createExecutor = (): CanonicalTaskExecutor => ({
      async process(job) {
        started.push(job.imageIndex);
        active += 1;
        maxActive = Math.max(active, maxActive);
        if (job.imageIndex === 0) await releaseFirst.promise;
        else await new Promise((resolve) => setTimeout(resolve, 3));
        active -= 1;
        return record(job);
      },
      terminate() { terminated += 1; },
    });
    const promise = runCanonicalInputTaskQueue({
      tasks: Array.from({ length: 6 }, (_, i) => task(i)),
      sessionId: "session",
      workerCount: 3,
      createExecutor,
      runRaw: async (job) => record(job),
      onComplete: (job) => done.push(job.imageIndex),
    });
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(started).toContain(3);
    releaseFirst.release();
    await promise;
    expect(maxActive).toBe(3);
    expect(done.sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 4, 5]);
    expect(terminated).toBe(3);
  });

  test("memory budget limits concurrency and admits an oversized single job", async () => {
    let active = 0;
    let maxActive = 0;
    const createExecutor = (): CanonicalTaskExecutor => ({
      async process(job) {
        active += 1;
        maxActive = Math.max(maxActive, active);
        await new Promise((resolve) => setTimeout(resolve, 3));
        active -= 1;
        return record(job);
      },
      terminate() {},
    });
    await runCanonicalInputTaskQueue({
      tasks: [task(0, false, 2000, 2000), task(1, false, 2000, 2000), task(2, false, 2000, 2000)],
      sessionId: "session",
      workerCount: 3,
      memoryBudgetBytes: 128 * mib,
      createExecutor,
      runRaw: async (job) => record(job),
    });
    expect(maxActive).toBe(1);
  });

  test("RAW jobs run one at a time alongside normal workers", async () => {
    let runningRaw = 0;
    let maxRaw = 0;
    const done: number[] = [];
    await runCanonicalInputTaskQueue({
      tasks: [task(0, true), task(1), task(2, true), task(3), task(4, true)],
      sessionId: "session",
      workerCount: 4,
      createExecutor: () => ({ async process(job) { return record(job); }, terminate() {} }),
      async runRaw(job) {
        runningRaw++;
        maxRaw = Math.max(maxRaw, runningRaw);
        await new Promise((resolve) => setTimeout(resolve, 3));
        runningRaw--;
        return record(job);
      },
      onComplete: (job) => done.push(job.imageIndex),
    });
    expect(maxRaw).toBe(1);
    expect(done.sort()).toEqual([0, 1, 2, 3, 4]);
  });

  test("failed image stops scheduling, drains running jobs, and terminates workers", async () => {
    const started: number[] = [];
    let terminated = 0;
    await expect(runCanonicalInputTaskQueue({
      tasks: [task(0), task(1), task(2), task(3)],
      sessionId: "session",
      workerCount: 2,
      createExecutor: () => ({
        async process(job) {
          started.push(job.imageIndex);
          if (job.imageIndex === 0) throw new Error("broken decoder");
          await new Promise((resolve) => setTimeout(resolve, 5));
          return record(job);
        },
        terminate() { terminated += 1; },
      }),
      runRaw: async (job) => record(job),
    })).rejects.toThrow("image-0.tif: broken decoder");
    expect(started).not.toContain(3);
    expect(terminated).toBe(2);
  });
});
