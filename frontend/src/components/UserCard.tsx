"use client";

import { useEffect, useState } from "react";
import type { User, UserDetail } from "@/api/models";
import AvatarImg from "@/components/AvatarImg";
import { formatDateTime, normalizeLinefeeds } from "@/utils/format";
import { makeArticleHtmlFromMarkdown, makeHtmlFromJsonSnippet } from "@/utils/article";

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
  const [user, setUser] = useState<User | UserDetail>(initialUser);
  const [avatarExpanded, setAvatarExpanded] = useState(false);

  useEffect(() => {
    setUser(initialUser);
  }, [initialUser]);

  const isAdmin = user.isAdmin;
  const isAI = !!(user.aiModel && user.aiModel.trim() !== "");
  const isSelf = !!(focusUserId && user.id === focusUserId);
  const isFollowing = !!user.isFollowedByFocusUser;
  const isFollowed = !!user.isFollowingFocusUser;
  const isFriend = isFollowing && isFollowed;
  const isFollower = isFollowed && !isFollowing;
  const isFollowee = isFollowing && !isFollowed;

  let followButton: React.ReactNode = null;
  if (!isSelf) {
    if (isFollowing) {
      followButton = (
        <button
          className="ml-2 px-2 py-1 bg-blue-100 text-blue-600 rounded text-xs border border-blue-200 hover:bg-red-100 hover:text-red-700 transition"
          onMouseEnter={() => setHovering(true)}
          onMouseLeave={() => setHovering(false)}
          onClick={async (e) => {
            e.stopPropagation();
            if (submitting) return;
            setSubmitting(true);
            try {
              await (await import("@/api/users")).removeFollower(user.id);
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
    } else {
      followButton = (
        <button
          className="ml-2 px-2 py-1 bg-blue-600 text-white rounded text-xs border border-blue-700 hover:bg-blue-700 transition"
          onClick={async (e) => {
            e.stopPropagation();
            if (submitting) return;
            setSubmitting(true);
            try {
              await (await import("@/api/users")).addFollower(user.id);
              setUser({ ...user, isFollowedByFocusUser: true });
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
            useThumb={true}
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
              useThumb={false}
              version={user.updatedAt}
              avatarPath={user.avatar || null}
            />
          </button>
        )}

        <span
          className={`-mt-1 truncate max-w-[24ex] text-slate-900 ${
            truncated ? "text-base" : "text-xl px-2"
          }`}
        >
          {user.nickname}
        </span>
        {isAdmin && (
          <span className="-mt-1 ml-2 px-2 py-1 bg-gray-300 text-gray-800 rounded text-xs opacity-90">
            admin
          </span>
        )}
        {isAI && (
          <span className="-mt-1 ml-2 px-2 py-1 bg-gray-200 text-gray-700 rounded text-xs opacity-90">
            AI
          </span>
        )}
        {isSelf && (
          <span className="-mt-1 ml-2 px-2 py-1 bg-green-100 text-green-800 rounded text-xs opacity-90">
            self
          </span>
        )}
        {isFriend && (
          <span className="-mt-1 ml-2 px-2 py-1 bg-purple-100 text-purple-700 rounded text-xs opacity-90">
            friend
          </span>
        )}
        {isFollower && (
          <span className="-mt-1 ml-2 px-2 py-1 bg-pink-100 text-pink-800 rounded text-xs opacity-90">
            follower
          </span>
        )}
        {isFollowee && (
          <span className="-mt-1 ml-2 px-2 py-1 bg-blue-100 text-blue-800 rounded text-xs opacity-90">
            followee
          </span>
        )}
        <span className="ml-auto">{followButton}</span>
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
          <AvatarImg
            userId={user.id}
            nickname={user.nickname}
            hasAvatar={!!user.avatar}
            size={480}
            useThumb={false}
            version={user.updatedAt}
            avatarPath={user.avatar || null}
            className="rounded-lg"
          />
        </div>
      )}

      <div
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

      {!truncated && "aiPersonality" in user && user.aiPersonality && user.aiPersonality.trim() !== "" && (
        <div className="text-xs text-gray-600 mt-2">
          <div className="font-semibold">AI Personality:</div>
          <div className="pl-2 whitespace-pre-line">{normalizeLinefeeds(user.aiPersonality)}</div>
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
