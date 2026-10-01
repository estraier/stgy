import { decodeStoredRgb16Channel, encodeStoredRgb16Channel } from "@/image/rgb16-storage";
import { clamp01, toneLinearIntensity } from "@/image/tone";
import type { StfToneStatistics } from "./stf-tone-match";

const DB_NAME = "local-stack-studio-canonical-source";
const DB_VERSION = 1;
const SESSION_STORE = "sessions";
const IMAGE_STORE = "images";
const CHUNK_STORE = "chunks";

export const CANONICAL_LINEAR_RANGE_MAX = 4 as const;
export const CANONICAL_PIXEL_FORMAT = "rgb-u16-gamma20-prophoto-r4" as const;
export const CANONICAL_TARGET_CHUNK_BYTES = 8 * 1024 * 1024;
// Canonical storage is non-negative, but supported wide-gamut -> ProPhoto
// matrix conversions can produce a very small negative channel for fully
// saturated boundary colors (Rec.2020 reaches about -0.00234). Treat only
// that known gamut/numerical fringe as a storage-boundary excursion.
export const CANONICAL_NEGATIVE_EXCURSION_TOLERANCE = 0.003;
// There is no corresponding expected >4 gamut excursion. Only absorb small
// floating-point/interpolation noise at the upper storage boundary.
export const CANONICAL_UPPER_ROUNDING_TOLERANCE = 1e-4;
export const CANONICAL_MAIN_CACHE_BYTES = 64 * 1024 * 1024;
export const CANONICAL_TONE_SAMPLE_TARGET_PIXELS = 65_536;
export const CANONICAL_TONE_HISTOGRAM_BINS = 4096;
export const CANONICAL_WORKER_CACHE_BYTES = 32 * 1024 * 1024;

export function normalizeCanonicalLinearSample(value: number): number {
  if (!Number.isFinite(value)) {
    throw new Error(`Canonical linear sample ${value} is not finite.`);
  }
  if (
    value < -CANONICAL_NEGATIVE_EXCURSION_TOLERANCE ||
    value > CANONICAL_LINEAR_RANGE_MAX + CANONICAL_UPPER_ROUNDING_TOLERANCE
  ) {
    throw new Error(`Canonical linear sample ${value} is outside the supported 0..${CANONICAL_LINEAR_RANGE_MAX} range.`);
  }
  if (value <= 0) return 0;
  if (value >= CANONICAL_LINEAR_RANGE_MAX) return CANONICAL_LINEAR_RANGE_MAX;
  return value;
}

function canonicalToneSampleDimensions(width: number, height: number): { width: number; height: number } {
  const pixelCount = width * height;
  if (pixelCount <= CANONICAL_TONE_SAMPLE_TARGET_PIXELS) return { width, height };
  const aspect = width / height;
  let sampleWidth = Math.max(1, Math.min(width, Math.round(Math.sqrt(CANONICAL_TONE_SAMPLE_TARGET_PIXELS * aspect))));
  let sampleHeight = Math.max(1, Math.min(height, Math.floor(CANONICAL_TONE_SAMPLE_TARGET_PIXELS / sampleWidth)));
  while (sampleWidth * sampleHeight > CANONICAL_TONE_SAMPLE_TARGET_PIXELS && sampleHeight > 1) sampleHeight -= 1;
  while (sampleWidth * sampleHeight > CANONICAL_TONE_SAMPLE_TARGET_PIXELS && sampleWidth > 1) sampleWidth -= 1;
  return { width: sampleWidth, height: sampleHeight };
}

function percentileFromCanonicalToneHistogram(
  histogram: Uint32Array,
  sampleCount: number,
  percentile: number,
): number {
  if (sampleCount <= 0) return 0;
  const rank = (sampleCount - 1) * Math.min(100, Math.max(0, percentile)) / 100;
  const lowerRank = Math.floor(rank);
  const upperRank = Math.ceil(rank);
  const fraction = rank - lowerRank;
  let cumulative = 0;
  let lowerBin = histogram.length - 1;
  let upperBin = histogram.length - 1;
  let lowerFound = false;
  for (let bin = 0; bin < histogram.length; bin += 1) {
    cumulative += histogram[bin] ?? 0;
    if (!lowerFound && cumulative > lowerRank) {
      lowerBin = bin;
      lowerFound = true;
    }
    if (cumulative > upperRank) {
      upperBin = bin;
      break;
    }
  }
  const level = lowerBin + (upperBin - lowerBin) * fraction;
  return level / Math.max(1, histogram.length - 1);
}

