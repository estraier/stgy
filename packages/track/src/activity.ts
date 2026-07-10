import {
  DEFAULT_MOVING_SPEED_THRESHOLD_KPH,
  buildCadenceBracketHistogram,
  buildHeartRateBracketHistogram,
  buildPowerBracketHistogram,
  buildSpeedBracketHistogram,
  getMovingAnalysisIntervals,
  getMovingAnalysisPoints,
  hasTimedAnalysisPointPairs,
} from "./analysis";
import type { TrackMovingAnalysisInterval } from "./analysis";

const DEFAULT_MAX_POINTS = 3000;
const PEDALING_MIN_SPEED_KPH = 3;
const PEDALING_MIN_CADENCE_RPM = 10;
const PEDALING_MIN_POWER_W = 20;
export const STRAVA_POWER_CURVE_DURATIONS_SECONDS = [
  5, 10, 15, 20, 30, 45, 60, 90, 120, 180, 300, 600, 900, 1200, 1800, 2700,
  3600, 5400, 7200,
] as const;

const POWER_ZONE_KEYS: TrackPowerZoneKey[] = [
  "z1",
  "z2",
  "z3",
  "z4",
  "z5",
  "z6",
  "z7",
];
const HEART_RATE_ZONE_KEYS: TrackHeartRateZoneKey[] = [
  "z1",
  "z2",
  "z3",
  "z4",
  "z5",
];
const ZONE_RATIO_EPSILON = 1e-12;
const RESERVED_METRIC_NAMES = new Set([
  "times",
  "distances",
  "elevations",
  "heartRates",
  "cadences",
  "powers",
  "speeds",
  "__proto__",
  "constructor",
  "prototype",
]);

export type TrackActivity = {
  schemaVersion: 1;
  metadata: TrackActivityMetadata;
  points: TrackPoint[];
  pins?: TrackActivityPin[];
  warnings: TrackWarning[];
};

export type TrackActivityPin = {
  lat: number;
  lon: number;
  elevationM?: number;
  properties?: Record<string, unknown>;
};

export type TrackActivityMetadata = {
  source?: TrackDataSource;
  name?: string;
  description?: string;
  sport?: string;
  subSport?: string;
  recordingDevice?: TrackDeviceInfo;
  devices?: TrackDeviceInfo[];
  createdAt?: number;
  startTime?: number;
  endTime?: number;
  localTimeOffsetSeconds?: number;
  totalElapsedTime?: number;
  totalTimerTime?: number;
  totalDistanceM?: number;
  analysis?: TrackActivityAnalysisMetadata;
  statistics?: TrackActivityStatistics;
  training?: TrackActivityTraining;
  bestEfforts?: TrackActivityBestEfforts;
  histograms?: TrackActivityHistograms;
  pedaling?: TrackActivityPedaling;
};

export type TrackActivityAnalysisMetadata = {
  movingSpeedThresholdKph: number;
};

export type TrackActivityStatistics = {
  speedKph?: TrackNumericStats;
  cadenceRpm?: TrackNumericStats;
  heartRateBpm?: TrackNumericStats;
  powerW?: TrackNumericStats;
  temperatureC?: TrackNumericStats;
};

export type TrackNumericStats = {
  mean?: number;
  median?: number;
  max?: number;
};

export type TrackActivityTraining = {
  normalizedPowerW?: number;
  totalWorkJ?: number;
  totalCaloriesCal?: number;
  source?: TrackActivityTrainingSource;
};

export type TrackActivityTrainingSource = {
  normalizedPower?: "fit" | "computed";
  totalWork?: "fit" | "computed";
  totalCalories?: "fit";
};

export type TrackActivityBestEfforts = {
  powerW?: TrackDurationBestEfforts;
};

export type TrackDurationBestEfforts = Record<string, number>;

export type TrackActivityHistograms = {
  speedKph?: TrackSpeedHistogram;
  cadenceRpm?: TrackCadenceHistogram;
  powerW?: TrackPowerHistogram;
  heartRateBpm?: TrackHeartRateHistogram;
};

export type TrackPowerHistogram = {
  bucketSizeW: number;
  maxBucketW: number;
  totalSeconds: number;
  buckets: TrackPowerHistogramBucket[];
};

export type TrackPowerHistogramBucket = {
  label: string;
  seconds: number;
};

export type TrackSpeedHistogram = {
  bucketSizeKph: number;
  maxBucketKph: number;
  totalSeconds: number;
  buckets: TrackSpeedHistogramBucket[];
};

export type TrackSpeedHistogramBucket = {
  label: string;
  seconds: number;
};

export type TrackCadenceHistogram = {
  bucketSizeRpm: number;
  maxBucketRpm: number;
  totalSeconds: number;
  buckets: TrackCadenceHistogramBucket[];
};

export type TrackCadenceHistogramBucket = {
  label: string;
  seconds: number;
};

export type TrackHeartRateHistogram = {
  bucketSizeBpm: number;
  firstBucketMaxBpm: number;
  maxBucketBpm: number;
  totalSeconds: number;
  buckets: TrackHeartRateHistogramBucket[];
};

export type TrackHeartRateHistogramBucket = {
  label: string;
  seconds: number;
};

export type TrackActivityPedaling = {
  totalSeconds: number;
  averageSpeedKph?: number;
  averageCadenceRpm?: number;
  averageHeartRateBpm?: number;
  averagePowerW?: number;
  normalizedPowerW?: number;
};

export type TrackPowerZoneKey = "z1" | "z2" | "z3" | "z4" | "z5" | "z6" | "z7";
export type TrackHeartRateZoneKey = "z1" | "z2" | "z3" | "z4" | "z5";

export type TrackPowerZoneSummary = TrackZoneSummary<TrackPowerZoneKey>;
export type TrackHeartRateZoneSummary = TrackZoneSummary<TrackHeartRateZoneKey>;

export type TrackZoneSummary<TZone extends string> = {
  totalSeconds: number;
  durations: Record<TZone, number>;
  percentages: Record<TZone, number>;
};

export type TrackDataSource = {
  type: string;
  formatVersion?: string;
};

export type TrackDeviceInfo = {
  manufacturer?: string;
  product?: string;
  productName?: string;
  serialNumber?: number;
  softwareVersion?: string;
  hardwareVersion?: string;
  deviceType?: string;
  sourceType?: string;
};

export type TrackPoint = {
  time?: number;
  lat?: number;
  lon?: number;
  distanceM?: number;
  elevationM?: number;
  heartRateBpm?: number;
  cadenceRpm?: number;
  powerW?: number;
  speedMps?: number;
  temperatureC?: number;
  metrics?: Record<string, number>;
};

export type TrackJsonBbox = [number, number, number, number];
export type TrackJsonRcenter = [number, number];

export type TrackWarning = {
  code: string;
  message: string;
};

export type DownsampleTrackOptions = {
  maxPoints?: number;
  strategy?: "uniform" | "aggregate";
  preserveEndpoints?: boolean;
};

export type MergeTrackActivitiesOptions = {
  name?: string;
  description?: string;
  movingSpeedThresholdMps?: number;
};

export type TrimTrackActivityOptions = {
  trimStartSeconds?: number;
  trimEndSeconds?: number;
};

