"use client";

import { useRouter } from "next/navigation";
import type { PostDetail } from "@/api/models";
import AvatarImg from "@/components/AvatarImg";
import { Heart, MessageCircle } from "lucide-react";
import { formatDateTime } from "@/utils/format";
import { renderHtml } from "@/utils/markdown";

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
  avatarVersion?: string | null;
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
          href={`/users/${post.ownedBy}`}
          onClick={(e) => e.stopPropagation()}
          aria-label="Show post owner detail"
        >
          <AvatarImg
            userId={post.ownedBy}
            nickname={post.ownerNickname}
            hasAvatar={true}
            size={32}
            useThumb={true}
            className="-mt-1 -ml-1 mr-2 flex-shrink-0"
            version={avatarVersion}
          />
        </a>
        <a
          className="-mt-1 text-lg text-blue-700 hover:underline min-w-[20ex] max-w-[48ex] truncate inline-block align-bottom"
          href={`/users/${post.ownedBy}`}
          onClick={(e) => e.stopPropagation()}
        >
          {post.ownerNickname}
        </a>
        {post.replyTo && (
          <span className="-mt-1 ml-2 text-xs text-gray-500">
            In response to{" "}
            <a
              href={`/posts/${post.replyTo}`}
              className="text-blue-500 hover:underline max-w-[32ex] truncate inline-block align-bottom"
              onClick={(e) => e.stopPropagation()}
            >
              {post.replyToOwnerNickname || post.replyTo}
            </a>
          </span>
        )}
        <span className="relative -mt-1 pr-1 ml-auto text-gray-400 whitespace-nowrap">
          {formatDateTime(new Date(post.createdAt))}
          {post.updatedAt && (
            <div className="absolute right-1 -translate-y-1 ml-1 text-[11px] text-gray-400">
              ({formatDateTime(new Date(post.updatedAt))})
            </div>
          )}
        </span>
      </div>
      <div
        className={`markdown-body post-content${truncated ? " excerpt" : ""}`}
        style={{ minHeight: 36, userSelect: "text" }}
        dangerouslySetInnerHTML={{
          __html: truncated
            ? renderHtml(post.content, { maxLen: 200, maxHeight: 10, pickupThumbnail: true })
            : renderHtml(post.content),
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
                ${post.isLikedByFocusUser ? "bg-pink-100 text-pink-600" : "hover:bg-gray-100"}`}
              onClick={(e) => {
                e.stopPropagation();
                onLike?.(post);
              }}
              type="button"
              aria-label={post.isLikedByFocusUser ? "Unlike" : "Like"}
            >
              {post.isLikedByFocusUser ? (
                <Heart fill="currentColor" size={18} />
              ) : (
                <Heart size={18} />
              )}
              <span>{post.likeCount}</span>
            </button>
            <button
              className={`flex items-center gap-1 px-2 py-1 rounded cursor-pointer
                ${post.isRepliedByFocusUser ? "bg-blue-100 text-blue-600" : "hover:bg-gray-100"}`}
              onClick={(e) => {
                e.stopPropagation();
                onReply?.(post);
              }}
              type="button"
              aria-label="Reply"
            >
              <MessageCircle size={18} />
              <span>{post.replyCount}</span>
            </button>
          </>
        )}
      </div>
      {isReplying && children}
    </article>
  );
}
