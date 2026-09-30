import { decodeStoredRgb16Channel, encodeStoredRgb16Channel } from "@/image/rgb16-storage";

const DB_NAME = "local-stack-studio-canonical-source";
const DB_VERSION = 1;
const SESSION_STORE = "sessions";
const IMAGE_STORE = "images";
const CHUNK_STORE = "chunks";

export const CANONICAL_LINEAR_RANGE_MAX = 4 as const;
export const CANONICAL_PIXEL_FORMAT = "rgb-u16-gamma20-prophoto-r4" as const;
export const CANONICAL_TARGET_CHUNK_BYTES = 8 * 1024 * 1024;
const CANONICAL_RANGE_EPSILON = 1e-5;
const MAX_CACHE_BYTES = 64 * 1024 * 1024;

type CanonicalSessionRecord = {
  sessionId: string;
  formatVersion: 1;
  createdAt: number;
  lastAccessAt: number;
  imageCount: number;
  complete: boolean;
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

export type PreparedCanonicalSession = {
  id: string;
  filesSignature: string;
  db: IDBDatabase;
  images: CanonicalImageRecord[];
};

type CachedChunk = { key: string; data: Uint16Array; bytes: number; used: number };
const chunkCache = new Map<string, CachedChunk>();
let cacheBytes = 0;
let cacheCounter = 0;

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
  inputInfos: readonly any[],
): Promise<PreparedCanonicalSession> {
  const db = await openCanonicalSourceDb();
  const id = createSessionId();
  const record: CanonicalSessionRecord = {
    sessionId: id, formatVersion: 1, createdAt: Date.now(), lastAccessAt: Date.now(), imageCount: files.length, complete: false,
  };
  await idbPut(db, SESSION_STORE, record);
  return { id, filesSignature: canonicalFilesSignature(files), db, images: [] };
}

export async function estimateCanonicalCapacity(files: readonly File[], inputInfos: readonly any[]): Promise<void> {
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
  inputInfo: any,
  width: number,
  height: number,
  linear: Float32Array,
  onProgress?: (message: string) => void,
): Promise<CanonicalImageRecord> {
  if (!(linear instanceof Float32Array) || linear.length !== width * height * 3) throw new Error(`Canonical input ${file.name} has an invalid linear RGB buffer.`);
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
      if (!Number.isFinite(value) || value < -CANONICAL_RANGE_EPSILON || value > CANONICAL_LINEAR_RANGE_MAX + CANONICAL_RANGE_EPSILON) {
        throw new Error(`${file.name}: canonical linear sample ${value} is outside the supported 0..4 range.`);
      }
      stored[i] = encodeStoredRgb16Channel(Math.min(CANONICAL_LINEAR_RANGE_MAX, Math.max(0, value)), "gamma20", CANONICAL_LINEAR_RANGE_MAX);
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

export async function completeCanonicalSession(session: PreparedCanonicalSession): Promise<void> {
  if (session.images.length === 0 || session.images.some((image) => !image?.complete)) throw new Error("Canonical input session is incomplete.");
  const existing = await idbGet<CanonicalSessionRecord>(session.db, SESSION_STORE, session.id);
  await idbPut(session.db, SESSION_STORE, { ...(existing || {}), sessionId: session.id, formatVersion: 1, createdAt: existing?.createdAt || Date.now(), lastAccessAt: Date.now(), imageCount: session.images.length, complete: true });
}

function touchCache(key: string, data: Uint16Array): void {
  const existing = chunkCache.get(key);
  if (existing) { existing.used = ++cacheCounter; return; }
  const entry = { key, data, bytes: data.byteLength, used: ++cacheCounter };
  chunkCache.set(key, entry); cacheBytes += entry.bytes;
  while (cacheBytes > MAX_CACHE_BYTES && chunkCache.size > 1) {
    let oldest: CachedChunk | null = null;
    for (const item of chunkCache.values()) if (!oldest || item.used < oldest.used) oldest = item;
    if (!oldest) break;
    chunkCache.delete(oldest.key); cacheBytes -= oldest.bytes;
  }
}

async function readChunk(session: PreparedCanonicalSession, imageIndex: number, chunkIndex: number): Promise<Uint16Array> {
  const key = chunkKey(session.id, imageIndex, chunkIndex);
  const cached = chunkCache.get(key);
  if (cached) { cached.used = ++cacheCounter; return cached.data; }
  const record = await idbGet<CanonicalChunkRecord>(session.db, CHUNK_STORE, key);
  if (!record || !(record.buffer instanceof ArrayBuffer)) throw new Error(`Canonical input cache is incomplete for ${session.images[imageIndex]?.fileName || `image ${imageIndex + 1}`}.`);
  const data = new Uint16Array(record.buffer);
  touchCache(key, data);
  return data;
}

export async function readCanonicalStoredRows(session: PreparedCanonicalSession, imageIndex: number, startRow: number, rowCount: number): Promise<Uint16Array> {
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

export async function readCanonicalLinearRows(session: PreparedCanonicalSession, imageIndex: number, startRow: number, rowCount: number): Promise<Float32Array> {
  const stored = await readCanonicalStoredRows(session, imageIndex, startRow, rowCount);
  const lut = canonicalDecodeLut();
  const output = new Float32Array(stored.length);
  for (let i = 0; i < stored.length; i += 1) output[i] = lut[stored[i]];
  return output;
}

export async function materializeCanonicalLinearImage(session: PreparedCanonicalSession, imageIndex: number): Promise<Float32Array> {
  const meta = session.images[imageIndex];
  if (!meta) throw new Error(`Canonical input ${imageIndex + 1} is unavailable.`);
  return readCanonicalLinearRows(session, imageIndex, 0, meta.height);
}

export async function materializeCanonicalStoredImage(session: PreparedCanonicalSession, imageIndex: number): Promise<Uint16Array> {
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
  for (const key of Array.from(chunkCache.keys())) {
    if (key.startsWith(`${sessionId}:chunk:`)) {
      const entry = chunkCache.get(key); if (entry) cacheBytes -= entry.bytes;
      chunkCache.delete(key);
    }
  }
  if (!dbOverride) db.close();
}
