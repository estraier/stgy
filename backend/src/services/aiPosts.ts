import { Config } from "../config";
import { Pool } from "pg";
import { pgQuery } from "../utils/servers";
import {
  hexToDec,
  decToHex,
  bufferToInt8Array,
  int8ArrayToBuffer,
  serializeHashStringList,
  deserializeHashList,
  hashString,
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
  hashes: Buffer | null;
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
      keywordHashes: row.hashes ? deserializeHashList(row.hashes) : [],
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
        ) AS tags,
        aps.hashes
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
        ) AS tags,
        aps.hashes
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
      const summaryProvided = input.summary !== undefined;
      const featuresProvided = input.features !== undefined;
      const keywordsProvided = input.keywords !== undefined;
      if (summaryProvided || featuresProvided || keywordsProvided) {
        const featuresBytea =
          input.features === undefined
            ? undefined
            : input.features === null
              ? null
              : int8ArrayToBuffer(input.features);
        const hashesBytea = !keywordsProvided
          ? undefined
          : input.keywords!.length === 0
            ? null
            : Buffer.from(serializeHashStringList(input.keywords!));
        const cols: string[] = ["post_id"];
        const vals: string[] = ["$1"];
        const updates: string[] = ["updated_at = now()"];
        const params: unknown[] = [postIdDec];
        let p = 2;
        if (summaryProvided) {
          cols.push("summary");
          vals.push(`$${p}`);
          params.push(input.summary);
          updates.push("summary = EXCLUDED.summary");
          p++;
        }
        if (keywordsProvided) {
          cols.push("hashes");
          vals.push(`$${p}`);
          params.push(hashesBytea);
          updates.push("hashes = EXCLUDED.hashes");
          p++;
        }
        if (featuresProvided) {
          cols.push("features");
          vals.push(`$${p}`);
          params.push(featuresBytea);
          updates.push("features = EXCLUDED.features");
          p++;
        }
        cols.push("updated_at");
        vals.push("now()");
        await pgQuery(
          this.pgPool,
          `
          INSERT INTO ai_post_summaries (${cols.join(", ")})
          VALUES (${vals.join(", ")})
          ON CONFLICT (post_id) DO UPDATE
            SET ${updates.join(", ")}
          `,
          params,
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
    type SeedPostRow = { post_id: string; weight: number };
    type SeedPostFeaturesRow = { post_id: string; features: Buffer | null };
    type SeedTagRow = { post_id: string; name: string; table_count: number };
    type SeedMaterial = {
      postId: bigint;
      postIdStr: string;
      effectiveWeight: number;
      vec: number[];
    };
    const SELF_POST_LIMIT = 10;
    const SELF_LIKE_LIMIT = 20;
    const TOP_FOLLOWEE_LIMIT = 25;
    const FOLLOWEE_POST_LIMIT_PER_USER = 5;
    const FOLLOWEE_LIKE_LIMIT_PER_USER = 10;
    const EXTRA_TAG_NUM_RATIO = 2;
    const WEIGHT_GAMMA = 0.7;
    const WEIGHT_SELF_POST = 1.0;
    const WEIGHT_SELF_LIKE = 0.7;
    const WEIGHT_FOLLOWEE_POST = 0.3;
    const WEIGHT_FOLLOWEE_LIKE = 0.2;
    if (!Number.isInteger(numClusters) || numClusters <= 0) throw new Error("invalid numClusters");
    const userIdDec = hexToDec(userId);
    const round3 = (x: number) => Math.round(x * 1000) / 1000;
    const floor3 = (x: number) => Math.floor(x * 1000) / 1000;
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
      baseWeightByPostId.set(pid, (baseWeightByPostId.get(pid) ?? 0) + r.weight);
    }
    const uniquePostIds = Array.from(baseWeightByPostId.keys());
    const sortedPids = uniquePostIds
      .slice()
      .sort((a, b) => compareBigIntDesc(BigInt(a), BigInt(b)));
    const adjustedWeightByPostId = new Map<string, number>();
    const decay = Math.pow(0.8, 1 / sortedPids.length);
    let postSeqWeight = 1.0;
    for (const pid of sortedPids) {
      const w = baseWeightByPostId.get(pid) ?? 0;
      adjustedWeightByPostId.set(pid, w * postSeqWeight);
      postSeqWeight *= decay;
    }
    let totalBaseWeight = 0;
    for (const w of adjustedWeightByPostId.values()) totalBaseWeight += w;
    const effectiveWeightByPostId = new Map<string, number>();
    for (const pid of sortedPids) {
      const w = adjustedWeightByPostId.get(pid) ?? 0;
      const p = w / totalBaseWeight;
      effectiveWeightByPostId.set(pid, Math.pow(p, WEIGHT_GAMMA));
    }
    const buildTagsAndExtraTags = (
      tagScores: Map<string, number>,
    ): { tags: SearchSeedTag[]; extraTags: SearchSeedTag[] } => {
      const ranked = Array.from(tagScores.entries())
        .sort((a, b) => (a[1] !== b[1] ? b[1] - a[1] : a[0].localeCompare(b[0])))
        .slice(0, Config.AI_POST_SEED_NUM_TAGS * (EXTRA_TAG_NUM_RATIO + 1));
      if (ranked.length === 0) return { tags: [], extraTags: [] };
      const top = ranked.slice(0, Math.min(Config.AI_POST_SEED_NUM_TAGS, ranked.length));
      const pivot = top.length > 0 ? top[top.length - 1][1] : 0;
      if (!(pivot > 0)) return { tags: top.map(([name]) => ({ name, count: 1 })), extraTags: [] };
      const tags = top.map(([name, score]) => ({
        name,
        count: Math.max(1, round3(score / pivot)),
      }));
      const extraTags: SearchSeedTag[] = [];
      for (let i = Config.AI_POST_SEED_NUM_TAGS; i < ranked.length; i++) {
        const [name, score] = ranked[i];
        const raw = score / pivot;
        if (!(raw < 1)) continue;
        const cnt = Math.min(floor3(raw), 0.999);
        if (!(cnt > 0)) continue;
        extraTags.push({ name, count: cnt });
      }
      return { tags, extraTags };
    };
    const buildKeywordHashes = (
      keywordScores: Map<number, number>,
    ): { hash: number; count: number }[] => {
      const rankedAll = Array.from(keywordScores.entries()).sort((a, b) =>
        a[1] !== b[1] ? b[1] - a[1] : a[0] - b[0],
      );
      if (rankedAll.length === 0) return [];
      const topN = Math.min(
        Config.AI_POST_SEED_NUM_TAGS,
        rankedAll.length,
        Config.AI_POST_SEED_NUM_KEYWORD_HASHES,
      );
      const top = rankedAll.slice(0, topN);
      const pivot = top[top.length - 1]?.[1] ?? 0;
      if (!(pivot > 0)) return top.map(([hash]) => ({ hash, count: 1 }));
      const out: { hash: number; count: number }[] = top.map(([hash, score]) => ({
        hash,
        count: Math.max(1, round3(score / pivot)),
      }));
      for (
        let i = topN;
        i < rankedAll.length && out.length < Config.AI_POST_SEED_NUM_KEYWORD_HASHES;
        i++
      ) {
        const [hash, score] = rankedAll[i];
        const raw = score / pivot;
        if (!(raw < 1)) continue;
        const cnt = Math.min(floor3(raw), 0.999);
        if (!(cnt > 0)) continue;
        out.push({ hash, count: cnt });
      }
      return out;
    };
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
    type SeedKeywordHashesRow = { post_id: string; hashes: Buffer | null };
    const loadKeywordHashesByPostId = async (
      postIds: string[],
    ): Promise<Map<string, { hash: number; count: number }[]>> => {
      if (postIds.length === 0) return new Map();
      const r = await pgQuery<SeedKeywordHashesRow>(
        this.pgPool,
        `
        SELECT post_id, hashes
        FROM ai_post_summaries
        WHERE post_id = ANY($1::bigint[])
          AND hashes IS NOT NULL
        `,
        [postIds],
      );
      const out = new Map<string, { hash: number; count: number }[]>();
      for (const row of r.rows) {
        if (!row.hashes) continue;
        let list: { hash: number; count: number }[] = [];
        try {
          const v = deserializeHashList(row.hashes);
          if (Array.isArray(v)) {
            const counts = new Map<number, number>();
            for (const x of v) {
              if (typeof x !== "number" || !Number.isFinite(x)) continue;
              const h = x >>> 0;
              counts.set(h, (counts.get(h) ?? 0) + 1);
            }
            list = Array.from(counts.entries())
              .map(([hash, count]) => ({ hash, count }))
              .filter((x) => x.count > 0);
          }
        } catch {
          list = [];
        }
        if (list.length > 0) out.set(row.post_id, list);
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
    if (materials.length === 0) return [];
    const matPostIds = materials.map((m) => m.postIdStr);
    const tagsByPostId = await loadTagsByPostId(matPostIds);
    const keywordHashesByPostId = await loadKeywordHashesByPostId(matPostIds);
    const ownersByPostId = await loadOwnersByPostId(matPostIds);
    const actualClusters = Math.min(numClusters, materials.length);
    const seedFromUserId = (id: string): number => {
      const tail = id.length > 8 ? id.slice(-8) : id;
      return parseInt(tail, 16) || 0;
    };
    const buildSeedFromCluster = (items: SeedMaterial[]): SearchSeed | null => {
      let weightSum = 0;
      const tagScores = new Map<string, number>();
      const keywordScores = new Map<number, number>();
      let sumVec: number[] | null = null;
      for (const m of items) {
        const w = m.effectiveWeight;
        weightSum += w;
        const tags = tagsByPostId.get(m.postIdStr) ?? [];
        for (const t of tags) {
          const tableScore = Math.log(1 + t.tableCount);
          tagScores.set(t.name, (tagScores.get(t.name) ?? 0) + w * tableScore);
        }
        const hashes = keywordHashesByPostId.get(m.postIdStr) ?? [];
        for (const h of hashes) {
          const tableScore = Math.log(1 + h.count);
          keywordScores.set(h.hash, (keywordScores.get(h.hash) ?? 0) + w * tableScore);
        }
        if (!sumVec) sumVec = m.vec.map((x) => x * w);
        else for (let i = 0; i < sumVec.length; i++) sumVec[i] += m.vec[i] * w;
      }
      const { tags: tagsOut, extraTags: extraTagsOut } = buildTagsAndExtraTags(tagScores);
      const keywordHashesOut = buildKeywordHashes(keywordScores);
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
      weightSum = round3(weightSum);
      return {
        tags: tagsOut,
        extraTags: extraTagsOut,
        keywordHashes: keywordHashesOut,
        features: outFeatures,
        weight: weightSum,
        postIds,
      };
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
      const an = a.tags[0]?.name ?? "";
      const bn = b.tags[0]?.name ?? "";
      if (an.length !== bn.length) return an.length - bn.length;
      return an.localeCompare(bn);
    });
    return seeds;
  }

  async RecommendPosts(input: RecommendPostsInput): Promise<string[]> {
    type RecommendFolloweeRow = { followee_id: string };
    type RecommendDbRowLocal = {
      post_id: string;
      tag: string;
      table_count: number;
      is_root: boolean;
      user_id: string;
    };
    type RecommendRecordLocal = {
      postId: bigint;
      tag: string;
      tableCount: number;
      isRoot: boolean;
      userId: string;
    };
    type RecommendCandidateLocal = { postId: bigint; features: Int8Array | null };
    type RecommendPostFeaturesRowLocal = { post_id: string; features: Buffer | null };
    type RecommendPostLikesCountRowLocal = { post_id: string; count_likes: number };
    type RecommendPostKeywordHashesRowLocal = { post_id: string; hashes: Buffer | null };
    const buildParamKeywordHashCounts = (keywordHashes: unknown): Map<number, number> => {
      const m = new Map<number, number>();
      if (!Array.isArray(keywordHashes)) return m;
      for (const kh of keywordHashes) {
        const hash =
          typeof (kh as { hash?: unknown })?.hash === "number" &&
          Number.isFinite((kh as { hash: number }).hash)
            ? (kh as { hash: number }).hash >>> 0
            : null;
        const count =
          typeof (kh as { count?: unknown })?.count === "number" &&
          Number.isFinite((kh as { count: number }).count)
            ? (kh as { count: number }).count
            : 0;
        if (hash === null || !(count > 0)) continue;
        m.set(hash, (m.get(hash) ?? 0) + count);
      }
      return m;
    };
    const offset = clampPositiveInt(input.offset, 0);
    const limit = clampPositiveInt(input.limit, 100);
    const order = normalizeOrder(input.order, "desc");
    const selfUserIdDec = isNonEmptyString(input.selfUserId) ? hexToDec(input.selfUserId) : null;
    const promotionByLikesAlpha =
      typeof input.promotionByLikesAlpha === "number" &&
      Number.isFinite(input.promotionByLikesAlpha) &&
      input.promotionByLikesAlpha > 0
        ? input.promotionByLikesAlpha
        : 0;
    const promotionForSeedPosts =
      typeof input.promotionForSeedPosts === "number" &&
      Number.isFinite(input.promotionForSeedPosts) &&
      input.promotionForSeedPosts > 0
        ? input.promotionForSeedPosts
        : 0;
    const demotionForReplies =
      typeof input.demotionForReplies === "number" &&
      Number.isFinite(input.demotionForReplies) &&
      input.demotionForReplies > 0
        ? input.demotionForReplies
        : 0;
    const demotionForDuplication =
      typeof input.demotionForDuplication === "number" &&
      Number.isFinite(input.demotionForDuplication) &&
      input.demotionForDuplication > 0
        ? input.demotionForDuplication
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
    const paramKeywordCounts = buildParamKeywordHashCounts(input.keywordHashes);
    const seedPostIdsHex = Array.isArray(input.seedPostIds)
      ? input.seedPostIds.filter(isNonEmptyString).map((s) => s.trim())
      : [];
    const seedPostIdsDecOrdered: string[] = [];
    const seedIndexByDec = new Map<string, number>();
    for (const hid of seedPostIdsHex) {
      const dec = safeHexToDec(hid);
      if (!dec) continue;
      if (seedIndexByDec.has(dec)) continue;
      seedIndexByDec.set(dec, seedPostIdsDecOrdered.length);
      seedPostIdsDecOrdered.push(dec);
    }
    const seedN = seedPostIdsDecOrdered.length;
    let followeeIds: Set<string> | null = null;
    if (selfUserIdDec) {
      const fr = await pgQuery<RecommendFolloweeRow>(
        this.pgPool,
        `SELECT followee_id FROM user_follows WHERE follower_id = $1`,
        [selfUserIdDec],
      );
      followeeIds = new Set(fr.rows.map((r) => r.followee_id));
    }
    const res = await pgQuery<RecommendDbRowLocal>(
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
          SELECT tag, post_id, COUNT(DISTINCT src)::int AS table_count
          FROM raw
          GROUP BY tag, post_id
        )
        SELECT a.post_id, a.tag, a.table_count, (p.reply_to IS NULL) AS is_root, p.owned_by AS user_id
        FROM agg a
        JOIN posts p ON p.id = a.post_id
      `,
      [queryTags, Config.AI_POST_RECOMMEND_TAG_CANDIDATES],
    );
    let records: RecommendRecordLocal[] = res.rows.map((r) => ({
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
      if (score > 0) tagIdfScores.set(tag, Math.log((totalTagScore + 1) / (score + 1)) + 0.5);
    const tagHashIdfScores = new Map<number, number>();
    let idfSum = 0;
    let idfCount = 0;
    for (const [tag, idf] of tagIdfScores.entries()) {
      const h = hashString(tag);
      const prev = tagHashIdfScores.get(h);
      if (prev === undefined || idf > prev) tagHashIdfScores.set(h, idf);
      idfSum += idf;
      idfCount += 1;
    }
    const avgIdfScore = idfCount > 0 ? idfSum / idfCount : 0;
    const fallbackIdfScore = avgIdfScore / 2;
    const sortedPostIds = Array.from(tagTableCountsByPostId.keys()).sort(compareBigIntDesc);
    const keywordCountsByPostId = new Map<bigint, Map<number, number>>();
    const postIdsForKeywords = sortedPostIds.map((pid) => pid.toString());
    if (postIdsForKeywords.length > 0) {
      const khRes = await pgQuery<RecommendPostKeywordHashesRowLocal>(
        this.pgPool,
        `
          SELECT post_id, hashes
          FROM ai_post_summaries
          WHERE post_id = ANY($1::bigint[])
            AND hashes IS NOT NULL
        `,
        [postIdsForKeywords],
      );
      for (const row of khRes.rows) {
        if (!row.hashes) continue;
        const hashes: number[] = [];
        try {
          const v = deserializeHashList(row.hashes);
          if (Array.isArray(v))
            for (const x of v)
              if (typeof x === "number" && Number.isFinite(x)) hashes.push(x >>> 0);
        } catch {
          continue;
        }
        if (hashes.length === 0) continue;
        const pid = BigInt(row.post_id);
        let m = keywordCountsByPostId.get(pid);
        if (!m) {
          m = new Map<number, number>();
          keywordCountsByPostId.set(pid, m);
        }
        for (const h of hashes) m.set(h, (m.get(h) ?? 0) + 1);
      }
    }
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
      let tagScore = 0;
      for (const [tag, tableCount] of tagMap.entries()) {
        const idfScore = tagIdfScores.get(tag);
        const paramCount = paramTagCounts.get(tag) ?? 0;
        const tfArg = tableCount + paramCount;
        if (idfScore === undefined || tfArg <= 0) continue;
        tagScore += Math.log(tfArg) * idfScore;
      }
      let keywordScore = 0;
      const keywordMap = keywordCountsByPostId.get(postId);
      if (keywordMap) {
        for (const [hash, tableCount] of keywordMap.entries()) {
          const paramCount = paramKeywordCounts.get(hash) ?? 0;
          if (paramCount <= 0) continue;
          const idfScore = tagHashIdfScores.get(hash) ?? fallbackIdfScore;
          const tfArg = tableCount + paramCount;
          if (tfArg <= 0) continue;
          keywordScore += Math.log(tfArg) * idfScore;
        }
      }
      const combined = tagScore + keywordScore;
      const postFinalScore = combined * rankScore * rootScore * socialScore;
      postFinalScores.set(postId, postFinalScore);
    }
    const scored = Array.from(postFinalScores.entries())
      .map(([postId, score]) => ({ postId, score }))
      .sort((a, b) =>
        a.score !== b.score ? b.score - a.score : compareBigIntDesc(a.postId, b.postId),
      );
    const universe: RecommendCandidateLocal[] = [];
    const FETCH_VECTOR_CHUNK_SIZE = 100;
    for (
      let i = 0;
      i < scored.length && universe.length < Config.AI_POST_RECOMMEND_VEC_CANDIDATES;
      i += FETCH_VECTOR_CHUNK_SIZE
    ) {
      const chunk = scored.slice(i, i + FETCH_VECTOR_CHUNK_SIZE);
      const ids = chunk.map((c) => c.postId.toString());
      const r = await pgQuery<RecommendPostFeaturesRowLocal>(
        this.pgPool,
        `
          SELECT post_id, features
          FROM ai_post_summaries
          WHERE post_id = ANY($1::bigint[])
        `,
        [ids],
      );
      const byId = new Map<string, RecommendPostFeaturesRowLocal>();
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
    if (seedPostIdsHex.length > 0) {
      const existing = new Set<string>(universe.map((c) => c.postId.toString()));
      const needFetch: string[] = [];
      for (const hid of seedPostIdsHex) {
        const dec = safeHexToDec(hid);
        if (!dec) continue;
        if (existing.has(dec)) continue;
        existing.add(dec);
        needFetch.push(dec);
      }
      if (needFetch.length > 0) {
        const r = await pgQuery<RecommendPostFeaturesRowLocal>(
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
    let qVec: number[] | null = null;
    if (input.features) {
      try {
        qVec = normalizeL2(decodeFeatures(input.features));
      } catch {
        qVec = null;
      }
    }
    const needVecDecode = !!qVec || demotionForDuplication > 0;
    const candidates: {
      postId: bigint;
      vec: number[] | null;
      baseScore: number;
      socialRank: number;
      dedupedRank?: number;
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
      candidates.push({ postId: c.postId, vec, baseScore, socialRank: 0 });
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
        if (factor === 0) {
          if (c.baseScore !== Number.NEGATIVE_INFINITY) c.baseScore = 0;
        } else {
          c.baseScore *= factor;
        }
        seenByOwner.set(owner, seen + 1);
      }
      candidates.sort((a, b) =>
        a.baseScore !== b.baseScore
          ? b.baseScore - a.baseScore
          : compareBigIntDesc(a.postId, b.postId),
      );
    }
    const likesById = new Map<string, number>();
    if (promotionByLikesAlpha > 0) {
      const ids = candidates.map((c) => c.postId.toString());
      const likeRes = await pgQuery<RecommendPostLikesCountRowLocal>(
        this.pgPool,
        `
          SELECT post_id, COUNT(*)::int AS count_likes
          FROM post_likes
          WHERE post_id = ANY($1::bigint[])
          GROUP BY post_id
        `,
        [ids],
      );
      for (const r of likeRes.rows) likesById.set(r.post_id, r.count_likes);
    }
    const isRootById = new Map<string, boolean>();
    if (demotionForReplies > 0) {
      type PostReplyRow = { post_id: string; reply_to: string | null };
      const ids = candidates.map((c) => c.postId.toString());
      const metaRes = await pgQuery<PostReplyRow>(
        this.pgPool,
        `
          SELECT id::text AS post_id, reply_to
          FROM posts
          WHERE id = ANY($1::bigint[])
        `,
        [ids],
      );
      for (const r of metaRes.rows) isRootById.set(r.post_id, r.reply_to === null);
    }
    for (let i = 0; i < candidates.length; i++) {
      const RANK_UP_BY_LIKES_LOG_BASE = 3;
      const c = candidates[i];
      const pid = c.postId.toString();
      let rank = i;
      if (promotionByLikesAlpha > 0) {
        const likes = likesById.get(pid) ?? 0;
        rank -= Math.log(promotionByLikesAlpha + likes) / Math.log(RANK_UP_BY_LIKES_LOG_BASE);
      }
      if (demotionForReplies > 0) {
        const isRoot = isRootById.get(pid) ?? metaByPostId.get(c.postId)?.isRoot ?? true;
        if (!isRoot) rank += demotionForReplies;
      }
      if (promotionForSeedPosts > 0 && seedN > 0) {
        const idx = seedIndexByDec.get(pid);
        if (idx !== undefined) rank -= (promotionForSeedPosts * (seedN - idx)) / seedN;
      }
      c.socialRank = rank;
    }
    candidates.sort((a, b) =>
      a.socialRank !== b.socialRank
        ? a.socialRank - b.socialRank
        : a.baseScore !== b.baseScore
          ? b.baseScore - a.baseScore
          : compareBigIntDesc(a.postId, b.postId),
    );
    if (demotionForDuplication > 0) {
      const DEDUP_MIN_SIMILALITY = 0.8;
      let sumVec: number[] | null = null;
      for (let i = 0; i < candidates.length; i++) {
        const c = candidates[i];
        let sim = 0;
        if (i > 0 && sumVec && c.vec && sumVec.length === c.vec.length) {
          const simRaw = cosineSimilarity(sumVec, c.vec);
          sim = sigmoidalContrast((simRaw + 1) / 2, 5, 0.75);
        }
        const w =
          sim > DEDUP_MIN_SIMILALITY
            ? (sim - DEDUP_MIN_SIMILALITY) / (1 - DEDUP_MIN_SIMILALITY)
            : 0;
        c.dedupedRank = i + w * demotionForDuplication;
        if (c.vec) {
          if (!sumVec) sumVec = c.vec.slice();
          else if (sumVec.length === c.vec.length)
            for (let j = 0; j < sumVec.length; j++) sumVec[j] += c.vec[j];
        }
      }
      candidates.sort((a, b) => {
        const ar = a.dedupedRank ?? Number.POSITIVE_INFINITY;
        const br = b.dedupedRank ?? Number.POSITIVE_INFINITY;
        if (ar !== br) return ar - br;
        return compareBigIntDesc(a.postId, b.postId);
      });
    }
    const finalIds = candidates.map((c) => c.postId);
    const ordered = order === "asc" ? [...finalIds].reverse() : finalIds;
    return ordered.slice(offset, offset + limit).map((pid) => decToHex(pid.toString()));
  }
}
