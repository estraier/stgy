import { Router, Request, Response } from "express";
import { Client } from "pg";
import Redis from "ioredis";
import { AuthService } from "../services/auth";

export default function createAuthRouter(pgClient: Client, redis: Redis) {
  const router = Router();
  const authService = new AuthService(pgClient, redis);

  router.post("/", async (req: Request, res: Response) => {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: "email and password are needed" });
    }
    try {
      const { sessionId } = await authService.login(email, password);
      res.cookie("session_id", sessionId, makeCookieOptions(req));
      res.json({ sessionId });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      res.status(401).json({ error: message });
    }
  });

  router.get("/", async (req: Request, res: Response) => {
    const sessionId = req.cookies.session_id;
    if (!sessionId) return res.status(401).json({ error: "no session ID" });
    const sessionInfo = await authService.getSessionInfo(sessionId);
    if (!sessionInfo) return res.status(401).json({ error: "no matching session" });
    res.json(sessionInfo);
  });

  router.delete("/", async (req: Request, res: Response) => {
    const sessionId = req.cookies.session_id;
    await authService.logout(sessionId);
    res.clearCookie("session_id", makeCookieOptions(req));
    res.json({ result: "ok" });
  });

  return router;
}

function makeCookieOptions(req: Request) {
  return {
    httpOnly: true,
    secure: req.secure || req.get("x-forwarded-proto") === "https",
    sameSite: "lax" as const,
    path: "/",
    maxAge: 60 * 60 * 24 * 365 * 10,
  };
}
