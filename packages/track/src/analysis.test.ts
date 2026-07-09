import {
  TRACK_SCATTER_METRICS,
  buildHeartRateBracketHistogram,
  buildPowerBracketHistogram,
  buildScatterPlotPoints,
  buildSmoothedScatterSamples,
  createRangeTicks,
  getAvailableScatterMetrics,
  getEstimatedTorqueNm,
  getGradePercent,
  getScatterAxisRange,
  sampleEvenly,
} from "./analysis";
import type { TrackPoint } from "./activity";

describe("buildPowerBracketHistogram", () => {
  test("uses timed durations and 25 W buckets", () => {
    const points: TrackPoint[] = [
      { time: 0, speedMps: 5, powerW: 0 },
      { time: 10, speedMps: 5, powerW: 25 },
      { time: 20, speedMps: 5, powerW: 26 },
      { time: 30, speedMps: 5, powerW: 2001 },
      { time: 40, speedMps: 5, powerW: 100 },
    ];

    expect(buildPowerBracketHistogram(points)).toEqual({
      bucketSizeW: 25,
      maxBucketW: 2000,
      totalSeconds: 40,
      buckets: [
        { label: "0 W", seconds: 10 },
        { label: "≤25 W", seconds: 10 },
        { label: "≤50 W", seconds: 10 },
        { label: ">2000 W", seconds: 10 },
      ],
    });
  });

  test("uses only moving intervals", () => {
    const points: TrackPoint[] = [
      { time: 0, speedMps: 0, powerW: 100 },
      { time: 10, speedMps: 5, powerW: 125 },
      { time: 20, speedMps: 5, powerW: 150 },
      { time: 30, speedMps: 0, powerW: 175 },
    ];

    expect(buildPowerBracketHistogram(points)).toEqual({
      bucketSizeW: 25,
      maxBucketW: 2000,
      totalSeconds: 10,
      buckets: [{ label: "≤125 W", seconds: 10 }],
    });
  });


  test("uses segment speed when one endpoint speed is missing", () => {
    const points: TrackPoint[] = [
      { time: 0, distanceM: 0, powerW: 100 },
      { time: 10, distanceM: 100, speedMps: 10, powerW: 125 },
    ];

    expect(buildPowerBracketHistogram(points)).toEqual({
      bucketSizeW: 25,
      maxBucketW: 2000,
      totalSeconds: 10,
      buckets: [{ label: "≤100 W", seconds: 10 }],
    });
  });

  test("excludes start and stop transition intervals", () => {
    const points: TrackPoint[] = [
      { time: 0, speedMps: 0, powerW: 100 },
      { time: 10, speedMps: 5, powerW: 125 },
      { time: 20, speedMps: 0, powerW: 150 },
    ];

    expect(buildPowerBracketHistogram(points)).toBeUndefined();
  });

  test("falls back to sample counts when timestamps are unavailable", () => {
    const points: TrackPoint[] = [
      { speedMps: 5, powerW: 1 },
      { speedMps: 5, powerW: 25 },
      { speedMps: 5, powerW: 26 },
    ];

    expect(buildPowerBracketHistogram(points)?.buckets).toEqual([
      { label: "≤25 W", seconds: 2 },
      { label: "≤50 W", seconds: 1 },
    ]);
  });
});

describe("buildHeartRateBracketHistogram", () => {
  test("uses 0, <=50, 10 bpm buckets, and overflow", () => {
    const points: TrackPoint[] = [
      { speedMps: 5, heartRateBpm: 0 },
      { speedMps: 5, heartRateBpm: 50 },
      { speedMps: 5, heartRateBpm: 51 },
      { speedMps: 5, heartRateBpm: 60 },
      { speedMps: 5, heartRateBpm: 201 },
    ];

    expect(buildHeartRateBracketHistogram(points)).toEqual({
      bucketSizeBpm: 10,
      firstBucketMaxBpm: 50,
      maxBucketBpm: 200,
      totalSeconds: 5,
      buckets: [
        { label: "0 bpm", seconds: 1 },
        { label: "≤50 bpm", seconds: 1 },
        { label: "≤60 bpm", seconds: 2 },
        { label: ">200 bpm", seconds: 1 },
      ],
    });
  });
});

