import { Router, type Request, type Response } from "express";
import type Redis from "ioredis";
import { Config } from "../config";
import { CaptchaService } from "../services/captcha";
import { PUB_COMMENT_CAPTCHA_PURPOSE } from "../services/pubComments";
import { MINUTE_HASH_HEADER, verifyMinuteHash } from "../utils/minuteHash";

export const PUB_COMMENT_CAPTCHA_PASS_COOKIE = "stgy_pub_comment_pass";

export default function createCaptchaRouter(redis: Redis) {
  const router = Router();
  const captchaService = new CaptchaService(redis);

  router.get("/status", async (req: Request, res: Response) => {
    const status = await captchaService.getPassTokenStatus(
      PUB_COMMENT_CAPTCHA_PURPOSE,
      readCaptchaPassToken(req),
      readClientIp(req),
    );
    return res.json(status);
  });

  router.post("/challenge", async (req: Request, res: Response) => {
    if (!verifyMinuteHash(req.get(MINUTE_HASH_HEADER))) {
      return res.status(403).json({ error: "invalid minute hash" });
    }
    const challenge = await captchaService.createChallenge(PUB_COMMENT_CAPTCHA_PURPOSE);
    return res.json({
      challengeId: challenge.id,
      image: `data:image/png;base64,${challenge.png.toString("base64")}`,
    });
  });

  router.post("/verify", async (req: Request, res: Response) => {
    if (!verifyMinuteHash(req.get(MINUTE_HASH_HEADER))) {
      return res.status(403).json({ error: "invalid minute hash" });
    }
    const challengeId = typeof req.body?.challengeId === "string" ? req.body.challengeId.trim() : "";
    const answer = typeof req.body?.answer === "string" ? req.body.answer.trim() : "";
    if (!/^[A-Za-z0-9_-]{16,128}$/.test(challengeId)) {
      return res.status(400).json({ error: "invalid challenge ID" });
    }

    const passed = await captchaService.verifyChallenge(
      PUB_COMMENT_CAPTCHA_PURPOSE,
      challengeId,
      answer,
    );
    if (!passed) {
      return res.status(400).json({ error: "invalid captcha" });
    }

    const previousToken = readCaptchaPassToken(req);
    if (previousToken) {
      await captchaService.revokePassToken(PUB_COMMENT_CAPTCHA_PURPOSE, previousToken);
    }
    const token = await captchaService.issuePassToken(
      PUB_COMMENT_CAPTCHA_PURPOSE,
      readClientIp(req),
    );
    res.cookie(PUB_COMMENT_CAPTCHA_PASS_COOKIE, token, makeCaptchaPassCookieOptions(req));
    return res.json({
      passed: true,
      remaining: Config.CAPTCHA_PASS_MAX_USES,
    });
  });

  router.delete("/pass", async (req: Request, res: Response) => {
    await captchaService.revokePassToken(PUB_COMMENT_CAPTCHA_PURPOSE, readCaptchaPassToken(req));
    res.clearCookie(PUB_COMMENT_CAPTCHA_PASS_COOKIE, makeCaptchaPassCookieOptions(req));
    return res.json({ result: "ok" });
  });

  return router;
}

export function readCaptchaPassToken(req: Request): string | undefined {
  const value = req.cookies?.[PUB_COMMENT_CAPTCHA_PASS_COOKIE];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

export function readClientIp(req: Request): string {
  const value = req.ip || req.socket.remoteAddress;
  if (!value) throw new Error("client IP is unavailable");
  return value;
}

export function makeCaptchaPassCookieOptions(req: Request) {
  return {
    httpOnly: true,
    secure: req.secure || req.get("x-forwarded-proto") === "https",
    sameSite: "lax" as const,
    path: "/",
    maxAge: Config.CAPTCHA_PASS_TTL_SEC * 1000,
  };
}
