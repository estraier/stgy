import { Config } from "../config";
import { Router, Request } from "express";
import { Pool } from "pg";
import Redis from "ioredis";
import crypto from "crypto";
import type { StorageService } from "../services/storage";
import { PostsService } from "../services/posts";
import { AuthService } from "../services/auth";
import { UsersService } from "../services/users";
import { SearchService } from "../services/search";
import { ThrottleService, DailyTimerThrottleService } from "../services/throttle";
import { AuthHelpers } from "./authHelpers";
import { EventLogService } from "../services/eventLog";
import { PubViewsService, verifyPubViewSignature } from "../services/pubViews";
import { CreatePostInput, UpdatePostInput } from "../models/post";
import { SearchCacheEntry } from "../models/search";
import { makePlainTextDigestFromJsonSnippet } from "../utils/snippet";
import { createLogger } from "../utils/logger";
import { parsePostSearchQuery } from "../utils/postSearchQuery";
import { QUERY_HASH_HEADER, verifyQueryHash } from "../utils/queryHash";
import { KWIC_OPTIONS, parseKwicQuery } from "../utils/kwic";
import { mdMakeKwicData } from "stgy-markdown";
import {
  normalizeOneLiner,
  normalizeMultiLines,
  normalizeLocale,
  parseBoolean,
  decToHex,
  hexToDec,
} from "../utils/format";

const logger = createLogger({ file: "posts-route" });
const PUBLIC_POST_LIST_MAX_LIMIT = 1000;

