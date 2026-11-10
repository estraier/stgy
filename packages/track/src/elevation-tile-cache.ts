/**
 * Browser-only, best-effort cache for GSI and Mapzen elevation PNG tiles.
 * Providers use disjoint URL namespaces and independent 128-tile quotas in
 * the existing IndexedDB store. Stored PNG bytes expire 24h after retrieval.
 * Legacy GSI and Mapzen entries remain readable without migrating the DB.
 */
export const GSI_TILE_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
export const GSI_TILE_CACHE_MAX_ENTRIES = 128;
export const MAPZEN_TILE_CACHE_MAX_ENTRIES = 128;

// Keep the original database for compatibility with existing 24h GSI cache entries.
const DATABASE_NAME = 'stgy-track-gsi-elevation-tiles-v1';
const STORE_NAME = 'tiles';
const DATABASE_VERSION = 1;
const OPEN_TIMEOUT_MS = 1500;

interface TileRecord {
  url: string;
  savedAt: number;
  bytes: ArrayBuffer;
}

let openedDatabase: Promise<IDBDatabase | undefined> | undefined;
let lastOpenFailureAt = 0;
const OPEN_RETRY_MS = 60_000;

/** Do not retain an HTTP 200 error page as a tile for 24 hours. */
function isPngTile(bytes: ArrayBuffer): boolean {
  if (bytes.byteLength < 33) return false;
  const b = new Uint8Array(bytes, 0, 16);
  return b[0] === 137 && b[1] === 80 && b[2] === 78 && b[3] === 71 &&
    b[4] === 13 && b[5] === 10 && b[6] === 26 && b[7] === 10 &&
    b[8] === 0 && b[9] === 0 && b[10] === 0 && b[11] === 13 &&
    b[12] === 73 && b[13] === 72 && b[14] === 68 && b[15] === 82;
}

/** Cache only the exact public GSI datasets this decoder supports. */
export function isCacheableGsiElevationUrl(url: string): boolean {
  return /^https:\/\/cyberjapandata\.gsi\.go\.jp\/xyz\/(?:dem_png\/14|dem5[abc]_png\/15)\/\d+\/\d+\.png$/.test(url);
}
/** Mapzen's public AWS Terrarium tiles, zoom 14 in the current adapter. */
export function isCacheableMapzenElevationUrl(url: string): boolean {
  return /^https:\/\/s3\.amazonaws\.com\/elevation-tiles-prod\/terrarium\/14\/\d+\/\d+\.png$/.test(url);
}

export function isCacheableElevationTileUrl(url: string): boolean {
  return isCacheableGsiElevationUrl(url) || isCacheableMapzenElevationUrl(url);
}

function openDatabase(): Promise<IDBDatabase | undefined> {
  if (typeof indexedDB === 'undefined') return Promise.resolve(undefined);
  if (openedDatabase) return openedDatabase;
  if (lastOpenFailureAt && Date.now() >= lastOpenFailureAt && Date.now() - lastOpenFailureAt < OPEN_RETRY_MS) {
    return Promise.resolve(undefined);
  }
  const opening = new Promise<IDBDatabase | undefined>((resolve) => {
    let settled = false;
    const finish = (db?: IDBDatabase) => {
      if (settled) {
        db?.close();
        return;
      }
      settled = true;
      clearTimeout(timeout);
      resolve(db);
    };
    const timeout = setTimeout(() => finish(), OPEN_TIMEOUT_MS);
    try {
      const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          const store = db.createObjectStore(STORE_NAME, { keyPath: 'url' });
          store.createIndex('savedAt', 'savedAt');
        }
      };
      request.onsuccess = () => {
        const db = request.result;
        if (settled) { db.close(); return; }
        db.onversionchange = () => { db.close(); openedDatabase = undefined; };
        finish(db);
      };
      request.onerror = () => finish();
      request.onblocked = () => finish();
    } catch { finish(); }
  });
  openedDatabase = opening.then((db) => {
    if (!db) {
      lastOpenFailureAt = Date.now();
      openedDatabase = undefined; // Retry later, not on every tile.
    } else {
      lastOpenFailureAt = 0;
    }
    return db;
  });
  return openedDatabase;
}

