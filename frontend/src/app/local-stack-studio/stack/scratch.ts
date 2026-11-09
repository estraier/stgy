const STACK_SCRATCH_DB_NAME = "local-stack-studio-median-scratch";
const STACK_SCRATCH_DB_VERSION = 1;
const STACK_SCRATCH_STORE = "tiles";

// Scratch keys are sorted by session ID. New IDs start with a fixed-width
// creation timestamp so expired tiles can be deleted via a key range, with no
// extra metadata writes and no tile/Blob reads. Pre-existing UUID keys are
// intentionally excluded (the user will clear those caches manually).
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

export function createStackScratchSessionId(): string {
  const nonce = globalThis.crypto && typeof globalThis.crypto.randomUUID === "function"
    ? globalThis.crypto.randomUUID()
    : Math.random().toString(36).slice(2);
  return stackScratchSessionIdAt(Date.now(), nonce);
}

export async function purgeExpiredStackScratchSessions(cutoffAt: number): Promise<void> {
  const upperKey = stackScratchExpiryUpperKey(cutoffAt);
  const db = await openStackScratchDb("LSS scratch cache cleanup");
  try {
    await new Promise<void>((resolve, reject) => {
      let tx: IDBTransaction;
      try { tx = db.transaction(STACK_SCRATCH_STORE, "readwrite"); }
      catch (error) { reject(error); return; }
      // No session metadata scan and no tile buffers are materialized.
      tx.objectStore(STACK_SCRATCH_STORE).delete(IDBKeyRange.bound(TIMED_SCRATCH_PREFIX, upperKey));
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
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STACK_SCRATCH_STORE)) {
        db.createObjectStore(STACK_SCRATCH_STORE);
      }
    };
    request.onsuccess = () => resolve(request.result);
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
  return new Promise((resolve, reject) => {
    let transaction: IDBTransaction;
    try {
      transaction = db.transaction(STACK_SCRATCH_STORE, "readwrite");
      const store = transaction.objectStore(STACK_SCRATCH_STORE);
      for (const entry of entries) store.put(entry.buffer, entry.key);
    } catch (error) {
      reject(error);
      return;
    }
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error || new Error(`Could not write ${label}.`));
    transaction.onabort = () => reject(transaction.error || new Error(`${label} write was aborted.`));
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
