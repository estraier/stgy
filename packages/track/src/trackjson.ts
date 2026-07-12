import type {
  TrackJsonPointOfInterest,
  TrackJsonPointOfInterestRole,
  TrackJsonPosition,
} from "./activity";

export type {
  TrackJsonPointOfInterest,
  TrackJsonPointOfInterestRole,
  TrackJsonPosition,
} from "./activity";

export type TrackJsonDownsampleStrategy = "uniform" | "aggregate";

export type TrackJsonDownsampleOptions = {
  maxPoints: number;
  strategy?: TrackJsonDownsampleStrategy;
  preserveEndpoints?: boolean;
};

export type TrackJsonPrivacyObfuscationOptions = {
  startDistanceM?: number;
  endDistanceM?: number;
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

type TrackJsonDownsampleRange = {
  start: number;
  end: number;
  representative: number;
};

export function parseTrackJsonData(text: string): unknown {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch (e) {
    throw new Error(`TrackJSON could not be parsed: ${getErrorMessage(e)}`);
  }

  if (!isRecord(data)) {
    throw new Error("TrackJSON root must be an object.");
  }

  const type = data.type;
  if (type !== "FeatureCollection" && type !== "Feature") {
    throw new Error("TrackJSON must be a GeoJSON FeatureCollection or Feature.");
  }

  return data;
}

export function compactTrackJsonData(
  data: unknown,
  precisionOptions: TrackJsonPrecisionOptions = {}
): unknown {
  const precision = resolveTrackJsonPrecision(precisionOptions);

  if (!isRecord(data)) {
    return data;
  }

  if (data.type === "Feature") {
    return compactTrackJsonFeature(data, precision);
  }

  if (data.type !== "FeatureCollection" || !Array.isArray(data.features)) {
    return compactTrackJsonValue(data, undefined, [], precision);
  }

  const output: Record<string, unknown> = {
    ...data,
    features: data.features.map((feature) => {
      return isRecord(feature)
        ? compactTrackJsonFeature(feature, precision)
        : feature;
    }),
  };

  compactTrackJsonDerivedProperties(output, data, precision);
  if (isRecord(data.metadata)) {
    output.metadata = compactTrackJsonMetadata(data.metadata, precision);
  }

  return output;
}

export function downsampleTrackJsonData(
  data: unknown,
  options: TrackJsonDownsampleOptions
): unknown {
  const maxPoints = normalizeMaxPoints(options.maxPoints);
  const strategy = options.strategy || "uniform";
  if (strategy !== "uniform" && strategy !== "aggregate") {
    throw new RangeError(`Unsupported TrackJSON downsampling strategy: ${strategy}`);
  }

  const preserveEndpoints = options.preserveEndpoints !== false;

  if (!isRecord(data)) {
    return data;
  }

  if (data.type === "Feature") {
    return downsampleTrackJsonFeature(
      data,
      maxPoints,
      strategy,
      preserveEndpoints
    );
  }

  if (data.type !== "FeatureCollection" || !Array.isArray(data.features)) {
    return data;
  }

  return {
    ...data,
    features: data.features.map((feature) => {
      return isRecord(feature)
        ? downsampleTrackJsonFeature(
            feature,
            maxPoints,
            strategy,
            preserveEndpoints
          )
        : feature;
    }),
  };
}

export function obfuscateTrackJsonPrivacy(
  data: unknown,
  options: TrackJsonPrivacyObfuscationOptions
): unknown {
  const startDistanceM = normalizePrivacyDistance(options.startDistanceM);
  const endDistanceM = normalizePrivacyDistance(options.endDistanceM);

  if (!isRecord(data)) {
    return data;
  }

  if (data.type === "Feature") {
    return obfuscateTrackJsonFeature(data, startDistanceM, endDistanceM);
  }

  if (data.type !== "FeatureCollection" || !Array.isArray(data.features)) {
    return cloneTrackJsonValue(data);
  }

  return {
    ...data,
    features: data.features.map((feature) => {
      return isRecord(feature)
        ? obfuscateTrackJsonFeature(feature, startDistanceM, endDistanceM)
        : cloneTrackJsonValue(feature);
    }),
  };
}

export function countTrackJsonPositionedPoints(data: unknown): number {
  if (!isRecord(data)) {
    return 0;
  }

  if (data.type === "Feature") {
    return countFeaturePositionedPoints(data);
  }

  if (data.type !== "FeatureCollection" || !Array.isArray(data.features)) {
    return 0;
  }

  return data.features.reduce((sum, feature) => {
    return isRecord(feature) ? sum + countFeaturePositionedPoints(feature) : sum;
  }, 0);
}

export function getTrackJsonTitle(data: unknown): string | undefined {
  const feature = getFirstFeature(data);
  const properties = feature?.properties;
  if (!isRecord(properties)) {
    return undefined;
  }

  const title = properties.title;
  return typeof title === "string" && title.trim() ? title.trim() : undefined;
}

export function getTrackJsonPoi(data: unknown): TrackJsonPointOfInterest[] {
  if (!isRecord(data) || !Array.isArray(data.poi)) {
    return [];
  }

  return data.poi
    .map(readTrackJsonPointOfInterest)
    .filter((point): point is TrackJsonPointOfInterest => Boolean(point));
}

export function getTrackJsonPointOfInterest(
  data: unknown,
  role: TrackJsonPointOfInterestRole,
): TrackJsonPointOfInterest | undefined {
  return getTrackJsonPoi(data).find((point) => point.role === role);
}

export function getTrackJsonMetadata(
  data: unknown
): Record<string, unknown> | undefined {
  if (isRecord(data) && isRecord(data.metadata)) {
    return data.metadata;
  }

  const feature = getFirstFeature(data);
  const properties = feature?.properties;
  if (!isRecord(properties)) {
    return undefined;
  }

  const metadata = properties.metadata;
  return isRecord(metadata) ? metadata : undefined;
}

function compactTrackJsonFeature(
  feature: Record<string, unknown>,
  precision: Required<TrackJsonPrecisionOptions>
): Record<string, unknown> {
  const output: Record<string, unknown> = { ...feature };
  const geometry = feature.geometry;

  if (isRecord(geometry)) {
    output.geometry = compactTrackJsonGeometry(geometry, precision);
  }

  if (isRecord(feature.properties)) {
    output.properties = compactTrackJsonProperties(feature.properties, precision);
  }

  compactTrackJsonDerivedProperties(output, feature, precision);
  return output;
}

function compactTrackJsonDerivedProperties(
  output: Record<string, unknown>,
  source: Record<string, unknown>,
  precision: Required<TrackJsonPrecisionOptions>,
) {
  if (Array.isArray(source.bbox)) {
    output.bbox = source.bbox.map((value) => {
      return typeof value === "number" && Number.isFinite(value)
        ? roundNumber(value, precision.coordinates)
        : value;
    });
  }

  if (Array.isArray(source.poi)) {
    output.poi = source.poi.map((value) => {
      if (!isRecord(value) || !Array.isArray(value.coordinates)) {
        return compactTrackJsonValue(value, undefined, [], precision);
      }

      return {
        ...value,
        coordinates: value.coordinates.map((coordinate) => {
          return typeof coordinate === "number" && Number.isFinite(coordinate)
            ? roundNumber(coordinate, precision.coordinates)
            : coordinate;
        }),
      };
    });
  }
}

function readTrackJsonPointOfInterest(
  value: unknown,
): TrackJsonPointOfInterest | undefined {
  if (!isRecord(value) || !isTrackJsonPointOfInterestRole(value.role)) {
    return undefined;
  }

  const coordinates = readTrackJsonPosition(value.coordinates);
  return coordinates ? { role: value.role, coordinates } : undefined;
}

function readTrackJsonPosition(value: unknown): TrackJsonPosition | undefined {
  if (
    !Array.isArray(value) ||
    value.length < 2 ||
    typeof value[0] !== "number" ||
    !Number.isFinite(value[0]) ||
    typeof value[1] !== "number" ||
    !Number.isFinite(value[1])
  ) {
    return undefined;
  }

  return [value[0], value[1]];
}

function isTrackJsonPointOfInterestRole(
  value: unknown,
): value is TrackJsonPointOfInterestRole {
  return value === "start" ||
    value === "end" ||
    value === "centroid" ||
    value === "furthest";
}

function compactTrackJsonGeometry(
  geometry: Record<string, unknown>,
  precision: Required<TrackJsonPrecisionOptions>
): Record<string, unknown> {
  if (!isCoordinateGeometryType(geometry.type) || !Array.isArray(geometry.coordinates)) {
    return compactTrackJsonValue(
      geometry,
      undefined,
      [],
      precision
    ) as Record<string, unknown>;
  }

  return {
    ...geometry,
    coordinates: compactTrackJsonCoordinates(geometry.coordinates, precision),
  };
}

function isCoordinateGeometryType(type: unknown): boolean {
  return type === "Point" ||
    type === "MultiPoint" ||
    type === "LineString" ||
    type === "MultiLineString" ||
    type === "Polygon" ||
    type === "MultiPolygon";
}

function compactTrackJsonCoordinates(
  coordinates: unknown,
  precision: Required<TrackJsonPrecisionOptions>
): unknown {
  if (!Array.isArray(coordinates)) {
    return coordinates;
  }

  if (isTrackJsonPosition(coordinates)) {
    return compactTrackJsonCoordinate(coordinates, precision);
  }

  return coordinates.map((coordinate) => {
    return compactTrackJsonCoordinates(coordinate, precision);
  });
}

function compactTrackJsonCoordinate(
  coordinate: unknown[],
  precision: Required<TrackJsonPrecisionOptions>
): unknown[] {
  return coordinate.map((value, index) => {
    return roundNumber(
      value as number,
      index < 2 ? precision.coordinates : precision.altitudes
    );
  });
}

function compactTrackJsonProperties(
  properties: Record<string, unknown>,
  precision: Required<TrackJsonPrecisionOptions>
): Record<string, unknown> {
  const output: Record<string, unknown> = { ...properties };

  if (isRecord(properties.coordinateProperties)) {
    output.coordinateProperties = compactCoordinateProperties(
      properties.coordinateProperties,
      precision
    );
  }

  if (isRecord(properties.metadata)) {
    output.metadata = compactTrackJsonMetadata(properties.metadata, precision);
  }

  return output;
}

function compactCoordinateProperties(
  coordinateProperties: Record<string, unknown>,
  precision: Required<TrackJsonPrecisionOptions>
): Record<string, unknown> {
  const output: Record<string, unknown> = {};

  Object.keys(coordinateProperties).forEach((name) => {
    const value = coordinateProperties[name];
    if (!Array.isArray(value)) {
      output[name] = value;
      return;
    }

    const valuePrecision = getCoordinatePropertyPrecision(name, precision);
    output[name] = value.map((item) => {
      return typeof item === "number" && Number.isFinite(item)
        ? roundNumber(item, valuePrecision)
        : item;
    });
  });

  return output;
}

function getCoordinatePropertyPrecision(
  name: string,
  precision: Required<TrackJsonPrecisionOptions>
): number {
  if (name === "times") {
    return precision.times;
  }

  if (name === "distances") {
    return precision.distances;
  }

  if (name === "altitudes") {
    return precision.altitudes;
  }

  if (name === "heartRates") {
    return precision.heartRates;
  }

  if (name === "cadences") {
    return precision.cadences;
  }

  if (name === "powers") {
    return precision.powers;
  }

  if (name === "speeds") {
    return precision.speeds;
  }

  return precision.metrics;
}

function compactTrackJsonMetadata(
  metadata: Record<string, unknown>,
  precision: Required<TrackJsonPrecisionOptions>
): Record<string, unknown> {
  return compactTrackJsonValue(
    metadata,
    undefined,
    [],
    precision
  ) as Record<string, unknown>;
}

function compactTrackJsonValue(
  value: unknown,
  key: string | undefined,
  path: string[],
  precision: Required<TrackJsonPrecisionOptions>
): unknown {
  if (typeof value === "number" && Number.isFinite(value)) {
    return roundNumber(value, getMetadataPrecision(key, path, precision));
  }

  if (Array.isArray(value)) {
    return value.map((item) => compactTrackJsonValue(item, key, path, precision));
  }

  if (isRecord(value)) {
    const output: Record<string, unknown> = {};
    Object.keys(value).forEach((childKey) => {
      output[childKey] = compactTrackJsonValue(
        value[childKey],
        childKey,
        [...path, childKey],
        precision
      );
    });
    return output;
  }

  return value;
}

function getMetadataPrecision(
  key: string | undefined,
  path: string[],
  precision: Required<TrackJsonPrecisionOptions>
): number {
  if (
    key === "createdAt" ||
    key === "startTime" ||
    key === "timeCreated" ||
    key === "serialNumber"
  ) {
    return 0;
  }

  if (key === "totalElapsedTime" || key === "totalTimerTime") {
    return 0;
  }

  if (isMetricMetadataPath(path)) {
    return 3;
  }

  return precision.metadata;
}

function isMetricMetadataPath(path: string[]): boolean {
  return path[0] === "statistics" || path[0] === "pedaling";
}

function downsampleTrackJsonFeature(
  feature: Record<string, unknown>,
  maxPoints: number,
  strategy: TrackJsonDownsampleStrategy,
  preserveEndpoints: boolean
): Record<string, unknown> {
  const geometry = feature.geometry;
  if (!isRecord(geometry)) {
    return feature;
  }

  if (geometry.type !== "LineString" || !Array.isArray(geometry.coordinates)) {
    return feature;
  }

  const sourceCoordinates = geometry.coordinates;
  if (sourceCoordinates.length <= maxPoints) {
    return cloneRecord(feature);
  }

  const ranges = createTrackJsonDownsampleRanges(
    sourceCoordinates.length,
    maxPoints,
    strategy,
    preserveEndpoints
  );
  const coordinates = ranges.map((range) => {
    return cloneTrackJsonCoordinate(sourceCoordinates[range.representative]);
  });
  const output: Record<string, unknown> = {
    ...feature,
    geometry: {
      ...geometry,
      coordinates,
    },
  };

  const properties = feature.properties;
  if (isRecord(properties) && isRecord(properties.coordinateProperties)) {
    output.properties = {
      ...properties,
      coordinateProperties: downsampleCoordinateProperties(
        properties.coordinateProperties,
        ranges,
        sourceCoordinates.length,
        strategy
      ),
    };
  }

  return output;
}

function createTrackJsonDownsampleRanges(
  length: number,
  maxPoints: number,
  strategy: TrackJsonDownsampleStrategy,
  preserveEndpoints: boolean
): TrackJsonDownsampleRange[] {
  if (length <= maxPoints) {
    return Array.from({ length }, (_, index) => {
      return { start: index, end: index + 1, representative: index };
    });
  }

  if (strategy === "uniform") {
    const indices = preserveEndpoints
      ? selectUniformIndicesWithEndpoints(length, maxPoints)
      : selectUniformIndices(length, maxPoints);
    return indices.map((index) => {
      return { start: index, end: index + 1, representative: index };
    });
  }

  if (!preserveEndpoints) {
    return createAggregateRanges(length, maxPoints, 0);
  }

  if (maxPoints <= 2) {
    return [
      { start: 0, end: 1, representative: 0 },
      { start: length - 1, end: length, representative: length - 1 },
    ];
  }

  return [
    { start: 0, end: 1, representative: 0 },
    ...createAggregateRanges(length - 2, maxPoints - 2, 1),
    { start: length - 1, end: length, representative: length - 1 },
  ];
}

function createAggregateRanges(
  length: number,
  count: number,
  offset: number
): TrackJsonDownsampleRange[] {
  return Array.from({ length: count }, (_, index) => {
    const start = offset + Math.floor((index * length) / count);
    const end = offset + Math.floor(((index + 1) * length) / count);
    const safeEnd = Math.max(start + 1, end);
    return {
      start,
      end: safeEnd,
      representative: Math.floor((start + safeEnd - 1) / 2),
    };
  });
}

function downsampleCoordinateProperties(
  coordinateProperties: Record<string, unknown>,
  ranges: TrackJsonDownsampleRange[],
  sourceLength: number,
  strategy: TrackJsonDownsampleStrategy
): Record<string, unknown> {
  const output: Record<string, unknown> = { ...coordinateProperties };

  Object.keys(coordinateProperties).forEach((name) => {
    const series = coordinateProperties[name];
    if (!Array.isArray(series) || series.length !== sourceLength) {
      return;
    }

    output[name] = downsampleCoordinatePropertySeries(
      name,
      series,
      ranges,
      strategy
    );
  });

  return output;
}

function downsampleCoordinatePropertySeries(
  name: string,
  series: unknown[],
  ranges: TrackJsonDownsampleRange[],
  strategy: TrackJsonDownsampleStrategy
): unknown[] {
  if (strategy === "uniform" || isRepresentativeCoordinateProperty(name)) {
    return ranges.map((range) => series[range.representative]);
  }

  return ranges.map((range) => {
    const average = averageCoordinatePropertyRange(series, range.start, range.end);
    return typeof average === "number" ? average : series[range.representative];
  });
}

function isRepresentativeCoordinateProperty(name: string): boolean {
  return name === "times" || name === "distances";
}

function averageCoordinatePropertyRange(
  series: unknown[],
  start: number,
  end: number
): number | undefined {
  let sum = 0;
  let count = 0;

  for (let index = start; index < end; index += 1) {
    const value = series[index];
    if (typeof value === "number" && Number.isFinite(value)) {
      sum += value;
      count += 1;
    }
  }

  return count > 0 ? sum / count : undefined;
}

function obfuscateTrackJsonFeature(
  feature: Record<string, unknown>,
  startDistanceM: number,
  endDistanceM: number
): Record<string, unknown> {
  const geometry = feature.geometry;
  if (!isRecord(geometry)) {
    return cloneRecord(feature);
  }

  if (geometry.type !== "LineString" || !Array.isArray(geometry.coordinates)) {
    return cloneRecord(feature);
  }

  const sourceCoordinates = geometry.coordinates;
  const coordinates = obfuscateTrackJsonCoordinates(
    sourceCoordinates,
    getTrackJsonFeatureDistances(feature, sourceCoordinates),
    startDistanceM,
    endDistanceM
  );

  return {
    ...feature,
    geometry: {
      ...geometry,
      coordinates,
    },
  };
}

function obfuscateTrackJsonCoordinates(
  sourceCoordinates: unknown[],
  distances: number[],
  startDistanceM: number,
  endDistanceM: number
): unknown[] {
  const coordinates = sourceCoordinates.map((coordinate) => {
    return cloneTrackJsonCoordinate(coordinate);
  });

  if (coordinates.length === 0 || (startDistanceM === 0 && endDistanceM === 0)) {
    return coordinates;
  }

  const positionedIndices = coordinates
    .map((coordinate, index) => {
      return isTrackJsonPosition(coordinate) ? index : -1;
    })
    .filter((index) => index >= 0);

  if (positionedIndices.length === 0) {
    return coordinates;
  }

  const totalDistanceM = distances[positionedIndices[positionedIndices.length - 1]];
  if (!Number.isFinite(totalDistanceM) || totalDistanceM <= 0) {
    return coordinates;
  }

  if (startDistanceM + endDistanceM >= totalDistanceM) {
    const anchorIndex = findTrackJsonDistanceIndex(
      positionedIndices,
      distances,
      totalDistanceM / 2
    );
    clampTrackJsonCoordinateRange(
      coordinates,
      positionedIndices,
      0,
      positionedIndices.length - 1,
      anchorIndex
    );
    return coordinates;
  }

  if (startDistanceM > 0) {
    const anchorIndex = findTrackJsonDistanceIndex(
      positionedIndices,
      distances,
      startDistanceM
    );
    const anchorPosition = positionedIndices.indexOf(anchorIndex);
    if (anchorPosition >= 0) {
      clampTrackJsonCoordinateRange(
        coordinates,
        positionedIndices,
        0,
        anchorPosition,
        anchorIndex
      );
    }
  }

  if (endDistanceM > 0) {
    const endThresholdM = Math.max(0, totalDistanceM - endDistanceM);
    const anchorIndex = findTrackJsonDistanceIndex(
      positionedIndices,
      distances,
      endThresholdM
    );
    const anchorPosition = positionedIndices.indexOf(anchorIndex);
    if (anchorPosition >= 0) {
      clampTrackJsonCoordinateRange(
        coordinates,
        positionedIndices,
        anchorPosition,
        positionedIndices.length - 1,
        anchorIndex
      );
    }
  }

  return coordinates;
}

function clampTrackJsonCoordinateRange(
  coordinates: unknown[],
  positionedIndices: number[],
  startPosition: number,
  endPosition: number,
  anchorIndex: number
) {
  const anchor = coordinates[anchorIndex];
  if (!isTrackJsonPosition(anchor)) {
    return;
  }

  for (let position = startPosition; position <= endPosition; position += 1) {
    const coordinate = coordinates[positionedIndices[position]];
    if (isTrackJsonPosition(coordinate)) {
      coordinate[0] = anchor[0];
      coordinate[1] = anchor[1];
    }
  }
}

function findTrackJsonDistanceIndex(
  positionedIndices: number[],
  distances: number[],
  thresholdM: number
): number {
  const found = positionedIndices.find((index) => {
    return distances[index] >= thresholdM;
  });

  return typeof found === "number"
    ? found
    : positionedIndices[positionedIndices.length - 1];
}

function getTrackJsonFeatureDistances(
  feature: Record<string, unknown>,
  coordinates: unknown[]
): number[] {
  const properties = feature.properties;
  if (isRecord(properties) && isRecord(properties.coordinateProperties)) {
    const distances = properties.coordinateProperties.distances;
    if (isUsableDistanceSeries(distances, coordinates.length)) {
      return distances;
    }
  }

  return computeTrackJsonCoordinateDistances(coordinates);
}

function isUsableDistanceSeries(
  value: unknown,
  length: number
): value is number[] {
  if (!Array.isArray(value) || value.length !== length) {
    return false;
  }

  let previous = -Infinity;
  return value.every((item) => {
    if (typeof item !== "number" || !Number.isFinite(item) || item < previous) {
      return false;
    }
    previous = item;
    return true;
  });
}

function computeTrackJsonCoordinateDistances(coordinates: unknown[]): number[] {
  const distances: number[] = [];
  let total = 0;
  let previous: [number, number] | undefined;

  coordinates.forEach((coordinate, index) => {
    const position = getTrackJsonPosition(coordinate);
    if (position && previous) {
      total += getHaversineDistanceM(previous[1], previous[0], position[1], position[0]);
    }
    distances[index] = total;
    if (position) {
      previous = position;
    }
  });

  return distances;
}

function isTrackJsonPosition(value: unknown): value is number[] {
  return Array.isArray(value) && getTrackJsonPosition(value) !== undefined;
}

function getTrackJsonPosition(value: unknown): [number, number] | undefined {
  if (!Array.isArray(value) || value.length < 2) {
    return undefined;
  }

  const lon = value[0];
  const lat = value[1];
  if (
    typeof lon !== "number" ||
    !Number.isFinite(lon) ||
    typeof lat !== "number" ||
    !Number.isFinite(lat)
  ) {
    return undefined;
  }

  return [lon, lat];
}

function getHaversineDistanceM(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const earthRadiusM = 6371000;
  const dLat = degreesToRadians(lat2 - lat1);
  const dLon = degreesToRadians(lon2 - lon1);
  const rLat1 = degreesToRadians(lat1);
  const rLat2 = degreesToRadians(lat2);
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(rLat1) * Math.cos(rLat2) * Math.sin(dLon / 2) ** 2;
  return 2 * earthRadiusM * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function degreesToRadians(value: number): number {
  return (value * Math.PI) / 180;
}

function normalizePrivacyDistance(value: number | undefined): number {
  if (typeof value === "undefined") {
    return 0;
  }

  if (!Number.isFinite(value) || value < 0) {
    throw new RangeError("privacy distance must be a non-negative finite number.");
  }

  return Math.floor(value);
}

function cloneTrackJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => cloneTrackJsonValue(item));
  }

  if (isRecord(value)) {
    const output: Record<string, unknown> = {};
    Object.keys(value).forEach((key) => {
      output[key] = cloneTrackJsonValue(value[key]);
    });
    return output;
  }

  return value;
}

