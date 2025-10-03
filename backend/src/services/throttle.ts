import { Config } from "../config";
import type Redis from "ioredis";
import { formatDateInTz } from "../utils/format";
import { UserLite } from "../models/user";

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

export class DailyTimerThrottleService {
  private limitMs: number;
  private timeZone: string;

  constructor(
    private redis: Redis,
    private actionId: string,
    limitMs: number,
  ) {
    this.limitMs = limitMs;
    this.timeZone = Config.SYSTEM_TIMEZONE || "Asia/Tokyo";
  }

  private key(userId: string, nowMs = Date.now()): string {
    if (!userId || userId.trim() === "") throw new Error("userId is required");
    const day = formatDateInTz(nowMs, this.timeZone);
    return `dtt:${this.actionId}:${day}:${userId}`;
  }

  async canDo(userId: string): Promise<boolean> {
    const v = await this.redis.get(this.key(userId));
    const used = v ? Number(v) : 0;
    console.log("CANDO", used);
    return used < this.limitMs;
  }

  async recordDone(userId: string, elapsedTime: number): Promise<void> {
    const inc = Math.floor(elapsedTime);
    if (!Number.isFinite(inc) || inc <= 0) return;
    const key = this.key(userId);
    const RETENTION_SEC = 2 * 24 * 60 * 60;
    console.log("DONE", elapsedTime);
    await this.redis.multi().incrby(key, inc).expire(key, RETENTION_SEC).exec();
  }

  startWatch(user: UserLite) {
    const isAdmin = !!user.isAdmin;
    const userId = user.id;
    const t0 = globalThis.performance.now();
    let committed = false;
    return {
      done: (): void => {
        if (committed || isAdmin) return;
        committed = true;
        const elapsed = globalThis.performance.now() - t0;
        if (!(elapsed > 0)) return;
        void this.recordDone(userId, elapsed).catch(() => {});
      },
    };
  }
}
