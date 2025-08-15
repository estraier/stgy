// src/services/media.ts
import Redis from "ioredis";
import { lookup as mimeLookup, extension as mimeExtension } from "mime-types";
import crypto from "crypto";
import { PresignedPostResult, StorageObjectMetadata, StorageMonthlyQuota } from "../models/storage";
import type { StorageService } from "./storage";
import { Config } from "../config";

function toRevMM(d: Date) {
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth() + 1;
  const yyyymm = y * 100 + m;
  const rev = 999999 - yyyymm;
  return String(rev).padStart(6, "0");
}

function toRevTs(d: Date) {
  const ms = d.getTime();
  const rev = 9999999999999 - ms;
  return String(rev).padStart(13, "0");
}

function allowedImageMime(ct: string | false | null): string | null {
  if (!ct) return null;
  const lower = String(ct).toLowerCase();
  if (lower === "image/jpeg" || lower === "image/png" || lower === "image/webp") return lower;
  if (lower === "image/heic" || lower === "image/heif") return "image/heic";
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

function sniffFormat(bytes: Uint8Array): { ok: boolean; mime?: string } {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return { ok: true, mime: "image/jpeg" };
  }
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  )
    return { ok: true, mime: "image/png" };
  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  )
    return { ok: true, mime: "image/webp" };
  if (
    bytes.length >= 12 &&
    bytes[4] === 0x66 &&
    bytes[5] === 0x74 &&
    bytes[6] === 0x79 &&
    bytes[7] === 0x70
  ) {
    return { ok: true, mime: "image/heic" };
  }
  return { ok: false };
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
      bucket: Config.MEDIA_IMAGE_BUCKET,
      key: stagingKey,
      contentTypeWhitelist: ct0,
      maxBytes: limitSingle ?? undefined,
      expiresInSec: 300,
    });
  }

  async finalizeImage(pathUserId: string, stagingKey: string): Promise<StorageObjectMetadata> {
    if (!isKeyUnder(`staging/${pathUserId}`, stagingKey)) throw new Error("invalid key");
    const head = await this.storage.headObject({
      bucket: Config.MEDIA_IMAGE_BUCKET,
      key: stagingKey,
    });
    if (!head || head.size <= 0) throw new Error("not found");
    const limitSingle = Number(Config.MEDIA_IMAGE_BYTE_LIMIT ?? 0) || null;
    if (limitSingle && head.size > limitSingle) {
      await this.storage.deleteObject({ bucket: Config.MEDIA_IMAGE_BUCKET, key: stagingKey });
      throw new Error("file too large");
    }
    const sniffBytes = await this.storage.loadObject(
      { bucket: Config.MEDIA_IMAGE_BUCKET, key: stagingKey },
      { offset: 0, length: 65536 },
    );
    const sniff = sniffFormat(sniffBytes);
    if (!sniff.ok) {
      await this.storage.deleteObject({ bucket: Config.MEDIA_IMAGE_BUCKET, key: stagingKey });
      throw new Error("invalid image data");
    }
    const now = new Date();
    const yyyymmStr = `${now.getUTCFullYear()}${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
    const limitMonthly = Number(Config.MEDIA_IMAGE_BYTE_LIMIT_PER_MONTH ?? 0) || null;
    if (limitMonthly) {
      const quota = await this.calculateMonthlyQuota(pathUserId, yyyymmStr);
      if (quota.bytesTotal + head.size > limitMonthly) {
        await this.storage.deleteObject({ bucket: Config.MEDIA_IMAGE_BUCKET, key: stagingKey });
        throw new Error("monthly quota exceeded");
      }
    }
    const revMM = toRevMM(now);
    const hash8 = crypto.createHash("md5").update(stagingKey).digest("hex").slice(0, 8);
    const finalExt = extFromFilenameOrMime(
      undefined,
      sniff.mime || head.contentType || "application/octet-stream",
    );
    const finalKey = `${pathUserId}/masters/${revMM}/${toRevTs(now)}${hash8}${finalExt}`;
    await this.storage.moveObject(
      { bucket: Config.MEDIA_IMAGE_BUCKET, key: stagingKey },
      { bucket: Config.MEDIA_IMAGE_BUCKET, key: finalKey },
    );
    const meta = await this.storage.headObject({
      bucket: Config.MEDIA_IMAGE_BUCKET,
      key: finalKey,
    });
    const job = {
      type: "image",
      bucket: Config.MEDIA_IMAGE_BUCKET,
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
      { bucket: Config.MEDIA_IMAGE_BUCKET, key: prefix },
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
    const meta = await this.storage.headObject({ bucket: Config.MEDIA_IMAGE_BUCKET, key: full });
    const bytes = await this.storage.loadObject({ bucket: Config.MEDIA_IMAGE_BUCKET, key: full });
    return { meta, bytes };
  }

  async deleteImage(pathUserId: string, keyWithoutUserPrefix: string): Promise<void> {
    const cleaned = decodeURIComponent(keyWithoutUserPrefix).replace(/^\/+/, "");
    const full = `${pathUserId}/${cleaned}`;
    const mastersPrefix = `${pathUserId}/masters`;
    if (!isKeyUnder(mastersPrefix, full)) throw new Error("invalid key (must be masters/)");
    await this.storage.deleteObject({ bucket: Config.MEDIA_IMAGE_BUCKET, key: full });
    const parts = full.split("/");
    const filename = parts.pop() as string;
    const revMM = parts.pop() as string;
    const base = filename.replace(/\.[^.]+$/, "");
    const thumbsPrefix = `${pathUserId}/thumbs/${revMM}/${base}_`;
    const thumbs = await this.storage.listObjects({
      bucket: Config.MEDIA_IMAGE_BUCKET,
      key: thumbsPrefix,
    });
    for (const t of thumbs) {
      await this.storage.deleteObject({ bucket: Config.MEDIA_IMAGE_BUCKET, key: t.key });
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
      bucket: Config.MEDIA_PROFILE_BUCKET,
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
      bucket: Config.MEDIA_PROFILE_BUCKET,
      key: stagingKey,
    });
    if (!head || head.size <= 0) throw new Error("not found");
    if (sizeLimitBytes !== undefined && head.size > sizeLimitBytes) {
      await this.storage.deleteObject({ bucket: Config.MEDIA_PROFILE_BUCKET, key: stagingKey });
      throw new Error("file too large");
    }
    const sniffBytes = await this.storage.loadObject(
      { bucket: Config.MEDIA_PROFILE_BUCKET, key: stagingKey },
      { offset: 0, length: 65536 },
    );
    const sniff = sniffFormat(sniffBytes);
    if (!sniff.ok) {
      await this.storage.deleteObject({ bucket: Config.MEDIA_PROFILE_BUCKET, key: stagingKey });
      throw new Error("invalid image data");
    }
    const finalExt = extFromFilenameOrMime(
      undefined,
      sniff.mime || head.contentType || "application/octet-stream",
    );
    const masterKey = `${pathUserId}/masters/${slot}${finalExt}`;
    await this.storage.moveObject(
      { bucket: Config.MEDIA_PROFILE_BUCKET, key: stagingKey },
      { bucket: Config.MEDIA_PROFILE_BUCKET, key: masterKey },
    );
    const meta = await this.storage.headObject({
      bucket: Config.MEDIA_PROFILE_BUCKET,
      key: masterKey,
    });
    const job = {
      type: "icon",
      bucket: Config.MEDIA_PROFILE_BUCKET,
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
      bucket: Config.MEDIA_PROFILE_BUCKET,
      key: prefix,
    });
    const master = objs.find((o) =>
      new RegExp(`^${userId}/masters/${slot}\\.[A-Za-z0-9]+$`).test(o.key),
    );
    if (!master) throw new Error("not found");
    const meta = await this.storage.headObject({
      bucket: Config.MEDIA_PROFILE_BUCKET,
      key: master.key,
    });
    const bytes = await this.storage.loadObject({
      bucket: Config.MEDIA_PROFILE_BUCKET,
      key: master.key,
    });
    return { meta, bytes };
  }

  async deleteProfile(userId: string, slot: string): Promise<void> {
    const prefix = `${userId}/masters/${slot}`;
    const objs = await this.storage.listObjects({
      bucket: Config.MEDIA_PROFILE_BUCKET,
      key: prefix,
    });
    const master = objs.find((o) =>
      new RegExp(`^${userId}/masters/${slot}\\.[A-Za-z0-9]+$`).test(o.key),
    );
    if (master) {
      await this.storage.deleteObject({
        bucket: Config.MEDIA_PROFILE_BUCKET,
        key: master.key,
      });
    }
    const thumbsPrefix = `${userId}/thumbs/${slot}_`;
    const thumbs = await this.storage.listObjects({
      bucket: Config.MEDIA_PROFILE_BUCKET,
      key: thumbsPrefix,
    });
    for (const t of thumbs) {
      await this.storage.deleteObject({
        bucket: Config.MEDIA_PROFILE_BUCKET,
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
      this.storage.listObjects({ bucket: Config.MEDIA_IMAGE_BUCKET, key: mastersPrefix }),
      this.storage.listObjects({ bucket: Config.MEDIA_IMAGE_BUCKET, key: thumbsPrefix }),
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
}
