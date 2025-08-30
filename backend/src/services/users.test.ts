import { UsersService } from "./users";
import { User } from "../models/user";
import crypto from "crypto";

function md5(s: string) {
  return crypto.createHash("md5").update(s).digest("hex");
}

type UserDetailRow = {
  introduction: string;
  aiPersonality: string | null;
};

class MockPgClient {
  users: User[];
  details: Record<string, UserDetailRow>;
  follows: { followerId: string; followeeId: string }[];
  passwords: Record<string, string>;

  constructor() {
    this.users = [
      {
        id: "alice",
        email: "alice@example.com",
        nickname: "Alice",
        isAdmin: false,
        snippet: "introA",
        avatar: null,
        aiModel: "gpt-4.1",
        createdAt: "2020-01-01T00:00:00Z",
        updatedAt: null,
        countFollowers: 0,
        countFollowees: 0,
        countPosts: 0,
      },
      {
        id: "bob",
        email: "bob@example.com",
        nickname: "Bob",
        isAdmin: false,
        snippet: "introB",
        avatar: null,
        aiModel: "gpt-4.1",
        createdAt: "2020-01-02T00:00:00Z",
        updatedAt: null,
        countFollowers: 0,
        countFollowees: 0,
        countPosts: 0,
      },
      {
        id: "carol",
        email: "carol@example.com",
        nickname: "Carol",
        isAdmin: false,
        snippet: "introC",
        avatar: null,
        aiModel: "gpt-4.1",
        createdAt: "2020-01-03T00:00:00Z",
        updatedAt: null,
        countFollowers: 0,
        countFollowees: 0,
        countPosts: 0,
      },
    ];
    this.details = {
      alice: { introduction: "introA", aiPersonality: "A" },
      bob: { introduction: "introB", aiPersonality: "B" },
      carol: { introduction: "introC", aiPersonality: "C" },
    };
    this.follows = [
      { followerId: "alice", followeeId: "bob" },
      { followerId: "alice", followeeId: "carol" },
      { followerId: "bob", followeeId: "alice" },
      { followerId: "carol", followeeId: "alice" },
    ];
    this.passwords = {
      alice: md5("alicepass"),
      bob: md5("bobpass"),
      carol: md5("carolpass"),
    };
  }

  private cntFollowers(id: string) {
    return this.follows.filter((f) => f.followeeId === id).length;
  }
  private cntFollowees(id: string) {
    return this.follows.filter((f) => f.followerId === id).length;
  }

