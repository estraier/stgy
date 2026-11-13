/**
 * One reusable, unmodified, scene-linear STF source image.
 *
 * This cache is independent from the much smaller gate-analysis RAM budget.
 * Holding a Float32Array reference performs no copy and no IndexedDB I/O.
 * The array must never be modified while cached: STF result finalization applies
 * a destructive highlight rolloff, so callers must finalize a copy instead.
 */
export const STF_SOURCE_CACHE_MAX_BYTES = 256 * 1024 * 1024;
export const STF_SOURCE_CACHE_MIN_DEVICE_MEMORY_GIB = 4;

export type StfSourceCacheKeyParts = {
  sessionId: string;
  width: number;
  height: number;
  alignmentPlan: {
    normalizationMode: string;
    targetWidth: number;
    targetHeight: number;
  };
  matrices: readonly (ArrayLike<number> | null)[];
  gains: ArrayLike<number>;
  scaledLogs: ArrayLike<number>;
  weights: ArrayLike<number>;
};

/** A source key excludes Blur settings by construction. */
export function buildStfSourceCacheKey(parts: StfSourceCacheKeyParts): string {
  return JSON.stringify(["stf-linear-source-real-v1", parts.sessionId, parts.width, parts.height,
    parts.alignmentPlan.normalizationMode, parts.alignmentPlan.targetWidth, parts.alignmentPlan.targetHeight,
    parts.matrices.map((matrix) => matrix === null ? null : Array.from(matrix)),
    Array.from(parts.gains), Array.from(parts.scaledLogs), Array.from(parts.weights)]);
}

type SourceEntry = { key: string; pixels: Float32Array };

export type StfSourceRetention = {
  retained: boolean;
  reason: string;
};

export class StfSourceCache {
  private entry: SourceEntry | null = null;

  constructor(private readonly maxBytes = STF_SOURCE_CACHE_MAX_BYTES) {}

  /** A different source key releases the old 230MiB+ image immediately. */
  lookup(key: string, expectedLength: number): Float32Array | null {
    if (this.entry && (this.entry.key !== key || this.entry.pixels.length !== expectedLength)) {
      this.entry = null;
    }
    return this.entry?.pixels ?? null;
  }

  retain(key: string, pixels: Float32Array, deviceMemoryGiB?: number): StfSourceRetention {
    if (pixels.byteLength > this.maxBytes) {
      this.entry = null;
      return { retained: false, reason: "Image exceeds the one-slot RAM source budget" };
    }
    if (deviceMemoryGiB !== undefined && Number.isFinite(deviceMemoryGiB) &&
        deviceMemoryGiB < STF_SOURCE_CACHE_MIN_DEVICE_MEMORY_GIB) {
      this.entry = null;
      return { retained: false, reason: "Low device-memory estimate; avoid retaining a full-resolution source" };
    }
    this.entry = { key, pixels };
    return { retained: true, reason: "One-slot RAM cache; no extra source copy or IndexedDB I/O" };
  }

  clear(): void { this.entry = null; }

  get byteLength(): number { return this.entry?.pixels.byteLength ?? 0; }

  holds(pixels: Float32Array): boolean { return this.entry?.pixels === pixels; }
}

/** Finalization can write into its argument; never let it mutate cached pixels. */
export function stfSourceForFinalization(source: Float32Array, cached: boolean): Float32Array {
  return cached ? source.slice() : source;
}
