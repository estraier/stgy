import { Pool } from "pg";
import { pgQuery } from "../utils/servers";
import { hexToDec, decToHex, snakeToCamel } from "../utils/format";
import {
  AiPostSummary,
  ListAiPostSummariesInput,
  UpdateAiPostSummaryInput,
} from "../models/aiPost";

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
    const row = res.rows[0];
    row.post_id = decToHex(row.post_id);
    return snakeToCamel<AiPostSummary>(row);
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
    const rows = res.rows.map((r) => {
      r.post_id = decToHex(r.post_id);
      return r;
    });
    return snakeToCamel<AiPostSummary[]>(rows);
  }

  async updateAiPost(input: UpdateAiPostSummaryInput): Promise<AiPostSummary | null> {
    await pgQuery(this.pgPool, "BEGIN");
    try {
      if (input.summary !== undefined) {
        await pgQuery(
          this.pgPool,
          `
          INSERT INTO ai_post_summaries (post_id, summary)
          VALUES ($1, $2)
          ON CONFLICT (post_id) DO UPDATE SET summary = EXCLUDED.summary
          `,
          [hexToDec(input.postId), input.summary],
        );
      }
      if (input.tags !== undefined) {
        await pgQuery(this.pgPool, `DELETE FROM ai_post_tags WHERE post_id = $1`, [
          hexToDec(input.postId),
        ]);
        if (input.tags.length > 0) {
          await pgQuery(
            this.pgPool,
            `
            INSERT INTO ai_post_tags (post_id, name)
            SELECT $1, t
            FROM unnest($2::text[]) AS t
            `,
            [hexToDec(input.postId), input.tags],
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
