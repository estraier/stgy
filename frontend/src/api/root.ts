import { apiFetch, extractError } from "./client";

export type MetricsAggregation = Record<string, string>;

export async function checkHealth(): Promise<boolean> {
  const res = await apiFetch("/health", { method: "GET" });
  return res.ok;
}

export async function getMetricsAggregation(): Promise<MetricsAggregation> {
  const res = await apiFetch("/metrics/aggregation", { method: "GET" });
  if (!res.ok) throw new Error(await extractError(res));
  return res.json();
}

export async function clearMetricsAggregation(): Promise<boolean> {
  const res = await apiFetch("/metrics/aggregation/clear", { method: "POST" });
  if (!res.ok) throw new Error(await extractError(res));
  return res.ok;
}
