import { Config } from "../config";
import { Client } from "pg";
import {
  Notification,
  NotificationAnyRecord,
  NotificationPostRecord,
  NotificationUserRecord,
  MarkAllNotificationsInput,
  MarkNotificationInput,
} from "../models/notifications";

type Row = {
  slot: string;
  day: string;
  is_read: boolean;
  payload: unknown;
  updated_at: string;
  created_at: string;
};

type ParsedPayload = {
  countUsers?: number;
  countPosts?: number;
  records: NotificationAnyRecord[];
};

function parsePayload(raw: unknown): ParsedPayload {
  const obj = (raw ?? {}) as Record<string, unknown>;
  const countUsers = typeof obj.countUsers === "number" ? obj.countUsers : undefined;
  const countPosts = typeof obj.countPosts === "number" ? obj.countPosts : undefined;
  const arr = Array.isArray((obj as { records?: unknown }).records)
    ? ((obj as { records: unknown[] }).records as unknown[])
    : [];
  const records: NotificationAnyRecord[] = [];
  for (const it of arr) {
    if (!it || typeof it !== "object") continue;
    const rec = it as Record<string, unknown>;
    const userId = typeof rec.userId === "string" ? rec.userId : undefined;
    const ts = typeof rec.ts === "number" ? rec.ts / 1000 : undefined;
    const postId = typeof rec.postId === "string" ? rec.postId : undefined;
    if (!userId || ts === undefined) continue;
    if (postId) {
      records.push({ userId, postId, ts } as NotificationPostRecord);
    } else {
      records.push({ userId, ts } as NotificationUserRecord);
    }
  }
  return { countUsers, countPosts, records };
}

function rowToNotification(r: Row): Notification {
  const p = parsePayload(r.payload);
  const updatedAtIso =
    typeof r.updated_at === "string"
      ? new Date(r.updated_at).toISOString()
      : new Date(r.updated_at).toISOString();
  const createdAtIso =
    typeof r.created_at === "string"
      ? new Date(r.created_at).toISOString()
      : new Date(r.created_at).toISOString();
  return {
    slot: r.slot,
    day: r.day,
    isRead: r.is_read,
    updatedAt: updatedAtIso,
    createdAt: createdAtIso,
    countUsers: p.countUsers,
    countPosts: p.countPosts,
    records: p.records,
  };
}

function mergeByUpdatedAtDesc(a: Notification[], b: Notification[]): Notification[] {
  let i = 0;
  let j = 0;
  const out: Notification[] = [];
  while (i < a.length && j < b.length) {
    if (a[i]!.updatedAt >= b[j]!.updatedAt) {
      out.push(a[i++]!);
    } else {
      out.push(b[j++]!);
    }
  }
  while (i < a.length) out.push(a[i++]!);
  while (j < b.length) out.push(b[j++]!);
  return out;
}

export class NotificationService {
  constructor(private readonly pg: Client) {}

  async listFeed(userId: string): Promise<Notification[]> {
    const unreadRes = await this.pg.query<Row>(
      `SELECT slot, day, is_read, payload, updated_at, created_at
         FROM notifications
        WHERE user_id = $1 AND is_read = FALSE
        ORDER BY updated_at DESC
        LIMIT $2`,
      [userId, Config.NOTIFICATION_SHOWN_RECORDS],
    );
    const readRes = await this.pg.query<Row>(
      `SELECT slot, day, is_read, payload, updated_at, created_at
         FROM notifications
        WHERE user_id = $1 AND is_read = TRUE
        ORDER BY updated_at DESC
        LIMIT $2`,
      [userId, Config.NOTIFICATION_SHOWN_RECORDS],
    );
    const unread = unreadRes.rows.map(rowToNotification);
    const read = readRes.rows.map(rowToNotification);
    return mergeByUpdatedAtDesc(unread, read);
  }

  async markNotification(input: MarkNotificationInput): Promise<void> {
    await this.pg.query(
      `UPDATE notifications
          SET is_read = $4
        WHERE user_id = $1 AND slot = $2 AND day = $3`,
      [input.userId, input.slot, input.day, input.isRead],
    );
  }

  async markAllNotifications(input: MarkAllNotificationsInput): Promise<void> {
    await this.pg.query(
      `UPDATE notifications
          SET is_read = $2
        WHERE user_id = $1
          AND is_read = $3`,
      [input.userId, input.isRead, !input.isRead],
    );
  }

  async purgeOldRecords(pg: Client): Promise<number> {
    await pg.query("BEGIN");
    try {
      await pg.query("SET LOCAL statement_timeout = 10000");
      const res = await pg.query(
        `DELETE FROM notifications
         WHERE created_at < (now() - make_interval(days => $1))`,
        [Config.NOTIFICATION_RETENTION_DAYS],
      );
      await pg.query("COMMIT");
      return res.rowCount ?? 0;
    } catch (e) {
      await pg.query("ROLLBACK");
      throw e;
    }
  }
}
