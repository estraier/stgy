import { decodeStfGeneratedStripe } from "./stf-virtual-source";
import type { StfOpticalFlowClient } from "./stf-optical-flow-client";
import { buildStfFrameSet, STF_EXTRAPOLATION_COUNTS, type StfFrameGenerationMode } from "./stf-frame-generation";
import { encodeStoredRgb16Channel } from "@/image/rgb16-storage";
import { prepareStfFrameSetForTone } from "./stf-frame-density";
import type { StfRadialAttenuation } from "./stf-radial-weights";

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

test("fused generated-stripe decode, tone-match and add reproduces the three-stage Float32 result bitwise", () => {
  const { addStfGeneratedRgb16StripeToAccumulator, applyStfToneMatchInPlace,
    buildStfToneMatchLut } = jest.requireActual<typeof import("./stf-tone-match")>("./stf-tone-match");
  const { addWeightedLinearToAccumulator } = jest.requireActual<typeof import("./linear-merge")>("./linear-merge");
  for (const [gain, scaledLog] of [
    [1, 0], [0.5, -0.8], [2, 0.5], [5, 4], [0.05, -2], [13, 0],
  ]) {
    for (const weight of [0, 0.001, 0.25, 1.75]) {
      const pixels = Uint16Array.from({ length: 123 }, (_, index) =>
        index % 23 === 0 ? 0 : index % 19 === 0 ? 65535 : (index * 7919 + 173) % 65536);
      const lut = buildStfToneMatchLut(gain, scaledLog);
      const old = Float32Array.from({ length: 165 }, (_, index) => index * 0.017);
      const fused = old.slice();
      const decoded = decodeStfGeneratedStripe(pixels, 0, pixels.length);
      applyStfToneMatchInPlace(decoded, gain, scaledLog, lut);
      addWeightedLinearToAccumulator(old.subarray(21, 144), decoded, weight);
      addStfGeneratedRgb16StripeToAccumulator(fused, 21, pixels, pixels.length,
        weight, gain, scaledLog, lut);
      expect(new Uint32Array(fused.buffer)).toEqual(new Uint32Array(old.buffer));
    }
  }
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

// Existing numerical fixtures return full RGB16 arrays. Adapt them to the
// new stripe callbacks so the historical tone/weight expectations still run.
// Real-worker streaming is tested independently below.
function adaptLegacyClientFactory<T extends object>(factory: () => T) {
  return () => {
    const old = factory() as unknown as Pick<StfOpticalFlowClient,
      "generate" | "warpOpeningAverage" | "releaseRetained" | "terminate">;
    return {
      generateStripes: async (
        args: Parameters<StfOpticalFlowClient["generateStripes"]>[0],
        onStripe: Parameters<StfOpticalFlowClient["generateStripes"]>[1],
      ) => {
        const result = await old.generate(args.width, args.height,
          args.previousImageId, args.nextImageId, args.previousGamma2, args.nextGamma2,
          args.variant, args.variantScale, args.additionalVariant, args.additionalVariantScale,
          true, args.sessionId, args.sessionCreatedAt, args.alignmentKey,
          args.openingAverageRadiusSpan, args.winsize, args.inputOwnership);
        await onStripe({ kind: "primary", y: 0, height: args.height, pixels: result.pixels });
        if (args.additionalVariant && result.additionalPixels) {
          await onStripe({ kind: "additional", y: 0, height: args.height, pixels: result.additionalPixels });
        }
        return result.performance;
      },
      warpOpeningAverageStripes: async (
        args: Parameters<StfOpticalFlowClient["warpOpeningAverageStripes"]>[0],
        onStripe: Parameters<StfOpticalFlowClient["warpOpeningAverageStripes"]>[1],
      ) => {
        const result = await old.warpOpeningAverage(args.width, args.height,
          args.sourceImageId, args.variant, args.variantScale, args.sourceGamma2,
          args.transferSourceOwnership);
        await onStripe({ kind: "primary", y: 0, height: args.height, pixels: result.pixels });
        return { warpMs: result.warpMs };
      },
      releaseRetained: () => old.releaseRetained(),
      terminate: () => old.terminate(),
    };
  };
}

function virtualHarness(persist = true) {
  const actual = [testPixels(23000), testPixels(25000)];
  const persistedFlowKeys = new Set<string>();
  const stats = computeCanonicalToneStatisticsFromStoredRgb16(actual[0], 2, 2);
  const prepare = (q: StfRadialAttenuation, mode: StfFrameGenerationMode) =>
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
        additionalVariant?: string, _additionalScale?: number,
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

      warpOpeningAverage: async (_width: number, _height: number, _source: number, variant: string) => {
        warps++;
        return { pixels: testPixels(variant === "ext1" ? 22500 : 22000), warpMs: 0 };
      },
      releaseRetained: () => {}, terminate: () => { active--; },
    };
  };
  const run = async (q: StfRadialAttenuation, mode: "interpolation" | "extrapolation-2" | "extrapolation-12") => {
    const accumulator = new Float32Array(12);
    await appendStfVirtualSource(accumulator, {
        frameSet: prepare(q, mode),
        sessionId: "session-a", sessionCreatedAt: 1_700_000_000_000, alignmentKey: "align-1",
        reader: reader as never,
        createFlowClient: adaptLegacyClientFactory(factory) as never,
    });
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
      additionalVariant?: string, _extraScale?: number,
      _persist?: boolean, _session?: string, _created?: number, _alignment?: string,
      span?: number, winsize?: number) => {
      seen.push(`generate:${previousId}-${nextId}:${variant}:${additionalVariant}:${span ?? "none"}:${winsize}`);
      return { pixels: testPixels(24000),
        ...(additionalVariant ? { additionalPixels: testPixels(additionalVariant === "ext2" ? 26000 : 22000) } : {}),
        performance: { flowCacheHit: false, flowCacheSaved: true, flowCacheReadMs: 0, flowWallMs: 0 },
      };
    },

    warpOpeningAverage: async (_w: number, _h: number, sourceId: number, variant: string, _scale: number,
      source?: Uint16Array) => {
      seen.push(`average:${sourceId}:${variant}:${Boolean(source)}`);
      return { pixels: testPixels(21000), warpMs: 0 };
    },
    releaseRetained: () => { seen.push("release"); },
    terminate: () => { seen.push("terminate"); },
  });
  const accumulator = new Float32Array(12);
    await appendStfVirtualSource(accumulator, {
      frameSet: prepareStfFrameSetForTone(buildStfFrameSet([2, 2.5, 3], 1, "extrapolation-4"),
        [2, 2.5, 3], [{gain:1, scaledLog:0}, {gain:1, scaledLog:0}, {gain:1, scaledLog:0}], reference.p95, 1),
      sessionId: "session-a", sessionCreatedAt: 1_700_000_000_000, alignmentKey: "align-1",
      reader: { width: 2, height: 2,
        readGamma2Image: async (index: number) => { loaded.push(index); return actual[index]; },
      } as never,
      createFlowClient: adaptLegacyClientFactory(fake) as never,
    });
    expect(loaded).toEqual([0, 1, 2, 0]);
    expect(seen).toEqual([
      `generate:0-1:mid:undefined:${1 / 2 - 1 / 2.5}:21`,
      `generate:1-2:mid:ext2:${1 / 2.5 - 1 / 3}:15`,
      "average:0:ext1:true", "average:0:ext1-2:false",
      "average:0:ext1-3:false", "average:0:ext1-4:false",
      "release", "terminate",
    ]);
  expect(accumulator[0]).toBeGreaterThan(0);
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

    warpOpeningAverage: async () => ({ pixels: realPixels[0], warpMs: 0 }),
    releaseRetained: () => {}, terminate: () => {},
  });
  const output = new Float32Array(12);
  await appendStfVirtualSource(output, {
      frameSet: prepared,
      sessionId: "tone-test", sessionCreatedAt: 1_700_000_000_000,
      alignmentKey: "constant-test", reader: {
        width: 2, height: 2, readGamma2Image: async (i: number) => realPixels[i],
      } as never,
      createFlowClient: adaptLegacyClientFactory(fake) as never,
  });
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
      additionalVariant?: string, _extra?: number,
      _persist?: boolean, _session?: string, _created?: number, _alignment?: string,
      span?: number) => {
      requests.push(`pair:${previous}-${next}:${additionalVariant ?? "none"}`);
      if (span !== undefined) seenSpans.push(span);
      return { pixels: testPixels(24000),
        ...(additionalVariant ? { additionalPixels: testPixels(26000) } : {}),
        performance: { flowCacheHit: true } };
    },

    warpOpeningAverage: async (_w: number, _h: number, index: number,
      variant: string, _scale: number, source?: Uint16Array) => {
      requests.push(`opening:${variant}:${index}:${Boolean(source)}`);
      return { pixels: testPixels(21000), warpMs: 0 };
    },
    releaseRetained: () => requests.push("release"),
    terminate: () => requests.push("terminate"),
  });
  const accumulator = new Float32Array(12);
  await appendStfVirtualSource(accumulator, {
    frameSet, sessionId: "average", sessionCreatedAt: 1, alignmentKey: "align",
    reader: { width: 2, height: 2, readGamma2Image: async (index: number) => actual[index] } as never,
    createFlowClient: adaptLegacyClientFactory(mock) as never,
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
      additionalVariant?: string, _exscale?: number, _persist?: boolean,
      _session?: string, _created?: number, _align?: string, span?: number) => {
      events.push(`pair:${prev}-${next}:${additionalVariant ?? "none"}`);
      if (span !== undefined) spans.push(span);
      return { pixels: testPixels(24000),
        ...(additionalVariant ? { additionalPixels: testPixels(26000) } : {}),
        performance: { flowCacheHit: true } };
    },

    warpOpeningAverage: async (_w: number, _h: number, sourceId: number, variant: string, _scale: number, source?: Uint16Array) => {
      events.push(`opening:${sourceId}:${variant}:${Boolean(source)}`);
      return { pixels: testPixels(23000), warpMs: 0 };
    },
    releaseRetained: () => events.push("release"),
    terminate: () => events.push("terminate"),
  });
  await appendStfVirtualSource(new Float32Array(12), {
    frameSet, sessionId: "average", sessionCreatedAt: 1, alignmentKey: "align",
    reader: { width: 2, height: 2, readGamma2Image: async (index: number) => actual[index] } as never,
    createFlowClient: adaptLegacyClientFactory(mock) as never,
  });
  expect(spans).toEqual([1 / f[0] - 1 / f[1], 1 / f[1] - 1 / f[2]]);
  expect(events).toEqual([
    "pair:0-1:none", "pair:1-2:ext2",
    "opening:0:ext1:true", "opening:0:ext1-2:false",
    "release", "terminate",
  ]);

});


