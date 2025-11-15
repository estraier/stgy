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
    expect(mockCreate).toHaveBeenCalledWith({
      model: "gpt-5-mini",
      messages: [{ role: "user", content: "hi" }],
    });
  });

  test("chat: returns empty string if provider returns no choices", async () => {
    mockCreate.mockResolvedValue({ choices: [] });

    const res = await service.chat({
      model: "balanced",
      messages: [{ role: "user", content: "anything" }],
    });

    expect(res.message.content).toBe("");
  });
});
