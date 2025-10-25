import { Config } from "../config";
import {
  Post,
  PostLite,
  PostDetail,
  CountPostsInput,
  CreatePostInput,
  UpdatePostInput,
  ListPostsInput,
  ListPostsByFolloweesInput,
  ListPostsLikedByUserInput,
  ListLikersInput,
} from "../models/post";
import { User } from "../models/user";
import { IdIssueService } from "./idIssue";
import { EventLogService } from "./eventLog";
import {
  validateLocale,
  snakeToCamel,
  escapeForLike,
  hexToDec,
  decToHex,
  hexArrayToDec,
} from "../utils/format";
import { makeSnippetJsonFromMarkdown } from "../utils/snippet";
import { Pool } from "pg";
import Redis from "ioredis";
import { pgQuery } from "../utils/servers";

export class PostsService {
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
      if (replyTo === null) where.push(`pt.is_root = TRUE`);
    }
    if (query) sql += ` JOIN post_details pc ON pc.post_id = p.id`;
    if (ownedBy) {
      where.push(`p.owned_by = $${idx++}`);
      params.push(hexToDec(ownedBy));
    }
    if (replyTo !== undefined) {
      if (replyTo === null) where.push(`p.reply_to IS NULL`);
      else if (replyTo === "*") where.push(`p.reply_to IS NOT NULL`);
      else {
        where.push(`p.reply_to = $${idx++}`);
        params.push(hexToDec(String(replyTo)));
      }
    }
    if (query) {
      const escapedQuery = escapeForLike(query);
      where.push(`pc.content ILIKE $${idx++}`);
      params.push(`%${escapedQuery}%`);
    }
    if (where.length > 0) sql += " WHERE " + where.join(" AND ");
    const res = await pgQuery(this.pgPool, sql, params);
    return Number(res.rows[0].count);
  }

  async getPostLite(id: string): Promise<PostLite | null> {
    const res = await pgQuery(
      this.pgPool,
      `
      SELECT
        p.id,
        p.owned_by,
        p.reply_to,
        p.published_at,
        p.updated_at,
        p.allow_likes,
        p.allow_replies,
        id_to_timestamp(p.id) AS created_at,
        u.nickname AS owner_nickname,
        pu.nickname AS reply_to_owner_nickname,
        COALESCE(pc.reply_count,0) AS count_replies,
        COALESCE(pc.like_count,0) AS count_likes,
        ARRAY(SELECT pt.name FROM post_tags pt WHERE pt.post_id = p.id ORDER BY pt.name) AS tags
      FROM posts p
      JOIN users u ON p.owned_by = u.id
      LEFT JOIN posts pp ON p.reply_to = pp.id
      LEFT JOIN users pu ON pp.owned_by = pu.id
      LEFT JOIN post_counts pc ON pc.post_id = p.id
      WHERE p.id = $1
    `,
      [hexToDec(id)],
    );
    if (res.rows.length === 0) return null;
    const row = res.rows[0];
    row.id = decToHex(row.id);
    row.owned_by = decToHex(row.owned_by);
    row.reply_to = row.reply_to == null ? null : decToHex(row.reply_to);
    return snakeToCamel<PostLite>(row);
  }

  async getPost(id: string, focusUserId?: string): Promise<PostDetail | null> {
    let sql = `
      SELECT
        p.id,
        p.owned_by,
        p.reply_to,
        p.published_at,
        p.updated_at,
        p.locale,
        p.snippet,
        p.allow_likes,
        p.allow_replies,
        id_to_timestamp(p.id) AS created_at,
        u.nickname AS owner_nickname,
        pu.nickname AS reply_to_owner_nickname,
        COALESCE(pc.reply_count,0) AS count_replies,
        COALESCE(pc.like_count,0) AS count_likes,
        ARRAY(SELECT pt.name FROM post_tags pt WHERE pt.post_id = p.id ORDER BY pt.name) AS tags,
        pc2.content AS content
    `;
    const params: unknown[] = [hexToDec(id)];
    if (focusUserId) {
      sql += `,
        CASE
          WHEN p.owned_by = $2 THEN FALSE
          ELSE (
            EXISTS (SELECT 1 FROM user_blocks b WHERE b.blocker_id = p.owned_by AND b.blockee_id = $2)
            OR (u.block_strangers = TRUE AND NOT EXISTS (SELECT 1 FROM user_follows f WHERE f.follower_id = p.owned_by AND f.followee_id = $2))
          )
        END AS is_blocking_focus_user
      `;
    }
    sql += `
      FROM posts p
      JOIN users u ON p.owned_by = u.id
      LEFT JOIN posts pp ON p.reply_to = pp.id
      LEFT JOIN users pu ON pp.owned_by = pu.id
      LEFT JOIN post_details pc2 ON pc2.post_id = p.id
      LEFT JOIN post_counts pc ON pc.post_id = p.id
      WHERE p.id = $1
    `;
    if (focusUserId) params.push(hexToDec(focusUserId));
    const res = await pgQuery(this.pgPool, sql, params);
    if (res.rows.length === 0) return null;
    const row = res.rows[0];
    row.id = decToHex(row.id);
    row.owned_by = decToHex(row.owned_by);
    row.reply_to = row.reply_to == null ? null : decToHex(row.reply_to);
    const post = snakeToCamel<PostDetail>(row);
    if (focusUserId) {
      const likeRes = await pgQuery(
        this.pgPool,
        "SELECT 1 FROM post_likes WHERE post_id = $1 AND liked_by = $2 LIMIT 1",
        [hexToDec(id), hexToDec(focusUserId)],
      );
      post.isLikedByFocusUser = likeRes.rows.length > 0;
      const replyRes = await pgQuery(
        this.pgPool,
        "SELECT 1 FROM posts WHERE reply_to = $1 AND owned_by = $2 LIMIT 1",
        [hexToDec(id), hexToDec(focusUserId)],
      );
      post.isRepliedByFocusUser = replyRes.rows.length > 0;
    }
    return post;
  }

  async listPosts(options?: ListPostsInput, focusUserId?: string): Promise<Post[]> {
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
        p.owned_by,
        p.reply_to,
        p.published_at,
        p.updated_at,
        p.locale,
        p.snippet,
        p.allow_likes,
        p.allow_replies,
        id_to_timestamp(p.id) AS created_at,
        u.nickname AS owner_nickname,
        pu.nickname AS reply_to_owner_nickname,
        COALESCE(pc.reply_count,0) AS count_replies,
        COALESCE(pc.like_count,0) AS count_likes,
        ARRAY(SELECT pt2.name FROM post_tags pt2 WHERE pt2.post_id = p.id ORDER BY pt2.name) AS tags
    `;
    const where: string[] = [];
    const params: unknown[] = [];
    let paramIdx = 1;
    if (focusUserId) {
      sql += `,
        CASE
          WHEN p.owned_by = $${paramIdx} THEN FALSE
          ELSE (
            EXISTS (SELECT 1 FROM user_blocks b WHERE b.blocker_id = p.owned_by AND b.blockee_id = $${paramIdx})
            OR (u.block_strangers = TRUE AND NOT EXISTS (SELECT 1 FROM user_follows f WHERE f.follower_id = p.owned_by AND f.followee_id = $${paramIdx}))
          )
        END AS is_blocking_focus_user
      `;
      params.push(hexToDec(focusUserId));
      paramIdx++;
    }
    sql += `
      FROM posts p
      JOIN users u ON p.owned_by = u.id
      LEFT JOIN posts pp ON p.reply_to = pp.id
      LEFT JOIN users pu ON pp.owned_by = pu.id
      LEFT JOIN post_counts pc ON pc.post_id = p.id
    `;
    if (tag) {
      sql += ` JOIN post_tags pt ON pt.post_id = p.id`;
      where.push(`pt.name = $${paramIdx++}`);
      params.push(tag);
      if (replyTo === null) where.push(`pt.is_root = TRUE`);
    }
    if (query) sql += ` JOIN post_details pc2 ON pc2.post_id = p.id`;
    if (ownedBy) {
      where.push(`p.owned_by = $${paramIdx++}`);
      params.push(hexToDec(ownedBy));
    }
    if (replyTo !== undefined) {
      if (replyTo === null) where.push(`p.reply_to IS NULL`);
      else if (replyTo === "*") where.push(`p.reply_to IS NOT NULL`);
      else {
        where.push(`p.reply_to = $${paramIdx++}`);
        params.push(hexToDec(String(replyTo)));
      }
    }
    if (query) {
      const escapedQuery = escapeForLike(query);
      where.push(`pc2.content ILIKE $${paramIdx++}`);
      params.push(`%${escapedQuery}%`);
    }
    if (where.length > 0) sql += " WHERE " + where.join(" AND ");
    sql += ` ORDER BY p.id ${order} OFFSET $${paramIdx++} LIMIT $${paramIdx++}`;
    params.push(offset, limit);
    const res = await pgQuery(this.pgPool, sql, params);
    const posts = res.rows.map((r) => {
      r.id = decToHex(r.id);
      r.owned_by = decToHex(r.owned_by);
      r.reply_to = r.reply_to == null ? null : decToHex(r.reply_to);
      return r;
    });
    const out = snakeToCamel<Post[]>(posts);
    if (!focusUserId || out.length === 0) return out;
    const postIds = out.map((p) => p.id);
    const likeRes = await pgQuery(
      this.pgPool,
      `SELECT post_id FROM post_likes WHERE post_id = ANY($1) AND liked_by = $2`,
      [hexArrayToDec(postIds), hexToDec(focusUserId)],
    );
    const likedPostIds = new Set(likeRes.rows.map((r) => decToHex(r.post_id)));
    const replyRes = await pgQuery(
      this.pgPool,
      `SELECT reply_to FROM posts WHERE reply_to = ANY($1) AND owned_by = $2`,
      [hexArrayToDec(postIds), hexToDec(focusUserId)],
    );
    const repliedPostIds = new Set(replyRes.rows.map((r) => decToHex(r.reply_to)));
    for (const d of out) {
      d.isLikedByFocusUser = likedPostIds.has(d.id);
      d.isRepliedByFocusUser = repliedPostIds.has(d.id);
    }
    return out;
  }

  async createPost(input: CreatePostInput): Promise<Post> {
    if (typeof input.content !== "string" || input.content.trim() === "")
      throw new Error("content is required");
    if (!validateLocale(input.locale)) throw new Error("locale is required");
    if (typeof input.ownedBy !== "string" || input.ownedBy.trim() === "")
      throw new Error("ownedBy is required");
    let id: string;
    if (input.id && input.id.trim() !== "") {
      const hexId = input.id.trim();
      if (!/^[0-9A-F]{16}$/.test(hexId)) throw new Error("invalid id format");
      id = hexId;
    } else id = await this.idIssueService.issueId();
    const snippet = makeSnippetJsonFromMarkdown(input.content);
    await pgQuery(this.pgPool, "BEGIN");
    try {
      if (input.replyTo != null) {
        const chk = await pgQuery<{ allow_replies: boolean }>(
          this.pgPool,
          `SELECT allow_replies FROM posts WHERE id = $1`,
          [hexToDec(input.replyTo)],
        );
        if (chk.rows.length === 0) throw new Error("parent post not found");
        if (!chk.rows[0].allow_replies)
          throw new Error("replies are not allowed for the target post");
      }
      const res = await pgQuery(
        this.pgPool,
        `INSERT INTO posts (id, owned_by, reply_to, published_at, updated_at, locale, snippet, allow_likes, allow_replies)
         VALUES ($1, $2, $3, $4, NULL, $5, $6, $7, $8)
         RETURNING id, owned_by, reply_to, published_at, updated_at, locale, snippet, allow_likes, allow_replies, id_to_timestamp(id) AS created_at`,
        [
          hexToDec(id),
          hexToDec(input.ownedBy),
          input.replyTo == null ? null : hexToDec(input.replyTo),
          input.publishedAt,
          input.locale,
          snippet,
          input.allowLikes,
          input.allowReplies,
        ],
      );
      await pgQuery(
        this.pgPool,
        `INSERT INTO post_details (post_id, content) VALUES ($1, $2) ON CONFLICT (post_id) DO UPDATE SET content = EXCLUDED.content`,
        [hexToDec(id), input.content],
      );
      if (input.tags && input.tags.length > 0) {
        const isRoot = input.replyTo == null;
        await pgQuery(
          this.pgPool,
          `
          INSERT INTO post_tags (post_id, name, is_root)
          SELECT $1, t, $2
          FROM unnest($3::text[]) AS t
          `,
          [hexToDec(id), isRoot, input.tags],
        );
      }
      await pgQuery(this.pgPool, "COMMIT");
      if (this.eventLogService && input.replyTo) {
        try {
          this.eventLogService.recordReply({
            userId: input.ownedBy,
            postId: id,
            replyToPostId: input.replyTo,
          });
        } catch {}
      }
      const row = res.rows[0];
      row.id = decToHex(row.id);
      row.owned_by = decToHex(row.owned_by);
      row.reply_to = row.reply_to == null ? null : decToHex(row.reply_to);
      return snakeToCamel<Post>(row);
    } catch (e) {
      await pgQuery(this.pgPool, "ROLLBACK");
      throw e;
    }
  }

  async updatePost(input: UpdatePostInput): Promise<PostDetail | null> {
    await pgQuery(this.pgPool, "BEGIN");
    try {
      if (input.replyTo != null && input.replyTo !== undefined) {
        const chk = await pgQuery<{ allow_replies: boolean }>(
          this.pgPool,
          `SELECT allow_replies FROM posts WHERE id = $1`,
          [hexToDec(input.replyTo)],
        );
        if (chk.rows.length === 0) throw new Error("parent post not found");
        if (!chk.rows[0].allow_replies)
          throw new Error("replies are not allowed for the target post");
      }
      const columns: string[] = [];
      const values: unknown[] = [];
      let idx = 1;

      if (input.ownedBy !== undefined) {
        if (typeof input.ownedBy !== "string" || input.ownedBy.trim() === "")
          throw new Error("ownedBy is required");
        columns.push(`owned_by = $${idx++}`);
        values.push(hexToDec(input.ownedBy));
      }
      if (input.replyTo !== undefined) {
        columns.push(`reply_to = $${idx++}`);
        values.push(input.replyTo == null ? null : hexToDec(input.replyTo));
      }
      if (input.publishedAt !== undefined) {
        columns.push(`published_at = $${idx++}`);
        values.push(input.publishedAt);
      }
      if (input.locale !== undefined) {
        if (!validateLocale(input.locale)) throw new Error("locale is required");
        columns.push(`locale = $${idx++}`);
        values.push(input.locale);
      }
      if (input.content !== undefined) {
        if (typeof input.content !== "string" || input.content.trim() === "")
          throw new Error("content is required");
        const snippet = makeSnippetJsonFromMarkdown(input.content);
        columns.push(`snippet = $${idx++}`);
        values.push(snippet);
        await pgQuery(
          this.pgPool,
          `INSERT INTO post_details (post_id, content) VALUES ($1, $2) ON CONFLICT (post_id) DO UPDATE SET content = EXCLUDED.content`,
          [hexToDec(input.id), input.content],
        );
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
      values.push(hexToDec(input.id));

      if (columns.length > 0) {
        const sql = `UPDATE posts SET ${columns.join(", ")} WHERE id = $${idx} RETURNING id`;
        await pgQuery(this.pgPool, sql, values);
      }
      if (input.replyTo !== undefined && input.tags === undefined) {
        const isRoot = input.replyTo == null;
        await pgQuery(
          this.pgPool,
          `UPDATE post_tags SET is_root = $2 WHERE post_id = $1 AND is_root IS DISTINCT FROM $2`,
          [hexToDec(input.id), isRoot],
        );
      }
      if (input.tags !== undefined) {
        await pgQuery(this.pgPool, `DELETE FROM post_tags WHERE post_id = $1`, [
          hexToDec(input.id),
        ]);
        if (input.tags.length > 0) {
          const r = await pgQuery(this.pgPool, `SELECT reply_to FROM posts WHERE id = $1`, [
            hexToDec(input.id),
          ]);
          const isRoot = r.rows[0].reply_to == null;
          await pgQuery(
            this.pgPool,
            `
            INSERT INTO post_tags (post_id, name, is_root)
            SELECT $1, t, $2
            FROM unnest($3::text[]) AS t
            `,
            [hexToDec(input.id), isRoot, input.tags],
          );
        }
      }
      await pgQuery(this.pgPool, "COMMIT");
      return this.getPost(input.id);
    } catch (e) {
      await pgQuery(this.pgPool, "ROLLBACK");
      throw e;
    }
  }

  async deletePost(id: string): Promise<void> {
    const res = await pgQuery(this.pgPool, `DELETE FROM posts WHERE id = $1`, [hexToDec(id)]);
    if ((res.rowCount ?? 0) === 0) throw new Error("Post not found");
  }

  async addLike(postId: string, userId: string): Promise<void> {
    const chk = await pgQuery(this.pgPool, `SELECT allow_likes FROM posts WHERE id = $1`, [
      hexToDec(postId),
    ]);
    if (chk.rows.length === 0) throw new Error("post not found");
    if (!chk.rows[0].allow_likes) throw new Error("likes are not allowed for the target post");
    const res = await pgQuery(
      this.pgPool,
      `INSERT INTO post_likes (post_id, liked_by, created_at) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
      [hexToDec(postId), hexToDec(userId), new Date().toISOString()],
    );
    if ((res.rowCount ?? 0) === 0) throw new Error("already liked");
    if (this.eventLogService) {
      try {
        this.eventLogService.recordLike({ userId: userId, postId: postId });
      } catch {}
    }
  }

  async removeLike(postId: string, userId: string): Promise<void> {
    const res = await pgQuery(
      this.pgPool,
      `DELETE FROM post_likes WHERE post_id = $1 AND liked_by = $2`,
      [hexToDec(postId), hexToDec(userId)],
    );
    if ((res.rowCount ?? 0) === 0) throw new Error("not liked");
  }

  async listPostsByFollowees(
    input: ListPostsByFolloweesInput,
    focusUserId?: string,
  ): Promise<Post[]> {
    const {
      userId,
      includeSelf = false,
      includeReplies = true,
      offset = 0,
      limit = 100,
      order = "desc",
    } = input;
    const orderDir = order.toLowerCase() === "asc" ? "ASC" : "DESC";
    const activeFolloweeLimit = limit;
    const perFolloweeLimit = Math.max(limit + offset, limit);
    const repliesFilter = includeReplies === false ? "AND p2.reply_to IS NULL" : "";
    const focusParamIndex = 6;
    const sql = `
      WITH all_followers AS (
        SELECT followee_id FROM user_follows WHERE follower_id = $1
        ${includeSelf ? "UNION SELECT $1" : ""}
      ),
      active_followers AS (
        SELECT DISTINCT ON (p2.owned_by) p2.owned_by, p2.id AS last_id
        FROM posts p2
        WHERE p2.owned_by IN (SELECT followee_id FROM all_followers)
          ${repliesFilter}
        ORDER BY p2.owned_by, p2.id ${orderDir}
      ),
      top_followees AS (
        SELECT owned_by FROM active_followers ORDER BY last_id ${orderDir} LIMIT $2
      ),
      candidates AS (
        SELECT pid.id
        FROM top_followees tf
        JOIN LATERAL (
          SELECT p2.id
          FROM posts p2
          WHERE p2.owned_by = tf.owned_by
            ${repliesFilter}
          ORDER BY p2.id ${orderDir}
          LIMIT $3
        ) AS pid ON TRUE
      ),
      top_posts AS (
        SELECT id FROM candidates ORDER BY id ${orderDir} OFFSET $4 LIMIT $5
      )
      SELECT
        p.id,
        p.owned_by,
        p.reply_to,
        p.published_at,
        p.updated_at,
        p.locale,
        p.snippet,
        p.allow_likes,
        p.allow_replies,
        id_to_timestamp(p.id) AS created_at,
        u.nickname AS owner_nickname,
        pu.nickname AS reply_to_owner_nickname,
        COALESCE(pc.reply_count,0) AS count_replies,
        COALESCE(pc.like_count,0) AS count_likes
        ${
          focusUserId
            ? `,
        CASE
          WHEN p.owned_by = $${focusParamIndex} THEN FALSE
          ELSE (
            EXISTS (SELECT 1 FROM user_blocks b WHERE b.blocker_id = p.owned_by AND b.blockee_id = $${focusParamIndex})
            OR (u.block_strangers = TRUE AND NOT EXISTS (SELECT 1 FROM user_follows f WHERE f.follower_id = p.owned_by AND f.followee_id = $${focusParamIndex}))
          )
        END AS is_blocking_focus_user`
            : ""
        },
        ARRAY(SELECT pt2.name FROM post_tags pt2 WHERE pt2.post_id = p.id ORDER BY pt2.name) AS tags
      FROM top_posts t
      JOIN posts p ON p.id = t.id
      JOIN users u ON p.owned_by = u.id
      LEFT JOIN posts pp ON p.reply_to = pp.id
      LEFT JOIN users pu ON pp.owned_by = pu.id
      LEFT JOIN post_counts pc ON pc.post_id = p.id
      ORDER BY t.id ${orderDir}
    `;
    const params: unknown[] = [
      hexToDec(userId),
      activeFolloweeLimit,
      perFolloweeLimit,
      offset,
      limit,
    ];
    if (focusUserId) params.push(hexToDec(focusUserId));
    const res = await pgQuery(this.pgPool, sql, params);
    const rows = res.rows.map((r) => {
      r.id = decToHex(r.id);
      r.owned_by = decToHex(r.owned_by);
      r.reply_to = r.reply_to == null ? null : decToHex(r.reply_to);
      return r;
    });
    const posts = snakeToCamel<Post[]>(rows);
    if (!focusUserId || posts.length === 0) return posts;
    const postIds = posts.map((p) => p.id);
    const likeRes = await pgQuery(
      this.pgPool,
      `SELECT post_id FROM post_likes WHERE post_id = ANY($1) AND liked_by = $2`,
      [hexArrayToDec(postIds), hexToDec(focusUserId)],
    );
    const likedPostIds = new Set(likeRes.rows.map((r) => decToHex(r.post_id)));
    const replyRes = await pgQuery(
      this.pgPool,
      `SELECT reply_to FROM posts WHERE reply_to = ANY($1) AND owned_by = $2`,
      [hexArrayToDec(postIds), hexToDec(focusUserId)],
    );
    const repliedPostIds = new Set(replyRes.rows.map((r) => decToHex(r.reply_to)));
    for (const d of posts) {
      d.isLikedByFocusUser = likedPostIds.has(d.id);
      d.isRepliedByFocusUser = repliedPostIds.has(d.id);
    }
    return posts;
  }

  async listPostsLikedByUser(
    input: ListPostsLikedByUserInput,
    focusUserId?: string,
  ): Promise<Post[]> {
    const offset = input.offset ?? 0;
    const limit = input.limit ?? 100;
    const order = (input.order ?? "desc").toLowerCase() === "asc" ? "ASC" : "DESC";
    const includeReplies = input.includeReplies !== false;
    let sql = `
      SELECT
        p.id,
        p.owned_by,
        p.reply_to,
        p.published_at,
        p.updated_at,
        p.locale,
        p.snippet,
        p.allow_likes,
        p.allow_replies,
        id_to_timestamp(p.id) AS created_at,
        u.nickname AS owner_nickname,
        pu.nickname AS reply_to_owner_nickname,
        COALESCE(pc.reply_count,0) AS count_replies,
        COALESCE(pc.like_count,0) AS count_likes,
        ARRAY(SELECT pt.name FROM post_tags pt WHERE pt.post_id = p.id ORDER BY pt.name) AS tags
    `;
    const params: unknown[] = [hexToDec(input.userId)];
    let paramIdx = 2;
    if (focusUserId) {
      sql += `,
        CASE
          WHEN p.owned_by = $${paramIdx} THEN FALSE
          ELSE (
            EXISTS (SELECT 1 FROM user_blocks b WHERE b.blocker_id = p.owned_by AND b.blockee_id = $${paramIdx})
            OR (u.block_strangers = TRUE AND NOT EXISTS (SELECT 1 FROM user_follows f WHERE f.follower_id = p.owned_by AND f.followee_id = $${paramIdx}))
          )
        END AS is_blocking_focus_user
      `;
      params.push(hexToDec(focusUserId));
      paramIdx++;
    }
    sql += `
      FROM post_likes pl
      JOIN posts p ON pl.post_id = p.id
      JOIN users u ON p.owned_by = u.id
      LEFT JOIN posts pp ON p.reply_to = pp.id
      LEFT JOIN users pu ON pp.owned_by = pu.id
      LEFT JOIN post_counts pc ON pc.post_id = p.id
      WHERE pl.liked_by = $1
    `;
    if (!includeReplies) sql += ` AND p.reply_to IS NULL`;
    sql += ` ORDER BY pl.created_at ${order} OFFSET $${paramIdx++} LIMIT $${paramIdx++}`;
    params.push(offset, limit);
    const res = await pgQuery(this.pgPool, sql, params);
    const rows = res.rows.map((r) => {
      r.id = decToHex(r.id);
      r.owned_by = decToHex(r.owned_by);
      r.reply_to = r.reply_to == null ? null : decToHex(r.reply_to);
      return r;
    });
    const posts = snakeToCamel<Post[]>(rows);
    if (!focusUserId || posts.length === 0) return posts;
    const postIds = posts.map((p) => p.id);
    const likeRes = await pgQuery(
      this.pgPool,
      `SELECT post_id FROM post_likes WHERE post_id = ANY($1) AND liked_by = $2`,
      [hexArrayToDec(postIds), hexToDec(focusUserId)],
    );
    const likedPostIds = new Set(likeRes.rows.map((r) => decToHex(r.post_id)));
    const replyRes = await pgQuery(
      this.pgPool,
      `SELECT reply_to FROM posts WHERE reply_to = ANY($1) AND owned_by = $2`,
      [hexArrayToDec(postIds), hexToDec(focusUserId)],
    );
    const repliedPostIds = new Set(replyRes.rows.map((r) => decToHex(r.reply_to)));
    for (const d of posts) {
      d.isLikedByFocusUser = likedPostIds.has(d.id);
      d.isRepliedByFocusUser = repliedPostIds.has(d.id);
    }
    return posts;
  }

  async listLikers(input: ListLikersInput): Promise<User[]> {
    const { postId, offset = 0, limit = 100, order = "desc" } = input;
    const orderDir = order && order.toLowerCase() === "asc" ? "ASC" : "DESC";
    const sql = `
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
        COALESCE(uc.follower_count,0) AS count_followers,
        COALESCE(uc.followee_count,0) AS count_followees,
        COALESCE(uc.post_count,0) AS count_posts
      FROM post_likes pl
      JOIN users u ON pl.liked_by = u.id
      LEFT JOIN user_secrets s ON s.user_id = u.id
      LEFT JOIN user_counts uc ON uc.user_id = u.id
      WHERE pl.post_id = $1
      ORDER BY pl.created_at ${orderDir}, u.id ${orderDir}
      OFFSET $2 LIMIT $3
    `;
    const res = await pgQuery(this.pgPool, sql, [hexToDec(postId), offset, limit]);
    const rows = res.rows.map((r) => {
      r.id = decToHex(r.id);
      return r;
    });
    return snakeToCamel<User[]>(rows);
  }
}