export default function createPostsRouter(
  pgPool: Pool,
  redis: Redis,
  storageService: StorageService,
  eventLogService: EventLogService,
) {
  const router = Router();
  const postsService = new PostsService(pgPool, redis, eventLogService);
  const usersService = new UsersService(pgPool, redis, eventLogService);
  const pubViewsService = new PubViewsService(pgPool, redis);
  const authService = new AuthService(pgPool, redis);
  const searchService = new SearchService(pgPool, "posts");
  const timerThrottleService = new DailyTimerThrottleService(
    redis,
    "db",
    Config.DAILY_DB_TIMER_LIMIT_MS,
  );
  const postsThrottleService = new ThrottleService(
    redis,
    "posts",
    3600,
    Config.HOURLY_POSTS_COUNT_LIMIT,
    Config.HOURLY_POSTS_SIZE_LIMIT,
  );
  const likesThrottleService = new ThrottleService(
    redis,
    "likes",
    3600,
    Config.HOURLY_LIKES_COUNT_LIMIT,
  );
  const authHelpers = new AuthHelpers(authService, usersService);

  function getReplyToParam(req: Request): string | null | undefined {
    if ("replyTo" in req.query) {
      if (typeof req.query.replyTo === "string") {
        const replyTo = (req.query.replyTo as string).trim();
        if (replyTo.length == 0) return null;
        return replyTo;
      }
    }
    return undefined;
  }

  router.get("/search", async (req, res) => {
    const currentUser = await authHelpers.getCurrentUser(req);
    const isAnonymous = !currentUser;
    if (isAnonymous && !verifyQueryHash(req.originalUrl, req.get(QUERY_HASH_HEADER))) {
      return res.status(403).json({ error: "invalid queryhash" });
    }
    const searchUser = currentUser ?? authHelpers.makeDummyUser();
    if (!searchUser.isAdmin && !(await timerThrottleService.canDo(searchUser.id))) {
      return res.status(403).json({ error: "too often operations" });
    }
    const rawQuery = typeof req.query.query === "string" ? req.query.query.trim() : "";
    if (!rawQuery) {
      return res.status(400).json({ error: "query is required" });
    }
    let parsedQuery: ReturnType<typeof parsePostSearchQuery>;
    try {
      parsedQuery = parsePostSearchQuery(rawQuery);
    } catch (e) {
      return res.status(400).json({ error: (e as Error).message });
    }
    if (!parsedQuery.query) {
      return res.status(400).json({ error: "search term is required" });
    }
    const locale =
      typeof req.query.locale === "string" && req.query.locale ? req.query.locale : "en";
    let queryOwner: string | undefined;
    if (parsedQuery.owners.length > 0) {
      try {
        const normalizedOwners = Array.from(
          new Set(
            parsedQuery.owners.map((owner) => {
              if (owner === "me") {
                if (isAnonymous) throw new Error("owner:me requires login");
                return searchUser.id;
              }
              return decToHex(hexToDec(owner));
            }),
          ),
        );
        if (normalizedOwners.length > 1) {
          return res.status(400).json({ error: "conflicting owner filters" });
        }
        queryOwner = normalizedOwners[0];
      } catch (e) {
        if (e instanceof Error && e.message === "owner:me requires login") {
          return res.status(400).json({ error: e.message });
        }
        return res.status(400).json({ error: "invalid owner filter" });
      }
    }
    let parameterOwner: string | undefined;
    if (typeof req.query.ownedBy === "string" && req.query.ownedBy.trim() !== "") {
      try {
        parameterOwner = decToHex(hexToDec(req.query.ownedBy.trim()));
      } catch {
        return res.status(400).json({ error: "invalid ownedBy" });
      }
    }
    if (isAnonymous && !parameterOwner) {
      return res.status(400).json({ error: "ownedBy is required" });
    }
    if (queryOwner && parameterOwner && queryOwner !== parameterOwner) {
      return res.status(400).json({ error: "conflicting owner filters" });
    }
    const ownedBy = queryOwner ?? parameterOwner;
    const publicOrder = req.query.order === "asc" ? "asc" : "desc";
    const offset = Math.max(0, parseInt(req.query.offset as string) || 0);
    const reqLimit = Math.max(1, parseInt(req.query.limit as string) || 21);
    const neededLimit = offset + reqLimit;
    if (neededLimit > Config.SEARCH_LIMIT_MAX) {
      return res.status(400).json({ error: "Search limit exceeded" });
    }
    const publishedOnly = isAnonymous || parsedQuery.publishedOnly;
    const publishedUntilMs = publishedOnly ? Date.now() : undefined;
    const hash = crypto
      .createHash("md5")
      .update(
        `${rawQuery}:${locale}:${ownedBy ?? ""}:${publishedOnly ? "published" : "all"}:` +
          (isAnonymous ? "anonymous" : "authenticated"),
      )
      .digest("hex");
    const cacheKey = `stgy:search:posts:${hash}`;
    let docIds: string[] = [];
    let isHit = false;
    try {
      const cachedJson = await redis.get(cacheKey);
      if (cachedJson) {
        const cache: SearchCacheEntry = JSON.parse(cachedJson);
        if (cache.limit >= neededLimit || cache.result.length < cache.limit) {
          docIds = cache.result;
          isHit = true;
        }
      }
      if (!isHit) {
        const watch = timerThrottleService.startWatch(searchUser);
        try {
          docIds = await searchService.search({
            query: parsedQuery.query,
            locale,
            offset: 0,
            limit: isAnonymous ? Config.SEARCH_LIMIT_MAX : neededLimit,
            timeout: 3,
            labels: ownedBy ? [`owner:${ownedBy}`] : undefined,
            numericOp: publishedOnly ? "lte" : undefined,
            numericValue: publishedUntilMs,
          });
        } finally {
          watch.done();
        }
        const newCache: SearchCacheEntry = {
          query: rawQuery,
          limit: isAnonymous ? Config.SEARCH_LIMIT_MAX : neededLimit,
          result: docIds,
        };
        await redis.setex(cacheKey, Config.SEARCH_CACHE_TTL_SEC, JSON.stringify(newCache));
      }
      if (isAnonymous) {
        if (!ownedBy || publishedUntilMs === undefined) {
          return res.status(400).json({ error: "invalid public search" });
        }
        const posts = await postsService.listPubPostsByIds(
          docIds,
          ownedBy,
          new Date(publishedUntilMs).toISOString(),
          { offset, limit: reqLimit, order: publicOrder },
        );
        return res.json(posts);
      }
      const slicedIds = docIds.slice(offset, offset + reqLimit);
      const posts = await postsService.listPostsByIds(slicedIds, searchUser.id);
      res.json(posts);
    } catch (e: unknown) {
      console.error("Search error:", e);
      res.status(500).json({ error: (e as Error).message || "Internal server error" });
    }
  });

  router.get("/kwic-pub", async (req, res) => {
    if (!verifyQueryHash(req.originalUrl, req.get(QUERY_HASH_HEADER))) {
      return res.status(403).json({ error: "invalid queryhash" });
    }
    let kwicQuery: ReturnType<typeof parseKwicQuery>;
    try {
      kwicQuery = parseKwicQuery(req.query);
    } catch (e) {
      return res.status(400).json({ error: (e as Error).message });
    }
    const anonymousUser = authHelpers.makeDummyUser();
    if (!(await timerThrottleService.canDo(anonymousUser.id))) {
      return res.status(403).json({ error: "too often operations" });
    }
    const watch = timerThrottleService.startWatch(anonymousUser);
    try {
      const sources = await postsService.listKwicSourcesByIds(
        kwicQuery.ids,
        new Date().toISOString(),
      );
      return res.json(
        sources.map((source) => ({
          id: source.id,
          kwic: mdMakeKwicData(source.content, kwicQuery.keywords, KWIC_OPTIONS),
        })),
      );
    } catch (e) {
      return res.status(500).json({ error: (e as Error).message || "failed to make KWIC" });
    } finally {
      watch.done();
    }
  });

  router.get("/kwic", async (req, res) => {
    const loginUser = await authHelpers.requireLogin(req, res);
    if (!loginUser) return;
    let kwicQuery: ReturnType<typeof parseKwicQuery>;
    try {
      kwicQuery = parseKwicQuery(req.query);
    } catch (e) {
      return res.status(400).json({ error: (e as Error).message });
    }
    if (!loginUser.isAdmin && !(await timerThrottleService.canDo(loginUser.id))) {
      return res.status(403).json({ error: "too often operations" });
    }
    const watch = timerThrottleService.startWatch(loginUser);
    try {
      const sources = await postsService.listKwicSourcesByIds(kwicQuery.ids);
      return res.json(
        sources.map((source) => ({
          id: source.id,
          kwic: mdMakeKwicData(source.content, kwicQuery.keywords, KWIC_OPTIONS),
        })),
      );
    } catch (e) {
      return res.status(500).json({ error: (e as Error).message || "failed to make KWIC" });
    } finally {
      watch.done();
    }
  });

  router.get("/count", async (req, res) => {
    const loginUser = await authHelpers.requireLogin(req, res);
    if (!loginUser) return;
    if (!loginUser.isAdmin) {
      return res.status(403).json({ error: "admin only" });
    }
    const query =
      typeof req.query.query === "string" && req.query.query.trim() !== ""
        ? req.query.query.trim()
        : undefined;
    const ownedBy =
      typeof req.query.ownedBy === "string" && req.query.ownedBy.trim() !== ""
        ? req.query.ownedBy.trim()
        : undefined;
    const tag =
      typeof req.query.tag === "string" && req.query.tag.trim() !== ""
        ? req.query.tag.trim()
        : undefined;
    const replyTo = getReplyToParam(req);
    const watch = timerThrottleService.startWatch(loginUser);
    const count = await postsService.countPosts({
      query,
      ownedBy,
      tag,
      replyTo,
    });
    watch.done();
    res.json({ count });
  });

  router.get("/", async (req, res) => {
    const loginUser = await authHelpers.requireLogin(req, res);
    if (!loginUser) return;
    const query =
      typeof req.query.query === "string" && req.query.query.trim() !== ""
        ? req.query.query.trim()
        : undefined;
    if (query && !loginUser.isAdmin) {
      return res.status(403).json({ error: "admin only" });
    }
    if (!loginUser.isAdmin && !(await timerThrottleService.canDo(loginUser.id))) {
      return res.status(403).json({ error: "too often operations" });
    }
    const { offset, limit, order } = AuthHelpers.getPageParams(
      req,
      loginUser.isAdmin ? 65535 : Config.MAX_PAGE_LIMIT,
      ["desc", "asc"] as const,
    );
    const ownedBy =
      typeof req.query.ownedBy === "string" && req.query.ownedBy.trim() !== ""
        ? req.query.ownedBy.trim()
        : undefined;
    const tag =
      typeof req.query.tag === "string" && req.query.tag.trim() !== ""
        ? req.query.tag.toLowerCase().trim()
        : undefined;
    const replyTo = getReplyToParam(req);
    const focusUserId =
      typeof req.query.focusUserId === "string" && req.query.focusUserId.trim() !== ""
        ? req.query.focusUserId.trim()
        : undefined;
    const afterRaw = req.query.after;
    let after: string | undefined;
    if (afterRaw !== undefined) {
      if (
        typeof afterRaw !== "string" ||
        !/^(?:0x)?[0-9a-fA-F]{1,16}$/.test(afterRaw)
      ) {
        return res.status(400).json({ error: "invalid after" });
      }
      if (offset !== 0) {
        return res.status(400).json({ error: "after requires offset=0" });
      }
      after = afterRaw;
    }
    const watch = timerThrottleService.startWatch(loginUser);
    const posts = await postsService.listPosts(
      {
        offset,
        limit,
        order,
        after,
        query,
        ownedBy,
        tag,
        replyTo,
      },
      focusUserId,
    );
    watch.done();
    res.json(posts);
  });

  router.get("/by-followees", async (req, res) => {
    const loginUser = await authHelpers.requireLogin(req, res);
    if (!loginUser) return;
    if (!loginUser.isAdmin && !(await timerThrottleService.canDo(loginUser.id))) {
      return res.status(403).json({ error: "too often operations" });
    }
    const userId =
      typeof req.query.userId === "string" && req.query.userId.trim() !== ""
        ? req.query.userId.trim()
        : null;
    if (!userId) {
      return res.status(400).json({ error: "userId is required" });
    }
    const { offset, limit, order } = AuthHelpers.getPageParams(
      req,
      loginUser.isAdmin ? 65535 : Config.MAX_PAGE_LIMIT,
      ["desc", "asc"] as const,
    );
    const includeSelf = parseBoolean(req.query.includeSelf as string, false);
    const includeReplies = parseBoolean(req.query.includeReplies as string, true);
    const focusUserId =
      typeof req.query.focusUserId === "string" && req.query.focusUserId.trim() !== ""
        ? req.query.focusUserId.trim()
        : undefined;
    const limitPerUser =
      typeof req.query.limitPerUser === "string" ? parseInt(req.query.limitPerUser) : undefined;
    const watch = timerThrottleService.startWatch(loginUser);
    const result = await postsService.listPostsByFollowees(
      {
        userId,
        offset,
        limit,
        order,
        includeSelf,
        includeReplies,
        limitPerUser,
      },
      focusUserId,
    );
    watch.done();
    res.json(result);
  });

  router.get("/liked", async (req, res) => {
    const loginUser = await authHelpers.requireLogin(req, res);
    if (!loginUser) return;
    if (!loginUser.isAdmin && !(await timerThrottleService.canDo(loginUser.id))) {
      return res.status(403).json({ error: "too often operations" });
    }
    const userId =
      typeof req.query.userId === "string" && req.query.userId.trim() !== ""
        ? req.query.userId.trim()
        : null;
    if (!userId) {
      return res.status(400).json({ error: "userId is required" });
    }
    const { offset, limit, order } = AuthHelpers.getPageParams(
      req,
      loginUser.isAdmin ? 65535 : Config.MAX_PAGE_LIMIT,
      ["desc", "asc"] as const,
    );
    const includeReplies = parseBoolean(req.query.includeReplies as string, true);
    const focusUserId =
      typeof req.query.focusUserId === "string" && req.query.focusUserId.trim() !== ""
        ? req.query.focusUserId.trim()
        : undefined;
    const afterRaw = req.query.after;
    let after: string | undefined;
    if (afterRaw !== undefined) {
      if (typeof afterRaw !== "string" || !/^(?:0x)?[0-9a-fA-F]{1,16}$/.test(afterRaw)) {
        return res.status(400).json({ error: "invalid after" });
      }
      if (offset !== 0) return res.status(400).json({ error: "after requires offset=0" });
      after = afterRaw;
    }
    const watch = timerThrottleService.startWatch(loginUser);
    const result = await postsService.listPostsLikedByUser(
      {
        userId,
        offset,
        limit,
        order,
        after,
        includeReplies,
      },
      focusUserId,
    );
    watch.done();
    res.json(result);
  });

  router.post("/pub-by-ids", async (req, res) => {
    if (!Array.isArray(req.body?.ids)) {
      return res.status(400).json({ error: "ids must be an array" });
    }
    const rawIds = req.body.ids.slice(0, Config.PUB_SIDE_POSTS_MAX);
    if (
      rawIds.some(
        (id: unknown) =>
          typeof id !== "string" || !/^(?:0x)?[0-9a-fA-F]{1,16}$/.test(id),
      )
    ) {
      return res.status(400).json({ error: "invalid id" });
    }
    const ids = rawIds.map((id: string) => decToHex(hexToDec(id)));
    try {
      const posts = await postsService.listPostsByIds(ids);
      const publishedUntilMs = Date.now();
      res.json(
        posts.filter((post) => {
          if (post.publishedAt === null) return false;
          const publishedAtMs = new Date(post.publishedAt).getTime();
          return Number.isFinite(publishedAtMs) && publishedAtMs <= publishedUntilMs;
        }),
      );
    } catch (e) {
      res.status(500).json({ error: (e as Error).message || "failed to get public posts" });
    }
  });

  router.get("/pub/:id", async (req, res) => {
    try {
      const publishedUntil = new Date().toISOString();
      const post = await postsService.getPubPost(req.params.id, publishedUntil);
      if (!post) return res.status(404).json({ error: "not found" });

      const fingerprint = req.get("x-stgy-pub-view-fingerprint") ?? "";
      const signature = req.get("x-stgy-pub-view-signature") ?? "";
      if (post.publishedAt && verifyPubViewSignature(post.id, fingerprint, signature)) {
        try {
          await pubViewsService.recordView({
            ownerId: post.ownedBy,
            postId: post.id,
            publishedAt: post.publishedAt,
            digest: makePlainTextDigestFromJsonSnippet(post.snippet),
            fingerprintHex: fingerprint,
          });
        } catch (e) {
          logger.warn({ err: e, postId: post.id }, "failed to record public post view");
        }
      }

      res.json(post);
    } catch (e) {
      res.status(400).json({ error: (e as Error).message || "invalid request" });
    }
  });

  router.get("/pub-by-user/:userId", async (req, res) => {
    const userId =
      typeof req.params.userId === "string" && req.params.userId.trim() !== ""
        ? req.params.userId.trim()
        : null;
    if (!userId) {
      return res.status(400).json({ error: "userId is required" });
    }
    const { offset, limit, order } = AuthHelpers.getPageParams(
      req,
      Math.max(Config.MAX_PAGE_LIMIT, PUBLIC_POST_LIST_MAX_LIMIT),
      ["desc", "asc"] as const,
    );
    try {
      const publishedUntil = new Date().toISOString();
      const posts = await postsService.listPubPostsByUser(userId, publishedUntil, {
        offset,
        limit,
        order,
      });
      res.json(posts);
    } catch (e) {
      res.status(400).json({ error: (e as Error).message || "invalid request" });
    }
  });

  router.get("/:id/lite", async (req, res) => {
    const loginUser = await authHelpers.requireLogin(req, res);
    if (!loginUser) return;
    if (!loginUser.isAdmin && !(await timerThrottleService.canDo(loginUser.id))) {
      return res.status(403).json({ error: "too often operations" });
    }
    const watch = timerThrottleService.startWatch(loginUser);
    const post = await postsService.getPostLite(req.params.id);
    watch.done();
    if (!post) return res.status(404).json({ error: "not found" });
    res.json(post);
  });

  router.get("/:id", async (req, res) => {
    const loginUser = await authHelpers.requireLogin(req, res);
    if (!loginUser) return;
    if (!loginUser.isAdmin && !(await timerThrottleService.canDo(loginUser.id))) {
      return res.status(403).json({ error: "too often operations" });
    }
    const focusUserId =
      typeof req.query.focusUserId === "string" && req.query.focusUserId.trim() !== ""
        ? req.query.focusUserId.trim()
        : undefined;
    const watch = timerThrottleService.startWatch(loginUser);
    const post = await postsService.getPost(req.params.id, focusUserId);
    watch.done();
    if (!post) return res.status(404).json({ error: "not found" });
    res.json(post);
  });

  router.post("/", async (req, res) => {
    const loginUser = await authHelpers.requireWritableUser(req, res);
    if (!loginUser) return;
    if (!loginUser.isAdmin && !(await timerThrottleService.canDo(loginUser.id))) {
      return res.status(403).json({ error: "too often operations" });
    }
    if (!loginUser.isAdmin && req.body.id) {
      return res.status(400).json({ error: "id setting is for admin only" });
    }
    if (!loginUser.isAdmin && req.body.replyTo) {
      const post = await postsService.getPostLite(req.body.replyTo);
      if (post && (await authHelpers.checkBlock(post.ownedBy, loginUser.id))) {
        return res.status(400).json({ error: "blocked by the owner" });
      }
    }
    let dataSize = 0;
    let ownedBy = loginUser.id;
    if (loginUser.isAdmin && req.body.ownedBy && typeof req.body.ownedBy === "string") {
      ownedBy = req.body.ownedBy;
      dataSize += ownedBy.length;
    }
    if (!Array.isArray(req.body.tags)) {
      return res.status(400).json({ error: "tags is required and must be array" });
    }
    const tags = req.body.tags
      .filter((tag: unknown) => typeof tag === "string")
      .map((tag: string) => normalizeOneLiner(tag.toLowerCase()));
    if (tags.length > Config.TAGS_NUMBER_LIMIT) {
      return res.status(400).json({ error: "tags are too many" });
    }
    dataSize += tags.length * 50;
    const content = normalizeMultiLines(req.body.content) ?? "";
    if (!loginUser.isAdmin && content.length > Config.CONTENT_LENGTH_LIMIT) {
      return res.status(400).json({ error: "content is too long" });
    }
    dataSize += content.length;
    if (!loginUser.isAdmin && !(await postsThrottleService.canDo(loginUser.id, dataSize))) {
      return res.status(403).json({ error: "too often posts" });
    }
    const locale =
      typeof req.body.locale === "string" ? (normalizeLocale(req.body.locale) ?? null) : null;
    try {
      const input: CreatePostInput = {
        id: typeof req.body.id === "string" ? (normalizeOneLiner(req.body.id) ?? "") : undefined,
        content: content,
        locale: locale,
        ownedBy,
        replyTo: req.body.replyTo ?? null,
        publishedAt: typeof req.body.publishedAt === "string" ? req.body.publishedAt : null,
        allowLikes: req.body.allowLikes === undefined ? true : req.body.allowLikes,
        allowReplies: req.body.allowReplies === undefined ? true : req.body.allowReplies,
        tags,
      };
      const watch = timerThrottleService.startWatch(loginUser);
      const created = await postsService.createPost(input);
      watch.done();
      if (!loginUser.isAdmin) {
        await postsThrottleService.recordDone(loginUser.id, dataSize);
      }
      res.status(201).json(created);
    } catch (e) {
      res.status(400).json({ error: (e as Error).message || "invalid input" });
    }
  });

  router.put("/:id", async (req, res) => {
    const loginUser = await authHelpers.requireWritableUser(req, res);
    if (!loginUser) return;
    if (!loginUser.isAdmin && !(await timerThrottleService.canDo(loginUser.id))) {
      return res.status(403).json({ error: "too often operations" });
    }
    if (!loginUser.isAdmin) {
      const post = await postsService.getPost(req.params.id);
      if (!post) return res.status(404).json({ error: "not found" });
      if (post.ownedBy !== loginUser.id) {
        return res.status(403).json({ error: "forbidden" });
      }
      if (req.body.ownedBy !== undefined) {
        return res.status(403).json({ error: "forbidden" });
      }
    }
    let dataSize = 0;
    let content;
    if (req.body.content) {
      content = normalizeMultiLines(req.body.content) ?? "";
      if (!loginUser.isAdmin && content.length > Config.CONTENT_LENGTH_LIMIT) {
        return res.status(400).json({ error: "content is too long" });
      }
      dataSize += content.length;
    }
    let locale: string | null | undefined;
    if (req.body.locale === null) {
      locale = null;
    } else if (typeof req.body.locale === "string") {
      locale = req.body.locale;
    }
    let tags;
    if ("tags" in req.body) {
      if (!Array.isArray(req.body.tags)) {
        return res.status(400).json({ error: "tags must be array if specified" });
      }
      tags = req.body.tags
        .filter((tag: unknown) => typeof tag === "string")
        .map((tag: string) => normalizeOneLiner(tag.toLowerCase()));
      if (tags.length > Config.TAGS_NUMBER_LIMIT) {
        return res.status(400).json({ error: "tags are too many" });
      }
      dataSize += tags.length * 50;
    }
    if (!loginUser.isAdmin && !(await postsThrottleService.canDo(loginUser.id, dataSize))) {
      return res.status(403).json({ error: "too often posts" });
    }
    try {
      const input: UpdatePostInput = {
        id: req.params.id,
        ownedBy: req.body.ownedBy,
        content: content,
        locale: locale,
        replyTo: req.body.replyTo,
        publishedAt: req.body.publishedAt,
        allowLikes: req.body.allowLikes,
        allowReplies: req.body.allowReplies,
        tags,
      };
      const watch = timerThrottleService.startWatch(loginUser);
      const updated = await postsService.updatePost(input);
      watch.done();
      if (!updated) return res.status(404).json({ error: "not found" });
      res.json(updated);
    } catch (e) {
      res.status(400).json({ error: (e as Error).message || "update error" });
    }
  });

  router.delete("/:id", async (req, res) => {
    const loginUser = await authHelpers.requireWritableUser(req, res);
    if (!loginUser) return;
    if (!loginUser.isAdmin && !(await timerThrottleService.canDo(loginUser.id))) {
      return res.status(403).json({ error: "too often operations" });
    }
    if (!loginUser.isAdmin) {
      const post = await postsService.getPost(req.params.id);
      if (!post) return res.status(404).json({ error: "not found" });
      if (post.ownedBy !== loginUser.id) {
        return res.status(403).json({ error: "forbidden" });
      }
    }
    try {
      const watch = timerThrottleService.startWatch(loginUser);
      await postsService.deletePost(req.params.id);
      watch.done();
      res.json({ result: "ok" });
    } catch (e) {
      const msg = (e as Error).message || "";
      if (/post not found/i.test(msg)) return res.status(404).json({ error: "not found" });
      res.status(400).json({ error: msg || "delete error" });
    }
  });

  router.post("/:id/like", async (req, res) => {
    const loginUser = await authHelpers.requireWritableUser(req, res);
    if (!loginUser) return;
    if (!loginUser.isAdmin && !(await timerThrottleService.canDo(loginUser.id))) {
      return res.status(403).json({ error: "too often operations" });
    }
    if (!loginUser.isAdmin && !(await likesThrottleService.canDo(loginUser.id))) {
      return res.status(403).json({ error: "too often likes" });
    }
    if (!loginUser.isAdmin) {
      const post = await postsService.getPostLite(req.params.id);
      if (post && (await authHelpers.checkBlock(post.ownedBy, loginUser.id))) {
        return res.status(400).json({ error: "blocked by the owner" });
      }
    }
    try {
      const watch = timerThrottleService.startWatch(loginUser);
      await postsService.addLike(req.params.id, loginUser.id);
      watch.done();
      if (!loginUser.isAdmin) {
        await likesThrottleService.recordDone(loginUser.id);
      }
      res.json({ result: "ok" });
    } catch (e) {
      const msg = (e as Error).message || "";
      if (/already liked/i.test(msg)) return res.status(400).json({ error: "already liked" });
      res.status(400).json({ error: msg || "could not like" });
    }
  });

  router.delete("/:id/like", async (req, res) => {
    const loginUser = await authHelpers.requireWritableUser(req, res);
    if (!loginUser) return;
    if (!loginUser.isAdmin && !(await timerThrottleService.canDo(loginUser.id))) {
      return res.status(403).json({ error: "too often operations" });
    }
    try {
      const watch = timerThrottleService.startWatch(loginUser);
      await postsService.removeLike(req.params.id, loginUser.id);
      watch.done();
      res.json({ result: "ok" });
    } catch (e) {
      const msg = (e as Error).message || "";
      if (/not liked/i.test(msg)) return res.status(404).json({ error: "like not found" });
      res.status(400).json({ error: msg || "could not remove like" });
    }
  });

  router.get("/:id/likers", async (req, res) => {
    const loginUser = await authHelpers.requireLogin(req, res);
    if (!loginUser) return;
    if (!loginUser.isAdmin && !(await timerThrottleService.canDo(loginUser.id))) {
      return res.status(403).json({ error: "too often operations" });
    }
    const postId = req.params.id;
    const { offset, limit, order } = AuthHelpers.getPageParams(
      req,
      loginUser.isAdmin ? 65535 : Config.MAX_PAGE_LIMIT,
      ["desc", "asc"] as const,
    );
    try {
      const watch = timerThrottleService.startWatch(loginUser);
      const loginUsers = await postsService.listLikers({ postId, offset, limit, order });
      watch.done();
      res.json(loginUsers);
    } catch (e) {
      res.status(400).json({ error: (e as Error).message || "invalid request" });
    }
  });

  return router;
}
