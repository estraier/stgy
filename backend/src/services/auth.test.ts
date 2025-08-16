// src/services/auth.test.ts
import { AuthService } from "./auth";

class MockPgClient {
  query = jest.fn();
}
class MockRedis {
  store: { [key: string]: string } = {};
  set = jest.fn((key: string, value: string) => {
    this.store[key] = value;
    return Promise.resolve("OK");
  });
  get = jest.fn((key: string) => Promise.resolve(this.store[key]));
  getex = jest.fn((key: string, ..._args: any[]) => Promise.resolve(this.store[key]));
  del = jest.fn((key: string) => {
    delete this.store[key];
    return Promise.resolve(1);
  });
}

describe("AuthService class", () => {
  let pgClient: MockPgClient;
  let redis: MockRedis;
  let authService: AuthService;

  beforeEach(() => {
    pgClient = new MockPgClient();
    redis = new MockRedis();
    authService = new AuthService(pgClient as any, redis as any);
  });

  test("login: success", async () => {
    pgClient.query.mockResolvedValueOnce({
      rows: [
        {
          id: "user-123",
          email: "test@example.com",
          nickname: "TestNick",
          is_admin: true,
          updated_at: null,
        },
      ],
      rowCount: 1,
    });
    const result = await authService.login("test@example.com", "password");
    expect(result.userId).toBe("user-123");
    expect(redis.set).toHaveBeenCalled();
    const sessionId = result.sessionId;
    const session = JSON.parse(redis.store[`session:${sessionId}`]);
    expect(session.userId).toBe("user-123");
    expect(session.userEmail).toBe("test@example.com");
    expect(session.userNickname).toBe("TestNick");
    expect(session.userIsAdmin).toBe(true);
    expect(session.userUpdatedAt).toBe(null);
    expect(session.loggedInAt).toBeDefined();
  });

  test("login: fail", async () => {
    pgClient.query.mockResolvedValueOnce({ rows: [], rowCount: 0 });
    await expect(authService.login("bad@example.com", "bad")).rejects.toThrow(
      "authentication failed",
    );
  });

  test("getSessionInfo: exists", async () => {
    const sessionId = "abc123";
    const value = JSON.stringify({
      userId: "u1",
      userEmail: "e@example.com",
      userNickname: "TestNick",
      userIsAdmin: true,
      userUpdatedAt: "2025-07-12T00:00:00Z",
      loggedInAt: "2025-07-13T00:00:00Z",
    });
    redis.store[`session:${sessionId}`] = value;
    const session = await authService.getSessionInfo(sessionId);
    expect(session?.userId).toBe("u1");
    expect(session?.userEmail).toBe("e@example.com");
    expect(session?.userNickname).toBe("TestNick");
    expect(session?.userIsAdmin).toBe(true);
    expect(session?.userUpdatedAt).toBe("2025-07-12T00:00:00Z");
    expect(session?.loggedInAt).toBe("2025-07-13T00:00:00Z");
  });

  test("getSessionInfo: not exists", async () => {
    const session = await authService.getSessionInfo("notfound");
    expect(session).toBeNull();
  });

  test("logout", async () => {
    const sessionId = "toDel";
    redis.store[`session:${sessionId}`] = '{"userId":"xx"}';
    await authService.logout(sessionId);
    expect(redis.store[`session:${sessionId}`]).toBeUndefined();
  });

  test("refreshSessionInfo: updates fields and preserves loggedInAt", async () => {
    const sessionId = "sess-1";
    const original = {
      userId: "u1",
      userEmail: "old@example.com",
      userNickname: "OldNick",
      userIsAdmin: false,
      userUpdatedAt: "2025-07-10T00:00:00Z",
      loggedInAt: "2025-07-13T00:00:00Z",
    };
    redis.store[`session:${sessionId}`] = JSON.stringify(original);

    pgClient.query.mockResolvedValueOnce({
      rows: [
        {
          email: "new@example.com",
          nickname: "NewNick",
          is_admin: true,
          updated_at: "2025-07-20T10:20:30Z",
        },
      ],
      rowCount: 1,
    });

    const refreshed = await authService.refreshSessionInfo(sessionId);
    expect(refreshed).not.toBeNull();
    expect(pgClient.query).toHaveBeenCalledWith(
      "SELECT email, nickname, is_admin, updated_at FROM users WHERE id=$1",
      ["u1"],
    );

    const stored = JSON.parse(redis.store[`session:${sessionId}`]);
    expect(stored.userId).toBe("u1");
    expect(stored.userEmail).toBe("new@example.com");
    expect(stored.userNickname).toBe("NewNick");
    expect(stored.userIsAdmin).toBe(true);
    expect(stored.userUpdatedAt).toBe("2025-07-20T10:20:30.000Z");
    expect(stored.loggedInAt).toBe(original.loggedInAt);
  });

  test("refreshSessionInfo: returns null when session not found", async () => {
    const out = await authService.refreshSessionInfo("no-such-session");
    expect(out).toBeNull();
    expect(pgClient.query).not.toHaveBeenCalled();
  });

  test("refreshSessionInfo: returns null when user not found in DB", async () => {
    const sessionId = "sess-2";
    const original = {
      userId: "u2",
      userEmail: "x@example.com",
      userNickname: "X",
      userIsAdmin: false,
      userUpdatedAt: null,
      loggedInAt: "2025-07-13T00:00:00Z",
    };
    redis.store[`session:${sessionId}`] = JSON.stringify(original);

    pgClient.query.mockResolvedValueOnce({ rows: [], rowCount: 0 });

    const out = await authService.refreshSessionInfo(sessionId);
    expect(out).toBeNull();

    const stored = JSON.parse(redis.store[`session:${sessionId}`]);
    expect(stored.userEmail).toBe("x@example.com");
    expect(stored.userNickname).toBe("X");
  });
});
