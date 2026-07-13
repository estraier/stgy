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
    { role: "start", coordinates: [138.3, 36.3] },
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
  });

  test("returns no renderer metadata for TrackJSON without metadata", () => {
    const data = makeTrackJson();
    delete (data as Partial<typeof data>).metadata;

    expect(getTrackJsonDisplayMetadataLines(data)).toEqual([]);
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
