"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FiBell, FiMoreHorizontal } from "react-icons/fi";
import { useRouter } from "next/navigation";
import type { Notification, NotificationAnyRecord } from "@/api/models";
import {
  getNotificationFeedSince,
  markNotification,
  markAllNotifications,
} from "@/api/notifications";
import { formatDateTime } from "@/utils/format";

type Props = {
  userId: string;
  intervalMs?: number;
};

type SlotInfo =
  | { kind: "follow" }
  | { kind: "like"; postId: string }
  | { kind: "reply"; postId?: string };

function parseSlot(slot: string): SlotInfo {
  if (slot === "follow") return { kind: "follow" };
  const [k, v] = slot.split(":");
  if (k === "like" && v) return { kind: "like", postId: v };
  if (k === "reply") return { kind: "reply", postId: v || undefined };
  return { kind: "follow" };
}

function pickLatestRecord(records: NotificationAnyRecord[]): NotificationAnyRecord | null {
  if (!records || records.length === 0) return null;
  return records.reduce((a, b) => (a.ts >= b.ts ? a : b));
}

function computeLatestUpdatedAt(arr: Notification[]): string | null {
  let m: string | null = null;
  for (const n of arr) if (!m || n.updatedAt > m) m = n.updatedAt;
  return m;
}

type PossibleNick = { userNickname?: string };
function uniqueTopNicknames(n: Notification, max = 3): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const r of n.records) {
    if (!seen.has(r.userId)) {
      seen.add(r.userId);
      const nick = (r as PossibleNick).userNickname ?? r.userId;
      out.push(nick);
      if (out.length >= max) break;
    }
  }
  return out;
}

