/** Regional terrain reference selection. GSI in Japan; Mapzen elsewhere and
 * as a fallback when a Japanese GSI reference cannot be estimated reliably.
 * The region key is source-prefixed; both providers have separate URL keys in
 * the 24h IndexedDB cache.
 */
import type { ElevationCoordinate, ElevationRequestContext, ElevationSample, ElevationSource } from './altitude-correction';
import { createGsiElevationSource } from './elevation-gsi';
import { createMapzenElevationSource } from './elevation-mapzen';
import { isJapan } from './geo';

export function createRegionalElevationSource(): ElevationSource {
  const gsi = createGsiElevationSource();
  const mapzen = createMapzenElevationSource();
  const isGsiKey = (key: string) => key.startsWith('gsi:');
  const innerKey = (key: string) => key.slice(key.indexOf(':') + 1);
  return {
    id: 'gsi-mapzen',
    getGroupKey(position: ElevationCoordinate) {
      const useGsi = isJapan(position.lat, position.lon);
      const selected = useGsi ? gsi : mapzen;
      const key = selected.getGroupKey(position);
      return key === undefined ? undefined : `${useGsi ? 'gsi' : 'mapzen'}:${key}`;
    },
    getElevations(groupKey: string, positions: readonly ElevationCoordinate[], context: ElevationRequestContext) {
      return (isGsiKey(groupKey) ? gsi : mapzen).getElevations(innerKey(groupKey), positions, context);
    },
    async getFallbackElevations(groupKey: string, positions: readonly ElevationCoordinate[], context: ElevationRequestContext): Promise<readonly (ElevationSample | undefined)[]> {
      if (!isGsiKey(groupKey) || !positions.length) return positions.map(() => undefined);
      // A GSI z15 tile lies wholly inside one Mapzen z14 tile. The Mapzen
      // adapter rejects any points not belonging to its chosen parent tile.
      const mapzenKey = mapzen.getGroupKey(positions[0]);
      return mapzenKey ? mapzen.getElevations(mapzenKey, positions, context) : positions.map(() => undefined);
    },
    canUpgradeAnchor(groupKey: string, dataset: string) {
      return isGsiKey(groupKey) && (dataset === 'DEM10B' || dataset === 'Mapzen Terrarium');
    },
    getHigherResolutionElevations(groupKey: string, positions: readonly ElevationCoordinate[], level: number, context: ElevationRequestContext) {
      if (!isGsiKey(groupKey)) return Promise.resolve(positions.map(() => undefined));
      return gsi.getHigherResolutionElevations!(innerKey(groupKey), positions, level, context);
    },
  };
}