function countFeaturePositionedPoints(feature: Record<string, unknown>): number {
  const geometry = feature.geometry;
  if (!isRecord(geometry)) {
    return 0;
  }

  if (geometry.type === "LineString" && Array.isArray(geometry.coordinates)) {
    return geometry.coordinates.length;
  }

  if (geometry.type === "MultiLineString" && Array.isArray(geometry.coordinates)) {
    return geometry.coordinates.reduce((sum, line) => {
      return Array.isArray(line) ? sum + line.length : sum;
    }, 0);
  }

  return 0;
}

function getFirstFeature(data: unknown): { properties?: unknown } | undefined {
  if (!isRecord(data)) {
    return undefined;
  }

  if (data.type === "Feature") {
    return data as { properties?: unknown };
  }

  if (data.type !== "FeatureCollection" || !Array.isArray(data.features)) {
    return undefined;
  }

  return data.features.find((feature) => {
    return isRecord(feature) && feature.type === "Feature";
  }) as { properties?: unknown } | undefined;
}

function resolveTrackJsonPrecision(
  precision: TrackJsonPrecisionOptions
): Required<TrackJsonPrecisionOptions> {
  return {
    coordinates: normalizePrecision(
      precision.coordinates,
      DEFAULT_TRACK_JSON_PRECISION.coordinates
    ),
    times: normalizePrecision(precision.times, DEFAULT_TRACK_JSON_PRECISION.times),
    distances: normalizePrecision(
      precision.distances,
      DEFAULT_TRACK_JSON_PRECISION.distances
    ),
    altitudes: normalizePrecision(
      precision.altitudes,
      DEFAULT_TRACK_JSON_PRECISION.altitudes
    ),
    heartRates: normalizePrecision(
      precision.heartRates,
      DEFAULT_TRACK_JSON_PRECISION.heartRates
    ),
    cadences: normalizePrecision(
      precision.cadences,
      DEFAULT_TRACK_JSON_PRECISION.cadences
    ),
    powers: normalizePrecision(
      precision.powers,
      DEFAULT_TRACK_JSON_PRECISION.powers
    ),
    speeds: normalizePrecision(
      precision.speeds,
      DEFAULT_TRACK_JSON_PRECISION.speeds
    ),
    metrics: normalizePrecision(
      precision.metrics,
      DEFAULT_TRACK_JSON_PRECISION.metrics
    ),
    metadata: normalizePrecision(
      precision.metadata,
      DEFAULT_TRACK_JSON_PRECISION.metadata
    ),
  };
}

