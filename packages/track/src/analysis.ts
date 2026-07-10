import type {
  TrackActivity,
  TrackActivityMetadata,
  TrackHeartRateZoneSummary,
  TrackPoint,
  TrackPowerZoneSummary,
} from "./activity";

export const POWER_BRACKET_HISTOGRAM_BUCKET_SIZE_W = 25;
export const POWER_BRACKET_HISTOGRAM_MAX_BUCKET_W = 2000;
export const SPEED_BRACKET_HISTOGRAM_BUCKET_SIZE_KPH = 5;
export const SPEED_BRACKET_HISTOGRAM_MAX_BUCKET_KPH = 100;
export const CADENCE_BRACKET_HISTOGRAM_BUCKET_SIZE_RPM = 10;
export const CADENCE_BRACKET_HISTOGRAM_MAX_BUCKET_RPM = 200;
export const HEART_RATE_BRACKET_HISTOGRAM_BUCKET_SIZE_BPM = 10;
export const HEART_RATE_BRACKET_HISTOGRAM_FIRST_BUCKET_MAX_BPM = 50;
export const HEART_RATE_BRACKET_HISTOGRAM_MAX_BUCKET_BPM = 200;
export const DEFAULT_SCATTER_SMOOTHING_SECONDS = 30;
export const DEFAULT_SCATTER_MAX_POINTS = 1000;
export const DEFAULT_SCATTER_TRIM_LOWER_PERCENTILE = 0.02;
export const DEFAULT_SCATTER_TRIM_UPPER_PERCENTILE = 0.98;
export const DEFAULT_MOVING_SPEED_THRESHOLD_KPH = 3;

export type TrackAnalysisOptions = {
  movingSpeedThresholdKph?: number;
};

export type ResolvedTrackAnalysisOptions = {
  movingSpeedThresholdKph: number;
};

export type TrackMovingAnalysisInterval = {
  point: TrackPoint;
  nextPoint: TrackPoint;
  seconds: number;
  speedKph: number;
  distanceM?: number;
};

export type TrackAnalysisHistogramBucket = {
  label: string;
  seconds: number;
};

export type TrackPowerBracketHistogram = {
  bucketSizeW: number;
  maxBucketW: number;
  totalSeconds: number;
  buckets: TrackAnalysisHistogramBucket[];
};

export type TrackSpeedBracketHistogram = {
  bucketSizeKph: number;
  maxBucketKph: number;
  totalSeconds: number;
  buckets: TrackAnalysisHistogramBucket[];
};

export type TrackCadenceBracketHistogram = {
  bucketSizeRpm: number;
  maxBucketRpm: number;
  totalSeconds: number;
  buckets: TrackAnalysisHistogramBucket[];
};

export type TrackHeartRateBracketHistogram = {
  bucketSizeBpm: number;
  firstBucketMaxBpm: number;
  maxBucketBpm: number;
  totalSeconds: number;
  buckets: TrackAnalysisHistogramBucket[];
};

export type TrackScatterMetricKey =
  "speedKph" |
  "cadenceRpm" |
  "heartRateBpm" |
  "powerW" |
  "efficiency" |
  "estimatedTorqueNm" |
  "torqueEffectivenessPercentage" |
  "pedalSmoothnessPercentage" |
  "gradePercent" |
  "altitudeM";

export type TrackScatterMetricDefinition = {
  key: TrackScatterMetricKey;
  label: string;
  axisLabel: string;
  getValue: (
    point: TrackPoint,
    index: number,
    points: TrackPoint[]
  ) => number | undefined;
};

export type TrackSmoothedScatterSample = Partial<
  Record<TrackScatterMetricKey, number>
>;

export type TrackScatterPoint = {
  x: number;
  y: number;
};

export type ScatterAxisRange = {
  min: number;
  max: number;
};

export type TrackHistogramKey =
  "speedKph" |
  "cadenceRpm" |
  "heartRateBpm" |
  "powerW";

export type TrackAnalysisDisplayRow = {
  label: string;
  seconds: number;
  percentage: number;
  color: string;
};

export type TrackHistogramDisplayDefinition = {
  key: TrackHistogramKey;
  title: string;
  color: string;
};

export type TrackHistogramDisplay = TrackHistogramDisplayDefinition & {
  rows: TrackAnalysisDisplayRow[];
};

export type TrackPowerCurvePoint = {
  durationSeconds: number;
  watts: number;
};

export type TrackMetadataSummaryLine = {
  key: string;
  text: string;
};

export type TrackActivityMetadataInput =
  | TrackActivity
  | TrackActivityMetadata
  | Record<string, unknown>
  | undefined;

export type TrackMetadataSummaryOptions = {
  ftpW?: number;
  lthrBpm?: number;
};

export type TrackDerivedTrainingMetrics = {
  intensityFactor?: number;
  variabilityIndex?: number;
  trainingStressScore?: number;
};

export type TrackDerivedHeartRateMetrics = {
  meanHeartRatePercentageOfLthr?: number;
  maxHeartRatePercentageOfLthr?: number;
};

export const TRACK_HISTOGRAM_DISPLAY_DEFINITIONS:
  TrackHistogramDisplayDefinition[] = [
    {
      key: "speedKph",
      title: "Speed histogram (5 km/h brackets)",
      color: "#2f7df6",
    },
    {
      key: "cadenceRpm",
      title: "Cadence histogram (10 rpm brackets)",
      color: "#2fa84f",
    },
    {
      key: "heartRateBpm",
      title: "Heart-rate histogram (10 bpm brackets)",
      color: "#e14545",
    },
    {
      key: "powerW",
      title: "Power histogram (25 W brackets)",
      color: "#0078A8",
    },
  ];

export function getActivityHistogramDisplays(
  input: TrackActivityMetadataInput,
): TrackHistogramDisplay[] {
  return TRACK_HISTOGRAM_DISPLAY_DEFINITIONS
    .map((definition) => getActivityHistogramDisplay(input, definition.key))
    .filter((display): display is TrackHistogramDisplay => Boolean(display));
}

export function getActivityHistogramDisplay(
  input: TrackActivityMetadataInput,
  key: TrackHistogramKey,
): TrackHistogramDisplay | undefined {
  const definition = TRACK_HISTOGRAM_DISPLAY_DEFINITIONS.find(
    (item) => item.key === key,
  );
  if (!definition) {
    return undefined;
  }

  const rows = getActivityHistogramRows(input, key, definition.color);
  return rows.length > 0 ? { ...definition, rows } : undefined;
}

export function getActivityHistogramRows(
  input: TrackActivityMetadataInput,
  key: TrackHistogramKey,
  color: string,
): TrackAnalysisDisplayRow[] {
  const histogram = getMetadataHistogram(input, key);
  if (!histogram) {
    return [];
  }

  const totalSeconds = histogram.totalSeconds > 0
    ? histogram.totalSeconds
    : histogram.buckets.reduce((sum, bucket) => sum + bucket.seconds, 0);
  if (totalSeconds <= 0) {
    return [];
  }

  return histogram.buckets.map((bucket) => ({
    label: bucket.label,
    seconds: bucket.seconds,
    percentage: (bucket.seconds / totalSeconds) * 100,
    color,
  }));
}

export function getActivityPowerCurvePoints(
  input: TrackActivityMetadataInput,
): TrackPowerCurvePoint[] {
  const metadata = getActivityMetadataRecord(input);
  if (!metadata) {
    return [];
  }

  const bestEfforts = getRecordProperty(metadata, "bestEfforts");
  const powerW = bestEfforts ? getRecordProperty(bestEfforts, "powerW") : undefined;
  if (!powerW) {
    return [];
  }

  return Object.entries(powerW)
    .map(([duration, watts]) => {
      const durationSeconds = Number(duration);
      return isFiniteNumber(watts) &&
        Number.isFinite(durationSeconds) &&
        durationSeconds > 0
        ? { durationSeconds, watts }
        : undefined;
    })
    .filter((point): point is TrackPowerCurvePoint => Boolean(point))
    .sort((left, right) => left.durationSeconds - right.durationSeconds);
}

