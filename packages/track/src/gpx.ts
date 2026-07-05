import { applyComputedMetadata } from "./activity";
import type {
  TrackActivity,
  TrackActivityMetadata,
  TrackPoint,
  TrackWarning,
} from "./activity";

export type ParseGpxOptions = {
  minPositionPoints?: number;
};

export type GpxParseErrorCode =
  "empty_input" | "parse_failed" | "invalid_root" | "no_track_points";

export class GpxParseError extends Error {
  public readonly code: GpxParseErrorCode;
  public readonly sourceType: string;

  constructor(code: GpxParseErrorCode, message: string) {
    super(message);
    this.name = "GpxParseError";
    this.code = code;
    this.sourceType = "gpx";
    Object.setPrototypeOf(this, GpxParseError.prototype);
  }
}

type ParsedGpxTime = {
  unixSeconds: number;
  offsetSeconds?: number;
};

const STGY_GPX_EXTENSION_NAMESPACE = "https://stgy.jp/xmlschemas/TrackActivity/v1";

export function parseGpxText(
  xmlText: string,
  options: ParseGpxOptions = {},
): TrackActivity {
  if (xmlText.trim().length === 0) {
    throw new GpxParseError("empty_input", "GPX input is empty.");
  }

  const document = parseGpxDocument(xmlText);
  const root = document.documentElement;
  if (!root || getLocalName(root) !== "gpx") {
    throw new GpxParseError("invalid_root", "GPX root element must be <gpx>.");
  }

  const segments = collectGpxPointSegments(root);
  const points = flattenGpxPointSegments(segments);
  const minPositionPoints = options.minPositionPoints ?? 2;
  const positionedPoints = points.filter(hasPosition);

  if (positionedPoints.length < minPositionPoints) {
    throw new GpxParseError(
      "no_track_points",
      `GPX data must contain at least ${minPositionPoints} positioned points.`,
    );
  }

  assignDistancesAndSpeeds(segments);

  const metadata = buildGpxMetadata(root, points);
  applyComputedMetadata(metadata, points);

  return {
    schemaVersion: 1,
    metadata,
    points,
    warnings: buildGpxWarnings(segments),
  };
}

function parseGpxDocument(xmlText: string): XMLDocument {
  let document: XMLDocument;
  try {
    document = new DOMParser().parseFromString(xmlText, "application/xml");
  } catch (e) {
    throw new GpxParseError(
      "parse_failed",
      `GPX XML could not be parsed: ${getErrorMessage(e)}`,
    );
  }

  const parserErrors = Array.from(document.getElementsByTagName("parsererror"));
  if (parserErrors.length > 0) {
    const message = parserErrors[0]?.textContent?.trim() || "XML parser error.";
    throw new GpxParseError("parse_failed", `GPX XML could not be parsed: ${message}`);
  }

  return document;
}

function collectGpxPointSegments(root: Element): TrackPoint[][] {
  const trackSegments = getDirectChildren(root, "trk").flatMap((track) => {
    return getDirectChildren(track, "trkseg").map((segment) => {
      return getDirectChildren(segment, "trkpt").map(gpxPointToTrackPoint);
    });
  });
  const nonEmptyTrackSegments = trackSegments.filter((segment) => segment.length > 0);
  if (nonEmptyTrackSegments.length > 0) {
    return nonEmptyTrackSegments;
  }

  const routeSegments = getDirectChildren(root, "rte").map((route) => {
    return getDirectChildren(route, "rtept").map(gpxPointToTrackPoint);
  });
  return routeSegments.filter((segment) => segment.length > 0);
}

function flattenGpxPointSegments(segments: TrackPoint[][]): TrackPoint[] {
  return segments.flatMap((segment, index) => {
    return index === 0 ? segment : [{}, ...segment];
  });
}

function gpxPointToTrackPoint(pointElement: Element): TrackPoint {
  const point: TrackPoint = {};
  const lat = parseOptionalNumber(pointElement.getAttribute("lat"));
  const lon = parseOptionalNumber(pointElement.getAttribute("lon"));

  if (isFiniteNumber(lat)) {
    point.lat = lat;
  }
  if (isFiniteNumber(lon)) {
    point.lon = lon;
  }

  const elevationM = parseOptionalNumber(getDirectChildText(pointElement, "ele"));
  if (isFiniteNumber(elevationM)) {
    point.elevationM = elevationM;
  }

  const time = parseGpxTime(getDirectChildText(pointElement, "time"));
  if (time) {
    point.time = time.unixSeconds;
  }

  assignExtensionNumber(point, "heartRateBpm", pointElement, [
    "hr",
    "heart_rate",
    "heartrate",
    "heartRate",
  ]);
  assignExtensionNumber(point, "cadenceRpm", pointElement, [
    "cad",
    "cadence",
    "bikecadence",
    "bikeCadence",
  ]);
  assignExtensionNumber(point, "powerW", pointElement, [
    "power",
    "watts",
    "powerw",
    "powerW",
  ]);
  assignExtensionNumber(point, "temperatureC", pointElement, [
    "atemp",
    "temp",
    "temperature",
  ]);
  assignExtensionNumber(point, "speedMps", pointElement, [
    "speed",
    "speedmps",
    "speedMps",
  ]);

  return point;
}

