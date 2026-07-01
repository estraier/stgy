import crypto from "crypto";
import {
  PresignedPostResult,
  StorageObjectMetadata,
} from "../models/storage";
import type { StorageService } from "./storage";
import { Config } from "../config";
import { makeFitTrackPreview, makeTrackJsonTrackPreview } from "./trackPreview";

export type TrackStorageMonthlyQuota = {
  userId: string;
  yyyymm: string;
  bytesMasters: number;
  bytesPreviews: number;
  bytesTotal: number;
  limitSingleBytes: number | null;
  limitMonthlyBytes: number | null;
};

export type TrackObjectMetadata = StorageObjectMetadata & {
  publicUrl: string;
  previewKey: string;
  previewUrl: string;
};

export type FinalizedTrack = {
  master: TrackObjectMetadata;
  preview: TrackObjectMetadata;
};

type TrackMasterKind = "fit" | "trjgz";

const TRACK_PREVIEW_CONTENT_TYPE = "application/gzip";

function toRevMM(d: Date) {
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth() + 1;
  const yyyymm = y * 100 + m;
  const rev = 999999 - yyyymm;
  return String(rev).padStart(6, "0");
}

function revHexWithinMonth(d: Date): string {
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth();
  const monthStart = Date.UTC(y, m, 1, 0, 0, 0, 0);
  const nextMonthStart = Date.UTC(y, m + 1, 1, 0, 0, 0, 0);
  const span = nextMonthStart - monthStart;
  const sinceStart = d.getTime() - monthStart;
  const rev = Math.max(0, span - 1 - sinceStart);
  return rev.toString(16).padStart(8, "0");
}

function isKeyUnder(prefix: string, key: string) {
  return key === prefix || key.startsWith(prefix + "/");
}

function getTrackKindFromFilename(filename: string): TrackMasterKind | undefined {
  const lower = filename.toLowerCase();
  if (lower.endsWith(".fit")) {
    return "fit";
  }
  if (lower.endsWith(".trjgz")) {
    return "trjgz";
  }
  return undefined;
}

function getTrackKindFromKey(key: string): TrackMasterKind | undefined {
  return getTrackKindFromFilename(key);
}

function getMasterExt(kind: TrackMasterKind): string {
  return kind === "fit" ? ".fit" : ".trjgz";
}

function getMasterContentType(kind: TrackMasterKind): string {
  return kind === "fit" ? "application/octet-stream" : "application/gzip";
}

function normalizeContentType(contentType: string | undefined): string | undefined {
  return contentType?.split(";")[0].trim().toLowerCase();
}

function isAllowedContentType(kind: TrackMasterKind, contentType: string | undefined): boolean {
  const normalized = normalizeContentType(contentType);
  if (!normalized) {
    return false;
  }

  if (kind === "fit") {
    return normalized === "application/octet-stream" || normalized === "application/vnd.ant.fit";
  }

  return normalized === "application/gzip" || normalized === "application/x-gzip";
}

function derivePreviewKey(masterKey: string): string {
  const parts = masterKey.split("/");
  if (parts.length < 4 || parts[1] !== "masters") {
    throw new Error(`invalid master key: ${masterKey}`);
  }

  const userId = parts[0];
  const revMM = parts[2];
  const file = parts[3];
  const base = file.replace(/\.[^.]+$/, "");
  return `${userId}/previews/${revMM}/${base}.trjgz`;
}

function attachTrackUrls(
  storage: StorageService,
  meta: StorageObjectMetadata,
): TrackObjectMetadata {
  const previewKey = derivePreviewKey(meta.key);
  return {
    ...meta,
    publicUrl: storage.publicUrl({ bucket: meta.bucket, key: meta.key }),
    previewKey,
    previewUrl: storage.publicUrl({ bucket: meta.bucket, key: previewKey }),
  };
}

function getPreviewMaxPoints(): number {
  const value = Number(Config.MEDIA_TRACK_PREVIEW_MAX_POINTS ?? 0);
  return Number.isFinite(value) && value >= 2 ? Math.floor(value) : 3000;
}

function makePreviewBytes(kind: TrackMasterKind, bytes: Uint8Array): Uint8Array {
  const maxPoints = getPreviewMaxPoints();
  return kind === "fit"
    ? makeFitTrackPreview(bytes, maxPoints)
    : makeTrackJsonTrackPreview(bytes, maxPoints);
}

