import { AiPostsService } from "./aiPosts";
import type { Pool } from "pg";
import { ListAiPostSummariesInput, UpdateAiPostSummaryInput } from "../models/aiPost";
import crypto from "crypto";
import { hexToDec } from "../utils/format";

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

class MockPgClient {
  summaries: MockAiPostSummaryRow[] = [];
  tags: MockAiPostTagRow[] = [];

  async query(sql: string, params?: unknown[]) {
    sql = normalizeSql(sql);

    if (sql === "BEGIN" || sql === "COMMIT" || sql === "ROLLBACK") {
      return { rows: [], rowCount: 0 };
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
