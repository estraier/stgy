import { Decoder, Stream } from "@garmin/fitsdk";

const DEFAULT_MAX_POINTS = 3000;
const DEFAULT_ROUTE_COLOR = "#0078A8";
const SEMICIRCLE_TO_DEGREES = 180 / 2147483648;
const DEFAULT_TRACK_JSON_PRECISION = {
  coordinates: 5,
  times: 0,
  distances: 1,
  elevations: 1,
  heartRates: 1,
  cadences: 1,
  powers: 1,
  speeds: 1,
  metrics: 1,
  metadata: 1,
};
export const STRAVA_POWER_CURVE_DURATIONS_SECONDS = [
  5,
  10,
  15,
  20,
  30,
  45,
  60,
  90,
  120,
  180,
  300,
  600,
  900,
  1200,
  1800,
  2700,
  3600,
  5400,
  7200,
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
  warnings: TrackWarning[];
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
  totalElapsedTime?: number;
  totalTimerTime?: number;
  totalDistanceM?: number;
  statistics?: TrackActivityStatistics;
  training?: TrackActivityTraining;
  bestEfforts?: TrackActivityBestEfforts;
};

export type TrackActivityStatistics = {
  speedKph?: TrackNumericStats;
  cadenceRpm?: TrackNumericStats;
  heartRateBpm?: TrackNumericStats;
  powerW?: TrackNumericStats;
  temperatureC?: TrackNumericStats;
};

