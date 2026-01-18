import type Redis from "ioredis";
import { Pool } from "pg";
import { pgQuery } from "../utils/servers";
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
      query: string;
      calls: string | number;
      total_exec_time: string | number;
    }>(
      this.pgPool,
      `
        SELECT query, calls, total_exec_time
        FROM pg_stat_statements
        ORDER BY total_exec_time ${dir}
        OFFSET $1
        LIMIT $2
      `,
      [offset, limit],
    );

    return res.rows.map((row) => ({
      query: row.query,
      calls: toNum(row.calls),
      totalExecTime: toNum(row.total_exec_time),
    }));
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
