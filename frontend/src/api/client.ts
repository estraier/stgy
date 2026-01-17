import { Config } from "@/config";

type ApiFetchOptions = Omit<RequestInit, "headers"> & {
  headers?: Record<string, string>;
  ssrCookie?: string;
};

function isAbsoluteHttpUrl(s: string): boolean {
  return /^https?:\/\//i.test(s);
}

function getOriginForAbsoluteBase(): string {
  if (typeof window !== "undefined") {
    const o = window.location?.origin;
    if (typeof o === "string" && o.trim() !== "") return o;
  }
  return new URL(Config.FRONTEND_CANONICAL_URL).origin;
}

function buildApiUrl(path: string): string {
  const base = Config.BACKEND_API_BASE_URL.trim();
  if (!base) throw new Error("Config.BACKEND_API_BASE_URL is empty");

  const p = path.replace(/^\/+/, "");

  if (isAbsoluteHttpUrl(base)) {
    const baseDir = base.endsWith("/") ? base : `${base}/`;
    return new URL(p, baseDir).toString();
  }

  const origin = getOriginForAbsoluteBase();
  const basePath = base.startsWith("/") ? base : `/${base}`;
  const baseDir = basePath.endsWith("/") ? basePath : `${basePath}/`;
  const baseUrl = new URL(baseDir, origin).toString();
  return new URL(p, baseUrl).toString();
}

export async function apiFetch(path: string, options: ApiFetchOptions = {}): Promise<Response> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(options.headers || {}),
  };
  if (options.ssrCookie) {
    headers["cookie"] = options.ssrCookie;
  }
  return fetch(buildApiUrl(path), {
    credentials: "include",
    ...options,
    headers,
  });
}

export async function extractError(res: Response): Promise<string> {
  try {
    const data = await res.json();
    if (data && typeof (data as { error?: unknown }).error === "string") {
      return (data as { error: string }).error;
    }
    return JSON.stringify(data);
  } catch (e) {
    return res.statusText || String(e);
  }
}
