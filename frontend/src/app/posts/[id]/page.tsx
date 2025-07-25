"use client";

import { use } from "react";
import { useEffect, useState } from "react";
import {
  getPostDetail,
  listLikers,
  addLike,
  removeLike,
  updatePost,
  createPost,
  listPostsDetail,
} from "@/api/posts";
import type { PostDetail, User } from "@/api/model";
import { useRequireLogin } from "@/hooks/useRequireLogin";
import PostCard from "@/components/PostCard";
import PostForm from "@/components/PostForm";

const LIKER_PAGE_SIZE = 10;
const REPLY_PAGE_SIZE = 5;

type Props = { params: Promise<{ id: string }> | { id: string } };

export default function PostDetailPage({ params }: Props) {
  // 正しくparams展開
  const { id: postId } = use(params);

  const status = useRequireLogin();
  const user_id = status.state === "authenticated" ? status.user.user_id : undefined;
  const isAdmin = status.state === "authenticated" && status.user.is_admin;

  // メイン投稿状態
  const [post, setPost] = useState<PostDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // 編集
  const [editing, setEditing] = useState(false);
  const [editBody, setEditBody] = useState("");
  const [editTags, setEditTags] = useState<string[]>([]);
  const [editSubmitting, setEditSubmitting] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);

  // Likeユーザ
  const [likers, setLikers] = useState<User[]>([]);
  const [likerPage, setLikerPage] = useState(1);
  const [likerHasNext, setLikerHasNext] = useState(false);
  const [likerLoading, setLikerLoading] = useState(false);

  // 返信リスト
  const [replies, setReplies] = useState<PostDetail[]>([]);
  const [replyPage, setReplyPage] = useState(1);
  const [replyHasNext, setReplyHasNext] = useState(false);
  const [replyLoading, setReplyLoading] = useState(false);

  // 返信フォーム
  const [replyingTo, setReplyingTo] = useState<string | null>(null);
  const [replyBody, setReplyBody] = useState("");
  const [replyError, setReplyError] = useState<string | null>(null);
  const [replySubmitting, setReplySubmitting] = useState(false);

  // メイン投稿取得
  useEffect(() => {
    if (!user_id) return;
    setLoading(true);
    setError(null);
    getPostDetail(postId, user_id)
      .then((data) => {
        setPost(data);
        setEditBody(data.content);
        setEditTags(data.tags || []);
      })
      .catch((err) => setError(err?.message ?? "Failed to fetch post."))
      .finally(() => setLoading(false));
  }, [postId, user_id]);

  // Likeユーザ取得
  useEffect(() => {
    if (!post) return;
    setLikerLoading(true);
    listLikers(post.id, {
      offset: (likerPage - 1) * LIKER_PAGE_SIZE,
      limit: LIKER_PAGE_SIZE + 1,
      order: "desc",
    })
      .then((users) => {
        setLikers(users.slice(0, LIKER_PAGE_SIZE));
        setLikerHasNext(users.length > LIKER_PAGE_SIZE);
      })
      .finally(() => setLikerLoading(false));
  }, [post?.id, likerPage]);

  // 返信リスト取得
  useEffect(() => {
    if (!user_id || !post) return;
    setReplyLoading(true);
    listPostsDetail({
      reply_to: post.id,
      offset: (replyPage - 1) * REPLY_PAGE_SIZE,
      limit: REPLY_PAGE_SIZE + 1,
      order: "desc",
      focus_user_id: user_id,
    })
      .then((list) => {
        setReplies(list.slice(0, REPLY_PAGE_SIZE));
        setReplyHasNext(list.length > REPLY_PAGE_SIZE);
      })
      .finally(() => setReplyLoading(false));
  }, [user_id, post?.id, replyPage]);

  // メイン投稿Like
  async function handleLike(post: PostDetail) {
    setPost((prev) =>
      prev
        ? {
            ...prev,
            is_liked_by_focus_user: !prev.is_liked_by_focus_user,
            like_count: prev.like_count + (prev.is_liked_by_focus_user ? -1 : 1),
          }
        : prev,
    );
    try {
      if (post.is_liked_by_focus_user) {
        await removeLike(post.id);
      } else {
        await addLike(post.id);
      }
    } finally {
      getPostDetail(post.id, user_id).then(setPost);
      setLikerPage(1);
    }
  }

  // 返信記事Like
  async function handleReplyLike(reply: PostDetail) {
    setReplies((prev) =>
      prev.map((p) =>
        p.id === reply.id
          ? {
              ...p,
              is_liked_by_focus_user: !p.is_liked_by_focus_user,
              like_count: p.like_count + (p.is_liked_by_focus_user ? -1 : 1),
            }
          : p,
      ),
    );
    try {
      if (reply.is_liked_by_focus_user) {
        await removeLike(reply.id);
      } else {
        await addLike(reply.id);
      }
    } finally {
      // 最新値で補正
      listPostsDetail({
        reply_to: postId,
        offset: (replyPage - 1) * REPLY_PAGE_SIZE,
        limit: REPLY_PAGE_SIZE + 1,
        order: "asc",
        focus_user_id: user_id,
      }).then((list) => {
        setReplies(list.slice(0, REPLY_PAGE_SIZE));
        setReplyHasNext(list.length > REPLY_PAGE_SIZE);
      });
    }
  }

  // 編集
  async function handleEditSubmit(e: React.FormEvent) {
    e.preventDefault();
    setEditSubmitting(true);
    setEditError(null);
    try {
      if (!editBody.trim()) throw new Error("Content is required.");
      if (editBody.length > 5000) throw new Error("Content is too long (max 5000 chars).");
      if (editTags.length > 5) throw new Error("You can specify up to 5 tags.");
      for (const tag of editTags) {
        if (tag.length > 50) throw new Error(`Tag "${tag}" is too long (max 50 chars).`);
      }
      await updatePost(postId, { content: editBody, tags: editTags });
      setEditing(false);
      getPostDetail(postId, user_id).then(setPost);
    } catch (err: any) {
      setEditError(err?.message ?? "Failed to update post.");
    } finally {
      setEditSubmitting(false);
    }
  }

  // 返信フォーム送信
  async function handleReplySubmit(e: React.FormEvent) {
    e.preventDefault();
    setReplySubmitting(true);
    setReplyError(null);
    try {
      if (!replyBody.trim()) throw new Error("Content is required.");
      if (replyBody.length > 5000) throw new Error("Content is too long (max 5000 chars).");
      await createPost({ content: replyBody, tags: [], reply_to: replyingTo });
      setReplyBody("");
      setReplyingTo(null);
      setReplyPage(1);
      // メイン・レス再取得
      getPostDetail(postId, user_id).then(setPost);
      listPostsDetail({
        reply_to: postId,
        offset: 0,
        limit: REPLY_PAGE_SIZE + 1,
        order: "asc",
        focus_user_id: user_id,
      }).then((list) => {
        setReplies(list.slice(0, REPLY_PAGE_SIZE));
        setReplyHasNext(list.length > REPLY_PAGE_SIZE);
      });
    } catch (err: any) {
      setReplyError(err?.message ?? "Failed to reply.");
    } finally {
      setReplySubmitting(false);
    }
  }

  // 編集権限
  const canEdit = isAdmin || (post && post.owned_by === user_id);

  if (!user_id) return null;
  if (loading) return <div className="text-center mt-10">Loading…</div>;
  if (error) return <div className="text-center mt-10 text-red-600">{error}</div>;
  if (!post) return <div className="text-center mt-10 text-gray-500">No post found.</div>;

  return (
    <main className="max-w-3xl mx-auto mt-8 p-4">
      {/* メイン記事 */}
      <PostCard
        post={post}
        truncated={false}
        showActions={true}
        onLike={() => handleLike(post)}
        onReply={() => setReplyingTo(post.id)}
        isReplying={replyingTo === post.id}
        className="mb-8"
      />
      {replyingTo === post.id && (
        <div className="mb-6">
          <PostForm
            body={replyBody}
            setBody={setReplyBody}
            onSubmit={handleReplySubmit}
            submitting={replySubmitting}
            error={replyError}
            onCancel={() => {
              setReplyingTo(null);
              setReplyBody("");
              setReplyError(null);
            }}
            buttonLabel="Reply"
            placeholder="Write your reply. Use #tag lines for tags."
          />
        </div>
      )}
      <div className="flex gap-4 mb-4 text-sm items-center">
        <span>
          By{" "}
          <a href={`/users/${post.owned_by}`} className="text-blue-600 hover:underline">
            {post.owner_nickname}
          </a>
        </span>
        <span>{new Date(post.created_at).toLocaleString()}</span>
        {canEdit && !editing && (
          <button
            className="ml-auto px-2 py-1 border rounded bg-yellow-100 text-yellow-800 hover:bg-yellow-200"
            onClick={() => setEditing(true)}
          >
            Edit
          </button>
        )}
      </div>
      {editing && (
        <div className="mb-4">
          <PostForm
            body={editBody}
            setBody={setEditBody}
            onSubmit={handleEditSubmit}
            submitting={editSubmitting}
            error={editError}
            onCancel={() => setEditing(false)}
            buttonLabel="Save"
            placeholder="Edit your post"
          />
        </div>
      )}
      {/* Likeユーザ */}
      <div className="my-6">
        <div className="font-bold mb-2 flex items-center gap-2">
          Liked by
          <button
            className="px-2 py-1"
            disabled={likerPage === 1}
            onClick={() => setLikerPage((p) => Math.max(1, p - 1))}
          >
            ◀
          </button>
          <span>Page {likerPage}</span>
          <button
            className="px-2 py-1"
            disabled={!likerHasNext}
            onClick={() => setLikerPage((p) => p + 1)}
          >
            ▶
          </button>
        </div>
        <div className="flex flex-wrap gap-2">
          {likerLoading ? (
            <span>Loading…</span>
          ) : likers.length === 0 ? (
            <span className="text-gray-400">No likes yet</span>
          ) : (
            likers.map((user) => (
              <a
                key={user.id}
                href={`/users/${user.id}`}
                className="px-2 py-1 bg-gray-100 rounded hover:bg-blue-50"
              >
                {user.nickname}
              </a>
            ))
          )}
        </div>
      </div>
      {/* 返信リスト */}
      <div className="mt-8 mb-2 font-bold text-lg flex gap-2 items-center">
        Replies
        <button
          className="px-2 py-1"
          disabled={replyPage === 1}
          onClick={() => setReplyPage((p) => Math.max(1, p - 1))}
        >
          ◀
        </button>
        <span>Page {replyPage}</span>
        <button
          className="px-2 py-1"
          disabled={!replyHasNext}
          onClick={() => setReplyPage((p) => p + 1)}
        >
          ▶
        </button>
      </div>
      <ul className="space-y-4">
        {replyLoading ? (
          <li>Loading…</li>
        ) : replies.length === 0 ? (
          <li className="text-gray-400">No replies yet</li>
        ) : (
          replies.map((rep) => (
            <li key={rep.id}>
              <PostCard
                post={rep}
                showActions={true}
                onLike={() => handleReplyLike(rep)}
                onReply={() => setReplyingTo(rep.id)}
                isReplying={replyingTo === rep.id}
              />
              {replyingTo === rep.id && (
                <div className="mt-2">
                  <PostForm
                    body={replyBody}
                    setBody={setReplyBody}
                    onSubmit={handleReplySubmit}
                    submitting={replySubmitting}
                    error={replyError}
                    onCancel={() => {
                      setReplyingTo(null);
                      setReplyBody("");
                      setReplyError(null);
                    }}
                    buttonLabel="Reply"
                    placeholder="Write your reply. Use #tag lines for tags."
                    className="mt-2 flex flex-col gap-2 pt-3"
                  />
                </div>
              )}
            </li>
          ))
        )}
      </ul>
    </main>
  );
}