function canonicalToneStatisticsFromSampler(
  width: number,
  height: number,
  sampleIntensity: (pixelIndex: number) => number,
): StfToneStatistics {
  const dimensions = canonicalToneSampleDimensions(width, height);
  const histogram = new Uint32Array(CANONICAL_TONE_HISTOGRAM_BINS);
  let sum = 0;
  let sampleCount = 0;
  const maxBin = histogram.length - 1;
  for (let sy = 0; sy < dimensions.height; sy += 1) {
    const y = Math.min(height - 1, Math.floor((sy + 0.5) * height / dimensions.height));
    for (let sx = 0; sx < dimensions.width; sx += 1) {
      const x = Math.min(width - 1, Math.floor((sx + 0.5) * width / dimensions.width));
      const intensity = clamp01(sampleIntensity(y * width + x));
      sum += intensity;
      const bin = Math.min(maxBin, Math.max(0, Math.round(intensity * maxBin)));
      histogram[bin] += 1;
      sampleCount += 1;
    }
  }
  if (sampleCount <= 0) throw new Error("Canonical tone statistics have no samples.");
  return {
    sampleCount,
    mean: sum / sampleCount,
    p50: percentileFromCanonicalToneHistogram(histogram, sampleCount, 50),
    p95: percentileFromCanonicalToneHistogram(histogram, sampleCount, 95),
  };
}

export function computeCanonicalToneStatisticsFromLinearRgb(
  linear: Float32Array,
  width: number,
  height: number,
): StfToneStatistics {
  validateCanonicalImageShape("Tone statistics", width, height, linear.length);
  return canonicalToneStatisticsFromSampler(width, height, (pixelIndex) => {
    const index = pixelIndex * 3;
    return toneLinearIntensity(
      normalizeCanonicalLinearSample(linear[index] ?? 0),
      normalizeCanonicalLinearSample(linear[index + 1] ?? 0),
      normalizeCanonicalLinearSample(linear[index + 2] ?? 0),
    );
  });
}

export function computeCanonicalToneStatisticsFromStoredRgb16(
  stored: Uint16Array,
  width: number,
  height: number,
): StfToneStatistics {
  validateCanonicalImageShape("Tone statistics", width, height, stored.length);
  const lut = canonicalDecodeLut();
  return canonicalToneStatisticsFromSampler(width, height, (pixelIndex) => {
    const index = pixelIndex * 3;
    return toneLinearIntensity(
      lut[stored[index] ?? 0] ?? 0,
      lut[stored[index + 1] ?? 0] ?? 0,
      lut[stored[index + 2] ?? 0] ?? 0,
    );
  });
}

function validateCanonicalImageShape(fileName: string, width: number, height: number, sampleCount: number): void {
  if (!Number.isInteger(width) || width <= 0 || !Number.isInteger(height) || height <= 0) {
    throw new Error(`${fileName}: canonical image dimensions ${width}x${height} are invalid.`);
  }
  const expected = width * height * 3;
  if (!Number.isSafeInteger(expected) || sampleCount !== expected) {
    throw new Error(`${fileName}: canonical RGB buffer length ${sampleCount} does not match ${width}x${height}.`);
  }
}

type CanonicalSessionRecord = {
  sessionId: string;
  formatVersion: 1;
  createdAt: number;
  lastAccessAt: number;
  imageCount: number;
  complete: boolean;
};


export type CanonicalInputInfo = {
  width: number;
  height: number;
  isRaw?: boolean;
  sourceColorSpace?: string | null;
  fNumber?: number | null;
  exposureTime?: number | null;
  iso?: number | null;
  exposureScalar?: number | null;
};

export type CanonicalImageRecord = {
  sessionId: string;
  imageIndex: number;
  fileName: string;
  fileSize: number;
  lastModified: number;
  mimeType: string;
  width: number;
  height: number;
  pixelFormat: typeof CANONICAL_PIXEL_FORMAT;
  linearRangeMax: typeof CANONICAL_LINEAR_RANGE_MAX;
  rowBytes: number;
  rowsPerChunk: number;
  chunkCount: number;
  isRaw: boolean;
  sourceColorSpaceOriginal: string;
  fNumber: number | null;
  exposureTime: number | null;
  iso: number | null;
  exposureScalar: number | null;
  toneStatistics: StfToneStatistics;
  complete: boolean;
};

