import crypto from "crypto";
import type Redis from "ioredis";
import sharp from "sharp";
import { Config } from "../config";

const DIGIT_BITMAPS: Readonly<Record<string, readonly string[]>> = {
  "0": ["01110", "10001", "10011", "10101", "11001", "10001", "01110"],
  "1": ["00100", "01100", "00100", "00100", "00100", "00100", "01110"],
  "2": ["01110", "10001", "00001", "00010", "00100", "01000", "11111"],
  "3": ["11110", "00001", "00001", "01110", "00001", "00001", "11110"],
  "4": ["00010", "00110", "01010", "10010", "11111", "00010", "00010"],
  "5": ["11111", "10000", "10000", "11110", "00001", "00001", "11110"],
  "6": ["01110", "10000", "10000", "11110", "10001", "10001", "01110"],
  "7": ["11111", "00001", "00010", "00100", "01000", "01000", "01000"],
  "8": ["01110", "10001", "10001", "01110", "10001", "10001", "01110"],
  "9": ["01110", "10001", "10001", "01111", "00001", "00001", "01110"],
};

const IMAGE_WIDTH = 200;
const IMAGE_HEIGHT = 48;
const DIGIT_SCALE = 5;
const DIGIT_WIDTH = 5 * DIGIT_SCALE;
const DIGIT_GAP = 6;
const DIGIT_START_X = 8;
const DIGIT_START_Y = 6;
const CAPTCHA_DIGITS = 6;
const TOKEN_BYTES = 32;
const CHALLENGE_ID_BYTES = 18;
const PASS_MAX_IP_ADDRESSES = 4;
const BACKGROUND_DITHER_PROBABILITY = 0.10;
const DIGIT_ROTATION_MAX_DEGREES = 10;
const DIGIT_MARGIN = 4;

export type CaptchaChallenge = {
  id: string;
  png: Buffer;
};

export type CaptchaPassStatus = {
  valid: boolean;
  used: number;
  remaining: number;
};

export class CaptchaService {
  constructor(private readonly redis: Redis) {}

  async createChallenge(purpose: string): Promise<CaptchaChallenge> {
    const normalizedPurpose = normalizePurpose(purpose);
    const answer = Array.from({ length: CAPTCHA_DIGITS }, () => crypto.randomInt(10)).join("");
    const id = crypto.randomBytes(CHALLENGE_ID_BYTES).toString("base64url");
    const png = await renderCaptchaPng(answer);
    await this.redis.set(
      challengeKey(normalizedPurpose, id),
      answer,
      "EX",
      Config.CAPTCHA_CHALLENGE_TTL_SEC,
    );
    return { id, png };
  }

  async verifyChallenge(purpose: string, id: string, answer: string): Promise<boolean> {
    const normalizedPurpose = normalizePurpose(purpose);
    const key = challengeKey(normalizedPurpose, id);
    if (!/^\d{6}$/.test(answer)) return false;
    const result = await this.redis.eval(
      `
local expected = redis.call("GET", KEYS[1])
if not expected then
  return -1
end
if expected ~= ARGV[1] then
  return 0
end
redis.call("DEL", KEYS[1])
return 1
`,
      1,
      key,
      answer,
    );
    return Number(result) === 1;
  }

  async issuePassToken(purpose: string, clientIp: string, initialUsed = 0): Promise<string> {
    const normalizedPurpose = normalizePurpose(purpose);
    if (
      !Number.isSafeInteger(initialUsed) ||
      initialUsed < 0 ||
      initialUsed >= Config.CAPTCHA_PASS_MAX_USES
    ) {
      throw new Error("invalid initial CAPTCHA pass use count");
    }
    const token = crypto.randomBytes(TOKEN_BYTES).toString("base64url");
    await this.redis.eval(
      `
redis.call("HSET", KEYS[1], "used", ARGV[1], "reserved", "0", ARGV[2], "1")
redis.call("EXPIRE", KEYS[1], ARGV[3])
return 1
`,
      1,
      passKey(normalizedPurpose, token),
      initialUsed,
      passIpField(token, clientIp),
      Config.CAPTCHA_PASS_TTL_SEC,
    );
    return token;
  }

