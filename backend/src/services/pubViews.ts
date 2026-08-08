import crypto from "crypto";
import type Redis from "ioredis";
import type { Pool } from "pg";
import { Config } from "../config";
import { decToHex, hexToDec } from "../utils/format";
import { createLogger } from "../utils/logger";
import { pgQuery } from "../utils/servers";
import { makePlainTextDigestFromJsonSnippet } from "../utils/snippet";
import type { PubViewRankEntry, PubViewStatEntry, PubViewStats } from "../models/post";

const DAYS = 10;
const TOP_LIMIT = 1000;
const LRU_CAPACITY = 150;
const FINGERPRINT_BYTES = 4;
const LRU_TTL_SECONDS = 11 * 24 * 60 * 60;
const META_TTL_SECONDS = 11 * 24 * 60 * 60;
const CACHE_TTL_SECONDS = 5 * 60;
const MAX_ACCESS_COUNT = 2_147_483_647;

const logger = createLogger({ file: "pub-views-service" });

const PUB_ACCESS_CHECKPOINTS = (() => {
  const checkpoints = new Set<number>([4, 8, 12]);
  for (let n = 0; ; n++) {
    const count = Math.round(16 * Math.pow(2, n / 4));
    if (count > MAX_ACCESS_COUNT) break;
    checkpoints.add(count);
  }
  return checkpoints;
})();

let lastPubAccessCleanupDate: string | null = null;
let pubAccessCleanupPromise: Promise<void> | null = null;

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
  local count = redis.call("HINCRBY", KEYS[2], post_id, 1)
  redis.call("EXPIREAT", KEYS[2], daily_expire_at)
  return count
end

return 0
`;

const MAX_VIEW_LUA = `
local current = tonumber(redis.call("HGET", KEYS[1], ARGV[1]) or "0")
local minimum = tonumber(ARGV[2])
local expire_at = tonumber(ARGV[3])
if current < minimum then
  redis.call("HSET", KEYS[1], ARGV[1], minimum)
  redis.call("EXPIREAT", KEYS[1], expire_at)
  return minimum
