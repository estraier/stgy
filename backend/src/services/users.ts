import { Config } from "../config";
import {
  User,
  UserLite,
  UserDetail,
  CountUsersInput,
  CreateUserInput,
  UpdateUserInput,
  UpdatePasswordInput,
  ListUsersInput,
  ListFolloweesInput,
  ListFollowersInput,
  FollowUserPair,
  BlockUserPair,
  ListFriendsByNicknamePrefixInput,
} from "../models/user";
import { IdIssueService } from "./idIssue";
import { EventLogService } from "./eventLog";
import {
  generatePasswordHash,
  hexToDec,
  decToHex,
  hexArrayToDec,
  generateVerificationCode,
  validateEmail,
  validateLocale,
  validateTimezone,
  snakeToCamel,
  escapeForLike,
} from "../utils/format";
import { makeSnippetJsonFromMarkdown } from "../utils/snippet";
import { Pool } from "pg";
import Redis from "ioredis";
import { v4 as uuidv4 } from "uuid";
import { pgQuery } from "../utils/servers";

type FocusRelFlagsRow = {
  is_followed_by_focus_user: boolean;
  is_following_focus_user: boolean;
  is_blocked_by_focus_user: boolean;
  is_blocking_focus_user: boolean;
};

export class UsersService {
  private pgPool: Pool;
  private redis: Redis;
  private idIssueService: IdIssueService;
  private eventLogService?: EventLogService;

  constructor(pgPool: Pool, redis: Redis, eventLogService?: EventLogService) {
    this.pgPool = pgPool;
    this.redis = redis;
    this.idIssueService = new IdIssueService(Config.ID_ISSUE_WORKER_ID);
    this.eventLogService = eventLogService;
  }

  async countUsers(input?: CountUsersInput): Promise<number> {
    const query = input?.query?.trim();
    const nickname = input?.nickname?.trim();
    const nicknamePrefix = input?.nicknamePrefix?.trim();

    let sql = `
      SELECT COUNT(*)
      FROM users u
    `.trim();

    const params: unknown[] = [];
    const wheres: string[] = [];

    if (query) {
      const q = `%${escapeForLike(query)}%`;
      sql += `
        LEFT JOIN user_details d
          ON d.user_id = u.id
      `;
      wheres.push(`(u.nickname ILIKE $1 OR d.introduction ILIKE $1)`);
      params.push(q);
    } else if (nickname) {
      const q = `%${escapeForLike(nickname)}%`;
      wheres.push(`u.nickname ILIKE $1`);
      params.push(q);
    } else if (nicknamePrefix) {
      const q = `${escapeForLike(nicknamePrefix.toLowerCase())}%`;
      wheres.push(`LOWER(u.nickname) LIKE $1`);
      params.push(q);
    }

    if (wheres.length > 0) sql += ` WHERE ${wheres.join(" AND ")}`;

    const res = await pgQuery(this.pgPool, sql, params);
    return Number(res.rows[0].count);
  }

  async getUserLite(id: string): Promise<UserLite | null> {
    const res = await pgQuery(
      this.pgPool,
      `
        SELECT
          u.id,
          u.nickname,
          u.is_admin,
          u.block_strangers,
          u.ai_model,
          id_to_timestamp(u.id) AS created_at,
          u.updated_at,
          COALESCE(uc.follower_count, 0) AS count_followers,
          COALESCE(uc.followee_count, 0) AS count_followees,
          COALESCE(uc.post_count, 0) AS count_posts
        FROM users u
        LEFT JOIN user_counts uc ON uc.user_id = u.id
        WHERE u.id = $1
      `,
      [hexToDec(id)],
    );
    if (res.rows.length === 0) return null;

    const row = res.rows[0] as Record<string, unknown>;
    row.id = decToHex(row.id as string);
    return snakeToCamel<UserLite>(row);
  }