  async getPassTokenStatus(
    purpose: string,
    token: string | undefined,
    clientIp: string,
  ): Promise<CaptchaPassStatus> {
    if (!token) return invalidPassStatus();
    const normalizedPurpose = normalizePurpose(purpose);
    const result = await this.redis.eval(
      `
local keyType = redis.call("TYPE", KEYS[1])
if type(keyType) == "table" then
  keyType = keyType["ok"]
end
if keyType == "none" then
  return {0, 0, 0}
end
local used
local reserved
local legacy = false
local legacyTtl = -1
if keyType == "string" then
  local value = redis.call("GET", KEYS[1])
  local comma = value and string.find(value, ",", 1, true)
  if not comma then
    redis.call("DEL", KEYS[1])
    return {0, 0, 0}
  end
  used = tonumber(string.sub(value, 1, comma - 1))
  reserved = tonumber(string.sub(value, comma + 1))
  legacy = true
  legacyTtl = redis.call("PTTL", KEYS[1])
elseif keyType == "hash" then
  used = tonumber(redis.call("HGET", KEYS[1], "used"))
  reserved = tonumber(redis.call("HGET", KEYS[1], "reserved"))
else
  redis.call("DEL", KEYS[1])
  return {0, 0, 0}
end
local maxUses = tonumber(ARGV[1])
if not used or not reserved or used < 0 or reserved < 0 then
  redis.call("DEL", KEYS[1])
  return {0, 0, 0}
end
if used + reserved >= maxUses then
  if used >= maxUses and reserved == 0 then
    redis.call("DEL", KEYS[1])
  end
  return {0, 0, 0}
end
local ipField = ARGV[2]
if legacy then
  redis.call("DEL", KEYS[1])
  redis.call("HSET", KEYS[1], "used", tostring(used), "reserved", tostring(reserved), ipField, "1")
  if legacyTtl >= 0 then
    redis.call("PEXPIRE", KEYS[1], math.max(1, legacyTtl))
  end
elseif redis.call("HEXISTS", KEYS[1], ipField) == 0 then
  local ipCount = 0
  local fields = redis.call("HKEYS", KEYS[1])
  for _, field in ipairs(fields) do
    if string.sub(field, 1, 3) == "ip:" then
      ipCount = ipCount + 1
    end
  end
  if ipCount >= tonumber(ARGV[3]) then
    redis.call("DEL", KEYS[1])
    return {0, 0, 0}
  end
  redis.call("HSET", KEYS[1], ipField, "1")
end
return {1, used, reserved}
`,
      1,
      passKey(normalizedPurpose, token),
      Config.CAPTCHA_PASS_MAX_USES,
      passIpField(token, clientIp),
      PASS_MAX_IP_ADDRESSES,
    );
    const values = Array.isArray(result) ? result.map(Number) : [];
    if (values[0] !== 1 || !Number.isSafeInteger(values[1]) || !Number.isSafeInteger(values[2])) {
      return invalidPassStatus();
    }
    const used = values[1];
    const reserved = values[2];
    return {
      valid: true,
      used,
      remaining: Config.CAPTCHA_PASS_MAX_USES - used - reserved,
    };
  }

  async reservePassTokenUse(
    purpose: string,
    token: string | undefined,
    clientIp: string,
  ): Promise<boolean> {
    if (!token) return false;
    const normalizedPurpose = normalizePurpose(purpose);
    const key = passKey(normalizedPurpose, token);
    const result = await this.redis.eval(
      `
local keyType = redis.call("TYPE", KEYS[1])
if type(keyType) == "table" then
  keyType = keyType["ok"]
end
if keyType == "none" then
  return 0
end
local used
local reserved
local legacy = false
local legacyTtl = -1
if keyType == "string" then
  local value = redis.call("GET", KEYS[1])
  local comma = value and string.find(value, ",", 1, true)
  if not comma then
    redis.call("DEL", KEYS[1])
    return 0
  end
  used = tonumber(string.sub(value, 1, comma - 1))
  reserved = tonumber(string.sub(value, comma + 1))
  legacy = true
  legacyTtl = redis.call("PTTL", KEYS[1])
elseif keyType == "hash" then
  used = tonumber(redis.call("HGET", KEYS[1], "used"))
  reserved = tonumber(redis.call("HGET", KEYS[1], "reserved"))
else
  redis.call("DEL", KEYS[1])
  return 0
end
local maxUses = tonumber(ARGV[1])
if not used or not reserved or used < 0 or reserved < 0 then
  redis.call("DEL", KEYS[1])
  return 0
end
if used + reserved >= maxUses then
  if used >= maxUses and reserved == 0 then
    redis.call("DEL", KEYS[1])
  end
  return 0
end
local ipField = ARGV[2]
if legacy then
  redis.call("DEL", KEYS[1])
  redis.call("HSET", KEYS[1], "used", tostring(used), "reserved", tostring(reserved), ipField, "1")
  if legacyTtl >= 0 then
    redis.call("PEXPIRE", KEYS[1], math.max(1, legacyTtl))
  end
elseif redis.call("HEXISTS", KEYS[1], ipField) == 0 then
  local ipCount = 0
  local fields = redis.call("HKEYS", KEYS[1])
  for _, field in ipairs(fields) do
    if string.sub(field, 1, 3) == "ip:" then
      ipCount = ipCount + 1
    end
  end
  if ipCount >= tonumber(ARGV[3]) then
    redis.call("DEL", KEYS[1])
    return 0
  end
  redis.call("HSET", KEYS[1], ipField, "1")
end
reserved = reserved + 1
redis.call("HSET", KEYS[1], "reserved", tostring(reserved))
return 1
`,
      1,
      key,
      Config.CAPTCHA_PASS_MAX_USES,
      passIpField(token, clientIp),
      PASS_MAX_IP_ADDRESSES,
    );
    return Number(result) === 1;
  }

