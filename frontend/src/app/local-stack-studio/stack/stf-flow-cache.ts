import { STF_FARNEBACK_BASE_WINSIZE, STF_FARNEBACK_MIN_WINSIZE } from "./stf-farneback-winsize";

/** Best-effort session-owned bidirectional 4MP Farneback Flow cache.
 * Every valid pair remains available until its Canonical session is removed
 * or expires. IndexedDB's actual quota, not an application byte budget,
 * determines whether a write succeeds. No LRU or quota preflight is used.
 */
const FLOW_ALGORITHM_VERSION = "stf-gray4mp-farneback-f-adaptive-winsize-v3";

/** The alignment identifier describes processing parameters, never image content. */
export function stfFlowSessionKey(
  sessionId: string, previousImageId: number, nextImageId: number,
  alignmentKey: string, width: number, height: number, winsize = STF_FARNEBACK_BASE_WINSIZE,
): string | null {
  if (!sessionId || !alignmentKey ||
      !Number.isSafeInteger(previousImageId) || previousImageId < 0 ||
      !Number.isSafeInteger(nextImageId) || nextImageId < 0 ||
      previousImageId === nextImageId ||
      !Number.isSafeInteger(width * height) || width <= 0 || height <= 0 ||
      !Number.isSafeInteger(winsize) || winsize < STF_FARNEBACK_MIN_WINSIZE ||
      winsize > STF_FARNEBACK_BASE_WINSIZE || winsize % 2 === 0) return null;
  return JSON.stringify([sessionId, FLOW_ALGORITHM_VERSION,
    previousImageId, nextImageId, alignmentKey, width, height, winsize]);
}

const DB_NAME = "local-stack-studio-stf-flow";
// The session key contains the actual winsize, allowing reuse of valid
// prior Flow fields with the same window. Old v1/v2 fields are incompatible;
// clear them once on upgrade. V4 adds deletion tombstones.
const DB_VERSION = 4;
const FLOW_STORE = "pairs";
const META_STORE = "metadata";
const REMOVED_SESSION_STORE = "deleted-sessions";
const SESSION_RETENTION_MS = 1_800_000;

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
/** Diagnostics do not change the established best-effort boolean write API. */
export type StfFlowCacheSaveStatus =
  "admitted" | "quota-limit" | "session-deleted" | "invalid" | "error";
export type StfFlowCacheWriteDiagnostics = {
  status?: StfFlowCacheSaveStatus;
  incomingBytes?: number;
  // Commit includes IndexedDB's asynchronous clone/write work.
  validationMs?: number;
  putMs?: number;
  commitMs?: number;
};

function validateStfCachedFlowShape(
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
  return true;
}

