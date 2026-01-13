import type { User, UserDetail, PubConfig } from "./models";
import { apiFetch, extractError } from "./client";

export async function listUsers(
  params: {
    offset?: number;
    limit?: number;
    order?: "asc" | "desc" | "social";
    query?: string;
    nickname?: string;
    nicknamePrefix?: string;
    focusUserId?: string;
  } = {},
): Promise<User[]> {
  const search = new URLSearchParams();
  if (params.offset !== undefined) search.append("offset", String(params.offset));
  if (params.limit !== undefined) search.append("limit", String(params.limit));
  if (params.order) search.append("order", params.order);
  if (params.query) search.append("query", params.query);
  if (params.nickname) search.append("nickname", params.nickname);
  if (params.nicknamePrefix) search.append("nicknamePrefix", params.nicknamePrefix);
  if (params.focusUserId) search.append("focusUserId", params.focusUserId);
  const q = search.toString();
  const res = await apiFetch(`/users${q ? `?${q}` : ""}`, { method: "GET" });
  if (!res.ok) throw new Error(await extractError(res));
  return res.json();
}

export async function listFriendsByNicknamePrefix(
  params: {
    focusUserId?: string;
    offset?: number;
    limit?: number;
    nicknamePrefix?: string;
    omitSelf?: boolean;
    omitOthers?: boolean;
  } = {},
): Promise<User[]> {
  const search = new URLSearchParams();
  if (params.focusUserId) search.append("focusUserId", params.focusUserId);
  if (params.offset !== undefined) search.append("offset", String(params.offset));
  if (params.limit !== undefined) search.append("limit", String(params.limit));
  if (params.nicknamePrefix !== undefined) search.append("nicknamePrefix", params.nicknamePrefix);
  if (params.omitSelf !== undefined) search.append("omitSelf", String(params.omitSelf));
  if (params.omitOthers !== undefined) search.append("omitOthers", String(params.omitOthers));
  const q = search.toString();
  const res = await apiFetch(`/users/friends/by-nickname-prefix${q ? `?${q}` : ""}`, {
    method: "GET",
  });
  if (!res.ok) throw new Error(await extractError(res));
  return res.json();
}

export async function getUserLite(id: string): Promise<User> {
  const res = await apiFetch(`/users/${id}/lite`, { method: "GET" });
  if (!res.ok) throw new Error(await extractError(res));
  return res.json();
}

export async function getUser(id: string, focusUserId?: string): Promise<UserDetail> {
  const search = new URLSearchParams();
  if (focusUserId) search.append("focusUserId", focusUserId);
  const q = search.toString();
  const res = await apiFetch(`/users/${id}${q ? `?${q}` : ""}`, { method: "GET" });
  if (!res.ok) throw new Error(await extractError(res));
  return res.json();
}

export async function createUser(user: {
  id?: string;
  email: string;
  nickname: string;
  password: string;
  isAdmin: boolean;
  blockStrangers: boolean;
  locale: string;
  timezone: string;
  introduction: string;
  avatar: string | null;
  aiModel: string | null;
  aiPersonality: string | null;
}): Promise<User> {
  const res = await apiFetch("/users", {
    method: "POST",
    body: JSON.stringify(user),
  });
  if (!res.ok) throw new Error(await extractError(res));
  return res.json();
}

type UpdatableFields = Pick<
  User,
  "nickname" | "isAdmin" | "blockStrangers" | "avatar" | "aiModel"
> &
  Pick<UserDetail, "introduction" | "aiPersonality" | "locale" | "timezone"> & {
    email?: string;
  };

export async function updateUser(id: string, user: Partial<UpdatableFields>): Promise<User> {
  const res = await apiFetch(`/users/${id}`, {
    method: "PUT",
    body: JSON.stringify(user),
  });
  if (!res.ok) throw new Error(await extractError(res));
  return res.json();
}

export async function deleteUser(id: string): Promise<{ result: string }> {
  const res = await apiFetch(`/users/${id}`, { method: "DELETE" });
  if (!res.ok) throw new Error(await extractError(res));
  return res.json();
}

export async function startUpdateEmail(
  id: string,
  email: string,
): Promise<{ updateEmailId: string }> {
  const res = await apiFetch(`/users/${id}/email/start`, {
    method: "POST",
    body: JSON.stringify({ email }),
  });
  if (!res.ok) throw new Error(await extractError(res));
  return res.json();
}

export async function verifyUpdateEmail(
  id: string,
  updateEmailId: string,
  verificationCode: string,
): Promise<{ result: string }> {
  const res = await apiFetch(`/users/${id}/email/verify`, {
    method: "POST",
    body: JSON.stringify({ updateEmailId, verificationCode }),
  });
  if (!res.ok) throw new Error(await extractError(res));
  return res.json();
}

export async function updateUserPassword(
  id: string,
  password: string,
): Promise<{ result: string }> {
  const res = await apiFetch(`/users/${id}/password`, {
    method: "PUT",
    body: JSON.stringify({ password }),
  });
  if (!res.ok) throw new Error(await extractError(res));
  return res.json();
}

