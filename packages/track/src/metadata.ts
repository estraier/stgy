import {
  getActivityMetadataSummaryLines,
} from "./analysis";
import type { TrackMetadataSummaryLine } from "./analysis";
import {
  getTrackJsonMetadata,
  getTrackJsonPoi,
} from "./trackjson";

export function getTrackJsonOverviewMetadataLines(
  data: unknown,
): TrackMetadataSummaryLine[] {
  const lines: TrackMetadataSummaryLine[] = [];
  const metadata = getTrackJsonMetadata(data);
  if (!metadata) {
    return lines;
  }

  const startTime = getFiniteNumber(metadata.startTime);
  const endTime = getMetadataEndTime(metadata, startTime);
  const offsetSeconds = getFiniteNumber(metadata.localTimeOffsetSeconds);
  const timeParts: string[] = [];
  if (startTime !== undefined) {
    timeParts.push(`start ${formatLocalDateTime(startTime, offsetSeconds)}`);
  }
  if (endTime !== undefined) {
    timeParts.push(`end ${formatLocalDateTime(endTime, offsetSeconds)}`);
  }
  if (timeParts.length > 0) {
    lines.push({ key: "time", text: `time range: ${timeParts.join(", ")}` });
  }

  return lines;
}

export function getTrackJsonTimingMetadataLines(
  data: unknown,
): TrackMetadataSummaryLine[] {
  const lines: TrackMetadataSummaryLine[] = [];
  const metadata = getTrackJsonMetadata(data);
  const offsetSeconds = metadata
    ? getFiniteNumber(metadata.localTimeOffsetSeconds)
    : undefined;
  if (offsetSeconds !== undefined) {
    lines.push({
      key: "local-time-offset",
      text: `local time offset: ${formatTimeOffset(offsetSeconds)}`,
    });
  }
  lines.push(...getTrackJsonOverviewMetadataLines(data));
  return lines;
}

export function getTrackJsonPropertyMetadataLines(
  data: unknown,
): TrackMetadataSummaryLine[] {
  const lines = getTrackJsonTimingMetadataLines(data);
  const bbox = getTrackJsonBbox(data);
  if (bbox) {
    lines.push({
      key: "bbox",
      text:
        `bbox: west ${formatNumber(bbox[0], 5)}, ` +
        `south ${formatNumber(bbox[1], 5)}, ` +
        `east ${formatNumber(bbox[2], 5)}, ` +
        `north ${formatNumber(bbox[3], 5)}`,
    });
  }

  getTrackJsonPoi(data).forEach((point) => {
    const label = point.label?.trim();
    lines.push({
      key: `poi-${point.role}`,
      text:
        `poi ${point.role}: lon ${formatNumber(point.coordinates[0], 5)}, ` +
        `lat ${formatNumber(point.coordinates[1], 5)}` +
        (label ? `, label ${label}` : ""),
    });
  });

  return lines;
}

export function getTrackJsonDisplayMetadataLines(
  data: unknown,
): TrackMetadataSummaryLine[] {
  const metadata = getTrackJsonMetadata(data);
  if (!metadata || Object.keys(metadata).length === 0) {
    return [];
  }

  const lines: TrackMetadataSummaryLine[] = [];
  appendBasicMetadataLines(lines, metadata);
  lines.push(...getTrackJsonOverviewMetadataLines(data));
  lines.push(...getActivityMetadataSummaryLines({ metadata }));

  const propertyLines = getTrackJsonPropertyMetadataLines(data).filter((line) => {
    return line.key !== "time" && line.key !== "local-time-offset";
  });
  lines.push(...propertyLines);
  return deduplicateLines(lines);
}

function appendBasicMetadataLines(
  lines: TrackMetadataSummaryLine[],
  metadata: Record<string, unknown>,
) {
  appendStringLine(lines, metadata, "sport", "sport");
  appendStringLine(lines, metadata, "subSport", "sub sport");

  const createdAt = getFiniteNumber(metadata.createdAt);
  const offsetSeconds = getFiniteNumber(metadata.localTimeOffsetSeconds);
  if (createdAt !== undefined) {
    lines.push({
      key: "created-at",
      text: `created at: ${formatLocalDateTime(createdAt, offsetSeconds)}`,
    });
  }

  if (offsetSeconds !== undefined) {
    lines.push({
      key: "local-time-offset",
      text: `local time offset: ${formatTimeOffset(offsetSeconds)}`,
    });
  }
}

function appendStringLine(
  lines: TrackMetadataSummaryLine[],
  metadata: Record<string, unknown>,
  key: string,
  label: string,
) {
  const value = metadata[key];
  if (typeof value === "string" && value.trim()) {
    lines.push({ key, text: `${label}: ${value.trim()}` });
  }
}

function getMetadataEndTime(
  metadata: Record<string, unknown>,
  startTime: number | undefined,
): number | undefined {
  const endTime = getFiniteNumber(metadata.endTime);
  if (endTime !== undefined) {
    return endTime;
  }

  const elapsedTime = getFiniteNumber(metadata.totalElapsedTime);
  return startTime !== undefined && elapsedTime !== undefined
    ? startTime + elapsedTime
    : undefined;
}

function getTrackJsonBbox(
  data: unknown,
): [number, number, number, number] | undefined {
  if (!isRecord(data) || !Array.isArray(data.bbox) || data.bbox.length < 4) {
    return undefined;
  }

  const values = data.bbox.slice(0, 4);
  if (!values.every((value) => getFiniteNumber(value) !== undefined)) {
    return undefined;
  }

  return values as [number, number, number, number];
}

function formatLocalDateTime(
  unixSeconds: number,
  offsetSeconds: number | undefined,
): string {
  const adjustedSeconds = unixSeconds + (offsetSeconds ?? 0);
  const date = new Date(adjustedSeconds * 1000);
  return `${date.getUTCFullYear()}-${pad2(date.getUTCMonth() + 1)}-` +
    `${pad2(date.getUTCDate())} ${pad2(date.getUTCHours())}:` +
    `${pad2(date.getUTCMinutes())}:${pad2(date.getUTCSeconds())}`;
}

function formatTimeOffset(seconds: number): string {
  const rounded = Math.round(seconds);
  const sign = rounded < 0 ? "-" : "+";
  const absolute = Math.abs(rounded);
  const hours = Math.floor(absolute / 3600);
  const minutes = Math.floor((absolute % 3600) / 60);
  const restSeconds = absolute % 60;
  const prefix = `UTC${sign}${pad2(hours)}:${pad2(minutes)}`;
  return restSeconds > 0 ? `${prefix}:${pad2(restSeconds)}` : prefix;
}

function deduplicateLines(
  lines: TrackMetadataSummaryLine[],
): TrackMetadataSummaryLine[] {
  const seen = new Set<string>();
  return lines.filter((line) => {
    if (seen.has(line.key)) {
      return false;
    }
    seen.add(line.key);
    return true;
  });
}

function formatNumber(value: number, digits: number): string {
  return value.toFixed(digits);
}

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

function getFiniteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