export function getPowerZone(
  powerW: number,
  ftpW: number,
): TrackPowerZoneKey | undefined {
  assertPositiveFiniteNumber(ftpW, "ftpW");
  if (!isFiniteNumber(powerW)) {
    return undefined;
  }

  const ratio = powerW / ftpW;
  if (isRatioAtMost(ratio, 0.55)) {
    return "z1";
  }
  if (isRatioAtMost(ratio, 0.75)) {
    return "z2";
  }
  if (isRatioAtMost(ratio, 0.9)) {
    return "z3";
  }
  if (isRatioAtMost(ratio, 1.05)) {
    return "z4";
  }
  if (isRatioAtMost(ratio, 1.2)) {
    return "z5";
  }
  if (isRatioAtMost(ratio, 1.5)) {
    return "z6";
  }

  return "z7";
}

export function getHeartRateZone(
  heartRateBpm: number,
  lthrBpm: number,
): TrackHeartRateZoneKey | undefined {
  assertPositiveFiniteNumber(lthrBpm, "lthrBpm");
  if (!isFiniteNumber(heartRateBpm)) {
    return undefined;
  }

  const ratio = heartRateBpm / lthrBpm;
  if (isRatioAtMost(ratio, 0.81)) {
    return "z1";
  }
  if (isRatioAtMost(ratio, 0.89)) {
    return "z2";
  }
  if (isRatioAtMost(ratio, 0.94)) {
    return "z3";
  }
  if (isRatioAtMost(ratio, 1)) {
    return "z4";
  }

  return "z5";
}

export function computePowerZoneSummary(
  points: TrackPoint[],
  ftpW: number,
): TrackPowerZoneSummary {
  assertPositiveFiniteNumber(ftpW, "ftpW");
  return computeZoneSummary(
    points,
    (point) => point.powerW,
    (value) => getPowerZone(value, ftpW),
    POWER_ZONE_KEYS,
  );
}

export function computeHeartRateZoneSummary(
  points: TrackPoint[],
  lthrBpm: number,
): TrackHeartRateZoneSummary {
  assertPositiveFiniteNumber(lthrBpm, "lthrBpm");
  return computeZoneSummary(
    points,
    (point) => point.heartRateBpm,
    (value) => getHeartRateZone(value, lthrBpm),
    HEART_RATE_ZONE_KEYS,
  );
}

export function downsampleTrackActivity(
  activity: TrackActivity,
  options: DownsampleTrackOptions = {},
): TrackActivity {
  const strategy = options.strategy || "uniform";
  if (strategy !== "uniform" && strategy !== "aggregate") {
    throw new RangeError(`Unsupported downsampling strategy: ${strategy}`);
  }

  const maxPoints = normalizeMaxPoints(options.maxPoints ?? DEFAULT_MAX_POINTS);
  const preserveEndpoints = options.preserveEndpoints !== false;

  if (activity.points.length <= maxPoints) {
    return cloneTrackActivity(activity);
  }

  if (strategy === "uniform") {
    return downsampleTrackActivityUniform(
      activity,
      maxPoints,
      preserveEndpoints,
    );
  }

  return downsampleTrackActivityAggregate(
    activity,
    maxPoints,
    preserveEndpoints,
  );
}

export function trimTrackActivity(
  activity: TrackActivity,
  options: TrimTrackActivityOptions = {},
): TrackActivity {
  const trimStartSeconds = normalizeTrimSeconds(options.trimStartSeconds || 0);
  const trimEndSeconds = normalizeTrimSeconds(options.trimEndSeconds || 0);
  if (trimStartSeconds === 0 && trimEndSeconds === 0) {
    return cloneTrackActivity(activity);
  }

  const timeRange = getTrackActivityPointTimeRange(activity.points);
  if (!timeRange) {
    throw new RangeError("Track activity does not contain timed points.");
  }

  if (trimStartSeconds + trimEndSeconds > timeRange.durationSeconds) {
    throw new RangeError(
      "Trim start and end seconds exceed the activity duration.",
    );
  }

  const sliceStartTime = timeRange.startTime + trimStartSeconds;
  const sliceEndTime = timeRange.endTime - trimEndSeconds;
  const slicedPoints = activity.points
    .filter((point) => {
      return isFiniteNumber(point.time) &&
        point.time >= sliceStartTime &&
        point.time <= sliceEndTime;
    })
    .map(cloneTrackPoint);

  if (slicedPoints.length === 0) {
    throw new RangeError("Trim options remove all timed points.");
  }

  const firstPointTime = slicedPoints[0].time as number;
  const absoluteStartTime = getTrimmedAbsoluteStartTime(
    activity,
    timeRange.startTime,
    firstPointTime,
  );
  slicedPoints.forEach((point) => {
    if (isFiniteNumber(point.time)) {
      point.time = point.time - firstPointTime;
    }
  });

  const normalizedPoints = normalizeActivityDistances(slicedPoints, 0);
  const metadata = cloneMetadata(activity.metadata);
  clearComputedMetadata(metadata);
  metadata.startTime = absoluteStartTime;
  metadata.endTime = absoluteStartTime + getTrimmedElapsedTime(normalizedPoints);
  metadata.totalElapsedTime = getTrimmedElapsedTime(normalizedPoints);

  const totalDistanceM = getActivityDistanceDelta(normalizedPoints);
  if (isFiniteNumber(totalDistanceM)) {
    metadata.totalDistanceM = totalDistanceM;
  } else {
    delete metadata.totalDistanceM;
  }

  const movingTime = getMovingAnalysisIntervals(normalizedPoints)
    .reduce((sum, interval) => sum + interval.seconds, 0);
  if (movingTime > 0) {
    metadata.totalTimerTime = movingTime;
  } else {
    delete metadata.totalTimerTime;
  }

  applyComputedMetadata(metadata, normalizedPoints);

  return {
    schemaVersion: activity.schemaVersion,
    metadata,
    points: normalizedPoints,
    pins: activity.pins?.map(cloneTrackActivityPin),
    warnings: activity.warnings.map((warning) => ({ ...warning })),
  };
}

export function mergeTrackActivities(
  activities: TrackActivity[],
  options: MergeTrackActivitiesOptions = {},
): TrackActivity {
  if (activities.length === 0) {
    throw new RangeError("At least one track activity is required.");
  }

  const indexedPoints: IndexedTrackPoint[] = [];
  const orderedActivities = getActivityMergeOrder(activities);
  let distanceOffsetM = 0;

  orderedActivities.forEach(({ activity, originalIndex }, orderIndex) => {
    const normalizedPoints = normalizeActivityDistances(
      activity.points,
      distanceOffsetM,
    );
    const distanceDeltaM = getActivityDistanceDelta(normalizedPoints);

    normalizedPoints.forEach((point, pointIndex) => {
      indexedPoints.push({
        activityIndex: originalIndex,
        orderIndex,
        pointIndex,
        point,
      });
    });

    if (isFiniteNumber(distanceDeltaM) && distanceDeltaM > 0) {
      distanceOffsetM += distanceDeltaM;
    }
  });

  const sortedIndexedPoints = [...indexedPoints].sort(
    compareIndexedTrackPoints,
  );
  const points = sortedIndexedPoints.map((item) => cloneTrackPoint(item.point));
  const metadata = buildMergedActivityMetadata(
    activities,
    sortedIndexedPoints,
    options,
  );
  const warnings = activities.flatMap((activity) => {
    return activity.warnings.map((warning) => ({ ...warning }));
  });
  const pins = orderedActivities.flatMap(({ activity }) => {
    return (activity.pins || []).map(cloneTrackActivityPin);
  });

  return {
    schemaVersion: 1,
    metadata,
    points,
    ...(pins.length > 0 ? { pins } : {}),
    warnings,
  };
}

