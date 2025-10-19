import { Config } from "../config";
import { Router, Request, Response } from "express";
import { Pool } from "pg";
import Redis from "ioredis";
import { AiUsersService } from "../services/aiUsers";
import { UsersService } from "../services/users";
import { AuthService } from "../services/auth";
import { DailyTimerThrottleService } from "../services/throttle";
import { AuthHelpers } from "./authHelpers";
import type { ChatRequest } from "../models/aiUser";

export default function createAiUsersRouter(pgPool: Pool, redis: Redis) {
  const router = Router();

  const aiUsersService = new AiUsersService(pgPool, redis);
  const usersService = new UsersService(pgPool, redis);
  const authService = new AuthService(pgPool, redis);
  const authHelpers = new AuthHelpers(authService, usersService);
  const timerThrottleService = new DailyTimerThrottleService(
    redis,
    "db",
    Config.DAILY_DB_TIMER_LIMIT_MS,
  );

  router.get("/", async (req: Request, res: Response) => {
    const loginUser = await authHelpers.requireLogin(req, res);
    if (!loginUser) return;
    if (!loginUser.isAdmin && !(await timerThrottleService.canDo(loginUser.id))) {
      return res.status(403).json({ error: "too often operations" });
    }

    const { offset, limit, order } = AuthHelpers.getPageParams(
      req,
      loginUser.isAdmin ? 65535 : Config.MAX_PAGE_LIMIT,
      ["desc", "asc"] as const,
    );

    const watch = timerThrottleService.startWatch(loginUser);
    const users = await aiUsersService.listAiUsers({ offset, limit, order });
    watch.done();
    res.json(users);
  });

  router.get("/:id", async (req: Request, res: Response) => {
    const loginUser = await authHelpers.requireLogin(req, res);
    if (!loginUser) return;
    if (!loginUser.isAdmin && !(await timerThrottleService.canDo(loginUser.id))) {
      return res.status(403).json({ error: "too often operations" });
    }
    const watch = timerThrottleService.startWatch(loginUser);
    const user = await aiUsersService.getAiUser(req.params.id);
    watch.done();
    if (!user) return res.status(404).json({ error: "not found" });
    res.json(user);
  });

  router.post("/chat", async (req: Request, res: Response) => {
    const loginUser = await authHelpers.requireLogin(req, res);
    if (!loginUser) return;
    if (!Config.OPENAI_API_KEY) {
      return res.status(501).json({ error: "ai features are disabled" });
    }
    const body = req.body as ChatRequest;
    let modelToUse: string | undefined;
    if (loginUser.isAdmin) {
      modelToUse = body.model;
      if (!modelToUse) {
        if (loginUser.aiModel) modelToUse = loginUser.aiModel ?? "";
      }
      if (!modelToUse) return res.status(400).json({ error: "model is required" });
    } else {
      if (body.model) return res.status(403).json({ error: "model override not allowed" });
      if (loginUser.aiModel)
        return res.status(403).json({ error: "no model configured for this user" });
      modelToUse = loginUser.aiModel ?? "";
    }
    if (!Array.isArray(body.messages) || body.messages.length === 0) {
      return res.status(400).json({ error: "messages must be a non-empty array" });
    }
    const allowedRoles = new Set(["system", "user", "assistant"]);
    for (let i = 0; i < body.messages.length; i++) {
      const m = body.messages[i] as any;
      if (!m || typeof m.content !== "string") {
        return res.status(400).json({ error: `invalid messages[${i}].content` });
      }
      if (typeof m.role !== "string" || !allowedRoles.has(m.role)) {
        return res.status(400).json({ error: `invalid messages[${i}].role` });
      }
    }
    try {
      const resp = await aiUsersService.chat({ model: modelToUse, messages: body.messages });
      res.json(resp);
    } catch (e) {
      res.status(500).json({ error: "internal_error" });
    }
  });

  return router;
}
