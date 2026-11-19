import { deleteStfFlowSession, purgeExpiredStfFlowSessions, stfFlowSessionKey,
  readStfCachedFlow, writeStfCachedFlow } from "./stf-flow-cache";

/** Minimal async IndexedDB simulation of the two stores this cache uses.
 * Tests actual read/admission/explicit-deletion transactions without a browser or WASM.
 */
/** Clone values in the Jest test realm. Jest's host-provided structuredClone
 * can create Float32Arrays from a different VM realm; unlike real IndexedDB,
 * those arrays fail the cache's `instanceof Float32Array` validation.
 * The fake stores only plain objects and Float32Array vectors.
 */
function cloneStoredValue<T>(value: T): T {
  if (value === null || typeof value !== "object") return value;
  if (value instanceof Float32Array) return new Float32Array(value) as T;
  if (Array.isArray(value)) return value.map(cloneStoredValue) as T;
  return Object.fromEntries(
    Object.entries(value).map(([key, part]) => [key, cloneStoredValue(part)]),
  ) as T;
}

function useMemoryIndexedDb(legacyVersion: 0 | 1 | 2 = 0) {
  const original = Object.getOwnPropertyDescriptor(globalThis, "indexedDB");
  const tables = new Map<string, Map<string, unknown>>();
  if (legacyVersion) {
    tables.set("pairs", new Map([["old-content-address", { key: "old-content-address" }]]));
    tables.set("metadata", new Map([["old-content-address", { key: "old-content-address" }]]));
  }
  let upgraded = false;
  const database = {
    get objectStoreNames() { return { contains: (name: string) => tables.has(name) }; },
    createObjectStore(name: string) { tables.set(name, new Map()); },
    deleteObjectStore(name: string) { tables.delete(name); },
    close() {},
    onversionchange: null as null | (() => void),
    transaction(_names: string[], _mode: string) {
      let pending = 0;
      let completed = false;
      const tx = {
        oncomplete: null as null | (() => void),
        onerror: null as null | (() => void),
        onabort: null as null | (() => void),
        error: null,
        objectStore(name: string) {
          const store = tables.get(name);
          if (!store) throw new Error("Unknown fake IndexedDB store");
          const schedule = (fn: () => void) => {
            pending++;
            queueMicrotask(() => {
              fn();
              pending--;
              if (pending === 0 && !completed) {
                completed = true;
                queueMicrotask(() => tx.oncomplete?.());
              }
            });
          };
          return {
            get(key: string) {
              const request = { result: undefined as unknown, onsuccess: null as null | (() => void),
                onerror: null as null | (() => void) };
              schedule(() => { request.result = cloneStoredValue(store.get(key)); request.onsuccess?.(); });
              return request;
            },
            put(value: { key: string }) {
              schedule(() => store.set(value.key, cloneStoredValue(value)));
            },
            delete(key: string) {
              schedule(() => { store.delete(key); });
            },
            openCursor() {
              const keys = [...store.keys()];
              let i = 0;
              const request = { result: null as null | { value: unknown; continue: () => void; delete: () => void },
                onsuccess: null as null | (() => void), onerror: null as null | (() => void) };
              const next = () => schedule(() => {
                const key = keys[i++];
                request.result = key === undefined ? null : {
                  value: cloneStoredValue(store.get(key)), continue: () => next(),
                  delete: () => schedule(() => store.delete(key)),
                };
                request.onsuccess?.();
              });
              next();
              return request;
            },
          };
        },
      };
      return tx;
    },
  };
  Object.defineProperty(globalThis, "indexedDB", {
    configurable: true,
    value: {
      open: () => {
        const request = { result: database, onupgradeneeded: null as null | ((event: IDBVersionChangeEvent) => void),
          onsuccess: null as null | (() => void), onerror: null as null | (() => void),
          onblocked: null as null | (() => void), error: null };
        queueMicrotask(() => {
          if (!upgraded) {
            request.onupgradeneeded?.({ oldVersion: legacyVersion } as IDBVersionChangeEvent);
            upgraded = true;
          }
          request.onsuccess?.();
        });
        return request;
      },
    },
  });
  return {
    tables,
    restore() {
      if (original) Object.defineProperty(globalThis, "indexedDB", original);
      else Reflect.deleteProperty(globalThis, "indexedDB");
    },
  };
}

