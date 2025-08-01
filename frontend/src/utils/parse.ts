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
  const forward_lines: string[] = [];
  const forward_tag_lines: string[] = [];
  for (let line of lines) {
    line = line.replace(/\r$/, "").replace(/\s+$/, "");
    if (line) {
      if (forward_lines.length === 0 && /^#[^#\s]/.test(line)) {
        forward_tag_lines.push(line);
      } else {
        forward_lines.push(line);
      }
    } else if (forward_lines.length > 0) {
      forward_lines.push(line);
    }
  }
  const reverse_lines: string[] = [];
  const reverse_tag_lines: string[] = [];
  for (let i = forward_lines.length - 1; i >= 0; --i) {
    const line = forward_lines[i];
    if (line) {
      if (reverse_lines.length === 0 && /^#[^#\s]/.test(line)) {
        reverse_tag_lines.push(line);
      } else {
        reverse_lines.push(line);
      }
    } else if (reverse_lines.length > 0) {
      reverse_lines.push(line);
    }
  }
  const bodyLines = reverse_lines.reverse();
  const tags: string[] = [];
  const unique_tags = new Set<string>();
  const all_tag_lines = forward_tag_lines.concat(reverse_tag_lines.reverse());
  for (let tag_line of all_tag_lines) {
    tag_line = tag_line.replace(/^#/, "");
    for (let tag of tag_line.split(/, *#/g)) {
      tag = tag.replace(/\s+/g, " ").trim();
      if (tag && !unique_tags.has(tag)) {
        tags.push(tag);
        unique_tags.add(tag);
      }
    }
  }
  const content = bodyLines.join("\n");
  return { content, tags };
}
