import type { TrackActivityMetadata } from "stgy-track/activity";
import type { TrackMetadataSummaryLine } from "stgy-track/analysis";

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

export function getTrackSandboxMetadataSummaryLines(
  lines: TrackMetadataSummaryLine[],
): TrackMetadataSummaryLine[] {
  const byKey = new Map(lines.map((line) => [line.key, line]));
  const ordered: TrackMetadataSummaryLine[] = [];

  ["gross", "net", "elevation"].forEach((key) => {
    const line = byKey.get(key);
    if (line) {
      ordered.push(line);
    }
  });

  lines.forEach((line) => {
    const isHeader = line.key === "gross" || line.key === "net" ||
      line.key === "elevation";
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

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}