  async getUser(id: string, focusUserId?: string): Promise<UserDetail | null> {
    const userRes = await pgQuery(
      this.pgPool,
      `
        SELECT
          u.id,
          s.email,
          u.nickname,
          u.is_admin,
          u.block_strangers,
          u.snippet,
          u.avatar,
          u.ai_model,
          id_to_timestamp(u.id) AS created_at,
          u.updated_at,
          COALESCE(uc.follower_count, 0) AS count_followers,
          COALESCE(uc.followee_count, 0) AS count_followees,
          COALESCE(uc.post_count, 0) AS count_posts,
          d.locale,
          d.timezone,
          d.introduction,
          d.ai_personality
        FROM users u
        LEFT JOIN user_secrets         s   ON s.user_id  = u.id
        LEFT JOIN user_counts          uc  ON uc.user_id = u.id
        LEFT JOIN user_details         d   ON d.user_id  = u.id
        WHERE u.id = $1
      `,
      [hexToDec(id)],
    );

    if (userRes.rows.length === 0) return null;

    const row = userRes.rows[0] as Record<string, unknown>;
    row.id = decToHex(row.id as string);
    let user = snakeToCamel<UserDetail>(row);

    if (focusUserId && focusUserId !== id) {
      const res = await pgQuery<FocusRelFlagsRow>(
        this.pgPool,
        `
          SELECT
            EXISTS (
              SELECT 1 FROM user_follows
              WHERE follower_id = $1 AND followee_id = $2
            ) AS is_followed_by_focus_user,
            EXISTS (
              SELECT 1 FROM user_follows
              WHERE follower_id = $2 AND followee_id = $1
            ) AS is_following_focus_user,
            EXISTS (
              SELECT 1 FROM user_blocks
              WHERE blocker_id = $1 AND blockee_id = $2
            ) AS is_blocked_by_focus_user,
            EXISTS (
              SELECT 1 FROM user_blocks
              WHERE blocker_id = $2 AND blockee_id = $1
            ) AS is_blocking_focus_user
        `,
        [hexToDec(focusUserId), hexToDec(id)],
      );
      const r = res.rows[0];
      user.isFollowedByFocusUser = r.is_followed_by_focus_user;
      user.isFollowingFocusUser = r.is_following_focus_user;
      user.isBlockedByFocusUser = r.is_blocked_by_focus_user;
      user.isBlockingFocusUser = r.is_blocking_focus_user;
    }

    return user;
  }

  async listUsers(input?: ListUsersInput, focusUserId?: string): Promise<User[]> {
    const offset = input?.offset ?? 0;
    const limit = input?.limit ?? 100;
    const order = input?.order ?? "desc";
    const query = input?.query?.trim();
    const nickname = input?.nickname?.trim();
    const nicknamePrefix = input?.nicknamePrefix?.trim();

    let baseSelect = `
      SELECT
        u.id,
        u.nickname,
        u.is_admin,
        u.block_strangers,
        u.snippet,
        u.avatar,
        u.ai_model,
        id_to_timestamp(u.id) AS created_at,
        u.updated_at,
        COALESCE(uc.follower_count, 0) AS count_followers,
        COALESCE(uc.followee_count, 0) AS count_followees,
        COALESCE(uc.post_count, 0) AS count_posts
      FROM users u
      LEFT JOIN user_counts uc ON uc.user_id = u.id
    `.trim();

    const params: unknown[] = [];
    const wheres: string[] = [];

    if (query) {
      baseSelect += `
        LEFT JOIN user_details d
          ON d.user_id = u.id
      `;
      const q = `%${escapeForLike(query)}%`;
      wheres.push(`(u.nickname ILIKE $1 OR d.introduction ILIKE $1)`);
      params.push(q);
    } else if (nickname) {
      const q = `%${escapeForLike(nickname)}%`;
      wheres.push(`u.nickname ILIKE $${params.length + 1}`);
      params.push(q);
    } else if (nicknamePrefix) {
      const q = `${escapeForLike(nicknamePrefix.toLowerCase())}%`;
      wheres.push(`LOWER(u.nickname) LIKE $${params.length + 1}`);
      params.push(q);
    }

    let orderClause = "";
    if (order === "social" && focusUserId) {
      baseSelect += `
        LEFT JOIN user_follows f1
          ON f1.follower_id = $${params.length + 1}
         AND f1.followee_id = u.id
        LEFT JOIN user_follows f2
          ON f2.follower_id = u.id
         AND f2.followee_id = $${params.length + 1}
      `;
      const dec = hexToDec(focusUserId);
      params.push(dec);
      orderClause =
        `ORDER BY (u.id = $${params.length + 1}) DESC, ` +
        `(f1.follower_id IS NOT NULL) DESC, ` +
        `(f2.follower_id IS NOT NULL) DESC, ` +
        `u.id ASC`;
      params.push(dec);
    } else {
      const dir = order.toLowerCase() === "asc" ? "ASC" : "DESC";
      orderClause = `ORDER BY u.id ${dir}`;
    }

    let sql = baseSelect;
    if (wheres.length > 0) sql += ` WHERE ${wheres.join(" AND ")}`;
    sql += ` ${orderClause} OFFSET $${params.length + 1} LIMIT $${params.length + 2}`;
    params.push(offset, limit);

    const res = await pgQuery(this.pgPool, sql, params);
    const users = res.rows.map((row: Record<string, unknown>) => {
      row.id = decToHex(row.id as string);
      return snakeToCamel<User>(row);
    });

    if (users.length === 0) return [];

    if (focusUserId) {
      const ids = users.map((u) => u.id);
      const fwRes = await pgQuery<{ followee_id: string }>(
        this.pgPool,
        `
          SELECT followee_id
          FROM user_follows
          WHERE follower_id = $1
            AND followee_id = ANY($2)
        `,
        [hexToDec(focusUserId), hexArrayToDec(ids)],
      );
      const followedSet = new Set(fwRes.rows.map((r) => decToHex(r.followee_id) as string));

      const fgRes = await pgQuery<{ follower_id: string }>(
        this.pgPool,
        `
          SELECT follower_id
          FROM user_follows
          WHERE follower_id = ANY($1)
            AND followee_id = $2
        `,
        [hexArrayToDec(ids), hexToDec(focusUserId)],
      );
      const followingSet = new Set(fgRes.rows.map((r) => decToHex(r.follower_id) as string));

      const blByRes = await pgQuery<{ blockee_id: string }>(
        this.pgPool,
        `
          SELECT blockee_id
          FROM user_blocks
          WHERE blocker_id = $1
            AND blockee_id = ANY($2)
        `,
        [hexToDec(focusUserId), hexArrayToDec(ids)],
      );
      const blockedByFocusSet = new Set(blByRes.rows.map((r) => decToHex(r.blockee_id) as string));

      const blToRes = await pgQuery<{ blocker_id: string }>(
        this.pgPool,
        `
          SELECT blocker_id
          FROM user_blocks
          WHERE blocker_id = ANY($1)
            AND blockee_id = $2
        `,
        [hexArrayToDec(ids), hexToDec(focusUserId)],
      );
      const blockingFocusSet = new Set(blToRes.rows.map((r) => decToHex(r.blocker_id) as string));

      for (const u of users) {
        if (u.id === focusUserId) continue;
        u.isFollowedByFocusUser = followedSet.has(u.id);
        u.isFollowingFocusUser = followingSet.has(u.id);
        u.isBlockedByFocusUser = blockedByFocusSet.has(u.id);
        u.isBlockingFocusUser = blockingFocusSet.has(u.id);
      }
    }

    return users;
  }

