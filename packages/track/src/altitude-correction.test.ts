import { Blob as NodeBlob } from 'node:buffer';
import type { TrackActivity, TrackPoint } from './activity';
import { correctTrackActivityAltitudes } from './altitude-correction';
import type { ElevationSource } from './altitude-correction';
import { isJapan } from './geo';
import { createGsiElevationSource, decodeGsiElevationRgb, getGsiTileAddress, readGsiElevationPixel } from './elevation-gsi';

function makeTrack(count = 600, segments = 1): TrackActivity {
  const points: TrackPoint[] = [];
  for (let segment = 0; segment < segments; segment++) {
    if (segment) points.push({});
    for (let i = 0; i < count; i++) {
      const time = segment * 10000 + i * 10;
      const lat = 35.0 + i * 0.0002;
      const trueAltitude = 100 + 10 * Math.sin(i / 20);
      points.push({ time, lat, lon: 139.0, altitudeM: trueAltitude + 10 + i * 0.04,
        segmentId: segment, heartRateBpm: 120, distanceM: i * 22.2 });
    }
  }
  return { schemaVersion: 1, metadata: { ascentM: 9, descentM: 8, totalTimerTime: 9000,
    netMovingTime: 7000, netMovingDistanceM: 30000 }, points, warnings: [] };
}
const terrain = (lat: number) => {
  const i = (lat - 35) / 0.0002;
  return 100 + 10 * Math.sin(i / 20);
};
function fakeSource(overrides: Partial<ElevationSource> = {}): ElevationSource {
  return {
    id: 'fake',
    supportsCoordinate({ lat, lon }) { return isJapan(lat, lon); },
    getGroupKey({ lat }) { return `tile-${Math.floor((lat - 35) * 100)}`; },
    async getElevations(_tile, positions) { return positions.map(({ lat }) => ({ elevationM: terrain(lat), dataset: 'DEM10B' })); },
    ...overrides,
  };
}

