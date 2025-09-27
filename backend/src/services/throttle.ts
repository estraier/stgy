import type Redis from "ioredis";

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
    limitAmount: number,
    limitCount: number = 0,
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

  async canDo(userId: string, amount: number): Promise<boolean> {
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