test("Farneback winsize separates session Flow cache keys", () => {
  const base = ["session-1", 0, 1, "align", 2, 2] as const;
  const oldWindow = stfFlowSessionKey(...base, 21);
  const openingWindow = stfFlowSessionKey(...base, 31);
  const nextWindow = stfFlowSessionKey(...base, 29);
  expect(oldWindow).not.toBeNull();
  expect(new Set([oldWindow, openingWindow, nextWindow]).size).toBe(3);
  expect(stfFlowSessionKey(...base, 101)).toBeNull();
  expect(stfFlowSessionKey(...base, 201)).toBeNull();
  expect(stfFlowSessionKey(...base, 203)).toBeNull();
  expect(stfFlowSessionKey(...base, 22)).toBeNull();
});

test("IndexedDB retains cached pairs, skips over-budget writes, and frees space on session deletion", async () => {
  const fake = useMemoryIndexedDb();
  const forward = Float32Array.from([1.25, -0.5, 0, 0, 2.5, 3, 0, 0]);
  const backward = Float32Array.from([-1.25, 0.5, 0, 0, -2.5, -3, 0, 0]);
  try {
    const a = stfFlowSessionKey("session-1", 0, 1, "align", 2, 2)!;
    const b = stfFlowSessionKey("session-1", 1, 2, "align", 2, 2)!;
    const c = stfFlowSessionKey("session-2", 0, 1, "align", 2, 2)!;
    const createdAt = Date.now();
    expect(await readStfCachedFlow("session-1", a, 2, 2)).toBeNull();
    expect(await writeStfCachedFlow("session-1", a, createdAt, 2, 2, forward, backward, 128)).toBe(true);
    const recovered = await readStfCachedFlow("session-1", a, 2, 2);
    expect(Array.from(recovered?.forward || [])).toEqual(Array.from(forward));
    expect(Array.from(recovered?.backward || [])).toEqual(Array.from(backward));
    expect(recovered?.forward).not.toBe(forward);
    expect(fake.tables.get("pairs")?.size).toBe(1);
    expect(await writeStfCachedFlow("session-1", b, createdAt, 2, 2, forward, backward, 128)).toBe(true);
    // The cache is now full. The third pair must not evict either of the two
    // first pairs, even if the first pair was accessed long ago.
    expect(await writeStfCachedFlow("session-2", c, createdAt, 2, 2, forward, backward, 128)).toBe(false);
    expect(fake.tables.get("pairs")?.size).toBe(2);
    expect(await readStfCachedFlow("session-1", a, 2, 2)).not.toBeNull();
    expect(await readStfCachedFlow("session-1", b, 2, 2)).not.toBeNull();
    expect(await readStfCachedFlow("session-2", c, 2, 2)).toBeNull();
    expect(await readStfCachedFlow("session-1", c, 2, 2)).toBeNull();
    // Updating an existing key only accounts for its replacement size.
    const replacement = Float32Array.from([0, 0, 0, 0, 0, 0, 0, 0]);
    expect(await writeStfCachedFlow("session-1", a, createdAt, 2, 2,
      replacement, backward, 128)).toBe(true);
    expect(Array.from((await readStfCachedFlow("session-1", a, 2, 2))!.forward)).toEqual(Array.from(replacement));
    expect(await writeStfCachedFlow("session-1", a, createdAt, 2, 2, forward, backward, 32)).toBe(false);
    expect(await deleteStfFlowSession("session-1")).toBe(2);
    expect(fake.tables.get("pairs")?.size).toBe(0);
    // Explicit deletion creates space: new pairs may be admitted again.
    expect(await writeStfCachedFlow("session-2", c, createdAt, 2, 2, forward, backward, 128)).toBe(true);
    expect(await purgeExpiredStfFlowSessions(createdAt)).toBe(1);
    expect(fake.tables.get("pairs")?.size).toBe(0);
  } finally {
    fake.restore();
  }
});

