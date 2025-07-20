"use client";

import { useSearchParams } from "next/navigation";

export default function ErrorPage() {
  const params = useSearchParams();
  const code = params.get("code") || "Error";
  const message = params.get("message") || "Something went wrong.";

  return (
    <main className="flex flex-col items-center justify-center min-h-screen bg-white">
      <div className="text-2xl font-bold mb-4">{code}</div>
      <p className="mb-6 text-gray-700">{message}</p>
      <a href="/" className="text-blue-600 underline hover:text-blue-800">
        Back to Home
      </a>
    </main>
  );
}
