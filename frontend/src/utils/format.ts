import { Config } from "@/config";

export function formatDateTime(dt: Date, timeZone?: string, showSeconds = false) {
  try {
    const fmt = new Intl.DateTimeFormat("en-US", {
      timeZone: timeZone || undefined,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    });
    const parts = fmt.formatToParts(dt);
    const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
    const y = get("year");
    const m = get("month");
    const d = get("day");
    const h = get("hour");
    const min = get("minute");
    const s = get("second");
    if (showSeconds) {
      return `${y}/${m}/${d} ${h}:${min}:${s}`;
    } else {
      return `${y}/${m}/${d} ${h}:${min}`;
    }
  } catch {
    const y = dt.getFullYear();
    const m = String(dt.getMonth() + 1).padStart(2, "0");
    const d = String(dt.getDate()).padStart(2, "0");
    const h = String(dt.getHours()).padStart(2, "0");
    const min = String(dt.getMinutes()).padStart(2, "0");
    const s = String(dt.getSeconds()).padStart(2, "0");
    if (showSeconds) {
      return `${y}/${m}/${d} ${h}:${min}:${s}`;
    } else {
      return `${y}/${m}/${d} ${h}:${min}`;
    }
  }
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let v = n / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(v >= 10 ? 0 : 1)} ${units[i]}`;
}

export function normalizeLinefeeds(str: string): string {
  if (!str) return "";
  return str
    .replace(/\r\n?/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/\n+$/, "");
}

export function makeAbsoluteUrl(url: string): string {
  let normUrl = url.trim();
  if (!/^https?:\/\//i.test(normUrl)) {
    if (!normUrl.startsWith("/")) {
      normUrl = "/" + normUrl;
    }
    normUrl = Config.FRONTEND_CANONICAL_URL + normUrl;
  }
  normUrl = normUrl.replace(/\/+$/, "/");
  try {
    return new URL(normUrl).href;
  } catch {
    return normUrl;
  }
}

export function convertToFullWidth(text: string): string {
  let result = "";
  for (const ch of text) {
    const code = ch.charCodeAt(0);
    if (code === 0x20) {
      result += "\u3000";
    } else if (code >= 0x21 && code <= 0x7e) {
      result += String.fromCharCode(code - 0x21 + 0xff01);
    } else {
      result += ch;
    }
  }
  return result;
}

export function convertForDirection(text: string, dirMode: string): string {
  if (dirMode === "vert") {
    return convertToFullWidth(text);
  }
  return text;
}