type CanonicalChunkRecord = {
  key: string;
  sessionId: string;
  imageIndex: number;
  chunkIndex: number;
  startRow: number;
  rowCount: number;
  buffer: ArrayBuffer;
};

type CachedChunk = { key: string; data: Uint16Array; bytes: number; used: number };

export class CanonicalChunkCache {
  private readonly entries = new Map<string, CachedChunk>();
  private bytes = 0;
  private counter = 0;

  constructor(readonly maxBytes: number) {
    if (!Number.isFinite(maxBytes) || maxBytes <= 0) throw new Error("Canonical chunk cache size must be positive.");
  }

  get(key: string): Uint16Array | null {
    const entry = this.entries.get(key);
    if (!entry) return null;
    entry.used = ++this.counter;
    return entry.data;
  }

  put(key: string, data: Uint16Array): void {
    const existing = this.entries.get(key);
    if (existing) {
      existing.used = ++this.counter;
      return;
    }
    const entry = { key, data, bytes: data.byteLength, used: ++this.counter };
    this.entries.set(key, entry);
    this.bytes += entry.bytes;
    while (this.bytes > this.maxBytes && this.entries.size > 1) {
      let oldest: CachedChunk | null = null;
      for (const item of this.entries.values()) if (!oldest || item.used < oldest.used) oldest = item;
      if (!oldest) break;
      this.entries.delete(oldest.key);
      this.bytes -= oldest.bytes;
    }
  }

  clearSession(sessionId: string): void {
    for (const key of Array.from(this.entries.keys())) {
      if (!key.startsWith(`${sessionId}:chunk:`)) continue;
      const entry = this.entries.get(key);
      if (entry) this.bytes -= entry.bytes;
      this.entries.delete(key);
    }
  }

  clear(): void {
    this.entries.clear();
    this.bytes = 0;
  }

  get sizeBytes(): number { return this.bytes; }
  get sizeEntries(): number { return this.entries.size; }
}

export type CanonicalReadableSession = {
  id: string;
  db: IDBDatabase;
  images: CanonicalImageRecord[];
  chunkCache: CanonicalChunkCache;
};

export type PreparedCanonicalSession = CanonicalReadableSession & {
  filesSignature: string;
};

export type CanonicalReadSession = CanonicalReadableSession & {
  close(): void;
};

function createSessionId(): string {
  if (globalThis.crypto && typeof globalThis.crypto.randomUUID === "function") return globalThis.crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function canonicalFilesSignature(files: readonly File[]): string {
  return files.map((file, index) => `${index}:${file.name}\u0000${file.size}\u0000${file.lastModified}\u0000${file.type}`).join("\u0001");
}

export function openCanonicalSourceDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (!("indexedDB" in globalThis)) {
      reject(new Error("Local Stack Studio canonical inputs require IndexedDB support in this browser."));
      return;
    }
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(SESSION_STORE)) db.createObjectStore(SESSION_STORE, { keyPath: "sessionId" });
      if (!db.objectStoreNames.contains(IMAGE_STORE)) db.createObjectStore(IMAGE_STORE, { keyPath: "key" });
      if (!db.objectStoreNames.contains(CHUNK_STORE)) db.createObjectStore(CHUNK_STORE, { keyPath: "key" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("Could not open Local Stack Studio canonical input storage."));
    request.onblocked = () => reject(new Error("Local Stack Studio canonical input storage is blocked by another tab."));
  });
}

function imageKey(sessionId: string, imageIndex: number): string {
  return `${sessionId}:image:${imageIndex}`;
}
function chunkKey(sessionId: string, imageIndex: number, chunkIndex: number): string {
  return `${sessionId}:chunk:${imageIndex}:${chunkIndex}`;
}

