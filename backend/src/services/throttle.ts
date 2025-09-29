import { Config } from "../config";
import type Redis from "ioredis";
import { formatDateInTz } from "../utils/format";

export class ThrottleService {
  private redis: Redis;
  private actionId: string;
  private periodMs: number;
  private limitAmount: number;
  private limitCount: number;

  constructor(
    redis: Redis,
    actionId: string,
    periodInSec: number,
    limitCount: number = 0,
    limitAmount: number = 0,
  ) {
    this.redis = redis;
    this.actionId = actionId;
    this.periodMs = Math.max(1, Math.floor(periodInSec * 1000));
    this.limitAmount = limitAmount;
    this.limitCount = limitCount;
  }

  private key(userId: string): string {
    if (!userId || userId.trim() === "") {
      throw new Error("userId is required");
    }
    return `throttle:${this.actionId}:${userId}:history`;
  }

  private makeMember(nowMs: number, amount: number): string {
    const amt = Number.isInteger(amount) ? String(amount) : String(+amount);
    return `${nowMs}:${Math.random().toString(36).slice(2, 10)}:${amt}`;
  }

  private parseAmount(member: string): number {
    const parts = member.split(":");
    const v = parseFloat(parts[2] ?? "0");
    return Number.isFinite(v) ? v : 0;
  }

  async canDo(userId: string, amount: number = 1): Promise<boolean> {
    const key = this.key(userId);
    const now = Date.now();
    const cutoff = now - this.periodMs;
    const results = await this.redis
      .multi()
      .zremrangebyscore(key, 0, cutoff)
      .pexpire(key, this.periodMs + 1000)
      .zrangebyscore(key, cutoff, "+inf")
      .exec();
    const members: string[] = (results?.[2]?.[1] as string[]) ?? [];
    let usedAmount = 0;
    let usedCount = 0;
    for (const m of members) {
      usedAmount += this.parseAmount(m);
      usedCount += 1;
    }
    if (this.limitAmount > 0 && amount > 0 && usedAmount + amount > this.limitAmount) {
      return false;
    }
    if (this.limitCount > 0 && usedCount >= this.limitCount) {
      return false;
    }
    return true;
  }

  async recordDone(userId: string, amount: number = 1): Promise<void> {
    const key = this.key(userId);
    const now = Date.now();
    const member = this.makeMember(now, amount);
    await this.redis
      .multi()
      .zadd(key, now, member)
      .zremrangebyscore(key, 0, now - this.periodMs - 1000)
      .pexpire(key, this.periodMs + 1000)
      .exec();
  }
}

function parseDurationMs(s: string): number {
  const v = s.trim();
  if (!v) throw new Error("limitTime is required");
  const iso = /^P(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?)$/i.exec(v);
  if (iso) {
    const h = Number(iso[1] ?? 0);
    const m = Number(iso[2] ?? 0);
    const sec = Number(iso[3] ?? 0);
    const ms = Math.round(((h * 60 + m) * 60 + sec) * 1000);
    if (ms > 0) return ms;
  }
  const hms = /^(\d{1,2}):([0-5]\d)(?::([0-5]\d))?$/.exec(v);
  if (hms) {
    const h = Number(hms[1]);
    const m = Number(hms[2]);
    const sec = Number(hms[3] ?? 0);
    const ms = ((h * 60 + m) * 60 + sec) * 1000;
    if (ms > 0) return ms;
  }
  const unit = /^(\d+(?:\.\d+)?)(ms|s|m|h)$/i.exec(v);
  if (unit) {
    const n = Number(unit[1]);
    const u = unit[2].toLowerCase();
    const ms = u === "ms" ? n : u === "s" ? n * 1000 : u === "m" ? n * 60_000 : n * 3_600_000;
    if (Number.isFinite(ms) && ms > 0) return Math.round(ms);
  }
  throw new Error(`Unsupported limitTime format: ${s}`);
}

export class DailyTimerThrottleService {
  private limitMs: number;
  private timeZone: string;

  constructor(
    private redis: Redis,
    private actionId: string,
    limitTime: string,
  ) {
    this.limitMs = parseDurationMs(limitTime);
    this.timeZone = Config.SYSTEM_TIMEZONE || "Asia/Tokyo";
  }

  private key(userId: string, nowMs = Date.now()): string {
    if (!userId || userId.trim() === "") throw new Error("userId is required");
    const day = formatDateInTz(nowMs, this.timeZone); // YYYY-MM-DD (local day)
    return `dtt:${this.actionId}:${day}:${userId}`;
  }

  async canDo(userId: string): Promise<boolean> {
    const v = await this.redis.get(this.key(userId));
    const used = v ? Number(v) : 0;
    return used < this.limitMs;
  }

  async recordDone(userId: string, elapsedTime: number): Promise<void> {
    const inc = Math.floor(elapsedTime);
    if (!Number.isFinite(inc) || inc <= 0) return;

    const key = this.key(userId);
    const RETENTION_SEC = 2 * 24 * 60 * 60; // keep ~2 days to auto-clean old daily keys

    await this.redis.multi().incrby(key, inc).expire(key, RETENTION_SEC).exec();
  }
}
