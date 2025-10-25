import { PostsService } from "./posts";
import {
  CreatePostInput,
  UpdatePostInput,
  ListPostsByFolloweesInput,
  ListPostsLikedByUserInput,
  ListLikersInput,
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
  updatedAt: string | null;
  content: string;
};

class MockPgClientMain {
  data: MockPostRow[] = [];
  tags: { postId: string; name: string }[] = [];
  likes: { postId: string; likedBy: string }[] = [];
  follows: { followerId: string; followeeId: string }[] = [];
  users: { id: string; nickname: string }[] = [];
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
        "INSERT INTO posts (id, owned_by, reply_to, published_at, updated_at, locale, snippet, allow_likes, allow_replies) VALUES",
      )
    ) {
      const [id, ownedBy, replyTo, publishedAt, _locale, _snippet, allowLikes, allowReplies] =
        params!;
      const createdAt = new Date().toISOString();
      const newPost: MockPostRow = {
        id,
        ownedBy,
        replyTo: replyTo ?? null,
        allowLikes: !!allowLikes,
        allowReplies: !!allowReplies,
        createdAt,
        updatedAt: null,
        content: "",
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
            locale: _locale,
            snippet: _snippet,
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
        allow_likes: "allowLikes",
        allow_replies: "allowReplies",
        created_at: "createdAt",
        updated_at: "updatedAt",
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
        const base = {
          id: p.id,
          owned_by: p.ownedBy,
          reply_to: p.replyTo,
          allow_likes: p.allowLikes,
          allow_replies: p.allowReplies,
          created_at: p.createdAt,
          updated_at: p.updatedAt,
          owner_nickname: this.users.find((u) => u.id === p.ownedBy)?.nickname ?? "",
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
      sql.startsWith(
        "SELECT p.id, p.owned_by, p.reply_to, p.published_at, p.updated_at, p.allow_likes, p.allow_replies",
      ) &&
      sql.includes("FROM posts p") &&
      sql.includes("JOIN users u ON p.owned_by = u.id") &&
      sql.includes("WHERE p.id = $1")
    ) {
      const id = params![0];
      const includeBlocking = this.selectsBlockingFlag(sql);
      const focusUserId = includeBlocking ? params?.[1] : undefined;
      const post = this.data.find((p) => p.id === id);
      if (!post) return { rows: [] };

      const replyToPost = this.data.find((pp) => pp.id === post.replyTo);
      const reply_to_owner_nickname = replyToPost
        ? (this.users.find((u) => u.id === replyToPost.ownedBy)?.nickname ?? null)
        : null;

      const row: any = {
        id: post.id,
        owned_by: post.ownedBy,
        reply_to: post.replyTo,
        published_at: null,
        updated_at: post.updatedAt,
        allow_likes: post.allowLikes,
        allow_replies: post.allowReplies,
        created_at: post.createdAt,
        owner_nickname: this.users.find((u) => u.id === post.ownedBy)?.nickname ?? "",
        reply_to_owner_nickname,
        count_replies: this.countRepliesFor(post.id),
        count_likes: this.countLikesFor(post.id),
        tags: this.tags
          .filter((t) => t.postId === post.id)
          .map((t) => t.name)
          .sort(),
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
        const row: any = {
          id: p.id,
          content: p.content,
          owned_by: p.ownedBy,
          reply_to: p.replyTo,
          allow_likes: p.allowLikes,
          allow_replies: p.allowReplies,
          created_at: p.createdAt,
          updated_at: p.updatedAt,
          owner_nickname: this.users.find((u) => u.id === p.ownedBy)?.nickname ?? "",
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

    if (
      sql.startsWith("SELECT post_id FROM post_likes WHERE post_id = ANY($1) AND liked_by = $2")
    ) {
      const [postIds, likedBy] = params as [string[], string];
      const rows = this.likes
        .filter((l) => postIds.includes(l.postId) && l.likedBy === likedBy)
        .map((l) => ({ post_id: l.postId }));
      return { rows };
    }

    if (sql.startsWith("SELECT reply_to FROM posts WHERE reply_to = ANY($1) AND owned_by = $2")) {
      const [postIds, ownedBy] = params as [string[], string];
      const rows = this.data
        .filter((p) => postIds.includes(p.replyTo ?? "") && p.ownedBy === ownedBy)
        .map((p) => ({ reply_to: p.replyTo }));
      return { rows };
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
        const row: any = {
          id: p.id,
          content: p.content,
          owned_by: p.ownedBy,
          reply_to: p.replyTo,
          allow_likes: p.allowLikes,
          allow_replies: p.allowReplies,
          created_at: p.createdAt,
          updated_at: p.updatedAt,
          owner_nickname: this.users.find((u) => u.id === p.ownedBy)?.nickname ?? "",
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

    pgClient.users.push({ id: toDecStr(user1Hex), nickname: "Alice" });
    pgClient.users.push({ id: toDecStr(user2Hex), nickname: "Bob" });
    pgClient.users.push({ id: toDecStr(user3Hex), nickname: "Carol" });

    postSample = {
      id: hex16(),
      content: "test post content",
      ownedBy: user1Hex,
      replyTo: null,
      allowLikes: true,
      allowReplies: true,
      createdAt: new Date().toISOString(),
      updatedAt: null,
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
    expect(lite!.tags).toContain("tag1");
    expect(typeof lite!.countLikes).toBe("number");
    expect(typeof lite!.countReplies).toBe("number");
  });

  test("listPosts: basic", async () => {
    const posts = await postsService.listPosts();
    expect(posts.length).toBeGreaterThanOrEqual(1);
    expect(posts[0].ownerNickname).toBe("Alice");
    expect(posts[0].tags).toContain("tag1");
    expect(posts[0].countLikes).toBeGreaterThanOrEqual(1);
  });

  test("createPost (then getPost for content)", async () => {
    const parentId = postSample.id;
    const input: CreatePostInput = {
      content: "new post content",
      ownedBy: user2Hex,
      replyTo: parentId,
      locale: "und",
      allowLikes: true,
      allowReplies: true,
      publishedAt: null,
      tags: ["hello", "world"],
    };
    const created = await postsService.createPost(input);
    expect(created.ownedBy).toBe(user2Hex);
    expect(created.replyTo).toBe(parentId);

    const detail = await postsService.getPost(created.id);
    expect(detail!.content).toBe("new post content");

    expect(pgClient.tags.some((t) => t.postId === toDecStr(created.id) && t.name === "hello")).toBe(
      true,
    );
  });

  test("getPost", async () => {
    const post = await postsService.getPost(postSample.id);
    expect(post).not.toBeNull();
    expect(post!.content).toBe(postSample.content);
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

    pgClient.users.push({ id: toDecStr(alice), nickname: "Alice" });
    pgClient.users.push({ id: toDecStr(bob), nickname: "Bob" });
    pgClient.users.push({ id: toDecStr(carol), nickname: "Carol" });

    pgClient.follows.push({ followerId: toDecStr(alice), followeeId: toDecStr(bob) });

    postAlice = {
      id: hex16(),
      content: "post-alice",
      ownedBy: alice,
      replyTo: null,
      allowLikes: true,
      allowReplies: true,
      createdAt: new Date().toISOString(),
      updatedAt: null,
    };
    postBob = {
      id: hex16(),
      content: "post-bob",
      ownedBy: bob,
      replyTo: null,
      allowLikes: true,
      allowReplies: true,
      createdAt: new Date().toISOString(),
      updatedAt: null,
    };
    postCarol = {
      id: hex16(),
      content: "post-carol",
      ownedBy: carol,
      replyTo: null,
      allowLikes: true,
      allowReplies: true,
      createdAt: new Date().toISOString(),
      updatedAt: null,
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

    pgClient.users.push({ id: toDecStr(alice), nickname: "Alice" });
    pgClient.users.push({ id: toDecStr(bob), nickname: "Bob" });

    post1 = {
      id: hex16(),
      content: "liked-by-alice",
      ownedBy: bob,
      replyTo: null,
      allowLikes: true,
      allowReplies: true,
      createdAt: new Date().toISOString(),
      updatedAt: null,
    };
    post2 = {
      id: hex16(),
      content: "not-liked",
      ownedBy: bob,
      replyTo: null,
      allowLikes: true,
      allowReplies: true,
      createdAt: new Date().toISOString(),
      updatedAt: null,
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
    users: { id: string; nickname: string }[] = [];
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
          reply_to_owner_nickname,
          count_replies,
          count_likes,
          tags,
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
  let owner: { id: string; nickname: string };

  beforeEach(() => {
    pgClient = new MockPgClient();
    redis = new MockRedis();
    postsService = new PostsService(pgClient as any, redis as any);

    owner = { id: hex16(), nickname: "Poster" };
    pgClient.users.push({ id: toDecStr(owner.id), nickname: owner.nickname });

    post = {
      id: hex16(),
      content: "content",
      ownedBy: owner.id,
      replyTo: null,
      allowLikes: true,
      allowReplies: true,
      createdAt: new Date().toISOString(),
      updatedAt: null,
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
        updatedAt: null,
      },
      {
        id: toDecStr(hex16()),
        content: "reply2",
        ownedBy: toDecStr(hex16()),
        replyTo: toDecStr(post.id),
        allowLikes: true,
        allowReplies: true,
        createdAt: new Date().toISOString(),
        updatedAt: null,
      },
    );
  });

  test("getPost returns all meta correctly", async () => {
    const result = await postsService.getPost(post.id);
    expect(result).not.toBeNull();
    expect(result!.id).toBe(post.id);
    expect(result!.ownerNickname).toBe(owner.nickname);
    expect(result!.countReplies).toBe(2);
    expect(result!.countLikes).toBe(2);
    expect(result!.tags.sort()).toEqual(["tag1", "tag2"]);
  });

  test("getPost: not found returns null", async () => {
    const result = await postsService.getPost(hex16());
    expect(result).toBeNull();
  });

  test("getPost: no likes, no replies, no tags", async () => {
    const anotherOwner = { id: hex16(), nickname: "Nobody" };
    pgClient.users.push({ id: toDecStr(anotherOwner.id), nickname: anotherOwner.nickname });

    const p2: MockPostRow = {
      id: hex16(),
      content: "empty",
      ownedBy: anotherOwner.id,
      replyTo: null,
      allowLikes: true,
      allowReplies: true,
      createdAt: new Date().toISOString(),
      updatedAt: null,
    };
    pgClient.posts.push({ ...p2, id: toDecStr(p2.id), ownedBy: toDecStr(p2.ownedBy) });

    const got = await postsService.getPost(p2.id);
    expect(got).not.toBeNull();
    expect(got!.ownerNickname).toBe("Nobody");
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
