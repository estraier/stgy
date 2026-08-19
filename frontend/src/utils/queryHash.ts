export const QUERY_HASH_PARAM = "queryhash";

export function canonicalizeQuery(search: URLSearchParams): string {
  return Array.from(search.entries())
    .filter(([key]) => key !== QUERY_HASH_PARAM)
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
    .sort()
    .join("&");
}

export async function makeQueryHash(search: URLSearchParams): Promise<string> {
  const bytes = new TextEncoder().encode(canonicalizeQuery(search));
  const digest = await crypto.subtle.digest("SHA-1", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function appendQueryHash(search: URLSearchParams): Promise<void> {
  search.delete(QUERY_HASH_PARAM);
  search.append(QUERY_HASH_PARAM, await makeQueryHash(search));
}
