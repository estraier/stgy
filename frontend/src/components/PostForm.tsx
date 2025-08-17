"use client";

import React, { useRef, useState, useEffect } from "react";
import { renderHtml } from "@/utils/markdown";
import { parseBodyAndTags } from "@/utils/parse";
import ImageEmbedButton from "@/components/ImageEmbedButton";

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
}: PostFormProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [showPreview, setShowPreview] = useState(false);

  useEffect(() => {
    if (body.trim() === "") setShowPreview(false);
  }, [body]);

  function handleFocus() {
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
    const isEmpty = body.trim() === "";
    if (isEdit && deletable && isEmpty && onDelete) {
      e.preventDefault();
      onDelete();
    } else {
      onSubmit(e);
    }
  }

  // カーソル位置（なければ末尾）に Markdown を挿入
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

  const { content, tags } = parseBodyAndTags(body);

  return (
    <div className="relative group">
      <div className="hidden group-focus-within:flex absolute right-0 top-0 -translate-y-full items-center gap-1">
        <div className="px-1.5 text-gray-600 backdrop-blur-sm">
          <ImageEmbedButton onInsert={(md) => insertAtCursor(md)}>
            <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden className="opacity-80">
              <path
                fill="currentColor"
                d="M21 19V5a2 2 0 0 0-2-2H5C3.89 3 3 3.9 3 5v14a2 2 0 0 0 2 2h14c1.11 0 2-.9 2-2M8.5 13.5l2.5 3.01L14.5 12l4.5 6H5l3.5-4.5M8 8a2 2 0 1 1 4 0a2 2 0 0 1-4 0Z"
              />
            </svg>
          </ImageEmbedButton>
        </div>
      </div>

      <form
        onSubmit={handleSubmit}
        className={className + " flex flex-col gap-2"}
        onClick={(e) => e.stopPropagation()}
      >
        <textarea
          ref={textareaRef}
          className="border border-gray-400 rounded px-2 py-1 min-h-[64px] bg-gray-50"
          placeholder={placeholder}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          maxLength={5000}
          onFocus={handleFocus}
          rows={1}
          style={{ resize: "vertical" }}
        />
        <div className="flex items-center gap-2">
          <span className="flex-1 text-red-600 text-sm">{error && error}</span>
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
            tabIndex={-1}
          >
            {showPreview ? "Hide Preview" : "Preview"}
          </button>
          <button
            type="submit"
            className={
              isEdit && deletable && body.trim() === ""
                ? "bg-red-500 text-white hover:bg-red-600 px-4 py-1 rounded cursor-pointer ml-auto"
                : "bg-blue-400 text-white hover:bg-blue-500 px-4 py-1 rounded cursor-pointer ml-auto"
            }
            disabled={submitting}
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

        {showPreview && content.trim() !== "" && (
          <div className="border rounded bg-white mt-1 p-3 markdown-body">
            <div className="font-bold text-gray-500 text-xs mb-2">Preview</div>
            <div
              dangerouslySetInnerHTML={{ __html: renderHtml(content) }}
              style={{ minHeight: 32 }}
            />
            {tags.length > 0 && (
              <div className="mt-3 flex flex-wrap gap-2">
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
