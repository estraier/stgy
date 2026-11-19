/**
 * Short-lived RAW source byte reuse for LIS and LSS. LibRaw may transfer its
 * open() input, so no caller ever receives the retained buffer itself.
 *
 * Do not retain decoded pixels or LibRaw instances here: the former are much
 * larger than the compressed file, and the latter carry their own WASM heap.
 */
const RAW_BYTE_CACHE_BUDGET = 64 * 1024 * 1024;
const RAW_BYTE_CACHE_TTL_MS = 60_000;

type CachedRawBytes = {
  bytes: ArrayBuffer;
  timeout: ReturnType<typeof setTimeout>;
};

const cached = new Map<File, CachedRawBytes>();
const loading = new WeakMap<File, Promise<ArrayBuffer>>();
let cachedByteCount = 0;

export function releaseRawInputBytes(file: File): void {
  const entry = cached.get(file);
  if (!entry) return;
  cached.delete(file);
  cachedByteCount -= entry.bytes.byteLength;
  clearTimeout(entry.timeout);
}

function retainRawInputBytes(file: File, input: ArrayBuffer): void {
  if (!input.byteLength || file.size > RAW_BYTE_CACHE_BUDGET
      || input.byteLength > RAW_BYTE_CACHE_BUDGET || cached.has(file)) return;
  // Keep the first files in LSS input order. Those files will also be decoded
  // first; evicting them to retain later metadata probes defeats reuse.
  if (cachedByteCount + input.byteLength > RAW_BYTE_CACHE_BUDGET) return;
  const bytes = input.slice(0);
  const entry: CachedRawBytes = {
    bytes,
    timeout: setTimeout(() => {
      if (cached.get(file) === entry) releaseRawInputBytes(file);
    }, RAW_BYTE_CACHE_TTL_MS),
  };
  // Do not let a pending cache expiry prevent Node-based test processes from exiting.
  (entry.timeout as unknown as { unref?: () => void }).unref?.();
  cached.set(file, entry);
  cachedByteCount += bytes.byteLength;
}

/**
 * Return independent bytes on every request. The first read can be transferred
 * directly; subsequent requests copy from the immutable bounded cache.
 * Large files, or files which do not fit the cache, retain the old read path.
 */
export async function readRawInputBytes(file: File): Promise<Uint8Array<ArrayBuffer>> {
  const entry = cached.get(file);
  if (entry && entry.bytes.byteLength > 0) {
    return new Uint8Array(entry.bytes.slice(0));
  }
  // Never add an extra buffer copy for a RAW larger than the retention budget.
  if (file.size > RAW_BYTE_CACHE_BUDGET) return new Uint8Array(await file.arrayBuffer());
  const pending = loading.get(file);
  if (pending) {
    await pending;
    // The first read published the retained copy before resolving to callers.
    const retained = cached.get(file);
    return retained
      ? new Uint8Array(retained.bytes.slice(0))
      : new Uint8Array(await file.arrayBuffer());
  }
  const read = file.arrayBuffer();
  loading.set(file, read);
  try {
    const input = await read;
    retainRawInputBytes(file, input);
    return new Uint8Array(input);
  } finally {
    if (loading.get(file) === read) loading.delete(file);
  }
}
