import type { TrackPoint } from "./activity";

export const POWER_BRACKET_HISTOGRAM_BUCKET_SIZE_W = 25;
export const POWER_BRACKET_HISTOGRAM_MAX_BUCKET_W = 2000;
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
  "gradePercent" |
  "elevationM";

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
    label: "Efficiency",
    axisLabel: "Efficiency (W/bpm)",
    getValue: () => undefined,
  },
  {
    key: "estimatedTorqueNm",
    label: "Torque",
    axisLabel: "Torque (Nm)",
    getValue: getEstimatedTorqueNm,
  },
  {
    key: "gradePercent",
    label: "Grade",
    axisLabel: "Grade (%)",
    getValue: getGradePercent,
  },
  {
    key: "elevationM",
    label: "Elevation",
    axisLabel: "Elevation (m)",
    getValue: (point) => point.elevationM,
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
    (point) => getPowerBracketHistogramBucketIndex(point.powerW),
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

export function buildHeartRateBracketHistogram(
  points: TrackPoint[],
  options: TrackAnalysisOptions = {},
): TrackHeartRateBracketHistogram | undefined {
  const secondsByBucket = createHeartRateBracketHistogramBuckets();
  let totalSeconds = assignTimedBracketHistogramDurations(
    points,
    secondsByBucket,
    (point) => getHeartRateBracketHistogramBucketIndex(point.heartRateBpm),
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

  const buckets = secondsByBucket
    .map((seconds, index) => {
      return seconds > 0
        ? { label: getHeartRateBracketHistogramBucketLabel(index), seconds }
        : undefined;
    })
    .filter((bucket): bucket is TrackAnalysisHistogramBucket => Boolean(bucket));

  return {
    bucketSizeBpm: HEART_RATE_BRACKET_HISTOGRAM_BUCKET_SIZE_BPM,
    firstBucketMaxBpm: HEART_RATE_BRACKET_HISTOGRAM_FIRST_BUCKET_MAX_BPM,
    maxBucketBpm: HEART_RATE_BRACKET_HISTOGRAM_MAX_BUCKET_BPM,
    totalSeconds,
    buckets,
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
  getBucketIndex: (point: TrackPoint) => number | undefined,
  options: TrackAnalysisOptions,
): number {
  let totalSeconds = 0;
  getMovingAnalysisIntervals(points, options).forEach((interval) => {
    const bucketIndex = getBucketIndex(interval.point);
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
  if (!hasDistanceAndElevation(current)) {
    return undefined;
  }

  const previous = findDistanceElevationPoint(points, index, -1);
  const next = findDistanceElevationPoint(points, index, 1);
  const start = previous || current;
  const end = next || current;
  const distanceDelta = end.distanceM - start.distanceM;
  if (!Number.isFinite(distanceDelta) || Math.abs(distanceDelta) < 1) {
    return undefined;
  }

  return ((end.elevationM - start.elevationM) / distanceDelta) * 100;
}

function findDistanceElevationPoint(
  points: TrackPoint[],
  startIndex: number,
  direction: -1 | 1,
): Required<Pick<TrackPoint, "distanceM" | "elevationM">> | undefined {
  for (
    let index = startIndex + direction;
    index >= 0 && index < points.length;
    index += direction
  ) {
    const point = points[index];
    if (hasDistanceAndElevation(point)) {
      return point;
    }
  }
  return undefined;
}

function hasDistanceAndElevation(
  point: TrackPoint | undefined,
): point is Required<Pick<TrackPoint, "distanceM" | "elevationM">> {
  return point !== undefined &&
    isFiniteNumber(point.distanceM) &&
    isFiniteNumber(point.elevationM);
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

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}
