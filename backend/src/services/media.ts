import Redis from "ioredis";
import { lookup as mimeLookup, extension as mimeExtension } from "mime-types";
import crypto from "crypto";
import type { StorageService, StorageObjectMetadata, PresignedPostResult } from "./storage";
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
    private bucket: string,
  ) {}

  async presignImageUpload(
    pathUserId: string,
    filename: string,
    sizeBytes: number,
  ): Promise<PresignedPostResult> {
    if (!Number.isFinite(sizeBytes) || sizeBytes <= 0) throw new Error("invalid sizeBytes");
    const limitSingle = Number(Config.MEDIA_IMAGE_BYTE_LIMIT ?? 0);
    const limitMonthly = Number(Config.MEDIA_IMAGE_BYTE_LIMIT_PER_MONTH ?? 0);
    if (limitSingle > 0 && sizeBytes > limitSingle) throw new Error("file too large");
    const ct0 = allowedImageMime(mimeLookup(filename));
    if (!ct0) throw new Error("unsupported content type");

    const now = new Date();
    const revMM = toRevMM(now);
    const monthPrefix = `${pathUserId}/${revMM}/`;
    const monthObjs = await this.storage.listObjects({ bucket: this.bucket, key: monthPrefix });
    const used = monthObjs.reduce((a, b) => a + (b.size || 0), 0);
    if (limitMonthly > 0 && used + sizeBytes > limitMonthly) {
      throw new Error("monthly quota exceeded");
    }

    const ext = extFromFilenameOrMime(filename, ct0);
    const stagingKey = `staging/${pathUserId}/${crypto.randomUUID()}${ext}`;
    return await this.storage.createPresignedPost({
      bucket: this.bucket,
      key: stagingKey,
      contentTypeWhitelist: ct0,
      maxBytes: limitSingle > 0 ? limitSingle : undefined,
      expiresInSec: 300,
    });
  }

  async finalizeImage(pathUserId: string, stagingKey: string): Promise<StorageObjectMetadata> {
    if (!isKeyUnder(`staging/${pathUserId}`, stagingKey)) throw new Error("invalid key");

    const head = await this.storage.headObject({ bucket: this.bucket, key: stagingKey });
    if (!head || head.size <= 0) throw new Error("not found");
    if (Config.MEDIA_IMAGE_BYTE_LIMIT && head.size > Number(Config.MEDIA_IMAGE_BYTE_LIMIT)) {
      await this.storage.deleteObject({ bucket: this.bucket, key: stagingKey });
      throw new Error("file too large");
    }

    const sniffBytes = await this.storage.loadObject(
      { bucket: this.bucket, key: stagingKey },
      { offset: 0, length: 65536 },
    );
    const sniff = sniffFormat(sniffBytes);
    if (!sniff.ok) {
      await this.storage.deleteObject({ bucket: this.bucket, key: stagingKey });
      throw new Error("invalid image data");
    }

    const now = new Date();
    const revMM = toRevMM(now);
    const monthPrefix = `${pathUserId}/${revMM}/`;
    const monthObjs = await this.storage.listObjects({ bucket: this.bucket, key: monthPrefix });
    const used = monthObjs.reduce((a, b) => a + (b.size || 0), 0);
    const limitMonthly = Number(Config.MEDIA_IMAGE_BYTE_LIMIT_PER_MONTH ?? 0);
    if (limitMonthly > 0 && used + head.size > limitMonthly) {
      await this.storage.deleteObject({ bucket: this.bucket, key: stagingKey });
      throw new Error("monthly quota exceeded");
    }

    const hash8 = crypto.createHash("md5").update(stagingKey).digest("hex").slice(0, 8);
    const finalExt = extFromFilenameOrMime(
      undefined,
      sniff.mime || head.contentType || "application/octet-stream",
    );
    const finalKey = `${pathUserId}/${revMM}/${toRevTs(now)}${hash8}${finalExt}`;
    await this.storage.moveObject(
      { bucket: this.bucket, key: stagingKey },
      { bucket: this.bucket, key: finalKey },
    );

    const meta = await this.storage.headObject({ bucket: this.bucket, key: finalKey });

    const job = {
      type: "image",
      bucket: this.bucket,
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
    const prefix = `${pathUserId}/`;
    return await this.storage.listObjects({ bucket: this.bucket, key: prefix }, { offset, limit });
  }

  async getImageBytes(
    pathUserId: string,
    keyWithoutUserPrefix: string,
  ): Promise<{ meta: StorageObjectMetadata; bytes: Uint8Array }> {
    const cleaned = decodeURIComponent(keyWithoutUserPrefix).replace(/^\/+/, "");
    if (!isKeyUnder(pathUserId, `${pathUserId}/${cleaned}`)) throw new Error("invalid key");
    if (isKeyUnder(`staging/${pathUserId}`, cleaned))
      throw new Error("cannot read staging via this endpoint");
    const key = `${pathUserId}/${cleaned}`;
    const meta = await this.storage.headObject({ bucket: this.bucket, key });
    const bytes = await this.storage.loadObject({ bucket: this.bucket, key });
    return { meta, bytes };
  }

  async deleteImage(pathUserId: string, keyWithoutUserPrefix: string): Promise<void> {
    const cleaned = decodeURIComponent(keyWithoutUserPrefix).replace(/^\/+/, "");
    if (!isKeyUnder(pathUserId, `${pathUserId}/${cleaned}`)) throw new Error("invalid key");
    if (isKeyUnder(`staging/${pathUserId}`, cleaned))
      throw new Error("cannot delete staging via this endpoint");
    const key = `${pathUserId}/${cleaned}`;
    await this.storage.deleteObject({ bucket: this.bucket, key });
  }
}
