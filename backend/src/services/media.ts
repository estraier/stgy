import Redis from "ioredis";
import { lookup as mimeLookup, extension as mimeExtension } from "mime-types";
import crypto from "crypto";
import { PresignedPostResult, StorageObjectMetadata, StorageMonthlyQuota } from "../models/storage";
import type { StorageService } from "./storage";
import { Config } from "../config";
import { sniffFormat, readDimensions } from "../utils/image";

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

function allowedImageMime(ct: string | false | null): string | null {
  if (!ct) return null;
  const lower = String(ct).toLowerCase();
  if (lower === "image/jpeg" || lower === "image/png" || lower === "image/webp") return lower;
  return null;
}

function extFromFilenameOrMime(filename: string | undefined, mime: string): string {
  const fromMime = mimeExtension(mime);
  if (fromMime) return `.${fromMime}`;
  if (!filename) return "";
  const m = /\.([A-Za-z0-9]+)$/.exec(filename);
  return m ? `.${m[1].toLowerCase()}` : "";
}

function isKeyUnder(prefix: string, key: string) {
  return key === prefix || key.startsWith(prefix + "/");
}

export class MediaService {
  constructor(
    private storage: StorageService,
    private redis: Redis,
  ) {}

  async presignImageUpload(
    pathUserId: string,
    filename: string,
    sizeBytes: number,
  ): Promise<PresignedPostResult> {
    if (!Number.isFinite(sizeBytes) || sizeBytes <= 0) throw new Error("invalid sizeBytes");
    const limitSingle = Number(Config.MEDIA_IMAGE_BYTE_LIMIT ?? 0) || null;
    const limitMonthly = Number(Config.MEDIA_IMAGE_BYTE_LIMIT_PER_MONTH ?? 0) || null;
    if (limitSingle && sizeBytes > limitSingle) throw new Error("file too large");
    const ct0 = allowedImageMime(mimeLookup(filename));
    if (!ct0) throw new Error("unsupported content type");
    const now = new Date();
    const yyyymmStr = `${now.getUTCFullYear()}${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
    if (limitMonthly) {
      const quota = await this.calculateMonthlyQuota(pathUserId, yyyymmStr);
      if (quota.bytesTotal + sizeBytes > limitMonthly) {
        throw new Error("monthly quota exceeded");
      }
    }
    const ext = extFromFilenameOrMime(filename, ct0);
    const stagingKey = `staging/${pathUserId}/${crypto.randomUUID()}${ext}`;
    return await this.storage.createPresignedPost({
      bucket: Config.MEDIA_BUCKET_IMAGES,
      key: stagingKey,
      contentTypeWhitelist: ct0,
      maxBytes: limitSingle ?? undefined,
      expiresInSec: 300,
    });
  }

  async finalizeImage(pathUserId: string, stagingKey: string): Promise<StorageObjectMetadata> {
    if (!isKeyUnder(`staging/${pathUserId}`, stagingKey)) throw new Error("invalid key");
    const head = await this.storage.headObject({
      bucket: Config.MEDIA_BUCKET_IMAGES,
      key: stagingKey,
    });
    if (!head || head.size <= 0) throw new Error("not found");
    const limitSingle = Number(Config.MEDIA_IMAGE_BYTE_LIMIT ?? 0) || null;
    if (limitSingle && head.size > limitSingle) {
      await this.storage.deleteObject({ bucket: Config.MEDIA_BUCKET_IMAGES, key: stagingKey });
      throw new Error("file too large");
    }
    const sniffBytes = await this.storage.loadObject(
      { bucket: Config.MEDIA_BUCKET_IMAGES, key: stagingKey },
      { offset: 0, length: 512 * 1024 },
    );
    const sniff = sniffFormat(sniffBytes);
    if (!sniff.ok) {
      await this.storage.deleteObject({ bucket: Config.MEDIA_BUCKET_IMAGES, key: stagingKey });
      throw new Error("invalid image data");
    }
    const dim = readDimensions(sniffBytes, sniff.mime!);
    if (!dim) {
      await this.storage.deleteObject({ bucket: Config.MEDIA_BUCKET_IMAGES, key: stagingKey });
      throw new Error("cannot determine image dimensions");
    }
    const maxSide = Number(Config.MEDIA_INPUT_MAX_DIMENTION ?? 0) || 0;
    const maxPixels = Number(Config.MEDIA_INPUT_MAX_PIXELS ?? 0) || 0;
    if (maxSide && (dim.w > maxSide || dim.h > maxSide)) {
      await this.storage.deleteObject({ bucket: Config.MEDIA_BUCKET_IMAGES, key: stagingKey });
      throw new Error("image too large (dimension)");
    }
    if (maxPixels && dim.w * dim.h > maxPixels) {
      await this.storage.deleteObject({ bucket: Config.MEDIA_BUCKET_IMAGES, key: stagingKey });
      throw new Error("image too large (pixels)");
    }

    const declaredCt = allowedImageMime(head.contentType ?? null);
    if (!declaredCt) {
      await this.storage.deleteObject({ bucket: Config.MEDIA_BUCKET_IMAGES, key: stagingKey });
      throw new Error("unsupported content type");
    }
    if (sniff.mime && declaredCt !== sniff.mime) {
      await this.storage.deleteObject({ bucket: Config.MEDIA_BUCKET_IMAGES, key: stagingKey });
      throw new Error("content-type mismatch");
    }
    const m = stagingKey.match(/\.([A-Za-z0-9]+)$/);
    const extInKey = m ? m[1].toLowerCase() : null;
    if (!extInKey) {
      await this.storage.deleteObject({ bucket: Config.MEDIA_BUCKET_IMAGES, key: stagingKey });
      throw new Error("file extension required");
    }
    const aliasSet = (mime: string) => {
      switch (mime) {
        case "image/jpeg":
          return new Set(["jpg", "jpeg"]);
        case "image/png":
          return new Set(["png"]);
        case "image/webp":
          return new Set(["webp"]);
        default:
          return new Set<string>();
      }
    };
    if (!aliasSet(sniff.mime || declaredCt).has(extInKey)) {
      await this.storage.deleteObject({ bucket: Config.MEDIA_BUCKET_IMAGES, key: stagingKey });
      throw new Error("file extension mismatch");
    }
    const now = new Date();
    const yyyymmStr = `${now.getUTCFullYear()}${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
    const limitMonthly = Number(Config.MEDIA_IMAGE_BYTE_LIMIT_PER_MONTH ?? 0) || null;
    if (limitMonthly) {
      const quota = await this.calculateMonthlyQuota(pathUserId, yyyymmStr);
      if (quota.bytesTotal + head.size > limitMonthly) {
        await this.storage.deleteObject({ bucket: Config.MEDIA_BUCKET_IMAGES, key: stagingKey });
        throw new Error("monthly quota exceeded");
      }
    }
    const revMM = toRevMM(now);
    const hash8 = crypto.createHash("md5").update(stagingKey).digest("hex").slice(0, 8);
    const finalMime = sniff.mime ?? declaredCt;
    const finalExt = extFromFilenameOrMime(undefined, finalMime || "application/octet-stream");
    const r8 = revHexWithinMonth(now);
    const finalKey = `${pathUserId}/masters/${revMM}/${r8}${hash8}${finalExt}`;
    await this.storage.moveObject(
      { bucket: Config.MEDIA_BUCKET_IMAGES, key: stagingKey },
      { bucket: Config.MEDIA_BUCKET_IMAGES, key: finalKey },
      {
        contentType: finalMime,
        metadata: { "image-width": String(dim.w), "image-height": String(dim.h) },
      },
    );
    const meta = await this.storage.headObject({
      bucket: Config.MEDIA_BUCKET_IMAGES,
      key: finalKey,
    });
    const job = {
      type: "image",
      bucket: Config.MEDIA_BUCKET_IMAGES,
      originalKey: finalKey,
    };
    await this.redis.lpush("media-thumb-queue", JSON.stringify(job));
    return meta;
  }

  async listImages(
    pathUserId: string,
    offset: number,
    limit: number,
  ): Promise<StorageObjectMetadata[]> {
    const prefix = `${pathUserId}/masters/`;
    return await this.storage.listObjects(
      { bucket: Config.MEDIA_BUCKET_IMAGES, key: prefix },
      { offset, limit },
    );
  }

  async getImageBytes(
    pathUserId: string,
    keyWithoutUserPrefix: string,
  ): Promise<{ meta: StorageObjectMetadata; bytes: Uint8Array }> {
    const cleaned = decodeURIComponent(keyWithoutUserPrefix).replace(/^\/+/, "");
    const full = `${pathUserId}/${cleaned}`;
    const mastersPrefix = `${pathUserId}/masters`;
    const thumbsPrefix = `${pathUserId}/thumbs`;
    if (!(isKeyUnder(mastersPrefix, full) || isKeyUnder(thumbsPrefix, full))) {
      throw new Error("invalid key");
    }
    if (isKeyUnder(`staging/${pathUserId}`, cleaned)) {
      throw new Error("cannot read staging via this endpoint");
    }
    const meta = await this.storage.headObject({ bucket: Config.MEDIA_BUCKET_IMAGES, key: full });
    const bytes = await this.storage.loadObject({ bucket: Config.MEDIA_BUCKET_IMAGES, key: full });
    return { meta, bytes };
  }

  async deleteImage(pathUserId: string, keyWithoutUserPrefix: string): Promise<void> {
    const cleaned = decodeURIComponent(keyWithoutUserPrefix).replace(/^\/+/, "");
    const full = `${pathUserId}/${cleaned}`;
    const mastersPrefix = `${pathUserId}/masters`;
    if (!isKeyUnder(mastersPrefix, full)) throw new Error("invalid key (must be masters/)");
    await this.storage.deleteObject({ bucket: Config.MEDIA_BUCKET_IMAGES, key: full });
    const parts = full.split("/");
    const filename = parts.pop() as string;
    const revMM = parts.pop() as string;
    const base = filename.replace(/\.[^.]+$/, "");
    const thumbsPrefix = `${pathUserId}/thumbs/${revMM}/${base}_`;
    const thumbs = await this.storage.listObjects({
      bucket: Config.MEDIA_BUCKET_IMAGES,
      key: thumbsPrefix,
    });
    for (const t of thumbs) {
      await this.storage.deleteObject({ bucket: Config.MEDIA_BUCKET_IMAGES, key: t.key });
    }
  }

  async presignProfileUpload(
    pathUserId: string,
    slot: string,
    filename: string,
    sizeBytes: number,
    sizeLimitBytes?: number,
  ): Promise<PresignedPostResult> {
    if (!Number.isFinite(sizeBytes) || sizeBytes <= 0) throw new Error("invalid sizeBytes");
    if (sizeLimitBytes !== undefined && sizeBytes > sizeLimitBytes)
      throw new Error("file too large");
    const ct0 = allowedImageMime(mimeLookup(filename));
    if (!ct0) throw new Error("unsupported content type");
    const ext = extFromFilenameOrMime(filename, ct0);
    const stagingKey = `profiles-staging/${pathUserId}/${slot}/${crypto.randomUUID()}${ext}`;
    return await this.storage.createPresignedPost({
      bucket: Config.MEDIA_BUCKET_PROFILES,
      key: stagingKey,
      contentTypeWhitelist: ct0,
      maxBytes: sizeLimitBytes,
      expiresInSec: 300,
    });
  }

  async finalizeProfile(
    pathUserId: string,
    slot: string,
    stagingKey: string,
    sizeLimitBytes?: number,
  ): Promise<StorageObjectMetadata> {
    const stagingPrefix = `profiles-staging/${pathUserId}/${slot}`;
    if (!isKeyUnder(stagingPrefix, stagingKey)) throw new Error("invalid key");
    const head = await this.storage.headObject({
      bucket: Config.MEDIA_BUCKET_PROFILES,
      key: stagingKey,
    });
    if (!head || head.size <= 0) throw new Error("not found");
    if (sizeLimitBytes !== undefined && head.size > sizeLimitBytes) {
      await this.storage.deleteObject({ bucket: Config.MEDIA_BUCKET_PROFILES, key: stagingKey });
      throw new Error("file too large");
    }
    const sniffBytes = await this.storage.loadObject(
      { bucket: Config.MEDIA_BUCKET_PROFILES, key: stagingKey },
      { offset: 0, length: 512 * 1024 },
    );
    const sniff = sniffFormat(sniffBytes);
    if (!sniff.ok) {
      await this.storage.deleteObject({ bucket: Config.MEDIA_BUCKET_PROFILES, key: stagingKey });
      throw new Error("invalid image data");
    }
    const dim = readDimensions(sniffBytes, sniff.mime!);
    if (!dim) {
      await this.storage.deleteObject({ bucket: Config.MEDIA_BUCKET_PROFILES, key: stagingKey });
      throw new Error("cannot determine image dimensions");
    }
    const maxSide = Number(Config.MEDIA_INPUT_MAX_DIMENTION ?? 0) || 0;
    const maxPixels = Number(Config.MEDIA_INPUT_MAX_PIXELS ?? 0) || 0;
    if (maxSide && (dim.w > maxSide || dim.h > maxSide)) {
      await this.storage.deleteObject({ bucket: Config.MEDIA_BUCKET_PROFILES, key: stagingKey });
      throw new Error("image too large (dimension)");
    }
    if (maxPixels && dim.w * dim.h > maxPixels) {
      await this.storage.deleteObject({ bucket: Config.MEDIA_BUCKET_PROFILES, key: stagingKey });
      throw new Error("image too large (pixels)");
    }
    const declaredCt = allowedImageMime(head.contentType ?? null);
    if (!declaredCt) {
      await this.storage.deleteObject({ bucket: Config.MEDIA_BUCKET_PROFILES, key: stagingKey });
      throw new Error("unsupported content type");
    }
    if (sniff.mime && declaredCt !== sniff.mime) {
      await this.storage.deleteObject({ bucket: Config.MEDIA_BUCKET_PROFILES, key: stagingKey });
      throw new Error("content-type mismatch");
    }
    const m = stagingKey.match(/\.([A-Za-z0-9]+)$/);
    const extInKey = m ? m[1].toLowerCase() : null;
    if (!extInKey) {
      await this.storage.deleteObject({ bucket: Config.MEDIA_BUCKET_PROFILES, key: stagingKey });
      throw new Error("file extension required");
    }
    const aliasSet = (mime: string) => {
      switch (mime) {
        case "image/jpeg":
          return new Set(["jpg", "jpeg"]);
        case "image/png":
          return new Set(["png"]);
        case "image/webp":
          return new Set(["webp"]);
        default:
          return new Set<string>();
      }
    };
    if (!aliasSet(sniff.mime || declaredCt).has(extInKey)) {
      await this.storage.deleteObject({ bucket: Config.MEDIA_BUCKET_PROFILES, key: stagingKey });
      throw new Error("file extension mismatch");
    }
    const existingPrefix = `${pathUserId}/masters/${slot}`;
    const existing = await this.storage.listObjects({
      bucket: Config.MEDIA_BUCKET_PROFILES,
      key: existingPrefix,
    });
    if (existing && existing.length > 0) {
      await Promise.allSettled(
        existing.map((o) =>
          this.storage.deleteObject({ bucket: Config.MEDIA_BUCKET_PROFILES, key: o.key }),
        ),
      );
    }
    const thumbsPrefix = `${pathUserId}/thumbs/${slot}_`;
    const oldThumbs = await this.storage.listObjects({
      bucket: Config.MEDIA_BUCKET_PROFILES,
      key: thumbsPrefix,
    });
    if (oldThumbs && oldThumbs.length > 0) {
      await Promise.allSettled(
        oldThumbs.map((t) =>
          this.storage.deleteObject({ bucket: Config.MEDIA_BUCKET_PROFILES, key: t.key }),
        ),
      );
    }
    const finalMime = sniff.mime ?? declaredCt;
    const finalExt = extFromFilenameOrMime(undefined, finalMime || "application/octet-stream");
    const masterKey = `${pathUserId}/masters/${slot}${finalExt}`;
    await this.storage.moveObject(
      { bucket: Config.MEDIA_BUCKET_PROFILES, key: stagingKey },
      { bucket: Config.MEDIA_BUCKET_PROFILES, key: masterKey },
      {
        contentType: finalMime,
        metadata: { "image-width": String(dim.w), "image-height": String(dim.h) },
      },
    );
    const meta = await this.storage.headObject({
      bucket: Config.MEDIA_BUCKET_PROFILES,
      key: masterKey,
    });
    const job = {
      type: "icon",
      bucket: Config.MEDIA_BUCKET_PROFILES,
      originalKey: masterKey,
    };
    await this.redis.lpush("media-thumb-queue", JSON.stringify(job));
    return meta;
  }

  async getProfileBytes(
    userId: string,
    slot: string,
  ): Promise<{ meta: StorageObjectMetadata; bytes: Uint8Array }> {
    const prefix = `${userId}/masters/${slot}`;
    const objs = await this.storage.listObjects({
      bucket: Config.MEDIA_BUCKET_PROFILES,
      key: prefix,
    });
    const master = objs.find((o) =>
      new RegExp(`^${userId}/masters/${slot}\\.[A-Za-z0-9]+$`).test(o.key),
    );
    if (!master) throw new Error("not found");
    const meta = await this.storage.headObject({
      bucket: Config.MEDIA_BUCKET_PROFILES,
      key: master.key,
    });
    const bytes = await this.storage.loadObject({
      bucket: Config.MEDIA_BUCKET_PROFILES,
      key: master.key,
    });
    return { meta, bytes };
  }

  async deleteProfile(userId: string, slot: string): Promise<void> {
    const prefix = `${userId}/masters/${slot}`;
    const objs = await this.storage.listObjects({
      bucket: Config.MEDIA_BUCKET_PROFILES,
      key: prefix,
    });
    const master = objs.find((o) =>
      new RegExp(`^${userId}/masters/${slot}\\.[A-Za-z0-9]+$`).test(o.key),
    );
    if (master) {
      await this.storage.deleteObject({
        bucket: Config.MEDIA_BUCKET_PROFILES,
        key: master.key,
      });
    }
    const thumbsPrefix = `${userId}/thumbs/${slot}_`;
    const thumbs = await this.storage.listObjects({
      bucket: Config.MEDIA_BUCKET_PROFILES,
      key: thumbsPrefix,
    });
    for (const t of thumbs) {
      await this.storage.deleteObject({
        bucket: Config.MEDIA_BUCKET_PROFILES,
        key: t.key,
      });
    }
  }

  async calculateMonthlyQuota(pathUserId: string, yyyymm?: string): Promise<StorageMonthlyQuota> {
    let targetStr: string;
    if (!yyyymm) {
      const now = new Date();
      const y = now.getUTCFullYear();
      const m = now.getUTCMonth() + 1;
      targetStr = `${y}${String(m).padStart(2, "0")}`;
    } else {
      if (!/^\d{6}$/.test(yyyymm)) throw new Error("invalid month");
      targetStr = yyyymm;
    }
    const y = Number(targetStr.slice(0, 4));
    const m = Number(targetStr.slice(4, 6));
    if (!(y >= 1970 && m >= 1 && m <= 12)) throw new Error("invalid month");
    const d = new Date(Date.UTC(y, m - 1, 1));
    const revMM = toRevMM(d);
    const mastersPrefix = `${pathUserId}/masters/${revMM}/`;
    const thumbsPrefix = `${pathUserId}/thumbs/${revMM}/`;
    const [masters, thumbs] = await Promise.all([
      this.storage.listObjects({ bucket: Config.MEDIA_BUCKET_IMAGES, key: mastersPrefix }),
      this.storage.listObjects({ bucket: Config.MEDIA_BUCKET_IMAGES, key: thumbsPrefix }),
    ]);
    const bytesMasters = masters.reduce((a, b) => a + (b.size || 0), 0);
    const bytesThumbs = thumbs.reduce((a, b) => a + (b.size || 0), 0);
    const bytesTotal = bytesMasters + bytesThumbs;
    const limitSingleBytes = Number(Config.MEDIA_IMAGE_BYTE_LIMIT ?? 0) || null;
    const limitMonthlyBytes = Number(Config.MEDIA_IMAGE_BYTE_LIMIT_PER_MONTH ?? 0) || null;
    return {
      userId: pathUserId,
      yyyymm: targetStr,
      bytesMasters,
      bytesThumbs,
      bytesTotal,
      limitSingleBytes,
      limitMonthlyBytes,
    };
  }

  async deleteAllImagesAndProfiles(pathUserId: string): Promise<void> {
    const del = async (bucket: string, prefix: string) => {
      const objs = await this.storage.listObjects({ bucket, key: prefix });
      if (!objs || objs.length === 0) {
        return;
      }
      await Promise.allSettled(objs.map((o) => this.storage.deleteObject({ bucket, key: o.key })));
    };
    await Promise.all([
      del(Config.MEDIA_BUCKET_IMAGES, `${pathUserId}/masters/`),
      del(Config.MEDIA_BUCKET_IMAGES, `${pathUserId}/thumbs/`),
      del(Config.MEDIA_BUCKET_IMAGES, `staging/${pathUserId}/`),
      del(Config.MEDIA_BUCKET_PROFILES, `${pathUserId}/masters/`),
      del(Config.MEDIA_BUCKET_PROFILES, `${pathUserId}/thumbs/`),
      del(Config.MEDIA_BUCKET_PROFILES, `profiles-staging/${pathUserId}/`),
    ]);
  }
}