export default function NotificationBell({ userId, intervalMs = 30_000 }: Props) {
  const [open, setOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [feed, setFeed] = useState<Notification[]>([]);
  const [error, setError] = useState<string | null>(null);

  const router = useRouter();
  const anchorRef = useRef<HTMLDivElement | null>(null);
  const latestRef = useRef<string | null>(null);

  const unreadCount = useMemo(() => feed.filter((n) => !n.isRead).length, [feed]);
  const unreadBadge = unreadCount >= 100 ? "99+" : String(unreadCount);
  const filtered = useMemo(
    () => (unreadOnly ? feed.filter((n) => !n.isRead) : feed),
    [feed, unreadOnly],
  );

  const fetchFull = useCallback(async () => {
    try {
      setError(null);
      const res = await getNotificationFeedSince(undefined);
      const next = Array.isArray(res.data) ? res.data : [];
      setFeed(next);
      latestRef.current = computeLatestUpdatedAt(next);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  const pollRefresh = useCallback(async () => {
    try {
      const newerThan = latestRef.current ?? undefined;
      const { changed, data } = await getNotificationFeedSince(newerThan);
      if (!changed) return;
      const next = Array.isArray(data) ? data : [];
      setFeed(next);
      latestRef.current = computeLatestUpdatedAt(next);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    fetchFull();
    let timer: ReturnType<typeof setInterval> | null = null;
    const start = () => {
      if (!timer) timer = setInterval(() => pollRefresh(), intervalMs);
    };
    const stop = () => {
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
    };
    if (document.visibilityState === "visible") start();
    const onVis = () =>
      document.visibilityState === "visible" ? (pollRefresh(), start()) : stop();
    document.addEventListener("visibilitychange", onVis);
    return () => {
      stop();
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [fetchFull, pollRefresh, intervalMs]);

  useEffect(() => {
    const base = "fakebook";
    document.title = unreadCount > 0 ? `${base} (${unreadBadge})` : base;
  }, [unreadCount, unreadBadge]);

  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      const t = e.target as Node;
      if (!anchorRef.current) return;
      if (!anchorRef.current.contains(t)) {
        setOpen(false);
        setMenuOpen(false);
      }
    }
    document.addEventListener("click", onDocClick);
    return () => document.removeEventListener("click", onDocClick);
  }, []);

  const handleCardClick = useCallback(
    async (n: Notification) => {
      const slotInfo = parseSlot(n.slot);
      let target = "/";

      if (slotInfo.kind === "follow") {
        target = `/users/${userId}?tab=followers`;
      } else if (slotInfo.kind === "like") {
        if (slotInfo.postId) target = `/posts/${slotInfo.postId}`;
      } else if (slotInfo.kind === "reply") {
        const rootPostId = slotInfo.postId;
        if (rootPostId) target = `/posts/${rootPostId}`;
      }

      setFeed((prev) =>
        prev.map((x) => (x.slot === n.slot && x.term === n.term ? { ...x, isRead: true } : x)),
      );

      try {
        await markNotification({ slot: n.slot, term: n.term, isRead: true });
      } catch {
        setFeed((prev) =>
          prev.map((x) =>
            x.slot === n.slot && x.term === n.term ? { ...x, isRead: n.isRead } : x,
          ),
        );
      } finally {
        setOpen(false);
        setMenuOpen(false);
        router.push(target);
      }
    },
    [router, userId],
  );

  const onMarkAllRead = useCallback(async () => {
    try {
      await markAllNotifications({ isRead: true });
      setFeed((prev) => prev.map((x) => ({ ...x, isRead: true })));
    } finally {
      setMenuOpen(false);
    }
  }, [userId]);

  const onMarkAllUnread = useCallback(async () => {
    try {
      await markAllNotifications({ isRead: false });
      setFeed((prev) => prev.map((x) => ({ ...x, isRead: false })));
    } finally {
      setMenuOpen(false);
    }
  }, [userId]);

  return (
    <div className="relative" ref={anchorRef}>
      <button
        className={`p-2 rounded hover:bg-gray-200 cursor-pointer relative ${open ? "bg-gray-100" : ""}`}
        aria-label="Notifications"
        onClick={() => setOpen((v) => !v)}
      >
        <FiBell size={22} />
        {unreadCount > 0 && (
          <span
            className="absolute bottom-0 right-0 text-[10px] leading-none px-1.5 py-0.5 rounded-full bg-red-600 text-white font-bold"
            title={`${unreadCount} unread`}
          >
            {unreadBadge}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute -right-5 top-full mt-2 w-[380px] max-h-[70vh] overflow-auto bg-white border rounded shadow-lg z-50">
          <div className="flex items-center justify-between px-3 py-2 border-b bg-gray-50 sticky top-0">
            <div className="flex gap-1">
              <button
                className={`px-3 py-1 rounded text-sm cursor-pointer ${
                  !unreadOnly
                    ? "bg-blue-100 text-gray-800"
                    : "bg-blue-50 text-gray-500 hover:bg-blue-100"
                }`}
                onClick={() => setUnreadOnly(false)}
              >
                All
              </button>
              <button
                className={`px-3 py-1 rounded text-sm cursor-pointer ${
                  unreadOnly
                    ? "bg-blue-100 text-gray-800"
                    : "bg-blue-50 text-gray-500 hover:bg-blue-100"
                }`}
                onClick={() => setUnreadOnly(true)}
              >
                Unread
              </button>
            </div>

            <div className="relative">
              <button
                className="p-2 rounded hover:bg-gray-200 cursor-pointer"
                aria-label="More"
                onClick={() => setMenuOpen((v) => !v)}
              >
                <FiMoreHorizontal size={18} />
              </button>
              {menuOpen && (
                <div className="absolute right-0 mt-1 bg-white border rounded shadow z-50 min-w-[180px]">
                  <button
                    className="block w-full text-left px-4 py-2 text-sm hover:bg-gray-100"
                    onClick={onMarkAllRead}
                  >
                    Mark all as read
                  </button>
                  <button
                    className="block w-full text-left px-4 py-2 text-sm hover:bg-gray-100"
                    onClick={onMarkAllUnread}
                  >
                    Mark all as unread
                  </button>
                </div>
              )}
            </div>
          </div>

          {error && <div className="px-4 py-2 text-sm text-red-600">{error}</div>}

          {filtered.length === 0 ? (
            <div className="px-4 py-6 text-sm text-gray-500">No notifications.</div>
          ) : (
            <ul className="divide-y">
              {filtered.map((n) => {
                const slotInfo = parseSlot(n.slot);
                const latest = pickLatestRecord(n.records);
                const countUsers = n.countUsers ?? n.records.filter((r) => "userId" in r).length;
                const countPosts = n.countPosts ?? n.records.filter((r) => "postId" in r).length;

                let title = "";
                if (slotInfo.kind === "follow") {
                  title = `${countUsers} new follower${countUsers === 1 ? "" : "s"}`;
                } else if (slotInfo.kind === "like") {
                  title = `${countUsers} like${countUsers === 1 ? "" : "s"} on your post`;
                } else if (slotInfo.kind === "reply") {
                  title = `${countPosts} repl${countPosts === 1 ? "y" : "ies"} to your post`;
                }

                const names = uniqueTopNicknames(n, 3);
                const label = slotInfo.kind === "follow" ? "" : "by ";

                return (
                  <li key={`${n.slot}:${n.term}`}>
                    <button
                      className={`w-full text-left px-4 py-3 cursor-pointer hover:bg-gray-50 ${
                        !n.isRead ? "bg-orange-50/70" : ""
                      }`}
                      onClick={() => handleCardClick(n)}
                    >
                      <div className="flex items-start gap-2">
                        <div className="mt-1 w-2 h-2 flex-shrink-0">
                          {!n.isRead ? (
                            <span className="block w-2 h-2 rounded-full bg-blue-500" />
                          ) : null}
                        </div>

                        <div className="min-w-0">
                          <div className="font-medium text-gray-900 truncate">{title}</div>

                          {names.length > 0 && (
                            <div
                              className="text-[13px] text-gray-700 whitespace-nowrap overflow-hidden text-ellipsis"
                              title={`${label}${names.join(", ")}`}
                            >
                              {label}
                              {names.join(", ")}
                            </div>
                          )}

                          <div className="text-xs text-gray-500 mt-0.5">
                            {n.term}
                            {latest ? ` • ${formatDateTime(new Date(latest.ts * 1000))}` : ""}
                          </div>
                        </div>
                      </div>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
