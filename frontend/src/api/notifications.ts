import { apiFetch, extractError } from "./client";
import type { Notification, MarkNotificationInput, MarkAllNotificationsInput } from "./models";

export async function getNotificationFeedSince(
  newerThan?: string,
): Promise<{ changed: boolean; data?: Notification[] }> {
  const qs = new URLSearchParams();
  if (newerThan) qs.set("newerThan", newerThan);
  const res = await apiFetch(`/notification/feed${qs.toString() ? `?${qs}` : ""}`, {
    method: "GET",
  });
  if (res.status === 304) return { changed: false };
  if (!res.ok) throw new Error(await extractError(res));
  const data: Notification[] = await res.json();
  return { changed: true, data };
}

export async function markNotification(input: MarkNotificationInput): Promise<void> {
  const res = await apiFetch(`/notification/mark`, {
    method: "POST",
    body: JSON.stringify({
      slot: input.slot,
      term: input.term,
      isRead: input.isRead,
    }),
  });
  if (!res.ok) throw new Error(await extractError(res));
}

export async function markAllNotifications(input: MarkAllNotificationsInput): Promise<void> {
  const res = await apiFetch(`/notification/mark-all`, {
    method: "POST",
    body: JSON.stringify({ isRead: input.isRead }),
  });
  if (!res.ok) throw new Error(await extractError(res));
}
