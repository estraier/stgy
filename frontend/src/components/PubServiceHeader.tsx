"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { SessionInfo, PubPostDetail } from "@/api/models";
import { getSessionInfo } from "@/api/auth";
import { Heart, MessageCircle } from "lucide-react";

type Props = {
  showServiceHeader: boolean;
  redirectTo?: string;
  viewAsHref?: string;
  post?: PubPostDetail;
};

function isAllowedPath(p: string): boolean {
  const s = p.startsWith("/") ? p : `/${p}`;
  return s === "/posts" || s === "/users" || s.startsWith("/posts/") || s.startsWith("/users/");
}
function normalizeNext(p?: string): string | null {
  if (!p) return null;
  const s = p.startsWith("/") ? p : `/${p}`;
  return isAllowedPath(s) ? s : null;
}
function addNext(base: string, next: string | null): string {
  if (!next) return base;
  const sep = base.includes("?") ? "&" : "?";
  return `${base}${sep}next=${encodeURIComponent(next)}`;
}

export default function PubServiceHeader({ showServiceHeader, redirectTo, viewAsHref, post }: Props) {
  const [session, setSession] = useState<SessionInfo | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const s = await getSessionInfo();
        if (!cancelled) setSession(s ?? null);
      } catch {
      } finally {
        if (!cancelled) setLoaded(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (!showServiceHeader) return <div className="sh-pad h-3" aria-hidden="true" />;

  const next = normalizeNext(redirectTo);
  const loginHref = addNext("/login", next);
  const signupHref = addNext("/signup", next);
  const viewHref = viewAsHref ?? "/posts";

  let countLikes = 0;
  let countReplies = 0;
  if (post && session) {
    countLikes = post.countLikes;
    countReplies = post.countReplies;
  }
  return (
    <nav className="sh-nav w-full h-10 flex items-center px-3">
      <Link href="/" className="sh-logo">
        STGY
      </Link>
        <div className="counts flex gap-2 ml-6">
          {countLikes > 0 && (
            <div className="count-likes flex gap-1 items-center">
              <Heart size={12} />
              <span>{countLikes}</span>
            </div>
          )}
          {countReplies > 0 && (
            <div className="count-replies flex gap-1 items-center">
              <MessageCircle size={12} />
              <span>{countReplies}</span>
            </div>
          )}
        </div>
      <div className="sh-notes ml-auto flex items-center gap-2">
        {loaded && session ? (
          <Link
            href={viewHref}
            className="sh-nickname text-sm text-blue-600 hover:underline truncate max-w-[28ch]"
            title={session.userNickname}
          >
            {session.userNickname}
          </Link>
        ) : (
          <>
            <Link href={loginHref} className="sh-button px-2 py-0.5 rounded border text-sm">
              Login
            </Link>
            <Link href={signupHref} className="sh-button px-2 py-0.5 rounded border text-sm">
              Sign up
            </Link>
          </>
        )}
      </div>
    </nav>
  );
}
