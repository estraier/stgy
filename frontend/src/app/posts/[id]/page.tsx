"use client";

import { use, useEffect, useState } from "react";
import { getPostDetail } from "@/api/posts";
import type { PostDetail } from "@/api/model";
import { notFound } from "next/navigation";
import { useRequireLogin } from "@/hooks/useRequireLogin";

type Props = { params: Promise<{ id: string }> | { id: string } };

export default function PostDetailPage({ params }: Props) {
  const ready = useRequireLogin();
  const { id } = use(params);
  const [post, setPost] = useState<PostDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!ready) return;
    let canceled = false;
    setLoading(true);
    setError(null);
    getPostDetail(id)
      .then((data) => {
        if (!canceled) setPost(data);
      })
      .catch((err: any) => {
        if (!canceled) {
          if (err.status === 404) {
            notFound();
            return;
          }
          if (err.message) {
            setError(err.message);
          } else {
            setError("Failed to fetch post detail.");
          }
        }
      })
      .finally(() => {
        if (!canceled) setLoading(false);
      });
    return () => {
      canceled = true;
    };
  }, [id, ready]);

  if (!ready) return null; // 認証が終わるまで何も描画しない

  if (loading) {
    return <div className="text-center mt-10">Loading…</div>;
  }
  if (error) {
    return <div className="text-center mt-10 text-red-600">{error}</div>;
  }
  if (!post) {
    return <div className="text-center mt-10 text-gray-500">No post found.</div>;
  }

  return (
    <main className="max-w-xl mx-auto mt-10 p-6 bg-white shadow rounded">
      <h1 className="text-2xl font-bold mb-4">Post Detail</h1>
      <div className="font-semibold text-lg mb-2">{post.content}</div>
      <div className="text-xs text-gray-500 mb-4">
        By: {post.owner_nickname} &nbsp;|&nbsp; {new Date(post.created_at).toLocaleString()}
      </div>
      <div className="text-sm text-gray-700 mb-2">
        Replies: {post.reply_count} | Likes: {post.like_count}
      </div>
      <div className="flex flex-wrap gap-2 mb-2">
        {post.tags.map((tag) => (
          <span key={tag} className="px-2 py-1 bg-gray-100 rounded text-xs">
            {tag}
          </span>
        ))}
      </div>
    </main>
  );
}
