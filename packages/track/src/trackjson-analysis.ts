import {
  getActivityHistogramDisplay,
  getActivityPowerCurvePoints,
  getHeartRateZoneDisplayRows,
  getPowerZoneDisplayRows,
  type TrackAnalysisDisplayRow,
  type TrackHistogramDisplay,
  type TrackHistogramKey,
  type TrackPowerCurvePoint,
} from "./analysis";
import {
  buildActivityBestEfforts,
  buildActivityHistograms,
  computeHeartRateZoneSummary,
  computePowerZoneSummary,
  type TrackActivityHistograms,
  type TrackPoint,
} from "./activity";

const HISTOGRAM_KEYS: TrackHistogramKey[] = [
  "speedKph",
  "cadenceRpm",
  "heartRateBpm",
  "powerW",
];

export type TrackJsonAnalysisOptions = {
  lthrBpm?: number;
  ftpW?: number;
};

export type TrackJsonAnalysisDisplay = {
  key: TrackHistogramKey | "heartRateZones" | "powerZones";
  title: string;
  color: string;
  rows: TrackAnalysisDisplayRow[];
};

export type TrackJsonAnalysis = {
  displays: TrackJsonAnalysisDisplay[];
  powerCurve: TrackPowerCurvePoint[];
};

type JsonRecord = Record<string, unknown>;

const isRecord = (value: unknown): value is JsonRecord =>
  value !== null && typeof value === "object" && !Array.isArray(value);

const toFiniteNumber = (value: unknown): number | undefined =>
  typeof value === "number" && Number.isFinite(value) ? value : undefined;

const toPositiveFiniteNumber = (value: unknown): number | undefined => {
  const number = toFiniteNumber(value);
  return number !== undefined && number > 0 ? number : undefined;
};

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

const compactZoneLabel = (label: string): string =>
  label.replace(/\s+(?:LTHR|FTP),.*$/, "");

const formatThreshold = (value: number): string => String(value);

const getHeartRateZoneDisplay = (
  points: TrackPoint[],
  lthrBpm: number,
): TrackJsonAnalysisDisplay | undefined => {
  const summary = computeHeartRateZoneSummary(points, lthrBpm);
  if (summary.totalSeconds <= 0) {
    return undefined;
  }

  return {
    key: "heartRateZones",
    title: `Heart-rate histogram by LTHR ${formatThreshold(lthrBpm)} bpm`,
    color: "#fff",
    rows: getHeartRateZoneDisplayRows(summary, lthrBpm).map((row) => ({
      ...row,
      label: compactZoneLabel(row.label),
    })),
  };
};

const getPowerZoneDisplay = (
  points: TrackPoint[],
  ftpW: number,
): TrackJsonAnalysisDisplay | undefined => {
  const summary = computePowerZoneSummary(points, ftpW);
  if (summary.totalSeconds <= 0) {
    return undefined;
  }

  return {
    key: "powerZones",
    title: `Power histogram by FTP ${formatThreshold(ftpW)} W`,
    color: "#fff",
    rows: getPowerZoneDisplayRows(summary, ftpW).map((row) => ({
      ...row,
      label: compactZoneLabel(row.label),
    })),
  };
};

/**
 * Builds the compact analysis shown by the map renderer. Existing TrackJSON
 * metadata wins per standard histogram and for the power curve; only missing
 * values are recomputed from the (possibly downsampled) coordinate data.
 * LTHR/FTP zone displays are always computed from the available timed points
 * because their thresholds are supplied by the embedding document.
 */
export function getTrackJsonAnalysis(
  data: unknown,
  options: TrackJsonAnalysisOptions = {},
): TrackJsonAnalysis {
  const features = getLineStringFeatures(data);
  const metadata = getTrackJsonMetadata(data, features);
  const metadataDisplays = new Map<TrackHistogramKey, TrackHistogramDisplay>();
  const metadataPowerCurve = getActivityPowerCurvePoints(metadata);
  const lthrBpm = toPositiveFiniteNumber(options.lthrBpm);
  const ftpW = toPositiveFiniteNumber(options.ftpW);

  HISTOGRAM_KEYS.forEach((key) => {
    const display = getActivityHistogramDisplay(metadata, key);
    if (display) {
      metadataDisplays.set(key, display);
    }
  });

  const needsComputedHistograms = HISTOGRAM_KEYS.some(
    (key) => !metadataDisplays.has(key),
  );
  const needsComputedPowerCurve = metadataPowerCurve.length === 0;
  const needsPoints =
    needsComputedHistograms ||
    needsComputedPowerCurve ||
    lthrBpm !== undefined ||
    ftpW !== undefined;
  const points = needsPoints ? getTrackJsonPoints(features) : [];
  const computedHistograms = needsComputedHistograms
    ? buildActivityHistograms(points)
    : undefined;
  const displays: TrackJsonAnalysisDisplay[] = [];

  HISTOGRAM_KEYS.forEach((key) => {
    const display = metadataDisplays.get(key) ||
      getComputedHistogramDisplay(computedHistograms, key);
    if (display) {
      displays.push(display);
    }

    if (key === "heartRateBpm" && lthrBpm !== undefined) {
      const zoneDisplay = getHeartRateZoneDisplay(points, lthrBpm);
      if (zoneDisplay) {
        displays.push(zoneDisplay);
      }
    }

    if (key === "powerW" && ftpW !== undefined) {
      const zoneDisplay = getPowerZoneDisplay(points, ftpW);
      if (zoneDisplay) {
        displays.push(zoneDisplay);
      }
    }
  });

  const computedBestEfforts = needsComputedPowerCurve
    ? buildActivityBestEfforts(points)
    : undefined;
  const powerCurve = metadataPowerCurve.length > 0
    ? metadataPowerCurve
    : getActivityPowerCurvePoints(
      computedBestEfforts ? { bestEfforts: computedBestEfforts } : undefined,
    );

  return { displays, powerCurve };
}

export function getTrackJsonHistogramDisplays(
  data: unknown,
  options: TrackJsonAnalysisOptions = {},
): TrackJsonAnalysisDisplay[] {
  return getTrackJsonAnalysis(data, options).displays;
}

export function getTrackJsonPowerCurvePoints(
  data: unknown,
): TrackPowerCurvePoint[] {
  return getTrackJsonAnalysis(data).powerCurve;
}
