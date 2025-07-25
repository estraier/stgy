"use client";

import React from "react";

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
}: PostFormProps) {
  return (
    <form
      onSubmit={onSubmit}
      className={className + " flex flex-col gap-2"}
      onClick={(e) => e.stopPropagation()}
    >
      <textarea
        className="border border-gray-400 rounded px-2 py-1 min-h-[64px] bg-gray-50"
        placeholder={placeholder}
        value={body}
        onChange={(e) => setBody(e.target.value)}
        maxLength={5000}
        onFocus={onErrorClear}
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
          type="submit"
          className="bg-blue-400 text-white px-4 py-1 rounded cursor-pointer disabled:opacity-60 hover:bg-blue-500 ml-auto"
          disabled={submitting}
        >
          {submitting ? (buttonLabel === "Reply" ? "Replying..." : "Posting...") : buttonLabel}
        </button>
      </div>
    </form>
  );
}
