import { Router, type Request, type Response } from "express";
import type { Pool } from "pg";
import type Redis from "ioredis";
import { AuthService } from "../services/auth";
import { UsersService } from "../services/users";
import { EventLogService } from "../services/eventLog";
import {
  PubCommentError,
  PubCommentsService,
} from "../services/pubComments";
import type { PubCommentOrder } from "../models/pubComment";
import { AuthHelpers } from "./authHelpers";
import {
  makeCaptchaPassCookieOptions,
  PUB_COMMENT_CAPTCHA_PASS_COOKIE,
  readCaptchaPassToken,
} from "./captcha";
import { QUERY_HASH_HEADER, verifyQueryHash } from "../utils/queryHash";

export const PUB_COMMENT_NAME_COOKIE = "stgy_pub_comment_name";
const PUB_COMMENT_NAME_COOKIE_MAX_AGE_MS = 365 * 24 * 60 * 60 * 1000;

export default function createPubCommentsRouter(
  pgPool: Pool,
  redis: Redis,
  eventLogService: EventLogService,
) {
  const router = Router();
  const authService = new AuthService(pgPool, redis);
  const usersService = new UsersService(pgPool, redis, eventLogService);
  const authHelpers = new AuthHelpers(authService, usersService);
  const service = new PubCommentsService(pgPool, redis, eventLogService);

  router.get("/", async (req: Request, res: Response) => {
    const postId = typeof req.query.postId === "string" ? req.query.postId : "";
    const page = parsePositiveInt(req.query.page, 1);
    const order: PubCommentOrder = req.query.order === "oldest" ? "oldest" : "newest";
    const currentUser = await authHelpers.getCurrentUser(req);
    try {
      return res.json(await service.listPublic(postId, page, order, currentUser));
    } catch (error) {
      return sendPubCommentError(res, error);
    }
  });

  router.get("/form-state", async (req: Request, res: Response) => {
    const postId = typeof req.query.postId === "string" ? req.query.postId : "";
    const currentUser = await authHelpers.getCurrentUser(req);
    try {
      return res.json(
        await service.getFormState({
          postId,
          currentUser,
          passToken: readCaptchaPassToken(req),
          savedName: readNameCookie(req),
        }),
      );
    } catch (error) {
      return sendPubCommentError(res, error);
    }
  });

  router.post("/", async (req: Request, res: Response) => {
    if (!verifyQueryHash(req.originalUrl, req.get(QUERY_HASH_HEADER))) {
      return res.status(403).json({ error: "invalid queryhash" });
    }
    const currentUser = await authHelpers.getCurrentUser(req);
    try {
      const result = await service.create({
        postId: typeof req.body?.postId === "string" ? req.body.postId : "",
        name: req.body?.name,
        body: req.body?.body,
        asAuthor: req.body?.asAuthor === true,
        challengeId: typeof req.body?.captchaId === "string" ? req.body.captchaId : undefined,
        captchaAnswer:
          typeof req.body?.captchaAnswer === "string" ? req.body.captchaAnswer : undefined,
        currentUser,
        passToken: readCaptchaPassToken(req),
      });

      res.cookie(PUB_COMMENT_NAME_COOKIE, result.comment.name, makeNameCookieOptions(req));
      if (result.newPassToken) {
        res.cookie(
          PUB_COMMENT_CAPTCHA_PASS_COOKIE,
          result.newPassToken,
          makeCaptchaPassCookieOptions(req),
        );
      } else if (result.passTokenInvalidated) {
        res.clearCookie(PUB_COMMENT_CAPTCHA_PASS_COOKIE, makeCaptchaPassCookieOptions(req));
      }
      return res.status(201).json({ comment: result.comment });
    } catch (error) {
      if (error instanceof PubCommentError && error.code === "captcha_required") {
        res.clearCookie(PUB_COMMENT_CAPTCHA_PASS_COOKIE, makeCaptchaPassCookieOptions(req));
      }
      return sendPubCommentError(res, error);
    }
  });

  router.patch("/:id", async (req: Request, res: Response) => {
    const currentUser = await authHelpers.requireWritableUser(req, res);
    if (!currentUser) return;
    try {
      if (req.body?.status !== undefined) {
        if (
          req.body.status !== "published" ||
          req.body.name !== undefined ||
          req.body.body !== undefined
        ) {
          return res.status(400).json({ error: "invalid update" });
        }
        return res.json(await service.approve(req.params.id, currentUser));
      }
      if (req.body?.name === undefined || req.body?.body === undefined) {
        return res.status(400).json({ error: "name and body are required" });
      }
      return res.json(
        await service.editAuthorComment(req.params.id, currentUser, {
          name: req.body.name,
          body: req.body.body,
        }),
      );
    } catch (error) {
      return sendPubCommentError(res, error);
    }
  });

  router.delete("/:id", async (req: Request, res: Response) => {
    const currentUser = await authHelpers.requireWritableUser(req, res);
    if (!currentUser) return;
    try {
      await service.delete(req.params.id, currentUser);
      return res.json({ result: "ok" });
    } catch (error) {
      return sendPubCommentError(res, error);
    }
  });

  return router;
}

function parsePositiveInt(value: unknown, defaultValue: number): number {
  if (typeof value !== "string" || !/^\d+$/.test(value)) return defaultValue;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : defaultValue;
}

function readNameCookie(req: Request): string | undefined {
  const value = req.cookies?.[PUB_COMMENT_NAME_COOKIE];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function makeNameCookieOptions(req: Request) {
  return {
    httpOnly: true,
    secure: req.secure || req.get("x-forwarded-proto") === "https",
    sameSite: "lax" as const,
    path: "/",
    maxAge: PUB_COMMENT_NAME_COOKIE_MAX_AGE_MS,
  };
}

function sendPubCommentError(res: Response, error: unknown) {
  if (!(error instanceof PubCommentError)) {
    throw error;
  }
  const status =
    error.code === "not_found"
      ? 404
      : error.code === "forbidden" || error.code === "comments_disabled"
        ? 403
        : error.code === "comment_limit_reached"
          ? 409
          : 400;
  return res.status(status).json({ error: error.message, code: error.code });
}
