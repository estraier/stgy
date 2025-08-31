import { Config } from "../config";
import { Router, Request, Response } from "express";
import { Client } from "pg";
import Redis from "ioredis";
import type { StorageService } from "../services/storage";
import { UsersService } from "../services/users";
import { MediaService } from "../services/media";
import { AuthService } from "../services/auth";
import { AuthHelpers } from "./authHelpers";
import { EventLogService } from "../services/eventLog";
import { SendMailService } from "../services/sendMail";
import { CreateUserInput, UpdateUserInput, UpdatePasswordInput } from "../models/user";
import {
  validateEmail,
  normalizeEmail,
  normalizeText,
  normalizeOneLiner,
  normalizeMultiLines,
  parseBoolean,
  maskEmailByHash,
} from "../utils/format";

export default function createUsersRouter(
  pgClient: Client,
  redis: Redis,
  storageService: StorageService,
  eventLogService: EventLogService,
) {
  const router = Router();
  const usersService = new UsersService(pgClient, redis, eventLogService);
  const mediaService = new MediaService(storageService, redis);
  const authService = new AuthService(pgClient, redis);
  const authHelpers = new AuthHelpers(authService, usersService);
  const sendMailService = new SendMailService(redis);

  router.get("/count", async (req: Request, res: Response) => {
    const loginUser = await authHelpers.getCurrentUser(req);
    if (!loginUser) return res.status(401).json({ error: "login required" });
    const query =
      typeof req.query.query === "string" && req.query.query.trim() !== ""
        ? req.query.query.trim()
        : undefined;
    const nickname =
      typeof req.query.nickname === "string" && req.query.nickname.trim() !== ""
        ? req.query.nickname.trim()
        : undefined;
    const nicknamePrefix =
      typeof req.query.nicknamePrefix === "string" && req.query.nicknamePrefix.trim() !== ""
        ? req.query.nicknamePrefix.trim()
        : undefined;
    const count = await usersService.countUsers({ query, nickname, nicknamePrefix });
    res.json({ count });
  });

  router.get("/friends/by-nickname-prefix", async (req: Request, res: Response) => {
    const loginUser = await authHelpers.getCurrentUser(req);
    if (!loginUser) return res.status(401).json({ error: "login required" });
    const focusUserId =
      typeof req.query.focusUserId === "string" && req.query.focusUserId.trim() !== ""
        ? req.query.focusUserId.trim()
        : loginUser.id;
    const offset = parseInt((req.query.offset as string) ?? "0", 10);
    const limit = parseInt((req.query.limit as string) ?? "100", 10);
    const nicknamePrefix =
      typeof req.query.nicknamePrefix === "string" ? req.query.nicknamePrefix.trim() : "";
    const omitSelf = parseBoolean(req.query.omitSelf as string, false);
    const omitOthers = parseBoolean(req.query.omitOthers as string, false);
    try {
      let users = await usersService.listFriendsByNicknamePrefix({
        focusUserId,
        nicknamePrefix,
        offset,
        limit,
        omitSelf,
        omitOthers,
      });
      users = maskUserListSensitiveInfo(users, loginUser.isAdmin, loginUser.id);
      res.json(users);
    } catch (e: unknown) {
      res.status(400).json({ error: (e as Error).message || "list friends failed" });
    }
  });

  router.get("/:id/lite", async (req: Request, res: Response) => {
    const loginUser = await authHelpers.getCurrentUser(req);
    if (!loginUser) return res.status(401).json({ error: "login required" });
    let user = await usersService.getUserLite(req.params.id);
    if (!user) return res.status(404).json({ error: "not found" });
    user = maskUserSensitiveInfo(user, loginUser.isAdmin, loginUser.id);
    res.json(user);
  });

  router.get("/:id", async (req: Request, res: Response) => {
    const loginUser = await authHelpers.getCurrentUser(req);
    if (!loginUser) return res.status(401).json({ error: "login required" });
    const focusUserId =
      typeof req.query.focusUserId === "string" && req.query.focusUserId.trim() !== ""
        ? req.query.focusUserId.trim()
        : undefined;
    let user = await usersService.getUser(req.params.id, focusUserId);
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
    const nicknamePrefix =
      typeof req.query.nicknamePrefix === "string" && req.query.nicknamePrefix.trim() !== ""
        ? req.query.nicknamePrefix.trim()
        : undefined;
    const focusUserId =
      typeof req.query.focusUserId === "string" && req.query.focusUserId.trim() !== ""
        ? req.query.focusUserId.trim()
        : undefined;
    let users = await usersService.listUsers(
      { offset, limit, order, query, nickname, nicknamePrefix },
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
        id: typeof req.body.id === "string" ? (normalizeOneLiner(req.body.id) ?? "") : undefined,
        email: normalizeEmail(normalizeOneLiner(req.body.email) ?? ""),
        nickname: normalizeOneLiner(req.body.nickname) ?? "",
        password: normalizeText(req.body.password) ?? "",
        isAdmin: !!req.body.isAdmin,
        introduction: normalizeMultiLines(req.body.introduction) ?? "",
        avatar: normalizeOneLiner(req.body.avatar) ?? null,
        aiModel: normalizeOneLiner(req.body.aiModel) ?? null,
        aiPersonality: normalizeMultiLines(req.body.aiPersonality) ?? null,
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
    if (!loginUser.isAdmin && !loginUser.aiModel && req.body.aiPersonality !== undefined) {
      return res.status(403).json({ error: "forbidden to change aiPersonality" });
    }
    let introduction;
    if (req.body.introduction) {
      introduction = normalizeMultiLines(req.body.introduction) ?? "";
      if (!loginUser.isAdmin && introduction.length > Config.INTRODUCTION_LENGTH_LIMIT) {
        return res.status(400).json({ error: "introduction is too long" });
      }
    }
    let aiPersonality;
    if (req.body.aiPersonality) {
      aiPersonality = normalizeMultiLines(req.body.aiPersonality) ?? "";
      if (!loginUser.isAdmin && aiPersonality.length > Config.AI_PERSONALITY_LENGTH_LIMIT) {
        return res.status(400).json({ error: "aiPersonality is too long" });
      }
    }
    try {
      const input: UpdateUserInput = {
        id: req.params.id,
        email: req.body.email ? normalizeEmail(normalizeOneLiner(req.body.email) ?? "") : undefined,
        nickname: normalizeOneLiner(req.body.nickname) ?? undefined,
        isAdmin: req.body.isAdmin === undefined ? undefined : req.body.isAdmin,
        introduction: introduction,
        avatar: normalizeOneLiner(req.body.avatar),
        aiModel: normalizeOneLiner(req.body.aiModel),
        aiPersonality: aiPersonality,
      };
      const updated = await usersService.updateUser(input);
      if (!updated) return res.status(404).json({ error: "not found" });
      if (loginUser.id === req.params.id) {
        const sessionId = authHelpers.getSessionId(req);
        if (sessionId) {
          await authService.refreshSessionInfo(sessionId);
        }
      }
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
    if (!validateEmail(email)) {
      throw res.status(400).json({ error: "invalid e-mail address" });
    }
    const normEmail = normalizeEmail(email);
    const check = await sendMailService.canSendMail(normEmail);
    if (!check.ok) {
      return res.status(400).json({ error: check.reason || "too many requests" });
    }
    try {
      const { updateEmailId } = await usersService.startUpdateEmail(req.params.id, normEmail);
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
      await usersService.verifyUpdateEmail(req.params.id, updateEmailId, verificationCode);
      res.json({ result: "ok" });
    } catch (e: unknown) {
      res.status(400).json({ error: (e as Error).message || "verification failed" });
    }
  });

  router.post("/password/reset/start", async (req: Request, res: Response) => {
    const { email } = req.body;
    if (!email) {
      return res.status(400).json({ error: "email required" });
    }
    if (!validateEmail(email)) {
      throw res.status(400).json({ error: "invalid e-mail address" });
    }
    const normEmail = normalizeEmail(email);
    const check = await sendMailService.canSendMail(normEmail);
    if (!check.ok) {
      return res.status(400).json({ error: check.reason || "too many requests" });
    }
    try {
      const result = await usersService.startResetPassword(normEmail);
      res.status(201).json(result);
    } catch {
      const result = await usersService.fakeResetPassword();
      res.status(201).json(result);
    }
  });

  router.post("/password/reset/verify", async (req: Request, res: Response) => {
    const { email, resetPasswordId, webCode, mailCode, newPassword } = req.body;
    if (!email || !resetPasswordId || !webCode || !mailCode || !newPassword) {
      return res
        .status(400)
        .json({ error: "email, resetPasswordId, webCode, mailCode, newPassword are required" });
    }
    try {
      await usersService.verifyResetPassword(
        email,
        resetPasswordId,
        webCode,
        mailCode,
        newPassword,
      );
      res.json({ result: "ok" });
    } catch (e: unknown) {
      res.status(400).json({ error: (e as Error).message || "reset verify failed" });
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
      await usersService.updateUserPassword(input);
      res.json({ result: "ok" });
    } catch (e: unknown) {
      const msg = (e as Error).message || "";
      if (/user not found/i.test(msg)) return res.status(404).json({ error: "not found" });
      res.status(400).json({ error: msg || "update password error" });
    }
  });

  router.delete("/:id", async (req: Request, res: Response) => {
    const loginUser = await authHelpers.getCurrentUser(req);
    if (!loginUser) return res.status(401).json({ error: "login required" });
    if (!(loginUser.isAdmin || loginUser.id === req.params.id)) {
      return res.status(403).json({ error: "forbidden" });
    }
    try {
      await usersService.deleteUser(req.params.id);
      await mediaService.deleteAllImagesAndProfiles(req.params.id);
      res.json({ result: "ok" });
    } catch (e: unknown) {
      const msg = (e as Error).message || "";
      if (/user not found/i.test(msg)) return res.status(404).json({ error: "not found" });
      res.status(400).json({ error: msg || "delete error" });
    }
  });

  router.post("/:id/follow", async (req: Request, res: Response) => {
    const loginUser = await authHelpers.getCurrentUser(req);
    if (!loginUser) return res.status(401).json({ error: "login required" });
    const followeeId = req.params.id;
    const followerId = loginUser.id;
    if (followerId === followeeId) {
      return res.status(400).json({ error: "cannot follow yourself" });
    }
    try {
      await usersService.addFollower({ followerId, followeeId });
      res.json({ result: "ok" });
    } catch (e: unknown) {
      res.status(400).json({ error: (e as Error).message || "follow failed" });
    }
  });

  router.delete("/:id/follow", async (req: Request, res: Response) => {
    const loginUser = await authHelpers.getCurrentUser(req);
    if (!loginUser) return res.status(401).json({ error: "login required" });
    const followeeId = req.params.id;
    const followerId = loginUser.id;
    try {
      await usersService.removeFollower({ followerId, followeeId });
      res.json({ result: "ok" });
    } catch (e: unknown) {
      const msg = (e as Error).message || "";
      if (/not following/i.test(msg)) return res.status(404).json({ error: "not followed" });
      res.status(400).json({ error: msg || "unfollow failed" });
    }
  });

  router.get("/:id/followees", async (req: Request, res: Response) => {
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
    let users = await usersService.listFollowees({ followerId, offset, limit, order }, focusUserId);
    users = maskUserListSensitiveInfo(users, loginUser.isAdmin, loginUser.id);
    res.json(users);
  });

  router.get("/:id/followers", async (req: Request, res: Response) => {
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
    let users = await usersService.listFollowers({ followeeId, offset, limit, order }, focusUserId);
    users = maskUserListSensitiveInfo(users, loginUser.isAdmin, loginUser.id);
    res.json(users);
  });

  return router;
}

function maskUserSensitiveInfo<T extends { id: string; email: string }>(
  user: T,
  isAdmin: boolean,
  loginUserId: string,
): T {
  if (!user) return user;
  if (isAdmin || user.id === loginUserId) return user;
  return {
    ...user,
    email: maskEmailByHash(user.email),
  };
}

function maskUserListSensitiveInfo<T extends { id: string; email: string }>(
  users: T[],
  isAdmin: boolean,
  loginUserId: string,
): T[] {
  return users.map((u) => maskUserSensitiveInfo(u, isAdmin, loginUserId));
}
