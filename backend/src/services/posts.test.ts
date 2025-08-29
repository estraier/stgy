import { v4 as uuidv4 } from "uuid";
import { PostsService } from "./posts";
import {
  Post,
  CreatePostInput,
  UpdatePostInput,
  ListPostsByFolloweesInput,
  ListPostsLikedByUserInput,
  ListLikersInput,
} from "../models/post";
import { User } from "../models/user";

function normalizeSql(sql: string) {
  return sql.replace(/\s+/g, " ").trim();
}

class MockPgClientMain {
  data: Post[] = [];
  tags: { postId: string; name: string }[] = [];
  likes: { postId: string; likedBy: string }[] = [];
  follows: { followerId: string; followeeId: string }[] = [];
  users: { id: string; nickname: string }[] = [];
  txCount = 0;

  private countRepliesFor(postId: string) {
    return this.data.filter((r) => r.replyTo === postId).length;
  }
  private countLikesFor(postId: string) {
    return this.likes.filter((l) => l.postId === postId).length;
  }

  async query(sql: string, params?: any[]) {
    sql = normalizeSql(sql);

    if (sql === "BEGIN" || sql === "COMMIT" || sql === "ROLLBACK") {
      this.txCount++;
      return { rows: [] };
    }

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

    if (sql.startsWith("INSERT INTO posts")) {
      const newPost: Post = {
        id: params![0],
        content: params![1],
        ownedBy: params![2],
        replyTo: params![3] ?? null,
        allowLikes: true,
        allowReplies: true,
        createdAt: new Date().toISOString(),
        updatedAt: null,
        ownerNickname: params![2],
        replyToOwnerNickname: params![3] ?? null,
        countLikes: 0,
        countReplies: 0,
        tags: [] as string[],
      };
      this.data.push(newPost);
      return { rows: [newPost] };
    }

    if (sql.startsWith("INSERT INTO post_tags")) {
      for (let i = 1; i < params!.length; i++) {
        this.tags.push({ postId: params![0], name: params![i] });
      }
      return { rowCount: params!.length - 1 };
    }
    if (sql.startsWith("DELETE FROM post_tags WHERE post_id = $1")) {
      const postId = params![0];
      this.tags = this.tags.filter((t) => t.postId !== postId);
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

      const colMap: Record<string, keyof Post> = {
        id: "id",
        content: "content",
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
        const key = colMap[col];
        if (!key) {
          paramCursor++;
          continue;
        }
        (post as any)[key] = params![paramCursor++];
      }
      return { rows: [post] };
    }

    if (
      sql.includes("WITH f AS") &&
      sql.includes("JOIN LATERAL") &&
      sql.includes("JOIN posts p ON p.id")
    ) {
      const includesTopActive = /top_followees/i.test(sql);
      const userId = params![0];
      const activeLimit = includesTopActive ? (params?.[1] ?? Number.MAX_SAFE_INTEGER) : undefined;
      const offset = includesTopActive ? (params?.[3] ?? 0) : (params?.[2] ?? 0);
      const limit = includesTopActive ? (params?.[4] ?? 100) : (params?.[3] ?? 100);

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
      const cmp = (a: Post, b: Post) =>
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
        return {
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
      });

      return { rows };
    }

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

    if (/^SELECT\s+COUNT\(\*\)\s+FROM\s+posts/i.test(sql)) {
      return { rows: [{ count: String(this.data.length) }] };
    }

    if (sql.startsWith("SELECT 1 FROM post_likes")) {
      const [postId, likedBy] = params!;
      const found = this.likes.some((l) => l.postId === postId && l.likedBy === likedBy);
      return { rows: found ? [{}] : [] };
    }
    if (sql.startsWith("SELECT 1 FROM posts WHERE reply_to =")) {
      const [replyTo, ownedBy] = params!;
      const found = this.data.some((p) => p.replyTo === replyTo && p.ownedBy === ownedBy);
      return { rows: found ? [{}] : [] };
    }

