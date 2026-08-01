import { getTrackJsonHistogramDisplays } from "./trackjson-analysis";

describe("getTrackJsonHistogramDisplays", () => {
  test("prefers metadata histograms and computes only missing ones", () => {
    const displays = getTrackJsonHistogramDisplays({
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          geometry: {
            type: "LineString",
            coordinates: [
              [139, 35],
              [139.001, 35.001],
            ],
          },
          properties: {
            metadata: {
              histograms: {
                speedKph: {
                  bucketSizeKph: 5,
                  maxBucketKph: 60,
                  totalSeconds: 10,
                  buckets: [{ label: "metadata speed", seconds: 10 }],
                },
              },
            },
            coordinateProperties: {
              times: [0, 10],
              distances: [0, 50],
              speeds: [18, 18],
              cadences: [80, 80],
            },
          },
        },
      ],
    });

    expect(displays.map((display) => display.key)).toEqual([
      "speedKph",
      "cadenceRpm",
    ]);
    expect(displays[0].rows).toEqual([
      expect.objectContaining({ label: "metadata speed", seconds: 10 }),
    ]);
    expect(displays[1].rows).toEqual(expect.arrayContaining([
      expect.objectContaining({ label: "≤80 rpm", seconds: 10 }),
    ]));
  });

  test("returns no displays without supported measurements or metadata", () => {
    expect(getTrackJsonHistogramDisplays({
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          geometry: {
            type: "LineString",
            coordinates: [
              [139, 35, 10],
              [139.001, 35.001, 20],
            ],
          },
          properties: {
            coordinateProperties: {
              altitudes: [10, 20],
            },
          },
        },
      ],
    })).toEqual([]);
  });
});
