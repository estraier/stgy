import type { SessionInfo } from "./models";
import { apiFetch, extractError } from "./client";

let sessionInfoRequest: Promise<SessionInfo> | null = null;

export function getSessionInfo(): Promise<SessionInfo> {
  if (sessionInfoRequest) return sessionInfoRequest;

  const request = fetchSessionInfo();
  sessionInfoRequest = request;
  request.then(
    () => {
      if (sessionInfoRequest === request) sessionInfoRequest = null;
    },
    () => {
      if (sessionInfoRequest === request) sessionInfoRequest = null;
    },
  );
  return request;
}

async function fetchSessionInfo(): Promise<SessionInfo> {
  const res = await apiFetch("/auth", { method: "GET", cache: "no-store" });
  if (!res.ok) throw new Error(await extractError(res));
  return res.json();
}

function resetSessionInfoRequest(): void {
  sessionInfoRequest = null;
}

export async function login(email: string, password: string): Promise<{ sessionId: string }> {
  const res = await apiFetch("/auth", {
    method: "POST",
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) throw new Error(await extractError(res));
  resetSessionInfoRequest();
  return res.json();
}

export async function switchLoginAccount(userId: string): Promise<{ sessionId: string }> {
  const res = await apiFetch("/auth/switch-user", {
    method: "POST",
    body: JSON.stringify({ id: userId }),
  });
  if (!res.ok) throw new Error(await extractError(res));
  resetSessionInfoRequest();
  return res.json();
}

export async function logout(): Promise<{ result: string }> {
  const res = await apiFetch("/auth", { method: "DELETE" });
  if (!res.ok) throw new Error(await extractError(res));
  resetSessionInfoRequest();
  return res.json();
}
