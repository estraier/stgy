/** Best-effort persistent bidirectional 4MP Farneback Flow cache.
 * Cache hits never rewrite metadata. Once admitted, valid pairs stay cached
 * until explicit session deletion, 30-minute expiration, or corruption. When
 * the 512MiB budget fills, skip new admissions instead of evicting pairs that
 * the next sequential merge will need again.
 * Every record belongs to a Canonical input session. Re-selecting files starts
 * a new session, even when the files contain identical pixels. No file hash,
 * WebCrypto, or cross-session content-based reuse is involved.
 */
export const STF_FLOW_CACHE_MAX_BYTES = 512 * 1024 * 1024;
const FLOW_ALGORITHM_VERSION = "stf-gray4mp-farneback-f-adaptive-winsize-v3";

/** The alignment identifier describes processing parameters, never image content. */
export function stfFlowSessionKey(
  sessionId: string, previousImageId: number, nextImageId: number,
  alignmentKey: string, width: number, height: number, winsize = 31,
): string | null {
  if (!sessionId || !alignmentKey ||
      !Number.isSafeInteger(previousImageId) || previousImageId < 0 ||
      !Number.isSafeInteger(nextImageId) || nextImageId < 0 ||
      previousImageId === nextImageId ||
      !Number.isSafeInteger(width * height) || width <= 0 || height <= 0 ||
      !Number.isSafeInteger(winsize) || winsize < 11 || winsize > 31 || winsize % 2 === 0) return null;
  return JSON.stringify([sessionId, FLOW_ALGORITHM_VERSION,
    previousImageId, nextImageId, alignmentKey, width, height, winsize]);
}

const DB_NAME = "local-stack-studio-stf-flow";
// The session key contains the actual winsize, allowing reuse of valid
// prior Flow fields with the same window. Old v1/v2 fields are incompatible;
// clear them once on upgrade rather than occupying the no-LRU budget.
const DB_VERSION = 3;
const FLOW_STORE = "pairs";
const META_STORE = "metadata";

type FlowRecord = {
  key: string;
  sessionId: string;
  width: number;
  height: number;
  forward: Float32Array;
  backward: Float32Array;
  createdAt: number; // Session creation timestamp, not the insertion timestamp.
};
type FlowMetadata = { key: string; sessionId: string; bytes: number; createdAt: number };
export type StfCachedBidirectionalFlow = { forward: Float32Array; backward: Float32Array };

export function validateStfCachedFlow(
  value: unknown, sessionId: string, width: number, height: number, now = Date.now(),
): value is FlowRecord {
  if (!value || typeof value !== "object" || !sessionId) return false;
  const item = value as Partial<FlowRecord>;
  if (item.sessionId !== sessionId || item.width !== width || item.height !== height ||
      !(item.forward instanceof Float32Array) || !(item.backward instanceof Float32Array) ||
      !Number.isSafeInteger(item.createdAt) || item.createdAt! > now || item.createdAt! < 0) return false;
  const expected = width * height * 2;
  if (!Number.isSafeInteger(expected) || expected <= 0 ||
      item.forward.length !== expected || item.backward.length !== expected) return false;
  // Corrupt or nonfinite vectors cannot enter a source blend.
  for (let i = 0; i < expected; i++) {
    if (!Number.isFinite(item.forward[i]) || !Number.isFinite(item.backward[i])) return false;
  }
  return true;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") { reject(new Error("IndexedDB unavailable")); return; }
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = (event) => {
      const db = request.result;
      if (event.oldVersion > 0 && event.oldVersion < DB_VERSION) {
        if (db.objectStoreNames.contains(FLOW_STORE)) db.deleteObjectStore(FLOW_STORE);
        if (db.objectStoreNames.contains(META_STORE)) db.deleteObjectStore(META_STORE);
      }
      if (!db.objectStoreNames.contains(FLOW_STORE)) db.createObjectStore(FLOW_STORE, { keyPath: "key" });
      if (!db.objectStoreNames.contains(META_STORE)) db.createObjectStore(META_STORE, { keyPath: "key" });
    };
    request.onsuccess = () => {
      const db = request.result;
      db.onversionchange = () => db.close();
      resolve(db);
    };
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error("STF Flow IndexedDB upgrade blocked"));
  });
}

function readRecord(db: IDBDatabase, key: string): Promise<FlowRecord | undefined> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(FLOW_STORE, "readonly");
    const request = tx.objectStore(FLOW_STORE).get(key);
    request.onsuccess = () => resolve(request.result as FlowRecord | undefined);
    request.onerror = () => reject(request.error);
    tx.onabort = () => reject(tx.error);
  });
}

