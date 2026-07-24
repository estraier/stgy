import { Config } from "@/config";

export type TrackImageUrlRewriter = (src: string) => string | null;

export const ALLOWED_TRACK_IMAGE_PATTERNS: RegExp[] = [
  /^\/images\//,
  /^\/data\//,
  /^\/media\//,
];

const IMAGE_PUBLIC_URL_PREFIX = Config.STORAGE_S3_PUBLIC_URL_PREFIX.replace(
  /\{bucket\}/g,
  Config.MEDIA_BUCKET_IMAGES,
).replace(/\/+$/, "");

const MASTER_IMAGE_PATH =
  /^\/images\/([^/?#]+)\/masters\/((?:[^/?#]+\/)*)([^/?#]+?)(?:\.[^/?#]+)?(?:[?#].*)?$/;

export const rewriteTrackImageUrl: TrackImageUrlRewriter = (src) => {
  if (!src.startsWith("/images/")) {
    return src;
  }

  const masterMatch = src.match(MASTER_IMAGE_PATH);
  const objectKey = masterMatch
    ? `${masterMatch[1]}/thumbs/${masterMatch[2]}${masterMatch[3]}_image.webp`
    : src.slice("/images/".length).replace(/^\/+/, "");
  if (!objectKey) {
    return null;
  }

  return `${IMAGE_PUBLIC_URL_PREFIX}/${objectKey}`;
};

export const STGY_TRACK_RENDERER_IMAGE_OPTIONS = {
  rewriteImageUrl: rewriteTrackImageUrl,
};
