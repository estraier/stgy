import { Config } from "../config";
import { Router } from "express";
import { Pool } from "pg";
import Redis from "ioredis";
import { AiPostsService } from "../services/aiPosts";
import { AuthService } from "../services/auth";
import { UsersService } from "../services/users";
import { DailyTimerThrottleService } from "../services/throttle";
import { AuthHelpers } from "./authHelpers";
import { EventLogService } from "../services/eventLog";
import type { AiPostSummary, AiPostSummaryPacket, UpdateAiPostSummaryInput, UpdateAiPostSummaryPacket } from "../models/aiPost";
import { normalizeOneLiner, parseBoolean } from "../utils/format";

function int8ToBase64(v: Int8Array | null): string | null {
  if (!v) return null;
  return Buffer.from(v).toString("base64");
}

function base64ToInt8(v: string): Int8Array {
  const buf = Buffer.from(v, "base64");
  return new Int8Array(buf.buffer, buf.byteOffset, buf.byteLength);
}

function toPacket(s: AiPostSummary): AiPostSummaryPacket {
  return { postId: s.postId, summary: s.summary, features: int8ToBase64(s.features), tags: s.tags };
}

export default function createAiPostsRouter(pgPool: Pool, redis: Redis, eventLogService: EventLogService) {
  const router = Router();
  const aiPostsService = new AiPostsService(pgPool);
  const usersService = new UsersService(pgPool, redis, eventLogService);
  const authService = new AuthService(pgPool, redis);
  const timerThrottleService = new DailyTimerThrottleService(redis, "db", Config.DAILY_DB_TIMER_LIMIT_MS);
  const authHelpers = new AuthHelpers(authService, usersService);

  router.get("/", async (req, res) => {
    const loginUser = await authHelpers.requireLogin(req, res);
    if (!loginUser) return;
    if (!loginUser.isAdmin && !(await timerThrottleService.canDo(loginUser.id))) {
      return res.status(403).json({ error: "too often operations" });
    }
    const { offset, limit, order } = AuthHelpers.getPageParams(req, loginUser.isAdmin ? 65535 : Config.MAX_PAGE_LIMIT, ["desc", "asc"] as const);
    let nullOnly: boolean | undefined;
    if (typeof req.query.nullOnly === "string") {
      nullOnly = parseBoolean(req.query.nullOnly, false);
    }
    const newerThan = typeof req.query.newerThan === "string" && req.query.newerThan.trim() !== "" ? req.query.newerThan.trim() : undefined;
    try {
      const watch = timerThrottleService.startWatch(loginUser);
      const result = await aiPostsService.listAiPostsSummaries({ offset, limit, order, nullOnly, newerThan });
      watch.done();
      const packets: AiPostSummaryPacket[] = result.map((r) => toPacket(r));
      res.json(packets);
    } catch (e) {
      res.status(400).json({ error: (e as Error).message || "invalid request" });
    }
  });

  router.head("/:id", async (req, res) => {
    const loginUser = await authHelpers.requireLogin(req, res);
    if (!loginUser) return;
    if (!loginUser.isAdmin && !(await timerThrottleService.canDo(loginUser.id))) {
      return res.status(403).json({ error: "too often operations" });
    }
    const watch = timerThrottleService.startWatch(loginUser);
    const exists = await aiPostsService.checkAiPostSummary(req.params.id);
    watch.done();
    if (!exists) return res.sendStatus(404);
    return res.sendStatus(200);
  });

  router.get("/:id", async (req, res) => {
    const loginUser = await authHelpers.requireLogin(req, res);
    if (!loginUser) return;
    if (!loginUser.isAdmin && !(await timerThrottleService.canDo(loginUser.id))) {
      return res.status(403).json({ error: "too often operations" });
    }
    try {
      const watch = timerThrottleService.startWatch(loginUser);
      const summary = await aiPostsService.getAiPostSummary(req.params.id);
      watch.done();
      if (!summary) return res.status(404).json({ error: "not found" });
      const packet: AiPostSummaryPacket = toPacket(summary);
      res.json(packet);
    } catch (e) {
      res.status(400).json({ error: (e as Error).message || "invalid request" });
    }
  });

  router.put("/:id", async (req, res) => {
    const loginUser = await authHelpers.requireLogin(req, res);
    if (!loginUser) return;
    if (!loginUser.isAdmin && !(await timerThrottleService.canDo(loginUser.id))) {
      return res.status(403).json({ error: "too often operations" });
    }
    if (!loginUser.isAdmin) {
      return res.status(403).json({ error: "forbidden" });
    }
    const body = req.body as unknown;
    const b = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
    const pkt: UpdateAiPostSummaryPacket = { postId: req.params.id };
    if ("summary" in b) {
      if (b.summary === null) {
        pkt.summary = null;
      } else if (typeof b.summary === "string") {
        pkt.summary = b.summary;
      } else {
        return res.status(400).json({ error: "summary must be string or null if specified" });
      }
    }
    let features: Int8Array | null | undefined = undefined;
    if ("features" in b) {
      if (b.features === null) {
        pkt.features = null;
        features = null;
      } else if (typeof b.features === "string") {
        pkt.features = b.features;
        try {
          features = base64ToInt8(b.features);
        } catch {
          return res.status(400).json({ error: "features must be base64 string or null if specified" });
        }
      } else {
        return res.status(400).json({ error: "features must be base64 string or null if specified" });
      }
    }
    let tags: string[] | undefined;
    if ("tags" in b) {
      if (!Array.isArray(b.tags)) {
        return res.status(400).json({ error: "tags must be array if specified" });
      }
      tags = (b.tags as unknown[]).filter((t): t is string => typeof t === "string").map((t) => normalizeOneLiner(t)).filter((t): t is string => typeof t === "string" && t.trim() !== "");
      pkt.tags = tags;
    }
    const input: UpdateAiPostSummaryInput = { postId: pkt.postId, summary: pkt.summary, features, tags: pkt.tags };
    try {
      const watch = timerThrottleService.startWatch(loginUser);
      const updated = await aiPostsService.updateAiPost(input);
      watch.done();
      if (!updated) return res.status(404).json({ error: "not found" });
      const out: AiPostSummaryPacket = toPacket(updated);
      res.json(out);
    } catch (e) {
      res.status(400).json({ error: (e as Error).message || "update error" });
    }
  });

  return router;
}
