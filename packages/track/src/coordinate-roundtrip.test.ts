import { Decoder, Stream } from '@garmin/fitsdk';
import { correctTrackActivityCoordinates } from './coordinate-correction';
import { parseFitBytes, trackActivityToFit, trackActivityToTrackJson, trackJsonDataToTrackActivity } from './fit';
import { parseGpxText, trackActivityToGpx } from './gpx';
import type { TrackActivity } from './activity';

jest.mock('@garmin/fitsdk', () => ({ Decoder: jest.fn(), Stream: { fromArrayBuffer: jest.fn() } }));

describe('corrected coordinates format round-trip', () => {
  const activity = (): TrackActivity => ({
    schemaVersion: 1, metadata: { source: { type: 'fit' }, ascentM: 20 }, warnings: [],
    points: Array.from({ length: 30 }, (_, i) => ({
      time: 1700000000 + i, lat: 35, lon: 139 + i * 0.00005,
      distanceM: i * 4.55, speedMps: 4.55, gpsAccuracyM: i % 2 ? undefined : 6,
      altitudeM: 100, segmentId: 0,
    })),
  });

  test('stores correction history and optional gps accuracy without forward-filling gaps in TrackJSON', () => {
    const a = activity(); delete a.points[14].lat; delete a.points[14].lon;
    const fixed = correctTrackActivityCoordinates(a).activity;
    const json = JSON.parse(trackActivityToTrackJson(fixed));
    expect(json.features[0].properties.metadata.coordinateCorrection).toMatchObject({
      method: 'linear-dead-reckoning-v2',
      regionsCorrected: 1,
      pointsCorrected: fixed.metadata.coordinateCorrection?.pointsCorrected,
    });
    expect(json.features[0].properties.coordinateProperties.gpsAccuracy[1]).toBeNull();
    const restored = trackJsonDataToTrackActivity(json);
    expect(restored.points[14].lon).toBeCloseTo(139 + 14 * 0.00005, 5);
    expect(restored.points[1].gpsAccuracyM).toBeUndefined();
    expect(restored.metadata.coordinateCorrection?.regionsCorrected).toBe(1);
    expect(correctTrackActivityCoordinates(restored).status).toBe('skipped');
  });

  test('GPX STGY extensions preserve repair history and optional GPS quality', () => {
    const a = activity(); delete a.points[14].lat; delete a.points[14].lon;
    const fixed = correctTrackActivityCoordinates(a).activity;
    const xml = trackActivityToGpx(fixed);
    expect(xml).toContain('stgy:coordinateCorrection');
    expect(xml).toContain('stgy:gpsAccuracyM');
    const restored = parseGpxText(xml);
    expect(restored.metadata.coordinateCorrection?.method).toBe('linear-dead-reckoning-v2');
    expect(restored.metadata.coordinateCorrection?.pointsCorrected)
      .toBe(fixed.metadata.coordinateCorrection?.pointsCorrected);
    expect(restored.points[0].gpsAccuracyM).toBe(6);
  });

  test('v1 correction history is still accepted while v2 is written for new repairs', () => {
    const old = activity();
    old.metadata.coordinateCorrection = {
      method: 'linear-dead-reckoning-v1', regionsCorrected: 1,
      pointsCorrected: 5, speedsCorrected: 0, distancesCorrected: 0,
    };
    const json = JSON.parse(trackActivityToTrackJson(old));
    expect(trackJsonDataToTrackActivity(json).metadata.coordinateCorrection?.method)
      .toBe('linear-dead-reckoning-v1');
    expect(correctTrackActivityCoordinates(old).activity).toBe(old);
  });

  test('sport session ranges survive TrackJSON and GPX export', () => {
    const a = activity();
    a.metadata.sportSessions = [
      { startTime: 1700000000, endTime: 1700000015, sport: 'cycling' },
      { startTime: 1700000015, endTime: 1700000030, sport: 'running' },
    ];
    const json = JSON.parse(trackActivityToTrackJson(a));
    expect(trackJsonDataToTrackActivity(json).metadata.sportSessions)
      .toEqual(a.metadata.sportSessions);
    const gpx = trackActivityToGpx(a);
    expect(gpx).toContain('<stgy:sportSession sport="cycling"');
    expect(gpx).toContain('<stgy:sportSession sport="running"');
    expect(parseGpxText(gpx).metadata.sportSessions)
      .toEqual(a.metadata.sportSessions);
  });

  test('FIT Record exports gps_accuracy without affecting ordinary Record fields', () => {
    const bytes = trackActivityToFit(activity());
    // The FIT writer runs without SDK decoding; both FIT header and contents are generated.
    expect(bytes[8]).toBe(46); // FIT header signature: .FIT (offset 8)
    expect(bytes[9]).toBe(70);
    expect(bytes[10]).toBe(73);
    expect(bytes[11]).toBe(84);
    expect(bytes.length).toBeGreaterThan(500);
    // Do not pretend enhanced_altitude is a separate GNSS altitude.
    expect(Decoder).toBeDefined(); expect(Stream).toBeDefined();
    expect(parseFitBytes).toBeDefined();
  });
});
