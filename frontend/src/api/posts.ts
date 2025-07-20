import type { Post, PostDetail, User } from "./models";
import { apiFetch } from "./client";

export async function listPosts(
  params: {
    offset?: number;
    limit?: number;
    order?: "asc" | "desc";
    query?: string;
    owned_by?: string;
    tag?: string;
  } = {},
): Promise<Post[]> {
  const search = new URLSearchParams();
  if (params.offset !== undefined) search.append("offset", String(params.offset));
  if (params.limit !== undefined) search.append("limit", String(params.limit));
  if (params.order) search.append("order", params.order);
  if (params.query) search.append("query", params.query);
  if (params.owned_by) search.append("owned_by", params.owned_by);
  if (params.tag) search.append("tag", params.tag);

  const res = await apiFetch(`/posts?${search}`, { method: "GET" });
  if (!res.ok) throw new Error("Failed to fetch posts");
  return await res.json();
}

export async function getPost(id: string): Promise<Post> {
  const res = await apiFetch(`/posts/${id}`, { method: "GET" });
  if (!res.ok) throw new Error("Post not found");
  return await res.json();
}

export async function createPost(post: {
  content: string;
  owned_by: string;
  reply_to?: string | null;
}): Promise<Post> {
  const res = await apiFetch("/posts", {
    method: "POST",
    body: JSON.stringify(post),
  });
  if (!res.ok) throw new Error((await res.json()).error || "Failed to create post");
  return await res.json();
}

export async function updatePost(
  id: string,
  post: { content: string; reply_to?: string | null },
): Promise<Post> {
  const res = await apiFetch(`/posts/${id}`, {
    method: "PUT",
    body: JSON.stringify(post),
  });
  if (!res.ok) throw new Error((await res.json()).error || "Failed to update post");
  return await res.json();
}

export async function deletePost(id: string): Promise<{ result: string }> {
  const res = await apiFetch(`/posts/${id}`, { method: "DELETE" });
  if (!res.ok) throw new Error((await res.json()).error || "Failed to delete post");
  return await res.json();
}

export async function getPostDetail(id: string): Promise<PostDetail> {
  const res = await apiFetch(`/posts/${id}/detail`, { method: "GET" });
  if (!res.ok) throw new Error("Post detail not found");
  return await res.json();
}

export async function listPostsDetail(
  params: {
    offset?: number;
    limit?: number;
    order?: "asc" | "desc";
    query?: string;
    owned_by?: string;
    tag?: string;
  } = {},
): Promise<PostDetail[]> {
  const search = new URLSearchParams();
  if (params.offset !== undefined) search.append("offset", String(params.offset));
  if (params.limit !== undefined) search.append("limit", String(params.limit));
  if (params.order) search.append("order", params.order);
  if (params.query) search.append("query", params.query);
  if (params.owned_by) search.append("owned_by", params.owned_by);
  if (params.tag) search.append("tag", params.tag);

  const res = await apiFetch(`/posts/detail?${search}`, { method: "GET" });
  if (!res.ok) throw new Error("Failed to fetch posts detail");
  return await res.json();
}

export async function listPostsByFolloweesDetail(
  params: {
    user_id: string;
    offset?: number;
    limit?: number;
    order?: "asc" | "desc";
    include_self?: boolean;
  } = { user_id: "" },
): Promise<PostDetail[]> {
  const search = new URLSearchParams();
  if (params.user_id) search.append("user_id", params.user_id);
  if (params.offset !== undefined) search.append("offset", String(params.offset));
  if (params.limit !== undefined) search.append("limit", String(params.limit));
  if (params.order) search.append("order", params.order);
  if (params.include_self !== undefined) search.append("include_self", String(params.include_self));

  const res = await apiFetch(`/posts/by-followees/detail?${search}`, { method: "GET" });
  if (!res.ok) throw new Error("Failed to fetch posts by followees");
  return await res.json();
}

export async function listPostsLikedByUserDetail(
  params: { user_id: string; offset?: number; limit?: number; order?: "asc" | "desc" } = {
    user_id: "",
  },
): Promise<PostDetail[]> {
  const search = new URLSearchParams();
  if (params.user_id) search.append("user_id", params.user_id);
  if (params.offset !== undefined) search.append("offset", String(params.offset));
  if (params.limit !== undefined) search.append("limit", String(params.limit));
  if (params.order) search.append("order", params.order);

  const res = await apiFetch(`/posts/liked/detail?${search}`, { method: "GET" });
  if (!res.ok) throw new Error("Failed to fetch liked posts");
  return await res.json();
}

export async function addLike(post_id: string): Promise<{ result: string }> {
  const res = await apiFetch(`/posts/${post_id}/like`, { method: "POST" });
  if (!res.ok) throw new Error((await res.json()).error || "Failed to like post");
  return await res.json();
}

export async function removeLike(post_id: string): Promise<{ result: string }> {
  const res = await apiFetch(`/posts/${post_id}/like`, { method: "DELETE" });
  if (!res.ok) throw new Error((await res.json()).error || "Failed to unlike post");
  return await res.json();
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
  if (!res.ok) throw new Error("Failed to fetch post likers");
  return await res.json();
}

export async function countPosts(
  params: { query?: string; owned_by?: string; tag?: string; reply_to?: string } = {},
): Promise<number> {
  const search = new URLSearchParams();
  if (params.query) search.append("query", params.query);
  if (params.owned_by) search.append("owned_by", params.owned_by);
  if (params.tag) search.append("tag", params.tag);
  if (params.reply_to) search.append("reply_to", params.reply_to);

  const res = await apiFetch(`/posts/count?${search}`, { method: "GET" });
  if (!res.ok) throw new Error("Failed to fetch post count");
  return (await res.json()).count;
}
