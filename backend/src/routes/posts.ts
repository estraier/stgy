import { Router, Request, Response } from "express";
import { Client } from "pg";
import Redis from "ioredis";
import { strToBool } from "./utils";
import { PostsService } from "../services/posts";
import { AuthService } from "../services/auth";
import { UsersService } from "../services/users";
import { AuthHelpers } from "./authHelpers";
import { CreatePostInput, UpdatePostInput } from "../models/post";
import { User } from "../models/user";

export default function createPostsRouter(pgClient: Client, redis: Redis) {
  const router = Router();

  const postsService = new PostsService(pgClient);
  const usersService = new UsersService(pgClient);
  const authService = new AuthService(pgClient, redis);
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
    if ("reply_to" in req.query) {
      if (typeof req.query.reply_to === "string") {
        const reply_to = req.query.reply_to.trim();
        if (reply_to.length == 0) return null;
        return reply_to;
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
    const owned_by =
      typeof req.query.owned_by === "string" && req.query.owned_by.trim() !== ""
        ? req.query.owned_by.trim()
        : undefined;
    const tag =
      typeof req.query.tag === "string" && req.query.tag.trim() !== ""
        ? req.query.tag.trim()
        : undefined;
    const reply_to = getReplyToParam(req);

    const count = await postsService.countPosts({
      query,
      owned_by,
      tag,
      reply_to,
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
    const owned_by =
      typeof req.query.owned_by === "string" && req.query.owned_by.trim() !== ""
        ? req.query.owned_by.trim()
        : undefined;
    const tag =
      typeof req.query.tag === "string" && req.query.tag.trim() !== ""
        ? req.query.tag.trim()
        : undefined;
    const reply_to = getReplyToParam(req);

    const posts = await postsService.listPosts({
      offset,
      limit,
      order,
      query,
      owned_by,
      tag,
      reply_to,
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
    const owned_by =
      typeof req.query.owned_by === "string" && req.query.owned_by.trim() !== ""
        ? req.query.owned_by.trim()
        : undefined;
    const tag =
      typeof req.query.tag === "string" && req.query.tag.trim() !== ""
        ? req.query.tag.trim()
        : undefined;
    const reply_to = getReplyToParam(req);
    const focus_user_id =
      typeof req.query.focus_user_id === "string" && req.query.focus_user_id.trim() !== ""
        ? req.query.focus_user_id.trim()
        : undefined;
    const posts = await postsService.listPostsDetail(
      {
        offset,
        limit,
        order,
        query,
        owned_by,
        tag,
        reply_to,
      },
      focus_user_id,
    );
    res.json(posts);
  });

  router.get("/by-followees/detail", async (req, res) => {
    const loginUser = await requireLogin(req, res);
    if (!loginUser) return;
    const user_id =
      typeof req.query.user_id === "string" && req.query.user_id.trim() !== ""
        ? req.query.user_id.trim()
        : null;
    if (!user_id) {
      return res.status(400).json({ error: "user_id is required" });
    }
    const offset = parseInt((req.query.offset as string) ?? "0", 10);
    const limit = parseInt((req.query.limit as string) ?? "100", 10);
    const order = (req.query.order as string) === "asc" ? "asc" : "desc";
    const include_self = strToBool(req.query.include_self as string, false);
    const include_replies = strToBool(req.query.include_replies as string, true);
    const focus_user_id =
      typeof req.query.focus_user_id === "string" && req.query.focus_user_id.trim() !== ""
        ? req.query.focus_user_id.trim()
        : undefined;
    const result = await postsService.listPostsByFolloweesDetail(
      {
        user_id,
        offset,
        limit,
        order,
        include_self,
        include_replies,
      },
      focus_user_id,
    );
    res.json(result);
  });

  router.get("/liked/detail", async (req, res) => {
    const loginUser = await requireLogin(req, res);
    if (!loginUser) return;
    const user_id =
      typeof req.query.user_id === "string" && req.query.user_id.trim() !== ""
        ? req.query.user_id.trim()
        : null;
    if (!user_id) {
      return res.status(400).json({ error: "user_id is required" });
    }
    const offset = parseInt((req.query.offset as string) ?? "0", 10);
    const limit = parseInt((req.query.limit as string) ?? "100", 10);
    const order = (req.query.order as string) === "asc" ? "asc" : "desc";
    const focus_user_id =
      typeof req.query.focus_user_id === "string" && req.query.focus_user_id.trim() !== ""
        ? req.query.focus_user_id.trim()
        : undefined;
    const result = await postsService.listPostsLikedByUserDetail(
      {
        user_id,
        offset,
        limit,
        order,
      },
      focus_user_id,
    );
    res.json(result);
  });

  router.get("/:id/detail", async (req, res) => {
    const user = await requireLogin(req, res);
    if (!user) return;
    const focus_user_id =
      typeof req.query.focus_user_id === "string" && req.query.focus_user_id.trim() !== ""
        ? req.query.focus_user_id.trim()
        : undefined;
    const post = await postsService.getPostDetail(req.params.id, focus_user_id);
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
    try {
      let owned_by = user.id;
      if (user.is_admin && req.body.owned_by && typeof req.body.owned_by === "string") {
        owned_by = req.body.owned_by;
      }
      if (!Array.isArray(req.body.tags)) {
        return res.status(400).json({ error: "tags is required and must be array" });
      }
      const input: CreatePostInput = {
        content: req.body.content,
        owned_by,
        reply_to: req.body.reply_to ?? null,
        tags: req.body.tags,
      };
      const created = await postsService.createPost(input);
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
    if (!(user.is_admin || post.owned_by === user.id)) {
      return res.status(403).json({ error: "forbidden" });
    }
    try {
      let tags;
      if ("tags" in req.body) {
        if (!Array.isArray(req.body.tags)) {
          return res.status(400).json({ error: "tags must be array if specified" });
        }
        tags = req.body.tags;
      }
      const input: UpdatePostInput = {
        id: req.params.id,
        content: req.body.content,
        reply_to: req.body.reply_to,
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
    if (!(user.is_admin || post.owned_by === user.id)) {
      return res.status(403).json({ error: "forbidden" });
    }
    const ok = await postsService.deletePost(req.params.id);
    if (!ok) return res.status(404).json({ error: "not found" });
    res.json({ result: "ok" });
  });

  router.post("/:id/like", async (req, res) => {
    const user = await requireLogin(req, res);
    if (!user) return;
    const ok = await postsService.addLike(req.params.id, user.id);
    if (!ok) return res.status(400).json({ error: "could not like" });
    res.json({ result: "ok" });
  });

  router.delete("/:id/like", async (req, res) => {
    const user = await requireLogin(req, res);
    if (!user) return;
    const ok = await postsService.removeLike(req.params.id, user.id);
    if (!ok) return res.status(404).json({ error: "like not found" });
    res.json({ result: "ok" });
  });

  router.get("/:id/likers", async (req, res) => {
    const user = await requireLogin(req, res);
    if (!user) return;
    const post_id = req.params.id;
    const offset = parseInt((req.query.offset as string) ?? "0", 10);
    const limit = parseInt((req.query.limit as string) ?? "100", 10);
    const order = (req.query.order as string) === "asc" ? "asc" : "desc";
    try {
      const users = await postsService.listLikers({ post_id, offset, limit, order });
      res.json(users);
    } catch (e) {
      res.status(400).json({ error: (e as Error).message || "invalid request" });
    }
  });

  return router;
}