test("STF generated pairs use base 21 + F-dependent windows", async () => {
  const f = Array.from({ length: 7 }, (_, i) => 2 * 2 ** (i / 6));
  const actual = f.map(() => testPixels(24000));
  const reference = computeCanonicalToneStatisticsFromStoredRgb16(actual[0], 2, 2);
  const frameSet = prepareStfFrameSetForTone(buildStfFrameSet(f, 1, "interpolation"), f,
    f.map(() => ({ gain: 1, scaledLog: 0 })), reference.p95, 1);
  const passed: number[] = [];
  await appendStfVirtualSource(new Float32Array(12), {
    frameSet,
    sessionId: "test-session", sessionCreatedAt: 1_700_000_000_000,
    alignmentKey: "test-alignment",
    reader: { width: 2, height: 2,
      readGamma2Image: async (index: number) => actual[index],
    } as never,
    createFlowClient: adaptLegacyClientFactory(() => ({
      warmup: async () => { throw new Error("Unexpected warmup"); },
      generate: async (...args: unknown[]) => {
        passed.push(args[15] as number);
        return { pixels: testPixels(24000), performance: {
          flowCacheHit: false, flowCacheSaved: true, flowCacheReadMs: 0, flowWallMs: 0,
        } };
      },

      warpOpeningAverage: async () => { throw new Error("Unexpected average warp"); },
      releaseRetained: () => {}, terminate: () => {},
    })) as never,
  });

  expect(passed).toEqual([21, 19, 17, 15, 13, 13]);
});

