import { Router, Request, Response } from "express";
import { Client } from "pg";
import Redis from "ioredis";
import * as authService from "../services/auth";

export default function createAuthRouter(pgClient: Client, redis: Redis) {
  const router = Router();

  router.post("/", async (req: Request, res: Response) => {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: "emailとpassword必須" });

    try {
      const { sessionId } = await authService.login(email, password, pgClient, redis);
      res.cookie("session_id", sessionId, {
        httpOnly: true,
        secure: false,
        maxAge: 3600 * 1000,
      });
      res.json({ session_id: sessionId });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      res.status(401).json({ error: message });
    }
  });

  router.get("/", async (req: Request, res: Response) => {
    const sessionId = req.cookies.session_id;
    if (!sessionId) return res.status(401).json({ error: "no session ID" });

    const sessionInfo = await authService.getSessionInfo(sessionId, redis);
    if (!sessionInfo) return res.status(401).json({ error: "no matching session" });

    res.json(sessionInfo);
  });

  router.delete("/", async (req: Request, res: Response) => {
    const sessionId = req.cookies.session_id;
    await authService.logout(sessionId, redis);
    res.clearCookie("session_id");
    res.json({ result: "ok" });
  });

  return router;
}