type TrackActivityPointTimeRange = {
  startTime: number;
  endTime: number;
  durationSeconds: number;
};

function normalizeTrimSeconds(value: number): number {
  if (!Number.isFinite(value) || value < 0) {
    return 0;
  }
  return value;
}

function getTrackActivityPointTimeRange(
  points: TrackPoint[],
): TrackActivityPointTimeRange | undefined {
  const times = points.map((point) => point.time).filter(isFiniteNumber);
  if (times.length === 0) {
    return undefined;
  }

  const startTime = Math.min(...times);
  const endTime = Math.max(...times);
  return {
    startTime,
    endTime,
    durationSeconds: Math.max(0, endTime - startTime),
  };
}

function getTrimmedAbsoluteStartTime(
  activity: TrackActivity,
  originalFirstPointTime: number,
  firstTrimmedPointTime: number,
): number {
  const metadataStartTime = activity.metadata.startTime;
  if (
    isFiniteNumber(metadataStartTime) &&
    isRelativePointTime(originalFirstPointTime, metadataStartTime)
  ) {
    return metadataStartTime + firstTrimmedPointTime - originalFirstPointTime;
  }

  return firstTrimmedPointTime;
}

function isRelativePointTime(pointTime: number, metadataStartTime: number): boolean {
  return metadataStartTime >= 100000000 && pointTime < 100000000;
}

function getTrimmedElapsedTime(points: TrackPoint[]): number {
  const range = getTrackActivityPointTimeRange(points);
  return range ? range.durationSeconds : 0;
}

function clearComputedMetadata(metadata: TrackActivityMetadata) {
  delete metadata.analysis;
  delete metadata.statistics;
  delete metadata.training;
  delete metadata.bestEfforts;
  delete metadata.histograms;
  delete metadata.pedaling;
}

type IndexedTrackPoint = {
  activityIndex: number;
  orderIndex: number;
  pointIndex: number;
  point: TrackPoint;
};

type OrderedActivity = {
  activity: TrackActivity;
  originalIndex: number;
  sortTime: number | undefined;
};

function getActivityMergeOrder(activities: TrackActivity[]): OrderedActivity[] {
  return activities
    .map((activity, originalIndex) => ({
      activity,
      originalIndex,
      sortTime: getActivitySortTime(activity),
    }))
    .sort((a, b) => {
      if (isFiniteNumber(a.sortTime) && isFiniteNumber(b.sortTime)) {
        return a.sortTime - b.sortTime || a.originalIndex - b.originalIndex;
      }
      if (isFiniteNumber(a.sortTime)) {
        return -1;
      }
      if (isFiniteNumber(b.sortTime)) {
        return 1;
      }
      return a.originalIndex - b.originalIndex;
    });
}

function getActivitySortTime(activity: TrackActivity): number | undefined {
  const pointTimes = activity.points
    .map((point) => point.time)
    .filter(isFiniteNumber);

  if (pointTimes.length > 0) {
    return Math.min(...pointTimes);
  }

  return activity.metadata.startTime;
}

function normalizeActivityDistances(
  points: TrackPoint[],
  distanceOffsetM: number,
): TrackPoint[] {
  const cloned = points.map(cloneTrackPoint);
  const finiteDistances = cloned
    .map((point) => point.distanceM)
    .filter(isFiniteNumber);

  if (finiteDistances.length > 0) {
    const firstDistance = finiteDistances[0];
    cloned.forEach((point) => {
      if (isFiniteNumber(point.distanceM)) {
        point.distanceM =
          Math.max(0, point.distanceM - firstDistance) + distanceOffsetM;
      }
    });
    return cloned;
  }

  let cumulativeDistanceM = distanceOffsetM;
  let previousPosition: (TrackPoint & { lat: number; lon: number }) | undefined;
  cloned.forEach((point) => {
    if (hasPosition(point)) {
      if (previousPosition) {
        cumulativeDistanceM += calculateDistanceM(previousPosition, point);
      }
      point.distanceM = cumulativeDistanceM;
      previousPosition = point;
    }
  });

  return cloned;
}

function getActivityDistanceDelta(points: TrackPoint[]): number | undefined {
  const distances = points
    .map((point) => point.distanceM)
    .filter(isFiniteNumber);

  if (distances.length >= 2) {
    return Math.max(0, distances[distances.length - 1] - distances[0]);
  }

  return undefined;
}

function compareIndexedTrackPoints(
  a: IndexedTrackPoint,
  b: IndexedTrackPoint,
): number {
  if (isFiniteNumber(a.point.time) && isFiniteNumber(b.point.time)) {
    return (
      a.point.time - b.point.time ||
      a.orderIndex - b.orderIndex ||
      a.pointIndex - b.pointIndex
    );
  }

  if (isFiniteNumber(a.point.time)) {
    return -1;
  }

  if (isFiniteNumber(b.point.time)) {
    return 1;
  }

  return a.orderIndex - b.orderIndex || a.pointIndex - b.pointIndex;
}

function buildMergedActivityMetadata(
  activities: TrackActivity[],
  indexedPoints: IndexedTrackPoint[],
  options: MergeTrackActivitiesOptions,
): TrackActivityMetadata {
  const base = cloneMetadata(activities[0].metadata);
  const points = indexedPoints.map((item) => item.point);
  const metadata: TrackActivityMetadata = {
    ...base,
    source: {
      type: "merged",
    },
  };

  if (options.name) {
    metadata.name = options.name;
  }
  if (options.description) {
    metadata.description = options.description;
  }

  assignMergedCreatedAt(metadata, activities);
  assignMergedLocalTimeOffset(metadata, activities);

  const timeRange = getMergedTimeRange(activities, points);
  if (timeRange) {
    metadata.startTime = timeRange.startTime;
    metadata.endTime = timeRange.endTime;
    metadata.totalElapsedTime = Math.max(
      0,
      timeRange.endTime - timeRange.startTime,
    );
  } else {
    delete metadata.startTime;
    delete metadata.endTime;
    delete metadata.totalElapsedTime;
  }

  const movingTime = calculateMergedMovingTime(
    indexedPoints,
    options.movingSpeedThresholdMps ?? 0.5,
  );
  if (movingTime > 0) {
    metadata.totalTimerTime = movingTime;
  } else {
    const summedTimerTime = sumMetadataNumber(activities, "totalTimerTime");
    if (isFiniteNumber(summedTimerTime)) {
      metadata.totalTimerTime = summedTimerTime;
    }
  }

  const totalDistanceM = getMergedTotalDistance(points);
  if (isFiniteNumber(totalDistanceM)) {
    metadata.totalDistanceM = totalDistanceM;
  }

  applyComputedMetadata(metadata, points);

  return metadata;
}

