import { buildStfFrameSet } from "./stf-frame-generation";
import { prepareStfFrameSetForTone, interpolateStfTonePlan, createStfSourceTonePlans } from "./stf-frame-density";
import { calculateStfWeights } from "./stf-radial-weights";
import { transformStfToneIntensity } from "./stf-tone-match";

const realF = [2, 2 * 2 ** (1 / 6), 2 * 2 ** (2 / 6), 2 * 2 ** (3 / 6),
  2 * 2 ** (4 / 6), 2 * 2 ** (5 / 6), 4];
const identity = realF.map(() => ({ gain: 1, scaledLog: 0 }));

function actualDrops(fNumbers: readonly number[], densities: readonly number[], weights: Float32Array) {
  const combined = fNumbers.map((radiusF, i) => ({ radius: 1 / radiusF, intensity: densities[i] * weights[i] }))
    .sort((a, b) => a.radius - b.radius);
  const total = combined.reduce((sum, item) => sum + item.intensity, 0);
  return combined.map((item) => item.intensity / total);
}

describe("STF MergePlan typed-array tone conversion regression", () => {
  test("converts Float32Array gain and log data to ordinary plan objects", () => {
    // MergePlan uses Float32Array for gains and scaledLogs. TypedArray.map()
    // would return NaNs rather than the requested objects.
    const gains = new Float32Array([1, 1.25, 0.75]);
    const scaledLogs = new Float32Array([0, -0.5, 0.25]);
    const plans = createStfSourceTonePlans(gains, scaledLogs);
    expect(Array.isArray(plans)).toBe(true);
    expect(plans).toEqual([
      { gain: 1, scaledLog: 0 },
      { gain: 1.25, scaledLog: -0.5 },
      { gain: 0.75, scaledLog: 0.25 },
    ]);
    expect(interpolateStfTonePlan(plans[0], plans[1]).gain).toBeGreaterThan(0);
  });

  test("passes converted typed-array tone plans through real and virtual weighting", () => {
    const f = [2, 2.5, 4];
    const plans = createStfSourceTonePlans(
      new Float32Array([1, 1.2, 0.8]), new Float32Array([0, -0.5, 0.25]));
    const prepared = prepareStfFrameSetForTone(
      buildStfFrameSet(f, 1, "extrapolation-4"), f, plans, 0.8, 1);
    expect(prepared.middleFrames).toHaveLength(2);
    expect(prepared.outerFrames).toHaveLength(5);
    expect(prepared.edgeDensities).toHaveLength(10);
    expect(Array.from(prepared.allWeights).reduce((sum, weight) => sum + weight, 0)).toBeCloseTo(1, 6);
  });

  test("does not hide mismatched or nonfinite tone plan values", () => {
    expect(() => createStfSourceTonePlans(new Float32Array([1]), new Float32Array([0, 0])))
      .toThrow("lengths do not match");
    expect(() => createStfSourceTonePlans(new Float32Array([1, 0]), new Float32Array([0, 0])))
      .toThrow("finite positive gain");
    expect(() => createStfSourceTonePlans(new Float32Array([1]), new Float32Array([NaN])))
      .toThrow("finite scaledLog");
  });
});

