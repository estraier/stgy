import type { TrackActivityMetadata } from "stgy-track/activity";
import { getTrackFileKind } from "./tracks";

export const TRACK_UPLOAD_PREVIEW_MAX_POINTS = 3000;

export type TrackUploadPreviewMetadata = Pick<
  TrackActivityMetadata,
  | "startTime"
  | "localTimeOffsetSeconds"
  | "totalDistanceM"
  | "totalElapsedTime"
>;

export type TrackUploadPreview = {
  json: string;
  metadata: TrackUploadPreviewMetadata;
};

type TrackPreviewFile = Pick<File, "name" | "arrayBuffer">;

export async function makeTrackUploadPreview(
  file: TrackPreviewFile,
  maxPoints = TRACK_UPLOAD_PREVIEW_MAX_POINTS,
): Promise<TrackUploadPreview> {
  const kind = getTrackFileKind(file.name);
  if (kind === "FIT") {
    return makeFitPreview(await file.arrayBuffer(), maxPoints);
  }
  if (kind === "TRJGZ") {
    const text = await decompressGzipText(await file.arrayBuffer());
    return makeTrackJsonPreview(text, maxPoints);
  }
  throw new Error("Only FIT and TRJGZ files are supported.");
}

export async function makeTrackUploadPreviewJson(
  file: TrackPreviewFile,
  maxPoints = TRACK_UPLOAD_PREVIEW_MAX_POINTS,
): Promise<string> {
  return (await makeTrackUploadPreview(file, maxPoints)).json;
}

export async function makeFitPreview(
  bytes: ArrayBuffer,
  maxPoints = TRACK_UPLOAD_PREVIEW_MAX_POINTS,
): Promise<TrackUploadPreview> {
  const fit = await import("stgy-track/fit");
  const activity = fit.parseFitBytes(bytes);
  const preview = fit.downsampleTrackActivity(activity, {
    maxPoints,
    strategy: "uniform",
    preserveEndpoints: true,
  });
  return {
    json: fit.trackActivityToTrackJson(preview, {
      pretty: false,
    }),
    metadata: pickPreviewMetadata(activity.metadata),
  };
}

export async function makeFitPreviewJson(
  bytes: ArrayBuffer,
  maxPoints = TRACK_UPLOAD_PREVIEW_MAX_POINTS,
): Promise<string> {
  return (await makeFitPreview(bytes, maxPoints)).json;
}

export async function makeTrackJsonPreview(
  text: string,
  maxPoints = TRACK_UPLOAD_PREVIEW_MAX_POINTS,
): Promise<TrackUploadPreview> {
  const [fit, trackjson] = await Promise.all([
    import("stgy-track/fit"),
    import("stgy-track/trackjson"),
  ]);
  const data = trackjson.parseTrackJsonData(text);
  const activity = fit.trackJsonDataToTrackActivity(data);
  const preview = trackjson.downsampleTrackJsonData(data, {
    maxPoints,
    strategy: "uniform",
    preserveEndpoints: true,
  });
  return {
    json: JSON.stringify(trackjson.compactTrackJsonData(preview)),
    metadata: pickPreviewMetadata(activity.metadata),
  };
}

export async function makeTrackJsonPreviewJson(
  text: string,
  maxPoints = TRACK_UPLOAD_PREVIEW_MAX_POINTS,
): Promise<string> {
  return (await makeTrackJsonPreview(text, maxPoints)).json;
}

export function formatTrackPreviewStartTime(
  metadata: TrackUploadPreviewMetadata,
): string | undefined {
  const startTime = metadata.startTime;
  if (!isFiniteNumber(startTime)) return undefined;

  const offsetSeconds = metadata.localTimeOffsetSeconds;
  if (isFiniteNumber(offsetSeconds)) {
    return formatDateTimeParts(new Date((startTime + offsetSeconds) * 1000), true);
  }
  return formatDateTimeParts(new Date(startTime * 1000), false);
}

export function formatTrackPreviewDistance(
  metadata: TrackUploadPreviewMetadata,
): string | undefined {
  const distanceM = metadata.totalDistanceM;
  if (!isFiniteNumber(distanceM) || distanceM < 0) return undefined;
  if (distanceM >= 1000) {
    return `${formatNumber(distanceM / 1000, 2)} km`;
  }
  return `${formatNumber(distanceM, 0)} m`;
}

export function formatTrackPreviewElapsedTime(
  metadata: TrackUploadPreviewMetadata,
): string | undefined {
  const seconds = metadata.totalElapsedTime;
  if (!isFiniteNumber(seconds) || seconds < 0) return undefined;

  const total = Math.round(seconds);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const remainingSeconds = total % 60;

  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, "0")}:` +
      String(remainingSeconds).padStart(2, "0");
  }
  return `${minutes}:${String(remainingSeconds).padStart(2, "0")}`;
}

function pickPreviewMetadata(
  metadata: TrackActivityMetadata,
): TrackUploadPreviewMetadata {
  const output: TrackUploadPreviewMetadata = {};
  if (isFiniteNumber(metadata.startTime)) output.startTime = metadata.startTime;
  if (isFiniteNumber(metadata.localTimeOffsetSeconds)) {
    output.localTimeOffsetSeconds = metadata.localTimeOffsetSeconds;
  }
  if (isFiniteNumber(metadata.totalDistanceM)) {
    output.totalDistanceM = metadata.totalDistanceM;
  }
  if (isFiniteNumber(metadata.totalElapsedTime)) {
    output.totalElapsedTime = metadata.totalElapsedTime;
  }
  return output;
}

function formatDateTimeParts(date: Date, useUtcFields: boolean): string {
  const year = useUtcFields ? date.getUTCFullYear() : date.getFullYear();
  const month = useUtcFields ? date.getUTCMonth() + 1 : date.getMonth() + 1;
  const day = useUtcFields ? date.getUTCDate() : date.getDate();
  const hours = useUtcFields ? date.getUTCHours() : date.getHours();
  const minutes = useUtcFields ? date.getUTCMinutes() : date.getMinutes();
  const seconds = useUtcFields ? date.getUTCSeconds() : date.getSeconds();

  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")} ` +
    `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:` +
    String(seconds).padStart(2, "0");
}

function formatNumber(value: number, fractionDigits: number): string {
  return value.toLocaleString(undefined, {
    maximumFractionDigits: fractionDigits,
    minimumFractionDigits: fractionDigits,
  });
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

async function decompressGzipText(buffer: ArrayBuffer): Promise<string> {
  if (typeof DecompressionStream === "undefined") {
    throw new Error("This browser does not support TRJGZ decompression.");
  }

  const stream = new Blob([buffer]).stream().pipeThrough(new DecompressionStream("gzip"));
  return new Response(stream).text();
}