function idbPut(db: IDBDatabase, storeName: string, value: unknown): Promise<void> {
  return new Promise((resolve, reject) => {
    let tx: IDBTransaction;
    try { tx = db.transaction(storeName, "readwrite"); } catch (error) { reject(error); return; }
    tx.objectStore(storeName).put(value);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error || new Error(`Could not write ${storeName}.`));
    tx.onabort = () => reject(tx.error || new Error(`${storeName} write was aborted.`));
  });
}

function idbGet<T>(db: IDBDatabase, storeName: string, key: IDBValidKey): Promise<T | undefined> {
  return new Promise((resolve, reject) => {
    let tx: IDBTransaction;
    try { tx = db.transaction(storeName, "readonly"); } catch (error) { reject(error); return; }
    const req = tx.objectStore(storeName).get(key);
    req.onsuccess = () => resolve(req.result as T | undefined);
    req.onerror = () => reject(req.error || new Error(`Could not read ${storeName}.`));
  });
}

function quotaError(error: unknown): Error {
  if (error && typeof error === "object" && ("name" in error) && ((error as {name?: string}).name === "QuotaExceededError" || (error as {name?: string}).name === "UnknownError")) {
    return new Error("Browser storage is full while preparing Local Stack Studio canonical inputs.");
  }
  return error instanceof Error ? error : new Error(String(error));
}

export async function createCanonicalSession(
  files: readonly File[],
  _inputInfos: readonly CanonicalInputInfo[],
): Promise<PreparedCanonicalSession> {
  const db = await openCanonicalSourceDb();
  const id = createSessionId();
  const record: CanonicalSessionRecord = {
    sessionId: id, formatVersion: 1, createdAt: Date.now(), lastAccessAt: Date.now(), imageCount: files.length, complete: false,
  };
  await idbPut(db, SESSION_STORE, record);
  return { id, filesSignature: canonicalFilesSignature(files), db, images: [], chunkCache: new CanonicalChunkCache(CANONICAL_MAIN_CACHE_BYTES) };
}

export async function estimateCanonicalCapacity(_files: readonly File[], inputInfos: readonly CanonicalInputInfo[]): Promise<void> {
  if (!(navigator.storage && typeof navigator.storage.estimate === "function")) return;
  const required = inputInfos.reduce((sum, info) => sum + Math.max(0, Number(info?.width) || 0) * Math.max(0, Number(info?.height) || 0) * 6, 0) + 64 * 1024 * 1024;
  const estimate = await navigator.storage.estimate();
  if (Number.isFinite(estimate.quota) && Number.isFinite(estimate.usage)) {
    const available = Number(estimate.quota) - Number(estimate.usage);
    if (available < required) {
      throw new Error(`Local Stack Studio canonical inputs need about ${(required / (1024 ** 3)).toFixed(2)} GiB, but only ${(Math.max(0, available) / (1024 ** 3)).toFixed(2)} GiB is available.`);
    }
  }
}

