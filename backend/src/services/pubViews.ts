import crypto from "crypto";
import type Redis from "ioredis";
import { Config } from "../config";
import type { PubPopularEntry, PubViewStatEntry, PubViewStats } from "../models/post";

const DAYS = 10;
const TOP_LIMIT = 1000;
const LRU_CAPACITY = 150;
const FINGERPRINT_BYTES = 4;
const LRU_TTL_SECONDS = 11 * 24 * 60 * 60;
const META_TTL_SECONDS = 11 * 24 * 60 * 60;
const RANKING_CACHE_TTL_SECONDS = 5 * 60;

const RECORD_VIEW_LUA = `
local value = redis.call("GET", KEYS[1]) or ""
local fingerprint = ARGV[1]
local post_id = ARGV[2]
local meta_json = ARGV[3]
local lru_ttl = tonumber(ARGV[4])
local meta_ttl = tonumber(ARGV[5])
local daily_expire_at = tonumber(ARGV[6])
local max_bytes = tonumber(ARGV[7])

if (#value % 4) ~= 0 or #value > max_bytes then
  value = ""
end

local found = 0
local next_value = ""
for pos = 1, #value, 4 do
  local item = string.sub(value, pos, pos + 3)
  if item == fingerprint then
    found = 1
  else
    next_value = next_value .. item
  end
end

next_value = next_value .. fingerprint
if #next_value > max_bytes then
  next_value = string.sub(next_value, #next_value - max_bytes + 1)
end

redis.call("SET", KEYS[1], next_value, "EX", lru_ttl)
redis.call("SET", KEYS[3], meta_json, "EX", meta_ttl)

if found == 0 then
  redis.call("HINCRBY", KEYS[2], post_id, 1)
  redis.call("EXPIREAT", KEYS[2], daily_expire_at)
  return 1
end

return 0
`;

type HeapEntry = { id: string; pv: number };
type StoredMeta = { publishedAt: string; digest: string; snippet?: string };

type RedisWithPubViews = Redis & {
  stgyRecordPubView(
    lruKey: string,
    dailyKey: string,
    metaKey: string,
    fingerprint: Buffer,
    postId: string,
    metaJson: string,
    lruTtl: string,
    metaTtl: string,
    dailyExpireAt: string,
    maxBytes: string,
  ): Promise<number>;
};

const configuredRedisClients = new WeakSet<object>();

function configureRedis(redis: Redis): RedisWithPubViews {
  if (!configuredRedisClients.has(redis)) {
    redis.defineCommand("stgyRecordPubView", {
      numberOfKeys: 3,
      lua: RECORD_VIEW_LUA,
    });
    configuredRedisClients.add(redis);
  }
  return redis as RedisWithPubViews;
}

function utcDateAtOffset(now: Date, offsetDays: number): Date {
  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + offsetDays),
  );
}

