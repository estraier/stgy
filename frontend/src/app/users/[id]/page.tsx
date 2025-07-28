"use client";

import { use, useEffect, useState } from "react";
import { getUserDetail, listFollowers, listFollowees } from "@/api/users";
import { listPostsDetail } from "@/api/posts";
import type { UserDetail, PostDetail, User } from "@/api/models";
import { notFound, useRouter, usePathname, useSearchParams } from "next/navigation";
import { useRequireLogin } from "@/hooks/useRequireLogin";
import UserCard from "@/components/UserCard";
import UserEditForm from "@/components/UserEditForm";
import PostCard from "@/components/PostCard";

const PAGE_SIZE = 5;
const TAB_VALUES = ["posts", "replies", "followers", "followees"] as const;

export default function UserDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const ready = useRequireLogin();
  const { id } = use(params);
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  // ログイン中ユーザ情報
  const userId = ready && ready.state === "authenticated" ? ready.session.user_id : "";
  const isAdmin = ready && ready.state === "authenticated" && ready.session.user_is_admin;

  // 対象ユーザデータ
  const [user, setUser] = useState<UserDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);

  // タブ・オプション・ページ
  function getQuery() {
    return {
      tab: (searchParams.get("tab") as typeof TAB_VALUES[number]) || "posts",
      oldestFirst: searchParams.get("oldestFirst") === "1",
      page: Math.max(Number(searchParams.get("page")) || 1, 1),
    };
  }
  const { tab, oldestFirst, page } = getQuery();

  // 投稿・ユーザリスト系
  const [posts, setPosts] = useState<PostDetail[]>([]);
  const [followers, setFollowers] = useState<User[]>([]);
  const [followees, setFollowees] = useState<User[]>([]);
  const [listLoading, setListLoading] = useState(true);
  const [listError, setListError] = useState<string | null>(null);
  const [hasNext, setHasNext] = useState(false);

  const isSelf = user && userId && user.id === userId;
  const canEdit = isSelf || isAdmin;

  // クエリ書き換え
  function setQuery(updates: Partial<{ tab: string; page: number; oldestFirst: string | undefined }>) {
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

  // ユーザデータ取得
  useEffect(() => {
    if (!ready) return;
    let canceled = false;
    setLoading(true);
    setError(null);
    getUserDetail(id, userId)
      .then((data) => {
        if (!canceled) setUser(data);
      })
      .catch((err: any) => {
        if (!canceled) {
          if (err.status === 404) {
            notFound();
            return;
          }
          setError(err.message || "Failed to fetch user detail.");
        }
      })
      .finally(() => {
        if (!canceled) setLoading(false);
      });
    return () => {
      canceled = true;
    };
  }, [id, ready, userId]);

  // タブ内容のリスト取得
  useEffect(() => {
    if (!user || !user.id) return;
    setListLoading(true);
    setListError(null);

    if (tab === "posts" || tab === "replies") {
      // 投稿・リプライ
      const params: any = {
        owned_by: user.id,
        offset: (page - 1) * PAGE_SIZE,
        limit: PAGE_SIZE + 1,
        order: oldestFirst ? "asc" : "desc",
      };
      if (tab === "posts") params.reply_to = null;
      if (tab === "replies") params.reply_to = "*";
      listPostsDetail(params)
        .then((data) => {
          setPosts(data.slice(0, PAGE_SIZE));
          setHasNext(data.length > PAGE_SIZE);
        })
        .catch((err: any) => setListError(err.message || "Failed to fetch posts."))
        .finally(() => setListLoading(false));
    } else if (tab === "followers") {
      listFollowers(user.id, {
        offset: (page - 1) * PAGE_SIZE,
        limit: PAGE_SIZE + 1,
        order: oldestFirst ? "asc" : "desc",
      })
        .then((data) => {
          setFollowers(data.slice(0, PAGE_SIZE));
          setHasNext(data.length > PAGE_SIZE);
        })
        .catch((err: any) => setListError(err.message || "Failed to fetch followers."))
        .finally(() => setListLoading(false));
    } else if (tab === "followees") {
      listFollowees(user.id, {
        offset: (page - 1) * PAGE_SIZE,
        limit: PAGE_SIZE + 1,
        order: oldestFirst ? "asc" : "desc",
      })
        .then((data) => {
          setFollowees(data.slice(0, PAGE_SIZE));
          setHasNext(data.length > PAGE_SIZE);
        })
        .catch((err: any) => setListError(err.message || "Failed to fetch followees."))
        .finally(() => setListLoading(false));
    }
  }, [tab, user?.id, page, oldestFirst]);

  if (!ready) return null;
  if (loading) return <div className="text-center mt-10">Loading…</div>;
  if (error) return <div className="text-center mt-10 text-red-600">{error}</div>;
  if (!user) return <div className="text-center mt-10 text-gray-500">No user found.</div>;

  // UI: モードラベル
  function tabLabel(tab: string) {
    switch (tab) {
      case "posts": return "Posts";
      case "replies": return "Replies";
      case "followers": return "Followers";
      case "followees": return "Followees";
      default: return tab;
    }
  }

  // ページ遷移
  function handlePageChange(nextPage: number) {
    setQuery({ page: nextPage, tab, oldestFirst: oldestFirst ? "1" : undefined });
  }

  // タブ切り替え
  function handleTabChange(nextTab: typeof TAB_VALUES[number]) {
    setQuery({ tab: nextTab, page: 1, oldestFirst: oldestFirst ? "1" : undefined });
  }

  // Oldest first
  function handleOldestFirstToggle(checked: boolean) {
    setQuery({ oldestFirst: checked ? "1" : undefined, tab, page: 1 });
  }

  return (
    <main className="max-w-3xl mx-auto mt-8 p-4">
      {/* ユーザプロフィール */}
      <UserCard
        user={user}
        truncated={false}
        focusUserId={userId}
      />

      {/* Edit */}
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
              setUser(updatedUser);
              setEditing(false);
            }}
            onCancel={() => setEditing(false)}
          />
        </div>
      )}

      {/* モード切替/オプション */}
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

      {/* 一覧エリア */}
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
                    <PostCard post={post} />
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

        {/* ページネーション */}
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
