"use client";

import React, { useRef, useState, useEffect, useMemo } from "react";
import { makeArticleHtmlFromMarkdown } from "@/utils/article";
import { parseBodyAndTags } from "@/utils/parse";
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
  ta.focus();
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
    ta.focus();
    ta.setSelectionRange(selFrom, selTo);
  });
}

function applyCodeFenceToggleFromTextarea(
  ta: HTMLTextAreaElement,
  setBody: (next: string) => void,
) {
  const text = ta.value;
  ta.focus();
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
      ta.focus();
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
    ta.focus();
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
  ta.focus();
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
      ta.focus();
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
    ta.focus();
    ta.setSelectionRange(selFrom, selTo);
  });
}

function applyRubyToggleFromTextarea(ta: HTMLTextAreaElement, setBody: (next: string) => void) {
  const text = ta.value;
  ta.focus();
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
      ta.focus();
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
    ta.focus();
    ta.setSelectionRange(selFrom, selTo);
  });
}

function applyLinkToggleFromTextarea(ta: HTMLTextAreaElement, setBody: (next: string) => void) {
  const text = ta.value;
  ta.focus();
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
      ta.focus();
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
    ta.focus();
    ta.setSelectionRange(selFrom, selTo);
  });
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

  const anchorsRef = useRef<{ char: number; el: HTMLElement }[]>([]);
  const rafRef = useRef<number | null>(null);
  const caretRef = useRef<number>(0);

  const scheduleSyncRef = useRef<() => void>(() => {});
  const rebuildAnchorsRef = useRef<() => void>(() => {});
  const resizeOverlayTextareaRef = useRef<() => void>(() => {});

  const [showPreview, setShowPreview] = useState(false);
  const [hasFocusedOnce, setHasFocusedOnce] = useState(false);
  const [isXl, setIsXl] = useState(false);

  const overlayActive = showPreview && isXl;

  useEffect(() => {
    const mq = window.matchMedia("(min-width: 1000px)");
    const apply = () => setIsXl(mq.matches);
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, []);

  useEffect(() => {
    if (!overlayActive) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [overlayActive]);

  useEffect(() => {
    if (autoFocus) {
      const ta = overlayActive ? overlayTextareaRef.current : textareaRef.current;
      if (ta) {
        ta.focus();
        const pos = ta.value.length;
        ta.setSelectionRange(pos, pos);
        caretRef.current = pos;
        scheduleSyncRef.current();
      }
    }
  }, [autoFocus, overlayActive]);

  const { content, tags, attrs } = useMemo(() => parseBodyAndTags(body), [body]);
  const contentLength = content.length;
  const overLimit = contentLengthLimit != null ? contentLength > contentLengthLimit : false;

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

  function activeTextarea(): HTMLTextAreaElement | null {
    return overlayActive ? overlayTextareaRef.current : textareaRef.current;
  }
  function activePreviewWrap(): HTMLDivElement | null {
    return overlayActive ? overlayWrapRef.current : previewWrapRef.current;
  }
  function activePreviewBody(): HTMLDivElement | null {
    return overlayActive ? overlayBodyRef.current : previewBodyRef.current;
  }

  function handleFocus() {
    if (!hasFocusedOnce) setHasFocusedOnce(true);
    const textarea = activeTextarea();
    if (!textarea) return;
    const lineHeight = parseFloat(getComputedStyle(textarea).lineHeight || "20");
    const minHeight = lineHeight * 10;
    if (!overlayActive && textarea.offsetHeight < minHeight) {
      textarea.style.height = `${minHeight}px`;
    }
    if (onErrorClear) onErrorClear();
    caretRef.current = textarea.selectionEnd ?? textarea.selectionStart ?? 0;
    scheduleSyncRef.current();
    if (overlayActive) resizeOverlayTextareaRef.current();
  }

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
      scheduleSyncRef.current();
      return;
    }
    const text = ta.value;
    ta.focus();
    const start = ta.selectionStart ?? text.length;
    const end = ta.selectionEnd ?? start;
    const before = text.slice(0, start);
    const after = text.slice(end);
    const needsPrefixNL = start > 0 && before[before.length - 1] !== "\n";
    const insert = (needsPrefixNL ? "\n" : "") + snippet;
    const next = before + insert + after;
    setBody(next);
    requestAnimationFrame(() => {
      ta.focus();
      const pos = before.length + insert.length;
      ta.setSelectionRange(pos, pos);
      caretRef.current = pos;
      scheduleSyncRef.current();
      if (overlayActive) resizeOverlayTextareaRef.current();
    });
  }
  function insertInlineAtCursor(snippet: string) {
    const ta = activeTextarea();
    if (!ta) {
      const next = body + snippet;
      setBody(next);
      caretRef.current = next.length;
      scheduleSyncRef.current();
      return;
    }
    const text = ta.value;
    ta.focus();
    const start = ta.selectionStart ?? text.length;
    const end = ta.selectionEnd ?? start;
    const before = text.slice(0, start);
    const after = text.slice(end);
    const next = before + snippet + after;
    setBody(next);
    requestAnimationFrame(() => {
      ta.focus();
      const pos = before.length + snippet.length;
      ta.setSelectionRange(pos, pos);
      caretRef.current = pos;
      scheduleSyncRef.current();
      if (overlayActive) resizeOverlayTextareaRef.current();
    });
  }

  const actPrefix = (prefix: string) => (e: React.MouseEvent) => {
    e.preventDefault();
    const ta = activeTextarea();
    if (!ta) return;
    applyPrefixToggleFromTextarea(ta, setBody, prefix);
    requestAnimationFrame(() => {
      caretRef.current = ta.selectionEnd ?? ta.selectionStart ?? caretRef.current;
      scheduleSyncRef.current();
      if (overlayActive) resizeOverlayTextareaRef.current();
    });
  };
  const actFence = (e: React.MouseEvent) => {
    e.preventDefault();
    const ta = activeTextarea();
    if (!ta) return;
    applyCodeFenceToggleFromTextarea(ta, setBody);
    requestAnimationFrame(() => {
      caretRef.current = ta.selectionEnd ?? ta.selectionStart ?? caretRef.current;
      scheduleSyncRef.current();
      if (overlayActive) resizeOverlayTextareaRef.current();
    });
  };
  const actInline = (open: string, close?: string) => (e: React.MouseEvent) => {
    e.preventDefault();
    const ta = activeTextarea();
    if (!ta) return;
    applyInlineToggleFromTextarea(ta, setBody, open, close ?? open);
    requestAnimationFrame(() => {
      caretRef.current = ta.selectionEnd ?? ta.selectionStart ?? caretRef.current;
      scheduleSyncRef.current();
      if (overlayActive) resizeOverlayTextareaRef.current();
    });
  };
  const actRuby = (e: React.MouseEvent) => {
    e.preventDefault();
    const ta = activeTextarea();
    if (!ta) return;
    applyRubyToggleFromTextarea(ta, setBody);
    requestAnimationFrame(() => {
      caretRef.current = ta.selectionEnd ?? ta.selectionStart ?? caretRef.current;
      scheduleSyncRef.current();
      if (overlayActive) resizeOverlayTextareaRef.current();
    });
  };
  const actLink = (e: React.MouseEvent) => {
    e.preventDefault();
    const ta = activeTextarea();
    if (!ta) return;
    applyLinkToggleFromTextarea(ta, setBody);
    requestAnimationFrame(() => {
      caretRef.current = ta.selectionEnd ?? ta.selectionStart ?? caretRef.current;
      scheduleSyncRef.current();
      if (overlayActive) resizeOverlayTextareaRef.current();
    });
  };

  function rebuildAnchors() {
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
  }

  function findAnchor(caret: number): HTMLElement | null {
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
  }

  function syncToCaret() {
    if (!showPreview) return;
    const wrap = activePreviewWrap();
    if (!wrap) return;
    const caret = Math.min(Math.max(0, caretRef.current), content.length);
    const target = findAnchor(caret);
    if (!target) return;
    const wrapRect = wrap.getBoundingClientRect();
    const elRect = target.getBoundingClientRect();
    const yWithin = wrap.scrollTop + (elRect.top - wrapRect.top);
    const desired = Math.max(0, yWithin - (wrap.clientHeight - target.offsetHeight) / 2);
    if (Math.abs(wrap.scrollTop - desired) > 1) {
      wrap.scrollTo({ top: desired, behavior: "auto" });
    }
  }

  function scheduleSync() {
    if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null;
      rebuildAnchors();
      syncToCaret();
    });
  }

  function resizeOverlayTextarea() {
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
  }

  scheduleSyncRef.current = scheduleSync;
  rebuildAnchorsRef.current = rebuildAnchors;
  resizeOverlayTextareaRef.current = resizeOverlayTextarea;

  useEffect(() => {
    if (!overlayActive) return;
    resizeOverlayTextareaRef.current();
    const onResize = () => resizeOverlayTextareaRef.current();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [overlayActive]);

  useEffect(() => {
    if (!overlayActive) return;
    resizeOverlayTextareaRef.current();
  }, [overlayActive, error, submitting, contentLengthLimit]);

  useEffect(() => {
    if (!showPreview) return;
    rebuildAnchorsRef.current();
    scheduleSyncRef.current();
  }, [content, showPreview, overlayActive]);

  useEffect(() => {
    return () => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    };
  }, []);

  return (
    <div className="relative group">
      <form
        id="post-form"
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
                className="inline-flex h-6 w-7 items-center justify-center rounded border border-gray-300 bg-gray-50 hover:bg-gray-100 text-gray-700 disabled:opacity-50 leading-none -translate-y-px"
              >
                <Heading3 className="w-4 h-4 opacity-80" aria-hidden />
                <span className="sr-only">H3</span>
              </button>
              <button
                type="button"
                onMouseDown={actPrefix("- ")}
                title="List"
                className="hidden md:inline-flex h-6 w-7 items-center justify-center rounded border border-gray-300 bg-gray-50 hover:bg-gray-100 text-gray-700 disabled:opacity-50 leading-none -translate-y-px"
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
                className="hidden md:inline-flex h-6 w-7 items-center justify-center rounded border border-gray-300 bg-gray-50 hover:bg-gray-100 text-gray-700 disabled:opacity-50 leading-none -translate-y-px"
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
          <textarea
            ref={textareaRef}
            className="border border-gray-400 rounded px-2 py-1 min-h-[64px] bg-gray-50 break-all"
            placeholder={placeholder}
            value={body}
            onChange={(e) => {
              setBody(e.target.value);
              const pos = e.currentTarget.selectionEnd ?? e.currentTarget.selectionStart ?? 0;
              caretRef.current = pos;
              scheduleSyncRef.current();
            }}
            onKeyUp={() => {
              const ta = textareaRef.current;
              if (ta) caretRef.current = ta.selectionEnd ?? ta.selectionStart ?? caretRef.current;
              scheduleSyncRef.current();
            }}
            onClick={() => {
              const ta = textareaRef.current;
              if (ta) caretRef.current = ta.selectionEnd ?? ta.selectionStart ?? caretRef.current;
              scheduleSyncRef.current();
            }}
            onSelect={() => {
              const ta = textareaRef.current;
              if (ta) caretRef.current = ta.selectionEnd ?? ta.selectionStart ?? caretRef.current;
              scheduleSyncRef.current();
            }}
            maxLength={65535}
            onFocus={handleFocus}
            rows={1}
            style={{ resize: "vertical" }}
          />
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
                setShowPreview((v) => !v);
                requestAnimationFrame(() => scheduleSyncRef.current());
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
            className="border rounded bg-white mt-1 p-3 markdown-body max-h-[50ex] overflow-y-auto"
          >
            <div className="font-bold text-gray-500 text-xs mb-2">Preview</div>
            <div
              ref={previewBodyRef}
              dangerouslySetInnerHTML={{ __html: makeArticleHtmlFromMarkdown(content) }}
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
        )}
      </form>

      {overlayActive && (
        <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm">
          <div className="absolute inset-0 flex flex-col">
            <div className="flex-1 grid grid-cols-2 gap-0 h-full w-full overflow-hidden">
              <div
                ref={overlayEditorColRef}
                className="relative bg-gray-50/70 border-r min-h-0 flex flex-col"
              >
                <div
                  ref={overlayToolbarRef}
                  className="sticky top-0 z-10 bg-white/80 backdrop-blur-sm border-b border-gray-200 w-full"
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
                        className="hidden xl:inline-flex h-6 w-7 items-center justify-center rounded border border-gray-300 bg-gray-50 hover:bg-gray-100 text-gray-700 leading-none"
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

                <div ref={overlayScrollRef} className="flex-1 overflow-y-auto h-full">
                  <div ref={overlayEditorInnerRef} className="mx-auto max-w-[85ex] w-full p-6">
                    <textarea
                      ref={overlayTextareaRef}
                      className="w-full border border-gray-400 rounded px-2 py-1 bg-gray-50 break-all"
                      placeholder={placeholder}
                      value={body}
                      onChange={(e) => {
                        setBody(e.target.value);
                        const pos =
                          e.currentTarget.selectionEnd ?? e.currentTarget.selectionStart ?? 0;
                        caretRef.current = pos;
                        scheduleSyncRef.current();
                      }}
                      onKeyUp={() => {
                        const ta = overlayTextareaRef.current;
                        if (ta)
                          caretRef.current =
                            ta.selectionEnd ?? ta.selectionStart ?? caretRef.current;
                        scheduleSyncRef.current();
                      }}
                      onClick={() => {
                        const ta = overlayTextareaRef.current;
                        if (ta)
                          caretRef.current =
                            ta.selectionEnd ?? ta.selectionStart ?? caretRef.current;
                        scheduleSyncRef.current();
                      }}
                      onSelect={() => {
                        const ta = overlayTextareaRef.current;
                        if (ta)
                          caretRef.current =
                            ta.selectionEnd ?? ta.selectionStart ?? caretRef.current;
                        scheduleSyncRef.current();
                      }}
                      maxLength={65535}
                      onFocus={handleFocus}
                      rows={1}
                      style={{ resize: "none" }}
                    />
                  </div>
                </div>

                <div
                  ref={overlayFooterRef}
                  className="sticky bottom-0 w-full bg-white/95 backdrop-blur border-t border-gray-200"
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
                      onClick={() => setShowPreview(false)}
                    >
                      Hide Preview
                    </button>

                    <button
                      type="submit"
                      form="post-form"
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
                </div>
              </div>

              <div className="relative bg-white min-h-0 flex flex-col">
                <button
                  type="button"
                  className="absolute right-3 top-3 rounded p-1 bg-white/90 border shadow"
                  onClick={() => setShowPreview(false)}
                >
                  <CloseIcon className="w-4 h-4" aria-hidden />
                  <span className="sr-only">Close preview</span>
                </button>

                <div ref={overlayWrapRef} className="flex-1 overflow-y-auto">
                  <div className="mx-auto max-w-[85ex] w-full p-6">
                    <div className="font-bold text-gray-500 text-xs mb-2">Preview</div>
                    <div
                      ref={overlayBodyRef}
                      className="markdown-body"
                      dangerouslySetInnerHTML={{ __html: makeArticleHtmlFromMarkdown(content) }}
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
