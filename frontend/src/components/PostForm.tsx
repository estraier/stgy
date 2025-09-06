"use client";

import React, { useRef, useState, useEffect, useMemo } from "react";
import { makeArticleHtmlFromMarkdown } from "@/utils/article";
import { parseBodyAndTags } from "@/utils/parse";
import UserMentionButton from "@/components/UserMentionButton";
import ExistingImageEmbedButton from "@/components/ExistingImageEmbedButton";
import UploadImageEmbedButton from "@/components/UploadImageEmbedButton";

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
  const [showPreview, setShowPreview] = useState(false);
  const [hasFocusedOnce, setHasFocusedOnce] = useState(false);

  useEffect(() => {
    if (body.trim() === "") setShowPreview(false);
  }, [body]);

  useEffect(() => {
    if (autoFocus && textareaRef.current) {
      const ta = textareaRef.current;
      ta.focus();
      const pos = ta.value.length;
      ta.setSelectionRange(pos, pos);
    }
  }, [autoFocus]);

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

  function handleFocus() {
    if (!hasFocusedOnce) setHasFocusedOnce(true);
    const textarea = textareaRef.current;
    if (!textarea) return;
    const lineHeight = parseFloat(getComputedStyle(textarea).lineHeight || "20");
    const minHeight = lineHeight * 8;
    if (textarea.offsetHeight < minHeight) {
      textarea.style.height = `${minHeight}px`;
    }
    if (onErrorClear) onErrorClear();
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
    const ta = textareaRef.current;
    if (!ta) {
      const needsNL = body.length > 0 && !body.endsWith("\n");
      setBody(body + (needsNL ? "\n" : "") + snippet);
      return;
    }
    const start = ta.selectionStart ?? body.length;
    const end = ta.selectionEnd ?? start;
    const before = body.slice(0, start);
    const after = body.slice(end);
    const needsPrefixNL = start > 0 && before[before.length - 1] !== "\n";
    const text = (needsPrefixNL ? "\n" : "") + snippet;
    const next = before + text + after;
    setBody(next);
    requestAnimationFrame(() => {
      ta.focus();
      const pos = start + text.length;
      ta.setSelectionRange(pos, pos);
    });
  }

  function insertInlineAtCursor(snippet: string) {
    const ta = textareaRef.current;
    if (!ta) {
      setBody(body + snippet);
      return;
    }
    const start = ta.selectionStart ?? body.length;
    const end = ta.selectionEnd ?? start;
    const before = body.slice(0, start);
    const after = body.slice(end);
    const next = before + snippet + after;
    setBody(next);
    requestAnimationFrame(() => {
      ta.focus();
      const pos = start + snippet.length;
      ta.setSelectionRange(pos, pos);
    });
  }

  return (
    <div className="relative group">
      <form
        onSubmit={handleSubmit}
        className={className + " flex flex-col gap-2"}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="hidden group-focus-within:flex absolute right-0 top-0 -translate-y-full items-center gap-1">
          <div className="px-1.5 text-gray-600 backdrop-blur-sm flex items-center gap-1">
            <UserMentionButton onInsert={(md) => insertInlineAtCursor(md)} />
            <ExistingImageEmbedButton onInsert={(md) => insertAtCursor(md)} />
            <UploadImageEmbedButton onInsert={(md) => insertAtCursor(md)} />
          </div>
        </div>
        <textarea
          ref={textareaRef}
          className="border border-gray-400 rounded px-2 py-1 min-h-[64px] bg-gray-50 break-all"
          placeholder={placeholder}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          maxLength={65535}
          onFocus={handleFocus}
          rows={1}
          style={{ resize: "vertical" }}
        />
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
              onClick={() => setShowPreview((v) => !v)}
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

        {showPreview && content.trim() !== "" && (
          <div className="border rounded bg-white mt-1 p-3 markdown-body max-h-[50ex] overflow-y-auto">
            <div className="font-bold text-gray-500 text-xs mb-2">Preview</div>
            <div
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
    </div>
  );
}