export async function writeCanonicalLinearImage(
  session: PreparedCanonicalSession,
  imageIndex: number,
  file: File,
  inputInfo: CanonicalInputInfo,
  width: number,
  height: number,
  linear: Float32Array,
  onProgress?: (message: string) => void,
): Promise<CanonicalImageRecord> {
  if (!(linear instanceof Float32Array)) throw new Error(`Canonical input ${file.name} has an invalid linear RGB buffer.`);
  validateCanonicalImageShape(file.name, width, height, linear.length);
  const rowBytes = width * 3 * Uint16Array.BYTES_PER_ELEMENT;
  const rowsPerChunk = Math.max(1, Math.floor(CANONICAL_TARGET_CHUNK_BYTES / rowBytes));
  const chunkCount = Math.ceil(height / rowsPerChunk);
  const record: CanonicalImageRecord = {
    sessionId: session.id, imageIndex, fileName: file.name, fileSize: file.size, lastModified: file.lastModified, mimeType: file.type,
    width, height, pixelFormat: CANONICAL_PIXEL_FORMAT, linearRangeMax: CANONICAL_LINEAR_RANGE_MAX,
    rowBytes, rowsPerChunk, chunkCount,
    isRaw: Boolean(inputInfo?.isRaw), sourceColorSpaceOriginal: String(inputInfo?.sourceColorSpace || "srgb"),
    fNumber: Number.isFinite(inputInfo?.fNumber) ? Number(inputInfo.fNumber) : null,
    exposureTime: Number.isFinite(inputInfo?.exposureTime) ? Number(inputInfo.exposureTime) : null,
    iso: Number.isFinite(inputInfo?.iso) ? Number(inputInfo.iso) : null,
    exposureScalar: Number.isFinite(inputInfo?.exposureScalar) ? Number(inputInfo.exposureScalar) : null,
    toneStatistics: computeCanonicalToneStatisticsFromLinearRgb(linear, width, height),
    complete: false,
  };
  await idbPut(session.db, IMAGE_STORE, { ...record, key: imageKey(session.id, imageIndex) });

  for (let chunkIndex = 0; chunkIndex < chunkCount; chunkIndex += 1) {
    const startRow = chunkIndex * rowsPerChunk;
    const rowCount = Math.min(rowsPerChunk, height - startRow);
    const stored = new Uint16Array(rowCount * width * 3);
    const sourceStart = startRow * width * 3;
    for (let i = 0; i < stored.length; i += 1) {
      const value = linear[sourceStart + i];
      let normalized: number;
      try {
        normalized = normalizeCanonicalLinearSample(value);
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        throw new Error(`${file.name}: ${detail}`);
      }
      stored[i] = encodeStoredRgb16Channel(normalized, "gamma20", CANONICAL_LINEAR_RANGE_MAX);
    }
    const chunk: CanonicalChunkRecord = { key: chunkKey(session.id, imageIndex, chunkIndex), sessionId: session.id, imageIndex, chunkIndex, startRow, rowCount, buffer: stored.buffer };
    try { await idbPut(session.db, CHUNK_STORE, chunk); } catch (error) { throw quotaError(error); }
    onProgress?.(`Caching input ${imageIndex + 1}, chunk ${chunkIndex + 1}/${chunkCount}...`);
  }
  record.complete = true;
  await idbPut(session.db, IMAGE_STORE, { ...record, key: imageKey(session.id, imageIndex) });
  session.images[imageIndex] = record;
  return record;
}


export async function writeCanonicalStoredImage(
  session: PreparedCanonicalSession,
  imageIndex: number,
  file: File,
  inputInfo: CanonicalInputInfo,
  width: number,
  height: number,
  storedImage: Uint16Array,
  onProgress?: (message: string) => void,
): Promise<CanonicalImageRecord> {
  if (!(storedImage instanceof Uint16Array)) {
    throw new Error(`Canonical input ${file.name} has an invalid stored RGB buffer.`);
  }
  validateCanonicalImageShape(file.name, width, height, storedImage.length);
  const rowBytes = width * 3 * Uint16Array.BYTES_PER_ELEMENT;
  const rowsPerChunk = Math.max(1, Math.floor(CANONICAL_TARGET_CHUNK_BYTES / rowBytes));
  const chunkCount = Math.ceil(height / rowsPerChunk);
  const record: CanonicalImageRecord = {
    sessionId: session.id, imageIndex, fileName: file.name, fileSize: file.size, lastModified: file.lastModified, mimeType: file.type,
    width, height, pixelFormat: CANONICAL_PIXEL_FORMAT, linearRangeMax: CANONICAL_LINEAR_RANGE_MAX,
    rowBytes, rowsPerChunk, chunkCount,
    isRaw: Boolean(inputInfo?.isRaw), sourceColorSpaceOriginal: String(inputInfo?.sourceColorSpace || "srgb"),
    fNumber: Number.isFinite(inputInfo?.fNumber) ? Number(inputInfo.fNumber) : null,
    exposureTime: Number.isFinite(inputInfo?.exposureTime) ? Number(inputInfo.exposureTime) : null,
    iso: Number.isFinite(inputInfo?.iso) ? Number(inputInfo.iso) : null,
    exposureScalar: Number.isFinite(inputInfo?.exposureScalar) ? Number(inputInfo.exposureScalar) : null,
    toneStatistics: computeCanonicalToneStatisticsFromStoredRgb16(storedImage, width, height),
    complete: false,
  };
  await idbPut(session.db, IMAGE_STORE, { ...record, key: imageKey(session.id, imageIndex) });

  for (let chunkIndex = 0; chunkIndex < chunkCount; chunkIndex += 1) {
    const startRow = chunkIndex * rowsPerChunk;
    const rowCount = Math.min(rowsPerChunk, height - startRow);
    const sourceStart = startRow * width * 3;
    const sourceEnd = sourceStart + rowCount * width * 3;
    const stored = new Uint16Array(sourceEnd - sourceStart);
    stored.set(storedImage.subarray(sourceStart, sourceEnd));
    const chunk: CanonicalChunkRecord = {
      key: chunkKey(session.id, imageIndex, chunkIndex),
      sessionId: session.id,
      imageIndex,
      chunkIndex,
      startRow,
      rowCount,
      buffer: stored.buffer,
    };
    try { await idbPut(session.db, CHUNK_STORE, chunk); } catch (error) { throw quotaError(error); }
    onProgress?.(`Caching input ${imageIndex + 1}, chunk ${chunkIndex + 1}/${chunkCount}...`);
  }
  record.complete = true;
  await idbPut(session.db, IMAGE_STORE, { ...record, key: imageKey(session.id, imageIndex) });
  session.images[imageIndex] = record;
  return record;
}

