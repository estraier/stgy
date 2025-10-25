"use client";

import { useRouter } from "next/navigation";
import { useRef, useMemo, useEffect, useState } from "react";
import PrismHighlighter from "@/components/PrismHighlighter";
import type { Post, PostDetail } from "@/api/models";
import AvatarImg from "@/components/AvatarImg";
import { Heart, MessageCircle } from "lucide-react";
import { formatDateTime } from "@/utils/format";
import { makeArticleHtmlFromMarkdown, makeHtmlFromJsonSnippet } from "@/utils/article";
import { convertHtmlMathInline } from "@/utils/mathjax-inline";
import { updatePost } from "@/api/posts";

type PostCardProps = {
  post: Post | PostDetail;
  truncated?: boolean;
  showActions?: boolean;
  onLike?: (post: Post) => void;
  onReply?: (post: Post) => void;
  isReplying?: boolean;
  children?: React.ReactNode;
  className?: string;
  clickable?: boolean;
  avatarVersion?: string | null;
  focusUserId?: string;
  focusUserIsAdmin?: boolean;
};

export default function PostCard({
  post,
  truncated = true,
  showActions = true,
  onLike,
  onReply,
  isReplying,
  children,
  className = "",
  clickable = true,
  avatarVersion,
  focusUserId,
  focusUserIsAdmin = false,
}: PostCardProps) {
  const router = useRouter();
  const contentRef = useRef<HTMLDivElement | null>(null);

  const hasContent =
    "content" in post && typeof post.content === "string" && post.content.length > 0;

  const bodyHtml = convertHtmlMathInline(
    !truncated && hasContent
      ? makeArticleHtmlFromMarkdown((post as PostDetail).content)
      : makeHtmlFromJsonSnippet(post.snippet),
  );

  const prismDeps = useMemo(() => [bodyHtml], [bodyHtml]);

  const isBlockedForFocusUser = Boolean(
    (post as { isBlockingFocusUser?: boolean }).isBlockingFocusUser,
  );

  const postLang =
    typeof post.locale === "string" && post.locale.trim() !== "" ? post.locale : undefined;

  const [publishedAtLocal, setPublishedAtLocal] = useState<string | null>(
    ((post as any).publishedAt ?? null) as string | null,
  );

  useEffect(() => {
    setPublishedAtLocal(((post as any).publishedAt ?? null) as string | null);
  }, [post]);

  const effectivePublishedAt = publishedAtLocal;
  const showPublishedLabel =
    typeof effectivePublishedAt === "string" &&
    effectivePublishedAt.trim() !== "" &&
    new Date(effectivePublishedAt).getTime() <= Date.now();

  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    function onDocMouseDown(e: MouseEvent) {
      if (!menuOpen) return;
      if (!menuRef.current) return;
      if (menuRef.current.contains(e.target as Node)) return;
      setMenuOpen(false);
    }
    document.addEventListener("mousedown", onDocMouseDown);
    return () => document.removeEventListener("mousedown", onDocMouseDown);
  }, [menuOpen]);

  async function copyToClipboard(text: string) {
    try {
      if (navigator.clipboard && typeof navigator.clipboard.writeText === "function") {
        await navigator.clipboard.writeText(text);
        return;
      }
    } catch {}
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.left = "-9999px";
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    try {
      document.execCommand("copy");
    } finally {
      document.body.removeChild(ta);
    }
  }

  function handleCardClick(_e: React.MouseEvent | React.KeyboardEvent) {
    if (!clickable) return;
    if (typeof window !== "undefined" && window.getSelection()?.toString()) return;
    router.push(`/posts/${post.id}`);
  }

  function pad2(n: number) {
    return n < 10 ? `0${n}` : String(n);
  }

  function toLocalInputValue(d: Date) {
    const y = d.getFullYear();
    const m = pad2(d.getMonth() + 1);
    const day = pad2(d.getDate());
    const hh = pad2(d.getHours());
    const mm = pad2(d.getMinutes());
    return `${y}-${m}-${day}T${hh}:${mm}`;
  }

  function toOffsetString(d: Date) {
    const y = d.getFullYear();
    const m = pad2(d.getMonth() + 1);
    const day = pad2(d.getDate());
    const hh = pad2(d.getHours());
    const mm = pad2(d.getMinutes());
    const offMin = -d.getTimezoneOffset();
    const sign = offMin >= 0 ? "+" : "-";
    const oh = pad2(Math.floor(Math.abs(offMin) / 60));
    const om = pad2(Math.abs(offMin) % 60);
    return `${y}-${m}-${day}T${hh}:${mm}${sign}${oh}:${om}`;
  }

  const [pubDialogOpen, setPubDialogOpen] = useState(false);
  const [pubChecked, setPubChecked] = useState(false);
  const [pubInput, setPubInput] = useState("");
  const [pubError, setPubError] = useState("");
  const [applying, setApplying] = useState(false);

  useEffect(() => {
    if (!pubDialogOpen) return;
    const has = typeof effectivePublishedAt === "string" && effectivePublishedAt.trim() !== "";
    setPubChecked(has);
    const base = has ? new Date(effectivePublishedAt as string) : new Date();
    setPubInput(toLocalInputValue(base));
    setPubError("");
  }, [effectivePublishedAt, pubDialogOpen]);

  async function applyPublication() {
    setPubError("");
    if (!pubChecked) {
      setApplying(true);
      try {
        await updatePost(post.id, { publishedAt: null });
        setPublishedAtLocal(null);
        setPubDialogOpen(false);
        router.refresh();
      } finally {
        setApplying(false);
      }
      return;
    }
    if (!pubInput || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(pubInput)) {
      setPubError("Invalid datetime format");
      return;
    }
    const d = new Date(pubInput);
    if (Number.isNaN(d.getTime())) {
      setPubError("Invalid datetime");
      return;
    }
    const min = new Date("1970-01-01T00:00:00");
    const max = new Date();
    max.setFullYear(max.getFullYear() + 1);
    if (d < min || d > max) {
      setPubError("Datetime out of range");
      return;
    }
    setApplying(true);
    try {
      const out = toOffsetString(d);
      await updatePost(post.id, { publishedAt: out });
      setPublishedAtLocal(out);
      setPubDialogOpen(false);
      router.refresh();
    } finally {
      setApplying(false);
    }
  }

  const isOwner = focusUserId && focusUserId === post.ownedBy;
  const canConfigurePublication = Boolean(isOwner || focusUserIsAdmin);

  const menu = (
    <div
      ref={menuRef}
      className={`absolute right-0 top-full mt-1 w-56 rounded-md border bg-white shadow-lg z-20 ${
        menuOpen ? "block" : "hidden"
      }`}
      onClick={(e) => e.stopPropagation()}
    >
      <button
        className="w-full text-left px-3 py-2 text-sm text-gray-700 hover:bg-gray-100 rounded"
        onClick={async () => {
          await copyToClipboard(`/posts/${post.id}`);
          setMenuOpen(false);
        }}
      >
        Copy link to this post
      </button>
      <button
        className="w-full text-left px-3 py-2 text-sm text-gray-700 hover:bg-gray-100 rounded"
        onClick={async () => {
          await copyToClipboard(`[post](/posts/${post.id})`);
          setMenuOpen(false);
        }}
      >
        Copy mention Markdown
      </button>
      {canConfigurePublication && (
        <button
          className="w-full text-left px-3 py-2 text-sm text-gray-700 hover:bg-gray-100 rounded"
          onClick={() => {
            setMenuOpen(false);
            setPubDialogOpen(true);
          }}
        >
          Configure external publication
        </button>
      )}
    </div>
  );

  return (
    <article
      className={`p-2 sm:pt-4 sm:pb-2 sm:pl-4 sm:pr-3 border rounded bg-white shadow-sm ${clickable ? "cursor-pointer" : ""} ${className}`}
      onClick={clickable && !pubDialogOpen ? handleCardClick : undefined}
      tabIndex={clickable ? 0 : -1}
      role={clickable ? "button" : undefined}
      aria-label={clickable ? "Show post detail" : undefined}
      onKeyDown={
        clickable && !pubDialogOpen
          ? (e) => {
              if (e.key === "Enter" || e.key === " ") {
                handleCardClick(e);
              }
            }
          : undefined
      }
    >
      <div className="flex items-center text-sm mb-1">
        <a
          href={`/users/${post.ownedBy}`}
          onClick={(e) => e.stopPropagation()}
          aria-label="Show post owner detail"
        >
          <AvatarImg
            userId={post.ownedBy}
            nickname={post.ownerNickname}
            hasAvatar={true}
            size={32}
            className="-mt-1 -ml-1 mr-2 flex-shrink-0"
            version={avatarVersion}
          />
        </a>
        <a
          lang={postLang}
          className="-mt-1 text-lg text-slate-900 hover:text-blue-700 hover:underline min-w-[20ex] max-w-[48ex] truncate inline-block align-bottom max-md:min-w-[10ex]"
          href={`/users/${post.ownedBy}`}
          onClick={(e) => e.stopPropagation()}
        >
          {post.ownerNickname}
        </a>
        {post.replyTo && (
          <span className="-mt-1 ml-2 text-xs text-gray-500">
            In response to{" "}
            {!post.replyToOwnerNickname ? (
              <span className="text-gray-400">[{post.replyTo}:deleted]</span>
            ) : (
              <a
                lang={postLang}
                href={`/posts/${post.replyTo}`}
                className="text-blue-500 hover:underline max-w-[32ex] truncate inline-block align-bottom"
                onClick={(e) => e.stopPropagation()}
              >
                {post.replyToOwnerNickname}
              </a>
            )}
          </span>
        )}
        <span className="relative -mt-1 pr-1 ml-auto text-gray-400 whitespace-nowrap max-md:text-[10px]">
          {formatDateTime(new Date(post.createdAt))}
          {post.updatedAt && (
            <div className="absolute right-1 -translate-y-1 ml-1 text-[11px] text-gray-400 max-md:text-[9px]">
              ({formatDateTime(new Date(post.updatedAt))})
            </div>
          )}
        </span>
      </div>

      <div
        ref={contentRef}
        lang={postLang}
        className={`markdown-body post-content${truncated ? " excerpt" : ""}`}
        style={{ minHeight: 36, userSelect: "text" }}
        dangerouslySetInnerHTML={{ __html: bodyHtml }}
      />

      <PrismHighlighter root={contentRef.current} deps={prismDeps} />

      <div className="mt-1 flex items-center gap-2 text-xs text-gray-600">
        {(showPublishedLabel || (post.tags && post.tags.length > 0)) && (
          <div>
            {showPublishedLabel && (
              <a
                href={`/pub/${post.id}`}
                className="inline-block bg-gray-100 rounded px-2 py-0.5 mr-1 text-green-700 hover:bg-green-200"
                onClick={(e) => e.stopPropagation()}
              >
                published
              </a>
            )}
            {post.tags &&
              post.tags.map((tag) => (
                <a
                  key={tag}
                  lang={postLang}
                  href={`/posts?q=${encodeURIComponent("#" + tag)}&includingReplies=1`}
                  className="inline-block bg-gray-100 rounded px-2 py-0.5 mr-1 text-blue-700 hover:bg-blue-200"
                  onClick={(e) => e.stopPropagation()}
                >
                  #{tag}
                </a>
              ))}
          </div>
        )}

        {showActions && (
          <div className="ml-auto relative flex items-center gap-1">
            <button
              type="button"
              className="px-2 py-1 rounded-xl text-xs text-gray-700 border border-gray-200 bg-gray-50 hover:bg-gray-100 opacity-80 hover:opacity-100"
              aria-haspopup="menu"
              aria-expanded={menuOpen}
              onClick={(e) => {
                e.stopPropagation();
                setMenuOpen((v) => !v);
              }}
              onKeyDown={(e) => {
                if (e.key === "Escape") setMenuOpen(false);
              }}
              title="More actions"
            >
              ⋯
            </button>
            {menu}

            <button
              className={`flex items-center gap-1 px-2 py-1 rounded cursor-pointer
                ${post.isLikedByFocusUser ? "bg-pink-100 text-pink-600" : "hover:bg-gray-100"}
                disabled:opacity-40 disabled:cursor-not-allowed`}
              onClick={(e) => {
                e.stopPropagation();
                onLike?.(post as Post);
              }}
              type="button"
              aria-label={post.isLikedByFocusUser ? "Unlike" : "Like"}
              disabled={!post.allowLikes || isBlockedForFocusUser}
              title={
                !post.allowLikes
                  ? "Likes are disabled by the author"
                  : isBlockedForFocusUser
                    ? "You cannot like this post"
                    : undefined
              }
            >
              {post.isLikedByFocusUser ? <Heart fill="currentColor" size={18} /> : <Heart size={18} />}
              <span>{post.countLikes}</span>
            </button>

            <button
              onClick={(e) => {
                e.stopPropagation();
                onReply?.(post as Post);
              }}
              type="button"
              aria-label="Reply"
              disabled={!post.allowReplies || isBlockedForFocusUser}
              title={
                !post.allowReplies
                  ? "Replies are disabled by the author"
                  : isBlockedForFocusUser
                    ? "You cannot reply to this post"
                    : undefined
              }
              className={`flex items-center gap-1 px-2 py-1 rounded
                ${post.isRepliedByFocusUser ? "bg-blue-100 text-blue-600" : "hover:bg-gray-100"}
                disabled:opacity-40 disabled:cursor-not-allowed`}
            >
              <MessageCircle size={18} />
              <span>{post.countReplies}</span>
            </button>
          </div>
        )}
      </div>

      {isReplying && children}

      {pubDialogOpen && (
        <div
          className="fixed inset-0 z-30 flex items-center justify-center"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setPubDialogOpen(false);
            e.stopPropagation();
          }}
          onClick={(e) => e.stopPropagation()}
          onKeyDown={(e) => e.stopPropagation()}
          role="dialog"
          aria-modal="true"
          aria-label="Configure external publication"
        >
          <div className="absolute inset-0 bg-black/30" />
          <div
            className="relative z-40 w-full max-w-md rounded-lg border bg-white p-4 shadow-lg"
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => e.stopPropagation()}
          >
            <h2 className="text-lg font-semibold mb-3">External publication</h2>
            <label className="flex items-center gap-2 mb-3">
              <input
                type="checkbox"
                checked={pubChecked}
                onChange={(e) => setPubChecked(e.target.checked)}
              />
              <span>Publish this post</span>
            </label>
            <label className="block text-sm text-gray-700 mb-1">Published at</label>
            <input
              type="datetime-local"
              className="w-full border rounded px-2 py-1 mb-2"
              value={pubInput}
              onChange={(e) => setPubInput(e.target.value)}
              disabled={!pubChecked}
            />
            {pubError && <div className="text-red-600 text-sm mb-2">{pubError}</div>}
            <div className="mt-3 flex justify-end gap-2">
              <button
                className="px-3 py-1 rounded border bg-gray-50 hover:bg-gray-100"
                onClick={() => setPubDialogOpen(false)}
                type="button"
              >
                Cancel
              </button>
              <button
                className="px-3 py-1 rounded border border-blue-600 bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"
                onClick={applyPublication}
                disabled={applying}
                type="button"
              >
                Apply
              </button>
            </div>
          </div>
        </div>
      )}
    </article>
  );
}
