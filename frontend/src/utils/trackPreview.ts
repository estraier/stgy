import type { TrackActivityMetadata } from "stgy-track/activity";
import { getTrackFileKind, getTrackUploadContentType, getTrackUploadFilename } from "./tracks";

export const TRACK_UPLOAD_PREVIEW_MAX_POINTS = 3000;
export const TRACK_OBFUSCATION_DEFAULT_DISTANCE_M = 1000;
export const TRACK_OBFUSCATION_MAX_ROUTE_RATIO = 0.05;

export type TrackUploadPreviewMetadata = Pick<
  TrackActivityMetadata,
  "startTime" | "localTimeOffsetSeconds" | "totalDistanceM" | "totalElapsedTime"
>;

export type TrackUploadPreview = {
  json: string;
  metadata: TrackUploadPreviewMetadata;
};

export type TrackUploadObfuscationOptions = {
  enabled: boolean;
  startDistanceM: number;
  endDistanceM: number;
};

export type TrackObfuscationDistances = {
  startDistanceM: number;
  endDistanceM: number;
};

export type PreparedTrackUpload = {
  payload: Blob | File;
  filename: string;
  contentType: string;
};

type TrackPreviewFile = Pick<File, "name" | "arrayBuffer">;

export async function makeTrackUploadPreview(
  file: TrackPreviewFile,
  maxPoints = TRACK_UPLOAD_PREVIEW_MAX_POINTS,
  obfuscation?: TrackUploadObfuscationOptions,
): Promise<TrackUploadPreview> {
  const kind = getTrackFileKind(file.name);
  if (kind === "FIT") {
    return makeFitPreview(await file.arrayBuffer(), maxPoints, obfuscation);
  }
  if (kind === "GPX") {
    return makeGpxPreview(decodeUtf8(await file.arrayBuffer()), maxPoints);
  }
  if (kind === "TRJ") {
    return makeTrackJsonPreview(decodeUtf8(await file.arrayBuffer()), maxPoints);
  }
  if (kind === "TRJGZ") {
    const text = await decompressGzipText(await file.arrayBuffer());
    return makeTrackJsonPreview(text, maxPoints);
  }
  throw new Error("Only FIT, GPX, TRJ, and TRJGZ files are supported.");
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
  obfuscation?: TrackUploadObfuscationOptions,
): Promise<TrackUploadPreview> {
  const fit = await import("stgy-track/fit");
  const sourceBytes = obfuscation?.enabled
    ? fit.obfuscateFitPrivacy(bytes, {
        startDistanceM: obfuscation.startDistanceM,
        endDistanceM: obfuscation.endDistanceM,
      })
    : bytes;
  const activity = fit.parseFitBytes(sourceBytes);
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

export async function makeGpxPreview(
  text: string,
  maxPoints = TRACK_UPLOAD_PREVIEW_MAX_POINTS,
): Promise<TrackUploadPreview> {
  const [fit, gpx] = await Promise.all([import("stgy-track/fit"), import("stgy-track/gpx")]);
  const activity = gpx.parseGpxText(text);
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

export function createTrackObfuscationDistances(
  totalDistanceM: number | undefined,
): TrackObfuscationDistances {
  const defaultDistanceM = normalizeTrackObfuscationDistance(
    TRACK_OBFUSCATION_DEFAULT_DISTANCE_M,
    totalDistanceM,
  );
  return {
    startDistanceM: defaultDistanceM,
    endDistanceM: defaultDistanceM,
  };
}

export function getTrackObfuscationMaxDistance(
  totalDistanceM: number | undefined,
): number | undefined {
  if (!isFiniteNumber(totalDistanceM) || totalDistanceM < 0) return undefined;
  return Math.max(0, Math.floor(totalDistanceM * TRACK_OBFUSCATION_MAX_ROUTE_RATIO));
}

export function normalizeTrackObfuscationDistance(
  value: number,
  totalDistanceM: number | undefined,
): number {
  const normalized = Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
  const maxDistanceM = getTrackObfuscationMaxDistance(totalDistanceM);
  return maxDistanceM === undefined ? normalized : Math.min(normalized, maxDistanceM);
}

export async function prepareTrackUploadPayload(
  file: File,
  obfuscation?: TrackUploadObfuscationOptions,
): Promise<PreparedTrackUpload> {
  const kind = getTrackFileKind(file.name);
  if (!kind) {
    throw new Error("Only FIT, GPX, TRJ, and TRJGZ files are supported.");
  }

  const filename = getTrackUploadFilename(file.name);
  const contentType = getTrackUploadContentType(filename);

  if (kind === "FIT") {
    if (!obfuscation?.enabled) {
      return { payload: file, filename, contentType };
    }
    const fit = await import("stgy-track/fit");
    const output = fit.obfuscateFitPrivacy(await file.arrayBuffer(), {
      startDistanceM: obfuscation.startDistanceM,
      endDistanceM: obfuscation.endDistanceM,
    });
    return {
      payload: new Blob([copyUint8ArrayToArrayBuffer(output)], { type: contentType }),
      filename,
      contentType,
    };
  }

  if (kind === "TRJGZ") {
    return { payload: file, filename, contentType };
  }

  const sourceText = decodeUtf8(await file.arrayBuffer());
  let trackJson: string;
  if (kind === "GPX") {
    const [fit, gpx] = await Promise.all([import("stgy-track/fit"), import("stgy-track/gpx")]);
    trackJson = fit.trackActivityToTrackJson(gpx.parseGpxText(sourceText), { pretty: false });
  } else {
    const trackjson = await import("stgy-track/trackjson");
    const parsed = trackjson.parseTrackJsonData(sourceText);
    trackJson = JSON.stringify(trackjson.compactTrackJsonData(parsed));
  }

  return {
    payload: await compressGzipText(trackJson),
    filename,
    contentType,
  };
}

function copyUint8ArrayToArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
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
    return (
      `${hours}:${String(minutes).padStart(2, "0")}:` + String(remainingSeconds).padStart(2, "0")
    );
  }
  return `${minutes}:${String(remainingSeconds).padStart(2, "0")}`;
}

function pickPreviewMetadata(metadata: TrackActivityMetadata): TrackUploadPreviewMetadata {
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

  return (
    `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")} ` +
    `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:` +
    String(seconds).padStart(2, "0")
  );
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

function decodeUtf8(buffer: ArrayBuffer): string {
  return new TextDecoder("utf-8").decode(buffer);
}

async function compressGzipText(text: string): Promise<Blob> {
  if (typeof CompressionStream === "undefined") {
    throw new Error("This browser does not support TRJGZ compression.");
  }

  const stream = new Blob([text]).stream().pipeThrough(new CompressionStream("gzip"));
  return new Blob([await new Response(stream).arrayBuffer()], {
    type: "application/gzip",
  });
}

async function decompressGzipText(buffer: ArrayBuffer): Promise<string> {
  if (typeof DecompressionStream === "undefined") {
    throw new Error("This browser does not support TRJGZ decompression.");
  }

  const stream = new Blob([buffer]).stream().pipeThrough(new DecompressionStream("gzip"));
  return new Response(stream).text();
}
