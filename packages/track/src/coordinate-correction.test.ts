import type { TrackActivity, TrackPoint } from './activity';
import { correctTrackActivityCoordinates } from './coordinate-correction';
import type { CoordinateCorrectionDiagnostic } from './coordinate-correction';

function makeTrack(count = 30): TrackActivity {
  const points: TrackPoint[] = Array.from({ length: count }, (_, i) => ({
    segmentId: 0, time: i, lat: 35, lon: 139 + i * 0.00005,
    distanceM: i * 4.55, speedMps: 4.55, altitudeM: 100,
    heartRateBpm: 145, gpsAccuracyM: i % 2 ? undefined : 5,
  }));
  return { schemaVersion: 1, metadata: { totalDistanceM: 132, netMovingTime: 29,
    netMovingDistanceM: 132, ascentM: 22, descentM: 5 }, points, warnings: [] };
}

describe('Correct coordinates', () => {
  test('interpolates a missing-position tunnel, keeping all recorded motion and sensors', () => {
    const a = makeTrack();
    const before = JSON.stringify(a);
    for (let i = 12; i <= 18; i++) { delete a.points[i].lat; delete a.points[i].lon; }
    const snapshot = JSON.stringify(a);
    const events: CoordinateCorrectionDiagnostic[] = [];
    const r = correctTrackActivityCoordinates(a, { logLevel: 'verbose', onDiagnostic: e => events.push(e) });
    expect(r.status).toBe('corrected');
    expect(r.report.regionsCorrected).toBe(1);
    expect(r.report.pointsCorrected).toBeGreaterThanOrEqual(7);
    expect(r.activity.points[15].lon).toBeCloseTo(139 + 15 * 0.00005, 6);
    expect(r.activity.points[15].altitudeM).toBe(100);
    expect(r.activity.points[15].speedMps).toBe(4.55);
    expect(r.activity.points[15].distanceM).toBe(15 * 4.55);
    expect(r.activity.metadata.ascentM).toBe(22);
    expect(r.activity.metadata.netMovingDistanceM).toBe(132);
    expect(r.activity.metadata.coordinateCorrection).toMatchObject({
      method: 'linear-dead-reckoning-v2', regionsCorrected: 1,
      pointsCorrected: r.report.pointsCorrected, speedsCorrected: 0, distancesCorrected: 0,
    });
    expect(events.some(e => e.type === 'sport_inference')).toBe(true);
    expect(events.some(e => e.type === 'mask_summary')).toBe(true);
    expect(events.some(e => e.type === 'region_decision')).toBe(true);
    expect(events.some(e => e.type === 'motion_decision')).toBe(true);
    expect(events.some(e => e.type === 'summary')).toBe(true);
    expect(JSON.stringify(a)).toBe(snapshot);
    expect(before).not.toBe(snapshot);
  });

  test('repairs a sustained frozen position only when recorded motion continues', () => {
    const a = makeTrack();
    for (let i = 12; i <= 18; i++) a.points[i].lon = a.points[11].lon;
    const r = correctTrackActivityCoordinates(a);
    expect(r.report.regionsCorrected).toBe(1);
    expect(r.activity.points[15].lon).toBeCloseTo(139 + 15 * 0.00005, 6);
    expect(r.report.regions[0].reasons).toContain('frozen_position');
  });

  test('repairs a multi-point displaced GNSS corridor with entry and exit jumps', () => {
    const a = makeTrack();
    for (let i = 12; i <= 17; i++) a.points[i].lat! += 0.003;
    const r = correctTrackActivityCoordinates(a);
    expect(r.report.regionsCorrected).toBe(1);
    expect(r.report.pointsCorrected).toBeGreaterThanOrEqual(6);
    expect(r.activity.points[15].lat).toBeCloseTo(35, 5);
  });

  test('uses poor gps accuracy only together with a geometric inconsistency', () => {
    const a = makeTrack();
    a.points[15].gpsAccuracyM = 40;
    const alone = correctTrackActivityCoordinates(a);
    expect(alone.status).toBe('skipped');
    a.points[15].lat! += 0.00022; // >20m off the chord but not an impossible speed
    const r = correctTrackActivityCoordinates(a);
    expect(r.report.regionsCorrected).toBe(1);
    expect(r.report.regions[0].reasons).toContain('poor_gps_accuracy');
  });

  test('repairs a one-point high-speed excursion', () => {
    const a = makeTrack(); a.points[15].lon! += 0.005;
    const r = correctTrackActivityCoordinates(a);
    expect(r.report.regionsCorrected).toBe(1);
    expect(r.activity.points[15].lon).toBeCloseTo(139 + 15 * 0.00005, 6);
    expect(r.report.regions[0].hardReasons?.some(x => x.startsWith('H2'))).toBe(true);
  });

  test('does not change stopped position or a normal U-turn', () => {
    const stopped = makeTrack();
    for (let i = 12; i <= 18; i++) {
      stopped.points[i].lon = stopped.points[11].lon;
      stopped.points[i].speedMps = 0;
      stopped.points[i].distanceM = stopped.points[11].distanceM;
    }
    // After stopping, the next position and cumulative distance resume from
    // where the cyclist actually stopped instead of teleporting forward.
    for (let i = 19; i < stopped.points.length; i++) {
      stopped.points[i].lon = 139 + (i - 7) * 0.00005;
      stopped.points[i].distanceM = (i - 7) * 4.55;
    }
    expect(correctTrackActivityCoordinates(stopped).status).toBe('skipped');
    const turn = makeTrack();
    for (let i = 10; i < 30; i++) turn.points[i].lon = 139 + (20 - i) * 0.00005;
    expect(correctTrackActivityCoordinates(turn).status).toBe('skipped');
  });

  test('skips a missing end anchor, time reversal and disjoint segments', () => {
    const a = makeTrack();
    for (let i = 26; i < 30; i++) { delete a.points[i].lat; delete a.points[i].lon; }
    const r = correctTrackActivityCoordinates(a);
    expect(r.status).toBe('skipped');
    expect(r.report.regions[0].skipReason).toBe('boundary_not_stable');
    const b = makeTrack();
    b.points[15].time = 3;
    delete b.points[15].lat; delete b.points[15].lon;
    expect(correctTrackActivityCoordinates(b).report.regionsCorrected).toBe(0);
    const c = makeTrack();
    for (let i = 15; i < 30; i++) c.points[i].segmentId = 1;
    delete c.points[15].lat; delete c.points[15].lon;
    expect(correctTrackActivityCoordinates(c).report.regionsCorrected).toBe(0);
  });

  test('no longer rejects a region solely because the old 300-second cap is exceeded', () => {
    const a = makeTrack(900);
    for (let i = 100; i < 700; i++) { delete a.points[i].lat; delete a.points[i].lon; }
    const r = correctTrackActivityCoordinates(a);
    expect(r.report.regionsCorrected).toBe(1);
    expect(r.report.regions[0].durationSeconds).toBeGreaterThan(300);
    expect(r.report.regions[0].skipReason).toBeUndefined();
  });

  test('leaves already corrected input unchanged and suppresses verbose diagnostics in summary mode', () => {
    const a = makeTrack(); a.metadata.coordinateCorrection = {
      method: 'linear-dead-reckoning-v1', regionsCorrected: 1,
      pointsCorrected: 5, speedsCorrected: 0, distancesCorrected: 0,
    };
    expect(correctTrackActivityCoordinates(a).activity).toBe(a);
    delete a.metadata.coordinateCorrection;
    for (let i = 12; i <= 18; i++) { delete a.points[i].lat; delete a.points[i].lon; }
    const events: CoordinateCorrectionDiagnostic[] = [];
    correctTrackActivityCoordinates(a, { logLevel: 'summary', onDiagnostic: e => events.push(e) });
    expect(events.some(e => e.type === 'candidate')).toBe(false);
    expect(events.some(e => e.type === 'summary')).toBe(true);
    expect(events.every(e => !JSON.stringify(e).includes('139.'))).toBe(true);
  });

  test('keeps unrelated metadata, does not throw if diagnostic observer fails', () => {
    const a = makeTrack();
    delete a.points[14].lat; delete a.points[14].lon;
    const r = correctTrackActivityCoordinates(a, {
      logLevel: 'summary', onDiagnostic: () => { throw new Error('observer'); },
    });
    expect(r.status).toBe('corrected');
    expect(r.activity.metadata.totalDistanceM).toBe(132);
    expect(r.activity.metadata.ascentM).toBe(22);
    expect(r.activity.points[14].heartRateBpm).toBe(145);
  });
});

