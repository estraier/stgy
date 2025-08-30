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
      "SELECT id, email, nickname, is_admin, updated_at FROM users WHERE email=$1 AND password=md5($2)",
      [email, password],
    );
    if (result.rows.length === 0) throw new Error("authentication failed");
    const {
      id,
      email: userEmail,
      nickname: userNickname,
      is_admin: userIsAdmin,
      updated_at: userUpdatedAt,
    } = result.rows[0];
    const userId = id;
    const sessionId = crypto.randomBytes(32).toString("hex");
    const sessionInfo: SessionInfo = {
      userId,
      userEmail,
      userNickname,
      userIsAdmin,
      userUpdatedAt: userUpdatedAt ? new Date(userUpdatedAt).toISOString() : null,
      loggedInAt: new Date().toISOString(),
    };
    await this.redis.set(`session:${sessionId}`, JSON.stringify(sessionInfo), "EX", SESSION_TTL);
    return { sessionId, userId };
  }

  async switchUser(userId: string): Promise<LoginResult> {
    const result = await this.pgClient.query(
      "SELECT id, email, nickname, is_admin, updated_at FROM users WHERE id=$1",
      [userId],
    );
    if (result.rows.length === 0) throw new Error("user not found");
    const {
      id,
      email: userEmail,
      nickname: userNickname,
      is_admin: userIsAdmin,
      updated_at: userUpdatedAt,
    } = result.rows[0];
    const sessionId = crypto.randomBytes(32).toString("hex");
    const sessionInfo: SessionInfo = {
      userId: id,
      userEmail,
      userNickname,
      userIsAdmin: !!userIsAdmin,
      userUpdatedAt: userUpdatedAt ? new Date(userUpdatedAt).toISOString() : null,
      loggedInAt: new Date().toISOString(),
    };
    await this.redis.set(`session:${sessionId}`, JSON.stringify(sessionInfo), "EX", SESSION_TTL);
    return { sessionId, userId: id };
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

  async refreshSessionInfo(sessionId: string): Promise<SessionInfo | null> {
    if (!sessionId) return null;
    const current = await this.getSessionInfo(sessionId);
    if (!current) return null;
    const result = await this.pgClient.query(
      "SELECT email, nickname, is_admin, updated_at FROM users WHERE id=$1",
      [current.userId],
    );
    if (result.rows.length === 0) return null;
    const {
      email: userEmail,
      nickname: userNickname,
      is_admin: userIsAdmin,
      updated_at: userUpdatedAt,
    } = result.rows[0];
    const next: SessionInfo = {
      userId: current.userId,
      userEmail,
      userNickname,
      userIsAdmin: !!userIsAdmin,
      userUpdatedAt: userUpdatedAt ? new Date(userUpdatedAt).toISOString() : null,
      loggedInAt: current.loggedInAt,
    };
    await this.redis.set(`session:${sessionId}`, JSON.stringify(next), "EX", SESSION_TTL);
    return next;
  }

  async logout(sessionId: string): Promise<void> {
    if (sessionId) {
      await this.redis.del(`session:${sessionId}`);
    }
  }
}