export function getPowerZoneDisplayRows(
  summary: TrackPowerZoneSummary,
  ftpW: number,
): TrackAnalysisDisplayRow[] {
  const z1Max = ftpW * 0.55;
  const z2Max = ftpW * 0.75;
  const z3Max = ftpW * 0.9;
  const z4Max = ftpW * 1.05;
  const z5Max = ftpW * 1.2;
  const z6Max = ftpW * 1.5;

  return [
    createZoneDisplayRow(
      summary,
      "z1",
      `Z1 ≤55% FTP, ≤${formatZoneLimit(z1Max)} W`,
      "#6fd3ff",
    ),
    createZoneDisplayRow(
      summary,
      "z2",
      `Z2 ≤75% FTP, ≤${formatZoneLimit(z2Max)} W`,
      "#2f7df6",
    ),
    createZoneDisplayRow(
      summary,
      "z3",
      `Z3 ≤90% FTP, ≤${formatZoneLimit(z3Max)} W`,
      "#2fa84f",
    ),
    createZoneDisplayRow(
      summary,
      "z4",
      `Z4 ≤105% FTP, ≤${formatZoneLimit(z4Max)} W`,
      "#f2d33b",
    ),
    createZoneDisplayRow(
      summary,
      "z5",
      `Z5 ≤120% FTP, ≤${formatZoneLimit(z5Max)} W`,
      "#f39c34",
    ),
    createZoneDisplayRow(
      summary,
      "z6",
      `Z6 ≤150% FTP, ≤${formatZoneLimit(z6Max)} W`,
      "#e14545",
    ),
    createZoneDisplayRow(
      summary,
      "z7",
      `Z7 >150% FTP, >${formatZoneLimit(z6Max)} W`,
      "#7a3db8",
    ),
  ];
}

export function getHeartRateZoneDisplayRows(
  summary: TrackHeartRateZoneSummary,
  lthrBpm: number,
): TrackAnalysisDisplayRow[] {
  const z1Max = lthrBpm * 0.81;
  const z2Max = lthrBpm * 0.89;
  const z3Max = lthrBpm * 0.94;
  const z4Max = lthrBpm;

  return [
    createZoneDisplayRow(
      summary,
      "z1",
      `Z1 ≤81% LTHR, ≤${formatZoneLimit(z1Max)} bpm`,
      "#2f7df6",
    ),
    createZoneDisplayRow(
      summary,
      "z2",
      `Z2 ≤89% LTHR, ≤${formatZoneLimit(z2Max)} bpm`,
      "#2fa84f",
    ),
    createZoneDisplayRow(
      summary,
      "z3",
      `Z3 ≤94% LTHR, ≤${formatZoneLimit(z3Max)} bpm`,
      "#f2d33b",
    ),
    createZoneDisplayRow(
      summary,
      "z4",
      `Z4 ≤100% LTHR, ≤${formatZoneLimit(z4Max)} bpm`,
      "#f39c34",
    ),
    createZoneDisplayRow(
      summary,
      "z5",
      `Z5 >100% LTHR, >${formatZoneLimit(z4Max)} bpm`,
      "#e14545",
    ),
  ];
}

export function getActivityMetadataSummaryLines(
  input: TrackActivityMetadataInput,
  options: TrackMetadataSummaryOptions = {},
): TrackMetadataSummaryLine[] {
  const metadata = getActivityMetadataRecord(input);
  if (!metadata) {
    return [];
  }

  const lines: TrackMetadataSummaryLine[] = [];
  const grossLine = getGrossSummaryText(metadata);
  if (grossLine) {
    lines.push({ key: "gross", text: grossLine });
  }

  const netLine = getNetSummaryText(input, metadata);
  if (netLine) {
    lines.push({ key: "net", text: netLine });
  }

  const analysis = getRecordProperty(metadata, "analysis");
  if (analysis) {
    const line = getAnalysisSummaryText(analysis);
    if (line) {
      lines.push({ key: "analysis", text: line });
    }
  }

  const statistics = getRecordProperty(metadata, "statistics");
  if (statistics) {
    appendStatsSummaryLine(lines, statistics, "speedKph", "speed", "km/h");
    appendStatsSummaryLine(lines, statistics, "cadenceRpm", "cadence", "rpm");
    appendStatsSummaryLine(lines, statistics, "heartRateBpm", "heart rate", "bpm");
    appendStatsSummaryLine(lines, statistics, "powerW", "power", "W");
    appendStatsSummaryLine(lines, statistics, "temperatureC", "temperature", "°C");
  }

  const pedaling = getRecordProperty(metadata, "pedaling");
  if (pedaling) {
    appendPedalingSummaryLines(lines, pedaling);
  }

  const pedalingDynamics = getRecordProperty(metadata, "pedalingDynamics");
  if (pedalingDynamics) {
    appendPedalingDynamicsSummaryLines(lines, pedalingDynamics);
  }

  appendDeviceSummaryLines(lines, metadata);

  const training = getRecordProperty(metadata, "training");
  if (training) {
    appendTrainingSummaryLines(lines, training);
  }

  appendDerivedTrainingSummaryLines(lines, metadata, options.ftpW);

  return lines;
}

export type BuildSmoothedScatterSamplesOptions = TrackAnalysisOptions & {
  windowSeconds?: number;
  maxPoints?: number;
  metrics?: TrackScatterMetricDefinition[];
};

export const TRACK_SCATTER_METRICS: TrackScatterMetricDefinition[] = [
  {
    key: "speedKph",
    label: "Speed",
    axisLabel: "Speed (km/h)",
    getValue: (point) => {
      return isFiniteNumber(point.speedMps) ? point.speedMps * 3.6 : undefined;
    },
  },
  {
    key: "cadenceRpm",
    label: "Cadence",
    axisLabel: "Cadence (rpm)",
    getValue: (point) => point.cadenceRpm,
  },
  {
    key: "heartRateBpm",
    label: "Heart rate",
    axisLabel: "Heart rate (bpm)",
    getValue: (point) => point.heartRateBpm,
  },
  {
    key: "powerW",
    label: "Power",
    axisLabel: "Power (W)",
    getValue: (point) => point.powerW,
  },
  {
    key: "efficiency",
    label: "Cardio efficiency",
    axisLabel: "Cardio efficiency (W/bpm)",
    getValue: () => undefined,
  },
  {
    key: "estimatedTorqueNm",
    label: "Torque",
    axisLabel: "Torque (Nm)",
    getValue: getEstimatedTorqueNm,
  },
  {
    key: "torqueEffectivenessPercentage",
    label: "Torque efficiency",
    axisLabel: "Torque efficiency (%)",
    getValue: getTorqueEffectivenessPercentage,
  },
  {
    key: "pedalSmoothnessPercentage",
    label: "Pedal smoothness",
    axisLabel: "Pedal smoothness (%)",
    getValue: getPedalSmoothnessPercentage,
  },
  {
    key: "gradePercent",
    label: "Grade",
    axisLabel: "Grade (%)",
    getValue: getGradePercent,
  },
  {
    key: "altitudeM",
    label: "Altitude",
    axisLabel: "Altitude (m)",
    getValue: (point) => point.altitudeM,
  },
];

export function buildPowerBracketHistogram(
  points: TrackPoint[],
  options: TrackAnalysisOptions = {},
): TrackPowerBracketHistogram | undefined {
  const secondsByBucket = createPowerBracketHistogramBuckets();
  let totalSeconds = assignTimedBracketHistogramDurations(
    points,
    secondsByBucket,
    (interval) => getPowerBracketHistogramBucketIndex(interval.point.powerW),
    options,
  );

  if (totalSeconds === 0 && !hasTimedAnalysisPointPairs(points)) {
    totalSeconds = assignSampleBracketHistogramDurations(
      getMovingAnalysisPoints(points, options),
      secondsByBucket,
      (point) => getPowerBracketHistogramBucketIndex(point.powerW),
    );
  }

  if (totalSeconds === 0) {
    return undefined;
  }

  const buckets = secondsByBucket
    .map((seconds, index) => {
      return seconds > 0
        ? { label: getPowerBracketHistogramBucketLabel(index), seconds }
        : undefined;
    })
    .filter((bucket): bucket is TrackAnalysisHistogramBucket => Boolean(bucket));

  return {
    bucketSizeW: POWER_BRACKET_HISTOGRAM_BUCKET_SIZE_W,
    maxBucketW: POWER_BRACKET_HISTOGRAM_MAX_BUCKET_W,
    totalSeconds,
    buckets,
  };
}

