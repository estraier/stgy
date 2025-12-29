import { Config } from "../config";
import { Router } from "express";
import type { Request, Response } from "express";
import { Pool } from "pg";
import Redis from "ioredis";
import { AiPostsService } from "../services/aiPosts";
import { AuthService } from "../services/auth";
import { UsersService } from "../services/users";
import { DailyTimerThrottleService } from "../services/throttle";
import { AuthHelpers } from "./authHelpers";
import { EventLogService } from "../services/eventLog";
import { PostsService } from "../services/posts";
import type {
  AiPostPagination,
  AiPostSummary,
  AiPostSummaryPacket,
  RecommendPostsInput,
  SearchSeed,
  SearchSeedPacket,
  SearchSeedTag,
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

function toSeedPacket(seed: SearchSeed): SearchSeedPacket {
  return {
    tags: seed.tags.map((t) => ({ name: t.name, count: t.count })),
    features: int8ToBase64(seed.features),
    weight: seed.weight,
  };
}

function limitMaxOf(isAdmin: boolean): number {
  return isAdmin ? 65535 : Config.MAX_PAGE_LIMIT;
}

function parsePaginationFromBody(
  b: Record<string, unknown>,
  limitMax: number,
): Required<AiPostPagination> {
  let offset = 0;
  if (typeof b.offset === "number" && Number.isFinite(b.offset) && b.offset >= 0) {
    offset = Math.floor(b.offset);
  }

  let limit = 100;
  if (typeof b.limit === "number" && Number.isFinite(b.limit) && b.limit >= 0) {
    limit = Math.floor(b.limit);
  }
  if (limit > limitMax) limit = limitMax;

  let order: "desc" | "asc" = "desc";
  if (typeof b.order === "string" && b.order.toLowerCase() === "asc") order = "asc";

  return { offset, limit, order };
}

function normalizeTagsFromBody(tagsRaw: unknown): SearchSeedTag[] | { error: string } {
  if (!Array.isArray(tagsRaw) || tagsRaw.length === 0) {
    return { error: "tags is required" };
  }

  const tagCounts = new Map<string, number>();

  for (let i = 0; i < tagsRaw.length; i++) {
    const t0 = tagsRaw[i] as unknown;
    const t = (t0 && typeof t0 === "object" ? (t0 as Record<string, unknown>) : null) as Record<
      string,
      unknown
    > | null;

    if (!t) return { error: `invalid tags[${i}]` };

    const nameRaw = typeof t.name === "string" ? t.name : "";
    const name = normalizeOneLiner(nameRaw.toLowerCase());
    if (typeof name !== "string" || name.trim() === "") return { error: `invalid tags[${i}].name` };

    const count = t.count;
    if (
      typeof count !== "number" ||
      !Number.isFinite(count) ||
      !Number.isInteger(count) ||
      count <= 0
    ) {
      return { error: `invalid tags[${i}].count` };
    }

    tagCounts.set(name, (tagCounts.get(name) ?? 0) + count);
  }

  const tags = Array.from(tagCounts.entries()).map(([name, count]) => ({ name, count }));
  if (tags.length === 0) return { error: "tags is required" };
  return tags;
}

type ThrottleUser = Parameters<DailyTimerThrottleService["startWatch"]>[0];
type LoginUser = ThrottleUser & { id: string; isAdmin: boolean };

export default function createAiPostsRouter(
  pgPool: Pool,
  redis: Redis,
  eventLogService: EventLogService,
) {
  const router = Router();
  const aiPostsService = new AiPostsService(pgPool);
  const usersService = new UsersService(pgPool, redis, eventLogService);
  const authService = new AuthService(pgPool, redis);
  const postsService = new PostsService(pgPool, redis, eventLogService);
  const timerThrottleService = new DailyTimerThrottleService(
    redis,
    "db",
    Config.DAILY_DB_TIMER_LIMIT_MS,
  );
  const authHelpers = new AuthHelpers(authService, usersService);

  const requireLoginAndThrottle = async (
    req: Request,
    res: Response,
  ): Promise<LoginUser | null> => {
    const u = (await authHelpers.requireLogin(req, res)) as unknown;
    if (!u) return null;

    const loginUser = u as LoginUser;

    if (!loginUser.isAdmin && !(await timerThrottleService.canDo(loginUser.id))) {
      res.status(403).json({ error: "too often operations" });
      return null;
    }
    return loginUser;
  };

  router.get("/", async (req, res) => {
    const loginUser = await requireLoginAndThrottle(req, res);
    if (!loginUser) return;

    const { offset, limit, order } = AuthHelpers.getPageParams(req, limitMaxOf(loginUser.isAdmin), [
      "desc",
      "asc",
    ] as const);

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

  router.get("/search-seed", async (req, res) => {
    const loginUser = await requireLoginAndThrottle(req, res);
    if (!loginUser) return;

    const userIdParam =
      typeof req.query.userId === "string" && req.query.userId.trim() !== ""
        ? req.query.userId.trim()
        : undefined;
    if (userIdParam && !loginUser.isAdmin) {
      return res.status(403).json({ error: "forbidden" });
    }
    const targetUserId = loginUser.isAdmin && userIdParam ? userIdParam : loginUser.id;

    const nRaw =
      typeof req.query.numClusters === "string"
        ? req.query.numClusters.trim()
        : typeof req.query.clusters === "string"
          ? req.query.clusters.trim()
          : "";
    const nParsed = nRaw === "" ? 1 : Number(nRaw);
    if (!Number.isFinite(nParsed) || !Number.isInteger(nParsed) || nParsed <= 0) {
      return res.status(400).json({ error: "numClusters must be positive integer" });
    }
    const numClusters = Math.min(loginUser.isAdmin ? 100 : 10, nParsed);

    try {
      const watch = timerThrottleService.startWatch(loginUser);
      const seeds = await aiPostsService.BuildSearchSeedForUser(targetUserId, numClusters);
      watch.done();
      const packets: SearchSeedPacket[] = seeds.map((s) => toSeedPacket(s));
      res.json(packets);
    } catch (e) {
      res.status(400).json({ error: (e as Error).message || "invalid request" });
    }
  });

  router.post("/recommendations", async (req, res) => {
    const loginUser = await requireLoginAndThrottle(req, res);
    if (!loginUser) return;

    const b = (req.body && typeof req.body === "object" ? req.body : null) as Record<
      string,
      unknown
    > | null;
    if (!b) {
      return res.status(400).json({ error: "invalid body" });
    }

    const { offset, limit, order } = parsePaginationFromBody(b, limitMaxOf(loginUser.isAdmin));

    const tagsParsed = normalizeTagsFromBody(b.tags);
    if (!Array.isArray(tagsParsed)) {
      return res.status(400).json({ error: tagsParsed.error });
    }
    const tags = tagsParsed;

    let selfUserId: string | undefined;
    if (typeof b.selfUserId === "string") {
      const v = b.selfUserId.trim();
      if (v !== "") selfUserId = v;
    }

    let features: Int8Array | undefined;
    if (typeof b.features === "string") {
      const v = b.features.trim();
      if (v !== "") {
        try {
          features = base64ToInt8(v);
        } catch {
          return res.status(400).json({ error: "features must be base64 string if specified" });
        }
      }
    } else if (b.features !== undefined && b.features !== null) {
      return res.status(400).json({ error: "features must be base64 string or null if specified" });
    }

    let dedupWeight: number | undefined;
    if (typeof b.dedupWeight === "number") {
      if (!Number.isFinite(b.dedupWeight)) {
        return res.status(400).json({ error: "dedupWeight must be number if specified" });
      }
      dedupWeight = b.dedupWeight;
    } else if (b.dedupWeight !== undefined) {
      return res.status(400).json({ error: "dedupWeight must be number if specified" });
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

  router.post("/recommendations/posts", async (req, res) => {
    const loginUser = await requireLoginAndThrottle(req, res);
    if (!loginUser) return;

    const b = (req.body && typeof req.body === "object" ? req.body : null) as Record<
      string,
      unknown
    > | null;
    if (!b) {
      return res.status(400).json({ error: "invalid body" });
    }

    const { offset, limit, order } = parsePaginationFromBody(b, limitMaxOf(loginUser.isAdmin));

    const tagsParsed = normalizeTagsFromBody(b.tags);
    if (!Array.isArray(tagsParsed)) {
      return res.status(400).json({ error: tagsParsed.error });
    }
    const tags = tagsParsed;

    let selfUserId: string | undefined;
    if (typeof b.selfUserId === "string") {
      const v = b.selfUserId.trim();
      if (v !== "") selfUserId = v;
    }

    let features: Int8Array | undefined;
    if (typeof b.features === "string") {
      const v = b.features.trim();
      if (v !== "") {
        try {
          features = base64ToInt8(v);
        } catch {
          return res.status(400).json({ error: "features must be base64 string if specified" });
        }
      }
    } else if (b.features !== undefined && b.features !== null) {
      return res.status(400).json({ error: "features must be base64 string or null if specified" });
    }

    let dedupWeight: number | undefined;
    if (typeof b.dedupWeight === "number") {
      if (!Number.isFinite(b.dedupWeight)) {
        return res.status(400).json({ error: "dedupWeight must be number if specified" });
      }
      dedupWeight = b.dedupWeight;
    } else if (b.dedupWeight !== undefined) {
      return res.status(400).json({ error: "dedupWeight must be number if specified" });
    }

    try {
      const watch = timerThrottleService.startWatch(loginUser);
      const ids = await aiPostsService.RecommendPosts({
        tags,
        features,
        selfUserId,
        dedupWeight,
        offset,
        limit,
        order,
      } satisfies RecommendPostsInput);
      const posts = await postsService.listPostsByIds(ids, selfUserId);
      watch.done();
      res.json(posts);
    } catch (e) {
      res.status(400).json({ error: (e as Error).message || "invalid request" });
    }
  });

  router.head("/:id", async (req, res) => {
    const loginUser = await requireLoginAndThrottle(req, res);
    if (!loginUser) return;

    const watch = timerThrottleService.startWatch(loginUser);
    const exists = await aiPostsService.checkAiPostSummary(req.params.id);
    watch.done();
    if (!exists) return res.sendStatus(404);
    return res.sendStatus(200);
  });

  router.get("/:id", async (req, res) => {
    const loginUser = await requireLoginAndThrottle(req, res);
    if (!loginUser) return;

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
    const loginUser = await requireLoginAndThrottle(req, res);
    if (!loginUser) return;

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
