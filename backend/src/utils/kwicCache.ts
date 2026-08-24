import crypto from "crypto";
import type Redis from "ioredis";
import type { KwicData } from "stgy-markdown";
import { Config } from "../config";

export type KwicCacheResource = "posts" | "users";

export function makeKwicCacheKey(resource: KwicCacheResource, keywords: string[]): string {
  const hash = crypto.createHash("sha256").update(JSON.stringify(keywords)).digest("hex");
  return `stgy:kwic:${resource}:v1:${hash}`;
}

export async function readKwicCache(
  redis: Redis,
  cacheKey: string,
  ids: string[],
): Promise<Map<string, KwicData>> {
  const byId = new Map<string, KwicData>();
  if (ids.length === 0) return byId;

  const values = await redis.hmget(cacheKey, ...ids);
  for (let i = 0; i < ids.length; i += 1) {
    const value = values[i];
    if (value === null) continue;
    try {
      byId.set(ids[i], JSON.parse(value) as KwicData);
    } catch {
      // Regenerate only malformed entries.
    }
  }
  return byId;
}

export async function writeKwicCache(
  redis: Redis,
  cacheKey: string,
  items: Array<{ id: string; kwic: KwicData }>,
): Promise<void> {
  if (items.length === 0) return;

  const args: string[] = [];
  for (const item of items) {
    args.push(item.id, JSON.stringify(item.kwic));
  }

  const pipeline = redis.pipeline();
  pipeline.hset(cacheKey, ...args);
  // Redis 7: set the TTL only when this hash does not already have one.
  // Later HSETs therefore never extend the original freshness window.
  pipeline.expire(cacheKey, Config.SEARCH_CACHE_TTL_SEC, "NX");
  await pipeline.exec();
}
