import { Config } from "../config";
import {
  Post,
  PostDetail,
  CountPostsInput,
  CreatePostInput,
  UpdatePostInput,
  ListPostsInput,
  ListPostsByFolloweesDetailInput,
  ListPostsLikedByUserDetailInput,
  ListLikersInput,
} from "../models/post";
import { User } from "../models/user";
import { IdIssueService } from "./idIssue";
import { snakeToCamel } from "../utils/format";
import { Client } from "pg";
import Redis from "ioredis";

export class PostsService {
  private pgClient: Client;
  private redis: Redis;
  private idIssueService: IdIssueService;

  constructor(pgClient: Client, redis: Redis) {
    this.pgClient = pgClient;
    this.redis = redis;
    this.idIssueService = new IdIssueService(Config.ID_ISSUE_WORKER_ID);
  }

  async countPosts(input?: CountPostsInput): Promise<number> {
    const { query, ownedBy, tag, replyTo } = input || {};
    let sql = `SELECT COUNT(*) FROM posts p`;
    const where: string[] = [];
    const params: unknown[] = [];
    let idx = 1;
    if (tag) {
      sql += ` JOIN post_tags pt ON pt.post_id = p.id`;
      where.push(`pt.name = $${idx++}`);
      params.push(tag);
    }
    if (ownedBy) {
      where.push(`p.owned_by = $${idx++}`);
      params.push(ownedBy);
    }
    if (replyTo !== undefined) {
      if (replyTo === null) {
        where.push(`p.reply_to IS NULL`);
      } else if (replyTo === "*") {
        where.push(`p.reply_to IS NOT NULL`);
      } else {
        where.push(`p.reply_to = $${idx++}`);
        params.push(replyTo);
      }
    }
    if (query) {
      where.push(`p.content ILIKE $${idx++}`);
      params.push(`%${query}%`);
    }
    if (where.length > 0) {
      sql += " WHERE " + where.join(" AND ");
    }
    const res = await this.pgClient.query(sql, params);
    return Number(res.rows[0].count);
  }

  async getPost(id: string): Promise<Post | null> {
    const res = await this.pgClient.query(
      `SELECT id, content, owned_by, reply_to, allow_likes, allow_replies, created_at, updated_at FROM posts WHERE id = $1`,
      [id],
    );
    return res.rows[0] ? snakeToCamel<Post>(res.rows[0]) : null;
  }

  async getPostDetail(id: string, focusUserId?: string): Promise<PostDetail | null> {
    const res = await this.pgClient.query(
      `
      SELECT
        p.id,
        p.content,
        p.owned_by,
        p.reply_to,
        p.allow_likes,
        p.allow_replies,
        p.created_at,
        p.updated_at,
        u.nickname AS owner_nickname,
        pu.nickname AS reply_to_owner_nickname,
        p.count_replies AS count_replies,
        p.count_likes AS count_likes,
        ARRAY(
          SELECT pt.name FROM post_tags pt WHERE pt.post_id = p.id ORDER BY pt.name
        ) AS tags
      FROM posts p
      JOIN users u ON p.owned_by = u.id
      LEFT JOIN posts parent_post ON p.reply_to = parent_post.id
      LEFT JOIN users pu ON parent_post.owned_by = pu.id
      WHERE p.id = $1
      `,
      [id],
    );
    if (res.rows.length === 0) return null;
    const detail = snakeToCamel<PostDetail>(res.rows[0]);
    if (focusUserId) {
      const likeRes = await this.pgClient.query(
        "SELECT 1 FROM post_likes WHERE post_id = $1 AND liked_by = $2 LIMIT 1",
        [id, focusUserId],
      );
      detail.isLikedByFocusUser = likeRes.rows.length > 0;
      const replyRes = await this.pgClient.query(
        "SELECT 1 FROM posts WHERE reply_to = $1 AND owned_by = $2 LIMIT 1",
        [id, focusUserId],
      );
      detail.isRepliedByFocusUser = replyRes.rows.length > 0;
    }
    return detail;
  }

