import crypto from "crypto";

export const MINUTE_HASH_HEADER = "X-STGY-MinuteHash";

export function formatUtcMinute(date: Date): string {
  const year = String(date.getUTCFullYear()).padStart(4, "0");
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  const hour = String(date.getUTCHours()).padStart(2, "0");
  const minute = String(date.getUTCMinutes()).padStart(2, "0");
  return `${year}${month}${day}${hour}${minute}`;
}

export function makeMinuteHash(date = new Date()): string {
  return crypto.createHash("sha1").update(formatUtcMinute(date), "utf8").digest("hex");
}

export function verifyMinuteHash(headerValue: unknown, now = new Date()): boolean {
  if (typeof headerValue !== "string") return false;
  const nowMs = now.getTime();
  return [-60_000, 0, 60_000].some(
    (offsetMs) => headerValue === makeMinuteHash(new Date(nowMs + offsetMs)),
  );
}
