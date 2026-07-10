import {
  TRACK_SCATTER_METRICS,
  buildCadenceBracketHistogram,
  buildHeartRateBracketHistogram,
  buildPowerBracketHistogram,
  buildSpeedBracketHistogram,
  buildScatterPlotPoints,
  buildSmoothedScatterSamples,
  createRangeTicks,
  getActivityHistogramDisplay,
  getActivityHistogramDisplays,
  getActivityMetadataSummaryLines,
  getActivityPowerCurvePoints,
  getDerivedHeartRateMetrics,
  getDerivedTrainingMetrics,
  getHeartRateZoneDisplayRows,
  getPowerZoneDisplayRows,
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
  test("keeps leading 0, <=50, and 10 bpm buckets", () => {
    const points: TrackPoint[] = [
      { speedMps: 5, heartRateBpm: 100 },
      { speedMps: 5, heartRateBpm: 120 },
    ];

    expect(buildHeartRateBracketHistogram(points)).toEqual({
      bucketSizeBpm: 10,
      firstBucketMaxBpm: 50,
      maxBucketBpm: 200,
      totalSeconds: 2,
      buckets: [
        { label: "0 bpm", seconds: 0 },
        { label: "≤50 bpm", seconds: 0 },
        { label: "≤60 bpm", seconds: 0 },
        { label: "≤70 bpm", seconds: 0 },
        { label: "≤80 bpm", seconds: 0 },
        { label: "≤90 bpm", seconds: 0 },
        { label: "≤100 bpm", seconds: 1 },
        { label: "≤110 bpm", seconds: 0 },
        { label: "≤120 bpm", seconds: 1 },
      ],
    });
  });
});

describe("buildSpeedBracketHistogram", () => {
  test("uses 0, <=5, 5 km/h buckets, and keeps leading buckets", () => {
    const points: TrackPoint[] = [
      { speedMps: 5 / 3.6 },
      { speedMps: 12 / 3.6 },
    ];

    expect(buildSpeedBracketHistogram(points)).toEqual({
      bucketSizeKph: 5,
      maxBucketKph: 100,
      totalSeconds: 2,
      buckets: [
        { label: "0 km/h", seconds: 0 },
        { label: "≤5 km/h", seconds: 1 },
        { label: "≤10 km/h", seconds: 0 },
        { label: "≤15 km/h", seconds: 1 },
      ],
    });
  });
});

describe("buildCadenceBracketHistogram", () => {
  test("uses 0, <=10, 10 rpm buckets, and keeps leading buckets", () => {
    const points: TrackPoint[] = [
      { speedMps: 5, cadenceRpm: 60 },
      { speedMps: 5, cadenceRpm: 80 },
    ];

    expect(buildCadenceBracketHistogram(points)).toEqual({
      bucketSizeRpm: 10,
      maxBucketRpm: 200,
      totalSeconds: 2,
      buckets: [
        { label: "0 rpm", seconds: 0 },
        { label: "≤10 rpm", seconds: 0 },
        { label: "≤20 rpm", seconds: 0 },
        { label: "≤30 rpm", seconds: 0 },
        { label: "≤40 rpm", seconds: 0 },
        { label: "≤50 rpm", seconds: 0 },
        { label: "≤60 rpm", seconds: 1 },
        { label: "≤70 rpm", seconds: 0 },
        { label: "≤80 rpm", seconds: 1 },
      ],
    });
  });
});


