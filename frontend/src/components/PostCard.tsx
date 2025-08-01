"use client";

import { useRouter } from "next/navigation";
import type { PostDetail } from "@/api/models";
import Identicon from "@/components/Identicon";
import { Heart, MessageCircle } from "lucide-react";
import { formatDateTime } from "@/utils/format";
import { renderBody } from "@/utils/markdown";

type PostCardProps = {
  post: PostDetail;
  truncated?: boolean;
  showActions?: boolean;
  onLike?: (post: PostDetail) => void;
  onReply?: (post: PostDetail) => void;
  isReplying?: boolean;
  children?: React.ReactNode;
  className?: string;
  clickable?: boolean;
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
}: PostCardProps) {
  const router = useRouter();

  function handleCardClick(_e: React.MouseEvent | React.KeyboardEvent) {
    if (!clickable) return;
    if (typeof window !== "undefined" && window.getSelection()?.toString()) return;
    router.push(`/posts/${post.id}`);
  }

  return (
    <article
      className={`pt-4 pb-2 pl-4 pr-3 border rounded bg-white shadow-sm ${clickable ? "cursor-pointer" : ""} ${className}`}
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
          href={`/users/${post.owned_by}`}
          onClick={(e) => e.stopPropagation()}
        >
          <Identicon
            value={post.owned_by + ":" + post.owner_nickname}
            size={24}
            className="-mt-2 -ml-1 rounded-full border bg-gray-100 mr-2 flex-shrink-0 opacity-80 cursor-pointer"
            tabIndex={0}
            role="button"
            ariaLabel="Show post owner detail"
            onClick={(e) => {
              e.stopPropagation();
              router.push(`/users/${post.owned_by}`);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.stopPropagation();
                router.push(`/users/${post.owned_by}`);
              }
            }}
          />
        </a>
        <a
          className="font-bold text-blue-700 hover:underline min-w-[20ex] max-w-[48ex] truncate inline-block align-bottom"
          href={`/users/${post.owned_by}`}
          onClick={(e) => e.stopPropagation()}
        >
          {post.owner_nickname}
        </a>
        {post.reply_to && (
          <span className="ml-2 text-xs text-gray-500">
            In response to{" "}
            <a
              href={`/posts/${post.reply_to}`}
              className="text-blue-500 hover:underline max-w-[32ex] truncate inline-block align-bottom"
              onClick={(e) => e.stopPropagation()}
            >
              {post.reply_to_owner_nickname || post.reply_to}
            </a>
          </span>
        )}
        <a
          className="pr-1 ml-auto text-gray-400 whitespace-nowrap"
          href={`/posts/${post.id}`}
          onClick={(e) => e.stopPropagation()}
        >
          {formatDateTime(new Date(post.created_at))}
        </a>
      </div>
      <div
        className="markdown-body post-content"
        style={{ minHeight: 36, userSelect: "text" }}
        dangerouslySetInnerHTML={{
          __html: truncated ? renderBody(post.content, 200) : renderBody(post.content),
        }}
      />
      <div className="mt-1 flex items-center gap-2 text-xs text-gray-600">
        {post.tags && post.tags.length > 0 && (
          <div>
            {post.tags.map((tag) => (
              <a
                key={tag}
                href={`/posts?q=${encodeURIComponent("#" + tag)}`}
                className="inline-block bg-gray-100 rounded px-2 py-0.5 mr-1 text-blue-700 hover:bg-blue-200"
                onClick={(e) => e.stopPropagation()}
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
              onClick={(e) => {
                e.stopPropagation();
                onLike?.(post);
              }}
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
              onClick={(e) => {
                e.stopPropagation();
                onReply?.(post);
              }}
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
