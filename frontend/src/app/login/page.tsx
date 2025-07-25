"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { login } from "@/api/auth";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (typeof window !== "undefined") {
      const last = localStorage.getItem("lastLoginEmail");
      if (last) setEmail(last);
    }
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      await login(email, password);
      localStorage.setItem("lastLoginEmail", email);
      router.push("/posts");
    } catch (err: any) {
      setError(err?.message || "Invalid email or password.");
    }
  };

  return (
    <main className="flex flex-col items-center justify-center min-h-screen">
      <form className="w-full max-w-sm bg-white p-8 rounded shadow" onSubmit={handleSubmit}>
        <h1 className="text-2xl font-bold mb-6 text-center">Log in to Fakebook</h1>
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
        <div className="mt-4 text-center">
          Don't have an account?{" "}
          <a href="/signup" className="text-blue-600 hover:underline">
            Sign up
          </a>
        </div>
      </form>
    </main>
  );
}
