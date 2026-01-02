import { jest } from "@jest/globals";
import { AiPostsService } from "./aiPosts";
import type { Pool } from "pg";
import type {
  ListAiPostSummariesInput,
  RecommendPostsInput,
  UpdateAiPostSummaryInput,
} from "../models/aiPost";
import { decToHex, hexToDec } from "../utils/format";
import {
  decodeFeatures,
  encodeFeatures,
  cosineSimilarity,
  sigmoidalContrast,
  normalizeL2,
} from "../utils/vectorSpace";

jest.mock("../config", () => {
  return {
    Config: {
      AI_POST_RECOMMEND_TAG_CANDIDATES: 100,
      AI_POST_RECOMMEND_VEC_CANDIDATES: 100,
    },
  };
});

jest.mock("../utils/servers", () => {
  const pgQuery = jest.fn((pool: unknown, sql: string, params?: unknown[]) =>
    (pool as { query: (sql: string, params?: unknown[]) => unknown }).query(sql, params),
  );
  return { pgQuery };
});

function normalizeSql(sql: string) {
  return sql.replace(/\s+/g, " ").trim();
}

let hex16Counter = 1n;
const hex16 = () => {
  const out = hex16Counter.toString(16).toUpperCase().padStart(16, "0");
  hex16Counter += 1n;
  return out;
};

beforeEach(() => {
  hex16Counter = 1n;
});

const toDecStr = (hex: string) => String(hexToDec(hex));
const toHexStrFromDec = (dec: string) => decToHex(dec);

