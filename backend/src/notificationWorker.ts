import { Config } from "./config";
import { createLogger } from "./utils/logger";
import { Client } from "pg";
import { IdIssueService } from "./services/idIssue";
import type {
  AnyEventPayload,
  FollowEventPayload,
  LikeEventPayload,
  ReplyEventPayload,
} from "./models/eventLog";
import { connectPgWithRetry, connectRedisWithRetry } from "./utils/servers";
import { NotificationPostRecord, NotificationUserRecord } from "./models/notifications";
import { makeTextFromJsonSnippet } from "./utils/snippet";

const logger = createLogger({ file: "notificationWorker" });

async function acquireSingletonLock(): Promise<Client> {
  const pg = await connectPgWithRetry();
  const res = await pg.query<{ ok: boolean }>(
    `SELECT pg_try_advisory_lock(hashtext($1), 0) AS ok`,
    ["fakebook:notification"],
  );
  if (!res.rows[0]?.ok) {
    logger.warn("[notificationworker] another instance is running; exiting");
    await pg.end();
    process.exit(0);
  }
  return pg;
}

function eventMsFromId(eventId: string | bigint): number {
  const big = typeof eventId === "bigint" ? eventId : BigInt(eventId);
  return IdIssueService.bigIntToDate(big).getTime();
}

function formatTermInTz(ms: number, tz: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(ms));
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

function isSelfInteraction(payload: AnyEventPayload, recipientUserId: string): boolean {
  switch (payload.type) {
    case "follow":
      return payload.followerId === recipientUserId;
    case "like":
      return payload.userId === recipientUserId;
    case "reply":
      return payload.userId === recipientUserId;
  }
}

async function getUserNickname(pg: Client, userId: string): Promise<string> {
  const u = await pg.query<{ nickname: string }>(`SELECT nickname FROM users WHERE id = $1`, [
    userId,
  ]);
  return u.rows[0]?.nickname ?? "";
}