  async query(sql: string, params: any[] = []) {
    sql = sql.replace(/\s+/g, " ").trim();

    if (sql === "BEGIN" || sql === "COMMIT" || sql === "ROLLBACK") {
      return { rows: [] };
    }

    if (
      sql.startsWith("WITH") &&
      sql.includes("dedup AS") &&
      sql.includes("page AS") &&
      sql.includes("JOIN users u ON u.id = p.id")
    ) {
      const likePattern: string = params[0];
      const focusUserId: string = params[1];
      const offset: number = params[2] ?? 0;
      const limit: number = params[3] ?? 20;
      const k: number = params[4] ?? offset + limit;
      const prefix = likePattern.toLowerCase().replace(/%+$/g, "");
      const match = (u: User) => u.nickname.toLowerCase().startsWith(prefix);
      const hasSelf = sql.includes("self AS (");
      const hasOthers = sql.includes("others AS (");
      const candidates: Array<{ prio: number; id: string; nkey: string }> = [];
      if (hasSelf) {
        const selfUser = this.users.find((u) => u.id === focusUserId && match(u));
        if (selfUser) {
          candidates.push({ prio: 0, id: selfUser.id, nkey: selfUser.nickname.toLowerCase() });
        }
      }
      const followeeIds = this.follows
        .filter((f) => f.followerId === focusUserId)
        .map((f) => f.followeeId);
      const followees = this.users
        .filter((u) => followeeIds.includes(u.id) && match(u))
        .sort(
          (a, b) =>
            a.nickname.toLowerCase().localeCompare(b.nickname.toLowerCase()) ||
            a.nickname.localeCompare(b.nickname) ||
            a.id.localeCompare(b.id),
        )
        .slice(0, k);
      for (const u of followees) {
        candidates.push({ prio: 1, id: u.id, nkey: u.nickname.toLowerCase() });
      }
      if (hasOthers) {
        const others = this.users
          .filter((u) => match(u))
          .sort(
            (a, b) =>
              a.nickname.toLowerCase().localeCompare(b.nickname.toLowerCase()) ||
              a.nickname.localeCompare(b.nickname) ||
              a.id.localeCompare(b.id),
          )
          .slice(0, k);
        for (const u of others) {
          candidates.push({ prio: 3, id: u.id, nkey: u.nickname.toLowerCase() });
        }
      }
      const bestById = new Map<string, { prio: number; id: string; nkey: string }>();
      for (const c of candidates) {
        const prev = bestById.get(c.id);
        if (!prev || c.prio < prev.prio) bestById.set(c.id, c);
      }
      const deduped = Array.from(bestById.values()).sort(
        (a, b) => a.prio - b.prio || a.nkey.localeCompare(b.nkey) || a.id.localeCompare(b.id),
      );
      const page = deduped.slice(offset, offset + limit);
      const rows = page
        .map((p) => this.users.find((u) => u.id === p.id))
        .filter((u): u is User => !!u)
        .map((u) => ({
          id: u.id,
          email: u.email,
          nickname: u.nickname,
          is_admin: u.isAdmin,
          snippet: u.snippet,
          avatar: u.avatar,
          ai_model: u.aiModel,
          created_at: u.createdAt,
          updated_at: u.updatedAt,
          count_followers: this.cntFollowers(u.id),
          count_followees: this.cntFollowees(u.id),
          count_posts: 0,
        }));
      return { rows };
    }

    if (sql.startsWith("SELECT COUNT(*) FROM users u")) {
      if (
        sql.includes("WHERE (u.nickname ILIKE $1 OR u.snippet ILIKE $1 OR d.introduction ILIKE $1)")
      ) {
        const pat = params[0].toLowerCase().replace(/%/g, "");
        return {
          rows: [
            {
              count: this.users.filter(
                (u) =>
                  u.nickname.toLowerCase().includes(pat) ||
                  (u.snippet ?? "").toLowerCase().includes(pat) ||
                  (this.details[u.id]?.introduction ?? "").toLowerCase().includes(pat),
              ).length,
            },
          ],
        };
      }
      if (sql.includes("WHERE u.nickname ILIKE $1")) {
        const pat = params[0].toLowerCase().replace(/%/g, "");
        return {
          rows: [
            { count: this.users.filter((u) => u.nickname.toLowerCase().includes(pat)).length },
          ],
        };
      }
      if (sql.includes("WHERE LOWER(u.nickname) LIKE $1")) {
        const pat = params[0].toLowerCase().replace(/%/g, "");
        return {
          rows: [
            { count: this.users.filter((u) => u.nickname.toLowerCase().startsWith(pat)).length },
          ],
        };
      }
      return { rows: [{ count: this.users.length }] };
    }

    if (sql.startsWith("SELECT id FROM users WHERE email = $1")) {
      const user = this.users.find((u) => u.email === params[0]);
      if (!user) return { rows: [] };
      return { rows: [{ id: user.id }] };
    }

    // getUserLite
    if (
      sql.startsWith(
        "SELECT id, email, nickname, is_admin, ai_model, created_at, updated_at, count_followers, count_followees, count_posts FROM users WHERE id = $1",
      )
    ) {
      const user = this.users.find((u) => u.id === params[0]);
      if (!user) return { rows: [] };
      const row = {
        id: user.id,
        email: user.email,
        nickname: user.nickname,
        is_admin: user.isAdmin,
        ai_model: user.aiModel,
        created_at: user.createdAt,
        updated_at: user.updatedAt,
        count_followers: this.cntFollowers(user.id),
        count_followees: this.cntFollowees(user.id),
        count_posts: 0,
      };
      return { rows: [row] };
    }

    // getUser (detail)
    if (
      sql.startsWith(
        "SELECT u.id, u.email, u.nickname, u.is_admin, u.snippet, u.avatar, u.ai_model, u.created_at, u.updated_at, u.count_followers, u.count_followees, u.count_posts, d.introduction, d.ai_personality FROM users u LEFT JOIN user_details d ON d.user_id = u.id WHERE u.id = $1",
      )
    ) {
      const user = this.users.find((u) => u.id === params[0]);
      if (!user) return { rows: [] };
      const d = this.details[user.id] ?? { introduction: "", aiPersonality: null };
      const row = {
        id: user.id,
        email: user.email,
        nickname: user.nickname,
        is_admin: user.isAdmin,
        snippet: user.snippet,
        avatar: user.avatar,
        ai_model: user.aiModel,
        created_at: user.createdAt,
        updated_at: user.updatedAt,
        count_followers: this.cntFollowers(user.id),
        count_followees: this.cntFollowees(user.id),
        count_posts: 0,
        introduction: d.introduction,
        ai_personality: d.aiPersonality,
      };
      return { rows: [row] };
    }

    // getUser: focusUser との相互フォロー関係チェック（EXISTS…AS … クエリ）
    if (
      sql.startsWith(
        "SELECT EXISTS (SELECT 1 FROM user_follows WHERE follower_id = $1 AND followee_id = $2) AS is_followed_by_focus_user",
      )
    ) {
      const [focusUserId, id] = params;
      return {
        rows: [
          {
            is_followed_by_focus_user: this.follows.some(
              (f) => f.followerId === focusUserId && f.followeeId === id,
            ),
            is_following_focus_user: this.follows.some(
              (f) => f.followerId === id && f.followeeId === focusUserId,
            ),
          },
        ],
      };
    }

    if (
      sql.startsWith(
        "SELECT u.id, u.email, u.nickname, u.is_admin, u.snippet, u.avatar, u.ai_model, u.created_at, u.updated_at, u.count_followers, u.count_followees, u.count_posts FROM users u",
      )
    ) {
      let list = [...this.users];
      if (
        sql.includes("WHERE (u.nickname ILIKE $1 OR u.snippet ILIKE $1 OR d.introduction ILIKE $1)")
      ) {
        const pat = params[0].toLowerCase().replace(/%/g, "");
        list = list.filter(
          (u) =>
            u.nickname.toLowerCase().includes(pat) ||
            (u.snippet ?? "").toLowerCase().includes(pat) ||
            (this.details[u.id]?.introduction ?? "").toLowerCase().includes(pat),
        );
      } else if (sql.includes("WHERE u.nickname ILIKE")) {
        const pat = params[0].toLowerCase().replace(/%/g, "");
        list = list.filter((u) => u.nickname.toLowerCase().includes(pat));
      } else if (sql.includes("WHERE LOWER(u.nickname) LIKE")) {
        const pat = params[0].toLowerCase().replace(/%/g, "");
        list = list.filter((u) => u.nickname.toLowerCase().startsWith(pat));
      }
      list.sort((a, b) => b.id.localeCompare(a.id));
      const offset = params[params.length - 2] || 0;
      const limit = params[params.length - 1] || 100;
      const rows = list.slice(offset, offset + limit).map((u) => ({
        id: u.id,
        email: u.email,
        nickname: u.nickname,
        is_admin: u.isAdmin,
        snippet: u.snippet,
        avatar: u.avatar,
        ai_model: u.aiModel,
        created_at: u.createdAt,
        updated_at: u.updatedAt,
        count_followers: this.cntFollowers(u.id),
        count_followees: this.cntFollowees(u.id),
        count_posts: 0,
      }));
      return { rows };
    }

    if (
      sql.startsWith(
        "SELECT followee_id FROM user_follows WHERE follower_id = $1 AND followee_id = ANY($2)",
      )
    ) {
      const [focusUserId, ids] = params;
      return {
        rows: this.follows
          .filter((f) => f.followerId === focusUserId && ids.includes(f.followeeId))
          .map((f) => ({ followee_id: f.followeeId })),
      };
    }
    if (
      sql.startsWith(
        "SELECT follower_id FROM user_follows WHERE follower_id = ANY($1) AND followee_id = $2",
      )
    ) {
      const [ids, focusUserId] = params;
      return {
        rows: this.follows
          .filter((f) => ids.includes(f.followerId) && f.followeeId === focusUserId)
          .map((f) => ({ follower_id: f.followerId })),
      };
    }

    if (sql.startsWith("SELECT 1 FROM users WHERE email = $1")) {
      const email = params[0];
      const exists = this.users.some((u) => u.email === email);
      return { rows: exists ? [1] : [] };
    }

    if (
      sql.startsWith(
        "INSERT INTO users (id, email, nickname, password, is_admin, snippet, avatar, ai_model, created_at, updated_at) VALUES",
      )
    ) {
      const [id, email, nickname, password, isAdmin, snippet, avatar, aiModel, idDate] = params;
      const user: User = {
        id,
        email,
        nickname,
        isAdmin,
        snippet,
        avatar,
        aiModel,
        createdAt: idDate,
        updatedAt: null,
        countFollowers: 0,
        countFollowees: 0,
        countPosts: 0,
      };
      this.users.push(user);
      this.passwords[user.id] = password;
      return {
        rows: [
          {
            ...user,
            is_admin: user.isAdmin,
            ai_model: user.aiModel,
            created_at: user.createdAt,
            updated_at: user.updatedAt,
            count_followers: user.countFollowers,
            count_followees: user.countFollowees,
            count_posts: user.countPosts,
          },
        ],
      };
    }

    if (sql.startsWith("INSERT INTO user_details (user_id, introduction, ai_personality)")) {
      const [userId, introduction, aiPersonality] = params;
      const hasCoalesce = sql.includes("COALESCE(EXCLUDED.introduction");
      const prev = this.details[userId] ?? { introduction: "", aiPersonality: null };
      this.details[userId] = {
        introduction:
          hasCoalesce && (introduction === null || introduction === undefined)
            ? prev.introduction
            : (introduction ?? ""),
        aiPersonality:
          hasCoalesce && (aiPersonality === null || aiPersonality === undefined)
            ? prev.aiPersonality
            : (aiPersonality ?? null),
      };
      return { rowCount: 1, rows: [] };
    }

    if (sql.startsWith("UPDATE users SET password = $1 WHERE id = $2")) {
      const [password, id] = params;
      const exists = this.users.some((u) => u.id === id);
      if (!exists) return { rowCount: 0 };
      this.passwords[id] = password;
      return { rowCount: 1 };
    }

    if (sql.startsWith("UPDATE users SET")) {
      const user = this.users.find((u) => u.id === params[params.length - 1]);
      if (!user) return { rows: [] };
      if (sql.includes("email = $1")) user.email = params[0];
      if (sql.includes("nickname = $2") || sql.includes("nickname = $1"))
        user.nickname =
          params.find((p: any) => typeof p === "string" && p.includes("@") === false) ??
          user.nickname;
      if (sql.includes("is_admin ="))
        user.isAdmin = !!params.find((p: any) => typeof p === "boolean");
      if (sql.includes("avatar ="))
        user.avatar = params.find((p: any) => p === null || typeof p === "string") ?? user.avatar;
      if (sql.includes("ai_model ="))
        user.aiModel = params.find((p: any) => typeof p === "string") ?? user.aiModel;
      if (sql.includes("snippet =")) {
        const i = sql.split(",").findIndex((seg) => seg.includes("snippet ="));
        user.snippet = params[i >= 0 ? i : 0] ?? user.snippet;
      }
      return {
        rows: [
          {
            id: user.id,
            email: user.email,
            nickname: user.nickname,
            is_admin: user.isAdmin,
            snippet: user.snippet,
            avatar: user.avatar,
            ai_model: user.aiModel,
            created_at: user.createdAt,
            updated_at: new Date().toISOString(),
            count_followers: this.cntFollowers(user.id),
            count_followees: this.cntFollowees(user.id),
            count_posts: 0,
          },
        ],
        rowCount: 1,
      };
    }

    if (sql.startsWith("DELETE FROM users WHERE id = $1")) {
      const id = params[0];
      const idx = this.users.findIndex((u) => u.id === id);
      if (idx === -1) return { rowCount: 0 };
      this.users.splice(idx, 1);
      delete this.passwords[id];
      delete this.details[id];
      this.follows = this.follows.filter((f) => f.followerId !== id && f.followeeId !== id);
      return { rowCount: 1 };
    }

    if (
      sql.startsWith(
        "SELECT u.id, u.email, u.nickname, u.is_admin, u.snippet, u.avatar, u.ai_model, u.created_at, u.updated_at, u.count_followers, u.count_followees, u.count_posts FROM user_follows f JOIN users u ON f.followee_id = u.id WHERE f.follower_id = $1",
      )
    ) {
      const followerId = params[0];
      const list = this.follows
        .filter((f) => f.followerId === followerId)
        .map((f) => this.users.find((u) => u.id === f.followeeId))
        .filter((u): u is User => !!u);
      list.sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id));
      const offset = params[1] || 0;
      const limit = params[2] || 100;
      const rows = list.slice(offset, offset + limit).map((u) => ({
        id: u.id,
        email: u.email,
        nickname: u.nickname,
        is_admin: u.isAdmin,
        snippet: u.snippet,
        avatar: u.avatar,
        ai_model: u.aiModel,
        created_at: u.createdAt,
        updated_at: u.updatedAt,
        count_followers: this.cntFollowers(u.id),
        count_followees: this.cntFollowees(u.id),
        count_posts: 0,
      }));
      return { rows };
    }

    if (
      sql.startsWith(
        "SELECT u.id, u.email, u.nickname, u.is_admin, u.snippet, u.avatar, u.ai_model, u.created_at, u.updated_at, u.count_followers, u.count_followees, u.count_posts FROM user_follows f JOIN users u ON f.follower_id = u.id WHERE f.followee_id = $1",
      )
    ) {
      const followeeId = params[0];
      const list = this.follows
        .filter((f) => f.followeeId === followeeId)
        .map((f) => this.users.find((u) => u.id === f.followerId))
        .filter((u): u is User => !!u);
      list.sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id));
      const offset = params[1] || 0;
      const limit = params[2] || 100;
      const rows = list.slice(offset, offset + limit).map((u) => ({
        id: u.id,
        email: u.email,
        nickname: u.nickname,
        is_admin: u.isAdmin,
        snippet: u.snippet,
        avatar: u.avatar,
        ai_model: u.aiModel,
        created_at: u.createdAt,
        updated_at: u.updatedAt,
        count_followers: this.cntFollowers(u.id),
        count_followees: this.cntFollowees(u.id),
        count_posts: 0,
      }));
      return { rows };
    }

    if (sql.startsWith("INSERT INTO user_follows")) {
      const [followerId, followeeId] = params;
      if (!this.follows.some((f) => f.followerId === followerId && f.followeeId === followeeId)) {
        this.follows.push({ followerId, followeeId });
      }
      return { rowCount: 1 };
    }
    if (sql.startsWith("DELETE FROM user_follows WHERE follower_id = $1 AND followee_id = $2")) {
      const [followerId, followeeId] = params;
      const prev = this.follows.length;
      this.follows = this.follows.filter(
        (f) => !(f.followerId === followerId && f.followeeId === followeeId),
      );
      return { rowCount: prev - this.follows.length };
    }

    throw new Error("Unknown SQL: " + sql);
  }
}

