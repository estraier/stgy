import {
  User,
  UserDetail,
  CountUsersInput,
  CreateUserInput,
  UpdateUserInput,
  UpdatePasswordInput,
  ListUsersInput,
  ListFolloweesInput,
  ListFollowersInput,
  AddFollowerInput,
  RemoveFollowerInput,
} from "../models/user";
import { generateVerificationCode, validateEmail, snakeToCamel } from "../utils/format";
import { Client } from "pg";
import Redis from "ioredis";
import { v4 as uuidv4 } from "uuid";
import crypto from "crypto";

const UPDATE_EMAIL_MAIL_QUEUE = "update_email_queue";
const RESET_PASSWORD_MAIL_QUEUE = "reset_password_mail_queue";

export class UsersService {
  private pgClient: Client;
  private redis: Redis;

  constructor(pgClient: Client, redis: Redis) {
    this.pgClient = pgClient;
    this.redis = redis;
  }

  async countUsers(input?: CountUsersInput): Promise<number> {
    const nickname = input?.nickname?.trim();
    const query = input?.query?.trim();
    let sql = `SELECT COUNT(*) FROM users`;
    const params: unknown[] = [];
    let where = "";
    if (nickname) {
      where = "WHERE nickname ILIKE $1";
      params.push(`%${nickname}%`);
    } else if (query) {
      where = "WHERE nickname ILIKE $1 OR introduction ILIKE $2";
      params.push(`%${query}%`, `%${query}%`);
    }
    sql += ` ${where}`;
    const res = await this.pgClient.query(sql, params);
    return Number(res.rows[0].count);
  }

  async getUser(id: string): Promise<User | null> {
    const res = await this.pgClient.query(
      `SELECT id, email, nickname, is_admin, introduction, ai_model, ai_personality, created_at FROM users WHERE id = $1`,
      [id],
    );
    if (!res.rows[0]) return null;
    return snakeToCamel<User>(res.rows[0]);
  }

  async getUserDetail(id: string, focusUserId?: string): Promise<UserDetail | null> {
    const userRes = await this.pgClient.query(
      `SELECT id, email, nickname, is_admin, introduction, ai_model, ai_personality, created_at
       FROM users WHERE id = $1`,
      [id],
    );
    if (userRes.rows.length === 0) return null;
    const user: Record<string, unknown> = snakeToCamel(userRes.rows[0]);
    const [followersRes, followeesRes] = await Promise.all([
      this.pgClient.query(`SELECT COUNT(*)::int AS cnt FROM user_follows WHERE followee_id = $1`, [
        id,
      ]),
      this.pgClient.query(`SELECT COUNT(*)::int AS cnt FROM user_follows WHERE follower_id = $1`, [
        id,
      ]),
    ]);
    user.countFollowers = followersRes.rows[0].cnt;
    user.countFollowees = followeesRes.rows[0].cnt;
    if (focusUserId && focusUserId !== id) {
      const followRes = await this.pgClient.query(
        `SELECT
           EXISTS (SELECT 1 FROM user_follows WHERE follower_id = $1 AND followee_id = $2) AS is_followed_by_focus_user,
           EXISTS (SELECT 1 FROM user_follows WHERE follower_id = $2 AND followee_id = $1) AS is_following_focus_user
         `,
        [focusUserId, id],
      );
      user.isFollowedByFocusUser = followRes.rows[0].is_followed_by_focus_user;
      user.isFollowingFocusUser = followRes.rows[0].is_following_focus_user;
    }
    return user as UserDetail;
  }

