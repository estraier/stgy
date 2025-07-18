import { Router, Request, Response } from "express";
import { Client } from "pg";
import Redis from "ioredis";
import * as usersService from "../services/users";
import { getCurrentUser } from "./authHelpers";
import { CreateUserInput, UpdateUserInput, UpdatePasswordInput } from "../models/user";

export default function createUsersRouter(pgClient: Client, redis: Redis) {
  const router = Router();

  router.get("/count", async (req: Request, res: Response) => {
    const loginUser = await getCurrentUser(req, redis, pgClient);
    if (!loginUser) return res.status(401).json({ error: "login required" });
    const count = await usersService.countUsers(pgClient);
    res.json({ count });
  });

  router.get("/:id", async (req: Request, res: Response) => {
    const loginUser = await getCurrentUser(req, redis, pgClient);
    if (!loginUser) return res.status(401).json({ error: "login required" });
    const user = await usersService.getUser(req.params.id, pgClient);
    if (!user) return res.status(404).json({ error: "not found" });
    res.json(user);
  });

  router.get("/", async (req: Request, res: Response) => {
    const loginUser = await getCurrentUser(req, redis, pgClient);
    if (!loginUser) return res.status(401).json({ error: "login required" });
    const offset = parseInt((req.query.offset as string) ?? "0", 10);
    const limit = parseInt((req.query.limit as string) ?? "100", 10);
    const order =
      req.query.order === "asc" || req.query.order === "desc" ? req.query.order : "desc";
    const query =
      typeof req.query.q === "string" && req.query.q.trim() !== "" ? req.query.q.trim() : undefined;
    const users = await usersService.listUsers(pgClient, { offset, limit, order, query });
    res.json(users);
  });

  router.post("/", async (req: Request, res: Response) => {
    const loginUser = await getCurrentUser(req, redis, pgClient);
    if (!loginUser || !loginUser.is_admin) {
      return res.status(403).json({ error: "admin only" });
    }
    try {
      const input: CreateUserInput = {
        email: req.body.email,
        nickname: req.body.nickname,
        password: req.body.password,
        is_admin: req.body.is_admin ?? false,
        introduction: req.body.introduction,
        personality: req.body.personality ?? "",
        model: req.body.model ?? "",
      };
      const created = await usersService.createUser(input, pgClient);
      res.status(201).json(created);
    } catch (e: unknown) {
      res.status(400).json({ error: (e as Error).message || "invalid input" });
    }
  });

  router.put("/:id", async (req: Request, res: Response) => {
    const loginUser = await getCurrentUser(req, redis, pgClient);
    if (!loginUser) return res.status(401).json({ error: "login required" });
    if (!(loginUser.is_admin || loginUser.id === req.params.id)) {
      return res.status(403).json({ error: "forbidden" });
    }
    if (!loginUser.is_admin && req.body.is_admin !== undefined) {
      return res.status(403).json({ error: "forbidden to change is_admin" });
    }
    try {
      const input: UpdateUserInput = {
        id: req.params.id,
        email: req.body.email,
        nickname: req.body.nickname,
        is_admin: req.body.is_admin,
        introduction: req.body.introduction,
        personality: req.body.personality ?? "",
        model: req.body.model ?? "",
      };
      const updated = await usersService.updateUser(input, pgClient);
      if (!updated) return res.status(404).json({ error: "not found" });
      res.json(updated);
    } catch (e: unknown) {
      res.status(400).json({ error: (e as Error).message || "update error" });
    }
  });

  router.put("/:id/password", async (req: Request, res: Response) => {
    const loginUser = await getCurrentUser(req, redis, pgClient);
    if (!loginUser) return res.status(401).json({ error: "login required" });
    if (!(loginUser.is_admin || loginUser.id === req.params.id)) {
      return res.status(403).json({ error: "forbidden" });
    }
    const { password } = req.body;
    if (!password) {
      return res.status(400).json({ error: "password required" });
    }
    try {
      const input: UpdatePasswordInput = { id: req.params.id, password };
      const ok = await usersService.updateUserPassword(input, pgClient);
      if (!ok) return res.status(404).json({ error: "not found" });
      res.json({ result: "ok" });
    } catch (e: unknown) {
      res.status(400).json({ error: (e as Error).message || "update password error" });
    }
  });

  router.delete("/:id", async (req: Request, res: Response) => {
    const loginUser = await getCurrentUser(req, redis, pgClient);
    if (!loginUser) return res.status(401).json({ error: "login required" });
    if (!(loginUser.is_admin || loginUser.id === req.params.id)) {
      return res.status(403).json({ error: "forbidden" });
    }
    const ok = await usersService.deleteUser(req.params.id, pgClient);
    if (!ok) return res.status(404).json({ error: "not found" });
    res.json({ result: "ok" });
  });

  router.post("/:id/follow", async (req: Request, res: Response) => {
    const loginUser = await getCurrentUser(req, redis, pgClient);
    if (!loginUser) return res.status(401).json({ error: "login required" });
    const followee_id = req.params.id;
    const follower_id = loginUser.id;
    if (follower_id === followee_id) {
      return res.status(400).json({ error: "cannot follow yourself" });
    }
    const ok = await usersService.addFollower({ follower_id, followee_id }, pgClient);
    if (!ok) return res.status(400).json({ error: "already followed" });
    res.json({ result: "ok" });
  });

  router.delete("/:id/follow", async (req: Request, res: Response) => {
    const loginUser = await getCurrentUser(req, redis, pgClient);
    if (!loginUser) return res.status(401).json({ error: "login required" });
    const followee_id = req.params.id;
    const follower_id = loginUser.id;
    const ok = await usersService.removeFollower({ follower_id, followee_id }, pgClient);
    if (!ok) return res.status(404).json({ error: "not followed" });
    res.json({ result: "ok" });
  });

  router.get("/:id/followees", async (req: Request, res: Response) => {
    const loginUser = await getCurrentUser(req, redis, pgClient);
    if (!loginUser) return res.status(401).json({ error: "login required" });
    const follower_id = req.params.id;
    const offset = parseInt((req.query.offset as string) ?? "0", 10);
    const limit = parseInt((req.query.limit as string) ?? "100", 10);
    const result = await usersService.listFollowees(pgClient, { follower_id, offset, limit });
    res.json(result);
  });

  router.get("/:id/followers", async (req: Request, res: Response) => {
    const loginUser = await getCurrentUser(req, redis, pgClient);
    if (!loginUser) return res.status(401).json({ error: "login required" });
    const followee_id = req.params.id;
    const offset = parseInt((req.query.offset as string) ?? "0", 10);
    const limit = parseInt((req.query.limit as string) ?? "100", 10);
    const result = await usersService.listFollowers(pgClient, { followee_id, offset, limit });
    res.json(result);
  });

  return router;
}
