import type { User } from "./models";
import { apiFetch } from "./client";

export async function getSessionInfo(): Promise<{
  userId: string;
  email: string;
  nickname: string;
  is_admin: boolean;
}> {
  const res = await apiFetch("/auth", { method: "GET" });
  if (!res.ok) throw new Error("Not logged in");
  return await res.json();
}

export async function login(email: string, password: string): Promise<{ session_id: string }> {
  const res = await apiFetch("/auth", {
    method: "POST",
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) throw new Error((await res.json()).error || "Login failed.");
  return await res.json();
}

export async function logout(): Promise<{ result: string }> {
  const res = await apiFetch("/auth", { method: "DELETE" });
  if (!res.ok) throw new Error("Logout failed");
  return await res.json();
}