test("streaming STF virtual merge exactly matches full-frame tone matching and accumulation", async () => {
  const width = 5, height = 260, samples = width * height * 3;
  const f = [2, 3];
  const actual = [new Uint16Array(samples).fill(23000), new Uint16Array(samples).fill(28000)];
  const stats = computeCanonicalToneStatisticsFromStoredRgb16(actual[0], width, height);
  const frameSet = prepareStfFrameSetForTone(buildStfFrameSet(f, 1, "extrapolation-2"), f,
    [{ gain: 0.91, scaledLog: -0.2 }, { gain: 1.11, scaledLog: 0.13 }], stats.p95, 1);
  const generatedPixels = (variant: string): Uint16Array => Uint16Array.from({ length: samples }, (_, i) =>
    Math.min(65535, (variant === "mid" ? 20000 : variant === "ext2" ? 26000 : 24000) + (i * 17) % 17000));
  const make = (stream: boolean) => {
    const seen: number[] = [];
    const streamedFactory = () => ({
      generateStripes: async (
        args: Parameters<StfOpticalFlowClient["generateStripes"]>[0],
        consume: Parameters<StfOpticalFlowClient["generateStripes"]>[1],
      ) => {
        expect(args.warpMethod).toBe("inverse-warp");
        expect(args.additionalWarpMethod).toBe("inverse-warp");
        expect(args.additionalForwardVariantScale).toBeUndefined();
        for (const variant of ["mid", ...(args.additionalVariant ? ["ext2"] : [])]) {
          const pixels = generatedPixels(variant);
          for (let y = 0; y < height; y += 128) {
            const rows = Math.min(128, height - y);
            const part = pixels.subarray(y * width * 3, (y + rows) * width * 3);
            seen.push(part.length);
            await consume({ kind: variant === "ext2" ? "additional" : "primary",
              y, height: rows, pixels: part });
          }
        }
        return { flowCacheHit: true, flowCacheSaved: false, flowCacheReadMs: 0, flowWallMs: 0 } as never;
      },
      warpOpeningAverageStripes: async (
        args: Parameters<StfOpticalFlowClient["warpOpeningAverageStripes"]>[0],
        consume: Parameters<StfOpticalFlowClient["warpOpeningAverageStripes"]>[1],
      ) => {
        expect(args.warpMethod).toBe("forward-splat");
        const pixels = generatedPixels(args.variant);
        for (let y = 0; y < height; y += 128) {
          const rows = Math.min(128, height - y);
          const part = pixels.subarray(y * width * 3, (y + rows) * width * 3);
          seen.push(part.length);
          await consume({ kind: "primary", y, height: rows, pixels: part });
        }
        return { warpMs: 0 };
      },
      releaseRetained: () => {}, terminate: () => {},
    });
    const fullFactory = adaptLegacyClientFactory(() => ({
      generate: async () => ({ pixels: generatedPixels("mid"), additionalPixels: generatedPixels("ext2"),
        performance: { flowCacheHit: true, flowCacheSaved: false, flowCacheReadMs: 0, flowWallMs: 0 } }),
      warpOpeningAverage: async (_w: number, _h: number, _index: number, variant: string) =>
        ({ pixels: generatedPixels(variant), warpMs: 0 }),
      releaseRetained: () => {}, terminate: () => {},
    }));
    const run = async () => {
      const accumulator = new Float32Array(samples);
      await appendStfVirtualSource(accumulator, {
        frameSet, sessionId: "stream-test", sessionCreatedAt: 1, alignmentKey: "align",
        reader: { width, height, readGamma2Image: async (i: number) => actual[i] } as never,
        createFlowClient: (stream ? streamedFactory : fullFactory) as never,
      });
      return accumulator;
    };
    return { run, seen };
  };
  const old = make(false);
  const streamed = make(true);
  const full = await old.run();
  const chunks = await streamed.run();
  expect(chunks).toEqual(full);
  expect(streamed.seen).toHaveLength(12); // 4 generated frames × 3 stripes
  expect(Math.max(...streamed.seen)).toBe(128 * width * 3);

});

