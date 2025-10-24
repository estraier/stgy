import { SignupService } from "./signup";
import { UsersService } from "./users";

jest.mock("./users");
jest.mock("../utils/servers", () => ({
  pgQuery: jest.fn(async (pool: any, text: string, params?: any[]) => pool.query(text, params)),
}));

class MockPgClient {
  public emails: Set<string> = new Set();
  async query(sql: string, params: any[]) {
    const normalized = sql.replace(/\s+/g, " ").trim();
    if (
      normalized.includes("SELECT 1 FROM user_secrets WHERE email = $1") &&
      this.emails.has(params[0])
    )
      return { rows: [{}] };
    return { rows: [] };
  }
}

class MockRedis {
  private store = new Map<string, any>();
  private queue: string[] = [];
  async hmset(key: string, obj: any) {
    this.store.set(key, obj);
  }
  async hgetall(key: string) {
    return this.store.get(key) || {};
  }
  async expire(_key: string, _seconds: number) {}
  async lpush(_queue: string, val: string) {
    this.queue.push(val);
  }
  async del(key: string) {
    this.store.delete(key);
  }
}

describe("signup service", () => {
  let pgClient: MockPgClient;
  let redis: MockRedis;
  let usersService: UsersService;
  let signupService: SignupService;

  beforeEach(() => {
    pgClient = new MockPgClient();
    redis = new MockRedis();
    usersService = new UsersService(pgClient as any, redis as any);
    signupService = new SignupService(pgClient as any, redis as any, usersService);
    (usersService.createUser as unknown as jest.Mock).mockReset();
  });

  test("startSignup: valid input", async () => {
    const res = await signupService.startSignup("foo@example.com", "pass123", "en", "UTC");
    expect(res.signupId).toBeDefined();
    const signupKey = `signup:${res.signupId}`;
    const stored = await redis.hgetall(signupKey);
    expect(stored.email).toBe("foo@example.com");
    expect(stored.password).toBe("pass123");
    expect(stored.locale).toBe("en");
    expect(stored.timezone).toBe("UTC");
    expect(stored.verificationCode).toHaveLength(6);
  });

  test("startSignup: invalid email", async () => {
    await expect(
      signupService.startSignup("invalid-email", "pass123", "en", "UTC"),
    ).rejects.toThrow(/Invalid email format/i);
  });

  test("startSignup: short password", async () => {
    await expect(signupService.startSignup("foo@example.com", "", "en", "UTC")).rejects.toThrow(
      /Password must be at least 6 characters/i,
    );
  });

  test("verifySignup: normal", async () => {
    const { signupId } = await signupService.startSignup("test@ex.com", "pass123", "en", "UTC");
    const data = await redis.hgetall(`signup:${signupId}`);
    (usersService.createUser as unknown as jest.Mock).mockResolvedValue({ id: "user-1" });
    const res = await signupService.verifySignup(signupId, data.verificationCode);
    expect(res.userId).toBe("user-1");
    expect(await redis.hgetall(`signup:${signupId}`)).toEqual({});
  });

  test("verifySignup: code mismatch", async () => {
    const { signupId } = await signupService.startSignup("test@ex.com", "pass123", "en", "UTC");
    await expect(signupService.verifySignup(signupId, "999999")).rejects.toThrow(
      /Verification code mismatch/i,
    );
  });

  test("verifySignup: expired or not found", async () => {
    await expect(signupService.verifySignup("no-such-id", "123456")).rejects.toThrow(
      /Signup info not found or expired/i,
    );
  });

  test("verifySignup: already registered email", async () => {
    pgClient.emails.add("exists@ex.com");
    const { signupId } = await signupService.startSignup("exists@ex.com", "pass123", "en", "UTC");
    const data = await redis.hgetall(`signup:${signupId}`);
    await expect(signupService.verifySignup(signupId, data.verificationCode)).rejects.toThrow(
      "Email already in use.",
    );
  });
});
