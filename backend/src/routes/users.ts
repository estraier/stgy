import { Config } from "../config";
import { Router, Request, Response } from "express";
import { Pool } from "pg";
import Redis from "ioredis";
import crypto from "crypto";
import type { GeoCoder } from "stgy-geocoder";
import type { StorageService } from "../services/storage";
import { UsersService } from "../services/users";
import { AgreementTermsService } from "../services/agreementTerms";
import { MediaService } from "../services/media";
import { TracksService } from "../services/tracks";
import { AuthService } from "../services/auth";
import { ThrottleService, DailyTimerThrottleService } from "../services/throttle";
import { SearchService } from "../services/search";
import { AuthHelpers } from "./authHelpers";
import { EventLogService } from "../services/eventLog";
import { SendMailService } from "../services/sendMail";
import { PubViewsService } from "../services/pubViews";
import { CreateUserInput, UpdateUserInput, UpdatePasswordInput, UserLite } from "../models/user";
import { SearchCacheEntry } from "../models/search";
import { isAIModelTier, type AIModelTier } from "../models/aiModel";
import {
  validateEmail,
  normalizeEmail,
  normalizeText,
  normalizeOneLiner,
  normalizeMultiLines,
  normalizeLocale,
  parseBoolean,
  decToHex,
  hexToDec,
  maskEmailByHash,
} from "../utils/format";


function normalizeAiModelTier(value: unknown): AIModelTier | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value !== "string") throw new Error("invalid aiModel");
  const normalized = normalizeOneLiner(value);
  if (normalized === undefined || normalized === null || normalized === "") return null;
  if (!isAIModelTier(normalized)) throw new Error("invalid aiModel");
  return normalized;
}

