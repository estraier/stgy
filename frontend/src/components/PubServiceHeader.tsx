import Link from "next/link";
import type { SessionInfo } from "@/api/models";

type Props = {
  showServiceHeader: boolean;
  session?: SessionInfo | null;
  redirectTo?: string;
  viewAsHref?: string;
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

export default function PubServiceHeader({
  showServiceHeader,
  session,
  redirectTo,
  viewAsHref,
}: Props) {
  if (!showServiceHeader) {
    return <div className="sh-pad h-12" aria-hidden="true" />;
  }
  const next = normalizeNext(redirectTo);
  const loginHref = addNext("/login", next);
  const signupHref = addNext("/signup", next);
  const viewHref = viewAsHref ?? "/posts";

  return (
    <nav className="sh-nav w-full h-12 flex items-center px-3">
      <Link href="/" className="sh-logo">
        STGY
      </Link>
      <div className="sh-notes ml-auto flex items-center gap-2">
        {session ? (
          <Link
            href={viewHref}
            className="sh-viewas text-sm text-blue-600 hover:underline truncate max-w-[28ch]"
            title={session.userNickname}
          >
            view as <span className="sh-nickname">{session.userNickname}</span>
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
