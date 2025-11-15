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
    }>(
      this.pgPool,
      `SELECT label, service, name FROM ai_models WHERE label = $1`,
      [req.model],
    );
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
}
