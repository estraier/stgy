/** Best-effort scratch cache for generated gamma-2 RGB16 frames.
 * The frame is published only after all chunks are written; cache errors
 * never affect the computed image. No browser-wide storage is required.
 */
const DB_NAME = "stgy-lss-stf-middle-frames-v1";
const CHUNK_BYTES = 8 * 1024 * 1024;
const TTL_MS = 24 * 60 * 60 * 1000;
const MAX_FRAME_BYTES = 160 * 1024 * 1024;
const MAX_STORED_FRAMES = 8;

type FrameRecord = { key: string; width: number; height: number; chunkCount: number; createdAt: number };
function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error("STF frame IndexedDB request failed"));
  });
}
function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains("frames")) db.createObjectStore("frames", { keyPath: "key" });
      if (!db.objectStoreNames.contains("chunks")) db.createObjectStore("chunks");
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error("STF frame IndexedDB open failed"));
  });
}
async function readStore<T>(db: IDBDatabase, store: string, key: string): Promise<T | undefined> {
  return request(db.transaction(store, "readonly").objectStore(store).get(key)) as Promise<T | undefined>;
}
async function writeStore(db: IDBDatabase, store: string, value: unknown, key?: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(store, "readwrite");
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error || new Error("STF cache write failed"));
    tx.onabort = () => reject(tx.error || new Error("STF cache write aborted"));
    if (key === undefined) tx.objectStore(store).put(value);
    else tx.objectStore(store).put(value, key);
  });
}
async function deleteFrame(db: IDBDatabase, meta: FrameRecord): Promise<void> {
  // Clear metadata first so partially deleted rows cannot be used.
  await request(db.transaction("frames", "readwrite").objectStore("frames").delete(meta.key));
  for (let i = 0; i < meta.chunkCount; i++) {
    await request(db.transaction("chunks", "readwrite").objectStore("chunks").delete(`${meta.key}:${i}`));
  }
}
async function prune(db: IDBDatabase, newKey: string): Promise<void> {
  const all = await request(db.transaction("frames", "readonly").objectStore("frames").getAll()) as FrameRecord[];
  const ordered = all.filter((frame) => frame.key !== newKey).sort((a,b) => a.createdAt - b.createdAt);
  let count = all.length;
  for (const frame of ordered) {
    if (Date.now() - frame.createdAt < TTL_MS && count < MAX_STORED_FRAMES) break;
    await deleteFrame(db, frame);
    count--;
  }
}
export class StfGeneratedFrameCache {
  private dbPromise: Promise<IDBDatabase> | null = null;
  private db(): Promise<IDBDatabase> {
    if (!this.dbPromise) this.dbPromise = open();
    return this.dbPromise;
  }
  async read(key: string, width: number, height: number): Promise<Uint16Array | null> {
    try {
      const db = await this.db();
      const meta = await readStore<FrameRecord>(db, "frames", key);
      if (!meta || meta.width !== width || meta.height !== height ||
          Date.now() - meta.createdAt >= TTL_MS) return null;
      const output = new Uint16Array(width * height * 3);
      const byteOutput = new Uint8Array(output.buffer);
      let offset = 0;
      for (let index = 0; index < meta.chunkCount; index++) {
        const chunk = await readStore<ArrayBuffer>(db, "chunks", `${key}:${index}`);
        if (!chunk || offset + chunk.byteLength > byteOutput.byteLength) return null;
        byteOutput.set(new Uint8Array(chunk), offset);
        offset += chunk.byteLength;
      }
      return offset === byteOutput.byteLength ? output : null;
    } catch { return null; }
  }
  async write(key: string, width: number, height: number, pixels: Uint16Array): Promise<boolean> {
    if (pixels.length !== width * height * 3 || pixels.byteLength > MAX_FRAME_BYTES) return false;
    let db: IDBDatabase | null = null;
    let writtenChunks = 0;
    try {
      if (typeof navigator !== "undefined" && navigator.storage?.estimate) {
        const { usage, quota } = await navigator.storage.estimate();
        if (usage !== undefined && quota !== undefined && quota - usage < pixels.byteLength * 2) return false;
      }
      db = await this.db();
      await prune(db, key);
      const old = await readStore<FrameRecord>(db, "frames", key);
      if (old) await deleteFrame(db, old);
      const chunks = Math.ceil(pixels.byteLength / CHUNK_BYTES);
      const bytes = new Uint8Array(pixels.buffer, pixels.byteOffset, pixels.byteLength);
      // Do not publish the metadata record until the last chunk is complete.
      for (let i = 0; i < chunks; i++) {
        const part = bytes.slice(i * CHUNK_BYTES, Math.min(bytes.length, (i + 1) * CHUNK_BYTES));
        await writeStore(db, "chunks", part.buffer, `${key}:${i}`);
        writtenChunks++;
      }
      await writeStore(db, "frames", { key, width, height, chunkCount: chunks, createdAt: Date.now() } satisfies FrameRecord);
      return true;
    } catch {
      // A partial write is not published, but its orphan chunks must not
      // consume space indefinitely after a quota or cancellation failure.
      if (db && writtenChunks) {
        for (let i = 0; i < writtenChunks; i++) {
          try { await request(db.transaction("chunks", "readwrite").objectStore("chunks").delete(`${key}:${i}`)); }
          catch { /* Best-effort scratch cleanup */ }
        }
      }
      return false;
    }
  }
  close(): void { if (this.dbPromise) void this.dbPromise.then((db) => db.close()).catch(() => {}); this.dbPromise = null; }
}
