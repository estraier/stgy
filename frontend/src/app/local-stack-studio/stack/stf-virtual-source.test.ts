import { decodeStfGeneratedStripe } from "./stf-virtual-source";
import { buildStfFrameSet } from "./stf-frame-generation";
import { encodeStoredRgb16Channel } from "@/image/rgb16-storage";

describe("STF virtual gamma-2 RGB16 numerical domain", () => {
  test("preserves extended highlights through linear 4", () => {
    const inputs = [0, 0.125, 0.5, 1, 2.5, 4];
    const encoded = Uint16Array.from(inputs.map((linear) => encodeStoredRgb16Channel(linear, "gamma20", 4)));
    const decoded = decodeStfGeneratedStripe(encoded, 0, encoded.length);
    inputs.forEach((value, i) => expect(decoded[i]).toBeCloseTo(value, 3));
  });
  test("rejects partial or out-of-bounds stripe", () => {
    expect(() => decodeStfGeneratedStripe(new Uint16Array(2), 1, 2)).toThrow();
  });
});

test("extrapolation attaches opening frames only to the first real aperture pair", () => {
  const real = [2.8, 4, 3.5, 3.2, 2.5, 2.2, 2];
  const frameSet = buildStfFrameSet(real, 1, "extrapolation-2");
  expect(frameSet.middleFrames).toHaveLength(6);
  expect(frameSet.outerFrames.map((frame) => frame.variant)).toEqual(["ext1", "ext1-2"]);
  const firstPair = frameSet.middleFrames[0];
  expect(frameSet.outerFrames.every((outer) =>
    outer.previousIndex === firstPair.previousIndex && outer.nextIndex === firstPair.nextIndex,
  )).toBe(true);
  for (const otherPair of frameSet.middleFrames.slice(1)) {
    expect(frameSet.outerFrames.filter((outer) =>
      outer.previousIndex === otherPair.previousIndex && outer.nextIndex === otherPair.nextIndex,
    )).toHaveLength(0);
  }
  const interpolation = buildStfFrameSet(real, 1, "interpolation");
  expect(interpolation.outerFrames).toHaveLength(0);
});

test.each([1, 3, 10])("extrapolation-%i generates only opening-side frames on the first pair", (count) => {
  const frameSet = buildStfFrameSet([2, 2.2, 2.5, 2.8, 3.2, 3.5, 4], 1,
    `extrapolation-${count}` as "extrapolation-1" | "extrapolation-3" | "extrapolation-10");
  expect(frameSet.middleFrames).toHaveLength(6);
  expect(frameSet.outerFrames).toHaveLength(count);
  expect(frameSet.outerFrames.map((frame) => frame.variant)).toEqual(
    Array.from({ length: count }, (_, i) => i === 0 ? "ext1" : `ext1-${i + 1}`),
  );
  const firstPair = frameSet.middleFrames[0];
  expect(frameSet.outerFrames.every((outer) =>
    outer.previousIndex === firstPair.previousIndex && outer.nextIndex === firstPair.nextIndex,
  )).toBe(true);
  expect(frameSet.allWeights).toHaveLength(7 + 6 + count);
  expect(Array.from(frameSet.allWeights).reduce((sum, weight) => sum + weight, 0)).toBeCloseTo(1, 6);
});

// Integration regression: validate the actual virtual-source loop without a
// browser/WASM worker, including no duplicate flow after a q change.
import { appendStfVirtualSource } from "./stf-virtual-source";
import { StfVirtualFrameCache } from "./stf-process-cache";
import { computeCanonicalToneStatisticsFromStoredRgb16 } from "./canonical-source";

const testPixels = (value: number) => new Uint16Array(12).fill(value);

function virtualHarness(frameCountBudget = 1024) {
  const actual = [testPixels(23000), testPixels(25000)];
  const cache = new StfVirtualFrameCache(frameCountBudget);
  const stats = computeCanonicalToneStatisticsFromStoredRgb16(actual[0], 2, 2);
  let reads = 0;
  let flows = 0;
  let warps = 0;
  let active = 0;
  const reader = {
    width: 2, height: 2,
    readGamma2Image: async (index: number) => { reads++; return actual[index]; },
  };
  const factory = () => {
    active++;
    return {
      warmup: async () => ({ flowWorkerCount: 1, warmupMs: 0 }),
      generate: async (_width: number, _height: number, _previous: number, _next: number,
        _a: Uint16Array, _b: Uint16Array, variant: string, _scale: number | undefined,
        additionalVariant?: string) => {
        flows++;
        const v = variant === "mid" ? 24000 : variant === "ext1" ? 22500 : 22000;
        const extra = additionalVariant === "mid" ? 24000 : additionalVariant === "ext1" ? 22500 : 22000;
        return { pixels: testPixels(v),
          ...(additionalVariant ? { additionalPixels: testPixels(extra) } : {}), performance: {} };
      },
      warpRetained: async (_width: number, _height: number, _previous: number, _next: number, variant: string) => {
        warps++;
        return { pixels: testPixels(variant === "ext1" ? 22500 : 22000), warpMs: 0 };
      },
      releaseRetained: () => {}, terminate: () => { active--; },
    };
  };
  const run = async (q: number, mode: "interpolation" | "extrapolation-2") => {
    const accumulator = new Float32Array(12);
    // Keep the production cache diagnostic, but do not print it from this
    // integration test. Other console messages must remain visible.
    const originalInfo = console.info;
    const infoSpy = jest.spyOn(console, "info").mockImplementation((...args: unknown[]) => {
      if (typeof args[0] === "string" && args[0].startsWith("[LSS STF] Virtual cache:")) return;
      originalInfo.apply(console, args);
    });
    try {
      await appendStfVirtualSource(accumulator, {
        frameSet: buildStfFrameSet([2, 3], q, mode),
        reader: reader as never,
        canonicalImages: [{ toneStatistics: stats }] as never,
        toneReferenceIndex: 0, frameCache: cache, frameContextKey: "same-alignment",
        createFlowClient: factory as never,
      });
    } finally {
      infoSpy.mockRestore();
    }
    return accumulator;
  };
  return { run, cache, get counts() { return { reads, flows, warps, active }; } };
}

test("virtual frames are reused across q switches without Flow or real RGB16 reads", async () => {
  const h = virtualHarness();
  const first = await h.run(1, "extrapolation-2");
  expect(h.counts.flows).toBe(1);
  expect(h.counts.warps).toBe(1);
  expect(h.counts.active).toBe(0);
  const counts = h.counts;
  const again = await h.run(1, "extrapolation-2");
  expect(Array.from(again)).toEqual(Array.from(first));
  const changedQ = await h.run(0, "extrapolation-2");
  expect(h.counts).toEqual(counts);
  expect(Array.from(changedQ)).not.toEqual(Array.from(first));
});

test("LRU evictions never reorder contributions or compute a Flow twice per pair", async () => {
  const cold = virtualHarness(48); // 2 out of 3 tiny RGB16 frames
  await cold.run(1, "extrapolation-2");
  expect(cold.counts.flows).toBe(1);
  expect(cold.counts.warps).toBe(1);
  const hot = await cold.run(1, "extrapolation-2");
  expect(cold.counts.flows).toBe(2); // only missing mid: one new flow
  expect(cold.counts.warps).toBe(1); // ext1 and ext2 were in the LRU
  const uncached = virtualHarness(1);
  const plain = await uncached.run(1, "extrapolation-2");
  expect(Array.from(hot)).toEqual(Array.from(plain));
});
