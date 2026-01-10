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
  SearchSeedKeywordHash,
  UpdateAiPostSummaryInput,
  UpdateAiPostSummaryPacket,
} from "../models/aiPost";
import { normalizeOneLiner, parseBoolean, int8ToBase64, base64ToInt8 } from "../utils/format";

const NUM_RELATED_POSTS = 5;

function toPacket(s: AiPostSummary): AiPostSummaryPacket {
  return {
    postId: s.postId,
    updatedAt: s.updatedAt,
    summary: s.summary,
    features: s.features ? int8ToBase64(s.features) : null,
    tags: s.tags ?? [],
    keywordHashes: s.keywordHashes ?? [],
  };
}

function toSeedPacket(seed: SearchSeed): SearchSeedPacket {
  return {
    tags: seed.tags.map((t) => ({ name: t.name, count: t.count })),
    extraTags: seed.extraTags.map((t) => ({ name: t.name, count: t.count })),
    keywordHashes: (seed.keywordHashes ?? []).map((k) => ({ hash: k.hash, count: k.count })),
    features: int8ToBase64(seed.features),
    weight: seed.weight,
    postIds: seed.postIds,
  };
}

function fromSeedPacket(p: SearchSeedPacket): SearchSeed | null {
  if (!p || typeof p !== "object") return null;
  if (!Array.isArray(p.tags)) return null;
  if (typeof p.features !== "string" || p.features.trim() === "") return null;
  if (typeof p.weight !== "number" || !Number.isFinite(p.weight)) return null;
  if (!Array.isArray(p.postIds)) return null;

  const extraTagsRaw: unknown = (p as unknown as Record<string, unknown>).extraTags;
  if (extraTagsRaw !== undefined && !Array.isArray(extraTagsRaw)) return null;

  const keywordHashesRaw: unknown = (p as unknown as Record<string, unknown>).keywordHashes;
  if (keywordHashesRaw !== undefined && !Array.isArray(keywordHashesRaw)) return null;

  const parseTagList = (raw: unknown[]): SearchSeedTag[] | null => {
    const out: SearchSeedTag[] = [];
    for (let i = 0; i < raw.length; i++) {
      const t = raw[i] as unknown;
      if (!t || typeof t !== "object") return null;
      const r = t as Record<string, unknown>;
      if (typeof r.name !== "string") return null;
      if (typeof r.count !== "number" || !Number.isFinite(r.count) || r.count <= 0) return null;
      out.push({ name: r.name, count: r.count });
    }
    return out;
  };

  const parseKeywordHashes = (raw: unknown[]): SearchSeedKeywordHash[] | null => {
    const out: SearchSeedKeywordHash[] = [];
    for (let i = 0; i < raw.length; i++) {
      const t = raw[i] as unknown;
      if (!t || typeof t !== "object") return null;
      const r = t as Record<string, unknown>;
      if (typeof r.hash !== "number" || !Number.isFinite(r.hash)) return null;
      if (typeof r.count !== "number" || !Number.isFinite(r.count) || r.count <= 0) return null;
      out.push({ hash: r.hash, count: r.count });
    }
    return out;
  };

  const tags = parseTagList(p.tags);
  if (!tags) return null;

  const extraTags = extraTagsRaw === undefined ? [] : parseTagList(extraTagsRaw as unknown[]);
  if (!extraTags) return null;

  const keywordHashes =
    keywordHashesRaw === undefined ? [] : parseKeywordHashes(keywordHashesRaw as unknown[]);
  if (!keywordHashes) return null;

  let features: Int8Array;
  try {
    features = base64ToInt8(p.features);
  } catch {
    return null;
  }

  const postIds = p.postIds
    .filter((x): x is string => typeof x === "string")
    .map((s) => s.trim())
    .filter((s) => s !== "");

  return { tags, extraTags, keywordHashes, features, weight: p.weight, postIds };
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
    if (typeof count !== "number" || !Number.isFinite(count) || count <= 0) {
      return { error: `invalid tags[${i}].count` };
    }

    tagCounts.set(name, (tagCounts.get(name) ?? 0) + count);
  }

  const tags = Array.from(tagCounts.entries()).map(([name, count]) => ({ name, count }));
  if (tags.length === 0) return { error: "tags is required" };
  return tags;
}