function assignExtensionNumber<K extends keyof TrackPoint>(
  point: TrackPoint,
  key: K,
  pointElement: Element,
  localNames: string[],
) {
  const value = findDescendantNumber(pointElement, localNames);
  if (isFiniteNumber(value)) {
    point[key] = value as TrackPoint[K];
  }
}

function buildGpxMetadata(root: Element, points: TrackPoint[]): TrackActivityMetadata {
  const metadataElement = getDirectChild(root, "metadata");
  const firstTrack = getDirectChild(root, "trk");
  const firstRoute = getDirectChild(root, "rte");
  const metadataTime = parseGpxTime(getDirectChildText(metadataElement, "time"));
  const pointTimes = points.map((point) => point.time).filter(isFiniteNumber);
  const timeRange = pointTimes.length > 0
    ? { startTime: Math.min(...pointTimes), endTime: Math.max(...pointTimes) }
    : undefined;
  const metadata: TrackActivityMetadata = {
    source: {
      type: "gpx",
      formatVersion: root.getAttribute("version") || undefined,
    },
  };

  assignNonEmptyString(
    metadata,
    "name",
    getDirectChildText(metadataElement, "name") ||
      getDirectChildText(firstTrack, "name") ||
      getDirectChildText(firstRoute, "name"),
  );
  assignNonEmptyString(
    metadata,
    "description",
    getDirectChildText(metadataElement, "desc") ||
      getDirectChildText(firstTrack, "desc") ||
      getDirectChildText(firstRoute, "desc"),
  );

  if (metadataTime) {
    metadata.createdAt = metadataTime.unixSeconds;
  } else if (timeRange) {
    metadata.createdAt = timeRange.startTime;
  }

  if (timeRange) {
    metadata.startTime = timeRange.startTime;
    metadata.endTime = timeRange.endTime;
    metadata.totalElapsedTime = Math.max(0, timeRange.endTime - timeRange.startTime);
  }

  const localTimeOffsetSeconds = getCommonLocalTimeOffset(root);
  if (isFiniteNumber(localTimeOffsetSeconds)) {
    metadata.localTimeOffsetSeconds = localTimeOffsetSeconds;
  }

  const totalDistanceM = getTotalDistanceM(points);
  if (isFiniteNumber(totalDistanceM) && totalDistanceM > 0) {
    metadata.totalDistanceM = totalDistanceM;
  }

  applyGpxActivityExtensionMetadata(metadata, metadataElement);

  return metadata;
}

function applyGpxActivityExtensionMetadata(
  metadata: TrackActivityMetadata,
  metadataElement: Element | undefined,
) {
  const activityElement = metadataElement
    ? getAllDescendants(metadataElement).find((element) => {
      return getLocalName(element) === "TrackActivity";
    })
    : undefined;
  if (!activityElement) {
    return;
  }

  assignGpxActivityExtensionNumber(metadata, activityElement, "startTime");
  assignGpxActivityExtensionNumber(metadata, activityElement, "endTime");
  assignGpxActivityExtensionNumber(metadata, activityElement, "totalElapsedTime");
  assignGpxActivityExtensionNumber(metadata, activityElement, "totalTimerTime");
  assignGpxActivityExtensionNumber(metadata, activityElement, "totalDistanceM");
  assignGpxActivityExtensionNumber(
    metadata,
    activityElement,
    "localTimeOffsetSeconds",
  );

  const totalCaloriesCal = parseOptionalNumber(
    getDirectChildText(activityElement, "totalCaloriesCal"),
  );
  if (isFiniteNumber(totalCaloriesCal)) {
    metadata.training = {
      ...(metadata.training || {}),
      totalCaloriesCal,
      source: {
        ...(metadata.training?.source || {}),
        totalCalories: "fit",
      },
    };
  }
}

