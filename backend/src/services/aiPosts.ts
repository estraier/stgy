import { Config } from "../config";
import { Pool } from "pg";
import { pgQuery } from "../utils/servers";
import { hexToDec, decToHex, bufferToInt8Array, int8ArrayToBuffer } from "../utils/format";
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

type PostFeaturesRow = {
  post_id: string;
  features: Buffer | null;
};

type PostLikesCountRow = {
  post_id: string;
  count_likes: number;
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

type Candidate = {
  postId: bigint;
  features: Int8Array | null;
};

type SeedMaterial = {
  postId: bigint;
  postIdStr: string;
  effectiveWeight: number;
  vec: number[];
};

const compareBigIntDesc = (a: bigint, b: bigint): number => (a === b ? 0 : a > b ? -1 : 1);

const isNonEmptyString = (v: unknown): v is string => typeof v === "string" && v.trim().length > 0;

const safeHexToDec = (hex: string): string | null => {
  try {
    return hexToDec(hex);
  } catch {
    return null;
  }
};

const clampPositiveInt = (v: unknown, fallback: number): number => {
  const n = typeof v === "number" ? v : fallback;
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : fallback;
};

const normalizeOrder = (order: unknown, fallback: "asc" | "desc"): "asc" | "desc" => {
  const s = typeof order === "string" ? order.toLowerCase() : "";
  return s === "asc" || s === "desc" ? (s as "asc" | "desc") : fallback;
};

export class AiPostsService {
  constructor(private pgPool: Pool) {}

  private mapSummaryRow(row: AiPostSummaryDbRow): AiPostSummary {
    return {
      postId: decToHex(row.post_id),
      updatedAt: row.updated_at,
      summary: row.summary,
      features: row.features ? bufferToInt8Array(row.features) : null,
      tags: Array.isArray(row.tags) ? row.tags : [],
    };
  }

  private buildParamTagCounts(tags: SearchSeedTag[]): Map<string, number> {
    const m = new Map<string, number>();
    for (const t of tags) {
      const name = typeof t?.name === "string" ? t.name.trim() : "";
      const count = typeof t?.count === "number" ? t.count : 0;
      if (!name || !(count > 0)) continue;
      m.set(name, (m.get(name) ?? 0) + count);
    }
    return m;
  }

  async checkAiPostSummary(id: string): Promise<boolean> {
    const res = await pgQuery(
      this.pgPool,
      `
      SELECT 1
      FROM ai_post_summaries aps
      WHERE aps.post_id = $1 AND aps.summary IS NOT NULL
      LIMIT 1
      `,
      [hexToDec(id)],
    );
    return res.rows.length > 0;
  }

  async getAiPostSummary(id: string): Promise<AiPostSummary | null> {
    const res = await pgQuery<AiPostSummaryDbRow>(
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
    return this.mapSummaryRow(res.rows[0]);
  }

  async listAiPostsSummaries(options?: ListAiPostSummariesInput): Promise<AiPostSummary[]> {
    const offset = clampPositiveInt(options?.offset, 0);
    const limit = clampPositiveInt(options?.limit, 100);
    const order = normalizeOrder(options?.order, "asc");
    const orderDir = order === "desc" ? "DESC" : "ASC";
    const where: string[] = [];
    const params: unknown[] = [];
    let idx = 1;
    if (options?.nullOnly) where.push("aps.summary IS NULL");
    if (isNonEmptyString(options?.newerThan)) {
      where.push(`aps.updated_at > $${idx++}`);
      params.push(options!.newerThan);
    }
    const whereSql = where.length > 0 ? `WHERE ${where.join(" AND ")}` : "";
    const sql = `
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
      ${whereSql}
      ORDER BY aps.post_id ${orderDir}
      OFFSET $${idx++}
      LIMIT $${idx++}
    `;
    params.push(offset, limit);
    const res = await pgQuery<AiPostSummaryDbRow>(this.pgPool, sql, params);
    return res.rows.map((r) => this.mapSummaryRow(r));
  }

  async updateAiPost(input: UpdateAiPostSummaryInput): Promise<AiPostSummary | null> {
    const postIdDec = hexToDec(input.postId);
    await pgQuery(this.pgPool, "BEGIN");
    try {
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
          [postIdDec, input.summary, featuresBytea],
        );
      } else if (input.summary !== undefined) {
        await pgQuery(
          this.pgPool,
          `
          INSERT INTO ai_post_summaries (post_id, summary, updated_at)
          VALUES ($1, $2, now())
          ON CONFLICT (post_id) DO UPDATE
            SET summary = EXCLUDED.summary,
                updated_at = now()
          `,
          [postIdDec, input.summary],
        );
      } else if (input.features !== undefined) {
        const featuresBytea = input.features === null ? null : int8ArrayToBuffer(input.features);
        await pgQuery(
          this.pgPool,
          `
          INSERT INTO ai_post_summaries (post_id, features, updated_at)
          VALUES ($1, $2, now())
          ON CONFLICT (post_id) DO UPDATE
            SET features = EXCLUDED.features,
                updated_at = now()
          `,
          [postIdDec, featuresBytea],
        );
      }
      if (input.tags !== undefined) {
        await pgQuery(this.pgPool, `DELETE FROM ai_post_tags WHERE post_id = $1`, [postIdDec]);
        if (input.tags.length > 0) {
          await pgQuery(
            this.pgPool,
            `
            INSERT INTO ai_post_tags (post_id, name)
            SELECT $1, t
            FROM unnest($2::text[]) AS t
            `,
            [postIdDec, input.tags],
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
    const SELF_POST_LIMIT = 10;
    const SELF_LIKE_LIMIT = 20;
    const TOP_FOLLOWEE_LIMIT = 25;
    const FOLLOWEE_POST_LIMIT_PER_USER = 5;
    const FOLLOWEE_LIKE_LIMIT_PER_USER = 10;
    const ADOPT_TAG_LIMIT = 10;
    const WEIGHT_GAMMA = 0.7;
    const FEATURE_DIM = 512;
    const WEIGHT_SELF_POST = 1.0;
    const WEIGHT_SELF_LIKE = 0.7;
    const WEIGHT_FOLLOWEE_POST = 0.3;
    const WEIGHT_FOLLOWEE_LIKE = 0.2;
    if (!Number.isInteger(numClusters) || numClusters <= 0) throw new Error("invalid numClusters");
    const userIdDec = hexToDec(userId);
    const seedRes = await pgQuery<SeedPostRow>(
      this.pgPool,
      `
      WITH
      self_posts AS (
        SELECT p.id AS post_id, $7::float8 AS weight
        FROM posts p
        WHERE p.owned_by = $1
        ORDER BY p.id DESC
        LIMIT $2
      ),
      self_likes AS (
        SELECT pl.post_id, $8::float8 AS weight
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
        SELECT pid.id AS post_id, $9::float8 AS weight
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
        SELECT lid.post_id, $10::float8 AS weight
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
        WEIGHT_SELF_POST,
        WEIGHT_SELF_LIKE,
        WEIGHT_FOLLOWEE_POST,
        WEIGHT_FOLLOWEE_LIKE,
      ],
    );
    if (seedRes.rows.length === 0) return [];
    const baseWeightByPostId = new Map<string, number>();
    for (const r of seedRes.rows) {
      const pid = r.post_id;
      if (!isNonEmptyString(pid)) continue;
      baseWeightByPostId.set(pid, (baseWeightByPostId.get(pid) ?? 0) + r.weight);
    }
    const uniquePostIds = Array.from(baseWeightByPostId.keys());
    if (uniquePostIds.length === 0) return [];
    let totalBaseWeight = 0;
    for (const w of baseWeightByPostId.values()) totalBaseWeight += w;
    if (!(totalBaseWeight > 0)) return [];
    const effectiveWeightByPostId = new Map<string, number>();
    for (const [pid, w] of baseWeightByPostId.entries()) {
      const p = w / totalBaseWeight;
      effectiveWeightByPostId.set(pid, Math.pow(p, WEIGHT_GAMMA));
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
        const pid = r.post_id;
        const name = r.name.trim();
        if (!name) continue;
        const v = { name, tableCount: r.table_count };
        const prev = out.get(pid);
        if (prev) prev.push(v);
        else out.set(pid, [v]);
      }
      return out;
    };
    type PostOwnerRow = { id: string; owned_by: string };
    const loadOwnersByPostId = async (postIds: string[]): Promise<Map<string, string>> => {
      if (postIds.length === 0) return new Map();
      const r = await pgQuery<PostOwnerRow>(
        this.pgPool,
        `
        SELECT id, owned_by
        FROM posts
        WHERE id = ANY($1::bigint[])
        `,
        [postIds],
      );
      const out = new Map<string, string>();
      for (const row of r.rows) out.set(row.id, row.owned_by);
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
      const pid = row.post_id;
      const ew = effectiveWeightByPostId.get(pid) ?? 0;
      if (!(ew > 0)) continue;
      if (!row.features) continue;
      let vec: number[] | null = null;
      try {
        vec = normalizeL2(decodeFeatures(bufferToInt8Array(row.features)));
      } catch {
        vec = null;
      }
      if (!vec || vec.length === 0) continue;
      materials.push({ postId: BigInt(pid), postIdStr: pid, effectiveWeight: ew, vec });
    }
    if (materials.length === 0) {
      const tagsByPostId = await loadTagsByPostId(uniquePostIds);
      const ownersByPostId = await loadOwnersByPostId(uniquePostIds);
      let weightSum = 0;
      const tagScores = new Map<string, number>();
      for (const pid of uniquePostIds) {
        const w = effectiveWeightByPostId.get(pid) ?? 0;
        if (!(w > 0)) continue;
        weightSum += w;
        const tags = tagsByPostId.get(pid) ?? [];
        for (const t of tags) {
          const tableScore = Math.log(1 + t.tableCount);
          tagScores.set(t.name, (tagScores.get(t.name) ?? 0) + w * tableScore);
        }
      }
      const topTags = Array.from(tagScores.entries())
        .sort((a, b) => (a[1] !== b[1] ? b[1] - a[1] : a[0].localeCompare(b[0])))
        .slice(0, ADOPT_TAG_LIMIT);
      const tagsOut: SearchSeedTag[] =
        topTags.length === 0
          ? []
          : (() => {
              const minScore = topTags[topTags.length - 1][1];
              if (minScore > 0) {
                return topTags.map(([name, score]) => ({
                  name,
                  count: Math.max(1, Math.round((score / minScore) * 10) / 10),
                }));
              }
              return topTags.map(([name]) => ({ name, count: 1 }));
            })();
      const s = userId.startsWith("0x") ? userId.slice(2) : userId;
      const tail = s.length > 8 ? s.slice(-8) : s;
      const n = parseInt(tail, 16) || 0;
      const idx = ((n % FEATURE_DIM) + FEATURE_DIM) % FEATURE_DIM;
      const features = new Int8Array(FEATURE_DIM);
      features[idx] = 1;
      const postIds = uniquePostIds
        .map((pid) => ({ pid, w: effectiveWeightByPostId.get(pid) ?? 0 }))
        .filter((x) => {
          const owner = ownersByPostId.get(x.pid);
          return x.w > 0 && owner && owner !== userIdDec;
        })
        .sort((a, b) => (a.w !== b.w ? b.w - a.w : compareBigIntDesc(BigInt(a.pid), BigInt(b.pid))))
        .slice(0, Config.AI_POST_SEED_CLUSTER_POSTIDS_LIMIT)
        .map((x) => decToHex(x.pid));
      return [{ tags: tagsOut, features, weight: weightSum, postIds }];
    }
    const tagsByPostId = await loadTagsByPostId(materials.map((m) => m.postIdStr));
    const ownersByPostId = await loadOwnersByPostId(materials.map((m) => m.postIdStr));
    const actualClusters = Math.min(numClusters, materials.length);
    const seedFromUserId = (id: string): number => {
      const s = id.startsWith("0x") ? id.slice(2) : id;
      const tail = s.length > 8 ? s.slice(-8) : s;
      return parseInt(tail, 16) || 0;
    };
    const buildSeedFromCluster = (items: SeedMaterial[]): SearchSeed | null => {
      let weightSum = 0;
      const tagScores = new Map<string, number>();
      let sumVec: number[] | null = null;
      for (const m of items) {
        const w = m.effectiveWeight;
        weightSum += w;
        const tags = tagsByPostId.get(m.postIdStr) ?? [];
        for (const t of tags) {
          const tableScore = Math.log(1 + t.tableCount);
          tagScores.set(t.name, (tagScores.get(t.name) ?? 0) + w * tableScore);
        }
        if (!sumVec) sumVec = m.vec.map((x) => x * w);
        else for (let i = 0; i < sumVec.length; i++) sumVec[i] += m.vec[i] * w;
      }
      const topTags = Array.from(tagScores.entries())
        .sort((a, b) => (a[1] !== b[1] ? b[1] - a[1] : a[0].localeCompare(b[0])))
        .slice(0, ADOPT_TAG_LIMIT);
      const tagsOut: SearchSeedTag[] =
        topTags.length === 0
          ? []
          : (() => {
              const minScore = topTags[topTags.length - 1][1];
              if (minScore > 0) {
                return topTags.map(([name, score]) => ({
                  name,
                  count: Math.max(1, Math.round((score / minScore) * 10) / 10),
                }));
              }
              return topTags.map(([name]) => ({ name, count: 1 }));
            })();
      if (!sumVec || sumVec.length === 0) return null;
      const outFeatures = encodeFeatures(normalizeL2(sumVec));
      const postIds = items
        .filter((m) => {
          const owner = ownersByPostId.get(m.postIdStr);
          return owner && owner !== userIdDec;
        })
        .slice()
        .sort((a, b) =>
          a.effectiveWeight !== b.effectiveWeight
            ? b.effectiveWeight - a.effectiveWeight
            : compareBigIntDesc(a.postId, b.postId),
        )
        .slice(0, Config.AI_POST_SEED_CLUSTER_POSTIDS_LIMIT)
        .map((m) => decToHex(m.postIdStr));
      return { tags: tagsOut, features: outFeatures, weight: weightSum, postIds };
    };
    let clusters: SeedMaterial[][] = [];
    if (actualClusters <= 1) clusters = [materials];
    else if (materials.length < numClusters) {
      const sorted = materials
        .slice()
        .sort((a, b) =>
          a.effectiveWeight !== b.effectiveWeight
            ? b.effectiveWeight - a.effectiveWeight
            : compareBigIntDesc(a.postId, b.postId),
        );
      clusters = sorted.map((m) => [m]);
    } else {
      const vectors = materials.map((m) => m.vec);
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
    const seeds = clusters
      .filter((c) => c.length > 0)
      .map((c) => buildSeedFromCluster(c))
      .filter((s): s is SearchSeed => s !== null);
    if (seeds.length === 0) return [];
    seeds.sort((a, b) => {
      if (a.weight !== b.weight) return b.weight - a.weight;
      return (a.tags[0]?.name ?? "").localeCompare(b.tags[0]?.name ?? "");
    });
    return seeds;
  }

  async RecommendPosts(input: RecommendPostsInput): Promise<string[]> {
    const RANK_UP_BY_LIKES_LOG_BASE = 3;
    const RANK_DOWN_BY_REPLY = 2;
    const offset = clampPositiveInt(input.offset, 0);
    const limit = clampPositiveInt(input.limit, 100);
    const order = normalizeOrder(input.order, "desc");
    const selfUserIdDec = isNonEmptyString(input.selfUserId) ? hexToDec(input.selfUserId) : null;
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
    const ownerDecay =
      input.ownerDecay !== undefined &&
      typeof input.ownerDecay === "number" &&
      Number.isFinite(input.ownerDecay)
        ? Math.max(0, Math.min(1, input.ownerDecay))
        : null;
    const needOwnerDecay = ownerDecay !== null && ownerDecay !== 1;
    if (!Array.isArray(input.tags) || input.tags.length === 0) return [];
    const paramTagCounts = this.buildParamTagCounts(input.tags);
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
    const res = await pgQuery<RecommendDbRow>(
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
    let records: RecommendRecord[] = res.rows.map((r) => ({
      postId: BigInt(r.post_id),
      tag: r.tag,
      tableCount: r.table_count,
      isRoot: r.is_root,
      userId: r.user_id,
    }));
    if (selfUserIdDec) records = records.filter((r) => r.userId !== selfUserIdDec);
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
      if (!metaByPostId.has(r.postId))
        metaByPostId.set(r.postId, { isRoot: r.isRoot, userId: r.userId });
    }
    const sortedTagPosts = Array.from(tagTableCountsByPostId.entries()).sort((a, b) =>
      compareBigIntDesc(a[0], b[0]),
    );
    let tagRankScore = sortedTagPosts.length;
    const tagScores = new Map<string, number>();
    for (const [, tagMap] of sortedTagPosts) {
      for (const [tag] of tagMap.entries())
        tagScores.set(tag, (tagScores.get(tag) ?? 0) + tagRankScore);
      tagRankScore -= 1;
    }
    let totalTagScore = 0;
    for (const v of tagScores.values()) totalTagScore += v;
    if (totalTagScore === 0) return [];
    const tagIdfScores = new Map<string, number>();
    for (const [tag, score] of tagScores.entries())
      if (score > 0) tagIdfScores.set(tag, Math.log(totalTagScore / score));
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
        selfUserIdDec && followeeIds ? (followeeIds.has(meta.userId) ? 0.9 : 0.8) : 0.8;
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
    const scored = Array.from(postFinalScores.entries())
      .map(([postId, score]) => ({ postId, score }))
      .sort((a, b) =>
        a.score !== b.score ? b.score - a.score : compareBigIntDesc(a.postId, b.postId),
      );
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
    const seedPostIds = Array.isArray(input.seedPostIds)
      ? input.seedPostIds.filter(isNonEmptyString).map((s) => s.trim())
      : [];
    if (seedPostIds.length > 0) {
      const existing = new Set<string>(universe.map((c) => c.postId.toString()));
      const needFetch: string[] = [];
      for (const hid of seedPostIds) {
        const dec = safeHexToDec(hid);
        if (!dec) continue;
        if (existing.has(dec)) continue;
        existing.add(dec);
        needFetch.push(dec);
      }
      if (needFetch.length > 0) {
        const r = await pgQuery<PostFeaturesRow>(
          this.pgPool,
          `
          SELECT post_id, features
          FROM ai_post_summaries
          WHERE post_id = ANY($1::bigint[])
          AND features IS NOT NULL
          `,
          [needFetch],
        );
        for (const row of r.rows) {
          if (!row.features) continue;
          universe.push({ postId: BigInt(row.post_id), features: bufferToInt8Array(row.features) });
        }
      }
    }
    if (universe.length === 0) return [];
    let finalIds: bigint[] = universe.map((c) => c.postId);
    const needWork =
      !!input.features || dedupWeight > 0 || rerankByLikesAlpha > 0 || needOwnerDecay;
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
        ownerFactor?: number;
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
          if (!vec || vec.length !== qVec.length) baseScore = Number.NEGATIVE_INFINITY;
          else {
            const simRaw = cosineSimilarity(qVec, vec);
            baseScore = sigmoidalContrast((simRaw + 1) / 2, 5, 0.75);
          }
        }
        candidates.push({ postId: c.postId, vec, baseScore, adjScore: baseScore });
      }
      candidates.sort((a, b) =>
        a.baseScore !== b.baseScore
          ? b.baseScore - a.baseScore
          : compareBigIntDesc(a.postId, b.postId),
      );
      if (needOwnerDecay) {
        const decay = ownerDecay as number;
        const ownersById = new Map<string, string>();
        for (const [pid, meta] of metaByPostId.entries())
          if (isNonEmptyString(meta.userId)) ownersById.set(pid.toString(), meta.userId);
        const missing: string[] = [];
        for (const c of candidates) {
          const pid = c.postId.toString();
          if (!ownersById.has(pid)) missing.push(pid);
        }
        if (missing.length > 0) {
          type PostOwnerRow2 = { post_id: string; owned_by: string };
          const ownRes = await pgQuery<PostOwnerRow2>(
            this.pgPool,
            `
            SELECT id::text AS post_id, owned_by
            FROM posts
            WHERE id = ANY($1::bigint[])
            `,
            [missing],
          );
          for (const r of ownRes.rows)
            if (isNonEmptyString(r.owned_by)) ownersById.set(r.post_id, r.owned_by);
        }
        const seenByOwner = new Map<string, number>();
        for (const c of candidates) {
          const owner = ownersById.get(c.postId.toString()) ?? "";
          if (!owner) continue;
          const seen = seenByOwner.get(owner) ?? 0;
          const factor = Math.pow(decay, seen);
          c.ownerFactor = factor;
          if (factor === 0) {
            if (c.baseScore !== Number.NEGATIVE_INFINITY) c.baseScore = 0;
          } else {
            c.baseScore *= factor;
          }
          c.adjScore = c.baseScore;
          seenByOwner.set(owner, seen + 1);
        }
        candidates.sort((a, b) =>
          a.baseScore !== b.baseScore
            ? b.baseScore - a.baseScore
            : compareBigIntDesc(a.postId, b.postId),
        );
      }
      if (rerankByLikesAlpha > 0) {
        type PostMetaRow = { post_id: string; reply_to: string | null; owned_by: string };
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
        const metaRes = await pgQuery<PostMetaRow>(
          this.pgPool,
          `
          SELECT id::text AS post_id, reply_to, owned_by
          FROM posts
          WHERE id = ANY($1::bigint[])
          `,
          [ids],
        );
        const likesById = new Map<string, number>();
        for (const r of likeRes.rows) likesById.set(r.post_id, r.count_likes);
        const isRootById = new Map<string, boolean>();
        for (const r of metaRes.rows) isRootById.set(r.post_id, r.reply_to === null);
        for (let i = 0; i < candidates.length; i++) {
          const c = candidates[i];
          const pid = c.postId.toString();
          const likes = likesById.get(pid) ?? 0;
          const isRoot = isRootById.get(pid) ?? metaByPostId.get(c.postId)?.isRoot ?? true;
          let likeScore =
            Math.log(rerankByLikesAlpha + likes) / Math.log(RANK_UP_BY_LIKES_LOG_BASE) -
            i -
            (isRoot ? 0 : RANK_DOWN_BY_REPLY);
          if (needOwnerDecay && c.ownerFactor !== undefined) likeScore *= c.ownerFactor;
          c.likeScore = likeScore;
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
            adj = adj - simDup * dedupWeight;
          }
          c.adjScore = adj;
          if (c.vec) {
            if (!sumVec) sumVec = c.vec.slice();
            else if (sumVec.length === c.vec.length)
              for (let j = 0; j < sumVec.length; j++) sumVec[j] += c.vec[j];
          }
        }
        candidates.sort((a, b) => {
          if (a.adjScore !== b.adjScore) return b.adjScore - a.adjScore;
          if (a.baseScore !== b.baseScore) return b.baseScore - a.baseScore;
          return compareBigIntDesc(a.postId, b.postId);
        });
      }
      finalIds = candidates.map((c) => c.postId);
    }
    const ordered = order === "asc" ? [...finalIds].reverse() : finalIds;
    return ordered.slice(offset, offset + limit).map((pid) => decToHex(pid.toString()));
  }
}
