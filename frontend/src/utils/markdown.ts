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
  // パースの簡易実装（本格実装の場合は必要に応じて調整してください）
  // 各行をブロックとして処理する
  const lines = mdText.replace(/\r\n/g, "\n").split("\n");
  const nodes: Node[] = [];
  let inCode = false, codeLines: string[] = [];
  let currList: { level: number, items: Node[] }[] = [];
  let currPara: string[] = [];

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
  for (let i = 0; i < lines.length; ++i) {
    const line = lines[i];
    // コードブロック
    if (/^```/.test(line)) {
      if (!inCode) {
        flushPara(); flushList();
        inCode = true;
        codeLines = [];
      } else {
        nodes.push({
          type: "element",
          tag: "pre",
          children: [{ type: "text", text: codeLines.join("\n") }],
        });
        inCode = false;
        codeLines = [];
      }
      continue;
    }
    if (inCode) {
      codeLines.push(line);
      continue;
    }
    // 空行で段落切り替え
    if (/^\s*$/.test(line)) {
      flushPara();
      flushList();
      continue;
    }
    // ヘッダ
    const h = line.match(/^(#{1,3}) (.+)$/);
    if (h) {
      flushPara(); flushList();
      const level = h[1].length;
      nodes.push({
        type: "element",
        tag: `h${level}`,
        children: [{ type: "text", text: h[2] }],
      });
      continue;
    }
    // リスト
    const li = line.match(/^(\s*)- (.+)$/);
    if (li) {
      flushPara();
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
  // 末尾でコードブロック開いたまま終わってたら
  if (inCode && codeLines.length > 0) {
    nodes.push({
      type: "element",
      tag: "pre",
      children: [{ type: "text", text: codeLines.join("\n") }],
    });
  }
  return nodes;
}

// インライン要素パース（リンク・改行のみサポート例。必要に応じて追加拡張）
function parseInline(text: string): Node[] {
  const nodes: Node[] = [];
  let i = 0;
  // リンク [anchor](url) or 自動リンク http(s)://
  const linkRe = /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g;
  const urlRe = /https?:\/\/[a-zA-Z0-9\-._~:/?#[\]@!$&'()*+,;=%]+/g;

  let last = 0, m: RegExpExecArray | null;
  // まず[anchor](url)リンク
  while ((m = linkRe.exec(text))) {
    if (m.index > last) {
      nodes.push(...parseInlineText(text.slice(last, m.index)));
    }
    nodes.push({
      type: "element",
      tag: "a",
      attrs: ` href="${escapeHTML(m[2])}" target="_blank" rel="noopener"`,
      children: [{ type: "text", text: m[1] }],
    });
    last = m.index + m[0].length;
  }
  let t = text.slice(last);
  // 続けて自動リンク
  let last2 = 0;
  while ((m = urlRe.exec(t))) {
    if (m.index > last2) {
      nodes.push({ type: "text", text: t.slice(last2, m.index) });
    }
    nodes.push({
      type: "element",
      tag: "a",
      attrs: ` href="${escapeHTML(m[0])}" target="_blank" rel="noopener"`,
      children: [{ type: "text", text: m[0] }],
    });
    last2 = m.index + m[0].length;
  }
  if (last2 < t.length) {
    nodes.push({ type: "text", text: t.slice(last2) });
  }
  // 改行
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
  // 補助: テキストノードのみ分割
  return text === "" ? [] : [{ type: "text", text }];
}

// -----------------------------
// maxLenに従いtextContentを途中カットしつつHTMLに変換する
export function renderBody(mdText: string, maxLen?: number): string {
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
