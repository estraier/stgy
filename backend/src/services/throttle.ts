import type Redis from "ioredis";

export class ThrottleService {
  private redis: Redis;
  private actionId: string;
  private periodMs: number;
  private limitAmount: number;

  constructor(redis: Redis, actionId: string, periodInSec: number, limitAmount: number) {
    this.redis = redis;
    this.actionId = actionId;
    this.periodMs = Math.max(1, Math.floor(periodInSec * 1000));
    this.limitAmount = limitAmount;
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

  async canDo(userId: string, amount: number): Promise<boolean> {
    if (!Number.isFinite(amount) || amount < 0) {
      throw new Error("amount must be a non-negative number");
    }
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
    let used = 0;
    for (const m of members) used += this.parseAmount(m);
    return used + amount <= this.limitAmount;
  }

  async recordDone(userId: string, amount: number): Promise<void> {
    if (!Number.isFinite(amount) || amount <= 0) return;
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
