import { AiUsersService } from "./aiUsers";
import { encodeFeatures } from "../utils/vectorSpace";
import type { Pool } from "pg";
import type Redis from "ioredis";

jest.mock("../utils/servers", () => {
  const pgQuery = jest.fn(
    (
      pool: { query: (sql: string, params?: unknown[]) => unknown },
      sql: string,
      params?: unknown[],
    ) => pool.query(sql, params),
  );
  return { pgQuery };
});

const mockCreate = jest.fn();
const mockEmbeddingsCreate = jest.fn();
jest.mock("openai", () => {
  return {
    __esModule: true,
    default: jest.fn().mockImplementation(() => ({
      chat: { completions: { create: mockCreate } },
      embeddings: { create: mockEmbeddingsCreate },
    })),
  };
});

function normalizeSql(sql: string) {
  return sql.replace(/\s+/g, " ").trim();
}

class MockPgPool {
  users: {
    id: number;
    nickname: string;
    is_admin: boolean;
    ai_model: string | null;
    updated_at?: Date | null;
  }[] = [];
  user_secrets: { user_id: number; email: string }[] = [];
  user_details: { user_id: number; introduction: string; ai_personality: string | null }[] = [];
  ai_models: { label: string; service: string; chat_model: string; feature_model: string }[] = [];

  ai_interests: { user_id: number; updated_at: Date; interest: string; features: Buffer }[] = [];
  ai_user_tags: { user_id: number; name: string }[] = [];

  ai_peer_impressions: { user_id: number; peer_id: number; updated_at: Date; payload: string }[] =
    [];
  ai_post_impressions: {
    user_id: number;
    peer_id: number;
    post_id: number;
    updated_at: Date;
    payload: string;
  }[] = [];

  posts: { id: number; owned_by: number }[] = [];

  private nowMs = Date.parse("2025-01-01T00:00:00.000Z");
  private tick(): Date {
    const d = new Date(this.nowMs);
    this.nowMs += 1000;
    return d;
  }

  async connect() {
    return {
      query: async (sql: string, params?: unknown[]) => this.query(sql, params),
      release: () => {},
    };
  }

  private toBuffer(v: unknown): Buffer {
    if (Buffer.isBuffer(v)) return v;
    if (v instanceof Int8Array) return Buffer.from(v.buffer, v.byteOffset, v.byteLength);
    if (v instanceof Uint8Array) return Buffer.from(v.buffer, v.byteOffset, v.byteLength);
    if (Array.isArray(v) && v.every((x) => typeof x === "number"))
      return Buffer.from(v as number[]);
    return Buffer.from([]);
  }

  private toNum(v: unknown): number {
    if (typeof v === "number") return v;
    if (typeof v === "bigint") return Number(v);
    if (typeof v === "string" && v.trim() !== "") return Number(v);
    return 0;
  }

