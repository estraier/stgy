"use client";
import { useEffect, useState } from "react";
import { getSessionInfo, logout } from "@/api/auth";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { FiSettings, FiSearch } from "react-icons/fi";
import type { SessionInfo } from "@/api/model";

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
          setNickname(user.user_nickname || "");
          setUserId(user.user_id || "");
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
      router.push(q ? `/posts?q=${encodeURIComponent(q)}` : "/posts");
    }
  }

  return (
    <nav className="w-full h-12 flex items-center px-4 bg-white border-b shadow z-10">
      <a href="/posts" className="font-bold text-lg text-blue-600 mr-6 select-none" tabIndex={0}>
        Fakebook
      </a>
      <div className="flex gap-2">
        <a
          href="/posts"
          className={`px-3 py-2 rounded ${isActive("/posts") ? "bg-blue-100 font-semibold" : ""}`}
        >
          Posts
        </a>
        <a
          href="/users"
          className={`px-3 py-2 rounded ${isActive("/users") ? "bg-blue-100 font-semibold" : ""}`}
        >
          Users
        </a>
      </div>
      <div className="ml-auto flex items-center gap-2 relative">
        <form className="flex items-center relative" onSubmit={handleSearch} autoComplete="off">
          <input
            type="text"
            name="q"
            className="pl-9 pr-3 py-1 border border-gray-400 rounded bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-200 text-sm w-28 sm:w-48"
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
            className="text-sm text-gray-700 min-w-[10ex] max-w-[20ex] truncate text-ellipsis text-right block"
            title={nickname}
            style={{ display: "inline-block" }}
          >
            {nickname}
          </span>
        )}
        <button
          className="p-2 rounded hover:bg-gray-200 cursor-pointer"
          aria-label="Settings"
          onClick={() => setMenuOpen((v) => !v)}
        >
          <FiSettings size={22} />
        </button>
        {menuOpen && (
          <div
            className="absolute top-0 right-0 mt-2 bg-white border rounded shadow py-2 min-w-[140px] z-50"
            onMouseLeave={() => setMenuOpen(false)}
          >
            <a
              href={`/users/${userId}`}
              className="block w-full px-4 py-2 text-left hover:bg-gray-100"
              onClick={() => setMenuOpen(false)}
            >
              Profile
            </a>
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