export function buildSpeedBracketHistogram(
  points: TrackPoint[],
  options: TrackAnalysisOptions = {},
): TrackSpeedBracketHistogram | undefined {
  const secondsByBucket = createSpeedBracketHistogramBuckets();
  let totalSeconds = assignTimedBracketHistogramDurations(
    points,
    secondsByBucket,
    (interval) => getSpeedBracketHistogramBucketIndex(interval.speedKph),
    options,
  );

  if (totalSeconds === 0 && !hasTimedAnalysisPointPairs(points)) {
    totalSeconds = assignSampleBracketHistogramDurations(
      getMovingAnalysisPoints(points, options),
      secondsByBucket,
      (point) => getSpeedBracketHistogramBucketIndex(getPointSpeedKph(point)),
    );
  }

  if (totalSeconds === 0) {
    return undefined;
  }

  return {
    bucketSizeKph: SPEED_BRACKET_HISTOGRAM_BUCKET_SIZE_KPH,
    maxBucketKph: SPEED_BRACKET_HISTOGRAM_MAX_BUCKET_KPH,
    totalSeconds,
    buckets: buildLeadingBracketHistogramBuckets(
      secondsByBucket,
      getSpeedBracketHistogramBucketLabel,
    ),
  };
}

export function buildCadenceBracketHistogram(
  points: TrackPoint[],
  options: TrackAnalysisOptions = {},
): TrackCadenceBracketHistogram | undefined {
  const secondsByBucket = createCadenceBracketHistogramBuckets();
  let totalSeconds = assignTimedBracketHistogramDurations(
    points,
    secondsByBucket,
    (interval) => getCadenceBracketHistogramBucketIndex(interval.point.cadenceRpm),
    options,
  );

  if (totalSeconds === 0 && !hasTimedAnalysisPointPairs(points)) {
    totalSeconds = assignSampleBracketHistogramDurations(
      getMovingAnalysisPoints(points, options),
      secondsByBucket,
      (point) => getCadenceBracketHistogramBucketIndex(point.cadenceRpm),
    );
  }

  if (totalSeconds === 0) {
    return undefined;
  }

  return {
    bucketSizeRpm: CADENCE_BRACKET_HISTOGRAM_BUCKET_SIZE_RPM,
    maxBucketRpm: CADENCE_BRACKET_HISTOGRAM_MAX_BUCKET_RPM,
    totalSeconds,
    buckets: buildLeadingBracketHistogramBuckets(
      secondsByBucket,
      getCadenceBracketHistogramBucketLabel,
    ),
  };
}

export function buildHeartRateBracketHistogram(
  points: TrackPoint[],
  options: TrackAnalysisOptions = {},
): TrackHeartRateBracketHistogram | undefined {
  const secondsByBucket = createHeartRateBracketHistogramBuckets();
  let totalSeconds = assignTimedBracketHistogramDurations(
    points,
    secondsByBucket,
    (interval) => getHeartRateBracketHistogramBucketIndex(interval.point.heartRateBpm),
    options,
  );

  if (totalSeconds === 0 && !hasTimedAnalysisPointPairs(points)) {
    totalSeconds = assignSampleBracketHistogramDurations(
      getMovingAnalysisPoints(points, options),
      secondsByBucket,
      (point) => getHeartRateBracketHistogramBucketIndex(point.heartRateBpm),
    );
  }

  if (totalSeconds === 0) {
    return undefined;
  }

  return {
    bucketSizeBpm: HEART_RATE_BRACKET_HISTOGRAM_BUCKET_SIZE_BPM,
    firstBucketMaxBpm: HEART_RATE_BRACKET_HISTOGRAM_FIRST_BUCKET_MAX_BPM,
    maxBucketBpm: HEART_RATE_BRACKET_HISTOGRAM_MAX_BUCKET_BPM,
    totalSeconds,
    buckets: buildLeadingBracketHistogramBuckets(
      secondsByBucket,
      getHeartRateBracketHistogramBucketLabel,
    ),
  };
}

export function buildSmoothedScatterSamples(
  points: TrackPoint[],
  options: BuildSmoothedScatterSamplesOptions = {},
): TrackSmoothedScatterSample[] {
  const windowSeconds = options.windowSeconds ||
    DEFAULT_SCATTER_SMOOTHING_SECONDS;
  const maxPoints = options.maxPoints || DEFAULT_SCATTER_MAX_POINTS;
  const metrics = options.metrics || TRACK_SCATTER_METRICS;
  const smoothed = buildAllSmoothedScatterSamples(
    points,
    windowSeconds,
    metrics,
    options,
  );
  return sampleEvenly(smoothed, maxPoints);
}

export function getAvailableScatterMetrics(
  points: TrackSmoothedScatterSample[],
  metrics: TrackScatterMetricDefinition[] = TRACK_SCATTER_METRICS,
): TrackScatterMetricDefinition[] {
  return metrics.filter((metric) => {
    let count = 0;
    for (const point of points) {
      const value = point[metric.key];
      if (isFiniteNumber(value)) {
        count += 1;
        if (count >= 2) {
          return true;
        }
      }
    }
    return false;
  });
}

export function buildScatterPlotPoints(
  points: TrackSmoothedScatterSample[],
  xKey: TrackScatterMetricKey,
  yKey: TrackScatterMetricKey,
  maxPoints = DEFAULT_SCATTER_MAX_POINTS,
): TrackScatterPoint[] {
  const filtered = points
    .map((point) => {
      const x = point[xKey];
      const y = point[yKey];
      return isFiniteNumber(x) && isFiniteNumber(y) ? { x, y } : undefined;
    })
    .filter((point): point is TrackScatterPoint => Boolean(point));

  return sampleEvenly(filtered, maxPoints);
}

export function getScatterAxisRange(
  values: number[],
  trimPercentile: boolean,
  lowerPercentile = DEFAULT_SCATTER_TRIM_LOWER_PERCENTILE,
  upperPercentile = DEFAULT_SCATTER_TRIM_UPPER_PERCENTILE,
): ScatterAxisRange {
  const finiteValues = values.filter((value) => Number.isFinite(value));
  if (finiteValues.length === 0) {
    return { min: 0, max: 1 };
  }

  const sorted = finiteValues.slice().sort((left, right) => left - right);
  const rawMin = trimPercentile ? getPercentile(sorted, lowerPercentile) : sorted[0];
  const rawMax = trimPercentile
    ? getPercentile(sorted, upperPercentile)
    : sorted[sorted.length - 1];
  if (!Number.isFinite(rawMin) || !Number.isFinite(rawMax) || rawMax <= rawMin) {
    const value = sorted[0];
    return { min: value - 1, max: value + 1 };
  }

  if (trimPercentile) {
    return { min: rawMin, max: rawMax };
  }

  const span = rawMax - rawMin;
  const padding = span * 0.05;
  return {
    min: rawMin - padding,
    max: rawMax + padding,
  };
}

export function createRangeTicks(
  minValue: number,
  maxValue: number,
  targetCount: number,
): number[] {
  if (
    !Number.isFinite(minValue) ||
    !Number.isFinite(maxValue) ||
    maxValue <= minValue
  ) {
    return [0];
  }

  const step = getNiceTickStep((maxValue - minValue) / targetCount);
  const first = Math.ceil(minValue / step) * step;
  const ticks: number[] = [];
  for (let value = first; value <= maxValue + step * 1e-9; value += step) {
    ticks.push(value);
  }
  return ticks.length > 0 ? ticks : [minValue, maxValue];
}

export function sampleEvenly<T>(items: T[], maxItems: number): T[] {
  if (items.length <= maxItems) {
    return items;
  }

  const sampled: T[] = [];
  for (let index = 0; index < maxItems; index += 1) {
    const sourceIndex = Math.round(index * (items.length - 1) / (maxItems - 1));
    sampled.push(items[sourceIndex]);
  }
  return sampled;
}

export function getTorqueEffectivenessPercentage(
  point: TrackPoint,
): number | undefined {
  return getSideAveragedMetricPercentage(
    point,
    [
      "torqueEffectivenessPercentage",
      "torqueEfficiencyPercentage",
      "torqueEffectiveness",
      "torqueEfficiency",
    ],
    [
      "leftTorqueEffectivenessPercentage",
      "leftTorqueEfficiencyPercentage",
      "leftTorqueEffectiveness",
      "leftTorqueEfficiency",
    ],
    [
      "rightTorqueEffectivenessPercentage",
      "rightTorqueEfficiencyPercentage",
      "rightTorqueEffectiveness",
      "rightTorqueEfficiency",
    ],
  );
}

