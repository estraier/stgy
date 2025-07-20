"use client";

import { useEffect, useState } from "react";
import { listPosts } from "@/api/posts";
import type { Post } from "@/api/model";
import { useRouter } from "next/navigation";
import { useRequireLogin } from "@/hooks/useRequireLogin";

export default function PostsPage() {
  const ready = useRequireLogin();
  const [posts, setPosts] = useState<Post[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  useEffect(() => {
    if (!ready) return;
    let canceled = false;
    setLoading(true);
    setError(null);
    listPosts()
      .then((data) => {
        if (!canceled) setPosts(data);
      })
      .catch((err: any) => {
        if (!canceled) {
          if (err.message) {
            setError(err.message);
          } else {
            setError("Failed to fetch posts.");
          }
        }
      })
      .finally(() => {
        if (!canceled) setLoading(false);
      });
    return () => {
      canceled = true;
    };
  }, [router, ready]);

  if (!ready) return null;

  return (
    <main className="max-w-2xl mx-auto mt-10 p-6 bg-white shadow rounded">
      <h2 className="text-xl font-bold mb-4 text-center">Posts</h2>
      {loading && <div className="text-gray-500">Loading…</div>}
      {error && <div className="text-red-600">{error}</div>}
      <ul className="space-y-4">
        {posts.map((post) => (
          <li
            key={post.id}
            className="p-4 border rounded shadow-sm hover:bg-gray-50 cursor-pointer"
            onClick={() => router.push(`/posts/${post.id}`)}
          >
            <div className="font-semibold">{post.content}</div>
            <div className="text-xs text-gray-500 mt-1">
              By: {post.owned_by} &nbsp;|&nbsp; {new Date(post.created_at).toLocaleString()}
            </div>
          </li>
        ))}
      </ul>
      {posts.length === 0 && !loading && !error && (
        <div className="text-gray-500 text-center">No posts found.</div>
      )}
    </main>
  );
}
