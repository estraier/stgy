export type MdAttrs = Record<string, string | number | boolean>;
export type MdTextNode = { type: "text"; text: string };
export type MdElementNode = {
  type: "element";
  tag: string;
  attrs?: MdAttrs;
  children: MdNode[];
  charPosition?: number;
  linePosition?: number;
};
export type MdMediaElement = MdElementNode & { tag: "img" | "video" };
export type MdNode = MdTextNode | MdElementNode;

function isMediaElement(n: MdNode): n is MdMediaElement {
  return n.type === "element" && (n.tag === "img" || n.tag === "video");
}

function makeElement(
  tag: string,
  children: MdNode[],
  attrs?: MdAttrs,
  linePosition?: number,
  charPosition?: number,
): MdElementNode {
  const el: MdElementNode = { type: "element", tag, children };
  if (attrs && Object.keys(attrs).length > 0) el.attrs = attrs;
  if (typeof linePosition === "number") el.linePosition = linePosition;
  if (typeof charPosition === "number") el.charPosition = charPosition;
  return el;
}

export function parseMarkdown(mdText: string): MdNode[] {
  let src = mdText.replace(/\r\n/g, "\n");
  const lines = src.split("\n");
  const lineOffsets: number[] = [];
  {
    let offset = 0;
    for (let i = 0; i < lines.length; i++) {
      lineOffsets.push(offset);
      offset += lines[i]!.length;
      if (i < lines.length - 1) offset += 1;
    }
  }
  const nodes: MdNode[] = [];
  let inCode = false,
    codeLines: string[] = [],
    codeLang: string | undefined,
    codeStyle: string | undefined;
  let codeStartLine = -1,
    codeStartChar = -1,
    codeFenceLen = 0;
  const currList: {
    level: number;
    items: MdNode[];
    bullet?: "number" | "none";
  }[] = [];
  let currPara: string[] = [];
  let paraStartLine = -1,
    paraStartChar = -1;
  let currTable: string[][] = [];
  let tableStartLine = -1,
    tableStartChar = -1;
  let currQuote: string[] = [];
  let quoteStartLine = -1,
    quoteStartChar = -1;
  function inheritPosFromFirstChild(
    tag: string,
    children: MdNode[],
    attrs?: MdAttrs,
  ): MdElementNode {
    let lp: number | undefined;
    let cp: number | undefined;
    for (const c of children) {
      if (c.type === "element") {
        if (typeof c.linePosition === "number") lp = c.linePosition;
        if (typeof c.charPosition === "number") cp = c.charPosition;
        break;
      }
    }
    return makeElement(tag, children, attrs, lp, cp);
  }
  function flushPara() {
    if (currPara.length) {
      nodes.push(
        makeElement(
          "p",
          parseInline(currPara.join("\n")),
          undefined,
          paraStartLine,
          paraStartChar,
        ),
      );
      currPara = [];
      paraStartLine = -1;
      paraStartChar = -1;
    }
  }
  function flushList() {
    while (currList.length > 0) {
      const list = currList.pop()!;
      const attrs = list.bullet ? { bullet: list.bullet } : undefined;
      if (currList.length === 0) {
        nodes.push(inheritPosFromFirstChild("ul", list.items, attrs));
      } else {
        const parentItems = currList[currList.length - 1].items;
        const lastLi =
          parentItems.length > 0
            ? parentItems[parentItems.length - 1]
            : undefined;
        if (lastLi && lastLi.type === "element" && lastLi.tag === "li") {
          if (!lastLi.children) lastLi.children = [];
          lastLi.children.push(
            inheritPosFromFirstChild("ul", list.items, attrs),
          );
        }
      }
    }
  }
  function flushTable() {
    if (currTable.length) {
      const makeCell = (cell: string): MdElementNode => {
        const raw = cell.trim();
        const mHeader = raw.match(/^=\s*(.*?)\s*=$/);
        const isHeader = !!mHeader;
        let content = isHeader ? mHeader[1]! : raw;
        let align: "right" | "center" | undefined;
        let colspan: number | undefined;
        let rowspan: number | undefined;
        let rest = content.replace(/^\s+/, "");
        const optRe = /^(?:\{\s*(colspan|rowspan)\s*=\s*(\d+)\s*\}|(>>|><))\s*/;
        while (true) {
          const m = optRe.exec(rest);
          if (!m) break;
          if (m[1]) {
            const k = m[1] as "colspan" | "rowspan";
            const v = parseInt(m[2]!, 10);
            if (Number.isFinite(v)) {
              if (k === "colspan") colspan = v;
              else rowspan = v;
            }
          } else if (m[3]) {
            align = m[3] === ">>" ? "right" : "center";
          }
          rest = rest.slice(m[0].length);
        }
        content = rest;
        const tag: "th" | "td" = isHeader ? "th" : "td";
        const inner = parseInline(content);
        const attrs: MdAttrs = {};
        if (align) attrs.align = align;
        if (typeof colspan === "number" && colspan > 1)
          attrs.colspan = colspan.toString();
        if (typeof rowspan === "number" && rowspan > 1)
          attrs.rowspan = rowspan.toString();
        return makeElement(
          tag,
          inner,
          Object.keys(attrs).length ? attrs : undefined,
          tableStartLine,
          tableStartChar,
        );
      };
      nodes.push(
        makeElement(
          "table",
          currTable.map((row) =>
            makeElement(
              "tr",
              row.map((cell) => makeCell(cell)),
              undefined,
              tableStartLine,
              tableStartChar,
            ),
          ),
          undefined,
          tableStartLine,
          tableStartChar,
        ),
      );
      currTable = [];
      tableStartLine = -1;
      tableStartChar = -1;
    }
  }
  function flushQuote() {
    if (currQuote.length) {
      nodes.push(
        makeElement(
          "blockquote",
          parseInline(currQuote.join("\n")),
          undefined,
          quoteStartLine,
          quoteStartChar,
        ),
      );
      currQuote = [];
      quoteStartLine = -1;
      quoteStartChar = -1;
    }
  }
  const imageMacroRe = /^!\[([^\]]*)\]\s*\(([^)]+)\)\s*(?:\{([^\}]*)\})?$/;
  const videoExts = /\.(mpg|mp4|m4a|mov|avi|wmv|webm)(\?.*)?$/i;
  for (let i = 0; i < lines.length; ++i) {
    const line = lines[i]!;
    const lineCharStart = lineOffsets[i]!;
    if (inCode) {
      const closeRe = new RegExp("^`{" + codeFenceLen + "}\\s*$");
      if (closeRe.test(line)) {
        nodes.push(
          makeElement(
            "pre",
            [{ type: "text", text: codeLines.join("\n") }],
            (() => {
              const a: MdAttrs = {};
              if (codeLang) a["pre-mode"] = codeLang;
              if (codeStyle) a["pre-style"] = codeStyle;
              return Object.keys(a).length ? a : undefined;
            })(),
            codeStartLine,
            codeStartChar,
          ),
        );
        inCode = false;
        codeLang = undefined;
        codeStyle = undefined;
        codeLines = [];
        codeFenceLen = 0;
        codeStartLine = -1;
        codeStartChar = -1;
        continue;
      }
      codeLines.push(line);
      continue;
    }
    const codeOpen = line.match(/^(`{3,})([^`]*)\s*$/);
    if (codeOpen) {
      flushPara();
      flushList();
      flushTable();
      flushQuote();
      inCode = true;
      codeLines = [];
      const rawInfo = (codeOpen[2] || "").trim();
      codeLang = undefined;
      codeStyle = undefined;
      if (rawInfo) {
        if (rawInfo.startsWith(":")) {
          codeStyle = rawInfo.slice(1) || undefined;
        } else {
          const idx = rawInfo.indexOf(":");
          codeLang = idx === -1 ? rawInfo : rawInfo.slice(0, idx) || undefined;
          codeStyle =
            idx === -1 ? undefined : rawInfo.slice(idx + 1) || undefined;
        }
      }
      codeFenceLen = codeOpen[1]!.length;
      codeStartLine = i;
      codeStartChar = lineCharStart;
      continue;
    }
    if (/^\s*<\[[^\n]*?\]>\s*$/.test(line)) {
      continue;
    }
    const toc = line.match(/^\s*<!TOC!>\s*$/);
    if (toc) {
      flushPara();
      flushList();
      flushTable();
      flushQuote();
      nodes.push(makeElement("toc", [], undefined, i, lineCharStart));
      continue;
    }
    const hr = line.match(/^-{3,}$/);
    if (hr) {
      flushPara();
      flushList();
      flushTable();
      flushQuote();
      const dashCount = hr[0].length;
      const level = dashCount === 3 ? 1 : dashCount === 4 ? 2 : 3;
      nodes.push(
        makeElement("hr", [], { "hr-level": level }, i, lineCharStart),
      );
      continue;
    }
    const img = line.match(imageMacroRe);
    if (img) {
      flushPara();
      flushList();
      flushTable();
      flushQuote();
      const desc = img[1] || "";
      const url = img[2];
      const macro: Record<string, string | boolean> = {};
      if (img[3]) {
        for (const pair of img[3].split(",")) {
          const m = pair.match(/^\s*([a-z][a-z0-9-]*)(?:=([^,]+))?\s*$/i);
          if (m) {
            if (m[2] === undefined) macro[m[1]!.toLowerCase()] = true;
            else macro[m[1]!.toLowerCase()] = m[2]!.replace(/\s+/g, " ");
          }
        }
      }
      const isVideo = macro["media"] === "video" || videoExts.test(url);
      const mediaAttrs: MdAttrs = { src: url };
      for (const [k, v] of Object.entries(macro)) {
        mediaAttrs[k] = v;
      }
      const mediaEl = makeElement(
        isVideo ? "video" : "img",
        [],
        mediaAttrs,
        i,
        lineCharStart,
      );
      const figureChildren: MdNode[] = [mediaEl];
      if (desc) {
        figureChildren.push(
          makeElement(
            "figcaption",
            [{ type: "text", text: desc }],
            undefined,
            i,
            lineCharStart,
          ),
        );
      }
      nodes.push(
        makeElement(
          "figure",
          figureChildren,
          { class: "image-block" },
          i,
          lineCharStart,
        ),
      );
      continue;
    }
    const tableRow = line.match(/^\|(.+)\|$/);
    if (tableRow) {
      flushPara();
      flushList();
      flushQuote();
      if (currTable.length === 0) {
        tableStartLine = i;
        tableStartChar = lineCharStart;
      }
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
      if (currQuote.length === 0) {
        quoteStartLine = i;
        quoteStartChar = lineCharStart;
      }
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
    const h = line.match(/^(#{1,6}) (.+)$/);
    if (h) {
      flushPara();
      flushList();
      flushTable();
      flushQuote();
      const level = h[1].length;
      nodes.push(
        makeElement(
          `h${level}`,
          parseInline(h[2]),
          undefined,
          i,
          lineCharStart,
        ),
      );
      continue;
    }
    const li = line.match(/^(\s*)-(\+|:)? (.+)$/);
    if (li) {
      flushPara();
      flushTable();
      flushQuote();
      const level = Math.floor(li[1].length / 2);
      const bulletMark = li[2];
      const text = li[3];
      const bullet =
        bulletMark === "+" ? "number" : bulletMark === ":" ? "none" : undefined;

      while (
        currList.length > 0 &&
        currList[currList.length - 1].level > level
      ) {
        const done = currList.pop();
        const attrs = done?.bullet ? { bullet: done.bullet } : undefined;
        if (currList.length === 0) {
          nodes.push(inheritPosFromFirstChild("ul", done!.items, attrs));
        } else {
          const parentItems = currList[currList.length - 1].items;
          const lastLi =
            parentItems.length > 0
              ? parentItems[parentItems.length - 1]
              : undefined;
          if (lastLi && lastLi.type === "element" && lastLi.tag === "li") {
            if (!lastLi.children) lastLi.children = [];
            lastLi.children.push(
              inheritPosFromFirstChild("ul", done!.items, attrs),
            );
          }
        }
      }
      if (
        currList.length === 0 ||
        currList[currList.length - 1].level < level
      ) {
        currList.push({ level, items: [], bullet });
      } else {
        if (!currList[currList.length - 1].bullet && bullet) {
          currList[currList.length - 1].bullet = bullet;
        }
      }
      currList[currList.length - 1].items.push(
        makeElement("li", parseInline(text), undefined, i, lineCharStart),
      );
      continue;
    }
    if (currList.length > 0) {
      flushList();
    }
    if (currPara.length === 0) {
      paraStartLine = i;
      paraStartChar = lineCharStart;
    }
    currPara.push(line);
  }
  flushPara();
  flushList();
  flushTable();
  flushQuote();
  if (inCode && codeLines.length > 0) {
    nodes.push(
      makeElement(
        "pre",
        [{ type: "text", text: codeLines.join("\n") }],
        (() => {
          const a: MdAttrs = {};
          if (codeLang) a["pre-mode"] = codeLang;
          if (codeStyle) a["pre-style"] = codeStyle;
          return Object.keys(a).length ? a : undefined;
        })(),
        codeStartLine >= 0 ? codeStartLine : undefined,
        codeStartChar >= 0 ? codeStartChar : undefined,
      ),
    );
  }
  return nodes;
}

export function getDomRootOrThrow(html: string): {
  document: Document;
  root: Element | Document;
} {
  if (typeof html !== "string") throw new Error("html must be a string");
  if (typeof DOMParser === "undefined")
    throw new Error("DOMParser is not available");
  const doc = new DOMParser().parseFromString(html, "text/html");
  const body = doc.querySelector("body");
  const root: Element | Document = body ? body : doc;
  return { document: doc, root };
}

export function parseHtml(
  html: string,
  opts?: { baseFontSizePt?: number },
): MdNode[] {
  const basePt = opts?.baseFontSizePt ?? 11;
  const { root } = getDomRootOrThrow(html);
  const result: MdNode[] = [];
  const isHidden = (tag: string) =>
    tag === "head" ||
    tag === "meta" ||
    tag === "script" ||
    tag === "link" ||
    tag === "canvas" ||
    tag === "style" ||
    tag === "template" ||
    tag === "noscript";
  const isTextNode = (n: MdNode): n is MdTextNode => n.type === "text";
  const t = (text: string): MdTextNode => ({ type: "text", text });
  const e = (
    tag: string,
    children: MdNode[],
    attrs?: MdAttrs,
  ): MdElementNode => {
    const node: MdElementNode = { type: "element", tag, children };
    if (attrs && Object.keys(attrs).length) node.attrs = attrs;
    return node;
  };
  const parseStyle = (
    styleAttr: string | null | undefined,
  ): Record<string, string> => {
    const m: Record<string, string> = {};
    if (!styleAttr) return m;
    const parts = styleAttr
      .split(";")
      .map((s) => s.trim())
      .filter(Boolean);
    for (const part of parts) {
      const i = part.indexOf(":");
      if (i >= 0) {
        const k = part.slice(0, i).trim().toLowerCase();
        const v = part.slice(i + 1).trim();
        m[k] = v;
      }
    }
    return m;
  };
  const isWhiteLike = (v: string) => {
    const s = v.trim().toLowerCase().replace(/\s+/g, "");
    return (
      s === "white" ||
      s === "#fff" ||
      s === "#ffffff" ||
      s === "rgb(255,255,255)" ||
      s === "transparent"
    );
  };
  const ptFromCss = (v: string | undefined): number | null => {
    if (!v) return null;
    const s = v.trim().toLowerCase();
    if (s.endsWith("pt")) return parseFloat(s);
    if (s.endsWith("%")) return (parseFloat(s) / 100) * basePt;
    return null;
  };
  const marksFromStyle = (styleAttr: string | null | undefined) => {
    const s = parseStyle(styleAttr);
    const marks: {
      strong?: true;
      em?: true;
      s?: true;
      u?: true;
      code?: true;
      mark?: true;
      small?: true;
      align?: "center" | "right";
      bulletNone?: true;
    } = {};
    const fw = (s["font-weight"] || "").toLowerCase();
    const fwNum = /^\d+$/.test(fw) ? parseInt(fw, 10) : NaN;
    if (fw === "bold" || fw === "bolder" || fwNum >= 600) marks.strong = true;
    const fs = (s["font-style"] || "").toLowerCase();
    if (fs === "italic" || fs === "oblique") marks.em = true;
    const td = (s["text-decoration"] || "").toLowerCase();
    if (td.includes("line-through")) marks.s = true;
    if (td.includes("underline")) marks.u = true;
    const ff = (s["font-family"] || "").toLowerCase();
    if (ff.includes("monospace")) marks.code = true;
    const bg = s["background-color"];
    if (bg && !isWhiteLike(bg)) marks.mark = true;
    const fz = ptFromCss(s["font-size"]);
    if (fz !== null && fz <= basePt * 0.85) marks.small = true;
    const ta = (s["text-align"] || "").toLowerCase();
    if (ta === "center") marks.align = "center";
    if (ta === "right") marks.align = "right";
    if ((s["list-style"] || "").toLowerCase() === "none")
      marks.bulletNone = true;
    return marks;
  };
  const alignFromStyle = (
    styleAttr: string | null | undefined,
  ): "center" | "right" | undefined => {
    const ta = (parseStyle(styleAttr)["text-align"] || "").toLowerCase();
    if (ta === "center") return "center";
    if (ta === "right") return "right";
    return undefined;
  };
  const firstVideoSrc = (el: Element): string | null => {
    const direct = el.getAttribute("src");
    if (direct) return direct;
    const s = el.querySelector("source");
    return s ? s.getAttribute("src") : null;
  };
  const wrapMarks = (
    children: MdNode[],
    marks: ReturnType<typeof marksFromStyle>,
  ): MdNode[] => {
    let cur: MdNode[] = children;
    if (marks.strong) cur = [e("strong", cur)];
    if (marks.em) cur = [e("em", cur)];
    if (marks.s) cur = [e("s", cur)];
    if (marks.u) cur = [e("u", cur)];
    if (marks.code) cur = [e("code", cur)];
    if (marks.mark) cur = [e("mark", cur)];
    if (marks.small) cur = [e("small", cur)];
    return cur;
  };
  const isMediaInline = (n: MdNode) =>
    n.type === "element" && (n.tag === "img" || n.tag === "video");
  const mediaToFigure = (node: MdElementNode): MdElementNode =>
    e("figure", [node], { class: "image-block" });
  const splitInlineToBlocks = (
    inlineNodes: MdNode[],
    blockTag: "p" | "h1" | "h2" | "h3" | "h4" | "h5" | "h6",
    align?: "center" | "right",
  ): MdElementNode[] => {
    const out: MdElementNode[] = [];
    let buf: MdNode[] = [];
    const flush = () => {
      if (buf.length) {
        const attrs: MdAttrs = {};
        if (align) attrs.align = align;
        out.push(
          e(blockTag, buf, Object.keys(attrs).length ? attrs : undefined),
        );
        buf = [];
      }
    };
    for (const n of inlineNodes) {
      if (isMediaInline(n)) {
        flush();
        out.push(mediaToFigure(n as MdElementNode));
      } else {
        buf.push(n);
      }
    }
    flush();
    return out;
  };
  const parseRubyNodes = (ruby: Element): MdNode[] => {
    const kids = Array.from(ruby.childNodes);
    const hasExplicitRb = kids.some(
      (n) => n.nodeType === 1 && (n as Element).tagName.toLowerCase() === "rb",
    );
    if (!hasExplicitRb) {
      const pairs: MdNode[] = [];
      const pendingRb: MdNode[] = [];
      const extras: MdNode[] = [];
      for (const n of kids) {
        if (n.nodeType === 1) {
          const el = n as Element;
          const tag = el.tagName.toLowerCase();
          if (tag === "rt") {
            if (pendingRb.length)
              pairs.push(e("rb", pendingRb.splice(0, pendingRb.length)));
            pairs.push(e("rt", parseInline(el)));
          } else if (tag === "rp") {
          } else {
            extras.push(...parseInline(el));
          }
        } else if (n.nodeType === 3) {
          const s = (n as Text).nodeValue ?? "";
          if (s.length) pendingRb.push(t(s));
        }
      }
      if (pendingRb.length) pairs.push(e("rb", pendingRb));
      if (pairs.length === 0) return extras;
      return [e("ruby", pairs), ...extras];
    }
    const outPairs: MdNode[] = [];
    const extras: MdNode[] = [];
    for (const n of kids) {
      if (n.nodeType === 1) {
        const el = n as Element;
        const tag = el.tagName.toLowerCase();
        if (tag === "rb") outPairs.push(e("rb", parseInline(el)));
        else if (tag === "rt") outPairs.push(e("rt", parseInline(el)));
        else if (tag === "rp") {
        } else extras.push(...parseInline(el));
      } else if (n.nodeType === 3) {
        const s = (n as Text).nodeValue ?? "";
        if (s.length) extras.push(t(s));
      }
    }
    if (outPairs.length === 0) return extras;
    return [e("ruby", outPairs), ...extras];
  };
  const parseInline = (el: Element | Document): MdNode[] => {
    const out: MdNode[] = [];
    const nodes = Array.from(el.childNodes);
    for (const n of nodes) {
      if (n.nodeType === 3) {
        const text = (n as Text).nodeValue ?? "";
        if (text.length) out.push(t(text));
      } else if (n.nodeType === 1) {
        const x = n as Element;
        const tag = x.tagName.toLowerCase();
        if (isHidden(tag)) continue;

        if (tag === "b" || tag === "strong") {
          out.push(e("strong", parseInline(x)));
          continue;
        }
        if (tag === "i" || tag === "em") {
          out.push(e("em", parseInline(x)));
          continue;
        }
        if (tag === "u") {
          out.push(e("u", parseInline(x)));
          continue;
        }
        if (tag === "s" || tag === "strike" || tag === "del") {
          out.push(e("s", parseInline(x)));
          continue;
        }
        if (tag === "code" || tag === "kbd") {
          out.push(e("code", parseInline(x)));
          continue;
        }
        if (tag === "mark") {
          out.push(e("mark", parseInline(x)));
          continue;
        }
        if (tag === "small") {
          out.push(e("small", parseInline(x)));
          continue;
        }
        if (tag === "span") {
          const marks = marksFromStyle(x.getAttribute("style"));
          const wrapped = wrapMarks(parseInline(x), marks);
          out.push(...wrapped);
          continue;
        }
        if (tag === "ruby") {
          out.push(...parseRubyNodes(x));
          continue;
        }
        if (tag === "a") {
          const href = x.getAttribute("href") || "";
          out.push(e("a", parseInline(x), href ? { href } : undefined));
          continue;
        }
        if (tag === "br") {
          out.push(e("br", []));
          continue;
        }
        if (tag === "img") {
          const src = x.getAttribute("src") || "";
          const alt = x.getAttribute("alt") || "";
          out.push(e("img", [], alt ? { src, alt } : { src }));
          continue;
        }
        if (tag === "video") {
          const src = firstVideoSrc(x) || "";
          out.push(e("video", [], src ? { src } : undefined));
          continue;
        }
        out.push(...parseInline(x));
      }
    }
    return out;
  };
  const makeInlineForElement = (el: Element): MdNode[] => {
    const tag = el.tagName.toLowerCase();
    if (tag === "b" || tag === "strong") return [e("strong", parseInline(el))];
    if (tag === "i" || tag === "em") return [e("em", parseInline(el))];
    if (tag === "u") return [e("u", parseInline(el))];
    if (tag === "s" || tag === "strike" || tag === "del")
      return [e("s", parseInline(el))];
    if (tag === "code" || tag === "kbd") return [e("code", parseInline(el))];
    if (tag === "mark") return [e("mark", parseInline(el))];
    if (tag === "small") return [e("small", parseInline(el))];
    if (tag === "span")
      return wrapMarks(
        parseInline(el),
        marksFromStyle(el.getAttribute("style")),
      );
    if (tag === "ruby") return parseRubyNodes(el);
    if (tag === "a") {
      const href = el.getAttribute("href") || "";
      return [e("a", parseInline(el), href ? { href } : undefined)];
    }
    if (tag === "br") return [e("br", [])];
    return parseInline(el);
  };
  const listAttrsFor = (listEl: Element): MdAttrs | undefined => {
    const tag = listEl.tagName.toLowerCase();
    const { bulletNone } = marksFromStyle(listEl.getAttribute("style"));
    const attrs: MdAttrs = {};
    if (bulletNone) {
      attrs.bullet = "none";
    } else if (tag === "ol") {
      attrs.bullet = "number";
    }
    return Object.keys(attrs).length ? attrs : undefined;
  };
  const extractPreAttrs = (preEl: Element): MdAttrs | undefined => {
    const attrs: MdAttrs = {};
    const cls = (preEl.getAttribute("class") || "").toLowerCase();
    const m1 = cls.match(/\b(?:language|lang)-([a-z0-9._+-]+)\b/);
    let mode =
      preEl.getAttribute("data-pre-mode") ||
      (() => {
        const code = preEl.querySelector("code");
        const pick = (el: Element | null) => {
          if (!el) return undefined;
          const c = (el.getAttribute("class") || "").toLowerCase();
          const m = c.match(/\b(?:language|lang)-([a-z0-9._+-]+)\b/);
          return m ? m[1]! : undefined;
        };
        return pick(code) || (m1 ? m1[1]! : undefined);
      })();
    const style = preEl.getAttribute("data-pre-style");
    if (mode) attrs["pre-mode"] = mode;
    if (style) attrs["pre-style"] = style;
    return Object.keys(attrs).length ? attrs : undefined;
  };
  const parseList = (listEl: Element): MdElementNode => {
    const lis = Array.from(listEl.children).filter(
      (c) => c.tagName.toLowerCase() === "li",
    ) as Element[];
    const liNodes = lis.map((li) => parseListItem(li));
    return e("ul", liNodes, listAttrsFor(listEl));
  };
  const parseListItem = (li: Element): MdElementNode => {
    const sink: MdNode[] = [];
    const inlineBuf: MdNode[] = [];

    const flushInline = () => {
      if (!inlineBuf.length) return;
      const blocks = splitInlineToBlocks(inlineBuf, "p");
      if (blocks.length === 1 && blocks[0].tag === "p") {
        sink.push(...blocks[0].children);
      } else {
        sink.push(...(blocks as MdNode[]));
      }
      inlineBuf.length = 0;
    };
    const kids = Array.from(li.childNodes);
    for (const n of kids) {
      if (n.nodeType === 3) {
        const text = (n as Text).nodeValue ?? "";
        if (text.length) inlineBuf.push(t(text));
        continue;
      }
      if (n.nodeType !== 1) continue;
      const el = n as Element;
      const tag = el.tagName.toLowerCase();
      if (isHidden(tag)) continue;
      if (tag === "ul" || tag === "ol") {
        flushInline();
        sink.push(parseList(el));
        continue;
      }
      if (
        tag === "h1" ||
        tag === "h2" ||
        tag === "h3" ||
        tag === "h4" ||
        tag === "h5" ||
        tag === "h6"
      ) {
        flushInline();
        const align = alignFromStyle(el.getAttribute("style"));
        const blocks = splitInlineToBlocks(
          parseInline(el),
          tag as "h1" | "h2" | "h3" | "h4" | "h5" | "h6",
          align,
        );
        sink.push(...blocks);
        continue;
      }
      if (tag === "p") {
        flushInline();
        const align = alignFromStyle(el.getAttribute("style"));
        const blocks = splitInlineToBlocks(parseInline(el), "p", align);
        sink.push(...blocks);
        continue;
      }
      if (tag === "blockquote") {
        flushInline();
        sink.push(e("blockquote", parseInline(el)));
        continue;
      }
      if (tag === "table") {
        flushInline();
        const rows: Element[] = [];
        const children = Array.from(el.children);
        for (const c of children) {
          const ct = c.tagName.toLowerCase();
          if (ct === "tr") rows.push(c);
          else if (ct === "thead" || ct === "tbody" || ct === "tfoot")
            rows.push(
              ...(Array.from(c.children).filter(
                (x) => x.tagName.toLowerCase() === "tr",
              ) as Element[]),
            );
        }
        const tableChildren: MdNode[] = [];
        for (const tr of rows) {
          const cells = Array.from(tr.children).filter((x) => {
            const tt = x.tagName.toLowerCase();
            return tt === "td" || tt === "th";
          }) as Element[];
          const cellNodes: MdNode[] = [];
          for (const c of cells) {
            const align = alignFromStyle(c.getAttribute("style"));
            const attrs: MdAttrs = {};
            if (align) attrs.align = align;

            const csRaw = c.getAttribute("colspan");
            const rsRaw = c.getAttribute("rowspan");
            const cs = csRaw ? parseInt(csRaw, 10) : NaN;
            const rs = rsRaw ? parseInt(rsRaw, 10) : NaN;
            if (!Number.isNaN(cs) && cs > 1) attrs.colspan = cs;
            if (!Number.isNaN(rs) && rs > 1) attrs.rowspan = rs;

            cellNodes.push(
              e(
                c.tagName.toLowerCase(),
                parseTableCellInline(c),
                Object.keys(attrs).length ? attrs : undefined,
              ),
            );
          }
          tableChildren.push(e("tr", cellNodes));
        }
        sink.push(e("table", tableChildren));
        continue;
      }
      if (tag === "img") {
        flushInline();
        const src = el.getAttribute("src") || "";
        const alt = el.getAttribute("alt") || "";
        sink.push(
          e("figure", [e("img", [], alt ? { src, alt } : { src })], {
            class: "image-block",
          }),
        );
        continue;
      }
      if (tag === "video") {
        flushInline();
        const src = firstVideoSrc(el) || "";
        sink.push(
          e("figure", [e("video", [], src ? { src } : undefined)], {
            class: "image-block",
          }),
        );
        continue;
      }
      if (tag === "pre") {
        flushInline();
        const txtRaw = el.textContent ?? "";
        const txt = trimPreText(txtRaw);
        const preAttrs = extractPreAttrs(el);
        sink.push(e("pre", [t(txt)], preAttrs));
        continue;
      }
      if (tag === "hr") {
        flushInline();
        const levelRaw = el.getAttribute("data-hr-level");
        const level = levelRaw ? parseInt(levelRaw, 10) : NaN;
        const attrs: MdAttrs | undefined =
          !Number.isNaN(level) && level >= 1
            ? { "hr-level": level }
            : undefined;
        sink.push(e("hr", [], attrs));
        continue;
      }
      if (
        tag === "div" ||
        tag === "section" ||
        tag === "article" ||
        tag === "main"
      ) {
        flushInline();
        const tmp: MdNode[] = [];
        parseBlock(el, tmp);
        sink.push(...tmp);
        continue;
      }
      const inlineFromEl = makeInlineForElement(el);
      inlineBuf.push(...inlineFromEl);
    }
    flushInline();
    return e("li", sink);
  };
  const parseTableCellInline = (cell: Element): MdNode[] => {
    const inline = parseInline(cell);
    const out: MdNode[] = [];
    for (const n of inline) {
      if (isMediaInline(n)) out.push(mediaToFigure(n as MdElementNode));
      else out.push(n);
    }
    return out;
  };
  const flushInlineBufTo = (sink: MdNode[], inlineBuf: MdNode[]) => {
    if (!inlineBuf.length) return;
    const blocks = splitInlineToBlocks(inlineBuf, "p");
    for (const b of blocks) sink.push(b);
    inlineBuf.length = 0;
  };
  const trimPreText = (s: string): string => {
    const lines = s.replace(/\r\n?/g, "\n").split("\n");
    if (lines.length && lines[0].trim() === "") lines.shift();
    if (lines.length && lines[lines.length - 1].trim() === "") lines.pop();
    return lines.join("\n");
  };
  const parseBlock = (scope: Element | Document, sink: MdNode[]) => {
    const kids = Array.from(scope.childNodes);
    const inlineBuf: MdNode[] = [];
    for (const n of kids) {
      if (n.nodeType === 3) {
        const text = (n as Text).nodeValue ?? "";
        if (text.length) inlineBuf.push(t(text));
        continue;
      }
      if (n.nodeType === 1) {
        const el = n as Element;
        const tag = el.tagName.toLowerCase();
        if (isHidden(tag)) continue;
        if (
          tag === "h1" ||
          tag === "h2" ||
          tag === "h3" ||
          tag === "h4" ||
          tag === "h5" ||
          tag === "h6"
        ) {
          flushInlineBufTo(sink, inlineBuf);
          const align = alignFromStyle(el.getAttribute("style"));
          const blocks = splitInlineToBlocks(
            parseInline(el),
            tag as "h1" | "h2" | "h3" | "h4" | "h5" | "h6",
            align,
          );
          for (const b of blocks) sink.push(b);
          continue;
        }
        if (tag === "p") {
          flushInlineBufTo(sink, inlineBuf);
          const align = alignFromStyle(el.getAttribute("style"));
          const blocks = splitInlineToBlocks(parseInline(el), "p", align);
          for (const b of blocks) sink.push(b);
          continue;
        }
        if (tag === "blockquote") {
          flushInlineBufTo(sink, inlineBuf);
          sink.push(e("blockquote", parseInline(el)));
          continue;
        }
        if (tag === "ul" || tag === "ol") {
          flushInlineBufTo(sink, inlineBuf);
          sink.push(parseList(el));
          continue;
        }
        if (tag === "table") {
          flushInlineBufTo(sink, inlineBuf);
          const rows: Element[] = [];
          const children = Array.from(el.children);
          for (const c of children) {
            const ct = c.tagName.toLowerCase();
            if (ct === "tr") rows.push(c);
            else if (ct === "thead" || ct === "tbody" || ct === "tfoot")
              rows.push(
                ...(Array.from(c.children).filter(
                  (x) => x.tagName.toLowerCase() === "tr",
                ) as Element[]),
              );
          }
          const tableChildren: MdNode[] = [];
          for (const tr of rows) {
            const cells = Array.from(tr.children).filter((x) => {
              const tt = x.tagName.toLowerCase();
              return tt === "td" || tt === "th";
            }) as Element[];
            const cellNodes: MdNode[] = [];
            for (const c of cells) {
              const align = alignFromStyle(c.getAttribute("style"));
              const attrs: MdAttrs = {};
              if (align) attrs.align = align;

              const csRaw = c.getAttribute("colspan");
              const rsRaw = c.getAttribute("rowspan");
              const cs = csRaw ? parseInt(csRaw, 10) : NaN;
              const rs = rsRaw ? parseInt(rsRaw, 10) : NaN;
              if (!Number.isNaN(cs) && cs > 1) attrs.colspan = cs;
              if (!Number.isNaN(rs) && rs > 1) attrs.rowspan = rs;

              cellNodes.push(
                e(
                  c.tagName.toLowerCase(),
                  parseTableCellInline(c),
                  Object.keys(attrs).length ? attrs : undefined,
                ),
              );
            }
            tableChildren.push(e("tr", cellNodes));
          }
          sink.push(e("table", tableChildren));
          continue;
        }
        if (tag === "img") {
          flushInlineBufTo(sink, inlineBuf);
          const src = el.getAttribute("src") || "";
          const alt = el.getAttribute("alt") || "";
          sink.push(
            e("figure", [e("img", [], alt ? { src, alt } : { src })], {
              class: "image-block",
            }),
          );
          continue;
        }
        if (tag === "video") {
          flushInlineBufTo(sink, inlineBuf);
          const src = firstVideoSrc(el) || "";
          sink.push(
            e("figure", [e("video", [], src ? { src } : undefined)], {
              class: "image-block",
            }),
          );
          continue;
        }
        if (tag === "pre") {
          flushInlineBufTo(sink, inlineBuf);
          const txtRaw = el.textContent ?? "";
          const txt = trimPreText(txtRaw);
          const preAttrs = extractPreAttrs(el);
          sink.push(e("pre", [t(txt)], preAttrs));
          continue;
        }
        if (tag === "hr") {
          flushInlineBufTo(sink, inlineBuf);
          const levelRaw = el.getAttribute("data-hr-level");
          const level = levelRaw ? parseInt(levelRaw, 10) : NaN;
          const attrs: MdAttrs | undefined =
            !Number.isNaN(level) && level >= 1
              ? { "hr-level": level }
              : undefined;
          sink.push(e("hr", [], attrs));
          continue;
        }
        if (
          tag === "div" ||
          tag === "section" ||
          tag === "article" ||
          tag === "main"
        ) {
          flushInlineBufTo(sink, inlineBuf);
          parseBlock(el, sink);
          continue;
        }
        const inlineFromEl = makeInlineForElement(el);
        inlineBuf.push(...inlineFromEl);
      }
    }
    flushInlineBufTo(sink, inlineBuf);
  };
  const isPreLike = (tag: string) => tag === "pre";
  const isBlockContainer = (tag: string) =>
    tag === "p" ||
    tag === "li" ||
    tag === "blockquote" ||
    tag === "h1" ||
    tag === "h2" ||
    tag === "h3" ||
    tag === "h4" ||
    tag === "h5" ||
    tag === "h6" ||
    tag === "td" ||
    tag === "th";
  const flattenSameMarksOnce = (node: MdElementNode): MdElementNode => {
    const flatSet = new Set<string>([
      "strong",
      "em",
      "s",
      "u",
      "code",
      "mark",
      "small",
    ]);
    if (!flatSet.has(node.tag)) return node;
    const flat: MdNode[] = [];
    for (const ch of node.children) {
      if (
        ch.type === "element" &&
        ch.tag === node.tag &&
        (!ch.attrs || Object.keys(ch.attrs).length === 0)
      )
        flat.push(...ch.children);
      else flat.push(ch);
    }
    return e(node.tag, flat, node.attrs);
  };
  const attrsKey = (attrs?: MdAttrs): string => {
    if (!attrs) return "";
    const keys = Object.keys(attrs).sort();
    return keys.map((k) => `${k}:${String((attrs as MdAttrs)[k])}`).join("|");
  };
  const mergeAdjacentMarks = (children: MdNode[]): MdNode[] => {
    const markSet = new Set<string>([
      "strong",
      "em",
      "s",
      "u",
      "code",
      "mark",
      "small",
    ]);
    const out: MdNode[] = [];
    for (const node of children) {
      if (out.length > 0 && node.type === "element") {
        const prev = out[out.length - 1];
        if (
          prev.type === "element" &&
          markSet.has(prev.tag) &&
          prev.tag === node.tag &&
          attrsKey(prev.attrs) === attrsKey(node.attrs)
        ) {
          prev.children = [...prev.children, ...node.children];
          continue;
        }
      }
      out.push(node);
    }
    return out;
  };
  const mergeAdjacentText = (children: MdNode[]): MdNode[] => {
    const out: MdNode[] = [];
    for (const node of children) {
      if (isTextNode(node) && out.length && isTextNode(out[out.length - 1])) {
        (out[out.length - 1] as MdTextNode).text += node.text;
      } else {
        out.push(node);
      }
    }
    return out;
  };
  const normalizeTextWhitespace = (children: MdNode[]): MdNode[] => {
    for (const ch of children) {
      if (isTextNode(ch)) ch.text = ch.text.replace(/\s+/g, " ");
    }
    return children;
  };
  const trimBlockTextEdges = (children: MdNode[]): MdNode[] => {
    if (!children.length) return children;
    const first = children[0];
    if (isTextNode(first)) first.text = first.text.replace(/^\s+/, "");
    const last = children[children.length - 1];
    if (isTextNode(last)) last.text = last.text.replace(/\s+$/, "");
    return children;
  };
  const removeEmptyTextNodes = (nodes: MdNode[]) =>
    nodes.filter(
      (ch) => !(isTextNode(ch) && (ch as MdTextNode).text.length === 0),
    );
  const VOID_OR_ATOMIC = new Set<string>([
    "area",
    "base",
    "br",
    "col",
    "embed",
    "hr",
    "img",
    "input",
    "link",
    "meta",
    "param",
    "source",
    "track",
    "wbr",
    "video",
  ]);
  const EXEMPT_EMPTY = new Set<string>(["tr", "td", "th"]);
  const isDroppableWhenEmpty = (tag: string) =>
    !VOID_OR_ATOMIC.has(tag) && !EXEMPT_EMPTY.has(tag);
  const postProcess = (nodes: MdNode[], ancestorPre: boolean): MdNode[] => {
    const out: MdNode[] = [];
    for (const n of nodes) {
      if (n.type === "text") {
        if (n.text.length) out.push({ type: "text", text: n.text });
        continue;
      }
      const tag = n.tag;
      const nextAncestorPre = ancestorPre || isPreLike(tag);
      let kids = postProcess(n.children, nextAncestorPre);
      kids = mergeAdjacentMarks(kids);
      kids = mergeAdjacentText(kids);
      if (!nextAncestorPre) {
        kids = normalizeTextWhitespace(kids);
        if (isBlockContainer(tag)) kids = trimBlockTextEdges(kids);
      }
      kids = removeEmptyTextNodes(kids);
      let el = e(tag, kids, n.attrs);
      el = flattenSameMarksOnce(el);
      if (isDroppableWhenEmpty(tag) && el.children.length === 0) {
        continue;
      }
      out.push(el);
    }
    return out;
  };
  parseBlock(root as Element | Document, result);
  return postProcess(result, false);
}

export function structurizeHtml(
  html: string,
  opts?: { topMinFontSizePt?: number },
): string {
  const minPt =
    typeof opts?.topMinFontSizePt === "number" ? opts.topMinFontSizePt : 20;
  const hadBodyTag = /<body[\s>]/i.test(html);
  const { document: doc, root: domRoot } = getDomRootOrThrow(html);
  const isBlockTag = (tag: string): boolean => {
    const t = tag.toLowerCase();
    return (
      t === "p" ||
      t === "div" ||
      t === "pre" ||
      t === "blockquote" ||
      t === "figure" ||
      t === "figcaption" ||
      t === "ul" ||
      t === "ol" ||
      t === "li" ||
      t === "table" ||
      t === "thead" ||
      t === "tbody" ||
      t === "tfoot" ||
      t === "tr" ||
      t === "td" ||
      t === "th" ||
      t === "section" ||
      t === "article" ||
      t === "aside" ||
      t === "header" ||
      t === "footer" ||
      t === "nav" ||
      t === "hr" ||
      t === "h1" ||
      t === "h2" ||
      t === "h3" ||
      t === "h4" ||
      t === "h5" ||
      t === "h6"
    );
  };
  const hasBlockDescendant = (el: Element): boolean => {
    return !!el.querySelector(
      "p,div,pre,blockquote,figure,figcaption,ul,ol,li,table,thead,tbody,tfoot,tr,td,th,section,article,aside,header,footer,nav,hr,h1,h2,h3,h4,h5,h6",
    );
  };
  const isInlineElement = (el: Element): boolean => {
    if (isBlockTag(el.tagName)) return false;
    const t = el.tagName.toLowerCase();
    if (t === "br") return true;
    if (t === "script" || t === "style") return false;
    return true;
  };
  const unwrap = (el: Element) => {
    const parent = el.parentNode;
    if (!parent) return;
    while (el.firstChild) parent.insertBefore(el.firstChild, el);
    parent.removeChild(el);
  };
  const stage1UnwrapInlineContainingBlocks = (rootEl: Element) => {
    const candidates = Array.from(rootEl.querySelectorAll("*")) as Element[];
    const toUnwrap: Element[] = [];
    for (const el of candidates)
      if (isInlineElement(el) && hasBlockDescendant(el)) toUnwrap.push(el);
    for (const el of toUnwrap) unwrap(el);
  };
  const stage2MergeAdjacentPsByBr = (rootEl: Element) => {
    const stack: Element[] = [rootEl];
    while (stack.length) {
      const parent = stack.pop() as Element;
      let i = 0;
      while (i < parent.childNodes.length) {
        const start = parent.childNodes[i];
        if (
          !(
            start &&
            start.nodeType === Node.ELEMENT_NODE &&
            (start as Element).tagName.toLowerCase() === "p"
          )
        ) {
          i++;
          continue;
        }
        let j = i;
        const run: Node[] = [];
        while (j < parent.childNodes.length) {
          const n = parent.childNodes[j];
          if (n.nodeType === Node.ELEMENT_NODE) {
            const tag = (n as Element).tagName.toLowerCase();
            if (tag === "p" || tag === "br") {
              run.push(n);
              j++;
              continue;
            }
          }
          break;
        }
        if (run.length === 1) {
          i++;
          continue;
        }
        const segments: Element[][] = [];
        let current: Element[] = [];
        for (const n of run) {
          const tag = (n as Element).tagName?.toLowerCase?.() || "";
          if (tag === "br") {
            if (current.length > 0) {
              segments.push(current);
              current = [];
            }
          } else if (tag === "p") current.push(n as Element);
        }
        if (current.length > 0) segments.push(current);
        const insertionPoint = parent.childNodes[i];
        for (const group of segments) {
          const newP = doc.createElement("p");
          for (const attr of Array.from(group[0].attributes))
            newP.setAttribute(attr.name, attr.value);
          for (let gi = 0; gi < group.length; gi++) {
            if (gi > 0) newP.appendChild(doc.createElement("br"));
            const p = group[gi];
            while (p.firstChild) newP.appendChild(p.firstChild);
          }
          parent.insertBefore(newP, insertionPoint);
        }
        for (const n of run) parent.removeChild(n);
        i += segments.length;
      }
      for (const child of Array.from(parent.children)) stack.push(child);
    }
  };
  const parseFontSizePtFromStyle = (style: string): number | null => {
    const m = /font-size\s*:\s*([0-9.]+)\s*(pt|px)/i.exec(style);
    if (!m) return null;
    const v = parseFloat(m[1]);
    const unit = m[2].toLowerCase();
    if (unit === "pt") return v;
    if (unit === "px") return v * 0.75;
    return null;
  };
  const onlyWhitespaceText = (n: Node): boolean => {
    return n.nodeType === Node.TEXT_NODE && !/\S/.test((n as Text).data || "");
  };
  const pickTitleCandidateP = (
    bodyEl: Element,
    minPtLocal: number,
  ): Element | null => {
    let seenP = 0;
    for (let i = 0; i < bodyEl.childNodes.length && seenP < 5; i++) {
      const n = bodyEl.childNodes[i];
      if (n.nodeType !== Node.ELEMENT_NODE) continue;
      const el = n as Element;
      if (el.tagName.toLowerCase() !== "p") continue;
      seenP++;
      const elementChildren = Array.from(el.childNodes).filter(
        (x) => x.nodeType === Node.ELEMENT_NODE,
      ) as Element[];
      const otherNodes = Array.from(el.childNodes).filter(
        (x) => x.nodeType !== Node.ELEMENT_NODE,
      );
      if (elementChildren.length !== 1) continue;
      if (!otherNodes.every(onlyWhitespaceText)) continue;
      const child = elementChildren[0];
      if (child.tagName.toLowerCase() !== "span") continue;
      const style = child.getAttribute("style") || "";
      const pt = parseFontSizePtFromStyle(style);
      if (pt !== null && pt >= minPtLocal) return el;
    }
    return null;
  };
  const replaceTagKeepAttrsAndChildren = (
    el: Element,
    newTag: string,
  ): Element => {
    const ne = doc.createElement(newTag);
    for (const attr of Array.from(el.attributes))
      ne.setAttribute(attr.name, attr.value);
    while (el.firstChild) ne.appendChild(el.firstChild);
    el.parentNode!.replaceChild(ne, el);
    return ne;
  };
  const stage3PromoteTitleAndDemoteHeadings = (
    bodyEl: Element,
    minPtLocal: number,
  ) => {
    const titleP = pickTitleCandidateP(bodyEl, minPtLocal);
    if (!titleP) return;
    const heads = bodyEl.querySelectorAll("h1,h2,h3,h4,h5");
    const list = Array.from(heads) as Element[];
    for (const h of list) {
      const level = parseInt(h.tagName.substring(1), 10);
      if (level >= 1 && level <= 5)
        replaceTagKeepAttrsAndChildren(h, "h" + (level + 1));
    }
    replaceTagKeepAttrsAndChildren(titleP, "h1");
  };
  const workBody: Element = (() => {
    if (hadBodyTag) {
      const bodyFound = domRoot.querySelector("body");
      if (bodyFound) return bodyFound;
      if (doc.body) return doc.body;
      return doc.createElement("body");
    } else {
      const div = doc.createElement("div");
      div.innerHTML = html || "";
      return div;
    }
  })();
  stage1UnwrapInlineContainingBlocks(workBody);
  stage2MergeAdjacentPsByBr(workBody);
  stage3PromoteTitleAndDemoteHeadings(workBody, minPt);
  if (hadBodyTag) return doc.documentElement.outerHTML;
  return workBody.innerHTML;
}

export type MdRewriteRule = {
  pattern: RegExp;
  replacement: string;
};

export function mdRewriteLinkUrls(
  nodes: MdNode[],
  rules: MdRewriteRule[],
): MdNode[] {
  if (!rules.length) return nodes;
  const applyRules = (href: string) =>
    rules.reduce((u, r) => u.replace(r.pattern, r.replacement), href);
  const rewriteOne = (n: MdNode): MdNode => {
    if (n.type !== "element") return n;
    const children = (n.children || []).map(rewriteOne);
    if (n.tag !== "a") {
      return { ...n, children };
    }
    const a = n.attrs || {};
    const href = typeof a.href === "string" ? a.href : null;
    if (!href) {
      return { ...n, children };
    }
    const newHref = applyRules(href);
    if (newHref === href) {
      return { ...n, children };
    }
    return {
      ...n,
      attrs: { ...a, href: newHref },
      children,
    };
  };
  return nodes.map(rewriteOne);
}

export type MdMediaRewriteOptions = {
  allowedPatterns: RegExp[];
  alternativeImage: string;
  rewriteRules: MdRewriteRule[];
  maxObjects?: number;
};

export function mdRewriteMediaUrls(
  nodes: MdNode[],
  opts: MdMediaRewriteOptions,
): MdNode[] {
  let mediaCount = 0;
  const allowedByPattern = (src: string) =>
    opts.allowedPatterns.some((re) => re.test(src));
  const isAllowedNow = (src: string) => {
    mediaCount += 1;
    if (opts.maxObjects !== undefined && mediaCount > opts.maxObjects)
      return false;
    return allowedByPattern(src);
  };
  const applyRules = (src: string) =>
    opts.rewriteRules.reduce(
      (u, r) => u.replace(r.pattern, r.replacement),
      src,
    );
  const rewriteOne = (n: MdNode): MdNode => {
    if (n.type !== "element") return n;
    if (n.tag === "img" || n.tag === "video") {
      const a = n.attrs || {};
      const src = typeof a.src === "string" ? a.src : "";
      if (!isAllowedNow(src)) {
        return makeElement(
          "img",
          [],
          { src: opts.alternativeImage },
          n.linePosition,
          n.charPosition,
        );
      }
      return { ...n, attrs: { ...a, src: applyRules(src) } };
    }
    return { ...n, children: (n.children || []).map(rewriteOne) };
  };

  return nodes.map(rewriteOne);
}

export function mdGroupImageGrid(
  nodes: MdNode[],
  opts?: { maxElements?: number },
): MdNode[] {
  const maxElements = Math.max(1, opts?.maxElements ?? 100);
  function isFigureImageBlock(
    n: MdNode,
  ): n is MdElementNode & { tag: "figure" } {
    return (
      n.type === "element" &&
      n.tag === "figure" &&
      n.attrs?.class === "image-block"
    );
  }
  function findMedia(n: MdNode | undefined): MdMediaElement | undefined {
    if (!n || n.type !== "element") return undefined;
    return (n.children || []).find(isMediaElement);
  }
  function hasGridFlag(a?: MdAttrs): boolean {
    if (!a) return false;
    return !!a["grid"];
  }
  function getLine(n: MdNode): number | undefined {
    return n.type === "element" ? n.linePosition : undefined;
  }
  function groupInArray(arr: MdNode[]): MdNode[] {
    const out: MdNode[] = [];
    for (let i = 0; i < arr.length; ) {
      const node = arr[i];
      if (isFigureImageBlock(node) && hasGridFlag(findMedia(node)?.attrs)) {
        const group: MdNode[] = [node];
        let j = i + 1;
        let prevLine = getLine(node);
        while (
          j < arr.length &&
          isFigureImageBlock(arr[j]) &&
          hasGridFlag(findMedia(arr[j])?.attrs)
        ) {
          const candLine = getLine(arr[j]);
          if (
            typeof prevLine === "number" &&
            typeof candLine === "number" &&
            candLine !== prevLine + 1
          ) {
            break;
          }
          group.push(arr[j]);
          prevLine = candLine;
          j++;
        }
        for (let k = 0; k < group.length; k += maxElements) {
          const chunk = group.slice(k, k + maxElements);
          out.push(
            makeElement(
              "div",
              chunk,
              { class: "image-grid", "data-cols": chunk.length },
              undefined,
              undefined,
            ),
          );
        }
        i = j;
        continue;
      }
      if (node.type === "element" && node.children) {
        out.push({ ...node, children: groupInArray(node.children) });
      } else {
        out.push(node);
      }
      i++;
    }
    return out;
  }
  return groupInArray(nodes);
}

export function mdFindFeatured(nodes: MdNode[]): MdElementNode | null {
  function isFigureImageBlock(
    n: MdNode,
  ): n is MdElementNode & { tag: "figure" } {
    return (
      n.type === "element" &&
      n.tag === "figure" &&
      n.attrs?.class === "image-block"
    );
  }
  function findMedia(n: MdNode | undefined): MdMediaElement | undefined {
    if (!n || n.type !== "element") return undefined;
    return (n.children || []).find(
      (c): c is MdMediaElement =>
        c.type === "element" && (c.tag === "img" || c.tag === "video"),
    );
  }
  function findFeaturedFig(arr: MdNode[]): MdElementNode | null {
    for (const node of arr) {
      if (isFigureImageBlock(node)) {
        const media = findMedia(node);
        if (media && media.attrs && media.attrs["featured"]) return node;
      }
      if (node.type === "element" && node.children?.length) {
        const r = findFeaturedFig(node.children);
        if (r) return r;
      }
    }
    return null;
  }
  function findFirstFig(arr: MdNode[]): MdElementNode | null {
    for (const node of arr) {
      if (isFigureImageBlock(node)) {
        const media = findMedia(node);
        if (media) {
          if (!media.attrs || !media.attrs["no-featured"]) return node;
        } else {
          return node;
        }
      }
      if (node.type === "element" && node.children?.length) {
        const r = findFirstFig(node.children);
        if (r) return r;
      }
    }
    return null;
  }
  return findFeaturedFig(nodes) || findFirstFig(nodes);
}

export function mdFilterForFeatured(nodes: MdNode[]): MdNode[] {
  const featuredFig = mdFindFeatured(nodes);
  function removeImageBlocks(arr: MdNode[]): MdNode[] {
    const out: MdNode[] = [];
    for (const n of arr) {
      if (
        n.type === "element" &&
        n.tag === "figure" &&
        n.attrs?.class === "image-block"
      ) {
        continue;
      }
      if (n.type === "element" && n.children?.length) {
        out.push({ ...n, children: removeImageBlocks(n.children) });
      } else {
        out.push(n);
      }
    }
    return out;
  }
  const body = removeImageBlocks(nodes);
  if (featuredFig && featuredFig.type === "element") {
    const thumb: MdElementNode = makeElement(
      "figure",
      featuredFig.children,
      { ...(featuredFig.attrs || {}), class: "featured-block" },
      featuredFig.linePosition,
      featuredFig.charPosition,
    );
    return [thumb, ...body];
  }
  return body;
}

export function mdCutOff(
  nodes: MdNode[],
  params?: {
    maxLen?: number;
    maxHeight?: number;
    imgLen?: number;
    imgHeight?: number;
    captMaxLen?: number;
  },
): MdNode[] {
  const imgLenParam = params?.imgLen ?? 50;
  const dynamicImgCost = imgLenParam < 0;
  const fixedImgLen = Math.max(0, imgLenParam);
  const imgHeight = params?.imgHeight ?? 6;
  const captMaxLen = params?.captMaxLen ?? 25;
  const state = {
    remain:
      typeof params?.maxLen === "number"
        ? params.maxLen!
        : Number.POSITIVE_INFINITY,
    height: 0,
    maxHeight:
      typeof params?.maxHeight === "number"
        ? params!.maxHeight
        : Number.POSITIVE_INFINITY,
    cut: false,
    omittedInserted: false,
  };
  const blockTags = new Set([
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
    "hr",
  ]);
  function getKind(attrs?: MdAttrs): string | undefined {
    if (!attrs) return undefined;
    const k = attrs["kind"];
    if (typeof k === "string") return k;
    const cls = attrs["class"];
    if (typeof cls === "string") {
      const parts = cls.split(/\s+/);
      if (parts.includes("featured-block")) return "featured-block";
      if (parts.includes("image-block")) return "image-block";
    }
    return undefined;
  }
  function isFeaturedFigure(el: MdElementNode): boolean {
    return el.tag === "figure" && getKind(el.attrs) === "featured-block";
  }
  function computeTextMetrics(ns: MdNode[]): {
    length: number;
    newlines: number;
  } {
    let length = 0;
    let newlines = 0;
    for (const n of ns) {
      if (n.type === "text") {
        length += n.text.length;
        newlines += n.text.match(/\n/g)?.length ?? 0;
      } else {
        const r = computeTextMetrics(n.children || []);
        length += r.length;
        newlines += r.newlines;
      }
    }
    return { length, newlines };
  }
  const captionLengthOfFigure = (el: MdElementNode): number => {
    const cap = (el.children || []).find(
      (c): c is MdElementNode => c.type === "element" && c.tag === "figcaption",
    );
    if (!cap) return 0;
    return computeTextMetrics(cap.children || []).length;
  };
  const figureHasMedia = (el: MdElementNode): boolean =>
    (el.children || []).some(
      (c) => c.type === "element" && (c.tag === "img" || c.tag === "video"),
    );
  function bumpHeight(inc: number): boolean {
    const next = state.height + inc;
    if (next > state.maxHeight) return false;
    state.height = next;
    return true;
  }
  function consumeFixedImageBudget(): boolean {
    const nextRemain = state.remain - fixedImgLen;
    const nextHeight = state.height + imgHeight;
    if (nextRemain < 0 || nextHeight > state.maxHeight) return false;
    state.remain = nextRemain;
    state.height = nextHeight;
    return true;
  }
  function consumeDynamicImageBudget(captionLen: number): boolean {
    const nextRemain = state.remain - captionLen;
    const nextHeight = state.height + imgHeight;
    if (nextRemain < 0 || nextHeight > state.maxHeight) return false;
    state.remain = nextRemain;
    state.height = nextHeight;
    return true;
  }
  function makeOmittedNode(): MdElementNode {
    return { type: "element", tag: "omitted", children: [] };
  }
  function cutTextContent(
    s: string,
    charge: boolean,
  ): { text: string; cut: boolean } {
    if (!charge) return { text: s, cut: false };
    if (state.remain <= 0) {
      state.cut = true;
      return { text: "", cut: true };
    }
    if (s.length > state.remain) {
      const sliceLen = Math.max(0, state.remain);
      let part = s.slice(0, sliceLen);
      if (part.length < s.length) part = part + "…";
      state.remain = 0;
      state.cut = true;
      return { text: part, cut: true };
    }
    state.remain -= s.length;
    return { text: s, cut: false };
  }
  function trimCaptionChildren(children: MdNode[]): MdNode[] {
    if (dynamicImgCost) return children;
    if (captMaxLen < 0) return children;
    const total = computeTextMetrics(children).length;
    if (total <= captMaxLen) return children;
    const text =
      mdRenderText([{ type: "element", tag: "span", children }]).slice(
        0,
        captMaxLen,
      ) + "…";
    return [{ type: "text", text }];
  }
  function walk(
    n: MdNode,
    freeMedia: boolean,
    freeText: boolean,
  ): MdNode | null {
    if (state.cut) return null;
    if (n.type === "text") {
      const { text, cut } = cutTextContent(n.text, !freeText);
      if (text === "" && cut) return null;
      return { ...n, text };
    }
    const el = n as MdElementNode;
    if (el.tag === "toc") {
      return null;
    }
    if (el.tag === "br") {
      if (!freeText) {
        if (!bumpHeight(1)) {
          state.cut = true;
          return null;
        }
      }
      return { ...el, children: [] };
    }
    let chargedAtFigure = false;
    if (
      el.tag === "figure" &&
      !freeMedia &&
      dynamicImgCost &&
      !isFeaturedFigure(el) &&
      figureHasMedia(el)
    ) {
      const capLen = captionLengthOfFigure(el);
      if (!consumeDynamicImageBudget(capLen)) {
        state.cut = true;
        return null;
      }
      chargedAtFigure = true;
    }
    if (!freeText && blockTags.has(el.tag)) {
      const { length: contentLength, newlines } = computeTextMetrics(
        el.children || [],
      );
      let inc = 1 + Math.floor(contentLength / 100);
      if (el.tag === "pre" && newlines > 1) inc = Math.max(inc, newlines);
      if (!bumpHeight(inc)) {
        state.cut = true;
        return null;
      }
    }
    if ((el.tag === "img" || el.tag === "video") && !freeMedia) {
      if (dynamicImgCost) {
        if (!bumpHeight(imgHeight)) {
          state.cut = true;
          return null;
        }
      } else {
        if (!consumeFixedImageBudget()) {
          state.cut = true;
          return null;
        }
      }
    }
    const childFreeMedia =
      freeMedia ||
      isFeaturedFigure(el) ||
      (el.tag === "figure" && chargedAtFigure) ||
      el.tag === "figcaption";
    const childFreeText = freeText || el.tag === "figcaption";
    const outChildren: MdNode[] = [];
    for (const c of el.children || []) {
      const cc = walk(c, childFreeMedia, childFreeText);
      if (cc) outChildren.push(cc);
      if (state.cut) {
        if (!state.omittedInserted) {
          outChildren.push(makeOmittedNode());
          state.omittedInserted = true;
        }
        break;
      }
    }
    const finalChildren =
      el.tag === "figcaption" ? trimCaptionChildren(outChildren) : outChildren;
    return { ...el, children: finalChildren };
  }
  const out: MdNode[] = [];
  for (const n of nodes) {
    if (state.cut) break;
    const nn = walk(n, false, false);
    if (nn) out.push(nn);
    if (state.cut) {
      if (!state.omittedInserted) {
        out.push(makeOmittedNode());
        state.omittedInserted = true;
      }
      break;
    }
  }
  return out;
}

export function mdRenderText(nodes: MdNode[]): string {
  const out: string[] = [];
  const DOUBLE_AFTER = new Set([
    "p",
    "pre",
    "blockquote",
    "h1",
    "h2",
    "h3",
    "h4",
    "h5",
    "h6",
    "figure",
  ]);
  const SINGLE_AFTER = new Set(["hr"]);
  const endsWithNewline = () =>
    out.length > 0 && out[out.length - 1]!.endsWith("\n");
  const ensureNewline = () => {
    if (!endsWithNewline()) out.push("\n");
  };
  const pushBlankLine = () => {
    if (!endsWithNewline()) out.push("\n");
    out.push("\n");
  };
  function collectCellTextNodes(ns: MdNode[] | undefined): string {
    if (!ns) return "";
    let s = "";
    for (const n of ns) s += collectCellText(n);
    return s;
  }
  function collectCellText(n: MdNode): string {
    if (n.type === "text") return n.text;
    switch (n.tag) {
      case "toc":
        return "";
      case "br":
        return "\n";
      case "omitted":
        return "…";
      case "rp":
        return "";
      case "rt":
        return "(" + collectCellTextNodes(n.children) + ")";
      case "ruby": {
        let s = "";
        for (const c of n.children || []) {
          if (c.type === "element" && c.tag === "rt") {
            s += "(" + collectCellTextNodes(c.children) + ")";
          } else {
            s += collectCellText(c);
          }
        }
        return s;
      }
      case "math": {
        const el = n as MdElementNode;
        return String(el.attrs?.tex ?? "");
      }
      default:
        return collectCellTextNodes(n.children || []);
    }
  }
  function walk(n: MdNode, depth = 0): void {
    if (n.type === "text") {
      out.push(n.text);
      return;
    }
    switch (n.tag) {
      case "ruby": {
        for (const child of n.children || []) {
          if (child.type === "element" && child.tag === "rt") {
            out.push("(");
            walk(child, depth);
            out.push(")");
          } else {
            walk(child, depth);
          }
        }
        return;
      }
      case "table": {
        for (const row of n.children || []) {
          if (row.type !== "element" || row.tag !== "tr") continue;
          const cells: string[] = [];
          for (const cell of row.children || []) {
            if (
              cell.type === "element" &&
              (cell.tag === "td" || cell.tag === "th")
            ) {
              const txt = collectCellTextNodes(cell.children)
                .replace(/\n+/g, " ")
                .trim();
              cells.push(txt);
            }
          }
          out.push("|" + cells.join("|") + "|");
          out.push("\n");
        }
        pushBlankLine();
        return;
      }
      case "br": {
        out.push("\n");
        return;
      }
      case "omitted": {
        out.push("…");
        return;
      }
      case "ul": {
        for (const child of n.children || []) walk(child, depth + 1);
        if (depth === 0) {
          if (!endsWithNewline()) out.push("\n");
          out.push("\n");
        } else {
          ensureNewline();
        }
        return;
      }
      case "li": {
        out.push("  ".repeat(Math.max(0, depth - 1)) + "- ");
        let lastChildWasUL = false;
        for (const child of n.children || []) {
          if (child.type === "element" && child.tag === "ul") {
            ensureNewline();
            walk(child, depth);
            lastChildWasUL = true;
          } else {
            walk(child, depth);
            lastChildWasUL = false;
          }
        }
        if (!lastChildWasUL) out.push("\n");
        return;
      }
      case "math": {
        const el = n as MdElementNode;
        out.push(String(el.attrs?.tex ?? ""));
        return;
      }
      default: {
        for (const child of n.children || []) walk(child, depth);
        if (DOUBLE_AFTER.has(n.tag)) out.push("\n\n");
        else if (SINGLE_AFTER.has(n.tag)) ensureNewline();
        return;
      }
    }
  }
  for (const n of nodes) walk(n, 0);
  const text = out.join("");
  return text
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function mdRenderHtml(
  nodes: MdNode[],
  usePosAttrs = false,
  idPrefix?: string,
): string {
  const sanitizeIdPrefix = (s: string) =>
    (s || "h").replace(/[^a-zA-Z0-9_-]+/g, "-") || "h";
  const pfx = sanitizeIdPrefix(idPrefix ?? "h");
  const headingLevel = (tag: string): 1 | 2 | 3 | 4 | 5 | 6 | undefined =>
    tag === "h1"
      ? 1
      : tag === "h2"
        ? 2
        : tag === "h3"
          ? 3
          : tag === "h4"
            ? 4
            : tag === "h5"
              ? 5
              : tag === "h6"
                ? 6
                : undefined;

  function headingLabelText(ns: MdNode[] | undefined): string {
    if (!ns) return "";
    let out = "";
    const walk = (n: MdNode) => {
      if (n.type === "text") {
        out += n.text;
        return;
      }
      if (n.type === "element") {
        if (n.tag === "br") {
          out += " ";
          return;
        }
        if (n.tag === "math") {
          const el = n as MdElementNode;
          out += String(el.attrs?.tex ?? "");
          return;
        }
        for (const c of n.children || []) walk(c);
      }
    };
    for (const n of ns) walk(n);
    return out.replace(/\s+/g, " ").trim();
  }

  function withPos(attrs: MdAttrs | undefined, node: MdElementNode): MdAttrs {
    const out: MdAttrs = { ...(attrs || {}) };
    if (usePosAttrs) {
      if (typeof node.charPosition === "number")
        out["data-char-position"] = node.charPosition;
      if (typeof node.linePosition === "number")
        out["data-line-position"] = node.linePosition;
    }
    return out;
  }
  function attrsToString(attrs?: MdAttrs): string {
    if (!attrs) return "";
    const priority: Record<string, number> = { src: 0, alt: 1 };
    const keys = Object.keys(attrs).sort(
      (a, b) => (priority[a] ?? 10) - (priority[b] ?? 10) || a.localeCompare(b),
    );
    const a: Record<string, string | number | boolean | null | undefined> =
      attrs;
    let out = "";
    for (const k of keys) {
      const v = a[k];
      if (k === "bullet") {
        out += ` data-bullet="${escapeHTML(String(v))}"`;
        continue;
      }
      if (v === false || v === undefined || v === null) continue;
      if (v === true) out += ` ${k}`;
      else out += ` ${k}="${escapeHTML(String(v))}"`;
    }
    return out;
  }
  function mediaDataAttrs(mediaAttrs: MdAttrs): MdAttrs {
    const out: MdAttrs = {};
    for (const [k, v] of Object.entries(mediaAttrs)) {
      if (k === "src" || k === "alt" || k === "aria-label" || k === "controls")
        continue;
      const dataName = `data-${k}`;
      out[dataName] = v === true ? true : String(v);
    }
    return out;
  }
  function srcSanitize(v: string | number | boolean): string {
    return typeof v === "string" ? v : String(v);
  }
  function serializeMedia(n: MdMediaElement): string {
    const a = n.attrs || {};
    const src = a.src ? String(srcSanitize(a.src)) : "";
    if (n.tag === "img") {
      const base: MdAttrs = withPos(
        { src, alt: "", loading: "lazy", decoding: "async" },
        n as MdElementNode,
      );
      return `<img${attrsToString(base)}>`;
    } else {
      const base: MdAttrs = withPos(
        { src, "aria-label": "" as const, controls: true },
        n as MdElementNode,
      );
      return `<video${attrsToString(base)}></video>`;
    }
  }

  const headerIdMap = new WeakMap<MdElementNode, string>();
  let countH1 = 0,
    countH2 = 0,
    countH3 = 0,
    countH4 = 0,
    countH5 = 0,
    countH6 = 0;
  let seenFirstToc = false;

  type HeadingInfo = {
    level: 1 | 2 | 3 | 4 | 5 | 6;
    node: MdElementNode;
    id: string;
    label: string;
  };
  const headingsAfterToc: HeadingInfo[] = [];

  function prewalk(arr: MdNode[]) {
    for (const n of arr) {
      if (n.type !== "element") continue;

      if (n.tag === "toc") {
        if (!seenFirstToc) seenFirstToc = true;
      }

      const lvl = headingLevel(n.tag);
      if (lvl) {
        let id: string;
        if (lvl === 1) {
          id = `${pfx}-${++countH1}`;
          countH2 = 0;
          countH3 = 0;
          countH4 = 0;
          countH5 = 0;
          countH6 = 0;
        } else if (lvl === 2) {
          id = `${pfx}-${countH1}-${++countH2}`;
          countH3 = 0;
          countH4 = 0;
          countH5 = 0;
          countH6 = 0;
        } else if (lvl === 3) {
          id = `${pfx}-${countH1}-${countH2}-${++countH3}`;
          countH4 = 0;
          countH5 = 0;
          countH6 = 0;
        } else if (lvl === 4) {
          id = `${pfx}-${countH1}-${countH2}-${countH3}-${++countH4}`;
          countH5 = 0;
          countH6 = 0;
        } else if (lvl === 5) {
          id = `${pfx}-${countH1}-${countH2}-${countH3}-${countH4}-${++countH5}`;
          countH6 = 0;
        } else {
          id = `${pfx}-${countH1}-${countH2}-${countH3}-${countH4}-${countH5}-${++countH6}`;
        }
        headerIdMap.set(n, id);

        if (seenFirstToc) {
          headingsAfterToc.push({
            level: lvl,
            node: n,
            id,
            label: headingLabelText(n.children),
          });
        }
      }

      if (n.children?.length) prewalk(n.children);
    }
  }
  prewalk(nodes);

  const baseLevel: 1 | 2 | 3 | 4 | 5 | 6 | null = headingsAfterToc.length
    ? (Math.min(...headingsAfterToc.map((h) => h.level)) as
        | 1
        | 2
        | 3
        | 4
        | 5
        | 6)
    : null;

  type TocNode = {
    level: number;
    id: string;
    label: string;
    children: TocNode[];
  };

  function buildTocTree(items: HeadingInfo[]): TocNode[] {
    if (!items.length || baseLevel === null) return [];
    const root: TocNode = {
      level: baseLevel - 1,
      id: "",
      label: "",
      children: [],
    };
    const stack: TocNode[] = [root];

    for (const h of items) {
      const lvl = Math.max(baseLevel, h.level);
      while (stack.length && stack[stack.length - 1].level >= lvl) {
        stack.pop();
      }
      const parent = stack[stack.length - 1] ?? root;
      const node: TocNode = {
        level: lvl,
        id: h.id,
        label: h.label,
        children: [],
      };
      parent.children.push(node);
      stack.push(node);
    }
    return root.children;
  }

  function renderTocList(items: TocNode[]): string {
    if (!items.length) return "<ul></ul>";
    let html = "<ul>";
    for (const it of items) {
      html += `<li><a href="#${escapeHTML(it.id)}">${escapeHTML(it.label)}</a>`;
      if (it.children.length) html += renderTocList(it.children);
      html += "</li>";
    }
    html += "</ul>";
    return html;
  }

  const tocHtml = renderTocList(buildTocTree(headingsAfterToc));

  function serializeAll(arr: MdNode[]): string {
    let html = "";
    for (const n of arr) html += serializeOne(n);
    return html;
  }

  function serializeOne(n: MdNode): string {
    if (n.type === "text") return escapeHTML(n.text);

    if (n.type === "element" && n.tag === "math") {
      const el = n as MdElementNode;
      const tex = String(el.attrs?.tex ?? "");
      const display = String(el.attrs?.["math-mode"] ?? "inline") === "display";
      const attrs = withPos(
        { class: display ? "math-display" : "math-inline" },
        el,
      );
      return `<code${attrsToString(attrs)}>${escapeHTML(tex)}</code>`;
    }
    if (n.type === "element" && n.tag === "omitted")
      return `<span class="omitted">…</span>`;
    if (n.type === "element" && n.tag === "br") return `<br>`;

    if (n.type === "element" && n.tag === "hr") {
      const a = n.attrs || {};
      let attrs: MdAttrs = { ...a };
      const rec = attrs as Record<
        string,
        string | number | boolean | undefined
      >;
      const v = rec["hr-level"];
      if (v !== undefined) {
        delete rec["hr-level"];
        rec["data-hr-level"] = v;
      }
      attrs = withPos(attrs, n as MdElementNode);
      return `<hr${attrsToString(attrs)}>`;
    }

    if (n.type === "element" && n.tag === "pre") {
      const a = n.attrs || {};
      let attrs: MdAttrs = { ...a };
      const rec = attrs as Record<
        string,
        string | number | boolean | undefined
      >;
      const vMode = rec["pre-mode"];
      if (vMode !== undefined) {
        delete rec["pre-mode"];
        rec["data-pre-mode"] = vMode;
      }
      const vStyle = rec["pre-style"];
      if (vStyle !== undefined) {
        delete rec["pre-style"];
        rec["data-pre-style"] = vStyle;
      }
      attrs = withPos(attrs, n as MdElementNode);
      return `<pre${attrsToString(attrs)}>${serializeAll(n.children || [])}</pre>`;
    }

    if (n.type === "element" && n.tag === "figure") {
      const media = (n.children || []).find(isMediaElement);
      const figBase = n.attrs || {};
      const figExtra = media ? mediaDataAttrs(media.attrs || {}) : {};
      let figAttrs: MdAttrs = { ...figBase, ...figExtra };
      figAttrs = withPos(figAttrs, n as MdElementNode);
      let inner = "";
      for (const c of n.children || []) {
        if (c.type === "element" && isMediaElement(c))
          inner += serializeMedia(c as MdMediaElement);
        else if (c.type === "element" && c.tag === "figcaption")
          inner += `<figcaption>${serializeAll(c.children || [])}</figcaption>`;
        else inner += serializeOne(c);
      }
      return `<figure${attrsToString(figAttrs)}>${inner}</figure>`;
    }

    if (n.type === "element" && isMediaElement(n))
      return serializeMedia(n as MdMediaElement);

    if (n.type === "element" && (n.tag === "td" || n.tag === "th")) {
      let attrs: MdAttrs = { ...(n as MdElementNode).attrs };
      const rec = attrs as Record<
        string,
        string | number | boolean | undefined
      >;
      const alignRaw = rec["align"];
      if (alignRaw === "right" || alignRaw === "center") {
        delete rec["align"];
        const cur =
          typeof rec["class"] === "string" ? (rec["class"] as string) : "";
        rec["class"] = cur ? `${cur} align-${alignRaw}` : `align-${alignRaw}`;
      }
      attrs = withPos(attrs, n as MdElementNode);
      return `<${(n as MdElementNode).tag}${attrsToString(attrs)}>${serializeAll(
        (n as MdElementNode).children || [],
      )}</${(n as MdElementNode).tag}>`;
    }

    if (n.type === "element") {
      const lvl = headingLevel(n.tag);
      if (lvl) {
        const el = n as MdElementNode;
        const id = headerIdMap.get(el)!;
        const attrs = withPos({ ...(el.attrs || {}), id }, el);
        return `<${el.tag}${attrsToString(attrs)}>${serializeAll(el.children || [])}</${el.tag}>`;
      }
    }

    if (n.type === "element" && n.tag === "toc") {
      const el = n as MdElementNode;
      const navAttrs = withPos(
        { class: "toc", "aria-label": "table of contents" },
        el,
      );
      return `<nav${attrsToString(navAttrs)}>${tocHtml}</nav>`;
    }

    const attrs = withPos((n as MdElementNode).attrs, n as MdElementNode);
    return `<${(n as MdElementNode).tag}${attrsToString(attrs)}>${serializeAll(
      (n as MdElementNode).children || [],
    )}</${(n as MdElementNode).tag}>`;
  }

  return serializeAll(nodes);
}

export function mdRenderMarkdown(nodes: MdNode[]): string {
  const isElement = (n: MdNode, tag?: string): n is MdElementNode =>
    n.type === "element" && (!tag || n.tag === tag);

  const hasClass = (el: MdElementNode | undefined, cls: string): boolean => {
    if (!el || el.type !== "element") return false;
    const c = el.attrs?.class;
    return typeof c === "string" ? c.split(/\s+/).includes(cls) : false;
  };

  const getAttrStr = (
    a: MdAttrs | undefined,
    k: string,
  ): string | undefined => {
    const v = a?.[k];
    return typeof v === "string"
      ? v
      : typeof v === "number"
        ? String(v)
        : undefined;
  };

  const sanitizeUrl = (u: string): string =>
    u.replace(/\)/g, "%29").replace(/ /g, "%20");

  const collectPlainText = (ns: MdNode[] | undefined): string => {
    if (!ns) return "";
    let out = "";
    for (const n of ns) {
      if (n.type === "text") {
        out += n.text;
      } else if (n.type === "element") {
        if (n.tag === "br") out += "\n";
        else if (n.tag === "math") out += String(n.attrs?.tex ?? "");
        else out += collectPlainText(n.children);
      }
    }
    return out;
  };

  const escapeForInline = (s: string): string => {
    let out = s.replace(/\\/g, "\\\\");
    out = out.replace(/\*\*/g, "\\*\\*");
    out = out.replace(/::/g, "\\::");
    out = out.replace(/%%/g, "\\%\\%");
    out = out.replace(/@@/g, "\\@\\@");
    out = out.replace(/__/g, "\\_\\_");
    out = out.replace(/~~/g, "\\~\\~");
    out = out.replace(/``/g, "\\`\\`");
    out = out.replace(/\$\$/g, "\\$\\$");
    return out;
  };

  const backtickRun = (s: string): number => {
    let maxRun = 0,
      cur = 0;
    for (let i = 0; i < s.length; i++) {
      if (s[i] === "`") cur++;
      else {
        if (cur > maxRun) maxRun = cur;
        cur = 0;
      }
    }
    if (cur > maxRun) maxRun = cur;
    return maxRun;
  };

  const protectBlockStarts = (text: string): string =>
    text
      .split("\n")
      .map((line) => {
        if (/^-{3,}$/.test(line)) return "\\" + line;
        if (/^(?:#{1,6}\s|>\s|`{3,}|-(?:\+|:)?\s)/.test(line))
          return "\\" + line;
        return line;
      })
      .join("\n");

  const renderInline = (ns: MdNode[] | undefined): string => {
    if (!ns || ns.length === 0) return "";
    let out = "";
    for (const n of ns) {
      if (n.type === "text") {
        out += escapeForInline(n.text);
        continue;
      }
      const el = n as MdElementNode;
      switch (el.tag) {
        case "strong":
          out += `**${renderInline(el.children)}**`;
          break;
        case "em":
          out += `::${renderInline(el.children)}::`;
          break;
        case "small":
          out += `%%${renderInline(el.children)}%%`;
          break;
        case "mark":
          out += `@@${renderInline(el.children)}@@`;
          break;
        case "u":
          out += `__${renderInline(el.children)}__`;
          break;
        case "s":
          out += `~~${renderInline(el.children)}~~`;
          break;
        case "code": {
          const inner = collectPlainText(el.children || []);
          const ticks = "`".repeat(Math.max(2, backtickRun(inner) + 1));
          out += `${ticks}${inner}${ticks}`;
          break;
        }
        case "math": {
          const tex = String(el.attrs?.tex ?? "");
          out += `$$${tex}$$`;
          break;
        }
        case "ruby": {
          const rb = (el.children || []).find((c) => isElement(c, "rb")) as
            | MdElementNode
            | undefined;
          const rt = (el.children || []).find((c) => isElement(c, "rt")) as
            | MdElementNode
            | undefined;
          const rbTxt = collectPlainText(rb?.children || []);
          const rtTxt = collectPlainText(rt?.children || []);
          out += `{{${rbTxt}|${rtTxt}}}`;
          break;
        }
        case "a": {
          const href0 = getAttrStr(el.attrs, "href") || "";
          const href = sanitizeUrl(href0);
          const anchor = collectPlainText(el.children || [])
            .replace(/\\/g, "\\\\")
            .replace(/\]/g, "\\]");
          if (/^https?:\/\//.test(href) && href === anchor) {
            out += href;
          } else {
            out += `[${anchor}](${href})`;
          }
          break;
        }
        case "br":
          out += "\n";
          break;
        case "img":
        case "video": {
          const src = sanitizeUrl(getAttrStr(el.attrs, "src") || "");

          const altRaw = typeof el.attrs?.alt === "string" ? el.attrs.alt : "";
          const alt = altRaw.replace(/\\/g, "\\\\").replace(/\]/g, "\\]");

          const macroAttrs: string[] = [];
          const entries = Object.entries(el.attrs || {}).filter(
            ([k]) =>
              ![
                "src",
                "alt",
                "aria-label",
                "controls",
                "loading",
                "decoding",
              ].includes(k),
          );
          entries
            .sort(([a], [b]) => a.localeCompare(b))
            .forEach(([k, v]) => {
              if (v === true) macroAttrs.push(k);
              else if (v !== false && v != null && String(v) !== "")
                macroAttrs.push(`${k}=${String(v)}`);
            });
          const attrsStr = macroAttrs.length
            ? `{${macroAttrs.join(", ")}}`
            : "";
          out += `![${alt}](${src})${attrsStr}`;
          break;
        }
        default:
          out += renderInline(el.children);
      }
    }
    return out;
  };

  const extractAltFromFigureOrImg = (node: MdElementNode): string => {
    if (node.tag === "figure") {
      const caption = node.children.find(
        (ch) => ch.type === "element" && ch.tag === "figcaption",
      ) as MdElementNode | undefined;
      if (caption) {
        const txt = collectPlainText(caption.children || []).trim();
        if (txt) {
          return txt.replace(/\\/g, "\\\\").replace(/\]/g, "\\]");
        }
      }
      const img = node.children.find(
        (ch) => ch.type === "element" && ch.tag === "img",
      ) as MdElementNode | undefined;
      if (img && typeof img.attrs?.alt === "string") {
        return img.attrs.alt
          .trim()
          .replace(/\\/g, "\\\\")
          .replace(/\]/g, "\\]");
      }
      return "";
    }

    if (node.tag === "img") {
      const alt =
        typeof node.attrs?.alt === "string" ? node.attrs.alt.trim() : "";
      return alt.replace(/\\/g, "\\\\").replace(/\]/g, "\\]");
    }

    return "";
  };

  const renderFigureMacro = (fig: MdElementNode): string => {
    const media = (fig.children || []).find(
      (c): c is MdMediaElement =>
        c.type === "element" && (c.tag === "img" || c.tag === "video"),
    );
    const src = media ? sanitizeUrl(getAttrStr(media.attrs, "src") || "") : "";
    const desc = extractAltFromFigureOrImg(fig);
    const macro: string[] = [];
    const entries = media
      ? Object.entries(media.attrs || {}).filter(
          ([k]) =>
            ![
              "src",
              "alt",
              "aria-label",
              "controls",
              "loading",
              "decoding",
            ].includes(k),
        )
      : [];
    entries
      .sort(([a], [b]) => a.localeCompare(b))
      .forEach(([k, v]) => {
        if (v === true) macro.push(k);
        else if (v !== false && v != null && String(v) !== "")
          macro.push(`${k}=${String(v)}`);
      });
    const attrsStr = macro.length ? `{${macro.join(", ")}}` : "";
    return `![${desc}](${src})${attrsStr}`;
  };

  const tableCellAlign = (
    cell: MdElementNode,
  ): "right" | "center" | undefined => {
    const raw = getAttrStr(cell.attrs, "align");
    if (raw === "right" || raw === "center") return raw;
    const cls = cell.attrs?.class;
    if (typeof cls === "string") {
      if (cls.split(/\s+/).includes("align-right")) return "right";
      if (cls.split(/\s+/).includes("align-center")) return "center";
    }
    return undefined;
  };

  const renderTableCell = (cell: MdElementNode): string => {
    const tokens: string[] = [];
    const csRaw = getAttrStr(cell.attrs, "colspan");
    const rsRaw = getAttrStr(cell.attrs, "rowspan");
    const cs = csRaw ? parseInt(csRaw, 10) : 0;
    const rs = rsRaw ? parseInt(rsRaw, 10) : 0;
    if (cs > 1) tokens.push(`{colspan=${cs}}`);
    if (rs > 1) tokens.push(`{rowspan=${rs}}`);
    const align = tableCellAlign(cell);
    if (align === "right") tokens.push(">>");
    else if (align === "center") tokens.push("><");
    let inner = renderInline(cell.children || [])
      .replace(/\n+/g, " ")
      .trim();
    inner = inner.replace(/\|/g, "\\|");
    let body = tokens.join("");
    if (inner) body = body ? `${body}${inner}` : inner;
    if (cell.tag === "th") body = `=${body}=`;
    return body;
  };

  const renderList = (ul: MdElementNode, depth: number): string => {
    const bullet = ((): "- " | "-+ " | "-: " => {
      const b = ul.attrs?.["bullet"];
      if (b === "number") return "-+ ";
      if (b === "none") return "-: ";
      return "- ";
    })();
    let out = "";
    for (const child of ul.children || []) {
      if (!isElement(child, "li")) continue;
      const indent = "  ".repeat(Math.max(0, depth));
      const inlineParts: MdNode[] = [];
      const nestedLists: MdElementNode[] = [];
      for (const c of child.children || []) {
        if (isElement(c, "ul")) nestedLists.push(c);
        else inlineParts.push(c);
      }
      const line = indent + bullet + renderInline(inlineParts);
      out += line + "\n";
      for (const nl of nestedLists) {
        out += renderList(nl, depth + 1);
      }
    }
    if (depth === 0) out += "\n";
    return out;
  };

  const renderBlock = (n: MdNode): string | null => {
    if (n.type === "text") {
      const t = n.text.trim();
      return t ? escapeForInline(t) : null;
    }
    const el = n as MdElementNode;

    if (el.tag === "div" && hasClass(el, "image-grid")) {
      const lines: string[] = [];
      for (const c of el.children || []) {
        if (isElement(c, "figure")) lines.push(renderFigureMacro(c));
      }
      return lines.join("\n");
    }

    switch (el.tag) {
      case "p":
        return protectBlockStarts(renderInline(el.children || []));
      case "h1":
      case "h2":
      case "h3":
      case "h4":
      case "h5":
      case "h6": {
        const level = Number(el.tag.slice(1));
        const content = renderInline(el.children || [])
          .replace(/\n+/g, " ")
          .trim();
        return `${"#".repeat(level)} ${content}`;
      }
      case "blockquote": {
        const content = renderInline(el.children || []);
        const lines = content.split("\n").map((l) => `> ${l}`);
        return lines.join("\n");
      }
      case "ul":
        return renderList(el, 0).trimEnd();
      case "pre": {
        const code = collectPlainText(el.children || []);
        const maxTicks = backtickRun(code);
        const fence = "`".repeat(Math.max(3, maxTicks + 1));
        const mode = getAttrStr(el.attrs, "pre-mode");
        const style = getAttrStr(el.attrs, "pre-style");
        const info =
          mode && style
            ? `${mode}:${style}`
            : mode
              ? mode
              : style
                ? `:${style}`
                : "";
        return info
          ? `${fence}${info}\n${code}\n${fence}`
          : `${fence}\n${code}\n${fence}`;
      }
      case "hr": {
        const lvl = Number(el.attrs?.["hr-level"] ?? 1);
        const dashes = lvl === 2 ? "----" : lvl >= 3 ? "-----" : "---";
        return dashes;
      }
      case "toc":
        return "<!TOC!>";
      case "figure":
        return renderFigureMacro(el);
      case "table": {
        const rows: string[] = [];
        for (const tr of el.children || []) {
          if (!isElement(tr, "tr")) continue;
          const cells: string[] = [];
          for (const td of tr.children || []) {
            if (!isElement(td) || (td.tag !== "td" && td.tag !== "th"))
              continue;
            cells.push(renderTableCell(td));
          }
          rows.push("|" + cells.join("|") + "|");
        }
        return rows.join("\n");
      }
      case "omitted":
        return "…";
      case "br":
        return "";
      case "img":
      case "video":
        return renderFigureMacro(
          makeElement("figure", [el], { class: "image-block" }),
        );
      default:
        return protectBlockStarts(renderInline(el.children || []));
    }
  };

  const blocks: string[] = [];
  for (const n of nodes) {
    const b = renderBlock(n);
    if (b == null) continue;
    const trimmed = b.replace(/[ \t]+\n/g, "\n").trimEnd();
    if (trimmed === "") continue;
    if (blocks.length > 0) blocks.push("");
    blocks.push(trimmed);
  }
  return blocks.join("\n") + (blocks.length ? "\n" : "");
}

