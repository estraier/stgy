"use client";

import { useEffect, useState } from "react";
import { listPostsDetail, createPost, addLike, removeLike } from "@/api/posts";
import type { PostDetail } from "@/api/model";
import { useRouter } from "next/navigation";
import { useRequireLogin } from "@/hooks/useRequireLogin";
import { parseBodyAndTags } from "@/utils/parseBodyAndTags";
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
  const [tab, setTab] = useState<"new" | "all">("new");

  const PAGE_SIZE = 20;
  const router = useRouter();
  const user_id = status.state === "authenticated" ? status.user.user_id : undefined;

  useEffect(() => {
    if (status.state !== "authenticated") return;
    let canceled = false;
    setLoading(true);
    setError(null);

    const params: any = { offset: (page - 1) * PAGE_SIZE, limit: PAGE_SIZE, focus_user_id: user_id };
    if (tab === "new") params.reply_to = "";

    listPostsDetail(params)
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
  }, [status, page, user_id, tab]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const { content, tags } = parseBodyAndTags(body);
      if (!content.trim()) throw new Error("Content is required.");
      await createPost({ content, tags });
      setBody("");
      setPage(1);
      const params: any = { offset: 0, limit: PAGE_SIZE, focus_user_id: user_id };
      if (tab === "new") params.reply_to = "";
      listPostsDetail(params).then((data) => {
        setPosts(data);
        setHasNext(data.length === PAGE_SIZE);
      });
    } catch (err: any) {
      setError(err?.message || "Failed to post.");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleLike(post: PostDetail) {
    try {
      if (post.is_liked_by_focus_user) {
        await removeLike(post.id);
      } else {
        await addLike(post.id);
      }
      const params: any = { offset: (page - 1) * PAGE_SIZE, limit: PAGE_SIZE, focus_user_id: user_id };
      if (tab === "new") params.reply_to = "";
      listPostsDetail(params).then(setPosts);
    } catch (err) {
      alert("Failed to update like.");
    }
  }

  if (status.state !== "authenticated") return null;

  return (
    <main className="max-w-2xl mx-auto mt-8 p-4 bg-white shadow rounded">
      {/* 投稿フォーム */}
      <form onSubmit={handleSubmit} className="mb-6 flex flex-col gap-2">
        <textarea
          className="border rounded px-2 py-1 min-h-[64px]"
          placeholder="Write your post. Use #tag lines for tags."
          value={body}
          onChange={e => setBody(e.target.value)}
          maxLength={2000}
        />
        <button
          type="submit"
          className="self-end bg-blue-600 text-white px-4 py-1 rounded disabled:opacity-60"
          disabled={submitting}
        >
          {submitting ? "Posting..." : "Post"}
        </button>
        {error && <div className="text-red-600 text-sm">{error}</div>}
      </form>

      {/* タブUI */}
      <div className="flex gap-1 mb-4">
        <button
          className={`px-3 py-1 rounded-t text-sm font-normal
            ${tab === "new"
              ? "bg-blue-100 text-black"
              : "bg-blue-50 text-gray-400 hover:bg-blue-100"
            }`}
          style={{ minWidth: 110 }}
          onClick={() => { setTab("new"); setPage(1); }}
        >
          New Posts
        </button>
        <button
          className={`px-3 py-1 rounded-t text-sm font-normal
            ${tab === "all"
              ? "bg-blue-100 text-black"
              : "bg-blue-50 text-gray-400 hover:bg-blue-100"
            }`}
          style={{ minWidth: 140 }}
          onClick={() => { setTab("all"); setPage(1); }}
        >
          Including Replies
        </button>
      </div>

      {/* 投稿一覧 */}
      <div>
        {loading && <div className="text-gray-500">Loading…</div>}
        {error && <div className="text-red-600">{error}</div>}
        <ul className="space-y-4">
          {posts.map((post) => (
            <li key={post.id} className="p-4 border rounded shadow-sm">
              <div className="flex gap-2 items-center text-sm mb-1">
                <a
                  className="font-bold text-blue-700 hover:underline"
                  href={`/users/${post.owned_by}`}
                >
                  {post.owner_nickname}
                </a>
                <span className="text-gray-400">|</span>
                <a
                  className="text-gray-500 hover:underline"
                  href={`/posts/${post.id}`}
                >
                  {new Date(post.created_at).toLocaleString()}
                </a>
                {post.reply_to && (
                  <span className="ml-2 text-xs text-gray-500">
                    In response to{" "}
                    <a
                      href={`/posts/${post.reply_to}`}
                      className="text-blue-500 hover:underline"
                    >
                      {post.reply_to_author_name || post.reply_to}
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
                    {post.tags.map(tag => (
                      <span
                        key={tag}
                        className="inline-block bg-gray-200 rounded px-2 py-0.5 mr-1 text-gray-700"
                      >
                        #{tag}
                      </span>
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
                  {post.is_liked_by_focus_user
                    ? <Heart fill="currentColor" size={18} />
                    : <Heart size={18} />}
                  {post.like_count > 0 && <span>{post.like_count}</span>}
                </button>
                <button
                  className={`flex items-center gap-1 px-2 py-1 rounded
                    ${post.is_replied_by_focus_user ? "bg-blue-100 text-blue-600" : "hover:bg-gray-100"}`}
                  onClick={() => alert("Reply form not implemented yet")}
                  type="button"
                  aria-label="Reply"
                >
                  <MessageCircle size={18} />
                  {post.reply_count > 0 && <span>{post.reply_count}</span>}
                </button>
              </div>
            </li>
          ))}
        </ul>
        {/* ページ送り */}
        <div className="mt-6 flex justify-center gap-4">
          <button
            className="px-3 py-1 rounded border"
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page === 1}
          >
            Prev
          </button>
          <span>Page {page}</span>
          <button
            className="px-3 py-1 rounded border"
            onClick={() => setPage((p) => p + 1)}
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
  let plain = text.replace(/[#>*_`~\-!\[\]()]/g, " ").replace(/\s+/g, " ").trim();
  return plain.length > maxLen ? plain.slice(0, maxLen) + "…" : plain;
}