class MockRedis {
  store: Record<string, any> = {};
  queue: { queue: string; val: string }[] = [];
  async hmset(key: string, obj: any) {
    this.store[key] = { ...obj };
  }
  async hgetall(key: string) {
    return this.store[key] ? { ...this.store[key] } : {};
  }
  async expire(_key: string, _ttl: number) {}
  async lpush(queue: string, val: string) {
    this.queue.push({ queue, val });
  }
  async del(key: string) {
    delete this.store[key];
  }
}

describe("UsersService", () => {
  let pg: MockPgClient;
  let redis: MockRedis;
  let service: UsersService;

  beforeEach(() => {
    pg = new MockPgClient();
    redis = new MockRedis();
    service = new UsersService(pg as any, redis as any);
  });

  test("countUsers (all/nickname/query)", async () => {
    expect(await service.countUsers()).toBe(3);
    expect(await service.countUsers({ nickname: "B" })).toBe(1);
    expect(await service.countUsers({ query: "intro" })).toBe(3);
    expect(await service.countUsers({ query: "introA" })).toBe(1);
  });

  test("getUserLite", async () => {
    const u = await service.getUserLite("alice");
    expect(u?.id).toBe("alice");
    expect(u?.email).toBe("alice@example.com");
    expect(u?.aiModel).toBe("gpt-4.1");
  });

  test("getUser (with focusUserId)", async () => {
    const user = await service.getUser("alice", "bob");
    expect(user?.id).toBe("alice");
    expect(user?.countFollowers).toBe(2);
    expect(user?.countFollowees).toBe(2);
    expect(user?.countPosts).toBe(0);
    expect(user?.isFollowedByFocusUser).toBe(true);
    expect(user?.isFollowingFocusUser).toBe(true);
    expect(user?.introduction).toBe("introA");
  });

  test("listUsers (with focusUserId)", async () => {
    const users = await service.listUsers({}, "bob");
    const alice = users.find((u) => u.id === "alice")!;
    expect(alice.countFollowees).toBe(2);
    expect(alice.countPosts).toBe(0);
    expect(alice.isFollowedByFocusUser).toBe(true);
    expect(alice.isFollowingFocusUser).toBe(true);
    const bob = users.find((u) => u.id === "bob")!;
    expect(bob.countFollowers).toBe(1);
    expect(bob.countFollowees).toBe(1);
    expect(bob.countPosts).toBe(0);
    expect(bob.isFollowedByFocusUser).toBeUndefined();
    expect(bob.isFollowingFocusUser).toBeUndefined();
    const carol = users.find((u) => u.id === "carol")!;
    expect(carol.countFollowers).toBe(1);
    expect(carol.countFollowees).toBe(1);
    expect(carol.countPosts).toBe(0);
    expect(carol.isFollowedByFocusUser).toBe(false);
    expect(carol.isFollowingFocusUser).toBe(false);
  });

  test("createUser", async () => {
    const user = await service.createUser({
      email: "dan@example.com",
      nickname: "Dan",
      password: "danpass",
      isAdmin: false,
      introduction: "introD",
      avatar: null,
      aiModel: "gpt-4.1",
      aiPersonality: "D",
    });
    expect(user.email).toBe("dan@example.com");
    expect(pg.users.find((u) => u.email === "dan@example.com")).toBeDefined();
    expect(pg.passwords[user.id]).toBe(md5("danpass"));
    expect(pg.details[user.id]?.introduction).toBe("introD");
    expect(pg.details[user.id]?.aiPersonality).toBe("D");
  });

  test("updateUser (including details)", async () => {
    const user = await service.updateUser({
      id: "alice",
      email: "alice2@example.com",
      nickname: "Alice2",
      isAdmin: true,
      introduction: "introX",
      avatar: null,
      aiModel: "gpt-4.1-mini",
      aiPersonality: "X",
    });
    expect(user?.email).toBe("alice2@example.com");
    expect(user?.isAdmin).toBe(true);
    const detail = await service.getUser("alice");
    expect(detail?.introduction).toBe("introX");
    expect(detail?.aiPersonality).toBe("X");
  });

  test("startUpdateEmail stores verification info in Redis and queues mail", async () => {
    const userId = "alice";
    const newEmail = "alice_new@example.com";
    const result = await service.startUpdateEmail(userId, newEmail);
    expect(result).toHaveProperty("updateEmailId");
    const stored = redis.store[Object.keys(redis.store)[0]];
    expect(stored.userId).toBe(userId);
    expect(stored.newEmail).toBe(newEmail);
    expect(typeof stored.verificationCode).toBe("string");
    expect(redis.queue.some((q) => q.queue === "mail-queue" && q.val.includes(newEmail))).toBe(
      true,
    );
  });

  test("verifyUpdateEmail: updates email if code matches & email unused", async () => {
    await redis.hmset("updateEmail:xyz", {
      userId: "alice",
      newEmail: "alice2@example.com",
      verificationCode: "123456",
      createdAt: new Date().toISOString(),
    });
    await new UsersService(pg as any, redis as any).verifyUpdateEmail("alice", "xyz", "123456");
    expect(pg.users.find((u) => u.id === "alice")?.email).toBe("alice2@example.com");
    expect(await redis.hgetall("updateEmail:xyz")).toEqual({});
  });

  test("verifyUpdateEmail: throws if code mismatch", async () => {
    await redis.hmset("updateEmail:abc", {
      userId: "alice",
      newEmail: "alice3@example.com",
      verificationCode: "654321",
      createdAt: new Date().toISOString(),
    });
    await expect(
      new UsersService(pg as any, redis as any).verifyUpdateEmail("alice", "abc", "wrongcode"),
    ).rejects.toThrow(/mismatch/i);
  });

  test("updateUserPassword", async () => {
    const id = pg.users[0].id;
    await service.updateUserPassword({ id, password: "newpass" });
    expect(pg.passwords[id]).toBe(md5("newpass"));
    await expect(service.updateUserPassword({ id: "no-such-id", password: "x" })).rejects.toThrow(
      /User not found/i,
    );
  });

  test("startResetPassword stores verification info in Redis and queues mail", async () => {
    const userId = "alice";
    const email = "alice@example.com";
    const { resetPasswordId, webCode } = await service.startResetPassword(email);
    const stored = redis.store[`resetPassword:${resetPasswordId}`];
    expect(stored.userId).toBe(userId);
    expect(stored.email).toBe(email);
    expect(typeof stored.mailCode).toBe("string");
    expect(stored.webCode).toBe(webCode);
    expect(stored.createdAt).toBeDefined();
    expect(
      redis.queue.some(
        (q) => q.queue === "mail-queue" && q.val.includes(email) && q.val.includes(stored.mailCode),
      ),
    ).toBe(true);
  });

  test("fakeResetPassword makes a dummy session object", async () => {
    const { resetPasswordId, webCode } = await service.fakeResetPassword();
    expect(typeof resetPasswordId).toBe("string");
    expect(typeof webCode).toBe("string");
  });

  test("verifyResetPassword: resets password if codes match", async () => {
    const email = "alice@example.com";
    const { resetPasswordId, webCode } = await service.startResetPassword(email);
    const stored = redis.store[`resetPassword:${resetPasswordId}`];
    const mailCode = stored.mailCode;
    await service.verifyResetPassword(email, resetPasswordId, webCode, mailCode, "newsecurepass");
    expect(pg.passwords["alice"]).toBe(md5("newsecurepass"));
  });

  test("verifyResetPassword: throws if webCode does not match", async () => {
    const email = "alice@example.com";
    const { resetPasswordId } = await service.startResetPassword(email);
    const mailCode = redis.store[`resetPassword:${resetPasswordId}`].mailCode;
    await expect(
      service.verifyResetPassword(email, resetPasswordId, "wrongWebCode", mailCode, "pass1234"),
    ).rejects.toThrow(/web verification code mismatch/i);
  });

  test("verifyResetPassword: throws if mailCode does not match", async () => {
    const email = "alice@example.com";
    const { resetPasswordId, webCode } = await service.startResetPassword(email);
    await expect(
      service.verifyResetPassword(email, resetPasswordId, webCode, "wrongMailCode", "pass1234"),
    ).rejects.toThrow(/mail verification code mismatch/i);
  });

  test("deleteUser", async () => {
    const id = pg.users[0].id;
    await service.deleteUser(id);
    expect(pg.users.find((u) => u.id === id)).toBeUndefined();
    await expect(service.deleteUser("no-such-id")).rejects.toThrow(/User not found/i);
  });

  test("listFollowees (with focusUserId)", async () => {
    const res = await service.listFollowees({ followerId: "alice" }, "bob");
    expect(res.length).toBe(2);
    expect(res.some((u) => u.id === "bob")).toBe(true);
    expect(res.some((u) => u.id === "carol")).toBe(true);
    expect(res.every((u) => typeof u.countFollowers === "number")).toBe(true);
    expect(res.every((u) => typeof u.countPosts === "number")).toBe(true);
  });

  test("listFollowers (with focusUserId)", async () => {
    const res = await service.listFollowers({ followeeId: "alice" }, "bob");
    expect(res.length).toBe(2);
    expect(res.some((u) => u.id === "bob")).toBe(true);
    expect(res.some((u) => u.id === "carol")).toBe(true);
    expect(res.every((u) => typeof u.countFollowers === "number")).toBe(true);
    expect(res.every((u) => typeof u.countPosts === "number")).toBe(true);
  });

  test("addFollower/removeFollower", async () => {
    await service.addFollower({ followerId: "bob", followeeId: "carol" });
    expect(pg.follows.some((f) => f.followerId === "bob" && f.followeeId === "carol")).toBe(true);
    await service.removeFollower({ followerId: "bob", followeeId: "carol" });
    expect(pg.follows.some((f) => f.followerId === "bob" && f.followeeId === "carol")).toBe(false);
  });

  test("listFriendsByNicknamePrefix (typical)", async () => {
    const res = await service.listFriendsByNicknamePrefix({
      focusUserId: "alice",
      nicknamePrefix: "b",
      offset: 0,
      limit: 20,
      omitSelf: false,
      omitOthers: false,
    });
    expect(res.length).toBe(1);
    expect(res[0].id).toBe("bob");
  });
});