function assignGpxActivityExtensionNumber(
  metadata: TrackActivityMetadata,
  activityElement: Element,
  key: keyof TrackActivityMetadata,
) {
  const value = parseOptionalNumber(getDirectChildText(activityElement, String(key)));
  if (isFiniteNumber(value)) {
    metadata[key] = value as never;
  }
}

function getCommonLocalTimeOffset(root: Element): number | undefined {
  const offsets = getAllDescendants(root)
    .filter((element) => getLocalName(element) === "time")
    .map((element) => parseGpxTime(element.textContent || ""))
    .map((time) => time?.offsetSeconds)
    .filter(isFiniteNumber);
  const first = offsets[0];

  if (!isFiniteNumber(first)) {
    return undefined;
  }

  return offsets.every((offset) => offset === first) ? first : undefined;
}

function assignDistancesAndSpeeds(segments: TrackPoint[][]) {
  let cumulativeDistanceM = 0;

  segments.forEach((segment) => {
    let previous: (TrackPoint & { lat: number; lon: number }) | undefined;

    segment.forEach((point) => {
      if (!hasPosition(point)) {
        point.distanceM = cumulativeDistanceM;
        return;
      }

      if (previous) {
        const segmentDistanceM = calculateDistanceM(previous, point);
        cumulativeDistanceM += segmentDistanceM;

        if (
          !isFiniteNumber(point.speedMps) &&
          isFiniteNumber(previous.time) &&
          isFiniteNumber(point.time)
        ) {
          const deltaSeconds = point.time - previous.time;
          if (deltaSeconds > 0 && deltaSeconds <= 300) {
            point.speedMps = segmentDistanceM / deltaSeconds;
          }
        }
      }

      point.distanceM = cumulativeDistanceM;
      previous = point;
    });
  });
}

function getTotalDistanceM(points: TrackPoint[]): number | undefined {
  const distances = points.map((point) => point.distanceM).filter(isFiniteNumber);
  if (distances.length < 2) {
    return undefined;
  }

  return Math.max(...distances) - Math.min(...distances);
}

function buildGpxWarnings(segments: TrackPoint[][]): TrackWarning[] {
  if (segments.length <= 1) {
    return [];
  }

  return [
    {
      code: "gpx_multiple_segments",
      message: `GPX contains ${segments.length} track segments. ` +
        "They were flattened into one TrackActivity.",
    },
  ];
}

function findDescendantNumber(root: Element, localNames: string[]): number | undefined {
  const names = new Set(localNames.map(normalizeLocalName));
  const match = getAllDescendants(root).find((element) => {
    return names.has(normalizeLocalName(getLocalName(element)));
  });

  return parseOptionalNumber(match?.textContent);
}

function getAllDescendants(root: Element): Element[] {
  return Array.from(root.getElementsByTagName("*"));
}

function getDirectChild(parent: Element | undefined, localName: string): Element | undefined {
  return getDirectChildren(parent, localName)[0];
}

function getDirectChildren(parent: Element | undefined, localName: string): Element[] {
  if (!parent) {
    return [];
  }

  return Array.from(parent.children).filter((child) => {
    return getLocalName(child) === localName;
  });
}

function getDirectChildText(parent: Element | undefined, localName: string): string | undefined {
  const text = getDirectChild(parent, localName)?.textContent?.trim();
  return text || undefined;
}

function getLocalName(element: Element): string {
  return element.localName || element.nodeName.replace(/^.*:/u, "");
}

function normalizeLocalName(name: string): string {
  return name.replace(/[-_\s]/gu, "").toLowerCase();
}

function parseOptionalNumber(value: unknown): number | undefined {
  if (typeof value !== "string" || value.trim().length === 0) {
    return undefined;
  }

  const parsed = Number(value.trim());
  return Number.isFinite(parsed) ? parsed : undefined;
}

function parseGpxTime(value: string | undefined): ParsedGpxTime | undefined {
  if (!value) {
    return undefined;
  }

  const trimmed = value.trim();
  const milliseconds = Date.parse(trimmed);
  if (!Number.isFinite(milliseconds)) {
    return undefined;
  }

  const offsetSeconds = parseIsoLocalTimeOffsetSeconds(trimmed);
  return {
    unixSeconds: milliseconds / 1000,
    ...(isFiniteNumber(offsetSeconds) ? { offsetSeconds } : {}),
  };
}

