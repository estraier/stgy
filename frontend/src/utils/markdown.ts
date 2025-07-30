// frontend/src/utils/markdown.ts

// HTMLエスケープ
function escapeHTML(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// パース用ノード型
type Node =
  | { type: "text"; text: string }
  | { type: "element"; tag: string; attrs?: string; children: Node[] };


// Markdown-likeなテキストを簡易パースしてノード配列を返す
export function parseMarkdownBlocks(mdText: string): Node[] {
  const lines = mdText.replace(/\r\n/g, "\n").split("\n");
  const nodes: Node[] = [];
  let inCode = false, codeLines: string[] = [], codeLang: string | undefined;
  let currList: { level: number, items: Node[] }[] = [];
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
    let line = lines[i];
    // コードブロック
    const codeFence = line.match(/^```(\w*)/);
    if (codeFence) {
      flushPara(); flushList(); flushTable(); flushQuote();
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
    // 画像 ![caption](url)
    const img = line.match(/^!\[([^\]]*)\]\(([^)]+)\)$/);
    if (img) {
      flushPara(); flushList(); flushTable(); flushQuote();
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
      flushPara(); flushList(); flushQuote();
      currTable.push(tableRow[1].split("|"));
      continue;
    } else if (currTable.length) {
      flushTable();
    }
    // blockquote: 行頭 > (スペース必須)
    const quote = line.match(/^> (.*)$/);
    if (quote) {
      flushPara(); flushList(); flushTable();
      currQuote.push(quote[1]);
      continue;
    } else if (currQuote.length) {
      flushQuote();
    }
    // 空行で段落切り替え
    if (/^\s*$/.test(line)) {
      flushPara();
      flushList();
      flushTable();
      flushQuote();
      continue;
    }
    // ヘッダ
    const h = line.match(/^(#{1,3}) (.+)$/);
    if (h) {
      flushPara(); flushList(); flushTable(); flushQuote();
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
      flushPara(); flushTable(); flushQuote();
      const level = Math.floor((li[1].length) / 2);
      while (currList.length - 1 > level) {
        const done = currList.pop();
        currList[currList.length - 1].items.push({
          type: "element", tag: "ul", children: done!.items,
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
    // 通常文
    currPara.push(line);
  }
  flushPara();
  flushList();
  flushTable();
  flushQuote();
  // 末尾でコードブロック開いたまま終わってたら
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

// インライン要素パース（リンク・改行・装飾）
function parseInline(text: string): Node[] {
  // 太字/斜体/下線: **bold** / *italic* / __underline__
  // 1回だけ最初にマッチしたものだけを再帰的に処理
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

  // [anchor](url)リンク
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

  // 自動リンク
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

  // 改行
  return nodes.flatMap(n =>
    typeof n === "object" && n.type === "text"
      ? n.text.split(/\n/).flatMap((frag, i, arr) =>
          i === 0 ? [{ type: "text", text: frag }] :
            [{ type: "element", tag: "br", children: [] as Node[]}, { type: "text", text: frag }]
        )
      : [n]
  );
}
function parseInlineText(text: string): Node[] {
  return text === "" ? [] : [{ type: "text", text }];
}

// -----------------------------
// maxLenに従いtextContentを途中カットしつつHTMLに変換する
export function renderBody(mdText: string, maxLen?: number, imgLen: number = 50): string {
  const nodes = parseMarkdownBlocks(mdText);

  // textContent長をカウントしながら再帰的にノードをHTML化
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
        // brだけ特別扱い: textContentは増やさない
        if (node.tag === "br") {
          html += `<br>`;
          continue;
        }
        if (node.tag === "div" && node.attrs && node.attrs.includes('image-block')) {
          if (state.remain < imgLen) { state.cut = true; break; }
          html += `<div class="image-block">`;
          for (const child of node.children || []) {
            if (child.type === "element" && child.tag === "img" && child.attrs) {
              html += `<img${child.attrs}/>`;
            }
          }
          html += `</div>`;
          state.remain -= imgLen;
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
