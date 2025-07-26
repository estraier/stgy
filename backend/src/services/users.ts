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
import { Client } from "pg";
import { v4 as uuidv4 } from "uuid";
import crypto from "crypto";

export class UsersService {
  private pgClient: Client;

  constructor(pgClient: Client) {
    this.pgClient = pgClient;
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
      `SELECT id, email, nickname, is_admin, introduction, personality, model, created_at FROM users WHERE id = $1`,
      [id],
    );
    return res.rows[0] || null;
  }

  async getUserDetail(id: string, focus_user_id?: string): Promise<UserDetail | null> {
    const userRes = await this.pgClient.query(
      `SELECT id, email, nickname, is_admin, introduction, personality, model, created_at
       FROM users WHERE id = $1`,
      [id],
    );
    if (userRes.rows.length === 0) return null;
    const user: UserDetail = userRes.rows[0];
    const [followersRes, followeesRes] = await Promise.all([
      this.pgClient.query(`SELECT COUNT(*)::int AS cnt FROM user_follows WHERE followee_id = $1`, [
        id,
      ]),
      this.pgClient.query(`SELECT COUNT(*)::int AS cnt FROM user_follows WHERE follower_id = $1`, [
        id,
      ]),
    ]);
    user.count_followers = followersRes.rows[0].cnt;
    user.count_followees = followeesRes.rows[0].cnt;
    if (focus_user_id && focus_user_id !== id) {
      const followRes = await this.pgClient.query(
        `SELECT
           EXISTS (SELECT 1 FROM user_follows WHERE follower_id = $1 AND followee_id = $2) AS is_followed_by_focus_user,
           EXISTS (SELECT 1 FROM user_follows WHERE follower_id = $2 AND followee_id = $1) AS is_following_focus_user
         `,
        [focus_user_id, id],
      );
      user.is_followed_by_focus_user = followRes.rows[0].is_followed_by_focus_user;
      user.is_following_focus_user = followRes.rows[0].is_following_focus_user;
    }
    return user;
  }

  async listUsers(input?: ListUsersInput, focus_user_id?: string): Promise<User[]> {
    const offset = input?.offset ?? 0;
    const limit = input?.limit ?? 100;
    const order = input?.order ?? "desc";
    const query = input?.query?.trim();
    const nickname = input?.nickname?.trim();
    let baseSelect = `
      SELECT u.id, u.email, u.nickname, u.is_admin, u.introduction, u.personality, u.model, u.created_at
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
    if (order === "social" && focus_user_id) {
      baseSelect += `
        LEFT JOIN user_follows f1 ON f1.follower_id = $${params.length + 1} AND f1.followee_id = u.id
        LEFT JOIN user_follows f2 ON f2.follower_id = u.id AND f2.followee_id = $${params.length + 1}
      `;
      params.push(focus_user_id);
      orderClause =
        `ORDER BY (u.id = $${params.length + 1}) DESC, ` +
        `(f1.follower_id IS NOT NULL) DESC, ` +
        `(f2.follower_id IS NOT NULL) DESC, ` +
        `u.created_at ASC, u.id ASC`;
      params.push(focus_user_id); // ORDER BY用
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
    return res.rows;
  }

  async listUsersDetail(input?: ListUsersInput, focus_user_id?: string): Promise<UserDetail[]> {
    const users = await this.listUsers(input, focus_user_id);
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
    const followersMap = Object.fromEntries(followersRes.rows.map((r) => [r.id, r.cnt]));
    const followeesMap = Object.fromEntries(followeesRes.rows.map((r) => [r.id, r.cnt]));
    let followsMap: Record<
      string,
      { is_followed_by_focus_user: boolean; is_following_focus_user: boolean }
    > = {};
    if (focus_user_id) {
      const fwRes = await this.pgClient.query(
        `SELECT followee_id FROM user_follows WHERE follower_id = $1 AND followee_id = ANY($2)`,
        [focus_user_id, ids],
      );
      const followedSet = new Set(fwRes.rows.map((r) => r.followee_id));
      const fgRes = await this.pgClient.query(
        `SELECT follower_id FROM user_follows WHERE follower_id = ANY($1) AND followee_id = $2`,
        [ids, focus_user_id],
      );
      const followingSet = new Set(fgRes.rows.map((r) => r.follower_id));
      for (const id of ids) {
        followsMap[id] = {
          is_followed_by_focus_user: followedSet.has(id),
          is_following_focus_user: followingSet.has(id),
        };
      }
    }
    return users.map((u) => ({
      ...u,
      count_followers: followersMap[u.id] ?? 0,
      count_followees: followeesMap[u.id] ?? 0,
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
    if (typeof input.personality !== "string") {
      throw new Error("personality is required");
    }
    if (typeof input.model !== "string") {
      throw new Error("model is required");
    }
    const id = uuidv4();
    const passwordHash = crypto.createHash("md5").update(input.password).digest("hex");
    const res = await this.pgClient.query(
      `INSERT INTO users (id, email, nickname, password, is_admin, introduction, personality, model, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, now())
       RETURNING id, email, nickname, is_admin, introduction, personality, model, created_at`,
      [
        id,
        input.email,
        input.nickname,
        passwordHash,
        input.is_admin,
        input.introduction,
        input.personality,
        input.model,
      ],
    );
    return res.rows[0];
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
    if (input.is_admin !== undefined) {
      columns.push(`is_admin = $${idx++}`);
      values.push(input.is_admin);
    }
    if (input.introduction !== undefined) {
      if (typeof input.introduction !== "string") {
        throw new Error("introduction is required");
      }
      columns.push(`introduction = $${idx++}`);
      values.push(input.introduction);
    }
    if (input.personality !== undefined) {
      if (typeof input.personality !== "string") {
        throw new Error("personality is required");
      }
      columns.push(`personality = $${idx++}`);
      values.push(input.personality);
    }
    if (input.model !== undefined) {
      if (typeof input.model !== "string") {
        throw new Error("model is required");
      }
      columns.push(`model = $${idx++}`);
      values.push(input.model);
    }
    if (columns.length === 0) return this.getUser(input.id);
    values.push(input.id);
    const sql = `UPDATE users SET ${columns.join(", ")} WHERE id = $${idx} RETURNING id, email, nickname, is_admin, introduction, personality, model, created_at`;
    const res = await this.pgClient.query(sql, values);
    return res.rows[0] || null;
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

  async deleteUser(id: string): Promise<boolean> {
    const res = await this.pgClient.query(`DELETE FROM users WHERE id = $1`, [id]);
    return (res.rowCount ?? 0) > 0;
  }

  async listFollowees(input: ListFolloweesInput): Promise<User[]> {
    const offset = input.offset ?? 0;
    const limit = input.limit ?? 100;
    const order = (input.order ?? "desc").toLowerCase() === "asc" ? "ASC" : "DESC";
    const sql = `
      SELECT u.id, u.email, u.nickname, u.is_admin, u.introduction, u.personality, u.model, u.created_at
      FROM user_follows f
      JOIN users u ON f.followee_id = u.id
      WHERE f.follower_id = $1
      ORDER BY u.created_at ${order}
      OFFSET $2 LIMIT $3
    `;
    const res = await this.pgClient.query(sql, [input.follower_id, offset, limit]);
    return res.rows;
  }

  async listFollowers(input: ListFollowersInput): Promise<User[]> {
    const offset = input.offset ?? 0;
    const limit = input.limit ?? 100;
    const order = (input.order ?? "desc").toLowerCase() === "asc" ? "ASC" : "DESC";
    const sql = `
      SELECT u.id, u.email, u.nickname, u.is_admin, u.introduction, u.personality, u.model, u.created_at
      FROM user_follows f
      JOIN users u ON f.follower_id = u.id
      WHERE f.followee_id = $1
      ORDER BY u.created_at ${order}
      OFFSET $2 LIMIT $3
    `;
    const res = await this.pgClient.query(sql, [input.followee_id, offset, limit]);
    return res.rows;
  }

  async addFollower(input: AddFollowerInput): Promise<boolean> {
    await this.pgClient.query(
      `INSERT INTO user_follows (follower_id, followee_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
      [input.follower_id, input.followee_id],
    );
    return true;
  }

  async removeFollower(input: RemoveFollowerInput): Promise<boolean> {
    const res = await this.pgClient.query(
      `DELETE FROM user_follows WHERE follower_id = $1 AND followee_id = $2`,
      [input.follower_id, input.followee_id],
    );
    return (res.rowCount ?? 0) > 0;
  }
}
