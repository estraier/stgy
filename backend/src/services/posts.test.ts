import { PostsService } from "./posts";
import {
  CreatePostInput,
  UpdatePostInput,
  ListPostsByFolloweesInput,
  ListPostsLikedByUserInput,
  ListLikersInput,
  PostPagination,
} from "../models/post";
import { User } from "../models/user";
import crypto from "crypto";
import { hexToDec } from "../utils/format";

jest.mock("../utils/servers", () => {
  const pgQuery = jest.fn((pool: any, sql: string, params?: any[]) => pool.query(sql, params));
  return { pgQuery };
});

function normalizeSql(sql: string) {
  return sql.replace(/\s+/g, " ").trim();
}

const hex16 = () => crypto.randomBytes(8).toString("hex").toUpperCase();
const toDecStr = (hex: string) => String(hexToDec(hex));

type MockPostRow = {
  id: string;
  ownedBy: string;
  replyTo: string | null;
  allowLikes: boolean;
  allowReplies: boolean;
  createdAt: string;
  publishedAt: string | null;
  updatedAt: string | null;
  content: string;
  locale: string | null;
};

class MockPgClientMain {
  data: MockPostRow[] = [];
  tags: { postId: string; name: string }[] = [];
  likes: { postId: string; likedBy: string }[] = [];
  follows: { followerId: string; followeeId: string }[] = [];
  users: { id: string; nickname: string; locale?: string | null }[] = [];
  blocks: { blockerId: string; blockeeId: string }[] = [];
  userBlockStrangers: Record<string, boolean> = {};
  txCount = 0;

  private countRepliesFor(postId: string) {
    return this.data.filter((r) => r.replyTo === postId).length;
  }

  private countLikesFor(postId: string) {
    return this.likes.filter((l) => l.postId === postId).length;
  }

  private selectsBlockingFlag(sql: string) {
    return /\bas\s+is_blocking_focus_user\b/i.test(sql);
  }

  private computeIsBlocking(authorId: string, focusId: string) {
    const authorBlocks = this.blocks.some(
      (b) => b.blockerId === authorId && b.blockeeId === focusId,
    );
    const blockStrangers = !!this.userBlockStrangers[authorId];
    const authorFollowsFocus = this.follows.some(
      (f) => f.followerId === authorId && f.followeeId === focusId,
    );
    return authorBlocks || (blockStrangers && !authorFollowsFocus);
  }