function selectSeedsByWeight(seeds: SearchSeed[]): SearchSeed[] {
  const sorted = [...seeds].sort((a, b) => b.weight - a.weight);
  if (sorted.length <= 2) return sorted;
  return sorted.slice(0, sorted.length - 1);
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

    let seedPostIds: string[] | undefined;
    if (b.seedPostIds !== undefined) {
      if (!Array.isArray(b.seedPostIds)) {
        return res.status(400).json({ error: "seedPostIds must be array if specified" });
      }
      seedPostIds = Array.from(
        new Set(
          (b.seedPostIds as unknown[])
            .filter((x): x is string => typeof x === "string")
            .map((s) => s.trim())
            .filter((s) => s !== ""),
        ),
      );
      if (seedPostIds.length === 0) seedPostIds = undefined;
    }

    let ownerDecay: number | undefined;
    if (typeof b.ownerDecay === "number") {
      if (!Number.isFinite(b.ownerDecay)) {
        return res.status(400).json({ error: "ownerDecay must be number if specified" });
      }
      ownerDecay = b.ownerDecay;
    } else if (b.ownerDecay !== undefined) {
      return res.status(400).json({ error: "ownerDecay must be number if specified" });
    }

    let promotionByLikesAlpha: number | undefined;
    if (typeof b.promotionByLikesAlpha === "number") {
      if (!Number.isFinite(b.promotionByLikesAlpha)) {
        return res.status(400).json({ error: "promotionByLikesAlpha must be number if specified" });
      }
      promotionByLikesAlpha = b.promotionByLikesAlpha;
    } else if (b.promotionByLikesAlpha !== undefined) {
      return res.status(400).json({ error: "promotionByLikesAlpha must be number if specified" });
    }

    let promotionForSeedPosts: number | undefined;
    if (typeof b.promotionForSeedPosts === "number") {
      if (!Number.isFinite(b.promotionForSeedPosts)) {
        return res.status(400).json({ error: "promotionForSeedPosts must be number if specified" });
      }
      promotionForSeedPosts = b.promotionForSeedPosts;
    } else if (b.promotionForSeedPosts !== undefined) {
      return res.status(400).json({ error: "promotionForSeedPosts must be number if specified" });
    }

    let demotionForReplies: number | undefined;
    if (typeof b.demotionForReplies === "number") {
      if (!Number.isFinite(b.demotionForReplies)) {
        return res.status(400).json({ error: "demotionForReplies must be number if specified" });
      }
      demotionForReplies = b.demotionForReplies;
    } else if (b.demotionForReplies !== undefined) {
      return res.status(400).json({ error: "demotionForReplies must be number if specified" });
    }

    let demotionForDuplication: number | undefined;
    if (typeof b.demotionForDuplication === "number") {
      if (!Number.isFinite(b.demotionForDuplication)) {
        return res
          .status(400)
          .json({ error: "demotionForDuplication must be number if specified" });
      }
      demotionForDuplication = b.demotionForDuplication;
    } else if (b.demotionForDuplication !== undefined) {
      return res.status(400).json({ error: "demotionForDuplication must be number if specified" });
    }

    try {
      const watch = timerThrottleService.startWatch(loginUser);
      const result = await aiPostsService.RecommendPosts({
        tags,
        features,
        seedPostIds,
        selfUserId,
        ownerDecay,
        promotionByLikesAlpha,
        promotionForSeedPosts,
        demotionForReplies,
        demotionForDuplication,
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

    let seedPostIds: string[] | undefined;
    if (b.seedPostIds !== undefined) {
      if (!Array.isArray(b.seedPostIds)) {
        return res.status(400).json({ error: "seedPostIds must be array if specified" });
      }
      seedPostIds = Array.from(
        new Set(
          (b.seedPostIds as unknown[])
            .filter((x): x is string => typeof x === "string")
            .map((s) => s.trim())
            .filter((s) => s !== ""),
        ),
      );
      if (seedPostIds.length === 0) seedPostIds = undefined;
    }

    let ownerDecay: number | undefined;
    if (typeof b.ownerDecay === "number") {
      if (!Number.isFinite(b.ownerDecay)) {
        return res.status(400).json({ error: "ownerDecay must be number if specified" });
      }
      ownerDecay = b.ownerDecay;
    } else if (b.ownerDecay !== undefined) {
      return res.status(400).json({ error: "ownerDecay must be number if specified" });
    }

    let promotionByLikesAlpha: number | undefined;
    if (typeof b.promotionByLikesAlpha === "number") {
      if (!Number.isFinite(b.promotionByLikesAlpha)) {
        return res.status(400).json({ error: "promotionByLikesAlpha must be number if specified" });
      }
      promotionByLikesAlpha = b.promotionByLikesAlpha;
    } else if (b.promotionByLikesAlpha !== undefined) {
      return res.status(400).json({ error: "promotionByLikesAlpha must be number if specified" });
    }

    let promotionForSeedPosts: number | undefined;
    if (typeof b.promotionForSeedPosts === "number") {
      if (!Number.isFinite(b.promotionForSeedPosts)) {
        return res.status(400).json({ error: "promotionForSeedPosts must be number if specified" });
      }
      promotionForSeedPosts = b.promotionForSeedPosts;
    } else if (b.promotionForSeedPosts !== undefined) {
      return res.status(400).json({ error: "promotionForSeedPosts must be number if specified" });
    }

    let demotionForReplies: number | undefined;
    if (typeof b.demotionForReplies === "number") {
      if (!Number.isFinite(b.demotionForReplies)) {
        return res.status(400).json({ error: "demotionForReplies must be number if specified" });
      }
      demotionForReplies = b.demotionForReplies;
    } else if (b.demotionForReplies !== undefined) {
      return res.status(400).json({ error: "demotionForReplies must be number if specified" });
    }

    let demotionForDuplication: number | undefined;
    if (typeof b.demotionForDuplication === "number") {
      if (!Number.isFinite(b.demotionForDuplication)) {
        return res
          .status(400)
          .json({ error: "demotionForDuplication must be number if specified" });
      }
      demotionForDuplication = b.demotionForDuplication;
    } else if (b.demotionForDuplication !== undefined) {
      return res.status(400).json({ error: "demotionForDuplication must be number if specified" });
    }

    try {
      const watch = timerThrottleService.startWatch(loginUser);
      const ids = await aiPostsService.RecommendPosts({
        tags,
        features,
        seedPostIds,
        selfUserId,
        ownerDecay,
        promotionByLikesAlpha,
        promotionForSeedPosts,
        demotionForReplies,
        demotionForDuplication,
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

  router.get("/recommendations/posts/for-user/:userId", async (req, res) => {
    const loginUser = await authHelpers.requireLogin(req, res);
    if (!loginUser) return;
    if (!loginUser.isAdmin && !(await timerThrottleService.canDo(loginUser.id))) {
      return res.status(403).json({ error: "too often operations" });
    }

    const targetUserId = req.params.userId.trim();
    if (targetUserId === "") {
      return res.status(400).json({ error: "userId is required" });
    }
    if (!loginUser.isAdmin && targetUserId !== loginUser.id) {
      return res.status(403).json({ error: "forbidden" });
    }

    const { offset, limit, order } = AuthHelpers.getPageParams(
      req,
      loginUser.isAdmin ? 65535 : Config.MAX_PAGE_LIMIT,
      ["desc", "asc"] as const,
    );

    const seedKey = `recommend-user-seeds:${targetUserId}`;
    const recKey = `recommend-user-posts:${targetUserId}`;

    try {
      const watch = timerThrottleService.startWatch(loginUser);
      let seedPool: SearchSeed[] | null = null;
      const cachedSeedsRaw = await redis.get(seedKey);
      const cachedSeedPackets = parseJsonArray<SearchSeedPacket>(cachedSeedsRaw);
      if (cachedSeedPackets && cachedSeedPackets.length > 0) {
        const parsed: SearchSeed[] = [];
        for (const p of cachedSeedPackets) {
          const s = fromSeedPacket(p);
          if (s) parsed.push(s);
        }
        if (parsed.length > 0) seedPool = parsed;
      }
      if (!seedPool) {
        const rawSeeds = await aiPostsService.BuildSearchSeedForUser(
          targetUserId,
          Config.AI_POST_SEED_NUM_CLUSTERS,
        );
        await redis.set(
          seedKey,
          JSON.stringify(rawSeeds.map((s) => toSeedPacket(s))),
          "EX",
          rawSeeds.length > 0 ? Config.AI_POST_SEED_TTL_SEC : 60,
        );
        seedPool = rawSeeds;
      }
      let ids: string[] | null = null;
      const cachedIdsRaw = await redis.get(recKey);
      const cachedIds = parseJsonArray<unknown>(cachedIdsRaw);
      if (cachedIds && cachedIds.length > 0) {
        const onlyStrings = cachedIds.filter((x): x is string => typeof x === "string");
        if (onlyStrings.length > 0) ids = onlyStrings;
      }

      if (!ids) {
        const seeds = selectSeedsByWeight(seedPool);
        if (seeds.length === 0) {
          await redis.set(recKey, JSON.stringify([]), "EX", 180);
          ids = [];
        } else {
          const maxWeight = seeds.reduce((m, s) => (s.weight > m ? s.weight : m), 0);

          type PerSeed = { ids: string[]; w: number };
          const perSeedResults: PerSeed[] = [];

          for (const seed of seeds) {
            const w = maxWeight > 0 ? seed.weight / maxWeight : 1;

            const outIds = await aiPostsService.RecommendPosts({
              tags: seed.tags,
              features: seed.features,
              seedPostIds: seed.postIds,
              selfUserId: targetUserId,
              ownerDecay: 0.95,
              promotionByLikesAlpha: 5,
              promotionForSeedPosts: 2,
              demotionForReplies: 2,
              demotionForDuplication: 5,
              offset: 0,
              limit: 100,
              order: "desc",
            } satisfies RecommendPostsInput);

            perSeedResults.push({ ids: outIds, w });
          }

          type Scored = { id: string; score: number; w: number };
          const merged: Scored[] = [];

          for (const r of perSeedResults) {
            const list = r.ids;
            const n = list.length;
            const denom = n - 1;
            for (let i = 0; i < n; i++) {
              const exp = denom <= 0 ? 0 : i / denom;
              const base = r.w / 2;
              const score = Math.pow(base, exp);
              merged.push({ id: list[i], score, w: r.w });
            }
          }

          merged.sort((a, b) => {
            if (b.score !== a.score) return b.score - a.score;
            if (b.w !== a.w) return b.w - a.w;
            if (a.id === b.id) return 0;
            return a.id < b.id ? 1 : -1;
          });

          const out: string[] = [];
          const seen = new Set<string>();
          for (const m of merged) {
            if (seen.has(m.id)) continue;
            seen.add(m.id);
            out.push(m.id);
          }

          await redis.set(recKey, JSON.stringify(out), "EX", Config.AI_POST_RECOMMEND_TTL_SEC);
          ids = out;
        }
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

  router.get("/recommendations/posts/for-post/:postId", async (req, res) => {
    const loginUser = await authHelpers.requireLogin(req, res);
    if (!loginUser) return;
    if (!loginUser.isAdmin && !(await timerThrottleService.canDo(loginUser.id))) {
      return res.status(403).json({ error: "too often operations" });
    }

    const targetPostId = req.params.postId.trim();
    if (targetPostId === "") {
      return res.status(400).json({ error: "postId is required" });
    }

    const { offset, limit, order } = AuthHelpers.getPageParams(
      req,
      loginUser.isAdmin ? 65535 : Config.MAX_PAGE_LIMIT,
      ["desc", "asc"] as const,
    );

    const recKey = `recommend-post-posts:${loginUser.id}:${targetPostId}`;

    try {
      const watch = timerThrottleService.startWatch(loginUser);

      let ids: string[] | null = null;

      const cachedIdsRaw = await redis.get(recKey);
      const cachedIds = parseJsonArray<unknown>(cachedIdsRaw);
      if (cachedIds && cachedIds.length > 0) {
        const onlyStrings = cachedIds.filter((x): x is string => typeof x === "string");
        if (onlyStrings.length > 0) ids = onlyStrings;
      }

      if (!ids) {
        const summary = await aiPostsService.getAiPostSummary(targetPostId);
        if (!summary) {
          watch.done();
          return res.status(404).json({ error: "not found" });
        }

        const targetPostLite = await postsService.getPostLite(targetPostId);
        if (!targetPostLite) {
          watch.done();
          return res.status(404).json({ error: "not found" });
        }

        const normalizeTag = (raw: unknown): string | null => {
          if (typeof raw !== "string") return null;
          const name = normalizeOneLiner(raw.toLowerCase());
          if (typeof name !== "string" || name.trim() === "") return null;
          return name;
        };

        const addTagsToMap = (m: Map<string, number>, tagsRaw: unknown, add: number) => {
          if (!Array.isArray(tagsRaw)) return;
          const seen = new Set<string>();
          for (const t of tagsRaw) {
            const name = normalizeTag(t);
            if (!name) continue;
            if (seen.has(name)) continue;
            seen.add(name);
            m.set(name, (m.get(name) ?? 0) + add);
          }
        };

        const targetWeights = new Map<string, number>();
        addTagsToMap(targetWeights, targetPostLite.tags, 1);
        addTagsToMap(targetWeights, summary.tags, 1);

        if (targetWeights.size === 0) {
          await redis.set(recKey, JSON.stringify([]), "EX", 180);
          ids = [];
        } else {
          const authorId = targetPostLite.ownedBy;
          const relatedCounts = new Map<string, number>();
          const recentPosts = await postsService.listPosts(
            {
              ownedBy: authorId,
              offset: 0,
              limit: Math.max(0, NUM_RELATED_POSTS + 1),
              order: "desc",
            },
            loginUser.id,
          );
          let used = 0;
          for (const p of recentPosts) {
            if (p.id === targetPostId) continue;
            addTagsToMap(relatedCounts, p.tags, 0.98 ** used);
            try {
              const s = await aiPostsService.getAiPostSummary(p.id);
              if (s) addTagsToMap(relatedCounts, s.tags, 0.98 ** used);
            } catch {}
            used++;
            if (used >= NUM_RELATED_POSTS) break;
          }
          if (relatedCounts.size > 0) {
            const sorted = Array.from(relatedCounts.entries()).sort((a, b) => {
              if (b[1] !== a[1]) return b[1] - a[1];
              if (a[0] === b[0]) return 0;
              return a[0] < b[0] ? -1 : 1;
            });
            const top = sorted.slice(0, 10);
            const maxCount = top.length > 0 ? top[0][1] : 0;
            const denom = maxCount > 0 ? maxCount : 1;
            for (const [name, count] of top) {
              const w = count / denom;
              targetWeights.set(name, (targetWeights.get(name) ?? 0) + w);
            }
          }
          const tags: SearchSeedTag[] = Array.from(targetWeights.entries()).map(
            ([name, count]) => ({
              name,
              count,
            }),
          );
          const outIds = await aiPostsService.RecommendPosts({
            tags,
            features: summary.features ?? undefined,
            seedPostIds: [targetPostId],
            selfUserId: loginUser.id,
            ownerDecay: 0.95,
            promotionByLikesAlpha: 5,
            promotionForSeedPosts: 2,
            demotionForReplies: 2,
            demotionForDuplication: 5,
            offset: 0,
            limit: 100,
            order: "desc",
          } satisfies RecommendPostsInput);
          await redis.set(recKey, JSON.stringify(outIds), "EX", Config.AI_POST_RECOMMEND_TTL_SEC);
          ids = outIds;
        }
      }
      const orderedIds = order === "asc" ? [...ids].reverse() : ids;
      const subsetIds = orderedIds.slice(offset, offset + limit);
      const posts = await postsService.listPostsByIds(subsetIds, loginUser.id);
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

    if ("keywords" in b) {
      if (!Array.isArray(b.keywords)) {
        return res.status(400).json({ error: "keywords must be array if specified" });
      }
      pkt.keywords = Array.from(
        new Set(
          (b.keywords as unknown[])
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
      keywords: pkt.keywords,
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