export function getPedalSmoothnessPercentage(
  point: TrackPoint,
): number | undefined {
  return getSideAveragedMetricPercentage(
    point,
    [
      "pedalSmoothnessPercentage",
      "pedalingSmoothnessPercentage",
      "pedalSmoothness",
      "pedalingSmoothness",
    ],
    [
      "leftPedalSmoothnessPercentage",
      "leftPedalingSmoothnessPercentage",
      "leftPedalSmoothness",
      "leftPedalingSmoothness",
    ],
    [
      "rightPedalSmoothnessPercentage",
      "rightPedalingSmoothnessPercentage",
      "rightPedalSmoothness",
      "rightPedalingSmoothness",
    ],
  );
}

export function getEstimatedTorqueNm(point: TrackPoint): number | undefined {
  const powerW = point.powerW;
  const cadenceRpm = point.cadenceRpm;
  if (
    !isFiniteNumber(powerW) ||
    !isFiniteNumber(cadenceRpm) ||
    cadenceRpm < 10
  ) {
    return undefined;
  }

  return powerW / (cadenceRpm * 2 * Math.PI / 60);
}

export function resolveTrackAnalysisOptions(
  options: TrackAnalysisOptions = {},
): ResolvedTrackAnalysisOptions {
  const movingSpeedThresholdKph = isFiniteNumber(options.movingSpeedThresholdKph)
    ? options.movingSpeedThresholdKph
    : DEFAULT_MOVING_SPEED_THRESHOLD_KPH;
  return {
    movingSpeedThresholdKph: Math.max(0, movingSpeedThresholdKph),
  };
}

export function hasTimedAnalysisPointPairs(points: TrackPoint[]): boolean {
  const timed = getTimedAnalysisPoints(points);
  for (let index = 0; index + 1 < timed.length; index += 1) {
    if (timed[index + 1].time > timed[index].time) {
      return true;
    }
  }
  return false;
}

export function getMovingAnalysisIntervals(
  points: TrackPoint[],
  options: TrackAnalysisOptions = {},
): TrackMovingAnalysisInterval[] {
  const resolved = resolveTrackAnalysisOptions(options);
  const timed = getTimedAnalysisPoints(points);
  const intervals: TrackMovingAnalysisInterval[] = [];

  for (let index = 0; index + 1 < timed.length; index += 1) {
    const point = timed[index];
    const nextPoint = timed[index + 1];
    const seconds = nextPoint.time - point.time;
    if (seconds <= 0) {
      continue;
    }

    const speedKph = getMovingIntervalSpeedKph(
      point,
      nextPoint,
      seconds,
      resolved.movingSpeedThresholdKph,
    );
    if (!isFiniteNumber(speedKph)) {
      continue;
    }

    const distanceM = getAnalysisSegmentDistanceM(point, nextPoint);
    intervals.push({
      point,
      nextPoint,
      seconds,
      speedKph,
      ...(isFiniteNumber(distanceM) ? { distanceM } : {}),
    });
  }

  return intervals;
}

export function getMovingAnalysisPoints(
  points: TrackPoint[],
  options: TrackAnalysisOptions = {},
): TrackPoint[] {
  const resolved = resolveTrackAnalysisOptions(options);
  return points.filter((point) => {
    const speedKph = getPointSpeedKph(point);
    return (
      isFiniteNumber(speedKph) &&
      speedKph >= resolved.movingSpeedThresholdKph
    );
  });
}

export function getGradePercent(
  point: TrackPoint,
  index: number,
  points: TrackPoint[],
): number | undefined {
  const direct = getFirstMetricNumber(point, [
    "grade",
    "gradePercent",
    "slope",
    "slopePercent",
  ]);
  if (isFiniteNumber(direct)) {
    return direct;
  }

  return estimateGradePercent(index, points);
}

function buildAllSmoothedScatterSamples(
  points: TrackPoint[],
  windowSeconds: number,
  metrics: TrackScatterMetricDefinition[],
  options: TrackAnalysisOptions,
): TrackSmoothedScatterSample[] {
  if (points.length === 0) {
    return [];
  }

  const useTimedWindow = hasTimedAnalysisPoints(points);
  const movingIndexes = getMovingAnalysisIndexes(points, options);
  return points.flatMap((_, index) => {
    if (!movingIndexes.has(index)) {
      return [];
    }
    const smoothedPoint: TrackSmoothedScatterSample = {};
    metrics.forEach((metric) => {
      if (metric.key === "efficiency") {
        return;
      }
      const value = computeSmoothedMetric(
        points,
        index,
        metric,
        windowSeconds,
        useTimedWindow,
      );
      if (isFiniteNumber(value)) {
        smoothedPoint[metric.key] = value;
      }
    });

    const powerW = smoothedPoint.powerW;
    const heartRateBpm = smoothedPoint.heartRateBpm;
    if (
      isFiniteNumber(powerW) &&
      isFiniteNumber(heartRateBpm) &&
      heartRateBpm > 0
    ) {
      smoothedPoint.efficiency = powerW / heartRateBpm;
    }

    return [smoothedPoint];
  });
}

function computeSmoothedMetric(
  points: TrackPoint[],
  index: number,
  metric: TrackScatterMetricDefinition,
  windowSeconds: number,
  useTimedWindow: boolean,
): number | undefined {
  const samples: number[] = [];
  if (useTimedWindow) {
    const endTime = points[index]?.time;
    if (!isFiniteNumber(endTime)) {
      return undefined;
    }
    const startTime = endTime - windowSeconds;
    for (let cursor = index; cursor >= 0; cursor -= 1) {
      const time = points[cursor]?.time;
      if (!isFiniteNumber(time)) {
        continue;
      }
      if (time < startTime) {
        break;
      }
      const value = metric.getValue(points[cursor], cursor, points);
      if (isFiniteNumber(value)) {
        samples.push(value);
      }
    }
  } else {
    const startIndex = Math.max(0, index - windowSeconds + 1);
    for (let cursor = startIndex; cursor <= index; cursor += 1) {
      const value = metric.getValue(points[cursor], cursor, points);
      if (isFiniteNumber(value)) {
        samples.push(value);
      }
    }
  }

  if (samples.length === 0) {
    return undefined;
  }

  const sum = samples.reduce((total, value) => total + value, 0);
  return sum / samples.length;
}

function createPowerBracketHistogramBuckets(): number[] {
  return Array.from(
    {
      length:
        POWER_BRACKET_HISTOGRAM_MAX_BUCKET_W /
          POWER_BRACKET_HISTOGRAM_BUCKET_SIZE_W +
        2,
    },
    () => 0,
  );
}

function createSpeedBracketHistogramBuckets(): number[] {
  return Array.from(
    {
      length:
        SPEED_BRACKET_HISTOGRAM_MAX_BUCKET_KPH /
          SPEED_BRACKET_HISTOGRAM_BUCKET_SIZE_KPH +
        2,
    },
    () => 0,
  );
}

function createCadenceBracketHistogramBuckets(): number[] {
  return Array.from(
    {
      length:
        CADENCE_BRACKET_HISTOGRAM_MAX_BUCKET_RPM /
          CADENCE_BRACKET_HISTOGRAM_BUCKET_SIZE_RPM +
        2,
    },
    () => 0,
  );
}

function createHeartRateBracketHistogramBuckets(): number[] {
  return Array.from(
    {
      length:
        (HEART_RATE_BRACKET_HISTOGRAM_MAX_BUCKET_BPM -
          HEART_RATE_BRACKET_HISTOGRAM_FIRST_BUCKET_MAX_BPM) /
          HEART_RATE_BRACKET_HISTOGRAM_BUCKET_SIZE_BPM +
        3,
    },
    () => 0,
  );
}

function assignTimedBracketHistogramDurations(
  points: TrackPoint[],
  secondsByBucket: number[],
  getBucketIndex: (interval: TrackMovingAnalysisInterval) => number | undefined,
  options: TrackAnalysisOptions,
): number {
  let totalSeconds = 0;
  getMovingAnalysisIntervals(points, options).forEach((interval) => {
    const bucketIndex = getBucketIndex(interval);
    if (bucketIndex === undefined) {
      return;
    }

    secondsByBucket[bucketIndex] += interval.seconds;
    totalSeconds += interval.seconds;
  });

  return totalSeconds;
}

