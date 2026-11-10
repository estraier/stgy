/** Mapzen Terrain Tiles / Terrarium (AWS Open Data), world-wide DEM source.
 * Each z=14 PNG contains 256x256 encoded elevation samples in EPSG:3857.
 * Public endpoint: https://www.mapzen.com/blog/terrain-tile-service/
 */
import type { ElevationCoordinate, ElevationRequestContext, ElevationSample, ElevationSource } from './altitude-correction';
import { getElevationTileAddress } from './elevation-xyz';
import { decodeElevationPng } from './elevation-png';

const ENDPOINT = 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium';
const ZOOM = 14;
const TILE_SIZE = 256;

/** Terrarium RGB values use a 32768m offset and 1/256m fractional steps. */
export function decodeTerrariumRgb(red: number, green: number, blue: number): number | undefined {
  // The all-zero code (-32768m) is the no-data sentinel, not a terrain height.
  if (red === 0 && green === 0 && blue === 0) return undefined;
  return red * 256 + green + blue / 256 - 32768;
}

export function readTerrariumElevationPixel(rgba: Uint8ClampedArray, x: number, y: number): number | undefined {
  const offset = (y * TILE_SIZE + x) * 4;
  if (!Number.isInteger(x) || !Number.isInteger(y) || x < 0 || x >= TILE_SIZE || y < 0 || y >= TILE_SIZE ||
    offset + 3 >= rgba.length || rgba[offset + 3] === 0) return undefined;
  return decodeTerrariumRgb(rgba[offset], rgba[offset + 1], rgba[offset + 2]);
}

/** Web Mercator XYZ addressing is the same for GSI and Mapzen. */
export function getMapzenTileAddress(position: ElevationCoordinate) {
  return getElevationTileAddress(position, ZOOM);
}

export function createMapzenElevationSource(): ElevationSource {
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
      // If the request budget was temporarily reserved or the request failed,
      // leave an opportunity to retry later in the same conversion.
      void task.then(
        (raster) => { if (!raster && decoded.get(url) === task) decoded.delete(url); },
        () => { if (decoded.get(url) === task) decoded.delete(url); },
      );
    }
    return task;
  }
  return {
    id: 'mapzen-terrarium',
    getGroupKey(position) {
      const tile = getMapzenTileAddress(position);
      return tile ? `${tile.x}/${tile.y}` : undefined;
    },
    async getElevations(_groupKey, positions, context) {
      if (!positions.length) return [];
      const first = getMapzenTileAddress(positions[0]);
      if (!first) return positions.map(() => undefined);
      const url = `${ENDPOINT}/${ZOOM}/${first.x}/${first.y}.png`;
      const raster = await getRaster(url, context);
      if (!raster) return positions.map(() => undefined);
      return positions.map((position): ElevationSample | undefined => {
        const tile = getMapzenTileAddress(position);
        if (!tile || tile.x !== first.x || tile.y !== first.y) return undefined;
        const elevationM = readTerrariumElevationPixel(raster, tile.px, tile.py);
        return elevationM === undefined ? undefined : { elevationM, dataset: 'Mapzen Terrarium' };
      });
    },
  };
}
