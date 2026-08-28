import type { Post, PubComment } from "@/api/models";

export const EXPORT_MANIFEST_FORMAT = "stgy-export-manifest";
export const EXPORT_MANIFEST_VERSION = 1;
export const EXPORTER_VERSION = 1;
export const EXPORT_MANIFEST_FILENAME = "export-manifest.json";

export type ExportManifestFile = {
  modifiedAt: string;
  size: number;
  sha256: string;
};

export type ExportManifestPost = {
  sourceFingerprint: string;
  imageFilenames: string[];
  trackKeys: string[];
  errors: string[];
};

export type ExportManifestImage = {
  key: string;
  path: string;
  size: number;
  etag?: string | null;
  lastModified?: string | null;
};

export type ExportManifestTrack = {
  key: string;
  masterPath: string;
  previewPath: string;
  previewKey: string;
  publicUrl: string;
  previewUrl: string;
  size: number;
  etag?: string | null;
  lastModified?: string | null;
};

export type ExportManifest = {
  format: typeof EXPORT_MANIFEST_FORMAT;
  version: typeof EXPORT_MANIFEST_VERSION;
  exporterVersion: typeof EXPORTER_VERSION;
  userId: string;
  rootDir: string;
  exportedAt: string;
  files: Record<string, ExportManifestFile>;
  posts: Record<string, ExportManifestPost>;
  images: Record<string, ExportManifestImage>;
  tracks: Record<string, ExportManifestTrack>;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isSafeRelativePath(path: string): boolean {
  if (!path || path.startsWith("/") || path.includes("\\")) return false;
  return path.split("/").every((part) => part !== "" && part !== "." && part !== "..");
}

function validateFileEntry(value: unknown): value is ExportManifestFile {
  return (
    isRecord(value) &&
    typeof value.modifiedAt === "string" &&
    typeof value.size === "number" &&
    Number.isFinite(value.size) &&
    value.size >= 0 &&
    typeof value.sha256 === "string" &&
    /^[0-9a-f]{64}$/i.test(value.sha256)
  );
}

function validatePostEntry(value: unknown): value is ExportManifestPost {
  return (
    isRecord(value) &&
    typeof value.sourceFingerprint === "string" &&
    /^[0-9a-f]{64}$/i.test(value.sourceFingerprint) &&
    Array.isArray(value.imageFilenames) &&
    value.imageFilenames.every((item) => typeof item === "string") &&
    Array.isArray(value.trackKeys) &&
    value.trackKeys.every((item) => typeof item === "string") &&
    Array.isArray(value.errors) &&
    value.errors.every((item) => typeof item === "string")
  );
}

function validateImageEntry(value: unknown): value is ExportManifestImage {
  return (
    isRecord(value) &&
    typeof value.key === "string" &&
    typeof value.path === "string" &&
    isSafeRelativePath(value.path) &&
    typeof value.size === "number" &&
    Number.isFinite(value.size) &&
    value.size >= 0 &&
    (value.etag === undefined || value.etag === null || typeof value.etag === "string") &&
    (value.lastModified === undefined ||
      value.lastModified === null ||
      typeof value.lastModified === "string")
  );
}

function validateTrackEntry(value: unknown): value is ExportManifestTrack {
  return (
    isRecord(value) &&
    typeof value.key === "string" &&
    typeof value.masterPath === "string" &&
    isSafeRelativePath(value.masterPath) &&
    typeof value.previewPath === "string" &&
    isSafeRelativePath(value.previewPath) &&
    typeof value.previewKey === "string" &&
    typeof value.publicUrl === "string" &&
    typeof value.previewUrl === "string" &&
    typeof value.size === "number" &&
    Number.isFinite(value.size) &&
    value.size >= 0 &&
    (value.etag === undefined || value.etag === null || typeof value.etag === "string") &&
    (value.lastModified === undefined ||
      value.lastModified === null ||
      typeof value.lastModified === "string")
  );
}

export function parseExportManifest(
  text: string,
  expectedUserId: string,
  expectedRootDir: string,
): ExportManifest {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error("Previous export manifest is not valid JSON.");
  }

  if (!isRecord(raw)) throw new Error("Previous export manifest has an invalid format.");
  if (raw.format !== EXPORT_MANIFEST_FORMAT || raw.version !== EXPORT_MANIFEST_VERSION) {
    throw new Error("Previous export manifest version is not supported.");
  }
  if (raw.exporterVersion !== EXPORTER_VERSION) {
    throw new Error("Previous export was created by an incompatible exporter version.");
  }
  if (raw.userId !== expectedUserId) {
    throw new Error("Previous export manifest belongs to a different user.");
  }
  if (raw.rootDir !== expectedRootDir) {
    throw new Error("Previous export manifest has an unexpected root directory.");
  }
  if (typeof raw.exportedAt !== "string") {
    throw new Error("Previous export manifest is missing exportedAt.");
  }
  if (!isRecord(raw.files) || !Object.values(raw.files).every(validateFileEntry)) {
    throw new Error("Previous export manifest contains invalid file metadata.");
  }
  if (!Object.keys(raw.files).every(isSafeRelativePath)) {
    throw new Error("Previous export manifest contains an invalid file path.");
  }
  if (!isRecord(raw.posts) || !Object.values(raw.posts).every(validatePostEntry)) {
    throw new Error("Previous export manifest contains invalid post metadata.");
  }
  if (!isRecord(raw.images) || !Object.values(raw.images).every(validateImageEntry)) {
    throw new Error("Previous export manifest contains invalid image metadata.");
  }
  if (!isRecord(raw.tracks) || !Object.values(raw.tracks).every(validateTrackEntry)) {
    throw new Error("Previous export manifest contains invalid track metadata.");
  }

  return raw as ExportManifest;
}