function assignSampleBracketHistogramDurations(
  points: TrackPoint[],
  secondsByBucket: number[],
  getBucketIndex: (point: TrackPoint) => number | undefined,
): number {
  let totalSeconds = 0;

  points.forEach((point) => {
    const bucketIndex = getBucketIndex(point);
    if (bucketIndex === undefined) {
      return;
    }

    secondsByBucket[bucketIndex] += 1;
    totalSeconds += 1;
  });

  return totalSeconds;
}

function buildLeadingBracketHistogramBuckets(
  secondsByBucket: number[],
  getBucketLabel: (index: number) => string,
): TrackAnalysisHistogramBucket[] {
  const lastNonZeroIndex = secondsByBucket.reduce((lastIndex, seconds, index) => {
    return seconds > 0 ? index : lastIndex;
  }, -1);
  if (lastNonZeroIndex < 0) {
    return [];
  }

  return secondsByBucket
    .slice(0, lastNonZeroIndex + 1)
    .map((seconds, index) => ({
      label: getBucketLabel(index),
      seconds,
    }));
}

function getPowerBracketHistogramBucketIndex(
  powerW: number | undefined,
): number | undefined {
  if (!isFiniteNumber(powerW) || powerW < 0) {
    return undefined;
  }

  if (powerW <= 0) {
    return 0;
  }

  if (powerW > POWER_BRACKET_HISTOGRAM_MAX_BUCKET_W) {
    return (
      POWER_BRACKET_HISTOGRAM_MAX_BUCKET_W /
        POWER_BRACKET_HISTOGRAM_BUCKET_SIZE_W +
      1
    );
  }

  return Math.ceil(powerW / POWER_BRACKET_HISTOGRAM_BUCKET_SIZE_W);
}

function getPowerBracketHistogramBucketLabel(index: number): string {
  if (index === 0) {
    return "0 W";
  }

  const maxIndex = POWER_BRACKET_HISTOGRAM_MAX_BUCKET_W /
    POWER_BRACKET_HISTOGRAM_BUCKET_SIZE_W;
  if (index > maxIndex) {
    return `>${POWER_BRACKET_HISTOGRAM_MAX_BUCKET_W} W`;
  }

  return `≤${index * POWER_BRACKET_HISTOGRAM_BUCKET_SIZE_W} W`;
}

function getSpeedBracketHistogramBucketIndex(
  speedKph: number | undefined,
): number | undefined {
  if (!isFiniteNumber(speedKph) || speedKph < 0) {
    return undefined;
  }

  if (speedKph <= 0) {
    return 0;
  }

  if (speedKph > SPEED_BRACKET_HISTOGRAM_MAX_BUCKET_KPH) {
    return getSpeedBracketHistogramOverflowBucketIndex();
  }

  return Math.ceil(speedKph / SPEED_BRACKET_HISTOGRAM_BUCKET_SIZE_KPH);
}

function getSpeedBracketHistogramOverflowBucketIndex(): number {
  return (
    SPEED_BRACKET_HISTOGRAM_MAX_BUCKET_KPH /
      SPEED_BRACKET_HISTOGRAM_BUCKET_SIZE_KPH +
    1
  );
}

function getSpeedBracketHistogramBucketLabel(index: number): string {
  if (index === 0) {
    return "0 km/h";
  }

  if (index >= getSpeedBracketHistogramOverflowBucketIndex()) {
    return `>${SPEED_BRACKET_HISTOGRAM_MAX_BUCKET_KPH} km/h`;
  }

  return `≤${index * SPEED_BRACKET_HISTOGRAM_BUCKET_SIZE_KPH} km/h`;
}

function getCadenceBracketHistogramBucketIndex(
  cadenceRpm: number | undefined,
): number | undefined {
  if (!isFiniteNumber(cadenceRpm) || cadenceRpm < 0) {
    return undefined;
  }

  if (cadenceRpm <= 0) {
    return 0;
  }

  if (cadenceRpm > CADENCE_BRACKET_HISTOGRAM_MAX_BUCKET_RPM) {
    return getCadenceBracketHistogramOverflowBucketIndex();
  }

  return Math.ceil(cadenceRpm / CADENCE_BRACKET_HISTOGRAM_BUCKET_SIZE_RPM);
}

function getCadenceBracketHistogramOverflowBucketIndex(): number {
  return (
    CADENCE_BRACKET_HISTOGRAM_MAX_BUCKET_RPM /
      CADENCE_BRACKET_HISTOGRAM_BUCKET_SIZE_RPM +
    1
  );
}

function getCadenceBracketHistogramBucketLabel(index: number): string {
  if (index === 0) {
    return "0 rpm";
  }

  if (index >= getCadenceBracketHistogramOverflowBucketIndex()) {
    return `>${CADENCE_BRACKET_HISTOGRAM_MAX_BUCKET_RPM} rpm`;
  }

  return `≤${index * CADENCE_BRACKET_HISTOGRAM_BUCKET_SIZE_RPM} rpm`;
}

function getHeartRateBracketHistogramBucketIndex(
  heartRateBpm: number | undefined,
): number | undefined {
  if (!isFiniteNumber(heartRateBpm) || heartRateBpm < 0) {
    return undefined;
  }

  if (heartRateBpm <= 0) {
    return 0;
  }

  if (heartRateBpm <= HEART_RATE_BRACKET_HISTOGRAM_FIRST_BUCKET_MAX_BPM) {
    return 1;
  }

  if (heartRateBpm > HEART_RATE_BRACKET_HISTOGRAM_MAX_BUCKET_BPM) {
    return getHeartRateBracketHistogramOverflowBucketIndex();
  }

  return (
    Math.ceil(
      (heartRateBpm - HEART_RATE_BRACKET_HISTOGRAM_FIRST_BUCKET_MAX_BPM) /
        HEART_RATE_BRACKET_HISTOGRAM_BUCKET_SIZE_BPM,
    ) + 1
  );
}

function getHeartRateBracketHistogramOverflowBucketIndex(): number {
  return (
    (HEART_RATE_BRACKET_HISTOGRAM_MAX_BUCKET_BPM -
      HEART_RATE_BRACKET_HISTOGRAM_FIRST_BUCKET_MAX_BPM) /
      HEART_RATE_BRACKET_HISTOGRAM_BUCKET_SIZE_BPM +
    2
  );
}

function getHeartRateBracketHistogramBucketLabel(index: number): string {
  if (index === 0) {
    return "0 bpm";
  }

  if (index === 1) {
    return `≤${HEART_RATE_BRACKET_HISTOGRAM_FIRST_BUCKET_MAX_BPM} bpm`;
  }

  if (index >= getHeartRateBracketHistogramOverflowBucketIndex()) {
    return `>${HEART_RATE_BRACKET_HISTOGRAM_MAX_BUCKET_BPM} bpm`;
  }

  return (
    `≤${
      HEART_RATE_BRACKET_HISTOGRAM_FIRST_BUCKET_MAX_BPM +
      (index - 1) * HEART_RATE_BRACKET_HISTOGRAM_BUCKET_SIZE_BPM
    } bpm`
  );
}

function getMovingAnalysisIndexes(
  points: TrackPoint[],
  options: TrackAnalysisOptions,
): Set<number> {
  const indexes = new Set<number>();
  if (hasTimedAnalysisPointPairs(points)) {
    const movingPoints = new Set(
      getMovingAnalysisIntervals(points, options).map((interval) => {
        return interval.point;
      }),
    );
    points.forEach((point, index) => {
      if (movingPoints.has(point)) {
        indexes.add(index);
      }
    });
    return indexes;
  }

  const movingPoints = new Set(getMovingAnalysisPoints(points, options));
  points.forEach((point, index) => {
    if (movingPoints.has(point)) {
      indexes.add(index);
    }
  });
  return indexes;
}

function getTimedAnalysisPoints(
  points: TrackPoint[],
): Array<TrackPoint & { time: number }> {
  return points
    .filter((point): point is TrackPoint & { time: number } => {
      return isFiniteNumber(point.time);
    })
    .sort((a, b) => a.time - b.time);
}

