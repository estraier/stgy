"use client";

import { useEffect, useState, useRef } from "react";
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

const PAGE_SIZE = 5;
const TAB_VALUES = ["following", "liked", "all"] as const;

export default function PostsPage() {
  const status = useRequireLogin();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  // 状態
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

  // クエリ読み取り
  function getQueryParams() {
    const sp = searchParams;
    const qParam = sp.get("q") ?? "";
    const page = Math.max(Number(sp.get("page")) || 1, 1);
    const tab = qParam ? "all" : (sp.get("tab") as "following" | "liked" | "all") || "following";
    // 検索モードなら including replies はONがデフォルト（[noreply]があればOFF）
    const searchObj = qParam ? parsePostSearchQuery(qParam) : {};
    const includingReplies = qParam ? !searchObj.noreply : sp.get("includingReplies") === "1";
    const oldestFirst = qParam ? !!searchObj.oldest : sp.get("oldestFirst") === "1";
    return { tab, includingReplies, oldestFirst, page, qParam, searchObj };
  }
  const { tab, includingReplies, oldestFirst, page, qParam, searchObj } = getQueryParams();
  const user_id = status.state === "authenticated" ? status.user.user_id : undefined;
  const isSearchMode = !!qParam && (
    (searchObj.query && searchObj.query.length > 0) ||
    (searchObj.tag && searchObj.tag.length > 0) ||
    (searchObj.ownedBy && searchObj.ownedBy.length > 0)
  );

  // ニックネーム→ID解決
  useEffect(() => {
    let canceled = false;
    if (
      isSearchMode &&
      searchObj.ownedBy &&
      !/^[0-9a-fA-F\-]{36}$/.test(searchObj.ownedBy)
    ) {
      (async () => {
        try {
          const users = await listUsers({
            order: "social",
            nickname: searchObj.ownedBy,
            focus_user_id: user_id,
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
    return () => { canceled = true; };
  }, [searchObj.ownedBy, isSearchMode, user_id]);

  // fetchPostsを外部からも叩けるようrefに
  const fetchPostsRef = useRef<() => Promise<void>>();
  async function fetchPosts() {
    if (status.state !== "authenticated") return;
    setLoading(true);
    setError(null);

    let usePage = page;
    let params: any = {
      offset: (usePage - 1) * PAGE_SIZE,
      limit: PAGE_SIZE + 1,
      order: oldestFirst ? "asc" : "desc",
      focus_user_id: user_id,
    };
    let fetcher: Promise<PostDetail[]>;
    let effectiveOwnedBy = searchObj.ownedBy;

    if (
      isSearchMode &&
      searchObj.ownedBy &&
      !/^[0-9a-fA-F\-]{36}$/.test(searchObj.ownedBy)
    ) {
      if (resolvedOwnedBy === undefined) { setLoading(true); return; }
      if (resolvedOwnedBy === "__NO_SUCH_USER__") {
        setPosts([]);
        setLoading(false);
        setHasNext(false);
        return;
      }
      effectiveOwnedBy = resolvedOwnedBy;
    }

    if (isSearchMode) {
      if (searchObj.query) params.query = searchObj.query;
      if (searchObj.tag) params.tag = searchObj.tag;
      if (effectiveOwnedBy) params.owned_by = effectiveOwnedBy;
      if (searchObj.noreply) params.reply_to = "";
      if (!searchObj.noreply) params.reply_to = undefined;
      fetcher = listPostsDetail(params);
    } else if (tab === "following") {
      fetcher = listPostsByFolloweesDetail({
        user_id: user_id!,
        ...params,
        include_self: true,
        include_replies: includingReplies,
      });
    } else if (tab === "liked") {
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

    const data = await fetcher.catch((err: any) => {
      setError(err?.message || "Failed to fetch posts.");
      return [];
    });
    setHasNext(data.length > PAGE_SIZE);
    setPosts(
      data.slice(0, PAGE_SIZE).map((post) => ({
        ...post,
        like_count: Number(post.like_count ?? 0),
        reply_count: Number(post.reply_count ?? 0),
      }))
    );
    setLoading(false);
  }
  fetchPostsRef.current = fetchPosts;

  useEffect(() => { fetchPosts(); }, [
    status.state,
    page,
    tab,
    includingReplies,
    oldestFirst,
    qParam,
    resolvedOwnedBy,
    user_id,
  ]);

  function setQuery(updates: Record<string, string | number | undefined>) {
    const sp = new URLSearchParams(searchParams);
    for (const key of ["tab", "includingReplies", "oldestFirst", "page", "q"]) {
      if (updates[key] !== undefined && updates[key] !== null && updates[key] !== "") {
        sp.set(key, String(updates[key]));
      } else {
        sp.delete(key);
      }
    }
    router.push(`${pathname}?${sp.toString()}`);
  }

  function clearError() { if (error) setError(null); }

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
      setQuery({ ...Object.fromEntries(searchParams), page: 1 });
      setTimeout(() => fetchPostsRef.current && fetchPostsRef.current(), 100);
    } catch (err: any) {
      setError(err?.message || "Failed to post.");
    } finally {
      setSubmitting(false);
    }
  }

  function clearReplyError() { if (replyError) setReplyError(null); }

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
      setQuery({ ...Object.fromEntries(searchParams) });
      setTimeout(() => fetchPostsRef.current && fetchPostsRef.current(), 100);
    } catch (err: any) {
      setReplyError(err?.message || "Failed to reply.");
    } finally {
      setReplySubmitting(false);
    }
  }

  async function handleLike(post: PostDetail) {
    setPosts((prev) =>
      prev.map((p) =>
        p.id === post.id
          ? {
              ...p,
              is_liked_by_focus_user: !p.is_liked_by_focus_user,
              like_count:
                Number(p.like_count ?? 0) + (p.is_liked_by_focus_user ? -1 : 1),
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
      setTimeout(() => fetchPostsRef.current && fetchPostsRef.current(), 100);
    } catch (err) {
      alert("Failed to update like.");
      setTimeout(() => fetchPostsRef.current && fetchPostsRef.current(), 100);
    }
  }

  // 検索中は includingReplies/oldestFirst を q に埋め込んで書き換える
  function handleFlagChange(flag: "includingReplies" | "oldestFirst", value: boolean) {
    if (!isSearchMode) {
      setQuery({ [flag]: value ? "1" : undefined, page: 1 });
      return;
    }
    let updated = { ...searchObj };
    if (flag === "includingReplies") {
      if (!value) {
        updated.noreply = true;
      } else {
        delete updated.noreply;
      }
    }
    if (flag === "oldestFirst") {
      if (value) {
        updated.oldest = true;
      } else {
        delete updated.oldest;
      }
    }
    const nextQ = serializePostSearchQuery(updated);
    setQuery({ q: nextQ, page: 1 });
  }

  // 検索時は常にAllタブ
  function handleTabChange(nextTab: typeof TAB_VALUES[number]) {
    if (isSearchMode) {
      setQuery({ tab: nextTab, q: undefined, page: 1 });
    } else {
      setQuery({ tab: nextTab, page: 1 });
    }
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
        {TAB_VALUES.map((t) => (
          <button
            key={t}
            className={`px-3 py-1 rounded-t text-sm font-normal cursor-pointer
              ${tab === t && !isSearchMode ? "bg-blue-100 text-gray-800" : "bg-blue-50 text-gray-400 hover:bg-blue-100"}`}
            style={{ minWidth: 110 }}
            onClick={() => handleTabChange(t)}
          >
            {t.charAt(0).toUpperCase() + t.slice(1)}
          </button>
        ))}
        <label className="flex items-center gap-1 text-sm ml-4 text-gray-700 cursor-pointer">
          <input
            type="checkbox"
            checked={includingReplies}
            onChange={e => handleFlagChange("includingReplies", e.target.checked)}
            className="cursor-pointer"
          />
          Including replies
        </label>
        <label className="flex items-center gap-1 text-sm text-gray-700 cursor-pointer">
          <input
            type="checkbox"
            checked={oldestFirst}
            onChange={e => handleFlagChange("oldestFirst", e.target.checked)}
            className="cursor-pointer"
          />
          Oldest first
        </label>
      </div>
      {isSearchMode && (
        <div className="mb-2 text-sm text-gray-500">
          Posts matching{" "}
          <span className="bg-gray-200 rounded px-2 py-0.5 text-gray-700">
            {serializePostSearchQuery(searchObj)}
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
                  className="mt-3 flex flex-col gap-2 pt-3"
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
            onClick={() => setQuery({ page: Math.max(page - 1, 1), q: qParam })}
            disabled={page === 1}
          >
            Prev
          </button>
          <span className="text-gray-800">Page {page}</span>
          <button
            className="px-3 py-1 rounded border text-gray-800 bg-blue-100 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
            onClick={() => setQuery({ page: hasNext ? page + 1 : page, q: qParam })}
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
