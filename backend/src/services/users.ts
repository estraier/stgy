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

export async function countUsers(pgClient: Client, input?: CountUsersInput): Promise<number> {
  const query = input?.query?.trim();
  let sql = `SELECT COUNT(*) FROM users`;
  const params: unknown[] = [];
  if (query) {
    sql += " WHERE nickname ILIKE $1 OR introduction ILIKE $2";
    params.push(`%${query}%`, `%${query}%`);
  }
  const res = await pgClient.query(sql, params);
  return Number(res.rows[0].count);
}

export async function getUser(id: string, pgClient: Client): Promise<User | null> {
  const res = await pgClient.query(
    `SELECT id, email, nickname, is_admin, introduction, personality, model, created_at FROM users WHERE id = $1`,
    [id],
  );
  return res.rows[0] || null;
}

export async function listUsers(pgClient: Client, input?: ListUsersInput): Promise<User[]> {
  const offset = input?.offset ?? 0;
  const limit = input?.limit ?? 100;
  const order = (input?.order ?? "desc").toLowerCase() === "asc" ? "ASC" : "DESC";
  const query = input?.query?.trim();
  let sql = `
    SELECT id, email, nickname, is_admin, introduction, personality, model, created_at
    FROM users
  `;
  const params: unknown[] = [];
  let where = "";
  if (query) {
    where = "WHERE nickname ILIKE $1 OR introduction ILIKE $2";
    params.push(`%${query}%`, `%${query}%`);
  }
  sql += ` ${where} ORDER BY created_at ${order} OFFSET $${params.length + 1} LIMIT $${params.length + 2}`;
  params.push(offset, limit);
  const res = await pgClient.query(sql, params);
  return res.rows;
}

export async function createUser(input: CreateUserInput, pgClient: Client): Promise<User> {
  const id = uuidv4();
  const passwordHash = crypto.createHash("md5").update(input.password).digest("hex");
  const res = await pgClient.query(
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

export async function updateUser(input: UpdateUserInput, pgClient: Client): Promise<User | null> {
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
  if (columns.length === 0) return getUser(input.id, pgClient);
  values.push(input.id);
  const sql = `UPDATE users SET ${columns.join(", ")} WHERE id = $${idx} RETURNING id, email, nickname, is_admin, introduction, personality, model, created_at`;
  const res = await pgClient.query(sql, values);
  return res.rows[0] || null;
}

export async function updateUserPassword(
  input: UpdatePasswordInput,
  pgClient: Client,
): Promise<boolean> {
  const passwordHash = crypto.createHash("md5").update(input.password).digest("hex");
  const res = await pgClient.query(`UPDATE users SET password = $1 WHERE id = $2`, [
    passwordHash,
    input.id,
  ]);
  return (res.rowCount ?? 0) > 0;
}

export async function deleteUser(id: string, pgClient: Client): Promise<boolean> {
  const res = await pgClient.query(`DELETE FROM users WHERE id = $1`, [id]);
  return (res.rowCount ?? 0) > 0;
}

export async function listFollowees(pgClient: Client, input: ListFolloweesInput): Promise<User[]> {
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
  const res = await pgClient.query(sql, [input.follower_id, offset, limit]);
  return res.rows;
}

export async function listFollowers(pgClient: Client, input: ListFollowersInput): Promise<User[]> {
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
  const res = await pgClient.query(sql, [input.followee_id, offset, limit]);
  return res.rows;
}

export async function addFollower(input: AddFollowerInput, pgClient: Client): Promise<boolean> {
  await pgClient.query(
    `INSERT INTO user_follows (follower_id, followee_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
    [input.follower_id, input.followee_id],
  );
  return true;
}

export async function removeFollower(
  input: RemoveFollowerInput,
  pgClient: Client,
): Promise<boolean> {
  const res = await pgClient.query(
    `DELETE FROM user_follows WHERE follower_id = $1 AND followee_id = $2`,
    [input.follower_id, input.followee_id],
  );
  return (res.rowCount ?? 0) > 0;
}