  async createUser(input: CreateUserInput): Promise<User> {
    if (typeof input.email !== "string" || input.email.trim() === "")
      throw new Error("email is required");
    if (!validateEmail(input.email)) throw new Error("given email is invalid");
    if (typeof input.nickname !== "string" || input.nickname.trim() === "")
      throw new Error("nickname is required");
    if (typeof input.password !== "string" || input.password.trim() === "")
      throw new Error("password is required");
    if (typeof input.introduction !== "string") throw new Error("introduction is required");
    if (!validateLocale(input.locale)) throw new Error("locale is required");
    if (!validateTimezone(input.timezone)) throw new Error("timezone is required");
    let id: string;
    if (input.id && input.id.trim() !== "") {
      const hexId = input.id.trim();
      if (!/^[0-9A-F]{16}$/.test(hexId)) throw new Error("invalid id format");
      id = hexId;
    } else {
      id = await this.idIssueService.issueId();
    }

    const passwordHash = await generatePasswordHash(input.password);
    const snippet = makeSnippetJsonFromMarkdown(input.introduction ?? "");

    await pgQuery(this.pgPool, "BEGIN");
    try {
      await pgQuery(
        this.pgPool,
        `
          INSERT INTO users (
            id, nickname, is_admin, block_strangers, snippet, avatar, ai_model, updated_at
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, NULL)
        `,
        [
          hexToDec(id),
          input.nickname,
          input.isAdmin,
          input.blockStrangers,
          snippet,
          input.avatar,
          input.aiModel,
        ],
      );

      await pgQuery(
        this.pgPool,
        `
          INSERT INTO user_secrets (user_id, email, password)
          VALUES ($1, $2, $3)
        `,
        [hexToDec(id), input.email, passwordHash],
      );

      await pgQuery(
        this.pgPool,
        `
          INSERT INTO user_details (user_id, locale, timezone, introduction, ai_personality)
          VALUES ($1, $2, $3, $4, $5)
          ON CONFLICT (user_id) DO UPDATE
            SET locale = EXCLUDED.locale,
                timezone = EXCLUDED.timezone,
                introduction = EXCLUDED.introduction,
                ai_personality = EXCLUDED.ai_personality
        `,
        [
          hexToDec(id),
          input.locale,
          input.timezone,
          input.introduction,
          input.aiPersonality ?? null,
        ],
      );

      const res = await pgQuery(
        this.pgPool,
        `
          SELECT
            u.id,
            u.nickname,
            u.is_admin,
            u.block_strangers,
            u.snippet,
            u.avatar,
            u.ai_model,
            id_to_timestamp(u.id) AS created_at,
            u.updated_at,
            COALESCE(uc.follower_count, 0) AS count_followers,
            COALESCE(uc.followee_count, 0) AS count_followees,
            COALESCE(uc.post_count, 0) AS count_posts
          FROM users u
          LEFT JOIN user_counts uc ON uc.user_id = u.id
          WHERE u.id = $1
        `,
        [hexToDec(id)],
      );

      await pgQuery(this.pgPool, "COMMIT");

      const row = res.rows[0] as Record<string, unknown>;
      row.id = decToHex(row.id as string);
      return snakeToCamel<User>(row);
    } catch (e) {
      await pgQuery(this.pgPool, "ROLLBACK");
      throw e;
    }
  }