export async function completeCanonicalSession(session: PreparedCanonicalSession): Promise<void> {
  if (session.images.length === 0 || session.images.some((image) => !image?.complete)) throw new Error("Canonical input session is incomplete.");
  const existing = await idbGet<CanonicalSessionRecord>(session.db, SESSION_STORE, session.id);
  await idbPut(session.db, SESSION_STORE, { ...(existing || {}), sessionId: session.id, formatVersion: 1, createdAt: existing?.createdAt || Date.now(), lastAccessAt: Date.now(), imageCount: session.images.length, complete: true });
}

export async function openCanonicalReadSession(
  sessionId: string,
  maxCacheBytes: number = CANONICAL_WORKER_CACHE_BYTES,
): Promise<CanonicalReadSession> {
  if (!sessionId) throw new Error("Canonical input session id is required.");
  const db = await openCanonicalSourceDb();
  try {
    const sessionRecord = await idbGet<CanonicalSessionRecord>(db, SESSION_STORE, sessionId);
    if (!sessionRecord || sessionRecord.formatVersion !== 1 || !sessionRecord.complete) {
      throw new Error("Canonical input session is unavailable or incomplete.");
    }
    if (!Number.isInteger(sessionRecord.imageCount) || sessionRecord.imageCount <= 0) {
      throw new Error("Canonical input session has invalid image metadata.");
    }
    const images: CanonicalImageRecord[] = [];
    for (let imageIndex = 0; imageIndex < sessionRecord.imageCount; imageIndex += 1) {
      const record = await idbGet<CanonicalImageRecord & { key?: string }>(db, IMAGE_STORE, imageKey(sessionId, imageIndex));
      if (!record?.complete || record.sessionId !== sessionId || record.imageIndex !== imageIndex || record.pixelFormat !== CANONICAL_PIXEL_FORMAT || record.linearRangeMax !== CANONICAL_LINEAR_RANGE_MAX) {
        throw new Error(`Canonical input metadata is incomplete for image ${imageIndex + 1}.`);
      }
      images.push(record);
    }
    const chunkCache = new CanonicalChunkCache(maxCacheBytes);
    let closed = false;
    return {
      id: sessionId,
      db,
      images,
      chunkCache,
      close() {
        if (closed) return;
        closed = true;
        chunkCache.clear();
        db.close();
      },
    };
  } catch (error) {
    db.close();
    throw error;
  }
}

async function readChunk(session: CanonicalReadableSession, imageIndex: number, chunkIndex: number): Promise<Uint16Array> {
  const key = chunkKey(session.id, imageIndex, chunkIndex);
  const cached = session.chunkCache.get(key);
  if (cached) return cached;
  const record = await idbGet<CanonicalChunkRecord>(session.db, CHUNK_STORE, key);
  if (!record || !(record.buffer instanceof ArrayBuffer)) throw new Error(`Canonical input cache is incomplete for ${session.images[imageIndex]?.fileName || `image ${imageIndex + 1}`}.`);
  const data = new Uint16Array(record.buffer);
  session.chunkCache.put(key, data);
  return data;
}

