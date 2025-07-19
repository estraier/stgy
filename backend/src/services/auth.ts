import { Client } from "pg";
import Redis from "ioredis";
import crypto from "crypto";

export type SessionInfo = {
  userId: string;
  email: string;
  loggedInAt: string;
};

export type LoginResult = { sessionId: string; userId: string };

export class AuthService {
  private pgClient: Client;
  private redis: Redis;

  constructor(pgClient: Client, redis: Redis) {
    this.pgClient = pgClient;
    this.redis = redis;
  }

  async login(email: string, password: string): Promise<LoginResult> {
    const result = await this.pgClient.query(
      "SELECT id, email FROM users WHERE email=$1 AND password=md5($2)",
      [email, password],
    );
    if (result.rows.length === 0) throw new Error("authentication failed");
    const { id: userId, email: userEmail } = result.rows[0];
    const sessionId = crypto.randomBytes(32).toString("hex");
    const sessionInfo: SessionInfo = {
      userId,
      email: userEmail,
      loggedInAt: new Date().toISOString(),
    };
    await this.redis.set(`session:${sessionId}`, JSON.stringify(sessionInfo), "EX", 3600);
    return { sessionId, userId };
  }

  async getSessionInfo(sessionId: string): Promise<SessionInfo | null> {
    if (!sessionId) return null;
    const value = await this.redis.get(`session:${sessionId}`);
    if (!value) return null;
    try {
      return JSON.parse(value) as SessionInfo;
    } catch {
      return null;
    }
  }

  async logout(sessionId: string): Promise<void> {
    if (sessionId) {
      await this.redis.del(`session:${sessionId}`);
    }
  }
}
