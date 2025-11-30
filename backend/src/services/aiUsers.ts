import { Pool } from "pg";
import { pgQuery } from "../utils/servers";
import Redis from "ioredis";
import { decToHex, hexToDec } from "../utils/format";
import OpenAI from "openai";
import { Config } from "../config";
import type {
  AiUser,
  AiUserDetail,
  AiUserPagination,
  ChatRequest,
  ChatResponse,
  AiUserInterest,
  SetAiUserInterestInput,
  AiPeerImpression,
  ListAiPeerImpressionsInput,
  SetAiPeerImpressionInput,
  AiPostImpression,
  ListAiPostImpressionsInput,
  SetAiPostImpressionInput,
} from "../models/aiUser";

type RowList = {
  id: string;
  nickname: string;
  is_admin: boolean;
  ai_model: string | null;
};

type RowDetail = {
  id: string;
  nickname: string;
  is_admin: boolean;
  ai_model: string | null;
  created_at: Date;
  updated_at: Date | null;
  email: string;
  introduction: string;
  ai_personality: string | null;
};

type RowAiUserInterest = {
  user_id: string;
  description: string;
};

type RowAiPeerImpression = {
  user_id: string;
  peer_id: string;
  updated_at: Date;
  description: string;
};

type RowAiPostImpression = {
  user_id: string;
  post_id: string;
  updated_at: Date;
  description: string;
};

export class AiUsersService {
  private pgPool: Pool;
  private redis: Redis;
  private openai: OpenAI;

  constructor(pgPool: Pool, redis: Redis) {
    this.pgPool = pgPool;
    this.redis = redis;
    this.openai = new OpenAI({ apiKey: Config.OPENAI_API_KEY });
  }

  async listAiUsers(input: AiUserPagination = {}): Promise<AiUser[]> {
    const offset = Math.max(0, input.offset ?? 0);
    const limit = Math.min(Math.max(1, input.limit ?? 50), 200);
    const order = (input.order ?? "desc") === "asc" ? "ASC" : "DESC";
    const sql = `
      SELECT u.id, u.nickname, u.is_admin, u.ai_model
      FROM users u
      WHERE u.ai_model IS NOT NULL
      ORDER BY u.id ${order}
      LIMIT $1 OFFSET $2
    `;
    const res = await pgQuery<RowList>(this.pgPool, sql, [limit, offset]);
    return res.rows.map<AiUser>((r) => ({
      id: decToHex(String(r.id)),
      nickname: r.nickname,
      isAdmin: r.is_admin,
      aiModel: r.ai_model,
    }));
  }

  async getAiUser(id: string): Promise<AiUserDetail | null> {
    const userIdDec = hexToDec(id);
    const sql = `
      SELECT
        u.id,
        u.nickname,
        u.is_admin,
        u.ai_model,
        id_to_timestamp(u.id) AS created_at,
        u.updated_at,
        s.email,
        d.introduction,
        d.ai_personality
      FROM users u
      LEFT JOIN user_secrets s ON s.user_id = u.id
      LEFT JOIN user_details d ON d.user_id = u.id
      WHERE u.id = $1
        AND u.ai_model IS NOT NULL
      LIMIT 1
    `;
    const res = await pgQuery<RowDetail>(this.pgPool, sql, [userIdDec]);
    if (res.rowCount === 0) return null;
    const r = res.rows[0];
    const createdAtISO =
      r.created_at instanceof Date
        ? r.created_at.toISOString()
        : new Date(r.created_at as unknown as string).toISOString();
    const updatedAtISO = r.updated_at
      ? r.updated_at instanceof Date
        ? r.updated_at.toISOString()
        : new Date(r.updated_at as unknown as string).toISOString()
      : null;
    const base: AiUser = {
      id: decToHex(String(r.id)),
      nickname: r.nickname,
      isAdmin: r.is_admin,
      aiModel: r.ai_model,
    };
    const detail: AiUserDetail = {
      ...base,
      email: r.email,
      createdAt: createdAtISO,
      updatedAt: updatedAtISO,
      introduction: r.introduction,
      aiPersonality: r.ai_personality ?? "",
    };
    return detail;
  }

