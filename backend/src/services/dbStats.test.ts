import { DbStatsService } from "./dbStats";
import { decToHex } from "../utils/format";

jest.mock("../utils/servers", () => ({
  pgQuery: jest.fn(async (pool: any, text: string, params?: any[]) => pool.query(text, params)),
}));

type MockStatementRow = {
  id: string;
  query: string;
  calls: number;
  total_exec_time: number;
};

class MockPgClient {
  private pool: MockPgPool;
  released: boolean;

  constructor(pool: MockPgPool) {
    this.pool = pool;
    this.released = false;
  }

  async query(sql: string, params?: any[]) {
    return this.pool.clientQuery(sql, params);
  }

  release() {
    this.released = true;
  }
}

function normalizeDecToU64Hex(dec: string): string | null {
  const s = String(dec ?? "").trim();
  if (!/^-?\d+$/.test(s)) return null;
  try {
    let n = BigInt(s);
    const two64 = 1n << 64n;
    n = ((n % two64) + two64) % two64;
    return n.toString(16).toUpperCase().padStart(16, "0").slice(-16);
  } catch {
    return null;
  }
}

class MockPgPool {
  extEnabled: boolean;
  settings: Record<string, string>;
  statements: MockStatementRow[];
  resetCalls: number;
  connectCalls: number;

  constructor(opts?: {
    extEnabled?: boolean;
    settings?: Record<string, string>;
    statements?: MockStatementRow[];
  }) {
    this.extEnabled = opts?.extEnabled ?? true;
    this.settings = {
      "pg_stat_statements.track": "none",
      ...(opts?.settings ?? {}),
    };
    this.statements = opts?.statements ?? [];
    this.resetCalls = 0;
    this.connectCalls = 0;
  }

  async connect() {
    this.connectCalls += 1;
    return new MockPgClient(this);
  }

  async clientQuery(sql: string, params?: any[]) {
    const s = sql.trim();

    if (/^BEGIN\b/i.test(s)) return { rows: [], rowCount: 0 };
    if (/^ROLLBACK\b/i.test(s)) return { rows: [], rowCount: 0 };
    if (/^SET\s+LOCAL\b/i.test(s)) return { rows: [], rowCount: 0 };

    if (/^EXPLAIN\s*\(FORMAT\s+TEXT\)\s+/i.test(s)) {
      return {
        rows: [
          { "QUERY PLAN": "Seq Scan on dummy  (cost=0.00..1.00 rows=1 width=4)" },
          { "QUERY PLAN": "  Filter: (id IS NOT NULL)" },
        ],
        rowCount: 2,
      };
    }

    return this.query(sql, params);
  }

