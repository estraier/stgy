import { Config } from "../config";
import { Router, Request, Response } from "express";
import { Pool } from "pg";
import Redis from "ioredis";
import { AiUsersService } from "../services/aiUsers";
import { UsersService } from "../services/users";
import { AuthService } from "../services/auth";
import { DailyTimerThrottleService } from "../services/throttle";
import { AuthHelpers } from "./authHelpers";
import { int8ToBase64, base64ToInt8 } from "../utils/format";
import type { ChatRequest } from "../models/aiUser";

function isRecord(x: unknown): x is Record<string, unknown> {
  return typeof x === "object" && x !== null;
}

function isChatMessageLike(x: unknown): x is { role: string; content: string } {
  return isRecord(x) && typeof x["role"] === "string" && typeof x["content"] === "string";
}

function parseTagsInput(raw: unknown, maxCount: number): string[] {
  if (!Array.isArray(raw)) return [];
  const tags: string[] = [];
  const seen = new Set<string>();
  for (const t of raw) {
    if (typeof t !== "string") continue;
    const s = t.toLowerCase().trim().slice(0, 50);
    if (!s) continue;
    if (seen.has(s)) continue;
    seen.add(s);
    tags.push(s);
    if (tags.length >= maxCount) break;
  }
  return tags;
}

