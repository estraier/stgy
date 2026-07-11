import type { TrackObject } from "@/api/models";

export type TrackFileKind = "FIT" | "TRJGZ";

export function getTrackFileKind(filename: string): TrackFileKind | null {
  const lower = filename.trim().toLowerCase();
  if (lower.endsWith(".fit")) return "FIT";
  if (lower.endsWith(".trjgz")) return "TRJGZ";
  return null;
}

export function getTrackUploadContentType(filename: string): string {
  return getTrackFileKind(filename) === "TRJGZ" ? "application/gzip" : "application/octet-stream";
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

export function getTrackObjectKind(track: Pick<TrackObject, "key">): TrackFileKind | null {
  return getTrackFileKind(track.key);
}

export function makeTrackMarkdown(track: Pick<TrackObject, "previewKey">): string {
  return `@[](/tracks/${track.previewKey})`;
}
