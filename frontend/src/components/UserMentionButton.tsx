"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { User } from "@/api/models";
import { listFriendsByNicknamePrefix } from "@/api/users";
import AvatarImg from "@/components/AvatarImg";
import { makeTextFromJsonSnippet } from "@/utils/article";
import { AtSign } from "lucide-react";
import { calculatePopoverPosition } from "@/utils/popover";

type UserMentionButtonProps = {
  onInsert: (markdown: string) => void;
  className?: string;
  title?: string;
};

export default function UserMentionButton({
  onInsert,
  className = "",
  title = "Mention user",
}: UserMentionButtonProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [items, setItems] = useState<User[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [position, setPosition] = useState({ top: 0, left: 0, width: 320 });

  const doFetch = useCallback(async (q: string) => {
    setLoading(true);
    setError(null);
    try {
      const res = await listFriendsByNicknamePrefix({
        limit: 20,
        ...(q ? { nicknamePrefix: q } : { omitOthers: true }),
      });
      setItems(res);
    } catch (e) {
      setItems([]);
      setError(e instanceof Error ? e.message : "Failed to load users");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    const timer = window.setTimeout(() => {
      void doFetch(query.trim());
    }, 300);
    return () => window.clearTimeout(timer);
  }, [open, query, doFetch]);

  const updatePosition = useCallback(() => {
    const anchor = containerRef.current?.getBoundingClientRect();
    if (!anchor) return;
    const dialogHeight = dialogRef.current?.getBoundingClientRect().height || 336;
    setPosition(
      calculatePopoverPosition(anchor, {
        viewportWidth: window.innerWidth,
        viewportHeight: window.innerHeight,
        popoverHeight: dialogHeight,
      }),
    );
  }, []);

  useEffect(() => {
    if (!open) return;
    const dialog = dialogRef.current;
    updatePosition();
    if (dialog && typeof dialog.showPopover === "function") {
      dialog.showPopover();
    }
    const raf = window.requestAnimationFrame(updatePosition);
    const observer = dialog && typeof ResizeObserver !== "undefined"
      ? new ResizeObserver(updatePosition)
      : null;
    if (dialog) observer?.observe(dialog);

    function onDocMouseDown(ev: MouseEvent) {
      const target = ev.target as Node;
      if (containerRef.current?.contains(target) || dialogRef.current?.contains(target)) return;
      setOpen(false);
    }
    function onKey(ev: KeyboardEvent) {
      if (ev.key === "Escape") setOpen(false);
    }
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    document.addEventListener("mousedown", onDocMouseDown);
    document.addEventListener("keydown", onKey);
    return () => {
      window.cancelAnimationFrame(raf);
      observer?.disconnect();
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
      document.removeEventListener("mousedown", onDocMouseDown);
      document.removeEventListener("keydown", onKey);
      if (dialog && typeof dialog.hidePopover === "function") {
        try {
          dialog.hidePopover();
        } catch {
          // The browser may already have removed the element from the top layer.
        }
      }
    };
  }, [open, updatePosition]);

  useEffect(() => {
    if (open) {
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  const onPick = useCallback(
    (u: User) => {
      const label = escapeLabelForMarkdown(u.nickname || "");
      const url = `/users/${encodeURIComponent(u.id)}`;
      onInsert(`[@${label}](${url})`);
      setOpen(false);
    },
    [onInsert],
  );

  const content = useMemo(() => {
    if (loading) {
      return <div className="py-4 text-center text-sm text-gray-500">Loading…</div>;
    }
    if (error) {
      return <div className="py-4 text-center text-sm text-red-600">{error}</div>;
    }
    if (!items.length) {
      return <div className="py-4 text-center text-sm text-gray-500">No users</div>;
    }
    return (
      <ul className="max-h-64 overflow-auto divide-y">
        {items.map((u) => {
          const intro = makeTextFromJsonSnippet(u.snippet);
          const hasAvatar = !!u.avatar;
          const avatarVersion = u.updatedAt ?? null;

          return (
            <li key={u.id}>
              <button
                type="button"
                className="w-full px-2 py-2 text-left hover:bg-gray-100 focus:bg-gray-100 focus:outline-none"
                onClick={() => onPick(u)}
                title={`Insert mention @${u.nickname}`}
              >
                <div className="flex items-start gap-2">
                  <AvatarImg
                    userId={u.id}
                    nickname={u.nickname}
                    hasAvatar={hasAvatar}
                    size={32}
                    version={avatarVersion}
                    className="shrink-0"
                  />
                  <div className="min-w-0">
                    <div className="text-sm text-gray-900 truncate">{u.nickname}</div>
                    <div className="text-[11px] text-gray-500 truncate">{intro || "—"}</div>
                  </div>
                </div>
              </button>
            </li>
          );
        })}
      </ul>
    );
  }, [items, loading, error, onPick]);

  return (
    <div ref={containerRef} className={"relative inline-block " + className}>
      <button
        type="button"
        className="inline-flex h-6 px-2 items-center justify-center rounded border border-gray-300 bg-gray-50 hover:bg-gray-100 text-gray-700 disabled:opacity-50 leading-none"
        onClick={() => setOpen((v) => !v)}
        title={title}
        aria-haspopup="dialog"
        aria-expanded={open}
      >
        <AtSign size={16} aria-hidden className="opacity-80" />
      </button>

      {open && (
        <div
          ref={dialogRef}
          popover="manual"
          role="dialog"
          aria-label="Mention user"
          className={
            "fixed z-[2000] overflow-hidden rounded border border-gray-200 " +
            "bg-white p-0 shadow-lg"
          }
          style={{
            top: position.top,
            left: position.left,
            right: "auto",
            bottom: "auto",
            width: position.width,
            margin: 0,
          }}
        >
          <div className="p-2 border-b bg-gray-50">
            <input
              ref={inputRef}
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search users…"
              className="w-full px-2 py-1 text-sm border rounded focus:outline-none focus:ring-2 focus:ring-blue-300"
            />
          </div>
          {content}
        </div>
      )}
    </div>
  );
}

function escapeLabelForMarkdown(label: string): string {
  return label.replace(/([\[\]])/g, "_");
}