export function mdSeparateTitle(nodes: MdNode[]): {
  title: string | null;
  otherNodes: MdNode[];
} {
  function collectText(ns: MdNode[] | undefined): string {
    if (!ns) return "";
    let out = "";
    for (const n of ns) {
      if (n.type === "text") {
        out += n.text;
      } else if (n.type === "element") {
        if (n.tag === "br") {
          out += " ";
        } else if (n.tag === "math") {
          const tex =
            (n.attrs && typeof n.attrs.tex === "string" ? n.attrs.tex : "") ||
            "";
          out += tex;
        } else if (n.tag === "ruby") {
          for (const c of n.children || []) {
            if (c.type === "text") {
              out += c.text;
            } else if (c.type === "element" && c.tag === "rt") {
              const rtText = collectText(c.children);
              if (rtText) out += `(${rtText})`;
            } else {
              out += collectText([c]);
            }
          }
        } else {
          out += collectText(n.children);
        }
      }
    }
    return out.replace(/\s+/g, " ").trim();
  }
  function stripFirstHeading(
    src: MdNode[],
    targetTag: "h1" | "h2",
  ): { found: string | null; nodes: MdNode[] } {
    let found: string | null = null;
    function walk(arr: MdNode[]): MdNode[] {
      const out: MdNode[] = [];
      for (const n of arr) {
        if (found) {
          out.push(n);
          continue;
        }
        if (n.type === "element") {
          if (n.tag === targetTag) {
            const txt = collectText(n.children);
            if (txt) {
              found = txt;
              continue;
            }
          }
          if (n.children && n.children.length) {
            const newChildren = walk(n.children);
            if (newChildren !== n.children) {
              out.push({ ...n, children: newChildren });
            } else {
              out.push(n);
            }
          } else {
            out.push(n);
          }
        } else {
          out.push(n);
        }
      }
      return out;
    }
    const newNodes = walk(src);
    return { found, nodes: newNodes };
  }
  const h1Res = stripFirstHeading(nodes, "h1");
  if (h1Res.found) {
    return { title: h1Res.found, otherNodes: h1Res.nodes };
  }
  const h2Res = stripFirstHeading(nodes, "h2");
  if (h2Res.found) {
    return { title: h2Res.found, otherNodes: h2Res.nodes };
  }
  return { title: null, otherNodes: nodes };
}

