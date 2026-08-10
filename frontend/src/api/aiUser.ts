import type { AiPeerImpression, AiPostImpression } from "./models";
import { apiFetch, extractError } from "./client";

function buildPageQuery(params: {
  offset?: number;
  limit?: number;
  order?: "asc" | "desc";
}): string {
  const search = new URLSearchParams();
  if (params.offset !== undefined) search.append("offset", String(params.offset));
  if (params.limit !== undefined) search.append("limit", String(params.limit));
  if (params.order) search.append("order", params.order);
  return search.toString();
}

export async function listAiPeerImpressions(
  userId: string,
  params: { offset?: number; limit?: number; order?: "asc" | "desc" } = {},
): Promise<AiPeerImpression[]> {
  const q = buildPageQuery(params);
  const res = await apiFetch(`/ai-users/${userId}/peer-impressions${q ? `?${q}` : ""}`, {
    method: "GET",
  });
  if (!res.ok) throw new Error(await extractError(res));
  return res.json();
}

export async function listAiPostImpressions(
  userId: string,
  params: { offset?: number; limit?: number; order?: "asc" | "desc" } = {},
): Promise<AiPostImpression[]> {
  const q = buildPageQuery(params);
  const res = await apiFetch(`/ai-users/${userId}/post-impressions${q ? `?${q}` : ""}`, {
    method: "GET",
  });
  if (!res.ok) throw new Error(await extractError(res));
  return res.json();
}
