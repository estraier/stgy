import type { Post, PostDetail, User } from "./models";
import { apiFetch, extractError } from "./client";

function buildPostQuery(
  params: {
    offset?: number;
    limit?: number;
    order?: "asc" | "desc";
    query?: string;
    ownedBy?: string;
    tag?: string;
    replyTo?: string | null;
  } = {},
) {
  const search = new URLSearchParams();
  if (params.offset !== undefined) search.append("offset", String(params.offset));
  if (params.limit !== undefined) search.append("limit", String(params.limit));
  if (params.order) search.append("order", params.order);
  if (params.query) search.append("query", params.query);
  if (params.ownedBy) search.append("ownedBy", params.ownedBy);
  if (params.tag) search.append("tag", params.tag);
  if (params.replyTo === null) {
    search.append("replyTo", "");
  } else if (params.replyTo !== undefined) {
    search.append("replyTo", params.replyTo);
  }
  return search;
}

export async function listPosts(
  params: {
    offset?: number;
    limit?: number;
    order?: "asc" | "desc";
    query?: string;
    ownedBy?: string;
    tag?: string;
    replyTo?: string | null;
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
  replyTo?: string | null;
  ownedBy?: string;
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
    ownedBy?: string;
    replyTo?: string | null;
  },
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

export async function getPostDetail(id: string, focusUserId?: string): Promise<PostDetail> {
  const search = new URLSearchParams();
  if (focusUserId) search.append("focusUserId", focusUserId);
  const res = await apiFetch(
    `/posts/${id}/detail${search.toString() ? `?${search.toString()}` : ""}`,
    { method: "GET" },
  );
  if (!res.ok) throw new Error(await extractError(res));
  //return res.json();

  const j = await res.json();

  console.log("HOGE", j);

  return j;
}

export async function listPostsDetail(
  params: {
    offset?: number;
    limit?: number;
    order?: "asc" | "desc";
    query?: string;
    ownedBy?: string;
    tag?: string;
    replyTo?: string | null;
    focusUserId?: string;
  } = {},
): Promise<PostDetail[]> {
  const search = buildPostQuery(params);
  if (params.focusUserId) search.append("focusUserId", params.focusUserId);
  const res = await apiFetch(`/posts/detail?${search}`, { method: "GET" });
  if (!res.ok) throw new Error(await extractError(res));
  return res.json();
}

export async function listPostsByFolloweesDetail(params: {
  userId: string;
  offset?: number;
  limit?: number;
  order?: "asc" | "desc";
  includeSelf?: boolean;
  includeReplies?: boolean;
  focusUserId?: string;
}): Promise<PostDetail[]> {
  const search = new URLSearchParams();
  if (params.userId) search.append("userId", params.userId);
  if (params.offset !== undefined) search.append("offset", String(params.offset));
  if (params.limit !== undefined) search.append("limit", String(params.limit));
  if (params.order) search.append("order", params.order);
  if (params.includeSelf !== undefined) search.append("includeSelf", String(params.includeSelf));
  if (params.includeReplies !== undefined)
    search.append("includeReplies", String(params.includeReplies));
  if (params.focusUserId) search.append("focusUserId", params.focusUserId);
  const res = await apiFetch(`/posts/by-followees/detail?${search}`, { method: "GET" });
  if (!res.ok) throw new Error(await extractError(res));
  return res.json();
}

export async function listPostsLikedByUserDetail(params: {
  userId: string;
  offset?: number;
  limit?: number;
  order?: "asc" | "desc";
  includeReplies?: boolean;
  focusUserId?: string;
}): Promise<PostDetail[]> {
  const search = new URLSearchParams();
  if (params.userId) search.append("userId", params.userId);
  if (params.offset !== undefined) search.append("offset", String(params.offset));
  if (params.limit !== undefined) search.append("limit", String(params.limit));
  if (params.order) search.append("order", params.order);
  if (params.includeReplies !== undefined)
    search.append("includeReplies", String(params.includeReplies));
  if (params.focusUserId) search.append("focusUserId", params.focusUserId);
  const res = await apiFetch(`/posts/liked/detail?${search}`, { method: "GET" });
  if (!res.ok) throw new Error(await extractError(res));
  return res.json();
}

export async function addLike(postId: string): Promise<{ result: string }> {
  const res = await apiFetch(`/posts/${postId}/like`, { method: "POST" });
  if (!res.ok) throw new Error(await extractError(res));
  return res.json();
}

export async function removeLike(postId: string): Promise<{ result: string }> {
  const res = await apiFetch(`/posts/${postId}/like`, { method: "DELETE" });
  if (!res.ok) throw new Error(await extractError(res));
  return res.json();
}

export async function listLikers(
  postId: string,
  params: { offset?: number; limit?: number; order?: "asc" | "desc" } = {},
): Promise<User[]> {
  const search = new URLSearchParams();
  if (params.offset !== undefined) search.append("offset", String(params.offset));
  if (params.limit !== undefined) search.append("limit", String(params.limit));
  if (params.order) search.append("order", params.order);
  const res = await apiFetch(`/posts/${postId}/likers?${search}`, { method: "GET" });
  if (!res.ok) throw new Error(await extractError(res));
  return res.json();
}

export async function countPosts(
  params: { query?: string; ownedBy?: string; tag?: string; replyTo?: string | null } = {},
): Promise<number> {
  const search = buildPostQuery(params);
  const res = await apiFetch(`/posts/count?${search}`, { method: "GET" });
  if (!res.ok) throw new Error(await extractError(res));
  return (await res.json()).count;
}