function assignMergedCreatedAt(
  metadata: TrackActivityMetadata,
  activities: TrackActivity[],
) {
  const createdAtValues = activities
    .map((activity) => activity.metadata.createdAt)
    .filter(isFiniteNumber);

  if (createdAtValues.length > 0) {
    metadata.createdAt = Math.min(...createdAtValues);
  } else {
    delete metadata.createdAt;
  }
}

function assignMergedLocalTimeOffset(
  metadata: TrackActivityMetadata,
  activities: TrackActivity[],
) {
  const offsets = activities
    .map((activity) => activity.metadata.localTimeOffsetSeconds)
    .filter(isFiniteNumber);
  const firstOffset = offsets[0];

  if (
    offsets.length === activities.length &&
    isFiniteNumber(firstOffset) &&
    offsets.every((offset) => offset === firstOffset)
  ) {
    metadata.localTimeOffsetSeconds = firstOffset;
  } else {
    delete metadata.localTimeOffsetSeconds;
  }
}

type TrackActivityTimeRange = {
  startTime: number;
  endTime: number;
};

function getMergedTimeRange(
  activities: TrackActivity[],
  points: TrackPoint[],
): TrackActivityTimeRange | undefined {
  const pointTimes = points.map((point) => point.time).filter(isFiniteNumber);
  if (pointTimes.length > 0) {
    return {
      startTime: Math.min(...pointTimes),
      endTime: Math.max(...pointTimes),
    };
  }

  const startTimes = activities
    .map((activity) => activity.metadata.startTime)
    .filter(isFiniteNumber);
  const endTimes = activities.map(getActivityEndTime).filter(isFiniteNumber);

  if (startTimes.length === 0 || endTimes.length === 0) {
    return undefined;
  }

  return {
    startTime: Math.min(...startTimes),
    endTime: Math.max(...endTimes),
  };
}

function getActivityEndTime(activity: TrackActivity): number | undefined {
  if (isFiniteNumber(activity.metadata.endTime)) {
    return activity.metadata.endTime;
  }

  if (
    isFiniteNumber(activity.metadata.startTime) &&
    isFiniteNumber(activity.metadata.totalElapsedTime)
  ) {
    return activity.metadata.startTime + activity.metadata.totalElapsedTime;
  }

  return undefined;
}

export function applyComputedMetadata(
  metadata: TrackActivityMetadata,
  points: TrackPoint[],
) {
  metadata.analysis = buildActivityAnalysisMetadata();

  const statistics = buildActivityStatistics(points);
  if (statistics) {
    metadata.statistics = statistics;
  } else {
    delete metadata.statistics;
  }

  const training = mergeTrainingMetadata(
    metadata.training,
    buildMergedTraining(points),
  );
  if (training) {
    metadata.training = training;
  } else {
    delete metadata.training;
  }

  const bestEfforts = buildActivityBestEfforts(points);
  if (bestEfforts) {
    metadata.bestEfforts = bestEfforts;
  } else {
    delete metadata.bestEfforts;
  }

  const histograms = buildActivityHistograms(points);
  if (histograms) {
    metadata.histograms = histograms;
  } else {
    delete metadata.histograms;
  }

  const pedaling = buildActivityPedaling(points);
  if (pedaling) {
    metadata.pedaling = pedaling;
  } else if (metadata.pedaling && metadata.pedaling.totalSeconds > 0) {
    metadata.pedaling = { ...metadata.pedaling };
  } else {
    delete metadata.pedaling;
  }
}

function mergeTrainingMetadata(
  existing: TrackActivityTraining | undefined,
  computed: TrackActivityTraining | undefined,
): TrackActivityTraining | undefined {
  if (!existing) {
    return computed;
  }
  if (!computed) {
    return hasTrainingValues(existing) ? { ...existing } : undefined;
  }

  const training: TrackActivityTraining = {
    ...existing,
    ...computed,
  };
  const source = {
    ...(existing.source || {}),
    ...(computed.source || {}),
  };

  if (Object.keys(source).length > 0) {
    training.source = source;
  } else {
    delete training.source;
  }

  return hasTrainingValues(training) ? training : undefined;
}

function buildMergedTraining(
  points: TrackPoint[],
): TrackActivityTraining | undefined {
  const training: TrackActivityTraining = {};
  const source: TrackActivityTrainingSource = {};

  const normalizedPowerW = computeNormalizedPowerW(points);
  if (isFiniteNumber(normalizedPowerW)) {
    training.normalizedPowerW = normalizedPowerW;
    source.normalizedPower = "computed";
  }

  const totalWorkJ = computeTotalWorkJ(points);
  if (isFiniteNumber(totalWorkJ)) {
    training.totalWorkJ = totalWorkJ;
    source.totalWork = "computed";
  }

  if (Object.keys(source).length > 0) {
    training.source = source;
  }

  return hasTrainingValues(training) ? training : undefined;
}

function calculateMergedMovingTime(
  indexedPoints: IndexedTrackPoint[],
  movingSpeedThresholdMps: number,
): number {
  const groups = new Map<number, IndexedTrackPoint[]>();
  indexedPoints.forEach((item) => {
    const group = groups.get(item.activityIndex) || [];
    group.push(item);
    groups.set(item.activityIndex, group);
  });

  let totalSeconds = 0;
  groups.forEach((group) => {
    const hasSpeed = group.some((item) => isFiniteNumber(item.point.speedMps));
    const sorted = [...group].sort(compareIndexedTrackPoints);
    for (let index = 1; index < sorted.length; index += 1) {
      const previous = sorted[index - 1].point;
      const current = sorted[index].point;
      if (!isFiniteNumber(previous.time) || !isFiniteNumber(current.time)) {
        continue;
      }

      const deltaSeconds = current.time - previous.time;
      if (deltaSeconds <= 0) {
        continue;
      }

      if (
        isMovingInterval(previous, current, movingSpeedThresholdMps, hasSpeed)
      ) {
        totalSeconds += deltaSeconds;
      }
    }
  });

  return totalSeconds;
}

function isMovingInterval(
  previous: TrackPoint,
  current: TrackPoint,
  movingSpeedThresholdMps: number,
  hasSpeed: boolean,
): boolean {
  if (hasSpeed) {
    const previousSpeed = previous.speedMps;
    const currentSpeed = current.speedMps;
    return (
      isFiniteNumber(previousSpeed) &&
      previousSpeed >= movingSpeedThresholdMps &&
      isFiniteNumber(currentSpeed) &&
      currentSpeed >= movingSpeedThresholdMps
    );
  }

  if (isFiniteNumber(previous.distanceM) && isFiniteNumber(current.distanceM)) {
    return current.distanceM > previous.distanceM;
  }

  if (hasPosition(previous) && hasPosition(current)) {
    return previous.lat !== current.lat || previous.lon !== current.lon;
  }

  return false;
}

function getMergedTotalDistance(points: TrackPoint[]): number | undefined {
  const distances = points
    .map((point) => point.distanceM)
    .filter(isFiniteNumber);

  if (distances.length >= 2) {
    return Math.max(0, Math.max(...distances) - Math.min(...distances));
  }

  return undefined;
}

