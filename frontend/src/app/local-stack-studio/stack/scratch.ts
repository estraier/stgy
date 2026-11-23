const STACK_SCRATCH_DB_NAME = "local-stack-studio-median-scratch";
const STACK_SCRATCH_DB_VERSION = 3;
const REMOVED_SESSION_STORE = "deleted-sessions";
const SCRATCH_SESSION_RETENTION_MS = 1_800_000;
const STACK_SCRATCH_STORE = "tiles";

// Scratch keys start with the PARENT Canonical session's creation timestamp,
// then its ID and an operation nonce. This permits both 1800s global expiry
// (one IDB key range) and immediate per-Canonical-session deletion (key-only
// cursor), without reading large scratch buffers or touching other sessions.
const TIMED_SCRATCH_PREFIX = "s2-";
const TIMESTAMP_WIDTH = 13;

export function stackScratchSessionIdAt(createdAt: number, nonce: string): string {
  if (!Number.isSafeInteger(createdAt) || createdAt < 0) {
    throw new Error("Invalid scratch session creation timestamp.");
  }
  return `${TIMED_SCRATCH_PREFIX}${String(createdAt).padStart(TIMESTAMP_WIDTH, "0")}-${nonce}`;
}

export function stackScratchExpiryUpperKey(cutoffAt: number): string {
  if (!Number.isSafeInteger(cutoffAt) || cutoffAt < 0) {
    throw new Error("Invalid scratch expiration timestamp.");
  }
  return `${TIMED_SCRATCH_PREFIX}${String(cutoffAt).padStart(TIMESTAMP_WIDTH, "0")}\uffff`;
}

export function createStackScratchSessionId(canonicalSessionId: string, canonicalCreatedAt: number): string {
  if (!canonicalSessionId) throw new Error("Scratch requires a Canonical parent session.");
  const nonce = globalThis.crypto && typeof globalThis.crypto.randomUUID === "function"
    ? globalThis.crypto.randomUUID()
    : Math.random().toString(36).slice(2);
  return stackScratchSessionIdAt(canonicalCreatedAt, `${encodeURIComponent(canonicalSessionId)}:${nonce}`);
}

function scratchKeyOwner(key: string): { sessionId: string; createdAt: number } | null {
  const match = /^s2-(\d{13})-([^:]+):/.exec(key);
  if (!match) return null;
  try {
    return { sessionId: decodeURIComponent(match[2]), createdAt: Number(match[1]) };
  } catch {
    return null;
  }
}

export function stackScratchKeyBelongsToCanonicalSession(key: IDBValidKey, sessionId: string): boolean {
  // The colon after the encoded owner prevents prefix collisions between IDs.
  return typeof key === "string" && /^s2-\d{13}-/.test(key) &&
    key.slice(TIMED_SCRATCH_PREFIX.length + TIMESTAMP_WIDTH + 1)
      .startsWith(`${encodeURIComponent(sessionId)}:`);
}

/** Clear all Focus/Additional Blur scratch jobs belonging to one Canonical session.
 * openKeyCursor never loads scratch ArrayBuffers from IndexedDB. */
