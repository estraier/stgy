import {
  formatTrackListDateTime,
  formatTrackListDistance,
  formatTrackListElapsedTime,
  getTrackListSummary,
} from "./trackListSummary";

describe("getTrackListSummary", () => {
  test("reads metadata from the first feature", () => {
    const data = {
      type: "FeatureCollection",
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
    });
  });

  test("prefers root metadata", () => {
    expect(getTrackListSummary({
      type: "FeatureCollection",
      metadata: { totalDistanceM: 1000 },
      features: [],
    })).toEqual({ totalDistanceM: 1000 });
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
