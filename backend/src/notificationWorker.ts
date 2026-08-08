import { Config } from "./config";
import { createLogger } from "./utils/logger";
import { Pool, PoolClient } from "pg";
import { IdIssueService } from "./services/idIssue";
import type { AnyEventPayload } from "./models/eventLog";
import { connectPgWithRetry, connectRedisWithRetry } from "./utils/servers";
import { NotificationPostRecord, NotificationUserRecord } from "./models/notification";
import { makeTextFromJsonSnippet } from "./utils/snippet";
import { EventLogService } from "./services/eventLog";
import { NotificationsService } from "./services/notifications";
import { hexToDec, decToHex, formatDateInTz } from "./utils/format";
import Redis from "ioredis";
import { WorkerLifecycle, runIfMain } from "./utils/workerRunner";

const logger = createLogger({ file: "notificationWorker" });
export const lifecycle = new WorkerLifecycle();
const CONSUMER = "notification";
let purgeScore = 0;
let notificationPurgeInFlight = false;

let lockPool: Pool | null = null;
let lockClient: PoolClient | null = null;
let globalPgPool: Pool | null = null;
let globalRedisSub: Redis | null = null;
let globalContext: WorkerContext | null = null;
let flushTimer: NodeJS.Timeout | null = null;
let shutdownPromise: Promise<void> | null = null;

async function acquireSingletonLock(): Promise<{ pool: Pool; client: PoolClient }> {
  const pool = await connectPgWithRetry();
  const client = await pool.connect();
  const res = await client.query<{ ok: boolean }>(
    `SELECT pg_try_advisory_lock(hashtext($1), 0) AS ok`,
    ["stgy:notification"],
  );
  if (!res.rows[0]?.ok) {
    logger.warn("[notificationworker] another instance is running; exiting");
    client.release();
    await pool.end();
    throw new Error("Singleton lock acquisition failed");
  }
  return { pool, client };
}

