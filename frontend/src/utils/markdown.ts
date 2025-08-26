import { Config } from "@/config";

type Attrs = Record<string, string | number | boolean>;

type Node =
  | { type: "text"; text: string }
  | {
      type: "element";
      tag: string;
      attrs?: Attrs;
      children: Node[];
    };

export function renderText(nodes: Node[]): string {
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
  function walk(n: Node): void {
    if (n.type === "text") {
      out.push(n.text);
      return;
    }
    switch (n.tag) {
      case "br":
        out.push("\n");
        return;
      case "li":
        out.push("- ");
        (n.children || []).forEach(walk);
        out.push("\n");
        return;
      case "omitted":
        out.push("…");
        return;
      default:
        (n.children || []).forEach(walk);
        if (DOUBLE_AFTER.has(n.tag)) {
          out.push("\n\n");
        } else if (SINGLE_AFTER.has(n.tag)) {
          out.push("\n");
        }
        return;
    }
  }
  nodes.forEach(walk);
  const text = out.join("");
  return text
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

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
      nodes.push({ type: "element", tag: "blockquote", children: parseInline(currQuote.join("\n")) });
      currQuote = [];
    }
  }
  const imageMacroRe = /^!\[([^\]]*)\]\s*\(([^)]+)\)\s*(?:\{([^\}]*)\})?$/;
  const videoExts = /\.(mpg|mp4|m4a|mov|avi|wmv|webm)(\?.*)?$/i;
  for (let i = 0; i < lines.length; ++i) {
    const line = lines[i];
    const codeFence = line.match(/^```([\w:]*)/);
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
      flushPara(); flushList(); flushTable(); flushQuote();
      const dashCount = hr[0].length;
      const level = dashCount === 3 ? 1 : dashCount === 4 ? 2 : 3;
      nodes.push({ type: "element", tag: "hr", attrs: { "hr-level": level }, children: [] });
      continue;
    }
    const img = line.match(imageMacroRe);
    if (img) {
      flushPara(); flushList(); flushTable(); flushQuote();
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
      const mediaAttrs: Attrs = isVideo
        ? { src: url, "aria-label": "", controls: true }
        : { src: url, alt: "" };

      for (const [k, v] of Object.entries(macro)) {
        mediaAttrs[k] = v;
      }
      const figureChildren: Node[] = [
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
      flushPara(); flushList(); flushQuote();
      currTable.push(tableRow[1].split("|"));
      continue;
    } else if (currTable.length) {
      flushTable();
    }
    const quote = line.match(/^> (.*)$/);
    if (quote) {
      flushPara(); flushList(); flushTable();
      currQuote.push(quote[1]);
      continue;
    } else if (currQuote.length) {
      flushQuote();
    }
    if (/^\s*$/.test(line)) {
      flushPara(); flushList(); flushTable(); flushQuote();
      continue;
    }
    const h = line.match(/^(#{1,3}) (.+)$/);
    if (h) {
      flushPara(); flushList(); flushTable(); flushQuote();
      const level = h[1].length;
      nodes.push({ type: "element", tag: `h${level}`, children: parseInline(h[2]) });
      continue;
    }
    const li = line.match(/^(\s*)- (.+)$/);
    if (li) {
      flushPara(); flushTable(); flushQuote();
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
  flushPara(); flushList(); flushTable(); flushQuote();
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

export function cutOffMarkdownNodes(
  nodes: Node[],
  params?: {
    maxLen?: number;
    maxHeight?: number;
    imgLen?: number;
    imgHeight?: number;
  },
): Node[] {
  const imgLen = params?.imgLen ?? 50;
  const imgHeight = params?.imgHeight ?? 6;
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
  function getKind(attrs?: string | Record<string, any>): string | undefined {
    if (!attrs) return undefined;
    if (typeof attrs === "string") return undefined;
    const a = attrs as Record<string, any>;
    if (typeof a.kind === "string") return a.kind;
    if (typeof a.class === "string") {
      if (a.class.split(/\s+/).includes("thumbnail-block")) return "thumbnail-block";
      if (a.class.split(/\s+/).includes("image-block")) return "image-block";
    }
    if (typeof a.className === "string") {
      if (a.className.split(/\s+/).includes("thumbnail-block")) return "thumbnail-block";
      if (a.className.split(/\s+/).includes("image-block")) return "image-block";
    }
    return undefined;
  }
  function isThumbnailFigure(el: Extract<Node, { type: "element" }>): boolean {
    return el.tag === "figure" && getKind(el.attrs) === "thumbnail-block";
  }
  function isMedia(el: Extract<Node, { type: "element" }>): boolean {
    return el.tag === "img" || el.tag === "video";
  }
  function computeTextMetrics(nodes: Node[]): { length: number; newlines: number } {
    let length = 0;
    let newlines = 0;
    for (const n of nodes) {
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
  function bumpHeight(inc: number): boolean {
    const next = state.height + inc;
    if (next > state.maxHeight) return false;
    state.height = next;
    return true;
  }
  function consumeImageBudget(): boolean {
    const nextRemain = state.remain - imgLen;
    const nextHeight = state.height + imgHeight;
    if (nextRemain < 0 || nextHeight > state.maxHeight) return false;
    state.remain = nextRemain;
    state.height = nextHeight;
    return true;
  }
  function makeOmittedNode(): Node {
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
      if (part.length < s.length) {
        part = part + "…";
      }
      state.remain = 0;
      state.cut = true;
      return { text: part, cut: true };
    }
    state.remain -= s.length;
    return { text: s, cut: false };
  }
  function walk(n: Node, freeMedia: boolean, freeText: boolean): Node | null {
    if (state.cut) return null;

    if (n.type === "text") {
      const { text, cut } = cutTextContent(n.text, !freeText);
      if (text === "" && cut) return null;
      return { ...n, text };
    }
    const el = n;
    if (el.tag === "br") {
      if (!freeText) {
        if (!bumpHeight(1)) {
          state.cut = true;
          return null;
        }
      }
      return { ...el, children: [] };
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
    if (isMedia(el) && !freeMedia) {
      if (!consumeImageBudget()) {
        state.cut = true;
        return null;
      }
    }
    const childFreeMedia = freeMedia || isThumbnailFigure(el) || el.tag === "figcaption";
    const childFreeText = freeText || el.tag === "figcaption";
    const outChildren: Node[] = [];
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
    return { ...el, children: outChildren };
  }
  const out: Node[] = [];
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

export function renderHtml(nodes: Node[]): string {
  function serializeAll(arr: Node[]): string {
    let html = "";
    for (const n of arr) html += serializeOne(n);
    return html;
  }
  function serializeOne(n: Node): string {
    if (n.type === "text") {
      return escapeHTML(n.text);
    }
    if (n.type === "element" && n.tag === "omitted") {
      return `<span class="omitted">…</span>`;
    }
    if (n.type === "element" && n.tag === "br") {
      return `<br>`;
    }
    if (n.type === "element" && n.tag === "hr") {
      const a = n.attrs || {};
      const attrs = { ...a };
      if (attrs["hr-level"] !== undefined) {
        (attrs as any)[`data-hr-level`] = attrs["hr-level"];
        delete (attrs as any)["hr-level"];
      }
      return `<hr${attrsToString(attrs)}>`;
    }
    if (n.type === "element" && n.tag === "pre") {
      const a = n.attrs || {};
      const attrs = { ...a };
      if (attrs["pre-mode"] !== undefined) {
        (attrs as any)[`data-pre-mode`] = attrs["pre-mode"];
        delete (attrs as any)["pre-mode"];
      }
      return `<pre${attrsToString(attrs)}>${serializeAll(n.children || [])}</pre>`;
    }
    if (n.type === "element" && n.tag === "figure") {
      const media = (n.children || []).find(isMediaElement);
      const figBase = n.attrs || {};
      const figExtra = media ? mediaDataAttrs(media.attrs || {}) : {};
      const figAttrs = { ...figBase, ...figExtra };
      let inner = "";
      for (const c of n.children || []) {
        if (c.type === "element" && (c.tag === "img" || c.tag === "video")) {
          inner += serializeMedia(c);
        } else if (c.type === "element" && c.tag === "figcaption") {
          inner += `<figcaption>${serializeAll(c.children || [])}</figcaption>`;
        } else {
          inner += serializeOne(c);
        }
      }
      return `<figure${attrsToString(figAttrs)}>${inner}</figure>`;
    }
    if (n.type === "element" && (n.tag === "img" || n.tag === "video")) {
      return serializeMedia(n);
    }
    return `<${n.tag}${attrsToString(n.attrs)}>${serializeAll(n.children || [])}</${n.tag}>`;
  }
  function serializeMedia(n: Extract<Node, { type: "element" }>): string {
    const a = n.attrs || {};
    const src = a.src ? String(a.src) : "";
    if (n.tag === "img") {
      return `<img src="${escapeHTML(src)}" alt="">`;
    } else {
      const base: Attrs = { src, "aria-label": "" as const, controls: true };
      return `<video${attrsToString(base)}></video>`;
    }
  }
  function attrsToString(attrs?: Attrs): string {
    if (!attrs) return "";
    let out = "";
    for (const [k, v] of Object.entries(attrs)) {
      if (v === false || v === undefined || v === null) continue;
      const name = k;
      if (v === true) {
        out += ` ${name}`;
      } else {
        out += ` ${name}="${escapeHTML(String(v))}"`;
      }
    }
    return out;
  }
  function mediaDataAttrs(mediaAttrs: Attrs): Attrs {
    const out: Attrs = {};
    for (const [k, v] of Object.entries(mediaAttrs)) {
      if (k === "src" || k === "alt" || k === "aria-label" || k === "controls") continue;
      const dataName = `data-${k}`;
      out[dataName] = v === true ? true : String(v);
    }
    return out;
  }
  return serializeAll(nodes);
}

export function rewriteMediaUrls(nodes: Node[], useThumbnail: boolean): Node[] {
  function rewriteOne(n: Node): Node {
    if (n.type !== "element") return n;
    if (n.tag === "img" || n.tag === "video") {
      const a = n.attrs || {};
      const src = typeof a.src === "string" ? a.src : "";
      if (!/^\/(data|images|videos)\//.test(src)) {
        return { type: "element", tag: "img", attrs: { src: "/data/no-image.svg", alt: "" }, children: [] };
      }
      if (/^\/images\//.test(src)) {
        const baseUrl = `${Config.STORAGE_S3_PUBLIC_BASE_URL}/${Config.MEDIA_BUCKET_IMAGES}`;
        const newSrc = src.replace(/^\/images\//, `${baseUrl}/`);
        if (useThumbnail && /\/masters\//.test(newSrc)) {
          const qpos = newSrc.search(/[?#]/);
          const pathPart = qpos >= 0 ? newSrc.slice(0, qpos) : newSrc;
          const suffix = qpos >= 0 ? newSrc.slice(qpos) : "";
          let thumbPath = pathPart.replace(/\/masters\//, "/thumbs/");
          thumbPath = thumbPath.replace(/\/([^\/?#]+)$/, (_m, filename: string) => {
            const base = filename.replace(/\.[^.]+$/, "");
            return `/${base}_image.webp`;
          });
          return { ...n, attrs: { ...a, src: thumbPath + suffix } };
        }
        return { ...n, attrs: { ...a, src: newSrc } };
      }
      return n;
    }
    return { ...n, children: (n.children || []).map(rewriteOne) };
  }
  return nodes.map(rewriteOne);
}

export function groupImageGrid(nodes: Node[]): Node[] {
  function isFigureImageBlock(n: Node): n is Extract<Node, { type: "element" }> {
    return n.type === "element" && n.tag === "figure" && n.attrs?.class === "image-block";
  }
  function findMedia(n: Node | undefined) {
    if (!n || n.type !== "element") return undefined;
    return (n.children || []).find(isMediaElement);
  }
  function hasGridFlag(a?: Attrs): boolean {
    if (!a) return false;
    return !!a["grid"];
  }
  function groupInArray(arr: Node[]): Node[] {
    const out: Node[] = [];
    for (let i = 0; i < arr.length; ) {
      const node = arr[i];

      if (isFigureImageBlock(node) && hasGridFlag(findMedia(node)?.attrs)) {
        const group: Node[] = [node];
        let j = i + 1;
        while (j < arr.length && isFigureImageBlock(arr[j]) && hasGridFlag(findMedia(arr[j])?.attrs)) {
          group.push(arr[j]);
          j++;
        }
        if (group.length >= 2) {
          const cols = group.length;
          out.push({
            type: "element",
            tag: "div",
            attrs: { class: "image-grid", "data-cols": cols },
            children: group,
          });
          i = j;
          continue;
        }
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

export function filterNodesForThumbnail(nodes: Node[]): Node[] {
  let thumbnailFig: Node | null = null;
  function isFigureImageBlock(n: Node): boolean {
    return n.type === "element" && n.tag === "figure" && n.attrs?.class === "image-block";
  }
  function findMedia(n: Node | undefined) {
    if (!n || n.type !== "element") return undefined;
    return (n.children || []).find(isMediaElement);
  }
  function findThumbnailFig(arr: Node[]): Node | null {
    for (const node of arr) {
      if (isFigureImageBlock(node)) {
        const media = findMedia(node);
        if (media && media.attrs && media.attrs["thumbnail"]) return node;
      }
      if (node.type === "element" && node.children?.length) {
        const r = findThumbnailFig(node.children);
        if (r) return r;
      }
    }
    return null;
  }
  function findFirstFig(arr: Node[]): Node | null {
    for (const node of arr) {
      if (isFigureImageBlock(node)) {
        const media = findMedia(node);
        if (media) {
          if (!media.attrs || !media.attrs["no-thumbnail"]) return node;
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
  thumbnailFig = findThumbnailFig(nodes) || findFirstFig(nodes);
  function removeImageBlocks(arr: Node[]): Node[] {
    const out: Node[] = [];
    for (const n of arr) {
      if (isFigureImageBlock(n)) continue;
      if (n.type === "element" && n.children?.length) out.push({ ...n, children: removeImageBlocks(n.children) });
      else out.push(n);
    }
    return out;
  }
  const body = removeImageBlocks(nodes);
  if (thumbnailFig && thumbnailFig.type === "element") {
    const thumb: Node = {
      type: "element",
      tag: "figure",
      attrs: { ...(thumbnailFig.attrs || {}), class: "thumbnail-block" },
      children: thumbnailFig.children,
    };
    return [thumb, ...body];
  }
  return body;
}

function isMediaElement(n: Node): n is Extract<Node, { type: "element"; tag: "img" | "video" }> {
  return n.type === "element" && (n.tag === "img" || n.tag === "video");
}

function parseInline(text: string): Node[] {
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
  const nodes: Node[] = [];
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
    nodes.push({ type: "element", tag: "a", attrs: { href: resolved }, children: [{ type: "text", text: anchor }] });
    last = match.index + match[0]!.length;
  }
  text = text.slice(last);
  const urlRe = /(https?:\/\/[A-Za-z0-9\-._~:/?#[\]@!$&'()*+,;=%]+)/g;
  last = 0;
  while ((match = urlRe.exec(text))) {
    if (match.index > last) nodes.push({ type: "text", text: text.slice(last, match.index) });
    const url = match[0]!;
    nodes.push({ type: "element", tag: "a", attrs: { href: url }, children: [{ type: "text", text: url }] });
    last = match.index + match[0]!.length;
  }
  if (last < text.length) nodes.push({ type: "text", text: text.slice(last) });
  return nodes.flatMap<Node>((n) =>
    n.type === "text"
      ? n.text.split(/\n/).flatMap<Node>((frag, i) =>
          i === 0
            ? [{ type: "text", text: frag }]
            : [{ type: "element", tag: "br", children: [] }, { type: "text", text: frag }],
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
