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
  tags: { post_id: string; name: string }[] = [];
  likes: { post_id: string; liked_by: string }[] = [];
  follows: { follower_id: string; followee_id: string }[] = [];
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
        owned_by: params![2],
        reply_to: params![3] ?? null,
        created_at: new Date().toISOString(),
      };
      this.data.push(newPost);
      return { rows: [newPost] };
    }
    if (sql.startsWith("INSERT INTO post_tags")) {
      for (let i = 1; i < params!.length; i++) {
        this.tags.push({ post_id: params![0], name: params![i] });
      }
      return { rowCount: params!.length - 1 };
    }
    if (sql.startsWith("DELETE FROM post_tags WHERE post_id = $1")) {
      const post_id = params![0];
      this.tags = this.tags.filter((t) => t.post_id !== post_id);
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
      sql.startsWith("SELECT id, content, owned_by, reply_to, created_at FROM posts WHERE id =")
    ) {
      const id = params![0];
      const post = this.data.find((p) => p.id === id);
      return { rows: post ? [post] : [] };
    }
    if (sql.startsWith("SELECT COUNT(*) FROM posts")) {
      return { rows: [{ count: this.data.length.toString() }] };
    }
    if (sql.startsWith("SELECT 1 FROM post_likes")) {
      const [post_id, liked_by] = params!;
      const found = this.likes.some((l) => l.post_id === post_id && l.liked_by === liked_by);
      return { rows: found ? [{}] : [] };
    }
    if (sql.startsWith("SELECT 1 FROM posts WHERE reply_to =")) {
      const [reply_to, owned_by] = params!;
      const found = this.data.some((p) => p.reply_to === reply_to && p.owned_by === owned_by);
      return { rows: found ? [{}] : [] };
    }
    if (
      sql.includes("WHERE p.owned_by IN") &&
      sql.includes("FROM posts p") &&
      sql.includes("JOIN users u ON p.owned_by = u.id")
    ) {
      const user_id = params![0];
      const offset = params![1] ?? 0;
      const limit = params![2] ?? 100;
      let followeeIds = this.follows
        .filter((f) => f.follower_id === user_id)
        .map((f) => f.followee_id);
      if (sql.includes("UNION SELECT $1")) {
        followeeIds.push(user_id);
      }
      followeeIds = Array.from(new Set(followeeIds));
      const posts = this.data.filter((p) => followeeIds.includes(p.owned_by));
      const rows: PostDetail[] = posts.map((p) => {
        const replyToPost = this.data.find((pp) => pp.id === p.reply_to);
        const replyToNickname = replyToPost
          ? (this.users.find((u) => u.id === replyToPost.owned_by)?.nickname ?? null)
          : null;
        return {
          id: p.id,
          content: p.content,
          owned_by: p.owned_by,
          reply_to: p.reply_to,
          created_at: p.created_at,
          owner_nickname: this.users.find((u) => u.id === p.owned_by)?.nickname ?? "",
          reply_to_owner_nickname: replyToNickname,
          reply_count: this.data.filter((r) => r.reply_to === p.id).length,
          like_count: this.likes.filter((l) => l.post_id === p.id).length,
          tags: this.tags
            .filter((t) => t.post_id === p.id)
            .map((t) => t.name)
            .sort(),
        };
      });
      return { rows: rows.slice(offset, offset + limit) };
    }
    if (sql.includes("FROM post_likes pl") && sql.includes("JOIN posts p ON pl.post_id = p.id")) {
      const user_id = params![0];
      const offset = params![1] ?? 0;
      const limit = params![2] ?? 100;
      const likedPostIds = this.likes.filter((l) => l.liked_by === user_id).map((l) => l.post_id);
      const posts = this.data.filter((p) => likedPostIds.includes(p.id));
      const rows: PostDetail[] = posts.map((p) => {
        const replyToPost = this.data.find((pp) => pp.id === p.reply_to);
        const replyToNickname = replyToPost
          ? (this.users.find((u) => u.id === replyToPost.owned_by)?.nickname ?? null)
          : null;
        return {
          id: p.id,
          content: p.content,
          owned_by: p.owned_by,
          reply_to: p.reply_to,
          created_at: p.created_at,
          owner_nickname: this.users.find((u) => u.id === p.owned_by)?.nickname ?? "",
          reply_to_owner_nickname: replyToNickname,
          reply_count: this.data.filter((r) => r.reply_to === p.id).length,
          like_count: this.likes.filter((l) => l.post_id === p.id).length,
          tags: this.tags
            .filter((t) => t.post_id === p.id)
            .map((t) => t.name)
            .sort(),
        };
      });
      return { rows: rows.slice(offset, offset + limit) };
    }
    if (sql.includes("FROM posts p") && sql.includes("JOIN users u ON p.owned_by = u.id")) {
      const result: PostDetail[] = this.data.map((p) => {
        const replyToPost = this.data.find((pp) => pp.id === p.reply_to);
        const replyToNickname = replyToPost
          ? (this.users.find((u) => u.id === replyToPost.owned_by)?.nickname ?? null)
          : null;
        return {
          id: p.id,
          content: p.content,
          owned_by: p.owned_by,
          reply_to: p.reply_to,
          created_at: p.created_at,
          owner_nickname: this.users.find((u) => u.id === p.owned_by)?.nickname ?? "",
          reply_to_owner_nickname: replyToNickname,
          reply_count: this.data.filter((r) => r.reply_to === p.id).length,
          like_count: this.likes.filter((l) => l.post_id === p.id).length,
          tags: this.tags
            .filter((t) => t.post_id === p.id)
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
      sql.startsWith("SELECT id, content, owned_by, reply_to, created_at FROM posts WHERE id =")
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
        this.tags = this.tags.filter((t) => t.post_id !== id);
        return { rowCount: 1 };
      }
      return { rowCount: 0 };
    }
    if (sql.startsWith("INSERT INTO post_likes")) {
      const [post_id, liked_by] = params!;
      if (!this.likes.some((l) => l.post_id === post_id && l.liked_by === liked_by)) {
        this.likes.push({ post_id, liked_by });
      }
      return { rowCount: 1 };
    }
    if (sql.startsWith("DELETE FROM post_likes")) {
      const [post_id, liked_by] = params!;
      const before = this.likes.length;
      this.likes = this.likes.filter((l) => !(l.post_id === post_id && l.liked_by === liked_by));
      return { rowCount: before !== this.likes.length ? 1 : 0 };
    }
    if (
      sql.includes("FROM post_likes pl") &&
      sql.includes("JOIN users u ON pl.liked_by = u.id") &&
      sql.includes("WHERE pl.post_id = $1")
    ) {
      const post_id = params![0];
      const offset = params![1] ?? 0;
      const limit = params![2] ?? 100;
      const likes = this.likes.filter((l) => l.post_id === post_id).slice(offset, offset + limit);
      const likedUserIds = likes.map((l) => l.liked_by);
      const result = this.users.filter((u) => likedUserIds.includes(u.id));
      return { rows: result };
    }
    return { rows: [] };
  }
}

