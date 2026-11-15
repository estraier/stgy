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

// Integration regression: Flow vectors are persistent, not generated RGB16.
// The fake client models a cache hit inside the real Flow worker, while the
// virtual-source loop must still warp every requested frame in exact order.
import { appendStfVirtualSource } from "./stf-virtual-source";
import { computeCanonicalToneStatisticsFromStoredRgb16 } from "./canonical-source";

const testPixels = (value: number) => new Uint16Array(12).fill(value);

function virtualHarness(persist = true) {
  const actual = [testPixels(23000), testPixels(25000)];
  const persistedFlowKeys = new Set<string>();
  const stats = computeCanonicalToneStatisticsFromStoredRgb16(actual[0], 2, 2);
  let reads = 0;
  let flowComputations = 0;
  let generations = 0;
  let warps = 0;
  let active = 0;
  const reader = {
    width: 2, height: 2,
    readGamma2Image: async (index: number) => { reads++; return actual[index]; },
  };
  const factory = () => {
    active++;
    return {
      warmup: async () => { throw new Error("Warmup must be lazy on Flow cache hits"); },
      generate: async (_width: number, _height: number, _previous: number, _next: number,
        _a: Uint16Array, _b: Uint16Array, variant: string, _scale: number | undefined,
        additionalVariant?: string, _additionalScale?: number, _retainPair?: boolean,
        persistFlow?: boolean, sessionId?: string, _sessionCreatedAt?: number, alignmentKey?: string) => {
        generations++;
        const key = `${sessionId}:${alignmentKey}:pair-0-1`; // same session across q/mode runs
        const hit = Boolean(persist && persistFlow && persistedFlowKeys.has(key));
        if (!hit) flowComputations++;
        if (persist && persistFlow) persistedFlowKeys.add(key);
        const pixelsForVariant = (v: string) => testPixels(v === "mid" ? 24000 : v === "ext1" ? 22500 : 22000);
        return {
          pixels: pixelsForVariant(variant),
          ...(additionalVariant ? { additionalPixels: pixelsForVariant(additionalVariant) } : {}),
          performance: { flowCacheHit: hit, flowCacheSaved: Boolean(persist && persistFlow && !hit) },
        };
      },
      warpRetained: async (_width: number, _height: number, _previous: number, _next: number, variant: string) => {
        warps++;
        return { pixels: testPixels(variant === "ext1" ? 22500 : 22000), warpMs: 0 };
      },
      releaseRetained: () => {}, terminate: () => { active--; },
    };
  };
  const run = async (q: number, mode: "interpolation" | "extrapolation-2" | "extrapolation-10") => {
    const accumulator = new Float32Array(12);
    const originalInfo = console.info;
    const infoSpy = jest.spyOn(console, "info").mockImplementation((...args: unknown[]) => {
      if (typeof args[0] === "string" && args[0].startsWith("[LSS STF] Flow cache:")) return;
      originalInfo.apply(console, args);
    });
    try {
      await appendStfVirtualSource(accumulator, {
        frameSet: buildStfFrameSet([2, 3], q, mode),
        sessionId: "session-a", sessionCreatedAt: 1_700_000_000_000, alignmentKey: "align-1",
        reader: reader as never,
        canonicalImages: [{ toneStatistics: stats }] as never,
        toneReferenceIndex: 0,
        createFlowClient: factory as never,
      });
    } finally {
      infoSpy.mockRestore();
    }
    return accumulator;
  };
  return { run, get counts() { return { reads, flowComputations, generations, warps, active }; } };
}

test("cached Flow skips Farneback across q changes, but still warps and accumulates RGB16", async () => {
  const h = virtualHarness();
  const first = await h.run(1, "extrapolation-2");
  expect(h.counts).toEqual({ reads: 2, flowComputations: 1, generations: 1, warps: 1, active: 0 });
  const again = await h.run(1, "extrapolation-2");
  expect(Array.from(again)).toEqual(Array.from(first));
  expect(h.counts).toEqual({ reads: 4, flowComputations: 1, generations: 2, warps: 2, active: 0 });
  const changedQ = await h.run(0, "extrapolation-2");
  expect(h.counts.flowComputations).toBe(1);
  expect(h.counts.generations).toBe(3);
  expect(Array.from(changedQ)).not.toEqual(Array.from(first));
});

test("extension 2 to 10 reuses the same real-pair Flow; all generated RGB16 are transient", async () => {
  const h = virtualHarness();
  await h.run(1, "extrapolation-2");
  const larger = await h.run(1, "extrapolation-10");
  expect(h.counts.flowComputations).toBe(1);
  expect(h.counts.generations).toBe(2);
  expect(h.counts.warps).toBe(1 + 9);
  const uncached = virtualHarness(false);
  const comparison = await uncached.run(1, "extrapolation-10");
  expect(Array.from(larger)).toEqual(Array.from(comparison));
  expect(h.counts.active).toBe(0);
});

test("without IndexedDB a miss recomputes only once per real pair and preserves output", async () => {
  const h = virtualHarness(false);
  const first = await h.run(1, "extrapolation-2");
  const again = await h.run(1, "extrapolation-2");
  expect(h.counts.flowComputations).toBe(2);
  expect(Array.from(again)).toEqual(Array.from(first));
});
