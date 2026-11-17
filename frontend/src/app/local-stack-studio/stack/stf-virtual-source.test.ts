import { decodeStfGeneratedStripe } from "./stf-virtual-source";
import { buildStfFrameSet, STF_EXTRAPOLATION_COUNTS, type StfFrameGenerationMode } from "./stf-frame-generation";
import { encodeStoredRgb16Channel } from "@/image/rgb16-storage";
import { prepareStfFrameSetForTone } from "./stf-frame-density";

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

test("extrapolation attaches opening frames to first pair and one closing to last", () => {
  const real = [2.8, 4, 3.5, 3.2, 2.5, 2.2, 2];
  const frameSet = buildStfFrameSet(real, 1, "extrapolation-2");
  expect(frameSet.middleFrames).toHaveLength(6);
  expect(frameSet.outerFrames.map((frame) => frame.variant)).toEqual(["ext1", "ext1-2", "ext2"]);
  const firstPair = frameSet.middleFrames[0];
  expect(frameSet.outerFrames.filter((outer) => outer.variant !== "ext2").every((outer) =>
    outer.previousIndex === firstPair.previousIndex && outer.nextIndex === firstPair.nextIndex,
  )).toBe(true);
  const lastPair = frameSet.middleFrames[frameSet.middleFrames.length - 1];
  const closing = frameSet.outerFrames.filter((outer) => outer.variant === "ext2");
  expect(closing).toHaveLength(1);
  expect(closing[0].previousIndex).toBe(lastPair.previousIndex);
  expect(closing[0].nextIndex).toBe(lastPair.nextIndex);
  for (const otherPair of frameSet.middleFrames.slice(1, -1)) {
    expect(frameSet.outerFrames.filter((outer) =>
      outer.previousIndex === otherPair.previousIndex && outer.nextIndex === otherPair.nextIndex,
    )).toHaveLength(0);
  }
  const interpolation = buildStfFrameSet(real, 1, "interpolation");
  expect(interpolation.outerFrames).toHaveLength(0);
});

