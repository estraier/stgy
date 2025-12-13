import { Pool } from "pg";
import { pgQuery } from "../utils/servers";
import { hexToDec, decToHex, snakeToCamel } from "../utils/format";
import {
  AiPostSummary,
  ListAiPostSummariesInput,
  UpdateAiPostSummaryInput,
} from "../models/aiPost";

type AiPostSummaryDbRow = {
  post_id: string;
  summary: string | null;
  features: Buffer | null;
  tags: string[];
};

function byteaToInt8Array(v: Buffer | null): Int8Array | null {
  if (!v) return null;
  return new Int8Array(v.buffer, v.byteOffset, v.byteLength);
}

function int8ArrayToBytea(v: Int8Array | null): Buffer | null {
  if (v === null) return null;
  return Buffer.from(v);
}

export class AiPostsService {
  private pgPool: Pool;

  constructor(pgPool: Pool) {
    this.pgPool = pgPool;
  }

  async getAiPostSummary(id: string): Promise<AiPostSummary | null> {
    const res = await pgQuery(
      this.pgPool,
      `
      SELECT
        aps.post_id,
        aps.summary,
        aps.features,
        ARRAY(
          SELECT apt.name
          FROM ai_post_tags apt
          WHERE apt.post_id = aps.post_id
          ORDER BY apt.name
        ) AS tags
      FROM ai_post_summaries aps
      WHERE aps.post_id = $1
      `,
      [hexToDec(id)],
    );
    if (res.rows.length === 0) return null;

    const row0 = res.rows[0] as unknown as AiPostSummaryDbRow;
    const row: AiPostSummaryDbRow = { ...row0, post_id: decToHex(row0.post_id) };

    const tmp = snakeToCamel<{
      postId: string;
      summary: string | null;
      features: Buffer | null;
      tags: string[];
    }>(row as unknown);

    return {
      postId: tmp.postId,
      summary: tmp.summary,
      features: byteaToInt8Array(tmp.features),
      tags: tmp.tags,
    };
  }

  async listAiPostsSummaries(options?: ListAiPostSummariesInput): Promise<AiPostSummary[]> {
    const offset = options?.offset ?? 0;
    const limit = options?.limit ?? 100;
    const orderDir = (options?.order ?? "asc").toLowerCase() === "desc" ? "DESC" : "ASC";
    const nullOnly = options?.nullOnly;
    const newerThan = options?.newerThan;

    let sql = `
      SELECT
        aps.post_id,
        aps.summary,
        aps.features,
        ARRAY(
          SELECT apt.name
          FROM ai_post_tags apt
          WHERE apt.post_id = aps.post_id
          ORDER BY apt.name
        ) AS tags
      FROM ai_post_summaries aps
    `;
    const where: string[] = [];
    const params: unknown[] = [];
    let idx = 1;

    if (nullOnly) {
      where.push("aps.summary IS NULL");
    }
    if (newerThan) {
      where.push(`id_to_timestamp(aps.post_id) > $${idx++}`);
      params.push(newerThan);
    }
    if (where.length > 0) {
      sql += " WHERE " + where.join(" AND ");
    }
    sql += ` ORDER BY aps.post_id ${orderDir} OFFSET $${idx++} LIMIT $${idx++}`;
    params.push(offset, limit);

    const res = await pgQuery(this.pgPool, sql, params);

    const out: AiPostSummary[] = [];
    for (const r0 of res.rows as unknown[]) {
      const r = r0 as unknown as AiPostSummaryDbRow;
      const row: AiPostSummaryDbRow = { ...r, post_id: decToHex(r.post_id) };

      const tmp = snakeToCamel<{
        postId: string;
        summary: string | null;
        features: Buffer | null;
        tags: string[];
      }>(row as unknown);

      out.push({
        postId: tmp.postId,
        summary: tmp.summary,
        features: byteaToInt8Array(tmp.features),
        tags: tmp.tags,
      });
    }
    return out;
  }

  async updateAiPost(input: UpdateAiPostSummaryInput): Promise<AiPostSummary | null> {
    await pgQuery(this.pgPool, "BEGIN");
    try {
      const postId = hexToDec(input.postId);

      if (input.summary !== undefined && input.features !== undefined) {
        await pgQuery(
          this.pgPool,
          `
          INSERT INTO ai_post_summaries (post_id, summary, features)
          VALUES ($1, $2, $3)
          ON CONFLICT (post_id) DO UPDATE
            SET summary = EXCLUDED.summary,
                features = EXCLUDED.features
          `,
          [postId, input.summary, int8ArrayToBytea(input.features)],
        );
      } else if (input.summary !== undefined) {
        await pgQuery(
          this.pgPool,
          `
          INSERT INTO ai_post_summaries (post_id, summary)
          VALUES ($1, $2)
          ON CONFLICT (post_id) DO UPDATE SET summary = EXCLUDED.summary
          `,
          [postId, input.summary],
        );
      } else if (input.features !== undefined) {
        await pgQuery(
          this.pgPool,
          `
          INSERT INTO ai_post_summaries (post_id, features)
          VALUES ($1, $2)
          ON CONFLICT (post_id) DO UPDATE SET features = EXCLUDED.features
          `,
          [postId, int8ArrayToBytea(input.features)],
        );
      }

      if (input.tags !== undefined) {
        await pgQuery(this.pgPool, `DELETE FROM ai_post_tags WHERE post_id = $1`, [postId]);
        if (input.tags.length > 0) {
          await pgQuery(
            this.pgPool,
            `
            INSERT INTO ai_post_tags (post_id, name)
            SELECT $1, t
            FROM unnest($2::text[]) AS t
            `,
            [postId, input.tags],
          );
        }
      }

      await pgQuery(this.pgPool, "COMMIT");
    } catch (e) {
      await pgQuery(this.pgPool, "ROLLBACK");
      throw e;
    }
    return this.getAiPostSummary(input.postId);
  }
}
