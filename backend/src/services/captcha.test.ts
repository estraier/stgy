import type Redis from "ioredis";
import { Config } from "../config";
import { CaptchaService } from "./captcha";

class FakeRedis {
  store = new Map<string, string>();
  ttl = new Map<string, number>();

  set = jest.fn(async (key: string, value: string, ...args: Array<string | number>) => {
    this.store.set(key, value);
    const exIndex = args.indexOf("EX");
    if (exIndex >= 0 && typeof args[exIndex + 1] === "number") {
      this.ttl.set(key, Number(args[exIndex + 1]));
    }
    return "OK";
  });

  get = jest.fn(async (key: string) => this.store.get(key) ?? null);

  del = jest.fn(async (key: string) => {
    const existed = this.store.delete(key);
    this.ttl.delete(key);
    return existed ? 1 : 0;
  });

  eval = jest.fn(async (script: string, _numKeys: number, key: string, arg?: string | number) => {
    const raw = this.store.get(key);
    if (script.includes('expected ~= ARGV[1]')) {
      if (raw === undefined) return -1;
      if (raw !== arg) return 0;
      this.store.delete(key);
      this.ttl.delete(key);
      return 1;
    }
    if (script.includes('reserved = reserved + 1')) {
      if (raw === undefined) return 0;
      const [used, reserved] = raw.split(',').map(Number);
      const maxUses = Number(arg);
      if (!Number.isFinite(used) || !Number.isFinite(reserved) || used + reserved >= maxUses) return 0;
      this.store.set(key, `${used},${reserved + 1}`);
      return 1;
    }
    if (script.includes('used = used + 1')) {
      if (raw === undefined) return 0;
      let [used, reserved] = raw.split(',').map(Number);
      const maxUses = Number(arg);
      if (!Number.isFinite(used) || !Number.isFinite(reserved) || reserved <= 0) return 0;
      used += 1;
      reserved -= 1;
      if (used >= maxUses && reserved === 0) {
        this.store.delete(key);
        this.ttl.delete(key);
        return 2;
      }
      this.store.set(key, `${used},${reserved}`);
      return 1;
    }
    if (script.includes('reserved = reserved - 1')) {
      if (raw === undefined) return 0;
      const [used, reserved] = raw.split(',').map(Number);
      if (!Number.isFinite(used) || !Number.isFinite(reserved) || reserved <= 0) return 0;
      this.store.set(key, `${used},${reserved - 1}`);
      return 1;
    }
    throw new Error('unexpected Lua script');
  });
}

function asRedis(redis: FakeRedis): Redis {
  return redis as unknown as Redis;
}

describe("CaptchaService", () => {
  test("creates a six-digit reusable challenge as PNG", async () => {
    const redis = new FakeRedis();
    const service = new CaptchaService(asRedis(redis));

    const challenge = await service.createChallenge("pub-comment");

    expect(challenge.id).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(challenge.png.subarray(0, 8)).toEqual(
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    );
    const [[key, answer, ex, ttl]] = redis.set.mock.calls;
    expect(key).toBe(`captcha:challenge:pub-comment:${challenge.id}`);
    expect(answer).toMatch(/^\d{6}$/);
    expect(ex).toBe("EX");
    expect(ttl).toBe(Config.CAPTCHA_CHALLENGE_TTL_SEC);
  });

  test("renders a different PNG for separate challenges", async () => {
    const redis = new FakeRedis();
    const service = new CaptchaService(asRedis(redis));

    const a = await service.createChallenge("pub-comment");
    const b = await service.createChallenge("pub-comment");

    expect(a.png.equals(b.png)).toBe(false);
  });

  test("keeps a challenge after a wrong answer and accepts the correct answer later", async () => {
    const redis = new FakeRedis();
    const service = new CaptchaService(asRedis(redis));
    const challenge = await service.createChallenge("pub-comment");
    const key = `captcha:challenge:pub-comment:${challenge.id}`;
    const expected = redis.store.get(key)!;
    const wrong = expected === "000000" ? "000001" : "000000";

    await expect(service.verifyChallenge("pub-comment", challenge.id, wrong)).resolves.toBe(false);
    expect(redis.store.get(key)).toBe(expected);
    await expect(service.verifyChallenge("pub-comment", challenge.id, expected)).resolves.toBe(true);
    expect(redis.store.has(key)).toBe(false);
  });

  test("accepts the correct answer exactly once", async () => {
    const redis = new FakeRedis();
    const service = new CaptchaService(asRedis(redis));
    const challenge = await service.createChallenge("pub-comment");
    const key = `captcha:challenge:pub-comment:${challenge.id}`;
    const expected = redis.store.get(key)!;

    await expect(service.verifyChallenge("pub-comment", challenge.id, expected)).resolves.toBe(true);
    await expect(service.verifyChallenge("pub-comment", challenge.id, expected)).resolves.toBe(false);
  });

  test("issues a pass token with the configured lifetime and use budget", async () => {
    const redis = new FakeRedis();
    const service = new CaptchaService(asRedis(redis));

    const token = await service.issuePassToken("pub-comment");
    const status = await service.getPassTokenStatus("pub-comment", token);

    expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(status).toEqual({
      valid: true,
      used: 0,
      remaining: Config.CAPTCHA_PASS_MAX_USES,
    });
    const passKey = [...redis.store.keys()].find((key) => key.startsWith("captcha:pass:pub-comment:"));
    expect(passKey).toBeDefined();
    expect(passKey).not.toContain(token);
    expect(redis.ttl.get(passKey!)).toBe(Config.CAPTCHA_PASS_TTL_SEC);
  });

  test("invalidates a pass token after its maximum successful uses", async () => {
    const redis = new FakeRedis();
    const service = new CaptchaService(asRedis(redis));
    const token = await service.issuePassToken("pub-comment");

    for (let i = 0; i < Config.CAPTCHA_PASS_MAX_USES; i += 1) {
      await expect(service.reservePassTokenUse("pub-comment", token)).resolves.toBe(true);
      await expect(service.commitPassTokenUse("pub-comment", token)).resolves.toBe(
        i + 1 === Config.CAPTCHA_PASS_MAX_USES ? "exhausted" : "valid",
      );
    }

    await expect(service.reservePassTokenUse("pub-comment", token)).resolves.toBe(false);
    await expect(service.getPassTokenStatus("pub-comment", token)).resolves.toEqual({
      valid: false,
      used: 0,
      remaining: 0,
    });
  });

  test("released pass reservation does not consume a use", async () => {
    const redis = new FakeRedis();
    const service = new CaptchaService(asRedis(redis));
    const token = await service.issuePassToken("pub-comment");

    await expect(service.reservePassTokenUse("pub-comment", token)).resolves.toBe(true);
    await service.releasePassTokenUse("pub-comment", token);

    await expect(service.getPassTokenStatus("pub-comment", token)).resolves.toEqual({
      valid: true,
      used: 0,
      remaining: Config.CAPTCHA_PASS_MAX_USES,
    });
  });

  test("revokes a pass token", async () => {
    const redis = new FakeRedis();
    const service = new CaptchaService(asRedis(redis));
    const token = await service.issuePassToken("pub-comment");

    await service.revokePassToken("pub-comment", token);

    await expect(service.getPassTokenStatus("pub-comment", token)).resolves.toEqual({
      valid: false,
      used: 0,
      remaining: 0,
    });
  });
});