describe("posts service", () => {
  let pgClient: MockPgClient;
  let postsService: PostsService;
  let postSample: Post;

  beforeEach(() => {
    pgClient = new MockPgClient();
    postsService = new PostsService(pgClient as any);

    pgClient.users.push({ id: "user-1", nickname: "Alice" });
    pgClient.users.push({ id: "user-2", nickname: "Bob" });
    pgClient.users.push({ id: "user-3", nickname: "Carol" });

    postSample = {
      id: uuidv4(),
      content: "test post content",
      owned_by: "user-1",
      reply_to: null,
      created_at: new Date().toISOString(),
    };
    pgClient.data.push({ ...postSample });
    pgClient.tags.push({ post_id: postSample.id, name: "tag1" });
    pgClient.likes.push({ post_id: postSample.id, liked_by: uuidv4() });
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
    expect(details[0].owner_nickname).toBe("Alice");
    expect(details[0].tags).toContain("tag1");
    expect(details[0].like_count).toBeGreaterThanOrEqual(1);
  });

  test("createPost", async () => {
    const input: CreatePostInput = {
      content: "new post content",
      owned_by: "user-2",
      reply_to: postSample.id,
      tags: ["hello", "world"],
    };
    const post = await postsService.createPost(input);
    expect(post.content).toBe("new post content");
    expect(post.owned_by).toBe("user-2");
    expect(post.reply_to).toBe(postSample.id);
    expect(pgClient.data.length).toBeGreaterThanOrEqual(2);
    expect(pgClient.tags.some((t) => t.post_id === post.id && t.name === "hello")).toBe(true);
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
      reply_to: "other-post-id",
      tags: ["foo", "bar"],
    };
    const post = await postsService.updatePost(input);
    expect(post).not.toBeNull();
    expect(post!.content).toBe("updated content");
    expect(post!.reply_to).toBe("other-post-id");
    expect(pgClient.tags.some((t) => t.post_id === postSample.id && t.name === "foo")).toBe(true);
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
    const ok = await postsService.deletePost(postSample.id);
    expect(ok).toBe(true);
    expect(pgClient.data.length).toBe(0);
    expect(pgClient.tags.some((t) => t.post_id === postSample.id)).toBe(false);
    const ng = await postsService.deletePost("no-such-id");
    expect(ng).toBe(false);
  });

  test("addLike: normal", async () => {
    const userId = "user-2";
    const result = await postsService.addLike(postSample.id, userId);
    expect(result).toBe(true);
    expect(pgClient.likes.some((l) => l.post_id === postSample.id && l.liked_by === userId)).toBe(
      true,
    );
  });

  test("addLike: duplicate", async () => {
    const userId = "user-2";
    await postsService.addLike(postSample.id, userId);
    const again = await postsService.addLike(postSample.id, userId);
    expect(again).toBe(true);
    expect(
      pgClient.likes.filter((l) => l.post_id === postSample.id && l.liked_by === userId).length,
    ).toBe(1);
  });

  test("removeLike: normal", async () => {
    const userId = "user-2";
    await postsService.addLike(postSample.id, userId);
    const result = await postsService.removeLike(postSample.id, userId);
    expect(result).toBe(true);
    expect(pgClient.likes.some((l) => l.post_id === postSample.id && l.liked_by === userId)).toBe(
      false,
    );
  });

  test("removeLike: not found", async () => {
    const result = await postsService.removeLike(postSample.id, "no-such-user");
    expect(result).toBe(false);
  });
});