test.each([2, 3, 4] as const)("Interpolation %i streams multiple frames per pair with a single Flow request", async (count) => {
  const f = [2, 2.52, 3.175];
  const width = 2, height = 3;
  const real = f.map((_, index) => new Uint16Array(width * height * 3).fill(21000 + index * 3000));
  const stats = computeCanonicalToneStatisticsFromStoredRgb16(real[0], width, height);
  const frameSet = prepareStfFrameSetForTone(
    buildStfFrameSet(f, 1, `interpolation-${count}` as `interpolation-${1 | 2 | 3 | 4}`), f,
    f.map(() => ({ gain: 1, scaledLog: 0 })), stats.p95, 1);
  const calls: Array<{ pair: string; fractions: number[] }> = [];
  let terminated = false;
  const accumulator = new Float32Array(width * height * 3);
  await appendStfVirtualSource(accumulator, {
    frameSet, sessionId: "interpolation-multi-test", sessionCreatedAt: 1,
    alignmentKey: "align", reader: {
      width, height, readGamma2Image: async (index: number) => real[index],
    } as never,
    createFlowClient: (() => ({
      generateStripes: async (
        args: Parameters<StfOpticalFlowClient["generateStripes"]>[0],
        onStripe: Parameters<StfOpticalFlowClient["generateStripes"]>[1],
      ) => {
        expect(args.variant).toBe("mid");
        expect(args.additionalVariant).toBeUndefined();
        expect(args.warpMethod).toBe("inverse-warp");
        expect(args.inputOwnership.previous).toBe(true);
        calls.push({ pair: `${args.previousImageId}-${args.nextImageId}`,
          fractions: args.middleFractions ?? [0.5] });
        for (const [middleIndex, t] of (args.middleFractions ?? [0.5]).entries()) {
          const pixels = new Uint16Array(width * height * 3).fill(24000 + Math.round(t * 12000));
          for (let y = 0; y < height; y += 2) {
            const rows = Math.min(2, height - y);
            await onStripe({ kind: "primary", middleIndex, y, height: rows,
              pixels: pixels.subarray(y * width * 3, (y + rows) * width * 3) });
          }
        }
        return { flowCacheHit: true, flowCacheSaved: false, flowWallMs: 0,
          warpMs: 0, totalWorkerMs: 0 } as never;
      },
      warpOpeningAverageStripes: async () => { throw new Error("Unexpected opening extrapolation"); },
      releaseRetained: () => {},
      terminate: () => { terminated = true; },
    })) as never,
  });
  expect(calls).toHaveLength(2); // One bidirectional Flow request per adjacent real-image pair.
  expect(calls.map((call) => call.pair)).toEqual(["0-1", "1-2"]);
  for (const call of calls) {
    expect(call.fractions).toHaveLength(count);
    call.fractions.forEach((fraction, i) => expect(fraction).toBeCloseTo((i + 1) / (count + 1), 12));
  }
  expect(accumulator.every((value) => Number.isFinite(value) && value > 0)).toBe(true);
  expect(terminated).toBe(true);

});

