import {
  FOCUS_FEATURE_MAX_WORKERS,
  resolveFocusFeatureWorkerCount,
  runFocusFeaturePool,
  type FocusFeaturePoolClient,
} from "./focus-pool";

const identity = new Float64Array([1, 0, 0, 0, 1, 0, 0, 0, 1]);
const config = {
  sessionId: "session",
  alignmentPlan: {
    normalizationMode: "feature-match" as const,
    targetWidth: 8,
    targetHeight: 6,
  },
  matrices: [identity, identity, identity, identity],
};

function result(imageIndex: number) {
  return {
    features: new Float32Array([imageIndex, imageIndex + 0.5]),
    workingWidth: 1,
    workingHeight: 1,
    lapStats: { count: 1, mean: imageIndex, m2: 0 },
    sobelStats: { count: 1, mean: imageIndex + 1, m2: 0 },
  };
}

describe("Focus feature worker pool", () => {
  test("caps workers by hardware concurrency, image count, and the LSS maximum", () => {
    expect(resolveFocusFeatureWorkerCount(1, 8)).toBe(1);
    expect(resolveFocusFeatureWorkerCount(2, 8)).toBe(2);
    expect(resolveFocusFeatureWorkerCount(8, 2)).toBe(2);
    expect(resolveFocusFeatureWorkerCount(8, 32)).toBe(FOCUS_FEATURE_MAX_WORKERS);
  });

  test("runs independent image feature jobs concurrently", async () => {
    let active = 0;
    let maxActive = 0;
    let terminated = 0;
    const completed: number[] = [];
    const createClient = (): FocusFeaturePoolClient => ({
      async initializeCanonical() {
        return { imageCount: 4, width: 8, height: 6 };
      },
      async computeSharpnessFeaturesFromCanonical(imageIndex) {
        active += 1;
        maxActive = Math.max(maxActive, active);
        await new Promise((resolve) => setTimeout(resolve, 5));
        active -= 1;
        return result(imageIndex);
      },
      terminate() {
        terminated += 1;
      },
    });

    const pool = await runFocusFeaturePool({
      imageCount: 4,
      width: 8,
      height: 6,
      config,
      createClient,
      hardwareConcurrency: 4,
      onJobComplete(imageIndex) {
        completed.push(imageIndex);
      },
    });

    expect(pool.workerCount).toBe(4);
    expect(completed.sort((a, b) => a - b)).toEqual([0, 1, 2, 3]);
    expect(maxActive).toBeGreaterThan(1);
    expect(terminated).toBe(4);
  });

  test("aborts all feature workers when any image fails", async () => {
    let terminated = 0;
    const createClient = (): FocusFeaturePoolClient => ({
      async initializeCanonical() {
        return { imageCount: 4, width: 8, height: 6 };
      },
      async computeSharpnessFeaturesFromCanonical(imageIndex) {
        if (imageIndex === 0) throw new Error("focus feature failed");
        await new Promise((resolve) => setTimeout(resolve, 20));
        return result(imageIndex);
      },
      terminate() {
        terminated += 1;
      },
    });

    await expect(runFocusFeaturePool({
      imageCount: 4,
      width: 8,
      height: 6,
      config,
      createClient,
      hardwareConcurrency: 4,
    })).rejects.toThrow("focus feature failed");

    expect(terminated).toBeGreaterThanOrEqual(4);
  });

  test("rejects a canonical reader initialized for a different size", async () => {
    const createClient = (): FocusFeaturePoolClient => ({
      async initializeCanonical() {
        return { imageCount: 4, width: 9, height: 6 };
      },
      async computeSharpnessFeaturesFromCanonical(imageIndex) {
        return result(imageIndex);
      },
      terminate() {},
    });

    await expect(runFocusFeaturePool({
      imageCount: 4,
      width: 8,
      height: 6,
      config,
      createClient,
      hardwareConcurrency: 1,
    })).rejects.toThrow("does not match expected");
  });
});
