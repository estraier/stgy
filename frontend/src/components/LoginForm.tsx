"use client";
import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { login } from "../api/auth";

const LAST_EMAIL_KEY = "lastLoginEmail";

export default function LoginForm() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const router = useRouter();

  // フォーム初期化時にlocalStorageから直近のemailをセット
  useEffect(() => {
    const last = typeof window !== "undefined" ? localStorage.getItem(LAST_EMAIL_KEY) : "";
    if (last) setEmail(last);
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setIsLoading(true);
    try {
      await login(email, password);
      localStorage.setItem(LAST_EMAIL_KEY, email); // ログイン成功時に保存
      router.replace("/posts");
    } catch (err: any) {
      setError(err?.message || "Failed to log in");
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4 max-w-xs mx-auto mt-8">
      <div>
        <label htmlFor="email" className="block text-sm">E-mail Address</label>
        <input
          id="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          type="email"
          required
          className="border w-full px-2 py-1"
          autoComplete="username"
        />
      </div>
      <div>
        <label htmlFor="password" className="block text-sm">Password</label>
        <input
          id="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          type="password"
          required
          className="border w-full px-2 py-1"
          autoComplete="current-password"
        />
      </div>
      {error && <div className="text-red-600 text-sm">{error}</div>}
      <button
        type="submit"
        className="bg-blue-500 text-white px-4 py-2 rounded"
        disabled={isLoading}
      >
        {isLoading ? "Logging in..." : "Log in"}
      </button>
    </form>
  );
}
