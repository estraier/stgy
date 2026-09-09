const STACK_SCRATCH_DB_NAME = "local-stack-studio-median-scratch";
const STACK_SCRATCH_DB_VERSION = 1;
const STACK_SCRATCH_STORE = "tiles";

export function createStackScratchSessionId(): string {
  if (globalThis.crypto && typeof globalThis.crypto.randomUUID === "function") {
    return globalThis.crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
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

export function putStackScratchBuffer(
  db: IDBDatabase,
  key: string,
  buffer: ArrayBuffer,
  label = "scratch tile",
): Promise<void> {
  return new Promise((resolve, reject) => {
    let transaction: IDBTransaction;
    try {
      transaction = db.transaction(STACK_SCRATCH_STORE, "readwrite");
      transaction.objectStore(STACK_SCRATCH_STORE).put(buffer, key);
    } catch (error) {
      reject(error);
      return;
    }
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error || new Error(`Could not write ${label}.`));
    transaction.onabort = () => reject(transaction.error || new Error(`${label} write was aborted.`));
  });
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
    const request = store.openCursor(range);
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) return;
      cursor.delete();
      cursor.continue();
    };
    request.onerror = () => reject(request.error || new Error("Could not enumerate stack scratch tiles."));
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error || new Error("Could not clear stack scratch tiles."));
    transaction.onabort = () => reject(transaction.error || new Error("Stack scratch cleanup was aborted."));
  });
}
