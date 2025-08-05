"use client";

import React, { useRef, useState, useEffect } from "react";
import { renderBody } from "@/utils/markdown"; // Markdown変換関数（既存のものを利用）

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
  placeholder = "Write your post. Use #tag lines for tags.",
  className = "",
  isEdit = false,
  deletable = false,
  onDelete,
}: PostFormProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [showPreview, setShowPreview] = useState(false);

  // 本文クリア時はプレビューも自動で閉じる
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

  return (
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

      {showPreview && body.trim() !== "" && (
        <div className="border rounded bg-white mt-1 p-3 markdown-body">
          <div className="font-bold text-gray-500 text-xs mb-2">Preview</div>
          <div
            dangerouslySetInnerHTML={{ __html: renderBody(body) }}
            style={{ minHeight: 32 }}
          />
        </div>
      )}
    </form>
  );
}
