export type MdAttrs = Record<string, string | number | boolean>;
export type MdTextNode = { type: "text"; text: string };
export type MdElementNode = {
  type: "element";
  tag: string;
  attrs?: MdAttrs;
  children: MdNode[];
};
export type MdMediaElement = MdElementNode & { tag: "img" | "video" };
export type MdNode = MdTextNode | MdElementNode;

export function parseMarkdown(mdText: string): MdNode[] {
  const lines = mdText.replace(/\r\n/g, "\n").split("\n");
  const nodes: MdNode[] = [];
  let inCode = false,
    codeLines: string[] = [],
    codeLang: string | undefined;
  const currList: { level: number; items: MdNode[] }[] = [];
  let currPara: string[] = [];
  let currTable: string[][] = [];
  let currQuote: string[] = [];
  function flushPara() {
    if (currPara.length) {
      nodes.push({ type: "element", tag: "p", children: parseInline(currPara.join("\n")) });
      currPara = [];
    }
  }
  function flushList() {
    while (currList.length > 0) {
      const list = currList.pop()!;
      if (currList.length === 0) {
        nodes.push({ type: "element", tag: "ul", children: list.items });
      } else {
        const parentItems = currList[currList.length - 1].items;
        const lastLi = parentItems.length > 0 ? parentItems[parentItems.length - 1] : undefined;
        if (lastLi && lastLi.type === "element" && lastLi.tag === "li") {
          if (!lastLi.children) lastLi.children = [];
          lastLi.children.push({ type: "element", tag: "ul", children: list.items });
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
  const imageMacroRe = /^!\[([^\]]*)\]\s*\(([^)]+)\)\s*(?:\{([^\}]*)\})?$/;
  const videoExts = /\.(mpg|mp4|m4a|mov|avi|wmv|webm)(\?.*)?$/i;
  for (let i = 0; i < lines.length; ++i) {
    const line = lines[i];
    const codeFence = line.match(/^```([\w:]*)/);
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
          attrs: codeLang ? { "pre-mode": codeLang } : undefined,
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
    const hr = line.match(/^-{3,}$/);
    if (hr) {
      flushPara();
      flushList();
      flushTable();
      flushQuote();
      const dashCount = hr[0].length;
      const level = dashCount === 3 ? 1 : dashCount === 4 ? 2 : 3;
      nodes.push({ type: "element", tag: "hr", attrs: { "hr-level": level }, children: [] });
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
      const figureChildren: MdNode[] = [
        { type: "element", tag: isVideo ? "video" : "img", attrs: mediaAttrs, children: [] },
      ];
      if (desc) {
        figureChildren.push({
          type: "element",
          tag: "figcaption",
          children: [{ type: "text", text: desc }],
        });
      }
      nodes.push({
        type: "element",
        tag: "figure",
        attrs: { class: "image-block" },
        children: figureChildren,
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
      nodes.push({ type: "element", tag: `h${level}`, children: parseInline(h[2]) });
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
          nodes.push({ type: "element", tag: "ul", children: done!.items });
        } else {
          const parentItems = currList[currList.length - 1].items;
          const lastLi = parentItems.length > 0 ? parentItems[parentItems.length - 1] : undefined;
          if (lastLi && lastLi.type === "element" && lastLi.tag === "li") {
            if (!lastLi.children) lastLi.children = [];
            lastLi.children.push({ type: "element", tag: "ul", children: done!.items });
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
      attrs: codeLang ? { "pre-mode": codeLang } : undefined,
      children: [{ type: "text", text: codeLines.join("\n") }],
    });
  }
  return nodes;
}

export type MdMediaRewriteRule = {
  pattern: RegExp;
  replacement: string;
};

export type MdMediaRewriteOptions = {
  allowedPatterns: RegExp[];
  alternativeImage: string;
  rewriteRules: MdMediaRewriteRule[];
  maxObjects?: number;
};

export function mdRewriteMediaUrls(nodes: MdNode[], opts: MdMediaRewriteOptions): MdNode[] {
  let mediaCount = 0;
  const allowedByPattern = (src: string) => opts.allowedPatterns.some((re) => re.test(src));
  const isAllowedNow = (src: string) => {
    mediaCount += 1;
    if (opts.maxObjects !== undefined && mediaCount > opts.maxObjects) return false;
    return allowedByPattern(src);
  };
  const applyRules = (src: string) =>
    opts.rewriteRules.reduce((u, r) => u.replace(r.pattern, r.replacement), src);
  const rewriteOne = (n: MdNode): MdNode => {
    if (n.type !== "element") return n;
    if (n.tag === "img" || n.tag === "video") {
      const a = n.attrs || {};
      const src = typeof a.src === "string" ? a.src : "";
      if (!isAllowedNow(src)) {
        return { type: "element", tag: "img", attrs: { src: opts.alternativeImage }, children: [] };
      }
      return { ...n, attrs: { ...a, src: applyRules(src) } };
    }
    return { ...n, children: (n.children || []).map(rewriteOne) };
  };

  return nodes.map(rewriteOne);
}

export function mdGroupImageGrid(nodes: MdNode[], opts?: { maxElements?: number }): MdNode[] {
  const maxElements = Math.max(1, opts?.maxElements ?? 100);
  function isFigureImageBlock(n: MdNode): n is MdElementNode & { tag: "figure" } {
    return n.type === "element" && n.tag === "figure" && n.attrs?.class === "image-block";
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
          out.push({
            type: "element",
            tag: "div",
            attrs: { class: "image-grid", "data-cols": chunk.length },
            children: chunk,
          });
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

export function mdFilterForFeatured(nodes: MdNode[]): MdNode[] {
  let featuredFig: MdNode | null = null;
  function isFigureImageBlock(n: MdNode): n is MdElementNode & { tag: "figure" } {
    return n.type === "element" && n.tag === "figure" && n.attrs?.class === "image-block";
  }
  function findMedia(n: MdNode | undefined): MdMediaElement | undefined {
    if (!n || n.type !== "element") return undefined;
    return (n.children || []).find(isMediaElement);
  }
  function findFeaturedFig(arr: MdNode[]): MdNode | null {
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
  function findFirstFig(arr: MdNode[]): MdNode | null {
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
  featuredFig = findFeaturedFig(nodes) || findFirstFig(nodes);
  function removeImageBlocks(arr: MdNode[]): MdNode[] {
    const out: MdNode[] = [];
    for (const n of arr) {
      if (isFigureImageBlock(n)) continue;
      if (n.type === "element" && n.children?.length)
        out.push({ ...n, children: removeImageBlocks(n.children) });
      else out.push(n);
    }
    return out;
  }
  const body = removeImageBlocks(nodes);
  if (featuredFig && featuredFig.type === "element") {
    const thumb: MdElementNode = {
      type: "element",
      tag: "figure",
      attrs: { ...(featuredFig.attrs || {}), class: "featured-block" },
      children: featuredFig.children,
    };
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
    remain: typeof params?.maxLen === "number" ? params.maxLen! : Number.POSITIVE_INFINITY,
    height: 0,
    maxHeight: typeof params?.maxHeight === "number" ? params!.maxHeight : Number.POSITIVE_INFINITY,
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
  function computeTextMetrics(ns: MdNode[]): { length: number; newlines: number } {
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
    (el.children || []).some((c) => c.type === "element" && (c.tag === "img" || c.tag === "video"));
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
  function cutTextContent(s: string, charge: boolean): { text: string; cut: boolean } {
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
      mdRenderText([{ type: "element", tag: "span", children }]).slice(0, captMaxLen) + "…";
    return [{ type: "text", text }];
  }
  function walk(n: MdNode, freeMedia: boolean, freeText: boolean): MdNode | null {
    if (state.cut) return null;
    if (n.type === "text") {
      const { text, cut } = cutTextContent(n.text, !freeText);
      if (text === "" && cut) return null;
      return { ...n, text };
    }
    const el = n as MdElementNode;
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
      const { length: contentLength, newlines } = computeTextMetrics(el.children || []);
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
    const finalChildren = el.tag === "figcaption" ? trimCaptionChildren(outChildren) : outChildren;
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
    "table",
  ]);
  const SINGLE_AFTER = new Set(["tr", "ul", "hr"]);
  const endsWithNewline = () => out.length > 0 && out[out.length - 1]!.endsWith("\n");
  const ensureNewline = () => {
    if (!endsWithNewline()) out.push("\n");
  };
  function walk(n: MdNode, depth = 0): void {
    if (n.type === "text") {
      out.push(n.text);
      return;
    }
    switch (n.tag) {
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
        ensureNewline();
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

export function mdRenderHtml(nodes: MdNode[]): string {
  function serializeAll(arr: MdNode[]): string {
    let html = "";
    for (const n of arr) html += serializeOne(n);
    return html;
  }
  function serializeOne(n: MdNode): string {
    if (n.type === "text") return escapeHTML(n.text);
    if (n.type === "element" && n.tag === "omitted") return `<span class="omitted">…</span>`;
    if (n.type === "element" && n.tag === "br") return `<br>`;
    if (n.type === "element" && n.tag === "hr") {
      const a = n.attrs || {};
      const attrs: MdAttrs = { ...a };
      if (attrs["hr-level"] !== undefined) {
        const v = attrs["hr-level"];
        delete attrs["hr-level"];
        (attrs as MdAttrs)["data-hr-level"] = v;
      }
      return `<hr${attrsToString(attrs)}>`;
    }
    if (n.type === "element" && n.tag === "pre") {
      const a = n.attrs || {};
      const attrs: MdAttrs = { ...a };
      if (attrs["pre-mode"] !== undefined) {
        const v = attrs["pre-mode"];
        delete attrs["pre-mode"];
        (attrs as MdAttrs)["data-pre-mode"] = v;
      }
      return `<pre${attrsToString(attrs)}>${serializeAll(n.children || [])}</pre>`;
    }
    if (n.type === "element" && n.tag === "figure") {
      const media = (n.children || []).find(isMediaElement);
      const figBase = n.attrs || {};
      const figExtra = media ? mediaDataAttrs(media.attrs || {}) : {};
      const figAttrs: MdAttrs = { ...figBase, ...figExtra };
      let inner = "";
      for (const c of n.children || []) {
        if (c.type === "element" && isMediaElement(c)) inner += serializeMedia(c);
        else if (c.type === "element" && c.tag === "figcaption")
          inner += `<figcaption>${serializeAll(c.children || [])}</figcaption>`;
        else inner += serializeOne(c);
      }
      return `<figure${attrsToString(figAttrs)}>${inner}</figure>`;
    }
    if (n.type === "element" && isMediaElement(n)) return serializeMedia(n);
    return `<${n.tag}${attrsToString(n.attrs)}>${serializeAll(n.children || [])}</${n.tag}>`;
  }
  function serializeMedia(n: MdMediaElement): string {
    const a = n.attrs || {};
    const src = a.src ? String(a.src) : "";
    if (n.tag === "img") {
      const base: MdAttrs = { src, alt: "", loading: "lazy", decoding: "async" };
      return `<img${attrsToString(base)}>`;
    } else {
      const base: MdAttrs = { src, "aria-label": "" as const, controls: true };
      return `<video${attrsToString(base)}></video>`;
    }
  }
  function attrsToString(attrs?: MdAttrs): string {
    if (!attrs) return "";
    const priority: Record<string, number> = { src: 0, alt: 1 };
    const keys = Object.keys(attrs).sort(
      (a, b) => (priority[a] ?? 10) - (priority[b] ?? 10) || a.localeCompare(b),
    );
    const a: Record<string, string | number | boolean | null | undefined> = attrs;
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
      if (k === "src" || k === "alt" || k === "aria-label" || k === "controls") continue;
      const dataName = `data-${k}`;
      out[dataName] = v === true ? true : String(v);
    }
    return out;
  }
  return serializeAll(nodes);
}

export function serializeMdNodes(nodes: MdNode[]): string {
  const enc = nodes.map(encodeNode);
  return JSON.stringify(enc);
}

export function deserializeMdNodes(data: string): MdNode[] {
  const arr = JSON.parse(data) as EncodedNode[];
  return arr.map(decodeNode);
}

function isMediaElement(n: MdNode): n is MdMediaElement {
  return n.type === "element" && (n.tag === "img" || n.tag === "video");
}

function parseInline(text: string): MdNode[] {
  const esc = /\\([\\~`*_\[\](){}#+\-.!])/;
  const bold = /\*\*([^\*]+)\*\*/;
  const italic = /\*([^\*]+)\*/;
  const underline = /__([^_]+)__/;
  const strike = /~~([^~]+)~~/;
  const code = /`([^`]+)`/;
  let m: RegExpExecArray | null;
  if ((m = esc.exec(text))) {
    return [
      ...parseInline(text.slice(0, m.index)),
      { type: "text", text: m[1]! },
      ...parseInline(text.slice(m.index + 2)),
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
      { type: "element", tag: "code", children: parseInline(m[1]!) },
      ...parseInline(text.slice(m.index + m[0]!.length)),
    ];
  }
  const linkRe = /\[([^\]]+)\]\(((?:https?:\/\/[^\s)]+|\/[^\s)]+|[-_a-z0-9]+))\)/gi;
  const nodes: MdNode[] = [];
  let last = 0;
  const resolveSpecialHref = (raw: string, anchor: string): string | null => {
    const toWiki = (lang: "en" | "ja", title: string) =>
      `https://${lang}.wikipedia.org/wiki/${encodeURIComponent(title.replace(/ /g, "_"))}`;
    if (raw === "wiki-en") return toWiki("en", anchor);
    if (raw === "wiki-ja") return toWiki("ja", anchor);
    if (raw === "google") return `https://www.google.com/search?q=${encodeURIComponent(anchor)}`;
    return null;
  };
  let match: RegExpExecArray | null;
  while ((match = linkRe.exec(text))) {
    if (match.index > last) nodes.push(...parseInlineText(text.slice(last, match.index)));
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
    if (match.index > last) nodes.push({ type: "text", text: text.slice(last, match.index) });
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
      typeof elm[NODE_KEY_TEXT] === "string" ? (elm[NODE_KEY_TEXT] as string) : undefined;
    const children: MdNode[] = rawChildren
      ? rawChildren.map(decodeNode)
      : inlineText !== undefined
        ? [{ type: "text", text: inlineText }]
        : [];
    let attrs: MdAttrs | undefined;
    for (const [k, v] of Object.entries(elm)) {
      if (k === NODE_KEY_TAG || k === NODE_KEY_CHILDREN || k === NODE_KEY_TEXT) continue;
      if (k === UNKNOWN_ATTR_BUCKET) continue;
      const orig = ATTR_DEC[k];
      if (!orig) continue;
      if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") {
        if (v === "" || v === false) continue;
        (attrs ??= {})[orig] = v;
      }
    }
    const unknown = elm[UNKNOWN_ATTR_BUCKET];
    if (unknown && typeof unknown === "object" && !Array.isArray(unknown)) {
      for (const [k, v] of Object.entries(unknown as UnknownAttrs)) {
        if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") {
          if (v === "" || v === false) continue;
          (attrs ??= {})[k] = v;
        }
      }
    }
    const tag = elm[NODE_KEY_TAG] as string;
    return attrs ? { type: "element", tag, attrs, children } : { type: "element", tag, children };
  }
  const txt = (e as EncodedText)[NODE_KEY_TEXT];
  return { type: "text", text: String(txt) };
}
