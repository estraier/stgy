/** Best-effort persistent bidirectional 4MP Farneback Flow cache.
 * Every record belongs to a Canonical input session. Re-selecting files starts
 * a new session, even when the files contain identical pixels. No file hash,
 * WebCrypto, or cross-session content-based reuse is involved.
 */
export const STF_FLOW_CACHE_MAX_BYTES = 512 * 1024 * 1024;
const FLOW_ALGORITHM_VERSION = "stf-gray4mp-farneback-fixed-session-v2";

/** The alignment identifier describes processing parameters, never image content. */
export function stfFlowSessionKey(
  sessionId: string, previousImageId: number, nextImageId: number,
  alignmentKey: string, width: number, height: number,
): string | null {
  if (!sessionId || !alignmentKey ||
      !Number.isSafeInteger(previousImageId) || previousImageId < 0 ||
      !Number.isSafeInteger(nextImageId) || nextImageId < 0 ||
      previousImageId === nextImageId ||
      !Number.isSafeInteger(width * height) || width <= 0 || height <= 0) return null;
  return JSON.stringify([sessionId, FLOW_ALGORITHM_VERSION,
    previousImageId, nextImageId, alignmentKey, width, height]);
}

const DB_NAME = "local-stack-studio-stf-flow";
// Old v1 content-addressed records are discarded on upgrade, not migrated.
const DB_VERSION = 2;
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
type FlowMetadata = { key: string; sessionId: string; bytes: number; createdAt: number; accessedAt: number };
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

function touchRecord(db: IDBDatabase, record: FlowRecord): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(META_STORE, "readwrite");
    tx.objectStore(META_STORE).put({
      key: record.key, sessionId: record.sessionId,
      bytes: record.forward.byteLength + record.backward.byteLength,
      createdAt: record.createdAt, accessedAt: Date.now(),
    } satisfies FlowMetadata);
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
    await touchRecord(db, record).catch(() => {});
    return { forward: record.forward, backward: record.backward };
  } catch {
    return null;
  } finally {
    db?.close();
  }
}

// Metadata cursor only: never deserialize all the large Flow buffers.
function storeWithEviction(db: IDBDatabase, record: FlowRecord, maxBytes: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction([FLOW_STORE, META_STORE], "readwrite");
    const flows = tx.objectStore(FLOW_STORE);
    const metadata = tx.objectStore(META_STORE);
    const entries: FlowMetadata[] = [];
    const request = metadata.openCursor();
    request.onsuccess = () => {
      const cursor = request.result;
      if (cursor) { entries.push(cursor.value as FlowMetadata); cursor.continue(); return; }
      const now = Date.now();
      const incomingBytes = record.forward.byteLength + record.backward.byteLength;
      let total = incomingBytes;
      const retained = entries.filter((entry) => {
        const invalid = !entry.sessionId || !Number.isFinite(entry.createdAt) ||
          entry.createdAt > now || !Number.isFinite(entry.bytes) || entry.bytes <= 0;
        if (invalid || entry.key === record.key) {
          flows.delete(entry.key);
          metadata.delete(entry.key);
          return false;
        }
        total += entry.bytes;
        return true;
      });
      retained.sort((a, b) => a.accessedAt - b.accessedAt);
      for (const entry of retained) {
        if (total <= maxBytes) break;
        flows.delete(entry.key);
        metadata.delete(entry.key);
        total -= entry.bytes;
      }
      flows.put(record);
      metadata.put({ key: record.key, sessionId: record.sessionId,
        bytes: incomingBytes, createdAt: record.createdAt, accessedAt: now } satisfies FlowMetadata);
    };
    tx.oncomplete = () => resolve();
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
    await storeWithEviction(db, record, maxBytes);
    return true;
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