function getMovingIntervalSpeedKph(
  point: TrackPoint,
  nextPoint: TrackPoint,
  seconds: number,
  movingSpeedThresholdKph: number,
): number | undefined {
  const pointSpeed = getPointSpeedKph(point);
  const nextPointSpeed = getPointSpeedKph(nextPoint);
  const distanceM = getAnalysisSegmentDistanceM(point, nextPoint);
  const segmentSpeedKph = isFiniteNumber(distanceM) && seconds > 0
    ? Math.max(0, distanceM / seconds) * 3.6
    : undefined;
  const effectivePointSpeed = isFiniteNumber(pointSpeed)
    ? pointSpeed
    : segmentSpeedKph;
  const effectiveNextPointSpeed = isFiniteNumber(nextPointSpeed)
    ? nextPointSpeed
    : segmentSpeedKph;

  if (
    !isFiniteNumber(effectivePointSpeed) ||
    !isFiniteNumber(effectiveNextPointSpeed) ||
    effectivePointSpeed < movingSpeedThresholdKph ||
    effectiveNextPointSpeed < movingSpeedThresholdKph
  ) {
    return undefined;
  }

  return (effectivePointSpeed + effectiveNextPointSpeed) / 2;
}

function getAnalysisSegmentDistanceM(
  point: TrackPoint,
  nextPoint: TrackPoint,
): number | undefined {
  if (!isFiniteNumber(point.distanceM) || !isFiniteNumber(nextPoint.distanceM)) {
    return undefined;
  }
  return Math.max(0, nextPoint.distanceM - point.distanceM);
}

function getPointSpeedKph(point: TrackPoint): number | undefined {
  return isFiniteNumber(point.speedMps) ? point.speedMps * 3.6 : undefined;
}

function hasTimedAnalysisPoints(points: TrackPoint[]): boolean {
  for (let index = 0; index < points.length - 1; index += 1) {
    if (getPointDurationSeconds(points, index) > 0) {
      return true;
    }
  }
  return false;
}

function getPointDurationSeconds(points: TrackPoint[], index: number): number {
  const current = points[index]?.time;
  const next = points[index + 1]?.time;
  if (!isFiniteNumber(current) || !isFiniteNumber(next)) {
    return 0;
  }
  return next > current ? next - current : 0;
}


function getSideAveragedMetricPercentage(
  point: TrackPoint,
  combinedKeys: string[],
  leftKeys: string[],
  rightKeys: string[],
): number | undefined {
  const combined = getFirstMetricPercentage(point, combinedKeys);
  if (isFiniteNumber(combined)) {
    return combined;
  }

  const left = getFirstMetricPercentage(point, leftKeys);
  const right = getFirstMetricPercentage(point, rightKeys);
  if (isFiniteNumber(left) && isFiniteNumber(right)) {
    return (left + right) / 2;
  }
  return left ?? right;
}

function getFirstMetricPercentage(
  point: TrackPoint,
  keys: string[],
): number | undefined {
  const value = getFirstMetricNumber(point, keys);
  return isFiniteNumber(value) && value >= 0 && value <= 100
    ? value
    : undefined;
}

function getFirstMetricNumber(
  point: TrackPoint,
  keys: string[],
): number | undefined {
  for (const key of keys) {
    const value = getMetricNumber(point, key);
    if (isFiniteNumber(value)) {
      return value;
    }
  }
  return undefined;
}

function estimateGradePercent(
  index: number,
  points: TrackPoint[],
): number | undefined {
  const current = points[index];
  if (!hasDistanceAndAltitude(current)) {
    return undefined;
  }

  const previous = findDistanceAltitudePoint(points, index, -1);
  const next = findDistanceAltitudePoint(points, index, 1);
  const start = previous || current;
  const end = next || current;
  const distanceDelta = end.distanceM - start.distanceM;
  if (!Number.isFinite(distanceDelta) || Math.abs(distanceDelta) < 1) {
    return undefined;
  }

  return ((end.altitudeM - start.altitudeM) / distanceDelta) * 100;
}

function findDistanceAltitudePoint(
  points: TrackPoint[],
  startIndex: number,
  direction: -1 | 1,
): Required<Pick<TrackPoint, "distanceM" | "altitudeM">> | undefined {
  for (
    let index = startIndex + direction;
    index >= 0 && index < points.length;
    index += direction
  ) {
    const point = points[index];
    if (hasDistanceAndAltitude(point)) {
      return point;
    }
  }
  return undefined;
}

function hasDistanceAndAltitude(
  point: TrackPoint | undefined,
): point is Required<Pick<TrackPoint, "distanceM" | "altitudeM">> {
  return point !== undefined &&
    isFiniteNumber(point.distanceM) &&
    isFiniteNumber(point.altitudeM);
}

function getMetricNumber(point: TrackPoint, key: string): number | undefined {
  const value = point.metrics?.[key];
  return isFiniteNumber(value) ? value : undefined;
}

function getPercentile(sortedValues: number[], ratio: number): number {
  if (sortedValues.length === 1) {
    return sortedValues[0];
  }

  const position = ratio * (sortedValues.length - 1);
  const lowerIndex = Math.floor(position);
  const upperIndex = Math.ceil(position);
  const lower = sortedValues[lowerIndex];
  const upper = sortedValues[upperIndex];
  if (lowerIndex === upperIndex) {
    return lower;
  }
  return lower + (upper - lower) * (position - lowerIndex);
}

function getNiceTickStep(value: number): number {
  if (value <= 0 || !Number.isFinite(value)) {
    return 1;
  }

  const exponent = Math.floor(Math.log10(value));
  const fraction = value / Math.pow(10, exponent);
  let niceFraction = 1;
  if (fraction <= 1) {
    niceFraction = 1;
  } else if (fraction <= 2) {
    niceFraction = 2;
  } else if (fraction <= 5) {
    niceFraction = 5;
  } else {
    niceFraction = 10;
  }
  return niceFraction * Math.pow(10, exponent);
}


function getMetadataHistogram(
  input: TrackActivityMetadataInput,
  key: TrackHistogramKey,
): { totalSeconds: number; buckets: TrackAnalysisHistogramBucket[] } | undefined {
  const metadata = getActivityMetadataRecord(input);
  const histograms = metadata ? getRecordProperty(metadata, "histograms") : undefined;
  const value = histograms ? getRecordProperty(histograms, key) : undefined;
  if (!value || !Array.isArray(value.buckets)) {
    return undefined;
  }

  const buckets = value.buckets
    .map(readMetadataHistogramBucket)
    .filter((bucket): bucket is TrackAnalysisHistogramBucket => Boolean(bucket));
  if (buckets.length === 0) {
    return undefined;
  }

  return {
    totalSeconds: getNumberProperty(value, "totalSeconds") || 0,
    buckets,
  };
}

function readMetadataHistogramBucket(
  value: unknown,
): TrackAnalysisHistogramBucket | undefined {
  const record = asRecord(value);
  if (!record) {
    return undefined;
  }

  const label = getStringProperty(record, "label");
  const seconds = getNumberProperty(record, "seconds");
  if (!label || !isFiniteNumber(seconds) || seconds < 0) {
    return undefined;
  }

  return { label, seconds };
}

function createZoneDisplayRow<TZone extends string>(
  summary: {
    durations: Record<TZone, number>;
    percentages: Record<TZone, number>;
  },
  zone: TZone,
  label: string,
  color: string,
): TrackAnalysisDisplayRow {
  return {
    label,
    seconds: summary.durations[zone] || 0,
    percentage: summary.percentages[zone] || 0,
    color,
  };
}

function formatZoneLimit(value: number): string {
  return Number.isInteger(value)
    ? formatNumber(value, 0)
    : value.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
}

function getGrossSummaryText(
  metadata: Record<string, unknown>,
): string | undefined {
  const elapsedTime = getNumberProperty(metadata, "totalElapsedTime");
  const distanceM = getNumberProperty(metadata, "totalDistanceM");
  const parts: string[] = [];

  if (isFiniteNumber(elapsedTime)) {
    parts.push(`elapsed time ${formatDuration(elapsedTime)}`);
  }
  if (isFiniteNumber(distanceM)) {
    parts.push(`distance ${formatNumber(distanceM / 1000, 2)} km`);
  }
  if (
    isFiniteNumber(elapsedTime) &&
    elapsedTime > 0 &&
    isFiniteNumber(distanceM)
  ) {
    parts.push(`average speed ${formatNumber((distanceM / elapsedTime) * 3.6, 1)} km/h`);
  }

  return parts.length > 0 ? `gross: ${parts.join(", ")}` : undefined;
}

