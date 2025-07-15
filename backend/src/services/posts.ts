import {
  Post,
  PostDetail,
  CountPostsInput,
  CreatePostInput,
  UpdatePostInput,
  ListPostsInput,
  ListPostsByFolloweesDetailInput,
  ListPostsLikedByUserDetailInput,
} from "../models/post";
import { Client } from "pg";
import { v4 as uuidv4 } from "uuid";

export async function countPosts(pgClient: Client, input?: CountPostsInput): Promise<number> {
  const { query, user, tag, reply_to } = input || {};
  let sql = `SELECT COUNT(*) FROM posts p`;
  const where: string[] = [];
  const params: unknown[] = [];
  let idx = 1;
  if (tag) {
    sql += ` JOIN post_tags pt ON pt.post_id = p.id`;
    where.push(`pt.name = $${idx++}`);
    params.push(tag);
  }
  if (user) {
    where.push(`p.owned_by = $${idx++}`);
    params.push(user);
  }
  if (reply_to !== undefined) {
    where.push(`p.reply_to ${reply_to === null ? "IS NULL" : `= $${idx++}`}`);
    if (reply_to !== null) params.push(reply_to);
  }
  if (query) {
    where.push(`(p.title ILIKE $${idx} OR p.body ILIKE $${idx + 1})`);
    params.push(`%${query}%`, `%${query}%`);
    idx += 2;
  }
  if (where.length > 0) {
    sql += " WHERE " + where.join(" AND ");
  }
  const res = await pgClient.query(sql, params);
  return Number(res.rows[0].count);
}

export async function getPost(id: string, pgClient: Client): Promise<Post | null> {
  const res = await pgClient.query(
    `SELECT id, title, body, owned_by, reply_to, created_at FROM posts WHERE id = $1`,
    [id],
  );
  return res.rows[0] || null;
}

export async function getPostDetail(id: string, pgClient: Client): Promise<PostDetail | null> {
  const res = await pgClient.query(
    `
    SELECT
      p.id,
      p.title,
      p.body,
      p.owned_by,
      p.reply_to,
      p.created_at,
      u.nickname AS owner_nickname,
      (SELECT COUNT(*) FROM posts WHERE reply_to = p.id) AS reply_count,
      (SELECT COUNT(*) FROM post_likes WHERE post_id = p.id) AS like_count,
      ARRAY(
        SELECT pt.name FROM post_tags pt WHERE pt.post_id = p.id ORDER BY pt.name
      ) AS tags
    FROM posts p
    JOIN users u ON p.owned_by = u.id
    WHERE p.id = $1
    `,
    [id],
  );
  if (res.rows.length === 0) return null;
  return res.rows[0];
}

export async function listPosts(pgClient: Client, options?: ListPostsInput): Promise<Post[]> {
  const offset = options?.offset ?? 0;
  const limit = options?.limit ?? 100;
  const order = (options?.order ?? "desc").toLowerCase() === "asc" ? "ASC" : "DESC";
  const q = options?.query?.trim();
  const user = options?.user;
  const tag = options?.tag;
  const reply_to = options?.reply_to;
  let sql = `
    SELECT p.id, p.title, p.body, p.owned_by, p.reply_to, p.created_at
    FROM posts p
  `;
  const where: string[] = [];
  const params: unknown[] = [];
  let paramIdx = 1;
  if (tag) {
    sql += ` JOIN post_tags pt ON pt.post_id = p.id`;
    where.push(`pt.name = $${paramIdx++}`);
    params.push(tag);
  }
  if (user) {
    where.push(`p.owned_by = $${paramIdx++}`);
    params.push(user);
  }
  if (reply_to !== undefined) {
    where.push(`p.reply_to ${reply_to === null ? "IS NULL" : `= $${paramIdx++}`}`);
    if (reply_to !== null) params.push(reply_to);
  }
  if (q) {
    where.push(`(p.title ILIKE $${paramIdx} OR p.body ILIKE $${paramIdx + 1})`);
    params.push(`%${q}%`, `%${q}%`);
    paramIdx += 2;
  }
  if (where.length > 0) {
    sql += " WHERE " + where.join(" AND ");
  }
  sql += ` ORDER BY p.created_at ${order} OFFSET $${paramIdx++} LIMIT $${paramIdx++}`;
  params.push(offset, limit);
  const res = await pgClient.query(sql, params);
  return res.rows;
}

export async function listPostsDetail(
  pgClient: Client,
  options?: ListPostsInput,
): Promise<PostDetail[]> {
  const offset = options?.offset ?? 0;
  const limit = options?.limit ?? 100;
  const order = (options?.order ?? "desc").toLowerCase() === "asc" ? "ASC" : "DESC";
  const q = options?.query?.trim();
  const user = options?.user;
  const tag = options?.tag;
  const reply_to = options?.reply_to;
  let sql = `
    SELECT
      p.id,
      p.title,
      p.body,
      p.owned_by,
      p.reply_to,
      p.created_at,
      u.nickname AS owner_nickname,
      (SELECT COUNT(*) FROM posts WHERE reply_to = p.id) AS reply_count,
      (SELECT COUNT(*) FROM post_likes WHERE post_id = p.id) AS like_count,
      ARRAY(
        SELECT pt2.name FROM post_tags pt2 WHERE pt2.post_id = p.id ORDER BY pt2.name
      ) AS tags
    FROM posts p
    JOIN users u ON p.owned_by = u.id
  `;
  const where: string[] = [];
  const params: unknown[] = [];
  let paramIdx = 1;
  if (tag) {
    sql += ` JOIN post_tags pt ON pt.post_id = p.id`;
    where.push(`pt.name = $${paramIdx++}`);
    params.push(tag);
  }
  if (user) {
    where.push(`p.owned_by = $${paramIdx++}`);
    params.push(user);
  }
  if (reply_to !== undefined) {
    where.push(`p.reply_to ${reply_to === null ? "IS NULL" : `= $${paramIdx++}`}`);
    if (reply_to !== null) params.push(reply_to);
  }
  if (q) {
    where.push(`(p.title ILIKE $${paramIdx} OR p.body ILIKE $${paramIdx + 1})`);
    params.push(`%${q}%`, `%${q}%`);
    paramIdx += 2;
  }
  if (where.length > 0) {
    sql += " WHERE " + where.join(" AND ");
  }
  sql += ` ORDER BY p.created_at ${order} OFFSET $${paramIdx++} LIMIT $${paramIdx++}`;
  params.push(offset, limit);
  const res = await pgClient.query(sql, params);
  return res.rows;
}

