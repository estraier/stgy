export function parsePostSearchQuery(q: string): {
  query?: string;
  tag?: string;
  ownedBy?: string;
} {
  if (!q) return {};
  const ESC_QUOTE = "\uFFF1";
  const ESC_SPACE = "\uFFF0";
  let s = q.replace(/\\"/g, ESC_QUOTE);
  s = s.replace(/"([^"]*)"/g, (m, group1) => {
    return '"' + group1.replace(/ /g, ESC_SPACE) + '"';
  });
  const tokens = s.split(/\s+/).filter(Boolean);
  let tag: string | undefined;
  let ownedBy: string | undefined;
  const queryParts: string[] = [];
  for (let token of tokens) {
    token = token.replace(new RegExp(ESC_SPACE, "g"), " ");
    const isQuoted = token.startsWith('"') && token.endsWith('"') && token.length >= 2;
    let content = isQuoted ? token.slice(1, -1) : token;
    content = content.replace(/\s+/g, " ").trim();
    const decodedContent = content.replace(new RegExp(ESC_QUOTE, "g"), '"');
    if (!decodedContent) continue;
    if (!tag && decodedContent.startsWith("#") && decodedContent.length > 1) {
      tag = decodedContent.slice(1);
      continue;
    }
    if (!ownedBy && decodedContent.startsWith("@") && decodedContent.length > 1) {
      ownedBy = decodedContent.slice(1);
      continue;
    }
    if (
      (decodedContent.startsWith("\\#") || decodedContent.startsWith("\\@")) &&
      decodedContent.length >= 2
    ) {
      const unescaped = decodedContent.slice(1);
      queryParts.push(isQuoted ? '"' + unescaped + '"' : unescaped);
      continue;
    }
    queryParts.push(isQuoted ? '"' + decodedContent + '"' : decodedContent);
  }
  const query = queryParts.length > 0 ? queryParts.join(" ") : undefined;
  return {
    ...(query ? { query } : {}),
    ...(tag ? { tag } : {}),
    ...(ownedBy ? { ownedBy } : {}),
  };
}

