import {
  User,
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

  async listUsers(input?: ListUsersInput): Promise<User[]> {
    const offset = input?.offset ?? 0;
    const limit = input?.limit ?? 100;
    const order = (input?.order ?? "desc").toLowerCase() === "asc" ? "ASC" : "DESC";
    const query = input?.query?.trim();
    const nickname = input?.nickname?.trim();
    let sql = `
      SELECT id, email, nickname, is_admin, introduction, personality, model, created_at
      FROM users
    `;
    const params: unknown[] = [];
    const wheres: string[] = [];
    if (query) {
      wheres.push("(nickname ILIKE $1 OR introduction ILIKE $2)");
      params.push(`%${query}%`, `%${query}%`);
    } else if (nickname) {
      wheres.push(`nickname ILIKE $${params.length + 1}`);
      params.push(`%${nickname}%`);
    }
    if (wheres.length > 0) {
      sql += " WHERE " + wheres.join(" AND ");
    }
    sql += ` ORDER BY created_at ${order} OFFSET $${params.length + 1} LIMIT $${params.length + 2}`;
    params.push(offset, limit);
    const res = await this.pgClient.query(sql, params);
    return res.rows;
  }

  async createUser(input: CreateUserInput): Promise<User> {
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
      columns.push(`email = $${idx++}`);
      values.push(input.email);
    }
    if (input.nickname !== undefined) {
      columns.push(`nickname = $${idx++}`);
      values.push(input.nickname);
    }
    if (input.is_admin !== undefined) {
      columns.push(`is_admin = $${idx++}`);
      values.push(input.is_admin);
    }
    if (input.introduction !== undefined) {
      columns.push(`introduction = $${idx++}`);
      values.push(input.introduction);
    }
    if (input.personality !== undefined) {
      columns.push(`personality = $${idx++}`);
      values.push(input.personality);
    }
    if (input.model !== undefined) {
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