function discardRecord(db: IDBDatabase, key: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction([FLOW_STORE, META_STORE], "readwrite");
    tx.objectStore(FLOW_STORE).delete(key);
    tx.objectStore(META_STORE).delete(key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

export async function readStfCachedFlow(
  sessionId: string, key: string, width: number, height: number,
): Promise<StfCachedBidirectionalFlow | null> {
  if (!sessionId || !key) return null;
  let db: IDBDatabase | null = null;
  try {
    db = await openDb();
    const record = await readRecord(db, key);
    if (!record) return null;
    // A request with the wrong session ID must never evict another session's data.
    if (record.sessionId !== sessionId) return null;
    if (record.key !== key || !validateStfCachedFlow(record, sessionId, width, height)) {
      await discardRecord(db, key).catch(() => {});
      return null;
    }
    return { forward: record.forward, backward: record.backward };
  } catch {
    return null;
  } finally {
    db?.close();
  }
}

// Metadata cursor only: never deserialize all the large Flow buffers.
// This is an admission policy, not an eviction policy: a full cache retains
// its existing pairs so repeated left-to-right merges do not continually
// recompute every pair after replacing the previously cached pair.
function storeIfSpace(db: IDBDatabase, record: FlowRecord, maxBytes: number): Promise<boolean> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction([FLOW_STORE, META_STORE], "readwrite");
    const flows = tx.objectStore(FLOW_STORE);
    const metadata = tx.objectStore(META_STORE);
    let admitted = false;
    let retainedBytes = 0;
    const request = metadata.openCursor();
    request.onsuccess = () => {
      const cursor = request.result;
      if (cursor) {
        const entry = cursor.value as FlowMetadata;
        const now = Date.now();
        const invalid = !entry.key || !entry.sessionId ||
          !Number.isSafeInteger(entry.createdAt) || entry.createdAt < 0 || entry.createdAt > now ||
          !Number.isSafeInteger(entry.bytes) || entry.bytes <= 0;
        if (invalid) {
          flows.delete(entry.key);
          cursor.delete();
        } else if (entry.key !== record.key) {
          // The old size of a key being replaced is not part of its new cost.
          retainedBytes += entry.bytes;
        }
        cursor.continue();
        return;
      }
      const incomingBytes = record.forward.byteLength + record.backward.byteLength;
      if (retainedBytes + incomingBytes > maxBytes) return;
      flows.put(record);
      metadata.put({ key: record.key, sessionId: record.sessionId,
        bytes: incomingBytes, createdAt: record.createdAt } satisfies FlowMetadata);
      admitted = true;
    };
    tx.oncomplete = () => resolve(admitted);
    request.onerror = () => reject(request.error);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

export async function writeStfCachedFlow(
  sessionId: string, key: string, sessionCreatedAt: number,
  width: number, height: number,
  forward: Float32Array, backward: Float32Array,
  maxBytes = STF_FLOW_CACHE_MAX_BYTES,
): Promise<boolean> {
  if (!sessionId || !key || !Number.isFinite(maxBytes) || maxBytes <= 0) return false;
  const record: FlowRecord = { key, sessionId, width, height,
    forward, backward, createdAt: sessionCreatedAt };
  if (!validateStfCachedFlow(record, sessionId, width, height)) return false;
  const bytes = forward.byteLength + backward.byteLength;
  if (bytes > maxBytes) return false;
  let db: IDBDatabase | null = null;
  try {
    const estimate = await navigator.storage?.estimate?.().catch(() => undefined);
    if (estimate && typeof estimate.quota === "number" && typeof estimate.usage === "number" &&
        estimate.quota - estimate.usage < bytes * 1.25) return false;
    db = await openDb();
    return await storeIfSpace(db, record, maxBytes);
  } catch {
    return false;
  } finally {
    db?.close();
  }
}

/** Removes only one identified session, regardless of its age. */
export async function deleteStfFlowSession(sessionId: string): Promise<number> {
  if (!sessionId) return 0;
  return removeStfFlowRecords((entry) => entry.sessionId === sessionId);
}

/** Called on new-session creation. Expire by session creation time, even if active. */
export async function purgeExpiredStfFlowSessions(cutoffAt: number): Promise<number> {
  return removeStfFlowRecords((entry) => !Number.isFinite(entry.createdAt) || entry.createdAt <= cutoffAt);
}

async function removeStfFlowRecords(predicate: (entry: FlowMetadata) => boolean): Promise<number> {
  const db = await openDb();
  try {
    return await new Promise<number>((resolve, reject) => {
      const tx = db.transaction([FLOW_STORE, META_STORE], "readwrite");
      const flows = tx.objectStore(FLOW_STORE);
      const metadata = tx.objectStore(META_STORE);
      let removed = 0;
      const request = metadata.openCursor();
      request.onsuccess = () => {
        const cursor = request.result;
        if (!cursor) return;
        const entry = cursor.value as FlowMetadata;
        if (predicate(entry)) {
          flows.delete(entry.key);
          cursor.delete();
          removed++;
        }
        cursor.continue();
      };
      tx.oncomplete = () => resolve(removed);
      request.onerror = () => reject(request.error);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}
