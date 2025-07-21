import type { Post, PostDetail, User } from "./models";
import { apiFetch, extractError } from "./client";

function buildPostQuery(params: {
  offset?: number;
  limit?: number;
  order?: "asc" | "desc";
  query?: string;
  owned_by?: string;
  tag?: string;
  reply_to?: string | null;
} = {}) {
  const search = new URLSearchParams();
  if (params.offset !== undefined) search.append("offset", String(params.offset));
  if (params.limit !== undefined) search.append("limit", String(params.limit));
  if (params.order) search.append("order", params.order);
  if (params.query) search.append("query", params.query);
  if (params.owned_by) search.append("owned_by", params.owned_by);
  if (params.tag) search.append("tag", params.tag);
  if (params.reply_to === null) {
    search.append("reply_to", "");
  } else if (params.reply_to !== undefined) {
    search.append("reply_to", params.reply_to);
  }
  return search;
}

export async function listPosts(
  params: {
    offset?: number;
    limit?: number;
    order?: "asc" | "desc";
    query?: string;
    owned_by?: string;
    tag?: string;
    reply_to?: string | null;
  } = {},
): Promise<Post[]> {
  const search = buildPostQuery(params);
  const res = await apiFetch(`/posts?${search}`, { method: "GET" });
  if (!res.ok) throw new Error(await extractError(res));
  return res.json();
}

export async function getPost(id: string): Promise<Post> {
  const res = await apiFetch(`/posts/${id}`, { method: "GET" });
  if (!res.ok) throw new Error(await extractError(res));
  return res.json();
}

export async function createPost(post: {
  content: string;
  tags: string[];
  reply_to?: string | null;
  owned_by?: string; // admin only
}): Promise<Post> {
  const res = await apiFetch("/posts", {
    method: "POST",
    body: JSON.stringify(post),
  });
  if (!res.ok) throw new Error(await extractError(res));
  return res.json();
}

export async function updatePost(
  id: string,
  post: {
    content: string;
    tags?: string[];
    reply_to?: string | null;
  }
): Promise<Post> {
  const res = await apiFetch(`/posts/${id}`, {
    method: "PUT",
    body: JSON.stringify(post),
  });
  if (!res.ok) throw new Error(await extractError(res));
  return res.json();
}

export async function deletePost(id: string): Promise<{ result: string }> {
  const res = await apiFetch(`/posts/${id}`, { method: "DELETE" });
  if (!res.ok) throw new Error(await extractError(res));
  return res.json();
}

export async function getPostDetail(id: string, focus_user_id?: string): Promise<PostDetail> {
  const search = new URLSearchParams();
  if (focus_user_id) search.append("focus_user_id", focus_user_id);
  const res = await apiFetch(
    `/posts/${id}/detail${search.toString() ? `?${search.toString()}` : ""}`,
    { method: "GET" },
  );
  if (!res.ok) throw new Error(await extractError(res));
  return res.json();
}

export async function listPostsDetail(
  params: {
    offset?: number;
    limit?: number;
    order?: "asc" | "desc";
    query?: string;
    owned_by?: string;
    tag?: string;
    reply_to?: string | null;
    focus_user_id?: string;
  } = {},
): Promise<PostDetail[]> {
  const search = buildPostQuery(params);
  if (params.focus_user_id) search.append("focus_user_id", params.focus_user_id);
  const res = await apiFetch(`/posts/detail?${search}`, { method: "GET" });
  if (!res.ok) throw new Error(await extractError(res));
  return res.json();
}

export async function listPostsByFolloweesDetail(
  params: {
    user_id: string;
    offset?: number;
    limit?: number;
    order?: "asc" | "desc";
    include_self?: boolean;
  },
): Promise<PostDetail[]> {
  const search = new URLSearchParams();
  if (params.user_id) search.append("user_id", params.user_id);
  if (params.offset !== undefined) search.append("offset", String(params.offset));
  if (params.limit !== undefined) search.append("limit", String(params.limit));
  if (params.order) search.append("order", params.order);
  if (params.include_self !== undefined) search.append("include_self", String(params.include_self));

  const res = await apiFetch(`/posts/by-followees/detail?${search}`, { method: "GET" });
  if (!res.ok) throw new Error(await extractError(res));
  return res.json();
}

export async function listPostsLikedByUserDetail(
  params: { user_id: string; offset?: number; limit?: number; order?: "asc" | "desc" },
): Promise<PostDetail[]> {
  const search = new URLSearchParams();
  if (params.user_id) search.append("user_id", params.user_id);
  if (params.offset !== undefined) search.append("offset", String(params.offset));
  if (params.limit !== undefined) search.append("limit", String(params.limit));
  if (params.order) search.append("order", params.order);

  const res = await apiFetch(`/posts/liked/detail?${search}`, { method: "GET" });
  if (!res.ok) throw new Error(await extractError(res));
  return res.json();
}

export async function addLike(post_id: string): Promise<{ result: string }> {
  const res = await apiFetch(`/posts/${post_id}/like`, { method: "POST" });
  if (!res.ok) throw new Error(await extractError(res));
  return res.json();
}

export async function removeLike(post_id: string): Promise<{ result: string }> {
  const res = await apiFetch(`/posts/${post_id}/like`, { method: "DELETE" });
  if (!res.ok) throw new Error(await extractError(res));
  return res.json();
}

export async function listLikers(
  post_id: string,
  params: { offset?: number; limit?: number; order?: "asc" | "desc" } = {},
): Promise<User[]> {
  const search = new URLSearchParams();
  if (params.offset !== undefined) search.append("offset", String(params.offset));
  if (params.limit !== undefined) search.append("limit", String(params.limit));
  if (params.order) search.append("order", params.order);

  const res = await apiFetch(`/posts/${post_id}/likers?${search}`, { method: "GET" });
  if (!res.ok) throw new Error(await extractError(res));
  return res.json();
}

export async function countPosts(
  params: { query?: string; owned_by?: string; tag?: string; reply_to?: string | null } = {},
): Promise<number> {
  const search = buildPostQuery(params);
  const res = await apiFetch(`/posts/count?${search}`, { method: "GET" });
  if (!res.ok) throw new Error(await extractError(res));
  return (await res.json()).count;
}