function calculateDistanceM(
  a: TrackPoint & { lat: number; lon: number },
  b: TrackPoint & { lat: number; lon: number },
): number {
  const earthRadiusM = 6371008.8;
  const lat1 = degreesToRadians(a.lat);
  const lat2 = degreesToRadians(b.lat);
  const deltaLat = degreesToRadians(b.lat - a.lat);
  const deltaLon = degreesToRadians(b.lon - a.lon);
  const sinHalfLat = Math.sin(deltaLat / 2);
  const sinHalfLon = Math.sin(deltaLon / 2);
  const h =
    sinHalfLat * sinHalfLat +
    Math.cos(lat1) * Math.cos(lat2) * sinHalfLon * sinHalfLon;
  return 2 * earthRadiusM * Math.asin(Math.min(1, Math.sqrt(h)));
}

function degreesToRadians(value: number): number {
  return (value * Math.PI) / 180;
}

function sumMetadataNumber(
  activities: TrackActivity[],
  key: keyof TrackActivityMetadata,
): number | undefined {
  let total = 0;
  let hasValue = false;

  activities.forEach((activity) => {
    const value = activity.metadata[key];
    if (isFiniteNumber(value)) {
      total += value;
      hasValue = true;
    }
  });

  return hasValue ? total : undefined;
}

export function buildActivityAnalysisMetadata(): TrackActivityAnalysisMetadata {
  return {
    movingSpeedThresholdKph: DEFAULT_MOVING_SPEED_THRESHOLD_KPH,
  };
}

export function buildActivityStatistics(
  points: TrackPoint[],
): TrackActivityStatistics | undefined {
  const timed = hasTimedAnalysisPointPairs(points);
  const intervals = getMovingAnalysisIntervals(points);
  if (intervals.length > 0) {
    return buildTimedMovingActivityStatistics(intervals);
  }

  if (timed) {
    return undefined;
  }

  return buildSampleMovingActivityStatistics(getMovingAnalysisPoints(points));
}

function buildTimedMovingActivityStatistics(
  intervals: TrackMovingAnalysisInterval[],
): TrackActivityStatistics | undefined {
  const statistics: TrackActivityStatistics = {};

  const speedStats = buildTimedMovingSpeedStats(intervals);
  if (speedStats) {
    statistics.speedKph = speedStats;
  }
  assignWeightedActivityStats(
    statistics,
    "cadenceRpm",
    intervals.map((interval) => ({
      value: interval.point.cadenceRpm,
      seconds: interval.seconds,
    })),
  );
  assignWeightedActivityStats(
    statistics,
    "heartRateBpm",
    intervals.map((interval) => ({
      value: interval.point.heartRateBpm,
      seconds: interval.seconds,
    })),
  );
  assignWeightedActivityStats(
    statistics,
    "powerW",
    intervals.map((interval) => ({
      value: interval.point.powerW,
      seconds: interval.seconds,
    })),
  );
  assignWeightedActivityStats(
    statistics,
    "temperatureC",
    intervals.map((interval) => ({
      value: interval.point.temperatureC,
      seconds: interval.seconds,
    })),
  );

  return Object.keys(statistics).length > 0 ? statistics : undefined;
}

function buildTimedMovingSpeedStats(
  intervals: TrackMovingAnalysisInterval[],
): TrackNumericStats | undefined {
  const weightedSpeeds = intervals.map((interval) => ({
    value: interval.speedKph,
    seconds: interval.seconds,
  }));
  const stats = buildWeightedNumericStats(weightedSpeeds);
  if (!stats) {
    return undefined;
  }

  const distanceM = intervals.reduce((sum, interval) => {
    return isFiniteNumber(interval.distanceM) ? sum + interval.distanceM : sum;
  }, 0);
  const seconds = intervals.reduce((sum, interval) => {
    return isFiniteNumber(interval.distanceM) ? sum + interval.seconds : sum;
  }, 0);
  if (distanceM > 0 && seconds > 0) {
    stats.mean = (distanceM / seconds) * 3.6;
  }

  return stats;
}

function buildSampleMovingActivityStatistics(
  points: TrackPoint[],
): TrackActivityStatistics | undefined {
  const statistics: TrackActivityStatistics = {};

  assignActivityStats(
    statistics,
    "speedKph",
    points.map((point) => {
      return isFiniteNumber(point.speedMps) ? point.speedMps * 3.6 : undefined;
    }),
  );
  assignActivityStats(
    statistics,
    "cadenceRpm",
    points.map((point) => point.cadenceRpm),
  );
  assignActivityStats(
    statistics,
    "heartRateBpm",
    points.map((point) => point.heartRateBpm),
  );
  assignActivityStats(
    statistics,
    "powerW",
    points.map((point) => point.powerW),
  );
  assignActivityStats(
    statistics,
    "temperatureC",
    points.map((point) => point.temperatureC),
  );

  return Object.keys(statistics).length > 0 ? statistics : undefined;
}

function assignWeightedActivityStats(
  statistics: TrackActivityStatistics,
  key: keyof TrackActivityStatistics,
  values: WeightedNumericValue[],
) {
  const stats = buildWeightedNumericStats(values);
  if (stats) {
    statistics[key] = stats;
  }
}

function assignActivityStats(
  statistics: TrackActivityStatistics,
  key: keyof TrackActivityStatistics,
  values: Array<number | undefined>,
) {
  const stats = buildNumericStats(values);
  if (stats) {
    statistics[key] = stats;
  }
}

type WeightedNumericValue = {
  value: number | undefined;
  seconds: number;
};

function buildWeightedNumericStats(
  values: WeightedNumericValue[],
): TrackNumericStats | undefined {
  const numericValues = values.filter((item): item is { value: number; seconds: number } => {
    return isFiniteNumber(item.value) && item.seconds > 0;
  });
  if (numericValues.length === 0) {
    return undefined;
  }

  const totalSeconds = numericValues.reduce((sum, item) => sum + item.seconds, 0);
  if (totalSeconds <= 0) {
    return undefined;
  }

  const sorted = [...numericValues].sort((a, b) => a.value - b.value);
  const halfSeconds = totalSeconds / 2;
  let cumulativeSeconds = 0;
  let median = sorted[sorted.length - 1].value;
  for (const item of sorted) {
    cumulativeSeconds += item.seconds;
    if (cumulativeSeconds >= halfSeconds) {
      median = item.value;
      break;
    }
  }

  return {
    mean:
      numericValues.reduce((sum, item) => sum + item.value * item.seconds, 0) /
      totalSeconds,
    median,
    max: sorted[sorted.length - 1].value,
  };
}

function buildNumericStats(
  values: Array<number | undefined>,
): TrackNumericStats | undefined {
  const numericValues = values.filter(isFiniteNumber);
  if (numericValues.length === 0) {
    return undefined;
  }

  const sorted = [...numericValues].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  const median =
    sorted.length % 2 === 0
      ? (sorted[middle - 1] + sorted[middle]) / 2
      : sorted[middle];

  return {
    mean:
      numericValues.reduce((sum, value) => sum + value, 0) /
      numericValues.length,
    median,
    max: sorted[sorted.length - 1],
  };
}