describe('Correct coordinates: motion diagnostics', () => {
  test('reports motion-source and recorded-distance metrics without modifying them', () => {
    const a = makeTrack(120);
    for (let i = 25; i <= 80; i++) a.points[i].lon = a.points[24].lon;
    const diagnostics: CoordinateCorrectionDiagnostic[] = [];
    const r = correctTrackActivityCoordinates(a, {
      logLevel: 'verbose', onDiagnostic: e => diagnostics.push(e),
    });
    expect(r.report.regionsCorrected).toBeGreaterThanOrEqual(1);
    expect(r.report.regions[0].diagnostics.recordedDistanceDeltaM).toBeGreaterThan(0);
    expect(r.report.regions[0].diagnostics.speedVsDistanceRatio).toBeCloseTo(1, 1);
    expect(r.activity.points[50].speedMps).toBe(4.55);
    expect(r.activity.points[50].distanceM).toBe(50 * 4.55);
    const sensor = diagnostics.find(e => e.type === 'sensor_inference')?.data;
    expect(sensor?.referenceTrust).toBe('high');
    const summary = diagnostics.find(e => e.type === 'summary')?.data;
    expect(summary?.speedsCorrected).toBe(0);
    expect(summary?.distancesCorrected).toBe(0);
  });

  test('speed alone cannot confirm a wheel sensor', () => {
    const a = makeTrack(100);
    for (let i = 20; i <= 65; i++) a.points[i].lon = a.points[19].lon;
    for (const p of a.points) delete p.distanceM;
    const events: CoordinateCorrectionDiagnostic[] = [];
    correctTrackActivityCoordinates(a, { logLevel: 'summary', onDiagnostic: e => events.push(e) });
    const sensor = events.find(e => e.type === 'sensor_inference')?.data;
    expect(sensor?.wheelInference).toBe('wheel_unknown');
    expect(sensor?.referenceTrust).toBe('low');
  });

  test('diagnostics include irregular record gaps', () => {
    const a = makeTrack();
    for (let i = 12; i <= 18; i++) delete a.points[i].lat;
    for (let i = 15; i < a.points.length; i++) a.points[i].time! += 20;
    const r = correctTrackActivityCoordinates(a);
    expect(r.report.regions[0].diagnostics.maxSampleGapSeconds).toBeGreaterThan(1);
  });
});
