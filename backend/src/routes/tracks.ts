import { Config } from "../config";
import { Router, Request, Response } from "express";
import { Pool } from "pg";
import Redis from "ioredis";
import type { StorageService } from "../services/storage";
import { AuthService } from "../services/auth";
import { UsersService } from "../services/users";
import { AuthHelpers } from "./authHelpers";
import { ThrottleService, DailyTimerThrottleService } from "../services/throttle";
import { TracksService } from "../services/tracks";

type LoginUser = NonNullable<Awaited<ReturnType<AuthHelpers["requireLogin"]>>>;

type AuthorizedRequest = {
  loginUser: LoginUser;
  pathUserId: string;
};

function getRestParam(req: Request): string {
  const restParam = (req.params as unknown as { rest?: unknown }).rest;
  if (typeof restParam === "string") {
    return restParam;
  }
  if (Array.isArray(restParam)) {
    return restParam.map((value) => String(value)).join("/");
  }
  return "";
}

function getRequestKey(req: Request): string {
  if (typeof req.body.key === "string") {
    return req.body.key;
  }
  if (typeof req.body.objectKey === "string") {
    return req.body.objectKey;
  }
  return "";
}

function setObjectHeaders(res: Response, meta: {
  size: number;
  contentType?: string | null;
  etag?: string | null;
  lastModified?: string | null;
}) {
  if (meta.contentType) {
    res.setHeader("Content-Type", meta.contentType);
  }
  res.setHeader("Content-Length", String(meta.size));
  if (meta.etag) {
    res.setHeader("ETag", meta.etag);
  }
  if (meta.lastModified) {
    res.setHeader("Last-Modified", meta.lastModified);
  }
}

export default function createTracksRouter(
  pgPool: Pool,
  redis: Redis,
  storage: StorageService,
) {
  const router = Router();
  const tracksService = new TracksService(storage);
  const usersService = new UsersService(pgPool, redis);
  const authService = new AuthService(pgPool, redis);
  const authHelpers = new AuthHelpers(authService, usersService);
  const timerThrottleService = new DailyTimerThrottleService(
    redis,
    "media",
    Config.DAILY_DB_TIMER_LIMIT_MS,
  );
  const updatesThrottleService = new ThrottleService(
    redis,
    "track-posts",
    3600,
    Config.HOURLY_IMAGE_POSTS_COUNT_LIMIT,
  );

  async function skipsMonthlyQuota(loginUser: LoginUser, pathUserId: string): Promise<boolean> {
    if (loginUser.id === pathUserId) return loginUser.isAdmin;
    return (await usersService.getUserLite(pathUserId))?.isAdmin === true;
  }

  async function requireAuthorized(
    req: Request,
    res: Response,
  ): Promise<AuthorizedRequest | null> {
    const loginUser = await authHelpers.requireLogin(req, res);
    if (!loginUser) {
      return null;
    }

    const pathUserId = req.params.userId;
    if (!(loginUser.isAdmin || loginUser.id === pathUserId)) {
      res.status(403).json({ error: "forbidden" });
      return null;
    }

    return { loginUser, pathUserId };
  }

  router.post("/:userId/tracks/presigned", async (req: Request, res: Response) => {
    const auth = await requireAuthorized(req, res);
    if (!auth) {
      return;
    }

    if (
      !auth.loginUser.isAdmin &&
      !(await updatesThrottleService.canDo(auth.loginUser.id, 1))
    ) {
      return res.status(403).json({ error: "too often track posts" });
    }

    try {
      const watch = timerThrottleService.startWatch(auth.loginUser);
      const presigned = await tracksService.presignTrackUpload(
        auth.pathUserId,
        typeof req.body.filename === "string" ? req.body.filename : "",
        Number(req.body.sizeBytes ?? 0),
        await skipsMonthlyQuota(auth.loginUser, auth.pathUserId),
      );
      watch.done();
      res.json(presigned);
    } catch (e) {
      res.status(400).json({ error: (e as Error).message || "error" });
    }
  });

  router.post("/:userId/tracks/finalize", async (req: Request, res: Response) => {
    const auth = await requireAuthorized(req, res);
    if (!auth) {
      return;
    }

    if (
      !auth.loginUser.isAdmin &&
      !(await updatesThrottleService.canDo(auth.loginUser.id, 1))
    ) {
      return res.status(403).json({ error: "too often track posts" });
    }

    try {
      const watch = timerThrottleService.startWatch(auth.loginUser);
      const finalized = await tracksService.finalizeTrack(
        auth.pathUserId,
        getRequestKey(req),
        await skipsMonthlyQuota(auth.loginUser, auth.pathUserId),
      );
      watch.done();
      if (!auth.loginUser.isAdmin) {
        await updatesThrottleService.recordDone(auth.loginUser.id);
      }
      res.json(finalized);
    } catch (e) {
      res.status(400).json({ error: (e as Error).message || "error" });
    }
  });

  router.get("/:userId/tracks", async (req: Request, res: Response) => {
    const auth = await requireAuthorized(req, res);
    if (!auth) {
      return;
    }

    try {
      const offset = parseInt((req.query.offset as string) ?? "0", 10);
      const limit = parseInt((req.query.limit as string) ?? "100", 10);
      const watch = timerThrottleService.startWatch(auth.loginUser);
      const list = await tracksService.listTracks(auth.pathUserId, offset, limit);
      watch.done();
      res.json(list);
    } catch (e) {
      res.status(400).json({ error: (e as Error).message || "error" });
    }
  });

  router.get("/:userId/tracks/quota", async (req: Request, res: Response) => {
    const auth = await requireAuthorized(req, res);
    if (!auth) {
      return;
    }

    try {
      const yyyymm = typeof req.query.yyyymm === "string" ? req.query.yyyymm : undefined;
      const watch = timerThrottleService.startWatch(auth.loginUser);
      const quota = await tracksService.calculateMonthlyQuota(
        auth.pathUserId,
        yyyymm,
        await skipsMonthlyQuota(auth.loginUser, auth.pathUserId),
      );
      watch.done();
      res.json(quota);
    } catch (e) {
      res.status(400).json({ error: (e as Error).message || "error" });
    }
  });

  router.get("/:userId/tracks/*rest", async (req: Request, res: Response) => {
    const auth = await requireAuthorized(req, res);
    if (!auth) {
      return;
    }

    try {
      const watch = timerThrottleService.startWatch(auth.loginUser);
      const { meta, bytes } = await tracksService.getTrackBytes(
        auth.pathUserId,
        getRestParam(req),
      );
      watch.done();
      setObjectHeaders(res, meta);
      res.status(200).end(Buffer.from(bytes));
    } catch (e) {
      res.status(400).json({ error: (e as Error).message || "error" });
    }
  });

  router.delete("/:userId/tracks/*rest", async (req: Request, res: Response) => {
    const auth = await requireAuthorized(req, res);
    if (!auth) {
      return;
    }

    try {
      const watch = timerThrottleService.startWatch(auth.loginUser);
      await tracksService.deleteTrack(auth.pathUserId, getRestParam(req));
      watch.done();
      res.json({ result: "ok" });
    } catch (e) {
      res.status(400).json({ error: (e as Error).message || "error" });
    }
  });

  return router;
}
