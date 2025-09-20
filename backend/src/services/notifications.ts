import { Config } from "../config";
import { Pool } from "pg";
import {
  Notification,
  NotificationAnyRecord,
  MarkAllNotificationsInput,
  MarkNotificationInput,
} from "../models/notifications";
import { hexToDec } from "../utils/format";
import { pgQuery } from "../utils/servers";

type Row = {
  slot: string;
  term: string;
  is_read: boolean;
  payload: unknown;
  updated_at: unknown;
  created_at: unknown;
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
    const userNickname = typeof rec.userNickname === "string" ? rec.userNickname : "";
    const ts = typeof rec.ts === "number" ? rec.ts : undefined;
    const postId = typeof rec.postId === "string" ? rec.postId : undefined;
    const postSnippet = typeof rec.postSnippet === "string" ? rec.postSnippet : undefined;
    if (!userId || ts === undefined) continue;
    if (postId) {
      records.push({ userId, userNickname, postId, postSnippet: postSnippet ?? "", ts });
    } else {
      records.push({ userId, userNickname, ts });
    }
  }
  return { countUsers, countPosts, records };
}

function toIso(input: unknown): string {
  if (input instanceof Date) return input.toISOString();
  if (typeof input === "string" || typeof input === "number") {
    return new Date(input).toISOString();
  }
  return new Date(String(input)).toISOString();
}

function rowToNotification(r: Row): Notification {
  const p = parsePayload(r.payload);
  return {
    slot: r.slot,
    term: r.term,
    isRead: r.is_read,
    updatedAt: toIso(r.updated_at),
    createdAt: toIso(r.created_at),
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

export class NotificationsService {
  constructor(private readonly pg: Pool) {}

  async listFeed(userId: string, opts?: { newerThan?: Date }): Promise<Notification[] | null> {
    const dbUserId = hexToDec(userId);
    if (opts?.newerThan) {
      const exists = await pgQuery(
        this.pg,
        `SELECT 1
           FROM notifications
          WHERE user_id = $1 AND is_read = FALSE AND updated_at > $2
          LIMIT 1`,
        [dbUserId, opts.newerThan],
      );
      if (exists.rowCount === 0) return null;
    }
    const unreadRes = await pgQuery<Row>(
      this.pg,
      `SELECT slot, term, is_read, payload::json AS payload, updated_at, created_at
         FROM notifications
        WHERE user_id = $1 AND is_read = FALSE
        ORDER BY updated_at DESC
        LIMIT $2`,
      [dbUserId, Config.NOTIFICATION_SHOWN_RECORDS],
    );
    const readRes = await pgQuery<Row>(
      this.pg,
      `SELECT slot, term, is_read, payload::json AS payload, updated_at, created_at
         FROM notifications
        WHERE user_id = $1 AND is_read = TRUE
        ORDER BY updated_at DESC
        LIMIT $2`,
      [dbUserId, Config.NOTIFICATION_SHOWN_RECORDS],
    );
    const unread = unreadRes.rows.map(rowToNotification);
    const read = readRes.rows.map(rowToNotification);
    return mergeByUpdatedAtDesc(unread, read);
  }

  async markNotification(input: MarkNotificationInput): Promise<void> {
    await pgQuery(
      this.pg,
      `UPDATE notifications
          SET is_read = $4
        WHERE user_id = $1 AND slot = $2 AND term = $3`,
      [hexToDec(input.userId), input.slot, input.term, input.isRead],
    );
  }

  async markAllNotifications(input: MarkAllNotificationsInput): Promise<void> {
    await pgQuery(
      this.pg,
      `UPDATE notifications
          SET is_read = $2
        WHERE user_id = $1
          AND is_read = $3`,
      [hexToDec(input.userId), input.isRead, !input.isRead],
    );
  }

  async purgeOldRecords(): Promise<number> {
    await pgQuery(this.pg, "BEGIN");
    try {
      await pgQuery(this.pg, "SET LOCAL statement_timeout = 10000");
      const res = await pgQuery(
        this.pg,
        `DELETE FROM notifications
         WHERE created_at < (now() - make_interval(days => $1))`,
        [Config.NOTIFICATION_RETENTION_DAYS],
      );
      await pgQuery(this.pg, "COMMIT");
      return res.rowCount ?? 0;
    } catch (e) {
      await pgQuery(this.pg, "ROLLBACK");
      throw e;
    }
  }
}
