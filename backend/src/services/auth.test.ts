import { AuthService } from "./auth";
import { decToHex, hexToDec } from "../utils/format";

jest.mock("../utils/servers", () => ({
  pgQuery: jest.fn(async (pool: any, text: string, params?: any[]) => pool.query(text, params)),
}));

jest.mock("../utils/format", () => {
  const actual = jest.requireActual("../utils/format") as Record<string, unknown>;
  return Object.assign({}, actual, {
    checkPasswordHash: jest.fn(async (_password: string, _stored: unknown) => true),
  });
});

class MockPgClient {
  query: jest.Mock<Promise<any>, any[]> = jest.fn();
}

class MockRedis {
  store: { [key: string]: string } = {};

  set: jest.Mock<Promise<string>, any[]> = jest.fn((key: string, value: string) => {
    this.store[key] = value;
    return Promise.resolve("OK");
  });

  get: jest.Mock<Promise<string | undefined>, any[]> = jest.fn((key: string) =>
    Promise.resolve(this.store[key]),
  );

  getex: jest.Mock<Promise<string | undefined>, any[]> = jest.fn((key: string, ..._args: any[]) =>
    Promise.resolve(this.store[key]),
  );

  del: jest.Mock<Promise<number>, any[]> = jest.fn((key: string) => {
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
    const dbIdDec = "1234567890123456";
    const userIdHex = decToHex(dbIdDec);
    (pgClient.query as jest.Mock).mockResolvedValueOnce({
      rows: [
        {
          id: dbIdDec,
          email: "test@example.com",
          nickname: "TestNick",
          is_admin: true,
          created_at: "2025-07-20T00:00:00Z",
          updated_at: null,
          password: new Uint8Array([1, 2, 3]),
        },
      ],
      rowCount: 1,
    });
    const result = await authService.login("test@example.com", "password");
    expect(result.userId).toBe(userIdHex);
    expect(redis.set).toHaveBeenCalled();
    const sessionId = result.sessionId;
    const session = JSON.parse(redis.store[`session:${sessionId}`]);
    expect(session.userId).toBe(userIdHex);
    expect(session.userEmail).toBe("test@example.com");
    expect(session.userNickname).toBe("TestNick");
    expect(session.userIsAdmin).toBe(true);
    expect(session.userCreatedAt).toBe("2025-07-20T00:00:00.000Z");
    expect(session.userUpdatedAt).toBe(null);
    expect(session.loggedInAt).toBeDefined();
  });

  test("login: fail", async () => {
    (pgClient.query as jest.Mock).mockResolvedValueOnce({ rows: [], rowCount: 0 });
    await expect(authService.login("bad@example.com", "bad")).rejects.toThrow(
      "authentication failed",
    );
  });

  test("switchUser: success", async () => {
    const dbIdDec = "9876543210000000";
    const userHex = decToHex(dbIdDec);
    (pgClient.query as jest.Mock).mockResolvedValueOnce({
      rows: [
        {
          id: dbIdDec,
          email: "switch@example.com",
          nickname: "Switcher",
          is_admin: false,
          created_at: "2025-07-01T02:03:04Z",
          updated_at: "2025-07-21T01:02:03Z",
        },
      ],
      rowCount: 1,
    });
    const result = await authService.switchUser(userHex);
    expect(result.userId).toBe(userHex);
    expect(result.sessionId).toBeDefined();
    expect(redis.set).toHaveBeenCalled();
    const stored = JSON.parse(redis.store[`session:${result.sessionId}`]);
    expect(stored.userId).toBe(userHex);
    expect(stored.userEmail).toBe("switch@example.com");
    expect(stored.userNickname).toBe("Switcher");
    expect(stored.userIsAdmin).toBe(false);
    expect(stored.userCreatedAt).toBe("2025-07-01T02:03:04.000Z");
    expect(stored.userUpdatedAt).toBe("2025-07-21T01:02:03.000Z");
    expect(stored.loggedInAt).toBeDefined();
  });

  test("switchUser: user not found", async () => {
    const userHex = decToHex("42");
    (pgClient.query as jest.Mock).mockResolvedValueOnce({ rows: [], rowCount: 0 });
    await expect(authService.switchUser(userHex)).rejects.toThrow("user not found");
  });

