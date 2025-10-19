"use client";

import React, {
  useRef,
  useState,
  useEffect,
  useMemo,
  useLayoutEffect,
  useCallback,
  useId,
} from "react";
import { makeArticleHtmlFromMarkdown } from "@/utils/article";
import { parseBodyAndTags } from "@/utils/parse";
import { convertHtmlMathInline } from "@/utils/mathjax-inline";
import UserMentionButton from "@/components/UserMentionButton";
import ExistingImageEmbedButton from "@/components/ExistingImageEmbedButton";
import UploadImageEmbedButton from "@/components/UploadImageEmbedButton";
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
  X as CloseIcon,
} from "lucide-react";

type PostFormProps = {
  body: string;
  setBody: (body: string) => void;
  onSubmit: (e: React.FormEvent) => void;
  submitting: boolean;
  error?: string | null;
  onErrorClear?: () => void;
  onCancel?: () => void;
  buttonLabel?: string;
  placeholder?: string;
  className?: string;
  isEdit?: boolean;
  deletable?: boolean;
  onDelete?: () => void;
  contentLengthLimit?: number;
  autoFocus?: boolean;
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

function afterNextPaint(cb: () => void) {
  requestAnimationFrame(() => requestAnimationFrame(cb));
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

function buildMirrorFromTextarea(ta: HTMLTextAreaElement, mirror: HTMLDivElement) {
  const cs = getComputedStyle(ta);
  const pl = parseFloat(cs.paddingLeft || "0");
  const pr = parseFloat(cs.paddingRight || "0");
  const contentWidth = Math.max(0, ta.clientWidth - pl - pr);
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
  assign("boxSizing", "content-box");
  assign("width", `${contentWidth}px`);
  assign("paddingTop", "0");
  assign("paddingRight", "0");
  assign("paddingBottom", "0");
  assign("paddingLeft", "0");
  assign("borderLeftWidth", "0");
  assign("borderRightWidth", "0");
  assign("borderTopWidth", "0");
  assign("borderBottomWidth", "0");
  assign("fontFamily", cs.fontFamily || "inherit");
  assign("fontSize", cs.fontSize || "inherit");
  assign("fontWeight", cs.fontWeight || "normal");
  assign("fontStyle", cs.fontStyle || "normal");
  assign("lineHeight", cs.lineHeight || "normal");
  assign("letterSpacing", cs.letterSpacing || "normal");
  const tabSize = cs.getPropertyValue("tab-size") || "4";
  mirror.style.setProperty("tab-size", tabSize);
}

export default function PostForm({
  body,
  setBody,
  onSubmit,
  submitting,
  error,
  onErrorClear,
  onCancel,
  buttonLabel = "Post",
  placeholder = "Write your post in Markdown format. Use #tag lines at the bottom for tags.",
  className = "",
  isEdit = false,
  deletable = false,
  onDelete,
  contentLengthLimit,
  autoFocus = false,
}: PostFormProps) {
  const formRef = useRef<HTMLFormElement>(null);

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const previewWrapRef = useRef<HTMLDivElement>(null);
  const previewBodyRef = useRef<HTMLDivElement>(null);

  const overlayTextareaRef = useRef<HTMLTextAreaElement>(null);
  const overlayEditorColRef = useRef<HTMLDivElement>(null);
  const overlayToolbarRef = useRef<HTMLDivElement>(null);
  const overlayFooterRef = useRef<HTMLDivElement>(null);
  const overlayScrollRef = useRef<HTMLDivElement>(null);
  const overlayEditorInnerRef = useRef<HTMLDivElement>(null);
  const overlayWrapRef = useRef<HTMLDivElement>(null);
  const overlayBodyRef = useRef<HTMLDivElement>(null);

  const gutterRef = useRef<HTMLDivElement | null>(null);

  const caretMirrorRef = useRef<HTMLDivElement | null>(null);
  const editorHighlightOverlayRef = useRef<HTMLDivElement | null>(null);
  const editorHighlightBandRef = useRef<HTMLDivElement | null>(null);

  const previewHighlightOverlayRef = useRef<HTMLDivElement | null>(null);
  const previewHighlightBandRef = useRef<HTMLDivElement | null>(null);

  const anchorsRef = useRef<{ char: number; el: HTMLElement }[]>([]);
  const rafRef = useRef<number | null>(null);
  const editorHighlightRafRef = useRef<number | null>(null);
  const previewHighlightRafRef = useRef<number | null>(null);
  const caretRef = useRef<number>(0);
  const selStartRef = useRef<number>(0);
  const selEndRef = useRef<number>(0);

  const didApplyAutoFocusRef = useRef(false);
  const prevIsEditRef = useRef<boolean>(isEdit);
  const prevOverlayActiveRef = useRef<boolean>(false);
  const genRef = useRef(0);
  const previewMutObsRef = useRef<MutationObserver | null>(null);
  const previewResizeWrapRef = useRef<ResizeObserver | null>(null);
  const previewResizeBodyRef = useRef<ResizeObserver | null>(null);
  const ensureTimersRef = useRef<number[]>([]);

  const [showPreview, setShowPreview] = useState(false);
  const [hasFocusedOnce, setHasFocusedOnce] = useState(false);
  const [isXl, setIsXl] = useState(false);
  const overlayActive = showPreview && isXl;

  const formId = useId();

  useEffect(() => {
    const mq = window.matchMedia("(min-width: 1000px)");
    const onChange = () => {
      const taPrev = overlayActive ? overlayTextareaRef.current : textareaRef.current;
      const s = taPrev ? (taPrev.selectionStart ?? caretRef.current) : caretRef.current;
      const e = taPrev ? (taPrev.selectionEnd ?? s) : s;
      selStartRef.current = s;
      selEndRef.current = e;
      caretRef.current = e;
      setIsXl(mq.matches);
    };
    onChange();
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [overlayActive]);

  useEffect(() => {
    if (!overlayActive) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [overlayActive]);

  useEffect(() => {
    const becameEdit = isEdit && !prevIsEditRef.current;
    if (becameEdit) {
      const ta = overlayActive ? overlayTextareaRef.current : textareaRef.current;
      if (ta) {
        ta.focus();
        ta.setSelectionRange(0, 0);
        ta.scrollTop = 0;
        caretRef.current = 0;
        selStartRef.current = 0;
        selEndRef.current = 0;
      }
    }
    prevIsEditRef.current = isEdit;
  }, [isEdit, overlayActive]);

  useEffect(() => {
    if (autoFocus && !didApplyAutoFocusRef.current) {
      const ta = overlayActive ? overlayTextareaRef.current : textareaRef.current;
      if (ta) {
        ta.focus();
        ta.setSelectionRange(0, 0);
        ta.scrollTop = 0;
        caretRef.current = 0;
        selStartRef.current = 0;
        selEndRef.current = 0;
        didApplyAutoFocusRef.current = true;
      }
    }
  }, [autoFocus, overlayActive]);

  const { content, tags, attrs } = useMemo(() => parseBodyAndTags(body), [body]);
  const contentLength = content.length;
  const overLimit = contentLengthLimit != null ? contentLength > contentLengthLimit : false;

  const previewHtml = useMemo(() => {
    const html = convertHtmlMathInline(makeArticleHtmlFromMarkdown(content, true));
    return (
      html +
      `<span data-char-position="${content.length}" data-no-pin="1" aria-hidden="true" style="display:block;height:1px;"></span>`
    );
  }, [content]);

  const attrLabels = useMemo(() => {
    return Object.entries(attrs || {})
      .map(([k, v]) =>
        typeof v === "boolean"
          ? v
            ? `${k.toLowerCase()}`
            : undefined
          : `${k.toLowerCase()}=${String(v)}`,
      )
      .filter(Boolean) as string[];
  }, [attrs]);

  const activeTextarea = useCallback((): HTMLTextAreaElement | null => {
    return overlayActive ? overlayTextareaRef.current : textareaRef.current;
  }, [overlayActive]);
  const activePreviewWrap = useCallback((): HTMLDivElement | null => {
    return overlayActive ? overlayWrapRef.current : previewWrapRef.current;
  }, [overlayActive]);
  const activePreviewBody = useCallback((): HTMLDivElement | null => {
    return overlayActive ? overlayBodyRef.current : previewBodyRef.current;
  }, [overlayActive]);

  const handleFocus = useCallback(() => {
    if (!hasFocusedOnce) setHasFocusedOnce(true);
    const textarea = activeTextarea();
    if (!textarea) return;
    const lineHeight = parseFloat(getComputedStyle(textarea).lineHeight || "20");
    const minHeight = lineHeight * 10;
    if (!overlayActive && textarea.offsetHeight < minHeight) {
      textarea.style.height = `${minHeight}px`;
    }
    if (onErrorClear) onErrorClear();
    const s = textarea.selectionStart ?? 0;
    const e = textarea.selectionEnd ?? s;
    selStartRef.current = s;
    selEndRef.current = e;
    caretRef.current = e;
    scheduleSyncRef.current();
    if (overlayActive) {
      scheduleEditorHighlightRef.current();
      schedulePreviewHighlightRef.current();
    }
    if (overlayActive) resizeOverlayTextareaRef.current();
  }, [activeTextarea, hasFocusedOnce, onErrorClear, overlayActive]);

  const actPrefix = (prefix: string) => (e: React.MouseEvent) => {
    e.preventDefault();
    const ta = activeTextarea();
    if (!ta) return;
    applyPrefixToggleFromTextarea(ta, setBody, prefix);
    afterNextPaint(() => {
      const s = ta.selectionStart ?? caretRef.current;
      const ed = ta.selectionEnd ?? s;
      selStartRef.current = s;
      selEndRef.current = ed;
      caretRef.current = ed;
      scheduleSyncRef.current();
      if (overlayActive) {
        scheduleEditorHighlightRef.current();
        schedulePreviewHighlightRef.current();
      }
      if (overlayActive) resizeOverlayTextareaRef.current();
    });
  };
  const actFence = (e: React.MouseEvent) => {
    e.preventDefault();
    const ta = activeTextarea();
    if (!ta) return;
    applyCodeFenceToggleFromTextarea(ta, setBody);
    afterNextPaint(() => {
      const s = ta.selectionStart ?? caretRef.current;
      const ed = ta.selectionEnd ?? s;
      selStartRef.current = s;
      selEndRef.current = ed;
      caretRef.current = ed;
      scheduleSyncRef.current();
      if (overlayActive) {
        scheduleEditorHighlightRef.current();
        schedulePreviewHighlightRef.current();
      }
      if (overlayActive) resizeOverlayTextareaRef.current();
    });
  };
  const actInline = (open: string, close?: string) => (e: React.MouseEvent) => {
    e.preventDefault();
    const ta = activeTextarea();
    if (!ta) return;
    applyInlineToggleFromTextarea(ta, setBody, open, close ?? open);
    afterNextPaint(() => {
      const s = ta.selectionStart ?? caretRef.current;
      const ed = ta.selectionEnd ?? s;
      selStartRef.current = s;
      selEndRef.current = ed;
      caretRef.current = ed;
      scheduleSyncRef.current();
      if (overlayActive) {
        scheduleEditorHighlightRef.current();
        schedulePreviewHighlightRef.current();
      }
      if (overlayActive) resizeOverlayTextareaRef.current();
    });
  };
  const actRuby = (e: React.MouseEvent) => {
    e.preventDefault();
    const ta = activeTextarea();
    if (!ta) return;
    applyRubyToggleFromTextarea(ta, setBody);
    afterNextPaint(() => {
      const s = ta.selectionStart ?? caretRef.current;
      const ed = ta.selectionEnd ?? s;
      selStartRef.current = s;
      selEndRef.current = ed;
      caretRef.current = ed;
      scheduleSyncRef.current();
      if (overlayActive) {
        scheduleEditorHighlightRef.current();
        schedulePreviewHighlightRef.current();
      }
      if (overlayActive) resizeOverlayTextareaRef.current();
    });
  };
  const actLink = (e: React.MouseEvent) => {
    e.preventDefault();
    const ta = activeTextarea();
    if (!ta) return;
    applyLinkToggleFromTextarea(ta, setBody);
    afterNextPaint(() => {
      const s = ta.selectionStart ?? caretRef.current;
      const ed = ta.selectionEnd ?? s;
      selStartRef.current = s;
      selEndRef.current = ed;
      caretRef.current = ed;
      scheduleSyncRef.current();
      if (overlayActive) {
        scheduleEditorHighlightRef.current();
        schedulePreviewHighlightRef.current();
      }
      if (overlayActive) resizeOverlayTextareaRef.current();
    });
  };

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

  const findAnchorIndex = useCallback((caret: number): number | null => {
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
    return ans;
  }, []);
  const findAnchor = useCallback(
    (caret: number): HTMLElement | null => {
      const idx = findAnchorIndex(caret);
      if (idx == null) return null;
      return anchorsRef.current[idx]!.el;
    },
    [findAnchorIndex],
  );

  const syncToCaret = useCallback((): boolean => {
    if (!showPreview) return false;
    const wrap = activePreviewWrap();
    const caret = Math.min(Math.max(0, caretRef.current), content.length);
    if (!wrap) return false;
    const before = wrap.scrollTop;

    const target = findAnchor(caret);
    if (target) {
      const wrapRect = wrap.getBoundingClientRect();
      const elRect = target.getBoundingClientRect();
      const yWithin = wrap.scrollTop + (elRect.top - wrapRect.top);
      const desired = Math.max(0, yWithin - (wrap.clientHeight - target.offsetHeight) / 2);
      wrap.scrollTop = desired;
      return Math.abs(desired - before) > 0.5;
    }
    const desired = ((wrap.scrollHeight - wrap.clientHeight) * caret) / Math.max(1, content.length);
    const clamped = Math.max(0, Math.min(wrap.scrollHeight - wrap.clientHeight, desired));
    wrap.scrollTop = clamped;
    return Math.abs(clamped - before) > 0.5;
  }, [showPreview, activePreviewWrap, content.length, findAnchor]);

  const updatePreviewHighlight = useCallback(() => {
    if (!overlayActive) return;
    if (!showPreview) {
      const band = previewHighlightBandRef.current;
      if (band) band.style.display = "none";
      return;
    }
    const wrap = activePreviewWrap();
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
    const caret = Math.min(Math.max(0, caretRef.current), content.length);
    const idx = findAnchorIndex(caret);
    if (idx == null) {
      band.style.display = "none";
      return;
    }
    const target = anchorsRef.current[idx]!.el;
    const wrapRect = wrap.getBoundingClientRect();
    const getRect = (el: HTMLElement) => {
      const rects = el.getClientRects();
      return rects.length ? rects[0]! : el.getBoundingClientRect();
    };
    let r = getRect(target);
    if (r.height < 4 || r.width === 0) {
      const prevIdx = Math.max(0, idx - 1);
      if (prevIdx !== idx) {
        const prevEl = anchorsRef.current[prevIdx]!.el;
        const pr = getRect(prevEl);
        if (pr.height >= 4 && pr.width > 0) r = pr;
      }
    }
    const EXPAND = 4;
    const topWithin = Math.round(wrap.scrollTop + (r.top - wrapRect.top)) - EXPAND;
    const leftWithin = Math.round(r.left - wrapRect.left) - EXPAND;
    const width = Math.max(1, Math.round(r.width) + EXPAND * 2);
    const height = Math.max(4, Math.round(r.height) + EXPAND * 2);
    band.style.display = "block";
    band.style.position = "absolute";
    band.style.background = "#eef8ff";
    band.style.top = `${topWithin}px`;
    band.style.left = `${leftWithin}px`;
    band.style.height = `${height}px`;
    band.style.width = `${width}px`;
    band.style.borderRadius = "4px";
  }, [overlayActive, showPreview, activePreviewWrap, content.length, findAnchorIndex]);

  const schedulePreviewHighlight = useCallback(() => {
    if (!overlayActive) return;
    if (previewHighlightRafRef.current != null)
      cancelAnimationFrame(previewHighlightRafRef.current);
    previewHighlightRafRef.current = requestAnimationFrame(() => {
      previewHighlightRafRef.current = null;
      updatePreviewHighlight();
    });
  }, [overlayActive, updatePreviewHighlight]);

  const computeCaretTopWithinTextarea = useCallback((ta: HTMLTextAreaElement) => {
    let mirror = caretMirrorRef.current;
    if (!mirror) {
      mirror = document.createElement("div");
      caretMirrorRef.current = mirror;
    }
    buildMirrorFromTextarea(ta, mirror);
    const pos = Math.max(0, Math.min(ta.value.length, ta.selectionStart ?? 0));
    const before = ta.value.slice(0, pos);
    mirror.textContent = "";
    const textNode = document.createTextNode(before);
    const marker = document.createElement("span");
    marker.setAttribute("data-caret", "1");
    marker.style.display = "inline-block";
    marker.style.width = "1px";
    marker.style.height = "1em";
    mirror.appendChild(textNode);
    mirror.appendChild(marker);
    if (!mirror.isConnected) document.body.appendChild(mirror);
    const caretTopAbs = marker.getBoundingClientRect().top - mirror.getBoundingClientRect().top;
    const visibleTop = caretTopAbs - ta.scrollTop;
    const lh = resolveLineHeight(ta);
    const inView = visibleTop >= 0 && visibleTop <= ta.clientHeight - lh;
    return { topWithin: visibleTop, lineHeight: lh, inView };
  }, []);

  const updateEditorHighlight = useCallback(() => {
    if (!overlayActive) return;
    const ta = activeTextarea();
    const overlay = editorHighlightOverlayRef.current;
    const band = editorHighlightBandRef.current;
    if (!ta || !overlay || !band) return;

    overlay.style.position = "absolute";
    overlay.style.pointerEvents = "none";
    overlay.style.left = `${ta.offsetLeft}px`;
    overlay.style.top = `${ta.offsetTop}px`;
    overlay.style.width = `${ta.offsetWidth}px`;
    overlay.style.height = `${ta.offsetHeight}px`;
    overlay.style.zIndex = "0";
    overlay.style.background = "#ffffff";
    overlay.style.borderRadius = getComputedStyle(ta).borderRadius || "0px";

    const { topWithin, lineHeight, inView } = computeCaretTopWithinTextarea(ta);
    const cs = getComputedStyle(ta);
    const pl = parseFloat(cs.paddingLeft || "0");
    const pr = parseFloat(cs.paddingRight || "0");
    const bt = parseFloat(cs.borderTopWidth || "0");
    const bl = parseFloat(cs.borderLeftWidth || "0");

    if (!inView) {
      band.style.display = "none";
      return;
    }

    band.style.display = "block";
    band.style.position = "absolute";
    band.style.background = "#eef8ff";
    band.style.top = `${bt + topWithin + 2}px`;
    band.style.left = `${bl + pl}px`;
    band.style.height = `${Math.round(lineHeight)}px`;
    band.style.width = `${ta.clientWidth - pl - pr}px`;
    band.style.borderRadius = "4px";
  }, [overlayActive, activeTextarea, computeCaretTopWithinTextarea]);

  const scheduleEditorHighlight = useCallback(() => {
    if (!overlayActive) return;
    if (editorHighlightRafRef.current != null) cancelAnimationFrame(editorHighlightRafRef.current);
    editorHighlightRafRef.current = requestAnimationFrame(() => {
      editorHighlightRafRef.current = null;
      updateEditorHighlight();
    });
  }, [overlayActive, updateEditorHighlight]);

  const ensureGutter = useCallback(() => {
    if (!overlayActive) return null;
    const wrap = overlayWrapRef.current;
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
  }, [overlayActive]);

  const refreshGutterPins = useCallback(() => {
    if (!overlayActive || !showPreview) {
      gutterRef.current?.replaceChildren();
      return;
    }
    const wrap = overlayWrapRef.current;
    const bodyEl = overlayBodyRef.current;
    const ta = overlayTextareaRef.current;
    if (!wrap || !bodyEl || !ta) return;

    const gutter = ensureGutter();
    if (!gutter) return;

    gutter.replaceChildren();

    const wrapRect = wrap.getBoundingClientRect();
    const candidates = Array.from(
      bodyEl.querySelectorAll<HTMLElement>("[data-char-position]:not([data-no-pin])"),
    );

    for (const el of candidates) {
      const charAttr = el.getAttribute("data-char-position");
      const lineAttr = el.getAttribute("data-line-position");
      if (!charAttr || !lineAttr) continue;

      const rects = el.getClientRects();
      const r = rects.length ? rects[0] : el.getBoundingClientRect();
      const yAbsolute = Math.round(wrap.scrollTop + (r.top - wrapRect.top) + 16);
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
        transform: "translateY(-100%)",
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
        const did = syncToCaret();
        if (did) requestAnimationFrame(() => schedulePreviewHighlight());
        else schedulePreviewHighlight();
        scheduleEditorHighlight();
        refreshGutterPins();
      });

      gutter.appendChild(btn);
    }
  }, [
    overlayActive,
    showPreview,
    ensureGutter,
    rebuildAnchors,
    syncToCaret,
    schedulePreviewHighlight,
    scheduleEditorHighlight,
  ]);

  const scheduleSync = useCallback(() => {
    if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null;
      rebuildAnchors();
      const didScroll = syncToCaret();
      refreshGutterPins();
      if (didScroll) {
        requestAnimationFrame(() => {
          schedulePreviewHighlight();
          scheduleEditorHighlight();
        });
      } else {
        schedulePreviewHighlight();
        scheduleEditorHighlight();
      }
    });
  }, [
    rebuildAnchors,
    syncToCaret,
    refreshGutterPins,
    schedulePreviewHighlight,
    scheduleEditorHighlight,
  ]);

  const ensurePreviewReadyAndSync = useCallback(
    (maxTries = 160) => {
      const myGen = ++genRef.current;
      let tries = maxTries;
      const tick = () => {
        if (myGen !== genRef.current) return;
        if (!showPreview) return;
        const wrap = activePreviewWrap();
        const body = activePreviewBody();
        if (!wrap || !body) {
          if (--tries > 0) requestAnimationFrame(tick);
          return;
        }
        if (wrap.clientHeight === 0) {
          if (--tries > 0) requestAnimationFrame(tick);
          return;
        }
        rebuildAnchors();
        if (anchorsRef.current.length === 0 && body.clientHeight === 0) {
          if (--tries > 0) requestAnimationFrame(tick);
          return;
        }
        scheduleSync();
        schedulePreviewHighlight();
      };
      requestAnimationFrame(tick);
      const t1 = window.setTimeout(() => {
        if (myGen === genRef.current) {
          scheduleSync();
          schedulePreviewHighlight();
        }
      }, 80);
      const t2 = window.setTimeout(() => {
        if (myGen === genRef.current) {
          scheduleSync();
          schedulePreviewHighlight();
        }
      }, 160);
      const t3 = window.setTimeout(() => {
        if (myGen === genRef.current) {
          scheduleSync();
          schedulePreviewHighlight();
        }
      }, 320);
      ensureTimersRef.current.push(t1, t2, t3);
      const d = document as Document & { fonts?: { ready?: Promise<unknown> } };
      const f = d.fonts;
      if (f && typeof f.ready?.then === "function") {
        f.ready.then(() => {
          if (myGen === genRef.current) {
            scheduleSync();
            schedulePreviewHighlight();
          }
        });
      }
    },
    [
      showPreview,
      activePreviewWrap,
      activePreviewBody,
      rebuildAnchors,
      scheduleSync,
      schedulePreviewHighlight,
    ],
  );

  const attachPreviewObservers = useCallback(() => {
    const wrap = activePreviewWrap();
    const body = activePreviewBody();
    previewMutObsRef.current?.disconnect();
    previewResizeWrapRef.current?.disconnect();
    previewResizeBodyRef.current?.disconnect();

    if (body) {
      const mo = new MutationObserver((muts: MutationRecord[]) => {
        if (!showPreview) return;
        muts.forEach((m) => {
          m.addedNodes.forEach((n) => {
            if (n instanceof HTMLElement) {
              const imgs = n.querySelectorAll("img");
              imgs.forEach((img) => {
                const once = () => {
                  scheduleSync();
                  schedulePreviewHighlight();
                };
                img.addEventListener("load", once as EventListener, { once: true });
                img.addEventListener("error", once as EventListener, { once: true });
              });
            }
          });
        });
        scheduleSync();
        schedulePreviewHighlight();
      });
      mo.observe(body, { childList: true, subtree: true });
      body.querySelectorAll("img").forEach((img) => {
        const once = () => {
          scheduleSync();
          schedulePreviewHighlight();
        };
        img.addEventListener("load", once as EventListener, { once: true });
        img.addEventListener("error", once as EventListener, { once: true });
      });
      previewMutObsRef.current = mo;
    }
    if (wrap) {
      const ro = new ResizeObserver(() => {
        if (!showPreview) return;
        scheduleSync();
        schedulePreviewHighlight();
      });
      ro.observe(wrap);
      previewResizeWrapRef.current = ro;

      const onScroll = () => {
        refreshGutterPins();
        schedulePreviewHighlight();
      };
      wrap.addEventListener("scroll", onScroll);
      const prevWrap = wrap;
      return () => prevWrap.removeEventListener("scroll", onScroll);
    }
    if (body) {
      const ro2 = new ResizeObserver(() => {
        if (!showPreview) return;
        scheduleSync();
        schedulePreviewHighlight();
      });
      ro2.observe(body);
      previewResizeBodyRef.current = ro2;
    }
    return;
  }, [
    activePreviewWrap,
    activePreviewBody,
    showPreview,
    scheduleSync,
    refreshGutterPins,
    schedulePreviewHighlight,
  ]);

  const resizeOverlayTextarea = useCallback(() => {
    if (!overlayActive) return;
    const ta = overlayTextareaRef.current;
    const scroll = overlayScrollRef.current;
    const inner = overlayEditorInnerRef.current;
    if (!ta || !scroll || !inner) return;
    const innerStyle = getComputedStyle(inner);
    const pt = parseFloat(innerStyle.paddingTop || "0");
    const pb = parseFloat(innerStyle.paddingBottom || "0");
    const available = Math.max(160, scroll.clientHeight - pt - pb);
    ta.style.height = `${available}px`;
  }, [overlayActive]);

  const restoreCaretToActiveTextarea = useCallback(
    (opts?: { focus?: boolean }) => {
      const ta = activeTextarea();
      if (!ta) return;
      const len = ta.value.length;
      const s = clamp(selStartRef.current, 0, len);
      const e = clamp(selEndRef.current, s, len);
      if (opts?.focus) ta.focus();
      ta.setSelectionRange(s, e);
      centerTextareaCaret(ta);
      caretRef.current = e;
      scheduleSync();
      scheduleEditorHighlight();
      schedulePreviewHighlight();
    },
    [activeTextarea, scheduleSync, scheduleEditorHighlight, schedulePreviewHighlight],
  );

  const ensureFormBottomInView = useCallback(
    (behavior: ScrollBehavior = "smooth") => {
      if (overlayActive) return;
      const form = formRef.current;
      if (!form) return;
      const rect = form.getBoundingClientRect();
      const delta = rect.bottom - window.innerHeight;
      if (delta > 0) {
        window.scrollBy({ top: delta + 8, behavior });
      }
    },
    [overlayActive],
  );

  const scheduleSyncRef = useRef<() => void>(() => {});
  const resizeOverlayTextareaRef = useRef<() => void>(() => {});
  const scheduleEditorHighlightRef = useRef<() => void>(() => {});
  const schedulePreviewHighlightRef = useRef<() => void>(() => {});
  scheduleSyncRef.current = scheduleSync;
  resizeOverlayTextareaRef.current = resizeOverlayTextarea;
  scheduleEditorHighlightRef.current = scheduleEditorHighlight;
  schedulePreviewHighlightRef.current = schedulePreviewHighlight;

  useEffect(() => {
    afterNextPaint(() => ensureFormBottomInView("smooth"));
  }, [ensureFormBottomInView]);

  useEffect(() => {
    if (!overlayActive && hasFocusedOnce) {
      afterNextPaint(() => ensureFormBottomInView("smooth"));
    }
  }, [hasFocusedOnce, overlayActive, ensureFormBottomInView]);

  useEffect(() => {
    if (!overlayActive && showPreview) {
      afterNextPaint(() => ensureFormBottomInView("smooth"));
    }
  }, [showPreview, overlayActive, ensureFormBottomInView]);

  useEffect(() => {
    if (!overlayActive) return;
    resizeOverlayTextareaRef.current();
    const onResize = () => {
      resizeOverlayTextareaRef.current();
      refreshGutterPins();
      schedulePreviewHighlight();
      scheduleEditorHighlight();
    };
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("resize", onResize);
    };
  }, [
    overlayActive,
    resizeOverlayTextarea,
    refreshGutterPins,
    schedulePreviewHighlight,
    scheduleEditorHighlight,
  ]);

  useEffect(() => {
    if (!overlayActive) return;
    resizeOverlayTextareaRef.current();
  }, [overlayActive, error, submitting, contentLengthLimit]);

  useEffect(() => {
    if (!showPreview) return;
    scheduleSyncRef.current();
  }, [content, showPreview, scheduleSync]);

  useLayoutEffect(() => {
    const prevWasOverlay = prevOverlayActiveRef.current;
    const srcTa = prevWasOverlay ? overlayTextareaRef.current : textareaRef.current;
    const s = srcTa ? (srcTa.selectionStart ?? selStartRef.current) : selStartRef.current;
    const e = srcTa ? (srcTa.selectionEnd ?? selEndRef.current) : selEndRef.current;
    selStartRef.current = s;
    selEndRef.current = e;
    caretRef.current = e;

    restoreCaretToActiveTextarea({ focus: false });
    if (overlayActive) resizeOverlayTextareaRef.current();

    afterNextPaint(() => {
      const t = activeTextarea();
      if (t) {
        const len = t.value.length;
        const s2 = clamp(selStartRef.current, 0, len);
        const e2 = clamp(selEndRef.current, s2, len);
        t.setSelectionRange(s2, e2);
        centerTextareaCaret(t);
        caretRef.current = e2;
      }
      attachPreviewObservers();
      ensurePreviewReadyAndSync(160);
    });

    prevOverlayActiveRef.current = overlayActive;
  }, [
    overlayActive,
    restoreCaretToActiveTextarea,
    activeTextarea,
    attachPreviewObservers,
    ensurePreviewReadyAndSync,
    resizeOverlayTextarea,
  ]);

  useLayoutEffect(() => {
    if (!showPreview) {
      previewMutObsRef.current?.disconnect();
      previewResizeWrapRef.current?.disconnect();
      previewResizeBodyRef.current?.disconnect();
      return;
    }
    attachPreviewObservers();
    ensurePreviewReadyAndSync(160);
    afterNextPaint(() => {
      const t = activeTextarea();
      if (t) {
        const len = t.value.length;
        const s = clamp(selStartRef.current, 0, len);
        const e = clamp(selEndRef.current, s, len);
        t.setSelectionRange(s, e);
        centerTextareaCaret(t);
        caretRef.current = e;
      }
      ensurePreviewReadyAndSync(160);
    });
  }, [showPreview, attachPreviewObservers, ensurePreviewReadyAndSync, activeTextarea]);

  useEffect(() => {
    if (!showPreview) return;
    ensurePreviewReadyAndSync(160);
  }, [isXl, showPreview, ensurePreviewReadyAndSync]);

  useEffect(() => {
    if (!overlayActive) return;
    const wrap = overlayWrapRef.current;
    if (!wrap) return;
    const onScroll = () => {
      refreshGutterPins();
      schedulePreviewHighlight();
      scheduleEditorHighlight();
    };
    wrap.addEventListener("scroll", onScroll);
    return () => {
      wrap.removeEventListener("scroll", onScroll);
    };
  }, [overlayActive, refreshGutterPins, schedulePreviewHighlight, scheduleEditorHighlight]);

  useEffect(() => {
    const timersSnapshot = ensureTimersRef.current;
    return () => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
      if (editorHighlightRafRef.current != null)
        cancelAnimationFrame(editorHighlightRafRef.current);
      if (previewHighlightRafRef.current != null)
        cancelAnimationFrame(previewHighlightRafRef.current);
      previewMutObsRef.current?.disconnect();
      previewResizeWrapRef.current?.disconnect();
      previewResizeBodyRef.current?.disconnect();
      timersSnapshot.forEach((id) => clearTimeout(id));
      caretMirrorRef.current?.remove();
      caretMirrorRef.current = null;
    };
  }, []);

  useEffect(() => {
    scheduleEditorHighlight();
    schedulePreviewHighlight();
  }, [scheduleEditorHighlight, schedulePreviewHighlight]);

  function handleSubmit(e: React.FormEvent) {
    if (overLimit) {
      e.preventDefault();
      return;
    }
    const isEmpty = body.trim() === "";
    if (isEdit && deletable && isEmpty && onDelete) {
      e.preventDefault();
      onDelete();
    } else {
      setShowPreview(false);
      onSubmit(e);
    }
  }

  function insertAtCursor(snippet: string) {
    const ta = activeTextarea();
    if (!ta) {
      const needsNL = body.length > 0 && !body.endsWith("\n");
      const next = body + (needsNL ? "\n" : "") + snippet;
      setBody(next);
      caretRef.current = next.length;
      selStartRef.current = next.length;
      selEndRef.current = next.length;
      scheduleSyncRef.current();
      if (overlayActive) {
        scheduleEditorHighlightRef.current();
        schedulePreviewHighlightRef.current();
      }
      return;
    }
    const text = ta.value;
    const start = ta.selectionStart ?? text.length;
    const end = ta.selectionEnd ?? start;
    const before = text.slice(0, start);
    const after = text.slice(end);
    const needsPrefixNL = start > 0 && before[before.length - 1] !== "\n";
    const insert = (needsPrefixNL ? "\n" : "") + snippet;
    const next = before + insert + after;
    setBody(next);
    requestAnimationFrame(() => {
      const pos = before.length + insert.length;
      ta.setSelectionRange(pos, pos);
      centerTextareaCaret(ta);
      caretRef.current = pos;
      selStartRef.current = pos;
      selEndRef.current = pos;
      scheduleSyncRef.current();
      if (overlayActive) {
        scheduleEditorHighlightRef.current();
        schedulePreviewHighlightRef.current();
      }
      if (overlayActive) resizeOverlayTextareaRef.current();
    });
  }
  function insertInlineAtCursor(snippet: string) {
    const ta = activeTextarea();
    if (!ta) {
      const next = body + snippet;
      setBody(next);
      caretRef.current = next.length;
      selStartRef.current = next.length;
      selEndRef.current = next.length;
      scheduleSyncRef.current();
      if (overlayActive) {
        scheduleEditorHighlightRef.current();
        schedulePreviewHighlightRef.current();
      }
      return;
    }
    const text = ta.value;
    const start = ta.selectionStart ?? text.length;
    const end = ta.selectionEnd ?? start;
    const before = text.slice(0, start);
    const after = text.slice(end);
    const next = before + snippet + after;
    setBody(next);
    requestAnimationFrame(() => {
      const pos = before.length + snippet.length;
      ta.setSelectionRange(pos, pos);
      centerTextareaCaret(ta);
      caretRef.current = pos;
      selStartRef.current = pos;
      selEndRef.current = pos;
      scheduleSyncRef.current();
      if (overlayActive) {
        scheduleEditorHighlightRef.current();
        schedulePreviewHighlightRef.current();
      }
      if (overlayActive) resizeOverlayTextareaRef.current();
    });
  }

  return (
    <div className="relative group">
      <form
        ref={formRef}
        id={formId}
        onSubmit={handleSubmit}
        className={className + " flex flex-col gap-2"}
        onClick={(e) => e.stopPropagation()}
        aria-hidden={overlayActive ? true : undefined}
      >
        <div className="hidden group-focus-within:flex absolute left-0 right-0 top-0 -translate-y-full">
          <div className="w-full px-1.5 text-gray-600 backdrop-blur-sm flex items-center justify-between">
            <div className="flex items-center gap-1">
              <button
                type="button"
                onMouseDown={actPrefix("# ")}
                title="Heading 1"
                className="inline-flex h-6 w-7 items-center justify-center rounded border border-gray-300 bg-gray-50 hover:bg-gray-100 text-gray-700 disabled:opacity-50 leading-none -translate-y-px"
              >
                <Heading1 className="w-4 h-4 opacity-80" aria-hidden />
                <span className="sr-only">H1</span>
              </button>
              <button
                type="button"
                onMouseDown={actPrefix("## ")}
                title="Heading 2"
                className="inline-flex h-6 w-7 items-center justify-center rounded border border-gray-300 bg-gray-50 hover:bg-gray-100 text-gray-700 disabled:opacity-50 leading-none -translate-y-px"
              >
                <Heading2 className="w-4 h-4 opacity-80" aria-hidden />
                <span className="sr-only">H2</span>
              </button>
              <button
                type="button"
                onMouseDown={actPrefix("### ")}
                title="Heading 3"
                className="hidden md:inline-flex h-6 w-7 items-center justify-center rounded border border-gray-300 bg-gray-50 hover:bg-gray-100 text-gray-700 disabled:opacity-50 leading-none -translate-y-px"
              >
                <Heading3 className="w-4 h-4 opacity-80" aria-hidden />
                <span className="sr-only">H3</span>
              </button>
              <button
                type="button"
                onMouseDown={actPrefix("- ")}
                title="List"
                className="inline-flex h-6 w-7 items-center justify-center rounded border border-gray-300 bg-gray-50 hover:bg-gray-100 text-gray-700 disabled:opacity-50 leading-none -translate-y-px"
              >
                <ListIcon className="w-4 h-4 opacity-80" aria-hidden />
                <span className="sr-only">List</span>
              </button>
              <button
                type="button"
                onMouseDown={actPrefix("> ")}
                title="Quote"
                className="hidden md:inline-flex h-6 w-7 items-center justify-center rounded border border-gray-300 bg-gray-50 hover:bg-gray-100 text-gray-700 disabled:opacity-50 leading-none -translate-y-px"
              >
                <QuoteIcon className="w-4 h-4 opacity-80" aria-hidden />
                <span className="sr-only">Quote</span>
              </button>
              <button
                type="button"
                onMouseDown={actFence}
                title="Code block"
                className="hidden md:inline-flex h-6 w-7 items-center justify-center rounded border border-gray-300 bg-gray-50 hover:bg-gray-100 text-gray-700 disabled:opacity-50 leading-none -translate-y-px"
              >
                <CodeBlockIcon className="w-4 h-4 opacity-80" aria-hidden />
                <span className="sr-only">Code Block</span>
              </button>
              <button
                type="button"
                onMouseDown={actInline("**")}
                title="Bold"
                className="inline-flex h-6 w-7 items-center justify-center rounded border border-gray-300 bg-gray-50 hover:bg-gray-100 text-gray-700 disabled:opacity-50 leading-none -translate-y-px"
              >
                <BoldIcon className="w-4 h-4 opacity-80" aria-hidden />
                <span className="sr-only">Bold</span>
              </button>
              <button
                type="button"
                onMouseDown={actInline("::")}
                title="Italic"
                className="inline-flex h-6 w-7 items-center justify-center rounded border border-gray-300 bg-gray-50 hover:bg-gray-100 text-gray-700 disabled:opacity-50 leading-none -translate-y-px"
              >
                <ItalicIcon className="w-4 h-4 opacity-80" aria-hidden />
                <span className="sr-only">Italic</span>
              </button>
              <button
                type="button"
                onMouseDown={actInline("__")}
                title="Underline"
                className="hidden md:inline-flex h-6 w-7 items-center justify-center rounded border border-gray-300 bg-gray-50 hover:bg-gray-100 text-gray-700 disabled:opacity-50 leading-none -translate-y-px"
              >
                <UnderlineIcon className="w-4 h-4 opacity-80" aria-hidden />
                <span className="sr-only">Underline</span>
              </button>
              <button
                type="button"
                onMouseDown={actInline("~~")}
                title="Strikethrough"
                className="hidden md:inline-flex h-6 w-7 items-center justify-center rounded border border-gray-300 bg-gray-50 hover:bg-gray-100 text-gray-700 disabled:opacity-50 leading-none -translate-y-px"
              >
                <StrikethroughIcon className="w-4 h-4 opacity-80" aria-hidden />
                <span className="sr-only">Strikethrough</span>
              </button>
              <button
                type="button"
                onMouseDown={actInline("``")}
                title="Inline code"
                className="hidden md:inline-flex h-6 w-7 items-center justify-center rounded border border-gray-300 bg-gray-50 hover:bg-gray-100 text-gray-700 disabled:opacity-50 leading-none -translate-y-px"
              >
                <InlineCodeIcon className="w-4 h-4 opacity-80" aria-hidden />
                <span className="sr-only">Inline Code</span>
              </button>
              <button
                type="button"
                onMouseDown={actInline("%%")}
                title="Mark"
                className="hidden md:inline-flex h-6 w-7 items-center justify-center rounded border border-gray-300 bg-gray-50 hover:bg-gray-100 text-gray-700 disabled:opacity-50 leading-none -translate-y-px"
              >
                <MarkIcon className="w-4 h-4 opacity-80" aria-hidden />
                <span className="sr-only">Mark</span>
              </button>
              <button
                type="button"
                onMouseDown={actRuby}
                title="Ruby"
                className="hidden md:inline-flex h-6 w-7 items-center justify-center rounded border border-gray-300 bg-gray-50 hover:bg-gray-100 text-gray-700 disabled:opacity-50 leading-none -translate-y-px"
              >
                <RubyIcon className="w-4 h-4 opacity-80" aria-hidden />
                <span className="sr-only">Ruby</span>
              </button>
              <button
                type="button"
                onMouseDown={actLink}
                title="Link"
                className="inline-flex h-6 w-7 items-center justify-center rounded border border-gray-300 bg-gray-50 hover:bg-gray-100 text-gray-700 disabled:opacity-50 leading-none -translate-y-px"
              >
                <LinkIcon className="w-4 h-4 opacity-80" aria-hidden />
                <span className="sr-only">Link</span>
              </button>
            </div>

            <div className="flex items-center gap-1">
              <UserMentionButton onInsert={(md) => insertInlineAtCursor(md)} />
              <ExistingImageEmbedButton onInsert={(md) => insertAtCursor(md)} />
              <UploadImageEmbedButton onInsert={(md) => insertAtCursor(md)} />
            </div>
          </div>
        </div>

        {!overlayActive && (
          <div className="relative">
            <textarea
              ref={textareaRef}
              className="relative z-10 w-full border border-gray-400 rounded px-2 py-1 min-h-[64px] bg-white break-all"
              placeholder={placeholder}
              value={body}
              onChange={(e) => {
                setBody(e.target.value);
                const s = e.currentTarget.selectionStart ?? 0;
                const ed = e.currentTarget.selectionEnd ?? s;
                selStartRef.current = s;
                selEndRef.current = ed;
                caretRef.current = ed;
                scheduleSyncRef.current();
                if (overlayActive) {
                  scheduleEditorHighlightRef.current();
                  schedulePreviewHighlightRef.current();
                }
              }}
              onKeyUp={() => {
                const ta = textareaRef.current;
                if (ta) {
                  const s = ta.selectionStart ?? caretRef.current;
                  const ed = ta.selectionEnd ?? s;
                  selStartRef.current = s;
                  selEndRef.current = ed;
                  caretRef.current = ed;
                }
                scheduleSyncRef.current();
                if (overlayActive) {
                  scheduleEditorHighlightRef.current();
                  schedulePreviewHighlightRef.current();
                }
              }}
              onClick={() => {
                const ta = textareaRef.current;
                if (ta) {
                  const s = ta.selectionStart ?? caretRef.current;
                  const ed = ta.selectionEnd ?? s;
                  selStartRef.current = s;
                  selEndRef.current = ed;
                  caretRef.current = ed;
                }
                scheduleSyncRef.current();
                if (overlayActive) {
                  scheduleEditorHighlightRef.current();
                  schedulePreviewHighlightRef.current();
                }
              }}
              onSelect={() => {
                const ta = textareaRef.current;
                if (ta) {
                  const s = ta.selectionStart ?? caretRef.current;
                  const ed = ta.selectionEnd ?? s;
                  selStartRef.current = s;
                  selEndRef.current = ed;
                  caretRef.current = ed;
                }
                scheduleSyncRef.current();
                if (overlayActive) {
                  scheduleEditorHighlightRef.current();
                  schedulePreviewHighlightRef.current();
                }
              }}
              onScroll={() => {
                if (overlayActive) {
                  scheduleEditorHighlightRef.current();
                  schedulePreviewHighlightRef.current();
                }
              }}
              maxLength={65535}
              onFocus={handleFocus}
              rows={1}
              style={{ resize: "vertical" }}
            />
          </div>
        )}

        {hasFocusedOnce && (
          <div className="flex items-center gap-2">
            <div className="flex-1">
              {error && <div className="text-red-600 text-sm">{error}</div>}
              <div className="hidden group-focus-within:block">
                <div
                  className={`ml-1 text-xs ${overLimit ? "text-yellow-700" : "text-gray-400"}`}
                  role="status"
                  aria-live="polite"
                >
                  {contentLengthLimit != null
                    ? `${contentLength} / ${contentLengthLimit}`
                    : `${contentLength} chars`}
                </div>
                {contentLengthLimit != null && overLimit && (
                  <div className="text-yellow-700 text-sm">
                    Content is too long ({contentLength} / {contentLengthLimit} characters)
                  </div>
                )}
              </div>
            </div>
            {onCancel && (
              <button
                type="button"
                className="bg-gray-200 text-gray-700 px-4 py-1 rounded border border-gray-300 cursor-pointer hover:bg-gray-300 transition"
                onClick={onCancel}
              >
                Cancel
              </button>
            )}
            <button
              type="button"
              className="bg-gray-100 text-gray-700 hover:bg-gray-200 px-3 py-1 rounded border border-gray-300 cursor-pointer transition"
              onClick={() => {
                const ta = activeTextarea();
                const s = ta ? (ta.selectionStart ?? selStartRef.current) : selStartRef.current;
                const ed = ta ? (ta.selectionEnd ?? selEndRef.current) : selEndRef.current;
                selStartRef.current = s;
                selEndRef.current = ed;
                caretRef.current = ed;
                const willShow = !showPreview;
                setShowPreview(willShow);
                if (willShow) {
                  afterNextPaint(() => {
                    const t = activeTextarea();
                    if (t) {
                      const len = t.value.length;
                      const s2 = clamp(selStartRef.current, 0, len);
                      const e2 = clamp(selEndRef.current, s2, len);
                      t.setSelectionRange(s2, e2);
                      centerTextareaCaret(t);
                      caretRef.current = e2;
                    }
                    ensureFormBottomInView("smooth");
                    attachPreviewObservers();
                    ensurePreviewReadyAndSync(160);
                    scheduleEditorHighlightRef.current();
                    schedulePreviewHighlightRef.current();
                  });
                }
              }}
            >
              {showPreview ? "Hide Preview" : "Preview"}
            </button>
            <button
              type="submit"
              className={
                isEdit && deletable && body.trim() === ""
                  ? "bg-red-500 text-white hover:bg-red-600 px-4 py-1 rounded cursor-pointer ml-auto"
                  : "bg-blue-500 text-white hover:bg-blue-600 px-4 py-1 rounded cursor-pointer ml-auto disabled:opacity-50 disabled:cursor-not-allowed"
              }
              disabled={submitting || overLimit}
            >
              {submitting
                ? isEdit && deletable && body.trim() === ""
                  ? "Deleting..."
                  : "Saving..."
                : isEdit && deletable && body.trim() === ""
                  ? "Delete"
                  : buttonLabel}
            </button>
          </div>
        )}

        {showPreview && !overlayActive && (
          <div
            ref={previewWrapRef}
            className="relative border rounded bg-white mt-1 p-3 max-h-[50ex] overflow-y-auto"
          >
            <div className="relative z-10">
              <div className="font-bold text-gray-500 text-xs mb-2">Preview</div>
              <div
                ref={previewBodyRef}
                className="markdown-body"
                dangerouslySetInnerHTML={{ __html: previewHtml }}
                style={{ minHeight: 32 }}
              />
              {(attrLabels.length > 0 || tags.length > 0) && (
                <div className="mt-3 flex flex-wrap gap-2">
                  {attrLabels.map((label) => (
                    <span
                      key={`attr:${label}`}
                      className="inline-block rounded px-2 py-0.5 text-sm border bg-purple-50 text-purple-800 border-purple-200"
                    >
                      {label}
                    </span>
                  ))}
                  {tags.map((tag) => (
                    <span
                      key={tag}
                      className="inline-block bg-gray-100 rounded px-2 py-0.5 text-blue-700 text-sm"
                    >
                      #{tag}
                    </span>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </form>

      {overlayActive && (
        <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm">
          <div className="absolute inset-0 flex flex-col">
            <div className="flex-1 grid grid-cols-2 gap-0 h-full w-full overflow-hidden">
              <div
                ref={overlayEditorColRef}
                className="relative bg-gray-50 border-r min-h-0 flex flex-col"
              >
                <div
                  ref={overlayToolbarRef}
                  className="sticky top-0 z-10 bg-gray-200 border-b border-gray-200 w-full"
                >
                  <div className="mx-auto max-w-[85ex] w-full px-1.5 py-1 flex items-center justify-between">
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        onMouseDown={actPrefix("# ")}
                        title="Heading 1"
                        className="inline-flex h-6 w-7 items-center justify-center rounded border border-gray-300 bg-gray-50 hover:bg-gray-100 text-gray-700 leading-none"
                      >
                        <Heading1 className="w-4 h-4 opacity-80" aria-hidden />
                        <span className="sr-only">H1</span>
                      </button>
                      <button
                        type="button"
                        onMouseDown={actPrefix("## ")}
                        title="Heading 2"
                        className="inline-flex h-6 w-7 items-center justify-center rounded border border-gray-300 bg-gray-50 hover:bg-gray-100 text-gray-700 leading-none"
                      >
                        <Heading2 className="w-4 h-4 opacity-80" aria-hidden />
                        <span className="sr-only">H2</span>
                      </button>
                      <button
                        type="button"
                        onMouseDown={actPrefix("### ")}
                        title="Heading 3"
                        className="inline-flex h-6 w-7 items-center justify-center rounded border border-gray-300 bg-gray-50 hover:bg-gray-100 text-gray-700 leading-none"
                      >
                        <Heading3 className="w-4 h-4 opacity-80" aria-hidden />
                        <span className="sr-only">H3</span>
                      </button>
                      <button
                        type="button"
                        onMouseDown={actPrefix("- ")}
                        title="List"
                        className="hidden xl:inline-flex h-6 w-7 items-center justify-center rounded border border-gray-300 bg-gray-50 hover:bg-gray-100 text-gray-700 leading-none"
                      >
                        <ListIcon className="w-4 h-4 opacity-80" aria-hidden />
                        <span className="sr-only">List</span>
                      </button>
                      <button
                        type="button"
                        onMouseDown={actPrefix("> ")}
                        title="Quote"
                        className="hidden xl:inline-flex h-6 w-7 items-center justify-center rounded border border-gray-300 bg-gray-50 hover:bg-gray-100 text-gray-700 leading-none"
                      >
                        <QuoteIcon className="w-4 h-4 opacity-80" aria-hidden />
                        <span className="sr-only">Quote</span>
                      </button>
                      <button
                        type="button"
                        onMouseDown={actFence}
                        title="Code block"
                        className="hidden xl:inline-flex h-6 w-7 items-center justify-center rounded border border-gray-300 bg-gray-50 hover:bg-gray-100 text-gray-700 leading-none"
                      >
                        <CodeBlockIcon className="w-4 h-4 opacity-80" aria-hidden />
                        <span className="sr-only">Code Block</span>
                      </button>
                      <button
                        type="button"
                        onMouseDown={actInline("**")}
                        title="Bold"
                        className="inline-flex h-6 w-7 items-center justify-center rounded border border-gray-300 bg-gray-50 hover:bg-gray-100 text-gray-700 leading-none"
                      >
                        <BoldIcon className="w-4 h-4 opacity-80" aria-hidden />
                        <span className="sr-only">Bold</span>
                      </button>
                      <button
                        type="button"
                        onMouseDown={actInline("::")}
                        title="Italic"
                        className="hidden xl:inline-flex h-6 w-7 items-center justify-center rounded border border-gray-300 bg-gray-50 hover:bg-gray-100 text-gray-700 leading-none"
                      >
                        <ItalicIcon className="w-4 h-4 opacity-80" aria-hidden />
                        <span className="sr-only">Italic</span>
                      </button>
                      <button
                        type="button"
                        onMouseDown={actInline("__")}
                        title="Underline"
                        className="hidden xl:inline-flex h-6 w-7 items中心 justify-center rounded border border-gray-300 bg-gray-50 hover:bg-gray-100 text-gray-700 leading-none"
                      >
                        <UnderlineIcon className="w-4 h-4 opacity-80" aria-hidden />
                        <span className="sr-only">Underline</span>
                      </button>
                      <button
                        type="button"
                        onMouseDown={actInline("~~")}
                        title="Strikethrough"
                        className="hidden xl:inline-flex h-6 w-7 items-center justify-center rounded border border-gray-300 bg-gray-50 hover:bg-gray-100 text-gray-700 leading-none"
                      >
                        <StrikethroughIcon className="w-4 h-4 opacity-80" aria-hidden />
                        <span className="sr-only">Strikethrough</span>
                      </button>
                      <button
                        type="button"
                        onMouseDown={actInline("``")}
                        title="Inline code"
                        className="hidden xl:inline-flex h-6 w-7 items-center justify-center rounded border border-gray-300 bg-gray-50 hover:bg-gray-100 text-gray-700 leading-none"
                      >
                        <InlineCodeIcon className="w-4 h-4 opacity-80" aria-hidden />
                        <span className="sr-only">Inline Code</span>
                      </button>
                      <button
                        type="button"
                        onMouseDown={actInline("%%")}
                        title="Mark"
                        className="hidden xl:inline-flex h-6 w-7 items-center justify-center rounded border border-gray-300 bg-gray-50 hover:bg-gray-100 text-gray-700 leading-none"
                      >
                        <MarkIcon className="w-4 h-4 opacity-80" aria-hidden />
                        <span className="sr-only">Mark</span>
                      </button>
                      <button
                        type="button"
                        onMouseDown={actRuby}
                        title="Ruby"
                        className="hidden xl:inline-flex h-6 w-7 items-center justify-center rounded border border-gray-300 bg-gray-50 hover:bg-gray-100 text-gray-700 leading-none"
                      >
                        <RubyIcon className="w-4 h-4 opacity-80" aria-hidden />
                        <span className="sr-only">Ruby</span>
                      </button>
                      <button
                        type="button"
                        onMouseDown={actLink}
                        title="Link"
                        className="inline-flex h-6 w-7 items-center justify-center rounded border border-gray-300 bg-gray-50 hover:bg-gray-100 text-gray-700 leading-none"
                      >
                        <LinkIcon className="w-4 h-4 opacity-80" aria-hidden />
                        <span className="sr-only">Link</span>
                      </button>
                    </div>

                    <div className="flex items-center gap-1">
                      <UserMentionButton onInsert={(md) => insertInlineAtCursor(md)} />
                      <ExistingImageEmbedButton onInsert={(md) => insertAtCursor(md)} />
                      <UploadImageEmbedButton onInsert={(md) => insertAtCursor(md)} />
                    </div>
                  </div>
                </div>

                <div ref={overlayScrollRef} className="flex-1 overflow-y-auto h-full bg-[#f8f8ff]">
                  <div ref={overlayEditorInnerRef} className="mx-auto max-w-[85ex] w-full p-6">
                    <div className="relative">
                      <textarea
                        ref={overlayTextareaRef}
                        className="relative z-10 w-full border border-gray-400 rounded px-2 py-1 bg-transparent break-all"
                        placeholder={placeholder}
                        value={body}
                        onChange={(e) => {
                          setBody(e.target.value);
                          const s = e.currentTarget.selectionStart ?? 0;
                          const ed = e.currentTarget.selectionEnd ?? s;
                          selStartRef.current = s;
                          selEndRef.current = ed;
                          caretRef.current = ed;
                          scheduleSyncRef.current();
                          scheduleEditorHighlightRef.current();
                          schedulePreviewHighlightRef.current();
                        }}
                        onKeyUp={() => {
                          const ta = overlayTextareaRef.current;
                          if (ta) {
                            const s = ta.selectionStart ?? caretRef.current;
                            const ed = ta.selectionEnd ?? s;
                            selStartRef.current = s;
                            selEndRef.current = ed;
                            caretRef.current = ed;
                          }
                          scheduleSyncRef.current();
                          scheduleEditorHighlightRef.current();
                          schedulePreviewHighlightRef.current();
                        }}
                        onClick={() => {
                          const ta = overlayTextareaRef.current;
                          if (ta) {
                            const s = ta.selectionStart ?? caretRef.current;
                            const ed = ta.selectionEnd ?? s;
                            selStartRef.current = s;
                            selEndRef.current = ed;
                            caretRef.current = ed;
                          }
                          scheduleSyncRef.current();
                          scheduleEditorHighlightRef.current();
                          schedulePreviewHighlightRef.current();
                        }}
                        onSelect={() => {
                          const ta = overlayTextareaRef.current;
                          if (ta) {
                            const s = ta.selectionStart ?? caretRef.current;
                            const ed = ta.selectionEnd ?? s;
                            selStartRef.current = s;
                            selEndRef.current = ed;
                            caretRef.current = ed;
                          }
                          scheduleSyncRef.current();
                          scheduleEditorHighlightRef.current();
                          schedulePreviewHighlightRef.current();
                        }}
                        onScroll={() => {
                          scheduleEditorHighlightRef.current();
                          schedulePreviewHighlightRef.current();
                        }}
                        maxLength={65535}
                        onFocus={handleFocus}
                        rows={1}
                        style={{ resize: "none" }}
                      />
                      <div ref={editorHighlightOverlayRef} aria-hidden>
                        <div ref={editorHighlightBandRef} />
                      </div>
                    </div>
                  </div>
                </div>

                <div
                  ref={overlayFooterRef}
                  className="sticky bottom-0 w-full bg-white border-t border-gray-200"
                >
                  <div className="mx-auto max-w-[85ex] w-full px-6 py-2 flex items-center gap-2">
                    <div className="flex-1">
                      {error && <div className="text-red-600 text-sm">{error}</div>}
                      <div className="text-xs text-gray-400" role="status" aria-live="polite">
                        {contentLengthLimit != null
                          ? `${contentLength} / ${contentLengthLimit}`
                          : `${contentLength} chars`}
                        {overLimit && <span className="text-yellow-700 ml-2">(too long)</span>}
                      </div>
                    </div>

                    {onCancel && (
                      <button
                        type="button"
                        className="bg-gray-200 text-gray-700 px-4 py-1 rounded border border-gray-300 cursor-pointer hover:bg-gray-300 transition"
                        onClick={onCancel}
                      >
                        Cancel
                      </button>
                    )}

                    <button
                      type="button"
                      className="bg-gray-100 text-gray-700 hover:bg-gray-200 px-3 py-1 rounded border border-gray-300 cursor-pointer transition"
                      onClick={() => {
                        const ta = overlayTextareaRef.current;
                        const s = ta
                          ? (ta.selectionStart ?? selStartRef.current)
                          : selStartRef.current;
                        const ed = ta ? (ta.selectionEnd ?? selEndRef.current) : selEndRef.current;
                        selStartRef.current = s;
                        selEndRef.current = ed;
                        caretRef.current = ed;
                        setShowPreview(false);
                        afterNextPaint(() => {
                          const t = activeTextarea();
                          if (t) {
                            const len = t.value.length;
                            const s2 = clamp(selStartRef.current, 0, len);
                            const e2 = clamp(selEndRef.current, s2, len);
                            t.setSelectionRange(s2, e2);
                            centerTextareaCaret(t);
                            caretRef.current = e2;
                          }
                          attachPreviewObservers();
                          ensurePreviewReadyAndSync(160);
                          scheduleEditorHighlightRef.current();
                          schedulePreviewHighlightRef.current();
                        });
                      }}
                    >
                      Hide Preview
                    </button>

                    <button
                      type="submit"
                      form={formId}
                      className={
                        isEdit && deletable && body.trim() === ""
                          ? "bg-red-500 text白 hover:bg-red-600 px-4 py-1 rounded cursor-pointer ml-auto"
                          : "bg-blue-500 text-white hover:bg-blue-600 px-4 py-1 rounded cursor-pointer ml-auto disabled:opacity-50 disabled:cursor-not-allowed"
                      }
                      disabled={submitting || overLimit}
                    >
                      {submitting
                        ? isEdit && deletable && body.trim() === ""
                          ? "Deleting..."
                          : "Saving..."
                        : isEdit && deletable && body.trim() === ""
                          ? "Delete"
                          : buttonLabel}
                    </button>
                  </div>
                </div>
              </div>

              <div className="relative bg-[#eee] min-h-0 flex flex-col">
                <button
                  type="button"
                  className="absolute right-3 top-3 rounded p-1 bg白 border shadow"
                  onClick={() => {
                    const ta = overlayTextareaRef.current;
                    const s = ta ? (ta.selectionStart ?? selStartRef.current) : selStartRef.current;
                    const ed = ta ? (ta.selectionEnd ?? selEndRef.current) : selEndRef.current;
                    selStartRef.current = s;
                    selEndRef.current = ed;
                    caretRef.current = ed;
                    setShowPreview(false);
                    afterNextPaint(() => {
                      const t = activeTextarea();
                      if (t) {
                        const len = t.value.length;
                        const s2 = clamp(selStartRef.current, 0, len);
                        const e2 = clamp(selEndRef.current, s2, len);
                        t.setSelectionRange(s2, e2);
                        centerTextareaCaret(t);
                        caretRef.current = e2;
                      }
                      attachPreviewObservers();
                      ensurePreviewReadyAndSync(160);
                      scheduleEditorHighlightRef.current();
                      schedulePreviewHighlightRef.current();
                    });
                  }}
                >
                  <CloseIcon className="w-4 h-4" aria-hidden />
                  <span className="sr-only">Close preview</span>
                </button>

                <div ref={overlayWrapRef} className="relative flex-1 overflow-y-auto bg-white">
                  <div ref={previewHighlightOverlayRef} aria-hidden>
                    <div ref={previewHighlightBandRef} />
                  </div>

                  <div
                    className="mx-auto max-w-[85ex] w-full p-6"
                    style={{ position: "relative", zIndex: 1 }}
                  >
                    <div className="font-bold text-gray-500 text-xs mb-2">Preview</div>
                    <div
                      ref={overlayBodyRef}
                      className="markdown-body"
                      dangerouslySetInnerHTML={{
                        __html: previewHtml,
                      }}
                      style={{ minHeight: 32 }}
                    />
                    {(attrLabels.length > 0 || tags.length > 0) && (
                      <div className="mt-3 flex flex-wrap gap-2">
                        {attrLabels.map((label) => (
                          <span
                            key={`attr:${label}`}
                            className="inline-block rounded px-2 py-0.5 text-sm border bg-purple-50 text-purple-800 border-purple-200"
                          >
                            {label}
                          </span>
                        ))}
                        {tags.map((tag) => (
                          <span
                            key={tag}
                            className="inline-block bg-gray-100 rounded px-2 py-0.5 text-blue-700 text-sm"
                          >
                            #{tag}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>

            <div className="h-0" />
          </div>
        </div>
      )}
    </div>
  );
}
