"use client";

import { useRouter, usePathname } from "next/navigation";
import type { PostDetail } from "@/api/model";
import { Heart, MessageCircle } from "lucide-react";

type PostCardProps = {
  post: PostDetail;
  truncated?: boolean;
  showActions?: boolean;
  onLike?: (post: PostDetail) => void;
  onReply?: (post: PostDetail) => void;
  isReplying?: boolean;
  children?: React.ReactNode;
  className?: string;
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
}: PostCardProps) {
  const router = useRouter();
  const pathname = usePathname();

  function handleCardClick(e: React.MouseEvent | React.KeyboardEvent) {
    // テキストが選択されていたら遷移しない
    if (typeof window !== "undefined" && window.getSelection()?.toString()) return;
    router.push(`/posts/${post.id}`);
  }

  function truncatePlaintext(text: string, maxLen: number) {
    let plain = text
      .replace(/[#>*_`~\-!\[\]()]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    return plain.length > maxLen ? plain.slice(0, maxLen) + "…" : plain;
  }

  return (
    <article
      className={`p-4 border rounded bg-white shadow-sm cursor-pointer ${className}`}
      onClick={handleCardClick}
      tabIndex={0}
      role="button"
      aria-label="Show post detail"
      onKeyDown={e => {
        if (e.key === "Enter" || e.key === " ") {
          handleCardClick(e);
        }
      }}
    >
      <div className="flex gap-2 items-center text-sm mb-1">
        <a
          className="font-bold text-blue-700 hover:underline min-w-[16ex] max-w-[32ex] truncate inline-block align-bottom"
          href={`/users/${post.owned_by}`}
          onClick={e => e.stopPropagation()}
        >
          {post.owner_nickname}
        </a>
        <a
          className="text-gray-400"
          href={`/posts/${post.id}`}
          onClick={e => e.stopPropagation()}
        >
          {new Date(post.created_at).toLocaleString()}
        </a>
        {post.reply_to && (
          <span className="ml-2 text-xs text-gray-500">
            In response to{" "}
            <a
              href={`/posts/${post.reply_to}`}
              className="text-blue-500 hover:underline min-w-[8ex] max-w-[32ex] truncate inline-block align-bottom"
              onClick={e => e.stopPropagation()}
            >
              {post.reply_to_owner_nickname || post.reply_to}
            </a>
          </span>
        )}
      </div>
      <div
        style={{ minHeight: 36, userSelect: "text" }}
      >
        {truncated ? truncatePlaintext(post.content, 200) : post.content}
      </div>
      <div className="mt-1 flex items-center gap-2 text-xs text-gray-600">
        {post.tags && post.tags.length > 0 && (
          <div>
            {post.tags.map((tag) => (
              <a
                key={tag}
                href={`/posts?q=${encodeURIComponent("#" + tag)}`}
                className="inline-block bg-gray-100 rounded px-2 py-0.5 mr-1 text-blue-700 hover:bg-blue-200"
                onClick={e => e.stopPropagation()}
              >
                #{tag}
              </a>
            ))}
          </div>
        )}
        {showActions && (
          <>
            <button
              className={`ml-auto flex items-center gap-1 px-2 py-1 rounded cursor-pointer
                ${post.is_liked_by_focus_user ? "bg-pink-100 text-pink-600" : "hover:bg-gray-100"}`}
              onClick={e => { e.stopPropagation(); onLike?.(post); }}
              type="button"
              aria-label={post.is_liked_by_focus_user ? "Unlike" : "Like"}
            >
              {post.is_liked_by_focus_user ? (
                <Heart fill="currentColor" size={18} />
              ) : (
                <Heart size={18} />
              )}
              <span>{post.like_count}</span>
            </button>
            <button
              className={`flex items-center gap-1 px-2 py-1 rounded cursor-pointer
                ${post.is_replied_by_focus_user ? "bg-blue-100 text-blue-600" : "hover:bg-gray-100"}`}
              onClick={e => { e.stopPropagation(); onReply?.(post); }}
              type="button"
              aria-label="Reply"
            >
              <MessageCircle size={18} />
              <span>{post.reply_count}</span>
            </button>
          </>
        )}
      </div>
      {isReplying && children}
    </article>
  );
}
