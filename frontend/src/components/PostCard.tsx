"use client";

import { Config } from "@/config";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { useRef, useMemo, useEffect, useState, useCallback } from "react";
import PrismHighlighter from "@/components/PrismHighlighter";
import type { Post, PostDetail } from "@/api/models";
import AvatarImg from "@/components/AvatarImg";
import { Heart, MessageCircle, Copy } from "lucide-react";
import { formatDateTime } from "@/utils/format";
import {
  makeArticleHtmlFromMarkdown,
  makeArticleTextFromMarkdown,
  makeHtmlFromJsonSnippet,
  makeSnippetTextFromMarkdown,
} from "@/utils/article";
import { convertHtmlMathInline } from "@/utils/mathjax-inline";
import { updatePost, getPost } from "@/api/posts";
import { getAiPostSummary as getPostSummary } from "@/api/aiPost";

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
  idPrefix?: string;
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
  idPrefix,
}: PostCardProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const contentRef = useRef<HTMLDivElement | null>(null);
  const hasContent =
    "content" in post && typeof post.content === "string" && post.content.length > 0;

  const bodyHtml = convertHtmlMathInline(
    !truncated && hasContent
      ? makeArticleHtmlFromMarkdown((post as PostDetail).content)
      : makeHtmlFromJsonSnippet(post.snippet, idPrefix),
  );

  const prismDeps = useMemo(() => [bodyHtml], [bodyHtml]);

  const isBlockedForFocusUser = Boolean(
    (post as { isBlockingFocusUser?: boolean }).isBlockingFocusUser,
  );
  const postLang = typeof post.locale === "string" ? post.locale : post.ownerLocale;
  const [publishedAtLocal, setPublishedAtLocal] = useState<Post["publishedAt"]>(
    (post.publishedAt ?? null) as Post["publishedAt"],
  );

  useEffect(() => {
    setPublishedAtLocal((post.publishedAt ?? null) as Post["publishedAt"]);
  }, [post]);

  const [contentCache, setContentCache] = useState<string | null>(
    hasContent ? (post as PostDetail).content : null,
  );
  useEffect(() => {
    setContentCache(hasContent ? (post as PostDetail).content : null);
  }, [hasContent, post]);

  const ensureContent = useCallback(async (): Promise<string | null> => {
    if (typeof contentCache === "string") return contentCache;
    try {
      const full = await getPost(post.id, focusUserId);
      setContentCache(full.content);
      return full.content;
    } catch {
      return null;
    }
  }, [contentCache, post.id, focusUserId]);

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

  function absoluteUrl(path: string): string {
    if (typeof window !== "undefined" && window.location) {
      const base = window.location.origin.replace(/\/+$/, "");
      return `${base}${path.startsWith("/") ? "" : "/"}${path}`;
    }
    return path.startsWith("/") ? path : `/${path}`;
  }

  async function copyHtmlRich(html: string, plainFallback?: string) {
    try {
      if (
        typeof navigator !== "undefined" &&
        "clipboard" in navigator &&
        typeof ClipboardItem !== "undefined"
      ) {
        const item = new ClipboardItem({
          "text/html": new Blob([html], { type: "text/html" }),
          "text/plain": new Blob([plainFallback ?? html.replace(/<[^>]*>/g, "")], {
            type: "text/plain",
          }),
        });
        await navigator.clipboard.write([item]);
        return;
      }
    } catch {}
    try {
      let ok = false;
      const onCopy = (e: ClipboardEvent) => {
        if (e.clipboardData) {
          e.clipboardData.setData("text/html", html);
          e.clipboardData.setData("text/plain", plainFallback ?? html.replace(/<[^>]*>/g, ""));
          e.preventDefault();
          ok = true;
        }
      };
      document.addEventListener("copy", onCopy, { once: true });
      const sel = window.getSelection();
      const range = document.createRange();
      const div = document.createElement("div");
      div.style.position = "fixed";
      div.style.left = "-9999px";
      div.setAttribute("contenteditable", "true");
      div.innerHTML = html;
      document.body.appendChild(div);
      range.selectNodeContents(div);
      sel?.removeAllRanges();
      sel?.addRange(range);
      document.execCommand("copy");
      sel?.removeAllRanges();
      document.body.removeChild(div);
      document.removeEventListener("copy", onCopy);
      if (ok) return;
    } catch {}
    try {
      await navigator.clipboard.writeText(plainFallback ?? html.replace(/<[^>]*>/g, ""));
    } catch {}
  }

  const [menuOpen, setMenuOpen] = useState(false);
  const [copyMenuOpen, setCopyMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const copyMenuRef = useRef<HTMLDivElement | null>(null);

  const [aiSummaryOpen, setAiSummaryOpen] = useState(false);
  const [aiSummaryLoading, setAiSummaryLoading] = useState(false);
  const [aiSummaryText, setAiSummaryText] = useState<string | null>(null);
  const [aiSummaryTags, setAiSummaryTags] = useState<string[]>([]);

  const urlKey = useMemo(() => {
    const qs = searchParams.toString();
    return qs ? `${pathname}?${qs}` : pathname;
  }, [pathname, searchParams]);

  useEffect(() => {
    setAiSummaryOpen(false);
    setAiSummaryLoading(false);
    setAiSummaryText(null);
    setAiSummaryTags([]);
  }, [post.id, urlKey]);

  useEffect(() => {
    function onDocMouseDown(e: MouseEvent) {
      const t = e.target as Node;
      if (menuOpen && menuRef.current && !menuRef.current.contains(t)) {
        setMenuOpen(false);
      }
      if (copyMenuOpen && copyMenuRef.current && !copyMenuRef.current.contains(t)) {
        setCopyMenuOpen(false);
      }
    }
    document.addEventListener("mousedown", onDocMouseDown);
    return () => document.removeEventListener("mousedown", onDocMouseDown);
  }, [menuOpen, copyMenuOpen]);

  const isOwner = focusUserId && focusUserId === post.ownedBy;
  const canConfigurePublication = Boolean(isOwner || focusUserIsAdmin);

  const isOnSelfDetailPage = pathname === `/posts/${post.id}`;
  const isAlreadyEditMode = isOnSelfDetailPage && searchParams.get("mode") === "edit";

  const skipLatestMs =
    typeof Config.AI_SUMMARY_POST_SKIP_LATEST_MS === "number"
      ? Config.AI_SUMMARY_POST_SKIP_LATEST_MS
      : 0;
  const cutoffMs = Date.now() - skipLatestMs;
  const createdAtMs = new Date(post.createdAt).getTime();
  const updatedAtMs = post.updatedAt ? new Date(post.updatedAt).getTime() : null;

  const isTooNewForSummary =
    (!Number.isNaN(createdAtMs) && createdAtMs > cutoffMs) ||
    (updatedAtMs !== null && !Number.isNaN(updatedAtMs) && updatedAtMs > cutoffMs);

  const canShowAiSummaryMenu = !isTooNewForSummary;

  const handleCopyMarkdown = useCallback(async () => {
    const content = await ensureContent();
    if (content !== null) {
      await copyToClipboard(content);
    }
    setCopyMenuOpen(false);
  }, [ensureContent]);

  const handleCopyPlain = useCallback(async () => {
    const content = await ensureContent();
    if (content !== null) {
      const plain = makeArticleTextFromMarkdown(content);
      await copyToClipboard(plain);
    } else {
      const plain = bodyHtml.replace(/<[^>]*>/g, "");
      await copyToClipboard(plain);
    }
    setCopyMenuOpen(false);
  }, [ensureContent, bodyHtml]);

  const handleCopyHtml = useCallback(async () => {
    const content = await ensureContent();
    if (content !== null) {
      const html = convertHtmlMathInline(makeArticleHtmlFromMarkdown(content, false, idPrefix));
      const plain = makeSnippetTextFromMarkdown(content, Number.MAX_SAFE_INTEGER);
      await copyHtmlRich(html, plain);
    } else {
      const html = convertHtmlMathInline(makeHtmlFromJsonSnippet(post.snippet, idPrefix));
      await copyHtmlRich(html);
    }
    setCopyMenuOpen(false);
  }, [ensureContent, idPrefix, post.snippet]);

  const handleViewHtml = useCallback(async () => {
    const content = await ensureContent();
    const html =
      content !== null
        ? convertHtmlMathInline(makeArticleHtmlFromMarkdown(content, false, idPrefix))
        : convertHtmlMathInline(makeHtmlFromJsonSnippet(post.snippet, idPrefix));

    const doc =
      '<!doctype html><html><head><meta charset="utf-8">' +
      '<meta name="viewport" content="width=device-width,initial-scale=1">' +
      "<title>Content HTML</title></head><body>" +
      html +
      "</body></html>";

    const blob = new Blob([doc], { type: "text/html" });
    const url = URL.createObjectURL(blob);
    window.open(url, "_blank", "noopener");
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
    setCopyMenuOpen(false);
  }, [ensureContent, idPrefix, post.snippet]);

  function handleCardClick(_e: React.MouseEvent | React.KeyboardEvent) {
    if (!clickable) return;
    if (typeof window !== "undefined" && window.getSelection()?.toString()) return;
    router.push(`/posts/${post.id}`);
  }

  const pad2 = useCallback((n: number) => (n < 10 ? `0${n}` : String(n)), []);

  const toLocalInputValue = useCallback(
    (d: Date) => {
      const y = d.getFullYear();
      const m = pad2(d.getMonth() + 1);
      const day = pad2(d.getDate());
      const hh = pad2(d.getHours());
      const mm = pad2(d.getMinutes());
      return `${y}-${m}-${day}T${hh}:${mm}`;
    },
    [pad2],
  );

  const toOffsetString = useCallback(
    (d: Date) => {
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
    },
    [pad2],
  );

  const [pubDialogOpen, setPubDialogOpen] = useState(false);
  const [pubChecked, setPubChecked] = useState(false);
  const [pubInput, setPubInput] = useState("");
  const [pubError, setPubError] = useState("");
  const [applying, setApplying] = useState(false);

  useEffect(() => {
    if (!pubDialogOpen) return;
    const has = typeof publishedAtLocal === "string" && publishedAtLocal.trim() !== "";
    setPubChecked(has);
    const base = has ? new Date(publishedAtLocal as string) : new Date();
    setPubInput(toLocalInputValue(base));
    setPubError("");
  }, [publishedAtLocal, pubDialogOpen, toLocalInputValue]);

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

  const effectivePublishedAt = publishedAtLocal;
  const showPublishedLabel =
    typeof effectivePublishedAt === "string" &&
    effectivePublishedAt.trim() !== "" &&
    new Date(effectivePublishedAt).getTime() <= Date.now();

  const copyMenu = (
    <div
      ref={copyMenuRef}
      className={`absolute right-0 top-full mt-1 w-56 rounded-md border bg-white shadow-lg z-20 ${
        copyMenuOpen ? "block" : "hidden"
      }`}
      onClick={(e) => e.stopPropagation()}
    >
      <button
        className="w-full text-left px-3 py-2 text-sm text-gray-700 hover:bg-gray-100 rounded"
        onClick={handleCopyMarkdown}
      >
        Copy content Markdown
      </button>
      <button
        className="w-full text-left px-3 py-2 text-sm text-gray-700 hover:bg-gray-100 rounded"
        onClick={handleCopyPlain}
      >
        Copy content plaintext
      </button>
      <button
        className="w-full text-left px-3 py-2 text-sm text-gray-700 hover:bg-gray-100 rounded"
        onClick={handleCopyHtml}
      >
        Copy content HTML
      </button>
      <button
        className="w-full text-left px-3 py-2 text-sm text-gray-700 hover:bg-gray-100 rounded"
        onClick={handleViewHtml}
      >
        View content HTML
      </button>
    </div>
  );

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
          const url = absoluteUrl(`/posts/${post.id}`);
          await copyToClipboard(url);
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

      {canShowAiSummaryMenu && (
        <>
          <button
            className="w-full text-left px-3 py-2 text-sm text-gray-700 hover:bg-gray-100 rounded"
            onClick={async () => {
              setMenuOpen(false);
              setAiSummaryOpen(true);
              setAiSummaryLoading(true);
              setAiSummaryText(null);
              setAiSummaryTags([]);
              try {
                const s = await getPostSummary(post.id);
                const txt =
                  s && typeof (s as { summary?: unknown }).summary === "string"
                    ? ((s as { summary: string }).summary ?? "").trim()
                    : "";
                const tags =
                  s && Array.isArray((s as { tags?: unknown }).tags)
                    ? ((s as { tags: string[] }).tags ?? []).filter((t) => typeof t === "string")
                    : [];
                setAiSummaryText(txt.length > 0 ? txt : null);
                setAiSummaryTags(tags);
              } catch (e) {
                console.error(e);
                setAiSummaryText(null);
                setAiSummaryTags([]);
              } finally {
                setAiSummaryLoading(false);
              }
            }}
          >
            View AI summary
          </button>

          <button
            className="w-full text-left px-3 py-2 text-sm text-gray-700 hover:bg-gray-100 rounded"
            onClick={() => {
              setMenuOpen(false);
              router.push(`/posts?q=${encodeURIComponent("~" + post.id)}`);
            }}
          >
            Search for similar posts
          </button>
        </>
      )}

      {canConfigurePublication && (
        <button
          className="w-full text-left px-3 py-2 text-sm text-gray-700 hover:bg-gray-100 rounded"
          onClick={() => {
            const href = `/posts/${post.id}?mode=edit`;
            if (isAlreadyEditMode) {
              setMenuOpen(false);
              return;
            }
            if (isOnSelfDetailPage) {
              router.push(href, { scroll: false });
            } else {
              router.push(href);
            }
            setMenuOpen(false);
          }}
        >
          Edit this post
        </button>
      )}

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

  const aiSummarySection = aiSummaryOpen ? (
    <div className="mt-3 border rounded bg-white shadow-sm">
      <div className="px-3 py-2 text-sm text-gray-800 whitespace-pre-wrap">
        {aiSummaryLoading ? (
          <span className="text-gray-500">Loading...</span>
        ) : aiSummaryText ? (
          aiSummaryText
        ) : (
          <span className="text-gray-500">No summary yet.</span>
        )}
        {!aiSummaryLoading && aiSummaryTags.length > 0 && (
          <div className="mt-2 text-xs text-gray-600 whitespace-normal">
            {aiSummaryTags.map((tag) => (
              <a
                key={tag}
                lang={postLang}
                href={`/posts?q=${encodeURIComponent("#" + tag)}&includingReplies=1`}
                className="inline-block bg-gray-100 rounded px-2 py-0.5 mr-1 text-blue-700 hover:bg-[#e0eafa]"
                onClick={(e) => e.stopPropagation()}
              >
                #{tag}
              </a>
            ))}
          </div>
        )}
      </div>
    </div>
  ) : null;

  return (
    <article
      className={`p-2 sm:pt-4 sm:pb-2 sm:pl-4 sm:pr-3 border rounded bg-white shadow-sm ${
        clickable ? "cursor-pointer" : ""
      } ${className}`}
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
          lang={post.ownerLocale}
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
                className="inline-block bg-gray-100 rounded px-2 py-0.5 mr-1 text-green-700 hover:bg-[#e8f4e8]"
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
                  className="inline-block bg-gray-100 rounded px-2 py-0.5 mr-1 text-blue-700 hover:bg-[#e0eafa]"
                  onClick={(e) => e.stopPropagation()}
                >
                  #{tag}
                </a>
              ))}
          </div>
        )}

        {showActions && (
          <div className="ml-auto flex items-center gap-1">
            <div className="relative">
              <button
                type="button"
                className="px-2 py-1 rounded-xl text-xs text-gray-700 border border-gray-300 bg-gray-50 hover:bg-gray-100 opacity-80 hover:opacity-100"
                aria-haspopup="menu"
                aria-expanded={copyMenuOpen}
                onClick={(e) => {
                  e.stopPropagation();
                  setCopyMenuOpen((v) => !v);
                  if (menuOpen) setMenuOpen(false);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Escape") setCopyMenuOpen(false);
                }}
                title="Copy content"
              >
                <Copy size={16} className="opacity-60" />
              </button>
              {copyMenu}
            </div>

            <div className="relative">
              <button
                type="button"
                className="px-2 py-1 rounded-xl text-xs text-gray-700 border border-gray-300 bg-gray-50 hover:bg-gray-100 opacity-80 hover:opacity-100"
                aria-haspopup="menu"
                aria-expanded={menuOpen}
                onClick={(e) => {
                  e.stopPropagation();
                  setMenuOpen((v) => !v);
                  if (copyMenuOpen) setCopyMenuOpen(false);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Escape") setMenuOpen(false);
                }}
                title="More actions"
              >
                ⋯
              </button>
              {menu}
            </div>

            <button
              className={`flex items-center gap-1 pr-1 pl-2 py-1 rounded cursor-pointer
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
              className={`flex items-center gap-1 pr-1 pl-1 py-1 rounded
                ${post.isRepliedByFocusUser ? "bg-blue-100 text-blue-600" : "hover:bg-gray-100"}
                disabled:opacity-40 disabled:cursor-not-allowed`}
            >
              <MessageCircle size={18} />
              <span>{post.countReplies}</span>
            </button>
          </div>
        )}
      </div>

      {aiSummarySection}

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
              className="w-full border border-gray-600 rounded px-2 py-1 mb-2 disabled:text-gray-400"
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
