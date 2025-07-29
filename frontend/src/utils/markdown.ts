// frontend/src/utils/markdown.ts

function escapeHTML(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

type Node =
  | { type: "text"; text: string }
  | { type: "element"; tag: string; attrs?: string; children: Node[] };

export function parseMarkdownBlocks(mdText: string): Node[] {
  const lines = mdText.replace(/\r\n/g, "\n").split("\n");
  const nodes: Node[] = [];
  let inCode = false, codeLines: string[] = [], codeLang: string | undefined;
  let currList: { level: number, items: Node[] }[] = [];
  let currPara: string[] = [];
  let currTable: string[][] = [];

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
    while (currList.length > 1) {
      const done = currList.pop();
      currList[currList.length - 1].items.push({
        type: "element", tag: "ul", children: done!.items,
      });
    }
    if (currList.length === 1) {
      nodes.push({
        type: "element",
        tag: "ul",
        children: currList[0].items,
      });
      currList = [];
    }
  }
  function flushTable() {
    if (currTable.length) {
      nodes.push({
        type: "element",
        tag: "table",
        children: currTable.map(row => ({
          type: "element",
          tag: "tr",
          children: row.map(cell => ({
            type: "element",
            tag: "td",
            children: parseInline(cell.trim()),
          })),
        })),
      });
      currTable = [];
    }
  }
  for (let i = 0; i < lines.length; ++i) {
    let line = lines[i];
    // コードブロック
    const codeFence = line.match(/^```(\w*)/);
    if (codeFence) {
      if (!inCode) {
        flushPara(); flushList(); flushTable();
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
    // 画像 ![caption](url)
    const img = line.match(/^!\[([^\]]*)\]\(([^)]+)\)$/);
    if (img) {
      flushPara(); flushList(); flushTable();
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
    // テーブル |a|b|c|
    const tableRow = line.match(/^\|(.+)\|$/);
    if (tableRow) {
      flushPara(); flushList();
      currTable.push(tableRow[1].split("|"));
      continue;
    } else if (currTable.length) {
      flushTable();
    }
    // 空行で段落切り替え
    if (/^\s*$/.test(line)) {
      flushPara();
      flushList();
      flushTable();
      continue;
    }
    // ヘッダ
    const h = line.match(/^(#{1,3}) (.+)$/);
    if (h) {
      flushPara(); flushList(); flushTable();
      const level = h[1].length;
      nodes.push({
        type: "element",
        tag: `h${level}`,
        children: parseInline(h[2]),
      });
      continue;
    }
    // リスト
    const li = line.match(/^(\s*)- (.+)$/);
    if (li) {
      flushPara(); flushTable();
      const level = Math.floor((li[1].length) / 2);
      // 階層過剰ならpopして親にまとめる
      while (currList.length > level + 1) {
        const done = currList.pop();
        currList[currList.length - 1].items.push({
          type: "element", tag: "ul", children: done!.items,
        });
      }
      // 階層不足ならpushして深さを合わせる
      while (currList.length < level + 1) {
        currList.push({ level: currList.length, items: [] });
      }
      currList[level].items.push({
        type: "element",
        tag: "li",
        children: parseInline(li[2]),
      });
      continue;
    }
    // **ここが修正ポイント: リスト行でなければリストをflushして通常文処理**
    flushList();
    currPara.push(line);
  }
  flushPara();
  flushList();
  flushTable();
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
  let nodes: Node[] = [];
  let last = 0, match: RegExpExecArray | null;
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

  return nodes.flatMap(n =>
    typeof n === "object" && n.type === "text"
      ? n.text.split(/\n/).flatMap((frag, i, arr) =>
          i === 0 ? [{ type: "text", text: frag }] :
            [{ type: "element", tag: "br", children: [] }, { type: "text", text: frag }]
        )
      : [n]
  );
}
function parseInlineText(text: string): Node[] {
  return text === "" ? [] : [{ type: "text", text }];
}

export function renderBody(mdText: string, maxLen?: number): string {
  const nodes = parseMarkdownBlocks(mdText);

  const state = { remain: typeof maxLen === "number" ? maxLen : Number.POSITIVE_INFINITY, cut: false };

  function htmlFromNodes(nodes: Node[]): string {
    let html = "";
    for (const node of nodes) {
      if (state.cut) break;
      if (node.type === "text") {
        if (state.remain <= 0) { state.cut = true; break; }
        const s = node.text;
        if (s.length > state.remain) {
          html += escapeHTML(s.slice(0, state.remain));
          state.cut = true;
          state.remain = 0;
          break;
        } else {
          html += escapeHTML(s);
          state.remain -= s.length;
        }
      } else if (node.type === "element") {
        if (node.tag === "br") {
          html += `<br>`;
          continue;
        }
        if (node.tag === "div" && node.attrs && node.attrs.includes('image-block')) {
          if (state.remain < 10) { state.cut = true; break; }
          html += `<div class="image-block">`;
          for (const child of node.children || []) {
            if (child.type === "element" && child.tag === "img" && child.attrs) {
              html += `<img${child.attrs}/>`;
            }
          }
          html += `</div>`;
          state.remain -= 10;
          continue;
        }
        html += `<${node.tag}${node.attrs || ""}>`;
        html += htmlFromNodes(node.children || []);
        html += `</${node.tag}>`;
      }
    }
    return html;
  }
  let html = htmlFromNodes(nodes);
  if (state.cut) html += `<div class="omitted">...</div>`;
  return html;
}
