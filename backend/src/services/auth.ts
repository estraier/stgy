import { Pool } from "pg";
import Redis from "ioredis";
import crypto from "crypto";
import type { SessionInfo } from "../models/session";
import { hexToDec, decToHex, checkPasswordHash } from "../utils/format";
import { pgQuery } from "../utils/servers";

export type LoginResult = { sessionId: string; userId: string };

const SESSION_TTL = 60 * 60 * 24;

type LoginRow = {
  id: string;
  email: string;
  nickname: string;
  is_admin: boolean;
  created_at: string;
  updated_at: string | null;
  password: Uint8Array;
};

type SessionRefreshRow = {
  email: string;
  nickname: string;
  is_admin: boolean;
  created_at: string;
  updated_at: string | null;
};

type SwitchUserRow = {
  id: string;
  email: string;
  nickname: string;
  is_admin: boolean;
  created_at: string;
  updated_at: string | null;
};

export class AuthService {
  private pgPool: Pool;
  private redis: Redis;

  constructor(pgPool: Pool, redis: Redis) {
    this.pgPool = pgPool;
    this.redis = redis;
  }

  async login(email: string, password: string): Promise<LoginResult> {
    const result = await pgQuery<LoginRow>(
      this.pgPool,
      `SELECT
         id,
         email,
         nickname,
         is_admin,
         id_to_timestamp(id) AS created_at,
         updated_at,
         password
       FROM users
       WHERE email=$1`,
      [email],
    );
    if (result.rows.length === 0) throw new Error("authentication failed");
    const row = result.rows[0];

    const ok = await checkPasswordHash(password, row.password);
    if (!ok) throw new Error("authentication failed");

    const {
      id,
      email: userEmail,
      nickname: userNickname,
      is_admin: userIsAdmin,
      created_at: userCreatedAt,
      updated_at: userUpdatedAt,
    } = row;

    const userId = decToHex(id);
    const sessionId = crypto.randomBytes(32).toString("hex");
    const sessionInfo: SessionInfo = {
      userId,
      userEmail,
      userNickname,
      userIsAdmin: !!userIsAdmin,
      userCreatedAt: new Date(userCreatedAt).toISOString(),
      userUpdatedAt: userUpdatedAt ? new Date(userUpdatedAt).toISOString() : null,
      loggedInAt: new Date().toISOString(),
    };
    await this.redis.set(`session:${sessionId}`, JSON.stringify(sessionInfo), "EX", SESSION_TTL);
    return { sessionId, userId };
  }

  async switchUser(userId: string): Promise<LoginResult> {
    const result = await pgQuery<SwitchUserRow>(
      this.pgPool,
      `SELECT
         id,
         email,
         nickname,
         is_admin,
         id_to_timestamp(id) AS created_at,
         updated_at
       FROM users
       WHERE id=$1`,
      [hexToDec(userId)],
    );
    if (result.rows.length === 0) throw new Error("user not found");
    const {
      id,
      email: userEmail,
      nickname: userNickname,
      is_admin: userIsAdmin,
      created_at: userCreatedAt,
      updated_at: userUpdatedAt,
    } = result.rows[0];

    const sessionId = crypto.randomBytes(32).toString("hex");
    const sessionInfo: SessionInfo = {
      userId: decToHex(id),
      userEmail,
      userNickname,
      userIsAdmin: !!userIsAdmin,
      userCreatedAt: new Date(userCreatedAt).toISOString(),
      userUpdatedAt: userUpdatedAt ? new Date(userUpdatedAt).toISOString() : null,
      loggedInAt: new Date().toISOString(),
    };
    await this.redis.set(`session:${sessionId}`, JSON.stringify(sessionInfo), "EX", SESSION_TTL);
    return { sessionId, userId: sessionInfo.userId };
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

    const result = await pgQuery<SessionRefreshRow>(
      this.pgPool,
      `SELECT
         email,
         nickname,
         is_admin,
         id_to_timestamp(id) AS created_at,
         updated_at
       FROM users
       WHERE id=$1`,
      [hexToDec(current.userId)],
    );
    if (result.rows.length === 0) return null;

    const {
      email: userEmail,
      nickname: userNickname,
      is_admin: userIsAdmin,
      created_at: userCreatedAt,
      updated_at: userUpdatedAt,
    } = result.rows[0];

    const next: SessionInfo = {
      userId: current.userId,
      userEmail,
      userNickname,
      userIsAdmin: !!userIsAdmin,
      userCreatedAt: new Date(userCreatedAt).toISOString(),
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