function parseIsoLocalTimeOffsetSeconds(value: string): number | undefined {
  const match = value.match(/([+-])(\d{2}):?(\d{2})(?::?(\d{2}))?$/u);
  if (!match) {
    return undefined;
  }

  const sign = match[1] === "-" ? -1 : 1;
  const hours = Number(match[2]);
  const minutes = Number(match[3]);
  const seconds = Number(match[4] || "0");

  if (
    !Number.isInteger(hours) ||
    !Number.isInteger(minutes) ||
    !Number.isInteger(seconds)
  ) {
    return undefined;
  }

  return sign * (hours * 3600 + minutes * 60 + seconds);
}

function assignNonEmptyString<K extends "name" | "description">(
  metadata: TrackActivityMetadata,
  key: K,
  value: string | undefined,
) {
  if (typeof value === "string" && value.trim()) {
    metadata[key] = value.trim();
  }
}

function hasPosition(point: TrackPoint): point is TrackPoint & { lat: number; lon: number } {
  return isFiniteNumber(point.lat) && isFiniteNumber(point.lon);
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

function degreesToRadians(value: number): number {
  return (value * Math.PI) / 180;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function getErrorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

export type GpxExportOptions = {
  creator?: string;
  name?: string;
  description?: string;
  includeExtensions?: boolean;
  coordinatePrecision?: number;
  elevationPrecision?: number;
};

export type GpxExportErrorCode = "no_position_points" | "not_enough_position_points";

export class GpxExportError extends Error {
  public readonly code: GpxExportErrorCode;

  constructor(code: GpxExportErrorCode, message: string) {
    super(message);
    this.name = "GpxExportError";
    this.code = code;
    Object.setPrototypeOf(this, GpxExportError.prototype);
  }
}

export function trackActivityToGpx(
  activity: TrackActivity,
  options: GpxExportOptions = {},
): string {
  const segments = splitGpxExportSegments(activity.points);
  const positionedPointCount = segments.reduce((sum, segment) => sum + segment.length, 0);
  if (positionedPointCount === 0) {
    throw new GpxExportError(
      "no_position_points",
      "Track activity does not contain positioned points.",
    );
  }
  if (positionedPointCount < 2) {
    throw new GpxExportError(
      "not_enough_position_points",
      "At least two positioned points are required to export GPX.",
    );
  }

  const creator = options.creator || "stgy-track";
  const coordinatePrecision = options.coordinatePrecision ?? 7;
  const elevationPrecision = options.elevationPrecision ?? 1;
  const name = options.name || activity.metadata.name || "Track";
  const description = options.description || activity.metadata.description;
  const createdAt = activity.metadata.createdAt ?? activity.metadata.startTime;
  const metadataExtensionLines = formatGpxActivityMetadataExtensions(activity);
  const lines: string[] = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<gpx creator="${escapeXmlAttribute(creator)}" version="1.1" ` +
      'xmlns="http://www.topografix.com/GPX/1/1" ' +
      'xmlns:gpxtpx="http://www.garmin.com/xmlschemas/TrackPointExtension/v1" ' +
      `xmlns:stgy="${STGY_GPX_EXTENSION_NAMESPACE}">`,
  ];

  if (
    isFiniteNumber(createdAt) ||
    isNonEmptyText(name) ||
    isNonEmptyText(description) ||
    metadataExtensionLines.length > 0
  ) {
    lines.push("  <metadata>");
    if (isNonEmptyText(name)) {
      lines.push(`    <name>${escapeXmlText(name)}</name>`);
    }
    if (isNonEmptyText(description)) {
      lines.push(`    <desc>${escapeXmlText(description)}</desc>`);
    }
    if (isFiniteNumber(createdAt)) {
      lines.push(`    <time>${formatGpxTime(createdAt)}</time>`);
    }
    if (metadataExtensionLines.length > 0) {
      lines.push("    <extensions>");
      lines.push(...metadataExtensionLines.map((line) => `      ${line}`));
      lines.push("    </extensions>");
    }
    lines.push("  </metadata>");
  }

  lines.push("  <trk>");
  if (isNonEmptyText(name)) {
    lines.push(`    <name>${escapeXmlText(name)}</name>`);
  }
  if (isNonEmptyText(description)) {
    lines.push(`    <desc>${escapeXmlText(description)}</desc>`);
  }
  if (isNonEmptyText(activity.metadata.sport)) {
    lines.push(`    <type>${escapeXmlText(activity.metadata.sport)}</type>`);
  }

  segments.forEach((segment) => {
    lines.push("    <trkseg>");
    segment.forEach((point) => {
      lines.push(formatGpxTrackPoint(point, {
        coordinatePrecision,
        elevationPrecision,
        includeExtensions: options.includeExtensions !== false,
      }));
    });
    lines.push("    </trkseg>");
  });

  lines.push("  </trk>");
  lines.push("</gpx>");
  return `${lines.join("\n")}\n`;
}

function formatGpxActivityMetadataExtensions(activity: TrackActivity): string[] {
  const values: [string, number | undefined][] = [
    ["startTime", activity.metadata.startTime],
    ["endTime", activity.metadata.endTime],
    ["totalElapsedTime", activity.metadata.totalElapsedTime],
    ["totalTimerTime", activity.metadata.totalTimerTime],
    ["totalDistanceM", activity.metadata.totalDistanceM],
    ["localTimeOffsetSeconds", activity.metadata.localTimeOffsetSeconds],
    ["totalCaloriesCal", activity.metadata.training?.totalCaloriesCal],
  ];
  const lines = values
    .filter((entry): entry is [string, number] => isFiniteNumber(entry[1]))
    .map(([key, value]) => {
      return `<stgy:${key}>${formatGpxMetadataNumber(value)}</stgy:${key}>`;
    });

  if (lines.length === 0) {
    return [];
  }

  return [
    "<stgy:TrackActivity>",
    ...lines.map((line) => `  ${line}`),
    "</stgy:TrackActivity>",
  ];
}

function formatGpxMetadataNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : String(value);
}

type GpxTrackPointFormatOptions = {
  coordinatePrecision: number;
  elevationPrecision: number;
  includeExtensions: boolean;
};

function splitGpxExportSegments(
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

function formatGpxTrackPoint(
  point: TrackPoint & { lat: number; lon: number },
  options: GpxTrackPointFormatOptions,
): string {
  const lines = [
    `      <trkpt lat="${formatGpxNumber(point.lat, options.coordinatePrecision)}" ` +
      `lon="${formatGpxNumber(point.lon, options.coordinatePrecision)}">`,
  ];

  if (isFiniteNumber(point.elevationM)) {
    lines.push(`        <ele>${formatGpxNumber(point.elevationM, options.elevationPrecision)}</ele>`);
  }
  if (isFiniteNumber(point.time)) {
    lines.push(`        <time>${formatGpxTime(point.time)}</time>`);
  }

  const extensionLines = options.includeExtensions ? formatGpxPointExtensions(point) : [];
  if (extensionLines.length > 0) {
    lines.push("        <extensions>");
    lines.push(...extensionLines.map((line) => `          ${line}`));
    lines.push("        </extensions>");
  }

  lines.push("      </trkpt>");
  return lines.join("\n");
}

function formatGpxPointExtensions(point: TrackPoint): string[] {
  const lines: string[] = [];
  if (isFiniteNumber(point.powerW)) {
    lines.push(`<power>${Math.round(point.powerW)}</power>`);
  }
  if (isFiniteNumber(point.speedMps)) {
    lines.push(`<speed>${formatGpxNumber(point.speedMps, 3)}</speed>`);
  }

  const trackPointExtensions: string[] = [];
  if (isFiniteNumber(point.temperatureC)) {
    trackPointExtensions.push(`<gpxtpx:atemp>${Math.round(point.temperatureC)}</gpxtpx:atemp>`);
  }
  if (isFiniteNumber(point.heartRateBpm)) {
    trackPointExtensions.push(`<gpxtpx:hr>${Math.round(point.heartRateBpm)}</gpxtpx:hr>`);
  }
  if (isFiniteNumber(point.cadenceRpm)) {
    trackPointExtensions.push(`<gpxtpx:cad>${Math.round(point.cadenceRpm)}</gpxtpx:cad>`);
  }

  if (trackPointExtensions.length > 0) {
    lines.push("<gpxtpx:TrackPointExtension>");
    lines.push(...trackPointExtensions.map((line) => `  ${line}`));
    lines.push("</gpxtpx:TrackPointExtension>");
  }

  return lines;
}

function formatGpxNumber(value: number, precision: number): string {
  return value.toFixed(precision).replace(/(?:\.0+|(?<nonzero>\.\d*?)0+)$/u, "$<nonzero>");
}

function formatGpxTime(unixSeconds: number): string {
  return new Date(Math.round(unixSeconds * 1000)).toISOString();
}

function isNonEmptyText(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function escapeXmlText(value: string): string {
  return value
    .replace(/&/gu, "&amp;")
    .replace(/</gu, "&lt;")
    .replace(/>/gu, "&gt;");
}

function escapeXmlAttribute(value: string): string {
  return escapeXmlText(value).replace(/"/gu, "&quot;");
}

