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

export default function MarkdownSnippetSandbox({
  initialBody = `# ヘッダ

## サブヘッダ

### サブサブヘッダ

地の文。地の文。
地の文の中の改行は<br>扱いで、マージンなしで改行。

段落は空白で区切る。一つの段落は<p>で囲む。

> ブロッククォートも*ある*。
> こんな__感じ__で**ね**。

- リスト1
  - サブリストA
    - サブ**サブ**。{{竜破斬|ドラグ・スレイブ}}と{{三日月型砂丘|バルハン}}
- リスト2。
- リスト3

Go to [Google](https://google.com/).
Set: http://example.com/

### Go to [Google](https://google.com/) and **Yahoo**
### Set: http://example.com/ and __Yapoo__

- Go to [Google](https://google.com/) and **Yahoo**
  - Set: http://example.com/ and __Yapoo__

- We __live__ *in* **Tokyo** [Shinjuku](https://ja.wikipedia.org/wiki/%E6%96%B0%E5%AE%BF)

|We|__live__|in|**Tokyo**|[Shinjuku](https://ja.wikipedia.org/wiki/%E6%96%B0%E5%AE%BF)|
|one|**two**|three|four|five|

![これはロゴです](/data/logo-square.svg){size=small}

\`\`\`sql
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

  const anchorsRef = useRef<{ char: number; el: HTMLElement }[]>([]);
  const rafRef = useRef<number | null>(null);
  const caretRef = useRef<number>(0);

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
      return mdRenderHtml(nodes);
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

  const scheduleSync = useCallback(() => {
    if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null;
      rebuildAnchors();
      syncToCaret();
    });
  }, [rebuildAnchors, syncToCaret]);

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
      const onImg = () => scheduleSync();
      const mo = new MutationObserver(() => {
        scheduleSync();
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
      });
      ro.observe(wrap);
      roWrapRef.current = ro;
    }
    if (bodyEl) {
      const ro2 = new ResizeObserver(() => {
        scheduleSync();
      });
      ro2.observe(bodyEl);
      roBodyRef.current = ro2;
    }
  }, [activePreviewWrap, activePreviewBody, scheduleSync]);

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
      };
      requestAnimationFrame(tick);
      const t1 = window.setTimeout(() => scheduleSync(), 80);
      const t2 = window.setTimeout(() => scheduleSync(), 160);
      const t3 = window.setTimeout(() => scheduleSync(), 320);
      ensureTimersRef.current.push(t1, t2, t3);
      const d = document as Document & { fonts?: { ready?: Promise<unknown> } };
      const f = d.fonts;
      if (f && typeof f.ready?.then === "function") {
        f.ready.then(() => {
          scheduleSync();
        });
      }
    },
    [activePreviewWrap, activePreviewBody, rebuildAnchors, scheduleSync],
  );

  useLayoutEffect(() => {
    resizeTextarea();
    const onResize = () => resizeTextarea();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [resizeTextarea]);

  useEffect(() => {
    if (autoFocus && !didAutoFocusRef.current) {
      const ta = textareaRef.current;
      if (ta) {
        ta.focus();
        ta.setSelectionRange(0, 0);
        ta.scrollTop = 0;
        caretRef.current = 0;
        didAutoFocusRef.current = true;
      }
    }
  }, [autoFocus]);

  useEffect(() => {
    attachObservers();
    ensurePreviewReadyAndSync(120);
  }, [attachObservers, ensurePreviewReadyAndSync]);

  useEffect(() => {
    scheduleSync();
  }, [content, scheduleSync]);

  useEffect(() => {
    scheduleSync();
  }, [mode, maxLen, maxHeight, useFeatured, scheduleSync]);

  // cleanup: capture current ref values so cleanup doesn't read .current directly
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
    };
  }, []);

  const onToolbarPrefix = useCallback(
    (prefix: string) => (e: React.MouseEvent) => {
      e.preventDefault();
      const ta = activeTextarea();
      if (!ta) return;
      applyPrefixToggleFromTextarea(ta, setBody, prefix);
      requestAnimationFrame(() => {
        const pos = ta.selectionEnd ?? ta.selectionStart ?? caretRef.current;
        caretRef.current = pos;
        centerTextareaCaret(ta);
        scheduleSync();
      });
    },
    [activeTextarea, scheduleSync],
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
        centerTextareaCaret(ta);
        scheduleSync();
      });
    },
    [activeTextarea, scheduleSync],
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
        centerTextareaCaret(ta);
        scheduleSync();
      });
    },
    [activeTextarea, scheduleSync],
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
        centerTextareaCaret(ta);
        scheduleSync();
      });
    },
    [activeTextarea, scheduleSync],
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
        centerTextareaCaret(ta);
        scheduleSync();
      });
    },
    [activeTextarea, scheduleSync],
  );

  return (
    <div className={"relative " + className}>
      <div className="flex flex-col h-screen w-full overflow-hidden">
        <div className="shrink-0 border-b bg-white/90 backdrop-blur px-3 py-2 flex flex-wrap gap-3 items-end">
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
          <div className="relative bg-gray-50/70 border-r min-h-0 flex flex-col">
            <div className="sticky top-0 z-10 bg-white/80 backdrop-blur-sm border-b border-gray-200 w-full">
              <div className="px-1.5 py-1 flex items-center gap-1 bg-[#ddd]">
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

            <div ref={leftScrollRef} className="flex-1 overflow-y-auto h-full bg-[#eee]">
              <div ref={leftInnerRef} className="mx-auto max-w-[85ex] w-full p-6">
                <textarea
                  ref={textareaRef}
                  className="w-full border border-gray-400 rounded px-2 py-1 bg-gray-50 break-all"
                  placeholder={placeholder}
                  value={body}
                  onChange={(e) => {
                    setBody(e.target.value);
                    const pos = e.currentTarget.selectionEnd ?? e.currentTarget.selectionStart ?? 0;
                    caretRef.current = pos;
                    scheduleSync();
                  }}
                  onKeyUp={() => {
                    const ta = textareaRef.current;
                    if (ta) {
                      const pos = ta.selectionEnd ?? ta.selectionStart ?? caretRef.current;
                      caretRef.current = pos;
                      centerTextareaCaret(ta);
                    }
                    scheduleSync();
                  }}
                  onClick={() => {
                    const ta = textareaRef.current;
                    if (ta) {
                      const pos = ta.selectionEnd ?? ta.selectionStart ?? caretRef.current;
                      caretRef.current = pos;
                      centerTextareaCaret(ta);
                    }
                    scheduleSync();
                  }}
                  onSelect={() => {
                    const ta = textareaRef.current;
                    if (ta) {
                      const pos = ta.selectionEnd ?? ta.selectionStart ?? caretRef.current;
                      caretRef.current = pos;
                      centerTextareaCaret(ta);
                    }
                    scheduleSync();
                  }}
                  maxLength={65535}
                  rows={1}
                  style={{ resize: "none" }}
                  autoFocus={autoFocus}
                />
              </div>
            </div>
          </div>

          <div className="relative bg-white min-h-0 flex flex-col">
            <div className="flex-1 overflow-y-auto" ref={previewWrapRef}>
              <div className="mx-auto max-w-[85ex] w-full p-6">
                <div className="font-bold text-gray-500 text-xs mb-2">Preview</div>
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