test("sequential re-merges have stable Flow hits, not cyclic LRU cache misses", async () => {
  const fake = useMemoryIndexedDb();
  const flow = new Float32Array(8); // Each bidirectional pair is 64 bytes.
  const now = Date.now();
  const keys = Array.from({ length: 5 }, (_, i) =>
    stfFlowSessionKey("same-session", i, i + 1, "align", 2, 2)!);
  try {
    for (let pass = 0; pass < 3; pass++) {
      let hits = 0;
      let admissions = 0;
      for (const key of keys) {
        if (await readStfCachedFlow("same-session", key, 2, 2)) {
          hits++;
        } else if (await writeStfCachedFlow("same-session", key,
          now, 2, 2, flow, flow, 192)) {
          admissions++;
        }
      }
      expect({ hits, admissions }).toEqual(pass === 0
        ? { hits: 0, admissions: 3 }
        : { hits: 3, admissions: 0 });
      expect(fake.tables.get("pairs")?.size).toBe(3);
      expect([...fake.tables.get("pairs")!.keys()]).toEqual(keys.slice(0, 3));
    }
  } finally { fake.restore(); }
});

test("reads are read-only, including legacy v2 metadata containing accessedAt", async () => {
  const fake = useMemoryIndexedDb();
  const now = Date.now();
  const flow = new Float32Array(8);
  const key = stfFlowSessionKey("same-session", 0, 1, "align", 2, 2)!;
  try {
    expect(await writeStfCachedFlow("same-session", key, now, 2, 2, flow, flow, 128)).toBe(true);
    const metadata = fake.tables.get("metadata")!;
    expect(metadata.get(key)).toEqual({ key, sessionId: "same-session", bytes: 64, createdAt: now });
    // A real v2 cache can already contain LRU timestamps; never rewrite them.
    metadata.set(key, { ...(metadata.get(key) as object), accessedAt: now - 60_000 });
    const before = cloneStoredValue(metadata.get(key));
    for (let i = 0; i < 3; i++) {
      expect(await readStfCachedFlow("same-session", key, 2, 2)).not.toBeNull();
      expect(metadata.get(key)).toEqual(before);
    }
    expect(fake.tables.get("pairs")?.size).toBe(1);
  } finally { fake.restore(); }
});


test("new-session expiration removes only Flow records at least 1800 seconds old", async () => {
  const fake = useMemoryIndexedDb();
  const now = Date.now();
  const vectors = new Float32Array(8);
  const oldKey = stfFlowSessionKey("old", 0, 1, "align", 2, 2)!;
  const newKey = stfFlowSessionKey("new", 0, 1, "align", 2, 2)!;
  try {
    expect(await writeStfCachedFlow("old", oldKey, now - 1_800_000, 2, 2, vectors, vectors)).toBe(true);
    expect(await writeStfCachedFlow("new", newKey, now - 1_799_999, 2, 2, vectors, vectors)).toBe(true);
    expect(await purgeExpiredStfFlowSessions(now - 1_800_000)).toBe(1);
    expect(await readStfCachedFlow("old", oldKey, 2, 2)).toBeNull();
    expect(await readStfCachedFlow("new", newKey, 2, 2)).not.toBeNull();
  } finally { fake.restore(); }
});

test("v1 content-addressed IndexedDB records are dropped, never reused", async () => {
  const fake = useMemoryIndexedDb(1);
  try {
    const key = stfFlowSessionKey("session", 0, 1, "align", 2, 2)!;
    expect(await readStfCachedFlow("session", key, 2, 2)).toBeNull();
    expect(fake.tables.get("pairs")?.size).toBe(0);
    expect(fake.tables.get("metadata")?.size).toBe(0);
  } finally { fake.restore(); }
});

