import type Redis from "ioredis";

export class ThrottleService {
  private redis: Redis;
  private actionId: string;
  private periodMs: number;
  private limitCount: number;

  constructor(redis: Redis, actionId: string, periodInSec: number, limitCount: number) {
    this.redis = redis;
    this.actionId = actionId;
    this.periodMs = Math.max(1, Math.floor(periodInSec * 1000));
    this.limitCount = limitCount;
  }

  private key(userId: string): string {
    if (!userId || userId.trim() === "") {
      throw new Error("userId is required");
    }
    return `throttle:${this.actionId}:${userId}:history`;
  }

  async canDo(userId: string): Promise<boolean> {
    const key = this.key(userId);
    const now = Date.now();
    const cutoff = now - this.periodMs;
    const results = await this.redis
      .multi()
      .zremrangebyscore(key, 0, cutoff)
      .pexpire(key, this.periodMs + 1000)
      .zcard(key)
      .exec();
    const count = Number(results?.[2]?.[1] ?? 0);
    return count < this.limitCount;
  }

  async recordDone(userId: string): Promise<void> {
    const key = this.key(userId);
    const now = Date.now();
    const member = `${now}:${Math.random().toString(36).slice(2, 10)}`;
    await this.redis
      .multi()
      .zadd(key, now, member)
      .zremrangebyscore(key, 0, now - this.periodMs - 1000)
      .pexpire(key, this.periodMs + 1000)
      .exec();
  }
}
