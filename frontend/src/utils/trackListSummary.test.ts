import {
  formatTrackListDateTime,
  formatTrackListDistance,
  formatTrackListElapsedTime,
  getTrackListSummary,
} from "./trackListSummary";

describe("getTrackListSummary", () => {
  test("reads metadata and the top-level centroid POI", () => {
    const data = {
      type: "FeatureCollection",
      bbox: [138.37947, 36.37926, 138.41994, 36.42744],
      poi: [
        {
          role: "start",
          coordinates: [138.37947, 36.37955],
          label: "長野県東御市",
        },
        {
          role: "centroid",
          coordinates: [138.40028, 36.40591],
          label: "長野県東御市",
        },
      ],
      features: [
        {
          type: "Feature",
          properties: {
            metadata: {
              startTime: 1783867560,
              localTimeOffsetSeconds: 9 * 3600,
              totalElapsedTime: 11714,
              totalDistanceM: 123650,
            },
          },
          geometry: null,
        },
      ],
    };

    expect(getTrackListSummary(data)).toEqual({
      startTime: 1783867560,
      localTimeOffsetSeconds: 9 * 3600,
      totalElapsedTime: 11714,
      totalDistanceM: 123650,
      location: "長野県東御市",
    });
  });

  test("prefers root metadata", () => {
    expect(getTrackListSummary({
      type: "FeatureCollection",
      metadata: { totalDistanceM: 1000 },
      features: [],
    })).toEqual({ totalDistanceM: 1000 });
  });

  test("does not use another POI role or a blank centroid label", () => {
    expect(
      getTrackListSummary({
        metadata: { totalDistanceM: 1000 },
        poi: [
          {
            role: "start",
            coordinates: [139.6, 35.6],
            label: "東京都渋谷区",
          },
          {
            role: "centroid",
            coordinates: [139.63, 35.64],
            label: "   ",
          },
        ],
      }),
    ).toEqual({ totalDistanceM: 1000 });
  });
});

describe("track list formatting", () => {
  test("formats the activity time using its recorded UTC offset", () => {
    const startTime = Date.UTC(2026, 6, 12, 14, 46, 0) / 1000;
    expect(formatTrackListDateTime({
      startTime,
      localTimeOffsetSeconds: 9 * 3600,
    })).toBe("2026/07/12 23:46");
  });

  test("formats elapsed time and distance", () => {
    expect(formatTrackListElapsedTime(11714)).toBe("03:15:14");
    expect(formatTrackListDistance(123650)).toBe("123.65km");
  });

  test("uses placeholders for missing values", () => {
    expect(formatTrackListElapsedTime(undefined)).toBe("—");
    expect(formatTrackListDistance(undefined)).toBe("—");
  });
});
