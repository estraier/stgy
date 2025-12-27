import { Config } from "../config";
import { Pool } from "pg";
import { pgQuery } from "../utils/servers";
import {
  hexToDec,
  decToHex,
  snakeToCamel,
  bufferToInt8Array,
  int8ArrayToBuffer,
} from "../utils/format";
import {
  decodeFeatures,
  encodeFeatures,
  cosineSimilarity,
  sigmoidalContrast,
  normalizeL2,
} from "../utils/vectorSpace";
import {
  AiPostSummary,
  ListAiPostSummariesInput,
  RecommendPostsInput,
  UpdateAiPostSummaryInput,
  SearchSeedTag,
  SearchSeed,
} from "../models/aiPost";

type AiPostSummaryDbRow = {
  post_id: string;
  updated_at: string;
  summary: string | null;
  features: Buffer | null;
  tags: string[];
};

type RecommendDbRow = {
  post_id: string;
  tag: string;
  is_root: boolean;
  user_id: string;
};

type RecommendRecord = {
  postId: bigint;
  tag: string;
  isRoot: boolean;
  userId: string;
};

type ScoredPost = {
  postId: bigint;
  score: number;
};

type PostFeaturesRow = {
  post_id: string;
  features: Buffer | null;
};

type Candidate = {
  postId: bigint;
  features: Int8Array | null;
};