describe("listPostsByFolloweesDetail", () => {
  let pgClient: MockPgClient;
  let postsService: PostsService;
  let alice: string, bob: string, carol: string;
  let postAlice: Post, postBob: Post, postCarol: Post;

  beforeEach(() => {
    pgClient = new MockPgClient();
    postsService = new PostsService(pgClient as any);

    pgClient.users.push({ id: "user-1", nickname: "Alice" });
    pgClient.users.push({ id: "user-2", nickname: "Bob" });
    pgClient.users.push({ id: "user-3", nickname: "Carol" });

    alice = "user-1";
    bob = "user-2";
    carol = "user-3";

    pgClient.follows.push({ follower_id: alice, followee_id: bob });

    postAlice = {
      id: uuidv4(),
      content: "post-alice",
      owned_by: alice,
      reply_to: null,
      created_at: new Date().toISOString(),
    };
    postBob = {
      id: uuidv4(),
      content: "post-bob",
      owned_by: bob,
      reply_to: null,
      created_at: new Date().toISOString(),
    };
    postCarol = {
      id: uuidv4(),
      content: "post-carol",
      owned_by: carol,
      reply_to: null,
      created_at: new Date().toISOString(),
    };
    pgClient.data.push(postAlice, postBob, postCarol);
  });

  test("should not include self posts when include_self is false", async () => {
    const input: ListPostsByFolloweesDetailInput = {
      user_id: alice,
      include_self: false,
      offset: 0,
      limit: 10,
      order: "desc",
    };
    const result = await postsService.listPostsByFolloweesDetail(input);
    expect(result.some((p) => p.owned_by === alice)).toBe(false);
    expect(result.some((p) => p.owned_by === bob)).toBe(true);
    expect(result.some((p) => p.owned_by === carol)).toBe(false);
  });

  test("should include self posts when include_self is true", async () => {
    const input: ListPostsByFolloweesDetailInput = {
      user_id: alice,
      include_self: true,
      offset: 0,
      limit: 10,
      order: "desc",
    };
    const result = await postsService.listPostsByFolloweesDetail(input);
    expect(result.some((p) => p.owned_by === alice)).toBe(true);
    expect(result.some((p) => p.owned_by === bob)).toBe(true);
    expect(result.some((p) => p.owned_by === carol)).toBe(false);
  });
});