  async updateUser(input: UpdateUserInput): Promise<User | null> {
    const userCols: string[] = [];
    const userVals: unknown[] = [];
    let uidx = 1;

    if (input.nickname !== undefined) {
      if (!input.nickname || input.nickname.trim() === "") throw new Error("nickname is required");
      userCols.push(`nickname = $${uidx++}`);
      userVals.push(input.nickname);
    }
    if (input.isAdmin !== undefined) {
      userCols.push(`is_admin = $${uidx++}`);
      userVals.push(input.isAdmin);
    }
    if (input.blockStrangers !== undefined) {
      userCols.push(`block_strangers = $${uidx++}`);
      userVals.push(input.blockStrangers);
    }
    if (input.avatar !== undefined) {
      userCols.push(`avatar = $${uidx++}`);
      userVals.push(input.avatar);
    }
    if (input.aiModel !== undefined) {
      userCols.push(`ai_model = $${uidx++}`);
      userVals.push(input.aiModel);
    }

    if (input.locale !== undefined && !validateLocale(input.locale)) {
      throw new Error("given locale is invalid");
    }
    if (input.timezone !== undefined && !validateTimezone(input.timezone)) {
      throw new Error("given timezone is invalid");
    }

    const touchSnippet = input.introduction !== undefined;

    await pgQuery(this.pgPool, "BEGIN");
    try {
      if (input.email !== undefined) {
        if (!input.email || input.email.trim() === "") throw new Error("email is required");
        if (!validateEmail(input.email)) throw new Error("given email is invalid");
        await pgQuery(
          this.pgPool,
          `
          UPDATE user_secrets
          SET email = $1
          WHERE user_id = $2
        `,
          [input.email, hexToDec(input.id)],
        );
      }

      if (input.introduction !== undefined || input.aiPersonality !== undefined) {
        await pgQuery(
          this.pgPool,
          `
          INSERT INTO user_details (user_id, introduction, ai_personality)
          VALUES ($1, $2, $3)
          ON CONFLICT (user_id) DO UPDATE
            SET introduction  = COALESCE(EXCLUDED.introduction,  user_details.introduction),
                ai_personality = COALESCE(EXCLUDED.ai_personality, user_details.ai_personality)
        `,
          [hexToDec(input.id), input.introduction ?? null, input.aiPersonality ?? null],
        );
      }

      if (input.locale !== undefined || input.timezone !== undefined) {
        const bothProvided = input.locale !== undefined && input.timezone !== undefined;
        const sql = bothProvided
          ? `
          INSERT INTO user_details (user_id, locale, timezone)
          VALUES ($1, $2, $3)
          ON CONFLICT (user_id) DO UPDATE
            SET locale   = EXCLUDED.locale,
                timezone = EXCLUDED.timezone
        `
          : `
          INSERT INTO user_details (user_id, locale, timezone)
          VALUES ($1, $2, $3)
          ON CONFLICT (user_id) DO UPDATE
            SET locale   = COALESCE(EXCLUDED.locale,   user_details.locale),
                timezone = COALESCE(EXCLUDED.timezone, user_details.timezone)
        `;
        await pgQuery(this.pgPool, sql, [
          hexToDec(input.id),
          input.locale ?? null,
          input.timezone ?? null,
        ]);
      }

      if (touchSnippet && typeof input.introduction === "string") {
        userCols.push(`snippet = $${uidx++}`);
        const snippet = makeSnippetJsonFromMarkdown(input.introduction);
        userVals.push(snippet);
      }

      userCols.push(`updated_at = now()`);
      userVals.push(hexToDec(input.id));

      if (userCols.length > 0) {
        const sql = `
        UPDATE users
        SET ${userCols.join(", ")}
        WHERE id = $${uidx}
      `.trim();
        await pgQuery(this.pgPool, sql, userVals);
      }

      const res = await pgQuery(
        this.pgPool,
        `
        SELECT
          u.id,
          u.nickname,
          u.is_admin,
          u.block_strangers,
          u.snippet,
          u.avatar,
          u.ai_model,
          id_to_timestamp(u.id) AS created_at,
          u.updated_at,
          COALESCE(uc.follower_count, 0) AS count_followers,
          COALESCE(uc.followee_count, 0) AS count_followees,
          COALESCE(uc.post_count, 0) AS count_posts
        FROM users u
        LEFT JOIN user_counts uc ON uc.user_id = u.id
        WHERE u.id = $1
      `,
        [hexToDec(input.id)],
      );

      await pgQuery(this.pgPool, "COMMIT");

      if (!res.rows[0]) return null;
      const row = res.rows[0] as Record<string, unknown>;
      row.id = decToHex(row.id as string);
      return snakeToCamel<User>(row);
    } catch (e) {
      await pgQuery(this.pgPool, "ROLLBACK");
      throw e;
    }
  }

