"use client";

import { useEffect, useState } from "react";
import {
  listPostsDetail,
  listPostsByFolloweesDetail,
  listPostsLikedByUserDetail,
  createPost,
  addLike,
  removeLike,
} from "@/api/posts";
import type { PostDetail } from "@/api/model";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { useRequireLogin } from "@/hooks/useRequireLogin";
import { parseBodyAndTags } from "@/utils/parse";
import { parsePostSearchQuery, serializePostSearchQuery } from "@/utils/parse";
import { Heart, MessageCircle } from "lucide-react";

export default function PostsPage() {
  const status = useRequireLogin();
  const [posts, setPosts] = useState<PostDetail[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [body, setBody] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [page, setPage] = useState(1);
  const [hasNext, setHasNext] = useState(false);
  const [tab, setTab] = useState<"following" | "liked" | "all">("following");
  const [includingReplies, setIncludingReplies] = useState(false);
  const [oldestFirst, setOldestFirst] = useState(false);
  const [replyTo, setReplyTo] = useState<string | null>(null);
  const [replyBody, setReplyBody] = useState("");
  const [replyError, setReplyError] = useState<string | null>(null);
  const [replySubmitting, setReplySubmitting] = useState(false);

  const PAGE_SIZE = 20;
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const user_id = status.state === "authenticated" ? status.user.user_id : undefined;
  const qParam = searchParams.get("q") ?? "";
  const pageParam = Number(searchParams.get("page")) || 1;

  const searchQueryObj = qParam ? parsePostSearchQuery(qParam) : {};
  const isSearchMode = !!(
    (searchQueryObj.query && searchQueryObj.query.length > 0) ||
    (searchQueryObj.tag && searchQueryObj.tag.length > 0) ||
    (searchQueryObj.ownedBy && searchQueryObj.ownedBy.length > 0)
  );
  const effectiveTab = isSearchMode ? "all" : tab;

  useEffect(() => {
    if (status.state !== "authenticated") return;
    let canceled = false;
    setLoading(true);
    setError(null);

    let usePage = page;
    if (isSearchMode) usePage = pageParam;

    let params: any = {
      offset: (usePage - 1) * PAGE_SIZE,
      limit: PAGE_SIZE,
      order: oldestFirst ? "asc" : "desc",
      focus_user_id: user_id,
    };

    let fetcher: Promise<PostDetail[]>;
    if (isSearchMode) {
      if (searchQueryObj.query) params.query = searchQueryObj.query;
      if (searchQueryObj.tag) params.tag = searchQueryObj.tag;
      if (searchQueryObj.ownedBy) params.owned_by = searchQueryObj.ownedBy;
      if (searchQueryObj.noreply) params.reply_to = "";
      if (!searchQueryObj.noreply) params.reply_to = undefined;
      fetcher = listPostsDetail(params);
    } else if (effectiveTab === "following") {
      fetcher = listPostsByFolloweesDetail({
        user_id: user_id!,
        ...params,
        include_self: true,
        include_replies: includingReplies,
      });
    } else if (effectiveTab === "liked") {
      fetcher = listPostsLikedByUserDetail({
        user_id: user_id!,
        ...params,
        include_replies: includingReplies,
      });
    } else {
      fetcher = listPostsDetail({
        ...params,
        ...(includingReplies ? {} : { reply_to: "" }),
      });
    }

    fetcher
      .then((data) => {
        if (!canceled) {
          setPosts(data);
          setHasNext(data.length === PAGE_SIZE);
        }
      })
      .catch((err: any) => {
        if (!canceled) setError(err?.message || "Failed to fetch posts.");
      })
      .finally(() => {
        if (!canceled) setLoading(false);
      });
    return () => {
      canceled = true;
    };
  }, [
    status,
    page,
    user_id,
    tab,
    includingReplies,
    oldestFirst,
    isSearchMode,
    qParam,
    pageParam,
    pathname,
  ]);

  useEffect(() => {
    if (isSearchMode) {
      setTab("all");
      setIncludingReplies(!searchQueryObj.noreply);
      setOldestFirst(!!searchQueryObj.oldest);
      setPage(pageParam);
    }
  }, [isSearchMode, qParam, pageParam, searchQueryObj.noreply, searchQueryObj.oldest]);

  function clearError() {
    if (error) setError(null);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const { content, tags } = parseBodyAndTags(body);
      if (!content.trim()) throw new Error("Content is required.");
      if (content.length > 5000) throw new Error("Content is too long (max 5000 chars).");
      if (tags.length > 5) throw new Error("You can specify up to 5 tags.");
      for (const tag of tags) {
        if (tag.length > 50) throw new Error(`Tag "${tag}" is too long (max 50 chars).`);
      }
      await createPost({ content, tags });
      setBody("");
      setPage(1);
      reloadPosts(1);
    } catch (err: any) {
      setError(err?.message || "Failed to post.");
    } finally {
      setSubmitting(false);
    }
  }

  function clearReplyError() {
    if (replyError) setReplyError(null);
  }

  async function handleReplySubmit(e: React.FormEvent) {
    e.preventDefault();
    setReplySubmitting(true);
    setReplyError(null);
    try {
      const { content, tags } = parseBodyAndTags(replyBody);
      if (!content.trim()) throw new Error("Content is required.");
      if (content.length > 5000) throw new Error("Content is too long (max 5000 chars).");
      if (tags.length > 5) throw new Error("You can specify up to 5 tags.");
      for (const tag of tags) {
        if (tag.length > 50) throw new Error(`Tag "${tag}" is too long (max 50 chars).`);
      }
      await createPost({ content, tags, reply_to: replyTo });
      setReplyBody("");
      setReplyTo(null);
      reloadPosts(page);
    } catch (err: any) {
      setReplyError(err?.message || "Failed to reply.");
    } finally {
      setReplySubmitting(false);
    }
  }

  async function handleLike(post: PostDetail) {
    try {
      if (post.is_liked_by_focus_user) {
        await removeLike(post.id);
      } else {
        await addLike(post.id);
      }
      reloadPosts(page);
    } catch (err) {
      alert("Failed to update like.");
    }
  }

  function reloadPosts(targetPage: number) {
    if (status.state !== "authenticated") return;
    let usePage = targetPage;
    if (isSearchMode) usePage = pageParam;
    let params: any = {
      offset: (usePage - 1) * PAGE_SIZE,
      limit: PAGE_SIZE,
      order: oldestFirst ? "asc" : "desc",
      focus_user_id: user_id,
    };
    let fetcher: Promise<PostDetail[]>;
    if (isSearchMode) {
      if (searchQueryObj.query) params.query = searchQueryObj.query;
      if (searchQueryObj.tag) params.tag = searchQueryObj.tag;
      if (searchQueryObj.ownedBy) params.owned_by = searchQueryObj.ownedBy;
      if (searchQueryObj.noreply) params.reply_to = "";
      if (!searchQueryObj.noreply) params.reply_to = undefined;
      fetcher = listPostsDetail(params);
    } else if (effectiveTab === "following") {
      fetcher = listPostsByFolloweesDetail({
        user_id: user_id!,
        ...params,
        include_self: true,
        include_replies: includingReplies,
      });
    } else if (effectiveTab === "liked") {
      fetcher = listPostsLikedByUserDetail({
        user_id: user_id!,
        ...params,
        include_replies: includingReplies,
      });
    } else {
      fetcher = listPostsDetail({
        ...params,
        ...(includingReplies ? {} : { reply_to: "" }),
      });
    }
    fetcher.then((data) => {
      setPosts(data);
      setHasNext(data.length === PAGE_SIZE);
    });
  }

  function handleSearchToggle(key: "includingReplies" | "oldestFirst", value: boolean) {
    if (!isSearchMode) {
      if (key === "includingReplies") setIncludingReplies(value);
      if (key === "oldestFirst") setOldestFirst(value);
      setPage(1);
      return;
    }
    let updated = { ...searchQueryObj };
    if (key === "includingReplies") {
      if (value) {
        delete updated.noreply;
      } else {
        updated.noreply = true;
      }
    }
    if (key === "oldestFirst") {
      if (value) {
        updated.oldest = true;
      } else {
        delete updated.oldest;
      }
    }
    const nextQ = serializePostSearchQuery(updated);
    router.push(`${pathname}?q=${encodeURIComponent(nextQ)}`);
  }

  if (status.state !== "authenticated") return null;

  return (
    <main className="max-w-2xl mx-auto mt-8 p-4 bg-white shadow rounded" onClick={clearError}>
      <form
        onSubmit={handleSubmit}
        className="mb-6 flex flex-col gap-2"
        onClick={(e) => e.stopPropagation()}
      >
        <textarea
          className="border rounded px-2 py-1 min-h-[64px]"
          placeholder="Write your post. Use #tag lines for tags."
          value={body}
          onChange={(e) => setBody(e.target.value)}
          maxLength={5000}
          onFocus={clearError}
        />
        <div className="flex items-center gap-2">
          <button
            type="submit"
            className="self-end bg-blue-600 text-white px-4 py-1 rounded disabled:opacity-60"
            disabled={submitting}
          >
            {submitting ? "Posting..." : "Post"}
          </button>
          {error && <span className="text-red-600 text-sm ml-2">{error}</span>}
        </div>
      </form>
      <div className="flex gap-1 mb-2">
        <button
          className={`px-3 py-1 rounded-t text-sm font-normal
            ${tab === "following" && !isSearchMode ? "bg-blue-100 text-black" : "bg-blue-50 text-gray-400 hover:bg-blue-100"}`}
          style={{ minWidth: 110 }}
          onClick={() => {
            setTab("following");
            setPage(1);
            if (isSearchMode) router.push(pathname);
          }}
        >
          Following
        </button>
        <button
          className={`px-3 py-1 rounded-t text-sm font-normal
            ${tab === "liked" && !isSearchMode ? "bg-blue-100 text-black" : "bg-blue-50 text-gray-400 hover:bg-blue-100"}`}
          style={{ minWidth: 110 }}
          onClick={() => {
            setTab("liked");
            setPage(1);
            if (isSearchMode) router.push(pathname);
          }}
        >
          Liked
        </button>
        <button
          className={`px-3 py-1 rounded-t text-sm font-normal
            ${tab === "all" || isSearchMode ? "bg-blue-100 text-black" : "bg-blue-50 text-gray-400 hover:bg-blue-100"}`}
          style={{ minWidth: 110 }}
          onClick={() => {
            setTab("all");
            setPage(1);
            if (isSearchMode) router.push(pathname);
          }}
        >
          All
        </button>
        <label className="flex items-center gap-1 text-sm ml-4">
          <input
            type="checkbox"
            checked={isSearchMode ? !searchQueryObj.noreply : includingReplies}
            onChange={(e) => handleSearchToggle("includingReplies", e.target.checked)}
          />
          Including replies
        </label>
        <label className="flex items-center gap-1 text-sm">
          <input
            type="checkbox"
            checked={isSearchMode ? !!searchQueryObj.oldest : oldestFirst}
            onChange={(e) => handleSearchToggle("oldestFirst", e.target.checked)}
          />
          Oldest first
        </label>
      </div>
      {isSearchMode && (
        <div className="mb-2 text-sm text-gray-500">
          Posts matching{" "}
          <span className="bg-gray-200 rounded px-2 py-0.5 text-gray-700">
            {serializePostSearchQuery(searchQueryObj)}
          </span>
        </div>
      )}
      <div>
        {loading && <div className="text-gray-500">Loading…</div>}
        <ul className="space-y-4">
          {posts.map((post) => (
            <li key={post.id} className="p-4 border rounded shadow-sm">
              <div className="flex gap-2 items-center text-sm mb-1">
                <a
                  className="font-bold text-blue-700 hover:underline min-w-[16ex] max-w-[32ex] truncate inline-block align-bottom"
                  href={`/users/${post.owned_by}`}
                >
                  {post.owner_nickname}
                </a>
                <a className="text-gray-400" href={`/posts/${post.id}`}>
                  {new Date(post.created_at).toLocaleString()}
                </a>
                {post.reply_to && (
                  <span className="ml-2 text-xs text-gray-500">
                    In response to{" "}
                    <a
                      href={`/posts/${post.reply_to}`}
                      className="text-blue-500 hover:underline min-w-[8ex] max-w-[32ex] truncate inline-block align-bottom"
                    >
                      {post.reply_to_owner_nickname || post.reply_to}
                    </a>
                  </span>
                )}
              </div>
              <div
                className="cursor-pointer"
                onClick={() => router.push(`/posts/${post.id}`)}
                style={{ minHeight: 36 }}
              >
                {truncatePlaintext(post.content, 200)}
              </div>
              <div className="mt-1 flex items-center gap-2 text-xs text-gray-600">
                {post.tags && post.tags.length > 0 && (
                  <div>
                    {post.tags.map((tag) => (
                      <a
                        key={tag}
                        href={`${pathname}?q=${encodeURIComponent(serializePostSearchQuery({ tag }))}`}
                        className="inline-block bg-gray-100 rounded px-2 py-0.5 mr-1 text-blue-700 hover:bg-blue-200"
                      >
                        #{tag}
                      </a>
                    ))}
                  </div>
                )}
                <button
                  className={`ml-auto flex items-center gap-1 px-2 py-1 rounded
                    ${post.is_liked_by_focus_user ? "bg-pink-100 text-pink-600" : "hover:bg-gray-100"}`}
                  onClick={() => handleLike(post)}
                  type="button"
                  aria-label={post.is_liked_by_focus_user ? "Unlike" : "Like"}
                >
                  {post.is_liked_by_focus_user ? (
                    <Heart fill="currentColor" size={18} />
                  ) : (
                    <Heart size={18} />
                  )}
                  {post.like_count > 0 && <span>{post.like_count}</span>}
                </button>
                <button
                  className={`flex items-center gap-1 px-2 py-1 rounded
                    ${post.is_replied_by_focus_user ? "bg-blue-100 text-blue-600" : "hover:bg-gray-100"}`}
                  onClick={() => {
                    setReplyTo(post.id);
                    setReplyBody("");
                    setReplyError(null);
                  }}
                  type="button"
                  aria-label="Reply"
                >
                  <MessageCircle size={18} />
                  {post.reply_count > 0 && <span>{post.reply_count}</span>}
                </button>
              </div>
              {replyTo === post.id && (
                <form
                  className="mt-3 flex flex-col gap-2 border-t pt-3"
                  onSubmit={handleReplySubmit}
                  onClick={(e) => e.stopPropagation()}
                >
                  <textarea
                    className="border rounded px-2 py-1 min-h-[48px]"
                    placeholder="Write your reply. Use #tag lines for tags."
                    value={replyBody}
                    onChange={(e) => setReplyBody(e.target.value)}
                    maxLength={5000}
                    onFocus={clearReplyError}
                  />
                  <div className="flex items-center gap-2">
                    <button
                      type="submit"
                      className="bg-blue-500 text-white px-4 py-1 rounded disabled:opacity-60"
                      disabled={replySubmitting}
                    >
                      {replySubmitting ? "Replying..." : "Reply"}
                    </button>
                    <button
                      type="button"
                      className="text-gray-500 underline ml-2"
                      onClick={() => {
                        setReplyTo(null);
                        setReplyError(null);
                      }}
                    >
                      Cancel
                    </button>
                    {replyError && <span className="text-red-600 text-sm ml-2">{replyError}</span>}
                  </div>
                </form>
              )}
            </li>
          ))}
        </ul>
        <div className="mt-6 flex justify-center gap-4">
          <button
            className="px-3 py-1 rounded border"
            onClick={() => {
              const nextPage = Math.max(1, (isSearchMode ? pageParam : page) - 1);
              setPage(nextPage);
              if (isSearchMode) {
                router.push(
                  `${pathname}?page=${nextPage}${qParam ? `&q=${encodeURIComponent(qParam)}` : ""}`,
                );
              }
            }}
            disabled={(isSearchMode ? pageParam : page) === 1}
          >
            Prev
          </button>
          <span>Page {isSearchMode ? pageParam : page}</span>
          <button
            className="px-3 py-1 rounded border"
            onClick={() => {
              const nextPage = (isSearchMode ? pageParam : page) + 1;
              setPage(nextPage);
              if (isSearchMode) {
                router.push(
                  `${pathname}?page=${nextPage}${qParam ? `&q=${encodeURIComponent(qParam)}` : ""}`,
                );
              }
            }}
            disabled={!hasNext}
          >
            Next
          </button>
        </div>
        {posts.length === 0 && !loading && !error && (
          <div className="text-gray-500 text-center">No posts found.</div>
        )}
      </div>
    </main>
  );
}

function truncatePlaintext(text: string, maxLen: number) {
  let plain = text
    .replace(/[#>*_`~\-!\[\]()]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return plain.length > maxLen ? plain.slice(0, maxLen) + "…" : plain;
}