  async commitPassTokenUse(
    purpose: string,
    token: string | undefined,
  ): Promise<"valid" | "exhausted" | "invalid"> {
    if (!token) return "invalid";
    const normalizedPurpose = normalizePurpose(purpose);
    const key = passKey(normalizedPurpose, token);
    const result = await this.redis.eval(
      `
local keyType = redis.call("TYPE", KEYS[1])
if type(keyType) == "table" then
  keyType = keyType["ok"]
end
if keyType == "none" then
  return 0
end
local used
local reserved
local legacy = false
if keyType == "string" then
  local value = redis.call("GET", KEYS[1])
  local comma = value and string.find(value, ",", 1, true)
  if not comma then
    redis.call("DEL", KEYS[1])
    return 0
  end
  used = tonumber(string.sub(value, 1, comma - 1))
  reserved = tonumber(string.sub(value, comma + 1))
  legacy = true
elseif keyType == "hash" then
  used = tonumber(redis.call("HGET", KEYS[1], "used"))
  reserved = tonumber(redis.call("HGET", KEYS[1], "reserved"))
else
  redis.call("DEL", KEYS[1])
  return 0
end
local maxUses = tonumber(ARGV[1])
if not used or not reserved or used < 0 or reserved <= 0 then
  redis.call("DEL", KEYS[1])
  return 0
end
used = used + 1
reserved = reserved - 1
if used >= maxUses and reserved == 0 then
  redis.call("DEL", KEYS[1])
  return 2
end
if legacy then
  redis.call("SET", KEYS[1], tostring(used) .. "," .. tostring(reserved), "KEEPTTL")
else
  redis.call("HSET", KEYS[1], "used", tostring(used), "reserved", tostring(reserved))
end
return 1
`,
      1,
      key,
      Config.CAPTCHA_PASS_MAX_USES,
    );
    if (Number(result) === 2) return "exhausted";
    if (Number(result) === 1) return "valid";
    return "invalid";
  }

  async releasePassTokenUse(purpose: string, token: string | undefined): Promise<void> {
    if (!token) return;
    const normalizedPurpose = normalizePurpose(purpose);
    const key = passKey(normalizedPurpose, token);
    await this.redis.eval(
      `
local keyType = redis.call("TYPE", KEYS[1])
if type(keyType) == "table" then
  keyType = keyType["ok"]
end
if keyType == "none" then
  return 0
end
local used
local reserved
local legacy = false
if keyType == "string" then
  local value = redis.call("GET", KEYS[1])
  local comma = value and string.find(value, ",", 1, true)
  if not comma then
    redis.call("DEL", KEYS[1])
    return 0
  end
  used = tonumber(string.sub(value, 1, comma - 1))
  reserved = tonumber(string.sub(value, comma + 1))
  legacy = true
elseif keyType == "hash" then
  used = tonumber(redis.call("HGET", KEYS[1], "used"))
  reserved = tonumber(redis.call("HGET", KEYS[1], "reserved"))
else
  redis.call("DEL", KEYS[1])
  return 0
end
if not used or not reserved or used < 0 or reserved <= 0 then
  return 0
end
reserved = reserved - 1
if legacy then
  redis.call("SET", KEYS[1], tostring(used) .. "," .. tostring(reserved), "KEEPTTL")
else
  redis.call("HSET", KEYS[1], "reserved", tostring(reserved))
end
return 1
`,
      1,
      key,
    );
  }

