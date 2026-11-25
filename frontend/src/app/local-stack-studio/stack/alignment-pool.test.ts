import { AlignmentImplementationError } from "../workers/alignment-error";
import {
  ALIGNMENT_MAX_WORKERS,
  resolveAlignmentWorkerCount,
  runAlignmentPool,
  runProgressivePipelinedPool,
  type AlignmentPoolClient,
} from "./alignment-pool";

type MockReady = { workerId: number };
type MockResult = { id: number; workerId: number };

function frame() {
  return {
    width: 4,
    height: 4,
    grayBytes: new Uint8Array(16),
    exposureScalar: 1,
  };
}

describe("alignment worker pool", () => {
  test("caps workers by hardware concurrency, job count, and the LSS maximum", () => {
    expect(resolveAlignmentWorkerCount(0, 8)).toBe(0);
    expect(resolveAlignmentWorkerCount(2, 8)).toBe(2);
    expect(resolveAlignmentWorkerCount(8, 2)).toBe(2);
    expect(resolveAlignmentWorkerCount(8, 32)).toBe(ALIGNMENT_MAX_WORKERS);
  });

  test("runs independent target jobs concurrently", async () => {
    let nextWorkerId = 0;
    let active = 0;
    let maxActive = 0;
    const createClient = (): AlignmentPoolClient<MockReady, MockResult> => {
      const workerId = nextWorkerId++;
      return {
        async initialize() {
          return { workerId };
        },
        async align(id) {
          active += 1;
          maxActive = Math.max(maxActive, active);
          await new Promise((resolve) => setTimeout(resolve, 5));
          active -= 1;
          return { id, workerId };
        },
        terminate() {},
      };
    };

    const result = await runAlignmentPool({
      jobs: Array.from({ length: 4 }, (_, id) => ({ id, fileName: `${id}.jpg`, frame: frame() })),
      referenceFrame: frame(),
      createClient,
      hardwareConcurrency: 4,
    });

    expect(result.workerCount).toBe(4);
    expect(result.successes).toHaveLength(4);
    expect(result.failures).toHaveLength(0);
    expect(maxActive).toBeGreaterThan(1);
  });

  test("reports reference initialization failure so the caller can try the secondary algorithm", async () => {
    const createClient = (): AlignmentPoolClient<MockReady, MockResult> => ({
      async initialize() {
        throw new Error("reference has too few features");
      },
      async align(id) {
        return { id, workerId: 0 };
      },
      terminate() {},
    });

    const result = await runAlignmentPool({
      jobs: [0, 1].map((id) => ({ id, fileName: `${id}.jpg`, frame: frame() })),
      referenceFrame: frame(),
      createClient,
      hardwareConcurrency: 2,
    });

    expect(result.workerCount).toBe(0);
    expect(result.initializationMs).toBeGreaterThanOrEqual(0);
    expect(result.jobsMs).toBe(0);
    expect(result.successes).toHaveLength(0);
    expect(result.failures).toHaveLength(2);
    expect(result.failures[0].error.message).toContain("reference has too few features");
  });

  test("collects ordinary alignment failures without aborting other jobs", async () => {
    let nextWorkerId = 0;
    const createClient = (): AlignmentPoolClient<MockReady, MockResult> => {
      const workerId = nextWorkerId++;
      return {
        async initialize() {
          return { workerId };
        },
        async align(id) {
          if (id === 1) throw new Error("no match");
          return { id, workerId };
        },
        terminate() {},
      };
    };

    const result = await runAlignmentPool({
      jobs: [0, 1, 2].map((id) => ({ id, fileName: `${id}.jpg`, frame: frame() })),
      referenceFrame: frame(),
      createClient,
      hardwareConcurrency: 3,
    });

    expect(result.successes.map(({ job }) => job.id).sort()).toEqual([0, 2]);
    expect(result.failures).toHaveLength(1);
    expect(result.failures[0].job.id).toBe(1);
    expect(result.failures[0].error.message).toBe("no match");
  });

  test("aborts the pool on an implementation error", async () => {
    let nextWorkerId = 0;
    let terminated = 0;
    const createClient = (): AlignmentPoolClient<MockReady, MockResult> => {
      const workerId = nextWorkerId++;
      return {
        async initialize() {
          return { workerId };
        },
        async align(id) {
          if (id === 0) throw new AlignmentImplementationError("ORB API missing");
          await new Promise((resolve) => setTimeout(resolve, 20));
          return { id, workerId };
        },
        terminate() {
          terminated += 1;
        },
      };
    };

    await expect(runAlignmentPool({
      jobs: [0, 1, 2, 3].map((id) => ({ id, fileName: `${id}.jpg`, frame: frame() })),
      referenceFrame: frame(),
      createClient,
      hardwareConcurrency: 4,
    })).rejects.toThrow("ORB API missing");

    expect(terminated).toBeGreaterThanOrEqual(4);
  });

  test("overlaps 1MP estimation with 8MP preparation and refines in the same worker", async () => {
    const events: string[] = [];
    let nextWorkerId = 0;
    const ref = { ...frame(), refinement: { width: 8, height: 8, grayBytes: new Uint8Array(64) } };
    const jobs = [0, 1, 2].map((id) => ({
      id, fileName: `${id}.jpg`,
      frame: { ...frame(), refinement: { width: 8, height: 8, grayBytes: new Uint8Array(64) } },
    }));
    const result = await runProgressivePipelinedPool({
      jobs, referenceFrame: ref, hardwareConcurrency: 2,
      createClient: () => {
        const workerId = nextWorkerId++;
        const owned = new Set<number>();
        return {
          async initialize() { return { workerId }; },
          async align() { throw new Error("Unexpected unsplit ORB alignment"); },
          async alignCoarse(id: number) {
            events.push(`coarse ${id}`);
            owned.add(id);
            return { id, workerId };
          },
          async refine(id: number) {
            expect(owned.has(id)).toBe(true);
            events.push(`refine ${id}`);
            return { id, workerId };
          },
          terminate() {},
        };
      },
      async prepareRefinement() {
        events.push("prepare 8MP");
        await Promise.resolve();
        events.push("8MP ready");
      },
    });
    expect(result.failures).toHaveLength(0);
    expect(result.successes).toHaveLength(3);
    expect(events.indexOf("coarse 0")).toBeLessThan(events.indexOf("prepare 8MP"));
    expect(events.indexOf("coarse 1")).toBeLessThan(events.indexOf("prepare 8MP"));
    expect(events.indexOf("8MP ready")).toBeLessThan(events.indexOf("refine 0"));
  });

  test("streams coarse frames and runs every coarse job before 8MP refinement", async () => {
    const events: string[] = [];
    const signal: Array<() => void> = [];
    const ready = Array.from({ length: 4 }, (_, index) => new Promise<void>((resolve) => {
      signal[index] = resolve;
    }));
    let workerId = 0;
    // The pipeline requires 8MP frames for every successful refinement.
    // They are pre-populated here because this test isolates 1MP scheduling.
    const refinementFrame = () => ({ width: 8, height: 8, grayBytes: new Uint8Array(64) });
    const referenceFrame = { ...frame(), refinement: refinementFrame() };
    const jobs = Array.from({ length: 4 }, (_, id) => ({
      id, fileName: `${id}.tif`, frame: { ...frame(), refinement: refinementFrame() },
    }));
    const resultPromise = runProgressivePipelinedPool({
      jobs,
      referenceFrame,
      hardwareConcurrency: 2,
      coarseReady: (id) => ready[id],
      coarsePreparation: Promise.all(ready).then(() => undefined),
      createClient: () => {
        const id = workerId++;
        const owned = new Set<number>();
        return {
          async initialize() { return { workerId: id }; },
          async align() { throw new Error("Unexpected combined ORB operation"); },
          async alignCoarse(image: number) {
            events.push(`coarse ${image}`);
            owned.add(image);
            return { id: image, workerId: id };
          },
          async refine(image: number) {
            expect(owned.has(image)).toBe(true);
            events.push(`fine ${image}`);
            return { id: image, workerId: id };
          },
          terminate() {},
        };
      },
      async prepareRefinement() {
        events.push("prepare fine");
      },
    });
    // Input frames arrive independently, after scheduling has begun.
    signal[0](); signal[1]();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(events).toContain("coarse 0");
    expect(events).toContain("coarse 1");
    expect(events.some((event) => event.startsWith("fine"))).toBe(false);
    signal[2](); signal[3]();
    const result = await resultPromise;
    expect(result.successes).toHaveLength(4);
    expect(result.failures).toHaveLength(0);
    const firstFine = events.findIndex((event) => event.startsWith("fine"));
    expect(firstFine).toBeGreaterThan(events.indexOf("coarse 3"));
  });

  test("refines a ready target before the remaining 8MP frames finish", async () => {
    const events: string[] = [];
    let releaseLastFine: () => void = () => {};
    let releaseFirstFine: () => void = () => {};
    const firstFine = new Promise<void>((resolve) => { releaseFirstFine = resolve; });
    const lastFine = new Promise<void>((resolve) => { releaseLastFine = resolve; });
    const ref = { ...frame(), refinement: { width: 8, height: 8, grayBytes: new Uint8Array(64) } };
    const jobs = [0, 1].map((id) => ({
      id, fileName: `${id}.tif`,
      frame: { ...frame(), refinement: { width: 8, height: 8, grayBytes: new Uint8Array(64) } },
    }));
    let firstRefined: () => void = () => {};
    const firstRefinement = new Promise<void>((resolve) => { firstRefined = resolve; });
    const running = runProgressivePipelinedPool({
      jobs, referenceFrame: ref, hardwareConcurrency: 2,
      createClient: () => {
        const owned = new Set<number>();
        return {
          async initialize() { return { workerId: 0 }; },
          async align() { throw new Error("Unexpected combined request"); },
          async alignCoarse(id: number) { owned.add(id); events.push(`coarse ${id}`); return { id, workerId: 0 }; },
          async refine(id: number) {
            expect(owned.has(id)).toBe(true);
            events.push(`fine ${id}`);
            if (id === 0) firstRefined();
            return { id, workerId: 0 };
          },
          terminate() {},
        };
      },
      refinementReady: (id) => id === 0 ? firstFine : lastFine,
      async prepareRefinement() {
        releaseFirstFine();
        await lastFine;
      },
    });
    await firstRefinement;
    expect(events).toContain("fine 0");
    expect(events).not.toContain("fine 1");
    releaseLastFine();
    const result = await running;
    expect(result.successes).toHaveLength(2);
    expect(result.failures).toHaveLength(0);
  });

  test("refines later owned images first when their 8MP data arrives first", async () => {
    const order: number[] = [];
    let releaseFirst: () => void = () => {};
    const first = new Promise<void>((resolve) => { releaseFirst = resolve; });
    const second = Promise.resolve();
    const ref = { ...frame(), refinement: { width: 8, height: 8, grayBytes: new Uint8Array(64) } };
    const jobs = [0, 1].map((id) => ({
      id, fileName: `${id}.tif`,
      frame: { ...frame(), refinement: { width: 8, height: 8, grayBytes: new Uint8Array(64) } },
    }));
    let secondRefined: () => void = () => {};
    const secondResult = new Promise<void>((resolve) => { secondRefined = resolve; });
    const running = runProgressivePipelinedPool({
      jobs, referenceFrame: ref, hardwareConcurrency: 1,
      createClient: () => {
        const owned = new Set<number>();
        return {
          async initialize() { return { workerId: 0 }; },
          async align() { throw new Error("Unexpected combined request"); },
          async alignCoarse(id: number) { owned.add(id); return { id, workerId: 0 }; },
          async refine(id: number) {
            expect(owned.has(id)).toBe(true);
            order.push(id);
            if (id === 1) secondRefined();
            return { id, workerId: 0 };
          },
          terminate() {},
        };
      },
      refinementReady: (id) => id === 0 ? first : second,
      async prepareRefinement() { await first; },
    });
    await secondResult;
    expect(order).toEqual([1]);
    releaseFirst();
    const result = await running;
    expect(order).toEqual([1, 0]);
    expect(result.successes).toHaveLength(2);
  });

});