  async query(sql: string, params?: any[]) {
    if (sql.includes("FROM pg_extension") && sql.includes("pg_stat_statements")) {
      return { rows: [{ ok: this.extEnabled }], rowCount: 1 };
    }

    if (sql.includes("FROM pg_settings") && sql.includes("WHERE name = $1")) {
      const name = params?.[0];
      const v = typeof name === "string" ? this.settings[name] : undefined;
      if (typeof v !== "string") return { rows: [], rowCount: 0 };
      return { rows: [{ setting: v }], rowCount: 1 };
    }

    if (sql.includes("ALTER SYSTEM SET pg_stat_statements.track")) {
      const m = /ALTER SYSTEM SET pg_stat_statements\.track\s*=\s*'([^']+)'/i.exec(sql);
      if (m) this.settings["pg_stat_statements.track"] = m[1];
      return { rows: [], rowCount: 0 };
    }

    if (sql.includes("ALTER SYSTEM SET pg_stat_statements.track_utility")) {
      this.settings["pg_stat_statements.track_utility"] = sql.includes("= off") ? "off" : "on";
      return { rows: [], rowCount: 0 };
    }

    if (sql.includes("ALTER SYSTEM SET pg_stat_statements.save")) {
      this.settings["pg_stat_statements.save"] = sql.includes("= off") ? "off" : "on";
      return { rows: [], rowCount: 0 };
    }

    if (sql.includes("SELECT pg_reload_conf()")) {
      return { rows: [{ ok: true }], rowCount: 1 };
    }

    if (sql.includes("pg_stat_statements_reset")) {
      this.resetCalls += 1;
      this.statements = [];
      return { rows: [{ ok: true }], rowCount: 1 };
    }

    if (sql.includes("FROM pg_stat_statements") && sql.includes("WHERE queryid = $1::bigint")) {
      const qid = params?.[0];
      const id = typeof qid === "string" ? qid : String(qid);
      const needleHex = normalizeDecToU64Hex(id);
      if (!needleHex) return { rows: [], rowCount: 0 };
      const hit = this.statements.find((x) => normalizeDecToU64Hex(x.id) === needleHex);
      if (!hit) return { rows: [], rowCount: 0 };
      return { rows: [{ query: hit.query }], rowCount: 1 };
    }

    if (
      sql.includes("FROM pg_stat_statements") &&
      sql.includes("ORDER BY total_exec_time") &&
      sql.includes("OFFSET") &&
      sql.includes("LIMIT")
    ) {
      const offset = Number(params?.[0] ?? 0);
      const limit = Number(params?.[1] ?? 50);
      const dir = sql.toUpperCase().includes("ORDER BY TOTAL_EXEC_TIME ASC") ? "ASC" : "DESC";

      const xs = [...this.statements].sort((a, b) => {
        if (a.total_exec_time === b.total_exec_time) return 0;
        return dir === "ASC"
          ? a.total_exec_time - b.total_exec_time
          : b.total_exec_time - a.total_exec_time;
      });

      const sliced = xs.slice(offset, offset + limit);
      return {
        rows: sliced.map((r) => ({
          id: r.id,
          query: r.query,
          calls: r.calls,
          total_exec_time: r.total_exec_time,
        })),
        rowCount: sliced.length,
      };
    }

    return { rows: [], rowCount: 0 };
  }
}

class MockRedis {}

