import type { SessionInfo } from "./models";
import { apiFetch, extractError } from "./client";

export async function getSessionInfo(): Promise<SessionInfo> {
  const res = await apiFetch("/auth", { method: "GET" });
  if (!res.ok) throw new Error(await extractError(res));
  return res.json();
}

export async function login(email: string, password: string): Promise<{ sessionId: string }> {
  const res = await apiFetch("/auth", {
    method: "POST",
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) throw new Error(await extractError(res));
  return res.json();
}

export async function logout(): Promise<{ result: string }> {
  const res = await apiFetch("/auth", { method: "DELETE" });
  if (!res.ok) throw new Error(await extractError(res));
  return res.json();
}
