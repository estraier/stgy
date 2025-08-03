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
    if (token.startsWith('"') && token.endsWith('"') && token.length >= 2) {
      token = token.slice(1, -1);
    }
    token = token.replace(/\s+/g, " ").trim();
    token = token.replace(new RegExp(ESC_QUOTE, "g"), '"');
    if (!token) continue;
    if (!tag && token.startsWith("#") && token.length > 1) {
      tag = token.slice(1);
      continue;
    }
    if (!ownedBy && token.startsWith("@") && token.length > 1) {
      ownedBy = token.slice(1);
      continue;
    }
    if ((token.startsWith("\#") || token.startsWith("\@")) && token.length >= 3) {
      token = token.slice(2);
    }
    queryParts.push(token);
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
  const escapeToken = (token: string): string => {
    let s = token.replace(/"/g, '\\"');
    if (s.match(/\s/)) {
      s = `"${s}"`;
    }
    return s;
  };
  if (params.query) {
    const parts = params.query.split(/\s+/).filter(Boolean);
    for (let p of parts) {
      if (p.startsWith("#") || p.startsWith("@")) {
        p = "\\" + p;
      }
      tokens.push(escapeToken(p));
    }
  }
  if (params.tag) {
    let tag = params.tag.replace(/"/g, '\\"');
    if (tag.match(/\s/)) tag = `"${tag}"`;
    tokens.push("#" + tag);
  }
  if (params.ownedBy) {
    let owned = params.ownedBy.replace(/"/g, '\\"');
    if (owned.match(/\s/)) owned = `"${owned}"`;
    tokens.push("@" + owned);
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
    if (token.startsWith('"') && token.endsWith('"') && token.length >= 2) {
      token = token.slice(1, -1);
    }
    token = token.replace(/\s+/g, " ").trim();
    token = token.replace(new RegExp(ESC_QUOTE, "g"), '"');
    if (!token) continue;
    if (!nickname && token.startsWith("@") && token.length > 1) {
      nickname = token.slice(1);
      continue;
    }
    if (token.startsWith("\@") && token.length >= 3) {
      token = token.slice(2);
    }
    queryParts.push(token);
  }
  const query = queryParts.length > 0 ? queryParts.join(" ") : undefined;
  return {
    ...(query ? { query } : {}),
    ...(nickname ? { nickname } : {}),
  };
}

export function serializeUserSearchQuery(params: { query?: string; nickname?: string }): string {
  const tokens: string[] = [];
  const escapeToken = (token: string): string => {
    let s = token.replace(/"/g, '\\"');
    if (s.match(/\s/)) {
      s = `"${s}"`;
    }
    return s;
  };
  if (params.query) {
    const parts = params.query.split(/\s+/).filter(Boolean);
    for (let p of parts) {
      if (p.startsWith("#") || p.startsWith("@")) {
        p = "\\" + p;
      }
      tokens.push(escapeToken(p));
    }
  }
  if (params.nickname) {
    let nick = params.nickname.replace(/"/g, '\\"');
    if (nick.match(/\s/)) nick = `"${nick}"`;
    tokens.push("@" + nick);
  }
  return tokens.join(" ");
}

export function parseBodyAndTags(body: string): { content: string; tags: string[] } {
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
  const tags: string[] = [];
  const uniqueTags = new Set<string>();
  for (let tagLine of tagLines) {
    tagLine = tagLine.replace(/^#/, "");
    for (let tag of tagLine.split(/, *#/g)) {
      tag = tag.replace(/\s+/g, " ").trim();
      if (tag && !uniqueTags.has(tag)) {
        tags.push(tag);
        uniqueTags.add(tag);
      }
    }
  }
  const content = bodyLines.join("\n");
  return { content, tags };
}
