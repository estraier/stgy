export const QUERY_HASH_HEADER = "X-STGY-QueryHash";

export function canonicalizeQuery(search: URLSearchParams): string {
  return Array.from(search.entries())
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
    .sort()
    .join("&");
}

export async function makeQueryHash(search: URLSearchParams): Promise<string> {
  const bytes = new TextEncoder().encode(canonicalizeQuery(search));
  const digest = await crypto.subtle.digest("SHA-1", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function makeQueryHashHeaders(
  search: URLSearchParams,
): Promise<Record<string, string>> {
  return { [QUERY_HASH_HEADER]: await makeQueryHash(search) };
}