function getYyyyMm(d: Date): string {
  return `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

export class TracksService {
  constructor(private storage: StorageService) {}

  async presignTrackUpload(
    pathUserId: string,
    filename: string,
    sizeBytes: number,
  ): Promise<PresignedPostResult> {
    if (!Number.isFinite(sizeBytes) || sizeBytes <= 0) {
      throw new Error("invalid sizeBytes");
    }

    const limitSingle = Number(Config.MEDIA_TRACK_BYTE_LIMIT ?? 0) || null;
    const limitMonthly = Number(Config.MEDIA_TRACK_BYTE_LIMIT_PER_MONTH ?? 0) || null;
    if (limitSingle && sizeBytes > limitSingle) {
      throw new Error("file too large");
    }

    const kind = getTrackKindFromFilename(filename);
    if (!kind) {
      throw new Error("unsupported track file");
    }

    if (limitMonthly) {
      const quota = await this.calculateMonthlyQuota(pathUserId, getYyyyMm(new Date()));
      if (quota.bytesTotal + sizeBytes > limitMonthly) {
        throw new Error("monthly quota exceeded");
      }
    }

    const stagingKey =
      `tracks-staging/${pathUserId}/${crypto.randomUUID()}${getMasterExt(kind)}`;

    return await this.storage.createPresignedPost({
      bucket: Config.MEDIA_BUCKET_TRACKS,
      key: stagingKey,
      contentTypeWhitelist: getMasterContentType(kind),
      maxBytes: limitSingle ?? undefined,
      expiresInSec: 300,
    });
  }

  async finalizeTrack(pathUserId: string, stagingKey: string): Promise<FinalizedTrack> {
    if (!isKeyUnder(`tracks-staging/${pathUserId}`, stagingKey)) {
      throw new Error("invalid key");
    }

    const kind = getTrackKindFromKey(stagingKey);
    if (!kind) {
      await this.deleteStaging(stagingKey);
      throw new Error("unsupported track file");
    }

    const head = await this.storage.headObject({
      bucket: Config.MEDIA_BUCKET_TRACKS,
      key: stagingKey,
    });
    if (!head || head.size <= 0) {
      throw new Error("not found");
    }

    const limitSingle = Number(Config.MEDIA_TRACK_BYTE_LIMIT ?? 0) || null;
    if (limitSingle && head.size > limitSingle) {
      await this.deleteStaging(stagingKey);
      throw new Error("file too large");
    }

    if (!isAllowedContentType(kind, head.contentType)) {
      await this.deleteStaging(stagingKey);
      throw new Error("unsupported content type");
    }

    const bytes = await this.storage.loadObject({
      bucket: Config.MEDIA_BUCKET_TRACKS,
      key: stagingKey,
    });

    let previewBytes: Uint8Array;
    try {
      previewBytes = makePreviewBytes(kind, bytes);
    } catch {
      await this.deleteStaging(stagingKey);
      throw new Error("invalid track data");
    }

    const now = new Date();
    const limitMonthly = Number(Config.MEDIA_TRACK_BYTE_LIMIT_PER_MONTH ?? 0) || null;
    if (limitMonthly) {
      const quota = await this.calculateMonthlyQuota(pathUserId, getYyyyMm(now));
      if (quota.bytesTotal + head.size + previewBytes.length > limitMonthly) {
        await this.deleteStaging(stagingKey);
        throw new Error("monthly quota exceeded");
      }
    }

    const revMM = toRevMM(now);
    const hash8 = crypto.createHash("md5").update(stagingKey).digest("hex").slice(0, 8);
    const masterKey = `${pathUserId}/masters/${revMM}/${revHexWithinMonth(now)}${hash8}` +
      getMasterExt(kind);
    const previewKey = derivePreviewKey(masterKey);

    await this.storage.moveObject(
      { bucket: Config.MEDIA_BUCKET_TRACKS, key: stagingKey },
      { bucket: Config.MEDIA_BUCKET_TRACKS, key: masterKey },
      {
        contentType: getMasterContentType(kind),
        metadata: {
          "track-format": kind,
          "preview-key": previewKey,
        },
      },
    );

    try {
      await this.storage.saveObject(
        { bucket: Config.MEDIA_BUCKET_TRACKS, key: previewKey },
        previewBytes,
        TRACK_PREVIEW_CONTENT_TYPE,
      );
    } catch (e) {
      await this.storage.deleteObject({ bucket: Config.MEDIA_BUCKET_TRACKS, key: masterKey });
      throw e;
    }

    const [masterMeta, previewMeta] = await Promise.all([
      this.storage.headObject({ bucket: Config.MEDIA_BUCKET_TRACKS, key: masterKey }),
      this.storage.headObject({ bucket: Config.MEDIA_BUCKET_TRACKS, key: previewKey }),
    ]);

    return {
      master: attachTrackUrls(this.storage, masterMeta),
      preview: {
        ...previewMeta,
        publicUrl: this.storage.publicUrl({
          bucket: previewMeta.bucket,
          key: previewMeta.key,
        }),
        previewKey,
        previewUrl: this.storage.publicUrl({
          bucket: previewMeta.bucket,
          key: previewMeta.key,
        }),
      },
    };
  }

  async listTracks(
    pathUserId: string,
    offset: number,
    limit: number,
  ): Promise<TrackObjectMetadata[]> {
    const prefix = `${pathUserId}/masters/`;
    const objects = await this.storage.listObjects(
      { bucket: Config.MEDIA_BUCKET_TRACKS, key: prefix },
      { offset, limit },
    );
    return objects.map((object) => attachTrackUrls(this.storage, object));
  }

  async getTrackBytes(
    pathUserId: string,
    keyWithoutUserPrefix: string,
  ): Promise<{ meta: StorageObjectMetadata; bytes: Uint8Array }> {
    const cleaned = decodeURIComponent(keyWithoutUserPrefix).replace(/^\/+/, "");
    const full = `${pathUserId}/${cleaned}`;
    const mastersPrefix = `${pathUserId}/masters`;
    const previewsPrefix = `${pathUserId}/previews`;
    if (!(isKeyUnder(mastersPrefix, full) || isKeyUnder(previewsPrefix, full))) {
      throw new Error("invalid key");
    }
    if (isKeyUnder(`tracks-staging/${pathUserId}`, cleaned)) {
      throw new Error("cannot read staging via this endpoint");
    }

    const meta = await this.storage.headObject({ bucket: Config.MEDIA_BUCKET_TRACKS, key: full });
    const bytes = await this.storage.loadObject({ bucket: Config.MEDIA_BUCKET_TRACKS, key: full });
    return { meta, bytes };
  }

  async deleteTrack(pathUserId: string, keyWithoutUserPrefix: string): Promise<void> {
    const cleaned = decodeURIComponent(keyWithoutUserPrefix).replace(/^\/+/, "");
    const full = `${pathUserId}/${cleaned}`;
    const mastersPrefix = `${pathUserId}/masters`;
    if (!isKeyUnder(mastersPrefix, full)) {
      throw new Error("invalid key (must be masters/)");
    }

    await this.storage.deleteObject({ bucket: Config.MEDIA_BUCKET_TRACKS, key: full });

    const previewKey = derivePreviewKey(full);
    await this.storage.deleteObject({
      bucket: Config.MEDIA_BUCKET_TRACKS,
      key: previewKey,
    });
  }

  async calculateMonthlyQuota(
    pathUserId: string,
    yyyymm?: string,
  ): Promise<TrackStorageMonthlyQuota> {
    let targetStr: string;
    if (!yyyymm) {
      targetStr = getYyyyMm(new Date());
    } else {
      if (!/^\d{6}$/.test(yyyymm)) {
        throw new Error("invalid month");
      }
      targetStr = yyyymm;
    }

    const y = Number(targetStr.slice(0, 4));
    const m = Number(targetStr.slice(4, 6));
    if (!(y >= 1970 && m >= 1 && m <= 12)) {
      throw new Error("invalid month");
    }

    const revMM = toRevMM(new Date(Date.UTC(y, m - 1, 1)));
    const mastersPrefix = `${pathUserId}/masters/${revMM}/`;
    const previewsPrefix = `${pathUserId}/previews/${revMM}/`;
    const [masters, previews] = await Promise.all([
      this.storage.listObjects({ bucket: Config.MEDIA_BUCKET_TRACKS, key: mastersPrefix }),
      this.storage.listObjects({ bucket: Config.MEDIA_BUCKET_TRACKS, key: previewsPrefix }),
    ]);
    const bytesMasters = masters.reduce((a, b) => a + (b.size || 0), 0);
    const bytesPreviews = previews.reduce((a, b) => a + (b.size || 0), 0);
    const bytesTotal = bytesMasters + bytesPreviews;
    const limitSingleBytes = Number(Config.MEDIA_TRACK_BYTE_LIMIT ?? 0) || null;
    const limitMonthlyBytes = Number(Config.MEDIA_TRACK_BYTE_LIMIT_PER_MONTH ?? 0) || null;

    return {
      userId: pathUserId,
      yyyymm: targetStr,
      bytesMasters,
      bytesPreviews,
      bytesTotal,
      limitSingleBytes,
      limitMonthlyBytes,
    };
  }

  async deleteAllTracks(pathUserId: string): Promise<void> {
    const del = async (prefix: string) => {
      const objs = await this.storage.listObjects({
        bucket: Config.MEDIA_BUCKET_TRACKS,
        key: prefix,
      });
      if (!objs || objs.length === 0) {
        return;
      }
      await Promise.allSettled(
        objs.map((object) =>
          this.storage.deleteObject({ bucket: Config.MEDIA_BUCKET_TRACKS, key: object.key }),
        ),
      );
    };

    await Promise.all([
      del(`${pathUserId}/masters/`),
      del(`${pathUserId}/previews/`),
      del(`tracks-staging/${pathUserId}/`),
    ]);
  }

  private async deleteStaging(stagingKey: string) {
    await this.storage.deleteObject({
      bucket: Config.MEDIA_BUCKET_TRACKS,
      key: stagingKey,
    });
  }
}
