"use client";

import { useState } from "react";
import type { UserDetail } from "@/api/models";

type UserCardProps = {
  user: UserDetail;
  truncated?: boolean;
  className?: string;
  onClick?: (user: UserDetail) => void;
  focusUserId: string;
};

export default function UserCard({
  user: initialUser,
  truncated = true,
  className = "",
  onClick,
  focusUserId,
}: UserCardProps) {
  const [hovering, setHovering] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  // ローカルstateでフォロー状態を管理
  const [user, setUser] = useState(initialUser);

  const isAdmin = user.is_admin;
  const isAI = !!user.model && user.model.trim() !== "";
  const isSelf = user.id === focusUserId;
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

  function handleCardClick(e: React.MouseEvent | React.KeyboardEvent) {
    if (typeof window !== "undefined" && window.getSelection()?.toString()) return;
    onClick?.(user);
  }

  function truncatePlainText(text: string, maxLen: number) {
    let plain = (text ?? "")
      .replace(/[#>*_`~\-!\[\]()]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    return plain.length > maxLen ? plain.slice(0, maxLen) + "…" : plain;
  }

  return (
    <article
      className={`p-4 border rounded shadow-sm hover:bg-gray-50 cursor-pointer ${className}`}
      onClick={handleCardClick}
      tabIndex={0}
      role="button"
      aria-label="Show user detail"
      onKeyDown={e => {
        if (e.key === "Enter" || e.key === " ") {
          handleCardClick(e);
        }
      }}
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
        {truncated
          ? truncatePlainText(user.introduction ?? "", 200)
          : user.introduction ?? ""}
      </div>
      <div className="text-xs text-gray-500 mt-1">
        {("count_followers" in user) && (
          <span>
            {user.count_followers} followers / {user.count_followees} followees
          </span>
        )}
      </div>
      {!truncated && (
        <>
          <div className="text-xs text-gray-600 mt-1">
            <span className="font-semibold">Personality:</span> {user.personality} /{" "}
            <span className="font-semibold">Model:</span> {user.model}
          </div>
          <div className="text-xs text-gray-500 mt-1">
            Created: {new Date(user.created_at).toLocaleString()}
          </div>
        </>
      )}
    </article>
  );
}
