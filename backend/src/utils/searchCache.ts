import type Redis from "ioredis";
import { Config } from "../config";
import type { SearchCacheEntry } from "../models/search";

const WRITE_SEARCH_CACHE_SCRIPT = `
local ttl = redis.call('PTTL', KEYS[1])
redis.call('SET', KEYS[1], ARGV[1])
if ttl >= 0 then
  redis.call('PEXPIRE', KEYS[1], ttl)
else
  redis.call('EXPIRE', KEYS[1], ARGV[2])
end
return 1
`;

export async function writeSearchCache(
  redis: Redis,
  cacheKey: string,
  cache: SearchCacheEntry,
): Promise<void> {
  await redis.eval(
    WRITE_SEARCH_CACHE_SCRIPT,
    1,
    cacheKey,
    JSON.stringify(cache),
    String(Config.SEARCH_CACHE_TTL_SEC),
  );
}
