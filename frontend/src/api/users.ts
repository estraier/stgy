import type { User } from "./models";
import { apiFetch } from "./client";

export async function listUsers(
  params: {
    offset?: number;
    limit?: number;
    order?: "asc" | "desc";
    query?: string;
    nickname?: string;
  } = {},
): Promise<User[]> {
  const search = new URLSearchParams();
  if (params.offset !== undefined) search.append("offset", String(params.offset));
  if (params.limit !== undefined) search.append("limit", String(params.limit));
  if (params.order) search.append("order", params.order);
  if (params.query) search.append("query", params.query);
  if (params.nickname) search.append("nickname", params.nickname);

  const res = await apiFetch(`/users?${search}`, { method: "GET" });
  if (!res.ok) throw new Error("Failed to fetch users");
  return await res.json();
}

export async function getUser(id: string): Promise<User> {
  const res = await apiFetch(`/users/${id}`, { method: "GET" });
  if (!res.ok) throw new Error("User not found");
  return await res.json();
}

export async function createUser(
  user: Omit<User, "id" | "created_at"> & { password: string },
): Promise<User> {
  const res = await apiFetch("/users", {
    method: "POST",
    body: JSON.stringify(user),
  });
  if (!res.ok) throw new Error((await res.json()).error || "Failed to create user");
  return await res.json();
}

export async function updateUser(
  id: string,
  user: Partial<Omit<User, "id" | "created_at">>,
): Promise<User> {
  const res = await apiFetch(`/users/${id}`, {
    method: "PUT",
    body: JSON.stringify(user),
  });
  if (!res.ok) throw new Error((await res.json()).error || "Failed to update user");
  return await res.json();
}

export async function deleteUser(id: string): Promise<{ result: string }> {
  const res = await apiFetch(`/users/${id}`, { method: "DELETE" });
  if (!res.ok) throw new Error((await res.json()).error || "Failed to delete user");
  return await res.json();
}

export async function updateUserPassword(
  id: string,
  password: string,
): Promise<{ result: string }> {
  const res = await apiFetch(`/users/${id}/password`, {
    method: "PUT",
    body: JSON.stringify({ password }),
  });
  if (!res.ok) throw new Error((await res.json()).error || "Failed to update password");
  return await res.json();
}

export async function addFollower(id: string): Promise<{ result: string }> {
  const res = await apiFetch(`/users/${id}/follow`, { method: "POST" });
  if (!res.ok) throw new Error((await res.json()).error || "Failed to follow user");
  return await res.json();
}

export async function removeFollower(id: string): Promise<{ result: string }> {
  const res = await apiFetch(`/users/${id}/follow`, { method: "DELETE" });
  if (!res.ok) throw new Error((await res.json()).error || "Failed to unfollow user");
  return await res.json();
}

export async function listFollowees(id: string, offset = 0, limit = 100): Promise<User[]> {
  const res = await apiFetch(`/users/${id}/followees?offset=${offset}&limit=${limit}`, {
    method: "GET",
  });
  if (!res.ok) throw new Error("Failed to fetch followees");
  return await res.json();
}

export async function listFollowers(id: string, offset = 0, limit = 100): Promise<User[]> {
  const res = await apiFetch(`/users/${id}/followers?offset=${offset}&limit=${limit}`, {
    method: "GET",
  });
  if (!res.ok) throw new Error("Failed to fetch followers");
  return await res.json();
}

export async function countUsers(
  params: { nickname?: string; query?: string } = {},
): Promise<number> {
  const search = new URLSearchParams();
  if (params.nickname) search.append("nickname", params.nickname);
  if (params.query) search.append("query", params.query);

  const res = await apiFetch(`/users/count?${search}`, { method: "GET" });
  if (!res.ok) throw new Error("Failed to fetch user count");
  return (await res.json()).count;
}
