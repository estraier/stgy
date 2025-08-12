import { Router, Request, Response } from "express";
import { Client } from "pg";
import Redis from "ioredis";
import { AuthService } from "../services/auth";
import { UsersService } from "../services/users";
import { AuthHelpers } from "./authHelpers";
import { makeStorageService } from "../services/storageFactory";
import { Config } from "../config";
import { MediaService } from "../services/media";

export default function createMediaRouter(pgClient: Client, redis: Redis) {
  const router = Router();
  const usersService = new UsersService(pgClient, redis);
  const authService = new AuthService(pgClient, redis);
  const authHelpers = new AuthHelpers(authService, usersService);
  const storage = makeStorageService(Config.STORAGE_DRIVER);
  const media = new MediaService(storage, redis);

  router.post("/:userId/images/presigned", async (req: Request, res: Response) => {
    const loginUser = await authHelpers.getCurrentUser(req);
    if (!loginUser) return res.status(401).json({ error: "login required" });
    const pathUserId = req.params.userId;
    if (!(loginUser.isAdmin || loginUser.id === pathUserId)) {
      return res.status(403).json({ error: "forbidden" });
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
    if (!(loginUser.isAdmin || loginUser.id === pathUserId)) {
      return res.status(403).json({ error: "forbidden" });
    }
    try {
      const meta = await media.finalizeImage(
        pathUserId,
        typeof req.body.key === "string" ? req.body.key : "",
      );
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
    if (!(loginUser.isAdmin || loginUser.id === pathUserId)) {
      return res.status(403).json({ error: "forbidden" });
    }
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

  router.get(/^\/([^/]+)\/images\/(.*)$/, async (req: Request, res: Response) => {
    const loginUser = await authHelpers.getCurrentUser(req);
    if (!loginUser) return res.status(401).json({ error: "login required" });
    const params = req.params as unknown as string[];
    const pathUserId = params[0] || "";
    if (!(loginUser.isAdmin || loginUser.id === pathUserId)) {
      return res.status(403).json({ error: "forbidden" });
    }
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
    if (!(loginUser.isAdmin || loginUser.id === pathUserId)) {
      return res.status(403).json({ error: "forbidden" });
    }
    const rest = params[1] || "";
    try {
      await media.deleteImage(pathUserId, rest);
      res.json({ result: "ok" });
    } catch (e) {
      res.status(400).json({ error: (e as Error).message || "error" });
    }
  });

  router.post("/:userId/profile/:slot/presigned", async (req: Request, res: Response) => {
    const loginUser = await authHelpers.getCurrentUser(req);
    if (!loginUser) return res.status(401).json({ error: "login required" });
    const pathUserId = req.params.userId;
    const slot = req.params.slot;
    if (!(loginUser.isAdmin || loginUser.id === pathUserId)) {
      return res.status(403).json({ error: "forbidden" });
    }
    if (slot !== "avatar") {
      return res.status(400).json({ error: "invalid slot" });
    }
    try {
      const presigned = await media.presignProfileUpload(
        pathUserId,
        slot,
        typeof req.body.filename === "string" ? req.body.filename : "",
        Number(req.body.sizeBytes ?? 0),
        Config.MEDIA_ICON_BYTE_LIMIT,
      );
      res.json(presigned);
    } catch (e) {
      res.status(400).json({ error: (e as Error).message || "error" });
    }
  });

  router.post("/:userId/profile/:slot/finalize", async (req: Request, res: Response) => {
    const loginUser = await authHelpers.getCurrentUser(req);
    if (!loginUser) return res.status(401).json({ error: "login required" });
    const pathUserId = req.params.userId;
    const slot = req.params.slot;
    if (!(loginUser.isAdmin || loginUser.id === pathUserId)) {
      return res.status(403).json({ error: "forbidden" });
    }
    if (slot !== "avatar") {
      return res.status(400).json({ error: "invalid slot" });
    }
    try {
      const meta = await media.finalizeProfile(
        pathUserId,
        slot,
        typeof req.body.key === "string" ? req.body.key : "",
        { sizeLimitBytes: Config.MEDIA_ICON_BYTE_LIMIT, thumbnailType: "icon" },
      );
      res.json({
        ...meta,
        publicUrl: storage.publicUrl({ bucket: meta.bucket, key: meta.key }),
      });
    } catch (e) {
      res.status(400).json({ error: (e as Error).message || "error" });
    }
  });

  router.get("/:userId/profile/:slot", async (req: Request, res: Response) => {
    const loginUser = await authHelpers.getCurrentUser(req);
    if (!loginUser) return res.status(401).json({ error: "login required" });
    const pathUserId = req.params.userId;
    const slot = req.params.slot;
    if (!(loginUser.isAdmin || loginUser.id === pathUserId)) {
      return res.status(403).json({ error: "forbidden" });
    }
    if (slot !== "avatar") {
      return res.status(400).json({ error: "invalid slot" });
    }
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

  router.delete("/:userId/profile/:slot", async (req: Request, res: Response) => {
    const loginUser = await authHelpers.getCurrentUser(req);
    if (!loginUser) return res.status(401).json({ error: "login required" });
    const pathUserId = req.params.userId;
    const slot = req.params.slot;
    if (!(loginUser.isAdmin || loginUser.id === pathUserId)) {
      return res.status(403).json({ error: "forbidden" });
    }
    if (slot !== "avatar") {
      return res.status(400).json({ error: "invalid slot" });
    }
    try {
      await media.deleteProfile(pathUserId, slot);
      res.json({ result: "ok" });
    } catch (e) {
      res.status(400).json({ error: (e as Error).message || "error" });
    }
  });

  return router;
}