  test("getSessionInfo: exists", async () => {
    const sessionId = "abc123";
    const value = JSON.stringify({
      userId: decToHex("1"),
      userEmail: "e@example.com",
      userNickname: "TestNick",
      userIsAdmin: true,
      userCreatedAt: "2025-07-01T00:00:00Z",
      userUpdatedAt: "2025-07-12T00:00:00Z",
      loggedInAt: "2025-07-13T00:00:00Z",
    });
    redis.store[`session:${sessionId}`] = value;
    const session = await authService.getSessionInfo(sessionId);
    expect(session?.userId).toBe(decToHex("1"));
    expect(session?.userEmail).toBe("e@example.com");
    expect(session?.userNickname).toBe("TestNick");
    expect(session?.userIsAdmin).toBe(true);
    expect(session?.userCreatedAt).toBe("2025-07-01T00:00:00Z");
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
    const dbIdDec = "1001";
    const userHex = decToHex(dbIdDec);
    const sessionId = "sess-1";
    const original = {
      userId: userHex,
      userEmail: "old@example.com",
      userNickname: "OldNick",
      userIsAdmin: false,
      userCreatedAt: "2025-07-04T00:00:00Z",
      userUpdatedAt: "2025-07-10T00:00:00Z",
      loggedInAt: "2025-07-13T00:00:00Z",
    };
    redis.store[`session:${sessionId}`] = JSON.stringify(original);

    (pgClient.query as jest.Mock).mockResolvedValueOnce({
      rows: [
        {
          email: "new@example.com",
          nickname: "NewNick",
          is_admin: true,
          created_at: "2025-07-05T08:09:10Z",
          updated_at: "2025-07-20T10:20:30Z",
        },
      ],
      rowCount: 1,
    });

    const refreshed = await authService.refreshSessionInfo(sessionId);
    expect(refreshed).not.toBeNull();

    const [sqlText, sqlParams] = (pgClient.query as jest.Mock).mock.calls[0];
    const normalized = String(sqlText).replace(/\s+/g, " ").trim();
    expect(normalized).toBe(
      "SELECT email, nickname, is_admin, id_to_timestamp(id) AS created_at, updated_at FROM users WHERE id=$1",
    );
    expect(sqlParams).toEqual([hexToDec(userHex)]);

    const stored = JSON.parse(redis.store[`session:${sessionId}`]);
    expect(stored.userId).toBe(userHex);
    expect(stored.userEmail).toBe("new@example.com");
    expect(stored.userNickname).toBe("NewNick");
    expect(stored.userIsAdmin).toBe(true);
    expect(stored.userCreatedAt).toBe("2025-07-05T08:09:10.000Z");
    expect(stored.userUpdatedAt).toBe("2025-07-20T10:20:30.000Z");
    expect(stored.loggedInAt).toBe(original.loggedInAt);
  });

  test("refreshSessionInfo: returns null when session not found", async () => {
    const out = await authService.refreshSessionInfo("no-such-session");
    expect(out).toBeNull();
    expect(pgClient.query).not.toHaveBeenCalled();
  });

  test("refreshSessionInfo: returns null when user not found in DB", async () => {
    const dbIdDec = "2002";
    const userHex = decToHex(dbIdDec);
    const sessionId = "sess-2";
    const original = {
      userId: userHex,
      userEmail: "x@example.com",
      userNickname: "X",
      userIsAdmin: false,
      userCreatedAt: "2025-07-01T00:00:00Z",
      userUpdatedAt: null,
      loggedInAt: "2025-07-13T00:00:00Z",
    };
    redis.store[`session:${sessionId}`] = JSON.stringify(original);

    (pgClient.query as jest.Mock).mockResolvedValueOnce({ rows: [], rowCount: 0 });

    const out = await authService.refreshSessionInfo(sessionId);
    expect(out).toBeNull();

    const stored = JSON.parse(redis.store[`session:${sessionId}`]);
    expect(stored.userEmail).toBe("x@example.com");
    expect(stored.userNickname).toBe("X");
  });
});
