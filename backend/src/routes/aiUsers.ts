import { Config } from "../config";
import { Router, Request, Response } from "express";
import { Pool } from "pg";
import Redis from "ioredis";
import { AiUsersService } from "../services/aiUsers";
import { UsersService } from "../services/users";
import { AuthService } from "../services/auth";
import { DailyTimerThrottleService } from "../services/throttle";
import { AuthHelpers } from "./authHelpers";
import type { ChatRequest, GenerateFeaturesRequest } from "../models/aiUser";

function isRecord(x: unknown): x is Record<string, unknown> {
  return typeof x === "object" && x !== null;
}
function isChatMessageLike(x: unknown): x is { role: string; content: string } {
  return isRecord(x) && typeof x["role"] === "string" && typeof x["content"] === "string";
}

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
    let modelToUse: string;
    if (loginUser.isAdmin) {
      if (body.model && body.model.trim() !== "") {
        modelToUse = body.model;
      } else if (loginUser.aiModel && loginUser.aiModel.trim() !== "") {
        modelToUse = loginUser.aiModel;
      } else {
        return res.status(400).json({ error: "model is required" });
      }
    } else {
      if (body.model) {
        return res.status(403).json({ error: "model override not allowed" });
      }
      if (!loginUser.aiModel || loginUser.aiModel.trim() === "") {
        return res.status(403).json({ error: "no model configured for this user" });
      }
      modelToUse = loginUser.aiModel;
    }
    if (!Array.isArray(body.messages) || body.messages.length === 0) {
      return res.status(400).json({ error: "messages must be a non-empty array" });
    }
    const allowedRoles = new Set(["system", "user", "assistant"]);
    for (let i = 0; i < body.messages.length; i++) {
      const m = body.messages[i] as unknown;
      if (!isChatMessageLike(m)) {
        return res.status(400).json({ error: `invalid messages[${i}]` });
      }
      if (!allowedRoles.has(m.role)) {
        return res.status(400).json({ error: `invalid messages[${i}].role` });
      }
    }
    try {
      const resp = await aiUsersService.chat({ model: modelToUse, messages: body.messages });
      res.json(resp);
    } catch {
      res.status(500).json({ error: "internal_error" });
    }
  });

  router.post("/features", async (req: Request, res: Response) => {
    const loginUser = await authHelpers.requireLogin(req, res);
    if (!loginUser) return;
    if (!Config.OPENAI_API_KEY) {
      return res.status(501).json({ error: "ai features are disabled" });
    }
    const body = req.body as unknown as GenerateFeaturesRequest;
    let modelToUse: string;
    if (loginUser.isAdmin) {
      if (body.model && body.model.trim() !== "") {
        modelToUse = body.model;
      } else if (loginUser.aiModel && loginUser.aiModel.trim() !== "") {
        modelToUse = loginUser.aiModel;
      } else {
        return res.status(400).json({ error: "model is required" });
      }
    } else {
      if (body.model) {
        return res.status(403).json({ error: "model override not allowed" });
      }
      if (!loginUser.aiModel || loginUser.aiModel.trim() === "") {
        return res.status(403).json({ error: "no model configured for this user" });
      }
      modelToUse = loginUser.aiModel;
    }
    const input = typeof body?.input === "string" ? body.input : "";
    if (input.trim() === "") {
      return res.status(400).json({ error: "input is required" });
    }
    try {
      const out = await aiUsersService.generateFeatures({ model: modelToUse, input });
      res.json({ features: Buffer.from(out.features).toString("base64") });
    } catch (e) {
      const msg = (e as Error).message || "internal_error";
      if (msg === "no such model" || msg === "unsupported service") {
        return res.status(400).json({ error: msg });
      }
      res.status(500).json({ error: "internal_error" });
    }
  });

  router.get("/:id/interests", async (req: Request, res: Response) => {
    const loginUser = await authHelpers.requireLogin(req, res);
    if (!loginUser) return;
    if (!loginUser.isAdmin && !(await timerThrottleService.canDo(loginUser.id))) {
      return res.status(403).json({ error: "too often operations" });
    }
    const watch = timerThrottleService.startWatch(loginUser);
    const interest = await aiUsersService.getAiUserInterest(req.params.id);
    watch.done();
    if (!interest) return res.status(404).json({ error: "not found" });
    res.json(interest);
  });

  router.post("/:id/interests", async (req: Request, res: Response) => {
    const loginUser = await authHelpers.requireLogin(req, res);
    if (!loginUser) return;
    if (!loginUser.isAdmin && loginUser.id !== req.params.id) {
      return res.status(403).json({ error: "forbidden" });
    }
    if (!loginUser.isAdmin && !(await timerThrottleService.canDo(loginUser.id))) {
      return res.status(403).json({ error: "too often operations" });
    }
    const body = req.body;
    const payload = isRecord(body) && typeof body["payload"] === "string" ? body["payload"] : null;
    if (!payload || payload.trim() === "") {
      return res.status(400).json({ error: "payload is required" });
    }
    const watch = timerThrottleService.startWatch(loginUser);
    try {
      const saved = await aiUsersService.setAiUserInterest({ userId: req.params.id, payload });
      watch.done();
      res.json(saved);
    } catch {
      watch.done();
      res.status(500).json({ error: "internal_error" });
    }
  });

  router.get("/:id/peer-impressions", async (req: Request, res: Response) => {
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
    const peerId =
      typeof req.query.peerId === "string" && req.query.peerId.trim() !== ""
        ? req.query.peerId
        : undefined;

    const watch = timerThrottleService.startWatch(loginUser);
    const items = await aiUsersService.listAiPeerImpressions({
      userId: req.params.id,
      offset,
      limit,
      order,
      peerId,
    });
    watch.done();
    res.json(items);
  });

  router.head("/:id/peer-impressions/:peerId", async (req: Request, res: Response) => {
    const loginUser = await authHelpers.requireLogin(req, res);
    if (!loginUser) return;
    if (!loginUser.isAdmin && !(await timerThrottleService.canDo(loginUser.id))) {
      return res.status(403).json({ error: "too often operations" });
    }
    const watch = timerThrottleService.startWatch(loginUser);
    const exists = await aiUsersService.checkAiPeerImpression(req.params.id, req.params.peerId);
    watch.done();
    if (!exists) return res.sendStatus(404);
    return res.sendStatus(200);
  });

  router.get("/:id/peer-impressions/:peerId", async (req: Request, res: Response) => {
    const loginUser = await authHelpers.requireLogin(req, res);
    if (!loginUser) return;
    if (!loginUser.isAdmin && !(await timerThrottleService.canDo(loginUser.id))) {
      return res.status(403).json({ error: "too often operations" });
    }
    const watch = timerThrottleService.startWatch(loginUser);
    const impression = await aiUsersService.getAiPeerImpression(req.params.id, req.params.peerId);
    watch.done();
    if (!impression) return res.status(404).json({ error: "not found" });
    res.json(impression);
  });

  router.post("/:id/peer-impressions", async (req: Request, res: Response) => {
    const loginUser = await authHelpers.requireLogin(req, res);
    if (!loginUser) return;
    if (!loginUser.isAdmin && loginUser.id !== req.params.id) {
      return res.status(403).json({ error: "forbidden" });
    }
    if (!loginUser.isAdmin && !(await timerThrottleService.canDo(loginUser.id))) {
      return res.status(403).json({ error: "too often operations" });
    }

    const body = req.body;
    const peerId = isRecord(body) && typeof body["peerId"] === "string" ? body["peerId"] : null;
    const payload = isRecord(body) && typeof body["payload"] === "string" ? body["payload"] : null;

    if (!peerId || peerId.trim() === "") {
      return res.status(400).json({ error: "peerId is required" });
    }
    if (!payload || payload.trim() === "") {
      return res.status(400).json({ error: "payload is required" });
    }

    const watch = timerThrottleService.startWatch(loginUser);
    try {
      const saved = await aiUsersService.setAiPeerImpression({
        userId: req.params.id,
        peerId,
        payload,
      });
      watch.done();
      res.json(saved);
    } catch {
      watch.done();
      res.status(500).json({ error: "internal_error" });
    }
  });

  router.get("/:id/post-impressions", async (req: Request, res: Response) => {
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

    const postId =
      typeof req.query.postId === "string" && req.query.postId.trim() !== ""
        ? req.query.postId
        : undefined;

    const peerId =
      typeof req.query.peerId === "string" && req.query.peerId.trim() !== ""
        ? req.query.peerId
        : undefined;

    const watch = timerThrottleService.startWatch(loginUser);
    const items = await aiUsersService.listAiPostImpressions({
      userId: req.params.id,
      peerId,
      postId,
      offset,
      limit,
      order,
    });
    watch.done();
    res.json(items);
  });

  router.head("/:id/post-impressions/:postId", async (req: Request, res: Response) => {
    const loginUser = await authHelpers.requireLogin(req, res);
    if (!loginUser) return;
    if (!loginUser.isAdmin && !(await timerThrottleService.canDo(loginUser.id))) {
      return res.status(403).json({ error: "too often operations" });
    }
    const watch = timerThrottleService.startWatch(loginUser);
    const exists = await aiUsersService.checkAiPostImpression(req.params.id, req.params.postId);
    watch.done();
    if (!exists) return res.sendStatus(404);
    return res.sendStatus(200);
  });

  router.get("/:id/post-impressions/:postId", async (req: Request, res: Response) => {
    const loginUser = await authHelpers.requireLogin(req, res);
    if (!loginUser) return;
    if (!loginUser.isAdmin && !(await timerThrottleService.canDo(loginUser.id))) {
      return res.status(403).json({ error: "too often operations" });
    }
    const watch = timerThrottleService.startWatch(loginUser);
    const impression = await aiUsersService.getAiPostImpression(req.params.id, req.params.postId);
    watch.done();
    if (!impression) return res.status(404).json({ error: "not found" });
    res.json(impression);
  });

  router.post("/:id/post-impressions", async (req: Request, res: Response) => {
    const loginUser = await authHelpers.requireLogin(req, res);
    if (!loginUser) return;
    if (!loginUser.isAdmin && loginUser.id !== req.params.id) {
      return res.status(403).json({ error: "forbidden" });
    }
    if (!loginUser.isAdmin && !(await timerThrottleService.canDo(loginUser.id))) {
      return res.status(403).json({ error: "too often operations" });
    }

    const body = req.body;
    const postId = isRecord(body) && typeof body["postId"] === "string" ? body["postId"] : null;
    const payload = isRecord(body) && typeof body["payload"] === "string" ? body["payload"] : null;

    if (!postId || postId.trim() === "") {
      return res.status(400).json({ error: "postId is required" });
    }
    if (!payload || payload.trim() === "") {
      return res.status(400).json({ error: "payload is required" });
    }

    const watch = timerThrottleService.startWatch(loginUser);
    try {
      const saved = await aiUsersService.setAiPostImpression({
        userId: req.params.id,
        postId,
        payload,
      });
      watch.done();
      res.json(saved);
    } catch {
      watch.done();
      res.status(500).json({ error: "internal_error" });
    }
  });

  return router;
}