function int8eq(a: Int8Array | null | undefined, b: Int8Array): boolean {
  if (!a) return false;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

type MockAiPostSummaryRow = {
  postId: string;
  summary: string | null;
  features: Buffer | null;
  updatedAt: string;
};

type MockAiPostTagRow = {
  postId: string;
  name: string;
};

type MockPostTagRow = {
  postId: string;
  name: string;
};

type MockPostRow = {
  postId: string;
  replyTo: string | null;
  userId: string;
  publishedAt: string | null;
  countLikes?: number;
};

type MockFollowRow = {
  followerId: string;
  followeeId: string;
};

type MockPostLikeRow = {
  postId: string;
  likedBy: string;
  createdAt: string;
};

class MockPgClient {
  summaries: MockAiPostSummaryRow[] = [];
  tags: MockAiPostTagRow[] = [];
  postTags: MockPostTagRow[] = [];
  posts: MockPostRow[] = [];
  follows: MockFollowRow[] = [];
  likes: MockPostLikeRow[] = [];

  async query(sql: string, params?: unknown[]) {
    sql = normalizeSql(sql);

    if (sql === "BEGIN" || sql === "COMMIT" || sql === "ROLLBACK") {
      return { rows: [], rowCount: 0 };
    }

    if (
      sql.includes("WITH") &&
      sql.includes("self_posts AS") &&
      sql.includes("self_likes AS") &&
      sql.includes("followee_posts AS") &&
      sql.includes("followee_likes AS") &&
      sql.includes("seed_posts AS") &&
      sql.includes("SELECT post_id, weight") &&
      sql.includes("FROM seed_posts")
    ) {
      const userId = params ? String(params[0]) : "";
      const selfPostLimit = typeof params?.[1] === "number" ? (params?.[1] as number) : 10;
      const selfLikeLimit = typeof params?.[2] === "number" ? (params?.[2] as number) : 10;
      const topFolloweeLimit = typeof params?.[3] === "number" ? (params?.[3] as number) : 10;
      const followeePostLimit = typeof params?.[4] === "number" ? (params?.[4] as number) : 2;
      const followeeLikeLimit = typeof params?.[5] === "number" ? (params?.[5] as number) : 10;

      const wSelfPost = typeof params?.[6] === "number" ? (params?.[6] as number) : 1.0;
      const wSelfLike = typeof params?.[7] === "number" ? (params?.[7] as number) : 0.7;
      const wFolloweePost = typeof params?.[8] === "number" ? (params?.[8] as number) : 0.5;
      const wFolloweeLike = typeof params?.[9] === "number" ? (params?.[9] as number) : 0.3;

      const sortPostIdDesc = (a: string, b: string) => {
        const aa = BigInt(a);
        const bb = BigInt(b);
        if (aa === bb) return 0;
        return aa > bb ? -1 : 1;
      };

      const selfPosts = this.posts
        .filter((p) => p.userId === userId)
        .map((p) => p.postId)
        .sort(sortPostIdDesc)
        .slice(0, Math.max(0, selfPostLimit));

      const selfLikes = this.likes
        .filter((l) => l.likedBy === userId)
        .slice()
        .sort((a, b) => (a.createdAt === b.createdAt ? 0 : a.createdAt < b.createdAt ? 1 : -1))
        .map((l) => l.postId)
        .slice(0, Math.max(0, selfLikeLimit));

      const followees = this.follows
        .filter((f) => f.followerId === userId)
        .map((f) => f.followeeId);

      const lastPostByFollowee = new Map<string, string>();
      for (const fid of followees) {
        const ids = this.posts
          .filter((p) => p.userId === fid)
          .map((p) => p.postId)
          .sort(sortPostIdDesc);
        if (ids.length > 0) lastPostByFollowee.set(fid, ids[0]);
      }

      const topFollowees = Array.from(lastPostByFollowee.entries())
        .sort((a, b) => sortPostIdDesc(a[1], b[1]))
        .map(([fid]) => fid)
        .slice(0, Math.max(0, topFolloweeLimit));

      const followeePosts: string[] = [];
      for (const fid of topFollowees) {
        const ids = this.posts
          .filter((p) => p.userId === fid)
          .map((p) => p.postId)
          .sort(sortPostIdDesc)
          .slice(0, Math.max(0, followeePostLimit));
        followeePosts.push(...ids);
      }

      const followeeLikes: string[] = [];
      for (const fid of topFollowees) {
        const ids = this.likes
          .filter((l) => l.likedBy === fid)
          .slice()
          .sort((a, b) => (a.createdAt === b.createdAt ? 0 : a.createdAt < b.createdAt ? 1 : -1))
          .map((l) => l.postId)
          .slice(0, Math.max(0, followeeLikeLimit));
        followeeLikes.push(...ids);
      }

      const rows: { post_id: string; weight: number }[] = [];
      for (const id of selfPosts) rows.push({ post_id: id, weight: wSelfPost });
      for (const id of selfLikes) rows.push({ post_id: id, weight: wSelfLike });
      for (const id of followeePosts) rows.push({ post_id: id, weight: wFolloweePost });
      for (const id of followeeLikes) rows.push({ post_id: id, weight: wFolloweeLike });

      return { rows };
    }

    if (
      sql.includes("WITH raw AS (") &&
      sql.includes("FROM post_tags") &&
      sql.includes("FROM ai_post_tags") &&
      sql.includes("COUNT(DISTINCT src)") &&
      sql.includes("GROUP BY post_id, name") &&
      sql.includes("ORDER BY post_id, name")
    ) {
      const arrParam = (params ?? []).find((p) => Array.isArray(p)) as unknown[] | undefined;
      const ids = arrParam ? arrParam.map((x) => String(x)) : [];
      const idSet = new Set(ids);

      const byKey = new Map<string, Set<string>>();
      const add = (postId: string, name: string, src: string) => {
        const key = `${postId}\t${name}`;
        let s = byKey.get(key);
        if (!s) {
          s = new Set<string>();
          byKey.set(key, s);
        }
        s.add(src);
      };

      for (const t of this.postTags) {
        if (!idSet.has(String(t.postId))) continue;
        const name = String(t.name ?? "").trim();
        if (!name) continue;
        add(String(t.postId), name, "post");
      }
      for (const t of this.tags) {
        if (!idSet.has(String(t.postId))) continue;
        const name = String(t.name ?? "").trim();
        if (!name) continue;
        add(String(t.postId), name, "ai");
      }

      const rows: { post_id: string; name: string; table_count: number }[] = [];
      for (const [key, srcs] of byKey.entries()) {
        const [postId, name] = key.split("\t");
        rows.push({ post_id: postId, name, table_count: srcs.size });
      }

      rows.sort((a, b) => {
        const aa = BigInt(a.post_id);
        const bb = BigInt(b.post_id);
        if (aa !== bb) return aa < bb ? -1 : 1;
        return a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
      });

      return { rows };
    }

    if (
      sql.startsWith("SELECT id, owned_by") &&
      sql.includes("FROM posts") &&
      sql.includes("WHERE id = ANY($1::bigint[])")
    ) {
      const arrParam = (params ?? []).find((p) => Array.isArray(p)) as unknown[] | undefined;
      const ids = arrParam ? arrParam.map((x) => String(x)) : [];
      const postIndex = new Map<string, MockPostRow>();
      for (const p of this.posts) postIndex.set(p.postId, p);
      const rows = ids
        .map((id) => {
          const p = postIndex.get(id);
          if (!p) return null;
          return { id, owned_by: p.userId };
        })
        .filter((x): x is NonNullable<typeof x> => x !== null);
      return { rows };
    }

    if (
      sql.startsWith("SELECT followee_id") &&
      sql.includes("FROM user_follows") &&
      sql.includes("WHERE follower_id = $1")
    ) {
      const followerId = params ? String(params[0]) : "";
      const rows = this.follows
        .filter((f) => f.followerId === followerId)
        .map((f) => ({ followee_id: f.followeeId }));
      return { rows };
    }

    if (
      sql.startsWith("SELECT 1") &&
      sql.includes("FROM ai_post_summaries aps") &&
      sql.includes("WHERE aps.post_id = $1") &&
      sql.includes("aps.summary IS NOT NULL") &&
      sql.includes("LIMIT 1")
    ) {
      const postId = params ? String(params[0]) : "";
      const exists = this.summaries.some((row) => row.postId === postId && row.summary !== null);
      return { rows: exists ? [{ ok: 1 }] : [] };
    }

    if (
      sql.startsWith("SELECT aps.post_id, aps.updated_at, aps.summary, aps.features") &&
      sql.includes("FROM ai_post_summaries aps") &&
      sql.includes("WHERE aps.post_id = $1")
    ) {
      const postId = params ? String(params[0]) : "";
      const s = this.summaries.find((row) => row.postId === postId);
      if (!s) return { rows: [] };
      const tags = this.tags
        .filter((t) => t.postId === postId)
        .map((t) => t.name)
        .sort();
      return {
        rows: [
          {
            post_id: s.postId,
            updated_at: s.updatedAt,
            summary: s.summary,
            features: s.features,
            tags,
          },
        ],
      };
    }

    if (
      sql.startsWith("SELECT aps.post_id, aps.updated_at, aps.summary, aps.features") &&
      sql.includes("FROM ai_post_summaries aps") &&
      sql.includes("ORDER BY aps.post_id")
    ) {
      const offset = (params && (params[params.length - 2] as number)) ?? 0;
      const limit = (params && (params[params.length - 1] as number)) ?? 100;

      let newerThan: string | undefined;
      if (sql.includes("aps.updated_at >") && params && params.length >= 3) {
        newerThan = params[0] as string;
      }

      let list = this.summaries.slice();
      if (sql.includes("aps.summary IS NULL")) {
        list = list.filter((s) => s.summary === null);
      }
      if (newerThan) {
        list = list.filter((s) => s.updatedAt > newerThan);
      }

      const desc = sql.includes("ORDER BY aps.post_id DESC");
      list.sort((a, b) => {
        const aNum = BigInt(a.postId);
        const bNum = BigInt(b.postId);
        if (aNum === bNum) return 0;
        if (desc) return aNum < bNum ? 1 : -1;
        return aNum < bNum ? -1 : 1;
      });

      const sliced = list.slice(offset, offset + limit);
      const rows = sliced.map((s) => ({
        post_id: s.postId,
        updated_at: s.updatedAt,
        summary: s.summary,
        features: s.features,
        tags: this.tags
          .filter((t) => t.postId === s.postId)
          .map((t) => t.name)
          .sort(),
      }));
      return { rows };
    }

    if (
      sql.startsWith(
        "INSERT INTO ai_post_summaries (post_id, summary, features, updated_at) VALUES ($1, $2, $3, now()) ON CONFLICT (post_id) DO UPDATE SET summary = EXCLUDED.summary, features = EXCLUDED.features, updated_at = now()",
      )
    ) {
      const postId = params ? String(params[0]) : "";
      const summary = (params?.[1] as string | null) ?? null;
      const features = (params?.[2] as Buffer | null) ?? null;
      const now = new Date().toISOString();

      const existing = this.summaries.find((s) => s.postId === postId);
      if (existing) {
        existing.summary = summary;
        existing.features = features;
        existing.updatedAt = now;
      } else {
        this.summaries.push({
          postId,
          summary,
          features,
          updatedAt: now,
        });
      }
      return { rowCount: 1, rows: [] };
    }

    if (
      sql.startsWith(
        "INSERT INTO ai_post_summaries (post_id, summary, updated_at) VALUES ($1, $2, now()) ON CONFLICT (post_id) DO UPDATE SET summary = EXCLUDED.summary, updated_at = now()",
      )
    ) {
      const postId = params ? String(params[0]) : "";
      const summary = (params?.[1] as string | null) ?? null;
      const now = new Date().toISOString();

      const existing = this.summaries.find((s) => s.postId === postId);
      if (existing) {
        existing.summary = summary;
        existing.updatedAt = now;
      } else {
        this.summaries.push({
          postId,
          summary,
          features: null,
          updatedAt: now,
        });
      }
      return { rowCount: 1, rows: [] };
    }

    if (
      sql.startsWith(
        "INSERT INTO ai_post_summaries (post_id, features, updated_at) VALUES ($1, $2, now()) ON CONFLICT (post_id) DO UPDATE SET features = EXCLUDED.features, updated_at = now()",
      )
    ) {
      const postId = params ? String(params[0]) : "";
      const features = (params?.[1] as Buffer | null) ?? null;
      const now = new Date().toISOString();

      const existing = this.summaries.find((s) => s.postId === postId);
      if (existing) {
        existing.features = features;
        existing.updatedAt = now;
      } else {
        this.summaries.push({
          postId,
          summary: null,
          features,
          updatedAt: now,
        });
      }
      return { rowCount: 1, rows: [] };
    }

    if (sql.startsWith("DELETE FROM ai_post_tags WHERE post_id = $1")) {
      const postId = params ? String(params[0]) : "";
      const before = this.tags.length;
      this.tags = this.tags.filter((t) => t.postId !== postId);
      return { rowCount: before - this.tags.length, rows: [] };
    }

    if (
      sql.startsWith("INSERT INTO ai_post_tags (post_id, name)") &&
      sql.includes("FROM unnest($2::text[])")
    ) {
      const postId = params ? String(params[0]) : "";
      const tagArray = (params?.[1] as string[]) ?? [];
      for (const name of tagArray) {
        this.tags.push({ postId, name });
      }
      return { rowCount: tagArray.length, rows: [] };
    }

    if (
      sql.includes("WITH query_tags(tag) AS") &&
      sql.includes("raw AS") &&
      sql.includes("agg AS") &&
      sql.includes("COUNT(DISTINCT src)") &&
      sql.includes("FROM agg a") &&
      sql.includes("JOIN posts p ON p.id = a.post_id")
    ) {
      const tagArray = (params?.[0] as string[]) ?? [];
      const limitPerTag =
        typeof params?.[1] === "number" && Number.isFinite(params?.[1] as number)
          ? (params?.[1] as number)
          : 100;

      const postIndex = new Map<string, MockPostRow>();
      for (const p of this.posts) postIndex.set(p.postId, p);

      const sortPostIdDesc = (a: string, b: string) => {
        const aa = BigInt(a);
        const bb = BigInt(b);
        if (aa === bb) return 0;
        return aa > bb ? -1 : 1;
      };

      const raw: { tag: string; postId: string; src: string }[] = [];

      for (const tag of tagArray) {
        const fromPostTags = this.postTags
          .filter((r) => r.name === tag)
          .map((r) => r.postId)
          .sort(sortPostIdDesc)
          .slice(0, limitPerTag);

        for (const postId of fromPostTags) raw.push({ tag, postId, src: "post" });

        const fromAiPostTags = this.tags
          .filter((r) => r.name === tag)
          .map((r) => r.postId)
          .sort(sortPostIdDesc)
          .slice(0, limitPerTag);

        for (const postId of fromAiPostTags) raw.push({ tag, postId, src: "ai" });
      }

      const srcByKey = new Map<string, Set<string>>();
      for (const r of raw) {
        const key = `${r.tag}\t${r.postId}`;
        let s = srcByKey.get(key);
        if (!s) {
          s = new Set<string>();
          srcByKey.set(key, s);
        }
        s.add(r.src);
      }

      const rows: {
        post_id: string;
        tag: string;
        table_count: number;
        is_root: boolean;
        user_id: string;
        count_likes: number;
      }[] = [];

      for (const [key, srcs] of srcByKey.entries()) {
        const [tag, postId] = key.split("\t");
        const p = postIndex.get(postId);
        if (!p) continue;
        rows.push({
          post_id: postId,
          tag,
          table_count: srcs.size,
          is_root: p.replyTo === null,
          user_id: p.userId,
          count_likes:
            typeof p.countLikes === "number" && Number.isFinite(p.countLikes) ? p.countLikes : 0,
        });
      }

      return { rows };
    }

    if (
      sql.includes("FROM post_likes") &&
      sql.includes("GROUP BY") &&
      sql.includes("post_id") &&
      (sql.includes("ANY(") || sql.includes("unnest("))
    ) {
      const arrParam = (params ?? []).find((p) => Array.isArray(p)) as unknown[] | undefined;
      const ids = arrParam ? arrParam.map((x) => String(x)) : [];
      const postIndex = new Map<string, MockPostRow>();
      for (const p of this.posts) postIndex.set(p.postId, p);

      const rows = ids
        .map((id) => {
          const p = postIndex.get(id);
          if (!p) return null;
          const likes =
            typeof p.countLikes === "number" && Number.isFinite(p.countLikes) ? p.countLikes : 0;
          return {
            post_id: id,
            count_likes: likes,
            cnt: likes,
          };
        })
        .filter((x): x is NonNullable<typeof x> => x !== null);

      return { rows };
    }

    if (
      sql.includes("FROM posts") &&
      sql.includes("count_likes") &&
      (sql.includes("ANY(") || sql.includes("unnest("))
    ) {
      const arrParam = (params ?? []).find((p) => Array.isArray(p)) as unknown[] | undefined;
      const ids = arrParam ? arrParam.map((x) => String(x)) : [];
      const postIndex = new Map<string, MockPostRow>();
      for (const p of this.posts) postIndex.set(p.postId, p);

      const rows = ids
        .map((id) => {
          const p = postIndex.get(id);
          if (!p) return null;
          const likes =
            typeof p.countLikes === "number" && Number.isFinite(p.countLikes) ? p.countLikes : 0;
          return { post_id: id, id, count_likes: likes };
        })
        .filter((x): x is NonNullable<typeof x> => x !== null);

      return { rows };
    }

    if (sql.includes("FROM ai_post_summaries") && sql.includes("WHERE post_id = ANY(")) {
      const arrParam = (params ?? []).find((p) => Array.isArray(p)) as unknown[] | undefined;
      if (arrParam) {
        const ids = arrParam.map((x) => String(x));
        const requireNotNull = sql.includes("features IS NOT NULL");

        const postIndex = new Map<string, MockPostRow>();
        for (const p of this.posts) postIndex.set(p.postId, p);

        const rows = ids
          .map((id) => {
            const s = this.summaries.find((r) => r.postId === id);
            if (!s) return null;
            if (requireNotNull && !s.features) return null;
            const p = postIndex.get(id);
            const likes =
              p && typeof p.countLikes === "number" && Number.isFinite(p.countLikes)
                ? p.countLikes
                : 0;
            return {
              post_id: s.postId,
              id: s.postId,
              features: s.features,
              count_likes: likes,
            };
          })
          .filter((x): x is NonNullable<typeof x> => x !== null);
        return { rows };
      }
    }

    return { rows: [] };
  }
}

function computeExpectedRecommendIds(pgClient: MockPgClient, input: RecommendPostsInput): string[] {
  const offset = input.offset ?? 0;
  const limit = input.limit ?? 100;
  const order = (input.order ?? "desc").toLowerCase() === "asc" ? "asc" : "desc";

  const selfUserIdDec =
    typeof input.selfUserId === "string" && input.selfUserId.trim() !== ""
      ? toDecStr(input.selfUserId)
      : null;

  const dedupWeight =
    typeof input.dedupWeight === "number" && input.dedupWeight > 0 ? input.dedupWeight : 0;

  const rerankByLikesAlpha =
    typeof input.rerankByLikesAlpha === "number" &&
    Number.isFinite(input.rerankByLikesAlpha) &&
    input.rerankByLikesAlpha > 0
      ? input.rerankByLikesAlpha
      : 0;

  if (!Array.isArray(input.tags) || input.tags.length === 0) return [];

  const paramTagCounts = new Map<string, number>();
  for (const t of input.tags) {
    const tag = typeof (t as any).name === "string" ? String((t as any).name).trim() : "";
    const count = typeof (t as any).count === "number" ? ((t as any).count as number) : 0;
    if (!tag || !(count > 0)) continue;
    paramTagCounts.set(tag, (paramTagCounts.get(tag) ?? 0) + count);
  }
  const queryTags = Array.from(paramTagCounts.keys());
  if (queryTags.length === 0) return [];

  const followeeIds =
    selfUserIdDec !== null
      ? new Set(
          pgClient.follows.filter((f) => f.followerId === selfUserIdDec).map((f) => f.followeeId),
        )
      : null;

  const postIndex = new Map<string, MockPostRow>();
  for (const p of pgClient.posts) postIndex.set(p.postId, p);

  const sortPostIdDesc = (a: string, b: string) => {
    const aa = BigInt(a);
    const bb = BigInt(b);
    if (aa === bb) return 0;
    return aa > bb ? -1 : 1;
  };

  const limitPerTag = 100;

  const srcByTagPost = new Map<string, Set<string>>();
  for (const tag of queryTags) {
    const fromPostTags = pgClient.postTags
      .filter((r) => r.name === tag)
      .map((r) => r.postId)
      .sort(sortPostIdDesc)
      .slice(0, limitPerTag);

    for (const postId of fromPostTags) {
      const key = `${tag}\t${postId}`;
      let s = srcByTagPost.get(key);
      if (!s) {
        s = new Set<string>();
        srcByTagPost.set(key, s);
      }
      s.add("post");
    }

    const fromAiTags = pgClient.tags
      .filter((r) => r.name === tag)
      .map((r) => r.postId)
      .sort(sortPostIdDesc)
      .slice(0, limitPerTag);

    for (const postId of fromAiTags) {
      const key = `${tag}\t${postId}`;
      let s = srcByTagPost.get(key);
      if (!s) {
        s = new Set<string>();
        srcByTagPost.set(key, s);
      }
      s.add("ai");
    }
  }

  type RecordLike = {
    postId: bigint;
    tag: string;
    tableCount: number;
    isRoot: boolean;
    userId: string;
  };

  const records: RecordLike[] = [];
  for (const [key, srcs] of srcByTagPost.entries()) {
    const [tag, postIdStr] = key.split("\t");
    const p = postIndex.get(postIdStr);
    if (!p) continue;
    const userId = p.userId;
    if (selfUserIdDec && userId === selfUserIdDec) continue;
    records.push({
      postId: BigInt(postIdStr),
      tag,
      tableCount: srcs.size,
      isRoot: p.replyTo === null,
      userId,
    });
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

  const compareBigIntDesc = (a: bigint, b: bigint) => (a === b ? 0 : a > b ? -1 : 1);

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

  const scored = Array.from(postFinalScores.entries()).map(([postId, score]) => ({
    postId,
    score,
  }));
  scored.sort((a, b) => {
    if (a.score !== b.score) return b.score - a.score;
    return compareBigIntDesc(a.postId, b.postId);
  });

  const universe: { postId: bigint; features: Int8Array | null }[] = [];
  for (let i = 0; i < scored.length && universe.length < 100; i += 20) {
    const chunk = scored.slice(i, i + 20);
    for (const c of chunk) {
      const sid = c.postId.toString();
      const s = pgClient.summaries.find((x) => x.postId === sid);
      if (!s) continue;
      universe.push({
        postId: c.postId,
        features: s.features
          ? new Int8Array(s.features.buffer, s.features.byteOffset, s.features.byteLength)
          : null,
      });
      if (universe.length >= 100) break;
    }
  }

  const seedPostIds = Array.isArray(input.seedPostIds)
    ? input.seedPostIds.map((x) => x.trim()).filter((x) => x.length > 0)
    : [];

  if (seedPostIds.length > 0) {
    const existing = new Set<string>(universe.map((c) => c.postId.toString()));
    const needFetch: string[] = [];
    for (const hid of seedPostIds) {
      let dec: string | null = null;
      try {
        dec = toDecStr(hid);
      } catch {
        dec = null;
      }
      if (!dec) continue;
      if (existing.has(dec)) continue;
      needFetch.push(dec);
      existing.add(dec);
    }
    if (needFetch.length > 0) {
      for (const id of needFetch) {
        const s = pgClient.summaries.find((x) => x.postId === id);
        if (!s || !s.features) continue;
        universe.push({
          postId: BigInt(id),
          features: new Int8Array(s.features.buffer, s.features.byteOffset, s.features.byteLength),
        });
      }
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
          baseScore = sigmoidalContrast((simRaw + 1) / 2, 5, 0.75);
        }
      }

      candidates.push({ postId: c.postId, vec, baseScore, adjScore: baseScore });
    }

    candidates.sort((a, b) => {
      if (a.baseScore !== b.baseScore) return b.baseScore - a.baseScore;
      return compareBigIntDesc(a.postId, b.postId);
    });

    if (rerankByLikesAlpha > 0) {
      for (let i = 0; i < candidates.length; i++) {
        const c = candidates[i];
        const p = postIndex.get(c.postId.toString());
        const likes =
          p && typeof p.countLikes === "number" && Number.isFinite(p.countLikes) ? p.countLikes : 0;
        const isRoot = p ? p.replyTo === null : (metaByPostId.get(c.postId)?.isRoot ?? true);
        c.likeScore = Math.log(rerankByLikesAlpha + likes) / Math.log(5) - i - (isRoot ? 0 : 2);
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
          const penalty = simDup * dedupWeight;
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

  return sliced.map((id) => decToHex(id.toString()));
}

describe("AiPostsService checkAiPostSummary", () => {
  let pgClient: MockPgClient;
  let service: AiPostsService;
  let postIdHex: string;
  let postIdDec: string;

  beforeEach(() => {
    pgClient = new MockPgClient();
    service = new AiPostsService(pgClient as unknown as Pool);

    postIdHex = hex16();
    postIdDec = toDecStr(postIdHex);

    pgClient.summaries.push({
      postId: postIdDec,
      summary: "initial summary",
      features: Buffer.from(new Int8Array([1, -2, 3, 4])),
      updatedAt: "2024-01-01T00:00:00Z",
    });
  });

  test("returns false when not found", async () => {
    const otherHex = hex16();
    const result = await service.checkAiPostSummary(otherHex);
    expect(result).toBe(false);
  });

  test("returns true when exists", async () => {
    const result = await service.checkAiPostSummary(postIdHex);
    expect(result).toBe(true);
  });
});

describe("AiPostsService getAiPostSummary", () => {
  let pgClient: MockPgClient;
  let service: AiPostsService;
  let postIdHex: string;
  let postIdDec: string;

  beforeEach(() => {
    pgClient = new MockPgClient();
    service = new AiPostsService(pgClient as unknown as Pool);

    postIdHex = hex16();
    postIdDec = toDecStr(postIdHex);

    pgClient.summaries.push({
      postId: postIdDec,
      summary: "initial summary",
      features: Buffer.from(new Int8Array([1, -2, 3, 4])),
      updatedAt: "2024-01-01T00:00:00Z",
    });
    pgClient.tags.push({ postId: postIdDec, name: "tagB" });
    pgClient.tags.push({ postId: postIdDec, name: "tagA" });
  });

  test("returns null when not found", async () => {
    const otherHex = hex16();
    const result = await service.getAiPostSummary(otherHex);
    expect(result).toBeNull();
  });

  test("returns summary, features, and sorted tags", async () => {
    const result = await service.getAiPostSummary(postIdHex);
    expect(result).not.toBeNull();
    expect(result?.postId).toBe(postIdHex);
    expect(result?.updatedAt).toBe("2024-01-01T00:00:00Z");
    expect(result?.summary).toBe("initial summary");
    expect(result?.tags).toEqual(["tagA", "tagB"]);
    expect(result?.features).toBeInstanceOf(Int8Array);
    expect(int8eq(result?.features, new Int8Array([1, -2, 3, 4]))).toBe(true);
  });
});

describe("AiPostsService listAiPostsSummaries", () => {
  let pgClient: MockPgClient;
  let service: AiPostsService;
  let post1Hex: string;
  let post2Hex: string;
  let post3Hex: string;

  beforeEach(() => {
    pgClient = new MockPgClient();
    service = new AiPostsService(pgClient as unknown as Pool);

    post1Hex = hex16();
    post2Hex = hex16();
    post3Hex = hex16();

    const post1Dec = toDecStr(post1Hex);
    const post2Dec = toDecStr(post2Hex);
    const post3Dec = toDecStr(post3Hex);

    pgClient.summaries.push(
      {
        postId: post1Dec,
        summary: null,
        features: Buffer.from(new Int8Array([1, 2, 3])),
        updatedAt: "2024-01-01T00:00:00Z",
      },
      {
        postId: post2Dec,
        summary: "has summary",
        features: Buffer.from(new Int8Array([9, 8, -7])),
        updatedAt: "2025-01-01T00:00:00Z",
      },
      {
        postId: post3Dec,
        summary: null,
        features: null,
        updatedAt: "2025-06-01T00:00:00Z",
      },
    );

    pgClient.tags.push(
      { postId: post1Dec, name: "t1" },
      { postId: post2Dec, name: "t2" },
      { postId: post3Dec, name: "t3" },
    );
  });

  test("lists summaries with default pagination", async () => {
    const input: ListAiPostSummariesInput = {};
    const result = await service.listAiPostsSummaries(input);
    expect(Array.isArray(result)).toBe(true);
    expect(result.length).toBe(3);

    const ids = result.map((r) => r.postId).sort();
    expect(ids).toEqual([post1Hex, post2Hex, post3Hex].sort());

    const r2 = result.find((r) => r.postId === post2Hex);
    expect(r2?.updatedAt).toBe("2025-01-01T00:00:00Z");
    expect(r2?.features).toBeInstanceOf(Int8Array);
    expect(int8eq(r2?.features, new Int8Array([9, 8, -7]))).toBe(true);

    const r1 = result.find((r) => r.postId === post1Hex);
    expect(r1?.updatedAt).toBe("2024-01-01T00:00:00Z");
    expect(r1?.features).toBeInstanceOf(Int8Array);
    expect(int8eq(r1?.features, new Int8Array([1, 2, 3]))).toBe(true);

    const r3 = result.find((r) => r.postId === post3Hex);
    expect(r3?.updatedAt).toBe("2025-06-01T00:00:00Z");
    expect(r3?.features).toBeNull();
  });

  test("supports offset and limit", async () => {
    const input: ListAiPostSummariesInput = { offset: 1, limit: 1, order: "asc" };
    const result = await service.listAiPostsSummaries(input);
    expect(result.length).toBe(1);
  });

  test("filters by nullOnly", async () => {
    const input: ListAiPostSummariesInput = { nullOnly: true, order: "asc", limit: 10 };
    const result = await service.listAiPostsSummaries(input);
    expect(result.length).toBe(2);
    for (const r of result) {
      expect(r.summary).toBeNull();
    }
  });

  test("filters by newerThan", async () => {
    const input: ListAiPostSummariesInput = {
      newerThan: "2025-01-01T00:00:00Z",
      order: "asc",
      limit: 10,
    };
    const result = await service.listAiPostsSummaries(input);
    expect(result.length).toBe(1);
    expect(result[0].postId).toBe(post3Hex);
  });

  test("filters by newerThan and nullOnly together", async () => {
    const input: ListAiPostSummariesInput = {
      newerThan: "2024-12-31T23:59:59Z",
      nullOnly: true,
      order: "asc",
      limit: 10,
    };
    const result = await service.listAiPostsSummaries(input);
    expect(result.length).toBe(1);
    expect(result[0].postId).toBe(post3Hex);
    expect(result[0].summary).toBeNull();
  });

  test("respects order desc", async () => {
    const input: ListAiPostSummariesInput = { order: "desc", limit: 10 };
    const result = await service.listAiPostsSummaries(input);
    expect(result.length).toBe(3);
    const ids = result.map((r) => r.postId);
    const sortedDesc = [...ids].sort().reverse();
    expect(ids).toEqual(sortedDesc);
  });
});

describe("AiPostsService updateAiPost", () => {
  let pgClient: MockPgClient;
  let service: AiPostsService;
  let postIdHex: string;
  let postIdDec: string;

  beforeEach(() => {
    pgClient = new MockPgClient();
    service = new AiPostsService(pgClient as unknown as Pool);

    postIdHex = hex16();
    postIdDec = toDecStr(postIdHex);

    pgClient.summaries.push({
      postId: postIdDec,
      summary: "original summary",
      features: Buffer.from(new Int8Array([1, 2, 3])),
      updatedAt: "2024-01-01T00:00:00Z",
    });
    pgClient.tags.push({ postId: postIdDec, name: "old1" }, { postId: postIdDec, name: "old2" });
  });

  test("updates summary and tags together", async () => {
    const input: UpdateAiPostSummaryInput = {
      postId: postIdHex,
      summary: "updated summary",
      tags: ["a", "b"],
    };
    const result = await service.updateAiPost(input);
    expect(result).not.toBeNull();
    expect(result?.postId).toBe(postIdHex);
    expect(typeof result?.updatedAt).toBe("string");
    expect(result?.summary).toBe("updated summary");
    expect(result?.tags.sort()).toEqual(["a", "b"]);

    expect(result?.features).toBeInstanceOf(Int8Array);
    expect(int8eq(result?.features, new Int8Array([1, 2, 3]))).toBe(true);

    const internal = pgClient.summaries.find((s) => s.postId === postIdDec);
    expect(internal?.summary).toBe("updated summary");
    expect(internal?.features).toBeInstanceOf(Buffer);
    expect(typeof internal?.updatedAt).toBe("string");
    expect(
      Buffer.compare(internal?.features ?? Buffer.alloc(0), Buffer.from(new Int8Array([1, 2, 3]))),
    ).toBe(0);

    const internalTags = pgClient.tags
      .filter((t) => t.postId === postIdDec)
      .map((t) => t.name)
      .sort();
    expect(internalTags).toEqual(["a", "b"]);
  });

  test("updates summary and features together", async () => {
    const input: UpdateAiPostSummaryInput = {
      postId: postIdHex,
      summary: "summary+features",
      features: new Int8Array([9, -9]),
    };
    const result = await service.updateAiPost(input);
    expect(result).not.toBeNull();
    expect(typeof result?.updatedAt).toBe("string");
    expect(result?.summary).toBe("summary+features");
    expect(result?.features).toBeInstanceOf(Int8Array);
    expect(int8eq(result?.features, new Int8Array([9, -9]))).toBe(true);

    const internal = pgClient.summaries.find((s) => s.postId === postIdDec);
    expect(internal?.summary).toBe("summary+features");
    expect(typeof internal?.updatedAt).toBe("string");
    expect(
      Buffer.compare(internal?.features ?? Buffer.alloc(0), Buffer.from(new Int8Array([9, -9]))),
    ).toBe(0);
  });

  test("partial update: only summary", async () => {
    const input: UpdateAiPostSummaryInput = {
      postId: postIdHex,
      summary: "only summary changed",
    };
    const result = await service.updateAiPost(input);
    expect(result).not.toBeNull();
    expect(typeof result?.updatedAt).toBe("string");
    expect(result?.summary).toBe("only summary changed");

    expect(result?.features).toBeInstanceOf(Int8Array);
    expect(int8eq(result?.features, new Int8Array([1, 2, 3]))).toBe(true);

    const internalTags = pgClient.tags
      .filter((t) => t.postId === postIdDec)
      .map((t) => t.name)
      .sort();
    expect(internalTags).toEqual(["old1", "old2"]);
  });

  test("partial update: only features", async () => {
    const input: UpdateAiPostSummaryInput = {
      postId: postIdHex,
      features: new Int8Array([-1, 0, 1]),
    };
    const result = await service.updateAiPost(input);
    expect(result).not.toBeNull();
    expect(typeof result?.updatedAt).toBe("string");
    expect(result?.summary).toBe("original summary");
    expect(result?.features).toBeInstanceOf(Int8Array);
    expect(int8eq(result?.features, new Int8Array([-1, 0, 1]))).toBe(true);
  });

  test("partial update: only tags", async () => {
    const input: UpdateAiPostSummaryInput = {
      postId: postIdHex,
      tags: ["x"],
    };
    const result = await service.updateAiPost(input);
    expect(result).not.toBeNull();
    expect(typeof result?.updatedAt).toBe("string");
    expect(result?.summary).toBe("original summary");

    expect(result?.features).toBeInstanceOf(Int8Array);
    expect(int8eq(result?.features, new Int8Array([1, 2, 3]))).toBe(true);

    const internalTags = pgClient.tags
      .filter((t) => t.postId === postIdDec)
      .map((t) => t.name)
      .sort();
    expect(internalTags).toEqual(["x"]);
  });

  test("allows setting summary to null", async () => {
    const input: UpdateAiPostSummaryInput = {
      postId: postIdHex,
      summary: null,
    };
    const result = await service.updateAiPost(input);
    expect(result).not.toBeNull();
    expect(typeof result?.updatedAt).toBe("string");
    expect(result?.summary).toBeNull();
    const internal = pgClient.summaries.find((s) => s.postId === postIdDec);
    expect(internal?.summary).toBeNull();
  });

  test("allows setting features to null", async () => {
    const input: UpdateAiPostSummaryInput = {
      postId: postIdHex,
      features: null,
    };
    const result = await service.updateAiPost(input);
    expect(result).not.toBeNull();
    expect(typeof result?.updatedAt).toBe("string");
    expect(result?.features).toBeNull();

    const internal = pgClient.summaries.find((s) => s.postId === postIdDec);
    expect(internal?.features).toBeNull();
  });

  test("setting tags to empty array clears tags", async () => {
    const input: UpdateAiPostSummaryInput = {
      postId: postIdHex,
      tags: [],
    };
    const result = await service.updateAiPost(input);
    expect(result).not.toBeNull();
    expect(typeof result?.updatedAt).toBe("string");
    expect(result?.tags).toEqual([]);
    const internalTags = pgClient.tags.filter((t) => t.postId === postIdDec);
    expect(internalTags.length).toBe(0);
  });
});

describe("AiPostsService RecommendPosts", () => {
  let pgClient: MockPgClient;
  let service: AiPostsService;

  const dec = (n: number) => String(n);
  const hex = (n: number) => toHexStrFromDec(dec(n));
  const seed = (name: string, count = 1) => ({ name, count });

  const mkSummary = (postIdDec: string, features: number[] | null) => {
    pgClient.summaries.push({
      postId: postIdDec,
      summary: "s",
      features: features ? Buffer.from(new Int8Array(features)) : null,
      updatedAt: "2025-01-01T00:00:00Z",
    });
  };

  beforeEach(() => {
    pgClient = new MockPgClient();
    service = new AiPostsService(pgClient as unknown as Pool);

    const otherUserDec = dec(900);
    const selfUserHex = toHexStrFromDec(dec(777));
    const selfUserDec = toDecStr(selfUserHex);

    pgClient.posts.push(
      {
        postId: dec(121),
        replyTo: null,
        userId: otherUserDec,
        publishedAt: "2025-10-10T00:00:01Z",
        countLikes: 0,
      },
      {
        postId: dec(122),
        replyTo: null,
        userId: otherUserDec,
        publishedAt: "2025-10-10T00:00:02Z",
        countLikes: 0,
      },
      {
        postId: dec(123),
        replyTo: dec(122),
        userId: selfUserDec,
        publishedAt: "2025-10-10T00:00:03Z",
        countLikes: 0,
      },
      {
        postId: dec(124),
        replyTo: dec(121),
        userId: otherUserDec,
        publishedAt: "2025-10-10T00:00:04Z",
        countLikes: 0,
      },
      {
        postId: dec(125),
        replyTo: null,
        userId: otherUserDec,
        publishedAt: "2025-10-10T00:00:05Z",
        countLikes: 0,
      },
      {
        postId: dec(126),
        replyTo: dec(122),
        userId: otherUserDec,
        publishedAt: "2025-10-10T00:00:06Z",
        countLikes: 0,
      },
      {
        postId: dec(127),
        replyTo: null,
        userId: otherUserDec,
        publishedAt: "2025-10-10T00:00:07Z",
        countLikes: 0,
      },
      {
        postId: dec(128),
        replyTo: null,
        userId: otherUserDec,
        publishedAt: "2025-10-10T00:00:08Z",
        countLikes: 0,
      },
      {
        postId: dec(129),
        replyTo: null,
        userId: otherUserDec,
        publishedAt: "2025-10-10T00:00:09Z",
        countLikes: 0,
      },
    );

    pgClient.postTags.push(
      { postId: dec(121), name: "tech" },
      { postId: dec(122), name: "tech" },
      { postId: dec(123), name: "tech" },
      { postId: dec(124), name: "tech" },
      { postId: dec(121), name: "eco" },
      { postId: dec(123), name: "eco" },
      { postId: dec(125), name: "eco" },
      { postId: dec(127), name: "eco" },
      { postId: dec(129), name: "eco" },
    );

    pgClient.tags.push(
      { postId: dec(121), name: "tech" },
      { postId: dec(123), name: "tech" },
      { postId: dec(121), name: "eco" },
      { postId: dec(125), name: "eco" },
      { postId: dec(127), name: "eco" },
      { postId: dec(123), name: "game" },
      { postId: dec(124), name: "game" },
    );

    mkSummary(dec(121), [10, 0, 0]);
    mkSummary(dec(122), [1, 9, 0]);
    mkSummary(dec(123), [0, 10, 0]);
    mkSummary(dec(124), [8, 6, 0]);
    mkSummary(dec(125), [7, 2, 0]);
    mkSummary(dec(127), [6, 8, 0]);

    (pgClient as any).__selfUserHex = selfUserHex;
  });

  test("returns empty when tags empty", async () => {
    const input: RecommendPostsInput = { tags: [], limit: 10, order: "desc" };
    const result = await service.RecommendPosts(input);
    expect(result).toEqual([]);
  });

  test("filters out ids that do not exist in ai_post_summaries (universe selection)", async () => {
    const input: RecommendPostsInput = {
      tags: [seed("tech"), seed("eco"), seed("game")],
      limit: 100,
      order: "desc",
    };
    const result = await service.RecommendPosts(input);
    const expected = computeExpectedRecommendIds(pgClient, input);
    expect(result).toEqual(expected);
    expect(new Set(result)).toEqual(
      new Set([hex(121), hex(122), hex(123), hex(124), hex(125), hex(127)]),
    );
    expect(result.includes(hex(129))).toBe(false);
    expect(result.includes(hex(128))).toBe(false);
  });

  test("includes seed postIds into universe when provided (features not null)", async () => {
    mkSummary(dec(128), [0, 0, 10]);

    const input: RecommendPostsInput = {
      tags: [seed("tech"), seed("eco"), seed("game")],
      limit: 200,
      order: "desc",
      seedPostIds: [hex(128)],
    };

    const result = await service.RecommendPosts(input);
    const expected = computeExpectedRecommendIds(pgClient, input);
    expect(result).toEqual(expected);
    expect(result.includes(hex(128))).toBe(true);
  });

  test("filters out selfUserId after fetching matched rows (no SQL WHERE)", async () => {
    const selfUserHex = (pgClient as any).__selfUserHex as string;

    const input: RecommendPostsInput = {
      tags: [seed("tech"), seed("eco"), seed("game")],
      selfUserId: selfUserHex,
      limit: 100,
      order: "desc",
    };
    const result = await service.RecommendPosts(input);
    const expected = computeExpectedRecommendIds(pgClient, input);

    expect(result).toEqual(expected);
    expect(result.includes(hex(123))).toBe(false);
  });

  test("when features is given, sorts universe by cosine similarity (then applies order/offset/limit)", async () => {
    pgClient.summaries.push({
      postId: dec(129),
      summary: "s",
      features: Buffer.from(new Int8Array([2, 0, 10])),
      updatedAt: "2025-01-01T00:00:00Z",
    });

    const q = new Int8Array([10, 0, 0]);

    const input: RecommendPostsInput = {
      tags: [seed("tech"), seed("eco"), seed("game")],
      features: q,
      limit: 100,
      order: "desc",
    };

    const result = await service.RecommendPosts(input);
    const expected = computeExpectedRecommendIds(pgClient, input);
    expect(result).toEqual(expected);
  });

  test("applies order asc and offset/limit after final sorting (features case)", async () => {
    pgClient.summaries.push({
      postId: dec(129),
      summary: "s",
      features: Buffer.from(new Int8Array([2, 0, 10])),
      updatedAt: "2025-01-01T00:00:00Z",
    });

    const q = new Int8Array([10, 0, 0]);

    const input: RecommendPostsInput = {
      tags: [seed("tech"), seed("eco"), seed("game")],
      features: q,
      order: "asc",
      offset: 1,
      limit: 3,
    };

    const result = await service.RecommendPosts(input);
    const expected = computeExpectedRecommendIds(pgClient, input);
    expect(result).toEqual(expected);
  });

  test("applies rerankByLikesAlpha after similarity ranking", async () => {
    pgClient.summaries.push({
      postId: dec(129),
      summary: "s",
      features: Buffer.from(new Int8Array([2, 0, 10])),
      updatedAt: "2025-01-01T00:00:00Z",
    });

    const p125 = pgClient.posts.find((p) => p.postId === dec(125));
    if (p125) p125.countLikes = 100000;

    const q = new Int8Array([10, 0, 0]);

    const input: RecommendPostsInput = {
      tags: [seed("tech"), seed("eco"), seed("game")],
      features: q,
      rerankByLikesAlpha: 10,
      limit: 100,
      order: "desc",
    };

    const result = await service.RecommendPosts(input);
    const expected = computeExpectedRecommendIds(pgClient, input);

    expect(result).toEqual(expected);
    expect(result[0]).toBe(hex(125));
  });

  test("applies socialScore when selfUserId is given", async () => {
    const localPg = new MockPgClient();
    const localService = new AiPostsService(localPg as unknown as Pool);

    const selfUserHex = toHexStrFromDec(dec(777));
    const selfUserDec = toDecStr(selfUserHex);

    localPg.follows.push({ followerId: selfUserDec, followeeId: dec(900) });

    localPg.posts.push(
      {
        postId: dec(200),
        replyTo: null,
        userId: dec(901),
        publishedAt: "2025-10-10T00:00:01Z",
        countLikes: 0,
      },
      {
        postId: dec(199),
        replyTo: null,
        userId: dec(900),
        publishedAt: "2025-10-10T00:00:02Z",
        countLikes: 0,
      },
    );

    localPg.postTags.push({ postId: dec(200), name: "t" }, { postId: dec(199), name: "u" });

    localPg.summaries.push(
      {
        postId: dec(200),
        summary: "s",
        features: Buffer.from(new Int8Array([1, 1, 1])),
        updatedAt: "2025-01-01T00:00:00Z",
      },
      {
        postId: dec(199),
        summary: "s",
        features: Buffer.from(new Int8Array([1, 1, 1])),
        updatedAt: "2025-01-01T00:00:00Z",
      },
    );

    const input: RecommendPostsInput = {
      tags: [seed("t"), seed("u")],
      selfUserId: selfUserHex,
      order: "desc",
      limit: 10,
    };

    const result = await localService.RecommendPosts(input);
    const expected = computeExpectedRecommendIds(localPg, input);
    expect(result).toEqual(expected);
  });
});

describe("AiPostsService BuildSearchSeedForUser", () => {
  let pgClient: MockPgClient;
  let service: AiPostsService;

  const dec = (n: number) => String(n);
  const hex = (n: number) => toHexStrFromDec(dec(n));

  const mkDense = (seed: number): Int8Array => {
    const a = new Int8Array(512);
    for (let i = 0; i < a.length; i++) a[i] = ((i + seed) % 11) + 1;
    return a;
  };

  const addSummary = (postIdDec: string, seed: number) => {
    const a = mkDense(seed);
    pgClient.summaries.push({
      postId: postIdDec,
      summary: "s",
      features: Buffer.from(a),
      updatedAt: "2025-01-01T00:00:00Z",
    });
    return a;
  };

  beforeEach(() => {
    pgClient = new MockPgClient();
    service = new AiPostsService(pgClient as unknown as Pool);
  });

  test("throws when no seed posts", async () => {
    await expect(service.BuildSearchSeedForUser(hex(777), 3)).rejects.toThrow("no seed posts");
  });

  test("does not throw when seed posts exist but all features are null", async () => {
    const selfUserHex = hex(777);
    const selfUserDec = toDecStr(selfUserHex);
    const p = dec(5000);

    pgClient.posts.push({
      postId: p,
      replyTo: null,
      userId: selfUserDec,
      publishedAt: "2025-01-01T00:00:01Z",
      countLikes: 0,
    });

    pgClient.summaries.push({
      postId: p,
      summary: "s",
      features: null,
      updatedAt: "2025-01-01T00:00:00Z",
    });

    pgClient.tags.push({ postId: p, name: "t" });

    const seeds = await service.BuildSearchSeedForUser(selfUserHex, 3);
    expect(seeds.length).toBe(1);
    expect(seeds[0].tags).toEqual([{ name: "t", count: 1 }]);
    expect(seeds[0].features).toBeInstanceOf(Int8Array);
    expect(seeds[0].features.length).toBe(512);
    expect(seeds[0].weight).toBeCloseTo(1, 10);
    expect(seeds[0].postIds).toEqual([]);

    const s = selfUserHex.startsWith("0x") ? selfUserHex.slice(2) : selfUserHex;
    const tail = s.length > 8 ? s.slice(-8) : s;
    const n = parseInt(tail, 16);
    const idx = Number.isFinite(n) ? ((n % 512) + 512) % 512 : 0;
    const ones = Array.from(seeds[0].features).filter((x) => x !== 0);
    expect(ones.length).toBe(1);
    expect(seeds[0].features[idx]).toBe(1);
  });

  test("builds tags and features from self/likes/followees", async () => {
    const selfUserHex = hex(777);
    const selfUserDec = toDecStr(selfUserHex);
    const followeeA = dec(800);
    const followeeB = dec(801);
    const otherOwner = dec(900);

    pgClient.follows.push(
      { followerId: selfUserDec, followeeId: followeeA },
      { followerId: selfUserDec, followeeId: followeeB },
    );

    const selfP1 = dec(1001);
    const selfP2 = dec(1000);
    const selfLiked = dec(2000);
    const faPost = dec(3000);
    const fbPost = dec(3001);
    const flaLiked = dec(4000);
    const flbLiked = dec(4001);

    pgClient.posts.push(
      {
        postId: selfP1,
        replyTo: null,
        userId: selfUserDec,
        publishedAt: "2025-01-01T00:00:01Z",
        countLikes: 0,
      },
      {
        postId: selfP2,
        replyTo: null,
        userId: selfUserDec,
        publishedAt: "2025-01-01T00:00:02Z",
        countLikes: 0,
      },
      {
        postId: selfLiked,
        replyTo: null,
        userId: otherOwner,
        publishedAt: "2025-01-01T00:00:03Z",
        countLikes: 0,
      },
      {
        postId: faPost,
        replyTo: null,
        userId: followeeA,
        publishedAt: "2025-01-01T00:00:04Z",
        countLikes: 0,
      },
      {
        postId: fbPost,
        replyTo: null,
        userId: followeeB,
        publishedAt: "2025-01-01T00:00:05Z",
        countLikes: 0,
      },
      {
        postId: flaLiked,
        replyTo: null,
        userId: otherOwner,
        publishedAt: "2025-01-01T00:00:06Z",
        countLikes: 0,
      },
      {
        postId: flbLiked,
        replyTo: null,
        userId: otherOwner,
        publishedAt: "2025-01-01T00:00:07Z",
        countLikes: 0,
      },
    );

    pgClient.likes.push(
      { postId: selfLiked, likedBy: selfUserDec, createdAt: "2025-01-01T00:00:10Z" },
      { postId: flaLiked, likedBy: followeeA, createdAt: "2025-01-01T00:00:20Z" },
      { postId: flbLiked, likedBy: followeeB, createdAt: "2025-01-01T00:00:30Z" },
    );

    pgClient.tags.push(
      { postId: selfP1, name: "common" },
      { postId: selfP1, name: "self" },
      { postId: selfP2, name: "common" },
      { postId: selfLiked, name: "common" },
      { postId: selfLiked, name: "liked" },
      { postId: faPost, name: "common" },
      { postId: faPost, name: "fa" },
      { postId: fbPost, name: "common" },
      { postId: fbPost, name: "fb" },
      { postId: flaLiked, name: "common" },
      { postId: flaLiked, name: "fla" },
      { postId: flbLiked, name: "common" },
      { postId: flbLiked, name: "flb" },
    );

    const fSelfP1 = addSummary(selfP1, 1);
    const fSelfP2 = addSummary(selfP2, 2);
    const fSelfLiked = addSummary(selfLiked, 3);
    const fFaPost = addSummary(faPost, 4);
    const fFbPost = addSummary(fbPost, 5);
    const fFlaLiked = addSummary(flaLiked, 6);
    const fFlbLiked = addSummary(flbLiked, 7);

    const seeds = await service.BuildSearchSeedForUser(selfUserHex, 1);
    expect(Array.isArray(seeds)).toBe(true);
    expect(seeds.length).toBe(1);

    const baseWeights: { id: string; w: number; feat: Int8Array }[] = [
      { id: selfP1, w: 1.0, feat: fSelfP1 },
      { id: selfP2, w: 1.0, feat: fSelfP2 },
      { id: selfLiked, w: 0.7, feat: fSelfLiked },
      { id: faPost, w: 0.5, feat: fFaPost },
      { id: fbPost, w: 0.5, feat: fFbPost },
      { id: flaLiked, w: 0.3, feat: fFlaLiked },
      { id: flbLiked, w: 0.3, feat: fFlbLiked },
    ];

    const total = baseWeights.reduce((s, x) => s + x.w, 0);
    const gamma = 0.7;
    const eff = baseWeights.map((x) => ({ ...x, ew: Math.pow(x.w / total, gamma) }));

    const expectedWeight = eff.reduce((s, x) => s + x.ew, 0);

    const tableScore = Math.log(2);
    const tagScores = new Map<string, number>();
    const tagsByPost = new Map<string, string[]>();
    for (const t of pgClient.tags) {
      const arr = tagsByPost.get(t.postId) ?? [];
      arr.push(t.name);
      tagsByPost.set(t.postId, arr);
    }

    for (const x of eff) {
      const ts = tagsByPost.get(x.id) ?? [];
      for (const name of ts) {
        tagScores.set(name, (tagScores.get(name) ?? 0) + x.ew * tableScore);
      }
    }

    const top = Array.from(tagScores.entries())
      .sort((a, b) => {
        if (a[1] !== b[1]) return b[1] - a[1];
        return a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0;
      })
      .slice(0, 10);

    const minScore = top.length > 0 ? top[top.length - 1][1] : 0;
    const expectedTags =
      top.length === 0
        ? []
        : minScore > 0
          ? top.map(([name, score]) => ({
              name,
              count: Math.max(1, Math.round((score / minScore) * 10) / 10),
            }))
          : top.map(([name]) => ({ name, count: 1 }));

    let sumVec: number[] | null = null;
    for (const x of eff) {
      const v = normalizeL2(decodeFeatures(x.feat));
      if (!sumVec) {
        sumVec = v.map((z) => z * x.ew);
      } else {
        for (let i = 0; i < sumVec.length; i++) sumVec[i] += v[i] * x.ew;
      }
    }
    if (!sumVec) throw new Error("test setup error");

    const expectedFeatures = encodeFeatures(normalizeL2(sumVec));

    const expectedPostIds = eff
      .filter((x) => {
        const p = pgClient.posts.find((pp) => pp.postId === x.id);
        return !!p && p.userId !== selfUserDec;
      })
      .slice()
      .sort((a, b) => {
        if (a.ew !== b.ew) return b.ew - a.ew;
        const aa = BigInt(a.id);
        const bb = BigInt(b.id);
        return aa === bb ? 0 : aa > bb ? -1 : 1;
      })
      .slice(0, 10)
      .map((x) => toHexStrFromDec(x.id));

    const result = seeds[0];

    expect(result.tags).toEqual(expectedTags);
    expect(result.features).toBeInstanceOf(Int8Array);
    expect(result.features.length).toBe(512);
    expect(int8eq(result.features, expectedFeatures)).toBe(true);
    expect(result.weight).toBeCloseTo(expectedWeight, 10);
    expect(result.postIds).toEqual(expectedPostIds);
  });

  test("occurrenceWeight: duplicated seed post increases cluster weight, and clusters shrink when posts<numClusters", async () => {
    const selfUserHex = hex(777);
    const selfUserDec = toDecStr(selfUserHex);

    const p = dec(5000);

    pgClient.posts.push({
      postId: p,
      replyTo: null,
      userId: selfUserDec,
      publishedAt: "2025-01-01T00:00:01Z",
      countLikes: 0,
    });

    pgClient.likes.push({ postId: p, likedBy: selfUserDec, createdAt: "2025-01-01T00:00:10Z" });

    pgClient.tags.push({ postId: p, name: "dup" });
    const feat = addSummary(p, 42);

    const seeds = await service.BuildSearchSeedForUser(selfUserHex, 3);
    expect(seeds.length).toBe(1);

    const s0 = seeds[0];
    expect(s0.tags).toEqual([{ name: "dup", count: 1 }]);
    expect(s0.features).toBeInstanceOf(Int8Array);
    expect(s0.features.length).toBe(512);
    expect(s0.weight).toBeCloseTo(1, 10);
    expect(s0.postIds).toEqual([]);

    const v = normalizeL2(decodeFeatures(feat));
    const expectedFeatures = encodeFeatures(normalizeL2(v));
    expect(int8eq(s0.features, expectedFeatures)).toBe(true);
  });
});
