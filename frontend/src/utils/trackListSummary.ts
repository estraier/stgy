import { getTrackJsonPointOfInterest } from "stgy-track/trackjson";
import { formatDateTime } from "./format";

export type TrackListSummary = {
  startTime?: number;
  localTimeOffsetSeconds?: number;
  totalElapsedTime?: number;
  totalDistanceM?: number;
  location?: string;
};

type JsonRecord = Record<string, unknown>;
type NumericTrackListSummaryKey =
  | "startTime"
  | "localTimeOffsetSeconds"
  | "totalElapsedTime"
  | "totalDistanceM";

export function getTrackListSummary(data: unknown): TrackListSummary | undefined {
  const metadata = getTrackMetadata(data);
  if (!metadata) return undefined;

  const summary: TrackListSummary = {};
  copyFiniteNumber(metadata, summary, "startTime");
  copyFiniteNumber(metadata, summary, "localTimeOffsetSeconds");
  copyFiniteNumber(metadata, summary, "totalElapsedTime");
  copyFiniteNumber(metadata, summary, "totalDistanceM");

  const location = getCentroidLabel(data);
  if (location) {
    summary.location = location;
  }

  return Object.keys(summary).length > 0 ? summary : undefined;
}

export function formatTrackListDateTime(
  summary: TrackListSummary | undefined,
  fallbackDate?: Date | null,
): string {
  const startTime = summary?.startTime;
  if (isFiniteNumber(startTime)) {
    const localOffset = summary?.localTimeOffsetSeconds;
    if (isFiniteNumber(localOffset)) {
      const localDate = new Date((startTime + localOffset) * 1000);
      return formatDateTime(localDate, "UTC");
    }
    return formatDateTime(new Date(startTime * 1000));
  }

  return fallbackDate ? formatDateTime(fallbackDate) : "—";
}

export function formatTrackListElapsedTime(seconds: number | undefined): string {
  if (!isFiniteNumber(seconds) || seconds < 0) return "—";

  const rounded = Math.round(seconds);
  const hours = Math.floor(rounded / 3600);
  const minutes = Math.floor((rounded % 3600) / 60);
  const remainingSeconds = rounded % 60;

  return [hours, minutes, remainingSeconds]
    .map((value) => String(value).padStart(2, "0"))
    .join(":");
}

export function formatTrackListDistance(distanceM: number | undefined): string {
  if (!isFiniteNumber(distanceM) || distanceM < 0) return "—";
  return `${(distanceM / 1000).toFixed(2)}km`;
}

function getTrackMetadata(data: unknown): JsonRecord | undefined {
  if (!isRecord(data)) return undefined;
  if (isRecord(data.metadata)) return data.metadata;

  const feature = getFirstFeature(data);
  if (!feature || !isRecord(feature.properties)) return undefined;
  return isRecord(feature.properties.metadata)
    ? feature.properties.metadata
    : undefined;
}

function getFirstFeature(data: JsonRecord): JsonRecord | undefined {
  if (data.type === "Feature") return data;
  if (data.type !== "FeatureCollection" || !Array.isArray(data.features)) {
    return undefined;
  }
  return data.features.find(isRecord);
}

function getCentroidLabel(data: unknown): string | undefined {
  const label = getTrackJsonPointOfInterest(data, "centroid")?.label?.trim();
  return label || undefined;
}

function copyFiniteNumber(
  source: JsonRecord,
  target: TrackListSummary,
  key: NumericTrackListSummaryKey,
) {
  const value = source[key];
  if (isFiniteNumber(value)) {
    target[key] = value;
  }
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}
