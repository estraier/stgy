import { Pool } from "pg";
import Redis from "ioredis";
import crypto from "crypto";
import type { SessionInfo } from "../models/session";
import { hexToDec, decToHex, checkPasswordHash } from "../utils/format";
import { pgQuery } from "../utils/servers";
import { Config } from "../config";

export type LoginResult = { sessionId: string; userId: string };

type LoginRow = {
  id: string;
  email: string;
  nickname: string;
  is_admin: boolean;
  created_at: string;
  updated_at: string | null;
  password: Uint8Array;
  locale: string;
  timezone: string;
  user_agreement_term_id: string | null;
  latest_agreement_term_id: string | null;
};

type SessionRefreshRow = {
  email: string;
  nickname: string;
  is_admin: boolean;
  created_at: string;
  updated_at: string | null;
  locale: string;
  timezone: string;
};

type SwitchUserRow = {
  id: string;
  email: string;
  nickname: string;
  is_admin: boolean;
  created_at: string;
  updated_at: string | null;
  locale: string;
  timezone: string;
  user_agreement_term_id: string | null;
  latest_agreement_term_id: string | null;
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
      `
      SELECT
        u.id,
        s.email,
        u.nickname,
        u.is_admin,
        id_to_timestamp(u.id) AS created_at,
        u.updated_at,
        s.password,
        u.locale,
        u.timezone,
        s.user_agreement_term_id,
        (
          SELECT id
          FROM user_agreement_terms
          ORDER BY id DESC
          LIMIT 1
        ) AS latest_agreement_term_id
      FROM users u
      JOIN user_secrets s ON s.user_id = u.id
      WHERE s.email = $1
      `,
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
      locale: userLocale,
      timezone: userTimezone,
      user_agreement_term_id: userAgreementTermId,
      latest_agreement_term_id: latestAgreementTermId,
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
      userLocale,
      userTimezone,
      loggedInAt: new Date().toISOString(),
      requiredAgreementTermId: getRequiredAgreementTermId(
        userAgreementTermId,
        latestAgreementTermId,
      ),
    };
    await this.redis.set(
      `session:${sessionId}`,
      JSON.stringify(sessionInfo),
      "EX",
      Config.SESSION_TTL,
    );
    return { sessionId, userId };
  }

  async loginAsAdmin(): Promise<LoginResult> {
    const result = await pgQuery<SwitchUserRow>(
      this.pgPool,
      `
      SELECT
        u.id,
        s.email,
        u.nickname,
        u.is_admin,
        id_to_timestamp(u.id) AS created_at,
        u.updated_at,
        u.locale,
        u.timezone,
        s.user_agreement_term_id,
        (
          SELECT id
          FROM user_agreement_terms
          ORDER BY id DESC
          LIMIT 1
        ) AS latest_agreement_term_id
      FROM users u
      JOIN user_secrets s ON s.user_id = u.id
      ORDER BY u.id ASC
      LIMIT 1
      `,
      [],
    );
    if (result.rows.length === 0) throw new Error("admin not found");
    const {
      id,
      email: userEmail,
      nickname: userNickname,
      is_admin: userIsAdmin,
      created_at: userCreatedAt,
      updated_at: userUpdatedAt,
      locale: userLocale,
      timezone: userTimezone,
      user_agreement_term_id: userAgreementTermId,
      latest_agreement_term_id: latestAgreementTermId,
    } = result.rows[0];
    if (!userIsAdmin) throw new Error("first user is not admin");
    const sessionId = crypto.randomBytes(32).toString("hex");
    const sessionInfo: SessionInfo = {
      userId: decToHex(id),
      userEmail,
      userNickname,
      userIsAdmin: !!userIsAdmin,
      userCreatedAt: new Date(userCreatedAt).toISOString(),
      userUpdatedAt: userUpdatedAt ? new Date(userUpdatedAt).toISOString() : null,
      userLocale,
      userTimezone,
      loggedInAt: new Date().toISOString(),
      requiredAgreementTermId: getRequiredAgreementTermId(
        userAgreementTermId,
        latestAgreementTermId,
      ),
    };
    await this.redis.set(
      `session:${sessionId}`,
      JSON.stringify(sessionInfo),
      "EX",
      Config.SESSION_TTL,
    );
    return { sessionId, userId: sessionInfo.userId };
  }

  async switchUser(userId: string): Promise<LoginResult> {
    const result = await pgQuery<SwitchUserRow>(
      this.pgPool,
      `
      SELECT
        u.id,
        s.email,
        u.nickname,
        u.is_admin,
        id_to_timestamp(u.id) AS created_at,
        u.updated_at,
        u.locale,
        u.timezone,
        s.user_agreement_term_id,
        (
          SELECT id
          FROM user_agreement_terms
          ORDER BY id DESC
          LIMIT 1
        ) AS latest_agreement_term_id
      FROM users u
      JOIN user_secrets s ON s.user_id = u.id
      WHERE u.id = $1
      `,
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
      locale: userLocale,
      timezone: userTimezone,
      user_agreement_term_id: userAgreementTermId,
      latest_agreement_term_id: latestAgreementTermId,
    } = result.rows[0];
    const sessionId = crypto.randomBytes(32).toString("hex");
    const sessionInfo: SessionInfo = {
      userId: decToHex(id),
      userEmail,
      userNickname,
      userIsAdmin: !!userIsAdmin,
      userCreatedAt: new Date(userCreatedAt).toISOString(),
      userUpdatedAt: userUpdatedAt ? new Date(userUpdatedAt).toISOString() : null,
      userLocale,
      userTimezone,
      loggedInAt: new Date().toISOString(),
      requiredAgreementTermId: getRequiredAgreementTermId(
        userAgreementTermId,
        latestAgreementTermId,
      ),
    };
    await this.redis.set(
      `session:${sessionId}`,
      JSON.stringify(sessionInfo),
      "EX",
      Config.SESSION_TTL,
    );
    return { sessionId, userId: sessionInfo.userId };
  }

  async getSessionInfo(sessionId: string): Promise<SessionInfo | null> {
    if (!sessionId) return null;
    const value = await this.redis.getex(
      `session:${sessionId}`,
      "EX",
      Config.SESSION_TTL,
    );
    if (!value) return null;
    try {
      const sessionInfo = JSON.parse(value) as SessionInfo;
      if (sessionInfo.requiredAgreementTermId === undefined) {
        sessionInfo.requiredAgreementTermId = null;
      }
      return sessionInfo;
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
      `
      SELECT
        s.email,
        u.nickname,
        u.is_admin,
        id_to_timestamp(u.id) AS created_at,
        u.updated_at,
        u.locale,
        u.timezone
      FROM users u
      JOIN user_secrets s ON s.user_id = u.id
      WHERE u.id = $1
      `,
      [hexToDec(current.userId)],
    );
    if (result.rows.length === 0) return null;
    const {
      email: userEmail,
      nickname: userNickname,
      is_admin: userIsAdmin,
      created_at: userCreatedAt,
      updated_at: userUpdatedAt,
      locale: userLocale,
      timezone: userTimezone,
    } = result.rows[0];
    const next: SessionInfo = {
      userId: current.userId,
      userEmail,
      userNickname,
      userIsAdmin: !!userIsAdmin,
      userCreatedAt: new Date(userCreatedAt).toISOString(),
      userUpdatedAt: userUpdatedAt ? new Date(userUpdatedAt).toISOString() : null,
      userLocale,
      userTimezone,
      loggedInAt: current.loggedInAt,
      requiredAgreementTermId: current.requiredAgreementTermId,
    };
    await this.redis.set(
      `session:${sessionId}`,
      JSON.stringify(next),
      "EX",
      Config.SESSION_TTL,
    );
    return next;
  }

  async clearRequiredAgreementTermId(sessionId: string): Promise<SessionInfo | null> {
    if (!sessionId) return null;
    const current = await this.getSessionInfo(sessionId);
    if (!current) return null;
    const next: SessionInfo = {
      ...current,
      requiredAgreementTermId: null,
    };
    await this.redis.set(
      `session:${sessionId}`,
      JSON.stringify(next),
      "EX",
      Config.SESSION_TTL,
    );
    return next;
  }

  async logout(sessionId: string): Promise<void> {
    if (sessionId) {
      await this.redis.del(`session:${sessionId}`);
    }
  }
}

function getRequiredAgreementTermId(
  userAgreementTermId: string | null | undefined,
  latestAgreementTermId: string | null | undefined,
): string | null {
  if (latestAgreementTermId === null || latestAgreementTermId === undefined) return null;
  if (userAgreementTermId === latestAgreementTermId) return null;
  return decToHex(latestAgreementTermId);
}
