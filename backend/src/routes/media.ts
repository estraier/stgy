import { Router, Request, Response } from "express";
import { Client } from "pg";
import Redis from "ioredis";
import { AuthService } from "../services/auth";
import { UsersService } from "../services/users";
import { AuthHelpers } from "./authHelpers";
import { makeStorageService } from "../services/storageFactory";
import type { StorageObjectMetadata } from "../services/storage";
import { Config } from "../config";
import { lookup as mimeLookup, extension as mimeExtension } from "mime-types";
import crypto, { randomUUID } from "crypto";

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

function ensureOwnerOrAdmin(reqUserId: string, pathUserId: string, isAdmin: boolean) {
  if (isAdmin) return;
  if (reqUserId !== pathUserId) {
    const err: any = new Error("forbidden");
    err.statusCode = 403;
    throw err;
  }
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

function publicize(meta: StorageObjectMetadata) {
  return {
    ...meta,
    publicUrl: `${Config.STORAGE_PUBLIC_BASE_URL}/${encodeURIComponent(meta.bucket)}/${meta.key.split("/").map(encodeURIComponent).join("/")}`,
  };
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
  ) {
    return { ok: true, mime: "image/png" };
  }
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
  ) {
    return { ok: true, mime: "image/webp" };
  }
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

export default function createMediaRouter(pgClient: Client, redis: Redis) {
  const router = Router();
  const usersService = new UsersService(pgClient, redis);
  const authService = new AuthService(pgClient, redis);
  const authHelpers = new AuthHelpers(authService, usersService);
  const storage = makeStorageService(Config.STORAGE_DRIVER);
  const bucket = (Config as any).MEDIA_IMAGE_BUCKET as string;

  router.post("/:userId/images/presigned", async (req: Request, res: Response) => {
    const loginUser = await authHelpers.getCurrentUser(req);
    if (!loginUser) return res.status(401).json({ error: "login required" });
    const pathUserId = req.params.userId;
    try {
      ensureOwnerOrAdmin(loginUser.id, pathUserId, loginUser.isAdmin);
      const filename = typeof req.body.filename === "string" ? req.body.filename : "";
      const sizeBytes = Number(req.body.sizeBytes ?? 0);
      if (!Number.isFinite(sizeBytes) || sizeBytes <= 0) {
        return res.status(400).json({ error: "invalid sizeBytes" });
      }
      const limitSingle = Number((Config as any).MEDIA_IMAGE_BYTE_LIMIT ?? 0);
      const limitMonthly = Number((Config as any).MEDIA_IMAGE_BYTE_LIMIT_PER_MONTH ?? 0);
      if (limitSingle > 0 && sizeBytes > limitSingle) {
        return res.status(400).json({ error: "file too large" });
      }
      const ct0 = allowedImageMime(mimeLookup(filename));
      if (!ct0) return res.status(400).json({ error: "unsupported content type" });
      const now = new Date();
      const revMM = toRevMM(now);
      const monthPrefix = `${pathUserId}/${revMM}/`;
      const monthObjs = await storage.listObjects({ bucket, key: monthPrefix });
      const used = monthObjs.reduce((a, b) => a + (b.size || 0), 0);
      if (limitMonthly > 0 && used + sizeBytes > limitMonthly) {
        return res.status(400).json({ error: "monthly quota exceeded" });
      }
      const ext = extFromFilenameOrMime(filename, ct0);
      const stagingKey = `staging/${pathUserId}/${randomUUID()}${ext}`;
      const presigned = await storage.createPresignedPost({
        bucket,
        key: stagingKey,
        contentTypeWhitelist: ct0,
        maxBytes: limitSingle > 0 ? limitSingle : undefined,
        expiresInSec: 300,
      });
      res.json(presigned);
    } catch (e) {
      const msg = (e as Error).message || "error";
      const status = (e as any).statusCode || 400;
      res.status(status).json({ error: msg });
    }
  });

  router.post("/:userId/images/finalize", async (req: Request, res: Response) => {
    const loginUser = await authHelpers.getCurrentUser(req);
    if (!loginUser) return res.status(401).json({ error: "login required" });
    const pathUserId = req.params.userId;
    const stagingKey = typeof req.body.key === "string" ? req.body.key : "";
    try {
      ensureOwnerOrAdmin(loginUser.id, pathUserId, loginUser.isAdmin);
      if (!isKeyUnder(`staging/${pathUserId}`, stagingKey)) {
        return res.status(400).json({ error: "invalid key" });
      }
      const head = await storage.headObject({ bucket, key: stagingKey });
      if (!head || head.size <= 0) return res.status(404).json({ error: "not found" });
      if (
        (Config as any).MEDIA_IMAGE_BYTE_LIMIT &&
        head.size > Number((Config as any).MEDIA_IMAGE_BYTE_LIMIT)
      ) {
        await storage.deleteObject({ bucket, key: stagingKey });
        return res.status(400).json({ error: "file too large" });
      }
      const sniffBytes = await storage.loadObject(
        { bucket, key: stagingKey },
        { offset: 0, length: 65536 },
      );
      const sniff = sniffFormat(sniffBytes);
      if (!sniff.ok) {
        await storage.deleteObject({ bucket, key: stagingKey });
        return res.status(400).json({ error: "invalid image data" });
      }
      const now = new Date();
      const revMM = toRevMM(now);
      const monthPrefix = `${pathUserId}/${revMM}/`;
      const monthObjs = await storage.listObjects({ bucket, key: monthPrefix });
      const used = monthObjs.reduce((a, b) => a + (b.size || 0), 0);
      const limitMonthly = Number((Config as any).MEDIA_IMAGE_BYTE_LIMIT_PER_MONTH ?? 0);
      if (limitMonthly > 0 && used + head.size > limitMonthly) {
        await storage.deleteObject({ bucket, key: stagingKey });
        return res.status(400).json({ error: "monthly quota exceeded" });
      }
      const hash = crypto.createHash("md5").update(stagingKey).digest("hex").slice(0, 8);
      const finalExt = extFromFilenameOrMime(
        undefined,
        sniff.mime || head.contentType || "application/octet-stream",
      );
      const finalKey = `${pathUserId}/${revMM}/${toRevTs(now)}${hash}${finalExt}`;
      await storage.moveObject({ bucket, key: stagingKey }, { bucket, key: finalKey });
      const meta = await storage.headObject({ bucket, key: finalKey });
      res.json(publicize(meta));
    } catch (e) {
      const msg = (e as Error).message || "error";
      const status = (e as any).statusCode || 400;
      res.status(status).json({ error: msg });
    }
  });

  router.get("/:userId/images", async (req: Request, res: Response) => {
    const loginUser = await authHelpers.getCurrentUser(req);
    if (!loginUser) return res.status(401).json({ error: "login required" });
    const pathUserId = req.params.userId;
    try {
      ensureOwnerOrAdmin(loginUser.id, pathUserId, loginUser.isAdmin);
      const offset = parseInt((req.query.offset as string) ?? "0", 10);
      const limit = parseInt((req.query.limit as string) ?? "100", 10);
      const prefix = `${pathUserId}/`;
      const list = await storage.listObjects({ bucket, key: prefix }, { offset, limit });
      res.json(list.map(publicize));
    } catch (e) {
      const msg = (e as Error).message || "error";
      const status = (e as any).statusCode || 400;
      res.status(status).json({ error: msg });
    }
  });

  router.get(/^\/([^/]+)\/images\/(.*)$/, async (req: Request, res: Response) => {
    const loginUser = await authHelpers.getCurrentUser(req);
    if (!loginUser) return res.status(401).json({ error: "login required" });
    const params = req.params as unknown as string[];
    const pathUserId = params[0] || "";
    const rawRest = params[1] || "";
    try {
      ensureOwnerOrAdmin(loginUser.id, pathUserId, loginUser.isAdmin);
      const cleaned = decodeURIComponent(rawRest).replace(/^\/+/, "");
      if (!isKeyUnder(pathUserId, `${pathUserId}/${cleaned}`)) {
        return res.status(400).json({ error: "invalid key" });
      }
      if (isKeyUnder(`staging/${pathUserId}`, cleaned)) {
        return res.status(400).json({ error: "cannot read staging via this endpoint" });
      }
      const key = `${pathUserId}/${cleaned}`;
      const meta = await storage.headObject({ bucket, key });
      const bytes = await storage.loadObject({ bucket, key });
      if (meta.contentType) res.setHeader("Content-Type", meta.contentType);
      res.setHeader("Content-Length", String(meta.size));
      if (meta.etag) res.setHeader("ETag", meta.etag);
      if (meta.lastModified) res.setHeader("Last-Modified", meta.lastModified);
      res.status(200).end(Buffer.from(bytes));
    } catch (e) {
      const msg = (e as Error).message || "error";
      res.status(404).json({ error: msg || "not found" });
    }
  });

  router.delete(/^\/([^/]+)\/images\/(.*)$/, async (req: Request, res: Response) => {
    const loginUser = await authHelpers.getCurrentUser(req);
    if (!loginUser) return res.status(401).json({ error: "login required" });
    const params = req.params as unknown as string[];
    const pathUserId = params[0] || "";
    const rawRest = params[1] || "";
    try {
      ensureOwnerOrAdmin(loginUser.id, pathUserId, loginUser.isAdmin);
      const cleaned = decodeURIComponent(rawRest).replace(/^\/+/, "");
      if (!isKeyUnder(pathUserId, `${pathUserId}/${cleaned}`)) {
        return res.status(400).json({ error: "invalid key" });
      }
      if (isKeyUnder(`staging/${pathUserId}`, cleaned)) {
        return res.status(400).json({ error: "cannot delete staging via this endpoint" });
      }
      const key = `${pathUserId}/${cleaned}`;
      await storage.deleteObject({ bucket, key });
      res.json({ result: "ok" });
    } catch (e) {
      const msg = (e as Error).message || "error";
      const status = (e as { statusCode?: number }).statusCode || 400;
      res.status(status).json({ error: msg });
    }
  });

  return router;
}
