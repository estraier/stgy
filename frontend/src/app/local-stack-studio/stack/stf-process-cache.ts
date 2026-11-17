import type { StfFrameSet } from "./stf-frame-generation";

// Version both keys whenever the aligned input, virtual warp or tone algorithm
// changes. These keys describe actual pixel dependencies, not UI controls.
const STF_SOURCE_CACHE_VERSION = "stf-source-v6-outer-shell-ratio-08";

export const STF_SOURCE_CACHE_MAX_BYTES = 256 * 1024 * 1024;

export type StfAlignedCacheInputs = {
  sessionId: string;
  dataRevision?: number;
  width: number;
  height: number;
  alignmentPlan: { normalizationMode: string; targetWidth: number; targetHeight: number };
  matrices: readonly ArrayLike<number>[];
};

export function buildStfAlignmentCacheKey(inputs: StfAlignedCacheInputs): string {
  return JSON.stringify([
    inputs.sessionId,
    inputs.dataRevision ?? 0,
    inputs.width,
    inputs.height,
    inputs.alignmentPlan.normalizationMode,
    inputs.alignmentPlan.targetWidth,
    inputs.alignmentPlan.targetHeight,
    inputs.matrices.map((matrix) => Array.from(matrix)),
  ]);
}

export function buildStfSourceCacheKey(inputs: StfAlignedCacheInputs & {
  gains: ArrayLike<number>;
  scaledLogs: ArrayLike<number>;
  weights: ArrayLike<number>;
  toneReferenceIndex: number;
  frameSet?: StfFrameSet | null;
}): string {
  const frameSet = inputs.frameSet;
  return JSON.stringify([
    STF_SOURCE_CACHE_VERSION,
    buildStfAlignmentCacheKey(inputs),
    Array.from(inputs.gains),
    Array.from(inputs.scaledLogs),
    Array.from(inputs.weights),
    inputs.toneReferenceIndex,
    frameSet ? [
      frameSet.mode,
      frameSet.allFNumbers,
      Array.from(frameSet.allWeights),
      frameSet.middleFrames.map((frame) => [frame.previousIndex, frame.nextIndex, frame.fNumber, frame.weight]),
      frameSet.outerFrames.map((frame) => [frame.previousIndex, frame.nextIndex, frame.fNumber,
        frame.weight, frame.variant, frame.inverseWarpScale]),
    ] : null,
  ]);
}

// One full-resolution source, independent of the much smaller Sobel/Gate cache.
// References are not copied: callers must treat cached buffers as immutable.
export class StfSourceCache {
  private entry: { key: string; pixels: Float32Array } | null = null;

  constructor(private readonly maxBytes = STF_SOURCE_CACHE_MAX_BYTES) {}

  get(key: string, expectedLength: number): Float32Array | null {
    const entry = this.entry;
    return entry?.key === key && entry.pixels.length === expectedLength ? entry.pixels : null;
  }

  put(key: string, pixels: Float32Array): boolean {
    if (!(pixels instanceof Float32Array)) return false;
    if (pixels.byteLength > this.maxBytes) {
      // An oversized new image must not leave an unrelated large Source
      // pinned in RAM while a new merge allocates its work buffers.
      this.clear();
      return false;
    }
    this.entry = { key, pixels };
    return true;
  }

  clear(): void { this.entry = null; }
}

// Final STF highlight rolloff mutates its input. Never expose the retained
// pre-rolloff Source to that in-place operation. For an uncached source the
// existing zero-copy finalization path remains unchanged.
export function prepareStfSourceForFinalRolloff(
  source: Float32Array, retained: Float32Array | null,
): Float32Array {
  return source === retained ? source.slice() : source;
}
