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
import type {
  AiPostSummary,
  AiPostSummaryPacket,
  RecommendPostsInput,
  UpdateAiPostSummaryInput,
  UpdateAiPostSummaryPacket,
} from "../models/aiPost";
import { normalizeOneLiner, parseBoolean, int8ToBase64, base64ToInt8 } from "../utils/format";

function toPacket(s: AiPostSummary): AiPostSummaryPacket {
  return {
    postId: s.postId,
    updatedAt: s.updatedAt,
    summary: s.summary,
    features: s.features ? int8ToBase64(s.features) : null,
    tags: s.tags,
  };
}

function parseTagsQueryParam(v: unknown): string[] {
  const raw: string[] = [];
  if (typeof v === "string") {
    raw.push(v);
  } else if (Array.isArray(v)) {
    for (const e of v) {
      if (typeof e === "string") raw.push(e);
    }
  }
  const expanded = raw.flatMap((s) => s.split(","));
  return expanded
    .map((t) => normalizeOneLiner(t.toLowerCase()))
    .filter((t): t is string => typeof t === "string" && t.trim() !== "");
}

export default function createAiPostsRouter(
  pgPool: Pool,
  redis: Redis,
  eventLogService: EventLogService,
) {
  const router = Router();
  const aiPostsService = new AiPostsService(pgPool);
  const usersService = new UsersService(pgPool, redis, eventLogService);
  const authService = new AuthService(pgPool, redis);
  const timerThrottleService = new DailyTimerThrottleService(
    redis,
    "db",
    Config.DAILY_DB_TIMER_LIMIT_MS,
  );
  const authHelpers = new AuthHelpers(authService, usersService);

  router.get("/", async (req, res) => {
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
    let nullOnly: boolean | undefined;
    if (typeof req.query.nullOnly === "string") {
      nullOnly = parseBoolean(req.query.nullOnly, false);
    }
    const newerThan =
      typeof req.query.newerThan === "string" && req.query.newerThan.trim() !== ""
        ? req.query.newerThan.trim()
        : undefined;
    try {
      const watch = timerThrottleService.startWatch(loginUser);
      const result = await aiPostsService.listAiPostsSummaries({
        offset,
        limit,
        order,
        nullOnly,
        newerThan,
      });
      watch.done();
      const packets: AiPostSummaryPacket[] = result.map((r) => toPacket(r));
      res.json(packets);
    } catch (e) {
      res.status(400).json({ error: (e as Error).message || "invalid request" });
    }
  });

  router.get("/recommendations", async (req, res) => {
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
    const tags = parseTagsQueryParam(req.query.tags);
    if (tags.length === 0) {
      return res.status(400).json({ error: "tags is required" });
    }
    let selfUserId: string | undefined;
    if (typeof req.query.selfUserId === "string") {
      const v = req.query.selfUserId.trim();
      if (v !== "") selfUserId = v;
    } else if (Array.isArray(req.query.selfUserId)) {
      const v0 = req.query.selfUserId.find((x): x is string => typeof x === "string");
      const v = (v0 ?? "").trim();
      if (v !== "") selfUserId = v;
    }
    let features: Int8Array | undefined;
    if (typeof req.query.features === "string") {
      const v = req.query.features.trim();
      if (v !== "") {
        try {
          features = base64ToInt8(v);
        } catch {
          return res.status(400).json({ error: "features must be base64 string if specified" });
        }
      }
    } else if (Array.isArray(req.query.features)) {
      const v0 = req.query.features.find((x): x is string => typeof x === "string");
      const v = (v0 ?? "").trim();
      if (v !== "") {
        try {
          features = base64ToInt8(v);
        } catch {
          return res.status(400).json({ error: "features must be base64 string if specified" });
        }
      }
    }
    let dedupWeight: number | undefined;
    if (typeof req.query.dedupWeight === "string") {
      const v = req.query.dedupWeight.trim();
      if (v !== "") {
        const n = Number(v);
        if (!Number.isFinite(n)) {
          return res.status(400).json({ error: "dedupWeight must be number if specified" });
        }
        dedupWeight = n;
      }
    } else if (Array.isArray(req.query.dedupWeight)) {
      const v0 = req.query.dedupWeight.find((x): x is string => typeof x === "string");
      const v = (v0 ?? "").trim();
      if (v !== "") {
        const n = Number(v);
        if (!Number.isFinite(n)) {
          return res.status(400).json({ error: "dedupWeight must be number if specified" });
        }
        dedupWeight = n;
      }
    }
    try {
      const watch = timerThrottleService.startWatch(loginUser);
      const result = await aiPostsService.RecommendPosts({
        tags,
        features,
        selfUserId,
        dedupWeight,
        offset,
        limit,
        order,
      } satisfies RecommendPostsInput);
      watch.done();
      res.json(result);
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
          return res
            .status(400)
            .json({ error: "features must be base64 string or null if specified" });
        }
      } else {
        return res
          .status(400)
          .json({ error: "features must be base64 string or null if specified" });
      }
    }
    if ("tags" in b) {
      if (!Array.isArray(b.tags)) {
        return res.status(400).json({ error: "tags must be array if specified" });
      }
      pkt.tags = Array.from(
        new Set(
          (b.tags as unknown[])
            .filter((t): t is string => typeof t === "string")
            .map((t) => normalizeOneLiner(t.toLowerCase()))
            .filter((t): t is string => typeof t === "string" && t.trim() !== ""),
        ),
      );
    }
    const input: UpdateAiPostSummaryInput = {
      postId: pkt.postId,
      summary: pkt.summary,
      features,
      tags: pkt.tags,
    };
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
