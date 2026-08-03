import { AuthService } from "./auth";
import { decToHex, hexToDec } from "../utils/format";
import { Config } from "../config";

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
  mget: jest.Mock<Promise<Array<string | null>>, any[]> = jest.fn((...keys: string[]) =>
    Promise.resolve(keys.map((key) => this.store[key] ?? null)),
  );
  scan: jest.Mock<Promise<[string, string[]]>, any[]> = jest.fn(
    (_cursor: string, ..._args: any[]) => Promise.resolve(["0", Object.keys(this.store)]),
  );
  del: jest.Mock<Promise<number>, any[]> = jest.fn((...keys: string[]) => {
    let count = 0;
    for (const key of keys) {
      if (key in this.store) {
        delete this.store[key];
        count += 1;
      }
    }
    return Promise.resolve(count);
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
    const latestTermDec = "2234567890123456";
    const userIdHex = decToHex(dbIdDec);
    const latestTermHex = decToHex(latestTermDec);
    (pgClient.query as jest.Mock).mockResolvedValueOnce({
      rows: [
        {
          id: dbIdDec,
          email: "test@example.com",
          nickname: "TestNick",
          is_admin: true,
          is_frozen: false,
          ai_model: null,
          created_at: "2025-07-20T00:00:00Z",
          updated_at: null,
          password: new Uint8Array([1, 2, 3]),
          locale: "ja-JP",
          timezone: "Asia/Tokyo",
          user_agreement_term_id: null,
          latest_agreement_term_id: latestTermDec,
        },
      ],
      rowCount: 1,
    });
    const result = await authService.login("test@example.com", "password");
    expect(result.userId).toBe(userIdHex);
    expect(redis.set).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(String),
      "EX",
      Config.SESSION_TTL,
    );
    const sessionId = result.sessionId;
    const session = JSON.parse(redis.store[`session:${sessionId}`]);
    expect(session.userId).toBe(userIdHex);
    expect(session.userEmail).toBe("test@example.com");
    expect(session.userNickname).toBe("TestNick");
    expect(session.userIsAdmin).toBe(true);
    expect(session.userIsFrozen).toBe(false);
    expect(session.userCreatedAt).toBe("2025-07-20T00:00:00.000Z");
    expect(session.userUpdatedAt).toBe(null);
    expect(session.userLocale).toBe("ja-JP");
    expect(session.userTimezone).toBe("Asia/Tokyo");
    expect(session.loggedInAt).toBeDefined();
    expect(session.requiredAgreementTermId).toBe(latestTermHex);
  });

  test("login: no agreement required when the latest terms are already accepted", async () => {
    const dbIdDec = "1234567890123456";
    const termIdDec = "2234567890123456";
    (pgClient.query as jest.Mock).mockResolvedValueOnce({
      rows: [
        {
          id: dbIdDec,
          email: "test@example.com",
          nickname: "TestNick",
          is_admin: false,
          is_frozen: true,
          ai_model: "basic",
          created_at: "2025-07-20T00:00:00Z",
          updated_at: null,
          password: new Uint8Array([1, 2, 3]),
          locale: "ja-JP",
          timezone: "Asia/Tokyo",
          user_agreement_term_id: termIdDec,
          latest_agreement_term_id: termIdDec,
        },
      ],
      rowCount: 1,
    });
    const result = await authService.login("test@example.com", "password");
    const session = JSON.parse(redis.store[`session:${result.sessionId}`]);
    expect(session.requiredAgreementTermId).toBeNull();
  });

  test("login: fail", async () => {
    (pgClient.query as jest.Mock).mockResolvedValueOnce({ rows: [], rowCount: 0 });
    await expect(authService.login("bad@example.com", "bad")).rejects.toThrow(
      "authentication failed",
    );
  });

  test("loginAsAdmin: success", async () => {
    const dbIdDec = "1";
    const adminHex = decToHex(dbIdDec);
    (pgClient.query as jest.Mock).mockResolvedValueOnce({
      rows: [
        {
          id: dbIdDec,
          email: "admin@example.com",
          nickname: "admin",
          is_admin: true,
          is_frozen: false,
          ai_model: null,
          created_at: "2025-07-01T02:03:04Z",
          updated_at: null,
          locale: "ja-JP",
          timezone: "Asia/Tokyo",
          user_agreement_term_id: null,
          latest_agreement_term_id: null,
        },
      ],
      rowCount: 1,
    });
    const result = await authService.loginAsAdmin();
    expect(result.userId).toBe(adminHex);
    expect(result.sessionId).toBeDefined();
    const [sqlText, sqlParams] = (pgClient.query as jest.Mock).mock.calls[0];
    const normalized = String(sqlText).replace(/\s+/g, " ").trim();
    expect(normalized).toBe(
      "SELECT u.id, s.email, u.nickname, u.is_admin, u.is_frozen, id_to_timestamp(u.id) AS created_at, u.updated_at, u.locale, u.timezone, s.user_agreement_term_id, ( SELECT id FROM user_agreement_terms ORDER BY id DESC LIMIT 1 ) AS latest_agreement_term_id FROM users u JOIN user_secrets s ON s.user_id = u.id ORDER BY u.id ASC LIMIT 1",
    );
    expect(sqlParams).toEqual([]);
    expect(redis.set).toHaveBeenCalled();
    const stored = JSON.parse(redis.store[`session:${result.sessionId}`]);
    expect(stored.userId).toBe(adminHex);
    expect(stored.userEmail).toBe("admin@example.com");
    expect(stored.userNickname).toBe("admin");
    expect(stored.userIsAdmin).toBe(true);
    expect(stored.userIsFrozen).toBe(false);
    expect(stored.userCreatedAt).toBe("2025-07-01T02:03:04.000Z");
    expect(stored.userUpdatedAt).toBe(null);
    expect(stored.userLocale).toBe("ja-JP");
    expect(stored.userTimezone).toBe("Asia/Tokyo");
    expect(stored.loggedInAt).toBeDefined();
    expect(stored.requiredAgreementTermId).toBeNull();
  });

  test("loginAsAdmin: admin not found", async () => {
    (pgClient.query as jest.Mock).mockResolvedValueOnce({ rows: [], rowCount: 0 });
    await expect(authService.loginAsAdmin()).rejects.toThrow("admin not found");
  });

  test("loginAsAdmin: first user is not admin", async () => {
    (pgClient.query as jest.Mock).mockResolvedValueOnce({
      rows: [
        {
          id: "1",
          email: "user@example.com",
          nickname: "user",
          is_admin: false,
          is_frozen: true,
          ai_model: "basic",
          created_at: "2025-07-01T02:03:04Z",
          updated_at: null,
          locale: "ja-JP",
          timezone: "Asia/Tokyo",
          user_agreement_term_id: null,
          latest_agreement_term_id: null,
        },
      ],
      rowCount: 1,
    });
    await expect(authService.loginAsAdmin()).rejects.toThrow("first user is not admin");
    expect(redis.set).not.toHaveBeenCalled();
  });

  test("switchUser: success", async () => {
    const dbIdDec = "9876543210000000";
    const acceptedTermDec = "100";
    const latestTermDec = "200";
    const userHex = decToHex(dbIdDec);
    const latestTermHex = decToHex(latestTermDec);
    (pgClient.query as jest.Mock).mockResolvedValueOnce({
      rows: [
        {
          id: dbIdDec,
          email: "switch@example.com",
          nickname: "Switcher",
          is_admin: false,
          is_frozen: true,
          ai_model: "basic",
          created_at: "2025-07-01T02:03:04Z",
          updated_at: "2025-07-21T01:02:03Z",
          locale: "en-US",
          timezone: "America/Los_Angeles",
          user_agreement_term_id: acceptedTermDec,
          latest_agreement_term_id: latestTermDec,
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
    expect(stored.userIsFrozen).toBe(true);
    expect(stored.userCreatedAt).toBe("2025-07-01T02:03:04.000Z");
    expect(stored.userUpdatedAt).toBe("2025-07-21T01:02:03.000Z");
    expect(stored.userLocale).toBe("en-US");
    expect(stored.userTimezone).toBe("America/Los_Angeles");
    expect(stored.loggedInAt).toBeDefined();
    expect(stored.requiredAgreementTermId).toBe(latestTermHex);
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
    expect(session?.userIsFrozen).toBe(false);
    expect(session?.userCreatedAt).toBe("2025-07-01T00:00:00Z");
    expect(session?.userUpdatedAt).toBe("2025-07-12T00:00:00Z");
    expect(session?.loggedInAt).toBe("2025-07-13T00:00:00Z");
    expect(session?.requiredAgreementTermId).toBeNull();
  });

  test("getSessionInfo: not exists", async () => {
    const session = await authService.getSessionInfo("notfound");
    expect(session).toBeNull();
  });

  test("deleteUserSessions removes only sessions for the target user", async () => {
    const target = decToHex("10");
    const other = decToHex("20");
    redis.store["session:a"] = JSON.stringify({ userId: target });
    redis.store["session:b"] = JSON.stringify({ userId: other });
    redis.store["session:c"] = JSON.stringify({ userId: target });
    redis.store["other:key"] = "value";

    await expect(authService.deleteUserSessions(target)).resolves.toBe(2);
    expect(redis.store["session:a"]).toBeUndefined();
    expect(redis.store["session:c"]).toBeUndefined();
    expect(redis.store["session:b"]).toBeDefined();
    expect(redis.store["other:key"]).toBe("value");
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
      requiredAgreementTermId: decToHex("3003"),
    };
    redis.store[`session:${sessionId}`] = JSON.stringify(original);
    (pgClient.query as jest.Mock).mockResolvedValueOnce({
      rows: [
        {
          email: "new@example.com",
          nickname: "NewNick",
          is_admin: true,
          is_frozen: false,
          ai_model: null,
          created_at: "2025-07-05T08:09:10Z",
          updated_at: "2025-07-20T10:20:30Z",
          locale: "en-GB",
          timezone: "Europe/London",
        },
      ],
      rowCount: 1,
    });
    const refreshed = await authService.refreshSessionInfo(sessionId);
    expect(refreshed).not.toBeNull();
    const [sqlText, sqlParams] = (pgClient.query as jest.Mock).mock.calls[0];
    const normalized = String(sqlText).replace(/\s+/g, " ").trim();
    expect(normalized).toBe(
      "SELECT s.email, u.nickname, u.is_admin, u.is_frozen, id_to_timestamp(u.id) AS created_at, u.updated_at, u.locale, u.timezone FROM users u JOIN user_secrets s ON s.user_id = u.id WHERE u.id = $1",
    );
    expect(sqlParams).toEqual([hexToDec(userHex)]);
    const stored = JSON.parse(redis.store[`session:${sessionId}`]);
    expect(stored.userId).toBe(userHex);
    expect(stored.userEmail).toBe("new@example.com");
    expect(stored.userNickname).toBe("NewNick");
    expect(stored.userIsAdmin).toBe(true);
    expect(stored.userIsFrozen).toBe(false);
    expect(stored.userCreatedAt).toBe("2025-07-05T08:09:10.000Z");
    expect(stored.userUpdatedAt).toBe("2025-07-20T10:20:30.000Z");
    expect(stored.userLocale).toBe("en-GB");
    expect(stored.userTimezone).toBe("Europe/London");
    expect(stored.loggedInAt).toBe(original.loggedInAt);
    expect(stored.requiredAgreementTermId).toBe(original.requiredAgreementTermId);
  });

  test("clearRequiredAgreementTermId: clears only the current session value", async () => {
    const sessionId = "agreement-session";
    redis.store[`session:${sessionId}`] = JSON.stringify({
      userId: decToHex("1"),
      userEmail: "e@example.com",
      userNickname: "TestNick",
      userIsAdmin: false,
      userCreatedAt: "2025-07-01T00:00:00Z",
      userUpdatedAt: null,
      userLocale: "en",
      userTimezone: "UTC",
      loggedInAt: "2025-07-13T00:00:00Z",
      requiredAgreementTermId: decToHex("4004"),
    });
    const updated = await authService.clearRequiredAgreementTermId(sessionId);
    expect(updated?.requiredAgreementTermId).toBeNull();
    const stored = JSON.parse(redis.store[`session:${sessionId}`]);
    expect(stored.requiredAgreementTermId).toBeNull();
    expect(stored.userEmail).toBe("e@example.com");
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
