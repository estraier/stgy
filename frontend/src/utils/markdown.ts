type Node =
  | { type: "text"; text: string }
  | { type: "element"; tag: string; attrs?: string; children: Node[] };

// --- Markdownパーサ本体 ---
export function parseMarkdownBlocks(mdText: string): Node[] {
  const lines = mdText.replace(/\r\n/g, "\n").split("\n");
  const nodes: Node[] = [];
  let inCode = false,
    codeLines: string[] = [],
    codeLang: string | undefined;
  const currList: { level: number; items: Node[] }[] = [];
  let currPara: string[] = [];
  let currTable: string[][] = [];
  let currQuote: string[] = [];

  function flushPara() {
    if (currPara.length) {
      nodes.push({
        type: "element",
        tag: "p",
        children: parseInline(currPara.join("\n")),
      });
      currPara = [];
    }
  }
  function flushList() {
    while (currList.length > 0) {
      const list = currList.pop()!;
      nodes.push({
        type: "element",
        tag: "ul",
        children: list.items,
      });
    }
  }
  function flushTable() {
    if (currTable.length) {
      nodes.push({
        type: "element",
        tag: "table",
        children: currTable.map((row) => ({
          type: "element",
          tag: "tr",
          children: row.map((cell) => ({
            type: "element",
            tag: "td",
            children: parseInline(cell.trim()),
          })),
        })),
      });
      currTable = [];
    }
  }
  function flushQuote() {
    if (currQuote.length) {
      nodes.push({
        type: "element",
        tag: "blockquote",
        children: parseInline(currQuote.join("\n")),
      });
      currQuote = [];
    }
  }

  for (let i = 0; i < lines.length; ++i) {
    const line = lines[i];
    const codeFence = line.match(/^```(\w*)/);
    if (codeFence) {
      flushPara();
      flushList();
      flushTable();
      flushQuote();
      if (!inCode) {
        inCode = true;
        codeLines = [];
        codeLang = codeFence[1] || undefined;
      } else {
        nodes.push({
          type: "element",
          tag: "pre",
          attrs: codeLang ? ` data-pre-mode="${escapeHTML(codeLang)}"` : undefined,
          children: [{ type: "text", text: codeLines.join("\n") }],
        });
        inCode = false;
        codeLang = undefined;
        codeLines = [];
      }
      continue;
    }
    if (inCode) {
      codeLines.push(line);
      continue;
    }
    const img = line.match(/^!\[([^\]]*)\]\(([^)]+)\)$/);
    if (img) {
      flushPara();
      flushList();
      flushTable();
      flushQuote();
      nodes.push({
        type: "element",
        tag: "div",
        attrs: ' class="image-block"',
        children: [
          {
            type: "element",
            tag: "img",
            attrs: ` src="${escapeHTML(img[2])}" alt="${escapeHTML(img[1])}"`,
            children: [],
          },
        ],
      });
      continue;
    }
    const tableRow = line.match(/^\|(.+)\|$/);
    if (tableRow) {
      flushPara();
      flushList();
      flushQuote();
      currTable.push(tableRow[1].split("|"));
      continue;
    } else if (currTable.length) {
      flushTable();
    }
    const quote = line.match(/^> (.*)$/);
    if (quote) {
      flushPara();
      flushList();
      flushTable();
      currQuote.push(quote[1]);
      continue;
    } else if (currQuote.length) {
      flushQuote();
    }
    if (/^\s*$/.test(line)) {
      flushPara();
      flushList();
      flushTable();
      flushQuote();
      continue;
    }
    const h = line.match(/^(#{1,3}) (.+)$/);
    if (h) {
      flushPara();
      flushList();
      flushTable();
      flushQuote();
      const level = h[1].length;
      nodes.push({
        type: "element",
        tag: `h${level}`,
        children: parseInline(h[2]),
      });
      continue;
    }
    const li = line.match(/^(\s*)- (.+)$/);
    if (li) {
      flushPara();
      flushTable();
      flushQuote();
      // リスト内なのでflushListは「しない」
      const level = Math.floor(li[1].length / 2);
      while (currList.length - 1 > level) {
        const done = currList.pop();
        currList[currList.length - 1].items.push({
          type: "element",
          tag: "ul",
          children: done!.items,
        });
      }
      if (!currList[level]) currList[level] = { level, items: [] };
      currList[level].items.push({
        type: "element",
        tag: "li",
        children: parseInline(li[2]),
      });
      continue;
    }
    // --- ここが重要な修正 ---
    if (currList.length > 0) {
      flushList(); // <--- リスト外の通常行が来たら必ずflushListする
    }
    currPara.push(line);
  }
  flushPara();
  flushList();
  flushTable();
  flushQuote();
  if (inCode && codeLines.length > 0) {
    nodes.push({
      type: "element",
      tag: "pre",
      attrs: codeLang ? ` data-pre-mode="${escapeHTML(codeLang)}"` : undefined,
      children: [{ type: "text", text: codeLines.join("\n") }],
    });
  }
  return nodes;
}

// --- 以下は付随関数 ---

function sumTextLenAndNewlines(nodes: Node[]): { length: number; newlines: number } {
  let length = 0;
  let newlines = 0;
  for (const node of nodes) {
    if (node.type === "text") {
      length += node.text.length;
      newlines += node.text.match(/\n/g)?.length ?? 0;
    } else if (node.type === "element") {
      const childResult = sumTextLenAndNewlines(node.children || []);
      length += childResult.length;
      newlines += childResult.newlines;
    }
  }
  return { length, newlines };
}

function parseInline(text: string): Node[] {
  const bold = /\*\*([^\*]+)\*\*/;
  const italic = /\*([^\*]+)\*/;
  const underline = /__([^_]+)__/;
  let m;
  if ((m = bold.exec(text))) {
    return [
      ...parseInline(text.slice(0, m.index)),
      {
        type: "element",
        tag: "strong",
        children: parseInline(m[1]),
      },
      ...parseInline(text.slice(m.index + m[0].length)),
    ];
  }
  if ((m = underline.exec(text))) {
    return [
      ...parseInline(text.slice(0, m.index)),
      {
        type: "element",
        tag: "u",
        children: parseInline(m[1]),
      },
      ...parseInline(text.slice(m.index + m[0].length)),
    ];
  }
  if ((m = italic.exec(text))) {
    return [
      ...parseInline(text.slice(0, m.index)),
      {
        type: "element",
        tag: "em",
        children: parseInline(m[1]),
      },
      ...parseInline(text.slice(m.index + m[0].length)),
    ];
  }
  const linkRe = /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g;
  const nodes: Node[] = [];
  let last = 0,
    match: RegExpExecArray | null;
  while ((match = linkRe.exec(text))) {
    if (match.index > last) {
      nodes.push(...parseInlineText(text.slice(last, match.index)));
    }
    nodes.push({
      type: "element",
      tag: "a",
      attrs: ` href="${escapeHTML(match[2])}" target="_blank" rel="noopener"`,
      children: [{ type: "text", text: match[1] }],
    });
    last = match.index + match[0].length;
  }
  text = text.slice(last);
  const urlRe = /https?:\/\/[a-zA-Z0-9\-._~:/?#[\]@!$&'()*+,;=%]+/g;
  last = 0;
  while ((match = urlRe.exec(text))) {
    if (match.index > last) {
      nodes.push({ type: "text", text: text.slice(last, match.index) });
    }
    nodes.push({
      type: "element",
      tag: "a",
      attrs: ` href="${escapeHTML(match[0])}" target="_blank" rel="noopener"`,
      children: [{ type: "text", text: match[0] }],
    });
    last = match.index + match[0].length;
  }
  if (last < text.length) {
    nodes.push({ type: "text", text: text.slice(last) });
  }
  return nodes.flatMap((n) =>
    typeof n === "object" && n.type === "text"
      ? n.text.split(/\n/).flatMap((frag, i, _arr) =>
          i === 0
            ? [{ type: "text", text: frag }]
            : [
                { type: "element", tag: "br", children: [] as Node[] },
                { type: "text", text: frag },
              ],
        )
      : [n],
  );
}

function parseInlineText(text: string): Node[] {
  return text === "" ? [] : [{ type: "text", text }];
}

function escapeHTML(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function renderHtml(
  mdText: string,
  maxLen?: number,
  maxHeight?: number,
  imgLen: number = 50,
  imgHeight: number = 6,
): string {
  const nodes = parseMarkdownBlocks(mdText);
  const state = {
    remain: typeof maxLen === "number" ? maxLen : Number.POSITIVE_INFINITY,
    cut: false,
    height: 0,
    maxHeight: typeof maxHeight === "number" ? maxHeight : Number.POSITIVE_INFINITY,
    omitted: false,
  };
  function htmlFromNodes(nodes: Node[]): string {
    const omitTag = `<span class="omitted">...</span>`;
    let html = "";
    for (const node of nodes) {
      if (state.cut) break;
      if (node.type === "text") {
        if (state.remain <= 0) {
          state.cut = true;
          if (!state.omitted) {
            html += omitTag;
            state.omitted = true;
          }
          break;
        }
        const s = node.text;
        if (s.length > state.remain) {
          html += escapeHTML(s.slice(0, state.remain));
          if (!state.omitted) {
            html += omitTag;
            state.omitted = true;
          }
          state.cut = true;
          state.remain = 0;
          break;
        } else {
          html += escapeHTML(s);
          state.remain -= s.length;
        }
      } else if (node.type === "element") {
        const blockTags = [
          "p",
          "pre",
          "blockquote",
          "h1",
          "h2",
          "h3",
          "h4",
          "h5",
          "h6",
          "tr",
          "li",
        ];
        if (blockTags.includes(node.tag)) {
          const { length: contentLength, newlines } = sumTextLenAndNewlines(node.children || []);
          let heightInc = 1 + Math.floor(contentLength / 100);
          if (node.tag === "pre" && newlines > 1) {
            heightInc = Math.max(heightInc, newlines);
          }
          state.height += heightInc;
          if (state.height > state.maxHeight) {
            state.cut = true;
            if (!state.omitted) {
              html += omitTag;
              state.omitted = true;
            }
            break;
          }
        }
        if (node.tag === "br") {
          state.height += 1;
          if (state.height > state.maxHeight) {
            state.cut = true;
            if (!state.omitted) {
              html += omitTag;
              state.omitted = true;
            }
            break;
          }
          html += `<br>`;
          continue;
        }
        if (node.tag === "div" && node.attrs && node.attrs.includes("image-block")) {
          if (state.remain < imgLen || state.height + imgHeight > state.maxHeight) {
            state.cut = true;
            if (!state.omitted) {
              html += omitTag;
              state.omitted = true;
            }
            break;
          }
          html += `<div class="image-block">`;
          for (const child of node.children || []) {
            if (child.type === "element" && child.tag === "img" && child.attrs) {
              html += `<img${child.attrs}/>`;
            }
          }
          html += `</div>`;
          state.remain -= imgLen;
          state.height += imgHeight;
          continue;
        }
        html += `<${node.tag}${node.attrs || ""}>`;
        html += htmlFromNodes(node.children || []);
        html += `</${node.tag}>`;
        if (state.cut) break;
      }
    }
    return html;
  }
  return htmlFromNodes(nodes);
}
