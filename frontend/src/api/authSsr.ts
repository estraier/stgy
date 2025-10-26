import { cookies } from "next/headers";
import { Config } from "@/config";
import type { SessionInfo } from "@/api/models";

export async function getSessionInfo(): Promise<SessionInfo | null> {
  const store = await cookies();
  const pairs = store.getAll().map((c) => `${c.name}=${c.value}`);
  const cookieHeader = pairs.join("; ");
  if (!cookieHeader) return null;
  const res = await fetch(`${Config.BACKEND_API_BASE_URL}/auth`, {
    method: "GET",
    headers: { cookie: cookieHeader },
    cache: "no-store",
  });
  if (!res.ok) return null;
  return (await res.json()) as SessionInfo;
}
