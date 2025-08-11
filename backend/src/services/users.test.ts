import { UsersService } from "./users";
import { User } from "../models/user";
import crypto from "crypto";

function md5(s: string) {
  return crypto.createHash("md5").update(s).digest("hex");
}

class MockPgClient {
  users: User[];
  follows: { followerId: string; followeeId: string }[];
  passwords: Record<string, string>;

  constructor() {
    this.users = [
      {
        id: "alice",
        email: "alice@example.com",
        nickname: "Alice",
        isAdmin: false,
        introduction: "introA",
        icon: null,
        aiModel: "gpt-4.1",
        aiPersonality: "A",
        createdAt: "2020-01-01T00:00:00Z",
        updatedAt: null,
      },
      {
        id: "bob",
        email: "bob@example.com",
        nickname: "Bob",
        isAdmin: false,
        introduction: "introB",
        icon: null,
        aiModel: "gpt-4.1",
        aiPersonality: "B",
        createdAt: "2020-01-02T00:00:00Z",
        updatedAt: null,
      },
      {
        id: "carol",
        email: "carol@example.com",
        nickname: "Carol",
        isAdmin: false,
        introduction: "introC",
        icon: null,
        aiModel: "gpt-4.1",
        aiPersonality: "C",
        createdAt: "2020-01-03T00:00:00Z",
        updatedAt: null,
      },
    ];
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

    if (sql.startsWith("SELECT COUNT(*) FROM users")) {
      if (sql.includes("WHERE nickname ILIKE $1 OR introduction ILIKE $2")) {
        const [pat1, pat2] = params.map((s: string) => s.toLowerCase().replace(/%/g, ""));
        return {
          rows: [
            {
              count: this.users.filter(
                (u) =>
                  u.nickname.toLowerCase().includes(pat1) ||
                  u.introduction.toLowerCase().includes(pat2),
              ).length,
            },
          ],
        };
      }
      if (sql.includes("WHERE nickname ILIKE")) {
        const pat = params[0].toLowerCase().replace(/%/g, "");
        return {
          rows: [
            {
              count: this.users.filter((u) => u.nickname.toLowerCase().includes(pat)).length,
            },
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

    if (
      sql.startsWith(
        "SELECT id, email, nickname, is_admin, introduction, icon, ai_model, ai_personality, created_at, updated_at FROM users WHERE id = $1",
      )
    ) {
      const user = this.users.find((u) => u.id === params[0]);
      return { rows: user ? [user] : [] };
    }

    if (
      sql.startsWith(
        "SELECT id, email, nickname, is_admin, introduction, icon, ai_model, ai_personality, created_at, updated_at, count_followers, count_followees FROM users WHERE id = $1",
      )
    ) {
      const user = this.users.find((u) => u.id === params[0]);
      if (!user) return { rows: [] };
      const row = {
        ...user,
        count_followers: this.cntFollowers(user.id),
        count_followees: this.cntFollowees(user.id),
      };
      return { rows: [row] };
    }

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
        "SELECT u.id, u.email, u.nickname, u.is_admin, u.introduction, u.icon, u.ai_model, u.ai_personality, u.created_at, u.updated_at FROM users u",
      )
    ) {
      let list = [...this.users];
      if (sql.includes("WHERE (u.nickname ILIKE $1 OR u.introduction ILIKE $2)")) {
        const [pat1, pat2] = params
          .slice(0, 2)
          .map((s: string) => s.toLowerCase().replace(/%/g, ""));
        list = list.filter(
          (u) =>
            u.nickname.toLowerCase().includes(pat1) || u.introduction.toLowerCase().includes(pat2),
        );
      } else if (sql.includes("WHERE u.nickname ILIKE")) {
        const pat = params[0].toLowerCase().replace(/%/g, "");
        list = list.filter((u) => u.nickname.toLowerCase().includes(pat));
      }
      list.sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id));
      const offset = params[params.length - 2] || 0;
      const limit = params[params.length - 1] || 100;
      return { rows: list.slice(offset, offset + limit) };
    }

    if (
      sql.startsWith(
        "SELECT u.id, u.email, u.nickname, u.is_admin, u.introduction, u.icon, u.ai_model, u.ai_personality, u.created_at, u.updated_at, u.count_followers, u.count_followees FROM users u",
      )
    ) {
      let list = [...this.users];
      if (sql.includes("WHERE (u.nickname ILIKE $1 OR u.introduction ILIKE $2)")) {
        const [pat1, pat2] = params
          .slice(0, 2)
          .map((s: string) => s.toLowerCase().replace(/%/g, ""));
        list = list.filter(
          (u) =>
            u.nickname.toLowerCase().includes(pat1) || u.introduction.toLowerCase().includes(pat2),
        );
      } else if (sql.includes("WHERE u.nickname ILIKE")) {
        const pat = params[0].toLowerCase().replace(/%/g, "");
        list = list.filter((u) => u.nickname.toLowerCase().includes(pat));
      }
      list.sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id));
      const offset = params[params.length - 2] || 0;
      const limit = params[params.length - 1] || 100;
      const rows = list.slice(offset, offset + limit).map((u) => ({
        ...u,
        count_followers: this.cntFollowers(u.id),
        count_followees: this.cntFollowees(u.id),
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

    if (sql.startsWith("INSERT INTO users")) {
      const [id, email, nickname, password, isAdmin, introduction, icon, aiModel, aiPersonality] =
        params;
      const user: User = {
        id,
        email,
        nickname,
        isAdmin,
        introduction,
        icon,
        aiModel,
        aiPersonality,
        createdAt: new Date().toISOString(),
        updatedAt: null,
      };
      this.users.push(user);
      this.passwords[user.id] = password;
      return { rows: [user] };
    }

    if (sql.startsWith("UPDATE users SET password = $1 WHERE id = $2")) {
      const [password, id] = params;
      const exists = this.users.some((u) => u.id === id);
      if (!exists) return { rowCount: 0 };
      this.passwords[id] = password;
      return { rowCount: 1 };
    }

    if (sql.startsWith("UPDATE users SET")) {
      const columns = sql
        .substring(sql.indexOf("SET ") + 4, sql.indexOf(" WHERE"))
        .split(", ")
        .map((col) => col.split("=")[0].trim());
      const user = this.users.find((u) => u.id === params[params.length - 1]);
      if (!user) return { rows: [] };
      for (let i = 0; i < columns.length; ++i) {
        (user as any)[columns[i]] = params[i];
      }
      return { rows: [user], rowCount: 1 };
    }

    if (sql.startsWith("DELETE FROM users WHERE id = $1")) {
      const id = params[0];
      const idx = this.users.findIndex((u) => u.id === id);
      if (idx === -1) return { rowCount: 0 };
      this.users.splice(idx, 1);
      delete this.passwords[id];
      this.follows = this.follows.filter((f) => f.followerId !== id && f.followeeId !== id);
      return { rowCount: 1 };
    }

    if (
      sql.startsWith(
        "SELECT u.id, u.email, u.nickname, u.is_admin, u.introduction, u.icon, u.ai_model, u.ai_personality, u.created_at, u.updated_at, u.count_followers, u.count_followees FROM user_follows f JOIN users u ON f.followee_id = u.id WHERE f.follower_id = $1",
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
        ...u,
        count_followers: this.cntFollowers(u.id),
        count_followees: this.cntFollowees(u.id),
      }));
      return { rows };
    }

    if (
      sql.startsWith(
        "SELECT u.id, u.email, u.nickname, u.is_admin, u.introduction, u.icon, u.ai_model, u.ai_personality, u.created_at, u.updated_at, u.count_followers, u.count_followees FROM user_follows f JOIN users u ON f.follower_id = u.id WHERE f.followee_id = $1",
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
        ...u,
        count_followers: this.cntFollowers(u.id),
        count_followees: this.cntFollowees(u.id),
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

  test("getUser", async () => {
    const user = await service.getUser("alice");
    expect(user?.id).toBe("alice");
    expect(await service.getUser("no-such-id")).toBeNull();
  });

  test("getUserDetail (with focusUserId)", async () => {
    const detail = await service.getUserDetail("alice", "bob");
    expect(detail?.id).toBe("alice");
    expect(detail?.countFollowers).toBe(2);
    expect(detail?.countFollowees).toBe(2);
    expect(detail?.isFollowedByFocusUser).toBe(true);
    expect(detail?.isFollowingFocusUser).toBe(true);
  });

  test("listUsers", async () => {
    const users = await service.listUsers();
    expect(users.length).toBe(3);
    expect(users[0].id).toBe("carol");
    expect(users[2].id).toBe("alice");
  });

  test("listUsersDetail (with focusUserId)", async () => {
    const details = await service.listUsersDetail({}, "bob");
    const aliceDetail = details.find((u) => u.id === "alice")!;
    expect(aliceDetail.countFollowees).toBe(2);
    expect(aliceDetail.isFollowedByFocusUser).toBe(true);
    expect(aliceDetail.isFollowingFocusUser).toBe(true);
    const bobDetail = details.find((u) => u.id === "bob")!;
    expect(bobDetail.countFollowers).toBe(1);
    expect(bobDetail.countFollowees).toBe(1);
    expect(bobDetail.isFollowedByFocusUser).toBeUndefined();
    expect(bobDetail.isFollowingFocusUser).toBeUndefined();
    const carolDetail = details.find((u) => u.id === "carol")!;
    expect(carolDetail.countFollowers).toBe(1);
    expect(carolDetail.countFollowees).toBe(1);
    expect(carolDetail.isFollowedByFocusUser).toBe(false);
    expect(carolDetail.isFollowingFocusUser).toBe(false);
  });

  test("createUser", async () => {
    const user = await service.createUser({
      email: "dan@example.com",
      nickname: "Dan",
      password: "danpass",
      isAdmin: false,
      introduction: "introD",
      icon: null,
      aiModel: "gpt-4.1",
      aiPersonality: "D",
    });
    expect(user.email).toBe("dan@example.com");
    expect(pg.users.find((u) => u.email === "dan@example.com")).toBeDefined();
    expect(pg.passwords[user.id]).toBe(md5("danpass"));
  });

  test("updateUser", async () => {
    const user = await service.updateUser({
      id: "alice",
      email: "alice2@example.com",
      nickname: "Alice2",
      isAdmin: true,
      introduction: "introX",
      icon: null,
      aiModel: "gpt-4.1-mini",
      aiPersonality: "X",
    });
    expect(user?.email).toBe("alice2@example.com");
    expect(user?.isAdmin).toBe(true);
    expect(user?.introduction).toBe("introX");
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

  test("listFolloweesDetail (with focusUserId)", async () => {
    const res = await service.listFolloweesDetail({ followerId: "alice" }, "bob");
    expect(res.length).toBe(2);
    expect(res.some((u) => u.id === "bob")).toBe(true);
    expect(res.some((u) => u.id === "carol")).toBe(true);
    expect(res.every((u) => typeof u.countFollowers === "number")).toBe(true);
  });

  test("listFollowersDetail (with focusUserId)", async () => {
    const res = await service.listFollowersDetail({ followeeId: "alice" }, "bob");
    expect(res.length).toBe(2);
    expect(res.some((u) => u.id === "bob")).toBe(true);
    expect(res.some((u) => u.id === "carol")).toBe(true);
    expect(res.every((u) => typeof u.countFollowers === "number")).toBe(true);
  });

  test("addFollower/removeFollower", async () => {
    await service.addFollower({ followerId: "bob", followeeId: "carol" });
    expect(pg.follows.some((f) => f.followerId === "bob" && f.followeeId === "carol")).toBe(true);
    await service.removeFollower({ followerId: "bob", followeeId: "carol" });
    expect(pg.follows.some((f) => f.followerId === "bob" && f.followeeId === "carol")).toBe(false);
  });
});
