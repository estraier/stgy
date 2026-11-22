import { buildStfFrameSet, isStfFrameGenerationMode, STF_EXTRAPOLATION_COUNTS, STF_INTERPOLATION_COUNTS, type StfFrameGenerationMode, type StfFrameSet } from "./stf-frame-generation";
import type { StfRadialAttenuation } from "./stf-radial-weights";

const fNumbers = [2.8, 4, 3.5, 3.2, 2.5, 2.2, 2];
const radialAttenuationOptions = [-2, -1, 0, 1, 2, 3,
  "smoothstep-weak", "smoothstep-medium", "smoothstep-strong"] as const;

function radialDiscContributions(frames: StfFrameSet, realFNumbers: number[]) {
  const densityFNumbers = [
    ...realFNumbers,
    ...frames.middleFrames.map((frame) =>
      (1 - frame.interpolationFraction) * realFNumbers[frame.previousIndex] +
      frame.interpolationFraction * realFNumbers[frame.nextIndex]),
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

function targetRadialLuminance(
  radius: number, minRadius: number, zeroRadius: number,
  radialAttenuation: typeof radialAttenuationOptions[number],
): number {
  if (radius <= minRadius) return 1;
  if (radius >= zeroRadius) return 0;
  if (typeof radialAttenuation === "number") {
    if (radialAttenuation === 0) return Math.log(zeroRadius / radius) / Math.log(zeroRadius / minRadius);
    return (zeroRadius ** radialAttenuation - radius ** radialAttenuation) /
      (zeroRadius ** radialAttenuation - minRadius ** radialAttenuation);
  }
  const t = (zeroRadius - radius) / (zeroRadius - minRadius);
  if (radialAttenuation === "smoothstep-weak") return t * t * (3 - 2 * t);
  if (radialAttenuation === "smoothstep-medium") return t ** 3 * (10 - 15 * t + 6 * t * t);
  return t ** 4 * (35 - 84 * t + 70 * t * t - 20 * t ** 3);
}

function expectedVirtualZeroOuterStep(attenuation: typeof radialAttenuationOptions[number]) {
  if (typeof attenuation !== "number") return 0.8;
  return attenuation <= 0 ? 0.8 : 0.8 - 0.1 * attenuation;
}

function expectedDrops(
  ordered: ReturnType<typeof radialDiscContributions>["ordered"],
  attenuation: typeof radialAttenuationOptions[number],
): number[] {
  const minR = ordered[0].radius;
  const maxR = ordered[ordered.length - 1].radius;
  const zeroR = maxR * (maxR / minR) ** (expectedVirtualZeroOuterStep(attenuation) / (ordered.length - 1));
  const target = ordered.map((frame) => targetRadialLuminance(frame.radius, minR, zeroR, attenuation));
  return target.map((level, i) => level - (i + 1 < target.length ? target[i + 1] : 0));
}

describe("STF generated-frame radial attenuation and q-dependent virtual zero", () => {
  test.each(radialAttenuationOptions)("off follows the new radial profile for %s", (radialAttenuation) => {
    const frames = buildStfFrameSet(fNumbers, radialAttenuation, "off");
    expect(frames.middleFrames).toHaveLength(0);
    expect(frames.outerFrames).toHaveLength(0);
    expect(frames.allWeights).toHaveLength(fNumbers.length);
    expect(Array.from(frames.allWeights).reduce((sum, value) => sum + value, 0)).toBeCloseTo(1, 6);
    const { ordered, drops, levels } = radialDiscContributions(frames, fNumbers);
    const expected = expectedDrops(ordered, radialAttenuation);
    for (let i = 0; i < expected.length; i++) {
      expect(drops[i]).toBeCloseTo(expected[i], 6);
      expect(levels[i]).toBeCloseTo(expected.slice(i).reduce((a, b) => a + b, 0), 6);
    }
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

  test("Interpolation 1 is the prior midpoint and 2-4 add equally spaced log-F frames per real pair", () => {
    expect(STF_INTERPOLATION_COUNTS).toEqual([1, 2, 3, 4]);
    const real = Array.from({ length: 7 }, (_, i) => 2 * 2 ** (i / 3)); // F2-F8, 2/3 stop intervals.
    const legacy = buildStfFrameSet(real, 1, "interpolation");
    const one = buildStfFrameSet(real, 1, "interpolation-1");
    expect(one.allFNumbers).toEqual(legacy.allFNumbers);
    expect(Array.from(one.allWeights)).toEqual(Array.from(legacy.allWeights));
    for (const count of STF_INTERPOLATION_COUNTS) {
      const mode = `interpolation-${count}` as StfFrameGenerationMode;
      expect(isStfFrameGenerationMode(mode)).toBe(true);
      const frames = buildStfFrameSet(real, 1, mode);
      expect(frames.middleFrames).toHaveLength(6 * count);
      expect(frames.allWeights).toHaveLength(7 + 6 * count);
      expect(frames.outerFrames).toHaveLength(0);
      for (let pair = 0; pair < 6; pair++) {
        for (let k = 1; k <= count; k++) {
          const frame = frames.middleFrames[pair * count + k - 1];
          const t = k / (count + 1);
          expect(frame.previousIndex).toBe(pair);
          expect(frame.nextIndex).toBe(pair + 1);
          expect(frame.interpolationFraction).toBeCloseTo(t, 12);
          expect(frame.fNumber).toBeCloseTo(real[pair] * (real[pair + 1] / real[pair]) ** t, 12);
        }
      }
      const { ordered, drops } = radialDiscContributions(frames, real);
      const expected = expectedDrops(ordered, 1);
      drops.forEach((drop, i) => expect(drop).toBeCloseTo(expected[i], 6));
    }
    for (const invalid of ["interpolation-0", "interpolation-5", "interpolation-01", "interpolation-2.5"]) {
      expect(isStfFrameGenerationMode(invalid)).toBe(false);
      expect(() => buildStfFrameSet(real, 1, invalid as StfFrameGenerationMode)).toThrow("Unsupported");
    }
  });

  test("extrapolation remains based on Interpolation 1 for every opening count", () => {
    const f = [2, 2.52, 3.175, 4];
    for (const count of STF_EXTRAPOLATION_COUNTS) {
      const frames = buildStfFrameSet(f, 1, `extrapolation-${count}`);
      expect(frames.middleFrames).toHaveLength(f.length - 1);
      frames.middleFrames.forEach((frame) => expect(frame.interpolationFraction).toBe(0.5));
      expect(frames.outerFrames).toHaveLength(count + 1);
    }
  });

  test("off uses nonuniform radial-profile weights when complete F-numbers are available", () => {
    const frames = buildStfFrameSet([2, 2.8, 4], 1, "off");
    expect(Array.from(frames.realWeights)).not.toEqual([1 / 3, 1 / 3, 1 / 3]);
    expect(Array.from(frames.allWeights)).toEqual(Array.from(frames.realWeights));
  });

  test("off falls back to uniform weights when duplicate real F-numbers remain", () => {
    const frames = buildStfFrameSet([2, 2, 4], 1, "off");
    expect(Array.from(frames.realWeights)).toEqual(Array.from(new Float32Array([1 / 3, 1 / 3, 1 / 3])));
    expect(frames.middleFrames).toHaveLength(0);
    expect(frames.outerFrames).toHaveLength(0);
  });

  test("off assigns full weight to a single valid real image", () => {
    const frames = buildStfFrameSet([2.8], 1, "off");
    expect(Array.from(frames.realWeights)).toEqual([1]);
    expect(frames.allFNumbers).toEqual([2.8]);
  });

  test.each(["interpolation", "extrapolation-1", "extrapolation-2", "extrapolation-3", "extrapolation-4", "extrapolation-5", "extrapolation-6", "extrapolation-9", "extrapolation-12"] as const)(
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

  test.each(["interpolation", "extrapolation-4", "extrapolation-12"] as const)(
    "linear profile follows the virtual zero boundary for %s", (mode) => {
      const frames = buildStfFrameSet(fNumbers, 1, mode);
      const { ordered, drops } = radialDiscContributions(frames, fNumbers);
      const expected = expectedDrops(ordered, 1);
      expected.forEach((drop, i) => expect(drops[i]).toBeCloseTo(drop, 6));
    },
  );

  test.each(radialAttenuationOptions)("%s follows its profile with extrapolation 12", (radialAttenuation) => {
    const frames = buildStfFrameSet(fNumbers, radialAttenuation, "extrapolation-12");
    const { ordered, drops } = radialDiscContributions(frames, fNumbers);
    const expected = expectedDrops(ordered, radialAttenuation);
    expected.forEach((drop, i) => expect(drops[i]).toBeCloseTo(drop, 6));
  });

  test("irregular F spacing uses actual radius intervals, with no pair-local ratio assumption", () => {
    const inputs = [2, 2.02, 2.1, 2.2, 2.4, 3.4, 4];
    const frames = buildStfFrameSet(inputs, 1, "off");
    const { ordered, drops } = radialDiscContributions(frames, inputs);
    const expected = expectedDrops(ordered, 1);
    expected.forEach((drop, i) => expect(drops[i]).toBeCloseTo(drop, 6));
    const minR = ordered[0].radius;
    const maxR = ordered[ordered.length - 1].radius;
    const zeroR = maxR * (maxR / minR) ** (expectedVirtualZeroOuterStep(1) / (ordered.length - 1));
    const idealOuter = targetRadialLuminance(maxR, minR, zeroR, 1);
    expect(drops[drops.length - 1]).toBeCloseTo(idealOuter, 6);
  });

  test("forward radius expansion and inverse sampling use distinct geometrical multipliers", () => {
    const f0 = 2;
    const f1 = 2 * 2 ** (1 / 6);
    const frames = buildStfFrameSet([f0, f1], 1, "extrapolation-12");
    expect(frames.outerFrames).toHaveLength(13);
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

  test("extrapolation 12 retains ext9 geometry and finishes with ext12", () => {
    const inputs = Array.from({ length: 7 }, (_, i) => 2 * 2 ** (i / 6));
    const frames = buildStfFrameSet(inputs, 1, "extrapolation-12");
    const ext9 = frames.outerFrames[8];
    expect(ext9.variant).toBe("ext1-9");
    if (ext9.variant === "ext2") throw new Error("Opening variant index is wrong");
    expect(ext9.fNumber).toBeCloseTo(2 * 2 ** (-9 / 12), 12);
    expect(ext9.openingFlowScale).toBeCloseTo(
      ((1 / ext9.fNumber) - (1 / inputs[0])) / ((1 / inputs[0]) - (1 / inputs[1])), 12);
    const ext12 = frames.outerFrames[11];
    expect(ext12.variant).toBe("ext1-12");
    expect(ext12.fNumber).toBeCloseTo(2 * 2 ** (-12 / 12), 12);
    expect(ext12.inverseWarpScale).toBeCloseTo(
      (1 - ext12.fNumber / inputs[0]) / (1 - inputs[0] / inputs[1]), 12);
    const closing = frames.outerFrames[12];
    expect(closing.variant).toBe("ext2");
    expect(closing.fNumber).toBeCloseTo(inputs[6] * Math.sqrt(inputs[6] / inputs[5]), 12);
    expect(closing.inverseWarpScale).toBeCloseTo(
      (closing.fNumber / inputs[6] - 1) / (inputs[6] / inputs[5] - 1), 12);
    expect(frames.allWeights).toHaveLength(26);
  });

  test.each(STF_EXTRAPOLATION_COUNTS)("extrapolation %i includes exactly one closing-side half-step", (count) => {
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
    const targetDrop = expectedDrops(ordered, 1)[0];
    expect(drops[0]).toBeCloseTo(targetDrop, 6);
    // If source density were computed from the hypothetical closing F, the
    // recovered radial profile above would be wrong.
    expect(closing.fNumber).toBeGreaterThan(4);
  });

  test("two real frames share the sole pair for opening and closing extra warps", () => {
    const frames = buildStfFrameSet([2, 4], 1, "extrapolation-12");
    expect(frames.middleFrames).toHaveLength(1);
    expect(frames.outerFrames).toHaveLength(13);
    expect(frames.outerFrames.every((frame) => frame.previousIndex === 0 && frame.nextIndex === 1)).toBe(true);
    expect(frames.outerFrames.at(-1)?.variant).toBe("ext2");
  });

  test("only the eight published extrapolation modes are supported", () => {
    expect(STF_EXTRAPOLATION_COUNTS).toEqual([1, 2, 3, 4, 5, 6, 9, 12]);
    for (const count of STF_EXTRAPOLATION_COUNTS) {
      expect(isStfFrameGenerationMode(`extrapolation-${count}`)).toBe(true);
    }
    for (const invalid of ["extrapolation-0", "extrapolation-7", "extrapolation-8", "extrapolation-10",
      "extrapolation-11", "extrapolation-13", "extrapolation-16", "extrapolation-32",
      "extrapolation-33", "extrapolation-64", "extrapolation-01"]) {
      expect(isStfFrameGenerationMode(invalid)).toBe(false);
      expect(() => buildStfFrameSet([2, 4], 1, invalid as StfFrameGenerationMode)).toThrow("Unsupported STF Frame generation");
    }
  });

  test("discarded experimental Flow mode names are no longer accepted", () => {
    for (const name of ["consensus-flow-1", "consensus-flow-32", "average-flow-1", "average-flow-32"]) {
      expect(isStfFrameGenerationMode(name)).toBe(false);
      expect(() => buildStfFrameSet([2, 3, 4], 1, name as StfFrameGenerationMode))
        .toThrow("Unsupported STF Frame generation");
    }
  });

  test.each(radialAttenuationOptions)("12 opening frames produce finite positive weights for %s", (q) => {
    const inputs = Array.from({ length: 7 }, (_, i) => 2 * 2 ** (i / 6));
    const frames = buildStfFrameSet(inputs, q, "extrapolation-12");
    expect(frames.allWeights).toHaveLength(26);
    expect(frames.outerFrames.at(-2)?.variant).toBe("ext1-12");
    expect(frames.outerFrames.at(-1)?.variant).toBe("ext2");
    expect(Array.from(frames.allWeights).every((w) => Number.isFinite(w) && w > 0)).toBe(true);
    expect(Array.from(frames.allWeights).reduce((a, b) => a + b, 0)).toBeCloseTo(1, 6);
  });

  test("invalid or duplicate apertures and unsupported q are rejected", () => {
    expect(() => buildStfFrameSet([2, 2, 4], 0, "extrapolation-12")).toThrow("distinct");
    expect(() => buildStfFrameSet([2, null, 4], 0, "extrapolation-12")).toThrow("valid EXIF");
    expect(() => buildStfFrameSet([2, 4], -3 as StfRadialAttenuation, "extrapolation-12")).toThrow("Radial attenuation");
    expect(() => buildStfFrameSet([2, 4], Number.NaN as StfRadialAttenuation, "interpolation")).toThrow("Radial attenuation");
  });
});