test.each(STF_EXTRAPOLATION_COUNTS)("extrapolation-%i generates N opening and one closing frame", (count) => {
  const frameSet = buildStfFrameSet([2, 2.2, 2.5, 2.8, 3.2, 3.5, 4], 1,
    `extrapolation-${count}` as StfFrameGenerationMode);
  expect(frameSet.middleFrames).toHaveLength(6);
  expect(frameSet.outerFrames).toHaveLength(count + 1);
  expect(frameSet.outerFrames.map((frame) => frame.variant)).toEqual([
    ...Array.from({ length: count }, (_, i) => i === 0 ? "ext1" : `ext1-${i + 1}`), "ext2",
  ]);
  const firstPair = frameSet.middleFrames[0];
  const lastPair = frameSet.middleFrames.at(-1)!;
  expect(frameSet.outerFrames.slice(0, -1).every((outer) =>
    outer.previousIndex === firstPair.previousIndex && outer.nextIndex === firstPair.nextIndex,
  )).toBe(true);
  expect(frameSet.outerFrames.at(-1)).toMatchObject({
    variant: "ext2", previousIndex: lastPair.previousIndex, nextIndex: lastPair.nextIndex,
  });
  expect(frameSet.allWeights).toHaveLength(7 + 6 + count + 1);
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
  const prepare = (q: number, mode: StfFrameGenerationMode) =>
    prepareStfFrameSetForTone(buildStfFrameSet([2, 3], q, mode), [2, 3],
      [{ gain: 1, scaledLog: 0 }, { gain: 1, scaledLog: 0 }], stats.p95, q);
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
        persistFlow?: boolean, sessionId?: string, _sessionCreatedAt?: number, alignmentKey?: string,
        _openingAverageRadiusSpan?: number) => {
        generations++;
        const key = `${sessionId}:${alignmentKey}:pair-0-1`; // same session across q/mode runs
        const hit = Boolean(persist && persistFlow && persistedFlowKeys.has(key));
        if (!hit) flowComputations++;
        if (persist && persistFlow) persistedFlowKeys.add(key);
        const pixelsForVariant = (v: string) => testPixels(v === "mid" ? 24000 : v === "ext1" ? 22500 : v === "ext2" ? 26000 : 22000);
        return {
          pixels: pixelsForVariant(variant),
          ...(additionalVariant ? { additionalPixels: pixelsForVariant(additionalVariant) } : {}),
          performance: { flowCacheHit: hit, flowCacheSaved: Boolean(persist && persistFlow && !hit) },
        };
      },
      warpRetained: async () => { throw new Error("Unexpected retained-pair warp in opening Average Flow path"); },
      warpOpeningAverage: async (_width: number, _height: number, _source: number, variant: string) => {
        warps++;
        return { pixels: testPixels(variant === "ext1" ? 22500 : 22000), warpMs: 0 };
      },
      releaseRetained: () => {}, terminate: () => { active--; },
    };
  };
  const run = async (q: number, mode: "interpolation" | "extrapolation-2" | "extrapolation-12") => {
    const accumulator = new Float32Array(12);
    const originalInfo = console.info;
    const infoSpy = jest.spyOn(console, "info").mockImplementation((...args: unknown[]) => {
      if (typeof args[0] === "string" && args[0].startsWith("[LSS STF] Flow cache:")) return;
      originalInfo.apply(console, args);
    });
    try {
      await appendStfVirtualSource(accumulator, {
        frameSet: prepare(q, mode),
        sessionId: "session-a", sessionCreatedAt: 1_700_000_000_000, alignmentKey: "align-1",
        reader: reader as never,
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
  expect(h.counts).toEqual({ reads: 3, flowComputations: 1, generations: 1, warps: 2, active: 0 });
  const again = await h.run(1, "extrapolation-2");
  expect(Array.from(again)).toEqual(Array.from(first));
  expect(h.counts).toEqual({ reads: 6, flowComputations: 1, generations: 2, warps: 4, active: 0 });
  const changedQ = await h.run(0, "extrapolation-2");
  expect(h.counts.flowComputations).toBe(1);
  expect(h.counts.generations).toBe(3);
  expect(Array.from(changedQ)).not.toEqual(Array.from(first));
});

test("extension 2 to 12 reuses the same real-pair Flow; all generated RGB16 are transient", async () => {
  const h = virtualHarness();
  await h.run(1, "extrapolation-2");
  const larger = await h.run(1, "extrapolation-12");
  expect(h.counts.flowComputations).toBe(1);
  expect(h.counts.generations).toBe(2);
  expect(h.counts.warps).toBe(2 + 12);
  const uncached = virtualHarness(false);
  const comparison = await uncached.run(1, "extrapolation-12");
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


test("closing extrapolation uses last real pair once while opening ext1..N reuse the first", async () => {
  const values = [23000, 25000, 27000];
  const actual = values.map(testPixels);
  const seen: string[] = [];
  const loaded: number[] = [];
  const reference = computeCanonicalToneStatisticsFromStoredRgb16(actual[0], 2, 2);
  const fake = () => ({
    warmup: async () => { throw new Error("Unexpected eager Flow warmup"); },
    generate: async (_w: number, _h: number, previousId: number, nextId: number,
      _a: Uint16Array, _b: Uint16Array, variant: string, _scale: number | undefined,
      additionalVariant?: string, _extraScale?: number, _retainPair?: boolean,
      _persist?: boolean, _session?: string, _created?: number, _alignment?: string,
      span?: number) => {
      seen.push(`generate:${previousId}-${nextId}:${variant}:${additionalVariant}:${span ?? "none"}`);
      return { pixels: testPixels(24000),
        ...(additionalVariant ? { additionalPixels: testPixels(additionalVariant === "ext2" ? 26000 : 22000) } : {}),
        performance: { flowCacheHit: false, flowCacheSaved: true, flowCacheReadMs: 0, flowWallMs: 0 },
      };
    },
    warpRetained: async () => { throw new Error("Unexpected retained-pair warp"); },
    warpOpeningAverage: async (_w: number, _h: number, sourceId: number, variant: string, _scale: number, source?: Uint16Array) => {
      seen.push(`average:${sourceId}:${variant}:${Boolean(source)}`);
      return { pixels: testPixels(21000), warpMs: 0 };
    },
    releaseRetained: () => { seen.push("release"); },
    terminate: () => { seen.push("terminate"); },
  });
  const originalInfo = console.info;
  const infoSpy = jest.spyOn(console, "info").mockImplementation((...args: unknown[]) => {
    if (typeof args[0] === "string" && args[0].startsWith("[LSS STF] Flow cache:")) return;
    originalInfo.apply(console, args);
  });
  try {
    const accumulator = new Float32Array(12);
    await appendStfVirtualSource(accumulator, {
      frameSet: prepareStfFrameSetForTone(buildStfFrameSet([2, 2.5, 4], 1, "extrapolation-4"),
        [2, 2.5, 4], [{gain:1, scaledLog:0}, {gain:1, scaledLog:0}, {gain:1, scaledLog:0}], reference.p95, 1),
      sessionId: "session-a", sessionCreatedAt: 1_700_000_000_000, alignmentKey: "align-1",
      reader: { width: 2, height: 2,
        readGamma2Image: async (index: number) => { loaded.push(index); return actual[index]; },
      } as never,
      createFlowClient: fake as never,
    });
    expect(loaded).toEqual([0, 1, 2, 0]);
    expect(seen).toEqual([
      `generate:0-1:mid:undefined:${1 / 2 - 1 / 2.5}`,
      `generate:1-2:mid:ext2:${1 / 2.5 - 1 / 4}`,
      "average:0:ext1:true", "average:0:ext1-2:false", "average:0:ext1-3:false", "average:0:ext1-4:false",
      "release", "terminate",
    ]);
    expect(accumulator[0]).toBeGreaterThan(0);
  } finally {
    infoSpy.mockRestore();
  }
});

// Pixel-level contract: a constant disc warped without radiometric adjustment
// must have precisely the same tone-corrected density assumed by the weights.
test("prepared synthetic weights use the exact tone curves applied to gamma2 midpoint and extrapolation pixels", async () => {
  const realF = [2, 4];
  const realTonePlans = [{ gain: 0.9, scaledLog: -0.3 }, { gain: 1.3, scaledLog: 0.5 }];
  const referenceP95 = 0.8;
  const prepared = prepareStfFrameSetForTone(buildStfFrameSet(realF, 1, "extrapolation-1"),
    realF, realTonePlans, referenceP95, 1);
  const raw = [referenceP95 * (realF[0] / realF[1]) ** 2, referenceP95];
  const realPixels = raw.map((v) => new Uint16Array(12).fill(encodeStoredRgb16Channel(v, "gamma20", 4)));
  const gammaMid = new Uint16Array(12).fill(Math.round((realPixels[0][0] + realPixels[1][0]) / 2));
  const fake = () => ({
    warmup: async () => {},
    generate: async (_w: number, _h: number, _prev: number, _next: number,
      _a: Uint16Array, _b: Uint16Array, _variant: string, _scale: number | undefined,
      additionalVariant?: string) => ({ pixels: gammaMid,
      ...(additionalVariant ? { additionalPixels: realPixels[1] } : {}),
      performance: { flowCacheHit: true, flowCacheSaved: false, flowCacheReadMs: 0, flowWallMs: 0 },
    }),
    warpRetained: async () => { throw new Error("Unexpected retained-pair warp"); },
    warpOpeningAverage: async () => ({ pixels: realPixels[0], warpMs: 0 }),
    releaseRetained: () => {}, terminate: () => {},
  });
  const output = new Float32Array(12);
  const originalInfo = console.info;
  console.info = () => {};
  try {
    await appendStfVirtualSource(output, {
      frameSet: prepared,
      sessionId: "tone-test", sessionCreatedAt: 1_700_000_000_000,
      alignmentKey: "constant-test", reader: {
        width: 2, height: 2, readGamma2Image: async (i: number) => realPixels[i],
      } as never,
      createFlowClient: fake as never,
    });
  } finally {
    console.info = originalInfo;
  }
  const realCount = realF.length;
  const expectedVirtualContribution = prepared.edgeDensities.slice(realCount)
    .reduce((sum, density, i) => sum + density * prepared.allWeights[realCount + i], 0);
  for (const sample of output) expect(sample).toBeCloseTo(expectedVirtualContribution, 3);
  // A tone-adjusted virtual image must NOT revert to the raw/source F² density.
  const uncorrectedVirtualContribution =
    prepared.middleFrames[0].weight * ((Math.sqrt(raw[0]) + Math.sqrt(raw[1])) / 2) ** 2 +
    prepared.outerFrames[0].weight * raw[0] + prepared.outerFrames[1].weight * raw[1];
  expect(Math.abs(expectedVirtualContribution - uncorrectedVirtualContribution)).toBeGreaterThan(0.0001);
});


test("extrapolation reuses up to the first three real pairs for opening Average Flow only", async () => {
  const f = [2, 2.25, 2.52, 2.83];
  const actual = f.map((_, i) => testPixels(22000 + i * 1500));
  const stats = computeCanonicalToneStatisticsFromStoredRgb16(actual[0], 2, 2);
  const frameSet = prepareStfFrameSetForTone(buildStfFrameSet(f, 1, "extrapolation-4"), f,
    f.map(() => ({ gain: 1, scaledLog: 0 })), stats.p95, 1);
  const requests: string[] = [];
  const seenSpans: number[] = [];
  const mock = () => ({
    warmup: async () => { throw new Error("No eager warmup"); },
    generate: async (_w: number, _h: number, previous: number, next: number,
      _a: Uint16Array, _b: Uint16Array, _v: string, _scale?: number,
      additionalVariant?: string, _extra?: number, _retainPair?: boolean,
      _persist?: boolean, _session?: string, _created?: number, _alignment?: string,
      span?: number) => {
      requests.push(`pair:${previous}-${next}:${additionalVariant ?? "none"}`);
      if (span !== undefined) seenSpans.push(span);
      return { pixels: testPixels(24000),
        ...(additionalVariant ? { additionalPixels: testPixels(26000) } : {}),
        performance: { flowCacheHit: true } };
    },
    warpRetained: async () => { throw new Error("Unexpected conventional retained warp"); },
    warpOpeningAverage: async (_w: number, _h: number, index: number,
      variant: string, _scale: number, source?: Uint16Array) => {
      requests.push(`opening:${variant}:${index}:${Boolean(source)}`);
      return { pixels: testPixels(21000), warpMs: 0 };
    },
    releaseRetained: () => requests.push("release"),
    terminate: () => requests.push("terminate"),
  });
  const info = jest.spyOn(console, "info").mockImplementation(() => {});
  try {
    const accumulator = new Float32Array(12);
    await appendStfVirtualSource(accumulator, {
      frameSet, sessionId: "average", sessionCreatedAt: 1, alignmentKey: "align",
      reader: { width: 2, height: 2, readGamma2Image: async (index: number) => actual[index] } as never,
      createFlowClient: mock as never,
    });
    expect(seenSpans).toHaveLength(3);
    expect(seenSpans[0]).toBeCloseTo(1 / f[0] - 1 / f[1]);
    expect(seenSpans[1]).toBeCloseTo(1 / f[1] - 1 / f[2]);
    expect(seenSpans[2]).toBeCloseTo(1 / f[2] - 1 / f[3]);
    expect(requests).toEqual([
      "pair:0-1:none", "pair:1-2:none", "pair:2-3:ext2",
      "opening:ext1:0:true", "opening:ext1-2:0:false", "opening:ext1-3:0:false", "opening:ext1-4:0:false",
      "release", "terminate",
    ]);
    expect(accumulator[0]).toBeGreaterThan(0);
  } finally { info.mockRestore(); }
});

test("three real images average the first two opening-side pairs", async () => {
  const f = [2, 2.5, 4];
  const actual = f.map((_, i) => testPixels(22000 + i * 1500));
  const stats = computeCanonicalToneStatisticsFromStoredRgb16(actual[0], 2, 2);
  const frameSet = prepareStfFrameSetForTone(buildStfFrameSet(f, 1, "extrapolation-2"), f,
    f.map(() => ({ gain: 1, scaledLog: 0 })), stats.p95, 1);
  const spans: number[] = [];
  const events: string[] = [];
  const mock = () => ({
    warmup: async () => { throw new Error("Unexpected warmup"); },
    generate: async (_w: number, _h: number, prev: number, next: number,
      _a: Uint16Array, _b: Uint16Array, _v: string, _scale?: number,
      additionalVariant?: string, _exscale?: number, _retainPair?: boolean, _persist?: boolean,
      _session?: string, _created?: number, _align?: string, span?: number) => {
      events.push(`pair:${prev}-${next}:${additionalVariant ?? "none"}`);
      if (span !== undefined) spans.push(span);
      return { pixels: testPixels(24000),
        ...(additionalVariant ? { additionalPixels: testPixels(26000) } : {}),
        performance: { flowCacheHit: true } };
    },
    warpRetained: async () => { throw new Error("Unexpected retained warp"); },
    warpOpeningAverage: async (_w: number, _h: number, sourceId: number, variant: string, _scale: number, source?: Uint16Array) => {
      events.push(`opening:${sourceId}:${variant}:${Boolean(source)}`);
      return { pixels: testPixels(23000), warpMs: 0 };
    },
    releaseRetained: () => events.push("release"),
    terminate: () => events.push("terminate"),
  });
  const log = jest.spyOn(console, "info").mockImplementation(() => {});
  try {
    await appendStfVirtualSource(new Float32Array(12), {
      frameSet, sessionId: "average", sessionCreatedAt: 1, alignmentKey: "align",
      reader: { width: 2, height: 2, readGamma2Image: async (index: number) => actual[index] } as never,
      createFlowClient: mock as never,
    });
    expect(spans).toEqual([1 / f[0] - 1 / f[1], 1 / f[1] - 1 / f[2]]);
    expect(events).toEqual([
      "pair:0-1:none", "pair:1-2:ext2",
      "opening:0:ext1:true", "opening:0:ext1-2:false",
      "release", "terminate",
    ]);
  } finally { log.mockRestore(); }
});