describe("listPostsLikedByUserDetail", () => {
  let pgClient: MockPgClient;
  let postsService: PostsService;
  let alice: string, bob: string;
  let post1: Post, post2: Post;

  beforeEach(() => {
    pgClient = new MockPgClient();
    postsService = new PostsService(pgClient as any);

    pgClient.users.push({ id: "user-1", nickname: "Alice" });
    pgClient.users.push({ id: "user-2", nickname: "Bob" });

    alice = "user-1";
    bob = "user-2";
    post1 = {
      id: uuidv4(),
      content: "liked-by-alice",
      owned_by: bob,
      reply_to: null,
      created_at: new Date().toISOString(),
    };
    post2 = {
      id: uuidv4(),
      content: "not-liked",
      owned_by: bob,
      reply_to: null,
      created_at: new Date().toISOString(),
    };
    pgClient.data.push(post1, post2);

    pgClient.likes.push({ post_id: post1.id, liked_by: alice });
  });

  test("should return posts liked by the user", async () => {
    const input: ListPostsLikedByUserDetailInput = {
      user_id: alice,
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
      user_id: bob,
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
    post_likes: { post_id: string; liked_by: string }[] = [];
    post_tags: { post_id: string; name: string }[] = [];

    async query(sql: string, params?: any[]) {
      sql = normalizeSql(sql);
      if (sql.includes("FROM posts p") && sql.includes("JOIN users u ON p.owned_by = u.id")) {
        const id = params![0];
        const p = this.posts.find((x) => x.id === id);
        if (!p) return { rows: [] };
        const u = this.users.find((x) => x.id === p.owned_by);
        const reply_count = this.posts.filter((x) => x.reply_to === p.id).length;
        const like_count = this.post_likes.filter((x) => x.post_id === p.id).length;
        const tags = this.post_tags
          .filter((x) => x.post_id === p.id)
          .map((x) => x.name)
          .sort();
        const replyToPost = this.posts.find((pp) => pp.id === p.reply_to);
        const reply_to_owner_nickname = replyToPost
          ? (this.users.find((u) => u.id === replyToPost.owned_by)?.nickname ?? null)
          : null;
        const row: PostDetail = {
          id: p.id,
          content: p.content,
          owned_by: p.owned_by,
          reply_to: p.reply_to,
          created_at: p.created_at,
          owner_nickname: u?.nickname || "",
          reply_to_owner_nickname,
          reply_count,
          like_count,
          tags,
        };
        return { rows: [row] };
      }
      return { rows: [] };
    }
  }

  let pgClient: MockPgClientDetail;
  let postsService: PostsService;
  let post: Post;
  let owner: { id: string; nickname: string };

  beforeEach(() => {
    pgClient = new MockPgClientDetail();
    postsService = new PostsService(pgClient as any);

    owner = { id: uuidv4(), nickname: "Poster" };
    pgClient.users.push(owner);

    post = {
      id: uuidv4(),
      content: "detail content",
      owned_by: owner.id,
      reply_to: null,
      created_at: new Date().toISOString(),
    };
    pgClient.posts.push(post);

    pgClient.post_likes.push(
      { post_id: post.id, liked_by: uuidv4() },
      { post_id: post.id, liked_by: uuidv4() },
    );

    pgClient.post_tags.push({ post_id: post.id, name: "tag1" }, { post_id: post.id, name: "tag2" });

    pgClient.posts.push(
      {
        id: uuidv4(),
        content: "reply1",
        owned_by: uuidv4(),
        reply_to: post.id,
        created_at: new Date().toISOString(),
      },
      {
        id: uuidv4(),
        content: "reply2",
        owned_by: uuidv4(),
        reply_to: post.id,
        created_at: new Date().toISOString(),
      },
    );
  });

  test("getPostDetail returns all meta correctly", async () => {
    const detail = await postsService.getPostDetail(post.id);
    expect(detail).not.toBeNull();
    expect(detail!.id).toBe(post.id);
    expect(detail!.owner_nickname).toBe(owner.nickname);
    expect(detail!.reply_count).toBe(2);
    expect(detail!.like_count).toBe(2);
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
      owned_by: anotherOwner.id,
      reply_to: null,
      created_at: new Date().toISOString(),
    };
    pgClient.posts.push(p2);

    const detail = await postsService.getPostDetail(p2.id);
    expect(detail).not.toBeNull();
    expect(detail!.owner_nickname).toBe("Nobody");
    expect(detail!.reply_count).toBe(0);
    expect(detail!.like_count).toBe(0);
    expect(detail!.tags).toEqual([]);
  });
});

describe("listLikers", () => {
  class MockPgClient {
    users: User[] = [];
    post_likes: { post_id: string; liked_by: string; created_at: string }[] = [];

    async query(sql: string, params?: any[]) {
      sql = normalizeSql(sql);
      if (
        sql.includes("FROM post_likes pl") &&
        sql.includes("JOIN users u ON pl.liked_by = u.id") &&
        sql.includes("WHERE pl.post_id = $1")
      ) {
        const post_id = params![0];
        const offset = params![1] ?? 0;
        const limit = params![2] ?? 100;
        const likes = this.post_likes
          .filter((l) => l.post_id === post_id)
          .sort((a, b) => b.created_at.localeCompare(a.created_at));
        const likedUserIds = likes.map((l) => l.liked_by).slice(offset, offset + limit);
        const result = this.users.filter((u) => likedUserIds.includes(u.id));
        return { rows: result };
      }
      return { rows: [] };
    }
  }

  let pgClient: MockPgClient;
  let postsService: PostsService;
  let user1: User, user2: User, user3: User, postId: string;

  beforeEach(() => {
    pgClient = new MockPgClient();
    postsService = new PostsService(pgClient as any);
    user1 = {
      id: uuidv4(),
      email: "alice@example.com",
      nickname: "Alice",
      is_admin: false,
      introduction: "Hi, I'm Alice.",
      personality: "",
      model: "",
      created_at: new Date().toISOString(),
    };
    user2 = {
      id: uuidv4(),
      email: "bob@example.com",
      nickname: "Bob",
      is_admin: false,
      introduction: "Hi, I'm Bob.",
      personality: "",
      model: "",
      created_at: new Date().toISOString(),
    };
    user3 = {
      id: uuidv4(),
      email: "carol@example.com",
      nickname: "Carol",
      is_admin: false,
      introduction: "Hi, I'm Carol.",
      personality: "",
      model: "",
      created_at: new Date().toISOString(),
    };
    postId = uuidv4();

    pgClient.users.push(user1, user2, user3);
    pgClient.post_likes.push(
      { post_id: postId, liked_by: user1.id, created_at: "2024-01-01T12:00:00Z" },
      { post_id: postId, liked_by: user2.id, created_at: "2024-01-02T12:00:00Z" },
    );
  });

  test("should return users who liked a post", async () => {
    const users = await postsService.listLikers({
      post_id: postId,
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
      post_id: postId,
      offset: 0,
      limit: 1,
      order: "desc",
    } as ListLikersInput);
    expect(users1.length).toBe(1);

    const users2 = await postsService.listLikers({
      post_id: postId,
      offset: 1,
      limit: 1,
      order: "desc",
    } as ListLikersInput);
    expect(users2.length).toBe(1);
    expect(users1[0].id).not.toBe(users2[0].id);
  });

  test("should return empty array if no likes", async () => {
    const users = await postsService.listLikers({
      post_id: uuidv4(),
      offset: 0,
      limit: 10,
      order: "desc",
    } as ListLikersInput);
    expect(users.length).toBe(0);
  });
});
