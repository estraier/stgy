"use client";

import { Config } from "@/config";
import { useEffect, useState } from "react";
import { getUserDetail, listFollowers, listFollowees } from "@/api/users";
import { listPostsDetail, addLike, removeLike, createPost } from "@/api/posts";
import type { UserDetail, PostDetail } from "@/api/models";
import { notFound, useParams, useRouter, usePathname, useSearchParams } from "next/navigation";
import { useRequireLogin } from "@/hooks/useRequireLogin";
import UserCard from "@/components/UserCard";
import UserEditForm from "@/components/UserEditForm";
import PostCard from "@/components/PostCard";
import PostForm from "@/components/PostForm";
import { parseBodyAndTags } from "@/utils/parse";

const TAB_VALUES = ["posts", "replies", "followers", "followees"] as const;

export default function PageBody() {
  const params = useParams();
  const id =
    typeof params.id === "string" ? params.id : Array.isArray(params.id) ? params.id[0] : "";

  const status = useRequireLogin();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const userId = status && status.state === "authenticated" ? status.session.userId : "";
  const isAdmin = status && status.state === "authenticated" && status.session.userIsAdmin;
  const updatedAt = status.state === "authenticated" ? status.session.userUpdatedAt : null;

  const [user, setUser] = useState<UserDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);

  function setQuery(
    updates: Partial<{ tab: string; page: number; oldestFirst: string | undefined }>,
  ) {
    const sp = new URLSearchParams(searchParams);
    for (const key of ["tab", "page", "oldestFirst"]) {
      if (
        updates[key as keyof typeof updates] !== undefined &&
        updates[key as keyof typeof updates] !== null &&
        updates[key as keyof typeof updates] !== ""
      ) {
        sp.set(key, String(updates[key as keyof typeof updates]));
      } else {
        sp.delete(key);
      }
    }
    router.push(`${pathname}?${sp.toString()}`);
  }

  function getQuery() {
    return {
      tab: (searchParams.get("tab") as (typeof TAB_VALUES)[number]) || "posts",
      oldestFirst: searchParams.get("oldestFirst") === "1",
      page: Math.max(Number(searchParams.get("page")) || 1, 1),
    };
  }
  const { tab, oldestFirst, page } = getQuery();

  const [posts, setPosts] = useState<PostDetail[]>([]);
  const [followers, setFollowers] = useState<UserDetail[]>([]);
  const [followees, setFollowees] = useState<UserDetail[]>([]);
  const [listLoading, setListLoading] = useState(true);
  const [listError, setListError] = useState<string | null>(null);
  const [hasNext, setHasNext] = useState(false);

  const isSelf = !!(user && userId && user.id === userId);
  const canEdit = isSelf || isAdmin;

  const [replyTo, setReplyTo] = useState<string | null>(null);
  const [replyBody, setReplyBody] = useState("");
  const [replyError, setReplyError] = useState<string | null>(null);
  const [replySubmitting, setReplySubmitting] = useState(false);

  useEffect(() => {
    if (!status) return;
    let canceled = false;
    setLoading(true);
    setError(null);
    getUserDetail(id, userId)
      .then((data) => {
        if (!canceled) setUser(data);
      })
      .catch((err: unknown) => {
        if (!canceled) {
          if (
            typeof err === "object" &&
            err &&
            "status" in err &&
            (err as { status: unknown }).status === 404
          ) {
            notFound();
            return;
          }
          if (err instanceof Error) setError(err.message || "Failed to fetch user detail.");
          else setError(String(err) || "Failed to fetch user detail.");
        }
      })
      .finally(() => {
        if (!canceled) setLoading(false);
      });
    return () => {
      canceled = true;
    };
  }, [id, status, userId]);

  useEffect(() => {
    if (!user || !user.id) return;
    setListLoading(true);
    setListError(null);

    if (tab === "posts" || tab === "replies") {
      const params: {
        ownedBy: string;
        offset: number;
        limit: number;
        order: "asc" | "desc";
        focusUserId: string;
        replyTo?: string;
      } = {
        ownedBy: user.id,
        offset: (page - 1) * Config.POSTS_PAGE_SIZE,
        limit: Config.POSTS_PAGE_SIZE + 1,
        order: oldestFirst ? "asc" : "desc",
        focusUserId: userId,
      };
      if (tab === "posts") params.replyTo = "";
      if (tab === "replies") params.replyTo = "*";
      listPostsDetail(params)
        .then((data) => {
          setPosts(data.slice(0, Config.POSTS_PAGE_SIZE));
          setHasNext(data.length > Config.POSTS_PAGE_SIZE);
        })
        .catch((err: unknown) => {
          if (err instanceof Error) setListError(err.message || "Failed to fetch posts.");
          else setListError(String(err) || "Failed to fetch posts.");
        })
        .finally(() => setListLoading(false));
    } else if (tab === "followers") {
      listFollowers(user.id, {
        offset: (page - 1) * Config.USERS_PAGE_SIZE,
        limit: Config.USERS_PAGE_SIZE + 1,
        order: oldestFirst ? "asc" : "desc",
        focusUserId: userId,
      })
        .then((data) => {
          setFollowers(data.slice(0, Config.USERS_PAGE_SIZE));
          setHasNext(data.length > Config.USERS_PAGE_SIZE);
        })
        .catch((err: unknown) => {
          if (err instanceof Error) setListError(err.message || "Failed to fetch followers.");
          else setListError(String(err) || "Failed to fetch followers.");
        })
        .finally(() => setListLoading(false));
    } else if (tab === "followees") {
      listFollowees(user.id, {
        offset: (page - 1) * Config.USERS_PAGE_SIZE,
        limit: Config.USERS_PAGE_SIZE + 1,
        order: oldestFirst ? "asc" : "desc",
        focusUserId: userId,
      })
        .then((data) => {
          setFollowees(data.slice(0, Config.USERS_PAGE_SIZE));
          setHasNext(data.length > Config.USERS_PAGE_SIZE);
        })
        .catch((err: unknown) => {
          if (err instanceof Error) setListError(err.message || "Failed to fetch followees.");
          else setListError(String(err) || "Failed to fetch followees.");
        })
        .finally(() => setListLoading(false));
    }
  }, [tab, user?.id, page, oldestFirst, userId, user]);

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

  async function handleLike(post: PostDetail) {
    setPosts((prev) =>
      prev.map((p) =>
        p.id === post.id
          ? {
              ...p,
              isLikedByFocusUser: !p.isLikedByFocusUser,
              likeCount: Number(p.likeCount ?? 0) + (p.isLikedByFocusUser ? -1 : 1),
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
      setTimeout(() => {
        listPostsDetail({
          ownedBy: user?.id,
          offset: (page - 1) * Config.POSTS_PAGE_SIZE,
          limit: Config.POSTS_PAGE_SIZE + 1,
          order: oldestFirst ? "asc" : "desc",
          focusUserId: userId,
          replyTo: tab === "posts" ? null : tab === "replies" ? "*" : undefined,
        }).then((data) => setPosts(data.slice(0, Config.POSTS_PAGE_SIZE)));
      }, 100);
    } catch {
      setTimeout(() => {
        listPostsDetail({
          ownedBy: user?.id,
          offset: (page - 1) * Config.POSTS_PAGE_SIZE,
          limit: Config.POSTS_PAGE_SIZE + 1,
          order: oldestFirst ? "asc" : "desc",
          focusUserId: userId,
          replyTo: tab === "posts" ? null : tab === "replies" ? "*" : undefined,
        }).then((data) => setPosts(data.slice(0, Config.POSTS_PAGE_SIZE)));
      }, 100);
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
      await createPost({ content, tags, replyTo });
      setReplyBody("");
      setReplyTo(null);
      setTimeout(() => {
        listPostsDetail({
          ownedBy: user?.id,
          offset: (page - 1) * Config.POSTS_PAGE_SIZE,
          limit: Config.POSTS_PAGE_SIZE + 1,
          order: oldestFirst ? "asc" : "desc",
          focusUserId: userId,
          replyTo: tab === "posts" ? null : tab === "replies" ? "*" : undefined,
        }).then((data) => setPosts(data.slice(0, Config.POSTS_PAGE_SIZE)));
      }, 100);
    } catch (err: unknown) {
      if (err instanceof Error) setReplyError(err.message || "Failed to reply.");
      else setReplyError(String(err) || "Failed to reply.");
    } finally {
      setReplySubmitting(false);
    }
  }
  function clearReplyError() {
    if (replyError) setReplyError(null);
  }

  if (!status) return null;
  if (loading) return <div className="text-center mt-10">Loading…</div>;
  if (error) return <div className="text-center mt-10 text-red-600">{error}</div>;
  if (!user) return <div className="text-center mt-10 text-gray-500">No user found.</div>;

  function tabLabel(tab: string) {
    switch (tab) {
      case "posts":
        return "Posts";
      case "replies":
        return "Replies";
      case "followers":
        return "Followers";
      case "followees":
        return "Followees";
      default:
        return tab;
    }
  }

  function handlePageChange(nextPage: number) {
    setQuery({ page: nextPage, tab, oldestFirst: oldestFirst ? "1" : undefined });
  }

  function handleTabChange(nextTab: (typeof TAB_VALUES)[number]) {
    setQuery({ tab: nextTab, page: 1, oldestFirst: undefined });
    setReplyTo(null);
    setReplyBody("");
    setReplyError(null);
  }

  function handleOldestFirstToggle(checked: boolean) {
    setQuery({ oldestFirst: checked ? "1" : undefined, tab, page: 1 });
    setReplyTo(null);
    setReplyBody("");
    setReplyError(null);
  }

  return (
    <main className="max-w-3xl mx-auto mt-8 p-4">
      <UserCard user={user} truncated={false} focusUserId={userId} clickable={false} />

      {canEdit && !editing && (
        <div className="mt-4 flex justify-end">
          <button
            className="px-4 py-1 rounded border bg-sky-100 text-gray-700 hover:bg-sky-200 transition"
            onClick={() => setEditing(true)}
          >
            Edit
          </button>
        </div>
      )}
      {canEdit && editing && (
        <div className="mt-4">
          <UserEditForm
            user={user}
            isAdmin={isAdmin}
            isSelf={isSelf}
            onUpdated={(updatedUser) => {
              setUser(updatedUser ?? null);
              setEditing(false);
            }}
            onCancel={() => setEditing(false)}
          />
        </div>
      )}

      <div className="flex gap-1 mt-6 mb-2">
        {TAB_VALUES.map((t) => (
          <button
            key={t}
            className={`px-3 py-1 rounded-t text-sm font-normal cursor-pointer
              ${tab === t ? "bg-blue-100 text-gray-800" : "bg-blue-50 text-gray-400 hover:bg-blue-100"}`}
            style={{ minWidth: 110 }}
            onClick={() => handleTabChange(t)}
          >
            {tabLabel(t)}
          </button>
        ))}
        <label className="flex items-center gap-1 text-sm text-gray-700 cursor-pointer ml-4">
          <input
            type="checkbox"
            checked={oldestFirst}
            onChange={(e) => handleOldestFirstToggle(e.target.checked)}
            className="cursor-pointer"
          />
          Oldest first
        </label>
      </div>

      <div>
        {listLoading && <div className="text-gray-500">Loading…</div>}
        {listError && <div className="text-red-600">{listError}</div>}
        {!listLoading && !listError && (
          <>
            {(tab === "posts" || tab === "replies") && (
              <ul className="space-y-4">
                {posts.length === 0 && (
                  <li className="text-gray-400 text-center">
                    No {tab === "posts" ? "posts" : "replies"} found.
                  </li>
                )}
                {posts.map((post) => (
                  <li key={post.id}>
                    <PostCard
                      post={post}
                      avatarVersion={post.ownedBy === userId ? (updatedAt ?? undefined) : undefined}
                      onLike={handleLike}
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
            )}
            {tab === "followers" && (
              <ul className="space-y-4">
                {followers.length === 0 && (
                  <li className="text-gray-400 text-center">No followers found.</li>
                )}
                {followers.map((user) => (
                  <li key={user.id}>
                    <UserCard
                      user={user}
                      focusUserId={userId}
                      onClick={() => router.push(`/users/${user.id}`)}
                    />
                  </li>
                ))}
              </ul>
            )}
            {tab === "followees" && (
              <ul className="space-y-4">
                {followees.length === 0 && (
                  <li className="text-gray-400 text-center">No followees found.</li>
                )}
                {followees.map((user) => (
                  <li key={user.id}>
                    <UserCard
                      user={user}
                      focusUserId={userId}
                      onClick={() => router.push(`/users/${user.id}`)}
                    />
                  </li>
                ))}
              </ul>
            )}
          </>
        )}

        {!listLoading && !listError && (
          <div className="mt-6 flex justify-center gap-4">
            <button
              className="px-3 py-1 rounded border text-gray-800 bg-blue-100 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
              onClick={() => handlePageChange(Math.max(1, page - 1))}
              disabled={page === 1}
            >
              Prev
            </button>
            <span className="text-gray-800">Page {page}</span>
            <button
              className="px-3 py-1 rounded border text-gray-800 bg-blue-100 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
              onClick={() => handlePageChange(hasNext ? page + 1 : page)}
              disabled={!hasNext}
            >
              Next
            </button>
          </div>
        )}
      </div>
    </main>
  );
}
