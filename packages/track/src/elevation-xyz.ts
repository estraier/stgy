/** Shared 256px XYZ Web-Mercator coordinate mapping (EPSG:3857). */
import type { ElevationCoordinate } from './altitude-correction';
const TILE_SIZE = 256;
const MAX_LATITUDE = 85.05112878;

export interface ElevationTileAddress { z: number; x: number; y: number; px: number; py: number }

export function getElevationTileAddress(position: ElevationCoordinate, z: number): ElevationTileAddress | undefined {
  const { lat, lon } = position;
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > MAX_LATITUDE || lon < -180 || lon > 180) return undefined;
  const n = 2 ** z;
  const fx = Math.min(n - Number.EPSILON * n, ((lon + 180) / 360) * n);
  const rad = lat * Math.PI / 180;
  const fy = (1 - Math.asinh(Math.tan(rad)) / Math.PI) * n / 2;
  const x = Math.max(0, Math.min(n - 1, Math.floor(fx)));
  const y = Math.max(0, Math.min(n - 1, Math.floor(fy)));
  return { z, x, y, px: Math.min(255, Math.floor((fx - x) * TILE_SIZE)), py: Math.min(255, Math.floor((fy - y) * TILE_SIZE)) };
}

