"use client";

import React, { useRef, useState, useEffect } from "react";
import { renderHtml } from "@/utils/markdown";
import { parseBodyAndTags } from "@/utils/parse";
import UserMentionButton from "@/components/UserMentionButton";
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

  const { content, tags } = parseBodyAndTags(body);

  return (
    <div className="relative group">
      <div className="hidden group-focus-within:flex absolute right-0 top-0 -translate-y-full items-center gap-1">
        <div className="px-1.5 text-gray-600 backdrop-blur-sm flex items-center gap-1">
          <UserMentionButton onInsert={(md) => insertInlineAtCursor(md)}>
            <svg
              width="16"
              height="16"
              viewBox="-64 -64 640 640"
              aria-hidden
              className="opacity-80"
            >
              <path
                fill="currentColor"
                d="M483.115,144.276C393.486-56.942,101.555-43.768,24.468,159.333 c-79.871,210.431,143.055,438.656,350.166,320.186c-3.748-7.078-14.076-35.546-20.956-37.902 c-34.827,19.912-75.284,27.242-115.267,23.874c-80.693-6.801-147.99-64.165-174.165-140.074 C7.655,161.366,165.91-12.405,333.464,57.027c73.56,30.438,126.67,102.749,126.67,183.37c0,29.853-6.121,66.04-29.797,86.925 c-20.039,17.754-56.147,14.187-67.044-11.744c-12.526-30.232,0.822-75.078,5.773-106.568c3.02-19.248,6.057-38.504,9.078-57.752 c0.475-2.974-37.12-7.702-42.64-8.636c-0.601,3.812-1.202,7.623-1.802,11.435c-87.557-63.366-197.574,21.945-197.574,118.224 c-0.079,96.391,129.138,148.07,192.876,72.224c30.209,51.078,103.911,49.267,140.256,6.105 C515.807,295.311,510.872,206.584,483.115,144.276z M298.464,312.131c-55.134,74.423-160.658-24.728-97.869-101.325 c25.052-30.548,73.813-44.142,107.865-20.046C338.526,212.04,316.272,288.036,298.464,312.131z"
              />
            </svg>
          </UserMentionButton>
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
          className="border border-gray-400 rounded px-2 py-1 min-h-[64px] bg-gray-50 break-all"
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
