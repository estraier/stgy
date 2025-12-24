import { Pool } from "pg";
import { pgQuery } from "../utils/servers";
import { hexToDec, decToHex, snakeToCamel } from "../utils/format";
import {
  AiPostSummary,
  ListAiPostSummariesInput,
  RecommendPostsByTagsInput,
  UpdateAiPostSummaryInput,
} from "../models/aiPost";

type AiPostSummaryDbRow = {
  post_id: string;
  updated_at: string;
  summary: string | null;
  features: Buffer | null;
  tags: string[];
};

type RecommendByTagsDbRow = {
  post_id: string;
  tag: string;
  is_root: boolean;
};

type RecommendRecord = {
  postId: bigint;
  tag: string;
  isRoot: boolean;
};

type ScoredPost = {
  postId: bigint;
  score: number;
};

function byteaToInt8Array(v: Buffer | null): Int8Array | null {
  if (!v) return null;
  return new Int8Array(v.buffer, v.byteOffset, v.byteLength);
}

function int8ArrayToBytea(v: Int8Array | null): Buffer | null {
  if (v === null) return null;
  return Buffer.from(v);
}

const compareBigIntDesc = (a: bigint, b: bigint): number => (a === b ? 0 : a > b ? -1 : 1);

export class AiPostsService {
  private pgPool: Pool;

  constructor(pgPool: Pool) {
    this.pgPool = pgPool;
  }

  async checkAiPostSummary(id: string): Promise<boolean> {
    const res = await pgQuery(
      this.pgPool,
      `
      SELECT 1
      FROM ai_post_summaries aps
      WHERE aps.post_id = $1 and aps.summary IS NOT NULL
      LIMIT 1
      `,
      [hexToDec(id)],
    );
    return res.rows.length > 0;
  }

  async getAiPostSummary(id: string): Promise<AiPostSummary | null> {
    const res = await pgQuery(
      this.pgPool,
      `
      SELECT
        aps.post_id,
        aps.updated_at,
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
      updatedAt: string;
      summary: string | null;
      features: Buffer | null;
      tags: string[];
    }>(row as unknown);

    return {
      postId: tmp.postId,
      updatedAt: tmp.updatedAt,
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
        aps.updated_at,
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
      where.push(`aps.updated_at > $${idx++}`);
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
        updatedAt: string;
        summary: string | null;
        features: Buffer | null;
        tags: string[];
      }>(row as unknown);

      out.push({
        postId: tmp.postId,
        updatedAt: tmp.updatedAt,
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
          INSERT INTO ai_post_summaries (post_id, summary, features, updated_at)
          VALUES ($1, $2, $3, now())
          ON CONFLICT (post_id) DO UPDATE
            SET summary = EXCLUDED.summary,
                features = EXCLUDED.features,
                updated_at = now()
          `,
          [postId, input.summary, int8ArrayToBytea(input.features)],
        );
      } else if (input.summary !== undefined) {
        await pgQuery(
          this.pgPool,
          `
          INSERT INTO ai_post_summaries (post_id, summary, updated_at)
          VALUES ($1, $2, now())
          ON CONFLICT (post_id) DO UPDATE SET summary = EXCLUDED.summary, updated_at = now()
          `,
          [postId, input.summary],
        );
      } else if (input.features !== undefined) {
        await pgQuery(
          this.pgPool,
          `
          INSERT INTO ai_post_summaries (post_id, features, updated_at)
          VALUES ($1, $2, now())
          ON CONFLICT (post_id) DO UPDATE SET features = EXCLUDED.features, updated_at = now()
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

  async RecommendPostsByTags(input: RecommendPostsByTagsInput): Promise<string[]> {
    const offset = input.offset ?? 0;
    const limit = input.limit ?? 100;
    const order = (input.order ?? "desc").toLowerCase() === "asc" ? "asc" : "desc";

    if (input.tags.length === 0) return [];

    const res = await pgQuery(
      this.pgPool,
      `
      WITH query_tags(tag) AS (
        SELECT unnest($1::text[])
      ),
      matched_tag_posts AS (
        SELECT qt.tag, pt.post_id
        FROM query_tags qt
        JOIN LATERAL (
          SELECT post_id
          FROM post_tags
          WHERE name = qt.tag
          ORDER BY post_id DESC
          LIMIT 100
        ) pt ON true

        UNION ALL

        SELECT qt.tag, apt.post_id
        FROM query_tags qt
        JOIN LATERAL (
          SELECT post_id
          FROM ai_post_tags
          WHERE name = qt.tag
          ORDER BY post_id DESC
          LIMIT 100
        ) apt ON true
      )
      SELECT
        mtp.post_id,
        mtp.tag,
        (p.reply_to IS NULL) AS is_root
      FROM matched_tag_posts mtp
      JOIN posts p ON p.id = mtp.post_id
      `,
      [input.tags],
    );

    const records: RecommendRecord[] = [];
    for (const r0 of res.rows as unknown[]) {
      const r = r0 as unknown as RecommendByTagsDbRow;
      records.push({
        postId: BigInt(r.post_id),
        tag: r.tag,
        isRoot: r.is_root,
      });
    }

    if (records.length === 0) return [];

    const sortedRecords = [...records].sort((a, b) => {
      const c1 = compareBigIntDesc(a.postId, b.postId);
      if (c1 !== 0) return c1;
      if (a.tag !== b.tag) return a.tag > b.tag ? -1 : 1;
      if (a.isRoot === b.isRoot) return 0;
      return a.isRoot ? -1 : 1;
    });

    let tagRankScore = sortedRecords.length * 2;
    const tagScores = new Map<string, number>();
    for (const r of sortedRecords) {
      tagScores.set(r.tag, (tagScores.get(r.tag) ?? 0) + tagRankScore);
      tagRankScore -= 1;
    }

    let totalTagScore = 0;
    for (const v of tagScores.values()) totalTagScore += v;
    if (totalTagScore === 0) return [];

    const tagIdfScores = new Map<string, number>();
    for (const [tag, score] of tagScores.entries()) {
      tagIdfScores.set(tag, -Math.log(score / totalTagScore));
    }

    const postIdSet = new Set<bigint>();
    for (const r of records) postIdSet.add(r.postId);

    const sortedPostIds = Array.from(postIdSet).sort(compareBigIntDesc);

    let postRankScore = sortedPostIds.length * 3;
    const postRankScores = new Map<bigint, number>();
    for (const postId of sortedPostIds) {
      postRankScores.set(postId, postRankScore);
      postRankScore -= 1;
    }

    const postFinalScores = new Map<bigint, number>();
    for (const r of records) {
      const rankScore = postRankScores.get(r.postId);
      const idfScore = tagIdfScores.get(r.tag);
      if (rankScore === undefined || idfScore === undefined) continue;
      const rootScore = r.isRoot ? 1.0 : 0.5;
      const add = rankScore * idfScore * rootScore;
      postFinalScores.set(r.postId, (postFinalScores.get(r.postId) ?? 0) + add);
    }

    const scored: ScoredPost[] = Array.from(postFinalScores.entries()).map(([postId, score]) => ({
      postId,
      score,
    }));

    scored.sort((a, b) => {
      if (a.score !== b.score) return b.score - a.score;
      return compareBigIntDesc(a.postId, b.postId);
    });

    const ordered = order === "asc" ? [...scored].reverse() : scored;
    const sliced = ordered.slice(offset, offset + limit);

    const out: string[] = [];
    for (const s of sliced) {
      out.push(decToHex(s.postId.toString()));
    }
    return out;
  }
}
