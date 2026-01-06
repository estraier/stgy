"use client";

import { Config } from "@/config";
import { useEffect, useState, useCallback, useRef } from "react";
import { getUser, listFollowers, listFollowees } from "@/api/users";
import { listPosts, addLike, removeLike, createPost } from "@/api/posts";
import type { User, UserDetail, Post } from "@/api/models";
import { notFound, useParams, useRouter, usePathname, useSearchParams } from "next/navigation";
import { useRequireLogin } from "@/hooks/useRequireLogin";
import UserCard from "@/components/UserCard";
import UserForm from "@/components/UserForm";
import PostCard from "@/components/PostCard";
import PostForm from "@/components/PostForm";
import { parseBodyAndTags } from "@/utils/parse";

const TAB_VALUES = ["posts", "replies", "followers", "followees"] as const;

const RESTORE_POST_ID_KEY = "lastPostId";
const RESTORE_POST_PAGE_KEY = "lastPostPage";
const RESTORE_USER_ID_KEY = "lastUserId";
const RESTORE_USER_PAGE_KEY = "lastUserPage";

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

  const tabsRef = useRef<HTMLDivElement | null>(null);

  const scrollTabsToViewportTop10 = useCallback(() => {
    const el = tabsRef.current;
    if (!el) return;
    const absoluteTop = window.scrollY + el.getBoundingClientRect().top;
    const desiredTop = Math.max(0, absoluteTop - window.innerHeight * 0.1);
    window.scrollTo({ top: desiredTop });
  }, []);

  const setQuery = useCallback(
    (
      updates: Partial<{ tab: string; page: number; oldestFirst: string | undefined }>,
      opts?: { scroll?: boolean },
    ) => {
      const sp = new URLSearchParams(searchParams);
      for (const key of ["tab", "page", "oldestFirst"]) {
        const v = updates[key as keyof typeof updates];
        if (v !== undefined && v !== null && v !== "") {
          sp.set(key, String(v));
        } else {
          sp.delete(key);
        }
      }
      const url = `${pathname}?${sp.toString()}`;
      if (opts && opts.scroll === false) {
        router.push(url, { scroll: false });
      } else {
        router.push(url);
      }
    },
    [router, pathname, searchParams],
  );

  function getQuery() {
    return {
      tab: (searchParams.get("tab") as (typeof TAB_VALUES)[number]) || "posts",
      oldestFirst: searchParams.get("oldestFirst") === "1",
      page: Math.max(Number(searchParams.get("page")) || 1, 1),
    };
  }
  const { tab, oldestFirst, page } = getQuery();

  const [posts, setPosts] = useState<Post[]>([]);
  const [followers, setFollowers] = useState<User[]>([]);
  const [followees, setFollowees] = useState<User[]>([]);
  const [listLoading, setListLoading] = useState(true);
  const [listError, setListError] = useState<string | null>(null);
  const [hasNext, setHasNext] = useState(false);

  const isSelf = !!(user && userId && user.id === userId);
  const canEdit = isSelf || isAdmin;

  const [replyTo, setReplyTo] = useState<string | null>(null);
  const [replyBody, setReplyBody] = useState("");
  const [replyError, setReplyError] = useState<string | null>(null);
  const [replySubmitting, setReplySubmitting] = useState(false);

  const [pendingRestore, setPendingRestore] = useState<{
    kind: "post" | "user";
    id: string;
    page: number;
  } | null>(null);

  useEffect(() => {
    if (!status) return;
    let canceled = false;
    setLoading(true);
    setError(null);
    getUser(id, userId)
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
          if (err instanceof Error) setError(err.message || "Failed to fetch user.");
          else setError(String(err) || "Failed to fetch user.");
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
      listPosts(params)
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

  useEffect(() => {
    try {
      const st = window.history.state as Record<string, unknown> | null;
      const pid =
        st && typeof st[RESTORE_POST_ID_KEY] === "string"
          ? (st[RESTORE_POST_ID_KEY] as string)
          : null;
      const ppgRaw =
        st && st[RESTORE_POST_PAGE_KEY] !== undefined ? st[RESTORE_POST_PAGE_KEY] : null;
      const ppg =
        typeof ppgRaw === "number"
          ? ppgRaw
          : typeof ppgRaw === "string"
            ? parseInt(ppgRaw, 10)
            : NaN;

      const uid =
        st && typeof st[RESTORE_USER_ID_KEY] === "string"
          ? (st[RESTORE_USER_ID_KEY] as string)
          : null;
      const upgRaw =
        st && st[RESTORE_USER_PAGE_KEY] !== undefined ? st[RESTORE_USER_PAGE_KEY] : null;
      const upg =
        typeof upgRaw === "number"
          ? upgRaw
          : typeof upgRaw === "string"
            ? parseInt(upgRaw, 10)
            : NaN;

      if ((tab === "posts" || tab === "replies") && pid && !Number.isNaN(ppg)) {
        setPendingRestore({ kind: "post", id: pid, page: Math.max(1, (ppg as number) || 1) });
      } else if ((tab === "followers" || tab === "followees") && uid && !Number.isNaN(upg)) {
        setPendingRestore({ kind: "user", id: uid, page: Math.max(1, (upg as number) || 1) });
      }
    } catch {}
  }, [tab]);

  useEffect(() => {
    if (!pendingRestore) return;
    if (pendingRestore.page !== page) {
      setQuery({ page: pendingRestore.page, tab, oldestFirst: oldestFirst ? "1" : undefined });
      return;
    }
    if (listLoading) return;
    const targetId =
      pendingRestore.kind === "post" ? `post-${pendingRestore.id}` : `user-${pendingRestore.id}`;
    const el = document.getElementById(targetId);
    if (el) {
      const absoluteTop = window.scrollY + el.getBoundingClientRect().top;
      const desiredTop = Math.max(0, absoluteTop - window.innerHeight * 0.4);
      window.scrollTo({ top: desiredTop });
    }
    setPendingRestore(null);
    try {
      const st = (window.history.state as Record<string, unknown>) || {};
      const rest: Record<string, unknown> = { ...st };
      delete rest[RESTORE_POST_ID_KEY];
      delete rest[RESTORE_POST_PAGE_KEY];
      delete rest[RESTORE_USER_ID_KEY];
      delete rest[RESTORE_USER_PAGE_KEY];
      window.history.replaceState(rest, "");
    } catch {}
  }, [pendingRestore, page, listLoading, oldestFirst, tab, setQuery]);

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
      const allowLikes = !(attrs && (attrs["noLikes"] === true || attrs["nolikes"] === true));
      const allowReplies = !(attrs && (attrs["noReplies"] === true || attrs["noreplies"] === true));
      const locale = typeof attrs.locale === "string" ? attrs.locale : null;
      await createPost({ content, tags, replyTo, allowLikes, allowReplies, locale });
      setReplyBody("");
      setReplyTo(null);
      setTimeout(() => {
        listPosts({
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
    setQuery({ tab: nextTab, page: 1, oldestFirst: undefined }, { scroll: false });
    setReplyTo(null);
    setReplyBody("");
    setReplyError(null);
    requestAnimationFrame(() => requestAnimationFrame(scrollTabsToViewportTop10));
  }

  function handleOldestFirstToggle(checked: boolean) {
    setQuery({ oldestFirst: checked ? "1" : undefined, tab, page: 1 }, { scroll: false });
    setReplyTo(null);
    setReplyBody("");
    setReplyError(null);
    requestAnimationFrame(() => requestAnimationFrame(scrollTabsToViewportTop10));
  }

  return (
    <main className="max-w-3xl mx-auto mt-8 p-1 sm:p-4">
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
          <UserForm
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

      <div ref={tabsRef} className="flex gap-1 mt-6 mb-2">
        {TAB_VALUES.map((t) => (
          <button
            key={t}
            className={`px-3 max-md:px-1 py-1 rounded-t min-w-0 sm:min-w-[110px] text-sm font-normal cursor-pointer
              ${tab === t ? "bg-blue-100 text-gray-800" : "bg-blue-50 text-gray-400 hover:bg-blue-100"}`}
            onClick={() => handleTabChange(t)}
          >
            {tabLabel(t)}
          </button>
        ))}
        <label className="flex items-center gap-1 text-sm text-gray-700 cursor-pointer ml-4 max-md:ml-1">
          <input
            type="checkbox"
            checked={oldestFirst}
            onChange={(e) => handleOldestFirstToggle(e.target.checked)}
            className="cursor-pointer"
          />
          <span className="hidden md:inline">Oldest first</span>
          <span className="md:hidden scale-x-80 -ml-1" aria-hidden>
            Oldest
          </span>
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
                {posts.map((post, idx) => (
                  <li
                    key={post.id}
                    id={`post-${post.id}`}
                    onMouseDown={() => {
                      try {
                        const st = (window.history.state as Record<string, unknown>) || {};
                        window.history.replaceState(
                          { ...st, [RESTORE_POST_ID_KEY]: post.id, [RESTORE_POST_PAGE_KEY]: page },
                          "",
                        );
                      } catch {}
                    }}
                  >
                    <PostCard
                      post={post}
                      avatarVersion={post.ownedBy === userId ? (updatedAt ?? undefined) : undefined}
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
            )}
            {tab === "followers" && (
              <ul className="space-y-4">
                {followers.length === 0 && (
                  <li className="text-gray-400 text-center">No followers found.</li>
                )}
                {followers.map((u, idx) => (
                  <li
                    key={u.id}
                    id={`user-${u.id}`}
                    onMouseDown={() => {
                      try {
                        const st = (window.history.state as Record<string, unknown>) || {};
                        window.history.replaceState(
                          { ...st, [RESTORE_USER_ID_KEY]: u.id, [RESTORE_USER_PAGE_KEY]: page },
                          "",
                        );
                      } catch {}
                    }}
                  >
                    <UserCard
                      user={u}
                      focusUserId={userId}
                      onClick={() => router.push(`/users/${u.id}`)}
                      idPrefix={`f${idx + 1}-h`}
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
                {followees.map((u, idx) => (
                  <li
                    key={u.id}
                    id={`user-${u.id}`}
                    onMouseDown={() => {
                      try {
                        const st = (window.history.state as Record<string, unknown>) || {};
                        window.history.replaceState(
                          { ...st, [RESTORE_USER_ID_KEY]: u.id, [RESTORE_USER_PAGE_KEY]: page },
                          "",
                        );
                      } catch {}
                    }}
                  >
                    <UserCard
                      user={u}
                      focusUserId={userId}
                      onClick={() => router.push(`/users/${u.id}`)}
                      idPrefix={`f${idx + 1}-h`}
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