export default function createUsersRouter(
  pgPool: Pool,
  redis: Redis,
  storageService: StorageService,
  eventLogService: EventLogService,
  geoCoder: GeoCoder,
) {
  const router = Router();
  const usersService = new UsersService(pgPool, redis, eventLogService);
  const agreementTermsService = new AgreementTermsService(pgPool);
  const mediaService = new MediaService(storageService, redis);
  const tracksService = new TracksService(storageService, geoCoder);
  const authService = new AuthService(pgPool, redis);
  const searchService = new SearchService(pgPool, "users");
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
  const pubViewsService = new PubViewsService(pgPool, redis);

  function parseSidebarCount(value: unknown): number | undefined {
    if (value === undefined) return undefined;
    if (typeof value !== "number" && typeof value !== "string") {
      throw new Error("invalid sidebar count");
    }
    if (typeof value === "string" && !/^-?\d+$/.test(value.trim())) {
      throw new Error("invalid sidebar count");
    }
    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed < -2147483648 || parsed > 2147483647) {
      throw new Error("invalid sidebar count");
    }
    return parsed;
  }

  router.get("/search", async (req: Request, res: Response) => {
    const loginUser = await authHelpers.requireLogin(req, res);
    if (!loginUser) return;
    if (!loginUser.isAdmin && !(await timerThrottleService.canDo(loginUser.id))) {
      return res.status(403).json({ error: "too often operations" });
    }
    const query = typeof req.query.query === "string" ? req.query.query.trim() : "";
    if (!query) {
      return res.status(400).json({ error: "query is required" });
    }
    const locale =
      typeof req.query.locale === "string" && req.query.locale ? req.query.locale : "en";
    const offset = Math.max(0, parseInt(req.query.offset as string) || 0);
    const reqLimit = Math.max(1, parseInt(req.query.limit as string) || 21);
    const neededLimit = offset + reqLimit;
    if (neededLimit > Config.SEARCH_LIMIT_MAX) {
      return res.status(400).json({ error: "Search limit exceeded" });
    }
    const hash = crypto.createHash("md5").update(`${query}:${locale}`).digest("hex");
    const cacheKey = `stgy:search:users:${hash}`;
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
        const watch = timerThrottleService.startWatch(loginUser);
        try {
          docIds = await searchService.search({
            query,
            locale,
            offset: 0,
            limit: neededLimit,
            timeout: 3,
          });
        } finally {
          watch.done();
        }
        const newCache: SearchCacheEntry = {
          query,
          limit: neededLimit,
          result: docIds,
        };
        await redis.setex(cacheKey, Config.SEARCH_CACHE_TTL_SEC, JSON.stringify(newCache));
      }
      const slicedIds = docIds.slice(offset, offset + reqLimit);
      const userPromises = slicedIds.map((id) => usersService.getUserLite(id));
      const users = (await Promise.all(userPromises)).filter((u): u is UserLite => u !== null);
      res.json(users);
    } catch (e: unknown) {
      console.error("Search error:", e);
      res.status(500).json({ error: (e as Error).message || "Internal server error" });
    }
  });

  router.get("/count", async (req: Request, res: Response) => {
    const loginUser = await authHelpers.requireLogin(req, res);
    if (!loginUser) return;
    if (!loginUser.isAdmin) {
      return res.status(403).json({ error: "admin only" });
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
      res.json(users);
    } catch (e: unknown) {
      res.status(400).json({ error: (e as Error).message || "list friends failed" });
    }
  });

  router.post("/agreement/:id", async (req: Request, res: Response) => {
    const loginUser = await authHelpers.requireLogin(req, res);
    if (!loginUser) return;
    try {
      hexToDec(req.params.id);
    } catch {
      return res.status(400).json({ error: "invalid id" });
    }
    const agreed = await agreementTermsService.agreeToLatestAgreementTerm(
      loginUser.id,
      req.params.id,
    );
    if (!agreed) {
      return res.status(409).json({ error: "agreement term is not latest" });
    }
    const sessionId = authHelpers.getSessionId(req);
    if (sessionId) {
      await authService.clearRequiredAgreementTermId(sessionId);
    }
    res.json({ result: "ok" });
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
      ["desc", "asc", "social"] as const,
    );
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
    const afterRaw = req.query.after;
    let after: string | undefined;
    if (afterRaw !== undefined) {
      if (
        typeof afterRaw !== "string" ||
        !/^(?:0x)?[0-9a-fA-F]{1,16}$/.test(afterRaw)
      ) {
        return res.status(400).json({ error: "invalid after" });
      }
      if (order === "social" || offset !== 0) {
        return res.status(400).json({ error: "after requires order=asc or desc and offset=0" });
      }
      after = afterRaw;
    }
    const watch = timerThrottleService.startWatch(loginUser);
    let users = await usersService.listUsers(
      { query, nickname, nicknamePrefix, offset, limit, order, after },
      focusUserId,
    );
    watch.done();
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
        locale: normalizeLocale(req.body.locale) ?? "",
        timezone: normalizeOneLiner(req.body.timezone) ?? "",
        introduction: normalizeMultiLines(req.body.introduction) ?? "",
        avatar: normalizeOneLiner(req.body.avatar) ?? null,
        aiModel: normalizeAiModelTier(req.body.aiModel) ?? null,
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
    const loginUser = await authHelpers.requireWritableUser(req, res);
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
    if (!loginUser.isAdmin && req.body.isFrozen !== undefined) {
      return res.status(403).json({ error: "forbidden to change isFrozen" });
    }
    if (!loginUser.isAdmin && req.body.aiModel !== undefined) {
      return res.status(403).json({ error: "forbidden to change aiModel" });
    }
    if (!loginUser.isAdmin && req.body.aiPersonality !== undefined) {
      const currentUser = await usersService.getUserLite(loginUser.id);
      if (!currentUser?.aiModel) {
        return res.status(403).json({ error: "forbidden to change aiPersonality" });
      }
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
    let locale;
    if (req.body.locale) {
      locale = normalizeLocale(req.body.locale) ?? "";
      dataSize += locale.length;
    }
    let timezone;
    if (req.body.timezone) {
      timezone = normalizeOneLiner(req.body.timezone) ?? "";
      dataSize += timezone.length;
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
      const authenticationStateInput =
        req.body.isAdmin !== undefined || req.body.isFrozen !== undefined;
      const previousUser = authenticationStateInput
        ? await usersService.getUserLite(req.params.id)
        : null;
      const input: UpdateUserInput = {
        id: req.params.id,
        email: email,
        nickname: nickname,
        isAdmin: req.body.isAdmin === undefined ? undefined : !!req.body.isAdmin,
        isFrozen: req.body.isFrozen === undefined ? undefined : !!req.body.isFrozen,
        blockStrangers: req.body.blockStrangers === undefined ? undefined : req.body.blockStrangers,
        locale: locale,
        timezone: timezone,
        introduction: introduction,
        avatar: normalizeOneLiner(req.body.avatar),
        aiModel: normalizeAiModelTier(req.body.aiModel),
        aiPersonality: aiPersonality,
      };
      const watch = timerThrottleService.startWatch(loginUser);
      const updated = await usersService.updateUser(input);
      watch.done();
      if (!updated) return res.status(404).json({ error: "not found" });
      const authenticationStateChanged =
        previousUser !== null &&
        (previousUser.isAdmin !== updated.isAdmin ||
          previousUser.isFrozen !== updated.isFrozen);
      if (authenticationStateChanged) {
        await authService.deleteUserSessions(req.params.id);
      } else if (loginUser.id === req.params.id) {
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
    const loginUser = await authHelpers.requireWritableUser(req, res);
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
    const loginUser = await authHelpers.requireWritableUser(req, res);
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
    const loginUser = await authHelpers.requireWritableUser(req, res);
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
    const loginUser = await authHelpers.requireWritableUser(req, res);
    if (!loginUser) return;
    if (!(loginUser.isAdmin || loginUser.id === req.params.id)) {
      return res.status(403).json({ error: "forbidden" });
    }
    try {
      await usersService.deleteUser(req.params.id);
      await authService.deleteUserSessions(req.params.id);
      await mediaService.deleteAllImagesAndProfiles(req.params.id);
      await tracksService.deleteAllTracks(req.params.id);
      res.json({ result: "ok" });
    } catch (e: unknown) {
      const msg = (e as Error).message || "";
      if (/user not found/i.test(msg)) return res.status(404).json({ error: "not found" });
      res.status(400).json({ error: msg || "delete error" });
    }
  });

  router.post("/:id/follow", async (req: Request, res: Response) => {
    const loginUser = await authHelpers.requireWritableUser(req, res);
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
    const loginUser = await authHelpers.requireWritableUser(req, res);
    if (!loginUser) return;
    if (!loginUser.isAdmin && !(await timerThrottleService.canDo(loginUser.id))) {
      return res.status(403).json({ error: "too often operations" });
    }
    const followeeId = req.params.id;
    try {
      const watch = timerThrottleService.startWatch(loginUser);
      await usersService.removeFollow({ followerId: loginUser.id, followeeId });
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
    let users = await usersService.listFollowees(
      { followerId, offset, limit, order, after },
      focusUserId,
    );
    watch.done();
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
    res.json(users);
  });

  router.post("/:id/block", async (req: Request, res: Response) => {
    const loginUser = await authHelpers.requireWritableUser(req, res);
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
    const loginUser = await authHelpers.requireWritableUser(req, res);
    if (!loginUser) return;
    if (!loginUser.isAdmin && !(await timerThrottleService.canDo(loginUser.id))) {
      return res.status(403).json({ error: "too often operations" });
    }
    const blockeeId = req.params.id;
    try {
      const watch = timerThrottleService.startWatch(loginUser);
      await usersService.removeBlock({ blockerId: loginUser.id, blockeeId });
      watch.done();
      res.json({ result: "ok" });
    } catch (e: unknown) {
      const msg = (e as Error).message || "";
      if (/not blocking/i.test(msg)) return res.status(404).json({ error: "not blocked" });
      res.status(400).json({ error: msg || "unblock failed" });
    }
  });

  router.get("/:id/blockees", async (req: Request, res: Response) => {
    const loginUser = await authHelpers.requireLogin(req, res);
    if (!loginUser) return;
    if (!loginUser.isAdmin && !(await timerThrottleService.canDo(loginUser.id))) {
      return res.status(403).json({ error: "too often operations" });
    }
    const blockerId = req.params.id;
    const { offset, limit, order } = AuthHelpers.getPageParams(
      req,
      loginUser.isAdmin ? 65535 : Config.MAX_PAGE_LIMIT,
      ["desc", "asc"] as const,
    );
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
    let users = await usersService.listBlockees(
      { blockerId, offset, limit, order, after },
      focusUserId,
    );
    watch.done();
    res.json(users);
  });

  router.get("/:id/pub-ranking", async (req: Request, res: Response) => {
    if (!/^(?:0x)?[0-9a-fA-F]{1,16}$/.test(req.params.id)) {
      return res.status(400).json({ error: "invalid id" });
    }
    const requestedLimit = Number(req.query.limit ?? 5);
    if (!Number.isInteger(requestedLimit) || requestedLimit < 0) {
      return res.status(400).json({ error: "invalid limit" });
    }
    const limit = Math.min(requestedLimit, Config.PUB_SIDE_POSTS_MAX);
    const userId = decToHex(hexToDec(req.params.id));
    try {
      res.json(await pubViewsService.getRankingEntries(userId, limit));
    } catch (e: unknown) {
      res.status(500).json({ error: (e as Error).message || "get pub-ranking failed" });
    }
  });

  router.get("/:id/pub-stats", async (req: Request, res: Response) => {
    const loginUser = await authHelpers.requireLogin(req, res);
    if (!loginUser) return;
    if (!(loginUser.isAdmin || loginUser.id === req.params.id)) {
      return res.status(403).json({ error: "forbidden" });
    }
    try {
      res.json(await pubViewsService.getStats(req.params.id));
    } catch (e: unknown) {
      res.status(500).json({ error: (e as Error).message || "get pub-stats failed" });
    }
  });

  router.get("/:id/pub-config", async (req: Request, res: Response) => {
    try {
      const cfg = await usersService.getPubConfig(req.params.id);
      res.json(cfg);
    } catch (e: unknown) {
      res.status(400).json({ error: (e as Error).message || "get pub-config failed" });
    }
  });

  router.put("/:id/pub-config", async (req: Request, res: Response) => {
    const loginUser = await authHelpers.requireWritableUser(req, res);
    if (!loginUser) return;
    if (!loginUser.isAdmin && !(await timerThrottleService.canDo(loginUser.id))) {
      return res.status(403).json({ error: "too often operations" });
    }
    if (!(loginUser.isAdmin || loginUser.id === req.params.id)) {
      return res.status(403).json({ error: "forbidden" });
    }
    let dataSize = 0;
    let siteName: string | undefined;
    if (typeof req.body.siteName === "string") {
      siteName = normalizeOneLiner(req.body.siteName) ?? "";
      dataSize += siteName.length;
    }
    let subtitle: string | undefined;
    if (typeof req.body.subtitle === "string") {
      subtitle = normalizeOneLiner(req.body.subtitle) ?? "";
      dataSize += subtitle.length;
    }
    let author: string | undefined;
    if (typeof req.body.author === "string") {
      author = normalizeOneLiner(req.body.author) ?? "";
      dataSize += author.length;
    }
    let introduction: string | undefined;
    if (typeof req.body.introduction === "string") {
      introduction = normalizeMultiLines(req.body.introduction) ?? "";
      dataSize += introduction.length;
    }
    let designTheme: string | undefined;
    if (typeof req.body.designTheme === "string") {
      designTheme = normalizeOneLiner(req.body.designTheme) ?? "";
      if (!/^[A-Za-z0-9_-]*$/.test(designTheme)) {
        return res.status(400).json({ error: "invalid designTheme" });
      }
      dataSize += designTheme.length;
    }
    let showServiceHeader: boolean | undefined;
    if (req.body.showServiceHeader !== undefined) {
      showServiceHeader = parseBoolean(String(req.body.showServiceHeader), true);
    }
    let showSiteName: boolean | undefined;
    if (req.body.showSiteName !== undefined) {
      showSiteName = parseBoolean(String(req.body.showSiteName), true);
    }
    let showPagenation: boolean | undefined;
    if (req.body.showPagenation !== undefined) {
      showPagenation = parseBoolean(String(req.body.showPagenation), true);
    }
    let showSideProfile: boolean | undefined;
    if (req.body.showSideProfile !== undefined) {
      showSideProfile = parseBoolean(String(req.body.showSideProfile), true);
    }
    let showSideRecent: number | undefined;
    let showSidePopular: number | undefined;
    try {
      showSideRecent = parseSidebarCount(req.body.showSideRecent);
      showSidePopular = parseSidebarCount(req.body.showSidePopular);
    } catch (e: unknown) {
      return res.status(400).json({ error: (e as Error).message });
    }
    if (!loginUser.isAdmin && !(await updatesThrottleService.canDo(loginUser.id, dataSize))) {
      return res.status(403).json({ error: "too often updates" });
    }
    try {
      const current = await usersService.getPubConfig(req.params.id);
      const next = {
        siteName: siteName ?? current.siteName,
        subtitle: subtitle ?? current.subtitle,
        author: author ?? current.author,
        introduction: introduction ?? current.introduction,
        designTheme: designTheme ?? current.designTheme,
        showServiceHeader: showServiceHeader ?? current.showServiceHeader,
        showSiteName: showSiteName ?? current.showSiteName,
        showPagenation: showPagenation ?? current.showPagenation,
        showSideProfile: showSideProfile ?? current.showSideProfile,
        showSideRecent: showSideRecent ?? current.showSideRecent,
        showSidePopular: showSidePopular ?? current.showSidePopular,
      };
      const watch = timerThrottleService.startWatch(loginUser);
      const saved = await usersService.setPubConfig(req.params.id, next);
      watch.done();
      if (!loginUser.isAdmin) {
        await updatesThrottleService.recordDone(loginUser.id, dataSize);
      }
      res.json(saved);
    } catch (e: unknown) {
      res.status(400).json({ error: (e as Error).message || "update pub-config failed" });
    }
  });

  return router;
}

function maskUserSensitiveInfo<
  T extends { id: string; email: string; aiPersonality: string | null },
>(user: T, isAdmin: boolean, loginUserId: string): T {
  if (!user) return user;
  if (isAdmin || user.id === loginUserId) return user;
  const masked = { ...user };
  masked.email = maskEmailByHash(user.email);
  if (user.aiPersonality !== null) masked.aiPersonality = "";
  return masked;
}
