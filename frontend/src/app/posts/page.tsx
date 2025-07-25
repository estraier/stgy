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
import { listUsers } from "@/api/users";
import type { PostDetail } from "@/api/model";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { useRequireLogin } from "@/hooks/useRequireLogin";
import { parseBodyAndTags } from "@/utils/parse";
import { parsePostSearchQuery, serializePostSearchQuery } from "@/utils/parse";
import PostCard from "@/components/PostCard";
import PostForm from "@/components/PostForm";

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
  const [resolvedOwnedBy, setResolvedOwnedBy] = useState<string | undefined>(undefined);

  const PAGE_SIZE = 5;
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
    let canceled = false;
    if (
      isSearchMode &&
      searchQueryObj.ownedBy &&
      !/^[0-9a-fA-F\-]{36}$/.test(searchQueryObj.ownedBy)
    ) {
      (async () => {
        try {
          const users = await listUsers({
            order: "social",
            nickname: searchQueryObj.ownedBy,
            focus_user_id: user_id,
            limit: 1,
          });
          if (!canceled) {
            if (users.length > 0) {
              setResolvedOwnedBy(users[0].id);
            } else {
              setResolvedOwnedBy("__NO_SUCH_USER__");
            }
          }
        } catch (e) {
          if (!canceled) setResolvedOwnedBy("__NO_SUCH_USER__");
        }
      })();
    } else {
      setResolvedOwnedBy(undefined);
    }
    return () => {
      canceled = true;
    };
  }, [isSearchMode, searchQueryObj.ownedBy, user_id]);

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

    let effectiveOwnedBy = searchQueryObj.ownedBy;
    if (
      isSearchMode &&
      searchQueryObj.ownedBy &&
      !/^[0-9a-fA-F\-]{36}$/.test(searchQueryObj.ownedBy)
    ) {
      if (resolvedOwnedBy === undefined) {
        setLoading(true);
        return () => {};
      }
      if (resolvedOwnedBy === "__NO_SUCH_USER__") {
        setPosts([]);
        setLoading(false);
        setHasNext(false);
        return () => {};
      }
      effectiveOwnedBy = resolvedOwnedBy;
    }

    if (isSearchMode) {
      if (searchQueryObj.query) params.query = searchQueryObj.query;
      if (searchQueryObj.tag) params.tag = searchQueryObj.tag;
      if (effectiveOwnedBy) params.owned_by = effectiveOwnedBy;
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
    resolvedOwnedBy,
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

  // 楽観的UI対応: Like直後にカウントと状態を即時変更
  async function handleLike(post: PostDetail) {
    setPosts((prev) =>
      prev.map((p) =>
        p.id === post.id
          ? {
              ...p,
              is_liked_by_focus_user: !p.is_liked_by_focus_user,
              like_count: p.like_count + (p.is_liked_by_focus_user ? -1 : 1),
            }
          : p,
      ),
    );
    try {
      if (post.is_liked_by_focus_user) {
        await removeLike(post.id);
      } else {
        await addLike(post.id);
      }
      // APIで正値を再取得して補正
      reloadPosts(page);
    } catch (err) {
      alert("Failed to update like.");
      reloadPosts(page);
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
    let effectiveOwnedBy = searchQueryObj.ownedBy;
    if (
      isSearchMode &&
      searchQueryObj.ownedBy &&
      !/^[0-9a-fA-F\-]{36}$/.test(searchQueryObj.ownedBy)
    ) {
      if (resolvedOwnedBy === undefined) {
        setLoading(true);
        return;
      }
      if (resolvedOwnedBy === "__NO_SUCH_USER__") {
        setPosts([]);
        setLoading(false);
        setHasNext(false);
        return;
      }
      effectiveOwnedBy = resolvedOwnedBy;
    }
    if (isSearchMode) {
      if (searchQueryObj.query) params.query = searchQueryObj.query;
      if (searchQueryObj.tag) params.tag = searchQueryObj.tag;
      if (effectiveOwnedBy) params.owned_by = effectiveOwnedBy;
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
    <main className="max-w-3xl mx-auto mt-8 p-4" onClick={clearError}>
      <PostForm
        body={body}
        setBody={setBody}
        onSubmit={handleSubmit}
        submitting={submitting}
        error={error}
        onErrorClear={clearError}
      />
      <div className="h-6" />
      <div className="flex gap-1 mb-2">
        <button
          className={`px-3 py-1 rounded-t text-sm font-normal cursor-pointer
            ${tab === "following" && !isSearchMode ? "bg-blue-100 text-gray-800" : "bg-blue-50 text-gray-400 hover:bg-blue-100"}`}
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
          className={`px-3 py-1 rounded-t text-sm font-normal cursor-pointer
            ${tab === "liked" && !isSearchMode ? "bg-blue-100 text-gray-800" : "bg-blue-50 text-gray-400 hover:bg-blue-100"}`}
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
          className={`px-3 py-1 rounded-t text-sm font-normal cursor-pointer
            ${tab === "all" || isSearchMode ? "bg-blue-100 text-gray-800" : "bg-blue-50 text-gray-400 hover:bg-blue-100"}`}
          style={{ minWidth: 110 }}
          onClick={() => {
            setTab("all");
            setPage(1);
            if (isSearchMode) router.push(pathname);
          }}
        >
          All
        </button>
        <label className="flex items-center gap-1 text-sm ml-4 text-gray-700 cursor-pointer">
          <input
            type="checkbox"
            checked={isSearchMode ? !searchQueryObj.noreply : includingReplies}
            onChange={(e) => handleSearchToggle("includingReplies", e.target.checked)}
            className="cursor-pointer"
          />
          Including replies
        </label>
        <label className="flex items-center gap-1 text-sm text-gray-700 cursor-pointer">
          <input
            type="checkbox"
            checked={isSearchMode ? !!searchQueryObj.oldest : oldestFirst}
            onChange={(e) => handleSearchToggle("oldestFirst", e.target.checked)}
            className="cursor-pointer"
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
            <li key={post.id}>
              <PostCard
                post={post}
                pathname={pathname}
                onClickContent={() => router.push(`/posts/${post.id}`)}
                onLike={() => handleLike(post)}
                onReply={() => {
                  setReplyTo(post.id);
                  setReplyBody("");
                  setReplyError(null);
                }}
              />
              {replyTo === post.id && (
                <PostForm
                  body={replyBody}
                  setBody={setReplyBody}
                  onSubmit={handleReplySubmit}
                  submitting={replySubmitting}
                  error={replyError}
                  onErrorClear={clearReplyError}
                  buttonLabel="Reply"
                  placeholder="Write your reply. Use #tag lines for tags."
                  className="mt-3 flex flex-col gap-2 border-t pt-3"
                  onCancel={() => {
                    setReplyTo(null);
                    setReplyError(null);
                  }}
                />
              )}
            </li>
          ))}
        </ul>
        <div className="mt-6 flex justify-center gap-4">
          <button
            className="px-3 py-1 rounded border text-gray-800 bg-blue-100 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
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
          <span className="text-gray-800">Page {isSearchMode ? pageParam : page}</span>
          <button
            className="px-3 py-1 rounded border text-gray-800 bg-blue-100 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
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