export function serializeMdNodes(nodes: MdNode[]): string {
  const enc = nodes.map(encodeNode);
  return JSON.stringify(enc);
}

export function deserializeMdNodes(data: string): MdNode[] {
  const arr = JSON.parse(data) as EncodedNode[];
  return arr.map(decodeNode);
}

function parseInline(text: string): MdNode[] {
  const esc = /\\([\\~`*_\[\](){}#+:%$\|\-\.!@])/;
  const bold = /\*\*([^\*]+)\*\*/;
  const italic = /::([^:]+?)::/;
  const ruby = /\{\{([^|{}]+?)\|([^{}]+?)\}\}/;
  const small = /%%([^%]+?)%%/;
  const mark = /@@([^%]+?)@@/;
  const underline = /__([^_]+)__/;
  const strike = /~~([^~]+)~~/;
  const code = /``([^`]+)``/;
  const math = /\$\$([^\n]*?)\$\$/;
  const comment = /<\[[^\]]*?\]>/;
  let m: RegExpExecArray | null;
  if ((m = esc.exec(text))) {
    return [
      ...parseInline(text.slice(0, m.index)),
      { type: "text", text: m[1]! },
      ...parseInline(text.slice(m.index + 2)),
    ];
  }
  if ((m = ruby.exec(text))) {
    return [
      ...parseInline(text.slice(0, m.index)),
      {
        type: "element",
        tag: "ruby",
        children: [
          { type: "element", tag: "rb", children: parseInline(m[1]!) },
          { type: "element", tag: "rt", children: parseInline(m[2]!) },
        ],
      },
      ...parseInline(text.slice(m.index + m[0]!.length)),
    ];
  }
  if ((m = bold.exec(text))) {
    return [
      ...parseInline(text.slice(0, m.index)),
      { type: "element", tag: "strong", children: parseInline(m[1]!) },
      ...parseInline(text.slice(m.index + m[0]!.length)),
    ];
  }
  if ((m = italic.exec(text))) {
    return [
      ...parseInline(text.slice(0, m.index)),
      { type: "element", tag: "em", children: parseInline(m[1]!) },
      ...parseInline(text.slice(m.index + m[0]!.length)),
    ];
  }
  if ((m = small.exec(text))) {
    return [
      ...parseInline(text.slice(0, m.index)),
      { type: "element", tag: "small", children: parseInline(m[1]!) },
      ...parseInline(text.slice(m.index + m[0]!.length)),
    ];
  }
  if ((m = mark.exec(text))) {
    return [
      ...parseInline(text.slice(0, m.index)),
      { type: "element", tag: "mark", children: parseInline(m[1]!) },
      ...parseInline(text.slice(m.index + m[0]!.length)),
    ];
  }
  if ((m = underline.exec(text))) {
    return [
      ...parseInline(text.slice(0, m.index)),
      { type: "element", tag: "u", children: parseInline(m[1]!) },
      ...parseInline(text.slice(m.index + m[0]!.length)),
    ];
  }
  if ((m = strike.exec(text))) {
    return [
      ...parseInline(text.slice(0, m.index)),
      { type: "element", tag: "s", children: parseInline(m[1]!) },
      ...parseInline(text.slice(m.index + m[0]!.length)),
    ];
  }
  if ((m = code.exec(text))) {
    return [
      ...parseInline(text.slice(0, m.index)),
      {
        type: "element",
        tag: "code",
        children: [{ type: "text", text: m[1]! }],
      },
      ...parseInline(text.slice(m.index + m[0]!.length)),
    ];
  }
  if ((m = math.exec(text))) {
    return [
      ...parseInline(text.slice(0, m.index)),
      {
        type: "element",
        tag: "math",
        attrs: { tex: m[1]!, "math-mode": "inline" },
        children: [],
      },
      ...parseInline(text.slice(m.index + m[0]!.length)),
    ];
  }
  if ((m = comment.exec(text))) {
    return [
      ...parseInline(text.slice(0, m.index)),
      ...parseInline(text.slice(m.index + m[0]!.length)),
    ];
  }
  const linkRe =
    /\[([^\]]+)\]\(((?:https?:\/\/[^\s)]+|\/[^\s)]+|[-_a-z0-9]+))\)/gi;
  const nodes: MdNode[] = [];
  let last = 0;
  const resolveSpecialHref = (raw: string, anchor: string): string | null => {
    const toWiki = (lang: "en" | "ja", title: string) =>
      `https://${lang}.wikipedia.org/wiki/${encodeURIComponent(title.replace(/ /g, "_"))}`;
    if (raw === "wiki-en") return toWiki("en", anchor);
    if (raw === "wiki-ja") return toWiki("ja", anchor);
    if (raw === "google")
      return `https://www.google.com/search?q=${encodeURIComponent(anchor)}`;
    return null;
  };
  let match: RegExpExecArray | null;
  while ((match = linkRe.exec(text))) {
    if (match.index > last)
      nodes.push(...parseInlineText(text.slice(last, match.index)));
    const anchor = match[1]!;
    const rawHref = match[2]!;
    const resolved = resolveSpecialHref(rawHref, anchor) ?? rawHref;
    nodes.push({
      type: "element",
      tag: "a",
      attrs: { href: resolved },
      children: [{ type: "text", text: anchor }],
    });
    last = match.index + match[0]!.length;
  }
  text = text.slice(last);
  const urlRe = /(https?:\/\/[A-Za-z0-9\-._~:/?#[\]@!$&'()*+,;=%]+)/g;
  last = 0;
  while ((match = urlRe.exec(text))) {
    if (match.index > last)
      nodes.push({ type: "text", text: text.slice(last, match.index) });
    const url = match[0]!;
    nodes.push({
      type: "element",
      tag: "a",
      attrs: { href: url },
      children: [{ type: "text", text: url }],
    });
    last = match.index + match[0]!.length;
  }
  if (last < text.length) nodes.push({ type: "text", text: text.slice(last) });
  return nodes.flatMap<MdNode>((n) => {
    if (n.type !== "text") return [n];
    const parts = n.text.split(/\n/);
    const out: MdNode[] = [];
    for (let i = 0; i < parts.length; i++) {
      if (i > 0) out.push({ type: "element", tag: "br", children: [] });
      const frag = parts[i]!;
      if (frag !== "") out.push({ type: "text", text: frag });
    }
    return out;
  });
}

function parseInlineText(text: string): MdNode[] {
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

const NODE_KEY_TAG = "T";
const NODE_KEY_CHILDREN = "C";
const NODE_KEY_TEXT = "X";

const ATTR_ENC: Record<string, string> = {
  src: "SR",
  alt: "AT",
  href: "HF",
  bullet: "BT",
  controls: "CT",
  "aria-label": "AL",
  class: "CL",
  grid: "GD",
  "data-cols": "DC",
  featured: "FE",
  "no-featured": "NF",
  "pre-mode": "PM",
  "pre-style": "PS",
  "hr-level": "HL",
};

const ATTR_DEC: Record<string, string> = Object.fromEntries(
  Object.entries(ATTR_ENC).map(([k, v]) => [v, k]),
);

const UNKNOWN_ATTR_BUCKET = "A";

type Primitive = string | number | boolean;
type UnknownAttrs = Record<string, Primitive>;

type EncodedElement = {
  [NODE_KEY_TAG]: string;
  [NODE_KEY_CHILDREN]?: EncodedNode[];
} & {
  [code: string]: Primitive | UnknownAttrs | EncodedNode[] | undefined;
};

type EncodedText = { [NODE_KEY_TEXT]: string };
type EncodedNode = EncodedText | EncodedElement;

function encodeNode(n: MdNode): EncodedNode {
  if (n.type === "text") {
    return { [NODE_KEY_TEXT]: n.text };
  }
  const out: EncodedElement = { [NODE_KEY_TAG]: n.tag };
  const children = n.children ?? [];
  if (children.length === 1 && children[0].type === "text") {
    out[NODE_KEY_TEXT] = children[0].text;
  } else if (children.length > 0) {
    out[NODE_KEY_CHILDREN] = children.map(encodeNode);
  }
  if (n.attrs && Object.keys(n.attrs).length > 0) {
    let unknown: UnknownAttrs | null = null;
    for (const k of Object.keys(n.attrs)) {
      const v = n.attrs[k] as Primitive;
      if (v === undefined || v === null || v === false) continue;
      if (typeof v === "string" && v === "") continue;
      const code = ATTR_ENC[k];
      if (code) {
        out[code] = v;
      } else {
        (unknown ??= {})[k] = v;
      }
    }
    if (unknown && Object.keys(unknown).length > 0) {
      out[UNKNOWN_ATTR_BUCKET] = unknown;
    }
  }
  return out;
}

function decodeNode(e: EncodedNode): MdNode {
  if (NODE_KEY_TAG in e) {
    const elm = e as EncodedElement;
    const rawChildren = elm[NODE_KEY_CHILDREN];
    const inlineText =
      typeof elm[NODE_KEY_TEXT] === "string"
        ? (elm[NODE_KEY_TEXT] as string)
        : undefined;
    const children: MdNode[] = rawChildren
      ? rawChildren.map(decodeNode)
      : inlineText !== undefined
        ? [{ type: "text", text: inlineText }]
        : [];
    let attrs: MdAttrs | undefined;
    for (const [k, v] of Object.entries(elm)) {
      if (k === NODE_KEY_TAG || k === NODE_KEY_CHILDREN || k === NODE_KEY_TEXT)
        continue;
      if (k === UNKNOWN_ATTR_BUCKET) continue;
      const orig = ATTR_DEC[k];
      if (!orig) continue;
      if (
        typeof v === "string" ||
        typeof v === "number" ||
        typeof v === "boolean"
      ) {
        if (v === "" || v === false) continue;
        (attrs ??= {})[orig] = v;
      }
    }
    const unknown = elm[UNKNOWN_ATTR_BUCKET];
    if (unknown && typeof unknown === "object" && !Array.isArray(unknown)) {
      for (const [k, v] of Object.entries(unknown as UnknownAttrs)) {
        if (
          typeof v === "string" ||
          typeof v === "number" ||
          typeof v === "boolean"
        ) {
          if (v === "" || v === false) continue;
          (attrs ??= {})[k] = v;
        }
      }
    }
    const tag = elm[NODE_KEY_TAG] as string;
    return attrs
      ? { type: "element", tag, attrs, children }
      : { type: "element", tag, children };
  }
  const txt = (e as EncodedText)[NODE_KEY_TEXT];
  return { type: "text", text: String(txt) };
}
