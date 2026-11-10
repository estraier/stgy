import type { TrackActivity } from './activity';
import { correctTrackActivityAltitudes } from './altitude-correction';
import type { ElevationSource } from './altitude-correction';
import {
  GSI_TILE_CACHE_MAX_ENTRIES, MAPZEN_TILE_CACHE_MAX_ENTRIES, GSI_TILE_CACHE_TTL_MS,
  isCacheableGsiElevationUrl, isCacheableMapzenElevationUrl, readCachedGsiElevationTile, writeCachedGsiElevationTile,
  readCachedElevationTile, writeCachedElevationTile,
} from './elevation-tile-cache';

// Minimal asynchronous IndexedDB emulator for the APIs used by the cache.
// No browser network, real GSI service, or extra devDependency required.
type Tile = { url: string; savedAt: number; bytes: ArrayBuffer };
type Callback = (() => void) | null;
class FakeRequest<T> {
  result!: T;
  onsuccess: Callback = null;
  onerror: Callback = null;
  onupgradeneeded: Callback = null;
  onblocked: Callback = null;
}
class FakeTransaction {
  oncomplete: Callback = null;
  onabort: Callback = null;
  onerror: Callback = null;
  private pending = 0;
  constructor(private readonly records: Map<string, Tile>) {}
  queue(action: () => void): void {
    this.pending++;
    queueMicrotask(() => {
      action();
      this.pending--;
      if (this.pending === 0) queueMicrotask(() => { if (this.pending === 0) this.oncomplete?.(); });
    });
  }
  objectStore(_name: string) {
    const transaction = this;
    const request = <T>(operation: () => T): FakeRequest<T> => {
      const result = new FakeRequest<T>();
      transaction.queue(() => { result.result = operation(); result.onsuccess?.(); });
      return result;
    };
    return {
      get(url: string) { return request(() => transaction.records.get(url)); },
      put(record: Tile) { return request(() => { transaction.records.set(record.url, record); }); },
      delete(url: string) { return request(() => { transaction.records.delete(url); }); },
      count() { return request(() => transaction.records.size); },
      index(_name: string) {
        return {
          openCursor() {
            const output = new FakeRequest<{
              value: Tile;
              delete(): void;
              continue(): void;
            } | null>();
            // IndexedDB executes the preceding put before this cursor starts.
            let ordered: Tile[] | undefined;
            let i = 0;
            const next = () => {
              if (!ordered) ordered = [...transaction.records.values()]
                .sort((a, b) => a.savedAt - b.savedAt);
              const record = ordered[i++];
              output.result = record ? {
                value: record,
                delete: () => { transaction.records.delete(record.url); },
                continue: () => transaction.queue(next),
              } : null;
              output.onsuccess?.();
            };
            transaction.queue(next);
            return output;
          },
        };
      },
    };
  }
}
class FakeDatabase {
  onversionchange: Callback = null;
  objectStoreNames = { contains: (_name: string) => this.created };
  created = false;
  failTransactions = false;
  constructor(readonly records: Map<string, Tile>) {}
  createObjectStore(_name: string, _options: unknown) {
    this.created = true;
    return { createIndex() {} };
  }
  transaction() { if (this.failTransactions) throw new Error('IDB unavailable'); return new FakeTransaction(this.records); }
  close() {}
}

const records = new Map<string, Tile>();
const database = new FakeDatabase(records);
const factory = {
  open() {
    const req = new FakeRequest<FakeDatabase>();
    queueMicrotask(() => {
      req.result = database;
      if (!database.created) req.onupgradeneeded?.();
      req.onsuccess?.();
    });
    return req;
  },
};
const VALID_URL = 'https://cyberjapandata.gsi.go.jp/xyz/dem_png/14/14501/6480.png';
function samplePng(marker = 1): ArrayBuffer {
  const bytes = new Uint8Array(33);
  bytes.set([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82]);
  bytes[32] = marker;
  return bytes.buffer;
}
const savedIndexedDb = globalThis.indexedDB;

