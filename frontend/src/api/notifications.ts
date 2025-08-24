import { apiFetch, extractError } from "./client";
import type { Notification, MarkNotificationInput, MarkAllNotificationsInput } from "./models";

export async function getNotificationFeed(): Promise<Notification[]> {
  const res = await apiFetch("/notification/feed", { method: "GET" });
  if (!res.ok) throw new Error(await extractError(res));
  return res.json();
}

export async function markNotification(input: MarkNotificationInput): Promise<void> {
  const { slot, term, isRead } = input;
  const res = await apiFetch("/notification/mark", {
    method: "POST",
    body: JSON.stringify({ slot, term, isRead }),
  });
  if (!res.ok) throw new Error(await extractError(res));
}

export async function markAllNotifications(input: MarkAllNotificationsInput): Promise<void> {
  const { isRead } = input;
  const res = await apiFetch("/notification/mark-all", {
    method: "POST",
    body: JSON.stringify({ isRead }),
  });
  if (!res.ok) throw new Error(await extractError(res));
}
