import { Decoder, Stream } from "@garmin/fitsdk";
import {
  applyComputedMetadata,
  buildActivityAnalysisMetadata,
  buildActivityBestEfforts,
  buildActivityHistograms,
  buildActivityPedaling,
  buildActivityStatistics,
  calculateTrackAscentDescent,
  computeNormalizedPowerW,
  computeTotalWorkJ,
  hasTrainingValues,
} from "./activity";
import type {
  TrackActivity,
  TrackActivityAnalysisMetadata,
  TrackActivityBestEfforts,
  TrackActivityHistograms,
  TrackActivityMetadata,
  TrackHeartRateHistogram,
  TrackHeartRateHistogramBucket,
  TrackActivityPedaling,
  TrackActivityPedalingDynamics,
  TrackActivityLeftRightBalance,
  TrackActivityPedalingSidePercentages,
  TrackActivityPin,
  TrackActivityStatistics,
  TrackActivityTraining,
  TrackActivityTrainingSource,
  TrackCadenceHistogram,
  TrackCadenceHistogramBucket,
  TrackPowerHistogram,
  TrackPowerHistogramBucket,
  TrackSpeedHistogram,
  TrackSpeedHistogramBucket,
  TrackDeviceInfo,
  TrackDurationBestEfforts,
  TrackJsonBbox,
  TrackJsonPointOfInterest,
  TrackJsonPosition,
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
  trimTrackActivity,
} from "./activity";
export type {
  DownsampleTrackOptions,
  MergeTrackActivitiesOptions,
  TrimTrackActivityOptions,
  TrackActivity,
  TrackActivityAnalysisMetadata,
  TrackActivityBestEfforts,
  TrackActivityHistograms,
  TrackActivityMetadata,
  TrackActivityPedaling,
  TrackActivityPedalingDynamics,
  TrackActivityLeftRightBalance,
  TrackActivityPedalingSidePercentages,
  TrackActivityStatistics,
  TrackActivityTraining,
  TrackActivityTrainingSource,
  TrackCadenceHistogram,
  TrackCadenceHistogramBucket,
  TrackDataSource,
  TrackDeviceInfo,
  TrackDurationBestEfforts,
  TrackHeartRateZoneKey,
  TrackJsonBbox,
  TrackJsonPointOfInterest,
  TrackJsonPointOfInterestRole,
  TrackJsonPosition,
  TrackHeartRateZoneSummary,
  TrackHeartRateHistogram,
  TrackHeartRateHistogramBucket,
  TrackNumericStats,
  TrackPoint,
  TrackPowerHistogram,
  TrackPowerHistogramBucket,
  TrackSpeedHistogram,
  TrackSpeedHistogramBucket,
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
  altitudes: 1,
  heartRates: 1,
  cadences: 1,
  powers: 1,
  speeds: 1,
  metrics: 1,
  metadata: 1,
};
const TRACK_JSON_METRIC_METADATA_PRECISION = 3;
const FILL_FORWARD_METRIC_NAMES = new Set([
  "torqueEffectivenessPercentage",
  "pedalSmoothnessPercentage",
]);
const FIT_EPOCH_UNIX_SECONDS = 631065600;
const LOCAL_TIME_OFFSET_LIMIT_SECONDS = 24 * 3600;

const FIT_TORQUE_EFFECTIVENESS_KEYS: FitPedalingSideKeys = {
  left: [
    "avgLeftTorqueEffectiveness",
    "avg_left_torque_effectiveness",
    "leftTorqueEffectiveness",
    "left_torque_effectiveness",
  ],
  right: [
    "avgRightTorqueEffectiveness",
    "avg_right_torque_effectiveness",
    "rightTorqueEffectiveness",
    "right_torque_effectiveness",
  ],
  combined: [
    "avgTorqueEffectiveness",
    "avg_torque_effectiveness",
    "torqueEffectiveness",
    "torque_effectiveness",
  ],
};

const FIT_PEDAL_SMOOTHNESS_KEYS: FitPedalingSideKeys = {
  left: [
    "avgLeftPedalSmoothness",
    "avg_left_pedal_smoothness",
    "leftPedalSmoothness",
    "left_pedal_smoothness",
  ],
  right: [
    "avgRightPedalSmoothness",
    "avg_right_pedal_smoothness",
    "rightPedalSmoothness",
    "right_pedal_smoothness",
  ],
  combined: [
    "avgCombinedPedalSmoothness",
    "avg_combined_pedal_smoothness",
    "combinedPedalSmoothness",
    "combined_pedal_smoothness",
    "avgPedalSmoothness",
    "avg_pedal_smoothness",
    "pedalSmoothness",
    "pedal_smoothness",
  ],
};

