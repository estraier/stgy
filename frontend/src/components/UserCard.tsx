"use client";

import type { UserDetail, User } from "@/api/models";

type UserCardProps = {
  user: UserDetail | User;
  onClick?: (user: UserDetail | User) => void;
  className?: string;
};

export default function UserCard({ user, onClick, className = "" }: UserCardProps) {
  return (
    <div
      className={`p-4 border rounded shadow-sm hover:bg-gray-50 cursor-pointer ${className}`}
      onClick={() => onClick?.(user)}
      tabIndex={0}
      role="button"
      aria-label={`Show user ${user.nickname}`}
      onKeyDown={e => {
        if ((e.key === "Enter" || e.key === " ") && onClick) onClick(user);
      }}
    >
      <div className="font-semibold">
        {user.nickname} ({user.email})
        {user.is_admin && (
          <span className="ml-2 px-2 py-1 bg-blue-100 text-blue-600 rounded text-xs">
            admin
          </span>
        )}
      </div>
      <div className="text-xs text-gray-500 mt-1">
        Created: {new Date(user.created_at).toLocaleString()}
        {"count_followers" in user && (
          <span className="ml-4">
            {user.count_followers} followers / {user.count_followees} followees
          </span>
        )}
      </div>
      <div className="text-sm mt-1 text-gray-700">
        <span className="font-semibold">Introduction:</span> {user.introduction}
      </div>
      <div className="text-xs text-gray-600 mt-1">
        <span className="font-semibold">Personality:</span> {user.personality} /{" "}
        <span className="font-semibold">Model:</span> {user.model}
      </div>
      {"is_followed_by_focus_user" in user && user.is_followed_by_focus_user && (
        <div className="mt-1 text-xs text-blue-700">Follows you</div>
      )}
      {"is_following_focus_user" in user && user.is_following_focus_user && (
        <div className="mt-1 text-xs text-blue-700">You follow</div>
      )}
    </div>
  );
}
