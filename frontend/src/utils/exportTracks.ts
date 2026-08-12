import type { TrackObject } from "@/api/models";

export type TrackArchiveEntry = {
  track: TrackObject;
  masterFilename: string;
  previewFilename: string;
};

export type TrackReferenceSource = {
  label: string;
  text: string;
};

export type UnexportedTrackReference = {
  reference: string;
  sources: string[];
  reason: "owned-by-another-user" | "not-in-track-storage";
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

function managedTrackPaths(entry: TrackArchiveEntry): string[] {
  return [
    entry.track.publicUrl,
    entry.track.previewUrl,
    `/tracks/${entry.track.key}`,
    `/tracks/${entry.track.previewKey}`,
  ];
}

export function filterReferencedTrackArchiveEntries(
  texts: Iterable<string>,
  entries: TrackArchiveEntry[],
): TrackArchiveEntry[] {
  const contents = Array.from(texts, (text) => String(text || ""));

  return entries.filter((entry) =>
    managedTrackPaths(entry).some((source) => {
      const sourceWithoutQuery = String(source || "").replace(/[?#].*$/, "");
      return sourceWithoutQuery !== "" && contents.some((text) => text.includes(sourceWithoutQuery));
    }),
  );
}

const STGY_TRACK_PATH_PATTERN =
  /\/tracks\/([^/\s"'<>|)]+)\/((?:masters|previews)\/\d{6}\/[0-9a-f]{16}\.(?:fit|trjgz))/gi;

export function collectOwnedTrackKeys(texts: Iterable<string>, userId: string): Set<string> {
  const keys = new Set<string>();
  const normalizedUserId = userId.toLowerCase();

  for (const text of texts) {
    const pattern = new RegExp(STGY_TRACK_PATH_PATTERN.source, STGY_TRACK_PATH_PATTERN.flags);
    for (const match of String(text || "").matchAll(pattern)) {
      let ownerId: string;
      try {
        ownerId = decodeURIComponent(match[1]);
      } catch {
        ownerId = match[1];
      }
      if (ownerId.toLowerCase() !== normalizedUserId) continue;
      keys.add(`${userId}/${match[2]}`);
    }
  }

  return keys;
}

export function collectUnexportedTrackReferences(
  sources: Iterable<TrackReferenceSource>,
  entries: TrackArchiveEntry[],
  currentUserId: string,
): UnexportedTrackReference[] {
  const exportedPaths = new Set(
    entries.flatMap((entry) => [
      `/tracks/${entry.track.key}`.toLowerCase(),
      `/tracks/${entry.track.previewKey}`.toLowerCase(),
    ]),
  );
  const normalizedCurrentUserId = currentUserId.toLowerCase();
  const unresolved = new Map<
    string,
    {
      reference: string;
      sources: Set<string>;
      reason: UnexportedTrackReference["reason"];
    }
  >();

  for (const source of sources) {
    const text = String(source.text || "");
    STGY_TRACK_PATH_PATTERN.lastIndex = 0;
    for (const match of text.matchAll(STGY_TRACK_PATH_PATTERN)) {
      const reference = match[0];
      const normalized = reference.toLowerCase();
      const ownerId = match[1].toLowerCase();
      const reason: UnexportedTrackReference["reason"] =
        ownerId !== normalizedCurrentUserId
          ? "owned-by-another-user"
          : "not-in-track-storage";

      if (reason === "not-in-track-storage" && exportedPaths.has(normalized)) continue;

      const current = unresolved.get(normalized);
      if (current) {
        current.sources.add(source.label);
      } else {
        unresolved.set(normalized, {
          reference,
          sources: new Set([source.label]),
          reason,
        });
      }
    }
  }

  return Array.from(
    unresolved.values(),
    ({ reference, sources: labels, reason }) => ({
      reference,
      sources: Array.from(labels),
      reason,
    }),
  );
}

function replaceTrackUrl(text: string, source: string, replacement: string): string {
  if (!source) return text;
  const sourceWithoutQuery = source.replace(/[?#].*$/, "");
  const pattern = new RegExp(
    `${escapeRegExp(sourceWithoutQuery)}(?:[?#][^)|\\s\"'<>]*)?`,
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
    for (const source of managedTrackPaths(entry)) {
      rewritten = replaceTrackUrl(rewritten, source, replacement);
    }
  }

  return rewritten;
}