/** Read hits must check every vector: IndexedDB contents are not trusted. */
export function validateStfCachedFlow(
  value: unknown, sessionId: string, width: number, height: number, now = Date.now(),
): value is FlowRecord {
  if (!validateStfCachedFlowShape(value, sessionId, width, height, now)) return false;
  const expected = width * height * 2;
  for (let i = 0; i < expected; i++) {
    if (!Number.isFinite(value.forward[i]) || !Number.isFinite(value.backward[i])) return false;
  }
  return true;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") { reject(new Error("IndexedDB unavailable")); return; }
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = (event) => {
      const db = request.result;
      if (event.oldVersion > 0 && event.oldVersion < 3) {
        if (db.objectStoreNames.contains(FLOW_STORE)) db.deleteObjectStore(FLOW_STORE);
        if (db.objectStoreNames.contains(META_STORE)) db.deleteObjectStore(META_STORE);
      }
      if (!db.objectStoreNames.contains(FLOW_STORE)) db.createObjectStore(FLOW_STORE, { keyPath: "key" });
      if (!db.objectStoreNames.contains(META_STORE)) db.createObjectStore(META_STORE, { keyPath: "key" });
      if (!db.objectStoreNames.contains(REMOVED_SESSION_STORE)) {
        db.createObjectStore(REMOVED_SESSION_STORE, { keyPath: "sessionId" });
      }
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

// Save the pair and its session metadata atomically. An IndexedDB quota
// failure simply makes this best-effort cache a miss on the next Process.
// Do not scan all metadata or evict other sessions to admit a new pair.
function storeFlow(
  db: IDBDatabase, record: FlowRecord,
  diagnostics?: StfFlowCacheWriteDiagnostics,
): Promise<boolean> {
  return new Promise((resolve, reject) => {
    let tx: IDBTransaction;
    try {
      tx = db.transaction([FLOW_STORE, META_STORE, REMOVED_SESSION_STORE], "readwrite", { durability: "relaxed" });
    } catch {
      tx = db.transaction([FLOW_STORE, META_STORE, REMOVED_SESSION_STORE], "readwrite");
    }
    let admitted = false;
    let enqueuedAt = 0;
    // Serialized with explicit deletion in the same IDB store transaction:
    // a late Worker cannot recreate an already deleted session's Flow.
    const check = tx.objectStore(REMOVED_SESSION_STORE).get(record.sessionId);
    check.onsuccess = () => {
      if (check.result) {
        if (diagnostics) diagnostics.status = "session-deleted";
        return;
      }
      const bytes = record.forward.byteLength + record.backward.byteLength;
      const putStarted = performance.now();
      tx.objectStore(FLOW_STORE).put(record);
      tx.objectStore(META_STORE).put({ key: record.key, sessionId: record.sessionId,
        bytes, createdAt: record.createdAt } satisfies FlowMetadata);
      enqueuedAt = performance.now();
      if (diagnostics) diagnostics.putMs = enqueuedAt - putStarted;
      admitted = true;
      tx.commit?.();
    };
    tx.oncomplete = () => {
      if (diagnostics && admitted) {
        diagnostics.status = "admitted";
        diagnostics.commitMs = performance.now() - enqueuedAt;
      }
      resolve(admitted);
    };
    check.onerror = () => reject(check.error);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

function isQuotaExceeded(error: unknown): boolean {
  return error instanceof Error && (error.name === "QuotaExceededError" || error.name === "NS_ERROR_DOM_QUOTA_REACHED");
}

export async function writeStfCachedFlow(
  sessionId: string, key: string, sessionCreatedAt: number,
  width: number, height: number,
  forward: Float32Array, backward: Float32Array,
  diagnostics?: StfFlowCacheWriteDiagnostics,
): Promise<boolean> {
  if (diagnostics) diagnostics.status = "invalid";
  if (!sessionId || !key) return false;
  // Keys must belong to this exact session, never a coincidentally equal image.
  if (!key.startsWith(`[${JSON.stringify(sessionId)},`)) return false;
  const record: FlowRecord = { key, sessionId, width, height,
    forward, backward, createdAt: sessionCreatedAt };
  if (!validateStfCachedFlowShape(record, sessionId, width, height)) return false;
  // Global cleanup expires even active sessions by their original creation
  // time. Prevent an old still-running Worker from repopulating an expired one.
  if (sessionCreatedAt <= Date.now() - SESSION_RETENTION_MS) {
    if (diagnostics) diagnostics.status = "session-deleted";
    return false;
  }
  if (diagnostics) diagnostics.incomingBytes = forward.byteLength + backward.byteLength;
  const validationStarted = performance.now();
  const valid = validateStfCachedFlow(record, sessionId, width, height);
  if (diagnostics) diagnostics.validationMs = performance.now() - validationStarted;
  if (!valid) return false;
  let db: IDBDatabase | null = null;
  try {
    db = await openDb();
    return await storeFlow(db, record, diagnostics);
  } catch (error) {
    if (diagnostics) diagnostics.status = isQuotaExceeded(error) ? "quota-limit" : "error";
    return false;
  } finally {
    db?.close();
  }
}

/** Removes only one identified session, regardless of its age. */
export async function deleteStfFlowSession(sessionId: string): Promise<number> {
  if (!sessionId) return 0;
  // Delete by session-key prefix in BOTH stores. This also removes orphan Flow
  // records whose small metadata entry is missing or corrupt.
  const db = await openDb();
  try {
    return await new Promise<number>((resolve, reject) => {
      const tx = db.transaction([FLOW_STORE, META_STORE, REMOVED_SESSION_STORE], "readwrite");
      tx.objectStore(REMOVED_SESSION_STORE).put({ sessionId, deletedAt: Date.now() });
      const prefix = `[${JSON.stringify(sessionId)},`;
      const range = IDBKeyRange.bound(prefix, `${prefix}\uffff`);
      let removed = 0;
      const cursorRequest = tx.objectStore(META_STORE).openCursor(range);
      cursorRequest.onsuccess = () => {
        const cursor = cursorRequest.result;
        if (!cursor) {
          tx.objectStore(FLOW_STORE).delete(range);
          tx.objectStore(META_STORE).delete(range);
          return;
        }
        removed++;
        cursor.continue();
      };
      tx.oncomplete = () => resolve(removed);
      cursorRequest.onerror = () => reject(cursorRequest.error);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

/** Called on new-session creation. Expire by session creation time, even if active. */
export async function purgeExpiredStfFlowSessions(cutoffAt: number): Promise<number> {
  return removeStfFlowRecords((entry) => !Number.isFinite(entry.createdAt) || entry.createdAt <= cutoffAt);
}

async function removeStfFlowRecords(predicate: (entry: FlowMetadata) => boolean): Promise<number> {
  const db = await openDb();
  try {
    return await new Promise<number>((resolve, reject) => {
      const tx = db.transaction([FLOW_STORE, META_STORE, REMOVED_SESSION_STORE], "readwrite");
      const flows = tx.objectStore(FLOW_STORE);
      const metadata = tx.objectStore(META_STORE);
      const deleted = tx.objectStore(REMOVED_SESSION_STORE);
      // Prune old tombstones; expired sessions cannot write again because of
      // their immutable createdAt, even after their tombstone is removed.
      const tombstones = deleted.openCursor();
      tombstones.onsuccess = () => {
        const cursor = tombstones.result;
        if (!cursor) return;
        const value = cursor.value as { sessionId: string; deletedAt: number };
        if (!Number.isFinite(value.deletedAt) || value.deletedAt <= Date.now() - SESSION_RETENTION_MS) {
          cursor.delete();
        }
        cursor.continue();
      };
      let removed = 0;
      const request = metadata.openCursor();
      request.onsuccess = () => {
        const cursor = request.result;
        if (!cursor) return;
        const entry = cursor.value as FlowMetadata;
        if (predicate(entry)) {
          flows.delete(entry.key);
          deleted.put({ sessionId: entry.sessionId, deletedAt: Date.now() });
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
