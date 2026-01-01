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
  clusterVectorsByKMeans,
} from "../utils/vectorSpace";
import type {
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
  table_count: number;
  is_root: boolean;
  user_id: string;
};

type RecommendRecord = {
  postId: bigint;
  tag: string;
  tableCount: number;
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

type PostLikesCountRow = {
  post_id: string;
  count_likes: number;
};

type Candidate = {
  postId: bigint;
  features: Int8Array | null;
};

type FolloweeRow = {
  followee_id: string;
};

type SeedPostRow = {
  post_id: string;
  weight: number;
};

type SeedPostFeaturesRow = {
  post_id: string;
  features: Buffer | null;
};

type SeedTagRow = {
  post_id: string;
  name: string;
  table_count: number;
};

type SeedMaterial = {
  postId: bigint;
  postIdStr: string;
  effectiveWeight: number;
  vec: number[];
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

  async BuildSearchSeedForUser(userId: string, numClusters: number): Promise<SearchSeed[]> {
    if (!Number.isInteger(numClusters) || numClusters <= 0) {
      throw new Error("invalid numClusters");
    }

    const SELF_POST_LIMIT = 10;
    const SELF_LIKE_LIMIT = 20;
    const TOP_FOLLOWEE_LIMIT = 20;
    const FOLLOWEE_POST_LIMIT_PER_USER = 5;
    const FOLLOWEE_LIKE_LIMIT_PER_USER = 5;
    const ADOPT_TAG_LIMIT = 10;

    const WEIGHT_GAMMA = 0.7;
    const FEATURE_DIM = 512;

    const userIdDec = hexToDec(userId);

    const seedRes = await pgQuery<SeedPostRow>(
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

    const baseWeightByPostId = new Map<string, number>();
    for (const r of seedRes.rows) {
      const postIdStr = r.post_id;
      if (postIdStr.trim() === "") continue;
      baseWeightByPostId.set(postIdStr, (baseWeightByPostId.get(postIdStr) ?? 0) + r.weight);
    }

    const uniquePostIds = Array.from(baseWeightByPostId.keys());
    if (uniquePostIds.length === 0) {
      throw new Error("no seed posts");
    }

    let totalBaseWeight = 0;
    for (const w of baseWeightByPostId.values()) totalBaseWeight += w;
    if (!(totalBaseWeight > 0)) {
      throw new Error("no seed posts");
    }

    const effectiveWeightByPostId = new Map<string, number>();
    for (const [postIdStr, w] of baseWeightByPostId.entries()) {
      const p = w / totalBaseWeight;
      effectiveWeightByPostId.set(postIdStr, Math.pow(p, WEIGHT_GAMMA));
    }

    const loadTagsByPostId = async (
      postIds: string[],
    ): Promise<Map<string, { name: string; tableCount: number }[]>> => {
      const tagRes = await pgQuery<SeedTagRow>(
        this.pgPool,
        `
        WITH raw AS (
          SELECT post_id, name, 'post'::text AS src
          FROM post_tags
          WHERE post_id = ANY($1::bigint[])
          UNION ALL
          SELECT post_id, name, 'ai'::text AS src
          FROM ai_post_tags
          WHERE post_id = ANY($1::bigint[])
        ),
        agg AS (
          SELECT post_id, name, COUNT(DISTINCT src)::int AS table_count
          FROM raw
          GROUP BY post_id, name
        )
        SELECT post_id, name, table_count
        FROM agg
        ORDER BY post_id, name
        `,
        [postIds],
      );

      const out = new Map<string, { name: string; tableCount: number }[]>();
      for (const r of tagRes.rows) {
        const postIdStr = r.post_id;
        const name = r.name.trim();
        if (!name) continue;

        const tableCount = r.table_count;
        const prev = out.get(postIdStr);
        const v = { name, tableCount };
        if (prev) prev.push(v);
        else out.set(postIdStr, [v]);
      }
      return out;
    };

    const featRes = await pgQuery<SeedPostFeaturesRow>(
      this.pgPool,
      `
      SELECT post_id, features
      FROM ai_post_summaries
      WHERE post_id = ANY($1::bigint[])
        AND features IS NOT NULL
      `,
      [uniquePostIds],
    );

    const materials: SeedMaterial[] = [];
    for (const row of featRes.rows) {
      const postIdStr = row.post_id;
      const effectiveWeight = effectiveWeightByPostId.get(postIdStr) ?? 0;
      if (!(effectiveWeight > 0)) continue;
      if (!row.features) continue;

      let vec: number[] | null = null;
      try {
        vec = normalizeL2(decodeFeatures(bufferToInt8Array(row.features)));
      } catch {
        vec = null;
      }
      if (!vec || vec.length === 0) continue;

      materials.push({
        postId: BigInt(postIdStr),
        postIdStr,
        effectiveWeight,
        vec,
      });
    }

    if (materials.length === 0) {
      const tagsByPostId = await loadTagsByPostId(uniquePostIds);

      let weightSum = 0;
      const tagScores = new Map<string, number>();

      for (const postIdStr of uniquePostIds) {
        const postWeight = effectiveWeightByPostId.get(postIdStr) ?? 0;
        if (!(postWeight > 0)) continue;

        weightSum += postWeight;

        const tags = tagsByPostId.get(postIdStr) ?? [];
        for (const t of tags) {
          const tableScore = Math.log(1 + t.tableCount);
          tagScores.set(t.name, (tagScores.get(t.name) ?? 0) + postWeight * tableScore);
        }
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
        if (minScore > 0) {
          tagsOut = topTags.map(([name, score]) => {
            const scaled = score / minScore;
            const cnt = Math.max(1, Math.round(scaled * 10) / 10);
            return { name, count: cnt };
          });
        } else {
          tagsOut = topTags.map(([name]) => ({ name, count: 1 }));
        }
      }

      const s = userId.startsWith("0x") ? userId.slice(2) : userId;
      const tail = s.length > 8 ? s.slice(-8) : s;
      const n = parseInt(tail, 16);
      const idx = Number.isFinite(n) ? ((n % FEATURE_DIM) + FEATURE_DIM) % FEATURE_DIM : 0;

      const features = new Int8Array(FEATURE_DIM);
      features[idx] = 1;

      return [{ tags: tagsOut, features, weight: weightSum }];
    }

    const tagsByPostId = await loadTagsByPostId(materials.map((m) => m.postIdStr));
    const actualClusters = Math.min(numClusters, materials.length);

    const seedFromUserId = (id: string): number => {
      const s = id.startsWith("0x") ? id.slice(2) : id;
      const tail = s.length > 8 ? s.slice(-8) : s;
      const n = parseInt(tail, 16);
      return Number.isFinite(n) ? n : 0;
    };

    const buildSeedFromCluster = (items: SeedMaterial[]): SearchSeed => {
      let weightSum = 0;
      const tagScores = new Map<string, number>();
      let sumVec: number[] | null = null;

      for (const m of items) {
        const postWeight = m.effectiveWeight;
        weightSum += postWeight;

        const tags = tagsByPostId.get(m.postIdStr) ?? [];
        for (const t of tags) {
          const tableScore = Math.log(1 + t.tableCount);
          tagScores.set(t.name, (tagScores.get(t.name) ?? 0) + postWeight * tableScore);
        }

        if (!sumVec) {
          sumVec = m.vec.map((x) => x * postWeight);
        } else {
          for (let i = 0; i < sumVec.length; i++) sumVec[i] += m.vec[i] * postWeight;
        }
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
        if (minScore > 0) {
          tagsOut = topTags.map(([name, score]) => {
            const scaled = score / minScore;
            const cnt = Math.max(1, Math.round(scaled * 10) / 10);
            return { name, count: cnt };
          });
        } else {
          tagsOut = topTags.map(([name]) => ({ name, count: 1 }));
        }
      }
      if (!sumVec || sumVec.length === 0) {
        throw new Error("no seed features");
      }
      const outFeatures = encodeFeatures(normalizeL2(sumVec));
      return { tags: tagsOut, features: outFeatures, weight: weightSum };
    };

    let clusters: SeedMaterial[][] = [];

    if (actualClusters <= 1) {
      clusters = [materials];
    } else if (materials.length < numClusters) {
      const sorted = materials
        .slice()
        .sort((a, b) =>
          a.effectiveWeight !== b.effectiveWeight
            ? b.effectiveWeight - a.effectiveWeight
            : compareBigIntDesc(a.postId, b.postId),
        );
      clusters = sorted.map((m) => [m]);
    } else {
      const vectors: number[][] = materials.map((m) => m.vec);
      const assignments = clusterVectorsByKMeans(vectors, actualClusters, {
        seed: seedFromUserId(userId),
        normalize: false,
      });

      const tmp = new Map<number, SeedMaterial[]>();
      for (let i = 0; i < assignments.length; i++) {
        const c = assignments[i];
        const arr = tmp.get(c);
        if (arr) arr.push(materials[i]);
        else tmp.set(c, [materials[i]]);
      }

      clusters = Array.from(tmp.entries())
        .sort((a, b) => a[0] - b[0])
        .map(([, v]) => v);
    }

    const seeds: SearchSeed[] = [];
    for (const items of clusters) {
      if (items.length === 0) continue;
      seeds.push(buildSeedFromCluster(items));
    }

    seeds.sort((a, b) => {
      if (a.weight !== b.weight) return b.weight - a.weight;
      const at = a.tags[0]?.name ?? "";
      const bt = b.tags[0]?.name ?? "";
      return at < bt ? -1 : at > bt ? 1 : 0;
    });

    return seeds;
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

    const rerankByLikesAlpha =
      typeof input.rerankByLikesAlpha === "number" &&
      Number.isFinite(input.rerankByLikesAlpha) &&
      input.rerankByLikesAlpha > 0
        ? input.rerankByLikesAlpha
        : 0;

    if (input.tags.length === 0) return [];

    const paramTagCounts = new Map<string, number>();
    for (const t of input.tags) {
      const tag = typeof t.name === "string" ? t.name.trim() : "";
      if (!tag) continue;

      const count = typeof t.count === "number" ? t.count : 0;
      if (!(count > 0)) continue;

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
      followeeIds = new Set(fr.rows.map((r) => r.followee_id));
    }

    const res = await pgQuery(
      this.pgPool,
      `
      WITH query_tags(tag) AS (
        SELECT unnest($1::text[])
      ),
      raw AS (
        SELECT qt.tag, x.post_id, x.src
        FROM query_tags qt
        JOIN LATERAL (
          (SELECT post_id, 'post'::text AS src
           FROM post_tags
           WHERE name = qt.tag
           ORDER BY post_id DESC
           LIMIT $2)
          UNION ALL
          (SELECT post_id, 'ai'::text AS src
           FROM ai_post_tags
           WHERE name = qt.tag
           ORDER BY post_id DESC
           LIMIT $2)
        ) x ON true
      ),
      agg AS (
        SELECT
          tag,
          post_id,
          COUNT(DISTINCT src)::int AS table_count
        FROM raw
        GROUP BY tag, post_id
      )
      SELECT
        a.post_id,
        a.tag,
        a.table_count,
        (p.reply_to IS NULL) AS is_root,
        p.owned_by AS user_id
      FROM agg a
      JOIN posts p ON p.id = a.post_id
      `,
      [queryTags, Config.AI_POST_RECOMMEND_TAG_CANDIDATES],
    );

    let records: RecommendRecord[] = [];
    for (const r0 of res.rows as unknown[]) {
      const r = r0 as unknown as RecommendDbRow;
      records.push({
        postId: BigInt(r.post_id),
        tag: r.tag,
        tableCount: r.table_count,
        isRoot: r.is_root,
        userId: r.user_id,
      });
    }

    if (selfUserIdDec) {
      records = records.filter((r) => r.userId !== selfUserIdDec);
    }
    if (records.length === 0) return [];

    const tagTableCountsByPostId = new Map<bigint, Map<string, number>>();
    const metaByPostId = new Map<bigint, { isRoot: boolean; userId: string }>();

    for (const r of records) {
      let m = tagTableCountsByPostId.get(r.postId);
      if (!m) {
        m = new Map<string, number>();
        tagTableCountsByPostId.set(r.postId, m);
      }
      m.set(r.tag, r.tableCount);

      if (!metaByPostId.has(r.postId)) {
        metaByPostId.set(r.postId, { isRoot: r.isRoot, userId: r.userId });
      }
    }

    const sortedTagPosts = Array.from(tagTableCountsByPostId.entries()).sort((a, b) =>
      compareBigIntDesc(a[0], b[0]),
    );

    let tagRankScore = sortedTagPosts.length;
    const tagScores = new Map<string, number>();

    for (const [, tagMap] of sortedTagPosts) {
      for (const [tag] of tagMap.entries()) {
        tagScores.set(tag, (tagScores.get(tag) ?? 0) + tagRankScore);
      }
      tagRankScore -= 1;
    }

    let totalTagScore = 0;
    for (const v of tagScores.values()) totalTagScore += v;
    if (totalTagScore === 0) return [];

    const tagIdfScores = new Map<string, number>();
    for (const [tag, score] of tagScores.entries()) {
      if (!(score > 0)) continue;
      tagIdfScores.set(tag, Math.log(totalTagScore / score));
    }

    const sortedPostIds = Array.from(tagTableCountsByPostId.keys()).sort(compareBigIntDesc);

    let postRankScore = sortedPostIds.length * 3;
    const postRankScores = new Map<bigint, number>();
    for (const postId of sortedPostIds) {
      postRankScores.set(postId, postRankScore);
      postRankScore -= 1;
    }

    const postFinalScores = new Map<bigint, number>();
    for (const [postId, tagMap] of tagTableCountsByPostId.entries()) {
      const rankScore = postRankScores.get(postId);
      const meta = metaByPostId.get(postId);
      if (rankScore === undefined || !meta) continue;
      const rootScore = meta.isRoot ? 1.0 : 0.5;
      const socialScore =
        selfUserIdDec && meta.userId === selfUserIdDec
          ? 1.0
          : followeeIds && followeeIds.has(meta.userId)
            ? 0.9
            : 0.8;
      for (const [tag, tableCount] of tagMap.entries()) {
        const idfScore = tagIdfScores.get(tag);
        const paramCount = paramTagCounts.get(tag) ?? 0;
        const tfArg = tableCount + paramCount;
        if (idfScore === undefined || !(tfArg > 0)) continue;
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
      for (const row of r.rows) byId.set(row.post_id, row);

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

    const needWork = !!input.features || dedupWeight > 0 || rerankByLikesAlpha > 0;
    if (needWork) {
      let qVec: number[] | null = null;
      if (input.features) {
        try {
          qVec = normalizeL2(decodeFeatures(input.features));
        } catch {
          qVec = null;
        }
      }

      const needVecDecode = !!qVec || dedupWeight > 0;

      const candidates: {
        postId: bigint;
        vec: number[] | null;
        baseScore: number;
        adjScore: number;
        likeScore?: number;
      }[] = [];

      for (const c of universe) {
        let vec: number[] | null = null;
        if (needVecDecode && c.features) {
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

      if (rerankByLikesAlpha > 0) {
        const ids = candidates.map((c) => c.postId.toString());
        const likeRes = await pgQuery<PostLikesCountRow>(
          this.pgPool,
          `
          SELECT post_id, COUNT(*)::int AS count_likes
          FROM post_likes
          WHERE post_id = ANY($1::bigint[])
          GROUP BY post_id
          `,
          [ids],
        );

        const likesById = new Map<string, number>();
        for (const r of likeRes.rows) likesById.set(r.post_id, r.count_likes);

        for (let i = 0; i < candidates.length; i++) {
          const c = candidates[i];
          const likes = likesById.get(c.postId.toString()) ?? 0;
          c.likeScore = Math.log(rerankByLikesAlpha + likes) - i;
        }

        candidates.sort((a, b) => {
          const as = a.likeScore ?? Number.NEGATIVE_INFINITY;
          const bs = b.likeScore ?? Number.NEGATIVE_INFINITY;
          if (as !== bs) return bs - as;
          if (a.baseScore !== b.baseScore) return b.baseScore - a.baseScore;
          return compareBigIntDesc(a.postId, b.postId);
        });
      }

      if (dedupWeight > 0) {
        let sumVec: number[] | null = null;

        for (let i = 0; i < candidates.length; i++) {
          const c = candidates[i];
          let adj = c.baseScore;

          if (i > 0 && sumVec && c.vec && sumVec.length === c.vec.length) {
            const simDupRaw = cosineSimilarity(sumVec, c.vec);
            const simDup = sigmoidalContrast((simDupRaw + 1) / 2, 5, 0.9);
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
