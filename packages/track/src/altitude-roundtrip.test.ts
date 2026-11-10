import { trackJsonDataToTrackActivity, trackActivityToTrackJson } from './fit';
import { parseGpxText, trackActivityToGpx } from './gpx';
import type { TrackActivity } from './activity';

// The round-trip tests use TrackJSON serializers, not the Garmin FIT decoder.
// Mock the ESM-only SDK so Jest can load the CommonJS-compiled fit module.
jest.mock('@garmin/fitsdk', () => ({
  Decoder: jest.fn(),
  Stream: { fromArrayBuffer: jest.fn() },
}));

const input: TrackActivity = {
  schemaVersion: 1,
  metadata: { name: 'Corrected', ascentM: 12, descentM: 13,
    altitudeCorrection: { method: 'terrain-drift-v1', source: 'gsi-dem', anchorsUsed: 4, status: 'partial' } },
  points: [
    { time: 1000, lat: 35, lon: 139, altitudeM: 20, segmentId: 0 },
    { time: 1010, lat: 35.001, lon: 139.001, altitudeM: 25, segmentId: 0 },
    { time: 1020, lat: 35.002, lon: 139.002, altitudeM: 24, segmentId: 0 },
  ],
  warnings: [],
};

describe('altitude correction serialization', () => {
  test('TrackJSON retains correction history and corrected heights', () => {
    const converted = trackJsonDataToTrackActivity(JSON.parse(trackActivityToTrackJson(input)));
    expect(converted.metadata.altitudeCorrection).toEqual(input.metadata.altitudeCorrection);
    expect(converted.points.filter((p) => p.altitudeM !== undefined).map((p) => p.altitudeM)).toEqual([20, 25, 24]);
    expect(converted.metadata.ascentM).toBe(12);
  });
  test('GPX extension retains correction history and recorded height', () => {
    const serialized = trackActivityToGpx(input);
    expect(serialized).toContain('stgy:altitudeCorrection');
    const parsed = parseGpxText(serialized);
    expect(parsed.metadata.altitudeCorrection).toEqual(input.metadata.altitudeCorrection);
    expect(parsed.points.filter((p) => p.altitudeM !== undefined).map((p) => p.altitudeM)).toEqual([20, 25, 24]);
  });
  test('malformed correction history is ignored on TrackJSON read', () => {
    const output = JSON.parse(trackActivityToTrackJson(input));
    output.features[0].properties.metadata.altitudeCorrection = { method: 'terrain-drift-v1', source: '', anchorsUsed: -4, status: 'corrected' };
    const parsed = trackJsonDataToTrackActivity(output);
    expect(parsed.metadata.altitudeCorrection).toBeUndefined();
  });
});
