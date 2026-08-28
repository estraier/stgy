export const MINUTE_HASH_HEADER = "X-STGY-MinuteHash";

export function formatUtcMinute(date: Date): string {
  const year = String(date.getUTCFullYear()).padStart(4, "0");
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  const hour = String(date.getUTCHours()).padStart(2, "0");
  const minute = String(date.getUTCMinutes()).padStart(2, "0");
  return `${year}${month}${day}${hour}${minute}`;
}

export async function makeMinuteHash(date = new Date()): Promise<string> {
  const bytes = new TextEncoder().encode(formatUtcMinute(date));
  const digest = await crypto.subtle.digest("SHA-1", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function makeMinuteHashHeaders(date = new Date()): Promise<Record<string, string>> {
  return { [MINUTE_HASH_HEADER]: await makeMinuteHash(date) };
}
