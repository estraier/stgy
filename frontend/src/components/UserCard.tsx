"use client";

import { useEffect, useState, useRef } from "react";
import Image from "next/image";
import type { User, UserDetail } from "@/api/models";
import { addFollow, removeFollow, addBlock, removeBlock } from "@/api/users";
import AvatarImg from "@/components/AvatarImg";
import { formatDateTime, normalizeLinefeeds } from "@/utils/format";
import { makeArticleHtmlFromMarkdown, makeHtmlFromJsonSnippet } from "@/utils/article";
import { Config } from "@/config";

type UserCardProps = {
  user: User | UserDetail;
  truncated?: boolean;
  className?: string;
  onClick?: (user: User | UserDetail) => void;
  focusUserId?: string;
  clickable?: boolean;
};

export default function UserCard({
  user: initialUser,
  truncated = true,
  className = "",
  onClick,
  focusUserId,
  clickable = true,
}: UserCardProps) {
  const [hovering, setHovering] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [blockingSubmitting, setBlockingSubmitting] = useState(false);
  const [user, setUser] = useState<User | UserDetail>(initialUser);
  const [avatarExpanded, setAvatarExpanded] = useState(false);
  const [blockedByTarget, setBlockedByTarget] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    setUser(initialUser);
    setBlockedByTarget(false);
    setMenuOpen(false);
  }, [initialUser]);

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

  const isAdmin = user.isAdmin;
  const blockStrangers = !!user.blockStrangers;
  const isAI = !!(user.aiModel && user.aiModel.trim() !== "");
  const isSelf = !!(focusUserId && user.id === focusUserId);
  const isFollowing = !!user.isFollowedByFocusUser;
  const isFollowed = !!user.isFollowingFocusUser;
  const isFriend = isFollowing && isFollowed;
  const isFollower = isFollowed && !isFollowing;
  const isFollowee = isFollowing && !isFollowed;
  const isBlocking = !!user.isBlockedByFocusUser;
  const isBlocked = !!user.isBlockingFocusUser;

  const userLang =
    "locale" in user && typeof user.locale === "string" && user.locale.trim() !== ""
      ? user.locale
      : undefined;

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

  let followButton: React.ReactNode = null;
  if (!isSelf) {
    if (isFollowing) {
      followButton = (
        <button
          className="ml-2 px-2 py-1 bg-blue-100 text-blue-600 rounded text-xs border border-blue-200 hover:bg-red-100 hover:text-red-700 transition max-md:scale-x-80 max-md:ml-0 max-md:-mr-2"
          onMouseEnter={() => setHovering(true)}
          onMouseLeave={() => setHovering(false)}
          onClick={async (e) => {
            e.stopPropagation();
            if (submitting) return;
            setSubmitting(true);
            try {
              await removeFollow(user.id);
              setUser({ ...user, isFollowedByFocusUser: false });
            } finally {
              setSubmitting(false);
            }
          }}
          disabled={submitting}
        >
          {hovering ? "Unfollow" : "Following"}
        </button>
      );
    } else if (!(isBlocked || blockedByTarget || (blockStrangers && !isFollowed))) {
      followButton = (
        <button
          className="ml-2 px-2 py-1 bg-blue-600 text-white rounded text-xs border border-blue-700 hover:bg-blue-700 transition max-md:scale-x-80 max-md:ml-0 max-md:-mr-2"
          onClick={async (e) => {
            e.stopPropagation();
            if (submitting) return;
            setSubmitting(true);
            try {
              await addFollow(user.id);
              setUser({ ...user, isFollowedByFocusUser: true });
            } catch (err: unknown) {
              const msg = err instanceof Error ? err.message : String(err);
              if (/block/i.test(msg)) {
                setBlockedByTarget(true);
              }
            } finally {
              setSubmitting(false);
            }
          }}
          disabled={submitting}
        >
          Follow
        </button>
      );
    }
  }

  function handleCardClick(_e: React.MouseEvent | React.KeyboardEvent) {
    if (!clickable) return;
    if (typeof window !== "undefined" && window.getSelection()?.toString()) return;
    onClick?.(user);
  }

  const hasIntro = "introduction" in user && typeof user.introduction === "string";
  const introHtml = hasIntro ? makeArticleHtmlFromMarkdown(user.introduction as string) : "";
  const snippetHtml = makeHtmlFromJsonSnippet(user.snippet || "[]");

  const masterSrc = (() => {
    if (!user.avatar) return "";
    const p = user.avatar.replace(/^\/+/, "");
    const i = p.indexOf("/");
    if (i <= 0) return "";
    const bucket = p.slice(0, i);
    const key = p.slice(i + 1);
    const prefix = Config.STORAGE_S3_PUBLIC_URL_PREFIX.replace("{bucket}", bucket);
    const suffix =
      user.updatedAt != null && String(user.updatedAt) !== ""
        ? `?v=${encodeURIComponent(String(user.updatedAt))}`
        : "";
    return `${prefix}${key}${suffix}`;
  })();

  const menu = (
    <div
      ref={menuRef}
      className={`absolute right-0 top-full mt-1 w-56 rounded-md border bg-white shadow-lg z-20 ${menuOpen ? "block" : "hidden"}`}
      onClick={(e) => e.stopPropagation()}
    >
      <button
        className="w-full text-left px-3 py-2 text-sm text-gray-700 hover:bg-gray-100 rounded"
        onClick={async () => {
          const url = absoluteUrl(`/users/${user.id}`);
          await copyToClipboard(url);
          setMenuOpen(false);
        }}
      >
        Copy link to profile
      </button>
      <button
        className="w-full text-left px-3 py-2 text-sm text-gray-700 hover:bg-gray-100 rounded"
        onClick={async () => {
          const md = `[@${user.nickname}](/users/${user.id})`;
          await copyToClipboard(md);
          setMenuOpen(false);
        }}
      >
        Copy mention Markdown
      </button>
      {!isSelf && (
        <button
          className="w-full text-left px-3 py-2 text-sm text-gray-700 hover:bg-gray-100 rounded disabled:opacity-50"
          disabled={blockingSubmitting}
          onClick={async () => {
            if (blockingSubmitting) return;
            setBlockingSubmitting(true);
            try {
              if (isBlocking) {
                await removeBlock(user.id);
                setUser({ ...user, isBlockedByFocusUser: false });
              } else {
                await addBlock(user.id);
                setUser({ ...user, isBlockedByFocusUser: true });
              }
            } finally {
              setBlockingSubmitting(false);
              setMenuOpen(false);
            }
          }}
        >
          {isBlocking ? "Unblock this user" : "Block this user"}
        </button>
      )}
    </div>
  );

  return (
    <article
      className={`p-2 pt-3 sm:p-4 sm:pt-4 border rounded shadow-sm bg-white ${clickable ? "cursor-pointer" : ""} ${className}`}
      onClick={clickable ? handleCardClick : undefined}
      tabIndex={clickable ? 0 : -1}
      role={clickable ? "button" : undefined}
      aria-label={clickable ? "Show user detail" : undefined}
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
      <div className="flex items-center text-base font-semibold">
        {truncated ? (
          <AvatarImg
            userId={user.id}
            nickname={user.nickname}
            hasAvatar={!!user.avatar}
            size={32}
            version={user.updatedAt}
            className="-mt-2 -ml-1 mr-2 flex-shrink-0"
          />
        ) : (
          <button
            type="button"
            className="-mt-2 -ml-1 mr-2 flex-shrink-0 rounded-lg focus:outline-none"
            onClick={(e) => {
              e.stopPropagation();
              if (user.avatar) setAvatarExpanded((v) => !v);
            }}
            aria-pressed={avatarExpanded}
            title={user.avatar ? "Toggle large avatar" : "No avatar"}
          >
            <AvatarImg
              userId={user.id}
              nickname={user.nickname}
              hasAvatar={!!user.avatar}
              size={64}
              version={user.updatedAt}
            />
          </button>
        )}

        <span
          lang={userLang}
          className={`-mt-1 truncate max-w-[24ex] text-slate-900 ${truncated ? "text-base" : "text-xl px-2"}`}
        >
          {user.nickname}
        </span>
        {isAdmin && (
          <span className="-mt-1 ml-2 px-2 py-1 bg-gray-300 text-gray-800 rounded text-xs opacity-90 max-md:text-[9px] max-md:px-1">
            admin
          </span>
        )}
        {blockStrangers && (
          <span className="-mt-1 ml-2 px-2 py-1 bg-gray-200 text-gray-700 rounded text-xs opacity-90 max-md:text-[9px] max-md:ml-1 max-md:px-1">
            BS
          </span>
        )}
        {isAI && (
          <span className="-mt-1 ml-2 px-2 py-1 bg-gray-200 text-gray-700 rounded text-xs opacity-90 max-md:text-[9px] max-md:ml-1 max-md:px-1">
            AI
          </span>
        )}
        {isSelf && (
          <span className="-mt-1 ml-2 px-2 py-1 bg-green-100 text-green-800 rounded text-xs opacity-90 max-md:text-[9px] max-md:ml-1 max-md:px-1">
            self
          </span>
        )}
        {isFriend && (
          <span className="-mt-1 ml-2 px-2 py-1 bg-purple-100 text-purple-700 rounded text-xs opacity-90 max-md:text-[9px] max-md:ml-1 max-md:px-1">
            friend
          </span>
        )}
        {isFollower && (
          <span className="-mt-1 ml-2 px-2 py-1 bg-pink-100 text-pink-800 rounded text-xs opacity-90 max-md:text-[9px] max-md:ml-1 max-md:px-1">
            follower
          </span>
        )}
        {isFollowee && (
          <span className="-mt-1 ml-2 px-2 py-1 bg-blue-100 text-blue-800 rounded text-xs opacity-90 max-md:text-[9px] max-md:ml-1 max-md:px-1">
            followee
          </span>
        )}
        {isBlocking && isBlocked && (
          <span className="-mt-1 ml-2 px-2 py-1 bg-gray-100 text-gray-700 rounded text-xs opacity-90 max-md:text-[9px] max-md:ml-1 max-md:px-1">
            break
          </span>
        )}
        {isBlocked && !isBlocking && (
          <span className="-mt-1 ml-2 px-2 py-1 bg-gray-100 text-gray-700 rounded text-xs opacity-90 max-md:text-[9px] max-md:ml-1 max-md:px-1">
            blocker
          </span>
        )}
        {isBlocking && !isBlocked && (
          <span className="-mt-1 ml-2 px-2 py-1 bg-gray-100 text-gray-700 rounded text-xs opacity-90 max-md:text-[9px] max-md:ml-1 max-md:px-1">
            blockee
          </span>
        )}
        <div className="ml-auto relative flex items-center gap-1">
          <button
            type="button"
            className="px-2 py-1 rounded-xl text-xs text-gray-700 border border-gray-200 bg-gray-50 hover:bg-gray-100 opacity-80 hover:opacity-100 max-md:scale-x-80 max-md:ml-0 max-md:-mr-2"
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
          {followButton}
        </div>
      </div>

      {!truncated && avatarExpanded && user.avatar && (
        <div
          className="mt-3 p-2 border rounded-lg bg-gray-50 inline-block focus:outline-none"
          onMouseDown={(e) => e.preventDefault()}
          onClick={(e) => {
            e.stopPropagation();
            setAvatarExpanded(false);
          }}
          role="button"
          aria-label="Close large avatar"
          title="Click to close"
        >
          <div className="mt-3 p-2 border rounded-lg bg-gray-50 inline-block">
            <Image
              src={masterSrc}
              alt={`${user.nickname}'s avatar`}
              width={600}
              height={600}
              className="rounded-lg object-contain"
              priority
              unoptimized
            />
          </div>
        </div>
      )}

      <div
        lang={userLang}
        className={`markdown-body user-introduction${truncated ? " excerpt" : ""}`}
        dangerouslySetInnerHTML={{
          __html: truncated ? snippetHtml : introHtml || snippetHtml,
        }}
      />

      {!truncated && user.aiModel && user.aiModel.trim() !== "" && (
        <div className="text-xs text-gray-600 mt-2">
          <div className="font-semibold">AI Model:</div>
          <div className="pl-2">{user.aiModel}</div>
        </div>
      )}

      {!truncated &&
        "aiPersonality" in user &&
        user.aiPersonality &&
        user.aiPersonality.trim() !== "" && (
          <div className="text-xs text-gray-600 mt-2">
            <div className="font-semibold">AI Personality:</div>
            <div lang={userLang} className="pl-2 whitespace-pre-line">
              {normalizeLinefeeds(user.aiPersonality)}
            </div>
          </div>
        )}

      {!truncated && (
        <div className="text-xs text-gray-500 mt-2">
          <div className="font-semibold">Created:</div>
          <div className="pl-2">{formatDateTime(new Date(user.createdAt))}</div>
        </div>
      )}
      {!truncated && user.updatedAt && (
        <div className="text-xs text-gray-500 mt-2">
          <div className="font-semibold">Updated:</div>
          <div className="pl-2">{formatDateTime(new Date(user.updatedAt))}</div>
        </div>
      )}
      {"countFollowers" in user && (
        <div className="text-xs text-gray-500 mt-2">
          <span className="gap-1">followers: {user.countFollowers}</span>
          <span className="ml-2">followees: {user.countFollowees}</span>
          <span className="ml-2">posts: {user.countPosts}</span>
        </div>
      )}
    </article>
  );
}
