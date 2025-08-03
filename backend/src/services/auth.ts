import { Client } from "pg";
import Redis from "ioredis";
import crypto from "crypto";
import type { SessionInfo } from "../models/session";

export type LoginResult = { sessionId: string; userId: string };

const SESSION_TTL = 60 * 60 * 24;

export class AuthService {
  private pgClient: Client;
  private redis: Redis;

  constructor(pgClient: Client, redis: Redis) {
    this.pgClient = pgClient;
    this.redis = redis;
  }

  async login(email: string, password: string): Promise<LoginResult> {
    const result = await this.pgClient.query(
      "SELECT id, email, nickname, is_admin FROM users WHERE email=$1 AND password=md5($2)",
      [email, password],
    );
    if (result.rows.length === 0) throw new Error("authentication failed");
    const { id, email: userEmail, nickname: userNickname, is_admin: userIsAdmin } = result.rows[0];
    const userId = id;
    const sessionId = crypto.randomBytes(32).toString("hex");
    const sessionInfo: SessionInfo = {
      userId,
      userEmail,
      userNickname,
      userIsAdmin,
      loggedInAt: new Date().toISOString(),
    };
    await this.redis.set(`session:${sessionId}`, JSON.stringify(sessionInfo), "EX", SESSION_TTL);
    return { sessionId, userId };
  }

  async getSessionInfo(sessionId: string): Promise<SessionInfo | null> {
    if (!sessionId) return null;
    const value = await this.redis.getex(`session:${sessionId}`, "EX", SESSION_TTL);
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