export function buildActivityHistograms(
  points: TrackPoint[],
): TrackActivityHistograms | undefined {
  const speedKph = buildSpeedBracketHistogram(points);
  const cadenceRpm = buildCadenceBracketHistogram(points);
  const powerW = buildPowerBracketHistogram(points);
  const heartRateBpm = buildHeartRateBracketHistogram(points);
  if (!speedKph && !cadenceRpm && !powerW && !heartRateBpm) {
    return undefined;
  }

  return { speedKph, cadenceRpm, powerW, heartRateBpm };
}

export function buildActivityPedaling(
  points: TrackPoint[],
): TrackActivityPedaling | undefined {
  const accumulator = createPedalingAccumulator();

  assignTimedPedalingDurations(points, accumulator);
  if (accumulator.totalSeconds === 0) {
    assignSamplePedalingDurations(points, accumulator);
  }

  if (accumulator.totalSeconds === 0) {
    return undefined;
  }

  const pedaling: TrackActivityPedaling = {
    totalSeconds: accumulator.totalSeconds,
    averageSpeedKph: accumulator.speedKphSeconds / accumulator.totalSeconds,
    averageCadenceRpm: accumulator.cadenceRpmSeconds / accumulator.totalSeconds,
    averagePowerW: accumulator.powerWSeconds / accumulator.totalSeconds,
  };

  if (accumulator.heartRateSeconds > 0) {
    pedaling.averageHeartRateBpm =
      accumulator.heartRateBpmSeconds / accumulator.heartRateSeconds;
  }

  const normalizedPowerW = computeNormalizedPowerFromSamples(
    accumulator.powerSamples,
  );
  if (isFiniteNumber(normalizedPowerW)) {
    pedaling.normalizedPowerW = normalizedPowerW;
  }

  return pedaling;
}

type PedalingAccumulator = {
  totalSeconds: number;
  speedKphSeconds: number;
  cadenceRpmSeconds: number;
  heartRateBpmSeconds: number;
  heartRateSeconds: number;
  powerWSeconds: number;
  powerSamples: number[];
};

function createPedalingAccumulator(): PedalingAccumulator {
  return {
    totalSeconds: 0,
    speedKphSeconds: 0,
    cadenceRpmSeconds: 0,
    heartRateBpmSeconds: 0,
    heartRateSeconds: 0,
    powerWSeconds: 0,
    powerSamples: [],
  };
}

function assignTimedPedalingDurations(
  points: TrackPoint[],
  accumulator: PedalingAccumulator,
) {
  const timed = points
    .filter((point): point is TrackPoint & { time: number } => {
      return isFiniteNumber(point.time);
    })
    .sort((a, b) => a.time - b.time);

  for (let index = 1; index + 1 < timed.length; index += 1) {
    const previous = timed[index - 1];
    const current = timed[index];
    const next = timed[index + 1];
    const deltaSeconds = next.time - current.time;
    if (deltaSeconds <= 0 || !isPedalingWindow(previous, current, next)) {
      continue;
    }

    addPedalingSample(current, deltaSeconds, accumulator);
  }
}

function assignSamplePedalingDurations(
  points: TrackPoint[],
  accumulator: PedalingAccumulator,
) {
  for (let index = 1; index + 1 < points.length; index += 1) {
    const previous = points[index - 1];
    const current = points[index];
    const next = points[index + 1];
    if (isPedalingWindow(previous, current, next)) {
      addPedalingSample(current, 1, accumulator);
    }
  }
}

function addPedalingSample(
  point: TrackPoint,
  seconds: number,
  accumulator: PedalingAccumulator,
) {
  if (!isPedalingPoint(point)) {
    return;
  }

  const speedKph = point.speedMps * 3.6;
  accumulator.totalSeconds += seconds;
  accumulator.speedKphSeconds += speedKph * seconds;
  accumulator.cadenceRpmSeconds += point.cadenceRpm * seconds;
  accumulator.powerWSeconds += point.powerW * seconds;
  appendPowerSamplesForDuration(
    accumulator.powerSamples,
    point.powerW,
    seconds,
  );

  if (isFiniteNumber(point.heartRateBpm)) {
    accumulator.heartRateBpmSeconds += point.heartRateBpm * seconds;
    accumulator.heartRateSeconds += seconds;
  }
}

function isPedalingWindow(
  previous: TrackPoint,
  current: TrackPoint,
  next: TrackPoint,
): current is TrackPoint & {
  speedMps: number;
  cadenceRpm: number;
  powerW: number;
} {
  return (
    isPedalingPoint(previous) &&
    isPedalingPoint(current) &&
    isPedalingPoint(next)
  );
}

function isPedalingPoint(point: TrackPoint): point is TrackPoint & {
  speedMps: number;
  cadenceRpm: number;
  powerW: number;
} {
  return (
    isFiniteNumber(point.speedMps) &&
    point.speedMps * 3.6 >= PEDALING_MIN_SPEED_KPH &&
    isFiniteNumber(point.cadenceRpm) &&
    point.cadenceRpm >= PEDALING_MIN_CADENCE_RPM &&
    isFiniteNumber(point.powerW) &&
    point.powerW >= PEDALING_MIN_POWER_W
  );
}

function appendPowerSamplesForDuration(
  samples: number[],
  powerW: number,
  seconds: number,
) {
  const count = Math.max(1, Math.round(seconds));
  for (let index = 0; index < count; index += 1) {
    samples.push(powerW);
  }
}

export function buildActivityBestEfforts(
  points: TrackPoint[],
): TrackActivityBestEfforts | undefined {
  const powerW = computeBestPowerCurveW(points);
  if (!powerW) {
    return undefined;
  }

  return { powerW };
}

function computeBestPowerCurveW(
  points: TrackPoint[],
): TrackDurationBestEfforts | undefined {
  const samples = buildPowerSamples(points);
  const efforts: TrackDurationBestEfforts = {};

  STRAVA_POWER_CURVE_DURATIONS_SECONDS.forEach((duration) => {
    const best = computeBestAverageValue(samples, duration);
    if (isFiniteNumber(best)) {
      efforts[String(duration)] = best;
    }
  });

  return Object.keys(efforts).length > 0 ? efforts : undefined;
}

function computeBestAverageValue(
  samples: number[],
  durationSeconds: number,
): number | undefined {
  if (durationSeconds <= 0 || samples.length < durationSeconds) {
    return undefined;
  }

  let rollingSum = 0;
  let best: number | undefined;

  samples.forEach((value, index) => {
    rollingSum += value;
    if (index >= durationSeconds) {
      rollingSum -= samples[index - durationSeconds];
    }

    if (index >= durationSeconds - 1) {
      const average = rollingSum / durationSeconds;
      if (!isFiniteNumber(best) || average > best) {
        best = average;
      }
    }
  });

  return best;
}

export function hasTrainingValues(training: TrackActivityTraining): boolean {
  return (
    isFiniteNumber(training.normalizedPowerW) ||
    isFiniteNumber(training.totalWorkJ) ||
    isFiniteNumber(training.totalCaloriesCal)
  );
}