async function getPostSnippet(pg: Client, postId: string): Promise<string> {
  const pres = await pg.query<{ snippet: string }>(`SELECT snippet FROM posts WHERE id = $1`, [
    postId,
  ]);
  const snippetJson = pres.rows[0]?.snippet ?? "";
  return typeof snippetJson === "string" && snippetJson.length > 0
    ? makeTextFromJsonSnippet(snippetJson)
    : "";
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

async function upsertFollow(
  pg: Client,
  recipientUserId: string,
  term: string,
  eventMs: number,
  entry: { userId: string; ts: number },
): Promise<void> {
  const sel = await pg.query<{ payload: unknown }>(
    `SELECT payload FROM notifications
      WHERE user_id = $1 AND slot = 'follow' AND term = $2
      FOR UPDATE`,
    [recipientUserId, term],
  );
  const updatedAtISO = new Date(eventMs).toISOString();
  const cap = Config.NOTIFICATION_PAYLOAD_RECORDS;

  if (sel.rows.length === 0) {
    const nick = await getUserNickname(pg, entry.userId);
    const rec: NotificationUserRecord = { userId: entry.userId, userNickname: nick, ts: entry.ts };
    const payload: FollowPayload = { countUsers: 1, records: [rec] };
    await pg.query(
      `INSERT INTO notifications (user_id, slot, term, is_read, payload, updated_at)
       VALUES ($1, 'follow', $2, FALSE, $3::jsonb, $4)`,
      [recipientUserId, term, JSON.stringify(payload), updatedAtISO],
    );
    return;
  }

  const current = parseFollowPayload(sel.rows[0].payload);
  const existing = current.records.find((r) => r.userId === entry.userId);
  const userNickname = existing ? existing.userNickname : await getUserNickname(pg, entry.userId);
  const rec: NotificationUserRecord = { userId: entry.userId, userNickname, ts: entry.ts };
  const isNewUser = !existing;
  const nextRecords = dedupeFollow([...current.records, rec], cap);
  const nextPayload: FollowPayload = {
    countUsers:
      (current.countUsers ?? new Set(current.records.map((r) => r.userId)).size) +
      (isNewUser ? 1 : 0),
    records: nextRecords,
  };
  await pg.query(
    `UPDATE notifications
       SET is_read = FALSE, payload = $3::jsonb, updated_at = $4
     WHERE user_id = $1 AND slot = 'follow' AND term = $2`,
    [recipientUserId, term, JSON.stringify(nextPayload), updatedAtISO],
  );
}

async function upsertLike(
  pg: Client,
  recipientUserId: string,
  postId: string,
  term: string,
  eventMs: number,
  entry: { userId: string; ts: number },
): Promise<void> {
  const slot = `like:${postId}`;
  const sel = await pg.query<{ payload: unknown }>(
    `SELECT payload FROM notifications
      WHERE user_id = $1 AND slot = $2 AND term = $3
      FOR UPDATE`,
    [recipientUserId, slot, term],
  );
  const updatedAtISO = new Date(eventMs).toISOString();
  const cap = Config.NOTIFICATION_PAYLOAD_RECORDS;

  if (sel.rows.length === 0) {
    const nick = await getUserNickname(pg, entry.userId);
    const snippet = await getPostSnippet(pg, postId);
    const rec: NotificationPostRecord = {
      userId: entry.userId,
      userNickname: nick,
      postId,
      postSnippet: snippet,
      ts: entry.ts,
    };
    const payload: LikePayload = { countUsers: 1, records: [rec] };
    await pg.query(
      `INSERT INTO notifications (user_id, slot, term, is_read, payload, updated_at)
       VALUES ($1, $2, $3, FALSE, $4::jsonb, $5)`,
      [recipientUserId, slot, term, JSON.stringify(payload), updatedAtISO],
    );
    return;
  }

  const current = parseLikePayload(sel.rows[0].payload);
  const records = current.records;
  const existingUser = records.find((r) => r.userId === entry.userId);
  const userNickname = existingUser
    ? existingUser.userNickname
    : await getUserNickname(pg, entry.userId);
  const postSnippet = records[0]?.postSnippet ?? (await getPostSnippet(pg, postId));
  const rec: NotificationPostRecord = {
    userId: entry.userId,
    userNickname,
    postId,
    postSnippet,
    ts: entry.ts,
  };
  const isNewUser = !existingUser;
  const nextRecords = dedupePerPost([...records, rec], cap);
  const nextPayload: LikePayload = {
    countUsers:
      (current.countUsers ?? new Set(records.map((r) => r.userId)).size) + (isNewUser ? 1 : 0),
    records: nextRecords,
  };
  await pg.query(
    `UPDATE notifications
       SET is_read = FALSE, payload = $4::jsonb, updated_at = $5
     WHERE user_id = $1 AND slot = $2 AND term = $3`,
    [recipientUserId, slot, term, JSON.stringify(nextPayload), updatedAtISO],
  );
}

async function upsertReply(
  pg: Client,
  recipientUserId: string,
  replyToPostId: string,
  term: string,
  eventMs: number,
  entry: { userId: string; postId: string; ts: number },
): Promise<void> {
  const slot = `reply:${replyToPostId}`;
  const sel = await pg.query<{ payload: unknown }>(
    `SELECT payload FROM notifications
      WHERE user_id = $1 AND slot = $2 AND term = $3
      FOR UPDATE`,
    [recipientUserId, slot, term],
  );
  const updatedAtISO = new Date(eventMs).toISOString();
  const cap = Config.NOTIFICATION_PAYLOAD_RECORDS;

  if (sel.rows.length === 0) {
    const nick = await getUserNickname(pg, entry.userId);
    const snippet = await getPostSnippet(pg, replyToPostId);
    const rec: NotificationPostRecord = {
      userId: entry.userId,
      userNickname: nick,
      postId: entry.postId,
      postSnippet: snippet,
      ts: entry.ts,
    };
    const payload: ReplyPayload = { countUsers: 1, countPosts: 1, records: [rec] };
    await pg.query(
      `INSERT INTO notifications (user_id, slot, term, is_read, payload, updated_at)
       VALUES ($1, $2, $3, FALSE, $4::jsonb, $5)`,
      [recipientUserId, slot, term, JSON.stringify(payload), updatedAtISO],
    );
    return;
  }

  const current = parseReplyPayload(sel.rows[0].payload);
  const records = current.records;
  const existingUser = records.find((r) => r.userId === entry.userId);
  const userNickname = existingUser
    ? existingUser.userNickname
    : await getUserNickname(pg, entry.userId);
  const postSnippet = records[0]?.postSnippet ?? (await getPostSnippet(pg, replyToPostId));

  const rec: NotificationPostRecord = {
    userId: entry.userId,
    userNickname,
    postId: entry.postId,
    postSnippet,
    ts: entry.ts,
  };

  const userSet = new Set(records.map((r) => r.userId));
  const postSet = new Set(records.map((r) => r.postId));
  const isNewUser = !userSet.has(entry.userId);
  const isNewPost = !postSet.has(entry.postId);

  const nextRecords = dedupePerPost([...records, rec], cap);
  const nextPayload: ReplyPayload = {
    countUsers: (current.countUsers ?? userSet.size) + (isNewUser ? 1 : 0),
    countPosts: (current.countPosts ?? postSet.size) + (isNewPost ? 1 : 0),
    records: nextRecords,
  };
  await pg.query(
    `UPDATE notifications
       SET is_read = FALSE, payload = $4::jsonb, updated_at = $5
     WHERE user_id = $1 AND slot = $2 AND term = $3`,
    [recipientUserId, slot, term, JSON.stringify(nextPayload), updatedAtISO],
  );
}

const CONSUMER = "notification";

async function resolveRecipientUserId(
  pg: Client,
  payload: AnyEventPayload,
): Promise<string | null> {
  if (payload.type === "follow") return payload.followeeId;
  if (payload.type === "like") {
    const res = await pg.query<{ owned_by: string }>(`SELECT owned_by FROM posts WHERE id = $1`, [
      payload.postId,
    ]);
    return res.rows[0]?.owned_by ?? null;
  }
  const res = await pg.query<{ owned_by: string }>(`SELECT owned_by FROM posts WHERE id = $1`, [
    payload.replyToPostId,
  ]);
  return res.rows[0]?.owned_by ?? null;
}

async function processFollowEvent(
  pg: Client,
  recipientUserId: string,
  payload: FollowEventPayload,
  eventMs: number,
  term: string,
): Promise<void> {
  await upsertFollow(pg, recipientUserId, term, eventMs, {
    userId: payload.followerId,
    ts: Math.floor(eventMs / 1000),
  });
}

async function processLikeEvent(
  pg: Client,
  recipientUserId: string,
  payload: LikeEventPayload,
  eventMs: number,
  term: string,
): Promise<void> {
  await upsertLike(pg, recipientUserId, payload.postId, term, eventMs, {
    userId: payload.userId,
    ts: Math.floor(eventMs / 1000),
  });
}

async function processReplyEvent(
  pg: Client,
  recipientUserId: string,
  payload: ReplyEventPayload,
  eventMs: number,
  term: string,
): Promise<void> {
  await upsertReply(pg, recipientUserId, payload.replyToPostId, term, eventMs, {
    userId: payload.userId,
    postId: payload.postId,
    ts: Math.floor(eventMs / 1000),
  });
}

async function loadCursor(pg: Client, partitionId: number): Promise<bigint> {
  const res = await pg.query<{ last_event_id: string }>(
    `SELECT last_event_id
       FROM event_log_cursors
      WHERE consumer = $1 AND partition_id = $2`,
    [CONSUMER, partitionId],
  );
  if (res.rows.length === 0) {
    await pg.query(
      `INSERT INTO event_log_cursors (consumer, partition_id, last_event_id)
       VALUES ($1, $2, $3)
       ON CONFLICT (consumer, partition_id) DO NOTHING`,
      [CONSUMER, partitionId, "0"],
    );
    return BigInt(0);
  }
  return BigInt(res.rows[0].last_event_id);
}

async function saveCursor(pg: Client, partitionId: number, lastId: bigint): Promise<void> {
  await pg.query(
    `UPDATE event_log_cursors
        SET last_event_id = $3, updated_at = now()
      WHERE consumer = $1 AND partition_id = $2`,
    [CONSUMER, partitionId, lastId.toString()],
  );
}

async function fetchBatch(
  pg: Client,
  partitionId: number,
  afterId: bigint,
): Promise<Array<{ event_id: string; payload: AnyEventPayload }>> {
  const res = await pg.query<{ event_id: string; payload: AnyEventPayload }>(
    `SELECT event_id, payload
       FROM event_logs
      WHERE partition_id = $1
        AND event_id > $2::bigint
      ORDER BY event_id ASC
      LIMIT $3`,
    [partitionId, afterId.toString(), Config.NOTIFICATION_BATCH_SIZE],
  );
  return res.rows;
}

async function processPartition(pg: Client, partitionId: number): Promise<number> {
  const cursor = await loadCursor(pg, partitionId);
  const batch = await fetchBatch(pg, partitionId, cursor);
  if (batch.length === 0) {
    return 0;
  }

  logger.info(
    `[notificationworker] processing: p=${partitionId}, c=${cursor}, count=${batch.length}`,
  );

  let processed = 0;

  for (const row of batch) {
    const eid = BigInt(row.event_id);
    await pg.query("BEGIN");
    try {
      const payload = row.payload;
      const recipient = await resolveRecipientUserId(pg, payload);
      if (!recipient || isSelfInteraction(payload, recipient)) {
        await saveCursor(pg, partitionId, eid);
        await pg.query("COMMIT");
        processed++;
        continue;
      }

      const ms = eventMsFromId(eid);
      const term = formatTermInTz(ms, Config.SYSTEM_TIMEZONE);

      if (payload.type === "reply") {
        await processReplyEvent(pg, recipient, payload, ms, term);
      } else if (payload.type === "like") {
        await processLikeEvent(pg, recipient, payload, ms, term);
      } else if (payload.type === "follow") {
        await processFollowEvent(pg, recipient, payload, ms, term);
      } else {
        logger.warn(
          `[notificationworker] unknown payload type: ${(payload as { type?: string }).type}`,
        );
      }

      await saveCursor(pg, partitionId, eid);
      await pg.query("COMMIT");
      processed++;
    } catch (e) {
      await pg.query("ROLLBACK");
      throw e;
    }
  }

  return processed;
}

function assignedPartitions(workerIndex: number): number[] {
  const out: number[] = [];
  for (let p = 0; p < Config.EVENT_LOG_PARTITIONS; p++) {
    if (p % Config.NOTIFICATION_WORKERS === workerIndex) out.push(p);
  }
  return out;
}

async function drain(pg: Client, partitionId: number): Promise<void> {
  for (;;) {
    const n = await processPartition(pg, partitionId);
    if (n === 0) break;
  }
}

async function runWorker(workerIndex: number): Promise<void> {
  logger.info(`Fakebook notification worker ${workerIndex} started`);
  const pg = await connectPgWithRetry(60_000);

  const parts = assignedPartitions(workerIndex);
  for (const p of parts) {
    try {
      await drain(pg, p);
    } catch {}
  }

  const sub = await connectRedisWithRetry();
  const channel = `notifications:wake:${workerIndex}`;
  const inFlight = new Set<number>();
  const pending = new Set<number>();

  await sub.subscribe(channel);

  sub.on("message", async (_chan, msg) => {
    const p = Number.parseInt(String(msg), 10);
    if (!Number.isInteger(p)) return;
    if (!parts.includes(p)) return;
    if (inFlight.has(p)) {
      pending.add(p);
      return;
    }
    inFlight.add(p);
    (async () => {
      try {
        for (;;) {
          await drain(pg, p);
          if (!pending.delete(p)) break;
        }
      } catch {
      } finally {
        inFlight.delete(p);
      }
    })();
  });

  process.on("SIGINT", async () => {
    try {
      await sub.unsubscribe(channel);
      sub.disconnect();
      await pg.end();
    } finally {
      process.exit(0);
    }
  });
}

async function main(): Promise<void> {
  const lockConn = await acquireSingletonLock();
  const runners: Promise<void>[] = [];
  for (let i = 0; i < Config.NOTIFICATION_WORKERS; i++) {
    runners.push(runWorker(i));
  }
  await Promise.all(runners);
  await lockConn.end();
}

main().catch((e) => {
  logger.error(`[notificationworker] Fatal error: ${e}`);
  process.exit(1);
});
