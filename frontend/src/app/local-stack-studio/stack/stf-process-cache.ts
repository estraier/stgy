import type { StfFrameSet } from "./stf-frame-generation";
import type { OpticalFlowVariant } from "../workers/protocols/optical-flow-protocol";

// Version both keys whenever the aligned input, virtual warp or tone algorithm
// changes. These keys describe actual pixel dependencies, not UI controls.
const STF_SOURCE_CACHE_VERSION = "stf-source-v1";
const STF_VIRTUAL_CACHE_VERSION = "stf-virtual-rgb16-v1";

export const STF_SOURCE_CACHE_MAX_BYTES = 256 * 1024 * 1024;
export const STF_VIRTUAL_FRAME_CACHE_MAX_BYTES = 128 * 1024 * 1024;

export type StfAlignedCacheInputs = {
  sessionId: string;
  width: number;
  height: number;
  alignmentPlan: { normalizationMode: string; targetWidth: number; targetHeight: number };
  matrices: readonly ArrayLike<number>[];
};

function alignedInputsKey(inputs: StfAlignedCacheInputs): string {
  return JSON.stringify([
    inputs.sessionId,
    inputs.width,
    inputs.height,
    inputs.alignmentPlan.normalizationMode,
    inputs.alignmentPlan.targetWidth,
    inputs.alignmentPlan.targetHeight,
    inputs.matrices.map((matrix) => Array.from(matrix)),
  ]);
}

export function buildStfVirtualFrameContextKey(inputs: StfAlignedCacheInputs): string {
  // The raw generated RGB16 images depend on alignment, but not q, weights,
  // tone matching or blur. Those changes must not force new Optical Flow.
  return JSON.stringify([STF_VIRTUAL_CACHE_VERSION, alignedInputsKey(inputs)]);
}

export function buildStfVirtualFrameKey(
  contextKey: string,
  previousIndex: number,
  nextIndex: number,
  variant: OpticalFlowVariant,
  variantScale?: number,
): string {
  return JSON.stringify([contextKey, previousIndex, nextIndex, variant, variantScale ?? null]);
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
    alignedInputsKey(inputs),
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
        frame.weight, frame.variant, frame.openingInverseWarpScale]),
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

// The generated-frame LRU is intentionally small: no all-frames RAM retention,
// no IndexedDB write amplification, and no unbounded native/WASM buffers.
// This opportunistically reuses a few costly frames after a q/mode change.
export class StfVirtualFrameCache {
  private readonly entries = new Map<string, Uint16Array>();
  private bytes = 0;

  constructor(private readonly maxBytes = STF_VIRTUAL_FRAME_CACHE_MAX_BYTES) {}

  get(key: string, expectedLength: number): Uint16Array | null {
    const pixels = this.entries.get(key);
    if (!pixels || pixels.length !== expectedLength) return null;
    this.entries.delete(key);
    this.entries.set(key, pixels);
    return pixels;
  }

  put(key: string, pixels: Uint16Array): boolean {
    if (!(pixels instanceof Uint16Array) || pixels.byteLength > this.maxBytes) return false;
    const old = this.entries.get(key);
    if (old) { this.bytes -= old.byteLength; this.entries.delete(key); }
    while (this.entries.size > 0 && this.bytes + pixels.byteLength > this.maxBytes) {
      const oldest = this.entries.keys().next().value;
      if (oldest === undefined) break;
      const previous = this.entries.get(oldest);
      if (previous) this.bytes -= previous.byteLength;
      this.entries.delete(oldest);
    }
    this.entries.set(key, pixels);
    this.bytes += pixels.byteLength;
    return true;
  }

  clear(): void { this.entries.clear(); this.bytes = 0; }
  get sizeBytes(): number { return this.bytes; }
}