  async startUpdateEmail(userId: string, newEmail: string): Promise<{ updateEmailId: string }> {
    if (!validateEmail(newEmail)) throw new Error("Invalid email format.");

    const updateEmailId = uuidv4();
    const verificationCode = generateVerificationCode();
    const key = `updateEmail:${updateEmailId}`;

    await this.redis.hmset(key, {
      userId,
      newEmail,
      verificationCode,
      createdAt: new Date().toISOString(),
    });
    await this.redis.expire(key, 900);

    if (Config.TEST_SIGNUP_CODE.length == 0) {
      await this.redis.lpush(
        "mail-queue",
        JSON.stringify({ type: "update-email", newEmail, verificationCode }),
      );
    }
    return { updateEmailId };
  }

  async verifyUpdateEmail(userId: string, updateEmailId: string, code: string): Promise<void> {
    const key = `updateEmail:${updateEmailId}`;
    const data = await this.redis.hgetall(key);

    if (!data || !data.userId || !data.newEmail || !data.verificationCode)
      throw new Error("Update email info not found or expired.");
    if (data.userId !== userId) throw new Error("Session/user mismatch");
    if (data.verificationCode !== code) throw new Error("Verification code mismatch.");

    const exists = await pgQuery(
      this.pgPool,
      `
        SELECT 1
        FROM user_secrets
        WHERE email = $1
      `,
      [data.newEmail],
    );
    if (exists.rows.length > 0) throw new Error("Email already in use.");

    const res = await pgQuery(
      this.pgPool,
      `
        UPDATE user_secrets
        SET email = $1
        WHERE user_id = $2
      `,
      [data.newEmail, hexToDec(data.userId)],
    );

    await this.redis.del(key);
    if ((res.rowCount ?? 0) === 0) throw new Error("User not found");
  }

  async updateUserPassword(input: UpdatePasswordInput): Promise<void> {
    if (input.password.trim() === "") throw new Error("password is mustn't be empty");

    const passwordHash = await generatePasswordHash(input.password);
    const res = await pgQuery(
      this.pgPool,
      `
        UPDATE user_secrets
        SET password = $1
        WHERE user_id = $2
      `,
      [passwordHash, hexToDec(input.id)],
    );

    if ((res.rowCount ?? 0) === 0) throw new Error("User not found");
  }

  async startResetPassword(email: string): Promise<{ resetPasswordId: string; webCode: string }> {
    const res = await pgQuery(
      this.pgPool,
      `
        SELECT user_id AS id
        FROM user_secrets
        WHERE email = $1
      `,
      [email],
    );
    if (!res.rows[0] || !res.rows[0].id) throw new Error("User not found");

    const userId: string = decToHex(res.rows[0].id) as string;

    const resetPasswordId = uuidv4();
    const webCode = generateVerificationCode();
    const mailCode = generateVerificationCode();

    const key = `resetPassword:${resetPasswordId}`;
    await this.redis.hmset(key, {
      userId,
      email,
      webCode,
      mailCode,
      createdAt: new Date().toISOString(),
    });
    await this.redis.expire(key, 900);

    if (Config.TEST_SIGNUP_CODE.length == 0) {
      await this.redis.lpush(
        "mail-queue",
        JSON.stringify({ type: "reset-password", email, mailCode, resetPasswordId }),
      );
    }
    return { resetPasswordId, webCode };
  }

  async fakeResetPassword(): Promise<{ resetPasswordId: string; webCode: string }> {
    const resetPasswordId = uuidv4();
    const webCode = generateVerificationCode();
    return { resetPasswordId, webCode };
  }