export async function startResetPassword(
  email: string,
): Promise<{ resetPasswordId: string; webCode: string }> {
  const res = await apiFetch("/users/password/reset/start", {
    method: "POST",
    body: JSON.stringify({ email }),
  });
  if (!res.ok) throw new Error(await extractError(res));
  return res.json();
}

export async function verifyResetPassword(params: {
  email: string;
  resetPasswordId: string;
  webCode: string;
  mailCode: string;
  newPassword: string;
}): Promise<{ result: string }> {
  const res = await apiFetch("/users/password/reset/verify", {
    method: "POST",
    body: JSON.stringify(params),
  });
  if (!res.ok) throw new Error(await extractError(res));
  return res.json();
}

export async function addFollow(id: string): Promise<{ result: string }> {
  const res = await apiFetch(`/users/${id}/follow`, { method: "POST" });
  if (!res.ok) throw new Error(await extractError(res));
  return res.json();
}

export async function removeFollow(id: string): Promise<{ result: string }> {
  const res = await apiFetch(`/users/${id}/follow`, { method: "DELETE" });
  if (!res.ok) throw new Error(await extractError(res));
  return res.json();
}

export async function listFollowees(
  id: string,
  params: {
    offset?: number;
    limit?: number;
    order?: "asc" | "desc";
    focusUserId?: string;
  } = {},
): Promise<User[]> {
  const search = new URLSearchParams();
  if (params.offset !== undefined) search.append("offset", String(params.offset));
  if (params.limit !== undefined) search.append("limit", String(params.limit));
  if (params.order) search.append("order", params.order);
  if (params.focusUserId) search.append("focusUserId", params.focusUserId);
  const q = search.toString();
  const res = await apiFetch(`/users/${id}/followees${q ? `?${q}` : ""}`, { method: "GET" });
  if (!res.ok) throw new Error(await extractError(res));
  return res.json();
}

export async function listFollowers(
  id: string,
  params: {
    offset?: number;
    limit?: number;
    order?: "asc" | "desc";
    focusUserId?: string;
  } = {},
): Promise<User[]> {
  const search = new URLSearchParams();
  if (params.offset !== undefined) search.append("offset", String(params.offset));
  if (params.limit !== undefined) search.append("limit", String(params.limit));
  if (params.order) search.append("order", params.order);
  if (params.focusUserId) search.append("focusUserId", params.focusUserId);
  const q = search.toString();
  const res = await apiFetch(`/users/${id}/followers${q ? `?${q}` : ""}`, { method: "GET" });
  if (!res.ok) throw new Error(await extractError(res));
  return res.json();
}

export async function addBlock(id: string): Promise<{ result: string }> {
  const res = await apiFetch(`/users/${id}/block`, { method: "POST" });
  if (!res.ok) throw new Error(await extractError(res));
  return res.json();
}

export async function removeBlock(id: string): Promise<{ result: string }> {
  const res = await apiFetch(`/users/${id}/block`, { method: "DELETE" });
  if (!res.ok) throw new Error(await extractError(res));
  return res.json();
}

export async function listBlockees(
  id: string,
  params: {
    offset?: number;
    limit?: number;
    order?: "asc" | "desc";
    focusUserId?: string;
  } = {},
): Promise<User[]> {
  const search = new URLSearchParams();
  if (params.offset !== undefined) search.append("offset", String(params.offset));
  if (params.limit !== undefined) search.append("limit", String(params.limit));
  if (params.order) search.append("order", params.order);
  if (params.focusUserId) search.append("focusUserId", params.focusUserId);
  const q = search.toString();
  const res = await apiFetch(`/users/${id}/blockees${q ? `?${q}` : ""}`, { method: "GET" });
  if (!res.ok) throw new Error(await extractError(res));
  return res.json();
}

export async function countUsers(
  params: { query?: string; nickname?: string; nicknamePrefix?: string } = {},
): Promise<number> {
  const search = new URLSearchParams();
  if (params.query) search.append("query", params.query);
  if (params.nickname) search.append("nickname", params.nickname);
  if (params.nicknamePrefix) search.append("nicknamePrefix", params.nicknamePrefix);
  const q = search.toString();
  const res = await apiFetch(`/users/count${q ? `?${q}` : ""}`, { method: "GET" });
  if (!res.ok) throw new Error(await extractError(res));
  return (await res.json()).count;
}

export async function getPubConfig(id: string): Promise<PubConfig> {
  const res = await apiFetch(`/users/${id}/pub-config`, { method: "GET" });
  if (!res.ok) throw new Error(await extractError(res));
  return res.json();
}

export async function setPubConfig(id: string, cfg: Partial<PubConfig>): Promise<PubConfig> {
  const res = await apiFetch(`/users/${id}/pub-config`, {
    method: "PUT",
    body: JSON.stringify(cfg),
  });
  if (!res.ok) throw new Error(await extractError(res));
  return res.json();
}
