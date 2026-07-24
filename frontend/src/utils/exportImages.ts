export function restoreImageFilename(rev6: string, time8: string, hash8: string, ext: string): string {
  const r1 = 999999 - parseInt(rev6, 10);
  const r2 = 0xffffffff - parseInt(time8, 16);
  return `${String(r1).padStart(6, "0")}${r2.toString(16).padStart(8, "0")}${hash8}.${ext}`;
}

const STGY_MASTER_IMAGE_URL_RE =
  /\/images\/([^/?#]+)\/(?:masters|thumbs|master|thumb)\/(\d{6})\/([0-9a-f]{8})([0-9a-f]{8})\.([A-Za-z0-9]{1,5})(?:[?#][^)\s"'<>]*)?/gi;

function isOwnedBy(rawOwnerId: string, userId: string): boolean {
  try {
    return decodeURIComponent(rawOwnerId) === userId;
  } catch {
    return false;
  }
}

export function rewriteOwnedImageObjectUrlsToRelative(
  text: string,
  userId: string,
  baseDir: string,
): string {
  return String(text || "").replace(
    STGY_MASTER_IMAGE_URL_RE,
    (
      original,
      rawOwnerId: string,
      rev6: string,
      time8: string,
      hash8: string,
      ext: string,
    ) => {
      if (!isOwnedBy(rawOwnerId, userId)) {
        return original;
      }
      return `${baseDir}/${restoreImageFilename(rev6, time8, hash8, ext)}`;
    },
  );
}