export async function createPost(input: CreatePostInput, pgClient: Client): Promise<Post> {
  const id = uuidv4();
  const res = await pgClient.query(
    `INSERT INTO posts (id, title, body, owned_by, reply_to, created_at)
     VALUES ($1, $2, $3, $4, $5, now())
     RETURNING id, title, body, owned_by, reply_to, created_at`,
    [id, input.title, input.body, input.owned_by, input.reply_to ?? null],
  );
  return res.rows[0];
}

export async function updatePost(input: UpdatePostInput, pgClient: Client): Promise<Post | null> {
  const columns: string[] = [];
  const values: unknown[] = [];
  let idx = 1;
  if (input.title !== undefined) {
    columns.push(`title = $${idx++}`);
    values.push(input.title);
  }
  if (input.body !== undefined) {
    columns.push(`body = $${idx++}`);
    values.push(input.body);
  }
  if (input.reply_to !== undefined) {
    columns.push(`reply_to = $${idx++}`);
    values.push(input.reply_to);
  }
  if (columns.length === 0) return getPost(input.id, pgClient);
  values.push(input.id);
  const sql = `UPDATE posts SET ${columns.join(", ")} WHERE id = $${idx} RETURNING id, title, body, owned_by, reply_to, created_at`;
  const res = await pgClient.query(sql, values);
  return res.rows[0] || null;
}

export async function deletePost(id: string, pgClient: Client): Promise<boolean> {
  const res = await pgClient.query(`DELETE FROM posts WHERE id = $1`, [id]);
  return (res.rowCount ?? 0) > 0;
}

export async function addLike(
  post_id: string,
  user_id: string,
  pgClient: Client,
): Promise<boolean> {
  await pgClient.query(
    `INSERT INTO post_likes (post_id, liked_by, created_at) VALUES ($1, $2, $3)`,
    [post_id, user_id, new Date().toISOString()],
  );
  return true;
}

export async function removeLike(
  postId: string,
  userId: string,
  pgClient: Client,
): Promise<boolean> {
  const res = await pgClient.query(`DELETE FROM post_likes WHERE post_id = $1 AND liked_by = $2`, [
    postId,
    userId,
  ]);
  return (res.rowCount ?? 0) > 0;
}

export async function listPostsByFolloweesDetail(
  pgClient: Client,
  input: ListPostsByFolloweesDetailInput,
): Promise<PostDetail[]> {
  const { user_id, include_self = false, offset = 0, limit = 100, order = "desc" } = input;
  let followeeSql = `
    SELECT followee_id FROM user_follows WHERE follower_id = $1
    ${include_self ? "UNION SELECT $1" : ""}
  `;
  const sql = `
    SELECT
      p.id, p.title, p.body, p.owned_by, p.reply_to, p.created_at,
      u.nickname AS owner_nickname,
      (SELECT COUNT(*) FROM posts WHERE reply_to = p.id) AS reply_count,
      (SELECT COUNT(*) FROM post_likes WHERE post_id = p.id) AS like_count,
      ARRAY(
        SELECT pt2.name FROM post_tags pt2 WHERE pt2.post_id = p.id ORDER BY pt2.name
      ) AS tags
    FROM posts p
    JOIN users u ON p.owned_by = u.id
    WHERE p.owned_by IN (${followeeSql})
    ORDER BY p.created_at ${order}
    OFFSET $2 LIMIT $3
  `;
  const params = [user_id, offset, limit];
  const res = await pgClient.query(sql, params);
  return res.rows;
}

export async function listPostsLikedByUserDetail(
  pgClient: Client,
  input: ListPostsLikedByUserDetailInput,
): Promise<PostDetail[]> {
  const offset = input.offset ?? 0;
  const limit = input.limit ?? 100;
  const order = (input.order ?? "desc").toLowerCase() === "asc" ? "ASC" : "DESC";
  const sql = `
    SELECT
      p.id,
      p.title,
      p.body,
      p.owned_by,
      p.reply_to,
      p.created_at,
      u.nickname AS owner_nickname,
      (SELECT COUNT(*) FROM posts WHERE reply_to = p.id) AS reply_count,
      (SELECT COUNT(*) FROM post_likes WHERE post_id = p.id) AS like_count,
      ARRAY(
        SELECT pt.name FROM post_tags pt WHERE pt.post_id = p.id ORDER BY pt.name
      ) AS tags
    FROM post_likes pl
    JOIN posts p ON pl.post_id = p.id
    JOIN users u ON p.owned_by = u.id
    WHERE pl.liked_by = $1
    ORDER BY p.created_at ${order}
    OFFSET $2 LIMIT $3
  `;
  const res = await pgClient.query(sql, [input.user_id, offset, limit]);
  return res.rows;
}
