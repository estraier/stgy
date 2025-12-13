import { AiUsersService } from "./aiUsers";
import { encodeFeatures } from "../utils/vectorSpace";

jest.mock("../utils/servers", () => {
  const pgQuery = jest.fn((pool: any, sql: string, params?: any[]) => pool.query(sql, params));
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
  ai_models: { label: string; service: string; name: string }[] = [];
  ai_feature_models: { label: string; service: string; name: string }[] = [];
  ai_interests: { user_id: number; payload: string }[] = [];
  ai_peer_impressions: { user_id: number; peer_id: number; payload: string }[] = [];
  ai_post_impressions: { user_id: number; peer_id: number; post_id: number; payload: string }[] =
    [];
  posts: { id: number; owned_by: number }[] = [];

  async query(sql: string, params?: any[]) {
    sql = normalizeSql(sql);

    if (sql.startsWith("SELECT label, service, name FROM ai_models WHERE label = $1")) {
      const label = params?.[0];
      const rows = this.ai_models
        .filter((m) => m.label === label)
        .map((m) => ({ label: m.label, service: m.service, name: m.name }));
      return { rows, rowCount: rows.length };
    }

    if (sql.startsWith("SELECT label, service, name FROM ai_feature_models WHERE label = $1")) {
      const label = params?.[0];
      const rows = this.ai_feature_models
        .filter((m) => m.label === label)
        .map((m) => ({ label: m.label, service: m.service, name: m.name }));
      return { rows, rowCount: rows.length };
    }

    if (
      sql.startsWith(
        "SELECT u.id, u.nickname, u.is_admin, u.ai_model FROM users u WHERE u.ai_model IS NOT NULL",
      )
    ) {
      const limit = params?.[0] ?? 50;
      const offset = params?.[1] ?? 0;
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
      const idParam = params?.[0];
      const uid = typeof idParam === "string" ? Number(idParam) : idParam;
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

    if (sql.startsWith("SELECT user_id, payload FROM ai_interests WHERE user_id = $1")) {
      const idParam = params?.[0];
      const uid = typeof idParam === "string" ? Number(idParam) : idParam;
      const found = this.ai_interests.find((x) => x.user_id === uid);
      if (!found) return { rows: [], rowCount: 0 };
      return { rows: [{ user_id: String(found.user_id), payload: found.payload }], rowCount: 1 };
    }

    if (sql.startsWith("INSERT INTO ai_interests (user_id, payload)")) {
      const idParam = params?.[0];
      const payload = params?.[1] ?? "";
      const uid = typeof idParam === "string" ? Number(idParam) : idParam;
      const existing = this.ai_interests.find((x) => x.user_id === uid);
      if (existing) existing.payload = payload;
      else this.ai_interests.push({ user_id: uid, payload });
      return { rows: [{ user_id: String(uid), payload }], rowCount: 1 };
    }

    if (sql.startsWith("SELECT user_id, peer_id, payload FROM ai_peer_impressions")) {
      if (sql.includes("ORDER BY")) {
        const limit = params?.[params.length - 2] ?? 50;
        const offset = params?.[params.length - 1] ?? 0;
        let filtered = this.ai_peer_impressions.slice();
        const userMatch = sql.match(/user_id\s*=\s*\$(\d+)/);
        if (userMatch) {
          const idx = Number(userMatch[1]) - 1;
          const userParam = params?.[idx];
          const uid = typeof userParam === "string" ? Number(userParam) : userParam;
          filtered = filtered.filter((r) => r.user_id === uid);
        }
        const peerMatch = sql.match(/peer_id\s*=\s*\$(\d+)/);
        if (peerMatch) {
          const idx = Number(peerMatch[1]) - 1;
          const peerParam = params?.[idx];
          const pid = typeof peerParam === "string" ? Number(peerParam) : peerParam;
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
          payload: r.payload,
        }));
        return { rows: sliced, rowCount: sliced.length };
      }
      const userParam = params?.[0];
      const peerParam = params?.[1];
      const uid = typeof userParam === "string" ? Number(userParam) : userParam;
      const pid = typeof peerParam === "string" ? Number(peerParam) : peerParam;
      const found = this.ai_peer_impressions.find((r) => r.user_id === uid && r.peer_id === pid);
      if (!found) return { rows: [], rowCount: 0 };
      return {
        rows: [
          {
            user_id: String(found.user_id),
            peer_id: String(found.peer_id),
            payload: found.payload,
          },
        ],
        rowCount: 1,
      };
    }

    if (sql.startsWith("SELECT 1 FROM ai_peer_impressions")) {
      const userParam = params?.[0];
      const peerParam = params?.[1];
      const uid = typeof userParam === "string" ? Number(userParam) : userParam;
      const pid = typeof peerParam === "string" ? Number(peerParam) : peerParam;
      const found = this.ai_peer_impressions.some((r) => r.user_id === uid && r.peer_id === pid);
      if (!found) return { rows: [], rowCount: 0 };
      return { rows: [{ exists: 1 }], rowCount: 1 };
    }

    if (sql.startsWith("INSERT INTO ai_peer_impressions (user_id, peer_id, payload)")) {
      const userParam = params?.[0];
      const peerParam = params?.[1];
      const payload = params?.[2] ?? "";
      const uid = typeof userParam === "string" ? Number(userParam) : userParam;
      const pid = typeof peerParam === "string" ? Number(peerParam) : peerParam;
      const existing = this.ai_peer_impressions.find((r) => r.user_id === uid && r.peer_id === pid);
      if (existing) existing.payload = payload;
      else this.ai_peer_impressions.push({ user_id: uid, peer_id: pid, payload });
      return { rows: [{ user_id: String(uid), peer_id: String(pid), payload }], rowCount: 1 };
    }

    if (sql.startsWith("SELECT owned_by FROM posts WHERE id = $1")) {
      const idParam = params?.[0];
      const pid = typeof idParam === "string" ? Number(idParam) : idParam;
      const post = this.posts.find((p) => p.id === pid);
      if (!post) return { rows: [], rowCount: 0 };
      return { rows: [{ owned_by: String(post.owned_by) }], rowCount: 1 };
    }

    if (sql.startsWith("SELECT 1 FROM ai_post_impressions")) {
      const userParam = params?.[0];
      const postParam = params?.[1];
      const uid = typeof userParam === "string" ? Number(userParam) : userParam;
      const pid = typeof postParam === "string" ? Number(postParam) : postParam;
      const found = this.ai_post_impressions.some((r) => r.user_id === uid && r.post_id === pid);
      if (!found) return { rows: [], rowCount: 0 };
      return { rows: [{ exists: 1 }], rowCount: 1 };
    }

    if (sql.startsWith("SELECT user_id, peer_id, post_id, payload FROM ai_post_impressions")) {
      if (sql.includes("ORDER BY")) {
        const limit = params?.[params.length - 2] ?? 50;
        const offset = params?.[params.length - 1] ?? 0;
        let filtered = this.ai_post_impressions.slice();
        const userMatch = sql.match(/user_id\s*=\s*\$(\d+)/);
        if (userMatch) {
          const idx = Number(userMatch[1]) - 1;
          const userParam = params?.[idx];
          const uid = typeof userParam === "string" ? Number(userParam) : userParam;
          filtered = filtered.filter((r) => r.user_id === uid);
        }
        const peerMatch = sql.match(/peer_id\s*=\s*\$(\d+)/);
        if (peerMatch) {
          const idx = Number(peerMatch[1]) - 1;
          const peerParam = params?.[idx];
          const oid = typeof peerParam === "string" ? Number(peerParam) : peerParam;
          filtered = filtered.filter((r) => r.peer_id === oid);
        }
        const postMatch = sql.match(/post_id\s*=\s*\$(\d+)/);
        if (postMatch) {
          const idx = Number(postMatch[1]) - 1;
          const postParam = params?.[idx];
          const pid = typeof postParam === "string" ? Number(postParam) : postParam;
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
          payload: r.payload,
        }));
        return { rows: sliced, rowCount: sliced.length };
      }
      const userParam = params?.[0];
      const postParam = params?.[1];
      const uid = typeof userParam === "string" ? Number(userParam) : userParam;
      const pid = typeof postParam === "string" ? Number(postParam) : postParam;
      const found = this.ai_post_impressions.find((r) => r.user_id === uid && r.post_id === pid);
      if (!found) return { rows: [], rowCount: 0 };
      return {
        rows: [
          {
            user_id: String(found.user_id),
            peer_id: String(found.peer_id),
            post_id: String(found.post_id),
            payload: found.payload,
          },
        ],
        rowCount: 1,
      };
    }

    if (sql.startsWith("INSERT INTO ai_post_impressions (user_id, peer_id, post_id, payload)")) {
      const userParam = params?.[0];
      const peerParam = params?.[1];
      const postParam = params?.[2];
      const payload = params?.[3] ?? "";
      const uid = typeof userParam === "string" ? Number(userParam) : userParam;
      const oid = typeof peerParam === "string" ? Number(peerParam) : peerParam;
      const pid = typeof postParam === "string" ? Number(postParam) : postParam;
      const existing = this.ai_post_impressions.find(
        (r) => r.user_id === uid && r.peer_id === oid && r.post_id === pid,
      );
      if (existing) existing.payload = payload;
      else this.ai_post_impressions.push({ user_id: uid, peer_id: oid, post_id: pid, payload });
      return {
        rows: [{ user_id: String(uid), peer_id: String(oid), post_id: String(pid), payload }],
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
    service = new AiUsersService(pgPool as any, redis as any);
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

    pgPool.ai_models.push({ label: "balanced", service: "openai", name: "gpt-5-mini" });

    pgPool.ai_feature_models.push(
      { label: "advanced", service: "openai", name: "text-embedding-3-large" },
      { label: "basic", service: "openai", name: "text-embedding-3-small" },
    );
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

  test("generateFeatures: uses default model and returns encoded Int8Array", async () => {
    mockEmbeddingsCreate.mockResolvedValue({ data: [{ embedding: [1, -2, 3, 4] }] });
    const out = await service.generateFeatures({ model: "basic", input: "hello" });
    expect(mockEmbeddingsCreate).toHaveBeenCalledTimes(1);
    expect(mockEmbeddingsCreate).toHaveBeenCalledWith(
      { model: "text-embedding-3-small", input: "hello" },
      { timeout: 600000 },
    );
    expect(out.features).toBeInstanceOf(Int8Array);
    const expected = encodeFeatures([1, -2, 3, 4], 4);
    expect(Array.from(out.features)).toEqual(Array.from(expected));
  });

  test("generateFeatures: supports explicit model label", async () => {
    mockEmbeddingsCreate.mockResolvedValue({ data: [{ embedding: [0.1, 0.2, -0.3] }] });
    const out = await service.generateFeatures({ model: "advanced", input: "x" });
    expect(mockEmbeddingsCreate).toHaveBeenCalledWith(
      { model: "text-embedding-3-large", input: "x" },
      { timeout: 600000 },
    );
    const expected = encodeFeatures([0.1, 0.2, -0.3], 3);
    expect(Array.from(out.features)).toEqual(Array.from(expected));
  });

  test("generateFeatures: throws on unknown model label", async () => {
    await expect(service.generateFeatures({ model: "nope", input: "x" })).rejects.toThrow(
      "no such model",
    );
  });

  test("generateFeatures: throws on unsupported service", async () => {
    pgPool.ai_feature_models.push({ label: "weird", service: "other", name: "x" });
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
    const saved1 = await service.setAiUserInterest({ userId: userHex, payload: "First interest" });
    expect(saved1.userId).toBe(expectedHex);
    expect(saved1.payload).toBe("First interest");
    const fetched1 = await service.getAiUserInterest(userHex);
    expect(fetched1).not.toBeNull();
    expect(fetched1!.userId).toBe(expectedHex);
    expect(fetched1!.payload).toBe("First interest");
    const saved2 = await service.setAiUserInterest({
      userId: userHex,
      payload: "Updated interest",
    });
    expect(saved2.userId).toBe(expectedHex);
    expect(saved2.payload).toBe("Updated interest");
    const fetched2 = await service.getAiUserInterest(userHex);
    expect(fetched2).not.toBeNull();
    expect(fetched2!.payload).toBe("Updated interest");
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
    expect(saved.payload).toBe("Friendly peer");
    const fetched = await service.getAiPeerImpression(userHex, peerHex);
    expect(fetched).not.toBeNull();
    expect(fetched!.userId).toBe(expectedUserHex);
    expect(fetched!.peerId).toBe(expectedPeerHex);
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
    expect(saved.payload).toBe("Interesting post");
    const fetched = await service.getAiPostImpression(userHex, postHex);
    expect(fetched).not.toBeNull();
    expect(fetched!.userId).toBe(expectedUserHex);
    expect(fetched!.peerId).toBe(expectedPeerHex);
    expect(fetched!.postId).toBe(expectedPostHex);
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
