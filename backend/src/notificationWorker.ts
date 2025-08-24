import { Client } from "pg";
import { Config } from "./config";
import { IdIssueService } from "./services/idIssue";
import type { AnyEventPayload } from "./models/eventLog";

function makePg(): Client {
  return new Client({
    host: Config.DATABASE_HOST,
    port: Config.DATABASE_PORT,
    user: Config.DATABASE_USER,
    password: Config.DATABASE_PASSWORD,
    database: Config.DATABASE_NAME,
  });
}

function eventMsFromId(eventId: string | bigint): number {
  const big = typeof eventId === "bigint" ? eventId : BigInt(eventId);
  return IdIssueService.bigIntToDate(big).getTime();
}

function isoDateUTC(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

type UserRecord = { userId: string; ts: number };
type PostRecord = { userId: string; postId: string; ts: number };
type NotificationRecord = UserRecord | PostRecord;
type NotificationPayload = { countUsers: number; countPosts: number; records: NotificationRecord[] };

function slotOf(payload: AnyEventPayload): { slot: string } {
  switch (payload.type) {
    case "follow":
      return { slot: "follow" };
    case "like":
      return { slot: `like:${payload.postId}` };
    case "reply":
      return { slot: `reply:${payload.replyToPostId}` };
  }
}

async function resolveRecipientUserId(pg: Client, payload: AnyEventPayload): Promise<string | null> {
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

function makeEntry(payload: AnyEventPayload, ts: number): NotificationRecord | null {
  if (payload.type === "follow") return { userId: payload.followerId, ts };
  if (payload.type === "like") return { userId: payload.userId, postId: payload.postId, ts };
  if (payload.type === "reply") return { userId: payload.userId, postId: payload.postId, ts };
  return null;
}

const keyOf = (r: NotificationRecord) => ("postId" in r ? `${r.userId}|${r.postId}` : r.userId);
const isReplySlot = (slot: string) => slot.startsWith("reply:");

function parsePayload(raw: unknown): NotificationPayload {
  const obj = (raw ?? {}) as any;
  const countUsers = typeof obj.countUsers === "number" ? obj.countUsers : 0;
  const countPosts = typeof obj.countPosts === "number" ? obj.countPosts : 0;
  const recordsIn = Array.isArray(obj.records) ? obj.records : [];
  const records: NotificationRecord[] = [];
  for (const r of recordsIn) {
    if (!r || typeof r !== "object") continue;
    const ts = typeof (r as any).ts === "number" ? (r as any).ts : 0;
    const userId = typeof (r as any).userId === "string" ? (r as any).userId : null;
    const postId =
      "postId" in (r as any) && typeof (r as any).postId === "string" ? (r as any).postId : null;
    if (userId && postId) records.push({ userId, postId, ts });
    else if (userId) records.push({ userId, ts });
  }
  return { countUsers, countPosts, records };
}

function dedupeAndCap(records: NotificationRecord[], cap: number): NotificationRecord[] {
  const byKey = new Map<string, NotificationRecord>();
  for (const r of records) {
    const k = keyOf(r);
    const prev = byKey.get(k);
    if (!prev || r.ts >= prev.ts) byKey.set(k, r);
  }
  let deduped = Array.from(byKey.values());
  deduped.sort((a, b) => b.ts - a.ts);
  if (deduped.length > cap) deduped = deduped.slice(0, cap);
  return deduped;
}

async function upsertNotification(
  pg: Client,
  userId: string,
  slot: string,
  dayISO: string,
  updatedAtMs: number,
  entry: NotificationRecord,
): Promise<void> {
  const sel = await pg.query<{ payload: unknown }>(
    `SELECT payload
       FROM notifications
      WHERE user_id = $1 AND slot = $2 AND day = $3
      FOR UPDATE`,
    [userId, slot, dayISO],
  );

  const updatedAtISO = new Date(updatedAtMs).toISOString();
  const cap = Config.NOTIFICATION_PAYLOAD_RECORDS;

  if (sel.rows.length === 0) {
    console.log(`[notificationworker] inserting a new record for ${userId}`);
    const payload: NotificationPayload = {
      countUsers: 1,
      countPosts: isReplySlot(slot) && "postId" in entry ? 1 : 0,
      records: [entry],
    };
    await pg.query(
      `INSERT INTO notifications (user_id, slot, day, is_read, payload, updated_at)
       VALUES ($1, $2, $3, FALSE, $4::jsonb, $5)`,
      [userId, slot, dayISO, JSON.stringify(payload), updatedAtISO],
    );
    return;
  }

  console.log(`[notificationworker] updating ${sel.rows.length} records for ${userId}`);
  const current = parsePayload(sel.rows[0]!.payload);
  const beforeUserKeys = new Set(current.records.map((r) => r.userId));
  const isNewUser = !beforeUserKeys.has(entry.userId);

  let isNewPost = false;
  if (isReplySlot(slot) && "postId" in entry) {
    const beforePostIds = new Set(
      current.records.filter((r): r is PostRecord => "postId" in r).map((r) => r.postId),
    );
    isNewPost = !beforePostIds.has(entry.postId);
  }

  const nextRecords = dedupeAndCap([...current.records, entry], cap);
  const nextPayload: NotificationPayload = {
    countUsers: current.countUsers + (isNewUser ? 1 : 0),
    countPosts: current.countPosts + (isNewPost ? 1 : 0),
    records: nextRecords,
  };

  await pg.query(
    `UPDATE notifications
        SET is_read = FALSE,
            payload = $4::jsonb,
            updated_at = $5
      WHERE user_id = $1 AND slot = $2 AND day = $3`,
    [userId, slot, dayISO, JSON.stringify(nextPayload), updatedAtISO],
  );
}

const CONSUMER = "notification";

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
  await pg.query("BEGIN");
  try {
    const cursor = await loadCursor(pg, partitionId);
    const batch = await fetchBatch(pg, partitionId, cursor);
    if (batch.length === 0) {
      await pg.query("COMMIT");
      return 0;
    }
    let last = cursor;
    for (const row of batch) {
      const eid = BigInt(row.event_id);
      const payload = row.payload;
      const recipient = await resolveRecipientUserId(pg, payload);
      if (!recipient) {
        last = eid;
        continue;
      }
      const { slot } = slotOf(payload);
      const ms = eventMsFromId(eid);
      const day = isoDateUTC(ms);
      const entry = makeEntry(payload, ms);
      if (!entry) {
        last = eid;
        continue;
      }
      await upsertNotification(pg, recipient, slot, day, ms, entry);
      last = eid;
    }
    await saveCursor(pg, partitionId, last);
    await pg.query("COMMIT");
    return batch.length;
  } catch (e) {
    await pg.query("ROLLBACK");
    throw e;
  }
}

function assignedPartitions(workerIndex: number): number[] {
  const out: number[] = [];
  for (let p = 0; p < Config.EVENT_LOG_PARTITIONS; p++) {
    if (p % Config.NOTIFICATION_WORKERS === workerIndex) out.push(p);
  }
  return out;
}

async function runWorker(workerIndex: number): Promise<void> {
  console.log(`[notificationworker] worker ${workerIndex} started`);
  const pg = makePg();
  await pg.connect();
  const parts = assignedPartitions(workerIndex);
  for (;;) {
    for (const p of parts) {
      try {
        await processPartition(pg, p);
      } catch {
        await new Promise((r) => setTimeout(r, 250));
      }
    }
    await new Promise((r) => setTimeout(r, 500));
  }
}

async function main(): Promise<void> {
  const runners: Promise<void>[] = [];
  for (let i = 0; i < Config.NOTIFICATION_WORKERS; i++) {
    runners.push(runWorker(i));
  }
  await Promise.all(runners);
}

main().catch((e) => {
  console.log("[notificationworker] Fatal error:", e);
  process.exit(1);
});
