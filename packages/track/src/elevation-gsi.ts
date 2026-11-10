import { decodeElevationPng } from './elevation-png';
import { isJapan } from './geo';
import { getElevationTileAddress as getGsiTileAddress } from './elevation-xyz';
export { getElevationTileAddress as getGsiTileAddress } from './elevation-xyz';
export type { ElevationTileAddress as GsiTileAddress } from './elevation-xyz';
import type { ElevationCoordinate, ElevationRequestContext, ElevationSample, ElevationSource } from './altitude-correction';

const ENDPOINT = 'https://cyberjapandata.gsi.go.jp/xyz';
const TILE_SIZE = 256;

export function decodeGsiElevationRgb(red: number, green: number, blue: number): number | undefined {
  const encoded = red * 65536 + green * 256 + blue;
  if (encoded === 0x800000) return undefined;
  return (encoded < 0x800000 ? encoded : encoded - 0x1000000) * 0.01;
}

export function readGsiElevationPixel(rgba: Uint8ClampedArray, x: number, y: number): number | undefined {
  const offset = (y * TILE_SIZE + x) * 4;
  if (x < 0 || x >= TILE_SIZE || y < 0 || y >= TILE_SIZE || offset + 3 >= rgba.length || rgba[offset + 3] === 0) return undefined;
  return decodeGsiElevationRgb(rgba[offset], rgba[offset + 1], rgba[offset + 2]);
}


export function createGsiElevationSource(): ElevationSource {
  const decoded = new Map<string, Promise<Uint8ClampedArray | undefined>>();
  async function getRaster(url: string, context: ElevationRequestContext): Promise<Uint8ClampedArray | undefined> {
    let task = decoded.get(url);
    if (!task) {
      task = (async () => {
        const bytes = await context.fetchBytes(url);
        if (!bytes) return undefined;
        try { return await decodeElevationPng(bytes); } catch { return undefined; }
      })();
      decoded.set(url, task);
      // An unavailable tile may become fetchable after the network reservation changes.
      void task.then(
        (raster) => { if (!raster && decoded.get(url) === task) decoded.delete(url); },
        () => { if (decoded.get(url) === task) decoded.delete(url); },
      );
    }
    return task;
  }
  async function getSamples(
    positions: readonly ElevationCoordinate[], dataset: string, z: number,
    context: ElevationRequestContext,
  ): Promise<readonly (ElevationSample | undefined)[]> {
    // Every call is scoped to one z=15 group, hence one URL at each requested zoom.
    const first = getGsiTileAddress(positions[0], z);
    if (!first) return positions.map(() => undefined);
    const url = `${ENDPOINT}/${dataset}/${z}/${first.x}/${first.y}.png`;
    const raster = await getRaster(url, context);
    if (!raster) return positions.map(() => undefined);
    return positions.map((position) => {
      const tile = getGsiTileAddress(position, z);
      if (!tile || tile.x !== first.x || tile.y !== first.y) return undefined;
      const altitude = readGsiElevationPixel(raster, tile.px, tile.py);
      return altitude === undefined ? undefined : { elevationM: altitude, dataset: dataset === 'dem_png' ? 'DEM10B' : dataset.slice(0, 5).toUpperCase() };
    });
  }
  return {
    id: 'gsi-dem',
    supportsCoordinate({ lat, lon }) { return isJapan(lat, lon); },
    getGroupKey(position) {
      const tile = getGsiTileAddress(position, 15);
      return tile ? `${tile.x}/${tile.y}` : undefined;
    },
    getElevations(_groupKey, positions, context) { return getSamples(positions, 'dem_png', 14, context); },
    getHigherResolutionElevations(_groupKey, positions, level, context) {
      const datasets = ['dem5a_png', 'dem5b_png', 'dem5c_png'];
      return getSamples(positions, datasets[level] || datasets[0], 15, context);
    },
  };
}
