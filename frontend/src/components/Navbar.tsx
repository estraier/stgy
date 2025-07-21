"use client";
import { useEffect, useState } from "react";
import { getSessionInfo, logout } from "@/api/auth";
import { useRouter, usePathname } from "next/navigation";
import { FiSettings } from "react-icons/fi";
import type { SessionInfo } from "@/api/model";

export default function Navbar() {
  const [loggedIn, setLoggedIn] = useState<boolean | null>(null);
  const [nickname, setNickname] = useState<string>("");
  const [userId, setUserId] = useState<string>("");
  const [menuOpen, setMenuOpen] = useState(false);
  const router = useRouter();
  const pathname = usePathname();

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

  if (loggedIn !== true) return null;

  const isActive = (path: string) => pathname?.startsWith(path);

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
      <div className="ml-auto relative flex items-center gap-2">
        {nickname && <span className="text-sm text-gray-700">{nickname}</span>}
        <button
          className="p-2 rounded hover:bg-gray-200"
          aria-label="Settings"
          onClick={() => setMenuOpen((v) => !v)}
        >
          <FiSettings size={22} />
        </button>
        {menuOpen && (
          <div
            className="absolute right-0 mt-2 bg-white border rounded shadow py-2 min-w-[140px] z-50"
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
