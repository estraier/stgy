import { Router, Request, Response } from "express";
import { Client } from "pg";
import Redis from "ioredis";
import * as postsService from "../services/posts";
import { getCurrentUser } from "./authHelpers";
import { CreatePostInput, UpdatePostInput } from "../models/post";
import { User } from "../models/user";

export default function createPostsRouter(pgClient: Client, redis: Redis) {
  const router = Router();

  async function requireLogin(req: Request, res: Response): Promise<User | null> {
    const user = await getCurrentUser(req, redis, pgClient);
    if (!user) {
      res.status(401).json({ error: "login required" });
      return null;
    }
    return user as User;
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
    const reply_to =
      typeof req.query.reply_to === "string" && req.query.reply_to.trim() !== ""
      ? req.query.reply_to.trim()
      : undefined;
    const count = await postsService.countPosts(pgClient, {
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
    const posts = await postsService.listPosts(pgClient, {
      offset,
      limit,
      order,
      query,
      owned_by,
      tag,
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
    const posts = await postsService.listPostsDetail(pgClient, {
      offset,
      limit,
      order,
      query,
      owned_by,
      tag,
    });
    res.json(posts);
  });

  router.get("/by-followees/detail", async (req, res) => {
    const user = await requireLogin(req, res);
    if (!user) return;
    const offset = parseInt((req.query.offset as string) ?? "0", 10);
    const limit = parseInt((req.query.limit as string) ?? "100", 10);
    const order = (req.query.order as string) === "asc" ? "asc" : "desc";
    const include_self =
      typeof req.query.include_self === "string"
        ? req.query.include_self === "true" || req.query.include_self === "1"
        : false;
    const result = await postsService.listPostsByFolloweesDetail(pgClient, {
      user_id: user.id,
      offset,
      limit,
      order,
      include_self,
    });
    res.json(result);
  });

  router.get("/liked/detail", async (req, res) => {
    const user = await requireLogin(req, res);
    if (!user) return;
    const offset = parseInt((req.query.offset as string) ?? "0", 10);
    const limit = parseInt((req.query.limit as string) ?? "100", 10);
    const order = (req.query.order as string) === "asc" ? "asc" : "desc";
    const result = await postsService.listPostsLikedByUserDetail(pgClient, {
      user_id: user.id,
      offset,
      limit,
      order,
    });
    res.json(result);
  });

  router.get("/:id/detail", async (req, res) => {
    const user = await requireLogin(req, res);
    if (!user) return;
    const post = await postsService.getPostDetail(req.params.id, pgClient);
    if (!post) return res.status(404).json({ error: "not found" });
    res.json(post);
  });

  router.get("/:id", async (req, res) => {
    const user = await requireLogin(req, res);
    if (!user) return;
    const post = await postsService.getPost(req.params.id, pgClient);
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
      const input: CreatePostInput = {
        content: req.body.content,
        owned_by,
        reply_to: req.body.reply_to !== undefined ? req.body.reply_to : null,
      };
      if (input.reply_to === undefined) input.reply_to = null;
      const created = await postsService.createPost(input, pgClient);
      res.status(201).json(created);
    } catch (e) {
      res.status(400).json({ error: (e as Error).message || "invalid input" });
    }
  });

  router.put("/:id", async (req, res) => {
    const user = await requireLogin(req, res);
    if (!user) return;
    const post = await postsService.getPost(req.params.id, pgClient);
    if (!post) return res.status(404).json({ error: "not found" });
    if (!(user.is_admin || post.owned_by === user.id)) {
      return res.status(403).json({ error: "forbidden" });
    }
    try {
      const input: UpdatePostInput = {
        id: req.params.id,
        content: req.body.content,
        reply_to: req.body.reply_to !== undefined ? req.body.reply_to : null,
      };
      if (input.reply_to === undefined) input.reply_to = null;
      const updated = await postsService.updatePost(input, pgClient);
      if (!updated) return res.status(404).json({ error: "not found" });
      res.json(updated);
    } catch (e) {
      res.status(400).json({ error: (e as Error).message || "update error" });
    }
  });

  router.delete("/:id", async (req, res) => {
    const user = await requireLogin(req, res);
    if (!user) return;
    const post = await postsService.getPost(req.params.id, pgClient);
    if (!post) return res.status(404).json({ error: "not found" });
    if (!(user.is_admin || post.owned_by === user.id)) {
      return res.status(403).json({ error: "forbidden" });
    }
    const ok = await postsService.deletePost(req.params.id, pgClient);
    if (!ok) return res.status(404).json({ error: "not found" });
    res.json({ result: "ok" });
  });

  router.post("/:id/like", async (req, res) => {
    const user = await requireLogin(req, res);
    if (!user) return;
    const ok = await postsService.addLike(req.params.id, user.id, pgClient);
    if (!ok) return res.status(400).json({ error: "could not like" });
    res.json({ result: "ok" });
  });

  router.delete("/:id/like", async (req, res) => {
    const user = await requireLogin(req, res);
    if (!user) return;
    const ok = await postsService.removeLike(req.params.id, user.id, pgClient);
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
      const users = await postsService.listLikers(
        { post_id, offset, limit, order },
        pgClient
      );
      res.json(users);
    } catch (e) {
      res.status(400).json({ error: (e as Error).message || "invalid request" });
    }
  });

  return router;
}
