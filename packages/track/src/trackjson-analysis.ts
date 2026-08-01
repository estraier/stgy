import {
  getActivityHistogramDisplay,
  type TrackHistogramDisplay,
  type TrackHistogramKey,
} from "./analysis";
import {
  buildActivityHistograms,
  type TrackActivityHistograms,
  type TrackPoint,
} from "./activity";

const HISTOGRAM_KEYS: TrackHistogramKey[] = [
  "speedKph",
  "cadenceRpm",
  "heartRateBpm",
  "powerW",
];

type JsonRecord = Record<string, unknown>;

const isRecord = (value: unknown): value is JsonRecord =>
  value !== null && typeof value === "object" && !Array.isArray(value);

const toFiniteNumber = (value: unknown): number | undefined =>
  typeof value === "number" && Number.isFinite(value) ? value : undefined;

const getRecordProperty = (
  value: JsonRecord | undefined,
  key: string,
): JsonRecord | undefined => {
  const property = value?.[key];
  return isRecord(property) ? property : undefined;
};

const getLineStringFeatures = (data: unknown): JsonRecord[] => {
  if (!isRecord(data)) {
    return [];
  }

  const candidates = data.type === "FeatureCollection"
    ? (Array.isArray(data.features) ? data.features : [])
    : data.type === "Feature"
    ? [data]
    : [];

  return candidates.filter((candidate): candidate is JsonRecord => {
    if (!isRecord(candidate)) {
      return false;
    }
    const geometry = getRecordProperty(candidate, "geometry");
    return geometry?.type === "LineString" && Array.isArray(geometry.coordinates);
  });
};

const getTrackJsonMetadata = (
  data: unknown,
  features: JsonRecord[],
): JsonRecord | undefined => {
  const firstProperties = getRecordProperty(features[0], "properties");
  return getRecordProperty(firstProperties, "metadata") ||
    (isRecord(data) ? getRecordProperty(data, "metadata") : undefined);
};

const assignSeriesValue = (
  point: TrackPoint,
  key: keyof TrackPoint,
  series: unknown,
  index: number,
  convert: (value: number) => number = (value) => value,
) => {
  if (!Array.isArray(series)) {
    return;
  }
  const value = toFiniteNumber(series[index]);
  if (value !== undefined) {
    point[key] = convert(value) as never;
  }
};

const coordinateToPoint = (
  coordinate: unknown,
  coordinateProperties: JsonRecord | undefined,
  index: number,
): TrackPoint => {
  const point: TrackPoint = {};

  if (Array.isArray(coordinate)) {
    const lon = toFiniteNumber(coordinate[0]);
    const lat = toFiniteNumber(coordinate[1]);
    const altitudeM = toFiniteNumber(coordinate[2]);
    if (lon !== undefined) point.lon = lon;
    if (lat !== undefined) point.lat = lat;
    if (altitudeM !== undefined) point.altitudeM = altitudeM;
  }

  if (!coordinateProperties) {
    return point;
  }

  assignSeriesValue(point, "time", coordinateProperties.times, index);
  assignSeriesValue(point, "distanceM", coordinateProperties.distances, index);
  assignSeriesValue(point, "altitudeM", coordinateProperties.altitudes, index);
  assignSeriesValue(point, "heartRateBpm", coordinateProperties.heartRates, index);
  assignSeriesValue(point, "cadenceRpm", coordinateProperties.cadences, index);
  assignSeriesValue(point, "powerW", coordinateProperties.powers, index);
  assignSeriesValue(
    point,
    "speedMps",
    coordinateProperties.speeds,
    index,
    (value) => value / 3.6,
  );

  return point;
};

const getTrackJsonPoints = (features: JsonRecord[]): TrackPoint[] => {
  const points: TrackPoint[] = [];

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
      const point = coordinateToPoint(coordinate, coordinateProperties, index);
      if (Object.keys(point).length > 0) {
        points.push(point);
      }
    });
  });

  return points;
};

const getComputedHistogramDisplay = (
  histograms: TrackActivityHistograms | undefined,
  key: TrackHistogramKey,
): TrackHistogramDisplay | undefined => {
  const histogram = histograms?.[key];
  if (!histogram) {
    return undefined;
  }

  return getActivityHistogramDisplay(
    { histograms: { [key]: histogram } },
    key,
  );
};

/**
 * Builds the four compact analysis histograms shown by the map renderer.
 * Existing TrackJSON metadata wins per histogram; only missing histograms are
 * recomputed from the (possibly downsampled) coordinate data.
 */
export function getTrackJsonHistogramDisplays(
  data: unknown,
): TrackHistogramDisplay[] {
  const features = getLineStringFeatures(data);
  const metadata = getTrackJsonMetadata(data, features);
  const metadataDisplays = new Map<TrackHistogramKey, TrackHistogramDisplay>();

  HISTOGRAM_KEYS.forEach((key) => {
    const display = getActivityHistogramDisplay(metadata, key);
    if (display) {
      metadataDisplays.set(key, display);
    }
  });

  const needsComputedHistograms = HISTOGRAM_KEYS.some(
    (key) => !metadataDisplays.has(key),
  );
  const computedHistograms = needsComputedHistograms
    ? buildActivityHistograms(getTrackJsonPoints(features))
    : undefined;

  return HISTOGRAM_KEYS.flatMap((key) => {
    const display = metadataDisplays.get(key) ||
      getComputedHistogramDisplay(computedHistograms, key);
    return display ? [display] : [];
  });
}
