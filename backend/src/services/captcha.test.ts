import crypto from "crypto";
import type Redis from "ioredis";
import { Config } from "../config";
import { CaptchaService } from "./captcha";

type RedisHash = Map<string, string>;

class FakeRedis {
  store = new Map<string, string>();
  hashes = new Map<string, RedisHash>();
  ttl = new Map<string, number>();

  set = jest.fn(async (key: string, value: string, ...args: Array<string | number>) => {
    this.hashes.delete(key);
    this.store.set(key, value);
    const exIndex = args.indexOf("EX");
    if (exIndex >= 0 && typeof args[exIndex + 1] === "number") {
      this.ttl.set(key, Number(args[exIndex + 1]));
    }
    return "OK";
  });

  get = jest.fn(async (key: string) => this.store.get(key) ?? null);

  del = jest.fn(async (key: string) => {
    const existed = this.store.delete(key) || this.hashes.delete(key);
    this.ttl.delete(key);
    return existed ? 1 : 0;
  });

  eval = jest.fn(
    async (
      script: string,
      _numKeys: number,
      key: string,
      ...args: Array<string | number>
    ): Promise<number | number[]> => {
      const raw = this.store.get(key);
      if (script.includes('expected ~= ARGV[1]')) {
        if (raw === undefined) return -1;
        if (raw !== args[0]) return 0;
        this.deleteKey(key);
        return 1;
      }

      if (script.includes('redis.call("HSET", KEYS[1], "used", ARGV[1]')) {
        this.store.delete(key);
        this.hashes.set(
          key,
          new Map([
            ["used", String(args[0])],
            ["reserved", "0"],
            [String(args[1]), "1"],
          ]),
        );
        this.ttl.set(key, Number(args[2]));
        return 1;
      }

      if (script.includes("return {1, used, reserved}")) {
        const maxUses = Number(args[0]);
        const ipField = String(args[1]);
        const state = this.readAnyPassState(key);
        if (!state) return [0, 0, 0];
        if (state.used + state.reserved >= maxUses) {
          if (state.used >= maxUses && state.reserved === 0) this.deleteKey(key);
          return [0, 0, 0];
        }
        if (state.legacy) {
          this.migrateLegacy(key, state.used, state.reserved, ipField);
        } else if (!this.ensureIp(key, ipField, Number(args[2]))) {
          return [0, 0, 0];
        }
        return [1, state.used, state.reserved];
      }

      if (script.includes("reserved = reserved + 1")) {
        const maxUses = Number(args[0]);
        const ipField = String(args[1]);
        const state = this.readAnyPassState(key);
        if (!state) return 0;
        if (state.used + state.reserved >= maxUses) {
          if (state.used >= maxUses && state.reserved === 0) this.deleteKey(key);
          return 0;
        }
        if (state.legacy) {
          this.migrateLegacy(key, state.used, state.reserved, ipField);
        } else if (!this.ensureIp(key, ipField, Number(args[2]))) {
          return 0;
        }
        this.hashes.get(key)!.set("reserved", String(state.reserved + 1));
        return 1;
      }

      if (script.includes("used = used + 1")) {
        const state = this.readAnyPassState(key);
        if (!state || state.reserved <= 0) return 0;
        const maxUses = Number(args[0]);
        const used = state.used + 1;
        const reserved = state.reserved - 1;
        if (used >= maxUses && reserved === 0) {
          this.deleteKey(key);
          return 2;
        }
        if (state.legacy) {
          this.store.set(key, `${used},${reserved}`);
        } else {
          const hash = this.hashes.get(key)!;
          hash.set("used", String(used));
          hash.set("reserved", String(reserved));
        }
        return 1;
      }

      if (script.includes("reserved = reserved - 1")) {
        const state = this.readAnyPassState(key);
        if (!state || state.reserved <= 0) return 0;
        const reserved = state.reserved - 1;
        if (state.legacy) {
          this.store.set(key, `${state.used},${reserved}`);
        } else {
          this.hashes.get(key)!.set("reserved", String(reserved));
        }
        return 1;
      }

      throw new Error("unexpected Lua script");
    },
  );

  private readAnyPassState(
    key: string,
  ): { used: number; reserved: number; legacy: boolean } | null {
    const raw = this.store.get(key);
    if (raw !== undefined) {
      const match = /^(\d+),(\d+)$/.exec(raw);
      if (!match) {
        this.deleteKey(key);
        return null;
      }
      return { used: Number(match[1]), reserved: Number(match[2]), legacy: true };
    }
    const hash = this.hashes.get(key);
    if (!hash) return null;
    const used = Number(hash.get("used"));
    const reserved = Number(hash.get("reserved"));
    if (!Number.isFinite(used) || !Number.isFinite(reserved) || used < 0 || reserved < 0) {
      this.deleteKey(key);
      return null;
    }
    return { used, reserved, legacy: false };
  }