  async verifyResetPassword(
    email: string,
    resetPasswordId: string,
    webCode: string,
    mailCode: string,
    newPassword: string,
  ): Promise<void> {
    const key = `resetPassword:${resetPasswordId}`;
    const data = await this.redis.hgetall(key);

    if (!data || !data.userId || !data.email || !data.webCode || !mailCode)
      throw new Error("Reset session not found or expired");
    if (data.email !== email) throw new Error("Session/user mismatch");
    if (data.webCode !== webCode) throw new Error("Web verification code mismatch");
    if (data.mailCode !== mailCode) throw new Error("Mail verification code mismatch");
    if (!newPassword || newPassword.trim().length < 6)
      throw new Error("Password must be at least 6 characters");

    const passwordHash = await generatePasswordHash(newPassword);
    const res = await pgQuery(
      this.pgPool,
      `
        UPDATE user_secrets
        SET password = $1
        WHERE user_id = $2
      `,
      [passwordHash, hexToDec(data.userId)],
    );

    await this.redis.del(key);
    if ((res.rowCount ?? 0) === 0) throw new Error("User not found");
  }

  async deleteUser(id: string): Promise<void> {
    const res = await pgQuery(
      this.pgPool,
      `
        DELETE FROM users
        WHERE id = $1
      `,
      [hexToDec(id)],
    );
    if ((res.rowCount ?? 0) === 0) throw new Error("User not found");
  }

  async listFollowees(input: ListFolloweesInput, focusUserId?: string): Promise<User[]> {
    const offset = input.offset ?? 0;
    const limit = input.limit ?? 100;
    const order = (input.order ?? "desc").toLowerCase() === "asc" ? "ASC" : "DESC";

    const sql = `
      SELECT
        u.id,
        u.nickname,
        u.is_admin,
        u.block_strangers,
        u.snippet,
        u.avatar,
        u.ai_model,
        id_to_timestamp(u.id) AS created_at,
        u.updated_at,
        COALESCE(uc.follower_count, 0) AS count_followers,
        COALESCE(uc.followee_count, 0) AS count_followees,
        COALESCE(uc.post_count, 0) AS count_posts
      FROM user_follows f
      JOIN users u ON f.followee_id = u.id
      LEFT JOIN user_counts uc ON uc.user_id = u.id
      WHERE f.follower_id = $1
      ORDER BY f.created_at ${order}, f.followee_id ${order}
      OFFSET $2 LIMIT $3
    `.trim();

    const res = await pgQuery(this.pgPool, sql, [hexToDec(input.followerId), offset, limit]);
    const users = res.rows.map((row: Record<string, unknown>) => {
      row.id = decToHex(row.id as string);
      return snakeToCamel<User>(row);
    });

    if (users.length === 0) return [];

    if (focusUserId) {
      const ids = users.map((u) => u.id);

      const fwRes = await pgQuery<{ followee_id: string }>(
        this.pgPool,
        `
          SELECT followee_id
          FROM user_follows
          WHERE follower_id = $1
            AND followee_id = ANY($2)
        `,
        [hexToDec(focusUserId), hexArrayToDec(ids)],
      );
      const followedSet = new Set(fwRes.rows.map((r) => decToHex(r.followee_id) as string));

      const fgRes = await pgQuery<{ follower_id: string }>(
        this.pgPool,
        `
          SELECT follower_id
          FROM user_follows
          WHERE follower_id = ANY($1)
            AND followee_id = $2
        `,
        [hexArrayToDec(ids), hexToDec(focusUserId)],
      );
      const followingSet = new Set(fgRes.rows.map((r) => decToHex(r.follower_id) as string));

      const blByRes = await pgQuery<{ blockee_id: string }>(
        this.pgPool,
        `
          SELECT blockee_id
          FROM user_blocks
          WHERE blocker_id = $1
            AND blockee_id = ANY($2)
        `,
        [hexToDec(focusUserId), hexArrayToDec(ids)],
      );
      const blockedByFocusSet = new Set(blByRes.rows.map((r) => decToHex(r.blockee_id) as string));

      const blToRes = await pgQuery<{ blocker_id: string }>(
        this.pgPool,
        `
          SELECT blocker_id
          FROM user_blocks
          WHERE blocker_id = ANY($1)
            AND blockee_id = $2
        `,
        [hexArrayToDec(ids), hexToDec(focusUserId)],
      );
      const blockingFocusSet = new Set(blToRes.rows.map((r) => decToHex(r.blocker_id) as string));

      for (const u of users) {
        if (u.id === focusUserId) continue;
        u.isFollowedByFocusUser = followedSet.has(u.id);
        u.isFollowingFocusUser = followingSet.has(u.id);
        u.isBlockedByFocusUser = blockedByFocusSet.has(u.id);
        u.isBlockingFocusUser = blockingFocusSet.has(u.id);
      }
    }

    return users;
  }

