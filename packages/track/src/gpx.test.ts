import { parseGpxText, trackActivityToGpx } from "./gpx";

describe("parseGpxText", () => {
  test("converts GPX track points to a TrackActivity", () => {
    const activity = parseGpxText(`<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="stgy-test"
  xmlns="http://www.topografix.com/GPX/1/1"
  xmlns:gpxtpx="http://www.garmin.com/xmlschemas/TrackPointExtension/v1">
  <metadata>
    <name>Morning ride</name>
    <time>2026-06-21T02:02:35Z</time>
  </metadata>
  <trk>
    <name>Demo route</name>
    <trkseg>
      <trkpt lat="35.0234" lon="137.7012">
        <ele>100.5</ele>
        <time>2026-06-21T11:02:35+09:00</time>
        <extensions>
          <gpxtpx:TrackPointExtension>
            <gpxtpx:hr>123</gpxtpx:hr>
            <gpxtpx:cad>80</gpxtpx:cad>
            <gpxtpx:atemp>24</gpxtpx:atemp>
          </gpxtpx:TrackPointExtension>
          <power>210</power>
        </extensions>
      </trkpt>
      <trkpt lat="35.0244" lon="137.7022">
        <ele>102.0</ele>
        <time>2026-06-21T11:02:45+09:00</time>
        <extensions>
          <gpxtpx:TrackPointExtension>
            <gpxtpx:hr>125</gpxtpx:hr>
            <gpxtpx:cad>82</gpxtpx:cad>
          </gpxtpx:TrackPointExtension>
          <power>220</power>
        </extensions>
      </trkpt>
    </trkseg>
  </trk>
</gpx>`);

    expect(activity.metadata.source?.type).toBe("gpx");
    expect(activity.metadata.source?.formatVersion).toBe("1.1");
    expect(activity.metadata.name).toBe("Morning ride");
    expect(activity.metadata.startTime).toBe(Date.parse("2026-06-21T02:02:35Z") / 1000);
    expect(activity.metadata.endTime).toBe(Date.parse("2026-06-21T02:02:45Z") / 1000);
    expect(activity.metadata.localTimeOffsetSeconds).toBe(9 * 3600);
    expect(activity.points).toHaveLength(2);
    expect(activity.points[0]).toMatchObject({
      lat: 35.0234,
      lon: 137.7012,
      elevationM: 100.5,
      heartRateBpm: 123,
      cadenceRpm: 80,
      powerW: 210,
      temperatureC: 24,
      distanceM: 0,
    });
    expect(activity.points[1].distanceM).toBeGreaterThan(0);
    expect(activity.points[1].speedMps).toBeGreaterThan(0);
    expect(activity.metadata.totalDistanceM).toBeGreaterThan(0);
    expect(activity.metadata.statistics?.heartRateBpm?.avg).toBe(123);
    expect(activity.metadata.training?.totalWorkJ).toBeGreaterThan(0);
  });

  test("preserves GPX track segment breaks as unpositioned separators", () => {
    const activity = parseGpxText(`<?xml version="1.0"?>
<gpx version="1.1" creator="stgy-test">
  <trk>
    <trkseg>
      <trkpt lat="35.0" lon="139.0"><time>2026-06-21T00:00:00Z</time></trkpt>
      <trkpt lat="35.1" lon="139.1"><time>2026-06-21T00:00:10Z</time></trkpt>
    </trkseg>
    <trkseg>
      <trkpt lat="36.0" lon="140.0"><time>2026-06-21T00:01:00Z</time></trkpt>
      <trkpt lat="36.1" lon="140.1"><time>2026-06-21T00:01:10Z</time></trkpt>
    </trkseg>
  </trk>
</gpx>`);

    expect(activity.points).toHaveLength(5);
    expect(activity.points[2]).toEqual({});
    expect(activity.warnings[0]?.code).toBe("gpx_multiple_segments");
  });

  test("does not invent a local time offset for UTC-only GPX time values", () => {
    const activity = parseGpxText(`<?xml version="1.0"?>
<gpx version="1.1" creator="stgy-test">
  <trk>
    <trkseg>
      <trkpt lat="1" lon="2"><time>2026-06-21T00:00:00Z</time></trkpt>
      <trkpt lat="1.1" lon="2.1"><time>2026-06-21T00:00:10Z</time></trkpt>
    </trkseg>
  </trk>
</gpx>`);

    expect(activity.metadata.localTimeOffsetSeconds).toBeUndefined();
  });
});


describe("trackActivityToGpx", () => {
  test("exports TrackActivity as GPX text", () => {
    const gpx = trackActivityToGpx({
      schemaVersion: 1,
      metadata: {
        name: "Export ride",
        sport: "cycling",
        createdAt: 1710000000,
      },
      points: [
        {
          time: 1710000000,
          lat: 35,
          lon: 139,
          elevationM: 10,
          heartRateBpm: 100,
          cadenceRpm: 80,
          powerW: 150,
          temperatureC: 20,
        },
        {},
        {
          time: 1710000010,
          lat: 35.0001,
          lon: 139.0001,
          elevationM: 11,
          heartRateBpm: 102,
          cadenceRpm: 82,
          powerW: 160,
          temperatureC: 21,
        },
      ],
      warnings: [],
    });

    expect(gpx).toContain('<name>Export ride</name>');
    expect(gpx).toContain('<type>cycling</type>');
    expect(gpx).toContain('<power>150</power>');
    expect(gpx).toContain('<gpxtpx:hr>100</gpxtpx:hr>');
    expect(gpx.match(/<trkseg>/gu)).toHaveLength(2);
  });
  test("round-trips elapsed time, moving time, and calories through GPX extensions", () => {
    const gpx = trackActivityToGpx({
      schemaVersion: 1,
      metadata: {
        name: "Export ride",
        sport: "cycling",
        startTime: 1710000000,
        endTime: 1710000120,
        totalElapsedTime: 120,
        totalTimerTime: 90,
        totalDistanceM: 1200,
        training: {
          totalCaloriesCal: 123000,
          source: {
            totalCalories: "fit",
          },
        },
      },
      points: [
        {
          time: 1710000000,
          lat: 35,
          lon: 139,
          distanceM: 0,
          powerW: 150,
        },
        {
          time: 1710000090,
          lat: 35.001,
          lon: 139.001,
          distanceM: 1200,
          powerW: 160,
        },
      ],
      warnings: [],
    });
    const parsed = parseGpxText(gpx);

    expect(gpx).toContain("stgy:TrackActivity");
    expect(parsed.metadata.startTime).toBe(1710000000);
    expect(parsed.metadata.endTime).toBe(1710000120);
    expect(parsed.metadata.totalElapsedTime).toBe(120);
    expect(parsed.metadata.totalTimerTime).toBe(90);
    expect(parsed.metadata.training?.totalCaloriesCal).toBe(123000);
  });

});