  async revokePassToken(purpose: string, token: string | undefined): Promise<void> {
    if (!token) return;
    const normalizedPurpose = normalizePurpose(purpose);
    await this.redis.del(passKey(normalizedPurpose, token));
  }
}

function normalizePurpose(purpose: string): string {
  const value = purpose.trim();
  if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(value)) {
    throw new Error("invalid captcha purpose");
  }
  return value;
}

function challengeKey(purpose: string, id: string): string {
  return `captcha:challenge:${purpose}:${id}`;
}

function passKey(purpose: string, token: string): string {
  const digest = crypto.createHash("sha256").update(token, "utf8").digest("hex");
  return `captcha:pass:${purpose}:${digest}`;
}

function passIpField(token: string, clientIp: string): string {
  const normalizedIp = clientIp.trim().toLowerCase();
  if (!normalizedIp) throw new Error("client IP is required for CAPTCHA pass");
  // Do not keep an IP value that can be recovered by hashing the small IPv4 address space.
  const digest = crypto.createHmac("sha256", token).update(normalizedIp, "utf8").digest("hex");
  return `ip:${digest}`;
}

function invalidPassStatus(): CaptchaPassStatus {
  return { valid: false, used: 0, remaining: 0 };
}

async function renderCaptchaPng(answer: string): Promise<Buffer> {
  const channels = 3;
  const pixels = Buffer.alloc(IMAGE_WIDTH * IMAGE_HEIGHT * channels, 255);

  addBackgroundDither(pixels, channels);

  const digitOverlays = answer.split("").map((digit, index) => {
    const pattern = DIGIT_BITMAPS[digit];
    if (!pattern) throw new Error("invalid captcha digit");
    const x = DIGIT_START_X + index * (DIGIT_WIDTH + DIGIT_GAP) + crypto.randomInt(-1, 2);
    const y = DIGIT_START_Y + crypto.randomInt(-1, 2);
    const angle = randomDigitRotation();
    return {
      input: Buffer.from(renderDigitSvg(pattern, angle), "utf8"),
      left: x - DIGIT_MARGIN,
      top: y - DIGIT_MARGIN,
    };
  });

  return sharp(pixels, {
    raw: { width: IMAGE_WIDTH, height: IMAGE_HEIGHT, channels },
  })
    .composite(digitOverlays)
    .png({ compressionLevel: 9 })
    .toBuffer();
}

function addBackgroundDither(pixels: Buffer, channels: number): void {
  const pixelCount = IMAGE_WIDTH * IMAGE_HEIGHT;
  const random = crypto.randomBytes(pixelCount);
  const threshold = Math.round(BACKGROUND_DITHER_PROBABILITY * 256);
  for (let i = 0; i < pixelCount; i += 1) {
    if (random[i] >= threshold) continue;
    const offset = i * channels;
    pixels[offset] = 0;
    pixels[offset + 1] = 0;
    pixels[offset + 2] = 0;
  }
}

function randomDigitRotation(): number {
  const tenths = crypto.randomInt(
    -DIGIT_ROTATION_MAX_DEGREES * 10,
    DIGIT_ROTATION_MAX_DEGREES * 10 + 1,
  );
  return tenths / 10;
}

function renderDigitSvg(pattern: readonly string[], angle: number): string {
  const canvasWidth = DIGIT_WIDTH + DIGIT_MARGIN * 2;
  const canvasHeight = pattern.length * DIGIT_SCALE + DIGIT_MARGIN * 2;
  const centerX = canvasWidth / 2;
  const centerY = canvasHeight / 2;
  const rects: string[] = [];
  for (let row = 0; row < pattern.length; row += 1) {
    for (let col = 0; col < pattern[row].length; col += 1) {
      if (pattern[row][col] !== "1") continue;
      rects.push(
        `<rect x="${DIGIT_MARGIN + col * DIGIT_SCALE}" y="${DIGIT_MARGIN + row * DIGIT_SCALE}" width="${DIGIT_SCALE}" height="${DIGIT_SCALE}" fill="#1c1c1c"/>`,
      );
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${canvasWidth}" height="${canvasHeight}" viewBox="0 0 ${canvasWidth} ${canvasHeight}"><g transform="rotate(${angle} ${centerX} ${centerY})">${rects.join("")}</g></svg>`;
}
