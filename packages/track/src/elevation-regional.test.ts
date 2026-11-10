import { createRegionalElevationSource } from './elevation-regional';

describe('regional GSI-first source selection', () => {
  test('selects GSI in Japan and Mapzen for overseas positions without key collisions', () => {
    const source = createRegionalElevationSource();
    const jp = source.getGroupKey({ lat: 35, lon: 139 });
    const fr = source.getGroupKey({ lat: 48.8566, lon: 2.3522 });
    expect(source.id).toBe('gsi-mapzen');
    expect(jp?.startsWith('gsi:')).toBe(true);
    expect(fr?.startsWith('mapzen:')).toBe(true);
    expect(jp).not.toBe(fr);
    expect(source.getGroupKey({ lat: 90, lon: 0 })).toBeUndefined();
  });
});
