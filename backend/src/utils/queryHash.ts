import crypto from "crypto";

export const QUERY_HASH_HEADER = "X-STGY-QueryHash";

export function canonicalizeQuery(search: URLSearchParams): string {
  return Array.from(search.entries())
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
    .sort()
    .join("&");
}

export function makeQueryHash(search: URLSearchParams): string {
  return crypto.createHash("sha1").update(canonicalizeQuery(search), "utf8").digest("hex");
}

export function verifyQueryHash(url: string, headerValue: unknown): boolean {
  if (typeof headerValue !== "string") return false;
  const search = new URL(url, "http://localhost").searchParams;
  if (search.has("queryhash")) return false;
  return headerValue === makeQueryHash(search);
}