export async function deleteStackScratchCanonicalSession(sessionId: string): Promise<number> {
  if (!sessionId) return 0;
  const db = await openStackScratchDb("LSS prior-session scratch cleanup");
  try {
    return await new Promise<number>((resolve, reject) => {
      const tx = db.transaction([STACK_SCRATCH_STORE, REMOVED_SESSION_STORE], "readwrite");
      tx.objectStore(REMOVED_SESSION_STORE).put({ sessionId, deletedAt: Date.now() });
      let removed = 0;
      const request = tx.objectStore(STACK_SCRATCH_STORE).openKeyCursor(
        IDBKeyRange.bound(TIMED_SCRATCH_PREFIX, `${TIMED_SCRATCH_PREFIX}\uffff`));
      request.onsuccess = () => {
        const cursor = request.result;
        if (!cursor) return;
        if (stackScratchKeyBelongsToCanonicalSession(cursor.primaryKey, sessionId)) {
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

export async function purgeExpiredStackScratchSessions(cutoffAt: number): Promise<void> {
  const upperKey = stackScratchExpiryUpperKey(cutoffAt);
  const db = await openStackScratchDb("LSS scratch cache cleanup");
  try {
    await new Promise<void>((resolve, reject) => {
      let tx: IDBTransaction;
      try { tx = db.transaction([STACK_SCRATCH_STORE, REMOVED_SESSION_STORE], "readwrite"); }
      catch (error) { reject(error); return; }
      // No tile buffers are materialized. Retain recent tombstones to reject
      // writes from workers that finish after immediate session deletion.
      tx.objectStore(STACK_SCRATCH_STORE).delete(IDBKeyRange.bound(TIMED_SCRATCH_PREFIX, upperKey));
      const tombstones = tx.objectStore(REMOVED_SESSION_STORE).openCursor();
      tombstones.onsuccess = () => {
        const cursor = tombstones.result;
        if (!cursor) return;
        const entry = cursor.value as { sessionId: string; deletedAt: number };
        if (!Number.isFinite(entry.deletedAt) || entry.deletedAt <= cutoffAt) cursor.delete();
        cursor.continue();
      };
      tombstones.onerror = () => reject(tombstones.error);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error || new Error("Could not purge expired LSS scratch tiles."));
      tx.onabort = () => reject(tx.error || new Error("LSS scratch expiration cleanup was aborted."));
    });
  } finally {
    db.close();
  }
}

export function openStackScratchDb(purpose = "Local Stack Studio"): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (!("indexedDB" in globalThis)) {
      reject(new Error(`${purpose} requires IndexedDB support in this browser.`));
      return;
    }
    const request = indexedDB.open(STACK_SCRATCH_DB_NAME, STACK_SCRATCH_DB_VERSION);
    request.onupgradeneeded = (event) => {
      const db = request.result;
      // V1/V2 scratch keys predate Canonical-parent ownership. Discard the
      // ephemeral old store once on upgrade; otherwise old data cannot be
      // safely deleted by session ID.
      if (event.oldVersion > 0 && event.oldVersion < 3 &&
          db.objectStoreNames.contains(STACK_SCRATCH_STORE)) db.deleteObjectStore(STACK_SCRATCH_STORE);
      if (!db.objectStoreNames.contains(STACK_SCRATCH_STORE)) {
        db.createObjectStore(STACK_SCRATCH_STORE);
      }
      if (!db.objectStoreNames.contains(REMOVED_SESSION_STORE)) {
        db.createObjectStore(REMOVED_SESSION_STORE, { keyPath: "sessionId" });
      }
    };
    request.onsuccess = () => {
      const db = request.result;
      db.onversionchange = () => db.close();
      resolve(db);
    };
    request.onerror = () => reject(request.error || new Error("Could not open IndexedDB scratch space."));
    request.onblocked = () => reject(new Error("IndexedDB scratch space is blocked by another Local Stack Studio tab."));
  });
}

export function stackRgbTileKey(
  sessionId: string,
  imageIndex: number,
  tileX: number,
  tileY: number,
): string {
  return `${sessionId}:${imageIndex}:${tileY}:${tileX}`;
}

export type StackScratchBufferWrite = {
  key: string;
  buffer: ArrayBuffer;
};

export function putStackScratchBuffers(
  db: IDBDatabase,
  entries: readonly StackScratchBufferWrite[],
  label = "scratch tiles",
): Promise<void> {
  if (entries.length === 0) return Promise.resolve();
  const owner = scratchKeyOwner(entries[0].key);
  if (!owner || entries.some((entry) => {
    const itemOwner = scratchKeyOwner(entry.key);
    return itemOwner?.sessionId !== owner.sessionId || itemOwner.createdAt !== owner.createdAt;
  })) return Promise.reject(new Error(`${label} must belong to one Canonical session.`));
  if (owner.createdAt <= Date.now() - SCRATCH_SESSION_RETENTION_MS) {
    return Promise.reject(new Error(`${label} belongs to an expired Canonical session.`));
  }
  return new Promise((resolve, reject) => {
    let transaction: IDBTransaction;
    try {
      transaction = db.transaction([STACK_SCRATCH_STORE, REMOVED_SESSION_STORE], "readwrite");
      const check = transaction.objectStore(REMOVED_SESSION_STORE).get(owner.sessionId);
      check.onsuccess = () => {
        if (check.result) {
          transaction.abort();
          return;
        }
        const store = transaction.objectStore(STACK_SCRATCH_STORE);
        for (const entry of entries) store.put(entry.buffer, entry.key);
      };
      check.onerror = () => reject(check.error || new Error(`Could not verify ${label} session.`));
    } catch (error) {
      reject(error);
      return;
    }
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error || new Error(`Could not write ${label}.`));
    transaction.onabort = () => reject(transaction.error || new Error(`${label} session was deleted.`));
  });
}

export function putStackScratchBuffer(
  db: IDBDatabase,
  key: string,
  buffer: ArrayBuffer,
  label = "scratch tile",
): Promise<void> {
  return putStackScratchBuffers(db, [{ key, buffer }], label);
}

export function getStackScratchBuffers(
  db: IDBDatabase,
  keys: string[],
  label: string,
): Promise<ArrayBuffer[]> {
  return new Promise((resolve, reject) => {
    let transaction: IDBTransaction;
    try {
      transaction = db.transaction(STACK_SCRATCH_STORE, "readonly");
    } catch (error) {
      reject(error);
      return;
    }
    const store = transaction.objectStore(STACK_SCRATCH_STORE);
    const buffers: Array<ArrayBuffer | undefined> = new Array(keys.length);
    let failed = false;
    keys.forEach((key, index) => {
      const request = store.get(key);
      request.onsuccess = () => {
        buffers[index] = request.result;
      };
      request.onerror = () => {
        failed = true;
      };
    });
    transaction.oncomplete = () => {
      if (failed || buffers.some((buffer) => !(buffer instanceof ArrayBuffer))) {
        reject(new Error(`${label} is incomplete.`));
        return;
      }
      resolve(buffers as ArrayBuffer[]);
    };
    transaction.onerror = () => reject(transaction.error || new Error(`Could not read ${label}.`));
    transaction.onabort = () => reject(transaction.error || new Error(`${label} read was aborted.`));
  });
}

export async function getStackRgbTiles(
  db: IDBDatabase,
  sessionId: string,
  imageCount: number,
  tileX: number,
  tileY: number,
): Promise<Uint16Array[]> {
  const keys = Array.from({ length: imageCount }, (_, imageIndex) =>
    stackRgbTileKey(sessionId, imageIndex, tileX, tileY),
  );
  const buffers = await getStackScratchBuffers(db, keys, `Median scratch tile ${tileX},${tileY}`);
  return buffers.map((buffer) => new Uint16Array(buffer));
}

export function deleteStackScratchBuffers(
  db: IDBDatabase,
  keys: readonly string[],
  label = "scratch buffers",
): Promise<void> {
  if (keys.length === 0) return Promise.resolve();
  return new Promise((resolve, reject) => {
    let transaction: IDBTransaction;
    try {
      transaction = db.transaction(STACK_SCRATCH_STORE, "readwrite");
      const store = transaction.objectStore(STACK_SCRATCH_STORE);
      for (const key of keys) store.delete(key);
    } catch (error) {
      reject(error);
      return;
    }
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error || new Error(`Could not delete ${label}.`));
    transaction.onabort = () => reject(transaction.error || new Error(`${label} deletion was aborted.`));
  });
}

export function deleteStackScratchSession(db: IDBDatabase, sessionId: string): Promise<void> {
  return new Promise((resolve, reject) => {
    let transaction: IDBTransaction;
    try {
      transaction = db.transaction(STACK_SCRATCH_STORE, "readwrite");
    } catch (error) {
      reject(error);
      return;
    }
    const store = transaction.objectStore(STACK_SCRATCH_STORE);
    const prefix = `${sessionId}:`;
    const range = IDBKeyRange.bound(prefix, `${prefix}\uffff`);
    store.delete(range);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error || new Error("Could not clear stack scratch tiles."));
    transaction.onabort = () => reject(transaction.error || new Error("Stack scratch cleanup was aborted."));
  });
}