  async listUsers(input?: ListUsersInput, focusUserId?: string): Promise<User[]> {
    const offset = input?.offset ?? 0;
    const limit = input?.limit ?? 100;
    const order = input?.order ?? "desc";
    const query = input?.query?.trim();
    const nickname = input?.nickname?.trim();
    let baseSelect = `
      SELECT u.id, u.email, u.nickname, u.is_admin, u.introduction, u.ai_model, u.ai_personality, u.created_at
      FROM users u
    `;
    const params: unknown[] = [];
    const wheres: string[] = [];
    if (query) {
      wheres.push("(u.nickname ILIKE $1 OR u.introduction ILIKE $2)");
      params.push(`%${query}%`, `%${query}%`);
    } else if (nickname) {
      wheres.push(`u.nickname ILIKE $${params.length + 1}`);
      params.push(`%${nickname}%`);
    }
    let orderClause = "";
    if (order === "social" && focusUserId) {
      baseSelect += `
        LEFT JOIN user_follows f1 ON f1.follower_id = $${params.length + 1} AND f1.followee_id = u.id
        LEFT JOIN user_follows f2 ON f2.follower_id = u.id AND f2.followee_id = $${params.length + 1}
      `;
      params.push(focusUserId);
      orderClause =
        `ORDER BY (u.id = $${params.length + 1}) DESC, ` +
        `(f1.follower_id IS NOT NULL) DESC, ` +
        `(f2.follower_id IS NOT NULL) DESC, ` +
        `u.created_at ASC, u.id ASC`;
      params.push(focusUserId); // ORDER BY用
    } else {
      const dir = order.toLowerCase() === "asc" ? "ASC" : "DESC";
      orderClause = `ORDER BY u.created_at ${dir}, u.id ${dir}`;
    }
    let sql = baseSelect;
    if (wheres.length > 0) {
      sql += " WHERE " + wheres.join(" AND ");
    }
    sql += ` ${orderClause} OFFSET $${params.length + 1} LIMIT $${params.length + 2}`;
    params.push(offset, limit);
    const res = await this.pgClient.query(sql, params);
    return res.rows.map((row: Record<string, unknown>) => snakeToCamel<User>(row));
  }

  async listUsersDetail(input?: ListUsersInput, focusUserId?: string): Promise<UserDetail[]> {
    const users = await this.listUsers(input, focusUserId);
    if (users.length === 0) return [];
    const ids = users.map((u) => u.id);
    const followersRes = await this.pgClient.query(
      `SELECT followee_id AS id, COUNT(*)::int AS cnt
         FROM user_follows WHERE followee_id = ANY($1)
         GROUP BY followee_id`,
      [ids],
    );
    const followeesRes = await this.pgClient.query(
      `SELECT follower_id AS id, COUNT(*)::int AS cnt
         FROM user_follows WHERE follower_id = ANY($1)
         GROUP BY follower_id`,
      [ids],
    );
    const followersMap = Object.fromEntries(
      followersRes.rows.map((r: { id: string; cnt: number }) => [r.id, r.cnt]),
    );
    const followeesMap = Object.fromEntries(
      followeesRes.rows.map((r: { id: string; cnt: number }) => [r.id, r.cnt]),
    );
    let followsMap: Record<
      string,
      { isFollowedByFocusUser: boolean; isFollowingFocusUser: boolean }
    > = {};
    if (focusUserId) {
      const fwRes = await this.pgClient.query(
        `SELECT followee_id FROM user_follows WHERE follower_id = $1 AND followee_id = ANY($2)`,
        [focusUserId, ids],
      );
      const followedSet = new Set(fwRes.rows.map((r: { followee_id: string }) => r.followee_id));
      const fgRes = await this.pgClient.query(
        `SELECT follower_id FROM user_follows WHERE follower_id = ANY($1) AND followee_id = $2`,
        [ids, focusUserId],
      );
      const followingSet = new Set(fgRes.rows.map((r: { follower_id: string }) => r.follower_id));
      for (const id of ids) {
        followsMap[id] = {
          isFollowedByFocusUser: followedSet.has(id),
          isFollowingFocusUser: followingSet.has(id),
        };
      }
    }
    return users.map((u) => ({
      ...u,
      countFollowers: followersMap[u.id] ?? 0,
      countFollowees: followeesMap[u.id] ?? 0,
      ...(followsMap[u.id] || {}),
    }));
  }

