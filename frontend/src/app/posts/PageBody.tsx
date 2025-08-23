"use client";

import { Config } from "@/config";
import { useEffect, useState, useRef, useCallback, useMemo } from "react";
import {
  listPostsDetail,
  listPostsByFolloweesDetail,
  listPostsLikedByUserDetail,
  createPost,
  addLike,
  removeLike,
} from "@/api/posts";
import { listUsers } from "@/api/users";
import type { PostDetail } from "@/api/models";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { useRequireLogin } from "@/hooks/useRequireLogin";
import { parseBodyAndTags } from "@/utils/parse";
import { parsePostSearchQuery, serializePostSearchQuery } from "@/utils/parse";
import PostCard from "@/components/PostCard";
import PostForm from "@/components/PostForm";

const TAB_VALUES = ["following", "liked", "all"] as const;

type PostSearchQuery = {
  query?: string;
  tag?: string;
  ownedBy?: string;
};

export default function PageBody() {
  const status = useRequireLogin();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const isAdmin = status && status.state === "authenticated" && status.session.userIsAdmin;

  const [posts, setPosts] = useState<PostDetail[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [body, setBody] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [hasNext, setHasNext] = useState(false);
  const [replyTo, setReplyTo] = useState<string | null>(null);
  const [replyBody, setReplyBody] = useState("");
  const [replyError, setReplyError] = useState<string | null>(null);
  const [replySubmitting, setReplySubmitting] = useState(false);
  const [resolvedOwnedBy, setResolvedOwnedBy] = useState<string | undefined>(undefined);

  function getQueryParams() {
    const sp = searchParams;
    return {
      tab: (sp.get("tab") as "following" | "liked" | "all") || "following",
      includingReplies: sp.get("includingReplies") === "1",
      oldestFirst: sp.get("oldestFirst") === "1",
      page: Math.max(Number(sp.get("page")) || 1, 1),
      qParam: sp.get("q") ?? "",
    };
  }
  const { tab, includingReplies, oldestFirst, page, qParam } = getQueryParams();

  const searchQueryObj: PostSearchQuery = useMemo(
    () => (qParam ? (parsePostSearchQuery(qParam) as PostSearchQuery) : {}),
    [qParam],
  );

  const userId = status.state === "authenticated" ? status.session.userId : undefined;
  const userUpdatedAt = status.state === "authenticated" ? status.session.userUpdatedAt : null;
  const hasTabParam = searchParams.has("tab");

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
            nickname: searchQueryObj.ownedBy!,
            focusUserId: userId,
            limit: 1,
          });
          if (!canceled) {
            setResolvedOwnedBy(users.length > 0 ? users[0].id : "__NO_SUCH_USER__");
          }
        } catch {
          if (!canceled) setResolvedOwnedBy("__NO_SUCH_USER__");
        }
      })();
    } else {
      setResolvedOwnedBy(undefined);
    }
    return () => {
      canceled = true;
    };
  }, [searchQueryObj.ownedBy, isSearchMode, userId]);

  const setQuery = useCallback(
    (updates: Record<string, string | number | undefined>) => {
      const sp = new URLSearchParams(searchParams);
      for (const key of ["tab", "includingReplies", "oldestFirst", "page", "q"]) {
        if (Object.prototype.hasOwnProperty.call(updates, key)) {
          if (updates[key] !== undefined && updates[key] !== null && updates[key] !== "") {
            sp.set(key, String(updates[key]));
          } else {
            sp.delete(key);
          }
        }
      }
      router.push(`${pathname}?${sp.toString()}`);
    },
    [searchParams, pathname, router],
  );

  const fetchPostsRef = useRef<() => Promise<void> | null>(null);

  const fetchPosts = useCallback(async () => {
    if (status.state !== "authenticated") return;
    setLoading(true);
    setError(null);

    const usePage = page;
    const params: {
      offset: number;
      limit: number;
      order: "asc" | "desc";
      focusUserId?: string;
      query?: string;
      tag?: string;
      ownedBy?: string;
      replyTo?: string;
    } = {
      offset: (usePage - 1) * Config.POSTS_PAGE_SIZE,
      limit: Config.POSTS_PAGE_SIZE + 1,
      order: oldestFirst ? "asc" : "desc",
      focusUserId: userId,
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
      if (effectiveOwnedBy) params.ownedBy = effectiveOwnedBy;
      if (!includingReplies) params.replyTo = "";
      fetcher = listPostsDetail(params);
    } else if (effectiveTab === "following") {
      fetcher = listPostsByFolloweesDetail({
        userId: userId!,
        ...params,
        includeSelf: true,
        includeReplies: includingReplies,
      });
    } else if (effectiveTab === "liked") {
      fetcher = listPostsLikedByUserDetail({
        userId: userId!,
        ...params,
        includeReplies: includingReplies,
      });
    } else {
      fetcher = listPostsDetail({
        ...params,
        ...(includingReplies ? {} : { replyTo: "" }),
      });
    }

    const data = await fetcher.catch((err: unknown) => {
      if (err instanceof Error) {
        setError(err.message || "Failed to fetch posts.");
      } else {
        setError(String(err) || "Failed to fetch posts.");
      }
      return [];
    });
    setHasNext(data.length > Config.POSTS_PAGE_SIZE);
    setPosts(
      data.slice(0, Config.POSTS_PAGE_SIZE).map((post) => ({
        ...post,
        countLikes: Number(post.countLikes ?? 0),
        countReplies: Number(post.countReplies ?? 0),
      })),
    );
    setLoading(false);
    const tabParamMissing = !hasTabParam;
    if (tabParamMissing && tab === "following" && data.length === 0 && !isSearchMode) {
      setQuery({
        tab: "all",
        page: 1,
        includingReplies: undefined,
        oldestFirst: undefined,
      });
    }
  }, [
    status.state,
    page,
    oldestFirst,
    userId,
    searchQueryObj,
    isSearchMode,
    resolvedOwnedBy,
    includingReplies,
    effectiveTab,
    hasTabParam,
    tab,
    setQuery,
  ]);

  useEffect(() => {
    fetchPostsRef.current = fetchPosts;
  }, [fetchPosts]);

  useEffect(() => {
    fetchPosts();
  }, [fetchPosts]);

  useEffect(() => {
    function handler(e: MouseEvent) {
      const target = e.target as HTMLElement;
      const block = target.closest(".image-block");
      if (block) {
        block.classList.toggle("expanded");
        e.stopPropagation();
      }
    }
    document.body.addEventListener("click", handler);
    return () => {
      document.body.removeEventListener("click", handler);
    };
  }, []);

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
      setQuery({
        tab: "following",
        includingReplies: undefined,
        oldestFirst: undefined,
        page: 1,
        q: undefined,
      });
      setTimeout(() => fetchPostsRef.current && fetchPostsRef.current(), 100);
    } catch (err: unknown) {
      if (err instanceof Error) {
        setError(err.message || "Failed to post.");
      } else {
        setError(String(err) || "Failed to post.");
      }
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
      await createPost({ content, tags, replyTo });
      setReplyBody("");
      setReplyTo(null);
      setTimeout(() => fetchPostsRef.current && fetchPostsRef.current(), 100);
    } catch (err: unknown) {
      if (err instanceof Error) {
        setReplyError(err.message || "Failed to reply.");
      } else {
        setReplyError(String(err) || "Failed to reply.");
      }
    } finally {
      setReplySubmitting(false);
    }
  }

  async function handleLike(post: PostDetail) {
    const oldCountLikes = post.countLikes ?? 0;
    setPosts((prev) =>
      prev.map((p) =>
        p.id === post.id
          ? {
              ...p,
              isLikedByFocusUser: !p.isLikedByFocusUser,
              countLikes: Number(p.countLikes ?? 0) + (p.isLikedByFocusUser ? -1 : 1),
            }
          : p,
      ),
    );
    try {
      if (post.isLikedByFocusUser) {
        await removeLike(post.id);
      } else {
        await addLike(post.id);
      }
      setTimeout(() => fetchPostsRef.current && fetchPostsRef.current(), 100);
    } catch {
      setPosts((prev) =>
        prev.map((p) =>
          p.id === post.id
            ? {
                ...p,
                allowLikes: false,
                countLikes: oldCountLikes,
                isLikedByFocusUser: false,
              }
            : p,
        ),
      );
    }
  }

  if (status.state !== "authenticated") return null;

  return (
    <main className="max-w-3xl mx-auto mt-4 p-4" onClick={clearError}>
      <PostForm
        body={body}
        setBody={setBody}
        onSubmit={handleSubmit}
        submitting={submitting}
        error={error}
        onErrorClear={clearError}
        contentLengthLimit={isAdmin ? undefined : Config.CONTENT_LENGTH_LIMIT}
      />
      <div className="h-6" />
      <div className="flex gap-1 mb-2">
        {TAB_VALUES.map((t) => (
          <button
            key={t}
            className={`px-3 py-1 rounded-t text-sm font-normal cursor-pointer
              ${tab === t && !isSearchMode ? "bg-blue-100 text-gray-800" : "bg-blue-50 text-gray-400 hover:bg-blue-100"}`}
            style={{ minWidth: 110 }}
            onClick={() =>
              setQuery({
                tab: t,
                page: 1,
                q: undefined,
                includingReplies: undefined,
                oldestFirst: undefined,
              })
            }
          >
            {t.charAt(0).toUpperCase() + t.slice(1)}
          </button>
        ))}
        <label className="flex pl-2 items-center gap-1 text-sm ml-4 text-gray-700 cursor-pointer">
          <input
            type="checkbox"
            checked={includingReplies}
            onChange={(e) =>
              setQuery({ includingReplies: e.target.checked ? "1" : undefined, page: 1 })
            }
            className="cursor-pointer"
          />
          Including replies
        </label>
        <label className="flex pl-2 items-center gap-1 text-sm text-gray-700 cursor-pointer">
          <input
            type="checkbox"
            checked={oldestFirst}
            onChange={(e) => setQuery({ oldestFirst: e.target.checked ? "1" : undefined, page: 1 })}
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
                avatarVersion={post.ownedBy === userId ? (userUpdatedAt ?? undefined) : undefined}
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
                  className="mt-8 flex flex-col"
                  onCancel={() => {
                    setReplyTo(null);
                    setReplyError(null);
                  }}
                  contentLengthLimit={isAdmin ? undefined : Config.CONTENT_LENGTH_LIMIT}
                />
              )}
            </li>
          ))}
        </ul>
        <div className="mt-6 flex justify-center gap-4">
          <button
            className="px-3 py-1 rounded border text-gray-800 bg-blue-100 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
            onClick={() => setQuery({ page: Math.max(page - 1, 1) })}
            disabled={page === 1}
          >
            Prev
          </button>
          <span className="text-gray-800">Page {page}</span>
          <button
            className="px-3 py-1 rounded border text-gray-800 bg-blue-100 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
            onClick={() => setQuery({ page: hasNext ? page + 1 : page })}
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