  async listFollowers(input: ListFollowersInput, focusUserId?: string): Promise<User[]> {
    const offset = input.offset ?? 0;
    const limit = input.limit ?? 100;
    const order = (input.order ?? "desc").toLowerCase() === "asc" ? "ASC" : "DESC";

    const sql = `
      SELECT
        u.id,
        u.nickname,
        u.is_admin,
        u.block_strangers,
        u.snippet,
        u.avatar,
        u.ai_model,
        id_to_timestamp(u.id) AS created_at,
        u.updated_at,
        COALESCE(uc.follower_count, 0) AS count_followers,
        COALESCE(uc.followee_count, 0) AS count_followees,
        COALESCE(uc.post_count, 0) AS count_posts
      FROM user_follows f
      JOIN users u ON f.follower_id = u.id
      LEFT JOIN user_counts uc ON uc.user_id = u.id
      WHERE f.followee_id = $1
      ORDER BY f.created_at ${order}, f.follower_id ${order}
      OFFSET $2 LIMIT $3
    `.trim();

    const res = await pgQuery(this.pgPool, sql, [hexToDec(input.followeeId), offset, limit]);
    const users = res.rows.map((row: Record<string, unknown>) => {
      row.id = decToHex(row.id as string);
      return snakeToCamel<User>(row);
    });

    if (users.length === 0) return [];

    if (focusUserId) {
      const ids = users.map((u) => u.id);

      const fwRes = await pgQuery<{ followee_id: string }>(
        this.pgPool,
        `
          SELECT followee_id
          FROM user_follows
          WHERE follower_id = $1
            AND followee_id = ANY($2)
        `,
        [hexToDec(focusUserId), hexArrayToDec(ids)],
      );
      const followedSet = new Set(fwRes.rows.map((r) => decToHex(r.followee_id) as string));

      const fgRes = await pgQuery<{ follower_id: string }>(
        this.pgPool,
        `
          SELECT follower_id
          FROM user_follows
          WHERE follower_id = ANY($1)
            AND followee_id = $2
        `,
        [hexArrayToDec(ids), hexToDec(focusUserId)],
      );
      const followingSet = new Set(fgRes.rows.map((r) => decToHex(r.follower_id) as string));

      const blByRes = await pgQuery<{ blockee_id: string }>(
        this.pgPool,
        `
          SELECT blockee_id
          FROM user_blocks
          WHERE blocker_id = $1
            AND blockee_id = ANY($2)
        `,
        [hexToDec(focusUserId), hexArrayToDec(ids)],
      );
      const blockedByFocusSet = new Set(blByRes.rows.map((r) => decToHex(r.blockee_id) as string));

      const blToRes = await pgQuery<{ blocker_id: string }>(
        this.pgPool,
        `
          SELECT blocker_id
          FROM user_blocks
          WHERE blocker_id = ANY($1)
            AND blockee_id = $2
        `,
        [hexArrayToDec(ids), hexToDec(focusUserId)],
      );
      const blockingFocusSet = new Set(blToRes.rows.map((r) => decToHex(r.blocker_id) as string));

      for (const u of users) {
        if (u.id === focusUserId) continue;
        u.isFollowedByFocusUser = followedSet.has(u.id);
        u.isFollowingFocusUser = followingSet.has(u.id);
        u.isBlockedByFocusUser = blockedByFocusSet.has(u.id);
        u.isBlockingFocusUser = blockingFocusSet.has(u.id);
      }
    }

    return users;
  }

  async addFollow(input: FollowUserPair): Promise<void> {
    if (input.followerId === input.followeeId) throw new Error("cannot follow yourself");

    const res = await pgQuery(
      this.pgPool,
      `
        INSERT INTO user_follows (follower_id, followee_id, created_at)
        VALUES ($1, $2, now())
        ON CONFLICT DO NOTHING
      `,
      [hexToDec(input.followerId), hexToDec(input.followeeId)],
    );
    if ((res.rowCount ?? 0) === 0) throw new Error("already following");

    if (this.eventLogService) {
      try {
        this.eventLogService.recordFollow({
          followerId: input.followerId,
          followeeId: input.followeeId,
        });
      } catch {}
    }
  }

  async removeFollow(input: FollowUserPair): Promise<void> {
    const res = await pgQuery(
      this.pgPool,
      `
        DELETE FROM user_follows
        WHERE follower_id = $1
          AND followee_id = $2
      `,
      [hexToDec(input.followerId), hexToDec(input.followeeId)],
    );
    if ((res.rowCount ?? 0) === 0) throw new Error("not following");
  }

