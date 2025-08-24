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
    const ts = typeof rec.ts === "number" ? rec.ts / 1000 : undefined;
    const postId = typeof rec.postId === "string" ? rec.postId : undefined;
    if (!userId || ts === undefined) continue;
    if (postId) {
      records.push({ userId, postId, ts } as unknown as NotificationPostRecord);
    } else {
      records.push({ userId, ts } as unknown as NotificationUserRecord);
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

async function hydrateUserNicknames(pg: Client, list: Notification[]): Promise<Notification[]> {
  const ids = new Set<string>();
  for (const n of list) for (const r of n.records) ids.add(r.userId);
  if (ids.size === 0) return list;
  const idArr = Array.from(ids);
  const res = await pg.query<{ id: string; nickname: string }>(
    `SELECT id, nickname FROM users WHERE id = ANY($1::text[])`,
    [idArr],
  );
  const map = new Map(res.rows.map((r) => [r.id, r.nickname]));
  return list.map((n) => ({
    ...n,
    records: n.records.map((r) => {
      const userNickname = map.get(r.userId) ?? "";
      return { ...r, userNickname } as NotificationAnyRecord;
    }),
  }));
}

export class NotificationService {
  constructor(private readonly pg: Client) {}

  async listFeed(userId: string, opts?: { newerThan?: Date }): Promise<Notification[] | null> {
    if (opts?.newerThan) {
      const exists = await this.pg.query(
        `SELECT 1
           FROM notifications
          WHERE user_id = $1
            AND updated_at > $2
          LIMIT 1`,
        [userId, opts.newerThan],
      );
      if (exists.rowCount === 0) return null;
    }
    const unreadRes = await this.pg.query<Row>(
      `SELECT slot, term, is_read, payload, updated_at, created_at
         FROM notifications
        WHERE user_id = $1 AND is_read = FALSE
        ORDER BY updated_at DESC
        LIMIT $2`,
      [userId, Config.NOTIFICATION_SHOWN_RECORDS],
    );
    const readRes = await this.pg.query<Row>(
      `SELECT slot, term, is_read, payload, updated_at, created_at
         FROM notifications
        WHERE user_id = $1 AND is_read = TRUE
        ORDER BY updated_at DESC
        LIMIT $2`,
      [userId, Config.NOTIFICATION_SHOWN_RECORDS],
    );
    const unread = unreadRes.rows.map(rowToNotification);
    const read = readRes.rows.map(rowToNotification);
    const merged = mergeByUpdatedAtDesc(unread, read);
    return hydrateUserNicknames(this.pg, merged);
  }

  async markNotification(input: MarkNotificationInput): Promise<void> {
    await this.pg.query(
      `UPDATE notifications
          SET is_read = $4
        WHERE user_id = $1 AND slot = $2 AND term = $3`,
      [input.userId, input.slot, input.term, input.isRead],
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
