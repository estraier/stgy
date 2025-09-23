"use client";

import { Config } from "@/config";
import { useEffect, useState } from "react";
import Link from "next/link";
import { getSessionInfo, logout } from "@/api/auth";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { FiSettings, FiSearch } from "react-icons/fi";
import type { SessionInfo } from "@/api/models";
import NotificationBell from "@/components/NotificationBell";

export default function Navbar() {
  const [loggedIn, setLoggedIn] = useState<boolean | null>(null);
  const [nickname, setNickname] = useState<string>("");
  const [userId, setUserId] = useState<string>("");
  const [menuOpen, setMenuOpen] = useState(false);
  const [searchValue, setSearchValue] = useState("");
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  useEffect(() => {
    let canceled = false;
    getSessionInfo()
      .then((user: SessionInfo) => {
        if (!canceled) {
          setLoggedIn(true);
          setNickname(user.userNickname || "");
          setUserId(user.userId || "");
        }
      })
      .catch(() => {
        if (!canceled) {
          setLoggedIn(false);
          setNickname("");
          setUserId("");
        }
      });
    return () => {
      canceled = true;
    };
  }, [pathname]);

  useEffect(() => {
    const q = searchParams?.get("q") || "";
    setSearchValue(q);
  }, [searchParams]);

  if (loggedIn !== true) return null;

  const isActive = (path: string) => pathname?.startsWith(path);

  function handleSearch(e?: React.FormEvent) {
    if (e) e.preventDefault();
    const q = searchValue.trim();
    if (isActive("/users")) {
      router.push(q ? `/users?q=${encodeURIComponent(q)}` : "/users");
    } else {
      router.push(q ? `/posts?q=${encodeURIComponent(q)}&includingReplies=1` : "/posts");
    }
  }

  return (
    <nav
      className="
        w-full h-12 flex flex-nowrap items-center
        px-2 sm:px-4 bg-white border-b border-gray-500 shadow z-10
      "
    >
      <Link
        href="/"
        className="font-bold text-base sm:text-lg text-blue-600 mr-3 sm:mr-6 select-none shrink-0"
        tabIndex={0}
      >
        STGY
      </Link>

      <div className="flex gap-1.5 sm:gap-2 shrink-0">
        <Link
          href="/posts"
          className={`px-2 sm:px-3 py-1.5 sm:py-2 rounded text-sm ${
            isActive("/posts") ? "bg-blue-100 font-semibold" : "hover:bg-blue-50"
          }`}
        >
          Posts
        </Link>
        <Link
          href="/users"
          className={`px-2 sm:px-3 py-1.5 sm:py-2 rounded text-sm ${
            isActive("/users") ? "bg-blue-100 font-semibold" : "hover:bg-blue-50"
          }`}
        >
          Users
        </Link>
      </div>

      <div className="ml-auto flex items-center gap-1.5 sm:gap-2 relative min-w-0">
        <form
          className="sm:mr-2 flex items-center relative min-w-0"
          onSubmit={handleSearch}
          autoComplete="off"
        >
          <input
            type="text"
            name="q"
            className="
              pl-8 pr-3 py-1 border border-gray-300 rounded bg-gray-50
              focus:outline-none focus:ring-2 focus:ring-blue-200 text-sm
              w-[clamp(80px,20vw,200px)] sm:w-[clamp(120px,30vw,240px)]
            "
            placeholder="Search…"
            value={searchValue}
            onChange={(e) => setSearchValue(e.target.value)}
            aria-label="Search"
          />
          <button
            type="submit"
            className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-blue-500 p-0 cursor-pointer"
            tabIndex={0}
            aria-label="Search"
          >
            <FiSearch size={18} />
          </button>
        </form>

        {nickname && (
          <span
            className="
              hidden sm:block text-sm text-gray-700 max-w-[18ch]
              truncate text-ellipsis text-right min-w-0
            "
            title={nickname}
          >
            {nickname}
          </span>
        )}

        {userId && <NotificationBell userId={userId} intervalMs={30_000} />}

        <button
          className="p-2 rounded hover:bg-gray-200 cursor-pointer shrink-0"
          aria-label="Settings"
          onClick={() => setMenuOpen((v) => !v)}
        >
          <FiSettings size={22} />
        </button>

        {menuOpen && (
          <div
            className="absolute top-0 right-0 mt-12 bg-white border rounded shadow py-2 min-w-[140px] z-50"
            onMouseLeave={() => setMenuOpen(false)}
          >
            <Link
              href={`/users/${userId}`}
              className="block w-full px-4 py-2 text-left hover:bg-gray-100"
              onClick={() => setMenuOpen(false)}
            >
              Profile
            </Link>
            <Link
              href="/images"
              className="block w-full px-4 py-2 text-left hover:bg-gray-100"
              onClick={() => setMenuOpen(false)}
            >
              Images
            </Link>
            <Link
              href="/settings"
              className="block w-full px-4 py-2 text-left hover:bg-gray-100"
              onClick={() => setMenuOpen(false)}
            >
              Settings
            </Link>
            <Link
              href={Config.HELP_PAGE_PATH}
              className="block w-full px-4 py-2 text-left hover:bg-gray-100"
              onClick={() => setMenuOpen(false)}
            >
              Help
            </Link>
            <button
              className="block w-full px-4 py-2 text-left hover:bg-gray-100"
              onClick={async () => {
                setMenuOpen(false);
                await logout();
                setLoggedIn(false);
                setNickname("");
                setUserId("");
                window.location.href = "/";
              }}
            >
              Log out
            </button>
          </div>
        )}
      </div>
    </nav>
  );
}
