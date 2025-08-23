import { Config } from "../config";
import { Router, Request, Response } from "express";
import { Client } from "pg";
import Redis from "ioredis";
import { AuthService } from "../services/auth";
import { UsersService } from "../services/users";
import { AuthHelpers } from "./authHelpers";
import { ThrottleService } from "../services/throttle";
import { makeStorageService } from "../services/storageFactory";
import { MediaService } from "../services/media";

export default function createMediaRouter(pgClient: Client, redis: Redis) {
  const router = Router();
  const usersService = new UsersService(pgClient, redis);
  const authService = new AuthService(pgClient, redis);
  const authHelpers = new AuthHelpers(authService, usersService);
  const throttleService = new ThrottleService(
    redis,
    "image-posts",
    3600,
    Config.HOURLY_IMAGE_POSTS_LIMIT,
  );
  const storage = makeStorageService(Config.STORAGE_DRIVER);
  const media = new MediaService(storage, redis);

  router.post("/:userId/images/presigned", async (req: Request, res: Response) => {
    const loginUser = await authHelpers.getCurrentUser(req);
    if (!loginUser) return res.status(401).json({ error: "login required" });
    const pathUserId = req.params.userId;
    if (!(loginUser.isAdmin || loginUser.id === pathUserId))
      return res.status(403).json({ error: "forbidden" });
    if (!loginUser.isAdmin && !(await throttleService.canDo(loginUser.id))) {
      return res.status(403).json({ error: "too often image posts" });
    }
    try {
      const presigned = await media.presignImageUpload(
        pathUserId,
        typeof req.body.filename === "string" ? req.body.filename : "",
        Number(req.body.sizeBytes ?? 0),
      );
      res.json(presigned);
    } catch (e) {
      res.status(400).json({ error: (e as Error).message || "error" });
    }
  });

  router.post("/:userId/images/finalize", async (req: Request, res: Response) => {
    const loginUser = await authHelpers.getCurrentUser(req);
    if (!loginUser) return res.status(401).json({ error: "login required" });
    const pathUserId = req.params.userId;
    if (!(loginUser.isAdmin || loginUser.id === pathUserId))
      return res.status(403).json({ error: "forbidden" });
    if (!loginUser.isAdmin && !(await throttleService.canDo(loginUser.id))) {
      return res.status(403).json({ error: "too often image posts" });
    }
    try {
      const meta = await media.finalizeImage(
        pathUserId,
        typeof req.body.key === "string" ? req.body.key : "",
      );
      if (!loginUser.isAdmin) {
        throttleService.recordDone(loginUser.id);
      }
      res.json({
        ...meta,
        publicUrl: storage.publicUrl({ bucket: meta.bucket, key: meta.key }),
      });
    } catch (e) {
      res.status(400).json({ error: (e as Error).message || "error" });
    }
  });

  router.get("/:userId/images", async (req: Request, res: Response) => {
    const loginUser = await authHelpers.getCurrentUser(req);
    if (!loginUser) return res.status(401).json({ error: "login required" });
    const pathUserId = req.params.userId;
    if (!(loginUser.isAdmin || loginUser.id === pathUserId))
      return res.status(403).json({ error: "forbidden" });
    try {
      const offset = parseInt((req.query.offset as string) ?? "0", 10);
      const limit = parseInt((req.query.limit as string) ?? "100", 10);
      const list = await media.listImages(pathUserId, offset, limit);
      res.json(
        list.map((m) => ({
          ...m,
          publicUrl: storage.publicUrl({ bucket: m.bucket, key: m.key }),
        })),
      );
    } catch (e) {
      res.status(400).json({ error: (e as Error).message || "error" });
    }
  });

  router.get("/:userId/images/quota", async (req: Request, res: Response) => {
    const loginUser = await authHelpers.getCurrentUser(req);
    if (!loginUser) return res.status(401).json({ error: "login required" });
    const pathUserId = req.params.userId;
    if (!(loginUser.isAdmin || loginUser.id === pathUserId))
      return res.status(403).json({ error: "forbidden" });
    try {
      const yyyymm =
        typeof req.query.yyyymm === "string" && req.query.yyyymm.trim() !== ""
          ? req.query.yyyymm.trim()
          : undefined;
      if (yyyymm && !/^\d{6}$/.test(yyyymm)) throw new Error("invalid yyyymm");
      const quota = await media.calculateMonthlyQuota(pathUserId, yyyymm);
      res.json(quota);
    } catch (e) {
      res.status(400).json({ error: (e as Error).message || "error" });
    }
  });

  router.get(/^\/([^/]+)\/images\/(.*)$/, async (req: Request, res: Response) => {
    const loginUser = await authHelpers.getCurrentUser(req);
    if (!loginUser) return res.status(401).json({ error: "login required" });
    const params = req.params as unknown as string[];
    const pathUserId = params[0] || "";
    if (!(loginUser.isAdmin || loginUser.id === pathUserId))
      return res.status(403).json({ error: "forbidden" });
    const rest = params[1] || "";
    try {
      const { meta, bytes } = await media.getImageBytes(pathUserId, rest);
      if (meta.contentType) res.setHeader("Content-Type", meta.contentType);
      res.setHeader("Content-Length", String(meta.size));
      if (meta.etag) res.setHeader("ETag", meta.etag);
      if (meta.lastModified) res.setHeader("Last-Modified", meta.lastModified);
      res.status(200).end(Buffer.from(bytes));
    } catch (e) {
      res.status(400).json({ error: (e as Error).message || "error" });
    }
  });

  router.delete(/^\/([^/]+)\/images\/(.*)$/, async (req: Request, res: Response) => {
    const loginUser = await authHelpers.getCurrentUser(req);
    if (!loginUser) return res.status(401).json({ error: "login required" });
    const params = req.params as unknown as string[];
    const pathUserId = params[0] || "";
    if (!(loginUser.isAdmin || loginUser.id === pathUserId))
      return res.status(403).json({ error: "forbidden" });
    const rest = params[1] || "";
    try {
      await media.deleteImage(pathUserId, rest);
      res.json({ result: "ok" });
    } catch (e) {
      res.status(400).json({ error: (e as Error).message || "error" });
    }
  });

  router.post("/:userId/profiles/:slot/presigned", async (req: Request, res: Response) => {
    const loginUser = await authHelpers.getCurrentUser(req);
    if (!loginUser) return res.status(401).json({ error: "login required" });
    const pathUserId = req.params.userId;
    const slot = req.params.slot;
    if (!(loginUser.isAdmin || loginUser.id === pathUserId))
      return res.status(403).json({ error: "forbidden" });
    if (slot !== "avatar") return res.status(400).json({ error: "invalid slot" });
    try {
      const presigned = await media.presignProfileUpload(
        pathUserId,
        slot,
        typeof req.body.filename === "string" ? req.body.filename : "",
        Number(req.body.sizeBytes ?? 0),
        Config.MEDIA_AVATAR_BYTE_LIMIT,
      );
      res.json(presigned);
    } catch (e) {
      res.status(400).json({ error: (e as Error).message || "error" });
    }
  });

  router.post("/:userId/profiles/:slot/finalize", async (req: Request, res: Response) => {
    const loginUser = await authHelpers.getCurrentUser(req);
    if (!loginUser) return res.status(401).json({ error: "login required" });
    const pathUserId = req.params.userId;
    const slot = req.params.slot;
    if (!(loginUser.isAdmin || loginUser.id === pathUserId))
      return res.status(403).json({ error: "forbidden" });
    if (slot !== "avatar") return res.status(400).json({ error: "invalid slot" });
    try {
      const meta = await media.finalizeProfile(
        pathUserId,
        slot,
        typeof req.body.key === "string" ? req.body.key : "",
        Config.MEDIA_AVATAR_BYTE_LIMIT,
      );
      await usersService.updateUser({ id: pathUserId, avatar: `${meta.bucket}/${meta.key}` });
      if (loginUser.id === pathUserId) {
        const sessionId = authHelpers.getSessionId(req);
        if (sessionId) {
          await authService.refreshSessionInfo(sessionId);
        }
      }
      res.json({
        ...meta,
        publicUrl: storage.publicUrl({ bucket: meta.bucket, key: meta.key }),
      });
    } catch (e) {
      res.status(400).json({ error: (e as Error).message || "error" });
    }
  });

  router.get("/:userId/profiles/:slot", async (req: Request, res: Response) => {
    const loginUser = await authHelpers.getCurrentUser(req);
    if (!loginUser) return res.status(401).json({ error: "login required" });
    const pathUserId = req.params.userId;
    const slot = req.params.slot;
    if (!(loginUser.isAdmin || loginUser.id === pathUserId))
      return res.status(403).json({ error: "forbidden" });
    if (slot !== "avatar") return res.status(400).json({ error: "invalid slot" });
    try {
      const { meta, bytes } = await media.getProfileBytes(pathUserId, slot);
      if (meta.contentType) res.setHeader("Content-Type", meta.contentType);
      res.setHeader("Content-Length", String(meta.size));
      if (meta.etag) res.setHeader("ETag", meta.etag);
      if (meta.lastModified) res.setHeader("Last-Modified", meta.lastModified);
      res.status(200).end(Buffer.from(bytes));
    } catch (e) {
      res.status(400).json({ error: (e as Error).message || "error" });
    }
  });

  router.delete("/:userId/profiles/:slot", async (req: Request, res: Response) => {
    const loginUser = await authHelpers.getCurrentUser(req);
    if (!loginUser) return res.status(401).json({ error: "login required" });
    const pathUserId = req.params.userId;
    const slot = req.params.slot;
    if (!(loginUser.isAdmin || loginUser.id === pathUserId))
      return res.status(403).json({ error: "forbidden" });
    if (slot !== "avatar") return res.status(400).json({ error: "invalid slot" });
    try {
      await media.deleteProfile(pathUserId, slot);
      await usersService.updateUser({ id: pathUserId, avatar: null });
      if (loginUser.id === pathUserId) {
        const sessionId = authHelpers.getSessionId(req);
        if (sessionId) {
          await authService.refreshSessionInfo(sessionId);
        }
      }
      res.json({ result: "ok" });
    } catch (e) {
      res.status(400).json({ error: (e as Error).message || "error" });
    }
  });

  return router;
}