describe("STF independent edge-density preparation", () => {
  test.each(["off", "interpolation", "extrapolation-1", "extrapolation-4", "extrapolation-32"] as const)(
    "%s propagates gamma2 midpoint and source-preserving extrapolation densities", (mode) => {
      const frames = buildStfFrameSet(realF, 1, mode);
      const prepared = prepareStfFrameSetForTone(frames, realF, identity, 0.8, 1);
      const scale = 0.8 / (4 * 4);
      realF.forEach((f, i) => expect(prepared.edgeDensities[i]).toBeCloseTo(scale * f * f, 12));
      prepared.middleFrames.forEach((frame, i) => {
        const d = ((Math.sqrt(scale * realF[frame.previousIndex] ** 2) +
          Math.sqrt(scale * realF[frame.nextIndex] ** 2)) / 2) ** 2;
        expect(prepared.edgeDensities[realF.length + i]).toBeCloseTo(d, 12);
      });
      prepared.outerFrames.forEach((frame, i) => {
        const source = frame.variant === "ext2" ? frame.nextIndex : frame.previousIndex;
        expect(prepared.edgeDensities[realF.length + prepared.middleFrames.length + i])
          .toBeCloseTo(prepared.edgeDensities[source], 12);
      });
      const drops = actualDrops(prepared.allFNumbers, prepared.edgeDensities, prepared.allWeights);
      const total = drops.reduce((sum, drop) => sum + drop, 0);
      expect(total).toBeCloseTo(1, 10);
      expect(Array.from(prepared.allWeights).reduce((sum, weight) => sum + weight, 0)).toBeCloseTo(1, 6);
    },
  );

  test("real-source tone plan is inherited exactly by opening and closing extrapolations", () => {
    const plans = realF.map((_, i) => ({ gain: 1 + i * 0.12, scaledLog: (i - 3) * 0.05 }));
    const prepared = prepareStfFrameSetForTone(
      buildStfFrameSet(realF, 1, "extrapolation-32"), realF, plans, 0.8, 1);
    for (const [i, frame] of prepared.outerFrames.entries()) {
      const parent = frame.variant === "ext2" ? frame.nextIndex : frame.previousIndex;
      expect(prepared.virtualTonePlans.outer[i]).toEqual(plans[parent]);
      expect(prepared.edgeDensities[realF.length + prepared.middleFrames.length + i])
        .toBeCloseTo(prepared.edgeDensities[parent], 12);
    }
  });

  test("midpoint tone plan and density use the same gamma2 mixing and nonlinear tone function", () => {
    const plans = [{ gain: 0.8, scaledLog: -0.7 }, { gain: 1.6, scaledLog: 1.2 }];
    const f = [2, 4];
    const prepared = prepareStfFrameSetForTone(buildStfFrameSet(f, 1, "interpolation"), f, plans, 0.8, 1);
    const midTone = interpolateStfTonePlan(plans[0], plans[1]);
    expect(prepared.virtualTonePlans.middle[0]).toEqual(midTone);
    const d0 = 0.8 * 4 / 16;
    const d1 = 0.8;
    const expectedMid = transformStfToneIntensity(((Math.sqrt(d0) + Math.sqrt(d1)) / 2) ** 2,
      midTone.gain, midTone.scaledLog);
    expect(prepared.edgeDensities[2]).toBeCloseTo(expectedMid, 12);
    expect(prepared.edgeDensities[0]).toBeCloseTo(transformStfToneIntensity(d0, plans[0].gain, plans[0].scaledLog), 12);
    expect(prepared.edgeDensities[1]).toBeCloseTo(transformStfToneIntensity(d1, plans[1].gain, plans[1].scaledLog), 12);
  });

  test("density changes alter weights but not the normalized q-defined radial profile", () => {
    const f = [2, 2.5, 4];
    const frames = buildStfFrameSet(f, 1, "extrapolation-32");
    const base = prepareStfFrameSetForTone(frames, f, [{ gain: 1, scaledLog: 0 },
      { gain: 1, scaledLog: 0 }, { gain: 1, scaledLog: 0 }], 0.8, 1);
    const altered = prepareStfFrameSetForTone(frames, f, [{ gain: 2, scaledLog: 0 },
      { gain: 1, scaledLog: 0 }, { gain: 1, scaledLog: 0 }], 0.8, 1);
    expect(Array.from(base.allWeights)).not.toEqual(Array.from(altered.allWeights));
    const first = actualDrops(base.allFNumbers, base.edgeDensities, base.allWeights);
    const second = actualDrops(altered.allFNumbers, altered.edgeDensities, altered.allWeights);
    first.forEach((drop, i) => expect(second[i]).toBeCloseTo(drop, 6));
  });

  test("off with missing F preserves uniform weights without fabricating a density", () => {
    const f = [2, null, 4];
    const prepared = prepareStfFrameSetForTone(buildStfFrameSet(f, 1, "off"), f,
      [{ gain: 1, scaledLog: 0 }, { gain: 1, scaledLog: 0 }, { gain: 1, scaledLog: 0 }], 0.8, 1);
    expect(Array.from(prepared.allWeights)).toEqual(Array.from(new Float32Array([1 / 3, 1 / 3, 1 / 3])));
    expect(prepared.edgeDensities).toHaveLength(0);
  });
  test("invalid physical density is an error, not a hidden fallback", () => {
    expect(() => calculateStfWeights([{ image: 0, radiusFNumber: 2, edgeDensity: 1 },
      { image: 1, radiusFNumber: 4, edgeDensity: 0 }], 1)).toThrow("edge density");
  });
  test("stage 2 minimizes q=3 maximum error after the radius-and-density prior", () => {
    const f = [2, 2.5, 4, 5.6];
    const plan = calculateStfWeights(f.map((radiusFNumber, image) => ({
      image, radiusFNumber, edgeDensity: 1 + image * 0.2,
    })), 3);
    expect(plan.minimaxMaximumError).toBeLessThanOrEqual(plan.priorMaximumError);
    expect(plan.rawWeights.every((value) => Number.isFinite(value) && value > 0)).toBe(true);
  });
});

test.each([-2, -1, 0, 1, 2, 3])(
  "neutral tone matching preserves all pre-existing ideal-disc frame weights at q=%i", (q) => {
    for (const mode of ["off", "interpolation", "extrapolation-1", "extrapolation-4", "extrapolation-32"] as const) {
      const original = buildStfFrameSet(realF, q, mode);
      const prepared = prepareStfFrameSetForTone(original, realF, identity, 0.6, q);
      expect(prepared.allWeights).toHaveLength(original.allWeights.length);
      prepared.allWeights.forEach((value, i) => expect(value).toBeCloseTo(original.allWeights[i], 6));
    }
  },
);
