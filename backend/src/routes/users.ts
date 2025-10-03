import { Config } from "../config";
import { Router, Request, Response } from "express";
import { Pool } from "pg";
import Redis from "ioredis";
import type { StorageService } from "../services/storage";
import { UsersService } from "../services/users";
import { MediaService } from "../services/media";
import { AuthService } from "../services/auth";
import { ThrottleService, DailyTimerThrottleService } from "../services/throttle";
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
  pgPool: Pool,
  redis: Redis,
  storageService: StorageService,
  eventLogService: EventLogService,
) {
  const router = Router();
  const usersService = new UsersService(pgPool, redis, eventLogService);
  const mediaService = new MediaService(storageService, redis);
  const authService = new AuthService(pgPool, redis);
  const timerThrottleService = new DailyTimerThrottleService(
    redis,
    "db",
    Config.DAILY_DB_TIMER_LIMIT_MS,
  );
  const updatesThrottleService = new ThrottleService(
    redis,
    "user-updates",
    3600,
    Config.HOURLY_USER_UPDATES_COUNT_LIMIT,
    Config.HOURLY_USER_UPDATES_SIZE_LIMIT,
  );
  const authHelpers = new AuthHelpers(authService, usersService);
  const sendMailService = new SendMailService(redis);

  router.get("/count", async (req: Request, res: Response) => {
    const loginUser = await authHelpers.requireLogin(req, res);
    if (!loginUser) return;
    if (!loginUser.isAdmin && !(await timerThrottleService.canDo(loginUser.id))) {
      return res.status(403).json({ error: "too often operations" });
    }
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
    const watch = timerThrottleService.startWatch(loginUser);
    const count = await usersService.countUsers({ query, nickname, nicknamePrefix });
    watch.done();
    res.json({ count });
  });

  router.get("/friends/by-nickname-prefix", async (req: Request, res: Response) => {
    const loginUser = await authHelpers.requireLogin(req, res);
    if (!loginUser) return;
    if (!loginUser.isAdmin && !(await timerThrottleService.canDo(loginUser.id))) {
      return res.status(403).json({ error: "too often operations" });
    }
    const focusUserId =
      typeof req.query.focusUserId === "string" && req.query.focusUserId.trim() !== ""
        ? req.query.focusUserId.trim()
        : loginUser.id;
    const { offset, limit } = AuthHelpers.getPageParams(
      req,
      loginUser.isAdmin ? 65535 : Config.MAX_PAGE_LIMIT,
      ["desc", "asc"] as const,
    );
    const nicknamePrefix =
      typeof req.query.nicknamePrefix === "string" ? req.query.nicknamePrefix.trim() : "";
    const omitSelf = parseBoolean(req.query.omitSelf as string, false);
    const omitOthers = parseBoolean(req.query.omitOthers as string, false);
    try {
      const watch = timerThrottleService.startWatch(loginUser);
      let users = await usersService.listFriendsByNicknamePrefix({
        focusUserId,
        nicknamePrefix,
        offset,
        limit,
        omitSelf,
        omitOthers,
      });
      watch.done();
      users = maskUserListSensitiveInfo(users, loginUser.isAdmin, loginUser.id);
      res.json(users);
    } catch (e: unknown) {
      res.status(400).json({ error: (e as Error).message || "list friends failed" });
    }
  });

  router.get("/:id/lite", async (req: Request, res: Response) => {
    const loginUser = await authHelpers.requireLogin(req, res);
    if (!loginUser) return;
    if (!loginUser.isAdmin && !(await timerThrottleService.canDo(loginUser.id))) {
      return res.status(403).json({ error: "too often operations" });
    }
    const watch = timerThrottleService.startWatch(loginUser);
    let user = await usersService.getUserLite(req.params.id);
    watch.done();
    if (!user) return res.status(404).json({ error: "not found" });
    user = maskUserSensitiveInfo(user, loginUser.isAdmin, loginUser.id);
    res.json(user);
  });

  router.get("/:id", async (req: Request, res: Response) => {
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
    let user = await usersService.getUser(req.params.id, focusUserId);
    watch.done();
    if (!user) return res.status(404).json({ error: "not found" });
    user = maskUserSensitiveInfo(user, loginUser.isAdmin, loginUser.id);
    res.json(user);
  });

  router.get("/", async (req: Request, res: Response) => {
    const loginUser = await authHelpers.requireLogin(req, res);
    if (!loginUser) return;
    if (!loginUser.isAdmin && !(await timerThrottleService.canDo(loginUser.id))) {
      return res.status(403).json({ error: "too often operations" });
    }
    const { offset, limit, order } = AuthHelpers.getPageParams(
      req,
      loginUser.isAdmin ? 65535 : Config.MAX_PAGE_LIMIT,
      ["desc", "asc", "social"] as const,
    );
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
    const watch = timerThrottleService.startWatch(loginUser);
    let users = await usersService.listUsers(
      { offset, limit, order, query, nickname, nicknamePrefix },
      focusUserId,
    );
    watch.done();
    users = maskUserListSensitiveInfo(users, loginUser.isAdmin, loginUser.id);
    res.json(users);
  });

  router.post("/", async (req: Request, res: Response) => {
    const loginUser = await authHelpers.requireLogin(req, res);
    if (!loginUser) return;
    if (!loginUser.isAdmin) {
      return res.status(403).json({ error: "admin only" });
    }
    try {
      const input: CreateUserInput = {
        id: typeof req.body.id === "string" ? (normalizeOneLiner(req.body.id) ?? "") : undefined,
        email: normalizeEmail(normalizeOneLiner(req.body.email) ?? ""),
        nickname: normalizeOneLiner(req.body.nickname) ?? "",
        password: normalizeText(req.body.password) ?? "",
        isAdmin: !!req.body.isAdmin,
        blockStrangers: !!req.body.blockStrangers,
        introduction: normalizeMultiLines(req.body.introduction) ?? "",
        avatar: normalizeOneLiner(req.body.avatar) ?? null,
        aiModel: normalizeOneLiner(req.body.aiModel) ?? null,
        aiPersonality: normalizeMultiLines(req.body.aiPersonality) ?? null,
      };
      const watch = timerThrottleService.startWatch(loginUser);
      const created = await usersService.createUser(input);
      watch.done();
      res.status(201).json(created);
    } catch (e: unknown) {
      res.status(400).json({ error: (e as Error).message || "invalid input" });
    }
  });

  router.put("/:id", async (req: Request, res: Response) => {
    const loginUser = await authHelpers.requireLogin(req, res);
    if (!loginUser) return;
    if (!loginUser.isAdmin && !(await timerThrottleService.canDo(loginUser.id))) {
      return res.status(403).json({ error: "too often operations" });
    }
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
    let dataSize = 0;
    let email;
    if (req.body.email) {
      email = normalizeEmail(normalizeOneLiner(req.body.email) ?? "") ?? "";
      dataSize += email.length;
    }
    let nickname;
    if (req.body.nickname) {
      nickname = normalizeOneLiner(req.body.nickname) ?? "";
      dataSize += nickname.length;
    }
    let introduction;
    if (req.body.introduction) {
      introduction = normalizeMultiLines(req.body.introduction) ?? "";
      if (!loginUser.isAdmin && introduction.length > Config.INTRODUCTION_LENGTH_LIMIT) {
        return res.status(400).json({ error: "introduction is too long" });
      }
      dataSize += introduction.length;
    }
    let aiPersonality;
    if (req.body.aiPersonality) {
      aiPersonality = normalizeMultiLines(req.body.aiPersonality) ?? "";
      if (!loginUser.isAdmin && aiPersonality.length > Config.AI_PERSONALITY_LENGTH_LIMIT) {
        return res.status(400).json({ error: "aiPersonality is too long" });
      }
      dataSize += aiPersonality.length;
    }
    if (!loginUser.isAdmin && !(await updatesThrottleService.canDo(loginUser.id, dataSize))) {
      return res.status(403).json({ error: "too often updates" });
    }
    try {
      const input: UpdateUserInput = {
        id: req.params.id,
        email: email,
        nickname: nickname,
        isAdmin: req.body.isAdmin === undefined ? undefined : req.body.isAdmin,
        blockStrangers: req.body.blockStrangers === undefined ? undefined : req.body.blockStrangers,
        introduction: introduction,
        avatar: normalizeOneLiner(req.body.avatar),
        aiModel: normalizeOneLiner(req.body.aiModel),
        aiPersonality: aiPersonality,
      };
      const watch = timerThrottleService.startWatch(loginUser);
      const updated = await usersService.updateUser(input);
      watch.done();
      if (!updated) return res.status(404).json({ error: "not found" });
      if (loginUser.id === req.params.id) {
        const sessionId = authHelpers.getSessionId(req);
        if (sessionId) {
          await authService.refreshSessionInfo(sessionId);
        }
      }
      if (!loginUser.isAdmin) {
        await updatesThrottleService.recordDone(loginUser.id, dataSize);
      }
      res.json(updated);
    } catch (e: unknown) {
      res.status(400).json({ error: (e as Error).message || "update error" });
    }
  });

  router.post("/:id/email/start", async (req: Request, res: Response) => {
    const loginUser = await authHelpers.requireLogin(req, res);
    if (!loginUser) return;
    if (!loginUser.isAdmin && !(await timerThrottleService.canDo(loginUser.id))) {
      return res.status(403).json({ error: "too often operations" });
    }
    if (!(loginUser.isAdmin || loginUser.id === req.params.id)) {
      return res.status(403).json({ error: "forbidden" });
    }
    const { email } = req.body;
    if (!email) {
      return res.status(400).json({ error: "email required" });
    }
    if (!validateEmail(email)) {
      return res.status(400).json({ error: "invalid e-mail address" });
    }
    const normEmail = normalizeEmail(email);
    const check = await sendMailService.canSendMail(normEmail);
    if (!check.ok) {
      return res.status(400).json({ error: check.reason || "too many requests" });
    }
    try {
      const watch = timerThrottleService.startWatch(loginUser);
      const { updateEmailId } = await usersService.startUpdateEmail(req.params.id, normEmail);
      watch.done();
      res.status(201).json({ updateEmailId });
    } catch (e: unknown) {
      res.status(400).json({ error: (e as Error).message || "update email failed" });
    }
  });

  router.post("/:id/email/verify", async (req: Request, res: Response) => {
    const loginUser = await authHelpers.requireLogin(req, res);
    if (!loginUser) return;
    if (!loginUser.isAdmin && !(await timerThrottleService.canDo(loginUser.id))) {
      return res.status(403).json({ error: "too often operations" });
    }
    if (!(loginUser.isAdmin || loginUser.id === req.params.id)) {
      return res.status(403).json({ error: "forbidden" });
    }
    const { updateEmailId, verificationCode } = req.body;
    if (!updateEmailId || !verificationCode) {
      return res.status(400).json({ error: "updateEmailId and verificationCode are needed" });
    }
    try {
      const watch = timerThrottleService.startWatch(loginUser);
      await usersService.verifyUpdateEmail(req.params.id, updateEmailId, verificationCode);
      watch.done();
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
      return res.status(400).json({ error: "invalid e-mail address" });
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
    const loginUser = await authHelpers.requireLogin(req, res);
    if (!loginUser) return;
    if (!loginUser.isAdmin && !(await timerThrottleService.canDo(loginUser.id))) {
      return res.status(403).json({ error: "too often operations" });
    }
    if (!(loginUser.isAdmin || loginUser.id === req.params.id)) {
      return res.status(403).json({ error: "forbidden" });
    }
    const { password } = req.body;
    if (!password) {
      return res.status(400).json({ error: "password required" });
    }
    try {
      const input: UpdatePasswordInput = { id: req.params.id, password };
      const watch = timerThrottleService.startWatch(loginUser);
      await usersService.updateUserPassword(input);
      watch.done();
      res.json({ result: "ok" });
    } catch (e: unknown) {
      const msg = (e as Error).message || "";
      if (/user not found/i.test(msg)) return res.status(404).json({ error: "not found" });
      res.status(400).json({ error: msg || "update password error" });
    }
  });

  router.delete("/:id", async (req: Request, res: Response) => {
    const loginUser = await authHelpers.requireLogin(req, res);
    if (!loginUser) return;
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
    const loginUser = await authHelpers.requireLogin(req, res);
    if (!loginUser) return;
    if (!loginUser.isAdmin && !(await timerThrottleService.canDo(loginUser.id))) {
      return res.status(403).json({ error: "too often operations" });
    }
    const followeeId = req.params.id;
    const followerId = loginUser.id;
    if (followerId === followeeId) {
      return res.status(400).json({ error: "cannot follow yourself" });
    }
    if (!loginUser.isAdmin && (await authHelpers.checkBlock(followeeId, followerId))) {
      return res.status(400).json({ error: "blocked by the user" });
    }
    if (!loginUser.isAdmin && !(await updatesThrottleService.canDo(loginUser.id))) {
      return res.status(403).json({ error: "too often updates" });
    }
    try {
      const watch = timerThrottleService.startWatch(loginUser);
      await usersService.addFollow({ followerId, followeeId });
      watch.done();
      if (!loginUser.isAdmin) {
        await updatesThrottleService.recordDone(loginUser.id);
      }
      res.json({ result: "ok" });
    } catch (e: unknown) {
      res.status(400).json({ error: (e as Error).message || "follow failed" });
    }
  });

  router.delete("/:id/follow", async (req: Request, res: Response) => {
    const loginUser = await authHelpers.requireLogin(req, res);
    if (!loginUser) return;
    if (!loginUser.isAdmin && !(await timerThrottleService.canDo(loginUser.id))) {
      return res.status(403).json({ error: "too often operations" });
    }
    const followeeId = req.params.id;
    const followerId = loginUser.id;
    try {
      const watch = timerThrottleService.startWatch(loginUser);
      await usersService.removeFollow({ followerId, followeeId });
      watch.done();
      res.json({ result: "ok" });
    } catch (e: unknown) {
      const msg = (e as Error).message || "";
      if (/not following/i.test(msg)) return res.status(404).json({ error: "not followed" });
      res.status(400).json({ error: msg || "unfollow failed" });
    }
  });

  router.get("/:id/followees", async (req: Request, res: Response) => {
    const loginUser = await authHelpers.requireLogin(req, res);
    if (!loginUser) return;
    if (!loginUser.isAdmin && !(await timerThrottleService.canDo(loginUser.id))) {
      return res.status(403).json({ error: "too often operations" });
    }
    const followerId = req.params.id;
    const { offset, limit, order } = AuthHelpers.getPageParams(
      req,
      loginUser.isAdmin ? 65535 : Config.MAX_PAGE_LIMIT,
      ["desc", "asc"] as const,
    );
    const focusUserId =
      typeof req.query.focusUserId === "string" && req.query.focusUserId.trim() !== ""
        ? req.query.focusUserId.trim()
        : undefined;
    const watch = timerThrottleService.startWatch(loginUser);
    let users = await usersService.listFollowees({ followerId, offset, limit, order }, focusUserId);
    watch.done();
    users = maskUserListSensitiveInfo(users, loginUser.isAdmin, loginUser.id);
    res.json(users);
  });

  router.get("/:id/followers", async (req: Request, res: Response) => {
    const loginUser = await authHelpers.requireLogin(req, res);
    if (!loginUser) return;
    if (!loginUser.isAdmin && !(await timerThrottleService.canDo(loginUser.id))) {
      return res.status(403).json({ error: "too often operations" });
    }
    const followeeId = req.params.id;
    const { offset, limit, order } = AuthHelpers.getPageParams(
      req,
      loginUser.isAdmin ? 65535 : Config.MAX_PAGE_LIMIT,
      ["desc", "asc"] as const,
    );
    const focusUserId =
      typeof req.query.focusUserId === "string" && req.query.focusUserId.trim() !== ""
        ? req.query.focusUserId.trim()
        : undefined;
    const watch = timerThrottleService.startWatch(loginUser);
    let users = await usersService.listFollowers({ followeeId, offset, limit, order }, focusUserId);
    watch.done();
    users = maskUserListSensitiveInfo(users, loginUser.isAdmin, loginUser.id);
    res.json(users);
  });

  router.post("/:id/block", async (req: Request, res: Response) => {
    const loginUser = await authHelpers.requireLogin(req, res);
    if (!loginUser) return;
    if (!loginUser.isAdmin && !(await timerThrottleService.canDo(loginUser.id))) {
      return res.status(403).json({ error: "too often operations" });
    }
    const blockeeId = req.params.id;
    const blockerId = loginUser.id;
    if (blockerId === blockeeId) {
      return res.status(400).json({ error: "cannot block yourself" });
    }
    if (!loginUser.isAdmin && !(await updatesThrottleService.canDo(loginUser.id))) {
      return res.status(403).json({ error: "too often updates" });
    }
    try {
      const watch = timerThrottleService.startWatch(loginUser);
      await usersService.addBlock({ blockerId, blockeeId });
      watch.done();
      if (!loginUser.isAdmin) {
        await updatesThrottleService.recordDone(loginUser.id);
      }
      res.json({ result: "ok" });
    } catch (e: unknown) {
      res.status(400).json({ error: (e as Error).message || "block failed" });
    }
  });

  router.delete("/:id/block", async (req: Request, res: Response) => {
    const loginUser = await authHelpers.requireLogin(req, res);
    if (!loginUser) return;
    if (!loginUser.isAdmin && !(await timerThrottleService.canDo(loginUser.id))) {
      return res.status(403).json({ error: "too often operations" });
    }
    const blockeeId = req.params.id;
    const blockerId = loginUser.id;
    try {
      const watch = timerThrottleService.startWatch(loginUser);
      await usersService.removeBlock({ blockerId, blockeeId });
      watch.done();
      res.json({ result: "ok" });
    } catch (e: unknown) {
      const msg = (e as Error).message || "";
      if (/not blocking/i.test(msg)) return res.status(404).json({ error: "not blocked" });
      res.status(400).json({ error: msg || "unblock failed" });
    }
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
