"use client";

import { useState, useEffect, useMemo } from "react";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { login } from "@/api/auth";

function isAllowedPath(p: string): boolean {
  const s = p.startsWith("/") ? p : `/${p}`;
  return s === "/posts" || s === "/users" || s.startsWith("/posts/") || s.startsWith("/users/");
}

export default function PageBody() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);

  const redirectTo = useMemo(() => {
    const qp =
      searchParams.get("next") ||
      searchParams.get("to") ||
      searchParams.get("redirect") ||
      searchParams.get("r");
    if (qp && isAllowedPath(qp)) {
      return qp.startsWith("/") ? qp : `/${qp}`;
    }
    let suffix = pathname.startsWith("/login") ? pathname.slice(6) : "";
    if (suffix === "" || suffix === "/") return null;
    if (!suffix.startsWith("/")) suffix = `/${suffix}`;
    return isAllowedPath(suffix) ? suffix : null;
  }, [pathname, searchParams]);

  useEffect(() => {
    if (typeof window !== "undefined") {
      const last = localStorage.getItem("lastLoginEmail");
      if (last) setEmail(last);
    }
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await login(email, password);
      if (typeof window !== "undefined") {
        localStorage.setItem("lastLoginEmail", email);
      }
      router.push(redirectTo ?? "/");
    } catch (err: unknown) {
      setError(err ? String(err) : "Invalid email or password.");
    }
  }

  return (
    <main className="flex flex-col items-center justify-center min-h-screen">
      <form className="w-full max-w-sm bg-white p-8 rounded border shadow" onSubmit={handleSubmit}>
        <h1 className="text-2xl font-bold mb-6 text-center">Log in to STGY</h1>
        <label className="block mb-2 font-medium">Email</label>
        <input
          type="email"
          required
          className="w-full px-3 py-2 mb-4 border rounded"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        <label className="block mb-2 font-medium">Password</label>
        <input
          type="password"
          required
          className="w-full px-3 py-2 mb-4 border rounded"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        {error && <div className="mb-4 text-red-600 text-sm">{error}</div>}
        <button
          type="submit"
          className="w-full py-2 bg-blue-600 text-white rounded hover:bg-blue-700 font-bold"
        >
          Log in
        </button>
        <div className="mt-4 text-center opacity-80">
          Don&apos;t have an account?{" "}
          <a href="/signup" className="text-blue-600 hover:underline">
            Sign up
          </a>
        </div>
        <div className="mt-1 text-center opacity-80">
          Forgot the password?{" "}
          <a href="/reset-password" className="text-blue-600 hover:underline">
            Reset it
          </a>
        </div>
      </form>
    </main>
  );
}
