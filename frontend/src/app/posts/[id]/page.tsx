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
  deletePost,
  listPostsDetail,
} from "@/api/posts";
import type { PostDetail, User } from "@/api/model";
import { useRequireLogin } from "@/hooks/useRequireLogin";
import { useRouter } from "next/navigation";
import PostCard from "@/components/PostCard";
import PostForm from "@/components/PostForm";
import { parseBodyAndTags } from "@/utils/parse";

const LIKER_LIMIT = 10;
const LIKER_MAX = 100;
const REPLY_PAGE_SIZE = 5;

type Props = { params: Promise<{ id: string }> | { id: string } };

export default function PostDetailPage({ params }: Props) {
  const { id: postId } = use(params);

  const status = useRequireLogin();
  const router = useRouter();
  const user_id = status.state === "authenticated" ? status.user.user_id : undefined;
  const isAdmin = status.state === "authenticated" && status.user.is_admin;

  const [post, setPost] = useState<PostDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [editing, setEditing] = useState(false);
  const [editBody, setEditBody] = useState("");
  const [editTags, setEditTags] = useState<string[]>([]);
  const [editSubmitting, setEditSubmitting] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);

  const [likers, setLikers] = useState<User[]>([]);
  const [likerAll, setLikerAll] = useState(false);
  const [likerLoading, setLikerLoading] = useState(false);
  const [likerHasMore, setLikerHasMore] = useState(false);

  const [replies, setReplies] = useState<PostDetail[]>([]);
  const [replyPage, setReplyPage] = useState(1);
  const [replyHasNext, setReplyHasNext] = useState(false);
  const [replyLoading, setReplyLoading] = useState(false);

  const [replyingTo, setReplyingTo] = useState<string | null>(null);
  const [replyBody, setReplyBody] = useState("");
  const [replyError, setReplyError] = useState<string | null>(null);
  const [replySubmitting, setReplySubmitting] = useState(false);

  useEffect(() => {
    if (!user_id) return;
    setLoading(true);
    setError(null);
    getPostDetail(postId, user_id)
      .then((data) => {
        setPost(data);
        const tagLine = data.tags && data.tags.length > 0 ? "#" + data.tags.join(", #") + "\n" : "";
        setEditBody(tagLine + data.content);
        setEditTags(data.tags || []);
      })
      .catch((err) => setError(err?.message ?? "Failed to fetch post."))
      .finally(() => setLoading(false));
  }, [postId, user_id]);

  useEffect(() => {
    if (!post) return;
    setLikerLoading(true);
    const limit = likerAll ? LIKER_MAX + 1 : LIKER_LIMIT + 1;
    listLikers(post.id, {
      offset: 0,
      limit,
      order: "desc",
    })
      .then((users) => {
        if (likerAll) {
          setLikers(users.slice(0, LIKER_MAX));
          setLikerHasMore(users.length > LIKER_MAX);
        } else {
          setLikers(users.slice(0, LIKER_LIMIT));
          setLikerHasMore(users.length > LIKER_LIMIT);
        }
      })
      .finally(() => setLikerLoading(false));
  }, [post?.id, likerAll]);

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

  async function handleLike(post: PostDetail) {
    setPost((prev) =>
      prev
        ? {
            ...prev,
            is_liked_by_focus_user: !prev.is_liked_by_focus_user,
            like_count: Number(prev.like_count) + (prev.is_liked_by_focus_user ? -1 : 1),
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
      setLikerAll(false);
    }
  }

  async function handleReplyLike(reply: PostDetail) {
    setReplies((prev) =>
      prev.map((p) =>
        p.id === reply.id
          ? {
              ...p,
              is_liked_by_focus_user: !p.is_liked_by_focus_user,
              like_count: Number(p.like_count) + (p.is_liked_by_focus_user ? -1 : 1),
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
      listPostsDetail({
        reply_to: postId,
        offset: (replyPage - 1) * REPLY_PAGE_SIZE,
        limit: REPLY_PAGE_SIZE + 1,
        order: "desc",
        focus_user_id: user_id,
      }).then((list) => {
        setReplies(list.slice(0, REPLY_PAGE_SIZE));
        setReplyHasNext(list.length > REPLY_PAGE_SIZE);
      });
    }
  }

  async function handleEditSubmit(e: React.FormEvent) {
    e.preventDefault();
    setEditSubmitting(true);
    setEditError(null);
    try {
      const { content, tags } = parseBodyAndTags(editBody);
      if (!content.trim()) throw new Error("Content is required.");
      if (content.length > 5000) throw new Error("Content is too long (max 5000 chars).");
      if (tags.length > 5) throw new Error("You can specify up to 5 tags.");
      for (const tag of tags) {
        if (tag.length > 50) throw new Error(`Tag "${tag}" is too long (max 50 chars).`);
      }
      await updatePost(postId, { content, tags });
      setEditing(false);
      getPostDetail(postId, user_id).then(setPost);
    } catch (err: any) {
      setEditError(err?.message ?? "Failed to update post.");
    } finally {
      setEditSubmitting(false);
    }
  }

  async function handleDelete() {
    if (!post) return;
    try {
      await deletePost(postId);
      router.push("/posts");
    } catch (err: any) {
      setEditError(err?.message ?? "Failed to delete post.");
    }
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
      await createPost({ content, tags, reply_to: replyingTo });
      setReplyBody("");
      setReplyingTo(null);

      if (replyingTo === postId) {
        setReplyPage(1);
        getPostDetail(postId, user_id).then(setPost);
        listPostsDetail({
          reply_to: postId,
          offset: 0,
          limit: REPLY_PAGE_SIZE + 1,
          order: "desc",
          focus_user_id: user_id,
        }).then((list) => {
          setReplies(list.slice(0, REPLY_PAGE_SIZE));
          setReplyHasNext(list.length > REPLY_PAGE_SIZE);
        });
      } else if (replyingTo) {
        setReplies((prev) =>
          prev.map((rep) =>
            rep.id === replyingTo
              ? {
                  ...rep,
                  is_replied_by_focus_user: true,
                  reply_count: Number(rep.reply_count) + 1,
                }
              : rep,
          ),
        );
      }
    } catch (err: any) {
      setReplyError(err?.message ?? "Failed to reply.");
    } finally {
      setReplySubmitting(false);
    }
  }

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
      {/* 投稿の操作エリア */}
      {canEdit && !editing && (
        <div className="mb-4 flex justify-end">
          <button
            className="px-4 py-1 rounded border bg-sky-100 text-gray-700 hover:bg-sky-200 transition"
            onClick={() => {
              if (post) {
                const tagLine =
                  post.tags && post.tags.length > 0 ? "#" + post.tags.join(", #") + "\n" : "";
                setEditBody(tagLine + post.content);
                setEditTags(post.tags || []);
              }
              setEditing(true);
            }}
          >
            Edit
          </button>
        </div>
      )}
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
            deletable={true}
            isEdit={true}
            onDelete={handleDelete}
          />
        </div>
      )}
      {/* Likeユーザ */}
      <div className="my-6">
        <div className="font-bold mb-2 flex items-center gap-2">Liked by</div>
        <div className="flex flex-wrap gap-2">
          {likerLoading ? (
            <span>Loading…</span>
          ) : likers.length === 0 ? (
            <span className="text-gray-400">No likes yet</span>
          ) : (
            <>
              {likers.map((user) => (
                <a
                  key={user.id}
                  href={`/users/${user.id}`}
                  className="px-2 py-1 bg-gray-100 rounded hover:bg-blue-50"
                >
                  {user.nickname}
                </a>
              ))}
              {!likerAll && likerHasMore && (
                <button
                  className="ml-2 text-blue-600 underline"
                  onClick={() => setLikerAll(true)}
                  className="px-2 py-1 bg-gray-100 rounded hover:bg-blue-50"
                >
                  ...
                </button>
              )}
            </>
          )}
        </div>
      </div>
      {/* 返信リスト */}
      <div className="mt-8 mb-2 font-bold text-lg flex items-center gap-2">Replies</div>
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
      <div className="mt-6 flex justify-center gap-4">
        <button
          className="px-3 py-1 rounded border text-gray-800 bg-blue-100 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
          onClick={() => setReplyPage((p) => Math.max(1, p - 1))}
          disabled={replyPage === 1}
        >
          Prev
        </button>
        <span className="text-gray-800">Page {replyPage}</span>
        <button
          className="px-3 py-1 rounded border text-gray-800 bg-blue-100 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
          onClick={() => setReplyPage((p) => p + 1)}
          disabled={!replyHasNext}
        >
          Next
        </button>
      </div>
    </main>
  );
}
