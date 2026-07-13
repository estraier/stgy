import type { TrackActivityMetadata } from "stgy-track/activity";
import type { TrackMetadataSummaryLine } from "stgy-track/analysis";
import { getTrackJsonPoi } from "stgy-track/trackjson";
import { getTrackJsonTimingMetadataLines } from "stgy-track/metadata";

export type TrackElevationSummaryItem = {
  key: "ascent" | "descent";
  label: "Ascent" | "Descent";
  valueM: number;
};

export function getTrackElevationSummaryItems(
  metadata: TrackActivityMetadata,
): TrackElevationSummaryItem[] {
  const items: TrackElevationSummaryItem[] = [];

  if (isFiniteNumber(metadata.ascentM)) {
    items.push({ key: "ascent", label: "Ascent", valueM: metadata.ascentM });
  }
  if (isFiniteNumber(metadata.descentM)) {
    items.push({ key: "descent", label: "Descent", valueM: metadata.descentM });
  }

  return items;
}

export function getTrackJsonPropertySummaryLines(
  data: unknown,
): TrackMetadataSummaryLine[] {
  if (!isRecord(data)) {
    return [];
  }

  const lines: TrackMetadataSummaryLine[] = [
    ...getTrackJsonTimingMetadataLines(data),
  ];
  if (Array.isArray(data.bbox)) {
    lines.push({ key: "bbox", text: `bbox: ${JSON.stringify(data.bbox)}` });
  }
  getTrackJsonPoi(data).forEach((point) => {
    lines.push({
      key: `poi-${point.role}`,
      text:
        `poi ${point.role}: lon ${formatCoordinate(point.coordinates[0])}, ` +
        `lat ${formatCoordinate(point.coordinates[1])}`,
    });
  });
  return lines;
}

export function getTrackSandboxMetadataSummaryLines(
  lines: TrackMetadataSummaryLine[],
): TrackMetadataSummaryLine[] {
  const byKey = new Map(lines.map((line) => [line.key, line]));
  const ordered: TrackMetadataSummaryLine[] = [];

  const headerKeys = [
    "local-time-offset",
    "time",
    "gross",
    "net",
    "elevation",
    "bbox",
  ];
  headerKeys.forEach((key) => {
    const line = byKey.get(key);
    if (line) {
      ordered.push(line);
    }
  });

  lines.filter(isPoiSummaryLine).forEach((line) => ordered.push(line));

  lines.forEach((line) => {
    const isHeader = line.key === "gross" || line.key === "net" ||
      line.key === "elevation" || line.key === "bbox" ||
      line.key === "local-time-offset" || line.key === "time" ||
      isPoiSummaryLine(line);
    if (line.key !== "analysis" && !isHeader) {
      ordered.push(line);
    }
  });

  return ordered;
}

export function orderTrackSandboxSummaryCards<T extends { label: string }>(
  cards: T[],
): T[] {
  const order = new Map([
    ["Context", 0],
    ["Elapsed time", 1],
    ["Moving time", 2],
    ["Total distance", 3],
    ["Average speed", 4],
  ]);

  return cards
    .map((card, index) => ({ card, index }))
    .sort((a, b) => {
      if (a.card.label === "Average temperature") return 1;
      if (b.card.label === "Average temperature") return -1;
      const aOrder = order.get(a.card.label);
      const bOrder = order.get(b.card.label);
      if (aOrder != null || bOrder != null) {
        return (aOrder ?? Number.MAX_SAFE_INTEGER) -
          (bOrder ?? Number.MAX_SAFE_INTEGER);
      }
      return a.index - b.index;
    })
    .map(({ card }) => card);
}

function isPoiSummaryLine(line: TrackMetadataSummaryLine): boolean {
  return line.key.startsWith("poi-");
}

function formatCoordinate(value: number): string {
  return value.toFixed(5);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}
