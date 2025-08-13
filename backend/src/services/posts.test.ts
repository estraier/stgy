import { v4 as uuidv4 } from "uuid";
import { PostsService } from "./posts";
import {
  Post,
  PostDetail,
  CreatePostInput,
  UpdatePostInput,
  ListPostsInput,
  ListPostsByFolloweesDetailInput,
  ListPostsLikedByUserDetailInput,
  ListLikersInput,
} from "../models/post";
import { User } from "../models/user";

function normalizeSql(sql: string) {
  return sql.replace(/\s+/g, " ").trim();
}

class MockPgClient {
  data: Post[] = [];
  tags: { postId: string; name: string }[] = [];
  likes: { postId: string; likedBy: string }[] = [];
  follows: { followerId: string; followeeId: string }[] = [];
  users: { id: string; nickname: string }[] = [];
  txCount = 0;

  async query(sql: string, params?: any[]) {
    sql = normalizeSql(sql);
    if (sql === "BEGIN" || sql === "COMMIT" || sql === "ROLLBACK") {
      this.txCount++;
      return { rows: [] };
    }
    if (sql.startsWith("INSERT INTO posts")) {
      const newPost: Post = {
        id: params![0],
        content: params![1],
        ownedBy: params![2],
        replyTo: params![3] ?? null,
        createdAt: new Date().toISOString(),
        updatedAt: null,
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
    if (sql.startsWith("UPDATE posts SET")) {
      const id = params![params!.length - 1];
      const post = this.data.find((p) => p.id === id);
      if (!post) return { rows: [] };
      const columns = sql
        .match(/SET (.+) WHERE/)![1]
        .split(",")
        .map((s) => s.trim());
      let idx = 0;
      for (const col of columns) {
        const key = col.split(" =")[0] as keyof Post;
        (post as any)[key] = params![idx++];
      }
      return { rows: [post] };
    }
    if (
      sql.startsWith(
        "SELECT id, content, owned_by, reply_to, created_at, updated_at FROM posts WHERE id =",
      )
    ) {
      const id = params![0];
      const post = this.data.find((p) => p.id === id);
      return { rows: post ? [post] : [] };
    }
    if (sql.startsWith("SELECT COUNT(*) FROM posts")) {
      return { rows: [{ count: this.data.length.toString() }] };
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
      const rows: PostDetail[] = posts.map((p) => {
        const replyToPost = this.data.find((pp) => pp.id === p.replyTo);
        const replyToNickname = replyToPost
          ? (this.users.find((u) => u.id === replyToPost.ownedBy)?.nickname ?? null)
          : null;
        return {
          id: p.id,
          content: p.content,
          ownedBy: p.ownedBy,
          replyTo: p.replyTo,
          createdAt: p.createdAt,
          updatedAt: p.updatedAt,
          ownerNickname: this.users.find((u) => u.id === p.ownedBy)?.nickname ?? "",
          replyToOwnerNickname: replyToNickname,
          replyCount: this.data.filter((r) => r.replyTo === p.id).length,
          likeCount: this.likes.filter((l) => l.postId === p.id).length,
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
      const rows: PostDetail[] = posts.map((p) => {
        const replyToPost = this.data.find((pp) => pp.id === p.replyTo);
        const replyToNickname = replyToPost
          ? (this.users.find((u) => u.id === replyToPost.ownedBy)?.nickname ?? null)
          : null;
        return {
          id: p.id,
          content: p.content,
          ownedBy: p.ownedBy,
          replyTo: p.replyTo,
          createdAt: p.createdAt,
          updatedAt: p.updatedAt,
          ownerNickname: this.users.find((u) => u.id === p.ownedBy)?.nickname ?? "",
          replyToOwnerNickname: replyToNickname,
          replyCount: this.data.filter((r) => r.replyTo === p.id).length,
          likeCount: this.likes.filter((l) => l.postId === p.id).length,
          tags: this.tags
            .filter((t) => t.postId === p.id)
            .map((t) => t.name)
            .sort(),
        };
      });
      return { rows: rows.slice(offset, offset + limit) };
    }
    if (sql.includes("FROM posts p") && sql.includes("JOIN users u ON p.owned_by = u.id")) {
      const result: PostDetail[] = this.data.map((p) => {
        const replyToPost = this.data.find((pp) => pp.id === p.replyTo);
        const replyToNickname = replyToPost
          ? (this.users.find((u) => u.id === replyToPost.ownedBy)?.nickname ?? null)
          : null;
        return {
          id: p.id,
          content: p.content,
          ownedBy: p.ownedBy,
          replyTo: p.replyTo,
          createdAt: p.createdAt,
          updatedAt: p.updatedAt,
          ownerNickname: this.users.find((u) => u.id === p.ownedBy)?.nickname ?? "",
          replyToOwnerNickname: replyToNickname,
          replyCount: this.data.filter((r) => r.replyTo === p.id).length,
          likeCount: this.likes.filter((l) => l.postId === p.id).length,
          tags: this.tags
            .filter((t) => t.postId === p.id)
            .map((t) => t.name)
            .sort(),
        };
      });
      return { rows: result };
    }
    if (sql.includes("FROM posts p") && !sql.includes("JOIN users u ON p.owned_by = u.id")) {
      const offset = params?.[params.length - 2] ?? 0;
      const limit = params?.[params.length - 1] ?? 100;
      return { rows: this.data.slice(offset, offset + limit) };
    }
    if (
      sql.startsWith(
        "SELECT id, content, owned_by, reply_to, created_at, updated_at, FROM posts WHERE id =",
      )
    ) {
      const id = params![0];
      const post = this.data.find((p) => p.id === id);
      return { rows: post ? [post] : [] };
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
    if (
      sql.includes("FROM post_likes pl") &&
      sql.includes("JOIN users u ON pl.liked_by = u.id") &&
      sql.includes("WHERE pl.post_id = $1")
    ) {
      const postId = params![0];
      const offset = params![1] ?? 0;
      const limit = params![2] ?? 100;
      const likes = this.likes.filter((l) => l.postId === postId).slice(offset, offset + limit);
      const likedUserIds = likes.map((l) => l.likedBy);
      const result = this.users.filter((u) => likedUserIds.includes(u.id));
      return { rows: result };
    }
    return { rows: [] };
  }
}

class MockRedis {}

describe("posts service", () => {
  let pgClient: MockPgClient;
  let redis: MockRedis;
  let postsService: PostsService;
  let postSample: Post;

  beforeEach(() => {
    pgClient = new MockPgClient();
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
      createdAt: new Date().toISOString(),
      updatedAt: null,
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

  test("listPosts: offset/limit", async () => {
    for (let i = 0; i < 3; ++i) {
      pgClient.data.push({ ...postSample, id: uuidv4(), content: `p${i}` });
    }
    const input: ListPostsInput = { offset: 1, limit: 2 };
    const posts = await postsService.listPosts(input);
    expect(posts.length).toBe(2);
    expect(posts[0].content).toBe("p0");
  });

  test("listPostsDetail: basic", async () => {
    const details = await postsService.listPostsDetail();
    expect(details.length).toBeGreaterThanOrEqual(1);
    expect(details[0].ownerNickname).toBe("Alice");
    expect(details[0].tags).toContain("tag1");
    expect(details[0].likeCount).toBeGreaterThanOrEqual(1);
  });

  test("createPost", async () => {
    const input: CreatePostInput = {
      content: "new post content",
      ownedBy: "user-2",
      replyTo: postSample.id,
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
      replyTo: "other-post-id",
      tags: ["foo", "bar"],
    };
    const post = await postsService.updatePost(input);
    expect(post).not.toBeNull();
    expect(post!.content).toBe("updated content");
    expect(post!.replyTo).toBe("other-post-id");
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

describe("listPostsByFolloweesDetail", () => {
  let pgClient: MockPgClient;
  let redis: MockRedis;
  let postsService: PostsService;
  let alice: string, bob: string, carol: string;
  let postAlice: Post, postBob: Post, postCarol: Post;

  beforeEach(() => {
    pgClient = new MockPgClient();
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
      createdAt: new Date().toISOString(),
      updatedAt: null,
    };
    postBob = {
      id: uuidv4(),
      content: "post-bob",
      ownedBy: bob,
      replyTo: null,
      createdAt: new Date().toISOString(),
      updatedAt: null,
    };
    postCarol = {
      id: uuidv4(),
      content: "post-carol",
      ownedBy: carol,
      replyTo: null,
      createdAt: new Date().toISOString(),
      updatedAt: null,
    };
    pgClient.data.push(postAlice, postBob, postCarol);
  });

  test("should not include self posts when includeSelf is false", async () => {
    const input: ListPostsByFolloweesDetailInput = {
      userId: alice,
      includeSelf: false,
      offset: 0,
      limit: 10,
      order: "desc",
    };
    const result = await postsService.listPostsByFolloweesDetail(input);
    expect(result.some((p) => p.ownedBy === alice)).toBe(false);
    expect(result.some((p) => p.ownedBy === bob)).toBe(true);
    expect(result.some((p) => p.ownedBy === carol)).toBe(false);
  });

  test("should include self posts when includeSelf is true", async () => {
    const input: ListPostsByFolloweesDetailInput = {
      userId: alice,
      includeSelf: true,
      offset: 0,
      limit: 10,
      order: "desc",
    };
    const result = await postsService.listPostsByFolloweesDetail(input);
    expect(result.some((p) => p.ownedBy === alice)).toBe(true);
    expect(result.some((p) => p.ownedBy === bob)).toBe(true);
    expect(result.some((p) => p.ownedBy === carol)).toBe(false);
  });
});

describe("listPostsLikedByUserDetail", () => {
  let pgClient: MockPgClient;
  let redis: MockRedis;
  let postsService: PostsService;
  let alice: string, bob: string;
  let post1: Post, post2: Post;

  beforeEach(() => {
    pgClient = new MockPgClient();
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
      createdAt: new Date().toISOString(),
      updatedAt: null,
    };
    post2 = {
      id: uuidv4(),
      content: "not-liked",
      ownedBy: bob,
      replyTo: null,
      createdAt: new Date().toISOString(),
      updatedAt: null,
    };
    pgClient.data.push(post1, post2);

    pgClient.likes.push({ postId: post1.id, likedBy: alice });
  });

  test("should return posts liked by the user", async () => {
    const input: ListPostsLikedByUserDetailInput = {
      userId: alice,
      offset: 0,
      limit: 10,
      order: "desc",
    };
    const result = await postsService.listPostsLikedByUserDetail(input);
    expect(Array.isArray(result)).toBe(true);
    expect(result.some((p) => p.id === post1.id)).toBe(true);
    expect(result.some((p) => p.id === post2.id)).toBe(false);
  });

  test("should return empty array if user has not liked any posts", async () => {
    const input: ListPostsLikedByUserDetailInput = {
      userId: bob,
      offset: 0,
      limit: 10,
      order: "desc",
    };
    const result = await postsService.listPostsLikedByUserDetail(input);
    expect(result.length).toBe(0);
  });
});

describe("getPostDetail", () => {
  class MockPgClientDetail {
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
        const replyCount = this.posts.filter((x) => x.replyTo === p.id).length;
        const likeCount = this.postLikes.filter((x) => x.postId === p.id).length;
        const tags = this.postTags
          .filter((x) => x.postId === p.id)
          .map((x) => x.name)
          .sort();
        const replyToPost = this.posts.find((pp) => pp.id === p.replyTo);
        const replyToOwnerNickname = replyToPost
          ? (this.users.find((u) => u.id === replyToPost.ownedBy)?.nickname ?? null)
          : null;
        const row: PostDetail = {
          id: p.id,
          content: p.content,
          ownedBy: p.ownedBy,
          replyTo: p.replyTo,
          createdAt: p.createdAt,
          updatedAt: p.updatedAt,
          ownerNickname: u?.nickname || "",
          replyToOwnerNickname,
          replyCount,
          likeCount,
          tags,
        };
        return { rows: [row] };
      }
      return { rows: [] };
    }
  }

  let pgClient: MockPgClientDetail;
  let redis: MockRedis;
  let postsService: PostsService;
  let post: Post;
  let owner: { id: string; nickname: string };

  beforeEach(() => {
    pgClient = new MockPgClientDetail();
    redis = new MockRedis();
    postsService = new PostsService(pgClient as any, redis as any);

    owner = { id: uuidv4(), nickname: "Poster" };
    pgClient.users.push(owner);

    post = {
      id: uuidv4(),
      content: "detail content",
      ownedBy: owner.id,
      replyTo: null,
      createdAt: new Date().toISOString(),
      updatedAt: null,
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
        createdAt: new Date().toISOString(),
        updatedAt: null,
      },
      {
        id: uuidv4(),
        content: "reply2",
        ownedBy: uuidv4(),
        replyTo: post.id,
        createdAt: new Date().toISOString(),
        updatedAt: null,
      },
    );
  });

  test("getPostDetail returns all meta correctly", async () => {
    const detail = await postsService.getPostDetail(post.id);
    expect(detail).not.toBeNull();
    expect(detail!.id).toBe(post.id);
    expect(detail!.ownerNickname).toBe(owner.nickname);
    expect(detail!.replyCount).toBe(2);
    expect(detail!.likeCount).toBe(2);
    expect(detail!.tags.sort()).toEqual(["tag1", "tag2"]);
  });

  test("getPostDetail: not found returns null", async () => {
    const detail = await postsService.getPostDetail("no-such-id");
    expect(detail).toBeNull();
  });

  test("getPostDetail: no likes, no replies, no tags", async () => {
    const anotherOwner = { id: uuidv4(), nickname: "Nobody" };
    pgClient.users.push(anotherOwner);
    const p2: Post = {
      id: uuidv4(),
      content: "empty",
      ownedBy: anotherOwner.id,
      replyTo: null,
      createdAt: new Date().toISOString(),
      updatedAt: null,
    };
    pgClient.posts.push(p2);

    const detail = await postsService.getPostDetail(p2.id);
    expect(detail).not.toBeNull();
    expect(detail!.ownerNickname).toBe("Nobody");
    expect(detail!.replyCount).toBe(0);
    expect(detail!.likeCount).toBe(0);
    expect(detail!.tags).toEqual([]);
  });
});

describe("listLikers", () => {
  class MockPgClient {
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
        const limit = params![2] ?? 100;
        const likes = this.postLikes
          .filter((l) => l.postId === postId)
          .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
        const likedUserIds = likes.map((l) => l.likedBy).slice(offset, offset + limit);
        const result = this.users.filter((u) => likedUserIds.includes(u.id));
        return { rows: result };
      }
      return { rows: [] };
    }
  }

  let pgClient: MockPgClient;
  let redis: MockRedis;
  let postsService: PostsService;
  let user1: User, user2: User, user3: User, postId: string;

  beforeEach(() => {
    pgClient = new MockPgClient();
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