  async createUser(input: CreateUserInput): Promise<User> {
    if (typeof input.email !== "string" || input.email.trim() === "") {
      throw new Error("email is required");
    }
    if (typeof input.nickname !== "string" || input.nickname.trim() === "") {
      throw new Error("nickname is required");
    }
    if (typeof input.password !== "string" || input.password.trim() === "") {
      throw new Error("password is required");
    }
    if (typeof input.introduction !== "string") {
      throw new Error("introduction is required");
    }
    const id = uuidv4();
    const passwordHash = crypto.createHash("md5").update(input.password).digest("hex");
    const res = await this.pgClient.query(
      `INSERT INTO users (id, email, nickname, password, is_admin, introduction, ai_model, ai_personality, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, now())
       RETURNING id, email, nickname, is_admin, introduction, ai_model, ai_personality, created_at`,
      [
        id,
        input.email,
        input.nickname,
        passwordHash,
        input.isAdmin,
        input.introduction,
        input.aiModel,
        input.aiPersonality,
      ],
    );
    return snakeToCamel<User>(res.rows[0]);
  }

  async updateUser(input: UpdateUserInput): Promise<User | null> {
    const columns: string[] = [];
    const values: unknown[] = [];
    let idx = 1;
    if (input.email !== undefined) {
      if (!input.email || input.email.trim() === "") {
        throw new Error("email is required");
      }
      columns.push(`email = $${idx++}`);
      values.push(input.email);
    }
    if (input.nickname !== undefined) {
      if (!input.nickname || input.nickname.trim() === "") {
        throw new Error("nickname is required");
      }
      columns.push(`nickname = $${idx++}`);
      values.push(input.nickname);
    }
    if (input.isAdmin !== undefined) {
      columns.push(`is_admin = $${idx++}`);
      values.push(input.isAdmin);
    }
    if (input.introduction !== undefined) {
      if (typeof input.introduction !== "string") {
        throw new Error("introduction is required");
      }
      columns.push(`introduction = $${idx++}`);
      values.push(input.introduction);
    }
    if (input.aiModel !== undefined) {
      columns.push(`ai_model = $${idx++}`);
      values.push(input.aiModel);
    }
    if (input.aiPersonality !== undefined) {
      columns.push(`ai_personality = $${idx++}`);
      values.push(input.aiPersonality);
    }
    if (columns.length === 0) return this.getUser(input.id);
    values.push(input.id);
    const sql = `UPDATE users SET ${columns.join(", ")} WHERE id = $${idx} RETURNING id, email, nickname, is_admin, introduction, ai_model, ai_personality, created_at`;
    const res = await this.pgClient.query(sql, values);
    return res.rows[0] ? snakeToCamel<User>(res.rows[0]) : null;
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
    console.log("email enqueue", userId, newEmail, verificationCode);
    await this.redis.lpush(UPDATE_EMAIL_MAIL_QUEUE, JSON.stringify({ newEmail, verificationCode }));
    return { updateEmailId };
  }

  async verifyUpdateEmail(userId: string, updateEmailId: string, code: string): Promise<boolean> {
    const key = `updateEmail:${updateEmailId}`;
    const data = await this.redis.hgetall(key);
    if (!data || !data.userId || !data.newEmail || !data.verificationCode)
      throw new Error("Update email info not found or expired.");
    if (data.userId !== userId) throw new Error("Session/user mismatch");
    if (data.verificationCode !== code) throw new Error("Verification code mismatch.");
    const exists = await this.pgClient.query(`SELECT 1 FROM users WHERE email = $1`, [
      data.newEmail,
    ]);
    if (exists.rows.length > 0) throw new Error("Email already in use.");
    const res = await this.pgClient.query(`UPDATE users SET email = $1 WHERE id = $2`, [
      data.newEmail,
      data.userId,
    ]);
    await this.redis.del(key);
    return (res.rowCount ?? 0) > 0;
  }

  async updateUserPassword(input: UpdatePasswordInput): Promise<boolean> {
    if (input.password.trim() === "") {
      throw new Error("password is mustn't be empty");
    }
    const passwordHash = crypto.createHash("md5").update(input.password).digest("hex");
    const res = await this.pgClient.query(`UPDATE users SET password = $1 WHERE id = $2`, [
      passwordHash,
      input.id,
    ]);
    return (res.rowCount ?? 0) > 0;
  }