export async function readCanonicalStoredRows(session: CanonicalReadableSession, imageIndex: number, startRow: number, rowCount: number): Promise<Uint16Array> {
  const meta = session.images[imageIndex];
  if (!meta?.complete) throw new Error(`Canonical input cache is incomplete for image ${imageIndex + 1}.`);
  if (!Number.isInteger(startRow) || !Number.isInteger(rowCount) || startRow < 0 || rowCount < 0 || startRow + rowCount > meta.height) throw new Error("Canonical row request is out of bounds.");
  const output = new Uint16Array(rowCount * meta.width * 3);
  if (rowCount === 0) return output;
  const firstChunk = Math.floor(startRow / meta.rowsPerChunk);
  const lastChunk = Math.floor((startRow + rowCount - 1) / meta.rowsPerChunk);
  for (let chunkIndex = firstChunk; chunkIndex <= lastChunk; chunkIndex += 1) {
    const chunkStart = chunkIndex * meta.rowsPerChunk;
    const chunkRows = Math.min(meta.rowsPerChunk, meta.height - chunkStart);
    const chunk = await readChunk(session, imageIndex, chunkIndex);
    if (chunk.length !== chunkRows * meta.width * 3) throw new Error(`Canonical input cache is incomplete for ${meta.fileName}.`);
    const copyStartRow = Math.max(startRow, chunkStart);
    const copyEndRow = Math.min(startRow + rowCount, chunkStart + chunkRows);
    const rows = copyEndRow - copyStartRow;
    const src = (copyStartRow - chunkStart) * meta.width * 3;
    const dst = (copyStartRow - startRow) * meta.width * 3;
    output.set(chunk.subarray(src, src + rows * meta.width * 3), dst);
  }
  return output;
}

let decodeLut: Float32Array | null = null;
function canonicalDecodeLut(): Float32Array {
  if (decodeLut) return decodeLut;
  decodeLut = new Float32Array(65536);
  for (let i = 0; i < 65536; i += 1) decodeLut[i] = decodeStoredRgb16Channel(i, "gamma20", CANONICAL_LINEAR_RANGE_MAX);
  return decodeLut;
}

export async function readCanonicalLinearRows(session: CanonicalReadableSession, imageIndex: number, startRow: number, rowCount: number): Promise<Float32Array> {
  const stored = await readCanonicalStoredRows(session, imageIndex, startRow, rowCount);
  const lut = canonicalDecodeLut();
  const output = new Float32Array(stored.length);
  for (let i = 0; i < stored.length; i += 1) output[i] = lut[stored[i]];
  return output;
}

export async function materializeCanonicalLinearImage(session: CanonicalReadableSession, imageIndex: number): Promise<Float32Array> {
  const meta = session.images[imageIndex];
  if (!meta) throw new Error(`Canonical input ${imageIndex + 1} is unavailable.`);
  return readCanonicalLinearRows(session, imageIndex, 0, meta.height);
}

export async function materializeCanonicalStoredImage(session: CanonicalReadableSession, imageIndex: number): Promise<Uint16Array> {
  const meta = session.images[imageIndex];
  if (!meta) throw new Error(`Canonical input ${imageIndex + 1} is unavailable.`);
  return readCanonicalStoredRows(session, imageIndex, 0, meta.height);
}

export async function deleteCanonicalSession(session: PreparedCanonicalSession | string, dbOverride?: IDBDatabase): Promise<void> {
  const sessionId = typeof session === "string" ? session : session.id;
  const db = dbOverride || (typeof session === "string" ? await openCanonicalSourceDb() : session.db);
  await new Promise<void>((resolve, reject) => {
    let tx: IDBTransaction;
    try { tx = db.transaction([SESSION_STORE, IMAGE_STORE, CHUNK_STORE], "readwrite"); } catch (error) { reject(error); return; }
    tx.objectStore(SESSION_STORE).delete(sessionId);
    for (const storeName of [IMAGE_STORE, CHUNK_STORE]) {
      const store = tx.objectStore(storeName);
      const req = store.openCursor();
      req.onsuccess = () => {
        const cursor = req.result;
        if (!cursor) return;
        const value = cursor.value as { sessionId?: string };
        if (value?.sessionId === sessionId) cursor.delete();
        cursor.continue();
      };
    }
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error || new Error("Could not clear canonical input session."));
    tx.onabort = () => reject(tx.error || new Error("Canonical input cleanup was aborted."));
  });
  if (typeof session !== "string") session.chunkCache.clearSession(sessionId);
  if (!dbOverride) db.close();
}
