/** Logical STF frame set. Real indexes always refer to the canonical session. */
import { buildStfApertureWeights } from "./stf-weights";

export type StfFrameGenerationMode = "off" | "interpolation" | "interpolation-extrapolation";
export type StfMiddleFrame = {
  previousIndex: number;
  nextIndex: number;
  fNumber: number;
  weight: number;
  pairLabel: string;
};
export type StfOuterFrame = StfMiddleFrame & { variant: "ext1" | "ext2" };
export type StfFrameSet = {
  mode: StfFrameGenerationMode;
  realWeights: Float32Array;
  middleFrames: StfMiddleFrame[];
  outerFrames: StfOuterFrame[];
  allWeights: Float32Array;
  allFNumbers: number[];
};

export function buildStfFrameSet(
  fNumbers: readonly (number | null | undefined)[],
  blendWeight: number,
  mode: StfFrameGenerationMode,
): StfFrameSet {
  if (mode !== "off" && mode !== "interpolation" && mode !== "interpolation-extrapolation") throw new Error(`Unsupported STF Frame generation: ${mode}`);
  if (mode === "off") {
    const weights = buildStfApertureWeights(fNumbers as number[], blendWeight);
    const fallback = new Float32Array(fNumbers.length).fill(1 / fNumbers.length);
    return { mode, realWeights: weights ? Float32Array.from(weights) : fallback,
      middleFrames: [], outerFrames: [], allWeights: weights ? Float32Array.from(weights) : fallback,
      allFNumbers: fNumbers.map((f) => Number(f)) };
  }
  if (fNumbers.length < 2 || fNumbers.some((f) => !(typeof f === "number" && Number.isFinite(f) && f > 0))) {
    throw new Error("STF Frame generation requires at least two inputs with valid EXIF F-numbers.");
  }
  const sorted = fNumbers.map((fNumber, index) => ({ fNumber: fNumber as number, index }))
    .sort((a, b) => a.fNumber - b.fNumber);
  const middleFrames: StfMiddleFrame[] = [];
  for (let i = 1; i < sorted.length; i++) {
    if (!(sorted[i].fNumber > sorted[i - 1].fNumber)) {
      throw new Error("STF Frame generation requires distinct EXIF F-numbers for every input.");
    }
    middleFrames.push({ previousIndex: sorted[i - 1].index, nextIndex: sorted[i].index,
      fNumber: Math.sqrt(sorted[i - 1].fNumber * sorted[i].fNumber),
      weight: 0, pairLabel: `${i}/${sorted.length - 1}` });
  }
  // Extend one *real* aperture interval in log-F space on each side.
  // The pair orientation is always from smaller to larger F-number:
  // ext1 is extrapolated from the first real image, ext2 from the last.
  const outerFrames: StfOuterFrame[] = mode === "interpolation-extrapolation" ? [
    { previousIndex: sorted[0].index, nextIndex: sorted[1].index,
      fNumber: sorted[0].fNumber ** 2 / sorted[1].fNumber,
      weight: 0, pairLabel: "first-ext1", variant: "ext1" },
    { previousIndex: sorted[sorted.length - 2].index, nextIndex: sorted[sorted.length - 1].index,
      fNumber: sorted[sorted.length - 1].fNumber ** 2 / sorted[sorted.length - 2].fNumber,
      weight: 0, pairLabel: "last-ext2", variant: "ext2" },
  ] : [];
  if (outerFrames.some((frame) => !(Number.isFinite(frame.fNumber) && frame.fNumber > 0))) {
    throw new Error("STF extrapolation produced an invalid extended EXIF F-number.");
  }
  // The middle-frame IDs/weights are still indexed immediately after all real
  // frames; outer contributions follow the middle frames. This leaves all
  // Phase 2 generated midpoint cache keys stable across mode switches.
  const allFNumbers = [...fNumbers as number[],
    ...middleFrames.map((frame) => frame.fNumber), ...outerFrames.map((frame) => frame.fNumber)];
  const calculated = buildStfApertureWeights(allFNumbers, blendWeight);
  if (!calculated) throw new Error("Could not compute STF aperture weights for generated frames.");
  const allWeights = Float32Array.from(calculated);
  const realWeights = allWeights.slice(0, fNumbers.length);
  for (let i = 0; i < middleFrames.length; i++) middleFrames[i].weight = allWeights[fNumbers.length + i];
  for (let i = 0; i < outerFrames.length; i++) outerFrames[i].weight = allWeights[fNumbers.length + middleFrames.length + i];
  return { mode, realWeights, middleFrames, outerFrames, allWeights, allFNumbers };
}

export function stfMiddleFrameCacheKey(sessionId: string, normalizationMode: string,
  matrices: readonly (ArrayLike<number> | null)[], frame: StfMiddleFrame, width: number, height: number): string {
  return JSON.stringify(["stf-optical-flow-mid-4mp-gamma20-range4-v1", sessionId,
    normalizationMode, width, height, frame.previousIndex, frame.nextIndex,
    matrices.map((m) => m == null ? null : Array.from(m))]);
}

/** Pair-specific cache key; separate from mid and stable across W/Blur/mode. */
export function stfOuterFrameCacheKey(sessionId: string, normalizationMode: string,
  matrices: readonly (ArrayLike<number> | null)[], frame: StfOuterFrame, width: number, height: number): string {
  return JSON.stringify([`stf-optical-flow-${frame.variant}-4mp-gamma20-range4-v1`, sessionId,
    normalizationMode, width, height, frame.previousIndex, frame.nextIndex,
    matrices.map((m) => m == null ? null : Array.from(m))]);
}
