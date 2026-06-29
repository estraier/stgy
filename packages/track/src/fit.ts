import { Decoder, Stream } from "@garmin/fitsdk";

const DEFAULT_MAX_POINTS = 3000;
const DEFAULT_ROUTE_COLOR = "#0078A8";
const SEMICIRCLE_TO_DEGREES = 180 / 2147483648;
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
  device?: TrackDeviceInfo;
  createdAt?: number;
  startTime?: number;
  totalElapsedTime?: number;
  totalTimerTime?: number;
  totalDistanceM?: number;
};

export type TrackDataSource = {
  type: string;
  formatVersion?: string;
};

export type TrackDeviceInfo = {
  manufacturer?: string;
  product?: string;
  serialNumber?: number;
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
};

export type TrackParseErrorCode =
  | "empty_input"
  | "decode_failed"
  | "no_record_messages";

export type TrackJsonConversionErrorCode =
  | "no_position_points"
  | "not_enough_position_points";

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
  options: ParseFitOptions = {}
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
      throw new TrackParseError("decode_failed", "fit", "Input is not a FIT file.");
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
      `FIT data could not be decoded: ${getErrorMessage(e)}`
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
        `FIT data could not be decoded: ${getErrorMessage(readResult.errors[0])}`
      );
    }

    throw new TrackParseError(
      "no_record_messages",
      "fit",
      "FIT data does not contain record messages."
    );
  }

  const preferEnhancedFields = options.preferEnhancedFields !== false;
  const points = records
    .map((record) => fitRecordToTrackPoint(record, preferEnhancedFields))
    .filter(hasAnyPointValue);

  const warnings = createFitWarnings(
    readResult.errors || [],
    points,
    options
  );

  return {
    schemaVersion: 1,
    metadata: fitMessagesToMetadata(messages),
    points,
    warnings,
  };
}

export function downsampleTrackActivity(
  activity: TrackActivity,
  options: DownsampleTrackOptions = {}
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
    return downsampleTrackActivityUniform(activity, maxPoints, preserveEndpoints);
  }

  return downsampleTrackActivityAggregate(activity, maxPoints, preserveEndpoints);
}

export function trackActivityToTrackJson(
  activity: TrackActivity,
  options: TrackJsonOptions = {}
): string {
  const geoPoints = activity.points.filter(hasPosition);

  if (geoPoints.length === 0) {
    throw new TrackJsonConversionError(
      "no_position_points",
      "Track activity does not contain positioned points."
    );
  }

  if (geoPoints.length < 2) {
    throw new TrackJsonConversionError(
      "not_enough_position_points",
      "At least two positioned points are required."
    );
  }

  const coordinateProperties = buildCoordinateProperties(geoPoints, options);
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
    const metadata = buildTrackJsonMetadata(activity.metadata);
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
          coordinates: geoPoints.map((point) => [point.lon, point.lat]),
        },
        properties,
      },
    ],
  };

  return JSON.stringify(trackJson, null, options.pretty ? 2 : 0);
}

function buildTrackJsonMetadata(
  metadata: TrackActivityMetadata
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

  if (metadata.device) {
    output.device = { ...metadata.device };
  }

  assignMetadataNumber(output, "createdAt", metadata.createdAt);
  assignMetadataNumber(output, "startTime", metadata.startTime);
  assignMetadataNumber(output, "totalElapsedTime", metadata.totalElapsedTime);
  assignMetadataNumber(output, "totalTimerTime", metadata.totalTimerTime);
  assignMetadataNumber(output, "totalDistanceM", metadata.totalDistanceM);

  return Object.keys(output).length > 0 ? output : undefined;
}

function assignMetadataNumber(
  output: Record<string, unknown>,
  key: string,
  value: number | undefined
) {
  if (typeof value === "number" && Number.isFinite(value)) {
    output[key] = value;
  }
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
      "maxPoints must be a finite number greater than or equal to 2."
    );
  }

  return Math.floor(value);
}