export async function sha256Hex(data: Uint8Array | string): Promise<string> {
  const bytes = typeof data === "string" ? new TextEncoder().encode(data) : data;
  const digest = await crypto.subtle.digest("SHA-256", bytes as BufferSource);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

function postFingerprintRecord(post: Post) {
  return {
    id: post.id,
    ownedBy: post.ownedBy,
    replyTo: post.replyTo,
    createdAt: post.createdAt,
    publishedAt: post.publishedAt,
    updatedAt: post.updatedAt,
    snippet: post.snippet,
    locale: post.locale,
    allowLikes: post.allowLikes,
    allowReplies: post.allowReplies,
    ownerNickname: post.ownerNickname,
    ownerLocale: post.ownerLocale,
    replyToOwnerId: post.replyToOwnerId,
    replyToOwnerNickname: post.replyToOwnerNickname,
    countLikes: post.countLikes,
    countReplies: post.countReplies,
    tags: [...post.tags].sort(),
    isLikedByFocusUser: post.isLikedByFocusUser ?? null,
    isRepliedByFocusUser: post.isRepliedByFocusUser ?? null,
    isBlockingFocusUser: post.isBlockingFocusUser ?? null,
  };
}

export async function makePostSourceFingerprint(
  post: Post,
  replies: Post[],
  comments: PubComment[],
): Promise<string> {
  const payload = {
    post: postFingerprintRecord(post),
    replies: [...replies]
      .sort((a, b) => a.id.localeCompare(b.id))
      .map((reply) => ({
        id: reply.id,
        ownedBy: reply.ownedBy,
        createdAt: reply.createdAt,
        updatedAt: reply.updatedAt,
        snippet: reply.snippet,
        ownerNickname: reply.ownerNickname,
        locale: reply.locale,
      })),
    comments: [...comments]
      .sort((a, b) => a.id.localeCompare(b.id))
      .map((comment) => ({
        id: comment.id,
        createdAt: comment.createdAt,
        nickname: comment.nickname,
        body: comment.body,
        status: comment.status,
        isAuthor: comment.isAuthor,
      })),
  };
  return sha256Hex(JSON.stringify(payload));
}

export async function makeManifestFileEntry(
  data: Uint8Array,
  modifiedAt: Date,
): Promise<ExportManifestFile> {
  return {
    modifiedAt: modifiedAt.toISOString(),
    size: data.byteLength,
    sha256: await sha256Hex(data),
  };
}
