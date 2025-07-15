import { login, getSessionInfo, logout } from "./auth";

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
  del = jest.fn((key: string) => {
    delete this.store[key];
    return Promise.resolve(1);
  });
}

describe("auth service", () => {
  let pgClient: MockPgClient;
  let redis: MockRedis;

  beforeEach(() => {
    pgClient = new MockPgClient();
    redis = new MockRedis();
  });

  test("login: success", async () => {
    pgClient.query.mockResolvedValueOnce({
      rows: [{ id: "user-123", email: "test@example.com" }],
      rowCount: 1,
    });
    const result = await login("test@example.com", "password", pgClient as any, redis as any);
    expect(result.userId).toBe("user-123");
    expect(redis.set).toHaveBeenCalled();
    const sessionId = result.sessionId;
    const session = JSON.parse(redis.store[`session:${sessionId}`]);
    expect(session.userId).toBe("user-123");
    expect(session.email).toBe("test@example.com");
    expect(session.loggedInAt).toBeDefined();
  });

  test("login: fail", async () => {
    pgClient.query.mockResolvedValueOnce({ rows: [], rowCount: 0 });
    await expect(login("bad@example.com", "bad", pgClient as any, redis as any)).rejects.toThrow(
      "authentication failed",
    );
  });

  test("getSessionInfo: exists", async () => {
    const sessionId = "abc123";
    const value = JSON.stringify({
      userId: "u1",
      email: "e@example.com",
      loggedInAt: "2025-07-13T00:00:00Z",
    });
    redis.store[`session:${sessionId}`] = value;
    const session = await getSessionInfo(sessionId, redis as any);
    expect(session?.userId).toBe("u1");
    expect(session?.email).toBe("e@example.com");
    expect(session?.loggedInAt).toBe("2025-07-13T00:00:00Z");
  });

  test("getSessionInfo: not exists", async () => {
    const session = await getSessionInfo("notfound", redis as any);
    expect(session).toBeNull();
  });

  test("logout", async () => {
    const sessionId = "toDel";
    redis.store[`session:${sessionId}`] = '{"userId":"xx"}';
    await logout(sessionId, redis as any);
    expect(redis.store[`session:${sessionId}`]).toBeUndefined();
  });
});