test("v2 cached 21px fields are discarded on adaptive-window upgrade", async () => {
  const fake = useMemoryIndexedDb(2);
  try {
    const key = stfFlowSessionKey("session", 0, 1, "align", 2, 2, 31)!;
    expect(await readStfCachedFlow("session", key, 2, 2)).toBeNull();
    expect(fake.tables.get("pairs")?.size).toBe(0);
    expect(fake.tables.get("metadata")?.size).toBe(0);
  } finally { fake.restore(); }
});

test("actual Optical Flow worker hits persisted Flow without spawning Farneback workers", async () => {
  const fake = useMemoryIndexedDb();
  const originals = (["Worker", "navigator", "onmessage", "postMessage"] as const)
    .map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)] as const);
  let spawned = 0;
  let computes = 0;
  class FakeDirectionWorker {
    onmessage: ((event: MessageEvent<unknown>) => void) | null = null;
    onerror: null = null;
    onmessageerror: null = null;
    postMessage(message: { type: string; requestId: number; width?: number; height?: number }) {
      const respond = (response: unknown) => queueMicrotask(() => this.onmessage?.({ data: response } as MessageEvent<unknown>));
      if (message.type === "init") respond({ type: "ready", requestId: message.requestId });
      else if (message.type === "compute-pair") {
        computes++;
        const vectors = new Float32Array(message.width! * message.height! * 2);
        respond({ type: "pair-result", requestId: message.requestId,
          forwardBuffer: vectors.buffer, backwardBuffer: vectors.slice().buffer, forwardMs: 1, backwardMs: 1 });
      }
    }
    constructor(_url: string) { spawned++; }
    terminate() {}
  }
  Object.defineProperty(globalThis, "Worker", { configurable: true, value: FakeDirectionWorker });
  Object.defineProperty(globalThis, "navigator", { configurable: true, value: { hardwareConcurrency: 1, deviceMemory: 4 } });
  try {
    const exercise = async (requestId: number, sessionId = "session-a") => {
      jest.resetModules();
      const responses: Array<{ type: string; gamma2Buffer?: ArrayBuffer; performance?: {
        flowCacheHit?: boolean; flowWorkerCount: number;
      } }> = [];
      Object.defineProperty(globalThis, "postMessage", { configurable: true,
        value: (message: unknown) => responses.push(message as typeof responses[number]) });
      jest.requireActual("../workers/optical-flow.worker");
      const scope = globalThis as unknown as { onmessage: (event: MessageEvent<unknown>) => Promise<void> };
      const previous = new Uint16Array(7 * 3 * 3).fill(10000);
      const next = new Uint16Array(7 * 3 * 3).fill(20000);
      await scope.onmessage({ data: {
        type: "interpolate", requestId, width: 7, height: 3, variant: "mid", persistFlow: true,
        sessionId, sessionCreatedAt: Date.now(), alignmentKey: "align-1",
        previousImageId: 0, nextImageId: 1, linearRangeMax: 4,
        previousGamma2Buffer: previous.buffer, nextGamma2Buffer: next.buffer,
      } } as MessageEvent<unknown>);
      return responses.find((entry) => entry.type === "result");
    };
    const cold = await exercise(1);
    expect(cold?.performance?.flowCacheHit).toBe(false);
    expect(computes).toBe(1);
    const spawnedBeforeHit = spawned;
    const hot = await exercise(2);
    expect(hot?.performance?.flowCacheHit).toBe(true);
    expect(hot?.performance?.flowWorkerCount).toBe(0);
    expect(spawned).toBe(spawnedBeforeHit);
    expect(computes).toBe(1);
    expect(Array.from(new Uint16Array(hot!.gamma2Buffer!))).toEqual(
      Array.from(new Uint16Array(cold!.gamma2Buffer!)));
    // A new Canonical session must NOT reuse any previous session's Flow,
    // even when every input pixel is identical.
    const changed = await exercise(3, "session-b");
    expect(changed?.performance?.flowCacheHit).toBe(false);
    expect(computes).toBe(2);
  } finally {
    fake.restore();
    for (const [key, descriptor] of originals) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
  }
});
