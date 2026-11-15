import { buildStfFrameSet, type StfFrameGenerationMode, type StfFrameSet } from "./stf-frame-generation";
import { buildStfApertureWeights } from "./stf-weights";

const fNumbers = [2.8, 4, 3.5, 3.2, 2.5, 2.2, 2];
const radialAttenuationOptions = [-2, -1, 0, 1, 2, 3];

function radialDiscContributions(frames: StfFrameSet, realFNumbers: number[]) {
  const densityFNumbers = [
    ...realFNumbers,
    ...frames.middleFrames.map((frame) =>
      (realFNumbers[frame.previousIndex] + realFNumbers[frame.nextIndex]) / 2),
    ...frames.outerFrames.map((frame) => realFNumbers[
      frame.variant === "ext2" ? frame.nextIndex : frame.previousIndex]),
  ];
  const ordered = frames.allFNumbers
    .map((fNumber, index) => ({ index, radius: 1 / fNumber, densityF: densityFNumbers[index] }))
    .sort((a, b) => a.radius - b.radius);
  const rawDrops = ordered.map((frame) => frames.allWeights[frame.index] * frame.densityF ** 2);
  const total = rawDrops.reduce((sum, value) => sum + value, 0);
  return {
    ordered,
    drops: rawDrops.map((value) => value / total),
    levels: ordered.map((_, i) => rawDrops.slice(i).reduce((sum, value) => sum + value, 0) / total),
  };
}

function targetRadialLuminance(radius: number, minRadius: number, maxRadius: number, radialAttenuation: number) {
  const power = radialAttenuation;
  return Math.abs(power) < 1e-12
    ? Math.log(maxRadius / radius) / Math.log(maxRadius / minRadius)
    : (maxRadius ** power - radius ** power) / (maxRadius ** power - minRadius ** power);
}