function getNetSummaryText(
  input: TrackActivityMetadataInput,
  metadata: Record<string, unknown>,
): string | undefined {
  const points = getActivityInputPoints(input);
  if (points.length < 2) {
    return undefined;
  }

  const analysis = getRecordProperty(metadata, "analysis");
  const movingSpeedThresholdKph = analysis
    ? getNumberProperty(analysis, "movingSpeedThresholdKph")
    : undefined;
  const intervals = getMovingAnalysisIntervals(points, {
    ...(isFiniteNumber(movingSpeedThresholdKph)
      ? { movingSpeedThresholdKph }
      : {}),
  });
  const movingTime = intervals.reduce((sum, interval) => {
    return sum + interval.seconds;
  }, 0);
  const movingDistanceM = intervals.reduce((sum, interval) => {
    return sum + (isFiniteNumber(interval.distanceM) ? interval.distanceM : 0);
  }, 0);

  if (movingTime <= 0 && movingDistanceM <= 0) {
    return undefined;
  }

  const parts: string[] = [];
  if (movingTime > 0) {
    parts.push(`moving time ${formatDuration(movingTime)}`);
  }
  if (movingDistanceM > 0) {
    parts.push(`distance ${formatNumber(movingDistanceM / 1000, 2)} km`);
  }
  if (movingTime > 0 && movingDistanceM > 0) {
    parts.push(`average speed ${formatNumber((movingDistanceM / movingTime) * 3.6, 1)} km/h`);
  }

  return parts.length > 0 ? `net: ${parts.join(", ")}` : undefined;
}

function getActivityInputPoints(input: TrackActivityMetadataInput): TrackPoint[] {
  const record = asRecord(input);
  return Array.isArray(record?.points)
    ? record.points.filter(isTrackPoint)
    : [];
}

