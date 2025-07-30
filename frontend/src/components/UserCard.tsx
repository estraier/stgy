"use client";

import { useEffect, useState } from "react";
import type { UserDetail } from "@/api/models";
import { formatDateTime } from "@/utils/format";

type UserCardProps = {
  user: UserDetail;
  truncated?: boolean;
  className?: string;
  onClick?: (user: UserDetail) => void;
  focusUserId?: string;
  clickable?: boolean; // 追加
};

export default function UserCard({
  user: initialUser,
  truncated = true,
  className = "",
  onClick,
  focusUserId,
  clickable = true, // デフォルトtrue
}: UserCardProps) {
  const [hovering, setHovering] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [user, setUser] = useState(initialUser);

  useEffect(() => {
    setUser(initialUser);
  }, [initialUser]);

  const isAdmin = user.is_admin;
  const isAI = !!(user.ai_model && user.ai_model.trim() !== "");
  const isSelf = !!(focusUserId && user.id === focusUserId);
  const isFollowing = !!user.is_followed_by_focus_user;

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
              setUser({ ...user, is_followed_by_focus_user: false });
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
              setUser({ ...user, is_followed_by_focus_user: true });
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

  function truncatePlainText(text: string, maxLen: number) {
    const plain = (text ?? "")
      .replace(/[#>*_`~\-!\[\]()]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    return plain.length > maxLen ? plain.slice(0, maxLen) + "…" : plain;
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
        <span className="truncate max-w-[24ex] text-blue-700">{user.nickname}</span>
        {isAdmin && (
          <span className="ml-2 px-2 py-1 bg-blue-100 text-blue-600 rounded text-xs">admin</span>
        )}
        {isAI && (
          <span className="ml-2 px-2 py-1 bg-gray-200 text-gray-700 rounded text-xs">AI</span>
        )}
        {isSelf && (
          <span className="ml-2 px-2 py-1 bg-green-100 text-green-800 rounded text-xs">self</span>
        )}
        <span className="ml-auto">{followButton}</span>
      </div>
      <div className="text-sm mt-1 text-gray-700">
        {truncated ? truncatePlainText(user.introduction ?? "", 200) : (user.introduction ?? "")}
      </div>
      {!truncated && user.ai_model && user.ai_model.trim() !== "" && (
        <div className="text-xs text-gray-600 mt-2">
          <div className="font-semibold">AI Model:</div>
          <div className="pl-2">{user.ai_model}</div>
        </div>
      )}
      {!truncated && user.ai_personality && user.ai_personality.trim() !== "" && (
        <div className="text-xs text-gray-600 mt-2">
          <div className="font-semibold">AI Personality:</div>
          <div className="pl-2">{user.ai_personality}</div>
        </div>
      )}
      {!truncated && (
        <div className="text-xs text-gray-500 mt-2">
          <div className="font-semibold">Created:</div>
          <div className="pl-2">{formatDateTime(new Date(user.created_at))}</div>
        </div>
      )}
      {"count_followers" in user && (
        <div className="text-xs text-gray-500 mt-2">
          <span className="gap-1">followers: {user.count_followers}</span>
          <span className="ml-2">followees: {user.count_followees}</span>
        </div>
      )}
    </article>
  );
}
