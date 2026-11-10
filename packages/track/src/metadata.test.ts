import {
  getTrackJsonDisplayMetadataLines,
  getTrackJsonOverviewMetadataLines,
  getTrackJsonPropertyMetadataLines,
  getTrackJsonTimingMetadataLines,
} from "./metadata";

const makeTrackJson = () => ({
  type: "FeatureCollection",
  bbox: [138.3, 36.3, 138.5, 36.5],
  poi: [
    { role: "start", coordinates: [138.3, 36.3], label: "長野県東御市" },
    { role: "centroid", coordinates: [138.4003, 36.4059] },
  ],
  metadata: {
    sport: "cycling",
    startTime: 1780643064,
    totalElapsedTime: 4788,
    localTimeOffsetSeconds: 32400,
    totalDistanceM: 123450,
  },
  features: [],
});

describe("TrackJSON metadata formatting", () => {
  test("formats local start/end times", () => {
    const lines = getTrackJsonOverviewMetadataLines(makeTrackJson());

    expect(lines).toEqual([
      {
        key: "time",
        text: "time range: start 2026-06-05 16:04:24, end 2026-06-05 17:24:12",
      },
    ]);
  });

  test("orders local time before the time range", () => {
    expect(getTrackJsonTimingMetadataLines(makeTrackJson())).toEqual([
      {
        key: "local-time-offset",
        text: "local time offset: UTC+09:00",
      },
      {
        key: "time",
        text: "time range: start 2026-06-05 16:04:24, " +
          "end 2026-06-05 17:24:12",
      },
    ]);
  });

  test("formats bbox and POI after overview lines", () => {
    const lines = getTrackJsonPropertyMetadataLines(makeTrackJson());

    expect(lines.map((line) => line.key)).toEqual([
      "local-time-offset",
      "time",
      "bbox",
      "poi-start",
      "poi-centroid",
    ]);
    expect(lines.find((line) => line.key === "poi-start")?.text).toBe(
      "poi start: lon 138.30000, lat 36.30000, label 長野県東御市",
    );
    expect(lines.find((line) => line.key === "poi-centroid")?.text).toBe(
      "poi centroid: lon 138.40030, lat 36.40590",
    );
  });

  test("returns no renderer metadata for TrackJSON without metadata", () => {
    const data = makeTrackJson();
    delete (data as Partial<typeof data>).metadata;

    expect(getTrackJsonDisplayMetadataLines(data)).toEqual([]);
  });

  test("renders net moving totals directly from TrackJSON metadata", () => {
    const data = makeTrackJson();
    const withNet = {
      ...data,
      metadata: {
        ...data.metadata,
        netMovingTime: 24269,
        netMovingDistanceM: 152580,
      },
    };
    const lines = getTrackJsonDisplayMetadataLines(withNet);
    expect(lines.find((line) => line.key === "net")?.text).toBe(
      "net: moving time 6:44:29, distance 152.58 km, average speed 22.6 km/h",
    );
  });

  test("recomputes legacy TrackJSON net without connecting separate route segments", () => {
    const data = {
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          geometry: { type: "LineString", coordinates: [[139, 35], [139.001, 35]] },
          properties: {
            metadata: { analysis: { movingSpeedThresholdKph: 3 } },
            coordinateProperties: {
              times: [0, 10], distances: [0, 50], speeds: [18, 18],
            },
          },
        },
        {
          type: "Feature",
          geometry: { type: "LineString", coordinates: [[140, 36], [140.001, 36]] },
          properties: {
            coordinateProperties: {
              times: [100, 110], distances: [0, 50], speeds: [18, 18],
            },
          },
        },
      ],
    };
    const lines = getTrackJsonDisplayMetadataLines(data);
    expect(lines.find((line) => line.key === "net")?.text).toBe(
      "net: moving time 0:20, distance 0.10 km, average speed 18.0 km/h",
    );
  });

  test("includes readable activity metadata for the renderer", () => {
    const lines = getTrackJsonDisplayMetadataLines(makeTrackJson());

    expect(lines.map((line) => line.key).slice(0, 4)).toEqual([
      "sport",
      "local-time-offset",
      "time",
      "gross",
    ]);
    expect(lines.some((line) => line.text === "sport: cycling")).toBe(true);
    expect(lines.some((line) => line.text.startsWith("gross: "))).toBe(true);
    expect(lines.some((line) => line.key === "bbox")).toBe(true);
  });
});
