export type TrackJsonDownsampleStrategy = "uniform" | "aggregate";

export type TrackJsonDownsampleOptions = {
  maxPoints: number;
  strategy?: TrackJsonDownsampleStrategy;
  preserveEndpoints?: boolean;
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
    return compactTrackJsonValue(data, undefined, precision);
  }

  const output: Record<string, unknown> = {
    ...data,
    features: data.features.map((feature) => {
      return isRecord(feature)
        ? compactTrackJsonFeature(feature, precision)
        : feature;
    }),
  };

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

  return output;
}

function compactTrackJsonGeometry(
  geometry: Record<string, unknown>,
  precision: Required<TrackJsonPrecisionOptions>
): Record<string, unknown> {
  if (geometry.type !== "LineString" || !Array.isArray(geometry.coordinates)) {
    return compactTrackJsonValue(
      geometry,
      undefined,
      precision
    ) as Record<string, unknown>;
  }

  return {
    ...geometry,
    coordinates: geometry.coordinates.map((coordinate) => {
      return compactTrackJsonCoordinate(coordinate, precision);
    }),
  };
}

function compactTrackJsonCoordinate(
  coordinate: unknown,
  precision: Required<TrackJsonPrecisionOptions>
): unknown {
  if (!Array.isArray(coordinate)) {
    return coordinate;
  }

  return coordinate.map((value, index) => {
    if (typeof value !== "number" || !Number.isFinite(value)) {
      return value;
    }

    return roundNumber(
      value,
      index < 2 ? precision.coordinates : precision.elevations
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

  if (name === "elevations") {
    return precision.elevations;
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
    precision
  ) as Record<string, unknown>;
}

function compactTrackJsonValue(
  value: unknown,
  key: string | undefined,
  precision: Required<TrackJsonPrecisionOptions>
): unknown {
  if (typeof value === "number" && Number.isFinite(value)) {
    return roundNumber(value, getMetadataPrecision(key, precision));
  }

  if (Array.isArray(value)) {
    return value.map((item) => compactTrackJsonValue(item, key, precision));
  }

  if (isRecord(value)) {
    const output: Record<string, unknown> = {};
    Object.keys(value).forEach((childKey) => {
      output[childKey] = compactTrackJsonValue(
        value[childKey],
        childKey,
        precision
      );
    });
    return output;
  }

  return value;
}

function getMetadataPrecision(
  key: string | undefined,
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

  return precision.metadata;
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
    elevations: normalizePrecision(
      precision.elevations,
      DEFAULT_TRACK_JSON_PRECISION.elevations
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