  async startResetPassword(email: string): Promise<{ resetPasswordId: string; webCode: string }> {
    const res = await this.pgClient.query(`SELECT id FROM users WHERE email = $1`, [email]);
    if (!res.rows[0] || !res.rows[0].id) throw new Error("User not found");
    const userId: string = res.rows[0].id;
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
    console.log("pass enqueue", userId, email, webCode, mailCode);
    await this.redis.lpush(
      RESET_PASSWORD_MAIL_QUEUE,
      JSON.stringify({ email, mailCode, resetPasswordId }),
    );
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
  ): Promise<boolean> {
    const key = `resetPassword:${resetPasswordId}`;
    const data = await this.redis.hgetall(key);
    if (!data || !data.userId || !data.email || !data.webCode || !mailCode)
      throw new Error("Reset session not found or expired");
    if (data.email !== email) throw new Error("Session/user mismatch");
    if (data.webCode !== webCode) throw new Error("Web verification code mismatch");
    if (data.mailCode !== mailCode) throw new Error("Mail verification code mismatch");
    if (!newPassword || newPassword.trim().length < 6)
      throw new Error("Password must be at least 6 characters");
    const passwordHash = crypto.createHash("md5").update(newPassword).digest("hex");
    const res = await this.pgClient.query(`UPDATE users SET password = $1 WHERE id = $2`, [
      passwordHash,
      data.userId,
    ]);
    await this.redis.del(key);
    return (res.rowCount ?? 0) > 0;
  }

  async deleteUser(id: string): Promise<boolean> {
    const res = await this.pgClient.query(`DELETE FROM users WHERE id = $1`, [id]);
    return (res.rowCount ?? 0) > 0;
  }

  async listFolloweesDetail(
    input: ListFolloweesInput,
    focusUserId?: string,
  ): Promise<UserDetail[]> {
    const offset = input.offset ?? 0;
    const limit = input.limit ?? 100;
    const order = (input.order ?? "desc").toLowerCase() === "asc" ? "ASC" : "DESC";
    const sql = `
      SELECT u.id, u.email, u.nickname, u.is_admin, u.introduction, u.ai_model, u.ai_personality, u.created_at
      FROM user_follows f
      JOIN users u ON f.followee_id = u.id
      WHERE f.follower_id = $1
      ORDER BY u.created_at ${order}, u.id ${order}
      OFFSET $2 LIMIT $3
    `;
    const res = await this.pgClient.query(sql, [input.followerId, offset, limit]);
    const users = res.rows.map((row: Record<string, unknown>) => snakeToCamel<User>(row));
    if (users.length === 0) return [];
    const ids = users.map((u) => u.id);
    const followersRes = await this.pgClient.query(
      `SELECT followee_id AS id, COUNT(*)::int AS cnt
         FROM user_follows WHERE followee_id = ANY($1)
         GROUP BY followee_id`,
      [ids],
    );
    const followeesRes = await this.pgClient.query(
      `SELECT follower_id AS id, COUNT(*)::int AS cnt
         FROM user_follows WHERE follower_id = ANY($1)
         GROUP BY follower_id`,
      [ids],
    );
    const followersMap = Object.fromEntries(
      followersRes.rows.map((r: { id: string; cnt: number }) => [r.id, r.cnt]),
    );
    const followeesMap = Object.fromEntries(
      followeesRes.rows.map((r: { id: string; cnt: number }) => [r.id, r.cnt]),
    );
    let followsMap: Record<
      string,
      { isFollowedByFocusUser: boolean; isFollowingFocusUser: boolean }
    > = {};
    if (focusUserId) {
      const fwRes = await this.pgClient.query(
        `SELECT followee_id FROM user_follows WHERE follower_id = $1 AND followee_id = ANY($2)`,
        [focusUserId, ids],
      );
      const followedSet = new Set(fwRes.rows.map((r: { followee_id: string }) => r.followee_id));
      const fgRes = await this.pgClient.query(
        `SELECT follower_id FROM user_follows WHERE follower_id = ANY($1) AND followee_id = $2`,
        [ids, focusUserId],
      );
      const followingSet = new Set(fgRes.rows.map((r: { follower_id: string }) => r.follower_id));
      for (const id of ids) {
        followsMap[id] = {
          isFollowedByFocusUser: followedSet.has(id),
          isFollowingFocusUser: followingSet.has(id),
        };
      }
    }
    return users.map((u) => ({
      ...u,
      countFollowers: followersMap[u.id] ?? 0,
      countFollowees: followeesMap[u.id] ?? 0,
      ...(followsMap[u.id] || {}),
    }));
  }

