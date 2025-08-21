"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { UserDetail } from "@/api/models";
import { listUsers } from "@/api/users";
import { useRequireLogin } from "@/hooks/useRequireLogin";
import AvatarImg from "@/components/AvatarImg";
import { renderText } from "@/utils/markdown";

type UserMentionButtonProps = {
  onInsert: (markdown: string) => void;
  children: React.ReactNode;
  className?: string;
  title?: string;
};

export default function UserMentionButton({
  onInsert,
  children,
  className = "",
  title = "Mention user",
}: UserMentionButtonProps) {
  const status = useRequireLogin();
  const focusUserId = status.state === "authenticated" ? status.session.userId : undefined;

  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [items, setItems] = useState<UserDetail[]>([]);
  const [error, setError] = useState<string | null>(null);

  const order: "asc" | "desc" | "social" = focusUserId ? "social" : "desc";

  const doFetch = useCallback(
    async (q: string) => {
      setLoading(true);
      setError(null);
      try {
        const res = await listUsers({
          limit: 20,
          order,
          ...(q ? { nicknamePrefix: q } : {}),
        });
        setItems(res);
      } catch (e) {
        setItems([]);
        setError(e instanceof Error ? e.message : "Failed to load users");
      } finally {
        setLoading(false);
      }
    },
    [order, focusUserId],
  );

  useEffect(() => {
    if (!open) return;
    const timer = window.setTimeout(() => {
      void doFetch(query.trim());
    }, 300);
    return () => window.clearTimeout(timer);
  }, [open, query, doFetch]);

  useEffect(() => {
    if (!open) return;
    function onDocMouseDown(ev: MouseEvent) {
      if (!containerRef.current) return;
      if (!containerRef.current.contains(ev.target as Node)) {
        setOpen(false);
      }
    }
    function onKey(ev: KeyboardEvent) {
      if (ev.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDocMouseDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocMouseDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  useEffect(() => {
    if (open) {
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  const onPick = useCallback(
    (u: UserDetail) => {
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
          const intro = introSnippet(u.introduction);
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
                    useThumb={true}
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
        className="px-2 py-1 rounded border border-gray-300 bg-gray-50 hover:bg-gray-100 text-gray-700 disabled:opacity-50"
        onClick={() => setOpen((v) => !v)}
        title={title}
        aria-haspopup="dialog"
        aria-expanded={open}
      >
        {children}
      </button>

      {open && (
        <div
          role="dialog"
          aria-label="Mention user"
          className="absolute right-0 mt-1 w-80 max-w-[90vw] z-50 rounded border border-gray-200 bg-white shadow-lg"
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

function introSnippet(s: string): string {
  const text = renderText(s || "");
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > 50 ? flat.slice(0, 50) + "…" : flat;
}