describe("STF generated-frame radial minimax luminance weights", () => {
  test.each(radialAttenuationOptions)("off preserves historical real-only weights for q=%i", (radialAttenuation) => {
    const frames = buildStfFrameSet(fNumbers, radialAttenuation, "off");
    const original = Float32Array.from(buildStfApertureWeights(fNumbers, radialAttenuation)!);
    expect(Array.from(frames.realWeights)).toEqual(Array.from(original));
    expect(Array.from(frames.allWeights)).toEqual(Array.from(original));
    expect(frames.middleFrames).toHaveLength(0);
    expect(frames.outerFrames).toHaveLength(0);
  });

  test.each([null, undefined, 0, -1, NaN, Infinity, -Infinity])(
    "off uniformly weights all real inputs when one EXIF F-number is %s", (missing) => {
      const frames = buildStfFrameSet([2, missing, 4], 1, "off");
      expect(Array.from(frames.realWeights)).toEqual(Array.from(new Float32Array([1 / 3, 1 / 3, 1 / 3])));
      expect(Array.from(frames.allWeights)).toEqual(Array.from(frames.realWeights));
      expect(frames.middleFrames).toHaveLength(0);
      expect(frames.outerFrames).toHaveLength(0);
    },
  );

  test("off retains normal nonuniform weights with complete F-numbers", () => {
    const frames = buildStfFrameSet([2, 2.8, 4], 1, "off");
    expect(Array.from(frames.realWeights)).toEqual(
      Array.from(Float32Array.from(buildStfApertureWeights([2, 2.8, 4], 1)!)));
  });

  test.each(["interpolation", "extrapolation-1", "extrapolation-3", "extrapolation-10"] as const)(
    "%s includes real and synthetic frames, preserving their index mapping", (mode: StfFrameGenerationMode) => {
      const frames = buildStfFrameSet(fNumbers, 1, mode);
      const expectedOuterCount = mode.startsWith("extrapolation-")
        ? Number(mode.slice("extrapolation-".length)) + 1 : 0;
      expect(frames.middleFrames).toHaveLength(fNumbers.length - 1);
      expect(frames.outerFrames).toHaveLength(expectedOuterCount);
      expect(frames.allWeights).toHaveLength(fNumbers.length * 2 - 1 + expectedOuterCount);
      expect(Array.from(frames.allWeights).reduce((sum, value) => sum + value, 0)).toBeCloseTo(1, 6);
      frames.allWeights.forEach((value) => expect(value).toBeGreaterThan(0));
      frames.realWeights.forEach((value, index) => expect(value).toBe(frames.allWeights[index]));
      frames.middleFrames.forEach((frame, i) => {
        expect(frame.weight).toBe(frames.allWeights[fNumbers.length + i]);
        expect(frame.fNumber).toBeCloseTo(
          Math.sqrt(fNumbers[frame.previousIndex] * fNumbers[frame.nextIndex]), 12);
      });
      frames.outerFrames.forEach((frame, i) => {
        expect(frame.weight).toBe(frames.allWeights[fNumbers.length + frames.middleFrames.length + i]);
        expect(frame.inverseWarpScale).toBeGreaterThan(0);
        if (frame.variant !== "ext2") expect(frame.openingFlowScale).toBeGreaterThan(0);
      });
    },
  );

  test.each(["interpolation", "extrapolation-3", "extrapolation-10"] as const)(
    "q=1 has exactly linear target luminance at every annulus midpoint for %s", (mode) => {
      const frames = buildStfFrameSet(fNumbers, 1, mode);
      const { ordered, levels, drops } = radialDiscContributions(frames, fNumbers);
      const minR = ordered[0].radius;
      const maxR = ordered[ordered.length - 1].radius;
      expect(levels[0]).toBeCloseTo(1, 6);
      for (let i = 1; i < ordered.length; i += 1) {
        const midpointRadius = (ordered[i - 1].radius + ordered[i].radius) / 2;
        const expectedLinearLuminance = (maxR - midpointRadius) / (maxR - minR);
        expect(levels[i]).toBeCloseTo(expectedLinearLuminance, 6);
      }
      // The outer discontinuity equals one half of the last linear radial decrement.
      expect(drops[drops.length - 1]).toBeCloseTo(
        (maxR - ordered[ordered.length - 2].radius) / (2 * (maxR - minR)), 6);
    },
  );

  test.each(radialAttenuationOptions)("q=%i follows its normalized target radial luminance profile", (radialAttenuation) => {
    const frames = buildStfFrameSet(fNumbers, radialAttenuation, "extrapolation-10");
    const { ordered, levels } = radialDiscContributions(frames, fNumbers);
    const minR = ordered[0].radius;
    const maxR = ordered[ordered.length - 1].radius;
    expect(levels[0]).toBeCloseTo(1, 6);
    for (let i = 1; i < ordered.length; i += 1) {
      const expected = (
        targetRadialLuminance(ordered[i - 1].radius, minR, maxR, radialAttenuation) +
        targetRadialLuminance(ordered[i].radius, minR, maxR, radialAttenuation)
      ) / 2;
      expect(levels[i]).toBeCloseTo(expected, 6);
    }
  });

  test("q=1 radial drops follow half-neighbor intervals at irregular radii", () => {
    // Three real inputs produce five discs (two midpoint frames); the F values
    // are intentionally not evenly spaced, so test the discrete radial shape.
    const inputs = [2, 2.5, 4];
    const frames = buildStfFrameSet(inputs, 1, "interpolation");
    const { ordered, drops } = radialDiscContributions(frames, inputs);
    const span = ordered[ordered.length - 1].radius - ordered[0].radius;
    expect(drops[0]).toBeCloseTo((ordered[1].radius - ordered[0].radius) / (2 * span), 6);
    expect(drops[drops.length - 1]).toBeCloseTo(
      (ordered[ordered.length - 1].radius - ordered[ordered.length - 2].radius) / (2 * span), 6);
    for (let i = 1; i < ordered.length - 1; i += 1) {
      expect(drops[i]).toBeCloseTo(
        (ordered[i + 1].radius - ordered[i - 1].radius) / (2 * span), 6);
    }
  });

  test("forward radius expansion and inverse sampling use distinct geometrical multipliers", () => {
    const f0 = 2;
    const f1 = 2 * 2 ** (1 / 6);
    const frames = buildStfFrameSet([f0, f1], 1, "extrapolation-10");
    expect(frames.outerFrames).toHaveLength(11);
    for (const outer of frames.outerFrames.filter((frame) => frame.variant !== "ext2")) {
      const radiusExpansion = f0 / outer.fNumber;
      // Radius-domain extrapolation preserves the original output geometry.
      expect(outer.openingFlowScale).toBeCloseTo(
        (radiusExpansion - 1) / (1 - f0 / f1), 12);
      // The Worker samples the source (inverse warp), which must scale by F_ext/F0.
      const inverseSamplingRatio = 1 - outer.inverseWarpScale * (1 - f0 / f1);
      expect(inverseSamplingRatio).toBeCloseTo(1 / radiusExpansion, 12);
      expect(outer.inverseWarpScale).toBeGreaterThan(0);
    }
  });

  test("extrapolation 10 retains the previously specified virtual F-numbers and scales", () => {
    const inputs = Array.from({ length: 7 }, (_, i) => 2 * 2 ** (i / 6));
    const frames = buildStfFrameSet(inputs, 1, "extrapolation-10");
    const ext10 = frames.outerFrames[9];
    expect(ext10.variant).toBe("ext1-10");
    if (ext10.variant === "ext2") throw new Error("Opening variant index is wrong");
    expect(ext10.fNumber).toBeCloseTo(2 * 2 ** (-10 / 12), 12);
    expect(ext10.openingFlowScale).toBeCloseTo(
      ((1 / ext10.fNumber) - (1 / inputs[0])) / ((1 / inputs[0]) - (1 / inputs[1])), 12);
    const closing = frames.outerFrames[10];
    expect(closing.variant).toBe("ext2");
    expect(closing.fNumber).toBeCloseTo(inputs[6] * Math.sqrt(inputs[6] / inputs[5]), 12);
    expect(closing.inverseWarpScale).toBeCloseTo(
      (closing.fNumber / inputs[6] - 1) / (inputs[6] / inputs[5] - 1), 12);
    expect(frames.allWeights).toHaveLength(24);
  });

  test.each([1, 2, 3, 10])("extrapolation %i includes exactly one closing-side half-step", (count) => {
    const f = [4, 2.8, 2, 3.56, 2.24]; // unsorted real source order
    const mode = `extrapolation-${count}` as StfFrameGenerationMode;
    const frames = buildStfFrameSet(f, 1, mode);
    const closing = frames.outerFrames.filter((frame) => frame.variant === "ext2");
    expect(closing).toHaveLength(1);
    expect(frames.outerFrames).toHaveLength(count + 1);
    expect(closing[0].previousIndex).toBe(3);
    expect(closing[0].nextIndex).toBe(0);
    expect(closing[0].fNumber).toBeCloseTo(4 * Math.sqrt(4 / 3.56), 12);
    expect(closing[0].inverseWarpScale).toBeCloseTo(
      (closing[0].fNumber / 4 - 1) / (4 / 3.56 - 1), 12);
    const { levels } = radialDiscContributions(frames, f);
    expect(levels[0]).toBeCloseTo(1, 6);
    expect(frames.allWeights.length).toBe(f.length * 2 + count);
  });

  test("closing-side generated disc uses last-real density, not its virtual F-number", () => {
    const f = [2, 2.245, 2.52, 2.828, 3.175, 3.564, 4];
    const frames = buildStfFrameSet(f, 1, "extrapolation-1");
    const closing = frames.outerFrames.find((frame) => frame.variant === "ext2");
    if (!closing) throw new Error("Missing closing frame");
    const { ordered, drops } = radialDiscContributions(frames, f);
    expect(ordered[0].index).toBe(frames.allWeights.length - 1);
    const targetDrop = (ordered[1].radius - ordered[0].radius) /
      (2 * (ordered[ordered.length - 1].radius - ordered[0].radius));
    expect(drops[0]).toBeCloseTo(targetDrop, 6);
    // If source density were computed from the hypothetical closing F, the
    // recovered radial profile above would be wrong.
    expect(closing.fNumber).toBeGreaterThan(4);
  });

  test("two real frames share the sole pair for opening and closing extra warps", () => {
    const frames = buildStfFrameSet([2, 4], 1, "extrapolation-10");
    expect(frames.middleFrames).toHaveLength(1);
    expect(frames.outerFrames).toHaveLength(11);
    expect(frames.outerFrames.every((frame) => frame.previousIndex === 0 && frame.nextIndex === 1)).toBe(true);
    expect(frames.outerFrames.at(-1)?.variant).toBe("ext2");
  });

  test("invalid or duplicate apertures and unsupported q are rejected", () => {
    expect(() => buildStfFrameSet([2, 2, 4], 0, "extrapolation-10")).toThrow("distinct");
    expect(() => buildStfFrameSet([2, null, 4], 0, "extrapolation-10")).toThrow("valid EXIF");
    expect(() => buildStfFrameSet([2, 4], -3, "extrapolation-10")).toThrow("Radial attenuation");
    expect(() => buildStfFrameSet([2, 4], Number.NaN, "interpolation")).toThrow("Radial attenuation");
  });
});