end
return current
`;

type Ranking = { totalPv: number; entries: PubViewRankEntry[] };
type StoredMeta = { publishedAt: string; digest: string };
type DbCheckpointRow = {
  post_id: string;
  target_date: string;
  count: number;
};

type DbPostMetaRow = {
  id: string;
  published_at: Date | string | null;
  snippet: string;
};

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
  stgyMaxPubView(
    dailyKey: string,
    postId: string,
    minimum: string,
    expireAt: string,
  ): Promise<number>;
};

const configuredRedisClients = new WeakSet<object>();

function configureRedis(redis: Redis): RedisWithPubViews {
  if (!configuredRedisClients.has(redis)) {
    redis.defineCommand("stgyRecordPubView", {
      numberOfKeys: 3,
      lua: RECORD_VIEW_LUA,
    });
    redis.defineCommand("stgyMaxPubView", {
      numberOfKeys: 1,
      lua: MAX_VIEW_LUA,
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

function sqlDate(date: Date): string {
  const key = dateKey(date);
  return `${key.slice(0, 4)}-${key.slice(4, 6)}-${key.slice(6, 8)}`;
}

function isPubAccessCheckpoint(count: number): boolean {
  return PUB_ACCESS_CHECKPOINTS.has(count);
}

function normalizePublishedAt(value: Date | string | null): string | null {
  if (value === null) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
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

function statsKey(ownerId: string): string {
  return `stgy:pub-views:stats:${ownerId}`;
}

function compareRank(a: PubViewRankEntry, b: PubViewRankEntry): number {
  if (a.pv !== b.pv) return a.pv - b.pv;
  return b.id.localeCompare(a.id);
}

function heapPush(heap: PubViewRankEntry[], value: PubViewRankEntry): void {
  heap.push(value);
  let index = heap.length - 1;
  while (index > 0) {
    const parent = Math.floor((index - 1) / 2);
    if (compareRank(heap[parent], heap[index]) <= 0) break;
    [heap[parent], heap[index]] = [heap[index], heap[parent]];
    index = parent;
  }
}

function heapReplaceRoot(heap: PubViewRankEntry[], value: PubViewRankEntry): void {
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

function selectTopEntries(
  counts: Map<string, number>,
  limit: number,
): PubViewRankEntry[] {
  const heap: PubViewRankEntry[] = [];
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

function parseCachedRanking(raw: string | null): Ranking | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Ranking;
    if (!Number.isFinite(value.totalPv) || !Array.isArray(value.entries)) return null;
    if (
      value.entries.some(
        (entry) =>
          typeof entry?.id !== "string" || !Number.isFinite(entry?.pv) || entry.pv <= 0,
      )
    ) {
      return null;
    }
    return value;
  } catch {
    return null;
  }
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
  private readonly pgPool: Pool;
  private readonly redis: Redis;

  constructor(pgPool: Pool, redis: Redis) {
    this.pgPool = pgPool;
    this.redis = redis;
  }

  private async upsertCheckpoints(input: {
    ownerId: string;
    postId: string;
    rows: Array<{ targetDate: string; count: number }>;
  }): Promise<void> {
    if (input.rows.length === 0) return;
    await pgQuery(
      this.pgPool,
      `
      INSERT INTO post_pub_access_counts (post_id, owner_id, target_date, count)
      SELECT $1::bigint, $2::bigint, v.target_date, v.count
      FROM unnest($3::date[], $4::integer[]) AS v(target_date, count)
      ON CONFLICT (post_id, target_date)
      DO UPDATE SET count = EXCLUDED.count
      WHERE post_pub_access_counts.count < EXCLUDED.count
    `,
      [
        hexToDec(input.postId),
        hexToDec(input.ownerId),
        input.rows.map((row) => row.targetDate),
        input.rows.map((row) => row.count),
      ],
    );
  }

  private async processCheckpoint(input: {
    ownerId: string;
    postId: string;
    date: Date;
    count: number;
  }): Promise<void> {
    const targetDate = sqlDate(input.date);
    const result = await pgQuery<{ count: number }>(
      this.pgPool,
      `SELECT count FROM post_pub_access_counts WHERE post_id = $1 AND target_date = $2`,
      [hexToDec(input.postId), targetDate],
    );
    const dbCount = result.rows.length > 0 ? Number(result.rows[0].count) : 0;

    if (dbCount > input.count) {
      const redis = configureRedis(this.redis);
      await redis.stgyMaxPubView(
        dailyKey(input.ownerId, input.date),
        input.postId,
        String(dbCount),
        String(Math.floor(utcDateAtOffset(input.date, 11).getTime() / 1000)),
      );
    } else if (input.count > dbCount) {
      await this.upsertCheckpoints({
        ownerId: input.ownerId,
        postId: input.postId,
        rows: [{ targetDate, count: input.count }],
      });
    }
  }

  private async syncRecentCheckpoints(input: {
    ownerId: string;
    postId: string;
    date: Date;
  }): Promise<void> {
    const dates = Array.from({ length: DAYS }, (_, i) => utcDateAtOffset(input.date, -i));
    const pipeline = this.redis.pipeline();
    for (const date of dates) pipeline.hget(dailyKey(input.ownerId, date), input.postId);
    const replies = await pipeline.exec();

    const oldestDate = sqlDate(dates[dates.length - 1]);
    const newestDate = sqlDate(dates[0]);
    const dbResult = await pgQuery<{ target_date: string; count: number }>(
      this.pgPool,
      `
      SELECT target_date::text AS target_date, count
      FROM post_pub_access_counts
      WHERE post_id = $1
        AND target_date >= $2::date
        AND target_date <= $3::date
    `,
      [hexToDec(input.postId), oldestDate, newestDate],
    );
    const dbCounts = new Map<string, number>();
    for (const row of dbResult.rows) {
      const count = Number(row.count);
      if (Number.isFinite(count) && count > 0) dbCounts.set(row.target_date, count);
    }

    const redis = configureRedis(this.redis);
    const rowsToUpsert: Array<{ targetDate: string; count: number }> = [];
    for (let i = 0; i < dates.length; i++) {
      const reply = replies?.[i];
      if (!reply) continue;
      const [error, rawValue] = reply;
      if (error) throw error;
      const redisCount = Number(rawValue ?? 0);
      const targetDate = sqlDate(dates[i]);
      const dbCount = dbCounts.get(targetDate) ?? 0;
      const normalizedRedisCount =
        Number.isFinite(redisCount) && redisCount > 0 ? redisCount : 0;

      if (dbCount > normalizedRedisCount) {
        await redis.stgyMaxPubView(
          dailyKey(input.ownerId, dates[i]),
          input.postId,
          String(dbCount),
          String(Math.floor(utcDateAtOffset(dates[i], 11).getTime() / 1000)),
        );
      } else if (normalizedRedisCount > dbCount) {
        rowsToUpsert.push({ targetDate, count: normalizedRedisCount });
      }
    }

    await this.upsertCheckpoints({
      ownerId: input.ownerId,
      postId: input.postId,
      rows: rowsToUpsert,
    });
    await this.maybeCleanupCheckpoints(newestDate);
  }

  private async maybeCleanupCheckpoints(targetDate: string): Promise<void> {
    if (lastPubAccessCleanupDate === targetDate) return;
    if (pubAccessCleanupPromise) {
      try {
        await pubAccessCleanupPromise;
      } catch {}
      if (lastPubAccessCleanupDate === targetDate) return;
    }

    const cleanup = (async () => {
      await pgQuery(
        this.pgPool,
        `DELETE FROM post_pub_access_counts WHERE target_date < $1::date - 9`,
        [targetDate],
      );
      lastPubAccessCleanupDate = targetDate;
    })();
    pubAccessCleanupPromise = cleanup;
    try {
      await cleanup;
    } catch (e) {
      logger.warn({ err: e }, "failed to cleanup public post access checkpoints");
    } finally {
      if (pubAccessCleanupPromise === cleanup) pubAccessCleanupPromise = null;
    }
  }

  async recordView(input: {
    ownerId: string;
    postId: string;
    publishedAt: string;
    digest: string;
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
    const count = Number(result);
    if (count === 4) {
      await this.syncRecentCheckpoints({
        ownerId: input.ownerId,
        postId: input.postId,
        date: today,
      });
    } else if (count > 0 && isPubAccessCheckpoint(count)) {
      await this.processCheckpoint({
        ownerId: input.ownerId,
        postId: input.postId,
        date: today,
        count,
      });
    }
    return count > 0;
  }

  private async getRanking(ownerId: string, now = new Date()): Promise<Ranking> {
    const cacheKey = rankingKey(ownerId);
    const cached = parseCachedRanking(await this.redis.get(cacheKey));
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

    const ranking: Ranking = {
      totalPv,
      entries: selectTopEntries(totals, TOP_LIMIT),
    };
    if (totalPv > 0) {
      await this.redis.setex(cacheKey, CACHE_TTL_SECONDS, JSON.stringify(ranking));
    }
    return ranking;
  }

  async getStats(ownerId: string, now = new Date()): Promise<PubViewStats> {
    const cacheKey = statsKey(ownerId);
    const cached = parseCachedStats(await this.redis.get(cacheKey));
    if (cached && cached.totalPv > 0) return cached;

    const dates = Array.from({ length: DAYS }, (_, i) => utcDateAtOffset(now, -i));
    const pipeline = this.redis.pipeline();
    for (const date of dates) pipeline.hgetall(dailyKey(ownerId, date));
    const replies = await pipeline.exec();

    const dailyCounts = new Map<string, Map<string, number>>();
    for (let i = 0; i < dates.length; i++) {
      const reply = replies?.[i];
      if (!reply) continue;
      const [error, value] = reply;
      if (error) throw error;
      const counts = new Map<string, number>();
      for (const [postId, rawPv] of Object.entries(value as Record<string, string>)) {
        const pv = Number(rawPv);
        if (Number.isFinite(pv) && pv > 0) counts.set(postId, pv);
      }
      dailyCounts.set(sqlDate(dates[i]), counts);
    }

    const oldestDate = sqlDate(dates[dates.length - 1]);
    const newestDate = sqlDate(dates[0]);
    const dbResult = await pgQuery<DbCheckpointRow>(
      this.pgPool,
      `
      SELECT post_id, target_date::text AS target_date, count
      FROM post_pub_access_counts
      WHERE owner_id = $1
        AND target_date >= $2::date
        AND target_date <= $3::date
    `,
      [hexToDec(ownerId), oldestDate, newestDate],
    );

    for (const row of dbResult.rows) {
      const pv = Number(row.count);
      if (!Number.isFinite(pv) || pv <= 0) continue;
      const postId = decToHex(row.post_id);
      const counts = dailyCounts.get(row.target_date) ?? new Map<string, number>();
      if (!dailyCounts.has(row.target_date)) dailyCounts.set(row.target_date, counts);
      if (pv > (counts.get(postId) ?? 0)) counts.set(postId, pv);
    }

    const totals = new Map<string, number>();
    let totalPv = 0;
    for (const counts of dailyCounts.values()) {
      for (const [postId, pv] of counts) {
        totalPv += pv;
        totals.set(postId, (totals.get(postId) ?? 0) + pv);
      }
    }
    const ranking = selectTopEntries(totals, TOP_LIMIT);
    const metaValues =
      ranking.length > 0
        ? await this.redis.mget(...ranking.map((entry) => metaKey(ownerId, entry.id)))
        : [];
    const metas = new Map<string, StoredMeta>();
    const missingMetaIds: string[] = [];
    for (let i = 0; i < ranking.length; i++) {
      const rawMeta = metaValues[i];
      if (rawMeta) {
        try {
          const parsed = JSON.parse(rawMeta) as StoredMeta;
          if (typeof parsed.publishedAt === "string" && typeof parsed.digest === "string") {
            metas.set(ranking[i].id, parsed);
            continue;
          }
        } catch {}
      }
      missingMetaIds.push(ranking[i].id);
    }

    if (missingMetaIds.length > 0) {
      const metaResult = await pgQuery<DbPostMetaRow>(
        this.pgPool,
        `
        WITH req AS (
          SELECT id
          FROM unnest($2::bigint[]) AS t(id)
        )
        SELECT p.id, p.published_at, p.snippet
        FROM req r
        JOIN posts p ON p.id = r.id
        WHERE p.owned_by = $1
      `,
        [hexToDec(ownerId), missingMetaIds.map((id) => hexToDec(id))],
      );
      for (const row of metaResult.rows) {
        const publishedAt = normalizePublishedAt(row.published_at);
        if (!publishedAt || typeof row.snippet !== "string") continue;
        try {
          metas.set(decToHex(row.id), {
            publishedAt,
            digest: makePlainTextDigestFromJsonSnippet(row.snippet),
          });
        } catch {}
      }
    }

    const entries: PubViewStatEntry[] = [];
    for (const ranked of ranking) {
      const meta = metas.get(ranked.id);
      if (!meta) continue;
      entries.push({
        id: ranked.id,
        publishedAt: meta.publishedAt,
        digest: meta.digest,
        pv: ranked.pv,
      });
    }

    const stats: PubViewStats = { totalPv, entries };
    if (totalPv > 0) {
      await this.redis.setex(cacheKey, CACHE_TTL_SECONDS, JSON.stringify(stats));
    }
    return stats;
  }

  async getRankingEntries(ownerId: string, limit: number): Promise<PubViewRankEntry[]> {
    if (!Number.isInteger(limit) || limit <= 0) return [];
    const ranking = await this.getRanking(ownerId);
    return ranking.entries.slice(0, Math.min(limit, TOP_LIMIT));
  }
}