  async query(sql: string, params?: unknown[]) {
    sql = normalizeSql(sql);

    if (sql === "BEGIN" || sql === "COMMIT" || sql === "ROLLBACK") {
      return { rows: [], rowCount: 0 };
    }

    if (sql.startsWith("SELECT label, service, chat_model FROM ai_models WHERE label = $1")) {
      const label = params?.[0];
      const rows = this.ai_models
        .filter((m) => m.label === label)
        .map((m) => ({ label: m.label, service: m.service, chat_model: m.chat_model }));
      return { rows, rowCount: rows.length };
    }

    if (sql.startsWith("SELECT label, service, feature_model FROM ai_models WHERE label = $1")) {
      const label = params?.[0];
      const rows = this.ai_models
        .filter((m) => m.label === label)
        .map((m) => ({ label: m.label, service: m.service, feature_model: m.feature_model }));
      return { rows, rowCount: rows.length };
    }

    if (
      sql.startsWith(
        "SELECT u.id, u.nickname, u.is_admin, u.ai_model FROM users u WHERE u.ai_model IS NOT NULL",
      )
    ) {
      const limit = (params?.[0] as number | undefined) ?? 50;
      const offset = (params?.[1] as number | undefined) ?? 0;
      const asc = sql.includes("ORDER BY u.id ASC");
      const rows = this.users
        .filter((u) => u.ai_model !== null)
        .sort((a, b) => (asc ? a.id - b.id : b.id - a.id))
        .slice(offset, offset + limit)
        .map((u) => ({
          id: String(u.id),
          nickname: u.nickname,
          is_admin: u.is_admin,
          ai_model: u.ai_model,
        }));
      return { rows, rowCount: rows.length };
    }

    if (
      sql.includes("LEFT JOIN user_secrets s ON s.user_id = u.id") &&
      sql.includes("LEFT JOIN user_details d ON d.user_id = u.id")
    ) {
      const uid = this.toNum(params?.[0]);
      const u = this.users.find((x) => x.id === uid);
      if (!u || u.ai_model === null) return { rows: [], rowCount: 0 };
      const s = this.user_secrets.find((x) => x.user_id === uid);
      const d = this.user_details.find((x) => x.user_id === uid);
      const row = {
        id: String(u.id),
        nickname: u.nickname,
        is_admin: u.is_admin,
        ai_model: u.ai_model,
        created_at: new Date("2025-01-01T00:00:00.000Z"),
        updated_at: u.updated_at ?? null,
        email: s?.email ?? "",
        introduction: d?.introduction ?? "",
        ai_personality: d?.ai_personality ?? null,
      };
      return { rows: [row], rowCount: 1 };
    }

    if (sql.startsWith("SELECT user_id, updated_at, interest, features FROM ai_interests")) {
      const uid = this.toNum(params?.[0]);
      const found = this.ai_interests.find((x) => x.user_id === uid);
      if (!found) return { rows: [], rowCount: 0 };
      return {
        rows: [
          {
            user_id: String(found.user_id),
            updated_at: found.updated_at,
            interest: found.interest,
            features: found.features,
          },
        ],
        rowCount: 1,
      };
    }

    if (sql.startsWith("INSERT INTO ai_interests (user_id, updated_at, interest, features)")) {
      const uid = this.toNum(params?.[0]);
      const interest = String(params?.[1] ?? "");
      const features = this.toBuffer(params?.[2]);
      const updated_at = this.tick();

      const existing = this.ai_interests.find((x) => x.user_id === uid);
      if (existing) {
        existing.updated_at = updated_at;
        existing.interest = interest;
        existing.features = features;
      } else {
        this.ai_interests.push({ user_id: uid, updated_at, interest, features });
      }
      return {
        rows: [{ user_id: String(uid), updated_at, interest, features }],
        rowCount: 1,
      };
    }

    if (sql.startsWith("SELECT name FROM ai_user_tags WHERE user_id = $1")) {
      const uid = this.toNum(params?.[0]);
      const rows = this.ai_user_tags
        .filter((x) => x.user_id === uid)
        .map((x) => ({ name: x.name }));
      return { rows, rowCount: rows.length };
    }

    if (sql.startsWith("DELETE FROM ai_user_tags WHERE user_id = $1")) {
      const uid = this.toNum(params?.[0]);
      this.ai_user_tags = this.ai_user_tags.filter((x) => x.user_id !== uid);
      return { rows: [], rowCount: 0 };
    }

    if (sql.startsWith("INSERT INTO ai_user_tags (user_id, name)")) {
      const ps = params ?? [];
      for (let i = 0; i + 1 < ps.length; i += 2) {
        const uid = this.toNum(ps[i]);
        const name = String(ps[i + 1] ?? "").trim();
        if (!name) continue;
        const exists = this.ai_user_tags.some((x) => x.user_id === uid && x.name === name);
        if (!exists) this.ai_user_tags.push({ user_id: uid, name });
      }
      return { rows: [], rowCount: 0 };
    }

    if (sql.startsWith("SELECT user_id, peer_id, updated_at, payload FROM ai_peer_impressions")) {
      if (sql.includes("ORDER BY")) {
        const ps = params ?? [];
        const limit = (ps[ps.length - 2] as number | undefined) ?? 50;
        const offset = (ps[ps.length - 1] as number | undefined) ?? 0;

        let filtered = this.ai_peer_impressions.slice();

        const userMatch = sql.match(/user_id\s*=\s*\$(\d+)/);
        if (userMatch) {
          const idx = Number(userMatch[1]) - 1;
          const uid = this.toNum(ps[idx]);
          filtered = filtered.filter((r) => r.user_id === uid);
        }

        const peerMatch = sql.match(/peer_id\s*=\s*\$(\d+)/);
        if (peerMatch) {
          const idx = Number(peerMatch[1]) - 1;
          const pid = this.toNum(ps[idx]);
          filtered = filtered.filter((r) => r.peer_id === pid);
        }

        const asc = sql.includes("ORDER BY user_id ASC");
        const sorted = filtered.sort((a, b) => {
          const cmpUser = a.user_id - b.user_id;
          if (cmpUser !== 0) return asc ? cmpUser : -cmpUser;
          const cmpPeer = a.peer_id - b.peer_id;
          return asc ? cmpPeer : -cmpPeer;
        });

        const sliced = sorted.slice(offset, offset + limit).map((r) => ({
          user_id: String(r.user_id),
          peer_id: String(r.peer_id),
          updated_at: r.updated_at,
          payload: r.payload,
        }));
        return { rows: sliced, rowCount: sliced.length };
      }

      const uid = this.toNum(params?.[0]);
      const pid = this.toNum(params?.[1]);
      const found = this.ai_peer_impressions.find((r) => r.user_id === uid && r.peer_id === pid);
      if (!found) return { rows: [], rowCount: 0 };
      return {
        rows: [
          {
            user_id: String(found.user_id),
            peer_id: String(found.peer_id),
            updated_at: found.updated_at,
            payload: found.payload,
          },
        ],
        rowCount: 1,
      };
    }

    if (sql.startsWith("SELECT 1 FROM ai_peer_impressions")) {
      const uid = this.toNum(params?.[0]);
      const pid = this.toNum(params?.[1]);
      const found = this.ai_peer_impressions.some((r) => r.user_id === uid && r.peer_id === pid);
      if (!found) return { rows: [], rowCount: 0 };
      return { rows: [{ exists: 1 }], rowCount: 1 };
    }

    if (sql.startsWith("INSERT INTO ai_peer_impressions (user_id, peer_id, updated_at, payload)")) {
      const uid = this.toNum(params?.[0]);
      const pid = this.toNum(params?.[1]);
      const payload = String(params?.[2] ?? "");
      const updated_at = this.tick();

      const existing = this.ai_peer_impressions.find((r) => r.user_id === uid && r.peer_id === pid);
      if (existing) {
        existing.updated_at = updated_at;
        existing.payload = payload;
      } else {
        this.ai_peer_impressions.push({ user_id: uid, peer_id: pid, updated_at, payload });
      }

      return {
        rows: [{ user_id: String(uid), peer_id: String(pid), updated_at, payload }],
        rowCount: 1,
      };
    }

    if (sql.startsWith("SELECT owned_by FROM posts WHERE id = $1")) {
      const pid = this.toNum(params?.[0]);
      const post = this.posts.find((p) => p.id === pid);
      if (!post) return { rows: [], rowCount: 0 };
      return { rows: [{ owned_by: String(post.owned_by) }], rowCount: 1 };
    }

    if (sql.startsWith("SELECT 1 FROM ai_post_impressions")) {
      const uid = this.toNum(params?.[0]);
      const pid = this.toNum(params?.[1]);
      const found = this.ai_post_impressions.some((r) => r.user_id === uid && r.post_id === pid);
      if (!found) return { rows: [], rowCount: 0 };
      return { rows: [{ exists: 1 }], rowCount: 1 };
    }

    if (
      sql.startsWith(
        "SELECT user_id, peer_id, post_id, updated_at, payload FROM ai_post_impressions",
      )
    ) {
      if (sql.includes("ORDER BY")) {
        const ps = params ?? [];
        const limit = (ps[ps.length - 2] as number | undefined) ?? 50;
        const offset = (ps[ps.length - 1] as number | undefined) ?? 0;
        let filtered = this.ai_post_impressions.slice();

        const userMatch = sql.match(/user_id\s*=\s*\$(\d+)/);
        if (userMatch) {
          const idx = Number(userMatch[1]) - 1;
          const uid = this.toNum(ps[idx]);
          filtered = filtered.filter((r) => r.user_id === uid);
        }

        const peerMatch = sql.match(/peer_id\s*=\s*\$(\d+)/);
        if (peerMatch) {
          const idx = Number(peerMatch[1]) - 1;
          const oid = this.toNum(ps[idx]);
          filtered = filtered.filter((r) => r.peer_id === oid);
        }

        const postMatch = sql.match(/post_id\s*=\s*\$(\d+)/);
        if (postMatch) {
          const idx = Number(postMatch[1]) - 1;
          const pid = this.toNum(ps[idx]);
          filtered = filtered.filter((r) => r.post_id === pid);
        }

        const asc = sql.includes(" ASC");
        let sorted: typeof filtered;
        if (sql.includes("ORDER BY post_id")) {
          sorted = filtered.sort((a, b) => {
            const cmp = a.post_id - b.post_id;
            return asc ? cmp : -cmp;
          });
        } else {
          sorted = filtered.sort((a, b) => {
            const cmpUser = a.user_id - b.user_id;
            if (cmpUser !== 0) return asc ? cmpUser : -cmpUser;
            const cmpPeer = a.peer_id - b.peer_id;
            if (cmpPeer !== 0) return asc ? cmpPeer : -cmpPeer;
            const cmpPost = a.post_id - b.post_id;
            return asc ? cmpPost : -cmpPost;
          });
        }

        const sliced = sorted.slice(offset, offset + limit).map((r) => ({
          user_id: String(r.user_id),
          peer_id: String(r.peer_id),
          post_id: String(r.post_id),
          updated_at: r.updated_at,
          payload: r.payload,
        }));
        return { rows: sliced, rowCount: sliced.length };
      }

      const uid = this.toNum(params?.[0]);
      const pid = this.toNum(params?.[1]);
      const found = this.ai_post_impressions.find((r) => r.user_id === uid && r.post_id === pid);
      if (!found) return { rows: [], rowCount: 0 };
      return {
        rows: [
          {
            user_id: String(found.user_id),
            peer_id: String(found.peer_id),
            post_id: String(found.post_id),
            updated_at: found.updated_at,
            payload: found.payload,
          },
        ],
        rowCount: 1,
      };
    }

    if (
      sql.startsWith(
        "INSERT INTO ai_post_impressions (user_id, peer_id, post_id, updated_at, payload)",
      )
    ) {
      const uid = this.toNum(params?.[0]);
      const oid = this.toNum(params?.[1]);
      const pid = this.toNum(params?.[2]);
      const payload = String(params?.[3] ?? "");
      const updated_at = this.tick();

      const existing = this.ai_post_impressions.find(
        (r) => r.user_id === uid && r.peer_id === oid && r.post_id === pid,
      );
      if (existing) {
        existing.updated_at = updated_at;
        existing.payload = payload;
      } else {
        this.ai_post_impressions.push({
          user_id: uid,
          peer_id: oid,
          post_id: pid,
          updated_at,
          payload,
        });
      }

      return {
        rows: [
          {
            user_id: String(uid),
            peer_id: String(oid),
            post_id: String(pid),
            updated_at,
            payload,
          },
        ],
        rowCount: 1,
      };
    }

    return { rows: [], rowCount: 0 };
  }
}