  async listFollowersDetail(
    input: ListFollowersInput,
    focusUserId?: string,
  ): Promise<UserDetail[]> {
    const offset = input.offset ?? 0;
    const limit = input.limit ?? 100;
    const order = (input.order ?? "desc").toLowerCase() === "asc" ? "ASC" : "DESC";
    const sql = `
      SELECT u.id, u.email, u.nickname, u.is_admin, u.introduction, u.ai_model, u.ai_personality, u.created_at
      FROM user_follows f
      JOIN users u ON f.follower_id = u.id
      WHERE f.followee_id = $1
      ORDER BY u.created_at ${order}, u.id ${order}
      OFFSET $2 LIMIT $3
    `;
    const res = await this.pgClient.query(sql, [input.followeeId, offset, limit]);
    const users = res.rows.map((row: Record<string, unknown>) => snakeToCamel<User>(row));
    if (users.length === 0) return [];
    const ids = users.map((u) => u.id);
    const followersRes = await this.pgClient.query(
      `SELECT followee_id AS id, COUNT(*)::int AS cnt
         FROM user_follows WHERE followee_id = ANY($1)
         GROUP BY followee_id`,
      [ids],
    );
    const followeesRes = await this.pgClient.query(
      `SELECT follower_id AS id, COUNT(*)::int AS cnt
         FROM user_follows WHERE follower_id = ANY($1)
         GROUP BY follower_id`,
      [ids],
    );
    const followersMap = Object.fromEntries(
      followersRes.rows.map((r: { id: string; cnt: number }) => [r.id, r.cnt]),
    );
    const followeesMap = Object.fromEntries(
      followeesRes.rows.map((r: { id: string; cnt: number }) => [r.id, r.cnt]),
    );
    let followsMap: Record<
      string,
      { isFollowedByFocusUser: boolean; isFollowingFocusUser: boolean }
    > = {};
    if (focusUserId) {
      const fwRes = await this.pgClient.query(
        `SELECT followee_id FROM user_follows WHERE follower_id = $1 AND followee_id = ANY($2)`,
        [focusUserId, ids],
      );
      const followedSet = new Set(fwRes.rows.map((r: { followee_id: string }) => r.followee_id));
      const fgRes = await this.pgClient.query(
        `SELECT follower_id FROM user_follows WHERE follower_id = ANY($1) AND followee_id = $2`,
        [ids, focusUserId],
      );
      const followingSet = new Set(fgRes.rows.map((r: { follower_id: string }) => r.follower_id));
      for (const id of ids) {
        followsMap[id] = {
          isFollowedByFocusUser: followedSet.has(id),
          isFollowingFocusUser: followingSet.has(id),
        };
      }
    }
    return users.map((u) => ({
      ...u,
      countFollowers: followersMap[u.id] ?? 0,
      countFollowees: followeesMap[u.id] ?? 0,
      ...(followsMap[u.id] || {}),
    }));
  }

  async addFollower(input: AddFollowerInput): Promise<boolean> {
    await this.pgClient.query(
      `INSERT INTO user_follows (follower_id, followee_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
      [input.followerId, input.followeeId],
    );
    return true;
  }

  async removeFollower(input: RemoveFollowerInput): Promise<boolean> {
    const res = await this.pgClient.query(
      `DELETE FROM user_follows WHERE follower_id = $1 AND followee_id = $2`,
      [input.followerId, input.followeeId],
    );
    return (res.rowCount ?? 0) > 0;
  }
}
