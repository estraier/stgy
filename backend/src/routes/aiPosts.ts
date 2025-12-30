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

function fromSeedPacket(p: SearchSeedPacket): SearchSeed | null {
  if (!p || typeof p !== "object") return null;
  if (!Array.isArray(p.tags)) return null;
  if (typeof p.features !== "string" || p.features.trim() === "") return null;
  if (typeof p.weight !== "number" || !Number.isFinite(p.weight)) return null;

  const tags: SearchSeedTag[] = [];
  for (const t of p.tags as unknown[]) {
    if (!t || typeof t !== "object") return null;
    const r = t as Record<string, unknown>;
    if (typeof r.name !== "string") return null;
    if (
      typeof r.count !== "number" ||
      !Number.isFinite(r.count) ||
      !Number.isInteger(r.count) ||
      r.count <= 0
    ) {
      return null;
    }
    tags.push({ name: r.name, count: r.count });
  }

  let features: Int8Array;
  try {
    features = base64ToInt8(p.features);
  } catch {
    return null;
  }

  return { tags, features, weight: p.weight };
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

function selectSeedsByWeight(seeds: SearchSeed[]): SearchSeed[] {
  const sorted = [...seeds].sort((a, b) => (b.weight ?? 0) - (a.weight ?? 0));
  if (sorted.length <= 2) return sorted;
  return sorted.slice(0, sorted.length - 1);
}

function mergeTagsFromSeeds(seeds: SearchSeed[]): SearchSeedTag[] {
  const m = new Map<string, number>();
  for (const s of seeds) {
    for (const t of s.tags ?? []) {
      const name = normalizeOneLiner(String(t.name ?? "").toLowerCase());
      if (typeof name !== "string" || name.trim() === "") continue;
      const c = typeof t.count === "number" && Number.isFinite(t.count) ? Math.floor(t.count) : 0;
      if (c <= 0) continue;
      m.set(name, (m.get(name) ?? 0) + c);
    }
  }
  return Array.from(m.entries()).map(([name, count]) => ({ name, count }));
}

function mergeFeaturesFromSeeds(seeds: SearchSeed[]): Int8Array | undefined {
  const valid = seeds.filter((s) => s && s.features instanceof Int8Array && s.features.length > 0);
  if (valid.length === 0) return undefined;

  const len = valid[0].features.length;
  if (valid.some((s) => s.features.length !== len)) return valid[0].features;

  const sum = new Float64Array(len);
  let wsum = 0;

  for (const s of valid) {
    const w =
      typeof s.weight === "number" && Number.isFinite(s.weight) && s.weight > 0 ? s.weight : 1;
    wsum += w;
    const f = s.features;
    for (let i = 0; i < len; i++) sum[i] += w * f[i];
  }

  if (!Number.isFinite(wsum) || wsum <= 0) return valid[0].features;

  const out = new Int8Array(len);
  for (let i = 0; i < len; i++) {
    let v = Math.round(sum[i] / wsum);
    if (v > 127) v = 127;
    if (v < -128) v = -128;
    out[i] = v;
  }
  return out;
}

function parseJsonArray<T = unknown>(raw: string | null): T[] | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as unknown;
    if (!Array.isArray(v)) return null;
    return v as T[];
  } catch {
    return null;
  }
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
  const postsService = new PostsService(pgPool, redis, eventLogService);
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
      res.json(result.map((r) => toPacket(r)));
    } catch (e) {
      res.status(400).json({ error: (e as Error).message || "invalid request" });
    }
  });

  router.get("/search-seed", async (req, res) => {
    const loginUser = await authHelpers.requireLogin(req, res);
    if (!loginUser) return;
    if (!loginUser.isAdmin && !(await timerThrottleService.canDo(loginUser.id))) {
      return res.status(403).json({ error: "too often operations" });
    }

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
      res.json(seeds.map((s) => toSeedPacket(s)));
    } catch (e) {
      res.status(400).json({ error: (e as Error).message || "invalid request" });
    }
  });

  router.post("/recommendations", async (req, res) => {
    const loginUser = await authHelpers.requireLogin(req, res);
    if (!loginUser) return;
    if (!loginUser.isAdmin && !(await timerThrottleService.canDo(loginUser.id))) {
      return res.status(403).json({ error: "too often operations" });
    }

    const b = (req.body && typeof req.body === "object" ? req.body : null) as Record<
      string,
      unknown
    > | null;
    if (!b) {
      return res.status(400).json({ error: "invalid body" });
    }

    const { offset, limit, order } = parsePaginationFromBody(
      b,
      loginUser.isAdmin ? 65535 : Config.MAX_PAGE_LIMIT,
    );

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
    const loginUser = await authHelpers.requireLogin(req, res);
    if (!loginUser) return;
    if (!loginUser.isAdmin && !(await timerThrottleService.canDo(loginUser.id))) {
      return res.status(403).json({ error: "too often operations" });
    }

    const b = (req.body && typeof req.body === "object" ? req.body : null) as Record<
      string,
      unknown
    > | null;
    if (!b) {
      return res.status(400).json({ error: "invalid body" });
    }

    const { offset, limit, order } = parsePaginationFromBody(
      b,
      loginUser.isAdmin ? 65535 : Config.MAX_PAGE_LIMIT,
    );

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

  router.get("/recommendations/posts/for-user", async (req, res) => {
    const loginUser = await authHelpers.requireLogin(req, res);
    if (!loginUser) return;
    if (!loginUser.isAdmin && !(await timerThrottleService.canDo(loginUser.id))) {
      return res.status(403).json({ error: "too often operations" });
    }

    const userIdParam =
      typeof req.query.userId === "string" && req.query.userId.trim() !== ""
        ? req.query.userId.trim()
        : undefined;
    if (userIdParam && !loginUser.isAdmin) {
      return res.status(403).json({ error: "forbidden" });
    }
    const targetUserId = loginUser.isAdmin && userIdParam ? userIdParam : loginUser.id;
    const { offset, limit, order } = AuthHelpers.getPageParams(
      req,
      loginUser.isAdmin ? 65535 : Config.MAX_PAGE_LIMIT,
      ["desc", "asc"] as const,
    );
    const seedKey = `recommend-user-seeds:${targetUserId}`;
    const recKey = `recommend-user-posts:${targetUserId}`;
    try {
      const watch = timerThrottleService.startWatch(loginUser);

      let seeds: SearchSeed[] | null = null;

      const cachedSeedsRaw = await redis.get(seedKey);
      const cachedSeedPackets = parseJsonArray<SearchSeedPacket>(cachedSeedsRaw);
      if (cachedSeedPackets && cachedSeedPackets.length > 0) {
        const parsed: SearchSeed[] = [];
        for (const p of cachedSeedPackets) {
          const s = fromSeedPacket(p);
          if (s) parsed.push(s);
        }
        if (parsed.length > 0) seeds = parsed;
      }

      if (!seeds) {
        const rawSeeds = await aiPostsService.BuildSearchSeedForUser(
          targetUserId,
          Config.AI_POST_SEED_NUM_CLUSTERS,
        );
        const selected = selectSeedsByWeight(rawSeeds);
        const packets = selected.map((s) => toSeedPacket(s));
        await redis.set(seedKey, JSON.stringify(packets), "EX", Config.AI_POST_SEED_TTL_SEC);
        seeds = selected;
      }

      let ids: string[] | null = null;

      const cachedIdsRaw = await redis.get(recKey);
      const cachedIds = parseJsonArray<unknown>(cachedIdsRaw);
      if (cachedIds && cachedIds.length > 0) {
        const onlyStrings = cachedIds.filter((x): x is string => typeof x === "string");
        if (onlyStrings.length > 0) ids = onlyStrings;
      }

      if (!ids) {
        const tags = mergeTagsFromSeeds(seeds);
        const features = mergeFeaturesFromSeeds(seeds);
        const outIds = await aiPostsService.RecommendPosts({
          tags,
          features,
          selfUserId: targetUserId,
          dedupWeight: 0.3,
          offset: 0,
          limit: 100,
          order: "desc",
        } satisfies RecommendPostsInput);
        await redis.set(recKey, JSON.stringify(outIds), "EX", Config.AI_POST_RECOMMEND_TTL_SEC);
        ids = outIds;
      }

      const orderedIds = order === "asc" ? [...ids].reverse() : ids;
      const subsetIds = orderedIds.slice(offset, offset + limit);
      const posts = await postsService.listPostsByIds(subsetIds, targetUserId);

      watch.done();
      res.json(posts);
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
      res.json(toPacket(summary));
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
      res.json(toPacket(updated));
    } catch (e) {
      res.status(400).json({ error: (e as Error).message || "update error" });
    }
  });

  return router;
}