class MockRedis {}

describe("AiUsersService", () => {
  let pgPool: MockPgPool;
  let redis: MockRedis;
  let service: AiUsersService;

  beforeEach(() => {
    pgPool = new MockPgPool();
    redis = new MockRedis();
    service = new AiUsersService(pgPool as unknown as Pool, redis as unknown as Redis);
    mockCreate.mockReset();
    mockEmbeddingsCreate.mockReset();

    pgPool.users.push(
      { id: 1000, nickname: "Human", is_admin: false, ai_model: null, updated_at: null },
      { id: 1001, nickname: "BotOne", is_admin: false, ai_model: "balanced", updated_at: null },
      {
        id: 1002,
        nickname: "BotTwo",
        is_admin: true,
        ai_model: "balanced",
        updated_at: new Date("2025-02-02T00:00:00Z"),
      },
    );
    pgPool.user_secrets.push(
      { user_id: 1001, email: "botone@example.com" },
      { user_id: 1002, email: "bottwo@example.com" },
    );
    pgPool.user_details.push(
      { user_id: 1001, introduction: "Hello, I'm BotOne.", ai_personality: "Calm and logical." },
      { user_id: 1002, introduction: "Hi, I'm BotTwo.", ai_personality: "Cheerful and curious." },
    );
    pgPool.ai_models.push({
      label: "balanced",
      service: "openai",
      chat_model: "gpt-5-mini",
      feature_model: "text-embedding-3-small",
    });
    pgPool.ai_models.push({
      label: "advanced",
      service: "openai",
      chat_model: "gpt-5",
      feature_model: "text-embedding-3-large",
    });
  });

  test("listAiUsers: returns AI users only, default desc", async () => {
    const out = await service.listAiUsers({ limit: 10, offset: 0 });
    expect(out).toHaveLength(2);
    expect(out[0].nickname).toBe("BotTwo");
    expect(out[1].nickname).toBe("BotOne");
    expect(out[0].id).toBe("00000000000003EA");
    expect(out[1].id).toBe("00000000000003E9");
    expect(out[0].isAdmin).toBe(true);
    expect(out[1].isAdmin).toBe(false);
    expect(out[0].aiModel).toBe("balanced");
  });

  test("listAiUsers: asc and pagination", async () => {
    const p1 = await service.listAiUsers({ order: "asc", limit: 1, offset: 0 });
    expect(p1).toHaveLength(1);
    expect(p1[0].nickname).toBe("BotOne");
    expect(p1[0].id).toBe("00000000000003E9");
    const p2 = await service.listAiUsers({ order: "asc", limit: 1, offset: 1 });
    expect(p2).toHaveLength(1);
    expect(p2[0].nickname).toBe("BotTwo");
    expect(p2[0].id).toBe("00000000000003EA");
  });

  test("getAiUser: returns detail for AI user", async () => {
    const hexId = BigInt(1001).toString(16).toUpperCase();
    const detail = await service.getAiUser(hexId);
    expect(detail).not.toBeNull();
    expect(detail!.nickname).toBe("BotOne");
    expect(detail!.isAdmin).toBe(false);
    expect(detail!.aiModel).toBe("balanced");
    expect(detail!.email).toBe("botone@example.com");
    expect(detail!.introduction).toBe("Hello, I'm BotOne.");
    expect(detail!.aiPersonality).toBe("Calm and logical.");
    expect(typeof detail!.createdAt).toBe("string");
    expect(detail!.updatedAt).toBeNull();
  });

  test("getAiUser: ai_personality null becomes empty string", async () => {
    const uid = 2001;
    pgPool.users.push({ id: uid, nickname: "BotNull", is_admin: false, ai_model: "balanced" });
    pgPool.user_secrets.push({ user_id: uid, email: "botnull@example.com" });
    pgPool.user_details.push({ user_id: uid, introduction: "intro", ai_personality: null });
    const hexId = BigInt(uid).toString(16).toUpperCase();
    const detail = await service.getAiUser(hexId);
    expect(detail).not.toBeNull();
    expect(detail!.aiPersonality).toBe("");
  });

  test("getAiUser: returns null for non-AI user", async () => {
    const hexIdHuman = BigInt(1000).toString(16).toUpperCase();
    const detail = await service.getAiUser(hexIdHuman);
    expect(detail).toBeNull();
  });

  test("getAiUser: returns null if not found", async () => {
    const hexIdUnknown = BigInt(9999).toString(16).toUpperCase();
    const detail = await service.getAiUser(hexIdUnknown);
    expect(detail).toBeNull();
  });

  test("chat: proxies to OpenAI and returns content", async () => {
    mockCreate.mockResolvedValue({ choices: [{ message: { content: "Hello from model!" } }] });
    const res = await service.chat({
      model: "balanced",
      messages: [{ role: "user", content: "hi" }],
    });
    expect(res).toEqual({ message: { content: "Hello from model!" } });
    expect(mockCreate).toHaveBeenCalledTimes(1);
    expect(mockCreate).toHaveBeenCalledWith(
      { model: "gpt-5-mini", service_tier: "flex", messages: [{ role: "user", content: "hi" }] },
      { timeout: 600000 },
    );
  });

  test("chat: returns empty string if provider returns no choices", async () => {
    mockCreate.mockResolvedValue({ choices: [] });
    const res = await service.chat({
      model: "balanced",
      messages: [{ role: "user", content: "anything" }],
    });
    expect(res.message.content).toBe("");
  });

  test("generateFeatures: returns encoded Int8Array", async () => {
    const emb = Array.from({ length: 256 }, (_, i) => {
      const v = ((i % 97) + 1) / 1000;
      return i % 2 === 0 ? v : -v;
    });
    mockEmbeddingsCreate.mockResolvedValue({ data: [{ embedding: emb }] });
    const out = await service.generateFeatures({ model: "balanced", input: "hello" });
    expect(mockEmbeddingsCreate).toHaveBeenCalledTimes(1);
    expect(mockEmbeddingsCreate).toHaveBeenCalledWith(
      { model: "text-embedding-3-small", input: "hello" },
      { timeout: 600000 },
    );
    expect(out.features).toBeInstanceOf(Int8Array);
    const expected = encodeFeatures(emb);
    expect(Array.from(out.features)).toEqual(Array.from(expected));
  });

  test("generateFeatures: supports another model label", async () => {
    const emb = Array.from({ length: 256 }, (_, i) => {
      const v = ((i % 89) + 1) / 2000;
      return i % 2 === 0 ? -v : v;
    });
    mockEmbeddingsCreate.mockResolvedValue({ data: [{ embedding: emb }] });
    const out = await service.generateFeatures({ model: "advanced", input: "x" });
    expect(mockEmbeddingsCreate).toHaveBeenCalledWith(
      { model: "text-embedding-3-large", input: "x" },
      { timeout: 600000 },
    );
    const expected = encodeFeatures(emb);
    expect(Array.from(out.features)).toEqual(Array.from(expected));
  });

  test("generateFeatures: throws on unknown model label", async () => {
    await expect(service.generateFeatures({ model: "nope", input: "x" })).rejects.toThrow(
      "no such model",
    );
  });

  test("generateFeatures: throws on unsupported service", async () => {
    pgPool.ai_models.push({
      label: "weird",
      service: "other",
      chat_model: "x",
      feature_model: "y",
    });
    await expect(service.generateFeatures({ model: "weird", input: "x" })).rejects.toThrow(
      "unsupported service",
    );
  });

  test("getAiUserInterest: returns null when not set", async () => {
    const userHex = BigInt(1001).toString(16).toUpperCase();
    const interest = await service.getAiUserInterest(userHex);
    expect(interest).toBeNull();
  });

  test("setAiUserInterest: upsert and get", async () => {
    const userHex = BigInt(1001).toString(16).toUpperCase();
    const expectedHex = BigInt(1001).toString(16).toUpperCase().padStart(16, "0");
    const feats1 = Int8Array.from([1, -2, 3, 4]);

    const saved1 = await service.setAiUserInterest({
      userId: userHex,
      interest: "First interest",
      features: feats1,
      tags: ["t1", "t2"],
    });
    expect(saved1.userId).toBe(expectedHex);
    expect(typeof saved1.updatedAt).toBe("string");
    expect(saved1.updatedAt.length).toBeGreaterThan(0);
    expect(saved1.interest).toBe("First interest");
    expect(Array.from(saved1.features)).toEqual(Array.from(feats1));
    expect(saved1.tags.slice().sort()).toEqual(["t1", "t2"].sort());

    const fetched1 = await service.getAiUserInterest(userHex);
    expect(fetched1).not.toBeNull();
    expect(fetched1!.userId).toBe(expectedHex);
    expect(typeof fetched1!.updatedAt).toBe("string");
    expect(fetched1!.updatedAt.length).toBeGreaterThan(0);
    expect(fetched1!.interest).toBe("First interest");
    expect(Array.from(fetched1!.features)).toEqual(Array.from(feats1));
    expect(fetched1!.tags.slice().sort()).toEqual(["t1", "t2"].sort());

    const feats2 = Int8Array.from([-1, 2, -3, 4, 5]);
    const saved2 = await service.setAiUserInterest({
      userId: userHex,
      interest: "Updated interest",
      features: feats2,
      tags: ["t3"],
    });
    expect(saved2.userId).toBe(expectedHex);
    expect(typeof saved2.updatedAt).toBe("string");
    expect(saved2.updatedAt.length).toBeGreaterThan(0);
    expect(saved2.interest).toBe("Updated interest");
    expect(Array.from(saved2.features)).toEqual(Array.from(feats2));
    expect(saved2.tags.slice().sort()).toEqual(["t3"].sort());

    const fetched2 = await service.getAiUserInterest(userHex);
    expect(fetched2).not.toBeNull();
    expect(typeof fetched2!.updatedAt).toBe("string");
    expect(fetched2!.updatedAt.length).toBeGreaterThan(0);
    expect(fetched2!.interest).toBe("Updated interest");
    expect(Array.from(fetched2!.features)).toEqual(Array.from(feats2));
    expect(fetched2!.tags.slice().sort()).toEqual(["t3"].sort());
  });

  test("getAiPeerImpression: returns null when not set", async () => {
    const userHex = BigInt(1001).toString(16).toUpperCase();
    const peerHex = BigInt(1002).toString(16).toUpperCase();
    const impression = await service.getAiPeerImpression(userHex, peerHex);
    expect(impression).toBeNull();
  });

  test("setAiPeerImpression and getAiPeerImpression", async () => {
    const userHex = BigInt(1001).toString(16).toUpperCase();
    const peerHex = BigInt(1002).toString(16).toUpperCase();
    const expectedUserHex = BigInt(1001).toString(16).toUpperCase().padStart(16, "0");
    const expectedPeerHex = BigInt(1002).toString(16).toUpperCase().padStart(16, "0");

    const saved = await service.setAiPeerImpression({
      userId: userHex,
      peerId: peerHex,
      payload: "Friendly peer",
    });
    expect(saved.userId).toBe(expectedUserHex);
    expect(saved.peerId).toBe(expectedPeerHex);
    expect(typeof saved.updatedAt).toBe("string");
    expect(saved.updatedAt.length).toBeGreaterThan(0);
    expect(saved.payload).toBe("Friendly peer");

    const fetched = await service.getAiPeerImpression(userHex, peerHex);
    expect(fetched).not.toBeNull();
    expect(fetched!.userId).toBe(expectedUserHex);
    expect(fetched!.peerId).toBe(expectedPeerHex);
    expect(typeof fetched!.updatedAt).toBe("string");
    expect(fetched!.updatedAt.length).toBeGreaterThan(0);
    expect(fetched!.payload).toBe("Friendly peer");
  });

  test("checkAiPeerImpression: false when not set, true after set", async () => {
    const userHex = BigInt(1001).toString(16).toUpperCase();
    const peerHex = BigInt(1002).toString(16).toUpperCase();
    const before = await service.checkAiPeerImpression(userHex, peerHex);
    expect(before).toBe(false);
    await service.setAiPeerImpression({
      userId: userHex,
      peerId: peerHex,
      payload: "Friendly peer",
    });
    const after = await service.checkAiPeerImpression(userHex, peerHex);
    expect(after).toBe(true);
  });

  test("listAiPeerImpressions: list and filter by peerId", async () => {
    const userHex = BigInt(1001).toString(16).toUpperCase();
    const peer1Hex = BigInt(1002).toString(16).toUpperCase();
    const peer2Hex = BigInt(1000).toString(16).toUpperCase();
    const expectedPeer1Hex = BigInt(1002).toString(16).toUpperCase().padStart(16, "0");
    const expectedPeer2Hex = BigInt(1000).toString(16).toUpperCase().padStart(16, "0");

    await service.setAiPeerImpression({ userId: userHex, peerId: peer1Hex, payload: "Peer one" });
    await service.setAiPeerImpression({ userId: userHex, peerId: peer2Hex, payload: "Peer two" });

    const all = await service.listAiPeerImpressions({ userId: userHex, limit: 10, offset: 0 });
    expect(all).toHaveLength(2);
    for (const x of all) {
      expect(typeof x.updatedAt).toBe("string");
      expect(x.updatedAt.length).toBeGreaterThan(0);
    }
    const peerIds = all.map((p) => p.peerId).sort();
    expect(peerIds).toEqual([expectedPeer2Hex, expectedPeer1Hex].sort());

    const filtered = await service.listAiPeerImpressions({
      userId: userHex,
      peerId: peer1Hex,
      limit: 10,
      offset: 0,
    });
    expect(filtered).toHaveLength(1);
    expect(filtered[0].peerId).toBe(expectedPeer1Hex);
    expect(filtered[0].payload).toBe("Peer one");
    expect(typeof filtered[0].updatedAt).toBe("string");
    expect(filtered[0].updatedAt.length).toBeGreaterThan(0);
  });

  test("getAiPostImpression: returns null when not set", async () => {
    const userHex = BigInt(1001).toString(16).toUpperCase();
    const postHex = BigInt(5001).toString(16).toUpperCase();
    const impression = await service.getAiPostImpression(userHex, postHex);
    expect(impression).toBeNull();
  });

  test("setAiPostImpression and getAiPostImpression (peerId derived from posts)", async () => {
    const userId = 1001;
    const peerId = 2000;
    const postId = 5001;
    pgPool.posts.push({ id: postId, owned_by: peerId });

    const userHex = BigInt(userId).toString(16).toUpperCase();
    const postHex = BigInt(postId).toString(16).toUpperCase();
    const expectedUserHex = BigInt(userId).toString(16).toUpperCase().padStart(16, "0");
    const expectedPeerHex = BigInt(peerId).toString(16).toUpperCase().padStart(16, "0");
    const expectedPostHex = BigInt(postId).toString(16).toUpperCase().padStart(16, "0");

    const saved = await service.setAiPostImpression({
      userId: userHex,
      postId: postHex,
      payload: "Interesting post",
    });
    expect(saved.userId).toBe(expectedUserHex);
    expect(saved.peerId).toBe(expectedPeerHex);
    expect(saved.postId).toBe(expectedPostHex);
    expect(typeof saved.updatedAt).toBe("string");
    expect(saved.updatedAt.length).toBeGreaterThan(0);
    expect(saved.payload).toBe("Interesting post");

    const fetched = await service.getAiPostImpression(userHex, postHex);
    expect(fetched).not.toBeNull();
    expect(fetched!.userId).toBe(expectedUserHex);
    expect(fetched!.peerId).toBe(expectedPeerHex);
    expect(fetched!.postId).toBe(expectedPostHex);
    expect(typeof fetched!.updatedAt).toBe("string");
    expect(fetched!.updatedAt.length).toBeGreaterThan(0);
    expect(fetched!.payload).toBe("Interesting post");
  });

  test("checkAiPostImpression: false when not set, true after set", async () => {
    const userId = 1001;
    const peerId = 2000;
    const postId = 6001;
    pgPool.posts.push({ id: postId, owned_by: peerId });

    const userHex = BigInt(userId).toString(16).toUpperCase();
    const postHex = BigInt(postId).toString(16).toUpperCase();

    const before = await service.checkAiPostImpression(userHex, postHex);
    expect(before).toBe(false);

    await service.setAiPostImpression({
      userId: userHex,
      postId: postHex,
      payload: "Checked post",
    });

    const after = await service.checkAiPostImpression(userHex, postHex);
    expect(after).toBe(true);
  });

  test("listAiPostImpressions: list and filter by postId / peerId / userId", async () => {
    const user1Id = 1001;
    const user2Id = 1002;
    const peer1Id = 3000;
    const peer2Id = 3001;
    const post1Id = 5001;
    const post2Id = 5002;
    const post3Id = 5003;

    pgPool.posts.push(
      { id: post1Id, owned_by: peer1Id },
      { id: post2Id, owned_by: peer2Id },
      { id: post3Id, owned_by: peer1Id },
    );

    const user1Hex = BigInt(user1Id).toString(16).toUpperCase();
    const user2Hex = BigInt(user2Id).toString(16).toUpperCase();
    const peer1Hex = BigInt(peer1Id).toString(16).toUpperCase();
    const peer2Hex = BigInt(peer2Id).toString(16).toUpperCase();
    const post1Hex = BigInt(post1Id).toString(16).toUpperCase();
    const post2Hex = BigInt(post2Id).toString(16).toUpperCase();
    const post3Hex = BigInt(post3Id).toString(16).toUpperCase();

    const expectedUser1Hex = BigInt(user1Id).toString(16).toUpperCase().padStart(16, "0");
    const expectedUser2Hex = BigInt(user2Id).toString(16).toUpperCase().padStart(16, "0");
    const expectedPeer1Hex = BigInt(peer1Id).toString(16).toUpperCase().padStart(16, "0");
    const expectedPeer2Hex = BigInt(peer2Id).toString(16).toUpperCase().padStart(16, "0");
    const expectedPost1Hex = BigInt(post1Id).toString(16).toUpperCase().padStart(16, "0");
    const expectedPost2Hex = BigInt(post2Id).toString(16).toUpperCase().padStart(16, "0");
    const expectedPost3Hex = BigInt(post3Id).toString(16).toUpperCase().padStart(16, "0");

    await service.setAiPostImpression({ userId: user1Hex, postId: post1Hex, payload: "u1 p1 o1" });
    await service.setAiPostImpression({ userId: user1Hex, postId: post2Hex, payload: "u1 p2 o2" });
    await service.setAiPostImpression({ userId: user2Hex, postId: post3Hex, payload: "u2 p3 o1" });

    const all = await service.listAiPostImpressions({ limit: 10, offset: 0 });
    expect(all).toHaveLength(3);
    for (const x of all) {
      expect(typeof x.updatedAt).toBe("string");
      expect(x.updatedAt.length).toBeGreaterThan(0);
    }

    const byPost1 = await service.listAiPostImpressions({ postId: post1Hex, limit: 10, offset: 0 });
    expect(byPost1).toHaveLength(1);
    expect(byPost1[0].userId).toBe(expectedUser1Hex);
    expect(byPost1[0].peerId).toBe(expectedPeer1Hex);
    expect(byPost1[0].postId).toBe(expectedPost1Hex);
    expect(byPost1[0].payload).toBe("u1 p1 o1");

    const byPeer1 = await service.listAiPostImpressions({ peerId: peer1Hex, limit: 10, offset: 0 });
    expect(byPeer1).toHaveLength(2);
    const peer1Posts = byPeer1.map((r) => r.postId).sort();
    expect(peer1Posts).toEqual([expectedPost1Hex, expectedPost3Hex].sort());

    const byUser1 = await service.listAiPostImpressions({ userId: user1Hex, limit: 10, offset: 0 });
    expect(byUser1).toHaveLength(2);
    const user1Posts = byUser1.map((r) => r.postId).sort();
    expect(user1Posts).toEqual([expectedPost1Hex, expectedPost2Hex].sort());

    const byUser1Peer1 = await service.listAiPostImpressions({
      userId: user1Hex,
      peerId: peer1Hex,
      limit: 10,
      offset: 0,
    });
    expect(byUser1Peer1).toHaveLength(1);
    expect(byUser1Peer1[0].userId).toBe(expectedUser1Hex);
    expect(byUser1Peer1[0].peerId).toBe(expectedPeer1Hex);
    expect(byUser1Peer1[0].postId).toBe(expectedPost1Hex);
    expect(byUser1Peer1[0].payload).toBe("u1 p1 o1");

    const byPeer2 = await service.listAiPostImpressions({ peerId: peer2Hex, limit: 10, offset: 0 });
    expect(byPeer2).toHaveLength(1);
    expect(byPeer2[0].userId).toBe(expectedUser1Hex);
    expect(byPeer2[0].peerId).toBe(expectedPeer2Hex);
    expect(byPeer2[0].postId).toBe(expectedPost2Hex);
    expect(byPeer2[0].payload).toBe("u1 p2 o2");

    const byUser2 = await service.listAiPostImpressions({ userId: user2Hex, limit: 10, offset: 0 });
    expect(byUser2).toHaveLength(1);
    expect(byUser2[0].userId).toBe(expectedUser2Hex);
    expect(byUser2[0].peerId).toBe(expectedPeer1Hex);
    expect(byUser2[0].postId).toBe(expectedPost3Hex);
    expect(byUser2[0].payload).toBe("u2 p3 o1");
  });
});