function isTrackPoint(value: unknown): value is TrackPoint {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function getAnalysisSummaryText(
  analysis: Record<string, unknown>,
): string | undefined {
  const movingSpeedThresholdKph = getNumberProperty(
    analysis,
    "movingSpeedThresholdKph",
  );
  if (!isFiniteNumber(movingSpeedThresholdKph)) {
    return undefined;
  }
  return `moving threshold: >= ${formatNumber(movingSpeedThresholdKph, 1)} km/h`;
}

function appendStatsSummaryLine(
  lines: TrackMetadataSummaryLine[],
  statistics: Record<string, unknown>,
  key: string,
  label: string,
  unit: string,
) {
  const stats = getRecordProperty(statistics, key);
  if (!stats) {
    return;
  }

  const mean = getNumberProperty(stats, "mean");
  const median = getNumberProperty(stats, "median");
  const max = getNumberProperty(stats, "max");
  const parts: string[] = [];

  if (isFiniteNumber(mean)) {
    parts.push(`mean ${formatNumber(mean, getStatsPrecision(unit))}`);
  }
  if (isFiniteNumber(median)) {
    parts.push(`median ${formatNumber(median, getStatsPrecision(unit))}`);
  }
  if (isFiniteNumber(max)) {
    parts.push(`max ${formatNumber(max, getStatsPrecision(unit))}`);
  }

  if (parts.length > 0) {
    lines.push({ key, text: `${label}: ${parts.join(", ")} ${unit}` });
  }
}

function appendPedalingSummaryLines(
  lines: TrackMetadataSummaryLine[],
  pedaling: Record<string, unknown>,
) {
  const firstParts: string[] = [];
  const secondParts: string[] = [];

  appendDurationSummaryPart(firstParts, pedaling, "totalSeconds", "time");
  appendNumberSummaryPart(
    firstParts,
    pedaling,
    "averageSpeedKph",
    "speed",
    "km/h",
  );
  appendNumberSummaryPart(
    firstParts,
    pedaling,
    "averageCadenceRpm",
    "cadence",
    "rpm",
  );
  appendNumberSummaryPart(
    secondParts,
    pedaling,
    "averageHeartRateBpm",
    "heart rate",
    "bpm",
  );
  appendNumberSummaryPart(
    secondParts,
    pedaling,
    "averagePowerW",
    "power",
    "W",
  );
  appendNumberSummaryPart(
    secondParts,
    pedaling,
    "normalizedPowerW",
    "NP",
    "W",
  );

  appendPedalingStatsLine(lines, "pedaling-stats-primary", firstParts);
  appendPedalingStatsLine(lines, "pedaling-stats-secondary", secondParts);
}

function appendDurationSummaryPart(
  parts: string[],
  record: Record<string, unknown>,
  key: string,
  label: string,
) {
  const value = getNumberProperty(record, key);
  if (isFiniteNumber(value)) {
    parts.push(`${label} ${formatDuration(value)}`);
  }
}

function appendNumberSummaryPart(
  parts: string[],
  record: Record<string, unknown>,
  key: string,
  label: string,
  unit: string,
) {
  const value = getNumberProperty(record, key);
  if (isFiniteNumber(value)) {
    parts.push(`${label} ${formatNumber(value, 1)} ${unit}`);
  }
}

function appendPedalingStatsLine(
  lines: TrackMetadataSummaryLine[],
  key: string,
  parts: string[],
) {
  if (parts.length > 0) {
    lines.push({ key, text: `pedaling stats: ${parts.join(", ")}` });
  }
}

function appendPedalingDynamicsSummaryLines(
  lines: TrackMetadataSummaryLine[],
  dynamics: Record<string, unknown>,
) {
  const leftRightBalance = getRecordProperty(dynamics, "leftRightBalance");
  if (leftRightBalance) {
    appendLeftRightBalanceSummaryLine(lines, leftRightBalance);
  }

  const torqueEffectiveness = getRecordProperty(dynamics, "torqueEffectiveness");
  if (torqueEffectiveness) {
    appendSidePercentagesSummaryLine(
      lines,
      torqueEffectiveness,
      "pedaling dynamics | torque effectiveness",
    );
  }

  const pedalSmoothness = getRecordProperty(dynamics, "pedalSmoothness");
  if (pedalSmoothness) {
    appendSidePercentagesSummaryLine(
      lines,
      pedalSmoothness,
      "pedaling dynamics | pedal smoothness",
    );
  }
}

function appendLeftRightBalanceSummaryLine(
  lines: TrackMetadataSummaryLine[],
  balance: Record<string, unknown>,
) {
  const left = getNumberProperty(balance, "leftPercentage");
  const right = getNumberProperty(balance, "rightPercentage");
  const parts: string[] = [];
  if (isFiniteNumber(left)) {
    parts.push(`L ${formatNumber(left, 1)}%`);
  }
  if (isFiniteNumber(right)) {
    parts.push(`R ${formatNumber(right, 1)}%`);
  }
  if (parts.length > 0) {
    lines.push({
      key: "pedaling-dynamics-left-right-balance",
      text: `pedaling dynamics | L/R balance: ${parts.join(" / ")}`,
    });
  }
}

function appendSidePercentagesSummaryLine(
  lines: TrackMetadataSummaryLine[],
  percentages: Record<string, unknown>,
  label: string,
) {
  const left = getNumberProperty(percentages, "leftPercentage");
  const right = getNumberProperty(percentages, "rightPercentage");
  const combined = getNumberProperty(percentages, "combinedPercentage");
  const parts: string[] = [];
  if (isFiniteNumber(left)) {
    parts.push(`L ${formatNumber(left, 1)}%`);
  }
  if (isFiniteNumber(right)) {
    parts.push(`R ${formatNumber(right, 1)}%`);
  }
  if (isFiniteNumber(combined)) {
    parts.push(`combined ${formatNumber(combined, 1)}%`);
  }
  if (parts.length > 0) {
    lines.push({
      key: label.replace(/[^a-z0-9]+/gi, "-").toLowerCase(),
      text: `${label}: ${parts.join(", ")}`,
    });
  }
}

function appendDurationSummaryLine(
  lines: TrackMetadataSummaryLine[],
  object: Record<string, unknown>,
  key: string,
  label: string,
) {
  const value = getNumberProperty(object, key);
  if (isFiniteNumber(value)) {
    lines.push({
      key: `${label}-${key}`,
      text: `${label}: ${formatDuration(value)}`,
    });
  }
}

function appendNumberSummaryLine(
  lines: TrackMetadataSummaryLine[],
  object: Record<string, unknown>,
  key: string,
  label: string,
  unit: string,
) {
  const value = getNumberProperty(object, key);
  if (isFiniteNumber(value)) {
    lines.push({
      key: `${label}-${key}`,
      text: `${label}: ${formatNumber(value, 1)} ${unit}`,
    });
  }
}

export function getDerivedTrainingMetrics(
  input: TrackActivityMetadataInput,
  ftpW: number | undefined,
): TrackDerivedTrainingMetrics {
  const metadata = getActivityMetadataRecord(input);
  if (!metadata || !isFiniteNumber(ftpW) || ftpW <= 0) {
    return {};
  }

  const normalizedPowerW = getTrainingNormalizedPowerW(metadata);
  if (!isFiniteNumber(normalizedPowerW) || normalizedPowerW <= 0) {
    return {};
  }

  const intensityFactor = normalizedPowerW / ftpW;
  const meanPowerW = getStatisticsMeanValue(metadata, "powerW");
  const totalSeconds = getActivityDurationSeconds(metadata);
  return {
    intensityFactor,
    variabilityIndex: isFiniteNumber(meanPowerW) && meanPowerW > 0
      ? normalizedPowerW / meanPowerW
      : undefined,
    trainingStressScore: isFiniteNumber(totalSeconds) && totalSeconds > 0
      ? (totalSeconds * normalizedPowerW * intensityFactor) / (ftpW * 3600) * 100
      : undefined,
  };
}

export function getDerivedHeartRateMetrics(
  input: TrackActivityMetadataInput,
  lthrBpm: number | undefined,
): TrackDerivedHeartRateMetrics {
  const metadata = getActivityMetadataRecord(input);
  if (!metadata || !isFiniteNumber(lthrBpm) || lthrBpm <= 0) {
    return {};
  }

  const meanHeartRateBpm = getStatisticsMeanValue(metadata, "heartRateBpm");
  const maxHeartRateBpm = getStatisticsMaxValue(metadata, "heartRateBpm");
  return {
    meanHeartRatePercentageOfLthr: isFiniteNumber(meanHeartRateBpm)
      ? meanHeartRateBpm / lthrBpm * 100
      : undefined,
    maxHeartRatePercentageOfLthr: isFiniteNumber(maxHeartRateBpm)
      ? maxHeartRateBpm / lthrBpm * 100
      : undefined,
  };
}

function appendDerivedTrainingSummaryLines(
  lines: TrackMetadataSummaryLine[],
  metadata: Record<string, unknown>,
  ftpW: number | undefined,
) {
  const metrics = getDerivedTrainingMetrics(metadata, ftpW);
  const parts: string[] = [];
  if (isFiniteNumber(metrics.intensityFactor)) {
    parts.push(`IF ${formatNumber(metrics.intensityFactor, 3)}`);
  }
  if (isFiniteNumber(metrics.variabilityIndex)) {
    parts.push(`VI ${formatNumber(metrics.variabilityIndex, 3)}`);
  }
  if (isFiniteNumber(metrics.trainingStressScore)) {
    parts.push(`TSS ${formatNumber(metrics.trainingStressScore, 1)}`);
  }

  if (parts.length > 0) {
    lines.push({
      key: "training-metrics",
      text: `training metrics: ${parts.join(", ")}`,
    });
  }
}

function appendDerivedHeartRateSummaryLines(
  lines: TrackMetadataSummaryLine[],
  metadata: Record<string, unknown>,
  lthrBpm: number | undefined,
) {
  const metrics = getDerivedHeartRateMetrics(metadata, lthrBpm);
  if (isFiniteNumber(metrics.meanHeartRatePercentageOfLthr)) {
    lines.push({
      key: "heart-rate-mean-lthr",
      text: `mean HR: ${formatNumber(metrics.meanHeartRatePercentageOfLthr, 1)}% LTHR`,
    });
  }
  if (isFiniteNumber(metrics.maxHeartRatePercentageOfLthr)) {
    lines.push({
      key: "heart-rate-max-lthr",
      text: `max HR: ${formatNumber(metrics.maxHeartRatePercentageOfLthr, 1)}% LTHR`,
    });
  }
}

function getTrainingNormalizedPowerW(
  metadata: Record<string, unknown>,
): number | undefined {
  const training = getRecordProperty(metadata, "training");
  return training ? getNumberProperty(training, "normalizedPowerW") : undefined;
}

function getStatisticsMeanValue(
  metadata: Record<string, unknown>,
  key: string,
): number | undefined {
  const statistics = getRecordProperty(metadata, "statistics");
  const stats = statistics ? getRecordProperty(statistics, key) : undefined;
  return stats ? getNumberProperty(stats, "mean") : undefined;
}

function getStatisticsMaxValue(
  metadata: Record<string, unknown>,
  key: string,
): number | undefined {
  const statistics = getRecordProperty(metadata, "statistics");
  const stats = statistics ? getRecordProperty(statistics, key) : undefined;
  return stats ? getNumberProperty(stats, "max") : undefined;
}

function getActivityDurationSeconds(
  metadata: Record<string, unknown>,
): number | undefined {
  return getNumberProperty(metadata, "totalTimerTime") ||
    getNumberProperty(metadata, "totalElapsedTime");
}

function appendDeviceSummaryLines(
  lines: TrackMetadataSummaryLine[],
  metadata: Record<string, unknown>,
) {
  const recordingDevice = getRecordProperty(metadata, "recordingDevice");
  const recordingDeviceLabel = recordingDevice
    ? formatDeviceSummary(recordingDevice)
    : undefined;
  if (recordingDeviceLabel) {
    lines.push({
      key: "recordingDevice",
      text: `recording device: ${recordingDeviceLabel}`,
    });
  }

  const devices = metadata.devices;
  if (!Array.isArray(devices)) {
    return;
  }

  const labels = devices
    .map(asRecord)
    .filter((device): device is Record<string, unknown> => Boolean(device))
    .map(formatDeviceSummary)
    .filter((label): label is string => Boolean(label));
  if (labels.length > 0) {
    lines.push({ key: "devices", text: `devices: ${labels.join("; ")}` });
  }
}

function appendTrainingSummaryLines(
  lines: TrackMetadataSummaryLine[],
  training: Record<string, unknown>,
) {
  const normalizedPowerW = getNumberProperty(training, "normalizedPowerW");
  const totalWorkJ = getNumberProperty(training, "totalWorkJ");
  const totalCaloriesCal = getNumberProperty(training, "totalCaloriesCal");

  if (isFiniteNumber(normalizedPowerW)) {
    lines.push({
      key: "normalizedPowerW",
      text: `normalized power: ${formatNumber(normalizedPowerW, 1)} W`,
    });
  }
  if (isFiniteNumber(totalWorkJ)) {
    lines.push({ key: "totalWorkJ", text: `total work: ${formatNumber(totalWorkJ, 0)} J` });
  }
  if (isFiniteNumber(totalCaloriesCal)) {
    lines.push({
      key: "totalCaloriesCal",
      text: `calories: ${formatNumber(totalCaloriesCal, 0)} cal`,
    });
  }
}

function formatDeviceSummary(
  device: Record<string, unknown>,
): string | undefined {
  const parts = [
    getStringProperty(device, "manufacturer"),
    getStringProperty(device, "productName") || getStringProperty(device, "product"),
  ].filter((part): part is string => Boolean(part));
  return parts.length > 0 ? parts.join(" ") : undefined;
}

function getActivityMetadataRecord(
  input: TrackActivityMetadataInput,
): Record<string, unknown> | undefined {
  const record = asRecord(input);
  if (!record) {
    return undefined;
  }
  return asRecord(record.metadata) || record;
}

function getRecordProperty(
  object: Record<string, unknown>,
  key: string,
): Record<string, unknown> | undefined {
  return asRecord(object[key]);
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function getStringProperty(
  object: Record<string, unknown>,
  key: string,
): string | undefined {
  const value = object[key];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function getNumberProperty(
  object: Record<string, unknown>,
  key: string,
): number | undefined {
  const value = object[key];
  return isFiniteNumber(value) ? value : undefined;
}

function formatDuration(seconds: number): string {
  const totalSeconds = Math.max(0, Math.round(seconds));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const restSeconds = totalSeconds % 60;

  if (hours > 0) {
    return `${hours}:${minutes.toString().padStart(2, "0")}:${restSeconds
      .toString()
      .padStart(2, "0")}`;
  }

  return `${minutes}:${restSeconds.toString().padStart(2, "0")}`;
}

function formatNumber(value: number, digits: number): string {
  return value.toFixed(digits);
}

function getStatsPrecision(_unit: string): number {
  return 1;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}
