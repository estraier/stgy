"use client";

import React, { useRef, useState, useMemo, useEffect, useLayoutEffect, useCallback } from "react";
import {
  Heading1,
  Heading2,
  Heading3,
  List as ListIcon,
  Quote as QuoteIcon,
  Code as CodeBlockIcon,
  Bold as BoldIcon,
  Italic as ItalicIcon,
  Underline as UnderlineIcon,
  Strikethrough as StrikethroughIcon,
  Code2 as InlineCodeIcon,
  Highlighter as MarkIcon,
  Braces as RubyIcon,
  Link as LinkIcon,
} from "lucide-react";
import {
  parseMarkdown,
  mdGroupImageGrid,
  mdFilterForFeatured,
  mdCutOff,
  mdRenderHtml,
  mdRenderText,
} from "stgy-markdown";

type Mode = "html" | "text";

type Props = {
  initialBody?: string;
  placeholder?: string;
  className?: string;
  autoFocus?: boolean;
  contentLengthLimit?: number;
};

function normalizeLineForHeading(line: string): string {
  const stripped = line.replace(/^(\s*(?:-\s+|>\s+|#{1,3}\s+))+/u, "");
  return stripped.trim();
}
function escapeReg(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
function makePrefixRegex(prefix: string): RegExp {
  const hasSpace = /\s$/.test(prefix);
  const base = hasSpace ? prefix.trimEnd() : prefix;
  const pattern = `^\\s*${escapeReg(base)}${hasSpace ? "\\s+" : ""}`;
  return new RegExp(pattern, "u");
}
function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}
function lineStartAt(text: string, i: number) {
  return text.lastIndexOf("\n", Math.max(0, i - 1)) + 1;
}
function lineEndFromStart(text: string, start: number) {
  const nl = text.indexOf("\n", start);
  return nl === -1 ? text.length : nl;
}
function getCurrentLineRange(text: string, caret: number) {
  const start = lineStartAt(text, caret);
  const end = lineEndFromStart(text, start);
  return { start, end };
}
function getSelectedLinesRange(text: string, selStart: number, selEnd: number) {
  const s0 = clamp(Math.min(selStart, selEnd), 0, text.length);
  const e0 = clamp(Math.max(selStart, selEnd), 0, text.length);
  const firstStart = lineStartAt(text, s0);
  let lastTouched = Math.max(0, e0 - 1);
  if (e0 > s0 && text[lastTouched] === "\n") lastTouched = Math.max(firstStart, lastTouched - 1);
  const lastStart = lineStartAt(text, lastTouched);
  const lastEnd = lineEndFromStart(text, lastStart);
  return { start: firstStart, end: lastEnd };
}
function getTargetRange(text: string, selStart: number, selEnd: number) {
  const s0 = clamp(Math.min(selStart, selEnd), 0, text.length);
  const e0 = clamp(Math.max(selStart, selEnd), 0, text.length);
  return s0 === e0 ? getCurrentLineRange(text, e0) : getSelectedLinesRange(text, s0, e0);
}

function applyPrefixToggleFromTextarea(
  ta: HTMLTextAreaElement,
  setBody: (next: string) => void,
  prefix: string,
) {
  const text = ta.value;
  const selStart = ta.selectionStart ?? 0;
  const selEnd = ta.selectionEnd ?? selStart;
  const { start, end } = getTargetRange(text, selStart, selEnd);
  const head = text.slice(0, start);
  const block = text.slice(start, end);
  const tail = text.slice(end);
  const re = makePrefixRegex(prefix);
  const lines = block.split("\n");
  const nonEmpty = lines.filter((ln) => ln.trim() !== "");
  const allPrefixed = nonEmpty.length > 0 && nonEmpty.every((ln) => re.test(ln));
  const replaced = lines
    .map((ln) => {
      if (ln.trim() === "") return ln;
      const norm = normalizeLineForHeading(ln);
      return allPrefixed ? norm : `${prefix}${norm}`;
    })
    .join("\n");
  const next = head + replaced + tail;
  setBody(next);
  const selFrom = head.length;
  const selTo = head.length + replaced.length;
  requestAnimationFrame(() => {
    ta.setSelectionRange(selFrom, selTo);
  });
}

function applyCodeFenceToggleFromTextarea(
  ta: HTMLTextAreaElement,
  setBody: (next: string) => void,
) {
  const text = ta.value;
  const selStart = ta.selectionStart ?? 0;
  const selEnd = ta.selectionEnd ?? selStart;
  const { start, end } = getTargetRange(text, selStart, selEnd);
  const head = text.slice(0, start);
  const block = text.slice(start, end);
  const tail = text.slice(end);
  const fenceRe = /^\s*```/;
  const firstLineEndRel = block.indexOf("\n");
  const lastLineStartRel = block.lastIndexOf("\n") + 1;
  const firstLine = firstLineEndRel === -1 ? block : block.slice(0, firstLineEndRel);
  const lastLine = block.slice(lastLineStartRel);
  const firstIsFence = fenceRe.test(firstLine);
  const lastIsFence = fenceRe.test(lastLine);
  if (firstIsFence && lastIsFence) {
    const innerStart = firstLineEndRel === -1 ? block.length : firstLineEndRel + 1;
    const innerEnd = Math.max(innerStart, lastLineStartRel);
    const replaced = block.slice(innerStart, innerEnd);
    const nextText = head + replaced + tail;
    setBody(nextText);
    const selFrom = head.length;
    const selTo = head.length + replaced.length;
    requestAnimationFrame(() => {
      ta.setSelectionRange(selFrom, selTo);
    });
    return;
  }
  let content = block;
  if (!content.endsWith("\n")) content += "\n";
  const replaced = "```\n" + content + "```";
  const nextText = head + replaced + tail;
  setBody(nextText);
  const selFrom = head.length;
  const selTo = head.length + replaced.length;
  requestAnimationFrame(() => {
    ta.setSelectionRange(selFrom, selTo);
  });
}

function applyInlineToggleFromTextarea(
  ta: HTMLTextAreaElement,
  setBody: (next: string) => void,
  open: string,
  close: string = open,
) {
  const text = ta.value;
  const s0 = ta.selectionStart ?? 0;
  const e0 = ta.selectionEnd ?? s0;
  if (s0 === e0) {
    const before = text.slice(0, s0);
    const after = text.slice(e0);
    const insert = open + close;
    const next = before + insert + after;
    setBody(next);
    const pos = before.length + open.length;
    requestAnimationFrame(() => {
      ta.setSelectionRange(pos, pos);
    });
    return;
  }
  const head = text.slice(0, s0);
  const block = text.slice(s0, e0);
  const tail = text.slice(e0);
  const parts = block.split("\n");
  const replacedBlock = parts
    .map((seg) => {
      if (seg.length === 0) return seg;
      const isWrapped =
        seg.startsWith(open) && seg.endsWith(close) && seg.length >= open.length + close.length;
      return isWrapped ? seg.slice(open.length, seg.length - close.length) : open + seg + close;
    })
    .join("\n");
  const nextText = head + replacedBlock + tail;
  setBody(nextText);
  const selFrom = head.length;
  const selTo = head.length + replacedBlock.length;
  requestAnimationFrame(() => {
    ta.setSelectionRange(selFrom, selTo);
  });
}

function applyRubyToggleFromTextarea(ta: HTMLTextAreaElement, setBody: (next: string) => void) {
  const text = ta.value;
  const s0 = ta.selectionStart ?? 0;
  const e0 = ta.selectionEnd ?? s0;
  if (s0 === e0) {
    const before = text.slice(0, s0);
    const after = text.slice(e0);
    const insert = "{{|ruby}}";
    const next = before + insert + after;
    setBody(next);
    const pos = before.length + 2;
    requestAnimationFrame(() => {
      ta.setSelectionRange(pos, pos);
    });
    return;
  }
  const head = text.slice(0, s0);
  const block = text.slice(s0, e0);
  const tail = text.slice(e0);
  const rubyFullRe = /^\{\{([\s\S]*?)\|([\s\S]*?)\}\}$/u;
  const parts = block.split("\n");
  const replacedBlock = parts
    .map((seg) => {
      if (seg.length === 0) return seg;
      const m = seg.match(rubyFullRe);
      if (m) return m[1];
      return `{{${seg}|ruby}}`;
    })
    .join("\n");
  const nextText = head + replacedBlock + tail;
  setBody(nextText);
  const selFrom = head.length;
  const selTo = head.length + replacedBlock.length;
  requestAnimationFrame(() => {
    ta.setSelectionRange(selFrom, selTo);
  });
}

function applyLinkToggleFromTextarea(ta: HTMLTextAreaElement, setBody: (next: string) => void) {
  const text = ta.value;
  const s0 = ta.selectionStart ?? 0;
  const e0 = ta.selectionEnd ?? s0;
  if (s0 === e0) {
    const before = text.slice(0, s0);
    const after = text.slice(e0);
    const insert = "[](url)";
    const next = before + insert + after;
    setBody(next);
    const pos = before.length + 1;
    requestAnimationFrame(() => {
      ta.setSelectionRange(pos, pos);
    });
    return;
  }
  const head = text.slice(0, s0);
  const block = text.slice(s0, e0);
  const tail = text.slice(e0);
  const linkFullRe = /^\[([\s\S]*?)\]\(([\s\S]*?)\)$/u;
  const parts = block.split("\n");
  const replacedBlock = parts
    .map((seg) => {
      if (seg.length === 0) return seg;
      const m = seg.match(linkFullRe);
      if (m) return m[1];
      return `[${seg}](url)`;
    })
    .join("\n");
  const nextText = head + replacedBlock + tail;
  setBody(nextText);
  const selFrom = head.length;
  const selTo = head.length + replacedBlock.length;
  requestAnimationFrame(() => {
    ta.setSelectionRange(selFrom, selTo);
  });
}

function resolveLineHeight(ta: HTMLTextAreaElement) {
  const s = window.getComputedStyle(ta);
  const lh = s.lineHeight;
  if (!lh || lh === "normal") {
    const fs = parseFloat(s.fontSize || "16");
    return fs * 1.2;
  }
  const v = parseFloat(lh);
  return Number.isFinite(v) ? v : 20;
}
function centerTextareaCaret(ta: HTMLTextAreaElement) {
  const lineHeight = resolveLineHeight(ta);
  const len = Math.max(1, ta.value.length);
  const caret = ta.selectionStart ?? 0;
  const approxY = (caret / len) * (ta.scrollHeight - lineHeight);
  const desired = Math.max(0, approxY - (ta.clientHeight - lineHeight) / 2);
  const maxScroll = Math.max(0, ta.scrollHeight - ta.clientHeight);
  ta.scrollTop = Math.min(maxScroll, desired);
}

function escapeHtml(s: string) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
function buildMirrorFromTextarea(ta: HTMLTextAreaElement, mirror: HTMLDivElement) {
  const cs = getComputedStyle(ta);
  type StyleKey = Extract<keyof CSSStyleDeclaration, string>;
  const assign = (prop: StyleKey, v: string) => {
    (mirror.style as unknown as Record<StyleKey, string>)[prop] = v;
  };
  assign("position", "absolute");
  assign("visibility", "hidden");
  assign("whiteSpace", "pre-wrap");
  assign("wordBreak", cs.wordBreak || "normal");
  assign("overflowWrap", cs.overflowWrap || "break-word");
  assign("top", "0");
  assign("left", "-99999px");
  assign("boxSizing", "border-box");
  assign("width", `${ta.clientWidth}px`);
  assign("borderLeftWidth", cs.borderLeftWidth || "0");
  assign("borderRightWidth", cs.borderRightWidth || "0");
  assign("paddingTop", cs.paddingTop || "0");
  assign("paddingRight", cs.paddingRight || "0");
  assign("paddingBottom", cs.paddingBottom || "0");
  assign("paddingLeft", cs.paddingLeft || "0");
  assign("fontFamily", cs.fontFamily || "inherit");
  assign("fontSize", cs.fontSize || "inherit");
  assign("fontWeight", cs.fontWeight || "normal");
  assign("fontStyle", cs.fontStyle || "normal");
  assign("lineHeight", cs.lineHeight || "normal");
  assign("letterSpacing", cs.letterSpacing || "normal");
  assign("tabSize", (cs as unknown as { tabSize?: string }).tabSize || "4");
}
function computeCaretTopInTextarea(ta: HTMLTextAreaElement, mirror: HTMLDivElement): number {
  buildMirrorFromTextarea(ta, mirror);
  const pos = Math.max(0, Math.min(ta.value.length, ta.selectionStart ?? 0));
  const before = ta.value.slice(0, pos);
  const html =
    escapeHtml(before).replace(/ /g, "&#160;").replace(/\n/g, "<br/>") +
    '<span data-caret style="display:inline-block;width:1px;height:1em;"></span>';
  mirror.innerHTML = html;
  document.body.appendChild(mirror);
  const marker = mirror.querySelector<HTMLSpanElement>("span[data-caret]");
  const top = marker ? marker.offsetTop : 0;
  return top;
}

export default function MarkdownSnippetSandbox({
  initialBody = `# サイドバイサイドエディタのデモ

ここは、**Markdown**のサイドバイサイドエディタの**デモサイト**です。

画面の左半分が入力フォームです。入力フォームの内容を編集すれば、その内容がMarkdownとして解釈され、AST（抽象構文木）を経てHTMLに変換され、右側の欄に描写されます。

長文をエディタで書いてから、コピペして校正とレイアウト調整をするというユースケースを想定しています。よって、%%とにかく校正しやすい%%ように工夫してあります。

- メニューボタンの押下で簡単にマークアップとその解除ができる。
- 入力フォームでカーソルのある行は水色にハイライトされる。
- その行に対応するプレビューのHTMLブロック要素がハイライトされる。
- 入力フォームでカーソルを移すとプレビュー欄が対応要素に自動スクロールする。
- プレビュー欄の左のツマミをクリックすると入力フォームが対応行に自動スクロールする。

つまり、__入力フォームを編集すれば、自分でスクロールしなくても常にプレビュー欄でその変化を確認__できるようになっています。プレビュー欄を見ながら不具合を見つければ、__入力フォームの対応する修正箇所に簡単にジャンプ__できます。

## サブヘッダ

### サブサブヘッダ

地の文。地の文。
地の文の中の改行は<br>扱いで、マージンなしで改行。

段落は空白で区切る。一つの段落は<p>で囲む。

> ブロッククォートも**ある**とか::ない::とか。
> こんな__感じ__で\`\`markdown\`\`は%%便利%%~~じゃない~~だ。

- リスト1
  - サブリストA
    - サブ**サブ**。{{竜破斬|ドラグ・スレイブ}}と{{三日月型砂丘|バルハン}}
- リスト2
- リスト3

Go to [Google](https://google.com/).
Set: http://example.com/

### Go to [Google](https://google.com/) and **Yahoo**
### Set: http://example.com/ and __Yapoo__

- Go to [Google](https://google.com/) and **Yahoo**
  - Set: http://example.com/ and __Yapoo__

- We __live__ ::in:: **Tokyo** [Shinjuku](https://ja.wikipedia.org/wiki/%E6%96%B0%E5%AE%BF)

|=I and Nancy=|__live__|><in|{rowspan=2}**Tokyo**|{colspan=2}[Shinjuku](https://ja.wikipedia.org/wiki/%E6%96%B0%E5%AE%BF)|
|=>>one=|>>**two**|three|four|><five|

![これはロゴです](/data/logo-square.svg){size=small}

\`\`\`
コードブロック
# これはヘッダじゃない
- これはリストじゃない
\`\`\`

We live in Tokyo.

![ロゴ1](/data/logo-square.svg){grid}
![ロゴ2](/data/logo-square.svg){grid,featured}
![ロゴ3](/data/logo-square.svg){grid}
`,
  placeholder = "Write Markdown here…",
  className = "",
  autoFocus = false,
  contentLengthLimit,
}: Props) {
  const [body, setBody] = useState<string>(initialBody);
  const [mode, setMode] = useState<Mode>("html");
  const [maxLen, setMaxLen] = useState<number | undefined>(undefined);
  const [maxHeight, setMaxHeight] = useState<number | undefined>(undefined);
  const [useFeatured, setUseFeatured] = useState<boolean>(false);

  const leftScrollRef = useRef<HTMLDivElement>(null);
  const leftInnerRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const previewWrapRef = useRef<HTMLDivElement>(null);
  const previewBodyRef = useRef<HTMLDivElement | HTMLPreElement | null>(null);
  const gutterRef = useRef<HTMLDivElement | null>(null);

  const caretMirrorRef = useRef<HTMLDivElement | null>(null);
  const highlightOverlayRef = useRef<HTMLDivElement | null>(null);
  const highlightBandRef = useRef<HTMLDivElement | null>(null);

  const previewHighlightOverlayRef = useRef<HTMLDivElement | null>(null);
  const previewHighlightBandRef = useRef<HTMLDivElement | null>(null);

  const anchorsRef = useRef<{ char: number; el: HTMLElement }[]>([]);
  const rafRef = useRef<number | null>(null);
  const caretRef = useRef<number>(0);
  const highlightRafRef = useRef<number | null>(null);
  const previewHighlightRafRef = useRef<number | null>(null);

  const moRef = useRef<MutationObserver | null>(null);
  const roWrapRef = useRef<ResizeObserver | null>(null);
  const roBodyRef = useRef<ResizeObserver | null>(null);

  const ensureTimersRef = useRef<number[]>([]);
  const didAutoFocusRef = useRef(false);

  const content = useMemo(() => body, [body]);
  const contentLength = content.length;
  const overLimit = contentLengthLimit != null ? contentLength > contentLengthLimit : false;

  const renderHtml = useCallback(
    (md: string) => {
      let nodes = parseMarkdown(md);
      nodes = mdGroupImageGrid(nodes);
      if (useFeatured) nodes = mdFilterForFeatured(nodes);
      nodes = mdCutOff(nodes, { maxLen, maxHeight });
      return mdRenderHtml(nodes, true);
    },
    [maxLen, maxHeight, useFeatured],
  );

  const renderText = useCallback(
    (md: string) => {
      let nodes = parseMarkdown(md);
      nodes = mdCutOff(nodes, { maxLen, maxHeight, imgLen: -1, imgHeight: 1 });
      return mdRenderText(nodes);
    },
    [maxLen, maxHeight],
  );

  const activeTextarea = useCallback((): HTMLTextAreaElement | null => textareaRef.current, []);
  const activePreviewWrap = useCallback((): HTMLDivElement | null => previewWrapRef.current, []);
  const activePreviewBody = useCallback(
    (): (HTMLDivElement | HTMLPreElement) | null => previewBodyRef.current,
    [],
  );

  const rebuildAnchors = useCallback(() => {
    const root = activePreviewBody();
    if (!root) {
      anchorsRef.current = [];
      return;
    }
    const list = Array.from(root.querySelectorAll<HTMLElement>("[data-char-position]"));
    const withIndex = list
      .map((el, idx) => {
        const v = Number(el.getAttribute("data-char-position") || "");
        return Number.isFinite(v) ? { char: v, el, idx } : null;
      })
      .filter((x): x is { char: number; el: HTMLElement; idx: number } => !!x);
    withIndex.sort((a, b) => a.char - b.char || a.idx - b.idx);
    anchorsRef.current = withIndex.map(({ char, el }) => ({ char, el }));
  }, [activePreviewBody]);

  const findAnchor = useCallback((caret: number): HTMLElement | null => {
    const anchors = anchorsRef.current;
    if (!anchors.length) return null;
    let lo = 0;
    let hi = anchors.length - 1;
    let ans = 0;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (anchors[mid]!.char <= caret) {
        ans = mid;
        lo = mid + 1;
      } else {
        hi = mid - 1;
      }
    }
    return anchors[ans]!.el;
  }, []);

  const syncToCaret = useCallback(() => {
    const wrap = activePreviewWrap();
    const caret = Math.min(Math.max(0, caretRef.current), content.length);
    if (!wrap) return;
    const target = findAnchor(caret);
    if (target) {
      const wrapRect = wrap.getBoundingClientRect();
      const elRect = target.getBoundingClientRect();
      const yWithin = wrap.scrollTop + (elRect.top - wrapRect.top);
      const desired = Math.max(0, yWithin - (wrap.clientHeight - target.offsetHeight) / 2);
      wrap.scrollTop = desired;
      return;
    }
    const desired = ((wrap.scrollHeight - wrap.clientHeight) * caret) / Math.max(1, content.length);
    wrap.scrollTop = Math.max(0, Math.min(wrap.scrollHeight - wrap.clientHeight, desired));
  }, [activePreviewWrap, content.length, findAnchor]);

  const updateCaretHighlight = useCallback(() => {
    const ta = textareaRef.current;
    const overlay = highlightOverlayRef.current;
    const band = highlightBandRef.current;
    if (!ta || !overlay || !band) return;
    overlay.style.position = "absolute";
    overlay.style.pointerEvents = "none";
    overlay.style.left = `${ta.offsetLeft}px`;
    overlay.style.top = `${ta.offsetTop}px`;
    overlay.style.width = `${ta.offsetWidth}px`;
    overlay.style.height = `${ta.offsetHeight}px`;
    overlay.style.zIndex = "0";
    overlay.style.background = "#fff";
    overlay.style.borderRadius = getComputedStyle(ta).borderRadius || "0px";
    let mirror = caretMirrorRef.current;
    if (!mirror) {
      mirror = document.createElement("div");
      caretMirrorRef.current = mirror;
      document.body.appendChild(mirror);
    }
    const caretTop = computeCaretTopInTextarea(ta, mirror);
    const visibleTop = Math.round(caretTop - ta.scrollTop);
    const lh = Math.round(resolveLineHeight(ta));
    const topWithin = Math.max(0, Math.min(ta.clientHeight - lh, visibleTop));
    const cs = getComputedStyle(ta);
    const pl = parseFloat(cs.paddingLeft || "0");
    const pr = parseFloat(cs.paddingRight || "0");
    const bt = parseFloat(cs.borderTopWidth || "0");
    const bl = parseFloat(cs.borderLeftWidth || "0");
    band.style.position = "absolute";
    band.style.background = "#eef8ff";
    band.style.top = `${bt + topWithin}px`;
    band.style.left = `${bl + pl}px`;
    band.style.height = `${lh}px`;
    band.style.width = `${ta.clientWidth - pl - pr}px`;
    band.style.borderRadius = "4px";
  }, []);

  const scheduleHighlight = useCallback(() => {
    if (highlightRafRef.current != null) cancelAnimationFrame(highlightRafRef.current);
    highlightRafRef.current = requestAnimationFrame(() => {
      highlightRafRef.current = null;
      updateCaretHighlight();
    });
  }, [updateCaretHighlight]);

  const updatePreviewHighlight = useCallback(() => {
    if (mode !== "html") {
      const band = previewHighlightBandRef.current;
      if (band) band.style.display = "none";
      return;
    }
    const wrap = previewWrapRef.current;
    const overlay = previewHighlightOverlayRef.current;
    const band = previewHighlightBandRef.current;
    if (!wrap || !overlay || !band) return;
    overlay.style.position = "absolute";
    overlay.style.pointerEvents = "none";
    overlay.style.left = "0px";
    overlay.style.top = "0px";
    overlay.style.width = "100%";
    overlay.style.height = "100%";
    overlay.style.zIndex = "0";
    const target = findAnchor(Math.min(Math.max(0, caretRef.current), content.length));
    if (!target) {
      band.style.display = "none";
      return;
    }
    const wrapRect = wrap.getBoundingClientRect();
    const rects = target.getClientRects();
    const r = rects.length ? rects[0]! : target.getBoundingClientRect();
    const PREVIEW_HIGHLIGHT_EXPAND = 4;
    const topWithin =
      Math.round(wrap.scrollTop + (r.top - wrapRect.top)) - PREVIEW_HIGHLIGHT_EXPAND;
    const leftWithin = Math.round(r.left - wrapRect.left) - PREVIEW_HIGHLIGHT_EXPAND;
    const width = Math.round(r.width) + PREVIEW_HIGHLIGHT_EXPAND * 2;
    const height = Math.max(1, Math.round(r.height)) + PREVIEW_HIGHLIGHT_EXPAND * 2;
    band.style.display = "block";
    band.style.position = "absolute";
    band.style.background = "#eef8ff";
    band.style.top = `${topWithin}px`;
    band.style.left = `${leftWithin}px`;
    band.style.height = `${height}px`;
    band.style.width = `${width}px`;
    band.style.borderRadius = "4px";
  }, [mode, content.length, findAnchor]);

  const schedulePreviewHighlight = useCallback(() => {
    if (previewHighlightRafRef.current != null)
      cancelAnimationFrame(previewHighlightRafRef.current);
    previewHighlightRafRef.current = requestAnimationFrame(() => {
      previewHighlightRafRef.current = null;
      updatePreviewHighlight();
    });
  }, [updatePreviewHighlight]);

  const ensureGutter = useCallback(() => {
    const wrap = previewWrapRef.current;
    if (!wrap) return null;
    let gutter = gutterRef.current;
    if (!gutter) {
      gutter = document.createElement("div");
      gutterRef.current = gutter;
      gutter.setAttribute("data-gutter", "1");
      Object.assign(gutter.style, {
        position: "absolute",
        left: "0px",
        top: "0px",
        width: "22px",
        pointerEvents: "none",
        background: "rgba(0,0,0,0.03)",
        zIndex: "2",
      } as Partial<CSSStyleDeclaration>);
      wrap.appendChild(gutter);
    }
    gutter.style.height = `${wrap.scrollHeight}px`;
    return gutter;
  }, []);

  const refreshGutterPins = useCallback(() => {
    if (mode !== "html") {
      gutterRef.current?.replaceChildren();
      return;
    }
    const wrap = previewWrapRef.current;
    const bodyEl = previewBodyRef.current as HTMLDivElement | null;
    const ta = textareaRef.current;
    if (!wrap || !bodyEl || !ta) return;
    const gutter = ensureGutter();
    if (!gutter) return;
    gutter.replaceChildren();
    const wrapRect = wrap.getBoundingClientRect();
    const candidates = Array.from(bodyEl.querySelectorAll<HTMLElement>("[data-char-position]"));
    for (const el of candidates) {
      const charAttr = el.getAttribute("data-char-position");
      const lineAttr = el.getAttribute("data-line-position");
      if (!charAttr || !lineAttr) continue;
      const rects = el.getClientRects();
      const r = rects.length ? rects[0]! : el.getBoundingClientRect();
      const yAbsolute = Math.round(wrap.scrollTop + (r.top - wrapRect.top) + 12);
      const btn = document.createElement("button");
      btn.type = "button";
      btn.setAttribute("data-jump-pin", "1");
      const jumpLabel = "Jump to line " + (parseInt(lineAttr) + 1);
      btn.title = jumpLabel;
      btn.setAttribute("aria-label", jumpLabel);
      btn.textContent = "";
      Object.assign(btn.style, {
        position: "absolute",
        left: "3px",
        top: `${yAbsolute}px`,
        transform: "translateY(-50%)",
        width: "16px",
        height: "6px",
        borderRadius: "6px",
        border: "1px solid #cbd5e1",
        background: "#e2e8f0",
        boxShadow: "0 1px 1px rgba(0,0,0,.08)",
        padding: "0",
        cursor: "pointer",
        pointerEvents: "auto",
        outline: "none",
      } as Partial<CSSStyleDeclaration>);
      btn.addEventListener("mouseenter", () => {
        btn.style.background = "#cbd5e1";
      });
      btn.addEventListener("mouseleave", () => {
        btn.style.background = "#e2e8f0";
      });
      btn.addEventListener("mousedown", () => {
        btn.style.background = "#94a3b8";
      });
      btn.addEventListener("mouseup", () => {
        btn.style.background = "#cbd5e1";
      });
      btn.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        const pos = Number(charAttr) || 0;
        ta.focus();
        ta.setSelectionRange(pos, pos);
        centerTextareaCaret(ta);
        caretRef.current = pos;
        rebuildAnchors();
        syncToCaret();
        refreshGutterPins();
        scheduleHighlight();
        schedulePreviewHighlight();
      });
      gutter.appendChild(btn);
    }
  }, [
    mode,
    ensureGutter,
    rebuildAnchors,
    syncToCaret,
    scheduleHighlight,
    schedulePreviewHighlight,
  ]);

  const scheduleSync = useCallback(() => {
    if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null;
      rebuildAnchors();
      syncToCaret();
      refreshGutterPins();
      schedulePreviewHighlight();
    });
  }, [rebuildAnchors, syncToCaret, refreshGutterPins, schedulePreviewHighlight]);

  const resizeTextarea = useCallback(() => {
    const ta = textareaRef.current;
    const scroll = leftScrollRef.current;
    const inner = leftInnerRef.current;
    if (!ta || !scroll || !inner) return;
    const innerStyle = getComputedStyle(inner);
    const pt = parseFloat(innerStyle.paddingTop || "0");
    const pb = parseFloat(innerStyle.paddingBottom || "0");
    const available = Math.max(160, scroll.clientHeight - pt - pb);
    ta.style.height = `${available}px`;
  }, []);

  const attachObservers = useCallback(() => {
    const wrap = activePreviewWrap();
    const bodyEl = activePreviewBody();
    moRef.current?.disconnect();
    roWrapRef.current?.disconnect();
    roBodyRef.current?.disconnect();
    if (bodyEl) {
      const onImg = () => {
        scheduleSync();
        schedulePreviewHighlight();
      };
      const mo = new MutationObserver(() => {
        scheduleSync();
        schedulePreviewHighlight();
      });
      mo.observe(bodyEl, { childList: true, subtree: true });
      bodyEl.querySelectorAll("img").forEach((img) => {
        img.addEventListener("load", onImg, { once: true });
        img.addEventListener("error", onImg, { once: true });
      });
      moRef.current = mo;
    }
    if (wrap) {
      const ro = new ResizeObserver(() => {
        scheduleSync();
        schedulePreviewHighlight();
      });
      ro.observe(wrap);
      roWrapRef.current = ro;
      const onScroll = () => {
        refreshGutterPins();
        schedulePreviewHighlight();
      };
      wrap.addEventListener("scroll", onScroll);
      const prevWrap = wrap;
      return () => prevWrap.removeEventListener("scroll", onScroll);
    }
    if (bodyEl) {
      const ro2 = new ResizeObserver(() => {
        scheduleSync();
        schedulePreviewHighlight();
      });
      ro2.observe(bodyEl);
      roBodyRef.current = ro2;
    }
    return;
  }, [
    activePreviewWrap,
    activePreviewBody,
    scheduleSync,
    refreshGutterPins,
    schedulePreviewHighlight,
  ]);

  const ensurePreviewReadyAndSync = useCallback(
    (maxTries = 120) => {
      let tries = maxTries;
      const tick = () => {
        const wrap = activePreviewWrap();
        const bodyEl = activePreviewBody();
        if (!wrap || !bodyEl) {
          if (--tries > 0) requestAnimationFrame(tick);
          return;
        }
        if (wrap.clientHeight === 0) {
          if (--tries > 0) requestAnimationFrame(tick);
          return;
        }
        rebuildAnchors();
        scheduleSync();
        schedulePreviewHighlight();
      };
      requestAnimationFrame(tick);
      const t1 = window.setTimeout(() => {
        scheduleSync();
        schedulePreviewHighlight();
      }, 80);
      const t2 = window.setTimeout(() => {
        scheduleSync();
        schedulePreviewHighlight();
      }, 160);
      const t3 = window.setTimeout(() => {
        scheduleSync();
        schedulePreviewHighlight();
      }, 320);
      ensureTimersRef.current.push(t1, t2, t3);
      const d = document as Document & { fonts?: { ready?: Promise<unknown> } };
      const f = d.fonts;
      if (f && typeof f.ready?.then === "function") {
        f.ready.then(() => {
          scheduleSync();
          schedulePreviewHighlight();
        });
      }
    },
    [activePreviewWrap, activePreviewBody, rebuildAnchors, scheduleSync, schedulePreviewHighlight],
  );

  useLayoutEffect(() => {
    resizeTextarea();
    const onResize = () => {
      resizeTextarea();
      refreshGutterPins();
      scheduleHighlight();
      schedulePreviewHighlight();
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [resizeTextarea, refreshGutterPins, scheduleHighlight, schedulePreviewHighlight]);

  useEffect(() => {
    scheduleHighlight();
    schedulePreviewHighlight();
  }, [scheduleHighlight, schedulePreviewHighlight]);

  useEffect(() => {
    if (autoFocus && !didAutoFocusRef.current) {
      const ta = textareaRef.current;
      if (ta) {
        ta.focus();
        ta.setSelectionRange(0, 0);
        ta.scrollTop = 0;
        caretRef.current = 0;
        didAutoFocusRef.current = true;
        scheduleHighlight();
        schedulePreviewHighlight();
      }
    }
  }, [autoFocus, scheduleHighlight, schedulePreviewHighlight]);

  useEffect(() => {
    const cleanup = attachObservers();
    ensurePreviewReadyAndSync(120);
    return () => {
      cleanup?.();
    };
  }, [attachObservers, ensurePreviewReadyAndSync]);

  useEffect(() => {
    scheduleSync();
    schedulePreviewHighlight();
  }, [content, scheduleSync, schedulePreviewHighlight]);

  useEffect(() => {
    scheduleSync();
    schedulePreviewHighlight();
  }, [mode, maxLen, maxHeight, useFeatured, scheduleSync, schedulePreviewHighlight]);

  useEffect(() => {
    const timers = ensureTimersRef.current;
    const raf = rafRef.current;
    const mo = moRef.current;
    const roWrap = roWrapRef.current;
    const roBody = roBodyRef.current;
    return () => {
      if (raf != null) cancelAnimationFrame(raf);
      mo?.disconnect();
      roWrap?.disconnect();
      roBody?.disconnect();
      timers.forEach((id) => clearTimeout(id));
      timers.length = 0;
      if (highlightRafRef.current != null) cancelAnimationFrame(highlightRafRef.current);
      if (previewHighlightRafRef.current != null)
        cancelAnimationFrame(previewHighlightRafRef.current);
      caretMirrorRef.current?.remove();
      caretMirrorRef.current = null;
    };
  }, []);

  useEffect(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    const onScroll = () => {
      scheduleHighlight();
      schedulePreviewHighlight();
    };
    const onFocus = () => {
      scheduleHighlight();
      schedulePreviewHighlight();
    };
    ta.addEventListener("scroll", onScroll);
    ta.addEventListener("focus", onFocus);
    return () => {
      ta.removeEventListener("scroll", onScroll);
      ta.removeEventListener("focus", onFocus);
    };
  }, [scheduleHighlight, schedulePreviewHighlight]);

  const onToolbarPrefix = useCallback(
    (prefix: string) => (e: React.MouseEvent) => {
      e.preventDefault();
      const ta = activeTextarea();
      if (!ta) return;
      applyPrefixToggleFromTextarea(ta, setBody, prefix);
      requestAnimationFrame(() => {
        const pos = ta.selectionEnd ?? ta.selectionStart ?? caretRef.current;
        caretRef.current = pos;
        scheduleSync();
        scheduleHighlight();
        schedulePreviewHighlight();
      });
    },
    [activeTextarea, scheduleSync, scheduleHighlight, schedulePreviewHighlight],
  );

  const onToolbarFence = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      const ta = activeTextarea();
      if (!ta) return;
      applyCodeFenceToggleFromTextarea(ta, setBody);
      requestAnimationFrame(() => {
        const pos = ta.selectionEnd ?? ta.selectionStart ?? caretRef.current;
        caretRef.current = pos;
        scheduleSync();
        scheduleHighlight();
        schedulePreviewHighlight();
      });
    },
    [activeTextarea, scheduleSync, scheduleHighlight, schedulePreviewHighlight],
  );

  const onToolbarInline = useCallback(
    (open: string, close?: string) => (e: React.MouseEvent) => {
      e.preventDefault();
      const ta = activeTextarea();
      if (!ta) return;
      applyInlineToggleFromTextarea(ta, setBody, open, close ?? open);
      requestAnimationFrame(() => {
        const pos = ta.selectionEnd ?? ta.selectionStart ?? caretRef.current;
        caretRef.current = pos;
        scheduleSync();
        scheduleHighlight();
        schedulePreviewHighlight();
      });
    },
    [activeTextarea, scheduleSync, scheduleHighlight, schedulePreviewHighlight],
  );

  const onToolbarRuby = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      const ta = activeTextarea();
      if (!ta) return;
      applyRubyToggleFromTextarea(ta, setBody);
      requestAnimationFrame(() => {
        const pos = ta.selectionEnd ?? ta.selectionStart ?? caretRef.current;
        caretRef.current = pos;
        scheduleSync();
        scheduleHighlight();
        schedulePreviewHighlight();
      });
    },
    [activeTextarea, scheduleSync, scheduleHighlight, schedulePreviewHighlight],
  );

  const onToolbarLink = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      const ta = activeTextarea();
      if (!ta) return;
      applyLinkToggleFromTextarea(ta, setBody);
      requestAnimationFrame(() => {
        const pos = ta.selectionEnd ?? ta.selectionStart ?? caretRef.current;
        caretRef.current = pos;
        scheduleSync();
        scheduleHighlight();
        schedulePreviewHighlight();
      });
    },
    [activeTextarea, scheduleSync, scheduleHighlight, schedulePreviewHighlight],
  );

  return (
    <div className={"relative " + className}>
      <div className="flex flex-col h-screen w-full overflow-hidden">
        <div className="shrink-0 border-b bg-gray-100 backdrop-blur px-3 py-2 flex flex-wrap gap-3 items-end">
          <div className="flex items-center gap-2">
            <label className="text-sm">Preview</label>
            <select
              className="border px-2 py-1 rounded text-sm"
              value={mode}
              onChange={(e) => setMode(e.target.value as Mode)}
            >
              <option value="html">HTML</option>
              <option value="text">Text</option>
            </select>
          </div>
          <div className="flex items-center gap-2">
            <label className="text-sm">maxLen</label>
            <input
              type="number"
              min={1}
              placeholder="unlimited"
              className="border px-2 py-1 rounded w-28 text-sm"
              value={maxLen ?? ""}
              onChange={(e) => {
                const val = Number(e.target.value);
                setMaxLen(e.target.value ? Math.max(1, val) : undefined);
              }}
            />
          </div>
          <div className="flex items-center gap-2">
            <label className="text-sm">maxHeight</label>
            <input
              type="number"
              min={1}
              placeholder="unlimited"
              className="border px-2 py-1 rounded w-28 text-sm"
              value={maxHeight ?? ""}
              onChange={(e) => {
                const val = Number(e.target.value);
                setMaxHeight(e.target.value ? Math.max(1, val) : undefined);
              }}
            />
          </div>
          <label className="inline-flex items-center gap-2 select-none cursor-pointer">
            <input
              type="checkbox"
              checked={useFeatured}
              onChange={(e) => setUseFeatured(e.target.checked)}
              disabled={mode !== "html"}
            />
            <span className="text-sm">useFeatured</span>
          </label>
          <div className="ml-auto text-xs text-gray-500">
            {contentLengthLimit != null
              ? `${contentLength} / ${contentLengthLimit}`
              : `${contentLength} chars`}
            {overLimit && <span className="text-yellow-700 ml-2">(too long)</span>}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-0 flex-1 min-h-0">
          <div className="relative border-r min-h-0 flex flex-col">
            <div className="sticky top-0 z-10 bg-white/80 backdrop-blur-sm border-b border-gray-200 w-full">
              <div className="px-1.5 py-1 flex items-center gap-1 bg-[#eee]">
                <button
                  type="button"
                  onMouseDown={onToolbarPrefix("# ")}
                  className="inline-flex h-7 w-8 items-center justify-center rounded border border-gray-300 bg-gray-50 hover:bg-gray-100 text-gray-700"
                  title="Heading 1"
                >
                  <Heading1 className="w-4 h-4" />
                </button>
                <button
                  type="button"
                  onMouseDown={onToolbarPrefix("## ")}
                  className="inline-flex h-7 w-8 items-center justify-center rounded border border-gray-300 bg-gray-50 hover:bg-gray-100 text-gray-700"
                  title="Heading 2"
                >
                  <Heading2 className="w-4 h-4" />
                </button>
                <button
                  type="button"
                  onMouseDown={onToolbarPrefix("### ")}
                  className="inline-flex h-7 w-8 items-center justify-center rounded border border-gray-300 bg-gray-50 hover:bg-gray-100 text-gray-700"
                  title="Heading 3"
                >
                  <Heading3 className="w-4 h-4" />
                </button>
                <button
                  type="button"
                  onMouseDown={onToolbarPrefix("- ")}
                  className="hidden md:inline-flex h-7 w-8 items-center justify-center rounded border border-gray-300 bg-gray-50 hover:bg-gray-100 text-gray-700"
                  title="List"
                >
                  <ListIcon className="w-4 h-4" />
                </button>
                <button
                  type="button"
                  onMouseDown={onToolbarPrefix("> ")}
                  className="hidden md:inline-flex h-7 w-8 items-center justify-center rounded border border-gray-300 bg-gray-50 hover:bg-gray-100 text-gray-700"
                  title="Quote"
                >
                  <QuoteIcon className="w-4 h-4" />
                </button>
                <button
                  type="button"
                  onMouseDown={onToolbarFence}
                  className="hidden md:inline-flex h-7 w-8 items-center justify-center rounded border border-gray-300 bg-gray-50 hover:bg-gray-100 text-gray-700"
                  title="Code block"
                >
                  <CodeBlockIcon className="w-4 h-4" />
                </button>
                <button
                  type="button"
                  onMouseDown={onToolbarInline("**")}
                  className="inline-flex h-7 w-8 items-center justify-center rounded border border-gray-300 bg-gray-50 hover:bg-gray-100 text-gray-700"
                  title="Bold"
                >
                  <BoldIcon className="w-4 h-4" />
                </button>
                <button
                  type="button"
                  onMouseDown={onToolbarInline("::")}
                  className="hidden md:inline-flex h-7 w-8 items-center justify-center rounded border border-gray-300 bg-gray-50 hover:bg-gray-100 text-gray-700"
                  title="Italic"
                >
                  <ItalicIcon className="w-4 h-4" />
                </button>
                <button
                  type="button"
                  onMouseDown={onToolbarInline("__")}
                  className="hidden md:inline-flex h-7 w-8 items-center justify-center rounded border border-gray-300 bg-gray-50 hover:bg-gray-100 text-gray-700"
                  title="Underline"
                >
                  <UnderlineIcon className="w-4 h-4" />
                </button>
                <button
                  type="button"
                  onMouseDown={onToolbarInline("~~")}
                  className="hidden md:inline-flex h-7 w-8 items-center justify-center rounded border border-gray-300 bg-gray-50 hover:bg-gray-100 text-gray-700"
                  title="Strikethrough"
                >
                  <StrikethroughIcon className="w-4 h-4" />
                </button>
                <button
                  type="button"
                  onMouseDown={onToolbarInline("``")}
                  className="hidden md:inline-flex h-7 w-8 items-center justify-center rounded border border-gray-300 bg-gray-50 hover:bg-gray-100 text-gray-700"
                  title="Inline code"
                >
                  <InlineCodeIcon className="w-4 h-4" />
                </button>
                <button
                  type="button"
                  onMouseDown={onToolbarInline("%%")}
                  className="hidden md:inline-flex h-7 w-8 items-center justify-center rounded border border-gray-300 bg-gray-50 hover:bg-gray-100 text-gray-700"
                  title="Mark"
                >
                  <MarkIcon className="w-4 h-4" />
                </button>
                <button
                  type="button"
                  onMouseDown={onToolbarRuby}
                  className="hidden md:inline-flex h-7 w-8 items-center justify-center rounded border border-gray-300 bg-gray-50 hover:bg-gray-100 text-gray-700"
                  title="Ruby"
                >
                  <RubyIcon className="w-4 h-4" />
                </button>
                <button
                  type="button"
                  onMouseDown={onToolbarLink}
                  className="inline-flex h-7 w-8 items-center justify-center rounded border border-gray-300 bg-gray-50 hover:bg-gray-100 text-gray-700"
                  title="Link"
                >
                  <LinkIcon className="w-4 h-4" />
                </button>
              </div>
            </div>

            <div ref={leftScrollRef} className="flex-1 overflow-y-auto h-full bg-[#f8f8ff]">
              <div ref={leftInnerRef} className="mx-auto max-w-[85ex] w-full p-6">
                <div className="relative">
                  <textarea
                    ref={textareaRef}
                    className="relative z-10 w-full border border-gray-400 rounded px-2 py-1 bg-transparent break-all"
                    placeholder={placeholder}
                    value={body}
                    onChange={(e) => {
                      setBody(e.currentTarget.value);
                      const pos =
                        e.currentTarget.selectionEnd ?? e.currentTarget.selectionStart ?? 0;
                      caretRef.current = pos;
                      scheduleSync();
                      scheduleHighlight();
                      schedulePreviewHighlight();
                    }}
                    onKeyUp={() => {
                      const ta = textareaRef.current;
                      if (ta) {
                        const pos = ta.selectionEnd ?? ta.selectionStart ?? caretRef.current;
                        caretRef.current = pos;
                      }
                      scheduleSync();
                      scheduleHighlight();
                      schedulePreviewHighlight();
                    }}
                    onClick={() => {
                      const ta = textareaRef.current;
                      if (ta) {
                        const pos = ta.selectionEnd ?? ta.selectionStart ?? caretRef.current;
                        caretRef.current = pos;
                      }
                      scheduleSync();
                      scheduleHighlight();
                      schedulePreviewHighlight();
                    }}
                    onSelect={() => {
                      const ta = textareaRef.current;
                      if (ta) {
                        const pos = ta.selectionEnd ?? ta.selectionStart ?? caretRef.current;
                        caretRef.current = pos;
                      }
                      scheduleSync();
                      scheduleHighlight();
                      schedulePreviewHighlight();
                    }}
                    onFocus={() => {
                      scheduleHighlight();
                      schedulePreviewHighlight();
                    }}
                    maxLength={65535}
                    rows={1}
                    style={{ resize: "none" }}
                    autoFocus={autoFocus}
                  />
                  <div ref={highlightOverlayRef} aria-hidden>
                    <div ref={highlightBandRef} />
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div className="relative bg-white min-h-0 flex flex-col">
            <div className="relative flex-1 overflow-y-auto" ref={previewWrapRef}>
              <div ref={previewHighlightOverlayRef} aria-hidden>
                <div ref={previewHighlightBandRef} />
              </div>
              <div
                className="mx-auto max-w-[85ex] w-full p-6"
                style={{ position: "relative", zIndex: 1 }}
              >
                <div className="font-bold text-gray-400 text-xs mb-2">Preview</div>
                {mode === "html" ? (
                  <div
                    ref={previewBodyRef as React.MutableRefObject<HTMLDivElement | null>}
                    className="markdown-body"
                    dangerouslySetInnerHTML={{ __html: renderHtml(content) }}
                    style={{ minHeight: 32 }}
                  />
                ) : (
                  <pre
                    ref={previewBodyRef as React.MutableRefObject<HTMLPreElement | null>}
                    className="w-full whitespace-pre-wrap break-words text-sm border rounded px-2 py-2"
                    style={{ background: "#fff", minHeight: 32 }}
                  >
                    {renderText(content)}
                  </pre>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