describe("display analysis helpers", () => {
  test("turns metadata histograms into display rows in shared order", () => {
    const metadata = {
      histograms: {
        speedKph: {
          totalSeconds: 20,
          buckets: [{ label: "≤20 km/h", seconds: 20 }],
        },
        heartRateBpm: {
          totalSeconds: 30,
          buckets: [{ label: "≤120 bpm", seconds: 15 }],
        },
        powerW: {
          totalSeconds: 40,
          buckets: [{ label: "≤200 W", seconds: 20 }],
        },
      },
    };

    expect(getActivityHistogramDisplays(metadata).map((display) => display.key)).toEqual([
      "speedKph",
      "heartRateBpm",
      "powerW",
    ]);
    expect(getActivityHistogramDisplay(metadata, "heartRateBpm")).toEqual({
      key: "heartRateBpm",
      title: "Heart-rate histogram (10 bpm brackets)",
      color: "#e14545",
      rows: [
        {
          label: "≤120 bpm",
          seconds: 15,
          percentage: 50,
          color: "#e14545",
        },
      ],
    });
  });

  test("reads power curve points from activity metadata", () => {
    expect(getActivityPowerCurvePoints({
      schemaVersion: 1,
      metadata: {
        bestEfforts: { powerW: { "60": 210, "5": 300 } },
      },
      points: [],
      warnings: [],
    })).toEqual([
      { durationSeconds: 5, watts: 300 },
      { durationSeconds: 60, watts: 210 },
    ]);
  });

  test("builds shared zone display rows", () => {
    const powerRows = getPowerZoneDisplayRows({
      totalSeconds: 10,
      durations: { z1: 5, z2: 5, z3: 0, z4: 0, z5: 0, z6: 0, z7: 0 },
      percentages: { z1: 50, z2: 50, z3: 0, z4: 0, z5: 0, z6: 0, z7: 0 },
    }, 200);
    expect(powerRows[0]).toEqual({
      label: "Z1 ≤55% FTP, ≤110 W",
      seconds: 5,
      percentage: 50,
      color: "#6fd3ff",
    });

    const heartRateRows = getHeartRateZoneDisplayRows({
      totalSeconds: 10,
      durations: { z1: 0, z2: 10, z3: 0, z4: 0, z5: 0 },
      percentages: { z1: 0, z2: 100, z3: 0, z4: 0, z5: 0 },
    }, 150);
    expect(heartRateRows[1]).toEqual({
      label: "Z2 ≤89% LTHR, ≤133.5 bpm",
      seconds: 10,
      percentage: 100,
      color: "#2fa84f",
    });
  });

  test("formats metadata summary lines for reusable display", () => {
    expect(getActivityMetadataSummaryLines({
      metadata: {
        totalElapsedTime: 7815,
        totalDistanceM: 54321,
        analysis: { movingSpeedThresholdKph: 3 },
        statistics: {
          speedKph: { mean: 18.123, median: 18, max: 30 },
          heartRateBpm: { mean: 120, median: 121, max: 150 },
          powerW: { mean: 150, median: 155, max: 210 },
        },
        totalTimerTime: 1800,
        pedaling: {
          totalSeconds: 65,
          averagePowerW: 123.456,
          normalizedPowerW: 130.123,
        },
        pedalingDynamics: {
          leftRightBalance: { leftPercentage: 51.2, rightPercentage: 48.8 },
          torqueEffectiveness: { leftPercentage: 80, rightPercentage: 81 },
          pedalSmoothness: { combinedPercentage: 22.5 },
        },
        training: {
          normalizedPowerW: 136.456,
          totalWorkJ: 1234.4,
        },
      },
      points: [
        { time: 0, distanceM: 0, speedMps: 2 },
        { time: 10, distanceM: 20, speedMps: 2 },
        { time: 20, distanceM: 20, speedMps: 0 },
        { time: 30, distanceM: 40, speedMps: 2 },
      ],
    }, { ftpW: 200, lthrBpm: 150 }).map((line) => line.text)).toEqual([
      "gross: elapsed time 2:10:15, distance 54.32 km, average speed 25.0 km/h",
      "net: moving time 0:10, distance 0.02 km, average speed 7.2 km/h",
      "moving threshold: >= 3.0 km/h",
      "speed: mean 18.1, median 18.0, max 30.0 km/h",
      "heart rate: mean 120.0, median 121.0, max 150.0 bpm",
      "power: mean 150.0, median 155.0, max 210.0 W",
      "pedaling | time: 1:05",
      "pedaling | power: 123.5 W",
      "pedaling | NP: 130.1 W",
      "pedaling dynamics | L/R balance: L 51.2% / R 48.8%",
      "pedaling dynamics | torque effectiveness: L 80.0%, R 81.0%",
      "pedaling dynamics | pedal smoothness: combined 22.5%",
      "normalized power: 136.5 W",
      "total work: 1234 J",
      "training metrics: IF 0.682, VI 0.910, TSS 23.3",
    ]);
  });

  test("calculates derived FTP and LTHR metrics", () => {
    const metadata = {
      totalTimerTime: 3600,
      statistics: {
        powerW: { mean: 150, median: 155, max: 210 },
        heartRateBpm: { mean: 120, median: 122, max: 165 },
      },
      training: { normalizedPowerW: 180 },
    };

    expect(getDerivedTrainingMetrics(metadata, 200)).toEqual({
      intensityFactor: 0.9,
      variabilityIndex: 1.2,
      trainingStressScore: 81,
    });
    const heartRateMetrics = getDerivedHeartRateMetrics(metadata, 150);
    expect(heartRateMetrics.meanHeartRatePercentageOfLthr).toBeCloseTo(80, 10);
    expect(heartRateMetrics.maxHeartRatePercentageOfLthr).toBeCloseTo(110, 10);
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
      altitudeM: 0,
    },
    {
      time: 10,
      speedMps: 6,
      cadenceRpm: 70,
      heartRateBpm: 110,
      powerW: 140,
      distanceM: 100,
      altitudeM: 5,
    },
    {
      time: 20,
      speedMps: 7,
      cadenceRpm: 80,
      heartRateBpm: 120,
      powerW: 160,
      distanceM: 200,
      altitudeM: 20,
    },
    {
      time: 40,
      speedMps: 8,
      cadenceRpm: 90,
      heartRateBpm: 130,
      powerW: 180,
      distanceM: 300,
      altitudeM: 30,
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
      "Altitude",
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
    "altitudeM",
  ]);
});