export type TrackNumericStats = {
  avg?: number;
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

export type TrackWarning = {
  code: string;
  message: string;
};

export type ParseFitOptions = {
  preferEnhancedFields?: boolean;
  includePausedRecords?: boolean;
  minPositionPoints?: number;
};

export type DownsampleTrackOptions = {
  maxPoints?: number;
  strategy?: "uniform" | "aggregate";
  preserveEndpoints?: boolean;
};

export type TrackJsonOptions = {
  title?: string;
  description?: string;
  color?: string;
  weight?: number;
  opacity?: number;
  includeMetrics?: boolean;
  includeMetadata?: boolean;
  pretty?: boolean;
  precision?: TrackJsonPrecisionOptions;
};

export type MergeTrackActivitiesOptions = {
  name?: string;
  description?: string;
  movingSpeedThresholdMps?: number;
};

export type TrackJsonActivityOptions = {
  sourceType?: string;
  name?: string;
  description?: string;
};

export type TrackJsonPrecisionOptions = {
  coordinates?: number;
  times?: number;
  distances?: number;
  elevations?: number;
  heartRates?: number;
  cadences?: number;
  powers?: number;
  speeds?: number;
  metrics?: number;
  metadata?: number;
};

export type TrackParseErrorCode =
  "empty_input" | "decode_failed" | "no_record_messages";

export type TrackJsonConversionErrorCode =
  "no_position_points" | "not_enough_position_points";

type FitMessage = Record<string, unknown>;
type FitMessages = Record<string, unknown>;

type FitReadResult = {
  messages?: FitMessages;
  errors?: unknown[];
};

type FitDecoder = {
  isFIT: () => boolean;
  read: (options?: Record<string, unknown>) => FitReadResult;
};

export class TrackParseError extends Error {
  public readonly code: TrackParseErrorCode;
  public readonly sourceType: string;

  constructor(code: TrackParseErrorCode, sourceType: string, message: string) {
    super(message);
    this.name = "TrackParseError";
    this.code = code;
    this.sourceType = sourceType;
    Object.setPrototypeOf(this, TrackParseError.prototype);
  }
}

export class TrackJsonConversionError extends Error {
  public readonly code: TrackJsonConversionErrorCode;

  constructor(code: TrackJsonConversionErrorCode, message: string) {
    super(message);
    this.name = "TrackJsonConversionError";
    this.code = code;
    Object.setPrototypeOf(this, TrackJsonConversionError.prototype);
  }
}

export function getPowerZone(
  powerW: number,
  ftpW: number,
): TrackPowerZoneKey | undefined {
  assertPositiveFiniteNumber(ftpW, "ftpW");
  if (!isFiniteNumber(powerW)) {
    return undefined;
  }

  const ratio = powerW / ftpW;
  if (ratio <= 0.55) {
    return "z1";
  }
  if (ratio <= 0.75) {
    return "z2";
  }
  if (ratio <= 0.9) {
    return "z3";
  }
  if (ratio <= 1.05) {
    return "z4";
  }
  if (ratio <= 1.2) {
    return "z5";
  }
  if (ratio <= 1.5) {
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

  const z1Max = Math.round(lthrBpm * 0.81);
  const z2Max = Math.round(lthrBpm * 0.89);
  const z3Max = Math.round(lthrBpm * 0.94);
  const z4Max = Math.round(lthrBpm);

  if (heartRateBpm <= z1Max) {
    return "z1";
  }
  if (heartRateBpm <= z2Max) {
    return "z2";
  }
  if (heartRateBpm <= z3Max) {
    return "z3";
  }
  if (heartRateBpm <= z4Max) {
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

export function parseFitBytes(
  bytes: ArrayBuffer | Uint8Array,
  options: ParseFitOptions = {},
): TrackActivity {
  const arrayBuffer = normalizeInputBytes(bytes);
  if (arrayBuffer.byteLength === 0) {
    throw new TrackParseError("empty_input", "fit", "FIT input is empty.");
  }

  let readResult: FitReadResult;
  try {
    const stream = Stream.fromArrayBuffer(arrayBuffer);
    const decoder = new Decoder(stream) as unknown as FitDecoder;

    if (!decoder.isFIT()) {
      throw new TrackParseError(
        "decode_failed",
        "fit",
        "Input is not a FIT file.",
      );
    }

    readResult = decoder.read({
      applyScaleAndOffset: true,
      expandSubFields: true,
      expandComponents: true,
      convertTypesToStrings: true,
      convertDateTimesToDates: true,
      includeUnknownData: false,
      mergeHeartRates: true,
      decodeMemoGlobs: false,
      skipHeader: false,
      dataOnly: false,
    });
  } catch (e) {
    if (e instanceof TrackParseError) {
      throw e;
    }

    throw new TrackParseError(
      "decode_failed",
      "fit",
      `FIT data could not be decoded: ${getErrorMessage(e)}`,
    );
  }

  const messages = readResult.messages || {};
  const records = getMessageArray(messages, [
    "recordMesgs",
    "recordMessages",
    "records",
    "record",
  ]);

  if (records.length === 0) {
    if (Array.isArray(readResult.errors) && readResult.errors.length > 0) {
      throw new TrackParseError(
        "decode_failed",
        "fit",
        `FIT data could not be decoded: ${getErrorMessage(readResult.errors[0])}`,
      );
    }

    throw new TrackParseError(
      "no_record_messages",
      "fit",
      "FIT data does not contain record messages.",
    );
  }

  const preferEnhancedFields = options.preferEnhancedFields !== false;
  const points = records
    .map((record) => fitRecordToTrackPoint(record, preferEnhancedFields))
    .filter(hasAnyPointValue);

  const warnings = createFitWarnings(readResult.errors || [], points, options);

  return {
    schemaVersion: 1,
    metadata: fitMessagesToMetadata(messages, points),
    points,
    warnings,
  };
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

export function trackJsonDataToTrackActivity(
  data: unknown,
  options: TrackJsonActivityOptions = {},
): TrackActivity {
  const features = getTrackJsonLineStringFeatures(data);
  const points: TrackPoint[] = [];
  const firstFeature = features[0];
  const firstProperties = getRecordProperty(firstFeature, "properties");
  const baseMetadata = buildTrackJsonActivityMetadata(
    data,
    firstFeature,
    options,
  );

  features.forEach((feature) => {
    const geometry = getRecordProperty(feature, "geometry");
    const coordinates = Array.isArray(geometry?.coordinates)
      ? geometry.coordinates
      : [];
    const properties = getRecordProperty(feature, "properties");
    const coordinateProperties = getRecordProperty(
      properties,
      "coordinateProperties",
    );

    coordinates.forEach((coordinate, index) => {
      const point = trackJsonCoordinateToPoint(coordinate, coordinateProperties, index);
      if (hasAnyPointValue(point)) {
        points.push(point);
      }
    });
  });

  const metadata: TrackActivityMetadata = {
    ...baseMetadata,
    source: {
      type: options.sourceType || "trackjson",
    },
  };

  if (!metadata.name && firstProperties) {
    const title = firstProperties.title;
    if (typeof title === "string" && title.trim()) {
      metadata.name = title.trim();
    }
  }

  if (!metadata.description && firstProperties) {
    const description = firstProperties.description;
    if (typeof description === "string" && description.trim()) {
      metadata.description = description.trim();
    }
  }

  applyComputedMetadata(metadata, points);

  return {
    schemaVersion: 1,
    metadata,
    points,
    warnings: [],
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
  let distanceOffsetM = 0;

  getActivityMergeOrder(activities).forEach(({ activity, originalIndex }, orderIndex) => {
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

  const sortedIndexedPoints = [...indexedPoints].sort(compareIndexedTrackPoints);
  const points = sortedIndexedPoints.map((item) => cloneTrackPoint(item.point));
  const metadata = buildMergedActivityMetadata(
    activities,
    sortedIndexedPoints,
    options,
  );
  const warnings = activities.flatMap((activity) => {
    return activity.warnings.map((warning) => ({ ...warning }));
  });

  return {
    schemaVersion: 1,
    metadata,
    points,
    warnings,
  };
}

export function trackActivityToTrackJson(
  activity: TrackActivity,
  options: TrackJsonOptions = {},
): string {
  const geoPoints = activity.points.filter(hasPosition);

  if (geoPoints.length === 0) {
    throw new TrackJsonConversionError(
      "no_position_points",
      "Track activity does not contain positioned points.",
    );
  }

  if (geoPoints.length < 2) {
    throw new TrackJsonConversionError(
      "not_enough_position_points",
      "At least two positioned points are required.",
    );
  }

  const precision = resolveTrackJsonPrecision(options.precision);
  const coordinateProperties = buildCoordinateProperties(
    geoPoints,
    options,
    precision,
  );
  const properties: Record<string, unknown> = {
    color: options.color || DEFAULT_ROUTE_COLOR,
    weight: isFiniteNumber(options.weight) ? options.weight : 4,
    opacity: isFiniteNumber(options.opacity) ? options.opacity : 0.8,
  };

  if (isNonEmptyString(options.title)) {
    properties.title = options.title.trim();
  }

  if (isNonEmptyString(options.description)) {
    properties.description = options.description.trim();
  }

  if (options.includeMetadata !== false) {
    const metadata = buildTrackJsonMetadata(activity.metadata, precision);
    if (metadata) {
      properties.metadata = metadata;
    }
  }

  if (Object.keys(coordinateProperties).length > 0) {
    properties.coordinateProperties = coordinateProperties;
  }

  const trackJson = {
    type: "FeatureCollection",
    features: [
      {
        type: "Feature",
        geometry: {
          type: "LineString",
          coordinates: geoPoints.map((point) => [
            roundNumber(point.lon, precision.coordinates),
            roundNumber(point.lat, precision.coordinates),
          ]),
        },
        properties,
      },
    ],
  };

  return JSON.stringify(trackJson, null, options.pretty ? 2 : 0);
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

function getTrackJsonLineStringFeatures(data: unknown): FitMessage[] {
  if (!isObjectRecord(data)) {
    return [];
  }

  if (data.type === "Feature") {
    return isTrackJsonLineStringFeature(data) ? [data] : [];
  }

  if (data.type !== "FeatureCollection" || !Array.isArray(data.features)) {
    return [];
  }

  return data.features.filter(isTrackJsonLineStringFeature);
}

function isTrackJsonLineStringFeature(value: unknown): value is FitMessage {
  if (!isObjectRecord(value)) {
    return false;
  }

  const geometry = getRecordProperty(value, "geometry");
  return geometry?.type === "LineString" && Array.isArray(geometry.coordinates);
}

function getRecordProperty(
  value: unknown,
  key: string,
): Record<string, unknown> | undefined {
  if (!isObjectRecord(value)) {
    return undefined;
  }

  const child = value[key];
  return isObjectRecord(child) ? child : undefined;
}

function buildTrackJsonActivityMetadata(
  data: unknown,
  firstFeature: FitMessage | undefined,
  options: TrackJsonActivityOptions,
): TrackActivityMetadata {
  const featureProperties = getRecordProperty(firstFeature, "properties");
  const featureMetadata = getRecordProperty(featureProperties, "metadata");
  const rootMetadata = getRecordProperty(data, "metadata");
  const src = featureMetadata || rootMetadata;
  const metadata: TrackActivityMetadata = {
    source: {
      type: options.sourceType || "trackjson",
    },
  };

  if (src) {
    copyOptionalString(src, metadata, "name");
    copyOptionalString(src, metadata, "description");
    copyOptionalString(src, metadata, "sport");
    copyOptionalString(src, metadata, "subSport");
    copyOptionalNumber(src, metadata, "createdAt");
    copyOptionalNumber(src, metadata, "startTime");
    copyOptionalNumber(src, metadata, "totalElapsedTime");
    copyOptionalNumber(src, metadata, "totalTimerTime");
    copyOptionalNumber(src, metadata, "totalDistanceM");

    const recordingDevice = getRecordProperty(src, "recordingDevice");
    if (recordingDevice) {
      metadata.recordingDevice = { ...recordingDevice } as TrackDeviceInfo;
    }

    if (Array.isArray(src.devices)) {
      metadata.devices = src.devices
        .filter(isObjectRecord)
        .map((device) => ({ ...device }) as TrackDeviceInfo);
    }
  }

  if (options.name) {
    metadata.name = options.name;
  }
  if (options.description) {
    metadata.description = options.description;
  }

  return metadata;
}

function copyOptionalString(
  src: Record<string, unknown>,
  dest: TrackActivityMetadata,
  key: keyof TrackActivityMetadata,
) {
  const value = src[key];
  if (typeof value === "string" && value.trim()) {
    dest[key] = value.trim() as never;
  }
}

function copyOptionalNumber(
  src: Record<string, unknown>,
  dest: TrackActivityMetadata,
  key: keyof TrackActivityMetadata,
) {
  const value = toFiniteNumber(src[key]);
  if (isFiniteNumber(value)) {
    dest[key] = value as never;
  }
}

function trackJsonCoordinateToPoint(
  coordinate: unknown,
  coordinateProperties: Record<string, unknown> | undefined,
  index: number,
): TrackPoint {
  const point: TrackPoint = {};

  if (Array.isArray(coordinate) && coordinate.length >= 2) {
    const lon = toFiniteNumber(coordinate[0]);
    const lat = toFiniteNumber(coordinate[1]);
    const elevation = toFiniteNumber(coordinate[2]);
    if (isFiniteNumber(lon)) {
      point.lon = lon;
    }
    if (isFiniteNumber(lat)) {
      point.lat = lat;
    }
    if (isFiniteNumber(elevation)) {
      point.elevationM = elevation;
    }
  }

  if (!coordinateProperties) {
    return point;
  }

  assignPointFromSeries(point, "time", coordinateProperties.times, index);
  assignPointFromSeries(point, "distanceM", coordinateProperties.distances, index);
  assignPointFromSeries(point, "elevationM", coordinateProperties.elevations, index);
  assignPointFromSeries(point, "heartRateBpm", coordinateProperties.heartRates, index);
  assignPointFromSeries(point, "cadenceRpm", coordinateProperties.cadences, index);
  assignPointFromSeries(point, "powerW", coordinateProperties.powers, index);
  assignPointFromSeries(
    point,
    "speedMps",
    coordinateProperties.speeds,
    index,
    (value) => value / 3.6,
  );

  Object.keys(coordinateProperties).forEach((name) => {
    if (!isSafeMetricName(name)) {
      return;
    }
    const values = coordinateProperties[name];
    if (!Array.isArray(values)) {
      return;
    }
    const value = toFiniteNumber(values[index]);
    if (!isFiniteNumber(value)) {
      return;
    }
    if (!point.metrics) {
      point.metrics = {};
    }
    point.metrics[name] = value;
  });

  return point;
}

function assignPointFromSeries(
  point: TrackPoint,
  key: keyof TrackPoint,
  series: unknown,
  index: number,
  convertValue: (value: number) => number = (value) => value,
) {
  if (!Array.isArray(series)) {
    return;
  }

  const value = toFiniteNumber(series[index]);
  if (isFiniteNumber(value)) {
    point[key] = convertValue(value) as never;
  }
}

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
        point.distanceM = Math.max(0, point.distanceM - firstDistance) + distanceOffsetM;
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

function compareIndexedTrackPoints(a: IndexedTrackPoint, b: IndexedTrackPoint): number {
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

  const times = points.map((point) => point.time).filter(isFiniteNumber);
  if (times.length > 0) {
    const startTime = Math.min(...times);
    const endTime = Math.max(...times);
    metadata.startTime = startTime;
    metadata.totalElapsedTime = Math.max(0, endTime - startTime);
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

function applyComputedMetadata(
  metadata: TrackActivityMetadata,
  points: TrackPoint[],
) {
  const statistics = buildActivityStatistics(points);
  if (statistics) {
    metadata.statistics = statistics;
  } else {
    delete metadata.statistics;
  }

  const training = buildMergedTraining(points);
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
}

function buildMergedTraining(points: TrackPoint[]): TrackActivityTraining | undefined {
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

      if (isMovingInterval(previous, current, movingSpeedThresholdMps, hasSpeed)) {
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
      (isFiniteNumber(previousSpeed) && previousSpeed > movingSpeedThresholdMps) ||
      (isFiniteNumber(currentSpeed) && currentSpeed > movingSpeedThresholdMps)
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

function buildTrackJsonMetadata(
  metadata: TrackActivityMetadata,
  precision: Required<TrackJsonPrecisionOptions>,
): Record<string, unknown> | undefined {
  const output: Record<string, unknown> = {};

  if (metadata.source) {
    output.source = { ...metadata.source };
  }

  if (isNonEmptyString(metadata.name)) {
    output.name = metadata.name.trim();
  }

  if (isNonEmptyString(metadata.description)) {
    output.description = metadata.description.trim();
  }

  if (isNonEmptyString(metadata.sport)) {
    output.sport = metadata.sport.trim();
  }

  if (isNonEmptyString(metadata.subSport)) {
    output.subSport = metadata.subSport.trim();
  }

  if (metadata.recordingDevice) {
    output.recordingDevice = { ...metadata.recordingDevice };
  }

  if (metadata.devices && metadata.devices.length > 0) {
    output.devices = metadata.devices.map((device) => ({ ...device }));
  }

  assignMetadataInteger(output, "createdAt", metadata.createdAt);
  assignMetadataInteger(output, "startTime", metadata.startTime);
  assignMetadataNumber(
    output,
    "totalElapsedTime",
    metadata.totalElapsedTime,
    0,
  );
  assignMetadataNumber(output, "totalTimerTime", metadata.totalTimerTime, 0);
  assignMetadataNumber(
    output,
    "totalDistanceM",
    metadata.totalDistanceM,
    precision.metadata,
  );

  const statistics = buildTrackJsonStatistics(metadata.statistics, precision);
  if (statistics) {
    output.statistics = statistics;
  }

  const training = buildTrackJsonTraining(metadata.training, precision);
  if (training) {
    output.training = training;
  }

  const bestEfforts = buildTrackJsonBestEfforts(metadata.bestEfforts, precision);
  if (bestEfforts) {
    output.bestEfforts = bestEfforts;
  }

  return Object.keys(output).length > 0 ? output : undefined;
}

function buildTrackJsonStatistics(
  statistics: TrackActivityStatistics | undefined,
  precision: Required<TrackJsonPrecisionOptions>,
): Record<string, unknown> | undefined {
  if (!statistics) {
    return undefined;
  }

  const output: Record<string, unknown> = {};
  assignTrackJsonNumericStats(
    output,
    "speedKph",
    statistics.speedKph,
    precision,
  );
  assignTrackJsonNumericStats(
    output,
    "cadenceRpm",
    statistics.cadenceRpm,
    precision,
  );
  assignTrackJsonNumericStats(
    output,
    "heartRateBpm",
    statistics.heartRateBpm,
    precision,
  );
  assignTrackJsonNumericStats(output, "powerW", statistics.powerW, precision);
  assignTrackJsonNumericStats(
    output,
    "temperatureC",
    statistics.temperatureC,
    precision,
  );

  return Object.keys(output).length > 0 ? output : undefined;
}

function assignTrackJsonNumericStats(
  output: Record<string, unknown>,
  key: string,
  stats: TrackNumericStats | undefined,
  precision: Required<TrackJsonPrecisionOptions>,
) {
  if (!stats) {
    return;
  }

  const values: Record<string, unknown> = {};
  assignMetadataNumber(values, "avg", stats.avg, precision.metadata);
  assignMetadataNumber(values, "median", stats.median, precision.metadata);
  assignMetadataNumber(values, "max", stats.max, precision.metadata);

  if (Object.keys(values).length > 0) {
    output[key] = values;
  }
}

function buildTrackJsonTraining(
  training: TrackActivityTraining | undefined,
  precision: Required<TrackJsonPrecisionOptions>,
): Record<string, unknown> | undefined {
  if (!training) {
    return undefined;
  }

  const output: Record<string, unknown> = {};
  assignMetadataNumber(
    output,
    "normalizedPowerW",
    training.normalizedPowerW,
    precision.metadata,
  );
  assignMetadataNumber(output, "totalWorkJ", training.totalWorkJ, 0);
  assignMetadataNumber(
    output,
    "totalCaloriesCal",
    training.totalCaloriesCal,
    0,
  );

  if (training.source) {
    const source: Record<string, unknown> = {};
    if (training.source.normalizedPower) {
      source.normalizedPower = training.source.normalizedPower;
    }
    if (training.source.totalWork) {
      source.totalWork = training.source.totalWork;
    }
    if (training.source.totalCalories) {
      source.totalCalories = training.source.totalCalories;
    }
    if (Object.keys(source).length > 0) {
      output.source = source;
    }
  }

  return Object.keys(output).length > 0 ? output : undefined;
}

function buildTrackJsonBestEfforts(
  bestEfforts: TrackActivityBestEfforts | undefined,
  precision: Required<TrackJsonPrecisionOptions>,
): Record<string, unknown> | undefined {
  if (!bestEfforts) {
    return undefined;
  }

  const output: Record<string, unknown> = {};
  if (bestEfforts.powerW) {
    const powerW = roundDurationBestEfforts(bestEfforts.powerW, precision);
    if (Object.keys(powerW).length > 0) {
      output.powerW = powerW;
    }
  }

  return Object.keys(output).length > 0 ? output : undefined;
}

function roundDurationBestEfforts(
  efforts: TrackDurationBestEfforts,
  precision: Required<TrackJsonPrecisionOptions>,
): Record<string, number> {
  const output: Record<string, number> = {};

  Object.keys(efforts)
    .sort((a, b) => Number(a) - Number(b))
    .forEach((duration) => {
      const value = efforts[duration];
      if (isFiniteNumber(value)) {
        output[duration] = roundNumber(value, precision.metadata);
      }
    });

  return output;
}

function assignMetadataInteger(
  output: Record<string, unknown>,
  key: string,
  value: number | undefined,
) {
  if (typeof value === "number" && Number.isFinite(value)) {
    output[key] = Math.round(value);
  }
}

function assignMetadataNumber(
  output: Record<string, unknown>,
  key: string,
  value: number | undefined,
  precision: number,
) {
  if (typeof value === "number" && Number.isFinite(value)) {
    output[key] = roundNumber(value, precision);
  }
}

function resolveTrackJsonPrecision(
  precision: TrackJsonPrecisionOptions | undefined,
): Required<TrackJsonPrecisionOptions> {
  return {
    coordinates: normalizePrecision(
      precision?.coordinates,
      DEFAULT_TRACK_JSON_PRECISION.coordinates,
    ),
    times: normalizePrecision(
      precision?.times,
      DEFAULT_TRACK_JSON_PRECISION.times,
    ),
    distances: normalizePrecision(
      precision?.distances,
      DEFAULT_TRACK_JSON_PRECISION.distances,
    ),
    elevations: normalizePrecision(
      precision?.elevations,
      DEFAULT_TRACK_JSON_PRECISION.elevations,
    ),
    heartRates: normalizePrecision(
      precision?.heartRates,
      DEFAULT_TRACK_JSON_PRECISION.heartRates,
    ),
    cadences: normalizePrecision(
      precision?.cadences,
      DEFAULT_TRACK_JSON_PRECISION.cadences,
    ),
    powers: normalizePrecision(
      precision?.powers,
      DEFAULT_TRACK_JSON_PRECISION.powers,
    ),
    speeds: normalizePrecision(
      precision?.speeds,
      DEFAULT_TRACK_JSON_PRECISION.speeds,
    ),
    metrics: normalizePrecision(
      precision?.metrics,
      DEFAULT_TRACK_JSON_PRECISION.metrics,
    ),
    metadata: normalizePrecision(
      precision?.metadata,
      DEFAULT_TRACK_JSON_PRECISION.metadata,
    ),
  };
}

function normalizePrecision(
  value: number | undefined,
  fallback: number,
): number {
  if (!Number.isFinite(value)) {
    return fallback;
  }

  return Math.max(0, Math.min(12, Math.floor(value as number)));
}

function roundNumber(value: number, precision: number): number {
  if (!Number.isFinite(value)) {
    return value;
  }

  if (precision <= 0) {
    return Math.round(value);
  }

  const factor = 10 ** precision;
  return Math.round(value * factor) / factor;
}

function normalizeInputBytes(bytes: ArrayBuffer | Uint8Array): ArrayBuffer {
  if (bytes instanceof ArrayBuffer) {
    return bytes;
  }

  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
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
    warnings: activity.warnings.map((warning) => ({ ...warning })),
  };
}

function cloneMetadata(metadata: TrackActivityMetadata): TrackActivityMetadata {
  return {
    ...metadata,
    source: metadata.source ? { ...metadata.source } : undefined,
    recordingDevice: metadata.recordingDevice
      ? { ...metadata.recordingDevice }
      : undefined,
    devices: metadata.devices?.map((device) => ({ ...device })),
    statistics: cloneStatistics(metadata.statistics),
    training: cloneTraining(metadata.training),
    bestEfforts: cloneBestEfforts(metadata.bestEfforts),
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

function getMessageArray(messages: FitMessages, keys: string[]): FitMessage[] {
  for (const key of keys) {
    const value = messages[key];
    if (Array.isArray(value)) {
      return value.filter(isObjectRecord);
    }
  }

  return [];
}

function fitMessagesToMetadata(
  messages: FitMessages,
  points: TrackPoint[],
): TrackActivityMetadata {
  const fileId = getMessageArray(messages, [
    "fileIdMesgs",
    "fileIdMessages",
    "fileIds",
    "fileId",
  ])[0];

  const sport = getMessageArray(messages, [
    "sportMesgs",
    "sportMessages",
    "sports",
    "sport",
  ])[0];

  const session = getMessageArray(messages, [
    "sessionMesgs",
    "sessionMessages",
    "sessions",
    "session",
  ])[0];

  const recordingDevice = buildDeviceInfo(fileId);
  const devices = buildDeviceInfos(messages);
  const metadata: TrackActivityMetadata = {
    source: {
      type: "fit",
    },
  };

  if (sport) {
    const sportValue = toOptionalString(getFirstValue(sport, ["sport"]));
    const subSportValue = toOptionalString(
      getFirstValue(sport, ["subSport", "sub_sport"]),
    );

    if (sportValue) {
      metadata.sport = sportValue;
    }

    if (subSportValue) {
      metadata.subSport = subSportValue;
    }
  }

  if (recordingDevice) {
    metadata.recordingDevice = recordingDevice;
  }

  if (devices.length > 0) {
    metadata.devices = devices;
  }

  if (fileId) {
    assignNumber(
      metadata,
      "createdAt",
      toUnixSeconds(getFirstValue(fileId, ["timeCreated", "time_created"])),
    );
  }

  if (session) {
    assignNumber(
      metadata,
      "startTime",
      toUnixSeconds(getFirstValue(session, ["startTime", "start_time"])),
    );
    assignNumber(
      metadata,
      "totalElapsedTime",
      toFiniteNumber(
        getFirstValue(session, ["totalElapsedTime", "total_elapsed_time"]),
      ),
    );
    assignNumber(
      metadata,
      "totalTimerTime",
      toFiniteNumber(
        getFirstValue(session, ["totalTimerTime", "total_timer_time"]),
      ),
    );
    assignNumber(
      metadata,
      "totalDistanceM",
      toFiniteNumber(
        getFirstValue(session, ["totalDistance", "total_distance"]),
      ),
    );
  }

  const statistics = buildActivityStatistics(points);
  if (statistics) {
    metadata.statistics = statistics;
  }

  const training = buildActivityTraining(messages, points);
  if (training) {
    metadata.training = training;
  }

  const bestEfforts = buildActivityBestEfforts(points);
  if (bestEfforts) {
    metadata.bestEfforts = bestEfforts;
  }

  return metadata;
}

function buildActivityStatistics(
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
    avg:
      numericValues.reduce((sum, value) => sum + value, 0) /
      numericValues.length,
    median,
    max: sorted[sorted.length - 1],
  };
}

function buildActivityBestEfforts(
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

function buildActivityTraining(
  messages: FitMessages,
  points: TrackPoint[],
): TrackActivityTraining | undefined {
  const summaryMessages = getSummaryMessages(messages);
  const training: TrackActivityTraining = {};
  const source: TrackActivityTrainingSource = {};

  const normalizedPower = toFiniteNumber(
    getFirstValueFromMessages(summaryMessages, [
      "normalizedPower",
      "normalized_power",
      "normalizedPowerW",
      "normalized_power_w",
    ]),
  );
  if (isFiniteNumber(normalizedPower)) {
    training.normalizedPowerW = normalizedPower;
    source.normalizedPower = "fit";
  } else {
    const computedNormalizedPower = computeNormalizedPowerW(points);
    if (isFiniteNumber(computedNormalizedPower)) {
      training.normalizedPowerW = computedNormalizedPower;
      source.normalizedPower = "computed";
    }
  }

  const fitTotalWorkJ = getFitTotalWorkJ(summaryMessages);
  if (isFiniteNumber(fitTotalWorkJ)) {
    training.totalWorkJ = fitTotalWorkJ;
    source.totalWork = "fit";
  } else {
    const computedTotalWorkJ = computeTotalWorkJ(points);
    if (isFiniteNumber(computedTotalWorkJ)) {
      training.totalWorkJ = computedTotalWorkJ;
      source.totalWork = "computed";
    }
  }

  const totalCaloriesCal = getFitTotalCaloriesCal(summaryMessages);
  if (isFiniteNumber(totalCaloriesCal)) {
    training.totalCaloriesCal = totalCaloriesCal;
    source.totalCalories = "fit";
  }

  if (Object.keys(source).length > 0) {
    training.source = source;
  }

  return hasTrainingValues(training) ? training : undefined;
}

function getSummaryMessages(messages: FitMessages): FitMessage[] {
  return [
    ...getMessageArray(messages, [
      "sessionMesgs",
      "sessionMessages",
      "sessions",
      "session",
    ]),
    ...getMessageArray(messages, [
      "activityMesgs",
      "activityMessages",
      "activities",
      "activity",
    ]),
    ...getMessageArray(messages, ["lapMesgs", "lapMessages", "laps", "lap"]),
  ];
}

function getFirstValueFromMessages(
  messages: FitMessage[],
  keys: string[],
): unknown {
  for (const message of messages) {
    const value = getFirstValue(message, keys);
    if (value !== undefined) {
      return value;
    }
  }

  return undefined;
}

function getFitTotalWorkJ(messages: FitMessage[]): number | undefined {
  const joules = toFiniteNumber(
    getFirstValueFromMessages(messages, [
      "totalWork",
      "total_work",
      "totalWorkJ",
      "total_work_j",
    ]),
  );
  if (isFiniteNumber(joules)) {
    return joules;
  }

  const kilojoules = toFiniteNumber(
    getFirstValueFromMessages(messages, [
      "totalWorkKj",
      "total_work_kj",
      "totalWorkKJ",
      "total_work_kJ",
    ]),
  );
  return isFiniteNumber(kilojoules) ? kilojoules * 1000 : undefined;
}

function getFitTotalCaloriesCal(messages: FitMessage[]): number | undefined {
  const calories = toFiniteNumber(
    getFirstValueFromMessages(messages, [
      "totalCaloriesCal",
      "total_calories_cal",
      "caloriesCal",
      "calories_cal",
    ]),
  );
  if (isFiniteNumber(calories)) {
    return calories;
  }

  const fitKilocalories = toFiniteNumber(
    getFirstValueFromMessages(messages, [
      "totalCalories",
      "total_calories",
      "calories",
    ]),
  );
  return isFiniteNumber(fitKilocalories) ? fitKilocalories * 1000 : undefined;
}

function hasTrainingValues(training: TrackActivityTraining): boolean {
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
  let totalSeconds = assignTimedZoneDurations(points, getValue, getZone, durations);

  if (totalSeconds === 0) {
    totalSeconds = assignSampleZoneDurations(points, getValue, getZone, durations);
  }

  zoneKeys.forEach((zone) => {
    percentages[zone] = totalSeconds > 0 ? (durations[zone] / totalSeconds) * 100 : 0;
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
  const timed = points
    .filter((point): point is TrackPoint & { time: number } => {
      return isFiniteNumber(point.time);
    })
    .sort((a, b) => a.time - b.time);

  let totalSeconds = 0;
  for (let index = 0; index + 1 < timed.length; index += 1) {
    const current = timed[index];
    const next = timed[index + 1];
    const deltaSeconds = next.time - current.time;
    const value = getValue(current);

    if (deltaSeconds <= 0 || deltaSeconds > 30 || !isFiniteNumber(value)) {
      continue;
    }

    const zone = getZone(value);
    if (zone) {
      durations[zone] += deltaSeconds;
      totalSeconds += deltaSeconds;
    }
  }

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
  return zoneKeys.reduce((record, zone) => {
    record[zone] = 0;
    return record;
  }, {} as Record<TZone, number>);
}

function assertPositiveFiniteNumber(value: number, name: string) {
  if (!isFiniteNumber(value) || value <= 0) {
    throw new RangeError(`${name} must be a positive finite number.`);
  }
}

function computeNormalizedPowerW(points: TrackPoint[]): number | undefined {
  const samples = buildPowerSamples(points);
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
  const timed = points
    .filter((point): point is TrackPoint & { time: number; powerW: number } => {
      return isFiniteNumber(point.time) && isFiniteNumber(point.powerW);
    })
    .sort((a, b) => a.time - b.time);

  if (timed.length >= 2) {
    const firstTime = Math.ceil(timed[0].time);
    const lastTime = Math.floor(timed[timed.length - 1].time);
    const duration = lastTime - firstTime + 1;

    if (duration >= 30 && duration <= 86400) {
      const samples: number[] = [];
      let index = 0;
      for (let time = firstTime; time <= lastTime; time += 1) {
        while (index + 1 < timed.length && timed[index + 1].time <= time) {
          index += 1;
        }
        samples.push(timed[index].powerW);
      }
      return samples;
    }
  }

  return points.map((point) => point.powerW).filter(isFiniteNumber);
}

function computeTotalWorkJ(points: TrackPoint[]): number | undefined {
  const timed = points
    .filter((point): point is TrackPoint & { time: number; powerW: number } => {
      return isFiniteNumber(point.time) && isFiniteNumber(point.powerW);
    })
    .sort((a, b) => a.time - b.time);

  if (timed.length < 2) {
    return undefined;
  }

  let totalWorkJ = 0;
  let hasSegment = false;

  for (let index = 1; index < timed.length; index += 1) {
    const previous = timed[index - 1];
    const current = timed[index];
    const deltaSeconds = current.time - previous.time;
    if (deltaSeconds > 0 && deltaSeconds <= 30) {
      totalWorkJ += ((previous.powerW + current.powerW) / 2) * deltaSeconds;
      hasSegment = true;
    }
  }

  return hasSegment ? totalWorkJ : undefined;
}

function buildDeviceInfo(
  fileId: FitMessage | undefined,
): TrackDeviceInfo | undefined {
  if (!fileId) {
    return undefined;
  }

  const device = buildDeviceInfoFromMessage(fileId);
  return Object.keys(device).length > 0 ? device : undefined;
}

function buildDeviceInfos(messages: FitMessages): TrackDeviceInfo[] {
  const deviceMessages = getMessageArray(messages, [
    "deviceInfoMesgs",
    "deviceInfoMessages",
    "deviceInfos",
    "deviceInfo",
  ]);

  return deviceMessages
    .map(buildDeviceInfoFromMessage)
    .filter((device) => Object.keys(device).length > 0);
}

function buildDeviceInfoFromMessage(message: FitMessage): TrackDeviceInfo {
  const device: TrackDeviceInfo = {};
  const manufacturer = toOptionalString(
    getFirstValue(message, ["manufacturer"]),
  );
  const product = toOptionalString(
    getFirstValue(message, ["productName", "garminProduct", "product"]),
  );
  const productName = toOptionalString(
    getFirstValue(message, [
      "productName",
      "product_name",
      "deviceName",
      "device_name",
      "name",
    ]),
  );
  const serialNumber = toFiniteNumber(
    getFirstValue(message, ["serialNumber", "serial_number"]),
  );
  const softwareVersion = toOptionalString(
    getFirstValue(message, ["softwareVersion", "software_version"]),
  );
  const hardwareVersion = toOptionalString(
    getFirstValue(message, ["hardwareVersion", "hardware_version"]),
  );
  const deviceType = toOptionalString(
    getFirstValue(message, ["deviceType", "device_type"]),
  );
  const sourceType = toOptionalString(
    getFirstValue(message, ["sourceType", "source_type"]),
  );

  if (manufacturer) {
    device.manufacturer = manufacturer;
  }

  if (product) {
    device.product = product;
  }

  if (productName && productName !== product) {
    device.productName = productName;
  }

  if (typeof serialNumber === "number") {
    device.serialNumber = serialNumber;
  }

  if (softwareVersion) {
    device.softwareVersion = softwareVersion;
  }

  if (hardwareVersion) {
    device.hardwareVersion = hardwareVersion;
  }

  if (deviceType) {
    device.deviceType = deviceType;
  }

  if (sourceType) {
    device.sourceType = sourceType;
  }

  return device;
}

function fitRecordToTrackPoint(
  record: FitMessage,
  preferEnhancedFields: boolean,
): TrackPoint {
  const point: TrackPoint = {};

  assignNumber(
    point,
    "time",
    toUnixSeconds(getFirstValue(record, ["timestamp", "time"])),
  );
  assignNumber(
    point,
    "lat",
    normalizeLatitude(
      getFirstValue(record, ["positionLat", "position_lat", "lat", "latitude"]),
    ),
  );
  assignNumber(
    point,
    "lon",
    normalizeLongitude(
      getFirstValue(record, [
        "positionLong",
        "position_long",
        "lon",
        "lng",
        "longitude",
      ]),
    ),
  );
  assignNumber(
    point,
    "distanceM",
    toFiniteNumber(
      getFirstValue(record, ["distance", "distanceM", "distance_m"]),
    ),
  );
  assignNumber(
    point,
    "elevationM",
    selectElevation(record, preferEnhancedFields),
  );
  assignNumber(
    point,
    "heartRateBpm",
    toFiniteNumber(
      getFirstValue(record, ["heartRate", "heart_rate", "heartRateBpm"]),
    ),
  );
  assignNumber(
    point,
    "cadenceRpm",
    toFiniteNumber(getFirstValue(record, ["cadence", "cadenceRpm"])),
  );
  assignNumber(
    point,
    "powerW",
    toFiniteNumber(getFirstValue(record, ["power", "powerW"])),
  );
  assignNumber(point, "speedMps", selectSpeed(record, preferEnhancedFields));
  assignNumber(
    point,
    "temperatureC",
    toFiniteNumber(getFirstValue(record, ["temperature", "temperatureC"])),
  );

  return point;
}

function selectElevation(
  record: FitMessage,
  preferEnhancedFields: boolean,
): number | undefined {
  const enhanced = toFiniteNumber(
    getFirstValue(record, [
      "enhancedAltitude",
      "enhanced_altitude",
      "enhancedElevation",
      "enhanced_elevation",
    ]),
  );
  const regular = toFiniteNumber(
    getFirstValue(record, ["altitude", "elevation", "elevationM"]),
  );

  return preferEnhancedFields ? (enhanced ?? regular) : (regular ?? enhanced);
}

function selectSpeed(
  record: FitMessage,
  preferEnhancedFields: boolean,
): number | undefined {
  const enhanced = toFiniteNumber(
    getFirstValue(record, ["enhancedSpeed", "enhanced_speed"]),
  );
  const regular = toFiniteNumber(getFirstValue(record, ["speed", "speedMps"]));

  return preferEnhancedFields ? (enhanced ?? regular) : (regular ?? enhanced);
}

function createFitWarnings(
  decoderErrors: unknown[],
  points: TrackPoint[],
  options: ParseFitOptions,
): TrackWarning[] {
  const warnings: TrackWarning[] = [];

  decoderErrors.forEach((error) => {
    warnings.push({
      code: "fit_decoder_warning",
      message: getErrorMessage(error),
    });
  });

  if (options.includePausedRecords === false) {
    warnings.push({
      code: "paused_record_filter_not_supported",
      message: "Paused record filtering is not implemented yet.",
    });
  }

  const minPositionPoints = options.minPositionPoints ?? 2;
  const positionPoints = points.filter(hasPosition).length;

  if (positionPoints < minPositionPoints) {
    warnings.push({
      code: "not_enough_position_points",
      message: `Only ${positionPoints} positioned point(s) were found.`,
    });
  }

  return warnings;
}

function buildCoordinateProperties(
  points: TrackPoint[],
  options: TrackJsonOptions,
  precision: Required<TrackJsonPrecisionOptions>,
): Record<string, number[]> {
  const properties: Record<string, number[]> = {};

  addCompleteSeries(
    properties,
    "times",
    points,
    (point) => point.time,
    (value) => roundNumber(value, precision.times),
  );
  addCompleteSeries(
    properties,
    "distances",
    points,
    (point) => point.distanceM,
    (value) => roundNumber(value, precision.distances),
  );
  addCompleteSeries(
    properties,
    "elevations",
    points,
    (point) => point.elevationM,
    (value) => roundNumber(value, precision.elevations),
  );
  addFillForwardSeries(
    properties,
    "heartRates",
    points,
    (point) => point.heartRateBpm,
    (value) => roundNumber(value, precision.heartRates),
  );
  addFillForwardSeries(
    properties,
    "cadences",
    points,
    (point) => point.cadenceRpm,
    (value) => roundNumber(value, precision.cadences),
  );
  addFillForwardSeries(
    properties,
    "powers",
    points,
    (point) => point.powerW,
    (value) => roundNumber(value, precision.powers),
  );
  addCompleteSeries(
    properties,
    "speeds",
    points,
    (point) => point.speedMps,
    (speedMps) => roundNumber(speedMps * 3.6, precision.speeds),
  );

  if (options.includeMetrics !== false) {
    addMetricSeries(properties, points, precision);
  }

  return properties;
}

function addCompleteSeries(
  output: Record<string, number[]>,
  name: string,
  points: TrackPoint[],
  getValue: (point: TrackPoint) => number | undefined,
  convertValue: (value: number) => number = (value) => value,
) {
  const values = points.map(getValue);

  if (!values.every(isFiniteNumber)) {
    return;
  }

  output[name] = values.map((value) => convertValue(value as number));
}

function addFillForwardSeries(
  output: Record<string, number[]>,
  name: string,
  points: TrackPoint[],
  getValue: (point: TrackPoint) => number | undefined,
  convertValue: (value: number) => number = (value) => value,
) {
  let current = 0;
  let hasAnyValue = false;
  const values = points.map((point) => {
    const value = getValue(point);
    if (isFiniteNumber(value)) {
      current = value;
      hasAnyValue = true;
    }
    return convertValue(current);
  });

  if (!hasAnyValue) {
    return;
  }

  output[name] = values;
}

function addMetricSeries(
  output: Record<string, number[]>,
  points: TrackPoint[],
  precision: Required<TrackJsonPrecisionOptions>,
) {
  const metricNames = new Set<string>();

  points.forEach((point) => {
    Object.keys(point.metrics || {}).forEach((name) => {
      if (isSafeMetricName(name)) {
        metricNames.add(name);
      }
    });
  });

  Array.from(metricNames)
    .sort()
    .forEach((name) => {
      const values = points.map((point) => point.metrics?.[name]);
      if (values.every(isFiniteNumber)) {
        output[name] = (values as number[]).map((value) => {
          return roundNumber(value, precision.metrics);
        });
      }
    });
}

function isSafeMetricName(name: string): boolean {
  return name.length > 0 && !RESERVED_METRIC_NAMES.has(name);
}

function getFirstValue(message: FitMessage, keys: string[]): unknown {
  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(message, key)) {
      return unwrapSingleValue(message[key]);
    }
  }

  return undefined;
}

function unwrapSingleValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.length > 0 ? value[0] : undefined;
  }

  return value;
}

function toUnixSeconds(value: unknown): number | undefined {
  const unwrapped = unwrapSingleValue(value);

  if (unwrapped instanceof Date) {
    const millis = unwrapped.getTime();
    return Number.isFinite(millis) ? Math.trunc(millis / 1000) : undefined;
  }

  const numberValue = toFiniteNumber(unwrapped);
  if (typeof numberValue !== "number") {
    return undefined;
  }

  if (numberValue > 100000000000) {
    return Math.trunc(numberValue / 1000);
  }

  return numberValue;
}

function normalizeLatitude(value: unknown): number | undefined {
  const degrees = normalizeCoordinateDegrees(value);
  if (typeof degrees !== "number" || Math.abs(degrees) > 90) {
    return undefined;
  }

  return degrees;
}

function normalizeLongitude(value: unknown): number | undefined {
  const degrees = normalizeCoordinateDegrees(value);
  if (typeof degrees !== "number" || Math.abs(degrees) > 180) {
    return undefined;
  }

  return degrees;
}

function normalizeCoordinateDegrees(value: unknown): number | undefined {
  const numberValue = toFiniteNumber(value);
  if (typeof numberValue !== "number") {
    return undefined;
  }

  if (Math.abs(numberValue) > 180) {
    return numberValue * SEMICIRCLE_TO_DEGREES;
  }

  return numberValue;
}

function toFiniteNumber(value: unknown): number | undefined {
  const unwrapped = unwrapSingleValue(value);

  if (typeof unwrapped === "number" && Number.isFinite(unwrapped)) {
    return unwrapped;
  }

  if (typeof unwrapped === "string" && unwrapped.trim() !== "") {
    const parsed = Number(unwrapped);
    return Number.isFinite(parsed) ? parsed : undefined;
  }

  return undefined;
}

function toOptionalString(value: unknown): string | undefined {
  const unwrapped = unwrapSingleValue(value);

  if (typeof unwrapped === "string") {
    const trimmed = unwrapped.trim();
    return trimmed || undefined;
  }

  if (typeof unwrapped === "number" && Number.isFinite(unwrapped)) {
    return `${unwrapped}`;
  }

  return undefined;
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

function hasAnyPointValue(point: TrackPoint): boolean {
  return Object.keys(point).length > 0;
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

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim() !== "";
}

function isObjectRecord(value: unknown): value is FitMessage {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  if (typeof error === "string") {
    return error;
  }

  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}


export type FitObfuscationOptions = {
  startDistanceM?: number;
  endDistanceM?: number;
};

type FitDefinitionField = {
  fieldNumber: number;
  size: number;
  offset: number;
};

type FitDefinition = {
  globalMessageNumber: number;
  littleEndian: boolean;
  fields: FitDefinitionField[];
  dataSize: number;
};

type FitRecordPoint = {
  latOffset: number;
  lonOffset: number;
  littleEndian: boolean;
  latRaw: number;
  lonRaw: number;
  distanceM?: number;
  effectiveDistanceM: number;
};

const FIT_SIGNATURE = ".FIT";
const FIT_RECORD_GLOBAL_MESSAGE_NUMBER = 20;
const RECORD_POSITION_LAT_FIELD = 0;
const RECORD_POSITION_LONG_FIELD = 1;
const RECORD_DISTANCE_FIELD = 5;
const EARTH_RADIUS_M = 6371000;

const CRC_TABLE = [
  0x0000, 0xcc01, 0xd801, 0x1400,
  0xf001, 0x3c00, 0x2800, 0xe401,
  0xa001, 0x6c00, 0x7800, 0xb401,
  0x5000, 0x9c01, 0x8801, 0x4400,
];

export function obfuscateFitPrivacy(
  bytes: ArrayBuffer | Uint8Array,
  options: FitObfuscationOptions
): Uint8Array {
  const startDistanceM = normalizeDistanceOption(options.startDistanceM);
  const endDistanceM = normalizeDistanceOption(options.endDistanceM);
  const output = normalizeFitObfuscationInputBytes(bytes);

  if (startDistanceM === 0 && endDistanceM === 0) {
    return output;
  }

  const fileInfo = readFitFileInfo(output);
  const points = collectRecordPoints(output, fileInfo.headerSize, fileInfo.dataSize);
  const validPoints = points.filter((point) => isValidCoordinate(point));

  if (validPoints.length === 0) {
    updateFileCrc(output, fileInfo.dataEndOffset);
    return output;
  }

  assignEffectiveDistances(validPoints);
  clampPrivacyCoordinates(output, validPoints, startDistanceM, endDistanceM);
  updateFileCrc(output, fileInfo.dataEndOffset);

  return output;
}

function normalizeDistanceOption(value: number | undefined): number {
  if (value === undefined) {
    return 0;
  }
  if (!Number.isFinite(value) || value < 0) {
    throw new Error("FIT privacy obfuscation distance must be a non-negative finite number");
  }
  return value;
}

function normalizeFitObfuscationInputBytes(bytes: ArrayBuffer | Uint8Array): Uint8Array {
  if (bytes instanceof Uint8Array) {
    return new Uint8Array(bytes);
  }
  return new Uint8Array(bytes.slice(0));
}

function readFitFileInfo(data: Uint8Array): {
  headerSize: number;
  dataSize: number;
  dataEndOffset: number;
} {
  if (data.length < 14) {
    throw new Error("FIT file is too short");
  }

  const headerSize = data[0];
  if (headerSize < 12 || headerSize > data.length - 2) {
    throw new Error("FIT file header size is invalid");
  }

  const signature = String.fromCharCode(
    data[8],
    data[9],
    data[10],
    data[11]
  );
  if (signature !== FIT_SIGNATURE) {
    throw new Error("FIT file signature is invalid");
  }

  const dataSize = readUint32(data, 4, true);
  const dataEndOffset = headerSize + dataSize;
  if (dataEndOffset + 2 > data.length) {
    throw new Error("FIT file data size exceeds the input length");
  }

  return {
    headerSize,
    dataSize,
    dataEndOffset,
  };
}

function collectRecordPoints(
  data: Uint8Array,
  headerSize: number,
  dataSize: number
): FitRecordPoint[] {
  const definitions = new Map<number, FitDefinition>();
  const points: FitRecordPoint[] = [];
  let offset = headerSize;
  const dataEndOffset = headerSize + dataSize;

  while (offset < dataEndOffset) {
    const recordHeader = data[offset];
    offset += 1;

    if ((recordHeader & 0x80) !== 0) {
      const localMessageType = (recordHeader >> 5) & 0x03;
      const definition = getDefinition(definitions, localMessageType);
      collectDataMessagePoint(data, offset, definition, points);
      offset += definition.dataSize;
      continue;
    }

    if ((recordHeader & 0x40) !== 0) {
      const localMessageType = recordHeader & 0x0f;
      const hasDeveloperFields = (recordHeader & 0x20) !== 0;
      offset = readDefinitionMessage(
        data,
        offset,
        localMessageType,
        hasDeveloperFields,
        definitions
      );
      continue;
    }

    const localMessageType = recordHeader & 0x0f;
    const definition = getDefinition(definitions, localMessageType);
    collectDataMessagePoint(data, offset, definition, points);
    offset += definition.dataSize;
  }

  if (offset !== dataEndOffset) {
    throw new Error("FIT data records are not aligned with the data size");
  }

  return points;
}

function readDefinitionMessage(
  data: Uint8Array,
  offset: number,
  localMessageType: number,
  hasDeveloperFields: boolean,
  definitions: Map<number, FitDefinition>
): number {
  offset += 1;
  const architecture = data[offset];
  offset += 1;
  const littleEndian = architecture === 0;
  const globalMessageNumber = readUint16(data, offset, littleEndian);
  offset += 2;

  const fieldCount = data[offset];
  offset += 1;

  const fields: FitDefinitionField[] = [];
  let dataFieldOffset = 0;
  for (let i = 0; i < fieldCount; i += 1) {
    const fieldNumber = data[offset];
    const size = data[offset + 1];
    fields.push({
      fieldNumber,
      size,
      offset: dataFieldOffset,
    });
    dataFieldOffset += size;
    offset += 3;
  }

  if (hasDeveloperFields) {
    const developerFieldCount = data[offset];
    offset += 1;
    for (let i = 0; i < developerFieldCount; i += 1) {
      const size = data[offset + 1];
      dataFieldOffset += size;
      offset += 3;
    }
  }

  definitions.set(localMessageType, {
    globalMessageNumber,
    littleEndian,
    fields,
    dataSize: dataFieldOffset,
  });

  return offset;
}

function getDefinition(
  definitions: Map<number, FitDefinition>,
  localMessageType: number
): FitDefinition {
  const definition = definitions.get(localMessageType);
  if (!definition) {
    throw new Error("FIT data message appeared before its definition");
  }
  return definition;
}

function collectDataMessagePoint(
  data: Uint8Array,
  dataOffset: number,
  definition: FitDefinition,
  points: FitRecordPoint[]
): void {
  if (definition.globalMessageNumber !== FIT_RECORD_GLOBAL_MESSAGE_NUMBER) {
    return;
  }

  const latField = findField(definition, RECORD_POSITION_LAT_FIELD);
  const lonField = findField(definition, RECORD_POSITION_LONG_FIELD);

  if (!latField || !lonField || latField.size < 4 || lonField.size < 4) {
    return;
  }

  const latOffset = dataOffset + latField.offset;
  const lonOffset = dataOffset + lonField.offset;
  const distanceField = findField(definition, RECORD_DISTANCE_FIELD);
  const distanceOffset = distanceField && distanceField.size >= 4
    ? dataOffset + distanceField.offset
    : undefined;

  const distanceM = distanceOffset === undefined
    ? undefined
    : readUint32(data, distanceOffset, definition.littleEndian) / 100;

  points.push({
    latOffset,
    lonOffset,
    littleEndian: definition.littleEndian,
    latRaw: readInt32(data, latOffset, definition.littleEndian),
    lonRaw: readInt32(data, lonOffset, definition.littleEndian),
    distanceM,
    effectiveDistanceM: 0,
  });
}

function findField(
  definition: FitDefinition,
  fieldNumber: number
): FitDefinitionField | undefined {
  return definition.fields.find((field) => field.fieldNumber === fieldNumber);
}

function isValidCoordinate(point: FitRecordPoint): boolean {
  return point.latRaw !== 0x7fffffff && point.lonRaw !== 0x7fffffff;
}

function assignEffectiveDistances(points: FitRecordPoint[]): void {
  if (hasUsableFitDistances(points)) {
    points.forEach((point) => {
      point.effectiveDistanceM = point.distanceM as number;
    });
    return;
  }

  let distanceM = 0;
  points[0].effectiveDistanceM = 0;
  for (let i = 1; i < points.length; i += 1) {
    distanceM += distanceBetweenPoints(points[i - 1], points[i]);
    points[i].effectiveDistanceM = distanceM;
  }
}

function hasUsableFitDistances(points: FitRecordPoint[]): boolean {
  let previousDistanceM = -Infinity;
  for (const point of points) {
    if (point.distanceM === undefined || !Number.isFinite(point.distanceM)) {
      return false;
    }
    if (point.distanceM < previousDistanceM) {
      return false;
    }
    previousDistanceM = point.distanceM;
  }
  return true;
}

function clampPrivacyCoordinates(
  data: Uint8Array,
  points: FitRecordPoint[],
  startDistanceM: number,
  endDistanceM: number
): void {
  const totalDistanceM = points[points.length - 1].effectiveDistanceM;

  if (totalDistanceM <= 0) {
    return;
  }

  if (
    startDistanceM > 0 &&
    endDistanceM > 0 &&
    startDistanceM + endDistanceM >= totalDistanceM
  ) {
    const midpoint = findFirstPointAtOrAfter(points, totalDistanceM / 2);
    points.forEach((point) => writePointCoordinate(data, point, midpoint));
    return;
  }

  if (startDistanceM > 0) {
    const startBoundary = findFirstPointAtOrAfter(points, startDistanceM);
    points
      .filter((point) => point.effectiveDistanceM <= startDistanceM)
      .forEach((point) => writePointCoordinate(data, point, startBoundary));
  }

  if (endDistanceM > 0) {
    const endThresholdM = Math.max(totalDistanceM - endDistanceM, 0);
    const endBoundary = findLastPointAtOrBefore(points, endThresholdM);
    points
      .filter((point) => point.effectiveDistanceM >= endThresholdM)
      .forEach((point) => writePointCoordinate(data, point, endBoundary));
  }
}

function findFirstPointAtOrAfter(
  points: FitRecordPoint[],
  distanceM: number
): FitRecordPoint {
  return points.find((point) => point.effectiveDistanceM >= distanceM) ||
    points[points.length - 1];
}

function findLastPointAtOrBefore(
  points: FitRecordPoint[],
  distanceM: number
): FitRecordPoint {
  for (let i = points.length - 1; i >= 0; i -= 1) {
    if (points[i].effectiveDistanceM <= distanceM) {
      return points[i];
    }
  }
  return points[0];
}

function writePointCoordinate(
  data: Uint8Array,
  target: FitRecordPoint,
  source: FitRecordPoint
): void {
  writeInt32(data, target.latOffset, source.latRaw, target.littleEndian);
  writeInt32(data, target.lonOffset, source.lonRaw, target.littleEndian);
}

function distanceBetweenPoints(a: FitRecordPoint, b: FitRecordPoint): number {
  const lat1 = semicircleToRadians(a.latRaw);
  const lat2 = semicircleToRadians(b.latRaw);
  const deltaLat = lat2 - lat1;
  const deltaLon = semicircleToRadians(b.lonRaw) - semicircleToRadians(a.lonRaw);

  const sinLat = Math.sin(deltaLat / 2);
  const sinLon = Math.sin(deltaLon / 2);
  const h = sinLat * sinLat + Math.cos(lat1) * Math.cos(lat2) * sinLon * sinLon;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(Math.sqrt(h), 1));
}

function semicircleToRadians(value: number): number {
  return value * SEMICIRCLE_TO_DEGREES * Math.PI / 180;
}

function updateFileCrc(data: Uint8Array, dataEndOffset: number): void {
  const crc = calculateFitCrc(data, 0, dataEndOffset);
  writeUint16(data, dataEndOffset, crc, true);
}

function calculateFitCrc(data: Uint8Array, offset: number, length: number): number {
  let crc = 0;
  for (let i = offset; i < offset + length; i += 1) {
    let tmp = CRC_TABLE[crc & 0x0f];
    crc = (crc >> 4) & 0x0fff;
    crc = crc ^ tmp ^ CRC_TABLE[data[i] & 0x0f];

    tmp = CRC_TABLE[crc & 0x0f];
    crc = (crc >> 4) & 0x0fff;
    crc = crc ^ tmp ^ CRC_TABLE[(data[i] >> 4) & 0x0f];
  }
  return crc & 0xffff;
}

function readUint16(data: Uint8Array, offset: number, littleEndian: boolean): number {
  if (littleEndian) {
    return data[offset] | (data[offset + 1] << 8);
  }
  return (data[offset] << 8) | data[offset + 1];
}

function writeUint16(
  data: Uint8Array,
  offset: number,
  value: number,
  littleEndian: boolean
): void {
  if (littleEndian) {
    data[offset] = value & 0xff;
    data[offset + 1] = (value >> 8) & 0xff;
    return;
  }
  data[offset] = (value >> 8) & 0xff;
  data[offset + 1] = value & 0xff;
}

function readUint32(data: Uint8Array, offset: number, littleEndian: boolean): number {
  if (littleEndian) {
    return (
      data[offset] |
      (data[offset + 1] << 8) |
      (data[offset + 2] << 16) |
      (data[offset + 3] << 24)
    ) >>> 0;
  }
  return (
    (data[offset] << 24) |
    (data[offset + 1] << 16) |
    (data[offset + 2] << 8) |
    data[offset + 3]
  ) >>> 0;
}

function readInt32(data: Uint8Array, offset: number, littleEndian: boolean): number {
  const value = readUint32(data, offset, littleEndian);
  return value > 0x7fffffff ? value - 0x100000000 : value;
}

function writeInt32(
  data: Uint8Array,
  offset: number,
  value: number,
  littleEndian: boolean
): void {
  const unsignedValue = value >>> 0;
  if (littleEndian) {
    data[offset] = unsignedValue & 0xff;
    data[offset + 1] = (unsignedValue >> 8) & 0xff;
    data[offset + 2] = (unsignedValue >> 16) & 0xff;
    data[offset + 3] = (unsignedValue >> 24) & 0xff;
    return;
  }
  data[offset] = (unsignedValue >> 24) & 0xff;
  data[offset + 1] = (unsignedValue >> 16) & 0xff;
  data[offset + 2] = (unsignedValue >> 8) & 0xff;
  data[offset + 3] = unsignedValue & 0xff;
}
