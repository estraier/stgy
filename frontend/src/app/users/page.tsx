"use client";

import { useEffect, useState, useMemo } from "react";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { useRequireLogin } from "@/hooks/useRequireLogin";
import { listUsersDetail, listFollowers, listFollowees } from "@/api/users";
import type { UserDetail } from "@/api/models";
import { parseUserSearchQuery, serializeUserSearchQuery } from "@/utils/parse";
import Navbar from "@/components/Navbar";
import UserCard from "@/components/UserCard";

const PAGE_SIZE = 5;
const TAB_VALUES = ["followees", "followers", "all"] as const;

export default function UsersPage() {
  const status = useRequireLogin();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  // クエリパラメータから状態復元
  function getQuery() {
    return {
      tab: (searchParams.get("tab") as (typeof TAB_VALUES)[number]) || "followees",
      page: Math.max(Number(searchParams.get("page")) || 1, 1),
      qParam: searchParams.get("q") ?? "",
      oldestFirst: searchParams.get("oldestFirst") === "1",
    };
  }
  const { tab, page, qParam, oldestFirst } = getQuery();

  // useMemoでオブジェクトの参照を安定化
  const searchQueryObj = useMemo(() => (qParam ? parseUserSearchQuery(qParam) : {}), [qParam]);

  const userId = status.state === "authenticated" ? status.session.user_id : undefined;
  const isSearchMode = useMemo(
    () =>
      (searchQueryObj.query && searchQueryObj.query.length > 0) ||
      (searchQueryObj.nickname && searchQueryObj.nickname.length > 0),
    [searchQueryObj],
  );

  const effectiveTab = isSearchMode ? "all" : tab;

  // 状態
  const [users, setUsers] = useState<UserDetail[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [hasNext, setHasNext] = useState(false);

  // クエリの変更
  function setQuery(
    updates: Partial<{ tab: string; page: number; q: string; oldestFirst: string | undefined }>,
  ) {
    const sp = new URLSearchParams(searchParams);
    for (const key of ["tab", "page", "q", "oldestFirst"]) {
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

  // データフェッチ
  useEffect(() => {
    if (status.state !== "authenticated") return;
    setLoading(true);
    setError(null);

    // 型安全なparams
    const params: {
      offset: number;
      limit: number;
      order: "asc" | "desc";
      focus_user_id?: string;
      query?: string;
      nickname?: string;
    } = {
      offset: (page - 1) * PAGE_SIZE,
      limit: PAGE_SIZE + 1,
      order: oldestFirst ? "asc" : "desc",
      focus_user_id: userId,
    };

    let fetcher: Promise<UserDetail[]>;
    if (isSearchMode) {
      if ("query" in searchQueryObj && searchQueryObj.query) params.query = searchQueryObj.query;
      if ("nickname" in searchQueryObj && searchQueryObj.nickname)
        params.nickname = searchQueryObj.nickname;
      fetcher = listUsersDetail(params);
    } else if (effectiveTab === "followees") {
      fetcher = listFollowees(userId!, {
        offset: params.offset,
        limit: params.limit,
        order: params.order,
        focus_user_id: userId,
      });
    } else if (effectiveTab === "followers") {
      fetcher = listFollowers(userId!, {
        offset: params.offset,
        limit: params.limit,
        order: params.order,
        focus_user_id: userId,
      });
    } else {
      fetcher = listUsersDetail(params);
    }

    fetcher
      .then((data) => {
        setHasNext(data.length > PAGE_SIZE);
        setUsers(data.slice(0, PAGE_SIZE));
      })
      .catch((err) => {
        if (err instanceof Error) setError(err.message);
        else setError("Failed to fetch users.");
      })
      .finally(() => setLoading(false));
  }, [status.state, effectiveTab, page, oldestFirst, qParam, userId, isSearchMode, searchQueryObj]);

  if (status.state !== "authenticated") return null;

  // Oldest first切り替え
  function handleOldestFirstToggle(checked: boolean) {
    setQuery({
      oldestFirst: checked ? "1" : undefined,
      page: 1,
      ...(isSearchMode ? { q: qParam } : {}),
      ...(isSearchMode ? { tab: "all" } : { tab }),
    });
  }

  // ページ遷移
  function handlePageChange(nextPage: number) {
    setQuery({
      page: nextPage,
      ...(isSearchMode
        ? { q: qParam, oldestFirst: oldestFirst ? "1" : undefined, tab: "all" }
        : { tab, oldestFirst: oldestFirst ? "1" : undefined }),
    });
  }

  // タブ切替
  function handleTabChange(nextTab: (typeof TAB_VALUES)[number]) {
    setQuery({
      tab: nextTab,
      page: 1,
      q: undefined,
      oldestFirst: oldestFirst ? "1" : undefined,
    });
  }

  return (
    <>
    <Navbar />
    <main className="max-w-3xl mx-auto mt-8 p-4">
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
      {isSearchMode && (
        <div className="mb-2 text-sm text-gray-500">
          Users matching{" "}
          <span className="bg-gray-200 rounded px-2 py-0.5 text-gray-700">
            {serializeUserSearchQuery(searchQueryObj)}
          </span>
        </div>
      )}
      <div>
        {loading && <div className="text-gray-500">Loading…</div>}
        <ul className="space-y-4">
          {users.map((user) => (
            <li key={user.id}>
              <UserCard
                user={user}
                focusUserId={userId}
                onClick={() => location.assign(`/users/${user.id}`)}
              />
            </li>
          ))}
        </ul>
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
        {users.length === 0 && !loading && !error && (
          <div className="text-gray-500 text-center">No users found.</div>
        )}
      </div>
    </main>
    </>
  );
}
