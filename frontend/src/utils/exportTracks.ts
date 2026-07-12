import type { TrackObject } from "@/api/models";

export type TrackArchiveEntry = {
  track: TrackObject;
  masterFilename: string;
  previewFilename: string;
};

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function parseTrackMasterKey(
  key: string,
  userId: string,
): { archiveStem: string; extension: "fit" | "trjgz" } {
  const match = new RegExp(
    `^${escapeRegExp(userId)}/masters/(\\d{6})/([0-9a-f]{8})([0-9a-f]{8})\\.(fit|trjgz)$`,
    "i",
  ).exec(key);
  if (!match) {
    throw new Error(`Invalid track master key: ${key}`);
  }

  return {
    archiveStem: `${match[1]}-${match[2]}${match[3]}`,
    extension: match[4].toLowerCase() as "fit" | "trjgz",
  };
}

export function makeTrackArchiveEntries(
  tracks: TrackObject[],
  userId: string,
): TrackArchiveEntry[] {
  const seenKeys = new Set<string>();
  const seenMasterFilenames = new Set<string>();
  const seenPreviewFilenames = new Set<string>();
  const entries: TrackArchiveEntry[] = [];

  for (const track of tracks) {
    if (seenKeys.has(track.key)) continue;
    seenKeys.add(track.key);

    const parsed = parseTrackMasterKey(track.key, userId);
    const masterFilename = `${parsed.archiveStem}.${parsed.extension}`;
    const previewFilename = `${parsed.archiveStem}.trjgz`;

    if (seenMasterFilenames.has(masterFilename)) {
      throw new Error(`Duplicate exported track filename: ${masterFilename}`);
    }
    if (seenPreviewFilenames.has(previewFilename)) {
      throw new Error(`Duplicate exported track preview filename: ${previewFilename}`);
    }

    seenMasterFilenames.add(masterFilename);
    seenPreviewFilenames.add(previewFilename);
    entries.push({ track, masterFilename, previewFilename });
  }

  return entries;
}

function replaceTrackUrl(text: string, source: string, replacement: string): string {
  if (!source) return text;
  const sourceWithoutQuery = source.replace(/[?#].*$/, "");
  const pattern = new RegExp(
    `${escapeRegExp(sourceWithoutQuery)}(?:[?#][^)\\s\"'<>]*)?`,
    "g",
  );
  return text.replace(pattern, replacement);
}

export function rewriteTrackObjectUrlsToRelative(
  text: string,
  entries: TrackArchiveEntry[],
  baseDir: string,
): string {
  let rewritten = String(text || "");

  for (const entry of entries) {
    const replacement = `${baseDir}/previews/${entry.previewFilename}`;
    const managedPaths = [
      entry.track.publicUrl,
      entry.track.previewUrl,
      `/tracks/${entry.track.key}`,
      `/tracks/${entry.track.previewKey}`,
    ];

    for (const source of managedPaths) {
      rewritten = replaceTrackUrl(rewritten, source, replacement);
    }
  }

  return rewritten;
}
