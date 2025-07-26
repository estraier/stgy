import { Router, Request, Response } from "express";
import { Client } from "pg";
import Redis from "ioredis";
import { UsersService } from "../services/users";
import { AuthService } from "../services/auth";
import { AuthHelpers } from "./authHelpers";
import { CreateUserInput, UpdateUserInput, UpdatePasswordInput } from "../models/user";

export default function createUsersRouter(pgClient: Client, redis: Redis) {
  const router = Router();

  const usersService = new UsersService(pgClient);
  const authService = new AuthService(pgClient, redis);
  const authHelpers = new AuthHelpers(authService, usersService);

  router.get("/count", async (req: Request, res: Response) => {
    const loginUser = await authHelpers.getCurrentUser(req);
    if (!loginUser) return res.status(401).json({ error: "login required" });
    const nickname =
      typeof req.query.nickname === "string" && req.query.nickname.trim() !== ""
        ? req.query.nickname.trim()
        : undefined;
    const query =
      typeof req.query.query === "string" && req.query.query.trim() !== ""
        ? req.query.query.trim()
        : undefined;
    const count = await usersService.countUsers({ nickname, query });
    res.json({ count });
  });

  router.get("/detail", async (req: Request, res: Response) => {
    const loginUser = await authHelpers.getCurrentUser(req);
    if (!loginUser) return res.status(401).json({ error: "login required" });
    const offset = parseInt((req.query.offset as string) ?? "0", 10);
    const limit = parseInt((req.query.limit as string) ?? "100", 10);
    const order =
      req.query.order === "asc" || req.query.order === "desc" || req.query.order === "social"
        ? req.query.order
        : "desc";
    const query =
      typeof req.query.query === "string" && req.query.query.trim() !== ""
        ? req.query.query.trim()
        : undefined;
    const nickname =
      typeof req.query.nickname === "string" && req.query.nickname.trim() !== ""
        ? req.query.nickname.trim()
        : undefined;
    const focus_user_id =
      typeof req.query.focus_user_id === "string" && req.query.focus_user_id.trim() !== ""
        ? req.query.focus_user_id.trim()
        : undefined;
    const details = await usersService.listUsersDetail(
      { offset, limit, order, query, nickname },
      focus_user_id,
    );
    res.json(details);
  });

  router.get("/:id", async (req: Request, res: Response) => {
    const loginUser = await authHelpers.getCurrentUser(req);
    if (!loginUser) return res.status(401).json({ error: "login required" });
    const user = await usersService.getUser(req.params.id);
    if (!user) return res.status(404).json({ error: "not found" });
    res.json(user);
  });

  router.get("/:id/detail", async (req: Request, res: Response) => {
    const loginUser = await authHelpers.getCurrentUser(req);
    if (!loginUser) return res.status(401).json({ error: "login required" });
    const focus_user_id =
      typeof req.query.focus_user_id === "string" && req.query.focus_user_id.trim() !== ""
        ? req.query.focus_user_id.trim()
        : undefined;
    const detail = await usersService.getUserDetail(req.params.id, focus_user_id);
    if (!detail) return res.status(404).json({ error: "not found" });
    res.json(detail);
  });

  router.get("/", async (req: Request, res: Response) => {
    const loginUser = await authHelpers.getCurrentUser(req);
    if (!loginUser) return res.status(401).json({ error: "login required" });
    const offset = parseInt((req.query.offset as string) ?? "0", 10);
    const limit = parseInt((req.query.limit as string) ?? "100", 10);
    const order =
      req.query.order === "asc" || req.query.order === "desc" || req.query.order === "social"
        ? req.query.order
        : "desc";
    const query =
      typeof req.query.query === "string" && req.query.query.trim() !== ""
        ? req.query.query.trim()
        : undefined;
    const nickname =
      typeof req.query.nickname === "string" && req.query.nickname.trim() !== ""
        ? req.query.nickname.trim()
        : undefined;
    const focus_user_id =
      typeof req.query.focus_user_id === "string" && req.query.focus_user_id.trim() !== ""
        ? req.query.focus_user_id.trim()
        : undefined;
    const users = await usersService.listUsers(
      { offset, limit, order, query, nickname },
      focus_user_id,
    );
    res.json(users);
  });

  router.post("/", async (req: Request, res: Response) => {
    const loginUser = await authHelpers.getCurrentUser(req);
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
      const created = await usersService.createUser(input);
      res.status(201).json(created);
    } catch (e: unknown) {
      res.status(400).json({ error: (e as Error).message || "invalid input" });
    }
  });

  router.put("/:id", async (req: Request, res: Response) => {
    const loginUser = await authHelpers.getCurrentUser(req);
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
      const updated = await usersService.updateUser(input);
      if (!updated) return res.status(404).json({ error: "not found" });
      res.json(updated);
    } catch (e: unknown) {
      res.status(400).json({ error: (e as Error).message || "update error" });
    }
  });

  router.put("/:id/password", async (req: Request, res: Response) => {
    const loginUser = await authHelpers.getCurrentUser(req);
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
      const ok = await usersService.updateUserPassword(input);
      if (!ok) return res.status(404).json({ error: "not found" });
      res.json({ result: "ok" });
    } catch (e: unknown) {
      res.status(400).json({ error: (e as Error).message || "update password error" });
    }
  });

  router.delete("/:id", async (req: Request, res: Response) => {
    const loginUser = await authHelpers.getCurrentUser(req);
    if (!loginUser) return res.status(401).json({ error: "login required" });
    if (!(loginUser.is_admin || loginUser.id === req.params.id)) {
      return res.status(403).json({ error: "forbidden" });
    }
    const ok = await usersService.deleteUser(req.params.id);
    if (!ok) return res.status(404).json({ error: "not found" });
    res.json({ result: "ok" });
  });

  router.post("/:id/follow", async (req: Request, res: Response) => {
    const loginUser = await authHelpers.getCurrentUser(req);
    if (!loginUser) return res.status(401).json({ error: "login required" });
    const followee_id = req.params.id;
    const follower_id = loginUser.id;
    if (follower_id === followee_id) {
      return res.status(400).json({ error: "cannot follow yourself" });
    }
    const ok = await usersService.addFollower({ follower_id, followee_id });
    if (!ok) return res.status(400).json({ error: "already followed" });
    res.json({ result: "ok" });
  });

  router.delete("/:id/follow", async (req: Request, res: Response) => {
    const loginUser = await authHelpers.getCurrentUser(req);
    if (!loginUser) return res.status(401).json({ error: "login required" });
    const followee_id = req.params.id;
    const follower_id = loginUser.id;
    const ok = await usersService.removeFollower({ follower_id, followee_id });
    if (!ok) return res.status(404).json({ error: "not followed" });
    res.json({ result: "ok" });
  });

  router.get("/:id/followees/detail", async (req: Request, res: Response) => {
    const loginUser = await authHelpers.getCurrentUser(req);
    if (!loginUser) return res.status(401).json({ error: "login required" });
    const follower_id = req.params.id;
    const offset = parseInt((req.query.offset as string) ?? "0", 10);
    const limit = parseInt((req.query.limit as string) ?? "100", 10);
    const focus_user_id =
      typeof req.query.focus_user_id === "string" && req.query.focus_user_id.trim() !== ""
        ? req.query.focus_user_id.trim()
        : undefined;
    const result = await usersService.listFolloweesDetail(
      { follower_id, offset, limit },
      focus_user_id,
    );
    res.json(result);
  });

  router.get("/:id/followers/detail", async (req: Request, res: Response) => {
    const loginUser = await authHelpers.getCurrentUser(req);
    if (!loginUser) return res.status(401).json({ error: "login required" });
    const followee_id = req.params.id;
    const offset = parseInt((req.query.offset as string) ?? "0", 10);
    const limit = parseInt((req.query.limit as string) ?? "100", 10);
    const focus_user_id =
      typeof req.query.focus_user_id === "string" && req.query.focus_user_id.trim() !== ""
        ? req.query.focus_user_id.trim()
        : undefined;
    const result = await usersService.listFollowersDetail(
      { followee_id, offset, limit },
      focus_user_id,
    );
    res.json(result);
  });

  return router;
}
