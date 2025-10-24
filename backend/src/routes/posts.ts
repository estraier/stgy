import { Config } from "../config";
import { Router, Request } from "express";
import { Pool } from "pg";
import Redis from "ioredis";
import type { StorageService } from "../services/storage";
import { PostsService } from "../services/posts";
import { AuthService } from "../services/auth";
import { UsersService } from "../services/users";
import { ThrottleService, DailyTimerThrottleService } from "../services/throttle";
import { AuthHelpers } from "./authHelpers";
import { EventLogService } from "../services/eventLog";
import { CreatePostInput, UpdatePostInput } from "../models/post";
import { normalizeOneLiner, normalizeMultiLines, parseBoolean } from "../utils/format";

export default function createPostsRouter(
  pgPool: Pool,
  redis: Redis,
  storageService: StorageService,
  eventLogService: EventLogService,
) {
  const router = Router();
  const postsService = new PostsService(pgPool, redis, eventLogService);
  const usersService = new UsersService(pgPool, redis, eventLogService);
  const authService = new AuthService(pgPool, redis);
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

  router.get("/count", async (req, res) => {
    const loginUser = await authHelpers.requireLogin(req, res);
    if (!loginUser) return;
    if (!loginUser.isAdmin && !(await timerThrottleService.canDo(loginUser.id))) {
      return res.status(403).json({ error: "too often operations" });
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
    if (!loginUser.isAdmin && !(await timerThrottleService.canDo(loginUser.id))) {
      return res.status(403).json({ error: "too often operations" });
    }
    const { offset, limit, order } = AuthHelpers.getPageParams(
      req,
      loginUser.isAdmin ? 65535 : Config.MAX_PAGE_LIMIT,
      ["desc", "asc"] as const,
    );
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
    const focusUserId =
      typeof req.query.focusUserId === "string" && req.query.focusUserId.trim() !== ""
        ? req.query.focusUserId.trim()
        : undefined;
    const watch = timerThrottleService.startWatch(loginUser);
    const posts = await postsService.listPosts(
      {
        offset,
        limit,
        order,
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
    const watch = timerThrottleService.startWatch(loginUser);
    const result = await postsService.listPostsByFollowees(
      {
        userId,
        offset,
        limit,
        order,
        includeSelf,
        includeReplies,
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
    const watch = timerThrottleService.startWatch(loginUser);
    const result = await postsService.listPostsLikedByUser(
      {
        userId,
        offset,
        limit,
        order,
        includeReplies,
      },
      focusUserId,
    );
    watch.done();
    res.json(result);
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
    const loginUser = await authHelpers.requireLogin(req, res);
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
      .map((tag: string) => normalizeOneLiner(tag));
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

    console.log(loginUser);

    try {
      const input: CreatePostInput = {
        id: typeof req.body.id === "string" ? (normalizeOneLiner(req.body.id) ?? "") : undefined,
        content: content,
        locale: "und",
        ownedBy,
        replyTo: req.body.replyTo ?? null,
        allowLikes: req.body.allowLikes === undefined ? true : req.body.allowLikes,
        allowReplies: req.body.allowReplies === undefined ? true : req.body.allowReplies,
        publishedAt: typeof req.body.publishedAt === "string" ? req.body.publishedAt : null,
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
    const loginUser = await authHelpers.requireLogin(req, res);
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
    let tags;
    if ("tags" in req.body) {
      if (!Array.isArray(req.body.tags)) {
        return res.status(400).json({ error: "tags must be array if specified" });
      }
      tags = req.body.tags
        .filter((tag: unknown) => typeof tag === "string")
        .map((tag: string) => normalizeOneLiner(tag));
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
        locale: undefined,
        replyTo: req.body.replyTo,
        allowLikes: req.body.allowLikes,
        allowReplies: req.body.allowReplies,
        publishedAt: req.body.publishedAt,
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
    const loginUser = await authHelpers.requireLogin(req, res);
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
    const loginUser = await authHelpers.requireLogin(req, res);
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
    const loginUser = await authHelpers.requireLogin(req, res);
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
