import { apiFetch, extractError } from "./client";
import type { ExplainPlan, QueryStats } from "./models";

export type ListSlowQueriesInput = {
  offset?: number;
  limit?: number;
  order?: "asc" | "desc";
};

function clampInt(n: unknown, min: number, max: number): number | undefined {
  if (typeof n !== "number" || !Number.isFinite(n)) return undefined;
  const x = Math.trunc(n);
  if (x < min) return min;
  if (x > max) return max;
  return x;
}

function buildSlowQueriesQuery(input: ListSlowQueriesInput): string {
  const sp = new URLSearchParams();

  const offset = clampInt(input.offset, 0, 1_000_000_000);
  const limit = clampInt(input.limit, 1, 10_000);

  if (offset !== undefined) sp.set("offset", String(offset));
  if (limit !== undefined) sp.set("limit", String(limit));
  if (input.order === "asc" || input.order === "desc") sp.set("order", input.order);

  const q = sp.toString();
  return q ? `?${q}` : "";
}

export async function checkDbStatsEnabled(): Promise<boolean> {
  const res = await apiFetch("/db-stats", { method: "HEAD" });
  if (!res.ok && res.status !== 204) throw new Error(await extractError(res));
  const v = res.headers.get("x-db-stats-enabled");
  return v === "1";
}

export async function enableDbStats(): Promise<{ result: string; enabled: boolean }> {
  const res = await apiFetch("/db-stats/enable", { method: "POST" });
  if (!res.ok) throw new Error(await extractError(res));
  return res.json();
}

export async function disableDbStats(): Promise<{ result: string; enabled: boolean }> {
  const res = await apiFetch("/db-stats/disable", { method: "POST" });
  if (!res.ok) throw new Error(await extractError(res));
  return res.json();
}

export async function clearDbStats(): Promise<boolean> {
  const res = await apiFetch("/db-stats/clear", { method: "POST" });
  if (!res.ok) throw new Error(await extractError(res));
  return res.ok;
}

export async function listSlowQueries(input: ListSlowQueriesInput = {}): Promise<QueryStats[]> {
  const res = await apiFetch(`/db-stats/slow-queries${buildSlowQueriesQuery(input)}`, {
    method: "GET",
  });
  if (!res.ok) throw new Error(await extractError(res));
  return res.json();
}

export async function explainSlowQuery(id: string): Promise<ExplainPlan> {
  const res = await apiFetch(`/db-stats/slow-queries/${encodeURIComponent(id)}/explain`, {
    method: "GET",
  });
  if (!res.ok) throw new Error(await extractError(res));
  return res.json();
}
