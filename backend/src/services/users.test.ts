import { v4 as uuidv4 } from "uuid";
import { UsersService } from "./users";
import {
  User,
  CreateUserInput,
  UpdateUserInput,
  UpdatePasswordInput,
  AddFollowerInput,
  RemoveFollowerInput,
} from "../models/user";

type UserWithPassword = User & { password: string };

function omitKey<T extends object, K extends keyof T>(obj: T, key: K): Omit<T, K> {
  const result = { ...obj };
  delete result[key];
  return result;
}

class MockPgClient {
  data: UserWithPassword[] = [];
  follows: { follower_id: string; followee_id: string }[] = [];

  query(sql: string, params?: unknown[]) {
    if (sql.startsWith("SELECT COUNT(*) FROM users")) {
      return { rows: [{ count: this.data.length.toString() }] };
    }
    if (sql.includes("FROM users") && sql.includes("ORDER BY created_at")) {
      let filtered = this.data;
      if (sql.includes("WHERE nickname ILIKE") || sql.includes("WHERE (nickname ILIKE")) {
        const nicknameQ = (params?.[0] ?? "").toString().toLowerCase().replace(/%/g, "");
        const introQ = (params?.[1] ?? "").toString().toLowerCase().replace(/%/g, "");
        filtered = filtered.filter(
          (u) =>
            (nicknameQ && u.nickname.toLowerCase().includes(nicknameQ)) ||
            (introQ && u.introduction.toLowerCase().includes(introQ)),
        );
        const offset = (params?.[2] as number) ?? 0;
        const limit = (params?.[3] as number) ?? 100;
        const users = filtered.slice(offset, offset + limit).map((u) => omitKey(u, "password"));
        return { rows: users };
      } else {
        const offset = (params?.[0] as number) ?? 0;
        const limit = (params?.[1] as number) ?? 100;
        const users = filtered.slice(offset, offset + limit).map((u) => omitKey(u, "password"));
        return { rows: users };
      }
    }
    if (
      sql.startsWith(
        "SELECT id, email, nickname, is_admin, introduction, personality, model, created_at FROM users WHERE id =",
      )
    ) {
      const id = params![0];
      const user = this.data.find((u) => u.id === id);
      if (!user) return { rows: [] };
      return { rows: [omitKey(user, "password")] };
    }
    if (sql.startsWith("INSERT INTO users")) {
      const newUser: UserWithPassword = {
        ...paramsToUser(params!),
        id: params![0] as string,
        created_at: new Date().toISOString(),
      };
      this.data.push(newUser);
      return { rows: [omitKey(newUser, "password")] };
    }
    if (sql.startsWith("UPDATE users SET")) {
      if (sql.startsWith("UPDATE users SET password =")) {
        const passwordHash = params![0] as string;
        const id = params![1] as string;
        const user = this.data.find((u) => u.id === id);
        if (!user) return { rowCount: 0 };
        user.password = passwordHash;
        return { rowCount: 1 };
      }
      const id = params![params!.length - 1] as string;
      const user = this.data.find((u) => u.id === id);
      if (!user) return { rows: [] };
      const columns = sql
        .match(/SET (.+) WHERE/)![1]
        .split(",")
        .map((s) => s.trim());
      let idx = 0;
      for (const col of columns) {
        const key = col.split(" =")[0] as keyof User;
        (user as any)[key] = params![idx++];
      }
      return { rows: [omitKey(user, "password")] };
    }
    if (sql.startsWith("DELETE FROM users")) {
      const id = params![0];
      const idx = this.data.findIndex((u) => u.id === id);
      if (idx >= 0) {
        this.data.splice(idx, 1);
        return { rowCount: 1 };
      }
      return { rowCount: 0 };
    }
    if (
      sql.includes("FROM user_follows f") &&
      sql.includes("JOIN users u ON f.followee_id = u.id")
    ) {
      const follower_id = params![0];
      const offset = (params![1] as number) ?? 0;
      const limit = (params![2] as number) ?? 100;
      const ids = this.follows
        .filter((f) => f.follower_id === follower_id)
        .map((f) => f.followee_id);
      const users = this.data
        .filter((u) => ids.includes(u.id))
        .slice(offset, offset + limit)
        .map((u) => omitKey(u, "password"));
      return { rows: users };
    }
    if (
      sql.includes("FROM user_follows f") &&
      sql.includes("JOIN users u ON f.follower_id = u.id")
    ) {
      const followee_id = params![0];
      const offset = (params![1] as number) ?? 0;
      const limit = (params![2] as number) ?? 100;
      const ids = this.follows
        .filter((f) => f.followee_id === followee_id)
        .map((f) => f.follower_id);
      const users = this.data
        .filter((u) => ids.includes(u.id))
        .slice(offset, offset + limit)
        .map((u) => omitKey(u, "password"));
      return { rows: users };
    }
    if (sql.startsWith("INSERT INTO user_follows")) {
      const follower_id = params![0] as string;
      const followee_id = params![1] as string;
      if (
        !this.follows.some((f) => f.follower_id === follower_id && f.followee_id === followee_id)
      ) {
        this.follows.push({ follower_id, followee_id });
        return { rowCount: 1 };
      } else {
        return { rowCount: 0 };
      }
    }
    if (sql.startsWith("DELETE FROM user_follows")) {
      const follower_id = params![0] as string;
      const followee_id = params![1] as string;
      const idx = this.follows.findIndex(
        (f) => f.follower_id === follower_id && f.followee_id === followee_id,
      );
      if (idx >= 0) {
        this.follows.splice(idx, 1);
        return { rowCount: 1 };
      } else {
        return { rowCount: 0 };
      }
    }
    return { rows: [] };
  }
}