describe("DbStatsService", () => {
  const sampleStatements: MockStatementRow[] = [
    { id: "101", query: "SELECT * FROM posts WHERE id = $1", calls: 10, total_exec_time: 12.5 },
    { id: "-1", query: "SELECT * FROM users WHERE id = $1", calls: 100, total_exec_time: 3.2 },
    {
      id: "103",
      query: "UPDATE posts SET updated_at = now() WHERE id = $1",
      calls: 5,
      total_exec_time: 20.0,
    },
  ];

  let pgPool: MockPgPool;
  let service: DbStatsService;

  beforeEach(() => {
    pgPool = new MockPgPool({
      extEnabled: true,
      settings: { "pg_stat_statements.track": "none" },
      statements: [...sampleStatements],
    });
    service = new DbStatsService(pgPool as any, new MockRedis() as any);
  });

  it("checkEnabled should be false when extension is missing", async () => {
    pgPool = new MockPgPool({ extEnabled: false });
    service = new DbStatsService(pgPool as any, new MockRedis() as any);

    const ok = await service.checkEnabled();
    expect(ok).toBe(false);
  });

  it("checkEnabled should be false when track is none", async () => {
    const ok = await service.checkEnabled();
    expect(ok).toBe(false);
  });

  it("enable should set track to top and then checkEnabled becomes true", async () => {
    await service.enable();
    const ok = await service.checkEnabled();
    expect(ok).toBe(true);
    expect(pgPool.settings["pg_stat_statements.track"]).toBe("top");
  });

  it("disable should set track to none", async () => {
    await service.enable();
    await service.disable();
    const ok = await service.checkEnabled();
    expect(ok).toBe(false);
    expect(pgPool.settings["pg_stat_statements.track"]).toBe("none");
  });

  it("clear should do nothing when extension is missing", async () => {
    pgPool = new MockPgPool({ extEnabled: false, statements: [...sampleStatements] });
    service = new DbStatsService(pgPool as any, new MockRedis() as any);

    await service.clear();
    expect(pgPool.resetCalls).toBe(0);
    expect(pgPool.statements).toHaveLength(3);
  });

  it("clear should reset collected statements when extension exists", async () => {
    const before = await service.listSlowQueries();
    expect(before).toHaveLength(3);

    await service.clear();
    expect(pgPool.resetCalls).toBe(1);

    const after = await service.listSlowQueries();
    expect(after).toEqual([]);
  });

  it("listSlowQueries should return empty when extension is missing", async () => {
    pgPool = new MockPgPool({ extEnabled: false, statements: [...sampleStatements] });
    service = new DbStatsService(pgPool as any, new MockRedis() as any);

    const xs = await service.listSlowQueries();
    expect(xs).toEqual([]);
  });

  it("listSlowQueries should include id (hex) and sort by totalExecTime desc by default", async () => {
    const xs = await service.listSlowQueries();
    expect(xs).toHaveLength(3);

    expect(xs[0].id).toBe(decToHex("103"));
    expect(xs[0].query).toContain("UPDATE posts");
    expect(xs[0].totalExecTime).toBeCloseTo(20.0);

    expect(xs[1].id).toBe(decToHex("101"));
    expect(xs[1].query).toContain("SELECT * FROM posts");

    expect(xs[2].id).toBe(decToHex("-1"));
    expect(xs[2].query).toContain("SELECT * FROM users");
  });

  it("listSlowQueries should support asc order, offset, limit", async () => {
    const xs = await service.listSlowQueries({ order: "asc", offset: 1, limit: 1 });
    expect(xs).toHaveLength(1);
    expect(xs[0].id).toBe(decToHex("101"));
    expect(xs[0].query).toContain("SELECT * FROM posts");
    expect(xs[0].calls).toBe(10);
    expect(xs[0].totalExecTime).toBeCloseTo(12.5);
  });

  it("listSlowQueries should clamp limit to [1, 10000]", async () => {
    const xs0 = await service.listSlowQueries({ limit: 0 });
    expect(xs0).toHaveLength(1);
    expect(xs0[0].query).toContain("UPDATE posts");

    const xsNeg = await service.listSlowQueries({ limit: -1 });
    expect(xsNeg).toHaveLength(1);
    expect(xsNeg[0].query).toContain("UPDATE posts");

    const xsBig = await service.listSlowQueries({ limit: 100000 });
    expect(xsBig).toHaveLength(3);
  });

  it("listSlowQueries should clamp offset >= 0", async () => {
    const xs = await service.listSlowQueries({ offset: -100, limit: 1 });
    expect(xs).toHaveLength(1);
    expect(xs[0].query).toContain("UPDATE posts");
  });

  it("explainSlowQuery should return empty when extension is missing", async () => {
    pgPool = new MockPgPool({ extEnabled: false, statements: [...sampleStatements] });
    service = new DbStatsService(pgPool as any, new MockRedis() as any);

    const lines = await service.explainSlowQuery(decToHex("101"));
    expect(lines).toEqual([]);
  });

  it("explainSlowQuery should return explain lines for existing id (hex)", async () => {
    const lines = await service.explainSlowQuery(decToHex("101"));
    expect(pgPool.connectCalls).toBe(1);
    expect(lines.length).toBeGreaterThan(0);
    expect(lines[0]).toContain("Seq Scan");
  });

  it("explainSlowQuery should work for sign-bit-set queryid (hex)", async () => {
    const lines = await service.explainSlowQuery(decToHex("-1"));
    expect(lines.length).toBeGreaterThan(0);
    expect(lines[0]).toContain("Seq Scan");
  });

  it("explainSlowQuery should return empty when id not found", async () => {
    const lines = await service.explainSlowQuery("0000000000009999");
    expect(lines).toEqual([]);
  });

  it("explainSlowQuery should reject non-hex id", async () => {
    await expect(service.explainSlowQuery("xyz")).rejects.toThrow("bad query id");
  });
});