beforeAll(() => {
  Object.defineProperty(globalThis, 'indexedDB', { value: factory, configurable: true, writable: true });
});
afterAll(() => {
  Object.defineProperty(globalThis, 'indexedDB', { value: savedIndexedDb, configurable: true, writable: true });
});
beforeEach(() => { records.clear(); });

describe('GSI IndexedDB elevation tile cache', () => {
  test('GSI and Mapzen cache entries use independent URL namespaces', async () => {
    const mapzen = 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/14/8284/5636.png';
    expect(isCacheableMapzenElevationUrl(mapzen)).toBe(true);
    expect(isCacheableMapzenElevationUrl('https://example.com/elevation-tiles-prod/terrarium/14/8284/5636.png')).toBe(false);
    expect(isCacheableMapzenElevationUrl(mapzen.replace('/14/', '/17/'))).toBe(false);
    expect(isCacheableMapzenElevationUrl(mapzen + '?foo=bar')).toBe(false);
    const png = samplePng(7);
    await writeCachedElevationTile(mapzen, png);
    expect(new Uint8Array((await readCachedElevationTile(mapzen))!)[32]).toBe(7);
    expect(await readCachedGsiElevationTile(VALID_URL)).toBeUndefined();
    await writeCachedElevationTile(VALID_URL, samplePng(9));
    expect(new Uint8Array((await readCachedElevationTile(VALID_URL))!)[32]).toBe(9);
    expect(new Uint8Array((await readCachedElevationTile(mapzen))!)[32]).toBe(7);
  });

  test('accepts only supported GSI tile URLs', () => {
    expect(isCacheableGsiElevationUrl(VALID_URL)).toBe(true);
    expect(isCacheableGsiElevationUrl(VALID_URL.replace('/dem_png/14/', '/dem5a_png/15/'))).toBe(true);
    expect(isCacheableGsiElevationUrl(VALID_URL.replace('/dem_png/14/', '/dem5b_png/15/'))).toBe(true);
    expect(isCacheableGsiElevationUrl(VALID_URL.replace('/dem_png/14/', '/dem5c_png/15/'))).toBe(true);
    expect(isCacheableGsiElevationUrl('https://example.com/xyz/dem_png/14/14501/6480.png')).toBe(false);
    expect(isCacheableGsiElevationUrl(VALID_URL.replace('/dem_png/14/', '/dem_png/15/'))).toBe(false);
    expect(isCacheableGsiElevationUrl(VALID_URL.replace('.png', '.png?token=1'))).toBe(false);
  });

  test('persists raw bytes and expires exactly 24 hours after write, not access', async () => {
    const clock = jest.spyOn(Date, 'now').mockReturnValue(1_800_000_000_000);
    try {
      const bytes = samplePng(4);
      await writeCachedGsiElevationTile(VALID_URL, bytes);
      expect(new Uint8Array((await readCachedGsiElevationTile(VALID_URL))!)).toEqual(new Uint8Array(samplePng(4)));
      clock.mockReturnValue(1_800_000_000_000 + GSI_TILE_CACHE_TTL_MS - 1);
      expect(await readCachedGsiElevationTile(VALID_URL)).toBeDefined();
      clock.mockReturnValue(1_800_000_000_000 + GSI_TILE_CACHE_TTL_MS);
      expect(await readCachedGsiElevationTile(VALID_URL)).toBeUndefined();
    } finally { clock.mockRestore(); }
  });

  test('rejects malformed PNG tiles and unrelated hosts', async () => {
    await writeCachedGsiElevationTile(VALID_URL, new Uint8Array([60, 104, 116, 109, 108, 62]).buffer);
    await writeCachedGsiElevationTile('https://example.org/xyz/dem_png/14/1/2.png', samplePng());
    expect(records.size).toBe(0);
  });

  test('prunes expired tiles and keeps no more than 128 most recent entries', async () => {
    const clock = jest.spyOn(Date, 'now').mockReturnValue(1_800_000_000_000);
    try {
      for (let i = 0; i < GSI_TILE_CACHE_MAX_ENTRIES + 3; i++) {
        clock.mockReturnValue(1_800_000_000_000 + i);
        await writeCachedGsiElevationTile(VALID_URL.replace('14501', String(14501 + i)), samplePng(7));
      }
      expect(records.size).toBe(GSI_TILE_CACHE_MAX_ENTRIES);
      expect(records.has(VALID_URL)).toBe(false);
      clock.mockReturnValue(1_800_000_000_000 + GSI_TILE_CACHE_TTL_MS + 500);
      await writeCachedGsiElevationTile(VALID_URL, samplePng(9));
      expect(records.size).toBe(1);
    } finally { clock.mockRestore(); }
  });

  test('GSI and Mapzen retain up to 128 tiles each without evicting the other source', async () => {
    const clock = jest.spyOn(Date, 'now').mockReturnValue(1_800_000_000_000);
    const mapzenPrefix = 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/14/';
    try {
      for (let i = 0; i < GSI_TILE_CACHE_MAX_ENTRIES + 1; i++) {
        clock.mockReturnValue(1_800_000_000_000 + i * 2);
        await writeCachedElevationTile(VALID_URL.replace('14501', String(14501 + i)), samplePng());
        clock.mockReturnValue(1_800_000_000_000 + i * 2 + 1);
        await writeCachedElevationTile(`${mapzenPrefix}${8000 + i}/5636.png`, samplePng());
      }
      const urls = [...records.keys()];
      expect(urls.filter(isCacheableGsiElevationUrl)).toHaveLength(GSI_TILE_CACHE_MAX_ENTRIES);
      expect(urls.filter(isCacheableMapzenElevationUrl)).toHaveLength(MAPZEN_TILE_CACHE_MAX_ENTRIES);
      expect(records.has(VALID_URL)).toBe(false);
      expect(records.has(`${mapzenPrefix}8000/5636.png`)).toBe(false);
      expect(await readCachedElevationTile(`${mapzenPrefix}8128/5636.png`)).toBeDefined();
      expect(await readCachedElevationTile(VALID_URL.replace('14501', '14629'))).toBeDefined();
    } finally { clock.mockRestore(); }
  });

  test('conversion reuses an IndexedDB tile with zero HTTP budget', async () => {
    const track: TrackActivity = {
      schemaVersion: 1, metadata: {}, warnings: [], points: Array.from({ length: 600 }, (_, i) => ({
        lat: 35 + i * 0.0002, lon: 139, time: i * 10,
        altitudeM: 110 + 10 * Math.sin(i / 20) + i * 0.04,
      })),
    };
    const source: ElevationSource = {
      id: 'gsi-dem', getGroupKey() { return 'same-tile'; },
      async getElevations(_key, positions, context) {
        const data = await context.fetchBytes(VALID_URL);
        return data ? positions.map(({ lat }) => {
          const i = (lat - 35) / 0.0002;
          return { elevationM: 100 + 10 * Math.sin(i / 20), dataset: 'DEM10B' };
        }) : [];
      },
    };
    const oldFetch = globalThis.fetch;
    const calls: string[] = [];
    globalThis.fetch = (async (url: string) => {
      calls.push(url);
      return { ok: true, status: 200, arrayBuffer: async () => samplePng(5) } as Response;
    }) as typeof fetch;
    try {
      const first = await correctTrackActivityAltitudes(track, { source });
      expect(first.status).toBe('corrected');
      expect(first.report.tileRequests).toBe(1);
      expect(first.report.tilesFromCache).toBe(0);
      expect(calls).toHaveLength(1);
      const second = await correctTrackActivityAltitudes(track, { source, maxTileRequests: 0 });
      expect(second.status).toBe('corrected');
      expect(second.report.tileRequests).toBe(0);
      expect(second.report.tilesFromCache).toBe(1);
      expect(second.activity.points[300].altitudeM).toBeCloseTo(first.activity.points[300].altitudeM!, 6);
      expect(calls).toHaveLength(1);
    } finally { globalThis.fetch = oldFetch; }
  });

  test('expired tile is downloaded again instead of being served stale', async () => {
    const clock = jest.spyOn(Date, 'now').mockReturnValue(1_800_000_000_000);
    const track: TrackActivity = {
      schemaVersion: 1, metadata: {}, warnings: [], points: Array.from({ length: 300 }, (_, i) => ({
        lat: 35 + i * 0.0002, lon: 139, time: i * 10, altitudeM: 100,
      })),
    };
    const source: ElevationSource = {
      id: 'gsi-dem', getGroupKey() { return 'same'; },
      async getElevations(_key, positions, context) {
        return await context.fetchBytes(VALID_URL) ? positions.map(() => ({ elevationM: 110, dataset: 'DEM10B' })) : [];
      },
    };
    const oldFetch = globalThis.fetch;
    let count = 0;
    globalThis.fetch = (async () => {
      count++;
      return { ok: true, status: 200, arrayBuffer: async () => samplePng(count) } as Response;
    }) as typeof fetch;
    try {
      await correctTrackActivityAltitudes(track, { source });
      const fresh = await correctTrackActivityAltitudes(track, { source });
      expect(fresh.report.tileRequests).toBe(0);
      clock.mockReturnValue(1_800_000_000_000 + GSI_TILE_CACHE_TTL_MS);
      const expired = await correctTrackActivityAltitudes(track, { source });
      expect(expired.report.tileRequests).toBe(1);
      expect(expired.report.tilesFromCache).toBe(0);
      expect(count).toBe(2);
    } finally { globalThis.fetch = oldFetch; clock.mockRestore(); }
  });

  test('falls back to HTTP when IndexedDB storage throws', async () => {
    const oldFetch = globalThis.fetch;
    let requests = 0;
    const track: TrackActivity = {
      schemaVersion: 1, metadata: {}, warnings: [], points: Array.from({ length: 300 }, (_, i) => ({
        lat: 35 + i * 0.0002, lon: 139, time: i * 10, altitudeM: 100,
      })),
    };
    const source: ElevationSource = {
      id: 'gsi-dem', getGroupKey() { return 'same'; },
      async getElevations(_key, positions, context) {
        return await context.fetchBytes(VALID_URL) ? positions.map(() => ({ elevationM: 110, dataset: 'DEM10B' })) : [];
      },
    };
    database.failTransactions = true;
    globalThis.fetch = (async () => {
      requests++;
      return { ok: true, status: 200, arrayBuffer: async () => samplePng() } as Response;
    }) as typeof fetch;
    try {
      const result = await correctTrackActivityAltitudes(track, { source });
      expect(result.status).toBe('corrected');
      expect(result.report.tileRequests).toBe(1);
      expect(requests).toBe(1);
    } finally {
      database.failTransactions = false;
      globalThis.fetch = oldFetch;
    }
  });

  test('failed requests are not cached', async () => {
    // A failed fetch must not become a persistent negative-cache entry.
    const track: TrackActivity = {
      schemaVersion: 1, metadata: {}, warnings: [], points: Array.from({ length: 300 }, (_, i) => ({
        lat: 35 + i * 0.0002, lon: 139, time: i * 10, altitudeM: 100,
      })),
    };
    const source: ElevationSource = {
      id: 'gsi-dem', getGroupKey() { return 'same'; },
      async getElevations(_key, positions, context) {
        return await context.fetchBytes(VALID_URL) ? positions.map(() => ({ elevationM: 100, dataset: 'DEM10B' })) : [];
      },
    };
    const oldFetch = globalThis.fetch;
    let count = 0;
    globalThis.fetch = (async () => {
      count++;
      return { ok: false, status: 404 } as Response;
    }) as typeof fetch;
    try {
      await correctTrackActivityAltitudes(track, { source });
      await correctTrackActivityAltitudes(track, { source });
      expect(count).toBe(2);
      expect(records.size).toBe(0);
    } finally { globalThis.fetch = oldFetch; }
  });
});
