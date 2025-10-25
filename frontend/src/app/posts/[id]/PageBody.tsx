"use client";

import { Config } from "@/config";
import { useEffect, useMemo, useState } from "react";
import {
  getPost,
  listLikers,
  addLike,
  removeLike,
  updatePost,
  createPost,
  deletePost,
  listPosts,
} from "@/api/posts";
import type { Post, PostDetail, User } from "@/api/models";
import { useRequireLogin } from "@/hooks/useRequireLogin";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import PostCard from "@/components/PostCard";
import PostForm from "@/components/PostForm";
import { parseBodyAndTags } from "@/utils/parse";

export default function PageBody() {
  const params = useParams();
  const postId =
    typeof params.id === "string" ? params.id : Array.isArray(params.id) ? params.id[0] : "";

  const status = useRequireLogin();
  const router = useRouter();
  const searchParams = useSearchParams();
  const userId = status.state === "authenticated" ? status.session.userId : undefined;
  const isAdmin = status.state === "authenticated" && status.session.userIsAdmin;
  const updatedAt = status.state === "authenticated" ? status.session.userUpdatedAt : null;

  const replyPage = useMemo(() => {
    const raw = searchParams.get("replyPage");
    const n = Number(raw);
    return !raw || Number.isNaN(n) || n < 1 ? 1 : n;
  }, [searchParams]);

  const replyOldestFirst = useMemo(
    () => searchParams.get("replyOldestFirst") === "1",
    [searchParams],
  );

  const [post, setPost] = useState<PostDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [editing, setEditing] = useState(false);
  const [editBody, setEditBody] = useState("");
  const [editSubmitting, setEditSubmitting] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);

  const [likers, setLikers] = useState<User[]>([]);
  const [likerAll, setLikerAll] = useState(false);
  const [likerLoading, setLikerLoading] = useState(false);
  const [likerHasMore, setLikerHasMore] = useState(false);

  const [replyHasNext, setReplyHasNext] = useState(false);
  const [replyLoading, setReplyLoading] = useState(false);

  const [replies, setReplies] = useState<Post[]>([]);
  const [replyingTo, setReplyingTo] = useState<string | null>(null);
  const [replyBody, setReplyBody] = useState("");
  const [replyError, setReplyError] = useState<string | null>(null);
  const [replySubmitting, setReplySubmitting] = useState(false);

  useEffect(() => {
    if (!userId) return;
    setLoading(true);
    setError(null);
    getPost(postId, userId)
      .then((data) => {
        setPost(data);
        const specials: string[] = [];
        if (data.allowLikes === false) specials.push("[nolikes]");
        if (data.allowReplies === false) specials.push("[noreplies]");
        const allTags = [...specials, ...(data.tags ?? [])];
        const tagLine = allTags.length > 0 ? "\n\n#" + allTags.join(", #") : "";
        setEditBody(data.content + tagLine);
      })
      .catch((err) => setError(err?.message ?? "Failed to fetch post."))
      .finally(() => setLoading(false));
  }, [postId, userId]);

  useEffect(() => {
    if (!post) return;
    if (!post.allowLikes) {
      setLikers([]);
      setLikerHasMore(false);
      setLikerLoading(false);
      return;
    }
    setLikerLoading(true);
    const limit = likerAll
      ? Config.LIKERS_LIST_SECOND_LIMIT + 1
      : Config.LIKERS_LIST_FIRST_LIMIT + 1;
    listLikers(post.id, { offset: 0, limit, order: "desc" })
      .then((users) => {
        if (likerAll) {
          setLikers(users.slice(0, Config.LIKERS_LIST_SECOND_LIMIT));
          setLikerHasMore(users.length > Config.LIKERS_LIST_SECOND_LIMIT);
        } else {
          setLikers(users.slice(0, Config.LIKERS_LIST_FIRST_LIMIT));
          setLikerHasMore(users.length > Config.LIKERS_LIST_FIRST_LIMIT);
        }
      })
      .finally(() => setLikerLoading(false));
  }, [post, likerAll]);

  useEffect(() => {
    if (!userId || !post) return;
    if (!post.allowReplies) {
      setReplies([]);
      setReplyHasNext(false);
      setReplyLoading(false);
      return;
    }
    setReplyLoading(true);
    listPosts({
      replyTo: post.id,
      offset: (replyPage - 1) * Config.POSTS_PAGE_SIZE,
      limit: Config.POSTS_PAGE_SIZE + 1,
      order: replyOldestFirst ? "asc" : "desc",
      focusUserId: userId,
    })
      .then((list) => {
        setReplies(list.slice(0, Config.POSTS_PAGE_SIZE));
        setReplyHasNext(list.length > Config.POSTS_PAGE_SIZE);
      })
      .finally(() => setReplyLoading(false));
  }, [userId, post, replyPage, replyOldestFirst]);

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
    return () => document.body.removeEventListener("click", handler);
  }, []);

  async function handleLike(p: Post) {
    if (!userId || !post) return;
    if (!post.allowLikes) return;

    const oldLiked = post.isLikedByFocusUser;
    const oldCount = Number(post.countLikes ?? 0);

    setPost((prev) =>
      prev
        ? {
            ...prev,
            isLikedByFocusUser: !oldLiked,
            countLikes: oldCount + (oldLiked ? -1 : 1),
          }
        : prev,
    );

    try {
      if (oldLiked) {
        await removeLike(p.id);
      } else {
        await addLike(p.id);
      }
    } catch {
      setPost((prev) =>
        prev
          ? {
              ...prev,
              allowLikes: false,
              isLikedByFocusUser: false,
              countLikes: oldCount,
            }
          : prev,
      );
    } finally {
      setLikerAll(false);
    }
  }

  async function handleReplyLike(reply: Post) {
    if (!userId) return;

    const oldLiked = reply.isLikedByFocusUser;
    const oldCount = Number(reply.countLikes ?? 0);

    setReplies((prev) =>
      prev.map((p) =>
        p.id === reply.id
          ? {
              ...p,
              isLikedByFocusUser: !oldLiked,
              countLikes: oldCount + (oldLiked ? -1 : 1),
            }
          : p,
      ),
    );

    try {
      if (oldLiked) {
        await removeLike(reply.id);
      } else {
        await addLike(reply.id);
      }
    } catch {
      setReplies((prev) =>
        prev.map((p) =>
          p.id === reply.id
            ? {
                ...p,
                allowLikes: false,
                isLikedByFocusUser: false,
                countLikes: oldCount,
              }
            : p,
        ),
      );
    }
  }

  async function handleEditSubmit(e: React.FormEvent) {
    e.preventDefault();
    setEditSubmitting(true);
    setEditError(null);
    try {
      const { content, tags, attrs } = parseBodyAndTags(editBody);
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
      const patch: {
        content: string;
        tags: string[];
        allowLikes: boolean;
        allowReplies: boolean;
      } = {
        content,
        tags,
        allowLikes: attrs.noLikes === true ? false : true,
        allowReplies: attrs.noReplies === true ? false : true,
      };
      await updatePost(postId, patch);
      setEditing(false);
      getPost(postId, userId).then(setPost);
    } catch (err: unknown) {
      if (err instanceof Error) {
        setEditError(err.message ?? "Failed to update post.");
      } else {
        setEditError(String(err) ?? "Failed to update post.");
      }
    } finally {
      setEditSubmitting(false);
    }
  }

  async function handleDelete() {
    if (!post) return;
    try {
      await deletePost(postId);
      router.push("/posts");
    } catch (err: unknown) {
      if (err instanceof Error) {
        setEditError(err.message ?? "Failed to delete post.");
      } else {
        setEditError(String(err) ?? "Failed to delete post.");
      }
    }
  }

  async function handleReplySubmit(e: React.FormEvent) {
    e.preventDefault();
    if (post && !post.allowReplies && replyingTo === postId) {
      setReplyError("Replies are not allowed.");
      return;
    }
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
      await createPost({ content, tags, replyTo: replyingTo, allowLikes, allowReplies });
      setReplyBody("");
      setReplyingTo(null);

      if (replyingTo === postId) {
        const sp = new URLSearchParams(searchParams);
        sp.set("replyPage", "1");
        if (replyOldestFirst) {
          sp.set("replyOldestFirst", "1");
        } else {
          sp.delete("replyOldestFirst");
        }
        router.replace(`?${sp.toString()}`, { scroll: false });

        getPost(postId, userId).then(setPost);
        listPosts({
          replyTo: postId,
          offset: 0,
          limit: Config.POSTS_PAGE_SIZE + 1,
          order: replyOldestFirst ? "asc" : "desc",
          focusUserId: userId,
        }).then((list) => {
          setReplies(list.slice(0, Config.POSTS_PAGE_SIZE));
          setReplyHasNext(list.length > Config.POSTS_PAGE_SIZE);
        });
      } else if (replyingTo) {
        setReplies((prev) =>
          prev.map((rep) =>
            rep.id === replyingTo
              ? { ...rep, isRepliedByFocusUser: true, countReplies: Number(rep.countReplies) + 1 }
              : rep,
          ),
        );
      }
    } catch (err: unknown) {
      if (err instanceof Error) {
        setReplyError(err.message ?? "Failed to reply.");
      } else {
        setReplyError(String(err) ?? "Failed to reply.");
      }
    } finally {
      setReplySubmitting(false);
    }
  }

  const canEdit = isAdmin || (post && post.ownedBy === userId);

  if (!userId) return null;
  if (loading) return <div className="text-center mt-10">Loading...</div>;
  if (error) return <div className="text-center mt-10 text-red-600">{error}</div>;
  if (!post) return <div className="text-center mt-10 text-gray-500">No post found.</div>;

  function handleReplyPageChange(nextPage: number) {
    const sp = new URLSearchParams(searchParams);
    sp.set("replyPage", String(nextPage));
    if (replyOldestFirst) {
      sp.set("replyOldestFirst", "1");
    } else {
      sp.delete("replyOldestFirst");
    }
    router.replace(`?${sp.toString()}`, { scroll: false });
  }

  function handleReplyOldestFirstChange(checked: boolean) {
    const sp = new URLSearchParams(searchParams);
    if (checked) {
      sp.set("replyOldestFirst", "1");
    } else {
      sp.delete("replyOldestFirst");
    }
    sp.set("replyPage", "1");
    router.replace(`?${sp.toString()}`, { scroll: false });
  }

  return (
    <main className="max-w-3xl mx-auto mt-8 p-1 sm:p-4">
      <PostCard
        post={post}
        avatarVersion={post.ownedBy === userId ? (updatedAt ?? undefined) : undefined}
        truncated={false}
        showActions={true}
        onLike={() => handleLike(post)}
        onReply={() => setReplyingTo(post.id)}
        isReplying={replyingTo === post.id}
        clickable={false}
        className="mb-8"
        focusUserId={userId}
        focusUserIsAdmin={!!isAdmin}
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
            autoFocus
          />
        </div>
      )}

      {canEdit && !editing && (
        <div className="mb-4 flex justify-end">
          <button
            className="px-4 py-1 rounded border bg-sky-100 text-gray-700 hover:bg-sky-200 transition"
            onClick={() => {
              if (post) {
                const specials: string[] = [];
                if (post.allowLikes === false) specials.push("[nolikes]");
                if (post.allowReplies === false) specials.push("[noreplies]");
                const allTags = [...specials, ...(post.tags ?? [])];
                const tagLine = allTags.length > 0 ? "\n\n#" + allTags.join(", #") : "";
                setEditBody(post.content + tagLine);
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
            autoFocus
          />
        </div>
      )}

      {post.allowReplies ? (
        <>
          <div className="mt-8 mb-2 flex items-center gap-2">
            <span className="font-bold text-lg">Replies</span>
            <label className="flex items-center gap-1 text-sm cursor-pointer ml-4">
              <input
                type="checkbox"
                checked={replyOldestFirst}
                onChange={(e) => handleReplyOldestFirstChange(e.target.checked)}
                className="cursor-pointer"
              />
              Oldest first
            </label>
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
                    focusUserId={userId}
                    focusUserIsAdmin={!!isAdmin}
                    avatarVersion={rep.ownedBy === userId ? (updatedAt ?? undefined) : undefined}
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
                        autoFocus
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
              onClick={() => handleReplyPageChange(Math.max(1, replyPage - 1))}
              disabled={replyPage === 1}
            >
              Prev
            </button>
            <span className="text-gray-800">Page {replyPage}</span>
            <button
              className="px-3 py-1 rounded border text-gray-800 bg-blue-100 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
              onClick={() => handleReplyPageChange(replyHasNext ? replyPage + 1 : replyPage)}
              disabled={!replyHasNext}
            >
              Next
            </button>
          </div>
        </>
      ) : (
        <div className="mt-3 ml-3 text-gray-400">Replies are not allowed.</div>
      )}

      <div className="my-6">
        {post.allowLikes ? (
          <>
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
                      className="px-2 py-1 bg-gray-100 rounded border border-gray-300 hover:bg-blue-100"
                    >
                      {user.nickname}
                    </a>
                  ))}
                  {!likerAll && likerHasMore && (
                    <button
                      className="px-2 py-1 bg-gray-100 rounded border border-gray-300 hover:bg-blue-100"
                      onClick={() => setLikerAll(true)}
                    >
                      ...
                    </button>
                  )}
                </>
              )}
            </div>
          </>
        ) : (
          <div className="mt-3 ml-3 text-gray-400">Likes are not allowed.</div>
        )}
      </div>
    </main>
  );
}
