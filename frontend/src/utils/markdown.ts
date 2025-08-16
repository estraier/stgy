type Node =
  | { type: "text"; text: string }
  | {
      type: "element";
      tag: string;
      attrs?: string;
      children: Node[];
      isThumbnailBlock?: boolean;
    };

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
      if (currList.length === 0) {
        nodes.push({
          type: "element",
          tag: "ul",
          children: list.items,
        });
      } else {
        const lastLi = currList[currList.length - 1].items.at(-1);
        if (lastLi && lastLi.type === "element" && lastLi.tag === "li") {
          if (!lastLi.children) lastLi.children = [];
          lastLi.children.push({
            type: "element",
            tag: "ul",
            children: list.items,
          });
        }
      }
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

  const imageMacroRe = /^!\[([^\]]*)\]\(([^)]+)\)(?:\{([^\}]*)\})?$/;
  const videoExts = /\.(mpg|mp4|m4a|mov|avi|wmv|webm)(\?.*)?$/i;

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
    const img = line.match(imageMacroRe);
    if (img) {
      flushPara();
      flushList();
      flushTable();
      flushQuote();

      const macro: Record<string, string | boolean> = {};
      if (img[3]) {
        for (const pair of img[3].split(",")) {
          const m = pair.match(/^\s*([a-z][a-z0-9]*)(?:=([^,]+))?\s*$/);
          if (m) {
            if (m[2] === undefined) {
              macro[m[1]] = true;
            } else {
              macro[m[1]] = m[2].replace(/\s+/g, " ");
            }
          }
        }
      }

      const isVideo = macro["media"] === "video" || videoExts.test(img[2]);
      const dataAttrs = Object.entries(macro)
        .map(([k, v]) => (v === true ? ` data-${k}` : ` data-${k}="${escapeHTML(String(v))}"`))
        .join("");
      const desc = img[1] || "";
      nodes.push({
        type: "element",
        tag: "figure",
        attrs: ` class="image-block"`,
        children: [
          (isVideo
            ? {
                type: "element",
                tag: "video",
                attrs: ` src="${escapeHTML(img[2])}" aria-label="" controls` + dataAttrs,
                children: [],
              }
            : {
                type: "element",
                tag: "img",
                attrs: ` src="${escapeHTML(img[2])}" alt=""` + dataAttrs,
                children: [],
              }) as Node,
          ...(desc
            ? ([
                {
                  type: "element",
                  tag: "figcaption",
                  children: [{ type: "text", text: desc } as Node],
                } as Node,
              ] as Node[])
            : []),
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
      const level = Math.floor(li[1].length / 2);

      while (currList.length > 0 && currList[currList.length - 1].level > level) {
        const done = currList.pop();
        if (currList.length === 0) {
          nodes.push({
            type: "element",
            tag: "ul",
            children: done!.items,
          });
        } else {
          const lastLi = currList[currList.length - 1].items.at(-1);
          if (lastLi && lastLi.type === "element" && lastLi.tag === "li") {
            if (!lastLi.children) lastLi.children = [];
            lastLi.children.push({
              type: "element",
              tag: "ul",
              children: done!.items,
            });
          }
        }
      }

      if (currList.length === 0 || currList[currList.length - 1].level < level) {
        currList.push({ level, items: [] });
      }

      currList[currList.length - 1].items.push({
        type: "element",
        tag: "li",
        children: parseInline(li[2]),
      });
      continue;
    }
    if (currList.length > 0) {
      flushList();
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

function filterNodesForThumbnail(nodes: Node[]): Node[] {
  let thumbnailFig: Node | null = null;

  function findThumbnailFig(nodes: Node[]): Node | null {
    for (const node of nodes) {
      if (
        node.type === "element" &&
        node.tag === "figure" &&
        node.attrs &&
        node.attrs.includes("image-block")
      ) {
        const imgOrVideo = node.children[0];
        if (
          imgOrVideo &&
          imgOrVideo.type === "element" &&
          (imgOrVideo.tag === "img" || imgOrVideo.tag === "video") &&
          imgOrVideo.attrs &&
          /\bdata-thumbnail\b/.test(imgOrVideo.attrs)
        ) {
          return node;
        }
      }
      if (node.type === "element" && node.children) {
        const res = findThumbnailFig(node.children);
        if (res) return res;
      }
    }
    return null;
  }

  function findFirstFig(nodes: Node[]): Node | null {
    for (const node of nodes) {
      if (
        node.type === "element" &&
        node.tag === "figure" &&
        node.attrs &&
        node.attrs.includes("image-block")
      ) {
        return node;
      }
      if (node.type === "element" && node.children) {
        const res = findFirstFig(node.children);
        if (res) return res;
      }
    }
    return null;
  }

  thumbnailFig = findThumbnailFig(nodes) || findFirstFig(nodes);

  function removeImageBlocks(nodes: Node[]): Node[] {
    const result: Node[] = [];
    for (const node of nodes) {
      if (
        node.type === "element" &&
        node.tag === "figure" &&
        node.attrs &&
        node.attrs.includes("image-block")
      ) {
        continue;
      }
      if (node.type === "element" && node.children) {
        result.push({ ...node, children: removeImageBlocks(node.children) });
      } else {
        result.push(node);
      }
    }
    return result;
  }

  const bodyNodes = removeImageBlocks(nodes);

  if (thumbnailFig && thumbnailFig.type === "element") {
    const thumb: Node = {
      type: "element",
      tag: thumbnailFig.tag,
      attrs: (thumbnailFig.attrs || "").replace("image-block", "thumbnail-block"),
      children: thumbnailFig.children,
      isThumbnailBlock: true,
    };
    return [thumb, ...bodyNodes];
  } else {
    return bodyNodes;
  }
}

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
  const esc = /\\([\\~`*_\[\](){}#+\-.!])/;
  const bold = /\*\*([^\*]+)\*\*/;
  const italic = /\*([^\*]+)\*/;
  const underline = /__([^_]+)__/;
  const strikethrough = /~~([^~]+)~~/;
  const code = /`([^`]+)`/;
  let m;
  if ((m = esc.exec(text))) {
    return [
      ...parseInline(text.slice(0, m.index)),
      { type: "text", text: m[1] },
      ...parseInline(text.slice(m.index + 2)),
    ];
  }
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
  if ((m = strikethrough.exec(text))) {
    return [
      ...parseInline(text.slice(0, m.index)),
      {
        type: "element",
        tag: "s",
        children: parseInline(m[1]),
      },
      ...parseInline(text.slice(m.index + m[0].length)),
    ];
  }
  if ((m = code.exec(text))) {
    return [
      ...parseInline(text.slice(0, m.index)),
      {
        type: "element",
        tag: "code",
        children: parseInline(m[1]),
      },
      ...parseInline(text.slice(m.index + m[0].length)),
    ];
  }
  const linkRe = /\[([^\]]+)\]\(((?:https?:\/\/[^\s)]+|\/(?:posts|users|data)\/[^\s)]+))\)/g;
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
      attrs: ` href="${escapeHTML(match[2])}"`,
      children: [{ type: "text", text: match[1] }],
    });
    last = match.index + match[0].length;
  }
  text = text.slice(last);
  const urlRe =
    /(https?:\/\/[a-zA-Z0-9\-._~:/?#[\]@!$&'()*+,;=%]+|\/(?:posts|users|data)\/[a-zA-Z0-9\-._~:/?#[\]@!$&'()*+,;=%]*)/g;
  last = 0;
  while ((match = urlRe.exec(text))) {
    if (match.index > last) {
      nodes.push({ type: "text", text: text.slice(last, match.index) });
    }
    nodes.push({
      type: "element",
      tag: "a",
      attrs: ` href="${escapeHTML(match[0])}"`,
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
  options?: {
    maxLen?: number;
    maxHeight?: number;
    imgLen?: number;
    imgHeight?: number;
    pickupThumbnail?: boolean;
  },
): string {
  const { maxLen, maxHeight, imgLen = 50, imgHeight = 6, pickupThumbnail = false } = options || {};

  let nodes = parseMarkdownBlocks(mdText);

  if (pickupThumbnail) {
    nodes = filterNodesForThumbnail(nodes);
  }

  const state = {
    remain: typeof maxLen === "number" ? maxLen : Number.POSITIVE_INFINITY,
    cut: false,
    height: 0,
    maxHeight: typeof maxHeight === "number" ? maxHeight : Number.POSITIVE_INFINITY,
    omitted: false,
  };

  function htmlFromNodes(nodes: Node[]): string {
    const omitTag = `<span class="omitted">...</span>`;

    function consumeImageBudget(): boolean {
      const nextRemain = state.remain - imgLen;
      const nextHeight = state.height + imgHeight;
      if (nextRemain < 0 || nextHeight > state.maxHeight) {
        state.cut = true;
        return false;
      }
      state.remain = nextRemain;
      state.height = nextHeight;
      return true;
    }

    function writeText(s: string): string {
      if (state.remain <= 0) {
        state.cut = true;
        if (!state.omitted) {
          state.omitted = true;
          return omitTag;
        }
        return "";
      }
      if (s.length > state.remain) {
        const part = escapeHTML(s.slice(0, state.remain));
        state.remain = 0;
        state.cut = true;
        if (!state.omitted) {
          state.omitted = true;
          return part + omitTag;
        }
        return part;
      } else {
        state.remain -= s.length;
        return escapeHTML(s);
      }
    }

    let html = "";
    for (const node of nodes) {
      if (state.cut) break;
      if (node.type === "text") {
        html += writeText(node.text);
      } else if (node.type === "element") {
        if (node.isThumbnailBlock) {
          const media = (node.children || []).find(
            (c) => c.type === "element" && (c.tag === "img" || c.tag === "video"),
          );
          if (media) {
            const ok = consumeImageBudget();
            if (!ok) {
              if (!state.omitted) {
                html += omitTag;
                state.omitted = true;
              }
              break;
            }
          }
          html += `<figure class="thumbnail-block">`;
          for (const child of node.children || []) {
            if (child.type === "element" && (child.tag === "img" || child.tag === "video")) {
              const src = child.attrs?.match(/src="([^"]*)"/)?.[1] ?? "";
              if (child.tag === "img") {
                html += `<img src="${escapeHTML(src)}" alt="">`;
              } else {
                html += `<video src="${escapeHTML(src)}" aria-label="" controls></video>`;
              }
            }
            if (child.type === "element" && child.tag === "figcaption") {
              html += `<figcaption>${htmlFromNodes(child.children || [])}</figcaption>`;
            }
          }
          html += `</figure>`;
          continue;
        }

        if (
          node.tag === "figure" &&
          node.attrs &&
          (node.attrs.includes("image-block") || node.attrs.includes("thumbnail-block"))
        ) {
          const media = (node.children || []).find(
            (c) => c.type === "element" && (c.tag === "img" || c.tag === "video"),
          );
          if (media) {
            const ok = consumeImageBudget();
            if (!ok) {
              if (!state.omitted) {
                html += omitTag;
                state.omitted = true;
              }
              break;
            }
          }
          html += `<figure${node.attrs || ""}>`;
          for (const child of node.children || []) {
            if (child.type === "element" && (child.tag === "img" || child.tag === "video")) {
              const src = child.attrs?.match(/src="([^"]*)"/)?.[1] ?? "";
              if (child.tag === "img") {
                html += `<img src="${escapeHTML(src)}" alt="">`;
              } else {
                html += `<video src="${escapeHTML(src)}" aria-label="" controls></video>`;
              }
            }
            if (child.type === "element" && child.tag === "figcaption") {
              html += `<figcaption>${htmlFromNodes(child.children || [])}</figcaption>`;
            }
          }
          html += `</figure>`;
          continue;
        }

        if ((node.tag === "img" || node.tag === "video") && node.attrs) {
          const ok = consumeImageBudget();
          if (!ok) {
            if (!state.omitted) {
              html += omitTag;
              state.omitted = true;
            }
            break;
          }
          const src = node.attrs.match(/src="([^"]*)"/)?.[1] ?? "";
          if (node.tag === "img") {
            html += `<img src="${escapeHTML(src)}" alt="">`;
          } else {
            html += `<video src="${escapeHTML(src)}" aria-label="" controls></video>`;
          }
          continue;
        }

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