  async chat(req: ChatRequest): Promise<ChatResponse> {
    const res = await pgQuery<{
      label: string;
      service: string;
      name: string;
    }>(this.pgPool, `SELECT label, service, name FROM ai_models WHERE label = $1`, [req.model]);
    if (res.rowCount === 0) {
      throw new Error("no such model");
    }
    const model_service = res.rows[0].service;
    const model_name = res.rows[0].name;
    if (model_service === "openai") {
      const r = await this.openai.chat.completions.create(
        {
          model: model_name,
          messages: req.messages,
          service_tier: "flex",
        },
        {
          timeout: 60_000,
        },
      );
      return {
        message: {
          content: r.choices[0]?.message?.content ?? "",
        },
      };
    }
    throw new Error("unsupported service");
  }

  async getAiUserInterest(userId: string): Promise<AiUserInterest | null> {
    const userIdDec = hexToDec(userId);
    const sql = `
      SELECT user_id, description
      FROM ai_interests
      WHERE user_id = $1
      LIMIT 1
    `;
    const res = await pgQuery<RowAiUserInterest>(this.pgPool, sql, [userIdDec]);
    if (res.rowCount === 0) return null;
    const row = res.rows[0];
    return {
      userId: decToHex(String(row.user_id)),
      description: row.description,
    };
  }

  async setAiUserInterest(input: SetAiUserInterestInput): Promise<AiUserInterest> {
    const userIdDec = hexToDec(input.userId);
    const sql = `
      INSERT INTO ai_interests (user_id, description)
      VALUES ($1, $2)
      ON CONFLICT (user_id)
      DO UPDATE SET description = EXCLUDED.description
      RETURNING user_id, description
    `;
    const res = await pgQuery<RowAiUserInterest>(this.pgPool, sql, [userIdDec, input.description]);
    const row = res.rows[0];
    return {
      userId: decToHex(String(row.user_id)),
      description: row.description,
    };
  }

  async listAiPeerImpressions(
    userId: string,
    input: ListAiPeerImpressionsInput = {},
  ): Promise<AiPeerImpression[]> {
    const userIdDec = hexToDec(userId);
    const offset = Math.max(0, input.offset ?? 0);
    const limit = Math.min(Math.max(1, input.limit ?? 50), 200);
    const order = (input.order ?? "desc") === "asc" ? "ASC" : "DESC";
    const peerId = input.peerId;
    const sql = `
      SELECT user_id, peer_id, updated_at, description
      FROM ai_peer_impressions
      WHERE user_id = $1
      ${peerId ? "AND peer_id = $4" : ""}
      ORDER BY updated_at ${order}, peer_id ${order}
      LIMIT $2 OFFSET $3
    `;
    const params: unknown[] = [userIdDec, limit, offset];
    if (peerId) {
      params.push(hexToDec(peerId));
    }
    const res = await pgQuery<RowAiPeerImpression>(this.pgPool, sql, params);
    return res.rows.map<AiPeerImpression>((row) => {
      const updatedAtISO =
        row.updated_at instanceof Date
          ? row.updated_at.toISOString()
          : new Date(row.updated_at as unknown as string).toISOString();
      return {
        userId: decToHex(String(row.user_id)),
        peerId: decToHex(String(row.peer_id)),
        updatedAt: updatedAtISO,
        description: row.description,
      };
    });
  }

  async getAiPeerImpression(userId: string, peerId: string): Promise<AiPeerImpression | null> {
    const userIdDec = hexToDec(userId);
    const peerIdDec = hexToDec(peerId);
    const sql = `
      SELECT user_id, peer_id, updated_at, description
      FROM ai_peer_impressions
      WHERE user_id = $1
        AND peer_id = $2
      LIMIT 1
    `;
    const res = await pgQuery<RowAiPeerImpression>(this.pgPool, sql, [userIdDec, peerIdDec]);
    if (res.rowCount === 0) return null;
    const row = res.rows[0];
    const updatedAtISO =
      row.updated_at instanceof Date
        ? row.updated_at.toISOString()
        : new Date(row.updated_at as unknown as string).toISOString();
    return {
      userId: decToHex(String(row.user_id)),
      peerId: decToHex(String(row.peer_id)),
      updatedAt: updatedAtISO,
      description: row.description,
    };
  }