function buildInterestFeaturesInput(interest: string, tags: string[]): string {
  const s = interest.trim();
  const t = tags
    .map((x) => x.trim())
    .filter(Boolean)
    .slice(0, 10);
  return t.length > 0 ? `${s}\n\n${t.join("\n")}` : s;
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

  router.head("/chat", async (req: Request, res: Response) => {
    return res.sendStatus(Config.OPENAI_API_KEY ? 200 : 501);
  });

  router.post("/chat", async (req: Request, res: Response) => {
    const loginUser = await authHelpers.requireLogin(req, res);
    if (!loginUser) return;
    if (!Config.OPENAI_API_KEY) {
      return res.status(501).json({ error: "ai features are disabled" });
    }
    const bodyRaw = req.body as unknown;
    if (!isRecord(bodyRaw)) {
      return res.status(400).json({ error: "invalid body" });
    }
    const body = bodyRaw as Record<string, unknown>;
    let modelToUse: string;
    if (loginUser.isAdmin) {
      const modelRaw = typeof body["model"] === "string" ? body["model"] : "";
      if (modelRaw && modelRaw.trim() !== "") {
        modelToUse = modelRaw;
      } else if (loginUser.aiModel && loginUser.aiModel.trim() !== "") {
        modelToUse = loginUser.aiModel;
      } else {
        return res.status(400).json({ error: "model is required" });
      }
    } else {
      const modelRaw = typeof body["model"] === "string" ? body["model"] : "";
      if (modelRaw) {
        return res.status(403).json({ error: "model override not allowed" });
      }
      if (!loginUser.aiModel || loginUser.aiModel.trim() === "") {
        return res.status(403).json({ error: "no model configured for this user" });
      }
      modelToUse = loginUser.aiModel;
    }
    let responseFormat: "text" | "json" = body["responseFormat"] === "json" ? "json" : "text";
    const messagesRaw = body["messages"];
    if (!Array.isArray(messagesRaw) || messagesRaw.length === 0) {
      return res.status(400).json({ error: "messages must be a non-empty array" });
    }
    const allowedRoles = new Set(["system", "user", "assistant"]);
    for (let i = 0; i < messagesRaw.length; i++) {
      const m = messagesRaw[i] as unknown;
      if (!isChatMessageLike(m)) {
        return res.status(400).json({ error: `invalid messages[${i}]` });
      }
      if (!allowedRoles.has(m.role)) {
        return res.status(400).json({ error: `invalid messages[${i}].role` });
      }
    }
    try {
      const messages = messagesRaw as ChatRequest["messages"];
      const resp = await aiUsersService.chat({ model: modelToUse, messages, responseFormat });
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

    const bodyRaw = req.body as unknown;
    if (!isRecord(bodyRaw)) {
      return res.status(400).json({ error: "invalid body" });
    }
    const body = bodyRaw as Record<string, unknown>;

    let modelToUse: string;
    if (loginUser.isAdmin) {
      const modelRaw = typeof body["model"] === "string" ? body["model"] : "";
      if (modelRaw && modelRaw.trim() !== "") {
        modelToUse = modelRaw;
      } else if (loginUser.aiModel && loginUser.aiModel.trim() !== "") {
        modelToUse = loginUser.aiModel;
      } else {
        return res.status(400).json({ error: "model is required" });
      }
    } else {
      const modelRaw = typeof body["model"] === "string" ? body["model"] : "";
      if (modelRaw) {
        return res.status(403).json({ error: "model override not allowed" });
      }
      if (!loginUser.aiModel || loginUser.aiModel.trim() === "") {
        return res.status(403).json({ error: "no model configured for this user" });
      }
      modelToUse = loginUser.aiModel;
    }

    const input = typeof body["input"] === "string" ? body["input"] : "";
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
    res.json({
      userId: interest.userId,
      updatedAt: interest.updatedAt,
      interest: interest.interest,
      features: int8ToBase64(interest.features),
      tags: interest.tags,
    });
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
    const body = req.body as unknown;
    if (!isRecord(body)) {
      return res.status(400).json({ error: "invalid body" });
    }
    const interestRaw =
      typeof body["interest"] === "string"
        ? body["interest"]
        : typeof body["payload"] === "string"
          ? body["payload"]
          : null;
    if (!interestRaw || interestRaw.trim() === "") {
      return res.status(400).json({ error: "interest is required" });
    }
    const tags = parseTagsInput(body["tags"], Config.AI_TAG_MAX_COUNT);
    const featuresRaw = typeof body["features"] === "string" ? body["features"] : null;
    let features: Int8Array | null = null;
    if (featuresRaw && featuresRaw.trim() !== "") {
      try {
        features = base64ToInt8(featuresRaw.trim());
      } catch {
        return res.status(400).json({ error: "features must be base64 string if specified" });
      }
    }
    const watch = timerThrottleService.startWatch(loginUser);
    try {
      if (!features) {
        if (!Config.OPENAI_API_KEY) {
          watch.done();
          return res.status(400).json({ error: "features is required" });
        }
        let modelToUse: string;
        const modelOverride =
          typeof body["model"] === "string" && body["model"].trim() !== ""
            ? body["model"].trim()
            : "";
        if (loginUser.isAdmin) {
          if (modelOverride) {
            modelToUse = modelOverride;
          } else if (loginUser.aiModel && loginUser.aiModel.trim() !== "") {
            modelToUse = loginUser.aiModel;
          } else {
            watch.done();
            return res.status(400).json({ error: "model is required" });
          }
        } else {
          if (modelOverride) {
            watch.done();
            return res.status(403).json({ error: "model override not allowed" });
          }
          if (!loginUser.aiModel || loginUser.aiModel.trim() === "") {
            watch.done();
            return res.status(403).json({ error: "no model configured for this user" });
          }
          modelToUse = loginUser.aiModel;
        }
        const input = buildInterestFeaturesInput(interestRaw, tags);
        const out = await aiUsersService.generateFeatures({ model: modelToUse, input });
        features = out.features;
      }
      const saved = await aiUsersService.setAiUserInterest({
        userId: req.params.id,
        interest: interestRaw,
        features,
        tags,
      });
      watch.done();
      res.json({
        userId: saved.userId,
        updatedAt: saved.updatedAt,
        interest: saved.interest,
        features: int8ToBase64(saved.features),
        tags: saved.tags,
      });
    } catch (e) {
      watch.done();
      const msg = (e as Error).message || "internal_error";
      if (msg === "no such model" || msg === "unsupported service") {
        return res.status(400).json({ error: msg });
      }
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