  async listPosts(options?: ListPostsInput): Promise<Post[]> {
    const offset = options?.offset ?? 0;
    const limit = options?.limit ?? 100;
    const order = (options?.order ?? "desc").toLowerCase() === "asc" ? "ASC" : "DESC";
    const query = options?.query?.trim();
    const ownedBy = options?.ownedBy;
    const tag = options?.tag;
    const replyTo = options?.replyTo;
    let sql = `
      SELECT p.id, p.content, p.owned_by, p.reply_to, p.allow_likes, p.allow_replies, p.created_at, p.updated_at
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
    if (ownedBy) {
      where.push(`p.owned_by = $${paramIdx++}`);
      params.push(ownedBy);
    }
    if (replyTo !== undefined) {
      if (replyTo === null) {
        where.push(`p.reply_to IS NULL`);
      } else if (replyTo === "*") {
        where.push(`p.reply_to IS NOT NULL`);
      } else {
        where.push(`p.reply_to = $${paramIdx++}`);
        params.push(replyTo);
      }
    }
    if (query) {
      where.push(`p.content ILIKE $${paramIdx++}`);
      params.push(`%${query}%`);
    }
    if (where.length > 0) {
      sql += " WHERE " + where.join(" AND ");
    }
    sql += ` ORDER BY p.id ${order} OFFSET $${paramIdx++} LIMIT $${paramIdx++}`;
    params.push(offset, limit);
    const res = await this.pgClient.query(sql, params);
    return snakeToCamel<Post[]>(res.rows);
  }

  async listPostsDetail(options?: ListPostsInput, focusUserId?: string): Promise<PostDetail[]> {
    const offset = options?.offset ?? 0;
    const limit = options?.limit ?? 100;
    const order = (options?.order ?? "desc").toLowerCase() === "asc" ? "ASC" : "DESC";
    const query = options?.query?.trim();
    const ownedBy = options?.ownedBy;
    const tag = options?.tag;
    const replyTo = options?.replyTo;
    let sql = `
      SELECT
        p.id,
        p.content,
        p.owned_by,
        p.reply_to,
        p.allow_likes,
        p.allow_replies,
        p.created_at,
        p.updated_at,
        u.nickname AS owner_nickname,
        pu.nickname AS reply_to_owner_nickname,
        p.count_replies AS count_replies,
        p.count_likes AS count_likes,
        ARRAY(
          SELECT pt2.name FROM post_tags pt2 WHERE pt2.post_id = p.id ORDER BY pt2.name
        ) AS tags
      FROM posts p
      JOIN users u ON p.owned_by = u.id
      LEFT JOIN posts parent_post ON p.reply_to = parent_post.id
      LEFT JOIN users pu ON parent_post.owned_by = pu.id
    `;
    const where: string[] = [];
    const params: unknown[] = [];
    let paramIdx = 1;
    if (tag) {
      sql += ` JOIN post_tags pt ON pt.post_id = p.id`;
      where.push(`pt.name = $${paramIdx++}`);
      params.push(tag);
    }
    if (ownedBy) {
      where.push(`p.owned_by = $${paramIdx++}`);
      params.push(ownedBy);
    }
    if (replyTo !== undefined) {
      if (replyTo === null) {
        where.push(`p.reply_to IS NULL`);
      } else if (replyTo === "*") {
        where.push(`p.reply_to IS NOT NULL`);
      } else {
        where.push(`p.reply_to = $${paramIdx++}`);
        params.push(replyTo);
      }
    }
    if (query) {
      where.push(`p.content ILIKE $${paramIdx++}`);
      params.push(`%${query}%`);
    }
    if (where.length > 0) {
      sql += " WHERE " + where.join(" AND ");
    }
    sql += ` ORDER BY p.id ${order} OFFSET $${paramIdx++} LIMIT $${paramIdx++}`;
    params.push(offset, limit);
    const res = await this.pgClient.query(sql, params);
    const details = snakeToCamel<PostDetail[]>(res.rows);
    if (!focusUserId || details.length === 0) return details;
    const postIds = details.map((p) => p.id);
    const likeRes = await this.pgClient.query(
      `SELECT post_id FROM post_likes WHERE post_id = ANY($1) AND liked_by = $2`,
      [postIds, focusUserId],
    );
    const likedPostIds = new Set(likeRes.rows.map((r) => r.post_id));
    const replyRes = await this.pgClient.query(
      `SELECT reply_to FROM posts WHERE reply_to = ANY($1) AND owned_by = $2`,
      [postIds, focusUserId],
    );
    const repliedPostIds = new Set(replyRes.rows.map((r) => r.reply_to));
    for (const d of details) {
      d.isLikedByFocusUser = likedPostIds.has(d.id);
      d.isRepliedByFocusUser = repliedPostIds.has(d.id);
    }
    return details;
  }

  async createPost(input: CreatePostInput): Promise<Post> {
    if (typeof input.content !== "string" || input.content.trim() === "") {
      throw new Error("content is required");
    }
    if (typeof input.ownedBy !== "string" || input.ownedBy.trim() === "") {
      throw new Error("ownedBy is required");
    }
    const client = this.pgClient;
    const id = await this.idIssueService.issueId();
    await client.query("BEGIN");
    try {
      if (input.replyTo != null) {
        const chk = await client.query<{ allow_replies: boolean }>(
          `SELECT allow_replies FROM posts WHERE id = $1`,
          [input.replyTo],
        );
        if (chk.rows.length === 0) {
          throw new Error("parent post not found");
        }
        if (!chk.rows[0].allow_replies) {
          throw new Error("replies are not allowed for the target post");
        }
      }
      const res = await client.query(
        `INSERT INTO posts (id, content, owned_by, reply_to, allow_likes, allow_replies, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, now(), NULL)
         RETURNING id, content, owned_by, reply_to, allow_likes, allow_replies, created_at, updated_at`,
        [id, input.content, input.ownedBy, input.replyTo, input.allowLikes, input.allowReplies],
      );
      if (input.tags && input.tags.length > 0) {
        await client.query(
          `INSERT INTO post_tags (post_id, name) VALUES ${input.tags
            .map((_, i) => `($1, $${i + 2})`)
            .join(", ")}`,
          [id, ...input.tags],
        );
      }
      await client.query("COMMIT");
      return snakeToCamel<Post>(res.rows[0]);
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    }
  }

  async updatePost(input: UpdatePostInput): Promise<Post | null> {
    const client = this.pgClient;
    await client.query("BEGIN");
    try {
      if (input.replyTo != null && input.replyTo !== undefined) {
        const chk = await client.query<{ allow_replies: boolean }>(
          `SELECT allow_replies FROM posts WHERE id = $1`,
          [input.replyTo],
        );
        if (chk.rows.length === 0) {
          throw new Error("parent post not found");
        }
        if (!chk.rows[0].allow_replies) {
          throw new Error("replies are not allowed for the target post");
        }
      }
      const columns: string[] = [];
      const values: unknown[] = [];
      let idx = 1;
      if (input.content !== undefined) {
        if (typeof input.content !== "string" || input.content.trim() === "") {
          throw new Error("content is required");
        }
        columns.push(`content = $${idx++}`);
        values.push(input.content);
      }
      if (input.ownedBy !== undefined) {
        if (typeof input.ownedBy !== "string" || input.ownedBy.trim() === "") {
          throw new Error("ownedBy is required");
        }
        columns.push(`owned_by = $${idx++}`);
        values.push(input.ownedBy);
      }
      if (input.replyTo !== undefined) {
        columns.push(`reply_to = $${idx++}`);
        values.push(input.replyTo);
      }
      if (input.allowLikes !== undefined) {
        columns.push(`allow_likes = $${idx++}`);
        values.push(input.allowLikes);
      }
      if (input.allowReplies !== undefined) {
        columns.push(`allow_replies = $${idx++}`);
        values.push(input.allowReplies);
      }
      columns.push(`updated_at = now()`);
      values.push(input.id);
      const sql = `UPDATE posts SET ${columns.join(", ")} WHERE id = $${idx} RETURNING id, content, owned_by, reply_to, allow_likes, allow_replies, created_at, updated_at`;
      await client.query(sql, values);

      if (input.tags !== undefined) {
        await client.query(`DELETE FROM post_tags WHERE post_id = $1`, [input.id]);
        if (input.tags.length > 0) {
          await client.query(
            `INSERT INTO post_tags (post_id, name) VALUES ${input.tags
              .map((_, i) => `($1, $${i + 2})`)
              .join(", ")}`,
            [input.id, ...input.tags],
          );
        }
      }
      await client.query("COMMIT");
      return this.getPost(input.id);
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    }
  }

  async deletePost(id: string): Promise<void> {
    const res = await this.pgClient.query(`DELETE FROM posts WHERE id = $1`, [id]);
    if ((res.rowCount ?? 0) === 0) throw new Error("Post not found");
  }

  async addLike(postId: string, userId: string): Promise<void> {
    const chk = await this.pgClient.query(`SELECT allow_likes FROM posts WHERE id = $1`, [postId]);
    if (chk.rows.length === 0) throw new Error("post not found");
    if (!chk.rows[0].allow_likes) throw new Error("likes are not allowed for the target post");
    const res = await this.pgClient.query(
      `INSERT INTO post_likes (post_id, liked_by, created_at)
       VALUES ($1, $2, $3)
       ON CONFLICT DO NOTHING`,
      [postId, userId, new Date().toISOString()],
    );
    if ((res.rowCount ?? 0) === 0) throw new Error("already liked");
  }

  async removeLike(postId: string, userId: string): Promise<void> {
    const res = await this.pgClient.query(
      `DELETE FROM post_likes WHERE post_id = $1 AND liked_by = $2`,
      [postId, userId],
    );
    if ((res.rowCount ?? 0) === 0) throw new Error("not liked");
  }

  async listPostsByFolloweesDetail(
    input: ListPostsByFolloweesDetailInput,
    focusUserId?: string,
  ): Promise<PostDetail[]> {
    const {
      userId,
      includeSelf = false,
      includeReplies = true,
      offset = 0,
      limit = 100,
      order = "desc",
    } = input;
    let followeeSql = `
      SELECT followee_id FROM user_follows WHERE follower_id = $1
      ${includeSelf ? "UNION SELECT $1" : ""}
    `;
    const repliesFilter = includeReplies === false ? "AND p.reply_to IS NULL" : "";
    const sql = `
      SELECT
        p.id,
        p.content,
        p.owned_by,
        p.reply_to,
        p.allow_likes,
        p.allow_replies,
        p.created_at,
        p.updated_at,
        u.nickname AS owner_nickname,
        pu.nickname AS reply_to_owner_nickname,
        p.count_replies AS count_replies,
        p.count_likes AS count_likes,
        ARRAY(
          SELECT pt2.name FROM post_tags pt2 WHERE pt2.post_id = p.id ORDER BY pt2.name
        ) AS tags
      FROM posts p
      JOIN users u ON p.owned_by = u.id
      LEFT JOIN posts parent_post ON p.reply_to = parent_post.id
      LEFT JOIN users pu ON parent_post.owned_by = pu.id
      WHERE p.owned_by IN (${followeeSql})
        ${repliesFilter}
      ORDER BY p.id ${order}
      OFFSET $2 LIMIT $3
    `;
    const params = [userId, offset, limit];
    const res = await this.pgClient.query(sql, params);
    const details = snakeToCamel<PostDetail[]>(res.rows);
    if (!focusUserId || details.length === 0) return details;
    const postIds = details.map((p) => p.id);
    const likeRes = await this.pgClient.query(
      `SELECT post_id FROM post_likes WHERE post_id = ANY($1) AND liked_by = $2`,
      [postIds, focusUserId],
    );
    const likedPostIds = new Set(likeRes.rows.map((r) => r.post_id));
    const replyRes = await this.pgClient.query(
      `SELECT reply_to FROM posts WHERE reply_to = ANY($1) AND owned_by = $2`,
      [postIds, focusUserId],
    );
    const repliedPostIds = new Set(replyRes.rows.map((r) => r.reply_to));
    for (const d of details) {
      d.isLikedByFocusUser = likedPostIds.has(d.id);
      d.isRepliedByFocusUser = repliedPostIds.has(d.id);
    }
    return details;
  }

  async listPostsLikedByUserDetail(
    input: ListPostsLikedByUserDetailInput,
    focusUserId?: string,
  ): Promise<PostDetail[]> {
    const offset = input.offset ?? 0;
    const limit = input.limit ?? 100;
    const order = (input.order ?? "desc").toLowerCase() === "asc" ? "ASC" : "DESC";
    const includeReplies = input.includeReplies !== false;
    let sql = `
      SELECT
        p.id,
        p.content,
        p.owned_by,
        p.reply_to,
        p.allow_likes,
        p.allow_replies,
        p.created_at,
        p.updated_at,
        u.nickname AS owner_nickname,
        pu.nickname AS reply_to_owner_nickname,
        p.count_replies AS count_replies,
        p.count_likes AS count_likes,
        ARRAY(
          SELECT pt.name FROM post_tags pt WHERE pt.post_id = p.id ORDER BY pt.name
        ) AS tags
      FROM post_likes pl
      JOIN posts p ON pl.post_id = p.id
      JOIN users u ON p.owned_by = u.id
      LEFT JOIN posts parent_post ON p.reply_to = parent_post.id
      LEFT JOIN users pu ON parent_post.owned_by = pu.id
      WHERE pl.liked_by = $1
    `;
    const params: unknown[] = [input.userId];
    let paramIdx = 2;
    if (!includeReplies) {
      sql += ` AND p.reply_to IS NULL`;
    }
    sql += ` ORDER BY p.id ${order} OFFSET $${paramIdx++} LIMIT $${paramIdx++}`;
    params.push(offset, limit);
    const res = await this.pgClient.query(sql, params);
    const details = snakeToCamel<PostDetail[]>(res.rows);
    if (!focusUserId || details.length === 0) return details;
    const postIds = details.map((p) => p.id);
    const likeRes = await this.pgClient.query(
      `SELECT post_id FROM post_likes WHERE post_id = ANY($1) AND liked_by = $2`,
      [postIds, focusUserId],
    );
    const likedPostIds = new Set(likeRes.rows.map((r) => r.post_id));
    const replyRes = await this.pgClient.query(
      `SELECT reply_to FROM posts WHERE reply_to = ANY($1) AND owned_by = $2`,
      [postIds, focusUserId],
    );
    const repliedPostIds = new Set(replyRes.rows.map((r) => r.reply_to));
    for (const d of details) {
      d.isLikedByFocusUser = likedPostIds.has(d.id);
      d.isRepliedByFocusUser = repliedPostIds.has(d.id);
    }
    return details;
  }

  async listLikers(input: ListLikersInput): Promise<User[]> {
    const { postId, offset = 0, limit = 100, order = "desc" } = input;
    const orderDir = order && order.toLowerCase() === "asc" ? "ASC" : "DESC";
    const sql = `
      SELECT u.*
      FROM post_likes pl
      JOIN users u ON pl.liked_by = u.id
      WHERE pl.post_id = $1
      ORDER BY pl.created_at ${orderDir}, u.id ${orderDir}
      OFFSET $2 LIMIT $3
    `;
    const res = await this.pgClient.query(sql, [postId, offset, limit]);
    return snakeToCamel<User[]>(res.rows);
  }
}
