import { JAPAN_AREAS } from "./areas";

/**
 * Determines if the given coordinates are within the defined Japanese areas.
 * @param lat Latitude
 * @param lon Longitude
 */
export const isJapan = (lat: number, lon: number): boolean => {
  // Returns true if the point is contained in any of the defined rectangles
  return JAPAN_AREAS.some(([minLat, minLon, maxLat, maxLon]) => {
    return lat >= minLat && lat <= maxLat && lon >= minLon && lon <= maxLon;
  });
};
