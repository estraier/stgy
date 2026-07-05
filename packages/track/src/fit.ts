import { Decoder, Stream } from "@garmin/fitsdk";
import {
  applyComputedMetadata,
  buildActivityBestEfforts,
  buildActivityStatistics,
  computeNormalizedPowerW,
  computeTotalWorkJ,
  hasTrainingValues,
} from "./activity";
import type {
  TrackActivity,
  TrackActivityBestEfforts,
  TrackActivityMetadata,
  TrackActivityStatistics,
  TrackActivityTraining,
  TrackActivityTrainingSource,
  TrackDeviceInfo,
  TrackDurationBestEfforts,
  TrackJsonBbox,
  TrackJsonRcenter,
  TrackNumericStats,
  TrackPoint,
  TrackWarning,
} from "./activity";

export {
  STRAVA_POWER_CURVE_DURATIONS_SECONDS,
  computeHeartRateZoneSummary,
  computePowerZoneSummary,
  downsampleTrackActivity,
  getHeartRateZone,
  getPowerZone,
  mergeTrackActivities,
} from "./activity";
export type {
  DownsampleTrackOptions,
  MergeTrackActivitiesOptions,
  TrackActivity,
  TrackActivityBestEfforts,
  TrackActivityMetadata,
  TrackActivityStatistics,
  TrackActivityTraining,
  TrackActivityTrainingSource,
  TrackDataSource,
  TrackDeviceInfo,
  TrackDurationBestEfforts,
  TrackHeartRateZoneKey,
  TrackJsonBbox,
  TrackJsonRcenter,
  TrackHeartRateZoneSummary,
  TrackNumericStats,
  TrackPoint,
  TrackPowerZoneKey,
  TrackPowerZoneSummary,
  TrackWarning,
  TrackZoneSummary,
} from "./activity";

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
const FIT_EPOCH_UNIX_SECONDS = 631065600;
const LOCAL_TIME_OFFSET_LIMIT_SECONDS = 24 * 3600;

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