  private migrateLegacy(key: string, used: number, reserved: number, ipField: string): void {
    const ttl = this.ttl.get(key);
    this.store.delete(key);
    this.hashes.set(
      key,
      new Map([
        ["used", String(used)],
        ["reserved", String(reserved)],
        [ipField, "1"],
      ]),
    );
    if (ttl !== undefined) this.ttl.set(key, ttl);
  }

  private ensureIp(key: string, ipField: string, maxIps: number): boolean {
    const hash = this.hashes.get(key);
    if (!hash) return false;
    if (hash.has(ipField)) return true;
    const ipCount = [...hash.keys()].filter((field) => field.startsWith("ip:")).length;
    if (ipCount >= maxIps) {
      this.deleteKey(key);
      return false;
    }
    hash.set(ipField, "1");
    return true;
  }

  private deleteKey(key: string): void {
    this.store.delete(key);
    this.hashes.delete(key);
    this.ttl.delete(key);
  }
}

function asRedis(redis: FakeRedis): Redis {
  return redis as unknown as Redis;
}

function passHash(redis: FakeRedis): RedisHash {
  const key = [...redis.hashes.keys()].find((candidate) =>
    candidate.startsWith("captcha:pass:pub-comment:"),
  );
  if (!key) throw new Error("pass hash not found");
  return redis.hashes.get(key)!;
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

  test("issues a pass token with the configured lifetime, use budget, and hashed initial IP", async () => {
    const redis = new FakeRedis();
    const service = new CaptchaService(asRedis(redis));

    const token = await service.issuePassToken("pub-comment", "203.0.113.10");
    const status = await service.getPassTokenStatus("pub-comment", token, "203.0.113.10");

    expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(status).toEqual({
      valid: true,
      used: 0,
      remaining: Config.CAPTCHA_PASS_MAX_USES,
    });
    const passKey = [...redis.hashes.keys()].find((key) =>
      key.startsWith("captcha:pass:pub-comment:"),
    );
    expect(passKey).toBeDefined();
    expect(passKey).not.toContain(token);
    expect(redis.ttl.get(passKey!)).toBe(Config.CAPTCHA_PASS_TTL_SEC);
    const fields = [...passHash(redis).keys()];
    expect(fields.filter((field) => field.startsWith("ip:"))).toHaveLength(1);
    expect(fields.join("\n")).not.toContain("203.0.113.10");
  });

  test("allows a pass token from up to four distinct IP addresses", async () => {
    const redis = new FakeRedis();
    const service = new CaptchaService(asRedis(redis));
    const token = await service.issuePassToken("pub-comment", "203.0.113.1");

    for (const ip of ["203.0.113.1", "203.0.113.2", "203.0.113.3", "203.0.113.4"]) {
      await expect(service.getPassTokenStatus("pub-comment", token, ip)).resolves.toMatchObject({
        valid: true,
      });
    }

    expect([...passHash(redis).keys()].filter((field) => field.startsWith("ip:"))).toHaveLength(4);
  });

  test("fifth distinct IP address invalidates the entire pass token", async () => {
    const redis = new FakeRedis();
    const service = new CaptchaService(asRedis(redis));
    const token = await service.issuePassToken("pub-comment", "203.0.113.1");

    for (const ip of ["203.0.113.2", "203.0.113.3", "203.0.113.4"]) {
      await service.getPassTokenStatus("pub-comment", token, ip);
    }

    await expect(service.getPassTokenStatus("pub-comment", token, "203.0.113.5")).resolves.toEqual({
      valid: false,
      used: 0,
      remaining: 0,
    });
    await expect(service.getPassTokenStatus("pub-comment", token, "203.0.113.1")).resolves.toEqual({
      valid: false,
      used: 0,
      remaining: 0,
    });
  });

  test("reserve also enforces the four-IP limit atomically", async () => {
    const redis = new FakeRedis();
    const service = new CaptchaService(asRedis(redis));
    const token = await service.issuePassToken("pub-comment", "203.0.113.1");

    for (const ip of ["203.0.113.2", "203.0.113.3", "203.0.113.4"]) {
      await service.getPassTokenStatus("pub-comment", token, ip);
    }

    await expect(service.reservePassTokenUse("pub-comment", token, "203.0.113.5")).resolves.toBe(
      false,
    );
    await expect(service.reservePassTokenUse("pub-comment", token, "203.0.113.1")).resolves.toBe(
      false,
    );
  });

  test("invalidates a pass token after its maximum successful uses", async () => {
    const redis = new FakeRedis();
    const service = new CaptchaService(asRedis(redis));
    const token = await service.issuePassToken("pub-comment", "203.0.113.10");

    for (let i = 0; i < Config.CAPTCHA_PASS_MAX_USES; i += 1) {
      await expect(
        service.reservePassTokenUse("pub-comment", token, "203.0.113.10"),
      ).resolves.toBe(true);
      await expect(service.commitPassTokenUse("pub-comment", token)).resolves.toBe(
        i + 1 === Config.CAPTCHA_PASS_MAX_USES ? "exhausted" : "valid",
      );
    }

    await expect(
      service.reservePassTokenUse("pub-comment", token, "203.0.113.10"),
    ).resolves.toBe(false);
    await expect(
      service.getPassTokenStatus("pub-comment", token, "203.0.113.10"),
    ).resolves.toEqual({
      valid: false,
      used: 0,
      remaining: 0,
    });
  });

  test("does not delete a pass while its final use is reserved", async () => {
    const redis = new FakeRedis();
    const service = new CaptchaService(asRedis(redis));
    const token = await service.issuePassToken(
      "pub-comment",
      "203.0.113.10",
      Config.CAPTCHA_PASS_MAX_USES - 1,
    );

    await expect(
      service.reservePassTokenUse("pub-comment", token, "203.0.113.10"),
    ).resolves.toBe(true);
    await expect(
      service.getPassTokenStatus("pub-comment", token, "203.0.113.10"),
    ).resolves.toEqual({ valid: false, used: 0, remaining: 0 });
    expect(redis.hashes.size).toBe(1);
    await expect(service.commitPassTokenUse("pub-comment", token)).resolves.toBe("exhausted");
    expect(redis.hashes.size).toBe(0);
  });

  test("released pass reservation does not consume a use", async () => {
    const redis = new FakeRedis();
    const service = new CaptchaService(asRedis(redis));
    const token = await service.issuePassToken("pub-comment", "203.0.113.10");

    await expect(
      service.reservePassTokenUse("pub-comment", token, "203.0.113.10"),
    ).resolves.toBe(true);
    await service.releasePassTokenUse("pub-comment", token);

    await expect(
      service.getPassTokenStatus("pub-comment", token, "203.0.113.10"),
    ).resolves.toEqual({
      valid: true,
      used: 0,
      remaining: Config.CAPTCHA_PASS_MAX_USES,
    });
  });

  test("revokes a pass token", async () => {
    const redis = new FakeRedis();
    const service = new CaptchaService(asRedis(redis));
    const token = await service.issuePassToken("pub-comment", "203.0.113.10");

    await service.revokePassToken("pub-comment", token);

    await expect(
      service.getPassTokenStatus("pub-comment", token, "203.0.113.10"),
    ).resolves.toEqual({
      valid: false,
      used: 0,
      remaining: 0,
    });
  });

  test("migrates legacy string pass state while preserving its use count and lifetime", async () => {
    const redis = new FakeRedis();
    const service = new CaptchaService(asRedis(redis));
    const token = "legacy-token";
    const digest = crypto.createHash("sha256").update(token, "utf8").digest("hex");
    const key = `captcha:pass:pub-comment:${digest}`;
    redis.store.set(key, "3,0");
    redis.ttl.set(key, 1234);

    await expect(
      service.getPassTokenStatus("pub-comment", token, "203.0.113.10"),
    ).resolves.toEqual({
      valid: true,
      used: 3,
      remaining: Config.CAPTCHA_PASS_MAX_USES - 3,
    });
    expect(redis.store.has(key)).toBe(false);
    expect(redis.hashes.has(key)).toBe(true);
    expect(redis.ttl.get(key)).toBe(1234);
    expect([...redis.hashes.get(key)!.keys()].filter((field) => field.startsWith("ip:"))).toHaveLength(
      1,
    );
  });

  test("migrates a legacy pass when its next use is reserved", async () => {
    const redis = new FakeRedis();
    const service = new CaptchaService(asRedis(redis));
    const token = "legacy-reserve-token";
    const digest = crypto.createHash("sha256").update(token, "utf8").digest("hex");
    const key = `captcha:pass:pub-comment:${digest}`;
    redis.store.set(key, "3,0");
    redis.ttl.set(key, 1234);

    await expect(
      service.reservePassTokenUse("pub-comment", token, "203.0.113.10"),
    ).resolves.toBe(true);
    expect(redis.store.has(key)).toBe(false);
    expect(redis.hashes.get(key)?.get("reserved")).toBe("1");
    await expect(service.commitPassTokenUse("pub-comment", token)).resolves.toBe("valid");
    await expect(
      service.getPassTokenStatus("pub-comment", token, "203.0.113.10"),
    ).resolves.toEqual({
      valid: true,
      used: 4,
      remaining: Config.CAPTCHA_PASS_MAX_USES - 4,
    });
    expect(redis.ttl.get(key)).toBe(1234);
  });

  test("commits a legacy reservation that was created before deployment", async () => {
    const redis = new FakeRedis();
    const service = new CaptchaService(asRedis(redis));
    const token = "legacy-commit-token";
    const digest = crypto.createHash("sha256").update(token, "utf8").digest("hex");
    const key = `captcha:pass:pub-comment:${digest}`;
    redis.store.set(key, "3,1");
    redis.ttl.set(key, 1234);

    await expect(service.commitPassTokenUse("pub-comment", token)).resolves.toBe("valid");
    expect(redis.store.get(key)).toBe("4,0");
    expect(redis.ttl.get(key)).toBe(1234);
  });
});