test("STF prefetch computes two adjacent pairs ahead, but merges their stripes strictly in order", async () => {
  const log: string[] = [];
  const ready = new Set<string>();
  let active = 0;
  let maxActive = 0;
  let releaseFirstTwo: (() => void) | undefined;
  const firstTwo = new Promise<void>((resolve) => { releaseFirstTwo = resolve; });
  const frameSet = {
    mode: "interpolation", allFNumbers: [2, 2.25, 2.52, 2.83],
    middleFrames: [0, 1, 2].map((i) => ({
      previousIndex: i, nextIndex: i + 1, pairLabel: `${i}-${i + 1}`,
      interpolationFraction: 0.5, weight: 0.1,
    })),
    outerFrames: [],
    virtualTonePlans: { middle: Array.from({ length: 3 }, () => ({ gain: 1, scaledLog: 0 })), outer: [] },
  };
  const pixels = [testPixels(22000), testPixels(24000), testPixels(26000), testPixels(28000)];
  const result = new Float32Array(12);
  await appendStfVirtualSource(result, {
    frameSet: frameSet as never,
    sessionId: "parallel", sessionCreatedAt: 1700000000000, alignmentKey: "align-1",
    reader: { width: 2, height: 2, readGamma2Image: async (index: number) => pixels[index] } as never,
    createFlowClient: () => ({
      prefetchFlow: async ({ previousImageId, nextImageId }: { previousImageId: number; nextImageId: number }) => {
        const key = `${previousImageId}-${nextImageId}`;
        active++;
        maxActive = Math.max(maxActive, active);
        log.push(`prefetch:${key}`);
        if (previousImageId < 2) {
          if (log.filter((entry) => entry.startsWith("prefetch:")).length === 2) releaseFirstTwo?.();
          await firstTwo;
        }
        ready.add(key);
        active--;
      },
      generateStripes: async (
        args: Parameters<StfOpticalFlowClient["generateStripes"]>[0],
        onStripe: Parameters<StfOpticalFlowClient["generateStripes"]>[1],
      ) => {
        const key = `${args.previousImageId}-${args.nextImageId}`;
        expect(ready.has(key)).toBe(true);
        log.push(`merge:${key}`);
        await onStripe({ kind: "primary", y: 0, height: 2, pixels: testPixels(23000) });
        return { flowCacheHit: true, flowWorkerCount: 2 } as never;
      },
      warpOpeningAverageStripes: async () => { throw new Error("Unexpected opening extrapolation"); },
      releaseRetained: () => {}, terminate: () => { log.push("terminate"); },
    }) as never,
  });
  expect(maxActive).toBe(2);
  expect(log.filter((entry) => entry.startsWith("merge:"))).toEqual([
    "merge:0-1", "merge:1-2", "merge:2-3",
  ]);
  expect(log.indexOf("prefetch:1-2")).toBeLessThan(log.indexOf("merge:0-1"));
  expect(log.at(-1)).toBe("terminate");
  expect(Array.from(result).every((value) => value > 0)).toBe(true);

});

