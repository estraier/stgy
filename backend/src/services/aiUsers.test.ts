import { AiUsersService } from "./aiUsers";

jest.mock("../utils/servers", () => {
  const pgQuery = jest.fn((pool: any, sql: string, params?: any[]) => pool.query(sql, params));
  return { pgQuery };
});

const mockCreate = jest.fn();
jest.mock("openai", () => {
  return {
    __esModule: true,
    default: jest.fn().mockImplementation(() => ({
      chat: { completions: { create: mockCreate } },
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
  ai_interests: { user_id: number; description: string }[] = [];
  ai_peer_impressions: {
    user_id: number;
    peer_id: number;
    updated_at: Date;
    description: string;
  }[] = [];
  ai_post_impressions: {
    user_id: number;
    post_id: number;
    updated_at: Date;
    description: string;
  }[] = [];

  async query(sql: string, params?: any[]) {
    sql = normalizeSql(sql);

    if (sql.startsWith("SELECT label, service, name FROM ai_models WHERE label = $1")) {
      const label = params?.[0];
      const rows = this.ai_models
        .filter((m) => m.label === label)
        .map((m) => ({
          label: m.label,
          service: m.service,
          name: m.name,
        }));
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

    if (sql.startsWith("SELECT user_id, description FROM ai_interests WHERE user_id = $1")) {
      const idParam = params?.[0];
      const uid = typeof idParam === "string" ? Number(idParam) : idParam;
      const found = this.ai_interests.find((x) => x.user_id === uid);
      if (!found) return { rows: [], rowCount: 0 };
      const row = {
        user_id: String(found.user_id),
        description: found.description,
      };
      return { rows: [row], rowCount: 1 };
    }

    if (sql.startsWith("INSERT INTO ai_interests (user_id, description)")) {
      const idParam = params?.[0];
      const description = params?.[1] ?? "";
      const uid = typeof idParam === "string" ? Number(idParam) : idParam;
      const existing = this.ai_interests.find((x) => x.user_id === uid);
      if (existing) {
        existing.description = description;
      } else {
        this.ai_interests.push({ user_id: uid, description });
      }
      const row = {
        user_id: String(uid),
        description,
      };
      return { rows: [row], rowCount: 1 };
    }

    if (
      sql.startsWith("SELECT user_id, peer_id, updated_at, description FROM ai_peer_impressions")
    ) {
      if (sql.includes("ORDER BY updated_at")) {
        const userParam = params?.[0];
        const uid = typeof userParam === "string" ? Number(userParam) : userParam;
        const limit = params?.[1] ?? 50;
        const offset = params?.[2] ?? 0;
        const hasPeerFilter = sql.includes("AND peer_id = $4");
        const peerParam = hasPeerFilter ? params?.[3] : undefined;
        const pid =
          peerParam === undefined
            ? undefined
            : typeof peerParam === "string"
              ? Number(peerParam)
              : peerParam;
        const asc = sql.includes("ORDER BY updated_at ASC");
        const filtered = this.ai_peer_impressions.filter(
          (r) => r.user_id === uid && (pid === undefined || r.peer_id === pid),
        );
        const sorted = filtered.sort((a, b) => {
          const cmpTime = a.updated_at.getTime() - b.updated_at.getTime();
          if (cmpTime !== 0) return asc ? cmpTime : -cmpTime;
          const cmpPeer = a.peer_id - b.peer_id;
          return asc ? cmpPeer : -cmpPeer;
        });
        const sliced = sorted.slice(offset, offset + limit).map((r) => ({
          user_id: String(r.user_id),
          peer_id: String(r.peer_id),
          updated_at: r.updated_at,
          description: r.description,
        }));
        return { rows: sliced, rowCount: sliced.length };
      } else {
        const userParam = params?.[0];
        const peerParam = params?.[1];
        const uid = typeof userParam === "string" ? Number(userParam) : userParam;
        const pid = typeof peerParam === "string" ? Number(peerParam) : peerParam;
        const found = this.ai_peer_impressions.find((r) => r.user_id === uid && r.peer_id === pid);
        if (!found) return { rows: [], rowCount: 0 };
        const row = {
          user_id: String(found.user_id),
          peer_id: String(found.peer_id),
          updated_at: found.updated_at,
          description: found.description,
        };
        return { rows: [row], rowCount: 1 };
      }
    }

    if (
      sql.startsWith("INSERT INTO ai_peer_impressions (user_id, peer_id, updated_at, description)")
    ) {
      const userParam = params?.[0];
      const peerParam = params?.[1];
      const description = params?.[2] ?? "";
      const uid = typeof userParam === "string" ? Number(userParam) : userParam;
      const pid = typeof peerParam === "string" ? Number(peerParam) : peerParam;
      const now = new Date("2025-01-01T00:00:00.000Z");
      const existing = this.ai_peer_impressions.find((r) => r.user_id === uid && r.peer_id === pid);
      if (existing) {
        existing.description = description;
        existing.updated_at = now;
      } else {
        this.ai_peer_impressions.push({
          user_id: uid,
          peer_id: pid,
          updated_at: now,
          description,
        });
      }
      const row = {
        user_id: String(uid),
        peer_id: String(pid),
        updated_at: now,
        description,
      };
      return { rows: [row], rowCount: 1 };
    }

    if (
      sql.startsWith("SELECT user_id, post_id, updated_at, description FROM ai_post_impressions")
    ) {
      if (sql.includes("ORDER BY updated_at")) {
        const userParam = params?.[0];
        const uid = typeof userParam === "string" ? Number(userParam) : userParam;
        const limit = params?.[1] ?? 50;
        const offset = params?.[2] ?? 0;
        const hasPostFilter = sql.includes("AND post_id = $4");
        const postParam = hasPostFilter ? params?.[3] : undefined;
        const pid =
          postParam === undefined
            ? undefined
            : typeof postParam === "string"
              ? Number(postParam)
              : postParam;
        const asc = sql.includes("ORDER BY updated_at ASC");
        const filtered = this.ai_post_impressions.filter(
          (r) => r.user_id === uid && (pid === undefined || r.post_id === pid),
        );
        const sorted = filtered.sort((a, b) => {
          const cmpTime = a.updated_at.getTime() - b.updated_at.getTime();
          if (cmpTime !== 0) return asc ? cmpTime : -cmpTime;
          const cmpPost = a.post_id - b.post_id;
          return asc ? cmpPost : -cmpPost;
        });
        const sliced = sorted.slice(offset, offset + limit).map((r) => ({
          user_id: String(r.user_id),
          post_id: String(r.post_id),
          updated_at: r.updated_at,
          description: r.description,
        }));
        return { rows: sliced, rowCount: sliced.length };
      } else {
        const userParam = params?.[0];
        const postParam = params?.[1];
        const uid = typeof userParam === "string" ? Number(userParam) : userParam;
        const pid = typeof postParam === "string" ? Number(postParam) : postParam;
        const found = this.ai_post_impressions.find((r) => r.user_id === uid && r.post_id === pid);
        if (!found) return { rows: [], rowCount: 0 };
        const row = {
          user_id: String(found.user_id),
          post_id: String(found.post_id),
          updated_at: found.updated_at,
          description: found.description,
        };
        return { rows: [row], rowCount: 1 };
      }
    }

    if (
      sql.startsWith("INSERT INTO ai_post_impressions (user_id, post_id, updated_at, description)")
    ) {
      const userParam = params?.[0];
      const postParam = params?.[1];
      const description = params?.[2] ?? "";
      const uid = typeof userParam === "string" ? Number(userParam) : userParam;
      const pid = typeof postParam === "string" ? Number(postParam) : postParam;
      const now = new Date("2025-01-01T00:00:00.000Z");
      const existing = this.ai_post_impressions.find((r) => r.user_id === uid && r.post_id === pid);
      if (existing) {
        existing.description = description;
        existing.updated_at = now;
      } else {
        this.ai_post_impressions.push({
          user_id: uid,
          post_id: pid,
          updated_at: now,
          description,
        });
      }
      const row = {
        user_id: String(uid),
        post_id: String(pid),
        updated_at: now,
        description,
      };
      return { rows: [row], rowCount: 1 };
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
      name: "gpt-5-mini",
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
    mockCreate.mockResolvedValue({
      choices: [{ message: { content: "Hello from model!" } }],
    });

    const res = await service.chat({
      model: "balanced",
      messages: [{ role: "user", content: "hi" }],
    });

    expect(res).toEqual({ message: { content: "Hello from model!" } });
    expect(mockCreate).toHaveBeenCalledTimes(1);
    expect(mockCreate).toHaveBeenCalledWith(
      {
        model: "gpt-5-mini",
        service_tier: "flex",
        messages: [{ role: "user", content: "hi" }],
      },
      {
        timeout: 60000,
      },
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

  test("getAiUserInterest: returns null when not set", async () => {
    const userHex = BigInt(1001).toString(16).toUpperCase();
    const interest = await service.getAiUserInterest(userHex);
    expect(interest).toBeNull();
  });

  test("setAiUserInterest: upsert and get", async () => {
    const userHex = BigInt(1001).toString(16).toUpperCase();
    const expectedHex = BigInt(1001).toString(16).toUpperCase().padStart(16, "0");

    const saved1 = await service.setAiUserInterest({
      userId: userHex,
      description: "First interest",
    });
    expect(saved1.userId).toBe(expectedHex);
    expect(saved1.description).toBe("First interest");

    const fetched1 = await service.getAiUserInterest(userHex);
    expect(fetched1).not.toBeNull();
    expect(fetched1!.userId).toBe(expectedHex);
    expect(fetched1!.description).toBe("First interest");

    const saved2 = await service.setAiUserInterest({
      userId: userHex,
      description: "Updated interest",
    });
    expect(saved2.userId).toBe(expectedHex);
    expect(saved2.description).toBe("Updated interest");

    const fetched2 = await service.getAiUserInterest(userHex);
    expect(fetched2).not.toBeNull();
    expect(fetched2!.description).toBe("Updated interest");
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
      description: "Friendly peer",
    });
    expect(saved.userId).toBe(expectedUserHex);
    expect(saved.peerId).toBe(expectedPeerHex);
    expect(saved.description).toBe("Friendly peer");
    expect(typeof saved.updatedAt).toBe("string");

    const fetched = await service.getAiPeerImpression(userHex, peerHex);
    expect(fetched).not.toBeNull();
    expect(fetched!.userId).toBe(expectedUserHex);
    expect(fetched!.peerId).toBe(expectedPeerHex);
    expect(fetched!.description).toBe("Friendly peer");
    expect(typeof fetched!.updatedAt).toBe("string");
  });

  test("listAiPeerImpressions: list and filter by peerId", async () => {
    const userHex = BigInt(1001).toString(16).toUpperCase();
    const peer1Hex = BigInt(1002).toString(16).toUpperCase();
    const peer2Hex = BigInt(1000).toString(16).toUpperCase();
    const expectedPeer1Hex = BigInt(1002).toString(16).toUpperCase().padStart(16, "0");
    const expectedPeer2Hex = BigInt(1000).toString(16).toUpperCase().padStart(16, "0");

    await service.setAiPeerImpression({
      userId: userHex,
      peerId: peer1Hex,
      description: "Peer one",
    });
    await service.setAiPeerImpression({
      userId: userHex,
      peerId: peer2Hex,
      description: "Peer two",
    });

    const all = await service.listAiPeerImpressions(userHex, { limit: 10, offset: 0 });
    expect(all).toHaveLength(2);
    const peerIds = all.map((p) => p.peerId).sort();
    expect(peerIds).toEqual([expectedPeer2Hex, expectedPeer1Hex].sort());

    const filtered = await service.listAiPeerImpressions(userHex, {
      peerId: peer1Hex,
      limit: 10,
      offset: 0,
    });
    expect(filtered).toHaveLength(1);
    expect(filtered[0].peerId).toBe(expectedPeer1Hex);
    expect(filtered[0].description).toBe("Peer one");
  });

  test("getAiPostImpression: returns null when not set", async () => {
    const userHex = BigInt(1001).toString(16).toUpperCase();
    const postHex = BigInt(5001).toString(16).toUpperCase();
    const impression = await service.getAiPostImpression(userHex, postHex);
    expect(impression).toBeNull();
  });

  test("setAiPostImpression and getAiPostImpression", async () => {
    const userHex = BigInt(1001).toString(16).toUpperCase();
    const postHex = BigInt(5001).toString(16).toUpperCase();
    const expectedUserHex = BigInt(1001).toString(16).toUpperCase().padStart(16, "0");
    const expectedPostHex = BigInt(5001).toString(16).toUpperCase().padStart(16, "0");

    const saved = await service.setAiPostImpression({
      userId: userHex,
      postId: postHex,
      description: "Interesting post",
    });
    expect(saved.userId).toBe(expectedUserHex);
    expect(saved.postId).toBe(expectedPostHex);
    expect(saved.description).toBe("Interesting post");
    expect(typeof saved.updatedAt).toBe("string");

    const fetched = await service.getAiPostImpression(userHex, postHex);
    expect(fetched).not.toBeNull();
    expect(fetched!.userId).toBe(expectedUserHex);
    expect(fetched!.postId).toBe(expectedPostHex);
    expect(fetched!.description).toBe("Interesting post");
    expect(typeof fetched!.updatedAt).toBe("string");
  });

  test("listAiPostImpressions: list and filter by postId", async () => {
    const userHex = BigInt(1001).toString(16).toUpperCase();
    const post1Hex = BigInt(5001).toString(16).toUpperCase();
    const post2Hex = BigInt(5002).toString(16).toUpperCase();
    const expectedPost1Hex = BigInt(5001).toString(16).toUpperCase().padStart(16, "0");
    const expectedPost2Hex = BigInt(5002).toString(16).toUpperCase().padStart(16, "0");

    await service.setAiPostImpression({
      userId: userHex,
      postId: post1Hex,
      description: "Post one",
    });
    await service.setAiPostImpression({
      userId: userHex,
      postId: post2Hex,
      description: "Post two",
    });

    const all = await service.listAiPostImpressions(userHex, { limit: 10, offset: 0 });
    expect(all).toHaveLength(2);
    const postIds = all.map((p) => p.postId).sort();
    expect(postIds).toEqual([expectedPost1Hex, expectedPost2Hex].sort());

    const filtered = await service.listAiPostImpressions(userHex, {
      postId: post1Hex,
      limit: 10,
      offset: 0,
    });
    expect(filtered).toHaveLength(1);
    expect(filtered[0].postId).toBe(expectedPost1Hex);
    expect(filtered[0].description).toBe("Post one");
  });
});