const RESERVED_METRIC_NAMES = new Set([
  "times",
  "distances",
  "altitudes",
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

export type AddTrackJsonDerivedPropertiesOptions = {
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
  altitudes?: number;
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
  "no_position_points" | "not_enough_position_points" | "invalid_point_feature";

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

export function computeTrackJsonPoi(data: unknown): TrackJsonPointOfInterest[] {
  const route = createTrackJsonRouteAnalysis();
  addTrackJsonObjectToRouteAnalysis(route, data);
  return trackJsonRouteAnalysisToPoi(route);
}

export function addTrackJsonDerivedProperties(
  data: unknown,
  options: AddTrackJsonDerivedPropertiesOptions = {},
): unknown {
  if (!isObjectRecord(data)) {
    return data;
  }

  const precision = resolveTrackJsonPrecision(options.precision);
  const bbox = computeTrackJsonBbox(data);
  const poi = computeTrackJsonPoi(data);
  const nextData: Record<string, unknown> = { ...data };

  delete nextData.rcenter;
  delete nextData.poi;

  if (bbox) {
    nextData.bbox = roundTrackJsonBbox(bbox, precision.coordinates);
  }

  if (poi.length > 0) {
    nextData.poi = roundTrackJsonPoi(poi, precision.coordinates);
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
  const pins = getTrackJsonPointFeatures(data).map(trackJsonPointFeatureToPin);
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

  applyComputedMetadata(metadata, points, { preserveElevation: true });

  return {
    schemaVersion: 1,
    metadata,
    points,
    ...(pins.length > 0 ? { pins } : {}),
    warnings: [],
  };
}

export function trackActivityToTrackJson(
  activity: TrackActivity,
  options: TrackJsonOptions = {},
): string {
  const geoPointSegments = splitTrackActivityPositionSegments(activity.points);
  const geoPoints = geoPointSegments.flat();
  const pins = activity.pins || [];
  const bboxPoints = [
    ...geoPoints,
    ...pins.map((pin) => ({ lat: pin.lat, lon: pin.lon })),
  ];

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
    bbox: buildTrackJsonBboxFromPoints(bboxPoints, precision.coordinates),
    poi: buildTrackJsonPoiFromPointSegments(
      routeSegments,
      precision.coordinates,
    ),
    features: [
      ...routeSegments.map((segment) => ({
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
      ...pins.map((pin) => trackActivityPinToTrackJsonFeature(pin, precision.coordinates)),
    ],
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

function trackActivityPinToTrackJsonFeature(
  pin: TrackActivityPin,
  coordinatePrecision: number,
): Record<string, unknown> {
  const coordinates = [
    roundNumber(pin.lon, coordinatePrecision),
    roundNumber(pin.lat, coordinatePrecision),
  ];

  if (isFiniteNumber(pin.altitudeM)) {
    coordinates.push(roundNumber(pin.altitudeM, coordinatePrecision));
  }

  return {
    type: "Feature",
    geometry: {
      type: "Point",
      coordinates,
    },
    properties: pin.properties ? cloneJsonValue(pin.properties) : {},
  };
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

type TrackJsonRouteAnalysis = {
  centerSumX: number;
  centerSumY: number;
  centerSumZ: number;
  centerTotalLengthM: number;
  centerFallback?: TrackJsonPosition;
  start?: TrackJsonPosition;
  end?: TrackJsonPosition;
  furthest?: TrackJsonPosition;
  startVector?: TrackJsonVector;
  furthestChordSquared: number;
};

function createTrackJsonBounds(): TrackJsonBounds {
  return {};
}

function createTrackJsonRouteAnalysis(): TrackJsonRouteAnalysis {
  return {
    centerSumX: 0,
    centerSumY: 0,
    centerSumZ: 0,
    centerTotalLengthM: 0,
    furthestChordSquared: -1,
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

function buildTrackJsonPoiFromPointSegments(
  segments: (TrackPoint & { lat: number; lon: number })[][],
  precision: number,
): TrackJsonPointOfInterest[] {
  const route = createTrackJsonRouteAnalysis();

  segments.forEach((segment) => {
    let previous: TrackJsonPosition | undefined;

    segment.forEach((point) => {
      const position: TrackJsonPosition = [point.lon, point.lat];
      addTrackJsonPositionToRouteAnalysis(route, position);

      if (previous) {
        addTrackJsonRouteSegmentToAnalysis(route, previous, position);
      }

      previous = position;
    });
  });

  return roundTrackJsonPoi(trackJsonRouteAnalysisToPoi(route), precision);
}

function roundTrackJsonBbox(bbox: TrackJsonBbox, precision: number): TrackJsonBbox {
  return [
    roundNumber(bbox[0], precision),
    roundNumber(bbox[1], precision),
    roundNumber(bbox[2], precision),
    roundNumber(bbox[3], precision),
  ];
}

function roundTrackJsonPoi(
  poi: TrackJsonPointOfInterest[],
  precision: number,
): TrackJsonPointOfInterest[] {
  return poi.map((point) => ({
    role: point.role,
    coordinates: roundTrackJsonPosition(point.coordinates, precision),
  }));
}

function roundTrackJsonPosition(
  position: TrackJsonPosition,
  precision: number,
): TrackJsonPosition {
  return [
    roundNumber(position[0], precision),
    roundNumber(position[1], precision),
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

function addTrackJsonObjectToRouteAnalysis(
  route: TrackJsonRouteAnalysis,
  value: unknown,
) {
  if (!isObjectRecord(value)) {
    return;
  }

  if (value.type === "FeatureCollection" && Array.isArray(value.features)) {
    value.features.forEach((feature) => {
      addTrackJsonObjectToRouteAnalysis(route, feature);
    });
    return;
  }

  if (value.type === "Feature") {
    addTrackJsonGeometryToRouteAnalysis(route, value.geometry);
    return;
  }

  addTrackJsonGeometryToRouteAnalysis(route, value);
}

function addTrackJsonGeometryToRouteAnalysis(
  route: TrackJsonRouteAnalysis,
  geometry: unknown,
) {
  if (!isObjectRecord(geometry)) {
    return;
  }

  if (geometry.type === "GeometryCollection" && Array.isArray(geometry.geometries)) {
    geometry.geometries.forEach((child) => {
      addTrackJsonGeometryToRouteAnalysis(route, child);
    });
    return;
  }

  if (geometry.type === "LineString") {
    addTrackJsonLineStringToRouteAnalysis(route, geometry.coordinates);
    return;
  }

  if (geometry.type === "MultiLineString" && Array.isArray(geometry.coordinates)) {
    geometry.coordinates.forEach((lineString) => {
      addTrackJsonLineStringToRouteAnalysis(route, lineString);
    });
  }
}

function addTrackJsonLineStringToRouteAnalysis(
  route: TrackJsonRouteAnalysis,
  coordinates: unknown,
) {
  if (!Array.isArray(coordinates)) {
    return;
  }

  let previous: TrackJsonPosition | undefined;

  coordinates.forEach((coordinate) => {
    if (!Array.isArray(coordinate) || !isTrackJsonPosition(coordinate)) {
      previous = undefined;
      return;
    }

    const position: TrackJsonPosition = [coordinate[0], coordinate[1]];
    addTrackJsonPositionToRouteAnalysis(route, position);

    if (previous) {
      addTrackJsonRouteSegmentToAnalysis(route, previous, position);
    }

    previous = position;
  });
}

function addTrackJsonPositionToRouteAnalysis(
  route: TrackJsonRouteAnalysis,
  position: TrackJsonPosition,
) {
  const vector = trackJsonPositionToVector(position);

  if (!route.start) {
    route.start = position;
    route.startVector = vector;
    route.furthest = position;
    route.furthestChordSquared = 0;
  } else if (route.startVector) {
    const chordSquared = calculateSquaredVectorDistance(route.startVector, vector);
    if (chordSquared > route.furthestChordSquared) {
      route.furthest = position;
      route.furthestChordSquared = chordSquared;
    }
  }

  route.end = position;
  if (!route.centerFallback) {
    route.centerFallback = position;
  }
}

function addTrackJsonRouteSegmentToAnalysis(
  route: TrackJsonRouteAnalysis,
  start: TrackJsonPosition,
  end: TrackJsonPosition,
) {
  const lengthM = calculateCoordinateDistanceM(start, end);
  if (lengthM <= 0) {
    return;
  }

  const midpoint = calculateSphericalMidpointVector(start, end);
  route.centerSumX += midpoint.x * lengthM;
  route.centerSumY += midpoint.y * lengthM;
  route.centerSumZ += midpoint.z * lengthM;
  route.centerTotalLengthM += lengthM;
}

function calculateCoordinateDistanceM(
  start: TrackJsonPosition,
  end: TrackJsonPosition,
): number {
  return calculateDistanceM(
    { lon: start[0], lat: start[1] },
    { lon: end[0], lat: end[1] },
  );
}

function trackJsonRouteAnalysisToPoi(
  route: TrackJsonRouteAnalysis,
): TrackJsonPointOfInterest[] {
  if (!route.start || !route.end || !route.furthest) {
    return [];
  }

  const centroid = trackJsonRouteAnalysisToCentroid(route);
  if (!centroid) {
    return [];
  }

  return [
    { role: "start", coordinates: route.start },
    { role: "end", coordinates: route.end },
    { role: "centroid", coordinates: centroid },
    { role: "furthest", coordinates: route.furthest },
  ];
}

function trackJsonRouteAnalysisToCentroid(
  route: TrackJsonRouteAnalysis,
): TrackJsonPosition | undefined {
  if (route.centerTotalLengthM > 0) {
    return vectorToTrackJsonPosition({
      x: route.centerSumX / route.centerTotalLengthM,
      y: route.centerSumY / route.centerTotalLengthM,
      z: route.centerSumZ / route.centerTotalLengthM,
    }) ?? route.centerFallback;
  }

  return route.centerFallback;
}

function calculateSphericalMidpointVector(
  start: TrackJsonPosition,
  end: TrackJsonPosition,
): TrackJsonVector {
  const startVector = trackJsonPositionToVector(start);
  const endVector = trackJsonPositionToVector(end);
  return normalizeTrackJsonVector({
    x: startVector.x + endVector.x,
    y: startVector.y + endVector.y,
    z: startVector.z + endVector.z,
  }) ?? startVector;
}

function trackJsonPositionToVector(position: TrackJsonPosition): TrackJsonVector {
  const lonRad = degreesToRadians(position[0]);
  const latRad = degreesToRadians(position[1]);
  const cosLat = Math.cos(latRad);

  return {
    x: cosLat * Math.cos(lonRad),
    y: cosLat * Math.sin(lonRad),
    z: Math.sin(latRad),
  };
}

function vectorToTrackJsonPosition(
  vector: TrackJsonVector,
): TrackJsonPosition | undefined {
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

function calculateSquaredVectorDistance(
  left: TrackJsonVector,
  right: TrackJsonVector,
): number {
  const x = left.x - right.x;
  const y = left.y - right.y;
  const z = left.z - right.z;
  return x * x + y * y + z * z;
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

function getTrackJsonPointFeatures(data: unknown): FitMessage[] {
  if (!isObjectRecord(data)) {
    return [];
  }

  if (data.type === "Feature") {
    return isTrackJsonPointFeature(data) ? [data] : [];
  }

  if (data.type !== "FeatureCollection" || !Array.isArray(data.features)) {
    return [];
  }

  return data.features.filter(isTrackJsonPointFeature);
}

function isTrackJsonPointFeature(value: unknown): value is FitMessage {
  if (!isObjectRecord(value)) {
    return false;
  }

  const geometry = getRecordProperty(value, "geometry");
  return geometry?.type === "Point" && Array.isArray(geometry.coordinates);
}

function trackJsonPointFeatureToPin(feature: FitMessage): TrackActivityPin {
  const geometry = getRecordProperty(feature, "geometry");
  const coordinates = Array.isArray(geometry?.coordinates) ? geometry.coordinates : [];
  const lon = toFiniteNumber(coordinates[0]);
  const lat = toFiniteNumber(coordinates[1]);
  const altitudeM = toFiniteNumber(coordinates[2]);
  const properties = getRecordProperty(feature, "properties");

  if (!isFiniteNumber(lon) || !isFiniteNumber(lat)) {
    throw new TrackJsonConversionError(
      "invalid_point_feature",
      "TrackJSON Point Feature must contain finite lon/lat coordinates.",
    );
  }

  return {
    lat,
    lon,
    ...(isFiniteNumber(altitudeM) ? { altitudeM } : {}),
    ...(properties ? { properties: cloneJsonValue(properties) as Record<string, unknown> } : {}),
  };
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
    copyOptionalNumber(src, metadata, "ascentM");
    copyOptionalNumber(src, metadata, "descentM");

    const recordingDevice = getRecordProperty(src, "recordingDevice");
    if (recordingDevice) {
      metadata.recordingDevice = { ...recordingDevice } as TrackDeviceInfo;
    }

    if (Array.isArray(src.devices)) {
      metadata.devices = src.devices
        .filter(isObjectRecord)
        .map((device) => ({ ...device }) as TrackDeviceInfo);
    }

    metadata.analysis = readTrackJsonAnalysis(getRecordProperty(src, "analysis"));
    metadata.statistics = readTrackJsonStatistics(
      getRecordProperty(src, "statistics"),
    );
    metadata.training = readTrackJsonTraining(getRecordProperty(src, "training"));
    metadata.bestEfforts = readTrackJsonBestEfforts(
      getRecordProperty(src, "bestEfforts"),
    );
    metadata.histograms = readTrackJsonHistograms(
      getRecordProperty(src, "histograms"),
    );
    metadata.pedaling = readTrackJsonPedaling(getRecordProperty(src, "pedaling"));
    metadata.pedalingDynamics = readTrackJsonPedalingDynamics(
      getRecordProperty(src, "pedalingDynamics"),
    );
  }

  if (options.name) {
    metadata.name = options.name;
  }
  if (options.description) {
    metadata.description = options.description;
  }

  return metadata;
}

function readTrackJsonStatistics(
  value: Record<string, unknown> | undefined,
): TrackActivityStatistics | undefined {
  if (!value) {
    return undefined;
  }

  const statistics: TrackActivityStatistics = {};
  assignTrackJsonNumericStatsFromMetadata(statistics, value, "speedKph");
  assignTrackJsonNumericStatsFromMetadata(statistics, value, "cadenceRpm");
  assignTrackJsonNumericStatsFromMetadata(statistics, value, "heartRateBpm");
  assignTrackJsonNumericStatsFromMetadata(statistics, value, "powerW");
  assignTrackJsonNumericStatsFromMetadata(statistics, value, "temperatureC");

  return Object.keys(statistics).length > 0 ? statistics : undefined;
}

function assignTrackJsonNumericStatsFromMetadata(
  output: TrackActivityStatistics,
  src: Record<string, unknown>,
  key: keyof TrackActivityStatistics,
) {
  const stats = readTrackJsonNumericStats(getRecordProperty(src, key));
  if (stats) {
    output[key] = stats as never;
  }
}

function readTrackJsonNumericStats(
  value: Record<string, unknown> | undefined,
): TrackNumericStats | undefined {
  if (!value) {
    return undefined;
  }

  const stats: TrackNumericStats = {};
  assignOptionalNumber(stats, value, "mean");
  assignOptionalNumber(stats, value, "median");
  assignOptionalNumber(stats, value, "max");

  return Object.keys(stats).length > 0 ? stats : undefined;
}

function readTrackJsonAnalysis(
  value: Record<string, unknown> | undefined,
): TrackActivityAnalysisMetadata | undefined {
  if (!value) {
    return undefined;
  }

  const movingSpeedThresholdKph = toFiniteNumber(
    value.movingSpeedThresholdKph,
  );
  if (!isFiniteNumber(movingSpeedThresholdKph)) {
    return undefined;
  }

  return { movingSpeedThresholdKph };
}

function readTrackJsonTraining(
  value: Record<string, unknown> | undefined,
): TrackActivityTraining | undefined {
  if (!value) {
    return undefined;
  }

  const training: TrackActivityTraining = {};
  assignOptionalNumber(training, value, "normalizedPowerW");
  assignOptionalNumber(training, value, "totalWorkJ");
  assignOptionalNumber(training, value, "totalCaloriesCal");

  const sourceValue = getRecordProperty(value, "source");
  if (sourceValue) {
    const source: TrackActivityTrainingSource = {};
    copyOptionalString(sourceValue, source as never, "normalizedPower" as never);
    copyOptionalString(sourceValue, source as never, "totalWork" as never);
    copyOptionalString(sourceValue, source as never, "totalCalories" as never);
    if (Object.keys(source).length > 0) {
      training.source = source;
    }
  }

  return hasTrainingValues(training) ? training : undefined;
}


function readTrackJsonPedaling(
  value: Record<string, unknown> | undefined,
): TrackActivityPedaling | undefined {
  if (!value) {
    return undefined;
  }

  const pedaling: TrackActivityPedaling = {
    totalSeconds: 0,
  };
  assignOptionalNumber(pedaling, value, "totalSeconds");
  assignOptionalNumber(pedaling, value, "averageSpeedKph");
  assignOptionalNumber(pedaling, value, "averageCadenceRpm");
  assignOptionalNumber(pedaling, value, "averageHeartRateBpm");
  assignOptionalNumber(pedaling, value, "averagePowerW");
  assignOptionalNumber(pedaling, value, "normalizedPowerW");

  return pedaling.totalSeconds > 0 ? pedaling : undefined;
}

function readTrackJsonHistograms(
  value: Record<string, unknown> | undefined,
): TrackActivityHistograms | undefined {
  if (!value) {
    return undefined;
  }

  const histograms: TrackActivityHistograms = {};
  const speedKph = readTrackJsonSpeedHistogram(getRecordProperty(value, "speedKph"));
  if (speedKph) {
    histograms.speedKph = speedKph;
  }

  const cadenceRpm = readTrackJsonCadenceHistogram(
    getRecordProperty(value, "cadenceRpm"),
  );
  if (cadenceRpm) {
    histograms.cadenceRpm = cadenceRpm;
  }

  const powerW = readTrackJsonPowerHistogram(getRecordProperty(value, "powerW"));
  if (powerW) {
    histograms.powerW = powerW;
  }

  const heartRateBpm = readTrackJsonHeartRateHistogram(
    getRecordProperty(value, "heartRateBpm"),
  );
  if (heartRateBpm) {
    histograms.heartRateBpm = heartRateBpm;
  }

  return Object.keys(histograms).length > 0 ? histograms : undefined;
}

function readTrackJsonPowerHistogram(
  value: Record<string, unknown> | undefined,
): TrackPowerHistogram | undefined {
  if (!value) {
    return undefined;
  }

  const bucketSizeW = toFiniteNumber(value.bucketSizeW);
  const maxBucketW = toFiniteNumber(value.maxBucketW);
  const totalSeconds = toFiniteNumber(value.totalSeconds);
  const bucketsValue = value.buckets;

  if (
    !isFiniteNumber(bucketSizeW) ||
    bucketSizeW <= 0 ||
    !isFiniteNumber(maxBucketW) ||
    maxBucketW <= 0 ||
    !isFiniteNumber(totalSeconds) ||
    totalSeconds <= 0 ||
    !Array.isArray(bucketsValue)
  ) {
    return undefined;
  }

  const buckets = bucketsValue
    .map(readTrackJsonPowerHistogramBucket)
    .filter((bucket): bucket is TrackPowerHistogramBucket => Boolean(bucket));

  if (buckets.length === 0) {
    return undefined;
  }

  return {
    bucketSizeW,
    maxBucketW,
    totalSeconds,
    buckets,
  };
}

function readTrackJsonPowerHistogramBucket(
  value: unknown,
): TrackPowerHistogramBucket | undefined {
  return readTrackJsonHistogramBucket(value);
}

function readTrackJsonHistogramBucket(
  value: unknown,
): { label: string; seconds: number } | undefined {
  if (!isObjectRecord(value)) {
    return undefined;
  }

  const label = typeof value.label === "string" ? value.label.trim() : "";
  const seconds = toFiniteNumber(value.seconds);
  if (!label || !isFiniteNumber(seconds) || seconds < 0) {
    return undefined;
  }

  return { label, seconds };
}

function readTrackJsonSpeedHistogram(
  value: Record<string, unknown> | undefined,
): TrackSpeedHistogram | undefined {
  if (!value) {
    return undefined;
  }

  const bucketSizeKph = toFiniteNumber(value.bucketSizeKph);
  const maxBucketKph = toFiniteNumber(value.maxBucketKph);
  const totalSeconds = toFiniteNumber(value.totalSeconds);
  const bucketsValue = value.buckets;

  if (
    !isFiniteNumber(bucketSizeKph) ||
    bucketSizeKph <= 0 ||
    !isFiniteNumber(maxBucketKph) ||
    maxBucketKph <= 0 ||
    !isFiniteNumber(totalSeconds) ||
    totalSeconds <= 0 ||
    !Array.isArray(bucketsValue)
  ) {
    return undefined;
  }

  const buckets = bucketsValue
    .map(readTrackJsonHistogramBucket)
    .filter((bucket): bucket is TrackSpeedHistogramBucket => Boolean(bucket));

  if (buckets.length === 0) {
    return undefined;
  }

  return {
    bucketSizeKph,
    maxBucketKph,
    totalSeconds,
    buckets,
  };
}

function readTrackJsonCadenceHistogram(
  value: Record<string, unknown> | undefined,
): TrackCadenceHistogram | undefined {
  if (!value) {
    return undefined;
  }

  const bucketSizeRpm = toFiniteNumber(value.bucketSizeRpm);
  const maxBucketRpm = toFiniteNumber(value.maxBucketRpm);
  const totalSeconds = toFiniteNumber(value.totalSeconds);
  const bucketsValue = value.buckets;

  if (
    !isFiniteNumber(bucketSizeRpm) ||
    bucketSizeRpm <= 0 ||
    !isFiniteNumber(maxBucketRpm) ||
    maxBucketRpm <= 0 ||
    !isFiniteNumber(totalSeconds) ||
    totalSeconds <= 0 ||
    !Array.isArray(bucketsValue)
  ) {
    return undefined;
  }

  const buckets = bucketsValue
    .map(readTrackJsonHistogramBucket)
    .filter((bucket): bucket is TrackCadenceHistogramBucket => Boolean(bucket));

  if (buckets.length === 0) {
    return undefined;
  }

  return {
    bucketSizeRpm,
    maxBucketRpm,
    totalSeconds,
    buckets,
  };
}

function readTrackJsonHeartRateHistogram(
  value: Record<string, unknown> | undefined,
): TrackHeartRateHistogram | undefined {
  if (!value) {
    return undefined;
  }

  const bucketSizeBpm = toFiniteNumber(value.bucketSizeBpm);
  const firstBucketMaxBpm = toFiniteNumber(value.firstBucketMaxBpm);
  const maxBucketBpm = toFiniteNumber(value.maxBucketBpm);
  const totalSeconds = toFiniteNumber(value.totalSeconds);
  const bucketsValue = value.buckets;

  if (
    !isFiniteNumber(bucketSizeBpm) ||
    bucketSizeBpm <= 0 ||
    !isFiniteNumber(firstBucketMaxBpm) ||
    firstBucketMaxBpm <= 0 ||
    !isFiniteNumber(maxBucketBpm) ||
    maxBucketBpm <= firstBucketMaxBpm ||
    !isFiniteNumber(totalSeconds) ||
    totalSeconds <= 0 ||
    !Array.isArray(bucketsValue)
  ) {
    return undefined;
  }

  const buckets = bucketsValue
    .map(readTrackJsonHistogramBucket)
    .filter((bucket): bucket is TrackHeartRateHistogramBucket => Boolean(bucket));

  if (buckets.length === 0) {
    return undefined;
  }

  return {
    bucketSizeBpm,
    firstBucketMaxBpm,
    maxBucketBpm,
    totalSeconds,
    buckets,
  };
}

function readTrackJsonBestEfforts(
  value: Record<string, unknown> | undefined,
): TrackActivityBestEfforts | undefined {
  if (!value) {
    return undefined;
  }

  const bestEfforts: TrackActivityBestEfforts = {};
  const powerW = readTrackJsonDurationBestEfforts(getRecordProperty(value, "powerW"));
  if (powerW) {
    bestEfforts.powerW = powerW;
  }

  return Object.keys(bestEfforts).length > 0 ? bestEfforts : undefined;
}

function readTrackJsonDurationBestEfforts(
  value: Record<string, unknown> | undefined,
): TrackDurationBestEfforts | undefined {
  if (!value) {
    return undefined;
  }

  const efforts: TrackDurationBestEfforts = {};
  Object.keys(value).forEach((key) => {
    const durationSeconds = Number(key);
    const effort = toFiniteNumber(value[key]);
    if (Number.isFinite(durationSeconds) && durationSeconds > 0 && isFiniteNumber(effort)) {
      efforts[String(Math.round(durationSeconds))] = effort;
    }
  });

  return Object.keys(efforts).length > 0 ? efforts : undefined;
}

function assignOptionalNumber(
  output: Record<string, unknown>,
  src: Record<string, unknown>,
  key: string,
) {
  const value = toFiniteNumber(src[key]);
  if (isFiniteNumber(value)) {
    output[key] = value;
  }
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
    const altitude = toFiniteNumber(coordinate[2]);
    if (isFiniteNumber(lon)) {
      point.lon = lon;
    }
    if (isFiniteNumber(lat)) {
      point.lat = lat;
    }
    if (isFiniteNumber(altitude)) {
      point.altitudeM = altitude;
    }
  }

  if (!coordinateProperties) {
    return point;
  }

  assignPointFromSeries(point, "time", coordinateProperties.times, index);
  assignPointFromSeries(point, "distanceM", coordinateProperties.distances, index);
  assignPointFromSeries(point, "altitudeM", coordinateProperties.altitudes, index);
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
  assignMetadataNumber(output, "ascentM", metadata.ascentM, precision.metadata);
  assignMetadataNumber(output, "descentM", metadata.descentM, precision.metadata);

  const analysis = buildTrackJsonAnalysis(metadata.analysis);
  if (analysis) {
    output.analysis = analysis;
  }

  const statistics = buildTrackJsonStatistics(metadata.statistics);
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

  const histograms = buildTrackJsonHistograms(metadata.histograms, precision);
  if (histograms) {
    output.histograms = histograms;
  }

  const pedaling = buildTrackJsonPedaling(metadata.pedaling);
  if (pedaling) {
    output.pedaling = pedaling;
  }

  const pedalingDynamics = buildTrackJsonPedalingDynamics(
    metadata.pedalingDynamics,
  );
  if (pedalingDynamics) {
    output.pedalingDynamics = pedalingDynamics;
  }

  return Object.keys(output).length > 0 ? output : undefined;
}

function buildTrackJsonAnalysis(
  analysis: TrackActivityAnalysisMetadata | undefined,
): Record<string, unknown> | undefined {
  if (!analysis) {
    return undefined;
  }

  const output: Record<string, unknown> = {};
  assignMetadataNumber(
    output,
    "movingSpeedThresholdKph",
    analysis.movingSpeedThresholdKph,
    1,
  );
  return Object.keys(output).length > 0 ? output : undefined;
}

function readTrackJsonPedalingDynamics(
  value: Record<string, unknown> | undefined,
): TrackActivityPedalingDynamics | undefined {
  if (!value) {
    return undefined;
  }

  const dynamics: TrackActivityPedalingDynamics = {};
  const leftRightBalance = readTrackJsonLeftRightBalance(
    getRecordProperty(value, "leftRightBalance"),
  );
  if (leftRightBalance) {
    dynamics.leftRightBalance = leftRightBalance;
  }

  const torqueEffectiveness = readTrackJsonPedalingSidePercentages(
    getRecordProperty(value, "torqueEffectiveness"),
  );
  if (torqueEffectiveness) {
    dynamics.torqueEffectiveness = torqueEffectiveness;
  }

  const pedalSmoothness = readTrackJsonPedalingSidePercentages(
    getRecordProperty(value, "pedalSmoothness"),
  );
  if (pedalSmoothness) {
    dynamics.pedalSmoothness = pedalSmoothness;
  }

  return Object.keys(dynamics).length > 0 ? dynamics : undefined;
}

function readTrackJsonLeftRightBalance(
  value: Record<string, unknown> | undefined,
): TrackActivityLeftRightBalance | undefined {
  if (!value) {
    return undefined;
  }

  const balance: TrackActivityLeftRightBalance = {};
  assignOptionalNumber(balance, value, "leftPercentage");
  assignOptionalNumber(balance, value, "rightPercentage");
  return Object.keys(balance).length > 0 ? balance : undefined;
}

function readTrackJsonPedalingSidePercentages(
  value: Record<string, unknown> | undefined,
): TrackActivityPedalingSidePercentages | undefined {
  if (!value) {
    return undefined;
  }

  const percentages: TrackActivityPedalingSidePercentages = {};
  assignOptionalNumber(percentages, value, "leftPercentage");
  assignOptionalNumber(percentages, value, "rightPercentage");
  assignOptionalNumber(percentages, value, "combinedPercentage");
  return Object.keys(percentages).length > 0 ? percentages : undefined;
}

function buildTrackJsonStatistics(
  statistics: TrackActivityStatistics | undefined,
): Record<string, unknown> | undefined {
  if (!statistics) {
    return undefined;
  }

  const output: Record<string, unknown> = {};
  assignTrackJsonNumericStats(output, "speedKph", statistics.speedKph);
  assignTrackJsonNumericStats(output, "cadenceRpm", statistics.cadenceRpm);
  assignTrackJsonNumericStats(
    output,
    "heartRateBpm",
    statistics.heartRateBpm,
  );
  assignTrackJsonNumericStats(output, "powerW", statistics.powerW);
  assignTrackJsonNumericStats(
    output,
    "temperatureC",
    statistics.temperatureC,
  );

  return Object.keys(output).length > 0 ? output : undefined;
}

function assignTrackJsonNumericStats(
  output: Record<string, unknown>,
  key: string,
  stats: TrackNumericStats | undefined,
) {
  if (!stats) {
    return;
  }

  const values: Record<string, unknown> = {};
  assignMetadataNumber(values, "mean", stats.mean, TRACK_JSON_METRIC_METADATA_PRECISION);
  assignMetadataNumber(
    values,
    "median",
    stats.median,
    TRACK_JSON_METRIC_METADATA_PRECISION,
  );
  assignMetadataNumber(values, "max", stats.max, TRACK_JSON_METRIC_METADATA_PRECISION);

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


function buildTrackJsonPedaling(
  pedaling: TrackActivityPedaling | undefined,
): Record<string, unknown> | undefined {
  if (!pedaling || pedaling.totalSeconds <= 0) {
    return undefined;
  }

  const output: Record<string, unknown> = {};
  assignMetadataNumber(output, "totalSeconds", pedaling.totalSeconds, 0);
  assignMetadataNumber(
    output,
    "averageSpeedKph",
    pedaling.averageSpeedKph,
    TRACK_JSON_METRIC_METADATA_PRECISION,
  );
  assignMetadataNumber(
    output,
    "averageCadenceRpm",
    pedaling.averageCadenceRpm,
    TRACK_JSON_METRIC_METADATA_PRECISION,
  );
  assignMetadataNumber(
    output,
    "averageHeartRateBpm",
    pedaling.averageHeartRateBpm,
    TRACK_JSON_METRIC_METADATA_PRECISION,
  );
  assignMetadataNumber(
    output,
    "averagePowerW",
    pedaling.averagePowerW,
    TRACK_JSON_METRIC_METADATA_PRECISION,
  );
  assignMetadataNumber(
    output,
    "normalizedPowerW",
    pedaling.normalizedPowerW,
    TRACK_JSON_METRIC_METADATA_PRECISION,
  );

  return Object.keys(output).length > 0 ? output : undefined;
}

function buildTrackJsonPedalingDynamics(
  dynamics: TrackActivityPedalingDynamics | undefined,
): Record<string, unknown> | undefined {
  if (!dynamics) {
    return undefined;
  }

  const output: Record<string, unknown> = {};
  const leftRightBalance = buildTrackJsonLeftRightBalance(
    dynamics.leftRightBalance,
  );
  if (leftRightBalance) {
    output.leftRightBalance = leftRightBalance;
  }

  const torqueEffectiveness = buildTrackJsonPedalingSidePercentages(
    dynamics.torqueEffectiveness,
  );
  if (torqueEffectiveness) {
    output.torqueEffectiveness = torqueEffectiveness;
  }

  const pedalSmoothness = buildTrackJsonPedalingSidePercentages(
    dynamics.pedalSmoothness,
  );
  if (pedalSmoothness) {
    output.pedalSmoothness = pedalSmoothness;
  }

  return Object.keys(output).length > 0 ? output : undefined;
}

function buildTrackJsonLeftRightBalance(
  balance: TrackActivityLeftRightBalance | undefined,
): Record<string, unknown> | undefined {
  if (!balance) {
    return undefined;
  }

  const output: Record<string, unknown> = {};
  assignMetadataNumber(
    output,
    "leftPercentage",
    balance.leftPercentage,
    TRACK_JSON_METRIC_METADATA_PRECISION,
  );
  assignMetadataNumber(
    output,
    "rightPercentage",
    balance.rightPercentage,
    TRACK_JSON_METRIC_METADATA_PRECISION,
  );
  return Object.keys(output).length > 0 ? output : undefined;
}

function buildTrackJsonPedalingSidePercentages(
  percentages: TrackActivityPedalingSidePercentages | undefined,
): Record<string, unknown> | undefined {
  if (!percentages) {
    return undefined;
  }

  const output: Record<string, unknown> = {};
  assignMetadataNumber(
    output,
    "leftPercentage",
    percentages.leftPercentage,
    TRACK_JSON_METRIC_METADATA_PRECISION,
  );
  assignMetadataNumber(
    output,
    "rightPercentage",
    percentages.rightPercentage,
    TRACK_JSON_METRIC_METADATA_PRECISION,
  );
  assignMetadataNumber(
    output,
    "combinedPercentage",
    percentages.combinedPercentage,
    TRACK_JSON_METRIC_METADATA_PRECISION,
  );
  return Object.keys(output).length > 0 ? output : undefined;
}

function buildTrackJsonHistograms(
  histograms: TrackActivityHistograms | undefined,
  precision: Required<TrackJsonPrecisionOptions>,
): Record<string, unknown> | undefined {
  if (!histograms) {
    return undefined;
  }

  const output: Record<string, unknown> = {};
  const speedKph = buildTrackJsonSpeedHistogram(histograms.speedKph, precision);
  if (speedKph) {
    output.speedKph = speedKph;
  }

  const cadenceRpm = buildTrackJsonCadenceHistogram(
    histograms.cadenceRpm,
    precision,
  );
  if (cadenceRpm) {
    output.cadenceRpm = cadenceRpm;
  }

  const powerW = buildTrackJsonPowerHistogram(histograms.powerW, precision);
  if (powerW) {
    output.powerW = powerW;
  }

  const heartRateBpm = buildTrackJsonHeartRateHistogram(
    histograms.heartRateBpm,
    precision,
  );
  if (heartRateBpm) {
    output.heartRateBpm = heartRateBpm;
  }

  return Object.keys(output).length > 0 ? output : undefined;
}

function buildTrackJsonSpeedHistogram(
  histogram: TrackSpeedHistogram | undefined,
  precision: Required<TrackJsonPrecisionOptions>,
): Record<string, unknown> | undefined {
  if (!histogram || histogram.buckets.length === 0) {
    return undefined;
  }

  const buckets = buildTrackJsonHistogramBuckets(histogram.buckets, precision);
  if (buckets.length === 0) {
    return undefined;
  }

  return {
    bucketSizeKph: roundNumber(histogram.bucketSizeKph, precision.metadata),
    maxBucketKph: roundNumber(histogram.maxBucketKph, precision.metadata),
    totalSeconds: roundNumber(histogram.totalSeconds, precision.metadata),
    buckets,
  };
}

function buildTrackJsonCadenceHistogram(
  histogram: TrackCadenceHistogram | undefined,
  precision: Required<TrackJsonPrecisionOptions>,
): Record<string, unknown> | undefined {
  if (!histogram || histogram.buckets.length === 0) {
    return undefined;
  }

  const buckets = buildTrackJsonHistogramBuckets(histogram.buckets, precision);
  if (buckets.length === 0) {
    return undefined;
  }

  return {
    bucketSizeRpm: roundNumber(histogram.bucketSizeRpm, precision.metadata),
    maxBucketRpm: roundNumber(histogram.maxBucketRpm, precision.metadata),
    totalSeconds: roundNumber(histogram.totalSeconds, precision.metadata),
    buckets,
  };
}

function buildTrackJsonHistogramBuckets(
  buckets: Array<{ label: string; seconds: number }>,
  precision: Required<TrackJsonPrecisionOptions>,
): Array<{ label: string; seconds: number }> {
  return buckets
    .map((bucket) => {
      const seconds = roundNumber(bucket.seconds, precision.metadata);
      return bucket.label && seconds >= 0
        ? { label: bucket.label, seconds }
        : undefined;
    })
    .filter((bucket): bucket is { label: string; seconds: number } => Boolean(bucket));
}

function buildTrackJsonPowerHistogram(
  histogram: TrackPowerHistogram | undefined,
  precision: Required<TrackJsonPrecisionOptions>,
): Record<string, unknown> | undefined {
  if (!histogram || histogram.buckets.length === 0) {
    return undefined;
  }

  const buckets = histogram.buckets
    .map((bucket) => {
      const seconds = roundNumber(bucket.seconds, precision.metadata);
      return bucket.label && seconds > 0
        ? { label: bucket.label, seconds }
        : undefined;
    })
    .filter((bucket): bucket is { label: string; seconds: number } => Boolean(bucket));

  if (buckets.length === 0) {
    return undefined;
  }

  return {
    bucketSizeW: roundNumber(histogram.bucketSizeW, precision.metadata),
    maxBucketW: roundNumber(histogram.maxBucketW, precision.metadata),
    totalSeconds: roundNumber(histogram.totalSeconds, precision.metadata),
    buckets,
  };
}

function buildTrackJsonHeartRateHistogram(
  histogram: TrackHeartRateHistogram | undefined,
  precision: Required<TrackJsonPrecisionOptions>,
): Record<string, unknown> | undefined {
  if (!histogram || histogram.buckets.length === 0) {
    return undefined;
  }

  const buckets = buildTrackJsonHistogramBuckets(histogram.buckets, precision);

  if (buckets.length === 0) {
    return undefined;
  }

  return {
    bucketSizeBpm: roundNumber(histogram.bucketSizeBpm, precision.metadata),
    firstBucketMaxBpm: roundNumber(
      histogram.firstBucketMaxBpm,
      precision.metadata,
    ),
    maxBucketBpm: roundNumber(histogram.maxBucketBpm, precision.metadata),
    totalSeconds: roundNumber(histogram.totalSeconds, precision.metadata),
    buckets,
  };
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
    altitudes: normalizePrecision(
      precision?.altitudes,
      DEFAULT_TRACK_JSON_PRECISION.altitudes,
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
    assignNumber(
      metadata,
      "ascentM",
      toFiniteNumber(getFirstValue(session, ["totalAscent", "total_ascent"])),
    );
    assignNumber(
      metadata,
      "descentM",
      toFiniteNumber(getFirstValue(session, ["totalDescent", "total_descent"])),
    );
  }

  const elevation = calculateTrackAscentDescent(points);
  if (elevation) {
    if (!isFiniteNumber(metadata.ascentM)) {
      metadata.ascentM = elevation.ascentM;
    }
    if (!isFiniteNumber(metadata.descentM)) {
      metadata.descentM = elevation.descentM;
    }
  }

  assignFitEndTime(metadata, session, points);
  assignFitTimeFallbacks(metadata, points);

  if (activity) {
    assignNumber(
      metadata,
      "localTimeOffsetSeconds",
      getFitLocalTimeOffsetSeconds(activity),
    );
  }

  metadata.analysis = buildActivityAnalysisMetadata();

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

  const histograms = buildActivityHistograms(points);
  if (histograms) {
    metadata.histograms = histograms;
  }

  const pedaling = buildActivityPedaling(points);
  if (pedaling) {
    metadata.pedaling = pedaling;
  }

  const pedalingDynamics = buildFitPedalingDynamics(messages);
  if (pedalingDynamics) {
    metadata.pedalingDynamics = pedalingDynamics;
  }

  return metadata;
}

function assignFitTimeFallbacks(
  metadata: TrackActivityMetadata,
  points: TrackPoint[],
) {
  const times = points.map((point) => point.time).filter(isFiniteNumber);
  if (times.length === 0) {
    return;
  }

  if (!isFiniteNumber(metadata.startTime)) {
    metadata.startTime = Math.min(...times);
  }
  if (!isFiniteNumber(metadata.endTime)) {
    metadata.endTime = Math.max(...times);
  }
  if (
    !isFiniteNumber(metadata.totalElapsedTime) &&
    isFiniteNumber(metadata.startTime) &&
    isFiniteNumber(metadata.endTime)
  ) {
    metadata.totalElapsedTime = Math.max(0, metadata.endTime - metadata.startTime);
  }
  if (
    !isFiniteNumber(metadata.totalTimerTime) &&
    isFiniteNumber(metadata.totalElapsedTime)
  ) {
    metadata.totalTimerTime = metadata.totalElapsedTime;
  }
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

function buildFitPedalingDynamics(
  messages: FitMessages,
): TrackActivityPedalingDynamics | undefined {
  const summaryMessages = getSummaryMessages(messages);
  const records = getMessageArray(messages, [
    "recordMesgs",
    "recordMessages",
    "records",
    "record",
  ]);
  const dynamics: TrackActivityPedalingDynamics = {};

  const leftRightBalance = getFitLeftRightBalance(summaryMessages, records);
  if (leftRightBalance) {
    dynamics.leftRightBalance = leftRightBalance;
  }

  const torqueEffectiveness = getFitPedalingSidePercentages(
    summaryMessages,
    records,
    FIT_TORQUE_EFFECTIVENESS_KEYS,
  );
  if (torqueEffectiveness) {
    dynamics.torqueEffectiveness = torqueEffectiveness;
  }

  const pedalSmoothness = getFitPedalingSidePercentages(
    summaryMessages,
    records,
    FIT_PEDAL_SMOOTHNESS_KEYS,
  );
  if (pedalSmoothness) {
    dynamics.pedalSmoothness = pedalSmoothness;
  }

  return Object.keys(dynamics).length > 0 ? dynamics : undefined;
}

function getFitLeftRightBalance(
  summaryMessages: FitMessage[],
  records: FitMessage[],
): TrackActivityLeftRightBalance | undefined {
  const summaryValue = getFirstValueFromMessages(summaryMessages, [
    "avgLeftRightBalance",
    "avg_left_right_balance",
    "leftRightBalance",
    "left_right_balance",
  ]);
  const summaryBalance = normalizeLeftRightBalance(summaryValue);
  if (summaryBalance) {
    return summaryBalance;
  }

  const leftPercentages = records
    .map((record) => normalizeLeftRightBalance(
      getFirstValue(record, ["leftRightBalance", "left_right_balance"]),
    )?.leftPercentage)
    .filter(isFiniteNumber);
  const leftPercentage = mean(leftPercentages);
  return isFiniteNumber(leftPercentage)
    ? buildLeftRightBalance(leftPercentage)
    : undefined;
}

type FitPedalingSideKeys = {
  left: string[];
  right: string[];
  combined: string[];
};

function getFitPedalingSidePercentages(
  summaryMessages: FitMessage[],
  records: FitMessage[],
  keys: FitPedalingSideKeys,
): TrackActivityPedalingSidePercentages | undefined {
  const percentages: TrackActivityPedalingSidePercentages = {};

  const left = getFitSummaryOrRecordMean(summaryMessages, records, keys.left);
  if (isFiniteNumber(left)) {
    percentages.leftPercentage = left;
  }

  const right = getFitSummaryOrRecordMean(summaryMessages, records, keys.right);
  if (isFiniteNumber(right)) {
    percentages.rightPercentage = right;
  }

  const combined = getFitSummaryOrRecordMean(
    summaryMessages,
    records,
    keys.combined,
  );
  if (isFiniteNumber(combined)) {
    percentages.combinedPercentage = combined;
  }

  return Object.keys(percentages).length > 0 ? percentages : undefined;
}

function getFitRecordPedalingSidePercentage(
  record: FitMessage,
  keys: FitPedalingSideKeys,
): number | undefined {
  const combined = toFinitePercentage(getFirstValue(record, keys.combined));
  if (isFiniteNumber(combined)) {
    return combined;
  }

  const left = toFinitePercentage(getFirstValue(record, keys.left));
  const right = toFinitePercentage(getFirstValue(record, keys.right));
  if (isFiniteNumber(left) && isFiniteNumber(right)) {
    return roundNumber((left + right) / 2, 3);
  }
  return left ?? right;
}

function toFinitePercentage(value: unknown): number | undefined {
  const numberValue = toFiniteNumber(value);
  return isFiniteNumber(numberValue) && numberValue >= 0 && numberValue <= 100
    ? numberValue
    : undefined;
}

function getFitSummaryOrRecordMean(
  summaryMessages: FitMessage[],
  records: FitMessage[],
  keys: string[],
): number | undefined {
  const summaryValue = toFiniteNumber(getFirstValueFromMessages(summaryMessages, keys));
  if (isFiniteNumber(summaryValue)) {
    return summaryValue;
  }

  const values = records
    .map((record) => toFiniteNumber(getFirstValue(record, keys)))
    .filter(isFiniteNumber);
  return mean(values);
}

function normalizeLeftRightBalance(
  value: unknown,
): TrackActivityLeftRightBalance | undefined {
  const numberValue = toFiniteNumber(value);
  if (!isFiniteNumber(numberValue)) {
    return undefined;
  }

  const decoded = decodeFitLeftRightBalance(numberValue);
  if (!decoded || decoded.percentage < 0 || decoded.percentage > 100) {
    return undefined;
  }

  const rightPercentage = decoded.isRight
    ? decoded.percentage
    : 100 - decoded.percentage;
  const leftPercentage = 100 - rightPercentage;
  return buildLeftRightBalance(leftPercentage, rightPercentage);
}

function buildLeftRightBalance(
  leftPercentage: number,
  rightPercentage: number = 100 - leftPercentage,
): TrackActivityLeftRightBalance {
  return {
    leftPercentage: roundNumber(leftPercentage, 3),
    rightPercentage: roundNumber(rightPercentage, 3),
  };
}

function decodeFitLeftRightBalance(
  value: number,
): { percentage: number; isRight: boolean } | undefined {
  if (Number.isInteger(value) && value >= 256) {
    return {
      percentage: (value & 0x3fff) / 100,
      isRight: (value & 0x8000) !== 0,
    };
  }

  if (Number.isInteger(value) && value >= 128) {
    return {
      percentage: value & 0x7f,
      isRight: (value & 0x80) !== 0,
    };
  }

  if (value > 128 && value < 256) {
    return { percentage: value - 128, isRight: true };
  }

  return { percentage: value, isRight: false };
}

function mean(values: number[]): number | undefined {
  if (values.length === 0) {
    return undefined;
  }

  return values.reduce((sum, value) => sum + value, 0) / values.length;
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
    "altitudeM",
    selectAltitude(record, preferEnhancedFields),
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
  assignPointMetric(
    point,
    "torqueEffectivenessPercentage",
    getFitRecordPedalingSidePercentage(record, FIT_TORQUE_EFFECTIVENESS_KEYS),
  );
  assignPointMetric(
    point,
    "pedalSmoothnessPercentage",
    getFitRecordPedalingSidePercentage(record, FIT_PEDAL_SMOOTHNESS_KEYS),
  );

  return point;
}

function selectAltitude(
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
    getFirstValue(record, ["altitude", "elevation", "altitudeM"]),
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
    "altitudes",
    points,
    (point) => point.altitudeM,
    (value) => roundNumber(value, precision.altitudes),
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
      if (FILL_FORWARD_METRIC_NAMES.has(name)) {
        addFillForwardSeries(
          output,
          name,
          points,
          (point) => point.metrics?.[name],
          (value) => roundNumber(value, precision.metrics),
        );
        return;
      }

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

function assignPointMetric(
  point: TrackPoint,
  key: string,
  value: number | undefined,
) {
  if (!isFiniteNumber(value)) {
    return;
  }
  if (!point.metrics) {
    point.metrics = {};
  }
  point.metrics[key] = value;
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

function cloneJsonValue<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
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
const FIT_INVALID_UINT32 = 0xffffffff;
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

  const distanceRaw = distanceOffset === undefined
    ? undefined
    : readUint32(data, distanceOffset, definition.littleEndian);
  const distanceM = distanceRaw === undefined || distanceRaw === FIT_INVALID_UINT32
    ? undefined
    : distanceRaw / 100;

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

export type FitExportOptions = {
  manufacturer?: number;
  product?: number;
  serialNumber?: number;
  includeSessionSummary?: boolean;
};

export type FitExportErrorCode = "no_exportable_points";

export class FitExportError extends Error {
  public readonly code: FitExportErrorCode;

  constructor(code: FitExportErrorCode, message: string) {
    super(message);
    this.name = "FitExportError";
    this.code = code;
    Object.setPrototypeOf(this, FitExportError.prototype);
  }
}

type FitWriteFieldDefinition = {
  num: number;
  size: number;
  baseType: number;
};

type FitWriteRecordField = FitWriteFieldDefinition & {
  write: (
    view: DataView,
    offset: number,
    point: TrackPoint,
    fallbackTime: number
  ) => void;
};

const FIT_WRITE_CRC_TABLE = [
  0x0000,
  0xcc01,
  0xd801,
  0x1400,
  0xf001,
  0x3c00,
  0x2800,
  0xe401,
  0xa001,
  0x6c00,
  0x7800,
  0xb401,
  0x5000,
  0x9c01,
  0x8801,
  0x4400,
] as const;

export function trackActivityToFit(
  activity: TrackActivity,
  options: FitExportOptions = {},
): Uint8Array {
  const points = activity.points.filter(isFitExportablePoint);
  if (points.length === 0) {
    throw new FitExportError(
      "no_exportable_points",
      "Track activity does not contain points that can be exported as FIT.",
    );
  }

  const chunks: number[] = [];
  const startTime = getFitExportActivityStartTime(activity, points);

  writeFitDefinitionMessage(chunks, 0, 0, getFitFileIdFields(options));
  writeFitFileIdMessage(chunks, startTime, options);
  writeFitDefinitionMessage(chunks, 1, 20, getFitExportRecordFields());
  points.forEach((point, index) => {
    writeFitRecordMessage(chunks, point, index, startTime);
  });

  if (options.includeSessionSummary !== false) {
    writeFitDefinitionMessage(chunks, 2, 19, getFitLapFields());
    writeFitLapMessage(chunks, activity, points);
    writeFitDefinitionMessage(chunks, 3, 18, getFitSessionFields());
    writeFitSessionMessage(chunks, activity, points);
    writeFitDefinitionMessage(chunks, 4, 34, getFitActivityFields());
    writeFitActivityMessage(chunks, activity, points);
  }

  return buildFitFile(chunks);
}

function isFitExportablePoint(point: TrackPoint): boolean {
  return hasPosition(point) || isFiniteNumber(point.time);
}

function getFitFileIdFields(options: FitExportOptions): FitWriteFieldDefinition[] {
  const fields: FitWriteFieldDefinition[] = [
    { num: 0, size: 1, baseType: 0x00 },
    { num: 4, size: 4, baseType: 0x86 },
  ];

  if (isFiniteNumber(options.manufacturer)) {
    fields.push({ num: 1, size: 2, baseType: 0x84 });
  }
  if (isFiniteNumber(options.product)) {
    fields.push({ num: 2, size: 2, baseType: 0x84 });
  }
  if (isFiniteNumber(options.serialNumber)) {
    fields.push({ num: 3, size: 4, baseType: 0x8c });
  }

  return fields;
}

function writeFitFileIdMessage(
  chunks: number[],
  startTime: number,
  options: FitExportOptions,
) {
  chunks.push(0);
  chunks.push(4);
  fitPushUint32(chunks, unixTimeToFitTime(startTime));

  if (isFiniteNumber(options.manufacturer)) {
    fitPushUint16(chunks, options.manufacturer);
  }
  if (isFiniteNumber(options.product)) {
    fitPushUint16(chunks, options.product);
  }
  if (isFiniteNumber(options.serialNumber)) {
    fitPushUint32(chunks, options.serialNumber);
  }
}

function getFitExportRecordFields(): FitWriteRecordField[] {
  return [
    {
      num: 253,
      size: 4,
      baseType: 0x86,
      write: (view, offset, _point, fallbackTime) => {
        view.setUint32(offset, fallbackTime, true);
      },
    },
    {
      num: 0,
      size: 4,
      baseType: 0x85,
      write: (view, offset, point) => writeFitSemicircles(view, offset, point.lat),
    },
    {
      num: 1,
      size: 4,
      baseType: 0x85,
      write: (view, offset, point) => writeFitSemicircles(view, offset, point.lon),
    },
    {
      num: 2,
      size: 2,
      baseType: 0x84,
      write: (view, offset, point) => {
        writeFitScaledUint16(view, offset, point.altitudeM, 5, 500);
      },
    },
    {
      num: 5,
      size: 4,
      baseType: 0x86,
      write: (view, offset, point) => {
        writeFitScaledUint32(view, offset, point.distanceM, 100, 0);
      },
    },
    {
      num: 6,
      size: 2,
      baseType: 0x84,
      write: (view, offset, point) => {
        writeFitScaledUint16(view, offset, point.speedMps, 1000, 0);
      },
    },
    {
      num: 3,
      size: 1,
      baseType: 0x02,
      write: (view, offset, point) => writeFitUint8(view, offset, point.heartRateBpm),
    },
    {
      num: 4,
      size: 1,
      baseType: 0x02,
      write: (view, offset, point) => writeFitUint8(view, offset, point.cadenceRpm),
    },
    {
      num: 7,
      size: 2,
      baseType: 0x84,
      write: (view, offset, point) => writeFitUint16(view, offset, point.powerW),
    },
    {
      num: 13,
      size: 1,
      baseType: 0x01,
      write: (view, offset, point) => writeFitSint8(view, offset, point.temperatureC),
    },
  ];
}

function writeFitRecordMessage(
  chunks: number[],
  point: TrackPoint,
  index: number,
  activityStartTime: number,
) {
  const fields = getFitExportRecordFields();
  const size = fields.reduce((sum, field) => sum + field.size, 0);
  const record = new Uint8Array(size);
  const view = new DataView(record.buffer);
  const fallbackTime = getPointFitTimestamp(point, index, activityStartTime);
  let offset = 0;

  fields.forEach((field) => {
    field.write(view, offset, point, fallbackTime);
    offset += field.size;
  });

  chunks.push(1);
  chunks.push(...record);
}

function getFitLapFields(): FitWriteFieldDefinition[] {
  return [
    { num: 253, size: 4, baseType: 0x86 },
    { num: 2, size: 4, baseType: 0x86 },
    { num: 7, size: 4, baseType: 0x86 },
    { num: 8, size: 4, baseType: 0x86 },
    { num: 9, size: 4, baseType: 0x86 },
    { num: 11, size: 2, baseType: 0x84 },
    { num: 13, size: 2, baseType: 0x84 },
    { num: 14, size: 2, baseType: 0x84 },
    { num: 15, size: 1, baseType: 0x02 },
    { num: 16, size: 1, baseType: 0x02 },
    { num: 17, size: 1, baseType: 0x02 },
    { num: 18, size: 1, baseType: 0x02 },
    { num: 19, size: 2, baseType: 0x84 },
    { num: 20, size: 2, baseType: 0x84 },
    { num: 25, size: 1, baseType: 0x00 },
  ];
}

function writeFitLapMessage(chunks: number[], activity: TrackActivity, points: TrackPoint[]) {
  const summary = buildFitExportSummary(activity, points);
  const record = new Uint8Array(35);
  const view = new DataView(record.buffer);
  let offset = 0;

  view.setUint32(offset, unixTimeToFitTime(summary.endTime), true);
  offset += 4;
  view.setUint32(offset, unixTimeToFitTime(summary.startTime), true);
  offset += 4;
  writeFitScaledUint32Value(view, offset, summary.elapsedTime, 1000);
  offset += 4;
  writeFitScaledUint32Value(view, offset, summary.timerTime, 1000);
  offset += 4;
  writeFitScaledUint32Value(view, offset, summary.distanceM, 100);
  offset += 4;
  writeFitUint16(view, offset, getFitExportKilocalories(summary.totalCaloriesCal));
  offset += 2;
  writeFitScaledUint16(view, offset, summary.avgSpeedMps, 1000, 0);
  offset += 2;
  writeFitScaledUint16(view, offset, summary.maxSpeedMps, 1000, 0);
  offset += 2;
  writeFitUint8(view, offset, summary.avgHeartRateBpm);
  offset += 1;
  writeFitUint8(view, offset, summary.maxHeartRateBpm);
  offset += 1;
  writeFitUint8(view, offset, summary.avgCadenceRpm);
  offset += 1;
  writeFitUint8(view, offset, summary.maxCadenceRpm);
  offset += 1;
  writeFitUint16(view, offset, summary.avgPowerW);
  offset += 2;
  writeFitUint16(view, offset, summary.maxPowerW);
  offset += 2;
  view.setUint8(offset, getFitSport(activity));

  chunks.push(2);
  chunks.push(...record);
}

function getFitSessionFields(): FitWriteFieldDefinition[] {
  return [
    { num: 253, size: 4, baseType: 0x86 },
    { num: 2, size: 4, baseType: 0x86 },
    { num: 7, size: 4, baseType: 0x86 },
    { num: 8, size: 4, baseType: 0x86 },
    { num: 9, size: 4, baseType: 0x86 },
    { num: 11, size: 2, baseType: 0x84 },
    { num: 14, size: 2, baseType: 0x84 },
    { num: 15, size: 2, baseType: 0x84 },
    { num: 16, size: 1, baseType: 0x02 },
    { num: 17, size: 1, baseType: 0x02 },
    { num: 18, size: 1, baseType: 0x02 },
    { num: 19, size: 1, baseType: 0x02 },
    { num: 20, size: 2, baseType: 0x84 },
    { num: 21, size: 2, baseType: 0x84 },
    { num: 5, size: 1, baseType: 0x00 },
  ];
}

function writeFitSessionMessage(
  chunks: number[],
  activity: TrackActivity,
  points: TrackPoint[],
) {
  const summary = buildFitExportSummary(activity, points);
  const record = new Uint8Array(35);
  const view = new DataView(record.buffer);
  let offset = 0;

  view.setUint32(offset, unixTimeToFitTime(summary.endTime), true);
  offset += 4;
  view.setUint32(offset, unixTimeToFitTime(summary.startTime), true);
  offset += 4;
  writeFitScaledUint32Value(view, offset, summary.elapsedTime, 1000);
  offset += 4;
  writeFitScaledUint32Value(view, offset, summary.timerTime, 1000);
  offset += 4;
  writeFitScaledUint32Value(view, offset, summary.distanceM, 100);
  offset += 4;
  writeFitUint16(view, offset, getFitExportKilocalories(summary.totalCaloriesCal));
  offset += 2;
  writeFitScaledUint16(view, offset, summary.avgSpeedMps, 1000, 0);
  offset += 2;
  writeFitScaledUint16(view, offset, summary.maxSpeedMps, 1000, 0);
  offset += 2;
  writeFitUint8(view, offset, summary.avgHeartRateBpm);
  offset += 1;
  writeFitUint8(view, offset, summary.maxHeartRateBpm);
  offset += 1;
  writeFitUint8(view, offset, summary.avgCadenceRpm);
  offset += 1;
  writeFitUint8(view, offset, summary.maxCadenceRpm);
  offset += 1;
  writeFitUint16(view, offset, summary.avgPowerW);
  offset += 2;
  writeFitUint16(view, offset, summary.maxPowerW);
  offset += 2;
  view.setUint8(offset, getFitSport(activity));

  chunks.push(3);
  chunks.push(...record);
}

function getFitActivityFields(): FitWriteFieldDefinition[] {
  return [
    { num: 253, size: 4, baseType: 0x86 },
    { num: 0, size: 4, baseType: 0x86 },
    { num: 1, size: 2, baseType: 0x84 },
    { num: 2, size: 1, baseType: 0x00 },
    { num: 3, size: 1, baseType: 0x00 },
    { num: 4, size: 1, baseType: 0x00 },
  ];
}

function writeFitActivityMessage(
  chunks: number[],
  activity: TrackActivity,
  points: TrackPoint[],
) {
  const summary = buildFitExportSummary(activity, points);
  const record = new Uint8Array(13);
  const view = new DataView(record.buffer);
  let offset = 0;

  view.setUint32(offset, unixTimeToFitTime(summary.endTime), true);
  offset += 4;
  writeFitScaledUint32Value(view, offset, summary.timerTime, 1000);
  offset += 4;
  view.setUint16(offset, 1, true);
  offset += 2;
  view.setUint8(offset, 0);
  offset += 1;
  view.setUint8(offset, 26);
  offset += 1;
  view.setUint8(offset, 1);

  chunks.push(4);
  chunks.push(...record);
}

type FitExportSummary = {
  startTime: number;
  endTime: number;
  elapsedTime: number;
  timerTime: number;
  distanceM?: number;
  avgSpeedMps?: number;
  maxSpeedMps?: number;
  avgHeartRateBpm?: number;
  maxHeartRateBpm?: number;
  avgCadenceRpm?: number;
  maxCadenceRpm?: number;
  avgPowerW?: number;
  maxPowerW?: number;
  totalCaloriesCal?: number;
};

function buildFitExportSummary(
  activity: TrackActivity,
  points: TrackPoint[],
): FitExportSummary {
  const startTime = getFitExportActivityStartTime(activity, points);
  const endTime = getFitExportActivityEndTime(activity, points, startTime);
  const elapsedTime = getFiniteMetadataNumber(activity.metadata.totalElapsedTime) ??
    Math.max(0, endTime - startTime);
  const timerTime = getFiniteMetadataNumber(activity.metadata.totalTimerTime) ?? elapsedTime;
  const distanceM = getFiniteMetadataNumber(activity.metadata.totalDistanceM) ??
    getFitExportDistance(points);
  const speeds = points.map((point) => point.speedMps).filter(isFiniteNumber);
  const heartRates = points.map((point) => point.heartRateBpm).filter(isFiniteNumber);
  const cadences = points.map((point) => point.cadenceRpm).filter(isFiniteNumber);
  const powers = points.map((point) => point.powerW).filter(isFiniteNumber);

  return {
    startTime,
    endTime,
    elapsedTime,
    timerTime,
    distanceM,
    avgSpeedMps: averageFiniteNumbers(speeds),
    maxSpeedMps: maxFiniteNumbers(speeds),
    avgHeartRateBpm: averageFiniteNumbers(heartRates),
    maxHeartRateBpm: maxFiniteNumbers(heartRates),
    avgCadenceRpm: averageFiniteNumbers(cadences),
    maxCadenceRpm: maxFiniteNumbers(cadences),
    avgPowerW: averageFiniteNumbers(powers),
    maxPowerW: maxFiniteNumbers(powers),
    totalCaloriesCal: getFiniteMetadataNumber(
      activity.metadata.training?.totalCaloriesCal,
    ),
  };
}

function getFitExportActivityStartTime(
  activity: TrackActivity,
  points: TrackPoint[],
): number {
  const metadataStartTime = getFiniteMetadataNumber(activity.metadata.startTime);
  if (isFiniteNumber(metadataStartTime)) {
    return metadataStartTime;
  }

  const times = points.map((point) => point.time).filter(isFiniteNumber);
  return times.length > 0 ? Math.min(...times) : Math.floor(Date.now() / 1000);
}

function getFitExportActivityEndTime(
  activity: TrackActivity,
  points: TrackPoint[],
  startTime: number,
): number {
  const metadataEndTime = getFiniteMetadataNumber(activity.metadata.endTime);
  if (isFiniteNumber(metadataEndTime)) {
    return metadataEndTime;
  }

  const times = points.map((point) => point.time).filter(isFiniteNumber);
  return times.length > 0 ? Math.max(...times) : startTime + Math.max(0, points.length - 1);
}

function getFitExportDistance(points: TrackPoint[]): number | undefined {
  const distances = points.map((point) => point.distanceM).filter(isFiniteNumber);
  if (distances.length === 0) {
    return undefined;
  }

  return Math.max(...distances) - Math.min(...distances);
}

function getFitExportKilocalories(totalCaloriesCal: number | undefined): number | undefined {
  return isFiniteNumber(totalCaloriesCal) ? totalCaloriesCal / 1000 : undefined;
}

function getFitSport(activity: TrackActivity): number {
  const sport = activity.metadata.sport?.toLowerCase();
  if (sport === "cycling" || sport === "bike" || sport === "biking") {
    return 2;
  }
  if (sport === "running" || sport === "run") {
    return 1;
  }
  if (sport === "swimming" || sport === "swim") {
    return 5;
  }
  return 2;
}

function getFiniteMetadataNumber(value: unknown): number | undefined {
  return isFiniteNumber(value) ? value : undefined;
}

function averageFiniteNumbers(values: number[]): number | undefined {
  if (values.length === 0) {
    return undefined;
  }

  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function maxFiniteNumbers(values: number[]): number | undefined {
  return values.length > 0 ? Math.max(...values) : undefined;
}

function getPointFitTimestamp(
  point: TrackPoint,
  index: number,
  activityStartTime: number,
): number {
  const time = isFiniteNumber(point.time)
    ? getAbsoluteFitPointTime(point.time, activityStartTime)
    : activityStartTime + index;
  return unixTimeToFitTime(time);
}

function getAbsoluteFitPointTime(pointTime: number, activityStartTime: number): number {
  if (activityStartTime >= 100000000 && pointTime < 100000000) {
    return activityStartTime + pointTime;
  }
  return pointTime;
}

function unixTimeToFitTime(unixTimeSeconds: number): number {
  return Math.max(0, Math.round(unixTimeSeconds - FIT_EPOCH_UNIX_SECONDS));
}

function writeFitDefinitionMessage(
  chunks: number[],
  localMessageType: number,
  globalMessageNumber: number,
  fields: FitWriteFieldDefinition[],
) {
  chunks.push(0x40 | localMessageType);
  chunks.push(0);
  chunks.push(0);
  fitPushUint16(chunks, globalMessageNumber);
  chunks.push(fields.length);

  fields.forEach((field) => {
    chunks.push(field.num);
    chunks.push(field.size);
    chunks.push(field.baseType);
  });
}

function buildFitFile(chunks: number[]): Uint8Array {
  const data = new Uint8Array(chunks);
  const header = new Uint8Array(14);
  const headerView = new DataView(header.buffer);
  header[0] = 14;
  header[1] = 16;
  headerView.setUint16(2, 2135, true);
  headerView.setUint32(4, data.length, true);
  header[8] = 0x2e;
  header[9] = 0x46;
  header[10] = 0x49;
  header[11] = 0x54;
  const headerCrc = calculateFitWriteCrc(header.subarray(0, 12));
  headerView.setUint16(12, headerCrc, true);

  const body = new Uint8Array(header.length + data.length + 2);
  body.set(header, 0);
  body.set(data, header.length);
  const fileCrc = calculateFitWriteCrc(body.subarray(0, header.length + data.length));
  new DataView(body.buffer).setUint16(header.length + data.length, fileCrc, true);
  return body;
}

function writeFitSemicircles(
  view: DataView,
  offset: number,
  degrees: number | undefined,
) {
  if (!isFiniteNumber(degrees)) {
    view.setInt32(offset, 0x7fffffff, true);
    return;
  }
  view.setInt32(offset, Math.round((degrees * 0x80000000) / 180), true);
}

function writeFitScaledUint32(
  view: DataView,
  offset: number,
  value: number | undefined,
  scale: number,
  offsetValue: number,
) {
  if (!isFiniteNumber(value)) {
    view.setUint32(offset, 0xffffffff, true);
    return;
  }
  view.setUint32(offset, Math.max(0, Math.round((value + offsetValue) * scale)), true);
}

function writeFitScaledUint32Value(
  view: DataView,
  offset: number,
  value: number | undefined,
  scale: number,
) {
  if (!isFiniteNumber(value)) {
    view.setUint32(offset, 0xffffffff, true);
    return;
  }
  view.setUint32(offset, Math.max(0, Math.round(value * scale)), true);
}

function writeFitScaledUint16(
  view: DataView,
  offset: number,
  value: number | undefined,
  scale: number,
  offsetValue: number,
) {
  if (!isFiniteNumber(value)) {
    view.setUint16(offset, 0xffff, true);
    return;
  }
  view.setUint16(offset, Math.max(0, Math.round((value + offsetValue) * scale)), true);
}

function writeFitUint16(view: DataView, offset: number, value: number | undefined) {
  if (!isFiniteNumber(value)) {
    view.setUint16(offset, 0xffff, true);
    return;
  }
  view.setUint16(offset, Math.max(0, Math.round(value)), true);
}

function writeFitUint8(view: DataView, offset: number, value: number | undefined) {
  if (!isFiniteNumber(value)) {
    view.setUint8(offset, 0xff);
    return;
  }
  view.setUint8(offset, Math.max(0, Math.min(254, Math.round(value))));
}

function writeFitSint8(view: DataView, offset: number, value: number | undefined) {
  if (!isFiniteNumber(value)) {
    view.setInt8(offset, 0x7f);
    return;
  }
  view.setInt8(offset, Math.max(-127, Math.min(126, Math.round(value))));
}

function fitPushUint16(chunks: number[], value: number) {
  chunks.push(value & 0xff, (value >>> 8) & 0xff);
}

function fitPushUint32(chunks: number[], value: number) {
  chunks.push(
    value & 0xff,
    (value >>> 8) & 0xff,
    (value >>> 16) & 0xff,
    (value >>> 24) & 0xff,
  );
}

function calculateFitWriteCrc(bytes: Uint8Array): number {
  let crc = 0;

  bytes.forEach((byte) => {
    let tmp = FIT_WRITE_CRC_TABLE[crc & 0x0f];
    crc = (crc >> 4) & 0x0fff;
    crc = crc ^ tmp ^ FIT_WRITE_CRC_TABLE[byte & 0x0f];

    tmp = FIT_WRITE_CRC_TABLE[crc & 0x0f];
    crc = (crc >> 4) & 0x0fff;
    crc = crc ^ tmp ^ FIT_WRITE_CRC_TABLE[(byte >> 4) & 0x0f];
  });

  return crc & 0xffff;
}

