"use client";

import { useEffect, useState } from "react";
import type { UserDetail } from "@/api/models";
import Identicon from "@/components/Identicon";
import { formatDateTime } from "@/utils/format";
import { renderBody } from "@/utils/markdown";

type UserCardProps = {
  user: UserDetail;
  truncated?: boolean;
  className?: string;
  onClick?: (user: UserDetail) => void;
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
  const [user, setUser] = useState(initialUser);

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

  return (
    <article
      className={`p-4 border rounded shadow-sm bg-white ${clickable ? "cursor-pointer" : ""} ${className}`}
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
        <Identicon
          value={user.id + ":" + user.nickname}
          size={24}
          className="-mt-2 -ml-1 rounded-full border bg-gray-100 mr-2 flex-shrink-0 opacity-80"
        />
        <span className="-mt-1 truncate max-w-[24ex] text-blue-700">{user.nickname}</span>
        {isAdmin && (
          <span className="-mt-1 ml-2 px-2 py-1 bg-gray-300 text-gray-800 rounded text-xs">
            admin
          </span>
        )}
        {isAI && (
          <span className="-mt-1 ml-2 px-2 py-1 bg-gray-200 text-gray-700 rounded text-xs">AI</span>
        )}
        {isSelf && (
          <span className="-mt-1 ml-2 px-2 py-1 bg-green-100 text-green-800 rounded text-xs">
            self
          </span>
        )}
        {isFriend && (
          <span className="-mt-1 ml-2 px-2 py-1 bg-purple-100 text-purple-700 rounded text-xs">
            friend
          </span>
        )}
        {isFollower && (
          <span className="-mt-1 ml-2 px-2 py-1 bg-pink-100 text-pink-800 rounded text-xs">
            follower
          </span>
        )}
        {isFollowee && (
          <span className="-mt-1 ml-2 px-2 py-1 bg-blue-100 text-blue-800 rounded text-xs">
            followee
          </span>
        )}
        <span className="ml-auto">{followButton}</span>
      </div>
      <div
        className="markdown-body user-introduction"
        dangerouslySetInnerHTML={{
          __html: truncated
            ? renderBody(user.introduction ?? "", 200, 10)
            : renderBody(user.introduction ?? ""),
        }}
      />
      {!truncated && user.aiModel && user.aiModel.trim() !== "" && (
        <div className="text-xs text-gray-600 mt-2">
          <div className="font-semibold">AI Model:</div>
          <div className="pl-2">{user.aiModel}</div>
        </div>
      )}
      {!truncated && user.aiPersonality && user.aiPersonality.trim() !== "" && (
        <div className="text-xs text-gray-600 mt-2">
          <div className="font-semibold">AI Personality:</div>
          <div className="pl-2">{user.aiPersonality}</div>
        </div>
      )}
      {!truncated && (
        <div className="text-xs text-gray-500 mt-2">
          <div className="font-semibold">Created:</div>
          <div className="pl-2">{formatDateTime(new Date(user.createdAt))}</div>
        </div>
      )}
      {"countFollowers" in user && (
        <div className="text-xs text-gray-500 mt-2">
          <span className="gap-1">followers: {user.countFollowers}</span>
          <span className="ml-2">followees: {user.countFollowees}</span>
        </div>
      )}
    </article>
  );
}