describe("scatter analysis", () => {
  const points: TrackPoint[] = [
    {
      time: 0,
      speedMps: 5,
      cadenceRpm: 60,
      heartRateBpm: 100,
      powerW: 120,
      distanceM: 0,
      elevationM: 0,
    },
    {
      time: 10,
      speedMps: 6,
      cadenceRpm: 70,
      heartRateBpm: 110,
      powerW: 140,
      distanceM: 100,
      elevationM: 5,
    },
    {
      time: 20,
      speedMps: 7,
      cadenceRpm: 80,
      heartRateBpm: 120,
      powerW: 160,
      distanceM: 200,
      elevationM: 20,
    },
    {
      time: 40,
      speedMps: 8,
      cadenceRpm: 90,
      heartRateBpm: 130,
      powerW: 180,
      distanceM: 300,
      elevationM: 30,
    },
  ];

  test("precomputes 30 second smoothed samples", () => {
    const samples = buildSmoothedScatterSamples(points, {
      windowSeconds: 30,
      maxPoints: 1000,
    });

    expect(samples[2].cadenceRpm).toBeCloseTo(70);
    expect(samples[2].speedKph).toBeCloseTo(21.6);
    expect(samples[2].efficiency).toBeCloseTo(140 / 110);
  });

  test("reports available metrics in display order", () => {
    const samples = buildSmoothedScatterSamples(points, {
      windowSeconds: 30,
      maxPoints: 1000,
    });

    expect(
      getAvailableScatterMetrics(samples).map((metric) => metric.label),
    ).toEqual([
      "Speed",
      "Cadence",
      "Heart rate",
      "Power",
      "Efficiency",
      "Torque",
      "Grade",
      "Elevation",
    ]);
  });

  test("allows the same X and Y metric", () => {
    const samples = buildSmoothedScatterSamples(points, {
      windowSeconds: 30,
      maxPoints: 1000,
    });

    expect(buildScatterPlotPoints(samples, "powerW", "powerW", 1000)).toEqual([
      { x: 120, y: 120 },
      { x: 130, y: 130 },
      { x: 140, y: 140 },
    ]);
  });

  test("computes estimated torque and grade", () => {
    expect(getEstimatedTorqueNm({ powerW: 200, cadenceRpm: 60 })).toBeCloseTo(
      200 / (2 * Math.PI),
    );
    expect(getEstimatedTorqueNm({ powerW: 200, cadenceRpm: 9 })).toBeUndefined();
    expect(getGradePercent({ metrics: { grade: 3.5 } }, 0, [])).toBe(3.5);
    expect(getGradePercent(points[1], 1, points)).toBeCloseTo(10);
  });

  test("samples evenly", () => {
    expect(sampleEvenly([0, 1, 2, 3, 4], 3)).toEqual([0, 2, 4]);
  });

  test("trims scatter axis ranges by 2-98 percentiles", () => {
    const range = getScatterAxisRange([0, 10, 20, 30, 1000], true);
    expect(range.min).toBeCloseTo(0.8);
    expect(range.max).toBeCloseTo(922.4);
  });

  test("creates range ticks inside the axis range", () => {
    expect(createRangeTicks(3, 23, 5)).toEqual([5, 10, 15, 20]);
  });
});

// Keep the public metric table reachable so accidental export removal is caught.
test("exports the scatter metric table", () => {
  expect(TRACK_SCATTER_METRICS.map((metric) => metric.key)).toEqual([
    "speedKph",
    "cadenceRpm",
    "heartRateBpm",
    "powerW",
    "efficiency",
    "estimatedTorqueNm",
    "gradePercent",
    "elevationM",
  ]);
});