  async query(sql: string, params?: any[]) {
    sql = normalizeSql(sql);

    if (sql === "BEGIN" || sql === "COMMIT" || sql === "ROLLBACK") return { rows: [] };

    if (sql.startsWith("SELECT allow_likes FROM posts WHERE id = $1")) {
      const id = params![0];
      const post = this.data.find((p) => p.id === id);
      return { rows: post ? [{ allow_likes: post.allowLikes }] : [] };
    }

    if (sql.startsWith("SELECT allow_replies FROM posts WHERE id = $1")) {
      const id = params![0];
      const post = this.data.find((p) => p.id === id);
      return { rows: post ? [{ allow_replies: post.allowReplies }] : [] };
    }

    if (
      sql.startsWith(
        "INSERT INTO posts (id, owned_by, reply_to, published_at, updated_at, snippet, locale, allow_likes, allow_replies) VALUES",
      )
    ) {
      const [id, ownedBy, replyTo, publishedAt, snippet, locale, allowLikes, allowReplies] =
        params!;
      const createdAt = new Date().toISOString();
      const newPost: MockPostRow = {
        id,
        ownedBy,
        replyTo: replyTo ?? null,
        allowLikes: !!allowLikes,
        allowReplies: !!allowReplies,
        createdAt,
        publishedAt: publishedAt ?? null,
        updatedAt: null,
        content: "",
        locale: locale ?? null,
      };
      this.data.push(newPost);
      return {
        rows: [
          {
            id,
            owned_by: ownedBy,
            reply_to: replyTo ?? null,
            published_at: publishedAt ?? null,
            updated_at: null,
            snippet,
            locale: locale ?? null,
            allow_likes: !!allowLikes,
            allow_replies: !!allowReplies,
            created_at: createdAt,
          },
        ],
      };
    }

    if (
      sql.startsWith(
        "INSERT INTO post_details (post_id, content) VALUES ($1, $2) ON CONFLICT (post_id) DO UPDATE SET content = EXCLUDED.content",
      )
    ) {
      const [postId, content] = params!;
      const p = this.data.find((x) => x.id === postId);
      if (p) p.content = content;
      return { rowCount: 1, rows: [] };
    }

    if (
      sql.startsWith("INSERT INTO post_tags (post_id, name, is_root)") &&
      sql.includes("FROM unnest($3::text[])")
    ) {
      const [postId, , tagArray] = params as [string, boolean, string[]];
      for (const name of tagArray) this.tags.push({ postId, name });
      return { rowCount: tagArray.length };
    }

    if (sql.startsWith("INSERT INTO post_tags")) {
      for (let i = 1; i < params!.length; i++)
        this.tags.push({ postId: params![0], name: params![i] });
      return { rowCount: params!.length - 1 };
    }

    if (sql.startsWith("DELETE FROM post_tags WHERE post_id = $1")) {
      const postId = params![0];
      this.tags = this.tags.filter((t) => t.postId !== postId);
      return { rowCount: 1 };
    }

    if (sql.startsWith("UPDATE post_tags SET is_root = $2 WHERE post_id = $1")) {
      return { rowCount: 1 };
    }

    if (/^UPDATE\s+posts\s+SET\s+/i.test(sql)) {
      const mWhere = sql.match(/WHERE\s+id\s*=\s*\$(\d+)/i);
      const idParamIndex = mWhere ? parseInt(mWhere[1], 10) - 1 : params!.length - 1;
      const id = params![idParamIndex];
      const post = this.data.find((p) => p.id === id);
      if (!post) return { rows: [] };

      const mSet = sql.match(/SET\s+(.+?)\s+WHERE/i);
      const setList = mSet ? mSet[1].split(",").map((s) => s.trim()) : [];
      const colMap: Record<string, keyof MockPostRow> = {
        owned_by: "ownedBy",
        reply_to: "replyTo",
        published_at: "publishedAt",
        allow_likes: "allowLikes",
        allow_replies: "allowReplies",
        created_at: "createdAt",
        updated_at: "updatedAt",
        locale: "locale",
      };

      let paramCursor = 0;
      for (const assignment of setList) {
        const col = assignment.split("=")[0].trim().replace(/"/g, "");
        if (col === "snippet") {
          paramCursor++;
          continue;
        }
        if (col === "updated_at") {
          post.updatedAt = new Date().toISOString();
          continue;
        }
        const key = colMap[col];
        if (!key) {
          paramCursor++;
          continue;
        }
        (post as any)[key] = params![paramCursor++];
      }
      return { rows: [{ id: post.id }] };
    }

    if (
      sql.includes("WITH req AS (") &&
      sql.includes("WITH ORDINALITY") &&
      sql.includes("JOIN posts p ON p.id = r.id") &&
      sql.includes("ORDER BY r.ord")
    ) {
      const includeBlocking = this.selectsBlockingFlag(sql);
      const focusUserId = includeBlocking && params && params.length >= 2 ? params[0] : undefined;
      const ids = (includeBlocking ? params?.[1] : params?.[0]) as unknown[];
      const idList = Array.isArray(ids) ? ids.map((v) => String(v)) : [];
      const rows = idList
        .map((id) => {
          const p = this.data.find((x) => x.id === id);
          if (!p) return null;
          const replyToPost = this.data.find((pp) => pp.id === p.replyTo);
          const reply_to_owner_nickname = replyToPost
            ? (this.users.find((u) => u.id === replyToPost.ownedBy)?.nickname ?? null)
            : null;
          const reply_to_owner_id = replyToPost ? replyToPost.ownedBy : null;
          const owner = this.users.find((u) => u.id === p.ownedBy);
          const base: any = {
            id: p.id,
            owned_by: p.ownedBy,
            reply_to: p.replyTo,
            published_at: p.publishedAt,
            updated_at: p.updatedAt,
            snippet: "",
            locale: p.locale,
            allow_likes: p.allowLikes,
            allow_replies: p.allowReplies,
            created_at: p.createdAt,
            owner_nickname: owner?.nickname ?? "",
            owner_locale: owner?.locale ?? null,
            reply_to_owner_id,
            reply_to_owner_nickname,
            count_replies: this.countRepliesFor(p.id),
            count_likes: this.countLikesFor(p.id),
            tags: this.tags
              .filter((t) => t.postId === p.id)
              .map((t) => t.name)
              .sort(),
          };
          if (includeBlocking && focusUserId)
            base.is_blocking_focus_user = this.computeIsBlocking(p.ownedBy, focusUserId);
          return base;
        })
        .filter((x) => x !== null);
      return { rows };
    }

    if (
      sql.includes("WITH cur AS (") &&
      sql.includes("(SELECT id FROM older) AS older_post_id") &&
      sql.includes("(SELECT id FROM newer) AS newer_post_id") &&
      sql.includes("FROM cur c")
    ) {
      const id = params![0];
      const until = params![1];
      const cur = this.data.find((p) => p.id === id);
      if (!cur || !cur.publishedAt || cur.publishedAt > until) return { rows: [] };

      const owner = this.users.find((u) => u.id === cur.ownedBy);
      const replyToPost = this.data.find((pp) => pp.id === cur.replyTo);
      const replyNickname = replyToPost
        ? (this.users.find((u) => u.id === replyToPost.ownedBy)?.nickname ?? null)
        : null;
      const replyOwnerId = replyToPost ? replyToPost.ownedBy : null;

      const sameOwnerPub = this.data.filter(
        (p) => p.ownedBy === cur.ownedBy && p.publishedAt && p.publishedAt <= until,
      ) as MockPostRow[];

      const olderPool = sameOwnerPub.filter(
        (p) =>
          p.publishedAt! < cur.publishedAt! || (p.publishedAt === cur.publishedAt && p.id < cur.id),
      );
      olderPool.sort((a, b) =>
        a.publishedAt === b.publishedAt
          ? b.id.localeCompare(a.id)
          : b.publishedAt!.localeCompare(a.publishedAt!),
      );
      const newerPool = sameOwnerPub.filter(
        (p) =>
          p.publishedAt! > cur.publishedAt! || (p.publishedAt === cur.publishedAt && p.id > cur.id),
      );
      newerPool.sort((a, b) =>
        a.publishedAt === b.publishedAt
          ? a.id.localeCompare(b.id)
          : a.publishedAt!.localeCompare(b.publishedAt!),
      );

      const row: any = {
        id: cur.id,
        owned_by: cur.ownedBy,
        reply_to: cur.replyTo,
        published_at: cur.publishedAt,
        updated_at: cur.updatedAt,
        snippet: "",
        locale: cur.locale,
        allow_likes: cur.allowLikes,
        allow_replies: cur.allowReplies,
        created_at: cur.createdAt,
        owner_nickname: owner?.nickname ?? "",
        owner_locale: owner?.locale ?? null,
        reply_to_owner_id: replyOwnerId,
        reply_to_owner_nickname: replyNickname,
        count_replies: this.countRepliesFor(cur.id),
        count_likes: this.countLikesFor(cur.id),
        tags: this.tags
          .filter((t) => t.postId === cur.id)
          .map((t) => t.name)
          .sort(),
        content: cur.content,
        older_post_id: olderPool.length > 0 ? olderPool[0].id : null,
        newer_post_id: newerPool.length > 0 ? newerPool[0].id : null,
      };
      return { rows: [row] };
    }

    if (
      sql.includes("WITH all_followers AS") &&
      sql.includes("JOIN LATERAL") &&
      sql.includes("JOIN posts p ON p.id")
    ) {
      const includesTopActive = /top_followees/i.test(sql);
      const userId = params![0];
      const activeLimit = includesTopActive ? (params?.[1] ?? Number.MAX_SAFE_INTEGER) : undefined;
      const offset = includesTopActive ? (params?.[3] ?? 0) : (params?.[2] ?? 0);
      const limit = includesTopActive ? (params?.[4] ?? 100) : (params?.[3] ?? 100);
      const includeBlocking = this.selectsBlockingFlag(sql);
      const focusUserId = includeBlocking ? params?.[5] : undefined;

      let followeeIds = this.follows
        .filter((f) => f.followerId === userId)
        .map((f) => f.followeeId);
      if (sql.includes("UNION SELECT $1")) followeeIds.push(userId);
      followeeIds = Array.from(new Set(followeeIds));

      const onlyRoots = /\breply_to\s+IS\s+NULL/i.test(sql);
      const desc =
        sql.includes("ORDER BY p.id DESC") ||
        sql.includes("ORDER BY p2.id DESC") ||
        sql.includes("ORDER BY t.id DESC");
      const cmp = (a: MockPostRow, b: MockPostRow) =>
        desc ? b.id.localeCompare(a.id) : a.id.localeCompare(b.id);

      if (includesTopActive) {
        type WithLast = { fid: string; lastId: string | null };
        const withLast: WithLast[] = followeeIds.map((fid) => {
          let posts = this.data.filter((p) => p.ownedBy === fid);
          if (onlyRoots) posts = posts.filter((p) => p.replyTo === null);
          if (posts.length === 0) return { fid, lastId: null };
          posts.sort(cmp);
          return { fid, lastId: posts[0].id };
        });
        withLast.sort((a, b) => {
          if (a.lastId === null && b.lastId === null) return 0;
          if (a.lastId === null) return 1;
          if (b.lastId === null) return -1;
          return desc ? b.lastId.localeCompare(a.lastId) : a.lastId.localeCompare(b.lastId);
        });
        followeeIds = withLast
          .filter((x) => x.lastId !== null)
          .slice(0, activeLimit as number)
          .map((x) => x.fid);
      }

      let pool = this.data.filter((p) => followeeIds.includes(p.ownedBy));
      if (onlyRoots) pool = pool.filter((p) => p.replyTo === null);
      pool.sort(cmp);

      const selected = pool.slice(offset, offset + limit);
      const rows = selected.map((p) => {
        const replyToPost = this.data.find((pp) => pp.id === p.replyTo);
        const reply_to_owner_nickname = replyToPost
          ? (this.users.find((u) => u.id === replyToPost.ownedBy)?.nickname ?? null)
          : null;
        const reply_to_owner_id = replyToPost ? replyToPost.ownedBy : null;

        const base = {
          id: p.id,
          owned_by: p.ownedBy,
          reply_to: p.replyTo,
          published_at: p.publishedAt,
          locale: p.locale,
          allow_likes: p.allowLikes,
          allow_replies: p.allowReplies,
          created_at: p.createdAt,
          updated_at: p.updatedAt,
          owner_nickname: this.users.find((u) => u.id === p.ownedBy)?.nickname ?? "",
          owner_locale: this.users.find((u) => u.id === p.ownedBy)?.locale ?? null,
          reply_to_owner_id,
          reply_to_owner_nickname,
          count_replies: this.countRepliesFor(p.id),
          count_likes: this.countLikesFor(p.id),
          tags: this.tags
            .filter((t) => t.postId === p.id)
            .map((t) => t.name)
            .sort(),
        } as any;
        if (includeBlocking && focusUserId)
          base.is_blocking_focus_user = this.computeIsBlocking(p.ownedBy, focusUserId);
        return base;
      });
      return { rows };
    }

    if (
      sql.includes("FROM posts p") &&
      sql.includes("JOIN users u ON p.owned_by = u.id") &&
      sql.includes("WHERE p.owned_by = $1") &&
      sql.includes("p.published_at <=") &&
      sql.includes("ORDER BY p.published_at")
    ) {
      const ownedBy = params![0];
      const publishedUntil = params![1];
      const offset = params![params!.length - 2] ?? 0;
      const limit = params![params!.length - 1] ?? 100;
      const asc = /ORDER BY p\.published_at ASC/.test(sql);
      const buildRow = (p: MockPostRow) => {
        const replyToPost = this.data.find((pp) => pp.id === p.replyTo);
        const reply_to_owner_nickname = replyToPost
          ? (this.users.find((u) => u.id === replyToPost.ownedBy)?.nickname ?? null)
          : null;
        const reply_to_owner_id = replyToPost ? replyToPost.ownedBy : null;

        return {
          id: p.id,
          owned_by: p.ownedBy,
          reply_to: p.replyTo,
          published_at: p.publishedAt,
          updated_at: p.updatedAt,
          snippet: "",
          locale: p.locale,
          allow_likes: p.allowLikes,
          allow_replies: p.allowReplies,
          created_at: p.createdAt,
          owner_nickname: this.users.find((u) => u.id === p.ownedBy)?.nickname ?? "",
          owner_locale: this.users.find((u) => u.id === p.ownedBy)?.locale ?? null,
          reply_to_owner_id,
          reply_to_owner_nickname,
          count_replies: this.countRepliesFor(p.id),
          count_likes: this.countLikesFor(p.id),
          tags: this.tags
            .filter((t) => t.postId === p.id)
            .map((t) => t.name)
            .sort(),
        };
      };
      let pool = this.data.filter(
        (p) => p.ownedBy === ownedBy && p.publishedAt && p.publishedAt <= publishedUntil,
      );
      pool.sort((a, b) => {
        if (a.publishedAt === b.publishedAt)
          return asc ? a.id.localeCompare(b.id) : b.id.localeCompare(a.id);
        return asc
          ? a.publishedAt! < b.publishedAt!
            ? -1
            : 1
          : a.publishedAt! < b.publishedAt!
            ? 1
            : -1;
      });
      const rows = pool.slice(offset, offset + limit).map(buildRow);
      return { rows };
    }

    if (
      sql.startsWith(
        "SELECT p.id, p.owned_by, p.reply_to, p.published_at, p.updated_at, p.snippet, p.locale, p.allow_likes, p.allow_replies",
      ) &&
      sql.includes("FROM posts p") &&
      sql.includes("JOIN users u ON p.owned_by = u.id") &&
      sql.includes("WHERE p.id = $1")
    ) {
      const id = params![0];
      const hasUntil = sql.includes("p.published_at <=") || sql.includes("p.published_at<=");
      const until = hasUntil ? params?.[1] : undefined;
      const includeBlocking = this.selectsBlockingFlag(sql);
      const focusUserId = includeBlocking ? params?.[1] : undefined;
      const post = this.data.find((p) => p.id === id);
      if (!post) return { rows: [] };
      if (hasUntil && (!post.publishedAt || (until && post.publishedAt > until))) {
        return { rows: [] };
      }

      const replyToPost = this.data.find((pp) => pp.id === post.replyTo);
      const reply_to_owner_nickname = replyToPost
        ? (this.users.find((u) => u.id === replyToPost.ownedBy)?.nickname ?? null)
        : null;
      const reply_to_owner_id = replyToPost ? replyToPost.ownedBy : null;

      const owner = this.users.find((u) => u.id === post.ownedBy);

      const row: any = {
        id: post.id,
        owned_by: post.ownedBy,
        reply_to: post.replyTo,
        published_at: post.publishedAt ?? null,
        updated_at: post.updatedAt,
        snippet: "",
        locale: post.locale,
        allow_likes: post.allowLikes,
        allow_replies: post.allowReplies,
        created_at: post.createdAt,
        owner_nickname: owner?.nickname || "",
        owner_locale: owner?.locale ?? null,
        reply_to_owner_id,
        reply_to_owner_nickname,
        count_replies: this.countRepliesFor(post.id),
        count_likes: this.countLikesFor(post.id),
        tags: this.tags
          .filter((t) => t.postId === post.id)
          .map((t) => t.name)
          .sort(),
        content: post.content,
      };
      if (includeBlocking && focusUserId)
        row.is_blocking_focus_user = this.computeIsBlocking(post.ownedBy, focusUserId);
      return { rows: [row] };
    }

    if (sql.includes("FROM posts p") && sql.includes("JOIN users u ON p.owned_by = u.id")) {
      const includeBlocking = this.selectsBlockingFlag(sql);
      const focusUserId = includeBlocking ? params?.[0] : undefined;

      const mWhereId = sql.match(/WHERE\s+p\.id\s*=\s*\$(\d+)/i);
      const buildRow = (p: MockPostRow) => {
        const replyToPost = this.data.find((pp) => pp.id === p.replyTo);
        const reply_to_owner_nickname = replyToPost
          ? (this.users.find((u) => u.id === replyToPost.ownedBy)?.nickname ?? null)
          : null;
        const reply_to_owner_id = replyToPost ? replyToPost.ownedBy : null;

        const owner = this.users.find((u) => u.id === p.ownedBy);
        const row: any = {
          id: p.id,
          content: p.content,
          owned_by: p.ownedBy,
          reply_to: p.replyTo,
          published_at: p.publishedAt ?? null,
          updated_at: p.updatedAt,
          snippet: "",
          locale: p.locale,
          allow_likes: p.allowLikes,
          allow_replies: p.allowReplies,
          created_at: p.createdAt,
          owner_nickname: owner?.nickname ?? "",
          owner_locale: owner?.locale ?? null,
          reply_to_owner_id,
          reply_to_owner_nickname,
          count_replies: this.countRepliesFor(p.id),
          count_likes: this.countLikesFor(p.id),
          tags: this.tags
            .filter((t) => t.postId === p.id)
            .map((t) => t.name)
            .sort(),
        };
        if (includeBlocking && focusUserId)
          row.is_blocking_focus_user = this.computeIsBlocking(p.ownedBy, focusUserId);
        return row;
      };

      if (mWhereId) {
        const idx = parseInt(mWhereId[1], 10) - 1;
        const id = params![idx];
        const p = this.data.find((x) => x.id === id);
        return { rows: p ? [buildRow(p)] : [] };
      }

      const offset = params && params.length >= 2 ? (params[params.length - 2] ?? 0) : 0;
      const limit = params && params.length >= 1 ? (params[params.length - 1] ?? 100) : 100;
      const rows = this.data.map(buildRow).slice(offset, offset + limit);
      return { rows };
    }

    if (sql.startsWith("SELECT 1 FROM post_likes WHERE post_id = $1 AND liked_by = $2")) {
      const [postId, likedBy] = params!;
      const found = this.likes.some((l) => l.postId === postId && l.likedBy === likedBy);
      return { rows: found ? [{}] : [] };
    }

    if (sql.startsWith("SELECT 1 FROM posts WHERE reply_to = $1 AND owned_by = $2")) {
      const [replyTo, ownedBy] = params!;
      const found = this.data.some((p) => p.replyTo === replyTo && p.ownedBy === ownedBy);
      return { rows: found ? [{}] : [] };
    }

    if (/^SELECT\s+COUNT\(\*\)\s+FROM\s+posts/i.test(sql))
      return { rows: [{ count: String(this.data.length) }] };

    if (/^SELECT\b.+\bFROM\s+posts(?:\s+p)?\s+WHERE\s+id\s*=\s*\$(\d+)/i.test(sql)) {
      const m = sql.match(/WHERE\s+id\s*=\s*\$(\d+)/i);
      const idx = m ? parseInt(m[1], 10) - 1 : 0;
      const id = params![idx];
      const post = this.data.find((p) => p.id === id);
      return {
        rows: post
          ? [
              {
                id: post.id,
                content: post.content,
                owned_by: post.ownedBy,
                reply_to: post.replyTo,
                allow_likes: post.allowLikes,
                allow_replies: post.allowReplies,
                created_at: post.createdAt,
                updated_at: post.updatedAt,
                locale: post.locale,
              },
            ]
          : [],
      };
    }

    if (sql.includes("FROM post_likes pl") && sql.includes("JOIN posts p ON pl.post_id = p.id")) {
      const includeBlocking = this.selectsBlockingFlag(sql);
      const userId = params![0];
      const offset = params![params!.length - 2] ?? 0;
      const limit = params![params!.length - 1] ?? 100;
      const focusUserId = includeBlocking ? params![1] : undefined;

      const likedPostIds = this.likes.filter((l) => l.likedBy === userId).map((l) => l.postId);
      const posts = this.data.filter((p) => likedPostIds.includes(p.id));
      const rows = posts.map((p) => {
        const replyToPost = this.data.find((pp) => pp.id === p.replyTo);
        const replyToNickname = replyToPost
          ? (this.users.find((u) => u.id === replyToPost.ownedBy)?.nickname ?? null)
          : null;
        const replyToOwnerId = replyToPost ? replyToPost.ownedBy : null;

        const owner = this.users.find((u) => u.id === p.ownedBy);
        const row: any = {
          id: p.id,
          content: p.content,
          owned_by: p.ownedBy,
          reply_to: p.replyTo,
          published_at: p.publishedAt ?? null,
          locale: p.locale,
          allow_likes: p.allowLikes,
          allow_replies: p.allowReplies,
          created_at: p.createdAt,
          updated_at: p.updatedAt,
          owner_nickname: owner?.nickname ?? "",
          owner_locale: owner?.locale ?? null,
          reply_to_owner_id: replyToOwnerId,
          reply_to_owner_nickname: replyToNickname,
          count_replies: this.countRepliesFor(p.id),
          count_likes: this.countLikesFor(p.id),
          tags: this.tags
            .filter((t) => t.postId === p.id)
            .map((t) => t.name)
            .sort(),
        };
        if (includeBlocking && focusUserId)
          row.is_blocking_focus_user = this.computeIsBlocking(p.ownedBy, focusUserId);
        return row;
      });
      return { rows: rows.slice(offset, offset + limit) };
    }

    if (sql.startsWith("DELETE FROM posts")) {
      const id = params![0];
      const idx = this.data.findIndex((p) => p.id === id);
      if (idx >= 0) {
        this.data.splice(idx, 1);
        this.tags = this.tags.filter((t) => t.postId !== id);
        return { rowCount: 1 };
      }
      return { rowCount: 0 };
    }

    if (sql.startsWith("INSERT INTO post_likes")) {
      const [postId, likedBy] = params!;
      if (!this.likes.some((l) => l.postId === postId && l.likedBy === likedBy)) {
        this.likes.push({ postId, likedBy });
        return { rowCount: 1 };
      }
      return { rowCount: 0 };
    }

    if (sql.startsWith("DELETE FROM post_likes")) {
      const [postId, likedBy] = params!;
      const before = this.likes.length;
      this.likes = this.likes.filter((l) => !(l.postId === postId && l.likedBy === likedBy));
      return { rowCount: before !== this.likes.length ? 1 : 0 };
    }

    return { rows: [] };
  }
}

class MockRedis {}

describe("posts service", () => {
  let pgClient: MockPgClientMain;
  let redis: MockRedis;
  let postsService: PostsService;
  let postSample: MockPostRow;
  let user1Hex: string, user2Hex: string, user3Hex: string;

  beforeEach(() => {
    pgClient = new MockPgClientMain();
    redis = new MockRedis();
    postsService = new PostsService(pgClient as any, redis as any);

    user1Hex = hex16();
    user2Hex = hex16();
    user3Hex = hex16();

    pgClient.users.push({ id: toDecStr(user1Hex), nickname: "Alice", locale: "ja-JP" });
    pgClient.users.push({ id: toDecStr(user2Hex), nickname: "Bob", locale: "en-US" });
    pgClient.users.push({ id: toDecStr(user3Hex), nickname: "Carol", locale: "fr-FR" });

    postSample = {
      id: hex16(),
      content: "test post content",
      ownedBy: user1Hex,
      replyTo: null,
      allowLikes: true,
      allowReplies: true,
      createdAt: new Date().toISOString(),
      publishedAt: null,
      updatedAt: null,
      locale: "ja-JP",
    };

    pgClient.data.push({
      ...postSample,
      id: toDecStr(postSample.id),
      ownedBy: toDecStr(postSample.ownedBy),
      replyTo: postSample.replyTo ? toDecStr(postSample.replyTo) : null,
    });

    pgClient.tags.push({ postId: toDecStr(postSample.id), name: "tag1" });
    pgClient.likes.push({ postId: toDecStr(postSample.id), likedBy: toDecStr(hex16()) });
  });

  test("countPosts", async () => {
    expect(await postsService.countPosts()).toBe(1);

    const another = { ...postSample, id: hex16() };
    pgClient.data.push({
      ...another,
      id: toDecStr(another.id),
      ownedBy: toDecStr(another.ownedBy),
      replyTo: another.replyTo ? toDecStr(another.replyTo) : null,
    });

    expect(await postsService.countPosts()).toBe(2);
  });

  test("getPostLite: returns lite fields & tags", async () => {
    const lite = await postsService.getPostLite(postSample.id);
    expect(lite).not.toBeNull();
    expect(lite!.id).toBe(postSample.id);
    expect(lite!.ownerNickname).toBe("Alice");
    expect(lite!.replyToOwnerId).toBeNull();
    expect(lite!.tags).toContain("tag1");
    expect(typeof lite!.countLikes).toBe("number");
    expect(typeof lite!.countReplies).toBe("number");
  });

  test("listPosts: basic", async () => {
    const posts = await postsService.listPosts();
    expect(posts.length).toBeGreaterThanOrEqual(1);
    expect(posts[0].ownerNickname).toBe("Alice");
    expect(posts[0].ownerLocale).toBe("ja-JP");
    expect(posts[0].replyToOwnerId).toBeNull();
    expect(posts[0].tags).toContain("tag1");
    expect(posts[0].countLikes).toBeGreaterThanOrEqual(1);
  });

  test("listPostsByIds: keeps input order and ignores missing", async () => {
    const p2 = {
      id: hex16(),
      content: "p2",
      ownedBy: user2Hex,
      replyTo: null,
      allowLikes: true,
      allowReplies: true,
      createdAt: new Date().toISOString(),
      publishedAt: null,
      updatedAt: null,
      locale: "en-US",
    };
    pgClient.data.push({
      ...p2,
      id: toDecStr(p2.id),
      ownedBy: toDecStr(p2.ownedBy),
      replyTo: p2.replyTo ? toDecStr(p2.replyTo) : null,
    });
    pgClient.tags.push({ postId: toDecStr(p2.id), name: "tag2" });
    const miss = hex16();
    const got = await postsService.listPostsByIds([p2.id, miss, postSample.id]);
    expect(got.map((p) => p.id)).toEqual([p2.id, postSample.id]);
    expect(got[0].ownerNickname).toBe("Bob");
    expect(got[0].ownerLocale).toBe("en-US");
    expect(got[0].tags).toContain("tag2");
    expect(got[1].ownerNickname).toBe("Alice");
    expect(got[1].tags).toContain("tag1");
  });

  test("listPostsByIds: queries in 100-sized batches", async () => {
    const ids: string[] = [];
    for (let i = 0; i < 205; i++) {
      const id = hex16();
      ids.push(id);
      pgClient.data.push({
        id: toDecStr(id),
        ownedBy: toDecStr(user1Hex),
        replyTo: null,
        allowLikes: true,
        allowReplies: true,
        createdAt: new Date().toISOString(),
        publishedAt: null,
        updatedAt: null,
        content: `c${i}`,
        locale: "ja-JP",
      });
    }
    const spy = jest.spyOn(pgClient, "query");
    const got = await postsService.listPostsByIds(ids);
    const batchCalls = spy.mock.calls.filter((c) =>
      normalizeSql(String(c[0])).includes("WITH req AS ("),
    );
    expect(batchCalls.length).toBe(3);
    expect(got.length).toBe(205);
    expect(got[0].id).toBe(ids[0]);
    expect(got[204].id).toBe(ids[204]);
    spy.mockRestore();
  });

  test("createPost (then getPost for content) with locale null", async () => {
    const parentId = postSample.id;
    const input: CreatePostInput = {
      content: "new post content",
      ownedBy: user2Hex,
      replyTo: parentId,
      locale: null,
      allowLikes: true,
      allowReplies: true,
      publishedAt: null,
      tags: ["hello", "world"],
    };
    const created = await postsService.createPost(input);
    expect(created.ownedBy).toBe(user2Hex);
    expect(created.replyTo).toBe(parentId);
    expect(created.replyToOwnerId).toBe(user1Hex);
    expect(created.locale).toBeNull();
    expect(pgClient.tags.some((t) => t.postId === toDecStr(created.id) && t.name === "hello")).toBe(
      true,
    );
    expect(created.content).toBe("new post content");
  });

  test("getPost", async () => {
    const post = await postsService.getPost(postSample.id);
    expect(post).not.toBeNull();
    expect(post!.content).toBe(postSample.content);
    expect(post!.ownerLocale).toBe("ja-JP");
    expect(post!.replyToOwnerId).toBeNull();
  });

  test("getPost: not found", async () => {
    const post = await postsService.getPost(hex16());
    expect(post).toBeNull();
  });

  test("updatePost", async () => {
    const input: UpdatePostInput = {
      id: postSample.id,
      content: "updated content",
      replyTo: postSample.id,
      tags: ["foo", "bar"],
    };
    const post = await postsService.updatePost(input);
    expect(post).not.toBeNull();
    expect(post!.content).toBe("updated content");
    expect(post!.replyTo).toBe(postSample.id);
    expect(post!.replyToOwnerId).toBe(user1Hex);
    expect(
      pgClient.tags.some((t) => t.postId === toDecStr(postSample.id) && t.name === "foo"),
    ).toBe(true);
  });

  test("updatePost: partial", async () => {
    const input: UpdatePostInput = { id: postSample.id, content: "only content changed" };
    const post = await postsService.updatePost(input);
    expect(post).not.toBeNull();
    expect(post!.content).toBe("only content changed");
  });

  test("updatePost: locale can be set to null", async () => {
    const input: UpdatePostInput = { id: postSample.id, locale: null };
    const post = await postsService.updatePost(input);
    expect(post).not.toBeNull();
    expect(post!.locale).toBeNull();
  });

  test("updatePost: not found", async () => {
    const input: UpdatePostInput = { id: hex16(), content: "xxx" };
    const post = await postsService.updatePost(input);
    expect(post).toBeNull();
  });

  test("deletePost", async () => {
    await postsService.deletePost(postSample.id);
    expect(pgClient.data.length).toBe(0);
    expect(pgClient.tags.some((t) => t.postId === toDecStr(postSample.id))).toBe(false);
    await expect(postsService.deletePost(hex16())).rejects.toThrow(/post not found/i);
  });

  test("addLike: normal", async () => {
    const userId = user2Hex;
    await postsService.addLike(postSample.id, userId);
    expect(
      pgClient.likes.some(
        (l) => l.postId === toDecStr(postSample.id) && l.likedBy === toDecStr(userId),
      ),
    ).toBe(true);
  });

  test("addLike: duplicate should throw", async () => {
    const userId = user2Hex;
    await postsService.addLike(postSample.id, userId);
    await expect(postsService.addLike(postSample.id, userId)).rejects.toThrow(/already liked/i);
    expect(
      pgClient.likes.filter(
        (l) => l.postId === toDecStr(postSample.id) && l.likedBy === toDecStr(userId),
      ).length,
    ).toBe(1);
  });

  test("removeLike: normal", async () => {
    const userId = user2Hex;
    await postsService.addLike(postSample.id, userId);
    await postsService.removeLike(postSample.id, userId);
    expect(
      pgClient.likes.some(
        (l) => l.postId === toDecStr(postSample.id) && l.likedBy === toDecStr(userId),
      ),
    ).toBe(false);
  });

  test("removeLike: not found should throw", async () => {
    await expect(postsService.removeLike(postSample.id, hex16())).rejects.toThrow(/not liked/i);
  });

  test("listPosts: isBlockingFocusUser true when author blocks focus user", async () => {
    pgClient.blocks.push({ blockerId: toDecStr(user1Hex), blockeeId: toDecStr(user2Hex) });
    const posts = await postsService.listPosts({}, user2Hex);
    expect(posts[0].isBlockingFocusUser).toBe(true);
  });

  test("listPosts: isBlockingFocusUser with blockStrangers + not followed", async () => {
    pgClient.userBlockStrangers[toDecStr(user1Hex)] = true;
    const posts = await postsService.listPosts({}, user2Hex);
    expect(posts[0].isBlockingFocusUser).toBe(true);
  });

  test("listPosts: blockStrangers but author follows focus => not blocking", async () => {
    pgClient.userBlockStrangers[toDecStr(user1Hex)] = true;
    pgClient.follows.push({ followerId: toDecStr(user1Hex), followeeId: toDecStr(user2Hex) });
    const posts = await postsService.listPosts({}, user2Hex);
    expect(posts[0].isBlockingFocusUser).toBe(false);
  });
});

describe("listPostsByFollowees", () => {
  let pgClient: MockPgClientMain;
  let redis: MockRedis;
  let postsService: PostsService;
  let alice: string, bob: string, carol: string;
  let postAlice: MockPostRow, postBob: MockPostRow, postCarol: MockPostRow;

  beforeEach(() => {
    pgClient = new MockPgClientMain();
    redis = new MockRedis();
    postsService = new PostsService(pgClient as any, redis as any);

    alice = hex16();
    bob = hex16();
    carol = hex16();

    pgClient.users.push({ id: toDecStr(alice), nickname: "Alice", locale: "ja-JP" });
    pgClient.users.push({ id: toDecStr(bob), nickname: "Bob", locale: "en-US" });
    pgClient.users.push({ id: toDecStr(carol), nickname: "Carol", locale: "fr-FR" });

    pgClient.follows.push({ followerId: toDecStr(alice), followeeId: toDecStr(bob) });

    postAlice = {
      id: hex16(),
      content: "post-alice",
      ownedBy: alice,
      replyTo: null,
      allowLikes: true,
      allowReplies: true,
      createdAt: new Date().toISOString(),
      publishedAt: null,
      updatedAt: null,
      locale: "ja-JP",
    };
    postBob = {
      id: hex16(),
      content: "post-bob",
      ownedBy: bob,
      replyTo: null,
      allowLikes: true,
      allowReplies: true,
      createdAt: new Date().toISOString(),
      publishedAt: null,
      updatedAt: null,
      locale: "en-US",
    };
    postCarol = {
      id: hex16(),
      content: "post-carol",
      ownedBy: carol,
      replyTo: null,
      allowLikes: true,
      allowReplies: true,
      createdAt: new Date().toISOString(),
      publishedAt: null,
      updatedAt: null,
      locale: "fr-FR",
    };

    pgClient.data.push(
      { ...postAlice, id: toDecStr(postAlice.id), ownedBy: toDecStr(postAlice.ownedBy) },
      { ...postBob, id: toDecStr(postBob.id), ownedBy: toDecStr(postBob.ownedBy) },
      { ...postCarol, id: toDecStr(postCarol.id), ownedBy: toDecStr(postCarol.ownedBy) },
    );
  });

  test("should not include self posts when includeSelf is false", async () => {
    const input: ListPostsByFolloweesInput = {
      userId: alice,
      includeSelf: false,
      offset: 0,
      limit: 10,
      order: "desc",
    };
    const result = await postsService.listPostsByFollowees(input);
    expect(result.some((p) => p.ownedBy === alice)).toBe(false);
    expect(result.some((p) => p.ownedBy === bob)).toBe(true);
    expect(result.some((p) => p.ownedBy === carol)).toBe(false);
  });

  test("should include self posts when includeSelf is true", async () => {
    const input: ListPostsByFolloweesInput = {
      userId: alice,
      includeSelf: true,
      offset: 0,
      limit: 10,
      order: "desc",
    };
    const result = await postsService.listPostsByFollowees(input);
    expect(result.some((p) => p.ownedBy === alice)).toBe(true);
    expect(result.some((p) => p.ownedBy === bob)).toBe(true);
    expect(result.some((p) => p.ownedBy === carol)).toBe(false);
  });

  test("listPostsByFollowees: isBlockingFocusUser computed", async () => {
    pgClient.blocks.push({ blockerId: toDecStr(bob), blockeeId: toDecStr(alice) });
    const input: ListPostsByFolloweesInput = {
      userId: alice,
      includeSelf: false,
      offset: 0,
      limit: 10,
      order: "desc",
    };
    const result = await postsService.listPostsByFollowees(input, alice);
    const bobPost = result.find((p) => p.ownedBy === bob);
    expect(bobPost?.isBlockingFocusUser).toBe(true);
  });
});

describe("listPostsLikedByUser", () => {
  let pgClient: MockPgClientMain;
  let redis: MockRedis;
  let postsService: PostsService;
  let alice: string, bob: string;
  let post1: MockPostRow, post2: MockPostRow;

  beforeEach(() => {
    pgClient = new MockPgClientMain();
    redis = new MockRedis();
    postsService = new PostsService(pgClient as any, redis as any);

    alice = hex16();
    bob = hex16();

    pgClient.users.push({ id: toDecStr(alice), nickname: "Alice", locale: "ja-JP" });
    pgClient.users.push({ id: toDecStr(bob), nickname: "Bob", locale: "en-US" });

    post1 = {
      id: hex16(),
      content: "liked-by-alice",
      ownedBy: bob,
      replyTo: null,
      allowLikes: true,
      allowReplies: true,
      createdAt: new Date().toISOString(),
      publishedAt: null,
      updatedAt: null,
      locale: "en-US",
    };
    post2 = {
      id: hex16(),
      content: "not-liked",
      ownedBy: bob,
      replyTo: null,
      allowLikes: true,
      allowReplies: true,
      createdAt: new Date().toISOString(),
      publishedAt: null,
      updatedAt: null,
      locale: "en-US",
    };

    pgClient.data.push(
      { ...post1, id: toDecStr(post1.id), ownedBy: toDecStr(post1.ownedBy) },
      { ...post2, id: toDecStr(post2.id), ownedBy: toDecStr(post2.ownedBy) },
    );

    pgClient.likes.push({ postId: toDecStr(post1.id), likedBy: toDecStr(alice) });
  });

  test("should return posts liked by the user", async () => {
    const input: ListPostsLikedByUserInput = { userId: alice, offset: 0, limit: 10, order: "desc" };
    const result = await postsService.listPostsLikedByUser(input);
    expect(Array.isArray(result)).toBe(true);
    expect(result.some((p) => p.id === post1.id)).toBe(true);
    expect(result.some((p) => p.id === post2.id)).toBe(false);
    expect(result[0].ownerLocale).toBe("en-US");
    expect(result[0].replyToOwnerId).toBeNull();
  });

  test("should return empty array if user has not liked any posts", async () => {
    const input: ListPostsLikedByUserInput = { userId: bob, offset: 0, limit: 10, order: "desc" };
    const result = await postsService.listPostsLikedByUser(input);
    expect(result.length).toBe(0);
  });

  test("listPostsLikedByUser: isBlockingFocusUser computed", async () => {
    pgClient.blocks.push({ blockerId: toDecStr(bob), blockeeId: toDecStr(alice) });
    const input: ListPostsLikedByUserInput = { userId: alice, offset: 0, limit: 10, order: "desc" };
    const result = await postsService.listPostsLikedByUser(input, alice);
    expect(result.find((p) => p.id === post1.id)?.isBlockingFocusUser).toBe(true);
  });
});

describe("getPost", () => {
  class MockPgClient {
    posts: MockPostRow[] = [];
    users: { id: string; nickname: string; locale?: string | null }[] = [];
    postLikes: { postId: string; likedBy: string }[] = [];
    postTags: { postId: string; name: string }[] = [];
    blocks: { blockerId: string; blockeeId: string }[] = [];
    follows: { followerId: string; followeeId: string }[] = [];
    userBlockStrangers: Record<string, boolean> = {};

    private selectsBlockingFlag(sql: string) {
      return /\bas\s+is_blocking_focus_user\b/i.test(sql);
    }

    private computeIsBlocking(authorId: string, focusId: string) {
      const authorBlocks = this.blocks.some(
        (b) => b.blockerId === authorId && b.blockeeId === focusId,
      );
      const blockStrangers = !!this.userBlockStrangers[authorId];
      const authorFollowsFocus = this.follows.some(
        (f) => f.followerId === authorId && f.followeeId === focusId,
      );
      return authorBlocks || (blockStrangers && !authorFollowsFocus);
    }

    async query(sql: string, params?: any[]) {
      sql = normalizeSql(sql);

      if (sql.includes("FROM posts p") && sql.includes("JOIN users u ON p.owned_by = u.id")) {
        const includeBlocking = this.selectsBlockingFlag(sql);
        const focusUserId = includeBlocking ? params?.[1] : undefined;
        const id = params![0];
        const p = this.posts.find((x) => x.id === id);
        if (!p) return { rows: [] };

        const u = this.users.find((x) => x.id === p.ownedBy);
        const count_replies = this.posts.filter((x) => x.replyTo === p.id).length;
        const count_likes = this.postLikes.filter((x) => x.postId === p.id).length;
        const tags = this.postTags
          .filter((x) => x.postId === p.id)
          .map((x) => x.name)
          .sort();

        const replyToPost = this.posts.find((pp) => pp.id === p.replyTo);
        const reply_to_owner_nickname = replyToPost
          ? (this.users.find((u) => u.id === replyToPost.ownedBy)?.nickname ?? null)
          : null;
        const reply_to_owner_id = replyToPost ? replyToPost.ownedBy : null;

        const row: any = {
          id: p.id,
          content: p.content,
          owned_by: p.ownedBy,
          reply_to: p.replyTo,
          allow_likes: p.allowLikes,
          allow_replies: p.allowReplies,
          created_at: p.createdAt,
          updated_at: p.updatedAt,
          owner_nickname: u?.nickname || "",
          owner_locale: u?.locale ?? null,
          reply_to_owner_id,
          reply_to_owner_nickname,
          count_replies,
          count_likes,
          tags,
          locale: p.locale,
          published_at: p.publishedAt,
        };
        if (includeBlocking && focusUserId)
          row.is_blocking_focus_user = this.computeIsBlocking(p.ownedBy, focusUserId);
        return { rows: [row] };
      }

      if (sql.startsWith("SELECT 1 FROM post_likes WHERE post_id = $1 AND liked_by = $2")) {
        const [postId, likedBy] = params!;
        const found = this.postLikes.some((l) => l.postId === postId && l.likedBy === likedBy);
        return { rows: found ? [{}] : [] };
      }

      if (sql.startsWith("SELECT 1 FROM posts WHERE reply_to = $1 AND owned_by = $2")) {
        const [replyTo, ownedBy] = params!;
        const found = this.posts.some((p) => p.replyTo === replyTo && p.ownedBy === ownedBy);
        return { rows: found ? [{}] : [] };
      }

      return { rows: [] };
    }
  }

  let pgClient: MockPgClient;
  let redis: MockRedis;
  let postsService: PostsService;
  let post: MockPostRow;
  let owner: { id: string; nickname: string; locale?: string | null };

  beforeEach(() => {
    pgClient = new MockPgClient();
    redis = new MockRedis();
    postsService = new PostsService(pgClient as any, redis as any);

    owner = { id: hex16(), nickname: "Poster", locale: "ja-JP" };
    pgClient.users.push({ id: toDecStr(owner.id), nickname: owner.nickname, locale: owner.locale });

    post = {
      id: hex16(),
      content: "content",
      ownedBy: owner.id,
      replyTo: null,
      allowLikes: true,
      allowReplies: true,
      createdAt: new Date().toISOString(),
      publishedAt: null,
      updatedAt: null,
      locale: "ja-JP",
    };

    pgClient.posts.push({ ...post, id: toDecStr(post.id), ownedBy: toDecStr(post.ownedBy) });
    pgClient.postLikes.push(
      { postId: toDecStr(post.id), likedBy: toDecStr(hex16()) },
      { postId: toDecStr(post.id), likedBy: toDecStr(hex16()) },
    );
    pgClient.postTags.push(
      { postId: toDecStr(post.id), name: "tag1" },
      { postId: toDecStr(post.id), name: "tag2" },
    );
    pgClient.posts.push(
      {
        id: toDecStr(hex16()),
        content: "reply1",
        ownedBy: toDecStr(hex16()),
        replyTo: toDecStr(post.id),
        allowLikes: true,
        allowReplies: true,
        createdAt: new Date().toISOString(),
        publishedAt: null,
        updatedAt: null,
        locale: "en-US",
      },
      {
        id: toDecStr(hex16()),
        content: "reply2",
        ownedBy: toDecStr(hex16()),
        replyTo: toDecStr(post.id),
        allowLikes: true,
        allowReplies: true,
        createdAt: new Date().toISOString(),
        publishedAt: null,
        updatedAt: null,
        locale: "en-US",
      },
    );
  });

  test("getPost returns all meta correctly", async () => {
    const result = await postsService.getPost(post.id);
    expect(result).not.toBeNull();
    expect(result!.id).toBe(post.id);
    expect(result!.ownerNickname).toBe(owner.nickname);
    expect(result!.ownerLocale).toBe("ja-JP");
    expect(result!.replyToOwnerId).toBeNull();
    expect(result!.countReplies).toBe(2);
    expect(result!.countLikes).toBe(2);
    expect(result!.tags.sort()).toEqual(["tag1", "tag2"]);
    expect(result!.locale).toBe("ja-JP");
  });

  test("getPost: not found returns null", async () => {
    const result = await postsService.getPost(hex16());
    expect(result).toBeNull();
  });

  test("getPost: no likes, no replies, no tags", async () => {
    const anotherOwner = { id: hex16(), nickname: "Nobody", locale: "en-US" };
    pgClient.users.push({
      id: toDecStr(anotherOwner.id),
      nickname: anotherOwner.nickname,
      locale: anotherOwner.locale,
    });

    const p2: MockPostRow = {
      id: hex16(),
      content: "empty",
      ownedBy: anotherOwner.id,
      replyTo: null,
      allowLikes: true,
      allowReplies: true,
      createdAt: new Date().toISOString(),
      publishedAt: null,
      updatedAt: null,
      locale: "en-US",
    };
    pgClient.posts.push({ ...p2, id: toDecStr(p2.id), ownedBy: toDecStr(p2.ownedBy) });

    const got = await postsService.getPost(p2.id);
    expect(got).not.toBeNull();
    expect(got!.ownerNickname).toBe("Nobody");
    expect(got!.ownerLocale).toBe("en-US");
    expect(got!.replyToOwnerId).toBeNull();
    expect(got!.countReplies).toBe(0);
    expect(got!.countLikes).toBe(0);
    expect(got!.tags).toEqual([]);
  });

  test("getPost: isBlockingFocusUser true when blocked by author", async () => {
    const focus = hex16();
    (pgClient as any).blocks = [{ blockerId: toDecStr(owner.id), blockeeId: toDecStr(focus) }];
    const got = await postsService.getPost(post.id, focus);
    expect(got?.isBlockingFocusUser).toBe(true);
  });

  test("getPost: blockStrangers + not followed => true; followed => false", async () => {
    const focus = hex16();
    (pgClient as any).userBlockStrangers = { [toDecStr(owner.id)]: true };
    const got1 = await postsService.getPost(post.id, focus);
    expect(got1?.isBlockingFocusUser).toBe(true);

    (pgClient as any).follows = [{ followerId: toDecStr(owner.id), followeeId: toDecStr(focus) }];
    const got2 = await postsService.getPost(post.id, focus);
    expect(got2?.isBlockingFocusUser).toBe(false);
  });
});

class MockPgClientLikers {
  users: User[] = [];
  postLikes: { postId: string; likedBy: string; createdAt: string }[] = [];

