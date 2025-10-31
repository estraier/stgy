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
  const currList: { level: number; items: MdNode[] }[] = [];
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
      if (currList.length === 0) {
        nodes.push(inheritPosFromFirstChild("ul", list.items));
      } else {
        const parentItems = currList[currList.length - 1].items;
        const lastLi =
          parentItems.length > 0
            ? parentItems[parentItems.length - 1]
            : undefined;
        if (lastLi && lastLi.type === "element" && lastLi.tag === "li") {
          if (!lastLi.children) lastLi.children = [];
          lastLi.children.push(inheritPosFromFirstChild("ul", list.items));
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
    const h = line.match(/^(#{1,3}) (.+)$/);
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
    const li = line.match(/^(\s*)- (.+)$/);
    if (li) {
      flushPara();
      flushTable();
      flushQuote();
      const level = Math.floor(li[1].length / 2);
      while (
        currList.length > 0 &&
        currList[currList.length - 1].level > level
      ) {
        const done = currList.pop();
        if (currList.length === 0) {
          nodes.push(inheritPosFromFirstChild("ul", done!.items));
        } else {
          const parentItems = currList[currList.length - 1].items;
          const lastLi =
            parentItems.length > 0
              ? parentItems[parentItems.length - 1]
              : undefined;
          if (lastLi && lastLi.type === "element" && lastLi.tag === "li") {
            if (!lastLi.children) lastLi.children = [];
            lastLi.children.push(inheritPosFromFirstChild("ul", done!.items));
          }
        }
      }
      if (
        currList.length === 0 ||
        currList[currList.length - 1].level < level
      ) {
        currList.push({ level, items: [] });
      }
      currList[currList.length - 1].items.push(
        makeElement("li", parseInline(li[2]), undefined, i, lineCharStart),
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
  function groupInArray(arr: MdNode[]): MdNode[] {
    const out: MdNode[] = [];
    for (let i = 0; i < arr.length; ) {
      const node = arr[i];
      if (isFigureImageBlock(node) && hasGridFlag(findMedia(node)?.attrs)) {
        const group: MdNode[] = [node];
        let j = i + 1;
        while (
          j < arr.length &&
          isFigureImageBlock(arr[j]) &&
          hasGridFlag(findMedia(arr[j])?.attrs)
        ) {
          group.push(arr[j]);
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
  const headingLevel = (tag: string): 1 | 2 | 3 | undefined =>
    tag === "h1" ? 1 : tag === "h2" ? 2 : tag === "h3" ? 3 : undefined;

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
    countH3 = 0;
  let seenFirstToc = false;

  type HeadingInfo = {
    level: 1 | 2 | 3;
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
        } else if (lvl === 2) {
          id = `${pfx}-${countH1}-${++countH2}`;
          countH3 = 0;
        } else {
          id = `${pfx}-${countH1}-${countH2}-${++countH3}`;
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

  const baseLevel: 1 | 2 | 3 | null = headingsAfterToc.length
    ? (Math.min(...headingsAfterToc.map((h) => h.level)) as 1 | 2 | 3)
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
  const esc = /\\([\\~`*_\[\](){}#+:%$\|\-\.!])/;
  const bold = /\*\*([^\*]+)\*\*/;
  const italic = /::([^:]+?)::/;
  const ruby = /\{\{([^|{}]+?)\|([^{}]+?)\}\}/;
  const mark = /%%([^%]+?)%%/;
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
