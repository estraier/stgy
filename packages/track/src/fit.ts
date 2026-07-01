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