function computeZoneSummary<TZone extends string>(
  points: TrackPoint[],
  getValue: (point: TrackPoint) => number | undefined,
  getZone: (value: number) => TZone | undefined,
  zoneKeys: readonly TZone[],
): TrackZoneSummary<TZone> {
  const durations = createZoneRecord(zoneKeys);
  const percentages = createZoneRecord(zoneKeys);
  let totalSeconds = assignTimedZoneDurations(
    points,
    getValue,
    getZone,
    durations,
  );

  if (totalSeconds === 0 && !hasTimedAnalysisPointPairs(points)) {
    totalSeconds = assignSampleZoneDurations(
      getMovingAnalysisPoints(points),
      getValue,
      getZone,
      durations,
    );
  }

  zoneKeys.forEach((zone) => {
    percentages[zone] =
      totalSeconds > 0 ? (durations[zone] / totalSeconds) * 100 : 0;
  });

  return {
    totalSeconds,
    durations,
    percentages,
  };
}

function assignTimedZoneDurations<TZone extends string>(
  points: TrackPoint[],
  getValue: (point: TrackPoint) => number | undefined,
  getZone: (value: number) => TZone | undefined,
  durations: Record<TZone, number>,
): number {
  let totalSeconds = 0;

  getMovingAnalysisIntervals(points).forEach((interval) => {
    const value = getValue(interval.point);
    if (!isFiniteNumber(value)) {
      return;
    }

    const zone = getZone(value);
    if (zone) {
      durations[zone] += interval.seconds;
      totalSeconds += interval.seconds;
    }
  });

  return totalSeconds;
}

function assignSampleZoneDurations<TZone extends string>(
  points: TrackPoint[],
  getValue: (point: TrackPoint) => number | undefined,
  getZone: (value: number) => TZone | undefined,
  durations: Record<TZone, number>,
): number {
  let totalSeconds = 0;

  points.forEach((point) => {
    const value = getValue(point);
    if (!isFiniteNumber(value)) {
      return;
    }

    const zone = getZone(value);
    if (zone) {
      durations[zone] += 1;
      totalSeconds += 1;
    }
  });

  return totalSeconds;
}

function createZoneRecord<TZone extends string>(
  zoneKeys: readonly TZone[],
): Record<TZone, number> {
  return zoneKeys.reduce(
    (record, zone) => {
      record[zone] = 0;
      return record;
    },
    {} as Record<TZone, number>,
  );
}

function assertPositiveFiniteNumber(value: number, name: string) {
  if (!isFiniteNumber(value) || value <= 0) {
    throw new RangeError(`${name} must be a positive finite number.`);
  }
}

export function computeNormalizedPowerW(
  points: TrackPoint[],
): number | undefined {
  return computeNormalizedPowerFromSamples(buildPowerSamples(points));
}

function computeNormalizedPowerFromSamples(
  samples: number[],
): number | undefined {
  if (samples.length < 30) {
    return undefined;
  }

  let rollingSum = 0;
  let fourthPowerSum = 0;
  let count = 0;

  samples.forEach((power, index) => {
    rollingSum += power;
    if (index >= 30) {
      rollingSum -= samples[index - 30];
    }

    if (index >= 29) {
      const average = rollingSum / 30;
      fourthPowerSum += average ** 4;
      count += 1;
    }
  });

  return count > 0 ? (fourthPowerSum / count) ** 0.25 : undefined;
}

function buildPowerSamples(points: TrackPoint[]): number[] {
  const intervals = getMovingAnalysisIntervals(points);
  if (intervals.length > 0) {
    const samples: number[] = [];
    intervals.forEach((interval) => {
      if (isFiniteNumber(interval.point.powerW)) {
        appendPowerSamplesForDuration(
          samples,
          interval.point.powerW,
          interval.seconds,
        );
      }
    });
    return samples;
  }

  if (hasTimedAnalysisPointPairs(points)) {
    return [];
  }

  return getMovingAnalysisPoints(points)
    .map((point) => point.powerW)
    .filter(isFiniteNumber);
}

export function computeTotalWorkJ(points: TrackPoint[]): number | undefined {
  let totalWorkJ = 0;
  let hasSegment = false;

  getMovingAnalysisIntervals(points).forEach((interval) => {
    const currentPowerW = interval.point.powerW;
    const nextPowerW = interval.nextPoint.powerW;
    if (!isFiniteNumber(currentPowerW) || !isFiniteNumber(nextPowerW)) {
      return;
    }
    totalWorkJ += ((currentPowerW + nextPowerW) / 2) * interval.seconds;
    hasSegment = true;
  });

  return hasSegment ? totalWorkJ : undefined;
}

function normalizeMaxPoints(value: number): number {
  if (!Number.isFinite(value) || value < 2) {
    throw new RangeError(
      "maxPoints must be a finite number greater than or equal to 2.",
    );
  }

  return Math.floor(value);
}

function downsampleTrackActivityUniform(
  activity: TrackActivity,
  maxPoints: number,
  preserveEndpoints: boolean,
): TrackActivity {
  const indices = preserveEndpoints
    ? selectUniformIndicesWithEndpoints(activity.points.length, maxPoints)
    : selectUniformIndices(activity.points.length, maxPoints);

  return {
    ...cloneTrackActivity(activity),
    points: indices.map((index) => cloneTrackPoint(activity.points[index])),
  };
}

function downsampleTrackActivityAggregate(
  activity: TrackActivity,
  maxPoints: number,
  preserveEndpoints: boolean,
): TrackActivity {
  const points = preserveEndpoints
    ? aggregatePointsWithEndpoints(activity.points, maxPoints)
    : aggregatePoints(activity.points, maxPoints);

  return {
    ...cloneTrackActivity(activity),
    points,
  };
}

function aggregatePointsWithEndpoints(
  points: TrackPoint[],
  maxPoints: number,
): TrackPoint[] {
  if (maxPoints <= 2) {
    return [
      cloneTrackPoint(points[0]),
      cloneTrackPoint(points[points.length - 1]),
    ];
  }

  const middlePoints = points.slice(1, -1);
  const middleCount = maxPoints - 2;
  const aggregated = aggregatePoints(middlePoints, middleCount);

  return [
    cloneTrackPoint(points[0]),
    ...aggregated,
    cloneTrackPoint(points[points.length - 1]),
  ];
}

function aggregatePoints(
  points: TrackPoint[],
  maxPoints: number,
): TrackPoint[] {
  if (points.length <= maxPoints) {
    return points.map(cloneTrackPoint);
  }

  return createBucketRanges(points.length, maxPoints).map(([start, end]) => {
    return aggregateTrackPointBucket(points, start, end);
  });
}

function createBucketRanges(
  length: number,
  count: number,
): Array<[number, number]> {
  const ranges: Array<[number, number]> = [];

  for (let i = 0; i < count; i += 1) {
    const start = Math.floor((i * length) / count);
    const end = Math.floor(((i + 1) * length) / count);
    ranges.push([start, Math.max(start + 1, end)]);
  }

  return ranges;
}