describe('terrain drift correction', () => {
  test('corrects smooth drift without changing sensor/position or source activity', async () => {
    const original = makeTrack();
    const untouched = JSON.stringify(original);
    const result = await correctTrackActivityAltitudes(original, { source: fakeSource() });
    expect(result.status).toBe('corrected');
    expect(result.report.anchorsUsed).toBe(9);
    expect(result.report.tileRequests).toBe(0);
    const middle = result.activity.points[300];
    expect(Math.abs(middle.altitudeM! - terrain(middle.lat!))).toBeLessThan(0.5);
    expect(middle.heartRateBpm).toBe(120);
    expect(result.activity.metadata.netMovingTime).toBe(7000);
    expect(result.activity.metadata.totalTimerTime).toBe(9000);
    expect(result.activity.metadata.ascentM).not.toBe(9);
    expect(result.activity.metadata.altitudeCorrection).toEqual({ method: 'terrain-drift-v1', source: 'fake', anchorsUsed: 9, status: 'corrected' });
    expect(JSON.stringify(original)).toBe(untouched);
  });

  test('does not double-correct activities with history', async () => {
    const activity = makeTrack();
    activity.metadata.altitudeCorrection = { method: 'terrain-drift-v1', source: 'gsi-dem', anchorsUsed: 5, status: 'corrected' };
    const result = await correctTrackActivityAltitudes(activity, { source: fakeSource() });
    expect(result.status).toBe('skipped');
    expect(result.report.reason).toBe('already_corrected');
    expect(result.activity).toBe(activity);
  });

  test('does not attempt HTTP or modify altitude for non-Japan coordinates', async () => {
    const activity = makeTrack();
    activity.points.forEach((p) => { if (p.lat !== undefined) p.lat = 48 + (p.lat - 35); });
    const result = await correctTrackActivityAltitudes(activity, { source: fakeSource() });
    expect(result.report.reason).toBe('outside_coverage');
    expect(result.report.tileRequests).toBe(0);
    expect(result.activity).toBe(activity);
  });

  test('a worldwide source corrects an overseas activity with the common drift algorithm', async () => {
    const activity = makeTrack();
    activity.points.forEach((p) => { if (p.lat !== undefined) p.lat += 13; });
    const worldwide = fakeSource({
      supportsCoordinate() { return true; },
      getGroupKey({ lat }) { return `tile-${Math.floor((lat - 48) * 100)}`; },
      async getElevations(_group, coords) {
        return coords.map(({ lat }) => ({ elevationM: terrain(lat - 13), dataset: 'Mapzen Terrarium' }));
      },
    });
    const result = await correctTrackActivityAltitudes(activity, { source: worldwide });
    expect(result.status).toBe('corrected');
    expect(result.report.anchorsUsed).toBe(9);
    expect(result.activity.points[300].altitudeM).toBeCloseTo(terrain(35 + 300 * 0.0002), 0);
  });

  test('regional GSI and Mapzen source is the default for Japanese activities', async () => {
    const activity = makeTrack();
    const result = await correctTrackActivityAltitudes(activity, { maxTileRequests: 0 });
    expect(result.report.sourceId).toBe('gsi-mapzen');
    expect(result.status).toBe('skipped');
    expect(result.report.tileRequests).toBe(0);
  });

  test('regional default Mapzen fetch/decode/correction works outside Japan without contacting GSI', async () => {
    const track = makeTrack();
    track.points.forEach((p) => { if (p.lat !== undefined) p.lat += 13; }); // France latitude
    const pixels = new Uint8ClampedArray(256 * 256 * 4);
    for (let i = 0; i < 256 * 256; i++) {
      pixels[i * 4] = 128; pixels[i * 4 + 1] = 120; pixels[i * 4 + 3] = 255;
    }
    const globals = globalThis as unknown as Record<string, unknown>;
    const originalFetch = globalThis.fetch;
    const originalBitmap = globals.createImageBitmap;
    const originalCanvas = globals.OffscreenCanvas;
    const requests: string[] = [];
    globals.createImageBitmap = async () => ({ width: 256, height: 256, close() {} });
    globals.OffscreenCanvas = class {
      getContext() { return { drawImage() {}, getImageData() { return { data: pixels }; } }; }
    };
    globalThis.fetch = (async (url: string) => {
      requests.push(url);
      return { ok: true, status: 200, arrayBuffer: async () => {
        const bytes = new Uint8Array(33);
        bytes.set([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82]);
        return bytes.buffer;
      } } as Response;
    }) as typeof fetch;
    try {
      const result = await correctTrackActivityAltitudes(track);
      expect(result.report.sourceId).toBe('gsi-mapzen');
      expect(result.report.anchorsUsed).toBeGreaterThan(0);
      expect(result.report.tileRequests).toBe(requests.length);
      expect(result.report.tileRequests).toBeLessThanOrEqual(21);
      expect(requests.every((u) => u.startsWith('https://s3.amazonaws.com/elevation-tiles-prod/terrarium/14/'))).toBe(true);
      expect(result.report.pointsCorrected).toBeGreaterThan(0);
      expect(result.activity.metadata.altitudeCorrection?.source).toBe('gsi-mapzen');
    } finally {
      globalThis.fetch = originalFetch;
      globals.createImageBitmap = originalBitmap;
      globals.OffscreenCanvas = originalCanvas;
    }
  });

  test('one anchor in a short ride yields a partial constant offset', async () => {
    const activity = makeTrack(45);
    const result = await correctTrackActivityAltitudes(activity, { source: fakeSource(), anchorCount: 1 });
    expect(result.status).toBe('partial');
    expect(result.report.anchorsUsed).toBe(1);
  });

  test('one anchor in a long ride does not make unbounded extrapolations', async () => {
    const activity = makeTrack();
    const result = await correctTrackActivityAltitudes(activity, { source: fakeSource(), anchorCount: 1 });
    expect(result.status).toBe('skipped');
    expect(result.activity).toBe(activity);
  });

  test('independent segments never share their anchor drift', async () => {
    const activity = makeTrack(300, 2);
    const start = 301;
    for (let i = start; i < activity.points.length; i++) {
      if (activity.points[i].altitudeM !== undefined) activity.points[i].altitudeM! += 70;
    }
    const result = await correctTrackActivityAltitudes(activity, { source: fakeSource() });
    expect(result.status).toBe('corrected');
    expect(result.activity.points[100].altitudeM).toBeCloseTo(terrain(activity.points[100].lat!), 0);
    expect(result.activity.points[401].altitudeM).toBeCloseTo(terrain(activity.points[401].lat!), 0);
  });

  test('invalid DEM or source exception skips rather than aborting conversion', async () => {
    const activity = makeTrack();
    const source = fakeSource({ async getElevations() { throw new Error('offline'); } });
    const result = await correctTrackActivityAltitudes(activity, { source });
    expect(result.status).toBe('skipped');
    expect(result.activity).toBe(activity);
    expect(result.activity.metadata.ascentM).toBe(9);
  });

  test('budget manager avoids duplicate network requests and caps at maximum', async () => {
    const activity = makeTrack();
    const requests: string[] = [];
    const oldFetch = globalThis.fetch;
    globalThis.fetch = (async (url: string) => {
      requests.push(url);
      return { ok: true, status: 200, arrayBuffer: async () => new ArrayBuffer(1) } as Response;
    }) as typeof fetch;
    try {
      const source = fakeSource({
        async getElevations(group, positions, context) {
          const result = await context.fetchBytes(`https://example.org/base/${group}`);
          await context.fetchBytes(`https://example.org/base/${group}`);
          return result ? positions.map(({ lat }) => ({ elevationM: terrain(lat), dataset: 'DEM10B' })) : [];
        },
        async getHigherResolutionElevations(group, positions, level, context) {
          await context.fetchBytes(`https://example.org/high/${group}/${level}`);
          return positions.map(({ lat }) => ({ elevationM: terrain(lat), dataset: 'DEM5A' }));
        },
      });
      const result = await correctTrackActivityAltitudes(activity, { source, maxTileRequests: 7 });
      expect(result.report.tileRequests).toBeLessThanOrEqual(7);
      expect(result.report.tileRequests).toBe(requests.length);
      expect(new Set(requests).size).toBe(requests.length);
    } finally { globalThis.fetch = oldFetch; }
  });

  test('averaging suppresses isolated bridge/GPS-height outliers', async () => {
    const activity = makeTrack();
    for (let i = 17; i < 600; i += 17) activity.points[i].altitudeM! += 140;
    const result = await correctTrackActivityAltitudes(activity, { source: fakeSource() });
    expect(result.status).toBe('corrected');
    const cleanPoint = result.activity.points[300];
    expect(Math.abs(cleanPoint.altitudeM! - terrain(cleanPoint.lat!))).toBeLessThan(1);
  });

  test('revisiting the same tile needs one downloaded raster but separate time anchors', async () => {
    const activity = makeTrack();
    const urls: string[] = [];
    const oldFetch = globalThis.fetch;
    globalThis.fetch = (async (url: string) => {
      urls.push(url);
      return { ok: true, status: 200, arrayBuffer: async () => new ArrayBuffer(1) } as Response;
    }) as typeof fetch;
    try {
      const source = fakeSource({
        getGroupKey() { return 'one-tile'; },
        async getElevations(key, positions, context) {
          await context.fetchBytes(`https://example.org/${key}`);
          return positions.map(({ lat }) => ({ elevationM: terrain(lat), dataset: 'DEM10B' }));
        },
      });
      const result = await correctTrackActivityAltitudes(activity, { source });
      expect(result.report.anchorsUsed).toBe(9);
      expect(result.report.tileRequests).toBe(1);
      expect(urls).toEqual(['https://example.org/one-tile']);
      expect(result.report.anchors[0].driftM).not.toBe(result.report.anchors[8].driftM);
    } finally { globalThis.fetch = oldFetch; }
  });

  test('upgrades the quality of an anchor when high-resolution tiles are available', async () => {
    const activity = makeTrack();
    const source = fakeSource({
      async getHigherResolutionElevations(_key, positions) {
        return positions.map(({ lat }) => ({ elevationM: terrain(lat), dataset: 'DEM5A' }));
      },
    });
    const result = await correctTrackActivityAltitudes(activity, { source });
    expect(result.status).toBe('corrected');
    expect(result.report.anchors.every((a) => a.dataset === 'DEM5A')).toBe(true);
  });

  test('long stationary recordings do not become artificial reference distance', async () => {
    const activity = makeTrack();
    activity.points.forEach((point) => { point.lat = 35; point.lon = 139; });
    const result = await correctTrackActivityAltitudes(activity, { source: fakeSource() });
    expect(result.status).toBe('skipped');
    expect(result.report.anchorsUsed).toBe(0);
    expect(result.activity).toBe(activity);
  });

  test('disabled network budget still returns original data without throwing', async () => {
    const activity = makeTrack();
    const source = fakeSource({
      async getElevations(key, positions, context) {
        const result = await context.fetchBytes(`https://example.org/${key}`);
        return result ? positions.map(({ lat }) => ({ elevationM: terrain(lat), dataset: 'DEM10B' })) : [];
      },
    });
    const result = await correctTrackActivityAltitudes(activity, { source, maxTileRequests: 0 });
    expect(result.status).toBe('skipped');
    expect(result.report.tileRequests).toBe(0);
    expect(result.activity).toBe(activity);
  });

  test('an aborted run does not emit a partially corrected activity', async () => {
    const activity = makeTrack();
    const controller = new AbortController();
    const source = fakeSource({ async getElevations(_key, positions) {
      controller.abort();
      return positions.map(({ lat }) => ({ elevationM: terrain(lat), dataset: 'DEM10B' }));
    } });
    const result = await correctTrackActivityAltitudes(activity, { source, signal: controller.signal });
    expect(result.status).toBe('skipped');
    expect(result.report.reason).toBe('cancelled');
    expect(result.activity).toBe(activity);
  });

  test('HTTP 429 stops further tile requests, with best-effort skip', async () => {
    const activity = makeTrack();
    const requests: string[] = [];
    const oldFetch = globalThis.fetch;
    globalThis.fetch = (async (url: string) => {
      requests.push(url);
      return { ok: false, status: 429 } as Response;
    }) as typeof fetch;
    try {
      const source = fakeSource({
        async getElevations(group, _positions, context) {
          await context.fetchBytes(`https://example.org/${group}`);
          return [];
        },
      });
      const result = await correctTrackActivityAltitudes(activity, { source });
      expect(result.status).toBe('skipped');
      expect(result.report.reason).toBe('network_unavailable');
      expect(requests).toEqual([requests[0]]);
      expect(result.report.tileRequests).toBe(1);
    } finally { globalThis.fetch = oldFetch; }
  });

  test('PNG tile adapter decodes one raster for every point in its group', async () => {
    const pos = { lat: 35, lon: 139 };
    const raster = new Uint8ClampedArray(256 * 256 * 4);
    for (let i = 0; i < 256 * 256; i++) {
      raster[i * 4 + 2] = 200;
      raster[i * 4 + 3] = 255;
    }
    const environment = globalThis as unknown as Record<string, unknown>;
    const originalBitmap = environment.createImageBitmap;
    const originalCanvas = environment.OffscreenCanvas;
    environment.createImageBitmap = async () => ({ width: 256, height: 256, close() {} });
    environment.OffscreenCanvas = class {
      getContext() {
        return { drawImage() {}, getImageData() { return { data: raster }; } };
      }
    };
    try {
      const source = createGsiElevationSource();
      const calls: string[] = [];
      const context = {
        async fetchBytes(url: string) { calls.push(url); return new ArrayBuffer(8); },
      };
      const values = await source.getElevations(source.getGroupKey(pos)!, [pos, pos], context);
      expect(values).toEqual([
        { elevationM: 2, dataset: 'DEM10B' },
        { elevationM: 2, dataset: 'DEM10B' },
      ]);
      expect(calls).toEqual([calls[0]]);
      expect(calls[0]).toContain('/dem_png/14/');
    } finally {
      environment.createImageBitmap = originalBitmap;
      environment.OffscreenCanvas = originalCanvas;
    }
  });

  test('GSI xyz selection and RGB signed elevation encoding', () => {
    const pos = { lat: 35, lon: 139 };
    const tile = getGsiTileAddress(pos, 15)!;
    const parent = getGsiTileAddress(pos, 14)!;
    expect(Math.floor(tile.x / 2)).toBe(parent.x);
    expect(Math.floor(tile.y / 2)).toBe(parent.y);
    expect(tile.px).toBeGreaterThanOrEqual(0);
    expect(tile.px).toBeLessThan(256);
    expect(getGsiTileAddress({ lat: 90, lon: 139 }, 15)).toBeUndefined();
    expect(decodeGsiElevationRgb(0, 0, 0)).toBe(0);
    expect(decodeGsiElevationRgb(0, 0, 100)).toBe(1);
    expect(decodeGsiElevationRgb(255, 255, 156)).toBeCloseTo(-1);
    expect(decodeGsiElevationRgb(128, 0, 0)).toBeUndefined();
    const rgba = new Uint8ClampedArray(256 * 256 * 4);
    rgba.set([0, 0, 100, 255], (10 * 256 + 20) * 4);
    expect(readGsiElevationPixel(rgba, 20, 10)).toBe(1);
    expect(readGsiElevationPixel(rgba, -1, 10)).toBeUndefined();
    expect(createGsiElevationSource().getGroupKey(pos)).toBe(`${tile.x}/${tile.y}`);
  });
});