function validRecord(value: unknown, url: string, now: number): value is TileRecord {
  if (!value || typeof value !== 'object') return false;
  const record = value as Partial<TileRecord>;
  return record.url === url && Number.isFinite(record.savedAt) &&
    typeof record.savedAt === 'number' && record.savedAt <= now &&
    now - record.savedAt < GSI_TILE_CACHE_TTL_MS &&
    record.bytes instanceof ArrayBuffer && isPngTile(record.bytes);
}

/** Returns undefined when expired/missing, or when IndexedDB is unavailable. */
export async function readCachedElevationTile(url: string): Promise<ArrayBuffer | undefined> {
  if (!isCacheableElevationTileUrl(url)) return undefined;
  const db = await openDatabase();
  if (!db) return undefined;
  return new Promise<ArrayBuffer | undefined>((resolve) => {
    try {
      const transaction = db.transaction(STORE_NAME, 'readonly');
      const request = transaction.objectStore(STORE_NAME).get(url);
      let settled = false;
      const finish = (value?: ArrayBuffer) => { if (!settled) { settled = true; resolve(value); } };
      request.onsuccess = () => finish(validRecord(request.result, url, Date.now()) ? request.result.bytes : undefined);
      request.onerror = () => finish();
      transaction.onabort = () => finish();
      transaction.onerror = () => finish();
    } catch { resolve(undefined); }
  });
}

/** Success-only write. Expired/oldest records are pruned without background timers. */
export async function writeCachedElevationTile(url: string, bytes: ArrayBuffer): Promise<void> {
  if (!isCacheableElevationTileUrl(url) || !isPngTile(bytes)) return;
  const db = await openDatabase();
  if (!db) return;
  await new Promise<void>((resolve) => {
    try {
      const now = Date.now();
      const transaction = db.transaction(STORE_NAME, 'readwrite');
      const store = transaction.objectStore(STORE_NAME);
      store.put({ url, savedAt: now, bytes } satisfies TileRecord);
      // Both providers are stored under their exact URLs, with separate
      // capacity limits. A full GSI cache must not evict useful Mapzen data.
      // The cursor is sorted oldest-first, so entries beyond the limit are
      // removed from each provider independently.
      const cursorRequest = store.index('savedAt').openCursor();
      const records: { url: string; savedAt: number }[] = [];
      cursorRequest.onsuccess = () => {
        const cursor = cursorRequest.result;
        if (!cursor) {
          const keep = new Map<'gsi' | 'mapzen', number>([['gsi', 0], ['mapzen', 0]]);
          for (const record of records.reverse()) {
            const provider = isCacheableGsiElevationUrl(record.url) ? 'gsi'
              : isCacheableMapzenElevationUrl(record.url) ? 'mapzen' : undefined;
            const maxEntries = provider === 'gsi' ? GSI_TILE_CACHE_MAX_ENTRIES : MAPZEN_TILE_CACHE_MAX_ENTRIES;
            const count = provider ? keep.get(provider)! : 0;
            if (provider && count < maxEntries && record.savedAt <= now && now - record.savedAt < GSI_TILE_CACHE_TTL_MS) {
              keep.set(provider, count + 1);
            } else {
              store.delete(record.url);
            }
          }
          return;
        }
        records.push({ url: cursor.value.url, savedAt: cursor.value.savedAt });
        cursor.continue();
      };
      transaction.oncomplete = () => resolve();
      transaction.onabort = () => resolve();
      transaction.onerror = () => resolve();
    } catch { resolve(); }
  });
}

/** Backwards-compatible GSI cache entry points. */
export const readCachedGsiElevationTile = readCachedElevationTile;
export const writeCachedGsiElevationTile = writeCachedElevationTile;
