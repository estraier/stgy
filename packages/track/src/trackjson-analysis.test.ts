import {
  getTrackJsonAnalysis,
  getTrackJsonHistogramDisplays,
} from "./trackjson-analysis";

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
                  overflowThresholdKph: 60,
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
      expect.objectContaining({ label: "≥80 rpm", seconds: 10 }),
    ]));
  });

  test("adds LTHR and FTP zone displays after their standard histograms", () => {
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
              [139.002, 35.002],
            ],
          },
          properties: {
            coordinateProperties: {
              times: [0, 10, 20],
              speeds: [18, 18, 18],
              heartRates: [120, 150, 160],
              powers: [100, 200, 300],
            },
          },
        },
      ],
    }, {
      lthrBpm: 155,
      ftpW: 230,
    });

    expect(displays.map((display) => display.key)).toEqual([
      "speedKph",
      "heartRateBpm",
      "heartRateZones",
      "powerW",
      "powerZones",
    ]);
    expect(displays[2]).toEqual(expect.objectContaining({
      title: "Heart-rate histogram by LTHR 155 bpm",
      rows: expect.arrayContaining([
        expect.objectContaining({ label: "Z1 <81%", seconds: 10 }),
        expect.objectContaining({ label: "Z4 ≥94%", seconds: 10 }),
      ]),
    }));
    expect(displays[4]).toEqual(expect.objectContaining({
      title: "Power histogram by FTP 230 W",
      rows: expect.arrayContaining([
        expect.objectContaining({ label: "Z1 <56%", seconds: 10 }),
        expect.objectContaining({ label: "Z3 ≥76%", seconds: 10 }),
      ]),
    }));
  });


  test("prefers metadata power curve and recomputes it when missing", () => {
    const metadataAnalysis = getTrackJsonAnalysis({
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
              bestEfforts: {
                powerW: {
                  5: 410,
                  60: 300,
                },
              },
            },
            coordinateProperties: {
              times: [0, 60],
              speeds: [18, 18],
              powers: [100, 100],
            },
          },
        },
      ],
    });

    expect(metadataAnalysis.powerCurve).toEqual([
      { durationSeconds: 5, watts: 410 },
      { durationSeconds: 60, watts: 300 },
    ]);

    const computedAnalysis = getTrackJsonAnalysis({
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          geometry: {
            type: "LineString",
            coordinates: [
              [139, 35],
              [139.001, 35.001],
              [139.002, 35.002],
            ],
          },
          properties: {
            coordinateProperties: {
              times: [0, 10, 20],
              speeds: [18, 18, 18],
              powers: [300, 200, 100],
            },
          },
        },
      ],
    });

    expect(computedAnalysis.powerCurve.length).toBeGreaterThan(0);
    expect(computedAnalysis.powerCurve[0]).toEqual(
      expect.objectContaining({ durationSeconds: 5 }),
    );
  });

  test("does not add zone displays for invalid thresholds or missing measurements", () => {
    const data = {
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
            coordinateProperties: {
              times: [0, 10],
              speeds: [18, 18],
            },
          },
        },
      ],
    };

    expect(getTrackJsonHistogramDisplays(data, {
      lthrBpm: -1,
      ftpW: Number.NaN,
    }).map((display) => display.key)).toEqual(["speedKph"]);
    expect(getTrackJsonHistogramDisplays(data, {
      lthrBpm: 155,
      ftpW: 230,
    }).map((display) => display.key)).toEqual(["speedKph"]);
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