test("STF rolling prefetch refills the freed slot during Warp, with at most two outstanding pairs", async () => {
  const log: string[] = [];
  const held = new Set<string>();
  let maxHeld = 0;
  let releaseFirstWarp: (() => void) | undefined;
  let firstWarpStarted: (() => void) | undefined;
  const warpGate = new Promise<void>((resolve) => { releaseFirstWarp = resolve; });
  const warpEntered = new Promise<void>((resolve) => { firstWarpStarted = resolve; });
  const frameSet = {
    mode: "interpolation", allFNumbers: [2, 2.25, 2.52, 2.83, 3.17],
    middleFrames: [0, 1, 2, 3].map((i) => ({
      previousIndex: i, nextIndex: i + 1, pairLabel: `${i}-${i + 1}`,
      interpolationFraction: 0.5, weight: 0.1,
    })), outerFrames: [],
    virtualTonePlans: { middle: Array.from({ length: 4 }, () => ({ gain: 1, scaledLog: 0 })), outer: [] },
  };
  const accumulator = new Float32Array(12);
  const running = appendStfVirtualSource(accumulator, {
    frameSet: frameSet as never,
    sessionId: "rolling", sessionCreatedAt: 1700000000000, alignmentKey: "align-1",
    reader: { width: 2, height: 2,
      readGamma2Image: async (index: number) => testPixels(20000 + index * 1000) } as never,
    createFlowClient: () => ({
      prefetchFlow: async ({ previousImageId, nextImageId }: { previousImageId: number; nextImageId: number }) => {
        const pair = `${previousImageId}-${nextImageId}`;
        expect(held.has(pair)).toBe(false);
        held.add(pair);
        maxHeld = Math.max(maxHeld, held.size);
        log.push(`prefetch:${pair}`);
      },
      generateStripes: async (
        args: Parameters<StfOpticalFlowClient["generateStripes"]>[0],
        onStripe: Parameters<StfOpticalFlowClient["generateStripes"]>[1],
        onFlowConsumed?: () => void,
      ) => {
        const pair = `${args.previousImageId}-${args.nextImageId}`;
        expect(held.delete(pair)).toBe(true);
        log.push(`consume:${pair}`);
        onFlowConsumed?.();
        if (args.previousImageId === 0) {
          firstWarpStarted?.();
          await warpGate;
        }
        log.push(`warp:${pair}`);
        await onStripe({ kind: "primary", y: 0, height: 2, pixels: testPixels(23000) });
        return { flowCacheHit: true, flowWorkerCount: 2 } as never;
      },
      warpOpeningAverageStripes: async () => { throw new Error("Unexpected opening extrapolation"); },
      releaseRetained: () => {}, terminate: () => { log.push("terminate"); },
    }) as never,
  });
  try {
    await warpEntered;
    // Allow the serial Canonical read tail and the next prefetch to settle.
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    expect(log).toContain("prefetch:2-3");
    expect(log).not.toContain("warp:0-1");
    expect(held.size).toBe(2);  // Pair 1-2 plus the newly launched 2-3.
  } finally {
    releaseFirstWarp?.();
  }
  await running;
  expect(maxHeld).toBe(2);
  expect(log.filter((entry) => entry.startsWith("warp:"))).toEqual([
    "warp:0-1", "warp:1-2", "warp:2-3", "warp:3-4",
  ]);
  expect(log.at(-1)).toBe("terminate");
  expect(accumulator.every((value) => value > 0 && Number.isFinite(value))).toBe(true);

});
