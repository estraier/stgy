import type Redis from "ioredis";
import type { Pool } from "pg";
import { pgQuery } from "../utils/servers";
import { decToHex } from "../utils/format";
import type { ListSlowQueriesInput, QueryStats } from "../models/dbStats";

export class DbStatsService {
  private pgPool: Pool;
  private redis: Redis;

  constructor(pgPool: Pool, redis: Redis) {
    this.pgPool = pgPool;
    this.redis = redis;
  }

  async checkEnabled(): Promise<boolean> {
    const hasExt = await this.hasPgStatStatementsExtension();
    if (!hasExt) return false;

    const track = await this.getSetting("pg_stat_statements.track");
    return track !== null && track !== "none";
  }

  async enable(): Promise<void> {
    await this.setTrack("top");
  }

  async disable(): Promise<void> {
    await this.setTrack("none");
  }

  async clear(): Promise<void> {
    const hasExt = await this.hasPgStatStatementsExtension();
    if (!hasExt) return;
    await pgQuery(this.pgPool, "SELECT pg_stat_statements_reset()", []);
  }

  async listSlowQueries(input?: ListSlowQueriesInput): Promise<QueryStats[]> {
    const hasExt = await this.hasPgStatStatementsExtension();
    if (!hasExt) return [];

    const offset = clampInt(input?.offset ?? 0, 0, 10_000_000);
    const limit = clampInt(input?.limit ?? 50, 1, 10_000);
    const dir = normalizeOrder(input?.order ?? "desc");

    const res = await pgQuery<{
      id: string;
      query: string;
      calls: string | number;
      total_exec_time: string | number;
    }>(
      this.pgPool,
      `
        SELECT queryid::text AS id, query, calls, total_exec_time
        FROM pg_stat_statements
        ORDER BY total_exec_time ${dir}
        OFFSET $1
        LIMIT $2
      `,
      [offset, limit],
    );

    return res.rows.map((row) => ({
      id: toUint64HexId(row.id),
      query: row.query,
      calls: toNum(row.calls),
      totalExecTime: toNum(row.total_exec_time),
    }));
  }

  async explainSlowQuery(id: string): Promise<string[]> {
    const hasExt = await this.hasPgStatStatementsExtension();
    if (!hasExt) return [];

    const qidHex = normalizeQueryId(id);
    const signedQueryId = toSignedBigintDecId(qidHex);

    const qres = await pgQuery<{ query: string }>(
      this.pgPool,
      `
        SELECT query
        FROM pg_stat_statements
        WHERE queryid = $1::bigint
        LIMIT 1
      `,
      [signedQueryId],
    );

    const rawQuery = qres.rows[0]?.query;
    if (typeof rawQuery !== "string" || rawQuery.trim().length === 0) return [];

    const explainQuery = normalizeQueryForExplain(rawQuery);
    if (!isExplainableQuery(explainQuery)) {
      throw new Error("transaction statements are not allowed for EXPLAIN");
    }

    const stmtName = makePrepareName();
    const client = await this.pgPool.connect();
    try {
      await client.query("BEGIN");
      try {
        await client.query("SET LOCAL statement_timeout = '3000ms'");
        await client.query("SET LOCAL plan_cache_mode = force_generic_plan");
        await client.query(`PREPARE ${stmtName} AS ${explainQuery}`);
        const nres = await client.query<{ n: number | string }>(
          `
            SELECT COUNT(*)::int AS n
            FROM pg_prepared_statements ps,
                 unnest(ps.parameter_types) p
            WHERE ps.name = $1
          `,
          [stmtName],
        );

        const n0 = nres.rows[0]?.n;
        const n = typeof n0 === "number" ? n0 : Number.parseInt(String(n0 ?? "0"), 10);
        const argc = Number.isFinite(n) && n > 0 ? n : 0;

        const args = argc > 0 ? `(${new Array(argc).fill("NULL").join(", ")})` : "";
        const res = await client.query<Record<string, unknown>>(
          `EXPLAIN (FORMAT TEXT) EXECUTE ${stmtName}${args}`,
        );

        return res.rows.map((row) => extractExplainLine(row)).filter((s) => s.trim().length > 0);
      } finally {
        try {
          await client.query(`DEALLOCATE ${stmtName}`);
        } catch {}
        await client.query("ROLLBACK");
      }
    } finally {
      client.release();
    }
  }

  private async setTrack(track: "top" | "none"): Promise<void> {
    await pgQuery(this.pgPool, `ALTER SYSTEM SET pg_stat_statements.track = '${track}'`, []);
    await pgQuery(this.pgPool, "ALTER SYSTEM SET pg_stat_statements.track_utility = off", []);
    await pgQuery(this.pgPool, "ALTER SYSTEM SET pg_stat_statements.save = off", []);
    await pgQuery(this.pgPool, "SELECT pg_reload_conf()", []);
  }

  private async hasPgStatStatementsExtension(): Promise<boolean> {
    const res = await pgQuery<{ ok: boolean }>(
      this.pgPool,
      "SELECT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_stat_statements') AS ok",
      [],
    );
    return !!res.rows[0]?.ok;
  }

  private async getSetting(name: string): Promise<string | null> {
    const res = await pgQuery<{ setting: string }>(
      this.pgPool,
      "SELECT setting FROM pg_settings WHERE name = $1",
      [name],
    );
    if (res.rowCount === 0) return null;
    return res.rows[0].setting;
  }
}

function clampInt(n: number, min: number, max: number): number {
  if (!Number.isFinite(n)) return min;
  const x = Math.floor(n);
  if (x < min) return min;
  if (x > max) return max;
  return x;
}

function normalizeOrder(order: "asc" | "desc"): "ASC" | "DESC" {
  return order === "asc" ? "ASC" : "DESC";
}

function toNum(v: string | number): number {
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function normalizeQueryId(id: string): string {
  const s = (id ?? "").trim();
  const m = /^(?:0x)?([0-9a-fA-F]{1,16})$/.exec(s);
  if (!m) throw new Error("bad query id");
  return m[1].toUpperCase().padStart(16, "0");
}

function toUint64HexId(signedDec: string): string {
  return decToHex(signedDec);
}

function toSignedBigintDecId(hexId: string): string {
  const u = BigInt("0x" + hexId);
  const two63 = 1n << 63n;
  const two64 = 1n << 64n;
  const s = u >= two63 ? u - two64 : u;
  return s.toString();
}

function normalizeQueryForExplain(query: string): string {
  let q = query.trim();
  if (q.endsWith(";")) q = q.slice(0, -1).trim();
  return q;
}

function isExplainableQuery(query: string): boolean {
  const q = query.trim();
  if (q.length === 0) return false;
  if (q.includes(";")) return false;
  const forbidden =
    /^(?:begin|start\s+transaction|commit|end|rollback|abort|savepoint|release\s+savepoint|set\s+transaction|prepare\s+transaction|commit\s+prepared|rollback\s+prepared)\b/i;
  if (forbidden.test(q)) return false;
  return true;
}

function extractExplainLine(row: Record<string, unknown>): string {
  const v = row["QUERY PLAN"] ?? row["query plan"];
  if (typeof v === "string") return v;
  const first = Object.values(row)[0];
  if (typeof first === "string") return first;
  if (first === null || first === undefined) return "";
  return String(first);
}

function makePrepareName(): string {
  const a = Date.now().toString(16);
  const b = Math.floor(Math.random() * 0xffffffff).toString(16);
  return `stgy_explain_${a}_${b}`;
}
