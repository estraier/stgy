import * as signupService from "./signup";
import * as usersService from "./users";

jest.mock("./users");

class MockRedis {
  private store = new Map<string, any>();
  private queue: string[] = [];
  async hmset(key: string, obj: any) {
    this.store.set(key, obj);
  }
  async hgetall(key: string) {
    return this.store.get(key) || {};
  }
  async expire(key: string, seconds: number) {}
  async lpush(queue: string, val: string) {
    this.queue.push(val);
  }
  async del(key: string) {
    this.store.delete(key);
  }
}

describe("signup service", () => {
  let redis: MockRedis;
  let pgClient: any;

  beforeEach(() => {
    redis = new MockRedis();
    pgClient = {};
    (usersService.createUser as jest.Mock).mockReset();
  });

  test("startSignup: valid input", async () => {
    const res = await signupService.startSignup("foo@example.com", "pass123", redis as any);
    expect(res.signupId).toBeDefined();
    const signupKey = `signup:${res.signupId}`;
    const stored = await redis.hgetall(signupKey);
    expect(stored.email).toBe("foo@example.com");
    expect(stored.password).toBe("pass123");
    expect(stored.verificationCode).toHaveLength(6);
  });

  test("startSignup: invalid email", async () => {
    await expect(
      signupService.startSignup("invalid-email", "pass123", redis as any)
    ).rejects.toThrow("Invalid email format");
  });

  test("startSignup: short password", async () => {
    await expect(
      signupService.startSignup("foo@example.com", "", redis as any)
    ).rejects.toThrow("Password must be at least 6 characters");
  });

  test("verifySignup: normal", async () => {
    const { signupId } = await signupService.startSignup("test@ex.com", "pass123", redis as any);
    const data = await redis.hgetall(`signup:${signupId}`);
    (usersService.createUser as jest.Mock).mockResolvedValue({ id: "user-1" });
    const res = await signupService.verifySignup(signupId, data.verificationCode, redis as any, pgClient);
    expect(res.userId).toBe("user-1");
    expect(await redis.hgetall(`signup:${signupId}`)).toEqual({});
  });

  test("verifySignup: code mismatch", async () => {
    const { signupId } = await signupService.startSignup("test@ex.com", "pass123", redis as any);
    await expect(
      signupService.verifySignup(signupId, "999999", redis as any, pgClient)
    ).rejects.toThrow("Verification code mismatch");
  });

  test("verifySignup: expired or not found", async () => {
    await expect(
      signupService.verifySignup("no-such-id", "123456", redis as any, pgClient)
    ).rejects.toThrow("Signup info not found or expired");
  });
});
