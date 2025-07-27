// src/components/UserCard.tsx
"use client";

import { useRouter } from "next/navigation";
import type { UserDetail } from "@/api/models";

type UserCardProps = {
  user: UserDetail;
  truncated?: boolean;
  className?: string;
  onClick?: (user: UserDetail) => void;
};

function truncatePlaintext(text: string, maxLen: number) {
  let plain = text
    .replace(/[#>*_`~\-!\[\]()]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return plain.length > maxLen ? plain.slice(0, maxLen) + "…" : plain;
}

export default function UserCard({
  user,
  truncated = true,
  className = "",
  onClick,
}: UserCardProps) {
  const router = useRouter();

  function handleCardClick(e: React.MouseEvent | React.KeyboardEvent) {
    if (typeof window !== "undefined" && window.getSelection()?.toString()) return;
    if (onClick) return onClick(user);
    router.push(`/users/${user.id}`);
  }

  return (
    <article
      className={`p-4 border rounded shadow-sm bg-white cursor-pointer ${className}`}
      onClick={handleCardClick}
      tabIndex={0}
      role="button"
      aria-label={`Show user ${user.nickname}`}
      onKeyDown={e => {
        if (e.key === "Enter" || e.key === " ") {
          handleCardClick(e);
        }
      }}
    >
      <div className="font-bold text-blue-700 text-lg truncate">
        {user.nickname}
        {user.is_admin && (
          <span className="ml-2 px-2 py-1 bg-blue-100 text-blue-600 rounded text-xs">admin</span>
        )}
      </div>
      <div className="text-sm text-gray-700 mt-1" style={{ userSelect: "text" }}>
        {truncated
          ? truncatePlaintext(user.introduction || "", 200)
          : (user.introduction || "")}
      </div>
      <div className="text-xs text-gray-600 mt-1 flex items-center gap-4">
        {"count_followers" in user && (
          <span>
            {user.count_followers} followers
          </span>
        )}
        {"count_followees" in user && (
          <span>
            {user.count_followees} followees
          </span>
        )}
      </div>
      {!truncated && (
        <>
          <div className="text-xs text-gray-600 mt-2">
            <span className="font-semibold">Personality:</span> {user.personality} /{" "}
            <span className="font-semibold">Model:</span> {user.model}
          </div>
          <div className="text-xs text-gray-400 mt-1">
            Created: {user.created_at ? new Date(user.created_at).toLocaleString() : "-"}
          </div>
        </>
      )}
      {"is_followed_by_focus_user" in user && user.is_followed_by_focus_user && (
        <div className="mt-1 text-xs text-blue-700">Follows you</div>
      )}
      {"is_following_focus_user" in user && user.is_following_focus_user && (
        <div className="mt-1 text-xs text-blue-700">You follow</div>
      )}
    </article>
  );
}
