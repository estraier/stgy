import { Router, Request, Response } from "express";
import { Pool } from "pg";
import Redis from "ioredis";
import { AuthService } from "../services/auth";
import { UsersService } from "../services/users";
import { AuthHelpers } from "./authHelpers";

export default function createAuthRouter(pgPool: Pool, redis: Redis) {
  const router = Router();
  const usersService = new UsersService(pgPool, redis);
  const authService = new AuthService(pgPool, redis);
  const authHelpers = new AuthHelpers(authService, usersService);

  router.post("/switch-user", async (req: Request, res: Response) => {
    const loginUser = await authHelpers.getCurrentUser(req);
    if (!loginUser || !loginUser.isAdmin) {
      return res.status(403).json({ error: "admin only" });
    }
    const id = typeof req.body?.id === "string" ? req.body.id.trim() : "";
    if (!id) return res.status(400).json({ error: "id is required" });
    try {
      const { sessionId } = await authService.switchUser(id);
      res.cookie("session_id", sessionId, makeCookieOptions(req));
      res.json({ sessionId });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      const status = /user not found/i.test(message) ? 404 : 400;
      res.status(status).json({ error: message });
    }
  });

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
