"use client";

import { useEffect, useState } from "react";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { useRequireLogin } from "@/hooks/useRequireLogin";
import { listUsersDetail, listFollowers, listFollowees } from "@/api/users";
import type { UserDetail, User } from "@/api/models";
import { parseUserSearchQuery, serializeUserSearchQuery } from "@/utils/parse";

export default function UsersPage() {
  const status = useRequireLogin();
  const [users, setUsers] = useState<(UserDetail | User)[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<"followees" | "followers" | "all">("followees");
  const [page, setPage] = useState(1);
  const [hasNext, setHasNext] = useState(false);
  const [oldestFirst, setOldestFirst] = useState(false);

  const PAGE_SIZE = 20;
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const user_id = status.state === "authenticated" ? status.user.user_id : undefined;
  const qParam = searchParams.get("q") ?? "";
  const pageParam = Number(searchParams.get("page")) || 1;
  const searchQueryObj = qParam ? parseUserSearchQuery(qParam) : {};
  const isSearchMode = !!(
    (searchQueryObj.query && searchQueryObj.query.length > 0) ||
    (searchQueryObj.nickname && searchQueryObj.nickname.length > 0)
  );
  const effectiveTab = isSearchMode ? "all" : tab;

  useEffect(() => {
    if (status.state !== "authenticated") return;
    setLoading(true);
    setError(null);

    let usePage = isSearchMode ? pageParam : page;
    let params: any = {
      offset: (usePage - 1) * PAGE_SIZE,
      limit: PAGE_SIZE + 1,
      order: (isSearchMode ? !!searchQueryObj.oldest : oldestFirst) ? "asc" : "desc",
      focus_user_id: user_id,
    };

    let fetcher: Promise<UserDetail[] | User[]>;
    if (isSearchMode) {
      if (searchQueryObj.query) params.query = searchQueryObj.query;
      if (searchQueryObj.nickname) params.nickname = searchQueryObj.nickname;
      fetcher = listUsersDetail(params);
    } else if (effectiveTab === "followees") {
      fetcher = listFollowees(user_id!, {
        offset: params.offset,
        limit: params.limit,
        order: params.order,
        focus_user_id: user_id,
      });
    } else if (effectiveTab === "followers") {
      fetcher = listFollowers(user_id!, {
        offset: params.offset,
        limit: params.limit,
        order: params.order,
        focus_user_id: user_id,
      });
    } else {
      fetcher = listUsersDetail(params);
    }

    fetcher
      .then((data) => {
        setHasNext(data.length > PAGE_SIZE);
        setUsers(data.slice(0, PAGE_SIZE));
      })
      .catch((err: any) => setError(err.message || "Failed to fetch users."))
      .finally(() => setLoading(false));
  }, [
    status,
    tab,
    page,
    isSearchMode,
    qParam,
    pageParam,
    oldestFirst,
    searchQueryObj.oldest,
    searchQueryObj.nickname,
    searchQueryObj.query,
    pathname,
    user_id,
  ]);

  useEffect(() => {
    if (isSearchMode) {
      setTab("all");
      setOldestFirst(!!searchQueryObj.oldest);
      setPage(pageParam);
    }
  }, [isSearchMode, qParam, pageParam, searchQueryObj.oldest]);

  function handleOldestFirstToggle(checked: boolean) {
    if (!isSearchMode) {
      setOldestFirst(checked);
      setPage(1);
      return;
    }
    let updated = { ...searchQueryObj };
    if (checked) {
      updated.oldest = true;
    } else {
      delete updated.oldest;
    }
    const nextQ = serializeUserSearchQuery(updated);
    router.push(`${pathname}?q=${encodeURIComponent(nextQ)}`);
  }

  if (status.state !== "authenticated") return null;

  return (
    <main className="max-w-3xl mx-auto mt-8 p-4">
      <div className="flex gap-1 mb-2">
        <button
          className={`px-3 py-1 rounded-t text-sm font-normal cursor-pointer
            ${tab === "followees" && !isSearchMode ? "bg-blue-100 text-gray-800" : "bg-blue-50 text-gray-400 hover:bg-blue-100"}`}
          style={{ minWidth: 110 }}
          onClick={() => {
            setTab("followees");
            setPage(1);
            if (isSearchMode) router.push(pathname);
          }}
        >
          Followees
        </button>
        <button
          className={`px-3 py-1 rounded-t text-sm font-normal cursor-pointer
            ${tab === "followers" && !isSearchMode ? "bg-blue-100 text-gray-800" : "bg-blue-50 text-gray-400 hover:bg-blue-100"}`}
          style={{ minWidth: 110 }}
          onClick={() => {
            setTab("followers");
            setPage(1);
            if (isSearchMode) router.push(pathname);
          }}
        >
          Followers
        </button>
        <button
          className={`px-3 py-1 rounded-t text-sm font-normal cursor-pointer
            ${tab === "all" || isSearchMode ? "bg-blue-100 text-gray-800" : "bg-blue-50 text-gray-400 hover:bg-blue-100"}`}
          style={{ minWidth: 110 }}
          onClick={() => {
            setTab("all");
            setPage(1);
            if (isSearchMode) router.push(pathname);
          }}
        >
          All
        </button>
        <label className="flex items-center gap-1 text-sm text-gray-700 cursor-pointer ml-4">
          <input
            type="checkbox"
            checked={isSearchMode ? !!searchQueryObj.oldest : oldestFirst}
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
          {users.map((user: any) => (
            <li
              key={user.id}
              className="p-4 border rounded shadow-sm hover:bg-gray-50 cursor-pointer"
              onClick={() => router.push(`/users/${user.id}`)}
            >
              <div className="font-semibold">
                {user.nickname} ({user.email})
                {user.is_admin && (
                  <span className="ml-2 px-2 py-1 bg-blue-100 text-blue-600 rounded text-xs">
                    admin
                  </span>
                )}
              </div>
              <div className="text-xs text-gray-500 mt-1">
                Created: {new Date(user.created_at).toLocaleString()}
                {"count_followers" in user && (
                  <span className="ml-4">
                    {user.count_followers} followers / {user.count_followees} followees
                  </span>
                )}
              </div>
              <div className="text-sm mt-1 text-gray-700">
                <span className="font-semibold">Introduction:</span> {user.introduction}
              </div>
              <div className="text-xs text-gray-600 mt-1">
                <span className="font-semibold">Personality:</span> {user.personality} /{" "}
                <span className="font-semibold">Model:</span> {user.model}
              </div>
              {"is_followed_by_focus_user" in user && user.is_followed_by_focus_user && (
                <div className="mt-1 text-xs text-blue-700">Follows you</div>
              )}
              {"is_following_focus_user" in user && user.is_following_focus_user && (
                <div className="mt-1 text-xs text-blue-700">You follow</div>
              )}
            </li>
          ))}
        </ul>
        <div className="mt-6 flex justify-center gap-4">
          <button
            className="px-3 py-1 rounded border text-gray-800 bg-blue-100 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
            onClick={() => {
              const nextPage = Math.max(1, (isSearchMode ? pageParam : page) - 1);
              setPage(nextPage);
              if (isSearchMode) {
                router.push(
                  `${pathname}?page=${nextPage}${qParam ? `&q=${encodeURIComponent(qParam)}` : ""}`,
                );
              }
            }}
            disabled={(isSearchMode ? pageParam : page) === 1}
          >
            Prev
          </button>
          <span className="text-gray-800">Page {isSearchMode ? pageParam : page}</span>
          <button
            className="px-3 py-1 rounded border text-gray-800 bg-blue-100 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
            onClick={() => {
              const nextPage = (isSearchMode ? pageParam : page) + 1;
              setPage(nextPage);
              if (isSearchMode) {
                router.push(
                  `${pathname}?page=${nextPage}${qParam ? `&q=${encodeURIComponent(qParam)}` : ""}`,
                );
              }
            }}
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
  );
}
