export const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:3001";

type ApiFetchOptions = RequestInit & {
  ssrCookie?: string;
};

export async function apiFetch(path: string, options: ApiFetchOptions = {}) {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(options.headers || {}),
  };
  if (options.ssrCookie) {
    headers["cookie"] = options.ssrCookie;
  }
  return fetch(`${API_BASE_URL}${path}`, {
    credentials: "include",
    ...options,
    headers,
  });
}

export async function extractError(res: Response): Promise<string> {
  try {
    const data = await res.json();
    if (data && typeof data.error === "string") {
      return data.error;
    }
    return JSON.stringify(data);
  } catch (e) {
    return res.statusText || "Unknown error";
  }
}
