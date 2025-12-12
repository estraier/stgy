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
  payload: string;
};

type RowAiPeerImpression = {
  user_id: string;
  peer_id: string;
  payload: string;
};

type RowAiPostImpression = {
  user_id: string;
  peer_id: string;
  post_id: string;
  payload: string;
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
          timeout: 600_000,
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
      SELECT user_id, payload
      FROM ai_interests
      WHERE user_id = $1
      LIMIT 1
    `;
    const res = await pgQuery<RowAiUserInterest>(this.pgPool, sql, [userIdDec]);
    if (res.rowCount === 0) return null;
    const row = res.rows[0];
    return {
      userId: decToHex(String(row.user_id)),
      payload: row.payload,
    };
  }

  async setAiUserInterest(input: SetAiUserInterestInput): Promise<AiUserInterest> {
    const userIdDec = hexToDec(input.userId);
    const sql = `
      INSERT INTO ai_interests (user_id, payload)
      VALUES ($1, $2)
      ON CONFLICT (user_id)
      DO UPDATE SET payload = EXCLUDED.payload
      RETURNING user_id, payload
    `;
    const res = await pgQuery<RowAiUserInterest>(this.pgPool, sql, [userIdDec, input.payload]);
    const row = res.rows[0];
    return {
      userId: decToHex(String(row.user_id)),
      payload: row.payload,
    };
  }

  async listAiPeerImpressions(input: ListAiPeerImpressionsInput = {}): Promise<AiPeerImpression[]> {
    const offset = Math.max(0, input.offset ?? 0);
    const limit = Math.min(Math.max(1, input.limit ?? 50), 200);
    const order = (input.order ?? "desc") === "asc" ? "ASC" : "DESC";

    const where: string[] = [];
    const params: unknown[] = [];
    let idx = 1;

    if (input.userId) {
      where.push(`user_id = $${idx}`);
      params.push(hexToDec(input.userId));
      idx++;
    }
    if (input.peerId) {
      where.push(`peer_id = $${idx}`);
      params.push(hexToDec(input.peerId));
      idx++;
    }

    let sql = `
      SELECT user_id, peer_id, payload
      FROM ai_peer_impressions
    `;
    if (where.length > 0) {
      sql += ` WHERE ${where.join(" AND ")}`;
    }
    sql += ` ORDER BY user_id ${order}, peer_id ${order}
      LIMIT $${idx} OFFSET $${idx + 1}
    `;
    params.push(limit, offset);

    const res = await pgQuery<RowAiPeerImpression>(this.pgPool, sql, params);
    return res.rows.map<AiPeerImpression>((row) => ({
      userId: decToHex(String(row.user_id)),
      peerId: decToHex(String(row.peer_id)),
      payload: row.payload,
    }));
  }

  async checkAiPeerImpression(userId: string, peerId: string): Promise<boolean> {
    const userIdDec = hexToDec(userId);
    const peerIdDec = hexToDec(peerId);
    const sql = `
      SELECT 1
      FROM ai_peer_impressions
      WHERE user_id = $1
        AND peer_id = $2
      LIMIT 1
    `;
    const res = await pgQuery(this.pgPool, sql, [userIdDec, peerIdDec]);
    return (res.rowCount ?? 0) > 0;
  }

  async getAiPeerImpression(userId: string, peerId: string): Promise<AiPeerImpression | null> {
    const userIdDec = hexToDec(userId);
    const peerIdDec = hexToDec(peerId);
    const sql = `
      SELECT user_id, peer_id, payload
      FROM ai_peer_impressions
      WHERE user_id = $1
        AND peer_id = $2
      LIMIT 1
    `;
    const res = await pgQuery<RowAiPeerImpression>(this.pgPool, sql, [userIdDec, peerIdDec]);
    if (res.rowCount === 0) return null;
    const row = res.rows[0];
    return {
      userId: decToHex(String(row.user_id)),
      peerId: decToHex(String(row.peer_id)),
      payload: row.payload,
    };
  }

  async setAiPeerImpression(input: SetAiPeerImpressionInput): Promise<AiPeerImpression> {
    const userIdDec = hexToDec(input.userId);
    const peerIdDec = hexToDec(input.peerId);
    const sql = `
      INSERT INTO ai_peer_impressions (user_id, peer_id, payload)
      VALUES ($1, $2, $3)
      ON CONFLICT (user_id, peer_id)
      DO UPDATE SET payload = EXCLUDED.payload
      RETURNING user_id, peer_id, payload
    `;
    const res = await pgQuery<RowAiPeerImpression>(this.pgPool, sql, [
      userIdDec,
      peerIdDec,
      input.payload,
    ]);
    const row = res.rows[0];
    return {
      userId: decToHex(String(row.user_id)),
      peerId: decToHex(String(row.peer_id)),
      payload: row.payload,
    };
  }

  async listAiPostImpressions(input: ListAiPostImpressionsInput = {}): Promise<AiPostImpression[]> {
    const offset = Math.max(0, input.offset ?? 0);
    const limit = Math.min(Math.max(1, input.limit ?? 50), 200);
    const order = (input.order ?? "desc") === "asc" ? "ASC" : "DESC";

    const where: string[] = [];
    const params: unknown[] = [];
    let idx = 1;

    const hasUserId = !!input.userId;
    const hasPeerId = !!input.peerId;
    const hasPostId = !!input.postId;

    if (hasUserId) {
      where.push(`user_id = $${idx}`);
      params.push(hexToDec(input.userId as string));
      idx++;
    }
    if (hasPeerId) {
      where.push(`peer_id = $${idx}`);
      params.push(hexToDec(input.peerId as string));
      idx++;
    }
    if (hasPostId) {
      where.push(`post_id = $${idx}`);
      params.push(hexToDec(input.postId as string));
      idx++;
    }

    let sql = `
      SELECT user_id, peer_id, post_id, payload
      FROM ai_post_impressions
    `;
    if (where.length > 0) {
      sql += ` WHERE ${where.join(" AND ")}`;
    }

    const usePostIdOrder = hasUserId && hasPeerId && !hasPostId;
    if (usePostIdOrder) {
      sql += ` ORDER BY post_id ${order}`;
    } else {
      sql += ` ORDER BY user_id ${order}, peer_id ${order}, post_id ${order}`;
    }

    sql += ` LIMIT $${idx} OFFSET $${idx + 1}`;
    params.push(limit, offset);

    const res = await pgQuery<RowAiPostImpression>(this.pgPool, sql, params);
    return res.rows.map<AiPostImpression>((row) => ({
      userId: decToHex(String(row.user_id)),
      peerId: decToHex(String(row.peer_id)),
      postId: decToHex(String(row.post_id)),
      payload: row.payload,
    }));
  }

  async checkAiPostImpression(userId: string, postId: string): Promise<boolean> {
    const userIdDec = hexToDec(userId);
    const postIdDec = hexToDec(postId);
    const sql = `
      SELECT 1
      FROM ai_post_impressions
      WHERE user_id = $1
        AND post_id = $2
      LIMIT 1
    `;
    const res = await pgQuery(this.pgPool, sql, [userIdDec, postIdDec]);
    return (res.rowCount ?? 0) > 0;
  }

  async getAiPostImpression(userId: string, postId: string): Promise<AiPostImpression | null> {
    const userIdDec = hexToDec(userId);
    const postIdDec = hexToDec(postId);
    const sql = `
      SELECT user_id, peer_id, post_id, payload
      FROM ai_post_impressions
      WHERE user_id = $1
        AND post_id = $2
      LIMIT 1
    `;
    const res = await pgQuery<RowAiPostImpression>(this.pgPool, sql, [userIdDec, postIdDec]);
    if (res.rowCount === 0) return null;
    const row = res.rows[0];
    return {
      userId: decToHex(String(row.user_id)),
      peerId: decToHex(String(row.peer_id)),
      postId: decToHex(String(row.post_id)),
      payload: row.payload,
    };
  }

  async setAiPostImpression(input: SetAiPostImpressionInput): Promise<AiPostImpression> {
    const userIdDec = hexToDec(input.userId);
    const postIdDec = hexToDec(input.postId);

    const postRes = await pgQuery<{ owned_by: string | number | bigint }>(
      this.pgPool,
      `
      SELECT owned_by
      FROM posts
      WHERE id = $1
      `,
      [postIdDec],
    );
    if (postRes.rowCount === 0) {
      throw new Error("post not found");
    }
    const peerIdDec = postRes.rows[0].owned_by;

    const sql = `
      INSERT INTO ai_post_impressions (user_id, peer_id, post_id, payload)
      VALUES ($1, $2, $3, $4)
      ON CONFLICT (user_id, peer_id, post_id)
      DO UPDATE SET payload = EXCLUDED.payload
      RETURNING user_id, peer_id, post_id, payload
    `;
    const res = await pgQuery<RowAiPostImpression>(this.pgPool, sql, [
      userIdDec,
      peerIdDec,
      postIdDec,
      input.payload,
    ]);
    const row = res.rows[0];
    return {
      userId: decToHex(String(row.user_id)),
      peerId: decToHex(String(row.peer_id)),
      postId: decToHex(String(row.post_id)),
      payload: row.payload,
    };
  }
}
