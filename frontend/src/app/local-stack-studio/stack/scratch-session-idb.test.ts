import {
  createStackScratchSessionId, deleteStackScratchCanonicalSession, getStackScratchBuffers,
  openStackScratchDb, purgeExpiredStackScratchSessions, putStackScratchBuffer,
} from "./scratch";

/** Realistic key-only cursor and key-range IndexedDB stub. It never loads any
 * scratch buffer when sweeping sessions, and preserves records of other tabs. */
function withScratchIndexedDb() {
  const originalIdb = Object.getOwnPropertyDescriptor(globalThis, "indexedDB");
  const originalRange = Object.getOwnPropertyDescriptor(globalThis, "IDBKeyRange");
  const records = new Map<string, ArrayBuffer>();
  const tombstones = new Map<string, { sessionId: string; deletedAt: number }>();
  let upgraded = false;
  let keyCursorCount = 0;
  let bufferReadCount = 0;
  const inRange = (key: string, range?: { lower: string; upper: string }) =>
    !range || (key >= range.lower && key <= range.upper);
  const db = {
    objectStoreNames: { contains: () => true },
    createObjectStore: () => {},
    close: () => {},
    transaction() {
      let pending = 0;
      let completed = false;
      let aborted = false;
      const tx = {
        oncomplete: null as null | (() => void),
        onerror: null as null | (() => void),
        onabort: null as null | (() => void),
        error: null,
        abort() { aborted = true; queueMicrotask(() => tx.onabort?.()); },
        objectStore(name: string) {
          const store = name === "deleted-sessions" ? tombstones : records;
          const schedule = (work: () => void) => {
            pending++;
            queueMicrotask(() => {
              if (!aborted) work();
              pending--;
              if (!aborted && !completed && pending === 0) {
                completed = true;
                queueMicrotask(() => tx.oncomplete?.());
              }
            });
          };
          return {
            put(buffer: ArrayBuffer | { sessionId: string; deletedAt: number }, key?: string) {
              const actualKey = key ?? (buffer as { sessionId: string }).sessionId;
              schedule(() => (store as Map<string, unknown>).set(actualKey,
                buffer instanceof ArrayBuffer ? buffer.slice(0) : { ...buffer }));
            },
            get(key: string) {
              if (name === "tiles") bufferReadCount++;
              const req = { result: undefined as ArrayBuffer | undefined,
                onsuccess: null as null | (() => void) };
              schedule(() => {
                const result = store.get(key);
                req.result = result instanceof ArrayBuffer ? result.slice(0) : result as ArrayBuffer | undefined;
                req.onsuccess?.();
              });
              return req;
            },
            delete(key: { lower: string; upper: string } | string) {
              schedule(() => {
                if (typeof key === "string") store.delete(key);
                else for (const entry of [...store.keys()]) if (inRange(entry, key)) store.delete(entry);
              });
            },
            openKeyCursor(range?: { lower: string; upper: string }) {
              if (name === "tiles") keyCursorCount++;
              const keys = [...store.keys()].filter((key) => inRange(key, range));
              let index = 0;
              const req = { result: null as null | {
                primaryKey: string; value?: unknown; delete: () => void; continue: () => void;
              }, onsuccess: null as null | (() => void), onerror: null as null | (() => void) };
              const next = () => schedule(() => {
                const key = keys[index++];
                req.result = key === undefined ? null : {
                  primaryKey: key, value: store.get(key),
                  delete: () => schedule(() => { store.delete(key); }),
                  continue: next,
                };
                req.onsuccess?.();
              });
              next();
              return req;
            },
            openCursor(range?: { lower: string; upper: string }) {
              return this.openKeyCursor(range);
            },
          };
        },
      };
      return tx;
    },
  };
  Object.defineProperty(globalThis, "IDBKeyRange", { configurable: true,
    value: { bound: (lower: string, upper: string) => ({ lower, upper }) } });
  Object.defineProperty(globalThis, "indexedDB", { configurable: true, value: {
    open: () => {
      const req = { result: db, onupgradeneeded: null as null | ((event: IDBVersionChangeEvent) => void),
        onsuccess: null as null | (() => void), onerror: null as null | (() => void),
        onblocked: null as null | (() => void) };
      queueMicrotask(() => {
        if (!upgraded) { upgraded = true; req.onupgradeneeded?.({ oldVersion: 0 } as IDBVersionChangeEvent); }
        req.onsuccess?.();
      });
      return req;
    },
  } });
  return { records, get keyCursorCount() { return keyCursorCount; },
    get bufferReadCount() { return bufferReadCount; },
    restore() {
      if (originalIdb) Object.defineProperty(globalThis, "indexedDB", originalIdb);
      else Reflect.deleteProperty(globalThis, "indexedDB");
      if (originalRange) Object.defineProperty(globalThis, "IDBKeyRange", originalRange);
      else Reflect.deleteProperty(globalThis, "IDBKeyRange");
    },
  };
}

test("scratch is owned by Canonical session and immediate deletion does not touch another tab", async () => {
  const fake = withScratchIndexedDb();
  try {
    const now = Date.now();
    const a = createStackScratchSessionId("tab-a", now - 1000);
    const b = createStackScratchSessionId("tab-b", now);
    const db = await openStackScratchDb();
    await putStackScratchBuffer(db, `${a}:f`, new ArrayBuffer(128));
    await putStackScratchBuffer(db, `${a}:g`, new ArrayBuffer(128));
    await putStackScratchBuffer(db, `${b}:f`, new ArrayBuffer(128));
    expect(await deleteStackScratchCanonicalSession("tab-a")).toBe(2);
    expect(fake.records.size).toBe(1);
    await expect(putStackScratchBuffer(db, `${a}:late`, new ArrayBuffer(16))).rejects.toThrow();
    expect(fake.records.size).toBe(1);
    expect(await getStackScratchBuffers(db, [`${b}:f`], "other tab")).toHaveLength(1);
    expect(fake.keyCursorCount).toBe(1);
    expect(fake.bufferReadCount).toBe(1); // Only the explicit read, not cleanup.
    db.close();
  } finally { fake.restore(); }
});

test("global expiry removes scratch by parent session creation time, not scratch job time", async () => {
  const fake = withScratchIndexedDb();
  try {
    const now = Date.now();
    const old = createStackScratchSessionId("old", now - 1000);
    const newKey = createStackScratchSessionId("new", now - 999);
    const db = await openStackScratchDb();
    await putStackScratchBuffer(db, `${old}:f`, new ArrayBuffer(32));
    await putStackScratchBuffer(db, `${newKey}:f`, new ArrayBuffer(32));
    await purgeExpiredStackScratchSessions(now - 1000);
    expect(fake.records.has(`${old}:f`)).toBe(false);
    expect(fake.records.has(`${newKey}:f`)).toBe(true);
    expect(fake.bufferReadCount).toBe(0);
    db.close();
  } finally { fake.restore(); }
});