function aggregateTrackPointBucket(
  points: TrackPoint[],
  start: number,
  end: number,
): TrackPoint {
  const bucket = points.slice(start, end);
  const representative = points[Math.floor((start + end - 1) / 2)];
  const point: TrackPoint = {};

  assignNumber(point, "time", representative.time);
  assignNumber(point, "lat", representative.lat);
  assignNumber(point, "lon", representative.lon);
  assignNumber(point, "distanceM", representative.distanceM);
  assignNumber(
    point,
    "elevationM",
    averagePointValue(bucket, (item) => item.elevationM),
  );
  assignNumber(
    point,
    "heartRateBpm",
    averagePointValue(bucket, (item) => item.heartRateBpm),
  );
  assignNumber(
    point,
    "cadenceRpm",
    averagePointValue(bucket, (item) => item.cadenceRpm),
  );
  assignNumber(
    point,
    "powerW",
    averagePointValue(bucket, (item) => item.powerW),
  );
  assignNumber(
    point,
    "speedMps",
    averagePointValue(bucket, (item) => item.speedMps),
  );
  assignNumber(
    point,
    "temperatureC",
    averagePointValue(bucket, (item) => item.temperatureC),
  );

  const metrics = aggregateMetricValues(bucket);
  if (metrics) {
    point.metrics = metrics;
  }

  return point;
}

function averagePointValue(
  points: TrackPoint[],
  getValue: (point: TrackPoint) => number | undefined,
): number | undefined {
  let sum = 0;
  let count = 0;

  points.forEach((point) => {
    const value = getValue(point);
    if (isFiniteNumber(value)) {
      sum += value;
      count += 1;
    }
  });

  return count > 0 ? sum / count : undefined;
}

function aggregateMetricValues(
  points: TrackPoint[],
): Record<string, number> | undefined {
  const metricNames = new Set<string>();

  points.forEach((point) => {
    Object.keys(point.metrics || {}).forEach((name) => {
      if (isSafeMetricName(name)) {
        metricNames.add(name);
      }
    });
  });

  const metrics: Record<string, number> = {};

  metricNames.forEach((name) => {
    const value = averagePointValue(points, (point) => point.metrics?.[name]);
    if (isFiniteNumber(value)) {
      metrics[name] = value;
    }
  });

  return Object.keys(metrics).length > 0 ? metrics : undefined;
}

function selectUniformIndicesWithEndpoints(
  length: number,
  count: number,
): number[] {
  const last = length - 1;
  const selected = new Set<number>();

  for (let i = 0; i < count; i += 1) {
    selected.add(Math.round((i * last) / (count - 1)));
  }

  for (let index = 0; selected.size < count && index < length; index += 1) {
    selected.add(index);
  }

  return Array.from(selected).sort((a, b) => a - b);
}

function selectUniformIndices(length: number, count: number): number[] {
  const selected = new Set<number>();

  for (let i = 0; i < count; i += 1) {
    selected.add(Math.min(length - 1, Math.floor((i * length) / count)));
  }

  for (let index = 0; selected.size < count && index < length; index += 1) {
    selected.add(index);
  }

  return Array.from(selected).sort((a, b) => a - b);
}

function cloneTrackActivity(activity: TrackActivity): TrackActivity {
  return {
    schemaVersion: activity.schemaVersion,
    metadata: cloneMetadata(activity.metadata),
    points: activity.points.map(cloneTrackPoint),
    pins: activity.pins?.map(cloneTrackActivityPin),
    warnings: activity.warnings.map((warning) => ({ ...warning })),
  };
}

function cloneTrackActivityPin(pin: TrackActivityPin): TrackActivityPin {
  return {
    ...pin,
    properties: pin.properties ? cloneJsonRecord(pin.properties) : undefined,
  };
}

function cloneJsonRecord(
  record: Record<string, unknown>,
): Record<string, unknown> {
  return JSON.parse(JSON.stringify(record)) as Record<string, unknown>;
}

function cloneMetadata(metadata: TrackActivityMetadata): TrackActivityMetadata {
  return {
    ...metadata,
    source: metadata.source ? { ...metadata.source } : undefined,
    recordingDevice: metadata.recordingDevice
      ? { ...metadata.recordingDevice }
      : undefined,
    devices: metadata.devices?.map((device) => ({ ...device })),
    analysis: metadata.analysis ? { ...metadata.analysis } : undefined,
    statistics: cloneStatistics(metadata.statistics),
    training: cloneTraining(metadata.training),
    bestEfforts: cloneBestEfforts(metadata.bestEfforts),
    histograms: cloneHistograms(metadata.histograms),
    pedaling: metadata.pedaling ? { ...metadata.pedaling } : undefined,
  };
}

function cloneStatistics(
  statistics: TrackActivityStatistics | undefined,
): TrackActivityStatistics | undefined {
  if (!statistics) {
    return undefined;
  }

  return {
    speedKph: cloneNumericStats(statistics.speedKph),
    cadenceRpm: cloneNumericStats(statistics.cadenceRpm),
    heartRateBpm: cloneNumericStats(statistics.heartRateBpm),
    powerW: cloneNumericStats(statistics.powerW),
    temperatureC: cloneNumericStats(statistics.temperatureC),
  };
}

function cloneNumericStats(
  stats: TrackNumericStats | undefined,
): TrackNumericStats | undefined {
  return stats ? { ...stats } : undefined;
}

function cloneBestEfforts(
  bestEfforts: TrackActivityBestEfforts | undefined,
): TrackActivityBestEfforts | undefined {
  if (!bestEfforts) {
    return undefined;
  }

  return {
    powerW: bestEfforts.powerW ? { ...bestEfforts.powerW } : undefined,
  };
}

function cloneHistograms(
  histograms: TrackActivityHistograms | undefined,
): TrackActivityHistograms | undefined {
  if (!histograms) {
    return undefined;
  }

  return {
    speedKph: histograms.speedKph
      ? {
          ...histograms.speedKph,
          buckets: histograms.speedKph.buckets.map((bucket) => ({ ...bucket })),
        }
      : undefined,
    cadenceRpm: histograms.cadenceRpm
      ? {
          ...histograms.cadenceRpm,
          buckets: histograms.cadenceRpm.buckets.map((bucket) => ({ ...bucket })),
        }
      : undefined,
    powerW: histograms.powerW
      ? {
          ...histograms.powerW,
          buckets: histograms.powerW.buckets.map((bucket) => ({ ...bucket })),
        }
      : undefined,
    heartRateBpm: histograms.heartRateBpm
      ? {
          ...histograms.heartRateBpm,
          buckets: histograms.heartRateBpm.buckets.map((bucket) => ({
            ...bucket,
          })),
        }
      : undefined,
  };
}

function cloneTraining(
  training: TrackActivityTraining | undefined,
): TrackActivityTraining | undefined {
  if (!training) {
    return undefined;
  }

  return {
    ...training,
    source: training.source ? { ...training.source } : undefined,
  };
}

function cloneTrackPoint(point: TrackPoint): TrackPoint {
  return {
    ...point,
    metrics: point.metrics ? { ...point.metrics } : undefined,
  };
}

function assignNumber<T extends object, K extends keyof T>(
  object: T,
  key: K,
  value: number | undefined,
) {
  if (typeof value === "number" && Number.isFinite(value)) {
    object[key] = value as T[K];
  }
}

function isSafeMetricName(name: string): boolean {
  return name.length > 0 && !RESERVED_METRIC_NAMES.has(name);
}

function hasPosition(point: TrackPoint): point is TrackPoint & {
  lat: number;
  lon: number;
} {
  return isFiniteNumber(point.lat) && isFiniteNumber(point.lon);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isRatioAtMost(value: number, maxInclusive: number): boolean {
  return value <= maxInclusive + ZONE_RATIO_EPSILON;
}