  async checkFollow(input: FollowUserPair): Promise<boolean> {
    const r = await pgQuery(
      this.pgPool,
      `
        SELECT 1
        FROM user_follows
        WHERE follower_id = $1
          AND followee_id = $2
        LIMIT 1
      `,
      [hexToDec(input.followerId), hexToDec(input.followeeId)],
    );
    return (r.rowCount ?? 0) > 0;
  }

  async addBlock(input: BlockUserPair): Promise<void> {
    if (input.blockerId === input.blockeeId) throw new Error("cannot block yourself");

    const res = await pgQuery(
      this.pgPool,
      `
        INSERT INTO user_blocks (blocker_id, blockee_id, created_at)
        VALUES ($1, $2, now())
        ON CONFLICT DO NOTHING
      `,
      [hexToDec(input.blockerId), hexToDec(input.blockeeId)],
    );
    if ((res.rowCount ?? 0) === 0) throw new Error("already blocked");
  }

  async removeBlock(input: BlockUserPair): Promise<void> {
    const res = await pgQuery(
      this.pgPool,
      `
        DELETE FROM user_blocks
        WHERE blocker_id = $1
          AND blockee_id = $2
      `,
      [hexToDec(input.blockerId), hexToDec(input.blockeeId)],
    );
    if ((res.rowCount ?? 0) === 0) throw new Error("not blocking");
  }

  async checkBlock(input: BlockUserPair): Promise<boolean> {
    const r = await pgQuery(
      this.pgPool,
      `
        SELECT 1
        FROM user_blocks
        WHERE blocker_id = $1
          AND blockee_id = $2
        LIMIT 1
      `,
      [hexToDec(input.blockerId), hexToDec(input.blockeeId)],
    );
    return (r.rowCount ?? 0) > 0;
  }

  async listFriendsByNicknamePrefix(input: ListFriendsByNicknamePrefixInput): Promise<User[]> {
    const focusUserId = input.focusUserId;
    const prefix = (input.nicknamePrefix ?? "").trim().toLowerCase();
    const likePattern = `${escapeForLike(prefix)}%`;
    const offset = Math.max(0, input.offset ?? 0);
    const limit = Math.max(1, input.limit ?? 20);
    const k = offset + limit;
    const omitSelf = !!input.omitSelf;
    const omitOthers = !!input.omitOthers;

    const ctes: string[] = [];
    const unions: string[] = [];

    if (!omitSelf) {
      ctes.push(`
        self AS (
          SELECT 0 AS prio, u.id, lower(u.nickname) AS nkey
          FROM users u
          WHERE u.id = $2
            AND lower(u.nickname) LIKE $1
        )
      `);
      unions.push(`SELECT * FROM self`);
    }

    ctes.push(`
      followees AS (
        SELECT 1 AS prio, u.id, lower(u.nickname) AS nkey
        FROM user_follows f
        JOIN users u ON u.id = f.followee_id
        WHERE f.follower_id = $2
          AND lower(u.nickname) LIKE $1
        ORDER BY lower(u.nickname), u.id
        LIMIT $5
      )
    `);
    unions.push(`SELECT * FROM followees`);

    if (!omitOthers) {
      ctes.push(`
        others AS (
          SELECT 3 AS prio, u.id, lower(u.nickname) AS nkey
          FROM users u
          WHERE lower(u.nickname) LIKE $1
          ORDER BY lower(u.nickname), u.id
          LIMIT $5
        )
      `);
      unions.push(`SELECT * FROM others`);
    }

    const sql = `
      WITH
      ${ctes.join(",\n")},
      candidates AS (
        ${unions.join("\nUNION ALL\n")}
      ),
      dedup AS (
        SELECT DISTINCT ON (id) id, prio, nkey
        FROM candidates
        ORDER BY id, prio
      ),
      page AS (
        SELECT id, prio, nkey
        FROM dedup
        ORDER BY prio, nkey, id
        OFFSET $3
        LIMIT $4
      )
      SELECT
        u.id,
        u.nickname,
        u.is_admin,
        u.block_strangers,
        u.snippet,
        u.avatar,
        u.ai_model,
        id_to_timestamp(u.id) AS created_at,
        u.updated_at,
        COALESCE(uc.follower_count, 0) AS count_followers,
        COALESCE(uc.followee_count, 0) AS count_followees,
        COALESCE(uc.post_count, 0) AS count_posts
      FROM page p
      JOIN users u ON u.id = p.id
      LEFT JOIN user_counts uc ON uc.user_id = u.id
      ORDER BY p.prio, p.nkey, u.id
    `.trim();

    const params = [likePattern, hexToDec(focusUserId), offset, limit, k];
    const res = await pgQuery(this.pgPool, sql, params);

    return res.rows.map((row: Record<string, unknown>) => {
      row.id = decToHex(row.id as string);
      return snakeToCamel<User>(row);
    });
  }
}