function paramsToUser(params: unknown[]): Omit<UserWithPassword, "id" | "created_at"> {
  return {
    email: params[1] as string,
    nickname: params[2] as string,
    password: params[3] as string,
    is_admin: params[4] as boolean,
    introduction: params[5] as string,
    personality: params[6] as string,
    model: params[7] as string,
  };
}

describe("users service", () => {
  let pgClient: MockPgClient;
  let usersService: UsersService;
  let userSample: UserWithPassword;
  let user2: UserWithPassword;

  beforeEach(() => {
    pgClient = new MockPgClient();
    usersService = new UsersService(pgClient as any);
    userSample = {
      id: uuidv4(),
      email: "foo@example.com",
      nickname: "foo",
      password: "hashedpw",
      is_admin: false,
      introduction: "test",
      personality: "",
      model: "",
      created_at: new Date().toISOString(),
    };
    user2 = {
      id: uuidv4(),
      email: "bar@example.com",
      nickname: "bar",
      password: "pw2",
      is_admin: false,
      introduction: "bar",
      personality: "",
      model: "",
      created_at: new Date().toISOString(),
    };
    pgClient.data.push({ ...userSample });
    pgClient.data.push({ ...user2 });
    pgClient.follows = [];
  });

  test("countUsers", async () => {
    for (let i = 0; i < 4; ++i) {
      const u = { ...userSample, id: uuidv4(), email: `u${i}@a.com` };
      pgClient.data.push(u);
    }
    const count = await usersService.countUsers();
    expect(count).toBe(pgClient.data.length);
  });

  test("getUser", async () => {
    const user = await usersService.getUser(userSample.id);
    expect(user).not.toBeNull();
    expect(user!.email).toBe(userSample.email);
    expect((user as any).password).toBeUndefined();
  });

  test("getUser: not found", async () => {
    const user = await usersService.getUser("no-such-id");
    expect(user).toBeNull();
  });

  test("listUsers: no options", async () => {
    const users = await usersService.listUsers();
    expect(Array.isArray(users)).toBe(true);
    expect(users.length).toBe(2);
    expect(users[0].email).toBe(userSample.email);
    expect((users[0] as any).password).toBeUndefined();
  });

  test("listUsers: offset/limit", async () => {
    for (let i = 0; i < 5; ++i) {
      const u = { ...userSample, id: uuidv4(), email: `user${i}@ex.com` };
      pgClient.data.push(u);
    }
    const users1 = await usersService.listUsers({ offset: 2, limit: 2 });
    expect(users1.length).toBe(2);
    expect(users1[0].email).toBe(pgClient.data[2].email);
    const users2 = await usersService.listUsers({ offset: 5, limit: 10 });
    expect(users2.length).toBe(2);
    expect(users2[0].email).toBe(pgClient.data[5].email);
  });

  test("createUser", async () => {
    const input: CreateUserInput = {
      email: "bar@example.com",
      nickname: "bar",
      password: "barpw",
      is_admin: true,
      introduction: "bar",
      personality: "",
      model: "chatgpt:gpt-4.1-nano",
    };
    const user = await usersService.createUser(input);
    expect(user.email).toBe("bar@example.com");
    expect(user.is_admin).toBe(true);
    expect(pgClient.data.length).toBe(3);
    expect((user as any).password).toBeUndefined();
  });

  test("updateUser", async () => {
    const input: UpdateUserInput = {
      id: userSample.id,
      email: "new@example.com",
      nickname: "newnick",
      is_admin: true,
    };
    const user = await usersService.updateUser(input);
    expect(user).not.toBeNull();
    expect(user!.email).toBe("new@example.com");
    expect(user!.nickname).toBe("newnick");
    expect(user!.is_admin).toBe(true);
    expect((user as any).password).toBeUndefined();
  });

  test("updateUserPassword", async () => {
    const input: UpdatePasswordInput = {
      id: userSample.id,
      password: "newpw",
    };
    const ok = await usersService.updateUserPassword(input);
    expect(ok).toBe(true);
    const updated = pgClient.data.find((u) => u.id === userSample.id)!;
    expect(updated.password).not.toBe("hashedpw");
  });

  test("deleteUser", async () => {
    const ok = await usersService.deleteUser(userSample.id);
    expect(ok).toBe(true);
    expect(pgClient.data.length).toBe(1);
    const ng = await usersService.deleteUser("no-such-id");
    expect(ng).toBe(false);
  });

  test("listFollowees", async () => {
    pgClient.follows.push({ follower_id: userSample.id, followee_id: user2.id });
    const users = await usersService.listFollowees({ follower_id: userSample.id });
    expect(users.length).toBe(1);
    expect(users[0].id).toBe(user2.id);
  });

  test("listFollowers", async () => {
    pgClient.follows.push({ follower_id: userSample.id, followee_id: user2.id });
    const users = await usersService.listFollowers({ followee_id: user2.id });
    expect(users.length).toBe(1);
    expect(users[0].id).toBe(userSample.id);
  });

  test("addFollower: should add a follower relationship", async () => {
    const input: AddFollowerInput = { follower_id: userSample.id, followee_id: user2.id };
    const ok = await usersService.addFollower(input);
    expect(ok).toBe(true);
    expect(
      pgClient.follows.some((f) => f.follower_id === userSample.id && f.followee_id === user2.id),
    ).toBe(true);
  });

  test("addFollower: should not duplicate relationship", async () => {
    const input: AddFollowerInput = { follower_id: userSample.id, followee_id: user2.id };
    await usersService.addFollower(input);
    await usersService.addFollower(input);
    const found = pgClient.follows.filter(
      (f) => f.follower_id === userSample.id && f.followee_id === user2.id,
    );
    expect(found.length).toBe(1);
  });

  test("removeFollower: should remove follower relationship", async () => {
    const input: AddFollowerInput = { follower_id: userSample.id, followee_id: user2.id };
    await usersService.addFollower(input);
    const rmInput: RemoveFollowerInput = { follower_id: userSample.id, followee_id: user2.id };
    const ok = await usersService.removeFollower(rmInput);
    expect(ok).toBe(true);
    expect(
      pgClient.follows.some((f) => f.follower_id === userSample.id && f.followee_id === user2.id),
    ).toBe(false);
  });

  test("removeFollower: returns false if relationship does not exist", async () => {
    const input: RemoveFollowerInput = { follower_id: userSample.id, followee_id: user2.id };
    const ok = await usersService.removeFollower(input);
    expect(ok).toBe(false);
  });
});