describe('regional GSI-first fallback', () => {
  /** The fake browser decoder changes terrain raster based on the HTTP tile.
   * This exercises the real adapters, request manager, and default source. */
  async function withTerrainRequests(
    gsiStatus: number,
    action: (requests: string[]) => Promise<void>,
    gsiNoData = false,
  ): Promise<void> {
    const requests: string[] = [];
    const originalFetch = globalThis.fetch;
    const globals = globalThis as unknown as Record<string, unknown>;
    const originalBitmap = globals.createImageBitmap;
    const originalCanvas = globals.OffscreenCanvas;
    const originalBlob = globals.Blob;
    // Jest's jsdom Blob lacks arrayBuffer(); use Node's implementation only
    // inside this test so the fake PNG decoder can inspect its payload.
    globals.Blob = NodeBlob;
    globals.createImageBitmap = async (blob: Blob) => {
      const bytes = new Uint8Array(await blob.arrayBuffer());
      return { width: 256, height: 256, source: bytes[32], close() {} };
    };
    globals.OffscreenCanvas = class {
      private source = 0;
      getContext() {
        return {
          drawImage: (bitmap: { source: number }) => { this.source = bitmap.source; },
          getImageData: () => {
            const data = new Uint8ClampedArray(256 * 256 * 4);
            for (let i = 0; i < 256 * 256; i++) {
              if (this.source === 1) { // GSI 100m: 10000cm, or its no-data sentinel
                data[i * 4] = gsiNoData ? 128 : 0;
                data[i * 4 + 1] = gsiNoData ? 0 : 39;
                data[i * 4 + 2] = gsiNoData ? 0 : 16;
              } else { // Terrarium 100m
                data[i * 4] = 128; data[i * 4 + 1] = 100;
              }
              data[i * 4 + 3] = 255;
            }
            return { data };
          },
        };
      }
    };
    globalThis.fetch = (async (url: string) => {
      requests.push(url);
      const gsi = url.includes('cyberjapandata.gsi.go.jp');
      const status = gsi ? gsiStatus : 200;
      return { ok: status === 200, status, arrayBuffer: async () => {
        const bytes = new Uint8Array(33);
        bytes.set([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82]);
        bytes[32] = gsi ? 1 : 2;
        return bytes.buffer;
      } } as Response;
    }) as typeof fetch;
    try { await action(requests); }
    finally {
      globalThis.fetch = originalFetch;
      globals.createImageBitmap = originalBitmap;
      globals.OffscreenCanvas = originalCanvas;
      globals.Blob = originalBlob;
    }
  }

  test('Japan prefers GSI and never downloads Mapzen if GSI references are valid', async () => {
    await withTerrainRequests(200, async (requests) => {
      const result = await correctTrackActivityAltitudes(makeTrack());
      expect(result.report.sourceId).toBe('gsi-mapzen');
      expect(result.report.anchorsUsed).toBe(9);
      expect(result.report.anchors.every((a) => a.dataset.startsWith('DEM'))).toBe(true);
      expect(requests.length).toBeGreaterThan(0);
      expect(requests.every((u) => u.includes('cyberjapandata.gsi.go.jp'))).toBe(true);
    });
  });

  test('a Japanese GSI 404 falls back to Mapzen, without exceeding request budget', async () => {
    await withTerrainRequests(404, async (requests) => {
      const result = await correctTrackActivityAltitudes(makeTrack());
      expect(result.report.anchorsUsed).toBe(9);
      expect(result.report.anchors.every((a) => a.dataset === 'Mapzen Terrarium')).toBe(true);
      expect(requests.some((u) => u.includes('cyberjapandata.gsi.go.jp'))).toBe(true);
      expect(requests.some((u) => u.includes('elevation-tiles-prod/terrarium/'))).toBe(true);
      expect(requests.length).toBeLessThanOrEqual(21);
      expect(result.status).toBe('corrected');
    });
  });

  test('GSI returns no-data pixels: uses Mapzen terrain instead', async () => {
    await withTerrainRequests(200, async (requests) => {
      const result = await correctTrackActivityAltitudes(makeTrack());
      expect(result.report.anchorsUsed).toBe(9);
      expect(result.report.anchors.every((a) => a.dataset === 'Mapzen Terrarium')).toBe(true);
      expect(requests.some((u) => u.includes('cyberjapandata.gsi.go.jp'))).toBe(true);
      expect(requests.some((u) => u.includes('elevation-tiles-prod/terrarium/'))).toBe(true);
      expect(requests.length).toBeLessThanOrEqual(21);
    }, true);
  });

  test('GSI rate limiting only blocks GSI, not Mapzen fallback', async () => {
    await withTerrainRequests(429, async (requests) => {
      const result = await correctTrackActivityAltitudes(makeTrack());
      expect(result.report.anchorsUsed).toBe(9);
      expect(result.report.anchors.every((a) => a.dataset === 'Mapzen Terrarium')).toBe(true);
      expect(requests.filter((u) => u.includes('cyberjapandata.gsi.go.jp'))).toHaveLength(1);
      expect(requests.some((u) => u.includes('elevation-tiles-prod/terrarium/'))).toBe(true);
    });
  });

  test('overseas routes use Mapzen without attempting GSI', async () => {
    await withTerrainRequests(404, async (requests) => {
      const activity = makeTrack();
      activity.points.forEach((p) => { if (p.lat !== undefined) p.lat += 13; });
      const result = await correctTrackActivityAltitudes(activity);
      expect(result.report.anchorsUsed).toBeGreaterThan(0);
      expect(requests.length).toBeGreaterThan(0);
      expect(requests.every((u) => u.includes('elevation-tiles-prod/terrarium/'))).toBe(true);
    });
  });
});