type FolloweeRow = {
  followee_id: string;
};

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
      features: tmp.features ? bufferToInt8Array(tmp.features) : null,
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
        features: tmp.features ? bufferToInt8Array(tmp.features) : null,
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
        const featuresBytea = input.features === null ? null : int8ArrayToBuffer(input.features);
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
          [postId, input.summary, featuresBytea],
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
        const featuresBytea = input.features === null ? null : int8ArrayToBuffer(input.features);
        await pgQuery(
          this.pgPool,
          `
          INSERT INTO ai_post_summaries (post_id, features, updated_at)
          VALUES ($1, $2, now())
          ON CONFLICT (post_id) DO UPDATE SET features = EXCLUDED.features, updated_at = now()
          `,
          [postId, featuresBytea],
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

  async BuildSearchSeedForUser(userId: string): Promise<SearchSeed> {
    const SELF_POST_LIMIT = 10;
    const SELF_LIKE_LIMIT = 10;
    const TOP_FOLLOWEE_LIMIT = 10;
    const FOLLOWEE_POST_LIMIT_PER_USER = 2;
    const FOLLOWEE_LIKE_LIMIT_PER_USER = 10;
    const ADOPT_TAG_LIMIT = 10;
    const userIdDec = hexToDec(userId);
    const seedRes = await pgQuery(
      this.pgPool,
      `
      WITH
      self_posts AS (
        SELECT p.id AS post_id, 1.0::float8 AS weight
        FROM posts p
        WHERE p.owned_by = $1
        ORDER BY p.id DESC
        LIMIT $2
      ),
      self_likes AS (
        SELECT pl.post_id, 0.7::float8 AS weight
        FROM post_likes pl
        WHERE pl.liked_by = $1
        ORDER BY pl.created_at DESC
        LIMIT $3
      ),
      followees AS (
        SELECT uf.followee_id
        FROM user_follows uf
        WHERE uf.follower_id = $1
      ),
      active_followees AS (
        SELECT DISTINCT ON (p2.owned_by) p2.owned_by, p2.id AS last_id
        FROM posts p2
        WHERE p2.owned_by IN (SELECT followee_id FROM followees)
        ORDER BY p2.owned_by, p2.id DESC
      ),
      top_followees AS (
        SELECT owned_by AS followee_id
        FROM active_followees
        ORDER BY last_id DESC
        LIMIT $4
      ),
      followee_posts AS (
        SELECT pid.id AS post_id, 0.5::float8 AS weight
        FROM top_followees tf
        JOIN LATERAL (
          SELECT p2.id
          FROM posts p2
          WHERE p2.owned_by = tf.followee_id
          ORDER BY p2.id DESC
          LIMIT $5
        ) AS pid ON TRUE
      ),
      followee_likes AS (
        SELECT lid.post_id, 0.3::float8 AS weight
        FROM top_followees tf
        JOIN LATERAL (
          SELECT pl2.post_id
          FROM post_likes pl2
          WHERE pl2.liked_by = tf.followee_id
          ORDER BY pl2.created_at DESC
          LIMIT $6
        ) AS lid ON TRUE
      ),
      seed_posts AS (
        SELECT * FROM self_posts
        UNION ALL SELECT * FROM self_likes
        UNION ALL SELECT * FROM followee_posts
        UNION ALL SELECT * FROM followee_likes
      )
      SELECT post_id, weight
      FROM seed_posts
      `,
      [
        userIdDec,
        SELF_POST_LIMIT,
        SELF_LIKE_LIMIT,
        TOP_FOLLOWEE_LIMIT,
        FOLLOWEE_POST_LIMIT_PER_USER,
        FOLLOWEE_LIKE_LIMIT_PER_USER,
      ],
    );
    if (seedRes.rows.length === 0) {
      throw new Error("no seed posts");
    }
    const seedPostIds: string[] = [];
    const seedWeights: number[] = [];
    const weightByPostId = new Map<string, number>();
    for (const r0 of seedRes.rows as unknown[]) {
      const rr = r0 as Record<string, unknown>;
      const postIdRaw = rr.post_id ?? rr.postId ?? rr.postID ?? rr.id;
      const weightRaw = rr.weight ?? rr.w;
      const postId =
        typeof postIdRaw === "string" ||
        typeof postIdRaw === "number" ||
        typeof postIdRaw === "bigint"
          ? String(postIdRaw)
          : "";
      if (postId.trim() === "") continue;
      const w =
        typeof weightRaw === "number"
          ? weightRaw
          : typeof weightRaw === "string"
            ? Number(weightRaw)
            : typeof weightRaw === "bigint"
              ? Number(weightRaw)
              : Number.NaN;
      if (!Number.isFinite(w) || w <= 0) continue;
      seedPostIds.push(postId);
      seedWeights.push(w);
      weightByPostId.set(postId, (weightByPostId.get(postId) ?? 0) + w);
    }
    if (seedPostIds.length === 0) {
      throw new Error("no seed posts");
    }
    let tagRows: unknown[] = [];
    const tagRes = await pgQuery(
      this.pgPool,
      `
      WITH seed_posts(post_id, weight) AS (
        SELECT * FROM unnest($1::bigint[], $2::float8[])
      )
      SELECT sp.weight, apt.name
      FROM seed_posts sp
      JOIN ai_post_tags apt ON apt.post_id = sp.post_id
      `,
      [seedPostIds, seedWeights],
    );
    tagRows = tagRes.rows as unknown[];
    if (tagRows.length === 0) {
      const tagRes2 = await pgQuery(
        this.pgPool,
        `
        SELECT apt.post_id, apt.name
        FROM ai_post_tags apt
        WHERE apt.post_id = ANY($1::bigint[])
        `,
        [Array.from(weightByPostId.keys())],
      );
      tagRows = tagRes2.rows as unknown[];
    }
    const tagScores = new Map<string, number>();
    for (const r0 of tagRows) {
      const rr = r0 as Record<string, unknown>;
      const nameRaw = rr.name;
      const name = typeof nameRaw === "string" ? nameRaw.trim() : "";
      if (!name) continue;
      let w = 0;
      if (rr.weight !== undefined) {
        const ww =
          typeof rr.weight === "number"
            ? rr.weight
            : typeof rr.weight === "string"
              ? Number(rr.weight)
              : typeof rr.weight === "bigint"
                ? Number(rr.weight)
                : Number.NaN;
        w = Number.isFinite(ww) ? ww : 0;
      } else {
        const postIdRaw = rr.post_id ?? rr.postId ?? rr.postID ?? rr.id;
        const postId =
          typeof postIdRaw === "string" ||
          typeof postIdRaw === "number" ||
          typeof postIdRaw === "bigint"
            ? String(postIdRaw)
            : "";
        w = weightByPostId.get(postId) ?? 0;
      }
      if (!Number.isFinite(w) || w <= 0) continue;
      tagScores.set(name, (tagScores.get(name) ?? 0) + w);
    }
    const topTags = Array.from(tagScores.entries())
      .sort((a, b) => {
        if (a[1] !== b[1]) return b[1] - a[1];
        return a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0;
      })
      .slice(0, ADOPT_TAG_LIMIT);
    let tagsOut: SearchSeedTag[] = [];
    if (topTags.length > 0) {
      const minScore = topTags[topTags.length - 1][1];
      if (Number.isFinite(minScore) && minScore > 0) {
        tagsOut = topTags.map(([name, score]) => {
          const scaled = score / minScore;
          const cnt = Math.max(1, Math.round(scaled));
          return { name, count: cnt };
        });
      } else {
        tagsOut = topTags.map(([name]) => ({ name, count: 1 }));
      }
    }
    let featRows: unknown[] = [];
    const featRes = await pgQuery(
      this.pgPool,
      `
      WITH seed_posts(post_id, weight) AS (
        SELECT * FROM unnest($1::bigint[], $2::float8[])
      )
      SELECT sp.weight, aps.features
      FROM seed_posts sp
      JOIN ai_post_summaries aps ON aps.post_id = sp.post_id
      WHERE aps.features IS NOT NULL
      `,
      [seedPostIds, seedWeights],
    );
    featRows = featRes.rows as unknown[];
    if (featRows.length === 0) {
      const featRes2 = await pgQuery(
        this.pgPool,
        `
        SELECT aps.post_id, aps.features
        FROM ai_post_summaries aps
        WHERE aps.post_id = ANY($1::bigint[])
          AND aps.features IS NOT NULL
        `,
        [Array.from(weightByPostId.keys())],
      );
      featRows = featRes2.rows as unknown[];
    }
    let sumVec: number[] | null = null;
    for (const r0 of featRows) {
      const rr = r0 as Record<string, unknown>;
      let w = 0;
      if (rr.weight !== undefined) {
        const ww =
          typeof rr.weight === "number"
            ? rr.weight
            : typeof rr.weight === "string"
              ? Number(rr.weight)
              : typeof rr.weight === "bigint"
                ? Number(rr.weight)
                : Number.NaN;
        w = Number.isFinite(ww) ? ww : 0;
      } else {
        const postIdRaw = rr.post_id ?? rr.postId ?? rr.postID ?? rr.id;
        const postId =
          typeof postIdRaw === "string" ||
          typeof postIdRaw === "number" ||
          typeof postIdRaw === "bigint"
            ? String(postIdRaw)
            : "";
        w = weightByPostId.get(postId) ?? 0;
      }
      if (!Number.isFinite(w) || w <= 0) continue;
      let buf: Buffer | null = null;
      const f = rr.features;
      if (Buffer.isBuffer(f)) buf = f;
      else if (f instanceof Uint8Array) buf = Buffer.from(f);
      else buf = null;
      if (!buf) continue;
      const features = bufferToInt8Array(buf);
      let v: number[] | null = null;
      try {
        v = normalizeL2(decodeFeatures(features));
      } catch {
        v = null;
      }
      if (!v || v.length === 0) continue;

      if (!sumVec) {
        sumVec = v.map((x) => x * w);
      } else if (sumVec.length === v.length) {
        for (let i = 0; i < sumVec.length; i++) sumVec[i] += v[i] * w;
      }
    }
    if (!sumVec || sumVec.length === 0) {
      throw new Error("no seed features");
    }
    const outFeatures = encodeFeatures(sumVec);
    return { tags: tagsOut, features: outFeatures };
  }

  async RecommendPosts(input: RecommendPostsInput): Promise<string[]> {
    const offset = input.offset ?? 0;
    const limit = input.limit ?? 100;
    const order = (input.order ?? "desc").toLowerCase() === "asc" ? "asc" : "desc";
    const selfUserIdDec =
      typeof input.selfUserId === "string" && input.selfUserId.trim() !== ""
        ? hexToDec(input.selfUserId)
        : null;
    const dedupWeight =
      typeof input.dedupWeight === "number" &&
      Number.isFinite(input.dedupWeight) &&
      input.dedupWeight > 0
        ? input.dedupWeight
        : 0;
    if (input.tags.length === 0) return [];
    const paramTagCounts = new Map<string, number>();
    for (const t of input.tags) {
      const tag = typeof t.name === "string" ? t.name.trim() : "";
      if (!tag) continue;
      const count = typeof t.count === "number" && Number.isFinite(t.count) ? t.count : 0;
      if (count <= 0) continue;
      paramTagCounts.set(tag, (paramTagCounts.get(tag) ?? 0) + count);
    }
    const queryTags = Array.from(paramTagCounts.keys());
    if (queryTags.length === 0) return [];
    let followeeIds: Set<string> | null = null;
    if (selfUserIdDec) {
      const fr = await pgQuery<FolloweeRow>(
        this.pgPool,
        `
        SELECT followee_id
        FROM user_follows
        WHERE follower_id = $1
        `,
        [selfUserIdDec],
      );
      followeeIds = new Set(fr.rows.map((r) => String(r.followee_id)));
    }
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
          LIMIT $2
        ) pt ON true
        UNION ALL
        SELECT qt.tag, apt.post_id
        FROM query_tags qt
        JOIN LATERAL (
          SELECT post_id
          FROM ai_post_tags
          WHERE name = qt.tag
          ORDER BY post_id DESC
          LIMIT $2
        ) apt ON true
      )
      SELECT
        mtp.post_id,
        mtp.tag,
        (p.reply_to IS NULL) AS is_root,
        p.owned_by AS user_id
      FROM matched_tag_posts mtp
      JOIN posts p ON p.id = mtp.post_id
      `,
      [queryTags, Config.AI_POST_RECOMMEND_TAG_CANDIDATES],
    );
    let records: RecommendRecord[] = [];
    for (const r0 of res.rows as unknown[]) {
      const r = r0 as unknown as RecommendDbRow;
      records.push({
        postId: BigInt(r.post_id),
        tag: r.tag,
        isRoot: r.is_root,
        userId: String(r.user_id),
      });
    }
    if (selfUserIdDec) {
      records = records.filter((r) => r.userId !== selfUserIdDec);
    }
    if (records.length === 0) return [];
    const tagsByPostId = new Map<bigint, string[]>();
    const metaByPostId = new Map<bigint, { isRoot: boolean; userId: string }>();
    for (const r of records) {
      const prev = tagsByPostId.get(r.postId);
      if (prev) {
        prev.push(r.tag);
      } else {
        tagsByPostId.set(r.postId, [r.tag]);
      }
      if (!metaByPostId.has(r.postId)) {
        metaByPostId.set(r.postId, { isRoot: r.isRoot, userId: r.userId });
      }
    }
    const sortedTagPosts = Array.from(tagsByPostId.entries()).sort((a, b) =>
      compareBigIntDesc(a[0], b[0]),
    );
    let tagRankScore = sortedTagPosts.length;
    const tagScores = new Map<string, number>();
    for (const [, tags] of sortedTagPosts) {
      for (const tag of tags) {
        tagScores.set(tag, (tagScores.get(tag) ?? 0) + tagRankScore);
      }
      tagRankScore -= 1;
    }
    let totalTagScore = 0;
    for (const v of tagScores.values()) totalTagScore += v;
    if (totalTagScore === 0) return [];
    const tagIdfScores = new Map<string, number>();
    for (const [tag, score] of tagScores.entries()) {
      if (score <= 0) continue;
      tagIdfScores.set(tag, Math.log(totalTagScore / score));
    }
    const sortedPostIds = Array.from(tagsByPostId.keys()).sort(compareBigIntDesc);
    let postRankScore = sortedPostIds.length * 3;
    const postRankScores = new Map<bigint, number>();
    for (const postId of sortedPostIds) {
      postRankScores.set(postId, postRankScore);
      postRankScore -= 1;
    }
    const postFinalScores = new Map<bigint, number>();
    for (const [postId, tags] of tagsByPostId.entries()) {
      const rankScore = postRankScores.get(postId);
      const meta = metaByPostId.get(postId);
      if (rankScore === undefined || !meta) continue;
      const rootScore = meta.isRoot ? 1.0 : 0.5;
      const socialScore = followeeIds && followeeIds.has(meta.userId) ? 1.0 : 0.5;
      const tagTableCounts = new Map<string, number>();
      for (const tag of tags) {
        tagTableCounts.set(tag, (tagTableCounts.get(tag) ?? 0) + 1);
      }
      for (const [tag, tableCount] of tagTableCounts.entries()) {
        const idfScore = tagIdfScores.get(tag);
        const paramCount = paramTagCounts.get(tag) ?? 0;
        const tfArg = tableCount + paramCount;
        if (idfScore === undefined || tfArg <= 0) continue;
        const tfScore = Math.log(tfArg);
        const add = rankScore * tfScore * idfScore * rootScore * socialScore;
        postFinalScores.set(postId, (postFinalScores.get(postId) ?? 0) + add);
      }
    }
    const scored: ScoredPost[] = Array.from(postFinalScores.entries()).map(([postId, score]) => ({
      postId,
      score,
    }));
    scored.sort((a, b) => {
      if (a.score !== b.score) return b.score - a.score;
      return compareBigIntDesc(a.postId, b.postId);
    });
    const universe: Candidate[] = [];
    for (
      let i = 0;
      i < scored.length && universe.length < Config.AI_POST_RECOMMEND_VEC_CANDIDATES;
      i += 20
    ) {
      const chunk = scored.slice(i, i + 20);
      const ids = chunk.map((c) => c.postId.toString());
      const r = await pgQuery<PostFeaturesRow>(
        this.pgPool,
        `
        SELECT post_id, features
        FROM ai_post_summaries
        WHERE post_id = ANY($1::bigint[])
        `,
        [ids],
      );
      const byId = new Map<string, PostFeaturesRow>();
      for (const row of r.rows) byId.set(String(row.post_id), row);
      for (const c of chunk) {
        const row = byId.get(c.postId.toString());
        if (!row) continue;
        universe.push({
          postId: c.postId,
          features: row.features ? bufferToInt8Array(row.features) : null,
        });
        if (universe.length >= Config.AI_POST_RECOMMEND_VEC_CANDIDATES) break;
      }
    }
    if (universe.length === 0) return [];
    let finalIds: bigint[] = universe.map((c) => c.postId);
    const needVectors = !!input.features || dedupWeight > 0;
    if (needVectors) {
      let qVec: number[] | null = null;
      if (input.features) {
        try {
          qVec = normalizeL2(decodeFeatures(input.features));
        } catch {
          qVec = null;
        }
      }
      const candidates: {
        postId: bigint;
        vec: number[] | null;
        baseScore: number;
        adjScore: number;
      }[] = [];
      for (const c of universe) {
        let vec: number[] | null = null;
        if (c.features) {
          try {
            vec = normalizeL2(decodeFeatures(c.features));
          } catch {
            vec = null;
          }
        }
        let baseScore = postFinalScores.get(c.postId) ?? 0;
        if (qVec) {
          if (!vec || vec.length !== qVec.length) {
            baseScore = Number.NEGATIVE_INFINITY;
          } else {
            const simRaw = cosineSimilarity(qVec, vec);
            const sim = sigmoidalContrast((simRaw + 1) / 2, 5, 0.75);
            baseScore = Number.isFinite(sim) ? sim : Number.NEGATIVE_INFINITY;
          }
        }
        candidates.push({ postId: c.postId, vec, baseScore, adjScore: baseScore });
      }
      candidates.sort((a, b) => {
        if (a.baseScore !== b.baseScore) return b.baseScore - a.baseScore;
        return compareBigIntDesc(a.postId, b.postId);
      });
      if (dedupWeight > 0) {
        let sumVec: number[] | null = null;
        for (let i = 0; i < candidates.length; i++) {
          const c = candidates[i];
          let adj = c.baseScore;
          if (i > 0 && sumVec && c.vec && sumVec.length === c.vec.length) {
            const simDupRaw = cosineSimilarity(sumVec, c.vec);
            const simDup = sigmoidalContrast((simDupRaw + 1) / 2, 5, 0.75);
            const penalty = Number.isFinite(simDup) ? simDup * dedupWeight : dedupWeight;
            adj = adj - penalty;
          }
          c.adjScore = adj;
          if (c.vec) {
            if (!sumVec) {
              sumVec = c.vec.slice();
            } else if (sumVec.length === c.vec.length) {
              for (let j = 0; j < sumVec.length; j++) sumVec[j] += c.vec[j];
            }
          }
        }
        candidates.sort((a, b) => {
          if (a.adjScore !== b.adjScore) return b.adjScore - a.adjScore;
          if (a.baseScore !== b.baseScore) return b.baseScore - a.baseScore;
          return compareBigIntDesc(a.postId, b.postId);
        });
      }
      finalIds = candidates.map((x) => x.postId);
    }
    const orderedIds = order === "asc" ? [...finalIds].reverse() : finalIds;
    const sliced = orderedIds.slice(offset, offset + limit);
    const out: string[] = [];
    for (const postId of sliced) {
      out.push(decToHex(postId.toString()));
    }
    return out;
  }
}
