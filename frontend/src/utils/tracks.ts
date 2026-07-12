import type { TrackObject } from "@/api/models";

export type StoredTrackFileKind = "FIT" | "TRJGZ";
export type TrackFileKind = StoredTrackFileKind | "GPX" | "TRJ";

export function getTrackFileKind(filename: string): TrackFileKind | null {
  const lower = filename.trim().toLowerCase();
  if (lower.endsWith(".fit")) return "FIT";
  if (lower.endsWith(".gpx")) return "GPX";
  if (lower.endsWith(".trj")) return "TRJ";
  if (lower.endsWith(".trjgz")) return "TRJGZ";
  return null;
}

export function getTrackUploadFilename(filename: string): string {
  const kind = getTrackFileKind(filename);
  if (kind !== "GPX" && kind !== "TRJ") return filename;
  return filename.replace(/\.(?:gpx|trj)$/i, ".trjgz");
}

export function getTrackUploadContentType(filename: string): string {
  const kind = getTrackFileKind(filename);
  return kind === "FIT" ? "application/octet-stream" : "application/gzip";
}

export function getTrackUploadDialogGridClass(itemCount: number): string {
  if (itemCount <= 1) return "grid-cols-1";
  if (itemCount === 2) return "grid-cols-1 sm:grid-cols-2";
  return "grid-cols-1 sm:grid-cols-2 md:grid-cols-3";
}

export function restPathFromTrackKey(key: string, userId: string): string {
  const prefix = `${userId}/`;
  return key.startsWith(prefix) ? key.slice(prefix.length) : key;
}

export function getTrackObjectKind(track: Pick<TrackObject, "key">): StoredTrackFileKind | null {
  const kind = getTrackFileKind(track.key);
  return kind === "FIT" || kind === "TRJGZ" ? kind : null;
}

export function makeTrackMarkdown(track: Pick<TrackObject, "previewKey">): string {
  return `@[](/tracks/${track.previewKey})`;
}

export function makeTrackOriginalViewerUrl(trackKey: string): string {
  const params = new URLSearchParams({ key: trackKey });
  return `/tracks/original?${params.toString()}`;
}
