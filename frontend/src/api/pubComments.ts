import { apiFetch, extractError } from "./client";
import type { PubComment } from "./models";
import { makeQueryHashHeaders } from "@/utils/queryHash";

export type PubCommentListResponse = {
  comments: PubComment[];
  page: number;
  hasPrevious: boolean;
  hasNext: boolean;
  limitReached: boolean;
};

export type PubCommentFormState = {
  captchaRequired: boolean;
  name: string;
  canPostAsAuthor: boolean;
  asAuthor: boolean;
  canPost: boolean;
  limitReached: boolean;
};

export async function listPubComments(params: {
  postId: string;
  page?: number;
  order?: "newest" | "oldest";
}): Promise<PubCommentListResponse> {
  const search = new URLSearchParams();
  search.set("postId", params.postId);
  if (params.page && params.page > 1) search.set("page", String(params.page));
  if (params.order === "oldest") search.set("order", "oldest");
  const res = await apiFetch(`/pub-comments?${search.toString()}`, { method: "GET" });
  if (!res.ok) throw new Error(await extractError(res));
  return res.json();
}

export async function getPubCommentFormState(postId: string): Promise<PubCommentFormState> {
  const search = new URLSearchParams({ postId });
  const res = await apiFetch(`/pub-comments/form-state?${search.toString()}`, { method: "GET" });
  if (!res.ok) throw new Error(await extractError(res));
  return res.json();
}

export async function createPubComment(input: {
  postId: string;
  name: string;
  body: string;
  asAuthor: boolean;
  captchaId?: string;
  captchaAnswer?: string;
}): Promise<{ comment: PubComment }> {
  const search = new URLSearchParams();
  const headers = await makeQueryHashHeaders(search);
  const res = await apiFetch("/pub-comments", {
    method: "POST",
    headers,
    body: JSON.stringify(input),
  });
  if (!res.ok) throw new Error(await extractError(res));
  return res.json();
}

export async function approvePubComment(id: string): Promise<PubComment> {
  const res = await apiFetch(`/pub-comments/${id}`, {
    method: "PATCH",
    body: JSON.stringify({ status: "published" }),
  });
  if (!res.ok) throw new Error(await extractError(res));
  return res.json();
}

export async function editAuthorPubComment(
  id: string,
  input: { name: string; body: string },
): Promise<PubComment> {
  const res = await apiFetch(`/pub-comments/${id}`, {
    method: "PATCH",
    body: JSON.stringify(input),
  });
  if (!res.ok) throw new Error(await extractError(res));
  return res.json();
}

export async function deletePubComment(id: string): Promise<void> {
  const res = await apiFetch(`/pub-comments/${id}`, { method: "DELETE" });
  if (!res.ok) throw new Error(await extractError(res));
}
