"use client";

import { Config } from "@/config";
import { useEffect, useState, useRef, useCallback, useMemo } from "react";
import {
  listPosts,
  listPostsByFollowees,
  listPostsLikedByUser,
  createPost,
  addLike,
  removeLike,
  searchPosts,
} from "@/api/posts";
import { RecommendPostsForUser, RecommendPostsForPost } from "@/api/aiPost";
import { listUsers } from "@/api/users";
import type { Post } from "@/api/models";
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

const RESTORE_ID_KEY = "lastPostId";
const RESTORE_PAGE_KEY = "lastPage";
const MAX_SEARCH_PAGES = 10;

export default function PageBody() {
  const status = useRequireLogin();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const isAdmin = status && status.state === "authenticated" && status.session.userIsAdmin;

  const [posts, setPosts] = useState<Post[]>([]);
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
  const [pendingRestore, setPendingRestore] = useState<{ postId: string; page: number } | null>(
    null,
  );

  function getQueryParams() {
    const sp = searchParams;
    return {
      tab: (sp.get("tab") as "following" | "liked" | "all") || "following",
      includingReplies: sp.get("includingReplies") === "1",
      oldestFirst: sp.get("oldestFirst") === "1",
      everyPost: sp.get("everyPost") === "1",
      page: Math.max(Number(sp.get("page")) || 1, 1),
      qParam: sp.get("q") ?? "",
    };
  }
  const { tab, includingReplies, oldestFirst, everyPost, page, qParam } = getQueryParams();

  const similarPostId = useMemo(() => {
    const m = qParam.match(/^~([0-9A-Z]{16})$/);
    return m ? m[1] : null;
  }, [qParam]);
  const isSimilarMode = similarPostId !== null;

  const searchQueryObj: PostSearchQuery = useMemo(() => {
    if (!qParam || isSimilarMode) return {};
    return parsePostSearchQuery(qParam) as PostSearchQuery;
  }, [qParam, isSimilarMode]);

  const userId = status.state === "authenticated" ? status.session.userId : undefined;
  const userUpdatedAt = status.state === "authenticated" ? status.session.userUpdatedAt : null;
  const userLocale = status.state === "authenticated" ? status.session.userLocale : "en";
  const hasTabParam = searchParams.has("tab");

  const isSearchMode = isSimilarMode
    ? true
    : !!(
        (searchQueryObj.query && searchQueryObj.query.length > 0) ||
        (searchQueryObj.tag && searchQueryObj.tag.length > 0) ||
        (searchQueryObj.ownedBy && searchQueryObj.ownedBy.length > 0)
      );

  const isFullTextSearch = isSearchMode && !isSimilarMode && !!searchQueryObj.query;

  const effectiveTab = isSearchMode ? "all" : tab;

  useEffect(() => {
    let canceled = false;
    if (
      isSearchMode &&
      !isSimilarMode &&
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
  }, [searchQueryObj.ownedBy, isSearchMode, isSimilarMode, userId]);

  const setQuery = useCallback(
    (updates: Record<string, string | number | undefined>) => {
      const sp = new URLSearchParams(searchParams);
      for (const key of ["tab", "includingReplies", "oldestFirst", "everyPost", "page", "q"]) {
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
    const baseOrder: "asc" | "desc" = oldestFirst ? "asc" : "desc";
    const order: "asc" | "desc" = !isSearchMode && effectiveTab === "all" ? "desc" : baseOrder;

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
      order,
      focusUserId: userId,
    };

    let fetcher: Promise<Post[]>;
    let effectiveOwnedBy = searchQueryObj.ownedBy;

    if (
      isSearchMode &&
      !isSimilarMode &&
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
      if (isSimilarMode) {
        fetcher = RecommendPostsForPost(similarPostId!, {
          offset: params.offset,
          limit: params.limit,
          order: params.order,
        });
      } else if (isFullTextSearch) {
        if (usePage > MAX_SEARCH_PAGES) {
          setPosts([]);
          setHasNext(false);
          setLoading(false);
          return;
        }
        fetcher = searchPosts({
          query: searchQueryObj.query!,
          offset: params.offset,
          limit: params.limit,
          locale: userLocale,
        });
      } else {
        if (searchQueryObj.tag) params.tag = searchQueryObj.tag;
        if (effectiveOwnedBy) params.ownedBy = effectiveOwnedBy;
        if (!includingReplies) params.replyTo = "";
        fetcher = listPosts(params);
      }
    } else if (effectiveTab === "following") {
      fetcher = listPostsByFollowees({
        userId: userId!,
        ...params,
        includeSelf: true,
        includeReplies: includingReplies,
        limitPerUser: Config.TIMELINE_PER_USER_LIMIT,
      });
    } else if (effectiveTab === "liked") {
      fetcher = listPostsLikedByUser({
        userId: userId!,
        ...params,
        includeReplies: includingReplies,
      });
    } else {
      fetcher = (async () => {
        if (everyPost) {
          return listPosts({
            ...params,
            replyTo: "",
          });
        }

        const recParams = { offset: params.offset, limit: params.limit, order: params.order };
        try {
          const rec = await RecommendPostsForUser(userId!, recParams);
          if (rec.length > 0) return rec;
        } catch {}
        return listPosts({
          ...params,
          replyTo: "",
        });
      })();
    }

    const data = await fetcher.catch((err: unknown) => {
      if (err instanceof Error) {
        setError(err.message || "Failed to fetch posts.");
      } else {
        setError(String(err) || "Failed to fetch posts.");
      }
      return [];
    });

    const hasMoreItems = data.length > Config.POSTS_PAGE_SIZE;
    const forceNoNext = isFullTextSearch && usePage >= MAX_SEARCH_PAGES;
    setHasNext(hasMoreItems && !forceNoNext);

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
        everyPost: undefined,
      });
    }
  }, [
    status.state,
    page,
    oldestFirst,
    everyPost,
    userId,
    userLocale,
    searchQueryObj,
    isSearchMode,
    isSimilarMode,
    similarPostId,
    resolvedOwnedBy,
    includingReplies,
    effectiveTab,
    hasTabParam,
    tab,
    setQuery,
    isFullTextSearch,
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

  useEffect(() => {
    try {
      const st = window.history.state as Record<string, unknown> | null;
      const pid =
        st && typeof st[RESTORE_ID_KEY] === "string" ? (st[RESTORE_ID_KEY] as string) : null;
      const pgRaw = st && RESTORE_PAGE_KEY in st ? (st[RESTORE_PAGE_KEY] as unknown) : null;
      const pg =
        typeof pgRaw === "number" ? pgRaw : typeof pgRaw === "string" ? parseInt(pgRaw, 10) : NaN;
      if (pid && !Number.isNaN(pg)) {
        setPendingRestore({ postId: pid, page: Math.max(1, pg || 1) });
      }
    } catch {}
  }, []);

  useEffect(() => {
    if (!pendingRestore) return;
    if (pendingRestore.page !== page) {
      setQuery({ page: pendingRestore.page });
      return;
    }
    if (loading) return;
    const el = document.getElementById(`post-${pendingRestore.postId}`);
    if (el) {
      const absoluteTop = window.scrollY + el.getBoundingClientRect().top;
      const desiredTop = Math.max(0, absoluteTop - window.innerHeight * 0.4);
      window.scrollTo({ top: desiredTop });
    }
    setPendingRestore(null);
    try {
      const st = (window.history.state as Record<string, unknown>) || {};
      if (RESTORE_ID_KEY in st || RESTORE_PAGE_KEY in st) {
        const rest: Record<string, unknown> = { ...st };
        delete rest[RESTORE_ID_KEY];
        delete rest[RESTORE_PAGE_KEY];
        window.history.replaceState(rest, "");
      }
    } catch {}
  }, [pendingRestore, page, loading, setQuery]);

  function clearError() {
    if (error) setError(null);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const { content, tags, attrs } = parseBodyAndTags(body);
      if (!content.trim()) {
        throw new Error("Content is required.");
      }
      if (!isAdmin && content.length > Config.CONTENT_LENGTH_LIMIT) {
        throw new Error(`Content is too long (max ${Config.CONTENT_LENGTH_LIMIT} chars).`);
      }
      if (!isAdmin && tags.length > Config.TAGS_NUMBER_LIMIT) {
        throw new Error(`You can specify up to ${Config.TAGS_NUMBER_LIMIT} tags.`);
      }
      for (const tag of tags) {
        if (tag.length > 50) throw new Error(`Tag "${tag}" is too long (max 50 chars).`);
      }
      const allowLikes = attrs.noLikes === true ? false : true;
      const allowReplies = attrs.noReplies === true ? false : true;
      const locale = typeof attrs.locale === "string" ? attrs.locale : null;
      await createPost({ content, tags, allowLikes, allowReplies, locale });
      setBody("");
      setQuery({
        tab: "following",
        includingReplies: undefined,
        oldestFirst: undefined,
        everyPost: undefined,
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
      const { content, tags, attrs } = parseBodyAndTags(replyBody);
      if (!content.trim()) {
        throw new Error("Content is required.");
      }
      if (!isAdmin && content.length > Config.CONTENT_LENGTH_LIMIT) {
        throw new Error(`Content is too long (max ${Config.CONTENT_LENGTH_LIMIT} chars).`);
      }
      if (!isAdmin && tags.length > Config.TAGS_NUMBER_LIMIT) {
        throw new Error(`You can specify up to ${Config.TAGS_NUMBER_LIMIT} tags.`);
      }
      for (const tag of tags) {
        if (tag.length > 50) throw new Error(`Tag "${tag}" is too long (max 50 chars).`);
      }
      const allowLikes = attrs.noLikes === true ? false : true;
      const allowReplies = attrs.noReplies === true ? false : true;
      const locale = typeof attrs.locale === "string" ? attrs.locale : null;
      await createPost({ content, tags, replyTo, allowLikes, allowReplies, locale });
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

  async function handleLike(post: Post) {
    const postId = post.id;
    const prevLiked = !!post.isLikedByFocusUser;
    const prevCountLikes = Number(post.countLikes ?? 0);
    setPosts((prev) =>
      prev.map((p) =>
        p.id === postId
          ? {
              ...p,
              isLikedByFocusUser: !prevLiked,
              countLikes: Number(p.countLikes ?? 0) + (prevLiked ? -1 : 1),
            }
          : p,
      ),
    );
    try {
      if (prevLiked) {
        await removeLike(postId);
      } else {
        await addLike(postId);
      }
    } catch {
      setPosts((prev) =>
        prev.map((p) =>
          p.id === postId
            ? {
                ...p,
                allowLikes: false,
                countLikes: prevCountLikes,
                isLikedByFocusUser: prevLiked,
              }
            : p,
        ),
      );
    }
  }

  if (status.state !== "authenticated") return null;

  const showEveryPost = !isSearchMode && effectiveTab === "all";
  const showLegacyOptions = (isSearchMode || effectiveTab !== "all") && !isFullTextSearch;

  return (
    <main className="max-w-3xl mx-auto mt-4 p-1 sm:p-4" onClick={clearError}>
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
            className={`px-3 max-md:px-2 py-1 min-w-0 sm:min-w-[110px] rounded-t text-sm font-normal cursor-pointer
              ${tab === t && !isSearchMode ? "bg-blue-100 text-gray-800" : "bg-blue-50 text-gray-400 hover:bg-blue-100"}`}
            onClick={() =>
              setQuery({
                tab: t,
                page: 1,
                q: undefined,
                includingReplies: undefined,
                oldestFirst: undefined,
                everyPost: undefined,
              })
            }
          >
            {t.charAt(0).toUpperCase() + t.slice(1)}
          </button>
        ))}

        {showLegacyOptions && (
          <>
            {!isSimilarMode && (
              <label className="flex pl-2 items-center gap-1 text-sm ml-4 text-gray-700 cursor-pointer max-md:pl-0">
                <input
                  type="checkbox"
                  checked={includingReplies}
                  onChange={(e) =>
                    setQuery({ includingReplies: e.target.checked ? "1" : undefined, page: 1 })
                  }
                  className="cursor-pointer"
                />
                <span className="hidden md:inline">Including replies</span>
                <span className="md:hidden scale-x-80 -ml-1" aria-hidden>
                  Replies
                </span>
              </label>
            )}
            <label className="flex pl-2 items-center gap-1 text-sm text-gray-700 cursor-pointer max-md:pl-0">
              <input
                type="checkbox"
                checked={oldestFirst}
                onChange={(e) =>
                  setQuery({ oldestFirst: e.target.checked ? "1" : undefined, page: 1 })
                }
                className="cursor-pointer"
              />
              <span className="hidden md:inline">Oldest first</span>
              <span className="md:hidden scale-x-80 -ml-1" aria-hidden>
                Oldest
              </span>
            </label>
          </>
        )}

        {showEveryPost && (
          <label className="flex pl-2 items-center gap-1 text-sm ml-4 text-gray-700 cursor-pointer max-md:pl-0">
            <input
              type="checkbox"
              checked={everyPost}
              onChange={(e) => setQuery({ everyPost: e.target.checked ? "1" : undefined, page: 1 })}
              className="cursor-pointer"
            />
            <span>Every post</span>
          </label>
        )}
      </div>

      {isSearchMode && (
        <div className="mb-2 text-sm text-gray-500">
          Posts matching{" "}
          <span className="bg-gray-200 rounded px-2 py-0.5 text-gray-700">
            {isSimilarMode ? `~${similarPostId}` : serializePostSearchQuery(searchQueryObj)}
          </span>
        </div>
      )}

      <div>
        {loading && <div className="text-gray-500">Loading…</div>}
        <ul className="space-y-4">
          {posts.map((post, idx) => (
            <li
              key={post.id}
              id={`post-${post.id}`}
              onMouseDown={() => {
                try {
                  const st = (window.history.state as Record<string, unknown>) || {};
                  window.history.replaceState(
                    { ...st, [RESTORE_ID_KEY]: post.id, [RESTORE_PAGE_KEY]: page },
                    "",
                  );
                } catch {}
              }}
            >
              <PostCard
                post={post}
                avatarVersion={post.ownedBy === userId ? (userUpdatedAt ?? undefined) : undefined}
                onLike={handleLike}
                onReply={() => {
                  setReplyTo(post.id);
                  setReplyBody("");
                  setReplyError(null);
                }}
                focusUserId={userId}
                focusUserIsAdmin={!!isAdmin}
                idPrefix={`p${idx + 1}-h`}
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
                  autoFocus
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
