"use client";

import { useRouter } from "next/navigation";
import { useRef, useMemo, useState, useEffect } from "react";
import PrismHighlighter from "@/components/PrismHighlighter";
import type { Post, PostDetail } from "@/api/models";
import AvatarImg from "@/components/AvatarImg";
import { Heart, MessageCircle } from "lucide-react";
import { formatDateTime } from "@/utils/format";
import { makeArticleHtmlFromMarkdown, makeHtmlFromJsonSnippet } from "@/utils/article";
import { convertHtmlMathInline } from "@/utils/mathjax-inline";

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
}: PostCardProps) {
  const router = useRouter();
  const contentRef = useRef<HTMLDivElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);

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
          const url = `/posts/${post.id}`;
          await copyToClipboard(url);
          setMenuOpen(false);
        }}
      >
        Copy link to this post
      </button>
      <button
        className="w-full text-left px-3 py-2 text-sm text-gray-700 hover:bg-gray-100 rounded"
        onClick={async () => {
          const md = `[post](/posts/${post.id})`;
          await copyToClipboard(md);
          setMenuOpen(false);
        }}
      >
        Copy mention Markdown
      </button>
    </div>
  );

  return (
    <article
      className={`p-2 sm:pt-4 sm:pb-2 sm:pl-4 sm:pr-3 border rounded bg-white shadow-sm ${clickable ? "cursor-pointer" : ""} ${className}`}
      onClick={clickable ? handleCardClick : undefined}
      tabIndex={clickable ? 0 : -1}
      role={clickable ? "button" : undefined}
      aria-label={clickable ? "Show post detail" : undefined}
      onKeyDown={
        clickable
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
        {post.tags && post.tags.length > 0 && (
          <div>
            {post.tags.map((tag) => (
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
          <div className="ml-auto flex items-center gap-2">
            <div className="relative">
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
              >
                ⋯
              </button>
              {menu}
            </div>

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
              {post.isLikedByFocusUser ? (
                <Heart fill="currentColor" size={18} />
              ) : (
                <Heart size={18} />
              )}
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
    </article>
  );
}