export type ParseFitOptions = {
  preferEnhancedFields?: boolean;
  includePausedRecords?: boolean;
  minPositionPoints?: number;
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

export type AddTrackJsonBboxOptions = {
  precision?: TrackJsonPrecisionOptions;
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

export function computeTrackJsonBbox(data: unknown): TrackJsonBbox | undefined {
  const bounds = createTrackJsonBounds();
  addTrackJsonObjectToBounds(bounds, data);
  return trackJsonBoundsToBbox(bounds);
}

export function computeTrackJsonRcenter(data: unknown): TrackJsonRcenter | undefined {
  const center = createTrackJsonRouteCenter();
  addTrackJsonObjectToRouteCenter(center, data);
  return trackJsonRouteCenterToRcenter(center);
}

export function addTrackJsonBbox(
  data: unknown,
  options: AddTrackJsonBboxOptions = {},
): unknown {
  if (!isObjectRecord(data)) {
    return data;
  }

  const bbox = computeTrackJsonBbox(data);
  const rcenter = computeTrackJsonRcenter(data);
  if (!bbox && !rcenter) {
    return data;
  }

  const precision = resolveTrackJsonPrecision(options.precision);
  const nextData: Record<string, unknown> = { ...data };

  if (bbox) {
    nextData.bbox = roundTrackJsonBbox(bbox, precision.coordinates);
  }

  if (rcenter) {
    nextData.rcenter = roundTrackJsonRcenter(rcenter, precision.coordinates);
  }

  return nextData;
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

  features.forEach((feature, featureIndex) => {
    const geometry = getRecordProperty(feature, "geometry");
    const coordinates = Array.isArray(geometry?.coordinates)
      ? geometry.coordinates
      : [];
    if (featureIndex > 0 && coordinates.length > 0 && points.length > 0) {
      points.push({});
    }

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

export function trackActivityToTrackJson(
  activity: TrackActivity,
  options: TrackJsonOptions = {},
): string {
  const geoPointSegments = splitTrackActivityPositionSegments(activity.points);
  const geoPoints = geoPointSegments.flat();

  if (geoPoints.length === 0) {
    throw new TrackJsonConversionError(
      "no_position_points",
      "Track activity does not contain positioned points.",
    );
  }

  const routeSegments = geoPointSegments.filter((segment) => segment.length >= 2);
  if (routeSegments.length === 0) {
    throw new TrackJsonConversionError(
      "not_enough_position_points",
      "At least two consecutive positioned points are required.",
    );
  }

  const precision = resolveTrackJsonPrecision(options.precision);
  const baseProperties = buildTrackJsonRouteProperties(activity, options, precision);

  const trackJson = {
    type: "FeatureCollection",
    bbox: buildTrackJsonBboxFromPoints(geoPoints, precision.coordinates),
    rcenter: buildTrackJsonRcenterFromPointSegments(
      routeSegments,
      precision.coordinates,
    ),
    features: routeSegments.map((segment) => ({
      type: "Feature",
      geometry: {
        type: "LineString",
        coordinates: segment.map((point) => [
          roundNumber(point.lon, precision.coordinates),
          roundNumber(point.lat, precision.coordinates),
        ]),
      },
      properties: buildTrackJsonSegmentProperties(
        baseProperties,
        segment,
        options,
        precision,
      ),
    })),
  };

  return JSON.stringify(trackJson, null, options.pretty ? 2 : 0);
}

function splitTrackActivityPositionSegments(
  points: TrackPoint[],
): (TrackPoint & { lat: number; lon: number })[][] {
  const segments: (TrackPoint & { lat: number; lon: number })[][] = [];
  let current: (TrackPoint & { lat: number; lon: number })[] = [];

  points.forEach((point) => {
    if (hasPosition(point)) {
      current.push(point);
      return;
    }

    if (current.length > 0) {
      segments.push(current);
      current = [];
    }
  });

  if (current.length > 0) {
    segments.push(current);
  }

  return segments;
}

function buildTrackJsonRouteProperties(
  activity: TrackActivity,
  options: TrackJsonOptions,
  precision: Required<TrackJsonPrecisionOptions>,
): Record<string, unknown> {
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

  return properties;
}

function buildTrackJsonSegmentProperties(
  baseProperties: Record<string, unknown>,
  segment: TrackPoint[],
  options: TrackJsonOptions,
  precision: Required<TrackJsonPrecisionOptions>,
): Record<string, unknown> {
  const properties: Record<string, unknown> = { ...baseProperties };
  const coordinateProperties = buildCoordinateProperties(segment, options, precision);

  if (Object.keys(coordinateProperties).length > 0) {
    properties.coordinateProperties = coordinateProperties;
  }

  return properties;
}

type TrackJsonBounds = {
  west?: number;
  south?: number;
  east?: number;
  north?: number;
};

type TrackJsonVector = {
  x: number;
  y: number;
  z: number;
};

type TrackJsonRouteCenter = {
  sumX: number;
  sumY: number;
  sumZ: number;
  totalLengthM: number;
  fallback?: TrackJsonRcenter;
};

function createTrackJsonBounds(): TrackJsonBounds {
  return {};
}

function createTrackJsonRouteCenter(): TrackJsonRouteCenter {
  return {
    sumX: 0,
    sumY: 0,
    sumZ: 0,
    totalLengthM: 0,
  };
}

function buildTrackJsonBboxFromPoints(
  points: (TrackPoint & { lat: number; lon: number })[],
  precision: number,
): TrackJsonBbox {
  const bounds = createTrackJsonBounds();

  points.forEach((point) => {
    addTrackJsonPositionToBounds(bounds, point.lon, point.lat);
  });

  const bbox = trackJsonBoundsToBbox(bounds);
  if (!bbox) {
    throw new TrackJsonConversionError(
      "no_position_points",
      "Track activity does not contain positioned points.",
    );
  }

  return roundTrackJsonBbox(bbox, precision);
}

function buildTrackJsonRcenterFromPointSegments(
  segments: (TrackPoint & { lat: number; lon: number })[][],
  precision: number,
): TrackJsonRcenter | undefined {
  const center = createTrackJsonRouteCenter();

  segments.forEach((segment) => {
    let previous: TrackJsonRcenter | undefined;

    segment.forEach((point) => {
      const position: TrackJsonRcenter = [point.lon, point.lat];
      setTrackJsonRouteCenterFallback(center, position);

      if (previous) {
        addTrackJsonRouteSegmentToCenter(center, previous, position);
      }

      previous = position;
    });
  });

  const rcenter = trackJsonRouteCenterToRcenter(center);
  return rcenter ? roundTrackJsonRcenter(rcenter, precision) : undefined;
}

function roundTrackJsonBbox(bbox: TrackJsonBbox, precision: number): TrackJsonBbox {
  return [
    roundNumber(bbox[0], precision),
    roundNumber(bbox[1], precision),
    roundNumber(bbox[2], precision),
    roundNumber(bbox[3], precision),
  ];
}

function roundTrackJsonRcenter(
  rcenter: TrackJsonRcenter,
  precision: number,
): TrackJsonRcenter {
  return [
    roundNumber(rcenter[0], precision),
    roundNumber(rcenter[1], precision),
  ];
}

function addTrackJsonObjectToBounds(bounds: TrackJsonBounds, value: unknown) {
  if (!isObjectRecord(value)) {
    return;
  }

  if (value.type === "FeatureCollection" && Array.isArray(value.features)) {
    value.features.forEach((feature) => {
      addTrackJsonObjectToBounds(bounds, feature);
    });
    return;
  }

  if (value.type === "Feature") {
    addTrackJsonGeometryToBounds(bounds, value.geometry);
    return;
  }

  addTrackJsonGeometryToBounds(bounds, value);
}

function addTrackJsonGeometryToBounds(bounds: TrackJsonBounds, geometry: unknown) {
  if (!isObjectRecord(geometry)) {
    return;
  }

  if (geometry.type === "GeometryCollection" && Array.isArray(geometry.geometries)) {
    geometry.geometries.forEach((child) => {
      addTrackJsonGeometryToBounds(bounds, child);
    });
    return;
  }

  addTrackJsonCoordinatesToBounds(bounds, geometry.coordinates);
}

function addTrackJsonCoordinatesToBounds(bounds: TrackJsonBounds, value: unknown) {
  if (!Array.isArray(value)) {
    return;
  }

  if (isTrackJsonPosition(value)) {
    addTrackJsonPositionToBounds(bounds, value[0], value[1]);
    return;
  }

  value.forEach((child) => {
    addTrackJsonCoordinatesToBounds(bounds, child);
  });
}

function isTrackJsonPosition(value: unknown[]): value is [number, number, ...unknown[]] {
  return value.length >= 2 && isFiniteNumber(value[0]) && isFiniteNumber(value[1]);
}

function addTrackJsonObjectToRouteCenter(
  center: TrackJsonRouteCenter,
  value: unknown,
) {
  if (!isObjectRecord(value)) {
    return;
  }

  if (value.type === "FeatureCollection" && Array.isArray(value.features)) {
    value.features.forEach((feature) => {
      addTrackJsonObjectToRouteCenter(center, feature);
    });
    return;
  }

  if (value.type === "Feature") {
    addTrackJsonGeometryToRouteCenter(center, value.geometry);
    return;
  }

  addTrackJsonGeometryToRouteCenter(center, value);
}

function addTrackJsonGeometryToRouteCenter(
  center: TrackJsonRouteCenter,
  geometry: unknown,
) {
  if (!isObjectRecord(geometry)) {
    return;
  }

  if (geometry.type === "GeometryCollection" && Array.isArray(geometry.geometries)) {
    geometry.geometries.forEach((child) => {
      addTrackJsonGeometryToRouteCenter(center, child);
    });
    return;
  }

  if (geometry.type === "LineString") {
    addTrackJsonLineStringToRouteCenter(center, geometry.coordinates);
    return;
  }

  if (geometry.type === "MultiLineString" && Array.isArray(geometry.coordinates)) {
    geometry.coordinates.forEach((lineString) => {
      addTrackJsonLineStringToRouteCenter(center, lineString);
    });
  }
}

function addTrackJsonLineStringToRouteCenter(
  center: TrackJsonRouteCenter,
  coordinates: unknown,
) {
  if (!Array.isArray(coordinates)) {
    return;
  }

  let previous: TrackJsonRcenter | undefined;

  coordinates.forEach((coordinate) => {
    if (!Array.isArray(coordinate) || !isTrackJsonPosition(coordinate)) {
      previous = undefined;
      return;
    }

    const position: TrackJsonRcenter = [coordinate[0], coordinate[1]];
    setTrackJsonRouteCenterFallback(center, position);

    if (previous) {
      addTrackJsonRouteSegmentToCenter(center, previous, position);
    }

    previous = position;
  });
}

function setTrackJsonRouteCenterFallback(
  center: TrackJsonRouteCenter,
  position: TrackJsonRcenter,
) {
  if (!center.fallback) {
    center.fallback = position;
  }
}

function addTrackJsonRouteSegmentToCenter(
  center: TrackJsonRouteCenter,
  start: TrackJsonRcenter,
  end: TrackJsonRcenter,
) {
  const lengthM = calculateCoordinateDistanceM(start, end);
  if (lengthM <= 0) {
    return;
  }

  const midpoint = calculateSphericalMidpointVector(start, end);
  center.sumX += midpoint.x * lengthM;
  center.sumY += midpoint.y * lengthM;
  center.sumZ += midpoint.z * lengthM;
  center.totalLengthM += lengthM;
}

function calculateCoordinateDistanceM(
  start: TrackJsonRcenter,
  end: TrackJsonRcenter,
): number {
  return calculateDistanceM(
    { lon: start[0], lat: start[1] },
    { lon: end[0], lat: end[1] },
  );
}

function trackJsonRouteCenterToRcenter(
  center: TrackJsonRouteCenter,
): TrackJsonRcenter | undefined {
  if (center.totalLengthM > 0) {
    return vectorToTrackJsonRcenter({
      x: center.sumX / center.totalLengthM,
      y: center.sumY / center.totalLengthM,
      z: center.sumZ / center.totalLengthM,
    }) ?? center.fallback;
  }

  return center.fallback;
}

function calculateSphericalMidpointVector(
  start: TrackJsonRcenter,
  end: TrackJsonRcenter,
): TrackJsonVector {
  const startVector = trackJsonRcenterToVector(start);
  const endVector = trackJsonRcenterToVector(end);
  return normalizeTrackJsonVector({
    x: startVector.x + endVector.x,
    y: startVector.y + endVector.y,
    z: startVector.z + endVector.z,
  }) ?? startVector;
}

function trackJsonRcenterToVector(position: TrackJsonRcenter): TrackJsonVector {
  const lonRad = degreesToRadians(position[0]);
  const latRad = degreesToRadians(position[1]);
  const cosLat = Math.cos(latRad);

  return {
    x: cosLat * Math.cos(lonRad),
    y: cosLat * Math.sin(lonRad),
    z: Math.sin(latRad),
  };
}

function vectorToTrackJsonRcenter(
  vector: TrackJsonVector,
): TrackJsonRcenter | undefined {
  const normalized = normalizeTrackJsonVector(vector);
  if (!normalized) {
    return undefined;
  }

  const lon = radiansToDegrees(Math.atan2(normalized.y, normalized.x));
  const lat = radiansToDegrees(
    Math.atan2(normalized.z, Math.hypot(normalized.x, normalized.y)),
  );
  return [lon, lat];
}

function normalizeTrackJsonVector(
  vector: TrackJsonVector,
): TrackJsonVector | undefined {
  const length = Math.hypot(vector.x, vector.y, vector.z);
  if (!Number.isFinite(length) || length <= 0) {
    return undefined;
  }

  return {
    x: vector.x / length,
    y: vector.y / length,
    z: vector.z / length,
  };
}

function degreesToRadians(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

function radiansToDegrees(radians: number): number {
  return (radians * 180) / Math.PI;
}

function addTrackJsonPositionToBounds(
  bounds: TrackJsonBounds,
  lon: number,
  lat: number,
) {
  if (!isFiniteNumber(lon) || !isFiniteNumber(lat)) {
    return;
  }

  bounds.west = typeof bounds.west === "number" ? Math.min(bounds.west, lon) : lon;
  bounds.south = typeof bounds.south === "number" ? Math.min(bounds.south, lat) : lat;
  bounds.east = typeof bounds.east === "number" ? Math.max(bounds.east, lon) : lon;
  bounds.north = typeof bounds.north === "number" ? Math.max(bounds.north, lat) : lat;
}

function trackJsonBoundsToBbox(bounds: TrackJsonBounds): TrackJsonBbox | undefined {
  if (
    typeof bounds.west !== "number" ||
    typeof bounds.south !== "number" ||
    typeof bounds.east !== "number" ||
    typeof bounds.north !== "number"
  ) {
    return undefined;
  }

  return [bounds.west, bounds.south, bounds.east, bounds.north];
}

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
    copyOptionalNumber(src, metadata, "endTime");
    copyOptionalNumber(src, metadata, "localTimeOffsetSeconds");
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
  assignMetadataInteger(output, "endTime", metadata.endTime);
  assignMetadataInteger(
    output,
    "localTimeOffsetSeconds",
    metadata.localTimeOffsetSeconds,
  );
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

  const activity = getMessageArray(messages, [
    "activityMesgs",
    "activityMessages",
    "activities",
    "activity",
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

  assignFitEndTime(metadata, session, points);

  if (activity) {
    assignNumber(
      metadata,
      "localTimeOffsetSeconds",
      getFitLocalTimeOffsetSeconds(activity),
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

function assignFitEndTime(
  metadata: TrackActivityMetadata,
  session: FitMessage | undefined,
  points: TrackPoint[],
) {
  if (isFiniteNumber(metadata.startTime) &&
      isFiniteNumber(metadata.totalElapsedTime)) {
    metadata.endTime = metadata.startTime + metadata.totalElapsedTime;
    return;
  }

  const sessionEndTime = session
    ? toUnixSeconds(getFirstValue(session, ["timestamp"]))
    : undefined;
  if (isFiniteNumber(sessionEndTime)) {
    metadata.endTime = sessionEndTime;
    return;
  }

  const times = points.map((point) => point.time).filter(isFiniteNumber);
  if (times.length > 0) {
    metadata.endTime = Math.max(...times);
  }
}

function getFitLocalTimeOffsetSeconds(message: FitMessage): number | undefined {
  const timestampValue = getFirstValue(message, ["timestamp"]);
  const localTimestampValue = getFirstValue(message, [
    "localTimestamp",
    "localTimeStamp",
    "local_timestamp",
  ]);
  const timestamps = getFitDateTimeCandidates(timestampValue);
  const localTimestamps = getFitDateTimeCandidates(localTimestampValue);

  for (const timestamp of timestamps) {
    for (const localTimestamp of localTimestamps) {
      const offset = Math.round(localTimestamp - timestamp);
      if (
        Number.isFinite(offset) &&
        Math.abs(offset) <= LOCAL_TIME_OFFSET_LIMIT_SECONDS
      ) {
        return offset;
      }
    }
  }

  return undefined;
}

function getFitDateTimeCandidates(value: unknown): number[] {
  const unwrapped = unwrapSingleValue(value);
  const candidates: number[] = [];

  if (unwrapped instanceof Date) {
    const millis = unwrapped.getTime();
    if (Number.isFinite(millis)) {
      candidates.push(Math.trunc(millis / 1000));
    }
    return candidates;
  }

  const numberValue = toFiniteNumber(unwrapped);
  if (typeof numberValue !== "number") {
    return candidates;
  }

  if (numberValue > 100000000000) {
    candidates.push(Math.trunc(numberValue / 1000));
    return candidates;
  }

  candidates.push(numberValue);
  candidates.push(numberValue + FIT_EPOCH_UNIX_SECONDS);
  return Array.from(new Set(candidates));
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
