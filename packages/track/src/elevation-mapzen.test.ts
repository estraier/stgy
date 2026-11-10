import {
  createMapzenElevationSource, decodeTerrariumRgb, getMapzenTileAddress, readTerrariumElevationPixel,
} from './elevation-mapzen';

describe('Mapzen Terrarium elevation tiles', () => {
  test('RGB decoding handles zero, negative, positive, fractions, and nodata', () => {
    expect(decodeTerrariumRgb(128, 0, 0)).toBe(0);
    expect(decodeTerrariumRgb(128, 100, 128)).toBe(100.5);
    expect(decodeTerrariumRgb(127, 255, 0)).toBe(-1);
    expect(decodeTerrariumRgb(0, 0, 0)).toBeUndefined();
    const pixels = new Uint8ClampedArray(256 * 256 * 4);
    pixels[0] = 128; pixels[1] = 100; pixels[2] = 128; pixels[3] = 255;
    expect(readTerrariumElevationPixel(pixels, 0, 0)).toBe(100.5);
    expect(readTerrariumElevationPixel(pixels, 1, 0)).toBeUndefined();
    expect(readTerrariumElevationPixel(pixels, -1, 0)).toBeUndefined();
    expect(readTerrariumElevationPixel(pixels, 256, 0)).toBeUndefined();
  });

  test('z14 Web Mercator addressing accepts overseas and Japan, rejects invalid latitudes', () => {
    for (const p of [{ lat: 35, lon: 139 }, { lat: 48, lon: 2 }, { lat: -33, lon: 151 }]) {
      const tile = getMapzenTileAddress(p)!;
      expect(tile.z).toBe(14);
      expect(tile.px).toBeGreaterThanOrEqual(0);
      expect(tile.px).toBeLessThan(256);
      expect(tile.py).toBeGreaterThanOrEqual(0);
      expect(tile.py).toBeLessThan(256);
    }
    expect(getMapzenTileAddress({ lat: 90, lon: 139 })).toBeUndefined();
  });

  test('one downloaded PNG supplies all coordinates in a tile, including repeated points', async () => {
    const pixels = new Uint8ClampedArray(256 * 256 * 4);
    for (let i = 0; i < 256 * 256; i++) {
      pixels[4 * i] = 128;
      pixels[4 * i + 1] = 220;
      pixels[4 * i + 2] = 128;
      pixels[4 * i + 3] = 255;
    }
    const globals = globalThis as unknown as Record<string, unknown>;
    const oldBitmap = globals.createImageBitmap;
    const oldCanvas = globals.OffscreenCanvas;
    const closed = jest.fn();
    globals.createImageBitmap = async () => ({ width: 256, height: 256, close: closed });
    globals.OffscreenCanvas = class {
      getContext() { return { drawImage() {}, getImageData() { return { data: pixels }; } }; }
    };
    try {
      const source = createMapzenElevationSource();
      const france = { lat: 48.8566, lon: 2.3522 };
      const london = { lat: 51.5072, lon: -0.1276 };
      const requests: string[] = [];
      const ctx = { async fetchBytes(url: string) { requests.push(url); return new ArrayBuffer(33); } };
      const values = await source.getElevations(source.getGroupKey(france)!, [france, france, london], ctx);
      expect(values).toEqual([
        { elevationM: 220.5, dataset: 'Mapzen Terrarium' },
        { elevationM: 220.5, dataset: 'Mapzen Terrarium' },
        undefined,
      ]);
      expect(requests).toHaveLength(1);
      const tile = getMapzenTileAddress(france)!;
      expect(requests[0]).toBe(`https://s3.amazonaws.com/elevation-tiles-prod/terrarium/14/${tile.x}/${tile.y}.png`);
      expect(closed).toHaveBeenCalledTimes(1);
    } finally {
      globals.createImageBitmap = oldBitmap;
      globals.OffscreenCanvas = oldCanvas;
    }
  });

  test('network failure and invalid coordinates return missing samples, not exceptions', async () => {
    const source = createMapzenElevationSource();
    const coords = [{ lat: -34, lon: 151 }];
    const context = { async fetchBytes() { return undefined; } };
    expect(await source.getElevations(source.getGroupKey(coords[0])!, coords, context)).toEqual([undefined]);
    expect(await source.getElevations('?', [{ lat: 90, lon: 151 }], context)).toEqual([undefined]);
    expect(await source.getElevations('?', [], context)).toEqual([]);
  });
});
