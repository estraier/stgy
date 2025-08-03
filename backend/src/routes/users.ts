import { Router, Request, Response } from "express";
import { Client } from "pg";
import Redis from "ioredis";
import { UsersService } from "../services/users";
import { AuthService } from "../services/auth";
import { AuthHelpers } from "./authHelpers";
import { SendMailService } from "../services/sendMail";
import {
  User,
  UserDetail,
  CreateUserInput,
  UpdateUserInput,
  UpdatePasswordInput,
} from "../models/user";
import { maskEmailByHash } from "../utils/format";

export default function createUsersRouter(pgClient: Client, redis: Redis) {
  const router = Router();

  const usersService = new UsersService(pgClient, redis);
  const authService = new AuthService(pgClient, redis);
  const authHelpers = new AuthHelpers(authService, usersService);
  const sendMailService = new SendMailService(redis);

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
    const focusUserId =
      typeof req.query.focusUserId === "string" && req.query.focusUserId.trim() !== ""
        ? req.query.focusUserId.trim()
        : undefined;
    let users = await usersService.listUsersDetail(
      { offset, limit, order, query, nickname },
      focusUserId,
    );
    users = maskUserListSensitiveInfo(users, loginUser.isAdmin, loginUser.id);
    res.json(users);
  });

  router.get("/:id", async (req: Request, res: Response) => {
    const loginUser = await authHelpers.getCurrentUser(req);
    if (!loginUser) return res.status(401).json({ error: "login required" });
    let user = await usersService.getUser(req.params.id);
    if (!user) return res.status(404).json({ error: "not found" });
    user = maskUserSensitiveInfo(user, loginUser.isAdmin, loginUser.id);
    res.json(user);
  });

  router.get("/:id/detail", async (req: Request, res: Response) => {
    const loginUser = await authHelpers.getCurrentUser(req);
    if (!loginUser) return res.status(401).json({ error: "login required" });
    const focusUserId =
      typeof req.query.focusUserId === "string" && req.query.focusUserId.trim() !== ""
        ? req.query.focusUserId.trim()
        : undefined;
    let user = await usersService.getUserDetail(req.params.id, focusUserId);
    if (!user) return res.status(404).json({ error: "not found" });
    user = maskUserSensitiveInfo(user, loginUser.isAdmin, loginUser.id);
    res.json(user);
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
    const focusUserId =
      typeof req.query.focusUserId === "string" && req.query.focusUserId.trim() !== ""
        ? req.query.focusUserId.trim()
        : undefined;
    let users = await usersService.listUsers(
      { offset, limit, order, query, nickname },
      focusUserId,
    );
    users = maskUserListSensitiveInfo(users, loginUser.isAdmin, loginUser.id);
    res.json(users);
  });

  router.post("/", async (req: Request, res: Response) => {
    const loginUser = await authHelpers.getCurrentUser(req);
    if (!loginUser || !loginUser.isAdmin) {
      return res.status(403).json({ error: "admin only" });
    }
    try {
      const input: CreateUserInput = {
        email: req.body.email,
        nickname: req.body.nickname,
        password: req.body.password,
        isAdmin: req.body.isAdmin ?? false,
        introduction: req.body.introduction,
        aiModel: req.body.aiModel ?? null,
        aiPersonality: req.body.aiPersonality ?? null,
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
    if (!(loginUser.isAdmin || loginUser.id === req.params.id)) {
      return res.status(403).json({ error: "forbidden" });
    }
    if (!loginUser.isAdmin && req.body.isAdmin !== undefined) {
      return res.status(403).json({ error: "forbidden to change isAdmin" });
    }
    if (!loginUser.isAdmin && req.body.aiModel !== undefined) {
      return res.status(403).json({ error: "forbidden to change aiModel" });
    }
    if (!loginUser.isAdmin && req.body.aiPersonality !== undefined) {
      return res.status(403).json({ error: "forbidden to change aiPersonality" });
    }
    try {
      const input: UpdateUserInput = {
        id: req.params.id,
        email: req.body.email,
        nickname: req.body.nickname,
        isAdmin: req.body.isAdmin,
        introduction: req.body.introduction,
        aiModel: req.body.aiModel,
        aiPersonality: req.body.aiPersonality,
      };
      const updated = await usersService.updateUser(input);
      if (!updated) return res.status(404).json({ error: "not found" });
      res.json(updated);
    } catch (e: unknown) {
      res.status(400).json({ error: (e as Error).message || "update error" });
    }
  });

  router.post("/:id/email/start", async (req: Request, res: Response) => {
    const loginUser = await authHelpers.getCurrentUser(req);
    if (!loginUser) return res.status(401).json({ error: "login required" });
    if (!(loginUser.isAdmin || loginUser.id === req.params.id)) {
      return res.status(403).json({ error: "forbidden" });
    }
    const { email } = req.body;
    if (!email) {
      return res.status(400).json({ error: "email required" });
    }
    const check = await sendMailService.canSendMail(email);
    if (!check.ok) {
      return res.status(400).json({ error: check.reason || "too many requests" });
    }
    try {
      const { updateEmailId } = await usersService.startUpdateEmail(req.params.id, email);
      res.status(201).json({ updateEmailId });
    } catch (e: unknown) {
      res.status(400).json({ error: (e as Error).message || "update email failed" });
    }
  });

  router.post("/:id/email/verify", async (req: Request, res: Response) => {
    const loginUser = await authHelpers.getCurrentUser(req);
    if (!loginUser) return res.status(401).json({ error: "login required" });
    if (!(loginUser.isAdmin || loginUser.id === req.params.id)) {
      return res.status(403).json({ error: "forbidden" });
    }
    const { updateEmailId, verificationCode } = req.body;
    if (!updateEmailId || !verificationCode) {
      return res.status(400).json({ error: "updateEmailId and verificationCode are needed" });
    }
    try {
      const ok = await usersService.verifyUpdateEmail(updateEmailId, verificationCode);
      if (!ok) return res.status(404).json({ error: "not found" });
      res.json({ result: "ok" });
    } catch (e: unknown) {
      res.status(400).json({ error: (e as Error).message || "verification failed" });
    }
  });

  router.put("/:id/password", async (req: Request, res: Response) => {
    const loginUser = await authHelpers.getCurrentUser(req);
    if (!loginUser) return res.status(401).json({ error: "login required" });
    if (!(loginUser.isAdmin || loginUser.id === req.params.id)) {
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
    if (!(loginUser.isAdmin || loginUser.id === req.params.id)) {
      return res.status(403).json({ error: "forbidden" });
    }
    const ok = await usersService.deleteUser(req.params.id);
    if (!ok) return res.status(404).json({ error: "not found" });
    res.json({ result: "ok" });
  });

  router.post("/:id/follow", async (req: Request, res: Response) => {
    const loginUser = await authHelpers.getCurrentUser(req);
    if (!loginUser) return res.status(401).json({ error: "login required" });
    const followeeId = req.params.id;
    const followerId = loginUser.id;
    if (followerId === followeeId) {
      return res.status(400).json({ error: "cannot follow yourself" });
    }
    const ok = await usersService.addFollower({ followerId, followeeId });
    if (!ok) return res.status(400).json({ error: "already followed" });
    res.json({ result: "ok" });
  });

  router.delete("/:id/follow", async (req: Request, res: Response) => {
    const loginUser = await authHelpers.getCurrentUser(req);
    if (!loginUser) return res.status(401).json({ error: "login required" });
    const followeeId = req.params.id;
    const followerId = loginUser.id;
    const ok = await usersService.removeFollower({ followerId, followeeId });
    if (!ok) return res.status(404).json({ error: "not followed" });
    res.json({ result: "ok" });
  });

  router.get("/:id/followees/detail", async (req: Request, res: Response) => {
    const loginUser = await authHelpers.getCurrentUser(req);
    if (!loginUser) return res.status(401).json({ error: "login required" });
    const followerId = req.params.id;
    const offset = parseInt((req.query.offset as string) ?? "0", 10);
    const limit = parseInt((req.query.limit as string) ?? "100", 10);
    const order = (req.query.order as string) === "asc" ? "asc" : "desc";
    const focusUserId =
      typeof req.query.focusUserId === "string" && req.query.focusUserId.trim() !== ""
        ? req.query.focusUserId.trim()
        : undefined;
    let users = await usersService.listFolloweesDetail(
      { followerId, offset, limit, order },
      focusUserId,
    );
    users = maskUserListSensitiveInfo(users, loginUser.isAdmin, loginUser.id);
    res.json(users);
  });

  router.get("/:id/followers/detail", async (req: Request, res: Response) => {
    const loginUser = await authHelpers.getCurrentUser(req);
    if (!loginUser) return res.status(401).json({ error: "login required" });
    const followeeId = req.params.id;
    const offset = parseInt((req.query.offset as string) ?? "0", 10);
    const limit = parseInt((req.query.limit as string) ?? "100", 10);
    const order = (req.query.order as string) === "asc" ? "asc" : "desc";
    const focusUserId =
      typeof req.query.focusUserId === "string" && req.query.focusUserId.trim() !== ""
        ? req.query.focusUserId.trim()
        : undefined;
    let users = await usersService.listFollowersDetail(
      { followeeId, offset, limit, order },
      focusUserId,
    );
    users = maskUserListSensitiveInfo(users, loginUser.isAdmin, loginUser.id);
    res.json(users);
  });

  return router;
}

function maskUserSensitiveInfo<T extends User | UserDetail>(
  user: T,
  isAdmin: boolean,
  loginUserId: string,
): T {
  if (!user) return user;
  if (isAdmin || user.id === loginUserId) return user;
  return {
    ...user,
    email: maskEmailByHash(user.email),
  } as T;
}

function maskUserListSensitiveInfo<T extends User | UserDetail>(
  users: T[],
  isAdmin: boolean,
  loginUserId: string,
): T[] {
  return users.map((u) => maskUserSensitiveInfo(u, isAdmin, loginUserId));
}