function eventMsFromId(eventId: string | bigint): number {
  const big = typeof eventId === "bigint" ? eventId : BigInt(eventId);
  return IdIssueService.bigIntToDate(big).getTime();
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

function eventActorUserId(payload: AnyEventPayload): string | null {
  switch (payload.type) {
    case "follow":
      return payload.followerId;
    case "like":
    case "reply":
    case "mention":
      return payload.userId;
    default:
      return null;
  }
}

function isSelfInteraction(payload: AnyEventPayload, recipientUserId: string): boolean {
  const actorUserId = eventActorUserId(payload);
  return actorUserId !== null && actorUserId === recipientUserId;
}

function dedupeFollow(records: NotificationUserRecord[], cap: number): NotificationUserRecord[] {
  const byUser = new Map<string, NotificationUserRecord>();
  for (const r of records) {
    const prev = byUser.get(r.userId);
    if (!prev || r.ts >= prev.ts) byUser.set(r.userId, r);
  }
  let arr = Array.from(byUser.values()).sort((a, b) => b.ts - a.ts);
  if (arr.length > cap) arr = arr.slice(0, cap);
  return arr;
}

function dedupePerPost(records: NotificationPostRecord[], cap: number): NotificationPostRecord[] {
  const byKey = new Map<string, NotificationPostRecord>();
  for (const r of records) {
    const k = `${r.userId}|${r.postId}`;
    const prev = byKey.get(k);
    if (!prev || r.ts >= prev.ts) byKey.set(k, r);
  }
  let arr = Array.from(byKey.values()).sort((a, b) => b.ts - a.ts);
  if (arr.length > cap) arr = arr.slice(0, cap);
  return arr;
}

type FollowPayload = { countUsers: number; records: NotificationUserRecord[] };
type LikePayload = { countUsers: number; records: NotificationPostRecord[] };
type ReplyPayload = { countUsers: number; countPosts: number; records: NotificationPostRecord[] };
type MentionPayload = { countUsers: number; countPosts: number; records: NotificationPostRecord[] };

function parseFollowPayload(raw: unknown): FollowPayload {
  const obj = isObject(raw) ? raw : {};
  const countUsers = typeof obj.countUsers === "number" ? obj.countUsers : 0;
  const arr = Array.isArray((obj as { records?: unknown }).records)
    ? ((obj as { records: unknown[] }).records as unknown[])
    : [];
  const records: NotificationUserRecord[] = [];
  for (const it of arr) {
    if (!isObject(it)) continue;
    const r = it as Record<string, unknown>;
    const userId = typeof r.userId === "string" ? r.userId : undefined;
    const userNickname = typeof r.userNickname === "string" ? r.userNickname : "";
    const ts = typeof r.ts === "number" ? r.ts : undefined;
    if (!userId || ts === undefined) continue;
    records.push({ userId, userNickname, ts });
  }
  return { countUsers, records };
}

function parseLikePayload(raw: unknown): LikePayload {
  const obj = isObject(raw) ? raw : {};
  const countUsers = typeof obj.countUsers === "number" ? obj.countUsers : 0;
  const arr = Array.isArray((obj as { records?: unknown }).records)
    ? ((obj as { records: unknown[] }).records as unknown[])
    : [];
  const records: NotificationPostRecord[] = [];
  for (const it of arr) {
    if (!isObject(it)) continue;
    const r = it as Record<string, unknown>;
    const userId = typeof r.userId === "string" ? r.userId : undefined;
    const userNickname = typeof r.userNickname === "string" ? r.userNickname : "";
    const postId = typeof r.postId === "string" ? r.postId : undefined;
    const postSnippet = typeof r.postSnippet === "string" ? r.postSnippet : "";
    const ts = typeof r.ts === "number" ? r.ts : undefined;
    if (!userId || !postId || ts === undefined) continue;
    records.push({ userId, userNickname, postId, postSnippet, ts });
  }
  return { countUsers, records };
}

function parseReplyPayload(raw: unknown): ReplyPayload {
  const obj = isObject(raw) ? raw : {};
  const countUsers = typeof obj.countUsers === "number" ? obj.countUsers : 0;
  const countPosts = typeof obj.countPosts === "number" ? obj.countPosts : 0;
  const arr = Array.isArray((obj as { records?: unknown }).records)
    ? ((obj as { records: unknown[] }).records as unknown[])
    : [];
  const records: NotificationPostRecord[] = [];
  for (const it of arr) {
    if (!isObject(it)) continue;
    const r = it as Record<string, unknown>;
    const userId = typeof r.userId === "string" ? r.userId : undefined;
    const userNickname = typeof r.userNickname === "string" ? r.userNickname : "";
    const postId = typeof r.postId === "string" ? r.postId : undefined;
    const postSnippet = typeof r.postSnippet === "string" ? r.postSnippet : "";
    const ts = typeof r.ts === "number" ? r.ts : undefined;
    if (!userId || !postId || ts === undefined) continue;
    records.push({ userId, userNickname, postId, postSnippet, ts });
  }
  return { countUsers, countPosts, records };
}

function parseMentionPayload(raw: unknown): MentionPayload {
  const obj = isObject(raw) ? raw : {};
  const countUsers = typeof obj.countUsers === "number" ? obj.countUsers : 0;
  const countPosts = typeof obj.countPosts === "number" ? obj.countPosts : 0;
  const arr = Array.isArray((obj as { records?: unknown }).records)
    ? ((obj as { records: unknown[] }).records as unknown[])
    : [];
  const records: NotificationPostRecord[] = [];
  for (const it of arr) {
    if (!isObject(it)) continue;
    const r = it as Record<string, unknown>;
    const userId = typeof r.userId === "string" ? r.userId : undefined;
    const userNickname = typeof r.userNickname === "string" ? r.userNickname : "";
    const postId = typeof r.postId === "string" ? r.postId : undefined;
    const postSnippet = typeof r.postSnippet === "string" ? r.postSnippet : "";
    const ts = typeof r.ts === "number" ? r.ts : undefined;
    if (!userId || !postId || ts === undefined) continue;
    records.push({ userId, userNickname, postId, postSnippet, ts });
  }
  return { countUsers, countPosts, records };
}

type FollowBufferEntry = { userId: string; ts: number };
type PostBufferEntry = { userId: string; postId: string; ts: number };

type BufferedFollow = {
  type: "follow";
  recipientUserId: string;
  slot: "follow";
  term: string;
  entries: Map<string, FollowBufferEntry>;
};

type BufferedLike = {
  type: "like";
  recipientUserId: string;
  slot: string;
  term: string;
  postId: string;
  entries: Map<string, FollowBufferEntry>;
};

type BufferedReply = {
  type: "reply";
  recipientUserId: string;
  slot: string;
  term: string;
  replyToPostId: string;
  entries: Map<string, PostBufferEntry>;
};

type BufferedMention = {
  type: "mention";
  recipientUserId: string;
  slot: string;
  term: string;
  postId: string;
  entries: Map<string, PostBufferEntry>;
};

type BufferedNotification = BufferedFollow | BufferedLike | BufferedReply | BufferedMention;

type PreparedEvent = {
  payload: AnyEventPayload;
  recipientUserId: string;
  eventMs: number;
  term: string;
};

type PartitionState = {
  partitionId: number;
  // This cursor may run ahead of the durable cursor while events remain buffered.
  fetchCursor: bigint | null;
  lastBufferedEventId: bigint | null;
  bufferedEventCount: number;
  firstBufferedAt: number | null;
  notifications: Map<string, BufferedNotification>;
  queue: Promise<void>;
};

type WorkerContext = {
  pgPool: Pool;
  eventLogService: EventLogService;
  notificationsService: NotificationsService;
};

const partitionStates = new Map<number, PartitionState>();

// Notification rows for one recipient can be produced by different event-log partitions.
// Serialize only flushes that touch the same recipient so updated_at remains a valid
// per-user polling watermark even when partitions are drained concurrently.
type RecipientFlushLock = {
  userId: string;
  tail: Promise<void>;
  release: () => void;
};

const recipientFlushLocks = new Map<string, Promise<void>>();
let lastNotificationUpdatedAtMs = Date.now();

async function acquireRecipientFlushLocks(
  userIds: Iterable<string>,
): Promise<() => void> {
  const uniqueUserIds = Array.from(new Set(userIds)).sort();
  const held: RecipientFlushLock[] = [];

  for (const userId of uniqueUserIds) {
    const previous = recipientFlushLocks.get(userId) ?? Promise.resolve();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const tail = previous.then(() => gate);
    recipientFlushLocks.set(userId, tail);
    await previous;
    held.push({ userId, tail, release });
  }

  return () => {
    for (let i = held.length - 1; i >= 0; i -= 1) {
      const lock = held[i]!;
      lock.release();
      if (recipientFlushLocks.get(lock.userId) === lock.tail) {
        recipientFlushLocks.delete(lock.userId);
      }
    }
  };
}

function nextNotificationUpdatedAtISO(): string {
  lastNotificationUpdatedAtMs = Math.max(Date.now(), lastNotificationUpdatedAtMs + 1);
  return new Date(lastNotificationUpdatedAtMs).toISOString();
}

function getPartitionState(partitionId: number): PartitionState {
  let state = partitionStates.get(partitionId);
  if (!state) {
    state = {
      partitionId,
      fetchCursor: null,
      lastBufferedEventId: null,
      bufferedEventCount: 0,
      firstBufferedAt: null,
      notifications: new Map(),
      queue: Promise.resolve(),
    };
    partitionStates.set(partitionId, state);
  }
  return state;
}

function enqueuePartition<T>(state: PartitionState, task: () => Promise<T>): Promise<T> {
  const run = state.queue.then(task, task);
  state.queue = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

function bufferKey(recipientUserId: string, slot: string, term: string): string {
  return `${recipientUserId}|${slot}|${term}`;
}

function replaceLatest<T extends { ts: number }>(map: Map<string, T>, key: string, value: T): void {
  const current = map.get(key);
  if (!current || value.ts >= current.ts) map.set(key, value);
}

function addPreparedEvent(state: PartitionState, event: PreparedEvent): void {
  const { payload, recipientUserId, eventMs, term } = event;
  const ts = Math.floor(eventMs / 1000);

  if (payload.type === "follow") {
    const slot = "follow" as const;
    const key = bufferKey(recipientUserId, slot, term);
    let buffered = state.notifications.get(key) as BufferedFollow | undefined;
    if (!buffered) {
      buffered = {
        type: "follow",
        recipientUserId,
        slot,
        term,
        entries: new Map(),
      };
      state.notifications.set(key, buffered);
    }
    replaceLatest(buffered.entries, payload.followerId, { userId: payload.followerId, ts });
    return;
  }

  if (payload.type === "like") {
    const slot = `like:${payload.postId}`;
    const key = bufferKey(recipientUserId, slot, term);
    let buffered = state.notifications.get(key) as BufferedLike | undefined;
    if (!buffered) {
      buffered = {
        type: "like",
        recipientUserId,
        slot,
        term,
        postId: payload.postId,
        entries: new Map(),
      };
      state.notifications.set(key, buffered);
    }
    replaceLatest(buffered.entries, payload.userId, { userId: payload.userId, ts });
    return;
  }

  if (payload.type === "reply") {
    const slot = `reply:${payload.replyToPostId}`;
    const key = bufferKey(recipientUserId, slot, term);
    let buffered = state.notifications.get(key) as BufferedReply | undefined;
    if (!buffered) {
      buffered = {
        type: "reply",
        recipientUserId,
        slot,
        term,
        replyToPostId: payload.replyToPostId,
        entries: new Map(),
      };
      state.notifications.set(key, buffered);
    }
    const entry = { userId: payload.userId, postId: payload.postId, ts };
    replaceLatest(buffered.entries, `${entry.userId}|${entry.postId}`, entry);
    return;
  }

  if (payload.type === "mention") {
    const slot = `mention:${payload.postId}`;
    const key = bufferKey(recipientUserId, slot, term);
    let buffered = state.notifications.get(key) as BufferedMention | undefined;
    if (!buffered) {
      buffered = {
        type: "mention",
        recipientUserId,
        slot,
        term,
        postId: payload.postId,
        entries: new Map(),
      };
      state.notifications.set(key, buffered);
    }
    const entry = { userId: payload.userId, postId: payload.postId, ts };
    replaceLatest(buffered.entries, `${entry.userId}|${entry.postId}`, entry);
  }
}

async function queryAiUserIds(db: Pool, userIds: ReadonlySet<string>): Promise<Set<string>> {
  if (userIds.size === 0) return new Set();
  const ids = Array.from(userIds, hexToDec);
  const res = await db.query<{ id: string }>(
    `SELECT id
       FROM users
      WHERE id = ANY($1::bigint[])
        AND ai_model IS NOT NULL`,
    [ids],
  );
  return new Set(res.rows.map((row: { id: string }) => decToHex(row.id)));
}

async function queryPostOwners(db: Pool, postIds: ReadonlySet<string>): Promise<Map<string, string>> {
  if (postIds.size === 0) return new Map();
  const ids = Array.from(postIds, hexToDec);
  const res = await db.query<{ id: string; owned_by: string }>(
    `SELECT id, owned_by
       FROM posts
      WHERE id = ANY($1::bigint[])`,
    [ids],
  );
  return new Map(res.rows.map((row: { id: string; owned_by: string }) => [decToHex(row.id), decToHex(row.owned_by)]));
}

async function queryUserTimezones(
  db: Pool,
  userIds: ReadonlySet<string>,
): Promise<Map<string, string>> {
  if (userIds.size === 0) return new Map();
  const ids = Array.from(userIds, hexToDec);
  const res = await db.query<{ id: string; timezone: string }>(
    `SELECT id, timezone
       FROM users
      WHERE id = ANY($1::bigint[])`,
    [ids],
  );
  return new Map(res.rows.map((row: { id: string; timezone: string }) => [decToHex(row.id), row.timezone]));
}

async function prepareBatch(
  db: Pool,
  rows: Array<{ event_id: string; payload: AnyEventPayload }>,
): Promise<PreparedEvent[]> {
  const actorIds = new Set<string>();
  for (const row of rows) {
    const actorUserId = eventActorUserId(row.payload);
    if (actorUserId) actorIds.add(actorUserId);
  }
  const aiUserIds = await queryAiUserIds(db, actorIds);

  const postIds = new Set<string>();
  for (const row of rows) {
    const actorUserId = eventActorUserId(row.payload);
    if (!actorUserId || aiUserIds.has(actorUserId)) continue;
    if (row.payload.type === "like") postIds.add(row.payload.postId);
    if (row.payload.type === "reply") postIds.add(row.payload.replyToPostId);
  }
  const postOwners = await queryPostOwners(db, postIds);

  const pending: Array<{
    row: { event_id: string; payload: AnyEventPayload };
    recipientUserId: string;
  }> = [];
  const recipientIds = new Set<string>();

  for (const row of rows) {
    const payload = row.payload;
    const actorUserId = eventActorUserId(payload);
    if (!actorUserId) {
      logger.warn(
        `[notificationworker] unknown payload type: ${(payload as { type?: string }).type}`,
      );
      continue;
    }
    if (aiUserIds.has(actorUserId)) continue;

    let recipientUserId: string | undefined;
    if (payload.type === "follow") recipientUserId = payload.followeeId;
    else if (payload.type === "mention") recipientUserId = payload.mentionedUserId;
    else if (payload.type === "like") recipientUserId = postOwners.get(payload.postId);
    else if (payload.type === "reply") recipientUserId = postOwners.get(payload.replyToPostId);

    if (!recipientUserId || isSelfInteraction(payload, recipientUserId)) continue;
    pending.push({ row, recipientUserId });
    recipientIds.add(recipientUserId);
  }

  const timezones = await queryUserTimezones(db, recipientIds);
  return pending.map(({ row, recipientUserId }) => {
    const eventMs = eventMsFromId(row.event_id);
    const timezone = timezones.get(recipientUserId) ?? Config.DEFAULT_TIMEZONE;
    return {
      payload: row.payload,
      recipientUserId,
      eventMs,
      term: formatDateInTz(eventMs, timezone),
    };
  });
}

async function bufferBatch(
  state: PartitionState,
  db: Pool,
  rows: Array<{ event_id: string; payload: AnyEventPayload }>,
): Promise<void> {
  if (rows.length === 0) return;
  const prepared = await prepareBatch(db, rows);
  const lastEventId = BigInt(rows[rows.length - 1].event_id);

  if (state.firstBufferedAt === null) state.firstBufferedAt = Date.now();
  state.fetchCursor = lastEventId;
  state.lastBufferedEventId = lastEventId;
  state.bufferedEventCount += rows.length;
  for (const event of prepared) addPreparedEvent(state, event);
}

async function loadNicknames(
  db: PoolClient,
  notifications: Iterable<BufferedNotification>,
): Promise<Map<string, string>> {
  const userIds = new Set<string>();
  for (const notification of notifications) {
    for (const entry of notification.entries.values()) userIds.add(entry.userId);
  }
  if (userIds.size === 0) return new Map();
  const ids = Array.from(userIds, hexToDec);
  const res = await db.query<{ id: string; nickname: string }>(
    `SELECT id, nickname
       FROM users
      WHERE id = ANY($1::bigint[])`,
    [ids],
  );
  return new Map(res.rows.map((row: { id: string; nickname: string }) => [decToHex(row.id), row.nickname]));
}

async function loadPostSnippets(
  db: PoolClient,
  notifications: Iterable<BufferedNotification>,
): Promise<Map<string, string>> {
  const postIds = new Set<string>();
  for (const notification of notifications) {
    if (notification.type === "like") postIds.add(notification.postId);
    else if (notification.type === "reply") postIds.add(notification.replyToPostId);
    else if (notification.type === "mention") postIds.add(notification.postId);
  }
  if (postIds.size === 0) return new Map();
  const ids = Array.from(postIds, hexToDec);
  const res = await db.query<{ id: string; snippet: string }>(
    `SELECT id, snippet
       FROM posts
      WHERE id = ANY($1::bigint[])`,
    [ids],
  );
  return new Map(
    res.rows.map((row: { id: string; snippet: string }) => {
      const snippet =
        typeof row.snippet === "string" && row.snippet.length > 0
          ? makeTextFromJsonSnippet(row.snippet)
          : "";
      return [decToHex(row.id), snippet];
    }),
  );
}

async function upsertFollow(
  db: PoolClient,
  notification: BufferedFollow,
  nicknames: ReadonlyMap<string, string>,
  updatedAtISO: string,
): Promise<void> {
  const sel = await db.query<{ payload: unknown }>(
    `SELECT payload::json AS payload FROM notifications
      WHERE user_id = $1 AND slot = 'follow' AND term = $2
      FOR UPDATE`,
    [hexToDec(notification.recipientUserId), notification.term],
  );
  const cap = Config.NOTIFICATION_PAYLOAD_RECORDS;
  const incoming = Array.from(notification.entries.values()).map<NotificationUserRecord>((entry) => ({
    userId: entry.userId,
    userNickname: nicknames.get(entry.userId) ?? "",
    ts: entry.ts,
  }));

  if (sel.rows.length === 0) {
    const payload: FollowPayload = {
      countUsers: new Set(incoming.map((entry) => entry.userId)).size,
      records: dedupeFollow(incoming, cap),
    };
    await db.query(
      `INSERT INTO notifications (user_id, slot, term, is_read, payload, updated_at)
       VALUES ($1, 'follow', $2, FALSE, $3, $4)`,
      [
        hexToDec(notification.recipientUserId),
        notification.term,
        JSON.stringify(payload),
        updatedAtISO,
      ],
    );
    return;
  }

  const current = parseFollowPayload(sel.rows[0].payload);
  const existingUsers = new Set(current.records.map((record) => record.userId));
  const addedUsers = new Set(
    incoming.filter((record) => !existingUsers.has(record.userId)).map((record) => record.userId),
  );
  const payload: FollowPayload = {
    countUsers: Math.max(current.countUsers, existingUsers.size) + addedUsers.size,
    records: dedupeFollow([...current.records, ...incoming], cap),
  };
  await db.query(
    `UPDATE notifications
       SET is_read = FALSE, payload = $3, updated_at = $4
     WHERE user_id = $1 AND slot = 'follow' AND term = $2`,
    [
      hexToDec(notification.recipientUserId),
      notification.term,
      JSON.stringify(payload),
      updatedAtISO,
    ],
  );
}

async function upsertLike(
  db: PoolClient,
  notification: BufferedLike,
  nicknames: ReadonlyMap<string, string>,
  snippets: ReadonlyMap<string, string>,
  updatedAtISO: string,
): Promise<void> {
  const sel = await db.query<{ payload: unknown }>(
    `SELECT payload::json AS payload FROM notifications
      WHERE user_id = $1 AND slot = $2 AND term = $3
      FOR UPDATE`,
    [hexToDec(notification.recipientUserId), notification.slot, notification.term],
  );
  const cap = Config.NOTIFICATION_PAYLOAD_RECORDS;
  const current = sel.rows.length > 0 ? parseLikePayload(sel.rows[0].payload) : null;
  const postSnippet = current?.records[0]?.postSnippet ?? snippets.get(notification.postId) ?? "";
  const incoming = Array.from(notification.entries.values()).map<NotificationPostRecord>((entry) => ({
    userId: entry.userId,
    userNickname: nicknames.get(entry.userId) ?? "",
    postId: notification.postId,
    postSnippet,
    ts: entry.ts,
  }));

  if (!current) {
    const payload: LikePayload = {
      countUsers: new Set(incoming.map((entry) => entry.userId)).size,
      records: dedupePerPost(incoming, cap),
    };
    await db.query(
      `INSERT INTO notifications (user_id, slot, term, is_read, payload, updated_at)
       VALUES ($1, $2, $3, FALSE, $4, $5)`,
      [
        hexToDec(notification.recipientUserId),
        notification.slot,
        notification.term,
        JSON.stringify(payload),
        updatedAtISO,
      ],
    );
    return;
  }

  const existingUsers = new Set(current.records.map((record) => record.userId));
  const addedUsers = new Set(
    incoming.filter((record) => !existingUsers.has(record.userId)).map((record) => record.userId),
  );
  const payload: LikePayload = {
    countUsers: Math.max(current.countUsers, existingUsers.size) + addedUsers.size,
    records: dedupePerPost([...current.records, ...incoming], cap),
  };
  await db.query(
    `UPDATE notifications
       SET is_read = FALSE, payload = $4, updated_at = $5
     WHERE user_id = $1 AND slot = $2 AND term = $3`,
    [
      hexToDec(notification.recipientUserId),
      notification.slot,
      notification.term,
      JSON.stringify(payload),
      updatedAtISO,
    ],
  );
}

async function upsertReply(
  db: PoolClient,
  notification: BufferedReply,
  nicknames: ReadonlyMap<string, string>,
  snippets: ReadonlyMap<string, string>,
  updatedAtISO: string,
): Promise<void> {
  const sel = await db.query<{ payload: unknown }>(
    `SELECT payload::json AS payload FROM notifications
      WHERE user_id = $1 AND slot = $2 AND term = $3
      FOR UPDATE`,
    [hexToDec(notification.recipientUserId), notification.slot, notification.term],
  );
  const cap = Config.NOTIFICATION_PAYLOAD_RECORDS;
  const current = sel.rows.length > 0 ? parseReplyPayload(sel.rows[0].payload) : null;
  const postSnippet =
    current?.records[0]?.postSnippet ?? snippets.get(notification.replyToPostId) ?? "";
  const incoming = Array.from(notification.entries.values()).map<NotificationPostRecord>((entry) => ({
    userId: entry.userId,
    userNickname: nicknames.get(entry.userId) ?? "",
    postId: entry.postId,
    postSnippet,
    ts: entry.ts,
  }));

  if (!current) {
    const payload: ReplyPayload = {
      countUsers: new Set(incoming.map((entry) => entry.userId)).size,
      countPosts: new Set(incoming.map((entry) => entry.postId)).size,
      records: dedupePerPost(incoming, cap),
    };
    await db.query(
      `INSERT INTO notifications (user_id, slot, term, is_read, payload, updated_at)
       VALUES ($1, $2, $3, FALSE, $4, $5)`,
      [
        hexToDec(notification.recipientUserId),
        notification.slot,
        notification.term,
        JSON.stringify(payload),
        updatedAtISO,
      ],
    );
    return;
  }

  const existingUsers = new Set(current.records.map((record) => record.userId));
  const existingPosts = new Set(current.records.map((record) => record.postId));
  const addedUsers = new Set(
    incoming.filter((record) => !existingUsers.has(record.userId)).map((record) => record.userId),
  );
  const addedPosts = new Set(
    incoming.filter((record) => !existingPosts.has(record.postId)).map((record) => record.postId),
  );
  const payload: ReplyPayload = {
    countUsers: Math.max(current.countUsers, existingUsers.size) + addedUsers.size,
    countPosts: Math.max(current.countPosts, existingPosts.size) + addedPosts.size,
    records: dedupePerPost([...current.records, ...incoming], cap),
  };
  await db.query(
    `UPDATE notifications
       SET is_read = FALSE, payload = $4, updated_at = $5
     WHERE user_id = $1 AND slot = $2 AND term = $3`,
    [
      hexToDec(notification.recipientUserId),
      notification.slot,
      notification.term,
      JSON.stringify(payload),
      updatedAtISO,
    ],
  );
}

async function upsertMention(
  db: PoolClient,
  notification: BufferedMention,
  nicknames: ReadonlyMap<string, string>,
  snippets: ReadonlyMap<string, string>,
  updatedAtISO: string,
): Promise<void> {
  const sel = await db.query<{ payload: unknown }>(
    `SELECT payload::json AS payload FROM notifications
      WHERE user_id = $1 AND slot = $2 AND term = $3
      FOR UPDATE`,
    [hexToDec(notification.recipientUserId), notification.slot, notification.term],
  );
  const cap = Config.NOTIFICATION_PAYLOAD_RECORDS;
  const current = sel.rows.length > 0 ? parseMentionPayload(sel.rows[0].payload) : null;
  const postSnippet = current?.records[0]?.postSnippet ?? snippets.get(notification.postId) ?? "";
  const incoming = Array.from(notification.entries.values()).map<NotificationPostRecord>((entry) => ({
    userId: entry.userId,
    userNickname: nicknames.get(entry.userId) ?? "",
    postId: entry.postId,
    postSnippet,
    ts: entry.ts,
  }));

  if (!current) {
    const payload: MentionPayload = {
      countUsers: new Set(incoming.map((entry) => entry.userId)).size,
      countPosts: new Set(incoming.map((entry) => entry.postId)).size,
      records: dedupePerPost(incoming, cap),
    };
    await db.query(
      `INSERT INTO notifications (user_id, slot, term, is_read, payload, updated_at)
       VALUES ($1, $2, $3, FALSE, $4, $5)`,
      [
        hexToDec(notification.recipientUserId),
        notification.slot,
        notification.term,
        JSON.stringify(payload),
        updatedAtISO,
      ],
    );
    return;
  }

  const existingUsers = new Set(current.records.map((record) => record.userId));
  const existingPosts = new Set(current.records.map((record) => record.postId));
  const addedUsers = new Set(
    incoming.filter((record) => !existingUsers.has(record.userId)).map((record) => record.userId),
  );
  const addedPosts = new Set(
    incoming.filter((record) => !existingPosts.has(record.postId)).map((record) => record.postId),
  );
  const payload: MentionPayload = {
    countUsers: Math.max(current.countUsers, existingUsers.size) + addedUsers.size,
    countPosts: Math.max(current.countPosts, existingPosts.size) + addedPosts.size,
    records: dedupePerPost([...current.records, ...incoming], cap),
  };
  await db.query(
    `UPDATE notifications
       SET is_read = FALSE, payload = $4, updated_at = $5
     WHERE user_id = $1 AND slot = $2 AND term = $3`,
    [
      hexToDec(notification.recipientUserId),
      notification.slot,
      notification.term,
      JSON.stringify(payload),
      updatedAtISO,
    ],
  );
}

async function flushPartition(context: WorkerContext, state: PartitionState): Promise<number> {
  const lastEventId = state.lastBufferedEventId;
  if (lastEventId === null || state.bufferedEventCount === 0) return 0;

  const notifications = Array.from(state.notifications.values());
  const releaseRecipientLocks = await acquireRecipientFlushLocks(
    notifications.map((notification) => notification.recipientUserId),
  );
  let client: PoolClient | null = null;
  try {
    client = await context.pgPool.connect();
    await client.query("BEGIN");
    const nicknames = await loadNicknames(client, notifications);
    const snippets = await loadPostSnippets(client, notifications);
    const updatedAtISO = nextNotificationUpdatedAtISO();

    for (const notification of notifications) {
      if (notification.type === "follow") {
        await upsertFollow(client, notification, nicknames, updatedAtISO);
      } else if (notification.type === "like") {
        await upsertLike(client, notification, nicknames, snippets, updatedAtISO);
      } else if (notification.type === "reply") {
        await upsertReply(client, notification, nicknames, snippets, updatedAtISO);
      } else {
        await upsertMention(client, notification, nicknames, snippets, updatedAtISO);
      }
    }

    await context.eventLogService.saveCursor(
      client,
      CONSUMER,
      state.partitionId,
      lastEventId,
    );
    await client.query("COMMIT");
  } catch (error) {
    if (client) {
      try {
        await client.query("ROLLBACK");
      } catch {}
    }
    throw error;
  } finally {
    client?.release();
    releaseRecipientLocks();
  }

  // Clear only after both notification updates and the durable cursor have committed.
  const committed = state.bufferedEventCount;
  state.lastBufferedEventId = null;
  state.bufferedEventCount = 0;
  state.firstBufferedAt = null;
  state.notifications.clear();
  return committed;
}

function isFlushDue(state: PartitionState, now: number = Date.now()): boolean {
  if (state.bufferedEventCount === 0) return false;
  if (state.bufferedEventCount >= Config.NOTIFICATION_BUFFER_MAX_EVENTS) return true;
  return (
    state.firstBufferedAt !== null &&
    now - state.firstBufferedAt >= Config.NOTIFICATION_BUFFER_FLUSH_MS
  );
}

async function runPostFlushMaintenance(
  context: WorkerContext,
  partitionId: number,
  committed: number,
): Promise<void> {
  if (committed <= 0) return;
  purgeScore += committed;
  try {
    await context.eventLogService.purgeOldRecords(partitionId);
  } catch (error) {
    logger.error(`[notificationworker] purge event logs error (p=${partitionId}): ${error}`);
  }

  if (purgeScore < 1000 || notificationPurgeInFlight) return;
  purgeScore = 0;
  notificationPurgeInFlight = true;
  try {
    await context.notificationsService.purgeOldRecords();
  } catch (error) {
    logger.error(`[notificationworker] purge notifications error: ${error}`);
  } finally {
    notificationPurgeInFlight = false;
  }
}

async function flushPartitionAndMaintain(
  context: WorkerContext,
  state: PartitionState,
): Promise<number> {
  const committed = await flushPartition(context, state);
  await runPostFlushMaintenance(context, state.partitionId, committed);
  return committed;
}

async function ensureFetchCursor(context: WorkerContext, state: PartitionState): Promise<void> {
  if (state.fetchCursor !== null) return;
  state.fetchCursor = await context.eventLogService.loadCursor(CONSUMER, state.partitionId);
}

async function drainPartition(context: WorkerContext, state: PartitionState): Promise<number> {
  await ensureFetchCursor(context, state);
  let read = 0;

  for (;;) {
    if (!lifecycle.isActive) break;

    if (isFlushDue(state)) {
      await flushPartitionAndMaintain(context, state);
    }
    if (state.bufferedEventCount >= Config.NOTIFICATION_BUFFER_MAX_EVENTS) break;

    const batch = await context.eventLogService.fetchBatch(
      state.partitionId,
      state.fetchCursor ?? 0n,
      Config.NOTIFICATION_BATCH_SIZE,
    );
    if (batch.length === 0) break;

    logger.info(
      `[notificationworker] buffering: p=${state.partitionId}, c=${state.fetchCursor}, count=${batch.length}`,
    );
    await bufferBatch(state, context.pgPool, batch);
    read += batch.length;

    if (isFlushDue(state)) {
      await flushPartitionAndMaintain(context, state);
    }
  }

  return read;
}

async function drain(context: WorkerContext, partitionId: number): Promise<number> {
  const state = getPartitionState(partitionId);
  return enqueuePartition(state, () => drainPartition(context, state));
}

function assignedPartitions(workerIndex: number): number[] {
  const out: number[] = [];
  for (let p = 0; p < Config.EVENT_LOG_PARTITIONS; p++) {
    if (p % Config.NOTIFICATION_WORKERS === workerIndex) out.push(p);
  }
  return out;
}

async function flushDueBuffers(context: WorkerContext): Promise<void> {
  const now = Date.now();
  const tasks: Promise<unknown>[] = [];
  for (const state of partitionStates.values()) {
    if (!isFlushDue(state, now)) continue;
    tasks.push(
      enqueuePartition(state, () => flushPartitionAndMaintain(context, state)).catch((error) => {
        logger.error(
          `[notificationworker] periodic flush error (p=${state.partitionId}): ${error}`,
        );
      }),
    );
  }
  await Promise.all(tasks);
}

async function flushAllBuffers(context: WorkerContext): Promise<void> {
  const tasks = Array.from(partitionStates.values(), (state) =>
    enqueuePartition(state, () => flushPartitionAndMaintain(context, state)).catch((error) => {
      logger.error(`[notificationworker] final flush error (p=${state.partitionId}): ${error}`);
    }),
  );
  await Promise.all(tasks);
}

async function runWorker(
  workerIndex: number,
  redisSub: Redis,
  context: WorkerContext,
): Promise<void> {
  logger.info(`STGY notification worker ${workerIndex} started`);

  const parts = assignedPartitions(workerIndex);
  for (const partitionId of parts) {
    try {
      await drain(context, partitionId);
    } catch (error) {
      logger.error(`[notificationworker] drain error: ${error}`);
    }
  }

  const channel = `notifications:wake:${workerIndex}`;
  const inFlight = new Set<number>();
  const pending = new Set<number>();

  await redisSub.subscribe(channel);

  redisSub.on("message", async (chan: string, msg: string) => {
    if (chan !== channel || !lifecycle.isActive) return;
    const partitionId = Number.parseInt(String(msg), 10);
    if (!Number.isInteger(partitionId) || !parts.includes(partitionId)) return;
    if (inFlight.has(partitionId)) {
      pending.add(partitionId);
      return;
    }
    inFlight.add(partitionId);
    void (async () => {
      try {
        for (;;) {
          if (!lifecycle.isActive) break;
          await drain(context, partitionId);
          if (!pending.delete(partitionId)) break;
        }
      } catch (error) {
        logger.error(`[notificationworker] drain error (p=${partitionId}): ${error}`);
      } finally {
        inFlight.delete(partitionId);
      }
    })();
  });
}

export async function startNotificationWorker() {
  logger.info("STGY notification worker starting");

  const { pool, client } = await acquireSingletonLock();
  lockPool = pool;
  lockClient = client;

  globalPgPool = await connectPgWithRetry(60_000);
  globalRedisSub = await connectRedisWithRetry();

  const eventLogService = new EventLogService(globalPgPool, globalRedisSub);
  const notificationsService = new NotificationsService(globalPgPool);
  globalContext = {
    pgPool: globalPgPool,
    eventLogService,
    notificationsService,
  };

  const flushInterval = Math.max(100, Math.min(1000, Config.NOTIFICATION_BUFFER_FLUSH_MS));
  flushTimer = setInterval(() => {
    if (!globalContext) return;
    void flushDueBuffers(globalContext).catch((error) => {
      logger.error(`[notificationworker] flush timer error: ${error}`);
    });
  }, flushInterval);

  const runners: Promise<void>[] = [];
  for (let i = 0; i < Config.NOTIFICATION_WORKERS; i++) {
    runners.push(runWorker(i, globalRedisSub, globalContext));
  }

  await Promise.all(runners);
  logger.info("STGY notification worker initial drain complete, listening for events.");
}

async function shutdownNotificationWorker(): Promise<void> {
  if (shutdownPromise) return shutdownPromise;
  shutdownPromise = (async () => {
    if (flushTimer) {
      clearInterval(flushTimer);
      flushTimer = null;
    }

    if (globalContext) {
      await flushAllBuffers(globalContext);
      globalContext = null;
    }

    if (globalRedisSub) {
      await globalRedisSub.quit().catch(() => {});
      globalRedisSub = null;
    }
    if (globalPgPool) {
      await globalPgPool.end().catch(() => {});
      globalPgPool = null;
    }
    if (lockClient) {
      lockClient.release();
      lockClient = null;
    }
    if (lockPool) {
      await lockPool.end().catch(() => {});
      lockPool = null;
    }
  })();
  return shutdownPromise;
}

const originalStop = lifecycle.stop.bind(lifecycle);
lifecycle.stop = async () => {
  originalStop();
  logger.info("Stopping notification worker...");
  await shutdownNotificationWorker();
};

runIfMain(module, startNotificationWorker, logger, lifecycle, shutdownNotificationWorker);
