"use client";
import { useState } from "react";
import { login } from "../api/auth";

export default function LoginForm() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    try {
      await login(email, password);
      window.location.href = "/posts";
    } catch (err: any) {
      setError(err?.message || "Failed to log in");
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4 max-w-xs mx-auto mt-8">
      <div>
        <label className="block text-sm">E-mail Address</label>
        <input
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          type="email"
          required
          className="border w-full px-2 py-1"
        />
      </div>
      <div>
        <label className="block text-sm">Password</label>
        <input
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          type="password"
          required
          className="border w-full px-2 py-1"
        />
      </div>
      {error && <div className="text-red-600 text-sm">{error}</div>}
      <button type="submit" className="bg-blue-500 text-white px-4 py-2 rounded">
        Log in
      </button>
    </form>
  );
}