    if (
      sql.includes("WHERE p.owned_by IN") &&
      sql.includes("FROM posts p") &&
      sql.includes("JOIN users u ON p.owned_by = u.id")
    ) {
      const userId = params![0];
      const offset = params![1] ?? 0;
      const limit = params![2] ?? 100;
      let followeeIds = this.follows
        .filter((f) => f.followerId === userId)
        .map((f) => f.followeeId);
      if (sql.includes("UNION SELECT $1")) {
        followeeIds.push(userId);
      }
      followeeIds = Array.from(new Set(followeeIds));
      const posts = this.data.filter((p) => followeeIds.includes(p.ownedBy));
      const rows = posts.map((p) => {
        const replyToPost = this.data.find((pp) => pp.id === p.replyTo);
        const replyToNickname = replyToPost
          ? (this.users.find((u) => u.id === replyToPost.ownedBy)?.nickname ?? null)
          : null;
        return {
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
      });
      return { rows: rows.slice(offset, offset + limit) };
    }

    if (sql.includes("FROM post_likes pl") && sql.includes("JOIN posts p ON pl.post_id = p.id")) {
      const userId = params![0];
      const offset = params![1] ?? 0;
      const limit = params![2] ?? 100;
      const likedPostIds = this.likes.filter((l) => l.likedBy === userId).map((l) => l.postId);
      const posts = this.data.filter((p) => likedPostIds.includes(p.id));
      const rows = posts.map((p) => {
        const replyToPost = this.data.find((pp) => pp.id === p.replyTo);
        const replyToNickname = replyToPost
          ? (this.users.find((u) => u.id === replyToPost.ownedBy)?.nickname ?? null)
          : null;
        return {
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
      });
      return { rows: rows.slice(offset, offset + limit) };
    }

    if (sql.includes("FROM posts p") && sql.includes("JOIN users u ON p.owned_by = u.id")) {
      const mWhereId = sql.match(/WHERE\s+p\.id\s*=\s*\$(\d+)/i);
      const buildRow = (p: Post) => {
        const replyToPost = this.data.find((pp) => pp.id === p.replyTo);
        const reply_to_owner_nickname = replyToPost
          ? (this.users.find((u) => u.id === replyToPost.ownedBy)?.nickname ?? null)
          : null;
        return {
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

    if (sql.includes("FROM posts p") && !sql.includes("JOIN users u ON p.owned_by = u.id")) {
      const offset = params?.[params.length - 2] ?? 0;
      const limit = params?.[params.length - 1] ?? 100;
      return { rows: this.data.slice(offset, offset + limit) };
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
  let postSample: Post;

  beforeEach(() => {
    pgClient = new MockPgClientMain();
    redis = new MockRedis();
    postsService = new PostsService(pgClient as any, redis as any);

    pgClient.users.push({ id: "user-1", nickname: "Alice" });
    pgClient.users.push({ id: "user-2", nickname: "Bob" });
    pgClient.users.push({ id: "user-3", nickname: "Carol" });

    postSample = {
      id: uuidv4(),
      content: "test post content",
      ownedBy: "user-1",
      replyTo: null,
      allowLikes: true,
      allowReplies: true,
      createdAt: new Date().toISOString(),
      updatedAt: null,
      ownerNickname: "user-1",
      replyToOwnerNickname: null,
      countLikes: 0,
      countReplies: 0,
      tags: [] as string[],
    };
    pgClient.data.push({ ...postSample });
    pgClient.tags.push({ postId: postSample.id, name: "tag1" });
    pgClient.likes.push({ postId: postSample.id, likedBy: uuidv4() });
  });

  test("countPosts", async () => {
    expect(await postsService.countPosts()).toBe(1);
    pgClient.data.push({ ...postSample, id: uuidv4() });
    expect(await postsService.countPosts()).toBe(2);
  });

  test("listPosts: default", async () => {
    const posts = await postsService.listPosts();
    expect(posts.length).toBe(1);
    expect(posts[0].content).toBe(postSample.content);
  });

  test("listPosts: basic", async () => {
    const posts = await postsService.listPosts();
    expect(posts.length).toBeGreaterThanOrEqual(1);
    expect(posts[0].ownerNickname).toBe("Alice");
    expect(posts[0].tags).toContain("tag1");
    expect(posts[0].countLikes).toBeGreaterThanOrEqual(1);
  });

  test("createPost", async () => {
    const input: CreatePostInput = {
      content: "new post content",
      ownedBy: "user-2",
      replyTo: postSample.id,
      allowLikes: true,
      allowReplies: true,
      tags: ["hello", "world"],
    };
    const post = await postsService.createPost(input);
    expect(post.content).toBe("new post content");
    expect(post.ownedBy).toBe("user-2");
    expect(post.replyTo).toBe(postSample.id);
    expect(pgClient.data.length).toBeGreaterThanOrEqual(2);
    expect(pgClient.tags.some((t) => t.postId === post.id && t.name === "hello")).toBe(true);
  });

  test("getPost", async () => {
    const post = await postsService.getPost(postSample.id);
    expect(post).not.toBeNull();
    expect(post!.content).toBe(postSample.content);
  });

  test("getPost: not found", async () => {
    const post = await postsService.getPost("no-such-id");
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
    expect(pgClient.tags.some((t) => t.postId === postSample.id && t.name === "foo")).toBe(true);
  });

  test("updatePost: partial", async () => {
    const input: UpdatePostInput = {
      id: postSample.id,
      content: "only content changed",
    };
    const post = await postsService.updatePost(input);
    expect(post).not.toBeNull();
    expect(post!.content).toBe("only content changed");
  });

  test("updatePost: not found", async () => {
    const input: UpdatePostInput = {
      id: "no-such-id",
      content: "xxx",
    };
    const post = await postsService.updatePost(input);
    expect(post).toBeNull();
  });

  test("deletePost", async () => {
    await postsService.deletePost(postSample.id);
    expect(pgClient.data.length).toBe(0);
    expect(pgClient.tags.some((t) => t.postId === postSample.id)).toBe(false);
    await expect(postsService.deletePost("no-such-id")).rejects.toThrow(/post not found/i);
  });

  test("addLike: normal", async () => {
    const userId = "user-2";
    await postsService.addLike(postSample.id, userId);
    expect(pgClient.likes.some((l) => l.postId === postSample.id && l.likedBy === userId)).toBe(
      true,
    );
  });

  test("addLike: duplicate should throw", async () => {
    const userId = "user-2";
    await postsService.addLike(postSample.id, userId);
    await expect(postsService.addLike(postSample.id, userId)).rejects.toThrow(/already liked/i);
    expect(
      pgClient.likes.filter((l) => l.postId === postSample.id && l.likedBy === userId).length,
    ).toBe(1);
  });

  test("removeLike: normal", async () => {
    const userId = "user-2";
    await postsService.addLike(postSample.id, userId);
    await postsService.removeLike(postSample.id, userId);
    expect(pgClient.likes.some((l) => l.postId === postSample.id && l.likedBy === userId)).toBe(
      false,
    );
  });

  test("removeLike: not found should throw", async () => {
    await expect(postsService.removeLike(postSample.id, "no-such-user")).rejects.toThrow(
      /not liked/i,
    );
  });
});

describe("listPostsByFollowees", () => {
  let pgClient: MockPgClientMain;
  let redis: MockRedis;
  let postsService: PostsService;
  let alice: string, bob: string, carol: string;
  let postAlice: Post, postBob: Post, postCarol: Post;

  beforeEach(() => {
    pgClient = new MockPgClientMain();
    redis = new MockRedis();
    postsService = new PostsService(pgClient as any, redis as any);

    pgClient.users.push({ id: "user-1", nickname: "Alice" });
    pgClient.users.push({ id: "user-2", nickname: "Bob" });
    pgClient.users.push({ id: "user-3", nickname: "Carol" });

    alice = "user-1";
    bob = "user-2";
    carol = "user-3";

    pgClient.follows.push({ followerId: alice, followeeId: bob });

    postAlice = {
      id: uuidv4(),
      content: "post-alice",
      ownedBy: alice,
      replyTo: null,
      allowLikes: true,
      allowReplies: true,
      createdAt: new Date().toISOString(),
      updatedAt: null,
      ownerNickname: "alice",
      replyToOwnerNickname: null,
      countLikes: 0,
      countReplies: 0,
      tags: [] as string[],
    };
    postBob = {
      id: uuidv4(),
      content: "post-bob",
      ownedBy: bob,
      replyTo: null,
      allowLikes: true,
      allowReplies: true,
      createdAt: new Date().toISOString(),
      updatedAt: null,
      ownerNickname: "bob",
      replyToOwnerNickname: null,
      countLikes: 0,
      countReplies: 0,
      tags: [] as string[],
    };
    postCarol = {
      id: uuidv4(),
      content: "post-carol",
      ownedBy: carol,
      replyTo: null,
      allowLikes: true,
      allowReplies: true,
      createdAt: new Date().toISOString(),
      updatedAt: null,
      ownerNickname: "carol",
      replyToOwnerNickname: null,
      countLikes: 0,
      countReplies: 0,
      tags: [] as string[],
    };
    pgClient.data.push(postAlice, postBob, postCarol);
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
});

describe("listPostsLikedByUser", () => {
  let pgClient: MockPgClientMain;
  let redis: MockRedis;
  let postsService: PostsService;
  let alice: string, bob: string;
  let post1: Post, post2: Post;

  beforeEach(() => {
    pgClient = new MockPgClientMain();
    redis = new MockRedis();
    postsService = new PostsService(pgClient as any, redis as any);

    pgClient.users.push({ id: "user-1", nickname: "Alice" });
    pgClient.users.push({ id: "user-2", nickname: "Bob" });

    alice = "user-1";
    bob = "user-2";
    post1 = {
      id: uuidv4(),
      content: "liked-by-alice",
      ownedBy: bob,
      replyTo: null,
      allowLikes: true,
      allowReplies: true,
      createdAt: new Date().toISOString(),
      updatedAt: null,
      ownerNickname: "user-1",
      replyToOwnerNickname: null,
      countLikes: 0,
      countReplies: 0,
      tags: [] as string[],
    };
    post2 = {
      id: uuidv4(),
      content: "not-liked",
      ownedBy: bob,
      replyTo: null,
      allowLikes: true,
      allowReplies: true,
      createdAt: new Date().toISOString(),
      updatedAt: null,
      ownerNickname: "user-1",
      replyToOwnerNickname: null,
      countLikes: 0,
      countReplies: 0,
      tags: [] as string[],
    };
    pgClient.data.push(post1, post2);

    pgClient.likes.push({ postId: post1.id, likedBy: alice });
  });

  test("should return posts liked by the user", async () => {
    const input: ListPostsLikedByUserInput = {
      userId: alice,
      offset: 0,
      limit: 10,
      order: "desc",
    };
    const result = await postsService.listPostsLikedByUser(input);
    expect(Array.isArray(result)).toBe(true);
    expect(result.some((p) => p.id === post1.id)).toBe(true);
    expect(result.some((p) => p.id === post2.id)).toBe(false);
  });

  test("should return empty array if user has not liked any posts", async () => {
    const input: ListPostsLikedByUserInput = {
      userId: bob,
      offset: 0,
      limit: 10,
      order: "desc",
    };
    const result = await postsService.listPostsLikedByUser(input);
    expect(result.length).toBe(0);
  });
});

describe("getPost", () => {
  class MockPgClient {
    posts: Post[] = [];
    users: { id: string; nickname: string }[] = [];
    postLikes: { postId: string; likedBy: string }[] = [];
    postTags: { postId: string; name: string }[] = [];

    async query(sql: string, params?: any[]) {
      sql = normalizeSql(sql);
      if (sql.includes("FROM posts p") && sql.includes("JOIN users u ON p.owned_by = u.id")) {
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
        const row = {
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
        return { rows: [row] };
      }
      return { rows: [] };
    }
  }

  let pgClient: MockPgClient;
  let redis: MockRedis;
  let postsService: PostsService;
  let post: Post;
  let owner: { id: string; nickname: string };

  beforeEach(() => {
    pgClient = new MockPgClient();
    redis = new MockRedis();
    postsService = new PostsService(pgClient as any, redis as any);

    owner = { id: uuidv4(), nickname: "Poster" };
    pgClient.users.push(owner);

    post = {
      id: uuidv4(),
      content: "content",
      ownedBy: owner.id,
      replyTo: null,
      allowLikes: true,
      allowReplies: true,
      createdAt: new Date().toISOString(),
      updatedAt: null,
      ownerNickname: "user-1",
      replyToOwnerNickname: null,
      countLikes: 0,
      countReplies: 0,
      tags: [] as string[],
    };
    pgClient.posts.push(post);

    pgClient.postLikes.push(
      { postId: post.id, likedBy: uuidv4() },
      { postId: post.id, likedBy: uuidv4() },
    );

    pgClient.postTags.push({ postId: post.id, name: "tag1" }, { postId: post.id, name: "tag2" });

    pgClient.posts.push(
      {
        id: uuidv4(),
        content: "reply1",
        ownedBy: uuidv4(),
        replyTo: post.id,
        allowLikes: true,
        allowReplies: true,
        createdAt: new Date().toISOString(),
        updatedAt: null,
        ownerNickname: "user-2",
        replyToOwnerNickname: "user-1",
        countLikes: 0,
        countReplies: 0,
        tags: [] as string[],
      },
      {
        id: uuidv4(),
        content: "reply2",
        ownedBy: uuidv4(),
        replyTo: post.id,
        allowLikes: true,
        allowReplies: true,
        createdAt: new Date().toISOString(),
        updatedAt: null,
        ownerNickname: "user-2",
        replyToOwnerNickname: "user-1",
        countLikes: 0,
        countReplies: 0,
        tags: [] as string[],
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
    const result = await postsService.getPost("no-such-id");
    expect(result).toBeNull();
  });

  test("getPost: no likes, no replies, no tags", async () => {
    const anotherOwner = { id: uuidv4(), nickname: "Nobody" };
    pgClient.users.push(anotherOwner);
    const p2: Post = {
      id: uuidv4(),
      content: "empty",
      ownedBy: anotherOwner.id,
      replyTo: null,
      allowLikes: true,
      allowReplies: true,
      createdAt: new Date().toISOString(),
      updatedAt: null,
      ownerNickname: "user-1",
      replyToOwnerNickname: null,
      countLikes: 0,
      countReplies: 0,
      tags: [] as string[],
    };
    pgClient.posts.push(p2);
    const post = await postsService.getPost(p2.id);
    expect(post).not.toBeNull();
    expect(post!.ownerNickname).toBe("Nobody");
    expect(post!.countReplies).toBe(0);
    expect(post!.countLikes).toBe(0);
    expect(post!.tags).toEqual([]);
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
        .filter((l: { postId: string; likedBy: string; createdAt: string }) => l.postId === postId)
        .sort((a: { createdAt: string }, b: { createdAt: string }) =>
          b.createdAt.localeCompare(a.createdAt),
        )
        .slice(offset, offset + limit);
      const likedUserIds = likes.map(
        (l: { postId: string; likedBy: string; createdAt: string }) => l.likedBy,
      );
      const result = this.users.filter((u) => likedUserIds.includes(u.id));
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
      id: uuidv4(),
      email: "alice@example.com",
      nickname: "Alice",
      isAdmin: false,
      introduction: "Hi, I'm Alice.",
      avatar: null,
      aiPersonality: "",
      aiModel: "",
      createdAt: new Date().toISOString(),
      updatedAt: null,
      countFollowers: 0,
      countFollowees: 0,
      countPosts: 0,
    };
    user2 = {
      id: uuidv4(),
      email: "bob@example.com",
      nickname: "Bob",
      isAdmin: false,
      introduction: "Hi, I'm Bob.",
      avatar: null,
      aiPersonality: "",
      aiModel: "",
      createdAt: new Date().toISOString(),
      updatedAt: null,
      countFollowers: 0,
      countFollowees: 0,
      countPosts: 0,
    };
    user3 = {
      id: uuidv4(),
      email: "carol@example.com",
      nickname: "Carol",
      isAdmin: false,
      introduction: "Hi, I'm Carol.",
      avatar: null,
      aiPersonality: "",
      aiModel: "",
      createdAt: new Date().toISOString(),
      updatedAt: null,
      countFollowers: 0,
      countFollowees: 0,
      countPosts: 0,
    };
    postId = uuidv4();
    pgClient.users.push(user1, user2, user3);
    pgClient.postLikes.push(
      { postId: postId, likedBy: user1.id, createdAt: "2024-01-01T12:00:00Z" },
      { postId: postId, likedBy: user2.id, createdAt: "2024-01-02T12:00:00Z" },
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
      postId: uuidv4(),
      offset: 0,
      limit: 10,
      order: "desc",
    } as ListLikersInput);
    expect(users.length).toBe(0);
  });
});