export function serializePostSearchQuery(params: {
  query?: string;
  tag?: string;
  ownedBy?: string;
}): string {
  const tokens: string[] = [];
  if (params.query) {
    const parts = params.query.match(/("[^"]*"|[^\s]+)/g) || [];
    for (let p of parts) {
      if (!p.startsWith('"') && (p.startsWith("#") || p.startsWith("@"))) {
        p = "\\" + p;
      }
      tokens.push(p);
    }
  }
  if (params.tag) {
    const tag = params.tag.replace(/"/g, '\\"');
    tokens.push(tag.match(/\s/) ? '"#' + tag + '"' : "#" + tag);
  }
  if (params.ownedBy) {
    const owned = params.ownedBy.replace(/"/g, '\\"');
    tokens.push(owned.match(/\s/) ? '"@' + owned + '"' : "@" + owned);
  }
  return tokens.join(" ");
}

export function parseUserSearchQuery(q: string): {
  query?: string;
  nickname?: string;
} {
  if (!q) return {};
  const ESC_QUOTE = "\uFFF1";
  const ESC_SPACE = "\uFFF0";
  let s = q.replace(/\\"/g, ESC_QUOTE);
  s = s.replace(/"([^"]*)"/g, (m, group1) => {
    return '"' + group1.replace(/ /g, ESC_SPACE) + '"';
  });
  const tokens = s.split(/\s+/).filter(Boolean);
  let nickname: string | undefined;
  const queryParts: string[] = [];
  for (let token of tokens) {
    token = token.replace(new RegExp(ESC_SPACE, "g"), " ");
    const isQuoted = token.startsWith('"') && token.endsWith('"') && token.length >= 2;
    let content = isQuoted ? token.slice(1, -1) : token;
    content = content.replace(/\s+/g, " ").trim();
    const decodedContent = content.replace(new RegExp(ESC_QUOTE, "g"), '"');
    if (!decodedContent) continue;
    if (!nickname && decodedContent.startsWith("@") && decodedContent.length > 1) {
      nickname = decodedContent.slice(1);
      continue;
    }
    if (decodedContent.startsWith("\\@") && decodedContent.length >= 2) {
      const unescaped = decodedContent.slice(1);
      queryParts.push(isQuoted ? '"' + unescaped + '"' : unescaped);
      continue;
    }
    queryParts.push(isQuoted ? '"' + decodedContent + '"' : decodedContent);
  }
  const query = queryParts.length > 0 ? queryParts.join(" ") : undefined;
  return {
    ...(query ? { query } : {}),
    ...(nickname ? { nickname } : {}),
  };
}

export function serializeUserSearchQuery(params: { query?: string; nickname?: string }): string {
  const tokens: string[] = [];
  if (params.query) {
    const parts = params.query.match(/("[^"]*"|[^\s]+)/g) || [];
    for (let p of parts) {
      if (!p.startsWith('"') && (p.startsWith("#") || p.startsWith("@"))) {
        p = "\\" + p;
      }
      tokens.push(p);
    }
  }
  if (params.nickname) {
    const nick = params.nickname.replace(/"/g, '\\"');
    tokens.push(nick.match(/\s/) ? '"@' + nick + '"' : "@" + nick);
  }
  return tokens.join(" ");
}

export function parseBodyAndTags(body: string): {
  content: string;
  tags: string[];
  attrs: Record<string, string | number | boolean>;
} {
  const lines = body.split(/\r?\n/);
  const reverseLines: string[] = [];
  const tagLines: string[] = [];
  for (let i = lines.length - 1; i >= 0; --i) {
    const line = lines[i];
    if (line) {
      if (reverseLines.length === 0 && /^#[^#\s]/.test(line)) {
        tagLines.push(line);
      } else {
        reverseLines.push(line);
      }
    } else if (reverseLines.length > 0) {
      reverseLines.push(line);
    }
  }
  const bodyLines = reverseLines.reverse();
  const collectedTags: string[] = [];
  const uniqueTags = new Set<string>();
  for (let tagLine of tagLines) {
    tagLine = tagLine.replace(/^#/, "");
    for (let tag of tagLine.split(/, *#/g)) {
      tag = tag.replace(/\s+/g, " ").trim();
      if (tag && !uniqueTags.has(tag)) {
        collectedTags.push(tag);
        uniqueTags.add(tag);
      }
    }
  }
  const attrs: Record<string, string | number | boolean> = {};
  const tags: string[] = [];
  for (const t of collectedTags) {
    const localeMatch = t.match(/^\[locale=(.*)\]$/);
    if (localeMatch) {
      attrs.locale = localeMatch[1];
    } else if (t === "[nolikes]") {
      attrs.noLikes = true;
    } else if (t === "[noreplies]") {
      attrs.noReplies = true;
    } else {
      tags.push(t);
    }
  }
  const content = bodyLines.join("\n");
  return { content, tags, attrs };
}

export function parseDateString(str: string): Date | null {
  const raw = str.trim();
  if (!raw) return null;
  const makeUtcMillis = (
    year: number,
    month: number,
    day: number,
    hour: number,
    minute: number,
    second: number,
    ms: number,
  ): number => {
    const d = new Date(0);
    d.setUTCFullYear(year, month - 1, day);
    d.setUTCHours(hour, minute, second, ms);
    return d.getTime();
  };
  const yearOnlyMatch = /^(\d{1,5})$/.exec(raw);
  if (yearOnlyMatch) {
    const year = parseInt(yearOnlyMatch[1], 10);
    if (!Number.isFinite(year)) return null;
    const ms = makeUtcMillis(year, 1, 1, 0, 0, 0, 0);
    if (!Number.isFinite(ms)) return null;
    const d = new Date(ms);
    if (Number.isNaN(d.getTime())) return null;
    return d;
  }
  const normalized = raw
    .replace(/[年月日時分秒]$/g, "")
    .replace(/^(\d+年\d+月\d+日)(\d)/g, "$1 $2")
    .replace(/年/g, "-")
    .replace(/月/g, "-")
    .replace(/日/g, "")
    .replace(/時/g, ":")
    .replace(/分/g, ":")
    .replace(/秒/g, "");
  const re =
    /^(\d{4})(?:[\/-](\d{1,2})(?:[\/-](\d{1,2}))?)?(?:[ T](\d{1,2})(?:[:\-](\d{1,2})(?:[:\-](\d{1,2})(?:[.,．](\d{1,6}))?)?)?)?(?:\s*(Z|[+\-]\d{2}(?::?\d{2})?))?$/;
  const m = re.exec(normalized);
  if (!m) {
    const d = new Date(raw);
    if (Number.isNaN(d.getTime())) return null;
    return d;
  }
  const parseIntSafe = (v: string | undefined): number => parseInt(v ?? "", 10);
  const isLeapYear = (y: number): boolean => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
  const daysInMonth = (y: number, m: number): number => {
    if (m === 2) return isLeapYear(y) ? 29 : 28;
    if (m === 4 || m === 6 || m === 9 || m === 11) return 30;
    return 31;
  };
  const parseOffsetMinutes = (tz: string): number | null => {
    if (tz === "Z") return 0;
    const signChar = tz[0];
    if (signChar !== "+" && signChar !== "-") return null;
    const rest = tz.slice(1);
    let hStr: string;
    let mStr = "00";
    if (rest.includes(":")) {
      const parts = rest.split(":");
      if (parts.length !== 2) return null;
      hStr = parts[0] ?? "";
      mStr = parts[1] ?? "";
    } else if (rest.length === 2) {
      hStr = rest;
    } else if (rest.length === 4) {
      hStr = rest.slice(0, 2);
      mStr = rest.slice(2);
    } else {
      return null;
    }
    if (!/^\d{2}$/.test(hStr) || !/^\d{2}$/.test(mStr)) return null;
    const h = parseInt(hStr, 10);
    const m = parseInt(mStr, 10);
    if (h < 0 || h > 23 || m < 0 || m > 59) return null;
    const total = h * 60 + m;
    return signChar === "-" ? -total : total;
  };
  const year = parseIntSafe(m[1]);
  let month = 1;
  let day = 1;
  let hour = 0;
  let minute = 0;
  let second = 0;
  let ms = 0;
  if (m[2]) month = parseIntSafe(m[2]);
  if (m[3]) day = parseIntSafe(m[3]);
  if (m[4]) hour = parseIntSafe(m[4]);
  if (m[5]) minute = parseIntSafe(m[5]);
  if (m[6]) second = parseIntSafe(m[6]);
  if (m[7]) {
    let frac = m[7];
    while (frac.length < 3) frac += "0";
    ms = parseIntSafe(frac.slice(0, 3));
  }
  if (
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > daysInMonth(year, month) ||
    hour < 0 ||
    hour > 23 ||
    minute < 0 ||
    minute > 59 ||
    second < 0 ||
    second > 59 ||
    ms < 0 ||
    ms > 999
  ) {
    return null;
  }
  let offsetMinutes = 0;
  const tzRaw = m[8];
  if (tzRaw) {
    const off = parseOffsetMinutes(tzRaw);
    if (off === null) return null;
    offsetMinutes = off;
  }
  const utcMillis = makeUtcMillis(year, month, day, hour, minute, second, ms);
  if (!Number.isFinite(utcMillis)) return null;
  const finalMillis = utcMillis - offsetMinutes * 60 * 1000;
  const d = new Date(finalMillis);
  if (Number.isNaN(d.getTime())) return null;
  return d;
}
