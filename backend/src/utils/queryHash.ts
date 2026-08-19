import crypto from "crypto";

export const QUERY_HASH_PARAM = "queryhash";

export function canonicalizeQuery(search: URLSearchParams): string {
  return Array.from(search.entries())
    .filter(([key]) => key !== QUERY_HASH_PARAM)
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
    .sort()
    .join("&");
}

export function makeQueryHash(search: URLSearchParams): string {
  return crypto.createHash("sha1").update(canonicalizeQuery(search), "utf8").digest("hex");
}

export function verifyQueryHash(url: string): boolean {
  const search = new URL(url, "http://localhost").searchParams;
  const hashes = search.getAll(QUERY_HASH_PARAM);
  return hashes.length === 1 && hashes[0] === makeQueryHash(search);
}
