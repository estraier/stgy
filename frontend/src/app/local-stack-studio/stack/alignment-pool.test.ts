import { AlignmentImplementationError } from "../workers/alignment-error";
import {
  ALIGNMENT_MAX_WORKERS,
  resolveAlignmentWorkerCount,
  runAlignmentPool,
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
});