  async setAiPeerImpression(input: SetAiPeerImpressionInput): Promise<AiPeerImpression> {
    const userIdDec = hexToDec(input.userId);
    const peerIdDec = hexToDec(input.peerId);
    const sql = `
      INSERT INTO ai_peer_impressions (user_id, peer_id, updated_at, description)
      VALUES ($1, $2, now(), $3)
      ON CONFLICT (user_id, peer_id)
      DO UPDATE SET updated_at = now(), description = EXCLUDED.description
      RETURNING user_id, peer_id, updated_at, description
    `;
    const res = await pgQuery<RowAiPeerImpression>(this.pgPool, sql, [
      userIdDec,
      peerIdDec,
      input.description,
    ]);
    const row = res.rows[0];
    const updatedAtISO =
      row.updated_at instanceof Date
        ? row.updated_at.toISOString()
        : new Date(row.updated_at as unknown as string).toISOString();
    return {
      userId: decToHex(String(row.user_id)),
      peerId: decToHex(String(row.peer_id)),
      updatedAt: updatedAtISO,
      description: row.description,
    };
  }

  async listAiPostImpressions(
    userId: string,
    input: ListAiPostImpressionsInput = {},
  ): Promise<AiPostImpression[]> {
    const userIdDec = hexToDec(userId);
    const offset = Math.max(0, input.offset ?? 0);
    const limit = Math.min(Math.max(1, input.limit ?? 50), 200);
    const order = (input.order ?? "desc") === "asc" ? "ASC" : "DESC";
    const postId = input.postId;
    const sql = `
      SELECT user_id, post_id, updated_at, description
      FROM ai_post_impressions
      WHERE user_id = $1
      ${postId ? "AND post_id = $4" : ""}
      ORDER BY updated_at ${order}, post_id ${order}
      LIMIT $2 OFFSET $3
    `;
    const params: unknown[] = [userIdDec, limit, offset];
    if (postId) {
      params.push(hexToDec(postId));
    }
    const res = await pgQuery<RowAiPostImpression>(this.pgPool, sql, params);
    return res.rows.map<AiPostImpression>((row) => {
      const updatedAtISO =
        row.updated_at instanceof Date
          ? row.updated_at.toISOString()
          : new Date(row.updated_at as unknown as string).toISOString();
      return {
        userId: decToHex(String(row.user_id)),
        postId: decToHex(String(row.post_id)),
        updatedAt: updatedAtISO,
        description: row.description,
      };
    });
  }

  async getAiPostImpression(userId: string, postId: string): Promise<AiPostImpression | null> {
    const userIdDec = hexToDec(userId);
    const postIdDec = hexToDec(postId);
    const sql = `
      SELECT user_id, post_id, updated_at, description
      FROM ai_post_impressions
      WHERE user_id = $1
        AND post_id = $2
      LIMIT 1
    `;
    const res = await pgQuery<RowAiPostImpression>(this.pgPool, sql, [userIdDec, postIdDec]);
    if (res.rowCount === 0) return null;
    const row = res.rows[0];
    const updatedAtISO =
      row.updated_at instanceof Date
        ? row.updated_at.toISOString()
        : new Date(row.updated_at as unknown as string).toISOString();
    return {
      userId: decToHex(String(row.user_id)),
      postId: decToHex(String(row.post_id)),
      updatedAt: updatedAtISO,
      description: row.description,
    };
  }

  async setAiPostImpression(input: SetAiPostImpressionInput): Promise<AiPostImpression> {
    const userIdDec = hexToDec(input.userId);
    const postIdDec = hexToDec(input.postId);
    const sql = `
      INSERT INTO ai_post_impressions (user_id, post_id, updated_at, description)
      VALUES ($1, $2, now(), $3)
      ON CONFLICT (user_id, post_id)
      DO UPDATE SET updated_at = now(), description = EXCLUDED.description
      RETURNING user_id, post_id, updated_at, description
    `;
    const res = await pgQuery<RowAiPostImpression>(this.pgPool, sql, [
      userIdDec,
      postIdDec,
      input.description,
    ]);
    const row = res.rows[0];
    const updatedAtISO =
      row.updated_at instanceof Date
        ? row.updated_at.toISOString()
        : new Date(row.updated_at as unknown as string).toISOString();
    return {
      userId: decToHex(String(row.user_id)),
      postId: decToHex(String(row.post_id)),
      updatedAt: updatedAtISO,
      description: row.description,
    };
  }
}
