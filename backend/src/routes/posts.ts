import { Config } from "../config";
import { Router, Request, Response } from "express";
import { Client } from "pg";
import Redis from "ioredis";
import { strToBool } from "./utils";
import { PostsService } from "../services/posts";
import { AuthService } from "../services/auth";
import { UsersService } from "../services/users";
import { ThrottleService } from "../services/throttle";
import { AuthHelpers } from "./authHelpers";
import { CreatePostInput, UpdatePostInput } from "../models/post";
import { User } from "../models/user";
import { normalizeOneLiner, normalizeMultiLines, parseBoolean } from "../utils/format";

export default function createPostsRouter(pgClient: Client, redis: Redis) {
  const router = Router();
  const postsService = new PostsService(pgClient, redis);
  const usersService = new UsersService(pgClient, redis);
  const authService = new AuthService(pgClient, redis);
  const postsThrottleService = new ThrottleService(redis, "posts", 3600, Config.HOURLY_POSTS_LIMIT);
  const likesThrottleService = new ThrottleService(redis, "likes", 3600, Config.HOURLY_LIKES_LIMIT);
  const authHelpers = new AuthHelpers(authService, usersService);

  async function requireLogin(req: Request, res: Response): Promise<User | null> {
    const user = await authHelpers.getCurrentUser(req);
    if (!user) {
      res.status(401).json({ error: "login required" });
      return null;
    }
    return user as User;
  }

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
    const user = await requireLogin(req, res);
    if (!user) return;
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

    const count = await postsService.countPosts({
      query,
      ownedBy,
      tag,
      replyTo,
    });
    res.json({ count });
  });

  router.get("/", async (req, res) => {
    const user = await requireLogin(req, res);
    if (!user) return;
    const offset = parseInt((req.query.offset as string) ?? "0", 10);
    const limit = parseInt((req.query.limit as string) ?? "100", 10);
    const order = (req.query.order as string) === "asc" ? "asc" : "desc";
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

    const posts = await postsService.listPosts({
      offset,
      limit,
      order,
      query,
      ownedBy,
      tag,
      replyTo,
    });
    res.json(posts);
  });

  router.get("/detail", async (req, res) => {
    const user = await requireLogin(req, res);
    if (!user) return;
    const offset = parseInt((req.query.offset as string) ?? "0", 10);
    const limit = parseInt((req.query.limit as string) ?? "100", 10);
    const order = (req.query.order as string) === "asc" ? "asc" : "desc";
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
    const posts = await postsService.listPostsDetail(
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
    res.json(posts);
  });

  router.get("/by-followees/detail", async (req, res) => {
    const loginUser = await requireLogin(req, res);
    if (!loginUser) return;
    const userId =
      typeof req.query.userId === "string" && req.query.userId.trim() !== ""
        ? req.query.userId.trim()
        : null;
    if (!userId) {
      return res.status(400).json({ error: "userId is required" });
    }
    const offset = parseInt((req.query.offset as string) ?? "0", 10);
    const limit = parseInt((req.query.limit as string) ?? "100", 10);
    const order = (req.query.order as string) === "asc" ? "asc" : "desc";
    const includeSelf = strToBool(req.query.includeSelf as string, false);
    const includeReplies = strToBool(req.query.includeReplies as string, true);
    const focusUserId =
      typeof req.query.focusUserId === "string" && req.query.focusUserId.trim() !== ""
        ? req.query.focusUserId.trim()
        : undefined;
    const result = await postsService.listPostsByFolloweesDetail(
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
    res.json(result);
  });

  router.get("/liked/detail", async (req, res) => {
    const loginUser = await requireLogin(req, res);
    if (!loginUser) return;
    const userId =
      typeof req.query.userId === "string" && req.query.userId.trim() !== ""
        ? req.query.userId.trim()
        : null;
    if (!userId) {
      return res.status(400).json({ error: "userId is required" });
    }
    const offset = parseInt((req.query.offset as string) ?? "0", 10);
    const limit = parseInt((req.query.limit as string) ?? "100", 10);
    const order = (req.query.order as string) === "asc" ? "asc" : "desc";
    const includeReplies = strToBool(req.query.includeReplies as string, true);
    const focusUserId =
      typeof req.query.focusUserId === "string" && req.query.focusUserId.trim() !== ""
        ? req.query.focusUserId.trim()
        : undefined;
    const result = await postsService.listPostsLikedByUserDetail(
      {
        userId,
        offset,
        limit,
        order,
        includeReplies,
      },
      focusUserId,
    );
    res.json(result);
  });

  router.get("/:id/detail", async (req, res) => {
    const user = await requireLogin(req, res);
    if (!user) return;
    const focusUserId =
      typeof req.query.focusUserId === "string" && req.query.focusUserId.trim() !== ""
        ? req.query.focusUserId.trim()
        : undefined;
    const post = await postsService.getPostDetail(req.params.id, focusUserId);
    if (!post) return res.status(404).json({ error: "not found" });
    res.json(post);
  });

  router.get("/:id", async (req, res) => {
    const user = await requireLogin(req, res);
    if (!user) return;
    const post = await postsService.getPost(req.params.id);
    if (!post) return res.status(404).json({ error: "not found" });
    res.json(post);
  });

  router.post("/", async (req, res) => {
    const user = await requireLogin(req, res);
    if (!user) return;
    if (!user.isAdmin && !(await postsThrottleService.canDo(user.id))) {
      return res.status(403).json({ error: "too often posts" });
    }
    try {
      let ownedBy = user.id;
      if (user.isAdmin && req.body.ownedBy && typeof req.body.ownedBy === "string") {
        ownedBy = req.body.ownedBy;
      }
      if (!Array.isArray(req.body.tags)) {
        return res.status(400).json({ error: "tags is required and must be array" });
      }
      const tags = req.body.tags
        .filter((tag: unknown) => typeof tag === "string")
        .map((tag: string) => normalizeOneLiner(tag));
      const content = normalizeMultiLines(req.body.content) ?? "";
      if (!user.isAdmin && content.length > Config.CONTENT_LENGTH_LIMIT) {
        return res.status(400).json({ error: "content is too long" });
      }
      const input: CreatePostInput = {
        content: content,
        ownedBy,
        replyTo: req.body.replyTo ?? null,
        allowLikes: req.body.allowLikes === undefined ? true : parseBoolean(req.body.allowLikes),
        allowReplies:
          req.body.allowReplies === undefined ? true : parseBoolean(req.body.allowReplies),
        tags,
      };
      const created = await postsService.createPost(input);
      if (!user.isAdmin) {
        postsThrottleService.recordDone(user.id);
      }
      res.status(201).json(created);
    } catch (e) {
      res.status(400).json({ error: (e as Error).message || "invalid input" });
    }
  });

  router.put("/:id", async (req, res) => {
    const user = await requireLogin(req, res);
    if (!user) return;
    const post = await postsService.getPost(req.params.id);
    if (!post) return res.status(404).json({ error: "not found" });
    if (!(user.isAdmin || post.ownedBy === user.id)) {
      return res.status(403).json({ error: "forbidden" });
    }
    if (!user.isAdmin && req.body.ownedBy !== undefined) {
      return res.status(403).json({ error: "forbidden" });
    }
    try {
      let tags;
      if ("tags" in req.body) {
        if (!Array.isArray(req.body.tags)) {
          return res.status(400).json({ error: "tags must be array if specified" });
        }
        tags = req.body.tags
          .filter((tag: unknown) => typeof tag === "string")
          .map((tag: string) => normalizeOneLiner(tag));
      }
      let content;
      if (req.body.content) {
        content = normalizeMultiLines(req.body.content) ?? "";
        if (!user.isAdmin && content.length > Config.CONTENT_LENGTH_LIMIT) {
          return res.status(400).json({ error: "content is too long" });
        }
      }
      const input: UpdatePostInput = {
        id: req.params.id,
        content: content,
        ownedBy: req.body.ownedBy,
        replyTo: req.body.replyTo,
        allowLikes:
          req.body.allowLikes === undefined ? undefined : parseBoolean(req.body.allowLikes),
        allowReplies:
          req.body.allowReplies === undefined ? undefined : parseBoolean(req.body.allowReplies),
        tags,
      };
      const updated = await postsService.updatePost(input);
      if (!updated) return res.status(404).json({ error: "not found" });
      res.json(updated);
    } catch (e) {
      res.status(400).json({ error: (e as Error).message || "update error" });
    }
  });

  router.delete("/:id", async (req, res) => {
    const user = await requireLogin(req, res);
    if (!user) return;
    const post = await postsService.getPost(req.params.id);
    if (!post) return res.status(404).json({ error: "not found" });
    if (!(user.isAdmin || post.ownedBy === user.id)) {
      return res.status(403).json({ error: "forbidden" });
    }
    try {
      await postsService.deletePost(req.params.id);
      res.json({ result: "ok" });
    } catch (e) {
      const msg = (e as Error).message || "";
      if (/post not found/i.test(msg)) return res.status(404).json({ error: "not found" });
      res.status(400).json({ error: msg || "delete error" });
    }
  });

  router.post("/:id/like", async (req, res) => {
    const user = await requireLogin(req, res);
    if (!user) return;
    if (!user.isAdmin && !(await likesThrottleService.canDo(user.id))) {
      return res.status(403).json({ error: "too often likes" });
    }
    try {
      await postsService.addLike(req.params.id, user.id);
      if (!user.isAdmin) {
        likesThrottleService.recordDone(user.id);
      }
      res.json({ result: "ok" });
    } catch (e) {
      const msg = (e as Error).message || "";
      if (/already liked/i.test(msg)) return res.status(400).json({ error: "already liked" });
      res.status(400).json({ error: msg || "could not like" });
    }
  });

  router.delete("/:id/like", async (req, res) => {
    const user = await requireLogin(req, res);
    if (!user) return;
    try {
      await postsService.removeLike(req.params.id, user.id);
      res.json({ result: "ok" });
    } catch (e) {
      const msg = (e as Error).message || "";
      if (/not liked/i.test(msg)) return res.status(404).json({ error: "like not found" });
      res.status(400).json({ error: msg || "could not remove like" });
    }
  });

  router.get("/:id/likers", async (req, res) => {
    const user = await requireLogin(req, res);
    if (!user) return;
    const postId = req.params.id;
    const offset = parseInt((req.query.offset as string) ?? "0", 10);
    const limit = parseInt((req.query.limit as string) ?? "100", 10);
    const order = (req.query.order as string) === "asc" ? "asc" : "desc";
    try {
      const users = await postsService.listLikers({ postId, offset, limit, order });
      res.json(users);
    } catch (e) {
      res.status(400).json({ error: (e as Error).message || "invalid request" });
    }
  });

  return router;
}