function dateKey(date: Date): string {
  const year = String(date.getUTCFullYear()).padStart(4, "0");
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${year}${month}${day}`;
}

function dailyKey(ownerId: string, date: Date): string {
  return `stgy:pub-views:daily:${ownerId}:${dateKey(date)}`;
}

function lruKey(ownerId: string, postId: string): string {
  return `stgy:pub-views:lru:${ownerId}:${postId}`;
}

function metaKey(ownerId: string, postId: string): string {
  return `stgy:pub-views:meta:${ownerId}:${postId}`;
}

function rankingKey(ownerId: string): string {
  return `stgy:pub-views:ranking:${ownerId}`;
}

function compareRank(a: HeapEntry, b: HeapEntry): number {
  if (a.pv !== b.pv) return a.pv - b.pv;
  return b.id.localeCompare(a.id);
}

function heapPush(heap: HeapEntry[], value: HeapEntry): void {
  heap.push(value);
  let index = heap.length - 1;
  while (index > 0) {
    const parent = Math.floor((index - 1) / 2);
    if (compareRank(heap[parent], heap[index]) <= 0) break;
    [heap[parent], heap[index]] = [heap[index], heap[parent]];
    index = parent;
  }
}

function heapReplaceRoot(heap: HeapEntry[], value: HeapEntry): void {
  heap[0] = value;
  let index = 0;
  for (;;) {
    const left = index * 2 + 1;
    const right = left + 1;
    let smallest = index;
    if (left < heap.length && compareRank(heap[left], heap[smallest]) < 0) {
      smallest = left;
    }
    if (right < heap.length && compareRank(heap[right], heap[smallest]) < 0) {
      smallest = right;
    }
    if (smallest === index) break;
    [heap[index], heap[smallest]] = [heap[smallest], heap[index]];
    index = smallest;
  }
}

function selectTopEntries(counts: Map<string, number>, limit: number): HeapEntry[] {
  const heap: HeapEntry[] = [];
  for (const [id, pv] of counts) {
    if (pv <= 0) continue;
    const entry = { id, pv };
    if (heap.length < limit) {
      heapPush(heap, entry);
    } else if (compareRank(entry, heap[0]) > 0) {
      heapReplaceRoot(heap, entry);
    }
  }
  return heap.sort((a, b) => b.pv - a.pv || a.id.localeCompare(b.id));
}

function parseCachedStats(raw: string | null): PubViewStats | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as PubViewStats;
    if (!Number.isFinite(value.totalPv) || !Array.isArray(value.entries)) return null;
    return value;
  } catch {
    return null;
  }
}

export function makePubViewSignature(postId: string, fingerprintHex: string): string {
  return crypto
    .createHmac("sha256", Config.REDIS_PASSWORD)
    .update(`${postId.toUpperCase()}\n${fingerprintHex}`)
    .digest("hex");
}

export function verifyPubViewSignature(
  postId: string,
  fingerprintHex: string,
  signatureHex: string,
): boolean {
  if (!/^[0-9a-f]{8}$/i.test(fingerprintHex) || !/^[0-9a-f]{64}$/i.test(signatureHex)) {
    return false;
  }
  const expected = Buffer.from(makePubViewSignature(postId, fingerprintHex), "hex");
  const actual = Buffer.from(signatureHex, "hex");
  return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
}

export class PubViewsService {
  private readonly redis: Redis;

  constructor(redis: Redis) {
    this.redis = redis;
  }

  async recordView(input: {
    ownerId: string;
    postId: string;
    publishedAt: string;
    digest: string;
    snippet: string;
    fingerprintHex: string;
    now?: Date;
  }): Promise<boolean> {
    if (!/^[0-9a-f]{8}$/i.test(input.fingerprintHex)) return false;
    const fingerprint = Buffer.from(input.fingerprintHex, "hex");
    if (fingerprint.length !== FINGERPRINT_BYTES) return false;

    const now = input.now ?? new Date();
    const today = utcDateAtOffset(now, 0);
    const expiresAt = Math.floor(utcDateAtOffset(now, 11).getTime() / 1000);
    const meta: StoredMeta = {
      publishedAt: input.publishedAt,
      digest: input.digest,
      snippet: input.snippet,
    };

    const redis = configureRedis(this.redis);
    const result = await redis.stgyRecordPubView(
      lruKey(input.ownerId, input.postId),
      dailyKey(input.ownerId, today),
      metaKey(input.ownerId, input.postId),
      fingerprint,
      input.postId,
      JSON.stringify(meta),
      String(LRU_TTL_SECONDS),
      String(META_TTL_SECONDS),
      String(expiresAt),
      String(LRU_CAPACITY * FINGERPRINT_BYTES),
    );
    return Number(result) === 1;
  }

  async getStats(ownerId: string, now = new Date()): Promise<PubViewStats> {
    const cacheKey = rankingKey(ownerId);
    const cached = parseCachedStats(await this.redis.get(cacheKey));
    if (cached && cached.totalPv > 0) return cached;

    const dates = Array.from({ length: DAYS }, (_, i) => utcDateAtOffset(now, -i));
    const pipeline = this.redis.pipeline();
    for (const date of dates) pipeline.hgetall(dailyKey(ownerId, date));
    const replies = await pipeline.exec();

    const totals = new Map<string, number>();
    let totalPv = 0;
    for (const reply of replies ?? []) {
      const [error, value] = reply;
      if (error) throw error;
      const daily = value as Record<string, string>;
      for (const [postId, rawPv] of Object.entries(daily)) {
        const pv = Number(rawPv);
        if (!Number.isFinite(pv) || pv <= 0) continue;
        totalPv += pv;
        totals.set(postId, (totals.get(postId) ?? 0) + pv);
      }
    }

    const ranked = selectTopEntries(totals, TOP_LIMIT);
    const metaValues =
      ranked.length > 0
        ? await this.redis.mget(...ranked.map((entry) => metaKey(ownerId, entry.id)))
        : [];
    const entries: PubViewStatEntry[] = [];
    for (let i = 0; i < ranked.length; i++) {
      const rawMeta = metaValues[i];
      if (!rawMeta) continue;
      try {
        const meta = JSON.parse(rawMeta) as StoredMeta;
        if (typeof meta.publishedAt !== "string" || typeof meta.digest !== "string") continue;
        entries.push({
          id: ranked[i].id,
          publishedAt: meta.publishedAt,
          digest: meta.digest,
          pv: ranked[i].pv,
        });
      } catch {}
    }

    const stats: PubViewStats = { totalPv, entries };
    if (totalPv > 0) {
      await this.redis.setex(cacheKey, RANKING_CACHE_TTL_SECONDS, JSON.stringify(stats));
    }
    return stats;
  }

  async getPopular(ownerId: string, limit: number): Promise<PubPopularEntry[]> {
    if (!Number.isInteger(limit) || limit <= 0) return [];
    const stats = await this.getStats(ownerId);
    const selected = stats.entries.slice(0, Math.min(limit, TOP_LIMIT));
    if (selected.length === 0) return [];

    const metaValues = await this.redis.mget(
      ...selected.map((entry) => metaKey(ownerId, entry.id)),
    );
    return selected.map((entry, index) => {
      let snippet = "";
      const rawMeta = metaValues[index];
      if (rawMeta) {
        try {
          const meta = JSON.parse(rawMeta) as StoredMeta;
          if (typeof meta.snippet === "string") snippet = meta.snippet;
        } catch {}
      }
      return { ...entry, snippet };
    });
  }
}
