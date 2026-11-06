/** Session-local grayscale alignment frames, shared across alignment algorithms.
 * A 1MP frame is reused by ECC/ORB; only ORB
 * requests an additional 8MP frame. The cache is LRU and memory bounded.
 */
export const ALIGNMENT_FRAME_CACHE_MAX_BYTES = 128 * 1024 * 1024;

export type AlignmentCachedPixels = {
  grayBytes: Uint8Array | ArrayBufferLike;
};

export function alignmentFrameCacheKey(
  normalizationMode: string,
  targetWidth: number,
  targetHeight: number,
  imageIndex: number,
  refinement = false,
): string {
  const base = `${normalizationMode}:${targetWidth}x${targetHeight}:${imageIndex}`;
  return refinement ? `${base}:refinement-8mp` : base;
}

export function getCachedAlignmentFrame<Frame extends AlignmentCachedPixels>(
  cache: Map<string, Frame>,
  key: string,
): Frame | undefined {
  const item = cache.get(key);
  if (item) {
    cache.delete(key);
    cache.set(key, item); // Refresh recency without copying the pixel data.
  }
  return item;
}

export function alignmentFrameCacheBytes<Frame extends AlignmentCachedPixels>(cache: Map<string, Frame>): number {
  let bytes = 0;
  for (const item of cache.values()) bytes += item.grayBytes.byteLength;
  return bytes;
}

export function putCachedAlignmentFrame<Frame extends AlignmentCachedPixels>(
  cache: Map<string, Frame>,
  key: string,
  item: Frame,
  limitBytes = ALIGNMENT_FRAME_CACHE_MAX_BYTES,
): number {
  if (!(Number.isSafeInteger(limitBytes) && limitBytes > 0)) throw new Error("Invalid alignment frame cache limit.");
  cache.delete(key);
  cache.set(key, item);
  let currentBytes = alignmentFrameCacheBytes(cache);
  let evicted = 0;
  // A single frame larger than the budget must be kept so it can be used.
  while (currentBytes > limitBytes && cache.size > 1) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) break;
    const old = cache.get(oldest);
    cache.delete(oldest);
    currentBytes -= old?.grayBytes.byteLength ?? 0;
    evicted += 1;
  }
  return evicted;
}