function downsampleTrackActivityUniform(
  activity: TrackActivity,
  maxPoints: number,
  preserveEndpoints: boolean
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
  preserveEndpoints: boolean
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
  maxPoints: number
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

function aggregatePoints(points: TrackPoint[], maxPoints: number): TrackPoint[] {
  if (points.length <= maxPoints) {
    return points.map(cloneTrackPoint);
  }

  return createBucketRanges(points.length, maxPoints).map(([start, end]) => {
    return aggregateTrackPointBucket(points, start, end);
  });
}

function createBucketRanges(length: number, count: number): Array<[number, number]> {
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
  end: number
): TrackPoint {
  const bucket = points.slice(start, end);
  const representative = points[Math.floor((start + end - 1) / 2)];
  const point: TrackPoint = {};

  assignNumber(point, "time", representative.time);
  assignNumber(point, "lat", representative.lat);
  assignNumber(point, "lon", representative.lon);
  assignNumber(point, "distanceM", representative.distanceM);
  assignNumber(point, "elevationM", averagePointValue(bucket, (item) => item.elevationM));
  assignNumber(point, "heartRateBpm", averagePointValue(bucket, (item) => item.heartRateBpm));
  assignNumber(point, "cadenceRpm", averagePointValue(bucket, (item) => item.cadenceRpm));
  assignNumber(point, "powerW", averagePointValue(bucket, (item) => item.powerW));
  assignNumber(point, "speedMps", averagePointValue(bucket, (item) => item.speedMps));
  assignNumber(point, "temperatureC", averagePointValue(bucket, (item) => item.temperatureC));

  const metrics = aggregateMetricValues(bucket);
  if (metrics) {
    point.metrics = metrics;
  }

  return point;
}

function averagePointValue(
  points: TrackPoint[],
  getValue: (point: TrackPoint) => number | undefined
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

function aggregateMetricValues(points: TrackPoint[]): Record<string, number> | undefined {
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

function selectUniformIndicesWithEndpoints(length: number, count: number): number[] {
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
    device: metadata.device ? { ...metadata.device } : undefined,
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

function fitMessagesToMetadata(messages: FitMessages): TrackActivityMetadata {
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

  const device = buildDeviceInfo(fileId);
  const metadata: TrackActivityMetadata = {
    source: {
      type: "fit",
    },
  };

  if (sport) {
    const sportValue = toOptionalString(getFirstValue(sport, ["sport"]));
    const subSportValue = toOptionalString(getFirstValue(sport, [
      "subSport",
      "sub_sport",
    ]));

    if (sportValue) {
      metadata.sport = sportValue;
    }

    if (subSportValue) {
      metadata.subSport = subSportValue;
    }
  }

  if (device) {
    metadata.device = device;
  }

  if (fileId) {
    assignNumber(metadata, "createdAt", toUnixSeconds(getFirstValue(fileId, [
      "timeCreated",
      "time_created",
    ])));
  }

  if (session) {
    assignNumber(metadata, "startTime", toUnixSeconds(getFirstValue(session, [
      "startTime",
      "start_time",
    ])));
    assignNumber(metadata, "totalElapsedTime", toFiniteNumber(getFirstValue(session, [
      "totalElapsedTime",
      "total_elapsed_time",
    ])));
    assignNumber(metadata, "totalTimerTime", toFiniteNumber(getFirstValue(session, [
      "totalTimerTime",
      "total_timer_time",
    ])));
    assignNumber(metadata, "totalDistanceM", toFiniteNumber(getFirstValue(session, [
      "totalDistance",
      "total_distance",
    ])));
  }

  return metadata;
}

function buildDeviceInfo(fileId: FitMessage | undefined): TrackDeviceInfo | undefined {
  if (!fileId) {
    return undefined;
  }

  const device: TrackDeviceInfo = {};
  const manufacturer = toOptionalString(getFirstValue(fileId, ["manufacturer"]));
  const product = toOptionalString(getFirstValue(fileId, [
    "productName",
    "garminProduct",
    "product",
  ]));
  const serialNumber = toFiniteNumber(getFirstValue(fileId, [
    "serialNumber",
    "serial_number",
  ]));

  if (manufacturer) {
    device.manufacturer = manufacturer;
  }

  if (product) {
    device.product = product;
  }

  if (typeof serialNumber === "number") {
    device.serialNumber = serialNumber;
  }

  return Object.keys(device).length > 0 ? device : undefined;
}

function fitRecordToTrackPoint(
  record: FitMessage,
  preferEnhancedFields: boolean
): TrackPoint {
  const point: TrackPoint = {};

  assignNumber(point, "time", toUnixSeconds(getFirstValue(record, [
    "timestamp",
    "time",
  ])));
  assignNumber(point, "lat", normalizeLatitude(getFirstValue(record, [
    "positionLat",
    "position_lat",
    "lat",
    "latitude",
  ])));
  assignNumber(point, "lon", normalizeLongitude(getFirstValue(record, [
    "positionLong",
    "position_long",
    "lon",
    "lng",
    "longitude",
  ])));
  assignNumber(point, "distanceM", toFiniteNumber(getFirstValue(record, [
    "distance",
    "distanceM",
    "distance_m",
  ])));
  assignNumber(point, "elevationM", selectElevation(record, preferEnhancedFields));
  assignNumber(point, "heartRateBpm", toFiniteNumber(getFirstValue(record, [
    "heartRate",
    "heart_rate",
    "heartRateBpm",
  ])));
  assignNumber(point, "cadenceRpm", toFiniteNumber(getFirstValue(record, [
    "cadence",
    "cadenceRpm",
  ])));
  assignNumber(point, "powerW", toFiniteNumber(getFirstValue(record, [
    "power",
    "powerW",
  ])));
  assignNumber(point, "speedMps", selectSpeed(record, preferEnhancedFields));
  assignNumber(point, "temperatureC", toFiniteNumber(getFirstValue(record, [
    "temperature",
    "temperatureC",
  ])));

  return point;
}

function selectElevation(
  record: FitMessage,
  preferEnhancedFields: boolean
): number | undefined {
  const enhanced = toFiniteNumber(getFirstValue(record, [
    "enhancedAltitude",
    "enhanced_altitude",
    "enhancedElevation",
    "enhanced_elevation",
  ]));
  const regular = toFiniteNumber(getFirstValue(record, [
    "altitude",
    "elevation",
    "elevationM",
  ]));

  return preferEnhancedFields ? enhanced ?? regular : regular ?? enhanced;
}

function selectSpeed(
  record: FitMessage,
  preferEnhancedFields: boolean
): number | undefined {
  const enhanced = toFiniteNumber(getFirstValue(record, [
    "enhancedSpeed",
    "enhanced_speed",
  ]));
  const regular = toFiniteNumber(getFirstValue(record, [
    "speed",
    "speedMps",
  ]));

  return preferEnhancedFields ? enhanced ?? regular : regular ?? enhanced;
}

function createFitWarnings(
  decoderErrors: unknown[],
  points: TrackPoint[],
  options: ParseFitOptions
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
  options: TrackJsonOptions
): Record<string, number[]> {
  const properties: Record<string, number[]> = {};

  addCompleteSeries(properties, "times", points, (point) => point.time);
  addCompleteSeries(properties, "distances", points, (point) => point.distanceM);
  addCompleteSeries(properties, "elevations", points, (point) => point.elevationM);
  addFillForwardSeries(properties, "heartRates", points, (point) => point.heartRateBpm);
  addFillForwardSeries(properties, "cadences", points, (point) => point.cadenceRpm);
  addFillForwardSeries(properties, "powers", points, (point) => point.powerW);
  addCompleteSeries(
    properties,
    "speeds",
    points,
    (point) => point.speedMps,
    (speedMps) => speedMps * 3.6
  );

  if (options.includeMetrics !== false) {
    addMetricSeries(properties, points);
  }

  return properties;
}

function addCompleteSeries(
  output: Record<string, number[]>,
  name: string,
  points: TrackPoint[],
  getValue: (point: TrackPoint) => number | undefined,
  convertValue: (value: number) => number = (value) => value
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
  convertValue: (value: number) => number = (value) => value
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

function addMetricSeries(output: Record<string, number[]>, points: TrackPoint[]) {
  const metricNames = new Set<string>();

  points.forEach((point) => {
    Object.keys(point.metrics || {}).forEach((name) => {
      if (isSafeMetricName(name)) {
        metricNames.add(name);
      }
    });
  });

  Array.from(metricNames).sort().forEach((name) => {
    const values = points.map((point) => point.metrics?.[name]);
    if (values.every(isFiniteNumber)) {
      output[name] = values as number[];
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
  value: number | undefined
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
