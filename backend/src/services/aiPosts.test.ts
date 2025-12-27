import { jest } from "@jest/globals";
import { AiPostsService } from "./aiPosts";
import type { Pool } from "pg";
import type {
  ListAiPostSummariesInput,
  RecommendPostsInput,
  UpdateAiPostSummaryInput,
} from "../models/aiPost";
import crypto from "crypto";
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

const hex16 = () => crypto.randomBytes(8).toString("hex").toUpperCase();
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
      for (const id of selfPosts) rows.push({ post_id: id, weight: 1.0 });
      for (const id of selfLikes) rows.push({ post_id: id, weight: 0.7 });
      for (const id of followeePosts) rows.push({ post_id: id, weight: 0.5 });
      for (const id of followeeLikes) rows.push({ post_id: id, weight: 0.3 });

      return { rows };
    }

    if (
      sql.includes("WITH seed_posts(post_id, weight) AS") &&
      sql.includes("JOIN ai_post_tags apt ON apt.post_id = sp.post_id") &&
      sql.includes("SELECT sp.weight, apt.name")
    ) {
      const postIds = (params?.[0] as unknown[] | undefined)?.map((x) => String(x)) ?? [];
      const weights = (params?.[1] as unknown[] | undefined)?.map((x) => Number(x)) ?? [];
      const rows: { weight: number; name: string }[] = [];
      for (let i = 0; i < postIds.length && i < weights.length; i++) {
        const postId = postIds[i];
        const w = weights[i];
        for (const t of this.tags.filter((x) => x.postId === postId)) {
          rows.push({ weight: w, name: t.name });
        }
      }
      return { rows };
    }

    if (
      sql.includes("WITH seed_posts(post_id, weight) AS") &&
      sql.includes("JOIN ai_post_summaries aps ON aps.post_id = sp.post_id") &&
      sql.includes("WHERE aps.features IS NOT NULL") &&
      sql.includes("SELECT sp.weight, aps.features")
    ) {
      const postIds = (params?.[0] as unknown[] | undefined)?.map((x) => String(x)) ?? [];
      const weights = (params?.[1] as unknown[] | undefined)?.map((x) => Number(x)) ?? [];
      const rows: { weight: number; features: Buffer }[] = [];
      for (let i = 0; i < postIds.length && i < weights.length; i++) {
        const postId = postIds[i];
        const w = weights[i];
        const s = this.summaries.find((x) => x.postId === postId);
        if (s?.features) rows.push({ weight: w, features: s.features });
      }
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
      sql.startsWith(
        "WITH query_tags(tag) AS ( SELECT unnest($1::text[]) ), matched_tag_posts AS (",
      ) &&
      sql.includes("FROM post_tags") &&
      sql.includes("FROM ai_post_tags") &&
      sql.includes("FROM matched_tag_posts mtp") &&
      sql.includes("JOIN posts p ON p.id = mtp.post_id")
    ) {
      const tagArray = (params?.[0] as string[]) ?? [];
      const limitPerTag =
        typeof params?.[1] === "number" && Number.isFinite(params?.[1] as number)
          ? (params?.[1] as number)
          : 100;

      const rows: { post_id: string; tag: string; is_root: boolean; user_id: string }[] = [];

      const postIndex = new Map<string, MockPostRow>();
      for (const p of this.posts) postIndex.set(p.postId, p);

      const sortPostIdDesc = (a: string, b: string) => {
        const aa = BigInt(a);
        const bb = BigInt(b);
        if (aa === bb) return 0;
        return aa > bb ? -1 : 1;
      };

      for (const tag of tagArray) {
        const fromPostTags = this.postTags
          .filter((r) => r.name === tag)
          .map((r) => r.postId)
          .sort(sortPostIdDesc)
          .slice(0, limitPerTag);

        for (const postId of fromPostTags) {
          const p = postIndex.get(postId);
          if (!p) continue;
          rows.push({ post_id: postId, tag, is_root: p.replyTo === null, user_id: p.userId });
        }

        const fromAiPostTags = this.tags
          .filter((r) => r.name === tag)
          .map((r) => r.postId)
          .sort(sortPostIdDesc)
          .slice(0, limitPerTag);

        for (const postId of fromAiPostTags) {
          const p = postIndex.get(postId);
          if (!p) continue;
          rows.push({ post_id: postId, tag, is_root: p.replyTo === null, user_id: p.userId });
        }
      }

      return { rows };
    }

    if (sql.includes("FROM ai_post_summaries") && sql.includes("WHERE post_id = ANY(")) {
      const arrParam = (params ?? []).find((p) => Array.isArray(p)) as unknown[] | undefined;
      if (arrParam) {
        const ids = arrParam.map((x) => String(x));
        const rows = ids
          .map((id) => {
            const s = this.summaries.find((r) => r.postId === id);
            if (!s) return null;
            return {
              post_id: s.postId,
              features: s.features,
            };
          })
          .filter((x): x is NonNullable<typeof x> => x !== null);
        return { rows };
      }
    }

    return { rows: [] };
  }
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
      },
      {
        postId: dec(122),
        replyTo: null,
        userId: otherUserDec,
        publishedAt: "2025-10-10T00:00:02Z",
      },
      {
        postId: dec(123),
        replyTo: dec(122),
        userId: selfUserDec,
        publishedAt: "2025-10-10T00:00:03Z",
      },
      {
        postId: dec(124),
        replyTo: dec(121),
        userId: otherUserDec,
        publishedAt: "2025-10-10T00:00:04Z",
      },
      {
        postId: dec(125),
        replyTo: null,
        userId: otherUserDec,
        publishedAt: "2025-10-10T00:00:05Z",
      },
      {
        postId: dec(126),
        replyTo: dec(122),
        userId: otherUserDec,
        publishedAt: "2025-10-10T00:00:06Z",
      },
      {
        postId: dec(127),
        replyTo: null,
        userId: otherUserDec,
        publishedAt: "2025-10-10T00:00:07Z",
      },
      {
        postId: dec(128),
        replyTo: null,
        userId: otherUserDec,
        publishedAt: "2025-10-10T00:00:08Z",
      },
      {
        postId: dec(129),
        replyTo: null,
        userId: otherUserDec,
        publishedAt: "2025-10-10T00:00:09Z",
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
    expect(result).toEqual([hex(121), hex(123), hex(124), hex(122), hex(127), hex(125)]);
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

    expect(result).toEqual([hex(121), hex(124), hex(122), hex(127), hex(125)]);
    expect(result.includes(hex(123))).toBe(false);
    expect(result.includes(hex(129))).toBe(false);
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

    const universeDecIds = [121, 123, 124, 127, 125, 122, 129].map(dec);

    const qDecoded = normalizeL2(decodeFeatures(q));
    const scored = universeDecIds.map((postIdDec) => {
      const s = pgClient.summaries.find((x) => x.postId === postIdDec);
      if (!s?.features) throw new Error("test setup error: missing features");
      const v = new Int8Array(s.features.buffer, s.features.byteOffset, s.features.byteLength);
      const simRaw = cosineSimilarity(qDecoded, normalizeL2(decodeFeatures(v)));
      const sim = sigmoidalContrast((simRaw + 1) / 2, 5, 0.75);
      return { postIdDec, sim };
    });

    scored.sort((a, b) => {
      if (a.sim !== b.sim) return b.sim - a.sim;
      const aa = BigInt(a.postIdDec);
      const bb = BigInt(b.postIdDec);
      if (aa === bb) return 0;
      return aa > bb ? -1 : 1;
    });

    const expected = scored.map((x) => toHexStrFromDec(x.postIdDec));
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

    const universeDecIds = [121, 123, 124, 127, 125, 122, 129].map(dec);
    const qDecoded = normalizeL2(decodeFeatures(q));
    const scored = universeDecIds.map((postIdDec) => {
      const s = pgClient.summaries.find((x) => x.postId === postIdDec);
      if (!s?.features) throw new Error("test setup error: missing features");
      const v = new Int8Array(s.features.buffer, s.features.byteOffset, s.features.byteLength);
      const simRaw = cosineSimilarity(qDecoded, normalizeL2(decodeFeatures(v)));
      const sim = sigmoidalContrast((simRaw + 1) / 2, 5, 0.75);
      return { postIdDec, sim };
    });

    scored.sort((a, b) => {
      if (a.sim !== b.sim) return b.sim - a.sim;
      const aa = BigInt(a.postIdDec);
      const bb = BigInt(b.postIdDec);
      if (aa === bb) return 0;
      return aa > bb ? -1 : 1;
    });

    const descIds = scored.map((x) => toHexStrFromDec(x.postIdDec));
    const ascIds = [...descIds].reverse();
    const expected = ascIds.slice(1, 1 + 3);

    expect(result).toEqual(expected);
  });

  test("applies socialScore when selfUserId is given", async () => {
    const localPg = new MockPgClient();
    const localService = new AiPostsService(localPg as unknown as Pool);

    const selfUserHex = toHexStrFromDec(dec(777));
    const selfUserDec = toDecStr(selfUserHex);

    localPg.follows.push({ followerId: selfUserDec, followeeId: dec(900) });

    localPg.posts.push(
      { postId: dec(200), replyTo: null, userId: dec(901), publishedAt: "2025-10-10T00:00:01Z" },
      { postId: dec(199), replyTo: null, userId: dec(900), publishedAt: "2025-10-10T00:00:02Z" },
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
    expect(result).toEqual([toHexStrFromDec(dec(199)), toHexStrFromDec(dec(200))]);
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
    await expect(service.BuildSearchSeedForUser(hex(777))).rejects.toThrow("no seed posts");
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
      { postId: selfP1, replyTo: null, userId: selfUserDec, publishedAt: "2025-01-01T00:00:01Z" },
      { postId: selfP2, replyTo: null, userId: selfUserDec, publishedAt: "2025-01-01T00:00:02Z" },
      { postId: selfLiked, replyTo: null, userId: otherOwner, publishedAt: "2025-01-01T00:00:03Z" },
      { postId: faPost, replyTo: null, userId: followeeA, publishedAt: "2025-01-01T00:00:04Z" },
      { postId: fbPost, replyTo: null, userId: followeeB, publishedAt: "2025-01-01T00:00:05Z" },
      { postId: flaLiked, replyTo: null, userId: otherOwner, publishedAt: "2025-01-01T00:00:06Z" },
      { postId: flbLiked, replyTo: null, userId: otherOwner, publishedAt: "2025-01-01T00:00:07Z" },
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

    const result = await service.BuildSearchSeedForUser(selfUserHex);

    expect(result.tags).toEqual([
      { name: "common", count: 14 },
      { name: "self", count: 3 },
      { name: "liked", count: 2 },
      { name: "fa", count: 2 },
      { name: "fb", count: 2 },
      { name: "fla", count: 1 },
      { name: "flb", count: 1 },
    ]);

    expect(result.features).toBeInstanceOf(Int8Array);
    expect(result.features.length).toBe(512);

    const seedPosts: { feat: Int8Array; w: number }[] = [
      { feat: fSelfP1, w: 1.0 },
      { feat: fSelfP2, w: 1.0 },
      { feat: fSelfLiked, w: 0.7 },
      { feat: fFaPost, w: 0.5 },
      { feat: fFbPost, w: 0.5 },
      { feat: fFlaLiked, w: 0.3 },
      { feat: fFlbLiked, w: 0.3 },
    ];

    let sumVec: number[] | null = null;
    for (const s of seedPosts) {
      const v = normalizeL2(decodeFeatures(s.feat));
      if (!sumVec) {
        sumVec = v.map((x) => x * s.w);
      } else {
        for (let i = 0; i < sumVec.length; i++) sumVec[i] += v[i] * s.w;
      }
    }
    if (!sumVec) throw new Error("test setup error");

    const expected = encodeFeatures(normalizeL2(sumVec));
    expect(int8eq(result.features, expected)).toBe(true);
  });
});
