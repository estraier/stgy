import { buildStfFrameSet, isStfFrameGenerationMode, STF_EXTRAPOLATION_COUNTS, type StfFrameGenerationMode, type StfFrameSet } from "./stf-frame-generation";

const fNumbers = [2.8, 4, 3.5, 3.2, 2.5, 2.2, 2];
const radialAttenuationOptions = [-2, -1, 0, 1, 2, 3,
  "smoothstep-weak", "smoothstep-medium", "smoothstep-strong"] as const;

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

function expectedDrops(
  ordered: ReturnType<typeof radialDiscContributions>["ordered"],
  attenuation: typeof radialAttenuationOptions[number],
): number[] {
  const minR = ordered[0].radius;
  const maxR = ordered[ordered.length - 1].radius;
  const zeroR = maxR * (maxR / minR) ** (1 / (ordered.length - 1));
  const target = ordered.map((frame) => targetRadialLuminance(frame.radius, minR, zeroR, attenuation));
  const drops = target.map((level, i) => level - (i + 1 < target.length ? target[i + 1] : 0));
  const last = drops.length - 1;
  if (drops[last] > drops[last - 1] + 1e-12) {
    drops[last] = drops[last - 1] = (drops[last] + drops[last - 1]) / 2;
  }
  return drops;
}

describe("STF generated-frame radial attenuation and outer-shell apodization", () => {
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

  test.each(["interpolation", "extrapolation-1", "extrapolation-2", "extrapolation-4", "extrapolation-8", "extrapolation-16", "extrapolation-32"] as const)(
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

  test.each(["interpolation", "extrapolation-4", "extrapolation-32"] as const)(
    "linear profile follows the virtual zero boundary for %s", (mode) => {
      const frames = buildStfFrameSet(fNumbers, 1, mode);
      const { ordered, drops } = radialDiscContributions(frames, fNumbers);
      const expected = expectedDrops(ordered, 1);
      expected.forEach((drop, i) => expect(drops[i]).toBeCloseTo(drop, 6));
    },
  );

  test.each(radialAttenuationOptions)("%s follows its profile with extrapolation 32", (radialAttenuation) => {
    const frames = buildStfFrameSet(fNumbers, radialAttenuation, "extrapolation-32");
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
    expect(drops[drops.length - 1]).toBeCloseTo(drops[drops.length - 2], 6);
  });

  test("forward radius expansion and inverse sampling use distinct geometrical multipliers", () => {
    const f0 = 2;
    const f1 = 2 * 2 ** (1 / 6);
    const frames = buildStfFrameSet([f0, f1], 1, "extrapolation-32");
    expect(frames.outerFrames).toHaveLength(33);
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

  test("extrapolation 32 retains the prior ext10 geometry and adds ext32", () => {
    const inputs = Array.from({ length: 7 }, (_, i) => 2 * 2 ** (i / 6));
    const frames = buildStfFrameSet(inputs, 1, "extrapolation-32");
    const ext10 = frames.outerFrames[9];
    expect(ext10.variant).toBe("ext1-10");
    if (ext10.variant === "ext2") throw new Error("Opening variant index is wrong");
    expect(ext10.fNumber).toBeCloseTo(2 * 2 ** (-10 / 12), 12);
    expect(ext10.openingFlowScale).toBeCloseTo(
      ((1 / ext10.fNumber) - (1 / inputs[0])) / ((1 / inputs[0]) - (1 / inputs[1])), 12);
    const ext32 = frames.outerFrames[31];
    expect(ext32.variant).toBe("ext1-32");
    expect(ext32.fNumber).toBeCloseTo(2 * 2 ** (-32 / 12), 12);
    expect(ext32.inverseWarpScale).toBeCloseTo(
      (1 - ext32.fNumber / inputs[0]) / (1 - inputs[0] / inputs[1]), 12);
    const closing = frames.outerFrames[32];
    expect(closing.variant).toBe("ext2");
    expect(closing.fNumber).toBeCloseTo(inputs[6] * Math.sqrt(inputs[6] / inputs[5]), 12);
    expect(closing.inverseWarpScale).toBeCloseTo(
      (closing.fNumber / inputs[6] - 1) / (inputs[6] / inputs[5] - 1), 12);
    expect(frames.allWeights).toHaveLength(46);
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
    const frames = buildStfFrameSet([2, 4], 1, "extrapolation-32");
    expect(frames.middleFrames).toHaveLength(1);
    expect(frames.outerFrames).toHaveLength(33);
    expect(frames.outerFrames.every((frame) => frame.previousIndex === 0 && frame.nextIndex === 1)).toBe(true);
    expect(frames.outerFrames.at(-1)?.variant).toBe("ext2");
  });

  test("only the six published extrapolation modes are supported", () => {
    expect(STF_EXTRAPOLATION_COUNTS).toEqual([1, 2, 4, 8, 16, 32]);
    for (const count of STF_EXTRAPOLATION_COUNTS) {
      expect(isStfFrameGenerationMode(`extrapolation-${count}`)).toBe(true);
    }
    for (const invalid of ["extrapolation-0", "extrapolation-3", "extrapolation-5", "extrapolation-10",
      "extrapolation-12", "extrapolation-33", "extrapolation-64", "extrapolation-01"]) {
      expect(isStfFrameGenerationMode(invalid)).toBe(false);
      expect(() => buildStfFrameSet([2, 4], 1, invalid as StfFrameGenerationMode)).toThrow("Unsupported STF Frame generation");
    }
  });

  test.each(radialAttenuationOptions)("32 opening frames produce finite positive weights for %s", (q) => {
    const inputs = Array.from({ length: 7 }, (_, i) => 2 * 2 ** (i / 6));
    const frames = buildStfFrameSet(inputs, q, "extrapolation-32");
    expect(frames.allWeights).toHaveLength(46);
    expect(frames.outerFrames.at(-2)?.variant).toBe("ext1-32");
    expect(frames.outerFrames.at(-1)?.variant).toBe("ext2");
    expect(Array.from(frames.allWeights).every((w) => Number.isFinite(w) && w > 0)).toBe(true);
    expect(Array.from(frames.allWeights).reduce((a, b) => a + b, 0)).toBeCloseTo(1, 6);
  });

  test("invalid or duplicate apertures and unsupported q are rejected", () => {
    expect(() => buildStfFrameSet([2, 2, 4], 0, "extrapolation-32")).toThrow("distinct");
    expect(() => buildStfFrameSet([2, null, 4], 0, "extrapolation-32")).toThrow("valid EXIF");
    expect(() => buildStfFrameSet([2, 4], -3, "extrapolation-32")).toThrow("Radial attenuation");
    expect(() => buildStfFrameSet([2, 4], Number.NaN, "interpolation")).toThrow("Radial attenuation");
  });
});