  async query(sql: string, params?: any[]) {
    sql = normalizeSql(sql);

    if (
      sql.includes("FROM post_likes pl") &&
      sql.includes("JOIN users u ON pl.liked_by = u.id") &&
      sql.includes("WHERE pl.post_id = $1")
    ) {
      const postId = params![0];
      const offset = params![1] ?? 0;
      const limit = params![2] ?? 0;

      const likes = this.postLikes
        .filter((l) => l.postId === postId)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        .slice(offset, offset + limit);

      const likedUserIds = likes.map((l) => l.likedBy);
      const result = (this.users as any[])
        .filter((u) => likedUserIds.includes(u.id))
        .map((u) => ({
          id: u.id,
          email: (u as any).email,
          nickname: (u as any).nickname,
          is_admin: (u as any).isAdmin ?? false,
          block_strangers: (u as any).blockStrangers ?? false,
          snippet: (u as any).snippet ?? "",
          avatar: (u as any).avatar ?? null,
          ai_model: (u as any).aiModel ?? "",
          created_at: (u as any).createdAt,
          updated_at: (u as any).updatedAt,
          count_followers: (u as any).countFollowers ?? 0,
          count_followees: (u as any).countFollowees ?? 0,
          count_posts: (u as any).countPosts ?? 0,
        }));

      return { rows: result };
    }

    return { rows: [] };
  }
}

describe("listLikers", () => {
  let pgClient: MockPgClientLikers;
  let redis: MockRedis;
  let postsService: PostsService;
  let user1: User, user2: User, user3: User, postId: string;

  beforeEach(() => {
    pgClient = new MockPgClientLikers();
    redis = new MockRedis();
    postsService = new PostsService(pgClient as any, redis as any);

    user1 = {
      id: hex16(),
      email: "alice@example.com",
      nickname: "Alice",
      isAdmin: false,
      snippet: "",
      avatar: null,
      aiModel: "",
      createdAt: new Date().toISOString(),
      updatedAt: null,
      countFollowers: 0,
      countFollowees: 0,
      countPosts: 0,
    } as unknown as User;

    user2 = {
      id: hex16(),
      email: "bob@example.com",
      nickname: "Bob",
      isAdmin: false,
      snippet: "",
      avatar: null,
      aiModel: "",
      createdAt: new Date().toISOString(),
      updatedAt: null,
      countFollowers: 0,
      countFollowees: 0,
      countPosts: 0,
    } as unknown as User;

    user3 = {
      id: hex16(),
      email: "carol@example.com",
      nickname: "Carol",
      isAdmin: false,
      snippet: "",
      avatar: null,
      aiModel: "",
      createdAt: new Date().toISOString(),
      updatedAt: null,
      countFollowers: 0,
      countFollowees: 0,
      countPosts: 0,
    } as unknown as User;

    postId = hex16();

    (pgClient.users as any).push(
      { ...user1, id: toDecStr(user1.id) },
      { ...user2, id: toDecStr(user2.id) },
      { ...user3, id: toDecStr(user3.id) },
    );

    pgClient.postLikes.push(
      { postId: toDecStr(postId), likedBy: toDecStr(user1.id), createdAt: "2024-01-01T12:00:00Z" },
      { postId: toDecStr(postId), likedBy: toDecStr(user2.id), createdAt: "2024-01-02T12:00:00Z" },
    );
  });

  test("should return users who liked a post", async () => {
    const users = await postsService.listLikers({
      postId: postId,
      offset: 0,
      limit: 10,
      order: "desc",
    } as ListLikersInput);
    expect(users.length).toBe(2);
    expect(users.some((u) => u.id === user1.id)).toBe(true);
    expect(users.some((u) => u.id === user2.id)).toBe(true);
  });

  test("should respect limit and offset", async () => {
    const users1 = await postsService.listLikers({
      postId: postId,
      offset: 0,
      limit: 1,
      order: "desc",
    } as ListLikersInput);
    expect(users1.length).toBe(1);

    const users2 = await postsService.listLikers({
      postId: postId,
      offset: 1,
      limit: 1,
      order: "desc",
    } as ListLikersInput);
    expect(users2.length).toBe(1);
    expect(users1[0].id).not.toBe(users2[0].id);
  });

  test("should return empty array if no likes", async () => {
    const users = await postsService.listLikers({
      postId: hex16(),
      offset: 0,
      limit: 10,
      order: "desc",
    } as ListLikersInput);
    expect(users.length).toBe(0);
  });
});

describe("public posts (getPubPost / listPubPostsByUser)", () => {
  let pgClient: MockPgClientMain;
  let redis: MockRedis;
  let postsService: PostsService;
  let alice: string, bob: string;

  beforeEach(() => {
    pgClient = new MockPgClientMain();
    redis = new MockRedis();
    postsService = new PostsService(pgClient as any, redis as any);

    alice = hex16();
    bob = hex16();

    pgClient.users.push({ id: toDecStr(alice), nickname: "Alice", locale: "ja-JP" });
    pgClient.users.push({ id: toDecStr(bob), nickname: "Bob", locale: "en-US" });
  });

  test("getPubPost returns only when publishedAt <= publishedUntil", async () => {
    const idHex = hex16();
    const p1: MockPostRow = {
      id: toDecStr(idHex),
      ownedBy: toDecStr(alice),
      replyTo: null,
      allowLikes: true,
      allowReplies: true,
      createdAt: "2024-01-01T00:00:00Z",
      publishedAt: "2024-01-10T00:00:00Z",
      updatedAt: null,
      content: "A",
      locale: "ja-JP",
    };
    pgClient.data.push(p1);

    const until1 = "2024-01-05T00:00:00Z";
    const until2 = "2024-01-10T00:00:00Z";
    const until3 = "2024-01-11T00:00:00Z";

    const miss = await postsService.getPubPost(hex16(), until1);
    expect(miss).toBeNull();

    const hitEq = await postsService.getPubPost(idHex, until2);
    expect(hitEq).not.toBeNull();
    expect(hitEq!.publishedAt).toBe("2024-01-10T00:00:00Z");
    expect(hitEq!.ownerLocale).toBe("ja-JP");
    expect(hitEq!.replyToOwnerId).toBeNull();

    const hitGt = await postsService.getPubPost(idHex, until3);
    expect(hitGt).not.toBeNull();
    expect(hitGt!.publishedAt).toBe("2024-01-10T00:00:00Z");
    expect(hitGt!.ownerLocale).toBe("ja-JP");
    expect(hitGt!.replyToOwnerId).toBeNull();
  });

  test("listPubPostsByUser includes equality (<=) and honors order asc", async () => {
    const pA1: MockPostRow = {
      id: toDecStr(hex16()),
      ownedBy: toDecStr(alice),
      replyTo: null,
      allowLikes: true,
      allowReplies: true,
      createdAt: "2024-01-01T00:00:00Z",
      publishedAt: "2024-01-01T00:00:00Z",
      updatedAt: null,
      content: "A1",
      locale: "ja-JP",
    };
    const pA2: MockPostRow = {
      id: toDecStr(hex16()),
      ownedBy: toDecStr(alice),
      replyTo: null,
      allowLikes: true,
      allowReplies: true,
      createdAt: "2024-01-03T00:00:00Z",
      publishedAt: "2024-01-03T00:00:00Z",
      updatedAt: null,
      content: "A2",
      locale: "ja-JP",
    };
    const pB1: MockPostRow = {
      id: toDecStr(hex16()),
      ownedBy: toDecStr(bob),
      replyTo: null,
      allowLikes: true,
      allowReplies: true,
      createdAt: "2024-01-02T00:00:00Z",
      publishedAt: "2024-01-02T00:00:00Z",
      updatedAt: null,
      content: "B1",
      locale: "en-US",
    };
    pgClient.data.push(pA1, pA2, pB1);

    const until = "2024-01-03T00:00:00Z";

    const listAsc = await postsService.listPubPostsByUser(alice, until, {
      offset: 0,
      limit: 10,
      order: "asc",
    } as PostPagination);
    expect(listAsc.map((p) => p.publishedAt)).toEqual([pA1.publishedAt, pA2.publishedAt]);
    expect(listAsc[0].ownerLocale).toBe("ja-JP");
    expect(listAsc[0].replyToOwnerId).toBeNull();
  });

  test("listPubPostsByUser offset/limit", async () => {
    const mk = (d: string) =>
      ({
        id: toDecStr(hex16()),
        ownedBy: toDecStr(alice),
        replyTo: null,
        allowLikes: true,
        allowReplies: true,
        createdAt: d,
        publishedAt: d,
        updatedAt: null,
        content: d,
        locale: "ja-JP",
      }) as MockPostRow;
    const rows = [
      mk("2024-01-01T00:00:00Z"),
      mk("2024-01-02T00:00:00Z"),
      mk("2024-01-03T00:00:00Z"),
    ];
    pgClient.data.push(...rows);

    const until = "2024-01-03T00:00:00Z";

    const page1 = await postsService.listPubPostsByUser(alice, until, {
      offset: 0,
      limit: 2,
      order: "asc",
    });
    const page2 = await postsService.listPubPostsByUser(alice, until, {
      offset: 2,
      limit: 2,
      order: "asc",
    });
    expect(page1.length).toBe(2);
    expect(page2.length).toBe(1);
    expect(page1[0].publishedAt! <= page1[1].publishedAt!).toBe(true);
    expect(page2[0].publishedAt).toBe("2024-01-03T00:00:00Z");
  });

  test("listPubPostsByUser filters by user and by publishedUntil", async () => {
    const mk = (owner: string, d: string) =>
      ({
        id: toDecStr(hex16()),
        ownedBy: toDecStr(owner),
        replyTo: null,
        allowLikes: true,
        allowReplies: true,
        createdAt: d,
        publishedAt: d,
        updatedAt: null,
        content: d,
        locale: owner === alice ? "ja-JP" : "en-US",
      }) as MockPostRow;
    const a1 = mk(alice, "2024-02-01T00:00:00Z");
    const a2 = mk(alice, "2024-02-10T00:00:00Z");
    const b1 = mk(bob, "2024-02-05T00:00:00Z");
    pgClient.data.push(a1, a2, b1);

    const until = "2024-02-05T00:00:00Z";
    const list = await postsService.listPubPostsByUser(alice, until, { order: "desc" });
    expect(list.map((p) => p.publishedAt)).toEqual(["2024-02-01T00:00:00Z"]);
  });
});
