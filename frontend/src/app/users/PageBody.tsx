"use client";

import { Config } from "@/config";
import { useEffect, useState, useMemo, useCallback } from "react";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { useRequireLogin } from "@/hooks/useRequireLogin";
import { listUsers, listFollowers, listFollowees } from "@/api/users";
import type { User } from "@/api/models";
import { parseUserSearchQuery, serializeUserSearchQuery } from "@/utils/parse";
import UserCard from "@/components/UserCard";

const TAB_VALUES = ["followees", "followers", "all"] as const;

export default function PageBody() {
  const status = useRequireLogin();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  function getQuery() {
    return {
      tab: (searchParams.get("tab") as (typeof TAB_VALUES)[number]) || "followees",
      page: Math.max(Number(searchParams.get("page")) || 1, 1),
      qParam: searchParams.get("q") ?? "",
      oldestFirst: searchParams.get("oldestFirst") === "1",
    };
  }
  const { tab, page, qParam, oldestFirst } = getQuery();

  const searchQueryObj = useMemo(() => (qParam ? parseUserSearchQuery(qParam) : {}), [qParam]);

  const userId = status.state === "authenticated" ? status.session.userId : undefined;
  const isSearchMode = useMemo(
    () =>
      (searchQueryObj.query && searchQueryObj.query.length > 0) ||
      (searchQueryObj.nickname && searchQueryObj.nickname.length > 0),
    [searchQueryObj],
  );

  const effectiveTab = isSearchMode ? "all" : tab;

  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [hasNext, setHasNext] = useState(false);

  const setQuery = useCallback(
    (
      updates: Partial<{ tab: string; page: number; q: string; oldestFirst: string | undefined }>,
    ) => {
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
    },
    [router, pathname, searchParams],
  );

  const tabParamMissing = useMemo(() => searchParams.get("tab") === null, [searchParams]);

  useEffect(() => {
    if (status.state !== "authenticated") return;
    setLoading(true);
    setError(null);

    const params: {
      offset: number;
      limit: number;
      order: "asc" | "desc";
      focusUserId?: string;
      query?: string;
      nickname?: string;
    } = {
      offset: (page - 1) * Config.USERS_PAGE_SIZE,
      limit: Config.USERS_PAGE_SIZE + 1,
      order: oldestFirst ? "asc" : "desc",
      focusUserId: userId,
    };

    let fetcher: Promise<User[]>;
    if (isSearchMode) {
      if ("query" in searchQueryObj && searchQueryObj.query) params.query = searchQueryObj.query;
      if ("nickname" in searchQueryObj && searchQueryObj.nickname)
        params.nickname = searchQueryObj.nickname;
      fetcher = listUsers(params);
    } else if (effectiveTab === "followees") {
      fetcher = listFollowees(userId!, {
        offset: params.offset,
        limit: params.limit,
        order: params.order,
        focusUserId: userId,
      });
    } else if (effectiveTab === "followers") {
      fetcher = listFollowers(userId!, {
        offset: params.offset,
        limit: params.limit,
        order: params.order,
        focusUserId: userId,
      });
    } else {
      fetcher = listUsers(params);
    }

    fetcher
      .then((data) => {
        if (
          effectiveTab === "followees" &&
          !isSearchMode &&
          tabParamMissing &&
          page === 1 &&
          data.length === 0
        ) {
          setQuery({
            tab: "all",
            page: 1,
            oldestFirst: undefined,
          });
          return;
        }
        setHasNext(data.length > Config.USERS_PAGE_SIZE);
        setUsers(data.slice(0, Config.USERS_PAGE_SIZE));
      })
      .catch((err) => {
        if (err instanceof Error) setError(err.message);
        else setError("Failed to fetch users.");
      })
      .finally(() => setLoading(false));
  }, [
    status.state,
    effectiveTab,
    page,
    oldestFirst,
    qParam,
    userId,
    isSearchMode,
    searchQueryObj,
    tabParamMissing,
    setQuery,
  ]);

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

  if (status.state !== "authenticated") return null;

  function handleOldestFirstToggle(checked: boolean) {
    setQuery({
      oldestFirst: checked ? "1" : undefined,
      page: 1,
      ...(isSearchMode ? { q: qParam } : {}),
      ...(isSearchMode ? { tab: "all" } : { tab }),
    });
  }

  function handlePageChange(nextPage: number) {
    setQuery({
      page: nextPage,
      ...(isSearchMode
        ? { q: qParam, oldestFirst: oldestFirst ? "1" : undefined, tab: "all" }
        : { tab, oldestFirst: oldestFirst ? "1" : undefined }),
    });
  }

  function handleTabChange(nextTab: (typeof TAB_VALUES)[number]) {
    setQuery({
      tab: nextTab,
      page: 1,
      q: undefined,
      oldestFirst: undefined,
    });
  }

  return (
    <main className="max-w-3xl mx-auto mt-8 p-1 sm:p-4">
      <div className="flex gap-1 mb-2">
        {TAB_VALUES.map((t) => (
          <button
            key={t}
            className={`px-3 max-md:px-2 py-1 rounded-t min-w-0 sm:min-w-[110px] text-sm font-normal cursor-pointer
              ${tab === t && !isSearchMode ? "bg-blue-100 text-gray-800" : "bg-blue-50 text-gray-400 hover:bg-blue-100"}`}
            onClick={() => handleTabChange(t)}
          >
            {t.charAt(0).toUpperCase() + t.slice(1)}
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
          <span className="md:hidden" aria-hidden>Oldest</span>
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
  );
}