function normalizePrecision(value: number | undefined, fallback: number): number {
  if (!Number.isFinite(value)) {
    return fallback;
  }

  return Math.max(0, Math.min(12, Math.floor(value as number)));
}

function normalizeMaxPoints(value: number): number {
  if (!Number.isFinite(value) || value < 2) {
    throw new RangeError(
      "maxPoints must be a finite number greater than or equal to 2."
    );
  }

  return Math.floor(value);
}

function selectUniformIndices(length: number, count: number): number[] {
  return Array.from({ length: count }, (_, index) => {
    return Math.floor((index * length) / count);
  });
}

function selectUniformIndicesWithEndpoints(length: number, count: number): number[] {
  if (count <= 1) {
    return [0];
  }

  return Array.from({ length: count }, (_, index) => {
    return Math.round((index * (length - 1)) / (count - 1));
  });
}

function cloneTrackJsonCoordinate(coordinate: unknown): unknown {
  return Array.isArray(coordinate) ? [...coordinate] : coordinate;
}

function cloneRecord(record: Record<string, unknown>): Record<string, unknown> {
  return { ...record };
}

function roundNumber(value: number, precision: number): number {
  if (precision <= 0) {
    return Math.round(value);
  }

  const factor = 10 ** precision;
  return Math.round(value * factor) / factor;
}

function isRecord(value: unknown): value is Record<string, unknown> {
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